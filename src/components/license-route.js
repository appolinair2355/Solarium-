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

module.exports = router;
