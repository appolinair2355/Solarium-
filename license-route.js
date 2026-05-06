'use strict';
/**
 * license-route.js — Vérification de licence pour les bots déployés.
 * Endpoint public (pas d'authentification) appelé par les bots achetés.
 * GET /api/license/check?key=XXXX
 */

const express = require('express');
const router  = express.Router();
const db      = require('./db');

// ── GET /api/license/check?key=XXX ─────────────────────────────────────────
router.get('/check', async (req, res) => {
  const key = (req.query.key || '').trim();
  if (!key) return res.json({ valid: false, message: 'Cle de licence manquante' });

  try {
    const license = await db.getLicenseByKey(key);
    if (!license) return res.json({ valid: false, message: 'Licence inconnue' });

    if (license.status === 'revoked')
      return res.json({ valid: false, message: 'Licence revoquee par l\'administrateur' });
    if (license.status === 'suspended')
      return res.json({ valid: false, message: 'Licence suspendue' });

    const isFirstPing = !license.deploy_count || parseInt(license.deploy_count) === 0;
    const clientIp    = (req.headers['x-forwarded-for'] || '').split(',')[0].trim()
                        || req.socket?.remoteAddress
                        || null;

    await db.pingLicense(key, clientIp);

    if (isFirstPing) {
      _notifyAdminDeploy(license, clientIp).catch(() => {});
    }

    return res.json({ valid: true, strategy: license.strategy_name, message: 'Licence active' });
  } catch (e) {
    console.error('[License] Erreur verification:', e.message);
    return res.json({ valid: true, message: 'Verification partielle (erreur serveur)' });
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
      `\uD83D\uDE80 <b>NOUVEAU D\u00C9PLOIEMENT D\u00C9TECT\u00C9</b>\n\n` +
      `\uD83D\uDCE6 Strat\u00E9gie : <b>${license.strategy_name}</b> (S${license.strategy_id})\n` +
      `\uD83D\uDD11 Licence : <code>${license.license_key}</code>\n` +
      `\uD83C\uDF10 IP de d\u00E9ploiement : <code>${ip || 'inconnue'}</code>\n` +
      `\uD83D\uDCC5 Date : ${now}\n\n` +
      `\u2139\uFE0F Rendez-vous dans Admin \u2192 Achats \u2192 Licences pour g\u00E9rer cette licence.`;

    await (await fetch)(`https://api.telegram.org/bot${token}/sendMessage`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ chat_id: adminId, text, parse_mode: 'HTML' }),
    });
  } catch {}
}

// ── GET /api/license/strategy?key=XXX ──────────────────────────────────────
// Retourne la configuration de la stratégie associée à la licence.
// Le bot la télécharge au démarrage — la stratégie n'est JAMAIS dans le ZIP.
router.get('/strategy', async (req, res) => {
  const key = (req.query.key || '').trim();
  if (!key) return res.json({ ok: false, error: 'Cle manquante' });

  try {
    const license = await db.getLicenseByKey(key);
    if (!license)                      return res.json({ ok: false, error: 'Licence inconnue' });
    if (license.status === 'revoked')  return res.json({ ok: false, error: 'Licence revoquee' });
    if (license.status === 'suspended')return res.json({ ok: false, error: 'Licence suspendue' });

    // Chercher la stratégie dans custom_strategies (JSON stocké en DB)
    let strat = null;
    try {
      const raw = await db.getSetting('custom_strategies');
      const list = raw ? JSON.parse(raw) : [];
      strat = list.find(s => String(s.id) === String(license.strategy_id));
    } catch (e) {
      console.warn('[License/strategy] Parse error:', e.message);
    }

    if (!strat) return res.json({ ok: false, error: 'Strategie introuvable' });

    // Retourner uniquement les champs techniques nécessaires au predictor
    // (pas le nom complet, pas les stats, pas les métadonnées commerciales)
    return res.json({
      ok: true,
      strategy: {
        id:                strat.id,
        name:              strat.name              || ('Stratégie #' + strat.id),
        mode:              strat.mode,
        threshold:         strat.threshold         !== undefined ? strat.threshold : 5,
        mappings:          strat.mappings           || {},
        hand:              strat.hand               || 'joueur',
        max_rattrapage:    strat.max_rattrapage     !== undefined ? strat.max_rattrapage : 3,
        prediction_offset: strat.prediction_offset  !== undefined ? strat.prediction_offset : 1,
        mirror_pairs:      strat.mirror_pairs       || [],
        exceptions:        strat.exceptions         || [],
        // Champs lecture_passee
        carte_p:           strat.carte_p            || null,
        carte_h:           strat.carte_h            || null,
        carte_ecart:       strat.carte_ecart        || null,
        carte_position:    strat.carte_position     || null,
        carte_source_hand: strat.carte_source_hand  || null,
        // Champs first_card_plus6
        proche:            strat.proche             || null,
        banker_card_count: strat.banker_card_count  || null,
        fc_ecart:          strat.fc_ecart           || null,
        // Champs multi_strategy / union_enseignes
        multi_source_ids:  strat.multi_source_ids   || null,
        multi_require:     strat.multi_require       || null,
      },
    });
  } catch (e) {
    console.error('[License/strategy] Erreur:', e.message);
    return res.json({ ok: false, error: 'Erreur serveur' });
  }
});

// ── GET /api/license/feed?key=XXX ──────────────────────────────────────────
// Retourne les derniers jeux terminés pour les bots déployés.
// Authentifié par la clé de licence (pas de session requise).
router.get('/feed', async (req, res) => {
  const key = (req.query.key || '').trim();
  if (!key) return res.json({ ok: false, error: 'Cle de licence manquante' });

  try {
    const license = await db.getLicenseByKey(key);
    if (!license) return res.json({ ok: false, error: 'Licence inconnue' });
    if (license.status === 'revoked')
      return res.json({ ok: false, error: 'Licence revoquee' });
    if (license.status === 'suspended')
      return res.json({ ok: false, error: 'Licence suspendue' });

    // Récupérer le cache live des jeux depuis le module games
    let games = [];
    try {
      const { getGamesCache } = require('./games');
      const cache = getGamesCache();
      // Retourner uniquement les jeux terminés avec un gagnant
      games = cache
        .filter(g => g.is_finished && g.winner)
        .map(g => ({
          game_number:  g.game_number,
          winner:       g.winner,        // 'Player' | 'Banker' | 'Tie'
          player_cards: g.player_cards,
          banker_cards: g.banker_cards,
          player_score: (g.score && g.score.B1) != null ? g.score.B1 : null,
          banker_score: (g.score && g.score.B2) != null ? g.score.B2 : null,
        }));
    } catch (e) {
      console.warn('[License/feed] Impossible de lire le cache jeux:', e.message);
    }

    return res.json({ ok: true, games });
  } catch (e) {
    console.error('[License/feed] Erreur:', e.message);
    return res.json({ ok: true, games: [] });
  }
});

module.exports = router;
