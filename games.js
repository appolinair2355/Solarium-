const express = require('express');
const fetch = require('node-fetch');
const router = express.Router();

const API_URL = 'https://1xbet.com/service-api/LiveFeed/GetSportsShortZip';
const API_PARAMS = new URLSearchParams({
  sports: 236, champs: 2050671, lng: 'en', gr: 285,
  country: 96, virtualSports: 'true', groupChamps: 'true',
});

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
const CACHE_TTL    = 1500;

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
  gamesCache      = parsed;
  lastFetch       = Date.now();
  lastFingerprint = fp;
  if (source === 'push') lastClientPush = Date.now();
  broadcastGames(gamesCache); // push immédiat à tous les clients SSE
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

async function fetchGames() {
  const now = Date.now();
  if (now - lastFetch < CACHE_TTL && gamesCache.length > 0) return gamesCache;
  try {
    const resp = await fetch(`${API_URL}?${API_PARAMS}`, { headers: API_HEADERS, timeout: 8000 });
    if (!resp.ok) {
      console.error(`Games fetch HTTP error: ${resp.status}`);
      return gamesCache;
    }
    const data = await resp.json();
    const parsed = parseRawData(data);
    if (parsed) updateCache(parsed, 'server');
    return gamesCache;
  } catch (err) {
    console.error('Games fetch error:', err.message);
    return gamesCache;
  }
}

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
      const sc  = game.SC || {};
      const scS = sc.S  || [];
      const { player, banker } = parseCards(scS);
      results.push({
        game_number:  parseInt(game.DI),
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
// Déclenche immédiatement un broadcast SSE si les données ont changé
router.post('/client-push', async (req, res) => {
  if (!req.session?.userId) return res.status(401).json({ error: 'Non connecté' });
  try {
    const parsed = parseRawData(req.body);
    if (!parsed) return res.status(400).json({ error: 'Données invalides' });
    const changed = updateCache(parsed, 'push');
    res.json({ ok: true, count: parsed.length, changed });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.get('/absences', (req, res) => {
  if (!req.session.userId || (!req.session.isAdmin && !req.session.isPremium)) return res.status(403).json({ error: 'Accès non autorisé' });
  const channel = req.query.channel || 'C1';
  const engine = require('./engine');
  const data = engine.getAbsences(channel);
  if (!data) return res.json([]);
  res.json(data);
});

router.get('/loss-streaks', async (req, res) => {
  if (!req.session.userId) return res.status(401).json({ error: 'Non connecté' });
  try {
    const engine = require('./engine');
    const db     = require('./db');
    const v      = await db.getSetting('loss_sequences');
    const sequences = v ? JSON.parse(v) : [];
    res.json({ streaks: engine.lossStreaks || {}, sequences });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.get('/live', async (req, res) => {
  if (!req.session.userId) return res.status(401).json({ error: 'Non connecté' });
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
router.get('/stream', (req, res) => {
  if (!req.session.userId) return res.status(401).json({ error: 'Non connecté' });
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();

  // Envoyer les données actuelles immédiatement à la connexion
  if (gamesCache.length > 0) {
    try {
      res.write(`data: ${JSON.stringify(gamesCache)}\n\n`);
      if (res.flush) res.flush();
    } catch {}
  }

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

module.exports = { router, fetchGames };
