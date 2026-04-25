import { useState, useEffect } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import ContactAdminModal from '../components/ContactAdminModal';

const CHANNELS = [
  {
    id: 'C1',
    name: 'Pique Noir',
    emoji: '♠',
    color: '#3b82f6',
    glow: 'rgba(59,130,246,0.35)',
    desc: 'Analyse les absences de symboles noirs. Réagit dès 5 occurrences consécutives.',
    badge: 'PRÉCISION',
  },
  {
    id: 'C2',
    name: 'Cœur Rouge',
    emoji: '♥',
    color: '#ef4444',
    glow: 'rgba(239,68,68,0.35)',
    desc: 'Suivi des séquences rouges prolongées. Seuil d\'activation à 8 parties.',
    badge: 'AGRESSIF',
  },
  {
    id: 'C3',
    name: 'Carreau Doré',
    emoji: '♦',
    color: '#f59e0b',
    glow: 'rgba(245,158,11,0.35)',
    desc: 'Détection des patterns dorés rares. Activé après 5 absences confirmées.',
    badge: 'ÉQUILIBRÉ',
  },
  {
    id: 'DC',
    name: 'Double Canal',
    emoji: '♣',
    color: '#22c55e',
    glow: 'rgba(34,197,94,0.35)',
    desc: 'Système à escalade progressive. Combine deux canaux en simultané pour maximiser le taux.',
    badge: 'ÉLITE',
  },
];

