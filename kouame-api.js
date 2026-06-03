// ════════════════════════════════════════════════════════════════════════════
//  API KOUAMÉ — Lecture inverse du canal Telegram (format live-broadcast.js)
// ════════════════════════════════════════════════════════════════════════════
//
//  live-broadcast.js ÉDITE ses messages en place via editMessageText.
//  On doit donc écouter DEUX types d'updates Telegram :
//    • channel_post         → premier envoi d'un message (sendMessage)
//    • edited_channel_post  → toutes les mises à jour progressives (editMessageText)
//
//  Phases détectées depuis les messages :
//
//  🃏 #N{n}. Distribution des cartes...
//      → is_finished:false, phase:'Normal', 0 cartes
//
//  ⏰ #N{n}. {p}({pCards}) - {b}({bCards})
//      → is_finished:false, phase:'Normal', 2+2 cartes initiales
//
//  ⏰ #N{n}. ▶️{p}({pCards}) - {b}({bCards})
//      → is_finished:false, phase:'PlayerMove'  (joueur encore en train de tirer)
//
//  ⏰ #N{n}. {p}({pCards}) - ▶️{b}({bCards})
//      → is_finished:false, phase:'BankerMove'  (banquier tire la 3e carte)
//
//  ⏰ #N{n}. ▶️{p}({pCards}) - ▶️{b}({bCards})
//      → is_finished:false, phase:'BankerMove'  (les deux ont ≥3 cartes)
//
//  #N{n}. ✅{p}({pCards}) - {b}({bCards}) #T{t} 🔵[ #R]
//      → is_finished:true, winner:'Player'
//
//  #N{n}. {p}({pCards}) - ✅{b}({bCards}) #T{t} 🔴[ #R]
//      → is_finished:true, winner:'Banker'
//
//  #N{n}. {p}({pCards}) 🔰 {b}({bCards}) #T{t} 🟣#X[ #R]
//      → is_finished:true, winner:'Tie'
//
// ════════════════════════════════════════════════════════════════════════════

const fetch = require('node-fetch');
const db    = require('./db');

const CONFIG_KEY = 'kouame_api_config';
const POLL_MS    = 1500;
const CACHE_MAX  = 50;
const TG_TIMEOUT = 6000;

// ── État interne ─────────────────────────────────────────────────────────────
let _config  = null;
let _timer   = null;
let _games   = [];
let _lastGn  = 0;
let _status  = {
  connected:        false,
  last_update_id:   0,
  last_game_number: 0,
  last_received_at: null,
  error:            null,
};

// ── Config DB ─────────────────────────────────────────────────────────────────

async function loadConfig(force = false) {
  if (_config && !force) return _config;
  try {
    const raw = await db.getSetting(CONFIG_KEY);
    _config = raw
      ? JSON.parse(raw)
      : { bot_token: '', channel_id: '', enabled: false, last_offset: 0 };
  } catch {
    _config = { bot_token: '', channel_id: '', enabled: false, last_offset: 0 };
  }
  if (typeof _config.last_offset !== 'number') _config.last_offset = 0;
  return _config;
}

async function saveConfig(cfg) {
  _config = { ..._config, ...cfg };
  await db.setSetting(CONFIG_KEY, JSON.stringify(_config));
}

// ── Parsing des cartes ────────────────────────────────────────────────────────
// Format produit par fmtCards() dans live-broadcast.js :
//   "{rank}{suit}" × N, ex: "8♣️A♥️"  →  [{R:'8',S:'♣️'}, {R:'A',S:'♥️'}]
// Rangs : A, 2-9, 10, J, Q, K
// Suites : ♠ ♣ ♦ ♥  (avec ou sans U+FE0F variation selector)

function parseCardsStr(str) {
  if (!str) return [];
  const cards = [];
  const re = /(10|[2-9AaJjQqKk])([♠♣♦♥]\uFE0F?)/g;
  let m;
  while ((m = re.exec(str)) !== null) {
    let rank = m[1].toUpperCase();
    cards.push({ R: rank, S: m[2], raw: 0 });
  }
  return cards;
}

