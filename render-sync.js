/**
 * Synchronisation vers une base de données externe (Render.com / autre PostgreSQL)
 *
 * À la connexion :
 *   1. Extrait les données existantes de la base externe → importe dans la base locale
 *   2. Pousse toutes les données locales vers la base externe
 *
 * Sync continue :
 *   - Prédictions vérifiées (gagne/perdu)
 *   - Utilisateurs + durée d'abonnement
 *   - Stratégies personnalisées
 *   - Messages / paramètres clés
 *
 * Reset jeu #1 :
 *   - Efface UNIQUEMENT predictions_export
 *   - Conserve users_export, strategies_export, settings_export
 */
const { Pool } = require('pg');
const db = require('./db');

let renderPool = null;
let currentUrl = null;
let _gameOneHandled = false;

// ── Connexion ────────────────────────────────────────────────────────

const DEFAULT_RENDER_URL = 'postgresql://hebergement_user:4J9ejEAGFbXqY2qubeQhY6RHZMqRLF9C@dpg-d740h98ule4c73eq5edg-a.oregon-postgres.render.com/hebergement';

async function loadRenderUrl() {
  try {
    let url = await db.getSetting('render_db_url');
    if (!url || !url.trim()) {
      url = DEFAULT_RENDER_URL;
      await db.setSetting('render_db_url', url);
      console.log('[RenderSync] URL par défaut configurée automatiquement');
    }
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
        await _pullFromExternal();
        await _pushAllToExternal();
        console.log('[RenderSync] ✅ Connexion configurée — sync bidirectionnelle effectuée');
      }
    } else {
      if (renderPool) {
        try { await renderPool.end(); } catch {}
        renderPool = null;
        currentUrl = null;
        console.log('[RenderSync] ⚠️ URL effacée — connexion fermée');
      }
    }
  } catch (e) {
    console.error('[RenderSync] Erreur chargement URL:', e.message);
    renderPool = null;
    currentUrl = null;
  }
}

// ── Initialisation des tables ────────────────────────────────────────

async function initRenderDb() {
  if (!renderPool) return;
  try {
    await renderPool.query(`
      CREATE TABLE IF NOT EXISTS predictions_export (
        id             SERIAL PRIMARY KEY,
        strategy       TEXT,
        game_number    INTEGER,
        predicted_suit TEXT,
        status         TEXT,
        rattrapage     INTEGER DEFAULT 0,
        player_cards   TEXT,
        banker_cards   TEXT,
        resolved_at    TIMESTAMPTZ,
        created_at     TIMESTAMPTZ DEFAULT NOW(),
        UNIQUE(strategy, game_number, predicted_suit)
      );

      CREATE TABLE IF NOT EXISTS users_export (
        id                           INTEGER PRIMARY KEY,
        username                     TEXT NOT NULL,
        email                        TEXT,
        first_name                   TEXT,
        last_name                    TEXT,
        is_admin                     BOOLEAN DEFAULT FALSE,
        is_approved                  BOOLEAN DEFAULT FALSE,
        subscription_expires_at      TIMESTAMPTZ,
        subscription_duration_minutes INTEGER,
        created_at                   TIMESTAMPTZ DEFAULT NOW(),
        synced_at                    TIMESTAMPTZ DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS strategies_export (
        id        INTEGER PRIMARY KEY,
        data      TEXT NOT NULL,
        synced_at TIMESTAMPTZ DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS settings_export (
        key       TEXT PRIMARY KEY,
        value     TEXT NOT NULL,
        synced_at TIMESTAMPTZ DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS telegram_channels_export (
        channel_id   TEXT PRIMARY KEY,
        channel_name TEXT,
        enabled      BOOLEAN DEFAULT TRUE,
        synced_at    TIMESTAMPTZ DEFAULT NOW()
      );
    `);
    console.log('[RenderSync] Tables initialisées');
  } catch (e) {
    console.error('[RenderSync] Erreur init tables:', e.message);
  }
}

// ── Extraction depuis la base externe → import local ────────────────

