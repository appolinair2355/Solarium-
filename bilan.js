/**
 * bilan.js — Service de bilan quotidien des prédictions
 *
 * Chaque nuit à 00h00, génère et envoie le bilan de la veille
 * pour chaque stratégie (C1/C2/C3/DC + stratégies custom).
 *
 * Corrections :
 *  - Chaque stratégie affiche TOUS les niveaux de rattrapage de 0 à max_rattrapage
 *    (même si aucune prédiction n'a eu lieu à ce niveau ce jour-là → 0/0)
 *  - Les stratégies ne se mélangent pas entre elles — chaque bilan est bien délimité
 *  - L'en-tête affiche clairement le nom de la stratégie
 */

const db = require('./db');
const tg = require('./telegram-service');

// Niveaux de rattrapage standards pour les stratégies système
const SYSTEM_MAX_R = { C1: 3, C2: 3, C3: 3, DC: 2 };

// ── Construction du bilan structuré ─────────────────────────────────

function buildBilanData(rows, strategies) {
  const byStrat = {};

  // Regrouper les prédictions par stratégie / rattrapage / statut
  for (const row of rows) {
    if (!byStrat[row.strategy]) byStrat[row.strategy] = { gagne: {}, perdu: {} };
    const r = parseInt(row.rattrapage) || 0;
    byStrat[row.strategy][row.status][r] = (byStrat[row.strategy][row.status][r] || 0) + parseInt(row.count);
  }

  const result = [];

  for (const [stratId, data] of Object.entries(byStrat)) {
    // Déterminer max_rattrapage de la stratégie
    let maxR = 0;
    const stratCfg = strategies.find(s => `S${s.id}` === stratId);

    if (stratCfg) {
      // Stratégie custom → utiliser max_rattrapage configuré
      maxR = parseInt(stratCfg.max_rattrapage) || 0;
    } else if (SYSTEM_MAX_R[stratId] !== undefined) {
      // Stratégie système (C1/C2/C3/DC)
      maxR = SYSTEM_MAX_R[stratId];
    } else {
      // Fallback : prendre le niveau max trouvé dans les données
      const allLevels = [
        ...Object.keys(data.gagne || {}).map(Number),
        ...Object.keys(data.perdu || {}).map(Number),
      ];
      maxR = allLevels.length > 0 ? Math.max(...allLevels) : 0;
    }

    // Remplir TOUS les niveaux de 0 à maxR (même si aucune prédiction ce niveau)
    let totalWins = 0, totalLosses = 0;
    const byRattrapage = [];

    for (let r = 0; r <= maxR; r++) {
      const w = (data.gagne || {})[r] || 0;
      const l = (data.perdu || {})[r] || 0;
      totalWins   += w;
      totalLosses += l;
      byRattrapage.push({ rattrapage: r, wins: w, losses: l });
    }

    // Ajouter les niveaux au-delà de maxR qui auraient quand même des données
    const allDataLevels = new Set([
      ...Object.keys(data.gagne || {}).map(Number),
      ...Object.keys(data.perdu || {}).map(Number),
    ]);
    for (const r of allDataLevels) {
      if (r > maxR) {
        const w = (data.gagne || {})[r] || 0;
        const l = (data.perdu || {})[r] || 0;
        totalWins   += w;
        totalLosses += l;
        byRattrapage.push({ rattrapage: r, wins: w, losses: l });
      }
    }
    byRattrapage.sort((a, b) => a.rattrapage - b.rattrapage);

    const total   = totalWins + totalLosses;
    const winRate = total > 0 ? Math.round(totalWins / total * 100) : 0;

    const name      = stratCfg ? stratCfg.name : stratId;
    const tgTargets = stratCfg?.tg_targets || [];
    const isRotation = stratCfg?.mode === 'annonce_sequence';
    const childNames = isRotation
      ? (stratCfg.annonce_sequence_ids || [])
          .map(id => strategies.find(s => String(s.id) === String(id))?.name)
          .filter(Boolean)
      : [];

    result.push({ stratId, name, maxR, totalWins, totalLosses, total, winRate, byRattrapage, tgTargets, isRotation, childNames });
  }

  return result.sort((a, b) => a.stratId.localeCompare(b.stratId));
}

// ── Formatage du message Telegram ────────────────────────────────────

