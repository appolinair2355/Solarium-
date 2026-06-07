/**
 * Compteurs instantanés → Telegram (v2 — architecture multi-compteurs indépendants)
 *
 * Chaque compteur est INDÉPENDANT : label, bot_token, channel_id, counter_type,
 * hand, interval, send_times, send_on_game_end, reset_after_send propres.
 *
 * Types disponibles :
 *   taux_miroir      – costumes ♠♥♦♣ (apparitions par main)
 *   valeur_joueur    – valeurs de cartes A-K (joueur)
 *   valeur_banquier  – valeurs de cartes A-K (banquier)
 *   parite_joueur    – parité du score (pair/impair) côté joueur
 *   parite_banquier  – parité du score (pair/impair) côté banquier
 *   groupe_joueur    – groupe de statistiques côté joueur
 *   groupe_banquier  – groupe de statistiques côté banquier
 *   score_joueur     – total Baccarat 0-9 côté joueur
 *   score_banquier   – total Baccarat 0-9 côté banquier
 */
const db    = require('./db');
const fetch = require('node-fetch');

const ALL_SUITS  = ['♠', '♥', '♦', '♣'];
const SUIT_EMOJI = { '♠': '♠️', '♥': '♥️', '♦': '♦️', '♣': '♣️' };
const CARD_RANKS = ['A','2','3','4','5','6','7','8','9','10','J','Q','K'];
const VALID_TYPES = [
  'taux_miroir', 'valeur_joueur', 'valeur_banquier',
  'parite_joueur', 'parite_banquier',
  'groupe_joueur', 'groupe_banquier',
  'score_joueur', 'score_banquier',
];

const GROUPE_JOUEUR_CATEGORIES = [
  { key: 'vic_joueur', label: '👤 Victoire Joueur' },
  { key: 'egalite',    label: '🤝 Égalité' },
  { key: 'p2k',        label: '🃏 2 cartes Joueur' },
  { key: 'p3k',        label: '🃏 3 cartes Joueur' },
  { key: 'dist_22',    label: '2️⃣2️⃣ Naturelle 2-2' },
  { key: 'dist_23',    label: '2️⃣3️⃣ J:2  B:3' },
  { key: 'dist_32',    label: '3️⃣2️⃣ J:3  B:2' },
  { key: 'dist_33',    label: '3️⃣3️⃣ Tirage 3-3' },
];
const GROUPE_BANQUIER_CATEGORIES = [
  { key: 'vic_banquier', label: '🏦 Victoire Banquier' },
  { key: 'egalite',      label: '🤝 Égalité' },
  { key: 'b2k',          label: '🃏 2 cartes Banquier' },
  { key: 'b3k',          label: '🃏 3 cartes Banquier' },
  { key: 'dist_22',      label: '2️⃣2️⃣ Naturelle 2-2' },
  { key: 'dist_23',      label: '2️⃣3️⃣ J:2  B:3' },
  { key: 'dist_32',      label: '3️⃣2️⃣ J:3  B:2' },
  { key: 'dist_33',      label: '3️⃣3️⃣ Tirage 3-3' },
];

