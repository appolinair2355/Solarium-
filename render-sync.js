/**
 * Synchronisation vers une base de données externe (Render.com)
 * - Enregistre toutes les prédictions vérifiées dans la base externe
 * - Efface tout quand le jeu #1 est détecté (nouveau cycle)
 */
const { Pool } = require('pg');
const db = require('./db');

let renderPool  = null;
let currentUrl  = null;
let _gameOneHandled = false; // anti-doublon pour le reset jeu #1

// ── Connexion ───────────────────────────────────────────────────────

async function loadRenderUrl() {
  try {
    const url = await db.getSetting('render_db_url');
    if (url && url.trim()) {
      if (url.trim() !== currentUrl) {
        if (renderPool) { try { await renderPool.end(); } catch {} }
        currentUrl = url.trim();
        renderPool = new Pool({
          connectionString: currentUrl,
          ssl: { rejectUnauthorized: false },
          connectionTimeoutMillis: 8000,
          max: 3,
        });
        await initRenderDb();
        console.log('[RenderSync] ✅ Connexion base Render configurée');
      }
    } else {
      if (renderPool) {
        try { await renderPool.end(); } catch {}
        renderPool = null;
        currentUrl = null;
        console.log('[RenderSync] ⚠️ URL effacée — connexion Render fermée');
      }
    }
  } catch (e) {
    console.error('[RenderSync] Erreur chargement URL:', e.message);
    renderPool = null;
    currentUrl = null;
  }
}

// ── Initialisation des tables ───────────────────────────────────────

async function initRenderDb() {
  if (!renderPool) return;
  try {
    await renderPool.query(`
      CREATE TABLE IF NOT EXISTS predictions_export (
        id            SERIAL PRIMARY KEY,
        strategy      VARCHAR(20),
        game_number   INTEGER,
        predicted_suit VARCHAR(5),
        status        VARCHAR(20),
        rattrapage    INTEGER DEFAULT 0,
        player_cards  TEXT,
        banker_cards  TEXT,
        resolved_at   TIMESTAMPTZ,
        created_at    TIMESTAMPTZ DEFAULT NOW(),
        UNIQUE(strategy, game_number, predicted_suit)
      )
    `);
    console.log('[RenderSync] Tables initialisées');
  } catch (e) {
    console.error('[RenderSync] Erreur init tables:', e.message);
  }
}

// ── Sync d'une prédiction vérifiée ─────────────────────────────────

async function syncVerifiedPrediction(pred) {
  if (!renderPool) return;
  try {
    await renderPool.query(`
      INSERT INTO predictions_export
        (strategy, game_number, predicted_suit, status, rattrapage, player_cards, banker_cards, resolved_at, created_at)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
      ON CONFLICT (strategy, game_number, predicted_suit)
        DO UPDATE SET status=EXCLUDED.status, rattrapage=EXCLUDED.rattrapage,
                      player_cards=EXCLUDED.player_cards, banker_cards=EXCLUDED.banker_cards,
                      resolved_at=EXCLUDED.resolved_at
    `, [
      pred.strategy,
      pred.game_number,
      pred.predicted_suit,
      pred.status,
      pred.rattrapage || 0,
      pred.player_cards || null,
      pred.banker_cards || null,
      pred.resolved_at  || new Date().toISOString(),
      pred.created_at   || new Date().toISOString(),
    ]);
  } catch (e) {
    console.error('[RenderSync] Erreur sync prédiction:', e.message);
  }
}

// ── Reset complet quand jeu #1 détecté ─────────────────────────────

async function handleGameOne(gameNumber) {
  if (gameNumber !== 1) { _gameOneHandled = false; return; }
  if (_gameOneHandled) return;
  _gameOneHandled = true;
  if (!renderPool) return;
  try {
    const r = await renderPool.query('DELETE FROM predictions_export');
    console.log(`[RenderSync] 🔄 RESET — base externe effacée (${r.rowCount} lignes) — jeu #1 détecté`);
  } catch (e) {
    console.error('[RenderSync] Erreur reset jeu #1:', e.message);
    _gameOneHandled = false;
  }
}

// ── Test de connexion ───────────────────────────────────────────────

async function testConnection(url) {
  const pool = new Pool({
    connectionString: url,
    ssl: { rejectUnauthorized: false },
    connectionTimeoutMillis: 8000,
    max: 1,
  });
  try {
    const r = await pool.query('SELECT NOW() as ts');
    await pool.end();
    return { ok: true, ts: r.rows[0]?.ts };
  } catch (e) {
    try { await pool.end(); } catch {}
    return { ok: false, error: e.message };
  }
}

// ── Statistiques Render ─────────────────────────────────────────────

async function getRenderStats() {
  if (!renderPool) return null;
  try {
    const r = await renderPool.query(`
      SELECT
        COUNT(*) FILTER (WHERE status='gagne') as wins,
        COUNT(*) FILTER (WHERE status='perdu')  as losses,
        COUNT(*)                                 as total,
        MAX(game_number)                         as last_game
      FROM predictions_export
    `);
    return r.rows[0];
  } catch (e) {
    return null;
  }
}

function isConnected() { return !!renderPool; }

module.exports = { loadRenderUrl, syncVerifiedPrediction, handleGameOne, testConnection, getRenderStats, isConnected };
