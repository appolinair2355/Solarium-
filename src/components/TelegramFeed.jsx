import { useState, useEffect, useRef } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';

export default function TelegramFeed() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();

  const [channels, setChannels] = useState([]); // [{ dbId, name, messages[] }]
  const [activeDbId, setActiveDbId] = useState(null);
  const [loading, setLoading] = useState(true);
  const [botConnected, setBotConnected] = useState(false);

  // Admin: add channel
  const [addInput, setAddInput] = useState('');
  const [addLoading, setAddLoading] = useState(false);
  const [addMsg, setAddMsg] = useState('');

  const tabBarRef = useRef(null);

  const fmtDate = iso => {
    if (!iso) return '';
    const d = new Date(iso);
    return d.toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit' }) +
      ' ' + d.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
  };

  const showAddMsg = (msg, err) => {
    setAddMsg({ text: msg, error: err });
    setTimeout(() => setAddMsg(''), 4000);
  };

  // Load channels + status
  useEffect(() => {
    fetch('/api/telegram/channels', { credentials: 'include' })
      .then(r => r.ok ? r.json() : [])
      .then(chs => {
        setChannels(chs.map(ch => ({ ...ch, messages: [] })));
        if (chs.length > 0) setActiveDbId(chs[0].dbId);
        setLoading(false);
      })
      .catch(() => setLoading(false));

    fetch('/api/telegram/status', { credentials: 'include' })
      .then(r => r.ok ? r.json() : {})
      .then(d => setBotConnected(!!d.connected || d.channelCount > 0));
  }, []);

  // SSE stream
  useEffect(() => {
    const es = new EventSource('/api/telegram/stream');
    es.onmessage = e => {
      const data = JSON.parse(e.data);
      if (data.type === 'init') {
        setChannels(prev => {
          const updated = [...prev];
          for (const ch of data.channels) {
            const idx = updated.findIndex(c => c.dbId === ch.dbId);
            if (idx >= 0) updated[idx] = { ...updated[idx], messages: ch.messages };
            else updated.push({ dbId: ch.dbId, name: ch.name, messages: ch.messages, tgId: '' });
          }
          // Add any new channels not yet in state
          return updated;
        });
        // If no active yet, pick first
        setActiveDbId(prev => prev ?? (data.channels[0]?.dbId ?? null));
        setBotConnected(true);
      } else if (data.type === 'new_message' && data.channelDbId) {
        setChannels(prev => prev.map(ch =>
          ch.dbId === data.channelDbId
            ? { ...ch, messages: [data.message, ...ch.messages].slice(0, 100) }
            : ch
        ));
      }
    };
    es.onerror = () => {};
    return () => es.close();
  }, []);

  const addChannel = async () => {
    if (!addInput.trim()) return;
    setAddLoading(true);
    const res = await fetch('/api/telegram/channels', {
      method: 'POST', credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ channel_id: addInput.trim() }),
    });
    const d = await res.json();
    if (res.ok) {
      showAddMsg(`✅ Canal "${d.channel.name}" ajouté`);
      setAddInput('');
      const newCh = { ...d.channel, messages: [] };
      setChannels(prev => [...prev, newCh]);
      setActiveDbId(d.channel.dbId);
    } else {
      showAddMsg(d.error || 'Erreur', true);
    }
    setAddLoading(false);
  };

  const removeChannel = async dbId => {
    if (!confirm('Supprimer ce canal ?')) return;
    const res = await fetch(`/api/telegram/channels/${dbId}`, { method: 'DELETE', credentials: 'include' });
    if (res.ok) {
      setChannels(prev => prev.filter(c => c.dbId !== dbId));
      setActiveDbId(prev => prev === dbId ? (channels.find(c => c.dbId !== dbId)?.dbId ?? null) : prev);
    }
  };

  const handleLogout = async () => { await logout(); navigate('/'); };

  const activeChannel = channels.find(c => c.dbId === activeDbId) || null;
  const msgs = activeChannel?.messages || [];

  return (
    <div className="tgfeed-page">
      <nav className="navbar">
        <Link to="/" className="navbar-brand">🎲 Prediction Baccara Pro</Link>
        <div className="navbar-actions">
          <button className="btn btn-ghost btn-sm" onClick={() => navigate('/choisir')}>← Retour</button>
          {user?.is_admin && <Link to="/admin" className="btn btn-ghost btn-sm">⚙ Admin</Link>}
          <button className="btn btn-danger btn-sm" onClick={handleLogout}>Déconnexion</button>
        </div>
      </nav>

      <div className="tgfeed-wrapper">
        {/* Header */}
        <div className="tgfeed-head">
          <div className="tgfeed-head-icon">✈️</div>
          <div className="tgfeed-head-info">
            <h1 className="tgfeed-head-title">Canaux Telegram</h1>
            {loading ? (
              <span className="tgfeed-head-sub">Chargement…</span>
            ) : channels.length > 0 ? (
              <span className="tgfeed-head-sub">
                🟢 {channels.length} canal{channels.length > 1 ? 'aux' : ''} actif{channels.length > 1 ? 's' : ''}
              </span>
            ) : (
              <span className="tgfeed-head-sub tgfeed-disconnected">
                🔴 Aucun canal configuré{user?.is_admin ? ' — ajoutez un canal ci-dessous' : ' — contactez l\'administrateur'}
              </span>
            )}
          </div>
          {channels.length > 0 && (
            <div className="tgfeed-live-badge">
              <span className="tgfeed-live-dot" />
              EN DIRECT
            </div>
          )}
        </div>

        {/* Admin: Add channel */}
        {user?.is_admin && channels.length < 10 && (
          <div className="tgfeed-add-panel">
            <div className="tgfeed-add-title">➕ Ajouter un canal ({channels.length}/10)</div>
            {addMsg && (
              <div className={`tg-alert ${addMsg.error ? 'tg-alert-error' : 'tg-alert-ok'}`} style={{ marginBottom: 10 }}>
                {addMsg.text}
              </div>
            )}
            <div className="tg-input-row">
              <input
                className="tg-channel-input"
                type="text"
                placeholder="@moncanal ou -100123456789"
                value={addInput}
                onChange={e => setAddInput(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && addChannel()}
                style={{ background: 'rgba(255,255,255,0.06)', borderColor: 'var(--border-dim)', color: '#fff' }}
              />
              <button
                className="btn btn-gold btn-sm"
                onClick={addChannel}
                disabled={addLoading || !addInput.trim()}
              >
                {addLoading ? '...' : 'Connecter'}
              </button>
            </div>
          </div>
        )}

        {/* Channel tabs */}
        {channels.length > 0 && (
          <div className="tgfeed-tabs-wrap">
            <div className="tgfeed-tabs" ref={tabBarRef}>
              {channels.map(ch => (
                <div
                  key={ch.dbId}
                  className={`tgfeed-tab ${ch.dbId === activeDbId ? 'active' : ''}`}
                  onClick={() => setActiveDbId(ch.dbId)}
                >
                  <span className="tgfeed-tab-icon">✈️</span>
                  <span className="tgfeed-tab-name">{ch.name}</span>
                  <span className="tgfeed-tab-count">{ch.messages.length}</span>
                  {user?.is_admin && (
                    <span
                      className="tgfeed-tab-del"
                      title="Supprimer ce canal"
                      onClick={e => { e.stopPropagation(); removeChannel(ch.dbId); }}
                    >✕</span>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Messages for active channel */}
        {!loading && channels.length === 0 && (
          <div className="tgfeed-empty-state">
            <div className="tgfeed-empty-icon">📡</div>
            <div className="tgfeed-empty-title">Aucun canal configuré</div>
            <div className="tgfeed-empty-sub">
              {user?.is_admin
                ? 'Ajoutez un canal Telegram ci-dessus pour commencer à recevoir les messages.'
                : 'L\'administrateur doit d\'abord connecter un canal Telegram.'}
            </div>
          </div>
        )}

        {channels.length > 0 && msgs.length === 0 && (
          <div className="tgfeed-empty-state">
            <div className="tgfeed-empty-icon">💬</div>
            <div className="tgfeed-empty-title">En attente de messages</div>
            <div className="tgfeed-empty-sub">
              Les nouveaux messages de <strong>{activeChannel?.name}</strong> apparaîtront ici en temps réel.
            </div>
          </div>
        )}

        {msgs.length > 0 && (
          <div className="tgfeed-list">
            {msgs.map((m, i) => (
              <div key={m.id ?? i} className="tgfeed-row">
                <div className="tgfeed-row-side">
                  <div className="tgfeed-row-avatar">✈</div>
                </div>
                <div className="tgfeed-row-body">
                  <div className="tgfeed-row-meta">
                    <span className="tgfeed-row-name">{m.channel || activeChannel?.name}</span>
                    <span className="tgfeed-row-time">{fmtDate(m.date)}</span>
                  </div>
                  <div className="tgfeed-row-text">
                    {m.text || (m.photo ? '📎 Média' : '—')}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
