import { useState, useEffect, useRef, useCallback } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';

// Durées de sonnerie disponibles (0 = infini jusqu'au raccroché)
const RING_DURATIONS = [
  { label: '5 s',  value: 5 },
  { label: '10 s', value: 10 },
  { label: '15 s', value: 15 },
  { label: '30 s', value: 30 },
  { label: '∞',    value: 0, title: "Jusqu'au raccroché" },
];

/**
 * Démarre la sonnerie en boucle + vibration.
 * Retourne une fonction stop() pour arrêter proprement.
 */
function startRinging() {
  let stopped  = false;
  let audioCtx = null;
  let ringLoop = null;
  let vibLoop  = null;

  const TONES  = [880, 1109.73];   // double-ton sonnerie
  const PERIOD = 2600;             // ms entre chaque cycle

  function playOneCycle() {
    if (stopped || !audioCtx) return;
    const master = audioCtx.createGain();
    master.gain.value = 0.72;
    master.connect(audioCtx.destination);

    // Double sonnerie : deux rafales
    [[0.00, 0.40], [0.50, 0.90]].forEach(([ts, te]) => {
      const t0 = audioCtx.currentTime + ts;
      const t1 = audioCtx.currentTime + te;
      TONES.forEach(freq => {
        const osc  = audioCtx.createOscillator();
        const gain = audioCtx.createGain();
        osc.connect(gain); gain.connect(master);
        osc.type = 'sine'; osc.frequency.value = freq;
        gain.gain.setValueAtTime(0, t0);
        gain.gain.linearRampToValueAtTime(0.55, t0 + 0.025);
        gain.gain.setValueAtTime(0.55, t1 - 0.025);
        gain.gain.linearRampToValueAtTime(0, t1);
        osc.start(t0); osc.stop(t1 + 0.05);
      });
    });
  }

  function vibrate() {
    if (!stopped && navigator.vibrate) {
      // Motif téléphone : 3 impulsions + pause longue
      navigator.vibrate([220, 110, 220, 110, 220, 600]);
    }
  }

  try {
    audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    playOneCycle();
    vibrate();
    ringLoop = setInterval(() => { if (!stopped) { playOneCycle(); } }, PERIOD);
    vibLoop  = setInterval(() => { if (!stopped) { vibrate();      } }, PERIOD);
  } catch {}

  return function stop() {
    stopped = true;
    clearInterval(ringLoop);
    clearInterval(vibLoop);
    if (navigator.vibrate) navigator.vibrate(0); // coupe vibration immédiatement
    try { if (audioCtx) audioCtx.close(); } catch {}
  };
}

const BASE_CHANNELS = {
  C1: { name: 'Pique Noir',    emoji: '♠', color: '#3b82f6', glow: 'rgba(59,130,246,0.3)',  desc: 'B=5 · Absences noires' },
  C2: { name: 'Cœur Rouge',   emoji: '♥', color: '#ef4444', glow: 'rgba(239,68,68,0.3)',   desc: 'B=8 · Séquences rouges' },
  C3: { name: 'Carreau Doré', emoji: '♦', color: '#f59e0b', glow: 'rgba(245,158,11,0.3)',  desc: 'B=5 · Patterns dorés' },
  DC: { name: 'Double Canal', emoji: '♣', color: '#22c55e', glow: 'rgba(34,197,94,0.3)',   desc: 'Escalade progressive' },
};

const SUIT_LABELS = { '♠': 'Pique', '♥': 'Cœur', '♦': 'Carreau', '♣': 'Trèfle', '♠️': 'Pique', '❤️': 'Cœur', '♦️': 'Carreau', '♣️': 'Trèfle' };

function suitLabel(s) { return SUIT_LABELS[s] || s || '—'; }

function rankDisplay(r) {
  if (r === 1 || r === '1') return 'A';
  if (r === 11 || r === '11') return 'J';
  if (r === 12 || r === '12') return 'Q';
  if (r === 13 || r === '13') return 'K';
  return r !== undefined && r !== null ? String(r) : '?';
}

