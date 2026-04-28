require('dotenv').config();
const express  = require('express');
const session  = require('express-session');
const cors     = require('cors');
const path     = require('path');
const fs       = require('fs');
const compression = require('compression');

const { initDB, USE_PG, pool, upsertProjectFile, createDeployLog, updateDeployLog } = require('./db');
const authRoutes        = require('./auth');
const adminRoutes       = require('./admin');
const predictionsRoutes = require('./predictions');
const { router: gamesRouter } = require('./games');
const telegramRoutes    = require('./telegram-route');
const telegramService   = require('./telegram-service');
const progRoutes        = require('./prog');
const engine            = require('./engine');
const bilan             = require('./bilan');
const botHost           = require('./bot-host');
const systemLogsRoutes  = require('./system-logs-route');
const { router: aiRoutes } = require('./ai-route');
const comptages         = require('./comptages');
const paymentRoutes     = require('./payment-route');

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
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb', extended: true }));

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

// ── Middleware : bloquer les comptes expirés sur tous les endpoints protégés
// (sauf /api/auth pour permettre logout, et /api/admin/users pour que l'admin gère)
const dbForExpiry = require('./db');
async function blockExpired(req, res, next) {
  if (!req.session?.userId) return next();
  if (req.session.isAdmin) return next();
  try {
    const u = await dbForExpiry.getUser(req.session.userId);
    if (!u) return res.status(401).json({ error: 'Session invalide' });
    if (!u.is_approved) return res.status(403).json({ error: 'Compte en attente de validation', status: 'pending' });
    if (!u.subscription_expires_at || new Date(u.subscription_expires_at) <= new Date()) {
      return res.status(403).json({ error: 'Abonnement expiré. Contactez l\'administrateur.', status: 'expired' });
    }
    next();
  } catch { next(); }
}

