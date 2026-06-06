/**
 * Compteur instantané → Telegram
 * Types : taux_miroir, groupe_joueur, groupe_banquier,
 *         valeur_joueur, valeur_banquier, parite_joueur, parite_banquier
 */
const db    = require('./db');
const fetch = require('node-fetch');

const ALL_SUITS  = ['♠', '♥', '♦', '♣'];
const SUIT_EMOJI = { '♠': '♠️', '♥': '♥️', '♦': '♦️', '♣': '♣️' };
const CARD_RANKS = ['A','2','3','4','5','6','7','8','9','10','J','Q','K'];

// ─── Catégories Groupe Joueur ─────────────────────────────────────────────────
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

// ─── Catégories Groupe Banquier ───────────────────────────────────────────────
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

function _makeGroupeCounters(cats) {
  const c = {};
  for (const { key } of cats) c[key] = 0;
  return c;
}
function _makeValeurCounters() {
  const c = {};
  for (const r of CARD_RANKS) c[r] = 0;
  return c;
}

// ─── État interne ─────────────────────────────────────────────────────────────
let _config = {
  enabled:          false,
  channels:         [],
  counter_type:     'taux_miroir',
  hand:             'joueur',
  interval:         30,
  send_on_game_end: false,
  send_times:       [],
  reset_after_send: true,
};

let _suitCounters = {
  joueur:   { '♠': 0, '♥': 0, '♦': 0, '♣': 0 },
  banquier: { '♠': 0, '♥': 0, '♦': 0, '♣': 0 },
};
let _groupeJoueurCounters   = _makeGroupeCounters(GROUPE_JOUEUR_CATEGORIES);
let _groupeBanquierCounters = _makeGroupeCounters(GROUPE_BANQUIER_CATEGORIES);
let _valeurJoueurCounters   = _makeValeurCounters();
let _valeurBanquierCounters = _makeValeurCounters();
let _pariteJoueurCounters   = { pair: 0, impair: 0 };
let _pariteBanquierCounters = { pair: 0, impair: 0 };

let _gameCount      = 0;
let _lastGameNumber = null;

let _lastScheduleSent  = null;
let _lastSentTimes     = {};
let _schedulerInterval = null;
let _configLoaded      = false;

// ─── Helpers cartes ───────────────────────────────────────────────────────────
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
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

// ─── Config ───────────────────────────────────────────────────────────────────
async function loadConfig() {
  try {
    const raw = await db.getSetting('suit_counter_config');
    if (raw) {
      const saved = JSON.parse(raw);
      if (!Array.isArray(saved.channels)) {
        saved.channels = [];
        if (saved.bot_token && saved.channel_id) {
          saved.channels.push({ bot_token: saved.bot_token, channel_id: saved.channel_id, label: 'Canal 1' });
        }
        delete saved.bot_token;
        delete saved.channel_id;
      }
      Object.assign(_config, saved);
    }
  } catch (e) {
    console.warn('[SuitCounter] Erreur chargement config:', e.message);
  }
  _configLoaded = true;
}

async function saveConfig(cfg) {
  Object.assign(_config, cfg);
  await db.setSetting('suit_counter_config', JSON.stringify(_config));
}

function getConfig() { return JSON.parse(JSON.stringify(_config)); }

function getCounters() {
  return {
    taux_miroir: {
      joueur:   { ..._suitCounters.joueur },
      banquier: { ..._suitCounters.banquier },
    },
    groupe_joueur:   { ..._groupeJoueurCounters },
    groupe_banquier: { ..._groupeBanquierCounters },
    valeur_joueur:   { ..._valeurJoueurCounters },
    valeur_banquier: { ..._valeurBanquierCounters },
    parite_joueur:   { ..._pariteJoueurCounters },
    parite_banquier: { ..._pariteBanquierCounters },
    meta: {
      game_count:       _gameCount,
      last_game_number: _lastGameNumber,
    },
  };
}

function resetCounters() {
  _suitCounters = {
    joueur:   { '♠': 0, '♥': 0, '♦': 0, '♣': 0 },
    banquier: { '♠': 0, '♥': 0, '♦': 0, '♣': 0 },
  };
  _groupeJoueurCounters   = _makeGroupeCounters(GROUPE_JOUEUR_CATEGORIES);
  _groupeBanquierCounters = _makeGroupeCounters(GROUPE_BANQUIER_CATEGORIES);
  _valeurJoueurCounters   = _makeValeurCounters();
  _valeurBanquierCounters = _makeValeurCounters();
  _pariteJoueurCounters   = { pair: 0, impair: 0 };
  _pariteBanquierCounters = { pair: 0, impair: 0 };
  _gameCount              = 0;
  // NE PAS réinitialiser _lastScheduleSent et _lastSentTimes ici —
  // ces variables appartiennent au planificateur, pas aux compteurs.
  // Les réinitialiser provoquerait un double envoi immédiat après reset.
}

