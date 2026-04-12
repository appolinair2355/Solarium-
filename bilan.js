/**
 * bilan.js — Service de bilan quotidien des prédictions
 *
 * Chaque nuit à 00h00, génère et envoie le bilan de la veille
 * pour chaque stratégie (C1/C2/C3/DC + stratégies custom).
 */

const db = require('./db');
const tg = require('./telegram-service');

// ── Construction du bilan structuré ─────────────────────────────────

function buildBilanData(rows, strategies) {
  const byStrat = {};
  for (const row of rows) {
    if (!byStrat[row.strategy]) byStrat[row.strategy] = { gagne: {}, perdu: {} };
    const r = parseInt(row.rattrapage) || 0;
    byStrat[row.strategy][row.status][r] = (byStrat[row.strategy][row.status][r] || 0) + parseInt(row.count);
  }

  const result = [];
  for (const [stratId, data] of Object.entries(byStrat)) {
    const rSet = new Set([
      ...Object.keys(data.gagne || {}).map(Number),
      ...Object.keys(data.perdu || {}).map(Number),
    ]);

    let totalWins = 0, totalLosses = 0;
    const byRattrapage = [];

    for (const r of [...rSet].sort((a, b) => a - b)) {
      const w = (data.gagne || {})[r] || 0;
      const l = (data.perdu || {})[r] || 0;
      totalWins   += w;
      totalLosses += l;
      byRattrapage.push({ rattrapage: r, wins: w, losses: l });
    }

    const total   = totalWins + totalLosses;
    const winRate = total > 0 ? Math.round(totalWins / total * 100) : 0;

    const stratCfg  = strategies.find(s => `S${s.id}` === stratId);
    const name      = stratCfg ? stratCfg.name : stratId;
    const tgTargets = stratCfg?.tg_targets || [];

    result.push({ stratId, name, totalWins, totalLosses, total, winRate, byRattrapage, tgTargets });
  }

  return result.sort((a, b) => a.stratId.localeCompare(b.stratId));
}

// ── Formatage du message Telegram ────────────────────────────────────

function formatBilanText(entry, dateStr) {
  const BAR  = '━━━━━━━━━━━━━━━━━━';
  const lines = [];

  lines.push(`📊 <b>BILAN DU ${dateStr}</b>`);
  lines.push(`📌 Stratégie : <b>${entry.name}</b> (${entry.stratId})`);
  lines.push(BAR);

  if (entry.total === 0) {
    lines.push('Aucune prédiction vérifiée ce jour.');
  } else {
    const lossRate = 100 - entry.winRate;
    lines.push(`📈 Total prédictions : <b>${entry.total}</b>`);
    lines.push(`✅ Gagnantes : <b>${entry.totalWins}</b>  (${entry.winRate}%)`);
    lines.push(`❌ Perdues   : <b>${entry.totalLosses}</b>  (${lossRate}%)`);

    if (entry.byRattrapage.length > 0) {
      lines.push('');
      lines.push('<b>Par rattrapage :</b>');
      for (const { rattrapage, wins, losses } of entry.byRattrapage) {
        const tot    = wins + losses;
        const rate   = tot > 0 ? Math.round(wins / tot * 100) : 0;
        const label  = rattrapage === 0 ? 'Direct  (R0)' : `Ratt.  (R${rattrapage})`;
        const icon   = wins > losses ? '🟢' : wins === losses ? '🟡' : '🔴';
        lines.push(`  ${icon} ${label} : ✅ ${wins} / ${tot}  (${rate}%)`);
      }
    }
  }

  lines.push(BAR);
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
      // Sauvegarder quand même un snapshot vide
      await db.saveBilanSnapshot(dateStr, []);
      return;
    }

    await db.saveBilanSnapshot(dateStr, bilanData);
    console.log(`[Bilan] Snapshot sauvegardé (${bilanData.length} stratégies)`);

    for (const entry of bilanData) {
      const text = formatBilanText(entry, dateStr);

      if (entry.tgTargets && entry.tgTargets.length > 0) {
        // Stratégies custom avec token + canal propre configurés
        for (const { bot_token, channel_id } of entry.tgTargets) {
          if (!bot_token || !channel_id) continue;
          try {
            await tg.sendRawMessage(bot_token, channel_id, text, 'HTML');
            console.log(`[Bilan] ${entry.stratId} → canal ${channel_id} ✓`);
          } catch (e) {
            console.error(`[Bilan] ${entry.stratId} → ${channel_id}: ${e.message}`);
          }
        }
      } else {
        // Stratégies standard (C1/C2/C3/DC) ET custom sans tg_targets spécifiques
        // → bot global + routage par stratégie (ou tous les canaux si pas de route)
        try {
          await tg.sendBilanToStrategyChannels(entry.stratId, text);
          console.log(`[Bilan] ${entry.stratId} → canaux globaux ✓`);
        } catch (e) {
          console.error(`[Bilan] ${entry.stratId} global: ${e.message}`);
        }
      }
    }

    console.log(`[Bilan] ✅ Terminé pour ${dateStr}`);
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
    // Répéter toutes les 24h
    setInterval(fire, 24 * 60 * 60 * 1000);
  }, ms);
}

module.exports = { sendDailyBilan, scheduleMidnight, buildBilanData, formatBilanText };
