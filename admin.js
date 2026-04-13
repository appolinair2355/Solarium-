const express = require('express');
const bcrypt  = require('bcryptjs');
const db      = require('./db');
const router  = express.Router();
const fs      = require('fs');
const path    = require('path');
const { spawn } = require('child_process');

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
  'time_window_block',
];

function parseExceptions(raw) {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter(e => e && VALID_EXCEPTION_TYPES.includes(e.type))
    .map(e => {
      const out = { type: e.type };
      if (e.value  !== undefined) out.value  = Math.max(1, parseInt(e.value)  || 1);
      if (e.window !== undefined) out.window = Math.max(2, parseInt(e.window) || 2);
      if (e.type === 'time_window_block') {
        out.half = ['first', 'second'].includes(e.half) ? e.half : 'second';
        delete out.value;
        delete out.window;
      }
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
  if (!['manquants', 'apparents', 'absence_apparition', 'apparition_absence', 'taux_miroir'].includes(mode)) return 'Mode invalide';
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
    const { name, threshold, mode, mappings, visibility, enabled, prediction_offset, hand, max_rattrapage, tg_format } = req.body;
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
      max_rattrapage: (max_rattrapage !== undefined && max_rattrapage !== null && max_rattrapage !== '')
        ? Math.max(0, parseInt(max_rattrapage) || 0) : null,
      tg_format: (tg_format !== undefined && tg_format !== null && tg_format !== '')
        ? Math.max(1, Math.min(8, parseInt(tg_format) || 1)) : null,
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
    const { name, threshold, mode, mappings, visibility, enabled, prediction_offset, hand, max_rattrapage, tg_format } = req.body;
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
      max_rattrapage: (max_rattrapage !== undefined && max_rattrapage !== null && max_rattrapage !== '')
        ? Math.max(0, parseInt(max_rattrapage) || 0) : null,
      tg_format: (tg_format !== undefined && tg_format !== null && tg_format !== '')
        ? Math.max(1, Math.min(8, parseInt(tg_format) || 1)) : null,
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
    res.json({ max_rattrapage: v !== null ? parseInt(v) : 20 });
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

// ── TELEGRAM CONFIG PAR STRATÉGIE PAR DÉFAUT (C1/C2/C3/DC) ─────────
router.get('/default-tg', requireAdmin, async (req, res) => {
  try {
    const v = await db.getSetting('default_strategies_tg');
    res.json(v ? JSON.parse(v) : {});
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.post('/default-tg', requireAdmin, async (req, res) => {
  try {
    const config = req.body; // { C1: {bot_token, channel_id}, C2: {...}, ... }
    await db.setSetting('default_strategies_tg', JSON.stringify(config));
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── SÉQUENCES DE RELANCE (pertes consécutives → relance auto) ──────
router.get('/loss-sequences', requireAdmin, async (req, res) => {
  try {
    const v = await db.getSetting('loss_sequences');
    res.json(v ? JSON.parse(v) : []);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.post('/loss-sequences', requireAdmin, async (req, res) => {
  try {
    const { name, rules, enabled } = req.body;
    if (!name || !Array.isArray(rules) || rules.length === 0)
      return res.status(400).json({ error: 'name et rules requis' });
    const current = JSON.parse(await db.getSetting('loss_sequences') || '[]');
    const seq = { id: Date.now(), name: name.trim(), enabled: enabled !== false, rules };
    current.push(seq);
    await db.setSetting('loss_sequences', JSON.stringify(current));
    require('./engine').loadLossSequences().catch(() => {});
    res.json({ ok: true, sequence: seq });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.patch('/loss-sequences/:id', requireAdmin, async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    const current = JSON.parse(await db.getSetting('loss_sequences') || '[]');
    const idx = current.findIndex(s => s.id === id);
    if (idx === -1) return res.status(404).json({ error: 'Séquence introuvable' });
    current[idx] = { ...current[idx], ...req.body };
    await db.setSetting('loss_sequences', JSON.stringify(current));
    require('./engine').loadLossSequences().catch(() => {});
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.delete('/loss-sequences/:id', requireAdmin, async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    const current = JSON.parse(await db.getSetting('loss_sequences') || '[]');
    await db.setSetting('loss_sequences', JSON.stringify(current.filter(s => s.id !== id)));
    require('./engine').loadLossSequences().catch(() => {});
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── ANNONCES PLANIFIÉES TELEGRAM ──────────────────────────────────
router.get('/announcements', requireAdmin, async (req, res) => {
  try {
    const v = await db.getSetting('tg_announcements');
    res.json(v ? JSON.parse(v) : []);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.post('/announcements', requireAdmin, async (req, res) => {
  try {
    const { name, bot_token, channel_id, text, media_type, media_url, schedule_type, interval_hours, times } = req.body;
    if (!name || !bot_token || !channel_id || !text || !schedule_type)
      return res.status(400).json({ error: 'name, bot_token, channel_id, text, schedule_type requis' });
    if (schedule_type === 'interval' && !interval_hours)
      return res.status(400).json({ error: 'interval_hours requis pour le mode interval' });
    if (schedule_type === 'times' && (!Array.isArray(times) || times.length === 0))
      return res.status(400).json({ error: 'times requis pour le mode times' });
    const current = JSON.parse(await db.getSetting('tg_announcements') || '[]');
    const ann = {
      id: Date.now(),
      name: name.trim(),
      bot_token: bot_token.trim(),
      channel_id: channel_id.trim(),
      text: text.trim(),
      media_type: media_type || null,
      media_url: media_url ? media_url.trim() : null,
      schedule_type,
      interval_hours: schedule_type === 'interval' ? parseFloat(interval_hours) : null,
      times: schedule_type === 'times' ? times : [],
      enabled: true,
      last_sent: null,
    };
    current.push(ann);
    await db.setSetting('tg_announcements', JSON.stringify(current));
    res.json({ ok: true, announcement: ann });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.patch('/announcements/:id', requireAdmin, async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    const current = JSON.parse(await db.getSetting('tg_announcements') || '[]');
    const idx = current.findIndex(a => a.id === id);
    if (idx === -1) return res.status(404).json({ error: 'Annonce introuvable' });
    current[idx] = { ...current[idx], ...req.body };
    await db.setSetting('tg_announcements', JSON.stringify(current));
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.delete('/announcements/:id', requireAdmin, async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    const current = JSON.parse(await db.getSetting('tg_announcements') || '[]');
    await db.setSetting('tg_announcements', JSON.stringify(current.filter(a => a.id !== id)));
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.post('/announcements/:id/send-now', requireAdmin, async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    const current = JSON.parse(await db.getSetting('tg_announcements') || '[]');
    const ann = current.find(a => a.id === id);
    if (!ann) return res.status(404).json({ error: 'Annonce introuvable' });
    const { sendAnnouncement } = require('./announcement-sender');
    await sendAnnouncement(ann);
    const idx = current.findIndex(a => a.id === id);
    current[idx].last_sent = new Date().toISOString();
    await db.setSetting('tg_announcements', JSON.stringify(current));
    res.json({ ok: true, sent_at: current[idx].last_sent });
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

// ── FICHIER DE MISE À JOUR ──────────────────────────────────────────

// ── Suivi de build frontend ─────────────────────────────────────────
const BUILD_STATE = { status: 'idle', startedAt: null, finishedAt: null, log: '', error: null };

function triggerRebuild() {
  if (BUILD_STATE.status === 'building') return;
  BUILD_STATE.status    = 'building';
  BUILD_STATE.startedAt = new Date().toISOString();
  BUILD_STATE.finishedAt= null;
  BUILD_STATE.log       = '';
  BUILD_STATE.error     = null;

  const child = spawn('./node_modules/.bin/vite', ['build'], {
    cwd: __dirname, stdio: ['ignore', 'pipe', 'pipe'],
  });
  child.stdout.on('data', d => { BUILD_STATE.log += d.toString(); });
  child.stderr.on('data', d => { BUILD_STATE.log += d.toString(); });
  child.on('close', code => {
    BUILD_STATE.status     = code === 0 ? 'done' : 'error';
    BUILD_STATE.finishedAt = new Date().toISOString();
    if (code !== 0) BUILD_STATE.error = `Vite exited with code ${code}`;
    else BUILD_STATE.error = null;
    console.log(`[Build] ${BUILD_STATE.status} (exit ${code})`);
  });
  child.on('error', e => {
    BUILD_STATE.status     = 'error';
    BUILD_STATE.error      = e.message;
    BUILD_STATE.finishedAt = new Date().toISOString();
  });
}

// Sauvegarde un backup d'un fichier source avant modification
function backupFile(filePath) {
  try {
    if (fs.existsSync(filePath)) {
      const bak = filePath + '.bak';
      fs.copyFileSync(filePath, bak);
    }
  } catch {}
}

// Sécurité : chemins autorisés uniquement sous la racine du projet
const PROJECT_ROOT = __dirname;
function isSafePath(p) {
  const resolved = path.resolve(PROJECT_ROOT, p);
  return resolved.startsWith(PROJECT_ROOT) && !resolved.includes('node_modules') && !resolved.includes('.git');
}

const ALLOWED_CSS_VARS = [
  '--color-gold', '--color-gold-dark', '--color-bg', '--color-bg-card',
  '--color-bg-card2', '--color-text-primary', '--color-text-secondary',
  '--color-text-muted', '--color-border', '--color-accent',
  '--font-family-base', '--font-size-base', '--font-size-sm',
  '--border-radius-card', '--border-radius-btn',
  '--color-win', '--color-loss', '--color-pending',
];

async function applyUpdateBlock(type, data) {
  const result = { type, applied: 0, errors: [] };

  if (type === 'format') {
    const id = parseInt(data?.format_id);
    if (!id || id < 1 || id > 8) { result.errors.push('format_id invalide (1–8)'); return result; }
    const tgService = require('./telegram-service');
    await tgService.saveFormat(id);
    result.applied = 1;
    result.detail = `Format de prédiction → #${id}`;
    return result;
  }

  if (type === 'strategies') {
    if (!Array.isArray(data) || data.length === 0) { result.errors.push('data doit être un tableau de stratégies'); return result; }
    const list = await getStrategies();
    for (const item of data) {
      const err = validateStrategyBody(item);
      if (err) { result.errors.push(`"${item.name || '?'}": ${err}`); continue; }
      const existing = list.findIndex(s => s.name === item.name.trim());
      const tg_targets = parseTgTargets(item.tg_targets);
      const exceptions = parseExceptions(item.exceptions);
      const mappings   = normalizeMappings(item.mappings);
      if (existing >= 0) {
        list[existing] = { ...list[existing], ...item, name: item.name.trim(), mappings, tg_targets, exceptions,
          threshold: parseInt(item.threshold), prediction_offset: Math.max(1, parseInt(item.prediction_offset) || 1),
          hand: item.hand === 'banquier' ? 'banquier' : 'joueur',
          max_rattrapage: (item.max_rattrapage !== undefined && item.max_rattrapage !== '') ? Math.max(0, parseInt(item.max_rattrapage) || 0) : null,
          tg_format: (item.tg_format !== undefined && item.tg_format !== '') ? Math.max(1, Math.min(8, parseInt(item.tg_format) || 1)) : null,
        };
        result.detail = (result.detail || '') + `\n• Mise à jour: "${item.name.trim()}"`;
      } else {
        const nextId = list.length > 0 ? Math.max(...list.map(s => s.id)) + 1 : 7;
        list.push({ id: nextId, name: item.name.trim(), threshold: parseInt(item.threshold), mode: item.mode,
          mappings, visibility: item.visibility || 'admin', enabled: item.enabled !== false,
          tg_targets, exceptions,
          prediction_offset: Math.max(1, parseInt(item.prediction_offset) || 1),
          hand: item.hand === 'banquier' ? 'banquier' : 'joueur',
          max_rattrapage: (item.max_rattrapage !== undefined && item.max_rattrapage !== '') ? Math.max(0, parseInt(item.max_rattrapage) || 0) : null,
          tg_format: (item.tg_format !== undefined && item.tg_format !== '') ? Math.max(1, Math.min(8, parseInt(item.tg_format) || 1)) : null,
        });
        result.detail = (result.detail || '') + `\n• Créée: "${item.name.trim()}"`;
      }
      result.applied++;
    }
    await saveStrategies(list);
    require('./engine').reloadCustomStrategies(list);
    return result;
  }

  if (type === 'sequences') {
    if (!Array.isArray(data) || data.length === 0) { result.errors.push('data doit être un tableau de séquences'); return result; }
    const current = JSON.parse(await db.getSetting('loss_sequences') || '[]');
    for (const item of data) {
      if (!item.name || !Array.isArray(item.rules) || item.rules.length === 0) { result.errors.push(`Séquence "${item.name || '?'}": name + rules requis`); continue; }
      const existing = current.findIndex(s => s.name === item.name.trim());
      if (existing >= 0) {
        current[existing] = { ...current[existing], name: item.name.trim(), rules: item.rules, enabled: item.enabled !== false };
        result.detail = (result.detail || '') + `\n• Mise à jour: "${item.name.trim()}"`;
      } else {
        current.push({ id: Date.now() + result.applied, name: item.name.trim(), enabled: item.enabled !== false, rules: item.rules });
        result.detail = (result.detail || '') + `\n• Créée: "${item.name.trim()}"`;
      }
      result.applied++;
    }
    await db.setSetting('loss_sequences', JSON.stringify(current));
    require('./engine').loadLossSequences().catch(() => {});
    return result;
  }

  if (type === 'styles') {
    if (!data || typeof data !== 'object') { result.errors.push('data doit être un objet de variables CSS'); return result; }
    const current = JSON.parse(await db.getSetting('ui_styles') || '{}');
    const rejected = [];
    for (const [key, val] of Object.entries(data)) {
      if (!ALLOWED_CSS_VARS.includes(key)) { rejected.push(key); continue; }
      if (typeof val !== 'string' || val.length > 100) { result.errors.push(`Valeur invalide pour ${key}`); continue; }
      current[key] = val;
      result.applied++;
      result.detail = (result.detail || '') + `\n• ${key}: ${val}`;
    }
    if (rejected.length > 0) result.errors.push(`Variables inconnues ignorées: ${rejected.join(', ')}`);
    await db.setSetting('ui_styles', JSON.stringify(current));
    return result;
  }

  if (type === 'code') {
    const files   = data?.files;
    const rebuild = data?.rebuild !== false; // true par défaut si frontend touché
    const hotReloadBackend = data?.reload_backend === true;

    if (!Array.isArray(files) || files.length === 0) {
      result.errors.push('data.files doit être un tableau de fichiers à modifier');
      return result;
    }

    let needsRebuild  = false;
    let needsBackendOp = false;

    for (const f of files) {
      if (!f.path || typeof f.path !== 'string') { result.errors.push('Chaque fichier doit avoir un champ "path"'); continue; }
      if (!isSafePath(f.path)) { result.errors.push(`Chemin non autorisé: ${f.path}`); continue; }

      const absPath = path.resolve(PROJECT_ROOT, f.path);
      const isFrontend = f.path.startsWith('src/') || f.path.startsWith('public/');
      const isBackend  = !isFrontend;

      // Créer les dossiers si nécessaire
      fs.mkdirSync(path.dirname(absPath), { recursive: true });

      // ─ Remplacement complet du fichier ─
      if (f.content !== undefined) {
        backupFile(absPath);
        fs.writeFileSync(absPath, f.content, 'utf8');
        result.applied++;
        result.detail = (result.detail || '') + `\n• Remplacé: ${f.path}`;
        if (isFrontend) needsRebuild = true;
        if (isBackend)  needsBackendOp = true;
        continue;
      }

      // ─ Opérations de recherche-remplacement ─
      if (!fs.existsSync(absPath)) { result.errors.push(`Fichier introuvable: ${f.path}`); continue; }
      let content = fs.readFileSync(absPath, 'utf8');

      let modified = false;

      // find + replace (remplace TOUTES les occurrences si replace_all, sinon la première)
      if (f.find !== undefined && f.replace !== undefined) {
        if (!content.includes(f.find)) { result.errors.push(`Marqueur non trouvé dans ${f.path}`); continue; }
        backupFile(absPath);
        content = f.replace_all
          ? content.split(f.find).join(f.replace)
          : content.replace(f.find, f.replace);
        modified = true;
        result.detail = (result.detail || '') + `\n• Modifié (find+replace): ${f.path}`;
      }

      // find + insert_after
      else if (f.find !== undefined && f.insert_after !== undefined) {
        if (!content.includes(f.find)) { result.errors.push(`Marqueur non trouvé dans ${f.path}: "${String(f.find).slice(0,60)}"`); continue; }
        backupFile(absPath);
        content = content.replace(f.find, f.find + f.insert_after);
        modified = true;
        result.detail = (result.detail || '') + `\n• Inséré après marqueur dans: ${f.path}`;
      }

      // find + insert_before
      else if (f.find !== undefined && f.insert_before !== undefined) {
        if (!content.includes(f.find)) { result.errors.push(`Marqueur non trouvé dans ${f.path}`); continue; }
        backupFile(absPath);
        content = content.replace(f.find, f.insert_before + f.find);
        modified = true;
        result.detail = (result.detail || '') + `\n• Inséré avant marqueur dans: ${f.path}`;
      }

      // append (ajouter à la fin)
      else if (f.append !== undefined) {
        backupFile(absPath);
        content = content + '\n' + f.append;
        modified = true;
        result.detail = (result.detail || '') + `\n• Ajouté en fin de: ${f.path}`;
      }

      // prepend (ajouter au début)
      else if (f.prepend !== undefined) {
        backupFile(absPath);
        content = f.prepend + '\n' + content;
        modified = true;
        result.detail = (result.detail || '') + `\n• Ajouté en début de: ${f.path}`;
      }

      else { result.errors.push(`Fichier ${f.path}: aucune opération valide (content, find+replace, find+insert_after, append, prepend)`); continue; }

      if (modified) {
        fs.writeFileSync(absPath, content, 'utf8');
        result.applied++;
        if (isFrontend) needsRebuild = true;
        if (isBackend)  needsBackendOp = true;
      }
    }

    // Démarrer le rebuild en arrière-plan si fichiers frontend modifiés
    if (result.applied > 0 && needsRebuild && rebuild) {
      triggerRebuild();
      result.rebuilding = true;
      result.detail = (result.detail || '') + '\n• 🔨 Build frontend lancé en arrière-plan (~15s)';
    }

    // Rechargement backend (hot-reload via suppression du cache require)
    if (result.applied > 0 && needsBackendOp) {
      if (hotReloadBackend) {
        for (const f of files) {
          if (!f.path.startsWith('src/')) {
            try {
              const abs = path.resolve(PROJECT_ROOT, f.path);
              delete require.cache[abs];
            } catch {}
          }
        }
        result.detail = (result.detail || '') + '\n• ♻️ Module backend rechargé';
      } else {
        result.restart_needed = true;
        result.detail = (result.detail || '') + '\n• ⚠️ Redémarrage serveur recommandé pour appliquer les changements backend';
      }
    }

    return result;
  }

  result.errors.push(`Type "${type}" inconnu. Types valides: format, strategies, sequences, styles, code, multi`);
  return result;
}

router.post('/apply-update', requireAdmin, async (req, res) => {
  try {
    const { type, data } = req.body;
    if (!type) return res.status(400).json({ error: 'Champ "type" manquant' });

    const results = [];

    if (type === 'multi') {
      if (!Array.isArray(data)) return res.status(400).json({ error: 'Pour type "multi", data doit être un tableau de blocs' });
      for (const block of data) {
        if (!block.type || !block.data) { results.push({ type: block.type || '?', applied: 0, errors: ['Bloc invalide (type + data requis)'] }); continue; }
        results.push(await applyUpdateBlock(block.type, block.data));
      }
    } else {
      results.push(await applyUpdateBlock(type, data));
    }

    const totalApplied = results.reduce((s, r) => s + r.applied, 0);
    const allErrors    = results.flatMap(r => r.errors);
    res.json({ ok: allErrors.length === 0 || totalApplied > 0, results, total_applied: totalApplied, errors: allErrors });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.get('/ui-styles', requireAdmin, async (req, res) => {
  try {
    const raw = await db.getSetting('ui_styles');
    res.json({ styles: raw ? JSON.parse(raw) : {}, allowed_vars: ALLOWED_CSS_VARS });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.delete('/ui-styles', requireAdmin, async (req, res) => {
  try {
    await db.setSetting('ui_styles', '{}');
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── Statut du build frontend ────────────────────────────────────────
router.get('/build-status', requireAdmin, (req, res) => {
  res.json(BUILD_STATE);
});

router.post('/build-status/trigger', requireAdmin, (req, res) => {
  if (BUILD_STATE.status === 'building') return res.json({ ok: false, message: 'Build déjà en cours' });
  triggerRebuild();
  res.json({ ok: true, message: 'Build lancé' });
});

// ── Restauration d'un fichier sauvegardé (.bak) ────────────────────
router.post('/restore-file', requireAdmin, (req, res) => {
  try {
    const { file_path } = req.body;
    if (!file_path || !isSafePath(file_path)) return res.status(400).json({ error: 'Chemin invalide' });
    const abs = path.resolve(PROJECT_ROOT, file_path);
    const bak = abs + '.bak';
    if (!fs.existsSync(bak)) return res.status(404).json({ error: 'Aucun backup disponible pour ce fichier' });
    fs.copyFileSync(bak, abs);
    res.json({ ok: true, message: `${file_path} restauré depuis le backup` });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── Liste des fichiers source modifiés (ayant un .bak) ─────────────
router.get('/modified-files', requireAdmin, (req, res) => {
  try {
    const results = [];
    function scanDir(dir) {
      if (!fs.existsSync(dir)) return;
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory() && !['node_modules', '.git', 'dist'].includes(entry.name)) {
          scanDir(full);
        } else if (entry.isFile() && entry.name.endsWith('.bak')) {
          const orig = full.slice(0, -4);
          results.push(path.relative(PROJECT_ROOT, orig));
        }
      }
    }
    scanDir(PROJECT_ROOT);
    res.json(results);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── MESSAGES REÇUS DES UTILISATEURS ────────────────────────────────

router.get('/user-messages', requireAdmin, async (req, res) => {
  try {
    const raw = await db.getSetting('user_messages');
    res.json(raw ? JSON.parse(raw) : []);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.post('/user-messages/:id/read', requireAdmin, async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    const raw = await db.getSetting('user_messages');
    const messages = raw ? JSON.parse(raw) : [];
    const msg = messages.find(m => m.id === id);
    if (msg) msg.read = true;
    await db.setSetting('user_messages', JSON.stringify(messages));
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.delete('/user-messages/:id', requireAdmin, async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    const raw = await db.getSetting('user_messages');
    const messages = (raw ? JSON.parse(raw) : []).filter(m => m.id !== id);
    await db.setSetting('user_messages', JSON.stringify(messages));
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.delete('/user-messages', requireAdmin, async (req, res) => {
  try {
    await db.deleteSetting('user_messages');
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── MESSAGE BROADCAST (Accueil utilisateurs) ────────────────────────

router.get('/broadcast-message', requireAdmin, async (req, res) => {
  try {
    const raw = await db.getSetting('broadcast_message');
    res.json(raw ? JSON.parse(raw) : { enabled: false, text: '', targets: ['pending', 'active', 'expired'] });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.post('/broadcast-message', requireAdmin, async (req, res) => {
  try {
    const { text, enabled, targets } = req.body;
    if (!text || !String(text).trim()) return res.status(400).json({ error: 'Message requis' });
    const validTargets = ['pending', 'active', 'expired'];
    const chosen = Array.isArray(targets) ? targets.filter(t => validTargets.includes(t)) : validTargets;
    await db.setSetting('broadcast_message', JSON.stringify({
      text: String(text).trim().slice(0, 1000),
      enabled: enabled !== false,
      targets: chosen.length > 0 ? chosen : validTargets,
      updated_at: new Date().toISOString(),
    }));
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.delete('/broadcast-message', requireAdmin, async (req, res) => {
  try {
    await db.deleteSetting('broadcast_message');
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── BASE EXTERNE RENDER ─────────────────────────────────────────────

router.get('/render-db', requireAdmin, async (req, res) => {
  try {
    const renderSync = require('./render-sync');
    const url = await db.getSetting('render_db_url');
    const stats = await renderSync.getRenderStats();
    res.json({
      connected: renderSync.isConnected(),
      has_url: !!url,
      stats,
    });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.post('/render-db/test', requireAdmin, async (req, res) => {
  try {
    const { url } = req.body;
    if (!url || !url.trim()) return res.status(400).json({ error: 'URL manquante' });
    const renderSync = require('./render-sync');
    const result = await renderSync.testConnection(url.trim());
    res.json(result);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.post('/render-db', requireAdmin, async (req, res) => {
  try {
    const { url } = req.body;
    if (!url || !url.trim()) return res.status(400).json({ error: 'URL manquante' });
    const renderSync = require('./render-sync');
    const test = await renderSync.testConnection(url.trim());
    if (!test.ok) return res.status(400).json({ error: `Connexion échouée: ${test.error}` });
    await db.setSetting('render_db_url', url.trim());
    await renderSync.loadRenderUrl();
    res.json({ ok: true, ts: test.ts });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.delete('/render-db', requireAdmin, async (req, res) => {
  try {
    await db.deleteSetting('render_db_url');
    const renderSync = require('./render-sync');
    await renderSync.loadRenderUrl();
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.post('/render-db/reset', requireAdmin, async (req, res) => {
  try {
    const renderSync = require('./render-sync');
    if (!renderSync.isConnected()) return res.status(400).json({ error: 'Base Render non connectée' });
    await renderSync.handleGameOne(1);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

module.exports = router;
