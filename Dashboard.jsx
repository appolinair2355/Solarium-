import { useState, useEffect, useRef, useCallback } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import ContactAdminModal from '../components/ContactAdminModal';

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

const RANK_MAP = { 0:'A',1:'A',11:'J',12:'Q',13:'K','0':'A','1':'A','11':'J','12':'Q','13':'K' };
function rankDisplay(r) {
  if (r === undefined || r === null || r === '?') return '?';
  if (RANK_MAP[r] !== undefined) return RANK_MAP[r];
  const n = parseInt(r);
  if (!isNaN(n) && n >= 10) return String(n === 10 ? '10' : n);
  return String(r);
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
  const [aleatDashPanel, setAleatDashPanel]     = useState(null); // { stratId, stratName, step, hand, gameInput, result, history }

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
      emoji: s.hand === 'banquier' ? '🏦' : '🧑',
      color,
      glow,
      desc: `Stratégie ${s.id} · B=${s.threshold} · ${s.mode}`,
      hand: s.hand || 'joueur',
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
  const [lossSeqData, setLossSeqData] = useState({ streaks: {}, sequences: [] });
  const [tgMessages, setTgMessages] = useState([]);
  const [alertPred, setAlertPred] = useState(null);
  const [dailyBilan, setDailyBilan] = useState(null);
  const [bilanOpen, setBilanOpen] = useState(false);
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

  // Fetch bilan quotidien
  useEffect(() => {
    fetch('/api/bilan/latest', { credentials: 'include' })
      .then(r => r.ok ? r.json() : null)
      .then(d => d && setDailyBilan(d))
      .catch(() => {});
  }, []);

  // Stratégie courante (pour mode aleatoire)
  const currentStrat = customStrategies.find(s => `S${s.id}` === channelId) || null;
  const isAleatoire  = currentStrat?.mode === 'aleatoire';

  const submitAleatDashPrediction = async () => {
    if (!aleatDashPanel || !aleatDashPanel.gameInput) return;
    const num = parseInt(aleatDashPanel.gameInput);
    if (isNaN(num) || num < 1 || num > 1440) return;
    try {
      const r = await fetch(`/api/admin/strategies/${aleatDashPanel.stratId}/aleatoire-predict`, {
        method: 'POST', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ hand: aleatDashPanel.hand, game_number: num }),
      });
      const data = await r.json();
      if (!r.ok) { alert(data.error || 'Erreur'); return; }
      const newEntry = { game_number: data.game_number, predicted_suit: data.predicted_suit, suit_emoji: data.suit_emoji, hand: aleatDashPanel.hand, status: 'en_cours' };
      setAleatDashPanel(p => ({ ...p, step: 'result', result: data, gameInput: '', history: [...(p.history || []), newEntry] }));
    } catch (e) { alert('Erreur réseau : ' + e.message); }
  };

  // Polling statut prédictions aléatoires (Dashboard)
  useEffect(() => {
    if (!aleatDashPanel) return;
    const pending = (aleatDashPanel.history || []).filter(h => h.status === 'en_cours');
    if (pending.length === 0) return;
    const iv = setInterval(async () => {
      try {
        const r = await fetch(`/api/predictions?limit=100`, { credentials: 'include' });
        if (!r.ok) return;
        const rows = await r.json();
        setAleatDashPanel(p => {
          if (!p) return p;
          const updated = (p.history || []).map(h => {
            if (h.status !== 'en_cours') return h;
            const found = rows.find(row => row.game_number === h.game_number && row.predicted_suit === h.predicted_suit && String(row.strategy) === String(p.stratId));
            if (found && (found.status === 'gagne' || found.status === 'perdu')) return { ...h, status: found.status };
            return h;
          });
          return { ...p, history: updated };
        });
      } catch {}
    }, 4000);
    return () => clearInterval(iv);
  }, [aleatDashPanel?.history?.map(h => h.game_number + h.status).join(','), aleatDashPanel?.stratId]); // eslint-disable-line

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
    const load = () =>
      fetch('/api/games/loss-streaks', { credentials: 'include' })
        .then(r => r.ok ? r.json() : { streaks: {}, sequences: [] })
        .then(setLossSeqData);
    load();
    const t = setInterval(load, 5000);
    return () => clearInterval(t);
  }, [hasAccess]);

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
  const predCardBg = activePred?.status === 'gagne' ? '#f0fdf4' : activePred?.status === 'perdu' ? '#fff5f5' : '#ffffff';
  const PRED_SUIT_COLORS = { '♥': '#dc2626', '♦': '#ea580c', '♠': '#1e293b', '♣': '#15803d' };
  const activeSuitColor = PRED_SUIT_COLORS[activePred?.predicted_suit] || '#1d4ed8';
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
        <Link to="/" className="navbar-brand">🎲 Prediction Baccara Pro</Link>
        <div className="navbar-actions">
          {user?.is_admin && <Link to="/admin" className="btn btn-ghost btn-sm">⚙ Admin</Link>}
          {!user?.is_admin && <ContactAdminModal />}
          <button className="btn btn-ghost btn-sm" onClick={handleChangeChannel}>← Retour</button>
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
                          {/* Indicateur live si les cartes sont en cours de tirage */}
                          {absences.some(a => a.isLive) && (
                            <span style={{
                              marginLeft: 'auto',
                              fontSize: '0.6rem', fontWeight: 800,
                              letterSpacing: '0.08em',
                              color: '#4ade80',
                              background: 'rgba(74,222,128,0.12)',
                              border: '1px solid rgba(74,222,128,0.35)',
                              borderRadius: 999,
                              padding: '2px 7px',
                              animation: 'pulse 1.5s infinite',
                            }}>● LIVE</span>
                          )}
                        </div>
                        {absences.length === 0 ? (
                          <div style={{ color: '#94a3b8', fontSize: '0.78rem' }}>Chargement...</div>
                        ) : absences.map(a => {
                          const isMiroir = a.mode === 'taux_miroir';
                          const barColor = isMiroir
                            ? (a.count >= a.threshold ? '#6366f1' : a.count >= a.threshold * 0.7 ? '#f59e0b' : '#6366f1')
                            : (a.count >= a.threshold ? '#ef4444' : a.count >= a.threshold - 1 ? '#f59e0b' : a.isLive ? '#4ade80' : channel.color);
                          return (
                          <div key={a.suit} className="absence-row"
                               style={{ opacity: a.dimmed ? 0.35 : 1 }}>
                            <span className="absence-suit">{a.display}</span>
                            <div className="absence-bar-wrap">
                              <div
                                className="absence-bar-fill"
                                style={{
                                  width: `${Math.min(100, (a.count / a.threshold) * 100)}%`,
                                  background: barColor,
                                  transition: 'width 0.4s ease, background 0.3s ease',
                                }}
                              />
                            </div>
                            <span className="absence-count"
                                  style={{ color: isMiroir ? '#a5b4fc' : a.count >= a.threshold ? '#ef4444' : a.isLive ? '#4ade80' : '#475569', fontWeight: isMiroir || a.isLive ? 800 : 600 }}>
                              {a.count}
                            </span>
                          </div>
                          );
                        })}
                      </div>
                    )}
                  </div>

                  {/* ── Séquences de Relance — barres de progression pertes ── */}
                  {(() => {
                    const activeSeqs = (lossSeqData.sequences || []).filter(seq =>
                      seq.enabled && (seq.rules || []).some(r => r.strategy_id === channelId)
                    );
                    if (activeSeqs.length === 0) return null;
                    return (
                      <div className="absence-counter-chip" style={{ borderColor: 'rgba(251,146,60,0.35)', marginTop: 12 }}>
                        <div className="absence-chip-title">
                          <span style={{ color: '#fb923c' }}>🔁</span>
                          <span>Séquences de Relance</span>
                        </div>
                        {activeSeqs.map(seq => {
                          const rule = (seq.rules || []).find(r => r.strategy_id === channelId);
                          if (!rule) return null;
                          const streak = lossSeqData.streaks?.[channelId] || 0;
                          const thr = parseInt(rule.losses_threshold) || 1;
                          const pct = Math.min(100, (streak / thr) * 100);
                          const isReady = streak >= thr;
                          return (
                            <div key={seq.id} style={{ marginBottom: 8 }}>
                              <div style={{ fontSize: '0.65rem', color: '#94a3b8', marginBottom: 4, fontWeight: 600, letterSpacing: '0.04em' }}>
                                {seq.name}
                              </div>
                              <div className="absence-row">
                                <span className="absence-suit" style={{ fontSize: '1rem' }}>🔁</span>
                                <div className="absence-bar-wrap">
                                  <div
                                    className="absence-bar-fill"
                                    style={{
                                      width: `${pct}%`,
                                      background: isReady
                                        ? '#22c55e'
                                        : streak >= thr - 1
                                        ? '#f59e0b'
                                        : '#fb923c',
                                      transition: 'width 0.4s ease, background 0.3s ease',
                                    }}
                                  />
                                </div>
                                <span className="absence-count" style={{ color: isReady ? '#22c55e' : streak > 0 ? '#fb923c' : '#475569', fontWeight: 700 }}>
                                  {streak}/{thr}
                                </span>
                              </div>
                              {isReady && (
                                <div style={{ fontSize: '0.65rem', color: '#22c55e', fontWeight: 700, marginTop: 2, paddingLeft: 28 }}>
                                  ✅ Relance déclenchée !
                                </div>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    );
                  })()}

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

            {/* Current prediction zone — premium dark card */}
            <div style={{ position: 'relative', marginTop: 24, marginBottom: 4 }}>

              <div className={`current-pred-card ${activePred?.status || 'empty'}`}
                   style={{ '--ch-color': channel.color, '--ch-glow': channel.glow }}>

                {!activePred ? (
                  /* ── Aucune prédiction ── */
                  <div className="current-pred-empty">
                    {isAleatoire && user?.is_admin ? (
                      <>
                        <div style={{ fontSize: '2.4rem', marginBottom: 8 }}>🎲</div>
                        <div style={{ fontWeight: 700, fontSize: '0.95rem', color: '#a5b4fc', marginBottom: 6 }}>Stratégie Aléatoire</div>
                        <div style={{ fontSize: '0.78rem', color: '#64748b', marginBottom: 14 }}>Lancez une prédiction manuelle</div>
                        <button
                          onClick={() => setAleatDashPanel({ stratId: currentStrat.id, stratName: currentStrat.name, step: 'hand', hand: null, gameInput: '', result: null, history: [] })}
                          style={{ padding: '12px 28px', borderRadius: 12, border: '2px solid rgba(99,102,241,0.6)', background: 'rgba(99,102,241,0.18)', color: '#a5b4fc', cursor: 'pointer', fontWeight: 800, fontSize: 14, letterSpacing: 0.3 }}
                        >🎲 Prédire maintenant</button>
                      </>
                    ) : (
                      <>
                        <div style={{ fontSize: '2.8rem', marginBottom: 6, opacity: 0.4 }}>{channel.emoji}</div>
                        <div style={{ fontWeight: 700, fontSize: '0.95rem', color: '#64748b' }}>Aucune prédiction active</div>
                        <div style={{ fontSize: '0.78rem', marginTop: 4, color: '#475569' }}>Le moteur analyse les parties en cours…</div>
                      </>
                    )}
                  </div>
                ) : (
                  <>
                    {/* ── Ligne haute : heure ── */}
                    <div className="pred-top-row">
                      <span className="pred-game-num">{channel.emoji} Partie prédite</span>
                      <span className="pred-time-label">{formatTime(activePred.created_at)}</span>
                    </div>

                    {/* ── Numéro de partie en grand rouge ── */}
                    <div className="pred-game-number-big">
                      #{activePred.game_number}
                    </div>

                    {/* ── Badge main (joueur / banquier) ── */}
                    <div style={{ textAlign: 'center' }}>
                      <span className="pred-hand-badge">
                        {channel.hand === 'banquier' ? '🏦 Banquier' : '🧑 Joueur'}
                      </span>
                    </div>

                    {/* ── Orbe central avec la carte ── */}
                    <div className="pred-suit-orb"
                         style={{ '--pred-glow': channel.glow }}>
                      <span className="pred-suit-orb-inner"
                            style={{ color: activeSuitColor }}>
                        {activePred.suit_display || activePred.predicted_suit}
                      </span>
                    </div>

                    {/* ── Nom de la carte ── */}
                    <div className="pred-suit-name"
                         style={{ '--ch-color': activeSuitColor }}>
                      {suitLabel(activePred.suit_display || activePred.predicted_suit)}
                    </div>

                    {/* ── Sous-titre ── */}
                    <div className="pred-subtitle">va recevoir cette carte</div>

                    {/* ── Centre bas : statut + rattrapage ── */}
                    <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', gap: 8, marginTop: 4 }}>
                      {activePred.status === 'en_cours' && (
                        <span className="pred-status-waiting">⏳ En attente du résultat</span>
                      )}
                      {activePred.status === 'gagne' && (
                        <span className="pred-status-done gagne">✅ Prédiction gagnante</span>
                      )}
                      {activePred.status === 'perdu' && (
                        <span className="pred-status-done perdu">❌ Prédiction perdue</span>
                      )}
                      {(parseInt(activePred.rattrapage) || 0) > 0 && (
                        <span className="pred-ratt-chip">R{activePred.rattrapage}</span>
                      )}
                    </div>
                  </>
                )}
              </div>
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

            {/* ── Bilan quotidien ── */}
            {dailyBilan && dailyBilan.data && dailyBilan.data.length > 0 && (
              <div className="bilan-section">
                <button
                  className="bilan-toggle"
                  onClick={() => setBilanOpen(o => !o)}
                >
                  <span>📊 Bilan du {dailyBilan.date}</span>
                  <span style={{ marginLeft: 'auto', fontSize: 18 }}>{bilanOpen ? '▲' : '▼'}</span>
                </button>

                {bilanOpen && (
                  <div className="bilan-body">
                    {dailyBilan.data.map(entry => {
                      const lossRate = 100 - entry.winRate;
                      return (
                        <div key={entry.stratId} className="bilan-strat-card">
                          <div className="bilan-strat-header">
                            <span className="bilan-strat-name">{entry.name}</span>
                            <span className="bilan-strat-id">{entry.stratId}</span>
                          </div>

                          {/* Barre win/loss */}
                          <div className="bilan-bar-wrap">
                            {entry.total > 0 ? (
                              <>
                                <div className="bilan-bar-track">
                                  <div className="bilan-bar-win"  style={{ width: `${entry.winRate}%` }} />
                                  <div className="bilan-bar-loss" style={{ width: `${lossRate}%` }} />
                                </div>
                                <div className="bilan-bar-labels">
                                  <span className="bilan-bar-label-win">✅ {entry.totalWins} ({entry.winRate}%)</span>
                                  <span className="bilan-bar-label-loss">❌ {entry.totalLosses} ({lossRate}%)</span>
                                </div>
                              </>
                            ) : (
                              <div style={{ color: '#64748b', fontSize: 12, padding: '6px 0' }}>Aucune prédiction ce jour</div>
                            )}
                          </div>

                          {/* Détail par rattrapage */}
                          {entry.byRattrapage && entry.byRattrapage.length > 0 && (
                            <div className="bilan-ratt-grid">
                              {entry.byRattrapage.map(({ rattrapage, wins, losses }) => {
                                const tot  = wins + losses;
                                const rate = tot > 0 ? Math.round(wins / tot * 100) : 0;
                                const icon = wins > losses ? '🟢' : wins === losses ? '🟡' : '🔴';
                                return (
                                  <div key={rattrapage} className="bilan-ratt-chip">
                                    <span className="bilan-ratt-label">{icon} {rattrapage === 0 ? 'Direct' : `R${rattrapage}`}</span>
                                    <span className="bilan-ratt-val">✅{wins} ❌{losses}</span>
                                    <span className="bilan-ratt-rate">{rate}%</span>
                                  </div>
                                );
                              })}
                            </div>
                          )}
                        </div>
                      );
                    })}
                    <div className="bilan-footer">
                      Généré à {dailyBilan.generated_at
                        ? new Date(dailyBilan.generated_at).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })
                        : '—'}
                    </div>
                  </div>
                )}
              </div>
            )}

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

      {/* ══ PANEL ALÉATOIRE (Dashboard) ══ */}
      {aleatDashPanel && (
        <div
          onClick={e => { if (e.target === e.currentTarget) setAleatDashPanel(null); }}
          style={{ position: 'fixed', inset: 0, zIndex: 9999, background: 'rgba(0,0,0,0.88)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}
        >
          <div style={{ background: '#0f0d1a', border: '1px solid rgba(99,102,241,0.45)', borderRadius: 20, padding: 24, width: '100%', maxWidth: 400, maxHeight: '90vh', overflowY: 'auto', boxShadow: '0 24px 80px rgba(0,0,0,0.6)' }}>

            {/* Header */}
            <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 22 }}>
              <div>
                <div style={{ fontSize: 10, color: '#6366f1', fontWeight: 800, textTransform: 'uppercase', letterSpacing: 1.2, marginBottom: 4 }}>🎲 Stratégie Aléatoire</div>
                <div style={{ fontSize: 17, fontWeight: 800, color: '#e2e8f0' }}>{aleatDashPanel.stratName}</div>
              </div>
              <button onClick={() => setAleatDashPanel(null)} style={{ background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)', color: '#94a3b8', fontSize: 16, cursor: 'pointer', borderRadius: 8, width: 32, height: 32, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>✕</button>
            </div>

            {/* STEP 1 — Main */}
            {aleatDashPanel.step === 'hand' && (
              <div>
                <div style={{ fontSize: 13, color: '#94a3b8', marginBottom: 18, textAlign: 'center' }}>Choisissez la main à prédire :</div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
                  <button onClick={() => setAleatDashPanel(p => ({ ...p, hand: 'joueur', step: 'number' }))}
                    style={{ padding: '24px 12px', borderRadius: 14, border: '2px solid rgba(239,68,68,0.45)', background: 'rgba(239,68,68,0.09)', cursor: 'pointer', color: '#f87171', fontWeight: 800, fontSize: 22, textAlign: 'center' }}>
                    ❤️<br /><span style={{ fontSize: 13, marginTop: 6, display: 'block' }}>Joueur</span>
                  </button>
                  <button onClick={() => setAleatDashPanel(p => ({ ...p, hand: 'banquier', step: 'number' }))}
                    style={{ padding: '24px 12px', borderRadius: 14, border: '2px solid rgba(34,197,94,0.45)', background: 'rgba(34,197,94,0.09)', cursor: 'pointer', color: '#4ade80', fontWeight: 800, fontSize: 22, textAlign: 'center' }}>
                    ♣️<br /><span style={{ fontSize: 13, marginTop: 6, display: 'block' }}>Banquier</span>
                  </button>
                </div>
              </div>
            )}

            {/* STEP 2 — Numéro */}
            {aleatDashPanel.step === 'number' && (
              <div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 20 }}>
                  <button onClick={() => setAleatDashPanel(p => ({ ...p, step: 'hand', hand: null, gameInput: '' }))} style={{ background: 'none', border: 'none', color: '#6366f1', cursor: 'pointer', fontSize: 13, padding: 0 }}>← Retour</button>
                  <span style={{ fontSize: 15, color: '#e2e8f0', fontWeight: 700 }}>{aleatDashPanel.hand === 'joueur' ? '❤️ Joueur' : '♣️ Banquier'}</span>
                </div>
                <label style={{ display: 'block', color: '#94a3b8', fontSize: 12, marginBottom: 10 }}>Numéro de tour à prédire (1–1440) :</label>
                <input
                  type="number" min="1" max="1440"
                  value={aleatDashPanel.gameInput}
                  onChange={e => setAleatDashPanel(p => ({ ...p, gameInput: e.target.value }))}
                  onKeyDown={e => e.key === 'Enter' && submitAleatDashPrediction()}
                  placeholder="ex: 145"
                  autoFocus
                  style={{ width: '100%', padding: '16px', background: '#1a1730', border: '2px solid rgba(99,102,241,0.45)', borderRadius: 12, color: '#e2e8f0', fontSize: 26, fontWeight: 800, textAlign: 'center', boxSizing: 'border-box', marginBottom: 14, outline: 'none' }}
                />
                <button
                  onClick={submitAleatDashPrediction}
                  disabled={!aleatDashPanel.gameInput}
                  style={{ width: '100%', padding: '15px', borderRadius: 12, border: 'none', cursor: aleatDashPanel.gameInput ? 'pointer' : 'not-allowed', fontWeight: 800, fontSize: 14, background: aleatDashPanel.gameInput ? 'linear-gradient(135deg,#6366f1,#a855f7)' : 'rgba(99,102,241,0.15)', color: aleatDashPanel.gameInput ? '#fff' : '#6b7280' }}
                >🎯 Lancer la prédiction</button>
              </div>
            )}

            {/* STEP 3 — Résultat */}
            {aleatDashPanel.step === 'result' && aleatDashPanel.result && (
              <div style={{ textAlign: 'center' }}>
                <div style={{ fontSize: 64, marginBottom: 6 }}>{aleatDashPanel.result.suit_emoji}</div>
                <div style={{ fontSize: 22, fontWeight: 800, color: '#e2e8f0', marginBottom: 4 }}>Tour #{aleatDashPanel.result.game_number}</div>
                <div style={{ fontSize: 13, color: '#94a3b8', marginBottom: 8 }}>
                  {aleatDashPanel.hand === 'joueur' ? '❤️ Joueur' : '♣️ Banquier'} → <strong style={{ color: '#a5b4fc' }}>{aleatDashPanel.result.predicted_suit}</strong> prédit
                </div>
                <div style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '6px 16px', borderRadius: 20, background: 'rgba(234,179,8,0.12)', border: '1px solid rgba(234,179,8,0.35)', color: '#fbbf24', fontSize: 12, fontWeight: 700, marginBottom: 22 }}>
                  ⏳ En cours de vérification par le moteur…
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                  <button onClick={() => setAleatDashPanel(p => ({ ...p, step: 'hand', hand: null, gameInput: '', result: null }))}
                    style={{ padding: '13px', borderRadius: 11, border: '1px solid rgba(99,102,241,0.4)', background: 'rgba(99,102,241,0.12)', color: '#a5b4fc', cursor: 'pointer', fontWeight: 700, fontSize: 13 }}>🎲 Nouveau</button>
                  <button onClick={() => setAleatDashPanel(p => ({ ...p, step: 'number', result: null, gameInput: '' }))}
                    style={{ padding: '13px', borderRadius: 11, border: '1px solid rgba(168,85,247,0.4)', background: 'rgba(168,85,247,0.12)', color: '#c084fc', cursor: 'pointer', fontWeight: 700, fontSize: 13 }}>🔢 Autre numéro</button>
                </div>
              </div>
            )}

            {/* Historique de session */}
            {(aleatDashPanel.history || []).length > 0 && (
              <div style={{ marginTop: 24, borderTop: '1px solid rgba(255,255,255,0.07)', paddingTop: 16 }}>
                <div style={{ fontSize: 10, color: '#475569', fontWeight: 800, textTransform: 'uppercase', letterSpacing: 1, marginBottom: 10 }}>Historique de session</div>
                {[...(aleatDashPanel.history || [])].reverse().map((h, i) => (
                  <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '9px 12px', borderRadius: 10, background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.05)', marginBottom: 7 }}>
                    <span style={{ fontSize: 22 }}>{h.suit_emoji}</span>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 13, fontWeight: 700, color: '#e2e8f0' }}>Tour #{h.game_number}</div>
                      <div style={{ fontSize: 11, color: '#64748b' }}>{h.hand === 'joueur' ? '❤️ Joueur' : '♣️ Banquier'} — {h.predicted_suit}</div>
                    </div>
                    <span style={{ fontSize: 11, padding: '3px 10px', borderRadius: 12, fontWeight: 700, whiteSpace: 'nowrap',
                      background: h.status === 'gagne' ? 'rgba(34,197,94,0.18)' : h.status === 'perdu' ? 'rgba(239,68,68,0.18)' : 'rgba(234,179,8,0.12)',
                      color:      h.status === 'gagne' ? '#4ade80'           : h.status === 'perdu' ? '#f87171'           : '#fbbf24',
                      border:     `1px solid ${h.status === 'gagne' ? 'rgba(34,197,94,0.35)' : h.status === 'perdu' ? 'rgba(239,68,68,0.35)' : 'rgba(234,179,8,0.3)'}`,
                    }}>
                      {h.status === 'gagne' ? '✅ Gagné' : h.status === 'perdu' ? '❌ Perdu' : '⏳'}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
