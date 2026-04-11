/**
 * Moteur de prédiction Baccarat
 */
const db  = require('./db');
const { fetchGames } = require('./games');
const {
  sendPredictionToTargets,
  sendToStrategyChannels,
  sendCustomAndStore,
  editStoredMessages,
  getCurrentMaxRattrapage,
} = require('./telegram-service');

const ALL_SUITS   = ['♠', '♥', '♦', '♣'];
const SUIT_DISPLAY = { '♠': '♠️', '♥': '❤️', '♦': '♦️', '♣': '♣️' };

const C1_B = 5;  const C1_MAP = { '♣':'♦','♦':'♣','♠':'♥','♥':'♠' };
const C2_B = 8;  const C2_MAP = { '♥':'♣','♣':'♥','♠':'♦','♦':'♠' };
const C3_B = 5;  const C3_MAP = { '♥':'♣','♣':'♥','♠':'♦','♦':'♠' };

const RAW_TO_SUIT = { '♠️':'♠','♣️':'♣','♦️':'♦','♥️':'♥','❤️':'♥' };

function normalizeSuit(s) {
  return RAW_TO_SUIT[s] || s.replace(/\ufe0f/g, '').replace('❤', '♥');
}

function extractSuits(playerCards) {
  const suits = new Set();
  for (const c of playerCards) {
    const n = normalizeSuit(c.S || '');
    if (ALL_SUITS.includes(n)) suits.add(n);
  }
  return [...suits];
}

async function savePrediction(strategy, gameNumber, predictedSuit, triggeredBy) {
  try {
    await db.createPrediction({ strategy, game_number: gameNumber, predicted_suit: predictedSuit, triggered_by: triggeredBy || null });
    console.log(`[${strategy}] Prédiction #${gameNumber} ${SUIT_DISPLAY[predictedSuit] || predictedSuit}`);
    // Pour les stratégies globales (C1/C2/C3/DC), on route via sendToStrategyChannels.
    // Les stratégies custom (Sxx) envoient via sendCustomAndStore depuis _processCustomStrategy.
    if (!strategy.startsWith('S') || strategy === 'S') {
      await sendToStrategyChannels(strategy, gameNumber, predictedSuit);
    }
  } catch (e) { console.error('savePrediction error:', e.message); }
}

async function resolvePrediction(strategy, gameNumber, predictedSuit, status, rattrapage, playerCards, bankerCards) {
  try {
    await db.updatePrediction(
      { strategy, game_number: gameNumber, predicted_suit: predictedSuit, status_filter: 'en_cours' },
      { status, rattrapage, resolved_at: new Date().toISOString(),
        player_cards: playerCards ? JSON.stringify(playerCards) : null,
        banker_cards: bankerCards ? JSON.stringify(bankerCards) : null,
      }
    );
    // editStoredMessages gère les deux cas : token global ou token custom (bot_token stocké en DB)
    editStoredMessages(strategy, gameNumber, predictedSuit, status, rattrapage).catch(() => {});
  } catch (e) { console.error('resolvePrediction error:', e.message); }
}

class Engine {
  constructor() {
    this.running  = false;
    this.interval = null;

    this.c1 = { absences: {}, processed: new Set(), pending: {}, consecLosses: 0 };
    this.c2 = { absences: {}, processed: new Set(), pending: {}, hadFirstLoss: false };
    this.c3 = { absences: {}, processed: new Set(), pending: {}, consecLosses: 0 };
    this.dc = { pending: {} };
    this.custom = {};

    for (const s of ALL_SUITS) {
      this.c1.absences[s] = 0;
      this.c2.absences[s] = 0;
      this.c3.absences[s] = 0;
    }
  }

  _makeCustomState() {
    const counts = {};
    const mappingIndex = {};
    for (const s of ALL_SUITS) { counts[s] = 0; mappingIndex[s] = 0; }
    return { counts, processed: new Set(), pending: {}, history: [], lastOutcomes: [], mappingIndex };
  }

