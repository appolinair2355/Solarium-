/**
 * Paiements externes — lecture d'une base PostgreSQL de paiement gérée par
 * l'administrateur sur son propre site (identifiant, mot de passe, référence,
 * montant, date/heure et motif du paiement : abonnement bot, abonnement
 * mensuel, achat d'une stratégie, ou soutien à l'administrateur).
 *
 * Flux :
 *   1. L'admin configure l'URL de connexion (lecture seule suffit) via
 *      /setpaymentdb, et le nom de la table + des colonnes via
 *      /setpaymentcols (valeurs par défaut fournies).
 *   2. L'admin définit ce que chaque "motif" de paiement doit accorder via
 *      /setpurpose <mot-clé> <duration|strategy|support> <valeur> [libellé] :
 *        - duration <minutes>  → prolonge l'abonnement de X minutes
 *        - strategy <id>       → donne accès à une stratégie précise
 *        - support             → aucun accès, juste un remerciement
 *   3. Quand un utilisateur clique "Déjà payé ?" (site web ou bot Telegram),
 *      il saisit l'identifiant + mot de passe utilisés lors du paiement sur
 *      le site externe. On vérifie ces identifiants DIRECTEMENT dans la base
 *      externe (colonnes username/password), puis on liste tous ses
 *      paiements (référence, montant, date, motif) dans un joli bilan, et on
 *      crédite automatiquement son compte Baccarat Pro (celui actuellement
 *      connecté / lié) selon le motif — sans jamais écrire dans la base
 *      externe (lecture seule).
 *   4. Un cycle automatique en arrière-plan fait la même chose sans
 *      intervention : il associe simplement le nom d'utilisateur du paiement
 *      externe au nom d'utilisateur Baccarat Pro (même identifiant supposé
 *      sur les deux sites) et crédite dès qu'un nouveau paiement apparaît.
 *
 *   ⚠️ Hypothèse : la colonne "password" de la base externe est comparée en
 *   clair (texte brut) au mot de passe saisi, car le schéma de hachage du
 *   site externe n'est pas connu. Si ce site hache les mots de passe
 *   différemment, prévenir l'administrateur pour adapter la comparaison.
 */
const { Pool } = require('pg');
const db = require('./db');

let pool = null;
let currentUrl = null;

const DEFAULT_COLUMNS = {
  table: 'payments',
  username: 'username',
  password: 'password',
  reference: 'reference',
  amount: 'amount',
  paidAt: 'paid_at',
  purpose: 'purpose',
};

function _createPool(url) {
  const p = new Pool({
    connectionString: url,
    ssl: { rejectUnauthorized: false },
    connectionTimeoutMillis: 10000,
    idleTimeoutMillis: 8000,
    max: 2,
    min: 0,
  });
  p.on('error', (err) => console.warn('[PaymentExt] ⚠️ Pool error (ignoré):', err.message));
  return p;
}

async function getColumns() {
  try {
    const raw = await db.getSetting('payment_ext_columns');
    if (raw) return { ...DEFAULT_COLUMNS, ...JSON.parse(raw) };
  } catch {}
  return { ...DEFAULT_COLUMNS };
}

async function setColumns(partial) {
  const merged = { ...(await getColumns()), ...partial };
  await db.setSetting('payment_ext_columns', JSON.stringify(merged));
  return merged;
}

// ── Grille des motifs de paiement → ce que ça accorde ──────────────────────
async function getPurposes() {
  try {
    const raw = await db.getSetting('payment_ext_purposes');
    if (raw) return JSON.parse(raw);
  } catch {}
  return [];
}

async function setPurpose(keyword, type, value, label) {
  const purposes = await getPurposes();
  const idx = purposes.findIndex(p => p.match.toLowerCase() === keyword.toLowerCase());
  const entry = { match: keyword, type, value: type === 'duration' ? parseInt(value) : (type === 'strategy' ? String(value) : null), label: label || keyword };
  if (idx >= 0) purposes[idx] = entry; else purposes.push(entry);
  await db.setSetting('payment_ext_purposes', JSON.stringify(purposes));
  return purposes;
}

async function removePurpose(keyword) {
  const purposes = (await getPurposes()).filter(p => p.match.toLowerCase() !== keyword.toLowerCase());
  await db.setSetting('payment_ext_purposes', JSON.stringify(purposes));
  return purposes;
}

function matchPurpose(purposes, purposeText) {
  const text = String(purposeText || '').toLowerCase();
  if (!text) return null;
  return purposes.find(p => text.includes(p.match.toLowerCase())) || null;
}

async function ensurePool() {
  const url = (await db.getSetting('payment_ext_db_url') || '').trim();
  if (!url) {
    if (pool) { try { await pool.end(); } catch {} pool = null; currentUrl = null; }
    return null;
  }
  if (url !== currentUrl) {
    if (pool) { try { await pool.end(); } catch {} }
    currentUrl = url;
    pool = _createPool(url);
    console.log('[PaymentExt] ✅ Connexion configurée vers la base de paiement externe');
  }
  return pool;
}

