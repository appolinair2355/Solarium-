'use strict';
/**
 * zip-generator.js — Génère le ZIP de déploiement pour une stratégie achetée.
 * Inclut un système de vérification de licence qui contacte le serveur maître.
 * Retourne un Buffer contenant le ZIP.
 */

const archiver     = require('archiver');
const { PassThrough } = require('stream');

function buildConfigJs(strat) {
  const stratJson = JSON.stringify(strat, null, 2);
  return [
    '// ═══════════════════════════════════════════════════════════════════',
    '// CONFIGURATION — Baccarat Bot S' + strat.id + ' — ' + (strat.name || 'Stratégie'),
    '// Éditez ce fichier avant de déployer',
    '// ═══════════════════════════════════════════════════════════════════',
    'module.exports = {',
    "  BOT_TOKEN:  'VOTRE_TOKEN_TELEGRAM_ICI',   // @BotFather -> /newbot",
    "  CHANNEL_ID: 'VOTRE_CHANNEL_ID_ICI',        // ex: -1001234567890 ou @moncanal",
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
    '// Etat interne',
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

function buildIndexJs(strat, licenseKey, serverUrl) {
  const stratName = strat.name || ('Strategie S' + strat.id);
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
    '',
    'async function checkLicense() {',
    '  try {',
    "    const r = await fetch(LICENSE_SERVER + '/api/license/check?key=' + LICENSE_KEY);",
    '    const d = await r.json();',
    '    if (!d.valid) {',
    "      console.error('');",
    "      console.error('============================================');",
    "      console.error('  LICENCE INVALIDE OU REVOQUEE');",
    "      console.error('  ' + (d.message || ''));",
    "      console.error('  Le bot va s\\'arreter dans 30 secondes.');",
    "      console.error('============================================');",
    "      console.error('');",
    '      setTimeout(() => process.exit(1), 30000);',
    '      return false;',
    '    }',
    "    console.log('[LICENCE] Licence active - ' + (d.strategy || ''));",
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
    "app.get('/', (req, res) => res.json({ status: 'ok', strategy: '" + stratName.replace(/'/g, "\\'") + "' }));",
    '',
    "app.post('/game', (req, res) => {",
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
    "    const emoji = pred.suit === 'P' ? '\uD83D\uDD35' : pred.suit === 'B' ? '\uD83D\uDD34' : '\uD83D\uDFE1';",
    "    const label = pred.suit === 'P' ? 'JOUEUR' : pred.suit === 'B' ? 'BANQUIER' : pred.suit;",
    "    const message = '\uD83C\uDFAF <b>PREDICTION</b> \u2014 Etape ' + pred.stepNum + '\\n' + emoji + ' Misez sur <b>' + label + '</b>\\n\uD83E\uDDE0 Strategie : " + stratName.replace(/'/g, "\\'") + "';",
    '    sendTelegram(message);',
    '    return res.json({ prediction: pred, message_sent: true });',
    '  }',
    '  res.json({ prediction: null });',
    '});',
    '',
    "app.post('/reset', (req, res) => { predictor.reset(); res.json({ ok: true }); });",
    "app.get('/state', (req, res) => res.json(predictor.getState()));",
    '',
    '// ── Démarrage avec vérification de licence ───────────────────────────',
    'checkLicense().then(ok => {',
    '  if (!ok) return;',
    '  app.listen(cfg.PORT, () => {',
    "    console.log('Baccarat Bot demarre sur le port ' + cfg.PORT);",
    "    console.log('Strategie : " + stratName.replace(/'/g, "\\'") + " (S" + strat.id + ")');",
    "    console.log('POST /game pour envoyer un resultat de jeu');",
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

function buildReadme(strat) {
  const stratName = strat.name || ('Strategie S' + strat.id);
  const stratMode = strat.mode || 'lecture_passee';
  return [
    '# Baccarat Bot — ' + stratName,
    '',
    '## Description',
    'Bot de prediction Baccarat automatique base sur la strategie **' + stratName + '** (mode: ' + stratMode + ').',
    '',
    '## Installation',
    '',
    '```bash',
    'npm install',
    '```',
    '',
    '## Configuration',
    '',
    'Editez **`config.js`** et remplacez :',
    '',
    '| Champ | Description |',
    '|-------|-------------|',
    '| `BOT_TOKEN` | Token Telegram de votre bot (@BotFather -> /newbot) |',
    '| `CHANNEL_ID` | ID du canal Telegram (ex: -1001234567890 ou @moncanal) |',
    '',
    '## Demarrage',
    '',
    '```bash',
    'npm start',
    '```',
    '',
    '## Utilisation',
    '',
    '```bash',
    'POST http://localhost:3000/game',
    'Content-Type: application/json',
    '',
    '{',
    '  "winner": "P",           # P = Joueur, B = Banquier, T = Egalite',
    '  "player_score": 7,',
    '  "banker_score": 4,',
    '  "player_cards": ["A","5"],',
    '  "banker_cards": ["3","K"]',
    '}',
    '```',
    '',
    '## Endpoints',
    '',
    '| Route | Methode | Description |',
    '|-------|---------|-------------|',
    '| `/` | GET | Healthcheck |',
    '| `/game` | POST | Soumettre un resultat |',
    '| `/reset` | POST | Reinitialiser le moteur |',
    '| `/state` | GET | Etat interne |',
    '',
    '## Deploiement',
    '',
    'Compatible : Heroku, Railway, Render, Replit, VPS Linux, Fly.io',
    '',
    '---',
    '*Strategie S' + strat.id + ' — ' + stratName + ' | Genere par Baccarat Pro*',
  ].join('\n');
}

/**
 * Genere le ZIP en memoire et retourne un Buffer.
 * @param {object} strat      - Configuration de la strategie
 * @param {string} licenseKey - Cle UUID unique generee a la validation de l'achat
 * @param {string} serverUrl  - URL du serveur maitre pour la verification de licence
 * @returns {Promise<Buffer>}
 */
async function generateStrategyZip(strat, licenseKey, serverUrl) {
  return new Promise((resolve, reject) => {
    const archive = archiver('zip', { zlib: { level: 9 } });
    const chunks  = [];
    const pt      = new PassThrough();
    pt.on('data',  c => chunks.push(c));
    pt.on('end',   () => resolve(Buffer.concat(chunks)));
    pt.on('error', reject);
    archive.pipe(pt);

    const folder = 'baccarat-bot-S' + strat.id + '/';
    archive.append(buildConfigJs(strat),                      { name: folder + 'config.js' });
    archive.append(buildPredictorJs(strat),                   { name: folder + 'predictor.js' });
    archive.append(buildIndexJs(strat, licenseKey, serverUrl),{ name: folder + 'index.js' });
    archive.append(buildPackageJson(strat),                   { name: folder + 'package.json' });
    archive.append(buildReadme(strat),                        { name: folder + 'README.md' });
    archive.finalize();
  });
}

module.exports = { generateStrategyZip };