  reloadCustomStrategies(list) {
    for (const cfg of list) {
      if (!this.custom[cfg.id]) this.custom[cfg.id] = this._makeCustomState();
      this.custom[cfg.id].config = cfg;
      for (const s of ALL_SUITS) this.custom[cfg.id].counts[s] = 0;
      console.log(`[S${cfg.id}] "${cfg.name}" rechargée: mode=${cfg.mode}, B=${cfg.threshold}, enabled=${cfg.enabled}`);
    }
    const ids = new Set(list.map(c => c.id));
    for (const id of Object.keys(this.custom)) {
      if (!ids.has(parseInt(id))) delete this.custom[id];
    }
  }

  async loadCustomStrategies() {
    try {
      const v = await db.getSetting('custom_strategies');
      if (!v) return;
      const list = JSON.parse(v);
      for (const cfg of list) {
        this.custom[cfg.id] = this._makeCustomState();
        this.custom[cfg.id].config = cfg;
        console.log(`[S${cfg.id}] "${cfg.name}" chargée (mode=${cfg.mode}, B=${cfg.threshold})`);
      }
    } catch (e) { console.error('loadCustomStrategies error:', e.message); }
  }

  async processGame(gn, suits, pCards, bCards) {
    await this._processC1(gn, suits, pCards, bCards);
    await this._processC2(gn, suits, pCards, bCards);
    await this._processC3(gn, suits, pCards, bCards);
    await this._processDC(gn, suits, pCards, bCards);
    for (const [id, state] of Object.entries(this.custom)) {
      if (state.config?.enabled) {
        await this._processCustomStrategy(parseInt(id), state, state.config, gn, suits, pCards, bCards);
      }
    }
  }

  async _resolvePending(pending, strategy, gn, suits, pCards, bCards, onLoss) {
    const maxR = getCurrentMaxRattrapage();
    for (const [pg, info] of Object.entries(pending)) {
      const pgNum = parseInt(pg);
      const ps    = info.suit;
      if (pgNum > gn) continue;

      if (gn > pgNum + maxR) {
        await resolvePrediction(strategy, pgNum, ps, 'perdu', maxR, pCards, bCards);
        delete pending[pg];
        if (onLoss) onLoss(false, ps, pgNum);
        continue;
      }

      if (suits.includes(ps)) {
        const rattrapage = gn - pgNum;
        await resolvePrediction(strategy, pgNum, ps, 'gagne', rattrapage, pCards, bCards);
        delete pending[pg];
        if (onLoss) onLoss(true, ps, pgNum);
      } else if (gn === pgNum + maxR) {
        await resolvePrediction(strategy, pgNum, ps, 'perdu', maxR, pCards, bCards);
        delete pending[pg];
        if (onLoss) onLoss(false, ps, pgNum);
      }
    }
  }

  async _processC1(gn, suits, pCards, bCards) {
    if (this.c1.processed.has(gn)) return;
    this.c1.processed.add(gn);
    await this._resolvePending(this.c1.pending, 'C1', gn, suits, pCards, bCards, (won, suit, pg) => {
      if (won) { this.c1.consecLosses = 0; return; }
      this.c1.consecLosses++;
      if (this.c1.consecLosses >= 2) {
        this.c1.consecLosses = 0;
        const next = gn + 1;
        savePrediction('DC', next, suit, suit);
        this.dc.pending[next] = { suit, rattrapage: 0 };
      }
    });
    for (const suit of ALL_SUITS) {
      if (suits.includes(suit)) { this.c1.absences[suit] = 0; continue; }
      this.c1.absences[suit] = (this.c1.absences[suit] || 0) + 1;
      if (this.c1.absences[suit] === C1_B) {
        const ps = C1_MAP[suit]; const next = gn + 1;
        await savePrediction('C1', next, ps, suit);
        this.c1.pending[next] = { suit: ps, rattrapage: 0 };
        this.c1.absences[suit] = 0;
      }
    }
  }

