const express = require('express');
const fetch = require('node-fetch');
const router = express.Router();

// ── Endpoints principaux (1xBet + miroirs régionaux) ─────────────────────────
// Les miroirs partagent la même infrastructure backend — même données, IPs différentes
// ce qui offre une redondance naturelle quand le nœud principal est lent ou bloqué.
const CHAMP_PATH   = '/LiveFeed/GetChampZip';
const CHAMP_PARAMS_STR = 'champ=2050671';
const CHAMP_API_URL  = 'https://1xbet.com' + CHAMP_PATH;
const CHAMP_API_PARAMS = new URLSearchParams({ champ: 2050671 });

// Miroirs régionaux 1xBet (même API, nœuds CDN différents)
const MIRROR_HOSTS = [
  'https://1xbet-africa.com',
  'https://1xbet.cm',
  'https://1xbet.ng',
  'https://1xbet.gh',
  'https://1xbet.cd',
];

// ── Endpoint confirmé non-bloqué : 1xbet.cd service-api ──────────────────────
const CD_RESCUE_URL    = 'https://1xbet.cd/service-api/LiveFeed/GetChampZip';
const CD_RESCUE_PARAMS = new URLSearchParams({
  champ: 2050671, lng: 'en', country: 96, groupChamps: 'true',
});
const CD_RESCUE_HEADERS = {
  'accept': 'application/json, text/plain, */*',
  'accept-language': 'fr-FR,fr;q=0.9,en-US;q=0.8',
  'content-type': 'application/json',
  'is-srv': 'false',
  'x-app-n': 'BETTING_APP',
  'x-requested-with': 'XMLHttpRequest',
  'x-svc-source': 'BETTING_APP',
  'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/147.0.0.0 Safari/537.36 Edg/147.0.0.0',
  'origin': 'https://1xbet.cd',
  'referer': 'https://1xbet.cd/fr/live/baccarat/2050671-baccara/726599901-player-banker',
  'sec-fetch-dest': 'empty',
  'sec-fetch-mode': 'cors',
  'sec-fetch-site': 'same-origin',
};

// ── Ancien endpoint de secours (GetSportsShortZip) ───────────────────────────
const API_URL = 'https://1xbet.com/service-api/LiveFeed/GetSportsShortZip';
const API_PARAMS = new URLSearchParams({
  sports: 236, champs: 2050671, lng: 'en', gr: 285,
  country: 96, virtualSports: 'true', groupChamps: 'true',
});

// ── API secours live renforcée (service-api/LiveFeed/GetChampZip) ─────────────
// Chemin alternatif avec headers enrichis (x-app-n, x-hd, x-svc-source, etc.)
const RESCUE_CHAMP_URL    = 'https://1xbet.com/service-api/LiveFeed/GetChampZip';
const RESCUE_CHAMP_PARAMS = new URLSearchParams({
  champ: 2050671, lng: 'en', country: 96, groupChamps: 'true',
});
const RESCUE_CHAMP_HEADERS = {
  'accept': 'application/json, text/plain, */*',
  'accept-language': 'en-GB,en;q=0.9,en-US;q=0.8',
  'content-type': 'application/json',
  'is-srv': 'false',
  'priority': 'u=1, i',
  'referer': 'https://1xbet.com/en/live/baccarat/2050671-baccara/716400636-player-banker',
  'sec-ch-ua': '"Microsoft Edge";v="147", "Not.A/Brand";v="8", "Chromium";v="147"',
  'sec-ch-ua-mobile': '?0',
  'sec-ch-ua-platform': '"Windows"',
  'sec-fetch-dest': 'empty',
  'sec-fetch-mode': 'cors',
  'sec-fetch-site': 'same-origin',
  'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/147.0.0.0 Safari/537.36 Edg/147.0.0.0',
  'x-app-n': 'BETTING_APP',
  'x-mobile-project-id': '0',
  'x-requested-with': 'XMLHttpRequest',
  'x-svc-source': 'BETTING_APP',
};

