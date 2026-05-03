'use strict';
/**
 * system-logs-route.js — Route API pour le tableau de bord système
 * Fournit en temps réel :
 *   - État de santé du serveur (mémoire, uptime, DB)
 *   - Image complète de la base de données (toutes les tables)
 *   - Activité du moteur de prédiction
 *   - État des bots Telegram hébergés
 */

const express = require('express');
const router  = express.Router();
const db      = require('./db');
const os      = require('os');

// ── Middleware admin uniquement ──────────────────────────────────────────────
function requireAdmin(req, res, next) {
  if (!req.session?.userId) return res.status(401).json({ error: 'Non connecté' });
  if (!req.session?.isAdmin) return res.status(403).json({ error: 'Admin requis' });
  if ((req.session.adminLevel || 2) !== 1) return res.status(403).json({ error: 'Accès réservé à l\'administrateur principal' });
  next();
}

// Tables autorisées (liste exhaustive de la DB)
const ALLOWED_TABLES = [
  'users', 'predictions', 'telegram_config', 'settings',
  'strategy_channel_routes', 'tg_pred_messages', 'user_channel_hidden',
  'user_channel_visible', 'user_strategy_visible', 'hosted_bots',
  'deploy_logs', 'project_files',
];

// Colonnes sensibles à masquer
const SENSITIVE_COLS = ['password', 'password_hash', 'token', 'bot_token', 'zip_base64', 'zip_data'];

function maskSensitive(rows) {
  return rows.map(row => {
    const out = { ...row };
    for (const col of SENSITIVE_COLS) {
      if (out[col] !== undefined) {
        out[col] = out[col] ? '••••••••' : null;
      }
    }
    return out;
  });
}