// ─── Helpers cartes ────────────────────────────────────────────────────────────
function _getCardRank(card) {
  if (!card || typeof card !== 'object') return null;
  let r = String(card.R || card.r || card.rang || '').toUpperCase().trim();
  if (!r) return null;
  if (r === 'T' || r === '10') return '10';
  const numMap = { '1': 'A', '11': 'J', '12': 'Q', '13': 'K', '0': '10' };
  if (numMap[r]) return numMap[r];
  if (CARD_RANKS.includes(r)) return r;
  return null;
}
function _baccaratCardValue(rank) {
  if (!rank) return 0;
  if (['10', 'J', 'Q', 'K'].includes(rank)) return 0;
  if (rank === 'A') return 1;
  return parseInt(rank) || 0;
}
function _handBaccaratScore(cards) {
  if (!Array.isArray(cards)) return 0;
  return cards.reduce((s, c) => s + _baccaratCardValue(_getCardRank(c)), 0) % 10;
}
function _countCards(cards) {
  if (!Array.isArray(cards)) return 0;
  return cards.filter(c => c && (c.R !== undefined || c.S !== undefined || c.r !== undefined)).length;
}
function _getHHMM(d) {
  return `${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`;
}
function _makeId() {
  return `sc_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
}

// ─── État global ────────────────────────────────────────────────────────────────
let _countersList   = [];   // array of counter config objects
let _countersState  = {};   // { [id]: { suitCounters, groupeJoueur, ..., gameCount, lastGameNumber, lastScheduleSent, lastSentTimes } }
let _schedulerInterval = null;
let _configLoaded   = false;

// ─── Fabrique d'état vierge pour un compteur ──────────────────────────────────
function _makeState() {
  const scoreKeys = {};
  for (let i = 0; i <= 9; i++) scoreKeys[i] = 0;
  return {
    suitCounters:      { joueur: {'♠':0,'♥':0,'♦':0,'♣':0}, banquier: {'♠':0,'♥':0,'♦':0,'♣':0} },
    groupeJoueur:      Object.fromEntries(GROUPE_JOUEUR_CATEGORIES.map(c => [c.key, 0])),
    groupeBanquier:    Object.fromEntries(GROUPE_BANQUIER_CATEGORIES.map(c => [c.key, 0])),
    valeurJoueur:      Object.fromEntries(CARD_RANKS.map(r => [r, 0])),
    valeurBanquier:    Object.fromEntries(CARD_RANKS.map(r => [r, 0])),
    pariteJoueur:      { pair: 0, impair: 0 },
    pariteBanquier:    { pair: 0, impair: 0 },
    scoreJoueur:       { ...scoreKeys },
    scoreBanquier:     { ...scoreKeys },
    gameCount:         0,
    lastGameNumber:    null,
    lastScheduleSent:  null,
    lastSentTimes:     {},
  };
}

// ─── S'assure qu'un état existe pour chaque compteur ──────────────────────────
function _ensureStates() {
  for (const c of _countersList) {
    if (!_countersState[c.id]) {
      _countersState[c.id] = _makeState();
    }
  }
  // Nettoie les états orphelins
  const ids = new Set(_countersList.map(c => c.id));
  for (const id of Object.keys(_countersState)) {
    if (!ids.has(id)) delete _countersState[id];
  }
}

// ─── Config ───────────────────────────────────────────────────────────────────
async function loadConfig() {
  try {
    const raw = await db.getSetting('suit_counters_v2');
    if (raw) {
      const saved = JSON.parse(raw);
      if (Array.isArray(saved)) {
        _countersList = saved;
      }
    } else {
      // Migration depuis l'ancienne config globale
      const oldRaw = await db.getSetting('suit_counter_config');
      if (oldRaw) {
        try {
          const old = JSON.parse(oldRaw);
          if (old && (old.channels || old.counter_type)) {
            const channels = Array.isArray(old.channels) ? old.channels : [];
            if (channels.length > 0) {
              _countersList = channels.map((ch, i) => ({
                id:               _makeId() + i,
                label:            ch.label || `Canal ${i + 1}`,
                enabled:          !!old.enabled,
                bot_token:        ch.bot_token  || '',
                channel_id:       ch.channel_id || '',
                counter_type:     old.counter_type     || 'taux_miroir',
                hand:             old.hand             || 'joueur',
                interval:         old.interval         || 30,
                send_times:       old.send_times        || [],
                send_on_game_end: !!old.send_on_game_end,
                reset_after_send: old.reset_after_send !== false,
              }));
            } else if (old.bot_token && old.channel_id) {
              _countersList = [{
                id:               _makeId(),
                label:            'Compteur 1',
                enabled:          !!old.enabled,
                bot_token:        old.bot_token  || '',
                channel_id:       old.channel_id || '',
                counter_type:     old.counter_type     || 'taux_miroir',
                hand:             old.hand             || 'joueur',
                interval:         old.interval         || 30,
                send_times:       old.send_times        || [],
                send_on_game_end: !!old.send_on_game_end,
                reset_after_send: old.reset_after_send !== false,
              }];
            }
          }
        } catch {}
      }
    }
  } catch (e) {
    console.warn('[SuitCounter] Erreur chargement config:', e.message);
  }
  _ensureStates();
  _configLoaded = true;
}

async function saveCountersList(list) {
  _countersList = list;
  _ensureStates();
  await db.setSetting('suit_counters_v2', JSON.stringify(_countersList));
}

function getCountersList() {
  return JSON.parse(JSON.stringify(_countersList));
}

function getCounterState(id) {
  const s = _countersState[id];
  if (!s) return null;
  return JSON.parse(JSON.stringify(s));
}

function getAllStates() {
  const out = {};
  for (const [id, s] of Object.entries(_countersState)) {
    out[id] = JSON.parse(JSON.stringify(s));
  }
  return out;
}

function resetCounterState(id) {
  _countersState[id] = _makeState();
}

function resetAllStates() {
  for (const c of _countersList) {
    _countersState[c.id] = _makeState();
  }
}

// ─── Mise à jour des compteurs après chaque jeu ───────────────────────────────
function onGameFinished(gn, pSuits, bSuits, pCards, bCards, winner) {
  const scoreJ = _handBaccaratScore(pCards || []);
  const scoreB = _handBaccaratScore(bCards || []);
  const np = _countCards(pCards);
  const nb = _countCards(bCards);
  const w  = winner || '';

  for (const counter of _countersList) {
    const s = _countersState[counter.id];
    if (!s) continue;

    s.lastGameNumber = gn;
    s.gameCount++;

    // Taux miroir — costumes
    for (const suit of (pSuits || [])) {
      if (ALL_SUITS.includes(suit)) s.suitCounters.joueur[suit] = (s.suitCounters.joueur[suit] || 0) + 1;
    }
    for (const suit of (bSuits || [])) {
      if (ALL_SUITS.includes(suit)) s.suitCounters.banquier[suit] = (s.suitCounters.banquier[suit] || 0) + 1;
    }

    // Valeurs
    for (const card of (pCards || [])) {
      const r = _getCardRank(card);
      if (r) s.valeurJoueur[r] = (s.valeurJoueur[r] || 0) + 1;
    }
    for (const card of (bCards || [])) {
      const r = _getCardRank(card);
      if (r) s.valeurBanquier[r] = (s.valeurBanquier[r] || 0) + 1;
    }

    // Parité
    if (scoreJ % 2 === 0) s.pariteJoueur.pair++;
    else                   s.pariteJoueur.impair++;
    if (scoreB % 2 === 0) s.pariteBanquier.pair++;
    else                   s.pariteBanquier.impair++;

    // Score total (Baccarat 0-9)
    s.scoreJoueur[scoreJ]  = (s.scoreJoueur[scoreJ]  || 0) + 1;
    s.scoreBanquier[scoreB] = (s.scoreBanquier[scoreB] || 0) + 1;

    // Groupe Joueur
    if (w === 'Player')      s.groupeJoueur.vic_joueur++;
    else if (w === 'Tie')    s.groupeJoueur.egalite++;
    if (np === 2)            s.groupeJoueur.p2k++;
    else if (np === 3)       s.groupeJoueur.p3k++;
    if      (np===2&&nb===2) s.groupeJoueur.dist_22++;
    else if (np===2&&nb===3) s.groupeJoueur.dist_23++;
    else if (np===3&&nb===2) s.groupeJoueur.dist_32++;
    else if (np===3&&nb===3) s.groupeJoueur.dist_33++;

    // Groupe Banquier
    if (w === 'Banker')      s.groupeBanquier.vic_banquier++;
    else if (w === 'Tie')    s.groupeBanquier.egalite++;
    if (nb === 2)            s.groupeBanquier.b2k++;
    else if (nb === 3)       s.groupeBanquier.b3k++;
    if      (np===2&&nb===2) s.groupeBanquier.dist_22++;
    else if (np===2&&nb===3) s.groupeBanquier.dist_23++;
    else if (np===3&&nb===2) s.groupeBanquier.dist_32++;
    else if (np===3&&nb===3) s.groupeBanquier.dist_33++;

    // Envoi après chaque jeu (si activé pour ce compteur)
    if (counter.enabled && counter.send_on_game_end && counter.bot_token && counter.channel_id) {
      _sendCounter(counter).catch(() => {});
    }
  }
}

// ─── Construction du message ──────────────────────────────────────────────────
function buildMessage(counter) {
  const s = _countersState[counter.id];
  if (!s) return '❌ État introuvable';
  const ct   = counter.counter_type || 'taux_miroir';
  const hand = counter.hand || 'joueur';

  const footer = _buildFooter(s, counter);

  if (ct === 'taux_miroir') {
    const hCounts = s.suitCounters[hand] || {};
    const total   = ALL_SUITS.reduce((a, suit) => a + (hCounts[suit] || 0), 0);
    const label   = hand === 'banquier' ? '🏦 Banquier' : '👤 Joueur';
    const lines   = ALL_SUITS.map(suit => {
      const cnt = hCounts[suit] || 0;
      const pct = total > 0 ? ((cnt / total) * 100).toFixed(1) : '0.0';
      return `${SUIT_EMOJI[suit]} : ${cnt}  (${pct}%)`;
    });
    return `📈 Taux Miroir — ${label}\n━━━━━━━━━━━━━━━━━━\n${lines.join('\n')}\n📊 Total : ${total} cartes${footer}`;
  }

  if (ct === 'valeur_joueur' || ct === 'valeur_banquier') {
    const vals  = ct === 'valeur_joueur' ? s.valeurJoueur : s.valeurBanquier;
    const total = CARD_RANKS.reduce((a, r) => a + (vals[r] || 0), 0);
    const label = ct === 'valeur_joueur' ? '👤 Joueur' : '🏦 Banquier';
    const lines = CARD_RANKS.map(r => {
      const cnt = vals[r] || 0;
      const pct = total > 0 ? ((cnt / total) * 100).toFixed(1) : '0.0';
      return `${r.padEnd(2)} : ${String(cnt).padStart(4)}  (${pct}%)`;
    });
    return `🃏 Valeurs de cartes — ${label}\n━━━━━━━━━━━━━━━━━━\n${lines.join('\n')}\n📊 Total : ${total} cartes${footer}`;
  }

  if (ct === 'parite_joueur' || ct === 'parite_banquier') {
    const par   = ct === 'parite_joueur' ? s.pariteJoueur : s.pariteBanquier;
    const total = (par.pair || 0) + (par.impair || 0);
    const pct   = (n) => total > 0 ? ((n / total) * 100).toFixed(1) : '0.0';
    const label = ct === 'parite_joueur' ? '👤 Joueur' : '🏦 Banquier';
    return `⚖️ Parité Score — ${label}\n━━━━━━━━━━━━━━━━━━\n🔵 Pair   : ${par.pair||0}  (${pct(par.pair||0)}%)\n🔴 Impair : ${par.impair||0}  (${pct(par.impair||0)}%)\n📊 Total jeux : ${total}${footer}`;
  }

  if (ct === 'score_joueur' || ct === 'score_banquier') {
    const scores = ct === 'score_joueur' ? s.scoreJoueur : s.scoreBanquier;
    const label  = ct === 'score_joueur' ? '👤 Joueur' : '🏦 Banquier';
    const total  = Object.values(scores).reduce((a, v) => a + v, 0);
    const lines  = [];
    for (let i = 0; i <= 9; i++) {
      const cnt = scores[i] || 0;
      const pct = total > 0 ? ((cnt / total) * 100).toFixed(1) : '0.0';
      const bar = cnt > 0 ? '█'.repeat(Math.min(Math.round((cnt / Math.max(total, 1)) * 10), 10)) : '░';
      lines.push(`${i} : ${String(cnt).padStart(4)}  (${pct}%)  ${bar}`);
    }
    return `🎯 Score Total — ${label}\n━━━━━━━━━━━━━━━━━━\n${lines.join('\n')}\n📊 Total jeux : ${total}${footer}`;
  }

  if (ct === 'groupe_joueur' || ct === 'groupe_banquier') {
    const isJ   = ct === 'groupe_joueur';
    const cats  = isJ ? GROUPE_JOUEUR_CATEGORIES : GROUPE_BANQUIER_CATEGORIES;
    const grp   = isJ ? s.groupeJoueur : s.groupeBanquier;
    const label = isJ ? '👤 Joueur' : '🏦 Banquier';
    const total = cats.reduce((a, c) => a + (grp[c.key] || 0), 0);
    const lines = cats.map(c => `${c.label} : ${grp[c.key] || 0}`);
    return `📊 Groupe — ${label}\n━━━━━━━━━━━━━━━━━━\n${lines.join('\n')}\n📌 Total jeux : ${total}${footer}`;
  }

  return '❌ Type de compteur inconnu';
}

function _buildFooter(s, counter) {
  const lines = [];
  if (s.lastGameNumber) lines.push(`🎮 Jeu #${s.lastGameNumber}  |  📊 ${s.gameCount} jeu(x) depuis dernier reset`);
  if (counter.reset_after_send !== false) {
    const info = _getNextResetInfo(counter);
    lines.push(`⏭ Reset dans ${info.timeStr}  (${info.label})`);
  } else {
    lines.push('♾️ Pas de reset automatique');
  }
  return `\n━━━━━━━━━━━━━━━━━━\n${lines.join('\n')}`;
}

