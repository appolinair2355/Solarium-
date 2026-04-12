const TelegramBot = require('node-telegram-bot-api');
const fetch       = require('node-fetch');
const db          = require('./db');

let TOKEN         = process.env.BOT_TOKEN || null;
let currentFormat = 1;
let maxRattrapage = 2;

// ── Settings loaders ───────────────────────────────────────────────

async function loadToken() {
  try { const v = await db.getSetting('bot_token'); if (v) TOKEN = v; } catch {}
  return TOKEN;
}
async function saveToken(token) { await db.setSetting('bot_token', token); TOKEN = token; }

async function loadFormat() {
  try { const v = await db.getSetting('tg_msg_format'); if (v) currentFormat = parseInt(v) || 1; } catch {}
}
async function saveFormat(id) {
  currentFormat = parseInt(id) || 1;
  await db.setSetting('tg_msg_format', String(currentFormat));
}
function getCurrentFormat() { return currentFormat; }

async function loadMaxRattrapage() {
  try { const v = await db.getSetting('max_rattrapage'); if (v !== null) maxRattrapage = parseInt(v) || 2; } catch {}
  return maxRattrapage;
}
async function saveMaxRattrapage(n) {
  maxRattrapage = Math.max(0, Math.min(5, parseInt(n) || 2));
  await db.setSetting('max_rattrapage', String(maxRattrapage));
}
function getCurrentMaxRattrapage() { return maxRattrapage; }

// ── Bot & channels ─────────────────────────────────────────────────

let bot     = null;
let botInfo = null;

const channelStore = new Map();
const sseClients   = [];

function broadcast(channelDbId, eventData) {
  const payload = `data: ${JSON.stringify({ channelDbId, ...eventData })}\n\n`;
  for (const client of sseClients) {
    if (!clientCanSee(client, channelDbId)) continue;
    try { client.res.write(payload); } catch {}
  }
}

function clientCanSee(client, channelDbId) {
  if (client.isAdmin) return true;
  if (!client.visibleSet) return false;
  return client.visibleSet.has(channelDbId);
}

function formatMessage(msg, channelDbId) {
  return {
    id: msg.message_id,
    text: msg.text || msg.caption || null,
    date: msg.date * 1000,
    channel: msg.chat.title || msg.chat.username || 'Canal',
    channelDbId,
    photo: !!(msg.photo || msg.video || msg.document),
  };
}

function normalizeTgId(id) { return String(id).replace('@', '').toLowerCase(); }

function matchesChannel(msg, tgChannelId) {
  const chatId   = String(msg.chat.id);
  const username = (msg.chat.username || '').toLowerCase();
  const cfg      = normalizeTgId(tgChannelId);
  return chatId === cfg || chatId === `-100${cfg}` || username === cfg || `-100${chatId}` === cfg;
}

async function startBot() {
  if (!TOKEN) { console.warn('⚠️  BOT_TOKEN manquant — Telegram désactivé'); return; }
  if (bot) { try { await bot.stopPolling(); } catch {} bot = null; }
  if (channelStore.size === 0) return;

  try { const tmp = new TelegramBot(TOKEN); await tmp.deleteWebhook({ drop_pending_updates: false }); } catch {}
  await new Promise(r => setTimeout(r, 2000));

  bot = new TelegramBot(TOKEN, {
    polling: { allowedUpdates: ['channel_post', 'message'], interval: 3000, params: { timeout: 10 } },
  });

  bot.getMe().then(info => {
    botInfo = info;
    console.log(`🤖 Bot Telegram connecté : @${info.username}`);
  }).catch(err => console.error('Bot getMe error:', err.message));

  function handleIncoming(msg) {
    const chatId   = String(msg.chat.id);
    const chatType = msg.chat.type;
    const text     = msg.text || msg.caption || '(media)';
    if (chatType === 'private') return;
    for (const [tgId, ch] of channelStore.entries()) {
      if (matchesChannel(msg, tgId)) {
        const entry = formatMessage(msg, ch.dbId);
        ch.messages.unshift(entry);
        if (ch.messages.length > 100) ch.messages.pop();
        broadcast(ch.dbId, { type: 'new_message', message: entry });
        console.log(`📨 Telegram [${ch.name}]: ${text.slice(0, 60)}`);
        return;
      }
    }
  }

  bot.on('channel_post', handleIncoming);
  bot.on('message', handleIncoming);
  bot.on('polling_error', err => { if (!err.message?.includes('ETELEGRAM')) return; console.error('Telegram polling error:', err.message); });
  console.log(`📡 Bot actif sur ${channelStore.size} canal(aux)`);
}

