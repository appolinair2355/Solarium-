'use strict';
/**
 * strategy-auto-announce.js — Génération automatique d'annonces Telegram pour les stratégies en vente
 *
 * Appelé à chaque fois qu'une stratégie est ajoutée/modifiée dans la boutique.
 * Crée ou met à jour une entrée dans tg_announcements avec :
 *   - Le nom marketing de la stratégie (depuis boutique)
 *   - Son prix
 *   - La liste complète des stratégies en vente avec taux de réussite
 * Envoi automatique toutes les 2h.
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

/**
 * Génère ou met à jour l'annonce automatique dans tg_announcements.
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
    if (enabledStrats.length === 0) {
      console.log('[AutoAnnounce] Aucune stratégie en vente — annonce auto ignorée');
      return;
    }

    // Récupérer les taux de réussite en parallèle
    const statsMap = {};
    await Promise.all(enabledStrats.map(async s => {
      statsMap[s.id] = await getStratWinRate(s.id);
    }));

    // Construire la liste des stratégies avec nom boutique + prix + taux
    const stratLines = enabledStrats.map(s => {
      const promo     = promos[String(s.id)] || {};
      const shopName  = promo.titre || generateMarketingName(s.id);
      const price     = getStrategyPrice(promo);
      const stats     = statsMap[s.id];
      const rateLabel = stats ? ` — ${stats.winRate}% réussite` : '';
      return `• <b>${shopName}</b>${rateLabel} — <b>${price}$</b>`;
    }).join('\n');

    // Stratégie vedette = la première stratégie activée
    const featured     = enabledStrats[0];
    const featuredPromo = promos[String(featured.id)] || {};
    const featuredName  = featuredPromo.titre || generateMarketingName(featured.id);
    const featuredPrice = getStrategyPrice(featuredPromo);

    const ideasRaw = await db.getSetting('strategy_ideas').catch(() => null);
    let ideasCount = 0;
    try {
      const ideas = ideasRaw ? JSON.parse(ideasRaw) : [];
      ideasCount = Array.isArray(ideas) ? ideas.length : 0;
    } catch {}

    const message = [
      `🎯 <b>La stratégie en cours : ${featuredName}</b>`,
      `Elle est disponible sur notre boutique sur le site.`,
      `💰 Obtenez-la pour <b>${featuredPrice}$</b> et boostez vos prédictions !`,
      ``,
      `📊 <b>${enabledStrats.length} stratégie(s) en vente actuellement :</b>`,
      stratLines,
      ``,
      ideasCount > 0
        ? `💡 Nous avons aussi <b>${ideasCount} idée(s) de stratégie</b> disponibles — contactez-nous pour en savoir plus !`
        : `💡 Des idées de stratégies personnalisées sont disponibles sur demande !`,
      ``,
      `🛒 Rendez-vous sur la boutique pour commander !`,
    ].join('\n');

    // Vérifier si une annonce auto existe déjà
    const existing = await db.pool.query(
      `SELECT id FROM tg_announcements WHERE name = 'AUTO_PROMO_BOUTIQUE' LIMIT 1`
    );

    if (existing.rows.length > 0) {
      // Mettre à jour le message seulement (garder canal/token/schedule)
      await db.pool.query(
        `UPDATE tg_announcements SET message_text=$1, updated_at=NOW() WHERE name='AUTO_PROMO_BOUTIQUE'`,
        [message]
      );
      console.log('[AutoAnnounce] ✅ Annonce auto mise à jour');
    } else {
      // Chercher un canal configuré (bot_token global + premier canal)
      let botToken = null;
      let channelId = null;
      try {
        botToken = await db.getSetting('bot_token');
        const ch = await db.pool.query(
          `SELECT channel_id FROM telegram_config WHERE enabled=TRUE LIMIT 1`
        );
        if (ch.rows.length > 0) channelId = ch.rows[0].channel_id;
      } catch {}

      if (!botToken || !channelId) {
        console.log('[AutoAnnounce] ⚠️ Pas de bot_token/channel configuré — annonce auto créée sans canal (à configurer manuellement)');
        botToken   = botToken   || 'À_CONFIGURER';
        channelId  = channelId  || 'À_CONFIGURER';
      }

      await db.pool.query(
        `INSERT INTO tg_announcements
           (name, channel_id, bot_token, message_text, schedule_type, interval_hours, fixed_hours, enabled)
         VALUES ('AUTO_PROMO_BOUTIQUE', $1, $2, $3, 'interval', 2, '[]', TRUE)`,
        [channelId, botToken, message]
      );
      console.log('[AutoAnnounce] ✅ Annonce auto créée (toutes les 2h)');
    }
  } catch (e) {
    console.error('[AutoAnnounce] Erreur:', e.message);
  }
}

module.exports = { autoUpdateStrategyAnnouncement, generateMarketingName };