const API_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  'Accept': 'application/json, text/plain, */*',
  'Accept-Language': 'fr-FR,fr;q=0.9,en-US;q=0.8,en;q=0.7',
  'Accept-Encoding': 'gzip, deflate, br',
  'Origin': 'https://1xbet.com',
  'Referer': 'https://1xbet.com/fr/live/baccarat',
  'Sec-Fetch-Dest': 'empty',
  'Sec-Fetch-Mode': 'cors',
  'Sec-Fetch-Site': 'same-origin',
  'Connection': 'keep-alive',
};

const SUIT_MAP = { 0: '♠️', 1: '♣️', 2: '♦️', 3: '♥️' };
let gamesCache     = [];
let lastFetch      = 0;
let lastClientPush = 0;
let lastFingerprint = '';
const CACHE_TTL    = 800;
let lastDataSource = 'server'; // 'server' (1xBet direct) | 'kouame' | 'proxy'

// ── Détection de gap (jeu sauté) ─────────────────────────────────────────────
// On trace le plus grand game_number vu jusqu'ici.
// Si l'API passe de N à N+2 sans passer par N+1, on déclenche des refetch rapides.
let _lastMaxGn = 0;
let _gapRetryTimer = null;
const GAP_RETRY_ATTEMPTS = 4;  // nombre de tentatives pour récupérer le jeu manquant
const GAP_RETRY_INTERVAL = 800; // ms entre chaque tentative

function _detectAndHandleGap(parsed) {
  const maxGn = parsed.reduce((m, g) => Math.max(m, g.game_number || 0), 0);
  if (maxGn === 0) return;

  if (_lastMaxGn > 0 && maxGn > _lastMaxGn + 1) {
    const missing = [];
    for (let gn = _lastMaxGn + 1; gn < maxGn; gn++) missing.push(gn);
    if (missing.length > 0 && missing.length <= 3) {
      console.log(`[Games] ⚠️ Gap détecté : jeu(x) #${missing.join(',')} absent(s) → refetch rapide`);
      _triggerGapRefetch(missing);
    }
  }

  _lastMaxGn = Math.max(_lastMaxGn, maxGn);
}

function _triggerGapRefetch(missingGns) {
  if (_gapRetryTimer) return; // déjà en cours
  let attempt = 0;
  _gapRetryTimer = setInterval(async () => {
    attempt++;
    try {
      const fresh = await fetchGamesForce();
      const foundAll = missingGns.every(gn => fresh.some(g => g.game_number === gn));
      if (foundAll) {
        console.log(`[Games] ✅ Gap comblé après ${attempt} tentative(s) — jeu(x) #${missingGns.join(',')}`);
        clearInterval(_gapRetryTimer);
        _gapRetryTimer = null;
        return;
      }
    } catch {}
    if (attempt >= GAP_RETRY_ATTEMPTS) {
      console.log(`[Games] ℹ️ Gap #${missingGns.join(',')} non comblé après ${attempt} tentatives — jeu probablement trop court`);
      clearInterval(_gapRetryTimer);
      _gapRetryTimer = null;
    }
  }, GAP_RETRY_INTERVAL);
}

// ── Polling serveur autonome ──────────────────────────────────────────────────
// Interroge l'API 1xBet toutes les 1.5s côté serveur, indépendamment des
// client-push. Garantit que les jeux arrivent même quand aucun navigateur
// n'est connecté (ex : nuit, perte de connexion côté client).
const SERVER_POLL_INTERVAL = 1500; // ms
let _serverPollActive = false;

function startServerPoll() {
  if (_serverPollActive) return;
  _serverPollActive = true;
  console.log('[Games] 🔄 Polling serveur démarré (toutes les 1.5s)');

  setInterval(async () => {
    try {
      await fetchGames();
    } catch {}
  }, SERVER_POLL_INTERVAL);
}

