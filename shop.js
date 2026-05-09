'use strict';
/**
 * shop.js — Vitrine / Vente de stratégies standalone
 *
 * Flux :
 *   1. Catalogue visible par tous les utilisateurs connectés (GET /api/shop/catalog)
 *   2. Achat → lien WhatsApp pré-rempli (POST /api/shop/purchase)
 *   3. Upload capture d'écran (POST /api/shop/purchase/:id/screenshot)
 *   4. Admin valide → ZIP généré (voir admin.js)
 *   5. Configuration bot + Téléchargement du ZIP (POST /api/shop/purchase/:id/download-configured)
 */

const express                 = require('express');
const crypto                  = require('crypto');
const db                      = require('./db');
const { USE_PG }              = require('./db');
const { generateStrategyZip } = require('./zip-generator');
const router                  = express.Router();

const WHATSAPP_NUMBER = '+2290195501564';
const WHATSAPP_LINK   = 'https://wa.me/2290195501564';

function requireAuth(req, res, next) {
  if (!req.session?.userId) return res.status(401).json({ error: 'Non connecté' });
  next();
}

// ── Générateur de nom marketing (déterministe par ID stratégie) ──────────────
const MKTG_PREFIXES = ['Protocole', 'Système', 'Méthode', 'Formule', 'Module', 'Signal'];
const MKTG_GEMS     = ['Platine', 'Émeraude', 'Saphir', 'Rubis', 'Diamant', 'Cristal', 'Cobalt', 'Ambre', 'Jade', 'Opale', 'Topaze', 'Onyx'];
const MKTG_SUFFIXES = ['Pro', 'Élite', 'Expert', 'Premium', 'Prestige', 'Master', 'Ultra', 'VIP'];

function generateMarketingName(strategyId) {
  const id = parseInt(strategyId) || 0;
  return `${MKTG_PREFIXES[id % MKTG_PREFIXES.length]} ${MKTG_GEMS[(id * 3) % MKTG_GEMS.length]} ${MKTG_SUFFIXES[(id * 7) % MKTG_SUFFIXES.length]}`;
}

// Prix depuis la fiche promo (fallback à 75 si non défini)
function getStrategyPrice(promo) {
  const p = parseFloat(promo?.price_usd);
  return Number.isFinite(p) && p > 0 ? p : 75;
}

