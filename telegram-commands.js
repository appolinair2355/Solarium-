'use strict';
/**
 * telegram-commands.js
 * Gestionnaire de commandes Telegram pour tous les tokens enregistrés.
 * Répond à /start /help /status /canaux /strategies /pause /stop /play /ping /info
 */

const fetch = require('node-fetch');
const db    = require('./db');

const API = (t) => `https://api.telegram.org/bot${t}`;

// Offset getUpdates par token  { [token]: number }
const offsets = {};
// Tokens mis en pause par /pause ou /stop  Set<string>
const pausedTokens = new Set();

// ── Envoyer une réponse HTML au chat ─────────────────────────────────────────
async function reply(token, chatId, text) {
  try {
    const r = await fetch(`${API(token)}/sendMessage`, {
      method : 'POST',
      headers: { 'Content-Type': 'application/json' },
      body   : JSON.stringify({ chat_id: chatId, text, parse_mode: 'HTML' }),
      timeout: 8000,
    });
    const d = await r.json();
    if (!d.ok && d.description?.includes("can't parse")) {
      // retry sans HTML si parsing échoue
      await fetch(`${API(token)}/sendMessage`, {
        method : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body   : JSON.stringify({ chat_id: chatId, text: text.replace(/<[^>]+>/g, '') }),
        timeout: 8000,
      });
    }
  } catch (e) {
    console.error(`[BotCmd] reply error: ${e.message}`);
  }
}

// ── Collecter tous les tokens uniques et leur contexte ───────────────────────
async function collectTokens() {
  /** @type {Map<string, { strategies: string[], channels: string[], botInfo?: object }>} */
  const tokens = new Map();

  const add = (token, stratName, channelId) => {
    if (!token || token.length < 20) return;
    const t = token.trim();
    if (!tokens.has(t)) tokens.set(t, { strategies: [], channels: [] });
    const e = tokens.get(t);
    if (stratName && !e.strategies.includes(stratName)) e.strategies.push(stratName);
    if (channelId) {
      const ch = String(channelId);
      if (!e.channels.includes(ch)) e.channels.push(ch);
    }
  };

  // 1. Token global
  try {
    const globalToken = await db.getSetting('bot_token');
    if (globalToken) add(globalToken, null, null);
  } catch {}

  // 2. Stratégies personnalisées
  try {
    const raw = await db.getSetting('custom_strategies');
    const strats = JSON.parse(raw || '[]');
    for (const s of strats) {
      const targets = s.tg_targets || [];
      for (const t of targets) {
        if (t.bot_token) add(t.bot_token, s.name || 'Stratégie sans nom', t.channel_id);
      }
    }
  } catch {}

  // 3. Configs par défaut C1/C2/C3/DC
  const defaultKeys = {
    tg_cfg_C1: '♠ C1 – Pique Noir',
    tg_cfg_C2: '♥ C2 – Cœur Rouge',
    tg_cfg_C3: '♦ C3 – Carreau Doré',
    tg_cfg_DC: '♣ DC – Double Canal',
  };
  for (const [key, label] of Object.entries(defaultKeys)) {
    try {
      const raw = await db.getSetting(key);
      if (!raw) continue;
      const cfg = typeof raw === 'string' ? JSON.parse(raw) : raw;
      if (cfg?.bot_token) add(cfg.bot_token, label, cfg.channel_id);
    } catch {}
  }

  // 4. Tokens dans les routes de stratégies (tg_route_*)
  try {
    const raw = await db.getSetting('tg_route_strats');
    const routes = JSON.parse(raw || '[]');
    for (const r of routes) {
      if (r.bot_token) add(r.bot_token, r.strategy_name || r.strategy, r.channel_id);
    }
  } catch {}

  return tokens;
}

// ── Récupérer les infos du bot (cache) ───────────────────────────────────────
const botInfoCache = {};
async function getBotInfo(token) {
  if (botInfoCache[token]) return botInfoCache[token];
  try {
    const r = await fetch(`${API(token)}/getMe`, { timeout: 6000 });
    const d = await r.json();
    if (d.ok) {
      botInfoCache[token] = d.result;
      return d.result;
    }
  } catch {}
  return null;
}

