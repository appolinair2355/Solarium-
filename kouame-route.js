// ── Route API Kouamé (admin only) ────────────────────────────────────────────
const express    = require('express');
const router     = express.Router();
const kouameApi  = require('./kouame-api');

function requireAdmin(req, res, next) {
  if (!req.session?.isAdmin) return res.status(403).json({ error: 'Admin requis' });
  next();
}

// GET /api/kouame/config
router.get('/config', requireAdmin, async (req, res) => {
  try { res.json(await kouameApi.getConfig()); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

// POST /api/kouame/config
router.post('/config', requireAdmin, async (req, res) => {
  try {
    const { bot_token, channel_id, enabled } = req.body;
    const cfg = await kouameApi.setConfig({ bot_token, channel_id, enabled });
    res.json(cfg);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// DELETE /api/kouame/config
router.delete('/config', requireAdmin, async (req, res) => {
  try { await kouameApi.resetConfig(); res.json({ ok: true }); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

// GET /api/kouame/status
router.get('/status', requireAdmin, async (req, res) => {
  try { res.json(kouameApi.getStatus()); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

// POST /api/kouame/test — test de connexion (valider token)
router.post('/test', requireAdmin, async (req, res) => {
  try {
    const { bot_token, channel_id } = req.body;
    if (!bot_token) return res.status(400).json({ error: 'bot_token requis' });
    const result = await kouameApi.testConnection(bot_token, channel_id);
    res.json(result);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

module.exports = router;
