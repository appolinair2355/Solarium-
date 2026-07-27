// ════════════════════════════════════════════════════════════════════════════
//  LIVE BROADCAST — Diffusion en temps réel des parties Baccarat vers Telegram
// ════════════════════════════════════════════════════════════════════════════
//  Fonctionnalités clés :
//  • Édition PROGRESSIVE en 5 phases (Distribution → 2+2 → 3e carte → Final → Transition)
//  • Calcul du timing inter-jeux : moyenne glissante sur les 10 derniers gaps
//  • Message "⏳ Prochain #N+1 dans ~Xs" après finalisation, édité dès que N+1 arrive
//  • Protection anti-saut : si l'API saute un numéro, on retente avant de continuer
//  • Éditions limitées à 1/s par message (respect des limites Telegram)
// ════════════════════════════════════════════════════════════════════════════

const fetch = require('node-fetch');
const db    = require('./db');

const TARGETS_KEY = 'live_broadcast_targets';

// Timeout pour chaque appel Telegram (ms)
const TG_TIMEOUT_MS = 6000;

// ── Throttle des éditions Telegram (1 édit par message max toutes les 1.1s) ─
// Telegram refuse les éditions trop rapides sur le même message_id (429).
const _editThrottle = new Map(); // messageId → lastEditAt (ms)
const EDIT_COOLDOWN_MS = 1100;

function canEdit(messageId) {
  const last = _editThrottle.get(messageId) || 0;
  return Date.now() - last >= EDIT_COOLDOWN_MS;
}
function markEdited(messageId) {
  _editThrottle.set(messageId, Date.now());
  // Nettoyage : on purge les entrées > 5 min
  if (_editThrottle.size > 500) {
    const cutoff = Date.now() - 5 * 60 * 1000;
    for (const [k, v] of _editThrottle) { if (v < cutoff) _editThrottle.delete(k); }
  }
}

// ── État mémoire ─────────────────────────────────────────────────────────────
// gameState[gameNumber] = {
//   targets    : { [targetId]: { messageId, lastText, finalSent, finalAt } }
//   firstSeenAt: timestamp (première fois que ce jeu est apparu dans l'API)
//   finishedAt : timestamp (quand le message final a été envoyé)
//   lastKnown  : dernier snapshot valide (avec cartes ou terminé)
// }
const gameState = new Map();
const MAX_TRACKED_GAMES  = 200;
const FINAL_RETENTION_MS = 10 * 60 * 1000;

// nextWaiting[expectedGn] = {
//   targets  : { [targetId]: { messageId, postedAt } }
//   expectedAt: timestamp (quand on pense que le jeu arrivera)
//   fromGn   : numéro du jeu précédent
// }
const nextWaiting = new Map();
const NEXT_WAITING_EXPIRE_MS = 3 * 60 * 1000; // si pas apparu dans 3 min → purge

// ── Statistiques de timing inter-jeux ───────────────────────────────────────
// On garde les 12 derniers gaps (firstSeen[N+1] − firstSeen[N]) pour
// calculer une moyenne glissante.
const _gapHistory   = [];   // ms entre deux jeux consécutifs
const _gameDuration = [];   // ms du premier snapshot au snapshot final
const GAP_HISTORY_MAX = 12;

// Enregistre le moment où un jeu est apparu pour la première fois
const _gameFirstSeen = new Map(); // gn → timestamp

function recordGameFirstSeen(gn, ts) {
  if (_gameFirstSeen.has(gn)) return;
  _gameFirstSeen.set(gn, ts);

  // Calculer le gap depuis le jeu précédent
  const prevGn = gn - 1;
  const prevTs = _gameFirstSeen.get(prevGn);
  if (prevTs) {
    const gap = ts - prevTs;
    if (gap > 2000 && gap < 180000) { // sanity check : entre 2s et 3 min
      _gapHistory.push(gap);
      if (_gapHistory.length > GAP_HISTORY_MAX) _gapHistory.shift();
    }
  }

  // Nettoyage : on ne garde que les 30 derniers firstSeen
  if (_gameFirstSeen.size > 30) {
    const oldestGn = gn - 30;
    for (const [k] of _gameFirstSeen) { if (k < oldestGn) _gameFirstSeen.delete(k); }
  }
}