function _getNextResetInfo(counter) {
  const now      = new Date();
  const interval = parseInt(counter.interval) || 30;
  const mm       = now.getMinutes();
  const ss       = now.getSeconds();
  const candidates = [];

  const nextIntervalMin = interval === 30 ? (mm < 30 ? 30 - mm : 60 - mm) : (60 - mm);
  candidates.push({ ms: (nextIntervalMin * 60 - ss) * 1000, label: `Intervalle ${interval}min` });

  for (const t of (Array.isArray(counter.send_times) ? counter.send_times : [])) {
    const [hh, mm2] = t.split(':').map(Number);
    const target = new Date(now);
    target.setHours(hh, mm2, 0, 0);
    if (target <= now) target.setDate(target.getDate() + 1);
    candidates.push({ ms: target - now, label: `Heure fixe (${t})` });
  }

  candidates.sort((a, b) => a.ms - b.ms);
  const next = candidates[0];
  if (!next) return { label: 'Non planifié', timeStr: '—' };
  const totalSec = Math.round(next.ms / 1000);
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const sec = totalSec % 60;
  const timeStr = h > 0 ? `${h}h ${m}min` : m > 0 ? `${m}min ${sec}s` : `${sec}s`;
  return { label: next.label, timeStr };
}

// ─── Envoi Telegram pour un compteur ─────────────────────────────────────────
async function _sendCounter(counter) {
  if (!counter.bot_token || !counter.channel_id) {
    throw new Error(`Compteur "${counter.label || counter.id}" : bot_token ou channel_id manquant`);
  }
  const text = buildMessage(counter);
  const url  = `https://api.telegram.org/bot${counter.bot_token}/sendMessage`;
  const r    = await fetch(url, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify({ chat_id: String(counter.channel_id), text }),
  });
  const d = await r.json();
  if (!d.ok) throw new Error(d.description || 'Erreur Telegram');
  return d;
}