async function loadConfig() {
  try {
    await loadToken();
    await loadFormat();
    await loadMaxRattrapage();
    const rows = await db.getTelegramConfigs(true);
    for (const cfg of rows) {
      channelStore.set(cfg.channel_id, { dbId: cfg.id, name: cfg.channel_name || cfg.channel_id, messages: [] });
    }
    if (channelStore.size > 0) await startBot();
  } catch (e) { console.error('Telegram loadConfig error:', e.message); }
}

async function addChannel(tgId, name) {
  if (channelStore.size >= 10) throw new Error('Maximum 10 canaux atteint');
  const row = await db.upsertTelegramConfig({ channel_id: String(tgId), channel_name: name });
  channelStore.set(String(tgId), { dbId: row.id, name, messages: [] });
  await startBot();
  return row;
}

async function removeChannel(dbId) {
  const entry = [...channelStore.entries()].find(([, ch]) => ch.dbId === dbId);
  if (entry) channelStore.delete(entry[0]);
  await db.deleteTelegramConfig(dbId);
  if (channelStore.size === 0 && bot) { try { await bot.stopPolling(); } catch {} bot = null; }
  else if (channelStore.size > 0) await startBot();
}

async function testChannel(channelId) {
  if (!TOKEN) throw new Error('BOT_TOKEN manquant');
  const testBot = new TelegramBot(TOKEN);
  const chat = await testBot.getChat(channelId);
  return { id: String(chat.id), name: chat.title || chat.username || channelId };
}

function getChannels() {
  return [...channelStore.entries()].map(([tgId, ch]) => ({
    dbId: ch.dbId, tgId, name: ch.name, messageCount: ch.messages.length,
  }));
}

function getMessages(dbId) {
  const entry = [...channelStore.values()].find(ch => ch.dbId === dbId);
  return entry ? entry.messages : [];
}

function getStatus() {
  return { connected: !!bot, channelCount: channelStore.size, bot_username: botInfo?.username || null, channels: getChannels() };
}

async function addSSEClient(res, userId, isAdmin) {
  let visibleSet = null;
  if (!isAdmin) {
    const visible = await db.getVisibleChannels(userId);
    visibleSet = new Set(visible);
  }
  sseClients.push({ res, userId, isAdmin: !!isAdmin, visibleSet });
}

function removeSSEClient(res) {
  const i = sseClients.findIndex(c => c.res === res);
  if (i !== -1) sseClients.splice(i, 1);
}

// Called by admin after assigning channels to a user — updates live SSE connections
function updateUserVisibleSet(userId, channelDbIds) {
  const newSet = new Set(channelDbIds);
  for (const client of sseClients) {
    if (client.isAdmin) continue;
    if (client.userId !== userId) continue;
    client.visibleSet = newSet;
    // Push updated channel list to client
    const visible = [...channelStore.values()]
      .filter(ch => newSet.has(ch.dbId))
      .map(ch => ({ dbId: ch.dbId, name: ch.name, messages: getMessages(ch.dbId).slice(0, 50) }));
    try {
      client.res.write(`data: ${JSON.stringify({ type: 'init', channels: visible })}\n\n`);
      if (client.res.flush) client.res.flush();
    } catch {}
  }
}

// ── Message formatting (unified) ───────────────────────────────────

const SUIT_EMOJI_MAP = { '♠': '♠️', '♥': '❤️', '♦': '♦️', '♣': '♣️' };
const SUIT_NAME_FR   = { '♠': 'Pique', '♥': 'Cœur', '♦': 'Carreau', '♣': 'Trèfle' };
const SUPERSCRIPT    = ['⁰', '¹', '²', '³', '⁴', '⁵'];
const RATR_EMOJI     = ['0️⃣', '1️⃣', '2️⃣', '3️⃣', '4️⃣', '5️⃣'];

// Compat exports
const SUIT_EMOJI = SUIT_EMOJI_MAP;
const SUIT_NAME  = SUIT_NAME_FR;

function getSuitEmoji(suit) { return SUIT_EMOJI_MAP[suit] || suit; }
function getSuitName(suit)  { return SUIT_NAME_FR[suit]  || suit; }

/**
 * buildTgMessage — message unifié pour prédiction ET résultat.
 * status = null  → en cours (⌛)
 * status = 'gagne'  → gagné (✅ + emoji rattrapage)
 * status = 'perdu'  → perdu (❌)
 */
