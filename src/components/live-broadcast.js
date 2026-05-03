// ════════════════════════════════════════════════════════════════════════════
//  LIVE BROADCAST — Diffusion en temps réel des parties Baccarat vers Telegram
// ════════════════════════════════════════════════════════════════════════════
//  • Aucune persistance des messages : tout est en mémoire.
//  • Multi-cibles : chaque cible = { id, bot_token, channel_id, label, enabled }.
//  • Stockage des cibles : DB setting `live_broadcast_targets` (JSON array).
//  • Pour chaque jeu : envoie un message initial (live) puis l'édite en
//    temps réel jusqu'à ce que la partie soit terminée.
//  • Format des messages :
//      En cours :        ⏰#N{n}. ▶️{p}({pCards}) - {b}({bCards})
//                        ⏰#N{n}. {p}({pCards}) - ▶️{b}({bCards})
//      Joueur gagne (2 cartes / 2 cartes) :  #N{n}. ✅{p}({pCards}) - {b}({bCards}) #T{tot} 🔵#R
//      Joueur gagne (3ᵉ carte tirée) :       #N{n}. ✅{p}({pCards}) - {b}({bCards}) #T{tot} 🔵
//      Banquier gagne (2/2) :                #N{n}. {p}({pCards}) - ✅{b}({bCards}) #T{tot} 🔴#R
//      Banquier gagne (3ᵉ carte tirée) :     #N{n}. {p}({pCards}) - ✅{b}({bCards}) #T{tot} 🔴
//      Égalité :                             #N{n}. {p}({pCards}) 🔰 {b}({bCards}) #T{tot} 🟣#X
//   Le tag #R signifie "jeu terminé après distribution initiale" (aucune 3ᵉ carte).
// ════════════════════════════════════════════════════════════════════════════

const fetch = require('node-fetch');
const db    = require('./db');

const TARGETS_KEY = 'live_broadcast_targets';

// ── État mémoire (jamais persisté) ──────────────────────────────────────────
// gameState[gameNumber] = {
//   targets: { [targetId]: { messageId, lastText } },
//   finalSent: bool,
//   firstSeenAt: timestamp,
// }
const gameState = new Map();
const MAX_TRACKED_GAMES = 200;     // anneau circulaire
const FINAL_RETENTION_MS = 10 * 60 * 1000; // 10 min après finalisation

let cachedTargets = null;
let cachedAt = 0;
const TARGETS_TTL = 5000;

// ── Cibles : load / save ────────────────────────────────────────────────────

async function loadTargets(force = false) {
  if (!force && cachedTargets && Date.now() - cachedAt < TARGETS_TTL) {
    return cachedTargets;
  }
  try {
    const raw = await db.getSetting(TARGETS_KEY);
    cachedTargets = raw ? JSON.parse(raw) : [];
  } catch {
    cachedTargets = [];
  }
  if (!Array.isArray(cachedTargets)) cachedTargets = [];
  cachedAt = Date.now();
  return cachedTargets;
}

async function saveTargets(list) {
  if (!Array.isArray(list)) throw new Error('targets must be an array');
  await db.setSetting(TARGETS_KEY, JSON.stringify(list));
  cachedTargets = list;
  cachedAt = Date.now();
}

async function addTarget({ bot_token, channel_id, label }) {
  if (!bot_token || !channel_id) throw new Error('bot_token et channel_id requis');
  const list = await loadTargets(true);
  // Déduplication : (token, channel_id) unique
  if (list.some(t => t.bot_token === bot_token && String(t.channel_id) === String(channel_id))) {
    throw new Error('Cette cible existe déjà (même token + canal)');
  }
  const id = `LB${Date.now()}${Math.floor(Math.random() * 100)}`;
  const entry = {
    id, bot_token: String(bot_token).trim(), channel_id: String(channel_id).trim(),
    label: (label || '').trim() || null,
    enabled: true,
    created_at: new Date().toISOString(),
  };
  list.push(entry);
  await saveTargets(list);
  return entry;
}

async function removeTarget(id) {
  const list = await loadTargets(true);
  const next = list.filter(t => t.id !== id);
  if (next.length === list.length) throw new Error('Cible introuvable');
  await saveTargets(next);
  // Nettoyage mémoire pour cette cible
  for (const st of gameState.values()) {
    if (st.targets && st.targets[id]) delete st.targets[id];
  }
}

async function setTargetEnabled(id, enabled) {
  const list = await loadTargets(true);
  const t = list.find(x => x.id === id);
  if (!t) throw new Error('Cible introuvable');
  t.enabled = !!enabled;
  await saveTargets(list);
}