// ── SSE Broadcaster ──────────────────────────────────────────────────────────
// Tous les clients SSE connectés sont stockés ici.
// Dès que le cache change, on leur pousse immédiatement les nouvelles données.
const sseClients = new Set();

function gamesFingerprint(games) {
  return games.map(g =>
    `${g.game_number}:${g.player_cards.length}:${g.banker_cards.length}:${g.is_finished ? 1 : 0}:${g.phase || ''}`
  ).join('|');
}

function broadcastGames(games) {
  if (sseClients.size === 0) return;
  const payload = `data: ${JSON.stringify(games)}\n\n`;
  for (const res of sseClients) {
    try {
      res.write(payload);
      if (res.flush) res.flush();
    } catch { sseClients.delete(res); }
  }
}

function updateCache(parsed, source) {
  const fp = gamesFingerprint(parsed);
  if (fp === lastFingerprint) return false; // rien de nouveau

  // Détecter un éventuel saut de numéro AVANT d'écraser le cache
  _detectAndHandleGap(parsed);

  gamesCache      = parsed;
  lastFetch       = Date.now();
  lastFingerprint = fp;
  if (source === 'push') lastClientPush = Date.now();
  if (source && source !== 'push') lastDataSource = source;
  broadcastGames(gamesCache); // push immédiat à tous les clients SSE
  // Diffusion live vers les canaux Telegram configurés (sans bloquer)
  try {
    require('./live-broadcast').onGamesUpdate(gamesCache).catch(e =>
      console.warn('[LiveBroadcast] hook error:', e.message));
  } catch (e) { /* module absent — ignoré */ }
  // Notifier le wallet des jeux terminés (pour résolution persistante des mises)
  try {
    const { notifyGameResult } = require('./baccara-wallet-route');
    if (typeof notifyGameResult === 'function') {
      for (const g of gamesCache) if (g.is_finished && g.winner) notifyGameResult(g);
    }
  } catch(_) {}
  return true;
}

// ─────────────────────────────────────────────────────────────────────────────

function parseCards(scSList) {
  let player = [], banker = [];
  for (const entry of (scSList || [])) {
    const key = entry.Key || '';
    let cards = [];
    try { cards = JSON.parse(entry.Value || '[]'); } catch {}
    if (key === 'P') player = cards;
    else if (key === 'B') banker = cards;
  }
  const fmt = cards => cards.map(c => ({ S: SUIT_MAP[c.S] || '?', R: (c.R !== undefined && c.R !== null) ? c.R : '?', raw: c.S }));
  return { player: fmt(player), banker: fmt(banker) };
}

const FINISHED_PHASES = ['Win1', 'Win2', 'Tie', 'Match finished'];

function parseWinner(scSList) {
  for (const e of (scSList || [])) {
    if (e.Key === 'S') {
      if (e.Value === 'Win1') return 'Player';
      if (e.Value === 'Win2') return 'Banker';
      if (e.Value === 'Tie')  return 'Tie';
    }
  }
  return null;
}

function parsePhase(scSList) {
  for (const e of (scSList || [])) {
    if (e.Key === 'S') return e.Value || null;
  }
  return null;
}

function isGameFinished(game, scSList) {
  if (game.F) return true;
  const sc = game.SC || {};
  if (sc.CPS === 'Match finished') return true;
  const phase = parsePhase(scSList);
  if (phase && FINISHED_PHASES.includes(phase)) return true;
  const winner = parseWinner(scSList);
  if (winner !== null) return true;
  return false;
}

// Services proxy pour contourner le blocage IP de 1xBet
const PROXY_SERVICES = [
  url => `https://api.allorigins.win/raw?url=${encodeURIComponent(url)}`,
  url => `https://corsproxy.io/?${encodeURIComponent(url)}`,
  url => `https://api.codetabs.com/v1/proxy?quest=${encodeURIComponent(url)}`,
  url => `https://thingproxy.freeboard.io/fetch/${url}`,
];

