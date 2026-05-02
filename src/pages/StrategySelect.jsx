import { useState, useEffect } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { useLanguage } from '../context/LanguageContext';
import ContactAdminModal from '../components/ContactAdminModal';
import Avatar from '../components/Avatar';
import LanguageSwitcher from '../components/LanguageSwitcher';

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
  const { t } = useLanguage();
  const navigate = useNavigate();
  const [stats, setStats] = useState([]);
  const [selected, setSelected] = useState(null);
  const [entering, setEntering] = useState(false);
  const [customStrategies, setCustomStrategies] = useState([]);
  const [proStrategies, setProStrategies] = useState([]);
  const [visibleStratIds, setVisibleStratIds] = useState(null); // null = loading
  const [allowedModes, setAllowedModes] = useState(null); // null = all modes allowed

  useEffect(() => {
    fetch('/api/predictions/stats', { credentials: 'include' })
      .then(r => r.ok ? r.json() : [])
      .then(setStats)
      .catch(() => {});
    Promise.all([
      fetch('/api/admin/strategies', { credentials: 'include' }).then(r => r.ok ? r.json() : []),
      fetch('/api/admin/my-strategies', { credentials: 'include' }).then(r => r.ok ? r.json() : { visible: [] }),
      fetch('/api/admin/pro-strategies', { credentials: 'include' }).then(r => r.ok ? r.json() : { strategies: [] }),
      fetch('/api/admin/my-allowed-modes', { credentials: 'include' }).then(r => r.ok ? r.json() : { allowed_modes: null }),
    ]).then(([allStrats, myStrats, proData, modesData]) => {
      setCustomStrategies(Array.isArray(allStrats) ? allStrats : []);
      setVisibleStratIds(new Set(myStrats.visible || []));
      setProStrategies(proData.strategies || []);
      const modes = modesData.allowed_modes;
      setAllowedModes(Array.isArray(modes) ? modes : null);
    }).catch(() => setVisibleStratIds(new Set()));
  }, []);

  const isModeAllowed = (mode) => {
    if (user?.is_admin) return true;
    if (!allowedModes) return true; // null = all modes allowed
    return allowedModes.includes(mode);
  };

  const canSeeStrategy = (id, mode) => {
    if (user?.is_admin) return true;
    if (visibleStratIds === null) return false; // still loading
    if (!visibleStratIds.has(id)) return false;
    if (mode && !isModeAllowed(mode)) return false;
    return true;
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

  // ── Verrouillage total si abonnement expiré (non admin) ───────────────
  // Aucun canal visible : seul l'écran de renouvellement.
  const lockedExpired = !!user && !user.is_admin && user.status === 'expired';
  if (lockedExpired) {
    return (
      <div className="select-page">
        <nav className="navbar">
          <Link to="/" className="navbar-brand">🎲 Prediction Baccara Pro</Link>
          <div className="navbar-actions">
            <Avatar user={user} size={36} style={{ marginLeft: 6 }} />
            <button className="btn btn-danger btn-sm" onClick={handleLogout}>Déconnexion</button>
          </div>
        </nav>
        <div style={{
          maxWidth: 720, margin: '40px auto', padding: '28px 24px', borderRadius: 16,
          background: 'rgba(239,68,68,0.08)', border: '2px solid rgba(239,68,68,0.55)',
          textAlign: 'center', color: '#fca5a5',
        }}>
          <div style={{ fontSize: 56, marginBottom: 12 }}>🔒</div>
          <h2 style={{ color: '#fff', margin: '0 0 8px', fontSize: 22 }}>Abonnement expiré</h2>
          <p style={{ color: '#fecaca', margin: '0 0 18px', fontSize: 14, lineHeight: 1.5 }}>
            Tous les canaux et toutes les prédictions sont bloqués.<br/>
            Renouvelez votre abonnement pour retrouver l'accès complet.
          </p>
          <div style={{ display: 'flex', gap: 10, justifyContent: 'center', flexWrap: 'wrap' }}>
            <Link to="/paiement" className="btn btn-gold">💳 Renouveler maintenant</Link>
            <Link to="/" className="btn btn-ghost">Retour à l'accueil</Link>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="select-page">
      <nav className="navbar">
        <Link to="/" className="navbar-brand">🎲 Prediction Baccara Pro</Link>
        <div className="navbar-actions">
          {user?.is_admin && <Link to="/admin" className="btn btn-ghost btn-sm">⚙ Admin</Link>}
          {!user?.is_admin && user?.is_pro && <Link to="/admin" className="btn btn-ghost btn-sm" style={{ color: '#818cf8', borderColor: 'rgba(99,102,241,0.4)' }}>🔷 Config Pro & Telegram</Link>}
          {!user?.is_admin && (user?.is_pro || user?.is_premium) && (
            <Link to="/comptages" className="btn btn-ghost btn-sm" style={{ color: '#4ade80', borderColor: 'rgba(34,197,94,0.4)' }}>📈 Comptages</Link>
          )}
          {!user?.is_admin && (
            <Link to="/paiement" className="btn btn-ghost btn-sm" style={{ color: '#fbbf24', borderColor: 'rgba(251,191,36,0.4)' }}>💳 Paiement</Link>
          )}
          {!user?.is_admin && (
            <span style={{
              fontSize: 11, fontWeight: 800, padding: '2px 8px', borderRadius: 6,
              background: user?.is_pro ? 'rgba(99,102,241,0.18)' : user?.is_premium ? 'rgba(251,191,36,0.15)' : 'rgba(100,116,139,0.15)',
              color: user?.is_pro ? '#818cf8' : user?.is_premium ? '#fbbf24' : '#94a3b8',
              border: `1px solid ${user?.is_pro ? 'rgba(99,102,241,0.4)' : user?.is_premium ? 'rgba(251,191,36,0.35)' : 'rgba(100,116,139,0.3)'}`,
            }}>
              {user?.is_pro ? '🔷 PRO' : user?.is_premium ? '⭐ PREMIUM' : '👤 UTILISATEUR'}
            </span>
          )}
          {!user?.is_admin && <ContactAdminModal />}
          <LanguageSwitcher compact />
          <button className="btn btn-danger btn-sm" onClick={handleLogout}>{t('nav.logout')}</button>
          <Avatar user={user} size={36} style={{ marginLeft: 6 }} />
        </div>
      </nav>

      {!user?.is_admin && user?.status === 'expired' && (
        <div style={{
          margin: '20px auto', maxWidth: 720, padding: '18px 22px', borderRadius: 12,
          background: 'rgba(239,68,68,0.1)', border: '2px solid rgba(239,68,68,0.5)',
          display: 'flex', alignItems: 'center', gap: 14, color: '#fca5a5', flexWrap: 'wrap',
        }}>
          <div style={{ fontSize: 32 }}>🔒</div>
          <div style={{ flex: 1, minWidth: 220 }}>
            <div style={{ fontWeight: 800, fontSize: 16, color: '#fff', marginBottom: 4 }}>Abonnement expiré</div>
            <div style={{ fontSize: 13 }}>Renouvelez maintenant pour continuer à utiliser les prédictions.</div>
          </div>
          <Link to="/paiement" className="btn btn-gold">💳 Renouveler</Link>
        </div>
      )}

      {!user?.is_admin && user?.promo_code && (
        <div style={{
          margin: '14px auto', maxWidth: 720, padding: '14px 18px', borderRadius: 12,
          background: 'linear-gradient(135deg, rgba(251,191,36,0.10), rgba(245,158,11,0.05))',
          border: '1px solid rgba(251,191,36,0.35)',
          display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap',
        }}>
          <div style={{ fontSize: 28 }}>🎁</div>
          <div style={{ flex: 1, minWidth: 200 }}>
            <div style={{ color: '#fbbf24', fontSize: 11, fontWeight: 700, letterSpacing: 1, marginBottom: 4 }}>
              VOTRE CODE PROMO PERSONNEL
            </div>
            <div style={{
              fontFamily: 'monospace', fontSize: 18, fontWeight: 900,
              color: '#fff', letterSpacing: 2, wordBreak: 'break-all',
            }}>
              {user.promo_code}
            </div>
            <div style={{ fontSize: 11, color: '#fcd34d', marginTop: 4 }}>
              Partagez-le : <b>20 % de remise</b> pour le filleul, <b>20 % de durée</b> en bonus pour vous.
              {user.bonus_minutes_earned > 0 && (
                <span style={{ display: 'block', marginTop: 2, color: '#86efac' }}>
                  ✨ Bonus déjà gagné : {Math.floor(user.bonus_minutes_earned / 60)} h {user.bonus_minutes_earned % 60} min
                </span>
              )}
            </div>
          </div>
          <button
            onClick={() => { try { navigator.clipboard.writeText(user.promo_code); } catch {} }}
            className="btn btn-ghost btn-sm"
          >
            📋 Copier
          </button>
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
        <div className="select-header-badge">🎯 {t('channel.available').toUpperCase()}</div>
        <h1 className="select-header-title">{t('strategy.title')}</h1>
        <p className="select-header-sub">{t('strategy.subtitle')}</p>
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
          const visChannels = CHANNELS.filter(ch => canSeeStrategy(ch.id, null));
          const visCustom   = customStrategies.filter(s => canSeeStrategy(`S${s.id}`, s.mode));
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
        {(visibleStratIds !== null || user?.is_admin) && CHANNELS.filter(ch => canSeeStrategy(ch.id, null)).map((ch, i) => {
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

        {/* Stratégies personnalisées (S7, S8…) — PRO et admin uniquement */}
        {(user?.is_admin || user?.is_pro) && customStrategies.filter(s => canSeeStrategy(`S${s.id}`, s.mode)).map((s, i) => {
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
                  {user?.is_admin ? 'ADMIN' : 'PRO'}
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