function recordGameDuration(gn, firstSeenAt, finishedAt) {
  const dur = finishedAt - firstSeenAt;
  if (dur > 5000 && dur < 180000) {
    _gameDuration.push(dur);
    if (_gameDuration.length > GAP_HISTORY_MAX) _gameDuration.shift();
  }
}

// Retourne l'estimation du délai avant le prochain jeu (ms) depuis la fin du jeu courant
function estimateNextGameDelay() {
  if (_gapHistory.length >= 3) {
    // Moyenne des gaps récents − durée moyenne d'un jeu (≈ temps post-fin avant apparition)
    const avgGap = _gapHistory.reduce((a, b) => a + b, 0) / _gapHistory.length;
    const avgDur = _gameDuration.length >= 3
      ? _gameDuration.reduce((a, b) => a + b, 0) / _gameDuration.length
      : avgGap * 0.7;
    const delay = Math.max(5000, avgGap - avgDur);
    return Math.round(delay / 1000) * 1000; // arrondi à la seconde
  }
  // Valeur par défaut si pas assez d'historique : 25 secondes
  return 25000;
}

// ── Cibles : load / save ────────────────────────────────────────────────────

let cachedTargets = null;
let cachedAt = 0;
const TARGETS_TTL = 5000;

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
  for (const wt of nextWaiting.values()) {
    if (wt.targets && wt.targets[id]) delete wt.targets[id];
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

// ── Construction du message — 5 phases progressives ─────────────────────────
//
//  PHASE 1 — Aucune carte encore         : 🃏 #N{n}. Distribution...
//  PHASE 2 — 2+2 cartes initiales        : ⏰ #N{n}. P:{p}({pCards}) ↔ B:{b}({bCards})
//  PHASE 3 — 3e carte en cours (flèche)  : ⏰ #N{n}. P:▶️{p}({pCards}) ↔ B:{b}({bCards})
//  PHASE 4 — Résultat final (2/2 → 3/x)  : #N{n}. ✅{p}({pCards}) - {b}({bCards}) 🔵[#R]
//  (Après phase 4, le caller poste une 5e transition "Prochain jeu")

function buildMessage(g) {
  const pCards = Array.isArray(g.player_cards) ? g.player_cards : [];
  const bCards = Array.isArray(g.banker_cards) ? g.banker_cards : [];
  const p      = score(pCards);
  const b      = score(bCards);
  const pFmt   = fmtCards(pCards);
  const bFmt   = fmtCards(bCards);
  const total  = p + b;
  const n      = g.game_number;
  const winner = g.winner;
  const finished = !!g.is_finished || winner === 'Player' || winner === 'Banker' || winner === 'Tie';

  // ── PHASE 4 : terminé ────────────────────────────────────────────────────
  if (finished) {
    const naturalEnd = pCards.length === 2 && bCards.length === 2;
    const rTag = naturalEnd ? ' #R' : '';

    if (winner === 'Tie')    return `#N${n}. ${p}(${pFmt}) 🔰 ${b}(${bFmt}) #T${total} 🟣#X${rTag}`;
    if (winner === 'Player') return `#N${n}. ✅${p}(${pFmt}) - ${b}(${bFmt}) #T${total} 🔵${rTag}`.trimEnd();
    if (winner === 'Banker') return `#N${n}. ${p}(${pFmt}) - ✅${b}(${bFmt}) #T${total} 🔴${rTag}`.trimEnd();
    // Fallback si winner absent mais is_finished = true
    if (p === b)   return `#N${n}. ${p}(${pFmt}) 🔰 ${b}(${bFmt}) #T${total} 🟣#X${rTag}`;
    if (p > b)     return `#N${n}. ✅${p}(${pFmt}) - ${b}(${bFmt}) #T${total} 🔵${rTag}`.trimEnd();
                   return `#N${n}. ${p}(${pFmt}) - ✅${b}(${bFmt}) #T${total} 🔴${rTag}`.trimEnd();
  }

  // ── PHASE 1 : aucune carte ───────────────────────────────────────────────
  if (pCards.length === 0 && bCards.length === 0) {
    return `🃏 #N${n}. Distribution des cartes...`;
  }

  // ── PHASE 2 / 3 : cartes en cours ────────────────────────────────────────
  const ph = g.phase || '';
  const playerDrawing = ph === 'PlayerMove';
  const bankerDrawing = ph === 'BankerMove' || ph === 'DealerMove' || ph === 'ThirdCard';

  // Si l'une des mains a 3 cartes mais le jeu n'est pas encore marqué terminé :
  // on indique la 3e carte avec la flèche de la bonne couleur
  const pHas3 = pCards.length >= 3;
  const bHas3 = bCards.length >= 3;

  let pPart, bPart;
  if (playerDrawing || pHas3) {
    pPart = `▶️${p}(${pFmt})`;
  } else {
    pPart = `${p}(${pFmt})`;
  }
  if (bankerDrawing || bHas3) {
    bPart = `▶️${b}(${bFmt})`;
  } else {
    bPart = `${b}(${bFmt})`;
  }

  return `⏰ #N${n}. ${pPart} - ${bPart}`;
}

function buildNextGameLiveMessage(nextGn) {
  return `🃏 #N${nextGn}. Distribution des cartes...`;
}

// ── Appels Telegram bas niveau ───────────────────────────────────────────────

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
    err.code  = d?.error_code || resp.status;
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
    err.code  = d?.error_code || resp.status;
    throw err;
  }
  return messageId;
}

