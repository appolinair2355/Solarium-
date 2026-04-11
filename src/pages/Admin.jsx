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

  // Channel visibility modal
  const [visModal, setVisModal] = useState(null); // { userId, username }
  const [visData, setVisData] = useState({}); // { userId: Set<dbId> of hidden }
  const [visLoading, setVisLoading] = useState(false);

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

  const generatePremium = async () => {
    if (!confirm('Regénérer les 5 comptes premium ? Les anciens mots de passe seront remplacés.')) return;
    setPremiumLoading(true);
    try {
      const r = await fetch('/api/admin/generate-premium', { method: 'POST', credentials: 'include' });
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
  const BLANK_FORM = { name: '', threshold: 5, mode: 'manquants', mappings: { '♠':'♥','♥':'♠','♦':'♣','♣':'♦' }, visibility: 'admin', enabled: true, tg_targets: [] };

  const [strategies, setStrategies] = useState([]);
  const [stratForm, setStratForm] = useState(BLANK_FORM); // current create/edit form
  const [stratEditing, setStratEditing] = useState(null); // id being edited, null = creating
  const [stratMsg, setStratMsg] = useState('');
  const [stratSaving, setStratSaving] = useState(false);
  const [stratOpen, setStratOpen] = useState(false); // form panel open?

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
    setStratForm({ name: s.name, threshold: s.threshold, mode: s.mode, mappings: { ...s.mappings }, visibility: s.visibility, enabled: s.enabled, tg_targets });
    setStratOpen(true);
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

  useEffect(() => { loadUsers(); loadChannels(); loadTokenInfo(); loadStrategies(); loadMsgFormat(); loadMaxR(); }, [loadUsers, loadChannels, loadTokenInfo, loadStrategies, loadMsgFormat, loadMaxR]);

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

  // Visibility modal (opt-in : l'admin assigne les canaux à chaque utilisateur)
  const openVisModal = async u => {
    setVisModal({ userId: u.id, username: u.username });
    setVisLoading(true);
    const res = await fetch(`/api/telegram/users/${u.id}/visibility`, { credentials: 'include' });
    if (res.ok) {
      const d = await res.json();
      setVisData(p => ({ ...p, [u.id]: new Set(d.visible) }));
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

  const saveVisibility = async () => {
    const { userId } = visModal;
    const visible = [...(visData[userId] || new Set())];
    const res = await fetch(`/api/telegram/users/${userId}/visibility`, {
      method: 'PUT', credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ visible_channel_ids: visible }),
    });
    if (res.ok) { showMsg('Canaux assignés avec succès'); setVisModal(null); }
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
            <div>
              <h2 className="tg-admin-title">Comptes Premium</h2>
              <p className="tg-admin-sub">
                Génère 5 comptes prêts à l'emploi (Premium 1 à 5) avec abonnement de 750h. Les mots de passe actuels seront remplacés.
              </p>
            </div>
            <button
              className="btn btn-gold btn-sm"
              style={{ minWidth: 200 }}
              onClick={generatePremium}
              disabled={premiumLoading}
            >
              {premiumLoading ? '⏳ Génération...' : '⭐ Générer 5 comptes premium'}
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
                            {tgChannels.length > 0 && (
                              <button className="btn btn-tg btn-sm" onClick={() => openVisModal(u)}>📡 Canaux</button>
                            )}
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
                      {s.tg_targets?.length > 0 && (
                        <span style={{ fontSize: 11, padding: '2px 7px', borderRadius: 5, fontWeight: 600,
                          background: 'rgba(34,158,217,0.15)', color: '#229ed9',
                        }} title={s.tg_targets.map(t => t.channel_id).join(', ')}>
                          ✈️ {s.tg_targets.length} cible{s.tg_targets.length > 1 ? 's' : ''} TG
                        </span>
                      )}
                    </div>
                    <div style={{ fontSize: 12, color: '#94a3b8', marginTop: 2 }}>
                      B={s.threshold} · {s.mode} · {Object.entries(s.mappings).map(([k,v]) => `${k}→${v}`).join('  ')}
                    </div>
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

              {/* Telegram multi-cibles — optionnel */}
              <div style={{ marginTop: 16, background: 'rgba(34,158,217,0.06)', border: '1px solid rgba(34,158,217,0.2)', borderRadius: 10, padding: 14 }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
                  <div style={{ color: '#229ed9', fontSize: 12, fontWeight: 700 }}>
                    ✈️ Envoi Telegram automatique
                    <span style={{ fontWeight: 400, color: '#64748b', marginLeft: 6 }}>— optionnel · plusieurs cibles possibles</span>
                  </div>
                  <button
                    type="button"
                    onClick={() => setStratForm(p => ({ ...p, tg_targets: [...(p.tg_targets || []), { bot_token: '', channel_id: '' }] }))}
                    style={{ fontSize: 11, padding: '4px 10px', borderRadius: 6, border: '1px solid rgba(34,158,217,0.4)', background: 'rgba(34,158,217,0.12)', color: '#229ed9', cursor: 'pointer', fontWeight: 600 }}
                  >
                    ＋ Ajouter cible
                  </button>
                </div>

                {(!stratForm.tg_targets || stratForm.tg_targets.length === 0) && (
                  <div style={{ fontSize: 12, color: '#475569', padding: '8px 0' }}>
                    Aucune cible. Cliquez sur «&nbsp;Ajouter cible&nbsp;» pour envoyer les prédictions de cette stratégie vers un ou plusieurs canaux Telegram.
                  </div>
                )}

                {(stratForm.tg_targets || []).map((tgt, i) => (
                  <div key={i} style={{
                    display: 'grid', gridTemplateColumns: '1fr 1fr auto',
                    gap: 8, marginBottom: 8, alignItems: 'end',
                    background: 'rgba(255,255,255,0.03)', borderRadius: 8, padding: '10px 10px 8px',
                    border: '1px solid rgba(34,158,217,0.18)',
                  }}>
                    <div>
                      <label style={{ display: 'block', color: '#94a3b8', fontSize: 10, marginBottom: 3 }}>
                        Cible {i + 1} — Token bot
                      </label>
                      <input
                        type="text"
                        placeholder="123456789:AAFxxx…"
                        value={tgt.bot_token}
                        onChange={e => setStratForm(p => {
                          const t = [...p.tg_targets];
                          t[i] = { ...t[i], bot_token: e.target.value };
                          return { ...p, tg_targets: t };
                        })}
                        style={{ width: '100%', padding: '6px 9px', background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(34,158,217,0.3)', borderRadius: 6, color: '#fff', fontSize: 11, boxSizing: 'border-box', fontFamily: 'monospace' }}
                      />
                    </div>
                    <div>
                      <label style={{ display: 'block', color: '#94a3b8', fontSize: 10, marginBottom: 3 }}>
                        ID du canal
                      </label>
                      <input
                        type="text"
                        placeholder="@moncanal ou -100123…"
                        value={tgt.channel_id}
                        onChange={e => setStratForm(p => {
                          const t = [...p.tg_targets];
                          t[i] = { ...t[i], channel_id: e.target.value };
                          return { ...p, tg_targets: t };
                        })}
                        style={{ width: '100%', padding: '6px 9px', background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(34,158,217,0.3)', borderRadius: 6, color: '#fff', fontSize: 11, boxSizing: 'border-box', fontFamily: 'monospace' }}
                      />
                    </div>
                    <button
                      type="button"
                      onClick={() => setStratForm(p => ({ ...p, tg_targets: p.tg_targets.filter((_, j) => j !== i) }))}
                      style={{ padding: '6px 10px', borderRadius: 6, border: '1px solid rgba(239,68,68,0.3)', background: 'rgba(239,68,68,0.1)', color: '#f87171', cursor: 'pointer', fontSize: 13 }}
                      title="Supprimer cette cible"
                    >🗑️</button>
                  </div>
                ))}

                <div style={{ marginTop: 6, fontSize: 10, color: '#475569', lineHeight: 1.5 }}>
                  Chaque cible = un bot Telegram différent + un canal cible.<br />
                  Créez des bots via <strong style={{ color: '#64748b' }}>@BotFather</strong> et ajoutez-les comme administrateurs de chaque canal.
                </div>
              </div>

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
          <div className="vis-modal" style={{ maxWidth: 520 }} onClick={e => e.stopPropagation()}>
            <div className="vis-modal-header">
              <span className="vis-modal-title">⭐ Comptes Premium générés</span>
              <button className="vis-modal-close" onClick={() => setPremiumModal(false)}>✕</button>
            </div>
            <div className="vis-modal-sub" style={{ marginBottom: 16 }}>
              Notez les mots de passe maintenant — ils ne seront plus affichés. Abonnement : <strong>750 heures</strong> chacun.
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {premiumAccounts.map((a, i) => (
                <div key={i} style={{
                  display: 'flex', alignItems: 'center', gap: 12,
                  background: 'rgba(250,204,21,0.07)', border: '1px solid rgba(250,204,21,0.25)',
                  borderRadius: 10, padding: '10px 16px'
                }}>
                  <span style={{ fontSize: 20, minWidth: 28 }}>⭐</span>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontWeight: 700, color: '#fbbf24', fontSize: 14 }}>Premium {i + 1}</div>
                    <div style={{ fontSize: 12, color: '#94a3b8', marginTop: 2 }}>
                      Login : <code style={{ color: '#e2e8f0' }}>{a.username}</code>
                    </div>
                  </div>
                  <div style={{ textAlign: 'right' }}>
                    <div style={{ fontSize: 11, color: '#94a3b8' }}>Mot de passe</div>
                    <code style={{ fontSize: 15, color: '#22c55e', letterSpacing: 1 }}>{a.password}</code>
                  </div>
                </div>
              ))}
            </div>
            <div className="vis-modal-footer" style={{ marginTop: 20 }}>
              <button className="btn btn-ghost btn-sm" onClick={() => setPremiumModal(false)}>Fermer</button>
              <button
                className="btn btn-gold btn-sm"
                onClick={() => {
                  const txt = premiumAccounts.map((a, i) => `Premium ${i+1}\nLogin: ${a.username}\nMot de passe: ${a.password}\nExpire: 750h`).join('\n\n');
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
          <div className="vis-modal" onClick={e => e.stopPropagation()}>
            <div className="vis-modal-header">
              <span className="vis-modal-title">📡 Canaux visibles — {visModal.username}</span>
              <button className="vis-modal-close" onClick={() => setVisModal(null)}>✕</button>
            </div>
            <div className="vis-modal-sub">
              Cochez les canaux à assigner à cet utilisateur.<br/>
              Par défaut, aucun canal n'est visible — vous devez les assigner manuellement.
            </div>
            {visLoading ? (
              <div style={{ padding: 24, textAlign: 'center' }}><div className="spinner" /></div>
            ) : tgChannels.length === 0 ? (
              <div style={{ padding: 24, textAlign: 'center', color: '#64748b', fontSize: 13 }}>
                Aucun canal Telegram configuré.
              </div>
            ) : (
              <div className="vis-channels-list">
                {tgChannels.map(ch => {
                  const assigned = visData[visModal.userId] || new Set();
                  const isAssigned = assigned.has(ch.dbId);
                  return (
                    <label key={ch.dbId} className={`vis-channel-toggle ${isAssigned ? 'visible' : 'hidden'}`}>
                      <input
                        type="checkbox"
                        checked={isAssigned}
                        onChange={() => toggleVisChannel(visModal.userId, ch.dbId)}
                      />
                      <span className="vis-channel-icon">📡</span>
                      <span className="vis-channel-name">{ch.name}</span>
                      <span className={`vis-channel-badge ${isAssigned ? 'on' : 'off'}`}>
                        {isAssigned ? 'Assigné' : 'Non assigné'}
                      </span>
                    </label>
                  );
                })}
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