// ── Traiter une commande ──────────────────────────────────────────────────────
async function handleCommand(token, msg, tokenData) {
  const chatId  = msg.chat?.id;
  if (!chatId) return;

  const text    = (msg.text || '').trim();
  const cmd     = text.split(' ')[0].split('@')[0].toLowerCase();
  const from    = msg.from;
  const fromName = [from?.first_name, from?.last_name].filter(Boolean).join(' ') || 'Utilisateur';

  const botInfo  = await getBotInfo(token);
  const botName  = botInfo ? `@${botInfo.username}` : 'Baccarat Bot';
  const isPaused = pausedTokens.has(token);
  const nbStrats = tokenData.strategies.length;
  const nbChans  = tokenData.channels.length;
  const stratList = nbStrats > 0
    ? tokenData.strategies.map(s => `  • <b>${s}</b>`).join('\n')
    : '  • <i>Aucune stratégie connectée</i>';
  const chanList = nbChans > 0
    ? tokenData.channels.map((c, i) => `  ${i + 1}. <code>${c}</code>`).join('\n')
    : '  • <i>Aucun canal configuré</i>';

  const statusIcon = isPaused ? '⏸' : '✅';
  const statusLabel = isPaused ? '<b>En pause</b>' : '<b>Actif</b>';

  switch (cmd) {

    case '/start': {
      const txt =
        `🤖 <b>${botName}</b> — Baccarat Prediction Pro\n` +
        `━━━━━━━━━━━━━━━━━━━━━━\n` +
        `👋 Bonjour <b>${fromName}</b> !\n\n` +
        `${statusIcon} État : ${statusLabel}\n` +
        `📡 Canaux connectés : <b>${nbChans}</b>\n` +
        `📊 Stratégies actives : <b>${nbStrats}</b>\n\n` +
        `Tapez /help pour voir toutes les commandes disponibles.`;
      await reply(token, chatId, txt);
      break;
    }

    case '/help': {
      const txt =
        `📋 <b>Commandes disponibles</b>\n` +
        `━━━━━━━━━━━━━━━━━━━━━━\n` +
        `/start — Accueil et infos du bot\n` +
        `/status — État en temps réel\n` +
        `/canaux — Canaux Telegram connectés\n` +
        `/strategies — Stratégies de prédiction\n` +
        `/info — Informations techniques du bot\n` +
        `/ping — Vérifier que le bot répond\n` +
        `/pause — ⏸ Mettre les prédictions en pause\n` +
        `/stop — 🛑 Idem que /pause\n` +
        `/play — ▶️ Reprendre les prédictions\n` +
        `/resume — ▶️ Idem que /play\n` +
        `━━━━━━━━━━━━━━━━━━━━━━\n` +
        `<i>Bot géré via Baccarat Prediction Pro</i>`;
      await reply(token, chatId, txt);
      break;
    }

    case '/status': {
      const txt =
        `📊 <b>Statut du bot</b>\n` +
        `━━━━━━━━━━━━━━━━━━━━━━\n` +
        `${statusIcon} Prédictions : ${statusLabel}\n` +
        `📡 Canaux : <b>${nbChans}</b>\n` +
        `📊 Stratégies : <b>${nbStrats}</b>\n\n` +
        (nbStrats > 0 ? `📌 <b>Stratégies :</b>\n${stratList}` : `📌 Aucune stratégie liée à ce token.`);
      await reply(token, chatId, txt);
      break;
    }

    case '/canaux': {
      const txt = nbChans > 0
        ? `📡 <b>Canaux connectés (${nbChans})</b>\n━━━━━━━━━━━━━━━━━━━━━━\n${chanList}`
        : `📡 <b>Aucun canal configuré</b>\n\nConfigurez un canal dans l'Admin → Telegram.`;
      await reply(token, chatId, txt);
      break;
    }

    case '/strategies': {
      const txt = nbStrats > 0
        ? `📊 <b>Stratégies actives (${nbStrats})</b>\n━━━━━━━━━━━━━━━━━━━━━━\n${stratList}`
        : `📊 <b>Aucune stratégie connectée</b>\n\nAssociez une stratégie dans l'Admin → Stratégies.`;
      await reply(token, chatId, txt);
      break;
    }

    case '/pause':
    case '/stop': {
      pausedTokens.add(token);
      const txt =
        `⏸ <b>Prédictions mises en pause</b>\n` +
        `━━━━━━━━━━━━━━━━━━━━━━\n` +
        `Ce token ne diffusera plus de signaux.\n` +
        `Tapez /play pour reprendre.\n\n` +
        (nbStrats > 0 ? `📌 Stratégies concernées :\n${stratList}` : '');
      await reply(token, chatId, txt);
      break;
    }

    case '/play':
    case '/resume': {
      pausedTokens.delete(token);
      const txt =
        `▶️ <b>Prédictions reprises</b>\n` +
        `━━━━━━━━━━━━━━━━━━━━━━\n` +
        `Le bot diffuse à nouveau les signaux.\n\n` +
        (nbStrats > 0 ? `📌 Stratégies actives :\n${stratList}` : '');
      await reply(token, chatId, txt);
      break;
    }

    case '/ping': {
      const now = new Date().toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
      await reply(token, chatId, `🏓 <b>Pong !</b> — Bot actif à ${now}`);
      break;
    }

    case '/info': {
      const botId = botInfo ? String(botInfo.id) : 'N/A';
      const botUser = botInfo ? `@${botInfo.username}` : 'N/A';
      const txt =
        `ℹ️ <b>Informations du bot</b>\n` +
        `━━━━━━━━━━━━━━━━━━━━━━\n` +
        `🤖 Nom : <b>${botUser}</b>\n` +
        `🔑 ID : <code>${botId}</code>\n` +
        `${statusIcon} État : ${statusLabel}\n` +
        `📡 Canaux : <b>${nbChans}</b>\n` +
        `📊 Stratégies : <b>${nbStrats}</b>\n` +
        (nbChans > 0 ? `\n📡 <b>Canaux :</b>\n${chanList}\n` : '') +
        (nbStrats > 0 ? `\n📌 <b>Stratégies :</b>\n${stratList}` : '');
      await reply(token, chatId, txt);
      break;
    }

    default:
      // Commande inconnue — ignorer silencieusement
      break;
  }
}

