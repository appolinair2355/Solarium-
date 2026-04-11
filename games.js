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
let gamesCache    = [];
let lastFetch     = 0;
let lastClientPush = 0;
const CACHE_TTL   = 4000;

function parseCards(scSList) {
  let player = [], banker = [];
  for (const entry of (scSList || [])) {
    const key = entry.Key || '';
    let cards = [];
    try { cards = JSON.parse(entry.Value || '[]'); } catch {}
    if (key === 'P') player = cards;
    else if (key === 'B') banker = cards;
  }
  const fmt = cards => cards.map(c => ({ S: SUIT_MAP[c.S] || '?', R: c.R || '?', raw: c.S }));
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
    const resp = await fetch(`${API_URL}?${API_PARAMS}`, { headers: API_HEADERS, timeout: 10000 });
    if (!resp.ok) {
      console.error(`Games fetch HTTP error: ${resp.status}`);
      return gamesCache;
    }
    const data = await resp.json();
    const parsed = parseRawData(data);
    if (parsed) {
      gamesCache = parsed;
      lastFetch  = now;
    }
    return gamesCache;
  } catch (err) {
    console.error('Games fetch error:', err.message);
    return gamesCache;
  }
}

// ── Relay client → serveur (quand le serveur ne peut pas atteindre 1xBet) ──
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
router.post('/client-push', async (req, res) => {
  if (!req.session?.userId) return res.status(401).json({ error: 'Non connecté' });
  try {
    const parsed = parseRawData(req.body);
    if (!parsed) return res.status(400).json({ error: 'Données invalides' });
    gamesCache     = parsed;
    lastFetch      = Date.now();
    lastClientPush = Date.now();
    res.json({ ok: true, count: parsed.length });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.get('/absences', (req, res) => {
  if (!req.session.userId || !req.session.isAdmin) return res.status(403).json({ error: 'Admin requis' });
  const channel = req.query.channel || 'C1';
  const engine = require('./engine');
  const data = engine.getAbsences(channel);
  if (!data) return res.json([]);
  res.json(data);
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

router.get('/stream', (req, res) => {
  if (!req.session.userId) return res.status(401).json({ error: 'Non connecté' });
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();
  const send = async () => {
    try {
      const games = await fetchGames();
      res.write(`data: ${JSON.stringify(games)}\n\n`);
      if (res.flush) res.flush();
    } catch {}
  };
  send();
  const interval = setInterval(send, 5000);
  req.on('close', () => clearInterval(interval));
});

module.exports = { router, fetchGames };
