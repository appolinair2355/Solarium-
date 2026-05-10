'use strict';
/**
 * zip-generator.js — Génère le ZIP de déploiement pour une stratégie achetée.
 *
 * SÉCURITÉ RENFORCÉE :
 *   - Aucune logique de stratégie dans le ZIP (ni dans predictor.js, ni ailleurs).
 *   - Le bot se connecte au serveur maître pour récupérer les prédictions déjà calculées.
 *   - Si la licence est révoquée → le bot s'arrête à la prochaine vérification horaire.
 *   - La clé de licence est la seule identité du bot dans le ZIP.
 */

const archiver        = require('archiver');
const { PassThrough } = require('stream');

// ─────────────────────────────────────────────────────────────────────────────
// config.js
// ─────────────────────────────────────────────────────────────────────────────
function buildConfigJs(botConfig = {}) {
  const channelId   = botConfig.channel_id    || '';
  const botToken    = botConfig.bot_token      || '';
  const formatId    = parseInt(botConfig.format_id) || 1;
  const adminChatId = botConfig.admin_chat_id  || '';
  const configured  = !!(channelId && botToken);

  return `// ═══════════════════════════════════════════════════════════════════
// CONFIGURATION — Baccarat Bot
// ${configured ? '✅ Pré-configuré — aucune modification nécessaire' : '⚠️  Remplissez les champs avant de déployer'}
// ═══════════════════════════════════════════════════════════════════
module.exports = {
  BOT_TOKEN:     ${configured ? `'${botToken}'` : "'VOTRE_TOKEN_TELEGRAM_ICI'"},
  CHANNEL_ID:    ${configured ? `'${channelId}'` : "'VOTRE_CHANNEL_ID_ICI'"},
  FORMAT_ID:     ${formatId},
  ADMIN_CHAT_ID: '${adminChatId}',
};
`;
}