  async _processC2(gn, suits, pCards, bCards) {
    if (this.c2.processed.has(gn)) return;
    this.c2.processed.add(gn);
    await this._resolvePending(this.c2.pending, 'C2', gn, suits, pCards, bCards, (won, suit, pg) => {
      if (won) { this.c2.hadFirstLoss = false; return; }
      if (!this.c2.hadFirstLoss) { this.c2.hadFirstLoss = true; return; }
      this.c2.hadFirstLoss = false;
      const next = gn + 1;
      savePrediction('DC', next, suit, suit);
      this.dc.pending[next] = { suit, rattrapage: 0 };
    });
    for (const suit of ALL_SUITS) {
      if (suits.includes(suit)) { this.c2.absences[suit] = 0; continue; }
      this.c2.absences[suit] = (this.c2.absences[suit] || 0) + 1;
      if (this.c2.absences[suit] === C2_B) {
        const ps = C2_MAP[suit]; const next = gn + 1;
        await savePrediction('C2', next, ps, suit);
        this.c2.pending[next] = { suit: ps, rattrapage: 0 };
        this.c2.absences[suit] = 0;
      }
    }
  }

  async _processC3(gn, suits, pCards, bCards) {
    if (this.c3.processed.has(gn)) return;
    this.c3.processed.add(gn);
    await this._resolvePending(this.c3.pending, 'C3', gn, suits, pCards, bCards, (won, suit, pg) => {
      if (won) { this.c3.consecLosses = 0; return; }
      this.c3.consecLosses++;
      if (this.c3.consecLosses >= 2) {
        this.c3.consecLosses = 0;
        const next = gn + 1;
        savePrediction('DC', next, suit, suit);
        this.dc.pending[next] = { suit, rattrapage: 0 };
      }
    });
    for (const suit of ALL_SUITS) {
      if (suits.includes(suit)) { this.c3.absences[suit] = 0; continue; }
      this.c3.absences[suit] = (this.c3.absences[suit] || 0) + 1;
      if (this.c3.absences[suit] === C3_B) {
        const ps = C3_MAP[suit]; const next = gn + 1;
        await savePrediction('C3', next, ps, suit);
        this.c3.pending[next] = { suit: ps, rattrapage: 0 };
        this.c3.absences[suit] = 0;
      }
    }
  }

  async _processDC(gn, suits, pCards, bCards) {
    const maxR = getCurrentMaxRattrapage();
    for (const [pg, info] of Object.entries(this.dc.pending)) {
      const pgNum = parseInt(pg);
      if (gn < pgNum) continue;
      const ps = info.suit;
      if (suits.includes(ps)) {
        await resolvePrediction('DC', pgNum, ps, 'gagne', info.rattrapage, pCards, bCards);
        delete this.dc.pending[pg];
      } else if (gn > pgNum) {
        if (info.rattrapage < maxR) { info.rattrapage++; }
        else { await resolvePrediction('DC', pgNum, ps, 'perdu', info.rattrapage, pCards, bCards); delete this.dc.pending[pg]; }
      }
    }
  }

