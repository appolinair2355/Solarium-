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

// Timeout pour chaque appel Telegram (ms) — évite qu'une lenteur bloque tout
const TG_TIMEOUT_MS = 5000;

// ── État mémoire (jamais persisté) ──────────────────────────────────────────
// gameState[gameNumber] = {
//   targets: { [targetId]: { messageId, lastText, finalSent } },
//   firstSeenAt: timestamp,
//   lastKnown: <game object> | null,   — dernier snapshot valide du jeu (avec cartes)
// }
const gameState = new Map();
const MAX_TRACKED_GAMES  = 200;
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

function rankValue(r) {
  if (r === null || r === undefined || r === '?') return 0;
  const s = String(r).toUpperCase();
  if (s === 'A') return 1;
  if (s === 'T' || s === 'J' || s === 'Q' || s === 'K') return 0;
  const n = parseInt(s, 10);
  if (Number.isNaN(n)) return 0;
  if (n === 0 || n === 1 || n === 14) return 1;
  if (n >= 10 && n <= 13) return 0;
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
  if (n === 0 || n === 1 || n === 14) return 'A';
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
    const pLen = Array.isArray(g.player_cards) ? g.player_cards.length : 0;
    const bLen = Array.isArray(g.banker_cards) ? g.banker_cards.length : 0;
    const naturalEnd = pLen === 2 && bLen === 2;

    if (winner === 'Tie') {
      return `#N${n}. ${p}(${pCards}) 🔰 ${b}(${bCards}) #T${total} 🟣#X${naturalEnd ? ' #R' : ''}`;
    }
    if (winner === 'Player') {
      return `#N${n}. ✅${p}(${pCards}) - ${b}(${bCards}) #T${total} 🔵${naturalEnd ? '#R' : ''}`.trimEnd();
    }
    if (winner === 'Banker') {
      return `#N${n}. ${p}(${pCards}) - ✅${b}(${bCards}) #T${total} 🔴${naturalEnd ? '#R' : ''}`.trimEnd();
    }
    if (p === b) return `#N${n}. ${p}(${pCards}) 🔰 ${b}(${bCards}) #T${total} 🟣#X${naturalEnd ? ' #R' : ''}`;
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

// ── Appels Telegram bas niveau (avec timeout) ────────────────────────────────

async function tgSendMessage(token, chatId, text) {
  const resp = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify({ chat_id: chatId, text, disable_web_page_preview: true }),
    timeout: TG_TIMEOUT_MS,
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
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify({ chat_id: chatId, message_id: messageId, text, disable_web_page_preview: true }),
    timeout: TG_TIMEOUT_MS,
  });
  const d = await resp.json().catch(() => ({}));
  if (!resp.ok || !d?.ok) {
    const desc = d?.description || `HTTP ${resp.status}`;
    if (/not modified/i.test(desc)) return messageId;
    const err = new Error(desc);
    err.code = d?.error_code || resp.status;
    throw err;
  }
  return messageId;
}

// ── Diffusion d'un jeu vers UNE cible ───────────────────────────────────────

// Détermine si les données d'un jeu sont suffisantes pour considérer la partie
// comme définitivement terminée (gagnant connu OU ≥ 2 cartes par côté + is_finished).
function isDefinitivelyFinished(g) {
  if (!g.is_finished) return false;
  if (g.winner === 'Player' || g.winner === 'Banker' || g.winner === 'Tie') return true;
  const pLen = Array.isArray(g.player_cards) ? g.player_cards.length : 0;
  const bLen = Array.isArray(g.banker_cards) ? g.banker_cards.length : 0;
  return pLen >= 2 && bLen >= 2;
}

