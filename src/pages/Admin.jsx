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
  const [maxRattrapage, setMaxRattrapage] = useState(2);
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
      { label: 'Contraire total',  desc: '♠→♥ · ♥→♠ · ♦→♣ · ♣→♦', map: { '♠':'♥','♥':'♠','♦':'♣','♣':'♦' } },
      { label: 'Même couleur',     desc: '♠→♣ · ♣→♠ · ♥→♦ · ♦→♥', map: { '♠':'♣','♣':'♠','♥':'♦','♦':'♥' } },
      { label: 'Même forme',       desc: '♠→♦ · ♦→♠ · ♥→♣ · ♣→♥', map: { '♠':'♦','♦':'♠','♥':'♣','♣':'♥' } },
      { label: 'Identique',        desc: '♠→♠ · ♥→♥ · ♦→♦ · ♣→♣', map: { '♠':'♠','♥':'♥','♦':'♦','♣':'♣' } },
    ],
    apparents: [
      { label: 'Miroir contraire', desc: '♠→♥ · ♥→♠ · ♦→♣ · ♣→♦', map: { '♠':'♥','♥':'♠','♦':'♣','♣':'♦' } },
      { label: 'Miroir couleur',   desc: '♠→♣ · ♣→♠ · ♥→♦ · ♦→♥', map: { '♠':'♣','♣':'♠','♥':'♦','♦':'♥' } },
      { label: 'Miroir forme',     desc: '♠→♦ · ♦→♠ · ♥→♣ · ♣→♥', map: { '♠':'♦','♦':'♠','♥':'♣','♣':'♥' } },
      { label: 'Rotation ↻',       desc: '♠→♥→♦→♣→♠',              map: { '♠':'♥','♥':'♦','♦':'♣','♣':'♠' } },
    ],
  };
  // stratType: 'simple' = prédiction locale seulement; 'telegram' = envoie vers canal TG custom
  const BLANK_FORM = { name: '', threshold: 5, mode: 'manquants', mappings: { '♠':'♥','♥':'♠','♦':'♣','♣':'♦' }, visibility: 'admin', enabled: true, tg_targets: [], stratType: 'simple', exceptions: [] };

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

  const loadMsgFormat = useCallback(async () => {
    try {
      const r = await fetch('/api/admin/msg-format', { credentials: 'include' });
      if (r.ok) { const d = await r.json(); setMsgFormat(d.format_id || 1); }
    } catch {}
  }, []);

  const loadMaxR = useCallback(async () => {
    try {
      const r = await fetch('/api/admin/max-rattrapage', { credentials: 'include' });
      if (r.ok) { const d = await r.json(); setMaxRattrapage(d.max_rattrapage ?? 2); }
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
    setStratForm({ ...BLANK_FORM });
    setStratOpen(true);
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
    setStratForm({ name: s.name, threshold: s.threshold, mode: s.mode, mappings: { ...s.mappings }, visibility: s.visibility, enabled: s.enabled, tg_targets, stratType, exceptions });
    setStratOpen(true);
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

  useEffect(() => { loadUsers(); loadChannels(); loadTokenInfo(); loadStrategies(); loadMsgFormat(); loadMaxR(); loadStrategyRoutes(); }, [loadUsers, loadChannels, loadTokenInfo, loadStrategies, loadMsgFormat, loadMaxR, loadStrategyRoutes]);

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
        <Link to="/" className="navbar-brand">BACCARAT PRO ✨</Link>
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
          <div className={`alert ${message.error ? 'alert-error' : 'alert-success'}`} style={{ marginBottom: 20 }}>
            {message.text}
          </div>
        )}

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
              perdu:   `⚜ #N${G} Игрок    +${sup} ⚜\n◽Масть ♠️\n◼️ Результат ❌ PERDU ❌`,
            },
            {
              id: 2, label: 'Premium', icon: '🎲',
              preview: `🎲𝐁𝐀𝐂𝐂𝐀𝐑𝐀 𝐏𝐑𝐄𝐌𝐈𝐔𝐌+${maxRattrapage} ✨🎲\nGame ${G} :♠️\nEn cours :⌛`,
              result:  `🎲𝐁𝐀𝐂𝐂𝐀𝐑𝐀 𝐏𝐑𝐄𝐌𝐈𝐔𝐌+${maxRattrapage} ✨🎲\nGame ${G} :♠️\nStatut :✅ ${RE[0]}`,
              perdu:   `🎲𝐁𝐀𝐂𝐂𝐀𝐑𝐀 𝐏𝐑𝐄𝐌𝐈𝐔𝐌+${maxRattrapage} ✨🎲\nGame ${G} :♠️\nStatut :❌ PERDU ❌`,
            },
            {
              id: 3, label: 'Baccara Pro', icon: '🃏',
              preview: `𝐁𝐀𝐂𝐂𝐀𝐑𝐀 𝐏𝐑𝐎 ✨\n🎮GAME: #N${G}\n🃏Carte ♠️:⌛\nMode: Dogon ${maxRattrapage}`,
              result:  `𝐁𝐀𝐂𝐂𝐀𝐑𝐀 𝐏𝐑𝐎 ✨\n🎮GAME: #N${G}\n🃏Carte ♠️:✅ ${RE[0]}\nMode: Dogon ${maxRattrapage}`,
              perdu:   `𝐁𝐀𝐂𝐂𝐀𝐑𝐀 𝐏𝐑𝐎 ✨\n🎮GAME: #N${G}\n🃏Carte ♠️:❌ PERDU ❌\nMode: Dogon ${maxRattrapage}`,
            },
            {
              id: 4, label: 'Prédiction', icon: '🎰',
              preview: `🎰 PRÉDICTION #${G}\n🎯 Couleur: ♠️ Pique\n📊 Statut: En cours ⏳\n🔍 Vérification en cours`,
              result:  `🎰 PRÉDICTION #${G}\n🎯 Couleur: ♠️ Pique\n📊 Statut: ✅ ${RE[0]}\n🔍 Vérifié ✓`,
              perdu:   `🎰 PRÉDICTION #${G}\n🎯 Couleur: ♠️ Pique\n📊 Statut: ❌ PERDU ❌\n🔍 Résultat final`,
            },
            {
              id: 5, label: 'Barre de progression', icon: '🟦',
              preview: `🎰 PRÉDICTION #${G}\n🎯 Couleur: ♠️ Pique\n\n🔍 Vérification jeu #${G}\n${barP}\n⏳ Analyse...`,
              result:  `🎰 PRÉDICTION #${G}\n🎯 Couleur: ♠️ Pique\n\n🔍 Vérification jeu #${G}\n🟩${barP.slice(2)}\n✅ Gagné en R0`,
              perdu:   `🎰 PRÉDICTION #${G}\n🎯 Couleur: ♠️ Pique\n\n🔍 Vérification jeu #${G}\n${barLost}\n❌ PERDU ❌`,
            },
            {
              id: 6, label: 'Classique', icon: '✨',
              preview: `🏆 PRÉDICTION #${G}\n\n🎯 Couleur: ♠️ Pique\n⏳ Statut: En cours`,
              result:  `🏆 PRÉDICTION #${G}\n\n🎯 Couleur: ♠️ Pique\n✅ Statut: ✅ ${RE[0]} GAGNÉ`,
              perdu:   `🏆 PRÉDICTION #${G}\n\n🎯 Couleur: ♠️ Pique\nStatut: ❌ PERDU ❌`,
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
                <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginLeft: 'auto' }}>
                  {[0,1,2,3,4,5].map(n => (
                    <button
                      key={n}
                      onClick={() => saveMaxR(n)}
                      disabled={maxRSaving}
                      style={{
                        width: 44, height: 44, borderRadius: 8, border: 'none', cursor: 'pointer',
                        fontWeight: 800, fontSize: 16,
                        background: maxRattrapage === n ? '#f59e0b' : 'rgba(255,255,255,0.06)',
                        color: maxRattrapage === n ? '#000' : '#94a3b8',
                        transition: 'all 0.15s',
                      }}
                    >
                      {['⁰','¹','²','³','⁴','⁵'][n]}
                    </button>
                  ))}
                </div>
                <div style={{ fontSize: 12, color: '#fbbf24', minWidth: 80 }}>
                  Actuel : <strong>+{['⁰','¹','²','³','⁴','⁵'][maxRattrapage]}</strong> ({maxRattrapage} rattrap.)
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

        {/* ── STRATÉGIES PERSONNALISÉES ── */}
        <div className="tg-admin-card" style={{ borderColor: 'rgba(168,85,247,0.4)' }}>
          <div className="tg-admin-header">
            <span className="tg-admin-icon">⚙️</span>
            <div>
              <h2 className="tg-admin-title">Stratégies personnalisées</h2>
              <p className="tg-admin-sub">
                Créez des canaux de prédiction sur mesure (Stratégie 7, 8, 9…). Chaque stratégie a son propre seuil B, son mode et ses mappings.
              </p>
            </div>
            <button
              className="btn btn-gold btn-sm"
              style={{ background: 'linear-gradient(135deg,#7e22ce,#a855f7)', minWidth: 180 }}
              onClick={stratOpen && stratEditing === null ? cancelStratForm : openCreate}
            >
              {stratOpen && stratEditing === null ? '✕ Annuler' : '➕ Nouvelle stratégie'}
            </button>
          </div>

          {stratMsg && (
            <div className={`tg-alert ${stratMsg.error ? 'tg-alert-error' : 'tg-alert-ok'}`}>{stratMsg.text}</div>
          )}

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
                      B={s.threshold} · {s.mode === 'manquants' ? 'Absences' : 'Apparitions'} · {Object.entries(s.mappings).map(([k,v]) => `${k}→${v}`).join('  ')}
                    </div>
                    {s.tg_targets?.some(t => t.bot_token && t.channel_id) && (
                      <div style={{ fontSize: 11, color: '#64748b', marginTop: 2 }}>
                        Canaux : {s.tg_targets.filter(t=>t.channel_id).map(t => t.channel_id).join(', ')}
                      </div>
                    )}
                  </div>
                  <button
                    onClick={() => toggleStrat(s)}
                    style={{ fontSize: 12, padding: '4px 10px', borderRadius: 6, border: 'none', cursor: 'pointer', fontWeight: 600,
                      background: s.enabled ? 'rgba(34,197,94,0.2)' : 'rgba(100,100,120,0.2)',
                      color: s.enabled ? '#22c55e' : '#6b7280',
                    }}
                  >{s.enabled ? '● Actif' : '○ Inactif'}</button>
                  <button className="btn btn-ghost btn-sm" onClick={() => openEdit(s)} title="Modifier">✏️</button>
                  <button className="btn btn-danger btn-sm" onClick={() => deleteStrat(s.id, s.name)} title="Supprimer">🗑️</button>
                </div>
              ))}
            </div>
          )}

          {strategies.length === 0 && !stratOpen && (
            <div style={{ textAlign: 'center', color: '#6b7280', padding: '28px 0', fontSize: 14 }}>
              Aucune stratégie personnalisée. Cliquez sur «&nbsp;Nouvelle stratégie&nbsp;» pour commencer.
            </div>
          )}

          {/* Formulaire de création / modification */}
          {stratOpen && (
            <div style={{ marginTop: 20, background: 'rgba(168,85,247,0.05)', border: '1px solid rgba(168,85,247,0.25)', borderRadius: 12, padding: 20 }}>
              <div style={{ fontWeight: 700, color: '#a855f7', marginBottom: 16, fontSize: 14 }}>
                {stratEditing !== null ? `✏️ Modifier Stratégie S${stratEditing}` : '➕ Nouvelle stratégie'}
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

                {/* Mode */}
                <div>
                  <label style={{ display: 'block', color: '#94a3b8', fontSize: 12, marginBottom: 5 }}>Mode</label>
                  <select value={stratForm.mode} onChange={e => setStratForm(p => ({ ...p, mode: e.target.value }))}
                    style={{ width: '100%', padding: '8px 12px', background: '#1e1b2e', border: '1px solid rgba(168,85,247,0.35)', borderRadius: 8, color: '#fff', fontSize: 13 }}>
                    <option value="manquants">Manquants — prédit l'absent</option>
                    <option value="apparents">Apparents — prédit le fréquent</option>
                  </select>
                </div>

                {/* Seuil B */}
                <div>
                  <label style={{ display: 'block', color: '#94a3b8', fontSize: 12, marginBottom: 5 }}>Seuil B (1–50)</label>
                  <input type="number" min={1} max={50} value={stratForm.threshold}
                    onChange={e => setStratForm(p => ({ ...p, threshold: parseInt(e.target.value) || 1 }))}
                    style={{ width: '100%', padding: '8px 12px', background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(168,85,247,0.35)', borderRadius: 8, color: '#fff', fontSize: 14 }}
                  />
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

              {/* ── Type de stratégie : Simple vs Telegram ── */}
              <div style={{ marginTop: 16, marginBottom: 4 }}>
                <label style={{ display: 'block', color: '#94a3b8', fontSize: 12, marginBottom: 8 }}>
                  Type de stratégie
                </label>
                <div style={{ display: 'flex', gap: 10 }}>
                  {[
                    { val: 'simple', icon: '🧮', title: 'Prédiction locale', desc: 'Affiché dans le tableau de bord uniquement. Aucun message Telegram envoyé.' },
                    { val: 'telegram', icon: '✈️', title: 'Envoi Telegram', desc: 'Les prédictions sont envoyées vers un ou plusieurs canaux Telegram via un bot dédié. Les messages sont édités en place après vérification.' },
                  ].map(opt => {
                    const active = stratForm.stratType === opt.val;
                    return (
                      <button
                        key={opt.val}
                        type="button"
                        onClick={() => setStratForm(p => ({
                          ...p,
                          stratType: opt.val,
                          tg_targets: opt.val === 'simple' ? [] : (p.tg_targets.length ? p.tg_targets : [{ bot_token: '', channel_id: '' }]),
                        }))}
                        style={{
                          flex: 1, textAlign: 'left', padding: '12px 14px', borderRadius: 10, cursor: 'pointer',
                          background: active
                            ? (opt.val === 'telegram' ? 'rgba(34,158,217,0.15)' : 'rgba(168,85,247,0.15)')
                            : 'rgba(255,255,255,0.03)',
                          border: `2px solid ${active
                            ? (opt.val === 'telegram' ? '#229ed9' : '#a855f7')
                            : 'rgba(255,255,255,0.08)'}`,
                          transition: 'all 0.18s',
                        }}
                      >
                        <div style={{ fontSize: 18, marginBottom: 4 }}>{opt.icon}</div>
                        <div style={{ fontWeight: 700, fontSize: 12, color: active ? '#e2e8f0' : '#64748b', marginBottom: 3 }}>{opt.title}</div>
                        <div style={{ fontSize: 10, color: '#475569', lineHeight: 1.45 }}>{opt.desc}</div>
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* ── Section Telegram (visible seulement si stratType === 'telegram') ── */}
              {stratForm.stratType === 'telegram' && (
                <div style={{ marginTop: 14, background: 'rgba(34,158,217,0.06)', border: '2px solid rgba(34,158,217,0.3)', borderRadius: 10, padding: 16 }}>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
                    <div>
                      <div style={{ color: '#229ed9', fontSize: 13, fontWeight: 700 }}>✈️ Canaux Telegram cibles</div>
                      <div style={{ color: '#64748b', fontSize: 11, marginTop: 2 }}>
                        Chaque prédiction est envoyée via le token bot configuré, puis le message est <strong style={{ color: '#93c5fd' }}>édité automatiquement</strong> après vérification.
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => setStratForm(p => ({ ...p, tg_targets: [...(p.tg_targets || []), { bot_token: '', channel_id: '' }] }))}
                      style={{ fontSize: 11, padding: '5px 12px', borderRadius: 6, border: '1px solid rgba(34,158,217,0.5)', background: 'rgba(34,158,217,0.15)', color: '#229ed9', cursor: 'pointer', fontWeight: 700, whiteSpace: 'nowrap' }}
                    >＋ Ajouter</button>
                  </div>

                  {(!stratForm.tg_targets || stratForm.tg_targets.length === 0) && (
                    <div style={{ fontSize: 12, color: '#475569', padding: '8px 0', textAlign: 'center' }}>
                      Aucune cible. Cliquez sur «&nbsp;＋ Ajouter&nbsp;» pour configurer un canal.
                    </div>
                  )}

                  {(stratForm.tg_targets || []).map((tgt, i) => {
                    const isValid = tgt.bot_token?.trim() && tgt.channel_id?.trim();
                    return (
                      <div key={i} style={{
                        background: isValid ? 'rgba(34,158,217,0.08)' : 'rgba(255,255,255,0.03)',
                        borderRadius: 8, padding: '12px 12px 10px',
                        border: `1px solid ${isValid ? 'rgba(34,158,217,0.35)' : 'rgba(239,68,68,0.2)'}`,
                        marginBottom: 8,
                      }}>
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
                          <span style={{ fontSize: 11, fontWeight: 700, color: isValid ? '#229ed9' : '#6b7280' }}>
                            {isValid ? '✅' : '⚠️'} Cible {i + 1}
                          </span>
                          <button
                            type="button"
                            onClick={() => setStratForm(p => ({ ...p, tg_targets: p.tg_targets.filter((_, j) => j !== i) }))}
                            style={{ padding: '3px 8px', borderRadius: 5, border: '1px solid rgba(239,68,68,0.3)', background: 'rgba(239,68,68,0.1)', color: '#f87171', cursor: 'pointer', fontSize: 12 }}
                          >✕ Supprimer</button>
                        </div>
                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                          <div>
                            <label style={{ display: 'block', color: '#94a3b8', fontSize: 10, marginBottom: 3 }}>
                              Token bot (via @BotFather) *
                            </label>
                            <input
                              type="password"
                              placeholder="123456789:AAFxxx…"
                              value={tgt.bot_token}
                              onChange={e => setStratForm(p => {
                                const t = [...p.tg_targets];
                                t[i] = { ...t[i], bot_token: e.target.value };
                                return { ...p, tg_targets: t };
                              })}
                              style={{ width: '100%', padding: '7px 10px', background: 'rgba(255,255,255,0.05)', border: `1px solid ${tgt.bot_token ? 'rgba(34,158,217,0.4)' : 'rgba(239,68,68,0.3)'}`, borderRadius: 6, color: '#fff', fontSize: 12, boxSizing: 'border-box', fontFamily: 'monospace' }}
                            />
                          </div>
                          <div>
                            <label style={{ display: 'block', color: '#94a3b8', fontSize: 10, marginBottom: 3 }}>
                              ID du canal *
                            </label>
                            <input
                              type="text"
                              placeholder="@moncanal ou -100123456789"
                              value={tgt.channel_id}
                              onChange={e => setStratForm(p => {
                                const t = [...p.tg_targets];
                                t[i] = { ...t[i], channel_id: e.target.value };
                                return { ...p, tg_targets: t };
                              })}
                              style={{ width: '100%', padding: '7px 10px', background: 'rgba(255,255,255,0.05)', border: `1px solid ${tgt.channel_id ? 'rgba(34,158,217,0.4)' : 'rgba(239,68,68,0.3)'}`, borderRadius: 6, color: '#fff', fontSize: 12, boxSizing: 'border-box', fontFamily: 'monospace' }}
                            />
                          </div>
                        </div>
                      </div>
                    );
                  })}

                  <div style={{ marginTop: 8, fontSize: 10, color: '#475569', lineHeight: 1.5 }}>
                    Le bot doit être <strong style={{ color: '#64748b' }}>administrateur</strong> du canal cible.<br />
                    Créez des bots via <strong style={{ color: '#64748b' }}>@BotFather</strong> sur Telegram.
                  </div>
                </div>
              )}

              {/* Presets de combinaison */}
              <div style={{ marginTop: 16 }}>
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
              </div>

              {/* Mappings manuels */}
              <div style={{ marginTop: 16 }}>
                <label style={{ display: 'block', color: '#94a3b8', fontSize: 12, marginBottom: 8 }}>
                  Mapping manuel — si suit absent/fréquent → prédire :
                </label>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                  {SUITS.map(suit => (
                    <div key={suit} style={{ display: 'flex', alignItems: 'center', gap: 8,
                      background: 'rgba(255,255,255,0.03)', borderRadius: 8, padding: '8px 12px',
                      border: '1px solid rgba(255,255,255,0.07)' }}>
                      <span style={{ color: ['♥','♦'].includes(suit) ? '#ef4444' : '#e2e8f0', fontSize: 20, minWidth: 24 }}>{suit}</span>
                      <span style={{ color: '#6b7280' }}>→</span>
                      <select
                        value={stratForm.mappings[suit] || '♠'}
                        onChange={e => setStratForm(p => ({ ...p, mappings: { ...p.mappings, [suit]: e.target.value } }))}
                        style={{ flex: 1, padding: '5px 8px', background: '#1e1b2e',
                          border: '1px solid rgba(168,85,247,0.2)', borderRadius: 6, color: '#fff', fontSize: 13 }}>
                        {SUITS.map(s => <option key={s} value={s}>{SUIT_LABELS[s]}</option>)}
                      </select>
                    </div>
                  ))}
                </div>
              </div>

              {/* ── Section Exceptions ─────────────────────────────── */}
              <div style={{ marginTop: 20, padding: '14px 16px', background: 'rgba(239,68,68,0.05)', borderRadius: 10, border: '1px solid rgba(239,68,68,0.2)' }}>
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
                  ];

                  const needsValue  = ['consec_appearances', 'recent_frequency', 'max_consec_losses', 'trigger_overload'].includes(ex.type);
                  const needsWindow = ['recent_frequency', 'trigger_overload'].includes(ex.type);
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
                    </div>
                  );
                })}
              </div>

              <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end', marginTop: 20 }}>
                <button className="btn btn-ghost btn-sm" onClick={cancelStratForm}>Annuler</button>
                <button
                  className="btn btn-gold btn-sm"
                  style={{ background: 'linear-gradient(135deg,#7e22ce,#a855f7)', minWidth: 160 }}
                  onClick={saveStrat}
                  disabled={stratSaving || !stratForm.name.trim()}
                >
                  {stratSaving ? '⏳ Enregistrement…' : stratEditing !== null ? '💾 Mettre à jour' : `✅ Créer Stratégie ${strategies.length > 0 ? Math.max(...strategies.map(s=>s.id))+1 : 7}`}
                </button>
              </div>
            </div>
          )}
        </div>

        {/* ── ROUTAGE STRATÉGIES PAR DÉFAUT → CANAUX ── */}
        <div className="tg-admin-card" style={{ borderColor: 'rgba(34,158,217,0.4)' }}>
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
        </div>

        {/* ── TELEGRAM CHANNELS ── */}
        <div className="tg-admin-card">
          <div className="tg-admin-header">
            <span className="tg-admin-icon">✈️</span>
            <div>
              <h2 className="tg-admin-title">Canaux Telegram</h2>
              <p className="tg-admin-sub">
                Ajoutez jusqu'à 10 canaux. Les utilisateurs verront les canaux autorisés en temps réel.
                {tgBotUsername && <> · Bot : <strong>@{tgBotUsername}</strong></>}
              </p>
            </div>
            <span className="tg-badge-connected">{tgChannels.length}/10 canal{tgChannels.length !== 1 ? 'aux' : ''}</span>
          </div>

          {tgMsg && (
            <div className={`tg-alert ${tgMsg.error ? 'tg-alert-error' : 'tg-alert-ok'}`}>{tgMsg.text}</div>
          )}

          {/* Channel list */}
          {tgChannels.length > 0 && (
            <div className="tg-channel-list">
              {tgChannels.map(ch => (
                <div key={ch.dbId} className="tg-channel-row">
                  <div className="tg-channel-row-icon">✈️</div>
                  <div className="tg-channel-row-info">
                    <span className="tg-channel-row-name">{ch.name}</span>
                    <span className="tg-channel-row-id">ID: {ch.tgId}</span>
                  </div>
                  <span className="tg-channel-row-count">{ch.messageCount} msg</span>
                  <button className="btn btn-danger btn-sm" onClick={() => removeChannel(ch.dbId)}>🗑️</button>
                </div>
              ))}
            </div>
          )}

          {/* Add channel form */}
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
        </div>
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
              Définissez les stratégies et canaux Telegram accessibles.<br/>
              Par défaut, rien n'est visible — assignez manuellement.
            </div>
            {visLoading ? (
              <div style={{ padding: 24, textAlign: 'center' }}><div className="spinner" /></div>
            ) : (
              <div style={{ maxHeight: 420, overflowY: 'auto' }}>
                {/* ── Stratégies ── */}
                <div style={{ padding: '10px 16px 4px', fontSize: 11, fontWeight: 700, color: '#94a3b8', letterSpacing: 1, textTransform: 'uppercase' }}>
                  Stratégies de prédiction
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
                  Canaux Telegram
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
