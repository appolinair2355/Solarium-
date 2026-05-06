'use strict';
/**
 * zip-generator.js — Génère le ZIP de déploiement pour une stratégie achetée.
 *
 * SÉCURITÉ : La stratégie n'est JAMAIS incluse dans le ZIP.
 *   Le bot la télécharge depuis le serveur maître au démarrage via /api/license/strategy.
 *   Si la licence est révoquée → le bot ne peut plus charger la stratégie → arrêt immédiat.
 */

const archiver        = require('archiver');
const { PassThrough } = require('stream');

// ─────────────────────────────────────────────────────────────────────────────
// config.js — aucune stratégie ici
// ─────────────────────────────────────────────────────────────────────────────
function buildConfigJs(botConfig = {}) {
  const channelId   = botConfig.channel_id    || '';
  const botToken    = botConfig.bot_token     || '';
  const formatId    = parseInt(botConfig.format_id) || 1;
  const adminChatId = botConfig.admin_chat_id || '';
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
// predictor.js — logique identique au moteur serveur, stratégie chargée au runtime
// ─────────────────────────────────────────────────────────────────────────────
function buildPredictorJs() {
  return `'use strict';
/**
 * predictor.js — Moteur de prédiction Baccarat
 * Réplique exacte de la logique engine.js du serveur maître.
 * La stratégie est téléchargée depuis le serveur au démarrage (jamais stockée localement).
 *
 * Modes supportés :
 *   manquants, apparents, absence_confirmee, compteur_adverse,
 *   taux_miroir, absence_apparition, apparition_absence, first_card_plus6
 */

const ALL_SUITS = ['\\u2660','\\u2665','\\u2666','\\u2663']; // ♠ ♥ ♦ ♣

let S     = null;  // stratégie chargée depuis le serveur
let state = null;  // état interne réinitialisé à chaque chargement

function _initState() {
  const z = {};
  for (const s of ALL_SUITS) z[s] = 0;
  return {
    counts:        Object.assign({}, z),
    adverseCounts: Object.assign({}, z),
    mirrorCounts:  Object.assign({}, z),
    mirrorLastHour: null,
    confirmPending: {},
    history:        [],
    // Prédiction en attente de résolution (rattrapage)
    // { suit: '♠', step: 0 }   step=0 → message initial, step>0 → rattrapage
    pending: null,
  };
}

/**
 * Chargement de la stratégie — appelé par index.js après fetchStrategy().
 */
function loadStrategy(stratObj) {
  S     = stratObj;
  state = _initState();
  console.log(
    '[PREDICTOR] ✅ Stratégie chargée' +
    ' | mode:'      + S.mode +
    ' | seuil B:'   + S.threshold +
    ' | main:'      + (S.hand || 'joueur') +
    ' | max-R:'     + S.max_rattrapage
  );
}

/** Réinitialise uniquement la prédiction en attente (rattrapage). */
function reset() {
  if (state) state.pending = null;
}

/**
 * Résout le costume prédit via les mappings de la stratégie.
 * Si plusieurs costumes cibles → choix aléatoire (comme engine.js).
 */
function resolvePredictedSuit(triggerSuit) {
  const raw  = (S.mappings || {})[triggerSuit];
  const pool = Array.isArray(raw)
    ? raw.filter(s => ALL_SUITS.includes(s))
    : (ALL_SUITS.includes(raw) ? [raw] : []);
  if (!pool.length) return null;
  return pool[Math.floor(Math.random() * pool.length)];
}

/**
 * Extrait les costumes des cartes d'une main (tableau d'objets {R, S}).
 */
function extractSuits(cards) {
  if (!Array.isArray(cards)) return [];
  return cards.map(c => (c && (c.S || c.suit)) || '').filter(s => ALL_SUITS.includes(s));
}

/**
 * Traite un jeu terminé reçu depuis /api/license/feed.
 *
 * @param {object} game  { game_number, winner, player_cards, banker_cards, player_score, banker_score }
 * @returns {{ suit: string, stepNum: number } | null}
 *   Retourne un objet si une prédiction doit être envoyée sur Telegram, null sinon.
 *   stepNum = 0 → prédiction initiale  |  stepNum >= 1 → rattrapage nᵒN
 */
function processGame(game) {
  if (!S || !state) return null;

  const pSuits    = extractSuits(game.player_cards);
  const bSuits    = extractSuits(game.banker_cards);
  const handSuits = (S.hand === 'banquier') ? bSuits : pSuits;

  const B      = parseInt(S.threshold)      || 5;
  const maxR   = (S.max_rattrapage !== undefined && S.max_rattrapage !== null)
                   ? parseInt(S.max_rattrapage) : 3;
  const offset = Math.max(1, parseInt(S.prediction_offset) || 1);

  // ── Phase 1 : résoudre la prédiction en attente (rattrapage) ─────────────
  if (state.pending) {
    const p   = state.pending;
    const won = handSuits.includes(p.suit);
    if (won) {
      // ✅ Victoire — on réinitialise et on ne renvoie rien
      reset();
      return null;
    }
    p.step++;
    if (p.step > maxR) {
      // ❌ Épuisé tous les rattrapages — abandon
      reset();
      return null;
    }
    // Rattrapage : renvoyer le même costume avec le nouveau numéro d'étape
    return { suit: p.suit, stepNum: p.step };
  }

  // ── Phase 2 : logique de déclenchement selon le mode ─────────────────────
  let prediction = null;
  const mode = S.mode;

  if (mode === 'manquants') {
    // Costume ABSENT pendant B jeux consécutifs → prédit le mapping
    for (const suit of ALL_SUITS) {
      if (handSuits.includes(suit)) { state.counts[suit] = 0; continue; }
      state.counts[suit] = (state.counts[suit] || 0) + 1;
      if (state.counts[suit] === B) {
        const ps = resolvePredictedSuit(suit);
        if (ps && !prediction) prediction = ps;
        state.counts[suit] = 0;
      }
    }

  } else if (mode === 'apparents') {
    // Costume PRÉSENT pendant B jeux consécutifs → prédit le mapping
    for (const suit of ALL_SUITS) {
      if (handSuits.includes(suit)) {
        state.counts[suit] = (state.counts[suit] || 0) + 1;
        if (state.counts[suit] === B) {
          const ps = resolvePredictedSuit(suit);
          if (ps && !prediction) prediction = ps;
          state.counts[suit] = 0;
        }
      } else {
        state.counts[suit] = 0;
      }
    }

  } else if (mode === 'absence_confirmee') {
    // Absence B fois → feu jaune → costume suivant réapparaît → feu vert → prédiction
    if (!state.confirmPending) state.confirmPending = {};
    for (const suit of ALL_SUITS) {
      if (state.confirmPending[suit]) {
        // Phase confirmation : le costume réapparaît-il ce jeu ?
        if (handSuits.includes(suit)) {
          const ps = resolvePredictedSuit(suit);
          if (ps && !prediction) prediction = ps;
        }
        state.confirmPending[suit] = false;
        state.counts[suit] = 0;
      } else if (handSuits.includes(suit)) {
        state.counts[suit] = 0;
      } else {
        state.counts[suit] = (state.counts[suit] || 0) + 1;
        if (state.counts[suit] >= B) {
          state.confirmPending[suit] = true;
          state.counts[suit] = 0;
        }
      }
    }

  } else if (mode === 'compteur_adverse') {
    // Costume absent B fois de la main OPPOSÉE → prédit le mapping dans la main configurée
    const adverseSuits = (S.hand === 'banquier') ? pSuits : bSuits;
    if (!state.adverseCounts) {
      state.adverseCounts = {};
      for (const s of ALL_SUITS) state.adverseCounts[s] = 0;
    }
    for (const suit of ALL_SUITS) {
      if (adverseSuits.includes(suit)) {
        state.adverseCounts[suit] = 0;
      } else {
        state.adverseCounts[suit] = (state.adverseCounts[suit] || 0) + 1;
        if (state.adverseCounts[suit] === B) {
          const ps = resolvePredictedSuit(suit);
          if (ps && !prediction) prediction = ps;
          state.adverseCounts[suit] = 0;
        }
      }
    }

  } else if (mode === 'taux_miroir') {
    // Compteurs cumulatifs par heure — remise à zéro toutes les heures
    if (!state.mirrorCounts) {
      state.mirrorCounts = {};
      for (const s of ALL_SUITS) state.mirrorCounts[s] = 0;
    }
    const epochHour = Math.floor(Date.now() / 3600000);
    if (state.mirrorLastHour !== null && state.mirrorLastHour !== epochHour) {
      for (const s of ALL_SUITS) state.mirrorCounts[s] = 0;
    }
    state.mirrorLastHour = epochHour;

    // Compter les cartes de la main configurée (chaque carte compte +1)
    const rawCards = (S.hand === 'banquier') ? (game.banker_cards || []) : (game.player_cards || []);
    for (const c of rawCards) {
      const s = (c && (c.S || c.suit)) || '';
      if (ALL_SUITS.includes(s)) state.mirrorCounts[s] = (state.mirrorCounts[s] || 0) + 1;
    }

    // Trouver la paire (dominant, retardataire) avec l'écart le plus grand ≥ seuil
    const pairs = Array.isArray(S.mirror_pairs) && S.mirror_pairs.length > 0 ? S.mirror_pairs : null;
    let bestDiff = 0;
    let laggingSuit = null;

    if (pairs) {
      for (const p of pairs) {
        const pairB   = (p.threshold && p.threshold > 0) ? p.threshold : B;
        const diff    = (state.mirrorCounts[p.a] || 0) - (state.mirrorCounts[p.b] || 0);
        const absDiff = Math.abs(diff);
        if (absDiff >= pairB && absDiff > bestDiff) {
          bestDiff    = absDiff;
          laggingSuit = diff > 0 ? p.b : p.a;
        }
      }
    } else {
      for (const sA of ALL_SUITS) {
        for (const sB of ALL_SUITS) {
          if (sA >= sB) continue;
          const diff    = (state.mirrorCounts[sA] || 0) - (state.mirrorCounts[sB] || 0);
          const absDiff = Math.abs(diff);
          if (absDiff >= B && absDiff > bestDiff) {
            bestDiff    = absDiff;
            laggingSuit = diff > 0 ? sB : sA;
          }
        }
      }
    }
    if (laggingSuit) prediction = laggingSuit;

  } else if (mode === 'absence_apparition') {
    // Costume absent >= B jeux → dès qu'il réapparaît → le prédit immédiatement
    for (const suit of ALL_SUITS) {
      if (handSuits.includes(suit)) {
        if ((state.counts[suit] || 0) >= B && !prediction) prediction = suit;
        state.counts[suit] = 0;
      } else {
        state.counts[suit] = (state.counts[suit] || 0) + 1;
      }
    }

  } else if (mode === 'apparition_absence') {
    // Costume présent >= B jeux → dès qu'il disparaît → prédit le mapping
    for (const suit of ALL_SUITS) {
      if (handSuits.includes(suit)) {
        state.counts[suit] = (state.counts[suit] || 0) + 1;
      } else {
        if ((state.counts[suit] || 0) >= B) {
          const ps = resolvePredictedSuit(suit) || suit;
          if (!prediction) prediction = ps;
        }
        state.counts[suit] = 0;
      }
    }

  } else if (mode === 'first_card_plus6') {
    // Joueur a 2 cartes de costumes différents ET banquier n'a pas le costume de la 1ère carte joueur
    const pCards = game.player_cards || [];
    const bCards = game.banker_cards || [];
    if (pCards.length === 2) {
      const p1 = (pCards[0] && (pCards[0].S || pCards[0].suit)) || '';
      const p2 = (pCards[1] && (pCards[1].S || pCards[1].suit)) || '';
      const bk = bCards.map(c => (c && (c.S || c.suit)) || '');
      if (ALL_SUITS.includes(p1) && p1 !== p2 && !bk.includes(p1)) {
        prediction = p1;
      }
    }

  } else {
    // Mode non implémenté localement (ex: lecture_passee, intersection, multi_strategy)
    // Le bot ne peut pas répliquer ces modes sans accès à la base historique du serveur.
    console.log('[PREDICTOR] ⚠️  Mode "' + mode + '" — prédiction non disponible en mode autonome');
  }

  // ── Phase 3 : émettre la prédiction si déclenchée ────────────────────────
  if (prediction) {
    state.pending = { suit: prediction, step: 0 };
    return { suit: prediction, stepNum: 0 };
  }
  return null;
}

module.exports = { loadStrategy, processGame, reset, getState: () => Object.assign({}, state || {}) };
`;
}

// ─────────────────────────────────────────────────────────────────────────────
// index.js — bot complet, stratégie téléchargée au démarrage
// ─────────────────────────────────────────────────────────────────────────────
function buildIndexJs(licenseKey, serverUrl, botConfig = {}) {
  const formatId  = parseInt(botConfig.format_id) || 1;
  const channelId = botConfig.channel_id || '';

  return `'use strict';
/**
 * index.js — Bot Baccarat autonome
 * ─ Télécharge la stratégie depuis le serveur maître (jamais stockée localement)
 * ─ Poll les résultats de jeux toutes les 5s
 * ─ Envoie les prédictions Telegram avec le format configuré (55 formats)
 * ─ Répond aux commandes : /start /status /reset /help /setformat /testpred
 * ─ Vérifie la licence toutes les heures
 */

const fetch     = require('node-fetch');
const cfg       = require('./config');
const predictor = require('./predictor');

const LICENSE_KEY    = '${licenseKey}';
const LICENSE_SERVER = '${serverUrl}';
let   FORMAT_ID      = cfg.FORMAT_ID || ${formatId};
const CHANNEL_ID     = cfg.CHANNEL_ID;
const BOT_TOKEN      = cfg.BOT_TOKEN;
let   ADMIN_CHAT_ID  = cfg.ADMIN_CHAT_ID || null;

let _licenseValid = true;
let _pollOffset   = 0;
let _lastGameId   = 0;
let _predCount    = 0;
let _startTime    = Date.now();
let _stratName    = 'Stratégie chargée';

// Costumes : symboles → labels et emoji (♠♥♦♣)
const SUIT_LABEL = {
  '\\u2660': 'PIQUE',    // ♠
  '\\u2665': 'C\\u0152UR',  // ♥  CŒUR
  '\\u2666': 'CARREAU',  // ♦
  '\\u2663': 'TR\\u00C8FLE', // ♣  TRÈFLE
};
const SUIT_EMOJI = {
  '\\u2660': '\\u2660\\uFE0F',   // ♠️
  '\\u2665': '\\u2665\\uFE0F',   // ♥️
  '\\u2666': '\\u2666\\uFE0F',   // ♦️
  '\\u2663': '\\u2663\\uFE0F',   // ♣️
};

// ── Envoi Telegram ────────────────────────────────────────────────────────────
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
  } catch (e) { console.error('[TG] Erreur réseau:', e.message); return null; }
}
async function sendChannel(text, pm) {
  const b = { chat_id: CHANNEL_ID, text };
  if (pm) b.parse_mode = pm;
  return tgPost('sendMessage', b);
}
async function sendChat(chatId, text) {
  return tgPost('sendMessage', { chat_id: chatId, text });
}

// ── 55 formats de message ─────────────────────────────────────────────────────
function buildMessage(suit, stepNum) {
  const label = SUIT_LABEL[suit] || suit;
  const emoji = SUIT_EMOJI[suit] || '\\uD83C\\uDFAF';
  const n     = stepNum;
  const sn    = _stratName;
  switch (parseInt(FORMAT_ID) || 1) {
    case 1:  return { text: '\\u26DC #' + n + ' \\u0418\\u0433\\u0440\\u043E\\u043A +1 \\u26DC\\n\\u25FD\\u041C\\u0430\\u0441\\u0442\\u044C ' + emoji + '\\n\\u25FC\\uFE0F ' + label + ' \\u2014 ' + sn, pm: null };
    case 2:  return { text: '\\uD83C\\uDFB2 BACCARA PREMIUM+1 \\u2728\\uD83C\\uDFB2\\n\\u00C9tape ' + n + ' :' + emoji + '\\n' + label, pm: null };
    case 3:  return { text: 'BACCARA PRO \\u2728\\n\\uD83C\\uDFAE\\u00C9tape: ' + n + '\\n\\uD83C\\uDCA3Carte ' + emoji + ' : ' + label + '\\nMode: Dogon', pm: null };
    case 4:  return { text: '\\uD83C\\uDFB0 PR\\u00C9DICTION \\u00C9tape ' + n + '\\n\\uD83C\\uDFAF Couleur: ' + emoji + ' ' + label + '\\n\\uD83D\\uDCCA Statut: En cours \\u23F3\\n\\uD83D\\uDD0D ' + sn, pm: null };
    case 5:  return { text: '\\uD83C\\uDFB0 BACCARAT \\u00C9tape ' + n + '\\n\\uD83C\\uDFAF Signal: ' + emoji + ' ' + label + '\\n\\uD83D\\uDD0D ' + sn, pm: null };
    case 6:  return { text: '\\uD83C\\uDFC6 *\\u00C9tape ' + n + '*\\n\\uD83C\\uDFAF Couleur: ' + emoji + ' ' + label + '\\n\\u23F3 En cours\\n_' + sn + '_', pm: 'Markdown' };
    case 7:  return { text: '<b>\\u00C9tape ' + n + '</b> \\u2014 <b><i>Le joueur</i></b> mise sur <b>' + label + '</b> ' + emoji + '\\n\\n\\u23F3 <i>En attente du r\\u00E9sultat...</i>\\n<i>' + sn + '</i>', pm: 'HTML' };
    case 8:  return { text: '\\uD83E\\uDD16 joueur \\u00C9tape ' + n + '\\n\\uD83D\\uDD30Couleur : ' + emoji + '\\n\\uD83D\\uDD30 Dogon : +1\\n\\uD83E\\uDDE8 ' + label + ' \\u2014 ' + sn, pm: null };
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
    default: return { text: '\\uD83C\\uDFAF PR\\u00C9DICTION \\u00C9tape ' + n + '\\n' + emoji + ' <b>' + label + '</b>', pm: 'HTML' };
  }
}

// ── Chargement de la stratégie depuis le serveur ──────────────────────────────
async function fetchStrategy() {
  for (let attempt = 1; attempt <= 10; attempt++) {
    try {
      const r = await fetch(LICENSE_SERVER + '/api/license/strategy?key=' + LICENSE_KEY, { timeout: 15000 });
      const d = await r.json();
      if (!d.ok) {
        console.error('[STRATÉGIE] Erreur serveur:', d.error);
        if (d.error && (d.error.includes('revoquee') || d.error.includes('inconnue'))) {
          console.error('[LICENCE] Licence invalide — arrêt du bot.');
          process.exit(1);
        }
        throw new Error(d.error || 'Réponse invalide');
      }
      predictor.loadStrategy(d.strategy);
      _stratName = d.strategy.name || ('Stratégie #' + d.strategy.id);
      console.log('[STRATÉGIE] ✅ Chargée depuis le serveur (mode:', d.strategy.mode + ', seuil B:', d.strategy.threshold + ', main:', d.strategy.hand + ')');
      return true;
    } catch (e) {
      console.warn('[STRATÉGIE] Tentative', attempt, '/ 10 :', e.message);
      if (attempt < 10) await new Promise(r => setTimeout(r, 5000));
    }
  }
  console.error('[STRATÉGIE] Impossible de charger la stratégie après 10 tentatives — arrêt.');
  process.exit(1);
}

// ── Vérification de licence ───────────────────────────────────────────────────
async function checkLicense() {
  try {
    const r = await fetch(LICENSE_SERVER + '/api/license/check?key=' + LICENSE_KEY, { timeout: 15000 });
    const d = await r.json();
    if (!d.valid) {
      _licenseValid = false;
      console.error('[LICENCE] Révoquée :', d.message);
      await sendChannel('\\u26D4 <b>BOT DÉSACTIVÉ</b>\\n\\nVotre licence a été révoquée.\\nLes prédictions sont arrêtées.', 'HTML').catch(() => {});
      setTimeout(() => process.exit(1), 5000);
      return false;
    }
    _licenseValid = true;
    return true;
  } catch (e) {
    console.warn('[LICENCE] Serveur injoignable (vérification ignorée):', e.message);
    return true;
  }
}

// ── Polling des jeux ──────────────────────────────────────────────────────────
async function pollGames() {
  if (!_licenseValid) return;
  try {
    const r    = await fetch(LICENSE_SERVER + '/api/license/feed?key=' + LICENSE_KEY, { timeout: 10000 });
    const data = await r.json();
    if (!data.ok) {
      if (data.error && (data.error.includes('revoquee') || data.error.includes('suspendue'))) {
        _licenseValid = false;
        console.error('[LICENCE] Révoquée — arrêt des prédictions');
      }
      return;
    }

    const games = (data.games || []).filter(g => g.game_number > _lastGameId);
    if (!games.length) return;
    games.sort((a, b) => a.game_number - b.game_number);

    for (const game of games) {
      _lastGameId = Math.max(_lastGameId, game.game_number);

      // Transmettre directement le jeu au predictor — il extrait lui-même les costumes des cartes
      const pred = predictor.processGame({
        game_number:  game.game_number,
        winner:       game.winner,
        player_score: game.player_score != null ? parseInt(game.player_score) : null,
        banker_score: game.banker_score != null ? parseInt(game.banker_score) : null,
        player_cards: game.player_cards || [],
        banker_cards: game.banker_cards || [],
      });

      if (pred) {
        const { text, pm } = buildMessage(pred.suit, pred.stepNum);
        await sendChannel(text, pm);
        _predCount++;
        const label = SUIT_LABEL[pred.suit] || pred.suit;
        const step  = pred.stepNum === 0 ? 'Initial' : ('Rattrapage R' + pred.stepNum);
        console.log('[PRED]', step, '|', label, '(' + pred.suit + ') | Jeu #' + game.game_number);
      }
    }
  } catch (e) {
    console.error('[POLL] Erreur:', e.message);
  }
}

// ── Polling des commandes Telegram ────────────────────────────────────────────
async function pollCommands() {
  if (!BOT_TOKEN) return;
  try {
    const r    = await fetch(
      'https://api.telegram.org/bot' + BOT_TOKEN +
      '/getUpdates?offset=' + _pollOffset + '&timeout=5&allowed_updates=["message"]',
      { timeout: 10000 }
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
        const uptime = Math.floor((Date.now() - _startTime) / 1000);
        const h = Math.floor(uptime / 3600), m = Math.floor((uptime % 3600) / 60);
        await sendChat(chatId,
          '\\uD83E\\uDD16 Bot Baccarat actif\\n\\n' +
          '\\uD83C\\uDFAF ' + _stratName + '\\n' +
          '\\uD83D\\uDCCA Format : #' + FORMAT_ID + '\\n' +
          '\\uD83D\\uDCE2 Canal : ' + CHANNEL_ID + '\\n' +
          '\\u2705 Licence : ' + (_licenseValid ? 'Active' : 'Invalide') + '\\n' +
          '\\u23F1 Uptime : ' + h + 'h ' + m + 'min\\n' +
          '\\uD83D\\uDCE4 Prédictions envoyées : ' + _predCount
        );
      } else if (cmd === '/status') {
        const st = predictor.getState();
        const pendingInfo = st.pending
          ? ('Oui — ' + (SUIT_LABEL[st.pending.suit] || st.pending.suit) + ' ' + (st.pending.suit) + ' R' + st.pending.step)
          : 'Non';
        await sendChat(chatId,
          '\\uD83D\\uDCCA ÉTAT DU MOTEUR\\n\\n' +
          '\\uD83D\\uDD17 Dernier jeu traité : #' + _lastGameId + '\\n' +
          '\\u23F3 Prédiction en attente : ' + pendingInfo + '\\n' +
          '\\uD83D\\uDCE4 Prédictions totales : ' + _predCount + '\\n' +
          '\\u2705 Licence : ' + (_licenseValid ? 'Active' : 'Invalide')
        );
      } else if (cmd === '/reset') {
        predictor.reset();
        await sendChat(chatId, '\\u267B\\uFE0F Moteur réinitialisé.');
      } else if (cmd === '/help') {
        await sendChat(chatId,
          '\\uD83D\\uDCCB COMMANDES\\n\\n' +
          '/start \\u2014 Infos du bot\\n' +
          '/status \\u2014 État du moteur\\n' +
          '/reset \\u2014 Réinitialiser le moteur\\n' +
          '/setformat N \\u2014 Changer le format (1-55)\\n' +
          '/testpred \\u2014 Envoyer une prédiction test\\n' +
          '/help \\u2014 Cette aide'
        );
      } else if (cmd === '/setformat') {
        const newFmt = parseInt((text.split(/\\s+/)[1]) || '0');
        if (!newFmt || newFmt < 1 || newFmt > 55) {
          await sendChat(chatId, '\\u26A0\\uFE0F Usage : /setformat <1-55>   ex: /setformat 19');
        } else {
          FORMAT_ID = newFmt;
          await sendChat(chatId, '\\u2705 Format changé → #' + FORMAT_ID);
        }
      } else if (cmd === '/testpred') {
        if (!isAdmin) { await sendChat(chatId, '\\u26D4 Réservé à l\\'admin.'); continue; }
        const { text: t, pm } = buildMessage('\\u2660', 0);
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
  console.log('');
  console.log('╔═══════════════════════════════════════════╗');
  console.log('║       BACCARAT BOT — Démarrage           ║');
  console.log('║  Connexion au serveur de licence...       ║');
  console.log('╚═══════════════════════════════════════════╝');
  console.log('');

  // 1. Vérifier la licence
  const ok = await checkLicense();
  if (!ok) return;

  // 2. Télécharger la stratégie (bloquant — le bot ne démarre pas sans elle)
  await fetchStrategy();

  // 3. Lancer les boucles de polling
  setInterval(pollGames,    5000);
  setInterval(pollCommands, 3000);
  setInterval(checkLicense, 60 * 60 * 1000);
  setTimeout(pollGames,    1000);
  setTimeout(pollCommands, 2000);

  console.log('[BOT] ✅ Bot démarré — Format #' + FORMAT_ID + ' | Canal : ' + CHANNEL_ID);

  // Message de démarrage sur le canal
  await sendChannel(
    '\\uD83C\\uDF89 <b>Bot Baccarat actif !</b>\\n\\n' +
    '\\uD83D\\uDCCA Format : #' + FORMAT_ID + '\\n' +
    '\\u2705 Stratégie chargée\\n' +
    '\\uD83D\\uDCDE Commandes : /start /status /reset /help',
    'HTML'
  ).catch(() => {});

  if (ADMIN_CHAT_ID) {
    sendChat(ADMIN_CHAT_ID, '\\uD83D\\uDE80 Bot redémarré. Stratégie chargée. Format #' + FORMAT_ID).catch(() => {});
  }
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
    description: 'Bot de prédiction Baccarat autonome',
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
Bot de prédiction Baccarat automatique connecté au serveur Baccarat Pro.

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

## Commandes Telegram (chat privé avec le bot)

| Commande | Description |
|----------|-------------|
| \`/start\` | Informations du bot |
| \`/status\` | État du moteur de prédiction |
| \`/reset\` | Réinitialiser le moteur |
| \`/setformat N\` | Changer le format (ex: \`/setformat 7\`) |
| \`/testpred\` | Envoyer une prédiction test |
| \`/help\` | Aide |

## Fonctionnement

1. Au démarrage, le bot vérifie votre licence et **télécharge la stratégie** depuis le serveur
2. Il poll les résultats de jeux 1xBet toutes les **5 secondes**
3. Quand un signal est détecté, il envoie la prédiction sur votre canal Telegram
4. La licence est vérifiée toutes les heures — arrêt automatique si révoquée

> ⚠️ La stratégie de prédiction est protégée et chargée depuis le serveur.
> Elle n'est jamais stockée localement dans ce ZIP.

## Déploiement recommandé

Compatible Render.com, Railway, Fly.io, VPS Linux :
- Runtime: Node.js 18+
- Build: \`npm install\`
- Start: \`npm start\`

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
    archive.append(buildConfigJs(botConfig),                  { name: folder + 'config.js' });
    archive.append(buildPredictorJs(),                        { name: folder + 'predictor.js' });
    archive.append(buildIndexJs(licenseKey, serverUrl, botConfig), { name: folder + 'index.js' });
    archive.append(buildPackageJson(strat),                   { name: folder + 'package.json' });
    archive.append(buildReadme(strat, botConfig),             { name: folder + 'README.md' });
    archive.finalize();
  });
}

module.exports = { generateStrategyZip };