function cardScore(cards) {
  let s = 0;
  for (const c of cards) {
    const r = c.R;
    if (r === 'A') s += 1;
    else if (r === 'J' || r === 'Q' || r === 'K' || r === '10') s += 0;
    else { const n = parseInt(r, 10); if (!isNaN(n)) s += n; }
  }
  return s % 10;
}

// ── Parser principal ──────────────────────────────────────────────────────────
//
// Retourne un objet jeu compatible avec le moteur, ou null si le message
// n'est pas un message de jeu Baccarat.

function parseMessage(text) {
  if (!text || typeof text !== 'string') return null;

  // ── Ignorer les messages de transition "Prochain jeu" ──────────────────────
  if (text.startsWith('⏳')) return null;

  // ── Phase 1 — Distribution des cartes (aucune carte encore) ───────────────
  const distMatch = text.match(/^🃏\s*#N(\d+)\.\s*Distribution/);
  if (distMatch) {
    return {
      game_number:  parseInt(distMatch[1]),
      player_cards: [],
      banker_cards: [],
      winner:       null,
      is_finished:  false,
      phase:        'Normal',
      score:        { S1: 0, S2: 0 },
    };
  }

  // ── Ligne principale : #N{n}. … (avec ou sans préfixe ⏰) ─────────────────
  const lineRe = /^(?:⏰\s*)?#N(\d+)\.\s+(.+)$/s;
  const lm = text.match(lineRe);
  if (!lm) return null;

  const gameNumber = parseInt(lm[1]);
  const body       = lm[2].trim();

  // ── Résultat du jeu (emojis de couleur de fin) ─────────────────────────────
  const isPlayerWin = body.includes('🔵');
  const isBankerWin = body.includes('🔴');
  const isTie       = body.includes('🟣');
  const isFinished  = isPlayerWin || isBankerWin || isTie;

  // ── Détection des tirages en cours (▶️) ────────────────────────────────────
  // Format des parties non-terminées :
  //   [▶️]{score}({cartes}) - [▶️]{score}({cartes})
  //   [▶️]{score}({cartes}) 🔰 [▶️]{score}({cartes})
  //
  // ▶️ devant la PREMIÈRE partie  → c'est le joueur qui tire
  // ▶️ devant la SECONDE partie   → c'est le banquier qui tire
  //
  // On cherche la position des deux parties dans le body AVANT nettoyage
  // du ▶️ pour savoir qui est en train de tirer.

  let playerHasArrow = false;
  let bankerHasArrow = false;

  if (!isFinished) {
    // On cherche le séparateur principal : " - " ou " 🔰 "
    const sepRe = / (?:-|🔰) /;
    const sepMatch = body.match(sepRe);
    if (sepMatch) {
      const sepIdx  = body.indexOf(sepMatch[0]);
      const player  = body.slice(0, sepIdx);
      const banker  = body.slice(sepIdx + sepMatch[0].length);
      // On retire le ✅ éventuel avant de vérifier ▶️
      playerHasArrow = player.replace(/^✅/, '').startsWith('▶️');
      bankerHasArrow = banker.replace(/^✅/, '').startsWith('▶️');
    }
  }

  // ── Extraction des scores et cartes ───────────────────────────────────────
  // Pattern dans le body : [✅][▶️]{score}({cartes})
  // On extrait les deux groupes (joueur, banquier)
  const partRe = /(?:✅)?(?:▶️)?(\d+)\(([^)]*)\)/g;
  const parts  = [];
  let pm;
  while ((pm = partRe.exec(body)) !== null) {
    parts.push({ scoreVal: parseInt(pm[1]), cardsStr: pm[2] });
  }

  if (parts.length < 2) return null;

  const playerCards = parseCardsStr(parts[0].cardsStr);
  const bankerCards = parseCardsStr(parts[1].cardsStr);

  // ── Détermination du vainqueur ─────────────────────────────────────────────
  let winner = null;
  if (isTie)       winner = 'Tie';
  else if (isPlayerWin) winner = 'Player';
  else if (isBankerWin) winner = 'Banker';

  // ── Phase précise ──────────────────────────────────────────────────────────
  // Correspond aux phases utilisées par le moteur :
  //   'Normal'      → 2+2 cartes initiales, personne ne tire encore
  //   'PlayerMove'  → le joueur est encore en train de recevoir sa 3e carte
  //   'BankerMove'  → le banquier est encore en train de recevoir sa 3e carte
  //   'Win1'        → jeu terminé

  let phase = 'Normal';
  if (isFinished) {
    phase = 'Win1';
  } else if (playerHasArrow && !bankerHasArrow) {
    phase = 'PlayerMove';
  } else if (bankerHasArrow || (playerCards.length >= 3 && bankerCards.length < 3)) {
    phase = 'BankerMove';
  } else if (playerCards.length >= 2 && bankerCards.length >= 2) {
    phase = 'Normal';
  }

  return {
    game_number:  gameNumber,
    player_cards: playerCards,
    banker_cards: bankerCards,
    winner,
    is_finished:  isFinished,
    phase,
    score: {
      S1: cardScore(playerCards),
      S2: cardScore(bankerCards),
    },
  };
}

