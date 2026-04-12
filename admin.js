const express = require('express');
const bcrypt  = require('bcryptjs');
const db      = require('./db');
const router  = express.Router();

function genPassword(len = 10) {
  const c = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789';
  return Array.from({ length: len }, () => c[Math.floor(Math.random() * c.length)]).join('');
}

function requireAdmin(req, res, next) {
  if (!req.session.userId || !req.session.isAdmin)
    return res.status(403).json({ error: 'Accès admin requis' });
  next();
}

function getUserStatus(user) {
  if (user.is_admin) return 'active';
  if (!user.is_approved) return 'pending';
  if (!user.subscription_expires_at) return 'expired';
  return new Date(user.subscription_expires_at) > new Date() ? 'active' : 'expired';
}

function fmtDuration(mins) {
  if (mins < 60) return `${Math.round(mins)} min`;
  const h = Math.floor(mins / 60);
  const m = Math.round(mins % 60);
  return m > 0 ? `${h}h ${m}min` : `${h}h`;
}

// Route accessible aux utilisateurs normaux — retourne leurs propres stratégies visibles
router.get('/my-strategies', async (req, res) => {
  if (!req.session.userId) return res.status(401).json({ error: 'Non connecté' });
  if (req.session.isAdmin) return res.json({ visible: ['C1', 'C2', 'C3', 'DC', 'ALL'] });
  try {
    const visible = await db.getVisibleStrategies(req.session.userId);
    res.json({ visible });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.get('/users', requireAdmin, async (req, res) => {
  try {
    const users = await db.getAllUsers();
    res.json(users.map(u => ({ ...u, status: getUserStatus(u) })));
  } catch (e) { res.status(500).json({ error: 'Erreur serveur' }); }
});

router.post('/users/:id/approve', requireAdmin, async (req, res) => {
  const id   = parseInt(req.params.id);
  const mins = parseFloat(req.body.minutes);
  if (!req.body.minutes || isNaN(mins) || mins < 10 || mins > 45000)
    return res.status(400).json({ error: 'Durée invalide (10 min à 750 h)' });
  try {
    const expires = new Date(Date.now() + mins * 60 * 1000);
    const user = await db.updateUser(id, { is_approved: true, subscription_expires_at: expires.toISOString(), subscription_duration_minutes: Math.round(mins) });
    if (!user) return res.status(404).json({ error: 'Utilisateur non trouvé' });
    res.json({ message: `Accès accordé pour ${fmtDuration(mins)}`, user });
  } catch (e) { res.status(500).json({ error: 'Erreur serveur' }); }
});

router.post('/users/:id/extend', requireAdmin, async (req, res) => {
  const id   = parseInt(req.params.id);
  const mins = parseFloat(req.body.minutes);
  if (!req.body.minutes || isNaN(mins) || mins < 10 || mins > 45000)
    return res.status(400).json({ error: 'Durée invalide (10 min à 750 h)' });
  try {
    const current = await db.getUser(id);
    if (!current) return res.status(404).json({ error: 'Utilisateur non trouvé' });
    const base   = current.subscription_expires_at
      ? new Date(Math.max(new Date(current.subscription_expires_at), Date.now()))
      : new Date();
    const expires  = new Date(base.getTime() + mins * 60 * 1000);
    const totalMins = (current.subscription_duration_minutes || 0) + Math.round(mins);
    const user = await db.updateUser(id, { subscription_expires_at: expires.toISOString(), subscription_duration_minutes: totalMins });
    res.json({ message: `Prolongé de ${fmtDuration(mins)}`, user });
  } catch (e) { res.status(500).json({ error: 'Erreur serveur' }); }
});

router.post('/users/:id/reject', requireAdmin, async (req, res) => {
  try {
    await db.updateUser(parseInt(req.params.id), { is_approved: false, subscription_expires_at: null });
    res.json({ message: 'Accès révoqué' });
  } catch (e) { res.status(500).json({ error: 'Erreur serveur' }); }
});

router.put('/users/:id', requireAdmin, async (req, res) => {
  const { first_name, last_name } = req.body;
  try {
    const user = await db.updateUser(parseInt(req.params.id), { first_name: first_name || null, last_name: last_name || null });
    if (!user) return res.status(404).json({ error: 'Utilisateur non trouvé' });
    res.json({ ok: true, user });
  } catch (e) { res.status(500).json({ error: 'Erreur serveur' }); }
});

router.delete('/users/:id', requireAdmin, async (req, res) => {
  try {
    const u = await db.getUser(parseInt(req.params.id));
    if (u?.is_admin) return res.status(400).json({ error: 'Impossible de supprimer un admin' });
    await db.deleteUser(parseInt(req.params.id));
    res.json({ message: 'Utilisateur supprimé' });
  } catch (e) { res.status(500).json({ error: 'Erreur serveur' }); }
});

router.get('/stats', requireAdmin, async (req, res) => {
  try {
    const [users, predictions] = await Promise.all([db.getUserStats(), db.getPredictionStats()]);
    res.json({ users, predictions });
  } catch (e) { res.status(500).json({ error: 'Erreur serveur' }); }
});

router.post('/generate-premium', requireAdmin, async (req, res) => {
  try {
    const count = Math.min(Math.max(parseInt(req.body.count) || 5, 1), 50);
    const domain = (req.body.domain || 'premium.pro').trim().replace(/^@/, '');
    const durationH = Math.max(parseInt(req.body.durationH) || 750, 1);
    const accounts = [];
    for (let i = 1; i <= count; i++) {
      const username  = `premium${i}`;
      const email     = `${username}@${domain}`;
      const password  = genPassword(10);
      const hash      = await bcrypt.hash(password, 10);
      const expiresAt = new Date(Date.now() + durationH * 60 * 60 * 1000);
      await db.createUser({
        username, email, password_hash: hash,
        first_name: 'Premium', last_name: String(i),
        is_approved: true, subscription_expires_at: expiresAt.toISOString(),
        subscription_duration_minutes: durationH * 60,
      });
      accounts.push({ username, email, password, expires_at: expiresAt });
    }
    res.json({ ok: true, accounts });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

const SUITS = ['♠', '♥', '♦', '♣'];

async function getStrategies() {
  const v = await db.getSetting('custom_strategies');
  return v ? JSON.parse(v) : [];
}

async function saveStrategies(list) {
  await db.setSetting('custom_strategies', JSON.stringify(list));
}

const VALID_EXCEPTION_TYPES = [
  'consec_appearances', 'recent_frequency', 'already_pending',
  'max_consec_losses', 'trigger_overload', 'last_game_appeared',
];

function parseExceptions(raw) {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter(e => e && VALID_EXCEPTION_TYPES.includes(e.type))
    .map(e => {
      const out = { type: e.type };
      if (e.value  !== undefined) out.value  = Math.max(1, parseInt(e.value)  || 1);
      if (e.window !== undefined) out.window = Math.max(2, parseInt(e.window) || 2);
      return out;
    });
}

function normalizeMappings(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const result = {};
  for (const s of SUITS) {
    const val = raw[s];
    if (Array.isArray(val)) {
      const pool = val.filter(t => SUITS.includes(t)).slice(0, 3);
      result[s] = pool.length > 0 ? pool : null;
    } else if (typeof val === 'string' && SUITS.includes(val)) {
      result[s] = [val]; // ancienne format → tableau
    } else {
      result[s] = null;
    }
  }
  return result;
}

function validateStrategyBody(body) {
  const { name, threshold, mode, mappings, visibility } = body;
  const B = parseInt(threshold);
  if (!name || !name.trim())                            return 'Nom requis';
  if (isNaN(B) || B < 1 || B > 50)                     return 'Seuil B invalide (1–50)';
  if (!['manquants', 'apparents'].includes(mode))       return 'Mode invalide';
  if (!['admin', 'all'].includes(visibility))           return 'Visibilité invalide';
  const norm = normalizeMappings(mappings);
  if (!norm) return 'Mappings invalides';
  for (const s of SUITS) {
    if (!norm[s] || norm[s].length === 0) return `Au moins 1 carte cible requise pour ${s}`;
    if (norm[s].length > 3)               return `Maximum 3 cartes cibles pour ${s}`;
  }
  const offset = parseInt(body.prediction_offset);
  if (!isNaN(offset) && (offset < 1 || offset > 10)) return 'Décalage de prédiction invalide (1–10)';
  return null;
}

function parseTgTargets(raw) {
  if (!Array.isArray(raw)) return [];
  return raw
    .map(t => ({
      bot_token:  String(t.bot_token  || '').trim(),
      channel_id: String(t.channel_id || '').trim(),
    }))
    .filter(t => t.bot_token && t.channel_id);
}

router.get('/strategies', async (req, res) => {
  if (!req.session.userId) return res.status(401).json({ error: 'Non connecté' });
  try {
    const list = await getStrategies();
    if (!req.session.isAdmin) {
      return res.json(
        list.filter(s => s.enabled && s.visibility === 'all')
            .map(s => ({ id: s.id, name: s.name, enabled: s.enabled, visibility: s.visibility, threshold: s.threshold, mode: s.mode }))
      );
    }
    res.json(list);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.post('/strategies', requireAdmin, async (req, res) => {
  try {
    const err = validateStrategyBody(req.body);
    if (err) return res.status(400).json({ error: err });
    const { name, threshold, mode, mappings, visibility, enabled, prediction_offset, hand } = req.body;
    const tg_targets = parseTgTargets(req.body.tg_targets);
    const exceptions = parseExceptions(req.body.exceptions);
    const normalizedMappings = normalizeMappings(mappings);
    const list   = await getStrategies();
    const nextId = list.length > 0 ? Math.max(...list.map(s => s.id)) + 1 : 7;
    const strat  = {
      id: nextId,
      name: name.trim().slice(0, 40),
      threshold: parseInt(threshold),
      mode, mappings: normalizedMappings,
      visibility: visibility || 'admin',
      enabled: enabled !== false,
      tg_targets,
      exceptions,
      prediction_offset: Math.max(1, parseInt(prediction_offset) || 1),
      hand: hand === 'banquier' ? 'banquier' : 'joueur',
    };
    list.push(strat);
    await saveStrategies(list);
    require('./engine').reloadCustomStrategies(list);
    res.json({ ok: true, strategy: strat });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.put('/strategies/:id', requireAdmin, async (req, res) => {
  try {
    const id  = parseInt(req.params.id);
    const err = validateStrategyBody(req.body);
    if (err) return res.status(400).json({ error: err });
    const list = await getStrategies();
    const idx  = list.findIndex(s => s.id === id);
    if (idx === -1) return res.status(404).json({ error: 'Stratégie introuvable' });
    const { name, threshold, mode, mappings, visibility, enabled, prediction_offset, hand } = req.body;
    const tg_targets = parseTgTargets(req.body.tg_targets);
    const exceptions = parseExceptions(req.body.exceptions);
    const normalizedMappings = normalizeMappings(mappings);
    list[idx] = {
      ...list[idx],
      name: name.trim().slice(0, 40),
      threshold: parseInt(threshold),
      mode, mappings: normalizedMappings,
      visibility: visibility || 'admin',
      enabled: enabled !== false,
      tg_targets,
      exceptions,
      prediction_offset: Math.max(1, parseInt(prediction_offset) || 1),
      hand: hand === 'banquier' ? 'banquier' : 'joueur',
    };
    await saveStrategies(list);
    require('./engine').reloadCustomStrategies(list);
    res.json({ ok: true, strategy: list[idx] });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.delete('/strategies/:id', requireAdmin, async (req, res) => {
  try {
    const id   = parseInt(req.params.id);
    let list   = await getStrategies();
    const before = list.length;
    list = list.filter(s => s.id !== id);
    if (list.length === before) return res.status(404).json({ error: 'Stratégie introuvable' });
    await saveStrategies(list);
    require('./engine').reloadCustomStrategies(list);

    // Nettoyer les prédictions et messages Telegram en suspens pour cette stratégie
    const stratKey = `S${id}`;
    const { cancelStrategyMessages } = require('./telegram-service');
    await db.expireStrategyPredictions(stratKey).catch(e =>
      console.warn(`[Admin] expireStrategyPredictions(${stratKey}) failed: ${e.message}`)
    );
    await cancelStrategyMessages(stratKey).catch(e =>
      console.warn(`[Admin] cancelStrategyMessages(${stratKey}) failed: ${e.message}`)
    );

    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── Nombre max de rattrapages ─────────────────────────────────────
router.get('/max-rattrapage', requireAdmin, async (req, res) => {
  try {
    const v = await db.getSetting('max_rattrapage');
    res.json({ max_rattrapage: v !== null ? parseInt(v) : 2 });
  } catch (e) { res.status(500).json({ error: 'Erreur serveur' }); }
});

router.post('/max-rattrapage', requireAdmin, async (req, res) => {
  const n = parseInt(req.body.max_rattrapage);
  if (isNaN(n) || n < 0 || n > 5) return res.status(400).json({ error: 'Valeur invalide (0–5)' });
  try {
    const tgService = require('./telegram-service');
    await tgService.saveMaxRattrapage(n);
    require('./engine').updateMaxRattrapage(n);
    res.json({ ok: true, max_rattrapage: n });
  } catch (e) { res.status(500).json({ error: 'Erreur serveur' }); }
});

// ── Format des messages Telegram ──────────────────────────────────
router.get('/msg-format', requireAdmin, async (req, res) => {
  try {
    const v = await db.getSetting('tg_msg_format');
    res.json({ format_id: parseInt(v) || 1 });
  } catch (e) { res.status(500).json({ error: 'Erreur serveur' }); }
});

// ── STRATEGY → CHANNEL ROUTING ─────────────────────────────────────

router.get('/strategy-routes', requireAdmin, async (req, res) => {
  try {
    const routes = await db.getAllStrategyRoutes();
    res.json(routes);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.get('/strategy-routes/:strategy', requireAdmin, async (req, res) => {
  try {
    const routes = await db.getStrategyRoutes(req.params.strategy);
    res.json({ strategy: req.params.strategy, channel_ids: routes.map(r => r.id) });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.put('/strategy-routes/:strategy', requireAdmin, async (req, res) => {
  const { channel_ids } = req.body;
  if (!Array.isArray(channel_ids))
    return res.status(400).json({ error: 'channel_ids doit être un tableau' });
  try {
    await db.setStrategyRoutes(req.params.strategy, channel_ids);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── STRATEGY VISIBILITY PER USER ───────────────────────────────────
router.get('/users/:userId/strategies', requireAdmin, async (req, res) => {
  const userId = parseInt(req.params.userId);
  try {
    const visible = await db.getVisibleStrategies(userId);
    res.json({ visible });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.put('/users/:userId/strategies', requireAdmin, async (req, res) => {
  const userId = parseInt(req.params.userId);
  const { strategy_ids } = req.body;
  if (!Array.isArray(strategy_ids))
    return res.status(400).json({ error: 'strategy_ids doit être un tableau' });
  try {
    await db.setVisibleStrategies(userId, strategy_ids);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── /api/admin/users/:userId/visible (GET) — retourne canaux + stratégies ──
router.get('/users/:userId/visible', requireAdmin, async (req, res) => {
  const userId = parseInt(req.params.userId);
  try {
    const [channels, strategies] = await Promise.all([
      db.getVisibleChannels(userId),
      db.getVisibleStrategies(userId),
    ]);
    res.json({ channels, strategies });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.post('/msg-format', requireAdmin, async (req, res) => {
  const id = parseInt(req.body.format_id);
  if (!id || id < 1 || id > 6) return res.status(400).json({ error: 'Format invalide (1–6)' });
  try {
    const tgService = require('./telegram-service');
    await tgService.saveFormat(id);
    res.json({ ok: true, format_id: id });
  } catch (e) { res.status(500).json({ error: 'Erreur serveur' }); }
});

router.get('/tutorial-videos', requireAdmin, async (req, res) => {
  try {
    const raw = await db.getSetting('tutorial_videos');
    res.json(raw ? JSON.parse(raw) : { video1: null, video2: null });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.put('/tutorial-videos', requireAdmin, async (req, res) => {
  try {
    const { video1, video2 } = req.body;
    await db.setSetting('tutorial_videos', JSON.stringify({
      video1: video1 || null,
      video2: video2 || null,
    }));
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

module.exports = router;