function buildTgMessage(formatId, {
  gameNumber, suit, strategy,
  maxR = 2,
  status = null,
  rattrapage = 0,
}) {
  const emoji   = getSuitEmoji(suit);
  const name    = getSuitName(suit);
  const sup     = SUPERSCRIPT[maxR] ?? String(maxR);

  let statusLine;
  if (status === null)         statusLine = '⌛';
  else if (status === 'gagne') statusLine = `✅ ${RATR_EMOJI[rattrapage] ?? rattrapage}`;
  else                         statusLine = '❌ PERDU ❌';

  switch (parseInt(formatId)) {
    case 1:
      return {
        text: `⚜ #N${gameNumber} Игрок    +${sup} ⚜\n◽Масть ${emoji}\n◼️ Результат ${statusLine}`,
        parse_mode: null,
      };

    case 2:
      return {
        text:
          `🎲𝐁𝐀𝐂𝐂𝐀𝐑𝐀 𝐏𝐑𝐄𝐌𝐈𝐔𝐌+${maxR} ✨🎲\n` +
          `Game ${gameNumber} :${emoji}\n` +
          `${status === null ? 'En cours' : 'Statut'} :${statusLine}`,
        parse_mode: null,
      };

    case 3:
      return {
        text:
          `𝐁𝐀𝐂𝐂𝐀𝐑𝐀 𝐏𝐑𝐎 ✨\n` +
          `🎮GAME: #N${gameNumber}\n` +
          `🃏Carte ${emoji}:${status === null ? '⌛' : statusLine}\n` +
          `Mode: Dogon ${maxR}`,
        parse_mode: null,
      };

    case 4:
      return {
        text:
          `🎰 PRÉDICTION #${gameNumber}\n` +
          `🎯 Couleur: ${emoji} ${name}\n` +
          `📊 Statut: ${status === null ? 'En cours ⏳' : statusLine}\n` +
          `🔍 ${status === null ? 'Vérification en cours' : (status === 'gagne' ? 'Vérifié ✓' : 'Résultat final')}`,
        parse_mode: null,
      };

    case 5: {
      let bar;
      if (status === null)         bar = '🟦' + '⬜'.repeat(maxR);
      else if (status === 'gagne') bar = '🟩'.repeat(rattrapage + 1) + '⬜'.repeat(Math.max(0, maxR - rattrapage));
      else                         bar = '🟥'.repeat(maxR + 1);
      return {
        text:
          `🎰 PRÉDICTION #${gameNumber}\n` +
          `🎯 Couleur: ${emoji} ${name}\n\n` +
          `🔍 Vérification jeu #${gameNumber}\n` +
          `${bar}\n` +
          `${status === null ? '⏳ Analyse...' : (status === 'gagne' ? `✅ Gagné en R${rattrapage}` : '❌ PERDU ❌')}`,
        parse_mode: null,
      };
    }

    case 6:
      return {
        text:
          `🏆 *PRÉDICTION #${gameNumber}*\n\n` +
          `🎯 Couleur: ${emoji} ${name}\n` +
          (status === null
            ? `⏳ Statut: En cours`
            : status === 'gagne'
              ? `✅ Statut: ${statusLine} GAGNÉ`
              : `Statut: ❌ PERDU ❌`),
        parse_mode: 'Markdown',
      };

    case 7:
    default:
      return {
        text:
          `<b>Le</b> <b><i>joueur</i></b> <b><u>recevra</u></b> <b>une</b> <b><i>carte</i></b> ${emoji} <b>${name}</b>\n\n` +
          (status === null
            ? `⏳ <i>En attente du résultat...</i>`
            : status === 'gagne'
              ? `✅ <b>GAGNÉ</b> ${RATR_EMOJI[rattrapage] ?? rattrapage}`
              : `❌ <b>PERDU</b> ❌`),
        parse_mode: 'HTML',
      };
  }
}

// Compat shims for existing callers
function buildPredictionMsg(formatId, data) {
  return buildTgMessage(formatId, { ...data, maxR: data.maxRattrapage ?? maxRattrapage, status: null });
}
function buildResultMsg(formatId, data) {
  return buildTgMessage(formatId, { ...data, maxR: data.maxRattrapage ?? maxRattrapage });
}

// ── Envoi bas niveau (un canal, un token) ──────────────────────────

async function _sendOneMessage(token, tgChatId, text, parse_mode) {
  const body = { chat_id: tgChatId, text };
  if (parse_mode) body.parse_mode = parse_mode;
  const resp = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!resp.ok) {
    const err = await resp.text();
    throw new Error(err.slice(0, 160));
  }
  const d = await resp.json();
  return d.result?.message_id || null;
}