async function listTargets() {
  const list = await loadTargets(true);
  return list.map(t => ({
    id: t.id,
    label: t.label,
    channel_id: t.channel_id,
    bot_token_preview: t.bot_token ? (t.bot_token.slice(0, 8) + '…' + t.bot_token.slice(-4)) : null,
    enabled: t.enabled !== false,
    created_at: t.created_at,
  }));
}

// ── Calcul du score Baccarat ────────────────────────────────────────────────

// L'API 1xBet envoie les rangs en numérique : 0/1/14=As, 2-9=valeur, 10=10, 11=J, 12=Q, 13=K
// (1xBet utilise indifféremment 1 ou 14 pour l'As selon l'encodage du paquet)
function rankValue(r) {
  if (r === null || r === undefined || r === '?') return 0;
  const s = String(r).toUpperCase();
  if (s === 'A') return 1;
  if (s === 'T' || s === 'J' || s === 'Q' || s === 'K') return 0;
  const n = parseInt(s, 10);
  if (Number.isNaN(n)) return 0;
  if (n === 0 || n === 1 || n === 14) return 1;   // As (encodage bas ou haut)
  if (n >= 10 && n <= 13) return 0;                // 10, J, Q, K
  if (n >= 2 && n <= 9) return n;
  return 0;
}

function rankLabel(r) {
  if (r === null || r === undefined || r === '?') return '?';
  const s = String(r).toUpperCase();
  if (s === 'A' || s === 'T' || s === 'J' || s === 'Q' || s === 'K') {
    return s === 'T' ? '10' : s;
  }
  const n = parseInt(s, 10);
  if (Number.isNaN(n)) return String(r);
  if (n === 0 || n === 1 || n === 14) return 'A'; // As (encodage bas ou haut)
  if (n === 11) return 'J';
  if (n === 12) return 'Q';
  if (n === 13) return 'K';
  if (n >= 2 && n <= 10) return String(n);
  return String(n);
}

function score(cards) {
  if (!Array.isArray(cards) || cards.length === 0) return 0;
  return cards.reduce((s, c) => s + rankValue(c?.R), 0) % 10;
}

function fmtCards(cards) {
  if (!Array.isArray(cards)) return '';
  return cards.map(c => `${rankLabel(c?.R)}${c?.S || ''}`).join('');
}

// ── Construction du message ─────────────────────────────────────────────────

function buildMessage(g) {
  const p      = score(g.player_cards);
  const b      = score(g.banker_cards);
  const pCards = fmtCards(g.player_cards);
  const bCards = fmtCards(g.banker_cards);
  const total  = p + b;
  const n      = g.game_number;
  const winner = g.winner;
  const finished = !!g.is_finished || winner === 'Player' || winner === 'Banker' || winner === 'Tie';

  if (finished) {
    // #R = jeu terminé après distribution initiale (2 cartes chacun, aucune 3ᵉ carte tirée)
    const pLen = Array.isArray(g.player_cards) ? g.player_cards.length : 0;
    const bLen = Array.isArray(g.banker_cards) ? g.banker_cards.length : 0;
    const naturalEnd = pLen === 2 && bLen === 2;
    const tag = naturalEnd ? ' #R' : '';

    if (winner === 'Tie') {
      return `#N${n}. ${p}(${pCards}) 🔰 ${b}(${bCards}) #T${total} 🟣#X${tag}`;
    }
    if (winner === 'Player') {
      return `#N${n}. ✅${p}(${pCards}) - ${b}(${bCards}) #T${total} 🔵${naturalEnd ? '#R' : ''}`.trimEnd();
    }
    if (winner === 'Banker') {
      return `#N${n}. ${p}(${pCards}) - ✅${b}(${bCards}) #T${total} 🔴${naturalEnd ? '#R' : ''}`.trimEnd();
    }
    // Cas limite : finished sans winner explicite → comparer les points
    if (p === b) return `#N${n}. ${p}(${pCards}) 🔰 ${b}(${bCards}) #T${total} 🟣#X${tag}`;
    if (p > b)   return `#N${n}. ✅${p}(${pCards}) - ${b}(${bCards}) #T${total} 🔵${naturalEnd ? '#R' : ''}`.trimEnd();
                 return `#N${n}. ${p}(${pCards}) - ✅${b}(${bCards}) #T${total} 🔴${naturalEnd ? '#R' : ''}`.trimEnd();
  }

  // En cours
  const ph = g.phase || '';
  const playerDrawing = ph === 'PlayerMove';
  const bankerDrawing = ph === 'BankerMove' || ph === 'DealerMove' || ph === 'ThirdCard';
  const pPart = playerDrawing ? `▶️${p}(${pCards})` : `${p}(${pCards})`;
  const bPart = bankerDrawing ? `▶️${b}(${bCards})` : `${b}(${bCards})`;
  return `⏰#N${n}. ${pPart} - ${bPart}`;
}

