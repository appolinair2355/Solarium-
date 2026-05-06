'use strict';
/**
 * zip-generator.js — Génère le ZIP de déploiement pour une stratégie achetée.
 * Inclut un système de vérification de licence qui contacte le serveur maître.
 * Retourne un Buffer contenant le ZIP.
 *
 * @param {object} strat      - Configuration de la strategie
 * @param {string} licenseKey - Cle UUID unique generee a la validation de l'achat
 * @param {string} serverUrl  - URL du serveur maitre pour la verification de licence
 * @param {object} botConfig  - { channel_id, bot_token, format_id } config pré-remplie (optionnel)
 */

const archiver        = require('archiver');
const { PassThrough } = require('stream');

// ── Format du message Telegram selon format_id ──────────────────────────────
function buildFormatMessage(stratName, suit, stepNum, formatId) {
  const fid  = parseInt(formatId) || 1;
  const emoji = suit === 'P' ? '🔵' : '🔴';
  const label = suit === 'P' ? 'JOUEUR' : 'BANQUIER';
  const arrow = suit === 'P' ? '▶' : '◀';

  switch (fid) {
    case 1:  return `🎯 <b>Прогноз</b> — Шаг ${stepNum}\n${emoji} Ставьте на <b>${label}</b>\n📌 Стратегия: ${stratName}`;
    case 2:  return `💎 <b>SIGNAL PREMIUM</b>\n${emoji} → <b>${label}</b>\n⚡ Étape ${stepNum} · ${stratName}`;
    case 3:  return `🃏 <b>BACCARA PRO</b>\n${arrow} ${label} (Étape ${stepNum})\n🧠 ${stratName}`;
    case 4:  return `📊 PRÉDICTION #${stepNum}\n${emoji} <b>${label}</b>\n${stratName}`;
    case 5:  return `${'█'.repeat(stepNum > 5 ? 5 : stepNum)}${'░'.repeat(5 - (stepNum > 5 ? 5 : stepNum))} Étape ${stepNum}\n${emoji} <b>${label}</b> — ${stratName}`;
    case 6:  return `[${stepNum}] ${emoji} ${label} | ${stratName}`;
    case 7:  return `🃏 Carte joueur — Étape ${stepNum}\n${emoji} Misez sur <b>${label}</b>\n${stratName}`;
    case 8:  return `⚡ <b>SIGNAL</b> ${emoji}\n${label} — Étape ${stepNum}\n${stratName}`;
    case 9:  return `🔵 <b>JOUEUR</b>\n━━━━━━━━━━━━━\nÉtape ${stepNum} · ${stratName}`;
    case 10: return `🔴 <b>BANQUIER</b>\n━━━━━━━━━━━━━\nÉtape ${stepNum} · ${stratName}`;
    case 11: return `📊 Distribution — Étape ${stepNum}\n${emoji} <b>${label}</b>\n${stratName}`;
    case 12: return `🃏 Cartes 2/3 | Étape ${stepNum}\n${emoji} <b>${label}</b> — ${stratName}`;
    case 13: return `🏆 Victoire Pro\n${emoji} <b>${label}</b> · Étape ${stepNum}\n${stratName}`;
    case 14: return `🏆 ${emoji} ${label} [${stepNum}] — ${stratName}`;
    case 15: return `🤝 Match Nul Pro · Étape ${stepNum}\n${emoji} ${label} — ${stratName}`;
    case 16: return `🤝 ${emoji} ${label} [${stepNum}]`;
    case 17: return `⚡ 2+3 Cartes Pro\n${emoji} <b>${label}</b> — Étape ${stepNum}\n${stratName}`;
    case 18: return `🃏 Style B · ${emoji} <b>${label}</b>\nÉtape ${stepNum} — ${stratName}`;
    case 19: return `🎯 VIP Casino\n${emoji} <b>${label}</b>\nÉtape ${stepNum} · ${stratName}`;
    case 20: return `⚡ FLASH ${emoji} ${label} | Ét.${stepNum} — ${stratName}`;
    case 21: return `🃏 Casino Royale\n${emoji} <b>${label}</b>\nÉtape ${stepNum} · ${stratName}`;
    case 22: return `🔔 Signal Pro\n${emoji} <b>${label}</b> · Ét.${stepNum}\n${stratName}`;
    case 23: return `🚨 ALERT PRO\n${emoji} <b>${label}</b>\nÉtape ${stepNum} · ${stratName}`;
    case 24: return `★ ${emoji} ${label} · [${stepNum}] — ${stratName}`;
    case 25: return `🏅 Scoreboard\n${emoji} <b>${label}</b>\nÉtape ${stepNum} · ${stratName}`;
    case 26: return `◼️ DARK PRESTIGE\n${emoji} ${label}\nÉtape ${stepNum} · ${stratName}`;
    case 27: return `🎯 ${emoji} ${label} [${stepNum}]`;
    case 28: return `💎 Diamant\n${emoji} <b>${label}</b> — Étape ${stepNum}\n${stratName}`;
    case 29: return `🟣 NEON PRO\n${emoji} <b>${label}</b>\nÉtape ${stepNum} · ${stratName}`;
    case 30: return `🔥 FEU SIGNAL\n${emoji} <b>${label}</b> · Ét.${stepNum}\n${stratName}`;
    case 31: return `⚜ Russian Enhanced\n${emoji} <b>${label}</b>\nÉtape ${stepNum} · ${stratName}`;
    case 32: return `🎯 ${emoji} ${label}\nÉtape ${stepNum} — ${stratName}`;
    case 33: return `🥇 TROPHÉE PRO\n${emoji} <b>${label}</b> · Étape ${stepNum}\n${stratName}`;
    case 34: return `⚛️ ATOMIQUE\n${emoji} <b>${label}</b> — Étape ${stepNum}\n${stratName}`;
    case 35: return `✨ GOLD VIP\n${emoji} <b>${label}</b>\nÉtape ${stepNum} · ${stratName}`;
    case 36: return `👑 COURONNE ROYAL\n${emoji} <b>${label}</b> · Étape ${stepNum}\n${stratName}`;
    case 37: return `🎖️ MILITAIRE\n${emoji} <b>${label}</b>\nÉtape ${stepNum} — ${stratName}`;
    case 38: return `⚙ TECH HACKER\n${emoji} <b>${label}</b> [${stepNum}]\n${stratName}`;
    case 39: return `🐉 DRAGON\n${emoji} <b>${label}</b> · Ét.${stepNum}\n${stratName}`;
    case 40: return `🌹 LUXE\n${emoji} <b>${label}</b> — Étape ${stepNum}\n${stratName}`;
    case 41: return `🔫 BULLET ${emoji} ${label} [${stepNum}]`;
    case 42: return `⟨⟩ CYBER 2077\n${emoji} <b>${label}</b> · Ét.${stepNum}\n${stratName}`;
    case 43: return `🌙 LUNE MYSTIQUE\n${emoji} <b>${label}</b>\nÉtape ${stepNum} · ${stratName}`;
    case 44: return `░ MATRIX ${emoji} ${label} [${stepNum}] — ${stratName}`;
    case 45: return `👑 ROI ABSOLU\n${emoji} <b>${label}</b> · Étape ${stepNum}\n${stratName}`;
    case 46: return `🎰 STREET BET ${emoji} ${label} [${stepNum}]`;
    case 47: return `🌟 ULTIMATE PRO\n${emoji} <b>${label}</b>\nÉtape ${stepNum} · ${stratName}`;
    case 48: return `📊 ANALYSE PRO\n${emoji} <b>${label}</b> — Étape ${stepNum}\n${stratName}`;
    case 49: return `➤ ${emoji} <b>${label}</b> [${stepNum}] — ${stratName}`;
    case 50: return `⭐ STAR CASINO\n${emoji} <b>${label}</b> · Étape ${stepNum}\n${stratName}`;
    case 51: return `〰️ ${emoji} ${label} · Ét.${stepNum} — ${stratName}`;
    case 52: return `🏦 DOUBLE LINE\n${emoji} <b>${label}</b>\nÉtape ${stepNum} · ${stratName}`;
    case 53: return `💎 ${emoji} ${label} [${stepNum}]`;
    case 54: return `🚀 FUSÉE FUTUR\n${emoji} <b>${label}</b> — Étape ${stepNum}\n${stratName}`;
    case 55: return `🌊 CASCADE PRO\n${emoji} <b>${label}</b> · Étape ${stepNum}\n${stratName}`;
    default: return `🎯 <b>PRÉDICTION</b> — Étape ${stepNum}\n${emoji} Misez sur <b>${label}</b>\n${stratName}`;
  }
}

