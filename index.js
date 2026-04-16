require('dotenv').config();
const express  = require('express');
const session  = require('express-session');
const cors     = require('cors');
const path     = require('path');
const fs       = require('fs');
const compression = require('compression');

const { initDB, USE_PG, pool, upsertProjectFile } = require('./db');
const authRoutes        = require('./auth');
const adminRoutes       = require('./admin');
const predictionsRoutes = require('./predictions');
const { router: gamesRouter } = require('./games');
const telegramRoutes    = require('./telegram-route');
const telegramService   = require('./telegram-service');
const progRoutes        = require('./prog');
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
app.use('/api/prog',        progRoutes);
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

// ── Styles UI (public — appliqués au démarrage du frontend) ─────────
app.get('/api/settings/ui-styles', async (req, res) => {
  try {
    const raw = await db.getSetting('ui_styles');
    res.json(raw ? JSON.parse(raw) : {});
  } catch (e) { res.json({}); }
});

// ── CSS personnalisé (public — injecté dynamiquement sans rebuild) ───
app.get('/api/settings/custom-css', async (req, res) => {
  try {
    const raw = await db.getSetting('custom_css');
    res.setHeader('Content-Type', 'text/css; charset=utf-8');
    res.setHeader('Cache-Control', 'no-cache');
    res.send(raw || '');
  } catch (e) { res.status(200).send(''); }
});