// Edition avec throttle
async function tgEditThrottled(token, chatId, messageId, text) {
  if (!canEdit(messageId)) return null; // trop tôt — on skip (sera fait au prochain cycle)
  markEdited(messageId);
  return tgEditMessage(token, chatId, messageId, text);
}

// ── Détermine si un jeu est complètement terminé (données fiables) ───────────

function isDefinitivelyFinished(g) {
  if (!g.is_finished) return false;
  if (g.winner === 'Player' || g.winner === 'Banker' || g.winner === 'Tie') return true;
  const pLen = Array.isArray(g.player_cards) ? g.player_cards.length : 0;
  const bLen = Array.isArray(g.banker_cards) ? g.banker_cards.length : 0;
  return pLen >= 2 && bLen >= 2;
}

// ── Diffusion d'un jeu vers UNE cible ───────────────────────────────────────

async function diffuseGame(target, game, finishedNow) {
  const text = buildMessage(game);
  const gn   = game.game_number;
  const now  = Date.now();

  let st = gameState.get(gn);
  if (!st) {
    st = { targets: {}, firstSeenAt: now, finishedAt: null, lastKnown: null };
    gameState.set(gn, st);
    recordGameFirstSeen(gn, now);
  }

  // Mémoriser le dernier état valide
  const hasCards = (game.player_cards?.length || 0) > 0 || (game.banker_cards?.length || 0) > 0;
  if (hasCards || game.is_finished) {
    st.lastKnown = { ...game };
  }

  let entry = st.targets[target.id];
  if (!entry) entry = st.targets[target.id] = { messageId: null, lastText: null, finalSent: false, finalAt: null };

  if (entry.finalSent) return;

  // Vérifier si ce jeu avait un message "prochain jeu" en attente → on le réutilise
  const waitEntry = nextWaiting.get(gn)?.targets?.[target.id];

  // Phase 1 (pas de cartes) : on ne poste que si le message "prochain jeu" est déjà là
  // Sinon on skip pour éviter les messages vides qui sautent trop vite
  const hasNoCards = (game.player_cards?.length || 0) === 0 && (game.banker_cards?.length || 0) === 0;
  if (hasNoCards && !game.is_finished) {
    if (waitEntry?.messageId && !entry.messageId) {
      // Réutiliser le message de transition "Prochain jeu" → l'éditer en "Distribution..."
      const transText = buildNextGameLiveMessage(gn);
      try {
        await tgEditThrottled(target.bot_token, target.channel_id, waitEntry.messageId, transText);
        entry.messageId = waitEntry.messageId;
        entry.lastText  = transText;
        // Marquer la transition comme consommée
        delete nextWaiting.get(gn)?.targets?.[target.id];
        const lbl = target.label || target.id;
        console.log(`[LiveBroadcast] 🔄 #${gn} TRANS → [${lbl}] (recycled next-game msg) | ${transText}`);
      } catch (e) {
        console.warn(`[LiveBroadcast] ❌ #${gn} [${target.label || target.id}] edit trans: ${e.message}`);
      }
    }
    return; // on attend d'avoir des vraies cartes
  }

  if (entry.lastText === text) return;

  const definitivelyDone = finishedNow && isDefinitivelyFinished(game);
  const lbl = target.label || target.id;

  try {
    if (entry.messageId) {
      // Édition avec throttle anti-429
      const ok = await tgEditThrottled(target.bot_token, target.channel_id, entry.messageId, text);
      if (ok !== null) {
        if (definitivelyDone) {
          console.log(`[LiveBroadcast] 🏁 #${gn} FINAL → [${lbl}] | ${text}`);
          st.finishedAt = now;
          entry.finalAt = now;
          recordGameDuration(gn, st.firstSeenAt, now);
        } else {
          console.log(`[LiveBroadcast] ✏️  #${gn} EDIT  → [${lbl}] | ${text}`);
        }
        entry.lastText = text;
        if (definitivelyDone) entry.finalSent = true;
      }
    } else {
      // Nouveau message : récupérer le messageId du "prochain jeu" si disponible
      let mid;
      if (waitEntry?.messageId) {
        // Éditer le message de transition au lieu d'en envoyer un nouveau
        await tgEditThrottled(target.bot_token, target.channel_id, waitEntry.messageId, text);
        mid = waitEntry.messageId;
        delete nextWaiting.get(gn)?.targets?.[target.id];
        console.log(`[LiveBroadcast] 🔁 #${gn} RECYCLE → [${lbl}] msgId=${mid} | ${text}`);
      } else {
        mid = await tgSendMessage(target.bot_token, target.channel_id, text);
        console.log(`[LiveBroadcast] 📨 #${gn} ENVOI  → [${lbl}] msgId=${mid} | ${text}`);
      }
      entry.messageId = mid;
      entry.lastText  = text;
      if (definitivelyDone) {
        entry.finalSent = true;
        entry.finalAt   = now;
        st.finishedAt   = now;
        recordGameDuration(gn, st.firstSeenAt, now);
      }
    }
  } catch (e) {
    console.warn(`[LiveBroadcast] ❌ #${gn} [${lbl}] erreur: ${e.message}`);
  }
}


