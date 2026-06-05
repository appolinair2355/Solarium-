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

// ── Circuit-breaker ──────────────────────────────────────────────────
// Sur Render free, la base externe peut s'endormir et générer en boucle
// "Connection terminated unexpectedly" / ECONNRESET. On suspend les écritures
// pendant un cooldown après plusieurs échecs consécutifs, puis on retente.
let _consecFailures   = 0;
let _circuitOpenUntil = 0;       // timestamp ms ; 0 = circuit fermé (sync OK)
const FAIL_THRESHOLD     = 4;    // après N échecs ⇒ ouvre le circuit
const COOLDOWN_MS        = 60_000; // 1 min de pause à chaque ouverture
const COOLDOWN_MAX_MS    = 5 * 60_000; // plafond du backoff
let _circuitOpens = 0;           // nb d'ouvertures consécutives (pour backoff)
let _lastCircuitLog = 0;         // throttle des logs "circuit ouvert"

function _circuitIsOpen() {
  return Date.now() < _circuitOpenUntil;
}

function _onSuccess() {
  if (_consecFailures > 0 || _circuitOpens > 0) {
    console.log('[RenderSync] ✅ Connexion rétablie — circuit refermé');
  }
  _consecFailures = 0;
  _circuitOpens   = 0;
  _circuitOpenUntil = 0;
}

function _onFailure(msg) {
  _consecFailures += 1;
  if (_consecFailures >= FAIL_THRESHOLD && !_circuitIsOpen()) {
    _circuitOpens += 1;
    const wait = Math.min(COOLDOWN_MS * Math.pow(2, _circuitOpens - 1), COOLDOWN_MAX_MS);
    _circuitOpenUntil = Date.now() + wait;
    console.warn(`[RenderSync] 🛑 Base externe instable (${_consecFailures} échecs consécutifs) — pause ${Math.round(wait / 1000)}s`);
  }
}

// ── Connexion ────────────────────────────────────────────────────────

const DEFAULT_RENDER_URL = 'postgresql://sossou_user:jpq5vOtf1RwtvT7Znlu41dyFj7JSuBKd@dpg-d7nru8iqqhas7384b3og-a.oregon-postgres.render.com/sossou';

// ── Pool factory avec gestion d'erreurs robuste ──────────────────────
function _createPool(url) {
  const pool = new Pool({
    connectionString: url,
    ssl: { rejectUnauthorized: false },
    connectionTimeoutMillis: 12000,
    idleTimeoutMillis: 8000,           // ferme les connexions idles AVANT que Render ne les coupe (~10-15s)
    max: 2,                            // peu de connexions simultanées sur Render free
    min: 0,                            // ne pas garder de connexions persistantes inutiles
    keepAlive: true,                   // évite les déconnexions silencieuses
    keepAliveInitialDelayMillis: 5000, // ping keepalive après 5s d'inactivité
    statement_timeout: 20000,
  });
  // Capture les erreurs de connexion idle pour empêcher le crash du process
  pool.on('error', (err) => {
    console.warn('[RenderSync] ⚠️ Pool error (ignoré):', err.message);
  });
  return pool;
}