// ── GET /api/system-logs — Vue globale (santé + résumé tables) ───────────────
router.get('/', requireAdmin, async (req, res) => {
  try {
    const mem   = process.memoryUsage();
    const total = os.totalmem();
    const free  = os.freemem();

    // Résumé de toutes les tables
    const tableSummaries = [];
    for (const tbl of ALLOWED_TABLES) {
      try {
        const r = await db.pool.query(`SELECT COUNT(*)::int AS count FROM ${tbl}`);
        tableSummaries.push({ name: tbl, count: r.rows[0].count });
      } catch {
        tableSummaries.push({ name: tbl, count: null, error: 'Table inaccessible' });
      }
    }

    // Activité récente du moteur (20 dernières prédictions)
    let recentPredictions = [];
    try {
      const rp = await db.pool.query(
        `SELECT strategy, game_number, predicted_suit, status, rattrapage, created_at, resolved_at
         FROM predictions ORDER BY id DESC LIMIT 20`
      );
      recentPredictions = rp.rows;
    } catch {}

    // Stats prédictions du jour
    let todayStats = { total: 0, gagne: 0, perdu: 0, en_cours: 0, expire: 0 };
    try {
      const rs = await db.pool.query(
        `SELECT status, COUNT(*)::int AS n FROM predictions
         WHERE created_at >= NOW() - INTERVAL '24 hours'
         GROUP BY status`
      );
      for (const row of rs.rows) todayStats[row.status] = (todayStats[row.status] || 0) + row.n;
      todayStats.total = Object.values(todayStats).reduce((a, b) => a + b, 0);
    } catch {}

    // Bots hébergés
    let bots = [];
    try {
      const rb = await db.pool.query(`SELECT id, name, language, status, is_prediction_bot, auto_strategy_id, created_at FROM hosted_bots ORDER BY id`);
      bots = rb.rows;
    } catch {}

    // Stats par stratégie (7 derniers jours — pour courbes de variation)
    let strategyStats = [];
    try {
      const ss = await db.pool.query(`
        SELECT
          strategy,
          DATE(created_at AT TIME ZONE 'UTC') AS day,
          COUNT(*) FILTER (WHERE status='gagne')::int AS gagne,
          COUNT(*) FILTER (WHERE status='perdu')::int AS perdu,
          COUNT(*) FILTER (WHERE status='expire')::int AS expire,
          COUNT(*)::int AS total
        FROM predictions
        WHERE created_at >= NOW() - INTERVAL '7 days'
        GROUP BY strategy, day
        ORDER BY strategy, day
      `);
      // Regrouper par stratégie
      const byStrat = {};
      for (const row of ss.rows) {
        if (!byStrat[row.strategy]) byStrat[row.strategy] = [];
        byStrat[row.strategy].push(row);
      }
      strategyStats = Object.entries(byStrat).map(([strategy, days]) => ({
        strategy,
        days,
        totals: days.reduce((acc, d) => ({
          gagne:  acc.gagne  + d.gagne,
          perdu:  acc.perdu  + d.perdu,
          expire: acc.expire + d.expire,
          total:  acc.total  + d.total,
        }), { gagne: 0, perdu: 0, expire: 0, total: 0 }),
        winRate: days.reduce((a, d) => a + d.total, 0) > 0
          ? Math.round(days.reduce((a, d) => a + d.gagne, 0) / days.reduce((a, d) => a + d.total, 0) * 100)
          : null,
      }));
    } catch {}

    // Taille totale des fichiers en base
    let fileSizeStats = { count: 0, totalBytes: 0, totalKb: 0 };
    try {
      const fs = await db.pool.query(`SELECT COUNT(*)::int AS count, COALESCE(SUM(size_bytes),0)::int AS total FROM project_files`);
      fileSizeStats.count = fs.rows[0].count;
      fileSizeStats.totalBytes = fs.rows[0].total;
      fileSizeStats.totalKb = Math.round(fs.rows[0].total / 1024);
    } catch {}

    res.json({
      server: {
        uptime:     Math.floor(process.uptime()),
        nodeVersion: process.version,
        platform:   process.platform,
        pid:        process.pid,
        memory: {
          heapUsed:  Math.round(mem.heapUsed / 1024 / 1024),
          heapTotal: Math.round(mem.heapTotal / 1024 / 1024),
          rss:       Math.round(mem.rss / 1024 / 1024),
          systemTotal: Math.round(total / 1024 / 1024),
          systemFree:  Math.round(free / 1024 / 1024),
        },
        dbMode:  db.USE_PG ? 'PostgreSQL' : 'JSON',
        time:    new Date().toISOString(),
      },
      tables:      tableSummaries,
      todayStats,
      recentPredictions,
      bots,
      strategyStats,
      fileSizeStats,
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── GET /api/system-logs/predictions — Toutes les prédictions par stratégie ──
router.get('/predictions', requireAdmin, async (req, res) => {
  try {
    const result = await db.pool.query(`
      SELECT
        id, strategy, game_number, predicted_suit, status,
        rattrapage, mise, created_at, resolved_at
      FROM predictions
      ORDER BY strategy ASC, id DESC
    `);

    // Regrouper par stratégie
    const byStrategy = {};
    for (const row of result.rows) {
      const s = row.strategy || 'inconnue';
      if (!byStrategy[s]) byStrategy[s] = [];
      byStrategy[s].push(row);
    }

    // Calculer les stats par stratégie
    const strategies = Object.entries(byStrategy).map(([strategy, rows]) => {
      const total  = rows.length;
      const gagne  = rows.filter(r => r.status === 'gagne').length;
      const perdu  = rows.filter(r => r.status === 'perdu').length;
      const en_cours = rows.filter(r => r.status === 'en_cours').length;
      const expire = rows.filter(r => r.status === 'expire').length;
      const resolved = total - en_cours;
      const winRate = resolved > 0 ? Math.round(gagne / (gagne + perdu + expire) * 100) : null;
      return { strategy, rows, total, gagne, perdu, en_cours, expire, winRate };
    });

    res.json({ strategies, totalRows: result.rows.length });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── GET /api/system-logs/health — Vérification état complet ─────────────────
router.get('/health', requireAdmin, async (req, res) => {
  const checks = [];
  let allOk = true;

  // Check 1 : Connexion DB
  try {
    await db.pool.query('SELECT 1');
    checks.push({ name: 'Base de données', status: 'ok', detail: 'PostgreSQL répond' });
  } catch (e) {
    allOk = false;
    checks.push({ name: 'Base de données', status: 'error', detail: e.message });
  }

  // Check 2 : Table predictions accessible
  try {
    const r = await db.pool.query('SELECT COUNT(*)::int AS n FROM predictions');
    checks.push({ name: 'Table predictions', status: 'ok', detail: `${r.rows[0].n} enregistrement(s)` });
  } catch (e) {
    allOk = false;
    checks.push({ name: 'Table predictions', status: 'error', detail: e.message });
  }

  // Check 3 : Moteur en cours
  try {
    const eng = require('./engine');
    const running = !!eng.running;
    checks.push({ name: 'Moteur de prédiction', status: running ? 'ok' : 'warn', detail: running ? 'En cours d\'exécution' : 'Arrêté' });
  } catch (e) {
    checks.push({ name: 'Moteur de prédiction', status: 'warn', detail: e.message });
  }

  // Check 4 : Mémoire
  const mem = process.memoryUsage();
  const heapMb = Math.round(mem.heapUsed / 1024 / 1024);
  const heapOk = heapMb < 400;
  checks.push({ name: 'Mémoire heap', status: heapOk ? 'ok' : 'warn', detail: `${heapMb} Mo utilisés` });

  // Check 5 : Prédictions bloquées (en_cours depuis > 25 min)
  try {
    const r = await db.pool.query(
      `SELECT COUNT(*)::int AS n FROM predictions
       WHERE status='en_cours' AND created_at < NOW() - INTERVAL '25 minutes'`
    );
    const blocked = r.rows[0].n;
    checks.push({ name: 'Prédictions bloquées', status: blocked > 0 ? 'warn' : 'ok', detail: blocked > 0 ? `${blocked} en_cours depuis >25 min` : 'Aucune' });
  } catch {}

  // Check 6 : Canaux Telegram configurés
  try {
    const r = await db.pool.query(`SELECT COUNT(*)::int AS n FROM telegram_config`);
    const n = r.rows[0].n;
    checks.push({ name: 'Canaux Telegram', status: n > 0 ? 'ok' : 'warn', detail: `${n} canal(aux) configuré(s)` });
  } catch {}

  // Check 7 : Utilisateurs actifs
  try {
    const r = await db.pool.query(`SELECT COUNT(*)::int AS n FROM users WHERE is_approved=true`);
    checks.push({ name: 'Utilisateurs approuvés', status: 'ok', detail: `${r.rows[0].n} utilisateur(s)` });
  } catch {}

  res.json({ ok: allOk, time: new Date().toISOString(), checks });
});

// ── GET /api/system-logs/table/:name — Données complètes d'une table ─────────
router.get('/table/:name', requireAdmin, async (req, res) => {
  const tbl = req.params.name;
  if (!ALLOWED_TABLES.includes(tbl)) {
    return res.status(400).json({ error: `Table non autorisée : ${tbl}` });
  }

  try {
    const limit  = Math.min(parseInt(req.query.limit) || 200, 500);
    const offset = parseInt(req.query.offset) || 0;

    // Récupérer les colonnes
    const colR = await db.pool.query(
      `SELECT column_name, data_type, character_maximum_length
       FROM information_schema.columns
       WHERE table_name=$1 AND table_schema='public'
       ORDER BY ordinal_position`,
      [tbl]
    );
    const columns = colR.rows;

    // Récupérer les données
    const dataR  = await db.pool.query(`SELECT * FROM ${tbl} ORDER BY 1 DESC LIMIT $1 OFFSET $2`, [limit, offset]);
    const countR = await db.pool.query(`SELECT COUNT(*)::int AS total FROM ${tbl}`);

    res.json({
      table:   tbl,
      columns,
      rows:    maskSensitive(dataR.rows),
      total:   countR.rows[0].total,
      limit,
      offset,
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── GET /api/system-logs/timeline — Courbe de variation des prédictions ──────
router.get('/timeline', requireAdmin, async (req, res) => {
  try {
    const hours = parseInt(req.query.hours) || 24;
    const result = await db.pool.query(`
      SELECT
        id, strategy, game_number, predicted_suit, status,
        created_at, resolved_at,
        EXTRACT(EPOCH FROM created_at)::bigint AS ts_epoch
      FROM predictions
      WHERE created_at >= NOW() - INTERVAL '${Math.min(hours, 168)} hours'
      ORDER BY created_at ASC
    `);
    res.json({ rows: result.rows, hours });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── GET /api/system-logs/engine — État mémoire du moteur ────────────────────
router.get('/engine', requireAdmin, (req, res) => {
  try {
    const eng = require('./engine');
    res.json({
      running:          eng.running,
      maxProcessedGame: eng.maxProcessedGame || 0,
      currentMaxGame:   eng.currentMaxGame   || 0,
      lossStreaks:      eng.lossStreaks       || {},
      badPredBlocker:   eng.badPredBlocker   || {},
      customCount:      Object.keys(eng.custom || {}).length,
      c1Absences:       eng.c1?.absences     || {},
      c2Absences:       eng.c2?.absences     || {},
      c3Absences:       eng.c3?.absences     || {},
      pendingC1:        Object.keys(eng.c1?.pending || {}).length,
      pendingC2:        Object.keys(eng.c2?.pending || {}).length,
      pendingC3:        Object.keys(eng.c3?.pending || {}).length,
      pendingCustom:    Object.fromEntries(
        Object.entries(eng.custom || {}).map(([id, s]) => [
          `S${id}`, Object.keys(s.pending || {}).length
        ])
      ),
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

module.exports = router;