// ── Diffusion vers TOUTES les cibles en parallèle ────────────────────────────

async function diffuseGameAllTargets(targets, game, finishedNow) {
  await Promise.allSettled(
    targets.map(t => {
      const st    = gameState.get(game.game_number);
      const entry = st?.targets?.[t.id];
      if (entry?.finalSent) return Promise.resolve();
      return diffuseGame(t, game, finishedNow);
    })
  );
}

// ── Vérifie si un jeu est entièrement finalisé sur toutes les cibles ─────────
function isFullyFinalized(gn, targets) {
  const st = gameState.get(gn);
  if (!st || Object.keys(st.targets).length === 0) return false;
  return targets.every(t => st.targets[t.id]?.finalSent === true);
}

// ── File d'attente interne ───────────────────────────────────────────────────

let _processing   = false;
let _pendingGames = null;

function mergeSnapshots(oldGames, newGames) {
  if (!oldGames || oldGames.length === 0) return newGames;
  if (!newGames || newGames.length === 0) return oldGames;

  const map = new Map();

  for (const g of oldGames) {
    if (g?.game_number) map.set(g.game_number, g);
  }

  for (const g of newGames) {
    if (!g?.game_number) continue;
    const existing = map.get(g.game_number);
    if (!existing) {
      map.set(g.game_number, g);
    } else {
      const existFinished = !!existing.is_finished;
      const newFinished   = !!g.is_finished;
      if (newFinished && !existFinished) {
        map.set(g.game_number, g);
      } else if (!newFinished && !existFinished) {
        const existCards = (existing.player_cards?.length || 0) + (existing.banker_cards?.length || 0);
        const newCards   = (g.player_cards?.length || 0)       + (g.banker_cards?.length || 0);
        if (newCards >= existCards) map.set(g.game_number, g);
      }
    }
  }

  const result = [];
  for (const [gn, g] of map.entries()) {
    const st = gameState.get(gn);
    if (st) {
      const allDone = Object.keys(st.targets).length > 0 &&
                      Object.values(st.targets).every(e => e.finalSent);
      if (allDone) continue;
    }
    result.push(g);
  }
  return result;
}

// ── Traitement interne d'un snapshot ─────────────────────────────────────────

