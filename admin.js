const express = require('express');
const bcrypt  = require('bcryptjs');
const fetch   = require('node-fetch');
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

function requireSuperAdmin(req, res, next) {
  if (!req.session.userId || !req.session.isAdmin)
    return res.status(403).json({ error: 'Accès admin requis' });
  if ((req.session.adminLevel || 2) !== 1)
    return res.status(403).json({ error: 'Accès réservé à l\'administrateur principal' });
  next();
}

// ── Pro OU Admin ────────────────────────────────────────────────────
// Utilisé pour toutes les routes /pro-config et /pro-strategy-file
function requireProOrAdmin(req, res, next) {
  if (!req.session.userId) return res.status(401).json({ error: 'Non connecté' });
  if (!req.session.isAdmin && !req.session.isPro)
    return res.status(403).json({ error: 'Accès réservé aux comptes Pro' });
  next();
}

// Détermine le propriétaire effectif d'une ressource Pro :
//   - admin : peut passer ?owner_user_id=N (sinon = lui-même)
//   - Pro   : forcé sur req.session.userId (ignore tout owner_user_id passé)
function effectiveOwnerId(req) {
  if (req.session.isAdmin) {
    const q = req.query.owner_user_id || req.body?.owner_user_id;
    const n = parseInt(q);
    return Number.isFinite(n) && n > 0 ? n : req.session.userId;
  }
  return req.session.userId;
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
    // Tous les utilisateurs (normal ou premium) : exactement ce que l'admin a assigné
    res.json({ visible });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.get('/users', requireAdmin, async (req, res) => {
  try {
    const users = await db.getAllUsers();
    res.json(users.map(u => ({ ...u, status: getUserStatus(u) })));
  } catch (e) { res.status(500).json({ error: 'Erreur serveur' }); }
});

router.post('/users/:id/approve', requireSuperAdmin, async (req, res) => {
  const id   = parseInt(req.params.id);
  const mins = parseFloat(req.body.minutes);
  if (!req.body.minutes || isNaN(mins) || mins < 10 || mins > 45000)
    return res.status(400).json({ error: 'Durée invalide (10 min à 750 h)' });
  try {
    const expires = new Date(Date.now() + mins * 60 * 1000);
    const user = await db.updateUser(id, { is_approved: true, subscription_expires_at: expires.toISOString(), subscription_duration_minutes: Math.round(mins) });
    if (!user) return res.status(404).json({ error: 'Utilisateur non trouvé' });
    renderSync.syncUser(user).catch(() => {});
    // Auto-assignation du mode aléatoire à chaque nouvel utilisateur approuvé
    try {
      const stratRaw = await db.getSetting('custom_strategies');
      const strats = stratRaw ? JSON.parse(stratRaw) : [];
      for (let i = 0; i < strats.length; i++) {
        if (strats[i].mode === 'aleatoire') {
          const sid = `S${i + 1}`;
          await db.pool.query(
            'INSERT INTO user_strategy_visible (user_id, strategy_id) VALUES ($1, $2) ON CONFLICT DO NOTHING',
            [id, sid]
          );
        }
      }
    } catch (_) {}
    res.json({ message: `Accès accordé pour ${fmtDuration(mins)}`, user });
  } catch (e) { res.status(500).json({ error: 'Erreur serveur' }); }
});

router.post('/users/:id/extend', requireSuperAdmin, async (req, res) => {
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
    renderSync.syncUser(user).catch(() => {});
    res.json({ message: `Prolongé de ${fmtDuration(mins)}`, user });
  } catch (e) { res.status(500).json({ error: 'Erreur serveur' }); }
});

router.post('/users/:id/reject', requireSuperAdmin, async (req, res) => {
  try {
    const rUser = await db.updateUser(parseInt(req.params.id), { is_approved: false, subscription_expires_at: null });
    if (rUser) renderSync.syncUser(rUser).catch(() => {});
    res.json({ message: 'Accès révoqué' });
  } catch (e) { res.status(500).json({ error: 'Erreur serveur' }); }
});

router.put('/users/:id', requireAdmin, async (req, res) => {
  const { first_name, last_name } = req.body;
  try {
    const user = await db.updateUser(parseInt(req.params.id), { first_name: first_name || null, last_name: last_name || null });
    if (!user) return res.status(404).json({ error: 'Utilisateur non trouvé' });
    renderSync.syncUser(user).catch(() => {});
    res.json({ ok: true, user });
  } catch (e) { res.status(500).json({ error: 'Erreur serveur' }); }
});

