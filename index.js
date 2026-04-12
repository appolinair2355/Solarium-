require('dotenv').config();
const express  = require('express');
const session  = require('express-session');
const cors     = require('cors');
const path     = require('path');
const fs       = require('fs');
const compression = require('compression');

const { initDB, USE_PG, pool } = require('./db');
const authRoutes        = require('./auth');
const adminRoutes       = require('./admin');
const predictionsRoutes = require('./predictions');
const { router: gamesRouter } = require('./games');
const telegramRoutes    = require('./telegram-route');
const telegramService   = require('./telegram-service');
const engine            = require('./engine');
const bilan             = require('./bilan');

const app     = express();
const IS_PROD = process.env.NODE_ENV === 'production';
const PORT    = process.env.PORT || 5000;

// ── Trust proxy (Render / Heroku reverse proxy) ─────────────────────
app.set('trust proxy', 1);

app.use(compression({
  filter: (req, res) => {
    if (req.headers.accept === 'text/event-stream' || req.path.endsWith('/stream')) return false;
    return compression.filter(req, res);
  },
}));

app.use(cors({ origin: false, credentials: true }));
app.use(express.json());

// ── Session store ──────────────────────────────────────────────────
let sessionStore;
if (USE_PG && pool) {
  const PgSession = require('connect-pg-simple')(session);
  sessionStore = new PgSession({ pool, createTableIfMissing: true });
  console.log('🔑 Sessions stockées en PostgreSQL');
} else {
  const MemoryStore = require('memorystore')(session);
  sessionStore = new MemoryStore({ checkPeriod: 86_400_000 });
  console.log('🔑 Sessions en mémoire (JSON mode)');
}

app.use(session({
  store: sessionStore,
  secret: process.env.SESSION_SECRET || 'baccarat-pro-secret-2025',
  resave: false,
  saveUninitialized: false,
  rolling: true,
  cookie: {
    secure: IS_PROD,
    httpOnly: true,
    maxAge: 30 * 24 * 60 * 60 * 1000,
    sameSite: IS_PROD ? 'none' : 'lax',
  },
}));

// ── Routes API ─────────────────────────────────────────────────────
app.use('/api/auth',        authRoutes);
app.use('/api/admin',       adminRoutes);
app.use('/api/predictions', predictionsRoutes);
app.use('/api/games',       gamesRouter);
app.use('/api/telegram',    telegramRoutes);
app.get('/api/health', (req, res) => res.json({ status: 'ok', mode: USE_PG ? 'postgresql' : 'json', time: new Date() }));

// ── Bilan quotidien ────────────────────────────────────────────────
const db = require('./db');
app.get('/api/bilan/latest', async (req, res) => {
  if (!req.session?.userId) return res.status(401).json({ error: 'Non connecté' });
  try {
    const snapshot = await db.getLastBilanSnapshot();
    res.json(snapshot || null);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Admin : déclencher manuellement le bilan d'une date
app.post('/api/bilan/send', async (req, res) => {
  if (!req.session?.isAdmin) return res.status(403).json({ error: 'Admin requis' });
  try {
    const dateStr = req.body?.date || new Date(Date.now() - 86400000).toISOString().split('T')[0];
    bilan.sendDailyBilan(dateStr);
    res.json({ ok: true, date: dateStr });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── Vidéos tutoriels (public, page d'accueil) ──────────────────────
app.get('/api/tutorial-videos', async (req, res) => {
  try {
    const raw = await db.getSetting('tutorial_videos');
    const videos = raw ? JSON.parse(raw) : { video1: null, video2: null };
    res.json(videos);
  } catch (e) { res.json({ video1: null, video2: null }); }
});

// ── Client statique ────────────────────────────────────────────────
const distPath = path.join(__dirname, 'dist');

if (fs.existsSync(path.join(distPath, 'index.html'))) {
  console.log(`📁 Fichiers client servis depuis : ${distPath}`);
  app.use(express.static(distPath, { maxAge: IS_PROD ? '1h' : 0 }));
  app.use((req, res, next) => {
    if (req.path.startsWith('/api')) return next();
    res.sendFile(path.join(distPath, 'index.html'));
  });
} else {
  app.use((req, res) => res.send('<p>Build en cours... Rafraîchissez dans quelques secondes.</p>'));
}

// ── Démarrage ─────────────────────────────────────────────────────
async function main() {
  await initDB();
  engine.start(5000);
  await telegramService.loadConfig();
  bilan.scheduleMidnight();
  app.listen(PORT, '0.0.0.0', () => {
    console.log(`🌐 Serveur démarré sur le port ${PORT} (${IS_PROD ? 'production' : 'développement'}) — DB: ${USE_PG ? 'PostgreSQL' : 'JSON'}`);
  });
}

main().catch(err => {
  console.error('Erreur démarrage:', err);
  process.exit(1);
});