let _lastProxyAttempt = 0;
const PROXY_COOLDOWN = 1000; // 1s entre deux séries de tentatives proxy
let _directApiWarned = false; // logguer le blocage API directe une seule fois

async function fetchGamesViaProxy() {
  const now = Date.now();
  if (now - _lastProxyAttempt < PROXY_COOLDOWN) return gamesCache;
  _lastProxyAttempt = now;

  // ⭐ service-api/GetChampZip est le meilleur endpoint confirmé — priorité absolue
  const rescueUrl = `${RESCUE_CHAMP_URL}?${RESCUE_CHAMP_PARAMS}`;
  const champUrl  = `${CHAMP_API_URL}?${CHAMP_API_PARAMS}`;
  const oldUrl    = `${API_URL}?${API_PARAMS}`;

  const tryProxy = async (proxyFn, targetUrl, parserFn) => {
    try {
      const resp = await fetch(proxyFn(targetUrl), { timeout: 3000 });
      if (!resp.ok) return null;
      const data = await resp.json();
      const parsed = parserFn(data);
      return (parsed && parsed.length > 0) ? parsed : null;
    } catch { return null; }
  };

  // Phase 1 ⭐ : service-api/GetChampZip — race sur les 4 proxies en parallèle
  const rescueResults = await Promise.all(
    PROXY_SERVICES.map(fn => tryProxy(fn, rescueUrl, parseChampData))
  );
  for (const parsed of rescueResults) {
    if (parsed) {
      updateCache(parsed, 'server');
      console.log('[Games] ✅ Données service-api/GetChampZip via proxy (prioritaire)');
      return gamesCache;
    }
  }

  // Phase 2 : GetChampZip (chemin standard) — race 4 proxies en parallèle
  const champResults = await Promise.all(
    PROXY_SERVICES.map(fn => tryProxy(fn, champUrl, parseChampData))
  );
  for (const parsed of champResults) {
    if (parsed) {
      updateCache(parsed, 'server');
      console.log('[Games] ✅ Données GetChampZip via proxy');
      return gamesCache;
    }
  }

  // Phase 3 : GetSportsShortZip — race 4 proxies en parallèle
  const oldResults = await Promise.all(
    PROXY_SERVICES.map(fn => tryProxy(fn, oldUrl, parseRawData))
  );
  for (const parsed of oldResults) {
    if (parsed) {
      updateCache(parsed, 'server');
      console.log('[Games] ✅ Données GetSportsShortZip via proxy');
      return gamesCache;
    }
  }
  return gamesCache;
}

// ── Fetch depuis un hôte spécifique (principal ou miroir) ────────────────────
async function _fetchFromHost(host, timeoutMs = 3500) {
  const url = `${host}${CHAMP_PATH}?${CHAMP_PARAMS_STR}`;
  const headers = { ...API_HEADERS, Origin: host, Referer: `${host}/fr/live/baccarat` };
  const resp = await fetch(url, { headers, timeout: timeoutMs });
  if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
  const data = await resp.json();
  const parsed = parseChampData(data);
  if (!parsed || parsed.length === 0) throw new Error('Pas de données');
  return parsed;
}

// ── Race entre hôte principal + miroirs régionaux ────────────────────────────
// Tous lancés simultanément ; le premier qui répond avec des données valides gagne.
// Si le principal répond en 0–200 ms on l'utilisera presque toujours ;
// si bloqué, un miroir prend le relais sans délai supplémentaire.
async function _fetchRaceMirrors() {
  const allHosts = ['https://1xbet.com', ...MIRROR_HOSTS];
  const promises = allHosts.map((host, idx) =>
    _fetchFromHost(host, 3500).then(data => ({ data, host, idx }))
  );
  // Promise.any : résout dès qu'un succeed, rejeté si tous échouent
  try {
    const winner = await Promise.any(promises);
    if (winner.host !== 'https://1xbet.com') {
      console.log(`[Games] 🔀 Miroir utilisé : ${winner.host}`);
    }
    return winner.data;
  } catch {
    return null;
  }
}