// ─────────────────────────────────────────────────────────────────────────────
// index.js — bot slim, prédictions reçues du serveur (aucune logique locale)
// ─────────────────────────────────────────────────────────────────────────────
function buildIndexJs(licenseKey, serverUrl, botConfig = {}) {
  const formatId  = parseInt(botConfig.format_id) || 1;
  const channelId = botConfig.channel_id || '';

  return `'use strict';
/**
 * index.js — Bot Baccarat autonome
 * ─ Reçoit les prédictions directement du serveur maître (aucune logique de stratégie ici)
 * ─ Enregistre silencieusement le bot au 1er démarrage
 * ─ Poll les nouvelles prédictions toutes les 5 s
 * ─ Envoie sur le canal Telegram avec le format configuré (75 formats)
 * ─ Vérifie la licence toutes les heures
 * ─ Port HTTP automatique via process.env.PORT (Render, Railway, Fly.io…)
 */

const http  = require('http');
const fetch = require('node-fetch');
const cfg   = require('./config');

const LICENSE_KEY    = '${licenseKey}';
const LICENSE_SERVER = '${serverUrl}';
const PORT           = parseInt(process.env.PORT || 3000, 10);
let   FORMAT_ID      = cfg.FORMAT_ID || ${formatId};
const CHANNEL_ID     = cfg.CHANNEL_ID || '${channelId}';
const BOT_TOKEN      = cfg.BOT_TOKEN;
let   ADMIN_CHAT_ID  = cfg.ADMIN_CHAT_ID || null;

let _lastPredId    = 0;
let _lastResultId  = 0;
let _resultsReady  = false; // premier appel = sync silencieux (évite flood au démarrage)
let _pollOffset    = 0;
let _licenseOk     = true;
let _predCount     = 0;
let _startTime     = Date.now();
let _botInfo       = null; // {id, username}

// ── Costumes ──────────────────────────────────────────────────────────────────
const SUIT_LABEL = {
  '\\u2660': 'PIQUE',
  '\\u2665': 'C\\u0152UR',
  '\\u2666': 'CARREAU',
  '\\u2663': 'TR\\u00C8FLE',
};
const SUIT_EMOJI = {
  '\\u2660': '\\u2660\\uFE0F',
  '\\u2665': '\\u2665\\uFE0F',
  '\\u2666': '\\u2666\\uFE0F',
  '\\u2663': '\\u2663\\uFE0F',
};

// ── HTTP healthcheck (requis par Render, Railway, Fly.io…) ───────────────────
const _server = http.createServer((req, res) => {
  const up = Math.floor((Date.now() - _startTime) / 1000);
  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({
    status:           'ok',
    uptime_seconds:   up,
    predictions_sent: _predCount,
    bot:              _botInfo ? ('@' + _botInfo.username) : 'connecting...',
    license:          LICENSE_KEY.slice(0, 8) + '...',
  }));
});
_server.listen(PORT, () => console.log('[SERVER] ✅ Port ' + PORT + ' ouvert'));

// ── Telegram API ──────────────────────────────────────────────────────────────
async function tgPost(method, body) {
  if (!BOT_TOKEN) return null;
  try {
    const r = await fetch('https://api.telegram.org/bot' + BOT_TOKEN + '/' + method, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body), timeout: 15000,
    });
    const d = await r.json();
    if (!d.ok) console.warn('[TG]', method, ':', d.description);
    return d;
  } catch (e) { console.error('[TG] Réseau:', e.message); return null; }
}
async function sendChannel(text, pm) {
  const b = { chat_id: CHANNEL_ID, text };
  if (pm) b.parse_mode = pm;
  return tgPost('sendMessage', b);
}
async function sendChat(chatId, text) {
  return tgPost('sendMessage', { chat_id: chatId, text });
}

// ── 75 formats de message ─────────────────────────────────────────────────────
function buildMessage(suit, stepNum, gameNumber, maxR) {
  const n = gameNumber || 0;
  const mr = Math.max(1, parseInt(maxR) || 1);
  const rp = stepNum > 0 ? '\\uD83D\\uDD04 R' + stepNum + '/' + mr + '\\n' : '';
  const label = SUIT_LABEL[suit] || suit;
  const emoji = SUIT_EMOJI[suit] || '\\uD83C\\uDFAF';
  const r = _buildRaw(n, label, emoji);
  r.text = rp + r.text
    .replace(/\\+1(?!\\d)/g, '+' + mr)
    .replace(/\\xD71/g, '\\xD7' + mr)
    .replace(/RETRY_1/g, 'RETRY_' + mr)
    .replace(/MAX_RETRY: 1/g, 'MAX_RETRY: ' + mr)
    .replace(/: 1 tentative/g, ': ' + mr + ' tentative')
    .replace(/Max 1 retour/g, 'Max ' + mr + ' retour')
    .replace(/: 1\\(/g, ': ' + mr + '(');
  return r;
}
function _buildRaw(n, label, emoji) {
  switch (parseInt(FORMAT_ID) || 1) {
    case 1:  return { text: '\\u26DC #' + n + ' \\u0418\\u0433\\u0440\\u043E\\u043A +1 \\u26DC\\n\\u25FD\\u041C\\u0430\\u0441\\u0442\\u044C ' + emoji + '\\n\\u25FC\\uFE0F ' + label, pm: null };
    case 2:  return { text: '\\uD83C\\uDFB2 BACCARA PREMIUM+1 \\u2728\\uD83C\\uDFB2\\n\\u00C9tape ' + n + ' :' + emoji + '\\n' + label, pm: null };
    case 3:  return { text: 'BACCARA PRO \\u2728\\n\\uD83C\\uDFAE\\u00C9tape: ' + n + '\\n\\uD83C\\uDCA3Carte ' + emoji + ' : ' + label + '\\nMode: Dogon', pm: null };
    case 4:  return { text: '\\uD83C\\uDFB0 PR\\u00C9DICTION \\u00C9tape ' + n + '\\n\\uD83C\\uDFAF Couleur: ' + emoji + ' ' + label + '\\n\\uD83D\\uDCCA Statut: En cours \\u23F3', pm: null };
    case 5:  return { text: '\\uD83C\\uDFB0 BACCARAT \\u00C9tape ' + n + '\\n\\uD83C\\uDFAF Signal: ' + emoji + ' ' + label, pm: null };
    case 6:  return { text: '\\uD83C\\uDFC6 *\\u00C9tape ' + n + '*\\n\\uD83C\\uDFAF Couleur: ' + emoji + ' ' + label + '\\n\\u23F3 En cours', pm: 'Markdown' };
    case 7:  return { text: '<b>\\u00C9tape ' + n + '</b> \\u2014 <b><i>Le joueur</i></b> mise sur <b>' + label + '</b> ' + emoji + '\\n\\n\\u23F3 <i>En attente du r\\u00E9sultat...</i>', pm: 'HTML' };
    case 8:  return { text: '\\uD83E\\uDD16 joueur \\u00C9tape ' + n + '\\n\\uD83D\\uDD30Couleur : ' + emoji + '\\n\\uD83D\\uDD30 Dogon : +1\\n\\uD83E\\uDDE8 ' + label, pm: null };
    case 9:  return { text: '\\uD83E\\uDD16 joueur \\u00C9tape ' + n + '\\n\\uD83D\\uDD30Couleur de la carte :' + emoji + '\\n\\uD83D\\uDD30 Rattrapages : 1(\\uD83D\\uDD30+1)\\n\\uD83E\\uDDE8 ' + label, pm: null };
    case 10: return { text: '\\uD83C\\uDFAE banquier \\u00C9tape ' + n + '\\n\\u26DC\\uFE0F Couleur:' + emoji + '\\n\\uD83C\\uDFB0 Poursuite \\uD83D\\uDD30+1 jeux\\n\\uD83D\\uDDE3\\uFE0F ' + label, pm: null };
    case 11: return { text: '\\uD83C\\uDCA3 LE JEU VA SE TERMINER \\u00C9tape ' + n + '\\n\\uD83D\\uDCCC Signal: ' + emoji + ' ' + label + '\\n\\u2501\\u2501\\u2501\\u2501\\u2501\\u2501\\u2501\\u2501\\u2501\\u2501\\n\\u23F3 V\\u00E9rification en cours...', pm: null };
    case 12: return { text: emoji + ' PR\\u00C9DICTION \\u00C9tape ' + n + '\\n\\uD83D\\uDCCC ' + label + '\\n\\u2501\\u2501\\u2501\\u2501\\u2501\\u2501\\u2501\\u2501\\u2501\\u2501\\n\\u23F3 En cours de v\\u00E9rification...', pm: null };
    case 13: return { text: '\\uD83C\\uDFC6 PR\\u00C9DICTION VICTOIRE\\n\\uD83D\\uDCCC \\u00C9tape ' + n + '\\n\\u2501\\u2501\\u2501\\u2501\\u2501\\u2501\\u2501\\u2501\\u2501\\u2501\\n\\uD83C\\uDFAF ' + emoji + ' ' + label + ' va gagner\\n\\uD83D\\uDD30 Rattrapage : +1\\n\\u23F3 En cours...', pm: null };
    case 14: return { text: emoji + ' ' + label + ' gagne \\u00C9tape ' + n + '   +1\\n\\u23F3', pm: null };
    case 15: return { text: '\\uD83E\\uDD1D PR\\u00C9DICTION \\u00C9tape ' + n + '\\n\\uD83D\\uDCCC Signal: ' + emoji + ' ' + label + '\\n\\uD83D\\uDD30 Rattrapage : +1\\n\\u23F3 En cours de v\\u00E9rification...', pm: null };
    case 16: return { text: emoji + ' ' + label + ' \\u00B7 \\u00C9tape ' + n + ' \\u00B7 +1\\n\\u23F3', pm: null };
    case 17: return { text: '\\u26A1 PR\\u00C9DICTION 2+3 CARTES \\u00C9tape ' + n + '\\n\\uD83D\\uDCCC ' + emoji + ' ' + label + '\\n\\uD83D\\uDD30 Rattrapage : +1\\n\\u23F3 En cours de v\\u00E9rification...', pm: null };
    case 18: return { text: emoji + ' ' + label.toUpperCase() + '\\n\\u300A \\u00C9tape ' + n + ' \\u300B\\u300A +1 \\u300B\\n\\u23F3 V\\u00E9rification...', pm: null };
    case 19: return { text: '\\u256C\\u2550\\u2550\\u2550\\u2550\\u2550\\u2550\\u2550\\u2550\\u2550\\u2550\\u2550\\u2550\\u2550\\u2550\\u2550\\u2550\\u2563\\n\\uD83C\\uDFAF \\u00C9tape ' + n + ' \\u2014 ' + emoji + ' ' + label + '\\n\\uD83D\\uDD30 Rattrapage max : +1\\n\\u2559\\u2550\\u2550\\u2550\\u2550\\u2550\\u2550\\u2550\\u2550\\u2550\\u2550\\u2550\\u2550\\u2550\\u2550\\u2550\\u2550\\u255C\\n\\u23F3', pm: null };
    case 20: return { text: '\\u26A1 \\u00C9tape ' + n + ' ' + emoji + ' +1 \\u23F3', pm: null };
    case 21: return { text: '\\uD83C\\uDCA3 CASINO ROYALE \\u2014 \\u00C9tape ' + n + '\\n\\u2501\\u2501\\u2501\\u2501\\u2501\\u2501\\u2501\\u2501\\u2501\\u2501\\n\\uD83C\\uDFAF Signe : ' + emoji + ' ' + label + '\\n\\uD83C\\uDFC5 Dogon max : +1\\n\\uD83D\\uDD2E \\u23F3', pm: null };
    case 22: return { text: '\\uD83D\\uDD14 SIGNAL BACCARA PRO\\n\\uD83C\\uDFAF Signe : ' + emoji + ' ' + label + '\\n\\uD83D\\uDCCC \\u00C9tape ' + n + ' \\u00B7 +1\\n\\u27A4 \\u23F3', pm: null };
    case 23: return { text: '\\uD83D\\uDEA8 ALERTE PR\\u00C9DICTION\\n\\uD83D\\uDCCD \\u00C9tape ' + n + '\\n\\uD83C\\uDCA3 Costume : ' + emoji + ' ' + label + '\\n\\uD83D\\uDD01 Max dogon : +1\\n\\uD83D\\uDCCA \\u23F3', pm: null };
    case 24: return { text: '\\u2605 \\u00C9tape ' + n + ' \\u00B7 ' + emoji + ' ' + label + ' \\u00B7 +1\\n\\u23F3', pm: null };
    case 25: return { text: '\\uD83C\\uDFC5 BACCARAT SCOREBOARD\\n\\u250C\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2510\\n\\u2502 \\u00C9tape ' + n + ' \\u2502 ' + emoji + ' ' + label + ' \\u2502 +1 \\u2502\\n\\u2514\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2518\\n\\u23F3', pm: null };
    case 26: return { text: '\\u25FC\\uFE0F\\u25FC\\uFE0F\\u25FC\\uFE0F BACCARAT DARK \\u25FC\\uFE0F\\u25FC\\uFE0F\\u25FC\\uFE0F\\n\\u25FD \\u00C9tape ' + n + '  \\u25FD ' + emoji + ' ' + label + '  \\u25FD +1\\n\\u25FC\\uFE0F \\u23F3', pm: null };
    case 27: return { text: '\\uD83C\\uDFAF \\u00C9tape ' + n + ' \\u00B7 ' + emoji + ' \\u00B7 \\xD71\\n\\u23F3', pm: null };
    case 28: return { text: '\\uD83D\\uDC8E PR\\u00C9DICTION DIAMANT\\n\\u25C6 \\u00C9tape ' + n + ' \\u2014 ' + emoji + ' ' + label + '\\n\\u25C6 Dogon : +1\\n\\u25C7 \\u23F3', pm: null };
    case 29: return { text: '\\uD83D\\uDFE3 NEON BACCARAT \\uD83D\\uDFE3\\n\\uD83D\\uDD38 \\u00C9tape ' + n + ' | ' + emoji + ' ' + label + ' | +1\\n\\uD83D\\uDD39 \\u23F3', pm: null };
    case 30: return { text: '\\uD83D\\uDD25 SIGNAL \\u00C9tape ' + n + '\\n\\uD83C\\uDF1F ' + emoji + ' ' + label.toUpperCase() + '\\n\\u26A1 Dogon +1\\n\\u23F3', pm: null };
    case 31: return { text: '\\u26DC \\u00C9tape ' + n + ' \\u0418\\u0433\\u0440\\u043E\\u043A +1 \\u26DC\\n\\u25FD \\u041C\\u0430\\u0441\\u0442\\u044C ' + emoji + ' ' + label + '\\n\\u25FC\\uFE0F \\u0421\\u0442\\u0430\\u0432\\u043A\\u0430: \\u0418\\u0433\\u0440\\u043E\\u043A\\n\\u25FC\\uFE0F \\u0420\\u0435\\u0437\\u0443\\u043B\\u044C\\u0442\\u0430\\u0442: \\u23F3', pm: null };
    case 32: return { text: emoji + ' \\u00C9tape ' + n + ' +1\\n\\u23F3', pm: null };
    case 33: return { text: '\\uD83E\\uDD47 BACCARAT TROPH\\u00C9E\\n\\uD83D\\uDCCC \\u00C9tape ' + n + ' | ' + emoji + ' ' + label + ' | \\uD83D\\uDD30+1\\n\\u2501\\u2501\\u2501\\u2501\\u2501\\u2501\\u2501\\n\\uD83C\\uDFC6 \\u23F3', pm: null };
    case 34: return { text: '\\u269B\\uFE0F ATOMIC SIGNAL\\n\\u26A1 \\u00C9tape ' + n + ' \\u2014 ' + emoji + ' ' + label + ' \\u2014 Dogon\\xD71\\n\\u2192 \\u23F3', pm: null };
    case 35: return { text: '\\u2728 GOLD TIP \\u2728\\n\\u2501\\u2501\\u2501\\u2501\\u2501\\u2501\\u2501\\u2501\\u2501\\u2501\\u2501\\u2501\\u2501\\u2501\\u2501\\n\\uD83C\\uDFAF \\u00C9tape ' + n + '  ' + emoji + ' ' + label + '  +1\\n\\u2501\\u2501\\u2501\\u2501\\u2501\\u2501\\u2501\\u2501\\u2501\\u2501\\u2501\\u2501\\u2501\\u2501\\u2501\\n\\u23F3', pm: null };
    case 36: return { text: '\\uD83D\\uDC51 ROYAL BACCARAT\\n\\uD83C\\uDFAE \\u00C9tape ' + n + '\\n\\uD83C\\uDCA3 Signe : ' + emoji + ' ' + label + '\\n\\uD83D\\uDD11 Cl\\u00E9 : +1\\n\\u23F3', pm: null };
    case 37: return { text: '\\uD83C\\uDF96\\uFE0F OP\\u00C9RATION BACCARAT\\n\\uD83D\\uDD35 Mission \\u00C9tape ' + n + ' \\u2014 CIBLE : ' + emoji + ' ' + label.toUpperCase() + '\\n\\u2694\\uFE0F Dogon max : 1 tentative\\n\\uD83D\\uDCE1 \\u23F3', pm: null };
    case 38: return { text: '> BACCARAT.EXE \\u2014 RUN\\n> STEP: ' + n + '\\n> TARGET: ' + emoji + ' ' + label.toUpperCase() + '\\n> MAX_RETRY: 1\\n> STATUS: \\u23F3', pm: null };
    case 39: return { text: '\\uD83D\\uDC09 DRAGON BACCARAT\\n\\uD83D\\uDD25 \\u00C9tape ' + n + ' \\u00B7 ' + emoji + ' ' + label + ' \\u00B7 \\xD71\\n\\u26A1 \\u23F3', pm: null };
    case 40: return { text: '\\uD83C\\uDF39 LUXE BACCARA \\uD83C\\uDF39\\n\\uD83C\\uDFB1 \\u00C9tape ' + n + '  \\u00B7  ' + emoji + ' ' + label + '  \\u00B7  Dogon +1\\n\\uD83D\\uDCA0 R\\u00E9sultat \\u2192 \\u23F3', pm: null };
    case 41: return { text: '\\uD83D\\uDD2B \\u00C9tape ' + n + '|' + emoji + '|+1|\\u23F3', pm: null };
    case 42: return { text: '\\u27E8\\u27E8 CYBER_BACCARAT \\u27E9\\u27E9\\n\\u2699 STEP_' + n + ' :: ' + emoji + label.toUpperCase() + ' :: RETRY_1\\n\\u2295 \\u23F3', pm: null };
    case 43: return { text: '\\uD83C\\uDF19 MYSTIQUE BACCARAT\\n\\u2728 \\u00C9tape ' + n + ' \\u2014 ' + emoji + ' ' + label + '\\n\\uD83C\\uDF1F Puissance : \\xD71\\n\\uD83D\\uDD2E \\u23F3', pm: null };
    case 44: return { text: '\\u2591\\u2591\\u2591 MATRIX BACCARAT \\u2591\\u2591\\u2591\\n\\u2593 \\u00C9tape ' + n + ' \\u2593 ' + emoji + ' ' + label + ' \\u2593 +1 \\u2593\\n\\u2592 \\u23F3', pm: null };
    case 45: return { text: '\\uD83D\\uDC51 JOUEUR ROI\\n\\u2501\\u2501\\u2501\\u2501\\u2501\\u2501\\u2501\\u2501\\u2501\\u2501\\u2501\\u2501\\u2501\\u2501\\u2501\\u2501\\u2501\\u2501\\u2501\\u2501\\n\\uD83C\\uDFAF \\u00C9tape ' + n + ' \\u2192 ' + emoji + ' ' + label.toUpperCase() + '\\n\\uD83D\\uDD30 Protection : +1 coup\\n\\u2501\\u2501\\u2501\\u2501\\u2501\\u2501\\u2501\\u2501\\u2501\\u2501\\u2501\\u2501\\u2501\\u2501\\u2501\\u2501\\u2501\\u2501\\u2501\\u2501\\n\\u23F3', pm: null };
    case 46: return { text: '\\uD83C\\uDFB0 STREET BET \\u00C9tape ' + n + '\\n\\uD83D\\uDCB5 Mise sur ' + emoji + ' ' + label + ' | Max 1 retour\\n\\u23F3', pm: null };
    case 47: return { text: '\\uD83C\\uDF1F \\u2550\\u2550\\u2550 ULTIMATE BACCARAT \\u2550\\u2550\\u2550 \\uD83C\\uDF1F\\n\\uD83D\\uDCCD \\u00C9tape ' + n + '\\n\\uD83C\\uDFAF Camp : ' + label + '\\n\\uD83C\\uDCA3 Signe : ' + emoji + ' ' + label.toUpperCase() + '\\n\\uD83D\\uDD30 Dogon max : +1\\n\\u2501\\u2501\\u2501\\u2501\\u2501\\u2501\\u2501\\u2501\\u2501\\u2501\\u2501\\u2501\\u2501\\u2501\\u2501\\u2501\\u2501\\u2501\\n\\u23F3', pm: null };
    case 48: return { text: '\\uD83D\\uDCCA ANALYSE PR\\u00C9DICTIVE\\n\\uD83D\\uDD22 \\u00C9tape : ' + n + '\\n\\uD83D\\uDCC8 Signal : ' + emoji + ' ' + label + '\\n\\uD83D\\uDD01 Fen\\u00EAtre : 1 jeu\\n\\uD83D\\uDCCB R\\u00E9sultat : \\u23F3', pm: null };
    case 49: return { text: '\\u27A4 \\u00C9tape ' + n + ' ' + emoji + ' ' + label + ' (+1) \\u2192 \\u23F3', pm: null };
    case 50: return { text: '\\u2B50\\u2B50\\u2B50 STAR CASINO \\u2B50\\u2B50\\u2B50\\n\\uD83C\\uDFB0 \\u00C9tape ' + n + '\\n\\uD83C\\uDFAF Signal : ' + emoji + ' ' + label + '\\n\\uD83D\\uDD30 Dogon : +1\\n\\u2728 \\u23F3', pm: null };
    case 51: return { text: '\\u3030\\uFE0F \\u00C9tape ' + n + '\\n' + emoji + ' \\u00B7 +1\\n\\u23F3', pm: null };
    case 52: return { text: '\\u00C9tape ' + n + ' \\u2014 ' + emoji + ' ' + label + '\\n+1 \\u00B7 \\u23F3', pm: null };
    case 53: return { text: '\\uD83D\\uDC8E \\u00C9tape ' + n + ' ' + emoji + ' +1 \\u23F3', pm: null };
    case 54: return { text: '\\uD83D\\uDE80 FUTUR BACCARAT \\u2014 \\u00C9tape ' + n + '\\n\\uD83D\\uDEF8 Signal : ' + emoji + ' ' + label.toUpperCase() + '\\n\\u26A1 Puissance : \\xD71\\n\\uD83C\\uDF0C \\u23F3', pm: null };
    case 55: return { text: '\\uD83C\\uDF0A CASCADE BACCARAT\\n\\u23E9 \\u00C9tape ' + n + '\\n\\u23E9 ' + label + ' \\u2014 ' + emoji + '\\n\\u23E9 Dogon \\xD71\\n\\u23E9 \\u23F3', pm: null };
    case 56: return { text: '\\uD83D\\uDC8E \\u2501\\u2501\\u2501\\u2501\\u2501\\u2501\\u2501\\u2501\\u2501\\u2501\\u2501\\u2501\\u2501\\u2501\\u2501\\u2501 \\uD83D\\uDC8E\\n   VIP SIGNAL #' + n + '\\n   ' + emoji + ' ' + label.toUpperCase() + '\\n   Dogon : +1\\n\\uD83D\\uDC8E \\u2501\\u2501\\u2501\\u2501\\u2501\\u2501\\u2501\\u2501\\u2501\\u2501\\u2501\\u2501\\u2501\\u2501\\u2501\\u2501 \\uD83D\\uDC8E\\n\\u23F3', pm: null };
    case 57: return { text: '\\u26A1\\u26A1 FLASH BET \\u26A1\\u26A1\\n\\uD83C\\uDFAF Jeu #' + n + '  ' + emoji + ' ' + label + '\\n\\uD83D\\uDCA5 Dogon +1\\n\\u23F3', pm: null };
    case 58: return { text: '\\uD83D\\uDD2E L\\'ORACLE A PARL\\u00C9 \\uD83D\\uDD2E\\n\\u2550\\u2550\\u2550\\u2550\\u2550\\u2550\\u2550\\u2550\\u2550\\u2550\\u2550\\u2550\\u2550\\u2550\\u2550\\u2550\\u2550\\u2550\\u2550\\n\\uD83C\\uDF1F Partie #' + n + '\\n\\u2728 ' + emoji + ' ' + label.toUpperCase() + '\\n\\uD83C\\uDF19 Retours : +1\\n\\u23F3', pm: null };
    case 59: return { text: '\\u2694\\uFE0F KATANA SIGNAL \\u2694\\uFE0F\\n\\u25AC\\u25AC\\u25AC\\u25AC\\u25AC\\u25AC\\u25AC\\u25AC\\u25AC\\u25AC\\u25AC\\u25AC\\u25AC\\u25AC\\n\\uD83C\\uDCB4 \\u00C9tape ' + n + ' | ' + emoji + ' ' + label + '\\n\\uD83D\\uDDE1\\uFE0F Relance : \\xD71\\n\\u25AC\\u25AC\\u25AC\\u25AC\\u25AC\\u25AC\\u25AC\\u25AC\\u25AC\\u25AC\\u25AC\\u25AC\\u25AC\\u25AC\\n\\u23F3', pm: null };
    case 60: return { text: '\\uD83D\\uDC7B PHANTOM SIGNAL \\uD83D\\uDC7B\\n\\u2591\\u2591\\u2591\\u2591\\u2591\\u2591\\u2591\\u2591\\u2591\\u2591\\u2591\\u2591\\u2591\\u2591\\u2591\\u2591\\u2591\\u2591\\n\\u00C9tape ' + n + ' \\u00B7 ' + emoji + ' ' + label + '\\n\\u2591 Dogon : +1 \\u2591\\n\\u23F3', pm: null };
    case 61: return { text: '\\uD83D\\uDC9A EMERALD SIGNAL \\uD83D\\uDC9A\\n\\u2504\\u2504\\u2504\\u2504\\u2504\\u2504\\u2504\\u2504\\u2504\\u2504\\u2504\\u2504\\u2504\\u2504\\u2504\\u2504\\u2504\\n\\uD83C\\uDFAF Partie : ' + n + '\\n\\uD83C\\uDF3F ' + emoji + ' ' + label + '\\n\\uD83D\\uDD0B \\u00C9nergie : +1\\n\\u23F3', pm: null };
    case 62: return { text: '\\uD83C\\uDF29\\uFE0F THUNDER BET \\uD83C\\uDF29\\uFE0F\\n\\u2501\\u2501\\u2501\\u2501\\u2501\\u2501\\u2501\\u2501\\u2501\\u2501\\u2501\\u2501\\u2501\\u2501\\u2501\\u2501\\u2501\\u2501\\n\\u26A1 \\u00C9tape ' + n + '\\n' + emoji + ' ' + label.toUpperCase() + '\\n\\u26A1 Relance : +1\\n\\u23F3', pm: null };
    case 63: return { text: '\\u2554\\u2550\\u2550\\u2550 ELITE SIGNAL \\u2550\\u2550\\u2550\\u2557\\n\\u2551 \\u00C9tape  : ' + n + '\\n\\u2551 Mise    : ' + emoji + ' ' + label + '\\n\\u2551 Dogon   : +1\\n\\u255A\\u2550\\u2550\\u2550\\u2550\\u2550\\u2550\\u2550\\u2550\\u2550\\u2550\\u2550\\u2550\\u2550\\u2550\\u2550\\u2550\\u2550\\u2550\\u255D\\n\\u23F3', pm: null };
    case 64: return { text: '\\uD83D\\uDD25\\uD83D\\uDD25 INFERNO \\uD83D\\uDD25\\uD83D\\uDD25\\n\\u2593\\u2593\\u2593\\u2593\\u2593\\u2593\\u2593\\u2593\\u2593\\u2593\\u2593\\u2593\\u2593\\u2593\\u2593\\u2593\\n\\uD83C\\uDFAF \\u00C9tape ' + n + ' \\u2014 ' + emoji + ' ' + label + '\\n\\uD83D\\uDD25 Poursuite : +1 feu\\n\\u23F3', pm: null };
    case 65: return { text: '\\u2744\\uFE0F ARCTIC SIGNAL \\u2744\\uFE0F\\n\\u2584\\u2584\\u2584\\u2584\\u2584\\u2584\\u2584\\u2584\\u2584\\u2584\\u2584\\u2584\\u2584\\u2584\\u2584\\u2584\\u2584\\n\\uD83E\\uDDE3 Jeu ' + n + ' | ' + emoji + ' ' + label + '\\n\\u2744\\uFE0F Gel : +1 cycle\\n\\u23F3', pm: null };
    case 66: return { text: '\\uD83C\\uDF0C COSMOS BACCARAT \\uD83C\\uDF0C\\n\\u2726 \\u2726 \\u2726 \\u2726 \\u2726 \\u2726 \\u2726\\n\\uD83D\\uDE80 \\u00C9tape ' + n + '\\n\\uD83D\\uDCAB ' + emoji + ' ' + label + '\\n\\uD83C\\uDF1F Dogon : +1 \\u00E9toile\\n\\u23F3', pm: null };
    case 67: return { text: '\\uD83C\\uDFC6 <b>PR\\u00C9DICTION PREMIUM</b>\\n\\u2501\\u2501\\u2501\\u2501\\u2501\\u2501\\u2501\\u2501\\u2501\\u2501\\u2501\\u2501\\u2501\\u2501\\u2501\\n\\uD83C\\uDFAF <b>\\u00C9tape #' + n + '</b>\\n' + emoji + ' <b>' + label.toUpperCase() + '</b>\\n\\uD83D\\uDD01 Dogon max : <b>+1</b>\\n\\u23F3 <i>R\\u00E9sultat en attente...</i>', pm: 'HTML' };
    case 68: return { text: '\\u265C CASINO VINTAGE \\u265C\\n\\u250C\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2510\\n\\u2502 Partie : ' + n + '\\n\\u2502 ' + emoji + ' ' + label.toUpperCase() + '\\n\\u2502 Dogon  : +1\\n\\u2514\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2500\\u2518\\n\\u23F3', pm: null };
    case 69: return { text: '\\uD83D\\uDC93 PULSE SIGNAL \\uD83D\\uDC93\\n\\u2764\\uFE0F Rythme #' + n + '\\n\\uD83D\\uDCCC ' + emoji + ' ' + label + '\\n\\uD83E\\uDE7A Max retour : +1\\n\\u23F3', pm: null };
    case 70: return { text: '\\u2694\\uFE0F BLADE \\u25B8 \\u00C9tape ' + n + '\\n' + emoji + ' ' + label + ' \\u25B8 +1\\n\\u2501\\u2501\\u2501\\u2501\\u2501\\u2501\\u2501\\u2501\\u2501\\u2501\\u2501\\u2501\\u2501\\u2501\\u2501\\u2501\\u2501\\u2501\\n\\u23F3', pm: null };
    case 71: return { text: '\\u267E\\uFE0F ZODIAC BACCARAT \\u267E\\uFE0F\\n\\uD83C\\uDF19 Signe : ' + emoji + ' ' + label + '\\n\\uD83D\\uDD2E \\u00C9tape : ' + n + '\\n\\u2728 Puissance : +1\\n\\u23F3', pm: null };
    case 72: return { text: '\\u26E9\\uFE0F TEMPLE SIGNAL \\u26E9\\uFE0F\\n\\uD83D\\uDD31 Partie : ' + n + '\\n\\uD83C\\uDF3F ' + emoji + ' ' + label + '\\n\\u2734 Retour : +1 fois\\n\\u23F3', pm: null };
    case 73: return { text: '\\uD83D\\uDFE3\\u2501\\u2501\\u2501\\u2501\\u2501\\u2501\\u2501\\u2501\\u2501\\u2501\\u2501\\u2501\\u2501\\u2501\\u2501\\u2501\\uD83D\\uDFE3\\n NEON ULTRA #' + n + '\\n ' + emoji + ' ' + label.toUpperCase() + ' \\u00B7 +1\\n\\uD83D\\uDFE3\\u2501\\u2501\\u2501\\u2501\\u2501\\u2501\\u2501\\u2501\\u2501\\u2501\\u2501\\u2501\\u2501\\u2501\\u2501\\u2501\\uD83D\\uDFE3\\n\\u23F3', pm: null };
    case 74: return { text: '\\uD83D\\uDC51 \\u2550\\u2550\\u2550 CROWN BET \\u2550\\u2550\\u2550 \\uD83D\\uDC51\\n\\uD83C\\uDFC6 \\u00C9tape #' + n + '\\n' + emoji + ' ' + label + '\\n\\uD83D\\uDD11 Dogon : +1\\n\\u23F3', pm: null };
    case 75: return { text: '\\uD83D\\uDCE1 SIGMA SIGNAL \\uD83D\\uDCE1\\n\\u254C\\u254C\\u254C\\u254C\\u254C\\u254C\\u254C\\u254C\\u254C\\u254C\\u254C\\u254C\\u254C\\u254C\\u254C\\u254C\\u254C\\n\\u00C9tape ' + n + ' \\u00B7 ' + emoji + ' ' + label + '\\nDogon \\u00B7\\u00B7 +1\\n\\u254C\\u254C\\u254C\\u254C\\u254C\\u254C\\u254C\\u254C\\u254C\\u254C\\u254C\\u254C\\u254C\\u254C\\u254C\\u254C\\u254C\\n\\u23F3', pm: null };
    default: return { text: '\\uD83C\\uDFAF PR\\u00C9DICTION \\u00C9tape ' + n + '\\n' + emoji + ' <b>' + label + '</b>', pm: 'HTML' };
  }
}

// ── Enregistrement silencieux du bot au démarrage ─────────────────────────────
async function registerBot() {
  try {
    const me = await tgPost('getMe', {});
    if (me && me.ok && me.result) {
      _botInfo = { id: me.result.id, username: me.result.username };
      await fetch(LICENSE_SERVER + '/api/license/register?key=' + LICENSE_KEY, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ bot_id: String(me.result.id), bot_api_token: BOT_TOKEN, bot_username: me.result.username }),
        timeout: 12000,
      }).catch(() => {});
      console.log('[BOT] ✅ Connecté — @' + me.result.username + ' (ID: ' + me.result.id + ')');
    }
  } catch (e) {
    console.warn('[BOT] Connexion différée:', e.message);
  }
}

// ── Vérification de licence ───────────────────────────────────────────────────
async function checkLicense() {
  try {
    const r = await fetch(LICENSE_SERVER + '/api/license/check?key=' + LICENSE_KEY, { timeout: 15000 });
    const d = await r.json();
    if (!d.valid) {
      _licenseOk = false;
      console.error('[LICENCE] ' + (d.message || 'Invalide') + ' — arrêt.');
      setTimeout(() => process.exit(1), 3000);
      return false;
    }
    _licenseOk = true;
    return true;
  } catch (e) {
    console.warn('[LICENCE] Serveur injoignable (tolérance activée):', e.message);
    return true;
  }
}

// ── Poll des prédictions depuis le serveur ────────────────────────────────────
async function pollPredictions() {
  if (!_licenseOk) return;
  try {
    const r = await fetch(
      LICENSE_SERVER + '/api/license/predictions?key=' + LICENSE_KEY + '&since_id=' + _lastPredId,
      { timeout: 10000 }
    );
    const d = await r.json();
    if (!d.ok) {
      if (d.error && (d.error.includes('révoquée') || d.error.includes('revoquee') || d.error.includes('suspendue'))) {
        _licenseOk = false;
        console.error('[LICENCE] Révoquée — arrêt des prédictions');
        setTimeout(() => process.exit(1), 3000);
      }
      return;
    }
    const predsToSend = (d.predictions || []);
    for (let i = 0; i < predsToSend.length; i++) {
      const pred = predsToSend[i];
      if (pred.id > _lastPredId) _lastPredId = pred.id;
      const step    = pred.rattrapage     || 0;
      const maxR    = pred.max_rattrapage || 1;
      const gameNum = pred.game_number    || 0;
      const suit    = pred.predicted_suit || '\\u2665';
      const { text, pm } = buildMessage(suit, step, gameNum, maxR);
      if (i > 0) await new Promise(res => setTimeout(res, 1200));
      await sendChannel(text, pm);
      _predCount++;
      const stepLabel = step === 0 ? 'Initial' : ('Rattrapage R' + step + '/' + maxR);
      console.log('[PRED] #' + gameNum + ' ' + suit + ' — ' + stepLabel + ' (max +' + maxR + ')');
    }
  } catch (e) {
    console.warn('[POLL] Réseau:', e.message);
  }
}

// ── Poll des résultats (vérification victoire/défaite) ────────────────────────
async function pollResults() {
  if (!_licenseOk) return;
  try {
    const r = await fetch(
      LICENSE_SERVER + '/api/license/results?key=' + LICENSE_KEY + '&since_id=' + _lastResultId,
      { timeout: 10000 }
    );
    const d = await r.json();
    if (!d.ok) return;
    const list = d.results || [];

    // Premier appel au démarrage : sync silencieux pour ne pas inonder le canal
    if (!_resultsReady) {
      _resultsReady = true;
      if (list.length > 0) _lastResultId = Math.max(...list.map(x => x.id));
      console.log('[RES] Sync initial — ' + list.length + ' ancien(s) résultat(s) ignoré(s)');
      return;
    }

    for (let i = 0; i < list.length; i++) {
      const res   = list[i];
      if (res.id > _lastResultId) _lastResultId = res.id;
      const gn    = res.game_number || 0;
      const suit  = res.predicted_suit || '\\u2665';
      const label = SUIT_LABEL[suit]   || 'COEUR';
      const emoji = SUIT_EMOJI[suit]   || '\\uD83C\\uDFAF';
      const step  = res.rattrapage || 0;
      const won   = res.status === 'gagne';
      const icon  = won ? '\\u2705' : '\\u274C';
      const word  = won ? 'VICTOIRE' : 'RAT\\u00C9';
      const msg   = icon + ' ' + word + ' \\u2014 \\u00C9tape #' + gn + '\\n' +
                    emoji + ' ' + label +
                    (step > 0 ? ' (R' + step + ')' : '');
      if (i > 0) await new Promise(r2 => setTimeout(r2, 800));
      await sendChannel(msg, null);
      console.log('[RES] #' + gn + ' ' + res.status.toUpperCase() + (step > 0 ? ' R' + step : ''));
    }
  } catch (e) {
    console.warn('[RES] Réseau:', e.message);
  }
}

// ── Polling des commandes Telegram ────────────────────────────────────────────
async function pollCommands() {
  if (!BOT_TOKEN) return;
  try {
    const r = await fetch(
      'https://api.telegram.org/bot' + BOT_TOKEN +
      '/getUpdates?offset=' + _pollOffset + '&timeout=5&allowed_updates=' + encodeURIComponent('["message"]'),
      { timeout: 12000 }
    );
    const data = await r.json();
    if (!data.ok || !Array.isArray(data.result)) return;

    for (const update of data.result) {
      _pollOffset = update.update_id + 1;
      const msg = update.message;
      if (!msg || !msg.text) continue;

      const chatId   = msg.chat.id;
      const chatType = msg.chat.type;
      const text     = msg.text.trim();

      if (!ADMIN_CHAT_ID && chatType === 'private') {
        ADMIN_CHAT_ID = chatId;
        console.log('[CMD] Admin détecté — chat ID:', chatId);
      }

      const isAdmin = ADMIN_CHAT_ID && (chatId === ADMIN_CHAT_ID || chatId === parseInt(ADMIN_CHAT_ID));
      if (chatType === 'channel') continue;
      if (!isAdmin && chatType !== 'private') continue;

      const cmd = text.split(' ')[0].replace(/@.*$/, '').toLowerCase();

      if (cmd === '/start') {
        const up = Math.floor((Date.now() - _startTime) / 1000);
        const h = Math.floor(up / 3600), m = Math.floor((up % 3600) / 60);
        await sendChat(chatId,
          '\\uD83E\\uDD16 Bot Baccarat actif\\n\\n' +
          '\\uD83D\\uDCCA Format : #' + FORMAT_ID + '\\n' +
          '\\uD83D\\uDCE2 Canal : ' + CHANNEL_ID + '\\n' +
          '\\u2705 Licence : ' + (_licenseOk ? 'Active' : 'Invalide') + '\\n' +
          '\\u23F1 Uptime : ' + h + 'h ' + m + 'min\\n' +
          '\\uD83D\\uDCE4 Prédictions envoyées : ' + _predCount
        );
      } else if (cmd === '/status') {
        await sendChat(chatId,
          '\\uD83D\\uDCCA ÉTAT DU BOT\\n\\n' +
          '\\uD83D\\uDD17 Dernière prédiction ID : #' + _lastPredId + '\\n' +
          '\\uD83D\\uDCE4 Prédictions totales : ' + _predCount + '\\n' +
          '\\u2705 Licence : ' + (_licenseOk ? 'Active' : 'Invalide')
        );
      } else if (cmd === '/help') {
        await sendChat(chatId,
          '\\uD83D\\uDCCB COMMANDES\\n\\n' +
          '/start \\u2014 Infos du bot\\n' +
          '/status \\u2014 État du bot\\n' +
          '/setformat N \\u2014 Changer le format (1-75)\\n' +
          '/testpred \\u2014 Envoyer une prédiction test\\n' +
          '/help \\u2014 Cette aide'
        );
      } else if (cmd === '/setformat') {
        const newFmt = parseInt((text.split(/\\s+/)[1]) || '0');
        if (!newFmt || newFmt < 1 || newFmt > 75) {
          await sendChat(chatId, '\\u26A0\\uFE0F Usage : /setformat <1-75>   ex: /setformat 19');
        } else {
          FORMAT_ID = newFmt;
          await sendChat(chatId, '\\u2705 Format changé → #' + FORMAT_ID);
        }
      } else if (cmd === '/testpred') {
        if (!isAdmin) { await sendChat(chatId, '\\u26D4 Réservé à l\\'admin.'); continue; }
        const { text: t, pm } = buildMessage('\\u2660', 0, 0, 1);
        await sendChannel(t, pm);
        await sendChat(chatId, '\\u2705 Prédiction test envoyée (\\u2660 PIQUE, étape 0).');
      }
    }
  } catch (e) {
    if (!e.message.includes('timeout') && !e.message.includes('ECONNRESET'))
      console.error('[CMD] Erreur polling:', e.message);
  }
}

// ── Démarrage ─────────────────────────────────────────────────────────────────
async function main() {
  console.log('[BOT] Démarrage — connexion au serveur de prédictions...');

  const ok = await checkLicense();
  if (!ok) return;

  await registerBot();

  setInterval(pollPredictions, 5000);
  setInterval(pollResults,     7000);
  setInterval(pollCommands,    3000);
  setInterval(checkLicense,    60 * 60 * 1000);
  setTimeout(pollPredictions,  1000);
  setTimeout(pollResults,      4000);
  setTimeout(pollCommands,     2000);

  console.log('[BOT] ✅ Actif — en attente de prédictions | Format #' + FORMAT_ID + ' | Canal : ' + CHANNEL_ID);
}

main().catch(err => { console.error('[FATAL]', err.message); process.exit(1); });
`;
}

