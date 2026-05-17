'use strict';
/**
 * pub-scheduler.js — Envoi automatique de publicités stratégies via Telegram
 *
 * Chaque stratégie peut configurer :
 *   - pub_enabled            : true/false
 *   - pub_strategies         : [{ id, price }] — stratégies à promouvoir avec leur prix
 *   - pub_interval_minutes   : 5 | 30 | 60 | 120 | 300 | 600
 *
 * Le scheduler tourne toutes les minutes et vérifie si c'est l'heure d'envoyer.
 * La publicité est envoyée sur les canaux Telegram (tg_targets) de la stratégie.
 */

const { sendTelegramMsg }   = require('./announcement-sender');
const db                    = require('./db');

const MKTG_PREFIXES = ['Protocole', 'Système', 'Méthode', 'Formule', 'Module', 'Signal'];
const MKTG_GEMS     = ['Platine', 'Émeraude', 'Saphir', 'Rubis', 'Diamant', 'Cristal', 'Cobalt', 'Ambre', 'Jade', 'Opale', 'Topaze', 'Onyx'];
const MKTG_SUFFIXES = ['Pro', 'Élite', 'Expert', 'Premium', 'Prestige', 'Master', 'Ultra', 'VIP'];

function generateMarketingName(strategyId) {
  const id = parseInt(strategyId) || 0;
  return `${MKTG_PREFIXES[id % MKTG_PREFIXES.length]} ${MKTG_GEMS[(id * 3) % MKTG_GEMS.length]} ${MKTG_SUFFIXES[(id * 7) % MKTG_SUFFIXES.length]}`;
}

/** Récupère le bilan live d'une stratégie depuis la DB */
async function getStratBilan(stratId) {
  if (!db.pool) return null;
  try {
    const { rows } = await db.pool.query(
      `SELECT
         COUNT(*) FILTER (WHERE status = 'gagne') AS wins,
         COUNT(*) FILTER (WHERE status = 'perdu') AS losses
       FROM predictions WHERE strategy = $1 AND status IN ('gagne','perdu')`,
      [`S${stratId}`]
    );
    if (!rows.length) return null;
    const wins   = parseInt(rows[0].wins)   || 0;
    const losses = parseInt(rows[0].losses) || 0;
    const total  = wins + losses;
    if (total === 0) return null;
    return { wins, losses, total, winRate: Math.round((wins / total) * 100) };
  } catch { return null; }
}

/** Construit le message de publicité pour une stratégie */
async function buildPubMessage(strategy, promos, allStrats) {
  const pubStrats = Array.isArray(strategy.pub_strategies) ? strategy.pub_strategies : [];
  if (pubStrats.length === 0) return null;

  const lines = [];
  lines.push(`🎯 <b>Stratégies disponibles — Offre Exclusive !</b>\n`);

  let count = 0;
  for (const ps of pubStrats) {
    const sid   = String(ps.id);
    const strat = allStrats.find(s => String(s.id) === sid);
    if (!strat) continue;

    const promo    = promos[sid] || {};
    const shopName = promo.titre?.trim() || generateMarketingName(parseInt(sid));
    const price    = (ps.price > 0) ? ps.price : ((parseFloat(promo.price_usd) > 0) ? parseFloat(promo.price_usd) : 75);
    const bilan    = await getStratBilan(parseInt(sid));

    let bilanStr = '';
    if (bilan) {
      const trend = bilan.winRate >= 80 ? ' 🔥' : bilan.winRate >= 65 ? ' 📈' : bilan.winRate >= 50 ? ' ✅' : ' ⚠️';
      bilanStr = `\n   📊 ${bilan.wins}✅ ${bilan.losses}❌ — <b>${bilan.winRate}%</b>${trend}`;
    }

    lines.push(`• <b>${shopName}</b> — <b>${price}$</b>${bilanStr}`);
    count++;
  }

  if (count === 0) return null;

  lines.push('');
  lines.push(`🛒 Commandez via la boutique ou contactez l'administrateur !`);
  return lines.join('\n');
}

// Track last sent time per strategy host (key = strategy.id)
const _lastSent = {};
let _timer = null;

async function _tick() {
  try {
    const rawStrats = await db.getSetting('custom_strategies').catch(() => null);
    if (!rawStrats) return;
    const allStrats = JSON.parse(rawStrats);

    const rawPromo = await db.getSetting('strategy_promo_config').catch(() => null);
    const promos   = rawPromo ? JSON.parse(rawPromo) : {};

    const pubStrats = allStrats.filter(s => s.pub_enabled);
    if (pubStrats.length === 0) return;

    const now = Date.now();

    for (const strategy of pubStrats) {
      const intervalMs = ((strategy.pub_interval_minutes || 60) * 60 * 1000);
      const last       = _lastSent[strategy.id] || 0;
      if ((now - last) < intervalMs) continue;

      const targets = Array.isArray(strategy.tg_targets)
        ? strategy.tg_targets.filter(t => t.bot_token && t.channel_id)
        : [];
      if (targets.length === 0) continue;

      const message = await buildPubMessage(strategy, promos, allStrats);
      if (!message) continue;

      let sent = 0;
      for (const target of targets) {
        try {
          await sendTelegramMsg({
            bot_token:  target.bot_token,
            channel_id: target.channel_id,
            text:       message,
          });
          console.log(`[PubScheduler] ✅ Pub envoyée S${strategy.id} → canal ${target.channel_id}`);
          sent++;
        } catch (e) {
          console.warn(`[PubScheduler] ❌ S${strategy.id} → ${target.channel_id}: ${e.message}`);
        }
      }
      if (sent > 0) _lastSent[strategy.id] = now;
    }
  } catch (e) {
    console.error('[PubScheduler] Erreur tick:', e.message);
  }
}

function startPubScheduler() {
  if (_timer) return;
  _timer = setInterval(_tick, 60_000);
  // Premier check après 30 secondes pour ne pas surcharger au démarrage
  setTimeout(() => _tick().catch(() => {}), 30_000);
  console.log('[PubScheduler] ⏱ Scheduler publicité stratégies démarré (vérif. toutes les 60s)');
}

function stopPubScheduler() {
  if (_timer) { clearInterval(_timer); _timer = null; }
}

module.exports = { startPubScheduler, stopPubScheduler };