async function fetchGames() {
  const now = Date.now();

  // ── API Kouamé — remplace 1xBet quand activée ───────────────────────────
  try {
    const kouame = require('./kouame-api');
    if (kouame.isEnabled()) {
      const kg = kouame.getGames();
      if (kg.length > 0) updateCache(kg, 'kouame');
      return gamesCache;
    }
  } catch { /* module absent — ignoré */ }

  if (now - lastFetch < CACHE_TTL && gamesCache.length > 0) return gamesCache;

  // 0. ⭐ Priorité absolue : 1xbet.cd/service-api — confirmé non-bloqué sur ce serveur
  try {
    const resp = await fetch(`${CD_RESCUE_URL}?${CD_RESCUE_PARAMS}`, {
      headers: CD_RESCUE_HEADERS, timeout: 4000,
    });
    if (resp.ok) {
      const data = await resp.json();
      const parsed = parseChampData(data);
      if (parsed && parsed.length > 0) {
        updateCache(parsed, 'server');
        return gamesCache;
      }
    }
  } catch { /* silencieux — on continue vers fallbacks */ }

  // 1. Race principal + miroirs simultanément (le plus rapide/disponible gagne)
  try {
    const parsed = await _fetchRaceMirrors();
    if (parsed && parsed.length > 0) {
      updateCache(parsed, 'server');
      return gamesCache;
    }
    if (!_directApiWarned) { _directApiWarned = true; console.log('[Games] ⚠️ API directe 1xBet bloquée (IP serveur) — proxy utilisé en permanent'); }
  } catch (e) {
    if (!_directApiWarned) { _directApiWarned = true; console.log(`[Games] ⚠️ API directe inaccessible (${e.message}) — proxy activé`); }
  }

  // 2. ⭐ Meilleur endpoint confirmé : service-api/GetChampZip (headers enrichis)
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const resp = await fetch(`${RESCUE_CHAMP_URL}?${RESCUE_CHAMP_PARAMS}`, {
        headers: RESCUE_CHAMP_HEADERS, timeout: 4000,
      });
      if (resp.ok) {
        const data = await resp.json();
        const parsed = parseChampData(data);
        if (parsed && parsed.length > 0) {
          updateCache(parsed, 'server');
          console.log('[Games] ✅ service-api/GetChampZip (prioritaire) OK');
          return gamesCache;
        }
      }
    } catch {}
    if (attempt < 3) await new Promise(r => setTimeout(r, 300));
  }

  // 3. Fallback : GetChampZip chemin standard
  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      const parsed = await _fetchRaceMirrors();
      if (parsed && parsed.length > 0) {
        updateCache(parsed, 'server');
        console.log('[Games] ⚠️ Fallback GetChampZip standard utilisé');
        return gamesCache;
      }
    } catch {}
    if (attempt < 2) await new Promise(r => setTimeout(r, 300));
  }

  // 4. Fallback : GetSportsShortZip
  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      const resp = await fetch(`${API_URL}?${API_PARAMS}`, { headers: API_HEADERS, timeout: 4000 });
      if (resp.ok) {
        const data = await resp.json();
        const parsed = parseRawData(data);
        if (parsed && parsed.length > 0) {
          updateCache(parsed, 'server');
          console.log('[Games] ⚠️ Fallback GetSportsShortZip utilisé');
          return gamesCache;
        }
      }
    } catch {}
    if (attempt < 2) await new Promise(r => setTimeout(r, 300));
  }

  // 5. Dernier recours : services proxy
  return fetchGamesViaProxy();
}

// Force fetch : bypass le cache TTL et relance immédiatement 3 essais directs + proxies.
// Utilisé par le moteur pour tenter de récupérer un jeu manquant après détection de gap.
async function fetchGamesForce() {
  lastFetch = 0;
  return fetchGames();
}

