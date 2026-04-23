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
              const fmtId = Math.max(1, Math.min(18, parseInt(b.data?.format_id) || 1));
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

const SUIT_EMOJI_MAP = { '♠': '♠️', '♥': '❤️', '♦': '♦️', '♣': '♣️', 'distrib': '🌀', 'deux': '2️⃣', 'trois': '3️⃣', 'WIN_B': '🏦', 'WIN_P': '👤', 'TIE': '🤝', 'TWO_THREE': '⚡', 'DEUX_TROIS': '2️⃣3️⃣', 'TROIS_DEUX': '3️⃣2️⃣', 'TROIS_TROIS': '3️⃣3️⃣' };
const SUIT_NAME_FR   = { '♠': 'Pique', '♥': 'Cœur', '♦': 'Carreau', '♣': 'Trèfle', 'distrib': 'Distribution', 'deux': '2 Cartes', 'trois': '3 Cartes', 'WIN_B': 'Victoire Banquier', 'WIN_P': 'Victoire Joueur', 'TIE': 'Match Nul', 'TWO_THREE': '2+3 Cartes', 'DEUX_TROIS': 'J:2 B:3', 'TROIS_DEUX': 'J:3 B:2', 'TROIS_TROIS': 'J:3 B:3' };
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
  // Les modes Carte 2/3 utilisent le format 12 par défaut (sauf si un format ≥12 a été choisi)
  if ((suit === 'deux' || suit === 'trois') && (!formatId || parseInt(formatId) < 12)) formatId = 12;

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
      const targetCards = suit === 'deux' ? 2 : 3;
      const cardEmoji   = suit === 'deux' ? '2️⃣' : '3️⃣';
      const winMsg   = suit === 'deux'
        ? `✅ ${RATR_EMOJI[rattrapage] ?? rattrapage} Naturel confirmé 🎯`
        : `✅ ${RATR_EMOJI[rattrapage] ?? rattrapage} 3 cartes confirmé 🎯`;
      const lossMsg  = suit === 'deux'
        ? `❌ Pas de naturel sur ${maxR} jeux`
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

async function sendToStrategyChannels(strategy, gameNumber, suit, tgOpts = {}) {
  if (!TOKEN) {
    console.warn(`[TG] ${strategy} #${gameNumber} — pas de bot token configuré, envoi ignoré`);
    return;
  }

  // Utilise le format spécifique à la stratégie si fourni, sinon le format global
  const formatId = (tgOpts.formatId !== undefined && tgOpts.formatId !== null && tgOpts.formatId !== '')
    ? parseInt(tgOpts.formatId) : currentFormat;
  const hand = tgOpts.hand || null;
  const maxR = tgOpts.maxR !== undefined ? tgOpts.maxR : maxRattrapage;

  // Résolution du template : inline > custom DB (formatId > 18) > built-in
  let tg_template = tgOpts.tg_template || null;
  if (!tg_template && formatId > 18) {
    try { const row = await db.getCustomFormatById(formatId - 18); if (row) tg_template = row.template; } catch {}
  }

  const { text, parse_mode } = buildTgMessage(formatId, {
    gameNumber, suit, strategy, maxR, status: null, hand,
  }, tg_template);

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
  const hand = tgOpts.hand || null;
  const maxR = tgOpts.maxR !== undefined ? tgOpts.maxR : maxRattrapage;
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
    const { text, parse_mode } = buildTgMessage(channelFormatId, {
      gameNumber, suit, strategy: strategyId, maxR, status: null, hand,
    }, tg_template);
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
    const { text: resultText, parse_mode } = buildTgMessage(formatId, {
      gameNumber, suit, strategy, maxR, status, rattrapage, hand, playerCards, bankerCards,
    }, tg_template);

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
  sendRawMessage, sendBilanToStrategyChannels,
  SUIT_EMOJI, SUIT_NAME,
};