// ── Correspondance canal ──────────────────────────────────────────────────────

function normalizeChannelId(s) {
  if (!s) return '';
  return String(s).trim().replace(/^@/, '').toLowerCase();
}

function matchChannel(configuredId, chatId, chatUsername) {
  const cfg = normalizeChannelId(configuredId);
  if (!cfg) return false;
  if (String(chatId) === cfg) return true;
  if (chatUsername && normalizeChannelId(chatUsername) === cfg) return true;
  if (String(Math.abs(parseInt(cfg || '0'))) === String(Math.abs(chatId))) return true;
  return false;
}

// ── Telegram API ──────────────────────────────────────────────────────────────

// Supprime le webhook actif (cause HTTP 409 "Conflict" qui bloque getUpdates).
// À appeler avant chaque démarrage du polling.
async function tgDeleteWebhook(token) {
  try {
    const resp = await fetch(
      `https://api.telegram.org/bot${token}/deleteWebhook?drop_pending_updates=false`,
      { signal: AbortSignal.timeout(TG_TIMEOUT) }
    );
    const d = await resp.json();
    if (d.ok) console.log('[KouaméAPI] 🔓 Webhook supprimé — polling libre');
    else      console.warn('[KouaméAPI] ⚠️ deleteWebhook:', d.description);
  } catch (e) {
    console.warn('[KouaméAPI] ⚠️ deleteWebhook échoué:', e.message);
  }
}

async function tgGetUpdates(token, offset) {
  const params = new URLSearchParams({
    offset:          offset || 0,
    limit:           100,
    timeout:         0,
    // ⚠️ CRUCIAL : écouter aussi edited_channel_post
    // live-broadcast.js édite ses messages → on doit recevoir ces éditions
    allowed_updates: JSON.stringify(['channel_post', 'edited_channel_post']),
  });
  const resp = await fetch(
    `https://api.telegram.org/bot${token}/getUpdates?${params}`,
    { signal: AbortSignal.timeout(TG_TIMEOUT) }
  );
  if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
  const d = await resp.json();
  if (!d.ok) throw new Error(d.description || 'Erreur Telegram');
  return d.result || [];
}

// ── Fusion dans le cache de jeux ──────────────────────────────────────────────

function mergeGame(game) {
  const now = Date.now();
  const idx = _games.findIndex(g => g.game_number === game.game_number);
  if (idx >= 0) {
    const ex = _games[idx];
    // 1. Jeu déjà terminé → on garde (sauf si la mise à jour est aussi terminée)
    if (ex.is_finished && !game.is_finished) return;
    // 2. Sinon on prend l'état avec plus de cartes OU terminé
    const exCards  = ex.player_cards.length + ex.banker_cards.length;
    const newCards = game.player_cards.length + game.banker_cards.length;
    if (game.is_finished || newCards >= exCards) {
      _games[idx] = { ...game, _seen: now };
    }
  } else {
    _games.push({ ...game, _seen: now });
    _games.sort((a, b) => a.game_number - b.game_number);
    if (_games.length > CACHE_MAX) _games = _games.slice(-CACHE_MAX);
  }
  if (game.game_number > _lastGn) _lastGn = game.game_number;
}

