'use strict';
const express = require('express');
const router  = express.Router();
const db      = require('./db');
const { pool } = require('./db');

const WHATSAPP_LINK = 'https://wa.me/2290195501564';

function requireAuth(req, res, next) {
  if (!req.session?.userId) return res.status(401).json({ error: 'Non connecté' });
  next();
}
function requireAdmin(req, res, next) {
  if (!req.session?.isAdmin) return res.status(403).json({ error: 'Admin requis' });
  next();
}

// ── Catalogue pour tous les utilisateurs ────────────────────────────────────
router.get('/catalog', requireAuth, async (req, res) => {
  try {
    const r = await pool.query(
      `SELECT id, name, description, is_paid, price_usd, sort_order, created_at, updated_at,
              ROW_NUMBER() OVER (ORDER BY sort_order ASC, created_at ASC) AS level_number
       FROM strategy_ideas WHERE enabled = TRUE ORDER BY sort_order ASC, created_at ASC`
    );
    res.json(r.rows);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── Vue d'une idée (gratuite ou achetée) ────────────────────────────────────
router.get('/:id/view', requireAuth, async (req, res) => {
  try {
    const ideaId = parseInt(req.params.id);
    const ideaRes = await pool.query('SELECT * FROM strategy_ideas WHERE id=$1 AND enabled=TRUE', [ideaId]);
    const idea = ideaRes.rows[0];
    if (!idea) return res.status(404).json({ error: 'Idée introuvable' });
    if (!idea.is_paid) return res.json({ ok: true, idea });
    if (req.session.isAdmin) return res.json({ ok: true, idea });
    const purchRes = await pool.query(
      `SELECT status FROM strategy_idea_purchases WHERE user_id=$1 AND idea_id=$2 AND status='validated' LIMIT 1`,
      [req.session.userId, ideaId]
    );
    if (purchRes.rows.length === 0) return res.status(403).json({ error: 'Achat requis' });
    res.json({ ok: true, idea });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── Initier un achat d'idée payante ─────────────────────────────────────────
router.post('/:id/purchase', requireAuth, async (req, res) => {
  try {
    const ideaId = parseInt(req.params.id);
    const ideaRes = await pool.query('SELECT * FROM strategy_ideas WHERE id=$1 AND enabled=TRUE', [ideaId]);
    const idea = ideaRes.rows[0];
    if (!idea) return res.status(404).json({ error: 'Idée introuvable' });
    if (!idea.is_paid) return res.status(400).json({ error: 'Cette idée est gratuite — accès direct' });

    const user = await db.getUser(req.session.userId);
    if (!user) return res.status(401).json({ error: 'Session invalide' });

    const existing = await pool.query(
      `SELECT id, status FROM strategy_idea_purchases WHERE user_id=$1 AND idea_id=$2 AND status NOT IN ('rejected') LIMIT 1`,
      [user.id, ideaId]
    );
    if (existing.rows.length > 0) {
      return res.json({ ok: true, already_exists: true, purchase: existing.rows[0] });
    }

    const r = await pool.query(
      `INSERT INTO strategy_idea_purchases (user_id, idea_id, idea_name, amount_usd, status)
       VALUES ($1,$2,$3,$4,'awaiting_screenshot') RETURNING *`,
      [user.id, ideaId, idea.name, idea.price_usd]
    );
    const purchase = r.rows[0];

    const msg = `Je veux acheter le Niveau de stratégie : ${idea.name}\nMontant : ${idea.price_usd} $\nCompte : ${user.username}\nRéférence : #IP${purchase.id}`;
    const whatsappLink = `${WHATSAPP_LINK}?text=${encodeURIComponent(msg)}`;

    res.json({ ok: true, purchase: { id: purchase.id, status: purchase.status }, whatsapp_link: whatsappLink, amount_usd: idea.price_usd });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── Upload capture d'écran pour achat idée ──────────────────────────────────
router.post('/purchase/:id/screenshot', requireAuth, async (req, res) => {
  try {
    const purchaseId = parseInt(req.params.id);
    const { screenshot } = req.body;
    if (!screenshot) return res.status(400).json({ error: 'screenshot manquant' });
    const r = await pool.query(
      'SELECT * FROM strategy_idea_purchases WHERE id=$1 AND user_id=$2', [purchaseId, req.session.userId]
    );
    if (!r.rows[0]) return res.status(404).json({ error: 'Achat introuvable' });
    if (r.rows[0].status === 'validated') return res.status(400).json({ error: 'Déjà validé' });
    await pool.query(
      `UPDATE strategy_idea_purchases SET screenshot_data=$1, status='pending_admin', updated_at=NOW() WHERE id=$2`,
      [screenshot, purchaseId]
    );
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── Mes achats d'idées ───────────────────────────────────────────────────────
router.get('/my-purchases', requireAuth, async (req, res) => {
  try {
    const r = await pool.query(
      `SELECT p.*, i.description FROM strategy_idea_purchases p
       LEFT JOIN strategy_ideas i ON i.id = p.idea_id
       WHERE p.user_id=$1 ORDER BY p.created_at DESC`,
      [req.session.userId]
    );
    res.json(r.rows);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ════════════════ ADMIN ════════════════════════════════════════════════════

// ── Créer une idée ──────────────────────────────────────────────────────────
router.post('/', requireAdmin, async (req, res) => {
  try {
    const { name, description, is_paid, price_usd } = req.body;
    if (!name?.trim() || !description?.trim()) return res.status(400).json({ error: 'Nom et description requis' });
    const paid = !!is_paid;
    const price = paid ? (parseFloat(price_usd) || 0) : 0;
    // Sort order = next available (max + 1)
    const maxRes = await pool.query('SELECT COALESCE(MAX(sort_order), 0) as max_order FROM strategy_ideas');
    const nextOrder = (parseInt(maxRes.rows[0].max_order) || 0) + 1;
    const r = await pool.query(
      `INSERT INTO strategy_ideas (name, description, is_paid, price_usd, sort_order) VALUES ($1,$2,$3,$4,$5) RETURNING *`,
      [name.trim(), description.trim(), paid, price, nextOrder]
    );
    res.json({ ok: true, idea: r.rows[0] });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── Modifier une idée ────────────────────────────────────────────────────────
router.put('/:id', requireAdmin, async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    const { name, description, is_paid, price_usd, enabled, sort_order } = req.body;
    const paid = !!is_paid;
    const price = paid ? (parseFloat(price_usd) || 0) : 0;
    let r;
    if (sort_order !== undefined && sort_order !== null) {
      r = await pool.query(
        `UPDATE strategy_ideas SET name=$1, description=$2, is_paid=$3, price_usd=$4, enabled=$5, sort_order=$6, updated_at=NOW() WHERE id=$7 RETURNING *`,
        [name?.trim(), description?.trim(), paid, price, enabled !== false, parseInt(sort_order), id]
      );
    } else {
      r = await pool.query(
        `UPDATE strategy_ideas SET name=$1, description=$2, is_paid=$3, price_usd=$4, enabled=$5, updated_at=NOW() WHERE id=$6 RETURNING *`,
        [name?.trim(), description?.trim(), paid, price, enabled !== false, id]
      );
    }
    if (!r.rows[0]) return res.status(404).json({ error: 'Introuvable' });
    res.json({ ok: true, idea: r.rows[0] });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── Réordonner les idées (déplace une idée vers le haut ou le bas) ───────────
router.post('/admin/reorder', requireAdmin, async (req, res) => {
  try {
    const { id, direction } = req.body;
    if (!id || !['up', 'down'].includes(direction)) return res.status(400).json({ error: 'Paramètres invalides' });
    const all = await pool.query('SELECT id, sort_order FROM strategy_ideas ORDER BY sort_order ASC, created_at ASC');
    const rows = all.rows;
    const idx = rows.findIndex(r => r.id === parseInt(id));
    if (idx === -1) return res.status(404).json({ error: 'Idée introuvable' });
    const swapIdx = direction === 'up' ? idx - 1 : idx + 1;
    if (swapIdx < 0 || swapIdx >= rows.length) return res.json({ ok: true, no_change: true });
    const a = rows[idx];
    const b = rows[swapIdx];
    const aOrder = a.sort_order || idx + 1;
    const bOrder = b.sort_order || swapIdx + 1;
    await pool.query('UPDATE strategy_ideas SET sort_order=$1 WHERE id=$2', [bOrder, a.id]);
    await pool.query('UPDATE strategy_ideas SET sort_order=$1 WHERE id=$2', [aOrder, b.id]);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── Supprimer une idée ───────────────────────────────────────────────────────
router.delete('/:id', requireAdmin, async (req, res) => {
  try {
    await pool.query('DELETE FROM strategy_ideas WHERE id=$1', [parseInt(req.params.id)]);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── Admin : liste tous les achats d'idées ────────────────────────────────────
router.get('/admin/purchases', requireAdmin, async (req, res) => {
  try {
    const r = await pool.query(
      `SELECT p.*, u.username, u.email, i.name as idea_name_current
       FROM strategy_idea_purchases p
       JOIN users u ON u.id = p.user_id
       LEFT JOIN strategy_ideas i ON i.id = p.idea_id
       ORDER BY p.created_at DESC`
    );
    res.json(r.rows);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── Admin : valider un achat d'idée ──────────────────────────────────────────
router.post('/admin/purchase/:id/approve', requireAdmin, async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    await pool.query(
      `UPDATE strategy_idea_purchases SET status='validated', admin_validated_by=$1, admin_validated_at=NOW(), updated_at=NOW() WHERE id=$2`,
      [req.session.userId, id]
    );
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── Admin : rejeter un achat d'idée ──────────────────────────────────────────
router.post('/admin/purchase/:id/reject', requireAdmin, async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    const { note } = req.body;
    await pool.query(
      `UPDATE strategy_idea_purchases SET status='rejected', admin_note=$1, admin_validated_by=$2, admin_validated_at=NOW(), updated_at=NOW() WHERE id=$3`,
      [note || '', req.session.userId, id]
    );
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

module.exports = router;