router.delete('/users/:id', requireSuperAdmin, async (req, res) => {
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

router.post('/generate-premium', requireSuperAdmin, async (req, res) => {
  try {
    const count = Math.min(Math.max(parseInt(req.body.count) || 5, 1), 50);
    const domain = (req.body.domain || 'premium.pro').trim().replace(/^@/, '');
    const durationH = Math.max(parseInt(req.body.durationH) || 750, 1);

    // Supprimer les 5 derniers comptes générés
    const lastRaw = await db.getSetting('premium_last_generated');
    if (lastRaw) {
      try {
        const lastUsernames = JSON.parse(lastRaw);
        for (const uname of lastUsernames) {
          const u = await db.getUserByLogin(uname);
          if (u) await db.deleteUser(u.id);
        }
      } catch (_) {}
    }

    // Suffix unique basé sur timestamp (ex: pm_A3F2_1)
    const suffix = Date.now().toString(36).slice(-4).toUpperCase();
    const accounts = [];
    const generatedUsernames = [];

    for (let i = 1; i <= count; i++) {
      const username  = `pm_${suffix}_${i}`;
      const email     = `${username}@${domain}`;
      const password  = genPassword(10);
      const hash      = await bcrypt.hash(password, 10);
      const expiresAt = new Date(Date.now() + durationH * 60 * 60 * 1000);
      await db.createUser({
        username, email, password_hash: hash,
        first_name: 'Premium', last_name: String(i),
        is_approved: true, is_premium: true, subscription_expires_at: expiresAt.toISOString(),
        subscription_duration_minutes: durationH * 60,
      });
      accounts.push({ username, email, password, expires_at: expiresAt });
      generatedUsernames.push(username);
    }

    // Sauvegarder les noms générés pour la prochaine suppression
    await db.setSetting('premium_last_generated', JSON.stringify(generatedUsernames));

    res.json({ ok: true, accounts });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

const renderSync = require('./render-sync');

const SUITS = ['♠', '♥', '♦', '♣'];

async function getStrategies() {
  const v = await db.getSetting('custom_strategies');
  if (!v) return [];
  const parsed = JSON.parse(v);
  return Array.isArray(parsed) ? parsed : [parsed];
}

async function saveStrategies(list) {
  await db.setSetting('custom_strategies', JSON.stringify(list));
}

const VALID_EXCEPTION_TYPES = [
  'consec_appearances', 'recent_frequency', 'already_pending',
  'max_consec_losses', 'trigger_overload', 'last_game_appeared',
  'time_window_block',
  'minute_interval_block', 'min_history', 'consec_wins',
  'suit_absent_long', 'high_win_rate', 'pending_overload',
  'game_parity', 'dominant_streak', 'cold_start',
  'bad_hour', 'double_suit_last', 'loss_streak_pause',
  'trigger_card_position',
  'consec_same_suit_pred',
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
      if (e.type === 'minute_interval_block') {
        out.from = Math.max(0,  Math.min(58, parseInt(e.from) || 0));
        out.to   = Math.max(1,  Math.min(59, parseInt(e.to)   || 10));
        delete out.value;
        delete out.window;
      }
      if (e.type === 'game_parity') {
        out.parity = ['even', 'odd'].includes(e.parity) ? e.parity : 'even';
        delete out.value;
        delete out.window;
      }
      if (e.type === 'bad_hour') {
        out.from_hour = Math.max(0,  Math.min(23, parseInt(e.from_hour) || 0));
        out.to_hour   = Math.max(0,  Math.min(23, parseInt(e.to_hour)   || 6));
        delete out.value;
        delete out.window;
      }
      if (['already_pending', 'last_game_appeared', 'double_suit_last'].includes(e.type)) {
        delete out.value;
        delete out.window;
      }
      if (e.type === 'trigger_card_position') {
        // positions: tableau de numéros de position à bloquer (1, 2, 3)
        const rawPos = Array.isArray(e.positions) ? e.positions : [];
        out.positions = rawPos.map(Number).filter(p => p >= 1 && p <= 6);
        if (!out.positions.length) out.positions = [1];
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
  const { name, threshold, mode, mappings, visibility, strategy_type } = body;
  if (!name || !name.trim())         return 'Nom requis';
  if (!['admin', 'all'].includes(visibility)) return 'Visibilité invalide';
  const offset = parseInt(body.prediction_offset);
  if (!isNaN(offset) && (offset < 1 || offset > 10)) return 'Décalage de prédiction invalide (1–10)';

  if (strategy_type === 'combinaison') {
    const sources = Array.isArray(body.multi_source_ids) ? body.multi_source_ids : [];
    if (sources.length < 1) return 'Au moins 1 stratégie source requise pour la combinaison';
    return null;
  }

  if (mode === 'relance') {
    const rules = Array.isArray(body.relance_rules) ? body.relance_rules : [];
    if (rules.length < 1) return 'Au moins 1 stratégie source requise pour les séquences de relance';
    return null;
  }

  if (mode === 'aleatoire') {
    return null;
  }

  const CARTE_AUTO_MODES = ['carte_3_vers_2', 'carte_2_vers_3'];
  const isCarteAuto = CARTE_AUTO_MODES.includes(mode);

  {
    const B = parseInt(threshold);
    if (isNaN(B) || B < 1 || B > 50) return 'Seuil B invalide (1–50)';
  }
  if (!['manquants', 'apparents', 'absence_apparition', 'apparition_absence', 'taux_miroir', 'distribution', 'carte_3_vers_2', 'carte_2_vers_3', 'compteur_adverse', 'absence_victoire', 'abs_3_vers_2', 'abs_3_vers_3'].includes(mode)) return 'Mode invalide';
  if (mode !== 'distribution' && !isCarteAuto) {
    const norm = normalizeMappings(mappings);
    if (!norm) return 'Mappings invalides';
    for (const s of SUITS) {
      if (!norm[s] || norm[s].length === 0) return `Au moins 1 carte cible requise pour ${s}`;
      if (norm[s].length > 3)               return `Maximum 3 cartes cibles pour ${s}`;
    }
  }
  return null;
}

function parseTgTargets(raw) {
  if (!Array.isArray(raw)) return [];
  return raw
    .map(t => {
      const obj = {
        bot_token:  String(t.bot_token  || '').trim(),
        channel_id: String(t.channel_id || '').trim(),
      };
      if (t.tg_format !== undefined && t.tg_format !== null && t.tg_format !== '')
        obj.tg_format = Math.max(1, parseInt(t.tg_format) || 1);
      return obj;
    })
    .filter(t => t.bot_token && t.channel_id);
}

// ── Métadonnées des stratégies Pro (pour StrategySelect) ──────────────────
router.get('/pro-strategies', async (req, res) => {
  if (!req.session.userId) return res.status(401).json({ error: 'Non connecté' });
  const user = await db.getUser(req.session.userId).catch(() => null);
  if (!user) return res.status(401).json({ error: 'Non connecté' });
  if (!user.is_admin && !user.is_pro)
    return res.status(403).json({ error: 'Accès réservé' });
  try {
    const rawIds  = await db.getSetting('pro_strategy_ids').catch(() => null);
    const proIds  = rawIds ? JSON.parse(rawIds) : [];
    const allStrategies = await Promise.all(proIds.map(async (id) => {
      const rawM = await db.getSetting(`pro_strategy_${id}_meta`).catch(() => null);
      const m    = rawM ? JSON.parse(rawM) : {};
      const info = m.strategy_info || {};
      return {
        id,
        name: m.strategy_name || m.filename || `Stratégie S${id}`,
        strategy_name: m.strategy_name || null,
        filename: m.filename || '',
        hand: info.hand || 'joueur',
        decalage: info.decalage,
        max_rattrapage: info.max_rattrapage ?? 2,
        engine_type: m.engine_type || null,
        owner_user_id: m.owner_user_id || null,
      };
    }));
    // Un compte Pro (non-admin) ne voit QUE ses propres stratégies importées.
    // L'admin voit toutes les stratégies Pro pour pouvoir les gérer.
    const strategies = user.is_admin
      ? allStrategies
      : allStrategies.filter(s => s.owner_user_id === req.session.userId);
    res.json({ strategies, active: strategies.length > 0 });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.get('/strategies', async (req, res) => {
  if (!req.session.userId) return res.status(401).json({ error: 'Non connecté' });
  try {
    const list = await getStrategies();
    if (!req.session.isAdmin) {
      // Récupérer les stratégies explicitement assignées à cet utilisateur
      const assignedIds = await db.getVisibleStrategies(req.session.userId);
      const assignedSet = new Set(assignedIds.map(id => String(id)));
      return res.json(
        list.filter(s => s.enabled && (s.visibility === 'all' || assignedSet.has(`S${s.id}`)))
            .map(s => ({ id: s.id, name: s.name, enabled: s.enabled, visibility: s.visibility, threshold: s.threshold, mode: s.mode }))
      );
    }
    res.json(list);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.post('/strategies', requireAdmin, async (req, res) => {
  console.log('[Strategy POST] Requête reçue:', JSON.stringify(req.body).substring(0, 200));
  try {
    const err = validateStrategyBody(req.body);
    if (err) { console.log('[Strategy POST] Validation échouée:', err); return res.status(400).json({ error: err }); }
    const { name, threshold, mode, mappings, visibility, enabled, prediction_offset, hand, max_rattrapage, tg_format,
            strategy_type, multi_source_ids, multi_require, loss_type, relance_rules } = req.body;
    const tg_targets  = parseTgTargets(req.body.tg_targets);
    const exceptions  = parseExceptions(req.body.exceptions);
    const mirror_pairs = mode === 'taux_miroir' && Array.isArray(req.body.mirror_pairs)
      ? req.body.mirror_pairs.filter(p => p && p.a && p.b)
          .map(p => ({ a: p.a, b: p.b, threshold: p.threshold != null ? parseInt(p.threshold) || null : null }))
      : [];
    const isComb      = strategy_type === 'combinaison';
    const isRelance   = mode === 'relance';
    const isCarteAuto = ['carte_3_vers_2', 'carte_2_vers_3'].includes(mode);
    const normalizedMappings = (isComb || isRelance || isCarteAuto) ? null : normalizeMappings(mappings);
    const list   = await getStrategies();
    const nextId = list.length > 0 ? Math.max(...list.map(s => s.id)) + 1 : 7;
    const strat  = {
      id: nextId,
      name: name.trim().slice(0, 40),
      strategy_type: isComb ? 'combinaison' : 'simple',
      ...(isComb
        ? { multi_source_ids: (Array.isArray(multi_source_ids) ? multi_source_ids : []).map(String),
            multi_require:    multi_require || 'any',
            mode: 'multi_strategy', mappings: null, threshold: 0 }
        : isRelance
        ? { mode: 'relance', mappings: null, threshold: 0,
            relance_rules: Array.isArray(relance_rules) ? relance_rules.map(r => ({
              strategy_id:     String(r.strategy_id),
              losses_threshold: r.losses_threshold != null ? Math.max(1, parseInt(r.losses_threshold) || 1) : null,
              rattrapage_level: r.rattrapage_level != null ? Math.max(1, parseInt(r.rattrapage_level) || 1) : null,
              rattrapage_count: Math.max(1, parseInt(r.rattrapage_count) || 1),
              combo_level:      r.combo_level != null ? Math.max(1, parseInt(r.combo_level) || 1) : null,
              combo_count:      Math.max(1, parseInt(r.combo_count) || 1),
              range_from:       r.range_from != null ? Math.max(1, parseInt(r.range_from) || 1) : null,
              range_count:      Math.max(1, parseInt(r.range_count) || 1),
              interval_min:     r.interval_min != null ? Math.max(1, parseInt(r.interval_min) || 1) : null,
              interval_max:     r.interval_max != null ? Math.max(1, parseInt(r.interval_max) || 1) : null,
              interval_count:   Math.max(1, parseInt(r.interval_count) || 1),
            })) : [] }
        : isCarteAuto
        ? { threshold: parseInt(threshold), mode, mappings: null }
        : { threshold: parseInt(threshold), mode, mappings: normalizedMappings }),
      mirror_pairs,
      visibility: visibility || 'admin',
      enabled: enabled !== false,
      tg_targets,
      exceptions,
      prediction_offset: Math.max(1, parseInt(prediction_offset) || 1),
      hand: hand === 'banquier' ? 'banquier' : 'joueur',
      loss_type: ['sec', 'rattrapage', 'martingale'].includes(loss_type) ? loss_type : 'rattrapage',
      max_rattrapage: (max_rattrapage !== undefined && max_rattrapage !== null && max_rattrapage !== '')
        ? Math.max(0, parseInt(max_rattrapage) || 0) : null,
      tg_format: (tg_format !== undefined && tg_format !== null && tg_format !== '')
        ? Math.max(1, parseInt(tg_format) || 1) : null,
    };
    list.push(strat);
    await saveStrategies(list);
    require('./engine').reloadCustomStrategies(list);
    renderSync.syncStrategies().catch(() => {});
    res.json({ ok: true, strategy: strat });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.put('/strategies/:id', requireAdmin, async (req, res) => {
  console.log('[Strategy PUT] Requête reçue id=' + req.params.id);
  try {
    const id  = parseInt(req.params.id);
    const err = validateStrategyBody(req.body);
    if (err) { console.log('[Strategy PUT] Validation échouée:', err); return res.status(400).json({ error: err }); }
    const list = await getStrategies();
    const idx  = list.findIndex(s => s.id === id);
    if (idx === -1) { console.log('[Strategy PUT] Stratégie introuvable id=' + id); return res.status(404).json({ error: 'Stratégie introuvable' }); }
    const { name, threshold, mode, mappings, visibility, enabled, prediction_offset, hand, max_rattrapage, tg_format,
            strategy_type, multi_source_ids, multi_require, loss_type, relance_rules } = req.body;
    const tg_targets  = parseTgTargets(req.body.tg_targets);
    const exceptions  = parseExceptions(req.body.exceptions);
    const mirror_pairs = mode === 'taux_miroir' && Array.isArray(req.body.mirror_pairs)
      ? req.body.mirror_pairs.filter(p => p && p.a && p.b)
          .map(p => ({ a: p.a, b: p.b, threshold: p.threshold != null ? parseInt(p.threshold) || null : null }))
      : [];
    const isComb      = strategy_type === 'combinaison';
    const isRelance   = mode === 'relance';
    const isCarteAuto = ['carte_3_vers_2', 'carte_2_vers_3'].includes(mode);
    const normalizedMappings = (isComb || isRelance || isCarteAuto) ? null : normalizeMappings(mappings);
    list[idx] = {
      ...list[idx],
      name: name.trim().slice(0, 40),
      strategy_type: isComb ? 'combinaison' : 'simple',
      ...(isComb
        ? { multi_source_ids: (Array.isArray(multi_source_ids) ? multi_source_ids : []).map(String),
            multi_require:    multi_require || 'any',
            mode: 'multi_strategy', mappings: null, threshold: 0 }
        : isRelance
        ? { mode: 'relance', mappings: null, threshold: 0,
            relance_rules: Array.isArray(relance_rules) ? relance_rules.map(r => ({
              strategy_id:      String(r.strategy_id),
              losses_threshold:  r.losses_threshold != null ? Math.max(1, parseInt(r.losses_threshold) || 1) : null,
              rattrapage_level:  r.rattrapage_level != null ? Math.max(1, parseInt(r.rattrapage_level) || 1) : null,
              rattrapage_count:  Math.max(1, parseInt(r.rattrapage_count) || 1),
              combo_level:       r.combo_level != null ? Math.max(1, parseInt(r.combo_level) || 1) : null,
              combo_count:       Math.max(1, parseInt(r.combo_count) || 1),
              range_from:        r.range_from != null ? Math.max(1, parseInt(r.range_from) || 1) : null,
              range_count:       Math.max(1, parseInt(r.range_count) || 1),
              interval_min:      r.interval_min != null ? Math.max(1, parseInt(r.interval_min) || 1) : null,
              interval_max:      r.interval_max != null ? Math.max(1, parseInt(r.interval_max) || 1) : null,
              interval_count:    Math.max(1, parseInt(r.interval_count) || 1),
            })) : [] }
        : isCarteAuto
        ? { threshold: parseInt(threshold), mode, mappings: null }
        : { threshold: parseInt(threshold), mode, mappings: normalizedMappings }),
      mirror_pairs,
      visibility: visibility || 'admin',
      enabled: enabled !== false,
      tg_targets,
      exceptions,
      prediction_offset: Math.max(1, parseInt(prediction_offset) || 1),
      hand: hand === 'banquier' ? 'banquier' : 'joueur',
      loss_type: ['sec', 'rattrapage', 'martingale'].includes(loss_type) ? loss_type : 'rattrapage',
      max_rattrapage: (max_rattrapage !== undefined && max_rattrapage !== null && max_rattrapage !== '')
        ? Math.max(0, parseInt(max_rattrapage) || 0) : null,
      tg_format: (tg_format !== undefined && tg_format !== null && tg_format !== '')
        ? Math.max(1, parseInt(tg_format) || 1) : null,
    };
    await saveStrategies(list);
    require('./engine').reloadCustomStrategies(list);
    renderSync.syncStrategies().catch(() => {});
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

    renderSync.syncStrategies().catch(() => {});
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── Compteurs miroir (taux_miroir) et carte (carte_3_vers_2 / carte_2_vers_3) ──
router.get('/strategies/:id/mirror-counts', requireAdmin, (req, res) => {
  try {
    const id = parseInt(req.params.id);
    const entry = engine.custom?.[id];
    if (!entry) return res.json({ counts: {}, threshold: 0 });
    const mode = entry.config?.mode || '';
    const threshold = entry.config?.threshold || 0;
    if (mode === 'carte_3_vers_2') {
      return res.json({
        counts: { c3v2: entry.counts?.['c3v2'] || 0 },
        threshold,
        waiting: !!entry.waiting_c3v2,
        mode,
      });
    }
    if (mode === 'carte_2_vers_3') {
      return res.json({
        counts: { c2v3: entry.counts?.['c2v3'] || 0 },
        threshold,
        waiting: !!entry.waiting_c2v3,
        mode,
      });
    }
    const counts = entry.mirrorCounts || {};
    res.json({ counts, threshold, mode });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── Reset statistiques par stratégie ──────────────────────────────
// Supprime tout l'historique de prédictions d'une stratégie (C1, C2, C3, DC ou Sn)
router.post('/strategies/:id/reset-stats', requireAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    // id peut être 'C1','C2','C3','DC' (strategies intégrées) ou un entier (custom → Sn)
    const stratKey = /^\d+$/.test(id) ? `S${id}` : id;
    const deleted = await db.deleteStrategyPredictions(stratKey);
    // Nettoyer aussi les messages Telegram stockés pour cette stratégie
    await db.deleteTgMsgIdsForStrategy(stratKey).catch(() => {});
    // Réinitialiser les pending en mémoire moteur
    const eng = require('./engine');
    if (eng && eng.clearStrategyPending) eng.clearStrategyPending(stratKey);
    console.log(`[Admin] Reset stats ${stratKey} — ${deleted} prédiction(s) supprimée(s)`);
    res.json({ ok: true, strategy: stratKey, deleted });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── Effacement ciblé des prédictions UNIQUEMENT (bouton manuel) ──
// Supprime : predictions + tg_pred_messages
// Libère   : pending en mémoire moteur (déblocage immédiat)
// NE touche PAS aux configs : custom_strategies, telegram_config, users,
// strategy_channel_routes, settings, canaux, tokens, durées.
// Identique au reset automatique jeu #1.
router.post('/clear-predictions', requireAdmin, async (req, res) => {
  try {
    const eng = require('./engine');
    const { deleted, extDeleted } = await eng.fullReset();
    console.log(`[Admin] Reset complet — local: ${deleted}, render: ${extDeleted}`);
    res.json({ ok: true, deleted, extDeleted });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── Nettoyage complet des prédictions (sans toucher aux configs) ──
// Supprime : predictions, tg_pred_messages
// Remet à 0 : engine_absences, bilan_last, pending en mémoire, compteurs absences moteur
// Conserve : users, telegram_config, strategy_channel_routes, custom_strategies,
//            tg_msg_format, ui_styles, sessions, render_db_url, broadcast_message
router.post('/reset-all-stats', requireAdmin, async (req, res) => {
  try {
    const pool = db.pool;
    const eng  = require('./engine');
    // fullReset = même chose que jeu #1 : predictions + tg_pred_messages + Render + mémoire moteur
    const { deleted, extDeleted } = await eng.fullReset();
    // Remettre les compteurs d'absences à zéro (engine_absences)
    const SUITS = ['♠','♥','♦','♣'];
    const zero  = Object.fromEntries(SUITS.map(s => [s, 0]));
    const absReset = JSON.stringify({ c1: {...zero}, c2: {...zero}, c3: {...zero} });
    await pool.query(`INSERT INTO settings(key,value) VALUES('engine_absences',$1)
      ON CONFLICT(key) DO UPDATE SET value=EXCLUDED.value`, [absReset]).catch(() => {});
    // Supprimer le bilan quotidien (obsolète sans prédictions)
    await pool.query(`DELETE FROM settings WHERE key='bilan_last'`).catch(() => {});
    if (eng.resetAbsences) eng.resetAbsences();
    console.log(`[Admin] Reset-all-stats — ${deleted} supprimée(s), absences remises à 0`);
    res.json({ ok: true, deleted, extDeleted, details: {
      predictions_deleted: deleted,
      render_deleted: extDeleted,
      tg_messages_cleared: true,
      absences_reset: true,
      bilan_cleared: true,
      configs_preserved: ['users','telegram_config','custom_strategies','tg_msg_format','ui_styles','render_db_url'],
    }});
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

// ── Statut en temps réel des compteurs relance ────────────────────
router.get('/relance-status', requireAdmin, (req, res) => {
  try {
    const engine = require('./engine');
    res.json(typeof engine.getRelanceStatus === 'function' ? engine.getRelanceStatus() : {});
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── Format des messages Telegram ──────────────────────────────────
router.get('/msg-format', requireAdmin, async (req, res) => {
  try {
    const v = await db.getSetting('tg_msg_format');
    res.json({ format_id: parseInt(v) || 1 });
  } catch (e) { res.status(500).json({ error: 'Erreur serveur' }); }
});

// ── BOT ADMIN TG ID (commandes bot distantes) ──────────────────────
router.get('/bot-admin-tg-id', requireAdmin, async (req, res) => {
  try {
    const v = await db.getSetting('bot_admin_tg_id');
    res.json({ bot_admin_tg_id: v || '' });
  } catch (e) { res.status(500).json({ error: 'Erreur serveur' }); }
});

router.post('/bot-admin-tg-id', requireAdmin, async (req, res) => {
  const { bot_admin_tg_id } = req.body;
  if (!bot_admin_tg_id && bot_admin_tg_id !== '')
    return res.status(400).json({ error: 'bot_admin_tg_id requis' });
  try {
    await db.setSetting('bot_admin_tg_id', String(bot_admin_tg_id).trim());
    res.json({ ok: true, bot_admin_tg_id: String(bot_admin_tg_id).trim() });
  } catch (e) { res.status(500).json({ error: 'Erreur serveur' }); }
});

// ── APPLY UPDATE INLINE (sans fichier sur serveur) ──────────────────
// Permet d'appliquer une mise à jour directement via JSON en body.
// Usage: POST /api/admin/apply-update-inline
// Body: { "type": "format", "data": { "format_id": 3 } }
// Ou:   { "type": "strategies", "data": [...] }
// Ou:   { "blocks": [{ "type": "...", "data": {...} }, ...] }
router.post('/apply-update-inline', requireAdmin, async (req, res) => {
  try {
    const body = req.body;
    if (!body || typeof body !== 'object')
      return res.status(400).json({ error: 'Body JSON invalide' });
    const results = [];
    if (Array.isArray(body.blocks)) {
      for (const b of body.blocks) results.push(await applyUpdateBlock(b.type, b.data));
    } else if (body.type) {
      results.push(await applyUpdateBlock(body.type, body.data));
    } else {
      return res.status(400).json({ error: 'Champ "type" ou "blocks" requis' });
    }
    const allOk = results.every(r => r.errors.length === 0);
    res.json({ ok: allOk, results });
  } catch (e) {
    console.error('[apply-update-inline] Error:', e.message);
    res.status(500).json({ error: e.message });
  }
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
  if (!id || id < 1 || id > 10) return res.status(400).json({ error: "Format invalide (1–10)" });
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
  '--color-primary', '--color-secondary', '--color-danger', '--color-success',
  '--color-warning', '--color-info', '--color-surface', '--color-overlay',
  '--shadow-card', '--shadow-btn', '--transition-base',
  '--navbar-bg', '--navbar-border', '--navbar-text',
];

async function applyUpdateBlock(type, data) {
  const result = { type, applied: 0, errors: [] };

  // ── CSS personnalisé injecté dynamiquement (sans rebuild) ──────────
  if (type === 'css') {
    const css = data?.css;
    if (!css || typeof css !== 'string') { result.errors.push('data.css doit être une chaîne CSS valide'); return result; }
    const mode = data?.mode || 'replace'; // 'replace' | 'append'
    let stored = '';
    if (mode === 'append') {
      const existing = await db.getSetting('custom_css');
      stored = (existing || '') + '\n\n' + css;
    } else {
      stored = css;
    }
    await db.setSetting('custom_css', stored);
    result.applied = 1;
    result.detail = `CSS personnalisé ${mode === 'append' ? 'ajouté (append)' : 'remplacé'} — ${css.length} caractères — appliqué instantanément sans rebuild`;
    return result;
  }

  if (type === 'format') {
    const id = parseInt(data?.format_id);
    if (!id || id < 1 || id > 10) { result.errors.push(`format_id invalide (1–10)`); return result; }
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
          tg_format: (item.tg_format !== undefined && item.tg_format !== '') ? Math.max(1, Math.min(11, parseInt(item.tg_format) || 1)) : null,
        };
        result.detail = (result.detail || '') + `\n• Mise à jour: "${item.name.trim()}"`;
      } else {
        const nextId = list.length > 0 ? Math.max(...list.map(s => s.id)) + 1 : 7;
        const isCombJson    = item.strategy_type === 'combinaison';
        const isRelanceJson = item.mode === 'relance';
        const isAleatJson   = item.mode === 'aleatoire';
        list.push({
          id: nextId,
          name: item.name.trim(),
          strategy_type: isCombJson ? 'combinaison' : 'simple',
          mode: isCombJson ? 'multi_strategy' : item.mode,
          threshold: (isAleatJson || isCombJson || isRelanceJson) ? 0 : (parseInt(item.threshold) || 0),
          mappings: (isCombJson || isRelanceJson || isAleatJson) ? null : mappings,
          multi_source_ids: isCombJson ? (Array.isArray(item.multi_source_ids) ? item.multi_source_ids.map(String) : []) : undefined,
          multi_require: isCombJson ? (item.multi_require || 'any') : undefined,
          relance_rules: isRelanceJson ? (Array.isArray(item.relance_rules) ? item.relance_rules : []) : undefined,
          visibility: item.visibility || 'admin',
          enabled: item.enabled !== false,
          tg_targets,
          exceptions,
          prediction_offset: Math.max(1, parseInt(item.prediction_offset) || 1),
          hand: item.hand === 'banquier' ? 'banquier' : 'joueur',
          loss_type: ['sec', 'rattrapage', 'martingale'].includes(item.loss_type) ? item.loss_type : 'rattrapage',
          max_rattrapage: (item.max_rattrapage !== undefined && item.max_rattrapage !== '') ? Math.max(0, parseInt(item.max_rattrapage) || 0) : null,
          tg_format: (item.tg_format !== undefined && item.tg_format !== '') ? Math.max(1, Math.min(11, parseInt(item.tg_format) || 1)) : null,
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

  // ── Annonces Telegram planifiées ──────────────────────────────────
  if (type === 'announcements') {
    if (!Array.isArray(data)) { result.errors.push('data doit être un tableau d\'annonces'); return result; }
    const current = JSON.parse(await db.getSetting('tg_announcements') || '[]');
    for (const item of data) {
      if (!item.name || !item.bot_token || !item.channel_id) { result.errors.push(`Annonce "${item.name || '?'}": name, bot_token et channel_id requis`); continue; }
      const existing = current.findIndex(a => a.id === item.id || a.name === item.name);
      if (existing >= 0) {
        current[existing] = { ...current[existing], ...item };
        result.detail = (result.detail || '') + `\n• Mise à jour annonce: "${item.name}"`;
      } else {
        current.push({ ...item, id: item.id || Date.now() + result.applied });
        result.detail = (result.detail || '') + `\n• Créée annonce: "${item.name}"`;
      }
      result.applied++;
    }
    await db.setSetting('tg_announcements', JSON.stringify(current));
    return result;
  }

  // ── Canaux Telegram par défaut (C1/C2/C3/DC) ──────────────────────
  if (type === 'default_tg') {
    if (!data || typeof data !== 'object' || Array.isArray(data)) { result.errors.push('data doit être un objet { C1:{...}, C2:{...}, ... }'); return result; }
    const valid = ['C1','C2','C3','DC'];
    const current = JSON.parse(await db.getSetting('default_strategies_tg') || '{}');
    for (const [key, val] of Object.entries(data)) {
      if (!valid.includes(key)) { result.errors.push(`Clé inconnue: ${key} (valides: C1, C2, C3, DC)`); continue; }
      if (!val.bot_token || !val.channel_id) { result.errors.push(`Canal ${key}: bot_token et channel_id requis`); continue; }
      current[key] = { bot_token: val.bot_token.trim(), channel_id: val.channel_id.trim(), tg_format: val.tg_format ?? null };
      result.applied++;
      result.detail = (result.detail || '') + `\n• Canal ${key} mis à jour`;
    }
    await db.setSetting('default_strategies_tg', JSON.stringify(current));
    return result;
  }

  // ── Clés API IA (Espace Programmation) ────────────────────────────
  if (type === 'prog_ai_keys') {
    if (!Array.isArray(data)) { result.errors.push('data doit être un tableau de clés API'); return result; }
    const current = JSON.parse(await db.getSetting('prog_ai_keys') || '[]');
    for (const item of data) {
      if (!item.provider || !item.key) { result.errors.push(`Clé "${item.provider || '?'}": provider et key requis`); continue; }
      const existing = current.findIndex(k => k.provider === item.provider && k.label === item.label);
      if (existing >= 0) {
        current[existing] = { ...current[existing], ...item };
        result.detail = (result.detail || '') + `\n• Mise à jour clé: ${item.provider} / ${item.label || ''}`;
      } else {
        current.push({ ...item, id: item.id || Date.now() + result.applied });
        result.detail = (result.detail || '') + `\n• Ajouté clé: ${item.provider} / ${item.label || ''}`;
      }
      result.applied++;
    }
    await db.setSetting('prog_ai_keys', JSON.stringify(current));
    return result;
  }

  // ── Bots Programmation ────────────────────────────────────────────
  if (type === 'prog_bots') {
    if (!Array.isArray(data)) { result.errors.push('data doit être un tableau de bots'); return result; }
    const current = JSON.parse(await db.getSetting('prog_bots') || '[]');
    for (const item of data) {
      if (!item.name) { result.errors.push(`Bot sans nom ignoré`); continue; }
      const existing = current.findIndex(b => b.id === item.id || b.name === item.name);
      if (existing >= 0) {
        current[existing] = { ...current[existing], ...item };
        result.detail = (result.detail || '') + `\n• Mise à jour bot: "${item.name}"`;
      } else {
        current.push({ ...item, id: item.id || Date.now() + result.applied });
        result.detail = (result.detail || '') + `\n• Créé bot: "${item.name}"`;
      }
      result.applied++;
    }
    await db.setSetting('prog_bots', JSON.stringify(current));
    return result;
  }

  // ── Canaux Telegram personnalisés (table telegram_config) ────────────
  if (type === 'telegram_channels') {
    if (!Array.isArray(data)) { result.errors.push('data doit être un tableau de canaux Telegram'); return result; }
    for (const item of data) {
      if (!item.channel_id) { result.errors.push(`Canal sans channel_id ignoré`); continue; }
      await db.upsertTelegramConfig({ channel_id: item.channel_id, channel_name: item.channel_name || item.channel_id });
      result.applied++;
      result.detail = (result.detail || '') + `\n• Canal: ${item.channel_name || item.channel_id}`;
    }
    return result;
  }

  // ── Messages utilisateurs in-app ───────────────────────────────────
  if (type === 'user_messages') {
    if (!Array.isArray(data)) { result.errors.push('data doit être un tableau de messages'); return result; }
    await db.setSetting('user_messages', JSON.stringify(data));
    result.applied = data.length;
    result.detail = `${data.length} message(s) utilisateurs restaurés`;
    return result;
  }

  // ── Message de diffusion (broadcast) ─────────────────────────────
  if (type === 'broadcast_message') {
    if (!data || typeof data !== 'object') { result.errors.push('data doit être un objet { text, enabled, targets }'); return result; }
    await db.setSetting('broadcast_message', JSON.stringify(data));
    result.applied = 1;
    result.detail = `Message broadcast restauré (enabled: ${data.enabled})`;
    return result;
  }

  // ── Config bot de chat Telegram ───────────────────────────────────
  if (type === 'telegram_chat') {
    if (!data || typeof data !== 'object') { result.errors.push('data doit être un objet { bot_token, channel_id }'); return result; }
    await db.setSetting('telegram_chat_config', JSON.stringify(data));
    result.applied = 1;
    result.detail = `Config chat Telegram restaurée (channel: ${data.channel_id || '?'})`;
    return result;
  }

  // ── Vidéos tutoriels ──────────────────────────────────────────────
  if (type === 'tutorial_videos') {
    if (!data || typeof data !== 'object') { result.errors.push('data doit être un objet { video1, video2 }'); return result; }
    await db.setSetting('tutorial_videos', JSON.stringify({ video1: data.video1 || null, video2: data.video2 || null }));
    result.applied = 1;
    result.detail = `Vidéos tutoriels restaurées`;
    return result;
  }

  // ── Bilan dernière journée ────────────────────────────────────────
  if (type === 'bilan_last') {
    if (!data || typeof data !== 'object') { result.errors.push('data doit être un objet bilan'); return result; }
    await db.setSetting('bilan_last', JSON.stringify(data));
    result.applied = 1;
    result.detail = `Bilan restauré (date: ${data.date || '?'})`;
    return result;
  }

  // ── État moteur (compteurs d'absences) ────────────────────────────
  if (type === 'engine_absences') {
    if (!data || typeof data !== 'object') { result.errors.push('data doit être un objet absences'); return result; }
    await db.setSetting('engine_absences', JSON.stringify(data));
    result.applied = 1;
    result.detail = `Compteurs d'absences restaurés`;
    return result;
  }

  // ── Paramètres globaux bruts ──────────────────────────────────────
  if (type === 'raw_settings') {
    if (!data || typeof data !== 'object') { result.errors.push('data doit être un objet clé→valeur'); return result; }
    const allowed = ['max_rattrapage', 'tg_msg_format', 'render_external_url', 'render_db_url', 'bot_token'];
    for (const [key, val] of Object.entries(data)) {
      if (!allowed.includes(key)) { result.errors.push(`Paramètre "${key}" non autorisé (valides: ${allowed.join(', ')})`); continue; }
      if (val !== null && val !== undefined) {
        await db.setSetting(key, String(val));
        result.applied++;
        result.detail = (result.detail || '') + `\n• ${key} = ${key.includes('token') || key.includes('url') ? '***' : val}`;
      }
    }
    return result;
  }

  // ── Import d'un export complet (full_config v3.0) ─────────────────
  if (type === 'full_config') {
    const blocks = [];
    if (Array.isArray(data.strategies)        && data.strategies.length)
      blocks.push({ type: 'strategies',        data: data.strategies });
    if (Array.isArray(data.sequences)          && data.sequences.length)
      blocks.push({ type: 'sequences',         data: data.sequences });
    if (Array.isArray(data.announcements)      && data.announcements.length)
      blocks.push({ type: 'announcements',     data: data.announcements });
    if (Array.isArray(data.prog_ai_keys)       && data.prog_ai_keys.length)
      blocks.push({ type: 'prog_ai_keys',      data: data.prog_ai_keys });
    if (Array.isArray(data.prog_bots)          && data.prog_bots.length)
      blocks.push({ type: 'prog_bots',         data: data.prog_bots });
    if (Array.isArray(data.telegram_channels)  && data.telegram_channels.length)
      blocks.push({ type: 'telegram_channels', data: data.telegram_channels });
    if (Array.isArray(data.user_messages)      && data.user_messages.length)
      blocks.push({ type: 'user_messages',     data: data.user_messages });
    if (data.default_tg && Object.keys(data.default_tg).length)
      blocks.push({ type: 'default_tg',        data: data.default_tg });
    if (data.telegram_chat && data.telegram_chat.bot_token)
      blocks.push({ type: 'telegram_chat',     data: data.telegram_chat });
    if (data.broadcast_message && data.broadcast_message.text)
      blocks.push({ type: 'broadcast_message', data: data.broadcast_message });
    if (data.ui?.tutorial_videos)
      blocks.push({ type: 'tutorial_videos',   data: data.ui.tutorial_videos });
    if (data.ui?.custom_css)
      blocks.push({ type: 'css',               data: { css: data.ui.custom_css } });
    if (data.ui?.ui_styles && Object.keys(data.ui.ui_styles).length)
      blocks.push({ type: 'styles',            data: data.ui.ui_styles });
    if (data.settings?.tg_msg_format)
      blocks.push({ type: 'format',            data: { format_id: data.settings.tg_msg_format } });
    // Paramètres bruts (render_db_url, bot_token, etc.)
    const rawKeys = ['max_rattrapage', 'render_external_url', 'render_db_url', 'bot_token'];
    const rawData = {};
    for (const k of rawKeys) { if (data.settings?.[k]) rawData[k] = data.settings[k]; }
    if (Object.keys(rawData).length) blocks.push({ type: 'raw_settings', data: rawData });
    // État moteur & bilan
    if (data.bilan_last      && typeof data.bilan_last === 'object')
      blocks.push({ type: 'bilan_last',      data: data.bilan_last });
    if (data.engine_absences && typeof data.engine_absences === 'object')
      blocks.push({ type: 'engine_absences', data: data.engine_absences });

    const subResults = [];
    for (const b of blocks) subResults.push(await applyUpdateBlock(b.type, b.data));
    result.applied = subResults.reduce((s, r) => s + r.applied, 0);
    result.errors  = subResults.flatMap(r => r.errors);
    result.detail  = subResults.map(r => `[${r.type}] ${r.detail || ''}`.trim()).filter(Boolean).join('\n');
    return result;
  }

  result.errors.push(`Type "${type}" inconnu. Types valides: format, strategies, sequences, styles, code, announcements, default_tg, prog_ai_keys, prog_bots, telegram_channels, user_messages, broadcast_message, telegram_chat, tutorial_videos, bilan_last, engine_absences, raw_settings, full_config, multi`);
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

// ── Liste des fichiers JSON de mise à jour stockés sur le serveur ────
const EXCLUDE_JSON_FILES = new Set(['package.json', 'package-lock.json', 'railway.json', 'tsconfig.json', 'jsconfig.json']);
router.get('/server-update-files', requireAdmin, (req, res) => {
  try {
    const rootDir = path.join(__dirname);
    const entries = fs.readdirSync(rootDir);
    const files = entries
      .filter(f => f.endsWith('.json') && !EXCLUDE_JSON_FILES.has(f))
      .map(f => {
        try {
          const stat = fs.statSync(path.join(rootDir, f));
          let preview = null;
          try {
            const raw = fs.readFileSync(path.join(rootDir, f), 'utf8');
            const parsed = JSON.parse(raw);
            preview = parsed?._meta?.description || parsed?._meta?.version
              ? `v${parsed._meta.version || '?'} — ${parsed._meta.description || ''}`
              : (parsed?.type ? `Type: ${parsed.type}` : null);
          } catch { preview = null; }
          return { name: f, size: stat.size, mtime: stat.mtime.toISOString(), preview };
        } catch { return null; }
      })
      .filter(Boolean)
      .sort((a, b) => new Date(b.mtime) - new Date(a.mtime));
    res.json({ files });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── Appliquer un fichier JSON de mise à jour depuis le serveur ────────
router.post('/apply-server-update', requireAdmin, async (req, res) => {
  try {
    const { filename } = req.body;
    if (!filename || typeof filename !== 'string') return res.status(400).json({ error: 'Nom de fichier requis' });
    // Sécurité : interdire les traversées de répertoire
    if (filename.includes('/') || filename.includes('\\') || filename.includes('..')) {
      return res.status(400).json({ error: 'Nom de fichier invalide' });
    }
    if (EXCLUDE_JSON_FILES.has(filename)) return res.status(400).json({ error: 'Ce fichier ne peut pas être appliqué' });
    const filePath = path.join(__dirname, filename);
    if (!fs.existsSync(filePath)) return res.status(404).json({ error: `Fichier "${filename}" introuvable` });

    let parsed;
    try {
      parsed = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    } catch { return res.status(400).json({ error: 'Fichier JSON invalide — vérifiez la syntaxe' }); }

    const { type, data } = parsed;
    if (!type) return res.status(400).json({ error: 'Champ "type" manquant dans le fichier' });

    const results = [];
    if (type === 'multi') {
      if (!Array.isArray(data)) return res.status(400).json({ error: 'Pour type "multi", data doit être un tableau' });
      for (const block of data) {
        if (!block.type || !block.data) { results.push({ type: block.type || '?', applied: 0, errors: ['Bloc invalide'] }); continue; }
        results.push(await applyUpdateBlock(block.type, block.data));
      }
    } else {
      results.push(await applyUpdateBlock(type, data));
    }

    const totalApplied = results.reduce((s, r) => s + r.applied, 0);
    const allErrors    = results.flatMap(r => r.errors);
    res.json({ ok: allErrors.length === 0 || totalApplied > 0, results, total_applied: totalApplied, errors: allErrors, filename });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── Export complet de la configuration du projet en JSON ────────────
router.get('/export-config', requireAdmin, async (req, res) => {
  try {
    // ── Stratégies & routes ────────────────────────────────────────────
    const strategies       = await getStrategies();
    const channels         = await db.getAllStrategyRoutes().catch(() => ({}));
    const tgChannels       = await db.getTelegramConfigs(false).catch(() => []);

    // ── Paramètres globaux ─────────────────────────────────────────────
    const tgFormat         = await db.getSetting('tg_msg_format');
    const maxRattrDB       = await db.getSetting('max_rattrapage');
    const renderUrl        = await db.getSetting('render_external_url');
    const renderDbUrl      = await db.getSetting('render_db_url');
    const botToken         = await db.getSetting('bot_token');

    // ── Telegram ───────────────────────────────────────────────────────
    const defaultTg        = await db.getSetting('default_strategies_tg');
    const announcements    = await db.getSetting('tg_announcements');
    const tgChatConfig     = await db.getSetting('telegram_chat_config');

    // ── UI ─────────────────────────────────────────────────────────────
    const customCss        = await db.getSetting('custom_css');
    const uiStyles         = await db.getSetting('ui_styles');
    const tutorialVideos   = await db.getSetting('tutorial_videos');

    // ── Séquences & messages ───────────────────────────────────────────
    const sequences        = await db.getSetting('loss_sequences');
    const userMessages     = await db.getSetting('user_messages');
    const broadcastMessage = await db.getSetting('broadcast_message');

    // ── Espace Programmation ───────────────────────────────────────────
    const progAiKeys       = await db.getSetting('prog_ai_keys');
    const progBots         = await db.getSetting('prog_bots');

    // ── État moteur & bilan ────────────────────────────────────────────
    const bilanLast        = await db.getSetting('bilan_last');
    const engineAbsences   = await db.getSetting('engine_absences');

    const safeParse = (v, fallback) => { try { return v ? JSON.parse(v) : fallback; } catch { return fallback; } };

    const payload = {
      _meta: {
        version: '3.1',
        exported_at: new Date().toISOString(),
        project: 'Baccarat Pro',
        description: 'Export COMPLET de la configuration — peut être réimporté via /admin/apply-update',
      },

      // ── Stratégies ───────────────────────────────────────────────────
      strategies,
      channels,
      telegram_channels: tgChannels,

      // ── Paramètres ───────────────────────────────────────────────────
      settings: {
        tg_msg_format:       parseInt(tgFormat)  || 1,
        max_rattrapage:      parseInt(maxRattrDB) || 2,
        render_external_url: renderUrl  || null,
        render_db_url:       renderDbUrl || null,
        bot_token:           botToken   || null,
      },

      // ── Telegram ─────────────────────────────────────────────────────
      default_tg:       safeParse(defaultTg,        {}),
      announcements:    safeParse(announcements,     []),
      telegram_chat:    safeParse(tgChatConfig,      {}),

      // ── Séquences ────────────────────────────────────────────────────
      sequences:        safeParse(sequences,         []),

      // ── UI ───────────────────────────────────────────────────────────
      ui: {
        custom_css:      customCss || '',
        ui_styles:       safeParse(uiStyles,        {}),
        tutorial_videos: safeParse(tutorialVideos,  { video1: null, video2: null }),
      },

      // ── Messages utilisateurs ─────────────────────────────────────────
      user_messages:    safeParse(userMessages,      []),
      broadcast_message: safeParse(broadcastMessage, null),

      // ── Espace Programmation ─────────────────────────────────────────
      prog_ai_keys: safeParse(progAiKeys, []),
      prog_bots:    safeParse(progBots,   []),

      // ── État moteur & bilan ───────────────────────────────────────────
      bilan_last:       safeParse(bilanLast,       null),
      engine_absences:  safeParse(engineAbsences,  null),
    };

    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Content-Disposition', `attachment; filename="baccarat-pro-config-${new Date().toISOString().slice(0,10)}.json"`);
    res.json(payload);
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

// ── CSS personnalisé (admin) ─────────────────────────────────────────
router.get('/custom-css', requireAdmin, async (req, res) => {
  try {
    const raw = await db.getSetting('custom_css');
    res.json({ css: raw || '', length: (raw || '').length });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.delete('/custom-css', requireAdmin, async (req, res) => {
  try {
    await db.deleteSetting('custom_css');
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

// ── Restauration COMPLÈTE du système (tous les .bak + CSS + styles) ─
router.post('/restore-all', requireAdmin, async (req, res) => {
  try {
    const restored = [];
    let needsRebuild = false;

    // 1. Restaurer tous les fichiers .bak
    function scanAndRestore(dir) {
      if (!fs.existsSync(dir)) return;
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory() && !['node_modules', '.git', 'dist'].includes(entry.name)) {
          scanAndRestore(full);
        } else if (entry.isFile() && entry.name.endsWith('.bak')) {
          const orig = full.slice(0, -4);
          try {
            fs.copyFileSync(full, orig);
            fs.unlinkSync(full);
            const rel = path.relative(PROJECT_ROOT, orig);
            restored.push(rel);
            if (rel.startsWith('src/') || rel.endsWith('.js')) needsRebuild = true;
          } catch {}
        }
      }
    }
    scanAndRestore(PROJECT_ROOT);

    // 2. Supprimer le CSS personnalisé
    await db.deleteSetting('custom_css').catch(() => {});

    // 3. Réinitialiser les styles CSS
    await db.setSetting('ui_styles', '{}').catch(() => {});

    // 4. Déclencher un rebuild si des fichiers source ont été restaurés
    if (needsRebuild) {
      const { exec } = require('child_process');
      exec('npx vite build', { cwd: PROJECT_ROOT }, (err) => {
        if (err) console.error('[RestoreAll] rebuild error:', err.message);
        else console.log('[RestoreAll] Rebuild terminé');
      });
    }

    res.json({ ok: true, restored, needsRebuild, css_cleared: true, styles_reset: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
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

router.get('/user-messages', requireSuperAdmin, async (req, res) => {
  try {
    const raw = await db.getSetting('user_messages');
    res.json(raw ? JSON.parse(raw) : []);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.post('/user-messages/:id/read', requireSuperAdmin, async (req, res) => {
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

router.post('/user-messages/:id/reply', requireSuperAdmin, async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    const { text } = req.body;
    if (!text || !String(text).trim()) return res.status(400).json({ error: 'Réponse vide' });
    const raw = await db.getSetting('user_messages');
    const messages = raw ? JSON.parse(raw) : [];
    const msg = messages.find(m => m.id === id);
    if (!msg) return res.status(404).json({ error: 'Message non trouvé' });
    msg.admin_reply = { text: String(text).trim().slice(0, 1000), date: new Date().toISOString() };
    msg.read = true;
    await db.setSetting('user_messages', JSON.stringify(messages));
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.delete('/user-messages/:id', requireSuperAdmin, async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    const raw = await db.getSetting('user_messages');
    const messages = (raw ? JSON.parse(raw) : []).filter(m => m.id !== id);
    await db.setSetting('user_messages', JSON.stringify(messages));
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.delete('/user-messages', requireSuperAdmin, async (req, res) => {
  try {
    await db.deleteSetting('user_messages');
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── MESSAGE BROADCAST (Accueil utilisateurs) ────────────────────────

router.get('/broadcast-message', requireSuperAdmin, async (req, res) => {
  try {
    const raw = await db.getSetting('broadcast_message');
    res.json(raw ? JSON.parse(raw) : { enabled: false, text: '', targets: ['pending', 'active', 'expired'] });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.post('/broadcast-message', requireSuperAdmin, async (req, res) => {
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

router.delete('/broadcast-message', requireSuperAdmin, async (req, res) => {
  try {
    await db.deleteSetting('broadcast_message');
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── BASE EXTERNE RENDER ─────────────────────────────────────────────

router.get('/render-db', requireSuperAdmin, async (req, res) => {
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

router.post('/render-db/test', requireSuperAdmin, async (req, res) => {
  try {
    const { url } = req.body;
    if (!url || !url.trim()) return res.status(400).json({ error: 'URL manquante' });
    const renderSync = require('./render-sync');
    const result = await renderSync.testConnection(url.trim());
    res.json(result);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.post('/render-db', requireSuperAdmin, async (req, res) => {
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

router.delete('/render-db', requireSuperAdmin, async (req, res) => {
  try {
    await db.deleteSetting('render_db_url');
    const renderSync = require('./render-sync');
    await renderSync.loadRenderUrl();
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.post('/render-db/reset', requireSuperAdmin, async (req, res) => {
  try {
    const renderSync = require('./render-sync');
    if (!renderSync.isConnected()) return res.status(400).json({ error: 'Base Render non connectée' });
    await renderSync.handleGameOne(1);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── Reset complet (retour usine) ─────────────────────────────────────────────
router.post('/factory-reset', requireSuperAdmin, async (req, res) => {
  try {
    const pool = db.getPool ? db.getPool() : db.pool;
    await pool.query(`TRUNCATE predictions, tg_pred_messages, strategy_channel_routes, user_channel_hidden, user_channel_visible, user_strategy_visible RESTART IDENTITY CASCADE`);
    await pool.query(`DELETE FROM telegram_config`);
    const settingsToReset = [
      'custom_strategies', 'loss_sequences', 'relance_rules',
      'max_rattrapage', 'tg_msg_format', 'default_strategies_tg',
      'tg_announcements', 'telegram_chat_config', 'engine_absences',
      'broadcast_message',
    ];
    for (const key of settingsToReset) {
      await pool.query(`DELETE FROM settings WHERE key = $1`, [key]);
    }
    const engine = require('./engine');
    if (engine.instance) {
      engine.instance.strategies = [];
      engine.instance.relanceSequences = [];
      engine.instance.relanceCondCounters = {};
      engine.instance.predictions = {};
      engine.instance.pendingPredictions = {};
      if (engine.instance.counterState) {
        engine.instance.counterState = { c1: {}, c2: {}, c3: {} };
      }
    }
    _tgChat.messages = [];
    _tgChat.offset = 0;
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── Telegram Canal Direct ───────────────────────────────────────────────────
const _tgChat = { messages: [], offset: 0 };

async function _fetchTgUpdates(token, channelId) {
  try {
    const url = `https://api.telegram.org/bot${token}/getUpdates?offset=${_tgChat.offset}&allowed_updates=%5B%22channel_post%22%5D&limit=100`;
    const resp = await fetch(url);
    const data = await resp.json();
    if (!data.ok) return { error: data.description };
    for (const upd of (data.result || [])) {
      _tgChat.offset = upd.update_id + 1;
      const msg = upd.channel_post;
      if (!msg) continue;
      _tgChat.messages.push({
        id: msg.message_id,
        from: msg.author_signature || msg.chat?.title || 'Canal',
        isBot: false,
        text: msg.text || msg.caption || '[média]',
        date: new Date(msg.date * 1000).toISOString(),
      });
      if (_tgChat.messages.length > 150) _tgChat.messages.shift();
    }
    return { ok: true };
  } catch (e) { return { error: e.message }; }
}

router.get('/telegram-chat/config', requireAdmin, async (req, res) => {
  try {
    const raw = await db.getSetting('telegram_chat_config');
    res.json(raw ? JSON.parse(raw) : { bot_token: '', channel_id: '' });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.post('/telegram-chat/config', requireAdmin, async (req, res) => {
  try {
    const { bot_token, channel_id } = req.body;
    const cfg = { bot_token: (bot_token || '').trim(), channel_id: (channel_id || '').trim() };
    if (cfg.bot_token) {
      const testResp = await fetch(`https://api.telegram.org/bot${cfg.bot_token}/getMe`);
      const testData = await testResp.json();
      if (!testData.ok) return res.status(400).json({ error: 'Token invalide : ' + (testData.description || 'erreur') });
      cfg.bot_username = testData.result?.username || '';
    }
    const cfgStr = JSON.stringify(cfg);
    await db.setSetting('telegram_chat_config', cfgStr);
    // Sync vers la base Render
    try { require('./render-sync').syncSetting('telegram_chat_config', cfgStr).catch(() => {}); } catch {}
    _tgChat.messages = [];
    _tgChat.offset   = 0;
    res.json({ ok: true, bot_username: cfg.bot_username });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.delete('/telegram-chat/config', requireAdmin, async (req, res) => {
  try {
    await db.setSetting('telegram_chat_config', '');
    // Sync suppression vers la base Render
    try { require('./render-sync').syncSetting('telegram_chat_config', '').catch(() => {}); } catch {}
    _tgChat.messages = [];
    _tgChat.offset   = 0;
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.get('/telegram-chat/messages', requireAdmin, async (req, res) => {
  try {
    const raw = await db.getSetting('telegram_chat_config');
    const cfg = raw ? JSON.parse(raw) : {};
    const configured = !!(cfg.bot_token && cfg.channel_id);
    if (configured) await _fetchTgUpdates(cfg.bot_token, cfg.channel_id);
    res.json({ messages: _tgChat.messages, configured, bot_username: cfg.bot_username || '' });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.post('/telegram-chat/send', requireAdmin, async (req, res) => {
  try {
    const raw = await db.getSetting('telegram_chat_config');
    const cfg = raw ? JSON.parse(raw) : {};
    if (!cfg.bot_token || !cfg.channel_id) return res.status(400).json({ error: 'Bot non configuré' });
    const { text } = req.body;
    if (!text?.trim()) return res.status(400).json({ error: 'Message vide' });
    const resp = await fetch(`https://api.telegram.org/bot${cfg.bot_token}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: cfg.channel_id, text: text.trim(), parse_mode: 'HTML', disable_web_page_preview: true }),
    });
    const data = await resp.json();
    if (!data.ok) return res.status(400).json({ error: data.description || 'Erreur Telegram' });
    _tgChat.messages.push({
      id: data.result?.message_id || Date.now(),
      from: 'Vous (admin)',
      isBot: true,
      text: text.trim(),
      date: new Date().toISOString(),
    });
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── Stratégie Aléatoire : prédiction manuelle via le site ─────────────────────
router.get('/game-cards-cache', requireAdmin, (req, res) => {
  const engine = require('./engine');
  res.json(engine.gameCardsCache || {});
});

router.post('/strategies/:id/aleatoire-predict', requireAdmin, async (req, res) => {
  const stratId = parseInt(req.params.id);
  const { hand, game_number } = req.body;
  if (!['joueur', 'banquier'].includes(hand))
    return res.status(400).json({ error: 'Main invalide (joueur|banquier)' });
  const tgt = parseInt(game_number);
  if (isNaN(tgt) || tgt < 1 || tgt > 1440)
    return res.status(400).json({ error: 'Numéro invalide (1–1440)' });
  try {
    const strats = await getStrategies();
    const strat = strats.find(s => s.id === stratId);
    if (!strat) return res.status(404).json({ error: 'Stratégie introuvable' });
    if (strat.mode !== 'aleatoire') return res.status(400).json({ error: 'Stratégie non aléatoire' });

    const engine = require('./engine');

    const currentGameNumber = engine.liveGameCards?.gameNumber || null;
    if (currentGameNumber && tgt <= currentGameNumber)
      return res.status(400).json({ error: `Le numéro doit être supérieur au jeu en cours (#${currentGameNumber})` });

    try {
      const existing = await db.pool.query(
        `SELECT 1 FROM predictions WHERE strategy=$1 AND game_number=$2 LIMIT 1`,
        [stratId, tgt]
      );
      if (existing.rows.length > 0)
        return res.status(400).json({ error: `Une prédiction existe déjà pour le tour #${tgt}` });
    } catch {}

    let pool = [];
    let sourceGn = currentGameNumber;

    if (engine.liveGameCards) {
      pool = hand === 'banquier' ? (engine.liveGameCards.bankerSuits || []) : (engine.liveGameCards.playerSuits || []);
      sourceGn = engine.liveGameCards.gameNumber;
    }
    if (pool.length === 0) {
      const cacheKeys = Object.keys(engine.gameCardsCache).map(Number).sort((a, b) => b - a);
      for (const gn of cacheKeys) {
        const cached = engine.gameCardsCache[gn];
        const cards = hand === 'banquier' ? cached.banker : cached.player;
        if (cards && cards.length > 0) { pool = cards; sourceGn = gn; break; }
      }
    }
    if (pool.length === 0)
      return res.status(400).json({ error: 'Aucune carte disponible pour le jeu en cours. Attendez qu\'un jeu soit en cours.' });

    const count = pool.length <= 2 ? 1 : (Math.random() < 0.5 ? 1 : 2);
    const shuffled = [...pool].sort(() => Math.random() - 0.5);
    const chosen = shuffled.slice(0, count);
    const suit = chosen[0];

    const SUIT_EMOJI = { '♥': '❤️', '♣': '♣️', '♦': '♦️', '♠': '♠️' };

    const channelId = `S${stratId}`;
    await db.createPrediction({
      strategy: channelId,
      game_number: tgt,
      predicted_suit: suit,
      triggered_by: `aleatoire_web:${hand}:src${sourceGn}`,
    });

    const stratState = engine.custom?.[stratId];
    if (stratState) {
      stratState.pending[tgt] = { suit, rattrapage: 0 };
      if (stratState.config) stratState.config.hand = hand;
    }

    res.json({
      success: true,
      game_number: tgt,
      source_game: sourceGn,
      source_cards: pool,
      source_cards_emoji: pool.map(s => SUIT_EMOJI[s] || s),
      predicted_suit: suit,
      suit_emoji: SUIT_EMOJI[suit] || suit,
      hand,
      current_game: currentGameNumber,
    });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── MISE À JOUR PAR BASE DE DONNÉES ─────────────────────────────────

const EXCLUDED_DIRS  = ['node_modules', '.git', '.local', '.cache', '.npm', '.upm'];
const EXCLUDED_FILES = ['.env', 'package-lock.json'];
const INCLUDED_EXTS  = ['.js', '.jsx', '.ts', '.tsx', '.json', '.css', '.html', '.md', '.txt', '.sh', '.cjs', '.mjs'];
const MAX_FILE_SIZE  = 2 * 1024 * 1024; // 2 Mo max par fichier

function scanProjectFiles(dir, base) {
  const results = [];
  let entries;
  try { entries = fs.readdirSync(dir); } catch { return results; }
  for (const entry of entries) {
    if (EXCLUDED_DIRS.includes(entry)) continue;
    const fullPath = path.join(dir, entry);
    const relPath  = base ? `${base}/${entry}` : entry;
    let stat;
    try { stat = fs.statSync(fullPath); } catch { continue; }
    if (stat.isDirectory()) {
      results.push(...scanProjectFiles(fullPath, relPath));
    } else if (stat.isFile()) {
      if (EXCLUDED_FILES.includes(entry)) continue;
      const ext = path.extname(entry).toLowerCase();
      if (!INCLUDED_EXTS.includes(ext)) continue;
      if (stat.size > MAX_FILE_SIZE) continue;
      results.push({ fullPath, relPath, size: stat.size });
    }
  }
  return results;
}

// Scan dist/ (inclut .js .css .html .map + pas de limite d'ext)
function scanDistFiles(dir, base) {
  const results = [];
  let entries;
  try { entries = fs.readdirSync(dir); } catch { return results; }
  const DIST_EXTS = ['.js', '.css', '.html', '.map', '.ico', '.svg', '.png', '.woff', '.woff2', '.ttf'];
  for (const entry of entries) {
    const fullPath = path.join(dir, entry);
    const relPath  = base ? `${base}/${entry}` : entry;
    let stat;
    try { stat = fs.statSync(fullPath); } catch { continue; }
    if (stat.isDirectory()) {
      results.push(...scanDistFiles(fullPath, relPath));
    } else if (stat.isFile()) {
      const ext = path.extname(entry).toLowerCase();
      if (!DIST_EXTS.includes(ext)) continue;
      if (stat.size > 5 * 1024 * 1024) continue; // 5 Mo max
      results.push({ fullPath, relPath, size: stat.size });
    }
  }
  return results;
}

const DEPLOY_README = `# Baccarat Pro — Guide de déploiement

## Prérequis
- Node.js 18+
- PostgreSQL 14+

## Variables d'environnement requises (.env)
Créez un fichier \`.env\` à la racine avec les variables suivantes :
\`\`\`
DATABASE_URL=postgres://USER:PASSWORD@HOST:5432/DBNAME
SESSION_SECRET=votre_secret_session_ici
PORT=5000
NODE_ENV=production
\`\`\`

## Installation
\`\`\`bash
npm install
node index.js
\`\`\`

Le frontend est déjà compilé dans dist/.
Le serveur Express sert automatiquement les fichiers statiques depuis dist/.

## Telegram Bot
Chaque canal Telegram (token + chat_id) est configuré dans l'interface Admin.
Le bot fonctionne en mode polling — aucune configuration webhook nécessaire.

## Notes importantes
- Ne pas inclure .env dans git/zip
- La base de données doit être accessible depuis le serveur
- Port par défaut : 5000 (configurable via PORT)
`;

// Téléchargement du ZIP de déploiement (fichiers actuels sur disque)
router.get('/project-backup/zip', requireAdmin, (req, res) => {
  try {
    const archiver = require('archiver');
    const root     = path.join(__dirname);
    const files    = scanProjectFiles(root, '');
    const distDir  = path.join(root, 'dist');
    const distFiles = fs.existsSync(distDir) ? scanDistFiles(distDir, 'dist') : [];
    const date     = new Date().toISOString().slice(0, 10);
    const filename = `appolinaire-${date}.zip`;

    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);

    const archive = archiver('zip', { zlib: { level: 6 } });
    archive.on('error', (err) => { console.error('[ZIP]', err.message); res.end(); });
    archive.pipe(res);

    for (const f of files) {
      archive.file(f.fullPath, { name: f.relPath });
    }
    // Inclure les fichiers compilés du frontend
    for (const f of distFiles) {
      archive.file(f.fullPath, { name: f.relPath });
    }
    // Ajouter le guide de déploiement
    archive.append(DEPLOY_README, { name: 'DEPLOY.md' });

    archive.finalize();
    console.log(`[ZIP] Archive générée : ${files.length} src + ${distFiles.length} dist → ${filename}`);
  } catch (e) {
    console.error('[ZIP] Erreur:', e.message);
    res.status(500).json({ error: e.message });
  }
});

// ── ZIP de déploiement Render.com — léger, prêt à uploader (< 5 Mo) ──────────
// Inclut uniquement ce qui est nécessaire à l'exécution : sources serveur,
// dist/ compilé, package.json (sans lock), render.yaml + DEPLOY.md.
// Exclut : node_modules, .git, .env, attached_assets, *.map, logs, backups…
const RENDER_INCLUDE_ROOT_FILES = new Set([
  'package.json', 'index.js', 'admin.js', 'auth.js', 'engine.js', 'db.js',
  'games.js', 'render-sync.js', 'tg-history.js', 'tg-direct.js',
  'predictions.js', 'broadcast.js', 'render.yaml', '.nvmrc',
  'comptages.js',
]);
const RENDER_INCLUDE_DIRS = ['src', 'dist', 'public', 'scripts', 'middleware', 'utils', 'routes', 'lib'];
const RENDER_EXCLUDE_DIRS = new Set([
  'node_modules', '.git', '.local', '.cache', '.npm', '.upm', '.config',
  'attached_assets', 'screenshots', 'backups', 'tmp', 'logs', 'tests',
  '__tests__', 'coverage', '.replit', '.workflows', 'workflow_history',
]);
const RENDER_EXCLUDE_PATTERNS = [
  /\.env(\..*)?$/i, /\.log$/i, /\.tar\.gz$/i, /\.zip$/i, /\.map$/i,
  /\.DS_Store$/i, /^\._/, /\.bak$/i, /\.swp$/i, /~$/,
];

function _isExcludedRender(name) {
  return RENDER_EXCLUDE_PATTERNS.some(rx => rx.test(name));
}

function scanRenderFiles(dir, base) {
  const results = [];
  let entries;
  try { entries = fs.readdirSync(dir); } catch { return results; }
  for (const entry of entries) {
    if (RENDER_EXCLUDE_DIRS.has(entry)) continue;
    if (_isExcludedRender(entry)) continue;
    const fullPath = path.join(dir, entry);
    const relPath  = base ? `${base}/${entry}` : entry;
    let stat;
    try { stat = fs.statSync(fullPath); } catch { continue; }
    if (stat.isDirectory()) {
      results.push(...scanRenderFiles(fullPath, relPath));
    } else if (stat.isFile()) {
      if (stat.size > 3 * 1024 * 1024) continue; // skip > 3 Mo (assets lourds)
      results.push({ fullPath, relPath, size: stat.size });
    }
  }
  return results;
}

const RENDER_YAML = `services:
  - type: web
    name: baccarat-pro
    runtime: node
    plan: free
    buildCommand: npm install && npm run build
    startCommand: node index.js
    envVars:
      - key: NODE_ENV
        value: production
      - key: PORT
        value: 5000
      - key: DATABASE_URL
        sync: false
      - key: SESSION_SECRET
        generateValue: true
    healthCheckPath: /
    autoDeploy: false
`;

const DEPLOY_RENDER_README = `# Baccarat Pro — Déploiement Render.com

## 1. Créer une base PostgreSQL
- Render Dashboard → New + → PostgreSQL → plan Free
- Copier la chaîne de connexion **Internal Database URL**

## 2. Créer le Web Service
- New + → Web Service → Build and deploy from a Git repository (ou upload ZIP)
- Runtime: **Node**
- Build command: \`npm install && npm run build\`
- Start command: \`node index.js\`

## 3. Variables d'environnement (Settings → Environment)
| Clé              | Valeur                                            |
|------------------|---------------------------------------------------|
| DATABASE_URL     | (Internal Database URL de l'étape 1)              |
| SESSION_SECRET   | (chaîne aléatoire ≥ 32 caractères)                |
| NODE_ENV         | production                                        |
| PORT             | 5000                                              |

## 4. Premier lancement
- L'app initialise la base PostgreSQL automatiquement.
- Connectez-vous avec le compte super admin **sossoukouam**.
- Configurez vos canaux Telegram dans l'interface Admin.

## Notes
- Le frontend est déjà compilé dans \`dist/\` — le build Render ne refait que \`npm install\`.
- Aucun fichier \`.env\` dans le ZIP : tout passe par les variables Render.
- Les comptes Pro ont chacun leur propre bot Telegram (configurable dans l'onglet Config Pro).
`;

router.get('/project-backup/zip-render', requireAdmin, (req, res) => {
  try {
    const archiver = require('archiver');
    const root     = path.join(__dirname);
    const all      = scanRenderFiles(root, '');

    // Filtrer : garder uniquement fichiers racine whitelistés OU fichiers dans dossiers autorisés
    const files = all.filter(f => {
      const segs = f.relPath.split('/');
      if (segs.length === 1) return RENDER_INCLUDE_ROOT_FILES.has(segs[0]);
      return RENDER_INCLUDE_DIRS.includes(segs[0]);
    });

    const date     = new Date().toISOString().slice(0, 10);
    const filename = `baccarat-pro-render-${date}.zip`;
    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);

    const archive = archiver('zip', { zlib: { level: 9 } }); // compression max
    archive.on('error', (err) => { console.error('[ZIP-RENDER]', err.message); res.end(); });
    archive.pipe(res);

    let totalBytes = 0;
    for (const f of files) {
      archive.file(f.fullPath, { name: f.relPath });
      totalBytes += f.size;
    }
    archive.append(RENDER_YAML, { name: 'render.yaml' });
    archive.append(DEPLOY_RENDER_README, { name: 'DEPLOY.md' });
    // .nvmrc pour fixer la version Node sur Render
    archive.append('20\n', { name: '.nvmrc' });

    archive.finalize();
    console.log(`[ZIP-RENDER] Archive Render générée : ${files.length} fichier(s), ${(totalBytes/1024).toFixed(0)} Ko sources → ${filename}`);
  } catch (e) {
    console.error('[ZIP-RENDER] Erreur:', e.message);
    res.status(500).json({ error: e.message });
  }
});

// ── ZIP différentiel — uniquement les fichiers modifiés depuis un commit ──────
router.get('/project-backup/zip-diff', requireAdmin, (req, res) => {
  try {
    const archiver   = require('archiver');
    const { execSync } = require('child_process');
    const root = path.join(__dirname);

    // Commit de référence : "Add support for three new operational modes" (132d09e)
    // On prend les fichiers modifiés entre ce commit et HEAD (git tracked)
    const REF_COMMIT = req.query.since || '132d09e';
    let changedFiles = [];
    try {
      const out = execSync(`git diff --name-only ${REF_COMMIT} HEAD`, { cwd: root, timeout: 10000 }).toString().trim();
      changedFiles = out.split('\n').filter(Boolean);
    } catch {
      return res.status(500).json({ error: 'git diff échoué — vérifiez que le dépôt git est initialisé' });
    }

    if (!changedFiles.length) {
      return res.status(400).json({ error: 'Aucun fichier modifié depuis ce commit' });
    }

    const date     = new Date().toISOString().slice(0, 10);
    const filename = `appolinaire-diff-${date}.zip`;
    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);

    const archive = archiver('zip', { zlib: { level: 6 } });
    archive.on('error', err => { console.error('[ZIP-DIFF]', err.message); res.end(); });
    archive.pipe(res);

    let included = 0;
    for (const relFile of changedFiles) {
      const fullPath = path.join(root, relFile);
      if (!fs.existsSync(fullPath)) continue;
      try {
        const stat = fs.statSync(fullPath);
        if (!stat.isFile() || stat.size > 5 * 1024 * 1024) continue;
        archive.file(fullPath, { name: relFile });
        included++;
      } catch {}
    }

    // Inclure un manifeste
    const manifest = `# Baccarat Pro — Mise à jour différentielle ${date}
# Fichiers modifiés depuis : ${REF_COMMIT}
# ${included} fichier(s) inclus

${changedFiles.filter(f => {
  const fp = path.join(root, f);
  return fs.existsSync(fp);
}).join('\n')}
`;
    archive.append(manifest, { name: 'UPDATE_MANIFEST.txt' });
    archive.finalize();
    console.log(`[ZIP-DIFF] Archive diff générée : ${included} fichiers depuis ${REF_COMMIT} → ${filename}`);
  } catch (e) {
    console.error('[ZIP-DIFF] Erreur:', e.message);
    res.status(500).json({ error: e.message });
  }
});

router.post('/project-backup', requireAdmin, async (req, res) => {
  try {
    const root  = path.join(__dirname);
    const files = scanProjectFiles(root, '');
    let saved = 0, errors = 0;
    for (const f of files) {
      try {
        const content = fs.readFileSync(f.fullPath, 'utf8');
        await db.upsertProjectFile(f.relPath, content, false);
        saved++;
      } catch { errors++; }
    }
    res.json({ ok: true, saved, errors, total: files.length });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Sauvegarde uniquement les fichiers modifiés (comparaison taille + mtime vs DB)
router.post('/project-backup/diff', requireAdmin, async (req, res) => {
  try {
    const root    = path.join(__dirname);
    const files   = scanProjectFiles(root, '');
    const dbMeta  = await db.getProjectFileMeta(); // { relPath → { size_bytes, updated_at } }

    let saved = 0, skipped = 0, added = 0, errors = 0;
    const changed = [];

    for (const f of files) {
      try {
        const stat    = fs.statSync(f.fullPath);
        const diskSize = stat.size;
        const diskMtime = stat.mtimeMs;
        const meta    = dbMeta[f.relPath];

        const isNew      = !meta;
        const sizeChanged = meta && meta.size_bytes !== diskSize;
        const newer       = meta && meta.updated_at && diskMtime > new Date(meta.updated_at).getTime();

        if (isNew || sizeChanged || newer) {
          const content = fs.readFileSync(f.fullPath, 'utf8');
          await db.upsertProjectFile(f.relPath, content, false);
          changed.push(f.relPath);
          if (isNew) added++; else saved++;
        } else {
          skipped++;
        }
      } catch { errors++; }
    }

    res.json({ ok: true, saved: saved + added, added, updated: saved, skipped, errors, total: files.length, changed });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.get('/project-backup/list', requireAdmin, async (req, res) => {
  try {
    const files = await db.getAllProjectFiles();
    const summary = files.map(f => ({
      file_path: f.file_path,
      size_bytes: f.size_bytes,
      updated_at: f.updated_at,
    }));
    // Date de la dernière sauvegarde = max updated_at parmi tous les fichiers
    const lastSaved = summary.reduce((max, f) => {
      if (!f.updated_at) return max;
      return (!max || new Date(f.updated_at) > new Date(max)) ? f.updated_at : max;
    }, null);
    res.json({ files: summary, total: summary.length, last_saved: lastSaved });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.delete('/project-backup', requireAdmin, async (req, res) => {
  try {
    const count = await db.clearProjectFiles();
    res.json({ ok: true, deleted: count });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Récupérer le journal des déploiements
router.get('/deploy-logs', requireSuperAdmin, async (req, res) => {
  try {
    const logs = await db.getDeployLogs(30);
    res.json({ ok: true, logs });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.post('/project-install', requireAdmin, async (req, res) => {
  const startedAt = Date.now();
  const os = require('os');
  const IS_RENDER_ENV = !!(process.env.RENDER || process.env.RENDER_SERVICE_ID);

  // Créer le log de déploiement immédiatement en base
  let deployLogId = null;
  try {
    deployLogId = await db.createDeployLog({
      source:   IS_RENDER_ENV ? 'render' : 'manual',
      hostname: os.hostname(),
      env:      process.env.NODE_ENV || 'development',
    });
    console.log(`[Install] 📋 Log de déploiement créé → id=${deployLogId}`);
  } catch (e) {
    console.error('[Install] Impossible de créer le log de déploiement:', e.message);
  }

  try {
    const files = await db.getAllProjectFiles();
    if (!files || files.length === 0) {
      await db.updateDeployLog(deployLogId, { status: 'error', log_text: 'Aucun fichier en base', finished_at: new Date(), duration_ms: Date.now() - startedAt });
      return res.status(400).json({ error: 'Aucun fichier sauvegardé dans la base de données.' });
    }
    const root = path.join(__dirname);
    let written = 0, errors = 0;
    const log = [];

    for (const f of files) {
      try {
        const dest = path.join(root, f.file_path);
        fs.mkdirSync(path.dirname(dest), { recursive: true });
        fs.writeFileSync(dest, f.content, 'utf8');
        written++;
        log.push(`✅ ${f.file_path}`);
      } catch (e) {
        errors++;
        log.push(`❌ ${f.file_path}: ${e.message}`);
      }
    }

    // Mise à jour intermédiaire en base — fichiers écrits
    await db.updateDeployLog(deployLogId, {
      files_written: written,
      files_errors:  errors,
      status:        'installing',
      log_text:      log.join('\n'),
    }).catch(() => {});

    res.json({ ok: true, written, errors, log, deploy_log_id: deployLogId });

    // Post-install : npm install si besoin + rebuild frontend + redémarrage
    setTimeout(async () => {
      let npmStatus   = 'skipped';
      let buildStatus = 'skipped';
      const postLog   = [...log];

      try {
        const pkgChanged    = files.some(f => f.file_path === 'package.json');
        const noNodeModules = !fs.existsSync(path.join(root, 'node_modules', '.package-lock.json')) &&
                              !fs.existsSync(path.join(root, 'node_modules', 'express'));
        if (pkgChanged || noNodeModules) {
          console.log(`[Install] npm install (pkgChanged=${pkgChanged}, noNodeModules=${noNodeModules})...`);
          postLog.push('--- npm install ---');
          const npmCode = await new Promise((resolve) => {
            const proc = spawn('npm', ['install', '--prefer-offline'], { cwd: root, stdio: 'inherit' });
            proc.on('close', resolve);
          });
          npmStatus = npmCode === 0 ? 'success' : `failed(code=${npmCode})`;
          postLog.push(`npm install: ${npmStatus}`);
          console.log(`[Install] npm install → ${npmStatus}`);
        } else {
          npmStatus = 'skipped (node_modules déjà présent)';
          postLog.push('npm install: skipped — node_modules déjà présent');
          console.log('[Install] node_modules déjà présent — npm install ignoré');
        }

        // Compiler uniquement si dist/index.html n'a PAS été restauré depuis la DB
        const distRestored = files.some(f => f.file_path === 'dist/index.html');
        const hasSrc       = files.some(f => f.file_path.startsWith('src/'));
        if (!distRestored && (hasSrc || pkgChanged)) {
          console.log('[Install] dist/ absent de la DB — compilation frontend...');
          postLog.push('--- npm run build ---');
          const viteBin    = path.join(root, 'node_modules', '.bin', 'vite');
          const buildSpawn = fs.existsSync(viteBin)
            ? spawn(viteBin, ['build'], { cwd: root, stdio: 'inherit' })
            : spawn('npm', ['run', 'build'], { cwd: root, stdio: 'inherit' });
          const buildCode  = await new Promise((resolve) => buildSpawn.on('close', resolve));
          buildStatus      = buildCode === 0 ? 'success' : `failed(code=${buildCode})`;
          postLog.push(`npm run build: ${buildStatus}`);
          console.log(`[Install] build → ${buildStatus}`);
        } else if (distRestored) {
          buildStatus = 'skipped (dist/ restauré depuis DB)';
          postLog.push(`npm run build: skipped — dist/index.html déjà restauré`);
          console.log('[Install] ✅ dist/ déjà restauré depuis la base — build ignoré');
        }
      } catch (e) {
        console.error('[Install] Erreur post-install:', e.message);
        postLog.push(`❌ Erreur post-install: ${e.message}`);
        npmStatus = npmStatus === 'started' ? `error: ${e.message}` : npmStatus;
      }

      const finalStatus = errors === 0 ? 'success' : 'partial';
      const durationMs  = Date.now() - startedAt;

      // Sauvegarder le résultat final en base AVANT de redémarrer
      try {
        await db.updateDeployLog(deployLogId, {
          files_written: written,
          files_errors:  errors,
          npm_install:   npmStatus,
          build_status:  buildStatus,
          status:        finalStatus,
          log_text:      postLog.join('\n'),
          duration_ms:   durationMs,
          finished_at:   new Date(),
        });
        console.log(`[Install] ✅ Log de déploiement mis à jour → id=${deployLogId} status=${finalStatus}`);
      } catch (e) {
        console.error('[Install] Impossible de sauvegarder le log final:', e.message);
      }

      // Petit délai pour s'assurer que la transaction DB est commitée
      await new Promise(r => setTimeout(r, 800));
      console.log('[Install] Redémarrage du serveur (exit 1 → Render redémarre automatiquement)...');
      process.exit(1); // code 1 = Render redémarre le service à coup sûr
    }, 800);
  } catch (e) {
    await db.updateDeployLog(deployLogId, { status: 'error', log_text: e.message, finished_at: new Date(), duration_ms: Date.now() - startedAt }).catch(() => {});
    res.status(500).json({ error: e.message });
  }
});

// ── Settings génériques (clé/valeur) ──────────────────────────────────────
const ALLOWED_SETTINGS = ['render_service_id', 'render_api_key', 'render_base_url'];
router.post('/settings', requireAdmin, async (req, res) => {
  try {
    const { key, value } = req.body;
    if (!key || !ALLOWED_SETTINGS.includes(key)) return res.status(400).json({ error: 'Clé non autorisée : ' + key });
    if (value === undefined || value === null || value === '') return res.status(400).json({ error: 'Valeur vide' });
    await db.setSetting(key, String(value).trim());
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});
router.get('/settings/:key', requireAdmin, async (req, res) => {
  try {
    if (!ALLOWED_SETTINGS.includes(req.params.key)) return res.status(400).json({ error: 'Clé non autorisée' });
    const val = await db.getSetting(req.params.key);
    res.json({ value: val || null });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── Arrêt serveur Replit ───────────────────────────────────────────────────
router.post('/stop-server', requireAdmin, (req, res) => {
  res.json({ ok: true, message: 'Serveur Replit en cours d\'arrêt...' });
  setTimeout(() => { console.log('[Admin] Arrêt serveur demandé par admin'); process.exit(0); }, 600);
});

// ── Suspension service Render ──────────────────────────────────────────────
router.post('/stop-render', requireAdmin, async (req, res) => {
  try {
    const serviceId = await db.getSetting('render_service_id');
    const apiKey    = await db.getSetting('render_api_key');
    if (!serviceId || !apiKey)
      return res.status(400).json({ error: 'Configurez d\'abord le Render Service ID et la Render API Key dans Système.' });
    const fetch = require('node-fetch');
    const r = await fetch(`https://api.render.com/v1/services/${serviceId}/suspend`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    });
    if (!r.ok) { const t = await r.text(); return res.status(500).json({ error: `Render API ${r.status}: ${t}` }); }
    res.json({ ok: true, message: 'Service Render suspendu.' });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ══════════════════════════════════════════════════════════════════════════════
// ── HÉBERGEMENT BOTS TELEGRAM ─────────────────────────────────────────────────
// ══════════════════════════════════════════════════════════════════════════════
const botHost = require('./bot-host');

// Lister tous les bots hébergés
router.get('/bots', requireSuperAdmin, async (req, res) => {
  try { res.json(await botHost.getAll()); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

// Créer un nouveau bot (avec ZIP en base64 — fichier principal détecté automatiquement)
router.post('/bots', requireSuperAdmin, async (req, res) => {
  try {
    const { name, language, token, channel_id, zip_base64 } = req.body;
    if (!name || !token) return res.status(400).json({ error: 'name et token requis' });
    if (!zip_base64) return res.status(400).json({ error: 'zip_base64 requis' });
    const bot = await botHost.createBot({ name, language, token, channel_id, zip_base64 });
    res.json({ ok: true, bot });
  } catch (e) { res.status(400).json({ error: e.message }); }
});

// Mettre à jour le code d'un bot (nouveau ZIP)
router.post('/bots/:id/upload', requireSuperAdmin, async (req, res) => {
  try {
    const { zip_base64 } = req.body;
    if (!zip_base64) return res.status(400).json({ error: 'zip_base64 requis' });
    await botHost.updateCode(parseInt(req.params.id), zip_base64);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Démarrer un bot
router.post('/bots/:id/start', requireSuperAdmin, async (req, res) => {
  try {
    const result = await botHost.startBot(parseInt(req.params.id));
    if (!result.ok) return res.status(400).json(result);
    res.json(result);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Arrêter un bot
router.post('/bots/:id/stop', requireSuperAdmin, async (req, res) => {
  try {
    const result = botHost.stopBot(parseInt(req.params.id));
    res.json(result);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Supprimer un bot
router.delete('/bots/:id', requireSuperAdmin, async (req, res) => {
  try {
    await botHost.deleteBot(parseInt(req.params.id));
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Logs d'un bot
router.get('/bots/:id/logs', requireSuperAdmin, (req, res) => {
  try { res.json(botHost.getLogs(parseInt(req.params.id))); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

// Valider un token Telegram
router.post('/bots/validate-token', requireSuperAdmin, async (req, res) => {
  try {
    const result = await botHost.validateToken(req.body.token);
    res.json(result);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── COMPTE PRO ─────────────────────────────────────────────────────

// Activer / désactiver le statut Pro d'un utilisateur
router.post('/users/:id/toggle-pro', requireSuperAdmin, async (req, res) => {
  const id = parseInt(req.params.id);
  try {
    const current = await db.getUser(id);
    if (!current) return res.status(404).json({ error: 'Utilisateur non trouvé' });
    if (current.is_admin) return res.status(400).json({ error: 'Impossible de modifier un admin' });
    const newVal = !current.is_pro;
    const user = await db.updateUser(id, { is_pro: newVal });
    console.log(`[Pro] Compte Pro ${newVal ? 'ACTIVÉ' : 'DÉSACTIVÉ'} pour ${current.username} (id=${id})`);
    // Refresh pro_strategy_ids (la liste tient compte des owners désactivés) + recharger le moteur
    try {
      const list = await getProStrategiesList();
      await saveProStrategiesList(list);
      require('./engine').reloadProStrategies().catch(() => {});
    } catch (e) { console.warn('[Pro] reload après toggle:', e.message); }
    res.json({ ok: true, is_pro: newVal, user });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Configuration Telegram pour comptes Pro (token + canal) — PAR UTILISATEUR
// Clé DB : pro_telegram_config_{userId}
async function getProTgConfigKey(ownerId) { return `pro_telegram_config_${ownerId}`; }

// Migration legacy : ancienne clé globale `pro_telegram_config` → admin principal
async function migrateLegacyProConfigOnce() {
  if (global.__proConfigMigrated) return;
  global.__proConfigMigrated = true;
  try {
    const legacy = await db.getSetting('pro_telegram_config').catch(() => null);
    if (!legacy) return;
    const cfg = JSON.parse(legacy);
    if (!cfg.bot_token || !cfg.channel_id) return;
    const allUsers = await db.getAllUsers().catch(() => []);
    const adm = allUsers.find(u => u.is_admin && (u.admin_level || 2) === 1) || allUsers.find(u => u.is_admin);
    if (!adm) return;
    const newKey = `pro_telegram_config_${adm.id}`;
    const exists = await db.getSetting(newKey).catch(() => null);
    if (!exists) {
      await db.setSetting(newKey, legacy);
      console.log(`[Pro] 🔁 Migration legacy pro_telegram_config → ${newKey} (admin "${adm.username}")`);
    }
    await db.setSetting('pro_telegram_config', '');
  } catch (e) { console.warn('[Pro] migrateLegacyProConfigOnce:', e.message); }
}
migrateLegacyProConfigOnce();

router.get('/pro-config', requireProOrAdmin, async (req, res) => {
  try {
    const ownerId = effectiveOwnerId(req);
    const raw = await db.getSetting(await getProTgConfigKey(ownerId));
    const cfg = raw ? JSON.parse(raw) : { bot_token: '', channel_id: '' };
    res.json({ ...cfg, owner_user_id: ownerId });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Liste des comptes Pro (pour le sélecteur admin)
router.get('/pro-users', requireProOrAdmin, async (req, res) => {
  try {
    if (!req.session.isAdmin) {
      // Pro : ne voit que lui-même
      const u = await db.getUser(req.session.userId);
      return res.json({ users: u ? [{ id: u.id, username: u.username, email: u.email }] : [] });
    }
    const all = await db.getAllUsers();
    const users = all.filter(u => u.is_pro && !u.is_admin)
                      .map(u => ({ id: u.id, username: u.username, email: u.email, is_approved: u.is_approved }));
    res.json({ users });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.post('/pro-config', requireProOrAdmin, async (req, res) => {
  const { bot_token, channel_id, strategy_name } = req.body;
  if (!bot_token || !channel_id)
    return res.status(400).json({ error: 'Token et ID canal requis' });
  try {
    const stratName = (strategy_name || '').trim() || '—';

    // Vérifier le token via l'API Telegram (timeout 8s, non-bloquant si échec)
    let bot_username = '';
    let tg_ok = false;
    try {
      const ctrl    = new AbortController();
      const timer   = setTimeout(() => ctrl.abort(), 8000);
      const tgRes   = await fetch(`https://api.telegram.org/bot${bot_token}/getMe`, { signal: ctrl.signal });
      clearTimeout(timer);
      const tgData  = await tgRes.json();
      if (tgData.ok) { bot_username = tgData.result.username || ''; tg_ok = true; }
    } catch (_) { /* timeout ou réseau — on sauvegarde quand même */ }

    // Sauvegarder la config dans la DB — clé par utilisateur
    const ownerId = effectiveOwnerId(req);
    await db.setSetting(await getProTgConfigKey(ownerId), JSON.stringify({ bot_token, channel_id, bot_username, strategy_name: stratName, owner_user_id: ownerId }));

    // Inscrire le canal Pro dans la table telegram_config (Canaux du site)
    try {
      const ownerLabel = req.session.isAdmin && ownerId !== req.session.userId ? ` (uid ${ownerId})` : '';
      const canalLabel = stratName !== '—' ? `🔷 ${stratName}${ownerLabel}` : `🔷 Pro — @${bot_username || 'bot'}${ownerLabel}`;
      await db.upsertTelegramConfig({ channel_id, channel_name: canalLabel });
    } catch (e) { console.warn('[Pro] Canal non ajouté aux Canaux:', e.message); }

    // Message de bienvenue Telegram (non-bloquant, timeout 8s)
    if (tg_ok) {
      const welcomeMsg =
`🔷 *Bot Pro connecté avec succès !*

🤖 Bot : @${bot_username}
📢 Canal : \`${channel_id}\`
📛 Stratégie : *${stratName}*

✅ Les prédictions Pro seront envoyées automatiquement dans ce canal.`;
      try {
        const ctrl2  = new AbortController();
        const timer2 = setTimeout(() => ctrl2.abort(), 8000);
        await fetch(`https://api.telegram.org/bot${bot_token}/sendMessage`, {
          method: 'POST', signal: ctrl2.signal,
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ chat_id: channel_id, text: welcomeMsg, parse_mode: 'Markdown' }),
        });
        clearTimeout(timer2);
      } catch (_) {}
    }

    // Recharger le moteur Pro
    try { require('./engine').reloadProStrategies().catch(() => {}); } catch {}

    console.log(`[Pro][uid=${ownerId}] ✅ Config sauvegardée — Bot: @${bot_username || '?'} | Canal: ${channel_id} | Stratégie: ${stratName} | TG validé: ${tg_ok}`);
    res.json({ ok: true, bot_username, strategy_name: stratName, tg_validated: tg_ok, owner_user_id: ownerId });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.delete('/pro-config', requireProOrAdmin, async (req, res) => {
  try {
    const ownerId = effectiveOwnerId(req);
    await db.setSetting(await getProTgConfigKey(ownerId), '');
    try { require('./engine').reloadProStrategies().catch(() => {}); } catch {}
    res.json({ ok: true, owner_user_id: ownerId });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.post('/pro-config/test-message', requireProOrAdmin, async (req, res) => {
  try {
    const ownerId = effectiveOwnerId(req);
    const raw = await db.getSetting(await getProTgConfigKey(ownerId));
    if (!raw) return res.status(400).json({ error: 'Bot Pro non configuré' });
    const cfg = JSON.parse(raw);
    const { bot_token, channel_id, bot_username } = cfg;
    if (!bot_token || !channel_id) return res.status(400).json({ error: 'Token ou canal manquant' });

    const stratName = cfg.strategy_name || '—';

    const msg =
`📡 *Message test — Bot Pro*

🤖 Bot : @${bot_username || '—'}
📢 Canal : \`${channel_id}\`
📛 Stratégie : *${stratName}*

✅ Le bot Pro fonctionne correctement.`;

    const r = await fetch(`https://api.telegram.org/bot${bot_token}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: channel_id, text: msg, parse_mode: 'Markdown' }),
    });
    const d = await r.json();
    if (!d.ok) return res.status(400).json({ error: d.description || 'Échec envoi Telegram' });
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Fichier de stratégie Pro (.json chargé dans le moteur, .js/.py stockés comme référence)
// ── Analyse complète d'un fichier de stratégie Pro ────────────────────────
// Retourne { ok, errors[], warnings[], strategy_name, strategy_info{} }
function analyzeStrategyFile(ext, content, filename) {
  const errors = [];
  const warnings = [];
  let strategy_name = filename.replace(/\.[^.]+$/, '');
  let strategy_info = {};

  // ── JSON ──────────────────────────────────────────────────────────────────
  if (ext === 'json') {
    let parsed;
    try { parsed = JSON.parse(content); }
    catch (e) {
      const m = e.message.match(/position (\d+)/);
      const pos = m ? parseInt(m[1]) : null;
      let lineNum = null, col = null;
      if (pos !== null) {
        const before = content.substring(0, pos);
        lineNum = (before.match(/\n/g) || []).length + 1;
        col = pos - before.lastIndexOf('\n');
      }
      errors.push({ type: 'SyntaxError', message: `JSON invalide : ${e.message}`, line: lineNum, col });
      return { ok: false, errors, warnings, strategy_name, strategy_info };
    }
    // Tolérance : accepte aussi un objet stratégie unique (sans tableau "strategies")
    let strategies = [];
    if (Array.isArray(parsed.strategies))      strategies = parsed.strategies;
    else if (parsed.strategy && typeof parsed.strategy === 'object') strategies = [parsed.strategy];
    else if (parsed.name && (parsed.mode || parsed.hand || parsed.threshold !== undefined)) strategies = [parsed];

    if (!strategies.length) {
      errors.push({ type: 'StructureError', message: 'Structure JSON non reconnue — fournissez soit un tableau "strategies": [...], soit un objet { name, mode, ... }' });
    }
    const VALID_MODES = ['absence_apparition','manquants','apparents','compteur_adverse','absence_victoire','victoire_adverse','multi_strategy','relance'];
    for (const s of strategies) {
      if (!s || typeof s !== 'object') {
        errors.push({ type: 'FieldError', message: 'Entrée de stratégie invalide (attendu : objet)' });
        continue;
      }
      if (!s.name) warnings.push({ type: 'MissingField', message: 'Champ "name" manquant — un nom par défaut sera utilisé' });
      if (!s.mode) warnings.push({ type: 'MissingField', message: `Champ "mode" absent dans "${s.name || '?'}" — le moteur utilisera le mode par défaut` });
      if (s.mode && !VALID_MODES.includes(s.mode)) {
        warnings.push({ type: 'UnknownMode', message: `Mode "${s.mode}" non reconnu — modes standards : ${VALID_MODES.join(', ')}` });
      }
      if (s.threshold === undefined && s.mode && ['absence_apparition','manquants','apparents','compteur_adverse','absence_victoire','victoire_adverse'].includes(s.mode)) {
        warnings.push({ type: 'MissingField', message: `Champ "threshold" absent dans "${s.name || '?'}" pour le mode "${s.mode}"` });
      }
      if (s.decalage === undefined && s.prediction_offset === undefined) {
        warnings.push({ type: 'MissingField', message: `Champ "decalage" (ou "prediction_offset") absent dans "${s.name || '?'}" — 1 sera utilisé par défaut` });
      }
    }
    if (errors.length === 0) {
      strategy_name = parsed.name || strategies[0]?.name || strategy_name;
      strategy_info = {
        count: strategies.length,
        names: strategies.map(s => s.name),
        modes: [...new Set(strategies.map(s => s.mode))],
        hands: [...new Set(strategies.map(s => s.hand || 'joueur'))],
        engine_type: 'json',
      };
    }

  // ── JavaScript ────────────────────────────────────────────────────────────
  } else if (ext === 'js' || ext === 'mjs') {
    const vm = require('vm');
    // 1. Vérification syntaxique
    try { new vm.Script(content, { filename }); }
    catch (e) {
      errors.push({ type: 'SyntaxError', message: e.message, line: e.lineNumber || null, col: e.columnNumber || null });
      return { ok: false, errors, warnings, strategy_name, strategy_info };
    }
    // 2. Exécution en sandbox pour extraire les exports et valider l'API
    let exported = {};
    try {
      const moduleObj = { exports: {} };
      const logs = [];
      const sandbox = {
        module: moduleObj, exports: moduleObj.exports,
        console: { log: (...a) => logs.push(a.join(' ')), error: (...a) => logs.push('[ERR] '+a.join(' ')), warn: (...a) => logs.push('[WARN] '+a.join(' ')) },
        setTimeout: () => {}, clearTimeout: () => {}, setInterval: () => {}, clearInterval: () => {},
        Math, JSON, Date, parseInt, parseFloat, isNaN, isFinite, Array, Object, String, Number, Boolean, RegExp,
        require: (m) => { throw new Error(`require("${m}") non autorisé dans un fichier stratégie Pro`); },
      };
      vm.createContext(sandbox);
      vm.runInContext(content, sandbox, { timeout: 3000, filename });
      exported = sandbox.module.exports;
      if (logs.length) warnings.push({ type: 'ConsoleOutput', message: `Sortie console lors du chargement : ${logs.slice(0,3).join(' | ')}` });
    } catch (e) {
      errors.push({ type: 'RuntimeError', message: `Erreur à l'exécution : ${e.message}`, line: e.lineNumber || null });
      return { ok: false, errors, warnings, strategy_name, strategy_info };
    }
    // 3. Validation de l'API exportée — accepte plusieurs styles courants
    //    - module.exports = { processGame }
    //    - module.exports = { process_game }  (style Python)
    //    - module.exports = { predict } | { run } | { strategy }
    //    - module.exports = function(...) { ... }   (fonction directe)
    const ALT_FN_NAMES = ['processGame', 'process_game', 'predict', 'run', 'strategy', 'handler'];
    let fnName = null;
    let fn = null;
    if (typeof exported === 'function') {
      fn = exported; fnName = '(module.exports)';
      warnings.push({ type: 'LegacyExport', message: 'module.exports est une fonction — elle sera traitée comme processGame()' });
    } else if (typeof exported !== 'object' || exported === null) {
      errors.push({ type: 'ExportError', message: 'Le fichier doit exporter un objet { processGame, ... } ou une fonction via module.exports' });
    } else {
      for (const n of ALT_FN_NAMES) {
        if (typeof exported[n] === 'function') { fn = exported[n]; fnName = n; break; }
      }
      if (!fn) {
        errors.push({ type: 'APIError', message: `Aucune fonction de prédiction trouvée dans module.exports — noms acceptés : ${ALT_FN_NAMES.join(', ')}` });
      } else if (fnName !== 'processGame') {
        warnings.push({ type: 'AltFunctionName', message: `Fonction "${fnName}" détectée — le moteur la reconnaîtra via alias (nom canonique : processGame)` });
      }
    }

    // 4. Test d'appel à sec avec données fictives — accepte plusieurs formats de retour
    if (fn) {
      try {
        const testState = {};
        const testResult = fn.call(exported, 999, ['♦','♠'], ['♥'], 'Player', testState);
        if (testResult !== null && testResult !== undefined) {
          // Normalise plusieurs formats vers { suit }
          let suit = null, altFormat = null;
          if (typeof testResult === 'string') {
            suit = testResult; altFormat = 'chaîne brute';
          } else if (typeof testResult === 'object') {
            if (testResult.suit)            suit = testResult.suit;
            else if (testResult.predicted)  { suit = testResult.predicted; altFormat = 'predicted'; }
            else if (testResult.prediction) { suit = testResult.prediction; altFormat = 'prediction'; }
            else if (Array.isArray(testResult.suits) && testResult.suits.length) { suit = testResult.suits[0]; altFormat = 'suits[]'; }
            else if (testResult.side)       altFormat = 'side (côté joueur/banquier — non consommé par le moteur)';
            else if (testResult.value)      altFormat = 'value (valeur de carte — non consommé par le moteur)';
          } else {
            errors.push({ type: 'ReturnTypeError', message: `La fonction doit retourner un objet, une chaîne ou null (reçu : ${typeof testResult})` });
          }
          if (altFormat && !suit) {
            warnings.push({ type: 'UnsupportedReturnFormat', message: `Format de retour "${altFormat}" détecté — le moteur n'utilisera que le champ "suit". Adaptez votre fonction pour retourner { suit: '♠|♥|♦|♣' }.` });
          } else if (altFormat && suit) {
            warnings.push({ type: 'AltReturnFormat', message: `Format de retour "${altFormat}" détecté — normalisé vers { suit: "${suit}" }` });
          }
          if (suit && !['♠','♥','♦','♣'].includes(suit)) {
            warnings.push({ type: 'InvalidSuit', message: `Costume retourné "${suit}" invalide — attendu : ♠ ♥ ♦ ♣` });
          }
        }
      } catch (e) {
        warnings.push({ type: 'TestCallWarning', message: `Avertissement lors du test d'appel : ${e.message}` });
      }
    }
    if (typeof exported === 'object' && exported !== null) {
      if (!exported.name) warnings.push({ type: 'MissingField', message: 'Champ "name" (stratégie) absent — un nom par défaut sera utilisé' });
      if (!exported.hand) warnings.push({ type: 'MissingField', message: 'Champ "hand" absent — "joueur" sera utilisé par défaut' });
      if (exported.decalage === undefined) warnings.push({ type: 'MissingField', message: 'Champ "decalage" absent — 1 sera utilisé par défaut' });
    }
    // Vérifie que la logique de prédiction gère ses exceptions (try/catch)
    if (fn && !/try\s*\{[\s\S]*?\}\s*catch/.test(content)) {
      warnings.push({ type: 'NoExceptionHandling', message: 'Aucun bloc try/catch détecté dans le code — la logique de prédiction devrait gérer ses propres exceptions pour éviter d\'interrompre le moteur' });
    }
    if (errors.length === 0) {
      const meta = (typeof exported === 'object' && exported !== null) ? exported : {};
      strategy_name = meta.name || strategy_name;
      strategy_info = {
        count: 1, names: [strategy_name],
        hand: meta.hand || 'joueur',
        decalage: meta.decalage || 1,
        max_rattrapage: meta.max_rattrapage || 3,
        engine_type: 'script_js',
        entry_fn: fnName || null,
      };
    }

  // ── Python ────────────────────────────────────────────────────────────────
  } else if (ext === 'py') {
    const { spawnSync } = require('child_process');
    const fs = require('fs');
    const os = require('os');
    const path = require('path');
    const PYTHON = process.env.PYTHON_BIN || '/home/runner/workspace/.pythonlibs/bin/python3';
    const tmpPath = path.join(os.tmpdir(), `pro_validate_${Date.now()}.py`);

    try { fs.writeFileSync(tmpPath, content, 'utf8'); } catch (e) {
      errors.push({ type: 'WriteError', message: `Impossible d'écrire le fichier temporaire : ${e.message}` });
      return { ok: false, errors, warnings, strategy_name, strategy_info };
    }

    // 1. Vérification syntaxique via py_compile
    const compileResult = spawnSync(PYTHON, ['-m', 'py_compile', tmpPath], { encoding: 'utf8', timeout: 8000 });
    if (compileResult.error) {
      errors.push({ type: 'SpawnError', message: `Python introuvable : ${compileResult.error.message}` });
    } else if (compileResult.status !== 0) {
      const stderr = (compileResult.stderr || '').trim();
      // Extraire numéro de ligne depuis le message d'erreur Python
      const lineMatch = stderr.match(/line (\d+)/);
      const lineNum = lineMatch ? parseInt(lineMatch[1]) : null;
      const cleanMsg = stderr.replace(tmpPath, filename).replace(/File ".*?", /, '').trim();
      errors.push({ type: 'SyntaxError', message: cleanMsg || 'Erreur de syntaxe Python', line: lineNum });
    }
    try { fs.unlinkSync(tmpPath); } catch {}

    if (errors.length > 0) return { ok: false, errors, warnings, strategy_name, strategy_info };

    // 2. Test d'exécution avec données fictives (vérifie le protocole stdin/stdout)
    const testInput = JSON.stringify({ game_number: 999, player_suits: ['♦','♠'], banker_suits: ['♥'], winner: 'Player', state: {} });
    const tmpPath2 = path.join(os.tmpdir(), `pro_test_${Date.now()}.py`);
    try { fs.writeFileSync(tmpPath2, content, 'utf8'); } catch {}
    const runResult = spawnSync(PYTHON, [tmpPath2], { input: testInput, encoding: 'utf8', timeout: 8000 });
    try { fs.unlinkSync(tmpPath2); } catch {}

    // Détection souple de la fonction de prédiction — plusieurs noms acceptés
    const PY_ALT_FN = ['process_game', 'processGame', 'predict', 'run', 'strategy', 'handler'];
    const detectedFn = PY_ALT_FN.find(n => new RegExp(`^\\s*def\\s+${n}\\s*\\(`, 'm').test(content));
    if (!detectedFn) {
      warnings.push({ type: 'NoEntryFunction', message: `Aucune fonction de prédiction trouvée dans le code — noms acceptés : ${PY_ALT_FN.join(', ')}` });
    } else if (detectedFn !== 'process_game') {
      warnings.push({ type: 'AltFunctionName', message: `Fonction "${detectedFn}" détectée — le moteur la reconnaîtra via alias (nom canonique : process_game)` });
    }

    if (runResult.error) {
      warnings.push({ type: 'TestRunWarning', message: `Impossible de tester le script : ${runResult.error.message}` });
    } else if (runResult.status !== 0) {
      const stderr = (runResult.stderr || '').trim();
      if (stderr) {
        const moduleMatch = stderr.match(/ModuleNotFoundError: No module named '([^']+)'/);
        const nameErrMatch = stderr.match(/NameError:\s*(.+)/);
        const typeErrMatch = stderr.match(/TypeError:\s*(.+)/);
        const keyErrMatch  = stderr.match(/KeyError:\s*(.+)/);
        if (moduleMatch) {
          errors.push({ type: 'ImportError', message: `Import externe interdit : le module '${moduleMatch[1]}' n'existe pas dans l'environnement d'exécution. Le fichier Python doit être autonome — supprimez les "import" ou "from ... import" vers des modules externes et intégrez toute la logique directement dans le fichier.` });
        } else if (nameErrMatch) {
          errors.push({ type: 'NameError', message: `Nom non défini : ${nameErrMatch[1].trim()}` });
        } else if (typeErrMatch) {
          errors.push({ type: 'TypeError', message: `Erreur de type : ${typeErrMatch[1].trim()}` });
        } else if (keyErrMatch) {
          errors.push({ type: 'KeyError', message: `Clé manquante : ${keyErrMatch[1].trim()}` });
        } else {
          errors.push({ type: 'RuntimeError', message: `Erreur à l'exécution : ${stderr.substring(0, 400)}` });
        }
      }
    } else {
      const stdout = (runResult.stdout || '').trim();
      if (!stdout) {
        errors.push({ type: 'ProtocolError', message: 'Le script ne produit aucune sortie sur stdout — il doit imprimer : print(json.dumps({"result": ..., "state": ...}))' });
      } else {
        try {
          const out = JSON.parse(stdout);
          if (!('result' in out)) errors.push({ type: 'ProtocolError', message: 'Sortie JSON invalide — champ "result" manquant (attendu : {"result": {...}|null, "state": {...}})' });
          if (!('state' in out)) warnings.push({ type: 'MissingState', message: 'Champ "state" absent de la sortie — l\'état ne persistera pas entre les jeux' });
          const r = out.result;
          if (r !== null && r !== undefined) {
            // Formats de retour acceptés : {suit} | "♥" | {predicted} | {prediction} | {suits:[]} | {side} | {value}
            let suit = null, altFormat = null;
            if (typeof r === 'string') { suit = r; altFormat = 'chaîne brute'; }
            else if (typeof r === 'object') {
              if (r.suit)            suit = r.suit;
              else if (r.predicted)  { suit = r.predicted; altFormat = 'predicted'; }
              else if (r.prediction) { suit = r.prediction; altFormat = 'prediction'; }
              else if (Array.isArray(r.suits) && r.suits.length) { suit = r.suits[0]; altFormat = 'suits[]'; }
              else if (r.side)       altFormat = 'side (côté — non consommé par le moteur)';
              else if (r.value)      altFormat = 'value (valeur de carte — non consommé par le moteur)';
              else warnings.push({ type: 'NoSuit', message: 'Le champ "suit" est absent du résultat retourné (résultat ignoré si absent)' });
            } else {
              warnings.push({ type: 'ReturnTypeWarning', message: `Type de retour inattendu : ${typeof r}` });
            }
            if (altFormat && !suit) {
              warnings.push({ type: 'UnsupportedReturnFormat', message: `Format de retour "${altFormat}" détecté — le moteur n'utilisera que le champ "suit". Adaptez votre script pour retourner {"suit": "♠|♥|♦|♣"}.` });
            } else if (altFormat && suit) {
              warnings.push({ type: 'AltReturnFormat', message: `Format de retour "${altFormat}" détecté — normalisé vers {"suit": "${suit}"}` });
            }
            if (suit && !['♠','♥','♦','♣'].includes(suit)) {
              warnings.push({ type: 'InvalidSuit', message: `Costume "${suit}" invalide lors du test — attendu : ♠ ♥ ♦ ♣` });
            }
          }
          if (runResult.stderr?.trim()) warnings.push({ type: 'StderrOutput', message: `Sortie stderr : ${runResult.stderr.trim().substring(0, 200)}` });
        } catch (e) {
          errors.push({ type: 'ProtocolError', message: `Sortie non-JSON : "${stdout.substring(0, 100)}"` });
        }
      }
    }

    // 3. Extraction du nom + vérification des métadonnées requises (stratégie, décalage, main)
    const nameMatch = content.match(/(?:NAME|name|STRATEGY_NAME)\s*=\s*["']([^"']+)["']/);
    if (nameMatch) strategy_name = nameMatch[1];
    else {
      const commentMatch = content.match(/^#\s*(?:name|stratégie|strategy)\s*[:\-]\s*(.+)/im);
      if (commentMatch) strategy_name = commentMatch[1].trim();
      else warnings.push({ type: 'MissingField', message: 'Variable "NAME" (stratégie) absente — un nom par défaut sera utilisé' });
    }
    if (!/^\s*DECALAGE\s*=/m.test(content)) {
      warnings.push({ type: 'MissingField', message: 'Variable "DECALAGE" absente — 1 sera utilisé par défaut' });
    }
    if (!/^\s*HAND\s*=/m.test(content)) {
      warnings.push({ type: 'MissingField', message: 'Variable "HAND" absente — "joueur" sera utilisé par défaut' });
    }
    // Vérifie la gestion des exceptions (try/except)
    if (!/\btry\s*:[\s\S]*?\bexcept\b/.test(content)) {
      warnings.push({ type: 'NoExceptionHandling', message: 'Aucun bloc try/except détecté — la logique de prédiction devrait gérer ses propres exceptions pour éviter d\'interrompre le moteur' });
    }

    if (errors.length === 0) {
      strategy_info = { count: 1, names: [strategy_name], engine_type: 'script_py', entry_fn: detectedFn || null };
    }

  // ── JSX ───────────────────────────────────────────────────────────────────
  } else if (ext === 'jsx' || ext === 'tsx') {
    warnings.push({ type: 'NotExecutable', message: 'Les fichiers JSX/TSX sont stockés comme référence — le moteur ne peut pas les exécuter sans transpilation Babel' });
    const nameMatch = content.match(/name\s*[:=]\s*["'`]([^"'`]+)["'`]/);
    if (nameMatch) strategy_name = nameMatch[1];
    strategy_info = { count: 0, names: [], engine_type: 'jsx_ref' };
  } else {
    errors.push({ type: 'UnsupportedType', message: `Format ".${ext}" non supporté. Formats exécutables : .json, .js, .py` });
  }

  return { ok: errors.length === 0, errors, warnings, strategy_name, strategy_info };
}

// ══════════════════════════════════════════════════════════════════
// MULTI-STRATÉGIES PRO — jusqu'à 100 slots, isolés par owner_user_id
// Stockage :
//   pro_strategies_list      = JSON [{ id, owner_user_id, filename, ... }, ...]  (GLOBAL)
//   pro_strategy_{id}_content = contenu brut (utf8)
//   pro_strategy_{id}_meta    = meta complète (inclut owner_user_id)
//   pro_strategy_ids          = JSON ["S5001", ...] (uniquement les actives & owner non désactivé)
//   pro_telegram_config_{userId} = { bot_token, channel_id, ... } par compte Pro
// IDs : 5001..5100, alloués globalement mais filtrés par owner pour Pro
// ══════════════════════════════════════════════════════════════════
const PRO_BASE_ID   = 5000;
const PRO_MAX_SLOTS = 100;
const PRO_MAX_PER_OWNER = 10;  // chaque Pro peut avoir jusqu'à 10 stratégies

// Récupère la liste globale ; assigne owner_user_id aux entrées legacy
async function getProStrategiesList() {
  const raw = await db.getSetting('pro_strategies_list').catch(() => null);
  let list = [];
  if (raw) { try { list = JSON.parse(raw); } catch {} }
  if (!Array.isArray(list)) list = [];

  // ── Migration automatique de l'ancien système (un seul fichier) ──
  if (!list.length) {
    const oldContent = await db.getSetting('pro_strategy_file_content').catch(() => null);
    const oldMetaRaw = await db.getSetting('pro_strategy_file_meta').catch(() => null);
    if (oldContent && oldMetaRaw) {
      try {
        const oldMeta = JSON.parse(oldMetaRaw);
        const id = PRO_BASE_ID + 1; // 5001
        const adm = await pickFallbackAdminId();
        const migrated = { ...oldMeta, id, owner_user_id: adm, created_at: oldMeta.updated_at || new Date().toISOString() };
        list = [{
          id, owner_user_id: adm,
          filename: oldMeta.filename || 'legacy.js', file_type: oldMeta.file_type || 'js',
          strategy_name: oldMeta.strategy_name || 'Stratégie Pro',
          engine_type: oldMeta.engine_type || 'script_js',
          engine_loaded: oldMeta.engine_loaded !== false,
          created_at: migrated.created_at, updated_at: oldMeta.updated_at || migrated.created_at,
        }];
        await db.setSetting('pro_strategies_list', JSON.stringify(list));
        await db.setSetting(`pro_strategy_${id}_content`, oldContent);
        await db.setSetting(`pro_strategy_${id}_meta`, JSON.stringify(migrated));
        console.log(`[Pro] 🔁 Migration legacy → slot S${id} "${oldMeta.strategy_name}" (owner=${adm})`);
      } catch (e) { console.warn('[Pro] Migration legacy échouée:', e.message); }
    }
  }

  // ── Backfill owner_user_id pour les entrées sans propriétaire ──
  let needsResave = false;
  const fallbackOwnerId = await pickFallbackAdminId();
  for (const s of list) {
    if (!s.owner_user_id) { s.owner_user_id = fallbackOwnerId; needsResave = true; }
  }
  if (needsResave) {
    await db.setSetting('pro_strategies_list', JSON.stringify(list));
    // Backfill aussi les meta
    for (const s of list) {
      try {
        const mRaw = await db.getSetting(`pro_strategy_${s.id}_meta`).catch(() => null);
        if (mRaw) {
          const m = JSON.parse(mRaw);
          if (!m.owner_user_id) {
            m.owner_user_id = s.owner_user_id;
            await db.setSetting(`pro_strategy_${s.id}_meta`, JSON.stringify(m));
          }
        }
      } catch {}
    }
    console.log(`[Pro] 🔁 Backfill owner_user_id sur ${list.length} stratégie(s) → admin ${fallbackOwnerId}`);
  }

  return list;
}

let __fallbackAdminCache = null;
async function pickFallbackAdminId() {
  if (__fallbackAdminCache) return __fallbackAdminCache;
  try {
    const all = await db.getAllUsers();
    const adm = all.find(u => u.is_admin && (u.admin_level || 2) === 1) || all.find(u => u.is_admin);
    __fallbackAdminCache = adm ? adm.id : 1;
    return __fallbackAdminCache;
  } catch { return 1; }
}

// Filtre la liste globale pour ne garder que les stratégies du propriétaire
async function getProStrategiesListForOwner(ownerId) {
  const list = await getProStrategiesList();
  return list.filter(s => s.owner_user_id === ownerId);
}

async function saveProStrategiesList(list) {
  await db.setSetting('pro_strategies_list', JSON.stringify(list));
  // Liste des IDs actifs : ignorer les stratégies dont l'owner est désactivé (pour le moteur)
  const ownersDisabled = new Set();
  try {
    const all = await db.getAllUsers();
    for (const u of all) {
      if (!u.is_pro && !u.is_admin) ownersDisabled.add(u.id);
    }
  } catch {}
  const loadedIds = list
    .filter(s => s.engine_loaded !== false && !ownersDisabled.has(s.owner_user_id))
    .map(s => `S${s.id}`);
  await db.setSetting('pro_strategy_ids', JSON.stringify(loadedIds));
}

function allocateProId(list) {
  const used = new Set(list.map(s => s.id));
  for (let i = 1; i <= PRO_MAX_SLOTS; i++) {
    const id = PRO_BASE_ID + i;
    if (!used.has(id)) return id;
  }
  return null;
}

// ── POST : créer une NOUVELLE stratégie (nouveau slot) OU modifier (id fourni) ──
router.post('/pro-strategy-file', requireProOrAdmin, async (req, res) => {
  const { filename, content, mimetype, id: explicitId } = req.body;
  if (!filename || content === undefined)
    return res.status(400).json({ error: 'Nom de fichier et contenu requis' });
  try {
    const ext = (filename.split('.').pop() || '').toLowerCase();
    const EXEC_TYPES = ['json', 'js', 'mjs', 'py'];
    const analysis = analyzeStrategyFile(ext, content, filename);

    let list = await getProStrategiesList();
    let entryId;
    let isUpdate = false;
    const sessionOwnerId = effectiveOwnerId(req);
    let entryOwnerId = sessionOwnerId;

    if (explicitId !== undefined && explicitId !== null && explicitId !== '') {
      entryId = parseInt(explicitId);
      const found = list.find(s => s.id === entryId);
      if (!found) return res.status(404).json({ error: `Stratégie ID ${explicitId} introuvable` });
      // Vérification ownership : un Pro ne peut modifier que ses stratégies
      if (!req.session.isAdmin && found.owner_user_id !== req.session.userId) {
        return res.status(403).json({ error: 'Cette stratégie ne vous appartient pas' });
      }
      entryOwnerId = found.owner_user_id;
      isUpdate = true;
    } else {
      // Quota par propriétaire
      const ownerCount = list.filter(s => s.owner_user_id === sessionOwnerId).length;
      if (ownerCount >= PRO_MAX_PER_OWNER) {
        return res.status(409).json({
          error: `Nombre maximum de stratégies Pro pour ce compte atteint (${PRO_MAX_PER_OWNER}). Supprimez-en une avant d'en importer une nouvelle.`,
        });
      }
      entryId = allocateProId(list);
      if (entryId === null) {
        return res.status(409).json({
          error: `Nombre maximum global de stratégies Pro atteint (${PRO_MAX_SLOTS}).`,
        });
      }
    }

    const existing = isUpdate ? list.find(s => s.id === entryId) : null;
    const now = new Date().toISOString();
    const meta = {
      id: entryId,
      owner_user_id: entryOwnerId,
      filename,
      mimetype: mimetype || 'text/plain',
      size: content.length,
      created_at: existing?.created_at || now,
      updated_at: now,
      file_type: ext,
      engine_type: analysis.strategy_info.engine_type || ext,
      strategy_name: analysis.strategy_name,
      strategy_names: analysis.strategy_info.names || [analysis.strategy_name],
      strategy_count: analysis.strategy_info.count || (analysis.ok ? 1 : 0),
      strategy_info: analysis.strategy_info,
      engine_loaded: analysis.ok && EXEC_TYPES.includes(ext),
      validation_errors: analysis.errors,
      validation_warnings: analysis.warnings,
    };

    if (!analysis.ok) {
      console.warn(`[Pro S${entryId}][uid=${entryOwnerId}] ❌ Analyse ${ext.toUpperCase()} "${filename}" — ${analysis.errors.length} erreur(s) :`);
      analysis.errors.forEach(e => console.warn(`   [${e.type}]${e.line ? ' ligne '+e.line : ''} ${e.message}`));
      return res.status(422).json({
        ok: false, validation_failed: true, id: entryId, isUpdate,
        errors: analysis.errors, warnings: analysis.warnings, meta,
      });
    }

    await db.setSetting(`pro_strategy_${entryId}_content`, content);
    await db.setSetting(`pro_strategy_${entryId}_meta`, JSON.stringify(meta));

    const entry = {
      id: entryId, owner_user_id: entryOwnerId,
      filename, file_type: ext,
      strategy_name: analysis.strategy_name,
      engine_type: meta.engine_type,
      engine_loaded: meta.engine_loaded,
      created_at: meta.created_at, updated_at: meta.updated_at,
    };
    if (isUpdate) list = list.map(s => s.id === entryId ? entry : s);
    else list.push(entry);
    await saveProStrategiesList(list);

    console.log(`[Pro S${entryId}][uid=${entryOwnerId}] ✅ ${isUpdate ? 'Modifiée' : 'Créée'} — ${ext.toUpperCase()} "${filename}" "${analysis.strategy_name}" | ${analysis.warnings.length} avertissement(s)`);
    if (analysis.warnings.length) {
      analysis.warnings.forEach(w => console.warn(`   [${w.type}]${w.line ? ' ligne '+w.line : ''} ${w.message}`));
    }

    let engineError = null;
    if (EXEC_TYPES.includes(ext)) {
      try { await require('./engine').reloadProStrategies(); }
      catch (e) { engineError = e.message; console.error('[Pro] Erreur rechargement moteur:', e.message); }
    }

    res.json({ ok: true, id: entryId, owner_user_id: entryOwnerId, isUpdate, meta, warnings: analysis.warnings, engine_error: engineError || undefined });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── GET : liste filtrée par propriétaire (+ 1ᵉʳ élément pour rétrocompat UI) ──
router.get('/pro-strategy-file', requireProOrAdmin, async (req, res) => {
  try {
    const ownerId = effectiveOwnerId(req);
    const allList = await getProStrategiesList();
    const list = allList.filter(s => s.owner_user_id === ownerId);
    const strategies = [];
    for (const entry of list) {
      const metaRaw = await db.getSetting(`pro_strategy_${entry.id}_meta`).catch(() => null);
      const meta = metaRaw ? JSON.parse(metaRaw) : { ...entry };
      if (!meta.owner_user_id) meta.owner_user_id = entry.owner_user_id;
      strategies.push(meta);
    }
    let firstMeta = null, firstContent = null;
    if (strategies.length) {
      firstMeta = strategies[0];
      firstContent = await db.getSetting(`pro_strategy_${strategies[0].id}_content`).catch(() => null);
    }
    res.json({
      meta: firstMeta, content: firstContent, strategies,
      total: strategies.length, max: PRO_MAX_PER_OWNER,
      owner_user_id: ownerId,
    });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── GET : récupérer contenu + meta d'une stratégie précise (avec contrôle d'accès) ──
router.get('/pro-strategy-file/:id', requireProOrAdmin, async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    const metaRaw = await db.getSetting(`pro_strategy_${id}_meta`).catch(() => null);
    if (!metaRaw) return res.status(404).json({ error: 'Stratégie introuvable' });
    const meta = JSON.parse(metaRaw);
    if (!req.session.isAdmin && meta.owner_user_id !== req.session.userId) {
      return res.status(403).json({ error: 'Cette stratégie ne vous appartient pas' });
    }
    const content = await db.getSetting(`pro_strategy_${id}_content`).catch(() => null);
    res.json({ id, meta, content });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── DELETE : supprimer UNE stratégie (avec contrôle d'accès) ──
router.delete('/pro-strategy-file/:id', requireProOrAdmin, async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    let list = await getProStrategiesList();
    const found = list.find(s => s.id === id);
    if (!found) return res.status(404).json({ error: 'Stratégie introuvable' });
    if (!req.session.isAdmin && found.owner_user_id !== req.session.userId) {
      return res.status(403).json({ error: 'Cette stratégie ne vous appartient pas' });
    }
    list = list.filter(s => s.id !== id);
    await saveProStrategiesList(list);
    await db.setSetting(`pro_strategy_${id}_content`, '');
    await db.setSetting(`pro_strategy_${id}_meta`, '');
    try {
      const removed = await db.deleteStrategyPredictions(`S${id}`).catch(() => 0);
      if (removed) console.log(`[Pro S${id}] ${removed} prédiction(s) supprimée(s) avec la stratégie`);
    } catch {}
    try { require('./engine').reloadProStrategies().catch(() => {}); } catch {}
    console.log(`[Pro S${id}][uid=${found.owner_user_id}] 🗑 Stratégie "${found.strategy_name || found.filename}" supprimée`);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── DELETE : supprimer toutes les stratégies du propriétaire effectif ──
router.delete('/pro-strategy-file', requireProOrAdmin, async (req, res) => {
  try {
    const ownerId = effectiveOwnerId(req);
    const fullList = await getProStrategiesList();
    const toDelete = fullList.filter(s => s.owner_user_id === ownerId);
    for (const s of toDelete) {
      await db.setSetting(`pro_strategy_${s.id}_content`, '');
      await db.setSetting(`pro_strategy_${s.id}_meta`, '');
      try { await db.deleteStrategyPredictions(`S${s.id}`); } catch {}
    }
    const remaining = fullList.filter(s => s.owner_user_id !== ownerId);
    await saveProStrategiesList(remaining);
    // Legacy cleanup uniquement si on supprime tout en mode admin (no remaining)
    if (!remaining.length && req.session.isAdmin) {
      await db.setSetting('pro_strategy_file_meta', '');
      await db.setSetting('pro_strategy_file_content', '');
    }
    try { require('./engine').reloadProStrategies().catch(() => {}); } catch {}
    res.json({ ok: true, deleted: toDelete.length, owner_user_id: ownerId });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Recharger config Telegram Pro dans le moteur (appelé après modification de la config)
router.post('/pro-config/reload', requireProOrAdmin, async (req, res) => {
  try {
    require('./engine').reloadProStrategies().catch(() => {});
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ══════════════════════════════════════════════════════════════════
// FORMATS DE MESSAGE PERSONNALISÉS (custom_tg_formats)
// Stockés en DB, nombre illimité, référençables par tg_format > 18
// ══════════════════════════════════════════════════════════════════

router.get('/tg-formats', requireAdmin, async (req, res) => {
  try {
    const rows = await db.getCustomFormats();
    res.json({ formats: rows });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.post('/tg-formats', requireAdmin, async (req, res) => {
  try {
    const { name, template, parse_mode } = req.body || {};
    if (!name || !name.trim())     return res.status(400).json({ error: 'Le champ "name" est requis' });
    if (!template || !template.trim()) return res.status(400).json({ error: 'Le champ "template" est requis' });
    const row = await db.saveCustomFormat({ name: name.trim(), template: template.trim(), parse_mode: parse_mode || null });
    res.json({ ok: true, format: row });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.put('/tg-formats/:id', requireAdmin, async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    const { name, template, parse_mode } = req.body || {};
    if (!name || !name.trim())     return res.status(400).json({ error: 'Le champ "name" est requis' });
    if (!template || !template.trim()) return res.status(400).json({ error: 'Le champ "template" est requis' });
    const row = await db.updateCustomFormat(id, { name: name.trim(), template: template.trim(), parse_mode: parse_mode || null });
    if (!row) return res.status(404).json({ error: 'Format introuvable' });
    res.json({ ok: true, format: row });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.delete('/tg-formats/:id', requireAdmin, async (req, res) => {
  try {
    await db.deleteCustomFormat(parseInt(req.params.id));
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ════════════════════════════════════════════════════════════════════
// LIVE BROADCAST — diffusion en temps réel des jeux vers Telegram
// ════════════════════════════════════════════════════════════════════
const liveBroadcast = require('./live-broadcast');

router.get('/live-broadcast/targets', requireAdmin, async (req, res) => {
  try { res.json({ targets: await liveBroadcast.listTargets() }); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

router.post('/live-broadcast/targets', requireAdmin, async (req, res) => {
  try {
    const { bot_token, channel_id, label } = req.body || {};
    if (!bot_token || !channel_id) return res.status(400).json({ error: 'bot_token et channel_id requis' });
    const t = await liveBroadcast.addTarget({ bot_token, channel_id, label });
    res.json({ ok: true, target: { id: t.id, label: t.label, channel_id: t.channel_id, enabled: t.enabled } });
  } catch (e) { res.status(400).json({ error: e.message }); }
});

router.delete('/live-broadcast/targets/:id', requireAdmin, async (req, res) => {
  try { await liveBroadcast.removeTarget(req.params.id); res.json({ ok: true }); }
  catch (e) { res.status(404).json({ error: e.message }); }
});

router.patch('/live-broadcast/targets/:id', requireAdmin, async (req, res) => {
  try {
    const { enabled } = req.body || {};
    await liveBroadcast.setTargetEnabled(req.params.id, !!enabled);
    res.json({ ok: true });
  } catch (e) { res.status(400).json({ error: e.message }); }
});

router.post('/live-broadcast/targets/:id/test', requireAdmin, async (req, res) => {
  try {
    const r = await liveBroadcast.sendTestMessage(req.params.id);
    res.json(r);
  } catch (e) { res.status(400).json({ error: e.message }); }
});

module.exports = router;