async function sendCounterById(id) {
  const counter = _countersList.find(c => c.id === id);
  if (!counter) throw new Error(`Compteur introuvable : ${id}`);
  return _sendCounter(counter);
}

// ─── Planificateur ────────────────────────────────────────────────────────────
function _shouldSendByInterval(counter, now) {
  if (!counter.enabled) return false;
  if (!counter.bot_token || !counter.channel_id) return false;
  const s  = _countersState[counter.id];
  if (!s)  return false;
  const mm       = now.getMinutes();
  const interval = parseInt(counter.interval) || 30;
  const match    = interval === 30 ? (mm === 0 || mm === 30) : (mm === 0);
  if (!match) return false;
  return s.lastScheduleSent !== _getHHMM(now);
}

function _shouldSendByFixedTime(counter, now) {
  if (!counter.enabled) return false;
  if (!counter.bot_token || !counter.channel_id) return false;
  const s     = _countersState[counter.id];
  if (!s)     return false;
  const times = Array.isArray(counter.send_times) ? counter.send_times : [];
  if (times.length === 0) return false;
  const hhmm  = _getHHMM(now);
  return times.includes(hhmm) && !s.lastSentTimes[hhmm];
}

function startScheduler() {
  if (_schedulerInterval) clearInterval(_schedulerInterval);
  loadConfig().catch(() => {});
  _schedulerInterval = setInterval(async () => {
    try {
      if (!_configLoaded) await loadConfig();
      const now  = new Date();
      const hhmm = _getHHMM(now);

      for (const counter of _countersList) {
        if (!counter.enabled) continue;
        const s = _countersState[counter.id];
        if (!s) continue;

        let sent = false;

        if (_shouldSendByInterval(counter, now)) {
          s.lastScheduleSent = hhmm;
          try {
            await _sendCounter(counter);
            console.log(`[SuitCounter] ⏰ [${counter.label||counter.id}] Envoi intervalle — ${hhmm}`);
            sent = true;
          } catch (e) {
            console.warn(`[SuitCounter] ⚠️ [${counter.label||counter.id}] Erreur envoi intervalle: ${e.message}`);
          }
        }

        if (_shouldSendByFixedTime(counter, now)) {
          s.lastSentTimes[hhmm] = true;
          try {
            await _sendCounter(counter);
            console.log(`[SuitCounter] ⏰ [${counter.label||counter.id}] Envoi heure fixe — ${hhmm}`);
            sent = true;
          } catch (e) {
            console.warn(`[SuitCounter] ⚠️ [${counter.label||counter.id}] Erreur envoi heure fixe: ${e.message}`);
          }
        }

        if (sent && counter.reset_after_send !== false) {
          _countersState[counter.id] = _makeState();
          console.log(`[SuitCounter] 🔄 [${counter.label||counter.id}] Remise à zéro — ${hhmm}`);
        }

        // Reset des heures déjà envoyées à minuit
        if (now.getHours() === 0 && now.getMinutes() === 0) {
          s.lastSentTimes = {};
        }
      }
    } catch (e) {
      console.warn('[SuitCounter] Erreur scheduler:', e.message);
    }
  }, 60 * 1000);
  console.log('[SuitCounter] ⏱ Scheduler v2 démarré (vérif. toutes les 60s)');
}