async function diffuseGame(target, game, finishedNow) {
  const text = buildMessage(game);
  const gn   = game.game_number;
  let st = gameState.get(gn);
  if (!st) {
    st = { targets: {}, firstSeenAt: Date.now(), lastKnown: null };
    gameState.set(gn, st);
  }

  // Mémoriser le dernier état valide du jeu (avec cartes ou terminé)
  const hasCards = (game.player_cards?.length || 0) > 0 || (game.banker_cards?.length || 0) > 0;
  if (hasCards || game.is_finished) {
    st.lastKnown = { ...game };
  }

  let entry = st.targets[target.id];
  if (!entry) entry = st.targets[target.id] = { messageId: null, lastText: null, finalSent: false };

  if (entry.finalSent) return;
  if (entry.lastText === text) return;

  // N'appliquer finalSent=true que si les données sont vraiment complètes
  const definitivelyDone = finishedNow && isDefinitivelyFinished(game);

  const lbl = target.label || target.id;
  try {
    if (entry.messageId) {
      await tgEditMessage(target.bot_token, target.channel_id, entry.messageId, text);
      if (definitivelyDone) {
        console.log(`[LiveBroadcast] 🏁 #${gn} FINAL → [${lbl}] | ${text}`);
      } else {
        console.log(`[LiveBroadcast] ✏️  #${gn} EDIT  → [${lbl}] | ${text}`);
      }
    } else {
      const mid = await tgSendMessage(target.bot_token, target.channel_id, text);
      entry.messageId = mid;
      console.log(`[LiveBroadcast] 📨 #${gn} ENVOI → [${lbl}] msgId=${mid} | ${text}`);
    }
    entry.lastText = text;
    if (definitivelyDone) entry.finalSent = true;
  } catch (e) {
    console.warn(`[LiveBroadcast] ❌ #${gn} [${lbl}] erreur: ${e.message}`);
  }
}

// ── Diffusion d'un jeu vers TOUTES les cibles en parallèle ──────────────────

async function diffuseGameAllTargets(targets, game, finishedNow) {
  // Toutes les cibles sont indépendantes → on envoie en parallèle
  // pour qu'une cible lente ne retarde pas les autres.
  await Promise.allSettled(
    targets.map(t => {
      const st    = gameState.get(game.game_number);
      const entry = st?.targets?.[t.id];
      if (entry?.finalSent) return Promise.resolve();
      return diffuseGame(t, game, finishedNow);
    })
  );
}

// ── File d'attente interne ───────────────────────────────────────────────────
// Remplace l'ancien _busy (drop) : on garde toujours le snapshot le plus récent.
// Si un traitement est en cours, le nouvel appel stocke ses données dans
// _pendingGames ; dès que le traitement courant se termine, il traite
// immédiatement le snapshot en attente.
let _processing = false;
let _pendingGames = null;

// ── Traitement interne d'un snapshot de jeux ─────────────────────────────────