function buildConfigJs(strat, botConfig = {}) {
  const stratJson = JSON.stringify(strat, null, 2);
  const channelId = botConfig.channel_id || '';
  const botToken  = botConfig.bot_token  || '';
  const formatId  = parseInt(botConfig.format_id) || 1;
  const isConfigured = !!(channelId && botToken);

  return [
    '// ═══════════════════════════════════════════════════════════════════',
    '// CONFIGURATION — Baccarat Bot S' + strat.id + ' — ' + (strat.name || 'Stratégie'),
    isConfigured
      ? '// ✅ Configuration pré-remplie — aucune modification nécessaire'
      : '// ⚠️  Éditez ce fichier avant de déployer',
    '// ═══════════════════════════════════════════════════════════════════',
    'module.exports = {',
    isConfigured
      ? `  BOT_TOKEN:  '${botToken}',`
      : "  BOT_TOKEN:  'VOTRE_TOKEN_TELEGRAM_ICI',   // @BotFather -> /newbot",
    isConfigured
      ? `  CHANNEL_ID: '${channelId}',`
      : "  CHANNEL_ID: 'VOTRE_CHANNEL_ID_ICI',        // ex: -1001234567890 ou @moncanal",
    `  FORMAT_ID:  ${formatId},                      // Format du message Telegram (1-55)`,
    '  PORT:       process.env.PORT || 3000,',
    '  // Ne pas modifier :',
    '  STRATEGY:   ' + stratJson + ',',
    '};',
  ].join('\n');
}

