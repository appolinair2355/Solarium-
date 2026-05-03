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
  editRawStoredMessages,
  getCurrentMaxRattrapage,
  loadMaxRattrapage,
} = require('./telegram-service');
const renderSync = require('./render-sync');
const cartesStore = require('./cartes-store');

const ALL_SUITS   = ['♠', '♥', '♦', '♣'];
const SUIT_DISPLAY = { '♠': '♠️', '♥': '❤️', '♦': '♦️', '♣': '♣️', 'WIN_B': '🏦', 'WIN_P': '👤', 'TIE': '🤝', 'TWO_THREE': '⚡', 'DEUX_TROIS': '2️⃣3️⃣', 'TROIS_DEUX': '3️⃣2️⃣', 'TROIS_TROIS': '3️⃣3️⃣' };
const WIN_LABEL    = { 'WIN_B': 'Banquier', 'WIN_P': 'Joueur', 'TIE': 'Match Nul', 'TWO_THREE': '2+3 Cartes', 'DEUX_TROIS': 'J:2 B:3', 'TROIS_DEUX': 'J:3 B:2', 'TROIS_TROIS': 'J:3 B:3' };

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

// ── Garde : empêche d'émettre si la dernière prédiction est encore en cours (<10 min) ──
async function canEmitNewPrediction(stratId) {
  try {
    const r = await db.pool.query(
      `SELECT status, created_at FROM predictions WHERE strategy = $1 ORDER BY id DESC LIMIT 1`,
      [stratId]
    );
    if (!r.rows.length) return true;
    const last = r.rows[0];
    if (last.status !== 'en_cours') return true;
    const ageMs = Date.now() - new Date(last.created_at).getTime();
    const TEN_MIN = 10 * 60 * 1000;
    if (ageMs >= TEN_MIN) {
      console.log(`[${stratId}] Garde 10min: en_cours depuis ${Math.round(ageMs/60000)}min ≥ 10min → autorisé`);
      return true;
    }
    console.log(`[${stratId}] Garde 10min: en_cours depuis ${Math.round(ageMs/60000)}min < 10min → bloqué`);
    return false;
  } catch { return true; }
}