// ── Polling d'un token ────────────────────────────────────────────────────────
async function pollToken(token, tokenData) {
  const offset = offsets[token] || 0;
  try {
    const r = await fetch(
      `${API(token)}/getUpdates?offset=${offset}&timeout=20&allowed_updates=["message"]`,
      { timeout: 28000 }
    );
    if (!r.ok) return;
    const data = await r.json();
    if (!data.ok || !Array.isArray(data.result) || data.result.length === 0) return;

    for (const upd of data.result) {
      offsets[token] = upd.update_id + 1;
      const msg = upd.message;
      if (!msg?.text?.startsWith('/')) continue;
      await handleCommand(token, msg, tokenData);
    }
  } catch (e) {
    // Timeout réseau normal — ne pas logguer
    if (!e.message?.includes('timeout') && !e.message?.includes('ETIMEDOUT') && !e.message?.includes('FetchError')) {
      console.error(`[BotCmd] pollToken error (…${token.slice(-6)}): ${e.message}`);
    }
  }
}

// ── Boucle principale ─────────────────────────────────────────────────────────
let _running = false;

async function startCommandPolling() {
  if (_running) return;
  _running = true;
  console.log('[BotCmd] ✅ Gestionnaire de commandes Telegram démarré');

  (async () => {
    while (_running) {
      try {
        const tokens = await collectTokens();
        if (tokens.size > 0) {
          await Promise.allSettled(
            [...tokens.entries()].map(([tok, data]) => pollToken(tok, data))
          );
        } else {
          await new Promise(r => setTimeout(r, 30000));
        }
      } catch (e) {
        console.error('[BotCmd] Loop error:', e.message);
        await new Promise(r => setTimeout(r, 15000));
      }
    }
  })();
}

function stopCommandPolling() { _running = false; }

/** Vérifie si un token est en pause (appelable par telegram-service.js) */
function isTokenPaused(token) { return token ? pausedTokens.has(token.trim()) : false; }

module.exports = { startCommandPolling, stopCommandPolling, isTokenPaused };