// ─────────────────────────────────────────────────────────────────────────────
// package.json
// ─────────────────────────────────────────────────────────────────────────────
function buildPackageJson(strat) {
  return JSON.stringify({
    name:        'baccarat-bot-s' + strat.id,
    version:     '1.0.0',
    description: 'Bot de prédiction Baccarat — reçoit les prédictions du serveur maître',
    main:        'index.js',
    scripts:     { start: 'node index.js' },
    engines:     { node: '>=18' },
    dependencies: { 'node-fetch': '^2.7.0' },
  }, null, 2);
}

// ─────────────────────────────────────────────────────────────────────────────
// README.md
// ─────────────────────────────────────────────────────────────────────────────
function buildReadme(strat, botConfig = {}) {
  const configured = !!(botConfig.channel_id && botConfig.bot_token);
  const formatId   = parseInt(botConfig.format_id) || 1;

  return `# Baccarat Bot — Stratégie #${strat.id}

## Description
Bot Telegram autonome connecté au serveur Baccarat Pro.
Les prédictions sont calculées par le serveur et transmises en temps réel.

${configured
  ? `## ✅ Configuration pré-remplie

> Aucune modification nécessaire.
> - Canal configuré : \`${botConfig.channel_id}\`
> - Format : #${formatId}

`
  : `## Configuration

Éditez \`config.js\` et remplissez :

| Champ | Description |
|-------|-------------|
| \`BOT_TOKEN\` | Token Telegram de votre bot (@BotFather) |
| \`CHANNEL_ID\` | ID du canal (ex: -1001234567890) |
| \`FORMAT_ID\` | Format des messages (1 à 55) |

`}
## Installation & Démarrage

