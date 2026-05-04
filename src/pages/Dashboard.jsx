import { useState, useEffect, useRef, useCallback } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { useLanguage } from '../context/LanguageContext';
import ContactAdminModal from '../components/ContactAdminModal';
import Avatar from '../components/Avatar';
import LanguageSwitcher from '../components/LanguageSwitcher';

// Voix d'annonce vocale des prédictions (Web Speech API)
const VOICE_OPTIONS = [
  { value: 'female', label: '👩 Femme' },
  { value: 'male',   label: '👨 Homme' },
  { value: 'off',    label: '🔇 Silencieux' },
];

// Conversion d'un nombre en mots français (0 → 9999, suffisant pour les n° de partie)
function numberToFrenchWords(n) {
  n = parseInt(n, 10);
  if (!Number.isFinite(n) || n < 0) return String(n ?? '');
  const units = ['zéro','un','deux','trois','quatre','cinq','six','sept','huit','neuf','dix','onze','douze','treize','quatorze','quinze','seize'];
  const tens  = ['', '', 'vingt','trente','quarante','cinquante','soixante','soixante','quatre-vingt','quatre-vingt'];
  function below100(x) {
    if (x < 17) return units[x];
    if (x < 20) return 'dix-' + units[x - 10];
    if (x < 70) {
      const t = Math.floor(x / 10), u = x % 10;
      if (u === 0) return tens[t];
      if (u === 1 && t < 8) return tens[t] + ' et un';
      return tens[t] + '-' + units[u];
    }
    if (x < 80) {
      const u = x - 60;
      if (u === 11) return 'soixante et onze';
      return 'soixante-' + (u < 17 ? units[u] : 'dix-' + units[u - 10]);
    }
    // 80..99
    const u = x - 80;
    if (u === 0) return 'quatre-vingts';
    return 'quatre-vingt-' + (u < 17 ? units[u] : 'dix-' + units[u - 10]);
  }
  function below1000(x) {
    if (x < 100) return below100(x);
    const c = Math.floor(x / 100), r = x % 100;
    let s;
    if (c === 1) s = 'cent';
    else s = units[c] + ' cent' + (r === 0 ? 's' : '');
    if (r > 0) s += ' ' + below100(r);
    return s;
  }
  if (n < 1000) return below1000(n);
  if (n < 10000) {
    const k = Math.floor(n / 1000), r = n % 1000;
    let s = (k === 1 ? 'mille' : units[k] + ' mille');
    if (r > 0) s += ' ' + below1000(r);
    return s;
  }
  return String(n);
}

// Normalise n'importe quelle représentation de couleur vers une lecture TTS claire
function suitToFrench(s) {
  if (!s) return '';
  const str = String(s).trim();
  if (str.includes('♠')) return 'Pique';
  if (str.includes('♥') || str.includes('❤')) return 'Cœur';
  if (str.includes('♦')) return 'Carreau';
  if (str.includes('♣')) return 'Trèfle';
  if (str === 'WIN_P' || str === 'WIN_PLAYER') return 'Joueur gagne';
  if (str === 'WIN_B' || str === 'WIN_BANKER') return 'Banquier gagne';
  if (str === 'deux' || str === '2') return 'deux cartes';
  if (str === 'trois' || str === '3') return 'trois cartes';
  if (str === 'distrib') return 'distribution';
  const m = { 'P': 'Pique', 'H': 'Cœur', 'C': 'Cœur', 'D': 'Carreau', 'T': 'Trèfle' };
  return m[str.toUpperCase()[0]] || str;
}

let _voiceCache = [];
function _loadVoiceCache() {
  try {
    const v = (window.speechSynthesis && window.speechSynthesis.getVoices()) || [];
    if (v.length > 0) _voiceCache = v;
  } catch {}
}
if (typeof window !== 'undefined' && window.speechSynthesis) {
  _loadVoiceCache();
  try { window.speechSynthesis.onvoiceschanged = _loadVoiceCache; } catch {}
}

function pickFrenchVoice(gender) {
  try {
    _loadVoiceCache();
    const voices = _voiceCache.length ? _voiceCache : (window.speechSynthesis.getVoices() || []);
    const fr = voices.filter(v => /^fr(-|_|$)/i.test(v.lang));
    if (fr.length === 0) return null;
    const femaleHints = /(femme|female|amelie|amélie|audrey|virginie|marie|julie|celine|céline|google\s*français)/i;
    const maleHints   = /(homme|male|thomas|nicolas|pierre|paul|antoine|daniel)/i;
    if (gender === 'female') return fr.find(v => femaleHints.test(v.name)) || fr.find(v => !maleHints.test(v.name)) || fr[0];
    if (gender === 'male')   return fr.find(v => maleHints.test(v.name))   || fr[0];
    return fr[0];
  } catch { return null; }
}

// Une seule fois par session : « réveille » la synthèse vocale après le 1ᵉʳ geste de l'utilisateur
let voicePrimed = false;
function primeVoice() {
  if (voicePrimed) return;
  if (typeof window === 'undefined' || !window.speechSynthesis) return;
  try {
    const u = new SpeechSynthesisUtterance(' ');
    u.volume = 0; u.lang = 'fr-FR';
    window.speechSynthesis.speak(u);
    voicePrimed = true;
  } catch {}
}

function getVoiceVolume() {
  try {
    const v = parseFloat(localStorage.getItem('voiceVolume'));
    if (Number.isFinite(v) && v >= 0 && v <= 1) return v;
  } catch {}
  return 1.0;
}

// Génère le texte TTS enrichi selon le type d'événement
function buildSpeechText(pred) {
  const numWords = numberToFrenchWords(pred.game_number);
  const suit = suitToFrench(pred.suit_display || pred.predicted_suit);
  const rattrapage = pred.rattrapage || 0;
  const status = pred.status || '';

  // Contexte canal selon la couleur prédite
  const suitCtx = {
    'Pique':   'Canal Pique Noir.',
    'Trèfle':  'Double Canal.',
    'Cœur':    'Canal Cœur Rouge.',
    'Carreau': 'Canal Carreau Doré.',
  };
  const ctx = suitCtx[suit] || '';

  if (status === 'gagne') {
    return `Félicitations ! ${ctx} La prédiction ${suit} du jeu numéro ${numWords} est correcte. Continuez ainsi.`;
  }
  if (status === 'perdu') {
    return `${ctx} La prédiction du jeu numéro ${numWords} a manqué. Restez concentré pour la prochaine.`;
  }
  if (rattrapage > 0) {
    return `Attention. ${ctx} Rattrapage numéro ${rattrapage}. Jeu numéro ${numWords}. Je confirme le ${suit}. Soyez prêt.`;
  }
  // Nouvelle prédiction standard
  return `Nouvelle prédiction ! ${ctx} Jeu numéro ${numWords}. Signal actif : ${suit}. Je prédit le ${suit}. Restez attentif.`;
}