// ── Boucle de polling ─────────────────────────────────────────────────────────

let _pollPauseUntil = 0; // timestamp ms — pause après une erreur 409

async function _poll() {
  const cfg = await loadConfig();
  if (!cfg.enabled || !cfg.bot_token || !cfg.channel_id) return;

  // Pause active (backoff après 409)
  if (Date.now() < _pollPauseUntil) return;

  let updates;
  try {
    updates = await tgGetUpdates(cfg.bot_token, cfg.last_offset);
    _pollPauseUntil = 0; // reset backoff si succès
  } catch (e) {
    _status.error     = e.message;
    _status.connected = false;
    // HTTP 409 = webhook encore actif : on retente deleteWebhook et on attend 5s
    if (e.message.includes('409')) {
      _pollPauseUntil = Date.now() + 5000;
      console.warn('[KouaméAPI] ⚠️ 409 Conflict — retry deleteWebhook...');
      await tgDeleteWebhook(cfg.bot_token);
    } else {
      console.warn('[KouaméAPI] ❌ Polling:', e.message);
    }
    return;
  }

  let changed = false;

  for (const upd of updates) {
    // Avancer l'offset toujours
    const newOffset = upd.update_id + 1;
    if (newOffset > (_config.last_offset || 0)) {
      _config.last_offset  = newOffset;
      _status.last_update_id = upd.update_id;
      changed = true;
    }

    // Accepter channel_post ET edited_channel_post
    // channel_post      → nouveau message (première phase ou message "prochain jeu")
    // edited_channel_post → mise à jour progressive (cartes, 3e carte, résultat final)
    const post = upd.channel_post || upd.edited_channel_post;
    if (!post || !post.text) continue;

    // Vérifier que c'est bien notre canal source
    if (!matchChannel(cfg.channel_id, post.chat.id, post.chat.username)) continue;

    const game = parseMessage(post.text);
    if (!game) continue;

    mergeGame(game);
    _status.last_game_number = _lastGn;
    _status.last_received_at = new Date().toISOString();
    _status.connected        = true;
    _status.error            = null;

    const tag = upd.edited_channel_post ? 'EDIT' : 'NEW ';
    console.log(
      `[KouaméAPI] 📥 ${tag} #N${game.game_number}` +
      ` | phase:${game.phase}` +
      ` | P:${game.player_cards.length}c B:${game.banker_cards.length}c` +
      (game.is_finished ? ` | ✅ ${game.winner}` : ' | en cours')
    );
  }

  // Sauvegarder le nouvel offset si des updates ont été traités
  if (changed) {
    saveConfig({ last_offset: _config.last_offset }).catch(() => {});
  }
}

// ── Cycle de polling ──────────────────────────────────────────────────────────

async function _startLoop() {
  if (_timer) return;
  // ⚠️ Supprimer le webhook AVANT de démarrer le polling
  // Sans ça → HTTP 409 "Conflict" en permanence → aucune mise à jour reçue
  const cfg = await loadConfig();
  if (cfg.bot_token) {
    await tgDeleteWebhook(cfg.bot_token);
  }
  _timer = setInterval(async () => {
    try { await _poll(); } catch {}
  }, POLL_MS);
  console.log('[KouaméAPI] 🔄 Polling Telegram démarré (channel_post + edited_channel_post)');
}

function _stopLoop() {
  if (_timer) {
    clearInterval(_timer);
    _timer = null;
    console.log('[KouaméAPI] ⏹ Polling Telegram arrêté');
  }
}

// ── API publique ──────────────────────────────────────────────────────────────

function isEnabled() {
  return !!(
    _config &&
    _config.enabled &&
    _config.bot_token &&
    _config.channel_id
  );
}

