const TelegramBot = require('node-telegram-bot-api');
const fetch       = require('node-fetch');
const db          = require('./db');

let TOKEN         = process.env.BOT_TOKEN || null;
let currentFormat = 1;
let maxRattrapage = 2;

// ── Relay hooks : fonctions appelées sur chaque channel_post/message ──────────
const _relayHandlers = new Set();
function registerRelayHandler(fn) { _relayHandlers.add(fn); }
function unregisterRelayHandler(fn) { _relayHandlers.delete(fn); }
function getMainToken() { return TOKEN; }

// ── Réactions automatiques multi-stratégies ───────────────────────────────────
// Chaque stratégie/mode reçoit un emoji unique basé sur son nom.
// Les réactions de plusieurs stratégies sur le même message sont fusionnées
// en un seul appel après 2 s (fenêtre de debounce).
// ── Liste STRICTEMENT valide des réactions Telegram (Bot API 7+) ─────────────
// Seuls ces emojis sont acceptés par setMessageReaction — tout autre est rejeté.
// Source : https://core.telegram.org/bots/api#reactiontypeemoji

// Emoji unique par mode (persona fixe — uniquement des emojis Telegram valides)
const _MODE_EMOJIS_WIN = {
  manquants:           '🤩',
  apparents:           '🥰',
  absence_apparition:  '🐳',
  absence_confirmee:   '🦄',
  apparition_absence:  '😍',
  taux_miroir:         '⚡',
  compteur_adverse:    '🏆',
  absence_victoire:    '🎉',
  distribution:        '🤣',
  carte_3_vers_2:      '💯',
  carte_2_vers_3:      '🌚',
  abs_3_vers_2:        '🤯',
  abs_3_vers_3:        '😱',
  compteur_parite:     '🙏',
  pair_impair:         '👌',
  carte_2v3:           '🔥',
  '2k-3k':             '❤️‍🔥',
  compteurs_absences:  '🌭',
  carte_valeur:        '🍌',
  comptages_ecart:     '🍓',
  first_card_plus6:    '🍾',
  costume_manquant:    '🕊️',
  gestion_banque:      '💋',
  lecture_passee:      '😇',
  intelligent_cartes:  '👻',
  annonce_sequence:    '🎃',
  surveillance_perte:  '👀',
  multi_strategy:      '🤝',
  union_enseignes:     '🤗',
  intersection:        '🫡',
  proche:              '🆒',
};
const _MODE_EMOJIS_LOSS = {
  manquants:           '😢',
  apparents:           '💔',
  absence_apparition:  '😭',
  absence_confirmee:   '😴',
  apparition_absence:  '😨',
  taux_miroir:         '🤬',
  compteur_adverse:    '😱',
  absence_victoire:    '🤮',
  distribution:        '🥱',
  carte_3_vers_2:      '🥴',
  carte_2_vers_3:      '🤡',
  abs_3_vers_2:        '😐',
  abs_3_vers_3:        '🤨',
  compteur_parite:     '🙈',
  pair_impair:         '😈',
  carte_2v3:           '👎',
  '2k-3k':             '😮',
  compteurs_absences:  '🤔',
  carte_valeur:        '💩',
  comptages_ecart:     '😁',
  first_card_plus6:    '🙉',
  costume_manquant:    '🙊',
  gestion_banque:      '🤓',
  lecture_passee:      '👾',
  intelligent_cartes:  '😎',
  annonce_sequence:    '🗿',
  surveillance_perte:  '💅',
  multi_strategy:      '🤪',
  union_enseignes:     '💊',
  intersection:        '😘',
  proche:              '😡',
};

// Pool pour les stratégies — UNIQUEMENT emojis Telegram valides
const _WIN_EMOJIS  = ['👍','👏','😁','🥰','🤩','🎉','🏆','🔥','💯','⚡','🌚','🌭','🍌','🍓','🍾','😍','🐳','🤣'];
const _LOSS_EMOJIS = ['👎','😢','💔','😭','🤬','😱','🥴','🤡','😴','😨'];
const _reactAccum  = new Map(); // key → Set<emoji>
const _reactTimers = new Map(); // key → timer

function _modeEmoji(mode, status) {
  if (!mode) return null;
  return status === 'gagne'
    ? (_MODE_EMOJIS_WIN[mode]  || null)
    : (_MODE_EMOJIS_LOSS[mode] || null);
}

function _strategyEmoji(strategyName, status) {
  const pool = status === 'gagne' ? _WIN_EMOJIS : _LOSS_EMOJIS;
  let h = 0;
  for (let i = 0; i < strategyName.length; i++) h = (h * 31 + strategyName.charCodeAt(i)) >>> 0;
  return pool[h % pool.length];
}

async function _doReact(token, chatId, messageId, emojis) {
  const res = await fetch(`https://api.telegram.org/bot${token}/setMessageReaction`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      chat_id: chatId,
      message_id: messageId,
      reactions: emojis.map(e => ({ type: 'emoji', emoji: e })),
      is_big: emojis.length >= 3,
    }),
  });
  const body = await res.json().catch(() => ({}));
  return { ok: res.ok, body };
}

function _scheduleReaction(token, chatId, messageId, emoji, fallbackEmoji) {
  if (!emoji) return;
  const key = `${token}:${chatId}:${messageId}`;
  if (!_reactAccum.has(key)) _reactAccum.set(key, { emojis: new Set(), fallback: fallbackEmoji || '👍' });
  const entry = _reactAccum.get(key);
  entry.emojis.add(emoji);
  if (fallbackEmoji) entry.fallback = fallbackEmoji;
  if (_reactTimers.has(key)) clearTimeout(_reactTimers.get(key));
  _reactTimers.set(key, setTimeout(async () => {
    _reactTimers.delete(key);
    const acc = _reactAccum.get(key);
    _reactAccum.delete(key);
    if (!acc) return;
    const emojis   = [...acc.emojis];
    const fallback = acc.fallback;
    if (!emojis.length) return;
    try {
      const { ok, body } = await _doReact(token, chatId, messageId, emojis);
      if (ok) {
        console.log(`[TG React] ✅ ${chatId}/${messageId} [${emojis.join('')}]`);
      } else {
        const desc = body?.description || '';
        console.warn(`[TG React] ⚠️  ${chatId}/${messageId} [${emojis.join('')}]: ${desc} — retry avec ${fallback}`);
        // Retry avec réaction universelle (👍 ou 👎)
        const { ok: ok2, body: b2 } = await _doReact(token, chatId, messageId, [fallback]);
        if (ok2) {
          console.log(`[TG React] ✅ fallback ${chatId}/${messageId} [${fallback}]`);
        } else {
          console.warn(`[TG React] ❌ fallback échoué ${chatId}/${messageId}: ${b2?.description || '?'}`);
        }
      }
    } catch (e) {
      console.warn(`[TG React] Exception: ${e.message}`);
    }
  }, 2000));
}

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
  maxRattrapage = Math.max(0, parseInt(n) || 2);
  await db.setSetting('max_rattrapage', String(maxRattrapage));
}
function getCurrentMaxRattrapage() { return maxRattrapage; }

// ── Bot & channels ─────────────────────────────────────────────────

let bot     = null;
let botInfo = null;

const channelStore     = new Map();
const pendingAleatoire = new Map(); // userId → { stratId, stratName, hand, step }
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
    polling: { allowedUpdates: ['channel_post', 'message', 'callback_query'], interval: 3000, params: { timeout: 10 } },
  });

  bot.getMe().then(info => {
    botInfo = info;
    console.log(`🤖 Bot Telegram connecté : @${info.username}`);
  }).catch(err => console.error('Bot getMe error:', err.message));

  function handleIncoming(msg) {
    const chatType = msg.chat.type;
    const text     = msg.text || msg.caption || '(media)';
    // Appel des handlers de relay (avant tout filtre)
    if (_relayHandlers.size > 0) {
      for (const fn of _relayHandlers) {
        try { fn(msg); } catch {}
      }
    }
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

  // ── Stratégie Aléatoire : machine d'état par utilisateur ──────────
  // pendingAleatoire[userId] = { stratId, stratName, hand, targets, step: 'hand'|'number' }
  const SUITS_JOUEUR   = ['♥', '♣', '♦', '♠']; // ❤️♣️♦️♠️
  const SUITS_BANQUIER = ['♣', '♥', '♠', '♦']; // ♣️❤️♠️♦️
  const HAND_LABEL     = { joueur: '❤️ Joueur', banquier: '♣️ Banquier' };

  function suitForNumber(num, hand) {
    const arr = hand === 'banquier' ? SUITS_BANQUIER : SUITS_JOUEUR;
    return arr[(num - 1) % 4];
  }

  // Callback : sélection Joueur / Banquier
  bot.on('callback_query', async (query) => {
    const data   = query.data || '';
    const userId = String(query.from.id);
    const chatId = String(query.message?.chat?.id || query.from.id);
    if (!data.startsWith('aleat_hand:')) return;
    try { await bot.answerCallbackQuery(query.id); } catch {}

    const [, stratId, hand] = data.split(':');
    const pending = pendingAleatoire.get(userId);
    if (!pending || String(pending.stratId) !== stratId) return;

    pending.hand = hand;
    pending.step = 'number';
    pendingAleatoire.set(userId, pending);

    const handLabel = HAND_LABEL[hand] || hand;
    try {
      await bot.sendMessage(chatId,
        `${handLabel} sélectionné.\n\nEntrez le <b>numéro à prédire</b> (1–1440) :`,
        { parse_mode: 'HTML' }
      );
    } catch (e) { console.error('[Aléatoire] sendMessage number prompt:', e.message); }
  });

  // Message : saisie du numéro
  bot.on('message', async (msg) => {
    const userId  = String(msg.from?.id || '');
    const chatId  = String(msg.chat?.id || '');
    const text    = (msg.text || '').trim();
    if (!userId) return;

    // Commande /predire [stratId]
    if (text.startsWith('/predire')) {
      const parts   = text.split(/\s+/);
      const stratId = parts[1] ? parseInt(parts[1]) : null;
      let strats;
      try { strats = await db.getStrategies(); } catch { return; }
      const aleatStrats = strats.filter(s => s.mode === 'aleatoire' && s.enabled !== false && (stratId === null || s.id === stratId));
      if (aleatStrats.length === 0) {
        try { await bot.sendMessage(chatId, '❌ Aucune stratégie aléatoire active trouvée.'); } catch {}
        return;
      }
      const s = aleatStrats[0];
      pendingAleatoire.set(userId, { stratId: s.id, stratName: s.name, hand: null, step: 'hand' });
      try {
        await bot.sendMessage(chatId,
          `🎲 <b>${s.name}</b>\n\nChoisissez le camp à prédire :`,
          {
            parse_mode: 'HTML',
            reply_markup: {
              inline_keyboard: [[
                { text: '❤️ Joueur',   callback_data: `aleat_hand:${s.id}:joueur` },
                { text: '♣️ Banquier', callback_data: `aleat_hand:${s.id}:banquier` },
              ]]
            }
          }
        );
      } catch (e) { console.error('[Aléatoire] sendMessage hand prompt:', e.message); }
      return;
    }

    // ── Commandes admin distantes ──────────────────────────────────────
    // Ces commandes ne fonctionnent que si l'expéditeur est l'admin bot configuré.
    if (text.startsWith('/setformat') || text.startsWith('/setmaxr') || text.startsWith('/botcmd')) {
      let adminId = '';
      try { adminId = (await db.getSetting('bot_admin_tg_id') || '').trim(); } catch {}
      if (!adminId || userId !== adminId) {
        try { await bot.sendMessage(chatId, '⛔ Accès refusé. Configurez votre ID Telegram admin dans le panneau d\'administration.'); } catch {}
        return;
      }

      // /setformat [S<id>] <N>  — change le format global ou par stratégie
      if (text.startsWith('/setformat')) {
        const parts = text.split(/\s+/).slice(1);
        // Cas: /setformat S5 3  (stratégie S5, format 3)
        if (parts.length >= 2 && /^[sS]\d+$/.test(parts[0])) {
          const stratId = parseInt(parts[0].slice(1));
          const fmtId   = Math.max(1, Math.min(11, parseInt(parts[1]) || 1));
          try {
            const strats = await db.getStrategies();
            const idx = strats.findIndex(s => s.id === stratId);
            if (idx < 0) {
              await bot.sendMessage(chatId, `❌ Stratégie S${stratId} introuvable.`);
            } else {
              strats[idx].tg_format = fmtId;
              await db.setSetting('custom_strategies', JSON.stringify(strats));
              require('./engine').reloadCustomStrategies(strats);
              await bot.sendMessage(chatId, `✅ Format de S${stratId} (${strats[idx].name}) → <b>${fmtId}</b>`, { parse_mode: 'HTML' });
            }
          } catch (e) { try { await bot.sendMessage(chatId, `❌ Erreur: ${e.message}`); } catch {} }
        } else if (parts.length >= 1 && /^\d+$/.test(parts[0])) {
          // Cas: /setformat 3  (format global)
          const fmtId = Math.max(1, Math.min(11, parseInt(parts[0]) || 1));
          await saveFormat(fmtId);
          try { await bot.sendMessage(chatId, `✅ Format global → <b>${fmtId}</b>`, { parse_mode: 'HTML' }); } catch {}
        } else {
          try { await bot.sendMessage(chatId, `ℹ️ Usage:\n/setformat <N> — format global\n/setformat S<id> <N> — format par stratégie`); } catch {}
        }
        return;
      }

      // /setmaxr <N>  — change le max_rattrapage global
      if (text.startsWith('/setmaxr')) {
        const parts = text.split(/\s+/).slice(1);
        if (parts.length < 1 || isNaN(parseInt(parts[0]))) {
          try { await bot.sendMessage(chatId, `ℹ️ Usage: /setmaxr <N>`); } catch {}
          return;
        }
        const n = Math.max(0, parseInt(parts[0]));
        await saveMaxRattrapage(n);
        try { await bot.sendMessage(chatId, `✅ Max rattrapage global → <b>${n}</b>`, { parse_mode: 'HTML' }); } catch {}
        return;
      }

      // /botcmd {"type":"format","data":{"format_id":3}}
      // /botcmd {"type":"maxr","data":{"value":5}}
      if (text.startsWith('/botcmd')) {
        const jsonStr = text.slice('/botcmd'.length).trim();
        try {
          const body = JSON.parse(jsonStr);
          const blocks = Array.isArray(body.blocks) ? body.blocks : [body];
          const msgs = [];
          for (const b of blocks) {
            if (b.type === 'format') {
              const fmtId = Math.max(1, Math.min(75, parseInt(b.data?.format_id) || 1));
              await saveFormat(fmtId);
              msgs.push(`✅ format global → ${fmtId}`);
            } else if (b.type === 'maxr' || b.type === 'max_rattrapage') {
              const n = Math.max(0, parseInt(b.data?.value ?? b.data?.max_rattrapage) || 0);
              await saveMaxRattrapage(n);
              msgs.push(`✅ maxR global → ${n}`);
            } else {
              msgs.push(`⚠️ Type "${b.type}" non supporté via bot — utilisez le panneau admin.`);
            }
          }
          try { await bot.sendMessage(chatId, msgs.join('\n')); } catch {}
        } catch (e) {
          try { await bot.sendMessage(chatId, `❌ JSON invalide: ${e.message}`); } catch {}
        }
        return;
      }
    }

    // Saisie du numéro si étape 'number'
    const pending = pendingAleatoire.get(userId);
    if (!pending || pending.step !== 'number') return;
    const num = parseInt(text, 10);
    if (isNaN(num) || num < 1 || num > 1440) {
      try { await bot.sendMessage(chatId, '⚠️ Numéro invalide. Entrez un nombre entre 1 et 1440.'); } catch {}
      return;
    }

    pendingAleatoire.delete(userId);

    // Vérifier si le numéro est supérieur au tour en cours
    let currentGameNum = 0;
    try {
      const r = await db.pool.query('SELECT COALESCE(MAX(game_number),0) AS mx FROM predictions WHERE status IN (\'gagne\',\'perdu\')');
      currentGameNum = parseInt(r.rows[0].mx) || 0;
    } catch {}

    if (num <= currentGameNum) {
      try {
        await bot.sendMessage(chatId,
          `❌ Le numéro <b>#${num}</b> est déjà passé (tour actuel : #${currentGameNum}).\nEntrez un numéro supérieur à <b>${currentGameNum}</b>.`,
          { parse_mode: 'HTML' }
        );
      } catch {}
      return;
    }

    const suit      = suitForNumber(num, pending.hand);
    const handLabel = HAND_LABEL[pending.hand] || pending.hand;
    const suitEmoji = SUIT_EMOJI_MAP[suit] || suit;

    // Envoyer la prédiction dans les canaux de la stratégie
    try {
      const { text: tgText, parse_mode } = buildTgMessage(currentFormat, {
        gameNumber: num, suit, strategy: pending.stratId, maxR: maxRattrapage, status: null,
        hand: pending.hand,
      });
      const routes  = await db.getStrategyRoutes(pending.stratId);
      const targets = routes.length > 0
        ? routes.map(r => ({ tgId: r.tg_id }))
        : getChannels().map(c => ({ tgId: c.tgId }));
      for (const ch of targets) {
        try {
          const msgId = await _sendOneMessage(TOKEN, ch.tgId, tgText, parse_mode);
          if (msgId) await db.saveTgMsgId(pending.stratId, num, suit, ch.tgId, msgId, null).catch(() => {});
        } catch (e) { console.error('[Aléatoire] sendToChannel:', e.message); }
      }
      try {
        await bot.sendMessage(chatId,
          `✅ Prédiction envoyée !\n${handLabel} — Tour <b>#${num}</b> → ${suitEmoji}`,
          { parse_mode: 'HTML' }
        );
      } catch {}
    } catch (e) { console.error('[Aléatoire] build/send prediction:', e.message); }
  });
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
  // Sync vers la base Render
  try { require('./render-sync').syncTelegramChannel(row).catch(() => {}); } catch {}
  return row;
}

