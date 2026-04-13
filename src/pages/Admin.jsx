import { useState, useEffect, useCallback } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';

function statusLabel(s) {
  if (s === 'pending') return <span className="badge badge-pending">En attente</span>;
  if (s === 'active') return <span className="badge badge-active">Actif</span>;
  if (s === 'expired') return <span className="badge badge-expired">Expiré</span>;
  return <span className="badge">{s}</span>;
}

function fmtDate(iso) {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit' });
}

function fmtDuration(mins) {
  if (!mins || isNaN(mins)) return '—';
  const m = Math.round(mins);
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60);
  const rem = m % 60;
  return rem > 0 ? `${h}h ${rem}min` : `${h}h`;
}

function fmtRemaining(expiresAt) {
  if (!expiresAt) return '—';
  const diff = new Date(expiresAt) - new Date();
  if (diff <= 0) return <span style={{ color: '#ef4444', fontWeight: 700 }}>Expiré</span>;
  const totalMins = Math.floor(diff / 60000);
  if (totalMins < 60) return <span style={{ color: '#f59e0b', fontWeight: 700 }}>{totalMins} min</span>;
  const h = Math.floor(totalMins / 60);
  const m = totalMins % 60;
  const txt = m > 0 ? `${h}h ${m}min` : `${h}h`;
  const color = h >= 24 ? '#22c55e' : h >= 2 ? '#f59e0b' : '#ef4444';
  return <span style={{ color, fontWeight: 700 }}>{txt}</span>;
}

function minutesFromInput(val, unit) {
  const n = parseFloat(val);
  if (isNaN(n) || n <= 0) return null;
  return unit === 'h' ? n * 60 : n;
}

