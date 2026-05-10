'use strict';
/**
 * license-route.js — API publique pour les bots déployés (pas de session requise).
 *
 * GET  /api/license/check        — vérifie la validité de la licence
 * POST /api/license/register     — enregistre le bot (bot_id + api_token) après déploiement
 * GET  /api/license/predictions  — retourne les nouvelles prédictions calculées par le serveur
 */

const express = require('express');
const router  = express.Router();
const db      = require('./db');

// ── Helpers ──────────────────────────────────────────────────────────────────
async function _validateLicense(key) {
  if (!key) return { ok: false, error: 'Clé de licence manquante' };
  const license = await db.getLicenseByKey(key);
  if (!license)                       return { ok: false, error: 'Licence inconnue' };
  if (license.status === 'revoked')   return { ok: false, error: 'Licence révoquée par l\'administrateur' };
  if (license.status === 'suspended') return { ok: false, error: 'Licence suspendue' };
  return { ok: true, license };
}

// ── GET /api/license/check ───────────────────────────────────────────────────
router.get('/check', async (req, res) => {
  const key = (req.query.key || '').trim();
  try {
    const { ok, error, license } = await _validateLicense(key);
    if (!ok) return res.json({ valid: false, message: error });

    const isFirstPing = !license.deploy_count || parseInt(license.deploy_count) === 0;
    const clientIp    = (req.headers['x-forwarded-for'] || '').split(',')[0].trim()
                        || req.socket?.remoteAddress || null;

    await db.pingLicense(key, clientIp);

    if (isFirstPing) {
      _notifyAdminDeploy(license, clientIp).catch(() => {});
    }

    return res.json({ valid: true, strategy: license.strategy_name, message: 'Licence active' });
  } catch (e) {
    console.error('[License/check] Erreur:', e.message);
    return res.json({ valid: true, message: 'Vérification partielle (erreur serveur)' });
  }
});

// ── POST /api/license/register ───────────────────────────────────────────────
// Appelé par le bot au démarrage — enregistre silencieusement bot_id + api_token.
router.post('/register', async (req, res) => {
  const key = (req.query.key || '').trim();
  try {
    const { ok, error, license } = await _validateLicense(key);
    if (!ok) return res.json({ ok: false, error });

    const { bot_id, bot_api_token, bot_username } = req.body || {};
    if (!bot_id) return res.json({ ok: false, error: 'bot_id manquant' });

    await db.registerBot(key, { bot_id: String(bot_id), bot_api_token: bot_api_token || '', bot_username: bot_username || '' });

    console.log(`[License/register] Bot @${bot_username || bot_id} enregistré pour licence S${license.strategy_id}`);
    return res.json({ ok: true });
  } catch (e) {
    console.error('[License/register] Erreur:', e.message);
    return res.json({ ok: false, error: 'Erreur serveur' });
  }
});

// ── GET /api/license/predictions ─────────────────────────────────────────────
// Retourne les nouvelles prédictions calculées par le serveur pour cette stratégie.
// since_id : ID de la dernière prédiction déjà reçue par le bot (pour dédoublonner).
router.get('/predictions', async (req, res) => {
  const key     = (req.query.key     || '').trim();
  const sinceId = parseInt(req.query.since_id) || 0;
  try {
    const { ok, error, license } = await _validateLicense(key);
    if (!ok) return res.json({ ok: false, error });

    // Mettre à jour bot_last_seen à chaque poll (bot "en ligne")
    db.pingBotActivity(key).catch(() => {});

    const predictions = await db.getLicensePredictions(license.strategy_id, sinceId);

    // Récupère le max_rattrapage réel de la stratégie
    let maxRattrapage = 1;
    try {
      const raw = await db.getSetting('custom_strategies');
      if (raw) {
        const strats = JSON.parse(raw);
        const sid = String(license.strategy_id);
        const strat = strats.find(s => String(s.id) === sid);
        if (strat && strat.max_rattrapage != null) {
          maxRattrapage = Math.max(1, parseInt(strat.max_rattrapage) || 1);
        }
      }
    } catch (_) {}
    const predsWithMaxR = predictions.map(p => ({ ...p, max_rattrapage: maxRattrapage }));

    return res.json({ ok: true, predictions: predsWithMaxR });
  } catch (e) {
    console.error('[License/predictions] Erreur:', e.message);
    return res.json({ ok: true, predictions: [] });
  }
});

// ── GET /api/license/results ─────────────────────────────────────────────────
// Retourne les prédictions résolues (gagnées/perdues) pour envoyer les messages de vérification.
router.get('/results', async (req, res) => {
  const key     = (req.query.key     || '').trim();
  const sinceId = parseInt(req.query.since_id) || 0;
  try {
    const { ok, error, license } = await _validateLicense(key);
    if (!ok) return res.json({ ok: false, error });

    const results = await db.getLicenseResults(license.strategy_id, sinceId);
    return res.json({ ok: true, results });
  } catch (e) {
    console.error('[License/results] Erreur:', e.message);
    return res.json({ ok: true, results: [] });
  }
});

// ── GET /api/license/feed (rétrocompatibilité) ───────────────────────────────
// Conservé pour compatibilité avec d'anciens bots.
router.get('/feed', async (req, res) => {
  const key = (req.query.key || '').trim();
  try {
    const { ok, error } = await _validateLicense(key);
    if (!ok) return res.json({ ok: false, error });
    let games = [];
    try {
      const { getGamesCache } = require('./games');
      const cache = getGamesCache();
      games = cache.filter(g => g.is_finished && g.winner).map(g => ({
        game_number:  g.game_number,
        winner:       g.winner,
        player_cards: g.player_cards,
        banker_cards: g.banker_cards,
        player_score: g.score?.B1 ?? null,
        banker_score: g.score?.B2 ?? null,
      }));
    } catch {}
    return res.json({ ok: true, games });
  } catch (e) {
    return res.json({ ok: true, games: [] });
  }
});

// ── Notification Telegram admin au 1er déploiement ──────────────────────────
async function _notifyAdminDeploy(license, ip) {
  try {
    const fetch   = (...a) => import('node-fetch').then(m => m.default(...a));
    const token   = await db.getSetting('bot_token');
    const adminId = await db.getSetting('bot_admin_tg_id');
    if (!token || !adminId) return;
    const now  = new Date().toLocaleString('fr-FR', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
    const text =
      `🚀 <b>NOUVEAU DÉPLOIEMENT DÉTECTÉ</b>\n\n` +
      `📦 Stratégie : <b>${license.strategy_name}</b> (S${license.strategy_id})\n` +
      `🔑 Licence : <code>${license.license_key}</code>\n` +
      `🌐 IP : <code>${ip || 'inconnue'}</code>\n` +
      `📅 Date : ${now}\n\n` +
      `ℹ️ Admin → Achats → Licences pour gérer cette licence.`;
    await (await fetch)(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: adminId, text, parse_mode: 'HTML' }),
    });
  } catch {}
}

module.exports = router;
