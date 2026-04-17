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
  loadMaxRattrapage,
} = require('./telegram-service');
const renderSync = require('./render-sync');

const ALL_SUITS   = ['♠', '♥', '♦', '♣'];
const SUIT_DISPLAY = { '♠': '♠️', '♥': '❤️', '♦': '♦️', '♣': '♣️' };

const C1_B = 5;  const C1_MAP = { '♣':'♦','♦':'♣','♠':'♥','♥':'♠' };
const C2_B = 8;  const C2_MAP = { '♥':'♣','♣':'♥','♠':'♦','♦':'♠' };
const C3_B = 5;  const C3_MAP = { '♥':'♣','♣':'♥','♠':'♦','♦':'♠' };

const RAW_TO_SUIT = { '♠️':'♠','♣️':'♣','♦️':'♦','♥️':'♥','❤️':'♥' };

function normalizeSuit(s) {
  return RAW_TO_SUIT[s] || s.replace(/\ufe0f/g, '').replace('❤', '♥');
}

function extractSuits(cards) {
  const suits = new Set();
  for (const c of (cards || [])) {
    const n = normalizeSuit(c.S || '');
    if (ALL_SUITS.includes(n)) suits.add(n);
  }
  return [...suits];
}

async function savePrediction(strategy, gameNumber, predictedSuit, triggeredBy, customTg) {
  try {
    await db.createPrediction({ strategy, game_number: gameNumber, predicted_suit: predictedSuit, triggered_by: triggeredBy || null });
    console.log(`[${strategy}] Prédiction #${gameNumber} ${SUIT_DISPLAY[predictedSuit] || predictedSuit}`);
    // Extraire le format configuré sur ce canal (C1/C2/C3/DC)
    const tgOpts = { formatId: customTg?.tg_format ?? null };
    // Pour les stratégies globales (C1/C2/C3/DC), on route via sendToStrategyChannels.
    // Si la stratégie a un token+canal propre → on utilise sendCustomAndStore.
    if (!strategy.startsWith('S') || strategy === 'S') {
      if (customTg?.bot_token && customTg?.channel_id) {
        await sendCustomAndStore([customTg], strategy, gameNumber, predictedSuit, tgOpts).catch(() => {});
      } else {
        await sendToStrategyChannels(strategy, gameNumber, predictedSuit, tgOpts);
      }
    }
  } catch (e) { console.error('savePrediction error:', e.message); }
}