// ─── Rétrocompatibilité ancienne API ─────────────────────────────────────────
// Ces fonctions permettent au reste du code qui utilisait l'ancienne API
// de continuer à fonctionner sans modification.
function getConfig() {
  const first = _countersList[0];
  if (!first) return {
    enabled: false, channels: [], counter_type: 'taux_miroir', hand: 'joueur',
    interval: 30, send_on_game_end: false, send_times: [], reset_after_send: true,
  };
  return {
    enabled:          first.enabled,
    channels:         _countersList.map(c => ({ bot_token: c.bot_token, channel_id: c.channel_id, label: c.label })),
    counter_type:     first.counter_type,
    hand:             first.hand,
    interval:         first.interval,
    send_on_game_end: first.send_on_game_end,
    send_times:       first.send_times,
    reset_after_send: first.reset_after_send,
  };
}

function getCounters() {
  const firstId = _countersList[0]?.id;
  if (!firstId || !_countersState[firstId]) {
    return {
      taux_miroir: { joueur: {'♠':0,'♥':0,'♦':0,'♣':0}, banquier: {'♠':0,'♥':0,'♦':0,'♣':0} },
      groupe_joueur: {}, groupe_banquier: {},
      valeur_joueur: {}, valeur_banquier: {},
      parite_joueur: { pair: 0, impair: 0 }, parite_banquier: { pair: 0, impair: 0 },
      score_joueur: {}, score_banquier: {},
      meta: { game_count: 0, last_game_number: null },
    };
  }
  const s = _countersState[firstId];
  return {
    taux_miroir:     { joueur: { ...s.suitCounters.joueur }, banquier: { ...s.suitCounters.banquier } },
    groupe_joueur:   { ...s.groupeJoueur },
    groupe_banquier: { ...s.groupeBanquier },
    valeur_joueur:   { ...s.valeurJoueur },
    valeur_banquier: { ...s.valeurBanquier },
    parite_joueur:   { ...s.pariteJoueur },
    parite_banquier: { ...s.pariteBanquier },
    score_joueur:    { ...s.scoreJoueur },
    score_banquier:  { ...s.scoreBanquier },
    meta: { game_count: s.gameCount, last_game_number: s.lastGameNumber },
  };
}

