/**
 * Service de relais Telegram
 * Lit les messages d'un canal source et les recopie vers un canal destination.
 *
 * DEUX modes selon si src_bot_token == bot principal :
 *  - Mode HOOK   : même token → s'abonne aux updates reçus par telegram-service.js
 *  - Mode POLL   : token différent → long-polling indépendant (getUpdates 25s)
 *
 * Configuration stockée en DB : setting 'tg_relay_configs'
 */

const fetch      = require('node-fetch');
const db         = require('./db');

const SETTING_KEY  = 'tg_relay_configs';
const POLL_TIMEOUT = 25;
const RETRY_DELAY  = 5000;

// Carte des boucles actives : id → { stop, mode }
const _loops = new Map();

// ── Helpers API Telegram ──────────────────────────────────────────────────────
async function _tgCall(token, method, params = {}) {
  const url  = `https://api.telegram.org/bot${token}/${method}`;
  const resp = await fetch(url, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify(params),
    timeout: (POLL_TIMEOUT + 10) * 1000,
  });
  if (!resp.ok) throw new Error(`Telegram ${method} HTTP ${resp.status}`);
  const data = await resp.json();
  if (!data.ok) throw new Error(`Telegram ${method}: ${data.description || JSON.stringify(data)}`);
  return data.result;
}

async function _getUpdates(token, offset, timeoutSecs) {
  return _tgCall(token, 'getUpdates', {
    offset,
    timeout:         timeoutSecs,
    allowed_updates: ['channel_post', 'message'],
  });
}

// ── Persistence ───────────────────────────────────────────────────────────────
async function _loadConfigs() {
  try {
    const v = await db.getSetting(SETTING_KEY);
    if (!v) return [];
    const arr = JSON.parse(v);
    return Array.isArray(arr) ? arr : [];
  } catch { return []; }
}

async function _saveConfigs(configs) {
  await db.setSetting(SETTING_KEY, JSON.stringify(configs));
}

async function _persistOffset(id, offset) {
  try {
    const configs = await _loadConfigs();
    const idx = configs.findIndex(c => c.id === id);
    if (idx >= 0) { configs[idx].last_update_id = offset; await _saveConfigs(configs); }
  } catch {}
}

// ── Filtre : ce message provient-il du canal source configuré ? ───────────────
function _matchesSource(cfg, post) {
  if (!post?.chat) return false;
  const fromId  = String(post.chat.id || '');
  const srcId   = String(cfg.src_channel_id || '').trim();
  if (!srcId) return true; // pas de filtre → laisser passer

  // Comparaison directe (numérique ou username)
  if (fromId === srcId) return true;
  // Cas @username
  const fromAt = fromId.startsWith('@') ? fromId : `@${fromId}`;
  const srcAt  = srcId.startsWith('@')  ? srcId  : `@${srcId}`;
  if (fromAt === srcAt) return true;

  return false;
}

// ── Copie un message vers le canal destination ────────────────────────────────
async function _relayMsg(cfg, post) {
  const label = cfg.label || cfg.id;
  const chatFromId = String(post.chat?.id || '?');
  const msgId      = post.message_id;

  if (!_matchesSource(cfg, post)) {
    console.log(`[TgRelay] ⏩ "${label}" filtré — chat ${chatFromId} ≠ src ${cfg.src_channel_id}`);
    return;
  }

  console.log(`[TgRelay] 📩 "${label}" reçu msg #${msgId} depuis chat ${chatFromId} → copie vers ${cfg.dst_channel_id}`);

  // copyMessage : même contenu, SANS mention "Transféré depuis"
  try {
    await _tgCall(cfg.dst_bot_token, 'copyMessage', {
      chat_id:      cfg.dst_channel_id,
      from_chat_id: post.chat.id,
      message_id:   msgId,
    });
    console.log(`[TgRelay] ✅ "${label}" copyMessage #${msgId} OK`);
    return;
  } catch (copyErr) {
    console.warn(`[TgRelay] ⚠️ "${label}" copyMessage échoué: ${copyErr.message} — tentative sendMessage`);
  }

  // Fallback : envoyer le texte brut
  try {
    const text = post.text || post.caption || '';
    if (!text) { console.warn(`[TgRelay] ⚠️ "${label}" pas de texte à copier`); return; }
    await _tgCall(cfg.dst_bot_token, 'sendMessage', {
      chat_id:    cfg.dst_channel_id,
      text,
    });
    console.log(`[TgRelay] ✅ "${label}" sendMessage (fallback texte) OK`);
  } catch (txtErr) {
    console.error(`[TgRelay] ❌ "${label}" échec total relay msg #${msgId}: ${txtErr.message}`);
  }
}

