'use strict';
/**
 * shop.js — Vitrine / Vente de stratégies standalone
 *
 * Flux :
 *   1. Catalogue visible par tous les utilisateurs connectés (GET /api/shop/catalog)
 *   2. Achat → lien WhatsApp pré-rempli (POST /api/shop/purchase)
 *   3. Upload capture d'écran (POST /api/shop/purchase/:id/screenshot)
 *   4. Admin valide → ZIP généré (voir admin.js)
 *   5. Téléchargement du ZIP (GET /api/shop/purchase/:id/download)
 */

const express = require('express');
const router  = express.Router();
const db      = require('./db');

const STRATEGY_PRICE_USD = 75;
const WHATSAPP_NUMBER    = '+2290195501564';
const WHATSAPP_LINK      = 'https://wa.me/2290195501564';

function requireAuth(req, res, next) {
  if (!req.session?.userId) return res.status(401).json({ error: 'Non connecté' });
  next();
}

// ── Catalogue public (authentification requise) ─────────────────────────────
// Retourne la liste des stratégies ayant une fiche de vente activée
router.get('/catalog', requireAuth, async (req, res) => {
  try {
    const raw     = await db.getSetting('strategy_promo_config').catch(() => null);
    const promos  = raw ? JSON.parse(raw) : {};

    const rawStrats = await db.getSetting('custom_strategies').catch(() => null);
    const strats    = rawStrats ? JSON.parse(rawStrats) : [];

    const catalog = strats
      .filter(s => promos[String(s.id)]?.enabled)
      .map(s => ({
        id:          String(s.id),
        name:        s.name,
        mode:        s.mode,
        promo:       promos[String(s.id)],
        price_usd:   STRATEGY_PRICE_USD,
      }));

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
      [user.id, String(strategy_id), strat.name, STRATEGY_PRICE_USD]
    );
    const purchase = r.rows[0];

    const msg =
`Je veux payer la stratégie ${strat.name} (S${strategy_id}).
Montant : ${STRATEGY_PRICE_USD} $
Identifiant compte : ${user.username}
Référence achat : #${purchase.id}

Je suis d'accord pour le prix.`;

    const whatsappLink = `${WHATSAPP_LINK}?text=${encodeURIComponent(msg)}`;

    res.json({
      ok: true,
      purchase: { id: purchase.id, status: purchase.status },
      strategy: { id: strategy_id, name: strat.name },
      amount_usd: STRATEGY_PRICE_USD,
      whatsapp_link: whatsappLink,
      whatsapp_number: WHATSAPP_NUMBER,
    });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── Upload capture d'écran de paiement (étape 2) ────────────────────────────
router.post('/purchase/:id/screenshot', requireAuth, async (req, res) => {
  const purchaseId = parseInt(req.params.id);
  const { screenshot } = req.body; // base64 data URL
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
              (zip_data IS NOT NULL) AS has_zip
       FROM strategy_purchases
       WHERE user_id=$1
       ORDER BY created_at DESC`,
      [req.session.userId]
    );
    res.json(r.rows);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── Télécharger le ZIP (si validé) ──────────────────────────────────────────
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

    const buf = Buffer.from(purchase.zip_data, 'base64');
    const filename = `baccarat-bot-S${purchase.strategy_id}-${purchase.strategy_name.replace(/\s+/g, '_')}.zip`;
    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send(buf);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

module.exports = router;