\`\`\`bash
npm install
npm start
\`\`\`

## Déploiement (Render, Railway, Fly.io, VPS…)

Le bot détecte automatiquement le port via la variable \`PORT\` de l'environnement.

| Plateforme | Build | Start |
|------------|-------|-------|
| Render     | \`npm install\` | \`npm start\` |
| Railway    | \`npm install\` | \`npm start\` |
| Fly.io     | \`npm install\` | \`npm start\` |
| VPS Linux  | \`npm install\` | \`pm2 start index.js\` |

## Commandes Telegram (chat privé avec le bot)

| Commande | Description |
|----------|-------------|
| \`/start\` | Informations du bot |
| \`/status\` | État en temps réel |
| \`/setformat N\` | Changer le format (ex: \`/setformat 7\`) |
| \`/testpred\` | Envoyer une prédiction test |
| \`/help\` | Aide |

## Fonctionnement

1. Au démarrage, le bot vérifie la licence et s'enregistre silencieusement
2. Il reçoit les prédictions du serveur maître toutes les **5 secondes**
3. Chaque nouvelle prédiction est envoyée immédiatement sur le canal Telegram
4. La licence est vérifiée toutes les heures — arrêt automatique si révoquée

---
*Baccarat Prediction Pro — Licence protégée*
`;
}

// ─────────────────────────────────────────────────────────────────────────────
// Génération du ZIP
// ─────────────────────────────────────────────────────────────────────────────
async function generateStrategyZip(strat, licenseKey, serverUrl, botConfig = {}) {
  return new Promise((resolve, reject) => {
    const archive = archiver('zip', { zlib: { level: 9 } });
    const chunks  = [];
    const pt      = new PassThrough();
    pt.on('data',  c => chunks.push(c));
    pt.on('end',   () => resolve(Buffer.concat(chunks)));
    pt.on('error', reject);
    archive.pipe(pt);

    const folder = 'baccarat-bot-S' + strat.id + '/';
    archive.append(buildConfigJs(botConfig),                       { name: folder + 'config.js' });
    archive.append(buildIndexJs(licenseKey, serverUrl, botConfig), { name: folder + 'index.js' });
    archive.append(buildPackageJson(strat),                        { name: folder + 'package.json' });
    archive.append(buildReadme(strat, botConfig),                  { name: folder + 'README.md' });
    archive.finalize();
  });
}

module.exports = { generateStrategyZip };