function formatBilanText(entry, dateStr) {
  const BAR_DOUBLE = '══════════════════════';
  const BAR_THIN   = '──────────────────────';
  const lines = [];

  // ── En-tête clair avec nom de la stratégie ──
  lines.push(`${BAR_DOUBLE}`);
  lines.push(`📊 <b>BILAN</b>`);
  lines.push(`📅 <i>${dateStr}</i>`);
  lines.push(BAR_THIN);

  if (entry.isRotation && entry.childNames && entry.childNames.length > 0) {
    lines.push(`🔄 <b>Rotateur Promo</b>`);
    lines.push(`Stratégies en rotation :`);
    entry.childNames.forEach((n, i) => lines.push(`  ${i + 1}. ${n}`));
    lines.push(BAR_THIN);
  }

  if (entry.total === 0) {
    lines.push('Aucune prédiction vérifiée ce jour.');
  } else {
    const lossRate = 100 - entry.winRate;
    const perfIcon = entry.winRate >= 70 ? '🔥' : entry.winRate >= 50 ? '✅' : entry.winRate >= 30 ? '🟡' : '🔴';

    lines.push(`${perfIcon} Taux de réussite : <b>${entry.winRate}%</b>`);
    lines.push(`📈 Total préd. vérifiées : <b>${entry.total}</b>`);
    lines.push(`✅ Gagnantes : <b>${entry.totalWins}</b>  (${entry.winRate}%)`);
    lines.push(`❌ Perdues   : <b>${entry.totalLosses}</b>  (${lossRate}%)`);

    // ── Détail par niveau de rattrapage ──
    if (entry.byRattrapage.length > 0) {
      lines.push('');
      lines.push(`<b>Détail par rattrapage</b> (max configuré : R${entry.maxR}) :`);

      for (const { rattrapage, wins, losses } of entry.byRattrapage) {
        const tot   = wins + losses;
        const rate  = tot > 0 ? Math.round(wins / tot * 100) : null;
        const label = rattrapage === 0 ? 'Direct      (R0)' : `Rattrapage  (R${rattrapage})`;

        if (tot === 0) {
          // Niveau configuré mais pas de prédiction ce jour → afficher comme inactif
          lines.push(`  ⚪ ${label} : —  (aucune préd.)`);
        } else {
          const icon = wins > losses ? '🟢' : wins === losses ? '🟡' : '🔴';
          lines.push(`  ${icon} ${label} : ✅ ${wins} / ❌ ${losses}  (${rate}%)`);
        }
      }
    }
  }

  lines.push(BAR_DOUBLE);
  return lines.join('\n');
}

// ── Envoi principal ──────────────────────────────────────────────────

async function sendDailyBilan(dateStr) {
  try {
    console.log(`[Bilan] Génération pour ${dateStr}...`);
    const rows = await db.getDailyBilanStats(dateStr);

    const v          = await db.getSetting('custom_strategies');
    const strategies = v ? JSON.parse(v) : [];
    const bilanData  = buildBilanData(rows, strategies);

    if (bilanData.length === 0) {
      console.log('[Bilan] Aucune prédiction résolue ce jour.');
      await db.saveBilanSnapshot(dateStr, []);
      return;
    }

    await db.saveBilanSnapshot(dateStr, bilanData);
    console.log(`[Bilan] Snapshot sauvegardé (${bilanData.length} stratégies)`);

    // ── Envoi séparé pour chaque stratégie ──────────────────────────
    // Chaque stratégie est envoyée indépendamment sur ses propres canaux.
    // Cela garantit qu'aucune stratégie ne se mélange avec une autre.
    for (const entry of bilanData) {
      const text = formatBilanText(entry, dateStr);

      if (entry.tgTargets && entry.tgTargets.length > 0) {
        // Stratégie custom avec token + canal propres configurés
        for (const { bot_token, channel_id } of entry.tgTargets) {
          if (!bot_token || !channel_id) continue;
          try {
            await tg.sendRawMessage(bot_token, channel_id, text, 'HTML');
            console.log(`[Bilan] ✓ ${entry.stratId} (${entry.name}) → canal ${channel_id}`);
          } catch (e) {
            console.error(`[Bilan] ✗ ${entry.stratId} → ${channel_id}: ${e.message}`);
          }
        }
      } else {
        // Stratégie standard (C1/C2/C3/DC) ou custom sans tg_targets spécifiques
        // → bot global + routage par stratégie (ou tous les canaux si pas de route)
        try {
          await tg.sendBilanToStrategyChannels(entry.stratId, text);
          console.log(`[Bilan] ✓ ${entry.stratId} (${entry.name}) → canaux globaux`);
        } catch (e) {
          console.error(`[Bilan] ✗ ${entry.stratId} global: ${e.message}`);
        }
      }
    }

    console.log(`[Bilan] ✅ Terminé pour ${dateStr} (${bilanData.length} stratégie(s) envoyée(s))`);
  } catch (e) {
    console.error('[Bilan] Erreur:', e.message);
  }
}

// ── Planificateur minuit ─────────────────────────────────────────────

function msUntilMidnight() {
  const now  = new Date();
  const next = new Date(now);
  next.setHours(24, 0, 5, 0); // 00:00:05 pour éviter la seconde exacte
  return next - now;
}

function scheduleMidnight() {
  const fire = () => {
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    const dateStr = yesterday.toISOString().split('T')[0];
    sendDailyBilan(dateStr);
  };

  const ms = msUntilMidnight();
  console.log(`[Bilan] Prochain bilan dans ${Math.round(ms / 60000)} min (à minuit)`);

  setTimeout(() => {
    fire();
    setInterval(fire, 24 * 60 * 60 * 1000);
  }, ms);
}

module.exports = { sendDailyBilan, scheduleMidnight, buildBilanData, formatBilanText };
