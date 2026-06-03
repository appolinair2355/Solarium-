// ── Route API Kouamé (admin only + feed public) ───────────────────────────────
const express    = require('express');
const router     = express.Router();
const kouameApi  = require('./kouame-api');

function requireAdmin(req, res, next) {
  if (!req.session?.isAdmin) return res.status(403).json({ error: 'Admin requis' });
  next();
}

// ── Conversion Kouamé → format 1xBet GetChampZip ─────────────────────────────
// Permet à tout code Python/Node utilisant l'API 1xBet de pointer vers ce serveur
// sans aucune modification de code.
//
// Mapping costumes inverse : ♠️→0  ♣️→1  ♦️→2  ♥️→3
const REVERSE_SUIT_MAP = {
  '♠️': 0, '♠': 0,
  '♣️': 1, '♣': 1,
  '♦️': 2, '♦': 2,
  '♥️': 3, '♥': 3,
};

function cardToRaw(c) {
  const suit = REVERSE_SUIT_MAP[c.S] ?? (typeof c.raw === 'number' ? c.raw : 0);
  let rank = c.R ?? 0;
  // Convertir les rangs lettre → valeur numérique si nécessaire
  // (l'API 1xBet utilise des entiers : A=1, 2-9=valeur, 10/J/Q/K=10)
  if (typeof rank === 'string') {
    if (rank === 'A') rank = 1;
    else if (rank === 'J' || rank === 'Q' || rank === 'K') rank = 10;
    else rank = parseInt(rank) || 0;
  }
  return { S: suit, R: rank };
}

function gameToChampFormat(g) {
  const playerRaw = (g.player_cards || []).map(cardToRaw);
  const bankerRaw = (g.banker_cards || []).map(cardToRaw);

  // Valeur du champ SC.S.Key='S' → phase ou résultat
  let sValue;
  if (g.is_finished) {
    if (g.winner === 'Player')      sValue = 'Win1';
    else if (g.winner === 'Banker') sValue = 'Win2';
    else if (g.winner === 'Tie')    sValue = 'Tie';
    else                            sValue = 'Win1'; // fallback calculé
  } else {
    sValue = g.phase || 'Normal';
  }

  const scS = [];
  if (sValue) scS.push({ Key: 'S', Value: sValue });
  if (playerRaw.length > 0) scS.push({ Key: 'P', Value: JSON.stringify(playerRaw) });
  if (bankerRaw.length > 0) scS.push({ Key: 'B', Value: JSON.stringify(bankerRaw) });

  return {
    DI:  String(g.game_number),
    F:   g.is_finished ? 1 : 0,
    SC: {
      S:   scS,
      FS:  g.score  || {},
      CPS: g.is_finished ? 'Match finished' : '',
      I:   g.status_label || '',
      SLS: g.status_label || '',
    },
  };
}