// ── Wrapper avec retry automatique (reconnect si "Connection terminated") ──
// + circuit-breaker pour ne pas spammer les logs quand la base externe est down.
async function _query(sql, params, retries = 2) {
  if (_circuitIsOpen()) {
    // Throttle : ne logge "circuit ouvert" qu'une fois par 30 s
    const now = Date.now();
    if (now - _lastCircuitLog > 30_000) {
      const remaining = Math.max(0, Math.round((_circuitOpenUntil - now) / 1000));
      console.log(`[RenderSync] ⏸  sync suspendue — reprise dans ${remaining}s`);
      _lastCircuitLog = now;
    }
    const e = new Error('RenderSync: circuit ouvert (base externe injoignable)');
    e.code = 'CIRCUIT_OPEN';
    throw e;
  }
  for (let attempt = 0; attempt <= retries; attempt++) {
    if (!renderPool) throw new Error('Pool non initialisé');
    try {
      const r = await renderPool.query(sql, params);
      _onSuccess();
      return r;
    } catch (e) {
      const msg = (e && e.message) || '';
      const transient = /Connection terminated|ECONNRESET|read ECONNRESET|server closed the connection|terminat/i.test(msg);
      if (transient && attempt < retries) {
        // Logs réduits : silencieux après le 1ᵉʳ échec consécutif (déjà bruyant)
        if (_consecFailures < 1) {
          console.warn(`[RenderSync] 🔁 Retry ${attempt + 1}/${retries} — ${msg}`);
        }
        // Recrée le pool si la connexion a été perdue
        try { await renderPool.end(); } catch {}
        renderPool = _createPool(currentUrl);
        await new Promise(r => setTimeout(r, 800 * (attempt + 1)));
        continue;
      }
      // Marquer l'erreur comme transitoire pour que les appelants ne la loggent pas
      // (le circuit-breaker la gère déjà)
      if (transient && !e.code) e.code = 'TRANSIENT';
      _onFailure(msg);
      throw e;
    }
  }
}