async function resolvePrediction(strategy, gameNumber, predictedSuit, status, rattrapage, playerCards, bankerCards, tgOpts = {}) {
  try {
    const now = new Date().toISOString();
    await db.updatePrediction(
      { strategy, game_number: gameNumber, predicted_suit: predictedSuit, status_filter: 'en_cours' },
      { status, rattrapage, resolved_at: now,
        player_cards: playerCards ? JSON.stringify(playerCards) : null,
        banker_cards: bankerCards ? JSON.stringify(bankerCards) : null,
      }
    );
    // Sync vers la base Render externe (si configurée)
    renderSync.syncVerifiedPrediction({
      strategy, game_number: gameNumber, predicted_suit: predictedSuit,
      status, rattrapage,
      player_cards: playerCards ? JSON.stringify(playerCards) : null,
      banker_cards: bankerCards ? JSON.stringify(bankerCards) : null,
      resolved_at: now,
    }).catch(() => {});
    // editStoredMessages gère les deux cas : token global ou token custom (bot_token stocké en DB)
    editStoredMessages(strategy, gameNumber, predictedSuit, status, rattrapage, tgOpts).catch(() => {});
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
    this.defaultStratTg = {}; // { C1: {bot_token, channel_id}, ... }

    this.lossStreaks        = {}; // { stratId: N }
    this.rattrapStreaks     = {}; // { stratId: { level: N } }
    this.comboCounters      = {}; // { stratId: { level: N } }
    this.relanceCondCounters = {}; // { `${relanceId}_${sourceId}_D/E`: N } — compteurs conditions D et E
    this.lossSequences  = []; // chargé depuis la DB
    this.gameCardsCache = {}; // { gameNumber: { player: ['♥','♦','♠'], banker: ['♣','♥'] } }

    for (const s of ALL_SUITS) {
      this.c1.absences[s] = 0;
      this.c2.absences[s] = 0;
      this.c3.absences[s] = 0;
    }
  }

  _makeCustomState() {
    const counts = {};
    const mappingIndex = {};
    const mirrorCounts = {};
    for (const s of ALL_SUITS) { counts[s] = 0; mappingIndex[s] = 0; mirrorCounts[s] = 0; }
    return { counts, processed: new Set(), pending: {}, history: [], lastOutcomes: [], mappingIndex, mirrorCounts, mirrorLastHour: null };
  }

  async loadLossSequences() {
    try {
      const v = await db.getSetting('loss_sequences');
      this.lossSequences = v ? JSON.parse(v) : [];
      console.log(`[Engine] ${this.lossSequences.length} séquence(s) de relance chargée(s)`);
    } catch (e) { console.error('loadLossSequences error:', e.message); }
  }

  // Appelé après chaque prédiction PERDUE — met à jour le streak et vérifie les séquences
  _onStratLoss(stratId, gn, suit) {
    this.lossStreaks[stratId] = (this.lossStreaks[stratId] || 0) + 1;
    const streak = this.lossStreaks[stratId];

    // Une perte brise les rattrapages consécutifs
    if (!this.rattrapStreaks[stratId]) this.rattrapStreaks[stratId] = {};
    for (const lv of [1,2,3,4,5]) this.rattrapStreaks[stratId][lv] = 0;

    // Une perte compte dans les compteurs combo pour tous les niveaux
    if (!this.comboCounters[stratId]) this.comboCounters[stratId] = {};
    for (const lv of [1,2,3,4,5]) {
      this.comboCounters[stratId][lv] = (this.comboCounters[stratId][lv] || 0) + 1;
    }

    // Séquences de relance (legacy lossSequences)
    for (const seq of this.lossSequences) {
      if (!seq.enabled) continue;
      for (const rule of (seq.rules || [])) {
        if (rule.strategy_id !== stratId) continue;
        const thr = parseInt(rule.losses_threshold) || 1;
        if (streak >= thr) {
          console.log(`[Séquence] "${seq.name}" → ${stratId} ${streak} perte(s) (seuil ${thr}) → relance #${gn + 1}`);
          this.lossStreaks[stratId] = 0;
          this._forceNextPrediction(stratId, gn + 1, suit);
        }
      }
    }

    // Stratégies mode='relance'
    for (const [rid, rstate] of Object.entries(this.custom)) {
      const rcfg = rstate.config;
      if (!rcfg?.enabled || rcfg.mode !== 'relance') continue;
      for (const rule of (rcfg.relance_rules || [])) {
        if (rule.strategy_id !== stratId) continue;
        const relanceId = `S${rid}`;
        let fired = false;

        // Condition A : pertes consécutives
        const lThr = rule.losses_threshold != null ? parseInt(rule.losses_threshold) : null;
        if (!fired && lThr !== null && streak >= lThr) {
          fired = true;
          console.log(`[Relance] "${rcfg.name}" → ${stratId} ${streak} perte(s) (seuil ${lThr}) → ${relanceId} #${gn + 1}`);
          this.lossStreaks[stratId] = 0;
        }

        // Condition C : combo perte+Rn
        const cLevel = rule.combo_level != null ? parseInt(rule.combo_level) : null;
        const cCount = parseInt(rule.combo_count) || 1;
        if (!fired && cLevel !== null) {
          const cur = (this.comboCounters[stratId] || {})[cLevel] || 0;
          if (cur >= cCount) {
            fired = true;
            console.log(`[Relance] "${rcfg.name}" → ${stratId} combo R${cLevel} ×${cur} (seuil ×${cCount}) → ${relanceId} #${gn + 1}`);
            this.comboCounters[stratId][cLevel] = 0;
          }
        }

        // Reset compteurs D et E sur perte (séquence brisée)
        const kD = `${relanceId}_${stratId}_D`;
        const kE = `${relanceId}_${stratId}_E`;
        if (!fired) {
          if (rule.range_from    != null) this.relanceCondCounters[kD] = 0;
          if (rule.interval_min  != null) this.relanceCondCounters[kE] = 0;
        }

        if (fired) this._forceNextPrediction(relanceId, gn + 1, suit);
      }
    }
  }

  // Réinitialise les streaks de pertes après un gain
  _onStratWin(stratId) {
    this.lossStreaks[stratId] = 0;
  }

  // Appelé quand une prédiction est gagnée avec N rattrapages
  _onStratRattrapage(stratId, gn, suit, R) {
    // Suivi rattrapages consécutifs par niveau
    if (!this.rattrapStreaks[stratId]) this.rattrapStreaks[stratId] = {};
    for (const lv of [1,2,3,4,5]) {
      if (lv !== R) this.rattrapStreaks[stratId][lv] = 0; // brise les autres niveaux
    }
    this.rattrapStreaks[stratId][R] = (this.rattrapStreaks[stratId][R] || 0) + 1;
    const rStreak = this.rattrapStreaks[stratId][R];

    // Un gain avec Rn compte aussi dans le compteur combo pour ce niveau
    if (!this.comboCounters[stratId]) this.comboCounters[stratId] = {};
    this.comboCounters[stratId][R] = (this.comboCounters[stratId][R] || 0) + 1;

    for (const [rid, rstate] of Object.entries(this.custom)) {
      const rcfg = rstate.config;
      if (!rcfg?.enabled || rcfg.mode !== 'relance') continue;
      for (const rule of (rcfg.relance_rules || [])) {
        if (rule.strategy_id !== stratId) continue;
        const relanceId = `S${rid}`;
        let fired = false;

        // Condition B : rattrapages consécutifs
        const rLevel = rule.rattrapage_level != null ? parseInt(rule.rattrapage_level) : null;
        const rCount = parseInt(rule.rattrapage_count) || 1;
        if (!fired && rLevel !== null && rLevel === R && rStreak >= rCount) {
          fired = true;
          console.log(`[Relance] "${rcfg.name}" → ${stratId} R${R} consécutif ×${rStreak} (seuil ×${rCount}) → ${relanceId} #${gn + 1}`);
          this.rattrapStreaks[stratId][R] = 0;
        }

        // Condition C : combo perte+Rn
        const cLevel = rule.combo_level != null ? parseInt(rule.combo_level) : null;
        const cCount = parseInt(rule.combo_count) || 1;
        if (!fired && cLevel !== null && cLevel === R) {
          const cur = (this.comboCounters[stratId] || {})[R] || 0;
          if (cur >= cCount) {
            fired = true;
            console.log(`[Relance] "${rcfg.name}" → ${stratId} combo R${R} ×${cur} (seuil ×${cCount}) → ${relanceId} #${gn + 1}`);
            this.comboCounters[stratId][R] = 0;
          }
        }

        // Condition D : à partir de tel rattrapage (R >= range_from)
        const rFrom  = rule.range_from  != null ? parseInt(rule.range_from)  : null;
        const dCount = parseInt(rule.range_count) || 1;
        if (!fired && rFrom !== null && R >= rFrom) {
          const kD = `${relanceId}_${stratId}_D`;
          this.relanceCondCounters[kD] = (this.relanceCondCounters[kD] || 0) + 1;
          const cur = this.relanceCondCounters[kD];
          if (cur >= dCount) {
            fired = true;
            this.relanceCondCounters[kD] = 0;
            console.log(`[Relance-D] "${rcfg.name}" → ${stratId} R${R}≥R${rFrom} ×${cur} (seuil ×${dCount}) → ${relanceId} #${gn + 1}`);
          }
        }

        // Condition E : intervalle de rattrapage (iMin <= R <= iMax)
        const iMin   = rule.interval_min != null ? parseInt(rule.interval_min) : null;
        const iMax   = rule.interval_max != null ? parseInt(rule.interval_max) : null;
        const eCount = parseInt(rule.interval_count) || 1;
        if (!fired && iMin !== null && iMax !== null && R >= iMin && R <= iMax) {
          const kE = `${relanceId}_${stratId}_E`;
          this.relanceCondCounters[kE] = (this.relanceCondCounters[kE] || 0) + 1;
          const cur = this.relanceCondCounters[kE];
          if (cur >= eCount) {
            fired = true;
            this.relanceCondCounters[kE] = 0;
            console.log(`[Relance-E] "${rcfg.name}" → ${stratId} R${iMin}≤R${R}≤R${iMax} ×${cur} (seuil ×${eCount}) → ${relanceId} #${gn + 1}`);
          }
        }

        if (fired) this._forceNextPrediction(relanceId, gn + 1, suit);
      }
    }
  }

  // Retourne les compteurs relance pour l'API /relance-status
  getRelanceStatus() {
    const out = {};
    for (const [rid, rstate] of Object.entries(this.custom)) {
      const rcfg = rstate.config;
      if (!rcfg?.enabled || rcfg.mode !== 'relance') continue;
      const relanceId = `S${rid}`;
      out[relanceId] = { name: rcfg.name, sources: [] };
      for (const rule of (rcfg.relance_rules || [])) {
        const srcId = rule.strategy_id;
        const srcName = this.custom[srcId.replace('S','')]?.config?.name || srcId;
        const entry = { id: srcId, name: srcName };
        if (rule.losses_threshold != null)
          entry.A = { cur: this.lossStreaks[srcId] || 0, thr: parseInt(rule.losses_threshold) };
        if (rule.rattrapage_level != null)
          entry.B = { cur: (this.rattrapStreaks[srcId] || {})[parseInt(rule.rattrapage_level)] || 0, thr: parseInt(rule.rattrapage_count) || 1, lvl: parseInt(rule.rattrapage_level) };
        if (rule.combo_level != null)
          entry.C = { cur: (this.comboCounters[srcId] || {})[parseInt(rule.combo_level)] || 0, thr: parseInt(rule.combo_count) || 1, lvl: parseInt(rule.combo_level) };
        if (rule.range_from != null)
          entry.D = { cur: this.relanceCondCounters[`${relanceId}_${srcId}_D`] || 0, thr: parseInt(rule.range_count) || 1, from: parseInt(rule.range_from) };
        if (rule.interval_min != null)
          entry.E = { cur: this.relanceCondCounters[`${relanceId}_${srcId}_E`] || 0, thr: parseInt(rule.interval_count) || 1, min: parseInt(rule.interval_min), max: parseInt(rule.interval_max) };
        out[relanceId].sources.push(entry);
      }
    }
    return out;
  }

  // Injecte une prédiction forcée (relance) sur le prochain jeu
  _forceNextPrediction(stratId, nextGn, suit) {
    if (!suit) return;
    const globalMaxR = getCurrentMaxRattrapage();
    if (stratId === 'C1' || stratId === 'C2' || stratId === 'C3' || stratId === 'DC') {
      const customTg = this.defaultStratTg[stratId] || {};
      savePrediction(stratId, nextGn, suit, suit, customTg.bot_token ? customTg : null);
      if (stratId === 'C1') this.c1.pending[nextGn] = { suit, rattrapage: 0, maxR: globalMaxR };
      else if (stratId === 'C2') this.c2.pending[nextGn] = { suit, rattrapage: 0, maxR: globalMaxR };
      else if (stratId === 'C3') this.c3.pending[nextGn] = { suit, rattrapage: 0, maxR: globalMaxR };
      else if (stratId === 'DC') this.dc.pending[nextGn] = { suit, rattrapage: 0, maxR: globalMaxR };
    } else if (stratId.startsWith('S')) {
      const id = parseInt(stratId.slice(1));
      const state = this.custom[id];
      if (!state || !state.config?.enabled) return;
      if (Object.keys(state.pending).length > 0) return; // déjà en attente
      // Calcul du maxR effectif : priorité à la config de la stratégie, sinon global
      const stratMaxR = (state.config.max_rattrapage !== undefined && state.config.max_rattrapage !== null)
        ? parseInt(state.config.max_rattrapage) : globalMaxR;
      const tgs = Array.isArray(state.config.tg_targets) ? state.config.tg_targets : [];
      db.createPrediction({ strategy: stratId, game_number: nextGn, predicted_suit: suit, triggered_by: suit }).catch(() => {});
      // Stocker maxR dans le pending pour que la résolution utilise la même valeur
      state.pending[nextGn] = { suit, rattrapage: 0, maxR: stratMaxR };
      const stratTgOpts = { formatId: state.config.tg_format || null, hand: state.config.hand || 'joueur', maxR: stratMaxR };
      if (tgs.length > 0) {
        sendCustomAndStore(tgs, stratId, nextGn, suit, stratTgOpts).catch(() => {});
      } else {
        sendToStrategyChannels(stratId, nextGn, suit, stratTgOpts).catch(() => {});
      }
    }
  }

  reloadCustomStrategies(list) {
    for (const cfg of list) {
      if (!this.custom[cfg.id]) {
        // Nouvelle stratégie : initialiser l'état complet
        const s = this._makeCustomState();
        s.needsInit = true;
        this.custom[cfg.id] = s;
      }
      // Ne PAS remettre les compteurs à 0 pour les stratégies existantes
      // (sinon on perd la progression des absences/apparitions)
      this.custom[cfg.id].config = cfg;
      console.log(`[S${cfg.id}] "${cfg.name}" rechargée: mode=${cfg.mode}, B=${cfg.threshold}, hand=${cfg.hand || 'joueur'}, enabled=${cfg.enabled}`);
    }
    const ids = new Set(list.map(c => c.id));
    for (const id of Object.keys(this.custom)) {
      if (!ids.has(parseInt(id))) {
        console.log(`[Engine] Stratégie S${id} supprimée de la mémoire`);
        delete this.custom[id];
      }
    }
  }

  async loadCustomStrategies() {
    try {
      const v = await db.getSetting('custom_strategies');
      if (!v) return;
      const parsed = JSON.parse(v);
      const list = Array.isArray(parsed) ? parsed : [parsed];
      for (const cfg of list) {
        this.custom[cfg.id] = this._makeCustomState();
        this.custom[cfg.id].config = cfg;
        console.log(`[S${cfg.id}] "${cfg.name}" chargée (mode=${cfg.mode}, B=${cfg.threshold})`);
      }
    } catch (e) { console.error('loadCustomStrategies error:', e.message); }
  }

  async processGame(gn, suits, bSuits, pCards, bCards) {
    this.gameCardsCache[gn] = { player: suits || [], banker: bSuits || [] };
    const cacheKeys = Object.keys(this.gameCardsCache).map(Number).sort((a, b) => a - b);
    while (cacheKeys.length > 100) { delete this.gameCardsCache[cacheKeys.shift()]; }

    await this._processC1(gn, suits, pCards, bCards);
    await this._processC2(gn, suits, pCards, bCards);
    await this._processC3(gn, suits, pCards, bCards);
    await this._processDC(gn, suits, pCards, bCards);
    // Passe 1 : stratégies simples (hors multi_strategy et relance)
    for (const [id, state] of Object.entries(this.custom)) {
      if (state.config?.enabled && state.config?.mode !== 'multi_strategy' && state.config?.mode !== 'relance') {
        await this._processCustomStrategy(parseInt(id), state, state.config, gn, suits, bSuits, pCards, bCards);
      }
    }
    // Passe 2 : stratégies combinaison (peuvent lire les pending des simples)
    for (const [id, state] of Object.entries(this.custom)) {
      if (state.config?.enabled && state.config?.mode === 'multi_strategy') {
        await this._processMultiStrategy(parseInt(id), state, state.config, gn, suits, bSuits, pCards, bCards);
      }
    }
    // Passe 3 : stratégies relance (résolution de pending uniquement — le déclenchement se fait via _onStratLoss)
    for (const [id, state] of Object.entries(this.custom)) {
      if (state.config?.enabled && state.config?.mode === 'relance') {
        await this._processRelanceStrategy(parseInt(id), state, state.config, gn, suits, bSuits, pCards, bCards);
      }
    }
  }

  async _processMultiStrategy(id, state, cfg, gn, suits, bSuits, pCards, bCards) {
    if (!this.custom[id]) return;
    const channelId = `S${id}`;
    const handSuits = cfg.hand === 'banquier' ? (bSuits || []) : suits;
    const stratMaxR = (cfg.max_rattrapage !== undefined && cfg.max_rattrapage !== null)
      ? parseInt(cfg.max_rattrapage) : getCurrentMaxRattrapage();
    const stratTgOpts = { formatId: cfg.tg_format || null, hand: cfg.hand || 'joueur', maxR: stratMaxR };

    if (Object.keys(state.pending).length > 0) {
      await this._resolvePending(state.pending, channelId, gn, handSuits, pCards, bCards, (won, ps, pg, rattrapR) => {
        state.lastOutcomes.push({ won, suit: ps });
        if (state.lastOutcomes.length > 10) state.lastOutcomes.shift();
        if (won) {
          this._onStratWin(channelId);
          if (rattrapR > 0) this._onStratRattrapage(channelId, gn, ps, rattrapR);
        } else {
          this._onStratLoss(channelId, gn, ps);
        }
      }, stratMaxR, stratTgOpts);
    }

    if (state.processed.has(gn)) return;
    state.processed.add(gn);
    state.history.push([...handSuits]);
    if (state.history.length > 15) state.history.shift();

    if (Object.keys(state.pending).length > 0) return;

    const sources    = Array.isArray(cfg.multi_source_ids) ? cfg.multi_source_ids : [];
    const matchMode  = cfg.multi_require || 'any';
    const offset     = Math.max(1, parseInt(cfg.prediction_offset) || 1);
    const targetGame = gn + offset;

    // Resolve pending dict for any source ID (built-in or custom)
    const _pendingFor = (sid) => {
      const k = String(sid).toUpperCase();
      if (k === 'C1') return this.c1.pending;
      if (k === 'C2') return this.c2.pending;
      if (k === 'C3') return this.c3.pending;
      if (k === 'DC') return this.dc.pending;
      const numId = parseInt(sid.toString().replace(/^S/i, ''));
      return this.custom[numId]?.pending || null;
    };

    // Collect predictions emitted by source strategies for targetGame
    const signals = [];
    for (const srcId of sources) {
      const pend = _pendingFor(srcId);
      if (!pend) continue;
      const pred = pend[targetGame];
      if (pred) signals.push({ suit: pred.suit, srcId });
    }

    let triggered = false;
    const activeSources = sources.filter(sid => _pendingFor(sid) !== null).length;
    if (matchMode === 'all' && signals.length === activeSources && signals.length > 0) {
      triggered = true;
    } else if (matchMode === 'any' && signals.length > 0) {
      triggered = true;
    }

    if (!triggered) return;

    // Use the most common predicted suit among signals
    const suitVotes = {};
    for (const s of signals) { suitVotes[s.suit] = (suitVotes[s.suit] || 0) + 1; }
    const ps = Object.entries(suitVotes).sort((a,b) => b[1]-a[1])[0][0];

    try {
      await db.createPrediction({ strategy: channelId, game_number: targetGame, predicted_suit: ps, triggered_by: `multi:${signals.map(s=>s.srcId).join(',')}` });
      console.log(`[${channelId}] Multi-strat prédiction #${targetGame} ${SUIT_DISPLAY[ps]||ps} (${matchMode}, sources: ${signals.map(s=>s.srcId).join(',')})`);
    } catch (e) { console.error(`createPrediction ${channelId} error:`, e.message); }
    state.pending[targetGame] = { suit: ps, rattrapage: 0, maxR: stratMaxR };

    const tgs = Array.isArray(cfg.tg_targets) ? cfg.tg_targets.filter(t => t.bot_token && t.channel_id) : [];
    if (tgs.length > 0) {
      sendCustomAndStore(tgs, channelId, targetGame, ps, stratTgOpts).catch(() => {});
    } else {
      sendToStrategyChannels(channelId, targetGame, ps, stratTgOpts).catch(() => {});
    }
  }

  async _processRelanceStrategy(id, state, cfg, gn, suits, bSuits, pCards, bCards) {
    if (!this.custom[id]) return;
    const channelId = `S${id}`;
    const handSuits = cfg.hand === 'banquier' ? (bSuits || []) : suits;
    const stratMaxR = (cfg.max_rattrapage !== undefined && cfg.max_rattrapage !== null)
      ? parseInt(cfg.max_rattrapage) : getCurrentMaxRattrapage();
    const stratTgOpts = { formatId: cfg.tg_format || null, hand: cfg.hand || 'joueur', maxR: stratMaxR };
    if (Object.keys(state.pending).length > 0) {
      await this._resolvePending(state.pending, channelId, gn, handSuits, pCards, bCards, (won, ps) => {
        state.lastOutcomes.push({ won, suit: ps });
        if (state.lastOutcomes.length > 10) state.lastOutcomes.shift();
        // Ne pas déclencher de relance en cascade depuis une stratégie relance elle-même
      }, stratMaxR, stratTgOpts);
    }
  }

  async _resolvePending(pending, strategy, gn, suits, pCards, bCards, onLoss, maxR = null, tgOpts = {}) {
    if (maxR === null) maxR = getCurrentMaxRattrapage();
    for (const [pg, info] of Object.entries(pending)) {
      const pgNum = parseInt(pg);
      const ps    = info.suit;
      if (pgNum > gn) continue;

      // Utilise le maxR stocké dans la prédiction au moment de son émission.
      // Cela garantit qu'un changement de config après l'émission n'affecte
      // pas les prédictions déjà en cours.
      const effectiveMaxR = (info.maxR !== undefined && info.maxR !== null) ? info.maxR : maxR;

      if (gn > pgNum + effectiveMaxR) {
        await resolvePrediction(strategy, pgNum, ps, 'perdu', effectiveMaxR, pCards, bCards, tgOpts);
        delete pending[pg];
        if (onLoss) onLoss(false, ps, pgNum);
        continue;
      }

      // ── Résolution spéciale mode Distribution ──────────────────────────
      if (ps === 'distrib') {
        const isNatural = Array.isArray(pCards) && Array.isArray(bCards)
          && pCards.length === 2 && bCards.length === 2;
        if (isNatural) {
          const rattrapage = gn - pgNum;
          console.log(`[${strategy}] [Distribution] Jeu #${gn} = naturel (2P+2B) → gagne (R${rattrapage})`);
          await resolvePrediction(strategy, pgNum, ps, 'gagne', rattrapage, pCards, bCards, tgOpts);
          delete pending[pg];
          if (onLoss) onLoss(true, ps, pgNum, rattrapage);
        } else if (gn === pgNum + effectiveMaxR) {
          console.log(`[${strategy}] [Distribution] Jeu #${gn} = non-naturel après ${effectiveMaxR} tentatives → perdu`);
          await resolvePrediction(strategy, pgNum, ps, 'perdu', effectiveMaxR, pCards, bCards, tgOpts);
          delete pending[pg];
          if (onLoss) onLoss(false, ps, pgNum, effectiveMaxR);
        }
        continue;
      }

      if (suits.includes(ps)) {
        const rattrapage = gn - pgNum;
        await resolvePrediction(strategy, pgNum, ps, 'gagne', rattrapage, pCards, bCards, tgOpts);
        delete pending[pg];
        if (onLoss) onLoss(true, ps, pgNum, rattrapage);
      } else if (gn === pgNum + effectiveMaxR) {
        await resolvePrediction(strategy, pgNum, ps, 'perdu', effectiveMaxR, pCards, bCards, tgOpts);
        delete pending[pg];
        if (onLoss) onLoss(false, ps, pgNum, effectiveMaxR);
      }
    }
  }

  async _processC1(gn, suits, pCards, bCards) {
    if (this.c1.processed.has(gn)) return;
    this.c1.processed.add(gn);
    await this._resolvePending(this.c1.pending, 'C1', gn, suits, pCards, bCards, (won, suit, pg, rattrapR) => {
      if (won) { this.c1.consecLosses = 0; this._onStratWin('C1'); if (rattrapR > 0) this._onStratRattrapage('C1', gn, suit, rattrapR); return; }
      this.c1.consecLosses++;
      this._onStratLoss('C1', gn, suit);
      if (this.c1.consecLosses >= 2) {
        this.c1.consecLosses = 0;
        const next = gn + 1;
        savePrediction('DC', next, suit, suit, this.defaultStratTg['DC']);
        this.dc.pending[next] = { suit, rattrapage: 0, maxR: getCurrentMaxRattrapage() };
      }
    });
    for (const suit of ALL_SUITS) {
      if (suits.includes(suit)) { this.c1.absences[suit] = 0; continue; }
      this.c1.absences[suit] = (this.c1.absences[suit] || 0) + 1;
      if (this.c1.absences[suit] === C1_B) {
        const ps = C1_MAP[suit]; const next = gn + 1;
        await savePrediction('C1', next, ps, suit, this.defaultStratTg['C1']);
        this.c1.pending[next] = { suit: ps, rattrapage: 0, maxR: getCurrentMaxRattrapage() };
        this.c1.absences[suit] = 0;
      }
    }
  }

  async _processC2(gn, suits, pCards, bCards) {
    if (this.c2.processed.has(gn)) return;
    this.c2.processed.add(gn);
    await this._resolvePending(this.c2.pending, 'C2', gn, suits, pCards, bCards, (won, suit, pg, rattrapR) => {
      if (won) { this.c2.hadFirstLoss = false; this._onStratWin('C2'); if (rattrapR > 0) this._onStratRattrapage('C2', gn, suit, rattrapR); return; }
      if (!this.c2.hadFirstLoss) { this.c2.hadFirstLoss = true; return; }
      this.c2.hadFirstLoss = false;
      this._onStratLoss('C2', gn, suit);
      const next = gn + 1;
      savePrediction('DC', next, suit, suit, this.defaultStratTg['DC']);
      this.dc.pending[next] = { suit, rattrapage: 0, maxR: getCurrentMaxRattrapage() };
    });
    for (const suit of ALL_SUITS) {
      if (suits.includes(suit)) { this.c2.absences[suit] = 0; continue; }
      this.c2.absences[suit] = (this.c2.absences[suit] || 0) + 1;
      if (this.c2.absences[suit] === C2_B) {
        const ps = C2_MAP[suit]; const next = gn + 1;
        await savePrediction('C2', next, ps, suit, this.defaultStratTg['C2']);
        this.c2.pending[next] = { suit: ps, rattrapage: 0, maxR: getCurrentMaxRattrapage() };
        this.c2.absences[suit] = 0;
      }
    }
  }

  async _processC3(gn, suits, pCards, bCards) {
    if (this.c3.processed.has(gn)) return;
    this.c3.processed.add(gn);
    await this._resolvePending(this.c3.pending, 'C3', gn, suits, pCards, bCards, (won, suit, pg, rattrapR) => {
      if (won) { this.c3.consecLosses = 0; this._onStratWin('C3'); if (rattrapR > 0) this._onStratRattrapage('C3', gn, suit, rattrapR); return; }
      this.c3.consecLosses++;
      this._onStratLoss('C3', gn, suit);
      if (this.c3.consecLosses >= 2) {
        this.c3.consecLosses = 0;
        const next = gn + 1;
        savePrediction('DC', next, suit, suit, this.defaultStratTg['DC']);
        this.dc.pending[next] = { suit, rattrapage: 0, maxR: getCurrentMaxRattrapage() };
      }
    });
    for (const suit of ALL_SUITS) {
      if (suits.includes(suit)) { this.c3.absences[suit] = 0; continue; }
      this.c3.absences[suit] = (this.c3.absences[suit] || 0) + 1;
      if (this.c3.absences[suit] === C3_B) {
        const ps = C3_MAP[suit]; const next = gn + 1;
        await savePrediction('C3', next, ps, suit, this.defaultStratTg['C3']);
        this.c3.pending[next] = { suit: ps, rattrapage: 0, maxR: getCurrentMaxRattrapage() };
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
        this._onStratWin('DC');
        if (info.rattrapage > 0) this._onStratRattrapage('DC', gn, ps, info.rattrapage);
      } else if (gn > pgNum) {
        if (info.rattrapage < maxR) { info.rattrapage++; }
        else {
          await resolvePrediction('DC', pgNum, ps, 'perdu', info.rattrapage, pCards, bCards);
          delete this.dc.pending[pg];
          this._onStratLoss('DC', gn, ps);
        }
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

        // ── 7. Fenêtre horaire — bloque pendant la 1re ou 2e moitié de l'heure ─
        case 'time_window_block': {
          const nowMin  = new Date().getMinutes();
          const half    = ex.half || 'second';
          const blocked = half === 'first' ? (nowMin < 30) : (nowMin >= 30);
          if (blocked) {
            console.log(`[Exception] time_window_block(${half}): ${nowMin}min → bloqué`);
            return true;
          }
          break;
        }

        // ── 8. Intervalle de minutes précis dans l'heure ──────────────
        // ex: from=0,to=10 bloque H:00–H:10 / from=10,to=20 bloque H:10–H:20
        case 'minute_interval_block': {
          const nowMin = new Date().getMinutes();
          const from   = Math.max(0,  parseInt(ex.from) || 0);
          const to     = Math.min(59, parseInt(ex.to)   || 10);
          if (nowMin >= from && nowMin <= to) {
            console.log(`[Exception] minute_interval_block(${from}–${to}): ${nowMin}min → bloqué`);
            return true;
          }
          break;
        }

        // ── 9. Historique insuffisant ──────────────────────────────────
        case 'min_history': {
          const n = Math.max(1, parseInt(ex.value) || 5);
          if (state.history.length < n) {
            console.log(`[Exception] min_history(${n}): seulement ${state.history.length} parties → bloqué`);
            return true;
          }
          break;
        }

        // ── 10. Série de victoires consécutives ───────────────────────
        case 'consec_wins': {
          const n = Math.max(1, parseInt(ex.value) || 3);
          if (state.lastOutcomes.length < n) break;
          const recent = state.lastOutcomes.slice(-n);
          if (recent.every(o => o.won)) {
            console.log(`[Exception] consec_wins(${n}): ${n} victoires consécutives → bloqué`);
            return true;
          }
          break;
        }

        // ── 11. Carte prédite absente depuis trop longtemps ───────────
        case 'suit_absent_long': {
          const n = Math.max(1, parseInt(ex.value) || 5);
          if (state.history.length < n) break;
          const recent = state.history.slice(-n);
          const allAbsent = recent.every(g => !g.includes(predictedSuit));
          if (allAbsent) {
            console.log(`[Exception] suit_absent_long(${n}): ${predictedSuit} absent ${n} dernières parties → bloqué`);
            return true;
          }
          break;
        }

        // ── 12. Taux de victoire récent déjà très élevé ───────────────
        case 'high_win_rate': {
          const n = Math.max(1, parseInt(ex.value)  || 4);
          const w = Math.max(2, parseInt(ex.window) || 5);
          if (state.lastOutcomes.length < 2) break;
          const recent = state.lastOutcomes.slice(-Math.min(w, state.lastOutcomes.length));
          const wins   = recent.filter(o => o.won).length;
          if (wins >= n) {
            console.log(`[Exception] high_win_rate(${n}/${w}): ${wins} victoires → bloqué`);
            return true;
          }
          break;
        }

        // ── 13. Trop de prédictions en attente simultanées ────────────
        case 'pending_overload': {
          const n = Math.max(1, parseInt(ex.value) || 2);
          const pendingCount = Object.keys(state.pending).length;
          if (pendingCount >= n) {
            console.log(`[Exception] pending_overload(${n}): ${pendingCount} en attente → bloqué`);
            return true;
          }
          break;
        }

        // ── 14. Parité du numéro de jeu ───────────────────────────────
        case 'game_parity': {
          const parity = ex.parity || 'even';
          const gNum   = state.history.length;
          const isEven = (gNum % 2 === 0);
          if ((parity === 'even' && isEven) || (parity === 'odd' && !isEven)) {
            console.log(`[Exception] game_parity(${parity}): jeu #${gNum} → bloqué`);
            return true;
          }
          break;
        }

        // ── 15. Même costume dominant N parties consécutives ──────────
        case 'dominant_streak': {
          const n = Math.max(2, parseInt(ex.value) || 3);
          if (state.history.length < n) break;
          const recent = state.history.slice(-n);
          const allSame = recent.every(g => g.includes(predictedSuit));
          if (allSame) {
            console.log(`[Exception] dominant_streak(${n}): ${predictedSuit} présent dans les ${n} dernières → bloqué`);
            return true;
          }
          break;
        }

        // ── 16. Démarrage à froid — bloque les N premières parties ────
        case 'cold_start': {
          const n = Math.max(1, parseInt(ex.value) || 10);
          if (state.history.length < n) {
            console.log(`[Exception] cold_start(${n}): seulement ${state.history.length} parties jouées → bloqué`);
            return true;
          }
          break;
        }

        // ── 17. Tranche horaire de la journée ─────────────────────────
        // Bloque entre from_hour (inclus) et to_hour (exclu)
        case 'bad_hour': {
          const nowH     = new Date().getHours();
          const fromH    = Math.max(0,  parseInt(ex.from_hour) || 0);
          const toH      = Math.min(23, parseInt(ex.to_hour)   || 6);
          const blocked  = fromH <= toH
            ? (nowH >= fromH && nowH < toH)
            : (nowH >= fromH || nowH < toH); // chevauchement minuit
          if (blocked) {
            console.log(`[Exception] bad_hour(${fromH}h–${toH}h): il est ${nowH}h → bloqué`);
            return true;
          }
          break;
        }

        // ── 18. Dernier jeu contenait la prédite ET le déclencheur ───
        case 'double_suit_last': {
          if (state.history.length < 1) break;
          const last = state.history[state.history.length - 1];
          if (last.includes(predictedSuit) && last.includes(triggerSuit)) {
            console.log(`[Exception] double_suit_last: dernier jeu avait ${predictedSuit} + ${triggerSuit} → bloqué`);
            return true;
          }
          break;
        }

        // ── 19. Pause après série de défaites ────────────────────────
        // Bloque pendant `pause` jeux après K défaites consécutives
        case 'loss_streak_pause': {
          const k     = Math.max(1, parseInt(ex.value)  || 3);
          const pause = Math.max(1, parseInt(ex.window) || 2);
          if (state.lastOutcomes.length < k) break;
          const tail  = state.lastOutcomes.slice(-k);
          if (tail.every(o => !o.won)) {
            const totalGames = state.history.length;
            const lastLossIdx = state.lastOutcomes.length - 1;
            const gamesSinceLoss = totalGames - (lastLossIdx + 1);
            if (gamesSinceLoss < pause) {
              console.log(`[Exception] loss_streak_pause(${k} défaites, pause ${pause}): ${gamesSinceLoss} jeu(x) depuis dernière perte → bloqué`);
              return true;
            }
          }
          break;
        }

        default: break;
      }
    }
    return false;
  }

  async _processCustomStrategy(id, state, cfg, gn, suits, bSuits, pCards, bCards) {
    // Stratégie supprimée entre le début du tick et maintenant → on ignore
    if (!this.custom[id]) return;

    const channelId = `S${id}`;

    // Détermine quelle main surveiller selon la config
    const handSuits = cfg.hand === 'banquier' ? (bSuits || []) : suits;

    // ── Résoudre les prédictions en attente AVANT le check "déjà traité" ──
    // Important : même si ce jeu a déjà été traité pour la logique de déclenchement
    // (ex. après _initializeNewStrategies), il faut quand même résoudre les prédictions
    // en attente contre lui, sinon elles restent bloquées jusqu'à expiration (❌).
    const stratMaxRForResolve = (cfg.max_rattrapage !== undefined && cfg.max_rattrapage !== null)
      ? parseInt(cfg.max_rattrapage)
      : getCurrentMaxRattrapage();

    // Options Telegram propres à cette stratégie (format + main + maxR)
    const stratTgOpts = {
      formatId: cfg.tg_format   || null,
      hand:     cfg.hand        || 'joueur',
      maxR:     stratMaxRForResolve,
    };

    if (Object.keys(state.pending).length > 0) {
      await this._resolvePending(state.pending, channelId, gn, handSuits, pCards, bCards, (won, ps) => {
        state.lastOutcomes.push({ won, suit: ps });
        if (state.lastOutcomes.length > 10) state.lastOutcomes.shift();
        if (won) this._onStratWin(channelId);
        else this._onStratLoss(channelId, gn, ps);
      }, stratMaxRForResolve, stratTgOpts);
    }

    // ── Logique de déclenchement : ne traiter ce jeu qu'une seule fois ──
    if (state.processed.has(gn)) return;
    state.processed.add(gn);

    // ── Mettre à jour l'historique des parties (fenêtre de 15) ──────
    state.history.push([...handSuits]);
    if (state.history.length > 15) state.history.shift();

    const { threshold: B, mode, mappings, tg_targets, name, exceptions, prediction_offset, hand } = cfg;
    const offset   = Math.max(1, parseInt(prediction_offset) || 1);
    const handLabel = hand === 'banquier' ? 'banquier' : 'joueur';

    const emitPrediction = async (next, ps, suit) => {
      // ── Bloque l'émission si une prédiction est encore en attente ─
      if (Object.keys(state.pending).length > 0) {
        console.log(`[${channelId}] Bloqué — prédiction en attente de vérification`);
        return;
      }
      // ── Bloque si le live trigger a déjà émis pour ce jeu (évite le doublon) ─
      if (state.liveTriggeredGame === gn) {
        console.log(`[${channelId}] Bloqué — déjà déclenché en live pour jeu #${gn}`);
        return;
      }
      // ── Vérification des exceptions avant d'émettre ───────────────
      if (this._checkExceptions(exceptions, ps, suit, state)) return;

      try {
        await db.createPrediction({ strategy: channelId, game_number: next, predicted_suit: ps, triggered_by: suit || null });
        console.log(`[${channelId}] Prédiction #${next} ${SUIT_DISPLAY[ps] || ps} (${handLabel})`);
      } catch (e) { console.error(`createPrediction ${channelId} error:`, e.message); }
      state.pending[next] = { suit: ps, rattrapage: 0, maxR: stratMaxRForResolve };
      // Envoi Telegram : token custom si configuré, sinon bot global + routage par stratégie
      if (Array.isArray(tg_targets) && tg_targets.length > 0) {
        await sendCustomAndStore(tg_targets, channelId, next, ps, stratTgOpts).catch(() => {});
      } else {
        await sendToStrategyChannels(channelId, next, ps, stratTgOpts).catch(() => {});
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
      // Sélection aléatoire parmi les choix disponibles
      const idx = Math.floor(Math.random() * pool.length);
      console.log(`[${channelId}] Aléatoire ${suit}: pool=[${pool.join(',')}] choix → ${pool[idx]}`);
      return pool[idx];
    };

    if (mode === 'manquants') {
      for (const suit of ALL_SUITS) {
        if (handSuits.includes(suit)) { state.counts[suit] = 0; continue; }
        state.counts[suit] = (state.counts[suit] || 0) + 1;
        if (state.counts[suit] === B) {
          const ps = resolvePredictedSuit(suit);
          if (ps) await emitPrediction(gn + offset, ps, suit);
          state.counts[suit] = 0;
        }
      }
    } else if (mode === 'apparents') {
      for (const suit of ALL_SUITS) {
        if (handSuits.includes(suit)) {
          state.counts[suit] = (state.counts[suit] || 0) + 1;
          if (state.counts[suit] === B) {
            const ps = resolvePredictedSuit(suit);
            if (ps) await emitPrediction(gn + offset, ps, suit);
            state.counts[suit] = 0;
          }
        } else { state.counts[suit] = 0; }
      }
    } else if (mode === 'absence_apparition') {
      // Compte les absences consécutives (sans seuil max).
      // Dès que le costume réapparaît après >= B absences → prédit ce même costume.
      for (const suit of ALL_SUITS) {
        if (handSuits.includes(suit)) {
          if ((state.counts[suit] || 0) >= B) {
            console.log(`[${channelId}] ${suit} réapparu après ${state.counts[suit]} absences (seuil≥${B}) → prédiction`);
            await emitPrediction(gn + offset, suit, suit);
          }
          state.counts[suit] = 0;
        } else {
          state.counts[suit] = (state.counts[suit] || 0) + 1;
        }
      }
    } else if (mode === 'distribution') {
      // Compte les jeux consécutifs NON-naturels (absence de distribution).
      // Logique identique à absence_apparition : quand une distribution survient
      // après >= B absences consécutives → prédit que le prochain jeu sera aussi une distribution.
      const isNatural = Array.isArray(pCards) && Array.isArray(bCards)
        && pCards.length === 2 && bCards.length === 2;
      if (isNatural) {
        if ((state.counts['distrib'] || 0) >= B) {
          console.log(`[${channelId}] [Distribution] Distribution après ${state.counts['distrib']} absences (seuil≥${B}) → prédiction jeu #${gn + offset}`);
          await emitPrediction(gn + offset, 'distrib', 'distrib');
        }
        state.counts['distrib'] = 0; // reset après distribution
      } else {
        state.counts['distrib'] = (state.counts['distrib'] || 0) + 1;
        // pas d'émission ici — on attend la prochaine distribution
      }
    } else if (mode === 'apparition_absence') {
      // Compte les apparitions consécutives (sans seuil max).
      // Dès que le costume disparaît après >= B apparitions → prédit la carte configurée (mapping).
      // Si pas de mapping défini pour ce costume → prédit ce même costume.
      for (const suit of ALL_SUITS) {
        if (handSuits.includes(suit)) {
          state.counts[suit] = (state.counts[suit] || 0) + 1;
        } else {
          if ((state.counts[suit] || 0) >= B) {
            const ps = resolvePredictedSuit(suit) || suit;
            console.log(`[${channelId}] ${suit} disparu après ${state.counts[suit]} apparitions (seuil≥${B}) → prédiction ${ps}`);
            await emitPrediction(gn + offset, ps, suit);
          }
          state.counts[suit] = 0;
        }
      }
    } else if (mode === 'taux_miroir') {
      // ── MODE MIROIR TAUX ─────────────────────────────────────────────
      // Compte le nombre TOTAL d'apparitions de chaque costume (cumulatif).
      // Chaque carte de la main est comptée (ex: main ♠♠ = pique +2).
      // Quand un costume A a B apparitions DE PLUS qu'un costume B → prédit le costume B.
      // Après le déclenchement, remet les compteurs mirrorCounts à 0 (cycle repart).
      // Les compteurs se remettent aussi à zéro toutes les heures pile.
      // ─────────────────────────────────────────────────────────────────

      // 0. Remise à zéro automatique toutes les heures pile
      if (!state.mirrorCounts) state.mirrorCounts = {};
      const currentHour = new Date().getHours();
      if (state.mirrorLastHour === null) {
        state.mirrorLastHour = currentHour;
      } else if (state.mirrorLastHour !== currentHour) {
        console.log(`[${channelId}] MiroirTaux ⏰ Nouvelle heure (${state.mirrorLastHour}h→${currentHour}h) — compteurs remis à zéro`);
        for (const suit of ALL_SUITS) state.mirrorCounts[suit] = 0;
        state.mirrorLastHour = currentHour;
      }

      // 1. Mise à jour des compteurs cumulatifs (+N par jeu selon le nb de cartes du costume)
      // Ex: main ♠♠♥ → ♠ reçoit +2, ♥ reçoit +1
      const rawCards = cfg.hand === 'banquier' ? (bCards || []) : (pCards || []);
      for (const suit of ALL_SUITS) {
        const n = rawCards.filter(c => normalizeSuit(c.S || '') === suit).length;
        state.mirrorCounts[suit] = (state.mirrorCounts[suit] || 0) + n;
      }

      // Log des compteurs courants
      const countsStr = ALL_SUITS.map(s => `${s}:${state.mirrorCounts[s] || 0}`).join(' ');
      console.log(`[${channelId}] MiroirTaux compteurs → ${countsStr}`);

      // 2. Si prédiction en attente → ne pas déclencher
      if (Object.keys(state.pending).length > 0) return;

      // 3. Trouver la paire (dominant, retardataire) avec le plus grand écart ≥ seuil
      let bestDiff = 0;
      let laggingSuit = null;
      let dominantSuit = null;

      // Utilise les paires configurées avec leurs seuils individuels.
      // Si aucune paire configurée → seuil global B sur toutes les combinaisons.
      const configuredPairs = Array.isArray(cfg.mirror_pairs) && cfg.mirror_pairs.length > 0
        ? cfg.mirror_pairs
        : null;

      if (configuredPairs) {
        for (const pairCfg of configuredPairs) {
          const sA = pairCfg.a;
          const sB = pairCfg.b;
          const pairThreshold = (pairCfg.threshold && pairCfg.threshold > 0) ? pairCfg.threshold : B;
          const diff = (state.mirrorCounts[sA] || 0) - (state.mirrorCounts[sB] || 0);
          const absDiff = Math.abs(diff);
          if (absDiff >= pairThreshold && absDiff > bestDiff) {
            bestDiff     = absDiff;
            dominantSuit = diff > 0 ? sA : sB;
            laggingSuit  = diff > 0 ? sB : sA;
          }
        }
      } else {
        for (const sA of ALL_SUITS) {
          for (const sB of ALL_SUITS) {
            if (sA >= sB) continue;
            const diff = (state.mirrorCounts[sA] || 0) - (state.mirrorCounts[sB] || 0);
            const absDiff = Math.abs(diff);
            if (absDiff >= B && absDiff > bestDiff) {
              bestDiff     = absDiff;
              dominantSuit = diff > 0 ? sA : sB;
              laggingSuit  = diff > 0 ? sB : sA;
            }
          }
        }
      }

      // 4. Déclenchement si une paire dépasse le seuil
      // Prédit directement le costume retardataire (le plus faible) — aucun mapping
      // Le compteur continue de s'accumuler après la prédiction — reset UNIQUEMENT à l'heure pile
      if (laggingSuit) {
        const ps = laggingSuit;
        console.log(`[${channelId}] MiroirTaux: ${dominantSuit}(${state.mirrorCounts[dominantSuit]}) - ${laggingSuit}(${state.mirrorCounts[laggingSuit]}) = ${bestDiff} ≥ seuil → prédit le retardataire ${ps}`);
        await emitPrediction(gn + offset, ps, laggingSuit);
      }
    }
  }

  // Pré-remplit le set processed pour les nouvelles stratégies afin d'éviter le rattrapage historique
  _initializeNewStrategies(games) {
    const finishedNums = games.filter(g => g.is_finished).map(g => g.game_number);
    for (const [id, state] of Object.entries(this.custom)) {
      if (state.needsInit) {
        for (const gn of finishedNums) state.processed.add(gn);
        state.needsInit = false;
        console.log(`[S${id}] Initialisation : ${finishedNums.length} jeux historiques ignorés, prédictions démarrent sur les prochains jeux`);
      }
    }
  }

  // ── Déclenchement en temps réel pour absence_apparition / apparition_absence ─
  // Appelé dès que la main concernée a fini de tirer (avant la fin officielle du jeu).
  // Vérifie en temps réel si une prédiction en attente est déjà gagnée dans le jeu live.
  // Résout immédiatement en "gagne" si le costume prédit est visible dans la main live terminée.
  // Les pertes restent gérées à la fin officielle du jeu (pas de résolution négative live).
  async _verifyPendingLive() {
    if (!this.liveGameCards) return;
    const { gameNumber: gn, playerSuits, bankerSuits, playerDone, bankerDone, playerCards, bankerCards } = this.liveGameCards;

    // Helper : tente de résoudre live un seul objet pending (ex: this.c1.pending)
    const tryResolve = async (pending, strategyId, handSuits, handDone, tgOpts = {}) => {
      if (!handDone || handSuits.length === 0) return;
      for (const [pg, info] of Object.entries(pending)) {
        const pgNum = parseInt(pg);
        if (pgNum > gn) continue;           // prédit pour un jeu futur → skip
        if (!handSuits.includes(info.suit)) continue; // costume absent de la main live → attend
        const rattrapage = gn - pgNum;
        console.log(`[${strategyId}] ⚡ Live: costume ${info.suit} trouvé jeu #${gn} → gagne immédiat (R${rattrapage})`);
        await resolvePrediction(strategyId, pgNum, info.suit, 'gagne', rattrapage, playerCards, bankerCards, tgOpts);
        delete pending[pg];
      }
    };

    // Stratégies par défaut C1/C2/C3/DC → main joueur
    await tryResolve(this.c1.pending, 'C1', playerSuits, playerDone);
    await tryResolve(this.c2.pending, 'C2', playerSuits, playerDone);
    await tryResolve(this.c3.pending, 'C3', playerSuits, playerDone);
    await tryResolve(this.dc.pending, 'DC', playerSuits, playerDone);

    // Stratégies custom → main selon config, avec les bonnes options Telegram
    for (const [idStr, entry] of Object.entries(this.custom)) {
      if (!entry.config?.enabled) continue;
      const cfg       = entry.config;
      const hand      = cfg.hand === 'banquier' ? 'banquier' : 'joueur';
      const handSuits = hand === 'banquier' ? bankerSuits : playerSuits;
      const handDone  = hand === 'banquier' ? bankerDone  : playerDone;
      const stratMaxR = (cfg.max_rattrapage !== undefined && cfg.max_rattrapage !== null)
        ? parseInt(cfg.max_rattrapage) : getCurrentMaxRattrapage();
      const stratTgOpts = { formatId: cfg.tg_format || null, hand, maxR: stratMaxR };

      // ── Résolution live spéciale pour le mode Distribution ──────────
      if (cfg.mode === 'distribution') {
        // Quand les deux mains sont terminées avec exactement 2 cartes → naturel → gagne
        if (playerDone && bankerDone && playerCards.length === 2 && bankerCards.length === 2) {
          for (const [pg, info] of Object.entries(entry.pending)) {
            if (info.suit !== 'distrib') continue;
            const pgNum = parseInt(pg);
            if (pgNum > gn) continue;
            const rattrapage = gn - pgNum;
            console.log(`[S${idStr}] ⚡ Live: naturel (2P+2B) jeu #${gn} → distribution gagne immédiat (R${rattrapage})`);
            await resolvePrediction(`S${idStr}`, pgNum, 'distrib', 'gagne', rattrapage, playerCards, bankerCards, stratTgOpts);
            delete entry.pending[pg];
          }
        }
        continue; // ne pas appeler tryResolve pour distribution
      }

      await tryResolve(entry.pending, `S${idStr}`, handSuits, handDone, stratTgOpts);
    }
  }

  async _checkLiveTriggers(liveGame) {
    if (!liveGame || !this.liveGameCards) return;
    const gn = liveGame.game_number;

    for (const [idStr, entry] of Object.entries(this.custom)) {
      const { config } = entry;
      if (!config?.enabled) continue;
      const { mode, threshold: B, hand, tg_targets, prediction_offset, mappings } = config;
      if (mode !== 'absence_apparition' && mode !== 'apparition_absence' && mode !== 'distribution') continue;

      // Une prédiction est déjà en attente → skip
      if (Object.keys(entry.pending).length > 0) continue;

      // Ce jeu live a déjà déclenché pour cette stratégie → skip
      if (entry.liveTriggeredGame === gn) continue;

      // Distribution : pas de déclenchement live — on attend la fin officielle du jeu
      // (seul le traitement batch sur jeux terminés est fiable : 2P + 2B confirmés)
      if (mode === 'distribution') continue;

      const handDone  = hand === 'banquier' ? this.liveGameCards.bankerDone  : this.liveGameCards.playerDone;
      const handSuits = hand === 'banquier' ? this.liveGameCards.bankerSuits : this.liveGameCards.playerSuits;
      if (!handDone || handSuits.length === 0) continue;

      const channelId = `S${idStr}`;
      const offset    = Math.max(1, parseInt(prediction_offset) || 1);
      const next      = gn + offset;

      // Résolution du costume prédit via mappings (pour apparition_absence)
      const resolveLivePs = (suit) => {
        if (mode === 'absence_apparition') return suit; // prédit le même costume
        const raw  = mappings?.[suit];
        const pool = Array.isArray(raw) ? raw.filter(s => ALL_SUITS.includes(s))
                                        : (ALL_SUITS.includes(raw) ? [raw] : []);
        if (!pool.length) return suit; // fallback même costume
        return pool[Math.floor(Math.random() * pool.length)];
      };

      for (const suit of ALL_SUITS) {
        let shouldTrigger = false;
        if (mode === 'absence_apparition') {
          // Costume absent depuis >= B jeux ET vient d'apparaître dans la main live
          shouldTrigger = handSuits.includes(suit) && (entry.counts[suit] || 0) >= B;
        } else {
          // Costume présent depuis >= B jeux ET absent de la main live
          shouldTrigger = !handSuits.includes(suit) && (entry.counts[suit] || 0) >= B;
        }

        if (!shouldTrigger) continue;

        const ps = resolveLivePs(suit);
        entry.liveTriggeredGame = gn;
        console.log(`[${channelId}] ⚡ Live: ${suit} (${mode}, count=${entry.counts[suit]}, seuil≥${B}) → prédiction immédiate ${ps} #${next}`);

        try {
          await db.createPrediction({ strategy: channelId, game_number: next, predicted_suit: ps, triggered_by: suit });
          console.log(`[${channelId}] Prédiction live #${next} ${SUIT_DISPLAY[ps] || ps}`);
          const liveMaxR = (config.max_rattrapage !== undefined && config.max_rattrapage !== null)
            ? parseInt(config.max_rattrapage) : getCurrentMaxRattrapage();
          entry.pending[next] = { suit: ps, rattrapage: 0, maxR: liveMaxR };

          const liveTgOpts = {
            formatId: config.tg_format || null,
            hand:     config.hand      || 'joueur',
            maxR:     liveMaxR,
          };
          if (Array.isArray(tg_targets) && tg_targets.length > 0) {
            await sendCustomAndStore(tg_targets, channelId, next, ps, liveTgOpts).catch(() => {});
          } else {
            await sendToStrategyChannels(channelId, next, ps, liveTgOpts).catch(() => {});
          }
        } catch (e) {
          console.error(`[${channelId}] Live trigger error:`, e.message);
        }
        break; // Une seule prédiction par stratégie par jeu live
      }
    }
  }

  // ── Reset horaire des compteurs taux_miroir ──────────────────────────────
  // Appelé à chaque tick (indépendant des jeux terminés) pour garantir
  // la remise à zéro dès le passage à la nouvelle heure, même entre deux jeux.
  _checkHourlyMirrorReset() {
    const currentHour = new Date().getHours();
    for (const [id, entry] of Object.entries(this.custom)) {
      if (entry.config?.mode !== 'taux_miroir') continue;
      if (!entry.mirrorCounts) entry.mirrorCounts = {};
      if (entry.mirrorLastHour === null || entry.mirrorLastHour === undefined) {
        entry.mirrorLastHour = currentHour;
        continue;
      }
      if (entry.mirrorLastHour !== currentHour) {
        console.log(`[S${id}] MiroirTaux ⏰ Heure ${entry.mirrorLastHour}h→${currentHour}h — compteurs remis à zéro (tick)`);
        for (const suit of ALL_SUITS) entry.mirrorCounts[suit] = 0;
        entry.mirrorLastHour = currentHour;
      }
    }
  }

  async tick() {
    try {
      const games    = await fetchGames();
      const finished = games.filter(g => g.is_finished);
      // Initialiser les nouvelles stratégies AVANT tout traitement
      this._initializeNewStrategies(games);

      // Reset horaire des compteurs taux_miroir (indépendant des jeux terminés)
      this._checkHourlyMirrorReset();

      // Recharger la config Telegram des stratégies par défaut (reflet des changements admin)
      try {
        const v = await db.getSetting('default_strategies_tg');
        this.defaultStratTg = v ? JSON.parse(v) : {};
      } catch (e) { /* conserver la config précédente */ }

      // currentMaxGame = max vu dans l'API (inclut les jeux en cours, pour info)
      if (games.length > 0) {
        const maxSeen = Math.max(...games.map(g => g.game_number));
        if (maxSeen > (this.currentMaxGame || 0)) this.currentMaxGame = maxSeen;
      }

      // Capture la partie live en cours pour la prévisualisation des compteurs.
      // On utilise la PHASE pour savoir quelle main a FINI de tirer :
      //   - Phase 'PlayerMove'  → joueur encore en train de tirer → NE PAS projeter le joueur
      //   - Phase 'BankerMove'  → banquier encore en train de tirer → NE PAS projeter le banquier
      //   - Phase 'DealerMove' / 'ThirdCard' → joueur a fini, banquier peut encore tirer
      //   - Aucune phase active → mise à jour uniquement si ≥ 2 cartes (donne initiale complète)
      const PLAYER_DRAWING_PHASES = new Set(['PlayerMove']);
      const BANKER_DRAWING_PHASES = new Set(['BankerMove']);

      const liveGame = games.find(g =>
        !g.is_finished && (
          (g.player_cards && g.player_cards.length > 0) ||
          (g.banker_cards && g.banker_cards.length > 0)
        )
      );

      if (liveGame) {
        const ph          = liveGame.phase || '';
        const pSuits      = extractSuits(liveGame.player_cards || []);
        const bSuits      = extractSuits(liveGame.banker_cards || []);

        // Le joueur a fini de tirer si :
        //  - Il a ≥ 2 cartes ET la phase n'est PAS 'PlayerMove'
        //  - OU il a 3 cartes (tirage du troisième forcément terminé)
        const playerDone = pSuits.length > 0 && (
          liveGame.player_cards.length >= 3 ||
          (liveGame.player_cards.length >= 2 && !PLAYER_DRAWING_PHASES.has(ph))
        );

        // Le banquier a fini de tirer si :
        //  - Il a ≥ 2 cartes ET la phase n'est PAS 'BankerMove'
        //  - OU il a 3 cartes
        const bankerDone = bSuits.length > 0 && (
          liveGame.banker_cards.length >= 3 ||
          (liveGame.banker_cards.length >= 2 && !BANKER_DRAWING_PHASES.has(ph))
        );

        this.liveGameCards = {
          gameNumber:  liveGame.game_number,
          phase:       ph,
          playerSuits: playerDone ? pSuits : [],
          bankerSuits: bankerDone ? bSuits : [],
          playerDone,
          bankerDone,
          playerCards: liveGame.player_cards || [],
          bankerCards: liveGame.banker_cards || [],
        };
        // Vérification live des prédictions en attente (gagne immédiat si costume trouvé)
        await this._verifyPendingLive();
        // Vérification en temps réel pour absence_apparition / apparition_absence
        await this._checkLiveTriggers(liveGame);
      } else {
        this.liveGameCards = null;
      }

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
        const suits  = extractSuits(game.player_cards  || []);
        const bSuits = extractSuits(game.banker_cards  || []);
        if (!suits.length && !bSuits.length) continue;
        if (!this.c1.processed.has(game.game_number)) {
          console.log(`[Engine] ✅ Traitement jeu #${game.game_number} | P:${suits.join(',') || '—'} B:${bSuits.join(',') || '—'} | gagnant: ${game.winner || '?'}`);
          hadNew = true;
          // Détection jeu #1 → reset complet (nouveau jour / passage à minuit)
          if (game.game_number === 1 && (this.maxProcessedGame || 0) > 5) {
            await this._resetOnGameOne();
            renderSync.handleGameOne(1).catch(() => {});
          }
        }
        await this.processGame(game.game_number, suits, bSuits, game.player_cards, game.banker_cards);
        // Suivi du jeu TERMINÉ le plus récent réellement traité (utilisé par cleanupStale)
        if (game.game_number > (this.maxProcessedGame || 0)) this.maxProcessedGame = game.game_number;
      }
      if (hadNew) await this.saveAbsences();
    } catch (e) { console.error('Engine tick error:', e.message); }
  }

  async cleanupStale() {
    try {
      // Utilise le numéro du DERNIER JEU RÉELLEMENT TRAITÉ par processGame,
      // pas le max vu dans l'API (qui inclut les jeux en cours non terminés).
      const mx = this.maxProcessedGame || 0;
      if (mx < 1) return;

      const globalMaxR = getCurrentMaxRattrapage();

      // ── Phase 1 : cleanup par stratégie custom (avec le bon maxR de chaque) ──
      // Résout correctement chaque prédiction orpheline avec la notification Telegram
      // et le rattrapage exact de la stratégie concernée.
      let customExpired = 0;
      for (const [idStr, state] of Object.entries(this.custom)) {
        if (!state.pending || Object.keys(state.pending).length === 0) continue;
        const cfg      = state.config;
        const stratMaxR = (cfg?.max_rattrapage !== undefined && cfg?.max_rattrapage !== null)
          ? parseInt(cfg.max_rattrapage)
          : globalMaxR;
        const channelId = `S${idStr}`;
        const stratTgOpts = { formatId: cfg?.tg_format || null, hand: cfg?.hand || 'joueur', maxR: stratMaxR };

        for (const [pgStr, info] of Object.entries(state.pending)) {
          const pgNum = parseInt(pgStr);
          // La prédiction a dépassé sa fenêtre de rattrapage → expiration propre
          if (mx > pgNum + stratMaxR) {
            await resolvePrediction(channelId, pgNum, info.suit, 'perdu', stratMaxR, null, null, stratTgOpts);
            delete state.pending[pgStr];
            customExpired++;
          }
        }
      }
      if (customExpired > 0) {
        console.log(`🧹 ${customExpired} prédiction(s) custom expirée(s) (jeu actuel: #${mx})`);
      }

      // ── Phase 2 : cleanup SQL de sécurité pour les stratégies intégrées (C1/C2/C3/DC) ──
      // et toute prédiction orpheline non gérée par la Phase 1 (ex: prédictions sans pending en mémoire).
      // On utilise globalMaxR comme seuil de sécurité pour les stratégies intégrées.
      const builtinThreshold = mx - globalMaxR - 1;
      if (builtinThreshold >= 1) {
        const count = await db.expireStaleByGame(builtinThreshold, globalMaxR);
        if (count > 0) console.log(`🧹 ${count} prédiction(s) intégrées hors-fenêtre expirée(s) (seuil: #${builtinThreshold})`);
      }
    } catch (e) { console.error('cleanupStale error:', e.message); }
  }

  async loadExistingPending() {
    try {
      const rows = await db.getPredictions({ status: 'en_cours', limit: 500 });
      const globalMaxR = getCurrentMaxRattrapage();
      for (const row of rows) {
        const { strategy, game_number: gn, predicted_suit: ps, rattrapage: r } = row;
        if      (strategy === 'C1') this.c1.pending[gn] = { suit: ps, rattrapage: parseInt(r) || 0, maxR: globalMaxR };
        else if (strategy === 'C2') this.c2.pending[gn] = { suit: ps, rattrapage: parseInt(r) || 0, maxR: globalMaxR };
        else if (strategy === 'C3') this.c3.pending[gn] = { suit: ps, rattrapage: parseInt(r) || 0, maxR: globalMaxR };
        else if (strategy === 'DC') this.dc.pending[gn] = { suit: ps, rattrapage: parseInt(r) || 0, maxR: globalMaxR };
        else if (strategy.startsWith('S') && !isNaN(parseInt(strategy.slice(1)))) {
          const id = parseInt(strategy.slice(1));
          if (!this.custom[id]) this.custom[id] = this._makeCustomState();
          const cfg = this.custom[id].config;
          const stratMaxR = (cfg?.max_rattrapage !== undefined && cfg?.max_rattrapage !== null)
            ? parseInt(cfg.max_rattrapage) : globalMaxR;
          this.custom[id].pending[gn] = { suit: ps, rattrapage: parseInt(r) || 0, maxR: stratMaxR };
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

  // ── Reset complet au passage minuit (jeu #1 détecté) ─────────────────────
  // Expire toutes les prédictions en_cours de la veille en DB et vide les
  // pending / processed en mémoire pour repartir proprement.
  async _resetOnGameOne() {
    console.log('[Engine] 🕛 Jeu #1 détecté → reset complet (nouvelles 24h)');
    // 1. Expire toutes les en_cours en DB
    const expired = await db.expireAllEnCours().catch(() => 0);
    if (expired > 0) console.log(`[Engine] 🕛 ${expired} prédiction(s) de la veille expirée(s)`);
    // 2. Vide les messages Telegram stockés (pour éviter les éditions orphelines)
    await db.clearAllTgPredMessages().catch(() => {});
    // 3. Vide les pending et processed en mémoire pour toutes les stratégies
    for (const strat of ['c1', 'c2', 'c3']) {
      if (this[strat]) { this[strat].pending = {}; this[strat].processed = new Set(); }
    }
    if (this.dc) this.dc.pending = {};
    for (const [, state] of Object.entries(this.custom)) {
      state.pending = {};
      state.processed = new Set();
      if (state.mirrorCounts) for (const s of ALL_SUITS) state.mirrorCounts[s] = 0;
    }
    this.maxProcessedGame = 0;
    this.currentMaxGame   = 0;
    console.log('[Engine] 🕛 Reset terminé — moteur prêt pour le nouveau jour');
  }

  async start(intervalMs = 5000) {
    if (this.running) return;
    this.running = true;
    // ── Charge le maxRattrapage depuis la DB EN PREMIER ──────────────────
    // CRITIQUE : doit être avant cleanupStale() et loadExistingPending()
    // sinon maxRattrapage = 2 (valeur par défaut) → perdu prématuré au démarrage.
    await loadMaxRattrapage().catch(() => {});
    console.log('🚀 Moteur de prédiction démarré');
    await this.loadCustomStrategies();
    await this.loadLossSequences();
    await this.loadAbsences();
    await this.cleanupStale();
    await this.loadExistingPending();
    // Charger la config base Render externe
    await renderSync.loadRenderUrl().catch(() => {});
    this.tick();
    this.interval = setInterval(() => this.tick(), intervalMs);
    setInterval(() => this.cleanupStale(), 60_000);
    setInterval(() => this.saveAbsences(), 30_000);
    // Auto-nettoyage des prédictions bloquées en_cours depuis plus de 22 minutes
    setInterval(() => this._clearExpiredByTime(), 2 * 60_000);
    // Recharger l'URL Render toutes les 5 minutes (si modifiée en admin)
    setInterval(() => renderSync.loadRenderUrl().catch(() => {}), 5 * 60_000);
  }

  async _clearExpiredByTime() {
    try {
      const count = await db.expireStaleByTime(22);
      if (count > 0) {
        console.log(`[Engine] ⏱️ Auto-expiration: ${count} prédiction(s) bloquée(s) depuis +22 min → statut 'expire'`);
        // Supprimer du cache pending en mémoire
        for (const strat of ['c1', 'c2', 'c3', 'dc']) {
          const state = this[strat === 'dc' ? 'dc' : strat];
          if (!state || !state.pending) continue;
          for (const [key, p] of Object.entries(state.pending)) {
            const age = Date.now() - new Date(p.created_at || 0).getTime();
            if (age > 22 * 60 * 1000) delete state.pending[key];
          }
        }
        for (const s of Object.values(this.custom || {})) {
          if (!s.pending) continue;
          for (const [key, p] of Object.entries(s.pending)) {
            const age = Date.now() - new Date(p.created_at || 0).getTime();
            if (age > 22 * 60 * 1000) delete s.pending[key];
          }
        }
      }
    } catch (e) { console.error('[Engine] _clearExpiredByTime error:', e.message); }
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
      const { threshold, mode, hand } = entry.config;

      // Si une partie est en cours et que la main concernée a déjà tiré ses cartes,
      // on projette les compteurs en temps réel (sans attendre la fin du jeu)
      let liveSuits = null;
      if (this.liveGameCards) {
        const projected = hand === 'banquier'
          ? this.liveGameCards.bankerSuits
          : this.liveGameCards.playerSuits;
        if (projected.length > 0) liveSuits = projected;
      }

      // Mode Distribution → afficher le compteur de jeux non-naturels
      if (mode === 'distribution') {
        const count = entry.counts['distrib'] || 0;
        return [{
          suit: 'distrib', display: '📊',
          count, threshold,
          mode, label: 'Distribution',
          isLive: false,
          singleCounter: true,
          description: `${count} jeu${count > 1 ? 'x' : ''} non-naturel${count > 1 ? 's' : ''} consécutif${count > 1 ? 's' : ''}`,
        }];
      }

      // Mode Miroir Taux → afficher les compteurs d'apparitions cumulatifs
      if (mode === 'taux_miroir') {
        const mirrorCounts = entry.mirrorCounts || {};
        const rawPairs = entry.config?.mirror_pairs;
        const pairs = Array.isArray(rawPairs) && rawPairs.length > 0
          ? rawPairs.map(p => Array.isArray(p) ? { a: p[0], b: p[1] } : p)
          : null;
        return ALL_SUITS.map(suit => {
          // Si des paires sont configurées, marquer si ce costume est dans une paire surveillée
          const inPair = !pairs || pairs.some(p => p.a === suit || p.b === suit);
          return {
            suit, display: SUIT_DISPLAY[suit] || suit,
            count: mirrorCounts[suit] || 0,
            threshold,
            mode, label: 'Miroir',
            isLive: false,
            dimmed: !inPair,
          };
        });
      }

      return ALL_SUITS.map(suit => {
        const base = entry.counts[suit] || 0;
        let count  = base;
        let isLive = false;

        if (liveSuits !== null) {
          isLive = true;
          if (mode === 'manquants' || mode === 'absence_apparition') {
            count = liveSuits.includes(suit) ? 0 : base + 1;
          } else {
            count = liveSuits.includes(suit) ? base + 1 : 0;
          }
        }

        const modeLabel = mode === 'apparents' ? 'Apparitions'
          : mode === 'absence_apparition' ? 'Abs→App'
          : mode === 'apparition_absence' ? 'App→Abs'
          : mode === 'distribution' ? 'Distribution'
          : 'Absences';

        return {
          suit, display: SUIT_DISPLAY[suit] || suit,
          count, threshold,
          mode, label: modeLabel,
          isLive,
        };
      });
    }
    return null;
  }

  updateMaxRattrapage(n) {
    console.log(`[Engine] Max rattrapage mis à jour → ${n}`);
    // getCurrentMaxRattrapage() dans telegram-service est déjà mis à jour
    // grâce à saveMaxRattrapage() appelé depuis admin.js
  }

  // ── Réinitialisation mémoire pour reset-stats ────────────────────
  clearStrategyPending(stratKey) {
    if (stratKey === 'C1') { this.c1.pending = {}; }
    else if (stratKey === 'C2') { this.c2.pending = {}; }
    else if (stratKey === 'C3') { this.c3.pending = {}; }
    else if (stratKey === 'DC') { this.dc.pending = {}; }
    else if (stratKey.startsWith('S')) {
      const id = parseInt(stratKey.slice(1));
      if (!isNaN(id) && this.custom[id]) this.custom[id].pending = {};
    }
    console.log(`[Engine] Pending mémoire vidé pour ${stratKey}`);
  }

  clearAllPending() {
    this.c1.pending = {}; this.c2.pending = {}; this.c3.pending = {}; this.dc.pending = {};
    for (const id of Object.keys(this.custom)) { this.custom[id].pending = {}; }
    console.log('[Engine] Tous les pending mémoire vidés');
  }

  resetAbsences() {
    const SUITS = ['♠','♥','♦','♣'];
    for (const s of SUITS) {
      this.c1.absences[s] = 0;
      this.c2.absences[s] = 0;
      this.c3.absences[s] = 0;
    }
    this.c1.consecLosses = 0;
    this.c2.hadFirstLoss = false;
    this.c3.consecLosses = 0;
    for (const id of Object.keys(this.custom)) {
      if (this.custom[id].absences) this.custom[id].absences = {};
    }
    console.log('[Engine] Compteurs d\'absences remis à 0');
  }

  stop() {
    this.running = false;
    if (this.interval) clearInterval(this.interval);
    console.log('🔴 Moteur arrêté');
  }
}

module.exports = new Engine();
