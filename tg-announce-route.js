'use strict';
const express  = require('express');
const router   = express.Router();
const { pool } = require('./db');
const db       = require('./db');
const { sendAnnouncementNow } = require('./tg-announce-scheduler');

function requireAdmin(req, res, next) {
  if (!req.session?.isAdmin) return res.status(403).json({ error: 'Admin requis' });
  next();
}

function requireAdminOrPartner(req, res, next) {
  if (!req.session?.userId) return res.status(401).json({ error: 'Non connecté' });
  if (!req.session?.isAdmin && req.session?.accountType !== 'partenaire')
    return res.status(403).json({ error: 'Accès admin ou partenaire requis' });
  next();
}

function parseFixedHours(val) {
  if (Array.isArray(val)) return val.map(Number);
  if (typeof val === 'string') { try { return JSON.parse(val).map(Number); } catch { return []; } }
  return [];
}

function sanitizeRow(row) {
  return {
    ...row,
    media_data:  null,                              // ne jamais exposer le binaire dans la liste
    fixed_hours: parseFixedHours(row.fixed_hours),
  };
}

// ── GET /api/tg-announce ─────────────────────────────────────────────────────
router.get('/', requireAdminOrPartner, async (req, res) => {
  try {
    const r = await pool.query('SELECT * FROM tg_announcements ORDER BY created_at DESC');
    res.json(r.rows.map(sanitizeRow));
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── GET /api/tg-announce/channels-hint ───────────────────────────────────────
// Retourne les paires (channel_id, bot_token, label) déjà configurées ailleurs,
// pour remplissage automatique dans le formulaire.
router.get('/channels-hint', requireAdminOrPartner, async (req, res) => {
  try {
    const hints = [];
    const seen  = new Set();

    const add = (channel_id, bot_token, label) => {
      const ch = String(channel_id || '').trim();
      const tk = String(bot_token  || '').trim();
      const key = `${ch}|${tk}`;
      if (ch && tk && !seen.has(key)) {
        seen.add(key);
        hints.push({ channel_id: ch, bot_token: tk, label: label || ch });
      }
    };

    // 1. Nouveau système (table tg_announcements)
    try {
      const r = await pool.query('SELECT name, channel_id, bot_token FROM tg_announcements ORDER BY name');
      r.rows.forEach(row => add(row.channel_id, row.bot_token, `📢 ${row.name}`));
    } catch {}

    // 2. Ancien système (settings JSON)
    try {
      const raw = await db.getSetting('tg_announcements');
      if (raw) {
        const old = JSON.parse(raw);
        if (Array.isArray(old)) old.forEach(a => add(a.channel_id, a.bot_token, `🕐 ${a.name}`));
      }
    } catch {}

    // 3. Canaux globaux (telegram_config + bot_token global)
    try {
      const botToken = await db.getSetting('bot_token');
      if (botToken) {
        const r = await pool.query('SELECT channel_id, channel_name FROM telegram_config WHERE enabled = TRUE');
        r.rows.forEach(row => add(row.channel_id, botToken, `📡 ${row.channel_name || row.channel_id}`));
      }
    } catch {}

    res.json(hints);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── POST /api/tg-announce ────────────────────────────────────────────────────
router.post('/', requireAdminOrPartner, async (req, res) => {
  try {
    const {
      name, channel_id, bot_token, message_text,
      media_type, media_data, media_filename,
      schedule_type, interval_hours, fixed_hours, enabled,
    } = req.body;

    if (!name?.trim())         return res.status(400).json({ error: 'Nom requis' });
    if (!channel_id?.trim())   return res.status(400).json({ error: 'ID canal requis' });
    if (!bot_token?.trim())    return res.status(400).json({ error: 'Token bot requis' });
    if (!message_text?.trim()) return res.status(400).json({ error: 'Message requis' });
    if (schedule_type === 'interval' && (!(parseInt(interval_hours) >= 1)))
      return res.status(400).json({ error: 'Intervalle invalide (min 1h)' });
    if (schedule_type === 'fixed' && (!Array.isArray(fixed_hours) || fixed_hours.length === 0))
      return res.status(400).json({ error: 'Sélectionnez au moins une heure fixe' });

    if (media_data && media_type === 'video') {
      const buf = Buffer.from(media_data, 'base64');
      if (buf.length > 50 * 1024 * 1024) return res.status(400).json({ error: 'Vidéo trop lourde (max 50 Mo)' });
    }

    const r = await pool.query(
      `INSERT INTO tg_announcements
         (name, channel_id, bot_token, message_text, media_type, media_data, media_filename,
          schedule_type, interval_hours, fixed_hours, enabled)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING *`,
      [
        name.trim(), channel_id.trim(), bot_token.trim(), message_text.trim(),
        media_type || null, media_data || null, media_filename || null,
        schedule_type || 'interval',
        parseInt(interval_hours) || 1,
        JSON.stringify(parseFixedHours(fixed_hours)),
        enabled !== false,
      ]
    );
    res.json({ ok: true, announce: sanitizeRow(r.rows[0]) });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── PUT /api/tg-announce/:id ─────────────────────────────────────────────────
router.put('/:id', requireAdminOrPartner, async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    if (isNaN(id)) return res.status(400).json({ error: 'ID invalide' });

    const {
      name, channel_id, bot_token, message_text,
      media_type, media_data, media_filename, media_cleared,
      schedule_type, interval_hours, fixed_hours, enabled,
    } = req.body;

    if (media_data && media_type === 'video') {
      const buf = Buffer.from(media_data, 'base64');
      if (buf.length > 50 * 1024 * 1024) return res.status(400).json({ error: 'Vidéo trop lourde (max 50 Mo)' });
    }

    const cols = [];
    const vals = [];
    let   idx  = 1;
    const set  = (col, val) => { cols.push(`${col}=$${idx++}`); vals.push(val); };

    if (name         !== undefined) set('name',          name.trim());
    if (channel_id   !== undefined) set('channel_id',    channel_id.trim());
    if (bot_token    !== undefined) set('bot_token',     bot_token.trim());
    if (message_text !== undefined) set('message_text',  message_text.trim());
    if (schedule_type !== undefined) set('schedule_type', schedule_type);
    if (interval_hours !== undefined) set('interval_hours', parseInt(interval_hours) || 1);
    if (fixed_hours  !== undefined) set('fixed_hours',   JSON.stringify(parseFixedHours(fixed_hours)));
    if (enabled      !== undefined) set('enabled',       !!enabled);

    // Media : seulement si l'utilisateur a touché le fichier
    if (media_data) {
      // Nouveau fichier sélectionné
      set('media_type',     media_type || null);
      set('media_data',     media_data);
      set('media_filename', media_filename || null);
    } else if (media_cleared) {
      // Utilisateur a cliqué ✕ pour supprimer le média
      set('media_type',     null);
      set('media_data',     null);
      set('media_filename', null);
    }
    // Sinon : aucun champ media → la DB conserve l'existant

    if (cols.length === 0) return res.status(400).json({ error: 'Aucun champ à mettre à jour' });

    set('updated_at', new Date());
    vals.push(id);

    const r = await pool.query(
      `UPDATE tg_announcements SET ${cols.join(', ')} WHERE id=$${idx} RETURNING *`,
      vals
    );
    if (!r.rows[0]) return res.status(404).json({ error: 'Annonce introuvable' });
    res.json({ ok: true, announce: sanitizeRow(r.rows[0]) });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── DELETE /api/tg-announce/:id ──────────────────────────────────────────────
router.delete('/:id', requireAdminOrPartner, async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    if (isNaN(id)) return res.status(400).json({ error: 'ID invalide' });
    const r = await pool.query('DELETE FROM tg_announcements WHERE id=$1 RETURNING id', [id]);
    if (!r.rows[0]) return res.status(404).json({ error: 'Introuvable' });
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── POST /api/tg-announce/:id/send-now ──────────────────────────────────────
router.post('/:id/send-now', requireAdminOrPartner, async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    if (isNaN(id)) return res.status(400).json({ error: 'ID invalide' });
    const r = await pool.query('SELECT * FROM tg_announcements WHERE id=$1', [id]);
    if (!r.rows[0]) return res.status(404).json({ error: 'Annonce introuvable' });
    await sendAnnouncementNow(r.rows[0]);
    await pool.query('UPDATE tg_announcements SET last_sent_at=NOW() WHERE id=$1', [id]);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

module.exports = router;