// ── Appels Telegram bas niveau ──────────────────────────────────────────────

async function tgSendMessage(token, chatId, text) {
  const resp = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: chatId, text, disable_web_page_preview: true }),
  });
  const d = await resp.json().catch(() => ({}));
  if (!resp.ok || !d?.ok) {
    const desc = d?.description || `HTTP ${resp.status}`;
    const err = new Error(desc);
    err.code = d?.error_code || resp.status;
    throw err;
  }
  return d.result?.message_id || null;
}

async function tgEditMessage(token, chatId, messageId, text) {
  const resp = await fetch(`https://api.telegram.org/bot${token}/editMessageText`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: chatId, message_id: messageId, text, disable_web_page_preview: true }),
  });
  const d = await resp.json().catch(() => ({}));
  if (!resp.ok || !d?.ok) {
    const desc = d?.description || `HTTP ${resp.status}`;
    // Telegram renvoie 400 "message is not modified" si rien n'a changé → silencieux
    if (/not modified/i.test(desc)) return messageId;
    const err = new Error(desc);
    err.code = d?.error_code || resp.status;
    throw err;
  }
  return messageId;
}

// ── Diffusion d'un jeu vers une cible ───────────────────────────────────────

async function diffuseGame(target, game, finishedNow) {
  const text = buildMessage(game);
  const gn   = game.game_number;
  let st = gameState.get(gn);
  if (!st) {
    st = { targets: {}, finalSent: false, firstSeenAt: Date.now() };
    gameState.set(gn, st);
  }
  let entry = st.targets[target.id];
  if (!entry) entry = st.targets[target.id] = { messageId: null, lastText: null };

  // Aucun changement texte → skip
  if (entry.lastText === text) return;

  try {
    if (entry.messageId) {
      await tgEditMessage(target.bot_token, target.channel_id, entry.messageId, text);
    } else {
      const mid = await tgSendMessage(target.bot_token, target.channel_id, text);
      entry.messageId = mid;
    }
    entry.lastText = text;
    if (finishedNow) st.finalSent = true;
  } catch (e) {
    // Erreurs typiques : 403 (bot pas admin), 400 (chat introuvable). On log sans interrompre.
    console.warn(`[LiveBroadcast] cible=${target.id} jeu=${gn} erreur: ${e.message}`);
  }
}

// ── Hook principal : appelé à chaque mise à jour des jeux ───────────────────

let _busy = false;

async function onGamesUpdate(games) {
  if (_busy) return;             // évite ré-entrance
  if (!Array.isArray(games) || games.length === 0) return;

  const targets = (await loadTargets()).filter(t => t.enabled !== false);
  if (targets.length === 0) return;

  _busy = true;
  try {
    // Tri par game_number ascendant pour ordre cohérent
    const sorted = [...games].sort((a, b) => a.game_number - b.game_number);

    for (const g of sorted) {
      if (!g || !g.game_number) continue;
      const hasCards = (g.player_cards?.length || 0) > 0 || (g.banker_cards?.length || 0) > 0;
      if (!hasCards && !g.is_finished) continue;

      const st = gameState.get(g.game_number);
      const wasFinal = !!st?.finalSent;
      const finishedNow = !!g.is_finished;

      // Si déjà finalisé, on n'envoie plus rien
      if (wasFinal) continue;

      for (const t of targets) {
        await diffuseGame(t, g, finishedNow);
      }
    }

    // Nettoyage : supprime les entrées trop vieilles ou si trop d'entrées
    if (gameState.size > MAX_TRACKED_GAMES) {
      const keys = [...gameState.keys()].sort((a, b) => a - b);
      const toDelete = keys.slice(0, keys.length - MAX_TRACKED_GAMES);
      for (const k of toDelete) gameState.delete(k);
    }
    const cutoff = Date.now() - FINAL_RETENTION_MS;
    for (const [k, st] of gameState.entries()) {
      if (st.finalSent && st.firstSeenAt < cutoff) gameState.delete(k);
    }
  } finally {
    _busy = false;
  }
}

// ── Test d'envoi d'un message vers une cible précise ────────────────────────

async function sendTestMessage(targetId) {
  const list = await loadTargets(true);
  const t = list.find(x => x.id === targetId);
  if (!t) throw new Error('Cible introuvable');
  const text = `✅ Test diffusion live — canal connecté\n#N0000. ✅9(8♣️A♥️) - 3(6♥️7♠️) #T12 🔵#R`;
  const mid = await tgSendMessage(t.bot_token, t.channel_id, text);
  return { ok: true, message_id: mid };
}

module.exports = {
  onGamesUpdate,
  loadTargets, listTargets, addTarget, removeTarget, setTargetEnabled,
  sendTestMessage,
  buildMessage, // exposé pour debug/preview
  _gameState: gameState,
};
