import { useState, useEffect } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';

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
  const [customStrategies, setCustomStrategies] = useState([]); // visible custom strategies

  useEffect(() => {
    fetch('/api/predictions/stats', { credentials: 'include' })
      .then(r => r.ok ? r.json() : [])
      .then(setStats)
      .catch(() => {});
    fetch('/api/admin/strategies', { credentials: 'include' })
      .then(r => r.ok ? r.json() : [])
      .then(d => setCustomStrategies(Array.isArray(d) ? d : []))
      .catch(() => {});
  }, []);

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
        <Link to="/" className="navbar-brand">🎰 BACCARAT PRO</Link>
        <div className="navbar-actions">
          {user?.is_admin && <Link to="/admin" className="btn btn-ghost btn-sm">⚙ Admin</Link>}
          <button className="btn btn-danger btn-sm" onClick={handleLogout}>Déconnexion</button>
        </div>
      </nav>

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
        {CHANNELS.map((ch, i) => {
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

        {/* Stratégies personnalisées (S7, S8…) */}
        {customStrategies.map((s, i) => {
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

        {/* 5th card — Telegram channel */}
        <div
          className={`select-card select-card-tg ${entering ? 'fading' : ''}`}
          style={{ '--ch-color': '#229ed9', '--ch-glow': 'rgba(34,158,217,0.35)', animationDelay: `${4 * 0.12}s` }}
        >
          <div className="select-card-top">
            <div className="select-card-emoji">✈️</div>
            <div className="select-card-badge tg-badge">LIVE</div>
          </div>
          <h2 className="select-card-name">Canal Telegram</h2>
          <p className="select-card-desc">
            Suivez en direct les messages du canal Telegram officiel. Signaux, alertes et annonces en temps réel.
          </p>

          <div className="select-card-stats tg-stats">
            <div className="select-stat">
              <span className="select-stat-val" style={{ color: '#229ed9' }}>∞</span>
              <span className="select-stat-label">Messages</span>
            </div>
            <div className="select-stat">
              <span className="select-stat-val" style={{ color: '#22c55e' }}>🔴</span>
              <span className="select-stat-label">En direct</span>
            </div>
            <div className="select-stat">
              <span className="select-stat-val" style={{ color: '#f59e0b' }}>📡</span>
              <span className="select-stat-label">Flux SSE</span>
            </div>
          </div>

          <button
            className="select-card-btn tg-card-btn"
            onClick={() => navigate('/canal-telegram')}
            disabled={entering}
          >
            Voir les messages →
          </button>
        </div>
      </div>

      <div className="select-footer">
        <p>Vous pouvez changer de canal à tout moment depuis le tableau de bord</p>
      </div>
    </div>
  );
}