// ── Applique un paiement (motif → crédit) sur un compte Baccarat Pro donné ──
async function grantForRow(row, targetUser, purposes) {
  const seenKey = `ref:${row.reference}`;
  if (await db.isPaymentExtSeen(seenKey)) {
    return { ...row, status: 'already_processed' };
  }
  const rule = matchPurpose(purposes, row.purpose);
  if (!rule) {
    return { ...row, status: 'pending_admin_review', note: 'Motif non reconnu — configurez /setpurpose' };
  }
  if (rule.type === 'support') {
    await db.markPaymentExtSeen(seenKey);
    return { ...row, status: 'thanked', label: rule.label };
  }
  if (!targetUser) {
    return { ...row, status: 'no_target_account', note: 'Aucun compte Baccarat Pro correspondant trouvé' };
  }
  try {
    if (rule.type === 'duration') {
      const paymentRoute = require('./payment-route');
      await paymentRoute.doApprovePayment(
        { id: null, plan_label: rule.label, duration_minutes: rule.value },
        targetUser,
        { approvedBy: 'external_db', note: `Paiement externe réf=${row.reference} montant=${row.amount} motif=${row.purpose}` }
      );
    } else if (rule.type === 'strategy') {
      if (db.pool) {
        await db.pool.query(
          'INSERT INTO user_strategy_visible (user_id, strategy_id) VALUES ($1,$2) ON CONFLICT DO NOTHING',
          [targetUser.id, rule.value]
        );
      }
    }
    await db.markPaymentExtSeen(seenKey);
    console.log(`[PaymentExt] ✅ ${targetUser.username} crédité (${rule.label}) via paiement externe réf=${row.reference}`);
    try {
      if (targetUser.telegram_id) {
        const tg = require('./telegram-service');
        const token = tg.getMainToken();
        if (token) await tg.sendRawMessage(token, targetUser.telegram_id, `✅ Paiement confirmé : <b>${rule.label}</b> a été activé sur votre compte.`, 'HTML');
      }
    } catch {}
    return { ...row, status: 'granted_now', label: rule.label };
  } catch (e) {
    return { ...row, status: 'error', note: e.message };
  }
}

// ── Vérification interactive : identifiant + mot de passe saisis par l'utilisateur ──
// Compare DIRECTEMENT contre la base externe (ses propres colonnes username/password).
async function checkPaymentCredentials(identifiant, motDePasse) {
  const p = await ensurePool();
  if (!p) return { ok: false, reason: 'not_configured' };
  const cols = await getColumns();
  let rows;
  try {
    const sql = `SELECT ${cols.reference} AS reference, ${cols.amount} AS amount, ${cols.paidAt} AS paid_at, ${cols.purpose} AS purpose, ${cols.password} AS password
                 FROM ${cols.table} WHERE LOWER(${cols.username}) = LOWER($1) ORDER BY ${cols.paidAt} DESC LIMIT 50`;
    const r = await p.query(sql, [String(identifiant).trim()]);
    rows = r.rows;
  } catch (e) {
    console.warn('[PaymentExt] ⚠️ Lecture base externe échouée:', e.message);
    return { ok: false, reason: 'db_error', error: e.message };
  }
  if (rows.length === 0) return { ok: false, reason: 'not_found' };
  const matched = rows.some(r => String(r.password) === String(motDePasse));
  if (!matched) return { ok: false, reason: 'bad_password' };
  return { ok: true, rows: rows.map(({ password, ...rest }) => rest) };
}

// Applique le crédit pour chaque ligne trouvée, sur le compte Baccarat Pro `targetUser`.
async function creditRowsForUser(rows, targetUser) {
  const purposes = await getPurposes();
  const results = [];
  for (const row of rows) results.push(await grantForRow(row, targetUser, purposes));
  return results;
}

// ── Cycle automatique en arrière-plan : associe username externe → compte Baccarat Pro ──
async function pollAndCredit() {
  const p = await ensurePool();
  if (!p) return { checked: 0, granted: 0 };
  const cols = await getColumns();
  const purposes = await getPurposes();
  if (purposes.length === 0) return { checked: 0, granted: 0, note: 'Aucun motif configuré (/setpurpose)' };

  let rows;
  try {
    const sql = `SELECT ${cols.username} AS username, ${cols.reference} AS reference, ${cols.amount} AS amount, ${cols.paidAt} AS paid_at, ${cols.purpose} AS purpose
                 FROM ${cols.table} ORDER BY ${cols.paidAt} DESC LIMIT 200`;
    const r = await p.query(sql);
    rows = r.rows;
  } catch (e) {
    console.warn('[PaymentExt] ⚠️ Lecture base externe échouée:', e.message);
    return { checked: 0, granted: 0, error: e.message };
  }

  let granted = 0;
  for (const row of rows) {
    const seenKey = `ref:${row.reference}`;
    if (await db.isPaymentExtSeen(seenKey)) continue;
    const user = await db.getUserByUsername(String(row.username || '').trim());
    const result = await grantForRow(row, user, purposes);
    if (result.status === 'granted_now') granted++;
  }
  return { checked: rows.length, granted };
}

let _pollTimer = null;
function startPolling(intervalMs = 60000) {
  if (_pollTimer) return;
  _pollTimer = setInterval(() => {
    pollAndCredit().catch(e => console.warn('[PaymentExt] Erreur cycle:', e.message));
  }, intervalMs);
  console.log('[PaymentExt] ⏱ Vérification des paiements externes démarrée (toutes les 60s)');
}

module.exports = {
  getColumns, setColumns, getPurposes, setPurpose, removePurpose,
  checkPaymentCredentials, creditRowsForUser, pollAndCredit, startPolling,
};