// ─── Mise à jour compteurs après chaque jeu ───────────────────────────────────
function onGameFinished(gn, pSuits, bSuits, pCards, bCards, winner) {
  _lastGameNumber = gn;
  _gameCount++;

  // Taux miroir (costumes)
  for (const s of (pSuits || [])) {
    if (ALL_SUITS.includes(s)) _suitCounters.joueur[s] = (_suitCounters.joueur[s] || 0) + 1;
  }
  for (const s of (bSuits || [])) {
    if (ALL_SUITS.includes(s)) _suitCounters.banquier[s] = (_suitCounters.banquier[s] || 0) + 1;
  }

  // Valeurs de cartes
  for (const card of (pCards || [])) {
    const r = _getCardRank(card);
    if (r) _valeurJoueurCounters[r] = (_valeurJoueurCounters[r] || 0) + 1;
  }
  for (const card of (bCards || [])) {
    const r = _getCardRank(card);
    if (r) _valeurBanquierCounters[r] = (_valeurBanquierCounters[r] || 0) + 1;
  }

  // Parité (score Baccarat de la main)
  const scoreJoueur  = _handBaccaratScore(pCards || []);
  const scoreBanquier = _handBaccaratScore(bCards || []);
  if (scoreJoueur % 2 === 0)  _pariteJoueurCounters.pair++;
  else                         _pariteJoueurCounters.impair++;
  if (scoreBanquier % 2 === 0) _pariteBanquierCounters.pair++;
  else                          _pariteBanquierCounters.impair++;

  // Groupe Joueur
  const np = _countCards(pCards);
  const nb = _countCards(bCards);
  const w  = winner || '';
  if (w === 'Player')     _groupeJoueurCounters.vic_joueur++;
  else if (w === 'Tie')   _groupeJoueurCounters.egalite++;
  if (np === 2)           _groupeJoueurCounters.p2k++;
  else if (np === 3)      _groupeJoueurCounters.p3k++;
  if      (np === 2 && nb === 2) _groupeJoueurCounters.dist_22++;
  else if (np === 2 && nb === 3) _groupeJoueurCounters.dist_23++;
  else if (np === 3 && nb === 2) _groupeJoueurCounters.dist_32++;
  else if (np === 3 && nb === 3) _groupeJoueurCounters.dist_33++;

  // Groupe Banquier
  if (w === 'Banker')     _groupeBanquierCounters.vic_banquier++;
  else if (w === 'Tie')   _groupeBanquierCounters.egalite++;
  if (nb === 2)           _groupeBanquierCounters.b2k++;
  else if (nb === 3)      _groupeBanquierCounters.b3k++;
  if      (np === 2 && nb === 2) _groupeBanquierCounters.dist_22++;
  else if (np === 2 && nb === 3) _groupeBanquierCounters.dist_23++;
  else if (np === 3 && nb === 2) _groupeBanquierCounters.dist_32++;
  else if (np === 3 && nb === 3) _groupeBanquierCounters.dist_33++;

  // Envoi après chaque jeu
  if (_config.enabled && _config.send_on_game_end) {
    const channels = Array.isArray(_config.channels) ? _config.channels : [];
    if (channels.length > 0) {
      _sendToAllChannels(buildMessage(_config.counter_type, _config.hand)).catch(() => {});
    }
  }
}