  /**
   * Vérifie si une exception bloque l'émission d'une prédiction.
   * @param {Array}  exceptions   - Liste des règles d'exception de la stratégie
   * @param {string} predictedSuit - La carte qu'on voudrait prédire
   * @param {string} triggerSuit  - La carte qui a déclenché le signal (absente ou apparente)
   * @param {object} state        - État de la stratégie custom (history, lastOutcomes, pending)
   * @returns {boolean} true = prédiction bloquée
   */
  _checkExceptions(exceptions, predictedSuit, triggerSuit, state) {
    if (!Array.isArray(exceptions) || exceptions.length === 0) return false;

    for (const ex of exceptions) {
      switch (ex.type) {

        // ── 1. Consécutives apparitions de la carte prédite ──────────
        case 'consec_appearances': {
          const n = Math.max(1, parseInt(ex.value) || 2);
          if (state.history.length < n) break;
          const recent = state.history.slice(-n);
          if (recent.every(gameSuits => gameSuits.includes(predictedSuit))) {
            console.log(`[Exception] consec_appearances(${n}): ${predictedSuit} apparu ${n}x consécutifs → bloqué`);
            return true;
          }
          break;
        }

        // ── 2. Fréquence de la carte prédite sur une fenêtre de W parties ─
        case 'recent_frequency': {
          const n = Math.max(1, parseInt(ex.value) || 3);
          const w = Math.max(2, parseInt(ex.window) || 5);
          if (state.history.length < 2) break;
          const recent = state.history.slice(-Math.min(w, state.history.length));
          const count  = recent.filter(g => g.includes(predictedSuit)).length;
          if (count >= n) {
            console.log(`[Exception] recent_frequency(${n}/${w}): ${predictedSuit} apparu ${count} fois → bloqué`);
            return true;
          }
          break;
        }

        // ── 3. Prédiction déjà en attente pour cette carte ────────────
        case 'already_pending': {
          const hasPending = Object.values(state.pending).some(p => p.suit === predictedSuit);
          if (hasPending) {
            console.log(`[Exception] already_pending: ${predictedSuit} déjà en attente → bloqué`);
            return true;
          }
          break;
        }

        // ── 4. Série de défaites consécutives ─────────────────────────
        case 'max_consec_losses': {
          const n = Math.max(1, parseInt(ex.value) || 3);
          if (state.lastOutcomes.length < n) break;
          const recent = state.lastOutcomes.slice(-n);
          if (recent.every(o => !o.won)) {
            console.log(`[Exception] max_consec_losses(${n}): ${n} défaites consécutives → bloqué`);
            return true;
          }
          break;
        }

        // ── 5. Carte déclencheur trop présente récemment ──────────────
        case 'trigger_overload': {
          const n = Math.max(1, parseInt(ex.value) || 3);
          const w = Math.max(2, parseInt(ex.window) || 5);
          if (state.history.length < 2) break;
          const recent = state.history.slice(-Math.min(w, state.history.length));
          const count  = recent.filter(g => g.includes(triggerSuit)).length;
          if (count >= n) {
            console.log(`[Exception] trigger_overload(${n}/${w}): ${triggerSuit} (déclencheur) apparu ${count} fois → bloqué`);
            return true;
          }
          break;
        }

        // ── 6. Carte prédite dans la dernière partie ──────────────────
        case 'last_game_appeared': {
          if (state.history.length < 1) break;
          const lastGame = state.history[state.history.length - 1];
          if (lastGame.includes(predictedSuit)) {
            console.log(`[Exception] last_game_appeared: ${predictedSuit} dans la dernière partie → bloqué`);
            return true;
          }
          break;
        }

        default: break;
      }
    }
    return false;
  }

  async _processCustomStrategy(id, state, cfg, gn, suits, pCards, bCards) {
    if (state.processed.has(gn)) return;
    state.processed.add(gn);

    const channelId = `S${id}`;

    // ── Mettre à jour l'historique des parties (fenêtre de 15) ──────
    state.history.push([...suits]);
    if (state.history.length > 15) state.history.shift();

    // ── Résoudre les prédictions en attente + enregistrer les résultats ─
    await this._resolvePending(state.pending, channelId, gn, suits, pCards, bCards, (won, ps) => {
      state.lastOutcomes.push({ won, suit: ps });
      if (state.lastOutcomes.length > 10) state.lastOutcomes.shift();
    });

    const { threshold: B, mode, mappings, tg_targets, name, exceptions } = cfg;

    const emitPrediction = async (next, ps, suit) => {
      // ── Vérification des exceptions avant d'émettre ───────────────
      if (this._checkExceptions(exceptions, ps, suit, state)) return;

      // Enregistre en DB et n'envoie PAS via sendToStrategyChannels (stratégie custom)
      try {
        await db.createPrediction({ strategy: channelId, game_number: next, predicted_suit: ps, triggered_by: suit || null });
        console.log(`[${channelId}] Prédiction #${next} ${SUIT_DISPLAY[ps] || ps}`);
      } catch (e) { console.error(`createPrediction ${channelId} error:`, e.message); }
      state.pending[next] = { suit: ps, rattrapage: 0 };
      // Envoi avec token custom + stockage du message_id pour édition ultérieure
      if (Array.isArray(tg_targets) && tg_targets.length > 0) {
        await sendCustomAndStore(tg_targets, channelId, next, ps).catch(() => {});
      }
    };

    // Résout le pool de cartes cibles + rotation cyclique par index
    const resolvePredictedSuit = (suit) => {
      const raw = mappings[suit];
      // Supporte l'ancien format (string) et le nouveau (array)
      const pool = Array.isArray(raw) ? raw.filter(s => ALL_SUITS.includes(s))
                                      : (ALL_SUITS.includes(raw) ? [raw] : []);
      if (!pool.length) return null;
      if (pool.length === 1) return pool[0];
      // Rotation : on avance l'index à chaque prédiction pour cette carte
      if (!state.mappingIndex) state.mappingIndex = {};
      const idx = (state.mappingIndex[suit] || 0) % pool.length;
      state.mappingIndex[suit] = idx + 1;
      console.log(`[${channelId}] Rotation ${suit}: pool=[${pool.join(',')}] idx=${idx} → ${pool[idx]}`);
      return pool[idx];
    };

    if (mode === 'manquants') {
      for (const suit of ALL_SUITS) {
        if (suits.includes(suit)) { state.counts[suit] = 0; continue; }
        state.counts[suit] = (state.counts[suit] || 0) + 1;
        if (state.counts[suit] === B) {
          const ps = resolvePredictedSuit(suit);
          if (ps) await emitPrediction(gn + 1, ps, suit);
          state.counts[suit] = 0;
        }
      }
    } else if (mode === 'apparents') {
      for (const suit of ALL_SUITS) {
        if (suits.includes(suit)) {
          state.counts[suit] = (state.counts[suit] || 0) + 1;
          if (state.counts[suit] === B) {
            const ps = resolvePredictedSuit(suit);
            if (ps) await emitPrediction(gn + 1, ps, suit);
            state.counts[suit] = 0;
          }
        } else { state.counts[suit] = 0; }
      }
    }
  }