async function loadRenderUrl() {
  try {
    let url = await db.getSetting('render_db_url');
    if (!url || !url.trim()) {
      url = DEFAULT_RENDER_URL;
      await db.setSetting('render_db_url', url);
      console.log('[RenderSync] URL par défaut configurée automatiquement');
    }
    if (url && url.trim()) {
      // ── Protection anti-boucle : si l'URL de sync == la DB principale, on désactive ──
      // Sur Render, la DB principale ET la DB de sync sont souvent la même (sossou).
      // Syncer une base avec elle-même écraserait les mots de passe avec '$imported$'.
      const mainUrl = (db.MAIN_DB_URL || '').replace(/\/$/, '').trim();
      const syncUrl = url.trim().replace(/\/$/, '');
      if (syncUrl === mainUrl) {
        console.log('[RenderSync] ⏭  DB sync = DB principale — sync désactivée (même base, boucle évitée)');
        return;
      }

      if (url.trim() !== currentUrl) {
        if (renderPool) { try { await renderPool.end(); } catch {} }
        currentUrl = url.trim();
        renderPool = _createPool(currentUrl);
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
    if (e.code !== 'CIRCUIT_OPEN' && e.code !== 'TRANSIENT') console.error('[RenderSync] Erreur chargement URL:', e.message);
    // Ne pas détruire le pool — on tentera à la prochaine sync
  }
}

// ── Initialisation des tables ────────────────────────────────────────

async function initRenderDb() {
  if (!renderPool) return;
  try {
    await _query(`
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
    // ── Migration : s'assure que les colonnes critiques sont bien TEXT ──
    // Nécessaire si la table a été créée avec un type plus restreint (ex: VARCHAR(5))
    const alterCols = [
      ['predictions_export', 'predicted_suit'],
      ['predictions_export', 'player_cards'],
      ['predictions_export', 'banker_cards'],
      ['predictions_export', 'status'],
      ['predictions_export', 'strategy'],
    ];
    for (const [table, col] of alterCols) {
      try {
        await _query(
          `ALTER TABLE ${table} ALTER COLUMN ${col} TYPE TEXT`
        );
      } catch {}
    }

    // ── Ajout des colonnes liées au système d'abonnement / parrainage ──
    const addCols = [
      `ALTER TABLE users_export ADD COLUMN IF NOT EXISTS account_type TEXT DEFAULT 'simple'`,
      `ALTER TABLE users_export ADD COLUMN IF NOT EXISTS is_premium BOOLEAN DEFAULT FALSE`,
      `ALTER TABLE users_export ADD COLUMN IF NOT EXISTS is_pro BOOLEAN DEFAULT FALSE`,
      `ALTER TABLE users_export ADD COLUMN IF NOT EXISTS promo_code TEXT`,
      `ALTER TABLE users_export ADD COLUMN IF NOT EXISTS referrer_user_id INTEGER`,
      `ALTER TABLE users_export ADD COLUMN IF NOT EXISTS referral_bonus_used BOOLEAN DEFAULT FALSE`,
      `ALTER TABLE users_export ADD COLUMN IF NOT EXISTS bonus_minutes_earned INTEGER DEFAULT 0`,
    ];
    for (const sql of addCols) { try { await _query(sql); } catch {} }

    console.log('[RenderSync] Tables initialisées');
  } catch (e) {
    if (e.code !== 'CIRCUIT_OPEN' && e.code !== 'TRANSIENT') console.error('[RenderSync] Erreur init tables:', e.message);
  }
}

// ── Extraction depuis la base externe → import local ────────────────

async function _pullFromExternal() {
  if (!renderPool) return;
  try {
    // 1. Importer les utilisateurs (les comptes admin sont gérés par initDB, on les ignore ici)
    const usersRes = await _query('SELECT * FROM users_export');
    let usersImported = 0;
    for (const u of usersRes.rows) {
      // Ne jamais écraser les comptes admin avec des données du DB de sync
      if (u.is_admin) continue;
      try {
        await db.pool.query(`
          INSERT INTO users (id, username, email, first_name, last_name, is_admin, is_approved,
            subscription_expires_at, subscription_duration_minutes, created_at,
            password_hash, account_type, is_premium, is_pro, promo_code,
            referrer_user_id, referral_bonus_used, bonus_minutes_earned)
          VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18)
          ON CONFLICT (id) DO UPDATE SET
            subscription_expires_at       = EXCLUDED.subscription_expires_at,
            subscription_duration_minutes = EXCLUDED.subscription_duration_minutes,
            is_approved                   = EXCLUDED.is_approved,
            first_name                    = EXCLUDED.first_name,
            last_name                     = EXCLUDED.last_name,
            account_type                  = EXCLUDED.account_type,
            is_premium                    = EXCLUDED.is_premium,
            is_pro                        = EXCLUDED.is_pro,
            promo_code                    = COALESCE(users.promo_code, EXCLUDED.promo_code),
            bonus_minutes_earned          = EXCLUDED.bonus_minutes_earned
        `, [u.id, u.username, u.email, u.first_name, u.last_name,
            u.is_admin, u.is_approved, u.subscription_expires_at,
            u.subscription_duration_minutes, u.created_at,
            '$imported$', u.account_type || 'simple', u.is_premium || false, u.is_pro || false,
            u.promo_code, u.referrer_user_id, u.referral_bonus_used || false, u.bonus_minutes_earned || 0]);
        usersImported++;
      } catch (e) {
        console.warn(`[RenderSync] Import user ${u.username} échoué:`, e.message);
      }
    }
    if (usersImported) console.log(`[RenderSync] ← ${usersImported} utilisateur(s) importé(s)`);

    // 2. Importer les stratégies — fusion par ID (n'écrase pas les existantes)
    const stratRes = await _query('SELECT data FROM strategies_export ORDER BY id');
    if (stratRes.rows.length) {
      const existingRaw = await db.getSetting('custom_strategies');
      const existingList = (existingRaw && existingRaw !== '[]') ? JSON.parse(existingRaw) : [];
      const existingIds = new Set(existingList.map(s => s.id));
      let added = 0;
      for (const row of stratRes.rows) {
        try {
          const parsed = typeof row.data === 'string' ? JSON.parse(row.data) : row.data;
          if (parsed && parsed.kind !== 'pro' && !existingIds.has(parsed.id)) {
            existingList.push(parsed);
            existingIds.add(parsed.id);
            added++;
          }
        } catch {}
      }
      if (added > 0) {
        await db.setSetting('custom_strategies', JSON.stringify(existingList));
        console.log(`[RenderSync] ← ${added} stratégie(s) importée(s) (${existingList.length} total)`);
      }
    }

    // 3. Importer les settings clés
    const settingsRes = await _query('SELECT key, value FROM settings_export');
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
      const tgRes = await _query('SELECT * FROM telegram_channels_export');
      for (const ch of tgRes.rows) {
        try { await db.upsertTelegramConfig({ channel_id: ch.channel_id, channel_name: ch.channel_name || ch.channel_id }); } catch {}
      }
      if (tgRes.rows.length) console.log(`[RenderSync] ← ${tgRes.rows.length} canal(aux) Telegram importé(s)`);
    } catch {}

  } catch (e) {
    if (e.code !== 'CIRCUIT_OPEN' && e.code !== 'TRANSIENT') console.error('[RenderSync] Erreur extraction externe:', e.message);
  }
}

// ── Push complet local → externe ─────────────────────────────────────

async function _pushAllToExternal() {
  if (!renderPool) return;
  // Réinitialise les admins après le pull pour garantir leurs mots de passe
  try { await db.reinitAdmins(); } catch {}
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
    if (e.code !== 'CIRCUIT_OPEN' && e.code !== 'TRANSIENT') console.error('[RenderSync] Erreur push prédictions:', e.message);
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
    if (e.code !== 'CIRCUIT_OPEN' && e.code !== 'TRANSIENT') console.error('[RenderSync] Erreur sync utilisateurs:', e.message);
  }
}

async function syncUser(u) {
  if (!renderPool || !u) return;
  try {
    await _query(`
      INSERT INTO users_export
        (id, username, email, first_name, last_name, is_admin, is_approved,
         subscription_expires_at, subscription_duration_minutes, created_at,
         account_type, is_premium, is_pro, promo_code,
         referrer_user_id, referral_bonus_used, bonus_minutes_earned, synced_at)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,NOW())
      ON CONFLICT (id) DO UPDATE SET
        email                         = EXCLUDED.email,
        first_name                    = EXCLUDED.first_name,
        last_name                     = EXCLUDED.last_name,
        is_approved                   = EXCLUDED.is_approved,
        subscription_expires_at       = EXCLUDED.subscription_expires_at,
        subscription_duration_minutes = EXCLUDED.subscription_duration_minutes,
        account_type                  = EXCLUDED.account_type,
        is_premium                    = EXCLUDED.is_premium,
        is_pro                        = EXCLUDED.is_pro,
        promo_code                    = COALESCE(users_export.promo_code, EXCLUDED.promo_code),
        referrer_user_id              = COALESCE(users_export.referrer_user_id, EXCLUDED.referrer_user_id),
        referral_bonus_used           = EXCLUDED.referral_bonus_used,
        bonus_minutes_earned          = EXCLUDED.bonus_minutes_earned,
        synced_at                     = NOW()
    `, [
      u.id, u.username, u.email || null, u.first_name || null, u.last_name || null,
      u.is_admin || false, u.is_approved || false,
      u.subscription_expires_at || null, u.subscription_duration_minutes || null,
      u.created_at || new Date().toISOString(),
      u.account_type || 'simple', u.is_premium || false, u.is_pro || false,
      u.promo_code || null, u.referrer_user_id || null,
      u.referral_bonus_used || false, u.bonus_minutes_earned || 0,
    ]);
  } catch (e) {
    if (e.code !== 'CIRCUIT_OPEN' && e.code !== 'TRANSIENT') console.error('[RenderSync] Erreur sync user:', e.message);
  }
}

// ── Sync stratégies ──────────────────────────────────────────────────

async function syncStrategies() {
  if (!renderPool) return;
  try {
    const raw = await db.getSetting('custom_strategies');
    let count = 0;
    if (raw) {
      const parsed = JSON.parse(raw);
      const list = Array.isArray(parsed) ? parsed : [parsed];
      for (const s of list) {
        await _query(`
          INSERT INTO strategies_export (id, data, synced_at)
          VALUES ($1,$2,NOW())
          ON CONFLICT (id) DO UPDATE SET data=EXCLUDED.data, synced_at=NOW()
        `, [s.id, JSON.stringify(s)]);
      }
      count = list.length;
    }
    // Sync également les stratégies Pro (S5001-S5100) dans la même table
    const proCount = await syncProStrategies();
    if (count + proCount > 0) {
      console.log(`[RenderSync] → ${count} stratégie(s) custom + ${proCount} stratégie(s) Pro synchronisée(s)`);
    }
  } catch (e) {
    if (e.code !== 'CIRCUIT_OPEN' && e.code !== 'TRANSIENT') console.error('[RenderSync] Erreur sync stratégies:', e.message);
  }
}

// ── Sync stratégies Pro (S5001-S5100) ────────────────────────────────
// Pousse meta + contenu de chaque stratégie Pro vers strategies_export.
// Le payload `data` contient {kind:'pro', meta, content} pour distinguer
// les stratégies Pro des stratégies custom dans la base externe.
async function syncProStrategies() {
  if (!renderPool) return 0;
  try {
    const raw = await db.getSetting('pro_strategies_list').catch(() => null);
    if (!raw) return 0;
    const list = JSON.parse(raw);
    if (!Array.isArray(list) || !list.length) return 0;
    let synced = 0;
    for (const s of list) {
      try {
        const metaRaw = await db.getSetting(`pro_strategy_${s.id}_meta`).catch(() => null);
        const meta = metaRaw ? JSON.parse(metaRaw) : { ...s };
        const content = await db.getSetting(`pro_strategy_${s.id}_content`).catch(() => null);
        const payload = { kind: 'pro', meta, content: content || '' };
        await _query(`
          INSERT INTO strategies_export (id, data, synced_at)
          VALUES ($1,$2,NOW())
          ON CONFLICT (id) DO UPDATE SET data=EXCLUDED.data, synced_at=NOW()
        `, [s.id, JSON.stringify(payload)]);
        synced++;
      } catch (e) {
        if (e.code !== 'CIRCUIT_OPEN' && e.code !== 'TRANSIENT') console.error(`[RenderSync] Erreur sync Pro S${s.id}:`, e.message);
      }
    }
    return synced;
  } catch (e) {
    if (e.code !== 'CIRCUIT_OPEN' && e.code !== 'TRANSIENT') console.error('[RenderSync] Erreur sync stratégies Pro:', e.message);
    return 0;
  }
}

// Pousse UNE stratégie Pro (appelé après création/modification/changement de cibles TG)
async function syncProStrategy(meta, content = null) {
  if (!renderPool || !meta || !meta.id) return;
  try {
    let body = content;
    if (body === null) {
      body = await db.getSetting(`pro_strategy_${meta.id}_content`).catch(() => null);
    }
    const payload = { kind: 'pro', meta, content: body || '' };
    await _query(`
      INSERT INTO strategies_export (id, data, synced_at)
      VALUES ($1,$2,NOW())
      ON CONFLICT (id) DO UPDATE SET data=EXCLUDED.data, synced_at=NOW()
    `, [meta.id, JSON.stringify(payload)]);
  } catch (e) {
    if (e.code !== 'CIRCUIT_OPEN' && e.code !== 'TRANSIENT') console.error(`[RenderSync] Erreur sync Pro S${meta.id}:`, e.message);
  }
}

// Supprime UNE stratégie de la base externe (custom OU Pro — même table)
async function syncDeleteStrategy(id) {
  if (!renderPool || !id) return;
  try {
    const r = await _query(`DELETE FROM strategies_export WHERE id = $1`, [parseInt(id)]);
    if (r.rowCount) console.log(`[RenderSync] 🗑 Stratégie #${id} supprimée de la base externe`);
  } catch (e) {
    if (e.code !== 'CIRCUIT_OPEN' && e.code !== 'TRANSIENT') console.error(`[RenderSync] Erreur suppression stratégie #${id}:`, e.message);
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
    if (e.code !== 'CIRCUIT_OPEN' && e.code !== 'TRANSIENT') console.error('[RenderSync] Erreur sync settings:', e.message);
  }
}

async function syncSetting(key, value) {
  if (!renderPool) return;
  if (!SYNC_SETTINGS_KEYS.includes(key)) return;
  await _upsertSetting(key, value);
}

async function _upsertSetting(key, value) {
  try {
    await _query(`
      INSERT INTO settings_export (key, value, synced_at)
      VALUES ($1,$2,NOW())
      ON CONFLICT (key) DO UPDATE SET value=EXCLUDED.value, synced_at=NOW()
    `, [key, value]);
  } catch (e) {
    if (e.code !== "CIRCUIT_OPEN") console.error(`[RenderSync] Erreur upsert setting ${key}:`, e.message);
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
    if (e.code !== 'CIRCUIT_OPEN' && e.code !== 'TRANSIENT') console.error('[RenderSync] Erreur sync canaux Telegram:', e.message);
  }
}

async function syncTelegramChannel(ch) {
  if (!renderPool || !ch) return;
  await _upsertTelegramChannel(ch);
}

async function syncDeleteTelegramChannel(channelId) {
  if (!renderPool || !channelId) return;
  try {
    await _query(
      `DELETE FROM telegram_channels_export WHERE channel_id = $1`,
      [String(channelId)]
    );
  } catch (e) {
    if (e.code !== 'CIRCUIT_OPEN' && e.code !== 'TRANSIENT') console.error('[RenderSync] Erreur suppression canal Telegram:', e.message);
  }
}

async function _upsertTelegramChannel(ch) {
  try {
    await _query(`
      INSERT INTO telegram_channels_export (channel_id, channel_name, enabled, synced_at)
      VALUES ($1, $2, $3, NOW())
      ON CONFLICT (channel_id) DO UPDATE SET
        channel_name = EXCLUDED.channel_name,
        enabled      = EXCLUDED.enabled,
        synced_at    = NOW()
    `, [String(ch.channel_id), ch.channel_name || ch.channel_id, ch.enabled !== false]);
  } catch (e) {
    if (e.code !== 'CIRCUIT_OPEN' && e.code !== 'TRANSIENT') console.error('[RenderSync] Erreur upsert canal Telegram:', e.message);
  }
}

// ── Sync prédiction vérifiée ─────────────────────────────────────────

async function syncVerifiedPrediction(pred) {
  if (!renderPool) return;
  try {
    await _query(`
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
    if (e.code !== 'CIRCUIT_OPEN' && e.code !== 'TRANSIENT') console.error('[RenderSync] Erreur sync prédiction:', e.message);
  }
}

// ── Reset jeu #1 : efface UNIQUEMENT les prédictions ────────────────

async function handleGameOne(gameNumber) {
  if (gameNumber !== 1) { _gameOneHandled = false; return; }
  if (_gameOneHandled) return;
  _gameOneHandled = true;
  if (!renderPool) return;
  try {
    const r = await _query('DELETE FROM predictions_export');
    console.log(`[RenderSync] 🔄 RESET — ${r.rowCount} prédiction(s) effacée(s) — utilisateurs/stratégies conservés`);
  } catch (e) {
    if (e.code !== 'CIRCUIT_OPEN' && e.code !== 'TRANSIENT') console.error('[RenderSync] Erreur reset jeu #1:', e.message);
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
    const r = await _query(`
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

// ── Effacement manuel de la table predictions_export sur la base Render ──
// Appelé quand l'admin clique "Effacer toutes les prédictions" dans l'onglet Système.
async function clearExternalPredictions() {
  if (!renderPool) return 0;
  try {
    const r = await _query('DELETE FROM predictions_export');
    console.log(`[RenderSync] 🧹 ${r.rowCount} prédiction(s) effacée(s) de la base Render externe`);
    return r.rowCount;
  } catch (e) {
    if (e.code !== 'CIRCUIT_OPEN' && e.code !== 'TRANSIENT') console.error('[RenderSync] Erreur clearExternalPredictions:', e.message);
    return 0;
  }
}

module.exports = {
  loadRenderUrl,
  syncVerifiedPrediction,
  syncUser,
  syncAllUsers,
  syncStrategies,
  syncProStrategies,
  syncProStrategy,
  syncDeleteStrategy,
  syncSetting,
  syncAllSettings,
  syncTelegramChannels,
  syncTelegramChannel,
  syncDeleteTelegramChannel,
  handleGameOne,
  clearExternalPredictions,
  testConnection,
  getRenderStats,
  isConnected,
};
