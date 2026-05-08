import React, { useState } from 'react';

const S = {
  card: {
    background: 'rgba(15,23,42,0.95)',
    border: '1px solid rgba(100,116,139,0.2)',
    borderRadius: 16,
    padding: '22px 24px',
    marginBottom: 16,
  },
  title: { fontSize: 14, fontWeight: 800, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 14 },
  btn: (color) => ({
    padding: '12px 24px', borderRadius: 11, fontWeight: 800, fontSize: 13, cursor: 'pointer',
    border: `1px solid rgba(${color},0.45)`,
    background: `rgba(${color},0.12)`,
    color: `rgb(${color})`,
    transition: 'all 0.16s',
    display: 'flex', alignItems: 'center', gap: 8,
  }),
  result: (ok) => ({
    marginTop: 14, padding: '12px 16px', borderRadius: 10,
    background: ok ? 'rgba(34,197,94,0.08)' : 'rgba(239,68,68,0.08)',
    border: `1px solid rgba(${ok ? '34,197,94' : '239,68,68'},0.25)`,
    fontSize: 13, color: ok ? '#4ade80' : '#f87171', lineHeight: 1.7,
  }),
};

export default function AdminRefresh() {
  const [softBusy,  setSoftBusy]  = useState(false);
  const [softRes,   setSoftRes]   = useState(null);
  const [fullBusy,  setFullBusy]  = useState(false);
  const [fullRes,   setFullRes]   = useState(null);
  const [clearBusy, setClearBusy] = useState(false);
  const [clearRes,  setClearRes]  = useState(null);

  // ── Actualisation douce ────────────────────────────────────────────
  async function handleSoftRefresh() {
    setSoftBusy(true); setSoftRes(null);
    try {
      const r = await fetch('/api/admin/refresh-site', { method: 'POST', credentials: 'include' });
      const d = await r.json();
      if (r.ok) {
        setSoftRes({ ok: true, msg: `✅ Moteur actualisé — ${d.predictions_cleared ?? 0} prédiction(s) bloquée(s) nettoyée(s), stratégies rechargées.` });
      } else {
        setSoftRes({ ok: false, msg: `❌ Erreur : ${d.error || 'Inconnue'}` });
      }
    } catch (e) {
      setSoftRes({ ok: false, msg: `❌ Erreur réseau : ${e.message}` });
    } finally { setSoftBusy(false); }
  }

  // ── Nettoyer prédictions bloquées uniquement ───────────────────────
  async function handleClearPreds() {
    setClearBusy(true); setClearRes(null);
    try {
      const r = await fetch('/api/admin/clear-predictions', { method: 'POST', credentials: 'include' });
      const d = await r.json();
      if (r.ok) {
        setClearRes({ ok: true, msg: `✅ ${d.deleted ?? 0} prédiction(s) supprimée(s) (local) + ${d.extDeleted ?? 0} sur Render.` });
      } else {
        setClearRes({ ok: false, msg: `❌ Erreur : ${d.error || 'Inconnue'}` });
      }
    } catch (e) {
      setClearRes({ ok: false, msg: `❌ Erreur réseau : ${e.message}` });
    } finally { setClearBusy(false); }
  }

  // ── Réinitialisation complète ──────────────────────────────────────
  async function handleFullReset() {
    if (!confirm('⚠️ Réinitialisation complète : toutes les prédictions et statistiques seront supprimées. Continuer ?')) return;
    setFullBusy(true); setFullRes(null);
    try {
      const r = await fetch('/api/admin/reset-all-stats', { method: 'POST', credentials: 'include' });
      const d = await r.json();
      if (r.ok) {
        const det = d.details || {};
        setFullRes({ ok: true, msg: `✅ Réinitialisation complète effectuée.\n• ${det.predictions_deleted ?? d.deleted ?? 0} prédiction(s) supprimée(s)\n• ${det.render_deleted ?? d.extDeleted ?? 0} sur Render\n• Absences remises à zéro\n• Bilan effacé` });
      } else {
        setFullRes({ ok: false, msg: `❌ Erreur : ${d.error || 'Inconnue'}` });
      }
    } catch (e) {
      setFullRes({ ok: false, msg: `❌ Erreur réseau : ${e.message}` });
    } finally { setFullBusy(false); }
  }

  return (
    <div style={{ padding: '0 8px' }}>
      <div style={{ marginBottom: 28 }}>
        <h2 style={{ fontSize: 22, fontWeight: 900, color: '#f1f5f9', margin: 0, display: 'flex', alignItems: 'center', gap: 10 }}>
          <span style={{ background: 'linear-gradient(135deg,#38bdf8,#0ea5e9)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent' }}>🔄 Panneau d'Actualisation</span>
        </h2>
        <p style={{ fontSize: 12, color: '#64748b', margin: '5px 0 0' }}>
          Gérez l'état du moteur de prédiction, nettoyez les prédictions bloquées et réinitialisez les statistiques.
        </p>
      </div>

      {/* ── Actualisation douce ── */}
      <div style={S.card}>
        <div style={S.title}>🔃 Actualisation douce</div>
        <p style={{ fontSize: 13, color: '#94a3b8', margin: '0 0 16px', lineHeight: 1.6 }}>
          Recharge les stratégies personnalisées en mémoire, nettoie les prédictions bloquées depuis plus de 22 min et remet à zéro les absences. <strong style={{ color: '#e2e8f0' }}>Ne supprime pas les statistiques.</strong>
        </p>
        <button onClick={handleSoftRefresh} disabled={softBusy} style={{ ...S.btn('56,189,248'), opacity: softBusy ? 0.7 : 1 }}>
          {softBusy ? '⏳' : '🔄'} {softBusy ? 'Actualisation…' : 'Actualiser le moteur'}
        </button>
        {softRes && (
          <div style={S.result(softRes.ok)}>
            {softRes.msg.split('\n').map((line, i) => <div key={i}>{line}</div>)}
          </div>
        )}
      </div>

      {/* ── Nettoyer prédictions bloquées ── */}
      <div style={S.card}>
        <div style={S.title}>🧹 Nettoyer prédictions bloquées</div>
        <p style={{ fontSize: 13, color: '#94a3b8', margin: '0 0 16px', lineHeight: 1.6 }}>
          Supprime toutes les prédictions <strong style={{ color: '#fbbf24' }}>en cours</strong> (locales + Render). Équivalent au reset automatique du jeu #1. Les configurations et utilisateurs sont préservés.
        </p>
        <button onClick={handleClearPreds} disabled={clearBusy} style={{ ...S.btn('250,204,21'), opacity: clearBusy ? 0.7 : 1 }}>
          {clearBusy ? '⏳' : '🧹'} {clearBusy ? 'Nettoyage…' : 'Nettoyer les prédictions'}
        </button>
        {clearRes && (
          <div style={S.result(clearRes.ok)}>
            {clearRes.msg}
          </div>
        )}
      </div>

      {/* ── Réinitialisation complète ── */}
      <div style={{ ...S.card, border: '1px solid rgba(239,68,68,0.25)' }}>
        <div style={{ ...S.title, color: '#f87171' }}>⚠️ Réinitialisation complète</div>
        <p style={{ fontSize: 13, color: '#94a3b8', margin: '0 0 16px', lineHeight: 1.6 }}>
          Supprime <strong style={{ color: '#f87171' }}>toutes les prédictions</strong>, remet les absences à zéro, efface le bilan. Les utilisateurs, stratégies et configurations Telegram sont conservés.
        </p>
        <button onClick={handleFullReset} disabled={fullBusy} style={{ ...S.btn('239,68,68'), opacity: fullBusy ? 0.7 : 1 }}>
          {fullBusy ? '⏳' : '🔁'} {fullBusy ? 'Réinitialisation…' : 'Réinitialisation complète'}
        </button>
        {fullRes && (
          <div style={S.result(fullRes.ok)}>
            {fullRes.msg.split('\n').map((line, i) => <div key={i}>{line}</div>)}
          </div>
        )}
      </div>

      {/* ── Rappel infos ── */}
      <div style={{ padding: '14px 18px', borderRadius: 12, background: 'rgba(99,102,241,0.06)', border: '1px solid rgba(99,102,241,0.18)', fontSize: 12, color: '#64748b', lineHeight: 1.7 }}>
        <strong style={{ color: '#818cf8' }}>ℹ️ Nettoyage automatique :</strong> Le moteur nettoie automatiquement les prédictions bloquées toutes les 2 minutes (limite 22 min). Utilisez ce panneau si vous constatez des anomalies ou après un redémarrage serveur.
      </div>
    </div>
  );
}