  async tick() {
    try {
      const games    = await fetchGames();
      const finished = games.filter(g => g.is_finished);
      let hadNew = false;
      if (finished.length > 0 && finished.some(g => !this.c1.processed.has(g.game_number))) {
        console.log(`[Engine] ${games.length} jeux chargés, ${finished.length} terminés`);
      }
      for (const game of games) {
        if (!game.is_finished) {
          if (!this._lastLiveLog || Date.now() - this._lastLiveLog > 30000) {
            console.log(`[Engine] Jeu ${game.game_number} en cours — phase: ${game.phase || '?'} | ${game.status_label || ''}`);
            this._lastLiveLog = Date.now();
          }
          continue;
        }
        const suits = extractSuits(game.player_cards || []);
        if (!suits.length) continue;
        if (!this.c1.processed.has(game.game_number)) {
          console.log(`[Engine] ✅ Traitement jeu #${game.game_number} | suits: ${suits.join(',')} | gagnant: ${game.winner || '?'}`);
          hadNew = true;
        }
        await this.processGame(game.game_number, suits, game.player_cards, game.banker_cards);
      }
      if (hadNew) await this.saveAbsences();
    } catch (e) { console.error('Engine tick error:', e.message); }
  }

  async cleanupStale() {
    try {
      const mx = await db.getMaxResolvedGame();
      if (mx <= 2) return;
      const count = await db.expireStaleByGame(mx - 2);
      if (count > 0) console.log(`🧹 ${count} prédiction(s) hors-fenêtre expirée(s)`);
    } catch (e) { console.error('cleanupStale error:', e.message); }
  }

  async loadExistingPending() {
    try {
      const rows = await db.getPredictions({ status: 'en_cours', limit: 500 });
      for (const row of rows) {
        const { strategy, game_number: gn, predicted_suit: ps, rattrapage: r } = row;
        const entry = { suit: ps, rattrapage: parseInt(r) || 0 };
        if      (strategy === 'C1') this.c1.pending[gn] = entry;
        else if (strategy === 'C2') this.c2.pending[gn] = entry;
        else if (strategy === 'C3') this.c3.pending[gn] = entry;
        else if (strategy === 'DC') this.dc.pending[gn] = entry;
        else if (strategy.startsWith('S') && !isNaN(parseInt(strategy.slice(1)))) {
          const id = parseInt(strategy.slice(1));
          if (!this.custom[id]) this.custom[id] = this._makeCustomState();
          this.custom[id].pending[gn] = entry;
        }
      }
      if (rows.length > 0) console.log(`[Engine] ${rows.length} prédiction(s) en_cours rechargée(s) en mémoire`);
    } catch (e) { console.error('loadExistingPending error:', e.message); }
  }