// ─── Prochain reset ───────────────────────────────────────────────────────────
function _getNextResetInfo() {
  const now      = new Date();
  const interval = parseInt(_config.interval) || 30;
  const mm       = now.getMinutes();
  const ss       = now.getSeconds();
  const candidates = [];

  // Intervalle
  const nextIntervalMin = interval === 30 ? (mm < 30 ? 30 - mm : 60 - mm) : (60 - mm);
  candidates.push({ ms: (nextIntervalMin * 60 - ss) * 1000, label: `Intervalle ${interval}min` });

  // Heures fixes
  for (const t of (Array.isArray(_config.send_times) ? _config.send_times : [])) {
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
  const s = totalSec % 60;
  const timeStr = h > 0 ? `${h}h ${m}min` : m > 0 ? `${m}min ${s}s` : `${s}s`;
  return { label: next.label, timeStr };
}

function _buildFooter() {
  const lines = [];
  if (_lastGameNumber) lines.push(`🎮 Jeu #${_lastGameNumber}  |  📊 ${_gameCount} jeu(x) depuis dernier reset`);
  if (_config.reset_after_send !== false) {
    const info = _getNextResetInfo();
    lines.push(`⏭ Reset dans ${info.timeStr}  (${info.label})`);
  } else {
    lines.push(`♾️ Pas de reset automatique`);
  }
  return `\n━━━━━━━━━━━━━━━━━━\n${lines.join('\n')}`;
}

// ─── Construction du message ──────────────────────────────────────────────────
function buildMessage(counterType, hand) {
  const ct = counterType || _config.counter_type || 'taux_miroir';
  const h  = hand || _config.hand || 'joueur';
  const footer = _buildFooter();

  if (ct === 'taux_miroir') {
    const hCounts   = _suitCounters[h] || {};
    const total     = ALL_SUITS.reduce((a, s) => a + (hCounts[s] || 0), 0);
    const handLabel = h === 'banquier' ? '🏦 Banquier' : '👤 Joueur';
    const lines     = ALL_SUITS.map(s => {
      const cnt = hCounts[s] || 0;
      const pct = total > 0 ? ((cnt / total) * 100).toFixed(1) : '0.0';
      return `${SUIT_EMOJI[s]} : ${cnt}  (${pct}%)`;
    });
    return `📈 Taux Miroir — ${handLabel}\n━━━━━━━━━━━━━━━━━━\n${lines.join('\n')}\n📊 Total : ${total} cartes${footer}`;
  }

  if (ct === 'groupe_joueur') {
    const cats  = GROUPE_JOUEUR_CATEGORIES;
    const total = cats.reduce((a, c) => a + (_groupeJoueurCounters[c.key] || 0), 0);
    const lines = cats.map(c => `${c.label} : ${_groupeJoueurCounters[c.key] || 0}`);
    return `📊 Groupe — 👤 Joueur\n━━━━━━━━━━━━━━━━━━\n${lines.join('\n')}\n📌 Total jeux : ${total}${footer}`;
  }

  if (ct === 'groupe_banquier') {
    const cats  = GROUPE_BANQUIER_CATEGORIES;
    const total = cats.reduce((a, c) => a + (_groupeBanquierCounters[c.key] || 0), 0);
    const lines = cats.map(c => `${c.label} : ${_groupeBanquierCounters[c.key] || 0}`);
    return `📊 Groupe — 🏦 Banquier\n━━━━━━━━━━━━━━━━━━\n${lines.join('\n')}\n📌 Total jeux : ${total}${footer}`;
  }

  if (ct === 'valeur_joueur') {
    const total = CARD_RANKS.reduce((a, r) => a + (_valeurJoueurCounters[r] || 0), 0);
    const lines = CARD_RANKS.map(r => {
      const cnt = _valeurJoueurCounters[r] || 0;
      const pct = total > 0 ? ((cnt / total) * 100).toFixed(1) : '0.0';
      return `${r.padEnd(2)} : ${String(cnt).padStart(4)}  (${pct}%)`;
    });
    return `🃏 Valeurs de cartes — 👤 Joueur\n━━━━━━━━━━━━━━━━━━\n${lines.join('\n')}\n📊 Total : ${total} cartes${footer}`;
  }

  if (ct === 'valeur_banquier') {
    const total = CARD_RANKS.reduce((a, r) => a + (_valeurBanquierCounters[r] || 0), 0);
    const lines = CARD_RANKS.map(r => {
      const cnt = _valeurBanquierCounters[r] || 0;
      const pct = total > 0 ? ((cnt / total) * 100).toFixed(1) : '0.0';
      return `${r.padEnd(2)} : ${String(cnt).padStart(4)}  (${pct}%)`;
    });
    return `🃏 Valeurs de cartes — 🏦 Banquier\n━━━━━━━━━━━━━━━━━━\n${lines.join('\n')}\n📊 Total : ${total} cartes${footer}`;
  }

  if (ct === 'parite_joueur') {
    const pair   = _pariteJoueurCounters.pair   || 0;
    const impair = _pariteJoueurCounters.impair  || 0;
    const total  = pair + impair;
    const pct = (n) => total > 0 ? ((n / total) * 100).toFixed(1) : '0.0';
    return `⚖️ Parité Score — 👤 Joueur\n━━━━━━━━━━━━━━━━━━\n🔵 Pair   : ${pair}  (${pct(pair)}%)\n🔴 Impair : ${impair}  (${pct(impair)}%)\n📊 Total jeux : ${total}${footer}`;
  }

  if (ct === 'parite_banquier') {
    const pair   = _pariteBanquierCounters.pair   || 0;
    const impair = _pariteBanquierCounters.impair  || 0;
    const total  = pair + impair;
    const pct = (n) => total > 0 ? ((n / total) * 100).toFixed(1) : '0.0';
    return `⚖️ Parité Score — 🏦 Banquier\n━━━━━━━━━━━━━━━━━━\n🔵 Pair   : ${pair}  (${pct(pair)}%)\n🔴 Impair : ${impair}  (${pct(impair)}%)\n📊 Total jeux : ${total}${footer}`;
  }

  return '❌ Type de compteur inconnu';
}

// ─── Envoi Telegram ───────────────────────────────────────────────────────────
async function _sendToAllChannels(text) {
  const channels = Array.isArray(_config.channels) ? _config.channels : [];
  for (const ch of channels) {
    if (!ch.bot_token || !ch.channel_id) continue;
    try {
      const url = `https://api.telegram.org/bot${ch.bot_token}/sendMessage`;
      const r   = await fetch(url, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ chat_id: String(ch.channel_id), text }),
      });
      const d = await r.json();
      if (!d.ok) console.warn(`[SuitCounter] Telegram erreur canal ${ch.channel_id}:`, d.description);
    } catch (e) {
      console.warn('[SuitCounter] Erreur envoi canal:', e.message);
    }
  }
}