// ── Routes API ─────────────────────────────────────────────────────
app.use('/api/auth',        authRoutes);
app.use('/api/admin',       blockExpired, adminRoutes);
app.use('/api/predictions', blockExpired, predictionsRoutes);
app.use('/api/games',       blockExpired, gamesRouter);
app.use('/api/telegram',    blockExpired, telegramRoutes);
app.use('/api/prog',        progRoutes);
app.get('/api/health', (req, res) => res.json({ status: 'ok', mode: USE_PG ? 'postgresql' : 'json', time: new Date() }));
app.use('/api/system-logs', systemLogsRoutes);
app.use('/api/ai', aiRoutes);
app.use('/api/admin/comptages', comptages.router);
app.use('/api/payments', paymentRoutes);

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
      .filter(m => Number(m.userId) === Number(req.session.userId))
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
  // Assets avec hash dans le nom → cache navigateur 30 jours (immutable)
  app.use('/assets', express.static(path.join(distPath, 'assets'), {
    maxAge: '30d',
    immutable: true,
  }));
  // Reste des fichiers statiques (hors index.html)
  app.use(express.static(distPath, {
    maxAge: IS_PROD ? '1h' : '0',
    index: false, // Ne pas servir index.html automatiquement (on le gère ci-dessous)
  }));
  // index.html → toujours sans cache pour que les nouveaux assets soient chargés
  app.use((req, res, next) => {
    if (req.path.startsWith('/api')) return next();
    res.set('Cache-Control', 'no-cache, no-store, must-revalidate');
    res.set('Pragma', 'no-cache');
    res.set('Expires', '0');
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

  // ── Sur Render → log du démarrage en base, pas d'auto-restauration ──
  if (IS_RENDER) {
    console.log('[Deploy] ℹ️  Render détecté — démarrage tracé en base.');
    try {
      const os = require('os');
      const logId = await createDeployLog({
        source:   'render_startup',
        hostname: os.hostname(),
        env:      process.env.NODE_ENV || 'production',
      });
      await updateDeployLog(logId, {
        status:       'startup',
        npm_install:  'n/a',
        build_status: 'n/a',
        log_text:     'Démarrage automatique Render — pas d\'installation (utilisez le panneau admin)',
        finished_at:  new Date(),
        duration_ms:  0,
      });
      console.log(`[Deploy] ✅ Démarrage Render tracé → deploy_log id=${logId}`);
    } catch (e) {
      console.error('[Deploy] Erreur log démarrage Render:', e.message);
    }
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
  // ── Phase 1 : init DB (obligatoire avant d'écouter les requêtes) ──
  await initDB();

  // ── Phase 2 : ouvrir le port IMMÉDIATEMENT pour que Render détecte le port ──
  app.listen(PORT, '0.0.0.0', () => {
    console.log(`🌐 Serveur démarré sur le port ${PORT} (${IS_PROD ? 'production' : 'développement'}) — DB: ${USE_PG ? 'PostgreSQL' : 'JSON'}`);
  });

  // ── Phase 3 : initialiser tout le reste EN ARRIÈRE-PLAN ───────────
  // (sync externe, moteur, bots Telegram, etc. — peuvent prendre du temps
  // sans bloquer l'ouverture du port HTTP)
  initBackgroundServices().catch(err => {
    console.error('[Init] Erreur initialisation services arrière-plan:', err);
  });
}

async function initBackgroundServices() {
  await autoSaveDeployFiles();

  // ⚠️ IMPORTANT : loadConfig AVANT engine.start pour que maxRattrapage soit
  // chargé depuis la DB avant cleanupStale() et loadExistingPending().
  await telegramService.loadConfig();
  await comptages.init();
  await engine.start(2000);
  bilan.scheduleMidnight();
  // Initialiser la table hébergement bots + restaurer bots actifs
  await botHost.initDB();
  botHost.restoreRunningBots().catch(e => console.error('[BotHost] Restauration échouée:', e.message));
  // Lancer le scheduler d'annonces toutes les minutes
  setInterval(runAnnouncementsScheduler, 60_000);

  // ── Nettoyage automatique des logs en mémoire (toutes les 20 min) ──────────
  const CLEANUP_INTERVAL_MS = 20 * 60 * 1000; // 20 minutes
  async function runMemoryCleanup() {
    try {
      // 1. Purger les logs de bots en mémoire (garder 30 lignes/bot)
      botHost.purgeMemoryLogs(30);
      // 2. Purger les anciennes prédictions en_cours bloquées depuis > 30 min
      const r = await db.pool.query(
        `UPDATE predictions SET status='expire', resolved_at=NOW()
         WHERE status='en_cours' AND created_at < NOW() - INTERVAL '30 minutes'
         RETURNING id`
      ).catch(() => ({ rows: [] }));
      if (r.rows.length > 0) {
        console.log(`[Cleanup] 🧹 ${r.rows.length} prédiction(s) en_cours expirée(s) (bloquées > 30 min)`);
      }
      // 3. Supprimer les prédictions résolues très anciennes (> 45 jours)
      const del = await db.pool.query(
        `DELETE FROM predictions
         WHERE status IN ('gagne','perdu','expire')
         AND created_at < NOW() - INTERVAL '45 days'
         RETURNING id`
      ).catch(() => ({ rows: [] }));
      if (del.rows.length > 0) {
        console.log(`[Cleanup] 🧹 ${del.rows.length} ancienne(s) prédiction(s) (> 45j) supprimée(s)`);
      }
    } catch (e) {
      console.error('[Cleanup] Erreur nettoyage mémoire :', e.message);
    }
  }
  // Première exécution après 20 min puis toutes les 20 min
  setInterval(runMemoryCleanup, CLEANUP_INTERVAL_MS);
  console.log(`[Cleanup] ⏱ Nettoyage automatique actif — toutes les 20 min`);
}

main().catch(err => {
  console.error('Erreur démarrage:', err);
  process.exit(1);
});