export default function StrategySelect() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const [stats, setStats] = useState([]);
  const [selected, setSelected] = useState(null);
  const [entering, setEntering] = useState(false);
  const [customStrategies, setCustomStrategies] = useState([]);
  const [proStrategies, setProStrategies] = useState([]);
  const [visibleStratIds, setVisibleStratIds] = useState(null); // null = loading

  useEffect(() => {
    fetch('/api/predictions/stats', { credentials: 'include' })
      .then(r => r.ok ? r.json() : [])
      .then(setStats)
      .catch(() => {});
    Promise.all([
      fetch('/api/admin/strategies', { credentials: 'include' }).then(r => r.ok ? r.json() : []),
      fetch('/api/admin/my-strategies', { credentials: 'include' }).then(r => r.ok ? r.json() : { visible: [] }),
      fetch('/api/admin/pro-strategies', { credentials: 'include' }).then(r => r.ok ? r.json() : { strategies: [] }),
    ]).then(([allStrats, myStrats, proData]) => {
      setCustomStrategies(Array.isArray(allStrats) ? allStrats : []);
      setVisibleStratIds(new Set(myStrats.visible || []));
      setProStrategies(proData.strategies || []);
    }).catch(() => setVisibleStratIds(new Set()));
  }, []);

  const canSeeStrategy = id => {
    if (user?.is_admin) return true;
    if (visibleStratIds === null) return false; // still loading
    return visibleStratIds.has(id);
  };

  const CUSTOM_COLORS = [
    { color: '#a855f7', glow: 'rgba(168,85,247,0.35)' },
    { color: '#06b6d4', glow: 'rgba(6,182,212,0.35)' },
    { color: '#f97316', glow: 'rgba(249,115,22,0.35)' },
    { color: '#ec4899', glow: 'rgba(236,72,153,0.35)' },
    { color: '#84cc16', glow: 'rgba(132,204,22,0.35)' },
    { color: '#14b8a6', glow: 'rgba(20,184,166,0.35)' },
  ];

  const getStats = id => {
    const s = stats.find(x => x.strategy === id);
    if (!s) return { wins: 0, losses: 0, total: 0, rate: '—' };
    const w = parseInt(s.wins) || 0;
    const l = parseInt(s.losses) || 0;
    return {
      wins: w, losses: l, total: w + l,
      rate: w + l > 0 ? ((w / (w + l)) * 100).toFixed(0) + '%' : '—',
    };
  };

  const handleSelect = (id) => {
    setSelected(id);
    setEntering(true);
    setTimeout(() => {
      navigate(`/dashboard/${id}`);
    }, 600);
  };

  const handleLogout = async () => { await logout(); navigate('/'); };

  return (
    <div className="select-page">
      <nav className="navbar">
        <Link to="/" className="navbar-brand">🎲 Prediction Baccara Pro</Link>
        <div className="navbar-actions">
          {user?.is_admin && <Link to="/admin" className="btn btn-ghost btn-sm">⚙ Admin</Link>}
          {!user?.is_admin && user?.is_pro && <Link to="/admin" className="btn btn-ghost btn-sm" style={{ color: '#818cf8', borderColor: 'rgba(99,102,241,0.4)' }}>🔷 Config Pro & Telegram</Link>}
          {!user?.is_admin && <ContactAdminModal />}
          <button className="btn btn-danger btn-sm" onClick={handleLogout}>Déconnexion</button>
        </div>
      </nav>

      {!user?.is_admin && user?.status === 'expired' && (
        <div style={{
          margin: '20px auto', maxWidth: 720, padding: '16px 20px', borderRadius: 12,
          background: 'rgba(239,68,68,0.1)', border: '2px solid rgba(239,68,68,0.5)',
          display: 'flex', alignItems: 'center', gap: 14, color: '#fca5a5',
        }}>
          <div style={{ fontSize: 32 }}>🔒</div>
          <div style={{ flex: 1 }}>
            <div style={{ fontWeight: 800, fontSize: 16, color: '#fff', marginBottom: 4 }}>Abonnement expiré</div>
            <div style={{ fontSize: 13 }}>Toutes les fonctionnalités sont bloquées. Contactez l'administrateur pour renouveler votre accès.</div>
          </div>
        </div>
      )}
      {!user?.is_admin && user?.status === 'pending' && (
        <div style={{
          margin: '20px auto', maxWidth: 720, padding: '16px 20px', borderRadius: 12,
          background: 'rgba(251,191,36,0.1)', border: '2px solid rgba(251,191,36,0.5)',
          display: 'flex', alignItems: 'center', gap: 14, color: '#fcd34d',
        }}>
          <div style={{ fontSize: 32 }}>⏳</div>
          <div style={{ flex: 1 }}>
            <div style={{ fontWeight: 800, fontSize: 16, color: '#fff', marginBottom: 4 }}>Compte en attente</div>
            <div style={{ fontSize: 13 }}>Votre compte attend la validation de l'administrateur.</div>
          </div>
        </div>
      )}
      {!user?.is_admin && user?.status === 'active' && user?.subscription_expires_at && (() => {
        const ms = new Date(user.subscription_expires_at) - new Date();
        if (ms <= 0) return null;
        const totalMin = Math.floor(ms / 60000);
        const days = Math.floor(totalMin / (60 * 24));
        const hours = Math.floor((totalMin % (60 * 24)) / 60);
        const mins = totalMin % 60;
        let txt = '';
        if (days > 0) txt = `${days} j ${hours} h`;
        else if (hours > 0) txt = `${hours} h ${mins} min`;
        else txt = `${mins} min`;
        const dt = new Date(user.subscription_expires_at);
        const fmt = dt.toLocaleString('fr-FR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
        return (
          <div style={{
            margin: '20px auto', maxWidth: 720, padding: '14px 20px', borderRadius: 12,
            background: 'rgba(34,197,94,0.08)', border: '2px solid rgba(34,197,94,0.4)',
            display: 'flex', alignItems: 'center', gap: 14, color: '#86efac',
          }}>
            <div style={{ fontSize: 28 }}>⏱️</div>
            <div style={{ flex: 1 }}>
              <div style={{ fontWeight: 800, fontSize: 15, color: '#fff', marginBottom: 2 }}>
                Abonnement actif — {txt} restant{days > 1 || (days === 0 && hours > 1) ? 's' : ''}
              </div>
              <div style={{ fontSize: 12, color: '#bbf7d0' }}>Expire le {fmt}</div>
            </div>
          </div>
        );
      })()}

      <div className="select-header">
        <div className="select-header-badge">🎯 ACCÈS PRÉDICTIONS</div>
        <h1 className="select-header-title">Choisissez votre canal</h1>
        <p className="select-header-sub">
          Faites défiler et sélectionnez le canal d'analyse<br />qui correspond à votre style de jeu
        </p>
        <div className="select-scroll-hint">
          <span>↓</span> Faites défiler pour explorer
        </div>
      </div>

      <div className="select-cards">
        {visibleStratIds === null && !user?.is_admin && (
          <div style={{ padding: 48, textAlign: 'center', color: '#64748b', fontSize: 14 }}>
            <div className="spinner" style={{ margin: '0 auto 12px' }} />
            Chargement de vos accès…
          </div>
        )}
        {(visibleStratIds !== null || user?.is_admin) && (() => {
          const visChannels = CHANNELS.filter(ch => canSeeStrategy(ch.id));
          const visCustom   = customStrategies.filter(s => canSeeStrategy(`S${s.id}`));
          if (!user?.is_admin && visChannels.length === 0 && visCustom.length === 0) {
            return (
              <div style={{ gridColumn: '1/-1', textAlign: 'center', padding: '60px 24px', color: '#64748b' }}>
                <div style={{ fontSize: 48, marginBottom: 16 }}>🔒</div>
                <div style={{ fontSize: 18, fontWeight: 700, color: '#94a3b8', marginBottom: 8 }}>Aucun accès assigné</div>
                <div style={{ fontSize: 14 }}>L'administrateur n'a pas encore activé de stratégie pour votre compte.<br/>Contactez l'administrateur pour obtenir l'accès.</div>
              </div>
            );
          }
          return null;
        })()}
        {(visibleStratIds !== null || user?.is_admin) && CHANNELS.filter(ch => canSeeStrategy(ch.id)).map((ch, i) => {
          const s = getStats(ch.id);
          const isSelected = selected === ch.id;
          return (
            <div
              key={ch.id}
              className={`select-card ${isSelected ? 'selected' : ''} ${entering && !isSelected ? 'fading' : ''}`}
              style={{ '--ch-color': ch.color, '--ch-glow': ch.glow, animationDelay: `${i * 0.12}s` }}
            >
              <div className="select-card-top">
                <div className="select-card-emoji">{ch.emoji}</div>
                <div className="select-card-badge">{ch.badge}</div>
              </div>
              <h2 className="select-card-name">{ch.name}</h2>
              <p className="select-card-desc">{ch.desc}</p>

              <div className="select-card-stats">
                <div className="select-stat">
                  <span className="select-stat-val" style={{ color: '#22c55e' }}>{s.wins}</span>
                  <span className="select-stat-label">Gagnés</span>
                </div>
                <div className="select-stat">
                  <span className="select-stat-val" style={{ color: '#ef4444' }}>{s.losses}</span>
                  <span className="select-stat-label">Perdus</span>
                </div>
                <div className="select-stat">
                  <span className="select-stat-val" style={{ color: ch.color }}>{s.rate}</span>
                  <span className="select-stat-label">Win %</span>
                </div>
              </div>

              <button
                className="select-card-btn"
                onClick={() => handleSelect(ch.id)}
                disabled={entering}
              >
                {isSelected ? '⚡ Chargement...' : 'Entrer dans ce canal →'}
              </button>
            </div>
          );
        })}

        {/* ── Stratégies Pro (S5001, S5002…) ── */}
        {(user?.is_admin || user?.is_pro) && proStrategies.map((pro, i) => {
          const st = getStats(pro.id);
          const isSelected = selected === pro.id;
          return (
            <div
              key={pro.id}
              className={`select-card ${isSelected ? 'selected' : ''} ${entering && !isSelected ? 'fading' : ''}`}
              style={{ '--ch-color': '#a855f7', '--ch-glow': 'rgba(168,85,247,0.45)', animationDelay: `${(4 + i) * 0.12}s`, position: 'relative', overflow: 'hidden' }}
            >
              {/* Effet fond Pro */}
              <div style={{ position: 'absolute', inset: 0, background: 'linear-gradient(135deg,rgba(99,102,241,0.08) 0%,rgba(168,85,247,0.06) 100%)', pointerEvents: 'none' }} />
              <div className="select-card-top">
                <div className="select-card-emoji">🔷</div>
                <div className="select-card-badge" style={{ background: 'linear-gradient(135deg,#6366f1,#a855f7)', color: '#fff', fontWeight: 900 }}>
                  PRO
                </div>
              </div>
              <h2 className="select-card-name" style={{ color: '#c4b5fd' }}>{pro.name}</h2>
              <p className="select-card-desc" style={{ color: '#94a3b8', fontSize: 12 }}>
                {pro.filename && <span style={{ display: 'block', fontFamily: 'monospace', color: '#6366f1', marginBottom: 4 }}>{pro.filename}</span>}
                Main : {pro.hand} · Rattrapage max : R{pro.max_rattrapage} · ID : {pro.id}
              </p>

              <div className="select-card-stats">
                <div className="select-stat">
                  <span className="select-stat-val" style={{ color: '#22c55e' }}>{st.wins}</span>
                  <span className="select-stat-label">Gagnés</span>
                </div>
                <div className="select-stat">
                  <span className="select-stat-val" style={{ color: '#ef4444' }}>{st.losses}</span>
                  <span className="select-stat-label">Perdus</span>
                </div>
                <div className="select-stat">
                  <span className="select-stat-val" style={{ color: '#a855f7' }}>{st.rate}</span>
                  <span className="select-stat-label">Win %</span>
                </div>
              </div>

              <button
                className="select-card-btn"
                style={{ background: 'linear-gradient(135deg,#6366f1,#a855f7)', boxShadow: '0 4px 16px rgba(99,102,241,0.35)' }}
                onClick={() => handleSelect(pro.id)}
                disabled={entering}
              >
                {isSelected ? '⚡ Chargement...' : 'Entrer dans ce canal →'}
              </button>
            </div>
          );
        })}

        {/* Stratégies personnalisées (S7, S8…) */}
        {customStrategies.filter(s => canSeeStrategy(`S${s.id}`)).map((s, i) => {
          const cid = `S${s.id}`;
          const { color, glow } = CUSTOM_COLORS[i % CUSTOM_COLORS.length];
          const st = getStats(cid);
          return (
            <div
              key={cid}
              className={`select-card ${selected === cid ? 'selected' : ''} ${entering && selected !== cid ? 'fading' : ''}`}
              style={{ '--ch-color': color, '--ch-glow': glow, animationDelay: `${(4 + i) * 0.12}s` }}
            >
              <div className="select-card-top">
                <div className="select-card-emoji">⚙</div>
                <div className="select-card-badge" style={{ background: color }}>
                  {user?.is_admin ? 'ADMIN' : 'PREMIUM'}
                </div>
              </div>
              <h2 className="select-card-name">{s.name}</h2>
              <p className="select-card-desc">
                Seuil B={s.threshold} · {s.mode === 'manquants' ? 'Absences' : 'Apparitions'} · Stratégie {s.id}
              </p>

              <div className="select-card-stats">
                <div className="select-stat">
                  <span className="select-stat-val" style={{ color: '#22c55e' }}>{st.wins}</span>
                  <span className="select-stat-label">Gagnés</span>
                </div>
                <div className="select-stat">
                  <span className="select-stat-val" style={{ color: '#ef4444' }}>{st.losses}</span>
                  <span className="select-stat-label">Perdus</span>
                </div>
                <div className="select-stat">
                  <span className="select-stat-val" style={{ color }}>{st.rate}</span>
                  <span className="select-stat-label">Win %</span>
                </div>
              </div>

              <button
                className="select-card-btn"
                style={{ background: `linear-gradient(135deg, ${color}cc, ${color})` }}
                onClick={() => handleSelect(cid)}
                disabled={entering}
              >
                {selected === cid ? '⚡ Chargement...' : 'Entrer dans ce canal →'}
              </button>
            </div>
          );
        })}

      </div>

      <div className="select-footer">
        <p>Vous pouvez changer de canal à tout moment depuis le tableau de bord</p>
      </div>
    </div>
  );
}