// ── Parser pour le nouvel endpoint GetChampZip ────────────────────────────────
// Structure : data.Value.G = [game1, game2, ...]
function parseChampData(data) {
  const val = data?.Value;
  if (!val || typeof val !== 'object' || Array.isArray(val)) return null;
  const games = val.G;
  if (!Array.isArray(games) || games.length === 0) return null;
  const champName = val.LE || val.L || val.SE || 'Baccarat';
  const results = [];
  for (const game of games) {
    if (!game.DI) continue;
    const gn = parseInt(game.DI);
    if (!Number.isFinite(gn) || gn <= 0) continue;
    const sc  = game.SC || {};
    const scS = sc.S  || [];
    const { player, banker } = parseCards(scS);
    results.push({
      game_number:  gn,
      player_cards: player, banker_cards: banker,
      winner:       parseWinner(scS),
      is_finished:  isGameFinished(game, scS),
      phase:        parsePhase(scS),
      score:        sc.FS || {},
      championship: champName,
      status_label: sc.I || sc.SLS || '',
    });
  }
  results.sort((a, b) => b.game_number - a.game_number);
  return results.length > 0 ? results : null;
}

// ── Parser pour l'ancien endpoint GetSportsShortZip ───────────────────────────
// Structure : data.Value = [sport, ...] → sport.L = [champ, ...] → champ.G = [game, ...]
function parseRawData(data) {
  if (!data?.Value || !Array.isArray(data.Value)) return null;
  let baccaratSport = null;
  for (const sport of data.Value) {
    if ((sport.N === 'Baccarat' || sport.I === 236) && sport.L) { baccaratSport = sport; break; }
  }
  if (!baccaratSport) return null;
  const results = [];
  for (const champ of baccaratSport.L || []) {
    for (const game of champ.G || []) {
      if (!game.DI) continue;
      const gn = parseInt(game.DI);
      if (!Number.isFinite(gn) || gn <= 0) continue;
      const sc  = game.SC || {};
      const scS = sc.S  || [];
      const { player, banker } = parseCards(scS);
      results.push({
        game_number:  gn,
        player_cards: player, banker_cards: banker,
        winner:       parseWinner(scS),
        is_finished:  isGameFinished(game, scS),
        phase:        parsePhase(scS),
        score:        sc.FS || {},
        championship: champ.L || champ.N || '',
        status_label: sc.SLS || '',
      });
    }
  }
  results.sort((a, b) => b.game_number - a.game_number);
  return results;
}