// ── GET /api/kouame/feed ───────────────────────────────────────────────────────
// Endpoint PUBLIC — retourne les jeux en temps réel au format exact 1xBet GetChampZip.
//
// Usage Python :
//   import requests
//   data = requests.get('https://<votre-domaine>/api/kouame/feed').json()
//   # data.Value.G → liste des jeux, identique à 1xBet
//
// Usage Node.js :
//   const data = await fetch('https://<votre-domaine>/api/kouame/feed').then(r=>r.json());
//   // data.Value.G → liste des jeux
//
// Authentification optionnelle : si la DB contient le setting 'kouame_feed_key',
// le paramètre ?key=xxx est requis (sauf si absent de la DB = accès libre).
router.get('/feed', async (req, res) => {
  try {
    const db = require('./db');
    const feedKey = await db.getSetting('kouame_feed_key').catch(() => null);
    if (feedKey && feedKey.trim()) {
      const provided = req.query.key || req.headers['x-api-key'] || '';
      if (provided !== feedKey.trim()) {
        return res.status(401).json({ error: 'Clé API invalide', hint: 'Ajoutez ?key=<votre_clé> ou le header X-Api-Key' });
      }
    }

    const games = kouameApi.getGames();
    const status = kouameApi.getStatus();

    const G = games.map(gameToChampFormat);

    // Format identique à 1xBet service-api/GetChampZip
    res.json({
      Value: {
        LE: 'Speed Baccarat — Kouamé Feed',
        L:  'Baccarat',
        SE: 'Live Baccarat',
        G,
      },
      _meta: {
        source:           'kouame',
        enabled:          status.enabled,
        game_count:       games.length,
        last_game_number: status.last_game_number,
        last_received_at: status.last_received_at,
        connected:        status.connected,
        timestamp:        new Date().toISOString(),
      },
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── GET /api/kouame/feed/info ──────────────────────────────────────────────────
// Infos de connexion + exemple de code d'intégration
router.get('/feed/info', (req, res) => {
  const host = req.headers.host || 'votre-domaine.replit.app';
  const proto = req.headers['x-forwarded-proto'] || 'https';
  const baseUrl = `${proto}://${host}`;

  res.json({
    feed_url:    `${baseUrl}/api/kouame/feed`,
    format:      '1xBet GetChampZip (Value.G[])',
    description: 'Remplacez l\'URL 1xBet par cette URL dans votre code Python/Node',
    examples: {
      python: [
        'import requests',
        `data = requests.get('${baseUrl}/api/kouame/feed').json()`,
        'games = data["Value"]["G"]',
        'for g in games:',
        '    game_number = int(g["DI"])',
        '    is_finished = bool(g["F"])',
        '    # SC.S contient phase/résultat + cartes joueur (P) et banquier (B)',
        '    sc_s = g["SC"]["S"]',
        '    phase = next((e["Value"] for e in sc_s if e["Key"] == "S"), None)',
        '    p_cards = json.loads(next((e["Value"] for e in sc_s if e["Key"] == "P"), "[]"))',
        '    b_cards = json.loads(next((e["Value"] for e in sc_s if e["Key"] == "B"), "[]"))',
      ].join('\n'),
      nodejs: [
        `const data = await fetch('${baseUrl}/api/kouame/feed').then(r => r.json());`,
        'const games = data.Value.G;',
        'for (const g of games) {',
        '  const gameNumber = parseInt(g.DI);',
        '  const isFinished = !!g.F;',
        '  const scS = g.SC?.S || [];',
        '  const phase = scS.find(e => e.Key === "S")?.Value;',
        '  const pCards = JSON.parse(scS.find(e => e.Key === "P")?.Value || "[]");',
        '  const bCards = JSON.parse(scS.find(e => e.Key === "B")?.Value || "[]");',
        '}',
      ].join('\n'),
    },
    suit_map: { 0: '♠', 1: '♣', 2: '♦', 3: '♥' },
    phase_values: {
      'Normal':     'Distribution initiale (2+2 cartes)',
      'PlayerMove': 'Joueur en train de tirer la 3ème carte',
      'BankerMove': 'Banquier en train de tirer la 3ème carte',
      'Win1':       'Jeu terminé — Joueur gagne',
      'Win2':       'Jeu terminé — Banquier gagne',
      'Tie':        'Jeu terminé — Égalité',
    },
  });
});

// GET /api/kouame/config
router.get('/config', requireAdmin, async (req, res) => {
  try { res.json(await kouameApi.getConfig()); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

// POST /api/kouame/config
router.post('/config', requireAdmin, async (req, res) => {
  try {
    const { bot_token, channel_id, enabled } = req.body;
    const cfg = await kouameApi.setConfig({ bot_token, channel_id, enabled });
    res.json(cfg);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// DELETE /api/kouame/config
router.delete('/config', requireAdmin, async (req, res) => {
  try { await kouameApi.resetConfig(); res.json({ ok: true }); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

// GET /api/kouame/status
router.get('/status', requireAdmin, async (req, res) => {
  try { res.json(kouameApi.getStatus()); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

// POST /api/kouame/test — test de connexion (valider token)
router.post('/test', requireAdmin, async (req, res) => {
  try {
    const { bot_token, channel_id } = req.body;
    if (!bot_token) return res.status(400).json({ error: 'bot_token requis' });
    const result = await kouameApi.testConnection(bot_token, channel_id);
    res.json(result);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

module.exports = router;
