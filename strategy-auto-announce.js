'use strict';
/**
 * strategy-auto-announce.js — Génération automatique d'annonces Telegram pour les stratégies en vente
 *
 * Deux types d'annonces créées/mises à jour :
 *   1. AUTO_PROMO_BOUTIQUE  : annonce collective de toutes les stratégies en vente (toutes les 2h)
 *   2. AUTO_STRAT_S{id}     : annonce individuelle par stratégie avec bilan live (toutes les 2h)
 *
 * Le bilan est toujours recalculé depuis la DB à chaque appel → vraiment dynamique.
 */

const db = require('./db');

const MKTG_PREFIXES = ['Protocole', 'Système', 'Méthode', 'Formule', 'Module', 'Signal'];
const MKTG_GEMS     = ['Platine', 'Émeraude', 'Saphir', 'Rubis', 'Diamant', 'Cristal', 'Cobalt', 'Ambre', 'Jade', 'Opale', 'Topaze', 'Onyx'];
const MKTG_SUFFIXES = ['Pro', 'Élite', 'Expert', 'Premium', 'Prestige', 'Master', 'Ultra', 'VIP'];

function generateMarketingName(strategyId) {
  const id = parseInt(strategyId) || 0;
  return `${MKTG_PREFIXES[id % MKTG_PREFIXES.length]} ${MKTG_GEMS[(id * 3) % MKTG_GEMS.length]} ${MKTG_SUFFIXES[(id * 7) % MKTG_SUFFIXES.length]}`;
}

function getStrategyPrice(promo) {
  const p = parseFloat(promo?.price_usd);
  return Number.isFinite(p) && p > 0 ? p : 75;
}