function speakPrediction(pred, gender, volumeOverride) {
  if (gender === 'off') return;
  if (typeof window === 'undefined' || !window.speechSynthesis) return;
  try {
    // Réveille la synthèse au cas où elle serait suspendue (Chrome, Safari mobile…)
    try { if (window.speechSynthesis.paused) window.speechSynthesis.resume(); } catch {}
    window.speechSynthesis.cancel();
    const text = buildSpeechText(pred);
    if (typeof console !== 'undefined') console.log('[Voix] →', text);
    const u = new SpeechSynthesisUtterance(text);
    u.lang = 'fr-FR';
    u.rate = 0.88;
    u.pitch = gender === 'male' ? 0.85 : 1.15;
    const vol = (typeof volumeOverride === 'number') ? volumeOverride : getVoiceVolume();
    u.volume = Math.max(0, Math.min(1, vol));
    const v = pickFrenchVoice(gender);
    if (v) u.voice = v;
    // Petit délai pour laisser le cancel() prendre effet sur certains navigateurs
    setTimeout(() => {
      try {
        if (window.speechSynthesis.paused) window.speechSynthesis.resume();
        window.speechSynthesis.speak(u);
      } catch {}
    }, 60);
  } catch {}
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

// ─────────────────────────────────────────────────────────────────────────────
// Helper : transforme une ligne de log brute en explication française lisible.
// Utilisé par la carte compacte ET la modale détaillée (Logs Pro S5001-S5100).
// ─────────────────────────────────────────────────────────────────────────────
function explainProLog(rawMsg, kind, proMeta) {
  const m = String(rawMsg || '');
  const hand = proMeta?.strategy_info?.hand;
  const dec  = proMeta?.strategy_info?.decalage;
  const sname = proMeta?.strategy_name || 'la stratégie';

  // Prédiction émise — on extrait le DERNIER #NNNN et la DERNIÈRE enseigne ♠♥♦♣
  if (kind === 'pred') {
    const allNums = [...m.matchAll(/#\s*(\d+)/g)].map(x => x[1]);
    const allSuits = m.match(/[♠♥♦♣]/g) || [];
    const targetGame = allNums[allNums.length - 1] || null;   // dernier # = jeu prédit
    const sourceGame = allNums.length > 1 ? allNums[0] : null; // premier # = jeu source
    const suit = allSuits[allSuits.length - 1] || '';
    const decTxt = dec !== undefined ? ` (décalage +${dec})` : '';
    if (targetGame && suit) {
      return `${sname} prédit ${suit} pour le jeu #${targetGame}${sourceGame ? ` (depuis #${sourceGame}${decTxt})` : decTxt}${hand ? ` — main ${hand}` : ''}. Envoi Telegram si bot+canal configurés.`;
    }
    return `${sname} émet une prédiction${hand ? ` côté ${hand}` : ''}${decTxt}.`;
  }

  // Main complète "BANQUIER a eu 3 cartes"
  const handMatch = m.match(/(BANQUIER|JOUEUR)\s+a eu\s+(\d+)\s+cart/i);
  if (handMatch) {
    const who = handMatch[1] === 'BANQUIER' ? 'le banquier' : 'le joueur';
    const n = handMatch[2];
    const note = n === '3' ? ' (main "tirée" — déclencheur classique de stratégie)' : ' (main de 2 cartes — pas de tirage)';
    return `Détecté : ${who} a reçu ${n} cartes${note}. La stratégie utilise cette info pour décider d'émettre ou non une prédiction.`;
  }

  // Carte détectée
  if (/Carte d[ée]tect/i.test(m)) {
    const suit = (m.match(/[♠♥♦♣]/) || [])[0];
    return `Symbole reconnu dans le tirage${suit ? ` : ${suit}` : ''}. La stratégie l'enregistre pour ses calculs internes (séquences, miroir, taux…).`;
  }

  // Exception
  if (/Exception/i.test(m)) {
    return `Une règle d'exception s'est activée : la stratégie a modifié son comportement par défaut sur ce jeu (saute la prédiction, change l'enseigne, etc.).`;
  }

  // Nouveau jeu — séparateur
  if (/—{2,}.*Jeu\s*#?\d+|^[—\s]*Jeu\s*#?\d+/i.test(m)) {
    return `Début de l'analyse d'une nouvelle partie. Tout ce qui suit jusqu'au prochain "Jeu" concerne ce numéro.`;
  }

  // Erreurs
  if (kind === 'error') {
    return `❌ Erreur dans le code de la stratégie. Aucune prédiction n'est émise tant que ce n'est pas corrigé.`;
  }
  if (kind === 'warn') {
    return `⚠️ Anomalie non bloquante. La stratégie continue mais signale quelque chose d'inhabituel.`;
  }

  // Étiquette de stratégie
  if (kind === 'tag') {
    return `Préfixe identifiant le module qui a écrit cette ligne (utile quand plusieurs stratégies tournent en parallèle).`;
  }

  return null; // pas d'explication automatique
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
      desc: s.mode === 'annonce_sequence'
        ? `Rotateur Promo · ${(s.annonce_sequence_ids || []).length} stratégies`
        : `Stratégie ${s.id} · B=${s.threshold} · ${s.mode}`,
      hand: s.hand || 'joueur',
    };
  });

  // Use the URL param directly — don't fallback to C1 before custom strategies load
  const channelId = strategy || 'C1';
  // Placeholder while custom strategies are still loading (S7, S8…)
  const channel = CHANNELS[channelId] || {
    name: channelId,
    emoji: '🔷',
    color: '#a855f7',
    glow: 'rgba(168,85,247,0.3)',
    desc: 'Chargement de la stratégie…',
  };
  const isProChannel = /^S50\d\d$/.test(channelId);

  const [visibleStratIds, setVisibleStratIds] = useState(null); // null = still loading

  // ── Zone Pro ──────────────────────────────────────────────────────────────
  const [proPredictions, setProPredictions]       = useState([]);
  const [proMeta, setProMeta]                     = useState(null);
  const [proLoaded, setProLoaded]                 = useState(false);
  const [proZoneOpen, setProZoneOpen]             = useState(true);

  const [predictions, setPredictions] = useState([]);
  const [games, setGames] = useState([]);
  const [stats, setStats] = useState([]);
  const [absences, setAbsences] = useState([]);
  const [proLogs, setProLogs] = useState([]);
  // 'compact' (carte sur dashboard) · 'expanded' (modale 960px) · 'fullscreen' (100vw)
  const [proLogsView, setProLogsView] = useState('compact');
  // Affiche/masque les explications "💡 raison" inline sous chaque ligne
  const [proLogsShowReasons, setProLogsShowReasons] = useState(true);
  const [lossSeqData, setLossSeqData] = useState({ streaks: {}, sequences: [] });
  const [rotationStatus, setRotationStatus] = useState(null);
  const [tgMessages, setTgMessages] = useState([]);
  const [dailyBilan, setDailyBilan] = useState(null);
  const [bilanOpen, setBilanOpen] = useState(false);
  const [loadingGames, setLoadingGames] = useState(true);
  const [showVoiceSettings, setShowVoiceSettings] = useState(false);
  const [voiceGender, setVoiceGender] = useState(() => {
    const s = localStorage.getItem('voiceGender');
    return s || 'female';
  });
  const [voiceVolume, setVoiceVolume] = useState(() => {
    const v = parseFloat(localStorage.getItem('voiceVolume'));
    return (Number.isFinite(v) && v >= 0 && v <= 1) ? v : 1.0;
  });

  const gamesRef    = useRef(null);
  const knownPredIds = useRef(new Set());
  const voiceGenderRef = useRef(voiceGender);
  const voiceVolumeRef = useRef(voiceVolume);
  useEffect(() => { voiceGenderRef.current = voiceGender; }, [voiceGender]);
  useEffect(() => { voiceVolumeRef.current = voiceVolume; }, [voiceVolume]);

  // Précharge la liste des voix + débloque la synthèse vocale au 1ᵉʳ geste utilisateur
  // (les navigateurs bloquent speechSynthesis avant toute interaction)
  useEffect(() => {
    if (typeof window === 'undefined' || !window.speechSynthesis) return;
    try { window.speechSynthesis.getVoices(); } catch {}
    if (window.speechSynthesis.onvoiceschanged !== undefined) {
      window.speechSynthesis.onvoiceschanged = _loadVoiceCache;
    }
    const unlock = () => {
      primeVoice();
      window.removeEventListener('click', unlock);
      window.removeEventListener('keydown', unlock);
      window.removeEventListener('touchstart', unlock);
    };
    window.addEventListener('click', unlock, { once: false });
    window.addEventListener('keydown', unlock, { once: false });
    window.addEventListener('touchstart', unlock, { once: false });
    return () => {
      window.removeEventListener('click', unlock);
      window.removeEventListener('keydown', unlock);
      window.removeEventListener('touchstart', unlock);
    };
  }, []);

  // Enrichir le canal Pro avec son vrai nom (dispo après chargement async de proMeta)
  if (isProChannel && !CHANNELS[channelId] && proMeta?.name) {
    channel.name  = proMeta.name;
    channel.desc  = `${proMeta.filename || channelId} · main ${proMeta.hand || 'joueur'} · R${proMeta.max_rattrapage || 2}`;
  }

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

  // Stratégie courante (pour mode aleatoire / annonce_sequence)
  const currentStrat = customStrategies.find(s => `S${s.id}` === channelId) || null;
  const isAleatoire  = currentStrat?.mode === 'aleatoire';

  // ── Statut du rotateur (annonce_sequence) : polling toutes les 10s ────────
  useEffect(() => {
    if (!currentStrat || currentStrat.mode !== 'annonce_sequence') {
      setRotationStatus(null);
      return;
    }
    const fetchStatus = () => {
      fetch(`/api/admin/rotation-status/${currentStrat.id}`, { credentials: 'include' })
        .then(r => r.ok ? r.json() : null)
        .then(data => { if (data) setRotationStatus(data); })
        .catch(() => {});
    };
    fetchStatus();
    const iv = setInterval(fetchStatus, 10000);
    return () => clearInterval(iv);
  }, [currentStrat?.id, currentStrat?.mode]);

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

  const announcePrediction = useCallback((pred) => {
    speakPrediction(pred, voiceGenderRef.current, voiceVolumeRef.current);
  }, []);

  useEffect(() => {
    if (!hasAccess) return;
    const es = new EventSource('/api/predictions/stream');
    es.onmessage = e => {
      const data = JSON.parse(e.data);
      setPredictions(data);
      // detect new en_cours predictions for current channel
      // data is ordered by created_at DESC, so data[0] is the most recent
      const hadKnown = knownPredIds.current.size > 0;
      const newInChannel = [];
      data.forEach(p => {
        if (!knownPredIds.current.has(p.id)) {
          knownPredIds.current.add(p.id);
          if (p.strategy === channelId && p.status === 'en_cours') {
            newInChannel.push(p);
          }
        }
      });
      // only announce the most recent (index 0, DESC order) to match what is shown on screen
      if (hadKnown && newInChannel.length > 0) announcePrediction(newInChannel[0]);
      // clean up resolved ids that are no longer en_cours
      const activeIds = new Set(data.filter(p => p.status === 'en_cours').map(p => p.id));
      knownPredIds.current = new Set([...knownPredIds.current].filter(id => activeIds.has(id) || data.some(p => p.id === id)));
    };
    es.onerror = () => {};
    return () => es.close();
  }, [hasAccess, channelId, announcePrediction]);

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
    if (!user?.is_admin && !user?.is_premium) return;
    if (isProChannel) { setAbsences([]); return; } // pas d'absences pour les slots Pro
    const load = () =>
      fetch(`/api/games/absences?channel=${channelId}`, { credentials: 'include' })
        .then(r => r.ok ? r.json() : []).then(setAbsences);
    load();
    const t = setInterval(load, 5000);
    return () => clearInterval(t);
  }, [user?.is_admin, user?.is_premium, channelId, isProChannel]);

  // ── Polling des logs Pro pour les canaux S5001…S5100 ───────────────────────
  useEffect(() => {
    if (!user?.is_admin && !user?.is_premium) return;
    if (!isProChannel) { setProLogs([]); return; }
    const load = () =>
      fetch(`/api/games/pro-logs?channel=${channelId}`, { credentials: 'include' })
        .then(r => r.ok ? r.json() : [])
        .then(arr => setProLogs(Array.isArray(arr) ? arr : []))
        .catch(() => {});
    load();
    const t = setInterval(load, 3000);
    return () => clearInterval(t);
  }, [user?.is_admin, user?.is_premium, channelId, isProChannel]);

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

  // ── SSE Pro predictions ───────────────────────────────────────────────────
  useEffect(() => {
    if (!user?.is_pro && !user?.is_admin) return;
    // Chargement initial REST + méta
    fetch('/api/predictions/pro', { credentials: 'include' })
      .then(r => r.ok ? r.json() : null)
      .then(d => { if (d) { setProPredictions(d.predictions || []); setProMeta(d.meta || null); setProLoaded(true); } })
      .catch(() => {});
    // Stream en temps réel
    const es = new EventSource('/api/predictions/pro/stream');
    es.onmessage = e => { try { setProPredictions(JSON.parse(e.data)); setProLoaded(true); } catch {} };
    es.onerror = () => {};
    return () => es.close();
  }, [user?.is_pro, user?.is_admin]);

  // ── Méta par-canal Pro : nom réel de la stratégie liée au slot S5xxx ──────
  useEffect(() => {
    if (!isProChannel) return;
    if (!user?.is_pro && !user?.is_admin) return;
    const slotId = channelId.replace(/^S/, '');
    fetch('/api/admin/pro-strategies', { credentials: 'include' })
      .then(r => r.ok ? r.json() : null)
      .then(d => {
        if (!d || !Array.isArray(d.strategies)) return;
        const me = d.strategies.find(s => String(s.id) === String(slotId));
        if (me) {
          setProMeta(prev => ({
            ...(prev || {}),
            name: me.strategy_name || me.name,
            strategy_name: me.strategy_name || me.name,
            filename: me.filename,
            hand: me.hand,
            max_rattrapage: me.max_rattrapage,
            strategy_info: { ...(prev?.strategy_info || {}), hand: me.hand, decalage: me.decalage, max_rattrapage: me.max_rattrapage },
          }));
        }
      })
      .catch(() => {});
  }, [isProChannel, channelId, user?.is_pro, user?.is_admin]);

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

  // eslint-disable-next-line no-unused-vars
  const { t, autoT } = useLanguage();

  // ── Verrouillage total si abonnement expiré (non admin) ───────────────
  // Aucun canal, aucune prédiction, aucun jeu : seul le bandeau de renouvellement.
  const lockedExpired = !!user && !user.is_admin && user.status === 'expired';
  if (lockedExpired) {
    return (
      <div className="dashboard" style={{ '--ch-color': channel.color, '--ch-glow': channel.glow }}>
        <nav className="navbar">
          <Link to="/" className="navbar-brand">🎲 Prediction Baccara Pro</Link>
          <div className="navbar-actions">
            <Avatar user={user} size={36} style={{ marginLeft: 6 }} />
            <button className="btn btn-ghost btn-sm" onClick={handleLogout}>Se déconnecter</button>
          </div>
        </nav>
        <div style={{
          maxWidth: 720, margin: '40px auto', padding: '28px 24px', borderRadius: 16,
          background: 'rgba(239,68,68,0.08)', border: '2px solid rgba(239,68,68,0.55)',
          textAlign: 'center', color: '#fca5a5',
        }}>
          <div style={{ fontSize: 56, marginBottom: 12 }}>🔒</div>
          <h2 style={{ color: '#fff', margin: '0 0 8px', fontSize: 22 }}>{autoT('Abonnement expiré')}</h2>
          <p style={{ color: '#fecaca', margin: '0 0 18px', fontSize: 14, lineHeight: 1.5 }}>
            {autoT('Toutes les prédictions, canaux et statistiques sont bloqués.')}<br/>
            {autoT("Renouvelez votre abonnement pour retrouver l'accès complet.")}
          </p>
          <div style={{ display: 'flex', gap: 10, justifyContent: 'center', flexWrap: 'wrap' }}>
            <Link to="/paiement" className="btn btn-gold">💳 {autoT('Renouveler maintenant')}</Link>
            <Link to="/" className="btn btn-ghost">{autoT("Retour à l'accueil")}</Link>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="dashboard" style={{ '--ch-color': channel.color, '--ch-glow': channel.glow }}>

      <nav className="navbar">
        <Link to="/" className="navbar-brand">🎲 Prediction Baccara Pro</Link>
        <div className="navbar-actions">
          {/* Sélecteur de voix d'annonce */}
          <div style={{ position: 'relative' }}>
            <button
              type="button"
              className="btn btn-ghost btn-sm"
              onClick={e => { e.stopPropagation(); setShowVoiceSettings(v => !v); }}
              title={autoT("Voix d'annonce des prédictions")}
            >
              {VOICE_OPTIONS.find(o => o.value === voiceGender)?.label || '🔊 Voix'} ▾
            </button>
            {showVoiceSettings && (
              <div
                onClick={e => e.stopPropagation()}
                style={{
                  position: 'absolute', top: 'calc(100% + 6px)', right: 0, zIndex: 50,
                  background: '#0f172a', border: '1px solid #1e293b', borderRadius: 10,
                  padding: 8, minWidth: 170, boxShadow: '0 10px 30px rgba(0,0,0,0.4)'
                }}
              >
                <div style={{ fontSize: 10, color: '#64748b', fontWeight: 700, marginBottom: 6, letterSpacing: '0.08em', padding: '0 6px' }}>{autoT("VOIX D'ANNONCE")}</div>
                {VOICE_OPTIONS.map(opt => (
                  <button
                    key={opt.value}
                    onClick={() => {
                      setVoiceGender(opt.value);
                      localStorage.setItem('voiceGender', opt.value);
                      // Débloque la synthèse vocale (geste utilisateur) puis lit un test
                      primeVoice();
                      if (opt.value !== 'off') {
                        speakPrediction({ game_number: '0', predicted_suit: '♥' }, opt.value, voiceVolumeRef.current);
                      }
                    }}
                    style={{
                      display: 'block', width: '100%', textAlign: 'left',
                      background: voiceGender === opt.value ? '#1e293b' : 'transparent',
                      color: '#e2e8f0', border: 'none', padding: '8px 10px',
                      borderRadius: 6, cursor: 'pointer', fontSize: 13,
                    }}
                  >
                    {opt.label}
                  </button>
                ))}
                {/* ── Curseur de volume ── */}
                <div style={{ borderTop: '1px solid #1e293b', marginTop: 8, paddingTop: 8 }}>
                  <div style={{ fontSize: 10, color: '#64748b', fontWeight: 700, marginBottom: 6, letterSpacing: '0.08em', padding: '0 6px', display: 'flex', justifyContent: 'space-between' }}>
                    <span>VOLUME</span>
                    <span style={{ color: '#fbbf24' }}>{Math.round(voiceVolume * 100)}%</span>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '0 6px' }}>
                    <span style={{ fontSize: 12 }}>🔈</span>
                    <input
                      type="range"
                      min="0"
                      max="1"
                      step="0.05"
                      value={voiceVolume}
                      onChange={(e) => {
                        const v = parseFloat(e.target.value);
                        setVoiceVolume(v);
                        try { localStorage.setItem('voiceVolume', String(v)); } catch {}
                      }}
                      onMouseUp={() => {
                        primeVoice();
                        if (voiceGender !== 'off') {
                          speakPrediction({ game_number: '0', predicted_suit: '♥' }, voiceGender, voiceVolumeRef.current);
                        }
                      }}
                      onTouchEnd={() => {
                        primeVoice();
                        if (voiceGender !== 'off') {
                          speakPrediction({ game_number: '0', predicted_suit: '♥' }, voiceGender, voiceVolumeRef.current);
                        }
                      }}
                      style={{ flex: 1, accentColor: '#fbbf24', cursor: 'pointer' }}
                      title={autoT("Volume de la voix d'annonce")}
                    />
                    <span style={{ fontSize: 14 }}>🔊</span>
                  </div>
                  <div style={{ fontSize: 10, color: '#64748b', padding: '6px 6px 0', lineHeight: 1.3 }}>
                    {autoT("Astuce : si vous n'entendez rien, vérifiez aussi le volume de votre appareil et rechargez la page après création de compte.")}
                  </div>
                </div>
              </div>
            )}
          </div>
          {(user?.is_admin || user?.is_pro || user?.is_premium) && (
            <Link to="/comptages" className="btn btn-ghost btn-sm" style={{ color: '#4ade80', borderColor: 'rgba(34,197,94,0.4)' }}>📈 Comptages</Link>
          )}
          {user?.is_admin && <Link to="/admin" className="btn btn-ghost btn-sm">⚙ Admin</Link>}
          {!user?.is_admin && user?.is_pro && <Link to="/admin" className="btn btn-ghost btn-sm" style={{ color: '#818cf8', borderColor: 'rgba(99,102,241,0.4)' }}>🔷 Config Pro</Link>}
          {!user?.is_admin && (
            <Link to="/paiement" className="btn btn-ghost btn-sm" style={{ color: '#fbbf24', borderColor: 'rgba(251,191,36,0.4)' }}>💳 Paiement</Link>
          )}
          {!user?.is_admin && <ContactAdminModal />}
          <LanguageSwitcher compact />
          <button className="btn btn-ghost btn-sm" onClick={handleChangeChannel}>← {autoT('Retour')}</button>
          <button className="btn btn-danger btn-sm" onClick={handleLogout}>{autoT('Déconnexion')}</button>
          <Avatar user={user} size={36} style={{ marginLeft: 6 }} />
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
                {user?.is_admin && <div className="db-channel-desc">{autoT(channel.desc)}</div>}
              </div>
            </div>
            {user?.is_admin && (
              <div className="db-win-badge" style={{ background: `${channel.color}22`, border: `1px solid ${channel.color}66`, color: channel.color }}>
                Win % : {winRate === '—' ? '—' : `${winRate}%`}
              </div>
            )}
          </div>
          <div className="db-header-bottom">
            <div className="db-user-row" style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <Avatar user={user} size={42} />
              <span className="db-trophy">🏆</span>
              <span className="db-username-small">{user?.username}</span>
              {user?.is_admin && <span className="db-role-badge admin">Admin</span>}
              {!user?.is_admin && user?.is_pro && <span className="db-role-badge pro">Pro</span>}
              {!user?.is_admin && user?.is_premium && !user?.is_pro && <span className="db-role-badge" style={{ background: 'rgba(251,191,36,0.18)', color: '#fbbf24', border: '1px solid rgba(251,191,36,0.4)', padding: '2px 8px', borderRadius: 6, fontSize: 11, fontWeight: 700 }}>⭐ Premium</span>}
              {!user?.is_admin && !user?.is_pro && !user?.is_premium && <span className="db-role-badge user">Joueur</span>}
            </div>
            {user?.is_admin && (
              <div className="db-timer-row">
                <span className="db-timer-label">{autoT('TEMPS RESTANT')}</span>
                <span className="db-timer-val">∞ {autoT('Illimité')}</span>
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
              <h3>{autoT('Compte en attente de validation')}</h3>
              <p>{autoT("L'administrateur doit approuver votre accès.")}</p>
            </div>
          </div>
        )}
        {user?.status === 'expired' && (
          <div className="access-banner expired">
            <div className="access-icon">🔒</div>
            <div className="access-info">
              <h3>{autoT('Abonnement expiré')}</h3>
              <p>{autoT("Contactez l'administrateur pour renouveler votre accès.")}</p>
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
            const winnerLabel = g.winner === 'Player' ? `🟢 ${autoT('Joueur gagne')}` : g.winner === 'Banker' ? `🔴 ${autoT('Banquier gagne')}` : g.winner === 'Tie' ? `🟡 ${autoT('Égalité')}` : null;

            if (mode === 'live') return (
              <div className="game-live-card">
                <div className="glc-header">
                  <span className="glc-badge live">⚡ LIVE</span>
                  <span className="glc-num">Partie #{g.game_number}</span>
                  {g.status_label && <span className="glc-timer">{g.status_label}</span>}
                </div>
                <div className="glc-sides">
                  <div className="glc-side">
                    <div className="glc-side-label">{autoT('JOUEUR')}</div>
                    <div className="glc-cards">
                      {hasCards ? pCards.map((c,i) => <CardChip key={i} c={c} />) : <span className="card-dash">—</span>}
                    </div>
                    {hasCards && <div className="glc-pts">{pPts} pt{pPts !== 1 ? 's' : ''}</div>}
                  </div>
                  <div className="glc-vs">VS</div>
                  <div className="glc-side">
                    <div className="glc-side-label">{autoT('BANQUIER')}</div>
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
                  <span className="glc-badge done">✅ {autoT('Terminé')}</span>
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
                  <span className="glc-badge coming">🕐 {autoT('À venir')}</span>
                  <span className="gmc-num">#{g.game_number}</span>
                </div>
                <div className="gmc-timer-label">{g.status_label || autoT('Prochaine partie')}</div>
              </div>
            );
            return null;
          };

          return (
            <div className="live-section">
              <div className="live-header">
                <div className="live-dot" />
                <span className="live-title">{autoT('Parties en direct — 1xBet Baccarat')}</span>
                <span className="live-subtitle">{games.length} {autoT('partie')}{games.length > 1 ? 's' : ''} {autoT('suivies')}</span>
              </div>

              {loadingGames ? (
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: 'var(--text-muted)', fontSize: '0.85rem', padding: '12px 0' }}>
                  <div className="spinner" style={{ width: 18, height: 18 }} /> {autoT('Chargement...')}
                </div>
              ) : games.length === 0 ? (
                <div style={{ color: 'var(--text-muted)', fontSize: '0.85rem', padding: '12px 0' }}>{autoT('Aucune partie disponible')}</div>
              ) : (
                <div className="live-games-layout">
                  {/* Big live game + absence counter side by side */}
                  {(() => {
                    const isOwnProChannel = isProChannel && customStrategies.some(s => `S${s.id}` === channelId && s.owner_user_id === user?.id);
                    const proCanSeeCounter = user?.is_pro && (isOwnProChannel || (Array.isArray(user?.show_counter_channels) && user.show_counter_channels.includes(channelId)));
                    const canSeeCounter = user?.is_admin || user?.is_premium || proCanSeeCounter;
                    return null;
                  })()}
                  <div className={`live-grid ${(user?.is_admin || user?.is_premium || (() => { const own = isProChannel && customStrategies.some(s => `S${s.id}` === channelId && s.owner_user_id === user?.id); return user?.is_pro && (own || (Array.isArray(user?.show_counter_channels) && user.show_counter_channels.includes(channelId))); })()) ? 'live-grid-admin' : 'live-grid-single'}`}>
                    {liveGame ? (
                      <GameRow g={liveGame} mode="live" />
                    ) : (
                      <div className="game-live-card empty">
                        <span style={{opacity:0.5, fontSize:'0.85rem'}}>{autoT('En attente de la prochaine partie...')}</span>
                      </div>
                    )}
                    {(user?.is_admin || user?.is_premium || (user?.is_pro && isProChannel && customStrategies.some(s => `S${s.id}` === channelId && s.owner_user_id === user?.id))) && isProChannel ? (
                      <div className="pro-logs-card" style={{ display:'flex', alignItems:'flex-start', padding:8 }}>
                        <button
                          type="button"
                          onClick={() => setProLogsView('expanded')}
                          title={`Ouvrir les logs Pro de la stratégie ${channel.name}`}
                          style={{
                            display:'inline-flex', alignItems:'center', gap:6,
                            padding:'6px 12px', borderRadius:8,
                            border:'1px solid rgba(168,85,247,0.4)',
                            background:'rgba(168,85,247,0.12)',
                            color:'#e9d5ff', cursor:'pointer',
                            fontSize:12, fontWeight:700,
                          }}>
                          <span>📜</span>
                          <span>Logs Pro · {channel.name}</span>
                        </button>

                        {/* ── MODALE PLEIN ÉCRAN — vue détaillée des logs ─────── */}
                        {proLogsView !== 'compact' && (
                          <div className={`pro-logs-modal pro-logs-modal-${proLogsView}`} onClick={() => setProLogsView('compact')}>
                            <div className="pro-logs-modal-inner" onClick={e => e.stopPropagation()}>
                              <div className="pro-logs-modal-head">
                                <div style={{ minWidth: 0, flex: 1 }}>
                                  <div className="pro-logs-modal-title">
                                    📡 Logs détaillés — <b>{channel.name}</b>
                                  </div>
                                  <div className="pro-logs-modal-sub">
                                    Stratégie : <code>{proMeta?.filename || channelId}</code>
                                    {proMeta?.strategy_name ? <> · <b style={{color:'#c084fc'}}>{proMeta.strategy_name}</b></> : null}
                                    {proMeta?.strategy_info?.hand ? <> · {proMeta.strategy_info.hand === 'banquier' ? '🏦 Banquier' : '🃏 Joueur'}</> : null}
                                    {proMeta?.strategy_info?.decalage !== undefined ? <> · décalage <b>+{proMeta.strategy_info.decalage}</b></> : null}
                                  </div>
                                </div>
                                <div className="pro-logs-size-toggle">
                                  <button
                                    className={`pls-btn ${proLogsView === 'expanded' ? 'is-active' : ''}`}
                                    title="Taille moyenne (960px)"
                                    onClick={() => setProLogsView('expanded')}>▭</button>
                                  <button
                                    className={`pls-btn ${proLogsView === 'fullscreen' ? 'is-active' : ''}`}
                                    title="Plein écran"
                                    onClick={() => setProLogsView('fullscreen')}>⛶</button>
                                  <button
                                    className="pls-btn pls-btn-reduce"
                                    title="Réduire (revenir à la carte du dashboard)"
                                    onClick={() => setProLogsView('compact')}>━</button>
                                  <button
                                    className={`pls-btn pls-btn-reasons ${proLogsShowReasons ? 'is-active' : ''}`}
                                    title="Afficher / masquer les raisons"
                                    onClick={() => setProLogsShowReasons(v => !v)}>💡</button>
                                </div>
                                <button className="pro-logs-modal-close" onClick={() => setProLogsView('compact')}>✕</button>
                              </div>

                              <div className="pro-logs-modal-body">
                                {proLogs.length === 0 ? (
                                  <div className="pro-logs-empty">
                                    <div className="pro-logs-empty-pulse" />
                                    <div>Aucun log capturé pour l'instant</div>
                                    <div className="pro-logs-empty-hint">Attendez qu'une partie soit analysée par la stratégie Pro</div>
                                  </div>
                                ) : proLogs.map((l, i) => {
                                  const t = new Date(l.ts);
                                  const hh = String(t.getHours()).padStart(2,'0');
                                  const mm = String(t.getMinutes()).padStart(2,'0');
                                  const ss = String(t.getSeconds()).padStart(2,'0');
                                  const ms = String(t.getMilliseconds()).padStart(3,'0');
                                  const m = String(l.msg || '');
                                  let kind = 'info';
                                  if (l.level === 'error') kind = 'error';
                                  else if (l.level === 'warn') kind = 'warn';
                                  else if (/Prédiction\s*:/i.test(m) || /^[#\s]*N?\s*\+\s*\d/.test(m)) kind = 'pred';
                                  else if (/BANQUIER|JOUEUR/.test(m) && /\d\s*cart/i.test(m)) kind = 'hand';
                                  else if (/Carte d[ée]tect/i.test(m)) kind = 'card';
                                  else if (/Exception/i.test(m)) kind = 'exception';
                                  else if (/—{2,}.*Jeu\s*#?\d+/i.test(m) || /^[—\s]*Jeu\s*#?\d+/i.test(m)) kind = 'game';
                                  else if (/^\[Pro/i.test(m) || /\[appolinaire/i.test(m)) kind = 'tag';

                                  const parts = m.split(/(♠|♥|♦|♣)/g);
                                  const rendered = parts.map((p, k) => {
                                    if (p === '♠' || p === '♣') return <span key={k} className="suit-chip suit-chip-dark">{p}</span>;
                                    if (p === '♥' || p === '♦') return <span key={k} className="suit-chip suit-chip-red">{p}</span>;
                                    return <span key={k}>{p}</span>;
                                  });

                                  const reason = explainProLog(m, kind, proMeta);
                                  return (
                                    <div key={i} className={`pro-log-row pro-log-${kind} pro-log-row-big`}>
                                      <span className="pro-log-num">#{i + 1}</span>
                                      <span className="pro-log-time">{hh}:{mm}:{ss}<small>.{ms}</small></span>
                                      <span className="pro-log-kind">{kind}</span>
                                      <div className="pro-log-msgcol">
                                        <span className="pro-log-msg">{rendered}</span>
                                        {reason && <div className="pro-log-reason pro-log-reason-big">💡 {reason}</div>}
                                      </div>
                                    </div>
                                  );
                                })}
                              </div>

                              <div className="pro-logs-modal-foot">
                                <span className="pro-logs-count">{proLogs.length} ligne{proLogs.length > 1 ? 's' : ''} affichée{proLogs.length > 1 ? 's' : ''}</span>
                                <div style={{ display:'flex', gap: 8 }}>
                                  <button
                                    className="pro-logs-btn pro-logs-btn-clear"
                                    onClick={async () => {
                                      if (!confirm('Effacer définitivement tous les logs de ce canal ?\n\nAstuce : copiez d\'abord ce qui vous intéresse — c\'est irréversible.')) return;
                                      try {
                                        await fetch(`/api/games/pro-logs?channel=${channelId}`, { method: 'DELETE', credentials: 'include' });
                                        setProLogs([]);
                                      } catch {}
                                    }}>
                                    🗑 Effacer définitivement
                                  </button>
                                  <button className="pro-logs-btn pro-logs-btn-expand" onClick={() => setProLogsView('compact')}>
                                    Fermer
                                  </button>
                                </div>
                              </div>
                            </div>
                          </div>
                        )}
                      </div>
                    ) : (user?.is_admin || user?.is_premium || (user?.is_pro && (
                        (isProChannel && customStrategies.some(s => `S${s.id}` === channelId && s.owner_user_id === user?.id)) ||
                        (Array.isArray(user?.show_counter_channels) && user.show_counter_channels.includes(channelId))
                      ))) && (
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
                        {currentStrat?.mode === 'annonce_sequence' ? (
                          <div style={{ paddingTop: 4 }}>
                            {!rotationStatus ? (
                              <div style={{ color: '#94a3b8', fontSize: '0.78rem' }}>Chargement...</div>
                            ) : (rotationStatus.childStrategies || []).map((child, idx) => {
                              const count = (rotationStatus.counts || {})[String(child.id)] || 0;
                              const isActive = idx === rotationStatus.activeIdx;
                              return (
                                <div key={child.id} className="absence-row" style={{
                                  opacity: isActive ? 1 : 0.55,
                                  background: isActive ? 'rgba(99,102,241,0.08)' : 'transparent',
                                  borderRadius: 6, padding: '2px 4px',
                                  border: isActive ? '1px solid rgba(99,102,241,0.3)' : '1px solid transparent',
                                  marginBottom: 3,
                                  transition: 'all 0.3s ease',
                                }}>
                                  <span className="absence-suit" style={{ fontSize: '0.7rem', color: isActive ? '#818cf8' : '#64748b', fontWeight: isActive ? 800 : 500 }}>
                                    {isActive ? '▶ ' : ''}{child.name}
                                  </span>
                                  <div className="absence-bar-wrap" style={{ flex: 1 }}>
                                    <div className="absence-bar-fill" style={{
                                      width: count > 0 ? '100%' : '0%',
                                      background: isActive ? '#6366f1' : '#334155',
                                      transition: 'width 0.4s ease',
                                    }} />
                                  </div>
                                  <span className="absence-count" style={{ color: isActive ? '#a5b4fc' : '#475569', fontWeight: isActive ? 800 : 600 }}>
                                    {count} pred
                                  </span>
                                </div>
                              );
                            })}
                          </div>
                        ) : absences.length === 0 ? (
                          <div style={{ color: '#94a3b8', fontSize: '0.78rem' }}>Chargement...</div>
                        ) : absences[0]?.isIntersection ? (
                          (() => {
                            const { monitor } = absences[0];
                            if (!monitor) return <div style={{ color: '#94a3b8', fontSize: '0.78rem' }}>Aucune donnée</div>;
                            const { monitored = [], accordSuits = [], hi, maxEcart } = monitor;
                            const SUIT_COLORS = { '♠': '#94a3b8', '♥': '#ef4444', '♦': '#f97316', '♣': '#4ade80' };
                            const ALL_S = ['♠','♥','♦','♣'];
                            const hasAnyAccord = accordSuits.length > 0;

                            // Regrouper toutes les prédictions actives par costume
                            const suitGroups = {};
                            for (const strat of monitored) {
                              for (const p of strat.pending) {
                                if (!suitGroups[p.suit]) suitGroups[p.suit] = [];
                                suitGroups[p.suit].push({ gameNumber: p.gameNumber, stratName: strat.name });
                              }
                            }

                            return (
                              <div style={{ paddingTop: 4 }}>
                                {/* ── Ligne d'en-tête ── */}
                                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
                                  <span style={{ fontSize: '0.58rem', color: '#64748b', letterSpacing: '0.05em', textTransform: 'uppercase' }}>
                                    {hi} strat. requises · écart ≤ {maxEcart}
                                  </span>
                                  {hasAnyAccord
                                    ? <span style={{ fontSize: '0.62rem', fontWeight: 800, color: '#4ade80', background: 'rgba(74,222,128,0.12)', border: '1px solid rgba(74,222,128,0.4)', borderRadius: 999, padding: '2px 8px', animation: 'pulse 1.5s infinite' }}>✅ ACCORD</span>
                                    : <span style={{ fontSize: '0.62rem', color: '#475569', background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 999, padding: '2px 8px' }}>En attente…</span>
                                  }
                                </div>

                                {/* ── Grille résumé par costume ── */}
                                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 5, marginBottom: 8 }}>
                                  {ALL_S.map(suit => {
                                    const preds = suitGroups[suit] || [];
                                    const inAccord = accordSuits.includes(suit);
                                    const count = preds.length;
                                    const nearAccord = !inAccord && count >= hi - 1;
                                    return (
                                      <div key={suit} style={{
                                        padding: '5px 7px', borderRadius: 7,
                                        background: inAccord ? 'rgba(74,222,128,0.12)' : nearAccord ? 'rgba(245,158,11,0.10)' : 'rgba(255,255,255,0.03)',
                                        border: inAccord ? '1px solid rgba(74,222,128,0.45)' : nearAccord ? '1px solid rgba(245,158,11,0.35)' : '1px solid rgba(255,255,255,0.07)',
                                        transition: 'all 0.3s ease',
                                      }}>
                                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                                          <span style={{ fontSize: '0.9rem', color: SUIT_COLORS[suit] }}>{suit}</span>
                                          <span style={{ fontSize: '0.72rem', fontWeight: 800, color: inAccord ? '#4ade80' : nearAccord ? '#f59e0b' : '#475569' }}>
                                            {count}/{hi}
                                          </span>
                                        </div>
                                        <div style={{ fontSize: '0.58rem', color: inAccord ? '#86efac' : '#64748b', marginTop: 2, minHeight: 10 }}>
                                          {preds.length > 0 ? preds.map(p => `#${p.gameNumber}`).join(' · ') : '—'}
                                        </div>
                                      </div>
                                    );
                                  })}
                                </div>

                                {/* ── Séparateur ── */}
                                <div style={{ borderTop: '1px solid rgba(255,255,255,0.06)', marginBottom: 6 }} />

                                {/* ── Détail par stratégie ── */}
                                {monitored.length === 0 ? (
                                  <div style={{ color: '#475569', fontSize: '0.72rem' }}>Aucune stratégie surveillée active</div>
                                ) : monitored.map(strat => {
                                  const hasAccord = strat.pending.some(p => accordSuits.includes(p.suit));
                                  return (
                                    <div key={strat.id} style={{
                                      display: 'flex', alignItems: 'center', gap: 6,
                                      padding: '3px 5px', borderRadius: 5, marginBottom: 3,
                                      background: hasAccord ? 'rgba(74,222,128,0.06)' : 'transparent',
                                      border: hasAccord ? '1px solid rgba(74,222,128,0.18)' : '1px solid transparent',
                                    }}>
                                      <span style={{ fontSize: '0.62rem', color: hasAccord ? '#4ade80' : '#94a3b8', fontWeight: hasAccord ? 700 : 500, flex: 1, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: 90 }}>
                                        {strat.name}
                                      </span>
                                      <div style={{ display: 'flex', gap: 3, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
                                        {strat.pending.length === 0 ? (
                                          <span style={{ fontSize: '0.58rem', color: '#334155' }}>—</span>
                                        ) : strat.pending.map(p => {
                                          const inAccord = accordSuits.includes(p.suit);
                                          return (
                                            <span key={p.gameNumber} style={{
                                              fontSize: '0.65rem', padding: '1px 5px', borderRadius: 4,
                                              background: inAccord ? 'rgba(74,222,128,0.15)' : 'rgba(255,255,255,0.06)',
                                              border: inAccord ? '1px solid rgba(74,222,128,0.35)' : '1px solid rgba(255,255,255,0.08)',
                                              color: inAccord ? '#4ade80' : (SUIT_COLORS[p.suit] || '#94a3b8'),
                                              fontWeight: inAccord ? 800 : 600,
                                            }}>
                                              #{p.gameNumber} {p.suit}
                                            </span>
                                          );
                                        })}
                                      </div>
                                    </div>
                                  );
                                })}
                              </div>
                            );
                          })()
                        ) : absences[0]?.isCarteValeur ? (
                          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, paddingTop: 4 }}>
                            {absences.map(a => {
                              const isMissing = a.count === 0;
                              return (
                                <div key={a.suit} style={{
                                  display: 'flex', alignItems: 'center', gap: 4,
                                  padding: '3px 8px', borderRadius: 7,
                                  background: isMissing ? 'rgba(251,191,36,0.18)' : 'rgba(255,255,255,0.04)',
                                  border: isMissing ? '1px solid rgba(251,191,36,0.55)' : '1px solid rgba(255,255,255,0.08)',
                                  transition: 'all 0.3s ease',
                                }}>
                                  <span style={{
                                    fontSize: '0.75rem', fontWeight: 800,
                                    color: isMissing ? '#fbbf24' : '#64748b',
                                    fontFamily: 'monospace',
                                  }}>{a.display}</span>
                                  <span style={{ fontSize: '0.65rem', color: '#475569' }}>:</span>
                                  <span style={{
                                    fontSize: '0.8rem', fontWeight: 800,
                                    color: isMissing ? '#f59e0b' : '#4ade80',
                                  }}>{a.count}</span>
                                  {isMissing && <span style={{ fontSize: '0.55rem', color: '#fbbf24' }}>●</span>}
                                </div>
                              );
                            })}
                          </div>
                        ) : absences.map(a => {
                          const isMiroir = a.mode === 'taux_miroir';
                          const isCarte = a.mode === 'carte_3_vers_2' || a.mode === 'carte_2_vers_3' || a.mode === 'victoire_adverse' || a.mode === 'distribution' || a.mode === 'abs_3_vers_2' || a.mode === 'abs_3_vers_3' || a.mode === 'absence_victoire';
                          const barColor = isMiroir
                            ? (a.count >= a.threshold ? '#6366f1' : a.count >= a.threshold * 0.7 ? '#f59e0b' : '#6366f1')
                            : isCarte
                            ? (a.waiting ? '#22c55e' : a.count >= a.threshold - 1 ? '#f59e0b' : channel.color)
                            : (a.count >= a.threshold ? '#ef4444' : a.count >= a.threshold - 1 ? '#f59e0b' : a.isLive ? '#4ade80' : channel.color);
                          if (isCarte && a.waiting) {
                            return (
                              <div key={a.suit} className="absence-row">
                                <span className="absence-suit">{a.display}</span>
                                <div className="absence-bar-wrap">
                                  <div className="absence-bar-fill" style={{ width: '100%', background: '#22c55e', transition: 'width 0.4s ease' }} />
                                </div>
                                <span className="absence-count" style={{ color: '#4ade80', fontWeight: 800, fontSize: '0.7rem' }}>⏳</span>
                              </div>
                            );
                          }
                          return (
                          <div key={a.suit} className="absence-row"
                               style={{ opacity: a.dimmed ? 0.35 : 1 }}>
                            <span className="absence-suit">{a.display}</span>
                            <div className="absence-bar-wrap">
                              <div
                                className="absence-bar-fill"
                                style={{
                                  width: `${Math.min(100, (a.count / (a.threshold || 1)) * 100)}%`,
                                  background: barColor,
                                  transition: 'width 0.4s ease, background 0.3s ease',
                                }}
                              />
                            </div>
                            <span className="absence-count"
                                  style={{ color: isMiroir ? '#a5b4fc' : isCarte ? (a.count >= a.threshold - 1 ? '#f59e0b' : '#475569') : a.count >= a.threshold ? '#ef4444' : a.isLive ? '#4ade80' : '#475569', fontWeight: isMiroir || a.isLive ? 800 : 600 }}>
                              {isCarte ? `${a.count}/${a.threshold}` : a.count}
                            </span>
                          </div>
                          );
                        })}
                      </div>
                    )}
                  </div>

                  {/* ── Séquences de Relance — barres de progression pertes ── */}
                  {(user?.is_admin || user?.is_premium) && (() => {
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
                        <div style={{ fontWeight: 700, fontSize: '0.95rem', color: '#a5b4fc', marginBottom: 6 }}>{autoT('Stratégie Aléatoire')}</div>
                        <div style={{ fontSize: '0.78rem', color: '#64748b', marginBottom: 14 }}>{autoT('Lancez une prédiction manuelle')}</div>
                        <button
                          onClick={() => setAleatDashPanel({ stratId: currentStrat.id, stratName: currentStrat.name, step: 'hand', hand: null, gameInput: '', result: null, history: [] })}
                          style={{ padding: '12px 28px', borderRadius: 12, border: '2px solid rgba(99,102,241,0.6)', background: 'rgba(99,102,241,0.18)', color: '#a5b4fc', cursor: 'pointer', fontWeight: 800, fontSize: 14, letterSpacing: 0.3 }}
                        >🎲 {autoT('Prédire maintenant')}</button>
                      </>
                    ) : (
                      <>
                        <div style={{ fontSize: '2.8rem', marginBottom: 6, opacity: 0.4 }}>{channel.emoji}</div>
                        <div style={{ fontWeight: 700, fontSize: '0.95rem', color: '#64748b' }}>{autoT('Aucune prédiction active')}</div>
                        <div style={{ fontSize: '0.78rem', marginTop: 4, color: '#475569' }}>{autoT('Le moteur analyse les parties en cours…')}</div>
                      </>
                    )}
                  </div>
                ) : (
                  <>
                    {/* ── Ligne haute : heure ── */}
                    <div className="pred-top-row">
                      <span className="pred-game-num">{channel.emoji} {autoT('Partie prédite')}</span>
                      <span className="pred-time-label">{formatTime(activePred.created_at)}</span>
                    </div>

                    {/* ── Numéro de partie en grand rouge ── */}
                    <div className="pred-game-number-big">
                      #{activePred.game_number}
                    </div>

                    {/* ── Badge main (joueur / banquier) ── */}
                    <div style={{ textAlign: 'center' }}>
                      <span className="pred-hand-badge">
                        {channel.hand === 'banquier' ? `🏦 ${autoT('Banquier')}` : `🧑 ${autoT('Joueur')}`}
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
                    <div className="pred-subtitle">{autoT('va recevoir cette carte')}</div>

                    {/* ── Centre bas : statut + rattrapage ── */}
                    <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', gap: 8, marginTop: 4 }}>
                      {activePred.status === 'en_cours' && (
                        <span className="pred-status-waiting">⏳ {autoT('En attente du résultat')}</span>
                      )}
                      {activePred.status === 'gagne' && (
                        <span className="pred-status-done gagne">✅ {autoT('Prédiction gagnante')}</span>
                      )}
                      {activePred.status === 'perdu' && (
                        <span className="pred-status-done perdu">❌ {autoT('Prédiction perdue')}</span>
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
                    <span className="pred-history-title">📋 {autoT('10 dernières prédictions vérifiées')}</span>
                    <span className="pred-history-count">{last10.length}/10</span>
                  </div>
                  {last10.length === 0 ? (
                    <div className="pred-history-empty">
                      <div style={{ fontSize: '1.8rem', marginBottom: 6 }}>📭</div>
                      <div style={{ fontSize: '0.85rem', opacity: 0.6 }}>{autoT("Aucune prédiction vérifiée pour l'instant")}</div>
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
                  <span>📊 {autoT('Bilan du')} {dailyBilan.date}</span>
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
                              <div style={{ color: '#64748b', fontSize: 12, padding: '6px 0' }}>{autoT('Aucune prédiction ce jour')}</div>
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
                      {autoT('Généré à')} {dailyBilan.generated_at
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
                  <span className="tg-section-title">{autoT('Messages du canal Telegram')}</span>
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
                        {m.text || (m.photo ? `📎 ${autoT('Média')}` : '—')}
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
                <div style={{ fontSize: 10, color: '#6366f1', fontWeight: 800, textTransform: 'uppercase', letterSpacing: 1.2, marginBottom: 4 }}>🎲 {autoT('Stratégie Aléatoire')}</div>
                <div style={{ fontSize: 17, fontWeight: 800, color: '#e2e8f0' }}>{aleatDashPanel.stratName}</div>
              </div>
              <button onClick={() => setAleatDashPanel(null)} style={{ background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)', color: '#94a3b8', fontSize: 16, cursor: 'pointer', borderRadius: 8, width: 32, height: 32, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>✕</button>
            </div>

            {/* STEP 1 — Main */}
            {aleatDashPanel.step === 'hand' && (
              <div>
                <div style={{ fontSize: 13, color: '#94a3b8', marginBottom: 18, textAlign: 'center' }}>{autoT('Choisissez la main à prédire :')}</div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
                  <button onClick={() => setAleatDashPanel(p => ({ ...p, hand: 'joueur', step: 'number' }))}
                    style={{ padding: '24px 12px', borderRadius: 14, border: '2px solid rgba(239,68,68,0.45)', background: 'rgba(239,68,68,0.09)', cursor: 'pointer', color: '#f87171', fontWeight: 800, fontSize: 22, textAlign: 'center' }}>
                    ❤️<br /><span style={{ fontSize: 13, marginTop: 6, display: 'block' }}>{autoT('Joueur')}</span>
                  </button>
                  <button onClick={() => setAleatDashPanel(p => ({ ...p, hand: 'banquier', step: 'number' }))}
                    style={{ padding: '24px 12px', borderRadius: 14, border: '2px solid rgba(34,197,94,0.45)', background: 'rgba(34,197,94,0.09)', cursor: 'pointer', color: '#4ade80', fontWeight: 800, fontSize: 22, textAlign: 'center' }}>
                    ♣️<br /><span style={{ fontSize: 13, marginTop: 6, display: 'block' }}>{autoT('Banquier')}</span>
                  </button>
                </div>
              </div>
            )}

            {/* STEP 2 — Numéro */}
            {aleatDashPanel.step === 'number' && (
              <div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 20 }}>
                  <button onClick={() => setAleatDashPanel(p => ({ ...p, step: 'hand', hand: null, gameInput: '' }))} style={{ background: 'none', border: 'none', color: '#6366f1', cursor: 'pointer', fontSize: 13, padding: 0 }}>← {autoT('Retour')}</button>
                  <span style={{ fontSize: 15, color: '#e2e8f0', fontWeight: 700 }}>{aleatDashPanel.hand === 'joueur' ? `❤️ ${autoT('Joueur')}` : `♣️ ${autoT('Banquier')}`}</span>
                </div>
                <label style={{ display: 'block', color: '#94a3b8', fontSize: 12, marginBottom: 10 }}>{autoT('Numéro de tour à prédire (1–1440) :')}</label>
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
                >🎯 {autoT('Lancer la prédiction')}</button>
              </div>
            )}

            {/* STEP 3 — Résultat */}
            {aleatDashPanel.step === 'result' && aleatDashPanel.result && (
              <div style={{ textAlign: 'center' }}>
                <div style={{ fontSize: 64, marginBottom: 6 }}>{aleatDashPanel.result.suit_emoji}</div>
                <div style={{ fontSize: 22, fontWeight: 800, color: '#e2e8f0', marginBottom: 4 }}>Tour #{aleatDashPanel.result.game_number}</div>
                <div style={{ fontSize: 13, color: '#94a3b8', marginBottom: 8 }}>
                  {aleatDashPanel.hand === 'joueur' ? `❤️ ${autoT('Joueur')}` : `♣️ ${autoT('Banquier')}`} → <strong style={{ color: '#a5b4fc' }}>{aleatDashPanel.result.predicted_suit}</strong> {autoT('prédit')}
                </div>
                <div style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '6px 16px', borderRadius: 20, background: 'rgba(234,179,8,0.12)', border: '1px solid rgba(234,179,8,0.35)', color: '#fbbf24', fontSize: 12, fontWeight: 700, marginBottom: 22 }}>
                  ⏳ {autoT('En cours de vérification par le moteur…')}
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                  <button onClick={() => setAleatDashPanel(p => ({ ...p, step: 'hand', hand: null, gameInput: '', result: null }))}
                    style={{ padding: '13px', borderRadius: 11, border: '1px solid rgba(99,102,241,0.4)', background: 'rgba(99,102,241,0.12)', color: '#a5b4fc', cursor: 'pointer', fontWeight: 700, fontSize: 13 }}>🎲 {autoT('Nouveau')}</button>
                  <button onClick={() => setAleatDashPanel(p => ({ ...p, step: 'number', result: null, gameInput: '' }))}
                    style={{ padding: '13px', borderRadius: 11, border: '1px solid rgba(168,85,247,0.4)', background: 'rgba(168,85,247,0.12)', color: '#c084fc', cursor: 'pointer', fontWeight: 700, fontSize: 13 }}>🔢 {autoT('Autre numéro')}</button>
                </div>
              </div>
            )}

            {/* Historique de session */}
            {(aleatDashPanel.history || []).length > 0 && (
              <div style={{ marginTop: 24, borderTop: '1px solid rgba(255,255,255,0.07)', paddingTop: 16 }}>
                <div style={{ fontSize: 10, color: '#475569', fontWeight: 800, textTransform: 'uppercase', letterSpacing: 1, marginBottom: 10 }}>{autoT('Historique de session')}</div>
                {[...(aleatDashPanel.history || [])].reverse().map((h, i) => (
                  <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '9px 12px', borderRadius: 10, background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.05)', marginBottom: 7 }}>
                    <span style={{ fontSize: 22 }}>{h.suit_emoji}</span>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 13, fontWeight: 700, color: '#e2e8f0' }}>Tour #{h.game_number}</div>
                      <div style={{ fontSize: 11, color: '#64748b' }}>{h.hand === 'joueur' ? `❤️ ${autoT('Joueur')}` : `♣️ ${autoT('Banquier')}`} — {h.predicted_suit}</div>
                    </div>
                    <span style={{ fontSize: 11, padding: '3px 10px', borderRadius: 12, fontWeight: 700, whiteSpace: 'nowrap',
                      background: h.status === 'gagne' ? 'rgba(34,197,94,0.18)' : h.status === 'perdu' ? 'rgba(239,68,68,0.18)' : 'rgba(234,179,8,0.12)',
                      color:      h.status === 'gagne' ? '#4ade80'           : h.status === 'perdu' ? '#f87171'           : '#fbbf24',
                      border:     `1px solid ${h.status === 'gagne' ? 'rgba(34,197,94,0.35)' : h.status === 'perdu' ? 'rgba(239,68,68,0.35)' : 'rgba(234,179,8,0.3)'}`,
                    }}>
                      {h.status === 'gagne' ? `✅ ${autoT('Gagné')}` : h.status === 'perdu' ? `❌ ${autoT('Perdu')}` : '⏳'}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* ─────────────────────────────────────────────────────────────────────
           ZONE PRO — visible uniquement pour les utilisateurs Pro et admins
          ──────────────────────────────────────────────────────────────────── */}
      {(user?.is_pro || user?.is_admin) && !isProChannel && (
        <div style={{ margin: '28px 0 0', padding: '0 0 48px' }}>

          {/* Header section Pro */}
          <div
            onClick={() => setProZoneOpen(v => !v)}
            style={{ display: 'flex', alignItems: 'center', gap: 12, cursor: 'pointer', marginBottom: proZoneOpen ? 18 : 0, userSelect: 'none' }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <div style={{ width: 10, height: 10, borderRadius: '50%', background: proPredictions.some(p => p.status === 'en_cours') ? '#22c55e' : '#475569', boxShadow: proPredictions.some(p => p.status === 'en_cours') ? '0 0 8px #22c55e' : 'none', transition: 'all 0.3s' }} />
              <span style={{ fontSize: 15, fontWeight: 800, color: '#e2e8f0', letterSpacing: '0.03em' }}>
                ZONE PRO
              </span>
              <span style={{ fontSize: 10, fontWeight: 700, background: 'linear-gradient(135deg,#6366f1,#a855f7)', color: '#fff', padding: '2px 8px', borderRadius: 8, letterSpacing: '0.08em' }}>PRO</span>
            </div>
            {proMeta && (
              <span style={{ fontSize: 11, color: '#64748b', flex: 1 }}>
                {proMeta.strategy_count} {autoT('stratégie')}{proMeta.strategy_count > 1 ? 's' : ''} · {proMeta.filename}
              </span>
            )}
            <span style={{ fontSize: 18, color: '#475569', marginLeft: 'auto' }}>{proZoneOpen ? '▲' : '▼'}</span>
          </div>

          {proZoneOpen && (
            <>
              {!proLoaded ? (
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: '#64748b', fontSize: 13, padding: '16px 0' }}>
                  <div className="spinner" style={{ width: 16, height: 16 }} /> {autoT('Chargement des prédictions Pro…')}
                </div>
              ) : proPredictions.length === 0 ? (
                <div style={{ padding: '20px 0', textAlign: 'center', color: '#475569', fontSize: 13 }}>
                  <div style={{ fontSize: 32, marginBottom: 8 }}>🔷</div>
                  <div style={{ fontWeight: 700, color: '#94a3b8', marginBottom: 4 }}>{autoT('Aucune prédiction Pro active')}</div>
                  <div style={{ fontSize: 12, color: '#475569' }}>
                    {user?.is_admin
                      ? autoT('Importez un fichier de stratégie Pro dans Admin → Config Pro')
                      : autoT("Les prédictions Pro apparaîtront ici dès qu'une stratégie est active")}
                  </div>
                </div>
              ) : (() => {
                // Grouper les prédictions par stratégie
                const byStrategy = {};
                proPredictions.forEach(p => {
                  if (!byStrategy[p.strategy]) byStrategy[p.strategy] = [];
                  byStrategy[p.strategy].push(p);
                });
                const SUIT_COLORS_PRO = { '♥': '#f87171', '♦': '#fb923c', '♠': '#94a3b8', '♣': '#4ade80' };

                return Object.entries(byStrategy).map(([stratId, preds]) => {
                  const active = preds.find(p => p.status === 'en_cours');
                  const history = preds.filter(p => p.status !== 'en_cours').slice(0, 15);
                  const wins = preds.filter(p => p.status === 'gagne').length;
                  const losses = preds.filter(p => p.status === 'perdu').length;
                  const wr = wins + losses > 0 ? ((wins / (wins + losses)) * 100).toFixed(0) : null;

                  return (
                    <div key={stratId} style={{ background: 'linear-gradient(135deg, rgba(99,102,241,0.06) 0%, rgba(168,85,247,0.04) 100%)', border: '1px solid rgba(99,102,241,0.2)', borderRadius: 16, padding: '18px 20px', marginBottom: 16 }}>

                      {/* Header stratégie */}
                      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 14 }}>
                        <div style={{ fontWeight: 800, fontSize: 13, color: '#a5b4fc', letterSpacing: '0.04em' }}>{stratId}</div>
                        {active && (
                          <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '4px 12px', borderRadius: 20, background: 'rgba(34,197,94,0.12)', border: '1px solid rgba(34,197,94,0.35)' }}>
                            <div style={{ width: 6, height: 6, borderRadius: '50%', background: '#22c55e', boxShadow: '0 0 6px #22c55e', animation: 'pulse 1.5s infinite' }} />
                            <span style={{ fontSize: 11, fontWeight: 700, color: '#22c55e' }}>EN COURS</span>
                          </div>
                        )}
                        {wr !== null && (
                          <span style={{ marginLeft: 'auto', fontSize: 11, fontWeight: 700, color: parseInt(wr) >= 50 ? '#4ade80' : '#f87171' }}>
                            {wr}% Win · {wins}W/{losses}L
                          </span>
                        )}
                      </div>

                      {/* Prédiction active */}
                      {active && (
                        <div style={{ background: 'rgba(99,102,241,0.08)', border: '1px solid rgba(99,102,241,0.3)', borderRadius: 12, padding: '14px 18px', marginBottom: 14 }}>
                          <div style={{ fontSize: 11, color: '#64748b', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 8 }}>{autoT('Prédiction Actuelle')}</div>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
                            <div style={{ fontSize: 36, lineHeight: 1, color: SUIT_COLORS_PRO[active.predicted_suit] || '#a5b4fc' }}>{active.predicted_suit || '?'}</div>
                            <div>
                              <div style={{ fontSize: 16, fontWeight: 800, color: '#e2e8f0' }}>
                                {active.predicted_suit === '♥' ? autoT('Coeur') : active.predicted_suit === '♦' ? autoT('Carreau') : active.predicted_suit === '♠' ? autoT('Pique') : active.predicted_suit === '♣' ? autoT('Trèfle') : active.predicted_suit || '?'}
                              </div>
                              <div style={{ fontSize: 11, color: '#64748b' }}>{autoT('Partie')} #{active.game_number} · {active.hand === 'joueur' ? `❤️ ${autoT('Joueur')}` : `♣️ ${autoT('Banquier')}`}</div>
                            </div>
                            <div style={{ marginLeft: 'auto', padding: '6px 14px', borderRadius: 10, background: 'rgba(234,179,8,0.12)', border: '1px solid rgba(234,179,8,0.3)', color: '#fbbf24', fontSize: 12, fontWeight: 700 }}>⏳ {autoT('En cours')}</div>
                          </div>
                        </div>
                      )}

                      {/* Historique Pro */}
                      {history.length > 0 && (
                        <div>
                          <div style={{ fontSize: 10, color: '#475569', fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 8 }}>{autoT('Historique')}</div>
                          <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
                            {history.map((p, i) => (
                              <div key={p.id || i} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '7px 12px', borderRadius: 8, background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.04)' }}>
                                <span style={{ fontSize: 16, color: SUIT_COLORS_PRO[p.predicted_suit] || '#a5b4fc', minWidth: 20, textAlign: 'center' }}>{p.predicted_suit || '?'}</span>
                                <div style={{ flex: 1, minWidth: 0 }}>
                                  <span style={{ fontSize: 12, fontWeight: 700, color: '#cbd5e1' }}>Partie #{p.game_number}</span>
                                  {p.hand && <span style={{ fontSize: 10, color: '#475569', marginLeft: 8 }}>{p.hand === 'joueur' ? '❤️ J' : '♣️ B'}</span>}
                                </div>
                                <span style={{
                                  fontSize: 11, padding: '3px 10px', borderRadius: 10, fontWeight: 700, whiteSpace: 'nowrap',
                                  background: p.status === 'gagne' ? 'rgba(34,197,94,0.15)' : p.status === 'perdu' ? 'rgba(239,68,68,0.15)' : 'rgba(234,179,8,0.1)',
                                  color:      p.status === 'gagne' ? '#4ade80'             : p.status === 'perdu' ? '#f87171'             : '#fbbf24',
                                  border:     `1px solid ${p.status === 'gagne' ? 'rgba(34,197,94,0.3)' : p.status === 'perdu' ? 'rgba(239,68,68,0.3)' : 'rgba(234,179,8,0.25)'}`,
                                }}>
                                  {p.status === 'gagne' ? `✅ ${autoT('Gagné')}` : p.status === 'perdu' ? `❌ ${autoT('Perdu')}` : '⏳'}
                                </span>
                              </div>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>
                  );
                });
              })()}
            </>
          )}
        </div>
      )}
    </div>
  );
}