async function _processSnapshot(games) {
  const targets = (await loadTargets()).filter(t => t.enabled !== false);
  if (targets.length === 0) {
    // Log une fois toutes les 60s pour ne pas spammer
    const now = Date.now();
    if (!_processSnapshot._lastNoTargetLog || now - _processSnapshot._lastNoTargetLog > 60000) {
      console.log('[LiveBroadcast] ℹ️  Aucune cible active — diffusion désactivée');
      _processSnapshot._lastNoTargetLog = now;
    }
    return;
  }

  // Classer les jeux : nouveaux (jamais vus) EN PREMIER, puis connus
  const newGames   = [];
  const knownGames = [];
  const skipped    = [];

  for (const g of games) {
    if (!g || !g.game_number) continue;
    const hasCards = (g.player_cards?.length || 0) > 0 || (g.banker_cards?.length || 0) > 0;
    if (!hasCards && !g.is_finished) {
      skipped.push(g.game_number);
      continue;
    }
    if (!gameState.has(g.game_number)) {
      newGames.push(g);
    } else {
      knownGames.push(g);
    }
  }

  if (skipped.length > 0) {
    console.log(`[LiveBroadcast] ⏳ Jeu(x) #${skipped.join(',')} ignoré(s) — Prematch/pas de cartes`);
  }

  newGames.sort((a, b) => a.game_number - b.game_number);
  knownGames.sort((a, b) => a.game_number - b.game_number);
  const sorted = [...newGames, ...knownGames];

  if (sorted.length > 0) {
    const newNums   = newGames.map(g => '#' + g.game_number).join(',');
    const knownNums = knownGames.map(g => '#' + g.game_number).join(',');
    console.log(`[LiveBroadcast] 🎯 ${targets.length} cible(s) | Nouveaux: [${newNums || '—'}] Connus: [${knownNums || '—'}]`);
  }

  for (const g of sorted) {
    const finishedNow = !!g.is_finished;
    await diffuseGameAllTargets(targets, g, finishedNow);
  }

  // ── Finalisation des jeux disparus de l'API ────────────────────────────────
  // Un jeu peut disparaître du snapshot AVANT qu'on ait pu envoyer l'état final
  // (l'API retire les jeux terminés très vite). On force alors un dernier edit
  // sur les jeux trackés qui ne sont plus dans le snapshot courant.
  const snapshotNums = new Set(games.map(g => g.game_number));
  for (const [gn, st] of gameState.entries()) {
    if (snapshotNums.has(gn)) continue;              // encore dans l'API — géré ci-dessus
    if (!st.lastKnown) continue;                     // jamais vu avec des cartes — rien à faire
    // Vérifier s'il reste des cibles non finalisées avec un messageId
    const pendingTargets = targets.filter(t => {
      const e = st.targets[t.id];
      return e && e.messageId && !e.finalSent;
    });
    if (pendingTargets.length === 0) continue;

    // Construire un état "terminé forcé" basé sur le dernier snapshot connu
    const forcedGame = { ...st.lastKnown, is_finished: true };
    // Si le gagnant n'est pas connu, le recalculer depuis les scores
    if (!forcedGame.winner) {
      const p = score(forcedGame.player_cards);
      const b = score(forcedGame.banker_cards);
      forcedGame.winner = p > b ? 'Player' : b > p ? 'Banker' : 'Tie';
    }
    console.log(`[LiveBroadcast] 🔍 #${gn} disparu sans finalisation → forçage final (${pendingTargets.length} cible(s))`);
    await Promise.allSettled(pendingTargets.map(t => diffuseGame(t, forcedGame, true)));
  }

  // Nettoyage : anneau circulaire + expiration des jeux finalisés
  if (gameState.size > MAX_TRACKED_GAMES) {
    const keys = [...gameState.keys()].sort((a, b) => a - b);
    const toDelete = keys.slice(0, keys.length - MAX_TRACKED_GAMES);
    for (const k of toDelete) gameState.delete(k);
  }
  const cutoff = Date.now() - FINAL_RETENTION_MS;
  for (const [k, st] of gameState.entries()) {
    const allDone = Object.keys(st.targets).length > 0 &&
                    Object.values(st.targets).every(e => e.finalSent);
    if (allDone && st.firstSeenAt < cutoff) gameState.delete(k);
  }
}

// ── Hook principal : appelé à chaque mise à jour des jeux ───────────────────

async function onGamesUpdate(games) {
  if (!Array.isArray(games) || games.length === 0) return;

  // Stocker le snapshot le plus récent (écrase le précédent si non encore traité)
  _pendingGames = games;

  // Si un traitement est déjà en cours, il prendra ce snapshot dès sa fin
  if (_processing) return;

  // Lancer la boucle de traitement
  _processing = true;
  try {
    while (_pendingGames) {
      const toProcess = _pendingGames;
      _pendingGames   = null;
      await _processSnapshot(toProcess);
    }
  } catch (e) {
    console.error('[LiveBroadcast] erreur traitement:', e.message);
  } finally {
    _processing = false;
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
  buildMessage,
  _gameState: gameState,
};