// ── Routage par stratégie vers les canaux globaux ─────────────────
//
//  • Si des routes spécifiques existent pour cette stratégie → envoi
//    uniquement sur ces canaux.
//  • Sinon → envoi sur TOUS les canaux configurés (comportement actuel).
//  • Dans les deux cas, le message_id est stocké en DB pour édition.

async function sendToStrategyChannels(strategy, gameNumber, suit) {
  if (!TOKEN) return;

  const { text, parse_mode } = buildTgMessage(currentFormat, {
    gameNumber, suit, strategy, maxR: maxRattrapage, status: null,
  });

  // Déterminer les canaux cibles
  let targets;
  try {
    const routes = await db.getStrategyRoutes(strategy);
    if (routes.length > 0) {
      // Routage explicite : seulement les canaux assignés à cette stratégie
      targets = routes.map(r => ({ tgId: r.tg_id, dbId: r.id, name: r.channel_name }));
      console.log(`[TG] ${strategy} routé vers ${targets.length} canal(aux) spécifique(s)`);
    } else {
      // Pas de route → tous les canaux globaux
      targets = getChannels().map(c => ({ tgId: c.tgId, dbId: c.dbId, name: c.name }));
    }
  } catch (e) {
    console.error(`[TG] getStrategyRoutes error: ${e.message}`);
    targets = getChannels().map(c => ({ tgId: c.tgId, dbId: c.dbId, name: c.name }));
  }

  for (const ch of targets) {
    try {
      const msgId = await _sendOneMessage(TOKEN, ch.tgId, text, parse_mode);
      if (msgId) {
        await db.saveTgMsgId(strategy, gameNumber, suit, ch.tgId, msgId, null).catch(() => {});
        console.log(`[TG] ${strategy} #${gameNumber} → ${ch.name || ch.tgId} (msg_id=${msgId})`);
      }
    } catch (e) { console.error(`[TG] sendToStrategyChannels ${ch.tgId}: ${e.message}`); }
  }
}

// ── Stratégies personnalisées : envoi avec token custom + stockage ─
//
//  targets = [{ bot_token, channel_id }, ...]
//  Stocke le message_id + le bot_token dans tg_pred_messages pour
//  pouvoir éditer le message lors de la résolution.

async function sendCustomAndStore(targets, strategyId, gameNumber, suit) {
  if (!Array.isArray(targets) || targets.length === 0) return;

  const { text, parse_mode } = buildTgMessage(currentFormat, {
    gameNumber, suit, strategy: strategyId, maxR: maxRattrapage, status: null,
  });

  for (const { bot_token, channel_id } of targets) {
    if (!bot_token || !channel_id) continue;
    try {
      const msgId = await _sendOneMessage(bot_token, channel_id, text, parse_mode);
      if (msgId) {
        await db.saveTgMsgId(strategyId, gameNumber, suit, String(channel_id), msgId, bot_token).catch(() => {});
        console.log(`[TG Custom] ${strategyId} #${gameNumber} → ${channel_id} (msg_id=${msgId})`);
      }
    } catch (e) {
      console.error(`[TG Custom] sendCustomAndStore ${channel_id}: ${e.message}`);
    }
  }
}

// ── Édition des messages stockés (globaux ET personnalisés) ────────
//
//  Utilise le bot_token stocké dans tg_pred_messages s'il est présent
//  (stratégie custom), sinon le TOKEN global.

