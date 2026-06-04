const db    = require('./db');
const fetch = require('node-fetch');

const ALL_SUITS  = ['♠', '♥', '♦', '♣'];
const SUIT_EMOJI = { '♠': '♠️', '♥': '♥️', '♦': '♦️', '♣': '♣️' };

let _config = {
  enabled:           false,
  bot_token:         '',
  channel_id:        '',
  hand:              'joueur',
  interval:          30,
  send_on_game_end:  false,
};

let _counters = {
  joueur:   { '♠': 0, '♥': 0, '♦': 0, '♣': 0 },
  banquier: { '♠': 0, '♥': 0, '♦': 0, '♣': 0 },
};

let _lastScheduleSent = null;
let _schedulerInterval = null;
let _configLoaded     = false;

async function loadConfig() {
  try {
    const raw = await db.getSetting('suit_counter_config');
    if (raw) Object.assign(_config, JSON.parse(raw));
  } catch (e) {
    console.warn('[SuitCounter] Erreur chargement config:', e.message);
  }
  _configLoaded = true;
}

async function saveConfig(cfg) {
  Object.assign(_config, cfg);
  await db.setSetting('suit_counter_config', JSON.stringify(_config));
}

function getConfig() { return { ..._config }; }

function getCounters() {
  return {
    joueur:   { ..._counters.joueur },
    banquier: { ..._counters.banquier },
  };
}

function resetCounters() {
  _counters = {
    joueur:   { '♠': 0, '♥': 0, '♦': 0, '♣': 0 },
    banquier: { '♠': 0, '♥': 0, '♦': 0, '♣': 0 },
  };
  _lastScheduleSent = null;
}

function onGameFinished(gn, pSuits, bSuits) {
  for (const s of (pSuits  || [])) { if (ALL_SUITS.includes(s)) _counters.joueur[s]   = (_counters.joueur[s]   || 0) + 1; }
  for (const s of (bSuits  || [])) { if (ALL_SUITS.includes(s)) _counters.banquier[s] = (_counters.banquier[s] || 0) + 1; }

  if (_config.enabled && _config.send_on_game_end && _config.bot_token && _config.channel_id) {
    _sendTg(`${buildMessage(_config.hand, _counters)}`).catch(() => {});
  }
}

function buildMessage(hand, counters) {
  const handLabel = hand === 'banquier' ? 'banquier' : 'joueur';
  const hCounts   = counters[handLabel] || {};
  const total     = ALL_SUITS.reduce((acc, s) => acc + (hCounts[s] || 0), 0);
  const lines     = ALL_SUITS.map(s => {
    const count = hCounts[s] || 0;
    const pct   = total > 0 ? ((count / total) * 100).toFixed(1) : '0.0';
    return `${SUIT_EMOJI[s]} : ${count}  (${pct} %)`;
  });
  return `📈 Compteur instantané (main du ${handLabel})\n${lines.join('\n')}`;
}

async function _sendTg(text) {
  if (!_config.bot_token || !_config.channel_id) return;
  const url = `https://api.telegram.org/bot${_config.bot_token}/sendMessage`;
  const r = await fetch(url, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify({ chat_id: _config.channel_id, text }),
  });
  const d = await r.json();
  if (!d.ok) throw new Error(d.description || 'Telegram API error');
  return d;
}

async function sendNow() {
  if (!_configLoaded) await loadConfig();
  if (!_config.bot_token)   throw new Error('Token bot manquant');
  if (!_config.channel_id)  throw new Error('Channel ID manquant');
  const text = buildMessage(_config.hand, _counters);
  await _sendTg(text);
}

function _getHHMM(d) {
  return `${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`;
}

function _shouldSendScheduled(now) {
  if (!_config.enabled || !_config.bot_token || !_config.channel_id) return false;
  const mm       = now.getMinutes();
  const interval = parseInt(_config.interval) || 30;
  const match    = interval === 30 ? (mm === 0 || mm === 30) : (mm === 0);
  if (!match) return false;
  const key = _getHHMM(now);
  if (_lastScheduleSent === key) return false;
  return true;
}

function startScheduler() {
  if (_schedulerInterval) clearInterval(_schedulerInterval);
  loadConfig().catch(() => {});
  _schedulerInterval = setInterval(async () => {
    try {
      if (!_configLoaded) await loadConfig();
      const now = new Date();
      if (_shouldSendScheduled(now)) {
        _lastScheduleSent = _getHHMM(now);
        const text = buildMessage(_config.hand, _counters);
        await _sendTg(text);
        console.log(`[SuitCounter] ⏰ Compteurs envoyés — ${_lastScheduleSent}`);
      }
    } catch (e) {
      console.warn('[SuitCounter] Erreur scheduler:', e.message);
    }
  }, 60 * 1000);
  console.log('[SuitCounter] ⏱ Scheduler compteurs démarré (vérif. toutes les 60s)');
}

module.exports = {
  loadConfig, saveConfig, getConfig,
  getCounters, resetCounters,
  onGameFinished, buildMessage, sendNow,
  startScheduler,
};