async function saveConfig(cfg) {
  if (!_countersList.length) return;
  const first = _countersList[0];
  const updated = { ...first };
  if (cfg.enabled          !== undefined) updated.enabled          = !!cfg.enabled;
  if (cfg.counter_type     !== undefined) updated.counter_type     = cfg.counter_type;
  if (cfg.hand             !== undefined) updated.hand             = cfg.hand;
  if (cfg.interval         !== undefined) updated.interval         = cfg.interval;
  if (cfg.send_on_game_end !== undefined) updated.send_on_game_end = !!cfg.send_on_game_end;
  if (cfg.send_times       !== undefined) updated.send_times       = cfg.send_times;
  if (cfg.reset_after_send !== undefined) updated.reset_after_send = cfg.reset_after_send;
  _countersList[0] = updated;
  await db.setSetting('suit_counters_v2', JSON.stringify(_countersList));
}

async function sendNow() {
  if (!_configLoaded) await loadConfig();
  if (_countersList.length === 0) throw new Error('Aucun compteur configuré');
  const errors = [];
  for (const counter of _countersList) {
    if (!counter.enabled) continue;
    try { await _sendCounter(counter); } catch (e) { errors.push(e.message); }
  }
  if (errors.length > 0) throw new Error(errors.join('; '));
}

function resetCounters() {
  resetAllStates();
}

module.exports = {
  loadConfig, saveConfig, getConfig,
  getCounters, resetCounters,
  onGameFinished, buildMessage, sendNow,
  startScheduler,
  // ── API v2 multi-compteurs ──
  getCountersList, saveCountersList, getCounterState, getAllStates,
  resetCounterState, resetAllStates,
  sendCounterById,
  _makeId,
  VALID_TYPES,
  GROUPE_JOUEUR_CATEGORIES,
  GROUPE_BANQUIER_CATEGORIES,
  CARD_RANKS,
};