function buildPredictorJs(strat) {
  const stratName = strat.name || ('Strategie S' + strat.id);
  const stratMode = strat.mode || 'lecture_passee';
  const stratB    = strat.B || 5;

  return [
    "'use strict';",
    '/**',
    ' * predictor.js — Moteur de prédiction Baccarat',
    ' * Strategie : ' + stratName + ' (mode: ' + stratMode + ')',
    ' * Seuil B = ' + stratB,
    ' */',
    '',
    "const cfg = require('./config');",
    'const S   = cfg.STRATEGY;',
    '',
    'let state = {',
    "  history:    [],",
    '  streak:     0,',
    '  maxAll:     0,',
    '  maxPeriod:  0,',
    '  predicting: false,',
    '  step:       0,',
    '  pending:    null,',
    '};',
    '',
    'function reset() {',
    '  state.predicting = false;',
    '  state.step       = 0;',
    '  state.pending    = null;',
    '}',
    '',
    'function calcB() {',
    '  const { maxAll, maxPeriod } = state;',
    '  return Math.max(1, Math.ceil((maxAll + 3 + maxPeriod) / 3));',
    '}',
    '',
    'function suitWinner(suit) {',
    '  if (!suit) return null;',
    "  suit = suit.toUpperCase();",
    "  if (['\u2660','S','SPADES'].includes(suit))   return 'P';",
    "  if (['\u2663','C','CLUBS'].includes(suit))    return 'B';",
    "  if (['\u2665','H','HEARTS'].includes(suit))   return 'P';",
    "  if (['\u2666','D','DIAMONDS'].includes(suit)) return 'B';",
    '  return null;',
    '}',
    '',
    'function evalCategory(cat, entry) {',
    '  const { winner, ps, bs, np, nb } = entry;',
    '  if (!cat) return false;',
    '  switch (cat) {',
    "    case 'parite_pair': { const w = winner==='P'?ps:winner==='B'?bs:null; return w!==null && w%2===0; }",
    "    case 'parite_imp':  { const w = winner==='P'?ps:winner==='B'?bs:null; return w!==null && w%2===1; }",
    "    case 'pt_p_pair':   return ps !== null && ps % 2 === 0;",
    "    case 'pt_p_imp':    return ps !== null && ps % 2 === 1;",
    "    case 'pt_b_pair':   return bs !== null && bs % 2 === 0;",
    "    case 'pt_b_imp':    return bs !== null && bs % 2 === 1;",
    "    case 'pt_p_high':   return ps !== null && ps >= 7;",
    "    case 'pt_p_low':    return ps !== null && ps <= 4;",
    "    case 'pt_b_high':   return bs !== null && bs >= 7;",
    "    case 'pt_b_low':    return bs !== null && bs <= 4;",
    "    case 'nbk_p2':      return np === 2;",
    "    case 'nbk_p3':      return np === 3;",
    "    case 'nbk_b2':      return nb === 2;",
    "    case 'nbk_b3':      return nb === 3;",
    "    case 'dist_2_2':    return np === 2 && nb === 2;",
    "    case 'dist_2_3':    return np === 2 && nb === 3;",
    "    case 'dist_3_2':    return np === 3 && nb === 2;",
    "    case 'dist_3_3':    return np === 3 && nb === 3;",
    '    default: return false;',
    '  }',
    '}',
    '',
    'function processGame(game) {',
    '  const { winner, player_score: ps, banker_score: bs, player_cards: pc, banker_cards: bc } = game;',
    '  const np = pc ? pc.length : null;',
    '  const nb = bc ? bc.length : null;',
    '  const entry = { winner, ps, bs, np, nb };',
    '  state.history.push(entry);',
    '  if (state.history.length > 500) state.history.shift();',
    '',
    '  let targetHit = false;',
    "  if (S.mode === 'lecture_passee' || S.mode === 'intersection') {",
    '    const tw = suitWinner(S.suit);',
    '    targetHit = (winner === tw);',
    "  } else if (S.mode === 'comptages_ecart') {",
    '    targetHit = evalCategory(S.category, entry);',
    "  } else if (S.mode === 'compteur_adverse') {",
    '    const tw = suitWinner(S.suit);',
    "    targetHit = (winner !== tw && winner !== 'T');",
    '  } else {',
    '    const tw = suitWinner(S.suit);',
    '    if (tw) targetHit = (winner === tw);',
    '  }',
    '',
    '  if (targetHit) {',
    '    state.streak++;',
    '    state.maxAll    = Math.max(state.maxAll, state.streak);',
    '    state.maxPeriod = Math.max(state.maxPeriod, state.streak);',
    '  } else {',
    '    state.streak = 0;',
    '  }',
    '',
    '  if (state.predicting) {',
    '    state.step++;',
    '    const result = { suit: state.pending, hand: "joueur", stepNum: state.step };',
    '    const maxStep = S.B || calcB();',
    '    if (!targetHit || state.step >= maxStep) reset();',
    '    return result;',
    '  }',
    '',
    "  const B = S.mode === 'comptages_ecart' ? calcB() : (S.B || " + stratB + ');',
    '  if (!targetHit && state.streak >= B) {',
    "    const predSuit = S.suit || 'P';",
    '    state.predicting = true;',
    '    state.step       = 1;',
    '    state.pending    = predSuit;',
    '    return { suit: predSuit, hand: "joueur", stepNum: 1, B };',
    '  }',
    '  return null;',
    '}',
    '',
    'module.exports = { processGame, reset, getState: () => Object.assign({}, state) };',
  ].join('\n');
}