async function _pullFromExternal() {
  if (!renderPool) return;
  try {
    // 1. Importer les utilisateurs
    const usersRes = await renderPool.query('SELECT * FROM users_export');
    for (const u of usersRes.rows) {
      try {
        await db.pool.query(`
          INSERT INTO users (id, username, email, first_name, last_name, is_admin, is_approved,
            subscription_expires_at, subscription_duration_minutes, created_at)
          VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
          ON CONFLICT (id) DO UPDATE SET
            subscription_expires_at      = EXCLUDED.subscription_expires_at,
            subscription_duration_minutes= EXCLUDED.subscription_duration_minutes,
            is_approved                  = EXCLUDED.is_approved,
            first_name                   = EXCLUDED.first_name,
            last_name                    = EXCLUDED.last_name
        `, [u.id, u.username, u.email, u.first_name, u.last_name,
            u.is_admin, u.is_approved, u.subscription_expires_at,
            u.subscription_duration_minutes, u.created_at]);
      } catch {}
    }
    if (usersRes.rows.length) console.log(`[RenderSync] ← ${usersRes.rows.length} utilisateur(s) importé(s)`);

    // 2. Importer les stratégies
    const stratRes = await renderPool.query('SELECT data FROM strategies_export LIMIT 1');
    if (stratRes.rows.length && stratRes.rows[0].data) {
      const existing = await db.getSetting('custom_strategies');
      if (!existing || existing === '[]') {
        await db.setSetting('custom_strategies', stratRes.rows[0].data);
        console.log('[RenderSync] ← Stratégies importées');
      }
    }

    // 3. Importer les settings clés
    const settingsRes = await renderPool.query('SELECT key, value FROM settings_export');
    const PROTECTED_KEYS = ['custom_strategies', 'render_db_url'];
    for (const row of settingsRes.rows) {
      if (PROTECTED_KEYS.includes(row.key)) continue;
      try {
        const local = await db.getSetting(row.key);
        if (!local) await db.setSetting(row.key, row.value);
      } catch {}
    }
    if (settingsRes.rows.length) console.log(`[RenderSync] ← ${settingsRes.rows.length} setting(s) importé(s)`);

    // 4. Importer les canaux Telegram
    try {
      const tgRes = await renderPool.query('SELECT * FROM telegram_channels_export');
      for (const ch of tgRes.rows) {
        try { await db.upsertTelegramConfig({ channel_id: ch.channel_id, channel_name: ch.channel_name || ch.channel_id }); } catch {}
      }
      if (tgRes.rows.length) console.log(`[RenderSync] ← ${tgRes.rows.length} canal(aux) Telegram importé(s)`);
    } catch {}

  } catch (e) {
    console.error('[RenderSync] Erreur extraction externe:', e.message);
  }
}

// ── Push complet local → externe ─────────────────────────────────────

async function _pushAllToExternal() {
  if (!renderPool) return;
  await syncAllUsers();
  await syncStrategies();
  await syncAllSettings();
  await syncTelegramChannels();
  await _pushVerifiedPredictions();
}

async function _pushVerifiedPredictions() {
  if (!renderPool) return;
  try {
    const r = await db.pool.query(
      `SELECT * FROM predictions WHERE status IN ('gagne','perdu') ORDER BY created_at DESC LIMIT 2000`
    );
    for (const pred of r.rows) {
      await syncVerifiedPrediction(pred);
    }
    console.log(`[RenderSync] → ${r.rows.length} prédiction(s) poussée(s)`);
  } catch (e) {
    console.error('[RenderSync] Erreur push prédictions:', e.message);
  }
}

// ── Sync utilisateurs ────────────────────────────────────────────────

async function syncAllUsers() {
  if (!renderPool) return;
  try {
    const users = await db.getAllUsers();
    for (const u of users) await syncUser(u);
    if (users.length) console.log(`[RenderSync] → ${users.length} utilisateur(s) synchronisé(s)`);
  } catch (e) {
    console.error('[RenderSync] Erreur sync utilisateurs:', e.message);
  }
}

async function syncUser(u) {
  if (!renderPool || !u) return;
  try {
    await renderPool.query(`
      INSERT INTO users_export
        (id, username, email, first_name, last_name, is_admin, is_approved,
         subscription_expires_at, subscription_duration_minutes, created_at, synced_at)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,NOW())
      ON CONFLICT (id) DO UPDATE SET
        email                        = EXCLUDED.email,
        first_name                   = EXCLUDED.first_name,
        last_name                    = EXCLUDED.last_name,
        is_approved                  = EXCLUDED.is_approved,
        subscription_expires_at      = EXCLUDED.subscription_expires_at,
        subscription_duration_minutes= EXCLUDED.subscription_duration_minutes,
        synced_at                    = NOW()
    `, [u.id, u.username, u.email || null, u.first_name || null, u.last_name || null,
        u.is_admin || false, u.is_approved || false,
        u.subscription_expires_at || null, u.subscription_duration_minutes || null,
        u.created_at || new Date().toISOString()]);
  } catch (e) {
    console.error('[RenderSync] Erreur sync user:', e.message);
  }
}

// ── Sync stratégies ──────────────────────────────────────────────────

async function syncStrategies() {
  if (!renderPool) return;
  try {
    const raw = await db.getSetting('custom_strategies');
    if (!raw) return;
    const parsed = JSON.parse(raw);
    const list = Array.isArray(parsed) ? parsed : [parsed];
    for (const s of list) {
      await renderPool.query(`
        INSERT INTO strategies_export (id, data, synced_at)
        VALUES ($1,$2,NOW())
        ON CONFLICT (id) DO UPDATE SET data=EXCLUDED.data, synced_at=NOW()
      `, [s.id, JSON.stringify(s)]);
    }
    console.log(`[RenderSync] → ${list.length} stratégie(s) synchronisée(s)`);
  } catch (e) {
    console.error('[RenderSync] Erreur sync stratégies:', e.message);
  }
}

// ── Sync settings clés (messages, bilan, telegram, etc.) ─────────────

const SYNC_SETTINGS_KEYS = [
  'bilan_last', 'broadcast_message', 'tg_announcements',
  'user_messages', 'tg_msg_format', 'max_rattrapage',
  'loss_sequences', 'default_strategies_tg', 'ui_styles', 'custom_css',
  'bot_token', 'telegram_chat_config',
];