export default function Admin() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();

  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState('');

  const [adminTab, setAdminTab] = useState('utilisateurs');

  // Duration inputs per user: { userId: { val, unit } }
  const [durInputs, setDurInputs] = useState({});

  // Inline name editing
  const [nameEdit, setNameEdit] = useState({}); // { userId: { first_name, last_name } }

  // Visibility modal (canaux Telegram + stratégies)
  const [visModal, setVisModal] = useState(null); // { userId, username }
  const [visData, setVisData] = useState({}); // { userId: Set<dbId> } for channels
  const [visStratData, setVisStratData] = useState({}); // { userId: Set<stratId> } for strategies
  const [visLoading, setVisLoading] = useState(false);

  const ALL_STRATEGIES = [
    { id: 'C1', name: 'Pique Noir', emoji: '♠' },
    { id: 'C2', name: 'Cœur Rouge', emoji: '♥' },
    { id: 'C3', name: 'Carreau Doré', emoji: '♦' },
    { id: 'DC', name: 'Double Canal', emoji: '♣' },
  ];

  // Bot token
  const [tokenInfo, setTokenInfo] = useState(null); // { token_set, token_preview }
  const [tokenInput, setTokenInput] = useState('');
  const [tokenLoading, setTokenLoading] = useState(false);
  const [showToken, setShowToken] = useState(false);

  // Format des messages Telegram
  const [msgFormat, setMsgFormat] = useState(1);
  const [msgFormatSaving, setMsgFormatSaving] = useState(false);
  const [msgFormatMsg, setMsgFormatMsg] = useState('');

  // Max rattrapage
  const [maxRattrapage, setMaxRattrapage] = useState(20);
  const [maxRSaving, setMaxRSaving] = useState(false);

  // Telegram channels
  const [tgChannels, setTgChannels] = useState([]);
  const [tgInput, setTgInput] = useState('');
  const [tgLoading, setTgLoading] = useState(false);
  const [tgMsg, setTgMsg] = useState('');
  const [tgBotUsername, setTgBotUsername] = useState('');

  // Comptes premium
  const [premiumModal, setPremiumModal] = useState(false);
  const [premiumAccounts, setPremiumAccounts] = useState([]);
  const [premiumLoading, setPremiumLoading] = useState(false);
  const [premiumCount, setPremiumCount] = useState(5);
  const [premiumDomain, setPremiumDomain] = useState('premium.pro');
  const [premiumDurH, setPremiumDurH] = useState(750);

  const generatePremium = async () => {
    if (!confirm(`Générer ${premiumCount} compte(s) premium ? Les comptes existants (premium1…) seront remplacés.`)) return;
    setPremiumLoading(true);
    try {
      const r = await fetch('/api/admin/generate-premium', {
        method: 'POST', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ count: premiumCount, domain: premiumDomain, durationH: premiumDurH }),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || 'Erreur');
      setPremiumAccounts(d.accounts);
      setPremiumModal(true);
      loadUsers();
    } catch (e) { showMsg('❌ ' + e.message, true); }
    finally { setPremiumLoading(false); }
  };

  // ── Stratégies personnalisées ────────────────────────────
  const SUITS = ['♠', '♥', '♦', '♣'];
  const SUIT_LABELS = { '♠': '♠ Pique', '♥': '♥ Cœur', '♦': '♦ Carreau', '♣': '♣ Trèfle' };
  const PRESETS = {
    manquants: [
      { label: 'Contraire total',  desc: '♠→♥ · ♥→♠ · ♦→♣ · ♣→♦', map: { '♠':['♥'],'♥':['♠'],'♦':['♣'],'♣':['♦'] } },
      { label: 'Même couleur',     desc: '♠→♣ · ♣→♠ · ♥→♦ · ♦→♥', map: { '♠':['♣'],'♣':['♠'],'♥':['♦'],'♦':['♥'] } },
      { label: 'Même forme',       desc: '♠→♦ · ♦→♠ · ♥→♣ · ♣→♥', map: { '♠':['♦'],'♦':['♠'],'♥':['♣'],'♣':['♥'] } },
      { label: 'Identique',        desc: '♠→♠ · ♥→♥ · ♦→♦ · ♣→♣', map: { '♠':['♠'],'♥':['♥'],'♦':['♦'],'♣':['♣'] } },
    ],
    apparents: [
      { label: 'Miroir contraire', desc: '♠→♥ · ♥→♠ · ♦→♣ · ♣→♦', map: { '♠':['♥'],'♥':['♠'],'♦':['♣'],'♣':['♦'] } },
      { label: 'Miroir couleur',   desc: '♠→♣ · ♣→♠ · ♥→♦ · ♦→♥', map: { '♠':['♣'],'♣':['♠'],'♥':['♦'],'♦':['♥'] } },
      { label: 'Miroir forme',     desc: '♠→♦ · ♦→♠ · ♥→♣ · ♣→♥', map: { '♠':['♦'],'♦':['♠'],'♥':['♣'],'♣':['♥'] } },
      { label: 'Rotation ↻',       desc: '♠→♥→♦→♣→♠',              map: { '♠':['♥'],'♥':['♦'],'♦':['♣'],'♣':['♠'] } },
    ],
    apparition_absence: [
      { label: 'Identique',        desc: 'Prédit le même costume disparu', map: { '♠':['♠'],'♥':['♥'],'♦':['♦'],'♣':['♣'] } },
      { label: 'Contraire total',  desc: '♠→♥ · ♥→♠ · ♦→♣ · ♣→♦',       map: { '♠':['♥'],'♥':['♠'],'♦':['♣'],'♣':['♦'] } },
      { label: 'Même couleur',     desc: '♠→♣ · ♣→♠ · ♥→♦ · ♦→♥',       map: { '♠':['♣'],'♣':['♠'],'♥':['♦'],'♦':['♥'] } },
      { label: 'Même forme',       desc: '♠→♦ · ♦→♠ · ♥→♣ · ♣→♥',       map: { '♠':['♦'],'♦':['♠'],'♥':['♣'],'♣':['♥'] } },
    ],
    taux_miroir: [
      { label: 'Prédire le retardataire', desc: 'Prédit le costume qui est en retard (identique)', map: { '♠':['♠'],'♥':['♥'],'♦':['♦'],'♣':['♣'] } },
      { label: 'Contraire du retardataire', desc: '♠→♥ · ♥→♠ · ♦→♣ · ♣→♦', map: { '♠':['♥'],'♥':['♠'],'♦':['♣'],'♣':['♦'] } },
      { label: 'Même couleur',              desc: '♠→♣ · ♣→♠ · ♥→♦ · ♦→♥', map: { '♠':['♣'],'♣':['♠'],'♥':['♦'],'♦':['♥'] } },
    ],
  };
  // Formats de message Telegram (partagé dans tout l'admin)
  const TG_FORMATS = [
    { value: '',  label: 'Global (paramètre général)' },
    { value: '8', label: 'Format 8 — 🎮 Banquier / 🤖 Joueur Pro (recommandé)' },
    { value: '1', label: 'Format 1 — Classique cyrillique' },
    { value: '2', label: 'Format 2 — Baccara Premium' },
    { value: '3', label: 'Format 3 — Baccara Pro' },
    { value: '4', label: 'Format 4 — Prédiction Standard' },
    { value: '5', label: 'Format 5 — Barre de progression' },
    { value: '6', label: 'Format 6 — Markdown Titre' },
    { value: '7', label: 'Format 7 — HTML joueur' },
  ];

  // stratType: 'simple' = prédiction locale seulement; 'telegram' = envoie vers canal TG custom
  const BLANK_FORM = { name: '', threshold: 5, mode: 'manquants', mappings: { '♠':['♥'],'♥':['♠'],'♦':['♣'],'♣':['♦'] }, visibility: 'admin', enabled: true, tg_targets: [], stratType: 'simple', exceptions: [], prediction_offset: 1, hand: 'joueur', max_rattrapage: 20, tg_format: null, mirror_pairs: [], trigger_on: null, trigger_strategy_id: '', trigger_count: 2, trigger_level: 3, relance_enabled: false, relance_pertes: 3, relance_types: [], relance_nombre: 1 };

  // 6 paires possibles pour le mode taux_miroir
  const MIRROR_PAIRS = [
    { a: '♠', b: '♥', label: '♠ vs ♥', desc: 'Pique / Cœur' },
    { a: '♠', b: '♦', label: '♠ vs ♦', desc: 'Pique / Carreau' },
    { a: '♠', b: '♣', label: '♠ vs ♣', desc: 'Pique / Trèfle' },
    { a: '♥', b: '♦', label: '♥ vs ♦', desc: 'Cœur / Carreau' },
    { a: '♥', b: '♣', label: '♥ vs ♣', desc: 'Cœur / Trèfle' },
    { a: '♦', b: '♣', label: '♦ vs ♣', desc: 'Carreau / Trèfle' },
  ];

  const [strategies, setStrategies] = useState([]);
  const [stratForm, setStratForm] = useState(BLANK_FORM); // current create/edit form
  const [stratEditing, setStratEditing] = useState(null); // id being edited, null = creating
  const [stratMsg, setStratMsg] = useState('');
  const [stratSaving, setStratSaving] = useState(false);
  const [stratOpen, setStratOpen] = useState(false); // form panel open?

  // Routage C1/C2/C3/DC → canaux Telegram
  const DEFAULT_STRATS = ['C1', 'C2', 'C3', 'DC'];
  const DEFAULT_STRAT_LABELS = { C1: '♠ Pique Noir', C2: '♥ Cœur Rouge', C3: '♦ Carreau Doré', DC: '♣ Double Canal' };
  const [routeData, setRouteData] = useState({}); // { 'C1': Set<dbId>, ... }
  const [routeSaving, setRouteSaving] = useState(false);
  const [routeMsg, setRouteMsg] = useState('');

  // Base de données externe Render
  const [renderDbUrl, setRenderDbUrl]         = useState('');
  const [renderDbStatus, setRenderDbStatus]   = useState(null); // { connected, has_url, stats }
  const [renderDbSaving, setRenderDbSaving]   = useState(false);
  const [renderDbMsg, setRenderDbMsg]         = useState('');

  // Messages reçus des utilisateurs
  const [userMessages, setUserMessages]         = useState([]);

  // Message broadcast accueil
  const [broadcastText, setBroadcastText]       = useState('');
  const [broadcastEnabled, setBroadcastEnabled] = useState(true);
  const [broadcastTargets, setBroadcastTargets] = useState(['pending', 'active', 'expired']);
  const [broadcastSaving, setBroadcastSaving]   = useState(false);
  const [broadcastMsg, setBroadcastMsg]         = useState('');
  const [broadcastCurrent, setBroadcastCurrent] = useState(null); // message actuellement actif

  // Fichier de mise à jour
  const [updateFile, setUpdateFile]           = useState(null);
  const [updateFileName, setUpdateFileName]   = useState('');
  const [updatePreview, setUpdatePreview]     = useState(null);
  const [updateApplying, setUpdateApplying]   = useState(false);
  const [updateResult, setUpdateResult]       = useState(null);
  const [uiStyles, setUiStyles]               = useState({});
  const [buildStatus, setBuildStatus]         = useState(null);   // { status, log, error, finishedAt }
  const [modifiedFiles, setModifiedFiles]     = useState([]);
  const [buildPollRef, setBuildPollRef]       = useState(null);

  // Config Telegram propre par stratégie par défaut (bot_token + channel_id)
  const [defaultStratTg, setDefaultStratTg] = useState({ C1: { bot_token: '', channel_id: '', tg_format: null }, C2: { bot_token: '', channel_id: '', tg_format: null }, C3: { bot_token: '', channel_id: '', tg_format: null }, DC: { bot_token: '', channel_id: '', tg_format: null } });
  const [defaultTgSaving, setDefaultTgSaving] = useState(false);
  const [defaultTgMsg, setDefaultTgMsg] = useState('');
  const [defaultChOpen, setDefaultChOpen] = useState(null); // canal ouvert pour édition inline : 'C1'|'C2'|'C3'|'DC'|null
  const [stratChOpen, setStratChOpen]     = useState(null); // id de stratégie perso ouverte pour édition TG inline
  const [stratChForm, setStratChForm]     = useState({ bot_token: '', channel_id: '', tg_format: null });
  const [stratChSaving, setStratChSaving] = useState(false);

  // ── Séquences de relance ─────────────────────────────────────────
  const [lossSequences,  setLossSequences]  = useState([]);
  const [lossSeqName,    setLossSeqName]    = useState('');
  const [lossSeqRules,   setLossSeqRules]   = useState({}); // { [stratId]: losses_threshold|null }
  const [lossSeqSaving,  setLossSeqSaving]  = useState(false);
  const [lossSeqMsg,     setLossSeqMsg]     = useState('');
  const [stratStats,     setStratStats]     = useState([]); // wins/losses per strategy

  // ── Annonces planifiées Telegram ─────────────────────────────────
  const ANN_BLANK = { name: '', bot_token: '', channel_id: '', text: '', media_type: '', media_url: '', schedule_type: 'interval', interval_hours: 1, times_input: '' };
  const [announcements,    setAnnouncements]    = useState([]);
  const [annForm,          setAnnForm]          = useState(ANN_BLANK);
  const [annSaving,        setAnnSaving]        = useState(false);
  const [annMsg,           setAnnMsg]           = useState('');
  const [annOpen,          setAnnOpen]          = useState(false);
  const [annSendingId,     setAnnSendingId]     = useState(null);

  const saveStratTg = async (id) => {
    setStratChSaving(true);
    try {
      const strat = strategies.find(s => s.id === id);
      if (!strat) throw new Error('Stratégie introuvable');
      const existing = Array.isArray(strat.tg_targets) ? strat.tg_targets.filter(t => t.channel_id !== stratChForm.channel_id) : [];
      const newTarget = stratChForm.bot_token.trim() && stratChForm.channel_id.trim()
        ? { bot_token: stratChForm.bot_token.trim(), channel_id: stratChForm.channel_id.trim() }
        : null;
      const tg_targets = newTarget ? [newTarget, ...existing] : existing;
      const tg_format = stratChForm.tg_format ? parseInt(stratChForm.tg_format) : null;
      const r = await fetch(`/api/admin/strategies/${id}`, {
        method: 'PUT', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...strat, tg_targets, tg_format }),
      });
      if (!r.ok) { const d = await r.json(); throw new Error(d.error || 'Erreur'); }
      setStratChOpen(null);
      loadStrategies();
    } catch (e) { alert('❌ ' + e.message); }
    finally { setStratChSaving(false); }
  };

  const showStratMsg = (text, error = false) => {
    setStratMsg({ text, error });
    setTimeout(() => setStratMsg(''), 4000);
  };

  const showMsg = (msg, isError) => {
    setMessage({ text: msg, error: isError });
    setTimeout(() => setMessage(''), 3500);
  };

  const showTgMsg = (msg, isError) => {
    setTgMsg({ text: msg, error: isError });
    setTimeout(() => setTgMsg(''), 4000);
  };

  const loadUsers = useCallback(async () => {
    const res = await fetch('/api/admin/users', { credentials: 'include' });
    if (res.ok) setUsers(await res.json());
    setLoading(false);
  }, []);

  const loadChannels = useCallback(async () => {
    const res = await fetch('/api/telegram/channels', { credentials: 'include' });
    if (res.ok) setTgChannels(await res.json());
    const st = await fetch('/api/telegram/status', { credentials: 'include' });
    if (st.ok) { const d = await st.json(); setTgBotUsername(d.bot_username || ''); }
  }, []);

  const loadTokenInfo = useCallback(async () => {
    try {
      const r = await fetch('/api/telegram/bot-token', { credentials: 'include' });
      if (r.ok) setTokenInfo(await r.json());
    } catch {}
  }, []);

  const loadStrategies = useCallback(async () => {
    try {
      const r = await fetch('/api/admin/strategies', { credentials: 'include' });
      if (r.ok) setStrategies(await r.json());
    } catch {}
  }, []);

  const loadStratStats = useCallback(async () => {
    try {
      const r = await fetch('/api/predictions/stats', { credentials: 'include' });
      if (r.ok) setStratStats(await r.json());
    } catch {}
  }, []);

  const loadStrategyRoutes = useCallback(async () => {
    try {
      const r = await fetch('/api/admin/strategy-routes', { credentials: 'include' });
      if (!r.ok) return;
      const data = await r.json(); // { C1: [{id,tg_id,channel_name}], ... }
      const sets = {};
      for (const [strat, chs] of Object.entries(data)) {
        sets[strat] = new Set(chs.map(c => c.id));
      }
      setRouteData(sets);
    } catch {}
  }, []);

  const loadRenderDbStatus = useCallback(async () => {
    try {
      const r = await fetch('/api/admin/render-db', { credentials: 'include' });
      if (r.ok) setRenderDbStatus(await r.json());
    } catch {}
  }, []);

  const loadUiStyles = useCallback(async () => {
    try {
      const r = await fetch('/api/admin/ui-styles', { credentials: 'include' });
      if (r.ok) { const d = await r.json(); setUiStyles(d.styles || {}); }
    } catch {}
  }, []);

  const loadUserMessages = useCallback(async () => {
    try {
      const r = await fetch('/api/admin/user-messages', { credentials: 'include' });
      if (r.ok) setUserMessages(await r.json());
    } catch {}
  }, []);

  const loadBroadcastMessage = useCallback(async () => {
    try {
      const r = await fetch('/api/admin/broadcast-message', { credentials: 'include' });
      if (r.ok) {
        const d = await r.json();
        setBroadcastCurrent(d);
        if (d.text) setBroadcastText(d.text);
        if (d.targets) setBroadcastTargets(d.targets);
        setBroadcastEnabled(d.enabled !== false);
      }
    } catch {}
  }, []);

  const loadModifiedFiles = useCallback(async () => {
    try {
      const r = await fetch('/api/admin/modified-files', { credentials: 'include' });
      if (r.ok) setModifiedFiles(await r.json());
    } catch {}
  }, []);

  const pollBuildStatus = useCallback(() => {
    const ref = setInterval(async () => {
      try {
        const r = await fetch('/api/admin/build-status', { credentials: 'include' });
        if (!r.ok) return;
        const d = await r.json();
        setBuildStatus(d);
        if (d.status === 'done' || d.status === 'error') {
          clearInterval(ref);
          setBuildPollRef(null);
          if (d.status === 'done') {
            setTimeout(() => window.location.reload(), 1500);
          }
        }
      } catch {}
    }, 2000);
    setBuildPollRef(ref);
    return ref;
  }, []);

  const buildPreview = (parsed) => {
    if (!parsed || !parsed.type) return null;
    const blocks = parsed.type === 'multi' ? (parsed.data || []) : [parsed];
    return blocks.map(b => {
      if (b.type === 'format') return { icon: '🔢', label: 'Format de prédiction', detail: `→ Format #${b.data?.format_id}` };
      if (b.type === 'strategies') return { icon: '⚙️', label: 'Stratégies', detail: `${Array.isArray(b.data) ? b.data.length : 0} stratégie(s) à créer/mettre à jour : ${(b.data || []).map(s => `"${s.name}"`).join(', ')}` };
      if (b.type === 'sequences') return { icon: '🔁', label: 'Séquences de relance', detail: `${Array.isArray(b.data) ? b.data.length : 0} séquence(s) : ${(b.data || []).map(s => `"${s.name}"`).join(', ')}` };
      if (b.type === 'styles') return { icon: '🎨', label: 'Styles / Interface', detail: `${Object.keys(b.data || {}).length} variable(s) CSS : ${Object.keys(b.data || {}).join(', ')}` };
      if (b.type === 'code') {
        const files = b.data?.files || [];
        const frontend = files.filter(f => f.path?.startsWith('src/') || f.path?.startsWith('public/'));
        const backend  = files.filter(f => !f.path?.startsWith('src/') && !f.path?.startsWith('public/'));
        const ops = files.map(f => f.content ? 'remplacement complet' : f.find && f.replace !== undefined ? 'find+replace' : f.find && f.insert_after !== undefined ? 'insert_after' : f.find && f.insert_before !== undefined ? 'insert_before' : f.append !== undefined ? 'append' : f.prepend !== undefined ? 'prepend' : '?');
        return {
          icon: '🛠️', label: `Code source (${files.length} fichier${files.length > 1 ? 's' : ''})`,
          detail: `${frontend.length > 0 ? `Frontend: ${frontend.map(f => f.path).join(', ')}` : ''}${frontend.length > 0 && backend.length > 0 ? ' | ' : ''}${backend.length > 0 ? `Backend: ${backend.map(f => f.path).join(', ')}` : ''}\nOpérations: ${ops.join(', ')}${b.data?.rebuild !== false && frontend.length > 0 ? '\n⚠️ Un rebuild automatique sera déclenché (~15s)' : ''}`,
          warning: frontend.length > 0 && b.data?.rebuild !== false,
        };
      }
      return { icon: '❓', label: `Type inconnu: ${b.type}`, detail: '' };
    });
  };

  const handleUpdateFileChange = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUpdateResult(null);
    setUpdateFile(null);
    setUpdatePreview(null);
    setUpdateFileName(file.name);
    setBuildStatus(null);
    const reader = new FileReader();
    reader.onload = (ev) => {
      try {
        const parsed = JSON.parse(ev.target.result);
        setUpdateFile(parsed);
        setUpdatePreview(buildPreview(parsed));
      } catch {
        setUpdateResult({ ok: false, errors: ['Fichier JSON invalide — vérifiez la syntaxe'] });
      }
    };
    reader.readAsText(file);
    e.target.value = '';
  };

  const applyUpdate = async () => {
    if (!updateFile) return;
    setUpdateApplying(true); setUpdateResult(null); setBuildStatus(null);
    try {
      const r = await fetch('/api/admin/apply-update', {
        method: 'POST', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(updateFile),
      });
      const d = await r.json();
      setUpdateResult(d);
      if (d.ok) {
        setUpdateFile(null); setUpdatePreview(null); setUpdateFileName('');
        await Promise.all([loadStrategies(), loadLossSequences(), loadUiStyles(), loadModifiedFiles()]);
        // Appliquer les styles immédiatement
        if (d.results?.some(r2 => r2.type === 'styles' && r2.applied > 0)) {
          const sr = await fetch('/api/settings/ui-styles');
          if (sr.ok) {
            const styles = await sr.json();
            for (const [k, v] of Object.entries(styles)) {
              if (k.startsWith('--')) document.documentElement.style.setProperty(k, v);
            }
          }
        }
        // Démarrer le polling si un rebuild est en cours
        if (d.results?.some(r2 => r2.rebuilding)) {
          const bs = await fetch('/api/admin/build-status', { credentials: 'include' });
          if (bs.ok) setBuildStatus(await bs.json());
          pollBuildStatus();
        }
      }
    } catch { setUpdateResult({ ok: false, errors: ['Erreur réseau'] }); }
    setUpdateApplying(false);
  };

  const loadLossSequences = useCallback(async () => {
    try {
      const r = await fetch('/api/admin/loss-sequences', { credentials: 'include' });
      if (r.ok) setLossSequences(await r.json());
    } catch {}
  }, []);

  const loadAnnouncements = useCallback(async () => {
    try {
      const r = await fetch('/api/admin/announcements', { credentials: 'include' });
      if (r.ok) setAnnouncements(await r.json());
    } catch {}
  }, []);

  const loadDefaultStratTg = useCallback(async () => {
    try {
      const r = await fetch('/api/admin/default-tg', { credentials: 'include' });
      if (!r.ok) return;
      const data = await r.json();
      setDefaultStratTg(prev => {
        const next = { ...prev };
        for (const s of ['C1','C2','C3','DC']) {
          next[s] = { bot_token: data[s]?.bot_token || '', channel_id: data[s]?.channel_id || '', tg_format: data[s]?.tg_format ?? null };
        }
        return next;
      });
    } catch {}
  }, []);

  const saveDefaultStratTg = async () => {
    setDefaultTgSaving(true);
    setDefaultTgMsg('');
    try {
      const payload = {};
      for (const s of ['C1','C2','C3','DC']) {
        const { bot_token, channel_id, tg_format } = defaultStratTg[s] || {};
        if (bot_token?.trim() && channel_id?.trim()) {
          payload[s] = { bot_token: bot_token.trim(), channel_id: channel_id.trim(), tg_format: tg_format ?? null };
        }
      }
      const r = await fetch('/api/admin/default-tg', { method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'include', body: JSON.stringify(payload) });
      setDefaultTgMsg(r.ok ? '✅ Config sauvegardée' : '❌ Erreur');
    } catch { setDefaultTgMsg('❌ Erreur réseau'); }
    setDefaultTgSaving(false);
    setTimeout(() => setDefaultTgMsg(''), 3000);
  };

  const loadMsgFormat = useCallback(async () => {
    try {
      const r = await fetch('/api/admin/msg-format', { credentials: 'include' });
      if (r.ok) { const d = await r.json(); setMsgFormat(d.format_id || 1); }
    } catch {}
  }, []);

  const loadMaxR = useCallback(async () => {
    try {
      const r = await fetch('/api/admin/max-rattrapage', { credentials: 'include' });
      if (r.ok) { const d = await r.json(); setMaxRattrapage(d.max_rattrapage ?? 20); }
    } catch {}
  }, []);

  const saveMaxR = async (n) => {
    setMaxRSaving(true);
    try {
      const r = await fetch('/api/admin/max-rattrapage', {
        method: 'POST', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ max_rattrapage: n }),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || 'Erreur');
      setMaxRattrapage(n);
      setMsgFormatMsg('✅ Rattrapages max enregistré');
      setTimeout(() => setMsgFormatMsg(''), 3000);
    } catch (e) {
      setMsgFormatMsg('❌ ' + e.message);
      setTimeout(() => setMsgFormatMsg(''), 3000);
    }
    setMaxRSaving(false);
  };

  const saveMsgFormat = async (id) => {
    setMsgFormatSaving(true);
    try {
      const r = await fetch('/api/admin/msg-format', {
        method: 'POST', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ format_id: id }),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || 'Erreur');
      setMsgFormat(id);
      setMsgFormatMsg('✅ Format enregistré');
      setTimeout(() => setMsgFormatMsg(''), 3000);
    } catch (e) {
      setMsgFormatMsg('❌ ' + e.message);
      setTimeout(() => setMsgFormatMsg(''), 3000);
    }
    setMsgFormatSaving(false);
  };

  const openCreate = () => {
    setStratEditing(null);
    setStratForm(JSON.parse(JSON.stringify(BLANK_FORM)));
    setStratOpen(true);
  };

  // Normalise mirror_pairs : ancien format [[a,b]] → nouveau [{a,b,threshold:null}]
  const normalizeMirrorPairs = (raw) => {
    if (!Array.isArray(raw)) return [];
    return raw.map(p => {
      if (Array.isArray(p)) return { a: p[0], b: p[1], threshold: null };
      if (p && typeof p === 'object' && p.a && p.b) return { a: p.a, b: p.b, threshold: p.threshold ?? null };
      return null;
    }).filter(Boolean);
  };

  const openEdit = (s) => {
    setStratEditing(s.id);
    // Compatibilité ancienne version (tg_bot_token / tg_channel_id) → tableau
    let tg_targets = Array.isArray(s.tg_targets) ? s.tg_targets.map(t => ({ ...t })) : [];
    if (!tg_targets.length && s.tg_bot_token && s.tg_channel_id)
      tg_targets = [{ bot_token: s.tg_bot_token, channel_id: s.tg_channel_id }];
    // Détecter le type : si au moins une cible TG est configurée → 'telegram', sinon 'simple'
    const stratType = tg_targets.some(t => t.bot_token && t.channel_id) ? 'telegram' : 'simple';
    const exceptions = Array.isArray(s.exceptions) ? s.exceptions.map(e => ({ ...e })) : [];
    // Normalise les mappings : string → array (compatibilité anciennes stratégies)
    const mappings = {};
    for (const suit of ['♠','♥','♦','♣']) {
      const v = s.mappings?.[suit];
      mappings[suit] = Array.isArray(v) ? [...v] : (v ? [v] : ['♥']);
    }
    setStratForm({ name: s.name, threshold: s.threshold, mode: s.mode, mappings, visibility: s.visibility, enabled: s.enabled, tg_targets, stratType, exceptions, prediction_offset: s.prediction_offset || 1, hand: s.hand === 'banquier' ? 'banquier' : 'joueur', max_rattrapage: s.max_rattrapage ?? 20, tg_format: s.tg_format ?? null, mirror_pairs: normalizeMirrorPairs(s.mirror_pairs), trigger_on: s.trigger_on ?? null, trigger_strategy_id: s.trigger_strategy_id ?? '', trigger_count: s.trigger_count ?? 2, trigger_level: s.trigger_level ?? 3, relance_enabled: s.relance_enabled ?? false, relance_pertes: s.relance_pertes ?? 3, relance_types: s.relance_types ?? [], relance_nombre: s.relance_nombre ?? 1 });
    setStratOpen(true);
  };

  // Dupliquer une stratégie : pré-remplir le formulaire de création (sans ID)
  const openClone = (s) => {
    setStratEditing(null);
    let tg_targets = Array.isArray(s.tg_targets) ? s.tg_targets.map(t => ({ ...t })) : [];
    if (!tg_targets.length && s.tg_bot_token && s.tg_channel_id)
      tg_targets = [{ bot_token: s.tg_bot_token, channel_id: s.tg_channel_id }];
    const stratType = tg_targets.some(t => t.bot_token && t.channel_id) ? 'telegram' : 'simple';
    const exceptions = Array.isArray(s.exceptions) ? s.exceptions.map(e => ({ ...e })) : [];
    const mappings = {};
    for (const suit of ['♠','♥','♦','♣']) {
      const v = s.mappings?.[suit];
      mappings[suit] = Array.isArray(v) ? [...v] : (v ? [v] : ['♥']);
    }
    setStratForm({ name: `Copie de ${s.name}`, threshold: s.threshold, mode: s.mode, mappings, visibility: s.visibility, enabled: false, tg_targets, stratType, exceptions, prediction_offset: s.prediction_offset || 1, hand: s.hand === 'banquier' ? 'banquier' : 'joueur', max_rattrapage: s.max_rattrapage ?? 20, tg_format: s.tg_format ?? null, mirror_pairs: normalizeMirrorPairs(s.mirror_pairs), trigger_on: s.trigger_on ?? null, trigger_strategy_id: s.trigger_strategy_id ?? '', trigger_count: s.trigger_count ?? 2, trigger_level: s.trigger_level ?? 3, relance_enabled: s.relance_enabled ?? false, relance_pertes: s.relance_pertes ?? 3, relance_types: s.relance_types ?? [], relance_nombre: s.relance_nombre ?? 1 });
    setStratOpen(true);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  // Routage C1/C2/C3/DC : toggle un canal pour une stratégie
  const toggleRoute = (strategy, dbId) => {
    setRouteData(p => {
      const set = new Set(p[strategy] || []);
      if (set.has(dbId)) set.delete(dbId); else set.add(dbId);
      return { ...p, [strategy]: set };
    });
  };

  const saveRoutes = async () => {
    setRouteSaving(true);
    try {
      await Promise.all(DEFAULT_STRATS.map(s =>
        fetch(`/api/admin/strategy-routes/${s}`, {
          method: 'PUT', credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ channel_ids: [...(routeData[s] || new Set())] }),
        })
      ));
      setRouteMsg('✅ Routage enregistré');
    } catch (e) {
      setRouteMsg('❌ ' + e.message);
    } finally {
      setRouteSaving(false);
      setTimeout(() => setRouteMsg(''), 3500);
    }
  };

  const cancelStratForm = () => { setStratOpen(false); setStratEditing(null); };

  const saveStrat = async () => {
    setStratSaving(true);
    try {
      const url = stratEditing !== null ? `/api/admin/strategies/${stratEditing}` : '/api/admin/strategies';
      const method = stratEditing !== null ? 'PUT' : 'POST';
      const r = await fetch(url, {
        method, credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(stratForm),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || 'Erreur');
      showStratMsg(stratEditing !== null ? '✅ Stratégie mise à jour' : `✅ Stratégie ${d.strategy?.id} créée`, false);
      setStratOpen(false);
      setStratEditing(null);
      loadStrategies();
    } catch (e) { showStratMsg('❌ ' + e.message, true); }
    finally { setStratSaving(false); }
  };

  const deleteStrat = async (id, name) => {
    if (!confirm(`Supprimer la stratégie "${name}" ? Ses prédictions resteront en base mais ne seront plus traitées.`)) return;
    try {
      const r = await fetch(`/api/admin/strategies/${id}`, { method: 'DELETE', credentials: 'include' });
      if (!r.ok) { const d = await r.json(); throw new Error(d.error); }
      showStratMsg(`✅ Stratégie "${name}" supprimée`, false);
      loadStrategies();
    } catch (e) { showStratMsg('❌ ' + e.message, true); }
  };

  const toggleStrat = async (s) => {
    try {
      const r = await fetch(`/api/admin/strategies/${s.id}`, {
        method: 'PUT', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...s, enabled: !s.enabled }),
      });
      if (r.ok) loadStrategies();
    } catch {}
  };

  const handleSaveToken = async () => {
    if (!tokenInput.trim()) return;
    setTokenLoading(true);
    try {
      const r = await fetch('/api/telegram/bot-token', {
        method: 'POST', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token: tokenInput.trim() }),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || 'Erreur');
      setTokenInfo({ token_set: true, token_preview: d.token_preview });
      setTokenInput('');
      setShowToken(false);
      showMsg('✅ Token BOT sauvegardé', false);
    } catch (e) { showMsg('❌ ' + e.message, true); }
    finally { setTokenLoading(false); }
  };

  const handleDeleteToken = async () => {
    if (!confirm('Supprimer le token BOT Telegram ?')) return;
    try {
      await fetch('/api/telegram/bot-token', { method: 'DELETE', credentials: 'include' });
      setTokenInfo({ token_set: false, token_preview: null });
      showMsg('Token supprimé', false);
    } catch {}
  };

  useEffect(() => { loadUsers(); loadChannels(); loadTokenInfo(); loadStrategies(); loadStratStats(); loadMsgFormat(); loadMaxR(); loadStrategyRoutes(); loadDefaultStratTg(); loadLossSequences(); loadAnnouncements(); loadRenderDbStatus(); loadUiStyles(); loadModifiedFiles(); loadBroadcastMessage(); loadUserMessages(); }, [loadUsers, loadChannels, loadTokenInfo, loadStrategies, loadStratStats, loadMsgFormat, loadMaxR, loadStrategyRoutes, loadDefaultStratTg, loadLossSequences, loadAnnouncements, loadRenderDbStatus, loadUiStyles, loadModifiedFiles, loadBroadcastMessage, loadUserMessages]);

  // Duration input helpers
  const setDur = (uid, field, val) =>
    setDurInputs(p => ({ ...p, [uid]: { ...p[uid], [field]: val } }));
  const getDur = uid => durInputs[uid] || { val: '', unit: 'h' };

  const approveUser = async uid => {
    const { val, unit } = getDur(uid);
    const mins = minutesFromInput(val, unit);
    if (!mins || mins < 10 || mins > 45000)
      return showMsg('Durée invalide (10 min à 750 h)', true);
    const res = await fetch(`/api/admin/users/${uid}/approve`, {
      method: 'POST', credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ minutes: mins }),
    });
    const d = await res.json();
    if (res.ok) { showMsg(d.message); loadUsers(); }
    else showMsg(d.error, true);
  };

  const extendUser = async uid => {
    const { val, unit } = getDur(uid);
    const mins = minutesFromInput(val, unit);
    if (!mins || mins < 10 || mins > 45000)
      return showMsg('Durée invalide (10 min à 750 h)', true);
    const res = await fetch(`/api/admin/users/${uid}/extend`, {
      method: 'POST', credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ minutes: mins }),
    });
    const d = await res.json();
    if (res.ok) { showMsg(d.message); loadUsers(); }
    else showMsg(d.error, true);
  };

  const revokeUser = async uid => {
    if (!confirm('Révoquer l\'accès ?')) return;
    const res = await fetch(`/api/admin/users/${uid}/reject`, { method: 'POST', credentials: 'include' });
    if (res.ok) { showMsg('Accès révoqué'); loadUsers(); }
  };

  const deleteUser = async uid => {
    if (!confirm('Supprimer définitivement cet utilisateur ?')) return;
    const res = await fetch(`/api/admin/users/${uid}`, { method: 'DELETE', credentials: 'include' });
    if (res.ok) { showMsg('Utilisateur supprimé'); loadUsers(); }
  };

  const saveNames = async uid => {
    const edit = nameEdit[uid];
    if (!edit) return;
    const res = await fetch(`/api/admin/users/${uid}`, {
      method: 'PUT', credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ first_name: edit.first_name, last_name: edit.last_name }),
    });
    if (res.ok) { showMsg('Nom enregistré'); loadUsers(); setNameEdit(p => { const c = {...p}; delete c[uid]; return c; }); }
  };

  const startNameEdit = u =>
    setNameEdit(p => ({ ...p, [u.id]: { first_name: u.first_name || '', last_name: u.last_name || '' } }));

  // Visibility modal (opt-in : canaux Telegram + stratégies)
  const openVisModal = async u => {
    setVisModal({ userId: u.id, username: u.username });
    setVisLoading(true);
    const [chRes, stRes] = await Promise.all([
      fetch(`/api/telegram/users/${u.id}/visibility`, { credentials: 'include' }),
      fetch(`/api/admin/users/${u.id}/strategies`, { credentials: 'include' }),
    ]);
    if (chRes.ok) {
      const d = await chRes.json();
      setVisData(p => ({ ...p, [u.id]: new Set(d.visible) }));
    }
    if (stRes.ok) {
      const d = await stRes.json();
      setVisStratData(p => ({ ...p, [u.id]: new Set(d.visible) }));
    }
    setVisLoading(false);
  };

  const toggleVisChannel = (userId, chDbId) => {
    setVisData(p => {
      const set = new Set(p[userId] || []);
      if (set.has(chDbId)) set.delete(chDbId); else set.add(chDbId);
      return { ...p, [userId]: set };
    });
  };

  const toggleVisStrategy = (userId, stratId) => {
    setVisStratData(p => {
      const set = new Set(p[userId] || []);
      if (set.has(stratId)) set.delete(stratId); else set.add(stratId);
      return { ...p, [userId]: set };
    });
  };

  const saveVisibility = async () => {
    const { userId } = visModal;
    const visibleChannels = [...(visData[userId] || new Set())];
    const visibleStrategies = [...(visStratData[userId] || new Set())];
    const [r1, r2] = await Promise.all([
      fetch(`/api/telegram/users/${userId}/visibility`, {
        method: 'PUT', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ visible_channel_ids: visibleChannels }),
      }),
      fetch(`/api/admin/users/${userId}/strategies`, {
        method: 'PUT', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ strategy_ids: visibleStrategies }),
      }),
    ]);
    if (r1.ok && r2.ok) { showMsg('Accès assignés avec succès'); setVisModal(null); }
    else showMsg('Erreur lors de la sauvegarde', true);
  };

  // Add telegram channel
  const addChannel = async () => {
    if (!tgInput.trim()) return;
    setTgLoading(true);
    const res = await fetch('/api/telegram/channels', {
      method: 'POST', credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ channel_id: tgInput.trim() }),
    });
    const d = await res.json();
    if (res.ok) { showTgMsg(`✅ Canal "${d.channel.name}" ajouté`); setTgInput(''); loadChannels(); }
    else showTgMsg(d.error || 'Erreur', true);
    setTgLoading(false);
  };

  const removeChannel = async dbId => {
    if (!confirm('Supprimer ce canal Telegram ?')) return;
    const res = await fetch(`/api/telegram/channels/${dbId}`, { method: 'DELETE', credentials: 'include' });
    if (res.ok) { showTgMsg('Canal supprimé'); loadChannels(); }
    else showTgMsg('Erreur', true);
  };

  const handleLogout = async () => { await logout(); navigate('/'); };
  const nonAdmins = users.filter(u => !u.is_admin);

  return (
    <div className="admin-page">
      <nav className="navbar">
        <Link to="/" className="navbar-brand">🎲 Prediction Baccara Pro ✨</Link>
        <div className="navbar-actions">
          <Link to="/choisir" className="btn btn-ghost btn-sm">⇄ Canaux</Link>
          <span style={{ fontSize: '0.8rem', color: 'var(--gold)' }}>{user?.username} · Admin</span>
          <button className="btn btn-ghost btn-sm" onClick={handleLogout}>Déconnexion</button>
        </div>
      </nav>

      <div className="admin-content">
        <div className="page-header">
          <h1 className="page-title">Panneau Administration</h1>
        </div>

        {message && (
          <div className={`alert ${message.error ? 'alert-error' : 'alert-success'}`} style={{ marginBottom: 16 }}>
            {message.text}
          </div>
        )}

        {/* ── ONGLETS DE NAVIGATION ── */}
        <div style={{ display: 'flex', gap: 4, marginBottom: 28, borderBottom: '2px solid rgba(255,255,255,0.06)', paddingBottom: 0, flexWrap: 'wrap' }}>
          {[
            { id: 'utilisateurs',   icon: '👥', label: 'Utilisateurs',   badge: (nonAdmins.filter(u => u.status === 'pending').length + userMessages.filter(m => !m.read).length) || null },
            { id: 'strategies',     icon: '⚙️', label: 'Stratégies',     badge: strategies.length > 0 ? strategies.length : null },
            { id: 'bilan',          icon: '📊', label: 'Bilan' },
            { id: 'canaux',         icon: '✈️', label: 'Telegram',        badge: tgChannels.length > 0 ? tgChannels.length : null },
            { id: 'config',         icon: '🔀', label: 'Routage' },
            { id: 'systeme',        icon: '🛠️', label: 'Système' },
          ].map(tab => {
            const active = adminTab === tab.id;
            return (
              <button
                key={tab.id}
                type="button"
                onClick={() => setAdminTab(tab.id)}
                style={{
                  display: 'flex', alignItems: 'center', gap: 7,
                  padding: '10px 20px', border: 'none', cursor: 'pointer', fontSize: 13, fontWeight: active ? 700 : 500,
                  background: active ? 'rgba(251,191,36,0.12)' : 'transparent',
                  color: active ? '#fbbf24' : '#64748b',
                  borderBottom: active ? '2px solid #fbbf24' : '2px solid transparent',
                  marginBottom: -2, borderRadius: '8px 8px 0 0',
                  transition: 'all 0.18s',
                }}
              >
                <span>{tab.icon}</span>
                <span>{tab.label}</span>
                {tab.badge != null && tab.badge > 0 && (
                  <span style={{ background: tab.id === 'utilisateurs' && nonAdmins.filter(u => u.status === 'pending').length > 0 ? '#ef4444' : 'rgba(251,191,36,0.25)', color: tab.id === 'utilisateurs' && nonAdmins.filter(u => u.status === 'pending').length > 0 ? '#fff' : '#fbbf24', borderRadius: 20, fontSize: 10, fontWeight: 800, padding: '1px 7px', minWidth: 18, textAlign: 'center' }}>
                    {tab.badge}
                  </span>
                )}
              </button>
            );
          })}
        </div>

        {/* ── TAB : UTILISATEURS ── */}
        {adminTab === 'utilisateurs' && <>

        {/* ── COMPTES PREMIUM ── */}
        <div className="tg-admin-card" style={{ borderColor: 'rgba(250,204,21,0.4)' }}>
          <div className="tg-admin-header">
            <span className="tg-admin-icon">⭐</span>
            <div style={{ flex: 1 }}>
              <h2 className="tg-admin-title">Comptes Premium</h2>
              <p className="tg-admin-sub">
                Génère des comptes prêts à l'emploi (premium1, premium2…) avec email et mot de passe. Les comptes existants seront remplacés.
              </p>
            </div>
          </div>
          <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'flex-end', marginTop: 14 }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              <label style={{ fontSize: 11, color: '#94a3b8', fontWeight: 600, textTransform: 'uppercase', letterSpacing: 0.8 }}>Nombre</label>
              <input
                type="number" min={1} max={50}
                value={premiumCount}
                onChange={e => setPremiumCount(Math.max(1, Math.min(50, parseInt(e.target.value) || 1)))}
                style={{ width: 80, padding: '8px 12px', borderRadius: 8, border: '1px solid rgba(250,204,21,0.3)',
                  background: 'rgba(250,204,21,0.05)', color: '#e2e8f0', fontSize: 14, textAlign: 'center' }}
              />
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4, flex: 1, minWidth: 180 }}>
              <label style={{ fontSize: 11, color: '#94a3b8', fontWeight: 600, textTransform: 'uppercase', letterSpacing: 0.8 }}>Domaine email</label>
              <input
                type="text"
                value={premiumDomain}
                onChange={e => setPremiumDomain(e.target.value)}
                placeholder="premium.pro"
                style={{ padding: '8px 12px', borderRadius: 8, border: '1px solid rgba(250,204,21,0.3)',
                  background: 'rgba(250,204,21,0.05)', color: '#e2e8f0', fontSize: 13 }}
              />
              <span style={{ fontSize: 10, color: '#64748b' }}>Ex : premium1@{premiumDomain || 'premium.pro'}</span>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              <label style={{ fontSize: 11, color: '#94a3b8', fontWeight: 600, textTransform: 'uppercase', letterSpacing: 0.8 }}>Durée (heures)</label>
              <input
                type="number" min={1}
                value={premiumDurH}
                onChange={e => setPremiumDurH(Math.max(1, parseInt(e.target.value) || 750))}
                style={{ width: 110, padding: '8px 12px', borderRadius: 8, border: '1px solid rgba(250,204,21,0.3)',
                  background: 'rgba(250,204,21,0.05)', color: '#e2e8f0', fontSize: 14, textAlign: 'center' }}
              />
            </div>
            <button
              className="btn btn-gold btn-sm"
              style={{ minWidth: 200, height: 38, alignSelf: 'flex-end' }}
              onClick={generatePremium}
              disabled={premiumLoading}
            >
              {premiumLoading ? '⏳ Génération...' : `⭐ Générer ${premiumCount} compte${premiumCount > 1 ? 's' : ''}`}
            </button>
          </div>
        </div>

        {/* ── USER TABLE ── */}
        <div className="admin-card">
          <div className="admin-card-header">
            <h2 className="admin-card-title">👥 Gestion des utilisateurs</h2>
            <span className="admin-card-count">{nonAdmins.length} utilisateur{nonAdmins.length !== 1 ? 's' : ''}</span>
          </div>

          {loading ? (
            <div style={{ padding: 40, display: 'flex', justifyContent: 'center' }}><div className="spinner" /></div>
          ) : nonAdmins.length === 0 ? (
            <div className="empty-state" style={{ padding: '48px 24px' }}>
              <div className="empty-state-icon">👥</div>
              <div>Aucun utilisateur inscrit</div>
            </div>
          ) : (
            <div style={{ overflowX: 'auto' }}>
              <table className="users-table">
                <thead>
                  <tr>
                    <th>Utilisateur</th>
                    <th>Prénom / Nom</th>
                    <th>Durée donnée</th>
                    <th>Durée restante</th>
                    <th>Statut</th>
                    <th>Définir durée</th>
                    <th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {nonAdmins.map(u => {
                    const dur = getDur(u.id);
                    const edit = nameEdit[u.id];
                    return (
                      <tr key={u.id}>
                        {/* Username */}
                        <td>
                          <div style={{ fontWeight: 700 }}>{u.username}</div>
                          <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>{u.email}</div>
                        </td>

                        {/* First / Last name */}
                        <td style={{ minWidth: 160 }}>
                          {edit ? (
                            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                              <input
                                className="admin-name-input"
                                placeholder="Prénom"
                                value={edit.first_name}
                                onChange={e => setNameEdit(p => ({ ...p, [u.id]: { ...p[u.id], first_name: e.target.value } }))}
                              />
                              <input
                                className="admin-name-input"
                                placeholder="Nom"
                                value={edit.last_name}
                                onChange={e => setNameEdit(p => ({ ...p, [u.id]: { ...p[u.id], last_name: e.target.value } }))}
                              />
                              <div style={{ display: 'flex', gap: 4 }}>
                                <button className="btn btn-gold btn-sm" style={{ flex: 1 }} onClick={() => saveNames(u.id)}>💾</button>
                                <button className="btn btn-ghost btn-sm" style={{ flex: 1 }} onClick={() => setNameEdit(p => { const c={...p}; delete c[u.id]; return c; })}>✕</button>
                              </div>
                            </div>
                          ) : (
                            <div
                              style={{ cursor: 'pointer', padding: '4px 8px', borderRadius: 6, border: '1px dashed var(--border-dim)' }}
                              onClick={() => startNameEdit(u)}
                              title="Cliquer pour modifier"
                            >
                              <div style={{ fontSize: '0.85rem', color: u.first_name ? '#e2e8f0' : 'var(--text-muted)' }}>
                                {u.first_name || '—'} {u.last_name || ''}
                              </div>
                              <div style={{ fontSize: '0.65rem', color: 'var(--text-muted)', marginTop: 1 }}>✏️ modifier</div>
                            </div>
                          )}
                        </td>

                        {/* Duration given */}
                        <td style={{ fontSize: '0.82rem', color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>
                          {fmtDuration(u.subscription_duration_minutes)}
                        </td>

                        {/* Remaining */}
                        <td style={{ whiteSpace: 'nowrap', fontSize: '0.82rem' }}>
                          {fmtRemaining(u.subscription_expires_at)}
                        </td>

                        {/* Status */}
                        <td>{statusLabel(u.status)}</td>

                        {/* Duration input */}
                        <td style={{ minWidth: 160 }}>
                          <div className="dur-input-row">
                            <input
                              className="dur-val-input"
                              type="number"
                              min="0.17"
                              max={dur.unit === 'h' ? '750' : '45000'}
                              step={dur.unit === 'h' ? '0.5' : '10'}
                              placeholder={dur.unit === 'h' ? 'ex: 24' : 'ex: 60'}
                              value={dur.val}
                              onChange={e => setDur(u.id, 'val', e.target.value)}
                            />
                            <select
                              className="dur-unit-select"
                              value={dur.unit}
                              onChange={e => setDur(u.id, 'unit', e.target.value)}
                            >
                              <option value="min">min</option>
                              <option value="h">h</option>
                            </select>
                          </div>
                        </td>

                        {/* Actions */}
                        <td>
                          <div className="approve-form" style={{ flexWrap: 'wrap', gap: 4 }}>
                            {(u.status === 'pending' || u.status === 'expired') && (
                              <button className="btn btn-success btn-sm" onClick={() => approveUser(u.id)}>✅ Approuver</button>
                            )}
                            {u.status === 'active' && (
                              <button className="btn btn-ghost btn-sm" onClick={() => extendUser(u.id)}>➕ Prolonger</button>
                            )}
                            <button className="btn btn-tg btn-sm" onClick={() => openVisModal(u)}>📡 Canaux</button>
                            {u.status !== 'pending' && (
                              <button className="btn btn-danger btn-sm" onClick={() => revokeUser(u.id)}>🔒 Révoquer</button>
                            )}
                            <button className="btn btn-danger btn-sm" onClick={() => deleteUser(u.id)} style={{ opacity: 0.7 }}>🗑️</button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* ── MESSAGES DES UTILISATEURS ── */}
        <div className="tg-admin-card" style={{ borderColor: 'rgba(34,197,94,0.35)', marginBottom: 20, marginTop: 20 }}>
          <div className="tg-admin-header">
            <span className="tg-admin-icon">📨</span>
            <div style={{ flex: 1 }}>
              <h2 className="tg-admin-title">Messages reçus des utilisateurs</h2>
              <p className="tg-admin-sub">Messages envoyés par les utilisateurs via le bouton de contact. Séparés de la gestion des comptes.</p>
            </div>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              {userMessages.filter(m => !m.read).length > 0 && (
                <span style={{ fontSize: 11, fontWeight: 800, color: '#fff', background: '#ef4444', borderRadius: 20, padding: '2px 9px' }}>
                  {userMessages.filter(m => !m.read).length} non lu{userMessages.filter(m => !m.read).length > 1 ? 's' : ''}
                </span>
              )}
              <button
                className="btn btn-sm"
                style={{ fontSize: 11, color: '#64748b', background: 'rgba(100,116,139,0.08)', border: '1px solid rgba(100,116,139,0.2)' }}
                onClick={loadUserMessages}
              >🔄 Actualiser</button>
              {userMessages.length > 0 && (
                <button
                  className="btn btn-sm"
                  style={{ fontSize: 11, color: '#f87171', background: 'rgba(248,113,113,0.08)', border: '1px solid rgba(248,113,113,0.2)' }}
                  onClick={async () => {
                    if (!confirm('Supprimer tous les messages ?')) return;
                    await fetch('/api/admin/user-messages', { method: 'DELETE', credentials: 'include' });
                    setUserMessages([]);
                  }}
                >🗑️ Tout effacer</button>
              )}
            </div>
          </div>

          {userMessages.length === 0 ? (
            <div style={{ textAlign: 'center', color: '#475569', fontSize: 13, padding: '20px 0' }}>Aucun message reçu.</div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10, maxHeight: 420, overflowY: 'auto' }}>
              {userMessages.map(msg => (
                <div key={msg.id} style={{
                  background: msg.read ? 'rgba(255,255,255,0.02)' : 'rgba(34,197,94,0.06)',
                  border: `1px solid ${msg.read ? 'rgba(100,116,139,0.15)' : 'rgba(34,197,94,0.25)'}`,
                  borderLeft: `4px solid ${msg.read ? '#334155' : '#22c55e'}`,
                  borderRadius: '0 10px 10px 0',
                  padding: '12px 14px',
                }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6, flexWrap: 'wrap', gap: 6 }}>
                    <span style={{ fontWeight: 800, fontSize: 13, color: '#e2e8f0' }}>👤 {msg.username}</span>
                    <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                      <span style={{ fontSize: 10, color: '#475569' }}>
                        {new Date(msg.date).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short', year: 'numeric' })}{' '}
                        {new Date(msg.date).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}
                      </span>
                      {!msg.read && (
                        <button
                          style={{ fontSize: 10, fontWeight: 700, color: '#22c55e', background: 'rgba(34,197,94,0.1)', border: '1px solid rgba(34,197,94,0.25)', borderRadius: 10, padding: '1px 8px', cursor: 'pointer' }}
                          onClick={async () => {
                            await fetch(`/api/admin/user-messages/${msg.id}/read`, { method: 'POST', credentials: 'include' });
                            await loadUserMessages();
                          }}
                        >✓ Lu</button>
                      )}
                      <button
                        style={{ fontSize: 10, color: '#f87171', background: 'none', border: 'none', cursor: 'pointer', fontWeight: 700 }}
                        onClick={async () => {
                          await fetch(`/api/admin/user-messages/${msg.id}`, { method: 'DELETE', credentials: 'include' });
                          await loadUserMessages();
                        }}
                        title="Supprimer"
                      >✕</button>
                    </div>
                  </div>
                  <div style={{ fontSize: 13, color: msg.read ? '#94a3b8' : '#e2e8f0', lineHeight: 1.6, whiteSpace: 'pre-wrap' }}>{msg.text}</div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* ── MESSAGE BROADCAST ── */}
        <div className="tg-admin-card" style={{ borderColor: 'rgba(99,102,241,0.45)', marginTop: 20 }}>
          <div className="tg-admin-header">
            <span className="tg-admin-icon">📣</span>
            <div style={{ flex: 1 }}>
              <h2 className="tg-admin-title">Message aux utilisateurs</h2>
              <p className="tg-admin-sub">
                Rédigez un message qui sera affiché en bas de la page d'accueil pour les utilisateurs connectés selon leur statut.
              </p>
            </div>
            {broadcastCurrent?.enabled && broadcastCurrent?.text ? (
              <span style={{ fontSize: 12, fontWeight: 700, color: '#22c55e', background: 'rgba(34,197,94,0.12)', padding: '3px 10px', borderRadius: 20 }}>🟢 Actif</span>
            ) : (
              <span style={{ fontSize: 12, fontWeight: 700, color: '#64748b', background: 'rgba(100,116,139,0.12)', padding: '3px 10px', borderRadius: 20 }}>⚫ Inactif</span>
            )}
          </div>

          {/* Destinataires */}
          <div style={{ marginBottom: 14 }}>
            <div style={{ fontSize: 11, fontWeight: 700, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: 0.8, marginBottom: 8 }}>
              Destinataires
            </div>
            <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
              {[
                { id: 'pending',  label: '⏳ En attente de validation', color: '#fbbf24' },
                { id: 'active',   label: '✅ Abonnés actifs',           color: '#22c55e' },
                { id: 'expired',  label: '⌛ Abonnements expirés',      color: '#f87171' },
              ].map(({ id, label, color }) => {
                const on = broadcastTargets.includes(id);
                return (
                  <label key={id} style={{
                    display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer',
                    background: on ? 'rgba(99,102,241,0.1)' : 'rgba(100,116,139,0.06)',
                    border: `1px solid ${on ? 'rgba(99,102,241,0.35)' : 'rgba(100,116,139,0.2)'}`,
                    borderRadius: 8, padding: '7px 12px', transition: 'all .15s',
                  }}>
                    <input
                      type="checkbox" checked={on}
                      onChange={() => setBroadcastTargets(p => on ? p.filter(t => t !== id) : [...p, id])}
                      style={{ accentColor: color, width: 14, height: 14 }}
                    />
                    <span style={{ fontSize: 12, fontWeight: 600, color: on ? '#e2e8f0' : '#64748b' }}>{label}</span>
                  </label>
                );
              })}
            </div>
          </div>

          {/* Champ texte */}
          <div style={{ marginBottom: 14 }}>
            <div style={{ fontSize: 11, fontWeight: 700, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: 0.8, marginBottom: 6 }}>
              Message ({broadcastText.length}/1000 caractères)
            </div>
            <textarea
              className="tg-input"
              rows={5}
              maxLength={1000}
              value={broadcastText}
              onChange={e => setBroadcastText(e.target.value)}
              placeholder="Écrivez votre message ici… Il sera visible à l'accueil pour les utilisateurs sélectionnés."
              style={{ width: '100%', resize: 'vertical', fontFamily: 'inherit', fontSize: 13, lineHeight: 1.6 }}
            />
          </div>

          {/* Aperçu */}
          {broadcastText.trim() && (
            <div style={{ marginBottom: 14 }}>
              <div style={{ fontSize: 11, fontWeight: 700, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: 0.8, marginBottom: 6 }}>Aperçu</div>
              <div style={{
                background: 'linear-gradient(135deg, rgba(99,102,241,0.12) 0%, rgba(139,92,246,0.08) 100%)',
                border: '1px solid rgba(99,102,241,0.3)',
                borderLeft: '4px solid #6366f1',
                borderRadius: '0 10px 10px 0',
                padding: '14px 18px',
              }}>
                <div style={{ fontSize: 11, fontWeight: 800, color: '#818cf8', marginBottom: 6, textTransform: 'uppercase', letterSpacing: 1 }}>
                  📣 Message de l'administration
                </div>
                <div style={{ fontSize: 14, color: '#e2e8f0', lineHeight: 1.7, whiteSpace: 'pre-wrap' }}>{broadcastText}</div>
              </div>
            </div>
          )}

          {/* Boutons */}
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
            <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', marginRight: 8 }}>
              <input
                type="checkbox" checked={broadcastEnabled}
                onChange={e => setBroadcastEnabled(e.target.checked)}
                style={{ accentColor: '#6366f1', width: 15, height: 15 }}
              />
              <span style={{ fontSize: 12, color: '#94a3b8', fontWeight: 600 }}>Activer le message</span>
            </label>

            <button
              className="btn btn-gold btn-sm"
              style={{ background: 'linear-gradient(135deg,#4338ca,#6366f1)', minWidth: 160 }}
              disabled={broadcastSaving || !broadcastText.trim() || broadcastTargets.length === 0}
              onClick={async () => {
                setBroadcastSaving(true); setBroadcastMsg('');
                try {
                  const r = await fetch('/api/admin/broadcast-message', {
                    method: 'POST', credentials: 'include',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ text: broadcastText, enabled: broadcastEnabled, targets: broadcastTargets }),
                  });
                  const d = await r.json();
                  if (r.ok) { setBroadcastMsg('✅ Message envoyé'); await loadBroadcastMessage(); }
                  else setBroadcastMsg(`❌ ${d.error}`);
                } catch { setBroadcastMsg('❌ Erreur réseau'); }
                setBroadcastSaving(false);
              }}
            >
              {broadcastSaving ? '⏳…' : '📣 Envoyer le message'}
            </button>

            {broadcastCurrent?.text && (
              <button
                className="btn btn-sm"
                style={{ color: '#f87171', background: 'rgba(248,113,113,0.08)', border: '1px solid rgba(248,113,113,0.25)', fontSize: 12 }}
                onClick={async () => {
                  if (!confirm('Supprimer le message actuel ?')) return;
                  await fetch('/api/admin/broadcast-message', { method: 'DELETE', credentials: 'include' });
                  setBroadcastText(''); setBroadcastCurrent(null); setBroadcastEnabled(true);
                  setBroadcastTargets(['pending', 'active', 'expired']);
                  setBroadcastMsg('✅ Message supprimé');
                }}
              >
                🗑️ Supprimer
              </button>
            )}
          </div>

          {broadcastMsg && (
            <div style={{ fontSize: 12, fontWeight: 600, marginTop: 10, color: broadcastMsg.startsWith('✅') ? '#22c55e' : '#f87171' }}>
              {broadcastMsg}
            </div>
          )}
        </div>

        </>}

        {/* ── TAB : CANAUX — section Token + Formats (partie 1/2) ── */}
        {adminTab === 'canaux' && <>

        {/* ── BOT TOKEN ── */}
        <div className="tg-admin-card" style={{ marginBottom: 24 }}>
          <div className="tg-admin-header">
            <span className="tg-admin-icon">🔑</span>
            <div>
              <h2 className="tg-admin-title">Token API Telegram Bot</h2>
              <p className="tg-admin-sub">
                Entrez le token fourni par <strong>@BotFather</strong> pour connecter votre bot Telegram.
                {tokenInfo?.token_set && tokenInfo.token_preview && (
                  <span style={{ color: '#4ade80', marginLeft: 8 }}>
                    ✅ Actif : <code style={{ fontSize: '0.75rem', background: 'rgba(255,255,255,0.08)', padding: '1px 5px', borderRadius: 4 }}>{tokenInfo.token_preview}</code>
                  </span>
                )}
                {tokenInfo && !tokenInfo.token_set && (
                  <span style={{ color: '#f87171', marginLeft: 8 }}>⚠️ Aucun token configuré</span>
                )}
              </p>
            </div>
          </div>
          <div className="tg-input-row" style={{ marginTop: 12 }}>
            <div style={{ position: 'relative', flex: 1 }}>
              <input
                className="tg-channel-input"
                type={showToken ? 'text' : 'password'}
                placeholder="1234567890:ABC-DEF1234ghIkl-zyx57W2v1u123ew11"
                value={tokenInput}
                onChange={e => setTokenInput(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && handleSaveToken()}
                style={{ paddingRight: 40, width: '100%' }}
              />
              <button
                onClick={() => setShowToken(v => !v)}
                style={{ position: 'absolute', right: 8, top: '50%', transform: 'translateY(-50%)', background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', fontSize: '1rem' }}
                title={showToken ? 'Masquer' : 'Afficher'}
              >{showToken ? '🙈' : '👁️'}</button>
            </div>
            <button
              className="btn btn-gold btn-sm"
              onClick={handleSaveToken}
              disabled={tokenLoading || !tokenInput.trim()}
            >{tokenLoading ? '...' : '💾 Enregistrer'}</button>
            {tokenInfo?.token_set && (
              <button className="btn btn-danger btn-sm" onClick={handleDeleteToken} title="Supprimer le token">🗑️</button>
            )}
          </div>
        </div>

        {/* ── FORMAT DES MESSAGES TELEGRAM ── */}
        {(() => {
          const G = 1234;
          const SUP = ['⁰','¹','²','³','⁴','⁵'];
          const RE  = ['0️⃣','1️⃣','2️⃣','3️⃣','4️⃣','5️⃣'];
          const sup = SUP[maxRattrapage] ?? maxRattrapage;
          const barP = '🟦' + '⬜'.repeat(maxRattrapage);
          const barW = '🟩' + '⬜'.repeat(maxRattrapage > 0 ? maxRattrapage - 1 : 0) + (maxRattrapage === 0 ? '' : '');

          const barLost = '🟥'.repeat(maxRattrapage + 1);

          const FORMATS = [
            {
              id: 1, label: 'Style Russe', icon: '⚜',
              preview: `⚜ #N${G} Игрок    +${sup} ⚜\n◽Масть ♠️\n◼️ Результат ⌛`,
              result:  `⚜ #N${G} Игрок    +${sup} ⚜\n◽Масть ♠️\n◼️ Результат ✅ ${RE[0]}`,
              perdu:   `⚜ #N${G} Игрок    +${sup} ⚜\n◽Масть ♠️\n◼️ Результат ❌`,
            },
            {
              id: 2, label: 'Premium', icon: '🎲',
              preview: `🎲𝐁𝐀𝐂𝐂𝐀𝐑𝐀 𝐏𝐑𝐄𝐌𝐈𝐔𝐌+${maxRattrapage} ✨🎲\nGame ${G} :♠️\nEn cours :⌛`,
              result:  `🎲𝐁𝐀𝐂𝐂𝐀𝐑𝐀 𝐏𝐑𝐄𝐌𝐈𝐔𝐌+${maxRattrapage} ✨🎲\nGame ${G} :♠️\nStatut :✅ ${RE[0]}`,
              perdu:   `🎲𝐁𝐀𝐂𝐂𝐀𝐑𝐀 𝐏𝐑𝐄𝐌𝐈𝐔𝐌+${maxRattrapage} ✨🎲\nGame ${G} :♠️\nStatut :❌`,
            },
            {
              id: 3, label: 'Baccara Pro', icon: '🃏',
              preview: `𝐁𝐀𝐂𝐂𝐀𝐑𝐀 𝐏𝐑𝐎 ✨\n🎮GAME: #N${G}\n🃏Carte ♠️:⌛\nMode: Dogon ${maxRattrapage}`,
              result:  `𝐁𝐀𝐂𝐂𝐀𝐑𝐀 𝐏𝐑𝐎 ✨\n🎮GAME: #N${G}\n🃏Carte ♠️:✅ ${RE[0]}\nMode: Dogon ${maxRattrapage}`,
              perdu:   `𝐁𝐀𝐂𝐂𝐀𝐑𝐀 𝐏𝐑𝐎 ✨\n🎮GAME: #N${G}\n🃏Carte ♠️:❌\nMode: Dogon ${maxRattrapage}`,
            },
            {
              id: 4, label: 'Prédiction', icon: '🎰',
              preview: `🎰 PRÉDICTION #${G}\n🎯 Couleur: ♠️ Pique\n📊 Statut: En cours ⏳\n🔍 Vérification en cours`,
              result:  `🎰 PRÉDICTION #${G}\n🎯 Couleur: ♠️ Pique\n📊 Statut: ✅ ${RE[0]}\n🔍 Vérifié ✓`,
              perdu:   `🎰 PRÉDICTION #${G}\n🎯 Couleur: ♠️ Pique\n📊 Statut: ❌\n🔍 Résultat final`,
            },
            {
              id: 5, label: 'Barre de progression', icon: '🟦',
              preview: `🎰 PRÉDICTION #${G}\n🎯 Couleur: ♠️ Pique\n\n🔍 Vérification jeu #${G}\n${barP}\n⏳ Analyse...`,
              result:  `🎰 PRÉDICTION #${G}\n🎯 Couleur: ♠️ Pique\n\n🔍 Vérification jeu #${G}\n🟩${barP.slice(2)}\n✅ ${RE[0]}`,
              perdu:   `🎰 PRÉDICTION #${G}\n🎯 Couleur: ♠️ Pique\n\n🔍 Vérification jeu #${G}\n${barLost}\n❌`,
            },
            {
              id: 6, label: 'Classique', icon: '✨',
              preview: `🏆 PRÉDICTION #${G}\n\n🎯 Couleur: ♠️ Pique\n⏳ Statut: En cours`,
              result:  `🏆 PRÉDICTION #${G}\n\n🎯 Couleur: ♠️ Pique\n✅ Statut: ✅ ${RE[0]}`,
              perdu:   `🏆 PRÉDICTION #${G}\n\n🎯 Couleur: ♠️ Pique\nStatut: ❌`,
            },
            {
              id: 7, label: 'Joueur Carte', icon: '🃏',
              preview: `Le joueur recevra une carte ♠️ Pique\n\n⏳ En attente du résultat...`,
              result:  `Le joueur recevra une carte ♠️ Pique\n\n✅ GAGNÉ ${RE[0]}`,
              perdu:   `Le joueur recevra une carte ♠️ Pique\n\n❌`,
            },
          ];

          return (
            <div className="tg-admin-card" style={{ borderColor: 'rgba(34,197,94,0.4)' }}>
              <div className="tg-admin-header">
                <span className="tg-admin-icon">📋</span>
                <div style={{ flex: 1 }}>
                  <h2 className="tg-admin-title">Format des messages Telegram</h2>
                  <p className="tg-admin-sub">
                    Le message de prédiction est <strong>modifié en place</strong> après vérification (editMessage).
                    Choisissez le style et le nombre max de rattrapages autorisés.
                  </p>
                </div>
                {msgFormatMsg && (
                  <span style={{ fontSize: 13, fontWeight: 700, color: msgFormatMsg.startsWith('✅') ? '#22c55e' : '#f87171' }}>
                    {msgFormatMsg}
                  </span>
                )}
              </div>

              {/* ── Sélecteur de rattrapages max ── */}
              <div style={{
                display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap',
                background: 'rgba(250,204,21,0.06)', border: '1px solid rgba(250,204,21,0.2)',
                borderRadius: 10, padding: '14px 18px', marginTop: 12,
              }}>
                <div>
                  <div style={{ fontWeight: 700, color: '#fbbf24', fontSize: 13 }}>⚙️ Rattrapages max (Dogon)</div>
                  <div style={{ fontSize: 11, color: '#64748b', marginTop: 2 }}>
                    Nombre de jeux supplémentaires après la prédiction initiale. Affiché dans le message (ex: +²).
                  </div>
                </div>
                <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center', marginLeft: 'auto' }}>
                  {[0,5,10,15,20].map(n => (
                    <button
                      key={n}
                      onClick={() => saveMaxR(n)}
                      disabled={maxRSaving}
                      style={{
                        width: 44, height: 44, borderRadius: 8, border: 'none', cursor: 'pointer',
                        fontWeight: 800, fontSize: 14,
                        background: maxRattrapage === n ? '#f59e0b' : 'rgba(255,255,255,0.06)',
                        color: maxRattrapage === n ? '#000' : '#94a3b8',
                        transition: 'all 0.15s',
                      }}
                    >
                      {n}
                    </button>
                  ))}
                  <input
                    type="number" min="0" max="20" step="1"
                    value={maxRattrapage}
                    onChange={e => { const v = Math.max(0, Math.min(20, parseInt(e.target.value) || 0)); saveMaxR(v); }}
                    style={{
                      width: 56, height: 44, borderRadius: 8, border: '1px solid rgba(245,158,11,0.4)',
                      background: 'rgba(255,255,255,0.06)', color: '#fcd34d',
                      textAlign: 'center', fontWeight: 800, fontSize: 16,
                    }}
                  />
                </div>
                <div style={{ fontSize: 12, color: '#fbbf24', minWidth: 80 }}>
                  Actuel : <strong>R{maxRattrapage}</strong> ({maxRattrapage} rattrap.)
                </div>
              </div>

              {/* ── Grille des formats ── */}
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 14, marginTop: 16 }}>
                {FORMATS.map(fmt => {
                  const active = msgFormat === fmt.id;
                  return (
                    <button
                      key={fmt.id}
                      onClick={() => saveMsgFormat(fmt.id)}
                      disabled={msgFormatSaving}
                      style={{
                        textAlign: 'left', cursor: 'pointer',
                        background: active ? 'rgba(34,197,94,0.12)' : 'rgba(255,255,255,0.03)',
                        border: `2px solid ${active ? '#22c55e' : 'rgba(255,255,255,0.08)'}`,
                        borderRadius: 12, padding: '14px 16px',
                        transition: 'all 0.2s', position: 'relative',
                      }}
                    >
                      {active && (
                        <span style={{
                          position: 'absolute', top: 8, right: 10,
                          fontSize: 11, fontWeight: 700, color: '#22c55e',
                          background: 'rgba(34,197,94,0.15)', padding: '2px 8px', borderRadius: 20,
                        }}>✓ Actif</span>
                      )}
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
                        <span style={{ fontSize: 20 }}>{fmt.icon}</span>
                        <div>
                          <div style={{ fontWeight: 700, fontSize: 13, color: active ? '#22c55e' : '#e2e8f0' }}>{fmt.label}</div>
                          <div style={{ fontSize: 10, color: '#64748b' }}>Format #{fmt.id}</div>
                        </div>
                      </div>

                      <div style={{
                        background: '#1e2433', borderRadius: 8, padding: '10px 12px', marginBottom: 8,
                        border: '1px solid rgba(255,255,255,0.06)',
                      }}>
                        <div style={{ fontSize: 9, color: '#93c5fd', fontWeight: 700, marginBottom: 4, textTransform: 'uppercase', letterSpacing: 0.5 }}>Envoi initial (en attente) →</div>
                        <pre style={{ margin: 0, fontSize: '0.7rem', color: '#cbd5e1', fontFamily: 'inherit', whiteSpace: 'pre-wrap', lineHeight: 1.55 }}>{fmt.preview}</pre>
                      </div>

                      <div style={{
                        background: '#1a2a1a', borderRadius: 8, padding: '10px 12px', marginBottom: 6,
                        border: '1px solid rgba(34,197,94,0.12)',
                      }}>
                        <div style={{ fontSize: 9, color: '#86efac', fontWeight: 700, marginBottom: 4, textTransform: 'uppercase', letterSpacing: 0.5 }}>✅ Après vérif. — Gagné R0 →</div>
                        <pre style={{ margin: 0, fontSize: '0.7rem', color: '#86efac', fontFamily: 'inherit', whiteSpace: 'pre-wrap', lineHeight: 1.55 }}>{fmt.result}</pre>
                      </div>

                      <div style={{
                        background: '#2a1a1a', borderRadius: 8, padding: '10px 12px',
                        border: '1px solid rgba(239,68,68,0.15)',
                      }}>
                        <div style={{ fontSize: 9, color: '#fca5a5', fontWeight: 700, marginBottom: 4, textTransform: 'uppercase', letterSpacing: 0.5 }}>❌ Après vérif. — Perdu →</div>
                        <pre style={{ margin: 0, fontSize: '0.7rem', color: '#fca5a5', fontFamily: 'inherit', whiteSpace: 'pre-wrap', lineHeight: 1.55 }}>{fmt.perdu}</pre>
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>
          );
        })()}

        </>}

        {/* ════════════════════════════════════════════════
            ── TAB : STRATÉGIES ──
        ════════════════════════════════════════════════ */}
        {adminTab === 'strategies' && <>

        {/* ── STRATÉGIES EXISTANTES ── */}
        <div className="tg-admin-card" style={{ borderColor: 'rgba(168,85,247,0.4)', marginBottom: 20 }}>
          <div className="tg-admin-header">
            <span className="tg-admin-icon">📋</span>
            <div style={{ flex: 1 }}>
              <h2 className="tg-admin-title">Stratégies existantes</h2>
              <p className="tg-admin-sub">
                Cliquez sur <strong style={{ color: '#e2e8f0' }}>✏️</strong> pour modifier une stratégie — le formulaire ci-dessous se pré-remplira automatiquement.
              </p>
            </div>
            <span className="tg-badge-connected">{strategies.length} stratégie{strategies.length !== 1 ? 's' : ''}</span>
          </div>

          {/* Liste des stratégies existantes */}
          {strategies.length > 0 && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginTop: 16 }}>
              {strategies.map(s => (
                <div key={s.id} style={{
                  display: 'flex', alignItems: 'center', gap: 12,
                  background: 'rgba(168,85,247,0.06)', border: '1px solid rgba(168,85,247,0.2)',
                  borderRadius: 10, padding: '12px 16px',
                }}>
                  <div style={{ fontSize: 22 }}>⚙️</div>
                  <div style={{ flex: 1 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                      <span style={{ fontWeight: 700, color: '#e2e8f0', fontSize: 15 }}>{s.name}</span>
                      <span style={{ fontSize: 11, color: '#a855f7', fontWeight: 600 }}>S{s.id}</span>
                      <span style={{ fontSize: 11, padding: '2px 7px', borderRadius: 5, fontWeight: 600,
                        background: s.visibility === 'all' ? 'rgba(34,197,94,0.15)' : 'rgba(100,100,120,0.2)',
                        color: s.visibility === 'all' ? '#22c55e' : '#94a3b8',
                      }}>{s.visibility === 'all' ? '🌐 Tous' : '🔒 Admin'}</span>
                      {/* Badge type : Simple vs Telegram */}
                      {s.tg_targets?.some(t => t.bot_token && t.channel_id) ? (
                        <span style={{ fontSize: 11, padding: '2px 8px', borderRadius: 5, fontWeight: 700,
                          background: 'rgba(34,158,217,0.18)', color: '#229ed9', border: '1px solid rgba(34,158,217,0.4)',
                        }} title={s.tg_targets.map(t => t.channel_id).join(', ')}>
                          ✈️ Telegram · {s.tg_targets.length} cible{s.tg_targets.length > 1 ? 's' : ''}
                        </span>
                      ) : (
                        <span style={{ fontSize: 11, padding: '2px 8px', borderRadius: 5, fontWeight: 700,
                          background: 'rgba(168,85,247,0.12)', color: '#a855f7', border: '1px solid rgba(168,85,247,0.3)',
                        }}>🧮 Local</span>
                      )}
                    </div>
                    {Array.isArray(s.exceptions) && s.exceptions.length > 0 && (
                      <span style={{ fontSize: 11, padding: '2px 7px', borderRadius: 5, fontWeight: 600,
                        background: 'rgba(239,68,68,0.15)', color: '#f87171', border: '1px solid rgba(239,68,68,0.3)',
                      }} title={s.exceptions.map(e => e.type).join(', ')}>
                        ⛔ {s.exceptions.length} exception{s.exceptions.length > 1 ? 's' : ''}
                      </span>
                    )}
                    <div style={{ fontSize: 12, color: '#94a3b8', marginTop: 3 }}>
                      {(() => {
                        const mLabel = s.mode === 'manquants' ? 'Absences'
                          : s.mode === 'apparents' ? 'Apparitions'
                          : s.mode === 'absence_apparition' ? 'Abs→App'
                          : s.mode === 'apparition_absence' ? 'App→Abs'
                          : s.mode === 'taux_miroir' ? '⚖️ Miroir'
                          : s.mode;
                        const isAutoMode = s.mode === 'absence_apparition' || s.mode === 'apparition_absence';
                        const mappingStr = isAutoMode ? 'prédit costume déclencheur'
                          : Object.entries(s.mappings || {}).map(([k,v]) => { const pool = Array.isArray(v) ? v : [v]; return `${k}→${pool.join('/')}${pool.length > 1 ? '↻' : ''}`; }).join('  ');
                        return `B≥${s.threshold} · ${mLabel} · ${mappingStr}`;
                      })()}
                    </div>
                    {s.tg_targets?.some(t => t.bot_token && t.channel_id) && (
                      <div style={{ fontSize: 11, color: '#64748b', marginTop: 2 }}>
                        Canaux : {s.tg_targets.filter(t=>t.channel_id).map(t => t.channel_id).join(', ')}
                      </div>
                    )}
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 6, alignItems: 'flex-end', flexShrink: 0 }}>
                    <div style={{ display: 'flex', gap: 6 }}>
                      <button
                        onClick={() => toggleStrat(s)}
                        style={{ fontSize: 11, padding: '4px 10px', borderRadius: 6, border: 'none', cursor: 'pointer', fontWeight: 600,
                          background: s.enabled ? 'rgba(34,197,94,0.2)' : 'rgba(100,100,120,0.2)',
                          color: s.enabled ? '#22c55e' : '#6b7280',
                        }}
                      >{s.enabled ? '● Actif' : '○ Inactif'}</button>
                      <button className="btn btn-ghost btn-sm" onClick={() => openEdit(s)} title="Modifier">✏️</button>
                      <button className="btn btn-ghost btn-sm" onClick={() => openClone(s)} title="Dupliquer cette stratégie" style={{ color: '#a78bfa' }}>📋</button>
                      <button className="btn btn-danger btn-sm" onClick={() => deleteStrat(s.id, s.name)} title="Supprimer">🗑️</button>
                    </div>
                    {!s.tg_targets?.some(t => t.bot_token && t.channel_id) && (
                      <button
                        onClick={() => setAdminTab('canaux')}
                        style={{
                          fontSize: 11, padding: '5px 12px', borderRadius: 7, cursor: 'pointer', fontWeight: 700,
                          background: 'rgba(34,158,217,0.15)', color: '#229ed9',
                          border: '1px solid rgba(34,158,217,0.45)', whiteSpace: 'nowrap',
                          display: 'flex', alignItems: 'center', gap: 5,
                        }}
                        title="Aller dans Canaux Telegram pour configurer le token bot"
                      >
                        ✈️ Config. Canaux
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}

          {strategies.length === 0 && (
            <div style={{ textAlign: 'center', color: '#6b7280', padding: '28px 0', fontSize: 14 }}>
              Aucune stratégie personnalisée — utilisez le formulaire ci-dessous pour en créer une.
            </div>
          )}
        </div>

        {/* ── SÉQUENCES DE RELANCE ── */}
        <div className="tg-admin-card" style={{ borderColor: 'rgba(251,146,60,0.4)', marginBottom: 20 }}>
          <div className="tg-admin-header">
            <span className="tg-admin-icon">🔁</span>
            <div style={{ flex: 1 }}>
              <h2 className="tg-admin-title">Séquences de Relance</h2>
              <p className="tg-admin-sub">
                Sélectionnez les stratégies à surveiller et définissez combien de prédictions perdues déclenchent la prochaine relance automatique.
              </p>
            </div>
            {lossSequences.length > 0 && <span className="tg-badge-connected">{lossSequences.length} séquence{lossSequences.length > 1 ? 's' : ''}</span>}
          </div>

          {/* ── Liste des séquences existantes ── */}
          {lossSequences.length > 0 && (
            <div style={{ marginBottom: 20, display: 'flex', flexDirection: 'column', gap: 10 }}>
              {lossSequences.map(seq => (
                <div key={seq.id} style={{
                  background: seq.enabled ? 'rgba(251,146,60,0.07)' : 'rgba(100,100,120,0.05)',
                  border: `1px solid ${seq.enabled ? 'rgba(251,146,60,0.3)' : 'rgba(100,100,120,0.2)'}`,
                  borderRadius: 10, padding: '12px 16px',
                  display: 'flex', alignItems: 'flex-start', gap: 12,
                }}>
                  <div style={{ fontSize: 22, marginTop: 2 }}>🔁</div>
                  <div style={{ flex: 1 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginBottom: 6 }}>
                      <span style={{ fontWeight: 700, color: '#e2e8f0', fontSize: 14 }}>{seq.name}</span>
                      <span style={{
                        fontSize: 11, padding: '2px 8px', borderRadius: 5, fontWeight: 600,
                        background: seq.enabled ? 'rgba(34,197,94,0.15)' : 'rgba(100,100,120,0.2)',
                        color: seq.enabled ? '#22c55e' : '#94a3b8',
                      }}>{seq.enabled ? '✅ Active' : '⏸ Inactive'}</span>
                    </div>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                      {(seq.rules || []).map(rule => {
                        const defLabel = { C1: '♠ Pique Noir', C2: '♥ Cœur Rouge', C3: '♦ Carreau Doré', DC: '♣ Double Canal' };
                        const custLabel = strategies.find(s => `S${s.id}` === rule.strategy_id)?.name;
                        const label = defLabel[rule.strategy_id] || custLabel || rule.strategy_id;
                        return (
                          <span key={rule.strategy_id} style={{
                            fontSize: 12, padding: '3px 10px', borderRadius: 20, fontWeight: 600,
                            background: 'rgba(251,146,60,0.15)', color: '#fb923c',
                            border: '1px solid rgba(251,146,60,0.35)',
                          }}>
                            {label} — {rule.losses_threshold} perte{rule.losses_threshold > 1 ? 's' : ''}
                          </span>
                        );
                      })}
                    </div>
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 6, alignItems: 'flex-end' }}>
                    <button
                      onClick={async () => {
                        await fetch(`/api/admin/loss-sequences/${seq.id}`, {
                          method: 'PATCH', credentials: 'include',
                          headers: { 'Content-Type': 'application/json' },
                          body: JSON.stringify({ enabled: !seq.enabled }),
                        });
                        loadLossSequences();
                      }}
                      style={{ fontSize: 11, padding: '4px 10px', borderRadius: 6, border: '1px solid rgba(251,146,60,0.35)', background: 'transparent', color: '#fb923c', cursor: 'pointer', fontWeight: 600 }}
                    >{seq.enabled ? '⏸ Désactiver' : '▶ Activer'}</button>
                    <button
                      onClick={async () => {
                        if (!window.confirm(`Supprimer la séquence "${seq.name}" ?`)) return;
                        await fetch(`/api/admin/loss-sequences/${seq.id}`, { method: 'DELETE', credentials: 'include' });
                        loadLossSequences();
                      }}
                      style={{ fontSize: 11, padding: '4px 10px', borderRadius: 6, border: '1px solid rgba(239,68,68,0.35)', background: 'transparent', color: '#f87171', cursor: 'pointer', fontWeight: 600 }}
                    >🗑 Supprimer</button>
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* ── Formulaire de création ── */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            <div>
              <label style={{ display: 'block', color: '#94a3b8', fontSize: 12, marginBottom: 5 }}>Nom de la séquence</label>
              <input
                type="text"
                placeholder="ex: Relance après 3 pertes"
                value={lossSeqName}
                onChange={e => setLossSeqName(e.target.value)}
                style={{ width: '100%', padding: '9px 12px', background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(251,146,60,0.35)', borderRadius: 8, color: '#fff', fontSize: 14, boxSizing: 'border-box' }}
              />
            </div>

            <div>
              <label style={{ display: 'block', color: '#94a3b8', fontSize: 12, marginBottom: 10 }}>
                Stratégies à surveiller — cochez et définissez le nombre de pertes consécutives avant relance
              </label>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {[
                  { id: 'C1', label: '♠ Pique Noir (C1)' },
                  { id: 'C2', label: '♥ Cœur Rouge (C2)' },
                  { id: 'C3', label: '♦ Carreau Doré (C3)' },
                  { id: 'DC', label: '♣ Double Canal (DC)' },
                  ...strategies.map(s => ({ id: `S${s.id}`, label: `${s.name} (S${s.id})` })),
                ].map(({ id, label }) => {
                  const checked = id in lossSeqRules;
                  const thr = lossSeqRules[id] || 2;
                  return (
                    <div key={id} style={{
                      display: 'flex', alignItems: 'center', gap: 12,
                      background: checked ? 'rgba(251,146,60,0.08)' : 'rgba(255,255,255,0.02)',
                      border: `1px solid ${checked ? 'rgba(251,146,60,0.3)' : 'rgba(255,255,255,0.07)'}`,
                      borderRadius: 8, padding: '10px 14px', transition: 'all 0.15s',
                    }}>
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={e => {
                          setLossSeqRules(prev => {
                            const next = { ...prev };
                            if (e.target.checked) next[id] = 2;
                            else delete next[id];
                            return next;
                          });
                        }}
                        style={{ accentColor: '#fb923c', width: 16, height: 16, cursor: 'pointer', flexShrink: 0 }}
                      />
                      <span style={{ flex: 1, color: checked ? '#e2e8f0' : '#64748b', fontWeight: checked ? 600 : 400, fontSize: 13 }}>{label}</span>
                      {checked && (
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                          <span style={{ fontSize: 12, color: '#94a3b8', whiteSpace: 'nowrap' }}>Pertes avant relance :</span>
                          <input
                            type="number"
                            min={1}
                            max={20}
                            value={thr}
                            onChange={e => setLossSeqRules(prev => ({ ...prev, [id]: Math.max(1, parseInt(e.target.value) || 1) }))}
                            style={{ width: 60, padding: '5px 8px', background: 'rgba(251,146,60,0.1)', border: '1px solid rgba(251,146,60,0.4)', borderRadius: 6, color: '#fb923c', fontSize: 14, fontWeight: 700, textAlign: 'center' }}
                          />
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>

            {lossSeqMsg && (
              <div style={{ padding: '8px 14px', borderRadius: 8, fontSize: 13, fontWeight: 600,
                background: lossSeqMsg.error ? 'rgba(239,68,68,0.15)' : 'rgba(34,197,94,0.15)',
                color: lossSeqMsg.error ? '#f87171' : '#4ade80',
                border: `1px solid ${lossSeqMsg.error ? 'rgba(239,68,68,0.3)' : 'rgba(34,197,94,0.3)'}`,
              }}>{lossSeqMsg.text || lossSeqMsg}</div>
            )}

            <button
              disabled={lossSeqSaving || !lossSeqName.trim() || Object.keys(lossSeqRules).length === 0}
              onClick={async () => {
                setLossSeqSaving(true);
                try {
                  const rules = Object.entries(lossSeqRules).map(([strategy_id, losses_threshold]) => ({ strategy_id, losses_threshold }));
                  const r = await fetch('/api/admin/loss-sequences', {
                    method: 'POST', credentials: 'include',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ name: lossSeqName.trim(), rules, enabled: true }),
                  });
                  if (!r.ok) { const d = await r.json(); throw new Error(d.error || 'Erreur'); }
                  setLossSeqName('');
                  setLossSeqRules({});
                  setLossSeqMsg('✅ Séquence créée avec succès');
                  setTimeout(() => setLossSeqMsg(''), 3500);
                  loadLossSequences();
                } catch (e) {
                  setLossSeqMsg({ text: '❌ ' + e.message, error: true });
                  setTimeout(() => setLossSeqMsg(''), 4000);
                }
                setLossSeqSaving(false);
              }}
              style={{
                alignSelf: 'flex-end',
                background: Object.keys(lossSeqRules).length > 0 && lossSeqName.trim()
                  ? 'linear-gradient(135deg,#c2410c,#fb923c)' : 'rgba(100,100,120,0.2)',
                color: '#fff', border: 'none', borderRadius: 8,
                padding: '10px 24px', fontWeight: 700, fontSize: 14, cursor: 'pointer',
                opacity: lossSeqSaving || !lossSeqName.trim() || Object.keys(lossSeqRules).length === 0 ? 0.5 : 1,
              }}
            >
              {lossSeqSaving ? '⏳ Enregistrement…' : `🔁 Créer la séquence (${Object.keys(lossSeqRules).length} stratégie${Object.keys(lossSeqRules).length > 1 ? 's' : ''})`}
            </button>
          </div>
        </div>

        {/* ── FORMULAIRE CRÉATION / MODIFICATION ── */}
        <div id="strat-form-card" className="tg-admin-card" style={{ borderColor: stratEditing !== null ? 'rgba(168,85,247,0.6)' : 'rgba(34,197,94,0.4)' }}>

          <div className="tg-admin-header">
            <span className="tg-admin-icon" style={{ fontSize: 24 }}>{stratEditing !== null ? '✏️' : '➕'}</span>
            <div style={{ flex: 1 }}>
              <h2 className="tg-admin-title">
                {stratEditing !== null ? `Modifier la stratégie S${stratEditing}` : 'Créer une nouvelle stratégie'}
              </h2>
              <p className="tg-admin-sub">
                {stratEditing !== null
                  ? 'Les modifications n\'affectent que cette stratégie. Cliquez sur «\u00a0Annuler\u00a0» pour revenir au mode création.'
                  : 'Configurez chaque paramètre puis cliquez sur «\u00a0Créer la stratégie\u00a0» pour l\'activer.'}
              </p>
            </div>
            {stratEditing !== null && (
              <button className="btn btn-ghost btn-sm" onClick={cancelStratForm}>✕ Annuler</button>
            )}
          </div>

          {stratMsg && (
            <div className={`tg-alert ${stratMsg.error ? 'tg-alert-error' : 'tg-alert-ok'}`} style={{ margin: '0 20px 4px' }}>{stratMsg.text}</div>
          )}

              <div style={{ padding: 20 }}>

              {/* ══════════════ SECTION 1 — ALGORITHME ══════════════ */}
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 14 }}>
                <div style={{ flex: 1, height: 1, background: 'rgba(168,85,247,0.25)' }} />
                <span style={{ fontSize: 10, fontWeight: 800, color: '#a855f7', letterSpacing: 1.5, textTransform: 'uppercase' }}>① Algorithme de prédiction</span>
                <div style={{ flex: 1, height: 1, background: 'rgba(168,85,247,0.25)' }} />
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
                {/* Nom */}
                <div style={{ gridColumn: '1 / -1' }}>
                  <label style={{ display: 'block', color: '#94a3b8', fontSize: 12, marginBottom: 5 }}>Nom de la stratégie *</label>
                  <input type="text" maxLength={40} placeholder="ex: Alpha, Nexus, Fusion…"
                    value={stratForm.name}
                    onChange={e => setStratForm(p => ({ ...p, name: e.target.value }))}
                    style={{ width: '100%', padding: '8px 12px', background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(168,85,247,0.35)', borderRadius: 8, color: '#fff', fontSize: 14, boxSizing: 'border-box' }}
                  />
                </div>

                {/* Main à surveiller : Joueur / Banquier */}
                <div style={{ gridColumn: '1 / -1' }}>
                  <label style={{ display: 'block', color: '#94a3b8', fontSize: 12, marginBottom: 6 }}>Main à surveiller</label>
                  <div style={{ display: 'flex', gap: 10 }}>
                    {[
                      { val: 'joueur',   icon: '🧑', label: 'Joueur',   desc: 'Analyse les cartes du Joueur' },
                      { val: 'banquier', icon: '🏦', label: 'Banquier', desc: 'Analyse les cartes du Banquier' },
                    ].map(opt => {
                      const active = (stratForm.hand || 'joueur') === opt.val;
                      return (
                        <button key={opt.val} type="button"
                          onClick={() => setStratForm(p => ({ ...p, hand: opt.val }))}
                          style={{
                            flex: 1, textAlign: 'left', padding: '10px 14px', borderRadius: 10, cursor: 'pointer',
                            background: active ? 'rgba(168,85,247,0.18)' : 'rgba(255,255,255,0.03)',
                            border: `2px solid ${active ? '#a855f7' : 'rgba(255,255,255,0.08)'}`,
                            transition: 'all 0.15s',
                          }}>
                          <div style={{ fontSize: 18, marginBottom: 2 }}>{opt.icon}</div>
                          <div style={{ fontWeight: 700, fontSize: 12, color: active ? '#e2e8f0' : '#64748b', marginBottom: 2 }}>{opt.label}</div>
                          <div style={{ fontSize: 10, color: '#475569', lineHeight: 1.4 }}>{opt.desc}</div>
                        </button>
                      );
                    })}
                  </div>
                </div>

                {/* Mode */}
                <div>
                  <label style={{ display: 'block', color: '#94a3b8', fontSize: 12, marginBottom: 5 }}>Mode</label>
                  <select value={stratForm.mode} onChange={e => {
                    const m = e.target.value;
                    const isNew = m === 'absence_apparition' || m === 'apparition_absence';
                    setStratForm(p => ({
                      ...p,
                      mode: m,
                      ...(isNew ? { threshold: Math.max(p.threshold, 4), max_rattrapage: 20 } : {}),
                    }));
                  }}
                    style={{ width: '100%', padding: '8px 12px', background: '#1e1b2e', border: '1px solid rgba(168,85,247,0.35)', borderRadius: 8, color: '#fff', fontSize: 13 }}>
                    <option value="manquants">Manquants — prédit l'absent</option>
                    <option value="apparents">Apparents — prédit le fréquent</option>
                    <option value="absence_apparition">Absence → Apparition</option>
                    <option value="apparition_absence">Apparition → Absence</option>
                    <option value="taux_miroir">⚖️ Miroir Taux</option>
                  </select>
                  {stratForm.mode === 'absence_apparition' && (
                    <div style={{ marginTop: 8, padding: '10px 14px', borderRadius: 8, background: 'rgba(34,197,94,0.08)', border: '1px solid rgba(34,197,94,0.25)', fontSize: 12, color: '#86efac', lineHeight: 1.6 }}>
                      ⚡ Dès qu'un costume absent depuis ≥ B jeux réapparaît dans la main (même avant la fin du tirage), il est prédit automatiquement pour le jeu suivant. Pas de mapping — la prédiction est toujours le costume déclencheur.
                    </div>
                  )}
                  {stratForm.mode === 'apparition_absence' && (
                    <div style={{ marginTop: 8, padding: '10px 14px', borderRadius: 8, background: 'rgba(245,158,11,0.08)', border: '1px solid rgba(245,158,11,0.3)', fontSize: 12, color: '#fcd34d', lineHeight: 1.6 }}>
                      ⚡ Dès qu'un costume présent depuis ≥ B jeux consécutifs disparaît de la main, la <strong>carte configurée dans le mapping</strong> est prédite automatiquement pour le jeu suivant (déclenchement en temps réel, avant la fin officielle du jeu).
                    </div>
                  )}
                  {stratForm.mode === 'taux_miroir' && (
                    <div style={{ marginTop: 8, padding: '12px 14px', borderRadius: 8, background: 'rgba(99,102,241,0.08)', border: '1px solid rgba(99,102,241,0.35)', fontSize: 12, color: '#a5b4fc', lineHeight: 1.8 }}>
                      <div style={{ fontWeight: 700, marginBottom: 6, fontSize: 13 }}>⚖️ Mode Miroir Taux — Comment ça fonctionne ?</div>
                      <div>Le moteur compte le <strong>nombre total d'apparitions</strong> de chaque costume (chaque carte compte : une main ♠♠ = +2 pour Pique).</div>
                      <div style={{ marginTop: 6 }}>Dès qu'un costume <strong>dépasse un autre de B apparitions</strong>, le costume "en retard" est prédit selon le mapping configuré. Les compteurs remettent à zéro après chaque déclenchement.</div>
                      <div style={{ marginTop: 6, padding: '6px 10px', background: 'rgba(99,102,241,0.12)', borderRadius: 6, fontFamily: 'monospace', fontSize: 11 }}>
                        Ex. B=5 · ♠:8 ♥:3 → écart ♠-♥=5 ≥ 5 → prédit ♥ (ou son mapping) → remise à zéro
                      </div>
                    </div>
                  )}
                </div>

                {/* Seuil B / Différence */}
                <div style={stratForm.mode === 'taux_miroir' ? { gridColumn: '1 / -1' } : {}}>
                  {stratForm.mode === 'taux_miroir' ? (
                    <div>
                      <label style={{ display: 'block', color: '#94a3b8', fontSize: 12, marginBottom: 8, fontWeight: 600 }}>
                        ⚖️ Différence déclenchante — choisir l'écart entre costumes
                      </label>
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                        {[1, 2, 3, 4, 5, 6, 7, 8, 10, 12, 15, 20].map(n => {
                          const active = stratForm.threshold === n;
                          return (
                            <button key={n} type="button"
                              onClick={() => setStratForm(p => ({ ...p, threshold: n }))}
                              style={{
                                width: 48, height: 44, borderRadius: 10, cursor: 'pointer',
                                fontWeight: 800, fontSize: 15,
                                border: active ? '2px solid #6366f1' : '1px solid rgba(99,102,241,0.25)',
                                background: active ? 'rgba(99,102,241,0.28)' : 'rgba(99,102,241,0.06)',
                                color: active ? '#a5b4fc' : '#475569',
                                transition: 'all 0.15s',
                                boxShadow: active ? '0 0 10px rgba(99,102,241,0.35)' : 'none',
                              }}>
                              {n}
                            </button>
                          );
                        })}
                      </div>
                      <div style={{ marginTop: 10, padding: '8px 12px', background: 'rgba(99,102,241,0.08)', borderRadius: 8, fontSize: 11, color: '#94a3b8', lineHeight: 1.6 }}>
                        Sélectionné : <strong style={{ color: '#a5b4fc', fontSize: 13 }}>{stratForm.threshold}</strong>
                        {' '}&nbsp;— dès qu'un costume dépasse un autre de <strong style={{ color: '#a5b4fc' }}>{stratForm.threshold}</strong> apparitions, la prédiction est déclenchée.
                        <br />Ex. <span style={{ fontFamily: 'monospace' }}>♠:{stratForm.threshold + 3} ♥:{3} → écart={stratForm.threshold} → prédit ♥</span>
                      </div>
                    </div>
                  ) : (
                    <div>
                      <label style={{ display: 'block', color: '#94a3b8', fontSize: 12, marginBottom: 5 }}>
                        {(stratForm.mode === 'absence_apparition' || stratForm.mode === 'apparition_absence')
                          ? 'Minimum B (≥4 requis)'
                          : 'Seuil B (1–50)'}
                      </label>
                      <input type="number"
                        min={(stratForm.mode === 'absence_apparition' || stratForm.mode === 'apparition_absence') ? 4 : 1}
                        max={50} value={stratForm.threshold}
                        onChange={e => {
                          const min = (stratForm.mode === 'absence_apparition' || stratForm.mode === 'apparition_absence') ? 4 : 1;
                          setStratForm(p => ({ ...p, threshold: Math.max(min, parseInt(e.target.value) || min) }));
                        }}
                        style={{ width: '100%', padding: '8px 12px', background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(168,85,247,0.35)', borderRadius: 8, color: '#fff', fontSize: 14 }}
                      />
                    </div>
                  )}
                </div>

                {/* ── Sélecteur de paires — MODE MIROIR UNIQUEMENT ── */}
                {stratForm.mode === 'taux_miroir' && (
                  <div style={{ gridColumn: '1 / -1' }}>
                    <label style={{ display: 'block', color: '#94a3b8', fontSize: 12, marginBottom: 8, fontWeight: 600 }}>
                      🎯 Paires à surveiller — cliquez pour activer, puis définissez l'écart déclencheur par paire
                    </label>

                    {/* Boutons toggle des 6 paires */}
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 12 }}>
                      {MIRROR_PAIRS.map(pair => {
                        const mp = stratForm.mirror_pairs || [];
                        const activePair = mp.find(p => (p.a === pair.a && p.b === pair.b) || (p.a === pair.b && p.b === pair.a));
                        const active = !!activePair;
                        return (
                          <button key={`${pair.a}|${pair.b}`} type="button"
                            onClick={() => {
                              setStratForm(prev => {
                                const cur = prev.mirror_pairs || [];
                                const exists = cur.find(p => (p.a === pair.a && p.b === pair.b) || (p.a === pair.b && p.b === pair.a));
                                const next = exists
                                  ? cur.filter(p => !((p.a === pair.a && p.b === pair.b) || (p.a === pair.b && p.b === pair.a)))
                                  : [...cur, { a: pair.a, b: pair.b, threshold: null }];
                                return { ...prev, mirror_pairs: next };
                              });
                            }}
                            style={{
                              padding: '9px 14px', borderRadius: 10, cursor: 'pointer',
                              fontWeight: active ? 800 : 500, fontSize: 13,
                              border: active ? '2px solid #6366f1' : '1px solid rgba(99,102,241,0.25)',
                              background: active ? 'rgba(99,102,241,0.28)' : 'rgba(99,102,241,0.06)',
                              color: active ? '#a5b4fc' : '#64748b',
                              transition: 'all 0.15s',
                              boxShadow: active ? '0 0 12px rgba(99,102,241,0.3)' : 'none',
                              display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 1,
                            }}>
                            <span style={{ fontSize: 14 }}>{pair.label}</span>
                            <span style={{ fontSize: 9, opacity: 0.75 }}>{pair.desc}</span>
                          </button>
                        );
                      })}
                    </div>

                    {/* Seuil par paire — visible seulement pour les paires activées */}
                    {(stratForm.mirror_pairs || []).length > 0 && (
                      <div style={{ marginBottom: 12 }}>
                        <div style={{ fontSize: 11, color: '#6366f1', fontWeight: 700, marginBottom: 8, letterSpacing: 0.5 }}>
                          ⚙️ ÉCART DÉCLENCHEUR PAR PAIRE
                        </div>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
                          {(stratForm.mirror_pairs || []).map(p => {
                            const pairDef = MIRROR_PAIRS.find(mp => (mp.a === p.a && mp.b === p.b) || (mp.a === p.b && mp.b === p.a));
                            return (
                              <div key={`${p.a}|${p.b}`} style={{
                                display: 'flex', alignItems: 'center', gap: 12,
                                padding: '8px 14px', borderRadius: 9,
                                background: 'rgba(99,102,241,0.1)', border: '1px solid rgba(99,102,241,0.3)',
                              }}>
                                <span style={{ fontWeight: 700, fontSize: 14, color: '#a5b4fc', minWidth: 80 }}>
                                  {p.a} vs {p.b}
                                </span>
                                <span style={{ fontSize: 11, color: '#64748b', flex: 1 }}>
                                  {pairDef?.desc}
                                </span>
                                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                                  <label style={{ fontSize: 11, color: '#94a3b8', whiteSpace: 'nowrap' }}>Écart :</label>
                                  <input
                                    type="number" min="1" max="50"
                                    placeholder={`(global: ${stratForm.threshold})`}
                                    value={p.threshold ?? ''}
                                    onChange={e => {
                                      setStratForm(prev => ({
                                        ...prev,
                                        mirror_pairs: prev.mirror_pairs.map(mp =>
                                          (mp.a === p.a && mp.b === p.b)
                                            ? { ...mp, threshold: e.target.value === '' ? null : parseInt(e.target.value) }
                                            : mp
                                        ),
                                      }));
                                    }}
                                    style={{
                                      width: 80, padding: '5px 8px', borderRadius: 7,
                                      background: '#1e1b2e', border: '1px solid rgba(99,102,241,0.5)',
                                      color: '#a5b4fc', fontSize: 13, fontWeight: 700, textAlign: 'center',
                                    }}
                                  />
                                  {!p.threshold && (
                                    <span style={{ fontSize: 10, color: '#475569', whiteSpace: 'nowrap' }}>
                                      ↳ seuil global ({stratForm.threshold})
                                    </span>
                                  )}
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    )}

                    <div style={{ padding: '7px 12px', borderRadius: 8, background: 'rgba(99,102,241,0.07)', border: '1px solid rgba(99,102,241,0.2)', fontSize: 11, color: '#94a3b8', lineHeight: 1.6 }}>
                      {(stratForm.mirror_pairs || []).length === 0
                        ? '🔍 Aucune sélection = toutes les paires sont surveillées avec le seuil global'
                        : `🎯 ${(stratForm.mirror_pairs || []).map(p => `${p.a} vs ${p.b} (écart: ${p.threshold ?? stratForm.threshold})`).join(' · ')}`
                      }
                    </div>
                  </div>
                )}

                {/* Numéro à prédire (+1, +2, ...) */}
                <div style={{ gridColumn: '1 / -1' }}>
                  <label style={{ display: 'block', color: '#94a3b8', fontSize: 12, marginBottom: 6 }}>
                    Jeu à prédire — combien de parties après le signal
                  </label>
                  <div style={{ display: 'flex', gap: 6 }}>
                    {[1,2,3,4,5,6,7,8].map(n => {
                      const active = (stratForm.prediction_offset || 1) === n;
                      return (
                        <button key={n} type="button"
                          onClick={() => setStratForm(p => ({ ...p, prediction_offset: n }))}
                          style={{
                            flex: 1, padding: '8px 4px', borderRadius: 8, cursor: 'pointer', fontWeight: 700, fontSize: 13,
                            border: active ? '2px solid #a855f7' : '1px solid rgba(255,255,255,0.1)',
                            background: active ? 'rgba(168,85,247,0.25)' : 'rgba(255,255,255,0.04)',
                            color: active ? '#e2e8f0' : '#6b7280',
                            transition: 'all 0.15s',
                          }}>
                          +{n}
                        </button>
                      );
                    })}
                  </div>
                  {/* Explication dynamique selon la valeur choisie */}
                  {(() => {
                    const off = stratForm.prediction_offset || 1;
                    const exSignal = 70;
                    const exTarget = exSignal + off;
                    return (
                      <div style={{
                        marginTop: 10,
                        padding: '10px 14px',
                        borderRadius: 10,
                        background: 'rgba(168,85,247,0.08)',
                        border: '1px solid rgba(168,85,247,0.2)',
                        fontSize: 12,
                        color: '#c4b5fd',
                        lineHeight: 1.7,
                      }}>
                        <div style={{ fontWeight: 700, marginBottom: 4, color: '#a78bfa' }}>
                          📡 Décalage sélectionné : <span style={{ color: '#f0abfc' }}>+{off}</span>
                        </div>
                        <div>
                          Le signal se produit au jeu <strong style={{ color: '#e2e8f0' }}>#{exSignal}</strong>
                          {' '}→ la prédiction cible le jeu{' '}
                          <strong style={{ color: '#f0abfc' }}>#{exTarget}</strong>.
                        </div>
                        <div style={{ marginTop: 4, color: '#94a3b8', fontSize: 11 }}>
                          {off === 1
                            ? 'Idéal pour réagir dès la partie suivante (recommandé).'
                            : off <= 3
                            ? `La prédiction est émise ${off} parties à l'avance — laisse le temps de se préparer.`
                            : `Anticipation longue (+${off}) — adapté aux stratégies à signal lent.`}
                        </div>
                      </div>
                    );
                  })()}
                </div>

                {/* ── Rattrapages max par stratégie ── */}
                <div style={{ gridColumn: '1 / -1' }}>
                  <label style={{ display: 'block', color: '#94a3b8', fontSize: 12, marginBottom: 6 }}>
                    Rattrapages max — jeux supplémentaires si la carte prédite est absente
                  </label>
                  <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
                    {[0,5,10,15,20].map(n => {
                      const active = (stratForm.max_rattrapage ?? 20) === n;
                      return (
                        <button key={n} type="button"
                          onClick={() => setStratForm(p => ({ ...p, max_rattrapage: n }))}
                          style={{
                            width: 42, height: 38, borderRadius: 8, cursor: 'pointer', fontWeight: 700, fontSize: 13,
                            border: active ? '2px solid #f59e0b' : '1px solid rgba(255,255,255,0.1)',
                            background: active ? 'rgba(245,158,11,0.25)' : 'rgba(255,255,255,0.04)',
                            color: active ? '#fcd34d' : '#6b7280',
                            transition: 'all 0.15s',
                          }}>
                          {n}
                        </button>
                      );
                    })}
                    <input
                      type="number" min="0" max="20" step="1"
                      value={stratForm.max_rattrapage ?? 20}
                      onChange={e => { const v = Math.max(0, Math.min(20, parseInt(e.target.value) || 0)); setStratForm(p => ({ ...p, max_rattrapage: v })); }}
                      style={{
                        width: 54, height: 38, borderRadius: 8,
                        border: '1px solid rgba(245,158,11,0.4)',
                        background: 'rgba(255,255,255,0.06)', color: '#fcd34d',
                        textAlign: 'center', fontWeight: 800, fontSize: 15,
                      }}
                    />
                  </div>
                  <div style={{
                    marginTop: 8, padding: '9px 13px', borderRadius: 9,
                    background: 'rgba(245,158,11,0.07)', border: '1px solid rgba(245,158,11,0.2)',
                    fontSize: 11, color: '#d97706', lineHeight: 1.6,
                  }}>
                    {(() => {
                      const r = stratForm.max_rattrapage ?? 20;
                      if (r === 0) return '⚠️ Aucun rattrapage — la prédiction est vérifiée uniquement sur le jeu cible.';
                      return `🔄 Si la carte prédite n'apparaît pas, le moteur attend jusqu'à ${r} jeu${r > 1 ? 'x' : ''} supplémentaire${r > 1 ? 's' : ''} avant de marquer ❌.`;
                    })()}
                  </div>
                </div>

                {/* Visibilité */}
                <div>
                  <label style={{ display: 'block', color: '#94a3b8', fontSize: 12, marginBottom: 5 }}>Visibilité</label>
                  <select value={stratForm.visibility} onChange={e => setStratForm(p => ({ ...p, visibility: e.target.value }))}
                    style={{ width: '100%', padding: '8px 12px', background: '#1e1b2e', border: '1px solid rgba(168,85,247,0.35)', borderRadius: 8, color: '#fff', fontSize: 13 }}>
                    <option value="admin">🔒 Admin seulement</option>
                    <option value="all">🌐 Tous les utilisateurs</option>
                  </select>
                </div>

                {/* Activé */}
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <input type="checkbox" id="strat-enabled" checked={stratForm.enabled}
                    onChange={e => setStratForm(p => ({ ...p, enabled: e.target.checked }))}
                    style={{ width: 16, height: 16, accentColor: '#a855f7', cursor: 'pointer' }} />
                  <label htmlFor="strat-enabled" style={{ color: '#cbd5e1', fontSize: 13, cursor: 'pointer' }}>Activer immédiatement</label>
                </div>
              </div>

              {/* ══════════════ SECTION 2 — SÉQUENCES DE RELANCE ══════════════ */}
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, margin: '22px 0 14px' }}>
                <div style={{ flex: 1, height: 1, background: 'rgba(251,146,60,0.3)' }} />
                <span style={{ fontSize: 10, fontWeight: 800, color: '#fb923c', letterSpacing: 1.5, textTransform: 'uppercase' }}>② Séquences de Relance</span>
                <div style={{ flex: 1, height: 1, background: 'rgba(251,146,60,0.3)' }} />
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
                {/* Toggle activer */}
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <input type="checkbox" id="relance-enabled" checked={stratForm.relance_enabled}
                    onChange={e => setStratForm(p => ({ ...p, relance_enabled: e.target.checked }))}
                    style={{ width: 16, height: 16, accentColor: '#fb923c', cursor: 'pointer' }} />
                  <label htmlFor="relance-enabled" style={{ color: '#cbd5e1', fontSize: 13, cursor: 'pointer', fontWeight: 600 }}>
                    🔁 Activer les séquences de relance pour cette stratégie
                  </label>
                </div>

                {stratForm.relance_enabled && (<>
                  {/* Nombre de pertes avant relance */}
                  <div>
                    <label style={{ display: 'block', color: '#94a3b8', fontSize: 12, marginBottom: 8 }}>
                      Nombre de pertes consécutives avant relance
                    </label>
                    <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap' }}>
                      {Array.from({ length: 20 }, (_, i) => i + 1).map(n => {
                        const active = stratForm.relance_pertes === n;
                        return (
                          <button key={n} type="button"
                            onClick={() => setStratForm(p => ({ ...p, relance_pertes: n }))}
                            style={{
                              width: 38, height: 36, borderRadius: 7, cursor: 'pointer',
                              fontWeight: 700, fontSize: 12,
                              border: active ? '2px solid #fb923c' : '1px solid rgba(255,255,255,0.1)',
                              background: active ? 'rgba(251,146,60,0.25)' : 'rgba(255,255,255,0.04)',
                              color: active ? '#fb923c' : '#6b7280',
                              transition: 'all 0.15s',
                            }}>
                            {n}
                          </button>
                        );
                      })}
                    </div>
                    <div style={{ marginTop: 6, fontSize: 11, color: '#fb923c', opacity: 0.8 }}>
                      🔁 La relance se déclenche après <strong>{stratForm.relance_pertes}</strong> perte{stratForm.relance_pertes > 1 ? 's' : ''} consécutive{stratForm.relance_pertes > 1 ? 's' : ''}
                    </div>
                  </div>

                  {/* Types de rattrapage */}
                  <div>
                    <label style={{ display: 'block', color: '#94a3b8', fontSize: 12, marginBottom: 8 }}>
                      Types de rattrapage — cochez les niveaux à activer (1 à 20)
                    </label>
                    <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap' }}>
                      {Array.from({ length: 20 }, (_, i) => i + 1).map(n => {
                        const checked = (stratForm.relance_types || []).includes(n);
                        return (
                          <button key={n} type="button"
                            onClick={() => setStratForm(p => {
                              const cur = p.relance_types || [];
                              const next = checked ? cur.filter(x => x !== n) : [...cur, n].sort((a, b) => a - b);
                              return { ...p, relance_types: next };
                            })}
                            style={{
                              width: 38, height: 36, borderRadius: 7, cursor: 'pointer',
                              fontWeight: 700, fontSize: 12,
                              border: checked ? '2px solid #a855f7' : '1px solid rgba(255,255,255,0.1)',
                              background: checked ? 'rgba(168,85,247,0.25)' : 'rgba(255,255,255,0.04)',
                              color: checked ? '#c084fc' : '#6b7280',
                              transition: 'all 0.15s',
                            }}>
                            {n}
                          </button>
                        );
                      })}
                    </div>
                    {(stratForm.relance_types || []).length > 0 && (
                      <div style={{ marginTop: 6, fontSize: 11, color: '#a855f7', opacity: 0.85 }}>
                        ✅ Types actifs : {(stratForm.relance_types || []).join(', ')}
                      </div>
                    )}
                  </div>

                  {/* Nombre de rattrapages */}
                  <div style={{ gridColumn: '1 / -1' }}>
                    <label style={{ display: 'block', color: '#94a3b8', fontSize: 12, marginBottom: 8 }}>
                      Nombre de rattrapages
                    </label>
                    <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap', alignItems: 'center' }}>
                      {[1,2,3,5,10].map(n => {
                        const active = stratForm.relance_nombre === n;
                        return (
                          <button key={n} type="button"
                            onClick={() => setStratForm(p => ({ ...p, relance_nombre: n }))}
                            style={{
                              width: 42, height: 36, borderRadius: 7, cursor: 'pointer',
                              fontWeight: 700, fontSize: 13,
                              border: active ? '2px solid #22c55e' : '1px solid rgba(255,255,255,0.1)',
                              background: active ? 'rgba(34,197,94,0.2)' : 'rgba(255,255,255,0.04)',
                              color: active ? '#4ade80' : '#6b7280',
                              transition: 'all 0.15s',
                            }}>
                            {n}
                          </button>
                        );
                      })}
                      <input
                        type="number" min="1" max="50" step="1"
                        value={stratForm.relance_nombre}
                        onChange={e => setStratForm(p => ({ ...p, relance_nombre: Math.max(1, parseInt(e.target.value) || 1) }))}
                        style={{
                          width: 54, height: 36, borderRadius: 7,
                          border: '1px solid rgba(34,197,94,0.4)',
                          background: 'rgba(255,255,255,0.06)', color: '#4ade80',
                          textAlign: 'center', fontWeight: 800, fontSize: 15,
                        }}
                      />
                    </div>
                    <div style={{ marginTop: 6, fontSize: 11, color: '#4ade80', opacity: 0.8 }}>
                      🎯 Le moteur effectue <strong>{stratForm.relance_nombre}</strong> rattrapage{stratForm.relance_nombre > 1 ? 's' : ''} par séquence déclenchée
                    </div>
                  </div>
                </>)}
              </div>

              {/* ══════════════ SECTION 3 — TELEGRAM ══════════════ */}
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, margin: '22px 0 14px' }}>
                <div style={{ flex: 1, height: 1, background: 'rgba(34,158,217,0.3)' }} />
                <span style={{ fontSize: 10, fontWeight: 800, color: '#229ed9', letterSpacing: 1.5, textTransform: 'uppercase' }}>③ Envoi Telegram (optionnel)</span>
                <div style={{ flex: 1, height: 1, background: 'rgba(34,158,217,0.3)' }} />
              </div>

              {/* Telegram configuré via l'onglet Canaux Telegram */}
              <div style={{ padding: '10px 14px', borderRadius: 8, background: 'rgba(34,158,217,0.07)', border: '1px solid rgba(34,158,217,0.2)', fontSize: 12, color: '#64748b' }}>
                ✈️ La configuration du canal Telegram (token + ID) se fait dans l'onglet <strong style={{ color: '#229ed9' }}>Canaux Telegram</strong>.
              </div>

              {/* ══════════════ SECTION 4 — MAPPINGS ══════════════ */}
              {stratForm.mode !== 'absence_apparition' && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, margin: '22px 0 14px' }}>
                <div style={{ flex: 1, height: 1, background: 'rgba(148,163,184,0.2)' }} />
                <span style={{ fontSize: 10, fontWeight: 800, color: '#94a3b8', letterSpacing: 1.5, textTransform: 'uppercase' }}>④ Mappings de prédiction</span>
                <div style={{ flex: 1, height: 1, background: 'rgba(148,163,184,0.2)' }} />
              </div>
              )}

              {/* Presets de combinaison — masqué pour absence_apparition uniquement */}
              {stratForm.mode !== 'absence_apparition' && <div style={{ marginTop: 0 }}>
                <label style={{ display: 'block', color: '#94a3b8', fontSize: 12, marginBottom: 8 }}>Combinaison miroir (presets)</label>
                <div style={{ display: 'flex', gap: 7, flexWrap: 'wrap' }}>
                  {(PRESETS[stratForm.mode] || []).map((p, i) => {
                    const sel = JSON.stringify(stratForm.mappings) === JSON.stringify(p.map);
                    return (
                      <button key={i} title={p.desc}
                        onClick={() => setStratForm(prev => ({ ...prev, mappings: { ...p.map } }))}
                        style={{ padding: '6px 12px', borderRadius: 8, fontSize: 12, cursor: 'pointer',
                          background: sel ? 'rgba(168,85,247,0.25)' : 'rgba(255,255,255,0.05)',
                          border: `1px solid ${sel ? '#a855f7' : 'rgba(255,255,255,0.1)'}`,
                          color: sel ? '#e2e8f0' : '#94a3b8', fontWeight: sel ? 700 : 400 }}>
                        {p.label}
                        <span style={{ display: 'block', fontSize: 10, color: '#6b7280', marginTop: 1 }}>{p.desc}</span>
                      </button>
                    );
                  })}
                </div>
              </div>}

              {/* Mappings manuels — multi-sélection avec rotation — masqué pour absence_apparition uniquement */}
              {stratForm.mode !== 'absence_apparition' && <div style={{ marginTop: 16 }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
                  <label style={{ color: '#94a3b8', fontSize: 12 }}>
                    Cartes à prédire — cliquez pour sélectionner (1, 2 ou 3 max) :
                  </label>
                  <span style={{ fontSize: 10, color: '#6b7280', fontStyle: 'italic' }}>
                    ① → ② → ③ en rotation
                  </span>
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                  {SUITS.map(suit => {
                    const pool = Array.isArray(stratForm.mappings[suit]) ? stratForm.mappings[suit] : (stratForm.mappings[suit] ? [stratForm.mappings[suit]] : []);
                    const suitColor = ['♥','♦'].includes(suit) ? '#ef4444' : '#e2e8f0';
                    const toggleTarget = (target) => {
                      setStratForm(p => {
                        const cur = Array.isArray(p.mappings[suit]) ? [...p.mappings[suit]] : (p.mappings[suit] ? [p.mappings[suit]] : []);
                        const idx = cur.indexOf(target);
                        let next;
                        if (idx !== -1) {
                          next = cur.filter(x => x !== target);
                          if (next.length === 0) return p; // au moins 1 requis
                        } else {
                          if (cur.length >= 3) return p; // max 3
                          next = [...cur, target];
                        }
                        return { ...p, mappings: { ...p.mappings, [suit]: next } };
                      });
                    };
                    const ROTATION_LABELS = ['①','②','③'];
                    return (
                      <div key={suit} style={{ display: 'flex', alignItems: 'center', gap: 8,
                        background: 'rgba(255,255,255,0.03)', borderRadius: 8, padding: '8px 12px',
                        border: '1px solid rgba(255,255,255,0.07)' }}>
                        <span style={{ color: suitColor, fontSize: 20, minWidth: 24, fontWeight: 700 }}>{suit}</span>
                        <span style={{ color: '#4b5563', fontSize: 13 }}>→</span>
                        <div style={{ display: 'flex', gap: 5, flex: 1 }}>
                          {SUITS.map(target => {
                            const pos = pool.indexOf(target);
                            const selected = pos !== -1;
                            const tColor = ['♥','♦'].includes(target) ? '#f87171' : '#e2e8f0';
                            return (
                              <button key={target} type="button"
                                onClick={() => toggleTarget(target)}
                                style={{
                                  flex: 1, padding: '6px 4px', borderRadius: 7, cursor: 'pointer',
                                  border: selected ? '1px solid #a855f7' : '1px solid rgba(255,255,255,0.08)',
                                  background: selected ? 'rgba(168,85,247,0.25)' : 'rgba(255,255,255,0.04)',
                                  color: selected ? '#e2e8f0' : '#6b7280',
                                  fontWeight: selected ? 700 : 400,
                                  transition: 'all 0.15s',
                                  position: 'relative',
                                }}>
                                {selected && (
                                  <span style={{ position: 'absolute', top: 1, right: 3, fontSize: 9, color: '#a855f7', fontWeight: 700 }}>
                                    {ROTATION_LABELS[pos]}
                                  </span>
                                )}
                                <span style={{ color: tColor, fontSize: 16 }}>{target}</span>
                              </button>
                            );
                          })}
                        </div>
                        <div style={{ minWidth: 70, fontSize: 11, color: '#6b7280', textAlign: 'right' }}>
                          {pool.length === 1 && <span style={{ color: '#64748b' }}>fixe</span>}
                          {pool.length === 2 && <span style={{ color: '#a855f7' }}>rotation ×2</span>}
                          {pool.length === 3 && <span style={{ color: '#7c3aed' }}>rotation ×3</span>}
                        </div>
                      </div>
                    );
                  })}
                </div>
                <div style={{ marginTop: 6, fontSize: 10, color: '#4b5563', fontStyle: 'italic' }}>
                  Sélection unique = toujours cette carte · 2 cartes = alterne ①②①②… · 3 cartes = alterne ①②③①②③…
                </div>
              </div>}

              {/* ══════════════ SECTION 5 — EXCEPTIONS ══════════════ */}
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, margin: '22px 0 14px' }}>
                <div style={{ flex: 1, height: 1, background: 'rgba(239,68,68,0.25)' }} />
                <span style={{ fontSize: 10, fontWeight: 800, color: '#f87171', letterSpacing: 1.5, textTransform: 'uppercase' }}>⑤ Règles d'exception (optionnel)</span>
                <div style={{ flex: 1, height: 1, background: 'rgba(239,68,68,0.25)' }} />
              </div>

              {/* ── Section Exceptions ─────────────────────────────── */}
              <div style={{ padding: '14px 16px', background: 'rgba(239,68,68,0.05)', borderRadius: 10, border: '1px solid rgba(239,68,68,0.2)' }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
                  <div>
                    <span style={{ color: '#f87171', fontWeight: 700, fontSize: 13 }}>⛔ Règles d'exception</span>
                    <div style={{ color: '#6b7280', fontSize: 11, marginTop: 2 }}>Empêche l'émission d'une prédiction selon des conditions spécifiques</div>
                  </div>
                  <button
                    type="button"
                    onClick={() => setStratForm(p => ({
                      ...p,
                      exceptions: [...(p.exceptions || []), { type: 'consec_appearances', value: 2 }],
                    }))}
                    style={{ padding: '5px 12px', borderRadius: 7, background: 'rgba(239,68,68,0.15)',
                      border: '1px solid rgba(239,68,68,0.35)', color: '#f87171', fontSize: 12, cursor: 'pointer', fontWeight: 600 }}>
                    + Ajouter une exception
                  </button>
                </div>

                {(!stratForm.exceptions || stratForm.exceptions.length === 0) && (
                  <div style={{ color: '#4b5563', fontSize: 12, fontStyle: 'italic', textAlign: 'center', padding: '8px 0' }}>
                    Aucune exception — toutes les prédictions seront émises
                  </div>
                )}

                {(stratForm.exceptions || []).map((ex, i) => {
                  const setEx = (patch) => setStratForm(p => {
                    const updated = [...p.exceptions];
                    updated[i] = { ...updated[i], ...patch };
                    return { ...p, exceptions: updated };
                  });
                  const removeEx = () => setStratForm(p => ({
                    ...p, exceptions: p.exceptions.filter((_, j) => j !== i),
                  }));

                  const EX_OPTS = [
                    { val: 'consec_appearances', label: '🔁 Apparitions consécutives', desc: 'Bloquer si la carte prédite est apparue N fois de suite' },
                    { val: 'recent_frequency',   label: '📊 Fréquence récente',        desc: 'Bloquer si la carte prédite est apparue N fois sur W parties' },
                    { val: 'already_pending',    label: '⏳ Déjà en attente',           desc: 'Bloquer si une prédiction pour cette carte est déjà active' },
                    { val: 'max_consec_losses',  label: '📉 Série de défaites',         desc: 'Bloquer si les N dernières prédictions ont été perdues' },
                    { val: 'trigger_overload',   label: '⚡ Déclencheur surchargé',     desc: 'Bloquer si la carte déclencheur est trop fréquente (N fois/W parties)' },
                    { val: 'last_game_appeared', label: '🎯 Présente au dernier jeu',   desc: 'Bloquer si la carte prédite était présente dans la dernière partie' },
                    { val: 'time_window_block',  label: '🕐 Fenêtre horaire',           desc: 'Bloquer les prédictions pendant la 1ʳᵉ ou 2ᵉ moitié de chaque heure' },
                  ];

                  const needsValue  = ['consec_appearances', 'recent_frequency', 'max_consec_losses', 'trigger_overload'].includes(ex.type);
                  const needsWindow = ['recent_frequency', 'trigger_overload'].includes(ex.type);
                  const needsHalf   = ex.type === 'time_window_block';
                  const currentOpt  = EX_OPTS.find(o => o.val === ex.type);

                  return (
                    <div key={i} style={{ display: 'flex', flexDirection: 'column', gap: 6, padding: '10px 12px', marginBottom: 8,
                      background: 'rgba(239,68,68,0.07)', borderRadius: 8, border: '1px solid rgba(239,68,68,0.15)' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <select
                          value={ex.type}
                          onChange={e => setEx({ type: e.target.value, value: 2, window: 5 })}
                          style={{ flex: 1, padding: '6px 8px', background: '#1e1b2e', border: '1px solid rgba(239,68,68,0.3)',
                            borderRadius: 6, color: '#f1f5f9', fontSize: 12 }}>
                          {EX_OPTS.map(o => <option key={o.val} value={o.val}>{o.label}</option>)}
                        </select>
                        <button type="button" onClick={removeEx}
                          style={{ padding: '4px 9px', borderRadius: 6, background: 'rgba(239,68,68,0.2)', border: 'none',
                            color: '#f87171', cursor: 'pointer', fontSize: 14, fontWeight: 700, lineHeight: 1 }}>✕</button>
                      </div>

                      <div style={{ color: '#6b7280', fontSize: 11, marginLeft: 2 }}>{currentOpt?.desc}</div>

                      {(needsValue || needsWindow) && (
                        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                          {needsValue && (
                            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                              <label style={{ color: '#94a3b8', fontSize: 11, whiteSpace: 'nowrap' }}>
                                {ex.type === 'max_consec_losses' ? 'Défaites consécutives :' : 'N ='}
                              </label>
                              <input type="number" min="1" max="20" value={ex.value ?? 2}
                                onChange={e => setEx({ value: parseInt(e.target.value) || 2 })}
                                style={{ width: 60, padding: '4px 8px', background: '#1e1b2e', border: '1px solid rgba(239,68,68,0.3)',
                                  borderRadius: 6, color: '#fff', fontSize: 12 }} />
                            </div>
                          )}
                          {needsWindow && (
                            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                              <label style={{ color: '#94a3b8', fontSize: 11, whiteSpace: 'nowrap' }}>fenêtre W =</label>
                              <input type="number" min="2" max="20" value={ex.window ?? 5}
                                onChange={e => setEx({ window: parseInt(e.target.value) || 5 })}
                                style={{ width: 60, padding: '4px 8px', background: '#1e1b2e', border: '1px solid rgba(239,68,68,0.3)',
                                  borderRadius: 6, color: '#fff', fontSize: 12 }} />
                            </div>
                          )}
                          <div style={{ color: '#4b5563', fontSize: 11, fontStyle: 'italic' }}>
                            {ex.type === 'consec_appearances' && `→ bloque si la carte prédite a été vue ${ex.value ?? 2}x de suite`}
                            {ex.type === 'recent_frequency'   && `→ bloque si ≥ ${ex.value ?? 3} fois dans les ${ex.window ?? 5} dernières parties`}
                            {ex.type === 'max_consec_losses'  && `→ bloque après ${ex.value ?? 3} défaites d'affilée`}
                            {ex.type === 'trigger_overload'   && `→ bloque si déclencheur ≥ ${ex.value ?? 3}x dans les ${ex.window ?? 5} parties`}
                          </div>
                        </div>
                      )}

                      {needsHalf && (
                        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                          <label style={{ color: '#94a3b8', fontSize: 11, whiteSpace: 'nowrap' }}>Fenêtre bloquée :</label>
                          {[
                            { val: 'first',  label: '🕐 H:00–H:29 (1ʳᵉ moitié)', hint: 'Bloque de H:00 à H:29 chaque heure' },
                            { val: 'second', label: '🕧 H:30–H:59 (2ᵉ moitié)',  hint: 'Bloque de H:30 à H:59 chaque heure' },
                          ].map(opt => (
                            <button
                              key={opt.val}
                              type="button"
                              onClick={() => setEx({ half: opt.val })}
                              title={opt.hint}
                              style={{
                                padding: '4px 12px', borderRadius: 6, fontSize: 11, cursor: 'pointer',
                                background: (ex.half ?? 'second') === opt.val ? 'rgba(239,68,68,0.25)' : 'rgba(239,68,68,0.07)',
                                border: `1px solid ${(ex.half ?? 'second') === opt.val ? 'rgba(239,68,68,0.6)' : 'rgba(239,68,68,0.2)'}`,
                                color: (ex.half ?? 'second') === opt.val ? '#fca5a5' : '#6b7280',
                                fontWeight: (ex.half ?? 'second') === opt.val ? 700 : 400,
                              }}
                            >{opt.label}</button>
                          ))}
                          <div style={{ color: '#4b5563', fontSize: 11, fontStyle: 'italic' }}>
                            → bloque pendant la {(ex.half ?? 'second') === 'first' ? '1ʳᵉ (00–29 min)' : '2ᵉ (30–59 min)'} moitié de chaque heure
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>

              {/* ── Boutons d'action ── */}
              <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end', marginTop: 24, paddingTop: 16, borderTop: '1px solid rgba(168,85,247,0.15)' }}>
                {stratEditing !== null && (
                  <button className="btn btn-ghost btn-sm" onClick={cancelStratForm}>✕ Annuler</button>
                )}
                <button
                  className="btn btn-gold btn-sm"
                  style={{ background: stratEditing !== null ? 'linear-gradient(135deg,#7e22ce,#a855f7)' : 'linear-gradient(135deg,#15803d,#22c55e)', minWidth: 200 }}
                  onClick={saveStrat}
                  disabled={stratSaving || !stratForm.name.trim()}
                >
                  {stratSaving ? '⏳ Enregistrement…' : stratEditing !== null ? `💾 Mettre à jour S${stratEditing}` : `✅ Créer la stratégie`}
                </button>
              </div>

              </div>{/* fin padding */}
        </div>

        </>}

        {/* ════════════════════════════════════════════════
            ── TAB : BILAN PAR STRATÉGIE ──
        ════════════════════════════════════════════════ */}
        {adminTab === 'bilan' && <>

        <div className="tg-admin-card" style={{ borderColor: 'rgba(251,191,36,0.4)', marginBottom: 20 }}>
          <div className="tg-admin-header">
            <span className="tg-admin-icon">📊</span>
            <div style={{ flex: 1 }}>
              <h2 className="tg-admin-title">Bilan des prédictions par stratégie</h2>
              <p className="tg-admin-sub">Résultats depuis le début — wins, pertes et taux de réussite pour chaque canal et stratégie personnalisée.</p>
            </div>
            <button
              onClick={loadStratStats}
              style={{ padding: '6px 14px', borderRadius: 8, border: '1px solid rgba(251,191,36,0.4)', background: 'transparent', color: '#fbbf24', cursor: 'pointer', fontSize: 12, fontWeight: 700 }}
            >🔄 Actualiser</button>
          </div>

          {/* Grille des statistiques */}
          {(() => {
            const ALL_CHANNELS = [
              { id: 'C1', name: '♠ Pique Noir',    color: '#3b82f6' },
              { id: 'C2', name: '♥ Cœur Rouge',    color: '#ef4444' },
              { id: 'C3', name: '♦ Carreau Doré',  color: '#f59e0b' },
              { id: 'DC', name: '♣ Double Canal',  color: '#22c55e' },
              ...strategies.map(s => ({ id: `S${s.id}`, name: s.name, color: '#a855f7', custom: true })),
            ];
            const getStats = (id) => {
              const s = stratStats.find(x => x.strategy === id);
              if (!s) return { wins: 0, losses: 0, pending: 0, total: 0 };
              return { wins: parseInt(s.wins)||0, losses: parseInt(s.losses)||0, pending: parseInt(s.pending)||0, total: parseInt(s.total)||0 };
            };
            return (
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 16, marginTop: 16 }}>
                {ALL_CHANNELS.map(ch => {
                  const st = getStats(ch.id);
                  const resolved = st.wins + st.losses;
                  const winRate = resolved > 0 ? ((st.wins / resolved) * 100).toFixed(1) : null;
                  const barW = resolved > 0 ? (st.wins / resolved) * 100 : 0;
                  return (
                    <div key={ch.id} style={{
                      background: `${ch.color}0d`,
                      border: `1px solid ${ch.color}33`,
                      borderRadius: 14, padding: '18px 20px',
                    }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 14 }}>
                        <div style={{ width: 38, height: 38, borderRadius: 9, background: `${ch.color}22`, border: `2px solid ${ch.color}55`, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 17, fontWeight: 800, color: ch.color, flexShrink: 0 }}>
                          {ch.id}
                        </div>
                        <div style={{ flex: 1 }}>
                          <div style={{ fontWeight: 700, color: '#e2e8f0', fontSize: 14 }}>{ch.name}</div>
                          {ch.custom && <div style={{ fontSize: 10, color: '#a855f7' }}>Stratégie personnalisée</div>}
                        </div>
                        {winRate !== null && (
                          <div style={{ fontSize: 22, fontWeight: 900, color: parseFloat(winRate) >= 60 ? '#22c55e' : parseFloat(winRate) >= 45 ? '#fbbf24' : '#f87171' }}>
                            {winRate}%
                          </div>
                        )}
                      </div>

                      {/* Barre wins/losses */}
                      <div style={{ height: 8, borderRadius: 99, background: 'rgba(255,255,255,0.07)', overflow: 'hidden', marginBottom: 10 }}>
                        {resolved > 0 && <>
                          <div style={{ display: 'flex', height: '100%' }}>
                            <div style={{ width: `${barW}%`, background: '#22c55e', borderRadius: '99px 0 0 99px', transition: 'width 0.6s' }} />
                            <div style={{ flex: 1, background: '#ef4444', borderRadius: '0 99px 99px 0' }} />
                          </div>
                        </>}
                        {resolved === 0 && <div style={{ width: '100%', height: '100%', background: 'rgba(255,255,255,0.05)', borderRadius: 99 }} />}
                      </div>

                      {/* Compteurs */}
                      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                        <div style={{ flex: 1, textAlign: 'center', background: 'rgba(34,197,94,0.1)', borderRadius: 8, padding: '8px 4px', border: '1px solid rgba(34,197,94,0.2)' }}>
                          <div style={{ fontSize: 20, fontWeight: 900, color: '#4ade80' }}>{st.wins}</div>
                          <div style={{ fontSize: 10, color: '#94a3b8', fontWeight: 600, textTransform: 'uppercase', letterSpacing: 0.5 }}>Wins ✅</div>
                        </div>
                        <div style={{ flex: 1, textAlign: 'center', background: 'rgba(239,68,68,0.1)', borderRadius: 8, padding: '8px 4px', border: '1px solid rgba(239,68,68,0.2)' }}>
                          <div style={{ fontSize: 20, fontWeight: 900, color: '#f87171' }}>{st.losses}</div>
                          <div style={{ fontSize: 10, color: '#94a3b8', fontWeight: 600, textTransform: 'uppercase', letterSpacing: 0.5 }}>Pertes ❌</div>
                        </div>
                        {st.pending > 0 && (
                          <div style={{ flex: 1, textAlign: 'center', background: 'rgba(251,191,36,0.08)', borderRadius: 8, padding: '8px 4px', border: '1px solid rgba(251,191,36,0.2)' }}>
                            <div style={{ fontSize: 20, fontWeight: 900, color: '#fbbf24' }}>{st.pending}</div>
                            <div style={{ fontSize: 10, color: '#94a3b8', fontWeight: 600, textTransform: 'uppercase', letterSpacing: 0.5 }}>En cours ⏳</div>
                          </div>
                        )}
                        <div style={{ flex: 1, textAlign: 'center', background: 'rgba(255,255,255,0.04)', borderRadius: 8, padding: '8px 4px', border: '1px solid rgba(255,255,255,0.08)' }}>
                          <div style={{ fontSize: 20, fontWeight: 900, color: '#94a3b8' }}>{st.total}</div>
                          <div style={{ fontSize: 10, color: '#94a3b8', fontWeight: 600, textTransform: 'uppercase', letterSpacing: 0.5 }}>Total</div>
                        </div>
                      </div>

                      {st.total === 0 && (
                        <div style={{ marginTop: 10, fontSize: 12, color: '#475569', textAlign: 'center', fontStyle: 'italic' }}>
                          Aucune prédiction enregistrée
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            );
          })()}
        </div>

        {/* ── Résumé global ── */}
        {(() => {
          const totals = stratStats.reduce((acc, s) => ({
            wins: acc.wins + (parseInt(s.wins)||0),
            losses: acc.losses + (parseInt(s.losses)||0),
            total: acc.total + (parseInt(s.total)||0),
          }), { wins: 0, losses: 0, total: 0 });
          const resolved = totals.wins + totals.losses;
          const wr = resolved > 0 ? ((totals.wins / resolved) * 100).toFixed(1) : null;
          return (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12 }}>
              {[
                { label: 'Total Wins', value: totals.wins, color: '#22c55e', icon: '✅' },
                { label: 'Total Pertes', value: totals.losses, color: '#ef4444', icon: '❌' },
                { label: 'Taux Global', value: wr !== null ? `${wr}%` : '—', color: wr && parseFloat(wr) >= 60 ? '#22c55e' : wr && parseFloat(wr) >= 45 ? '#fbbf24' : '#f87171', icon: '📈' },
                { label: 'Total Prédictions', value: totals.total, color: '#94a3b8', icon: '🎯' },
              ].map(item => (
                <div key={item.label} style={{ textAlign: 'center', background: 'rgba(255,255,255,0.03)', borderRadius: 12, padding: '16px 8px', border: '1px solid rgba(255,255,255,0.07)' }}>
                  <div style={{ fontSize: 28, fontWeight: 900, color: item.color }}>{item.value}</div>
                  <div style={{ fontSize: 11, color: '#64748b', fontWeight: 600, marginTop: 4 }}>{item.icon} {item.label}</div>
                </div>
              ))}
            </div>
          );
        })()}

        </>}

        {/* ── ROUTAGE STRATÉGIES PAR DÉFAUT → CANAUX (Config) ── */}
        {/* ── FICHIER DE MISE À JOUR ── */}
        {adminTab === 'systeme' && (
        <div className="tg-admin-card" style={{ borderColor: 'rgba(168,85,247,0.45)', marginBottom: 20 }}>
          <div className="tg-admin-header">
            <span className="tg-admin-icon">📦</span>
            <div style={{ flex: 1 }}>
              <h2 className="tg-admin-title">Fichier de mise à jour système</h2>
              <p className="tg-admin-sub">
                Importez un fichier <code style={{ background: 'rgba(168,85,247,0.15)', padding: '1px 6px', borderRadius: 4 }}>.json</code> pour appliquer des changements puissants :<br/>
                <span style={{ color: '#c4b5fd', fontSize: 12 }}>
                  🎯 <strong>Stratégies</strong> — créer/modifier des stratégies de prédiction &nbsp;|&nbsp;
                  🔁 <strong>Séquences</strong> — configurer les relances &nbsp;|&nbsp;
                  🎨 <strong>Styles</strong> — variables CSS de l'interface &nbsp;|&nbsp;
                  📡 <strong>Format</strong> — modèle de message Telegram &nbsp;|&nbsp;
                  💻 <strong>Code</strong> — patches de fichiers backend (find+replace, insert, append)
                </span>
              </p>
            </div>
          </div>

          {/* Zone de drop / sélection */}
          <label style={{
            display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
            border: `2px dashed ${updateFile ? 'rgba(168,85,247,0.6)' : 'rgba(168,85,247,0.25)'}`,
            borderRadius: 12, padding: '22px 20px', cursor: 'pointer', marginBottom: 14,
            background: updateFile ? 'rgba(168,85,247,0.07)' : 'rgba(168,85,247,0.03)',
            transition: 'all .2s',
          }}>
            <input type="file" accept=".json,application/json" style={{ display: 'none' }} onChange={handleUpdateFileChange} />
            {updateFileName ? (
              <>
                <span style={{ fontSize: 28 }}>📄</span>
                <span style={{ fontWeight: 700, color: '#c4b5fd', marginTop: 6, fontSize: 13 }}>{updateFileName}</span>
                <span style={{ fontSize: 11, color: '#64748b', marginTop: 2 }}>Cliquez pour changer le fichier</span>
              </>
            ) : (
              <>
                <span style={{ fontSize: 32 }}>⬆️</span>
                <span style={{ fontWeight: 600, color: '#94a3b8', marginTop: 8, fontSize: 13 }}>Cliquez pour sélectionner un fichier .json</span>
              </>
            )}
          </label>

          {/* Prévisualisation */}
          {updatePreview && !updateResult && (
            <div style={{ background: 'rgba(168,85,247,0.07)', border: '1px solid rgba(168,85,247,0.2)', borderRadius: 10, padding: '12px 16px', marginBottom: 14 }}>
              <div style={{ fontSize: 12, fontWeight: 700, color: '#c4b5fd', marginBottom: 8 }}>📋 Aperçu de la mise à jour</div>
              {updatePreview.map((p, i) => (
                <div key={i} style={{ display: 'flex', gap: 10, alignItems: 'flex-start', marginBottom: 6 }}>
                  <span style={{ fontSize: 16, flexShrink: 0 }}>{p.icon}</span>
                  <div>
                    <div style={{ fontWeight: 600, color: '#e2e8f0', fontSize: 13 }}>{p.label}</div>
                    <div style={{ fontSize: 12, color: '#94a3b8', marginTop: 2 }}>{p.detail}</div>
                  </div>
                </div>
              ))}
              <button
                className="btn btn-gold btn-sm"
                style={{ marginTop: 12, background: 'linear-gradient(135deg,#6d28d9,#a855f7)', minWidth: 180 }}
                disabled={updateApplying}
                onClick={applyUpdate}
              >
                {updateApplying ? '⏳ Application en cours…' : '⚡ Appliquer la mise à jour'}
              </button>
            </div>
          )}

          {/* Résultat */}
          {updateResult && (
            <div style={{
              background: updateResult.ok ? 'rgba(34,197,94,0.08)' : 'rgba(248,113,113,0.08)',
              border: `1px solid ${updateResult.ok ? 'rgba(34,197,94,0.3)' : 'rgba(248,113,113,0.3)'}`,
              borderRadius: 10, padding: '12px 16px', marginBottom: 14,
            }}>
              <div style={{ fontWeight: 700, fontSize: 13, color: updateResult.ok ? '#22c55e' : '#f87171', marginBottom: 8 }}>
                {updateResult.ok ? `✅ Mise à jour appliquée — ${updateResult.total_applied} changement(s)` : '❌ Échec de la mise à jour'}
              </div>
              {(updateResult.results || []).map((r2, i) => (
                <div key={i} style={{ fontSize: 12, color: r2.applied > 0 ? '#86efac' : '#fca5a5', marginBottom: 4 }}>
                  <strong>{r2.type}</strong>: {r2.applied} appliqué(s)
                  {r2.detail && r2.detail.split('\n').map((line, j) => line ? <div key={j} style={{ paddingLeft: 10, color: '#94a3b8' }}>{line}</div> : null)}
                  {r2.errors?.length > 0 && <div style={{ color: '#fbbf24' }}>⚠️ {r2.errors.join(' | ')}</div>}
                </div>
              ))}
              {updateResult.errors?.length > 0 && !updateResult.results && (
                <div style={{ fontSize: 12, color: '#fca5a5' }}>{updateResult.errors.join(' | ')}</div>
              )}
              {updateResult.results?.some(r2 => r2.restart_needed) && (
                <div style={{ fontSize: 11, color: '#fbbf24', marginTop: 8, background: 'rgba(251,191,36,0.08)', padding: '6px 10px', borderRadius: 6 }}>
                  ⚠️ Redémarrez le serveur depuis le panneau Replit pour appliquer les changements backend.
                </div>
              )}
              <button className="btn btn-sm" style={{ marginTop: 10, fontSize: 12, color: '#94a3b8', background: 'rgba(100,116,139,0.1)', border: '1px solid rgba(100,116,139,0.2)' }} onClick={() => setUpdateResult(null)}>
                Fermer
              </button>
            </div>
          )}

          {/* Statut du build */}
          {buildStatus && (
            <div style={{
              background: buildStatus.status === 'done' ? 'rgba(34,197,94,0.07)' : buildStatus.status === 'error' ? 'rgba(248,113,113,0.07)' : 'rgba(168,85,247,0.07)',
              border: `1px solid ${buildStatus.status === 'done' ? 'rgba(34,197,94,0.3)' : buildStatus.status === 'error' ? 'rgba(248,113,113,0.3)' : 'rgba(168,85,247,0.3)'}`,
              borderRadius: 10, padding: '12px 16px', marginBottom: 14,
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
                {buildStatus.status === 'building' && <div style={{ width: 10, height: 10, borderRadius: '50%', background: '#a855f7', animation: 'pulse 1s infinite' }} />}
                <span style={{ fontWeight: 700, fontSize: 13, color: buildStatus.status === 'done' ? '#22c55e' : buildStatus.status === 'error' ? '#f87171' : '#c4b5fd' }}>
                  {buildStatus.status === 'building' ? '🔨 Build en cours…' : buildStatus.status === 'done' ? '✅ Build terminé — rechargement de la page…' : '❌ Erreur de build'}
                </span>
              </div>
              {buildStatus.error && <div style={{ fontSize: 11, color: '#f87171', marginBottom: 4 }}>{buildStatus.error}</div>}
              {buildStatus.log && (
                <pre style={{ fontSize: 10, color: '#64748b', background: 'rgba(0,0,0,0.3)', borderRadius: 6, padding: '8px 10px', maxHeight: 120, overflowY: 'auto', margin: 0, fontFamily: 'monospace' }}>
                  {buildStatus.log.slice(-1500)}
                </pre>
              )}
            </div>
          )}

          {/* Styles actifs */}
          {Object.keys(uiStyles).length > 0 && (
            <div style={{ borderTop: '1px solid rgba(168,85,247,0.15)', paddingTop: 12, marginTop: 4 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                <div style={{ fontSize: 12, fontWeight: 700, color: '#c4b5fd' }}>🎨 Styles actifs ({Object.keys(uiStyles).length} variable{Object.keys(uiStyles).length > 1 ? 's' : ''})</div>
                <button
                  className="btn btn-sm"
                  style={{ fontSize: 11, color: '#f87171', background: 'rgba(248,113,113,0.08)', border: '1px solid rgba(248,113,113,0.2)' }}
                  onClick={async () => {
                    if (!confirm('Réinitialiser tous les styles personnalisés ?')) return;
                    await fetch('/api/admin/ui-styles', { method: 'DELETE', credentials: 'include' });
                    setUiStyles({});
                    // Retirer les variables CSS du DOM
                    for (const key of Object.keys(uiStyles)) {
                      document.documentElement.style.removeProperty(key);
                    }
                  }}
                >
                  🗑️ Réinitialiser
                </button>
              </div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                {Object.entries(uiStyles).map(([k, v]) => (
                  <div key={k} style={{ display: 'flex', alignItems: 'center', gap: 6, background: 'rgba(168,85,247,0.08)', border: '1px solid rgba(168,85,247,0.15)', borderRadius: 6, padding: '3px 8px' }}>
                    {v.startsWith('#') || v.startsWith('rgb') ? (
                      <div style={{ width: 10, height: 10, borderRadius: 2, background: v, border: '1px solid rgba(255,255,255,0.2)', flexShrink: 0 }} />
                    ) : null}
                    <span style={{ fontSize: 11, color: '#c4b5fd', fontFamily: 'monospace' }}>{k}</span>
                    <span style={{ fontSize: 11, color: '#94a3b8', fontFamily: 'monospace' }}>{v}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Fichiers modifiés avec backup disponible */}
          {modifiedFiles.length > 0 && (
            <div style={{ borderTop: '1px solid rgba(168,85,247,0.15)', paddingTop: 12, marginTop: 8 }}>
              <div style={{ fontSize: 12, fontWeight: 700, color: '#94a3b8', marginBottom: 8 }}>
                🔒 Fichiers modifiés (backup disponible)
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                {modifiedFiles.map(f => (
                  <div key={f} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', background: 'rgba(100,116,139,0.07)', border: '1px solid rgba(100,116,139,0.15)', borderRadius: 6, padding: '5px 10px' }}>
                    <span style={{ fontSize: 11, color: '#94a3b8', fontFamily: 'monospace' }}>{f}</span>
                    <button
                      className="btn btn-sm"
                      style={{ fontSize: 10, padding: '2px 8px', color: '#fbbf24', background: 'rgba(251,191,36,0.08)', border: '1px solid rgba(251,191,36,0.2)' }}
                      onClick={async () => {
                        if (!confirm(`Restaurer ${f} à son état d'avant la mise à jour ?`)) return;
                        const r = await fetch('/api/admin/restore-file', {
                          method: 'POST', credentials: 'include',
                          headers: { 'Content-Type': 'application/json' },
                          body: JSON.stringify({ file_path: f }),
                        });
                        if (r.ok) {
                          await loadModifiedFiles();
                          // Reconstruire si c'est un fichier frontend
                          if (f.startsWith('src/') || f.startsWith('public/')) {
                            await fetch('/api/admin/build-status/trigger', { method: 'POST', credentials: 'include' });
                            const bs = await fetch('/api/admin/build-status', { credentials: 'include' });
                            if (bs.ok) setBuildStatus(await bs.json());
                            pollBuildStatus();
                          }
                          alert('Fichier restauré ✅');
                        }
                      }}
                    >
                      ↩️ Restaurer
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Guide rapide */}
          <details style={{ marginTop: 16 }}>
            <summary style={{ fontSize: 12, color: '#64748b', cursor: 'pointer', userSelect: 'none', fontWeight: 600 }}>
              📖 Format du fichier (exemples)
            </summary>
            <div style={{ marginTop: 10, display: 'flex', flexDirection: 'column', gap: 10 }}>
              {[
                { label: '🎨 Style / Interface (couleurs, polices, arrondis)', code: `{\n  "type": "styles",\n  "data": {\n    "--color-gold": "#f59e0b",\n    "--color-bg": "#0a0a0f",\n    "--font-family-base": "Inter, sans-serif"\n  }\n}` },
                { label: '⚙️ Créer / modifier une stratégie', code: `{\n  "type": "strategies",\n  "data": [{\n    "name": "Ma Stratégie",\n    "mode": "manquants",\n    "threshold": 3,\n    "visibility": "all",\n    "mappings": { "♠":"♠", "♥":"♥", "♦":"♦", "♣":"♣" }\n  }]\n}` },
                { label: '🔁 Séquence de relance', code: `{\n  "type": "sequences",\n  "data": [{\n    "name": "Relance x3",\n    "rules": [{ "strategy_id": 7, "losses_threshold": 3 }]\n  }]\n}` },
                { label: '🔢 Format de prédiction', code: `{\n  "type": "format",\n  "data": { "format_id": 2 }\n}` },
                { label: '🛠️ Modifier le code source (ajouter un bouton, une fonction…)', code: `{\n  "type": "code",\n  "data": {\n    "files": [\n      {\n        "path": "src/pages/Admin.jsx",\n        "find": "// MARKER: votre marqueur dans le code",\n        "insert_after": "\\n<button>Mon nouveau bouton</button>"\n      }\n    ],\n    "rebuild": true\n  }\n}` },
                { label: '🛠️ Remplacer complètement un fichier source', code: `{\n  "type": "code",\n  "data": {\n    "files": [\n      {\n        "path": "src/pages/Admin.jsx",\n        "content": "... contenu complet du fichier ..."\n      }\n    ],\n    "rebuild": true\n  }\n}` },
                { label: '🛠️ Modifier le backend (engine.js, admin.js…)', code: `{\n  "type": "code",\n  "data": {\n    "files": [\n      {\n        "path": "engine.js",\n        "find": "// CODE À MODIFIER",\n        "replace": "// NOUVEAU CODE"\n      }\n    ],\n    "rebuild": false,\n    "reload_backend": true\n  }\n}` },
                { label: '📦 Mise à jour multiple (styles + code + stratégies)', code: `{\n  "type": "multi",\n  "data": [\n    { "type": "styles", "data": { "--color-gold": "#f59e0b" } },\n    { "type": "format", "data": { "format_id": 3 } },\n    { "type": "code", "data": {\n      "files": [{ "path": "src/pages/Admin.jsx", "find": "// FIN FORMULAIRE", "insert_before": "<div>Nouveau champ</div>" }],\n      "rebuild": true\n    }}\n  ]\n}` },
              ].map(({ label, code }) => (
                <div key={label}>
                  <div style={{ fontSize: 11, fontWeight: 700, color: '#94a3b8', marginBottom: 4 }}>{label}</div>
                  <pre style={{ background: 'rgba(15,23,42,0.8)', border: '1px solid rgba(100,116,139,0.2)', borderRadius: 8, padding: '10px 12px', fontSize: 11, color: '#7dd3fc', margin: 0, overflowX: 'auto', fontFamily: 'monospace', lineHeight: 1.5 }}>{code}</pre>
                </div>
              ))}
              <div style={{ fontSize: 11, color: '#64748b', background: 'rgba(168,85,247,0.06)', border: '1px solid rgba(168,85,247,0.15)', borderRadius: 8, padding: '10px 12px', lineHeight: 1.6 }}>
                <strong style={{ color: '#c4b5fd' }}>Opérations disponibles pour type "code":</strong><br />
                • <code>content</code> — remplace tout le fichier<br />
                • <code>find</code> + <code>replace</code> — cherche et remplace (ajoutez <code>"replace_all": true</code> pour toutes les occurrences)<br />
                • <code>find</code> + <code>insert_after</code> — insère du code juste après le marqueur<br />
                • <code>find</code> + <code>insert_before</code> — insère du code juste avant le marqueur<br />
                • <code>append</code> — ajoute à la fin du fichier<br />
                • <code>prepend</code> — ajoute au début du fichier<br />
                <br />
                Un backup automatique (<code>.bak</code>) est créé avant chaque modification. Il est restaurable depuis la section "Fichiers modifiés" ci-dessus.
              </div>
            </div>
          </details>
        </div>)}

        {adminTab === 'config' && <div className="tg-admin-card" style={{ borderColor: 'rgba(34,158,217,0.4)' }}>
          <div className="tg-admin-header">
            <span className="tg-admin-icon">🔀</span>
            <div style={{ flex: 1 }}>
              <h2 className="tg-admin-title">Routage des 4 stratégies par défaut</h2>
              <p className="tg-admin-sub">
                Définissez quels canaux Telegram globaux reçoivent les prédictions de chaque stratégie.
                Si aucun canal n'est sélectionné, la stratégie envoie vers <strong>tous</strong> les canaux.
              </p>
            </div>
            {routeMsg && (
              <span style={{ fontSize: 12, fontWeight: 700, color: routeMsg.startsWith('✅') ? '#22c55e' : '#f87171' }}>{routeMsg}</span>
            )}
          </div>

          {tgChannels.length === 0 ? (
            <div style={{ textAlign: 'center', color: '#475569', fontSize: 13, padding: '20px 0' }}>
              Aucun canal Telegram configuré. Ajoutez des canaux dans la section ci-dessous.
            </div>
          ) : (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))', gap: 14, marginTop: 14 }}>
              {DEFAULT_STRATS.map(strat => {
                const set = routeData[strat] || new Set();
                return (
                  <div key={strat} style={{
                    background: 'rgba(34,158,217,0.05)', border: '1px solid rgba(34,158,217,0.2)',
                    borderRadius: 12, padding: '14px 16px',
                  }}>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
                      <div>
                        <span style={{ fontWeight: 700, color: '#e2e8f0', fontSize: 14 }}>{DEFAULT_STRAT_LABELS[strat]}</span>
                        <span style={{ fontSize: 11, color: '#64748b', marginLeft: 6 }}>({strat})</span>
                      </div>
                      {set.size === 0 ? (
                        <span style={{ fontSize: 10, padding: '2px 6px', borderRadius: 4, background: 'rgba(100,116,139,0.15)', color: '#64748b', fontWeight: 600 }}>Tous</span>
                      ) : (
                        <span style={{ fontSize: 10, padding: '2px 6px', borderRadius: 4, background: 'rgba(34,158,217,0.2)', color: '#229ed9', fontWeight: 600 }}>{set.size} canal{set.size > 1 ? 'aux' : ''}</span>
                      )}
                    </div>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                      {tgChannels.map(ch => {
                        const on = set.has(ch.dbId);
                        return (
                          <label key={ch.dbId} style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer',
                            padding: '6px 8px', borderRadius: 7,
                            background: on ? 'rgba(34,158,217,0.12)' : 'rgba(255,255,255,0.03)',
                            border: `1px solid ${on ? 'rgba(34,158,217,0.4)' : 'rgba(255,255,255,0.07)'}`,
                            transition: 'all 0.15s',
                          }}>
                            <input
                              type="checkbox"
                              checked={on}
                              onChange={() => toggleRoute(strat, ch.dbId)}
                              style={{ accentColor: '#229ed9', width: 14, height: 14, cursor: 'pointer' }}
                            />
                            <span style={{ fontSize: 12, color: on ? '#7dd3fc' : '#64748b', fontWeight: on ? 600 : 400 }}>
                              ✈️ {ch.name}
                            </span>
                          </label>
                        );
                      })}
                    </div>
                    {set.size === 0 && (
                      <div style={{ fontSize: 10, color: '#475569', marginTop: 8, lineHeight: 1.4 }}>
                        Aucun canal coché = envoi vers <em>tous</em> les canaux configurés.
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}

          {tgChannels.length > 0 && (
            <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 16 }}>
              <button
                className="btn btn-gold btn-sm"
                style={{ background: 'linear-gradient(135deg,#0369a1,#229ed9)', minWidth: 180 }}
                onClick={saveRoutes}
                disabled={routeSaving}
              >
                {routeSaving ? '⏳ Enregistrement…' : '💾 Enregistrer le routage'}
              </button>
            </div>
          )}
        </div>}

        {/* ── BASE DE DONNÉES EXTERNE RENDER ── */}
        {adminTab === 'systeme' && (
        <div className="tg-admin-card" style={{ borderColor: 'rgba(34,197,94,0.4)', marginTop: 20 }}>
          <div className="tg-admin-header">
            <span className="tg-admin-icon">🗄️</span>
            <div style={{ flex: 1 }}>
              <h2 className="tg-admin-title">Base de données externe (Render.com)</h2>
              <p className="tg-admin-sub">
                Toutes les prédictions vérifiées (gagnées/perdues) sont synchronisées en temps réel vers cette base.
                La base est <strong>effacée automatiquement</strong> au jeu #1 (nouveau cycle).
              </p>
            </div>
            {renderDbStatus?.connected
              ? <span className="tg-badge-connected">🟢 Connecté</span>
              : <span style={{ fontSize: 12, fontWeight: 700, color: '#f87171', background: 'rgba(248,113,113,0.12)', padding: '3px 10px', borderRadius: 20 }}>⚫ Non connecté</span>
            }
          </div>

          {/* Stats Render DB */}
          {renderDbStatus?.connected && renderDbStatus?.stats && (
            <div style={{ display: 'flex', gap: 12, marginBottom: 16, flexWrap: 'wrap' }}>
              {[
                { label: 'Total synchronisé', val: renderDbStatus.stats.total },
                { label: 'Gagnées', val: renderDbStatus.stats.wins, color: '#22c55e' },
                { label: 'Perdues',  val: renderDbStatus.stats.losses, color: '#f87171' },
                { label: 'Dernier jeu', val: renderDbStatus.stats.last_game ? `#${renderDbStatus.stats.last_game}` : '—' },
              ].map(({ label, val, color }) => (
                <div key={label} style={{ flex: 1, minWidth: 100, background: 'rgba(34,197,94,0.07)', border: '1px solid rgba(34,197,94,0.15)', borderRadius: 10, padding: '10px 14px', textAlign: 'center' }}>
                  <div style={{ fontSize: 18, fontWeight: 700, color: color || '#e2e8f0' }}>{val ?? '—'}</div>
                  <div style={{ fontSize: 11, color: '#64748b', marginTop: 2 }}>{label}</div>
                </div>
              ))}
            </div>
          )}

          {/* Formulaire URL */}
          <div style={{ display: 'flex', gap: 10, alignItems: 'flex-end', marginBottom: 10 }}>
            <div style={{ flex: 1 }}>
              <label style={{ fontSize: 11, color: '#94a3b8', display: 'block', marginBottom: 4 }}>
                URL PostgreSQL externe (ex: postgresql://user:pass@host/db)
              </label>
              <input
                type="password"
                className="tg-input"
                value={renderDbUrl}
                onChange={e => setRenderDbUrl(e.target.value)}
                placeholder="postgresql://..."
                style={{ width: '100%', fontFamily: 'monospace', fontSize: 12 }}
              />
            </div>
            <button
              className="btn btn-gold btn-sm"
              style={{ background: 'linear-gradient(135deg,#166534,#22c55e)', minWidth: 130, whiteSpace: 'nowrap' }}
              disabled={renderDbSaving || !renderDbUrl.trim()}
              onClick={async () => {
                setRenderDbSaving(true); setRenderDbMsg('');
                try {
                  const r = await fetch('/api/admin/render-db', {
                    method: 'POST', credentials: 'include',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ url: renderDbUrl }),
                  });
                  const d = await r.json();
                  if (r.ok) { setRenderDbMsg('✅ Connexion établie'); setRenderDbUrl(''); await loadRenderDbStatus(); }
                  else setRenderDbMsg(`❌ ${d.error}`);
                } catch { setRenderDbMsg('❌ Erreur réseau'); }
                setRenderDbSaving(false);
              }}
            >
              {renderDbSaving ? '⏳…' : '🔌 Connecter'}
            </button>
          </div>

          {renderDbMsg && (
            <div style={{ fontSize: 12, fontWeight: 600, color: renderDbMsg.startsWith('✅') ? '#22c55e' : '#f87171', marginBottom: 10 }}>
              {renderDbMsg}
            </div>
          )}

          {/* Actions */}
          {renderDbStatus?.connected && (
            <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginTop: 6 }}>
              <button
                className="btn btn-sm"
                style={{ background: 'rgba(34,197,94,0.1)', border: '1px solid rgba(34,197,94,0.3)', color: '#22c55e', fontSize: 12 }}
                onClick={loadRenderDbStatus}
              >
                🔄 Rafraîchir les stats
              </button>
              <button
                className="btn btn-sm"
                style={{ background: 'rgba(251,191,36,0.1)', border: '1px solid rgba(251,191,36,0.3)', color: '#fbbf24', fontSize: 12 }}
                onClick={async () => {
                  if (!confirm('Effacer TOUTES les données de la base Render externe ?')) return;
                  const r = await fetch('/api/admin/render-db/reset', { method: 'POST', credentials: 'include' });
                  if (r.ok) { setRenderDbMsg('✅ Base externe effacée'); await loadRenderDbStatus(); }
                  else setRenderDbMsg('❌ Erreur reset');
                }}
              >
                🗑️ Effacer la base externe
              </button>
              <button
                className="btn btn-sm"
                style={{ background: 'rgba(248,113,113,0.1)', border: '1px solid rgba(248,113,113,0.3)', color: '#f87171', fontSize: 12 }}
                onClick={async () => {
                  if (!confirm('Déconnecter la base externe ? Les données sur Render ne seront pas effacées.')) return;
                  const r = await fetch('/api/admin/render-db', { method: 'DELETE', credentials: 'include' });
                  if (r.ok) { setRenderDbMsg('⚠️ Déconnecté'); await loadRenderDbStatus(); }
                }}
              >
                🔌 Déconnecter
              </button>
            </div>
          )}
        </div>)}

        {/* ── ANNONCES PLANIFIÉES TELEGRAM ── */}
        {adminTab === 'canaux' && (
        <div className="tg-admin-card" style={{ borderColor: 'rgba(251,191,36,0.45)', marginTop: 20 }}>
          <div className="tg-admin-header">
            <span className="tg-admin-icon">📢</span>
            <div style={{ flex: 1 }}>
              <h2 className="tg-admin-title">Annonces planifiées Telegram</h2>
              <p className="tg-admin-sub">Envoyez automatiquement un message (texte + image ou vidéo) dans un canal Telegram à intervalles réguliers ou à des heures fixes.</p>
            </div>
            {announcements.length > 0 && <span className="tg-badge-connected">{announcements.length} annonce{announcements.length > 1 ? 's' : ''}</span>}
          </div>

          {/* Liste des annonces existantes */}
          {announcements.length > 0 && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginBottom: 16 }}>
              {announcements.map(ann => (
                <div key={ann.id} style={{
                  padding: '14px 16px', borderRadius: 12,
                  background: ann.enabled ? 'rgba(251,191,36,0.06)' : 'rgba(255,255,255,0.03)',
                  border: `1px solid ${ann.enabled ? 'rgba(251,191,36,0.3)' : 'rgba(255,255,255,0.08)'}`,
                  display: 'flex', flexDirection: 'column', gap: 8,
                }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                    <span style={{ fontWeight: 700, color: ann.enabled ? '#fbbf24' : '#64748b', fontSize: 14 }}>
                      {ann.media_type === 'image' ? '🖼️' : ann.media_type === 'video' ? '🎬' : '📝'} {ann.name}
                    </span>
                    <span style={{ fontSize: 10, padding: '2px 8px', borderRadius: 10, background: 'rgba(34,158,217,0.15)', color: '#7dd3fc', fontWeight: 700 }}>
                      {ann.schedule_type === 'interval'
                        ? `⏱ toutes les ${ann.interval_hours}h`
                        : `🕐 ${ann.times?.join(' · ')}`}
                    </span>
                    <span style={{ fontSize: 10, color: '#64748b' }}>→ {ann.channel_id}</span>
                    {ann.last_sent && (
                      <span style={{ fontSize: 10, color: '#475569' }}>
                        Dernier envoi : {new Date(ann.last_sent).toLocaleString('fr-FR')}
                      </span>
                    )}
                  </div>
                  <div style={{ fontSize: 12, color: '#94a3b8', lineHeight: 1.5, background: 'rgba(0,0,0,0.2)', padding: '6px 10px', borderRadius: 6, whiteSpace: 'pre-wrap' }}>
                    {ann.text.length > 120 ? ann.text.slice(0, 120) + '…' : ann.text}
                  </div>
                  <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 2 }}>
                    <button
                      onClick={async () => {
                        setAnnSendingId(ann.id);
                        try {
                          const r = await fetch(`/api/admin/announcements/${ann.id}/send-now`, { method: 'POST', credentials: 'include' });
                          const d = await r.json();
                          if (d.ok) { setAnnMsg('✅ Annonce envoyée !'); loadAnnouncements(); }
                          else setAnnMsg('❌ ' + (d.error || 'Erreur'));
                        } catch { setAnnMsg('❌ Erreur réseau'); }
                        setAnnSendingId(null);
                        setTimeout(() => setAnnMsg(''), 4000);
                      }}
                      disabled={annSendingId === ann.id}
                      style={{ padding: '5px 14px', borderRadius: 8, border: 'none', cursor: 'pointer', fontSize: 12, fontWeight: 700, background: 'rgba(34,158,217,0.2)', color: '#7dd3fc' }}>
                      {annSendingId === ann.id ? '⏳ Envoi…' : '📤 Envoyer maintenant'}
                    </button>
                    <button
                      onClick={async () => {
                        await fetch(`/api/admin/announcements/${ann.id}`, {
                          method: 'PATCH', credentials: 'include',
                          headers: { 'Content-Type': 'application/json' },
                          body: JSON.stringify({ enabled: !ann.enabled }),
                        });
                        loadAnnouncements();
                      }}
                      style={{ padding: '5px 14px', borderRadius: 8, border: 'none', cursor: 'pointer', fontSize: 12, fontWeight: 700, background: ann.enabled ? 'rgba(251,191,36,0.12)' : 'rgba(34,197,94,0.12)', color: ann.enabled ? '#fbbf24' : '#4ade80' }}>
                      {ann.enabled ? '⏸ Désactiver' : '▶ Activer'}
                    </button>
                    <button
                      onClick={async () => {
                        if (!confirm(`Supprimer l'annonce "${ann.name}" ?`)) return;
                        await fetch(`/api/admin/announcements/${ann.id}`, { method: 'DELETE', credentials: 'include' });
                        loadAnnouncements();
                      }}
                      style={{ padding: '5px 14px', borderRadius: 8, border: 'none', cursor: 'pointer', fontSize: 12, fontWeight: 700, background: 'rgba(239,68,68,0.1)', color: '#f87171' }}>
                      🗑 Supprimer
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}

          {annMsg && (
            <div style={{ padding: '8px 12px', borderRadius: 8, marginBottom: 12, fontSize: 13, fontWeight: 700,
              background: annMsg.startsWith('✅') ? 'rgba(34,197,94,0.1)' : 'rgba(239,68,68,0.1)',
              color: annMsg.startsWith('✅') ? '#4ade80' : '#f87171', border: `1px solid ${annMsg.startsWith('✅') ? 'rgba(34,197,94,0.3)' : 'rgba(239,68,68,0.3)'}` }}>
              {annMsg}
            </div>
          )}

          {/* Bouton ouvrir/fermer le formulaire */}
          <button
            onClick={() => { setAnnOpen(o => !o); setAnnMsg(''); }}
            style={{ padding: '9px 20px', borderRadius: 10, border: 'none', cursor: 'pointer', fontSize: 13, fontWeight: 700,
              background: annOpen ? 'rgba(239,68,68,0.12)' : 'linear-gradient(135deg,#92400e,#fbbf24)',
              color: annOpen ? '#f87171' : '#fff', marginBottom: annOpen ? 16 : 0 }}>
            {annOpen ? '✕ Fermer le formulaire' : '+ Nouvelle annonce'}
          </button>

          {annOpen && (
            <form onSubmit={async e => {
              e.preventDefault();
              setAnnSaving(true); setAnnMsg('');
              try {
                const times = annForm.schedule_type === 'times'
                  ? annForm.times_input.split(',').map(t => t.trim()).filter(Boolean)
                  : [];
                const body = {
                  name: annForm.name,
                  bot_token: annForm.bot_token,
                  channel_id: annForm.channel_id,
                  text: annForm.text,
                  media_type: annForm.media_type || null,
                  media_url: annForm.media_url || null,
                  schedule_type: annForm.schedule_type,
                  interval_hours: annForm.schedule_type === 'interval' ? parseFloat(annForm.interval_hours) : null,
                  times,
                };
                const r = await fetch('/api/admin/announcements', {
                  method: 'POST', credentials: 'include',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify(body),
                });
                const d = await r.json();
                if (d.ok) {
                  setAnnMsg('✅ Annonce créée !');
                  setAnnForm(ANN_BLANK);
                  setAnnOpen(false);
                  loadAnnouncements();
                } else {
                  setAnnMsg('❌ ' + (d.error || 'Erreur'));
                }
              } catch { setAnnMsg('❌ Erreur réseau'); }
              setAnnSaving(false);
            }}
            style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>

              {/* Nom de l'annonce */}
              <div style={{ gridColumn: '1 / -1' }}>
                <label style={{ display: 'block', color: '#94a3b8', fontSize: 12, marginBottom: 5 }}>Nom de l'annonce</label>
                <input value={annForm.name} required onChange={e => setAnnForm(p => ({ ...p, name: e.target.value }))}
                  placeholder="Ex : Promo quotidienne"
                  style={{ width: '100%', padding: '9px 12px', background: '#1e1b2e', border: '1px solid rgba(251,191,36,0.3)', borderRadius: 8, color: '#fff', fontSize: 13, boxSizing: 'border-box' }} />
              </div>

              {/* Bot Token */}
              <div>
                <label style={{ display: 'block', color: '#94a3b8', fontSize: 12, marginBottom: 5 }}>🤖 Bot Token Telegram</label>
                <input value={annForm.bot_token} required onChange={e => setAnnForm(p => ({ ...p, bot_token: e.target.value }))}
                  placeholder="1234567890:ABCdef..."
                  style={{ width: '100%', padding: '9px 12px', background: '#1e1b2e', border: '1px solid rgba(251,191,36,0.3)', borderRadius: 8, color: '#fff', fontSize: 13, boxSizing: 'border-box' }} />
              </div>

              {/* Channel ID */}
              <div>
                <label style={{ display: 'block', color: '#94a3b8', fontSize: 12, marginBottom: 5 }}>📡 ID du canal Telegram</label>
                <input value={annForm.channel_id} required onChange={e => setAnnForm(p => ({ ...p, channel_id: e.target.value }))}
                  placeholder="-100123456789"
                  style={{ width: '100%', padding: '9px 12px', background: '#1e1b2e', border: '1px solid rgba(251,191,36,0.3)', borderRadius: 8, color: '#fff', fontSize: 13, boxSizing: 'border-box' }} />
              </div>

              {/* Texte */}
              <div style={{ gridColumn: '1 / -1' }}>
                <label style={{ display: 'block', color: '#94a3b8', fontSize: 12, marginBottom: 5 }}>💬 Texte du message (HTML supporté : &lt;b&gt;, &lt;i&gt;, &lt;a href=…&gt;)</label>
                <textarea value={annForm.text} required onChange={e => setAnnForm(p => ({ ...p, text: e.target.value }))}
                  rows={4} placeholder="Rejoignez-nous sur notre canal Telegram..."
                  style={{ width: '100%', padding: '9px 12px', background: '#1e1b2e', border: '1px solid rgba(251,191,36,0.3)', borderRadius: 8, color: '#fff', fontSize: 13, boxSizing: 'border-box', resize: 'vertical', fontFamily: 'inherit' }} />
              </div>

              {/* Type de media */}
              <div>
                <label style={{ display: 'block', color: '#94a3b8', fontSize: 12, marginBottom: 5 }}>🎞️ Type de média (optionnel)</label>
                <select value={annForm.media_type} onChange={e => setAnnForm(p => ({ ...p, media_type: e.target.value }))}
                  style={{ width: '100%', padding: '9px 12px', background: '#1e1b2e', border: '1px solid rgba(251,191,36,0.3)', borderRadius: 8, color: '#fff', fontSize: 13 }}>
                  <option value="">Aucun (texte uniquement)</option>
                  <option value="image">🖼️ Image</option>
                  <option value="video">🎬 Vidéo</option>
                </select>
              </div>

              {/* URL du media */}
              <div>
                <label style={{ display: 'block', color: '#94a3b8', fontSize: 12, marginBottom: 5 }}>🔗 URL de l'image / vidéo</label>
                <input value={annForm.media_url} onChange={e => setAnnForm(p => ({ ...p, media_url: e.target.value }))}
                  placeholder="https://example.com/image.jpg"
                  disabled={!annForm.media_type}
                  style={{ width: '100%', padding: '9px 12px', background: annForm.media_type ? '#1e1b2e' : '#111', border: '1px solid rgba(251,191,36,0.3)', borderRadius: 8, color: annForm.media_type ? '#fff' : '#475569', fontSize: 13, boxSizing: 'border-box' }} />
              </div>

              {/* Type de planification */}
              <div style={{ gridColumn: '1 / -1' }}>
                <label style={{ display: 'block', color: '#94a3b8', fontSize: 12, marginBottom: 8, fontWeight: 600 }}>⏰ Mode d'envoi</label>
                <div style={{ display: 'flex', gap: 10 }}>
                  {[{ v: 'interval', l: '⏱ Intervalle régulier', d: 'ex: toutes les 2h' }, { v: 'times', l: '🕐 Heures fixes', d: 'ex: 13:00, 18:00' }].map(opt => (
                    <button key={opt.v} type="button"
                      onClick={() => setAnnForm(p => ({ ...p, schedule_type: opt.v }))}
                      style={{
                        flex: 1, padding: '10px 14px', borderRadius: 10, cursor: 'pointer', textAlign: 'left',
                        border: annForm.schedule_type === opt.v ? '2px solid #fbbf24' : '1px solid rgba(251,191,36,0.2)',
                        background: annForm.schedule_type === opt.v ? 'rgba(251,191,36,0.12)' : 'rgba(255,255,255,0.03)',
                        color: annForm.schedule_type === opt.v ? '#fbbf24' : '#64748b',
                      }}>
                      <div style={{ fontWeight: 700, fontSize: 13 }}>{opt.l}</div>
                      <div style={{ fontSize: 11, opacity: 0.7, marginTop: 2 }}>{opt.d}</div>
                    </button>
                  ))}
                </div>
              </div>

              {/* Intervalle en heures */}
              {annForm.schedule_type === 'interval' && (
                <div style={{ gridColumn: '1 / -1' }}>
                  <label style={{ display: 'block', color: '#94a3b8', fontSize: 12, marginBottom: 5 }}>Intervalle en heures</label>
                  <input type="number" min="0.5" max="168" step="0.5"
                    value={annForm.interval_hours}
                    onChange={e => setAnnForm(p => ({ ...p, interval_hours: e.target.value }))}
                    style={{ width: 140, padding: '9px 12px', background: '#1e1b2e', border: '1px solid rgba(251,191,36,0.3)', borderRadius: 8, color: '#fff', fontSize: 13 }} />
                  <span style={{ marginLeft: 10, fontSize: 12, color: '#64748b' }}>heure(s) — ex: 1 = toutes les 60 min, 0.5 = toutes les 30 min</span>
                </div>
              )}

              {/* Heures fixes */}
              {annForm.schedule_type === 'times' && (
                <div style={{ gridColumn: '1 / -1' }}>
                  <label style={{ display: 'block', color: '#94a3b8', fontSize: 12, marginBottom: 5 }}>Heures d'envoi (format HH:MM, séparées par des virgules)</label>
                  <input value={annForm.times_input}
                    onChange={e => setAnnForm(p => ({ ...p, times_input: e.target.value }))}
                    placeholder="13:00, 18:00, 21:30"
                    style={{ width: '100%', padding: '9px 12px', background: '#1e1b2e', border: '1px solid rgba(251,191,36,0.3)', borderRadius: 8, color: '#fff', fontSize: 13, boxSizing: 'border-box' }} />
                  <div style={{ fontSize: 11, color: '#64748b', marginTop: 5 }}>
                    ℹ️ L'heure est basée sur le fuseau horaire du serveur. Tapez chaque heure au format 24h séparée par une virgule.
                  </div>
                </div>
              )}

              <div style={{ gridColumn: '1 / -1', display: 'flex', justifyContent: 'flex-end', paddingTop: 4 }}>
                <button type="submit" disabled={annSaving}
                  style={{ padding: '10px 28px', borderRadius: 10, border: 'none', cursor: 'pointer', fontSize: 14, fontWeight: 700,
                    background: 'linear-gradient(135deg,#92400e,#fbbf24)', color: '#fff', opacity: annSaving ? 0.7 : 1 }}>
                  {annSaving ? '⏳ Création…' : '✅ Créer l\'annonce'}
                </button>
              </div>
            </form>
          )}
        </div>)}

        {/* ════════════════════════════════════════════════
            ── TAB : CANAUX TELEGRAM ──
        ════════════════════════════════════════════════ */}
        {adminTab === 'canaux' && <>

        {/* ── SECTION 1 : CANAUX PRINCIPAUX DU SITE ── */}
        <div className="tg-admin-card" style={{ borderColor: 'rgba(251,191,36,0.4)', marginBottom: 20 }}>
          <div className="tg-admin-header">
            <span className="tg-admin-icon">🏛️</span>
            <div style={{ flex: 1 }}>
              <h2 className="tg-admin-title">Canaux principaux du site</h2>
              <p className="tg-admin-sub">
                Les 4 canaux de prédiction intégrés à l'application. Configurez un bot Telegram dédié pour chacun.
              </p>
            </div>
            <span className="tg-badge-connected" style={{ background: 'rgba(251,191,36,0.15)', color: '#fbbf24', border: '1px solid rgba(251,191,36,0.3)' }}>4 canaux fixes</span>
          </div>

          {defaultTgMsg && (
            <div className={`tg-alert ${defaultTgMsg.startsWith('✅') ? 'tg-alert-ok' : 'tg-alert-error'}`}>{defaultTgMsg}</div>
          )}

          <div style={{ display: 'flex', flexDirection: 'column', gap: 0, marginTop: 8 }}>
            {[
              { id: 'C1', emoji: '♠', name: 'Pique Noir',    color: '#3b82f6' },
              { id: 'C2', emoji: '♥', name: 'Cœur Rouge',   color: '#ef4444' },
              { id: 'C3', emoji: '♦', name: 'Carreau Doré', color: '#f59e0b' },
              { id: 'DC', emoji: '♣', name: 'Double Canal',  color: '#22c55e' },
            ].map((ch, idx) => {
              const cfg = defaultStratTg[ch.id] || {};
              const isConfigured = cfg.bot_token?.trim() && cfg.channel_id?.trim();
              const isOpen = defaultChOpen === ch.id;
              return (
                <div key={ch.id} style={{
                  borderBottom: idx < 3 ? '1px solid rgba(255,255,255,0.05)' : 'none',
                  padding: '12px 0',
                }}>
                  {/* Ligne principale */}
                  <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
                    <div style={{ width: 42, height: 42, borderRadius: 10, background: `${ch.color}22`, border: `2px solid ${ch.color}55`, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 20, flexShrink: 0 }}>
                      {ch.emoji}
                    </div>
                    <div style={{ flex: 1 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                        <span style={{ fontWeight: 700, color: '#e2e8f0', fontSize: 14 }}>{ch.name}</span>
                        <span style={{ fontSize: 11, padding: '1px 7px', borderRadius: 5, fontWeight: 700,
                          background: `${ch.color}22`, color: ch.color, border: `1px solid ${ch.color}44`,
                        }}>{ch.id}</span>
                        {isConfigured ? (
                          <span style={{ fontSize: 11, padding: '2px 8px', borderRadius: 5, fontWeight: 700,
                            background: 'rgba(34,197,94,0.15)', color: '#22c55e', border: '1px solid rgba(34,197,94,0.35)',
                          }}>✅ Telegram configuré</span>
                        ) : (
                          <span style={{ fontSize: 11, padding: '2px 8px', borderRadius: 5, fontWeight: 700,
                            background: 'rgba(239,68,68,0.12)', color: '#f87171', border: '1px solid rgba(239,68,68,0.3)',
                          }}>⚠️ Non configuré</span>
                        )}
                      </div>
                      {isConfigured && (
                        <div style={{ fontSize: 11, color: '#64748b', marginTop: 3, display: 'flex', gap: 12, flexWrap: 'wrap', fontFamily: 'monospace' }}>
                          <span>Canal : {cfg.channel_id}</span>
                          {cfg.tg_format && <span style={{ fontFamily: 'sans-serif', color: '#a78bfa' }}>· Format {cfg.tg_format}</span>}
                        </div>
                      )}
                    </div>
                    <button
                      type="button"
                      onClick={() => setDefaultChOpen(isOpen ? null : ch.id)}
                      style={{
                        fontSize: 11, padding: '6px 14px', borderRadius: 7, cursor: 'pointer', fontWeight: 700,
                        background: isOpen ? 'rgba(255,255,255,0.08)' : isConfigured ? 'rgba(34,158,217,0.15)' : 'rgba(251,191,36,0.15)',
                        color: isOpen ? '#94a3b8' : isConfigured ? '#229ed9' : '#fbbf24',
                        border: `1px solid ${isOpen ? 'rgba(255,255,255,0.1)' : isConfigured ? 'rgba(34,158,217,0.4)' : 'rgba(251,191,36,0.4)'}`,
                        flexShrink: 0,
                      }}
                    >
                      {isOpen ? '✕ Fermer' : isConfigured ? '✏️ Modifier' : '➕ Ajouter'}
                    </button>
                  </div>

                  {/* Formulaire inline */}
                  {isOpen && (
                    <div style={{ marginTop: 12, padding: '16px', background: 'rgba(255,255,255,0.03)', borderRadius: 10, border: '1px solid rgba(255,255,255,0.07)' }}>
                      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 12 }}>
                        <div>
                          <label style={{ display: 'block', color: '#94a3b8', fontSize: 11, fontWeight: 600, marginBottom: 5, textTransform: 'uppercase', letterSpacing: 0.6 }}>
                            Token Bot Telegram
                          </label>
                          <input
                            type="text"
                            placeholder="123456:ABCdef..."
                            value={cfg.bot_token || ''}
                            onChange={e => setDefaultStratTg(p => ({ ...p, [ch.id]: { ...p[ch.id], bot_token: e.target.value } }))}
                            style={{ width: '100%', padding: '8px 10px', background: '#1e1b2e', border: '1px solid rgba(255,255,255,0.12)', borderRadius: 7, color: '#fff', fontSize: 12, fontFamily: 'monospace', boxSizing: 'border-box' }}
                          />
                        </div>
                        <div>
                          <label style={{ display: 'block', color: '#94a3b8', fontSize: 11, fontWeight: 600, marginBottom: 5, textTransform: 'uppercase', letterSpacing: 0.6 }}>
                            ID Canal Telegram
                          </label>
                          <input
                            type="text"
                            placeholder="@moncanal ou -100123456789"
                            value={cfg.channel_id || ''}
                            onChange={e => setDefaultStratTg(p => ({ ...p, [ch.id]: { ...p[ch.id], channel_id: e.target.value } }))}
                            style={{ width: '100%', padding: '8px 10px', background: '#1e1b2e', border: '1px solid rgba(255,255,255,0.12)', borderRadius: 7, color: '#fff', fontSize: 12, fontFamily: 'monospace', boxSizing: 'border-box' }}
                          />
                        </div>
                      </div>
                      {/* Format de prédiction dédié à ce canal */}
                      <div style={{ marginBottom: 12 }}>
                        <label style={{ display: 'block', color: '#94a3b8', fontSize: 11, fontWeight: 600, marginBottom: 5, textTransform: 'uppercase', letterSpacing: 0.6 }}>
                          📋 Format de prédiction
                        </label>
                        <select
                          value={cfg.tg_format != null ? String(cfg.tg_format) : ''}
                          onChange={e => setDefaultStratTg(p => ({ ...p, [ch.id]: { ...p[ch.id], tg_format: e.target.value ? parseInt(e.target.value) : null } }))}
                          style={{ width: '100%', padding: '8px 10px', background: '#1e1b2e', border: '1px solid rgba(168,85,247,0.3)', borderRadius: 7, color: '#fff', fontSize: 12 }}
                        >
                          {TG_FORMATS.map(f => <option key={f.value} value={f.value}>{f.label}</option>)}
                        </select>
                      </div>
                      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
                        <button className="btn btn-ghost btn-sm" type="button" onClick={() => setDefaultChOpen(null)}>Annuler</button>
                        <button
                          className="btn btn-gold btn-sm"
                          type="button"
                          disabled={defaultTgSaving}
                          onClick={async () => {
                            await saveDefaultStratTg();
                            setDefaultChOpen(null);
                          }}
                          style={{ background: 'linear-gradient(135deg,#0369a1,#229ed9)' }}
                        >
                          {defaultTgSaving ? '⏳ Sauvegarde…' : `💾 Enregistrer ${ch.name}`}
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>

        {/* ── SECTION 2 : STRATÉGIES PERSONNALISÉES ── */}
        {strategies.length > 0 && (
        <div className="tg-admin-card" style={{ borderColor: 'rgba(168,85,247,0.4)', marginBottom: 20 }}>
          <div className="tg-admin-header">
            <span className="tg-admin-icon">⚙️</span>
            <div style={{ flex: 1 }}>
              <h2 className="tg-admin-title">Stratégies personnalisées</h2>
              <p className="tg-admin-sub">
                Configurez un bot Telegram et un canal de destination pour chacune de vos stratégies.
              </p>
            </div>
            <span className="tg-badge-connected" style={{ background: 'rgba(168,85,247,0.15)', color: '#a855f7', border: '1px solid rgba(168,85,247,0.3)' }}>
              {strategies.length} stratégie{strategies.length !== 1 ? 's' : ''}
            </span>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 0, marginTop: 8 }}>
            {strategies.map((s, idx) => {
              const tgt = s.tg_targets?.find(t => t.bot_token && t.channel_id);
              const isConfigured = !!tgt;
              const isOpen = stratChOpen === s.id;
              return (
                <div key={s.id} style={{
                  borderBottom: idx < strategies.length - 1 ? '1px solid rgba(255,255,255,0.05)' : 'none',
                  padding: '12px 0',
                }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
                    <div style={{ width: 42, height: 42, borderRadius: 10, background: 'rgba(168,85,247,0.12)', border: '2px solid rgba(168,85,247,0.3)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 18, flexShrink: 0 }}>⚙️</div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                        <span style={{ fontWeight: 700, color: '#e2e8f0', fontSize: 14 }}>{s.name}</span>
                        <span style={{ fontSize: 11, padding: '1px 7px', borderRadius: 5, fontWeight: 700, background: 'rgba(168,85,247,0.18)', color: '#a855f7', border: '1px solid rgba(168,85,247,0.35)' }}>S{s.id}</span>
                        {isConfigured ? (
                          <span style={{ fontSize: 11, padding: '2px 8px', borderRadius: 5, fontWeight: 700, background: 'rgba(34,197,94,0.15)', color: '#22c55e', border: '1px solid rgba(34,197,94,0.35)' }}>✅ Telegram configuré</span>
                        ) : (
                          <span style={{ fontSize: 11, padding: '2px 8px', borderRadius: 5, fontWeight: 700, background: 'rgba(239,68,68,0.12)', color: '#f87171', border: '1px solid rgba(239,68,68,0.3)' }}>⚠️ Non configuré</span>
                        )}
                      </div>
                      {isConfigured && (
                        <div style={{ fontSize: 11, color: '#64748b', marginTop: 3, display: 'flex', gap: 12, flexWrap: 'wrap' }}>
                          <span style={{ fontFamily: 'monospace', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>Canal : {tgt.channel_id}</span>
                          {s.tg_format && <span style={{ color: '#a78bfa' }}>· Format {s.tg_format}</span>}
                        </div>
                      )}
                    </div>
                    <button
                      type="button"
                      onClick={() => {
                        if (isOpen) { setStratChOpen(null); return; }
                        setStratChOpen(s.id);
                        setStratChForm({ bot_token: tgt?.bot_token || '', channel_id: tgt?.channel_id || '', tg_format: s.tg_format != null ? String(s.tg_format) : '' });
                      }}
                      style={{
                        fontSize: 11, padding: '6px 14px', borderRadius: 7, cursor: 'pointer', fontWeight: 700,
                        background: isOpen ? 'rgba(255,255,255,0.08)' : isConfigured ? 'rgba(34,158,217,0.15)' : 'rgba(168,85,247,0.15)',
                        color: isOpen ? '#94a3b8' : isConfigured ? '#229ed9' : '#a855f7',
                        border: `1px solid ${isOpen ? 'rgba(255,255,255,0.1)' : isConfigured ? 'rgba(34,158,217,0.4)' : 'rgba(168,85,247,0.4)'}`,
                        flexShrink: 0,
                      }}
                    >
                      {isOpen ? '✕ Fermer' : isConfigured ? '✏️ Modifier' : '➕ Ajouter'}
                    </button>
                  </div>

                  {isOpen && (
                    <div style={{ marginTop: 12, padding: '16px', background: 'rgba(255,255,255,0.03)', borderRadius: 10, border: '1px solid rgba(255,255,255,0.07)' }}>
                      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 12 }}>
                        <div>
                          <label style={{ display: 'block', color: '#94a3b8', fontSize: 11, fontWeight: 600, marginBottom: 5, textTransform: 'uppercase', letterSpacing: 0.6 }}>Token Bot Telegram</label>
                          <input
                            type="text"
                            placeholder="123456:ABCdef..."
                            value={stratChForm.bot_token}
                            onChange={e => setStratChForm(p => ({ ...p, bot_token: e.target.value }))}
                            style={{ width: '100%', padding: '8px 10px', background: '#1e1b2e', border: '1px solid rgba(255,255,255,0.12)', borderRadius: 7, color: '#fff', fontSize: 12, fontFamily: 'monospace', boxSizing: 'border-box' }}
                          />
                        </div>
                        <div>
                          <label style={{ display: 'block', color: '#94a3b8', fontSize: 11, fontWeight: 600, marginBottom: 5, textTransform: 'uppercase', letterSpacing: 0.6 }}>ID Canal Telegram</label>
                          <input
                            type="text"
                            placeholder="@moncanal ou -100123456789"
                            value={stratChForm.channel_id}
                            onChange={e => setStratChForm(p => ({ ...p, channel_id: e.target.value }))}
                            style={{ width: '100%', padding: '8px 10px', background: '#1e1b2e', border: '1px solid rgba(255,255,255,0.12)', borderRadius: 7, color: '#fff', fontSize: 12, fontFamily: 'monospace', boxSizing: 'border-box' }}
                          />
                        </div>
                      </div>
                      {/* Format de prédiction dédié à cette stratégie */}
                      <div style={{ marginBottom: 12 }}>
                        <label style={{ display: 'block', color: '#94a3b8', fontSize: 11, fontWeight: 600, marginBottom: 5, textTransform: 'uppercase', letterSpacing: 0.6 }}>
                          📋 Format de prédiction
                        </label>
                        <select
                          value={stratChForm.tg_format ?? ''}
                          onChange={e => setStratChForm(p => ({ ...p, tg_format: e.target.value }))}
                          style={{ width: '100%', padding: '8px 10px', background: '#1e1b2e', border: '1px solid rgba(168,85,247,0.3)', borderRadius: 7, color: '#fff', fontSize: 12 }}
                        >
                          {TG_FORMATS.map(f => <option key={f.value} value={f.value}>{f.label}</option>)}
                        </select>
                      </div>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        {isConfigured && (
                          <button
                            type="button"
                            onClick={async () => {
                              if (!confirm('Supprimer la configuration Telegram de cette stratégie ?')) return;
                              setStratChSaving(true);
                              try {
                                const r = await fetch(`/api/admin/strategies/${s.id}`, {
                                  method: 'PUT', credentials: 'include',
                                  headers: { 'Content-Type': 'application/json' },
                                  body: JSON.stringify({ ...s, tg_targets: [] }),
                                });
                                if (!r.ok) throw new Error('Erreur');
                                setStratChOpen(null);
                                loadStrategies();
                              } catch (e) { alert('❌ ' + e.message); }
                              finally { setStratChSaving(false); }
                            }}
                            style={{ fontSize: 11, padding: '5px 12px', borderRadius: 7, background: 'rgba(239,68,68,0.1)', color: '#f87171', border: '1px solid rgba(239,68,68,0.3)', cursor: 'pointer', fontWeight: 700 }}
                          >🗑️ Retirer Telegram</button>
                        )}
                        <div style={{ display: 'flex', gap: 8, marginLeft: 'auto' }}>
                          <button className="btn btn-ghost btn-sm" type="button" onClick={() => setStratChOpen(null)}>Annuler</button>
                          <button
                            className="btn btn-gold btn-sm"
                            type="button"
                            disabled={stratChSaving || !stratChForm.bot_token.trim() || !stratChForm.channel_id.trim()}
                            onClick={() => saveStratTg(s.id)}
                            style={{ background: 'linear-gradient(135deg,#7e22ce,#a855f7)' }}
                          >
                            {stratChSaving ? '⏳ Sauvegarde…' : `💾 Enregistrer`}
                          </button>
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
        )}

        {/* ── SECTION 3 : CANAUX TELEGRAM GLOBAUX ── */}
        <div className="tg-admin-card">
          <div className="tg-admin-header">
            <span className="tg-admin-icon">✈️</span>
            <div style={{ flex: 1 }}>
              <h2 className="tg-admin-title">Canaux Telegram globaux</h2>
              <p className="tg-admin-sub">
                Canaux partagés entre plusieurs stratégies. Les utilisateurs verront uniquement ceux qui leur sont assignés.
                {tgBotUsername && <> · Bot global : <strong>@{tgBotUsername}</strong></>}
              </p>
            </div>
            <span className="tg-badge-connected">{tgChannels.length}/10</span>
          </div>

          {tgMsg && (
            <div className={`tg-alert ${tgMsg.error ? 'tg-alert-error' : 'tg-alert-ok'}`}>{tgMsg.text}</div>
          )}

          {tgChannels.length > 0 && (
            <div className="tg-channel-list">
              {tgChannels.map((ch, idx) => (
                <div key={ch.dbId} className="tg-channel-row" style={{ borderBottom: idx < tgChannels.length - 1 ? '1px solid rgba(255,255,255,0.05)' : 'none' }}>
                  <div style={{ width: 36, height: 36, borderRadius: 8, background: 'rgba(34,158,217,0.15)', border: '1px solid rgba(34,158,217,0.35)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 16, flexShrink: 0 }}>✈️</div>
                  <div className="tg-channel-row-info" style={{ flex: 1 }}>
                    <span className="tg-channel-row-name" style={{ fontWeight: 700, color: '#e2e8f0' }}>{ch.name}</span>
                    <span className="tg-channel-row-id" style={{ fontSize: 11, color: '#64748b', fontFamily: 'monospace' }}>ID: {ch.tgId}</span>
                  </div>
                  <span style={{ fontSize: 11, padding: '3px 9px', borderRadius: 6, background: 'rgba(34,197,94,0.12)', color: '#86efac', fontWeight: 700, flexShrink: 0 }}>{ch.messageCount} msg</span>
                  <button className="btn btn-danger btn-sm" onClick={() => removeChannel(ch.dbId)} title="Supprimer ce canal">🗑️</button>
                </div>
              ))}
            </div>
          )}

          {tgChannels.length < 10 && (
            <div className="tg-connect-form" style={{ marginTop: tgChannels.length > 0 ? 16 : 0 }}>
              {tgChannels.length === 0 && (
                <div className="tg-instructions">
                  <strong>Instructions :</strong>
                  <ol>
                    <li>Créez un bot via <strong>@BotFather</strong> sur Telegram</li>
                    <li>Ajoutez le bot comme <strong>administrateur</strong> de votre canal</li>
                    <li>Entrez l'identifiant du canal ci-dessous (ex: <code>@moncanal</code> ou ID numérique)</li>
                  </ol>
                </div>
              )}
              <div className="tg-input-row">
                <input
                  className="tg-channel-input"
                  type="text"
                  placeholder="@moncanal ou -100123456789"
                  value={tgInput}
                  onChange={e => setTgInput(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && addChannel()}
                />
                <button
                  className="btn btn-gold btn-sm"
                  onClick={addChannel}
                  disabled={tgLoading || !tgInput.trim()}
                >
                  {tgLoading ? '...' : '➕ Ajouter'}
                </button>
              </div>
            </div>
          )}

          {tgChannels.length === 0 && tgChannels.length >= 10 && (
            <div style={{ textAlign: 'center', padding: '16px 0', color: '#475569', fontSize: 13 }}>
              Nombre maximum de canaux atteint (10/10).
            </div>
          )}
        </div>

        </>}

      </div>

      {/* ── PREMIUM CREDENTIALS MODAL ── */}
      {premiumModal && (
        <div className="vis-modal-overlay" onClick={() => setPremiumModal(false)}>
          <div className="vis-modal" style={{ maxWidth: 580 }} onClick={e => e.stopPropagation()}>
            <div className="vis-modal-header">
              <span className="vis-modal-title">⭐ {premiumAccounts.length} Compte{premiumAccounts.length > 1 ? 's' : ''} Premium générés</span>
              <button className="vis-modal-close" onClick={() => setPremiumModal(false)}>✕</button>
            </div>
            <div className="vis-modal-sub" style={{ marginBottom: 16 }}>
              Notez les mots de passe maintenant — ils ne seront plus affichés après fermeture.
              Abonnement : <strong>{premiumDurH}h</strong> chacun.
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8, maxHeight: 420, overflowY: 'auto' }}>
              {premiumAccounts.map((a, i) => (
                <div key={i} style={{
                  background: 'rgba(250,204,21,0.07)', border: '1px solid rgba(250,204,21,0.25)',
                  borderRadius: 10, padding: '10px 16px',
                }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 6 }}>
                    <span style={{ fontSize: 18 }}>⭐</span>
                    <span style={{ fontWeight: 700, color: '#fbbf24', fontSize: 14 }}>Premium {i + 1}</span>
                  </div>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8 }}>
                    <div>
                      <div style={{ fontSize: 10, color: '#64748b', fontWeight: 600, textTransform: 'uppercase', letterSpacing: 0.6, marginBottom: 2 }}>Identifiant</div>
                      <code style={{ fontSize: 13, color: '#e2e8f0', fontWeight: 600 }}>{a.username}</code>
                    </div>
                    <div>
                      <div style={{ fontSize: 10, color: '#64748b', fontWeight: 600, textTransform: 'uppercase', letterSpacing: 0.6, marginBottom: 2 }}>Email</div>
                      <code style={{ fontSize: 12, color: '#94a3b8' }}>{a.email}</code>
                    </div>
                    <div>
                      <div style={{ fontSize: 10, color: '#64748b', fontWeight: 600, textTransform: 'uppercase', letterSpacing: 0.6, marginBottom: 2 }}>Mot de passe</div>
                      <code style={{ fontSize: 14, color: '#22c55e', letterSpacing: 1, fontWeight: 700 }}>{a.password}</code>
                    </div>
                  </div>
                </div>
              ))}
            </div>
            <div className="vis-modal-footer" style={{ marginTop: 20 }}>
              <button className="btn btn-ghost btn-sm" onClick={() => setPremiumModal(false)}>Fermer</button>
              <button
                className="btn btn-gold btn-sm"
                onClick={() => {
                  const txt = premiumAccounts.map((a, i) =>
                    `Premium ${i+1}\nIdentifiant : ${a.username}\nEmail : ${a.email}\nMot de passe : ${a.password}\nAbonnement : ${premiumDurH}h`
                  ).join('\n\n');
                  navigator.clipboard?.writeText(txt);
                  showMsg('✅ Identifiants copiés', false);
                }}
              >
                📋 Copier tout
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── VISIBILITY MODAL ── */}
      {visModal && (
        <div className="vis-modal-overlay" onClick={() => setVisModal(null)}>
          <div className="vis-modal" style={{ maxWidth: 520 }} onClick={e => e.stopPropagation()}>
            <div className="vis-modal-header">
              <span className="vis-modal-title">🔐 Accès — {visModal.username}</span>
              <button className="vis-modal-close" onClick={() => setVisModal(null)}>✕</button>
            </div>
            <div className="vis-modal-sub">
              <strong style={{ color: '#fbbf24' }}>⚠️ Pour que l'utilisateur voie les prédictions</strong>, cochez les stratégies ci-dessous.<br/>
              Les canaux Telegram concernent uniquement les notifications bot — c'est différent.
            </div>
            {visLoading ? (
              <div style={{ padding: 24, textAlign: 'center' }}><div className="spinner" /></div>
            ) : (
              <div style={{ maxHeight: 420, overflowY: 'auto' }}>
                {/* ── Stratégies ── */}
                <div style={{ padding: '10px 16px 4px', fontSize: 11, fontWeight: 700, color: '#fbbf24', letterSpacing: 1, textTransform: 'uppercase' }}>
                  🎯 Canaux de prédiction (Dashboard)
                </div>
                <div className="vis-channels-list">
                  {[...ALL_STRATEGIES, ...strategies.map(s => ({ id: `S${s.id}`, name: s.name, emoji: '⚙' }))].map(st => {
                    const assignedS = visStratData[visModal.userId] || new Set();
                    const isOn = assignedS.has(st.id);
                    return (
                      <label key={st.id} className={`vis-channel-toggle ${isOn ? 'visible' : 'hidden'}`}>
                        <input type="checkbox" checked={isOn} onChange={() => toggleVisStrategy(visModal.userId, st.id)} />
                        <span className="vis-channel-icon">{st.emoji}</span>
                        <span className="vis-channel-name">{st.name} <span style={{ color: '#64748b', fontSize: 11 }}>({st.id})</span></span>
                        <span className={`vis-channel-badge ${isOn ? 'on' : 'off'}`}>{isOn ? 'Assigné' : 'Non assigné'}</span>
                      </label>
                    );
                  })}
                </div>

                {/* ── Canaux Telegram ── */}
                <div style={{ padding: '14px 16px 4px', fontSize: 11, fontWeight: 700, color: '#94a3b8', letterSpacing: 1, textTransform: 'uppercase' }}>
                  📡 Canaux Telegram (notifications bot uniquement)
                </div>
                {tgChannels.length === 0 ? (
                  <div style={{ padding: '8px 16px 16px', color: '#64748b', fontSize: 13 }}>Aucun canal Telegram configuré.</div>
                ) : (
                  <div className="vis-channels-list">
                    {tgChannels.map(ch => {
                      const assigned = visData[visModal.userId] || new Set();
                      const isAssigned = assigned.has(ch.dbId);
                      return (
                        <label key={ch.dbId} className={`vis-channel-toggle ${isAssigned ? 'visible' : 'hidden'}`}>
                          <input type="checkbox" checked={isAssigned} onChange={() => toggleVisChannel(visModal.userId, ch.dbId)} />
                          <span className="vis-channel-icon">📡</span>
                          <span className="vis-channel-name">{ch.name}</span>
                          <span className={`vis-channel-badge ${isAssigned ? 'on' : 'off'}`}>{isAssigned ? 'Assigné' : 'Non assigné'}</span>
                        </label>
                      );
                    })}
                  </div>
                )}
              </div>
            )}
            <div className="vis-modal-footer">
              <button className="btn btn-ghost btn-sm" onClick={() => setVisModal(null)}>Annuler</button>
              <button className="btn btn-gold btn-sm" onClick={saveVisibility}>💾 Enregistrer</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