// ── Catalogue public (authentification requise) ─────────────────────────────
router.get('/catalog', requireAuth, async (req, res) => {
  try {
    const raw     = await db.getSetting('strategy_promo_config').catch(() => null);
    const promos  = raw ? JSON.parse(raw) : {};

    const rawStrats = await db.getSetting('custom_strategies').catch(() => null);
    const strats    = rawStrats ? JSON.parse(rawStrats) : [];

    const rawShopDesc = await db.getSetting('strategy_shop_desc').catch(() => null);
    const shopDescs   = rawShopDesc ? JSON.parse(rawShopDesc) : {};

    // ── Auto-retrait boutique : 2 pertes consécutives ─────────────────
    if (USE_PG) {
      const enabledIds = strats.filter(s => promos[String(s.id)]?.enabled).map(s => String(s.id));
      let promoModified = false;
      for (const sid of enabledIds) {
        try {
          const { rows } = await db.pool.query(
            `SELECT status FROM predictions WHERE strategy = $1 AND status IN ('gagne','perdu') ORDER BY created_at DESC LIMIT 2`,
            [`S${sid}`]
          );
          if (rows.length >= 2 && rows.every(r => r.status === 'perdu')) {
            promos[sid].enabled = false;
            promoModified = true;
            console.log(`[Shop] Auto-retrait: stratégie ${sid} retirée (2 pertes consécutives)`);
          }
        } catch {}
      }
      if (promoModified) {
        await db.setSetting('strategy_promo_config', JSON.stringify(promos)).catch(() => {});
      }
    }

    const catalog = strats
      .filter(s => promos[String(s.id)]?.enabled)
      .map(s => {
        const sid  = String(s.id);
        const desc = shopDescs[sid];
        let shopDesc = '';
        if (desc && desc.total > 0) {
          let updatedLabel = '';
          if (desc.updatedAt) {
            const d = new Date(desc.updatedAt);
            const datePart = d.toLocaleDateString('fr-FR', { day: '2-digit', month: 'long', year: 'numeric' });
            const timePart = d.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
            updatedLabel = `le ${datePart} à ${timePart}`;
          }
          const lossRate = 100 - desc.winRate;
          const perf = desc.winRate >= 70 ? 'excellente' : desc.winRate >= 60 ? 'très bonne' : desc.winRate >= 50 ? 'bonne' : 'en progression';
          shopDesc = [
            `📊 Au ${updatedLabel || 'dernier bilan'} : taux de réussite de ${desc.winRate}% sur ${desc.total} prédictions vérifiées — ${desc.wins} victoires / ${desc.losses} pertes (${lossRate}% perdus).`,
            `💰 Performance ${perf} — cette stratégie est rentable et ses résultats sont mis à jour chaque nuit automatiquement.`,
            `📲 Comment payer : cliquez sur "Acheter maintenant", vous serez redirigé sur WhatsApp (+229 01 95 50 15 64). Envoyez le message pré-rempli + votre capture de paiement. Votre bot sera débloqué après validation.`,
          ].join('\n');
        }
        return {
          id:        sid,
          name:      s.name,
          shop_name: generateMarketingName(s.id),
          shop_desc: shopDesc,
          mode:      s.mode,
          promo:     promos[sid],
          price_usd: getStrategyPrice(promos[sid]),
        };
      });

    res.json({ catalog, whatsapp: { number: WHATSAPP_NUMBER, link: WHATSAPP_LINK } });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── Créer une demande d'achat (étape 1) ─────────────────────────────────────
router.post('/purchase', requireAuth, async (req, res) => {
  const { strategy_id } = req.body;
  if (!strategy_id) return res.status(400).json({ error: 'strategy_id manquant' });

  try {
    const rawPromos = await db.getSetting('strategy_promo_config').catch(() => null);
    const promos    = rawPromos ? JSON.parse(rawPromos) : {};
    const promo     = promos[String(strategy_id)];
    if (!promo?.enabled) return res.status(404).json({ error: 'Cette stratégie n\'est pas en vente' });

    const rawStrats = await db.getSetting('custom_strategies').catch(() => null);
    const strats    = rawStrats ? JSON.parse(rawStrats) : [];
    const strat     = strats.find(s => String(s.id) === String(strategy_id));
    if (!strat) return res.status(404).json({ error: 'Stratégie introuvable' });

    const user = await db.getUser(req.session.userId);
    if (!user) return res.status(401).json({ error: 'Session invalide' });

    const price = getStrategyPrice(promo);
    const mktgName = generateMarketingName(strategy_id);

    // Vérifier si une demande est déjà en cours pour cette stratégie
    const existing = await db.pool.query(
      `SELECT id, status FROM strategy_purchases
       WHERE user_id=$1 AND strategy_id=$2 AND status NOT IN ('rejected')
       ORDER BY created_at DESC LIMIT 1`,
      [user.id, String(strategy_id)]
    );
    if (existing.rows.length > 0 && existing.rows[0].status !== 'rejected') {
      return res.json({
        ok: true,
        already_exists: true,
        purchase: existing.rows[0],
        message: 'Une demande est déjà en cours pour cette stratégie.',
      });
    }

    const r = await db.pool.query(
      `INSERT INTO strategy_purchases (user_id, strategy_id, strategy_name, amount_usd, status)
       VALUES ($1,$2,$3,$4,'awaiting_screenshot') RETURNING *`,
      [user.id, String(strategy_id), mktgName, price]
    );
    const purchase = r.rows[0];

    const msg =
`Je veux acheter la stratégie ${mktgName} (S${strategy_id}).
Montant : ${price} €
Identifiant compte : ${user.username}
Référence achat : #${purchase.id}

Je suis d'accord pour le prix.`;

    const whatsappLink = `${WHATSAPP_LINK}?text=${encodeURIComponent(msg)}`;

    res.json({
      ok: true,
      purchase: { id: purchase.id, status: purchase.status },
      strategy: { id: strategy_id, name: mktgName },
      amount_usd: price,
      whatsapp_link: whatsappLink,
      whatsapp_number: WHATSAPP_NUMBER,
    });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── Upload capture d'écran de paiement (étape 2) ────────────────────────────
router.post('/purchase/:id/screenshot', requireAuth, async (req, res) => {
  const purchaseId = parseInt(req.params.id);
  const { screenshot } = req.body;
  if (!screenshot) return res.status(400).json({ error: 'screenshot manquant' });

  try {
    const r = await db.pool.query(
      'SELECT * FROM strategy_purchases WHERE id=$1 AND user_id=$2',
      [purchaseId, req.session.userId]
    );
    const purchase = r.rows[0];
    if (!purchase) return res.status(404).json({ error: 'Achat introuvable' });
    if (purchase.status === 'validated') return res.status(400).json({ error: 'Déjà validé' });

    await db.pool.query(
      `UPDATE strategy_purchases SET screenshot_data=$1, status='pending_admin', updated_at=NOW() WHERE id=$2`,
      [screenshot, purchaseId]
    );

    res.json({ ok: true, message: 'Capture envoyée — en attente de validation admin.' });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── Mes achats (historique utilisateur) ─────────────────────────────────────
router.get('/my-purchases', requireAuth, async (req, res) => {
  try {
    const r = await db.pool.query(
      `SELECT id, strategy_id, strategy_name, amount_usd, status, admin_note,
              admin_validated_at, created_at,
              (zip_data IS NOT NULL) AS has_zip,
              bot_config
       FROM strategy_purchases
       WHERE user_id=$1
       ORDER BY created_at DESC`,
      [req.session.userId]
    );
    res.json(r.rows.map(row => {
      let botConfig = null;
      try { botConfig = row.bot_config ? JSON.parse(row.bot_config) : null; } catch {}
      return { ...row, bot_config: botConfig };
    }));
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── Téléchargement configuré (avec canal + token + format pré-remplis) ───────
// POST /api/shop/purchase/:id/download-configured
// Body: { channel_id, bot_token, format_id }
router.post('/purchase/:id/download-configured', requireAuth, async (req, res) => {
  const purchaseId = parseInt(req.params.id);
  const { channel_id, bot_token, format_id } = req.body;

  if (!channel_id?.trim()) return res.status(400).json({ error: 'ID du canal requis' });
  if (!bot_token?.trim())  return res.status(400).json({ error: 'Token API du bot requis' });

  try {
    const r = await db.pool.query(
      'SELECT * FROM strategy_purchases WHERE id=$1 AND user_id=$2',
      [purchaseId, req.session.userId]
    );
    const purchase = r.rows[0];
    if (!purchase) return res.status(404).json({ error: 'Achat introuvable' });
    if (purchase.status !== 'validated') return res.status(403).json({ error: 'Achat non encore validé' });
    if (!purchase.zip_data) return res.status(404).json({ error: 'Fichier de base non disponible — contactez l\'admin' });

    // Récupérer la stratégie
    const rawStrats = await db.getSetting('custom_strategies').catch(() => null);
    const strats    = rawStrats ? JSON.parse(rawStrats) : [];
    const strat     = strats.find(s => String(s.id) === String(purchase.strategy_id));
    if (!strat) return res.status(404).json({ error: 'Stratégie introuvable' });

    // Récupérer la clé de licence
    const licRes = await db.pool.query(
      'SELECT license_key FROM strategy_licenses WHERE purchase_id=$1 LIMIT 1',
      [purchaseId]
    ).catch(() => ({ rows: [] }));
    const licenseKey = licRes.rows[0]?.license_key || '';

    const serverUrl = process.env.APP_URL || (req.protocol + '://' + req.get('host'));

    const botConfig = {
      channel_id: channel_id.trim(),
      bot_token:  bot_token.trim(),
      format_id:  parseInt(format_id) || 1,
    };

    // Sauvegarder la config en base (pour ré-téléchargement futur)
    await db.pool.query(
      'UPDATE strategy_purchases SET bot_config=$1, updated_at=NOW() WHERE id=$2',
      [JSON.stringify(botConfig), purchaseId]
    ).catch(() => {});

    // Générer le ZIP avec la config pré-remplie
    const zipBuf = await generateStrategyZip(strat, licenseKey, serverUrl, botConfig);

    const filename = `baccarat-bot-S${purchase.strategy_id}-${purchase.strategy_name.replace(/\s+/g, '_')}.zip`;
    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send(zipBuf);
  } catch (e) {
    console.error('[download-configured]', e);
    res.status(500).json({ error: e.message });
  }
});

// ── Télécharger le ZIP brut (si déjà configuré, régénère avec config sauvegardée) ─
router.get('/purchase/:id/download', requireAuth, async (req, res) => {
  try {
    const r = await db.pool.query(
      'SELECT * FROM strategy_purchases WHERE id=$1 AND user_id=$2',
      [parseInt(req.params.id), req.session.userId]
    );
    const purchase = r.rows[0];
    if (!purchase) return res.status(404).json({ error: 'Achat introuvable' });
    if (purchase.status !== 'validated') return res.status(403).json({ error: 'Achat non encore validé' });
    if (!purchase.zip_data) return res.status(404).json({ error: 'Fichier non disponible' });

    // Si une config bot est sauvegardée, régénérer avec cette config
    let botConfig = null;
    try { botConfig = purchase.bot_config ? JSON.parse(purchase.bot_config) : null; } catch {}

    if (botConfig?.channel_id && botConfig?.bot_token) {
      const rawStrats = await db.getSetting('custom_strategies').catch(() => null);
      const strats    = rawStrats ? JSON.parse(rawStrats) : [];
      const strat     = strats.find(s => String(s.id) === String(purchase.strategy_id));
      if (strat) {
        const licRes = await db.pool.query(
          'SELECT license_key FROM strategy_licenses WHERE purchase_id=$1 LIMIT 1', [purchase.id]
        ).catch(() => ({ rows: [] }));
        const licenseKey = licRes.rows[0]?.license_key || '';
        const serverUrl  = process.env.APP_URL || (req.protocol + '://' + req.get('host'));
        const zipBuf = await generateStrategyZip(strat, licenseKey, serverUrl, botConfig);
        const filename = `baccarat-bot-S${purchase.strategy_id}-${purchase.strategy_name.replace(/\s+/g, '_')}.zip`;
        res.setHeader('Content-Type', 'application/zip');
        res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
        return res.send(zipBuf);
      }
    }

    // Fallback : ZIP de base
    const buf = Buffer.from(purchase.zip_data, 'base64');
    const filename = `baccarat-bot-S${purchase.strategy_id}-${purchase.strategy_name.replace(/\s+/g, '_')}.zip`;
    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send(buf);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

module.exports = router;