async function _processSnapshot(games) {
  const targets = (await loadTargets()).filter(t => t.enabled !== false);
  if (targets.length === 0) {
    const now = Date.now();
    if (!_processSnapshot._lastNoTargetLog || now - _processSnapshot._lastNoTargetLog > 60000) {
      console.log('[LiveBroadcast] ℹ️  Aucune cible active — diffusion désactivée');
      _processSnapshot._lastNoTargetLog = now;
    }
    return;
  }

  // Classer : nouveaux EN PREMIER (par ordre croissant), puis connus
  const newGames   = [];
  const knownGames = [];
  const skipped    = [];

  for (const g of games) {
    if (!g || !g.game_number) continue;
    const hasCards = (g.player_cards?.length || 0) > 0 || (g.banker_cards?.length || 0) > 0;

    // On accepte aussi les jeux sans cartes s'ils ont un message "prochain jeu" en attente
    const hasNextWaiting = nextWaiting.has(g.game_number);

    if (!hasCards && !g.is_finished && !hasNextWaiting) {
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
    console.log(`[LiveBroadcast] ⏳ Jeu(x) #${skipped.join(',')} ignoré(s) — pas de cartes encore`);
  }

  newGames.sort((a, b) => a.game_number - b.game_number);
  knownGames.sort((a, b) => a.game_number - b.game_number);
  const sorted = [...newGames, ...knownGames];

  if (sorted.length > 0) {
    const newNums   = newGames.map(g => '#' + g.game_number).join(',');
    const knownNums = knownGames.map(g => '#' + g.game_number).join(',');
    console.log(`[LiveBroadcast] 🎯 ${targets.length} cible(s) | Nouveaux: [${newNums || '—'}] Connus: [${knownNums || '—'}]`);
  }

  // Ensemble des numéros AVANT ce snapshot (pour détecter les jeux finalisés après)
  const justFinalized = new Set();

  for (const g of sorted) {
    const finishedNow      = !!g.is_finished;
    const wasFullyFinal    = isFullyFinalized(g.game_number, targets);
    await diffuseGameAllTargets(targets, g, finishedNow);

  }

  // ── Finalisation des jeux disparus de l'API ───────────────────────────────
  const snapshotNums = new Set(games.map(g => g.game_number));
  for (const [gn, st] of gameState.entries()) {
    if (snapshotNums.has(gn)) continue;
    if (!st.lastKnown) continue;

    const pendingTargets = targets.filter(t => {
      const e = st.targets[t.id];
      return e && e.messageId && !e.finalSent;
    });
    if (pendingTargets.length === 0) continue;

    // Le jeu a disparu sans être finalisé : forcer l'état final
    const forcedGame = { ...st.lastKnown, is_finished: true };
    if (!forcedGame.winner) {
      const p = score(forcedGame.player_cards);
      const b = score(forcedGame.banker_cards);
      forcedGame.winner = p > b ? 'Player' : b > p ? 'Banker' : 'Tie';
    }
    console.log(`[LiveBroadcast] 🔍 #${gn} disparu sans finalisation → forçage final (${pendingTargets.length} cible(s))`);
    await Promise.allSettled(pendingTargets.map(t => diffuseGame(t, forcedGame, true)));
  }

  // ── Nettoyage ─────────────────────────────────────────────────────────────
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

  // Nettoyage des nextWaiting expirés
  const expireCutoff = Date.now() - NEXT_WAITING_EXPIRE_MS;
  for (const [gn, wt] of nextWaiting.entries()) {
    if (wt.expectedAt < expireCutoff || gameState.has(gn)) {
      nextWaiting.delete(gn);
    }
  }
}

// ── Hook principal ───────────────────────────────────────────────────────────

async function onGamesUpdate(games) {
  if (!Array.isArray(games) || games.length === 0) return;

  _pendingGames = mergeSnapshots(_pendingGames, games);
  if (_processing) return;

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

// ── Test d'envoi ─────────────────────────────────────────────────────────────

async function sendTestMessage(targetId) {
  const list = await loadTargets(true);
  const t = list.find(x => x.id === targetId);
  if (!t) throw new Error('Cible introuvable');
  const text = `✅ Test diffusion live — canal connecté\n#N0000. ✅9(8♣️A♥️) - 3(6♥️7♠️) #T12 🔵 #R`;
  const mid = await tgSendMessage(t.bot_token, t.channel_id, text);
  return { ok: true, message_id: mid };
}

module.exports = {
  onGamesUpdate,
  loadTargets, listTargets, addTarget, removeTarget, setTargetEnabled,
  sendTestMessage,
  buildMessage,
  _gameState: gameState,
  _nextWaiting: nextWaiting,
  _gapHistory,
  estimateNextGameDelay,
};