async function sendNow() {
  if (!_configLoaded) await loadConfig();
  const channels = Array.isArray(_config.channels) ? _config.channels : [];
  if (channels.length === 0) throw new Error('Aucun canal configuré');
  await _sendToAllChannels(buildMessage(_config.counter_type, _config.hand));
}

// ─── Planificateur ────────────────────────────────────────────────────────────
function _shouldSendByInterval(now) {
  if (!_config.enabled) return false;
  const channels = Array.isArray(_config.channels) ? _config.channels : [];
  if (channels.length === 0) return false;
  const mm       = now.getMinutes();
  const interval = parseInt(_config.interval) || 30;
  const match    = interval === 30 ? (mm === 0 || mm === 30) : (mm === 0);
  if (!match) return false;
  return _lastScheduleSent !== _getHHMM(now);
}

function _shouldSendByFixedTime(now) {
  if (!_config.enabled) return false;
  const channels = Array.isArray(_config.channels) ? _config.channels : [];
  if (channels.length === 0) return false;
  const times = Array.isArray(_config.send_times) ? _config.send_times : [];
  if (times.length === 0) return false;
  const hhmm = _getHHMM(now);
  return times.includes(hhmm) && !_lastSentTimes[hhmm];
}

function startScheduler() {
  if (_schedulerInterval) clearInterval(_schedulerInterval);
  loadConfig().catch(() => {});
  _schedulerInterval = setInterval(async () => {
    try {
      if (!_configLoaded) await loadConfig();
      const now  = new Date();
      const hhmm = _getHHMM(now);
      let sent   = false;

      if (_shouldSendByInterval(now)) {
        _lastScheduleSent = hhmm;
        await _sendToAllChannels(buildMessage(_config.counter_type, _config.hand));
        console.log(`[SuitCounter] ⏰ Envoi intervalle — ${hhmm}`);
        sent = true;
      }

      if (_shouldSendByFixedTime(now)) {
        _lastSentTimes[hhmm] = true;
        await _sendToAllChannels(buildMessage(_config.counter_type, _config.hand));
        console.log(`[SuitCounter] ⏰ Envoi heure fixe — ${hhmm}`);
        sent = true;
      }

      if (sent && _config.reset_after_send !== false) {
        resetCounters();
        console.log(`[SuitCounter] 🔄 Remise à zéro — ${hhmm}`);
      }

      if (now.getHours() === 0 && now.getMinutes() === 0) _lastSentTimes = {};
    } catch (e) {
      console.warn('[SuitCounter] Erreur scheduler:', e.message);
    }
  }, 60 * 1000);
  console.log('[SuitCounter] ⏱ Scheduler démarré (vérif. toutes les 60s)');
}

module.exports = {
  loadConfig, saveConfig, getConfig,
  getCounters, resetCounters,
  onGameFinished, buildMessage, sendNow,
  startScheduler,
  GROUPE_JOUEUR_CATEGORIES,
  GROUPE_BANQUIER_CATEGORIES,
  CARD_RANKS,
};
