const TelegramBot = require('node-telegram-bot-api');
const fetch       = require('node-fetch');
const db          = require('./db');

let TOKEN         = process.env.BOT_TOKEN || null;

// ── ID Telegram de l'administrateur unique du bot ──────────────────────────
const ADMIN_TG_ID = '1190237801';

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

  // ══════════════════════════════════════════════════════════════════════════
  //  ADMIN & COMPTE — reconnaissance par ID Telegram, inscription/liaison,
  //  et commandes admin complètes (approbation, durée, paiements, import/export)
  // ══════════════════════════════════════════════════════════════════════════
  const bcrypt   = require('bcryptjs');
  const dbAcc    = require('./db');
  const pendingLink = new Map(); // userId(tgId) -> { step, username }

  async function isAdminSender(tgUserId) {
    let adminId = '';
    try { adminId = (await dbAcc.getSetting('bot_admin_tg_id') || '').trim(); } catch {}
    return !!adminId && String(tgUserId) === adminId;
  }

  function fmtExpiry(u) {
    if (!u.subscription_expires_at) return 'aucun abonnement';
    const d = new Date(u.subscription_expires_at);
    const active = d > new Date();
    return `${active ? '✅ actif jusqu\'au' : '❌ expiré le'} ${d.toLocaleString('fr-FR')}`;
  }

  bot.on('message', async (msg) => {
    const tgUserId = String(msg.from?.id || '');
    const chatId   = String(msg.chat?.id || '');
    const text     = (msg.text || '').trim();
    if (!tgUserId || msg.chat?.type !== 'private') return;

    // ── Restriction bot : seul l'administrateur (ADMIN_TG_ID) peut interagir ──
    if (tgUserId !== ADMIN_TG_ID) {
      let siteUrl = '';
      try { siteUrl = (await dbAcc.getSetting('bot_site_url') || await dbAcc.getSetting('tg_site_url') || '').trim(); } catch {}
      try {
        const reg_msg = siteUrl
          ? `👋 Bienvenue sur Baccarat Pro !\n\n` +
            `Ce bot est réservé à l'administrateur.\n` +
            `Pour bénéficier des prédictions, inscrivez-vous sur le site :\n\n` +
            `🔗 ${siteUrl}`
          : `👋 Bienvenue sur Baccarat Pro !\n\n` +
            `Ce bot est réservé à l'administrateur.\n` +
            `Contactez l'admin pour plus d'informations.`;
        await bot.sendMessage(chatId, reg_msg);
      } catch {}
      return;
    }

    // ── /start ────────────────────────────────────────────────────────────
    if (text === '/start') {
      if (await isAdminSender(tgUserId)) {
        try {
          await bot.sendMessage(chatId,
            `👋 Bienvenue Sossou Kouamé !\n\nVous êtes reconnu comme <b>administrateur</b> de Baccarat Pro.\n\nTapez /adminhelp pour voir toutes les commandes disponibles.`,
            { parse_mode: 'HTML' }
          );
        } catch {}
        return;
      }
      const existing = await dbAcc.getUserByTelegramId(tgUserId);
      if (existing) {
        try {
          await bot.sendMessage(chatId,
            `👋 Bienvenue ${existing.username} !\n\n${fmtExpiry(existing)}`,
            { parse_mode: 'HTML', reply_markup: { inline_keyboard: [[
              { text: '💳 Déjà payé ?', callback_data: 'acc:paid' },
            ]] } }
          );
        } catch {}
        return;
      }
      pendingLink.set(tgUserId, { step: 'choice' });
      try {
        await bot.sendMessage(chatId,
          `👋 Bienvenue sur Baccarat Pro !\n\nVous n'avez pas encore de compte lié à ce Telegram.`,
          { reply_markup: { inline_keyboard: [[
            { text: '📝 S\'inscrire', callback_data: 'acc:register' },
            { text: '🔑 J\'ai déjà un compte', callback_data: 'acc:login' },
          ]] } }
        );
      } catch {}
      return;
    }

    // ── Suite de la liaison de compte (saisie username / password) ────────
    const pend = pendingLink.get(tgUserId);
    if (pend && !text.startsWith('/')) {
      if (pend.step === 'ask_username_login' || pend.step === 'ask_username_register') {
        pend.username = text;
        pend.step = pend.step === 'ask_username_login' ? 'ask_password_login' : 'ask_password_register';
        pendingLink.set(tgUserId, pend);
        try { await bot.sendMessage(chatId, pend.step === 'ask_password_login' ? '🔑 Mot de passe :' : '🔑 Choisissez un mot de passe :'); } catch {}
        return;
      }
      if (pend.step === 'ask_password_login') {
        pendingLink.delete(tgUserId);
        try {
          const user = await dbAcc.getUserByLogin(pend.username);
          const ok = user && user.password_hash && await bcrypt.compare(text, user.password_hash);
          if (!ok) { await bot.sendMessage(chatId, '❌ Identifiant ou mot de passe incorrect. Tapez /start pour réessayer.'); return; }
          const already = await dbAcc.getUserByTelegramId(tgUserId);
          if (already && already.id !== user.id) { await bot.sendMessage(chatId, '❌ Ce Telegram est déjà lié à un autre compte.'); return; }
          await dbAcc.linkTelegramId(user.id, tgUserId);
          await bot.sendMessage(chatId, `✅ Compte lié ! Bienvenue ${user.username}.\n\n${fmtExpiry(user)}`, { parse_mode: 'HTML' });
        } catch (e) { try { await bot.sendMessage(chatId, `❌ Erreur: ${e.message}`); } catch {} }
        return;
      }
      if (pend.step === 'ask_username_paid') {
        pend.paidUsername = text;
        pend.step = 'ask_password_paid';
        pendingLink.set(tgUserId, pend);
        try { await bot.sendMessage(chatId, '🔑 Mot de passe utilisé lors du paiement :'); } catch {}
        return;
      }
      if (pend.step === 'ask_password_paid') {
        pendingLink.delete(tgUserId);
        try {
          const paymentExt = require('./payment-ext');
          const targetUser = await dbAcc.getUserByTelegramId(tgUserId);
          if (!targetUser) { await bot.sendMessage(chatId, '❌ Aucun compte Baccarat Pro lié. Tapez /start pour vous inscrire ou vous connecter.'); return; }
          const check = await paymentExt.checkPaymentCredentials(pend.paidUsername, text);
          if (!check.ok) {
            const msg = check.reason === 'not_configured' ? '⚠️ La vérification des paiements n\'est pas encore configurée. Contactez l\'administrateur.'
              : check.reason === 'not_found' ? '❌ Aucun paiement trouvé pour cet identifiant.'
              : check.reason === 'bad_password' ? '❌ Mot de passe incorrect.'
              : '❌ Vérification impossible pour le moment, réessayez plus tard.';
            await bot.sendMessage(chatId, msg);
            return;
          }
          const results = await paymentExt.creditRowsForUser(check.rows, targetUser);
          const lines = results.map(r => {
            const date = r.paid_at ? new Date(r.paid_at).toLocaleString('fr-FR') : '—';
            const badge = r.status === 'granted_now' ? '✅ activé maintenant' : r.status === 'already_processed' ? '☑️ déjà activé' : r.status === 'thanked' ? '🙏 merci pour votre soutien' : '⏳ en attente de vérification admin';
            return `• ${r.purpose || 'Paiement'} — ${r.amount} — ${date} (réf: ${r.reference})\n  ${badge}`;
          });
          const refreshedUser = await dbAcc.getUser(targetUser.id);
          await bot.sendMessage(chatId,
            `📊 <b>Bilan de votre compte</b>\n\n${lines.join('\n\n')}\n\n${fmtExpiry(refreshedUser)}`,
            { parse_mode: 'HTML' }
          );
        } catch (e) { try { await bot.sendMessage(chatId, `❌ Erreur: ${e.message}`); } catch {} }
        return;
      }
      if (pend.step === 'ask_password_register') {
        pendingLink.delete(tgUserId);
        try {
          const hash = await bcrypt.hash(text, 10);
          const user = await dbAcc.createUser({ username: pend.username, password_hash: hash, plain_password: text, is_approved: false });
          await dbAcc.linkTelegramId(user.id, tgUserId);
          await bot.sendMessage(chatId,
            `✅ Compte <b>${pend.username}</b> créé et lié à ce Telegram !\n\n⏳ En attente d'approbation par l'administrateur pour accéder aux prédictions.`,
            { parse_mode: 'HTML' }
          );
          try {
            let adminId = (await dbAcc.getSetting('bot_admin_tg_id') || '').trim();
            if (adminId) await bot.sendMessage(adminId, `🆕 Nouvelle inscription : <b>${pend.username}</b> (via bot) — /approve ${user.id}`, { parse_mode: 'HTML' });
          } catch {}
        } catch (e) {
          const dup = /taken|unique|duplicate/i.test(e.message || '');
          try { await bot.sendMessage(chatId, dup ? '❌ Ce nom d\'utilisateur est déjà pris. Tapez /start pour réessayer.' : `❌ Erreur: ${e.message}`); } catch {}
        }
        return;
      }
    }

    // ── Commandes admin ─────────────────────────────────────────────────────
    if (text.startsWith('/')) {
      const isAdmin = await isAdminSender(tgUserId);
      const adminCmds = ['/adminhelp', '/pending', '/approve', '/extend', '/users', '/setpaymentdb', '/setpaymentcols', '/setpurpose', '/delpurpose', '/purposes', '/paymentcheck', '/export'];
      const cmdWord = text.split(/\s+/)[0];
      if (adminCmds.includes(cmdWord)) {
        if (!isAdmin) {
          try { await bot.sendMessage(chatId, '⛔ Accès refusé. Cette commande est réservée à l\'administrateur.'); } catch {}
          return;
        }
        await handleAdminCommand(cmdWord, text, chatId);
        return;
      }
      if (isAdmin && cmdWord === '/import') {
        await handleImportCommand(text, chatId);
        return;
      }
    }
  });

  // Callback boutons S'inscrire / J'ai déjà un compte
  bot.on('callback_query', async (query) => {
    const data = query.data || '';
    if (!data.startsWith('acc:')) return;
    const tgUserId = String(query.from.id);
    if (tgUserId !== ADMIN_TG_ID) return; // non-admin: silently ignore
    const chatId   = String(query.message?.chat?.id || query.from.id);
    try { await bot.answerCallbackQuery(query.id); } catch {}
    if (data === 'acc:register') {
      pendingLink.set(tgUserId, { step: 'ask_username_register' });
      try { await bot.sendMessage(chatId, '📝 Choisissez un nom d\'utilisateur :'); } catch {}
    } else if (data === 'acc:login') {
      pendingLink.set(tgUserId, { step: 'ask_username_login' });
      try { await bot.sendMessage(chatId, '🔑 Votre identifiant (nom d\'utilisateur ou e-mail) :'); } catch {}
    } else if (data === 'acc:paid') {
      pendingLink.set(tgUserId, { step: 'ask_username_paid' });
      try { await bot.sendMessage(chatId, '💳 Identifiant utilisé lors du paiement :'); } catch {}
    }
  });

  async function handleAdminCommand(cmdWord, text, chatId) {
    const paymentExt = require('./payment-ext');
    const parts = text.split(/\s+/).slice(1);
    try {
      if (cmdWord === '/adminhelp') {
        await bot.sendMessage(chatId,
`🛠 <b>Commandes admin</b>

<b>Utilisateurs</b>
/pending — comptes en attente d'approbation
/approve &lt;id&gt; — approuver un compte
/extend &lt;id&gt; &lt;minutes&gt; [libellé] — ajouter de la durée d'abonnement
/users [page] — liste des utilisateurs

<b>Paiements externes</b>
/setpaymentdb &lt;url_postgres&gt; — connecter la base de paiement externe
/setpaymentcols &lt;table&gt; &lt;col_user&gt; &lt;col_pass&gt; &lt;col_ref&gt; &lt;col_montant&gt; &lt;col_date&gt; &lt;col_motif&gt;
/setpurpose &lt;mot-clé&gt; &lt;duration|strategy|support&gt; &lt;valeur&gt; [libellé] — associer un motif de paiement à un crédit
/delpurpose &lt;mot-clé&gt; — supprimer une règle
/purposes — voir les règles configurées
/paymentcheck — forcer une vérification immédiate (auto, par nom d'utilisateur)

<b>Config / Stratégies</b>
/export — exporter stratégies + configuration (fichier JSON)
/import (répondre à un fichier .json avec /import en légende) — importer

<b>Format live</b>
/setformat &lt;N&gt; — format global
/setmaxr &lt;N&gt; — max rattrapage global`,
          { parse_mode: 'HTML' }
        );
        return;
      }

      if (cmdWord === '/pending') {
        const all = await dbAcc.getAllUsers();
        const pending = all.filter(u => !u.is_approved);
        if (pending.length === 0) { await bot.sendMessage(chatId, '✅ Aucun compte en attente.'); return; }
        const lines = pending.slice(0, 30).map(u => `#${u.id} — ${u.username}${u.telegram_id ? ' (via bot)' : ''}`);
        await bot.sendMessage(chatId, `⏳ <b>Comptes en attente</b> (${pending.length}) :\n\n${lines.join('\n')}\n\nApprouvez avec /approve <id>`, { parse_mode: 'HTML' });
        return;
      }

      if (cmdWord === '/approve') {
        const id = parseInt(parts[0]);
        if (!id) { await bot.sendMessage(chatId, 'Usage: /approve <id>'); return; }
        const user = await dbAcc.getUser(id);
        if (!user) { await bot.sendMessage(chatId, `❌ Utilisateur #${id} introuvable.`); return; }
        await dbAcc.updateUser(id, { is_approved: true });
        await bot.sendMessage(chatId, `✅ ${user.username} approuvé.`);
        if (user.telegram_id) { try { await bot.sendMessage(user.telegram_id, '✅ Votre compte a été approuvé par l\'administrateur !'); } catch {} }
        return;
      }

      if (cmdWord === '/extend') {
        const id = parseInt(parts[0]);
        const minutes = parseInt(parts[1]);
        const label = parts.slice(2).join(' ') || `${minutes} min`;
        if (!id || !minutes) { await bot.sendMessage(chatId, 'Usage: /extend <id> <minutes> [libellé]'); return; }
        const user = await dbAcc.getUser(id);
        if (!user) { await bot.sendMessage(chatId, `❌ Utilisateur #${id} introuvable.`); return; }
        const { doApprovePayment } = require('./payment-route');
        await doApprovePayment({ id: null, plan_label: label, duration_minutes: minutes }, user, { approvedBy: 'admin_bot' });
        await bot.sendMessage(chatId, `✅ +${minutes} min accordées à ${user.username}.`);
        return;
      }

      if (cmdWord === '/users') {
        const page = Math.max(1, parseInt(parts[0]) || 1);
        const all = await dbAcc.getAllUsers();
        const perPage = 15;
        const slice = all.slice((page - 1) * perPage, page * perPage);
        if (slice.length === 0) { await bot.sendMessage(chatId, 'Aucun utilisateur sur cette page.'); return; }
        const lines = slice.map(u => `#${u.id} ${u.username} — ${u.is_approved ? '✅' : '⏳'} — ${fmtExpiry(u)}`);
        await bot.sendMessage(chatId, `👥 <b>Utilisateurs</b> (page ${page}/${Math.ceil(all.length / perPage)}) :\n\n${lines.join('\n')}`, { parse_mode: 'HTML' });
        return;
      }

      if (cmdWord === '/setpaymentdb') {
        const url = parts.join(' ');
        if (!url) { await bot.sendMessage(chatId, 'Usage: /setpaymentdb <url_postgres>'); return; }
        await dbAcc.setSetting('payment_ext_db_url', url);
        await bot.sendMessage(chatId, '✅ Base de paiement externe configurée.');
        return;
      }

      if (cmdWord === '/setpaymentcols') {
        const [table, username, password, ref, amount, paidAt, purpose] = parts;
        if (!table || !username || !ref || !amount) { await bot.sendMessage(chatId, 'Usage: /setpaymentcols <table> <col_user> <col_pass> <col_ref> <col_montant> <col_date> <col_motif>'); return; }
        const cols = await paymentExt.setColumns({ table, username, password: password || 'password', reference: ref, amount, paidAt: paidAt || 'paid_at', purpose: purpose || 'purpose' });
        await bot.sendMessage(chatId, `✅ Colonnes configurées : ${JSON.stringify(cols)}`);
        return;
      }

      if (cmdWord === '/setpurpose') {
        const [keyword, type, value, ...labelParts] = parts;
        if (!keyword || !type || value === undefined) { await bot.sendMessage(chatId, 'Usage: /setpurpose <mot-clé> <duration|strategy|support> <valeur> [libellé]\nEx: /setpurpose "abonnement mensuel" duration 43200 "Abonnement mensuel"'); return; }
        if (!['duration', 'strategy', 'support'].includes(type)) { await bot.sendMessage(chatId, '❌ Type invalide. Utilisez duration, strategy ou support.'); return; }
        await paymentExt.setPurpose(keyword, type, value, labelParts.join(' '));
        await bot.sendMessage(chatId, `✅ Motif "${keyword}" → ${type} (${value}).`);
        return;
      }

      if (cmdWord === '/delpurpose') {
        const keyword = parts.join(' ');
        if (!keyword) { await bot.sendMessage(chatId, 'Usage: /delpurpose <mot-clé>'); return; }
        await paymentExt.removePurpose(keyword);
        await bot.sendMessage(chatId, `✅ Motif "${keyword}" supprimé.`);
        return;
      }

      if (cmdWord === '/purposes') {
        const purposes = await paymentExt.getPurposes();
        if (purposes.length === 0) { await bot.sendMessage(chatId, 'Aucun motif configuré. Utilisez /setpurpose.'); return; }
        const lines = purposes.map(p => `"${p.match}" → ${p.type}${p.value !== null ? ` (${p.value})` : ''} — ${p.label}`);
        await bot.sendMessage(chatId, `📋 <b>Motifs configurés</b> :\n\n${lines.join('\n')}`, { parse_mode: 'HTML' });
        return;
      }

      if (cmdWord === '/paymentcheck') {
        await bot.sendMessage(chatId, '🔄 Vérification en cours...');
        const result = await paymentExt.pollAndCredit();
        await bot.sendMessage(chatId, `✅ ${result.checked || 0} ligne(s) vérifiée(s), ${result.granted || 0} crédité(s).${result.error ? `\n⚠️ ${result.error}` : ''}${result.note ? `\nℹ️ ${result.note}` : ''}`);
        return;
      }

      if (cmdWord === '/export') {
        const strategies = await dbAcc.getSetting('custom_strategies');
        const routing     = await dbAcc.getSetting('strategy_routes');
        const payload = {
          exported_at: new Date().toISOString(),
          custom_strategies: strategies ? JSON.parse(strategies) : [],
          strategy_routes: routing ? JSON.parse(routing) : null,
          bot_admin_tg_id: await dbAcc.getSetting('bot_admin_tg_id'),
          payment_ext_purposes: await paymentExt.getPurposes(),
          payment_ext_columns: await paymentExt.getColumns(),
        };
        const buf = Buffer.from(JSON.stringify(payload, null, 2));
        await bot.sendDocument(chatId, buf, {}, { filename: `baccarat-pro-export-${Date.now()}.json`, contentType: 'application/json' });
        return;
      }
    } catch (e) {
      try { await bot.sendMessage(chatId, `❌ Erreur: ${e.message}`); } catch {}
    }
  }

  async function handleImportCommand(text, chatId) {
    try {
      const jsonStr = text.slice('/import'.length).trim();
      if (!jsonStr) { await bot.sendMessage(chatId, 'ℹ️ Usage : envoyez /import suivi du JSON exporté (ou collez-le après la commande).'); return; }
      const payload = JSON.parse(jsonStr);
      if (Array.isArray(payload.custom_strategies)) {
        await dbAcc.setSetting('custom_strategies', JSON.stringify(payload.custom_strategies));
        try { require('./engine').reloadCustomStrategies(payload.custom_strategies); } catch {}
      }
      if (payload.strategy_routes) await dbAcc.setSetting('strategy_routes', JSON.stringify(payload.strategy_routes));
      if (Array.isArray(payload.payment_ext_purposes)) await dbAcc.setSetting('payment_ext_purposes', JSON.stringify(payload.payment_ext_purposes));
      if (payload.payment_ext_columns) await dbAcc.setSetting('payment_ext_columns', JSON.stringify(payload.payment_ext_columns));
      await bot.sendMessage(chatId, '✅ Import terminé.');
    } catch (e) {
      await bot.sendMessage(chatId, `❌ JSON invalide: ${e.message}`);
    }
  }

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
    if (userId !== ADMIN_TG_ID) return; // non-admin : silently ignore
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

    // ── Restriction bot : seul l'administrateur peut utiliser ces commandes ─
    if (userId !== ADMIN_TG_ID) return;

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
      // Accepte ADMIN_TG_ID (1190237801) OU le bot_admin_tg_id configuré en DB
      let adminId = '';
      try { adminId = (await db.getSetting('bot_admin_tg_id') || '').trim(); } catch {}
      const isAdminCmd = (userId === ADMIN_TG_ID) || (!!adminId && userId === adminId);
      if (!isAdminCmd) {
        try { await bot.sendMessage(chatId, '⛔ Accès refusé. ID admin: ' + ADMIN_TG_ID); } catch {}
        return;
      }

      // /setformat [S<id>] <N>  — change le format global ou par stratégie
      if (text.startsWith('/setformat')) {
        const parts = text.split(/\s+/).slice(1);
        // Cas: /setformat S5 3  (stratégie S5, format 3)
        if (parts.length >= 2 && /^[sS]\d+$/.test(parts[0])) {
          const stratId = parseInt(parts[0].slice(1));
          const fmtId   = Math.max(1, Math.min(97, parseInt(parts[1]) || 1));
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
          const fmtId = Math.max(1, Math.min(97, parseInt(parts[0]) || 1));
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
              const fmtId = Math.max(1, Math.min(97, parseInt(b.data?.format_id) || 1));
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

// ── Formats Telegram (1-97) — fichier dédié tg-formats.js ────────────────
const {
  SUIT_EMOJI_MAP, SUIT_NAME_FR, SUPERSCRIPT, RATR_EMOJI,
  SUIT_EMOJI, SUIT_NAME,
  getSuitEmoji, getSuitName,
  renderCustomTemplate, formatCardsToEmojis,
  buildTgMessage, buildPredictionMsg, buildResultMsg,
} = require('./tg-formats');

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