function baccPoints(cards) {
  const total = (cards || []).reduce((sum, c) => {
    const n = parseInt(c.R);
    return sum + (isNaN(n) ? 0 : n >= 10 ? 0 : n);
  }, 0);
  return total % 10;
}

function formatTime(iso) {
  if (!iso) return '';
  return new Date(iso).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

function formatDate(iso) {
  if (!iso) return '';
  return new Date(iso).toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit' });
}

function useCountdown(expiresAt) {
  const [text, setText] = useState('');
  useEffect(() => {
    if (!expiresAt) { setText(''); return; }
    const tick = () => {
      const diff = new Date(expiresAt) - new Date();
      if (diff <= 0) { setText('Expiré'); return; }
      const d = Math.floor(diff / 86400000);
      const h = Math.floor((diff % 86400000) / 3600000);
      const m = Math.floor((diff % 3600000) / 60000);
      setText(d > 0 ? `${d}j ${h}h` : `${h}h ${m}min`);
    };
    tick();
    const id = setInterval(tick, 60000);
    return () => clearInterval(id);
  }, [expiresAt]);
  return text;
}

export default function Dashboard() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const { strategy } = useParams();

  const [customStrategies, setCustomStrategies] = useState([]); // list from /api/admin/strategies

  // Build CHANNELS dynamically — add custom strategies as S7, S8, etc.
  const CUSTOM_COLORS = [
    { color: '#a855f7', glow: 'rgba(168,85,247,0.3)' },
    { color: '#06b6d4', glow: 'rgba(6,182,212,0.3)' },
    { color: '#f97316', glow: 'rgba(249,115,22,0.3)' },
    { color: '#ec4899', glow: 'rgba(236,72,153,0.3)' },
    { color: '#84cc16', glow: 'rgba(132,204,22,0.3)' },
    { color: '#14b8a6', glow: 'rgba(20,184,166,0.3)' },
  ];
  const CHANNELS = { ...BASE_CHANNELS };
  customStrategies.forEach((s, i) => {
    const { color, glow } = CUSTOM_COLORS[i % CUSTOM_COLORS.length];
    CHANNELS[`S${s.id}`] = {
      name: s.name,
      emoji: '⚙',
      color,
      glow,
      desc: `Stratégie ${s.id} · B=${s.threshold} · ${s.mode}`,
    };
  });

  // Use the URL param directly — don't fallback to C1 before custom strategies load
  const channelId = strategy || 'C1';
  // Placeholder while custom strategies are still loading (S7, S8…)
  const channel = CHANNELS[channelId] || {
    name: channelId,
    emoji: '⚙',
    color: '#a855f7',
    glow: 'rgba(168,85,247,0.3)',
    desc: 'Chargement de la stratégie…',
  };

  const [visibleStratIds, setVisibleStratIds] = useState(null); // null = still loading

  const [predictions, setPredictions] = useState([]);
  const [games, setGames] = useState([]);
  const [stats, setStats] = useState([]);
  const [absences, setAbsences] = useState([]);
  const [tgMessages, setTgMessages] = useState([]);
  const [alertPred, setAlertPred] = useState(null);
  const [loadingGames, setLoadingGames] = useState(true);
  const [showRingSettings, setShowRingSettings] = useState(false);
  const [ringDuration, setRingDuration] = useState(() => {
    const s = localStorage.getItem('ringDuration');
    return s !== null ? parseInt(s, 10) : 10;
  });

  const gamesRef    = useRef(null);
  const knownPredIds = useRef(new Set());
  const alertTimer  = useRef(null);
  const stopRingRef = useRef(null); // fonction stop() retournée par startRinging()
  const ringDurRef  = useRef(ringDuration);
  useEffect(() => { ringDurRef.current = ringDuration; }, [ringDuration]);

  const countdown = useCountdown(user?.subscription_expires_at);

  const hasAccess = user?.status === 'active' || user?.is_admin;

  useEffect(() => {
    if (!hasAccess) {
      fetch('/api/games/live', { credentials: 'include' })
        .then(r => r.ok ? r.json() : []).then(setGames).finally(() => setLoadingGames(false));
      return;
    }
    const es = new EventSource('/api/games/stream');
    es.onmessage = e => { setGames(JSON.parse(e.data)); setLoadingGames(false); };
    es.onerror = () => setLoadingGames(false);
    return () => es.close();
  }, [hasAccess]);

  // Fetch visible strategies for this user and enforce access
  useEffect(() => {
    if (user?.is_admin) { setVisibleStratIds(new Set(['C1','C2','C3','DC','ALL'])); return; }
    fetch('/api/admin/my-strategies', { credentials: 'include' })
      .then(r => r.ok ? r.json() : { visible: [] })
      .then(d => {
        const ids = new Set(d.visible || []);
        setVisibleStratIds(ids);
        // Redirect if current strategy not in visible set
        if (channelId && !ids.has(channelId)) {
          navigate('/select');
        }
      })
      .catch(() => setVisibleStratIds(new Set()));
  }, [user?.is_admin, channelId]); // eslint-disable-line

  // Fetch custom strategies (S7, S8…)
  useEffect(() => {
    fetch('/api/admin/strategies', { credentials: 'include' })
      .then(r => r.ok ? r.json() : [])
      .then(d => setCustomStrategies(Array.isArray(d) ? d : []))
      .catch(() => {});
  }, []);

  const dismissAlert = useCallback(() => {
    if (stopRingRef.current) { stopRingRef.current(); stopRingRef.current = null; }
    if (alertTimer.current)  { clearTimeout(alertTimer.current); alertTimer.current = null; }
    setAlertPred(null);
    setShowRingSettings(false);
  }, []);

  const triggerAlert = useCallback((pred) => {
    // Arrêter une sonnerie précédente si elle tourne encore
    if (stopRingRef.current) { stopRingRef.current(); stopRingRef.current = null; }
    if (alertTimer.current)  { clearTimeout(alertTimer.current); alertTimer.current = null; }

    setAlertPred(pred);
    stopRingRef.current = startRinging();

    const dur = ringDurRef.current;
    if (dur > 0) {
      // Auto-raccroché après la durée configurée
      alertTimer.current = setTimeout(() => {
        if (stopRingRef.current) { stopRingRef.current(); stopRingRef.current = null; }
        setAlertPred(null);
      }, dur * 1000);
    }
    // Si dur === 0 → sonne indéfiniment jusqu'au raccroché manuel
  }, []);

  useEffect(() => {
    if (!hasAccess) return;
    const es = new EventSource('/api/predictions/stream');
    es.onmessage = e => {
      const data = JSON.parse(e.data);
      setPredictions(data);
      // detect new en_cours predictions for current channel
      data.forEach(p => {
        if (p.strategy === channelId && p.status === 'en_cours' && !knownPredIds.current.has(p.id)) {
          if (knownPredIds.current.size > 0) triggerAlert(p); // skip initial load
          knownPredIds.current.add(p.id);
        }
      });
      // clean up resolved ids that are no longer en_cours
      const activeIds = new Set(data.filter(p => p.status === 'en_cours').map(p => p.id));
      knownPredIds.current = new Set([...knownPredIds.current].filter(id => activeIds.has(id) || data.some(p => p.id === id)));
    };
    es.onerror = () => {};
    return () => es.close();
  }, [hasAccess, channelId, triggerAlert]);

  useEffect(() => {
    if (!hasAccess) return;
    const load = () =>
      fetch('/api/predictions/stats', { credentials: 'include' })
        .then(r => r.ok ? r.json() : []).then(setStats);
    load();
    const t = setInterval(load, 15000);
    return () => clearInterval(t);
  }, [hasAccess]);

  useEffect(() => {
    if (!user?.is_admin) return;
    const load = () =>
      fetch(`/api/games/absences?channel=${channelId}`, { credentials: 'include' })
        .then(r => r.ok ? r.json() : []).then(setAbsences);
    load();
    const t = setInterval(load, 5000);
    return () => clearInterval(t);
  }, [user?.is_admin, channelId]);

  useEffect(() => {
    if (!hasAccess) return;
    const es = new EventSource('/api/telegram/stream');
    es.onmessage = e => {
      const data = JSON.parse(e.data);
      if (data.type === 'init') setTgMessages(data.messages || []);
      else if (data.type === 'new_message') setTgMessages(prev => [data.message, ...prev].slice(0, 50));
    };
    es.onerror = () => {};
    return () => es.close();
  }, [hasAccess]);

  const getStats = id => {
    const s = stats.find(x => x.strategy === id);
    if (!s) return { wins: 0, losses: 0, pending: 0, total: 0 };
    return {
      wins: parseInt(s.wins) || 0,
      losses: parseInt(s.losses) || 0,
      pending: parseInt(s.pending) || 0,
      total: parseInt(s.total) || 0,
    };
  };

  const channelPreds = predictions.filter(p => p.strategy === channelId);
  const activePred = channelPreds.find(p => p.status === 'en_cours') || null;
  const historyPreds = channelPreds.filter(p => p.status !== 'en_cours');
  const tabStats = getStats(channelId);
  const winRate = tabStats.wins + tabStats.losses > 0
    ? ((tabStats.wins / (tabStats.wins + tabStats.losses)) * 100).toFixed(1)
    : '—';

  const handleLogout = async () => { await logout(); navigate('/'); };
  const handleChangeChannel = () => navigate('/choisir');

  const alertSuitLabel = alertPred ? (SUIT_LABELS[alertPred.predicted_suit] || alertPred.predicted_suit || '?') : '';

  return (
    <div className="dashboard" style={{ '--ch-color': channel.color, '--ch-glow': channel.glow }}>

      {/* ── Prediction alert overlay ── */}
      {alertPred && (
        <div className="pred-alert-overlay">
          <div className="pred-alert-box" style={{ '--alert-color': channel.color, '--alert-glow': channel.glow }}>

            {/* Cercles pulsants — style appel entrant */}
            <div className="pred-alert-rings">
              <div className="ring-circle ring-c1" style={{ borderColor: channel.color }} />
              <div className="ring-circle ring-c2" style={{ borderColor: channel.color }} />
              <div className="ring-circle ring-c3" style={{ borderColor: channel.color }} />
              <span className="pred-alert-phone">📲</span>
            </div>

            <div className="pred-alert-title">PRÉDICTION ENTRANTE</div>
            <div className="pred-alert-channel" style={{ color: channel.color }}>
              {channel.emoji} {channel.name}
            </div>
            <div className="pred-alert-suit">{alertSuitLabel}</div>
            <div className="pred-alert-game">Partie #{alertPred.game_number}</div>

            {/* Barre de progression (durée finie) ou pulsation infinie */}
            {ringDuration > 0 ? (
              <div className="pred-alert-bar" style={{ margin: '12px 0 20px' }}>
                <div className="pred-alert-bar-fill" key={alertPred.id} style={{ animationDuration: `${ringDuration}s` }} />
              </div>
            ) : (
              <div className="pred-alert-bar" style={{ margin: '12px 0 20px' }}>
                <div className="pred-alert-bar-infinite" />
              </div>
            )}

            {/* Bouton RACCROCHER */}
            <button className="pred-alert-hangup" onClick={dismissAlert} title="Raccrocher">
              📵
            </button>

            {/* Durée de sonnerie configurable */}
            <div style={{ marginTop: 18, position: 'relative' }}>
              <button
                className="ring-settings-trigger"
                onClick={e => { e.stopPropagation(); setShowRingSettings(v => !v); }}
                title="Changer la durée de sonnerie"
              >
                🔔 {ringDuration > 0 ? `${ringDuration}s` : '∞'} ▾
              </button>
              {showRingSettings && (
                <div className="ring-settings-menu" onClick={e => e.stopPropagation()}>
                  <div style={{ fontSize: 10, color: '#64748b', fontWeight: 700, marginBottom: 6, letterSpacing: '0.08em' }}>DURÉE DE SONNERIE</div>
                  {RING_DURATIONS.map(opt => (
                    <button
                      key={opt.value}
                      className={`ring-dur-opt${ringDuration === opt.value ? ' active' : ''}`}
                      onClick={() => {
                        setRingDuration(opt.value);
                        localStorage.setItem('ringDuration', opt.value);
                        setShowRingSettings(false);
                      }}
                    >
                      <span>{opt.label}</span>
                      {opt.title && <span style={{ color: '#64748b', fontSize: 10 }}>· {opt.title}</span>}
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      <nav className="navbar">
        <Link to="/" className="navbar-brand">🎰 BACCARAT PRO</Link>
        <div className="navbar-actions">
          {user?.is_admin && <Link to="/admin" className="btn btn-ghost btn-sm">⚙ Admin</Link>}
          <button className="btn btn-ghost btn-sm" onClick={handleChangeChannel}>⇄ Canaux</button>
          <button className="btn btn-danger btn-sm" onClick={handleLogout}>Déconnexion</button>
        </div>
      </nav>

      <div className="dashboard-content">

        {/* Channel header card */}
        <div className="db-header-card" style={{ background: `linear-gradient(135deg, #1a1a2e 0%, #16213e 50%, #0f3460 100%)`, borderColor: `${channel.color}44`, boxShadow: `0 0 40px ${channel.glow}` }}>
          <div className="db-header-top">
            <div className="db-user-info">
              <span className="db-channel-emoji" style={{ color: channel.color }}>{channel.emoji}</span>
              <div>
                <span className="db-username">{channel.name}</span>
                {user?.is_admin && <div className="db-channel-desc">{channel.desc}</div>}
              </div>
            </div>
            {user?.is_admin && (
              <div className="db-win-badge" style={{ background: `${channel.color}22`, border: `1px solid ${channel.color}66`, color: channel.color }}>
                Win % : {winRate === '—' ? '—' : `${winRate}%`}
              </div>
            )}
          </div>
          <div className="db-header-bottom">
            <div className="db-user-row">
              <span className="db-trophy">🏆</span>
              <span className="db-username-small">{user?.username}</span>
              {user?.is_admin && <span className="db-role-badge admin">Admin</span>}
              {!user?.is_admin && <span className="db-role-badge user">Joueur</span>}
            </div>
            {user?.is_admin && (
              <div className="db-timer-row">
                <span className="db-timer-label">TEMPS RESTANT</span>
                <span className="db-timer-val">∞ Illimité</span>
              </div>
            )}
            {!user?.is_admin && user?.subscription_expires_at && (
              <div className="db-timer-row">
                <span className="db-timer-label">TEMPS RESTANT</span>
                <span className="db-timer-val">{countdown}</span>
              </div>
            )}
          </div>
        </div>

        {/* Access banners */}
        {user?.status === 'pending' && (
          <div className="access-banner pending">
            <div className="access-icon">⏳</div>
            <div className="access-info">
              <h3>Compte en attente de validation</h3>
              <p>L'administrateur doit approuver votre accès.</p>
            </div>
          </div>
        )}
        {user?.status === 'expired' && (
          <div className="access-banner expired">
            <div className="access-icon">🔒</div>
            <div className="access-info">
              <h3>Abonnement expiré</h3>
              <p>Contactez l'administrateur pour renouveler votre accès.</p>
            </div>
          </div>
        )}

        {/* Live games */}
        {(() => {
          const LIVE_PHASES = ['PlayerMove', 'DealerMove', 'BankerMove', 'ThirdCard'];
          const liveGame    = games.find(g => !g.is_finished && (LIVE_PHASES.includes(g.phase) || g.player_cards?.length > 0));
          const finishedGames = games.filter(g => g.is_finished).sort((a,b) => b.game_number - a.game_number);
          const upcomingGames = games.filter(g => !g.is_finished && !LIVE_PHASES.includes(g.phase) && !(g.player_cards?.length > 0)).sort((a,b) => a.game_number - b.game_number);

          const isRedSuit = s => s && (s.includes('♥') || s.includes('♦') || s === '❤️');

          const CardChip = ({ c, i }) => (
            <span key={i} className="card-tile" style={{ color: isRedSuit(c.S) ? '#f87171' : '#e2e8f0' }}>
              {rankDisplay(c.R)}{c.S}
            </span>
          );

          const GameRow = ({ g, mode }) => {
            const pCards = g.player_cards || [];
            const bCards = g.banker_cards || [];
            const hasCards = pCards.length > 0 || bCards.length > 0;
            const pPts = baccPoints(pCards);
            const bPts = baccPoints(bCards);
            const winnerLabel = g.winner === 'Player' ? '🟢 Joueur gagne' : g.winner === 'Banker' ? '🔴 Banquier gagne' : g.winner === 'Tie' ? '🟡 Égalité' : null;

            if (mode === 'live') return (
              <div className="game-live-card">
                <div className="glc-header">
                  <span className="glc-badge live">⚡ LIVE</span>
                  <span className="glc-num">Partie #{g.game_number}</span>
                  {g.status_label && <span className="glc-timer">{g.status_label}</span>}
                </div>
                <div className="glc-sides">
                  <div className="glc-side">
                    <div className="glc-side-label">JOUEUR</div>
                    <div className="glc-cards">
                      {hasCards ? pCards.map((c,i) => <CardChip key={i} c={c} />) : <span className="card-dash">—</span>}
                    </div>
                    {hasCards && <div className="glc-pts">{pPts} pt{pPts !== 1 ? 's' : ''}</div>}
                  </div>
                  <div className="glc-vs">VS</div>
                  <div className="glc-side">
                    <div className="glc-side-label">BANQUIER</div>
                    <div className="glc-cards">
                      {hasCards ? bCards.map((c,i) => <CardChip key={i} c={c} />) : <span className="card-dash">—</span>}
                    </div>
                    {hasCards && <div className="glc-pts">{bPts} pt{bPts !== 1 ? 's' : ''}</div>}
                  </div>
                </div>
              </div>
            );

            if (mode === 'finished') return (
              <div className="game-mini-card finished">
                <div className="gmc-header">
                  <span className="glc-badge done">✅ Terminé</span>
                  <span className="gmc-num">#{g.game_number}</span>
                </div>
                <div className="glc-sides compact">
                  <div className="glc-side compact">
                    <div className="glc-side-label" style={{fontSize:'0.6rem'}}>J</div>
                    <div className="glc-cards compact">
                      {hasCards ? pCards.map((c,i) => <CardChip key={i} c={c} />) : <span className="card-dash">—</span>}
                    </div>
                    <div className="glc-pts">{pPts}</div>
                  </div>
                  <div className="glc-vs" style={{fontSize:'0.65rem'}}>VS</div>
                  <div className="glc-side compact">
                    <div className="glc-side-label" style={{fontSize:'0.6rem'}}>B</div>
                    <div className="glc-cards compact">
                      {hasCards ? bCards.map((c,i) => <CardChip key={i} c={c} />) : <span className="card-dash">—</span>}
                    </div>
                    <div className="glc-pts">{bPts}</div>
                  </div>
                </div>
                {winnerLabel && <div className="gmc-winner">{winnerLabel}</div>}
              </div>
            );

            if (mode === 'upcoming') return (
              <div className="game-mini-card upcoming">
                <div className="gmc-header">
                  <span className="glc-badge coming">🕐 À venir</span>
                  <span className="gmc-num">#{g.game_number}</span>
                </div>
                <div className="gmc-timer-label">{g.status_label || 'Prochaine partie'}</div>
              </div>
            );
            return null;
          };

          return (
            <div className="live-section">
              <div className="live-header">
                <div className="live-dot" />
                <span className="live-title">Parties en direct — 1xBet Baccarat</span>
                <span className="live-subtitle">{games.length} partie{games.length > 1 ? 's' : ''} suivies</span>
              </div>

              {loadingGames ? (
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: 'var(--text-muted)', fontSize: '0.85rem', padding: '12px 0' }}>
                  <div className="spinner" style={{ width: 18, height: 18 }} /> Chargement...
                </div>
              ) : games.length === 0 ? (
                <div style={{ color: 'var(--text-muted)', fontSize: '0.85rem', padding: '12px 0' }}>Aucune partie disponible</div>
              ) : (
                <div className="live-games-layout">
                  {/* Big live game + absence counter side by side */}
                  <div className={`live-grid ${user?.is_admin ? 'live-grid-admin' : 'live-grid-single'}`}>
                    {liveGame ? (
                      <GameRow g={liveGame} mode="live" />
                    ) : (
                      <div className="game-live-card empty">
                        <span style={{opacity:0.5, fontSize:'0.85rem'}}>En attente de la prochaine partie...</span>
                      </div>
                    )}
                    {user?.is_admin && (
                      <div className="absence-counter-chip">
                        <div className="absence-chip-title">
                          <span style={{ color: channel.color }}>📊</span>
                          <div>
                            <span>Compteur {channel.name}</span>
                            {absences.length > 0 && absences[0].label && (
                              <span style={{ fontSize: '0.65rem', color: '#64748b', marginLeft: 6 }}>
                                ({absences[0].label})
                              </span>
                            )}
                          </div>
                        </div>
                        {absences.length === 0 ? (
                          <div style={{ color: '#94a3b8', fontSize: '0.78rem' }}>Chargement...</div>
                        ) : absences.map(a => (
                          <div key={a.suit} className="absence-row">
                            <span className="absence-suit">{a.display}</span>
                            <div className="absence-bar-wrap">
                              <div
                                className="absence-bar-fill"
                                style={{
                                  width: `${Math.min(100, (a.count / a.threshold) * 100)}%`,
                                  background: a.count >= a.threshold ? '#ef4444' : a.count >= a.threshold - 1 ? '#f59e0b' : channel.color,
                                }}
                              />
                            </div>
                            <span className="absence-count" style={{ color: a.count >= a.threshold ? '#ef4444' : '#475569' }}>
                              {a.count}/{a.threshold}
                            </span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>

                  {/* Scrollable row: finished + upcoming */}
                  {(finishedGames.length > 0 || upcomingGames.length > 0) && (
                    <div className="game-mini-scroll">
                      {finishedGames.map(g => <GameRow key={g.game_number} g={g} mode="finished" />)}
                      {upcomingGames.map(g => <GameRow key={g.game_number} g={g} mode="upcoming" />)}
                    </div>
                  )}
                </div>
              )}
            </div>
          );
        })()}

        {hasAccess && (
          <>
            {/* Stats grid — admin only */}
            {user?.is_admin && (
              <div className="pred-stats-grid">
                <div className="pred-stat-box wins">
                  <div className="pred-stat-box-label">GAGNANTS</div>
                  <div className="pred-stat-box-val">{tabStats.wins}</div>
                </div>
                <div className="pred-stat-box losses">
                  <div className="pred-stat-box-label">PERDUS</div>
                  <div className="pred-stat-box-val">{tabStats.losses}</div>
                </div>
                <div className="pred-stat-box rate">
                  <div className="pred-stat-box-label">WIN %</div>
                  <div className="pred-stat-box-val">{winRate === '—' ? '—' : `${winRate}%`}</div>
                </div>
              </div>
            )}

            {/* Current prediction zone */}
            <div className="pred-zone-label">
              <span style={{ color: channel.color }}>⚡</span> Zone de prédiction active
            </div>
            <div className={`current-pred-card ${activePred?.status || 'empty'}`} style={{ borderColor: `${channel.color}44` }}>
              {!activePred ? (
                <div className="current-pred-empty">
                  <div style={{ fontSize: '2.5rem', marginBottom: 8 }}>{channel.emoji}</div>
                  <div style={{ fontWeight: 700, fontSize: '1rem', color: channel.color }}>Aucune prédiction active</div>
                  <div style={{ fontSize: '0.8rem', marginTop: 4, opacity: 0.6 }}>Le moteur analyse les parties en cours...</div>
                </div>
              ) : (
                <>
                  <div className="current-pred-title" style={{ color: channel.color }}>
                    {channel.emoji} PRÉDICTION #{activePred.game_number}
                  </div>
                  <div className="current-pred-detail">
                    <span className="current-pred-suit-icon">🎯</span>
                    <span>Couleur :</span>
                    <span className="current-pred-suit">{activePred.suit_display} {suitLabel(activePred.suit_display || activePred.predicted_suit)}</span>
                  </div>
                  {activePred.rattrapage > 0 && (
                    <div className="current-pred-detail">
                      <span>📊</span>
                      <span>Rattrapage :</span>
                      <span>R{activePred.rattrapage}</span>
                    </div>
                  )}
                  <div className="current-pred-detail">
                    <span>⏳</span>
                    <span>Statut :</span>
                    <span className="status-en_cours">EN ATTENTE DU RÉSULTAT...</span>
                  </div>
                  <div className="current-pred-time">{formatTime(activePred.created_at)}</div>
                </>
              )}
            </div>


            {/* Historique 10 dernières prédictions vérifiées */}
            {(() => {
              const last10 = historyPreds
                .slice()
                .sort((a, b) => b.game_number - a.game_number)
                .slice(0, 10);
              return (
                <div className="pred-history-section">
                  <div className="pred-history-header">
                    <span className="pred-history-title">📋 10 dernières prédictions vérifiées</span>
                    <span className="pred-history-count">{last10.length}/10</span>
                  </div>
                  {last10.length === 0 ? (
                    <div className="pred-history-empty">
                      <div style={{ fontSize: '1.8rem', marginBottom: 6 }}>📭</div>
                      <div style={{ fontSize: '0.85rem', opacity: 0.6 }}>Aucune prédiction vérifiée pour l'instant</div>
                    </div>
                  ) : (
                    <div className="pred-history-list">
                      {last10.map(p => {
                        const ratt = parseInt(p.rattrapage) || 0;
                        const isWin = p.status === 'gagne';
                        const statusIcon = isWin ? '✅' : p.status === 'perdu' ? '❌' : '⏳';
                        const suitTxt = p.suit_display || suitLabel(p.predicted_suit) || p.predicted_suit || '—';
                        const rattColor = ratt === 0 ? '#1e40af' : ratt === 1 ? '#b45309' : '#7e22ce';
                        return (
                          <div key={p.id} className={`pred-history-row compact status-${p.status}`}>
                            <div className="pred-hist-compact-line">
                              <span className="phc-icon">{statusIcon}</span>
                              <span className="phc-num">#{p.game_number}</span>
                              <span className="phc-suit">{suitTxt}</span>
                              {isWin && (
                                <span className="phc-ratt-badge" style={{ background: rattColor, color: '#fff' }}>R{ratt}</span>
                              )}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              );
            })()}

            {/* Telegram messages */}
            {tgMessages.length > 0 && (
              <div className="tg-section">
                <div className="tg-section-header">
                  <span className="tg-section-dot">✈️</span>
                  <span className="tg-section-title">Messages du canal Telegram</span>
                  <span className="tg-section-count">{tgMessages.length}</span>
                </div>
                <div className="tg-msg-feed">
                  {tgMessages.map(m => (
                    <div key={m.id} className="tg-feed-row">
                      <div className="tg-feed-meta">
                        <span className="tg-feed-channel">📢 {m.channel}</span>
                        <span className="tg-feed-time">
                          {new Date(m.date).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}
                        </span>
                      </div>
                      <div className="tg-feed-text">
                        {m.text || (m.photo ? '📎 Média' : '—')}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