// ── MODE HOOK : le relay s'abonne aux updates du bot principal ────────────────
function _startHookLoop(cfg) {
  const tgService = require('./telegram-service');
  const label     = cfg.label || cfg.id;

  console.log(`[TgRelay] 🔗 "${label}" mode HOOK (même token que bot principal) — src: ${cfg.src_channel_id} → dst: ${cfg.dst_channel_id}`);

  const handler = (msg) => {
    if (!cfg.enabled) return;
    const post = msg; // channel_post ou message
    _relayMsg(cfg, post).catch(e => console.error(`[TgRelay] Handler hook erreur: ${e.message}`));
  };

  tgService.registerRelayHandler(handler);
  _loops.set(cfg.id, {
    mode: 'hook',
    stop: () => { tgService.unregisterRelayHandler(handler); console.log(`[TgRelay] 🔴 "${label}" hook désactivé`); },
  });
}

// ── MODE POLL : long-polling indépendant (token différent du bot principal) ───
function _startPollLoop(cfg) {
  const label   = cfg.label || cfg.id;
  let stopped   = false;
  let offset    = (cfg.last_update_id || 0) + 1;

  console.log(`[TgRelay] 🟢 "${label}" mode POLL indépendant — src: ${cfg.src_channel_id} → dst: ${cfg.dst_channel_id} (offset=${offset})`);

  const loop = async () => {
    while (!stopped) {
      try {
        const updates = await _getUpdates(cfg.src_bot_token, offset, POLL_TIMEOUT);
        if (!stopped && Array.isArray(updates) && updates.length > 0) {
          console.log(`[TgRelay] 📬 "${label}" ${updates.length} update(s) reçu(s)`);
          for (const upd of updates) {
            if (stopped) break;
            const post = upd.channel_post || upd.message;
            if (post) {
              await _relayMsg(cfg, post).catch(() => {});
            } else {
              console.log(`[TgRelay] ⏩ "${label}" update ignoré (type non géré): ${Object.keys(upd).join(',')}`);
            }
            if (upd.update_id >= offset) offset = upd.update_id + 1;
          }
          await _persistOffset(cfg.id, offset - 1);
        }
      } catch (e) {
        if (!stopped) {
          console.warn(`[TgRelay] ⚠️ "${label}" erreur polling: ${e.message} — retry dans ${RETRY_DELAY / 1000}s`);
          await new Promise(r => setTimeout(r, RETRY_DELAY));
        }
      }
    }
  };

  loop().catch(e => console.error(`[TgRelay] 💥 Loop crash "${label}":`, e.message));
  _loops.set(cfg.id, {
    mode: 'poll',
    stop: () => { stopped = true; console.log(`[TgRelay] 🔴 "${label}" polling arrêté`); },
  });
}

function _stopLoop(id) {
  const entry = _loops.get(id);
  if (entry) { entry.stop(); _loops.delete(id); }
}

// ── Démarrage d'un relay (choix auto du mode) ─────────────────────────────────
function _startLoop(cfg) {
  if (_loops.has(cfg.id)) _stopLoop(cfg.id);
  if (!cfg.src_bot_token || !cfg.dst_bot_token || !cfg.src_channel_id || !cfg.dst_channel_id) {
    console.warn(`[TgRelay] ⚠️ Config "${cfg.label || cfg.id}" incomplète — ignorée`);
    return;
  }

  // Détection conflit : même token que le bot principal ?
  let mainToken = null;
  try { mainToken = require('./telegram-service').getMainToken(); } catch {}

  const isSameToken = mainToken && (cfg.src_bot_token.trim() === mainToken.trim());
  if (isSameToken) {
    _startHookLoop(cfg);
  } else {
    _startPollLoop(cfg);
  }
}

// ── API publique ──────────────────────────────────────────────────────────────
async function startAll() {
  const configs = await _loadConfigs();
  let started = 0;
  for (const cfg of configs) {
    if (cfg.enabled && cfg.src_bot_token && cfg.dst_bot_token && cfg.src_channel_id && cfg.dst_channel_id) {
      _startLoop(cfg);
      started++;
    }
  }
  console.log(`[TgRelay] ${started} relais activé(s) sur ${configs.length} configuré(s)`);
}

async function reloadConfig(cfg) {
  _stopLoop(cfg.id);
  if (cfg.enabled && cfg.src_bot_token && cfg.dst_bot_token && cfg.src_channel_id && cfg.dst_channel_id) {
    _startLoop(cfg);
  }
}

function stopById(id) { _stopLoop(id); }

function getActiveIds() { return [..._loops.keys()]; }

module.exports = { startAll, reloadConfig, stopById, getActiveIds, _loadConfigs, _saveConfigs };