async function removeChannel(dbId) {
  const entry = [...channelStore.entries()].find(([, ch]) => ch.dbId === dbId);
  const channelId = entry ? entry[0] : null;
  if (entry) channelStore.delete(entry[0]);
  await db.deleteTelegramConfig(dbId);
  // Sync suppression vers la base Render
  if (channelId) {
    try { require('./render-sync').syncDeleteTelegramChannel(channelId).catch(() => {}); } catch {}
  }
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

const SUIT_EMOJI_MAP = { '♠': '♠️', '♥': '❤️', '♦': '♦️', '♣': '♣️', 'distrib': '🌀', 'deux': '2️⃣', 'trois': '3️⃣', 'WIN_B': '🏦', 'WIN_P': '👤', 'TIE': '🤝', 'TWO_THREE': '⚡', 'DEUX_TROIS': '2️⃣3️⃣', 'TROIS_DEUX': '3️⃣2️⃣', 'TROIS_TROIS': '3️⃣3️⃣', 'pair': '🟢', 'impair': '🔴' };
const SUIT_NAME_FR   = { '♠': 'Pique', '♥': 'Cœur', '♦': 'Carreau', '♣': 'Trèfle', 'distrib': 'Distribution', 'deux': '2 Cartes', 'trois': '3 Cartes', 'WIN_B': 'Victoire Banquier', 'WIN_P': 'Victoire Joueur', 'TIE': 'Match Nul', 'TWO_THREE': '2+3 Cartes', 'DEUX_TROIS': 'J:2 B:3', 'TROIS_DEUX': 'J:3 B:2', 'TROIS_TROIS': 'J:3 B:3', 'pair': 'Pair', 'impair': 'Impair' };
const SUPERSCRIPT    = ['⁰','¹','²','³','⁴','⁵','⁶','⁷','⁸','⁹','¹⁰','¹¹','¹²','¹³','¹⁴','¹⁵','¹⁶','¹⁷','¹⁸','¹⁹','²⁰'];
const RATR_EMOJI     = ['0️⃣','1️⃣','2️⃣','3️⃣','4️⃣','5️⃣','6️⃣','7️⃣','8️⃣','9️⃣','10','11','12','13','14','15','16','17','18','19','20'];

// Compat exports
const SUIT_EMOJI = SUIT_EMOJI_MAP;
const SUIT_NAME  = SUIT_NAME_FR;

function getSuitEmoji(suit) { return SUIT_EMOJI_MAP[suit] || suit; }
function getSuitName(suit)  { return SUIT_NAME_FR[suit]  || suit; }

/**
 * renderCustomTemplate — rend un template personnalisé défini dans le fichier de stratégie.
 * Variables disponibles : {game} {emoji} {suit} {status} {maxR} {hand} {rattrapage} {strategy}
 * Exemple de template : "🎯 #{game} | {emoji} {suit} | {status}"
 */
function renderCustomTemplate(template, { gameNumber, suit, hand, maxR, status, rattrapage, strategy }) {
  const emoji = getSuitEmoji(suit);
  const name  = getSuitName(suit);
  let statusStr;
  if (status === null)         statusStr = '⌛';
  else if (status === 'gagne') statusStr = `✅ ${RATR_EMOJI[rattrapage] ?? rattrapage}`;
  else                         statusStr = '❌';
  return template
    .replace(/\{game\}/g,      String(gameNumber  ?? ''))
    .replace(/\{emoji\}/g,     emoji)
    .replace(/\{suit\}/g,      name)
    .replace(/\{status\}/g,    statusStr)
    .replace(/\{maxR\}/g,      String(maxR        ?? ''))
    .replace(/\{hand\}/g,      String(hand        ?? 'joueur'))
    .replace(/\{rattrapage\}/g,String(rattrapage  ?? 0))
    .replace(/\{strategy\}/g,  String(strategy    ?? ''));
}

/**
 * buildTgMessage — message unifié pour prédiction ET résultat.
 * status = null  → en cours (⌛)
 * status = 'gagne'  → gagné (✅ + emoji rattrapage)
 * status = 'perdu'  → perdu (❌)
 */
function formatCardsToEmojis(cards) {
  if (!Array.isArray(cards) || cards.length === 0) return '—';
  return cards.map(c => {
    const raw = (c && c.S) ? String(c.S).replace(/\uFE0F/g, '').trim() : '';
    return SUIT_EMOJI_MAP[raw] || raw || '?';
  }).join(' ');
}

function buildTgMessage(formatId, {
  gameNumber, suit, strategy,
  maxR = 2,
  status = null,
  rattrapage = 0,
  hand = null,
  playerCards = null,
  bankerCards = null,
}, tg_template = null) {
  // ── Template personnalisé (défini dans le fichier de stratégie ou la DB) ──
  if (tg_template) {
    return {
      text: renderCustomTemplate(tg_template, { gameNumber, suit, hand, maxR, status, rattrapage, strategy }),
      parse_mode: null,
    };
  }

  // La stratégie Distribution utilise toujours le format 11 (conçu pour elle)
  if (suit === 'distrib') formatId = 11;
  // deux/trois → format 76 par défaut | pair/impair → format 12 par défaut
  if ((suit === 'deux' || suit === 'trois') && (!formatId || parseInt(formatId) < 12)) formatId = 76;
  if ((suit === 'pair' || suit === 'impair') && (!formatId || parseInt(formatId) < 12)) formatId = 12;

  const emoji   = getSuitEmoji(suit);
  const name    = getSuitName(suit);
  const sup     = SUPERSCRIPT[maxR] ?? String(maxR);

  let statusLine;
  if (status === null)         statusLine = '⌛';
  else if (status === 'gagne') statusLine = `✅ ${RATR_EMOJI[rattrapage] ?? rattrapage}`;
  else                         statusLine = '❌';

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
          `#N${gameNumber} :${emoji}\n` +
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
          `🎰 PRÉDICTION #N${gameNumber}\n` +
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
          `🎰 PRÉDICTION #N${gameNumber}\n` +
          `🎯 Couleur: ${emoji} ${name}\n\n` +
          `🔍 Vérification jeu #N${gameNumber}\n` +
          `${bar}\n` +
          `${status === null ? '⏳ Analyse...' : (status === 'gagne' ? `✅ ${RATR_EMOJI[rattrapage] ?? rattrapage}` : '❌')}`,
        parse_mode: null,
      };
    }

    case 6:
      return {
        text:
          `🏆 *PRÉDICTION #N${gameNumber}*\n\n` +
          `🎯 Couleur: ${emoji} ${name}\n` +
          (status === null
            ? `⏳ Statut: En cours`
            : status === 'gagne'
              ? `✅ Statut: ${statusLine}`
              : `Statut: ❌`),
        parse_mode: 'Markdown',
      };

    case 7:
      return {
        text:
          `<b>#N${gameNumber}</b> — <b>Le</b> <b><i>joueur</i></b> <b><u>recevra</u></b> <b>une</b> <b><i>carte</i></b> ${emoji} <b>${name}</b>\n\n` +
          (status === null
            ? `⏳ <i>En attente du résultat...</i>`
            : status === 'gagne'
              ? `✅ <b>GAGNÉ</b> ${RATR_EMOJI[rattrapage] ?? rattrapage}`
              : `❌`),
        parse_mode: 'HTML',
      };

    case 8: {
      const isBank      = hand === 'banquier';
      const statusLine8 = status === null    ? '⌛'
                        : status === 'gagne' ? `✅${RATR_EMOJI[rattrapage] ?? rattrapage}GAGNÉ`
                        :                      '❌';
      if (isBank) {
        return {
          text:
            `🎮 banquier #N${gameNumber}\n` +
            `⚜️ Couleur de la carte:${emoji}\n` +
            `🎰 Poursuite  🔰+${maxR} jeux\n` +
            `🗯️ Résultats : ${statusLine8}`,
          parse_mode: null,
        };
      } else {
        return {
          text:
            `🤖 joueur #N${gameNumber}\n` +
            `🔰Couleur de la carte :${emoji}\n` +
            `🔰 Rattrapages : ${maxR}(🔰+${maxR})\n` +
            `🧨 Résultats : ${statusLine8}`,
          parse_mode: null,
        };
      }
    }

    case 9: {
      const sl9 = status === null    ? '⌛'
                : status === 'gagne' ? `✅${RATR_EMOJI[rattrapage] ?? rattrapage}GAGNÉ`
                :                      '❌';
      return {
        text:
          `🤖 joueur #N${gameNumber}\n` +
          `🔰Couleur de la carte :${emoji}\n` +
          `🔰 Rattrapages : ${maxR}(🔰+${maxR})\n` +
          `🧨 Résultats : ${sl9}`,
        parse_mode: null,
      };
    }

    case 10: {
      const sl10 = status === null    ? '⌛'
                 : status === 'gagne' ? `✅${RATR_EMOJI[rattrapage] ?? rattrapage}GAGNÉ`
                 :                      '❌';
      return {
        text:
          `🎮 banquier #N${gameNumber}\n` +
          `⚜️ Couleur de la carte:${emoji}\n` +
          `🎰 Poursuite  🔰+${maxR} jeux\n` +
          `🗯️ Résultats : ${sl10}`,
        parse_mode: null,
      };
    }

    case 11: {
      const foundGame = gameNumber + rattrapage;
      const pEmojis   = formatCardsToEmojis(playerCards);
      const bEmojis   = formatCardsToEmojis(bankerCards);
      if (status === null) {
        return {
          text:
            `🃏 LE JEU VA SE TERMINER SUR LA DISTRIBUTION\n` +
            `📌 Jeu #N${gameNumber}\n` +
            `━━━━━━━━━━━━━━━━━━\n` +
            `⌛ Vérification en cours...`,
          parse_mode: null,
        };
      } else if (status === 'gagne') {
        // Phase 1 : affiche le jeu trouvé + cartes (remplacé après 10s par buildDistribFinalMsg)
        return {
          text:
            `🃏 LE JEU VA SE TERMINER SUR LA DISTRIBUTION\n` +
            `📌 Jeu #N${gameNumber}\n` +
            `━━━━━━━━━━━━━━━━━━\n` +
            `✅ Jeu #N${foundGame} trouvé\n` +
            `🃏 Joueur  : ${pEmojis}\n` +
            `🎴 Banquier : ${bEmojis}`,
          parse_mode: null,
        };
      } else {
        return {
          text:
            `🃏 LE JEU VA SE TERMINER SUR LA DISTRIBUTION\n` +
            `📌 Jeu #N${gameNumber}\n` +
            `━━━━━━━━━━━━━━━━━━\n` +
            `✅ Distribution : OUI\n` +
            `❌ Non distribué`,
          parse_mode: null,
        };
      }
    }

    case 12: {
      const handLabel12 = hand === 'banquier' ? 'Banquier' : 'Joueur';
      // Mode Pair / Impair
      if (suit === 'pair' || suit === 'impair') {
        const parity      = suit === 'pair' ? 'PAIR' : 'IMPAIR';
        const parityEmoji = suit === 'pair' ? '🟢' : '🔴';
        const winMsgP  = `✅ ${RATR_EMOJI[rattrapage] ?? rattrapage} ${parity} confirmé 🎯`;
        const lossMsgP = `❌ Pas de ${suit} sur ${maxR} jeux`;
        return {
          text:
            `${parityEmoji} PRÉDICTION — ${parity} ${handLabel12.toUpperCase()}\n` +
            `📌 Jeu #N${gameNumber}\n` +
            `━━━━━━━━━━━━━━━\n` +
            `🎯 Total ${handLabel12} : ${parity}\n` +
            (status === null
              ? `⌛ En cours de vérification...`
              : status === 'gagne' ? winMsgP : lossMsgP),
          parse_mode: null,
        };
      }
      // Mode 2 vs 3 cartes
      const targetCards = suit === 'deux' ? 2 : 3;
      const cardEmoji   = suit === 'deux' ? '2️⃣' : '3️⃣';
      const winMsg   = suit === 'deux'
        ? `✅ ${RATR_EMOJI[rattrapage] ?? rattrapage} 2 cartes confirmées 🎯`
        : `✅ ${RATR_EMOJI[rattrapage] ?? rattrapage} 3 cartes confirmées 🎯`;
      const lossMsg  = suit === 'deux'
        ? `❌ Pas de 2 cartes sur ${maxR} jeux`
        : `❌ Pas de 3 cartes sur ${maxR} jeux`;
      return {
        text:
          `${cardEmoji} PRÉDICTION — ${targetCards} CARTES ${handLabel12.toUpperCase()}\n` +
          `📌 Jeu #N${gameNumber}\n` +
          `━━━━━━━━━━━━━━━\n` +
          `🎯 ${handLabel12} aura ${targetCards} cartes\n` +
          (status === null
            ? `⌛ En cours de vérification...`
            : status === 'gagne' ? winMsg : lossMsg),
        parse_mode: null,
      };
    }

    // ── Format 13 : Victoire Pro (Banquier / Joueur) ─────────────────────
    case 13: {
      const sl13 = status === null    ? '⌛ En cours de vérification...'
                 : status === 'gagne' ? `✅ ${RATR_EMOJI[rattrapage] ?? rattrapage} GAGNÉ`
                 :                      `❌ Perdu après ${maxR} tentatives`;
      const winLabel13 = suit === 'WIN_B' ? '🏦 BANQUIER'
                       : suit === 'WIN_P' ? '👤 JOUEUR'
                       : `${emoji} ${name.toUpperCase()}`;
      return {
        text:
          `🏆 PRÉDICTION VICTOIRE\n` +
          `📌 Jeu #N${gameNumber}\n` +
          `━━━━━━━━━━━━━━━━━━\n` +
          `🎯 ${winLabel13} va gagner\n` +
          `🔰 Rattrapage : +${maxR}\n` +
          `${sl13}`,
        parse_mode: null,
      };
    }

    // ── Format 14 : Victoire Compact ──────────────────────────────────────
    case 14: {
      const sl14 = status === null    ? '⌛'
                 : status === 'gagne' ? `✅ ${RATR_EMOJI[rattrapage] ?? rattrapage}`
                 :                      '❌';
      const winLabel14 = suit === 'WIN_B' ? '🏦 Banquier'
                       : suit === 'WIN_P' ? '👤 Joueur'
                       : `${emoji} ${name}`;
      return {
        text: `${winLabel14} gagne — Jeu #N${gameNumber}   +${maxR}\n${sl14}`,
        parse_mode: null,
      };
    }

    // ── Format 15 : Match Nul Pro ─────────────────────────────────────────
    case 15: {
      const sl15 = status === null    ? '⌛ En cours de vérification...'
                 : status === 'gagne' ? `✅ ${RATR_EMOJI[rattrapage] ?? rattrapage} ÉGALITÉ CONFIRMÉE`
                 :                      `❌ Pas d'égalité sur ${maxR} jeux`;
      const tieLabel15 = suit === 'TIE' ? '⚖️ Égalité — aucun gagnant' : `🎯 ${emoji} ${name}`;
      return {
        text:
          `🤝 PRÉDICTION MATCH NUL\n` +
          `📌 Jeu #N${gameNumber}\n` +
          `━━━━━━━━━━━━━━━━━━\n` +
          `${tieLabel15}\n` +
          `🔰 Rattrapage : +${maxR}\n` +
          `${sl15}`,
        parse_mode: null,
      };
    }

    // ── Format 16 : Match Nul Compact ─────────────────────────────────────
    case 16: {
      const sl16 = status === null    ? '⌛'
                 : status === 'gagne' ? `✅ ${RATR_EMOJI[rattrapage] ?? rattrapage}`
                 :                      '❌';
      const tieLabel16 = suit === 'TIE' ? '🤝 Match Nul' : `${emoji} ${name}`;
      return {
        text: `${tieLabel16} · #N${gameNumber} · +${maxR}\n${sl16}`,
        parse_mode: null,
      };
    }

    // ── Format 17 : 2+3 Cartes Pro ────────────────────────────────────────
    case 17: {
      const sl17 = status === null    ? '⌛ En cours de vérification...'
                 : status === 'gagne' ? `✅ ${RATR_EMOJI[rattrapage] ?? rattrapage} JEU MIXTE CONFIRMÉ`
                 :                      `❌ Pas de jeu mixte sur ${maxR} jeux`;
      const mixLabel17 = suit === 'TWO_THREE'
        ? '🃏 Un camp : 2 cartes — Autre : 3 cartes'
        : `🎯 ${emoji} ${name}`;
      return {
        text:
          `⚡ PRÉDICTION 2+3 CARTES\n` +
          `📌 Jeu #N${gameNumber}\n` +
          `━━━━━━━━━━━━━━━━━━\n` +
          `${mixLabel17}\n` +
          `🔰 Rattrapage : +${maxR}\n` +
          `${sl17}`,
        parse_mode: null,
      };
    }

    // ── Format 18 : Cartes 2/3 Style B ────────────────────────────────────
    case 18: {
      const sl18 = status === null    ? '⌛ Vérification...'
                 : status === 'gagne' ? `✅ ${RATR_EMOJI[rattrapage] ?? rattrapage} Confirmé`
                 :                      '❌ Non confirmé';
      let cardLabel18;
      if (suit === 'deux')       cardLabel18 = '2️⃣ 2 CARTES (Naturel)';
      else if (suit === 'trois') cardLabel18 = '3️⃣ 3 CARTES';
      else if (suit === 'TWO_THREE') cardLabel18 = '⚡ 2+3 CARTES MIXTE';
      else                       cardLabel18 = `${emoji} ${name.toUpperCase()}`;
      const handLabel18 = hand === 'banquier' ? '🏦 BANQUIER' : hand === 'joueur' ? '👤 JOUEUR' : '';
      return {
        text:
          `${cardLabel18}${handLabel18 ? ` — ${handLabel18}` : ''}\n` +
          `〖 Jeu #N${gameNumber} 〗〖 +${maxR} 〗\n` +
          `${sl18}`,
        parse_mode: null,
      };
    }

    // ── Format 19 : VIP Casino ────────────────────────────────────────────
    case 19:
      return {
        text:
          `╔══════════════════╗\n` +
          `🎯 JEU #N${gameNumber} — ${emoji} ${name}\n` +
          `🔰 Rattrapage max : +${maxR}\n` +
          `╚══════════════════╝\n` +
          `${statusLine}`,
        parse_mode: null,
      };

    // ── Format 20 : Flash Signal ──────────────────────────────────────────
    case 20:
      return {
        text: `⚡ #N${gameNumber} ${emoji} +${maxR} ${statusLine}`,
        parse_mode: null,
      };

    // ── Format 21 : Casino Royale ─────────────────────────────────────────
    case 21:
      return {
        text:
          `🃏 CASINO ROYALE — Jeu #N${gameNumber}\n` +
          `━━━━━━━━━━━━━━━━━━\n` +
          `🎯 Signe : ${emoji} ${name}\n` +
          `🏅 Dogon max : +${maxR}\n` +
          `🔮 Résultat : ${statusLine}`,
        parse_mode: null,
      };

    // ── Format 22 : Signal Pro (avec main) ───────────────────────────────
    case 22: {
      const handLabel22 = hand === 'banquier' ? 'BANQUIER' : 'JOUEUR';
      const handEmoji22 = hand === 'banquier' ? '🏦' : '👤';
      return {
        text:
          `🔔 SIGNAL BACCARA PRO\n` +
          `${handEmoji22} Main : ${handLabel22}\n` +
          `🎯 Signe : ${emoji} ${name}\n` +
          `📌 Jeu #N${gameNumber} · +${maxR}\n` +
          `➤ ${statusLine}`,
        parse_mode: null,
      };
    }

    // ── Format 23 : Alert Pro ─────────────────────────────────────────────
    case 23:
      return {
        text:
          `🚨 ALERTE PRÉDICTION\n` +
          `📍 Tour #N${gameNumber}\n` +
          `🃏 Costume : ${emoji} ${name}\n` +
          `🔁 Max dogon : +${maxR}\n` +
          `📊 ${statusLine}`,
        parse_mode: null,
      };

    // ── Format 24 : Minimaliste Stars ─────────────────────────────────────
    case 24:
      return {
        text:
          `★ #N${gameNumber} · ${emoji} ${name} · +${maxR}\n` +
          `${statusLine}`,
        parse_mode: null,
      };

    // ── Format 25 : Scoreboard Pro ────────────────────────────────────────
    case 25:
      return {
        text:
          `🏅 BACCARAT SCOREBOARD\n` +
          `┌─────────────────────┐\n` +
          `│ #N${gameNumber} │ ${emoji} ${name} │ +${maxR} │\n` +
          `└─────────────────────┘\n` +
          `${statusLine}`,
        parse_mode: null,
      };

    // ── Formats 26-35 : TROIS CARTES ─────────────────────────────────────────

    // ── Format 26 : Trio Pro ─────────────────────────────────────────────────
    case 26: {
      const h26 = hand === 'banquier' ? '🏦 BANQUIER' : '👤 JOUEUR';
      const ct26 = suit === 'trois' ? `3️⃣ 3 CARTES — ${h26}` : suit === 'deux' ? `2️⃣ 2 CARTES — ${h26}` : suit === 'WIN_B' ? '🏦 BANQUIER GAGNE' : suit === 'WIN_P' ? '👤 JOUEUR GAGNE' : `${emoji} ${name}`;
      const sl26 = status === null ? '⌛ Vérification...' : status === 'gagne' ? `✅ ${RATR_EMOJI[rattrapage] ?? rattrapage} CONFIRMÉ 🎯` : `❌ Non confirmé sur ${maxR} jeux`;
      return { text: `3️⃣ TRIO PRO BACCARAT\n━━━━━━━━━━━━━━━━\n📌 Jeu #N${gameNumber}\n🎯 ${ct26}\n🔰 Dogon : +${maxR}\n━━━━━━━━━━━━━━━━\n${sl26}`, parse_mode: null };
    }

    // ── Format 27 : Trio VIP ─────────────────────────────────────────────────
    case 27: {
      const h27 = hand === 'banquier' ? '🏦' : '👤';
      const ct27 = suit === 'trois' ? '3️⃣ 3 cartes' : suit === 'deux' ? '2️⃣ 2 cartes' : suit === 'WIN_B' ? '🏦 Banquier' : suit === 'WIN_P' ? '👤 Joueur' : `${emoji} ${name}`;
      const sl27 = status === null ? '⌛' : status === 'gagne' ? `✅ ${RATR_EMOJI[rattrapage] ?? rattrapage}` : '❌';
      return { text: `╔══════════════════╗\n3️⃣ TRIO VIP — Jeu #N${gameNumber}\n╚══════════════════╝\n${h27} ${ct27} · +${maxR}\n${sl27}`, parse_mode: null };
    }
    // ── Format 28 : Triple Force ─────────────────────────────────────────────
    case 28: {
      const h28 = hand === 'banquier' ? 'BANQUIER' : 'JOUEUR';
      const ct28 = suit === 'trois' ? `3 CARTES ${h28}` : suit === 'deux' ? `2 CARTES ${h28}` : suit === 'WIN_B' ? 'BANQUIER GAGNE' : suit === 'WIN_P' ? 'JOUEUR GAGNE' : name.toUpperCase();
      const sl28 = status === null ? '⌛ En cours...' : status === 'gagne' ? `✅ VICTOIRE (${RATR_EMOJI[rattrapage] ?? rattrapage})` : '❌ ÉCHEC';
      return { text: `⚡ TRIPLE FORCE ⚡\n🎮 #N${gameNumber} · ${ct28}\n🔰 MAX ${maxR} TENTATIVES\n${sl28}`, parse_mode: null };
    }
    // ── Format 29 : Trio Signal ──────────────────────────────────────────────
    case 29: {
      const ct29 = suit === 'trois' ? '3️⃣' : suit === 'deux' ? '2️⃣' : suit === 'WIN_B' ? '🏦' : suit === 'WIN_P' ? '👤' : emoji;
      const sl29 = status === null ? '⌛' : status === 'gagne' ? `✅${RATR_EMOJI[rattrapage] ?? rattrapage}` : '❌';
      return { text: `📡 TRIO SIGNAL #N${gameNumber}\n${ct29} × ${maxR} → ${sl29}`, parse_mode: null };
    }
    // ── Format 30 : Trio Hacker ──────────────────────────────────────────────
    case 30: {
      const h30 = hand === 'banquier' ? 'BANK' : 'PLAYER';
      const ct30 = suit === 'trois' ? '3CARDS' : suit === 'deux' ? '2CARDS' : suit === 'WIN_B' ? 'WIN_BANK' : suit === 'WIN_P' ? 'WIN_PLAYER' : name.toUpperCase().replace(/\s/g, '_');
      const sl30 = status === null ? 'PENDING...' : status === 'gagne' ? `OK_${RATR_EMOJI[rattrapage] ?? rattrapage}` : 'FAIL';
      return { text: `> BACC_ENGINE RUN\n> GAME=${gameNumber} TARGET=${ct30}\n> SIDE=${h30} RETRY=${maxR}\n> STATUS=${sl30}`, parse_mode: null };
    }
    // ── Format 31 : Trio Prestige ────────────────────────────────────────────
    case 31: {
      const h31 = hand === 'banquier' ? '🏦 Banquier' : '👤 Joueur';
      const ct31 = suit === 'trois' ? '3️⃣ Trois cartes' : suit === 'deux' ? '2️⃣ Deux cartes' : suit === 'WIN_B' ? '🏆 Banquier gagne' : suit === 'WIN_P' ? '🏆 Joueur gagne' : `${emoji} ${name}`;
      const sl31 = status === null ? '⌛ Analyse en cours...' : status === 'gagne' ? `✅ Confirmé (${RATR_EMOJI[rattrapage] ?? rattrapage})` : `❌ Raté (${maxR} essais)`;
      return { text: `🎩 BACCARAT PRESTIGE\n┌─────────────────────┐\n│ 🎮 Jeu #N${gameNumber}\n│ ${ct31}\n│ ${h31} · +${maxR}\n└─────────────────────┘\n${sl31}`, parse_mode: null };
    }
    // ── Format 32 : Trio Compact ─────────────────────────────────────────────
    case 32: {
      const ct32 = suit === 'trois' ? '3🃏' : suit === 'deux' ? '2🃏' : suit === 'WIN_B' ? '🏦W' : suit === 'WIN_P' ? '👤W' : emoji;
      const sl32 = status === null ? '⌛' : status === 'gagne' ? `✅${RATR_EMOJI[rattrapage] ?? rattrapage}` : '❌';
      return { text: `${ct32} #N${gameNumber} +${maxR} ${sl32}`, parse_mode: null };
    }
    // ── Format 33 : Trio Alert ───────────────────────────────────────────────
    case 33: {
      const h33 = hand === 'banquier' ? 'BANQUIER' : 'JOUEUR';
      const ct33 = suit === 'trois' ? `3 CARTES ${h33}` : suit === 'deux' ? `2 CARTES ${h33}` : suit === 'WIN_B' ? 'BANQUIER GAGNE' : suit === 'WIN_P' ? 'JOUEUR GAGNE' : name.toUpperCase();
      const sl33 = status === null ? '⏳ ATTENTE' : status === 'gagne' ? `🟢 RÉUSSI (${RATR_EMOJI[rattrapage] ?? rattrapage})` : '🔴 RATÉ';
      return { text: `🚨 ALERTE TRIO 🚨\n📍 JEU #N${gameNumber}\n⚠️ ${ct33}\n🔁 DOGON : +${maxR}\n${sl33}`, parse_mode: null };
    }
    // ── Format 34 : Trio Royal ───────────────────────────────────────────────
    case 34: {
      const h34 = hand === 'banquier' ? '🏦 Banquier' : '👤 Joueur';
      const ct34 = suit === 'trois' ? '3️⃣ Trois cartes' : suit === 'deux' ? '2️⃣ Deux cartes' : suit === 'WIN_B' ? '🏆 Victoire Banquier' : suit === 'WIN_P' ? '🏆 Victoire Joueur' : `${emoji} ${name}`;
      const sl34 = status === null ? '⌛ En attente...' : status === 'gagne' ? `👑 VICTOIRE ! (${RATR_EMOJI[rattrapage] ?? rattrapage})` : '💀 Défaite';
      return { text: `👑 TRIO ROYAL CASINO\n━━━━━━━━━━━━━━━\n🎮 #N${gameNumber} · ${h34}\n${ct34} · +${maxR}\n━━━━━━━━━━━━━━━\n${sl34}`, parse_mode: null };
    }
    // ── Format 35 : Trio Flash ───────────────────────────────────────────────
    case 35: {
      const ct35 = suit === 'trois' ? '3️⃣🔥' : suit === 'deux' ? '2️⃣🔥' : suit === 'WIN_B' ? '🏦🔥' : suit === 'WIN_P' ? '👤🔥' : `${emoji}🔥`;
      const sl35 = status === null ? '⌛' : status === 'gagne' ? `✅${RATR_EMOJI[rattrapage] ?? rattrapage}` : '❌';
      return { text: `⚡ FLASH TRIO ⚡\n${ct35} — #N${gameNumber} — +${maxR}\n${sl35}`, parse_mode: null };
    }

    // ── Formats 36-45 : DEUX CARTES ──────────────────────────────────────────

    // ── Format 36 : Duo Pro ──────────────────────────────────────────────────
    case 36: {
      const h36 = hand === 'banquier' ? '🏦 BANQUIER' : '👤 JOUEUR';
      const ct36 = suit === 'deux' ? `2️⃣ 2 CARTES — ${h36}` : suit === 'trois' ? `3️⃣ 3 CARTES — ${h36}` : suit === 'WIN_B' ? '🏦 BANQUIER GAGNE' : suit === 'WIN_P' ? '👤 JOUEUR GAGNE' : `${emoji} ${name}`;
      const sl36 = status === null ? '⌛ Vérification...' : status === 'gagne' ? `✅ ${RATR_EMOJI[rattrapage] ?? rattrapage} CONFIRMÉ 🎯` : `❌ Pas confirmé sur ${maxR} jeux`;
      return { text: `2️⃣ DUO PRO BACCARAT\n━━━━━━━━━━━━━━━━\n📌 Jeu #N${gameNumber}\n🎯 ${ct36}\n🔰 Dogon : +${maxR}\n━━━━━━━━━━━━━━━━\n${sl36}`, parse_mode: null };
    }
    // ── Format 37 : Duo VIP ──────────────────────────────────────────────────
    case 37: {
      const h37 = hand === 'banquier' ? '🏦' : '👤';
      const ct37 = suit === 'deux' ? '2️⃣ 2 cartes' : suit === 'trois' ? '3️⃣ 3 cartes' : suit === 'WIN_B' ? '🏦 Banquier' : suit === 'WIN_P' ? '👤 Joueur' : `${emoji} ${name}`;
      const sl37 = status === null ? '⌛' : status === 'gagne' ? `✅ ${RATR_EMOJI[rattrapage] ?? rattrapage}` : '❌';
      return { text: `╔══════════════════╗\n2️⃣ DUO VIP — Jeu #N${gameNumber}\n╚══════════════════╝\n${h37} ${ct37} · +${maxR}\n${sl37}`, parse_mode: null };
    }
    // ── Format 38 : Duo Force ────────────────────────────────────────────────
    case 38: {
      const h38 = hand === 'banquier' ? 'BANQUIER' : 'JOUEUR';
      const ct38 = suit === 'deux' ? `2 CARTES ${h38}` : suit === 'trois' ? `3 CARTES ${h38}` : suit === 'WIN_B' ? 'BANQUIER GAGNE' : suit === 'WIN_P' ? 'JOUEUR GAGNE' : name.toUpperCase();
      const sl38 = status === null ? '⌛ En cours...' : status === 'gagne' ? `✅ OUI (${RATR_EMOJI[rattrapage] ?? rattrapage})` : '❌ NON';
      return { text: `💪 DUO FORCE BACCARAT\n🎮 #N${gameNumber} · ${ct38}\n🔰 MAX ${maxR}\n${sl38}`, parse_mode: null };
    }
    // ── Format 39 : Duo Signal ───────────────────────────────────────────────
    case 39: {
      const ct39 = suit === 'deux' ? '2️⃣' : suit === 'trois' ? '3️⃣' : suit === 'WIN_B' ? '🏦' : suit === 'WIN_P' ? '👤' : emoji;
      const sl39 = status === null ? '⌛' : status === 'gagne' ? `✅${RATR_EMOJI[rattrapage] ?? rattrapage}` : '❌';
      return { text: `📡 DUO SIGNAL #N${gameNumber}\n${ct39} × ${maxR} → ${sl39}`, parse_mode: null };
    }
    // ── Format 40 : Duo Elite ────────────────────────────────────────────────
    case 40: {
      const h40 = hand === 'banquier' ? '🏦 BANK' : '👤 PLAY';
      const ct40 = suit === 'deux' ? '2️⃣ 2 CARTES' : suit === 'trois' ? '3️⃣ 3 CARTES' : suit === 'WIN_B' ? '🏆 BANK WIN' : suit === 'WIN_P' ? '🏆 PLAY WIN' : `${emoji} ${name.toUpperCase()}`;
      const sl40 = status === null ? '⏳ PENDING' : status === 'gagne' ? `🟢 WIN (${RATR_EMOJI[rattrapage] ?? rattrapage})` : '🔴 LOSE';
      return { text: `🏅 DUO ELITE #N${gameNumber}\n${h40} · ${ct40}\n⚡ RETRY ${maxR} · ${sl40}`, parse_mode: null };
    }
    // ── Format 41 : Duo Prestige ─────────────────────────────────────────────
    case 41: {
      const h41 = hand === 'banquier' ? '🏦 Banquier' : '👤 Joueur';
      const ct41 = suit === 'deux' ? '2️⃣ Deux cartes' : suit === 'trois' ? '3️⃣ Trois cartes' : suit === 'WIN_B' ? '🏆 Banquier gagne' : suit === 'WIN_P' ? '🏆 Joueur gagne' : `${emoji} ${name}`;
      const sl41 = status === null ? '⌛ Analyse en cours...' : status === 'gagne' ? `✅ Confirmé (${RATR_EMOJI[rattrapage] ?? rattrapage})` : `❌ Raté`;
      return { text: `💎 DUO PRESTIGE\n┌──────────────────┐\n│ Jeu #N${gameNumber} · ${h41}\n│ ${ct41} · +${maxR}\n└──────────────────┘\n${sl41}`, parse_mode: null };
    }
    // ── Format 42 : Duo Compact ──────────────────────────────────────────────
    case 42: {
      const ct42 = suit === 'deux' ? '2🃏' : suit === 'trois' ? '3🃏' : suit === 'WIN_B' ? '🏦W' : suit === 'WIN_P' ? '👤W' : emoji;
      const sl42 = status === null ? '⌛' : status === 'gagne' ? `✅${RATR_EMOJI[rattrapage] ?? rattrapage}` : '❌';
      return { text: `${ct42} #N${gameNumber} ×${maxR} ${sl42}`, parse_mode: null };
    }
    // ── Format 43 : Duo Alert ────────────────────────────────────────────────
    case 43: {
      const h43 = hand === 'banquier' ? 'BANQUIER' : 'JOUEUR';
      const ct43 = suit === 'deux' ? `2 CARTES ${h43}` : suit === 'trois' ? `3 CARTES ${h43}` : suit === 'WIN_B' ? 'BANQUIER GAGNE' : suit === 'WIN_P' ? 'JOUEUR GAGNE' : name.toUpperCase();
      const sl43 = status === null ? '⏳ ATTENTE' : status === 'gagne' ? `🟢 RÉUSSI (${RATR_EMOJI[rattrapage] ?? rattrapage})` : '🔴 RATÉ';
      return { text: `🚨 ALERTE DUO 🚨\n📍 JEU #N${gameNumber}\n⚠️ ${ct43}\n🔁 DOGON : +${maxR}\n${sl43}`, parse_mode: null };
    }
    // ── Format 44 : Duo Royal ────────────────────────────────────────────────
    case 44: {
      const h44 = hand === 'banquier' ? '🏦 Banquier' : '👤 Joueur';
      const ct44 = suit === 'deux' ? '2️⃣ Deux cartes' : suit === 'trois' ? '3️⃣ Trois cartes' : suit === 'WIN_B' ? '🏆 Victoire Banquier' : suit === 'WIN_P' ? '🏆 Victoire Joueur' : `${emoji} ${name}`;
      const sl44 = status === null ? '⌛ En attente...' : status === 'gagne' ? `👑 VICTOIRE ! (${RATR_EMOJI[rattrapage] ?? rattrapage})` : '💀 Défaite';
      return { text: `👑 DUO ROYAL CASINO\n━━━━━━━━━━━━━━━\n🎮 #N${gameNumber} · ${h44}\n${ct44} · +${maxR}\n━━━━━━━━━━━━━━━\n${sl44}`, parse_mode: null };
    }
    // ── Format 45 : Duo Flash ────────────────────────────────────────────────
    case 45: {
      const ct45 = suit === 'deux' ? '2️⃣⚡' : suit === 'trois' ? '3️⃣⚡' : suit === 'WIN_B' ? '🏦⚡' : suit === 'WIN_P' ? '👤⚡' : `${emoji}⚡`;
      const sl45 = status === null ? '⌛' : status === 'gagne' ? `✅${RATR_EMOJI[rattrapage] ?? rattrapage}` : '❌';
      return { text: `⚡ DUO FLASH\n${ct45} #N${gameNumber} +${maxR} | ${sl45}`, parse_mode: null };
    }

    // ── Formats 46-55 : VICTOIRE ─────────────────────────────────────────────

    // ── Format 46 : Victoire Pro+ ────────────────────────────────────────────
    case 46: {
      const vl46 = suit === 'WIN_B' ? '🏦 BANQUIER' : suit === 'WIN_P' ? '👤 JOUEUR' : suit === 'TIE' ? '⚖️ ÉGALITÉ' : `${emoji} ${name.toUpperCase()}`;
      const sl46 = status === null ? '⌛ Vérification en cours...' : status === 'gagne' ? `✅ ${RATR_EMOJI[rattrapage] ?? rattrapage} VICTOIRE CONFIRMÉE 🏆` : `❌ Pas de victoire sur ${maxR} jeux`;
      return { text: `🏆 VICTOIRE PRO+\n━━━━━━━━━━━━━━━━\n📌 Jeu #N${gameNumber}\n🎯 ${vl46} VA GAGNER\n🔰 Dogon : +${maxR}\n━━━━━━━━━━━━━━━━\n${sl46}`, parse_mode: null };
    }
    // ── Format 47 : Winner Elite ─────────────────────────────────────────────
    case 47: {
      const vl47 = suit === 'WIN_B' ? '🏦 Banquier' : suit === 'WIN_P' ? '👤 Joueur' : suit === 'TIE' ? '⚖️ Égalité' : `${emoji} ${name}`;
      const sl47 = status === null ? '⌛' : status === 'gagne' ? `✅ ${RATR_EMOJI[rattrapage] ?? rattrapage}` : '❌';
      return { text: `╔══════════════════╗\n🏆 WINNER ELITE — #N${gameNumber}\n╚══════════════════╝\n${vl47} · +${maxR}\n${sl47}`, parse_mode: null };
    }
    // ── Format 48 : Winner Flash ─────────────────────────────────────────────
    case 48: {
      const vl48 = suit === 'WIN_B' ? '🏦WIN' : suit === 'WIN_P' ? '👤WIN' : suit === 'TIE' ? 'TIE' : emoji;
      const sl48 = status === null ? '⌛' : status === 'gagne' ? `✅${RATR_EMOJI[rattrapage] ?? rattrapage}` : '❌';
      return { text: `⚡ WIN #N${gameNumber} ${vl48} +${maxR} ${sl48}`, parse_mode: null };
    }
    // ── Format 49 : Champion Style ───────────────────────────────────────────
    case 49: {
      const vl49 = suit === 'WIN_B' ? '🏦 BANQUIER' : suit === 'WIN_P' ? '👤 JOUEUR' : suit === 'TIE' ? '⚖️ ÉGALITÉ' : name.toUpperCase();
      const sl49 = status === null ? '⌛ En cours...' : status === 'gagne' ? `🥇 CHAMPION ! (${RATR_EMOJI[rattrapage] ?? rattrapage})` : '❌ Non';
      return { text: `🥇 CHAMPION BACCARAT 🥇\n🎮 #N${gameNumber}\n🏆 ${vl49} DOMINE\n⚡ Tentatives : ×${maxR}\n${sl49}`, parse_mode: null };
    }
    // ── Format 50 : Victory VIP ──────────────────────────────────────────────
    case 50: {
      const vl50 = suit === 'WIN_B' ? '🏦 Banquier' : suit === 'WIN_P' ? '👤 Joueur' : suit === 'TIE' ? '⚖️ Égalité' : `${emoji} ${name}`;
      const sl50 = status === null ? '⌛ Analyse...' : status === 'gagne' ? `✅ Victoire (${RATR_EMOJI[rattrapage] ?? rattrapage})` : `❌ Manqué`;
      return { text: `👑 VICTORY VIP CASINO\n┌────────────────────┐\n│ #N${gameNumber} · ${vl50}\n│ Dogon +${maxR}\n└────────────────────┘\n${sl50}`, parse_mode: null };
    }
    // ── Format 51 : Win Signal ───────────────────────────────────────────────
    case 51: {
      const vl51 = suit === 'WIN_B' ? '🏦' : suit === 'WIN_P' ? '👤' : suit === 'TIE' ? '⚖️' : emoji;
      const sl51 = status === null ? '⌛' : status === 'gagne' ? `✅${RATR_EMOJI[rattrapage] ?? rattrapage}` : '❌';
      return { text: `🔔 WIN SIGNAL\n${vl51} #N${gameNumber} +${maxR} → ${sl51}`, parse_mode: null };
    }
    // ── Format 52 : Win Alert ────────────────────────────────────────────────
    case 52: {
      const vl52 = suit === 'WIN_B' ? 'BANQUIER GAGNE' : suit === 'WIN_P' ? 'JOUEUR GAGNE' : suit === 'TIE' ? 'ÉGALITÉ' : name.toUpperCase();
      const sl52 = status === null ? '⏳ ATTENTE' : status === 'gagne' ? `🟢 CONFIRMÉ (${RATR_EMOJI[rattrapage] ?? rattrapage})` : '🔴 RATÉ';
      return { text: `🚨 WIN ALERT — JEU #N${gameNumber}\n⚠️ ${vl52}\n🔁 MAX ${maxR} | ${sl52}`, parse_mode: null };
    }
    // ── Format 53 : Win Compact ──────────────────────────────────────────────
    case 53: {
      const vl53 = suit === 'WIN_B' ? '🏦' : suit === 'WIN_P' ? '👤' : suit === 'TIE' ? '⚖️' : emoji;
      const sl53 = status === null ? '⌛' : status === 'gagne' ? `✅${RATR_EMOJI[rattrapage] ?? rattrapage}` : '❌';
      return { text: `${vl53}WIN #N${gameNumber} ×${maxR} ${sl53}`, parse_mode: null };
    }
    // ── Format 54 : Win HTML ─────────────────────────────────────────────────
    case 54: {
      const vl54 = suit === 'WIN_B' ? '<b>🏦 BANQUIER</b>' : suit === 'WIN_P' ? '<b>👤 JOUEUR</b>' : suit === 'TIE' ? '<b>⚖️ ÉGALITÉ</b>' : `<b>${name}</b>`;
      const sl54 = status === null ? '⌛ <i>En cours...</i>' : status === 'gagne' ? `✅ <b>GAGNÉ</b> ${RATR_EMOJI[rattrapage] ?? rattrapage}` : `❌ <i>Perdu</i>`;
      return { text: `🏆 <b>VICTOIRE PREMIUM</b>\n📌 Jeu <b>#N${gameNumber}</b>\n🎯 ${vl54} va gagner\n🔰 Dogon <b>+${maxR}</b>\n${sl54}`, parse_mode: 'HTML' };
    }
    // ── Format 55 : Win Dark ─────────────────────────────────────────────────
    case 55: {
      const vl55 = suit === 'WIN_B' ? '◼️ BANQUIER' : suit === 'WIN_P' ? '◽ JOUEUR' : suit === 'TIE' ? '◈ ÉGALITÉ' : `${emoji} ${name.toUpperCase()}`;
      const sl55 = status === null ? '◈ PENDING...' : status === 'gagne' ? `◉ WIN (${RATR_EMOJI[rattrapage] ?? rattrapage})` : '✖ LOSS';
      return { text: `◼️◼️◼️ WIN DARK ◼️◼️◼️\n◽ #N${gameNumber} · ${vl55} · +${maxR}\n◼️ ${sl55}`, parse_mode: null };
    }

    // ── Formats 56-65 : CARTE ENSEIGNE ───────────────────────────────────────

    // ── Format 56 : Enseigne Pro ─────────────────────────────────────────────
    case 56: {
      const h56 = hand === 'banquier' ? '🏦 BANQUIER' : '👤 JOUEUR';
      const sl56 = status === null ? '⌛ Vérification...' : status === 'gagne' ? `✅ ${RATR_EMOJI[rattrapage] ?? rattrapage} CONFIRMÉ 🎯` : `❌ Non confirmé sur ${maxR} jeux`;
      return { text: `🎴 ENSEIGNE PRO BACCARAT\n━━━━━━━━━━━━━━━━\n📌 Jeu #N${gameNumber}\n🎯 Couleur : ${emoji} ${name.toUpperCase()}\n👥 Camp : ${h56}\n🔰 Dogon : +${maxR}\n━━━━━━━━━━━━━━━━\n${sl56}`, parse_mode: null };
    }
    // ── Format 57 : Suit VIP ─────────────────────────────────────────────────
    case 57: {
      const h57 = hand === 'banquier' ? '🏦' : '👤';
      const sl57 = status === null ? '⌛' : status === 'gagne' ? `✅ ${RATR_EMOJI[rattrapage] ?? rattrapage}` : '❌';
      return { text: `╔══════════════════╗\n${emoji} SUIT VIP — Jeu #N${gameNumber}\n╚══════════════════╝\n${h57} ${name} · +${maxR}\n${sl57}`, parse_mode: null };
    }
    // ── Format 58 : Suit Bold ────────────────────────────────────────────────
    case 58: {
      const h58 = hand === 'banquier' ? 'BANQUIER' : 'JOUEUR';
      const sl58 = status === null ? '⌛ EN COURS...' : status === 'gagne' ? `✅ CONFIRMÉ (${RATR_EMOJI[rattrapage] ?? rattrapage})` : '❌ ÉCHEC';
      return { text: `${emoji}${emoji} BACCARAT ENSEIGNE ${emoji}${emoji}\n🎮 #N${gameNumber} · ${name.toUpperCase()} ${h58}\n⚡ DOGON MAX : +${maxR}\n${sl58}`, parse_mode: null };
    }
    // ── Format 59 : Suit Signal ──────────────────────────────────────────────
    case 59: {
      const h59e = hand === 'banquier' ? '🏦' : '👤';
      const sl59 = status === null ? '⌛' : status === 'gagne' ? `✅${RATR_EMOJI[rattrapage] ?? rattrapage}` : '❌';
      return { text: `📡 SUIT #N${gameNumber} ${emoji}${name} ${h59e} ×${maxR} ${sl59}`, parse_mode: null };
    }
    // ── Format 60 : Suit Dark ────────────────────────────────────────────────
    case 60: {
      const h60 = hand === 'banquier' ? 'BANK' : 'PLAY';
      const sl60 = status === null ? '▒ SCAN...' : status === 'gagne' ? `◉ HIT (${RATR_EMOJI[rattrapage] ?? rattrapage})` : '✖ MISS';
      return { text: `░░ SUIT DARK ░░\n▓ #N${gameNumber} ▓ ${emoji} ${name.toUpperCase()} ▓ ${h60} ▓ +${maxR}\n▒ ${sl60}`, parse_mode: null };
    }
    // ── Format 61 : Suit Gold ────────────────────────────────────────────────
    case 61: {
      const h61 = hand === 'banquier' ? '🏦 Banquier' : '👤 Joueur';
      const sl61 = status === null ? '⌛ Analyse...' : status === 'gagne' ? `✨ GOLDEN WIN (${RATR_EMOJI[rattrapage] ?? rattrapage})` : `❌ Raté`;
      return { text: `✨ 𝐒𝐔𝐈𝐓 𝐆𝐎𝐋𝐃 ✨\n━━━━━━━━━━━━━━━\n🎯 #N${gameNumber} · ${emoji} ${name}\n${h61} · +${maxR}\n━━━━━━━━━━━━━━━\n${sl61}`, parse_mode: null };
    }
    // ── Format 62 : Suit Compact ─────────────────────────────────────────────
    case 62: {
      const h62 = hand === 'banquier' ? '🏦' : '👤';
      const sl62 = status === null ? '⌛' : status === 'gagne' ? `✅${RATR_EMOJI[rattrapage] ?? rattrapage}` : '❌';
      return { text: `${emoji}${h62} #N${gameNumber} +${maxR} ${sl62}`, parse_mode: null };
    }
    // ── Format 63 : Suit Alert ───────────────────────────────────────────────
    case 63: {
      const h63 = hand === 'banquier' ? 'BANQUIER' : 'JOUEUR';
      const sl63 = status === null ? '⏳ ATTENTE' : status === 'gagne' ? `🟢 ENSEIGNE CONFIRMÉE (${RATR_EMOJI[rattrapage] ?? rattrapage})` : '🔴 RATÉ';
      return { text: `🚨 ALERTE ENSEIGNE ${emoji} 🚨\n📍 JEU #N${gameNumber} — ${h63}\n⚠️ COULEUR : ${name.toUpperCase()}\n🔁 DOGON : +${maxR}\n${sl63}`, parse_mode: null };
    }
    // ── Format 64 : Suit Crystal ─────────────────────────────────────────────
    case 64: {
      const h64 = hand === 'banquier' ? '🏦 Banquier' : '👤 Joueur';
      const sl64 = status === null ? '🔷 Prédiction active...' : status === 'gagne' ? `💎 CRISTAL CONFIRMÉ (${RATR_EMOJI[rattrapage] ?? rattrapage})` : '🔸 Non confirmé';
      return { text: `💎 CRYSTAL SUIT\n◈ Jeu #N${gameNumber}\n◈ ${emoji} ${name} — ${h64}\n◈ Puissance : ×${maxR}\n${sl64}`, parse_mode: null };
    }
    // ── Format 65 : Suit Block ───────────────────────────────────────────────
    case 65: {
      const sl65 = status === null ? '⌛ Attente' : status === 'gagne' ? `✅ ${RATR_EMOJI[rattrapage] ?? rattrapage}` : '❌';
      return { text: `【${emoji} SUIT BLOCK 】\n【 Jeu #N${gameNumber} 】\n【 +${maxR} 】 ${sl65}`, parse_mode: null };
    }

    // ── Formats 66-75 : HYBRIDES ─────────────────────────────────────────────

    // ── Format 66 : Multi-Pro ────────────────────────────────────────────────
    case 66: {
      const h66 = hand === 'banquier' ? '🏦 BANQUIER' : '👤 JOUEUR';
      const ct66 = suit === 'trois' ? `3️⃣ 3 CARTES` : suit === 'deux' ? `2️⃣ 2 CARTES` : suit === 'WIN_B' ? '🏆 BANQUIER GAGNE' : suit === 'WIN_P' ? '🏆 JOUEUR GAGNE' : suit === 'TIE' ? '⚖️ ÉGALITÉ' : `${emoji} ${name.toUpperCase()}`;
      const sl66 = status === null ? '⌛ En attente...' : status === 'gagne' ? `✅ ${RATR_EMOJI[rattrapage] ?? rattrapage} CONFIRMÉ` : `❌ Raté (${maxR} essais)`;
      return { text: `⭐ MULTI PRO BACCARAT\n═══════════════════\n📍 Jeu #N${gameNumber}\n🎯 ${ct66}\n👥 ${h66} · +${maxR}\n═══════════════════\n${sl66}`, parse_mode: null };
    }
    // ── Format 67 : Total Signal ─────────────────────────────────────────────
    case 67: {
      const ct67 = suit === 'trois' ? '3️⃣' : suit === 'deux' ? '2️⃣' : suit === 'WIN_B' ? '🏦W' : suit === 'WIN_P' ? '👤W' : suit === 'TIE' ? '⚖️' : emoji;
      const sl67 = status === null ? '⌛' : status === 'gagne' ? `✅${RATR_EMOJI[rattrapage] ?? rattrapage}` : '❌';
      return { text: `📡 TOTAL SIGNAL\n${ct67} #N${gameNumber} +${maxR} → ${sl67}`, parse_mode: null };
    }
    // ── Format 68 : Full VIP ─────────────────────────────────────────────────
    case 68: {
      const h68 = hand === 'banquier' ? '🏦 Banquier' : '👤 Joueur';
      const ct68 = suit === 'trois' ? '3️⃣ Trois cartes' : suit === 'deux' ? '2️⃣ Deux cartes' : suit === 'WIN_B' ? '🏆 Victoire Banquier' : suit === 'WIN_P' ? '🏆 Victoire Joueur' : suit === 'TIE' ? '⚖️ Égalité' : `${emoji} ${name}`;
      const sl68 = status === null ? '⌛ Prédiction active...' : status === 'gagne' ? `✅ Confirmé (${RATR_EMOJI[rattrapage] ?? rattrapage})` : '❌ Manqué';
      return { text: `╔══════════════════╗\n💎 FULL VIP BACCARAT\n╚══════════════════╝\n📌 #N${gameNumber} · ${h68}\n🎯 ${ct68}\n🔰 Dogon ×${maxR}\n${sl68}`, parse_mode: null };
    }
    // ── Format 69 : Pro Compact ──────────────────────────────────────────────
    case 69: {
      const ct69 = suit === 'trois' ? '3🃏' : suit === 'deux' ? '2🃏' : suit === 'WIN_B' ? '🏦W' : suit === 'WIN_P' ? '👤W' : suit === 'TIE' ? '⚖️' : emoji;
      const h69 = hand === 'banquier' ? '🏦' : '👤';
      const sl69 = status === null ? '⌛' : status === 'gagne' ? `✅${RATR_EMOJI[rattrapage] ?? rattrapage}` : '❌';
      return { text: `${ct69}${h69} #N${gameNumber} ×${maxR} ${sl69}`, parse_mode: null };
    }
    // ── Format 70 : Elite Plus ───────────────────────────────────────────────
    case 70: {
      const h70 = hand === 'banquier' ? '🏦 BANK' : '👤 PLAYER';
      const ct70 = suit === 'trois' ? `3️⃣ 3 CARDS` : suit === 'deux' ? `2️⃣ 2 CARDS` : suit === 'WIN_B' ? '🏆 BANK WIN' : suit === 'WIN_P' ? '🏆 PLAYER WIN' : `${emoji} ${name.toUpperCase()}`;
      const sl70 = status === null ? '⏳ LIVE' : status === 'gagne' ? `🟢 WIN (${RATR_EMOJI[rattrapage] ?? rattrapage})` : '🔴 LOSE';
      return { text: `🏅 ELITE PLUS\n▶ #N${gameNumber} | ${h70}\n▶ ${ct70} | RETRY ${maxR}\n▶ ${sl70}`, parse_mode: null };
    }
    // ── Format 71 : Diamond Pro ──────────────────────────────────────────────
    case 71: {
      const h71 = hand === 'banquier' ? '🏦 Banquier' : '👤 Joueur';
      const ct71 = suit === 'trois' ? '3️⃣ 3 cartes' : suit === 'deux' ? '2️⃣ 2 cartes' : suit === 'WIN_B' ? '🏆 Banquier gagne' : suit === 'WIN_P' ? '🏆 Joueur gagne' : `${emoji} ${name}`;
      const sl71 = status === null ? '◇ En cours...' : status === 'gagne' ? `💎 CONFIRMÉ (${RATR_EMOJI[rattrapage] ?? rattrapage})` : '◈ Non confirmé';
      return { text: `💎 DIAMOND PRO\n◆ Jeu #N${gameNumber} — ${h71}\n◆ ${ct71}\n◆ Dogon : +${maxR}\n${sl71}`, parse_mode: null };
    }
    // ── Format 72 : Crown Multi ──────────────────────────────────────────────
    case 72: {
      const h72 = hand === 'banquier' ? '🏦 Banquier' : '👤 Joueur';
      const ct72 = suit === 'trois' ? '3️⃣ Trois cartes' : suit === 'deux' ? '2️⃣ Deux cartes' : suit === 'WIN_B' ? '🏆 Victoire Banquier' : suit === 'WIN_P' ? '🏆 Victoire Joueur' : `${emoji} ${name}`;
      const sl72 = status === null ? '⌛ En attente...' : status === 'gagne' ? `👑 VICTOIRE (${RATR_EMOJI[rattrapage] ?? rattrapage})` : '💀 Défaite';
      return { text: `👑 CROWN MULTI CASINO\n━━━━━━━━━━━━━━━\n🎮 #N${gameNumber} · ${h72}\n${ct72} · +${maxR}\n━━━━━━━━━━━━━━━\n${sl72}`, parse_mode: null };
    }
    // ── Format 73 : Tiger Multi ──────────────────────────────────────────────
    case 73: {
      const ct73 = suit === 'trois' ? '3️⃣🐯' : suit === 'deux' ? '2️⃣🐯' : suit === 'WIN_B' ? '🏦🐯' : suit === 'WIN_P' ? '👤🐯' : `${emoji}🐯`;
      const sl73 = status === null ? '⌛' : status === 'gagne' ? `✅${RATR_EMOJI[rattrapage] ?? rattrapage}` : '❌';
      return { text: `🐯 TIGER MULTI 🐯\n${ct73} — #N${gameNumber} — ×${maxR}\n${sl73}`, parse_mode: null };
    }
    // ── Format 74 : Flash Multi ──────────────────────────────────────────────
    case 74: {
      const h74 = hand === 'banquier' ? '🏦' : '👤';
      const ct74 = suit === 'trois' ? '3️⃣' : suit === 'deux' ? '2️⃣' : suit === 'WIN_B' ? '🏆B' : suit === 'WIN_P' ? '🏆P' : emoji;
      const sl74 = status === null ? '⌛' : status === 'gagne' ? `✅${RATR_EMOJI[rattrapage] ?? rattrapage}` : '❌';
      return { text: `⚡ FLASH ${ct74}${h74} #N${gameNumber} +${maxR} ${sl74}`, parse_mode: null };
    }
    // ── Format 75 : Ultra Pro ────────────────────────────────────────────────
    case 75: {
      const h75 = hand === 'banquier' ? '🏦 BANQUIER' : '👤 JOUEUR';
      const ct75 = suit === 'trois' ? `3️⃣ 3 CARTES — ${h75}` : suit === 'deux' ? `2️⃣ 2 CARTES — ${h75}` : suit === 'WIN_B' ? '🏆 BANQUIER GAGNE' : suit === 'WIN_P' ? '🏆 JOUEUR GAGNE' : suit === 'TIE' ? '⚖️ ÉGALITÉ' : `${emoji} ${name.toUpperCase()}`;
      const sl75 = status === null ? '⌛ Analyse en cours...' : status === 'gagne' ? `✅ ${RATR_EMOJI[rattrapage] ?? rattrapage} ULTRA CONFIRMÉ 🌟` : `❌ Pas confirmé après ${maxR} essais`;
      return { text: `🌟 ═══ ULTRA PRO BACCARAT ═══ 🌟\n📍 Jeu #N${gameNumber}\n🎯 ${ct75}\n🔰 Dogon max : ×${maxR}\n━━━━━━━━━━━━━━━━━━━━━━\n${sl75}`, parse_mode: null };
    }

    // ── Format 76 : Cartes Signature ────────────────────────────────────────
    case 76: {
      const h76 = hand === 'banquier' ? 'Banquier' : 'Joueur';
      const ct76 = suit === 'deux' ? '2 cartes'
                 : suit === 'trois' ? '3 cartes'
                 : suit === 'pair' ? 'Pair'
                 : suit === 'impair' ? 'Impair'
                 : name;
      const sl76 = status === null    ? '⌛'
                 : status === 'gagne' ? `✅ ${RATR_EMOJI[rattrapage] ?? rattrapage}`
                 :                      '❌';
      return {
        text:
          `💠Jeux №${gameNumber}\n` +
          `🎯${h76} recevra ${ct76}\n` +
          `🌤 Rattrapages +${maxR}\n` +
          `🗯️Résultats : ${sl76}`,
        parse_mode: null,
      };
    }

    // ── Format 77 : Absence Victoire (V1 Joueur / V2 Banquier) ─────────────
    case 77: {
      // V1 = Victoire Joueur (WIN_P), V2 = Victoire Banquier (WIN_B)
      const v77 = suit === 'WIN_P' ? 'V1' : suit === 'WIN_B' ? 'V2' : suit === 'TIE' ? 'Ég.' : name;
      let sl77;
      if (status === null) {
        sl77 = `⏳ 💧 Poursuite ${maxR}!! (🔰+ ${maxR}Risque`;
      } else if (status === 'gagne') {
        sl77 = `✅${RATR_EMOJI[rattrapage] ?? rattrapage} 💧 Poursuite ${maxR}!! (🔰+ ${rattrapage}Risque`;
      } else {
        sl77 = `❌ 💧 Poursuite ${maxR}!! (🔰+ ${maxR}Risque`;
      }
      return {
        text: `🌈 Jeux № ${gameNumber} 🔹 Prediction: ${v77} 🌹Statut :${sl77}`,
        parse_mode: null,
      };
    }

    // ── Default : texte générique sans HTML ───────────────────────────────
    default:
      return {
        text:
          `🎯 PRÉDICTION #N${gameNumber}\n` +
          `${emoji} ${name}\n` +
          `🔰 +${maxR}\n` +
          `${statusLine}`,
        parse_mode: null,
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

function _siteFooter(siteUrl, stratName) {
  if (!siteUrl) return '';
  const nameLine = stratName ? `\n🏷 Cherchez « ${stratName} » dans la boutique` : '\n🛒 Aller dans la boutique';
  return `\n━━━━━━━━━━━━━━━\n🌐 Pour acquérir cette stratégie vite, cliquez sur le lien :\n🔗 ${siteUrl}${nameLine}`;
}

async function sendToStrategyChannels(strategy, gameNumber, suit, tgOpts = {}) {
  if (!TOKEN) {
    console.warn(`[TG] ${strategy} #${gameNumber} — pas de bot token configuré, envoi ignoré`);
    return;
  }

  // Utilise le format spécifique à la stratégie si fourni, sinon le format global
  const formatId = (tgOpts.formatId !== undefined && tgOpts.formatId !== null && tgOpts.formatId !== '')
    ? parseInt(tgOpts.formatId) : currentFormat;
  const hand      = tgOpts.hand || null;
  const maxR      = tgOpts.maxR !== undefined ? tgOpts.maxR : maxRattrapage;
  const siteUrl   = tgOpts.siteUrl   || '';
  const stratName = tgOpts.stratName || '';

  // Résolution du template : inline > custom DB (formatId > 18) > built-in
  let tg_template = tgOpts.tg_template || null;
  if (!tg_template && formatId > 18) {
    try { const row = await db.getCustomFormatById(formatId - 18); if (row) tg_template = row.template; } catch {}
  }

  const { text: rawText, parse_mode } = buildTgMessage(formatId, {
    gameNumber, suit, strategy, maxR, status: null, hand,
  }, tg_template);
  const text = rawText + _siteFooter(siteUrl, stratName);

  // Déterminer les canaux cibles
  let targets;
  try {
    const routes = await db.getStrategyRoutes(strategy);
    if (routes.length > 0) {
      // Routage explicite : seulement les canaux assignés à cette stratégie
      targets = routes.map(r => ({ tgId: r.tg_id, dbId: r.id, name: r.channel_name }));
      console.log(`[TG] ${strategy} routé vers ${targets.length} canal(aux) spécifique(s) fmt=${formatId}`);
    } else {
      // Pas de route → tous les canaux globaux
      targets = getChannels().map(c => ({ tgId: c.tgId, dbId: c.dbId, name: c.name }));
      if (targets.length === 0) {
        console.warn(`[TG] ${strategy} #${gameNumber} — aucun canal configuré, envoi ignoré`);
        return;
      }
    }
  } catch (e) {
    console.error(`[TG] getStrategyRoutes error: ${e.message}`);
    targets = getChannels().map(c => ({ tgId: c.tgId, dbId: c.dbId, name: c.name }));
  }

  for (const ch of targets) {
    try {
      const msgId = await _sendOneMessage(TOKEN, ch.tgId, text, parse_mode);
      if (msgId) {
        // Sauvegarde le format utilisé pour que editStoredMessages puisse re-générer le bon format
        await db.saveTgMsgId(strategy, gameNumber, suit, ch.tgId, msgId, null, formatId, tg_template || null).catch(() => {});
        console.log(`[TG] ${strategy} #${gameNumber} → ${ch.name || ch.tgId} fmt=${formatId} (msg_id=${msgId})`);
      }
    } catch (e) { console.error(`[TG] sendToStrategyChannels ${ch.tgId}: ${e.message}`); }
  }
}

// ── Stratégies personnalisées : envoi avec token custom + stockage ─
//
//  targets = [{ bot_token, channel_id }, ...]
//  Stocke le message_id + le bot_token dans tg_pred_messages pour
//  pouvoir éditer le message lors de la résolution.

async function sendCustomAndStore(targets, strategyId, gameNumber, suit, tgOpts = {}) {
  if (!Array.isArray(targets) || targets.length === 0) return;

  const defaultFormatId = tgOpts.formatId || currentFormat;
  const hand      = tgOpts.hand || null;
  const maxR      = tgOpts.maxR !== undefined ? tgOpts.maxR : maxRattrapage;
  const siteUrl   = tgOpts.siteUrl   || '';
  const stratName = tgOpts.stratName || '';
  // Template inline partagé par tous les canaux custom de la stratégie
  const stratTemplate = tgOpts.tg_template || null;

  for (const { bot_token, channel_id, tg_format: targetFormat } of targets) {
    if (!bot_token || !channel_id) continue;
    // ── Chaque canal peut avoir son propre format de message ──
    const channelFormatId = (targetFormat !== undefined && targetFormat !== null)
      ? parseInt(targetFormat) : defaultFormatId;
    // Résolution template : inline > custom DB > built-in
    let tg_template = stratTemplate;
    if (!tg_template && channelFormatId > 18) {
      try { const row = await db.getCustomFormatById(channelFormatId - 18); if (row) tg_template = row.template; } catch {}
    }
    const { text: rawText, parse_mode } = buildTgMessage(channelFormatId, {
      gameNumber, suit, strategy: strategyId, maxR, status: null, hand,
    }, tg_template);
    const text = rawText + _siteFooter(siteUrl, stratName);
    try {
      const msgId = await _sendOneMessage(bot_token, channel_id, text, parse_mode);
      if (msgId) {
        await db.saveTgMsgId(strategyId, gameNumber, suit, String(channel_id), msgId, bot_token, channelFormatId, tg_template || null).catch(() => {});
        console.log(`[TG Custom] ${strategyId} #${gameNumber} → ${channel_id} fmt=${channelFormatId} (msg_id=${msgId})`);
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

// Verrou anti-doublon : empêche deux phase 2 pour la même prédiction + canal
// (editStoredMessages peut être appelée deux fois : résolution live + résolution finale)
const _phase2Active = new Set();

// Phase 2 du format 11 (Distribution) — remplace les cartes après 10 secondes
function buildDistribFinalMsg(gameNumber, rattrapage) {
  return (
    `🃏 LE JEU VA SE TERMINER SUR LA DISTRIBUTION\n` +
    `📌 Jeu #N${gameNumber}\n` +
    `━━━━━━━━━━━━━━━━━━\n` +
    `✅ Distribution : OUI\n` +
    `✅ ${RATR_EMOJI[rattrapage] ?? rattrapage} GAGNÉ 🎯`
  );
}

async function editStoredMessages(strategy, gameNumber, suit, status, rattrapage, tgOpts = {}) {
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

  const defaultFormatId = tgOpts.formatId || currentFormat;
  const hand        = tgOpts.hand        || null;
  const maxR        = tgOpts.maxR        !== undefined ? tgOpts.maxR : maxRattrapage;
  const playerCards = tgOpts.playerCards || null;
  const bankerCards = tgOpts.bankerCards || null;
  const siteUrl     = tgOpts.siteUrl     || '';
  const stratName   = tgOpts.stratName   || '';

  for (const row of stored) {
    const token  = row.bot_token || TOKEN;
    if (!token) { console.warn(`[TG Edit] Pas de token pour ${row.channel_tg_id} — ignoré`); continue; }
    const formatId = (row.tg_format !== undefined && row.tg_format !== null)
      ? parseInt(row.tg_format) : defaultFormatId;
    // Utilise le template stocké (inline ou DB) — résolution : stocké > opts > built-in
    let tg_template = row.tg_template || tgOpts.tg_template || null;
    if (!tg_template && formatId > 18) {
      try { const dbRow = await db.getCustomFormatById(formatId - 18); if (dbRow) tg_template = dbRow.template; } catch {}
    }
    const { text: rawResultText, parse_mode } = buildTgMessage(formatId, {
      gameNumber, suit, strategy, maxR, status, rattrapage, hand, playerCards, bankerCards,
    }, tg_template);
    const resultText = rawResultText + _siteFooter(siteUrl, stratName);

    // ── Phase 1 : texte envoyé immédiatement ────────────────────────────────
    // Pour tous les formats quand gagné : on affiche les cartes reçues en phase 1,
    // puis on remplace par le résultat standard après 10 secondes (phase 2).
    const isDistrib = (suit === 'distrib');
    const hasCards  = (Array.isArray(playerCards) && playerCards.length > 0)
                   || (Array.isArray(bankerCards)  && bankerCards.length  > 0);

    let phase1Text;
    if (status === 'gagne' && hasCards && !isDistrib) {
      // Formats standard : résultat + numéro du jeu trouvé + section cartes (supprimée après 20s)
      const foundGame = gameNumber + rattrapage;
      const pEmojis   = formatCardsToEmojis(playerCards);
      const bEmojis   = formatCardsToEmojis(bankerCards);
      phase1Text =
        resultText +
        `\n━━━━━━━━━━━━━━━━━━\n` +
        `✅ Vérifié au jeu #N${foundGame}\n` +
        `🃏 Joueur  : ${pEmojis}\n` +
        `🎴 Banquier : ${bEmojis}`;
    } else {
      // Distribution (cartes déjà incluses dans resultText) ou pas de cartes : texte normal
      phase1Text = resultText;
    }

    try {
      const body = { chat_id: row.channel_tg_id, message_id: parseInt(row.message_id), text: phase1Text };
      if (parse_mode) body.parse_mode = parse_mode;
      const resp = await fetch(`https://api.telegram.org/bot${token}/editMessageText`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (resp.ok) {
        console.log(`[TG Edit] ${strategy} #${gameNumber} → ${row.channel_tg_id} (${status} R${rattrapage})`);

        // ── Réaction automatique après vérification ──────────────────────────────
        // 1 seule réaction (limite bot Telegram) : emoji du mode, fallback 👍/👎
        if (status === 'gagne' || status === 'perdu') {
          const msgId    = parseInt(row.message_id);
          const fallback = status === 'gagne' ? '👍' : '👎';
          // 1 seule réaction (limite Telegram bots) : mode emoji en priorité, sinon stratégie
          const mEmoji = _modeEmoji(tgOpts.mode || '', status) || _strategyEmoji(strategy, status);
          _scheduleReaction(token, row.channel_tg_id, msgId, mEmoji || fallback, fallback);
        }

        if (status === 'gagne') {
          const capturedToken  = token;
          const capturedChatId = row.channel_tg_id;
          const capturedMsgId  = parseInt(row.message_id);

          // Clé unique par prédiction + canal pour éviter deux phase 2 identiques
          const p2Key = `${strategy}#${gameNumber}#${suit}#${capturedChatId}`;

          if (!_phase2Active.has(p2Key)) {
            _phase2Active.add(p2Key);

            const phase2Text      = isDistrib
              ? buildDistribFinalMsg(gameNumber, rattrapage)
              : (hasCards ? resultText : null);
            const capturedParseMd = parse_mode;   // capture pour le closure phase2

            if (phase2Text) {
              setTimeout(async () => {
                _phase2Active.delete(p2Key);
                try {
                  const body2 = { chat_id: capturedChatId, message_id: capturedMsgId, text: phase2Text };
                  if (capturedParseMd) body2.parse_mode = capturedParseMd;
                  await fetch(`https://api.telegram.org/bot${capturedToken}/editMessageText`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(body2),
                  });
                  console.log(`[TG Edit] ${strategy} #${gameNumber} → ${capturedChatId} (phase2)`);
                } catch { _phase2Active.delete(p2Key); }
              }, 20_000);
            }
          }
        }
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

// ── Édition brute d'un message Carte Valeur (texte pré-rendu, sans formatBuilder) ─
// Utilisé pour mettre à jour le numéro de fin de cycle sans créer de nouveau message.
// Ne supprime PAS les message_ids de la DB car on continue à éditer le même message.

async function editRawStoredMessages(strategy, gameNumber, suit, rawText) {
  let stored;
  try {
    stored = await db.getTgMsgIds(strategy, gameNumber, suit);
  } catch (e) {
    console.error('[TG CV Edit] getTgMsgIds error:', e.message);
    stored = [];
  }
  if (!stored.length) {
    console.warn(`[TG CV Edit] Aucun message_id pour ${strategy}/#${gameNumber}/${suit}`);
    return;
  }
  for (const row of stored) {
    const token = row.bot_token || TOKEN;
    if (!token) { console.warn(`[TG CV Edit] Pas de token pour ${row.channel_tg_id} — ignoré`); continue; }
    try {
      const body = { chat_id: row.channel_tg_id, message_id: parseInt(row.message_id), text: rawText };
      const resp = await fetch(`https://api.telegram.org/bot${token}/editMessageText`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (resp.ok) {
        console.log(`[TG CV Edit] ${strategy} #${gameNumber}/${suit} → ${row.channel_tg_id} mis à jour`);
      } else {
        const err = await resp.text();
        if (!err.includes('message is not modified')) {
          console.error(`[TG CV Edit] editMessage ${row.channel_tg_id}: ${err.slice(0, 120)}`);
        }
      }
    } catch (e) { console.error(`[TG CV Edit] Exception: ${e.message}`); }
  }
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

// ── Bilan : envoi d'un texte brut à un canal Telegram ──────────────

async function sendRawMessage(token, chatId, text, parseMode = 'HTML') {
  if (!token || !chatId) return null;
  return _sendOneMessage(token, String(chatId), text, parseMode);
}

async function sendBilanToStrategyChannels(strategy, text) {
  if (!TOKEN) return;
  let targets;
  try {
    const routes = await db.getStrategyRoutes(strategy);
    targets = routes.length > 0
      ? routes.map(r => ({ tgId: r.tg_id }))
      : getChannels().map(c => ({ tgId: c.tgId }));
  } catch { targets = getChannels().map(c => ({ tgId: c.tgId })); }
  for (const ch of targets) {
    try { await _sendOneMessage(TOKEN, ch.tgId, text, 'HTML'); }
    catch (e) { console.error(`[Bilan] TG ${strategy} → ${ch.tgId}: ${e.message}`); }
  }
}

// ── Gestion Banque : fonctions de message ────────────────────────────────────

const BANQUE_CURRENCY_MAP = { f: 'f', eur: '€', usd: '$', rub: '₽' };
function _bgCurr(currency) { return BANQUE_CURRENCY_MAP[currency] || currency || 'f'; }
function _bgRnd(n) { return Math.round(n * 100) / 100; }

/**
 * Message individuel pour UNE prédiction du lot.
 * Envoyé comme nouveau message à chaque signal.
 * Édité une fois la prédiction résolue.
 */
function buildBanquePredText(pred, bgState, cfg, predIndexOneBased, lotSize) {
  const curr     = _bgCurr(cfg.bg_currency);
  const cote     = parseFloat(cfg.bg_cote) || 1.9;
  const initMise = parseFloat(cfg.bg_mise_initiale) || 1000;
  const lotNum   = bgState.lot_number || 1;
  const se       = SUIT_EMOJI_MAP[pred.suit] || pred.suit;

  // Ligne de statut
  let statusLine;
  if (pred.status === null) {
    statusLine = `📣 Signal #${pred.game} ${se}  ⌛`;
  } else if (pred.status === 'gagne') {
    const Re     = RATR_EMOJI[pred.ratr] ?? pred.ratr;
    const profit = _bgRnd(pred.amount_delta);
    statusLine   = `✅ Signal #${pred.game} ${se}  ${Re}  +${profit}${curr}`;
  } else {
    const perte  = _bgRnd(Math.abs(pred.amount_delta));
    statusLine   = `❌ Signal #${pred.game} ${se}  -${perte}${curr}`;
  }

  // Lignes mises par rattrapage R0→R3
  const ratrLines = [0, 1, 2, 3].map(r => {
    const m        = Math.round(initMise * Math.pow(2.2, r) * 100) / 100;
    let totalM = 0, mm = initMise;
    for (let i = 0; i <= r; i++) { totalM += mm; mm = Math.round(mm * 2.2 * 100) / 100; }
    totalM = Math.round(totalM * 100) / 100;
    const gain = Math.round(m * cote * 100) / 100;
    const net  = Math.round((gain - totalM) * 100) / 100;
    return `R${r} ➜ ${_bgRnd(m)}${curr}   (+${net}${curr} si gagné)`;
  }).join('\n');

  return (
    `🏦 GESTION BANQUE\n` +
    `━━━━━━━━━━━━━━━\n` +
    `💰 Banque : ${_bgRnd(bgState.bank)}${curr}\n` +
    `━━━━━━━━━━━━━━━\n` +
    `🎮 LOT #${lotNum} — ${predIndexOneBased}/${lotSize}\n` +
    `━━━━━━━━━━━━━━━\n` +
    `${statusLine}\n` +
    `━━━━━━━━━━━━━━━\n` +
    `🎲 Mises par rattrapage :\n` +
    `${ratrLines}\n` +
    `📈 Côte : ×${cote}`
  );
}

/**
 * Ligne d'affichage d'une prédiction du lot.
 * ❌ : montre la mise perdue
 * ✅ : montre le profit net (gain - mise)
 * ⌛ : en attente
 */
function _bgPredLine(pred, cote, curr) {
  const se = SUIT_EMOJI_MAP[pred.suit] || pred.suit;
  if (pred.status === null) {
    return `${pred.game}- ${se} ⌛`;
  } else if (pred.status === 'gagne') {
    const Re     = RATR_EMOJI[pred.ratr] ?? pred.ratr;
    const profit = _bgRnd(pred.amount_delta);
    return `${pred.game}- ${se} ✅ ${Re}  +${profit}${curr}`;
  } else {
    const perte = _bgRnd(Math.abs(pred.amount_delta));
    return `${pred.game}- ${se} ❌  -${perte}${curr}`;
  }
}

/**
 * Calcule la ligne "BÉNÉFICES" avec formule cumulative sur tout le lot.
 * Ex : 0f + 900f - 1000f = -100f
 * Aucun résultat encore : 0f
 */
function _bgBankLine(bgState, curr) {
  const preds     = bgState.lot_predictions || [];
  const donePreds = preds.filter(p => p.status !== null);

  if (donePreds.length === 0) {
    return `${_bgRnd(bgState.bank)}${curr}`;
  }

  const totalDelta = donePreds.reduce((sum, p) => sum + (p.amount_delta || 0), 0);
  const bankStart  = _bgRnd(bgState.bank - totalDelta);

  let formula = `${bankStart}${curr}`;
  for (const pred of donePreds) {
    const d = pred.amount_delta || 0;
    formula += d < 0 ? ` - ${Math.abs(d)}${curr}` : ` + ${d}${curr}`;
  }
  formula += ` = ${_bgRnd(bgState.bank)}${curr}`;
  return formula;
}

/**
 * Message initial du lot (première prédiction en attente).
 */
function buildBanqueInitialText(bgState, cfg, gameNumber, suit) {
  const curr      = _bgCurr(cfg.bg_currency);
  const cote      = parseFloat(cfg.bg_cote) || 1.9;
  const maxR      = 3; // gestion_banque : toujours 3 rattrapages fixes (R0→R3)
  const lotSize   = parseInt(cfg.bg_lot_size) || 5;
  const lotNum    = bgState.lot_number || 1;
  const suitEmoji = SUIT_EMOJI_MAP[suit] || suit;
  return (
    `💰 Montant banque : ${_bgRnd(bgState.bank)}${curr}\n` +
    `🎲 Mise : ${_bgRnd(bgState.current_mise)}${curr}\n` +
    `📈 Côté : ×${cote}\n` +
    `🔋 Rattrapage : ${maxR}\n` +
    `━━━━━━━━━━━━━━━\n` +
    `🎮 LOT #${lotNum} — 1/${lotSize}\n` +
    `━━━━━━━━━━━━━━━\n` +
    `\n` +
    `${gameNumber}- ${suitEmoji} ⌛\n` +
    `\n` +
    `━━━━━━━━━━━━━━━\n` +
    `🏦 BANQUE ACTUELLE\n` +
    `━━━━━━━━━━━━━━━\n` +
    `${_bgRnd(bgState.bank)}${curr}`
  );
}

/**
 * Message de lot en cours (résultats + prédiction(s) en attente) — envoyé pour chaque nouvelle pred.
 * Montre TOUT l'historique du lot + la pred courante en ⌛, plus le tableau R0→R3.
 */
function buildBanqueLotText(bgState, cfg) {
  const curr     = _bgCurr(cfg.bg_currency);
  const cote     = parseFloat(cfg.bg_cote) || 1.9;
  const initMise = parseFloat(cfg.bg_mise_initiale) || 1000;
  const maxR     = 3;
  const lotSize  = parseInt(cfg.bg_lot_size) || 5;
  const lotNum   = bgState.lot_number || 1;
  const preds    = bgState.lot_predictions || [];
  const count    = preds.length;

  const predLines = preds.map(p => _bgPredLine(p, cote, curr));

  const ratrLines = [0, 1, 2, 3].map(r => {
    const m = Math.round(initMise * Math.pow(2.2, r) * 100) / 100;
    let totalM = 0, mm = initMise;
    for (let i = 0; i <= r; i++) { totalM += mm; mm = Math.round(mm * 2.2 * 100) / 100; }
    totalM = Math.round(totalM * 100) / 100;
    const gain = Math.round(m * cote * 100) / 100;
    const net  = Math.round((gain - totalM) * 100) / 100;
    return `R${r} ➜ ${_bgRnd(m)}${curr}   (+${net}${curr} si gagné)`;
  }).join('\n');

  // Nom boutique : priorité au titre issu de strategy_promo_config, sinon bg_boutique_name admin
  const boutiqueName = (cfg.bg_shop_titre || cfg.bg_boutique_name || '').trim();
  const siteUrl      = (cfg.bg_site_url || '').trim();
  const headerLine   = boutiqueName ? `🏪 ${boutiqueName}${siteUrl ? `  |  🔗 ${siteUrl}` : ''}\n` : (siteUrl ? `🔗 ${siteUrl}\n` : '');

  const followLine = siteUrl
    ? `\n━━━━━━━━━━━━━━━\n🌐 Pour avoir cette stratégie, cliquez sur le lien — allez dans la section boutique, voilà le lien du site :\n🔗 ${siteUrl}`
    : '';

  return (
    (headerLine ? headerLine + `━━━━━━━━━━━━━━━\n` : ``) +
    `💰 Banque : ${_bgRnd(bgState.bank)}${curr}\n` +
    `━━━━━━━━━━━━━━━\n` +
    `🎮 LOT #${lotNum} — ${count}/${lotSize}\n` +
    `━━━━━━━━━━━━━━━\n` +
    `\n` +
    predLines.join('\n') + `\n` +
    `\n` +
    `━━━━━━━━━━━━━━━\n` +
    `🏦 BANQUE ACTUELLE\n` +
    `━━━━━━━━━━━━━━━\n` +
    _bgBankLine(bgState, curr) + `\n` +
    `━━━━━━━━━━━━━━━\n` +
    `🎲 Paramètres de mise :\n` +
    ratrLines + `\n` +
    `📈 Côte : ×${cote}` +
    followLine
  );
}

/**
 * Bilan final après que tous les lots prévus sont terminés.
 */
function buildBanqueFinalBilanText(lotHistory, cfg, initialBank) {
  const curr  = _bgCurr(cfg.bg_currency);
  const cote  = parseFloat(cfg.bg_cote) || 1.9;
  const lines = [];
  for (const lot of lotHistory) {
    const delta    = _bgRnd(lot.bankAfter - lot.bankBefore);
    const deltaStr = delta >= 0 ? `+${delta}${curr}` : `${delta}${curr}`;
    const predLines = lot.preds.map(p => _bgPredLine(p, cote, curr)).join('\n');
    lines.push(
      `📊 LOT #${lot.lotNumber}\n` +
      predLines + `\n` +
      `Résultat : ${deltaStr}`
    );
  }
  const finalBank  = lotHistory.length > 0 ? lotHistory[lotHistory.length - 1].bankAfter : initialBank;
  const totalEarned = _bgRnd(finalBank - initialBank);
  const earnedStr   = totalEarned >= 0 ? `+${totalEarned}${curr}` : `${totalEarned}${curr}`;

  return (
    `🏦 BILAN FINAL — GESTION BANQUE\n` +
    `━━━━━━━━━━━━━━━\n` +
    `💰 Banque départ : ${_bgRnd(initialBank)}${curr}\n` +
    `━━━━━━━━━━━━━━━\n` +
    `\n` +
    lines.join('\n\n') + `\n` +
    `\n` +
    `━━━━━━━━━━━━━━━\n` +
    `💵 Total gagné : ${earnedStr}\n` +
    `🏦 Banque finale : ${_bgRnd(finalBank)}${curr}\n` +
    `━━━━━━━━━━━━━━━\n` +
    (() => {
      const bn  = (cfg.bg_shop_titre || cfg.bg_boutique_name || '').trim();
      const url = (cfg.bg_site_url || '').trim();
      return (
        `\n🎉 <b>Campagne terminée avec succès !</b>\n\n` +
        (bn  ? `🏪 <b>${bn}</b>\n` : ``) +
        (url ? `🔗 ${url}\n\n` : `\n`) +
        `💎 Veux-tu continuer à gagner ?\n` +
        `📲 Rejoins notre site et commande ta stratégie dès maintenant !\n` +
        `🚀 Des centaines de joueurs gagnent déjà — à ton tour !`
      );
    })()
  );
}

/**
 * Message de résumé après fin de lot.
 */
function buildBanqueSummaryText(lotPreds, cfg, lotNumber, bankBefore, bankAfter) {
  const curr    = _bgCurr(cfg.bg_currency);
  const cote    = parseFloat(cfg.bg_cote) || 1.9;
  const maxR    = 3; // gestion_banque : toujours 3 rattrapages fixes (R0→R3)

  const predLines = lotPreds.map(p => _bgPredLine(p, cote, curr));

  const delta    = _bgRnd(bankAfter - bankBefore);
  const deltaStr = delta >= 0 ? `+${delta}` : `${delta}`;
  const bankLine = delta < 0
    ? `${_bgRnd(bankBefore)}${curr} - ${Math.abs(delta)}${curr} = ${_bgRnd(bankAfter)}${curr}`
    : `${_bgRnd(bankBefore)}${curr} + ${delta}${curr} = ${_bgRnd(bankAfter)}${curr}`;

  const boutiqueName = (cfg.bg_shop_titre || cfg.bg_boutique_name || '').trim();
  const siteUrl      = (cfg.bg_site_url || '').trim();
  const stratNom     = (boutiqueName || cfg.name || 'Stratégie Gestion Banque').trim();

  const promoBlock =
    `\n\n━━━━━━━━━━━━━━━\n` +
    `✅ Merci d'avoir suivi le montant du lot numéro ${lotNumber} !\n\n` +
    `📊 Stratégie : <b>${stratNom}</b>\n` +
    (siteUrl ? `🔗 Lien : ${siteUrl}\n\n` : `\n`) +
    `🙏 Sossou Kouamé vous remercie !\n\n` +
    `🛒 <b>Rendez-vous vite sur le site — Section Boutique</b>\npour acquérir cette stratégie exclusive !\n` +
    `━━━━━━━━━━━━━━━\n` +
    `💎 Des centaines de joueurs gagnent déjà grâce à cette méthode\n— rejoignez-les !\n` +
    `🚀 Ne laissez pas cette opportunité vous échapper !\n` +
    `📲 Cliquez sur le lien ci-dessus et commencez à gagner dès aujourd'hui !`;

  return (
    `💰 Montant banque départ : ${_bgRnd(bankBefore)}${curr}\n` +
    `📈 Côté : ×${cote}\n` +
    `🔋 Rattrapage : ${maxR}\n` +
    `━━━━━━━━━━━━━━━\n` +
    `📊 BILAN LOT #${lotNumber}\n` +
    `━━━━━━━━━━━━━━━\n` +
    `\n` +
    predLines.join('\n') + `\n` +
    `\n` +
    `━━━━━━━━━━━━━━━\n` +
    `💵 Résultat : ${deltaStr}${curr}\n` +
    `\n` +
    `🏦 BANQUE ACTUELLE\n` +
    `━━━━━━━━━━━━━━━\n` +
    bankLine +
    promoBlock
  );
}

/**
 * Envoie un message banque sur les targets configurées.
 * Returns: [{token, chat_id, message_id}]
 */
async function sendBanqueTgMessage(targets, text) {
  if (!Array.isArray(targets) || targets.length === 0) return [];
  const results = [];
  for (const t of targets) {
    const token = t.bot_token || TOKEN;
    const chatId = t.channel_id;
    if (!token || !chatId) continue;
    try {
      const msgId = await _sendOneMessage(token, chatId, text, null);
      if (msgId) results.push({ token, chat_id: chatId, message_id: msgId });
    } catch (e) {
      console.error(`[BanqueTG] Erreur envoi: ${e.message}`);
    }
  }
  return results;
}

/**
 * Édite un message banque existant.
 */
async function editBanqueTgMessage(msgIds, text) {
  if (!Array.isArray(msgIds) || msgIds.length === 0) return;
  for (const m of msgIds) {
    const token = m.token || TOKEN;
    if (!token || !m.chat_id || !m.message_id) continue;
    try {
      const resp = await fetch(`https://api.telegram.org/bot${token}/editMessageText`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chat_id: m.chat_id, message_id: parseInt(m.message_id), text }),
      });
      if (!resp.ok) {
        const err = await resp.text();
        if (!err.includes('message is not modified')) {
          console.error(`[BanqueTG Edit] ${m.chat_id}: ${err.slice(0, 100)}`);
        }
      }
    } catch (e) {
      console.error(`[BanqueTG Edit] Erreur: ${e.message}`);
    }
  }
}

/**
 * Résumé compact du lot — envoyé en une seule fois quand le lot est terminé.
 * Format :
 *   Joueur+3
 *   29♥✅1️⃣
 *   30♥✅0️⃣
 *   31♥❌2️⃣
 */
function buildBanqueCompactSummary(lotPreds, cfg) {
  const handLabel = cfg.hand === 'banquier' ? 'Banquier' : 'Joueur';
  const delta     = lotPreds.reduce((acc, p) => acc + (p.amount_delta || 0), 0);
  const deltaRnd  = Math.round(delta * 100) / 100;
  const deltaStr  = deltaRnd >= 0 ? `+${deltaRnd}` : `${deltaRnd}`;
  const header    = `${handLabel}${deltaStr}`;

  const lines = lotPreds.map(p => {
    const sym    = p.suit || '?';
    const result = p.status === 'gagne' ? '✅' : p.status === 'perdu' ? '❌' : '⏳';
    const ratr   = RATR_EMOJI[p.ratr] ?? `${p.ratr}`;
    return `${p.game}${sym}${result}${ratr}`;
  });

  return [header, ...lines].join(' \n');
}

// ── Payment handler registry (approve/reject via bot callbacks) ───────────
let _paymentHandlers = null;
function registerPaymentHandlers(handlers) {
  if (handlers && typeof handlers.approve === 'function' && typeof handlers.reject === 'function') {
    _paymentHandlers = handlers;
  }
}
function getPaymentHandlers() { return _paymentHandlers; }

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
  editRawStoredMessages,
  sendRawMessage, sendBilanToStrategyChannels,
  SUIT_EMOJI, SUIT_NAME,
  buildBanqueInitialText, buildBanqueLotText, buildBanqueSummaryText, buildBanquePredText, buildBanqueFinalBilanText,
  buildBanqueCompactSummary,
  sendBanqueTgMessage, editBanqueTgMessage,
  registerRelayHandler, unregisterRelayHandler, getMainToken,
  registerPaymentHandlers, getPaymentHandlers,
};