async function syncAllSettings() {
  if (!renderPool) return;
  try {
    for (const key of SYNC_SETTINGS_KEYS) {
      const val = await db.getSetting(key);
      if (val !== null) await _upsertSetting(key, val);
    }
  } catch (e) {
    console.error('[RenderSync] Erreur sync settings:', e.message);
  }
}

async function syncSetting(key, value) {
  if (!renderPool) return;
  if (!SYNC_SETTINGS_KEYS.includes(key)) return;
  await _upsertSetting(key, value);
}

async function _upsertSetting(key, value) {
  try {
    await renderPool.query(`
      INSERT INTO settings_export (key, value, synced_at)
      VALUES ($1,$2,NOW())
      ON CONFLICT (key) DO UPDATE SET value=EXCLUDED.value, synced_at=NOW()
    `, [key, value]);
  } catch (e) {
    console.error(`[RenderSync] Erreur upsert setting ${key}:`, e.message);
  }
}

// ── Sync canaux Telegram (table telegram_config) ─────────────────────

async function syncTelegramChannels() {
  if (!renderPool) return;
  try {
    const channels = await db.getTelegramConfigs(false);
    if (!channels || !channels.length) return;
    for (const ch of channels) {
      await _upsertTelegramChannel(ch);
    }
    console.log(`[RenderSync] → ${channels.length} canal(aux) Telegram synchronisé(s)`);
  } catch (e) {
    console.error('[RenderSync] Erreur sync canaux Telegram:', e.message);
  }
}

async function syncTelegramChannel(ch) {
  if (!renderPool || !ch) return;
  await _upsertTelegramChannel(ch);
}

async function syncDeleteTelegramChannel(channelId) {
  if (!renderPool || !channelId) return;
  try {
    await renderPool.query(
      `DELETE FROM telegram_channels_export WHERE channel_id = $1`,
      [String(channelId)]
    );
  } catch (e) {
    console.error('[RenderSync] Erreur suppression canal Telegram:', e.message);
  }
}

async function _upsertTelegramChannel(ch) {
  try {
    await renderPool.query(`
      INSERT INTO telegram_channels_export (channel_id, channel_name, enabled, synced_at)
      VALUES ($1, $2, $3, NOW())
      ON CONFLICT (channel_id) DO UPDATE SET
        channel_name = EXCLUDED.channel_name,
        enabled      = EXCLUDED.enabled,
        synced_at    = NOW()
    `, [String(ch.channel_id), ch.channel_name || ch.channel_id, ch.enabled !== false]);
  } catch (e) {
    console.error('[RenderSync] Erreur upsert canal Telegram:', e.message);
  }
}

// ── Sync prédiction vérifiée ─────────────────────────────────────────

async function syncVerifiedPrediction(pred) {
  if (!renderPool) return;
  try {
    await renderPool.query(`
      INSERT INTO predictions_export
        (strategy, game_number, predicted_suit, status, rattrapage,
         player_cards, banker_cards, resolved_at, created_at)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
      ON CONFLICT (strategy, game_number, predicted_suit)
        DO UPDATE SET
          status       = EXCLUDED.status,
          rattrapage   = EXCLUDED.rattrapage,
          player_cards = EXCLUDED.player_cards,
          banker_cards = EXCLUDED.banker_cards,
          resolved_at  = EXCLUDED.resolved_at
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

// ── Reset jeu #1 : efface UNIQUEMENT les prédictions ────────────────

async function handleGameOne(gameNumber) {
  if (gameNumber !== 1) { _gameOneHandled = false; return; }
  if (_gameOneHandled) return;
  _gameOneHandled = true;
  if (!renderPool) return;
  try {
    const r = await renderPool.query('DELETE FROM predictions_export');
    console.log(`[RenderSync] 🔄 RESET — ${r.rowCount} prédiction(s) effacée(s) — utilisateurs/stratégies conservés`);
  } catch (e) {
    console.error('[RenderSync] Erreur reset jeu #1:', e.message);
    _gameOneHandled = false;
  }
}

// ── Test de connexion ─────────────────────────────────────────────────

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

// ── Statistiques ──────────────────────────────────────────────────────

async function getRenderStats() {
  if (!renderPool) return null;
  try {
    const r = await renderPool.query(`
      SELECT
        COUNT(*) FILTER (WHERE status='gagne') AS wins,
        COUNT(*) FILTER (WHERE status='perdu')  AS losses,
        COUNT(*)                                 AS total,
        MAX(game_number)                         AS last_game
      FROM predictions_export
    `);
    return r.rows[0];
  } catch { return null; }
}

function isConnected() { return !!renderPool; }

module.exports = {
  loadRenderUrl,
  syncVerifiedPrediction,
  syncUser,
  syncAllUsers,
  syncStrategies,
  syncSetting,
  syncAllSettings,
  syncTelegramChannels,
  syncTelegramChannel,
  syncDeleteTelegramChannel,
  handleGameOne,
  testConnection,
  getRenderStats,
  isConnected,
};