// POST /api/games/client-push — le navigateur envoie les données brutes de 1xBet
// Accepte les deux formats : GetChampZip (Value.G) et GetSportsShortZip (Value[])
// Déclenche immédiatement un broadcast SSE si les données ont changé
router.post('/client-push', async (req, res) => {
  if (!req.session?.userId) return res.status(401).json({ error: 'Non connecté' });
  try {
    // Tente d'abord le nouveau format GetChampZip, puis l'ancien
    const parsed = parseChampData(req.body) || parseRawData(req.body);
    if (!parsed) return res.status(400).json({ error: 'Données invalides' });
    const changed = updateCache(parsed, 'push');
    res.json({ ok: true, count: parsed.length, changed });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// GET /api/games/trigger-fetch — le navigateur demande au serveur de récupérer les données
// Le serveur essaie fetch direct + proxies de secours, puis broadcast SSE
router.get('/trigger-fetch', async (req, res) => {
  if (!req.session?.userId) return res.status(401).json({ error: 'Non connecté' });
  try {
    const games = await fetchGames();
    res.json({ ok: true, count: games.length });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Middleware : bloque les utilisateurs non admin dont l'abonnement est expiré
async function requireActiveSub(req, res, next) {
  if (!req.session.userId) return res.status(401).json({ error: 'Non connecté' });
  if (req.session.isAdmin) return next();
  try {
    const db = require('./db');
    const u = await db.getUser(req.session.userId);
    if (!u) return res.status(401).json({ error: 'Utilisateur non trouvé' });
    if (!u.is_approved)
      return res.status(403).json({ error: 'Compte en attente de validation', code: 'PENDING' });
    if (!u.subscription_expires_at || new Date(u.subscription_expires_at) <= new Date())
      return res.status(403).json({ error: 'Abonnement expiré', code: 'EXPIRED' });
    next();
  } catch (e) {
    console.warn('[requireActiveSub] erreur:', e?.message || e);
    return res.status(500).json({ error: 'Erreur serveur' });
  }
}

// ── Helper : attache l'attenteQueue au premier élément du résultat ─────────
// Garantit que tous les modes (y compris FC6, Intersection, etc.) exposent la
// file d'attente même si getAbsences ne l'a pas encore attachée.
function _injectAttenteQueue(result, engine, channel) {
  if (!result || result.length === 0) return;
  if (result[0].attenteQueue) return; // déjà présente (modes ALL_SUITS)
  if (!channel.startsWith('S')) return;
  const state = engine.getStrategyState ? engine.getStrategyState(channel) : null;
  if (state?.attenteQueue?.length > 0) {
    result[0].attenteQueue = state.attenteQueue.map(x => ({ ...x }));
  }
}

router.get('/absences', requireActiveSub, async (req, res) => {
  const channel = req.query.channel || 'C1';
  const engine  = require('./engine');

  // Admin : accès total
  if (req.session.isAdmin) {
    const result = engine.getAbsences(channel) || [];
    _injectAttenteQueue(result, engine, channel);
    return res.json(result);
  }

  // Recharge le user depuis la DB pour avoir les permissions à jour
  const db = require('./db');
  let u;
  try { u = await db.getUser(req.session.userId); } catch {}
  if (!u) return res.status(401).json({ error: 'Utilisateur non trouvé' });

  const isPremium = !!(u.is_premium || u.account_type === 'premium');
  const isPro     = !!(u.is_pro     || u.account_type === 'pro');

  // Premium : autorisé uniquement si l'admin a coché ce canal dans show_counter_channels
  if (isPremium) {
    const showCounters = (() => {
      const v = u.show_counter_channels;
      if (!v) return null;
      if (Array.isArray(v)) return v;
      try { return JSON.parse(v); } catch { return null; }
    })();
    if (!Array.isArray(showCounters) || !showCounters.includes(channel)) {
      return res.status(403).json({ error: 'Compteur non autorisé pour ce canal' });
    }
    const result = engine.getAbsences(channel) || [];
    _injectAttenteQueue(result, engine, channel);
    return res.json(result);
  }

  // Pro : autorisé sur ses propres stratégies (canal S5001…S5100)
  if (isPro && /^S\d{4,5}$/.test(channel)) {
    try {
      const id      = parseInt(channel.slice(1));
      const metaRaw = await db.getSetting(`pro_strategy_${id}_meta`).catch(() => null);
      if (metaRaw) {
        const meta = JSON.parse(metaRaw);
        if (meta.owner_user_id === req.session.userId) {
          const result = engine.getAbsences(channel) || [];
          _injectAttenteQueue(result, engine, channel);
          return res.json(result);
        }
      }
    } catch {}
  }

  return res.status(403).json({ error: 'Accès non autorisé' });
});

// Logs Pro : accessibles à l'admin (tout) et au compte Pro propriétaire de la stratégie
router.get('/pro-logs', requireActiveSub, async (req, res) => {
  if (!req.session.isAdmin && !req.session.isPro) return res.status(403).json({ error: 'Accès non autorisé' });
  const channel = req.query.channel || '';
  if (!/^S\d{4,5}$/.test(channel)) return res.json([]);
  // Vérification ownership pour Pro non-admin
  if (!req.session.isAdmin) {
    try {
      const db = require('./db');
      const id = parseInt(channel.slice(1));
      const metaRaw = await db.getSetting(`pro_strategy_${id}_meta`).catch(() => null);
      if (!metaRaw) return res.json([]);
      const meta = JSON.parse(metaRaw);
      if (meta.owner_user_id !== req.session.userId) {
        return res.status(403).json({ error: 'Cette stratégie ne vous appartient pas' });
      }
    } catch { return res.json([]); }
  }
  const engine = require('./engine');
  res.json(engine.getProLogs(channel) || []);
});

router.delete('/pro-logs', requireActiveSub, async (req, res) => {
  if (!req.session.isAdmin && !req.session.isPro) return res.status(403).json({ error: 'Accès non autorisé' });
  const channel = req.query.channel || '';
  // Vérification ownership pour Pro non-admin
  if (channel && !req.session.isAdmin) {
    if (!/^S\d{4,5}$/.test(channel)) return res.status(400).json({ error: 'Canal invalide' });
    try {
      const db = require('./db');
      const id = parseInt(channel.slice(1));
      const metaRaw = await db.getSetting(`pro_strategy_${id}_meta`).catch(() => null);
      if (!metaRaw) return res.status(404).json({ error: 'Stratégie introuvable' });
      const meta = JSON.parse(metaRaw);
      if (meta.owner_user_id !== req.session.userId) {
        return res.status(403).json({ error: 'Cette stratégie ne vous appartient pas' });
      }
    } catch (e) { return res.status(500).json({ error: e.message }); }
  }
  // Sans canal : seul l'admin peut tout vider
  if (!channel && !req.session.isAdmin) {
    return res.status(403).json({ error: 'Vider tous les logs : admin uniquement' });
  }
  const engine = require('./engine');
  engine.clearProLogs(channel || null);
  res.json({ ok: true });
});

router.get('/loss-streaks', requireActiveSub, async (req, res) => {
  try {
    const engine = require('./engine');
    const db     = require('./db');
    const v      = await db.getSetting('loss_sequences');
    const sequences = v ? JSON.parse(v) : [];
    res.json({ streaks: engine.lossStreaks || {}, sequences });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// GET /api/games/source — source actuelle des données (1xbet ou kouame)
router.get('/source', requireActiveSub, (req, res) => {
  try {
    let source = lastDataSource;
    // Vérifier en temps réel si Kouamé API est active
    try {
      const kouame = require('./kouame-api');
      if (kouame.isEnabled()) source = 'kouame';
    } catch {}
    res.json({ source });
  } catch (e) { res.status(500).json({ source: 'server' }); }
});

router.get('/live', requireActiveSub, async (req, res) => {
  try {
    const games = await fetchGames();
    res.json(games);
  } catch (err) {
    res.status(500).json({ error: 'Erreur lors de la récupération des jeux' });
  }
});

// GET /api/games/stream — SSE event-driven
// Le client reçoit les données IMMÉDIATEMENT quand elles changent (via broadcast),
// plus un keepalive toutes les 15s pour maintenir la connexion active.
router.get('/stream', requireActiveSub, (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();

  // Envoyer les données actuelles immédiatement à la connexion (même vides)
  try {
    res.write(`data: ${JSON.stringify(gamesCache)}\n\n`);
    if (res.flush) res.flush();
  } catch {}

  sseClients.add(res);

  // Keepalive toutes les 15s pour éviter que les proxies ferment la connexion
  const keepalive = setInterval(() => {
    try {
      res.write(': keepalive\n\n');
      if (res.flush) res.flush();
    } catch { clearInterval(keepalive); sseClients.delete(res); }
  }, 15000);

  req.on('close', () => {
    clearInterval(keepalive);
    sseClients.delete(res);
  });
});

function getGamesCache() { return gamesCache; }

module.exports = { router, fetchGames, fetchGamesForce, getGamesCache, startServerPoll };
