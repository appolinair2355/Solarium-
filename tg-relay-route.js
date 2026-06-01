/**
 * Routes API pour la gestion des relais Telegram
 * GET    /api/admin/tg-relay/configs         — liste des relais
 * POST   /api/admin/tg-relay/configs         — créer un relais
 * PUT    /api/admin/tg-relay/configs/:id     — modifier un relais
 * DELETE /api/admin/tg-relay/configs/:id     — supprimer un relais
 * POST   /api/admin/tg-relay/configs/:id/toggle — activer/désactiver
 */

const express   = require('express');
const router    = express.Router();
const relay     = require('./tg-relay');
const fetch     = require('node-fetch');

function requireAdmin(req, res, next) {
  if (!req.session?.userId || !req.session?.isAdmin)
    return res.status(403).json({ error: 'Admin requis' });
  next();
}

// ── Validation du token bot Telegram ─────────────────────────────────────────
async function _validateToken(token) {
  try {
    const r = await fetch(`https://api.telegram.org/bot${token}/getMe`, { timeout: 5000 });
    if (!r.ok) return null;
    const d = await r.json();
    if (!d.ok) return null;
    return d.result;
  } catch { return null; }
}

// ── Sanitize config avant envoi client (masque les tokens) ────────────────────
function _sanitize(cfg) {
  const maskToken = t => t ? `${t.slice(0, 6)}…${t.slice(-4)}` : null;
  return {
    id:                cfg.id,
    label:             cfg.label || '',
    src_channel_id:    cfg.src_channel_id,
    src_bot_preview:   maskToken(cfg.src_bot_token),
    dst_channel_id:    cfg.dst_channel_id,
    dst_bot_preview:   maskToken(cfg.dst_bot_token),
    enabled:           !!cfg.enabled,
    last_update_id:    cfg.last_update_id || 0,
    created_at:        cfg.created_at || null,
    active:            relay.getActiveIds().includes(cfg.id),
  };
}

// GET /configs
router.get('/configs', requireAdmin, async (req, res) => {
  try {
    const configs = await relay._loadConfigs();
    res.json({ configs: configs.map(_sanitize) });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// POST /configs — créer un relais
router.post('/configs', requireAdmin, async (req, res) => {
  const { label, src_bot_token, src_channel_id, dst_bot_token, dst_channel_id } = req.body;
  if (!src_bot_token || !src_channel_id || !dst_bot_token || !dst_channel_id)
    return res.status(400).json({ error: 'Champs requis : src_bot_token, src_channel_id, dst_bot_token, dst_channel_id' });

  // Valider les deux tokens
  const [srcBot, dstBot] = await Promise.all([
    _validateToken(src_bot_token.trim()),
    _validateToken(dst_bot_token.trim()),
  ]);
  if (!srcBot) return res.status(400).json({ error: 'Token source invalide — vérifiez que le bot existe' });
  if (!dstBot) return res.status(400).json({ error: 'Token destination invalide — vérifiez que le bot existe' });

  try {
    const configs = await relay._loadConfigs();
    const id      = `relay_${Date.now()}`;
    const newCfg  = {
      id,
      label:          (label || '').trim(),
      src_bot_token:  src_bot_token.trim(),
      src_channel_id: String(src_channel_id).trim(),
      dst_bot_token:  dst_bot_token.trim(),
      dst_channel_id: String(dst_channel_id).trim(),
      enabled:        false,
      last_update_id: 0,
      created_at:     new Date().toISOString(),
      src_bot_name:   srcBot.first_name || srcBot.username || '',
      dst_bot_name:   dstBot.first_name || dstBot.username || '',
    };
    configs.push(newCfg);
    await relay._saveConfigs(configs);
    res.json({ ok: true, config: _sanitize(newCfg) });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// PUT /configs/:id — modifier
router.put('/configs/:id', requireAdmin, async (req, res) => {
  const { id } = req.params;
  const { label, src_channel_id, dst_channel_id } = req.body;
  try {
    const configs = await relay._loadConfigs();
    const idx = configs.findIndex(c => c.id === id);
    if (idx < 0) return res.status(404).json({ error: 'Relais introuvable' });
    if (label !== undefined) configs[idx].label = String(label).trim();
    if (src_channel_id !== undefined) configs[idx].src_channel_id = String(src_channel_id).trim();
    if (dst_channel_id !== undefined) configs[idx].dst_channel_id = String(dst_channel_id).trim();
    await relay._saveConfigs(configs);
    await relay.reloadConfig(configs[idx]);
    res.json({ ok: true, config: _sanitize(configs[idx]) });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// DELETE /configs/:id
router.delete('/configs/:id', requireAdmin, async (req, res) => {
  const { id } = req.params;
  try {
    const configs = await relay._loadConfigs();
    const idx = configs.findIndex(c => c.id === id);
    if (idx < 0) return res.status(404).json({ error: 'Relais introuvable' });
    configs.splice(idx, 1);
    await relay._saveConfigs(configs);
    relay.stopById(id);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// POST /configs/:id/toggle — activer ou désactiver
router.post('/configs/:id/toggle', requireAdmin, async (req, res) => {
  const { id } = req.params;
  const { enabled } = req.body;
  try {
    const configs = await relay._loadConfigs();
    const idx = configs.findIndex(c => c.id === id);
    if (idx < 0) return res.status(404).json({ error: 'Relais introuvable' });
    configs[idx].enabled = !!enabled;
    await relay._saveConfigs(configs);
    await relay.reloadConfig(configs[idx]);
    res.json({ ok: true, enabled: configs[idx].enabled });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

module.exports = router;