async function editStoredMessages(strategy, gameNumber, suit, status, rattrapage) {
  let stored;
  try {
    stored = await db.getTgMsgIds(strategy, gameNumber, suit);
  } catch (e) {
    console.error('[TG Edit] getTgMsgIds error:', e.message);
    stored = [];
  }

  if (!stored.length) {
    console.warn(`[TG Edit] Aucun message_id pour ${strategy}/#${gameNumber}/${suit}`);
    return;
  }

  const { text, parse_mode } = buildTgMessage(currentFormat, {
    gameNumber, suit, strategy, maxR: maxRattrapage, status, rattrapage,
  });

  for (const row of stored) {
    const token  = row.bot_token || TOKEN;
    if (!token) { console.warn(`[TG Edit] Pas de token pour ${row.channel_tg_id} — ignoré`); continue; }

    try {
      const body = { chat_id: row.channel_tg_id, message_id: parseInt(row.message_id), text };
      if (parse_mode) body.parse_mode = parse_mode;
      const resp = await fetch(`https://api.telegram.org/bot${token}/editMessageText`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (resp.ok) {
        console.log(`[TG Edit] ${strategy} #${gameNumber} → ${row.channel_tg_id} (${status} R${rattrapage})`);
      } else {
        const err = await resp.text();
        // 400 "message is not modified" est bénin — on l'ignore
        if (!err.includes('message is not modified')) {
          console.error(`[TG Edit] editMessage ${row.channel_tg_id}: ${err.slice(0, 120)}`);
        }
      }
    } catch (e) { console.error(`[TG Edit] Exception: ${e.message}`); }
  }

  if (status === 'gagne' || status === 'perdu') {
    db.deleteTgMsgIds(strategy, gameNumber, suit).catch(() => {});
  }
}

// ── Suppression propre d'une stratégie (annulation des prédictions TG) ─────
//
// Appelée lors de la suppression d'une stratégie depuis l'admin.
// Supprime les messages Telegram en attente ("en cours") et nettoie la DB.

async function cancelStrategyMessages(strategyId) {
  let rows = [];
  try { rows = await db.getTgMsgIdsForStrategy(strategyId); } catch {}

  let deleted = 0;
  for (const row of rows) {
    const token = row.bot_token || TOKEN;
    if (!token || !row.message_id || !row.channel_tg_id) continue;
    try {
      await fetch(`https://api.telegram.org/bot${token}/deleteMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chat_id: row.channel_tg_id, message_id: parseInt(row.message_id) }),
      });
      deleted++;
    } catch {}
  }

  try { await db.deleteTgMsgIdsForStrategy(strategyId); } catch {}

  if (deleted > 0) {
    console.log(`[TG] ${strategyId} supprimée → ${deleted} message(s) Telegram effacé(s)`);
  }
  return deleted;
}

// ── Alias de compatibilité ─────────────────────────────────────────

const sendToGlobalChannelsAndStore  = sendToStrategyChannels;
const editGlobalChannelMessages     = editStoredMessages;

// ── Compat: send without storing ──────────────────────────────────

async function sendPredictionToTelegram(botToken, tgChannelId, strategyName, gameNumber, predictedSuit) {
  if (!botToken || !tgChannelId) return;
  try {
    const { text, parse_mode } = buildTgMessage(currentFormat, {
      gameNumber, suit: predictedSuit, strategy: strategyName, maxR: maxRattrapage, status: null,
    });
    await _sendOneMessage(botToken, tgChannelId, text, parse_mode);
    console.log(`[TG Pred] #${gameNumber} → ${tgChannelId} (${strategyName})`);
  } catch (e) { console.error(`[TG Pred] Exception: ${e.message}`); }
}

// Ancienne version sans stockage (conservée pour compatibilité)
async function sendPredictionToTargets(targets, strategyName, gameNumber, predictedSuit) {
  if (!Array.isArray(targets) || targets.length === 0) return;
  for (const { bot_token, channel_id } of targets) {
    if (bot_token && channel_id) {
      sendPredictionToTelegram(bot_token, channel_id, strategyName, gameNumber, predictedSuit).catch(() => {});
    }
  }
}

// ── Compat: simple sendToGlobalChannels (sans stockage) ───────────

async function sendToGlobalChannels(text, parse_mode) {
  if (!TOKEN) return;
  const channels = getChannels();
  for (const ch of channels) {
    try {
      await _sendOneMessage(TOKEN, ch.tgId, text, parse_mode);
    } catch (e) { console.error(`[TG] sendToGlobalChannels: ${e.message}`); }
  }
}

module.exports = {
  loadConfig, addChannel, removeChannel, testChannel,
  getChannels, getMessages, getStatus,
  addSSEClient, removeSSEClient, updateUserVisibleSet,
  saveToken, loadToken,
  getToken: () => TOKEN,
  startBotPublic: startBot,
  getCurrentFormat, loadFormat, saveFormat,
  getCurrentMaxRattrapage, loadMaxRattrapage, saveMaxRattrapage,
  buildTgMessage, buildPredictionMsg, buildResultMsg,
  sendToGlobalChannels,
  sendToGlobalChannelsAndStore,    // alias → sendToStrategyChannels
  sendToStrategyChannels,
  editGlobalChannelMessages,       // alias → editStoredMessages
  editStoredMessages,
  sendCustomAndStore,
  sendPredictionToTelegram,
  sendPredictionToTargets,
  cancelStrategyMessages,
  SUIT_EMOJI, SUIT_NAME,
};
