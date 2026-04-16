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
    renderSync.syncUser(user).catch(() => {});
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
    renderSync.syncUser(user).catch(() => {});
    res.json({ message: `Prolongé de ${fmtDuration(mins)}`, user });
  } catch (e) { res.status(500).json({ error: 'Erreur serveur' }); }
});

router.post('/users/:id/reject', requireAdmin, async (req, res) => {
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

  const B = parseInt(threshold);
  if (isNaN(B) || B < 1 || B > 50) return 'Seuil B invalide (1–50)';
  if (!['manquants', 'apparents', 'absence_apparition', 'apparition_absence', 'taux_miroir', 'distribution'].includes(mode)) return 'Mode invalide';
  if (mode !== 'distribution') {
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
  console.log('[Strategy POST] Requête reçue:', JSON.stringify(req.body).substring(0, 200));
  try {
    const err = validateStrategyBody(req.body);
    if (err) { console.log('[Strategy POST] Validation échouée:', err); return res.status(400).json({ error: err }); }
    const { name, threshold, mode, mappings, visibility, enabled, prediction_offset, hand, max_rattrapage, tg_format,
            strategy_type, multi_source_ids, multi_require, loss_type, relance_rules } = req.body;
    const tg_targets = parseTgTargets(req.body.tg_targets);
    const exceptions = parseExceptions(req.body.exceptions);
    const isComb     = strategy_type === 'combinaison';
    const isRelance  = mode === 'relance';
    const normalizedMappings = (isComb || isRelance) ? null : normalizeMappings(mappings);
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
        : { threshold: parseInt(threshold), mode, mappings: normalizedMappings }),
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
        ? Math.max(1, Math.min(11, parseInt(tg_format) || 1)) : null,
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
    const tg_targets = parseTgTargets(req.body.tg_targets);
    const exceptions = parseExceptions(req.body.exceptions);
    const isComb    = strategy_type === 'combinaison';
    const isRelance = mode === 'relance';
    const normalizedMappings = (isComb || isRelance) ? null : normalizeMappings(mappings);
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
        : { threshold: parseInt(threshold), mode, mappings: normalizedMappings }),
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
        ? Math.max(1, Math.min(11, parseInt(tg_format) || 1)) : null,
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

// ── Compteurs miroir (taux_miroir) en temps réel ──────────────────
router.get('/strategies/:id/mirror-counts', requireAdmin, (req, res) => {
  try {
    const id = parseInt(req.params.id);
    const entry = engine.custom?.[id];
    if (!entry) return res.json({ counts: {}, threshold: 0 });
    const counts = entry.mirrorCounts || {};
    const threshold = entry.config?.threshold || 0;
    res.json({ counts, threshold });
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

// ── Nettoyage complet des prédictions (sans toucher aux configs) ──
// Supprime : predictions, tg_pred_messages
// Remet à 0 : engine_absences, bilan_last, pending en mémoire, compteurs absences moteur
// Conserve : users, telegram_config, strategy_channel_routes, custom_strategies,
//            tg_msg_format, ui_styles, sessions, render_db_url, broadcast_message
router.post('/reset-all-stats', requireAdmin, async (req, res) => {
  try {
    const pool = db.pool;
    // 1. Supprimer toutes les prédictions
    const r = await pool.query(`DELETE FROM predictions`);
    const deleted = r.rowCount;
    // 2. Supprimer les message_id Telegram stockés
    await pool.query(`DELETE FROM tg_pred_messages`).catch(() => {});
    // 3. Remettre les compteurs d'absences à zéro (engine_absences)
    const SUITS = ['♠','♥','♦','♣'];
    const zero  = Object.fromEntries(SUITS.map(s => [s, 0]));
    const absReset = JSON.stringify({ c1: {...zero}, c2: {...zero}, c3: {...zero} });
    await pool.query(`INSERT INTO settings(key,value) VALUES('engine_absences',$1)
      ON CONFLICT(key) DO UPDATE SET value=EXCLUDED.value`, [absReset]).catch(() => {});
    // 4. Supprimer le bilan quotidien (obsolète sans prédictions)
    await pool.query(`DELETE FROM settings WHERE key='bilan_last'`).catch(() => {});
    // 5. Réinitialiser le moteur en mémoire
    const eng = require('./engine');
    if (eng) {
      if (eng.clearAllPending) eng.clearAllPending();
      if (eng.resetAbsences)   eng.resetAbsences();
    }
    console.log(`[Admin] Clean predictions — ${deleted} supprimée(s), absences remises à 0`);
    res.json({ ok: true, deleted, details: {
      predictions_deleted: deleted,
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

router.post('/user-messages/:id/reply', requireAdmin, async (req, res) => {
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

// ── Reset complet (retour usine) ─────────────────────────────────────────────
router.post('/factory-reset', requireAdmin, async (req, res) => {
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

// Téléchargement du ZIP de déploiement (fichiers actuels sur disque)
router.get('/project-backup/zip', requireAdmin, (req, res) => {
  try {
    const archiver = require('archiver');
    const root     = path.join(__dirname);
    const files    = scanProjectFiles(root, '');
    const date     = new Date().toISOString().slice(0, 10);
    const filename = `baccarat-pro-${date}.zip`;

    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);

    const archive = archiver('zip', { zlib: { level: 6 } });
    archive.on('error', (err) => { console.error('[ZIP]', err.message); res.end(); });
    archive.pipe(res);

    for (const f of files) {
      archive.file(f.fullPath, { name: f.relPath });
    }

    archive.finalize();
    console.log(`[ZIP] Archive générée : ${files.length} fichiers → ${filename}`);
  } catch (e) {
    console.error('[ZIP] Erreur:', e.message);
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
router.get('/deploy-logs', requireAdmin, async (req, res) => {
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

module.exports = router;