async function getStratWinRate(stratId) {
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

/** Formate le bilan en chaîne lisible avec emoji tendance */
function formatBilanStr(stats) {
  if (!stats) return '— (données en cours de collecte)';
  const { wins, losses, winRate } = stats;
  const trend = winRate >= 80 ? ' 🔥' : winRate >= 65 ? ' 📈' : winRate >= 50 ? ' ✅' : ' ⚠️';
  return `${wins} ✅ / ${losses} ❌  •  ${winRate}%${trend}`;
}

/** Injecte le bilan live dans un template annonce_strat */
function injectBilan(template, stats) {
  if (!stats) return template;
  const bilanStr = formatBilanStr(stats);
  const winRate  = stats.winRate;
  const trend    = winRate >= 80 ? ' 🔥' : winRate >= 65 ? ' 📈' : winRate >= 50 ? ' ✅' : ' ⚠️';

  return template
    .replace(/\{wins\}/g,    String(stats.wins))
    .replace(/\{losses\}/g,  String(stats.losses))
    .replace(/\{winRate\}/g, String(winRate))
    .replace(/\{bilan\}/g,   bilanStr)
    // Remplace le placeholder généré par le bouton "Générer" côté UI
    .replace(/📈 Bilan : — \(données en cours de collecte\)/g, `📈 Bilan : ${bilanStr}`)
    // Fallback générique pour "— W / — L"
    .replace(/— W \/ — L/g, `${stats.wins} W / ${stats.losses} L  •  ${winRate}%${trend}`);
}

/**
 * Génère ou met à jour l'annonce automatique collective dans tg_announcements.
 * Appelé après toute modification de strategy_promo_config ou custom_strategies.
 */
async function autoUpdateStrategyAnnouncement() {
  if (!db.pool) return;
  try {
    const rawPromo  = await db.getSetting('strategy_promo_config').catch(() => null);
    const rawStrats = await db.getSetting('custom_strategies').catch(() => null);
    const promos    = rawPromo  ? JSON.parse(rawPromo)  : {};
    const strats    = rawStrats ? JSON.parse(rawStrats) : [];

    const enabledStrats = strats.filter(s => promos[String(s.id)]?.enabled);

    // Récupérer les taux de réussite en parallèle pour toutes les stratégies
    const statsMap = {};
    await Promise.all(strats.map(async s => {
      statsMap[s.id] = await getStratWinRate(s.id);
    }));

    // ── 1. Annonce collective boutique ────────────────────────────────────────
    if (enabledStrats.length > 0) {
      const stratLines = enabledStrats.map(s => {
        const promo    = promos[String(s.id)] || {};
        const shopName = promo.titre || generateMarketingName(s.id);
        const price    = getStrategyPrice(promo);
        const stats    = statsMap[s.id];
        const rateLabel = stats ? ` — ${stats.winRate}% réussite` : '';
        return `• <b>${shopName}</b>${rateLabel} — <b>${price}$</b>`;
      }).join('\n');

      const featured      = enabledStrats[0];
      const featuredPromo = promos[String(featured.id)] || {};
      const featuredName  = featuredPromo.titre || generateMarketingName(featured.id);
      const featuredPrice = getStrategyPrice(featuredPromo);
      const featuredStats = statsMap[featured.id];
      const featuredBilan = featuredStats ? ` (${featuredStats.winRate}% de réussite)` : '';

      const ideasRaw = await db.getSetting('strategy_ideas').catch(() => null);
      let ideasCount = 0;
      try { const ideas = ideasRaw ? JSON.parse(ideasRaw) : []; ideasCount = Array.isArray(ideas) ? ideas.length : 0; } catch {}

      const message = [
        `🎯 <b>Stratégie vedette : ${featuredName}</b>${featuredBilan}`,
        `Disponible sur notre boutique — boostez vos prédictions !`,
        `💰 À partir de <b>${featuredPrice}$</b>`,
        ``,
        `📊 <b>${enabledStrats.length} stratégie(s) en vente :</b>`,
        stratLines,
        ``,
        ideasCount > 0
          ? `💡 <b>${ideasCount} idée(s) de stratégie</b> disponibles sur demande !`
          : `💡 Stratégies personnalisées disponibles sur demande !`,
        ``,
        `🛒 Rendez-vous sur la boutique pour commander !`,
      ].join('\n');

      const existing = await db.pool.query(
        `SELECT id FROM tg_announcements WHERE name = 'AUTO_PROMO_BOUTIQUE' LIMIT 1`
      );
      if (existing.rows.length > 0) {
        await db.pool.query(
          `UPDATE tg_announcements SET message_text=$1, updated_at=NOW() WHERE name='AUTO_PROMO_BOUTIQUE'`,
          [message]
        );
      } else {
        let botToken = null, channelId = null;
        try {
          botToken = await db.getSetting('bot_token');
          const ch = await db.pool.query(`SELECT channel_id FROM telegram_config WHERE enabled=TRUE LIMIT 1`);
          if (ch.rows.length > 0) channelId = ch.rows[0].channel_id;
        } catch {}
        if (!botToken || !channelId) {
          botToken  = botToken  || 'À_CONFIGURER';
          channelId = channelId || 'À_CONFIGURER';
        }
        await db.pool.query(
          `INSERT INTO tg_announcements (name, channel_id, bot_token, message_text, schedule_type, interval_hours, fixed_hours, enabled)
           VALUES ('AUTO_PROMO_BOUTIQUE', $1, $2, $3, 'interval', 2, '[]', TRUE)`,
          [channelId, botToken, message]
        );
        console.log('[AutoAnnounce] ✅ Annonce boutique collective créée (toutes les 2h)');
      }
      console.log('[AutoAnnounce] ✅ Annonce boutique collective mise à jour');
    }

    // ── 2. Annonces individuelles par stratégie ──────────────────────────────
    // Pour chaque stratégie qui a un annonce_strat ET des canaux configurés
    for (const s of strats) {
      if (!s.annonce_strat?.trim()) continue;
      const tgTargets = Array.isArray(s.tg_targets) ? s.tg_targets.filter(t => t.bot_token && t.channel_id) : [];
      if (tgTargets.length === 0) continue;

      const promo    = promos[String(s.id)] || {};
      const shopName = promo.titre?.trim() || generateMarketingName(s.id);
      const stats    = statsMap[s.id];

      // Injecte le bilan live dans le template
      let text = injectBilan(s.annonce_strat, stats);
      // Remplace aussi {nom} par le nom boutique
      text = text.replace(/\{nom\}/g, shopName);

      for (const target of tgTargets) {
        const annName = `AUTO_STRAT_S${s.id}_${target.channel_id}`;
        const existing = await db.pool.query(
          `SELECT id FROM tg_announcements WHERE name = $1 LIMIT 1`, [annName]
        );
        if (existing.rows.length > 0) {
          await db.pool.query(
            `UPDATE tg_announcements SET message_text=$1, updated_at=NOW() WHERE name=$2`,
            [text, annName]
          );
        } else {
          await db.pool.query(
            `INSERT INTO tg_announcements (name, channel_id, bot_token, message_text, schedule_type, interval_hours, fixed_hours, enabled)
             VALUES ($1, $2, $3, $4, 'interval', 2, '[]', TRUE)`,
            [annName, target.channel_id, target.bot_token, text]
          );
          console.log(`[AutoAnnounce] ✅ Annonce individuelle créée : S${s.id} → canal ${target.channel_id}`);
        }
      }
    }

    console.log('[AutoAnnounce] ✅ Toutes les annonces synchronisées avec bilan live');
  } catch (e) {
    console.error('[AutoAnnounce] Erreur:', e.message);
  }
}

module.exports = { autoUpdateStrategyAnnouncement, generateMarketingName, getStratWinRate, injectBilan, formatBilanStr };