// Retourne les jeux récents (même interface que games.js)
// Les jeux non terminés vieux de plus de 60s sont ignorés (moteur ne se bloque plus)
function getGames() {
  const STALE_MS = 60_000;
  const now = Date.now();
  return _games.slice(-20).map(g => {
    if (!g.is_finished && g._seen && (now - g._seen) > STALE_MS) {
      // Jeu en cours depuis trop longtemps → on l'expose comme terminé sans vainqueur
      // pour que le moteur passe au suivant
      return { ...g, is_finished: true, _stale: true };
    }
    return g;
  });
}

async function getConfig() {
  const cfg = await loadConfig();
  return {
    bot_token_preview: cfg.bot_token
      ? cfg.bot_token.slice(0, 8) + '…' + cfg.bot_token.slice(-4)
      : null,
    channel_id:  cfg.channel_id  || '',
    enabled:     cfg.enabled     || false,
    last_offset: cfg.last_offset || 0,
  };
}

async function setConfig({ bot_token, channel_id, enabled }) {
  const cfg = await loadConfig(true);

  const tokenChanged   = bot_token  !== undefined && bot_token  !== cfg.bot_token;
  const channelChanged = channel_id !== undefined && channel_id !== cfg.channel_id;

  const updates = {};
  if (bot_token   !== undefined) updates.bot_token   = String(bot_token).trim();
  if (channel_id  !== undefined) updates.channel_id  = String(channel_id).trim();
  if (enabled     !== undefined) updates.enabled      = !!enabled;

  // Si le token ou le canal change → supprimer webhook + repartir de l'offset courant
  if (tokenChanged || channelChanged) {
    updates.last_offset = 0;
    const newToken = updates.bot_token || cfg.bot_token;
    if (newToken) {
      await tgDeleteWebhook(newToken);
      try {
        const latest = await tgGetUpdates(newToken, -1);
        if (latest.length > 0) {
          updates.last_offset = latest[latest.length - 1].update_id + 1;
        }
      } catch {}
    }
    _games  = [];
    _lastGn = 0;
  }

  await saveConfig(updates);

  // Stopper l'ancienne boucle avant de redémarrer (évite double polling)
  _stopLoop();
  if (_config.enabled && _config.bot_token && _config.channel_id) {
    await _startLoop();
  } else {
    _status.connected = false;
  }

  return getConfig();
}

async function resetConfig() {
  await saveConfig({ bot_token: '', channel_id: '', enabled: false, last_offset: 0 });
  _stopLoop();
  _games  = [];
  _lastGn = 0;
  _status = {
    connected:        false,
    last_update_id:   0,
    last_game_number: 0,
    last_received_at: null,
    error:            null,
  };
}

function getStatus() {
  return {
    ..._status,
    enabled:    isEnabled(),
    game_count: _games.length,
  };
}

async function testConnection(bot_token) {
  if (!bot_token) throw new Error('Token requis');
  const resp = await fetch(
    `https://api.telegram.org/bot${bot_token}/getMe`,
    { timeout: TG_TIMEOUT }
  );
  if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
  const d = await resp.json();
  if (!d.ok) throw new Error(d.description || 'Token invalide');
  return { ok: true, bot_username: d.result?.username, bot_name: d.result?.first_name };
}

async function init() {
  try {
    const cfg = await loadConfig(true);
    if (cfg.enabled && cfg.bot_token && cfg.channel_id) {
      _startLoop();
      console.log(`[KouaméAPI] ✅ Activé — lecture canal ${cfg.channel_id}`);
    } else {
      console.log('[KouaméAPI] ℹ️  Désactivé (configurable dans l\'admin > Telegram > Canaux)');
    }
  } catch (e) {
    console.warn('[KouaméAPI] Init échouée:', e.message);
  }
}

module.exports = {
  init,
  isEnabled,
  getGames,
  getConfig,
  setConfig,
  resetConfig,
  getStatus,
  testConnection,
  parseMessage, // exposé pour tests unitaires
};