// ── Message utilisateur → admin ─────────────────────────────────────
app.post('/api/user/message-admin', async (req, res) => {
  try {
    if (!req.session?.userId) return res.status(401).json({ error: 'Non connecté' });
    const user = await db.getUser(req.session.userId);
    if (!user) return res.status(401).json({ error: 'Utilisateur introuvable' });
    const { text } = req.body;
    if (!text || !String(text).trim()) return res.status(400).json({ error: 'Message vide' });
    const raw = await db.getSetting('user_messages');
    const messages = raw ? JSON.parse(raw) : [];
    messages.unshift({
      id: Date.now(),
      userId: user.id,
      username: user.username,
      text: String(text).trim().slice(0, 800),
      date: new Date().toISOString(),
      read: false,
    });
    // Garder les 100 derniers messages
    if (messages.length > 100) messages.splice(100);
    await db.setSetting('user_messages', JSON.stringify(messages));
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── Mes messages (utilisateur : voir ses propres messages + réponses admin) ──
app.get('/api/user/my-messages', async (req, res) => {
  if (!req.session?.userId) return res.status(401).json({ error: 'Non connecté' });
  try {
    const raw = await db.getSetting('user_messages');
    const all = raw ? JSON.parse(raw) : [];
    const mine = all
      .filter(m => m.userId === req.session.userId)
      .map(m => ({ id: m.id, text: m.text, date: m.date, admin_reply: m.admin_reply || null }));
    res.json(mine);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── Message broadcast (visible accueil si connecté) ─────────────────
app.get('/api/broadcast-message', async (req, res) => {
  try {
    if (!req.session?.userId) return res.json(null);
    const raw = await db.getSetting('broadcast_message');
    if (!raw) return res.json(null);
    const msg = JSON.parse(raw);
    if (!msg.enabled || !msg.text) return res.json(null);
    res.json({ text: msg.text, targets: msg.targets || [], updated_at: msg.updated_at });
  } catch (e) { res.json(null); }
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

// ── Scheduler d'annonces Telegram ──────────────────────────────────
const { sendAnnouncement } = require('./announcement-sender');

async function runAnnouncementsScheduler() {
  try {
    const raw = await db.getSetting('tg_announcements');
    if (!raw) return;
    const announcements = JSON.parse(raw);
    if (!Array.isArray(announcements) || announcements.length === 0) return;

    const now = new Date();
    const nowHHMM = `${String(now.getHours()).padStart(2,'0')}:${String(now.getMinutes()).padStart(2,'0')}`;
    let changed = false;

    for (const ann of announcements) {
      if (!ann.enabled) continue;
      let shouldSend = false;

      if (ann.schedule_type === 'interval' && ann.interval_hours > 0) {
        if (!ann.last_sent) {
          shouldSend = true;
        } else {
          const diffMs = now - new Date(ann.last_sent);
          const diffHours = diffMs / 3600000;
          shouldSend = diffHours >= ann.interval_hours;
        }
      } else if (ann.schedule_type === 'times' && Array.isArray(ann.times)) {
        if (ann.times.includes(nowHHMM)) {
          // N'envoyer qu'une fois par minute — vérifier que last_sent n'est pas dans la dernière minute
          if (!ann.last_sent) {
            shouldSend = true;
          } else {
            const diffMs = now - new Date(ann.last_sent);
            shouldSend = diffMs >= 60000; // au moins 1 min d'écart
          }
        }
      }

      if (shouldSend) {
        try {
          await sendAnnouncement(ann);
          ann.last_sent = now.toISOString();
          changed = true;
          console.log(`[Annonces] ✅ Annonce envoyée : "${ann.name}" → ${ann.channel_id}`);
        } catch (err) {
          console.error(`[Annonces] ❌ Erreur envoi "${ann.name}":`, err.message);
        }
      }
    }

    if (changed) {
      await db.setSetting('tg_announcements', JSON.stringify(announcements));
    }
  } catch (e) {
    console.error('[Annonces] Erreur scheduler:', e.message);
  }
}

// ── Sauvegarde automatique complète du projet en DB ───────────────
const EXCLUDED_DIRS_AUTO  = ['node_modules', '.git', '.local', '.cache', '.npm', '.upm'];
const EXCLUDED_FILES_AUTO = ['.env', 'package-lock.json'];
const INCLUDED_EXTS_AUTO  = ['.js', '.jsx', '.ts', '.tsx', '.json', '.css', '.html', '.md', '.txt', '.sh', '.cjs', '.mjs'];
const MAX_FILE_SIZE_AUTO  = 2 * 1024 * 1024; // 2 Mo max

function scanAllFiles(dir, base) {
  const results = [];
  let entries;
  try { entries = fs.readdirSync(dir); } catch { return results; }
  for (const entry of entries) {
    if (EXCLUDED_DIRS_AUTO.includes(entry)) continue;
    const fullPath = path.join(dir, entry);
    const relPath  = base ? `${base}/${entry}` : entry;
    let stat;
    try { stat = fs.statSync(fullPath); } catch { continue; }
    if (stat.isDirectory()) {
      results.push(...scanAllFiles(fullPath, relPath));
    } else if (stat.isFile()) {
      if (EXCLUDED_FILES_AUTO.includes(entry)) continue;
      const ext = path.extname(entry).toLowerCase();
      if (!INCLUDED_EXTS_AUTO.includes(ext)) continue;
      if (stat.size > MAX_FILE_SIZE_AUTO) continue;
      results.push({ fullPath, relPath, size: stat.size });
    }
  }
  return results;
}

// Détecte l'environnement : Replit = sauvegarde → DB | Render = restaure ← DB
const IS_REPLIT = !!(process.env.REPL_ID || process.env.REPLIT_ENV || process.env.REPL_SLUG);
const IS_RENDER = !!(process.env.RENDER || process.env.RENDER_SERVICE_ID);

async function autoSaveDeployFiles() {
  if (!USE_PG) return;

  // ── Sur Render → pas d'auto-restauration au démarrage ──
  // L'installation se fait manuellement via le bouton "Installer l'application"
  // dans le panneau admin (onglet maj-db). Cela évite la boucle de crashs.
  if (IS_RENDER) {
    console.log('[Deploy] ℹ️  Render détecté — utilisez le panneau admin → "Installer l\'application" pour mettre à jour.');
    return;
  }

  // ── Sur Replit (ou en dev) → sauvegarder les fichiers du disque vers la DB ──
  if (!IS_REPLIT && !process.env.FORCE_SAVE_TO_DB) {
    console.log('[Deploy] ℹ️  Sauvegarde DB ignorée (ni Replit ni FORCE_SAVE_TO_DB)');
    return;
  }

  const files = scanAllFiles(__dirname, '');
  let saved = 0, errors = 0;
  for (const f of files) {
    try {
      const content = fs.readFileSync(f.fullPath, 'utf8');
      await upsertProjectFile(f.relPath, content, false);
      saved++;
    } catch (e) {
      errors++;
      console.error(`[Deploy] Erreur sauvegarde ${f.relPath}:`, e.message);
    }
  }
  console.log(`[Deploy] ✅ ${saved} fichier(s) sauvegardé(s) en base${errors > 0 ? ` (${errors} erreur(s))` : ''}`);
}

// ── Démarrage ─────────────────────────────────────────────────────
async function main() {
  await initDB();
  await autoSaveDeployFiles();

  engine.start(2000);
  await telegramService.loadConfig();
  bilan.scheduleMidnight();
  // Lancer le scheduler d'annonces toutes les minutes
  setInterval(runAnnouncementsScheduler, 60_000);
  app.listen(PORT, '0.0.0.0', () => {
    console.log(`🌐 Serveur démarré sur le port ${PORT} (${IS_PROD ? 'production' : 'développement'}) — DB: ${USE_PG ? 'PostgreSQL' : 'JSON'}`);
  });
}

main().catch(err => {
  console.error('Erreur démarrage:', err);
  process.exit(1);
});