function buildIndexJs(strat, licenseKey, serverUrl, botConfig = {}) {
  const stratName  = strat.name || ('Strategie S' + strat.id);
  const formatId   = parseInt(botConfig.format_id) || 1;

  return [
    "'use strict';",
    '/**',
    ' * index.js — Serveur API Baccarat Bot',
    ' * Strategie : ' + stratName,
    ' * POST /game { winner, player_score, banker_score, player_cards, banker_cards }',
    ' */',
    '',
    "const express   = require('express');",
    'const app       = express();',
    "const fetch     = (...args) => import('node-fetch').then(m => m.default(...args));",
    "const cfg       = require('./config');",
    "const predictor = require('./predictor');",
    '',
    '// ── Verification de licence ──────────────────────────────────────────',
    "const LICENSE_KEY    = '" + licenseKey + "';",
    "const LICENSE_SERVER = '" + serverUrl + "';",
    "const FORMAT_ID      = cfg.FORMAT_ID || " + formatId + ';',
    "const STRAT_NAME     = '" + stratName.replace(/'/g, "\\'") + "';",
    '',
    'let _licenseValid    = true;',
    'let _firstLicenseOk  = false;',
    '',
    'async function checkLicense() {',
    '  try {',
    "    const r = await fetch(LICENSE_SERVER + '/api/license/check?key=' + LICENSE_KEY);",
    '    const d = await r.json();',
    '    if (!d.valid) {',
    '      _licenseValid = false;',
    "      console.error('');",
    "      console.error('============================================');",
    "      console.error('  LICENCE INVALIDE OU REVOQUEE');",
    "      console.error('  ' + (d.message || ''));",
    "      console.error('  Les predictions sont arretees.');",
    "      console.error('  Le bot va s\\'arreter dans 30 secondes.');",
    "      console.error('============================================');",
    "      console.error('');",
    '      // Notifier le canal puis arreter',
    "      await sendTelegram('\\u26d4 <b>BOT DESACTIVE</b>\\n\\nLa licence de ce bot a ete revoquee par l\\'administrateur.\\nLes predictions sont arretees.\\nContactez le support.').catch(() => {});",
    '      setTimeout(() => process.exit(1), 30000);',
    '      return false;',
    '    }',
    '    _licenseValid = true;',
    "    console.log('[LICENCE] Licence active — ' + (d.strategy || STRAT_NAME));",
    '    if (!_firstLicenseOk) {',
    '      _firstLicenseOk = true;',
    '      sendWelcomeMessage().catch(() => {});',
    '    }',
    '    return true;',
    '  } catch (e) {',
    "    console.warn('[LICENCE] Verification ignoree (serveur injoignable):', e.message);",
    '    return true;',
    '  }',
    '}',
    '',
    'app.use(express.json());',
    '',
    'async function sendTelegram(text) {',
    "  const url = 'https://api.telegram.org/bot' + cfg.BOT_TOKEN + '/sendMessage';",
    '  try {',
    '    const r = await fetch(url, {',
    "      method:  'POST',",
    "      headers: { 'Content-Type': 'application/json' },",
    "      body:    JSON.stringify({ chat_id: cfg.CHANNEL_ID, text, parse_mode: 'HTML' }),",
    '    });',
    '    const json = await r.json();',
    "    if (!json.ok) console.error('[Telegram]', json.description);",
    '    return json;',
    '  } catch (e) {',
    "    console.error('[Telegram] Erreur reseau:', e.message);",
    '  }',
    '}',
    '',
    '// ── Message de prédiction formaté ────────────────────────────────────',
    'function buildPredMessage(suit, stepNum) {',
    "  const emoji = suit === 'P' ? '\uD83D\uDD35' : '\uD83D\uDD34';",
    "  const label = suit === 'P' ? 'JOUEUR' : 'BANQUIER';",
    "  const arrow = suit === 'P' ? '\u25B6' : '\u25C0';",
    '  const fid   = FORMAT_ID;',
    '  switch (fid) {',
    "    case 1:  return '\uD83C\uDFAF <b>\u041F\u0440\u043E\u0433\u043D\u043E\u0437</b> \u2014 \u0428\u0430\u0433 ' + stepNum + '\\n' + emoji + ' \u0421\u0442\u0430\u0432\u044C\u0442\u0435 \u043D\u0430 <b>' + label + '</b>\\n\uD83D\uDCCC \u0421\u0442\u0440\u0430\u0442\u0435\u0433\u0438\u044F: ' + STRAT_NAME;",
    "    case 2:  return '\uD83D\uDC8E <b>SIGNAL PREMIUM</b>\\n' + emoji + ' \u2192 <b>' + label + '</b>\\n\u26A1 \u00C9tape ' + stepNum + ' \u00B7 ' + STRAT_NAME;",
    "    case 9:  return '\uD83D\uDD35 <b>JOUEUR</b>\\n\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\\n\u00C9tape ' + stepNum + ' \u00B7 ' + STRAT_NAME;",
    "    case 10: return '\uD83D\uDD34 <b>BANQUIER</b>\\n\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\\n\u00C9tape ' + stepNum + ' \u00B7 ' + STRAT_NAME;",
    "    case 19: return '\uD83C\uDFAF VIP Casino\\n' + emoji + ' <b>' + label + '</b>\\n\u00C9tape ' + stepNum + ' \u00B7 ' + STRAT_NAME;",
    "    case 35: return '\u2728 GOLD VIP\\n' + emoji + ' <b>' + label + '</b>\\n\u00C9tape ' + stepNum + ' \u00B7 ' + STRAT_NAME;",
    "    case 36: return '\uD83D\uDC51 COURONNE ROYAL\\n' + emoji + ' <b>' + label + '</b> \u00B7 \u00C9tape ' + stepNum + '\\n' + STRAT_NAME;",
    "    default: return '\uD83C\uDFAF <b>PR\u00C9DICTION</b> \u2014 \u00C9tape ' + stepNum + '\\n' + emoji + ' Misez sur <b>' + label + '</b>\\n\uD83E\uDDE0 Strat\u00E9gie : ' + STRAT_NAME;",
    '  }',
    '}',
    '',
    '// ── Message de bienvenue (envoyé au 1er démarrage) ───────────────────',
    'async function sendWelcomeMessage() {',
    "  const msg = '\uD83C\uDF89 <b>Bienvenue !</b>\\n\\n' +",
    "              '\uD83C\uDFC6 Strat\u00E9gie <b>' + STRAT_NAME + '</b> activ\u00E9e avec succ\u00E8s.\\n\\n' +",
    "              '\u2705 <b>Sossou Kouam\u00E9</b> vous remercie pour votre achat.\\n' +",
    "              '\uD83D\uDCDE Nous sommes disponibles pour vous.';",
    '  await sendTelegram(msg);',
    '}',
    '',
    "app.get('/', (req, res) => res.json({ status: 'ok', strategy: '" + stratName.replace(/'/g, "\\'") + "', license: _licenseValid }));",
    '',
    "app.post('/game', (req, res) => {",
    '  if (!_licenseValid) return res.status(403).json({ error: \'Licence revoquee — bot desactive\' });',
    '  const { winner, player_score, banker_score, player_cards, banker_cards } = req.body;',
    "  if (!winner) return res.status(400).json({ error: 'winner requis (P|B|T)' });",
    '  const pred = predictor.processGame({',
    '    winner,',
    '    player_score: player_score != null ? player_score : null,',
    '    banker_score: banker_score != null ? banker_score : null,',
    '    player_cards: player_cards || null,',
    '    banker_cards: banker_cards || null,',
    '  });',
    '  if (pred) {',
    '    const message = buildPredMessage(pred.suit, pred.stepNum);',
    '    sendTelegram(message);',
    '    return res.json({ prediction: pred, message_sent: true });',
    '  }',
    '  res.json({ prediction: null });',
    '});',
    '',
    "app.post('/reset', (req, res) => { predictor.reset(); res.json({ ok: true }); });",
    "app.get('/state', (req, res) => res.json({ ...predictor.getState(), licenseValid: _licenseValid }));",
    '',
    '// ── Démarrage avec vérification de licence ───────────────────────────',
    'checkLicense().then(ok => {',
    '  if (!ok) return;',
    '  app.listen(cfg.PORT, () => {',
    "    console.log('');",
    "    console.log('╔══════════════════════════════════════════╗');",
    "    console.log('║   Baccarat Bot — " + stratName.replace(/'/g, "\\'").padEnd(22) + " ║');",
    "    console.log('║   Port : ' + cfg.PORT + '                              ║');",
    "    console.log('║   Canal : ' + (cfg.CHANNEL_ID || '').slice(0,20) + '          ║');",
    "    console.log('║   Format : #' + FORMAT_ID + '                            ║');",
    "    console.log('╚══════════════════════════════════════════╝');",
    "    console.log('');",
    '  });',
    '  // Re-verification automatique toutes les heures',
    '  setInterval(checkLicense, 60 * 60 * 1000);',
    '});',
  ].join('\n');
}

function buildPackageJson(strat) {
  return JSON.stringify({
    name:        'baccarat-bot-s' + strat.id,
    version:     '1.0.0',
    description: 'Bot de prediction Baccarat — ' + (strat.name || ('Strategie S' + strat.id)),
    main:        'index.js',
    scripts:     { start: 'node index.js' },
    engines:     { node: '>=18' },
    dependencies: {
      express:      '^4.18.2',
      'node-fetch': '^3.3.2',
    },
  }, null, 2);
}

function buildReadme(strat, botConfig = {}) {
  const stratName   = strat.name || ('Strategie S' + strat.id);
  const stratMode   = strat.mode || 'lecture_passee';
  const isConfigured = !!(botConfig.channel_id && botConfig.bot_token);

  return [
    '# Baccarat Bot — ' + stratName,
    '',
    '## Description',
    'Bot de prediction Baccarat automatique base sur la strategie **' + stratName + '** (mode: ' + stratMode + ').',
    '',
    isConfigured ? '## ✅ Configuration pre-remplie' : '## Configuration',
    '',
    isConfigured
      ? '> Ce fichier ZIP a ete genere avec votre configuration. **Aucune modification necessaire.**\n> Installez simplement les dependances et demarrez.'
      : 'Editez **`config.js`** et remplacez :\n\n| Champ | Description |\n|-------|-------------|\n| `BOT_TOKEN` | Token Telegram de votre bot (@BotFather -> /newbot) |\n| `CHANNEL_ID` | ID du canal Telegram (ex: -1001234567890 ou @moncanal) |',
    '',
    '## Installation',
    '',
    '```bash',
    'npm install',
    '```',
    '',
    '## Demarrage',
    '',
    '```bash',
    'npm start',
    '```',
    '',
    '## Endpoints',
    '',
    '| Route | Methode | Description |',
    '|-------|---------|-------------|',
    '| `/` | GET | Healthcheck + état licence |',
    '| `/game` | POST | Soumettre un resultat |',
    '| `/reset` | POST | Reinitialiser le moteur |',
    '| `/state` | GET | Etat interne + licence |',
    '',
    '## Deploiement',
    '',
    'Compatible : Render, Railway, Heroku, Fly.io, VPS Linux, Replit',
    '',
    '## Licence',
    '',
    '> Ce bot est protege par une cle de licence unique.',
    '> Toute revocation par l\'administrateur arretera automatiquement le bot.',
    '',
    '---',
    '*Strategie S' + strat.id + ' — ' + stratName + ' | Genere par Baccarat Pro — Sossou Kouame*',
  ].join('\n');
}

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
    archive.append(buildConfigJs(strat, botConfig),                      { name: folder + 'config.js' });
    archive.append(buildPredictorJs(strat),                              { name: folder + 'predictor.js' });
    archive.append(buildIndexJs(strat, licenseKey, serverUrl, botConfig),{ name: folder + 'index.js' });
    archive.append(buildPackageJson(strat),                              { name: folder + 'package.json' });
    archive.append(buildReadme(strat, botConfig),                        { name: folder + 'README.md' });
    archive.finalize();
  });
}

module.exports = { generateStrategyZip };
