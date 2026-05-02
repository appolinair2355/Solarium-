import { useEffect, useState, useCallback, useMemo } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { useLanguage } from '../context/LanguageContext';

export default function Comptages() {
  const { user } = useAuth();
  const { autoT } = useLanguage();
  const [data, setData]       = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError]     = useState('');

  const load = useCallback(async () => {
    try {
      const r = await fetch('/api/admin/comptages/view', { credentials: 'include' });
      const txt = await r.text();
      let d;
      try { d = JSON.parse(txt); }
      catch { throw new Error(autoT('Réponse inattendue du serveur')); }
      if (!r.ok) throw new Error(d.error || autoT('Erreur'));
      setData(d);
      setError('');
    } catch (e) {
      setError(e.message);
    } finally { setLoading(false); }
  }, []); // eslint-disable-line

  useEffect(() => {
    load();
    const iv = setInterval(load, 15000);
    return () => clearInterval(iv);
  }, [load]);

  const grouped = useMemo(() => {
    if (!data?.summary) return [];
    const map = {};
    for (const r of data.summary) {
      if (!map[r.group]) map[r.group] = [];
      map[r.group].push(r);
    }
    return Object.entries(map);
  }, [data]);

  const prevByKey = useMemo(() => {
    const map = {};
    if (data?.lastReport?.summary) {
      for (const r of data.lastReport.summary) map[r.key] = r;
    }
    return map;
  }, [data]);

  const lastReportTs = data?.lastReport?.timestamp
    ? new Date(data.lastReport.timestamp).toLocaleString('fr-FR')
    : '—';

  return (
    <div style={{ minHeight: '100vh', background: '#0a0e1a', color: '#e2e8f0' }}>
      <nav className="navbar">
        <Link to="/" className="navbar-brand">🎲 Prediction Baccara Pro</Link>
        <div style={{ display: 'flex', gap: 8 }}>
          <Link to="/choisir" className="btn btn-ghost btn-sm">← {autoT('Retour')}</Link>
        </div>
      </nav>

      <div style={{ maxWidth: 1200, margin: '0 auto', padding: '24px 16px' }}>
        <div style={{
          background: 'rgba(34,197,94,0.05)',
          border: '1px solid rgba(34,197,94,0.3)',
          borderRadius: 12, padding: '16px 20px', marginBottom: 16,
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <span style={{ fontSize: 28 }}>📈</span>
            <div style={{ flex: 1 }}>
              <h1 style={{ margin: 0, fontSize: 20, color: '#e2e8f0' }}>{autoT('Comptages — écarts entre catégories')}</h1>
              <p style={{ margin: '4px 0 0', fontSize: 13, color: '#94a3b8' }}>
                {autoT("Suivi temps réel des séries d'absences (costumes, victoire, parité, série de cartes, nombre de cartes, points). Mise à jour automatique toutes les 15 secondes.")}
              </p>
            </div>
          </div>
          <div style={{ marginTop: 10, fontSize: 12, color: '#64748b' }}>
            {autoT('Dernier bilan')} : <b style={{ color: '#94a3b8' }}>{lastReportTs}</b>
            {' · '}{autoT('Jeux comptés')} : <b style={{ color: '#94a3b8' }}>{data?.processedCount ?? 0}</b>
          </div>
          <div style={{ marginTop: 6, fontSize: 11, color: '#64748b' }}>
            <b>{autoT('actuel')}</b> = {autoT("série en cours sans apparition")} •{' '}
            <b style={{ color: '#fbbf24' }}>{autoT('période')}</b> = {autoT("pic de la dernière heure")} •{' '}
            <b style={{ color: '#a78bfa' }}>{autoT('max')}</b> = {autoT("record absolu")} •{' '}
            <span style={{ color: '#22c55e' }}>📈</span> = {autoT("nouveau record vs bilan précédent")}
          </div>
        </div>

        {error && (
          <div style={{
            background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.4)',
            color: '#f87171', padding: '10px 14px', borderRadius: 8, marginBottom: 12,
          }}>❌ {error}</div>
        )}

        {loading && <div style={{ color: '#64748b', padding: 12 }}>{autoT('Chargement…')}</div>}

        {!loading && grouped.length === 0 && (
          <div style={{ color: '#64748b', padding: 12 }}>
            {autoT("Aucune donnée disponible (le moteur n'a pas encore traité de jeu).")}
          </div>
        )}

        {!loading && grouped.map(([group, rows]) => (
          <div key={group} style={{ marginTop: 14 }}>
            <div style={{ fontSize: 14, fontWeight: 700, color: '#cbd5e1', marginBottom: 8 }}>{group}</div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 8 }}>
              {rows.map(row => {
                const prev = prevByKey[row.key];
                const isRecord = prev && row.maxAll > (prev.maxAll || 0);
                return (
                  <div key={row.key} style={{
                    background: 'rgba(15,23,42,0.4)',
                    border: '1px solid rgba(255,255,255,0.06)',
                    borderRadius: 10, padding: '10px 12px',
                  }}>
                    <div style={{ fontSize: 12, color: '#94a3b8', fontWeight: 600, marginBottom: 4 }}>
                      {row.label} {isRecord && <span style={{ color: '#22c55e' }} title={autoT('Nouveau record vs bilan précédent')}>📈</span>}
                    </div>
                    <div style={{ display: 'flex', gap: 10, fontSize: 11, color: '#64748b' }}>
                      <span>{autoT('actuel')} <b style={{ color: '#e2e8f0', fontSize: 14 }}>{row.cur}</b></span>
                      <span>{autoT('période')} <b style={{ color: '#fbbf24', fontSize: 14 }}>{row.maxPeriod}</b></span>
                      <span>{autoT('max')} <b style={{ color: '#a78bfa', fontSize: 14 }}>{row.maxAll}</b></span>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