  async saveAbsences() {
    try {
      const state = { c1: this.c1.absences, c2: this.c2.absences, c3: this.c3.absences };
      for (const [id, s] of Object.entries(this.custom)) {
        state[`S${id}`]  = s.counts;
        state[`SI${id}`] = s.mappingIndex || {};
      }
      await db.setSetting('engine_absences', JSON.stringify(state));
    } catch (e) { console.error('saveAbsences error:', e.message); }
  }

  async loadAbsences() {
    try {
      const v = await db.getSetting('engine_absences');
      if (!v) return;
      const state = JSON.parse(v);
      if (state.c1) for (const s of ALL_SUITS) this.c1.absences[s] = state.c1[s] || 0;
      if (state.c2) for (const s of ALL_SUITS) this.c2.absences[s] = state.c2[s] || 0;
      if (state.c3) for (const s of ALL_SUITS) this.c3.absences[s] = state.c3[s] || 0;
      for (const [key, counts] of Object.entries(state)) {
        if (key.startsWith('SI')) {
          const id = parseInt(key.slice(2));
          if (this.custom[id]) {
            if (!this.custom[id].mappingIndex) this.custom[id].mappingIndex = {};
            for (const s of ALL_SUITS) this.custom[id].mappingIndex[s] = counts[s] || 0;
          }
        } else if (key.startsWith('S')) {
          const id = parseInt(key.slice(1));
          if (this.custom[id]) for (const s of ALL_SUITS) this.custom[id].counts[s] = counts[s] || 0;
        }
      }
      console.log('[Engine] ✅ Compteurs restaurés depuis la DB :', JSON.stringify({ c1: this.c1.absences, c2: this.c2.absences, c3: this.c3.absences }));
    } catch (e) { console.error('loadAbsences error:', e.message); }
  }

  async start(intervalMs = 5000) {
    if (this.running) return;
    this.running = true;
    console.log('🚀 Moteur de prédiction démarré');
    await this.loadCustomStrategies();
    await this.loadAbsences();
    await this.cleanupStale();
    await this.loadExistingPending();
    this.tick();
    this.interval = setInterval(() => this.tick(), intervalMs);
    setInterval(() => this.cleanupStale(), 60_000);
    setInterval(() => this.saveAbsences(), 30_000);
  }

  getAbsences(channelId) {
    const THRESHOLDS = { C1: 5, C2: 8, C3: 5 };
    const stateMap   = { C1: this.c1, C2: this.c2, C3: this.c3 };

    if (stateMap[channelId]) {
      const state     = stateMap[channelId];
      const threshold = THRESHOLDS[channelId] || 5;
      return ALL_SUITS.map(suit => ({
        suit, display: SUIT_DISPLAY[suit] || suit,
        count: state.absences[suit] || 0, threshold,
      }));
    }

    if (channelId.startsWith('S')) {
      const id    = parseInt(channelId.slice(1));
      const entry = this.custom[id];
      if (!entry?.config) return null;
      const { threshold, mode } = entry.config;
      return ALL_SUITS.map(suit => ({
        suit, display: SUIT_DISPLAY[suit] || suit,
        count: entry.counts[suit] || 0, threshold,
        mode, label: mode === 'apparents' ? 'Apparitions' : 'Absences',
      }));
    }
    return null;
  }

  updateMaxRattrapage(n) {
    console.log(`[Engine] Max rattrapage mis à jour → ${n}`);
    // getCurrentMaxRattrapage() dans telegram-service est déjà mis à jour
    // grâce à saveMaxRattrapage() appelé depuis admin.js
  }

  stop() {
    this.running = false;
    if (this.interval) clearInterval(this.interval);
    console.log('🔴 Moteur arrêté');
  }
}

module.exports = new Engine();