async function savePrediction(strategy, gameNumber, predictedSuit, triggeredBy, customTg) {
  // Garde 10 min : ne pas émettre si une prédiction est encore en cours
  if (!(await canEmitNewPrediction(strategy))) return;
  try {
    const inserted = await db.createPrediction({ strategy, game_number: gameNumber, predicted_suit: predictedSuit, triggered_by: triggeredBy || null });
    if (!inserted) {
      console.warn(`[${strategy}] Prédiction #${gameNumber} déjà existante — Telegram ignoré (doublon évité)`);
      return;
    }
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
    // On transmet les cartes pour que le format 11 (Distribution) puisse les afficher
    editStoredMessages(strategy, gameNumber, predictedSuit, status, rattrapage, {
      ...tgOpts,
      playerCards: playerCards || null,
      bankerCards: bankerCards || null,
    }).catch(() => {});
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
    this.proStrategyIds = new Set(); // IDs numériques des stratégies Pro (5001, 5002...)

    // ── Logs en direct par stratégie Pro ──────────────────────────────────
    // { proNumId: [ { ts, level, msg }, ... ] }   tampon circulaire (80 lignes / slot)
    this.proLogs = {};
    this._PRO_LOG_MAX = 500;
    this._proLogsSaveTimer = null;

    // ── Durée de prédiction expirée — cache des alertes horaires ──────────
    // { channelId: lastAlertTimestamp }
    this._predDurationAlertCache = {};

    // ── Contexte de rotation — défini pendant la délégation rotation ──────
    this._currentRotationContext = null;

    // ── Bloqueur de mauvaises prédictions ─────────────────────────────────
    // { stratId: { blockedUntilGame: N, reason: '...', triggeredAt: Date } }
    this.badPredBlocker = {};

    for (const s of ALL_SUITS) {
      this.c1.absences[s] = 0;
      this.c2.absences[s] = 0;
      this.c3.absences[s] = 0;
    }

    // Cache d'activité des propriétaires Pro (TTL 60s) pour éviter de surcharger la DB
    this._ownerActiveCache = new Map(); // userId -> { active: bool, until: ts }
  }

  // Vérifie si le propriétaire d'une stratégie Pro est encore actif (non expiré, approuvé)
  // Renvoie true pour les stratégies non-Pro (sans owner_user_id) ou pour les admins.
  // Gère l'expiration de la durée de prédiction : envoie une alerte Telegram max 1×/heure
  async _handlePredDurationExpired(cfg, channelId) {
    const now = Date.now();
    const lastAlert = this._predDurationAlertCache[channelId] || 0;
    if (now - lastAlert < 3600000) return;
    this._predDurationAlertCache[channelId] = now;

    const dur = cfg.pred_duration_minutes || 0;
    const durStr = dur >= 43200 ? '1 mois'
      : dur >= 20160 ? '2 semaines'
      : dur >= 10080 ? '1 semaine'
      : dur >= 1440  ? `${Math.round(dur / 1440)} jour(s)`
      : dur >= 60    ? `${Math.round(dur / 60)} heure(s)`
      : `${dur} minute(s)`;

    const alertText = `🔴 <b>DURÉE DE PRÉDICTION EXPIRÉE</b>\n\nLa stratégie <b>${cfg.name || channelId}</b> a atteint sa limite de durée (${durStr}).\n\n⚠️ Aucune nouvelle prédiction ne sera envoyée.\n\n<i>Contactez votre administrateur pour renouveler.</i>`;
    console.log(`[${channelId}] ⏰ Durée de prédiction expirée — alerte horaire envoyée`);
    try {
      const { sendRawMessage } = require('./telegram-service');
      const targets = Array.isArray(cfg.tg_targets) ? cfg.tg_targets : [];
      for (const t of targets) {
        if (t.bot_token && t.channel_id) {
          await sendRawMessage(t.bot_token, t.channel_id, alertText, 'HTML').catch(() => {});
        }
      }
    } catch {}
  }

  async _isOwnerActive(cfg) {
    if (!cfg || !cfg.is_pro) return true;
    const ownerId = cfg.owner_user_id;
    if (!ownerId) return true; // legacy : on laisse passer
    const now = Date.now();
    const cached = this._ownerActiveCache.get(ownerId);
    if (cached && cached.until > now) return cached.active;
    let active = false;
    try {
      const u = await db.getUser(ownerId);
      if (u) {
        if (u.is_admin) active = true;
        else if (!u.is_approved) active = false;
        else if (!u.subscription_expires_at) active = false;
        else active = new Date(u.subscription_expires_at) > new Date();
      }
    } catch { active = true; } // tolérant en cas d'erreur DB
    this._ownerActiveCache.set(ownerId, { active, until: now + 60000 });
    if (!active) console.log(`[Pro owner=${ownerId}] ⛔ Compte expiré/non approuvé — envois Telegram bloqués`);
    return active;
  }

  _makeCustomState() {
    const counts = {};
    const mappingIndex = {};
    const mirrorCounts = {};
    const adverseCounts = {}; // pour le mode compteur_adverse
    for (const s of ALL_SUITS) { counts[s] = 0; mappingIndex[s] = 0; mirrorCounts[s] = 0; adverseCounts[s] = 0; }
    return { counts, processed: new Set(), pending: {}, history: [], lastOutcomes: [], predHistory: [], mappingIndex, mirrorCounts, mirrorLastHour: null, adverseCounts };
  }

  // ── Bloqueur automatique des mauvaises prédictions ─────────────────────────
  // Vérifie si une stratégie est actuellement bloquée à cause d'un mauvais taux de victoire.
  // Retourne true si bloqué (prédiction doit être ignorée).
  _isBadPredBlocked(stratId, gn, state) {
    const block = this.badPredBlocker[stratId];
    if (!block) return false;
    if (gn <= block.blockedUntilGame) {
      console.log(`[BadPredBlock] ${stratId} bloqué jusqu'au jeu #${block.blockedUntilGame} (jeu actuel #${gn}) — raison: ${block.reason}`);
      return true;
    }
    // Déblocage automatique
    delete this.badPredBlocker[stratId];
    console.log(`[BadPredBlock] ${stratId} débloqué au jeu #${gn}`);
    return false;
  }

  // Évalue le taux de victoire récent et bloque si trop faible.
  // Appelé après chaque résolution de prédiction (gain ou perte).
  _updateBadPredBlocker(stratId, gn, state) {
    const BAD_WINDOW   = 5;   // Fenêtre d'analyse : 5 dernières prédictions
    const BAD_WIN_RATE = 0.20; // Seuil : en dessous de 20% → bloqué
    const BLOCK_GAMES  = 3;   // Bloquer pendant 3 jeux
    const MIN_PRED     = 3;   // Minimum de prédictions avant d'activer le bloqueur

    const outcomes = state.lastOutcomes || [];
    if (outcomes.length < MIN_PRED) return;

    const recent = outcomes.slice(-BAD_WINDOW);
    const wins   = recent.filter(o => o.won).length;
    const rate   = wins / recent.length;

    if (rate <= BAD_WIN_RATE && recent.length >= MIN_PRED) {
      const reason = `taux victoire ${(rate * 100).toFixed(0)}% sur ${recent.length} dernières préd.`;
      this.badPredBlocker[stratId] = {
        blockedUntilGame: gn + BLOCK_GAMES,
        reason,
        triggeredAt: new Date().toISOString(),
      };
      console.log(`[BadPredBlock] ⛔ ${stratId} BLOQUÉ automatiquement — ${reason} — jusqu'au jeu #${gn + BLOCK_GAMES}`);
    }
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

        // Condition C : combo perte+Rn (multi-niveaux supporté)
        const cLevelsRaw_loss = Array.isArray(rule.combo_levels) ? rule.combo_levels : (rule.combo_level != null ? [rule.combo_level] : []);
        const cLevels_loss    = cLevelsRaw_loss.map(n => parseInt(n)).filter(n => n >= 1);
        const cCount_loss     = parseInt(rule.combo_count) || 1;
        if (!fired && cLevels_loss.length) {
          for (const lv of cLevels_loss) {
            const cur = (this.comboCounters[stratId] || {})[lv] || 0;
            if (cur >= cCount_loss) {
              fired = true;
              console.log(`[Relance] "${rcfg.name}" → ${stratId} combo R${lv} ×${cur} (seuil ×${cCount_loss}) → ${relanceId} #${gn + 1}`);
              this.comboCounters[stratId][lv] = 0;
              break;
            }
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

        // Condition B : rattrapages consécutifs (multi-niveaux supporté)
        const rLevelsRaw = Array.isArray(rule.rattrapage_levels) ? rule.rattrapage_levels : (rule.rattrapage_level != null ? [rule.rattrapage_level] : []);
        const rLevels    = rLevelsRaw.map(n => parseInt(n)).filter(n => n >= 1);
        const rCount     = parseInt(rule.rattrapage_count) || 1;
        if (!fired && rLevels.includes(R) && rStreak >= rCount) {
          fired = true;
          console.log(`[Relance] "${rcfg.name}" → ${stratId} R${R} consécutif ×${rStreak} (seuil ×${rCount}, niveaux=[${rLevels.join(',')}]) → ${relanceId} #${gn + 1}`);
          this.rattrapStreaks[stratId][R] = 0;
        }

        // Condition C : combo perte+Rn (multi-niveaux supporté)
        const cLevelsRaw_r = Array.isArray(rule.combo_levels) ? rule.combo_levels : (rule.combo_level != null ? [rule.combo_level] : []);
        const cLevels_r    = cLevelsRaw_r.map(n => parseInt(n)).filter(n => n >= 1);
        const cCount_r     = parseInt(rule.combo_count) || 1;
        if (!fired && cLevels_r.includes(R)) {
          const cur = (this.comboCounters[stratId] || {})[R] || 0;
          if (cur >= cCount_r) {
            fired = true;
            console.log(`[Relance] "${rcfg.name}" → ${stratId} combo R${R} ×${cur} (seuil ×${cCount_r}, niveaux=[${cLevels_r.join(',')}]) → ${relanceId} #${gn + 1}`);
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
        const rLvls = Array.isArray(rule.rattrapage_levels) ? rule.rattrapage_levels : (rule.rattrapage_level != null ? [rule.rattrapage_level] : []);
        if (rLvls.length) {
          const lvls = rLvls.map(n => parseInt(n));
          const maxCur = Math.max(...lvls.map(lv => (this.rattrapStreaks[srcId] || {})[lv] || 0));
          entry.B = { cur: maxCur, thr: parseInt(rule.rattrapage_count) || 1, lvl: lvls.length === 1 ? lvls[0] : null, lvls };
        }
        const cLvls = Array.isArray(rule.combo_levels) ? rule.combo_levels : (rule.combo_level != null ? [rule.combo_level] : []);
        if (cLvls.length) {
          const lvls = cLvls.map(n => parseInt(n));
          const maxCur = Math.max(...lvls.map(lv => (this.comboCounters[srcId] || {})[lv] || 0));
          entry.C = { cur: maxCur, thr: parseInt(rule.combo_count) || 1, lvl: lvls.length === 1 ? lvls[0] : null, lvls };
        }
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
      const stratTgOpts = { formatId: state.config.tg_format || null, hand: state.config.hand || 'joueur', maxR: stratMaxR };
      db.createPrediction({ strategy: stratId, game_number: nextGn, predicted_suit: suit, triggered_by: suit }).then(async inserted => {
        if (!inserted) {
          console.warn(`[${stratId}] _forceNextPrediction #${nextGn} déjà existante — Telegram ignoré`);
          return;
        }
        if (!(await this._isOwnerActive(state.config))) { console.log(`[${stratId}] ⛔ envoi Telegram bloqué (abonnement expiré)`); return; }
        if (tgs.length > 0) {
          sendCustomAndStore(tgs, stratId, nextGn, suit, stratTgOpts).catch(() => {});
        } else {
          sendToStrategyChannels(stratId, nextGn, suit, stratTgOpts).catch(() => {});
        }
      }).catch(() => {});
      // Stocker maxR dans le pending pour que la résolution utilise la même valeur
      state.pending[nextGn] = { suit, rattrapage: 0, maxR: stratMaxR };
    }
  }

  reloadCustomStrategies(list) {
    for (const cfg of list) {
      if (!this.custom[cfg.id]) {
        // Nouvelle stratégie : initialiser l'état complet
        const s = this._makeCustomState();
        s.needsInit = true;
        this.custom[cfg.id] = s;
      } else {
        // Stratégie existante : si la MAIN a changé, reset les compteurs liés à la main
        // car les données accumulées correspondent à l'ancienne main (mauvaise main)
        const oldHand = this.custom[cfg.id].config?.hand || 'joueur';
        const newHand = cfg.hand || 'joueur';
        if (oldHand !== newHand) {
          console.log(`[S${cfg.id}] Main changée (${oldHand} → ${newHand}) — reset compteurs`);
          // Reset counts (absences/apparitions pour manquants, apparents, absence_apparition, apparition_absence)
          const counts = this.custom[cfg.id].counts;
          if (counts) for (const s of ALL_SUITS) counts[s] = 0;
          // Reset mirrorCounts (taux_miroir)
          const mc = this.custom[cfg.id].mirrorCounts;
          if (mc) for (const s of ALL_SUITS) mc[s] = 0;
          // Reset histoire (basée sur la main surveillée)
          this.custom[cfg.id].history = [];
          // Reset lastHour pour forcer la réinitialisation de mirrorLastHour
          this.custom[cfg.id].mirrorLastHour = null;
        }
      }
      // Ne PAS remettre les compteurs à 0 pour les stratégies existantes dont la main n'a pas changé
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

  // ── Stratégies Pro (multi-fichiers — jusqu'à 100 slots) ──────────────────
  // Supporte JSON (déclaratif), JS (vm sandbox), Python (child_process)
  // Prédictions sauvegardées en DB avec strategy = "S5001", "S5002"...
  async loadProStrategies() {
    try {
      // Nettoyer les anciennes stratégies Pro
      for (const id of (this.proStrategyIds || [])) { delete this.custom[id]; }
      this.proStrategyIds = new Set();

      // Lire la liste des stratégies (avec migration legacy si besoin)
      let list = [];
      const rawList = await db.getSetting('pro_strategies_list').catch(() => null);
      if (rawList) { try { list = JSON.parse(rawList); } catch {} }
      if (!Array.isArray(list)) list = [];

      // ── Migration du legacy (un seul fichier) — assigne au premier admin ──
      if (!list.length) {
        const oldContent = await db.getSetting('pro_strategy_file_content').catch(() => null);
        const oldMetaRaw = await db.getSetting('pro_strategy_file_meta').catch(() => null);
        if (oldContent && oldMetaRaw) {
          try {
            const oldMeta = JSON.parse(oldMetaRaw);
            const id = 5001;
            const allUsers = await db.getAllUsers().catch(() => []);
            const admin = allUsers.find(u => u.is_admin && (u.admin_level || 2) === 1) || allUsers.find(u => u.is_admin);
            const ownerId = admin ? admin.id : 1;
            list = [{
              id, owner_user_id: ownerId,
              filename: oldMeta.filename || 'legacy.js',
              file_type: oldMeta.file_type || 'js',
              strategy_name: oldMeta.strategy_name || 'Stratégie Pro',
              engine_loaded: oldMeta.engine_loaded !== false,
            }];
            await db.setSetting('pro_strategies_list', JSON.stringify(list));
            await db.setSetting(`pro_strategy_${id}_content`, oldContent);
            await db.setSetting(`pro_strategy_${id}_meta`, JSON.stringify({ ...oldMeta, id, owner_user_id: ownerId }));
            console.log(`[Pro] 🔁 Migration legacy → slot S${id} (owner=${ownerId})`);
          } catch {}
        }
      }

      // ── Backfill owner_user_id pour entrées legacy ──
      let needsBackfill = list.some(s => !s.owner_user_id);
      if (needsBackfill) {
        try {
          const allUsers = await db.getAllUsers();
          const admin = allUsers.find(u => u.is_admin && (u.admin_level || 2) === 1) || allUsers.find(u => u.is_admin);
          const fallback = admin ? admin.id : 1;
          for (const s of list) if (!s.owner_user_id) s.owner_user_id = fallback;
          await db.setSetting('pro_strategies_list', JSON.stringify(list));
        } catch {}
      }

      if (!list.length) return;

      // Récupérer les utilisateurs actifs (Pro + admins) pour filtrer les stratégies désactivées
      const allUsers = await db.getAllUsers().catch(() => []);
      const activeOwners = new Set(allUsers.filter(u => u.is_pro || u.is_admin).map(u => u.id));

      // Cache des configs Telegram par propriétaire (évite de relire pour chaque stratégie)
      const tgCache = new Map();
      const getTgFor = async (ownerId) => {
        if (tgCache.has(ownerId)) return tgCache.get(ownerId);
        let tgs = [];
        try {
          const raw = await db.getSetting(`pro_telegram_config_${ownerId}`).catch(() => null);
          if (raw) {
            const tgCfg = JSON.parse(raw);
            if (tgCfg.bot_token && tgCfg.channel_id) tgs = [{ bot_token: tgCfg.bot_token, channel_id: tgCfg.channel_id }];
          }
        } catch {}
        tgCache.set(ownerId, tgs);
        return tgs;
      };

      const loadedIds = [];
      for (const entry of list) {
        try {
          const ownerId = entry.owner_user_id;
          if (!ownerId) { console.warn(`[Pro S${entry.id}] sans owner_user_id — ignoré`); continue; }
          if (!activeOwners.has(ownerId)) {
            console.log(`[Pro S${entry.id}] propriétaire ${ownerId} désactivé — stratégie inactive`);
            continue;
          }
          const content = await db.getSetting(`pro_strategy_${entry.id}_content`).catch(() => null);
          const metaRaw = await db.getSetting(`pro_strategy_${entry.id}_meta`).catch(() => null);
          if (!content) { console.warn(`[Pro S${entry.id}] contenu manquant — ignoré`); continue; }
          const meta = metaRaw ? JSON.parse(metaRaw) : entry;
          if (!meta.owner_user_id) meta.owner_user_id = ownerId;
          const tgTargets = await getTgFor(ownerId);
          const ft = (meta.file_type || entry.file_type || '').toLowerCase();
          if (ft === 'json') await this._loadJsonProStrategies(content, tgTargets, meta, entry.id);
          else if (ft === 'js' || ft === 'mjs') await this._loadJsProStrategy(content, tgTargets, meta, entry.id);
          else if (ft === 'py') await this._loadPyProStrategy(content, tgTargets, meta, entry.id);
          else { console.log(`[Pro S${entry.id}] Type "${ft}" non exécutable — référence uniquement`); continue; }
          // Marquer le owner sur le state pour usages futurs
          if (this.custom[entry.id] && this.custom[entry.id].config) {
            this.custom[entry.id].config.owner_user_id = ownerId;
          }
          loadedIds.push(`S${entry.id}`);
        } catch (e) { console.error(`[Pro S${entry.id}] Erreur chargement:`, e.message); }
      }
      await db.setSetting('pro_strategy_ids', JSON.stringify(loadedIds)).catch(() => {});
      console.log(`[Pro] ✅ ${loadedIds.length}/${list.length} stratégie(s) chargée(s) → ${loadedIds.join(', ') || '(aucune)'}`);
    } catch (e) { console.error('[Pro] loadProStrategies error:', e.message); }
  }

  // ── Chargement stratégies JSON (déclaratif, modes existants du moteur) ─────
  async _loadJsonProStrategies(content, tgTargets, fileMeta, proNumId) {
    let parsed;
    try { parsed = JSON.parse(content); } catch { console.error(`[Pro S${proNumId}] JSON invalide`); return; }
    const strategies = parsed.strategies || (parsed.strategy ? [parsed.strategy] : []);
    if (!strategies.length) { console.log(`[Pro S${proNumId}] Aucune stratégie dans le JSON`); return; }
    if (strategies.length > 1) {
      console.warn(`[Pro S${proNumId}] JSON contient ${strategies.length} stratégies — seule la 1ʳᵉ est chargée dans ce slot. Importez chaque stratégie dans son propre fichier pour utiliser plusieurs slots.`);
    }

    const proIds = [];
    {
      const stratCfg = strategies[0];
      const decalage = stratCfg.decalage !== undefined ? parseInt(stratCfg.decalage) : (stratCfg.prediction_offset !== undefined ? parseInt(stratCfg.prediction_offset) : 1);
      const cfg = {
        ...stratCfg,
        id: proNumId, is_pro: true, type: 'json',
        tg_targets: tgTargets,
        max_rattrapage: stratCfg.max_rattrapage !== undefined ? parseInt(stratCfg.max_rattrapage) : null,
        threshold: stratCfg.threshold !== undefined ? parseInt(stratCfg.threshold) : 5,
        prediction_offset: Math.max(1, decalage),
        bilan_format: parsed.bilan_format || stratCfg.bilan_format || null,
      };
      if (!this.custom[proNumId]) { this.custom[proNumId] = this._makeCustomState(); this.custom[proNumId].needsInit = true; }
      this.custom[proNumId].config = cfg;
      this.proStrategyIds.add(proNumId);
      proIds.push(`S${proNumId}`);
      console.log(`[Pro S${proNumId}] JSON "${cfg.name}" chargée (mode=${cfg.mode}, B=${cfg.threshold}, décalage=${cfg.prediction_offset}, tg=${tgTargets.length > 0})`);
    }
  }

  // ── Chargement stratégie JS (exécutée via vm Node.js) ─────────────────────
  // Le fichier .js doit exporter : { name, hand, decalage, max_rattrapage, processGame(gn, pSuits, bSuits, winner, state) }
  // processGame retourne : { suit: '♦' } ou null
  async _loadJsProStrategy(content, tgTargets, fileMeta, proNumId) {
    const vm = require('vm');

    let scriptModule;
    try {
      const moduleObj = { exports: {} };
      // ── API d'accès à la base `les_cartes` exposée comme variable globale `cartes` ──
      // Le script peut faire : await cartes.getCard(zk, 'player', 1)
      // Le numéro EN LIVE est rafraîchi à chaque appel via processGame(... , ctx).
      const cartesGlobal = cartesStore.buildCartesAPI({ liveGameNumber: null });
      const sandbox = {
        module: moduleObj, exports: moduleObj.exports,
        console: { log: (...a) => console.log('[Pro JS]', ...a), error: (...a) => console.error('[Pro JS]', ...a), warn: (...a) => console.warn('[Pro JS]', ...a) },
        setTimeout, clearTimeout, setInterval, clearInterval,
        Math, JSON, Date, parseInt, parseFloat, isNaN, isFinite, Array, Object, String, Number, Boolean, RegExp,
        Promise,
        cartes: cartesGlobal, // accès direct à la base les_cartes
        require: (m) => { if (['path','crypto','fs'].includes(m)) throw new Error(`Module "${m}" non autorisé dans les stratégies Pro`); return require(m); },
      };
      vm.createContext(sandbox);
      vm.runInContext(content, sandbox, { timeout: 5000, filename: fileMeta.filename || 'pro-strategy.js' });
      scriptModule = sandbox.module.exports;
    } catch (e) {
      console.error(`[Pro JS] Erreur d'exécution du script: ${e.message}`);
      return;
    }

    // Accepte plusieurs noms de fonction de prédiction
    const JS_ALT_FN = ['processGame', 'process_game', 'predict', 'run', 'strategy', 'handler'];
    let entryFn = null, entryName = null;
    if (typeof scriptModule === 'function') { entryFn = scriptModule; entryName = '(module.exports)'; }
    else if (scriptModule && typeof scriptModule === 'object') {
      for (const n of JS_ALT_FN) if (typeof scriptModule[n] === 'function') { entryFn = scriptModule[n]; entryName = n; break; }
    }
    if (!entryFn) {
      console.error(`[Pro JS] Aucune fonction de prédiction trouvée — noms acceptés : ${JS_ALT_FN.join(', ')}`);
      return;
    }
    // Alias : expose la fonction via processGame pour le reste du moteur
    if (typeof scriptModule === 'function' || entryName !== 'processGame') {
      const base = (typeof scriptModule === 'object' && scriptModule) ? scriptModule : {};
      scriptModule = Object.assign({}, base, { processGame: entryFn, _entryFn: entryName });
    }

    // Exceptions : lues depuis le module JS (scriptModule.exceptions) ou depuis la méta admin
    const _jsExceptions = Array.isArray(scriptModule.exceptions) ? scriptModule.exceptions
      : Array.isArray(fileMeta.exceptions) ? fileMeta.exceptions : [];
    const cfg = {
      id: proNumId, name: scriptModule.name || fileMeta.filename || 'Stratégie JS Pro',
      is_pro: true, type: 'script_js',
      hand: scriptModule.hand || 'joueur',
      decalage: Math.max(1, parseInt(scriptModule.decalage) || 1),
      max_rattrapage: (() => { const v = parseInt(scriptModule.max_rattrapage); return Number.isFinite(v) && v >= 0 ? v : 3; })(),
      tg_format: (() => { const v = parseInt(scriptModule.tg_format); return Number.isFinite(v) ? v : null; })(),
      tg_template: (typeof scriptModule.tg_template === 'string' && scriptModule.tg_template.trim()) ? scriptModule.tg_template.trim() : null,
      source_file: fileMeta.filename || null,
      tg_targets: tgTargets,
      enabled: scriptModule.enabled !== false,
      exceptions: _jsExceptions,
      _scriptModule: scriptModule,
    };

    if (!this.custom[proNumId]) this.custom[proNumId] = this._makeCustomState();
    this.custom[proNumId].config = cfg;
    this.custom[proNumId].scriptState = scriptModule.initState ? scriptModule.initState() : {};
    this.proStrategyIds.add(proNumId);
    console.log(`[Pro S${proNumId}] ✅ JS "${cfg.name}" chargée (hand=${cfg.hand}, décalage=${cfg.decalage}, maxR=${cfg.max_rattrapage}, fmt=${cfg.tg_format ?? 'global'}, tg=${tgTargets.length > 0})`);
  }

  // ── Chargement stratégie Python (exécutée via child_process) ──────────────
  // Le script reçoit JSON via stdin : { game_number, player_suits, banker_suits, winner, state }
  // Il doit écrire sur stdout : { result: { suit: '♦' } | null, state: {} }
  // En-tête obligatoire du script Python :
  //   import json, sys
  //   data = json.loads(sys.stdin.read())
  //   ...
  //   print(json.dumps({ "result": result, "state": state }))
  async _loadPyProStrategy(content, tgTargets, fileMeta, proNumId) {
    const fs = require('fs');
    const os = require('os');
    const path = require('path');

    // Écrire le script dans un fichier temporaire
    const tmpPath = path.join(os.tmpdir(), `pro_strategy_${proNumId}.py`);
    try { fs.writeFileSync(tmpPath, content, 'utf8'); } catch (e) { console.error('[Pro Py] Impossible d\'écrire le fichier temp:', e.message); return; }

    // ── Extraction des paramètres déclarés dans le script Python ──
    // Formats supportés : NAME = 'valeur'  |  HAND = "joueur"  |  DECALAGE = 2
    const extractPy = (varName, defaultVal, parser = v => v) => {
      const m = content.match(new RegExp(`^\\s*${varName}\\s*=\\s*([^\\n#]+)`, 'm'));
      if (!m) return defaultVal;
      const raw = m[1].trim().replace(/['"]/g, '').split('#')[0].trim();
      try { return parser(raw); } catch { return defaultVal; }
    };
    const pyName       = extractPy('NAME',          fileMeta.filename?.replace('.py','') || 'Stratégie Python Pro');
    const pyHand       = extractPy('HAND',          'joueur');
    const pyDecalage   = extractPy('DECALAGE',      1, v => Math.max(1, parseInt(v) || 1));
    const pyMaxR       = extractPy('MAX_RATTRAPAGE', 3, v => Math.max(1, parseInt(v) || 3));
    const pyTgFormat   = extractPy('TG_FORMAT',     null, v => parseInt(v) || null);

    // Extraction TG_TEMPLATE — supporte les chaînes simples, doubles et triples guillemets
    let pyTgTemplate = null;
    const tmplMatch = content.match(/^\s*TG_TEMPLATE\s*=\s*(?:"""([\s\S]*?)"""|'''([\s\S]*?)'''|"([^"]*)"|'([^']*)')/m);
    if (tmplMatch) {
      pyTgTemplate = (tmplMatch[1] ?? tmplMatch[2] ?? tmplMatch[3] ?? tmplMatch[4] ?? '').trim() || null;
    }

    const cfg = {
      id: proNumId, name: pyName,
      is_pro: true, type: 'script_py',
      hand: pyHand,
      decalage: pyDecalage,
      max_rattrapage: pyMaxR,
      tg_format: pyTgFormat,
      tg_template: pyTgTemplate,
      source_file: fileMeta.filename || null,
      tg_targets: tgTargets,
      enabled: true,
      exceptions: Array.isArray(fileMeta.exceptions) ? fileMeta.exceptions : [],
      _scriptPath: tmpPath,
    };

    if (!this.custom[proNumId]) this.custom[proNumId] = this._makeCustomState();
    this.custom[proNumId].config = cfg;
    this.custom[proNumId].scriptState = {};
    this.proStrategyIds.add(proNumId);
    console.log(`[Pro S${proNumId}] ✅ Python "${cfg.name}" chargée (hand=${cfg.hand}, décalage=${cfg.decalage}, maxR=${cfg.max_rattrapage}, fmt=${cfg.tg_format ?? 'global'}, tg=${tgTargets.length > 0})`);
  }

  async reloadProStrategies() {
    await this.loadProStrategies();
  }

  // ── Traitement d'une stratégie script (JS ou Python) ──────────────────────
  async _processScriptStrategy(id, state, cfg, gn, suits, bSuits, pCards, bCards, winner) {
    if (!this.custom[id]) return;
    const channelId = `S${id}`;
    const stratMaxR = cfg.max_rattrapage !== undefined ? parseInt(cfg.max_rattrapage) : 3;
    const stratTgOpts = { formatId: cfg.tg_format || null, tg_template: cfg.tg_template || null, hand: cfg.hand || 'joueur', maxR: stratMaxR };
    const handSuits = cfg.hand === 'banquier' ? (bSuits || []) : (suits || []);

    // 1. Résoudre les prédictions en attente
    if (Object.keys(state.pending).length > 0) {
      await this._resolvePending(state.pending, channelId, gn, handSuits, pCards, bCards, (won, ps) => {
        state.lastOutcomes.push({ won, suit: ps });
        if (state.lastOutcomes.length > 10) state.lastOutcomes.shift();
        if (won) this._onStratWin(channelId);
        else this._onStratLoss(channelId, gn, ps);
      }, stratMaxR, stratTgOpts, cfg.hand === 'banquier' ? bCards : pCards, winner);
    }

    if (state.processed.has(gn)) return;
    state.processed.add(gn);
    if (Object.keys(state.pending).length > 0) return; // prédiction en cours

    // 2. Appeler le script pour obtenir une prédiction
    let result = null;
    if (cfg.type === 'script_js') {
      result = await this._callJsStrategy(cfg, gn, suits, bSuits, winner, state);
    } else if (cfg.type === 'script_py') {
      result = await this._callPyStrategy(cfg, gn, suits, bSuits, winner, state);
    }

    if (!result || !result.suit) return;
    if (!ALL_SUITS.includes(result.suit)) { console.warn(`[${channelId}] Costume invalide retourné: ${result.suit}`); return; }

    // ── Calcul du numéro CIBLE ──────────────────────────────────────────────
    // Deux modes sont supportés :
    //   1) decalage (défaut)  →  target = gn + decalage
    //   2) proche  (live-based) →  target = liveGameNumber + p
    // Le mode "proche" est utile quand la stratégie veut prédire un numéro
    // proche du jeu EN LIVE actuel (ex. zk = go - h, nlv = go + h).
    let targetGn;
    let modeApplied;
    if (result.mode === 'proche') {
      const liveGn = this.liveGameCards?.gameNumber || gn;
      const p = Math.max(1, parseInt(result.p) || 1);
      targetGn = liveGn + p;
      modeApplied = `proche(p=${p}, live=${liveGn})`;
    } else {
      const dec = Math.max(1, parseInt(result.decalage || cfg.decalage || 1));
      targetGn = gn + dec;
      modeApplied = `decalage(${dec})`;
    }
    const ps = result.suit;

    // Vérification des exceptions (si définies dans la config Pro JS/Py)
    if (this._checkExceptions(cfg.exceptions, ps, ps, state, {})) {
      console.log(`[${channelId}] Prédiction #${targetGn} ${SUIT_DISPLAY[ps]||ps} bloquée par exception`);
      return;
    }

    // Garde 10 min
    if (!(await canEmitNewPrediction(channelId))) return;

    let inserted = false;
    try {
      inserted = await db.createPrediction({
        strategy: channelId, game_number: targetGn, predicted_suit: ps, triggered_by: ps,
        hand: cfg.hand || 'joueur',
        prediction_type: cfg.type || 'script_js',
        decalage_applied: result.mode === 'proche'
          ? 0
          : Math.max(1, parseInt(result.decalage || cfg.decalage || 1)),
        confidence: result.confidence !== undefined ? parseInt(result.confidence) : 100,
        source_file: cfg.source_file || null,
        display_name: cfg.name || null,
        extra_data: Object.assign({ mode: result.mode || 'decalage', p: result.p ?? null }, result.meta || {}),
      });
      if (inserted) {
        console.log(`[${channelId}] Script prédit #${targetGn} ${SUIT_DISPLAY[ps]||ps} (${cfg.type}, hand=${cfg.hand||'joueur'}, fmt=${cfg.tg_format ?? 'global'}, ${modeApplied})`);
      } else {
        console.warn(`[${channelId}] Prédiction #${targetGn} déjà existante — doublon ignoré`);
      }
    } catch (e) { console.error(`[${channelId}] createPrediction error:`, e.message); }

    state.pending[targetGn] = { suit: ps, rattrapage: 0, maxR: stratMaxR };
    if (!inserted) return;

    // Envoi Telegram
    if (cfg.is_pro && this._proTelegramEnabled === false) { console.log(`[${channelId}] Pro Telegram suspendu`); return; }
    if (!(await this._isOwnerActive(cfg))) { console.log(`[${channelId}] ⛔ envoi Telegram bloqué (abonnement expiré)`); return; }
    const tgs = Array.isArray(cfg.tg_targets) ? cfg.tg_targets.filter(t => t.bot_token && t.channel_id) : [];
    if (tgs.length > 0) {
      sendCustomAndStore(tgs, channelId, targetGn, ps, stratTgOpts).catch(() => {});
    } else {
      sendToStrategyChannels(channelId, targetGn, ps, stratTgOpts).catch(() => {});
    }
  }

  // ── Normalisation d'un retour de stratégie vers { suit, decalage?, mode?, p?, confidence?, meta? }
  // Modes supportés :
  //   • mode='decalage' (défaut) : target = gn (déclencheur) + decalage
  //   • mode='proche'            : target = liveGameNumber + p   (proche du live)
  // Alias acceptés : `proche_de: <p>` équivaut à `mode:'proche', p:<p>`
  _normalizeStrategyResult(r) {
    if (r === null || r === undefined) return null;
    if (typeof r === 'string') return ['♠','♥','♦','♣'].includes(r) ? { suit: r } : null;
    if (typeof r !== 'object') return null;
    let suit = r.suit || r.predicted || r.prediction || null;
    if (!suit && Array.isArray(r.suits) && r.suits.length) suit = r.suits[0];
    if (!suit) return null;
    if (!['♠','♥','♦','♣'].includes(suit)) return null;
    // Détection du mode "proche de"
    let mode = (r.mode || '').toString().toLowerCase();
    let p    = r.p !== undefined ? r.p : (r.proche_de !== undefined ? r.proche_de : undefined);
    if (mode !== 'proche' && r.proche_de !== undefined) mode = 'proche';
    return {
      suit,
      decalage:   r.decalage !== undefined ? r.decalage : undefined,
      mode:       mode || undefined,
      p:          p   !== undefined ? p   : undefined,
      confidence: r.confidence !== undefined ? r.confidence : undefined,
      meta:       r.meta || undefined,
    };
  }

  // ── Logs en direct par stratégie Pro ──────────────────────────────────────
  _pushProLog(proNumId, level, msg) {
    if (proNumId === undefined || proNumId === null) return;
    if (!this.proLogs[proNumId]) this.proLogs[proNumId] = [];
    const buf = this.proLogs[proNumId];
    buf.push({ ts: Date.now(), level, msg: String(msg) });
    if (buf.length > this._PRO_LOG_MAX) buf.splice(0, buf.length - this._PRO_LOG_MAX);
    this._scheduleProLogsSave();
  }

  _scheduleProLogsSave() {
    if (this._proLogsSaveTimer) return;
    this._proLogsSaveTimer = setTimeout(async () => {
      this._proLogsSaveTimer = null;
      try { await db.setSetting('pro_logs_state', JSON.stringify(this.proLogs)); }
      catch (e) { console.error('[Engine] save proLogs:', e.message); }
    }, 2000);
  }

  async _loadProLogsState() {
    try {
      const raw = await db.getSetting('pro_logs_state');
      if (raw) {
        const parsed = JSON.parse(raw);
        if (parsed && typeof parsed === 'object') this.proLogs = parsed;
      }
    } catch (e) { console.error('[Engine] load proLogs:', e.message); }
  }

  // Wrap console.log/error pendant l'appel d'une stratégie Pro pour capter sa sortie
  async _runWithProLogCapture(proNumId, fn) {
    const origLog  = console.log;
    const origWarn = console.warn;
    const origErr  = console.error;
    const fmt = (args) => args.map(a => {
      if (a === null || a === undefined) return String(a);
      if (typeof a === 'string') return a;
      try { return JSON.stringify(a); } catch { return String(a); }
    }).join(' ');
    console.log   = (...args) => { try { this._pushProLog(proNumId, 'log',  fmt(args)); } catch {} origLog.apply(console, args); };
    console.warn  = (...args) => { try { this._pushProLog(proNumId, 'warn', fmt(args)); } catch {} origWarn.apply(console, args); };
    console.error = (...args) => { try { this._pushProLog(proNumId, 'error', fmt(args)); } catch {} origErr.apply(console, args); };
    try {
      return await fn();
    } finally {
      console.log = origLog; console.warn = origWarn; console.error = origErr;
    }
  }

  // Accès public utilisé par /api/games/pro-logs
  getProLogs(channelKey) {
    if (!channelKey) return [];
    const m = /^S(\d{4,5})$/.exec(channelKey);
    if (!m) return [];
    const id = parseInt(m[1]);
    return (this.proLogs[id] || []).slice(-this._PRO_LOG_MAX);
  }
  clearProLogs(channelKey) {
    if (!channelKey) { this.proLogs = {}; this._scheduleProLogsSave(); return; }
    const m = /^S(\d{4,5})$/.exec(channelKey);
    if (!m) return;
    const id = parseInt(m[1]);
    delete this.proLogs[id];
    this._scheduleProLogsSave();
  }

  // ── Appel JS (vm sandbox) ─────────────────────────────────────────────────
  async _callJsStrategy(cfg, gn, suits, bSuits, winner, state) {
    try {
      const mod = cfg._scriptModule;
      if (!mod || typeof mod.processGame !== 'function') return null;
      if (!state.scriptState) state.scriptState = mod.initState ? mod.initState() : {};

      // ── Pré-chargement de la base `cartes_jeu` pour les scripts JS ──
      // De nombreux scripts attendent `state.dbData[N]` (clé = numéro de jeu)
      // pour lire des jeux passés sans faire d'appel async. On garnit donc
      // automatiquement state.scriptState.dbData à partir de cartes_jeu :
      //   • au premier appel : on charge un snapshot des 500 derniers jeux,
      //   • à chaque appel  : on ajoute le jeu courant si absent.
      // Ceci permet aux scripts utilisant `state.dbData[zk]` (style « judo »)
      // de prédire dès le départ, sans devoir attendre N jeux live.
      if (!state.scriptState.dbData || typeof state.scriptState.dbData !== 'object') {
        state.scriptState.dbData = {};
      }
      if (!state.scriptState._dbDataLoaded) {
        state.scriptState._dbDataLoaded = true;
        try {
          const recent = await cartesStore.listRecent(500);
          for (const row of recent) {
            const pSuits = [row.p1_s, row.p2_s, row.p3_s].filter(s => s != null);
            const bSuits2 = [row.b1_s, row.b2_s, row.b3_s].filter(s => s != null);
            const pCards = [
              row.p1_r != null ? { R: row.p1_r, S: row.p1_s } : null,
              row.p2_r != null ? { R: row.p2_r, S: row.p2_s } : null,
              row.p3_r != null ? { R: row.p3_r, S: row.p3_s } : null,
            ].filter(Boolean);
            const bCards = [
              row.b1_r != null ? { R: row.b1_r, S: row.b1_s } : null,
              row.b2_r != null ? { R: row.b2_r, S: row.b2_s } : null,
              row.b3_r != null ? { R: row.b3_r, S: row.b3_s } : null,
            ].filter(Boolean);
            state.scriptState.dbData[row.game_number] = {
              gameNumber: row.game_number,
              playerSuits: pSuits,
              bankerSuits: bSuits2,
              playerCards: pCards,
              bankerCards: bCards,
              winner: row.winner || null,
              dist: row.dist || null,
            };
          }
        } catch (e) {
          // Ne bloque pas la stratégie si la lecture échoue
          this._pushProLog(cfg.id, 'log', `[engine] préchargement dbData impossible : ${e.message}`);
        }
      }
      // Toujours indexer le jeu courant dans dbData (utile pour les jeux récents)
      if (gn != null && Array.isArray(suits) && suits.length > 0) {
        state.scriptState.dbData[gn] = {
          gameNumber: gn,
          playerSuits: suits.slice(),
          bankerSuits: (bSuits || []).slice(),
          winner: winner || null,
        };
      }

      // Contexte runtime passé en 6e argument : { live: { gameNumber }, cartes }
      const liveGn = this.liveGameCards?.gameNumber || null;
      const ctx = {
        live: {
          gameNumber: liveGn,
          phase: this.liveGameCards?.phase || null,
          playerCards: this.liveGameCards?.playerCards || [],
          bankerCards: this.liveGameCards?.bankerCards || [],
        },
        cartes: cartesStore.buildCartesAPI({ liveGameNumber: liveGn }),
      };
      const raw = await this._runWithProLogCapture(cfg.id, () => Promise.resolve(
        mod.processGame(gn, suits || [], bSuits || [], winner, state.scriptState, ctx)
      ));
      const norm = this._normalizeStrategyResult(raw);
      // Trace automatique : on garde une trace de chaque appel, même quand la stratégie ne prédit rien
      try {
        const pStr = (suits  || []).join(' ') || '∅';
        const bStr = (bSuits || []).join(' ') || '∅';
        if (norm && norm.suit) {
          this._pushProLog(cfg.id, 'log', `▶ #${gn} J:${pStr} | B:${bStr} | W:${winner||'-'} → PRÉDICTION ${norm.suit}`);
        } else {
          this._pushProLog(cfg.id, 'log', `· #${gn} J:${pStr} | B:${bStr} | W:${winner||'-'} → (pas de prédiction)`);
        }
      } catch {}
      return norm;
    } catch (e) {
      this._pushProLog(cfg.id, 'error', `processGame error à jeu #${gn}: ${e.message}`);
      console.error(`[Pro JS] processGame error à jeu #${gn}:`, e.message);
      return null;
    }
  }

  // ── Appel Python (child_process stdin/stdout JSON) ────────────────────────
  async _callPyStrategy(cfg, gn, suits, bSuits, winner, state) {
    const { spawnSync } = require('child_process');
    if (!state.scriptState) state.scriptState = {};
    // ── Pré-chargement de la base `les_cartes` pour les scripts Python ──
    // On ne peut pas exposer une API async à un sous-process synchrone,
    // donc on fournit en input un instantané utile :
    //   • cartes_recent  : 50 derniers jeux enregistrés
    //   • live           : numéro live courant (ou null)
    const liveGn = this.liveGameCards?.gameNumber || null;
    let cartesRecent = [];
    let cartesNear   = [];
    try { cartesRecent = await cartesStore.listRecent(50); } catch {}
    try {
      if (liveGn != null) {
        // Plage par défaut : 50 jeux en arrière depuis le live (suffisant pour
        // la plupart des stratégies "proche de"). Le script peut filtrer.
        cartesNear = await cartesStore.listRecent(50, { fromGn: liveGn - 50, toGn: liveGn });
      }
    } catch {}
    const input = JSON.stringify({
      game_number: gn,
      player_suits: suits || [],
      banker_suits: bSuits || [],
      winner: winner || null,
      state: state.scriptState,
      live: { game_number: liveGn },
      cartes_recent: cartesRecent,
      cartes_near:   cartesNear,
    });
    try {
      const proc = spawnSync('python3', [cfg._scriptPath], {
        input, encoding: 'utf8', timeout: 5000,
        env: { ...process.env, PYTHONPATH: '', PYTHONUNBUFFERED: '1' },
      });
      if (proc.error) { this._pushProLog(cfg.id, 'error', `spawn: ${proc.error.message}`); console.error('[Pro Py] Erreur spawn:', proc.error.message); return null; }
      if (proc.stderr) {
        const s = proc.stderr.trim();
        if (s) {
          // Chaque ligne stderr du script Python devient une ligne de log Pro
          for (const ln of s.split('\n')) { if (ln.trim()) this._pushProLog(cfg.id, 'log', ln.trim()); }
          console.warn('[Pro Py] stderr:', s.substring(0, 200));
        }
      }
      if (!proc.stdout?.trim()) return null;
      const out = JSON.parse(proc.stdout.trim());
      if (out.state) state.scriptState = out.state;
      if (Array.isArray(out.logs)) { for (const ln of out.logs) this._pushProLog(cfg.id, 'log', String(ln)); }
      return this._normalizeStrategyResult(out.result);
    } catch (e) { this._pushProLog(cfg.id, 'error', `lecture résultat: ${e.message}`); console.error('[Pro Py] Erreur lecture résultat:', e.message); return null; }
  }

  // ── Envoyer un message texte brut via Telegram (notifications Pro) ────────
  async _sendRawProTelegram(text, ownerId = null) {
    try {
      let cfgRaw = null;
      if (ownerId) {
        cfgRaw = await db.getSetting(`pro_telegram_config_${ownerId}`).catch(() => null);
      }
      // Fallback : envoyer via la config du premier admin si owner non précisé
      if (!cfgRaw) {
        try {
          const all = await db.getAllUsers();
          const adm = all.find(u => u.is_admin);
          if (adm) cfgRaw = await db.getSetting(`pro_telegram_config_${adm.id}`).catch(() => null);
        } catch {}
      }
      if (!cfgRaw) return false;
      const { bot_token, channel_id } = JSON.parse(cfgRaw);
      if (!bot_token || !channel_id) return false;
      const r = await fetch(`https://api.telegram.org/bot${bot_token}/sendMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chat_id: channel_id, text, parse_mode: 'HTML' }),
      });
      const data = await r.json();
      return data.ok === true;
    } catch (e) { console.error('[Pro] _sendRawProTelegram error:', e.message); return false; }
  }

  // ── Vérification des abonnements Pro + notification expiration ─────────────
  async checkProSubscriptions() {
    try {
      // Aucune stratégie Pro chargée → rien à vérifier
      if (!this.proStrategyIds || this.proStrategyIds.size === 0) return;

      const proUsers = await db.getProUsers().catch(() => []);
      if (!proUsers.length) return;

      const now = new Date();

      for (const user of proUsers) {
        const key = `pro_expiry_notif_${user.id}`;
        const lastNotif = this._proExpiryNotifs?.[user.id];

        if (!user.subscription_expires_at) continue;
        const expires = new Date(user.subscription_expires_at);
        const diffMs = expires.getTime() - now.getTime();
        const diffMin = Math.floor(diffMs / 60000);

        // Déjà notifié pour cette expiration → skip
        if (lastNotif && lastNotif >= expires.getTime()) continue;

        // Expiré : envoyer notification et désactiver les prédictions Pro pour cet utilisateur
        if (diffMs <= 0) {
          const displayName = user.first_name || user.username;
          const msg = `⏰ <b>Abonnement Pro expiré</b>\n\nDurée restante : <b>00</b>\n👤 Constater ${displayName} pour renouveler votre abonnement Pro.\n📞 Contacter <b>Sossou Kouamé</b> pour renouveler votre abonnement.`;
          const sent = await this._sendRawProTelegram(msg, user.id);
          if (sent) {
            console.log(`[Pro] Notification expiration envoyée pour ${user.username}`);
            if (!this._proExpiryNotifs) this._proExpiryNotifs = {};
            this._proExpiryNotifs[user.id] = expires.getTime();
          }
        }
        // Expire dans moins de 60 minutes → avertissement préalable
        else if (diffMin <= 60 && diffMin > 0) {
          if (!this._proExpiryWarnings) this._proExpiryWarnings = {};
          const lastWarn = this._proExpiryWarnings[user.id];
          if (!lastWarn || (now.getTime() - lastWarn) > 30 * 60 * 1000) { // Max 1 avertissement / 30 min
            const displayName = user.first_name || user.username;
            const msg = `⚠️ <b>Abonnement Pro — Expiration imminente</b>\n\n⏳ Il reste <b>${diffMin} minute${diffMin > 1 ? 's' : ''}</b> à l'abonnement de ${displayName}.\n📞 Contacter <b>Sossou Kouamé</b> pour renouveler.`;
            const sent = await this._sendRawProTelegram(msg, user.id);
            if (sent) {
              this._proExpiryWarnings[user.id] = now.getTime();
              console.log(`[Pro] Avertissement expiration dans ${diffMin} min pour ${user.username}`);
            }
          }
        }
      }

      // Vérifier s'il reste des utilisateurs Pro actifs : si aucun, désactiver l'envoi Telegram Pro
      const activeProUsers = proUsers.filter(u => {
        if (!u.subscription_expires_at) return false;
        return new Date(u.subscription_expires_at) > now;
      });
      this._proTelegramEnabled = activeProUsers.length > 0;
      if (!this._proTelegramEnabled && proUsers.length > 0) {
        console.log('[Pro] Aucun utilisateur Pro actif — envoi Telegram Pro suspendu');
      }
    } catch (e) { console.error('[Pro] checkProSubscriptions error:', e.message); }
  }

  async processGame(gn, suits, bSuits, pCards, bCards, winner = null) {
    this.gameCardsCache[gn] = { player: suits || [], banker: bSuits || [] };
    const cacheKeys = Object.keys(this.gameCardsCache).map(Number).sort((a, b) => a - b);
    while (cacheKeys.length > 100) { delete this.gameCardsCache[cacheKeys.shift()]; }

    await this._processC1(gn, suits, pCards, bCards);
    await this._processC2(gn, suits, pCards, bCards);
    await this._processC3(gn, suits, pCards, bCards);
    await this._processDC(gn, suits, pCards, bCards);
    // Passe 1 : stratégies simples (hors multi_strategy, relance, et scripts)
    for (const [id, state] of Object.entries(this.custom)) {
      const cfg = state.config;
      if (!cfg?.enabled) continue;
      // Stratégies script JS/Python → traitement dédié
      if (cfg.type === 'script_js' || cfg.type === 'script_py') {
        await this._processScriptStrategy(parseInt(id), state, cfg, gn, suits, bSuits, pCards, bCards, winner);
        continue;
      }
      // Stratégies JSON déclaratives standard
      if (cfg.mode !== 'multi_strategy' && cfg.mode !== 'union_enseignes' && cfg.mode !== 'relance' && cfg.mode !== 'intersection') {
        await this._processCustomStrategy(parseInt(id), state, cfg, gn, suits, bSuits, pCards, bCards, winner);
      }
    }
    // Passe 2 : stratégies combinaison (peuvent lire les pending des simples)
    for (const [id, state] of Object.entries(this.custom)) {
      const m = state.config?.mode;
      if (!state.config?.enabled) continue;
      if (m === 'multi_strategy') {
        await this._processMultiStrategy(parseInt(id), state, state.config, gn, suits, bSuits, pCards, bCards);
      } else if (m === 'union_enseignes') {
        await this._processUnionEnseignes(parseInt(id), state, state.config, gn, suits, bSuits, pCards, bCards);
      } else if (m === 'intersection') {
        await this._processIntersection(parseInt(id), state, state.config, gn, suits, bSuits, pCards, bCards, winner);
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

    let inserted = false;
    try {
      inserted = await db.createPrediction({ strategy: channelId, game_number: targetGame, predicted_suit: ps, triggered_by: `multi:${signals.map(s=>s.srcId).join(',')}` });
      if (inserted) {
        console.log(`[${channelId}] Multi-strat prédiction #${targetGame} ${SUIT_DISPLAY[ps]||ps} (${matchMode}, sources: ${signals.map(s=>s.srcId).join(',')})`);
      } else {
        console.warn(`[${channelId}] Multi-strat prédiction #${targetGame} déjà existante — Telegram ignoré (doublon évité)`);
      }
    } catch (e) { console.error(`createPrediction ${channelId} error:`, e.message); }
    state.pending[targetGame] = { suit: ps, rattrapage: 0, maxR: stratMaxR };
    if (!inserted) return;

    if (!(await this._isOwnerActive(cfg))) { console.log(`[${channelId}] ⛔ envoi Telegram bloqué (abonnement expiré)`); return; }
    const tgs = Array.isArray(cfg.tg_targets) ? cfg.tg_targets.filter(t => t.bot_token && t.channel_id) : [];
    if (tgs.length > 0) {
      sendCustomAndStore(tgs, channelId, targetGame, ps, stratTgOpts).catch(() => {});
    } else {
      sendToStrategyChannels(channelId, targetGame, ps, stratTgOpts).catch(() => {});
    }
  }

  async _processUnionEnseignes(id, state, cfg, gn, suits, bSuits, pCards, bCards) {
    // ── MODE UNION ENSEIGNES ──────────────────────────────────────────────
    // Agrège les prédictions en cours de plusieurs stratégies sources.
    // Quand au moins B stratégies sources prédisent le MÊME costume pour le
    // prochain jeu (gn + offset) → émet ce costume.
    // ─────────────────────────────────────────────────────────────────────
    if (!this.custom[id]) return;
    const channelId  = `S${id}`;
    const handSuits  = cfg.hand === 'banquier' ? (bSuits || []) : suits;
    const stratMaxR  = (cfg.max_rattrapage !== undefined && cfg.max_rattrapage !== null)
      ? parseInt(cfg.max_rattrapage) : getCurrentMaxRattrapage();
    const stratTgOpts = { formatId: cfg.tg_format || null, hand: cfg.hand || 'joueur', maxR: stratMaxR };
    const offset      = Math.max(1, parseInt(cfg.prediction_offset) || 1);
    const targetGame  = gn + offset;
    const B           = parseInt(cfg.threshold) || 2; // nb min de stratégies en accord

    // Résoudre les pending en cours avant de chercher un nouveau déclenchement
    if (Object.keys(state.pending).length > 0) {
      await this._resolvePending(state.pending, channelId, gn, handSuits, pCards, bCards, (won, ps, pg, rattrapR) => {
        state.lastOutcomes.push({ won, suit: ps });
        if (state.lastOutcomes.length > 10) state.lastOutcomes.shift();
        if (won) this._onStratWin(channelId, gn, ps);
        else     this._onStratLoss(channelId, gn, ps);
        this._updateBadPredBlocker(channelId, gn, state);
      }, stratMaxR, stratTgOpts, null, null);
    }
    if (Object.keys(state.pending).length > 0) return;

    const sources = Array.isArray(cfg.multi_source_ids) ? cfg.multi_source_ids : [];
    if (sources.length === 0) return;

    const _pendingFor = (sid) => {
      const k = String(sid).toUpperCase();
      if (k === 'C1') return this.c1.pending;
      if (k === 'C2') return this.c2.pending;
      if (k === 'C3') return this.c3.pending;
      if (k === 'DC') return this.dc.pending;
      const numId = parseInt(sid.toString().replace(/^S/i, ''));
      return this.custom[numId]?.pending || null;
    };

    // Pour chaque source, chercher une prédiction pour targetGame OU une quelconque en attente
    const suitVotes = {};
    for (const srcId of sources) {
      const pend = _pendingFor(srcId);
      if (!pend) continue;
      // Prédiction exacte pour targetGame
      if (pend[targetGame]) {
        const s = pend[targetGame].suit;
        if (ALL_SUITS.includes(s)) suitVotes[s] = (suitVotes[s] || 0) + 1;
      } else {
        // Toute prédiction en attente (la plus proche)
        const gnums = Object.keys(pend).map(Number).filter(g => g >= gn).sort((a, b) => a - b);
        if (gnums.length > 0) {
          const s = pend[gnums[0]].suit;
          if (ALL_SUITS.includes(s)) suitVotes[s] = (suitVotes[s] || 0) + 1;
        }
      }
    }

    // Trouver le costume avec le plus de votes atteignant le seuil B
    const best = Object.entries(suitVotes).filter(([, v]) => v >= B).sort((a, b) => b[1] - a[1])[0];
    if (!best) return;
    const [topSuit] = best;

    // Appliquer mappings si configurés
    const rawMapping = cfg.mappings?.[topSuit];
    const pool = Array.isArray(rawMapping) ? rawMapping.filter(s => ALL_SUITS.includes(s))
               : (ALL_SUITS.includes(rawMapping) ? [rawMapping] : [topSuit]);
    const ps = pool.length > 0 ? pool[Math.floor(Math.random() * pool.length)] : topSuit;

    // Vérifier exception
    const exceptions = cfg.exceptions || [];
    if (this._checkExceptions(exceptions, ps, topSuit, state, { pCards, bCards, hand: cfg.hand || 'joueur' })) return;

    let inserted = false;
    try {
      inserted = await db.createPrediction({ strategy: channelId, game_number: targetGame, predicted_suit: ps, triggered_by: `union:${sources.join(',')}` });
      if (inserted) {
        console.log(`[${channelId}] [UnionEnseignes] ${best[1]} sources accordées sur ${SUIT_DISPLAY[topSuit]||topSuit} → jeu #${targetGame} → ${SUIT_DISPLAY[ps]||ps}`);
      } else {
        console.warn(`[${channelId}] [UnionEnseignes] Prédiction #${targetGame} déjà existante`);
      }
    } catch (e) { console.error(`[${channelId}] [UnionEnseignes] createPrediction error:`, e.message); }
    state.pending[targetGame] = { suit: ps, rattrapage: 0, maxR: stratMaxR };
    if (!inserted) return;

    if (!(await this._isOwnerActive(cfg))) { console.log(`[${channelId}] ⛔ envoi Telegram bloqué (abonnement expiré)`); return; }
    const tgs = Array.isArray(cfg.tg_targets) ? cfg.tg_targets.filter(t => t.bot_token && t.channel_id) : [];
    if (tgs.length > 0) {
      sendCustomAndStore(tgs, channelId, targetGame, ps, stratTgOpts).catch(() => {});
    } else {
      sendToStrategyChannels(channelId, targetGame, ps, stratTgOpts).catch(() => {});
    }
  }

  async _processIntersection(id, state, cfg, gn, suits, bSuits, pCards, bCards, winner) {
    // ── MODE INTERSECTION ─────────────────────────────────────────────────
    // Surveille toutes les stratégies existantes de la MÊME main.
    // Quand au moins `hi` stratégies prédisent le même résultat sur des
    // numéros proches (écart ≤ inter_max_ecart) → émet sur le min jeu.
    // ─────────────────────────────────────────────────────────────────────
    if (!this.custom[id]) return;
    const channelId  = `S${id}`;
    const hand       = cfg.hand || 'joueur';
    const handSuits  = hand === 'banquier' ? (bSuits || []) : suits;
    const stratMaxR  = (cfg.max_rattrapage !== undefined && cfg.max_rattrapage !== null)
      ? parseInt(cfg.max_rattrapage) : getCurrentMaxRattrapage();
    const stratTgOpts = { formatId: cfg.tg_format || null, hand, maxR: stratMaxR };

    // ── Résoudre les pending en cours ──
    if (Object.keys(state.pending).length > 0) {
      await this._resolvePending(state.pending, channelId, gn, handSuits, pCards, bCards, (won, ps, pg) => {
        state.lastOutcomes.push({ won, suit: ps });
        if (state.lastOutcomes.length > 10) state.lastOutcomes.shift();
        if (won) this._onStratWin(channelId, gn, ps);
        else     this._onStratLoss(channelId, gn, ps);
        this._updateBadPredBlocker(channelId, gn, state);
      }, stratMaxR, stratTgOpts, null, null);
    }
    if (Object.keys(state.pending).length > 0) return;

    const hi       = Math.max(2, parseInt(cfg.inter_hi) || 2);
    const maxEcart = Math.max(0, parseInt(cfg.inter_max_ecart) || 2);
    const category = cfg.inter_category || 'costume';

    // ── Collecter les pending de toutes les autres stratégies custom de la même main ──
    // Chaque entrée : { suit, gameNumber }
    const candidates = [];

    for (const [otherId, otherState] of Object.entries(this.custom)) {
      if (parseInt(otherId) === id) continue;
      const oCfg = otherState.config;
      if (!oCfg?.enabled) continue;
      if ((oCfg.hand || 'joueur') !== hand) continue;
      // Filtrage par catégorie
      if (!this._interMatchCategory(oCfg, category)) continue;

      for (const [pgStr, info] of Object.entries(otherState.pending || {})) {
        const pg = parseInt(pgStr);
        if (pg < gn) continue; // prédiction expirée côté jeux passés
        const suit = info.suit;
        if (!suit || !ALL_SUITS.includes(suit)) continue;
        candidates.push({ suit, gameNumber: pg });
      }
    }

    if (candidates.length < hi) return;

    // ── Regrouper par costume, trouver le groupe qui respecte hi + écart ──
    const bySuit = {};
    for (const c of candidates) {
      if (!bySuit[c.suit]) bySuit[c.suit] = [];
      bySuit[c.suit].push(c.gameNumber);
    }

    let chosenSuit = null;
    let chosenGameNumber = null;

    for (const [suit, gnums] of Object.entries(bySuit)) {
      if (gnums.length < hi) continue;
      gnums.sort((a, b) => a - b);
      // Fenêtre glissante de taille hi pour trouver hi éléments consécutifs avec écart ≤ maxEcart
      for (let i = 0; i <= gnums.length - hi; i++) {
        const window = gnums.slice(i, i + hi);
        const ecart  = window[window.length - 1] - window[0];
        if (ecart <= maxEcart) {
          chosenSuit       = suit;
          chosenGameNumber = window[0]; // émettre sur le premier (plus petit)
          break;
        }
      }
      if (chosenSuit) break;
    }

    if (!chosenSuit || chosenGameNumber === null) return;

    // ── Appliquer mappings si configurés ──
    const rawMapping = cfg.mappings?.[chosenSuit];
    const pool = Array.isArray(rawMapping)
      ? rawMapping.filter(s => ALL_SUITS.includes(s))
      : (ALL_SUITS.includes(rawMapping) ? [rawMapping] : [chosenSuit]);
    const ps = pool.length > 0 ? pool[Math.floor(Math.random() * pool.length)] : chosenSuit;

    // ── Vérifier exceptions ──
    const exceptions = cfg.exceptions || [];
    if (this._checkExceptions(exceptions, ps, chosenSuit, state, { pCards, bCards, hand })) return;

    let inserted = false;
    try {
      inserted = await db.createPrediction({ strategy: channelId, game_number: chosenGameNumber, predicted_suit: ps, triggered_by: `intersection:${category}:hi${hi}` });
      if (inserted) {
        console.log(`[${channelId}] [Intersection] accord hi=${hi} sur ${SUIT_DISPLAY[chosenSuit]||chosenSuit} → jeu #${chosenGameNumber} → ${SUIT_DISPLAY[ps]||ps}`);
      } else {
        console.warn(`[${channelId}] [Intersection] Prédiction #${chosenGameNumber} déjà existante`);
      }
    } catch (e) { console.error(`[${channelId}] [Intersection] createPrediction error:`, e.message); }
    state.pending[chosenGameNumber] = { suit: ps, rattrapage: 0, maxR: stratMaxR };
    if (!inserted) return;

    if (!(await this._isOwnerActive(cfg))) { console.log(`[${channelId}] ⛔ envoi Telegram bloqué (abonnement expiré)`); return; }
    const tgs = Array.isArray(cfg.tg_targets) ? cfg.tg_targets.filter(t => t.bot_token && t.channel_id) : [];
    if (tgs.length > 0) {
      sendCustomAndStore(tgs, channelId, chosenGameNumber, ps, stratTgOpts).catch(() => {});
    } else {
      sendToStrategyChannels(channelId, chosenGameNumber, ps, stratTgOpts).catch(() => {});
    }
  }

  // Vérifie si une stratégie correspond à une catégorie d'intersection
  _interMatchCategory(oCfg, category) {
    const mode = oCfg.mode || '';
    switch (category) {
      case 'costume':
        // Modes basés sur les costumes (♠♥♦♣) — la plupart des modes standards
        return !['victoire_adverse', 'absence_victoire', 'carte_valeur', 'intersection', 'multi_strategy', 'union_enseignes', 'relance', 'aleatoire', 'distribution'].includes(mode);
      case 'victoire':
        return mode === 'victoire_adverse' || mode === 'absence_victoire';
      case '2_2':
        // 2 cartes joueur + 2 cartes banquier
        return mode === 'carte_2_vers_3' || mode === 'abs_3_vers_2';
      case '2_3':
        return mode === 'carte_2_vers_3';
      case '3_2':
        return mode === 'carte_3_vers_2' || mode === 'abs_3_vers_2';
      case '3_3':
        return mode === 'carte_3_vers_2' && oCfg.hand === 'banquier';
      default:
        return true;
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

  async _resolvePending(pending, strategy, gn, suits, pCards, bCards, onLoss, maxR = null, tgOpts = {}, handCards = null, winner = null) {
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
        continue; // skip la résolution par costume normale

      // ── Résolution spéciale mode Carte 2/3 ─────────────────────────────
      } else if (ps === 'deux' || ps === 'trois') {
        const hc = Array.isArray(handCards) ? handCards : Array.isArray(pCards) ? pCards : [];
        const targetCount = ps === 'deux' ? 2 : 3;
        if (hc.length === targetCount) {
          const rattrapage = gn - pgNum;
          console.log(`[${strategy}] [Carte${targetCount}] Jeu #${gn} = ${targetCount} cartes → gagne (R${rattrapage})`);
          await resolvePrediction(strategy, pgNum, ps, 'gagne', rattrapage, pCards, bCards, tgOpts);
          delete pending[pg];
          if (onLoss) onLoss(true, ps, pgNum, rattrapage);
        } else if (gn === pgNum + effectiveMaxR) {
          console.log(`[${strategy}] [Carte${targetCount}] Jeu #${gn} = pas ${targetCount} cartes après ${effectiveMaxR} tentatives → perdu`);
          await resolvePrediction(strategy, pgNum, ps, 'perdu', effectiveMaxR, pCards, bCards, tgOpts);
          delete pending[pg];
          if (onLoss) onLoss(false, ps, pgNum, effectiveMaxR);
        }
        continue;

      // ── Résolution spéciale mode Victoire Adverse ───────────────────────
      } else if (ps === 'WIN_B' || ps === 'WIN_P') {
        const expectedWinner = ps === 'WIN_B' ? 'Banker' : 'Player';
        if (winner === expectedWinner) {
          const rattrapage = gn - pgNum;
          console.log(`[${strategy}] [Victoire Adverse] ✅ ${expectedWinner} gagne → gagne (R${rattrapage})`);
          await resolvePrediction(strategy, pgNum, ps, 'gagne', rattrapage, pCards, bCards, tgOpts);
          delete pending[pg];
          if (onLoss) onLoss(true, ps, pgNum, rattrapage);
        } else if (gn === pgNum + effectiveMaxR) {
          console.log(`[${strategy}] [Victoire Adverse] ${expectedWinner} ne gagne pas après ${effectiveMaxR} tentatives → perdu`);
          await resolvePrediction(strategy, pgNum, ps, 'perdu', effectiveMaxR, pCards, bCards, tgOpts);
          delete pending[pg];
          if (onLoss) onLoss(false, ps, pgNum, effectiveMaxR);
        }
        continue;

      // ── Résolution spéciale mode Écart 2/3 ─────────────────────────────
      } else if (ps === 'TWO_THREE') {
        const isMixed = Array.isArray(pCards) && Array.isArray(bCards) &&
          ((pCards.length === 2 && bCards.length === 3) || (pCards.length === 3 && bCards.length === 2));
        if (isMixed) {
          const rattrapage = gn - pgNum;
          console.log(`[${strategy}] [Écart 2/3] ✅ Jeu mixte → gagne (R${rattrapage})`);
          await resolvePrediction(strategy, pgNum, ps, 'gagne', rattrapage, pCards, bCards, tgOpts);
          delete pending[pg];
          if (onLoss) onLoss(true, ps, pgNum, rattrapage);
        } else if (gn === pgNum + effectiveMaxR) {
          await resolvePrediction(strategy, pgNum, ps, 'perdu', effectiveMaxR, pCards, bCards, tgOpts);
          delete pending[pg];
          if (onLoss) onLoss(false, ps, pgNum, effectiveMaxR);
        }
        continue;

      // ── Résolution spéciale mode Match Nul ─────────────────────────────
      } else if (ps === 'TIE') {
        if (winner === 'Tie') {
          const rattrapage = gn - pgNum;
          console.log(`[${strategy}] [Match Nul] ✅ Tie → gagne (R${rattrapage})`);
          await resolvePrediction(strategy, pgNum, ps, 'gagne', rattrapage, pCards, bCards, tgOpts);
          delete pending[pg];
          if (onLoss) onLoss(true, ps, pgNum, rattrapage);
        } else if (gn === pgNum + effectiveMaxR) {
          await resolvePrediction(strategy, pgNum, ps, 'perdu', effectiveMaxR, pCards, bCards, tgOpts);
          delete pending[pg];
          if (onLoss) onLoss(false, ps, pgNum, effectiveMaxR);
        }
        continue;

      // ── Résolution spéciale combinaisons 2/3 · 3/2 · 3/3 ───────────────
      } else if (ps === 'DEUX_TROIS' || ps === 'TROIS_DEUX' || ps === 'TROIS_TROIS') {
        const combLabel = ps === 'DEUX_TROIS' ? '2/3' : ps === 'TROIS_DEUX' ? '3/2' : '3/3';
        const isMatch = ps === 'DEUX_TROIS'
          ? (Array.isArray(pCards) && Array.isArray(bCards) && pCards.length === 2 && bCards.length === 3)
          : ps === 'TROIS_DEUX'
          ? (Array.isArray(pCards) && Array.isArray(bCards) && pCards.length === 3 && bCards.length === 2)
          : (Array.isArray(pCards) && Array.isArray(bCards) && pCards.length === 3 && bCards.length === 3);
        if (isMatch) {
          const rattrapage = gn - pgNum;
          console.log(`[${strategy}] [${combLabel}] ✅ Combinaison confirmée → gagne (R${rattrapage})`);
          await resolvePrediction(strategy, pgNum, ps, 'gagne', rattrapage, pCards, bCards, tgOpts);
          delete pending[pg];
          if (onLoss) onLoss(true, ps, pgNum, rattrapage);
        } else if (gn === pgNum + effectiveMaxR) {
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
  _checkExceptions(exceptions, predictedSuit, triggerSuit, state, triggerCards = {}) {
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

        // ── 20. Position de la carte prédite dans la main du jeu déclencheur ─
        // Bloque si la carte prédite apparaît à l'une des positions configurées
        // dans la MAIN DE LA STRATÉGIE (joueur ou banquier) uniquement.
        // Position 1 = 1ère carte de la main, position 2 = 2ème carte, position 3 = 3ème carte.
        case 'trigger_card_position': {
          const blockedPos = Array.isArray(ex.positions) ? ex.positions.map(Number).filter(p => p >= 1 && p <= 6) : [];
          if (!blockedPos.length) break;
          const pC = Array.isArray(triggerCards.pCards) ? triggerCards.pCards : [];
          const bC = Array.isArray(triggerCards.bCards) ? triggerCards.bCards : [];
          // Utilise uniquement les cartes de la main configurée pour la stratégie
          const hand      = triggerCards.hand || 'joueur';
          const handCards = hand === 'banquier' ? bC : pC;
          if (!handCards.length) break;
          // Chercher TOUTES les positions où la carte prédite apparaît dans cette main
          const matchedPos = [];
          for (let i = 0; i < handCards.length; i++) {
            const s = normalizeSuit((handCards[i] && handCards[i].S) || '');
            if (s === predictedSuit) matchedPos.push(i + 1); // 1-indexé
          }
          if (!matchedPos.length) break; // carte absente de la main → pas de blocage
          const hit = matchedPos.find(p => blockedPos.includes(p));
          if (hit !== undefined) {
            console.log(`[Exception] trigger_card_position(${blockedPos.join(',')}): ${predictedSuit} en position ${hit} dans main ${hand} → bloqué`);
            return true;
          }
          break;
        }

        // ── 21. Prédictions consécutives du même costume ───────────────
        // Bloque si le même costume a été prédit N fois de suite.
        // Libération automatique : 20 minutes après la DERNIÈRE prédiction
        // consécutive du même costume (et non la première).
        // FIX : utiliser newestTs (dernière entrée) évite la double-libération
        // immédiate qui survenait avec oldestTs quand la fenêtre glissait.
        case 'consec_same_suit_pred': {
          const n = Math.max(1, parseInt(ex.value) || 3);
          const releaseMs = 20 * 60 * 1000;
          if (!state.predHistory || state.predHistory.length < n) break;
          const recentN = state.predHistory.slice(-n);
          const allSame = recentN.every(p => p.suit === predictedSuit);
          if (allSame) {
            // Référence : timestamp de la PLUS RÉCENTE prédiction consécutive
            const newestTs = recentN[recentN.length - 1].timestamp;
            if (Date.now() - newestTs >= releaseMs) {
              // Libération : purger le streak du costume bloqué pour repartir proprement
              state.predHistory = state.predHistory.filter(p => p.suit !== predictedSuit);
              console.log(`[Exception] consec_same_suit_pred(${n}): ${predictedSuit} − libéré après 20 min d'inactivité, streak purgé`);
              break;
            }
            console.log(`[Exception] consec_same_suit_pred(${n}): ${predictedSuit} prédit ${n}x de suite → bloqué (${Math.round((releaseMs - (Date.now() - newestTs)) / 60000)}min restantes)`);
            return true;
          }
          break;
        }

        default: break;
      }
    }
    return false;
  }

  async _processCustomStrategy(id, state, cfg, gn, suits, bSuits, pCards, bCards, winner = null) {
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
      const handCards = cfg.hand === 'banquier' ? bCards : pCards;
      await this._resolvePending(state.pending, channelId, gn, handSuits, pCards, bCards, (won, ps) => {
        state.lastOutcomes.push({ won, suit: ps });
        if (state.lastOutcomes.length > 10) state.lastOutcomes.shift();
        if (won) this._onStratWin(channelId);
        else this._onStratLoss(channelId, gn, ps);
        // Évaluer si le bloqueur doit s'activer
        this._updateBadPredBlocker(channelId, gn, state);
      }, stratMaxRForResolve, stratTgOpts, handCards, winner);
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

    // ── Durée de prédiction expirée ────────────────────────────────────────
    if (cfg.pred_duration_minutes > 0 && cfg.pred_duration_started_at) {
      const expiresAt = new Date(cfg.pred_duration_started_at).getTime() + cfg.pred_duration_minutes * 60000;
      if (Date.now() > expiresAt) {
        await this._handlePredDurationExpired(cfg, channelId);
        return;
      }
    }

    // ── MODE ROTATION (annonce_sequence) ─────────────────────────────────────
    // Délègue la logique de prédiction à la stratégie enfant actuellement active
    // selon l'index de rotation géré par annonce-sequence.js.
    if (mode === 'annonce_sequence') {
      const annonceSeq = require('./annonce-sequence');
      const seqIds = Array.isArray(cfg.annonce_sequence_ids) ? cfg.annonce_sequence_ids : [];
      if (seqIds.length === 0) return;
      const allStrats = Object.values(this.custom).map(s => s.config).filter(Boolean);
      const ordered   = seqIds.map(sid => allStrats.find(s => String(s.id) === String(sid))).filter(Boolean);
      if (ordered.length === 0) return;
      const activeIdx = annonceSeq.getActiveStrategyIndex(id) % ordered.length;
      const childCfg  = ordered[activeIdx];
      console.log(`[${channelId}] [Rotation] Délégation → "${childCfg.name}" (pos ${activeIdx + 1}/${ordered.length})`);
      // Fusionner config : utiliser la logique de l'enfant mais garder l'identité
      // (channelId, tg_targets) du rotateur, sauf si l'enfant a ses propres targets.
      const mergedCfg = {
        ...childCfg,
        id:            cfg.id,
        name:          cfg.name,
        tg_targets:    (Array.isArray(cfg.tg_targets) && cfg.tg_targets.length > 0)
                         ? cfg.tg_targets
                         : (childCfg.tg_targets || []),
        max_rattrapage: cfg.max_rattrapage ?? childCfg.max_rattrapage,
        tg_format:     cfg.tg_format || childCfg.tg_format,
        // Ne pas propager la durée de l'enfant dans le contexte rotation
        pred_duration_minutes: 0,
        pred_duration_started_at: null,
      };
      // Remettre gn en état non-traité pour que la passe récursive l'exécute
      state.processed.delete(gn);
      // Contexte de rotation : permet d'incrémenter le compteur par stratégie enfant
      this._currentRotationContext = { seqStratId: cfg.id, childStratId: childCfg.id };
      try {
        return await this._processCustomStrategy(id, state, mergedCfg, gn, suits, bSuits, pCards, bCards, winner);
      } finally {
        this._currentRotationContext = null;
      }
    }

    const emitPrediction = async (next, ps, suit) => {
      // ── Bloque l'émission si une prédiction est encore en attente ─
      if (Object.keys(state.pending).length > 0) {
        console.log(`[${channelId}] Bloqué — prédiction en attente de vérification`);
        return;
      }
      // ── Garde 10 min : vérifie aussi en DB (résiste aux redémarrages) ─
      if (!(await canEmitNewPrediction(channelId))) return;
      // ── Bloque si le live trigger a déjà émis pour ce jeu (évite le doublon) ─
      if (state.liveTriggeredGame === gn) {
        console.log(`[${channelId}] Bloqué — déjà déclenché en live pour jeu #${gn}`);
        return;
      }
      // ── Bloqueur automatique de mauvaises prédictions ─────────────
      if (this._isBadPredBlocked(channelId, gn, state)) return;
      // ── Vérification des exceptions avant d'émettre ───────────────
      if (this._checkExceptions(exceptions, ps, suit, state, { pCards, bCards, hand: cfg.hand || 'joueur' })) return;

      let inserted = false;
      try {
        inserted = await db.createPrediction({ strategy: channelId, game_number: next, predicted_suit: ps, triggered_by: suit || null });
        if (inserted) {
          console.log(`[${channelId}] Prédiction #${next} ${SUIT_DISPLAY[ps] || ps} (${handLabel})`);
          // Compteur rotation : incrémenter le total de la stratégie enfant active
          if (this._currentRotationContext && `S${this._currentRotationContext.seqStratId}` === channelId) {
            try {
              const annonceSeq = require('./annonce-sequence');
              annonceSeq.incrementPredCount(this._currentRotationContext.seqStratId, this._currentRotationContext.childStratId);
            } catch {}
          }
        } else {
          console.warn(`[${channelId}] Prédiction #${next} déjà existante — Telegram ignoré (doublon évité)`);
        }
      } catch (e) { console.error(`createPrediction ${channelId} error:`, e.message); }
      state.pending[next] = { suit: ps, rattrapage: 0, maxR: stratMaxRForResolve };
      // Historique des prédictions émises (pour l'exception consec_same_suit_pred)
      if (!state.predHistory) state.predHistory = [];
      state.predHistory.push({ suit: ps, timestamp: Date.now() });
      if (state.predHistory.length > 30) state.predHistory.shift();
      if (!inserted) return; // Prédiction déjà en DB → ne pas renvoyer le message Telegram
      // Pour les stratégies Pro : vérifier que des comptes Pro actifs existent
      if (cfg.is_pro && this._proTelegramEnabled === false) {
        console.log(`[${channelId}] Pro Telegram suspendu — aucun abonnement Pro actif`);
        return;
      }
      if (!(await this._isOwnerActive(cfg))) { console.log(`[${channelId}] ⛔ envoi Telegram bloqué (abonnement expiré)`); return; }
      // Envoi Telegram : token custom si configuré, sinon bot global + routage par stratégie
      if (Array.isArray(tg_targets) && tg_targets.length > 0) {
        await sendCustomAndStore(tg_targets, channelId, next, ps, stratTgOpts).catch(e => {
          console.warn(`[${channelId}] ⚠️ Telegram custom échec (jeu #${next}) : ${e?.message || e}`);
        });
      } else {
        await sendToStrategyChannels(channelId, next, ps, stratTgOpts).catch(e => {
          console.warn(`[${channelId}] ⚠️ Telegram routage échec (jeu #${next}) : ${e?.message || e}`);
        });
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

    } else if (mode === 'carte_3_vers_2') {
      // ── Mode : 3 cartes → prédit 2 cartes ────────────────────────────────
      // Phase 1 (comptage) : on compte les jeux à 3 cartes consécutifs pour la main choisie.
      //   - Si 2 cartes apparaissent avant le seuil → reset compteur.
      //   - Quand compteur >= B → on entre en phase attente.
      // Phase 2 (attente) : on attend que 2 cartes apparaissent pour la main choisie.
      //   - Dès que 2 cartes arrivent → prédiction envoyée + reset.
      const handCardsNow  = cfg.hand === 'banquier' ? bCards : pCards;
      const hasTwoCards   = Array.isArray(handCardsNow) && handCardsNow.length === 2;
      const hasThreeCards = Array.isArray(handCardsNow) && handCardsNow.length === 3;

      if (state.waiting_c3v2) {
        // Phase attente : seuil déjà atteint, on attend les 2 cartes
        if (hasTwoCards) {
          console.log(`[${channelId}] [Carte3→2] ✅ 2 cartes apparues après seuil (${B}) → prédiction envoyée jeu #${gn + offset}`);
          await emitPrediction(gn + offset, 'deux', 'trois');
          state.counts['c3v2'] = 0;
          state.waiting_c3v2 = false;
        }
        // 3 cartes en attente → on reste en attente, on ne compte plus
      } else {
        // Phase comptage
        if (hasThreeCards) {
          state.counts['c3v2'] = (state.counts['c3v2'] || 0) + 1;
          console.log(`[${channelId}] [Carte3→2] compteur=${state.counts['c3v2']} / seuil=${B}`);
          if (state.counts['c3v2'] >= B) {
            console.log(`[${channelId}] [Carte3→2] Seuil ${B} atteint → attente des 2 cartes...`);
            state.waiting_c3v2 = true;
          }
        } else if (hasTwoCards) {
          // 2 cartes avant le seuil → reset
          if ((state.counts['c3v2'] || 0) > 0)
            console.log(`[${channelId}] [Carte3→2] 2 cartes avant seuil → reset (was ${state.counts['c3v2']})`);
          state.counts['c3v2'] = 0;
        }
      }

    } else if (mode === 'carte_2_vers_3') {
      // ── Mode : 2 cartes → prédit 3 cartes ────────────────────────────────
      // Phase 1 (comptage) : on compte les jeux à 2 cartes consécutifs pour la main choisie.
      //   - Si 3 cartes apparaissent avant le seuil → reset compteur.
      //   - Quand compteur >= B → on entre en phase attente.
      // Phase 2 (attente) : on attend que 3 cartes apparaissent pour la main choisie.
      //   - Dès que 3 cartes arrivent → prédiction envoyée + reset.
      const handCardsNow  = cfg.hand === 'banquier' ? bCards : pCards;
      const hasTwoCards   = Array.isArray(handCardsNow) && handCardsNow.length === 2;
      const hasThreeCards = Array.isArray(handCardsNow) && handCardsNow.length === 3;

      if (state.waiting_c2v3) {
        // Phase attente : seuil déjà atteint, on attend les 3 cartes
        if (hasThreeCards) {
          console.log(`[${channelId}] [Carte2→3] ✅ 3 cartes apparues après seuil (${B}) → prédiction envoyée jeu #${gn + offset}`);
          await emitPrediction(gn + offset, 'trois', 'deux');
          state.counts['c2v3'] = 0;
          state.waiting_c2v3 = false;
        }
        // 2 cartes en attente → on reste en attente, on ne compte plus
      } else {
        // Phase comptage
        if (hasTwoCards) {
          state.counts['c2v3'] = (state.counts['c2v3'] || 0) + 1;
          console.log(`[${channelId}] [Carte2→3] compteur=${state.counts['c2v3']} / seuil=${B}`);
          if (state.counts['c2v3'] >= B) {
            console.log(`[${channelId}] [Carte2→3] Seuil ${B} atteint → attente des 3 cartes...`);
            state.waiting_c2v3 = true;
          }
        } else if (hasThreeCards) {
          // 3 cartes avant le seuil → reset
          if ((state.counts['c2v3'] || 0) > 0)
            console.log(`[${channelId}] [Carte2→3] 3 cartes avant seuil → reset (was ${state.counts['c2v3']})`);
          state.counts['c2v3'] = 0;
        }
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
      // Chaque carte de la main sélectionnée est comptée (ex: banquier ♠♠ = pique +2).
      // Quand un costume A a B apparitions DE PLUS qu'un costume B → prédit le costume B.
      // Les compteurs NE se remettent PAS à zéro après la prédiction.
      // Remise à zéro UNIQUEMENT à l'heure pile.
      // ─────────────────────────────────────────────────────────────────

      // 0. Remise à zéro automatique toutes les heures pile (UTC epoch-hours — fiable)
      if (!state.mirrorCounts) state.mirrorCounts = {};
      const currentEpochHour = Math.floor(Date.now() / 3_600_000);
      if (state.mirrorLastHour === null || state.mirrorLastHour === undefined) {
        state.mirrorLastHour = currentEpochHour;
      } else if (state.mirrorLastHour !== currentEpochHour) {
        const prevH = state.mirrorLastHour % 24;
        const newH  = currentEpochHour % 24;
        console.log(`[${channelId}] MiroirTaux ⏰ Nouvelle heure (${prevH}h→${newH}h) — compteurs remis à zéro`);
        for (const suit of ALL_SUITS) state.mirrorCounts[suit] = 0;
        state.mirrorLastHour = currentEpochHour;
      }

      // 1. Mise à jour des compteurs cumulatifs
      // On compte les cartes de la main configurée : 'banquier' → bCards, 'joueur' → pCards
      // Ex: banquier ♠♠♥ → ♠ reçoit +2, ♥ reçoit +1
      const rawCards = cfg.hand === 'banquier' ? (bCards || []) : (pCards || []);
      const addedCounts = {};
      for (const c of rawCards) {
        const s = normalizeSuit(c.S || '');
        if (ALL_SUITS.includes(s)) {
          addedCounts[s] = (addedCounts[s] || 0) + 1;
        }
      }
      for (const suit of ALL_SUITS) {
        state.mirrorCounts[suit] = (state.mirrorCounts[suit] || 0) + (addedCounts[suit] || 0);
      }

      // Log des compteurs courants (avec la main utilisée)
      const addedStr  = ALL_SUITS.map(s => `${s}:+${addedCounts[s] || 0}`).join(' ');
      const countsStr = ALL_SUITS.map(s => `${s}:${state.mirrorCounts[s] || 0}`).join(' ');
      console.log(`[${channelId}] MiroirTaux (main=${cfg.hand || 'joueur'}, jeu#${gn}) cartes ajoutées: ${addedStr} | totaux: ${countsStr}`);

      // 2. Si prédiction en attente → ne pas déclencher
      if (Object.keys(state.pending).length > 0) return;

      // 3. Trouver la paire (dominant, retardataire) avec le plus grand écart ≥ seuil
      let bestDiff = 0;
      let bestPairThreshold = B;
      let laggingSuit = null;
      let dominantSuit = null;

      // Chaque paire cochée a son propre seuil défini par l'admin.
      // Si aucune paire cochée → seuil global B sur toutes les combinaisons.
      const configuredPairs = Array.isArray(cfg.mirror_pairs) && cfg.mirror_pairs.length > 0
        ? cfg.mirror_pairs
        : null;

      if (configuredPairs) {
        for (const pairCfg of configuredPairs) {
          const sA = pairCfg.a;
          const sB = pairCfg.b;
          // Seuil individuel défini par l'admin pour cette paire ; B en fallback si non défini
          const pairThreshold = (pairCfg.threshold && pairCfg.threshold > 0) ? pairCfg.threshold : B;
          const diff = (state.mirrorCounts[sA] || 0) - (state.mirrorCounts[sB] || 0);
          const absDiff = Math.abs(diff);
          if (absDiff >= pairThreshold && absDiff > bestDiff) {
            bestDiff          = absDiff;
            bestPairThreshold = pairThreshold;
            dominantSuit      = diff > 0 ? sA : sB;
            laggingSuit       = diff > 0 ? sB : sA;
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
      // Prédit le costume retardataire (le plus faible) — aucun mapping.
      // Les compteurs NE se remettent PAS à zéro après déclenchement :
      // ils continuent de s'accumuler et se remettent à zéro uniquement à l'heure pile.
      if (laggingSuit) {
        const ps = laggingSuit;
        console.log(`[${channelId}] MiroirTaux (main=${handLabel}): ${dominantSuit}(${state.mirrorCounts[dominantSuit]}) - ${laggingSuit}(${state.mirrorCounts[laggingSuit]}) = ${bestDiff} ≥ écart(${bestPairThreshold}) → prédit ${ps}`);
        await emitPrediction(gn + offset, ps, laggingSuit);
      }

    } else if (mode === 'compteur_adverse') {
      // ── MODE COMPTEUR ADVERSE ─────────────────────────────────────────────
      // Compte les costumes MANQUANTS de la main OPPOSÉE à celle choisie par l'admin.
      // Si hand = 'joueur' → observe la main du BANQUIER
      // Si hand = 'banquier' → observe la main du JOUEUR
      //
      // Logique : même principe que 'manquants' mais sur la main adverse.
      // Quand un costume est absent depuis B jeux dans la main adverse →
      //   prédit le costume configuré par l'admin dans le mapping pour ce costume.
      //
      // Exemple : hand='joueur', B=5, mapping[♠]='♥'
      //   → Si ♠ est absent 5 fois dans la main du BANQUIER → prédit ♥ pour le joueur
      // ─────────────────────────────────────────────────────────────────────

      // La main adverse est l'opposée de la main configurée
      const adverseSuits = cfg.hand === 'banquier' ? suits : (bSuits || []);
      const adverseLabel = cfg.hand === 'banquier' ? 'joueur' : 'banquier';

      if (!state.adverseCounts) {
        state.adverseCounts = {};
        for (const s of ALL_SUITS) state.adverseCounts[s] = 0;
      }

      for (const suit of ALL_SUITS) {
        if (adverseSuits.includes(suit)) {
          // Costume présent dans la main adverse → réinitialiser son compteur
          state.adverseCounts[suit] = 0;
        } else {
          // Costume absent de la main adverse → incrémenter le compteur
          state.adverseCounts[suit] = (state.adverseCounts[suit] || 0) + 1;
          if (state.adverseCounts[suit] === B) {
            const ps = resolvePredictedSuit(suit);
            if (ps) {
              console.log(`[${channelId}] [Adverse] ♟ ${suit} absent ${B} fois de la main ${adverseLabel} → prédit ${ps} (main ${handLabel})`);
              await emitPrediction(gn + offset, ps, suit);
            }
            // Réinitialiser le compteur après déclenchement
            state.adverseCounts[suit] = 0;
          }
        }
      }

    } else if (mode === 'absence_victoire') {
      // ── MODE ABSENCE → VICTOIRE ───────────────────────────────────────────
      // Logique identique à absence_apparition mais sur les résultats (Joueur/Banquier).
      // Deux compteurs indépendants :
      //   abs_joueur  = jeux consécutifs sans victoire Joueur
      //   abs_banquier = jeux consécutifs sans victoire Banquier
      //
      // Règles :
      //  - Victoire Joueur  → si abs_joueur  >= B → prédit WIN_P puis reset des 2 compteurs
      //  - Victoire Banquier → si abs_banquier >= B → prédit WIN_B puis reset des 2 compteurs
      //  - Égalité (Tie)    → reset des 2 compteurs, puis reprise
      // ─────────────────────────────────────────────────────────────────────
      const absP = state.counts['abs_joueur']   || 0;
      const absB = state.counts['abs_banquier']  || 0;

      if (winner === 'Player') {
        if (absP >= B) {
          console.log(`[${channelId}] [Abs Victoire] 👤 Joueur réapparaît après ${absP} absences (seuil≥${B}) → WIN_P jeu #${gn + offset}`);
          await emitPrediction(gn + offset, 'WIN_P', 'WIN_P');
          state.counts['abs_joueur'] = 0;
          state.counts['abs_banquier'] = 0;
        } else {
          state.counts['abs_joueur'] = 0;
          state.counts['abs_banquier'] = absB + 1;
        }
      } else if (winner === 'Banker') {
        if (absB >= B) {
          console.log(`[${channelId}] [Abs Victoire] 🏦 Banquier réapparaît après ${absB} absences (seuil≥${B}) → WIN_B jeu #${gn + offset}`);
          await emitPrediction(gn + offset, 'WIN_B', 'WIN_B');
          state.counts['abs_joueur'] = 0;
          state.counts['abs_banquier'] = 0;
        } else {
          state.counts['abs_banquier'] = 0;
          state.counts['abs_joueur'] = absP + 1;
        }
      } else {
        state.counts['abs_joueur'] = 0;
        state.counts['abs_banquier'] = 0;
        console.log(`[${channelId}] [Abs Victoire] Égalité — reset des 2 compteurs`);
      }

    } else if (mode === 'lecture_passee') {
      // ── MODE LECTURE DES JEUX PASSÉS ─────────────────────────────────────
      // Quand le live arrive sur le jeu N, on prédit pour le jeu (N+p)
      // le costume de la carte #position (1, 2 ou 3) de la main choisie au
      // jeu zk = (N+p) - h, lu depuis la 2ème base de données (cartes_jeu).
      // Paramètres : carte_p (avance), carte_h (recul), carte_ecart (gap),
      // carte_position (1-3), carte_source_hand ('joueur'|'banquier').
      // ─────────────────────────────────────────────────────────────────────
      const p        = Math.max(1, parseInt(cfg.carte_p) || 2);
      const h        = Math.max(1, parseInt(cfg.carte_h) || 32);
      const ecart    = Math.max(1, parseInt(cfg.carte_ecart) || 1);
      const position = Math.max(1, Math.min(3, parseInt(cfg.carte_position) || 1));
      const sourceHand = cfg.carte_source_hand === 'banquier' ? 'banker' : 'player';
      const sourceLabel = sourceHand === 'banker' ? '🏦 Banquier' : '👤 Joueur';

      const go = gn + p;
      const zk = go - h;
      if (zk <= 0) return; // pas assez d'historique

      // Application de l'écart : ne prédire qu'une fois tous les `ecart` jeux
      // Guard go > lastGo : si go <= lastGo (ex: après reset jeu #1), on laisse passer sans skip
      const lastGo = state._lastLecturePassee || 0;
      if (lastGo > 0 && go > lastGo && (go - lastGo) < ecart) {
        console.log(`[${channelId}] [LecturePassée] gap (live=${gn} go=${go}, dernier=${lastGo}, écart=${ecart}) — skip`);
        return;
      }

      try {
        const row = await cartesStore.byGameNumber(zk);
        if (!row) {
          console.log(`[${channelId}] [LecturePassée] zk=${zk} ${sourceLabel} pos=${position} — jeu introuvable dans cartes_jeu`);
          return;
        }
        const prefix = sourceHand === 'banker' ? 'b' : 'p';
        const targetRank = row[`${prefix}${position}_r`];
        const targetSuit = row[`${prefix}${position}_s`];
        if (!targetSuit || !ALL_SUITS.includes(targetSuit)) {
          console.log(`[${channelId}] [LecturePassée] zk=${zk} ${sourceLabel} pos=${position} — costume invalide (${targetSuit})`);
          return;
        }
        console.log(`[${channelId}] [LecturePassée] live=${gn} → go=${go} ← zk=${zk} ${sourceLabel} carte#${position}=${targetRank}${targetSuit} → prédit ${targetSuit}`);
        // Vérification de l'attente de rattrapage — ne pas consommer l'écart si bloqué
        // Important : si une prédiction est en cours de rattrapage, on reporte sans marquer lastGo.
        if (Object.keys(state.pending).length > 0) {
          console.log(`[${channelId}] [LecturePassée] go=${go} − prédiction en attente (rattrapage?) → skip sans consommer l'écart`);
          return;
        }
        // Vérification des exceptions avant d'émettre — ne met à jour le gap QUE si la prédiction passe
        if (this._checkExceptions(exceptions, targetSuit, targetSuit, state, { pCards, bCards, hand: cfg.hand || 'joueur' })) return;
        state._lastLecturePassee = go;
        await emitPrediction(go, targetSuit, targetSuit);
      } catch (e) {
        console.warn(`[${channelId}] [LecturePassée] échec lecture zk=${zk}: ${e.message}`);
      }

    } else if (mode === 'intelligent_cartes') {
      // ── MODE INTELLIGENT CARTES ──────────────────────────────────────────
      // Lit la 2ème base (cartes_jeu) sur une fenêtre de N jeux et calcule
      // pour la main choisie quel costume apparaît le plus souvent à
      // (jeu+offset) après la séquence des `pattern` derniers jeux.
      // Si la confiance dépasse `min_count`, prédit ce costume.
      // ─────────────────────────────────────────────────────────────────────
      const window     = Math.max(20, Math.min(2000, parseInt(cfg.intelligent_window) || 300));
      const patternLen = Math.max(1, Math.min(8, parseInt(cfg.intelligent_pattern) || 3));
      const minCount   = Math.max(1, Math.min(50, parseInt(cfg.intelligent_min_count) || 3));
      const handIsBank = cfg.hand === 'banquier';
      const handLabel  = handIsBank ? '🏦 Banquier' : '👤 Joueur';
      const offset     = Math.max(1, parseInt(cfg.prediction_offset) || 1);

      try {
        // Filtre toGn : ne récupère que les jeux enregistrés AVANT le jeu live (game_number <= gn-1)
        // CRITIQUE : sans ce filtre, listRecent() peut retourner des jeux de sessions précédentes
        // avec des numéros > gn, ce qui donne past.length=0 et empêche toute prédiction.
        const rows = await cartesStore.listRecent(window + patternLen + offset + 5, { toGn: gn - 1 });
        if (!rows || rows.length < patternLen + offset + 1) {
          console.log(`[${channelId}] [Intelligent] historique insuffisant (${rows?.length || 0} lignes pour gn<=${gn - 1})`);
          return;
        }
        rows.sort((a, b) => (a.game_number || 0) - (b.game_number || 0));
        const suitOf = (row) => handIsBank ? row.b1_s : row.p1_s;

        // Pattern courant : `patternLen` derniers jeux (les plus récents) — exclure le live en cours
        const past = rows; // déjà filtré par toGn: gn-1
        if (past.length < patternLen + 1) {
          console.log(`[${channelId}] [Intelligent] pas assez d'historique passé (${past.length}/${patternLen + 1})`);
          return;
        }
        const recentSlice = past.slice(-patternLen).map(suitOf);
        if (recentSlice.some(s => !s || !ALL_SUITS.includes(s))) {
          console.log(`[${channelId}] [Intelligent] pattern courant incomplet`);
          return;
        }
        const currentKey = recentSlice.join('');

        // Recherche de motifs identiques dans l'historique → quel costume au offset suivant ?
        const counts = { '♠': 0, '♥': 0, '♦': 0, '♣': 0 };
        let total = 0;
        for (let i = 0; i + patternLen + offset - 1 < past.length; i++) {
          // Exclure le pattern courant lui-même (les `patternLen+offset` derniers jeux)
          if (i + patternLen + offset >= past.length) break;
          const slice = past.slice(i, i + patternLen).map(suitOf);
          if (slice.some(s => !s)) continue;
          if (slice.join('') !== currentKey) continue;
          const futureSuit = suitOf(past[i + patternLen + offset - 1]);
          if (!futureSuit || !counts.hasOwnProperty(futureSuit)) continue;
          counts[futureSuit]++;
          total++;
        }

        if (total < minCount) {
          console.log(`[${channelId}] [Intelligent] ${handLabel} pattern "${currentKey}" → seulement ${total} occurrences (min ${minCount})`);
          return;
        }
        let best = null, bestCount = 0;
        for (const [s, c] of Object.entries(counts)) {
          if (c > bestCount) { best = s; bestCount = c; }
        }
        if (!best || bestCount < minCount) {
          console.log(`[${channelId}] [Intelligent] meilleur=${best} ${bestCount} < min ${minCount}`);
          return;
        }
        // Anti-spam : ne pas redéclencher pour le même go
        const goN = gn + offset;
        if (state._lastIntelligentGo === goN) return;
        state._lastIntelligentGo = goN;

        const conf = total > 0 ? Math.round((bestCount / total) * 100) : 0;
        console.log(`[${channelId}] [Intelligent] ${handLabel} pattern "${currentKey}" (${total} occ.) → ${best} (${bestCount}, ${conf}%) → jeu #${goN}`);
        // Vérification des exceptions avant d'émettre
        if (this._checkExceptions(exceptions, best, best, state, { pCards, bCards, hand: cfg.hand || 'joueur' })) return;
        await emitPrediction(goN, best, best);
      } catch (e) {
        console.warn(`[${channelId}] [Intelligent] échec: ${e.message}`);
      }

    } else if (mode === 'abs_3_vers_2' || mode === 'abs_3_vers_3') {
      // ── MODE ABSENCE DE 3 CARTES → PRÉDIT 2 OU 3 CARTES ─────────────────
      // Compte les jeux consécutifs à 2 cartes (absences de 3 cartes).
      // Dès que 3 cartes apparaissent ET que le compteur >= B → prédit 2 (abs_3_vers_2)
      // ou 3 cartes (abs_3_vers_3) au jeu suivant.
      // Similaire à absence_apparition mais pour le nombre de cartes.
      // ─────────────────────────────────────────────────────────────────────
      const predictCard   = mode === 'abs_3_vers_2' ? 'deux' : 'trois';
      const handCardsNow  = cfg.hand === 'banquier' ? bCards : pCards;
      const hasThreeCards = Array.isArray(handCardsNow) && handCardsNow.length === 3;
      const hasTwoCards   = Array.isArray(handCardsNow) && handCardsNow.length === 2;

      if (hasThreeCards) {
        if ((state.counts['abs3'] || 0) >= B) {
          console.log(`[${channelId}] [Abs3→${predictCard}] 3 cartes après ${state.counts['abs3']} jeux à 2 cartes (seuil≥${B}) → prédiction jeu #${gn + offset}`);
          await emitPrediction(gn + offset, predictCard, 'trois');
        }
        state.counts['abs3'] = 0;
      } else if (hasTwoCards) {
        state.counts['abs3'] = (state.counts['abs3'] || 0) + 1;
        console.log(`[${channelId}] [Abs3→${predictCard}] 2 cartes (absence) compteur=${state.counts['abs3']}/${B}`);
      }

    } else if (mode === 'carte_valeur') {
      // ── MODE CARTE VALEUR ────────────────────────────────────────────────
      // Suit le NOMBRE D'APPARITIONS de chaque VALEUR (A, K, Q, J, 10, 9, 8, 7, 6)
      // dans la main configurée — CUMULATIF.
      // Réinitialise TOUS les compteurs dès que toutes les valeurs ont count > 0.
      //
      // Comportement Telegram :
      //   • 1ère détection d'une valeur manquante → envoie 1 message (début→fin)
      //   • Jeux suivants même valeur toujours absente → ÉDITE ce message (maj fin)
      //   • La valeur apparaît enfin → édite message avec ✅ final, remet à zéro
      // ─────────────────────────────────────────────────────────────────────
      const CV_VALUES   = ['A', 'K', 'Q', 'J', '10', '9', '8', '7', '6'];
      const CV_RANK_MAP = { 0:'A', 1:'A', 14:'A', 13:'K', 12:'Q', 11:'J', 10:'10', 9:'9', 8:'8', 7:'7', 6:'6' };

      if (!state._cvValueCounts) {
        state._cvValueCounts = {};
        for (const v of CV_VALUES) state._cvValueCounts[v] = 0;
        state._cvCycleStartGame = null;
      }
      if (state._cvActiveAlert === undefined) state._cvActiveAlert = null;

      const handDisplay  = cfg.hand === 'banquier' ? 'Banquier' : 'Joueur';
      const handCardsNow = cfg.hand === 'banquier' ? bCards : pCards;
      const appearedValues = new Set();
      for (const c of (handCardsNow || [])) {
        const vName = CV_RANK_MAP[parseInt(c.R)];
        if (vName) appearedValues.add(vName);
      }

      for (const v of appearedValues) {
        state._cvValueCounts[v] = (state._cvValueCounts[v] || 0) + 1;
      }

      if (state._cvCycleStartGame === null || state._cvCycleStartGame === undefined) {
        state._cvCycleStartGame = gn;
      }

      // Construit le texte brut du message Carte Valeur
      const buildCvText = (missingValue, cycleStart, endGn, found = false) => {
        const countsStr = CV_VALUES.map(v => `${v}:${state._cvValueCounts[v] || 0}`).join('  ');
        if (found) {
          return `🃏 Carte Valeur\n━━━━━━━━━━━━━━━━━━\n✅ Valeur trouvée : ${missingValue}\n👤 Main : ${handDisplay}\n📊 Compteurs :\n${countsStr}\n━━━━━━━━━━━━━━━━━━\n📌 Début du cycle : #${cycleStart}\n🏁 Trouvée au jeu  : #${endGn}`;
        }
        return `🃏 Carte Valeur\n━━━━━━━━━━━━━━━━━━\n🔍 Valeur manquante : ${missingValue}\n👤 Main : ${handDisplay}\n📊 Compteurs :\n${countsStr}\n━━━━━━━━━━━━━━━━━━\n📌 Début du cycle : #${cycleStart}\n🏁 Fin analysée   : #${endGn}`;
      };

      // Vérifier si TOUTES les valeurs ont count > 0 → cycle complet
      const allPresent = CV_VALUES.every(v => (state._cvValueCounts[v] || 0) > 0);
      if (allPresent) {
        // La valeur manquante est apparue → réinitialisation SILENCIEUSE (pas d'édition du message)
        if (state._cvActiveAlert) {
          const alert = state._cvActiveAlert;
          console.log(`[${channelId}] [CarteValeur] Valeur ${alert.missingValue} trouvée jeu #${gn} — réinitialisation silencieuse (msg non modifié)`);
          try {
            await db.deleteTgMsgIds(channelId, alert.firstGn, alert.missingValue).catch(() => {});
          } catch (e) { console.warn(`[${channelId}] CV deleteTgMsgIds:`, e.message); }
          state._cvActiveAlert = null;
        }
        console.log(`[${channelId}] [CarteValeur] Cycle complet (jeux #${state._cvCycleStartGame}→#${gn}) — toutes les valeurs vues → remise à zéro`);
        for (const v of CV_VALUES) state._cvValueCounts[v] = 0;
        state._cvCycleStartGame = null;

      } else {
        const zeroValues = CV_VALUES.filter(v => (state._cvValueCounts[v] || 0) === 0);
        console.log(`[${channelId}] [CarteValeur] Counts: ${CV_VALUES.map(v => `${v}=${state._cvValueCounts[v]||0}`).join(' ')} | absentes=[${zeroValues.join(',')}]`);

        if (zeroValues.length === 1) {
          const missingValue  = zeroValues[0];
          const cycleStart    = state._cvCycleStartGame || gn;

          if (state._cvActiveAlert && state._cvActiveAlert.missingValue === missingValue) {
            // ── Même valeur toujours absente → on ÉDITE le message existant ──
            const alert       = state._cvActiveAlert;
            const updatedText = buildCvText(missingValue, alert.cycleStartGn, gn, false);
            console.log(`[${channelId}] [CarteValeur] ${missingValue} toujours absent — édition msg#${alert.firstGn} fin→#${gn}`);
            try {
              await editRawStoredMessages(channelId, alert.firstGn, missingValue, updatedText);
            } catch (e) { console.warn(`[${channelId}] CV edit update:`, e.message); }

          } else {
            // ── Nouvelle valeur manquante → envoyer un nouveau message ──
            if (state._cvActiveAlert) {
              // Clore l'alerte précédente
              await db.deleteTgMsgIds(channelId, state._cvActiveAlert.firstGn, state._cvActiveAlert.missingValue).catch(() => {});
              state._cvActiveAlert = null;
            }

            if (Object.keys(state.pending).length !== 0) {
              console.log(`[${channelId}] [CarteValeur] Bloqué — prédictions en attente`);
            } else if (!(await canEmitNewPrediction(channelId))) {
              console.log(`[${channelId}] [CarteValeur] Bloqué — prédiction récente dans la fenêtre`);
            } else if (!(await this._isOwnerActive(cfg))) {
              console.log(`[${channelId}] [CarteValeur] Bloqué — abonnement expiré`);
            } else {
              const initialText = buildCvText(missingValue, cycleStart, gn, false);
              const cvTgOpts    = { ...stratTgOpts, tg_template: initialText };

              console.log(`[${channelId}] [CarteValeur] Alerte — valeur absente: ${missingValue} jeu #${gn}`);
              let inserted = false;
              try {
                inserted = await db.createPrediction({ strategy: channelId, game_number: gn, predicted_suit: missingValue, triggered_by: missingValue });
              } catch (e) { console.error(`[${channelId}] createPrediction carte_valeur:`, e.message); }

              if (inserted) {
                try {
                  await db.updatePrediction(
                    { strategy: channelId, game_number: gn, predicted_suit: missingValue, status_filter: 'en_cours' },
                    { status: 'gagne', rattrapage: 0, resolved_at: new Date().toISOString() }
                  );
                } catch (e) { console.warn(`[${channelId}] updatePrediction carte_valeur:`, e.message); }

                if (Array.isArray(tg_targets) && tg_targets.length > 0) {
                  await sendCustomAndStore(tg_targets, channelId, gn, missingValue, cvTgOpts).catch(e => {
                    console.warn(`[${channelId}] ⚠️ Telegram carte_valeur custom: ${e?.message || e}`);
                  });
                } else {
                  await sendToStrategyChannels(channelId, gn, missingValue, cvTgOpts).catch(e => {
                    console.warn(`[${channelId}] ⚠️ Telegram carte_valeur routage: ${e?.message || e}`);
                  });
                }

                // Mémoriser l'alerte active pour les éditions futures
                state._cvActiveAlert = { missingValue, firstGn: gn, cycleStartGn: cycleStart };
              }
            }
          }

        } else {
          // Plus d'une valeur manquante — si alerte active, la clore proprement
          if (state._cvActiveAlert) {
            await db.deleteTgMsgIds(channelId, state._cvActiveAlert.firstGn, state._cvActiveAlert.missingValue).catch(() => {});
            state._cvActiveAlert = null;
          }
        }
      }

    } else if (mode === 'comptages_ecart') {
      // ── MODE COMPTAGES ÉCART ─────────────────────────────────────────────
      // Surveille l'écart courant d'une catégorie du panneau Comptages.
      // B est calculé dynamiquement à chaque jeu :
      //   B = ceil((maxAll + 3 + maxPeriod) / 3), min 1
      // Quand le streak courant (cur) atteint B → émet la prédiction.
      // Pour les catégories costume (suit_p_* / suit_b_*), le costume absent
      // est utilisé directement comme costume prédit.
      // Pour les autres catégories, on utilise le mapping admin.
      // ─────────────────────────────────────────────────────────────────────
      const comptKey = cfg.comptages_key || '';
      if (!comptKey) return;

      let streakData;
      try {
        streakData = require('./comptages').getStreakState(comptKey);
      } catch (e) {
        console.warn(`[${channelId}] [ComptagesÉcart] comptages indisponible: ${e.message}`);
        return;
      }

      const { cur, maxAll, maxPeriod } = streakData;
      // B dynamique : arrondi au supérieur, minimum 1
      const dynB = Math.max(1, Math.ceil((maxAll + 3 + maxPeriod) / 3));

      console.log(`[${channelId}] [ComptagesÉcart] key=${comptKey} cur=${cur} maxAll=${maxAll} maxPeriod=${maxPeriod} → B=${dynB}`);

      if (cur < dynB) return;

      // Mapping clé de catégorie → costume automatique (pour catégories costume)
      const CKEY_TO_SUIT = {
        suit_p_heart: '♥', suit_b_heart: '♥',
        suit_p_club:  '♣', suit_b_club:  '♣',
        suit_p_spade: '♠', suit_b_spade: '♠',
        suit_p_diamond: '♦', suit_b_diamond: '♦',
      };
      const autoSuit = CKEY_TO_SUIT[comptKey] || null;

      // Costume déclencheur : auto-détecté ou premier costume de la main
      const triggerSuit = autoSuit || ALL_SUITS[0];

      // Appliquer les mappings admin ; si aucun mapping → auto-suit ou fallback
      const rawMapping = cfg.mappings?.[triggerSuit];
      const pool = Array.isArray(rawMapping)
        ? rawMapping.filter(s => ALL_SUITS.includes(s))
        : (ALL_SUITS.includes(rawMapping) ? [rawMapping] : (autoSuit ? [autoSuit] : []));

      if (pool.length === 0) {
        console.log(`[${channelId}] [ComptagesÉcart] aucun costume prédit pour clé=${comptKey} — vérifiez les mappings`);
        return;
      }

      const ps = pool[Math.floor(Math.random() * pool.length)];
      console.log(`[${channelId}] [ComptagesÉcart] cur(${cur}) >= B(${dynB}) → prédit ${SUIT_DISPLAY[ps] || ps}`);
      await emitPrediction(gn + offset, ps, triggerSuit);
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

      // ── Mode Distribution : résolution en fin de jeu uniquement ─────
      // Ne pas résoudre live — on attend que le jeu soit terminé
      // pour vérifier que les DEUX mains ont exactement 2 cartes.
      // La résolution correcte est dans _resolvePending (appelé par processGame).
      if (cfg.mode === 'distribution') {
        continue; // skip tryResolve, résolution via _resolvePending en fin de jeu
      }

      // ── Résolution live spéciale pour les modes Carte 2/3 ───────────
      if (cfg.mode === 'carte_3_vers_2' || cfg.mode === 'carte_2_vers_3') {
        const hCards = hand === 'banquier' ? bankerCards : playerCards;
        if (handDone && Array.isArray(hCards)) {
          for (const [pg, info] of Object.entries(entry.pending)) {
            if (info.suit !== 'deux' && info.suit !== 'trois') continue;
            const pgNum = parseInt(pg);
            if (pgNum > gn) continue;
            const targetCount = info.suit === 'deux' ? 2 : 3;
            if (hCards.length === targetCount) {
              const rattrapage = gn - pgNum;
              console.log(`[S${idStr}] ⚡ Live: ${targetCount} cartes (${hand}) jeu #${gn} → gagne immédiat (R${rattrapage})`);
              await resolvePrediction(`S${idStr}`, pgNum, info.suit, 'gagne', rattrapage, playerCards, bankerCards, stratTgOpts);
              delete entry.pending[pg];
            }
          }
        }
        continue; // ne pas appeler tryResolve pour ces modes
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
      if (mode !== 'absence_apparition' && mode !== 'apparition_absence' && mode !== 'distribution'
          && mode !== 'carte_3_vers_2' && mode !== 'carte_2_vers_3') continue;

      // Une prédiction est déjà en attente → skip
      if (Object.keys(entry.pending).length > 0) continue;

      // Ce jeu live a déjà déclenché pour cette stratégie → skip
      if (entry.liveTriggeredGame === gn) continue;

      // Distribution / Carte2/3 : pas de déclenchement live — on attend la fin officielle du jeu
      // (comptage fiable seulement quand la main est complètement terminée)
      if (mode === 'distribution' || mode === 'carte_3_vers_2' || mode === 'carte_2_vers_3') continue;

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

        // Vérification des exceptions avant déclenchement live
        if (this._checkExceptions(config.exceptions, ps, suit, entry, {})) {
          console.log(`[${channelId}] ⚡ Live: prédiction ${SUIT_DISPLAY[ps]||ps} bloquée par exception (déclencheur ${suit})`);
          continue;
        }

        entry.liveTriggeredGame = gn;
        console.log(`[${channelId}] ⚡ Live: ${suit} (${mode}, count=${entry.counts[suit]}, seuil≥${B}) → prédiction immédiate ${ps} #${next}`);

        try {
          const liveMaxR = (config.max_rattrapage !== undefined && config.max_rattrapage !== null)
            ? parseInt(config.max_rattrapage) : getCurrentMaxRattrapage();
          entry.pending[next] = { suit: ps, rattrapage: 0, maxR: liveMaxR };
          const inserted = await db.createPrediction({ strategy: channelId, game_number: next, predicted_suit: ps, triggered_by: suit });
          if (!inserted) {
            console.warn(`[${channelId}] Prédiction live #${next} déjà existante — Telegram ignoré (doublon évité)`);
          } else {
            console.log(`[${channelId}] Prédiction live #${next} ${SUIT_DISPLAY[ps] || ps}`);
            const liveTgOpts = {
              formatId: config.tg_format || null,
              hand:     config.hand      || 'joueur',
              maxR:     liveMaxR,
            };
            if (!(await this._isOwnerActive(config))) {
              console.log(`[${channelId}] ⛔ envoi Telegram bloqué (abonnement expiré)`);
            } else if (Array.isArray(tg_targets) && tg_targets.length > 0) {
              await sendCustomAndStore(tg_targets, channelId, next, ps, liveTgOpts).catch(() => {});
            } else {
              await sendToStrategyChannels(channelId, next, ps, liveTgOpts).catch(() => {});
            }
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
    const currentEpochHour = Math.floor(Date.now() / 3_600_000);
    for (const [id, entry] of Object.entries(this.custom)) {
      if (entry.config?.mode !== 'taux_miroir') continue;
      if (!entry.mirrorCounts) entry.mirrorCounts = {};
      if (entry.mirrorLastHour === null || entry.mirrorLastHour === undefined) {
        entry.mirrorLastHour = currentEpochHour;
        continue;
      }
      if (entry.mirrorLastHour !== currentEpochHour) {
        const prevH = entry.mirrorLastHour % 24;
        const newH  = currentEpochHour % 24;
        console.log(`[S${id}] MiroirTaux ⏰ Heure ${prevH}h→${newH}h — compteurs remis à zéro (tick horaire)`);
        for (const suit of ALL_SUITS) entry.mirrorCounts[suit] = 0;
        entry.mirrorLastHour = currentEpochHour;
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
          // Seuil abaissé à 2 : on autorise le reset dès qu'au moins 2 jeux ont été traités
          // (évite un faux reset au tout premier démarrage où maxProcessedGame === 0)
          if (game.game_number === 1 && (this.maxProcessedGame || 0) > 2) {
            await this._resetOnGameOne();
            renderSync.handleGameOne(1).catch(() => {});
          }
        }
        await this.processGame(game.game_number, suits, bSuits, game.player_cards, game.banker_cards, game.winner || null);
        // Mise à jour des compteurs d'écarts (suits / victoire / parité / distribution / cartes / scores)
        try { require('./comptages').onFinishedGame(game); }
        catch (e) { console.warn(`[Comptages] échec onFinishedGame(#${game.game_number}) : ${e?.message || e}`); }
        // Enregistrement des cartes dans la base séparée `les_cartes`
        cartesStore.recordGame(game).catch(e => {
          console.warn(`[CartesStore] échec recordGame(#${game.game_number}) : ${e?.message || e}`);
        });
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

  // ─── Reset complet partagé ────────────────────────────────────────────────
  // Appelé à la fois par le bouton Admin et par le déclencheur jeu #1.
  // NE touche JAMAIS aux configs : custom_strategies, telegram_config, users,
  // strategy_channel_routes, settings, canaux, tokens, durées.
  async fullReset() {
    // 1. DB locale — toutes les prédictions (en cours ET vérifiées)
    const deleted = await db.deleteAllPredictions().catch(() => 0);

    // 2. DB Render externe — predictions_export
    const extDeleted = await renderSync.clearExternalPredictions().catch(() => 0);

    // 3. Messages Telegram stockés (évite éditions orphelines)
    await db.clearAllTgPredMessages().catch(() => {});

    // 4. Reset mémoire — stratégies standards C1/C2/C3
    for (const strat of ['c1', 'c2', 'c3']) {
      if (!this[strat]) continue;
      this[strat].pending      = {};
      this[strat].processed    = new Set();
      this[strat].counts       = {};
      this[strat].history      = [];
      this[strat].lastOutcomes = [];
      if (this[strat].mirrorCounts) for (const s of ALL_SUITS) this[strat].mirrorCounts[s] = 0;
    }

    // 5. Reset mémoire — DC
    if (this.dc) {
      this.dc.pending      = {};
      this.dc.processed    = new Set();
      this.dc.counts       = {};
      this.dc.history      = [];
      this.dc.lastOutcomes = [];
    }

    // 6. Reset mémoire — toutes les stratégies custom + Pro (S7, S8, S9, S10…, S5001…S5100)
    for (const [, state] of Object.entries(this.custom)) {
      state.pending           = {};
      state.processed         = new Set();
      state.counts            = {};
      state.history           = [];
      state.lastOutcomes      = [];
      state.liveTriggeredGame = null;
      state.predHistory       = [];
      // Réinitialise les gardes anti-doublon des modes lecture_passee et intelligent_cartes
      // CRITIQUE : sans ce reset, après le jeu #1, go < _lastLecturePassee (ancien) → skip permanent
      delete state._lastLecturePassee;
      delete state._lastIntelligentGo;
      if (state.mirrorCounts)  for (const s of ALL_SUITS) state.mirrorCounts[s]  = 0;
      if (state.absenceCounts) for (const s of ALL_SUITS) state.absenceCounts[s] = 0;
      // Reset état interne mode carte_valeur
      if (state._cvValueCounts) {
        for (const v of ['A','K','Q','J','10','9','8','7','6']) state._cvValueCounts[v] = 0;
        state._cvCycleStartGame = null;
      }
      delete state._cvWindow;
      delete state._cvSuitCounts;
      // Reset complet de l'état interne des scripts Pro (stock de prédictions à zéro)
      if (state.scriptState) {
        const cfg = state.config;
        if (cfg?.type === 'script_js' && cfg._scriptModule?.initState) {
          try { state.scriptState = cfg._scriptModule.initState(); } catch { state.scriptState = {}; }
        } else {
          state.scriptState = {};
        }
      }
    }

    // 7. Compteurs moteur globaux
    this.maxProcessedGame = 0;
    this.currentMaxGame   = 0;

    // 8. Vider le bloqueur de mauvaises prédictions
    this.badPredBlocker = {};

    // 9. Vider les logs Pro de toutes les stratégies (nouvelle journée = logs propres)
    this.proLogs = {};
    this._scheduleProLogsSave();

    return { deleted, extDeleted };
  }

  async _resetOnGameOne() {
    console.log('[Engine] 🕛 Jeu #1 détecté → reset complet (nouvelles 24h)');
    const { deleted, extDeleted } = await this.fullReset();
    // Nettoyer aussi les enregistrements 'expire' résiduels
    const expireDeleted = await db.deleteExpiredPredictions().catch(() => 0);
    // Reset des compteurs d'écarts (panneau Comptages) — nouveau jour
    try { await require('./comptages').onGameOneReset(); } catch (e) {
      console.warn('[Engine] reset comptages échoué:', e.message);
    }
    console.log(`[Engine] 🕛 ${deleted} préd. supprimée(s) en local, ${extDeleted} sur Render externe, ${expireDeleted} expire nettoyé(s)`);
    console.log('[Engine] 🕛 Reset complet terminé — moteur prêt pour le nouveau jour');
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
    await this.loadProStrategies();
    await this._loadProLogsState();
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
    // Vérifier les abonnements Pro toutes les 5 minutes
    this._proExpiryNotifs   = {};
    this._proExpiryWarnings = {};
    this._proTelegramEnabled = true;
    setInterval(() => this.checkProSubscriptions().catch(() => {}), 5 * 60_000);
    // Vérification initiale après 30 secondes (laisse le temps aux connexions de s'établir)
    setTimeout(() => this.checkProSubscriptions().catch(() => {}), 30_000);
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
      // ── Nettoyage périodique des enregistrements 'expire' accumulés en base ──
      // Supprime les vieux 'expire' de plus de 2 jours pour éviter leur accumulation
      const cleaned = await db.cleanupOldPredictions(2).catch(() => 0);
      if (cleaned > 0) console.log(`[Engine] 🗑️ Nettoyage DB: ${cleaned} ancienne(s) prédiction(s) résolue(s) supprimée(s)`);
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
        // Pour compteur_adverse : on surveille la main OPPOSÉE (adverse)
        let projected;
        if (mode === 'compteur_adverse') {
          projected = hand === 'banquier'
            ? this.liveGameCards.playerSuits   // adverse du banquier = joueur
            : this.liveGameCards.bankerSuits;  // adverse du joueur = banquier
        } else {
          projected = hand === 'banquier'
            ? this.liveGameCards.bankerSuits
            : this.liveGameCards.playerSuits;
        }
        if (projected.length > 0) liveSuits = projected;
      }

      // Mode 3 cartes → 2 cartes : afficher le compteur de jeux à 3 cartes consécutifs
      if (mode === 'carte_3_vers_2') {
        const count = entry.counts['c3v2'] || 0;
        const waiting = !!entry.waiting_c3v2;
        return [{
          suit: 'c3v2', display: '🃏',
          count, threshold,
          mode, label: '3→2 cartes',
          isLive: false,
          singleCounter: true,
          waiting,
          description: waiting
            ? `⏳ Seuil atteint — attend un jeu à 2 cartes`
            : `${count}/${threshold} jeu${count > 1 ? 'x' : ''} à 3 cartes`,
        }];
      }

      // Mode 2 cartes → 3 cartes : afficher le compteur de jeux à 2 cartes consécutifs
      if (mode === 'carte_2_vers_3') {
        const count = entry.counts['c2v3'] || 0;
        const waiting = !!entry.waiting_c2v3;
        return [{
          suit: 'c2v3', display: '🃏',
          count, threshold,
          mode, label: '2→3 cartes',
          isLive: false,
          singleCounter: true,
          waiting,
          description: waiting
            ? `⏳ Seuil atteint — attend un jeu à 3 cartes`
            : `${count}/${threshold} jeu${count > 1 ? 'x' : ''} à 2 cartes`,
        }];
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

      // Mode Absence 3→2 / 3→3 → afficher le compteur de jeux à 2 cartes consécutifs
      if (mode === 'abs_3_vers_2' || mode === 'abs_3_vers_3') {
        const count   = entry.counts?.['abs3'] || 0;
        const predict = mode === 'abs_3_vers_2' ? '2️⃣' : '3️⃣';
        return [{
          suit: 'abs3', display: predict,
          count, threshold,
          mode, label: mode === 'abs_3_vers_2' ? 'Abs 3→2' : 'Abs 3→3',
          isLive: false,
          singleCounter: true,
          description: `${count}/${threshold} jeux à 2 cartes (absence de 3)`,
        }];
      }

      // Mode Absence Victoire → afficher les deux compteurs d'absences (joueur + banquier)
      if (mode === 'absence_victoire') {
        const absP = entry.counts?.['abs_joueur']   || 0;
        const absB = entry.counts?.['abs_banquier']  || 0;
        return [
          {
            suit: 'WIN_P',
            display: '👤',
            count: absP, threshold,
            mode, label: 'Abs Victoire Joueur',
            isLive: false,
            singleCounter: false,
            description: absP >= threshold
              ? `✅ Seuil atteint ! (${absP} abs.) — attend victoire Joueur`
              : `${absP}/${threshold} jeux sans victoire Joueur`,
          },
          {
            suit: 'WIN_B',
            display: '🏦',
            count: absB, threshold,
            mode, label: 'Abs Victoire Banquier',
            isLive: false,
            singleCounter: false,
            description: absB >= threshold
              ? `✅ Seuil atteint ! (${absB} abs.) — attend victoire Banquier`
              : `${absB}/${threshold} jeux sans victoire Banquier`,
          },
        ];
      }

      // Mode Carte Valeur → afficher les compteurs de valeurs (A, K, Q, J, 10, 9, 8, 7, 6)
      if (mode === 'carte_valeur') {
        const CV_VALUES = ['A', 'K', 'Q', 'J', '10', '9', '8', '7', '6'];
        const counts = entry._cvValueCounts || {};
        return CV_VALUES.map(v => ({
          suit: v,
          display: v,
          count: counts[v] || 0,
          threshold: 0,
          mode,
          label: 'Carte Valeur',
          isLive: false,
          isCarteValeur: true,
        }));
      }

      // Mode Victoire Adverse → afficher le compteur de victoires consécutives
      if (mode === 'victoire_adverse') {
        const configHand  = hand === 'banquier' ? 'banquier' : 'joueur';
        const adverseHand = configHand === 'banquier' ? 'joueur' : 'banquier';
        const count   = entry.counts?.['adv_wins'] || 0;
        const waiting = !!entry.waiting_adverse_win;
        return [{
          suit: 'adv_wins',
          display: configHand === 'banquier' ? '🏦' : '👤',
          count, threshold,
          mode, label: `Victoire Adverse`,
          isLive: false,
          singleCounter: true,
          waiting,
          description: waiting
            ? `⏳ Seuil atteint — en attente d'une victoire ${adverseHand}`
            : `${count}/${threshold} victoires ${configHand} consécutives`,
        }];
      }

      // Mode Compteur Adverse → afficher les compteurs d'absences de la main OPPOSÉE
      if (mode === 'compteur_adverse') {
        const adverseCounts = entry.adverseCounts || {};
        const adverseLabel  = hand === 'banquier' ? 'joueur' : 'banquier';
        return ALL_SUITS.map(suit => {
          const base    = adverseCounts[suit] || 0;
          let count     = base;
          let isLive    = false;
          // liveSuits ici = suits de la main adverse (déjà corrigé plus haut)
          if (liveSuits !== null) {
            isLive = true;
            count  = liveSuits.includes(suit) ? 0 : base + 1;
          }
          return {
            suit, display: SUIT_DISPLAY[suit] || suit,
            count, threshold,
            mode, label: `Adverse (${adverseLabel})`,
            isLive,
          };
        });
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
