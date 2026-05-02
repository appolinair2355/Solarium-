import React, { useState, useEffect, useCallback, useRef } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import Avatar from '../components/Avatar';

class AdminErrorBoundary extends React.Component {
  constructor(props) { super(props); this.state = { hasError: false, error: null }; }
  static getDerivedStateFromError(error) { return { hasError: true, error }; }
  componentDidCatch(err, info) { console.error('[AdminErrorBoundary]', err, info); }
  render() {
    if (this.state.hasError) {
      return (
        <div style={{ padding: 40, textAlign: 'center', color: '#e2e8f0', background: '#0f172a', minHeight: '100vh' }}>
          <div style={{ fontSize: 48, marginBottom: 16 }}>⚠️</div>
          <h2 style={{ color: '#fbbf24', marginBottom: 12 }}>Erreur d'affichage</h2>
          <p style={{ color: '#94a3b8', marginBottom: 20 }}>Une erreur est survenue dans le panneau admin.</p>
          <pre style={{ background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.3)', borderRadius: 8, padding: 16, color: '#fca5a5', fontSize: 12, maxWidth: 600, margin: '0 auto 20px', textAlign: 'left', whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
            {this.state.error?.message || 'Erreur inconnue'}
          </pre>
          <button onClick={() => { this.setState({ hasError: false, error: null }); }} style={{ padding: '10px 24px', borderRadius: 8, border: 'none', background: 'linear-gradient(135deg,#f0c060,#d4a843)', color: '#111', fontWeight: 700, fontSize: 14, cursor: 'pointer' }}>
            🔄 Réessayer
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}

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

function TgDirectChat() {
  const [cfg, setCfg]         = React.useState({ bot_token: '', channel_id: '' });
  const [saved, setSaved]     = React.useState({ bot_token: '', channel_id: '', bot_username: '' });
  const [messages, setMessages] = React.useState([]);
  const [configured, setConfigured] = React.useState(false);
  const [showConfig, setShowConfig] = React.useState(false);
  const [draft, setDraft]     = React.useState('');
  const [sending, setSending] = React.useState(false);
  const [savingCfg, setSavingCfg] = React.useState(false);
  const [cfgMsg, setCfgMsg]   = React.useState('');
  const [sendErr, setSendErr] = React.useState('');
  const msgEndRef = React.useRef(null);
  const inputRef  = React.useRef(null);

  React.useEffect(() => {
    fetch('/api/admin/telegram-chat/config', { credentials: 'include' })
      .then(r => r.ok ? r.json() : { bot_token: '', channel_id: '' })
      .then(d => { setCfg(d); setSaved(d); if (d.bot_token && d.channel_id) setConfigured(true); }).catch(() => {});
  }, []);

  React.useEffect(() => {
    if (!configured) return;
    const poll = () => {
      fetch('/api/admin/telegram-chat/messages', { credentials: 'include' })
        .then(r => r.ok ? r.json() : { messages: [], configured: true })
        .then(d => { setMessages(d.messages || []); if (d.configured === false) setConfigured(false); })
        .catch(() => {});
    };
    poll();
    const iv = setInterval(poll, 3000);
    return () => clearInterval(iv);
  }, [configured]);

  React.useEffect(() => {
    msgEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const saveCfg = async () => {
    setSavingCfg(true); setCfgMsg('');
    try {
      const r = await fetch('/api/admin/telegram-chat/config', {
        method: 'POST', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(cfg),
      });
      const d = await r.json();
      if (!r.ok) { setCfgMsg('❌ ' + (d.error || 'Erreur')); return; }
      setSaved({ ...cfg, bot_username: d.bot_username || '' });
      setConfigured(true); setShowConfig(false);
      setCfgMsg('✅ Connecté : @' + (d.bot_username || 'bot'));
    } catch (e) { setCfgMsg('❌ ' + e.message); }
    finally { setSavingCfg(false); }
  };

  const deleteCfg = async () => {
    if (!confirm('Supprimer la configuration ?')) return;
    await fetch('/api/admin/telegram-chat/config', { method: 'DELETE', credentials: 'include' });
    setCfg({ bot_token: '', channel_id: '' }); setSaved({ bot_token: '', channel_id: '' });
    setConfigured(false); setMessages([]); setShowConfig(true);
  };

  const sendMsg = async () => {
    if (!draft.trim() || sending) return;
    setSending(true); setSendErr('');
    try {
      const r = await fetch('/api/admin/telegram-chat/send', {
        method: 'POST', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: draft }),
      });
      const d = await r.json();
      if (!r.ok) { setSendErr(d.error || 'Erreur envoi'); return; }
      setDraft('');
      inputRef.current?.focus();
    } catch (e) { setSendErr(e.message); }
    finally { setSending(false); }
  };

  const formatDate = (iso) => {
    const d = new Date(iso);
    return d.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
  };

  return (
    <div style={{ maxWidth: 820, margin: '0 auto', display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 10 }}>
        <div>
          <div style={{ fontSize: 18, fontWeight: 800, color: '#e2e8f0' }}>📨 Canal Telegram Direct</div>
          <div style={{ fontSize: 12, color: '#64748b', marginTop: 2 }}>
            {configured ? `Connecté${saved.bot_username ? ' — @' + saved.bot_username : ''} · ${saved.channel_id}` : 'Non configuré'}
          </div>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          {configured && (
            <button type="button" onClick={deleteCfg}
              style={{ padding: '6px 14px', borderRadius: 8, border: '1px solid rgba(239,68,68,0.4)', background: 'rgba(239,68,68,0.08)', color: '#f87171', fontSize: 12, cursor: 'pointer' }}>
              🗑 Déconnecter
            </button>
          )}
          <button type="button" onClick={() => setShowConfig(v => !v)}
            style={{ padding: '6px 14px', borderRadius: 8, border: '1px solid rgba(255,255,255,0.1)', background: showConfig ? 'rgba(251,191,36,0.12)' : 'rgba(255,255,255,0.04)', color: showConfig ? '#fbbf24' : '#94a3b8', fontSize: 12, cursor: 'pointer' }}>
            ⚙️ Configuration
          </button>
        </div>
      </div>

      {showConfig && (
        <div style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(251,191,36,0.2)', borderRadius: 12, padding: 18, display: 'flex', flexDirection: 'column', gap: 14 }}>
          <div style={{ fontSize: 13, fontWeight: 700, color: '#fbbf24', marginBottom: 4 }}>⚙️ Configuration du bot</div>
          <div style={{ fontSize: 12, color: '#64748b', lineHeight: 1.6 }}>
            Le bot doit être <strong style={{color:'#e2e8f0'}}>administrateur</strong> du canal pour recevoir les messages.
          </div>
          <div>
            <label style={{ display: 'block', color: '#94a3b8', fontSize: 11, marginBottom: 5 }}>API TOKEN BOT</label>
            <input value={cfg.bot_token} onChange={e => setCfg(p => ({...p, bot_token: e.target.value}))}
              placeholder="1234567890:AAF-xxxxxxxxxxxx"
              style={{ width: '100%', padding: '9px 12px', borderRadius: 8, border: '1px solid rgba(255,255,255,0.12)', background: 'rgba(255,255,255,0.05)', color: '#e2e8f0', fontSize: 13, fontFamily: 'monospace', boxSizing: 'border-box' }} />
          </div>
          <div>
            <label style={{ display: 'block', color: '#94a3b8', fontSize: 11, marginBottom: 5 }}>ID CANAL</label>
            <input value={cfg.channel_id} onChange={e => setCfg(p => ({...p, channel_id: e.target.value}))}
              placeholder="@mon_canal ou -100123456789"
              style={{ width: '100%', padding: '9px 12px', borderRadius: 8, border: '1px solid rgba(255,255,255,0.12)', background: 'rgba(255,255,255,0.05)', color: '#e2e8f0', fontSize: 13, fontFamily: 'monospace', boxSizing: 'border-box' }} />
          </div>
          {cfgMsg && (
            <div style={{ padding: '8px 12px', borderRadius: 8, background: cfgMsg.startsWith('✅') ? 'rgba(34,197,94,0.1)' : 'rgba(239,68,68,0.1)', border: `1px solid ${cfgMsg.startsWith('✅') ? 'rgba(34,197,94,0.3)' : 'rgba(239,68,68,0.3)'}`, color: cfgMsg.startsWith('✅') ? '#86efac' : '#fca5a5', fontSize: 13 }}>
              {cfgMsg}
            </div>
          )}
          <button type="button" onClick={saveCfg} disabled={savingCfg || !cfg.bot_token || !cfg.channel_id}
            style={{ alignSelf: 'flex-start', padding: '8px 22px', borderRadius: 8, border: 'none', background: 'linear-gradient(135deg,#f0c060,#d4a843)', color: '#111', fontWeight: 700, fontSize: 13, cursor: savingCfg ? 'wait' : 'pointer', opacity: (!cfg.bot_token || !cfg.channel_id) ? 0.5 : 1 }}>
            {savingCfg ? 'Connexion…' : '✅ Connecter'}
          </button>
        </div>
      )}

      {configured ? (
        <div style={{ background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 12, display: 'flex', flexDirection: 'column', height: 480 }}>
          <div style={{ flex: 1, overflowY: 'auto', padding: 16, display: 'flex', flexDirection: 'column', gap: 10 }}>
            {messages.length === 0 ? (
              <div style={{ textAlign: 'center', color: '#475569', fontSize: 13, marginTop: 40 }}>
                <div style={{ fontSize: 32, marginBottom: 10 }}>💬</div>
                Aucun message reçu — les nouveaux messages apparaîtront ici automatiquement
              </div>
            ) : (
              messages.map((m, i) => (
                <div key={m.id || i} style={{
                  display: 'flex', flexDirection: 'column', gap: 2,
                  alignSelf: m.isBot ? 'flex-end' : 'flex-start',
                  maxWidth: '78%',
                }}>
                  <div style={{ fontSize: 10, color: '#475569', paddingLeft: m.isBot ? 0 : 4, paddingRight: m.isBot ? 4 : 0, textAlign: m.isBot ? 'right' : 'left' }}>
                    {m.isBot ? '🟡 Vous' : `🔵 ${m.from}`} · {formatDate(m.date)}
                  </div>
                  <div style={{
                    padding: '8px 12px', borderRadius: m.isBot ? '12px 4px 12px 12px' : '4px 12px 12px 12px',
                    background: m.isBot ? 'rgba(212,168,67,0.18)' : 'rgba(255,255,255,0.06)',
                    border: `1px solid ${m.isBot ? 'rgba(212,168,67,0.3)' : 'rgba(255,255,255,0.08)'}`,
                    color: '#e2e8f0', fontSize: 13, lineHeight: 1.5, whiteSpace: 'pre-wrap', wordBreak: 'break-word',
                  }}>
                    {m.text}
                  </div>
                </div>
              ))
            )}
            <div ref={msgEndRef} />
          </div>
          <div style={{ borderTop: '1px solid rgba(255,255,255,0.07)', padding: 12, display: 'flex', gap: 10, alignItems: 'flex-end' }}>
            <textarea ref={inputRef} value={draft} onChange={e => setDraft(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMsg(); } }}
              placeholder="Écrire un message… (Entrée pour envoyer)"
              rows={2}
              style={{ flex: 1, padding: '9px 12px', borderRadius: 10, border: '1px solid rgba(255,255,255,0.12)', background: 'rgba(255,255,255,0.05)', color: '#e2e8f0', fontSize: 13, resize: 'none', fontFamily: 'inherit', lineHeight: 1.5, outline: 'none', boxSizing: 'border-box' }} />
            <button type="button" onClick={sendMsg} disabled={!draft.trim() || sending}
              style={{ padding: '10px 18px', borderRadius: 10, border: 'none', background: draft.trim() && !sending ? 'linear-gradient(135deg,#f0c060,#d4a843)' : 'rgba(255,255,255,0.08)', color: draft.trim() && !sending ? '#111' : '#475569', fontWeight: 700, fontSize: 14, cursor: !draft.trim() || sending ? 'not-allowed' : 'pointer', flexShrink: 0, minWidth: 52 }}>
              {sending ? '…' : '➤'}
            </button>
          </div>
          {sendErr && <div style={{ padding: '6px 14px 10px', color: '#f87171', fontSize: 12 }}>❌ {sendErr}</div>}
        </div>
      ) : (
        <div style={{ background: 'rgba(255,255,255,0.02)', border: '1px dashed rgba(255,255,255,0.1)', borderRadius: 12, padding: 48, textAlign: 'center' }}>
          <div style={{ fontSize: 40, marginBottom: 12 }}>📨</div>
          <div style={{ fontSize: 15, color: '#64748b', marginBottom: 16 }}>Configurez le bot Telegram pour voir les messages du canal en temps réel</div>
          <button type="button" onClick={() => setShowConfig(true)}
            style={{ padding: '9px 24px', borderRadius: 10, border: '1px solid rgba(251,191,36,0.4)', background: 'rgba(251,191,36,0.1)', color: '#fbbf24', fontWeight: 700, fontSize: 13, cursor: 'pointer' }}>
            ⚙️ Configurer maintenant
          </button>
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Gestionnaire des cartes joueur/banquier
// Lit la base SÉPARÉE `les_cartes` via /api/admin/cartes
// ─────────────────────────────────────────────────────────────────────────────
function CartesPanel() {
  const [rows, setRows]       = React.useState([]);
  const [stats, setStats]     = React.useState(null);
  const [channels, setChannels] = React.useState([]);
  const [loading, setLoading] = React.useState(true);
  const [err, setErr]         = React.useState('');
  const [filters, setFilters] = React.useState({ date: '', winner: '', dist: '', gameNumber: '' });

  const load = React.useCallback(async () => {
    setLoading(true); setErr('');
    try {
      const qs = new URLSearchParams();
      Object.entries(filters).forEach(([k, v]) => { if (v) qs.set(k, v); });
      qs.set('limit', '200');
      const [rRows, rStats, rChan] = await Promise.all([
        fetch(`/api/admin/cartes?${qs.toString()}`, { credentials: 'include' }),
        fetch('/api/admin/cartes/stats', { credentials: 'include' }),
        fetch('/api/admin/pro-telegram-channels', { credentials: 'include' }),
      ]);
      const dRows  = await rRows.json();
      const dStats = await rStats.json();
      const dChan  = await rChan.json();
      if (!rRows.ok) throw new Error(dRows.error || 'Erreur chargement');
      setRows(dRows.rows || []);
      setStats(dStats.stats || null);
      setChannels(dChan.channels || []);
    } catch (e) { setErr(e.message); }
    finally { setLoading(false); }
  }, [filters]);

  React.useEffect(() => { load(); }, [load]);

  const cardCell = (r, s) => {
    if (!r && !s) return '—';
    return `${r ?? '?'}${s ?? ''}`;
  };
  const renderBool = (v) => v === true ? '✓' : v === false ? '·' : '—';

  const StatCard = ({ label, value, accent='#fbbf24' }) => (
    <div style={{ background: 'rgba(15,23,42,0.6)', border: `1px solid ${accent}33`, borderRadius: 8, padding: '8px 12px', minWidth: 90 }}>
      <div style={{ fontSize: 10, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: 0.5 }}>{label}</div>
      <div style={{ fontSize: 18, fontWeight: 700, color: accent }}>{value ?? 0}</div>
    </div>
  );

  return (
    <div style={{ padding: '0 8px' }}>
      <div style={{ marginBottom: 14 }}>
        <h2 style={{ color: '#fbbf24', fontSize: 18, margin: '0 0 4px 0' }}>🎴 Gestionnaire des cartes joueur/banquier</h2>
        <div style={{ fontSize: 12, color: '#94a3b8' }}>
          Base de données dédiée <code style={{ background: 'rgba(0,0,0,0.3)', padding: '1px 5px', borderRadius: 3 }}>les_cartes</code> —
          chaque jeu terminé enregistre date, numéro, cartes 1/2/3 J&B et toutes les catégories dérivées.
        </div>
      </div>

      {/* Statistiques globales par catégorie */}
      {stats && (
        <div style={{ marginBottom: 16 }}>
          <div style={{ fontSize: 12, color: '#fbbf24', marginBottom: 6, fontWeight: 700 }}>Catégories — totaux</div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
            <StatCard label="Total" value={stats.total} accent="#fbbf24" />
            <StatCard label="Joueur" value={stats.win_p} accent="#60a5fa" />
            <StatCard label="Banquier" value={stats.win_b} accent="#f87171" />
            <StatCard label="Match nul" value={stats.win_tie} accent="#a78bfa" />
            <StatCard label="2/2" value={stats.d22} />
            <StatCard label="2/3" value={stats.d23} />
            <StatCard label="3/2" value={stats.d32} />
            <StatCard label="3/3" value={stats.d33} />
            <StatCard label="J 2k" value={stats.p_2k} />
            <StatCard label="J 3k" value={stats.p_3k} />
            <StatCard label="B 2k" value={stats.b_2k} />
            <StatCard label="B 3k" value={stats.b_3k} />
            <StatCard label="J ≥7" value={stats.p_high} accent="#34d399" />
            <StatCard label="J ≤4" value={stats.p_low}  accent="#fb923c" />
            <StatCard label="B ≥7" value={stats.b_high} accent="#34d399" />
            <StatCard label="B ≤4" value={stats.b_low}  accent="#fb923c" />
            <StatCard label="Pair gagnant" value={stats.w_pair} />
            <StatCard label="Imp. gagnant" value={stats.w_imp} />
            <StatCard label="J pair" value={stats.p_pair} />
            <StatCard label="J impair" value={stats.p_imp} />
            <StatCard label="B pair" value={stats.b_pair} />
            <StatCard label="B impair" value={stats.b_imp} />
          </div>
          <div style={{ fontSize: 11, color: '#64748b', marginTop: 6 }}>
            Plage : #{stats.gn_min ?? '—'} → #{stats.gn_max ?? '—'}
          </div>
        </div>
      )}

      {/* Filtres */}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 12, padding: 10, background: 'rgba(15,23,42,0.4)', borderRadius: 8 }}>
        <input type="date" value={filters.date} onChange={(e) => setFilters({ ...filters, date: e.target.value })}
          style={{ padding: '6px 8px', background: '#0f172a', border: '1px solid #334155', color: '#e2e8f0', borderRadius: 6, fontSize: 12 }} />
        <select value={filters.winner} onChange={(e) => setFilters({ ...filters, winner: e.target.value })}
          style={{ padding: '6px 8px', background: '#0f172a', border: '1px solid #334155', color: '#e2e8f0', borderRadius: 6, fontSize: 12 }}>
          <option value="">Gagnant (tous)</option>
          <option value="Player">Joueur</option>
          <option value="Banker">Banquier</option>
          <option value="Tie">Match nul</option>
        </select>
        <select value={filters.dist} onChange={(e) => setFilters({ ...filters, dist: e.target.value })}
          style={{ padding: '6px 8px', background: '#0f172a', border: '1px solid #334155', color: '#e2e8f0', borderRadius: 6, fontSize: 12 }}>
          <option value="">Distribution (toutes)</option>
          <option value="2/2">2/2</option>
          <option value="2/3">2/3</option>
          <option value="3/2">3/2</option>
          <option value="3/3">3/3</option>
        </select>
        <input type="number" placeholder="N° jeu" value={filters.gameNumber} onChange={(e) => setFilters({ ...filters, gameNumber: e.target.value })}
          style={{ padding: '6px 8px', background: '#0f172a', border: '1px solid #334155', color: '#e2e8f0', borderRadius: 6, fontSize: 12, width: 110 }} />
        <button onClick={load} disabled={loading}
          style={{ padding: '6px 12px', background: '#fbbf24', border: 'none', color: '#0f172a', borderRadius: 6, fontSize: 12, fontWeight: 700, cursor: 'pointer' }}>
          {loading ? '…' : '🔄 Rafraîchir'}
        </button>
        <button onClick={() => setFilters({ date: '', winner: '', dist: '', gameNumber: '' })}
          style={{ padding: '6px 12px', background: 'transparent', border: '1px solid #334155', color: '#94a3b8', borderRadius: 6, fontSize: 12, cursor: 'pointer' }}>
          Effacer
        </button>
      </div>

      {err && (
        <div style={{ padding: 10, background: 'rgba(239,68,68,0.1)', border: '1px solid #ef4444', borderRadius: 6, color: '#fecaca', fontSize: 12, marginBottom: 10 }}>
          ⚠️ {err}
          <div style={{ marginTop: 4, color: '#94a3b8' }}>
            Vérifiez que la variable <code>LES_CARTES_DATABASE_URL</code> est bien définie sur Render.
          </div>
        </div>
      )}

      {/* Tableau */}
      <div style={{ overflowX: 'auto', background: 'rgba(15,23,42,0.6)', borderRadius: 8 }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11 }}>
          <thead>
            <tr style={{ background: 'rgba(251,191,36,0.08)', color: '#fbbf24' }}>
              <th style={th}>Date</th>
              <th style={th}>N°</th>
              <th style={th}>P1</th><th style={th}>P2</th><th style={th}>P3</th>
              <th style={th}>B1</th><th style={th}>B2</th><th style={th}>B3</th>
              <th style={th}>Gagnant</th>
              <th style={th}>P/B</th>
              <th style={th}>Dist</th>
              <th style={th}>J≥7</th><th style={th}>J≤4</th>
              <th style={th}>B≥7</th><th style={th}>B≤4</th>
              <th style={th}>W pair</th><th style={th}>J pair</th><th style={th}>B pair</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && !loading && (
              <tr><td colSpan={18} style={{ padding: 20, textAlign: 'center', color: '#64748b' }}>
                Aucun enregistrement {filters.date || filters.winner || filters.gameNumber ? 'pour ces filtres' : '— attendez la fin du prochain jeu'}
              </td></tr>
            )}
            {rows.map((r) => (
              <tr key={r.game_number} style={{ borderTop: '1px solid #1e293b' }}>
                <td style={td}>{r.date ? String(r.date).slice(0, 10) : '—'}</td>
                <td style={{ ...td, fontWeight: 700, color: '#fbbf24' }}>#{r.game_number}</td>
                <td style={td}>{cardCell(r.p1_r, r.p1_s)}</td>
                <td style={td}>{cardCell(r.p2_r, r.p2_s)}</td>
                <td style={td}>{cardCell(r.p3_r, r.p3_s)}</td>
                <td style={td}>{cardCell(r.b1_r, r.b1_s)}</td>
                <td style={td}>{cardCell(r.b2_r, r.b2_s)}</td>
                <td style={td}>{cardCell(r.b3_r, r.b3_s)}</td>
                <td style={{ ...td, color: r.winner === 'Player' ? '#60a5fa' : r.winner === 'Banker' ? '#f87171' : '#a78bfa' }}>
                  {r.winner === 'Player' ? 'J' : r.winner === 'Banker' ? 'B' : r.winner === 'Tie' ? 'Nul' : '—'}
                </td>
                <td style={td}>{r.p_score ?? '—'}/{r.b_score ?? '—'}</td>
                <td style={td}>{r.dist || '—'}</td>
                <td style={td}>{renderBool(r.p_high)}</td>
                <td style={td}>{renderBool(r.p_low)}</td>
                <td style={td}>{renderBool(r.b_high)}</td>
                <td style={td}>{renderBool(r.b_low)}</td>
                <td style={td}>{renderBool(r.winner_pair)}</td>
                <td style={td}>{renderBool(r.p_pair)}</td>
                <td style={td}>{renderBool(r.b_pair)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Canaux Telegram Pro configurés */}
      <div style={{ marginTop: 24 }}>
        <h3 style={{ color: '#818cf8', fontSize: 14, margin: '0 0 8px 0' }}>📡 Canaux Telegram Config Pro (api_token + channel_id)</h3>
        <div style={{ fontSize: 11, color: '#94a3b8', marginBottom: 8 }}>
          Liste des canaux configurés dans Config Pro et dans les stratégies Pro — utilisés pour envoyer les prédictions.
        </div>
        <div style={{ background: 'rgba(15,23,42,0.6)', borderRadius: 8, overflow: 'hidden' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11 }}>
            <thead>
              <tr style={{ background: 'rgba(99,102,241,0.08)', color: '#818cf8' }}>
                <th style={th}>Type</th>
                <th style={th}>Source</th>
                <th style={th}>API Token (preview)</th>
                <th style={th}>Channel ID</th>
                <th style={th}>Format</th>
                <th style={th}>État</th>
              </tr>
            </thead>
            <tbody>
              {channels.length === 0 && (
                <tr><td colSpan={6} style={{ padding: 14, textAlign: 'center', color: '#64748b' }}>
                  Aucun canal Pro configuré
                </td></tr>
              )}
              {channels.map((c, i) => (
                <tr key={i} style={{ borderTop: '1px solid #1e293b' }}>
                  <td style={td}>{c.kind === 'config_pro' ? 'Config Pro' : 'Stratégie'}</td>
                  <td style={td}>{c.strategy_name || (c.owner_id ? `User #${c.owner_id}` : '—')}</td>
                  <td style={{ ...td, fontFamily: 'monospace' }}>{c.bot_token_preview || '—'}</td>
                  <td style={{ ...td, fontFamily: 'monospace' }}>{c.channel_id || '—'}</td>
                  <td style={td}>{c.format ?? '—'}</td>
                  <td style={td}>
                    <span style={{ color: c.configured ? '#34d399' : '#fbbf24' }}>
                      {c.configured ? '✓ OK' : '⚠ incomplet'}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Documentation pour les scripts Pro */}
      <div style={{ marginTop: 24, padding: 12, background: 'rgba(99,102,241,0.06)', border: '1px solid rgba(99,102,241,0.3)', borderRadius: 8 }}>
        <h3 style={{ color: '#818cf8', fontSize: 13, margin: '0 0 6px 0' }}>📘 Comment utiliser cette base dans les stratégies Pro (JS / Python)</h3>
        <div style={{ fontSize: 11, color: '#cbd5e1', lineHeight: 1.6 }}>
          <strong style={{ color: '#fbbf24' }}>JavaScript</strong> — l'objet <code>cartes</code> est exposé globalement, et un <code>ctx</code> est passé en 6e argument à <code>processGame</code> :
          <pre style={preStyle}>{`async function processGame(gn, pSuits, bSuits, winner, state, ctx) {
  const live = ctx.live.gameNumber;        // numéro EN LIVE
  const h    = 34;                         // recul à appliquer
  const p    = 2;                          // proche de ±p
  const go   = live + p;                   // numéro à prédire
  const zk   = ctx.cartes.zk(go, h);       // = go - h (numéro source)
  const card = await ctx.cartes.getCard(zk, 'player', 1);
  if (!card) return null;
  return { suit: card.S, mode: 'proche', p: p };
}`}</pre>
          <strong style={{ color: '#fbbf24' }}>Python</strong> — chaque appel reçoit en stdin :
          <pre style={preStyle}>{`{
  "game_number": 468,
  "player_suits": ["♠","♦"], "banker_suits": ["♥"],
  "winner": "Banker", "state": {...},
  "live":          { "game_number": 89 },
  "cartes_recent": [ /* 50 derniers jeux */ ],
  "cartes_near":   [ /* jeux proches du live */ ]
}`}</pre>
          Pour activer le mode <strong>proche de</strong> dans la réponse :
          <pre style={preStyle}>{`# return:
{ "result": { "suit": "♦", "mode": "proche", "p": 2 } }
# ou:
{ "result": { "suit": "♦", "proche_de": 2 } }`}</pre>
          <div style={{ color: '#94a3b8', marginTop: 4 }}>
            Différence avec <code>decalage</code> : <code>decalage</code> calcule la cible à partir du DÉCLENCHEUR
            (target = gn + decalage). <code>proche</code> calcule à partir du jeu EN LIVE (target = live + p).
          </div>
        </div>
      </div>
    </div>
  );
}
const th = { padding: '8px 6px', textAlign: 'left', fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.3 };
const td = { padding: '6px', color: '#cbd5e1' };
const preStyle = { background: '#0f172a', padding: 8, borderRadius: 6, color: '#e2e8f0', fontSize: 10, overflowX: 'auto', margin: '4px 0' };

function ComptagesPanel() {
  const [data, setData]       = React.useState(null);
  const [loading, setLoading] = React.useState(true);
  const [cfg, setCfg]         = React.useState({ bot_token: '', channel_id: '', enabled: false });
  const [tokenDirty, setTokenDirty] = React.useState(false);
  const [savingCfg, setSavingCfg]   = React.useState(false);
  const [busy, setBusy]       = React.useState('');
  const [msg, setMsg]         = React.useState({ text: '', error: false });
  const [preview, setPreview] = React.useState(null); // { text, activeChannels, nextScheduledAt, processedCount }
  const [showPreview, setShowPreview] = React.useState(false);

  // ── Canaux Telegram supplémentaires ──
  const [extraChannels, setExtraChannels] = React.useState([]);
  const [showChannelsPanel, setShowChannelsPanel] = React.useState(false);
  const [editingChannel, setEditingChannel] = React.useState(null); // { id?, label, bot_token, channel_id, enabled, _tokenDirty }

  // Helper: parser une réponse fetch en JSON même si le serveur a renvoyé du HTML
  // (par ex. la version déployée sur Render n'a pas encore le module Comptages).
  const safeJson = async (r) => {
    const txt = await r.text();
    try { return JSON.parse(txt); }
    catch {
      throw new Error(
        r.status === 404 || /<!DOCTYPE/i.test(txt)
          ? 'Module Comptages non disponible sur ce serveur — importez la dernière mise à jour.'
          : `Réponse inattendue (HTTP ${r.status})`
      );
    }
  };

  // `resetForm` : si true, écrase aussi les champs du formulaire (utilisé au montage
  // initial et après save/suppression). Si false (rafraîchissement auto toutes les 15 s),
  // on n'écrase JAMAIS les champs en cours d'édition pour ne pas effacer ce que
  // l'admin est en train de taper (bug : la saisie disparaît si > 15 s).
  const load = React.useCallback(async (resetForm = false) => {
    try {
      const r = await fetch('/api/admin/comptages', { credentials: 'include' });
      const d = await safeJson(r);
      if (!r.ok) throw new Error(d.error || 'Erreur');
      setData(d);
      if (resetForm) {
        setCfg({
          bot_token:  d.config?.bot_token  || '',
          channel_id: d.config?.channel_id || '',
          enabled:    !!d.config?.enabled,
        });
        setExtraChannels(Array.isArray(d.extraChannels) ? d.extraChannels : []);
        setTokenDirty(false);
      }
    } catch (e) {
      setMsg({ text: '❌ ' + e.message, error: true });
    } finally { setLoading(false); }
  }, []);

  React.useEffect(() => {
    // Au montage : on charge tout (data + champs du formulaire)
    load(true);
    // Rafraîchissement auto : on ne met à jour QUE les statistiques (data),
    // pas les champs en cours de saisie.
    const iv = setInterval(() => load(false), 15000);
    return () => clearInterval(iv);
  }, [load]);

  const fetchPreview = async () => {
    try {
      const r = await fetch('/api/admin/comptages/preview', { credentials: 'include' });
      const d = await safeJson(r);
      if (!r.ok) throw new Error(d.error || 'Erreur');
      setPreview(d);
      return d;
    } catch (e) {
      setMsg({ text: '❌ Aperçu indisponible : ' + e.message, error: true });
      return null;
    }
  };

  const saveCfg = async () => {
    setSavingCfg(true); setMsg({ text: '', error: false });
    try {
      const body = {
        channel_id: cfg.channel_id,
        // On laisse le backend décider de l'activation : si token+channel sont remplis,
        // il active automatiquement (sauf si on envoie explicitement enabled:false).
      };
      if (tokenDirty) body.bot_token = cfg.bot_token;
      const r = await fetch('/api/admin/comptages/config', {
        method: 'POST', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const d = await safeJson(r);
      if (!r.ok) throw new Error(d.error || 'Erreur');
      const sentInfo = d.firstReport?.sent
        ? ' · ✈️ Premier bilan envoyé immédiatement sur Telegram'
        : (d.firstReport?.error ? ` · ⚠️ Envoi : ${d.firstReport.error}` : '');
      setMsg({ text: '✅ Configuration sauvegardée' + sentInfo, error: false });
      await load(true);
      const p = await fetchPreview();
      if (p) {
        setPreview({ ...p, _firstReport: d.firstReport || null });
        setShowPreview(true);
      }
    } catch (e) { setMsg({ text: '❌ ' + e.message, error: true }); }
    finally { setSavingCfg(false); }
  };

  const openPreview = async () => {
    const p = await fetchPreview();
    if (p) setShowPreview(true);
  };

  const deleteCfg = async () => {
    if (!confirm('Supprimer définitivement la configuration Telegram principale ?\n\nLe token et le channel ID seront effacés.')) return;
    setBusy('delcfg'); setMsg({ text: '', error: false });
    try {
      const r = await fetch('/api/admin/comptages/config', {
        method: 'DELETE', credentials: 'include',
      });
      const d = await safeJson(r);
      if (!r.ok) throw new Error(d.error || 'Erreur');
      setMsg({ text: '✅ Configuration supprimée', error: false });
      setCfg({ bot_token: '', channel_id: '', enabled: false });
      setTokenDirty(false);
      await load(true);
    } catch (e) { setMsg({ text: '❌ ' + e.message, error: true }); }
    finally { setBusy(''); }
  };

  // Active/désactive rapidement le canal principal sans toucher token/channel_id
  const toggleEnabled = async () => {
    setBusy('togcfg'); setMsg({ text: '', error: false });
    try {
      const r = await fetch('/api/admin/comptages/config', {
        method: 'POST', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled: !data?.config?.enabled }),
      });
      const d = await safeJson(r);
      if (!r.ok) throw new Error(d.error || 'Erreur');
      setMsg({ text: data?.config?.enabled ? '🔴 Canal désactivé' : '🟢 Canal activé', error: false });
      await load(true);
    } catch (e) { setMsg({ text: '❌ ' + e.message, error: true }); }
    finally { setBusy(''); }
  };

  const sendTest = async () => {
    setBusy('test'); setMsg({ text: '', error: false });
    try {
      const r = await fetch('/api/admin/comptages/test-report', {
        method: 'POST', credentials: 'include',
      });
      const d = await safeJson(r);
      if (!r.ok) throw new Error(d.error || 'Erreur');
      if (d.error) throw new Error(d.error);
      const channelsInfo = Array.isArray(d.channels) && d.channels.length
        ? ' (' + d.channels.map(c => `${c.label} ${c.sent ? '✓' : '✗'}`).join(' · ') + ')'
        : '';
      setMsg({
        text: d.sent
          ? '✅ Bilan envoyé sur Telegram' + channelsInfo
          : 'ℹ️ Bilan généré (aucun canal activé ou tous en erreur)' + channelsInfo,
        error: false,
      });
      await load(true);
    } catch (e) { setMsg({ text: '❌ ' + e.message, error: true }); }
    finally { setBusy(''); }
  };

  const resetAll = async () => {
    if (!confirm('Réinitialiser tous les compteurs et historiques ?')) return;
    setBusy('reset'); setMsg({ text: '', error: false });
    try {
      const r = await fetch('/api/admin/comptages/reset', {
        method: 'POST', credentials: 'include',
      });
      const d = await safeJson(r);
      if (!r.ok) throw new Error(d.error || 'Erreur');
      setMsg({ text: '✅ Compteurs réinitialisés', error: false });
      await load(true);
    } catch (e) { setMsg({ text: '❌ ' + e.message, error: true }); }
    finally { setBusy(''); }
  };

  // ── Gestion des canaux supplémentaires ────────────────────────────────
  const startEditChannel = (ch) => {
    setEditingChannel(ch
      ? { ...ch, _tokenDirty: false }
      : { id: '', label: '', bot_token: '', channel_id: '', enabled: true, _tokenDirty: true });
    setShowChannelsPanel(true);
  };
  const cancelEditChannel = () => setEditingChannel(null);

  const saveChannel = async () => {
    if (!editingChannel) return;
    setBusy('chsave'); setMsg({ text: '', error: false });
    try {
      const body = {
        id: editingChannel.id || undefined,
        label: editingChannel.label || '',
        channel_id: editingChannel.channel_id || '',
        enabled: !!editingChannel.enabled,
      };
      if (editingChannel._tokenDirty) body.bot_token = editingChannel.bot_token || '';
      const r = await fetch('/api/admin/comptages/extra-channels', {
        method: 'POST', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const d = await safeJson(r);
      if (!r.ok) throw new Error(d.error || 'Erreur');
      setMsg({ text: '✅ Canal sauvegardé', error: false });
      setEditingChannel(null);
      await load(true);
    } catch (e) { setMsg({ text: '❌ ' + e.message, error: true }); }
    finally { setBusy(''); }
  };

  const deleteChannel = async (ch) => {
    if (!confirm(`Supprimer le canal « ${ch.label || ch.channel_id} » ?`)) return;
    setBusy('chdel'); setMsg({ text: '', error: false });
    try {
      const r = await fetch('/api/admin/comptages/extra-channels/' + encodeURIComponent(ch.id), {
        method: 'DELETE', credentials: 'include',
      });
      const d = await safeJson(r);
      if (!r.ok) throw new Error(d.error || 'Erreur');
      setMsg({ text: '✅ Canal supprimé', error: false });
      await load(true);
    } catch (e) { setMsg({ text: '❌ ' + e.message, error: true }); }
    finally { setBusy(''); }
  };

  const testChannel = async (id) => {
    setBusy('chtest:' + id); setMsg({ text: '', error: false });
    try {
      const r = await fetch('/api/admin/comptages/extra-channels/' + encodeURIComponent(id) + '/test', {
        method: 'POST', credentials: 'include',
      });
      const d = await safeJson(r);
      if (!r.ok) throw new Error(d.error || 'Erreur');
      setMsg({ text: '✅ Test envoyé sur ' + (d.label || 'le canal'), error: false });
    } catch (e) { setMsg({ text: '❌ ' + e.message, error: true }); }
    finally { setBusy(''); }
  };

  // Toggle « bilan après chaque jeu » pour un canal (id='main' = canal principal)
  const togglePerGame = async (id, currentValue, label) => {
    const next = !currentValue;
    setBusy('pg:' + id); setMsg({ text: '', error: false });
    try {
      const r = await fetch('/api/admin/comptages/channels/' + encodeURIComponent(id) + '/per-game', {
        method: 'POST', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ per_game: next }),
      });
      const d = await safeJson(r);
      if (!r.ok) throw new Error(d.error || 'Erreur');
      setMsg({
        text: next
          ? `▶️ ${label || 'Canal'} — bilan envoyé après chaque jeu terminé`
          : `⏹ ${label || 'Canal'} — retour au bilan horaire seulement`,
        error: false,
      });
      await load(true);
    } catch (e) { setMsg({ text: '❌ ' + e.message, error: true }); }
    finally { setBusy(''); }
  };

  // Regrouper par "group"
  const grouped = React.useMemo(() => {
    if (!data?.summary) return [];
    const map = {};
    for (const r of data.summary) {
      if (!map[r.group]) map[r.group] = [];
      map[r.group].push(r);
    }
    return Object.entries(map);
  }, [data]);

  // Précédent bilan (pour comparaison max global vs précédent)
  const prevByKey = React.useMemo(() => {
    const map = {};
    if (data?.lastReport?.summary) {
      for (const r of data.lastReport.summary) map[r.key] = r;
    }
    return map;
  }, [data]);

  const lastReportTs = data?.lastReport?.timestamp
    ? new Date(data.lastReport.timestamp).toLocaleString('fr-FR')
    : '—';

  return (
    <>
      {/* Carte de configuration */}
      <div className="tg-admin-card" style={{ borderColor: 'rgba(34,197,94,0.4)' }}>
        <div className="tg-admin-header">
          <span className="tg-admin-icon">📈</span>
          <div style={{ flex: 1 }}>
            <h2 className="tg-admin-title">Comptages — écarts entre catégories</h2>
            <p className="tg-admin-sub">
              Suit les écarts (séries sans apparition) pour costumes, victoires, parité,
              distribution, nombre de cartes et points. Bilan envoyé toutes les heures pile
              sur le canal Telegram configuré, avec comparaison au bilan précédent.
            </p>
          </div>
        </div>

        {msg.text && (
          <div className={`alert ${msg.error ? 'alert-error' : 'alert-success'}`} style={{ marginTop: 12 }}>
            {msg.text}
          </div>
        )}

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: 12, marginTop: 14 }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            <label style={{ fontSize: 11, color: '#94a3b8', fontWeight: 600, textTransform: 'uppercase', letterSpacing: 0.8 }}>Bot Token</label>
            <input
              type="text"
              value={cfg.bot_token}
              placeholder="123456:ABC-DEF…"
              onChange={e => { setCfg({ ...cfg, bot_token: e.target.value }); setTokenDirty(true); }}
              onFocus={() => { if (cfg.bot_token.startsWith('••••')) { setCfg({ ...cfg, bot_token: '' }); setTokenDirty(true); } }}
              style={{ padding: '8px 12px', borderRadius: 8, border: '1px solid rgba(34,197,94,0.3)',
                background: 'rgba(34,197,94,0.05)', color: '#e2e8f0', fontSize: 13, fontFamily: 'ui-monospace, monospace' }}
            />
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            <label style={{ fontSize: 11, color: '#94a3b8', fontWeight: 600, textTransform: 'uppercase', letterSpacing: 0.8 }}>Channel ID</label>
            <input
              type="text"
              value={cfg.channel_id}
              placeholder="-1001234567890 ou @canal"
              onChange={e => setCfg({ ...cfg, channel_id: e.target.value })}
              style={{ padding: '8px 12px', borderRadius: 8, border: '1px solid rgba(34,197,94,0.3)',
                background: 'rgba(34,197,94,0.05)', color: '#e2e8f0', fontSize: 13, fontFamily: 'ui-monospace, monospace' }}
            />
          </div>
          <div style={{ display: 'flex', alignItems: 'flex-end' }}>
            <div style={{ fontSize: 11, color: '#94a3b8', lineHeight: 1.5 }}>
              💡 L'envoi horaire est <b style={{ color: '#86efac' }}>activé automatiquement</b> dès
              qu'un token + channel ID sont remplis et sauvegardés. Le premier bilan part
              immédiatement, puis chaque heure pile.
            </div>
          </div>
        </div>

        <div style={{ display: 'flex', gap: 10, marginTop: 16, flexWrap: 'wrap' }}>
          <button className="btn btn-gold btn-sm" onClick={saveCfg} disabled={savingCfg}>
            {savingCfg ? '…' : '💾 Sauvegarder'}
          </button>
          <button className="btn btn-sm" onClick={sendTest} disabled={busy === 'test'}
            style={{ background: 'rgba(59,130,246,0.15)', color: '#60a5fa', border: '1px solid rgba(59,130,246,0.4)' }}>
            {busy === 'test' ? '…' : '✈️ Envoyer un bilan maintenant'}
          </button>
          <button className="btn btn-sm" onClick={resetAll} disabled={busy === 'reset'}
            style={{ background: 'rgba(239,68,68,0.12)', color: '#f87171', border: '1px solid rgba(239,68,68,0.4)' }}>
            {busy === 'reset' ? '…' : '🗑️ Réinitialiser les compteurs'}
          </button>
          <button className="btn btn-sm" onClick={() => setShowChannelsPanel(v => !v)}
            style={{ background: 'rgba(168,85,247,0.12)', color: '#c4b5fd', border: '1px solid rgba(168,85,247,0.4)' }}>
            ⚙️ Configurer les canaux {extraChannels.length > 0 && <span style={{ marginLeft: 6, padding: '1px 6px', borderRadius: 8, background: 'rgba(168,85,247,0.3)', fontSize: 11 }}>+{extraChannels.length}</span>}
          </button>
          <div style={{ marginLeft: 'auto', alignSelf: 'center', fontSize: 12, color: '#64748b' }}>
            Dernier bilan : <b style={{ color: '#94a3b8' }}>{lastReportTs}</b>
            {' · '}Jeux comptés : <b style={{ color: '#94a3b8' }}>{data?.processedCount ?? 0}</b>
          </div>
        </div>

        {/* ── Configuration actuelle (persistante, visible dès qu'un canal est paramétré) ── */}
        {(() => {
          const activeChannels = data?.activeChannels || [];
          const hasAny = activeChannels.length > 0
            || !!data?.config?.bot_token
            || !!data?.config?.channel_id;
          if (!hasAny) return null;
          const nextSched = data?.nextScheduledAt
            ? new Date(data.nextScheduledAt).toLocaleString('fr-FR', { hour: '2-digit', minute: '2-digit' })
            : '—';
          const enabledMain = !!data?.config?.enabled && data?.config?.bot_token && data?.config?.channel_id;
          return (
            <div style={{
              marginTop: 16, padding: 14, borderRadius: 10,
              background: 'rgba(34,197,94,0.06)',
              border: '1px solid rgba(34,197,94,0.4)',
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10, flexWrap: 'wrap' }}>
                <span style={{ fontSize: 16 }}>🛰️</span>
                <div style={{ fontSize: 13, fontWeight: 700, color: '#86efac' }}>
                  Configuration Telegram active
                </div>
                <div style={{ marginLeft: 'auto', display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                  <button className="btn btn-sm" onClick={openPreview}
                    style={{ background: 'rgba(59,130,246,0.15)', color: '#60a5fa', border: '1px solid rgba(59,130,246,0.4)' }}>
                    👁️ Aperçu
                  </button>
                  {(data?.config?.bot_token || data?.config?.channel_id) && (
                    <button className="btn btn-sm" onClick={toggleEnabled} disabled={busy === 'togcfg'}
                      style={{
                        background: enabledMain ? 'rgba(239,68,68,0.12)' : 'rgba(34,197,94,0.15)',
                        color:      enabledMain ? '#f87171' : '#4ade80',
                        border:     '1px solid ' + (enabledMain ? 'rgba(239,68,68,0.4)' : 'rgba(34,197,94,0.4)'),
                      }}>
                      {busy === 'togcfg' ? '…' : (enabledMain ? '⏸ Désactiver' : '▶️ Activer')}
                    </button>
                  )}
                  {(data?.config?.bot_token || data?.config?.channel_id) && (
                    <button className="btn btn-sm" onClick={deleteCfg} disabled={busy === 'delcfg'}
                      style={{ background: 'rgba(239,68,68,0.12)', color: '#f87171', border: '1px solid rgba(239,68,68,0.4)' }}>
                      {busy === 'delcfg' ? '…' : '🗑️ Supprimer'}
                    </button>
                  )}
                </div>
              </div>

              {/* Récap du canal principal */}
              <div style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
                gap: 10, marginBottom: 10,
              }}>
                <div style={{ background: 'rgba(15,23,42,0.4)', borderRadius: 8, padding: '8px 12px' }}>
                  <div style={{ fontSize: 10, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: 0.6, marginBottom: 3 }}>Statut</div>
                  <div style={{ fontSize: 13, fontWeight: 700, color: enabledMain ? '#22c55e' : '#f87171' }}>
                    {enabledMain ? '🟢 Actif' : '🔴 Désactivé'}
                  </div>
                </div>
                <div style={{ background: 'rgba(15,23,42,0.4)', borderRadius: 8, padding: '8px 12px' }}>
                  <div style={{ fontSize: 10, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: 0.6, marginBottom: 3 }}>Bot Token</div>
                  <div style={{ fontSize: 13, fontFamily: 'ui-monospace, monospace', color: '#e2e8f0' }}>
                    {data?.config?.bot_token || '—'}
                  </div>
                </div>
                <div style={{ background: 'rgba(15,23,42,0.4)', borderRadius: 8, padding: '8px 12px' }}>
                  <div style={{ fontSize: 10, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: 0.6, marginBottom: 3 }}>Channel ID</div>
                  <div style={{ fontSize: 13, fontFamily: 'ui-monospace, monospace', color: '#e2e8f0' }}>
                    {data?.config?.channel_id || '—'}
                  </div>
                </div>
                <div style={{ background: 'rgba(15,23,42,0.4)', borderRadius: 8, padding: '8px 12px' }}>
                  <div style={{ fontSize: 10, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: 0.6, marginBottom: 3 }}>Prochain envoi auto</div>
                  <div style={{ fontSize: 13, fontWeight: 700, color: '#fbbf24' }}>⏰ {nextSched}</div>
                </div>
              </div>

              {/* Liste de tous les canaux qui recevront le bilan */}
              {activeChannels.length > 0 && (
                <div>
                  <div style={{ fontSize: 11, color: '#94a3b8', fontWeight: 600, marginBottom: 6, textTransform: 'uppercase', letterSpacing: 0.6 }}>
                    📡 Destinataires du bilan horaire ({activeChannels.filter(c => c.enabled).length} actif{activeChannels.filter(c => c.enabled).length > 1 ? 's' : ''} sur {activeChannels.length})
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                    {activeChannels.map(c => (
                      <div key={c.id} style={{
                        display: 'flex', alignItems: 'center', gap: 10,
                        padding: '6px 10px', borderRadius: 6,
                        background: 'rgba(15,23,42,0.4)',
                        flexWrap: 'wrap',
                      }}>
                        <span style={{ fontSize: 12 }}>{c.enabled ? '🟢' : '⚪'}</span>
                        <span style={{ fontSize: 13, color: '#e2e8f0', fontWeight: 600, minWidth: 110 }}>{c.label}</span>
                        <span style={{ fontSize: 12, color: '#94a3b8', fontFamily: 'ui-monospace, monospace' }}>
                          {c.channel_id || '—'}
                        </span>
                        {c.per_game && (
                          <span title="Envoi du bilan après CHAQUE jeu terminé" style={{
                            fontSize: 10, padding: '1px 6px', borderRadius: 6, fontWeight: 700,
                            background: 'rgba(34,197,94,0.15)', color: '#86efac',
                            border: '1px solid rgba(34,197,94,0.4)',
                          }}>📩 après chaque jeu</span>
                        )}
                        <button
                          className="btn btn-sm"
                          onClick={() => togglePerGame(c.id, !!c.per_game, c.label)}
                          disabled={busy === 'pg:' + c.id}
                          title={c.per_game
                            ? 'Stopper l\'envoi par jeu (revenir au bilan horaire seulement)'
                            : 'Envoyer le bilan après chaque jeu terminé'}
                          style={{
                            fontSize: 11, padding: '2px 8px',
                            background: c.per_game ? 'rgba(239,68,68,0.12)' : 'rgba(34,197,94,0.15)',
                            color:      c.per_game ? '#f87171' : '#4ade80',
                            border:     '1px solid ' + (c.per_game ? 'rgba(239,68,68,0.4)' : 'rgba(34,197,94,0.4)'),
                          }}
                        >
                          {busy === 'pg:' + c.id ? '…' : (c.per_game ? '⏹ Stop' : '▶️ Bilan/jeu')}
                        </button>
                        <span style={{ fontSize: 11, color: '#64748b', marginLeft: 'auto', fontFamily: 'ui-monospace, monospace' }}>
                          token : {c.bot_token_masked || '—'}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          );
        })()}
      </div>

      {/* ── Fenêtre modale : récap configuration + aperçu du premier bilan ── */}
      {showPreview && preview && (
        <div onClick={() => setShowPreview(false)} style={{
          position: 'fixed', inset: 0, zIndex: 1000,
          background: 'rgba(0,0,0,0.7)', backdropFilter: 'blur(4px)',
          display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20,
        }}>
          <div onClick={e => e.stopPropagation()} style={{
            background: 'linear-gradient(135deg, #0f172a 0%, #1e293b 100%)',
            border: '1px solid rgba(34,197,94,0.5)',
            borderRadius: 14, padding: 22,
            maxWidth: 720, width: '100%',
            maxHeight: '90vh', overflowY: 'auto',
            boxShadow: '0 20px 60px rgba(0,0,0,0.6)',
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 14 }}>
              <span style={{ fontSize: 24 }}>✅</span>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 18, fontWeight: 700, color: '#86efac' }}>Configuration enregistrée</div>
                <div style={{ fontSize: 12, color: '#94a3b8', marginTop: 2 }}>
                  Voici les détails du canal et un aperçu du bilan qui sera envoyé à la prochaine heure pile.
                </div>
              </div>
              <button onClick={() => setShowPreview(false)} style={{
                background: 'transparent', border: 'none', color: '#94a3b8',
                fontSize: 24, cursor: 'pointer', padding: '0 6px',
              }}>✕</button>
            </div>

            {/* Statut envoi immédiat du premier bilan */}
            {preview._firstReport && (
              <div style={{
                marginBottom: 12, padding: '10px 12px', borderRadius: 10, fontSize: 13,
                background: preview._firstReport.sent ? 'rgba(34,197,94,0.12)' : 'rgba(251,191,36,0.10)',
                border:     '1px solid ' + (preview._firstReport.sent ? 'rgba(34,197,94,0.4)' : 'rgba(251,191,36,0.4)'),
                color:      preview._firstReport.sent ? '#86efac' : '#fcd34d',
              }}>
                {preview._firstReport.sent
                  ? <>✈️ <b>Premier bilan envoyé immédiatement sur Telegram</b> — vous le verrez dans le canal dans quelques secondes. Les bilans suivants partiront chaque heure pile.</>
                  : <>⚠️ Bilan généré mais non envoyé{preview._firstReport.error ? <> : <i>{preview._firstReport.error}</i></> : ' (aucun canal actif).'}</>}
              </div>
            )}

            {/* Récap canaux actifs */}
            <div style={{
              padding: 12, borderRadius: 10, marginBottom: 14,
              background: 'rgba(34,197,94,0.07)',
              border: '1px solid rgba(34,197,94,0.3)',
            }}>
              <div style={{ fontSize: 11, color: '#94a3b8', fontWeight: 600, textTransform: 'uppercase', letterSpacing: 0.6, marginBottom: 8 }}>
                📡 Canaux qui recevront le bilan
              </div>
              {(preview.activeChannels || []).length === 0 ? (
                <div style={{ fontSize: 13, color: '#fbbf24' }}>
                  ⚠️ Aucun canal actif — activez au moins un canal pour recevoir le bilan automatiquement.
                </div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                  {preview.activeChannels.map(c => (
                    <div key={c.id} style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: 13 }}>
                      <span>{c.enabled ? '🟢' : '⚪'}</span>
                      <span style={{ color: '#e2e8f0', fontWeight: 600, minWidth: 110 }}>{c.label}</span>
                      <span style={{ color: '#94a3b8', fontFamily: 'ui-monospace, monospace' }}>{c.channel_id}</span>
                      <span style={{ color: '#64748b', fontFamily: 'ui-monospace, monospace', marginLeft: 'auto', fontSize: 11 }}>
                        {c.bot_token_masked}
                      </span>
                    </div>
                  ))}
                </div>
              )}
              <div style={{ marginTop: 10, paddingTop: 10, borderTop: '1px dashed rgba(255,255,255,0.1)', display: 'flex', gap: 16, fontSize: 12, color: '#94a3b8', flexWrap: 'wrap' }}>
                <span>⏰ Prochain envoi automatique : <b style={{ color: '#fbbf24' }}>
                  {preview.nextScheduledAt ? new Date(preview.nextScheduledAt).toLocaleString('fr-FR', { hour: '2-digit', minute: '2-digit' }) : '—'}
                </b></span>
                <span>🎰 Jeux déjà comptés : <b style={{ color: '#e2e8f0' }}>{preview.processedCount ?? 0}</b></span>
              </div>
            </div>

            {/* Aperçu du bilan */}
            <div>
              <div style={{ fontSize: 11, color: '#94a3b8', fontWeight: 600, textTransform: 'uppercase', letterSpacing: 0.6, marginBottom: 6 }}>
                👁️ Aperçu du prochain bilan
              </div>
              <div
                style={{
                  background: '#0b1220',
                  border: '1px solid rgba(99,102,241,0.4)',
                  borderRadius: 10, padding: 14,
                  fontSize: 13, color: '#e2e8f0',
                  lineHeight: 1.55, whiteSpace: 'pre-wrap',
                  fontFamily: 'system-ui, -apple-system, sans-serif',
                  maxHeight: 320, overflowY: 'auto',
                }}
                dangerouslySetInnerHTML={{ __html: preview.text || '<i style="color:#64748b">(aucune donnée)</i>' }}
              />
            </div>

            <div style={{ display: 'flex', gap: 10, marginTop: 16, justifyContent: 'flex-end' }}>
              <button className="btn btn-sm" onClick={() => { setShowPreview(false); sendTest(); }}
                disabled={(preview.activeChannels || []).filter(c => c.enabled).length === 0}
                style={{ background: 'rgba(59,130,246,0.15)', color: '#60a5fa', border: '1px solid rgba(59,130,246,0.4)' }}>
                ✈️ Envoyer ce bilan maintenant
              </button>
              <button className="btn btn-gold btn-sm" onClick={() => setShowPreview(false)}>
                ✓ OK, fermer
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Carte des canaux Telegram supplémentaires */}
      {showChannelsPanel && (
        <div className="tg-admin-card" style={{ borderColor: 'rgba(168,85,247,0.4)', marginTop: 16 }}>
          <div className="tg-admin-header">
            <span className="tg-admin-icon">📡</span>
            <div style={{ flex: 1 }}>
              <h2 className="tg-admin-title">Canaux Telegram supplémentaires</h2>
              <p className="tg-admin-sub">
                Le bilan horaire est envoyé sur le canal principal <b>et</b> sur tous les canaux
                supplémentaires actifs ci-dessous. Chaque canal a son propre bot token et channel id.
              </p>
            </div>
            <button className="btn btn-sm btn-gold" onClick={() => startEditChannel(null)}>
              ➕ Ajouter un canal
            </button>
          </div>

          {/* Liste des canaux */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 12 }}>
            {extraChannels.length === 0 && !editingChannel && (
              <div style={{ color: '#64748b', padding: 12, textAlign: 'center', fontSize: 13 }}>
                Aucun canal supplémentaire. Cliquez sur « Ajouter un canal » pour en créer un.
              </div>
            )}
            {extraChannels.map(ch => (
              <div key={ch.id} style={{
                display: 'grid',
                gridTemplateColumns: 'auto 1fr auto',
                gap: 12, alignItems: 'center',
                background: 'rgba(15,23,42,0.4)',
                border: '1px solid rgba(168,85,247,0.2)',
                borderRadius: 10, padding: '10px 14px',
              }}>
                <div title={ch.enabled ? 'Actif' : 'Désactivé'} style={{
                  width: 10, height: 10, borderRadius: '50%',
                  background: ch.enabled ? '#22c55e' : '#64748b',
                }} />
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontSize: 14, fontWeight: 600, color: '#e2e8f0' }}>
                    {ch.label || <i style={{ color: '#64748b' }}>(sans nom)</i>}
                  </div>
                  <div style={{ fontSize: 11, color: '#94a3b8', fontFamily: 'ui-monospace, monospace', marginTop: 2 }}>
                    {ch.channel_id} · token {ch.bot_token || '—'}
                  </div>
                </div>
                <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                  <button
                    className="btn btn-sm"
                    onClick={() => togglePerGame(ch.id, !!ch.per_game, ch.label || ch.channel_id)}
                    disabled={busy === 'pg:' + ch.id}
                    title={ch.per_game
                      ? 'Stopper l\'envoi par jeu (revenir au bilan horaire seulement)'
                      : 'Envoyer le bilan après chaque jeu terminé'}
                    style={{
                      background: ch.per_game ? 'rgba(239,68,68,0.12)' : 'rgba(34,197,94,0.15)',
                      color:      ch.per_game ? '#f87171' : '#4ade80',
                      border:     '1px solid ' + (ch.per_game ? 'rgba(239,68,68,0.4)' : 'rgba(34,197,94,0.4)'),
                    }}>
                    {busy === 'pg:' + ch.id ? '…' : (ch.per_game ? '⏹ Stop' : '▶️ Bilan/jeu')}
                  </button>
                  <button className="btn btn-sm" onClick={() => testChannel(ch.id)} disabled={busy.startsWith('chtest:')}
                    style={{ background: 'rgba(59,130,246,0.15)', color: '#60a5fa', border: '1px solid rgba(59,130,246,0.4)' }}>
                    {busy === 'chtest:' + ch.id ? '…' : '✈️ Test'}
                  </button>
                  <button className="btn btn-sm" onClick={() => startEditChannel(ch)}
                    style={{ background: 'rgba(148,163,184,0.12)', color: '#cbd5e1', border: '1px solid rgba(148,163,184,0.3)' }}>
                    ✏️ Éditer
                  </button>
                  <button className="btn btn-sm" onClick={() => deleteChannel(ch)} disabled={busy === 'chdel'}
                    style={{ background: 'rgba(239,68,68,0.12)', color: '#f87171', border: '1px solid rgba(239,68,68,0.4)' }}>
                    🗑️
                  </button>
                </div>
              </div>
            ))}
          </div>

          {/* Formulaire d'édition / création */}
          {editingChannel && (
            <div style={{
              marginTop: 14, padding: 14, borderRadius: 10,
              background: 'rgba(168,85,247,0.06)',
              border: '1px solid rgba(168,85,247,0.4)',
            }}>
              <div style={{ fontSize: 13, fontWeight: 700, color: '#c4b5fd', marginBottom: 10 }}>
                {editingChannel.id ? '✏️ Modifier le canal' : '➕ Nouveau canal'}
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 10 }}>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                  <label style={{ fontSize: 11, color: '#94a3b8', fontWeight: 600, textTransform: 'uppercase', letterSpacing: 0.8 }}>Nom du canal</label>
                  <input
                    type="text"
                    value={editingChannel.label}
                    placeholder="Ex. Canal de secours"
                    onChange={e => setEditingChannel({ ...editingChannel, label: e.target.value })}
                    style={{ padding: '8px 12px', borderRadius: 8, border: '1px solid rgba(168,85,247,0.3)',
                      background: 'rgba(168,85,247,0.05)', color: '#e2e8f0', fontSize: 13 }}
                  />
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                  <label style={{ fontSize: 11, color: '#94a3b8', fontWeight: 600, textTransform: 'uppercase', letterSpacing: 0.8 }}>Bot Token</label>
                  <input
                    type="text"
                    value={editingChannel.bot_token}
                    placeholder="123456:ABC-DEF…"
                    onChange={e => setEditingChannel({ ...editingChannel, bot_token: e.target.value, _tokenDirty: true })}
                    onFocus={() => { if (editingChannel.bot_token.startsWith('••••')) setEditingChannel({ ...editingChannel, bot_token: '', _tokenDirty: true }); }}
                    style={{ padding: '8px 12px', borderRadius: 8, border: '1px solid rgba(168,85,247,0.3)',
                      background: 'rgba(168,85,247,0.05)', color: '#e2e8f0', fontSize: 13, fontFamily: 'ui-monospace, monospace' }}
                  />
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                  <label style={{ fontSize: 11, color: '#94a3b8', fontWeight: 600, textTransform: 'uppercase', letterSpacing: 0.8 }}>Channel ID</label>
                  <input
                    type="text"
                    value={editingChannel.channel_id}
                    placeholder="-1001234567890 ou @canal"
                    onChange={e => setEditingChannel({ ...editingChannel, channel_id: e.target.value })}
                    style={{ padding: '8px 12px', borderRadius: 8, border: '1px solid rgba(168,85,247,0.3)',
                      background: 'rgba(168,85,247,0.05)', color: '#e2e8f0', fontSize: 13, fontFamily: 'ui-monospace, monospace' }}
                  />
                </div>
                <div style={{ display: 'flex', alignItems: 'flex-end', gap: 10 }}>
                  <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', color: '#e2e8f0', fontSize: 13 }}>
                    <input
                      type="checkbox"
                      checked={!!editingChannel.enabled}
                      onChange={e => setEditingChannel({ ...editingChannel, enabled: e.target.checked })}
                      style={{ width: 16, height: 16, cursor: 'pointer' }}
                    />
                    <span>Canal actif</span>
                  </label>
                </div>
              </div>
              <div style={{ display: 'flex', gap: 10, marginTop: 12 }}>
                <button className="btn btn-gold btn-sm" onClick={saveChannel} disabled={busy === 'chsave'}>
                  {busy === 'chsave' ? '…' : '💾 Enregistrer'}
                </button>
                <button className="btn btn-sm" onClick={cancelEditChannel}
                  style={{ background: 'rgba(148,163,184,0.12)', color: '#cbd5e1', border: '1px solid rgba(148,163,184,0.3)' }}>
                  Annuler
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Tableau des écarts */}
      <div className="tg-admin-card" style={{ borderColor: 'rgba(99,102,241,0.4)', marginTop: 16 }}>
        <div className="tg-admin-header">
          <span className="tg-admin-icon">📊</span>
          <div style={{ flex: 1 }}>
            <h2 className="tg-admin-title">État courant des écarts</h2>
            <p className="tg-admin-sub">
              <b>actuel</b> = série en cours sans apparition · <b>période</b> = plus grand écart
              depuis le dernier bilan · <b>max global</b> = record toutes périodes ·
              <span style={{ color: '#22c55e' }}> 📈 = nouveau record vs bilan précédent</span>.
            </p>
          </div>
        </div>

        {loading && <div style={{ color: '#64748b', padding: 12 }}>Chargement…</div>}

        {!loading && grouped.length === 0 && (
          <div style={{ color: '#64748b', padding: 12 }}>Aucune donnée disponible (le moteur n'a pas encore traité de jeu).</div>
        )}

        {!loading && grouped.map(([group, rows]) => (
          <div key={group} style={{ marginTop: 14 }}>
            <div style={{ fontSize: 13, fontWeight: 700, color: '#cbd5e1', marginBottom: 6 }}>{group}</div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 8 }}>
              {rows.map(row => {
                const prev = prevByKey[row.key];
                const isRecord = prev && row.maxAll > (prev.maxAll || 0);
                return (
                  <div key={row.key} style={{
                    background: 'rgba(15,23,42,0.4)',
                    border: '1px solid rgba(255,255,255,0.06)',
                    borderRadius: 10,
                    padding: '10px 12px',
                  }}>
                    <div style={{ fontSize: 12, color: '#94a3b8', fontWeight: 600, marginBottom: 4 }}>
                      {row.label} {isRecord && <span style={{ color: '#22c55e' }} title="Nouveau record vs bilan précédent">📈</span>}
                    </div>
                    <div style={{ display: 'flex', gap: 10, fontSize: 11, color: '#64748b' }}>
                      <span>actuel <b style={{ color: '#e2e8f0', fontSize: 14 }}>{row.cur}</b></span>
                      <span>période <b style={{ color: '#fbbf24', fontSize: 14 }}>{row.maxPeriod}</b></span>
                      <span>max <b style={{ color: '#a78bfa', fontSize: 14 }}>{row.maxAll}</b></span>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        ))}
      </div>
    </>
  );
}

function ProConfigPanel({ setProSavedModal, setProErrorModal }) {
  // Fallback : si les setters ne sont pas fournis (rendu hors AdminPanel),
  // on utilise un état local pour ne pas crasher.
  const [_localSaved, _setLocalSaved] = React.useState(null);
  const [_localError, _setLocalError] = React.useState(null);
  if (typeof setProSavedModal !== 'function') setProSavedModal = _setLocalSaved;
  if (typeof setProErrorModal !== 'function') setProErrorModal = _setLocalError;

  // ── Accès utilisateur courant : admin ou Pro ──
  const { user: _curUser } = useAuth();
  const _isAdmin = !!_curUser?.is_admin;
  const _isProOnly = !_isAdmin && !!_curUser?.is_pro;
  const [proUsers, setProUsers] = React.useState([]); // pour le sélecteur admin
  const [selectedOwnerId, setSelectedOwnerId] = React.useState(null); // admin: utilisateur ciblé
  // Helper : suffixe query string « ?owner_user_id=N » (admin uniquement)
  const qs = React.useCallback((extra = '') => {
    const sep = extra ? '&' : '?';
    if (_isAdmin && selectedOwnerId) return `${extra ? extra + sep : '?'}owner_user_id=${selectedOwnerId}`;
    return extra || '';
  }, [_isAdmin, selectedOwnerId]);

  const [tgCfg, setTgCfg]         = React.useState({ bot_token: '', channel_id: '', strategy_name: '' });
  const [tgSaved, setTgSaved]     = React.useState({ bot_token: '', channel_id: '', bot_username: '', strategy_name: '' });
  const [tgConfigured, setTgConfigured] = React.useState(false);
  const [tgStratInfo, setTgStratInfo] = React.useState(null);
  const [testMsgSending, setTestMsgSending] = React.useState(false);
  const [testMsgResult, setTestMsgResult] = React.useState('');
  const [saving, setSaving]       = React.useState(false);
  const [saveMsg, setSaveMsg]     = React.useState('');

  const [stratFile, setStratFile] = React.useState(null);
  const [stratMeta, setStratMeta] = React.useState(null);
  const [stratContent, setStratContent] = React.useState(null);
  const [stratList, setStratList] = React.useState([]); // toutes les stratégies Pro chargées (multi-slots)
  const [stratTotal, setStratTotal] = React.useState(0);
  const [stratMax, setStratMax]     = React.useState(100);
  const [stratMsg, setStratMsg]   = React.useState('');
  const [stratSaving, setStratSaving] = React.useState(false);
  const [showPreview, setShowPreview] = React.useState(false);
  const [stratValidation, setStratValidation] = React.useState(null); // { ok, errors, warnings, strategy_name, meta }
  const [selectedFormat, setSelectedFormat] = React.useState('all'); // 'all'|'json'|'js'|'py'|'jsx'
  const [pasteMode, setPasteMode] = React.useState(false); // true = coller le code, false = importer un fichier
  const [pasteCode, setPasteCode] = React.useState('');
  const [pasteFilename, setPasteFilename] = React.useState('ma-strategie.js');

  // ── Formats de message personnalisés ──
  const [customFormats, setCustomFormats] = React.useState([]);
  const [fmtForm, setFmtForm] = React.useState({ name: '', template: '', parse_mode: '' });
  const [fmtEditing, setFmtEditing] = React.useState(null); // id en cours d'édition
  const [fmtSaving, setFmtSaving] = React.useState(false);
  const [fmtMsg, setFmtMsg] = React.useState('');
  const [showFmtPanel, setShowFmtPanel] = React.useState(false);

  // ── Config rapide ──
  const [quickCfg, setQuickCfg] = React.useState({
    name: '', mode: 'absence_apparition', hand: 'joueur',
    threshold: 5, decalage: 2, max_rattrapage: 4, tg_format: 1,
  });
  const [quickSaving, setQuickSaving] = React.useState(false);
  const [quickMsg, setQuickMsg] = React.useState('');

  // ── Logs Pro par stratégie (live) ──
  const [proLogsById, setProLogsById] = React.useState({});           // { [id]: [{ts, level, msg}] }
  const [proLogsExpanded, setProLogsExpanded] = React.useState(null); // id de la stratégie ouverte en grand
  const [proSourceById, setProSourceById] = React.useState({});       // { [id]: 'contenu source' }

  const fetchProLogs = React.useCallback(async (id) => {
    try {
      const r = await fetch(`/api/games/pro-logs?channel=S${id}`, { credentials: 'include' });
      if (!r.ok) return;
      const d = await r.json();
      setProLogsById(prev => ({ ...prev, [id]: Array.isArray(d) ? d : [] }));
    } catch {}
  }, []);

  const fetchProSource = React.useCallback(async (id) => {
    try {
      const r = await fetch(`/api/admin/pro-strategy-file/${id}${qs()}`, { credentials: 'include' });
      if (!r.ok) return;
      const d = await r.json();
      setProSourceById(prev => ({ ...prev, [id]: d.content || '' }));
    } catch {}
  }, [qs]);

  const clearProLogs = async (id) => {
    try {
      await fetch(`/api/games/pro-logs?channel=S${id}`, { method: 'DELETE', credentials: 'include' });
      setProLogsById(prev => ({ ...prev, [id]: [] }));
    } catch {}
  };

  // Polling automatique des logs de toutes les stratégies chargées (toutes les 3s)
  React.useEffect(() => {
    if (!stratList.length) return;
    let cancelled = false;
    const tick = () => {
      if (cancelled) return;
      stratList.forEach(s => fetchProLogs(s.id));
    };
    tick();
    const iv = setInterval(tick, 3000);
    return () => { cancelled = true; clearInterval(iv); };
  }, [stratList, fetchProLogs]);

  // Charger la liste des comptes Pro pour le sélecteur (admin uniquement)
  React.useEffect(() => {
    if (!_isAdmin) return;
    fetch('/api/admin/pro-users', { credentials: 'include' })
      .then(r => r.ok ? r.json() : [])
      .then(d => { if (Array.isArray(d)) setProUsers(d); else if (Array.isArray(d.users)) setProUsers(d.users); })
      .catch(() => {});
  }, [_isAdmin]);

  // (Re)charger la config + la liste à chaque changement de propriétaire
  React.useEffect(() => {
    fetch(`/api/admin/pro-config${qs()}`, { credentials: 'include' })
      .then(r => r.ok ? r.json() : { bot_token: '', channel_id: '' })
      .then(d => { setTgCfg(d); setTgSaved(d); setTgConfigured(!!(d.bot_token && d.channel_id)); })
      .catch(() => {});
    loadStratList();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedOwnerId]);

  const loadStratList = async () => {
    try {
      const r = await fetch(`/api/admin/pro-strategy-file${qs()}`, { credentials: 'include' });
      if (!r.ok) return;
      const d = await r.json();
      setStratList(Array.isArray(d.strategies) ? d.strategies : []);
      setStratTotal(d.total || (d.strategies?.length || 0));
      setStratMax(d.max || 100);
      if (d.meta) { setStratMeta(d.meta); setStratContent(d.content); }
      else { setStratMeta(null); setStratContent(null); }
    } catch {}
  };

  const deleteOneStrategy = async (id, label) => {
    if (!confirm(`Supprimer la stratégie S${id}${label ? ' « '+label+' »' : ''} ?\n\nToutes ses prédictions seront aussi effacées.`)) return;
    try {
      const r = await fetch(`/api/admin/pro-strategy-file/${id}${qs()}`, { method: 'DELETE', credentials: 'include' });
      if (r.ok) { setStratMsg(`🗑 Stratégie S${id} supprimée`); await loadStratList(); }
      else { const d = await r.json().catch(() => ({})); setStratMsg('❌ ' + (d.error || 'Erreur')); }
    } catch (e) { setStratMsg('❌ ' + e.message); }
  };

  const downloadOneStrategy = async (id, filename) => {
    try {
      const r = await fetch(`/api/admin/pro-strategy-file/${id}${qs()}`, { credentials: 'include' });
      if (!r.ok) return;
      const d = await r.json();
      const mime = filename?.endsWith('.py') ? 'text/x-python' : filename?.endsWith('.json') ? 'application/json' : 'text/javascript';
      downloadFile(d.content || '', filename || `strategie_S${id}.txt`, mime);
    } catch {}
  };

  const handleSaveAll = async () => {
    setSaving(true); setSaveMsg(''); setStratValidation(null);
    let botOk = false;
    let fileOk = false;

    // 1. Sauvegarder la config bot si token + canal renseignés
    if (tgCfg.bot_token && tgCfg.channel_id) {
      try {
        const r = await fetch(`/api/admin/pro-config${qs()}`, {
          method: 'POST', credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(tgCfg),
        });
        const d = await r.json();
        if (r.ok) {
          const username = d.bot_username || '';
          setTgSaved({ ...tgCfg, bot_username: username, strategy_name: d.strategy_name || tgCfg.strategy_name });
          setTgConfigured(true);
          botOk = true;
        } else {
          setSaveMsg('❌ Bot : ' + (d.error || 'Erreur')); setSaving(false); return;
        }
      } catch (e) { setSaveMsg('❌ ' + e.message); setSaving(false); return; }
    }

    // 2a. Sauvegarder le fichier importé
    if (stratFile) {
      try {
        const r = await fetch(`/api/admin/pro-strategy-file${qs()}`, {
          method: 'POST', credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ filename: stratFile.name, content: stratFile.content, mimetype: stratFile.mimetype }),
        });
        const d = await r.json();
        if (r.status === 422 || d.validation_failed) {
          setStratValidation({ ok: false, errors: d.errors || [], warnings: d.warnings || [], strategy_name: d.meta?.strategy_name || '', meta: d.meta });
          setSaving(false); return;
        }
        if (r.ok) {
          setStratValidation({ ok: true, errors: [], warnings: d.warnings || [], strategy_name: d.meta?.strategy_name || '', meta: d.meta });
          setStratMeta(d.meta); setStratContent(stratFile.content); setStratFile(null); loadStratList();
          fileOk = true;
        } else { setSaveMsg('❌ Fichier : ' + (d.error || 'Erreur serveur')); setSaving(false); return; }
      } catch (e) { setSaveMsg('❌ ' + e.message); setSaving(false); return; }
    }
    // 2b. Sauvegarder le code collé
    else if (pasteMode && pasteCode.trim()) {
      const fname = pasteFilename.trim() || 'ma-strategie.js';
      const ext   = fname.split('.').pop().toLowerCase();
      const mime  = ext === 'py' ? 'text/x-python' : ext === 'json' ? 'application/json' : 'text/javascript';
      try {
        const r = await fetch(`/api/admin/pro-strategy-file${qs()}`, {
          method: 'POST', credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ filename: fname, content: pasteCode.trim(), mimetype: mime }),
        });
        const d = await r.json();
        if (r.status === 422 || d.validation_failed) {
          setStratValidation({ ok: false, errors: d.errors || [], warnings: d.warnings || [], strategy_name: d.meta?.strategy_name || '', meta: d.meta });
          setSaving(false); return;
        }
        if (r.ok) {
          setStratValidation({ ok: true, errors: [], warnings: d.warnings || [], strategy_name: d.meta?.strategy_name || '', meta: d.meta });
          setStratMeta(d.meta); setStratContent(pasteCode.trim()); loadStratList().catch(()=>{}); setPasteCode(''); setPasteMode(false);
          fileOk = true;
        } else { setSaveMsg('❌ Fichier : ' + (d.error || 'Erreur serveur')); setSaving(false); return; }
      } catch (e) { setSaveMsg('❌ ' + e.message); setSaving(false); return; }
    }

    const parts = [];
    if (botOk)  parts.push('Bot configuré');
    if (fileOk) parts.push('Fichier enregistré');
    setSaveMsg(parts.length ? '✅ ' + parts.join(' · ') : '✅ Enregistré');
    setSaving(false);
  };

  const deleteTgCfg = async () => {
    if (!confirm('Supprimer la configuration Telegram Pro ?')) return;
    await fetch(`/api/admin/pro-config${qs()}`, { method: 'DELETE', credentials: 'include' });
    setTgCfg({ bot_token: '', channel_id: '' }); setTgSaved({ bot_token: '', channel_id: '' });
    setTgConfigured(false); setSaveMsg(''); setTgStratInfo(null); setTestMsgResult('');
  };

  const sendTestMessage = async () => {
    setTestMsgSending(true); setTestMsgResult('');
    try {
      const r = await fetch(`/api/admin/pro-config/test-message${qs()}`, {
        method: 'POST', credentials: 'include',
      });
      const d = await r.json();
      setTestMsgResult(d.ok ? '✅ Message envoyé dans le canal !' : '❌ ' + (d.error || 'Erreur'));
    } catch (e) { setTestMsgResult('❌ ' + e.message); }
    finally { setTestMsgSending(false); }
  };

  const handleFileChange = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setStratMsg(''); setStratValidation(null);
    const reader = new FileReader();
    reader.onload = (ev) => {
      setStratFile({ name: file.name, content: ev.target.result, mimetype: file.type || 'text/plain' });
    };
    reader.readAsText(file);
    e.target.value = '';
  };

  // Helper : POST avec timeout (AbortController) — empêche le bouton de rester bloqué
  const _postProStrategy = async (payload, timeoutMs = 30000) => {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      const r = await fetch(`/api/admin/pro-strategy-file${qs()}`, {
        method: 'POST', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        signal: ctrl.signal,
      });
      const d = await r.json().catch(() => ({}));
      return { status: r.status, ok: r.ok, body: d };
    } finally { clearTimeout(t); }
  };

  const uploadFile = async () => {
    if (!stratFile) return;
    setStratSaving(true); setStratMsg(''); setStratValidation(null);
    try {
      const { status, ok, body: d } = await _postProStrategy({
        filename: stratFile.name, content: stratFile.content, mimetype: stratFile.mimetype,
      });

      // ── Validation échouée (422) ──
      if (status === 422 || d.validation_failed) {
        setStratValidation({ ok: false, errors: d.errors || [], warnings: d.warnings || [], strategy_name: d.meta?.strategy_name || '', meta: d.meta });
        setProErrorModal({
          title: 'Fichier non enregistré',
          message: `La validation de "${stratFile.name}" a échoué.`,
          errors: d.errors || [],
          warnings: d.warnings || [],
        });
        return;
      }
      if (!ok) {
        setStratMsg('❌ ' + (d.error || 'Erreur serveur'));
        setProErrorModal({ title: 'Erreur serveur', message: d.error || `Code HTTP ${status}`, errors: [], warnings: [] });
        return;
      }

      // ── Succès ──
      setStratValidation({ ok: true, errors: [], warnings: d.warnings || [], strategy_name: d.meta?.strategy_name || '', meta: d.meta });
      setStratMeta(d.meta); setStratContent(stratFile.content); setStratFile(null); loadStratList();
      setStratMsg('');
      setProSavedModal({
        type: d.isUpdate ? 'update' : 'create',
        id: d.id,
        filename: d.meta?.filename,
        strategy_name: d.meta?.strategy_name,
        hand: d.meta?.strategy_info?.hand,
        decalage: d.meta?.strategy_info?.decalage,
        max_rattrapage: d.meta?.strategy_info?.max_rattrapage,
        engine_type: d.meta?.engine_type,
        warnings: d.warnings || [],
        engine_error: d.engine_error || null,
      });
    } catch (e) {
      const msg = e.name === 'AbortError'
        ? 'Délai dépassé (30 s) — le serveur ne répond pas. Vérifie ta connexion et réessaie.'
        : e.message;
      setStratMsg('❌ ' + msg);
      setProErrorModal({ title: 'Connexion impossible', message: msg, errors: [], warnings: [] });
    }
    finally { setStratSaving(false); }
  };

  const savePastedCode = async () => {
    const code = pasteCode.trim();
    if (!code) { setStratMsg('❌ Collez votre code dans le champ avant d\'enregistrer'); return; }
    const fname = pasteFilename.trim() || 'ma-strategie.js';
    const ext = fname.split('.').pop().toLowerCase();
    const mime = ext === 'py' ? 'text/x-python' : ext === 'json' ? 'application/json' : 'text/javascript';
    setStratSaving(true); setStratMsg(''); setStratValidation(null);
    try {
      const { status, ok, body: d } = await _postProStrategy({ filename: fname, content: code, mimetype: mime });

      if (status === 422 || d.validation_failed) {
        setStratValidation({ ok: false, errors: d.errors || [], warnings: d.warnings || [], strategy_name: d.meta?.strategy_name || '', meta: d.meta });
        setProErrorModal({
          title: 'Fichier non enregistré',
          message: `La validation de "${fname}" a échoué. Vérifie que le code collé est complet (accolades fermantes + module.exports).`,
          errors: d.errors || [],
          warnings: d.warnings || [],
        });
        return;
      }
      if (!ok) {
        setStratMsg('❌ ' + (d.error || 'Erreur serveur'));
        setProErrorModal({ title: 'Erreur serveur', message: d.error || `Code HTTP ${status}`, errors: [], warnings: [] });
        return;
      }

      setStratValidation({ ok: true, errors: [], warnings: d.warnings || [], strategy_name: d.meta?.strategy_name || '', meta: d.meta });
      setStratMeta(d.meta); setStratContent(code); loadStratList().catch(()=>{});
      setPasteCode(''); setPasteMode(false);
      setStratMsg('');
      setProSavedModal({
        type: d.isUpdate ? 'update' : 'create',
        id: d.id,
        filename: d.meta?.filename,
        strategy_name: d.meta?.strategy_name,
        hand: d.meta?.strategy_info?.hand,
        decalage: d.meta?.strategy_info?.decalage,
        max_rattrapage: d.meta?.strategy_info?.max_rattrapage,
        engine_type: d.meta?.engine_type,
        warnings: d.warnings || [],
        engine_error: d.engine_error || null,
      });
    } catch (e) {
      const msg = e.name === 'AbortError'
        ? 'Délai dépassé (30 s) — le serveur ne répond pas. Vérifie ta connexion et réessaie.'
        : e.message;
      setStratMsg('❌ ' + msg);
      setProErrorModal({ title: 'Connexion impossible', message: msg, errors: [], warnings: [] });
    }
    finally { setStratSaving(false); }
  };

  // ── Formats de message personnalisés — chargement + CRUD ──────
  const loadCustomFormats = async () => {
    try {
      const r = await fetch('/api/admin/tg-formats', { credentials: 'include' });
      if (r.ok) { const d = await r.json(); setCustomFormats(d.formats || []); }
    } catch {}
  };

  React.useEffect(() => { loadCustomFormats(); }, []);

  const saveFmt = async () => {
    if (!fmtForm.name.trim()) { setFmtMsg('❌ Nom requis'); return; }
    if (!fmtForm.template.trim()) { setFmtMsg('❌ Template requis'); return; }
    setFmtSaving(true); setFmtMsg('');
    try {
      const url = fmtEditing ? `/api/admin/tg-formats/${fmtEditing}` : '/api/admin/tg-formats';
      const method = fmtEditing ? 'PUT' : 'POST';
      const r = await fetch(url, { method, credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(fmtForm) });
      const d = await r.json();
      if (!r.ok) { setFmtMsg('❌ ' + (d.error || 'Erreur')); return; }
      setFmtMsg(fmtEditing ? '✅ Format mis à jour' : '✅ Format créé');
      setFmtForm({ name: '', template: '', parse_mode: '' });
      setFmtEditing(null);
      loadCustomFormats();
    } catch (e) { setFmtMsg('❌ ' + e.message); }
    finally { setFmtSaving(false); }
  };

  const deleteFmt = async (id) => {
    if (!window.confirm('Supprimer ce format ?')) return;
    try {
      await fetch(`/api/admin/tg-formats/${id}`, { method: 'DELETE', credentials: 'include' });
      loadCustomFormats();
    } catch {}
  };

  const editFmt = (fmt) => {
    setFmtEditing(fmt.id);
    setFmtForm({ name: fmt.name, template: fmt.template, parse_mode: fmt.parse_mode || '' });
    setShowFmtPanel(true);
  };

  const applyQuickConfig = async () => {
    if (!quickCfg.name.trim()) { setQuickMsg('❌ Donnez un nom à la stratégie'); return; }
    setQuickSaving(true); setQuickMsg(''); setStratValidation(null);
    const json = {
      name: quickCfg.name.trim(),
      strategies: [{
        name: quickCfg.name.trim(),
        mode: quickCfg.mode,
        hand: quickCfg.hand,
        threshold: parseInt(quickCfg.threshold),
        prediction_offset: parseInt(quickCfg.decalage),
        max_rattrapage: parseInt(quickCfg.max_rattrapage),
        tg_format: parseInt(quickCfg.tg_format),
      }],
    };
    const filename = quickCfg.name.trim().toLowerCase().replace(/\s+/g, '_') + '.json';
    try {
      const r = await fetch(`/api/admin/pro-strategy-file${qs()}`, {
        method: 'POST', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ filename, content: JSON.stringify(json, null, 2), mimetype: 'application/json' }),
      });
      const d = await r.json();
      if (r.status === 422 || d.validation_failed) {
        setStratValidation({ ok: false, errors: d.errors || [], warnings: d.warnings || [], strategy_name: d.meta?.strategy_name || '', meta: d.meta });
        setQuickMsg('');
        return;
      }
      if (!r.ok) { setQuickMsg('❌ ' + (d.error || 'Erreur serveur')); return; }
      setStratValidation({ ok: true, errors: [], warnings: d.warnings || [], strategy_name: d.meta?.strategy_name || '', meta: d.meta });
      setStratMeta(d.meta);
      setQuickMsg('✅ Stratégie "' + quickCfg.name.trim() + '" appliquée avec succès !');
    } catch (e) { setQuickMsg('❌ ' + e.message); }
    finally { setQuickSaving(false); }
  };

  const deleteFile = async () => {
    if (stratMeta?.id) { return deleteOneStrategy(stratMeta.id, stratMeta.strategy_name || stratMeta.filename); }
    if (!confirm('Supprimer TOUTES les stratégies Pro ?')) return;
    await fetch(`/api/admin/pro-strategy-file${qs()}`, { method: 'DELETE', credentials: 'include' });
    setStratMeta(null); setStratContent(null); setStratFile(null); setStratMsg('🗑 Toutes les stratégies supprimées');
    loadStratList();
  };

  const fmtSize = (n) => n > 1024 ? `${(n / 1024).toFixed(1)} Ko` : `${n} octets`;
  const fmtDate = (iso) => iso ? new Date(iso).toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short' }) : '—';

  const extIcon = (name = '') => {
    if (name.endsWith('.py'))   return '🐍';
    if (name.endsWith('.js') || name.endsWith('.mjs')) return '🟨';
    if (name.endsWith('.jsx')) return '⚛️';
    if (name.endsWith('.ts') || name.endsWith('.tsx'))  return '🔷';
    if (name.endsWith('.json')) return '📋';
    return '📄';
  };

  const downloadFile = (content, filename, mime) => {
    const blob = new Blob([content], { type: mime });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = filename; a.click();
    URL.revokeObjectURL(url);
  };

  const downloadExampleJson = () => downloadFile(JSON.stringify({
    version: '1.0',
    name: 'Stratégie Pro — Template Universel',
    description: 'Activez/désactivez chaque règle. Toutes les combinaisons mode+hand+seuil sont possibles.',

    strategies: [
      {
        name: 'Règle 1 — Absence costume → Joueur',
        description: 'Prédit un costume quand il est absent depuis N tours côté Joueur. mode=absence_apparition',
        enabled: true,
        mode: 'absence_apparition',
        hand: 'joueur',
        threshold: 5,
        max_rattrapage: 3,
        decalage: 1,
        tg_format: 1,
      },
      {
        name: 'Règle 2 — Absence puis victoire → Banquier',
        description: 'Prédit un costume absent depuis N tours, en attendant qu\'il revienne gagnant. mode=absence_victoire',
        enabled: false,
        mode: 'absence_victoire',
        hand: 'banquier',
        threshold: 5,
        max_rattrapage: 4,
        decalage: 2,
        tg_format: 1,
      },
      {
        name: 'Règle 3 — Costume manquant → Joueur',
        description: 'Prédit les costumes qui n\'ont pas encore apparu dans ce jeu. mode=manquants',
        enabled: false,
        mode: 'manquants',
        hand: 'joueur',
        threshold: 1,
        max_rattrapage: 2,
        decalage: 1,
        tg_format: 1,
      },
      {
        name: 'Règle 4 — Compteur adverse → Banquier',
        description: 'Prédit quand le Banquier a N victoires consécutives sans un costume. mode=compteur_adverse',
        enabled: false,
        mode: 'compteur_adverse',
        hand: 'banquier',
        threshold: 4,
        max_rattrapage: 3,
        decalage: 1,
        tg_format: 1,
      },
      {
        name: 'Règle 5 — Victoire adverse → Joueur',
        description: 'Se déclenche quand la main adverse gagne sans un costume depuis N fois. mode=victoire_adverse',
        enabled: false,
        mode: 'victoire_adverse',
        hand: 'joueur',
        threshold: 3,
        max_rattrapage: 2,
        decalage: 2,
        tg_format: 1,
      },
      {
        name: 'Règle 6 — Costumes apparents → Joueur',
        description: 'Prédit les costumes qui apparaissent fréquemment. mode=apparents',
        enabled: false,
        mode: 'apparents',
        hand: 'joueur',
        threshold: 3,
        max_rattrapage: 2,
        decalage: 1,
        tg_format: 1,
      },
    ],
  }, null, 2), 'strategie-pro-exemple.json', 'application/json');

  const downloadExampleJs = () => downloadFile(
`// ════════════════════════════════════════════════════════════════
// STRATÉGIE PRO — Fichier JavaScript (.js)
// Template universel — toute stratégie, toute exception
// ════════════════════════════════════════════════════════════════
//
// DONNÉES REÇUES à chaque jeu via processGame(...) :
//   gn       → numéro du jeu (entier)
//   pSuits   → costumes côté Joueur  ex: ['♦','♠']
//   bSuits   → costumes côté Banquier ex: ['♥']
//   winner   → résultat : 'Player' | 'Banker' | 'Tie'
//   state    → objet persistant entre les jeux (libre à vous de le remplir)
//
// RETOUR :
//   { suit: '♦' }  →  déclenche une prédiction pour ce costume
//   null            →  aucune prédiction ce tour
//
// PARAMÈTRES lus automatiquement par le moteur :
//   name, hand, decalage, max_rattrapage, tg_format
// ════════════════════════════════════════════════════════════════

module.exports = {

  // ─── Paramètres de la stratégie ────────────────────────────
  name:           'Ma Stratégie Personnalisée',
  hand:           'joueur',   // 'joueur' ou 'banquier'
  decalage:       2,          // Prédit pour le jeu N+2
  max_rattrapage: 4,          // Max 4 rattrapages si erreur

  // FORMAT DU MESSAGE TELEGRAM
  // Option A : tg_format   → numéro d'un format intégré (1-18) ou personnalisé (19+)
  // Option B : tg_template → template défini ici directement (prioritaire sur tg_format)
  //
  // Variables disponibles dans tg_template :
  //   {game}      → numéro du jeu
  //   {emoji}     → émoji du costume  (ex: ♦️)
  //   {suit}      → nom du costume    (ex: Carreau)
  //   {status}    → résultat          (⌛ en cours | ✅ gagné | ❌ perdu)
  //   {maxR}      → max rattrapages
  //   {hand}      → main (joueur / banquier)
  //   {rattrapage}→ numéro du rattrapage
  //   {strategy}  → identifiant de la stratégie
  tg_format:      1,          // Format intégré (ignoré si tg_template est défini)
  tg_template:    null,       // Exemple : '🎯 Jeu #{game} | {emoji} {suit} | {status}'
  // tg_template: '🎯 *Prédiction #{game}*\n🃏 Costume : {emoji} {suit}\n📊 Statut : {status}',

  // ─── Constantes personnalisées ──────────────────────────────
  // Définissez ici tous vos seuils, paramètres, règles
  SEUIL_ABSENCE:        5,   // Déclencher après N absences consécutives
  SEUIL_SERIE_VICTOIRE: 3,   // Exception : N victoires de suite
  SEUIL_SERIE_DEFAITE:  3,   // Exception : N défaites de suite
  COSTUMES:            ['♠', '♥', '♦', '♣'],

  // ─── Logique principale ─────────────────────────────────────
  processGame(gn, pSuits, bSuits, winner, state) {

    // ── 1. Initialisation du state (première exécution) ──────
    if (!state.absences)      state.absences      = { '♠': 0, '♥': 0, '♦': 0, '♣': 0 };
    if (!state.serieVictoires) state.serieVictoires = 0;
    if (!state.serieDefaites)  state.serieDefaites  = 0;
    if (!state.dernierWinner)  state.dernierWinner  = null;
    // Ajoutez autant de compteurs que nécessaire :
    // if (!state.monCompteur) state.monCompteur = 0;

    // ── 2. Sélection de la main analysée ─────────────────────
    const suits = this.hand === 'banquier' ? bSuits : pSuits;

    // ── 3. Mise à jour des absences ───────────────────────────
    for (const s of this.COSTUMES) {
      suits.includes(s) ? (state.absences[s] = 0) : (state.absences[s]++);
    }

    // ── 4. Suivi des séries victoire/défaite ──────────────────
    const handWinner = this.hand === 'joueur' ? 'Player' : 'Banker';
    if (winner === handWinner) {
      state.serieVictoires++;
      state.serieDefaites = 0;
    } else if (winner !== 'Tie') {
      state.serieDefaites++;
      state.serieVictoires = 0;
    }
    state.dernierWinner = winner;

    // ════════════════════════════════════════════════════════
    // EXCEPTIONS — Conditions spéciales qui ont la priorité
    // Décrivez ici tout cas particulier de votre stratégie
    // ════════════════════════════════════════════════════════

    // EXCEPTION 1 : Après N défaites consécutives → forcer prédiction sur le costume le plus absent
    if (state.serieDefaites >= this.SEUIL_SERIE_DEFAITE) {
      const plusAbsent = this.COSTUMES.reduce((a, b) => state.absences[a] >= state.absences[b] ? a : b);
      if (state.absences[plusAbsent] >= 2) { // seulement si vraiment absent
        state.serieDefaites = 0;
        return { suit: plusAbsent };
      }
    }

    // EXCEPTION 2 : Après N victoires consécutives → pause (ne pas prédire)
    if (state.serieVictoires >= this.SEUIL_SERIE_VICTOIRE) {
      // Optionnel : réinitialiser les absences après une belle série
      // state.absences = { '♠': 0, '♥': 0, '♦': 0, '♣': 0 };
      return null; // Pause stratégique
    }

    // EXCEPTION 3 : Exemple de condition combinée personnalisée
    // if (state.absences['♦'] >= 3 && winner === 'Tie') {
    //   return { suit: '♦' }; // Exception spécifique Tie + absence
    // }

    // EXCEPTION 4 : Condition sur numéro de jeu
    // if (gn % 10 === 0) return null; // Pause tous les 10 jeux

    // ════════════════════════════════════════════════════════
    // RÈGLE PRINCIPALE — Logique normale de prédiction
    // ════════════════════════════════════════════════════════

    // Règle : costume absent depuis SEUIL tours → prédire son retour
    for (const s of this.COSTUMES) {
      if (state.absences[s] >= this.SEUIL_ABSENCE) {
        state.absences[s] = 0;
        return { suit: s };
      }
    }

    // Règle alternative : si AUCUNE absence critique, chercher le plus absent (seuil réduit)
    // const candidat = this.COSTUMES.find(s => state.absences[s] >= 3);
    // if (candidat) { state.absences[candidat] = 0; return { suit: candidat }; }

    return null; // Aucune condition déclenchée ce tour
  },
};

// ════════════════════════════════════════════════════════════════
// 📚 EXEMPLE AVANCÉ — Lecture des jeux passés via state.dbData
// ════════════════════════════════════════════════════════════════
//
// Le moteur garnit automatiquement state.dbData (clé = numéro de jeu)
// à partir de la table cartes_jeu. Ceci permet de regarder N jeux en
// arrière SANS appel async, dès le tout premier tour.
//
// Structure de chaque entrée state.dbData[N] :
//   {
//     gameNumber  : 745,
//     playerSuits : ['♦','♠'],         // costumes côté Joueur
//     bankerSuits : ['♥'],              // costumes côté Banquier
//     winner      : 'Player',           // ou 'Banker' / 'Tie'
//     dist        : '2/2',              // distribution de cartes
//     playerCards : [{R,S}, {R,S}],     // (présent pour le snapshot initial)
//     bankerCards : [{R,S}, {R,S}],
//   }
//
// EXEMPLE : prédire en se basant sur le costume gagnant 32 jeux plus tôt.
//
// module.exports = {
//   name: 'Stratégie Historique',
//   hand: 'joueur',
//   decalage: 2,
//   max_rattrapage: 3,
//   tg_format: 1,
//   HISTORY: 32,   // nombre de jeux à remonter
//
//   processGame(gn, pSuits, bSuits, winner, state, ctx) {
//     // Numéro du jeu source à lire (ex: gn=748, HISTORY=32 → 716)
//     const refGn = gn - this.HISTORY;
//     const past  = state.dbData?.[refGn];
//     if (!past) {
//       console.log('[histo] pas de données pour le jeu', refGn);
//       return null;
//     }
//     // Reproduit le 1er costume du jeu source côté Joueur
//     const firstSuit = (past.playerSuits || [])[0];
//     if (!firstSuit) return null;
//     return { suit: firstSuit };
//   },
// };
//
// 💡 ASTUCE : ctx (6e argument) fournit aussi un accès async complet :
//   ctx.cartes.byGameNumber(N)        → ligne brute de cartes_jeu
//   ctx.cartes.getCard(N, 'p', 1)     → 1ère carte du Joueur du jeu N
//   ctx.cartes.getNear(p, refGn)      → liste des jeux proches
//   ctx.live.gameNumber               → dernier jeu LIVE (depuis 1xBet)
// ════════════════════════════════════════════════════════════════
`, 'strategie-pro-exemple.js', 'text/javascript');

  const downloadExamplePy = () => downloadFile(
`# ════════════════════════════════════════════════════════════════
# STRATÉGIE PRO — Fichier Python (.py)
# Template universel — toute stratégie, toute exception
# ════════════════════════════════════════════════════════════════
#
# DONNÉES REÇUES à chaque jeu (via stdin JSON) :
#   game_number   → numéro du jeu (entier)
#   player_suits  → costumes côté Joueur  ex: ["♦","♠"]
#   banker_suits  → costumes côté Banquier ex: ["♥"]
#   winner        → résultat : "Player" | "Banker" | "Tie"
#   state         → dict persistant entre les jeux (libre à vous)
#
# RETOUR (via stdout JSON) :
#   {"result": {"suit": "♦"}, "state": {...}}  → prédiction
#   {"result": null,           "state": {...}}  → aucune prédiction
#
# PARAMÈTRES lus automatiquement par le moteur (en haut du fichier) :
#   NAME, HAND, DECALAGE, MAX_RATTRAPAGE, TG_FORMAT
#
# IMPORTANT : Le fichier doit être autonome (pas d'imports externes)
#             Seuls json et sys sont autorisés
# ════════════════════════════════════════════════════════════════

import json
import sys

# ─── Paramètres de la stratégie (lus par le moteur) ──────────────
NAME           = "Ma Stratégie Personnalisée"
HAND           = "joueur"    # "joueur" ou "banquier"
DECALAGE       = 2           # Prédit pour le jeu N+2
MAX_RATTRAPAGE = 4           # Max 4 rattrapages si erreur
TG_FORMAT      = 1           # Format intégré (1-18) ou personnalisé (19+)

# FORMAT DU MESSAGE TELEGRAM PERSONNALISÉ (prioritaire sur TG_FORMAT si défini)
# Variables disponibles : {game} {emoji} {suit} {status} {maxR} {hand} {rattrapage} {strategy}
# Exemple :
# TG_TEMPLATE = """🎯 Jeu #{game}
# 🃏 Costume : {emoji} {suit}
# 📊 Statut  : {status}"""
TG_TEMPLATE = None  # Mettre None pour utiliser TG_FORMAT à la place

# ─── Constantes personnalisées ────────────────────────────────────
# Définissez ici tous vos seuils, paramètres, règles
COSTUMES             = ["\\u2660", "\\u2665", "\\u2666", "\\u2663"]  # ♠ ♥ ♦ ♣
SEUIL_ABSENCE        = 5   # Déclencher après N absences consécutives
SEUIL_SERIE_VICTOIRE = 3   # Exception : N victoires de suite → pause
SEUIL_SERIE_DEFAITE  = 3   # Exception : N défaites → forcer prédiction


def process_game(game_number, player_suits, banker_suits, winner, state):
    """Appelée à chaque jeu. Retourne {"suit": "♦"} ou None."""

    # ── 1. Initialisation du state (première exécution) ──────────
    if "absences"       not in state: state["absences"]       = {s: 0 for s in COSTUMES}
    if "serie_victoires" not in state: state["serie_victoires"] = 0
    if "serie_defaites"  not in state: state["serie_defaites"]  = 0
    if "dernier_winner"  not in state: state["dernier_winner"]  = None
    # Ajoutez autant de compteurs que nécessaire :
    # if "mon_compteur" not in state: state["mon_compteur"] = 0

    # ── 2. Sélection de la main analysée ─────────────────────────
    suits = banker_suits if HAND == "banquier" else player_suits

    # ── 3. Mise à jour des absences ──────────────────────────────
    for s in COSTUMES:
        if s in suits:
            state["absences"][s] = 0
        else:
            state["absences"][s] += 1

    # ── 4. Suivi des séries victoire/défaite ─────────────────────
    hand_winner = "Player" if HAND == "joueur" else "Banker"
    if winner == hand_winner:
        state["serie_victoires"] += 1
        state["serie_defaites"]   = 0
    elif winner != "Tie":
        state["serie_defaites"]  += 1
        state["serie_victoires"]  = 0
    state["dernier_winner"] = winner

    # ════════════════════════════════════════════════════════════
    # EXCEPTIONS — Conditions spéciales qui ont la priorité
    # Décrivez ici tout cas particulier de votre stratégie
    # ════════════════════════════════════════════════════════════

    # EXCEPTION 1 : Après N défaites → forcer prédiction sur le plus absent
    if state["serie_defaites"] >= SEUIL_SERIE_DEFAITE:
        plus_absent = max(COSTUMES, key=lambda s: state["absences"][s])
        if state["absences"][plus_absent] >= 2:
            state["serie_defaites"] = 0
            return {"suit": plus_absent}

    # EXCEPTION 2 : Après N victoires consécutives → pause stratégique
    if state["serie_victoires"] >= SEUIL_SERIE_VICTOIRE:
        return None  # Pause — ne pas prédire

    # EXCEPTION 3 : Condition combinée personnalisée
    # if state["absences"]["♦"] >= 3 and winner == "Tie":
    #     return {"suit": "♦"}

    # EXCEPTION 4 : Condition sur numéro de jeu
    # if game_number % 10 == 0:
    #     return None  # Pause tous les 10 jeux

    # EXCEPTION 5 : Condition sur costumes adverses
    # if "♠" in banker_suits and state["absences"]["♦"] >= 3:
    #     return {"suit": "♦"}

    # ════════════════════════════════════════════════════════════
    # RÈGLE PRINCIPALE — Logique normale de prédiction
    # ════════════════════════════════════════════════════════════

    # Règle : costume absent depuis SEUIL tours → prédire son retour
    for s in COSTUMES:
        if state["absences"][s] >= SEUIL_ABSENCE:
            state["absences"][s] = 0
            return {"suit": s}

    # Règle alternative commentée (décommentez si besoin) :
    # candidat = next((s for s in COSTUMES if state["absences"][s] >= 3), None)
    # if candidat:
    #     state["absences"][candidat] = 0
    #     return {"suit": candidat}

    return None  # Aucune condition déclenchée ce tour


# ════════════════════════════════════════════════════════════════
# PROTOCOLE stdin/stdout (NE PAS MODIFIER)
# ════════════════════════════════════════════════════════════════
data   = json.loads(sys.stdin.read())
state  = data.get("state", {})
result = process_game(
    data["game_number"],
    data["player_suits"],
    data["banker_suits"],
    data.get("winner"),
    state,
)
print(json.dumps({"result": result, "state": state}))
`, 'strategie-pro-exemple.py', 'text/x-python');

  const downloadExampleJsx = () => downloadFile(
`// ════════════════════════════════════════════════════════
// STRATÉGIE PRO — Fichier JSX (.jsx)
// ════════════════════════════════════════════════════════
// NOTE : Les fichiers JSX sont stockés comme référence visuelle.
// Pour une stratégie exécutable, utilisez .js ou .py
// ════════════════════════════════════════════════════════

// Exemple de logique de stratégie en format JSX
// Ce composant illustre la logique de prédiction utilisée

const strategiePro = {
  name: "Stratégie Absence JSX",
  hand: "joueur",
  decalage: 1,
  max_rattrapage: 3,

  // Logique de prédiction (identique à la version .js)
  processGame(gn, pSuits, bSuits, winner, state) {
    if (!state.absences) {
      state.absences = { "♠": 0, "♥": 0, "♦": 0, "♣": 0 };
    }
    const suits = pSuits;
    for (const s of ["♠", "♥", "♦", "♣"]) {
      suits.includes(s) ? (state.absences[s] = 0) : (state.absences[s] += 1);
    }
    for (const s of ["♠", "♥", "♦", "♣"]) {
      if (state.absences[s] >= 5) {
        state.absences[s] = 0;
        return { suit: s };
      }
    }
    return null;
  },
};

// Composant React pour visualiser la stratégie
export default function StrategieVisualisation({ gameHistory }) {
  return (
    <div className="strategie-container">
      <h3>{strategiePro.name}</h3>
      <p>Main surveillée : <strong>{strategiePro.hand}</strong></p>
      <p>Décalage : <strong>{strategiePro.decalage} tour(s)</strong></p>
      <p>Max rattrapage : <strong>{strategiePro.max_rattrapage}</strong></p>
    </div>
  );
}
`, 'strategie-pro-exemple.jsx', 'text/jsx');

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 24, maxWidth: 860, margin: '0 auto' }}>

      {/* ── EN-TÊTE ── */}
      <div style={{ background: 'linear-gradient(135deg, rgba(99,102,241,0.12), rgba(139,92,246,0.08))', border: '1px solid rgba(99,102,241,0.3)', borderRadius: 14, padding: '20px 24px', display: 'flex', alignItems: 'center', gap: 16 }}>
        <div style={{ fontSize: 40 }}>🔷</div>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 20, fontWeight: 800, color: '#e2e8f0' }}>Configuration Compte Pro</div>
          <div style={{ fontSize: 13, color: '#64748b', marginTop: 4 }}>
            {_isProOnly
              ? 'Votre bot Telegram personnel et vos stratégies de prédiction.'
              : 'Configurez le bot Telegram dédié aux comptes Pro et importez le fichier de stratégie de prédiction.'}
          </div>
        </div>
      </div>

      {/* ── SÉLECTEUR ADMIN : choisir le compte Pro à éditer ── */}
      {_isAdmin && (
        <div style={{ background: 'rgba(251,191,36,0.06)', border: '1px solid rgba(251,191,36,0.35)', borderRadius: 12, padding: '14px 18px', display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
          <div style={{ fontSize: 20 }}>👁️</div>
          <div style={{ fontSize: 13, color: '#fbbf24', fontWeight: 700 }}>Voir / éditer le compte Pro de :</div>
          <select
            value={selectedOwnerId || ''}
            onChange={(e) => setSelectedOwnerId(e.target.value ? parseInt(e.target.value) : null)}
            style={{ flex: 1, minWidth: 220, padding: '8px 12px', borderRadius: 8, background: 'rgba(0,0,0,0.3)', color: '#e2e8f0', border: '1px solid rgba(251,191,36,0.4)', fontSize: 13, fontWeight: 600 }}
          >
            <option value="">— Mon compte (admin) —</option>
            {proUsers.map(u => (
              <option key={u.id} value={u.id}>
                {u.username}{u.first_name ? ` (${u.first_name})` : ''} {u.is_pro ? '🔷' : '⚠️ désactivé'} — id {u.id}
              </option>
            ))}
          </select>
          {selectedOwnerId && (
            <button
              type="button"
              onClick={() => setSelectedOwnerId(null)}
              style={{ padding: '6px 12px', background: 'rgba(251,191,36,0.15)', color: '#fbbf24', border: '1px solid rgba(251,191,36,0.4)', borderRadius: 6, fontSize: 12, fontWeight: 700, cursor: 'pointer' }}
            >
              Retour à mon compte
            </button>
          )}
        </div>
      )}

      {/* ── PANNEAU UNIFIÉ : TELEGRAM + FICHIER ── */}
      <div style={{ background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(99,102,241,0.25)', borderRadius: 14, padding: 22 }}>

        {/* ── Section Bot Telegram ── */}
        <div style={{ marginBottom: 20 }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 10, marginBottom: 14 }}>
            <div>
              <div style={{ fontSize: 16, fontWeight: 800, color: '#e2e8f0' }}>📡 Token API &amp; Canal Telegram</div>
              <div style={{ fontSize: 12, color: tgConfigured ? '#4ade80' : '#64748b', marginTop: 3 }}>
                {tgConfigured
                  ? `✅ Configuré${tgSaved.bot_username ? ' — @' + tgSaved.bot_username : ''} · ${tgSaved.channel_id}`
                  : 'Non configuré — remplissez les champs ci-dessous et cliquez Enregistrer'}
              </div>
            </div>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
              {tgConfigured && (
                <>
                  <button type="button" onClick={sendTestMessage} disabled={testMsgSending}
                    style={{ padding: '6px 14px', borderRadius: 8, border: '1px solid rgba(99,102,241,0.4)', background: 'rgba(99,102,241,0.1)', color: '#a5b4fc', fontWeight: 700, fontSize: 12, cursor: testMsgSending ? 'wait' : 'pointer' }}>
                    {testMsgSending ? '⏳…' : '📨 Test'}
                  </button>
                  {testMsgResult && (
                    <span style={{ fontSize: 12, color: testMsgResult.startsWith('✅') ? '#4ade80' : '#f87171', fontWeight: 600 }}>
                      {testMsgResult}
                    </span>
                  )}
                  <button type="button" onClick={deleteTgCfg}
                    style={{ padding: '6px 14px', borderRadius: 8, border: '1px solid rgba(239,68,68,0.4)', background: 'rgba(239,68,68,0.08)', color: '#f87171', fontSize: 12, cursor: 'pointer' }}>
                    🗑 Supprimer
                  </button>
                </>
              )}
            </div>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            <div style={{ fontSize: 11, color: '#64748b', lineHeight: 1.6, background: 'rgba(99,102,241,0.06)', borderRadius: 8, padding: '9px 14px', borderLeft: '3px solid rgba(99,102,241,0.4)' }}>
              Le bot doit être <strong style={{ color: '#e2e8f0' }}>administrateur</strong> du canal.
              Créez un bot via <strong style={{ color: '#818cf8' }}>@BotFather</strong> sur Telegram, puis collez son token ci-dessous.
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
              <div>
                <label style={{ display: 'block', color: '#94a3b8', fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.8, marginBottom: 6 }}>🔑 API TOKEN BOT</label>
                <input value={tgCfg.bot_token} onChange={e => setTgCfg(p => ({ ...p, bot_token: e.target.value }))}
                  placeholder="123456:AAF-xxxxx…"
                  style={{ width: '100%', padding: '10px 12px', borderRadius: 9, border: '1px solid rgba(99,102,241,0.3)', background: 'rgba(99,102,241,0.06)', color: '#e2e8f0', fontSize: 12, fontFamily: 'monospace', boxSizing: 'border-box' }} />
                <div style={{ fontSize: 9, color: '#475569', marginTop: 3 }}>Fourni par @BotFather</div>
              </div>
              <div>
                <label style={{ display: 'block', color: '#94a3b8', fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.8, marginBottom: 6 }}>📢 ID CANAL TELEGRAM</label>
                <input value={tgCfg.channel_id} onChange={e => setTgCfg(p => ({ ...p, channel_id: e.target.value }))}
                  placeholder="@canal_pro ou -1001234…"
                  style={{ width: '100%', padding: '10px 12px', borderRadius: 9, border: '1px solid rgba(99,102,241,0.3)', background: 'rgba(99,102,241,0.06)', color: '#e2e8f0', fontSize: 12, fontFamily: 'monospace', boxSizing: 'border-box' }} />
                <div style={{ fontSize: 9, color: '#475569', marginTop: 3 }}>@nom ou identifiant numérique</div>
              </div>
            </div>
            <div>
              <label style={{ display: 'block', color: '#94a3b8', fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.8, marginBottom: 6 }}>📛 NOM DE LA STRATÉGIE</label>
              <input value={tgCfg.strategy_name} onChange={e => setTgCfg(p => ({ ...p, strategy_name: e.target.value }))}
                placeholder="ex : Stratégie Absence Joueur 3ème Carte…"
                style={{ width: '100%', padding: '10px 12px', borderRadius: 9, border: '1px solid rgba(99,102,241,0.3)', background: 'rgba(99,102,241,0.06)', color: '#e2e8f0', fontSize: 12, boxSizing: 'border-box' }} />
              <div style={{ fontSize: 9, color: '#475569', marginTop: 3 }}>Affiché dans la fiche et dans les messages Telegram</div>
            </div>
          </div>
        </div>

        {/* ── Séparateur ── */}
        <div style={{ borderTop: '1px solid rgba(99,102,241,0.15)', marginBottom: 20 }} />

        {/* ── Sous-section Fichier de stratégie ── */}
        <div>
          <div style={{ fontSize: 16, fontWeight: 800, color: '#e2e8f0', marginBottom: 4 }}>📂 Fichier de stratégie avancée</div>
          <div style={{ fontSize: 12, color: '#64748b', lineHeight: 1.7, marginBottom: 16 }}>
            Importez un fichier JS, Python ou JSON. Le moteur l'exécutera et enverra les prédictions sur le site et dans le canal Telegram configuré.
          </div>

          {/* ── Barre horizontale scrollable d'exemples ── */}
          <div style={{ fontSize: 11, fontWeight: 700, color: '#64748b', textTransform: 'uppercase', letterSpacing: 0.8, marginBottom: 10 }}>
            Format du fichier à importer
          </div>
          <div style={{ display: 'flex', gap: 10, overflowX: 'auto', paddingBottom: 6, scrollbarWidth: 'thin', marginBottom: 16 }}>
            {[
              { id: 'all',  icon: '📂', ext: '.json / .js / .py / .jsx', label: 'Tous les formats', badge: 'Universel',   badgeColor: '#94a3b8', accent: '#94a3b8', bg: 'rgba(100,116,139,0.08)', border: 'rgba(100,116,139,0.3)',  desc: 'Accepte tous les types',              fn: null,              accept: '.json,.js,.mjs,.py,.jsx,.ts,.tsx,application/json,text/javascript,text/x-python,text/plain' },
              { id: 'json', icon: '📋', ext: '.json',                    label: 'JSON déclaratif',  badge: 'Déclaratif',  badgeColor: '#4ade80', accent: '#4ade80', bg: 'rgba(34,197,94,0.08)',   border: 'rgba(34,197,94,0.3)',   desc: 'Modes intégrés : absence, manquants…', fn: downloadExampleJson, accept: '.json,application/json' },
              { id: 'js',   icon: '🟨', ext: '.js',                      label: 'JavaScript (vm)',  badge: 'Exécuté (vm)', badgeColor: '#fbbf24', accent: '#fbbf24', bg: 'rgba(251,191,36,0.07)',  border: 'rgba(251,191,36,0.3)',  desc: 'processGame() — chaque jeu',          fn: downloadExampleJs,   accept: '.js,.mjs,text/javascript' },
              { id: 'py',   icon: '🐍', ext: '.py',                      label: 'Python 3.12',      badge: 'Python 3.12', badgeColor: '#818cf8', accent: '#818cf8', bg: 'rgba(99,102,241,0.07)',  border: 'rgba(99,102,241,0.3)',  desc: 'stdin/stdout JSON — chaque jeu',     fn: downloadExamplePy,   accept: '.py,text/x-python' },
              { id: 'jsx',  icon: '⚛️', ext: '.jsx / .tsx',              label: 'JSX (référence)',  badge: 'Référence',   badgeColor: '#94a3b8', accent: '#94a3b8', bg: 'rgba(100,116,139,0.06)', border: 'rgba(100,116,139,0.22)', desc: 'Stocké, non exécuté',                fn: downloadExampleJsx,  accept: '.jsx,.tsx' },
            ].map(({ id, icon, ext, label, badge, badgeColor, accent, bg, border, desc, fn, accept }) => {
              const active = selectedFormat === id;
              return (
                <div key={id} onClick={() => setSelectedFormat(id)}
                  style={{ flexShrink: 0, width: 148, borderRadius: 12, border: `1px solid ${active ? accent : border}`, background: active ? bg : 'rgba(255,255,255,0.02)', cursor: 'pointer', padding: '12px 12px 10px', display: 'flex', flexDirection: 'column', gap: 6, boxShadow: active ? `0 0 0 2px ${accent}30` : 'none', transition: 'all .15s' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
                    <span style={{ fontSize: 20 }}>{icon}</span>
                    <div>
                      <div style={{ fontSize: 12, fontWeight: 800, color: active ? accent : '#e2e8f0', fontFamily: 'monospace' }}>{ext}</div>
                      <div style={{ fontSize: 9, color: '#475569' }}>{label}</div>
                    </div>
                  </div>
                  <span style={{ fontSize: 9, fontWeight: 700, color: badgeColor, background: `${accent}15`, border: `1px solid ${accent}40`, borderRadius: 4, padding: '1px 6px', alignSelf: 'flex-start' }}>{badge}</span>
                  <div style={{ fontSize: 10, color: '#64748b', lineHeight: 1.4, flex: 1 }}>{desc}</div>
                  {fn && (
                    <button type="button" onClick={e => { e.stopPropagation(); fn(); }}
                      style={{ padding: '5px 8px', borderRadius: 7, border: `1px solid ${border}`, background: 'transparent', color: accent, fontWeight: 700, fontSize: 10, cursor: 'pointer', marginTop: 2 }}>
                      ⬇️ Télécharger
                    </button>
                  )}
                  {active && <span style={{ fontSize: 8, fontWeight: 700, color: accent, textAlign: 'center', letterSpacing: 0.5 }}>SÉLECTIONNÉ</span>}
                </div>
              );
            })}
          </div>
        </div>

        {/* ── Liste multi-stratégies Pro (jusqu'à 100 slots) ── */}
        <div style={{ background: 'rgba(99,102,241,0.06)', border: '1px solid rgba(99,102,241,0.22)', borderRadius: 12, padding: '12px 14px', marginBottom: 14 }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
            <div>
              <div style={{ fontSize: 13, fontWeight: 800, color: '#c7d2fe', letterSpacing: 0.3 }}>📚 Stratégies Pro chargées</div>
              <div style={{ fontSize: 11, color: '#64748b', marginTop: 2 }}>Chaque import crée un nouveau slot. Vous pouvez modifier ou supprimer, mais pas remplacer.</div>
            </div>
            <div style={{ fontSize: 12, fontWeight: 700, padding: '4px 10px', borderRadius: 8, background: stratTotal >= stratMax ? 'rgba(239,68,68,0.12)' : 'rgba(99,102,241,0.15)', color: stratTotal >= stratMax ? '#f87171' : '#a5b4fc', border: `1px solid ${stratTotal >= stratMax ? 'rgba(239,68,68,0.3)' : 'rgba(99,102,241,0.3)'}` }}>
              {stratTotal} / {stratMax} slots
            </div>
          </div>
          {stratList.length === 0 ? (
            <div style={{ fontSize: 12, color: '#64748b', fontStyle: 'italic', textAlign: 'center', padding: '10px 0' }}>
              Aucune stratégie importée — utilisez le bouton d'import ci-dessous pour en ajouter une.
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {stratList.map(s => {
                const logs = proLogsById[s.id] || [];
                const lastLogs = logs.slice(-4);
                return (
                <div key={s.id} style={{ display: 'flex', flexDirection: 'column', gap: 6, padding: '8px 12px', background: 'rgba(15,23,42,0.5)', borderRadius: 8, border: '1px solid rgba(99,102,241,0.15)' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                    <span style={{ fontSize: 22 }}>{extIcon(s.filename)}</span>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 14, fontWeight: 800, color: '#e2e8f0', wordBreak: 'break-all', lineHeight: 1.25 }} title={s.strategy_name || s.filename}>
                        {s.strategy_name || s.filename}
                        <span style={{ fontSize: 10, fontWeight: 700, color: '#818cf8', background: 'rgba(99,102,241,0.15)', padding: '1px 6px', borderRadius: 5, fontFamily: 'monospace', marginLeft: 8 }}>S{s.id}</span>
                      </div>
                      <div style={{ fontSize: 10, color: '#64748b', marginTop: 2, fontFamily: 'monospace', wordBreak: 'break-all' }} title={s.filename}>
                        📄 {s.filename} · {s.engine_type || s.file_type}
                        {s.engine_loaded === true && <span style={{ color: '#4ade80', marginLeft: 6 }}>✓ actif</span>}
                        {s.engine_loaded === false && <span style={{ color: '#94a3b8', marginLeft: 6 }}>— stocké</span>}
                      </div>
                    </div>
                    <button type="button" onClick={() => downloadOneStrategy(s.id, s.filename)}
                      title="Télécharger"
                      style={{ padding: '4px 10px', borderRadius: 6, border: '1px solid rgba(99,102,241,0.3)', background: 'rgba(99,102,241,0.08)', color: '#a5b4fc', fontSize: 11, cursor: 'pointer' }}>⬇</button>
                    <button type="button" onClick={() => deleteOneStrategy(s.id, s.strategy_name || s.filename)}
                      title="Supprimer"
                      style={{ padding: '4px 10px', borderRadius: 6, border: '1px solid rgba(239,68,68,0.3)', background: 'rgba(239,68,68,0.08)', color: '#f87171', fontSize: 11, cursor: 'pointer' }}>🗑</button>
                  </div>

                  {/* Bouton d'ouverture des logs Pro */}
                  {s.engine_loaded === true && (
                    <button type="button"
                      onClick={() => { setProLogsExpanded(s.id); fetchProLogs(s.id); fetchProSource(s.id); }}
                      style={{
                        display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10,
                        padding: '10px 14px', borderRadius: 8,
                        border: '1px solid rgba(168,85,247,0.35)',
                        background: 'linear-gradient(135deg, rgba(168,85,247,0.12), rgba(99,102,241,0.10))',
                        color: '#e9d5ff', cursor: 'pointer', fontWeight: 700, fontSize: 12,
                        textAlign: 'left', width: '100%',
                      }}
                      title={`Ouvrir les logs Pro de "${s.strategy_name || s.filename}"`}>
                      <span style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
                        <span style={{ fontSize: 16 }}>📜</span>
                        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          Ouvrir les logs Pro de la stratégie <span style={{ color: '#fff', fontWeight: 800 }}>{s.strategy_name || s.filename}</span>
                        </span>
                      </span>
                      <span style={{ display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0 }}>
                        <span style={{ fontSize: 10, color: '#a5b4fc', background: 'rgba(99,102,241,0.18)', border: '1px solid rgba(99,102,241,0.35)', padding: '2px 7px', borderRadius: 5, fontFamily: 'monospace' }}>
                          {logs.length} ligne{logs.length > 1 ? 's' : ''}
                        </span>
                        <span style={{ fontSize: 13 }}>⛶</span>
                      </span>
                    </button>
                  )}
                </div>
                );
              })}
            </div>
          )}
        </div>

        {stratMeta && (
          <div style={{ background: 'rgba(34,197,94,0.07)', border: '1px solid rgba(34,197,94,0.25)', borderRadius: 12, padding: '14px 16px', marginBottom: 16 }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 10 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                <span style={{ fontSize: 30 }}>{extIcon(stratMeta.filename)}</span>
                <div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                    <span style={{ fontSize: 14, fontWeight: 700, color: '#e2e8f0', fontFamily: 'monospace' }}>{stratMeta.filename}</span>
                    {stratMeta.engine_loaded === true && stratMeta.engine_type === 'json' && (
                      <span style={{ fontSize: 10, fontWeight: 700, background: 'rgba(34,197,94,0.15)', color: '#4ade80', border: '1px solid rgba(34,197,94,0.3)', borderRadius: 6, padding: '1px 7px' }}>
                        ✅ JSON · {stratMeta.strategy_count || 0} stratégie{(stratMeta.strategy_count || 0) > 1 ? 's' : ''} chargées
                      </span>
                    )}
                    {stratMeta.engine_loaded === true && stratMeta.engine_type === 'script_js' && (
                      <span style={{ fontSize: 10, fontWeight: 700, background: 'rgba(251,191,36,0.15)', color: '#fbbf24', border: '1px solid rgba(251,191,36,0.35)', borderRadius: 6, padding: '1px 7px' }}>
                        ⚡ JS · Exécuté dans le moteur (vm sandbox)
                      </span>
                    )}
                    {stratMeta.engine_loaded === true && stratMeta.engine_type === 'script_py' && (
                      <span style={{ fontSize: 10, fontWeight: 700, background: 'rgba(99,102,241,0.15)', color: '#818cf8', border: '1px solid rgba(99,102,241,0.35)', borderRadius: 6, padding: '1px 7px' }}>
                        🐍 Python · Exécuté via Python 3.12
                      </span>
                    )}
                    {stratMeta.engine_loaded === false && (
                      <span style={{ fontSize: 10, fontWeight: 700, background: 'rgba(100,116,139,0.15)', color: '#94a3b8', border: '1px solid rgba(100,116,139,0.3)', borderRadius: 6, padding: '1px 7px' }}>
                        📁 Stocké · non exécuté
                      </span>
                    )}
                  </div>
                  <div style={{ fontSize: 11, color: '#64748b', marginTop: 2 }}>
                    {fmtSize(stratMeta.size)} · Modifié le {fmtDate(stratMeta.updated_at)}
                    {stratMeta.strategy_names?.length > 0 && (
                      <span style={{ marginLeft: 8, color: '#475569' }}>— {stratMeta.strategy_names.join(', ')}</span>
                    )}
                    {stratMeta.note && stratMeta.engine_loaded !== true && (
                      <div style={{ marginTop: 4, color: '#64748b', fontStyle: 'italic' }}>{stratMeta.note}</div>
                    )}
                  </div>
                </div>
              </div>
              <div style={{ display: 'flex', gap: 8 }}>
                <button type="button" onClick={() => setShowPreview(v => !v)}
                  style={{ padding: '6px 14px', borderRadius: 8, border: '1px solid rgba(34,197,94,0.3)', background: 'rgba(34,197,94,0.08)', color: '#86efac', fontSize: 12, cursor: 'pointer' }}>
                  {showPreview ? '🙈 Masquer' : '👁 Aperçu'}
                </button>
                <button type="button" onClick={deleteFile}
                  style={{ padding: '6px 14px', borderRadius: 8, border: '1px solid rgba(239,68,68,0.35)', background: 'rgba(239,68,68,0.08)', color: '#f87171', fontSize: 12, cursor: 'pointer' }}>
                  🗑 Supprimer
                </button>
              </div>
            </div>
            {showPreview && stratContent && (
              <div style={{ marginTop: 14, maxHeight: 320, overflowY: 'auto', background: '#0a0f1e', borderRadius: 8, padding: '12px 14px', fontSize: 11, fontFamily: 'monospace', color: '#4ade80', lineHeight: 1.75, whiteSpace: 'pre-wrap', wordBreak: 'break-word', border: '1px solid rgba(34,197,94,0.15)' }}>
                {stratContent}
              </div>
            )}
          </div>
        )}

        {stratFile && (
          <div style={{ background: 'rgba(251,191,36,0.07)', border: '1px solid rgba(251,191,36,0.25)', borderRadius: 12, padding: '12px 16px', marginBottom: 14, display: 'flex', alignItems: 'center', gap: 12 }}>
            <span style={{ fontSize: 26 }}>{extIcon(stratFile.name)}</span>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 13, fontWeight: 700, color: '#e2e8f0', fontFamily: 'monospace' }}>{stratFile.name}</div>
              <div style={{ fontSize: 11, color: '#64748b', marginTop: 2 }}>{fmtSize(stratFile.content.length)} · Prêt à enregistrer</div>
            </div>
            <button type="button" onClick={() => setStratFile(null)}
              style={{ padding: '4px 10px', borderRadius: 7, border: '1px solid rgba(100,116,139,0.3)', background: 'none', color: '#64748b', fontSize: 11, cursor: 'pointer' }}>✕</button>
          </div>
        )}

        {stratMsg && (
          <div style={{ padding: '8px 14px', borderRadius: 8, marginBottom: 14, background: stratMsg.startsWith('⚠️') ? 'rgba(251,191,36,0.08)' : 'rgba(239,68,68,0.1)', border: `1px solid ${stratMsg.startsWith('⚠️') ? 'rgba(251,191,36,0.3)' : 'rgba(239,68,68,0.3)'}`, color: stratMsg.startsWith('⚠️') ? '#fbbf24' : '#fca5a5', fontSize: 13 }}>
            {stratMsg}
          </div>
        )}

        {/* ── Rapport de validation ── */}
        {stratValidation && (
          <div style={{ marginBottom: 16, borderRadius: 12, overflow: 'hidden', border: `1px solid ${stratValidation.ok ? 'rgba(34,197,94,0.35)' : 'rgba(239,68,68,0.35)'}` }}>
            {/* En-tête résultat */}
            <div style={{ padding: '12px 16px', background: stratValidation.ok ? 'rgba(34,197,94,0.10)' : 'rgba(239,68,68,0.10)', display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
              <span style={{ fontSize: 18 }}>{stratValidation.ok ? '✅' : '❌'}</span>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 13, fontWeight: 800, color: stratValidation.ok ? '#4ade80' : '#f87171' }}>
                  {stratValidation.ok ? 'Analyse réussie — fichier enregistré' : `${stratValidation.errors.length} erreur(s) détectée(s) — fichier non enregistré`}
                </div>
                {stratValidation.strategy_name && (
                  <div style={{ fontSize: 11, color: '#94a3b8', marginTop: 2 }}>
                    Stratégie identifiée : <strong style={{ color: '#e2e8f0', fontFamily: 'monospace' }}>"{stratValidation.strategy_name}"</strong>
                    {stratValidation.ok && <span style={{ marginLeft: 8, color: '#818cf8' }}>→ apparaîtra sous ce nom dans les Canaux (ID : S5001)</span>}
                  </div>
                )}
              </div>
              {stratValidation.ok && stratValidation.meta?.strategy_info && (() => {
                const si = stratValidation.meta.strategy_info;
                return (
                  <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                    {si.hand && <span style={{ fontSize: 10, fontWeight: 700, background: 'rgba(99,102,241,0.15)', color: '#818cf8', border: '1px solid rgba(99,102,241,0.3)', borderRadius: 5, padding: '2px 7px' }}>Main : {si.hand}</span>}
                    {si.decalage !== undefined && <span style={{ fontSize: 10, fontWeight: 700, background: 'rgba(99,102,241,0.15)', color: '#818cf8', border: '1px solid rgba(99,102,241,0.3)', borderRadius: 5, padding: '2px 7px' }}>Décalage : +{si.decalage}</span>}
                    {si.max_rattrapage !== undefined && <span style={{ fontSize: 10, fontWeight: 700, background: 'rgba(99,102,241,0.15)', color: '#818cf8', border: '1px solid rgba(99,102,241,0.3)', borderRadius: 5, padding: '2px 7px' }}>Rattrapages : {si.max_rattrapage}</span>}
                    {si.count > 1 && <span style={{ fontSize: 10, fontWeight: 700, background: 'rgba(34,197,94,0.12)', color: '#4ade80', border: '1px solid rgba(34,197,94,0.3)', borderRadius: 5, padding: '2px 7px' }}>{si.count} stratégies</span>}
                  </div>
                );
              })()}
            </div>

            {/* Erreurs */}
            {stratValidation.errors.length > 0 && (
              <div style={{ background: 'rgba(239,68,68,0.05)', borderTop: '1px solid rgba(239,68,68,0.15)' }}>
                {stratValidation.errors.map((err, i) => (
                  <div key={i} style={{ padding: '9px 16px', borderBottom: i < stratValidation.errors.length - 1 ? '1px solid rgba(239,68,68,0.1)' : 'none', display: 'flex', gap: 10, alignItems: 'flex-start' }}>
                    <span style={{ fontSize: 11, fontWeight: 800, background: 'rgba(239,68,68,0.2)', color: '#f87171', borderRadius: 4, padding: '1px 6px', whiteSpace: 'nowrap', marginTop: 1 }}>{err.type}</span>
                    <div style={{ flex: 1 }}>
                      <span style={{ fontSize: 12, color: '#fca5a5' }}>{err.message}</span>
                      {err.line && <span style={{ marginLeft: 8, fontSize: 11, color: '#94a3b8', fontFamily: 'monospace' }}>ligne {err.line}{err.col ? `:${err.col}` : ''}</span>}
                    </div>
                  </div>
                ))}
              </div>
            )}

            {/* Avertissements */}
            {stratValidation.warnings.length > 0 && (
              <div style={{ background: 'rgba(251,191,36,0.04)', borderTop: '1px solid rgba(251,191,36,0.15)' }}>
                <div style={{ padding: '6px 16px 2px', fontSize: 10, fontWeight: 700, color: '#64748b', textTransform: 'uppercase', letterSpacing: 0.8 }}>Avertissements</div>
                {stratValidation.warnings.map((w, i) => (
                  <div key={i} style={{ padding: '7px 16px', borderBottom: i < stratValidation.warnings.length - 1 ? '1px solid rgba(251,191,36,0.08)' : 'none', display: 'flex', gap: 10, alignItems: 'flex-start' }}>
                    <span style={{ fontSize: 11, fontWeight: 800, background: 'rgba(251,191,36,0.15)', color: '#fbbf24', borderRadius: 4, padding: '1px 6px', whiteSpace: 'nowrap', marginTop: 1 }}>{w.type}</span>
                    <span style={{ fontSize: 12, color: '#fde68a', flex: 1 }}>{w.message}</span>
                  </div>
                ))}
              </div>
            )}

            {/* Noms des stratégies JSON */}
            {stratValidation.ok && stratValidation.meta?.strategy_info?.names?.length > 0 && stratValidation.meta.strategy_info.names.length > 1 && (
              <div style={{ padding: '10px 16px', background: 'rgba(34,197,94,0.04)', borderTop: '1px solid rgba(34,197,94,0.12)', display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
                <span style={{ fontSize: 11, color: '#64748b', fontWeight: 600 }}>Stratégies dans les Canaux :</span>
                {stratValidation.meta.strategy_info.names.map((n, i) => (
                  <span key={i} style={{ fontSize: 11, fontWeight: 700, background: 'rgba(34,197,94,0.12)', color: '#4ade80', borderRadius: 5, padding: '2px 8px', border: '1px solid rgba(34,197,94,0.25)', fontFamily: 'monospace' }}>
                    S{5001 + i} · {n}
                  </span>
                ))}
              </div>
            )}
          </div>
        )}

        {/* ── Toggle Fichier / Coller le code ── */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 0, marginBottom: 14, borderRadius: 9, border: '1px solid rgba(99,102,241,0.25)', overflow: 'hidden', alignSelf: 'flex-start' }}>
          <button type="button" onClick={() => { setPasteMode(false); setStratFile(null); }}
            style={{ padding: '8px 18px', border: 'none', background: !pasteMode ? 'rgba(99,102,241,0.25)' : 'transparent', color: !pasteMode ? '#a5b4fc' : '#475569', fontWeight: 700, fontSize: 12, cursor: 'pointer', transition: 'all .15s' }}>
            📁 Importer un fichier
          </button>
          <button type="button" onClick={() => { setPasteMode(true); setStratFile(null); if (selectedFormat !== 'all') setPasteFilename('ma-strategie.' + selectedFormat); }}
            style={{ padding: '8px 18px', border: 'none', borderLeft: '1px solid rgba(99,102,241,0.2)', background: pasteMode ? 'rgba(99,102,241,0.25)' : 'transparent', color: pasteMode ? '#a5b4fc' : '#475569', fontWeight: 700, fontSize: 12, cursor: 'pointer', transition: 'all .15s' }}>
            ✏️ Coller le code
          </button>
        </div>

        {/* ── Mode Coller le code ── */}
        {pasteMode && (
          <div style={{ marginBottom: 16, display: 'flex', flexDirection: 'column', gap: 10 }}>
            {/* Champ nom de fichier */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <span style={{ fontSize: 11, color: '#64748b', fontWeight: 700, whiteSpace: 'nowrap' }}>Nom du fichier :</span>
              <input
                type="text"
                value={pasteFilename}
                onChange={e => setPasteFilename(e.target.value)}
                placeholder="ma-strategie.js"
                style={{ flex: 1, maxWidth: 260, padding: '7px 12px', borderRadius: 7, border: '1px solid rgba(99,102,241,0.3)', background: 'rgba(15,23,42,0.6)', color: '#e2e8f0', fontSize: 13, fontFamily: 'monospace', outline: 'none' }}
              />
              <span style={{ fontSize: 10, color: '#475569' }}>.js · .py · .json</span>
            </div>
            {/* Zone de texte pour coller */}
            <textarea
              value={pasteCode}
              onChange={e => setPasteCode(e.target.value)}
              placeholder={"Collez votre code ici…\n\n// Exemple JS :\nmodule.exports = { name: 'Ma Stratégie', hand: 'joueur', decalage: 2, max_rattrapage: 4, tg_format: 1,\n  processGame(gn, pSuits, bSuits, winner, state) {\n    // votre logique\n    return null;\n  }\n};"}
              spellCheck={false}
              style={{ width: '100%', minHeight: 260, padding: '14px 16px', borderRadius: 10, border: '1px solid rgba(99,102,241,0.3)', background: 'rgba(10,15,30,0.8)', color: '#e2e8f0', fontSize: 12, fontFamily: 'monospace', lineHeight: 1.7, resize: 'vertical', outline: 'none', boxSizing: 'border-box' }}
            />
            {/* Bouton enregistrer */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <button type="button" onClick={savePastedCode} disabled={stratSaving || !pasteCode.trim()}
                style={{ padding: '9px 26px', borderRadius: 9, border: 'none', background: (stratSaving || !pasteCode.trim()) ? 'rgba(99,102,241,0.15)' : 'linear-gradient(135deg,#6366f1,#a855f7)', color: (stratSaving || !pasteCode.trim()) ? '#475569' : '#fff', fontWeight: 700, fontSize: 13, cursor: (stratSaving || !pasteCode.trim()) ? 'not-allowed' : 'pointer' }}>
                {stratSaving ? '⏳ Enregistrement…' : '💾 Enregistrer'}
              </button>
              {pasteCode.trim() && (
                <span style={{ fontSize: 11, color: '#475569', fontFamily: 'monospace' }}>
                  {Math.round(pasteCode.length / 100) / 10} Ko · {pasteCode.split('\n').length} lignes
                </span>
              )}
              <button type="button" onClick={() => { setPasteCode(''); setPasteMode(false); }}
                style={{ marginLeft: 'auto', padding: '6px 12px', borderRadius: 7, border: '1px solid rgba(100,116,139,0.25)', background: 'transparent', color: '#475569', fontSize: 11, cursor: 'pointer' }}>
                Annuler
              </button>
            </div>
          </div>
        )}

        {/* ── Mode Importer un fichier ── */}
        {!pasteMode && (
        <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
          <label style={{ display: 'inline-flex', alignItems: 'center', gap: 8, padding: '9px 20px', borderRadius: 9, border: '1px solid rgba(34,197,94,0.35)', background: 'rgba(34,197,94,0.07)', color: '#86efac', fontWeight: 700, fontSize: 13, cursor: 'pointer' }}>
            📁 Choisir un fichier
            <input type="file"
              accept={
                selectedFormat === 'json' ? '.json,application/json' :
                selectedFormat === 'js'   ? '.js,.mjs,text/javascript' :
                selectedFormat === 'py'   ? '.py,text/x-python' :
                selectedFormat === 'jsx'  ? '.jsx,.tsx' :
                '.json,.js,.mjs,.py,.jsx,.ts,.tsx,application/json,text/javascript,text/x-python,text/plain'
              }
              onChange={handleFileChange} style={{ display: 'none' }} />
          </label>
          {stratFile && (
            <button type="button" onClick={uploadFile} disabled={stratSaving}
              style={{ padding: '9px 22px', borderRadius: 9, border: 'none', background: stratSaving ? 'rgba(34,197,94,0.2)' : 'linear-gradient(135deg,#16a34a,#22c55e)', color: stratSaving ? '#475569' : '#fff', fontWeight: 700, fontSize: 13, cursor: stratSaving ? 'wait' : 'pointer' }}>
              {stratSaving ? '⏳ Enregistrement…' : '💾 Enregistrer le fichier'}
            </button>
          )}
          {stratFile && (
            <span style={{ fontSize: 12, color: '#64748b', fontFamily: 'monospace' }}>
              📄 {stratFile.name} ({Math.round(stratFile.content.length / 100) / 10} Ko)
            </span>
          )}
        </div>
        )}

      </div>

      {/* ── Séparateur ── */}
      <div style={{ borderTop: '1px solid rgba(99,102,241,0.15)', margin: '20px 0' }} />

      {/* ── Formats de message personnalisés ── */}
      <div>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14, flexWrap: 'wrap', gap: 8 }}>
          <div>
            <div style={{ fontSize: 16, fontWeight: 800, color: '#e2e8f0' }}>🎨 Formats de message personnalisés</div>
            <div style={{ fontSize: 12, color: '#64748b', marginTop: 2, lineHeight: 1.6 }}>
              Créez vos propres templates Telegram, en nombre illimité. Utilisez <code style={{ background: 'rgba(99,102,241,0.15)', color: '#a5b4fc', padding: '1px 5px', borderRadius: 4 }}>tg_template</code> directement dans votre fichier, ou référencez un format DB via <code style={{ background: 'rgba(99,102,241,0.15)', color: '#a5b4fc', padding: '1px 5px', borderRadius: 4 }}>tg_format: {'{'}19 + ID{'}'}</code>
            </div>
          </div>
          <button type="button" onClick={() => { setShowFmtPanel(v => !v); setFmtEditing(null); setFmtForm({ name: '', template: '', parse_mode: '' }); setFmtMsg(''); }}
            style={{ padding: '7px 16px', borderRadius: 8, border: '1px solid rgba(99,102,241,0.35)', background: showFmtPanel ? 'rgba(99,102,241,0.2)' : 'rgba(99,102,241,0.08)', color: '#a5b4fc', fontWeight: 700, fontSize: 12, cursor: 'pointer' }}>
            {showFmtPanel ? '✕ Fermer' : '➕ Nouveau format'}
          </button>
        </div>

        {/* Variables disponibles */}
        <div style={{ background: 'rgba(15,23,42,0.5)', borderRadius: 10, padding: '10px 14px', marginBottom: 14, border: '1px solid rgba(99,102,241,0.15)', display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center' }}>
          <span style={{ fontSize: 10, color: '#64748b', fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.8 }}>Variables :</span>
          {['{game}','{emoji}','{suit}','{status}','{maxR}','{hand}','{rattrapage}','{strategy}'].map(v => (
            <code key={v} style={{ background: 'rgba(99,102,241,0.12)', color: '#818cf8', padding: '2px 7px', borderRadius: 5, fontSize: 11, fontFamily: 'monospace' }}>{v}</code>
          ))}
        </div>

        {/* Formulaire création/édition */}
        {showFmtPanel && (
          <div style={{ background: 'rgba(99,102,241,0.06)', border: '1px solid rgba(99,102,241,0.25)', borderRadius: 12, padding: '18px 18px 14px', marginBottom: 16, display: 'flex', flexDirection: 'column', gap: 12 }}>
            <div style={{ fontSize: 13, fontWeight: 700, color: '#a5b4fc' }}>{fmtEditing ? '✏️ Modifier le format' : '➕ Nouveau format'}</div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
              <div>
                <div style={{ fontSize: 10, color: '#64748b', fontWeight: 700, textTransform: 'uppercase', marginBottom: 5 }}>Nom du format *</div>
                <input value={fmtForm.name} onChange={e => setFmtForm(f => ({ ...f, name: e.target.value }))}
                  placeholder="ex: Mon format personnalisé"
                  style={{ width: '100%', padding: '8px 12px', borderRadius: 7, border: '1px solid rgba(99,102,241,0.3)', background: 'rgba(15,23,42,0.6)', color: '#e2e8f0', fontSize: 13, outline: 'none', boxSizing: 'border-box' }} />
              </div>
              <div>
                <div style={{ fontSize: 10, color: '#64748b', fontWeight: 700, textTransform: 'uppercase', marginBottom: 5 }}>Parse mode (optionnel)</div>
                <select value={fmtForm.parse_mode} onChange={e => setFmtForm(f => ({ ...f, parse_mode: e.target.value }))}
                  style={{ width: '100%', padding: '8px 12px', borderRadius: 7, border: '1px solid rgba(99,102,241,0.3)', background: 'rgba(15,23,42,0.8)', color: '#e2e8f0', fontSize: 13, outline: 'none' }}>
                  <option value="">Aucun</option>
                  <option value="Markdown">Markdown</option>
                  <option value="HTML">HTML</option>
                </select>
              </div>
            </div>
            <div>
              <div style={{ fontSize: 10, color: '#64748b', fontWeight: 700, textTransform: 'uppercase', marginBottom: 5 }}>Template du message *</div>
              <textarea value={fmtForm.template} onChange={e => setFmtForm(f => ({ ...f, template: e.target.value }))}
                placeholder={'🎯 Jeu #{game}\n🃏 Costume : {emoji} {suit}\n📊 Statut  : {status}'}
                spellCheck={false} rows={4}
                style={{ width: '100%', padding: '10px 12px', borderRadius: 8, border: '1px solid rgba(99,102,241,0.3)', background: 'rgba(10,15,30,0.8)', color: '#e2e8f0', fontSize: 12, fontFamily: 'monospace', lineHeight: 1.7, resize: 'vertical', outline: 'none', boxSizing: 'border-box' }} />
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <button type="button" onClick={saveFmt} disabled={fmtSaving}
                style={{ padding: '8px 22px', borderRadius: 8, border: 'none', background: fmtSaving ? 'rgba(99,102,241,0.2)' : 'linear-gradient(135deg,#6366f1,#a855f7)', color: fmtSaving ? '#475569' : '#fff', fontWeight: 700, fontSize: 13, cursor: fmtSaving ? 'wait' : 'pointer' }}>
                {fmtSaving ? '⏳…' : fmtEditing ? '💾 Mettre à jour' : '💾 Créer le format'}
              </button>
              {fmtEditing && (
                <button type="button" onClick={() => { setFmtEditing(null); setFmtForm({ name: '', template: '', parse_mode: '' }); }}
                  style={{ padding: '7px 14px', borderRadius: 8, border: '1px solid rgba(100,116,139,0.3)', background: 'transparent', color: '#64748b', fontSize: 12, cursor: 'pointer' }}>
                  Annuler l'édition
                </button>
              )}
              {fmtMsg && <span style={{ fontSize: 12, color: fmtMsg.startsWith('✅') ? '#4ade80' : '#f87171', fontWeight: 600 }}>{fmtMsg}</span>}
            </div>
          </div>
        )}

        {/* Liste des formats */}
        {customFormats.length === 0 ? (
          <div style={{ padding: '14px 16px', borderRadius: 10, background: 'rgba(100,116,139,0.06)', border: '1px dashed rgba(100,116,139,0.2)', color: '#475569', fontSize: 12, textAlign: 'center' }}>
            Aucun format personnalisé — créez-en un avec le bouton ci-dessus, ou utilisez directement <code style={{ color: '#818cf8' }}>tg_template</code> dans votre fichier.
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {customFormats.map(fmt => (
              <div key={fmt.id} style={{ borderRadius: 10, border: '1px solid rgba(99,102,241,0.2)', background: 'rgba(99,102,241,0.04)', padding: '12px 14px', display: 'flex', flexDirection: 'column', gap: 6 }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                    <span style={{ fontSize: 10, fontWeight: 800, background: 'rgba(99,102,241,0.2)', color: '#818cf8', border: '1px solid rgba(99,102,241,0.3)', borderRadius: 5, padding: '2px 8px', fontFamily: 'monospace' }}>
                      tg_format: {18 + fmt.id}
                    </span>
                    <span style={{ fontSize: 13, fontWeight: 700, color: '#e2e8f0' }}>{fmt.name}</span>
                    {fmt.parse_mode && <span style={{ fontSize: 10, color: '#64748b', background: 'rgba(100,116,139,0.1)', borderRadius: 4, padding: '1px 6px' }}>{fmt.parse_mode}</span>}
                  </div>
                  <div style={{ display: 'flex', gap: 6 }}>
                    <button type="button" onClick={() => editFmt(fmt)}
                      style={{ padding: '4px 10px', borderRadius: 6, border: '1px solid rgba(99,102,241,0.3)', background: 'transparent', color: '#818cf8', fontSize: 11, cursor: 'pointer' }}>✏️ Modifier</button>
                    <button type="button" onClick={() => deleteFmt(fmt.id)}
                      style={{ padding: '4px 10px', borderRadius: 6, border: '1px solid rgba(239,68,68,0.3)', background: 'transparent', color: '#f87171', fontSize: 11, cursor: 'pointer' }}>🗑</button>
                  </div>
                </div>
                <pre style={{ margin: 0, padding: '8px 12px', background: 'rgba(10,15,30,0.7)', borderRadius: 7, fontSize: 11, fontFamily: 'monospace', color: '#94a3b8', whiteSpace: 'pre-wrap', wordBreak: 'break-word', lineHeight: 1.6, border: '1px solid rgba(99,102,241,0.1)' }}>
                  {fmt.template}
                </pre>
                <div style={{ fontSize: 10, color: '#475569' }}>
                  Utilisez <code style={{ color: '#818cf8' }}>tg_format: {18 + fmt.id}</code> dans votre stratégie JSON/JS/Python pour ce format
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* ── Modal Logs Pro agrandis ───────────────────────────────────── */}
      {proLogsExpanded !== null && (() => {
        const s = stratList.find(x => x.id === proLogsExpanded);
        const logs = proLogsById[proLogsExpanded] || [];
        const source = proSourceById[proLogsExpanded] || '';
        return (
          <div onClick={() => setProLogsExpanded(null)}
            style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.75)', zIndex: 9999, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}>
            <div onClick={e => e.stopPropagation()}
              style={{ background: '#0f172a', border: '1px solid rgba(168,85,247,0.4)', borderRadius: 14, width: '100%', maxWidth: 960, maxHeight: '90vh', display: 'flex', flexDirection: 'column', boxShadow: '0 20px 60px rgba(0,0,0,0.6)' }}>
              <div style={{ padding: '14px 18px', borderBottom: '1px solid rgba(99,102,241,0.2)', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}>
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontSize: 14, fontWeight: 800, color: '#e2e8f0' }}>📜 Logs Pro · S{proLogsExpanded}</div>
                  <div style={{ fontSize: 11, color: '#94a3b8', fontFamily: 'monospace', wordBreak: 'break-all', marginTop: 2 }}>
                    {s?.filename} {s?.strategy_name ? `· ${s.strategy_name}` : ''}
                  </div>
                </div>
                <div style={{ display: 'flex', gap: 6 }}>
                  <button type="button" onClick={() => fetchProLogs(proLogsExpanded)}
                    style={{ padding: '6px 10px', borderRadius: 6, border: '1px solid rgba(99,102,241,0.3)', background: 'rgba(99,102,241,0.08)', color: '#a5b4fc', fontSize: 11, cursor: 'pointer', fontWeight: 700 }}>🔄 Rafraîchir</button>
                  <button type="button" onClick={() => clearProLogs(proLogsExpanded)}
                    style={{ padding: '6px 10px', borderRadius: 6, border: '1px solid rgba(239,68,68,0.3)', background: 'rgba(239,68,68,0.08)', color: '#f87171', fontSize: 11, cursor: 'pointer', fontWeight: 700 }}>🗑 Vider</button>
                  <button type="button" onClick={() => setProLogsExpanded(null)}
                    style={{ padding: '6px 12px', borderRadius: 6, border: '1px solid rgba(100,116,139,0.4)', background: 'transparent', color: '#cbd5e1', fontSize: 11, cursor: 'pointer', fontWeight: 700 }}>✕ Fermer</button>
                </div>
              </div>
              {/* Bandeau "idée de la stratégie" : extrait du commentaire en tête du fichier */}
              {(() => {
                const headerLines = [];
                if (source) {
                  const lines = source.split('\n');
                  for (const ln of lines) {
                    const t = ln.trim();
                    if (t === '' || t === '//' || /^\/\*+/.test(t) || /^\*+\/?$/.test(t)) continue;
                    const m = t.match(/^(?:\/\/+|#|\*+)\s?(.*)$/);
                    if (m) {
                      const cleaned = m[1].replace(/^[=\-─━]+$/, '').trim();
                      if (cleaned) headerLines.push(cleaned);
                    } else {
                      break; // première ligne de code → on s'arrête
                    }
                    if (headerLines.length >= 8) break;
                  }
                }
                const info = s?.strategy_info || {};
                return (
                  <div style={{ padding: '10px 14px', background: 'rgba(168,85,247,0.06)', borderBottom: '1px solid rgba(168,85,247,0.2)' }}>
                    <div style={{ fontSize: 10, fontWeight: 800, color: '#c084fc', textTransform: 'uppercase', letterSpacing: 0.8, marginBottom: 6 }}>
                      💡 Idée de la stratégie
                    </div>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: headerLines.length ? 8 : 0 }}>
                      {info.hand && <span style={{ fontSize: 10, color: '#fbbf24', background: 'rgba(251,191,36,0.1)', border: '1px solid rgba(251,191,36,0.3)', padding: '2px 8px', borderRadius: 5, fontWeight: 700 }}>main : {info.hand}</span>}
                      {(info.decalage !== undefined) && <span style={{ fontSize: 10, color: '#4ade80', background: 'rgba(34,197,94,0.1)', border: '1px solid rgba(34,197,94,0.3)', padding: '2px 8px', borderRadius: 5, fontWeight: 700 }}>décalage : +{info.decalage}</span>}
                      {(info.max_rattrapage !== undefined) && <span style={{ fontSize: 10, color: '#60a5fa', background: 'rgba(59,130,246,0.1)', border: '1px solid rgba(59,130,246,0.3)', padding: '2px 8px', borderRadius: 5, fontWeight: 700 }}>rattrapages max : {info.max_rattrapage}</span>}
                      {info.entry_fn && <span style={{ fontSize: 10, color: '#a5b4fc', background: 'rgba(99,102,241,0.1)', border: '1px solid rgba(99,102,241,0.3)', padding: '2px 8px', borderRadius: 5, fontWeight: 700, fontFamily: 'monospace' }}>fonction : {info.entry_fn}()</span>}
                    </div>
                    {headerLines.length > 0 && (
                      <div style={{ fontSize: 11.5, color: '#cbd5e1', lineHeight: 1.55, fontStyle: 'italic' }}>
                        {headerLines.map((l, i) => <div key={i}>· {l}</div>)}
                      </div>
                    )}
                  </div>
                );
              })()}
              <div style={{ flex: 1, minHeight: 0, display: 'grid', gridTemplateRows: 'minmax(0,1.2fr) minmax(0,1fr)', gap: 1, background: 'rgba(99,102,241,0.15)' }}>
                {/* Zone HAUT : logs en direct (la raison des prédictions) */}
                <div style={{ background: '#0a0f1c', padding: '12px 16px', overflow: 'auto', minHeight: 0, minWidth: 0 }}>
                  <div style={{ fontSize: 10, fontWeight: 800, color: '#a5b4fc', textTransform: 'uppercase', letterSpacing: 0.8, marginBottom: 8, position: 'sticky', top: 0, background: '#0a0f1c', paddingBottom: 6, display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
                    <span>🔴 Raison des prédictions · logs en direct</span>
                    <span style={{ color: '#64748b', fontWeight: 700 }}>{logs.length} ligne{logs.length > 1 ? 's' : ''}</span>
                  </div>
                  <div style={{ fontFamily: 'ui-monospace, monospace', fontSize: 11.5, lineHeight: 1.55 }}>
                    {logs.length === 0 ? (
                      <div style={{ color: '#475569', fontStyle: 'italic' }}>Aucun log capturé pour l'instant. Les <code>console.log()</code> de votre stratégie apparaîtront ici dès qu'une partie sera traitée.</div>
                    ) : logs.map((l, i) => (
                      <div key={i} style={{ color: l.level === 'error' ? '#f87171' : l.level === 'warn' ? '#fbbf24' : '#cbd5e1', whiteSpace: 'pre-wrap', wordBreak: 'break-word', marginBottom: 3 }}>
                        <span style={{ color: '#475569', marginRight: 6 }}>{new Date(l.ts).toLocaleTimeString('fr-FR')}</span>{l.msg}
                      </div>
                    ))}
                  </div>
                </div>
                {/* Zone BAS : règles de prédiction (code source) */}
                <div style={{ background: '#020617', padding: '12px 16px', overflow: 'auto', minHeight: 0, minWidth: 0 }}>
                  <div style={{ fontSize: 10, fontWeight: 800, color: '#fbbf24', textTransform: 'uppercase', letterSpacing: 0.8, marginBottom: 8, position: 'sticky', top: 0, background: '#020617', paddingBottom: 6 }}>
                    📄 Règles de prédiction · code source de la stratégie
                  </div>
                  <pre style={{ fontFamily: 'ui-monospace, monospace', fontSize: 11, lineHeight: 1.5, color: '#cbd5e1', margin: 0, whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
                    {source || '— code non chargé —'}
                  </pre>
                </div>
              </div>
            </div>
          </div>
        );
      })()}

    </div>
  );
}

function DeployLogsPanel() {
  const [logs, setLogs]       = React.useState([]);
  const [loading, setLoading] = React.useState(false);
  const [expanded, setExpanded] = React.useState(null);

  const load = async () => {
    setLoading(true);
    try {
      const r = await fetch('/api/admin/deploy-logs', { credentials: 'include' });
      const d = await r.json();
      if (d.ok) setLogs(d.logs || []);
    } catch {}
    finally { setLoading(false); }
  };

  React.useEffect(() => { load(); }, []);

  const statusColor = (s) => {
    if (!s) return '#94a3b8';
    if (s === 'success')  return '#4ade80';
    if (s === 'startup')  return '#60a5fa';
    if (s === 'installing' || s === 'started') return '#fbbf24';
    if (s === 'partial')  return '#f97316';
    if (s === 'error')    return '#f87171';
    return '#94a3b8';
  };
  const statusLabel = (s) => {
    if (!s) return '—';
    if (s === 'success')    return '✅ Succès';
    if (s === 'startup')    return '🔵 Démarrage';
    if (s === 'installing') return '⏳ En cours';
    if (s === 'started')    return '⏳ Démarré';
    if (s === 'partial')    return '⚠️ Partiel';
    if (s === 'error')      return '❌ Erreur';
    return s;
  };
  const sourceLabel = (s) => {
    if (s === 'render')         return '🖥️ Render (install)';
    if (s === 'render_startup') return '🚀 Render (démarrage)';
    if (s === 'manual')         return '🖱️ Manuel (Replit)';
    return s || '—';
  };
  const fmt = (iso) => {
    if (!iso) return '—';
    return new Date(iso).toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'medium' });
  };

  return (
    <div className="tg-admin-card" style={{ borderColor: 'rgba(59,130,246,0.3)', marginTop: 20 }}>
      <div className="tg-admin-header" style={{ marginBottom: 14 }}>
        <span className="tg-admin-icon">📋</span>
        <div style={{ flex: 1 }}>
          <div className="tg-admin-title">Journal des déploiements</div>
          <div className="tg-admin-subtitle">Trace de chaque installation et démarrage — Render.com + manuel</div>
        </div>
        <button onClick={load} disabled={loading} style={{ padding: '6px 14px', borderRadius: 8, border: '1px solid rgba(59,130,246,0.3)', background: 'rgba(59,130,246,0.1)', color: '#60a5fa', cursor: 'pointer', fontSize: 12, fontWeight: 600 }}>
          {loading ? '⏳' : '🔄 Actualiser'}
        </button>
      </div>

      {logs.length === 0 && !loading && (
        <div style={{ padding: '12px 16px', borderRadius: 9, background: 'rgba(100,116,139,0.08)', color: '#64748b', fontSize: 12, textAlign: 'center' }}>
          Aucun déploiement enregistré pour le moment.
        </div>
      )}

      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {logs.map((log) => (
          <div key={log.id} style={{ borderRadius: 12, border: `1px solid ${statusColor(log.status)}30`, background: 'rgba(15,23,42,0.6)', overflow: 'hidden' }}>
            {/* En-tête de la ligne */}
            <div
              onClick={() => setExpanded(expanded === log.id ? null : log.id)}
              style={{ display: 'grid', gridTemplateColumns: '1fr auto auto auto', gap: 10, alignItems: 'center', padding: '10px 14px', cursor: 'pointer' }}>
              <div>
                <div style={{ fontSize: 12, fontWeight: 700, color: '#e2e8f0' }}>{sourceLabel(log.source)}</div>
                <div style={{ fontSize: 10, color: '#64748b', marginTop: 2 }}>
                  {fmt(log.installed_at)}
                  {log.hostname && <span style={{ marginLeft: 8, opacity: 0.7 }}>@ {log.hostname}</span>}
                  {log.env && <span style={{ marginLeft: 6, opacity: 0.6 }}>({log.env})</span>}
                </div>
              </div>
              <div style={{ fontSize: 11, color: '#94a3b8', textAlign: 'right' }}>
                {log.files_written > 0 && <div>📄 {log.files_written} fichier(s)</div>}
                {log.files_errors  > 0 && <div style={{ color: '#f87171' }}>⚠️ {log.files_errors} erreur(s)</div>}
                {log.duration_ms > 0 && <div style={{ opacity: 0.6 }}>{(log.duration_ms / 1000).toFixed(1)}s</div>}
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 3, alignItems: 'flex-end' }}>
                <span style={{ fontSize: 11, fontWeight: 700, color: statusColor(log.status), whiteSpace: 'nowrap' }}>{statusLabel(log.status)}</span>
                {log.npm_install  && log.npm_install !== 'n/a' && log.npm_install !== 'skipped' && <span style={{ fontSize: 10, color: log.npm_install === 'success' ? '#4ade80' : '#f87171' }}>npm: {log.npm_install}</span>}
                {log.build_status && log.build_status !== 'n/a' && log.build_status !== 'skipped' && <span style={{ fontSize: 10, color: log.build_status === 'success' ? '#4ade80' : '#f87171' }}>build: {log.build_status}</span>}
              </div>
              <span style={{ fontSize: 10, color: '#475569' }}>{expanded === log.id ? '▲' : '▼'}</span>
            </div>

            {/* Détails dépliables */}
            {expanded === log.id && log.log_preview && (
              <div style={{ padding: '0 14px 12px', borderTop: '1px solid rgba(255,255,255,0.05)' }}>
                <div style={{ marginTop: 10, maxHeight: 200, overflowY: 'auto', background: '#0a0f1e', borderRadius: 8, padding: '10px 12px', fontSize: 10, fontFamily: 'monospace', color: '#4ade80', lineHeight: 1.8 }}>
                  {log.log_preview.split('\n').map((line, i) => (
                    <div key={i} style={{ color: line.startsWith('❌') ? '#f87171' : line.startsWith('---') ? '#fbbf24' : '#4ade80' }}>{line}</div>
                  ))}
                </div>
                {log.finished_at && (
                  <div style={{ marginTop: 6, fontSize: 10, color: '#475569' }}>
                    Terminé le : {fmt(log.finished_at)}
                  </div>
                )}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

function ProjectBackupPanel() {
  const [status, setStatus]       = React.useState(null);
  const [loading, setLoading]     = React.useState(false);
  const [diffing, setDiffing]     = React.useState(false);
  const [installing, setInstalling] = React.useState(false);
  const [fileList, setFileList]   = React.useState(null);
  const [log, setLog]             = React.useState([]);
  const [changedFiles, setChangedFiles] = React.useState(null);
  const [loadingList, setLoadingList] = React.useState(false);
  const [checkedAt, setCheckedAt] = React.useState(null);

  const loadList = async () => {
    setLoadingList(true);
    try {
      const r = await fetch('/api/admin/project-backup/list', { credentials: 'include' });
      const d = await r.json();
      if (r.ok) { setFileList(d); setCheckedAt(new Date()); }
      else setStatus({ error: d.error });
    } catch (e) { setStatus({ error: e.message }); }
    finally { setLoadingList(false); }
  };

  React.useEffect(() => { loadList(); }, []);

  const handleBackup = async () => {
    if (!confirm('Enregistrer tous les fichiers du projet dans la base de données ? Les fichiers existants seront remplacés.')) return;
    setLoading(true); setStatus(null); setLog([]); setChangedFiles(null);
    try {
      const r = await fetch('/api/admin/project-backup', { method: 'POST', credentials: 'include' });
      const d = await r.json();
      if (!r.ok) { setStatus({ error: d.error }); return; }
      setStatus({ success: `✅ ${d.saved} fichier(s) enregistré(s) dans la base de données${d.errors > 0 ? ` (${d.errors} erreur(s))` : ''}.` });
      await loadList();
    } catch (e) { setStatus({ error: e.message }); }
    finally { setLoading(false); }
  };

  const handleDiff = async () => {
    setDiffing(true); setStatus(null); setLog([]); setChangedFiles(null);
    try {
      const r = await fetch('/api/admin/project-backup/diff', { method: 'POST', credentials: 'include' });
      const d = await r.json();
      if (!r.ok) { setStatus({ error: d.error }); return; }
      if (d.saved === 0) {
        setStatus({ success: `✅ Aucun fichier modifié — base de données déjà à jour (${d.skipped} fichier(s) inchangé(s)).` });
      } else {
        setStatus({ success: `✅ ${d.saved} fichier(s) modifié(s) mis à jour${d.added > 0 ? ` dont ${d.added} nouveau(x)` : ''}${d.skipped > 0 ? ` · ${d.skipped} inchangé(s) ignoré(s)` : ''}${d.errors > 0 ? ` · ${d.errors} erreur(s)` : ''}.` });
        setChangedFiles(d.changed || []);
      }
      await loadList();
    } catch (e) { setStatus({ error: e.message }); }
    finally { setDiffing(false); }
  };

  const handleClear = async () => {
    if (!confirm('Supprimer TOUS les fichiers sauvegardés de la base de données ?')) return;
    try {
      const r = await fetch('/api/admin/project-backup', { method: 'DELETE', credentials: 'include' });
      const d = await r.json();
      if (r.ok) { setStatus({ success: `🗑 ${d.deleted} fichier(s) supprimé(s).` }); setFileList(null); }
      else setStatus({ error: d.error });
    } catch (e) { setStatus({ error: e.message }); }
  };

  const handleInstall = async () => {
    if (!confirm('⚠️ INSTALLER L\'APPLICATION ?\n\nTous les fichiers sauvegardés dans la base de données vont écraser les fichiers actuels sur le serveur, puis l\'application va redémarrer automatiquement.')) return;
    setInstalling(true); setStatus(null); setLog([]);
    try {
      const r = await fetch('/api/admin/project-install', { method: 'POST', credentials: 'include' });
      const d = await r.json();
      if (!r.ok) { setStatus({ error: d.error }); setInstalling(false); return; }
      setLog(d.log || []);
      setStatus({ success: `✅ ${d.written} fichier(s) installé(s)${d.errors > 0 ? ` (${d.errors} erreur(s))` : ''}. Le serveur redémarre…` });
      setTimeout(() => setInstalling(false), 4000);
    } catch (e) { setStatus({ error: e.message }); setInstalling(false); }
  };

  const fmtSize = (b) => {
    if (!b) return '—';
    if (b < 1024) return `${b} o`;
    if (b < 1024 * 1024) return `${(b / 1024).toFixed(1)} Ko`;
    return `${(b / (1024 * 1024)).toFixed(2)} Mo`;
  };

  const totalSize = fileList?.files?.reduce((s, f) => s + (f.size_bytes || 0), 0) || 0;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      {/* En-tête */}
      <div className="tg-admin-card" style={{ borderColor: 'rgba(34,197,94,0.4)' }}>
        <div className="tg-admin-header">
          <span className="tg-admin-icon">💾</span>
          <div>
            <div className="tg-admin-title">Mise à jour par base de données</div>
            <div className="tg-admin-subtitle">Enregistrez tous les fichiers du projet dans la DB · Installez-les sur n'importe quel serveur en un clic</div>
          </div>
        </div>

        {/* Statut */}
        {status && (
          <div style={{ padding: '12px 16px', borderRadius: 10, marginBottom: 16,
            background: status.error ? 'rgba(239,68,68,0.12)' : 'rgba(34,197,94,0.12)',
            border: `1px solid ${status.error ? 'rgba(239,68,68,0.35)' : 'rgba(34,197,94,0.35)'}`,
            color: status.error ? '#f87171' : '#4ade80', fontSize: 13, fontWeight: 600,
          }}>
            {status.error || status.success}
          </div>
        )}

        {/* Résumé de la sauvegarde actuelle */}
        <div style={{ padding: '14px 16px', borderRadius: 12, background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.06)', marginBottom: 20 }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12 }}>
            <div>
              <div style={{ fontSize: 13, color: '#94a3b8', marginBottom: 4 }}>Fichiers en base de données</div>
              {loadingList ? (
                <div style={{ fontSize: 22, fontWeight: 800, color: '#64748b' }}>…</div>
              ) : fileList ? (
                <div style={{ display: 'flex', alignItems: 'baseline', gap: 10 }}>
                  <span style={{ fontSize: 28, fontWeight: 800, color: '#22c55e' }}>{fileList.total}</span>
                  <span style={{ fontSize: 13, color: '#64748b' }}>fichiers · {fmtSize(totalSize)}</span>
                </div>
              ) : (
                <div style={{ fontSize: 14, color: '#64748b' }}>Aucun fichier sauvegardé</div>
              )}
              {fileList?.last_saved && (
                <div style={{ marginTop: 8, padding: '8px 12px', borderRadius: 8, background: 'rgba(34,197,94,0.07)', border: '1px solid rgba(34,197,94,0.18)' }}>
                  <div style={{ fontSize: 10, color: '#4ade80', fontWeight: 700, letterSpacing: 1, textTransform: 'uppercase', marginBottom: 2 }}>
                    Dernière sauvegarde en base
                  </div>
                  <div style={{ fontSize: 15, fontWeight: 800, color: '#22c55e' }}>
                    {new Date(fileList.last_saved).toLocaleString('fr-FR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit' })}
                  </div>
                </div>
              )}
              {checkedAt && (
                <div style={{ fontSize: 10, color: '#334155', marginTop: 6 }}>
                  Vérifié à {checkedAt.toLocaleTimeString('fr-FR')}
                </div>
              )}
            </div>
            <button onClick={loadList} disabled={loadingList}
              style={{ padding: '7px 16px', borderRadius: 8, border: '1px solid rgba(255,255,255,0.1)', background: 'rgba(255,255,255,0.04)', color: '#94a3b8', fontSize: 12, cursor: 'pointer', minWidth: 110 }}>
              {loadingList ? '⏳ …' : '🔄 Actualiser'}
            </button>
          </div>
        </div>

        {/* Boutons principaux */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14, marginBottom: 14 }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <button
              onClick={handleBackup}
              disabled={loading || installing || diffing}
              style={{ padding: '14px 20px', borderRadius: 14, border: 'none', cursor: loading ? 'not-allowed' : 'pointer', fontWeight: 800, fontSize: 13,
                background: loading ? 'rgba(34,197,94,0.15)' : 'linear-gradient(135deg,#16a34a,#22c55e)',
                color: loading ? '#4ade80' : '#fff', opacity: loading ? 0.7 : 1, transition: 'all 0.2s',
                display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, flexDirection: 'column',
              }}>
              <span style={{ fontSize: 22 }}>{loading ? '⏳' : '📤'}</span>
              <span>{loading ? 'Enregistrement…' : 'Enregistrer les fichiers'}</span>
              <span style={{ fontSize: 10, fontWeight: 400, opacity: 0.85 }}>Tous les fichiers → Base</span>
            </button>
            <button
              onClick={handleDiff}
              disabled={loading || installing || diffing}
              style={{ padding: '10px 20px', borderRadius: 12, border: '2px solid rgba(34,197,94,0.4)', cursor: diffing ? 'not-allowed' : 'pointer', fontWeight: 700, fontSize: 12,
                background: diffing ? 'rgba(34,197,94,0.08)' : 'rgba(34,197,94,0.1)',
                color: diffing ? '#4ade80' : '#22c55e', opacity: diffing ? 0.7 : 1, transition: 'all 0.2s',
                display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
              }}>
              <span>{diffing ? '⏳' : '🔄'}</span>
              <span>{diffing ? 'Analyse en cours…' : 'Modifiés uniquement'}</span>
            </button>
          </div>

          <button
            onClick={handleInstall}
            disabled={loading || installing || !fileList?.total}
            style={{ padding: '18px 20px', borderRadius: 14, border: 'none', cursor: (installing || !fileList?.total) ? 'not-allowed' : 'pointer', fontWeight: 800, fontSize: 14,
              background: installing ? 'rgba(59,130,246,0.15)' : !fileList?.total ? 'rgba(100,116,139,0.15)' : 'linear-gradient(135deg,#1d4ed8,#3b82f6)',
              color: installing ? '#93c5fd' : !fileList?.total ? '#475569' : '#fff', opacity: (installing || !fileList?.total) ? 0.7 : 1, transition: 'all 0.2s',
              display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10, flexDirection: 'column',
            }}>
            <span style={{ fontSize: 28 }}>{installing ? '⏳' : '📥'}</span>
            <span>{installing ? 'Installation…' : 'Installer l\'application'}</span>
            <span style={{ fontSize: 11, fontWeight: 400, opacity: 0.85 }}>Base de données → Serveur</span>
          </button>
        </div>

        {/* Bouton téléchargement ZIP de déploiement Render.com (léger, < 5 Mo) */}
        <a
          href="/api/admin/project-backup/zip-render"
          download
          title="Pack prêt à déployer sur Render.com — sources serveur + dist/ + render.yaml + DEPLOY.md"
          style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10,
            padding: '10px 20px', borderRadius: 12, textDecoration: 'none', fontWeight: 700, fontSize: 12,
            background: 'rgba(168,85,247,0.1)', border: '2px solid rgba(168,85,247,0.35)', color: '#c084fc',
            transition: 'all 0.2s', marginBottom: 4,
          }}>
          <span>📦</span>
          <span>ZIP déploiement Render.com</span>
          <span style={{ fontSize: 10, fontWeight: 400, opacity: 0.7, marginLeft: 4 }}>léger, prêt à uploader</span>
        </a>

        {/* Bouton téléchargement ZIP différentiel (fichiers modifiés depuis les nouveaux modes) */}
        <a
          href="/api/admin/project-backup/zip-diff"
          download
          title="Contient uniquement les fichiers modifiés depuis le dernier commit de référence"
          style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10,
            padding: '10px 20px', borderRadius: 12, textDecoration: 'none', fontWeight: 700, fontSize: 12,
            background: 'rgba(34,197,94,0.08)', border: '2px solid rgba(34,197,94,0.3)', color: '#4ade80',
            transition: 'all 0.2s', marginBottom: 4,
          }}>
          <span>🔄</span>
          <span>ZIP mise à jour différentielle</span>
          <span style={{ fontSize: 10, fontWeight: 400, opacity: 0.7, marginLeft: 4 }}>fichiers modifiés uniquement</span>
        </a>

        {!fileList?.total && (
          <div style={{ padding: '10px 14px', borderRadius: 9, background: 'rgba(234,179,8,0.08)', border: '1px solid rgba(234,179,8,0.2)', color: '#fbbf24', fontSize: 12, textAlign: 'center' }}>
            ℹ️ Aucun fichier en DB — cliquez sur "Enregistrer les fichiers" d'abord
          </div>
        )}

        {/* Liste des fichiers modifiés lors du dernier diff */}
        {changedFiles && changedFiles.length > 0 && (
          <div style={{ marginTop: 14, padding: '12px 16px', borderRadius: 12, background: 'rgba(34,197,94,0.06)', border: '1px solid rgba(34,197,94,0.2)' }}>
            <div style={{ fontSize: 11, color: '#4ade80', fontWeight: 700, textTransform: 'uppercase', letterSpacing: 1, marginBottom: 8 }}>
              🔄 Fichiers mis à jour ({changedFiles.length})
            </div>
            <div style={{ maxHeight: 160, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 3 }}>
              {changedFiles.map((f, i) => (
                <div key={i} style={{ fontSize: 11, color: '#86efac', fontFamily: 'monospace', lineHeight: 1.6 }}>
                  ✅ {f}
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Log d'installation */}
        {log.length > 0 && (
          <div style={{ marginTop: 16 }}>
            <div style={{ fontSize: 11, color: '#475569', fontWeight: 700, textTransform: 'uppercase', letterSpacing: 1, marginBottom: 8 }}>Journal d'installation</div>
            <div style={{ maxHeight: 220, overflowY: 'auto', background: '#0a0f1e', borderRadius: 10, padding: 14, border: '1px solid rgba(255,255,255,0.06)' }}>
              {log.map((line, i) => (
                <div key={i} style={{ fontSize: 11, color: line.startsWith('❌') ? '#f87171' : '#4ade80', fontFamily: 'monospace', lineHeight: 1.7 }}>{line}</div>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Liste des fichiers sauvegardés */}
      {fileList?.files?.length > 0 && (
        <div className="tg-admin-card" style={{ borderColor: 'rgba(99,102,241,0.3)' }}>
          <div className="tg-admin-header" style={{ marginBottom: 14 }}>
            <span className="tg-admin-icon">📂</span>
            <div>
              <div className="tg-admin-title">Fichiers sauvegardés ({fileList.total})</div>
              <div className="tg-admin-subtitle">Liste de tous les fichiers actuellement stockés dans la base de données</div>
            </div>
            <button onClick={handleClear}
              style={{ marginLeft: 'auto', padding: '6px 14px', borderRadius: 8, border: '1px solid rgba(239,68,68,0.35)', background: 'rgba(239,68,68,0.08)', color: '#f87171', fontSize: 12, cursor: 'pointer', fontWeight: 600 }}>
              🗑 Vider
            </button>
          </div>
          <div style={{ maxHeight: 400, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 4 }}>
            {fileList.files.map((f, i) => (
              <div key={i} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '8px 12px', borderRadius: 8, background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.04)', gap: 8 }}>
                <span style={{ fontSize: 12, fontFamily: 'monospace', color: '#a5b4fc', flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{f.file_path}</span>
                <span style={{ fontSize: 11, color: '#475569', whiteSpace: 'nowrap' }}>{fmtSize(f.size_bytes)}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

export default function Admin() {
  return <AdminErrorBoundary><AdminPanel /></AdminErrorBoundary>;
}

function AdminPanel() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const isSuperAdmin = user?.admin_level === 1 || user?.username === 'buzzinfluence';
  const canSeeSystem = user?.admin_level === 1 || user?.username === 'buzzinfluence';
  const isProOnly = !user?.is_admin && !!user?.is_pro;

  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState('');

  const PRO_ALLOWED_TABS = ['config-pro', 'canaux', 'strategies', 'bilan', 'config', 'tg-direct'];
  const [adminTab, setAdminTab] = useState(isProOnly ? 'config-pro' : 'utilisateurs');
  useEffect(() => {
    if (isProOnly && !PRO_ALLOWED_TABS.includes(adminTab)) setAdminTab('config-pro');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isProOnly]);

  // Duration inputs per user: { userId: { val, unit } }
  const [durInputs, setDurInputs] = useState({});

  // ── Paiements en attente ───────────────────────────────────────────
  const [pendingPayments, setPendingPayments] = useState([]);
  const [paymentScreenshot, setPaymentScreenshot] = useState(null); // { id, image, ai }
  const [paymentBusy, setPaymentBusy] = useState(null);

  const loadPendingPayments = useCallback(async () => {
    try {
      const r = await fetch('/api/payments/admin/pending', { credentials: 'include' });
      if (r.ok) setPendingPayments(await r.json());
    } catch {}
  }, []);

  useEffect(() => {
    loadPendingPayments();
    const i = setInterval(loadPendingPayments, 30000);
    return () => clearInterval(i);
  }, [loadPendingPayments]);

  const viewPaymentScreenshot = async (id) => {
    try {
      const r = await fetch(`/api/payments/admin/${id}/screenshot`, { credentials: 'include' });
      if (r.ok) {
        const d = await r.json();
        setPaymentScreenshot({ id, image: d.image_base64, ai: d.ai_analysis });
      }
    } catch {}
  };

  const approvePayment = async (id) => {
    if (!confirm(`Approuver ce paiement et activer l'abonnement de l'utilisateur ?`)) return;
    setPaymentBusy(id);
    try {
      const r = await fetch(`/api/payments/admin/${id}/approve`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({}),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || 'Erreur');
      alert('✅ ' + d.message + (d.referrer_bonus_minutes ? `\n🎁 Parrain crédité de ${d.referrer_bonus_minutes} min.` : ''));
      loadPendingPayments();
      setPaymentScreenshot(null);
    } catch (e) { alert('Erreur : ' + e.message); }
    finally { setPaymentBusy(null); }
  };

  const rejectPayment = async (id) => {
    const note = prompt('Raison du rejet (optionnel) :', '');
    if (note === null) return;
    setPaymentBusy(id);
    try {
      const r = await fetch(`/api/payments/admin/${id}/reject`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ note }),
      });
      if (!r.ok) throw new Error('Erreur');
      loadPendingPayments();
      setPaymentScreenshot(null);
    } catch (e) { alert('Erreur : ' + e.message); }
    finally { setPaymentBusy(null); }
  };

  // Inline name editing
  const [nameEdit, setNameEdit] = useState({}); // { userId: { first_name, last_name } }

  // Visibility modal (canaux Telegram + stratégies)
  const [visModal, setVisModal] = useState(null); // { userId, username }
  const [expandedUserId, setExpandedUserId] = useState(null); // ID de l'utilisateur dont la liste de canaux est dépliée
  const [savingVis, setSavingVis] = useState(false);
  const [visCounts, setVisCounts] = useState({}); // { userId: nombreTotalCanaux+strats }
  const [savedFlash, setSavedFlash] = useState(null); // userId pour lequel afficher le bandeau "✅ Enregistré"
  const [visData, setVisData] = useState({}); // { userId: Set<dbId> } for channels
  const [visStratData, setVisStratData] = useState({}); // { userId: Set<stratId> } for strategies
  const [visLoading, setVisLoading] = useState(false);
  const [visInitializedIds, setVisInitializedIds] = useState(new Set()); // IDs dont les données sont chargées

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
  const [maxRattrapage, setMaxRattrapage]   = useState(20);
  const [relanceStatus, setRelanceStatus]   = useState({});
  const [maxRSaving, setMaxRSaving] = useState(false);

  // Bot admin Telegram ID (commandes bot distantes)
  const [botAdminTgId, setBotAdminTgId]     = useState('');
  const [botAdminTgSaving, setBotAdminTgSaving] = useState(false);
  const [botAdminTgMsg, setBotAdminTgMsg]   = useState('');

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
    if (!confirm(`Générer ${premiumCount} compte(s) premium ? Les ${premiumCount} derniers comptes générés seront automatiquement supprimés.`)) return;
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
    { value: '',   label: '— Global (paramètre général) —' },
    { value: '9',  label: 'Joueur dédié' },
    { value: '10', label: 'Banquier dédié' },
    { value: '8',  label: 'Banquier / Joueur Pro' },
    { value: '1',  label: 'Style Russe' },
    { value: '2',  label: 'Premium' },
    { value: '3',  label: 'Baccara Pro' },
    { value: '4',  label: 'Prédiction' },
    { value: '5',  label: 'Barre de progression' },
    { value: '6',  label: 'Classique' },
    { value: '7',  label: 'Joueur Carte' },
    { value: '11', label: '📊 Distribution' },
    { value: '12', label: '🃏 Cartes 2/3 Standard' },
    { value: '13', label: '🏆 Victoire Pro (Banquier/Joueur)' },
    { value: '14', label: '🏆 Victoire Compact' },
    { value: '15', label: '🤝 Match Nul Pro' },
    { value: '16', label: '🤝 Match Nul Compact' },
    { value: '17', label: '⚡ 2+3 Cartes Pro' },
    { value: '18', label: '🃏 Cartes 2/3 Style B' },
  ];

  // stratType: 'simple' = prédiction locale seulement; 'telegram' = envoie vers canal TG custom
  const BLANK_FORM = { name: '', threshold: 5, mode: 'manquants', mappings: { '♠':['♥'],'♥':['♠'],'♦':['♣'],'♣':['♦'] }, visibility: 'admin', enabled: true, tg_targets: [], stratType: 'simple', exceptions: [], prediction_offset: 1, hand: 'joueur', max_rattrapage: 20, tg_format: null, mirror_pairs: [], trigger_on: null, trigger_strategy_id: '', trigger_count: 2, trigger_level: 3, relance_enabled: false, relance_pertes: 3, relance_types: [], relance_nombre: 1, strategy_type: 'simple', multi_source_ids: [], multi_require: 'any', loss_type: 'rattrapage', relance_rules: [],
    // Mode lecture_passee (lecture de jeux passés depuis cartes_jeu)
    carte_p: 2, carte_h: 32, carte_ecart: 1, carte_position: 1, carte_source_hand: 'joueur',
    // Mode intelligent_cartes (analyse de patterns dans cartes_jeu)
    intelligent_window: 300, intelligent_pattern: 3, intelligent_min_count: 3, intelligent_categories: ['suit'],
  };

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
  const [proStrategies, setProStrategies] = useState([]); // stratégies Pro chargées (S5001+)

  // ── Panneau effacement données d'une stratégie ─────────────────────────────
  const [clearStratId, setClearStratId] = useState('');
  const [clearStratBusy, setClearStratBusy] = useState(false);
  const [clearStratMsg, setClearStratMsg] = useState(null); // { ok, text }

  // ── Stratégies Pro (S5001-S5100) — onglet Telegram admin ─────────────
  const [proStratsTg, setProStratsTg]   = useState([]); // [{id, owner_username, strategy_name, tg_targets:[]}, ...]
  const [proStratsTgLoading, setProStratsTgLoading] = useState(false);
  const [proStratTgForm, setProStratTgForm] = useState({}); // { [proId]: { bot_token, channel_id, tg_format } }
  const [proStratTgSaving, setProStratTgSaving] = useState({}); // { [proId]: bool }
  const [proStratTgOpen, setProStratTgOpen] = useState(null);   // id de stratégie Pro ouverte pour édition
  const [stratForm, setStratForm] = useState(BLANK_FORM); // current create/edit form
  const [stratEditing, setStratEditing] = useState(null); // id being edited, null = creating
  const [stratMsg, setStratMsg] = useState('');
  const [successModal, setSuccessModal] = useState(null);
  const [proSavedModal, setProSavedModal] = useState(null); // { type:'create'|'update', id, filename, strategy_name, hand, decalage, max_rattrapage, engine_type, warnings, engine_error }
  const [proErrorModal, setProErrorModal] = useState(null); // { title, message, errors:[{type,line,message}], warnings:[] }
  const [stratSaving, setStratSaving] = useState(false);
  const [stratOpen, setStratOpen] = useState(false); // form panel open?
  const [mirrorCountsData, setMirrorCountsData] = useState({}); // { [stratId]: { counts, threshold } }

  // Réponses admin aux messages utilisateurs
  const [replyingId, setReplyingId]     = useState(null);
  const [replyText, setReplyText]       = useState('');
  const [replySending, setReplySending] = useState(false);

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

  // ── Diffusion live des jeux (Telegram multi-canaux) ──
  const [lbTargets, setLbTargets]             = useState([]);
  const [lbLoading, setLbLoading]             = useState(false);
  const [lbMsg, setLbMsg]                     = useState('');
  const [lbForm, setLbForm]                   = useState({ bot_token: '', channel_id: '', label: '' });
  const [lbSaving, setLbSaving]               = useState(false);

  const loadLbTargets = async () => {
    setLbLoading(true);
    try {
      const r = await fetch('/api/admin/live-broadcast/targets', { credentials: 'include' });
      const d = await r.json();
      setLbTargets(Array.isArray(d.targets) ? d.targets : []);
    } catch (e) { setLbMsg('❌ ' + e.message); }
    finally { setLbLoading(false); }
  };

  const addLbTarget = async () => {
    if (!lbForm.bot_token.trim() || !lbForm.channel_id.trim()) {
      setLbMsg('❌ Token et ID canal requis'); return;
    }
    setLbSaving(true); setLbMsg('');
    try {
      const r = await fetch('/api/admin/live-broadcast/targets', {
        method: 'POST', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(lbForm),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || 'Erreur');
      setLbForm({ bot_token: '', channel_id: '', label: '' });
      setLbMsg('✅ Cible ajoutée');
      loadLbTargets();
    } catch (e) { setLbMsg('❌ ' + e.message); }
    finally { setLbSaving(false); }
  };

  const deleteLbTarget = async (id) => {
    if (!confirm('Supprimer cette cible de diffusion live ?')) return;
    try {
      const r = await fetch(`/api/admin/live-broadcast/targets/${id}`, { method: 'DELETE', credentials: 'include' });
      if (!r.ok) { const d = await r.json().catch(()=>({})); throw new Error(d.error || 'Erreur'); }
      loadLbTargets();
    } catch (e) { setLbMsg('❌ ' + e.message); }
  };

  const toggleLbTarget = async (id, enabled) => {
    try {
      const r = await fetch(`/api/admin/live-broadcast/targets/${id}`, {
        method: 'PATCH', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled }),
      });
      if (!r.ok) { const d = await r.json().catch(()=>({})); throw new Error(d.error || 'Erreur'); }
      loadLbTargets();
    } catch (e) { setLbMsg('❌ ' + e.message); }
  };

  const testLbTarget = async (id) => {
    setLbMsg('⏳ Envoi du test…');
    try {
      const r = await fetch(`/api/admin/live-broadcast/targets/${id}/test`, { method: 'POST', credentials: 'include' });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || 'Erreur');
      setLbMsg('✅ Message test envoyé (id ' + d.message_id + ')');
    } catch (e) { setLbMsg('❌ ' + e.message); }
  };

  useEffect(() => { if (adminTab === 'canaux') loadLbTargets(); }, [adminTab]);

  // Hébergement Bots
  const [hostedBots, setHostedBots]           = useState([]);
  const [botMsg, setBotMsg]                   = useState('');
  const [botLoading, setBotLoading]           = useState(false);
  const [botLogId, setBotLogId]               = useState(null);
  const [botLogs, setBotLogs]                 = useState([]);
  const [newBot, setNewBot]                   = useState({ name: '', language: 'python', token: '', channel_id: '' });
  const [newBotFile, setNewBotFile]           = useState(null); // { name, base64 }
  const [newBotZipB64, setNewBotZipB64]       = useState('');
  const [botSaving, setBotSaving]             = useState(false);

  // ── Config IA ──────────────────────────────────────────────────────
  const [aiProviders,    setAiProviders]      = useState([]);
  const [aiConfigData,   setAiConfigData]     = useState({ provider: null, hasKey: false });
  const [visionKeyData,  setVisionKeyData]    = useState({ hasKey: false });
  const [visionKeyInput, setVisionKeyInput]   = useState('');
  const [visionKeySaving, setVisionKeySaving] = useState(false);
  const [visionKeyMsg,   setVisionKeyMsg]     = useState('');
  const [aiSelectedProv, setAiSelectedProv]   = useState('groq');
  const [aiApiKey,       setAiApiKey]         = useState('');
  const [aiSaving,       setAiSaving]         = useState(false);
  const [aiMsg,          setAiMsg]            = useState('');
  const [aiTestResult,   setAiTestResult]     = useState(null);
  const [aiTesting,      setAiTesting]        = useState(false);
  const [aiRepairResult,  setAiRepairResult]  = useState(null);
  const [aiRepairing,     setAiRepairing]     = useState(false);
  const [aiSmartRepairing,setAiSmartRepairing]= useState(false);
  const [aiApplyLog,      setAiApplyLog]      = useState([]);
  const [aiBotPrecheck,  setAiBotPrecheck]    = useState(null);
  const [aiBotChecking,  setAiBotChecking]    = useState(false);

  // Utilisateurs en ligne
  const [onlineUsers, setOnlineUsers]           = useState([]);
  const [onlineLoading, setOnlineLoading]       = useState(false);
  const [onlineRefresh, setOnlineRefresh]       = useState(0);
  const [editingAllowedModes, setEditingAllowedModes] = useState(null); // userId
  const [allowedModesEdit, setAllowedModesEdit] = useState([]); // array of modes
  const [allowedModesSaving, setAllowedModesSaving] = useState(false);
  const [editingAllowedChannels, setEditingAllowedChannels] = useState(null);
  const [allowedChannelsEdit, setAllowedChannelsEdit] = useState([]);
  const [allowedChannelsSaving, setAllowedChannelsSaving] = useState(false);
  const [editingCounterChannels, setEditingCounterChannels] = useState(null);
  const [counterChannelsEdit, setCounterChannelsEdit] = useState([]);
  const [counterChannelsSaving, setCounterChannelsSaving] = useState(false);

  const ALL_MODES_LIST = [
    { value: 'manquants', label: 'Absences' },
    { value: 'apparents', label: 'Apparitions' },
    { value: 'absence_apparition', label: 'Absence → Apparition' },
    { value: 'apparition_absence', label: 'Apparition → Absence' },
    { value: 'taux_miroir', label: 'Taux Miroir' },
    { value: 'compteur_adverse', label: 'Compteur Adverse' },
    { value: 'victoire_adverse', label: 'Victoire Adverse' },
    { value: 'multi_strategy', label: 'Multi-stratégie' },
    { value: 'relance', label: 'Relance' },
    { value: 'distribution', label: 'Distribution' },
    { value: 'carte_3_vers_2', label: '3 cartes → 2 cartes' },
    { value: 'carte_2_vers_3', label: '2 cartes → 3 cartes' },
    { value: 'abs_3_vers_2', label: '3→2 Absence' },
    { value: 'abs_3_vers_3', label: '3→3 Absence' },
    { value: 'absence_victoire', label: 'Absence Victoire' },
    { value: 'lecture_passee', label: '📖 Lecture jeux passés' },
    { value: 'intelligent_cartes', label: '🧠 Intelligent Cartes' },
    { value: 'union_enseignes', label: '🔗 Union Enseignes' },
    { value: 'carte_valeur', label: '🃏 Carte Valeur' },
  ];

  useEffect(() => {
    if (adminTab !== 'online-users') return;
    setOnlineLoading(true);
    fetch('/api/admin/online-users', { credentials: 'include' })
      .then(r => r.ok ? r.json() : [])
      .then(d => { setOnlineUsers(d); setOnlineLoading(false); })
      .catch(() => setOnlineLoading(false));
  }, [adminTab, onlineRefresh]);

  const saveAllowedModes = async (userId) => {
    setAllowedModesSaving(true);
    try {
      const r = await fetch(`/api/admin/users/${userId}/allowed-modes`, {
        method: 'PUT', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ allowed_modes: allowedModesEdit.length > 0 ? allowedModesEdit : null }),
      });
      if (r.ok) {
        setOnlineUsers(prev => prev.map(u => u.id === userId ? { ...u, allowed_modes: allowedModesEdit.length > 0 ? allowedModesEdit : null } : u));
        setEditingAllowedModes(null);
      }
    } finally { setAllowedModesSaving(false); }
  };

  const saveAllowedChannels = async (userId) => {
    setAllowedChannelsSaving(true);
    try {
      const r = await fetch(`/api/admin/users/${userId}/allowed-channels`, {
        method: 'PUT', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ allowed_channels: allowedChannelsEdit.length > 0 ? allowedChannelsEdit : null }),
      });
      if (r.ok) {
        setOnlineUsers(prev => prev.map(u => u.id === userId ? { ...u, allowed_channels: allowedChannelsEdit.length > 0 ? allowedChannelsEdit : null } : u));
        setEditingAllowedChannels(null);
      }
    } finally { setAllowedChannelsSaving(false); }
  };

  const saveCounterChannels = async (userId) => {
    setCounterChannelsSaving(true);
    try {
      const r = await fetch(`/api/admin/users/${userId}/show-counter-channels`, {
        method: 'PUT', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ show_counter_channels: counterChannelsEdit.length > 0 ? counterChannelsEdit : null }),
      });
      if (r.ok) {
        setOnlineUsers(prev => prev.map(u => u.id === userId ? { ...u, show_counter_channels: counterChannelsEdit.length > 0 ? counterChannelsEdit : null } : u));
        setEditingCounterChannels(null);
      }
    } finally { setCounterChannelsSaving(false); }
  };

  const unbanUser = async (userId) => {
    if (!confirm('Débannir cet utilisateur ?')) return;
    try {
      const r = await fetch(`/api/admin/users/${userId}/unban`, { method: 'POST', credentials: 'include' });
      if (r.ok) {
        setOnlineUsers(prev => prev.map(u => u.id === userId ? { ...u, is_banned: false } : u));
        setUsers(prev => prev.map(u => u.id === userId ? { ...u, is_banned: false } : u));
      }
    } catch {}
  };

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
  // Fichiers de mise à jour stockés sur le serveur
  const [serverUpdateFiles, setServerUpdateFiles]   = useState([]);
  const [serverFilesLoading, setServerFilesLoading] = useState(false);
  const [serverApplyingFile, setServerApplyingFile] = useState(null);
  const [serverUpdateResult, setServerUpdateResult] = useState(null);
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
  const [aleatPanel, setAleatPanel]       = useState(null); // { stratId, stratName, step:'hand'|'number'|'result', hand, gameInput, result, history }
  const [stratChForm, setStratChForm]     = useState({ bot_token: '', channel_id: '', tg_format: null });
  const [tgSaveModal, setTgSaveModal]     = useState(null); // modal de confirmation post-save
  const [stratChSaving, setStratChSaving] = useState(false);

  // Sous-formulaire d'annonce planifiée (par canal : C1/C2/C3/DC ou stratID)
  const ANN_SUB_BLANK = { open: false, text: '', schedule_type: 'interval', interval_hours: 1, times_input: '', media_type: '', media_url: '' };
  const [annSubForms, setAnnSubForms] = useState({});
  const getAnnSub = (key) => annSubForms[key] || ANN_SUB_BLANK;
  const setAnnSub = (key, patch) => setAnnSubForms(p => ({ ...p, [key]: { ...(p[key] || ANN_SUB_BLANK), ...patch } }));

  const [stratStats,     setStratStats]     = useState([]); // wins/losses per strategy

  // ── Annonces planifiées Telegram ─────────────────────────────────
  const ANN_BLANK = {
    name: '', bot_token: '', channel_id: '', text: '',
    media_type: '', media_url: '', media_data: '', media_filename: '',
    schedule_type: 'interval', interval_hours: 1, times_input: ''
  };
  const annFormRef = useRef(null);
  const [annExpandedId, setAnnExpandedId] = useState(null); // affichage texte complet
  const [announcements,    setAnnouncements]    = useState([]);
  const [annForm,          setAnnForm]          = useState(ANN_BLANK);
  const [annSaving,        setAnnSaving]        = useState(false);
  const [annMsg,           setAnnMsg]           = useState('');
  const [annOpen,          setAnnOpen]          = useState(false);
  const [annSendingId,     setAnnSendingId]     = useState(null);
  const [annEditingId,     setAnnEditingId]     = useState(null);
  const [annUploading,     setAnnUploading]     = useState(false);

  // Quand on entre en mode édition d'une annonce, on s'assure que le formulaire
  // s'ouvre et défile dans la vue APRÈS le rendu (plus fiable que setTimeout).
  useEffect(() => {
    if (annEditingId !== null && annOpen) {
      const id = requestAnimationFrame(() => {
        if (annFormRef.current) {
          annFormRef.current.scrollIntoView({ behavior: 'smooth', block: 'start' });
        }
      });
      return () => cancelAnimationFrame(id);
    }
  }, [annEditingId, annOpen]);

  const saveStratTg = async (id) => {
    setStratChSaving(true);
    try {
      const strat = strategies.find(s => s.id === id);
      if (!strat) throw new Error('Stratégie introuvable');
      const existing = Array.isArray(strat.tg_targets)
        ? strat.tg_targets.filter(t => t.channel_id !== stratChForm.channel_id) : [];
      const newTarget = stratChForm.bot_token.trim() && stratChForm.channel_id.trim()
        ? {
            bot_token: stratChForm.bot_token.trim(),
            channel_id: stratChForm.channel_id.trim(),
            tg_format: stratChForm.tg_format ? parseInt(stratChForm.tg_format) : null,
          }
        : null;
      const tg_targets = newTarget ? [...existing, newTarget] : existing;
      const r = await fetch(`/api/admin/strategies/${id}`, {
        method: 'PUT', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...strat, tg_targets }),
      });
      if (!r.ok) { const d = await r.json(); throw new Error(d.error || 'Erreur'); }
      // Afficher la modale de confirmation
      const fmtObj = TG_FORMATS.find(f => String(f.value) === String(stratChForm.tg_format ?? ''));
      const st = stratStats.find(x => x.strategy === `S${id}`) || {};
      const MODE_LABELS = { manquants:'Absences', apparents:'Apparitions', absence_apparition:'Absence → Apparition', apparition_absence:'Apparition → Absence', taux_miroir:'Taux miroir', multi_strategy:'Multi-stratégie', relance:'Relance', distribution:'Distribution', carte_3_vers_2:'3 cartes → 2 cartes', carte_2_vers_3:'2 cartes → 3 cartes', compteur_adverse:'Compteur Adverse', victoire_adverse:'Victoire Adverse', abs_3_vers_2:'3→2 Absence', abs_3_vers_3:'3→3 Absence', absence_victoire:'Absence Victoire', lecture_passee:'📖 Lecture jeux passés', intelligent_cartes:'🧠 Intelligent Cartes', union_enseignes:'🔗 Union Enseignes', carte_valeur:'🃏 Carte Valeur' };
      setTgSaveModal({
        type: 'strategie',
        id: `S${id}`,
        name: strat.name,
        mode: MODE_LABELS[strat.mode] || strat.mode,
        hand: strat.hand === 'banquier' ? '🎮 Banquier' : '🤖 Joueur',
        threshold: strat.threshold,
        max_rattrapage: strat.max_rattrapage ?? maxRattrapage,
        enabled: strat.enabled,
        channel_id: stratChForm.channel_id.trim(),
        bot_token_preview: stratChForm.bot_token.trim().slice(0,12) + '…',
        format_label: fmtObj ? fmtObj.label : '— Global —',
        format_id: stratChForm.tg_format ? parseInt(stratChForm.tg_format) : null,
        wins:    parseInt(st.wins)    || 0,
        losses:  parseInt(st.losses)  || 0,
        pending: parseInt(st.pending) || 0,
        total:   parseInt(st.total)   || 0,
      });
      setStratChForm({ bot_token: '', channel_id: '', tg_format: null });
      loadStrategies();
    } catch (e) { alert('❌ ' + e.message); }
    finally { setStratChSaving(false); }
  };

  // Sauvegarder l'annonce du sous-formulaire si elle a du contenu
  const saveAnnSub = async (key, botToken, channelId, label) => {
    const annSub = annSubForms[key];
    if (!annSub?.text?.trim() || !botToken?.trim() || !channelId?.trim()) return;
    const times = annSub.schedule_type === 'times'
      ? annSub.times_input.split(',').map(t => t.trim()).filter(Boolean)
      : [];
    await fetch('/api/admin/announcements', {
      method: 'POST', credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: `Annonce ${label}`,
        bot_token: botToken.trim(),
        channel_id: channelId.trim(),
        text: annSub.text.trim(),
        media_type: annSub.media_type || null,
        media_url: annSub.media_url?.trim() || null,
        schedule_type: annSub.schedule_type,
        interval_hours: annSub.schedule_type === 'interval' ? parseFloat(annSub.interval_hours) : null,
        times,
      }),
    });
    loadAnnouncements();
    setAnnSubForms(p => ({ ...p, [key]: ANN_SUB_BLANK }));
  };

  const removeStratTgTarget = async (id, channelId) => {
    const strat = strategies.find(s => s.id === id);
    if (!strat) return;
    const tg_targets = (strat.tg_targets || []).filter(t => t.channel_id !== channelId);
    const r = await fetch(`/api/admin/strategies/${id}`, {
      method: 'PUT', credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...strat, tg_targets }),
    });
    if (r.ok) loadStrategies();
    else alert('❌ Erreur lors de la suppression du canal');
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
      if (r.ok) {
        const data = await r.json();
        setStrategies((Array.isArray(data) ? data : []).map(s => ({
          ...s,
          tg_targets: Array.isArray(s.tg_targets) ? s.tg_targets : [],
          exceptions: Array.isArray(s.exceptions) ? s.exceptions : [],
          relance_rules: Array.isArray(s.relance_rules) ? s.relance_rules : [],
        })));
      }
      // Charger aussi les stratégies Pro (S5001+) pour la modale d'accès utilisateur
      try {
        const rp = await fetch('/api/admin/pro-strategies', { credentials: 'include' });
        if (rp.ok) {
          const dp = await rp.json();
          setProStrategies(Array.isArray(dp.strategies) ? dp.strategies : []);
        }
      } catch {}
    } catch {}
  }, []);

  const loadStratStats = useCallback(async () => {
    try {
      const r = await fetch('/api/predictions/stats', { credentials: 'include' });
      if (r.ok) setStratStats(await r.json());
    } catch {}
  }, []);

  // ── Stratégies Pro — chargement et gestion des cibles Telegram ──
  const loadProStratsTg = useCallback(async () => {
    try {
      setProStratsTgLoading(true);
      const r = await fetch('/api/admin/pro-strategies-tg', { credentials: 'include' });
      if (!r.ok) { setProStratsTg([]); return; }
      const d = await r.json();
      setProStratsTg(Array.isArray(d.strategies) ? d.strategies : []);
    } catch { setProStratsTg([]); }
    finally { setProStratsTgLoading(false); }
  }, []);

  const saveProStratTgTarget = async (id) => {
    const f = proStratTgForm[id] || { bot_token: '', channel_id: '', tg_format: null };
    const bot = (f.bot_token || '').trim();
    const ch  = (f.channel_id || '').trim();
    if (!bot || !ch) { alert('Renseignez le bot_token ET le channel_id'); return; }
    try {
      setProStratTgSaving(p => ({ ...p, [id]: true }));
      const cur  = proStratsTg.find(s => s.id === id);
      const keep = (cur?.tg_targets || []).filter(t => t.channel_id !== ch);
      const tg_targets = [...keep, { bot_token: bot, channel_id: ch, format: f.tg_format ? parseInt(f.tg_format) : 1 }];
      const r = await fetch(`/api/admin/pro-strategies/${id}/tg-targets`, {
        method: 'PUT', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tg_targets }),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || 'Erreur');
      setProStratTgForm(p => ({ ...p, [id]: { bot_token: '', channel_id: '', tg_format: null } }));
      await loadProStratsTg();
    } catch (e) { alert('❌ ' + e.message); }
    finally { setProStratTgSaving(p => ({ ...p, [id]: false })); }
  };

  const removeProStratTgTarget = async (id, channelId) => {
    if (!confirm(`Supprimer la cible ${channelId} de la stratégie Pro S${id} ?`)) return;
    try {
      const cur  = proStratsTg.find(s => s.id === id);
      const tg_targets = (cur?.tg_targets || []).filter(t => t.channel_id !== channelId);
      const r = await fetch(`/api/admin/pro-strategies/${id}/tg-targets`, {
        method: 'PUT', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tg_targets }),
      });
      if (!r.ok) { const d = await r.json(); throw new Error(d.error || 'Erreur'); }
      await loadProStratsTg();
    } catch (e) { alert('❌ ' + e.message); }
  };

  const testProStratTg = async (id) => {
    try {
      const r = await fetch(`/api/admin/pro-strategies/${id}/tg-test`, {
        method: 'POST', credentials: 'include',
      });
      const d = await r.json();
      if (!r.ok || d.ok === false) throw new Error(d.error || 'Erreur');
      alert('✅ Message de test envoyé');
    } catch (e) { alert('❌ ' + e.message); }
  };

  // Recharger automatiquement les stratégies Pro à chaque entrée dans l'onglet Telegram,
  // pour qu'elles s'affichent comme les canaux par défaut sans avoir besoin de rafraîchir.
  useEffect(() => {
    if (adminTab === 'canaux') {
      loadProStratsTg();
    }
  }, [adminTab, loadProStratsTg]);

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

  const loadHostedBots = useCallback(async () => {
    try {
      const r = await fetch('/api/admin/bots', { credentials: 'include' });
      if (r.ok) setHostedBots(await r.json());
    } catch {}
  }, []);

  const loadUiStyles = useCallback(async () => {
    try {
      const r = await fetch('/api/admin/ui-styles', { credentials: 'include' });
      if (r.ok) { const d = await r.json(); setUiStyles(d.styles || {}); }
    } catch {}
  }, []);

  const [customCssInfo, setCustomCssInfo] = useState({ css: '', length: 0 });

  const injectCustomCss = (css) => {
    let el = document.getElementById('baccarat-custom-css');
    if (!el) { el = document.createElement('style'); el.id = 'baccarat-custom-css'; document.head.appendChild(el); }
    el.textContent = css || '';
  };

  const loadCustomCss = useCallback(async () => {
    try {
      const r = await fetch('/api/admin/custom-css', { credentials: 'include' });
      if (r.ok) { const d = await r.json(); setCustomCssInfo(d); injectCustomCss(d.css); }
    } catch {}
  }, []);

  const loadUserMessages = useCallback(async () => {
    try {
      const r = await fetch('/api/admin/user-messages', { credentials: 'include' });
      if (r.ok) { const d = await r.json(); setUserMessages(Array.isArray(d) ? d : []); }
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
    // ── Export complet v2/v3 (généré par "Exporter la configuration") ──
    if (parsed?._meta?.project === 'Baccarat Pro') {
      const items = [];
      const strats   = parsed.strategies        || [];
      const seqs     = parsed.sequences         || [];
      const anns     = parsed.announcements     || [];
      const keys     = parsed.prog_ai_keys      || [];
      const bots     = parsed.prog_bots         || [];
      const tgChs    = parsed.telegram_channels || [];
      const dtg      = parsed.default_tg        || {};
      const umsgs    = parsed.user_messages     || [];

      if (strats.length)  items.push({ icon: '⚙️', label: `${strats.length} stratégie(s)`, detail: strats.map(s => `"${s.name}"`).join(', ') });
      if (seqs.length)    items.push({ icon: '🔁', label: `${seqs.length} séquence(s) de relance`, detail: seqs.map(s => `"${s.name}"`).join(', ') });
      if (anns.length)    items.push({ icon: '📢', label: `${anns.length} annonce(s) planifiée(s)`, detail: anns.map(a => `"${a.name}"`).join(', ') });
      if (keys.length)    items.push({ icon: '🔑', label: `${keys.length} clé(s) API IA`, detail: keys.map(k => k.provider).join(', ') });
      if (bots.length)    items.push({ icon: '🤖', label: `${bots.length} bot(s) Programmation`, detail: bots.map(b => `"${b.name}"`).join(', ') });
      if (tgChs.length)   items.push({ icon: '📲', label: `${tgChs.length} canal/canaux Telegram personnalisé(s)`, detail: tgChs.map(c => c.channel_name || c.channel_id).join(', ') });
      if (umsgs.length)   items.push({ icon: '💬', label: `${umsgs.length} message(s) utilisateurs`, detail: '' });
      const dtgKeys = Object.keys(dtg);
      if (dtgKeys.length) items.push({ icon: '📡', label: `Canaux par défaut (${dtgKeys.join(', ')})`, detail: dtgKeys.map(k => `${k}: ${dtg[k].channel_id || '?'}`).join(' · ') });
      if (parsed.telegram_chat?.bot_token) items.push({ icon: '💬', label: 'Bot de chat Telegram', detail: `Canal: ${parsed.telegram_chat.channel_id || '?'}` });
      if (parsed.broadcast_message?.text)  items.push({ icon: '📣', label: 'Message de diffusion', detail: String(parsed.broadcast_message.text).slice(0, 60) });
      if (parsed.ui?.tutorial_videos?.video1 || parsed.ui?.tutorial_videos?.video2) items.push({ icon: '🎬', label: 'Vidéos tutoriels', detail: [parsed.ui.tutorial_videos.video1, parsed.ui.tutorial_videos.video2].filter(Boolean).join(' · ') });
      if (parsed.ui?.custom_css)           items.push({ icon: '🎨', label: 'CSS personnalisé', detail: `${parsed.ui.custom_css.length} caractères` });
      if (parsed.settings?.tg_msg_format)  items.push({ icon: '🔢', label: 'Format Telegram', detail: `→ Format #${parsed.settings.tg_msg_format}` });
      if (parsed.settings?.bot_token)      items.push({ icon: '🔐', label: 'Token bot principal', detail: '***' });
      if (parsed.settings?.render_db_url)  items.push({ icon: '🗄️', label: 'URL base Render', detail: '***' });
      if (parsed.bilan_last)               items.push({ icon: '📊', label: 'Bilan journalier', detail: `Date: ${parsed.bilan_last.date || '?'}` });
      if (parsed.engine_absences)          items.push({ icon: '🎯', label: 'Compteurs moteur (absences)', detail: `C1/C2/C3 restaurés` });
      if (!items.length) items.push({ icon: 'ℹ️', label: 'Export vide', detail: 'Aucune donnée à importer' });
      return items;
    }
    // ── Fichier de mise à jour standard ───────────────────────────────
    if (!parsed || !parsed.type) return null;
    const blocks = parsed.type === 'multi' ? (parsed.data || []) : [parsed];
    return blocks.map(b => {
      if (b.type === 'format') return { icon: '🔢', label: 'Format de prédiction', detail: `→ Format #${b.data?.format_id}` };
      if (b.type === 'strategies') return { icon: '⚙️', label: 'Stratégies', detail: `${Array.isArray(b.data) ? b.data.length : 0} stratégie(s) à créer/mettre à jour : ${(b.data || []).map(s => `"${s.name}"`).join(', ')}` };
      if (b.type === 'sequences') return { icon: '🔁', label: 'Séquences de relance', detail: `${Array.isArray(b.data) ? b.data.length : 0} séquence(s) : ${(b.data || []).map(s => `"${s.name}"`).join(', ')}` };
      if (b.type === 'styles') return { icon: '🎨', label: 'Styles / Interface', detail: `${Object.keys(b.data || {}).length} variable(s) CSS : ${Object.keys(b.data || {}).join(', ')}` };
      if (b.type === 'announcements') return { icon: '📢', label: 'Annonces planifiées', detail: `${Array.isArray(b.data) ? b.data.length : 0} annonce(s)` };
      if (b.type === 'default_tg') return { icon: '📡', label: 'Canaux par défaut (C1/C2/C3/DC)', detail: Object.keys(b.data || {}).join(', ') };
      if (b.type === 'prog_ai_keys') return { icon: '🔑', label: 'Clés API IA', detail: `${Array.isArray(b.data) ? b.data.length : 0} clé(s)` };
      if (b.type === 'prog_bots') return { icon: '🤖', label: 'Bots Programmation', detail: `${Array.isArray(b.data) ? b.data.length : 0} bot(s)` };
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
        // Détecter si c'est un export complet v2.0 → encapsuler en full_config
        if (parsed?._meta?.project === 'Baccarat Pro') {
          setUpdateFile({ type: 'full_config', data: parsed });
        } else {
          setUpdateFile(parsed);
        }
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
        await Promise.all([loadStrategies(), loadUiStyles(), loadCustomCss(), loadModifiedFiles()]);
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
        // Injecter le CSS personnalisé immédiatement si type=css
        if (d.results?.some(r2 => r2.type === 'css' && r2.applied > 0)) {
          const cr = await fetch('/api/settings/custom-css');
          if (cr.ok) { const css = await cr.text(); injectCustomCss(css); }
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

  const loadServerUpdateFiles = async () => {
    setServerFilesLoading(true);
    try {
      const r = await fetch('/api/admin/server-update-files', { credentials: 'include' });
      if (r.ok) setServerUpdateFiles((await r.json()).files || []);
    } catch {}
    setServerFilesLoading(false);
  };

  const applyServerFile = async (filename) => {
    if (!window.confirm(`Appliquer "${filename}" au système ?`)) return;
    setServerApplyingFile(filename);
    setServerUpdateResult(null);
    try {
      const r = await fetch('/api/admin/apply-server-update', {
        method: 'POST', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ filename }),
      });
      const d = await r.json();
      setServerUpdateResult(d);
      if (d.ok) {
        await Promise.all([loadStrategies(), loadUiStyles(), loadCustomCss(), loadModifiedFiles()]);
        if (d.results?.some(r2 => r2.type === 'styles' && r2.applied > 0)) {
          const sr = await fetch('/api/settings/ui-styles');
          if (sr.ok) {
            const styles = await sr.json();
            for (const [k, v] of Object.entries(styles)) {
              if (k.startsWith('--')) document.documentElement.style.setProperty(k, v);
            }
          }
        }
        if (d.results?.some(r2 => r2.type === 'css' && r2.applied > 0)) {
          const cr = await fetch('/api/settings/custom-css');
          if (cr.ok) { const css = await cr.text(); injectCustomCss(css); }
        }
        if (d.results?.some(r2 => r2.rebuilding)) {
          const bs = await fetch('/api/admin/build-status', { credentials: 'include' });
          if (bs.ok) setBuildStatus(await bs.json());
          pollBuildStatus();
        }
      }
    } catch { setServerUpdateResult({ ok: false, errors: ['Erreur réseau'] }); }
    setServerApplyingFile(null);
  };

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

  const saveDefaultStratTg = async (channelId, channelMeta) => {
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
      if (r.ok && channelId && channelMeta) {
        const cfg = defaultStratTg[channelId] || {};
        const fmtObj = TG_FORMATS.find(f => String(f.value) === String(cfg.tg_format ?? ''));
        const st = stratStats.find(x => x.strategy === channelId) || {};
        setTgSaveModal({
          type: 'canal',
          id: channelId,
          name: channelMeta.name,
          emoji: channelMeta.emoji,
          color: channelMeta.color,
          channel_id: cfg.channel_id?.trim() || '',
          bot_token_preview: cfg.bot_token ? cfg.bot_token.trim().slice(0,12) + '…' : '',
          format_label: fmtObj ? fmtObj.label : '— Global —',
          format_id: cfg.tg_format ? parseInt(cfg.tg_format) : null,
          max_rattrapage: maxRattrapage,
          wins:    parseInt(st.wins)    || 0,
          losses:  parseInt(st.losses)  || 0,
          pending: parseInt(st.pending) || 0,
          total:   parseInt(st.total)   || 0,
        });
      }
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

  const loadBotAdminTgId = useCallback(async () => {
    try {
      const r = await fetch('/api/admin/bot-admin-tg-id', { credentials: 'include' });
      if (r.ok) { const d = await r.json(); setBotAdminTgId(d.bot_admin_tg_id || ''); }
    } catch {}
  }, []);

  const saveBotAdminTgId = async () => {
    setBotAdminTgSaving(true);
    try {
      const r = await fetch('/api/admin/bot-admin-tg-id', {
        method: 'POST', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ bot_admin_tg_id: botAdminTgId }),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || 'Erreur');
      setBotAdminTgMsg('✅ ID admin bot enregistré');
      setTimeout(() => setBotAdminTgMsg(''), 3000);
    } catch (e) {
      setBotAdminTgMsg('❌ ' + e.message);
      setTimeout(() => setBotAdminTgMsg(''), 3000);
    }
    setBotAdminTgSaving(false);
  };

  const loadMaxR = useCallback(async () => {
    try {
      const r = await fetch('/api/admin/max-rattrapage', { credentials: 'include' });
      if (r.ok) { const d = await r.json(); setMaxRattrapage(d.max_rattrapage ?? 20); }
    } catch {}
  }, []);

  // Polling statut compteurs relance (toutes les 3s)
  useEffect(() => {
    const poll = () => fetch('/api/admin/relance-status', { credentials: 'include' })
      .then(r => r.ok ? r.json() : {}).then(setRelanceStatus).catch(() => {});
    poll();
    const iv = setInterval(poll, 3000);
    return () => clearInterval(iv);
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
    setStratForm({ name: s.name, threshold: s.threshold, mode: s.mode, mappings, visibility: s.visibility, enabled: s.enabled, tg_targets, stratType, exceptions, prediction_offset: s.prediction_offset || 1, hand: s.hand === 'banquier' ? 'banquier' : 'joueur', max_rattrapage: s.max_rattrapage ?? 20, tg_format: s.tg_format ?? null, mirror_pairs: normalizeMirrorPairs(s.mirror_pairs), trigger_on: s.trigger_on ?? null, trigger_strategy_id: s.trigger_strategy_id ?? '', trigger_count: s.trigger_count ?? 2, trigger_level: s.trigger_level ?? 3, relance_enabled: s.relance_enabled ?? false, relance_pertes: s.relance_pertes ?? 3, relance_types: s.relance_types ?? [], relance_nombre: s.relance_nombre ?? 1, strategy_type: s.strategy_type || 'simple', multi_source_ids: s.multi_source_ids || [], multi_require: s.multi_require || 'any', loss_type: s.loss_type || 'rattrapage', relance_rules: s.relance_rules || [], carte_p: s.carte_p ?? 2, carte_h: s.carte_h ?? 32, carte_ecart: s.carte_ecart ?? 5, carte_position: s.carte_position ?? 1, carte_source_hand: s.carte_source_hand || 'joueur', intelligent_window: s.intelligent_window ?? 300, intelligent_pattern: s.intelligent_pattern ?? 3, intelligent_min_count: s.intelligent_min_count ?? 3, intelligent_categories: s.intelligent_categories || [] });
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
    setStratForm({ name: `Copie de ${s.name}`, threshold: s.threshold, mode: s.mode, mappings, visibility: s.visibility, enabled: false, tg_targets, stratType, exceptions, prediction_offset: s.prediction_offset || 1, hand: s.hand === 'banquier' ? 'banquier' : 'joueur', max_rattrapage: s.max_rattrapage ?? 20, tg_format: s.tg_format ?? null, mirror_pairs: normalizeMirrorPairs(s.mirror_pairs), trigger_on: s.trigger_on ?? null, trigger_strategy_id: s.trigger_strategy_id ?? '', trigger_count: s.trigger_count ?? 2, trigger_level: s.trigger_level ?? 3, relance_enabled: s.relance_enabled ?? false, relance_pertes: s.relance_pertes ?? 3, relance_types: s.relance_types ?? [], relance_nombre: s.relance_nombre ?? 1, strategy_type: s.strategy_type || 'simple', multi_source_ids: s.multi_source_ids || [], multi_require: s.multi_require || 'any', loss_type: s.loss_type || 'rattrapage', relance_rules: s.relance_rules || [], carte_p: s.carte_p ?? 2, carte_h: s.carte_h ?? 32, carte_ecart: s.carte_ecart ?? 5, carte_position: s.carte_position ?? 1, carte_source_hand: s.carte_source_hand || 'joueur', intelligent_window: s.intelligent_window ?? 300, intelligent_pattern: s.intelligent_pattern ?? 3, intelligent_min_count: s.intelligent_min_count ?? 3, intelligent_categories: s.intelligent_categories || [] });
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
    console.log('[saveStrat] Bouton cliqué, stratForm:', JSON.stringify(stratForm).substring(0, 300));
    console.log('[saveStrat] stratEditing:', stratEditing);
    setStratSaving(true);
    try {
      const url = stratEditing !== null ? `/api/admin/strategies/${stratEditing}` : '/api/admin/strategies';
      const method = stratEditing !== null ? 'PUT' : 'POST';
      console.log('[saveStrat] Envoi', method, url);
      const r = await fetch(url, {
        method, credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(stratForm),
      });
      const d = await r.json();
      console.log('[saveStrat] Réponse:', r.status, JSON.stringify(d));
      if (!r.ok) throw new Error(d.error || 'Erreur');
      const wasEditing = stratEditing !== null;
      const s = d.strategy;
      setSuccessModal({
        type: wasEditing ? 'update' : 'create',
        id: s?.id,
        name: s?.name || stratForm.name,
        mode: s?.mode || stratForm.mode,
        hand: s?.hand || stratForm.hand,
        visibility: s?.visibility || stratForm.visibility,
        threshold: s?.threshold ?? stratForm.threshold,
        max_rattrapage: s?.max_rattrapage ?? stratForm.max_rattrapage,
        exceptions: Array.isArray(s?.exceptions) ? s.exceptions : (stratForm.exceptions || []),
        tg_targets: Array.isArray(s?.tg_targets) ? s.tg_targets : (stratForm.tg_targets || []),
        mirror_pairs: Array.isArray(s?.mirror_pairs) ? s.mirror_pairs : (stratForm.mirror_pairs || []),
        enabled: s?.enabled ?? stratForm.enabled,
      });
      setStratForm(JSON.parse(JSON.stringify(BLANK_FORM)));
      setStratEditing(null);
      loadStrategies();
    } catch (e) { console.error('[saveStrat] ERREUR:', e); showStratMsg('❌ ' + e.message, true); }
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

  const submitAleatPrediction = async () => {
    if (!aleatPanel || !aleatPanel.gameInput) return;
    const num = parseInt(aleatPanel.gameInput);
    if (isNaN(num) || num < 1 || num > 1440) return;
    try {
      const r = await fetch(`/api/admin/strategies/${aleatPanel.stratId}/aleatoire-predict`, {
        method: 'POST', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ hand: aleatPanel.hand, game_number: num }),
      });
      const data = await r.json();
      if (!r.ok) { alert(data.error || 'Erreur'); return; }
      const newEntry = {
        game_number: data.game_number,
        source_game: data.source_game,
        source_cards_emoji: data.source_cards_emoji,
        predicted_suit: data.predicted_suit,
        suit_emoji: data.suit_emoji,
        hand: aleatPanel.hand,
        status: 'en_cours',
      };
      setAleatPanel(p => ({
        ...p,
        step: 'result',
        result: data,
        gameInput: '',
        history: [...(p.history || []), newEntry],
      }));
    } catch (e) { alert('Erreur réseau : ' + e.message); }
  };

  // Polling pour mise à jour statut des prédictions aléatoires en cours
  useEffect(() => {
    if (!aleatPanel) return;
    const pending = (aleatPanel.history || []).filter(h => h.status === 'en_cours');
    if (pending.length === 0) return;
    const iv = setInterval(async () => {
      try {
        const r = await fetch(`/api/predictions?limit=100`, { credentials: 'include' });
        if (!r.ok) return;
        const rows = await r.json();
        setAleatPanel(p => {
          if (!p) return p;
          const updated = (p.history || []).map(h => {
            if (h.status !== 'en_cours') return h;
            const found = rows.find(row => row.game_number === h.game_number && row.predicted_suit === h.predicted_suit && (String(row.strategy) === String(p.stratId) || String(row.strategy) === `S${p.stratId}`));
            if (found && (found.status === 'gagne' || found.status === 'perdu')) return { ...h, status: found.status };
            return h;
          });
          return { ...p, history: updated };
        });
      } catch {}
    }, 4000);
    return () => clearInterval(iv);
  }, [aleatPanel?.history?.map(h => h.game_number + h.status).join(','), aleatPanel?.stratId]);

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

  const loadAiConfig = useCallback(async () => {
    try {
      const [provR, cfgR, visR] = await Promise.all([
        fetch('/api/ai/providers',   { credentials: 'include' }),
        fetch('/api/ai/config',      { credentials: 'include' }),
        fetch('/api/ai/vision-key',  { credentials: 'include' }),
      ]);
      if (provR.ok) { const d = await provR.json(); setAiProviders(d.providers || []); }
      if (cfgR.ok)  { const d = await cfgR.json();  setAiConfigData(d); setAiSelectedProv(d.provider || 'groq'); }
      if (visR.ok)  { const d = await visR.json();  setVisionKeyData(d); }
    } catch {}
  }, []);

  useEffect(() => { loadUsers(); loadChannels(); loadTokenInfo(); loadStrategies(); loadStratStats(); loadMsgFormat(); loadMaxR(); loadBotAdminTgId(); loadStrategyRoutes(); loadDefaultStratTg(); loadAnnouncements(); loadRenderDbStatus(); loadUiStyles(); loadCustomCss(); loadModifiedFiles(); loadBroadcastMessage(); loadUserMessages(); loadHostedBots(); loadAiConfig(); }, [loadUsers, loadChannels, loadTokenInfo, loadStrategies, loadStratStats, loadMsgFormat, loadMaxR, loadBotAdminTgId, loadStrategyRoutes, loadDefaultStratTg, loadAnnouncements, loadRenderDbStatus, loadUiStyles, loadCustomCss, loadModifiedFiles, loadBroadcastMessage, loadUserMessages, loadHostedBots, loadAiConfig]);

  // Fetch mirrorCounts toutes les 5s pour les stratégies taux_miroir
  useEffect(() => {
    const fetchMirrorCounts = async () => {
      const mirrorStrats = strategies.filter(s => s.mode === 'taux_miroir');
      if (!mirrorStrats.length) return;
      const updates = {};
      await Promise.all(mirrorStrats.map(async s => {
        try {
          const r = await fetch(`/api/admin/strategies/${s.id}/mirror-counts`, { credentials: 'include' });
          if (r.ok) { const d = await r.json(); updates[s.id] = d; }
        } catch {}
      }));
      if (Object.keys(updates).length) setMirrorCountsData(p => ({ ...p, ...updates }));
    };
    fetchMirrorCounts();
    const iv = setInterval(fetchMirrorCounts, 5000);
    return () => clearInterval(iv);
  }, [strategies]);

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

  // Définir / régénérer le mot de passe d'un utilisateur (rend visible côté admin)
  const setUserPassword = async (uid, opts = {}) => {
    const { custom = false } = opts;
    let body = {};
    if (custom) {
      const pwd = window.prompt('Nouveau mot de passe (min. 6 caractères) :');
      if (pwd == null) return;            // annulé
      if (pwd.trim().length < 6) { showMsg('❌ Mot de passe trop court (min. 6 caractères)'); return; }
      body.password = pwd.trim();
    } else {
      if (!confirm('Générer un nouveau mot de passe aléatoire pour cet utilisateur ?\n\n⚠ Son ancien mot de passe ne fonctionnera plus.')) return;
    }
    const res = await fetch(`/api/admin/users/${uid}/set-password`, {
      method: 'POST', credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const d = await res.json().catch(() => ({}));
    if (res.ok) {
      showMsg(`🔑 Mot de passe ${d.generated ? 'généré' : 'défini'} : ${d.password}`);
      loadUsers();
    } else {
      showMsg('❌ ' + (d.error || 'Erreur'));
    }
  };

  // Visibility modal (opt-in : canaux Telegram + stratégies)
  const openVisModal = (u) => {
    setVisModal({ userId: u.id, username: u.username });
    setVisLoading(true);
    setVisInitializedIds(prev => { const s = new Set(prev); s.delete(u.id); return s; });
    Promise.all([
      fetch(`/api/telegram/users/${u.id}/visibility`, { credentials: 'include' }).then(r => r.ok ? r.json() : null),
      fetch(`/api/admin/users/${u.id}/strategies`, { credentials: 'include' }).then(r => r.ok ? r.json() : null),
    ]).then(([chD, stD]) => {
      if (chD) setVisData(p => ({ ...p, [u.id]: new Set(chD.visible || []) }));
      if (stD) setVisStratData(p => ({ ...p, [u.id]: new Set(stD.visible || []) }));
      if (chD && stD) setVisInitializedIds(prev => { const s = new Set(prev); s.add(u.id); return s; });
    }).catch(e => {
      showMsg(`Erreur chargement : ${e.message}`, true);
    }).finally(() => setVisLoading(false));
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

  const saveVisibility = async (userIdArg = null) => {
    const userId = userIdArg || (visModal && visModal.userId);
    if (!userId) return;
    // Garde anti-race : si les données n'ont pas encore été chargées depuis le serveur,
    // on refuse de sauvegarder pour éviter d'écraser les canaux existants avec des tableaux vides.
    if (userIdArg && !visInitializedIds.has(userId)) {
      showMsg('⏳ Chargement en cours, veuillez patienter puis réessayer…', true);
      return;
    }
    setSavingVis(true);
    const visibleChannels = [...(visData[userId] || new Set())];
    const visibleStrategies = [...(visStratData[userId] || new Set())];
    try {
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
      if (r1.ok && r2.ok) {
        showMsg('✅ Accès enregistrés');
        // Met à jour le compteur visible sur le bouton
        setVisCounts(p => ({ ...p, [userId]: visibleChannels.length + visibleStrategies.length }));
        // Affiche le bandeau de confirmation pendant 4s
        setSavedFlash(userId);
        setTimeout(() => setSavedFlash(f => (f === userId ? null : f)), 4000);
        if (!userIdArg) setVisModal(null);
      } else {
        showMsg('Erreur lors de la sauvegarde', true);
      }
    } finally {
      setSavingVis(false);
    }
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

  const modeLabels = { manquants: 'Absences', apparents: 'Apparitions', absence_apparition: 'Abs→App', apparition_absence: 'App→Abs', miroir_taux: 'Miroir Taux', aleatoire: 'Aléatoire', relance: 'Relance', multi_strategy: 'Combinaison', distribution: 'Distribution', carte_3_vers_2: '3C→2C', carte_2_vers_3: '2C→3C', taux_miroir: 'Miroir Taux', compteur_adverse: 'C. Adverse', victoire_adverse: 'Victoire Adverse', abs_3_vers_2: '3→2 Abs', abs_3_vers_3: '3→3 Abs', absence_victoire: 'Abs Victoire', union_enseignes: 'Union Ens.', carte_valeur: 'Carte Val.' };

  return (
    <>
    <div className="admin-page">

      {/* ── Modale succès Pro (import / mise à jour fichier) ───────────────── */}
      {proSavedModal && (
        <div style={{ position: 'fixed', inset: 0, zIndex: 10000, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(0,0,0,0.82)', backdropFilter: 'blur(10px)' }}
          onClick={() => setProSavedModal(null)}>
          <div onClick={e => e.stopPropagation()} style={{
            background: 'linear-gradient(180deg, #0f172a 0%, #1e293b 100%)',
            border: '2px solid rgba(34,197,94,0.45)',
            borderRadius: 20, padding: '28px 26px', maxWidth: 460, width: 'calc(100% - 32px)',
            textAlign: 'center', boxShadow: '0 0 60px rgba(34,197,94,0.35), 0 20px 80px rgba(0,0,0,0.6)',
            animation: 'smPopIn 0.35s cubic-bezier(0.34,1.56,0.64,1) both',
          }}>
            <div style={{
              width: 72, height: 72, borderRadius: '50%', margin: '0 auto 14px',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              background: 'radial-gradient(circle, rgba(34,197,94,0.35) 0%, rgba(34,197,94,0.08) 70%)',
              border: '2px solid rgba(34,197,94,0.5)',
            }}>
              <span style={{ fontSize: 42 }}>{proSavedModal.type === 'create' ? '✅' : '✏️'}</span>
            </div>
            <div style={{
              display: 'inline-block', fontSize: 11, fontWeight: 800, letterSpacing: 2,
              color: '#4ade80', background: 'rgba(34,197,94,0.12)',
              border: '1px solid rgba(34,197,94,0.35)', borderRadius: 6, padding: '3px 12px', marginBottom: 12,
            }}>
              {proSavedModal.type === 'create' ? '✦ NOUVELLE STRATÉGIE PRO' : '✦ STRATÉGIE PRO MISE À JOUR'}
            </div>
            <div style={{ fontSize: 24, fontWeight: 900, color: '#f1f5f9', marginBottom: 4 }}>
              {proSavedModal.type === 'create' ? 'Importation réussie !' : 'Mise à jour effectuée !'}
            </div>
            <div style={{ fontSize: 13, color: '#94a3b8', marginBottom: 18 }}>
              Fichier <code style={{ color: '#e2e8f0', background: 'rgba(255,255,255,0.06)', padding: '1px 6px', borderRadius: 4 }}>{proSavedModal.filename}</code> enregistré.
            </div>

            <div style={{
              background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)',
              borderRadius: 14, padding: '16px 18px', marginBottom: 18, textAlign: 'left',
            }}>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                <div>
                  <div style={{ fontSize: 10, color: '#475569', fontWeight: 700, letterSpacing: 1, textTransform: 'uppercase' }}>Slot</div>
                  <div style={{ fontSize: 16, fontWeight: 800, color: '#c084fc' }}>S{proSavedModal.id}</div>
                </div>
                <div>
                  <div style={{ fontSize: 10, color: '#475569', fontWeight: 700, letterSpacing: 1, textTransform: 'uppercase' }}>Stratégie</div>
                  <div style={{ fontSize: 14, fontWeight: 800, color: '#e2e8f0' }}>{proSavedModal.strategy_name || '—'}</div>
                </div>
                <div>
                  <div style={{ fontSize: 10, color: '#475569', fontWeight: 700, letterSpacing: 1, textTransform: 'uppercase' }}>Main</div>
                  <div style={{ fontSize: 14, fontWeight: 800, color: '#818cf8' }}>{proSavedModal.hand === 'banquier' ? '🏦 Banquier' : '🃏 Joueur'}</div>
                </div>
                <div>
                  <div style={{ fontSize: 10, color: '#475569', fontWeight: 700, letterSpacing: 1, textTransform: 'uppercase' }}>Décalage</div>
                  <div style={{ fontSize: 14, fontWeight: 800, color: '#fbbf24' }}>+{proSavedModal.decalage ?? '?'}</div>
                </div>
                <div>
                  <div style={{ fontSize: 10, color: '#475569', fontWeight: 700, letterSpacing: 1, textTransform: 'uppercase' }}>Rattrapage</div>
                  <div style={{ fontSize: 14, fontWeight: 800, color: '#fbbf24' }}>R{proSavedModal.max_rattrapage ?? '?'}</div>
                </div>
                <div>
                  <div style={{ fontSize: 10, color: '#475569', fontWeight: 700, letterSpacing: 1, textTransform: 'uppercase' }}>Moteur</div>
                  <div style={{ fontSize: 14, fontWeight: 800, color: '#4ade80' }}>{(proSavedModal.engine_type || '').toUpperCase() || '—'}</div>
                </div>
              </div>
            </div>

            {proSavedModal.warnings?.length > 0 && (
              <div style={{
                background: 'rgba(251,191,36,0.08)', border: '1px solid rgba(251,191,36,0.3)',
                borderRadius: 10, padding: '10px 12px', marginBottom: 14, textAlign: 'left',
                fontSize: 12, color: '#fcd34d',
              }}>
                <div style={{ fontWeight: 800, marginBottom: 4 }}>⚠️ {proSavedModal.warnings.length} avertissement(s)</div>
                {proSavedModal.warnings.slice(0, 3).map((w, i) => (
                  <div key={i} style={{ opacity: 0.85 }}>• {w.message}</div>
                ))}
              </div>
            )}

            {proSavedModal.engine_error && (
              <div style={{
                background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.3)',
                borderRadius: 10, padding: '10px 12px', marginBottom: 14, textAlign: 'left',
                fontSize: 12, color: '#fca5a5',
              }}>
                <div style={{ fontWeight: 800, marginBottom: 4 }}>⚠️ Erreur du moteur</div>
                <div>{proSavedModal.engine_error}</div>
              </div>
            )}

            <div style={{ fontSize: 12, color: '#64748b', marginBottom: 14 }}>
              👉 Sélectionne le canal <b style={{ color: '#a78bfa' }}>S{proSavedModal.id}</b> dans le Dashboard pour voir les <b>logs en direct</b>.
            </div>

            <button
              onClick={() => setProSavedModal(null)}
              style={{
                background: 'linear-gradient(135deg, #22c55e 0%, #16a34a 100%)',
                color: 'white', fontWeight: 800, fontSize: 14, letterSpacing: 0.5,
                border: 'none', borderRadius: 10, padding: '11px 28px', cursor: 'pointer',
                boxShadow: '0 4px 20px rgba(34,197,94,0.4)',
              }}>
              Parfait, fermer
            </button>
          </div>
        </div>
      )}

      {/* ── Modale erreur Pro (validation / réseau) ─────────────────────────── */}
      {proErrorModal && (
        <div style={{ position: 'fixed', inset: 0, zIndex: 10000, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(0,0,0,0.82)', backdropFilter: 'blur(10px)' }}
          onClick={() => setProErrorModal(null)}>
          <div onClick={e => e.stopPropagation()} style={{
            background: 'linear-gradient(180deg, #1f0d10 0%, #2a1418 100%)',
            border: '2px solid rgba(239,68,68,0.5)',
            borderRadius: 20, padding: '26px 24px', maxWidth: 480, width: 'calc(100% - 32px)',
            textAlign: 'center', boxShadow: '0 0 60px rgba(239,68,68,0.35), 0 20px 80px rgba(0,0,0,0.6)',
            animation: 'smPopIn 0.35s cubic-bezier(0.34,1.56,0.64,1) both',
          }}>
            <div style={{
              width: 64, height: 64, borderRadius: '50%', margin: '0 auto 12px',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              background: 'radial-gradient(circle, rgba(239,68,68,0.35) 0%, rgba(239,68,68,0.08) 70%)',
              border: '2px solid rgba(239,68,68,0.5)',
            }}><span style={{ fontSize: 36 }}>⚠️</span></div>
            <div style={{ fontSize: 22, fontWeight: 900, color: '#f1f5f9', marginBottom: 6 }}>
              {proErrorModal.title}
            </div>
            <div style={{ fontSize: 13, color: '#fca5a5', marginBottom: 16, lineHeight: 1.5 }}>
              {proErrorModal.message}
            </div>

            {proErrorModal.errors?.length > 0 && (
              <div style={{
                background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.3)',
                borderRadius: 10, padding: '12px 14px', marginBottom: 14, textAlign: 'left',
                fontSize: 12, color: '#fecaca', maxHeight: 180, overflowY: 'auto',
              }}>
                <div style={{ fontWeight: 800, marginBottom: 6, color: '#fca5a5' }}>
                  {proErrorModal.errors.length} erreur(s)
                </div>
                {proErrorModal.errors.map((er, i) => (
                  <div key={i} style={{ marginBottom: 4 }}>
                    <span style={{ background: 'rgba(239,68,68,0.18)', color: '#fca5a5', padding: '1px 6px', borderRadius: 4, fontWeight: 700, marginRight: 6 }}>
                      {er.type}{er.line ? ` L${er.line}` : ''}
                    </span>
                    {er.message}
                  </div>
                ))}
              </div>
            )}

            <button
              onClick={() => setProErrorModal(null)}
              style={{
                background: 'linear-gradient(135deg, #ef4444 0%, #b91c1c 100%)',
                color: 'white', fontWeight: 800, fontSize: 14, letterSpacing: 0.5,
                border: 'none', borderRadius: 10, padding: '11px 28px', cursor: 'pointer',
                boxShadow: '0 4px 20px rgba(239,68,68,0.4)',
              }}>
              J'ai compris
            </button>
          </div>
        </div>
      )}

      {successModal && (
        <div style={{ position: 'fixed', inset: 0, zIndex: 9999, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(0,0,0,0.82)', backdropFilter: 'blur(10px)' }}
          onClick={() => setSuccessModal(null)}>
          <div onClick={e => e.stopPropagation()} style={{
            position: 'relative', overflow: 'hidden',
            background: 'linear-gradient(160deg, #0d1f12 0%, #0a1628 45%, #0d1f12 100%)',
            border: '1px solid rgba(34,197,94,0.5)',
            borderRadius: 24, padding: '44px 48px 36px', maxWidth: 460, width: '92%',
            boxShadow: '0 0 0 1px rgba(34,197,94,0.1), 0 0 80px rgba(34,197,94,0.2), 0 30px 60px rgba(0,0,0,0.6)',
            textAlign: 'center', animation: 'smPopIn 0.45s cubic-bezier(0.34,1.56,0.64,1)',
          }}>
            <div style={{ position: 'absolute', inset: 0, pointerEvents: 'none', overflow: 'hidden' }}>
              {[...Array(12)].map((_, i) => (
                <div key={i} style={{
                  position: 'absolute',
                  width: i % 3 === 0 ? 6 : i % 3 === 1 ? 4 : 8,
                  height: i % 3 === 0 ? 6 : i % 3 === 1 ? 4 : 8,
                  borderRadius: i % 2 === 0 ? '50%' : 2,
                  background: ['#22c55e','#fbbf24','#818cf8','#34d399','#f472b6','#60a5fa'][i % 6],
                  left: `${8 + (i * 7.5) % 84}%`,
                  top: `${5 + (i * 11) % 40}%`,
                  opacity: 0,
                  animation: `smParticle${i % 4} ${1.2 + (i % 5) * 0.3}s ${0.1 + i * 0.08}s ease-out forwards`,
                }} />
              ))}
            </div>

            <div style={{ position: 'relative' }}>
              <div style={{
                display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                width: 80, height: 80, borderRadius: '50%', marginBottom: 20,
                background: successModal.type === 'create'
                  ? 'radial-gradient(circle, rgba(34,197,94,0.25) 0%, rgba(34,197,94,0.05) 70%)'
                  : 'radial-gradient(circle, rgba(99,102,241,0.25) 0%, rgba(99,102,241,0.05) 70%)',
                border: `2px solid ${successModal.type === 'create' ? 'rgba(34,197,94,0.4)' : 'rgba(99,102,241,0.4)'}`,
                animation: 'smPulseRing 2s ease-in-out infinite',
                boxShadow: successModal.type === 'create'
                  ? '0 0 30px rgba(34,197,94,0.2)'
                  : '0 0 30px rgba(99,102,241,0.2)',
              }}>
                <span style={{ fontSize: 38, animation: 'smBounceIn 0.6s 0.2s cubic-bezier(0.34,1.56,0.64,1) both' }}>
                  {successModal.type === 'create' ? '✅' : '✏️'}
                </span>
              </div>

              <div style={{
                display: 'inline-block', fontSize: 11, fontWeight: 800, letterSpacing: 2,
                color: successModal.type === 'create' ? '#22c55e' : '#818cf8',
                background: successModal.type === 'create' ? 'rgba(34,197,94,0.12)' : 'rgba(99,102,241,0.12)',
                border: `1px solid ${successModal.type === 'create' ? 'rgba(34,197,94,0.3)' : 'rgba(99,102,241,0.3)'}`,
                borderRadius: 6, padding: '3px 12px', marginBottom: 12,
                animation: 'smFadeUp 0.4s 0.25s ease-out both',
              }}>
                {successModal.type === 'create' ? '✦ NOUVELLE STRATÉGIE' : '✦ MISE À JOUR'}
              </div>

              <div style={{
                fontSize: 26, fontWeight: 900, color: '#f1f5f9', marginBottom: 4, lineHeight: 1.2,
                textShadow: successModal.type === 'create' ? '0 0 30px rgba(34,197,94,0.4)' : '0 0 30px rgba(99,102,241,0.4)',
                animation: 'smFadeUp 0.4s 0.32s ease-out both',
              }}>
                {successModal.type === 'create' ? 'Enregistrement réussi !' : 'Modifications sauvegardées !'}
              </div>

              <div style={{
                background: 'linear-gradient(135deg, rgba(255,255,255,0.04) 0%, rgba(255,255,255,0.01) 100%)',
                border: '1px solid rgba(255,255,255,0.08)',
                borderRadius: 16, padding: '20px 24px', margin: '20px 0 18px',
                animation: 'smFadeUp 0.4s 0.4s ease-out both',
              }}>
                <div style={{ fontSize: 11, fontWeight: 700, color: '#475569', letterSpacing: 1.5, textTransform: 'uppercase', marginBottom: 8 }}>
                  Stratégie
                </div>
                <div style={{ fontSize: 22, fontWeight: 800, color: '#e2e8f0', marginBottom: 14, letterSpacing: -0.3 }}>
                  {successModal.name}
                </div>
                <div style={{ display: 'flex', justifyContent: 'center', gap: 8, flexWrap: 'wrap' }}>
                  <span style={{ fontSize: 11, padding: '4px 12px', borderRadius: 20, fontWeight: 800,
                    background: 'rgba(168,85,247,0.18)', color: '#c084fc', border: '1px solid rgba(168,85,247,0.35)',
                    letterSpacing: 0.5,
                  }}>#{successModal.id}</span>
                  <span style={{ fontSize: 11, padding: '4px 12px', borderRadius: 20, fontWeight: 800,
                    background: 'rgba(251,191,36,0.15)', color: '#fbbf24', border: '1px solid rgba(251,191,36,0.35)',
                    letterSpacing: 0.5,
                  }}>{modeLabels[successModal.mode] || successModal.mode}</span>
                  {successModal.mode !== 'distribution' && (
                  <span style={{ fontSize: 11, padding: '4px 12px', borderRadius: 20, fontWeight: 800,
                    background: 'rgba(99,102,241,0.15)', color: '#818cf8', border: '1px solid rgba(99,102,241,0.35)',
                    letterSpacing: 0.5,
                  }}>{successModal.hand === 'banquier' ? '🏦 Banquier' : '🃏 Joueur'}</span>
                  )}
                  <span style={{ fontSize: 11, padding: '4px 12px', borderRadius: 20, fontWeight: 800,
                    background: successModal.visibility === 'all' ? 'rgba(34,197,94,0.15)' : 'rgba(100,116,139,0.15)',
                    color: successModal.visibility === 'all' ? '#4ade80' : '#94a3b8',
                    border: `1px solid ${successModal.visibility === 'all' ? 'rgba(34,197,94,0.35)' : 'rgba(100,116,139,0.3)'}`,
                    letterSpacing: 0.5,
                  }}>{successModal.visibility === 'all' ? '🌐 Publique' : '🔒 Admin'}</span>
                  <span style={{ fontSize: 11, padding: '4px 12px', borderRadius: 20, fontWeight: 800,
                    background: 'rgba(34,197,94,0.12)', color: '#4ade80', border: '1px solid rgba(34,197,94,0.3)',
                    letterSpacing: 0.5,
                  }}>{successModal.enabled !== false ? '● Active' : '○ Inactive'}</span>
                </div>
              </div>

              {/* ── Grille options détaillées ── */}
              <div style={{
                display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8,
                margin: '0 0 18px', animation: 'smFadeUp 0.4s 0.44s ease-out both',
              }}>
                {[
                  { icon: '⚖️', label: successModal.mode === 'taux_miroir' ? 'Différence' : 'Seuil B', value: successModal.threshold },
                  { icon: '🔁', label: 'Rattrapages max', value: `R${successModal.max_rattrapage ?? 20}` },
                  { icon: '⛔', label: 'Exceptions', value: (successModal.exceptions?.length || 0) === 0 ? 'Aucune' : `${successModal.exceptions.length} règle(s)` },
                  { icon: '✈️', label: 'Canaux Telegram', value: (successModal.tg_targets?.filter(t => t.bot_token && t.channel_id).length || 0) === 0 ? 'Aucun' : `${successModal.tg_targets.filter(t=>t.bot_token&&t.channel_id).length} canal(aux)` },
                ].map(item => (
                  <div key={item.label} style={{
                    background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.07)',
                    borderRadius: 10, padding: '10px 14px', textAlign: 'left',
                  }}>
                    <div style={{ fontSize: 10, color: '#475569', fontWeight: 700, letterSpacing: 1, textTransform: 'uppercase', marginBottom: 3 }}>{item.icon} {item.label}</div>
                    <div style={{ fontSize: 14, fontWeight: 800, color: '#e2e8f0' }}>{item.value}</div>
                  </div>
                ))}
                {successModal.mode === 'taux_miroir' && (successModal.mirror_pairs?.length || 0) > 0 && (
                  <div style={{
                    gridColumn: '1 / -1',
                    background: 'rgba(99,102,241,0.07)', border: '1px solid rgba(99,102,241,0.2)',
                    borderRadius: 10, padding: '10px 14px', textAlign: 'left',
                  }}>
                    <div style={{ fontSize: 10, color: '#818cf8', fontWeight: 700, letterSpacing: 1, textTransform: 'uppercase', marginBottom: 4 }}>⚖️ Paires surveillées</div>
                    <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                      {(successModal.mirror_pairs || []).map((p, i) => (
                        <span key={i} style={{ fontSize: 12, padding: '2px 10px', borderRadius: 12, background: 'rgba(99,102,241,0.2)', color: '#a5b4fc', border: '1px solid rgba(99,102,241,0.35)', fontWeight: 700 }}>
                          {p.a} vs {p.b} {p.threshold ? `·${p.threshold}` : ''}
                        </span>
                      ))}
                    </div>
                  </div>
                )}
              </div>

              <div style={{ fontSize: 12, color: '#64748b', marginBottom: 20, lineHeight: 1.7,
                animation: 'smFadeUp 0.4s 0.50s ease-out both',
              }}>
                {successModal.type === 'create'
                  ? '🚀 La stratégie est active et génère des prédictions en temps réel.'
                  : '⚡ Les modifications sont appliquées instantanément au moteur.'}
              </div>

              <button
                onClick={() => setSuccessModal(null)}
                onMouseEnter={e => { e.currentTarget.style.transform = 'translateY(-2px) scale(1.03)'; e.currentTarget.style.boxShadow = '0 8px 25px rgba(34,197,94,0.45)'; }}
                onMouseLeave={e => { e.currentTarget.style.transform = 'translateY(0) scale(1)'; e.currentTarget.style.boxShadow = '0 4px 20px rgba(34,197,94,0.3)'; }}
                style={{
                  padding: '14px 48px', borderRadius: 14, border: 'none', cursor: 'pointer',
                  background: 'linear-gradient(135deg, #22c55e 0%, #16a34a 50%, #15803d 100%)',
                  color: '#fff', fontWeight: 800, fontSize: 15, letterSpacing: 0.3,
                  boxShadow: '0 4px 20px rgba(34,197,94,0.3)',
                  transition: 'transform 0.2s, box-shadow 0.2s',
                  animation: 'smFadeUp 0.4s 0.55s ease-out both',
                }}>
                ✓ &nbsp;Parfait !
              </button>
            </div>
          </div>
        </div>
      )}

      <style>{`
        @keyframes smPopIn {
          from { opacity: 0; transform: scale(0.7) translateY(30px); }
          to   { opacity: 1; transform: scale(1) translateY(0); }
        }
        @keyframes smFadeUp {
          from { opacity: 0; transform: translateY(14px); }
          to   { opacity: 1; transform: translateY(0); }
        }
        @keyframes smBounceIn {
          from { opacity: 0; transform: scale(0.4); }
          to   { opacity: 1; transform: scale(1); }
        }
        @keyframes smPulseRing {
          0%, 100% { box-shadow: 0 0 0 0 rgba(34,197,94,0.3), 0 0 30px rgba(34,197,94,0.15); }
          50%       { box-shadow: 0 0 0 8px rgba(34,197,94,0), 0 0 40px rgba(34,197,94,0.25); }
        }
        @keyframes smParticle0 {
          0%   { opacity: 0; transform: translate(0,0) scale(0); }
          30%  { opacity: 1; }
          100% { opacity: 0; transform: translate(-40px, -80px) scale(1.5) rotate(180deg); }
        }
        @keyframes smParticle1 {
          0%   { opacity: 0; transform: translate(0,0) scale(0); }
          30%  { opacity: 1; }
          100% { opacity: 0; transform: translate(50px, -90px) scale(1.2) rotate(-120deg); }
        }
        @keyframes smParticle2 {
          0%   { opacity: 0; transform: translate(0,0) scale(0); }
          30%  { opacity: 1; }
          100% { opacity: 0; transform: translate(-20px, -70px) scale(1) rotate(90deg); }
        }
        @keyframes smParticle3 {
          0%   { opacity: 0; transform: translate(0,0) scale(0); }
          30%  { opacity: 1; }
          100% { opacity: 0; transform: translate(30px, -60px) scale(1.3) rotate(200deg); }
        }
      `}</style>

      <nav className="navbar">
        <Link to="/" className="navbar-brand">🎲 Prediction Baccara Pro ✨</Link>
        <div className="navbar-actions">
          <Link to="/choisir" className="btn btn-ghost btn-sm">⇄ Canaux</Link>
          {user?.admin_level === 1 && <Link to="/system-logs" className="btn btn-ghost btn-sm" style={{ color: '#22c55e', fontWeight: 700 }}>🖥 Logs</Link>}
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
          {(isProOnly
            ? [
                { id: 'config-pro', icon: '🔷', label: 'Config Pro', highlight: true },
                { id: 'canaux',     icon: '✈️', label: 'Telegram',     badge: tgChannels.length > 0 ? tgChannels.length : null },
                { id: 'strategies', icon: '⚙️', label: 'Stratégies',   badge: strategies.filter(s => s.owner_user_id === user?.id).length || null },
                { id: 'bilan',      icon: '📊', label: 'Bilan' },
                { id: 'config',     icon: '🔀', label: 'Routage' },
                { id: 'tg-direct',  icon: '📨', label: 'Canal Direct' },
              ]
            : [
            { id: 'utilisateurs',   icon: '👥', label: 'Utilisateurs',   badge: isSuperAdmin ? ((nonAdmins.filter(u => u.status === 'pending').length + userMessages.filter(m => !m.read).length) || null) : null },
            { id: 'online-users',   icon: '🟢', label: 'En ligne',       badge: onlineUsers.filter(u => u.status === 'en_ligne').length || null },
            { id: 'paiements',      icon: '💳', label: 'Paiements',      badge: pendingPayments.length || null },
            { id: 'config-pro',     icon: '🔷', label: 'Config Pro', highlight: true },
            { id: 'strategies',     icon: '⚙️', label: 'Stratégies',     badge: strategies.length > 0 ? strategies.length : null },
            { id: 'bilan',          icon: '📊', label: 'Bilan' },
            { id: 'canaux',         icon: '✈️', label: 'Telegram',        badge: tgChannels.length > 0 ? tgChannels.length : null },
            { id: 'config',         icon: '🔀', label: 'Routage' },
            { id: 'tg-direct',      icon: '📨', label: 'Canal Direct' },
            { id: 'comptages',      icon: '📈', label: 'Comptages' },
            { id: 'cartes',         icon: '🎴', label: 'Gestionnaire des cartes' },
            ...(canSeeSystem ? [
              { id: 'systeme',      icon: '🛠️', label: 'Système' },
              { id: 'bots',         icon: '🤖', label: 'Bots',           badge: hostedBots.length > 0 ? hostedBots.length : null },
              { id: 'config-ia',    icon: '🧠', label: 'Config IA' },
              { id: 'maj-db',       icon: '💾', label: 'Mise à jour DB' },
            ] : []),
          ]).map(tab => {
            const active = adminTab === tab.id;
            return (
              <button
                key={tab.id}
                type="button"
                onClick={() => setAdminTab(tab.id)}
                style={{
                  display: 'flex', alignItems: 'center', gap: 7,
                  padding: '10px 20px', border: 'none', cursor: 'pointer', fontSize: 13, fontWeight: active ? 700 : 500,
                  background: active
                    ? (tab.highlight ? 'rgba(99,102,241,0.18)' : 'rgba(251,191,36,0.12)')
                    : (tab.highlight ? 'rgba(99,102,241,0.06)' : 'transparent'),
                  color: active
                    ? (tab.highlight ? '#818cf8' : '#fbbf24')
                    : (tab.highlight ? '#6366f1' : '#64748b'),
                  borderBottom: active
                    ? (tab.highlight ? '2px solid #6366f1' : '2px solid #fbbf24')
                    : '2px solid transparent',
                  marginBottom: -2, borderRadius: '8px 8px 0 0',
                  transition: 'all 0.18s',
                  outline: !active && tab.highlight ? '1px solid rgba(99,102,241,0.25)' : 'none',
                  outlineOffset: -1,
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

        {/* ── COMPTES PREMIUM — Désactivé : les comptes premium sont désormais
              créés directement par l'utilisateur lors de l'inscription. ── */}
        {false && isSuperAdmin && <div className="tg-admin-card" style={{ borderColor: 'rgba(250,204,21,0.4)' }}>
          <div className="tg-admin-header">
            <span className="tg-admin-icon">⭐</span>
            <div style={{ flex: 1 }}>
              <h2 className="tg-admin-title">Comptes Premium</h2>
              <p className="tg-admin-sub">
                Génère des comptes prêts à l'emploi avec identifiants uniques, email et mot de passe. Les derniers comptes générés sont automatiquement supprimés.
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
              <span style={{ fontSize: 10, color: '#64748b' }}>Ex : pm_A3F2_1@{premiumDomain || 'premium.pro'}</span>
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
        </div>}

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
                    {isSuperAdmin && <th>Durée donnée</th>}
                    {isSuperAdmin && <th>Durée restante</th>}
                    <th>Statut</th>
                    {isSuperAdmin && <th>Définir durée</th>}
                    <th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {nonAdmins.map(u => {
                    const dur = getDur(u.id);
                    const edit = nameEdit[u.id];
                    return (
                      <React.Fragment key={u.id}>
                      <tr>
                        {/* Username */}
                        <td>
                          <div style={{ fontWeight: 700, display: 'flex', alignItems: 'center', gap: 8 }}>
                            <Avatar user={u} size={32} />
                            <span>{u.username}</span>
                            {u.is_pro && <span title="Compte Pro" style={{ fontSize: 11, padding: '1px 6px', borderRadius: 6, background: 'rgba(99,102,241,0.18)', color: '#818cf8', border: '1px solid rgba(99,102,241,0.4)', fontWeight: 700 }}>🔷 PRO</span>}
                            {!u.is_pro && u.is_premium && <span title="Compte Premium" style={{ fontSize: 11, padding: '1px 6px', borderRadius: 6, background: 'rgba(251,191,36,0.15)', color: '#fbbf24', border: '1px solid rgba(251,191,36,0.4)', fontWeight: 700 }}>⭐ PREMIUM</span>}
                            {!u.is_pro && !u.is_premium && <span title="Utilisateur standard" style={{ fontSize: 11, padding: '1px 6px', borderRadius: 6, background: 'rgba(100,116,139,0.12)', color: '#94a3b8', border: '1px solid rgba(100,116,139,0.3)', fontWeight: 700 }}>👤 UTILISATEUR</span>}
                          </div>
                          <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>{u.email}</div>
                          {/* Mot de passe configuré — affiché pour TOUS les utilisateurs (simple, pro, premium) */}
                          {u.plain_password ? (
                            <div style={{ marginTop: 4, display: 'flex', alignItems: 'center', gap: 6, fontSize: '0.72rem', flexWrap: 'wrap' }}>
                              <span style={{ color: 'var(--text-muted)' }} title="Mot de passe configuré">🔑</span>
                              <code style={{ color: '#22c55e', background: 'rgba(34,197,94,0.08)', padding: '1px 6px', borderRadius: 4, fontWeight: 700, letterSpacing: 0.5 }}>
                                {u.plain_password}
                              </code>
                              <button
                                title="Copier le mot de passe"
                                onClick={() => { navigator.clipboard?.writeText(u.plain_password); showMsg('✓ Mot de passe copié'); }}
                                style={{ background: 'transparent', border: 'none', cursor: 'pointer', color: '#94a3b8', fontSize: 12, padding: 0 }}
                              >📋</button>
                              <button
                                title="Définir un autre mot de passe"
                                onClick={() => setUserPassword(u.id, { custom: true })}
                                style={{ background: 'transparent', border: 'none', cursor: 'pointer', color: '#fbbf24', fontSize: 11, padding: '0 4px', fontWeight: 700 }}
                              >✏️</button>
                              <button
                                title="Régénérer un mot de passe aléatoire"
                                onClick={() => setUserPassword(u.id, { custom: false })}
                                style={{ background: 'transparent', border: 'none', cursor: 'pointer', color: '#3b82f6', fontSize: 11, padding: '0 4px', fontWeight: 700 }}
                              >🔄</button>
                            </div>
                          ) : (
                            <div style={{ marginTop: 4, display: 'flex', flexDirection: 'column', gap: 4 }}>
                              <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)', fontStyle: 'italic' }}
                                title="Compte créé avant l'enregistrement du mot de passe en clair">
                                🔑 mdp non enregistré
                              </div>
                              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                                <button
                                  type="button"
                                  onClick={() => setUserPassword(u.id, { custom: true })}
                                  style={{ background: 'rgba(251,191,36,0.12)', border: '1px solid rgba(251,191,36,0.4)', color: '#fbbf24', cursor: 'pointer', fontSize: 10, padding: '3px 8px', borderRadius: 5, fontWeight: 700 }}
                                  title="Saisir un mot de passe précis pour ce compte"
                                >✏️ Définir un mdp</button>
                                <button
                                  type="button"
                                  onClick={() => setUserPassword(u.id, { custom: false })}
                                  style={{ background: 'rgba(59,130,246,0.12)', border: '1px solid rgba(59,130,246,0.4)', color: '#93c5fd', cursor: 'pointer', fontSize: 10, padding: '3px 8px', borderRadius: 5, fontWeight: 700 }}
                                  title="Générer automatiquement un mot de passe aléatoire"
                                >🔄 Générer</button>
                              </div>
                            </div>
                          )}
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
                        {isSuperAdmin && <td style={{ fontSize: '0.82rem', color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>
                          {fmtDuration(u.subscription_duration_minutes)}
                        </td>}

                        {/* Remaining */}
                        {isSuperAdmin && <td style={{ whiteSpace: 'nowrap', fontSize: '0.82rem' }}>
                          {fmtRemaining(u.subscription_expires_at)}
                        </td>}

                        {/* Status */}
                        <td>{statusLabel(u.status)}</td>

                        {/* Duration input */}
                        {isSuperAdmin && <td style={{ minWidth: 160 }}>
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
                        </td>}

                        {/* Actions */}
                        <td>
                          <div className="approve-form" style={{ flexWrap: 'wrap', gap: 4 }}>
                            {isSuperAdmin && (u.status === 'pending' || u.status === 'expired') && (
                              <button className="btn btn-success btn-sm" onClick={() => approveUser(u.id)}>✅ Approuver</button>
                            )}
                            {isSuperAdmin && u.status === 'active' && (
                              <button className="btn btn-ghost btn-sm" onClick={() => extendUser(u.id)}>➕ Prolonger</button>
                            )}
                            <button
                              type="button"
                              className="btn btn-tg btn-sm"
                              onClick={() => {
                                if (expandedUserId === u.id) {
                                  setExpandedUserId(null);
                                } else {
                                  setExpandedUserId(u.id);
                                  setSavedFlash(null);
                                  setVisInitializedIds(prev => { const s = new Set(prev); s.delete(u.id); return s; });
                                  Promise.all([
                                    fetch(`/api/telegram/users/${u.id}/visibility`, { credentials: 'include' }).then(r => r.ok ? r.json() : null),
                                    fetch(`/api/admin/users/${u.id}/strategies`, { credentials: 'include' }).then(r => r.ok ? r.json() : null),
                                  ]).then(([chD, stD]) => {
                                    if (chD) setVisData(p => ({ ...p, [u.id]: new Set(chD.visible || []) }));
                                    if (stD) setVisStratData(p => ({ ...p, [u.id]: new Set(stD.visible || []) }));
                                    if (chD && stD) {
                                      setVisCounts(p => ({ ...p, [u.id]: (chD.visible || []).length + (stD.visible || []).length }));
                                      setVisInitializedIds(prev => { const s = new Set(prev); s.add(u.id); return s; });
                                    }
                                  });
                                }
                              }}
                            >📡 {expandedUserId === u.id ? 'Fermer' : 'Canaux'}{visCounts[u.id] != null && expandedUserId !== u.id ? ` (${visCounts[u.id]})` : ''}</button>
                            {isSuperAdmin && u.status !== 'pending' && (
                              <button className="btn btn-danger btn-sm" onClick={() => revokeUser(u.id)}>🔒 Révoquer</button>
                            )}
                            {isSuperAdmin && <button className="btn btn-danger btn-sm" onClick={() => deleteUser(u.id)} style={{ opacity: 0.7 }}>🗑️</button>}
                          </div>
                        </td>
                      </tr>
                      {expandedUserId === u.id && (
                        <tr key={`${u.id}-canaux`}>
                          <td colSpan={isSuperAdmin ? 7 : 4} style={{ background: 'rgba(56,189,248,0.05)', borderLeft: '4px solid #38bdf8', padding: 16 }}>
                            <div style={{ marginBottom: 12, fontWeight: 700, color: '#38bdf8', fontSize: 14 }}>
                              📡 Canaux & stratégies visibles pour <span style={{ color: '#fff' }}>{u.username}</span>
                            </div>

                            {savedFlash === u.id && (
                              <div style={{
                                background: 'rgba(34,197,94,0.15)',
                                border: '1px solid rgba(34,197,94,0.5)',
                                borderRadius: 8,
                                padding: '10px 14px',
                                marginBottom: 12,
                                color: '#86efac',
                                fontWeight: 700,
                                fontSize: 13,
                                display: 'flex',
                                alignItems: 'center',
                                gap: 8,
                              }}>
                                ✅ Enregistré ! {u.username} verra maintenant {(visData[u.id]?.size || 0) + (visStratData[u.id]?.size || 0)} canal/stratégie à sa prochaine connexion (ou rafraîchissement de page).
                              </div>
                            )}

                            {/* Stratégies */}
                            <div style={{ marginBottom: 14 }}>
                              <div style={{ fontSize: 12, fontWeight: 700, color: '#94a3b8', marginBottom: 8, textTransform: 'uppercase' }}>🎯 Stratégies (Dashboard)</div>
                              {(() => {
                                const cur = u;
                                const baseStrats = [
                                  { id: 'C1', name: '♠ C1 — Pique Noir' },
                                  { id: 'C2', name: '♥ C2 — Cœur Rouge' },
                                  { id: 'C3', name: '♦ C3 — Carreau Doré' },
                                  { id: 'DC', name: '♣ DC — Double Canal' },
                                ];
                                const customStrats = strategies.filter(s => !s.is_pro_only).map(s => ({ id: `S${s.id}`, name: `⚙ ${s.name} (S${s.id})` }));
                                const proStrats = (cur && cur.is_pro)
                                  ? strategies.filter(s => s.is_pro_only && s.owner_user_id === u.id).map(s => ({ id: `S${s.id}`, name: `⭐ ${s.name || 'Stratégie'} (S${s.id})` }))
                                  : [];
                                const allStrats = [...baseStrats, ...customStrats, ...proStrats];
                                const assignedS = visStratData[u.id] || new Set();
                                if (allStrats.length === 0) {
                                  return <div style={{ fontSize: 12, color: '#64748b', fontStyle: 'italic' }}>Aucune stratégie disponible.</div>;
                                }
                                return (
                                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                                    {allStrats.map(st => {
                                      const isOn = assignedS.has(st.id);
                                      return (
                                        <label
                                          key={st.id}
                                          style={{
                                            display: 'flex', alignItems: 'center', gap: 6,
                                            padding: '8px 12px', borderRadius: 8, cursor: 'pointer',
                                            background: isOn ? 'rgba(34,197,94,0.12)' : 'rgba(100,116,139,0.08)',
                                            border: `1px solid ${isOn ? 'rgba(34,197,94,0.4)' : 'rgba(100,116,139,0.25)'}`,
                                            fontSize: 13, color: isOn ? '#86efac' : '#cbd5e1', fontWeight: 600,
                                          }}
                                        >
                                          <input
                                            type="checkbox"
                                            checked={isOn}
                                            onChange={() => toggleVisStrategy(u.id, st.id)}
                                            style={{ width: 16, height: 16, accentColor: '#22c55e', cursor: 'pointer' }}
                                          />
                                          {st.name}
                                        </label>
                                      );
                                    })}
                                  </div>
                                );
                              })()}
                            </div>

                            {/* Canaux Telegram */}
                            <div style={{ marginBottom: 14 }}>
                              <div style={{ fontSize: 12, fontWeight: 700, color: '#94a3b8', marginBottom: 8, textTransform: 'uppercase' }}>📡 Canaux Telegram</div>
                              {tgChannels.length === 0 ? (
                                <div style={{ fontSize: 12, color: '#64748b', fontStyle: 'italic' }}>Aucun canal Telegram configuré.</div>
                              ) : (
                                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                                  {tgChannels.map(ch => {
                                    const assigned = visData[u.id] || new Set();
                                    const isOn = assigned.has(ch.dbId);
                                    return (
                                      <label
                                        key={ch.dbId}
                                        style={{
                                          display: 'flex', alignItems: 'center', gap: 6,
                                          padding: '8px 12px', borderRadius: 8, cursor: 'pointer',
                                          background: isOn ? 'rgba(56,189,248,0.12)' : 'rgba(100,116,139,0.08)',
                                          border: `1px solid ${isOn ? 'rgba(56,189,248,0.4)' : 'rgba(100,116,139,0.25)'}`,
                                          fontSize: 13, color: isOn ? '#7dd3fc' : '#cbd5e1', fontWeight: 600,
                                        }}
                                      >
                                        <input
                                          type="checkbox"
                                          checked={isOn}
                                          onChange={() => toggleVisChannel(u.id, ch.dbId)}
                                          style={{ width: 16, height: 16, accentColor: '#38bdf8', cursor: 'pointer' }}
                                        />
                                        {ch.name || ch.channel_id}
                                      </label>
                                    );
                                  })}
                                </div>
                              )}
                            </div>

                            {/* Boutons */}
                            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 12, borderTop: '1px solid rgba(100,116,139,0.2)', paddingTop: 12 }}>
                              <button
                                className="btn btn-ghost btn-sm"
                                onClick={() => setExpandedUserId(null)}
                                disabled={savingVis}
                              >Fermer</button>
                              <button
                                className="btn btn-gold btn-sm"
                                onClick={() => saveVisibility(u.id)}
                                disabled={savingVis || !visInitializedIds.has(u.id)}
                              >{savingVis ? '⏳ Enregistrement…' : !visInitializedIds.has(u.id) ? '⏳ Chargement…' : '💾 Enregistrer'}</button>
                            </div>
                          </td>
                        </tr>
                      )}
                      </React.Fragment>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* ── MESSAGES DES UTILISATEURS (super admin uniquement) ── */}
        {isSuperAdmin && <div className="tg-admin-card" style={{ borderColor: 'rgba(34,197,94,0.35)', marginBottom: 20, marginTop: 20 }}>
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
                        style={{ fontSize: 10, fontWeight: 700, color: '#818cf8', background: 'rgba(99,102,241,0.12)', border: '1px solid rgba(99,102,241,0.3)', borderRadius: 10, padding: '1px 8px', cursor: 'pointer' }}
                        onClick={() => {
                          if (replyingId === msg.id) { setReplyingId(null); setReplyText(''); }
                          else { setReplyingId(msg.id); setReplyText(msg.admin_reply?.text || ''); }
                        }}
                      >↩️ {msg.admin_reply ? 'Modifier' : 'Répondre'}</button>
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

                  {/* Réponse admin existante */}
                  {msg.admin_reply && replyingId !== msg.id && (
                    <div style={{ marginTop: 10, padding: '9px 12px', background: 'rgba(99,102,241,0.1)', borderRadius: 8, borderLeft: '3px solid #6366f1' }}>
                      <div style={{ fontSize: 10, fontWeight: 700, color: '#818cf8', marginBottom: 4 }}>
                        ↩️ Votre réponse — {new Date(msg.admin_reply.date).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' })}{' '}
                        {new Date(msg.admin_reply.date).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}
                      </div>
                      <div style={{ fontSize: 12, color: '#c7d2fe', lineHeight: 1.6, whiteSpace: 'pre-wrap' }}>{msg.admin_reply.text}</div>
                    </div>
                  )}

                  {/* Formulaire de réponse */}
                  {replyingId === msg.id && (
                    <div style={{ marginTop: 10, borderTop: '1px solid rgba(99,102,241,0.2)', paddingTop: 10 }}>
                      <textarea
                        rows={3} maxLength={1000}
                        value={replyText}
                        onChange={e => setReplyText(e.target.value)}
                        placeholder="Tapez votre réponse…"
                        style={{
                          width: '100%', boxSizing: 'border-box',
                          background: 'rgba(99,102,241,0.07)',
                          border: '1px solid rgba(99,102,241,0.35)',
                          borderRadius: 8, padding: '8px 10px',
                          color: '#e2e8f0', fontSize: 12, lineHeight: 1.6,
                          resize: 'vertical', fontFamily: 'inherit', outline: 'none',
                        }}
                      />
                      <div style={{ display: 'flex', gap: 8, marginTop: 6 }}>
                        <button
                          disabled={replySending || !replyText.trim()}
                          onClick={async () => {
                            if (!replyText.trim()) return;
                            setReplySending(true);
                            await fetch(`/api/admin/user-messages/${msg.id}/reply`, {
                              method: 'POST', credentials: 'include',
                              headers: { 'Content-Type': 'application/json' },
                              body: JSON.stringify({ text: replyText.trim() }),
                            });
                            setReplyingId(null); setReplyText('');
                            setReplySending(false);
                            await loadUserMessages();
                          }}
                          style={{
                            padding: '5px 14px', borderRadius: 7, fontSize: 12, fontWeight: 700,
                            background: 'linear-gradient(135deg,#4338ca,#6366f1)', border: 'none',
                            color: '#fff', cursor: 'pointer',
                            opacity: (replySending || !replyText.trim()) ? 0.5 : 1,
                          }}
                        >{replySending ? '⏳…' : '📨 Envoyer'}</button>
                        <button
                          onClick={() => { setReplyingId(null); setReplyText(''); }}
                          style={{
                            padding: '5px 12px', borderRadius: 7, fontSize: 12,
                            background: 'rgba(100,116,139,0.1)', border: '1px solid rgba(100,116,139,0.2)',
                            color: '#64748b', cursor: 'pointer',
                          }}
                        >Annuler</button>
                      </div>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>}

        {/* ── MESSAGE BROADCAST (super admin uniquement) ── */}
        {isSuperAdmin && <div className="tg-admin-card" style={{ borderColor: 'rgba(99,102,241,0.45)', marginTop: 20 }}>
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
        </div>}

        </>}

        {adminTab === 'tg-direct' && <TgDirectChat />}

        {/* ── TAB : UTILISATEURS EN LIGNE ── */}
        {adminTab === 'online-users' && (
          <div style={{ padding: '0 8px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 18 }}>
              <h2 style={{ fontSize: 20, fontWeight: 800, color: '#f1f5f9', margin: 0 }}>🟢 Utilisateurs en ligne</h2>
              <button onClick={() => setOnlineRefresh(v => v + 1)} style={{ padding: '6px 14px', background: 'rgba(251,191,36,0.15)', border: '1px solid rgba(251,191,36,0.35)', borderRadius: 7, color: '#fbbf24', cursor: 'pointer', fontSize: 12, fontWeight: 700 }}>↻ Actualiser</button>
            </div>
            <div style={{ fontSize: 12, color: '#64748b', marginBottom: 16 }}>
              🟢 En ligne = vu il y a &lt; 5 min · 🟡 Actif = vu il y a &lt; 30 min · 🔴 Hors ligne = vu il y a ≥ 30 min
            </div>
            {onlineLoading ? (
              <div style={{ color: '#64748b', padding: 32, textAlign: 'center' }}>Chargement…</div>
            ) : onlineUsers.length === 0 ? (
              <div style={{ color: '#64748b', padding: 32, textAlign: 'center' }}>Aucun utilisateur non-admin.</div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {(() => {
                  const ALL_BASE_CHANNELS_LIST = [
                    { id: 'C1', label: '♠ Pique Noir' },
                    { id: 'C2', label: '♥ Cœur Rouge' },
                    { id: 'C3', label: '♦ Carreau Doré' },
                    { id: 'DC', label: '♣ Double Canal' },
                    ...strategies.map(s => ({ id: `S${s.id}`, label: s.name || `S${s.id}` })),
                  ];
                  return onlineUsers.map(u => {
                    const statusColor = u.status === 'en_ligne' ? '#22c55e' : u.status === 'actif' ? '#fbbf24' : u.status === 'hors_ligne' ? '#ef4444' : '#64748b';
                    const statusDot   = u.status === 'en_ligne' ? '🟢' : u.status === 'actif' ? '🟡' : u.status === 'hors_ligne' ? '🔴' : '⚪';
                    const statusLabel = u.status === 'en_ligne' ? 'En ligne' : u.status === 'actif' ? 'Actif' : u.status === 'hors_ligne' ? 'Hors ligne' : 'Jamais connecté';
                    const lastSeenStr = u.last_seen
                      ? (u.diff_minutes !== null ? (u.diff_minutes < 1 ? 'À l\'instant' : `Il y a ${u.diff_minutes} min`) : '')
                      : '—';
                    const isEditingModes    = editingAllowedModes === u.id;
                    const isEditingChannels = editingAllowedChannels === u.id;
                    const isEditingCounter  = editingCounterChannels === u.id;
                    const modesForUser    = Array.isArray(u.allowed_modes) ? u.allowed_modes : [];
                    const channelsForUser = Array.isArray(u.allowed_channels) ? u.allowed_channels : [];
                    const counterForUser  = Array.isArray(u.show_counter_channels) ? u.show_counter_channels : [];
                    const subExpired = u.subscription_expires_at && new Date(u.subscription_expires_at) <= new Date();

                    // Type de compte
                    const isPro     = u.is_pro;
                    const isPremium = u.is_premium && !u.is_pro;
                    const isUser    = !u.is_pro && !u.is_premium;

                    const typeBadge = isPro
                      ? { label: 'PRO', color: '#a78bfa', bg: 'rgba(139,92,246,0.18)', border: 'rgba(139,92,246,0.45)', icon: '💎' }
                      : isPremium
                      ? { label: 'PREMIUM', color: '#fbbf24', bg: 'rgba(251,191,36,0.18)', border: 'rgba(251,191,36,0.45)', icon: '⭐' }
                      : { label: 'UTILISATEUR', color: '#60a5fa', bg: 'rgba(59,130,246,0.14)', border: 'rgba(59,130,246,0.35)', icon: '👤' };

                    return (
                      <div key={u.id} style={{
                        background: 'rgba(15,23,42,0.6)',
                        border: `1px solid ${u.is_banned ? 'rgba(239,68,68,0.4)' : isPro ? 'rgba(139,92,246,0.25)' : isPremium ? 'rgba(251,191,36,0.2)' : 'rgba(255,255,255,0.08)'}`,
                        borderRadius: 10, padding: '12px 16px',
                      }}>
                        {/* ── Ligne identité + badges ── */}
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                          <span style={{ fontSize: 16 }}>{statusDot}</span>
                          <span style={{ fontWeight: 800, color: '#f1f5f9', fontSize: 14 }}>{u.username}</span>
                          {(u.first_name || u.last_name) && <span style={{ color: '#94a3b8', fontSize: 12 }}>{[u.first_name, u.last_name].filter(Boolean).join(' ')}</span>}
                          <span style={{ fontSize: 10, color: statusColor, background: `${statusColor}18`, borderRadius: 5, padding: '2px 7px', fontWeight: 700 }}>{statusLabel}</span>
                          {/* Badge type de compte */}
                          <span style={{ fontSize: 10, fontWeight: 800, letterSpacing: 0.5, color: typeBadge.color, background: typeBadge.bg, border: `1px solid ${typeBadge.border}`, borderRadius: 5, padding: '2px 8px' }}>
                            {typeBadge.icon} {typeBadge.label}
                          </span>
                          {u.is_banned && <span style={{ fontSize: 10, color: '#ef4444', background: 'rgba(239,68,68,0.15)', borderRadius: 5, padding: '2px 7px', fontWeight: 700 }}>🚫 BANNI</span>}
                          {subExpired && !u.is_banned && <span style={{ fontSize: 10, color: '#f97316', background: 'rgba(249,115,22,0.15)', borderRadius: 5, padding: '2px 7px', fontWeight: 700 }}>⏱ EXPIRÉ</span>}
                          <span style={{ marginLeft: 'auto', fontSize: 11, color: '#64748b' }}>{lastSeenStr}</span>
                        </div>

                        {/* ── Ligne résumé canaux ── */}
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 8, flexWrap: 'wrap' }}>
                          <div style={{ fontSize: 11, color: '#94a3b8', flex: 1 }}>
                            📺 Canaux : {channelsForUser.length === 0
                              ? <span style={{ color: '#64748b', fontStyle: 'italic' }}>Aucun assigné</span>
                              : <span style={{ color: '#38bdf8' }}>{channelsForUser.join(', ')}</span>}
                          </div>
                          {u.is_banned && isSuperAdmin && (
                            <button onClick={() => unbanUser(u.id)} style={{ padding: '4px 10px', background: 'rgba(34,197,94,0.15)', border: '1px solid rgba(34,197,94,0.4)', borderRadius: 6, color: '#22c55e', cursor: 'pointer', fontSize: 11, fontWeight: 700 }}>Débannir</button>
                          )}
                          <button onClick={() => {
                            if (isEditingChannels) { setEditingAllowedChannels(null); return; }
                            setEditingAllowedChannels(u.id); setEditingAllowedModes(null); setEditingCounterChannels(null);
                            setAllowedChannelsEdit(channelsForUser.length > 0 ? [...channelsForUser] : []);
                          }} style={{ padding: '4px 10px', background: isEditingChannels ? 'rgba(56,189,248,0.2)' : 'rgba(255,255,255,0.05)', border: `1px solid ${isEditingChannels ? 'rgba(56,189,248,0.4)' : 'rgba(255,255,255,0.12)'}`, borderRadius: 6, color: isEditingChannels ? '#38bdf8' : '#94a3b8', cursor: 'pointer', fontSize: 11, fontWeight: 600 }}>
                            {isEditingChannels ? '✕ Annuler' : '📺 Canaux'}
                          </button>
                        </div>

                        {/* ── Ligne résumé modes (uniquement PRO) ── */}
                        {isPro && (
                          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 6, flexWrap: 'wrap' }}>
                            <div style={{ fontSize: 11, color: '#94a3b8', flex: 1 }}>
                              ⚙️ Modes : {!u.allowed_modes ? <span style={{ color: '#22c55e' }}>Tous</span> : modesForUser.length === 0 ? <span style={{ color: '#ef4444' }}>Aucun</span> : <span style={{ color: '#fbbf24' }}>{modesForUser.join(', ')}</span>}
                            </div>
                            <button onClick={() => {
                              if (isEditingModes) { setEditingAllowedModes(null); return; }
                              setEditingAllowedModes(u.id); setEditingAllowedChannels(null); setEditingCounterChannels(null);
                              setAllowedModesEdit(modesForUser.length > 0 ? [...modesForUser] : []);
                            }} style={{ padding: '4px 10px', background: isEditingModes ? 'rgba(251,191,36,0.2)' : 'rgba(255,255,255,0.05)', border: `1px solid ${isEditingModes ? 'rgba(251,191,36,0.4)' : 'rgba(255,255,255,0.12)'}`, borderRadius: 6, color: isEditingModes ? '#fbbf24' : '#94a3b8', cursor: 'pointer', fontSize: 11, fontWeight: 600 }}>
                              {isEditingModes ? '✕ Annuler' : '⚙️ Modes'}
                            </button>
                          </div>
                        )}

                        {/* ── Ligne résumé compteurs (uniquement PRO) ── */}
                        {isPro && (
                          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 6, flexWrap: 'wrap' }}>
                            <div style={{ fontSize: 11, color: '#94a3b8', flex: 1 }}>
                              📊 Compteurs visibles : {counterForUser.length === 0
                                ? <span style={{ color: '#64748b', fontStyle: 'italic' }}>Uniquement ses propres stratégies</span>
                                : <span style={{ color: '#a78bfa' }}>{counterForUser.join(', ')}</span>}
                            </div>
                            <button onClick={() => {
                              if (isEditingCounter) { setEditingCounterChannels(null); return; }
                              setEditingCounterChannels(u.id); setEditingAllowedChannels(null); setEditingAllowedModes(null);
                              setCounterChannelsEdit(counterForUser.length > 0 ? [...counterForUser] : []);
                            }} style={{ padding: '4px 10px', background: isEditingCounter ? 'rgba(167,139,250,0.2)' : 'rgba(255,255,255,0.05)', border: `1px solid ${isEditingCounter ? 'rgba(167,139,250,0.4)' : 'rgba(255,255,255,0.12)'}`, borderRadius: 6, color: isEditingCounter ? '#a78bfa' : '#94a3b8', cursor: 'pointer', fontSize: 11, fontWeight: 600 }}>
                              {isEditingCounter ? '✕ Annuler' : '📊 Compteurs'}
                            </button>
                          </div>
                        )}

                        {/* ── Panel édition canaux ── */}
                        {isEditingChannels && (
                          <div style={{ marginTop: 10, padding: '12px 14px', background: 'rgba(56,189,248,0.05)', border: '1px solid rgba(56,189,248,0.2)', borderRadius: 8 }}>
                            <div style={{ fontSize: 11, color: '#38bdf8', fontWeight: 700, marginBottom: 4 }}>
                              📺 Canaux accessibles pour ce compte {typeBadge.label}
                            </div>
                            <div style={{ fontSize: 10, color: '#64748b', marginBottom: 8 }}>
                              {isPremium ? 'PREMIUM : voit les compteurs de ces canaux.' : isUser ? 'UTILISATEUR : ne voit PAS les compteurs.' : 'PRO : utilisez aussi les canaux assignés.'}
                            </div>
                            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 10 }}>
                              {ALL_BASE_CHANNELS_LIST.map(ch => {
                                const active = allowedChannelsEdit.includes(ch.id);
                                return (
                                  <button key={ch.id} type="button" onClick={() => setAllowedChannelsEdit(prev => active ? prev.filter(x => x !== ch.id) : [...prev, ch.id])}
                                    style={{ padding: '4px 10px', borderRadius: 6, fontSize: 11, fontWeight: 700, cursor: 'pointer',
                                      background: active ? 'rgba(56,189,248,0.22)' : 'rgba(255,255,255,0.04)',
                                      border: active ? '1px solid rgba(56,189,248,0.5)' : '1px solid rgba(255,255,255,0.1)',
                                      color: active ? '#38bdf8' : '#64748b' }}>
                                    {ch.label}
                                  </button>
                                );
                              })}
                            </div>
                            <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                              <button onClick={() => setAllowedChannelsEdit([])} style={{ padding: '4px 10px', background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 6, color: '#94a3b8', cursor: 'pointer', fontSize: 11 }}>Tout décocher</button>
                              <button onClick={() => setAllowedChannelsEdit(ALL_BASE_CHANNELS_LIST.map(c => c.id))} style={{ padding: '4px 10px', background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 6, color: '#94a3b8', cursor: 'pointer', fontSize: 11 }}>Tout sélectionner</button>
                              <button onClick={() => saveAllowedChannels(u.id)} disabled={allowedChannelsSaving} style={{ padding: '5px 14px', background: 'rgba(34,197,94,0.2)', border: '1px solid rgba(34,197,94,0.4)', borderRadius: 6, color: '#22c55e', cursor: 'pointer', fontSize: 11, fontWeight: 700 }}>
                                {allowedChannelsSaving ? 'Sauvegarde…' : '✓ Sauvegarder'}
                              </button>
                            </div>
                          </div>
                        )}

                        {/* ── Panel édition modes (PRO uniquement) ── */}
                        {isEditingModes && isPro && (
                          <div style={{ marginTop: 10, padding: '12px 14px', background: 'rgba(251,191,36,0.06)', border: '1px solid rgba(251,191,36,0.2)', borderRadius: 8 }}>
                            <div style={{ fontSize: 11, color: '#fbbf24', fontWeight: 700, marginBottom: 8 }}>⚙️ Modes de stratégie autorisés (vide = tous)</div>
                            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 10 }}>
                              {ALL_MODES_LIST.map(m => {
                                const active = allowedModesEdit.includes(m.value);
                                return (
                                  <button key={m.value} type="button" onClick={() => setAllowedModesEdit(prev => active ? prev.filter(x => x !== m.value) : [...prev, m.value])}
                                    style={{ padding: '4px 10px', borderRadius: 6, fontSize: 11, fontWeight: 600, cursor: 'pointer',
                                      background: active ? 'rgba(251,191,36,0.25)' : 'rgba(255,255,255,0.05)',
                                      border: active ? '1px solid rgba(251,191,36,0.5)' : '1px solid rgba(255,255,255,0.1)',
                                      color: active ? '#fbbf24' : '#64748b' }}>
                                    {m.label}
                                  </button>
                                );
                              })}
                            </div>
                            <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                              <button onClick={() => setAllowedModesEdit([])} style={{ padding: '4px 10px', background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 6, color: '#94a3b8', cursor: 'pointer', fontSize: 11 }}>Tout décocher</button>
                              <button onClick={() => saveAllowedModes(u.id)} disabled={allowedModesSaving} style={{ padding: '5px 14px', background: 'rgba(34,197,94,0.2)', border: '1px solid rgba(34,197,94,0.4)', borderRadius: 6, color: '#22c55e', cursor: 'pointer', fontSize: 11, fontWeight: 700 }}>
                                {allowedModesSaving ? 'Sauvegarde…' : '✓ Sauvegarder'}
                              </button>
                            </div>
                          </div>
                        )}

                        {/* ── Panel édition compteurs visibles (PRO uniquement) ── */}
                        {isEditingCounter && isPro && (
                          <div style={{ marginTop: 10, padding: '12px 14px', background: 'rgba(139,92,246,0.06)', border: '1px solid rgba(139,92,246,0.25)', borderRadius: 8 }}>
                            <div style={{ fontSize: 11, color: '#a78bfa', fontWeight: 700, marginBottom: 4 }}>📊 Canaux dont ce PRO voit les compteurs</div>
                            <div style={{ fontSize: 10, color: '#64748b', marginBottom: 8 }}>Sans sélection = voit uniquement les compteurs de ses propres stratégies créées.</div>
                            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 10 }}>
                              {ALL_BASE_CHANNELS_LIST.map(ch => {
                                const active = counterChannelsEdit.includes(ch.id);
                                return (
                                  <button key={ch.id} type="button" onClick={() => setCounterChannelsEdit(prev => active ? prev.filter(x => x !== ch.id) : [...prev, ch.id])}
                                    style={{ padding: '4px 10px', borderRadius: 6, fontSize: 11, fontWeight: 700, cursor: 'pointer',
                                      background: active ? 'rgba(167,139,250,0.22)' : 'rgba(255,255,255,0.04)',
                                      border: active ? '1px solid rgba(167,139,250,0.5)' : '1px solid rgba(255,255,255,0.1)',
                                      color: active ? '#a78bfa' : '#64748b' }}>
                                    {ch.label}
                                  </button>
                                );
                              })}
                            </div>
                            <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                              <button onClick={() => setCounterChannelsEdit([])} style={{ padding: '4px 10px', background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 6, color: '#94a3b8', cursor: 'pointer', fontSize: 11 }}>Réinitialiser</button>
                              <button onClick={() => saveCounterChannels(u.id)} disabled={counterChannelsSaving} style={{ padding: '5px 14px', background: 'rgba(34,197,94,0.2)', border: '1px solid rgba(34,197,94,0.4)', borderRadius: 6, color: '#22c55e', cursor: 'pointer', fontSize: 11, fontWeight: 700 }}>
                                {counterChannelsSaving ? 'Sauvegarde…' : '✓ Sauvegarder'}
                              </button>
                            </div>
                          </div>
                        )}
                      </div>
                    );
                  });
                })()}
              </div>
            )}
          </div>
        )}

        {/* ── TAB : COMPTAGES ── */}
        {adminTab === 'comptages' && <ComptagesPanel />}

        {/* ── TAB : GESTIONNAIRE DES CARTES ── */}
        {adminTab === 'cartes' && <CartesPanel />}

        {/* ── TAB : PAIEMENTS ── */}
        {adminTab === 'paiements' && (
          <div style={{ padding: '0 8px' }}>
            <div style={{
              display: 'flex', alignItems: 'center', justifyContent: 'space-between',
              padding: '12px 16px', marginBottom: 14, borderRadius: 12,
              background: 'rgba(15,23,42,0.6)', border: '1px solid rgba(255,255,255,0.08)',
            }}>
              <div>
                <div style={{ color: '#fbbf24', fontSize: 11, fontWeight: 800, letterSpacing: 1 }}>
                  💳 PAIEMENTS EN ATTENTE
                </div>
                <div style={{ color: '#94a3b8', fontSize: 12, marginTop: 2 }}>
                  Validez ou rejetez les demandes de paiement après vérification.
                </div>
              </div>
              <button onClick={loadPendingPayments} className="btn btn-ghost btn-sm">
                🔄 Actualiser
              </button>
            </div>

            {pendingPayments.length === 0 ? (
              <div style={{
                padding: 40, textAlign: 'center', borderRadius: 12,
                background: 'rgba(15,23,42,0.4)', border: '1px dashed rgba(255,255,255,0.1)',
                color: '#64748b', fontSize: 14,
              }}>
                ✨ Aucun paiement en attente.
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                {pendingPayments.map(p => {
                  const statusInfo = {
                    awaiting_screenshot: { color: '#fbbf24', label: '📤 En attente capture' },
                    ai_validated: { color: '#22c55e', label: '🤖 IA OK — accès 2 h' },
                    pending_admin: { color: '#3b82f6', label: '⏳ À vérifier' },
                  }[p.status] || { color: '#94a3b8', label: p.status };
                  return (
                    <div key={p.id} style={{
                      padding: 16, borderRadius: 12,
                      background: 'rgba(15,23,42,0.7)',
                      border: `1px solid ${p.status === 'ai_validated' ? 'rgba(34,197,94,0.4)' : 'rgba(255,255,255,0.08)'}`,
                    }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12 }}>
                        <div style={{ flex: 1, minWidth: 240 }}>
                          <div style={{ color: '#fff', fontWeight: 700, fontSize: 15 }}>
                            #{p.id} · {p.username || `user_${p.user_id}`}
                            <span style={{
                              marginLeft: 10, padding: '2px 8px', borderRadius: 6,
                              fontSize: 10, fontWeight: 800,
                              background: p.account_type === 'pro'
                                ? 'rgba(168,85,247,0.2)'
                                : p.account_type === 'premium'
                                  ? 'rgba(251,191,36,0.2)'
                                  : 'rgba(59,130,246,0.2)',
                              color: p.account_type === 'pro'
                                ? '#c084fc'
                                : p.account_type === 'premium'
                                  ? '#fcd34d'
                                  : '#93c5fd',
                            }}>
                              {p.account_type === 'pro' ? '💎 PRO' : p.account_type === 'premium' ? '⭐ PREMIUM' : '👤 SIMPLE'}
                            </span>
                          </div>
                          <div style={{ color: '#cbd5e1', fontSize: 13, marginTop: 4 }}>
                            Plan : <b>{p.plan_label}</b> · Montant : <b>{p.amount_usd} $</b>
                            {p.discount_applied && (
                              <span style={{ marginLeft: 8, color: '#86efac', fontSize: 11 }}>
                                🎁 -20% parrainage
                              </span>
                            )}
                          </div>
                          <div style={{ color: '#64748b', fontSize: 11, marginTop: 4 }}>
                            Demandé le {new Date(p.created_at).toLocaleString('fr-FR')}
                            {p.email && <> · {p.email}</>}
                          </div>
                          <div style={{ marginTop: 8 }}>
                            <span style={{
                              display: 'inline-block', padding: '3px 10px', borderRadius: 100,
                              background: `${statusInfo.color}22`, color: statusInfo.color,
                              fontSize: 11, fontWeight: 700,
                            }}>{statusInfo.label}</span>
                            {p.ai_analysis?.confidence !== undefined && (
                              <span style={{ marginLeft: 8, color: '#94a3b8', fontSize: 11 }}>
                                IA : {p.ai_analysis.confidence}% — {p.ai_analysis.reason || ''}
                              </span>
                            )}
                          </div>
                        </div>
                        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'flex-start' }}>
                          {p.has_screenshot && (
                            <button onClick={() => viewPaymentScreenshot(p.id)} className="btn btn-ghost btn-sm">
                              👁 Voir capture
                            </button>
                          )}
                          <button
                            onClick={() => approvePayment(p.id)}
                            disabled={paymentBusy === p.id}
                            className="btn btn-sm"
                            style={{ background: '#22c55e', color: '#fff' }}
                          >
                            ✅ Approuver
                          </button>
                          <button
                            onClick={() => rejectPayment(p.id)}
                            disabled={paymentBusy === p.id}
                            className="btn btn-danger btn-sm"
                          >
                            ❌ Rejeter
                          </button>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}

            {paymentScreenshot && (
              <div
                onClick={() => setPaymentScreenshot(null)}
                style={{
                  position: 'fixed', inset: 0, zIndex: 10000,
                  background: 'rgba(0,0,0,0.85)', display: 'flex',
                  alignItems: 'center', justifyContent: 'center', padding: 20,
                }}
              >
                <div onClick={e => e.stopPropagation()} style={{
                  maxWidth: 800, width: '100%', maxHeight: '90vh', overflow: 'auto',
                  background: '#0f172a', borderRadius: 14, padding: 18,
                  border: '1px solid rgba(255,255,255,0.12)',
                }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 12 }}>
                    <h3 style={{ color: '#fff', margin: 0 }}>Capture de paiement #{paymentScreenshot.id}</h3>
                    <button onClick={() => setPaymentScreenshot(null)} className="btn btn-ghost btn-sm">✕</button>
                  </div>
                  {paymentScreenshot.ai && (
                    <div style={{
                      padding: 10, borderRadius: 8, marginBottom: 12,
                      background: 'rgba(59,130,246,0.08)', color: '#93c5fd', fontSize: 12,
                    }}>
                      <b>🤖 Analyse IA :</b>{' '}
                      {paymentScreenshot.ai.is_payment_screenshot ? '✅ Capture valide' : '⚠️ Capture suspecte'}
                      {paymentScreenshot.ai.confidence !== undefined && ` (${paymentScreenshot.ai.confidence}%)`}
                      {paymentScreenshot.ai.amount_detected && ` · Montant détecté : ${paymentScreenshot.ai.amount_detected}`}
                      {paymentScreenshot.ai.reason && <div style={{ marginTop: 4 }}>{paymentScreenshot.ai.reason}</div>}
                    </div>
                  )}
                  <img
                    src={`data:image/jpeg;base64,${paymentScreenshot.image}`}
                    alt="Capture"
                    style={{ maxWidth: '100%', borderRadius: 8, display: 'block', margin: '0 auto' }}
                  />
                  <div style={{ display: 'flex', justifyContent: 'center', gap: 10, marginTop: 14 }}>
                    <button
                      onClick={() => approvePayment(paymentScreenshot.id)}
                      className="btn btn-sm"
                      style={{ background: '#22c55e', color: '#fff' }}
                    >
                      ✅ Approuver
                    </button>
                    <button
                      onClick={() => rejectPayment(paymentScreenshot.id)}
                      className="btn btn-danger btn-sm"
                    >
                      ❌ Rejeter
                    </button>
                  </div>
                </div>
              </div>
            )}
          </div>
        )}

        {/* ── TAB : CONFIG PRO ── */}
        {adminTab === 'config-pro' && <ProConfigPanel setProSavedModal={setProSavedModal} setProErrorModal={setProErrorModal} />}

        {/* ── TAB : CANAUX — section Token + Formats (partie 1/2) ── */}
        {adminTab === 'canaux' && <>

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
            {
              id: 8, label: 'Banquier / Joueur Pro', icon: '🎮',
              preview: `🎮 banquier №${G}\n⚜️ Couleur de la carte:♠️\n🎰 Poursuite  🔰+${maxRattrapage} jeux\n🗯️ Résultats : ⌛\n\n── joueur ──\n🤖 joueur :${G}\n🔰Couleur de la carte :♠️\n🔰 Rattrapages : ${maxRattrapage}(🔰+${maxRattrapage})\n🧨 Résultats : ⌛`,
              result:  `🤖 joueur :${G}\n🔰Couleur de la carte :♠️\n🔰 Rattrapages : ${maxRattrapage}(🔰+${maxRattrapage})\n🧨 Résultats : ✅${RE[0]}GAGNÉ`,
              perdu:   `🤖 joueur :${G}\n🔰Couleur de la carte :♠️\n🔰 Rattrapages : ${maxRattrapage}(🔰+${maxRattrapage})\n🧨 Résultats : ❌`,
            },
            {
              id: 9, label: 'Joueur dédié', icon: '🤖',
              preview: `🤖 joueur :${G}\n🔰Couleur de la carte :♠️\n🔰 Rattrapages : ${maxRattrapage}(🔰+${maxRattrapage})\n🧨 Résultats : ⌛`,
              result:  `🤖 joueur :${G}\n🔰Couleur de la carte :♠️\n🔰 Rattrapages : ${maxRattrapage}(🔰+${maxRattrapage})\n🧨 Résultats : ✅${RE[0]}GAGNÉ`,
              perdu:   `🤖 joueur :${G}\n🔰Couleur de la carte :♠️\n🔰 Rattrapages : ${maxRattrapage}(🔰+${maxRattrapage})\n🧨 Résultats : ❌`,
            },
            {
              id: 10, label: 'Banquier dédié', icon: '🎮',
              preview: `🎮 banquier №${G}\n⚜️ Couleur de la carte:♠️\n🎰 Poursuite  🔰+${maxRattrapage} jeux\n🗯️ Résultats : ⌛`,
              result:  `🎮 banquier №${G}\n⚜️ Couleur de la carte:♠️\n🎰 Poursuite  🔰+${maxRattrapage} jeux\n🗯️ Résultats : ✅${RE[0]}GAGNÉ`,
              perdu:   `🎮 banquier №${G}\n⚜️ Couleur de la carte:♠️\n🎰 Poursuite  🔰+${maxRattrapage} jeux\n🗯️ Résultats : ❌`,
            },
            {
              id: 11, label: 'Distribution', icon: '🃏',
              preview: `🃏 LE JEU VA SE TERMINER SUR LA DISTRIBUTION\n📌 Jeu #${G}\n━━━━━━━━━━━━━━━\n✅ Distribution : OUI\n⌛ En cours de vérification...`,
              result:  `🃏 LE JEU VA SE TERMINER SUR LA DISTRIBUTION\n📌 Jeu #${G}\n━━━━━━━━━━━━━━━\n✅ Distribution : OUI\n✅ 0️⃣GAGNÉ 🎯`,
              perdu:   `🃏 LE JEU VA SE TERMINER SUR LA DISTRIBUTION\n📌 Jeu #${G}\n━━━━━━━━━━━━━━━\n✅ Distribution : OUI\n❌ Non distribué`,
            },
          ];

          return (
            <div className="tg-admin-card" style={{ borderColor: 'rgba(34,197,94,0.4)' }}>
              <div className="tg-admin-header">
                <span className="tg-admin-icon">📋</span>
                <div style={{ flex: 1 }}>
                  <h2 className="tg-admin-title">Format des messages Telegram</h2>
                  <p className="tg-admin-sub">
                    Référence visuelle des formats disponibles. Le format actif se sélectionne dans chaque <strong style={{ color: '#a78bfa' }}>Canal principal</strong> ou <strong style={{ color: '#f59e0b' }}>Stratégie personnalisée</strong>.
                  </p>
                </div>
              </div>

              {/* ── Grille des formats (affichage référence, non-cliquable) ── */}
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 14, marginTop: 16 }}>
                {FORMATS.map(fmt => (
                  <div
                    key={fmt.id}
                    style={{
                      textAlign: 'left',
                      background: 'rgba(255,255,255,0.03)',
                      border: '1px solid rgba(255,255,255,0.08)',
                      borderRadius: 12, padding: '14px 16px',
                      position: 'relative',
                    }}
                  >
                    <span style={{
                      position: 'absolute', top: 10, right: 12,
                      fontSize: 11, fontWeight: 700, color: '#64748b',
                      background: 'rgba(255,255,255,0.06)', padding: '2px 8px', borderRadius: 20,
                    }}>#{fmt.id}</span>

                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
                      <span style={{ fontSize: 20 }}>{fmt.icon}</span>
                      <div>
                        <div style={{ fontWeight: 800, fontSize: 13, color: '#e2e8f0' }}>{fmt.label}</div>
                        <div style={{ fontSize: 10, color: '#475569', marginTop: 1 }}>Format #{fmt.id}</div>
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
                  </div>
                ))}
              </div>
            </div>
          );
        })()}

        {/* (Carte « Stratégies Pro — cibles Telegram » déplacée plus bas,
             juste à côté des stratégies personnalisées, pour visibilité.) */}
        <div style={{ display: 'none' }}>
        <div className="tg-admin-card" style={{ borderColor: 'rgba(99,102,241,0.45)', marginTop: 20 }}>
          <div className="tg-admin-header">
            <span className="tg-admin-icon">🔷</span>
            <div style={{ flex: 1 }}>
              <h2 className="tg-admin-title">Stratégies Pro — cibles Telegram</h2>
              <p className="tg-admin-sub">
                Toutes les stratégies Pro importées (S5001 à S5100) tous propriétaires confondus. Configurez ici un <strong>bot_token</strong> et un <strong>channel_id</strong> dédiés à chaque stratégie. À défaut, la stratégie envoie sur la <em>config Telegram du propriétaire</em>.
              </p>
            </div>
            <button
              type="button"
              className="btn btn-ghost btn-sm"
              onClick={loadProStratsTg}
              disabled={proStratsTgLoading}
              style={{ marginLeft: 8 }}
            >
              {proStratsTgLoading ? '⏳ …' : '🔄 Recharger'}
            </button>
            <span className="tg-badge-connected" style={{ marginLeft: 8 }}>{proStratsTg.length} pro</span>
          </div>

          {proStratsTg.length === 0 && !proStratsTgLoading && (
            <div style={{ padding: '20px 4px', color: '#64748b', textAlign: 'center', fontSize: 13 }}>
              Aucune stratégie Pro importée pour le moment. Demandez à un compte Pro d'en charger une depuis sa Config Pro.
            </div>
          )}

          {proStratsTg.length > 0 && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginTop: 16 }}>
              {proStratsTg.map(p => {
                const targets = p.tg_targets || [];
                const open = proStratTgOpen === p.id;
                const f = proStratTgForm[p.id] || { bot_token: '', channel_id: '', tg_format: null };
                return (
                  <div key={p.id} style={{
                    background: 'rgba(99,102,241,0.06)',
                    border: '1px solid rgba(99,102,241,0.25)',
                    borderRadius: 10, padding: '12px 16px',
                  }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
                      <div style={{ fontSize: 22 }}>🔷</div>
                      <div style={{ flex: 1, minWidth: 220 }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                          <span style={{ fontWeight: 700, color: '#e2e8f0', fontSize: 15 }}>{p.strategy_name}</span>
                          <span style={{ fontSize: 11, color: '#818cf8', fontWeight: 700 }}>S{p.id}</span>
                          {p.engine_type && (
                            <span style={{ fontSize: 10, padding: '1px 6px', borderRadius: 4, background: 'rgba(255,255,255,0.06)', color: '#94a3b8', fontWeight: 700, textTransform: 'uppercase' }}>
                              {p.engine_type}
                            </span>
                          )}
                          <span style={{ fontSize: 11, padding: '2px 7px', borderRadius: 5, fontWeight: 600,
                            background: p.hand === 'banquier' ? 'rgba(239,68,68,0.15)' : 'rgba(34,197,94,0.15)',
                            color: p.hand === 'banquier' ? '#f87171' : '#4ade80',
                          }}>
                            {p.hand === 'banquier' ? '🎮 Banquier' : '🤖 Joueur'}
                          </span>
                          {targets.length > 0 ? (
                            <span style={{ fontSize: 11, padding: '2px 8px', borderRadius: 5, fontWeight: 700,
                              background: 'rgba(34,158,217,0.18)', color: '#229ed9', border: '1px solid rgba(34,158,217,0.4)',
                            }} title={targets.map(t => t.channel_id).join(', ')}>
                              ✈️ {targets.length} cible{targets.length > 1 ? 's' : ''} dédiée{targets.length > 1 ? 's' : ''}
                            </span>
                          ) : p.owner_default_telegram ? (
                            <span style={{ fontSize: 11, padding: '2px 8px', borderRadius: 5, fontWeight: 700,
                              background: 'rgba(168,85,247,0.15)', color: '#a78bfa', border: '1px solid rgba(168,85,247,0.35)',
                            }} title={`Hérite de Config Pro de ${p.owner_username || `uid=${p.owner_user_id}`}`}>
                              🪪 Config Pro propriétaire
                            </span>
                          ) : (
                            <span style={{ fontSize: 11, padding: '2px 8px', borderRadius: 5, fontWeight: 700,
                              background: 'rgba(239,68,68,0.12)', color: '#f87171', border: '1px solid rgba(239,68,68,0.3)',
                            }}>⚠️ Aucun canal — n'envoie rien</span>
                          )}
                        </div>
                        <div style={{ fontSize: 12, color: '#94a3b8', marginTop: 3 }}>
                          {p.filename}
                          {p.owner_username && <> · 👤 <span style={{ color: '#cbd5e1' }}>{p.owner_username}</span></>}
                          {p.decalage != null && <> · décalage +{p.decalage}</>}
                          <> · R{p.max_rattrapage}</>
                        </div>
                        {targets.length > 0 && (
                          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 6 }}>
                            {targets.map(t => (
                              <span key={`${t.channel_id}_${t.bot_token?.slice(0,6)}`} style={{
                                display: 'inline-flex', alignItems: 'center', gap: 6,
                                fontSize: 11, padding: '3px 8px', borderRadius: 6,
                                background: 'rgba(34,158,217,0.1)', color: '#7dd3fc',
                                border: '1px solid rgba(34,158,217,0.3)',
                              }}>
                                ✈️ {t.channel_id} · fmt {t.format ?? 1}
                                <button
                                  type="button"
                                  onClick={() => removeProStratTgTarget(p.id, t.channel_id)}
                                  title="Retirer cette cible"
                                  style={{ border: 'none', background: 'transparent', color: '#f87171', cursor: 'pointer', fontSize: 13, padding: 0 }}
                                >✕</button>
                              </span>
                            ))}
                            <button
                              type="button"
                              onClick={() => testProStratTg(p.id)}
                              style={{ fontSize: 11, padding: '3px 8px', borderRadius: 6, border: '1px solid rgba(34,197,94,0.4)', background: 'rgba(34,197,94,0.1)', color: '#4ade80', cursor: 'pointer', fontWeight: 600 }}
                            >🧪 Tester l'envoi</button>
                          </div>
                        )}
                      </div>
                      <div style={{ flexShrink: 0 }}>
                        <button
                          type="button"
                          onClick={() => setProStratTgOpen(open ? null : p.id)}
                          style={{
                            fontSize: 12, padding: '6px 12px', borderRadius: 6,
                            border: '1px solid rgba(99,102,241,0.4)',
                            background: open ? 'rgba(99,102,241,0.2)' : 'rgba(99,102,241,0.08)',
                            color: '#a5b4fc', cursor: 'pointer', fontWeight: 700,
                          }}
                        >
                          {open ? '▾ Fermer' : '✈️ Ajouter une cible'}
                        </button>
                      </div>
                    </div>

                    {open && (
                      <div style={{
                        marginTop: 12, padding: 12, borderRadius: 8,
                        background: 'rgba(15,23,42,0.5)', border: '1px solid rgba(99,102,241,0.25)',
                      }}>
                        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 10 }}>
                          <div>
                            <label style={{ fontSize: 11, color: '#94a3b8', fontWeight: 700 }}>Bot token</label>
                            <input
                              type="text"
                              value={f.bot_token}
                              onChange={e => setProStratTgForm(p2 => ({ ...p2, [p.id]: { ...f, bot_token: e.target.value } }))}
                              placeholder="123456:ABCdef..."
                              style={{ width: '100%', marginTop: 4, padding: '8px 10px', borderRadius: 6, border: '1px solid rgba(255,255,255,0.1)', background: '#0f172a', color: '#e2e8f0', fontSize: 13 }}
                            />
                          </div>
                          <div>
                            <label style={{ fontSize: 11, color: '#94a3b8', fontWeight: 700 }}>Channel ID</label>
                            <input
                              type="text"
                              value={f.channel_id}
                              onChange={e => setProStratTgForm(p2 => ({ ...p2, [p.id]: { ...f, channel_id: e.target.value } }))}
                              placeholder="-100123456..."
                              style={{ width: '100%', marginTop: 4, padding: '8px 10px', borderRadius: 6, border: '1px solid rgba(255,255,255,0.1)', background: '#0f172a', color: '#e2e8f0', fontSize: 13 }}
                            />
                          </div>
                          <div>
                            <label style={{ fontSize: 11, color: '#94a3b8', fontWeight: 700 }}>📋 Format de prédiction</label>
                            <select
                              value={f.tg_format ?? ''}
                              onChange={e => setProStratTgForm(p2 => ({ ...p2, [p.id]: { ...f, tg_format: e.target.value } }))}
                              style={{ width: '100%', marginTop: 4, padding: '8px 10px', borderRadius: 6, border: '1px solid rgba(168,85,247,0.3)', background: '#0f172a', color: '#e2e8f0', fontSize: 13 }}
                            >
                              {TG_FORMATS.map(fmt => <option key={fmt.value} value={fmt.value}>{fmt.label}</option>)}
                            </select>
                          </div>
                        </div>
                        <div style={{ marginTop: 10, display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
                          <button
                            type="button"
                            onClick={() => setProStratTgOpen(null)}
                            style={{ fontSize: 12, padding: '7px 14px', borderRadius: 6, border: '1px solid rgba(255,255,255,0.15)', background: 'transparent', color: '#94a3b8', cursor: 'pointer', fontWeight: 600 }}
                          >Annuler</button>
                          <button
                            type="button"
                            onClick={() => saveProStratTgTarget(p.id)}
                            disabled={!!proStratTgSaving[p.id]}
                            style={{ fontSize: 12, padding: '7px 14px', borderRadius: 6, border: 'none', background: '#6366f1', color: '#fff', cursor: 'pointer', fontWeight: 700 }}
                          >
                            {proStratTgSaving[p.id] ? '⏳ Enregistrement…' : '💾 Enregistrer la cible'}
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
        </div>

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
                      {(s.tg_targets || []).some(t => t.bot_token && t.channel_id) ? (
                        <span style={{ fontSize: 11, padding: '2px 8px', borderRadius: 5, fontWeight: 700,
                          background: 'rgba(34,158,217,0.18)', color: '#229ed9', border: '1px solid rgba(34,158,217,0.4)',
                        }} title={(s.tg_targets || []).map(t => t.channel_id).join(', ')}>
                          ✈️ Telegram · {(s.tg_targets || []).length} cible{(s.tg_targets || []).length > 1 ? 's' : ''}
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
                      }} title={(s.exceptions || []).map(e => e.type).join(', ')}>
                        ⛔ {s.exceptions.length} exception{s.exceptions.length > 1 ? 's' : ''}
                      </span>
                    )}
                    <div style={{ fontSize: 12, color: '#94a3b8', marginTop: 3 }}>
                      {(() => {
                        if (s.mode === 'multi_strategy') {
                          const srcs = (s.multi_source_ids || []).join(', ') || '—';
                          return `🔗 Combinaison [${s.multi_require === 'all' ? 'toutes' : 'une'}] · Sources : ${srcs}`;
                        }
                        const mLabel = s.mode === 'manquants' ? 'Absences'
                          : s.mode === 'apparents' ? 'Apparitions'
                          : s.mode === 'absence_apparition' ? 'Abs→App'
                          : s.mode === 'apparition_absence' ? 'App→Abs'
                          : s.mode === 'taux_miroir' ? '⚖️ Miroir'
                          : s.mode === 'distribution' ? '📊 Distribution'
                          : s.mode === 'carte_3_vers_2' ? '3️⃣→2️⃣'
                          : s.mode === 'carte_2_vers_3' ? '2️⃣→3️⃣'
                          : s.mode === 'victoire_adverse' ? '🏆 Victoire Adverse'
                          : s.mode === 'abs_3_vers_2' ? '🃏 3→2 Abs'
                          : s.mode === 'abs_3_vers_3' ? '🃏 3→3 Abs'
                          : s.mode === 'absence_victoire' ? '🏆 Abs Victoire'
                          : s.mode;
                        const isAutoMode = s.mode === 'absence_apparition' || s.mode === 'apparition_absence' || s.mode === 'distribution' || s.mode === 'carte_3_vers_2' || s.mode === 'carte_2_vers_3' || s.mode === 'victoire_adverse' || s.mode === 'abs_3_vers_2' || s.mode === 'abs_3_vers_3' || s.mode === 'absence_victoire';
                        const mappingStr = isAutoMode ? 'prédit costume déclencheur'
                          : Object.entries(s.mappings || {}).map(([k,v]) => { const pool = Array.isArray(v) ? v : [v]; return `${k}→${pool.join('/')}${pool.length > 1 ? '↻' : ''}`; }).join('  ');
                        return `B≥${s.threshold} · ${mLabel} · ${mappingStr}`;
                      })()}
                    </div>
                    {/* ── Compteurs miroir temps réel ── */}
                    {s.mode === 'taux_miroir' && mirrorCountsData[s.id] && (
                      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 4 }}>
                        {['♠','♥','♦','♣'].map(suit => {
                          const cnt = mirrorCountsData[s.id]?.counts?.[suit] || 0;
                          const thr = mirrorCountsData[s.id]?.threshold || s.threshold;
                          const pct = Math.min(cnt / Math.max(thr, 1), 1);
                          return (
                            <span key={suit} style={{
                              fontSize: 12, padding: '2px 8px', borderRadius: 8, fontWeight: 800,
                              background: pct >= 0.8 ? 'rgba(239,68,68,0.2)' : pct >= 0.5 ? 'rgba(245,158,11,0.15)' : 'rgba(99,102,241,0.12)',
                              color: pct >= 0.8 ? '#f87171' : pct >= 0.5 ? '#fbbf24' : '#818cf8',
                              border: `1px solid ${pct >= 0.8 ? 'rgba(239,68,68,0.35)' : pct >= 0.5 ? 'rgba(245,158,11,0.3)' : 'rgba(99,102,241,0.25)'}`,
                            }}>
                              {suit} +{cnt}
                            </span>
                          );
                        })}
                      </div>
                    )}
                    {s.tg_targets?.some(t => t.bot_token && t.channel_id) && (
                      <div style={{ fontSize: 11, color: '#64748b', marginTop: 2 }}>
                        Canaux : {(s.tg_targets || []).filter(t=>t.channel_id).map(t => t.channel_id).join(', ')}
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
                      {s.mode === 'aleatoire' && (
                        <button
                          onClick={() => setAleatPanel({ stratId: s.id, stratName: s.name, step: 'hand', hand: null, gameInput: '', result: null, history: [] })}
                          title="Lancer une prédiction aléatoire"
                          style={{ fontSize: 11, padding: '4px 10px', borderRadius: 6, border: '1px solid rgba(99,102,241,0.5)', cursor: 'pointer', fontWeight: 700, background: 'rgba(99,102,241,0.18)', color: '#a5b4fc' }}
                        >🎲 Prédire</button>
                      )}
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

              {/* ══════════════ NOM ══════════════ */}
              <div style={{ marginBottom: 18, padding: '14px 16px', borderRadius: 12, background: 'rgba(168,85,247,0.06)', border: '1px solid rgba(168,85,247,0.2)' }}>
                <label style={{ display: 'block', color: '#c4b5fd', fontSize: 11, fontWeight: 800, textTransform: 'uppercase', letterSpacing: 1, marginBottom: 8 }}>
                  Nom de la stratégie *
                </label>
                <input type="text" maxLength={40} placeholder="ex: Alpha, Nexus, Fusion…"
                  value={stratForm.name}
                  onChange={e => setStratForm(p => ({ ...p, name: e.target.value }))}
                  style={{ width: '100%', padding: '10px 14px', background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(168,85,247,0.4)', borderRadius: 9, color: '#fff', fontSize: 15, fontWeight: 600, boxSizing: 'border-box' }}
                />
              </div>

              {/* ══════════════ MAIN SURVEILLÉE (Joueur / Banquier) ══════════════ */}
              {/* Cachée pour les modes qui surveillent les 2 mains automatiquement
                  (absence_victoire, distribution) ou qui n'utilisent pas la main (relance) */}
              {!['absence_victoire', 'distribution', 'relance', 'carte_valeur'].includes(stratForm.mode) && (
              <div style={{ marginBottom: 18, padding: '14px 16px', borderRadius: 12, background: 'rgba(99,102,241,0.06)', border: '1px solid rgba(99,102,241,0.25)' }}>
                <label style={{ display: 'block', color: '#a5b4fc', fontSize: 11, fontWeight: 800, textTransform: 'uppercase', letterSpacing: 1, marginBottom: 8 }}>
                  🎯 Main surveillée *
                </label>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                  <button type="button"
                    onClick={() => setStratForm(p => ({ ...p, hand: 'joueur' }))}
                    style={{
                      padding: '12px 14px',
                      borderRadius: 10,
                      border: stratForm.hand === 'joueur' ? '2px solid #3b82f6' : '1px solid rgba(99,102,241,0.3)',
                      background: stratForm.hand === 'joueur' ? 'rgba(59,130,246,0.18)' : 'rgba(255,255,255,0.03)',
                      color: stratForm.hand === 'joueur' ? '#93c5fd' : '#94a3b8',
                      fontSize: 14, fontWeight: 800, cursor: 'pointer',
                      display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
                      transition: 'all .15s',
                    }}>
                    🔵 JOUEUR
                  </button>
                  <button type="button"
                    onClick={() => setStratForm(p => ({ ...p, hand: 'banquier' }))}
                    style={{
                      padding: '12px 14px',
                      borderRadius: 10,
                      border: stratForm.hand === 'banquier' ? '2px solid #ef4444' : '1px solid rgba(239,68,68,0.3)',
                      background: stratForm.hand === 'banquier' ? 'rgba(239,68,68,0.18)' : 'rgba(255,255,255,0.03)',
                      color: stratForm.hand === 'banquier' ? '#fca5a5' : '#94a3b8',
                      fontSize: 14, fontWeight: 800, cursor: 'pointer',
                      display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
                      transition: 'all .15s',
                    }}>
                    🔴 BANQUIER
                  </button>
                </div>
                <div style={{ fontSize: 11, color: '#64748b', marginTop: 8, lineHeight: 1.5 }}>
                  Choisit la main dont les costumes/résultats seront analysés par cette stratégie.
                </div>
              </div>
              )}

              {/* ══════════════ SECTION 1 — ALGORITHME ══════════════ */}
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 14, padding: '8px 14px', borderRadius: 9,
                background: stratForm.mode === 'relance' ? 'rgba(251,146,60,0.08)' : 'rgba(168,85,247,0.08)',
                border: `1px solid ${stratForm.mode === 'relance' ? 'rgba(251,146,60,0.2)' : 'rgba(168,85,247,0.2)'}`,
              }}>
                <span style={{ fontSize: 13 }}>
                  {stratForm.mode === 'relance' ? '🔁' : '🎯'}
                </span>
                <span style={{ fontSize: 11, fontWeight: 800, letterSpacing: 1.2, textTransform: 'uppercase', flex: 1,
                  color: stratForm.mode === 'relance' ? '#fb923c' : '#a855f7',
                }}>
                  {stratForm.mode === 'relance' ? 'Stratégies à surveiller' : 'Algorithme de prédiction'}
                </span>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>

                {/* ── RELANCE : Sélection des stratégies à surveiller ── */}
                {stratForm.mode === 'relance' && (
                  <div style={{ gridColumn: '1 / -1' }}>
                    <div style={{ marginBottom: 12, fontSize: 12, color: '#94a3b8' }}>
                      Cochez les stratégies à surveiller. Activez une ou plusieurs conditions — le premier déclencheur atteint lance la relance.
                    </div>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                      {[
                        { id: 'C1', label: '♠ Pique Noir', tag: 'C1' },
                        { id: 'C2', label: '♥ Cœur Rouge', tag: 'C2' },
                        { id: 'C3', label: '♦ Carreau Doré', tag: 'C3' },
                        { id: 'DC', label: '♣ Double Canal', tag: 'DC' },
                        ...strategies.map(s => ({ id: `S${s.id}`, label: s.name, tag: `S${s.id}` })),
                      ].map(({ id, label, tag }) => {
                        const rule = (stratForm.relance_rules || []).find(r => r.strategy_id === id);
                        const checked = !!rule;
                        const updateRule = (patch) => setStratForm(p => ({ ...p, relance_rules: p.relance_rules.map(r => r.strategy_id === id ? { ...r, ...patch } : r) }));

                        const lThr    = rule?.losses_threshold ?? null;
                        const rLevel  = rule?.rattrapage_level ?? null;
                        const rCount  = rule?.rattrapage_count ?? 1;
                        const cLevel  = rule?.combo_level ?? null;
                        const cCount  = rule?.combo_count      ?? 1;
                        const rFrom   = rule?.range_from       ?? null;
                        const dCount  = rule?.range_count      ?? 1;
                        const iMin    = rule?.interval_min     ?? null;
                        const iMax    = rule?.interval_max     ?? null;
                        const eCount  = rule?.interval_count   ?? 1;

                        const summaryParts = [];
                        if (lThr != null)                summaryParts.push(`${lThr} perte${lThr > 1 ? 's' : ''} consécutive${lThr > 1 ? 's' : ''}`);
                        if (rLevel != null)              summaryParts.push(`${rCount}× R${rLevel} consécutif${rCount > 1 ? 's' : ''}`);
                        if (cLevel != null)              summaryParts.push(`${cCount} event${cCount > 1 ? 's' : ''} (perte ou R${cLevel})`);
                        if (rFrom != null)               summaryParts.push(`${dCount}× R≥R${rFrom}`);
                        if (iMin != null && iMax != null) summaryParts.push(`${eCount}× R${iMin}→R${iMax}`);

                        const BtnCount = ({ value, onChange, color }) => (
                          <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                            {[1,2,3,4,5,6,7,8,9,10].map(n => {
                              const active = value === n;
                              return (
                                <button key={n} type="button" onClick={() => onChange(n)}
                                  style={{ width: 28, height: 26, borderRadius: 5, cursor: 'pointer', fontWeight: 700, fontSize: 11,
                                    border: active ? `2px solid ${color}` : '1px solid rgba(255,255,255,0.1)',
                                    background: active ? `${color}33` : 'rgba(255,255,255,0.03)',
                                    color: active ? color : '#6b7280', transition: 'all 0.1s' }}>{n}</button>
                              );
                            })}
                          </div>
                        );

                        const BtnLevel = ({ value, onChange, color }) => (
                          <div style={{ display: 'flex', gap: 4 }}>
                            {[1,2,3,4,5].map(n => {
                              const active = value === n;
                              return (
                                <button key={n} type="button" onClick={() => onChange(n)}
                                  style={{ padding: '2px 8px', height: 26, borderRadius: 5, cursor: 'pointer', fontWeight: 700, fontSize: 11,
                                    border: active ? `2px solid ${color}` : '1px solid rgba(255,255,255,0.1)',
                                    background: active ? `${color}33` : 'rgba(255,255,255,0.03)',
                                    color: active ? color : '#6b7280', transition: 'all 0.1s' }}>R{n}</button>
                              );
                            })}
                          </div>
                        );

                        const CondToggle = ({ active, color, onClick }) => (
                          <button type="button" onClick={onClick} style={{
                            width: 18, height: 18, borderRadius: '50%', border: `2px solid ${active ? color : 'rgba(255,255,255,0.15)'}`,
                            background: active ? color : 'transparent', cursor: 'pointer', flexShrink: 0, transition: 'all 0.15s',
                          }} />
                        );

                        return (
                          <div key={id} style={{
                            background: checked ? 'rgba(251,146,60,0.06)' : 'rgba(255,255,255,0.02)',
                            border: `1px solid ${checked ? 'rgba(251,146,60,0.28)' : 'rgba(255,255,255,0.07)'}`,
                            borderRadius: 10, overflow: 'hidden', transition: 'all 0.15s',
                          }}>
                            {/* En-tête */}
                            <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 14px' }}>
                              <input type="checkbox" checked={checked}
                                onChange={e => {
                                  setStratForm(p => {
                                    const cur = p.relance_rules || [];
                                    if (e.target.checked) return { ...p, relance_rules: [...cur, { strategy_id: id, losses_threshold: null, rattrapage_level: null, rattrapage_count: 1, combo_level: null, combo_count: 1, range_from: null, range_count: 1, interval_min: null, interval_max: null, interval_count: 1 }] };
                                    return { ...p, relance_rules: cur.filter(r => r.strategy_id !== id) };
                                  });
                                }}
                                style={{ accentColor: '#fb923c', width: 16, height: 16, cursor: 'pointer', flexShrink: 0 }}
                              />
                              <span style={{ flex: 1, color: checked ? '#e2e8f0' : '#64748b', fontWeight: checked ? 600 : 400, fontSize: 13 }}>{label}</span>
                              <span style={{ fontSize: 10, color: '#475569', fontFamily: 'monospace', background: 'rgba(255,255,255,0.04)', padding: '2px 7px', borderRadius: 5 }}>{tag}</span>
                            </div>

                            {/* Conditions (visible si coché) */}
                            {checked && (
                              <div style={{ padding: '2px 14px 14px', display: 'flex', flexDirection: 'column', gap: 10 }}>
                                <div style={{ height: 1, background: 'rgba(251,146,60,0.12)', marginBottom: 4 }} />

                                {/* ── Condition A : Pertes consécutives ── */}
                                <div style={{ display: 'flex', flexDirection: 'column', gap: 6, padding: '8px 10px', borderRadius: 8, background: lThr != null ? 'rgba(251,146,60,0.07)' : 'rgba(255,255,255,0.02)', border: `1px solid ${lThr != null ? 'rgba(251,146,60,0.22)' : 'rgba(255,255,255,0.05)'}` }}>
                                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                                    <CondToggle active={lThr != null} color="#fb923c"
                                      onClick={() => updateRule({ losses_threshold: lThr != null ? null : 2 })} />
                                    <span style={{ fontSize: 11, fontWeight: 700, color: lThr != null ? '#fb923c' : '#475569' }}>Pertes consécutives</span>
                                    {lThr != null && <span style={{ fontSize: 10, color: '#94a3b8', marginLeft: 'auto' }}>si ≥ {lThr} de suite → relance</span>}
                                  </div>
                                  {lThr != null && (
                                    <BtnCount value={lThr} color="#fb923c" onChange={n => updateRule({ losses_threshold: n })} />
                                  )}
                                </div>

                                {/* ── Condition B : Rattrapages consécutifs (multi-niveaux) ── */}
                                {(() => {
                                  // Backward-compat : tableau prioritaire, sinon fallback au champ legacy
                                  const rLvls = Array.isArray(rule?.rattrapage_levels)
                                    ? rule.rattrapage_levels
                                    : (rLevel != null ? [rLevel] : []);
                                  const condBOn = rLvls.length > 0;
                                  const toggleLevel = (n) => {
                                    const cur = rLvls.includes(n) ? rLvls.filter(x => x !== n) : [...rLvls, n].sort((a,b) => a-b);
                                    updateRule({ rattrapage_levels: cur, rattrapage_level: cur.length === 1 ? cur[0] : null });
                                  };
                                  return (
                                    <div style={{ display: 'flex', flexDirection: 'column', gap: 6, padding: '8px 10px', borderRadius: 8, background: condBOn ? 'rgba(129,140,248,0.07)' : 'rgba(255,255,255,0.02)', border: `1px solid ${condBOn ? 'rgba(129,140,248,0.22)' : 'rgba(255,255,255,0.05)'}` }}>
                                      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                                        <CondToggle active={condBOn} color="#818cf8"
                                          onClick={() => updateRule({ rattrapage_levels: condBOn ? null : [3], rattrapage_level: condBOn ? null : 3, rattrapage_count: 1 })} />
                                        <span style={{ fontSize: 11, fontWeight: 700, color: condBOn ? '#818cf8' : '#475569' }}>Rattrapage consécutif</span>
                                        {condBOn && <span style={{ fontSize: 10, color: '#94a3b8', marginLeft: 'auto' }}>{rCount}× R{rLvls.join('/')} de suite → relance</span>}
                                      </div>
                                      {condBOn && (
                                        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                                          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                                            <span style={{ fontSize: 10, color: '#64748b', minWidth: 50 }}>Niveaux :</span>
                                            <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                                              {[1,2,3,4,5,6,7,8,9,10].map(n => {
                                                const active = rLvls.includes(n);
                                                return (
                                                  <button key={n} type="button" onClick={() => toggleLevel(n)}
                                                    style={{ padding: '2px 8px', height: 26, borderRadius: 5, cursor: 'pointer', fontWeight: 700, fontSize: 11,
                                                      border: active ? '2px solid #818cf8' : '1px solid rgba(255,255,255,0.1)',
                                                      background: active ? 'rgba(129,140,248,0.25)' : 'rgba(255,255,255,0.03)',
                                                      color: active ? '#818cf8' : '#6b7280' }}>R{n}</button>
                                                );
                                              })}
                                            </div>
                                          </div>
                                          <div style={{ fontSize: 9, color: '#64748b', fontStyle: 'italic', paddingLeft: 58 }}>Cliquez plusieurs niveaux pour déclencher si l'un d'eux atteint le seuil.</div>
                                          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                                            <span style={{ fontSize: 10, color: '#64748b', minWidth: 50 }}>Fois :</span>
                                            <BtnCount value={rCount} color="#818cf8" onChange={n => updateRule({ rattrapage_count: n })} />
                                          </div>
                                        </div>
                                      )}
                                    </div>
                                  );
                                })()}

                                {/* ── Condition C : Perte + Rattrapage (combo, multi-niveaux) ── */}
                                {(() => {
                                  const cLvls = Array.isArray(rule?.combo_levels)
                                    ? rule.combo_levels
                                    : (cLevel != null ? [cLevel] : []);
                                  const condCOn = cLvls.length > 0;
                                  const toggleCLevel = (n) => {
                                    const cur = cLvls.includes(n) ? cLvls.filter(x => x !== n) : [...cLvls, n].sort((a,b) => a-b);
                                    updateRule({ combo_levels: cur, combo_level: cur.length === 1 ? cur[0] : null });
                                  };
                                  return (
                                    <div style={{ display: 'flex', flexDirection: 'column', gap: 6, padding: '8px 10px', borderRadius: 8, background: condCOn ? 'rgba(52,211,153,0.07)' : 'rgba(255,255,255,0.02)', border: `1px solid ${condCOn ? 'rgba(52,211,153,0.22)' : 'rgba(255,255,255,0.05)'}` }}>
                                      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                                        <CondToggle active={condCOn} color="#34d399"
                                          onClick={() => updateRule({ combo_levels: condCOn ? null : [3], combo_level: condCOn ? null : 3, combo_count: 1 })} />
                                        <span style={{ fontSize: 11, fontWeight: 700, color: condCOn ? '#34d399' : '#475569' }}>Perte + Rattrapage</span>
                                        {condCOn && <span style={{ fontSize: 10, color: '#94a3b8', marginLeft: 'auto' }}>{cCount} événement{cCount > 1 ? 's' : ''} (perte ou R{cLvls.join('/')}) → relance</span>}
                                      </div>
                                      {condCOn && (
                                        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                                          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                                            <span style={{ fontSize: 10, color: '#64748b', minWidth: 60 }}>Niveaux R :</span>
                                            <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                                              {[1,2,3,4,5,6,7,8,9,10].map(n => {
                                                const active = cLvls.includes(n);
                                                return (
                                                  <button key={n} type="button" onClick={() => toggleCLevel(n)}
                                                    style={{ padding: '2px 8px', height: 26, borderRadius: 5, cursor: 'pointer', fontWeight: 700, fontSize: 11,
                                                      border: active ? '2px solid #34d399' : '1px solid rgba(255,255,255,0.1)',
                                                      background: active ? 'rgba(52,211,153,0.25)' : 'rgba(255,255,255,0.03)',
                                                      color: active ? '#34d399' : '#6b7280' }}>R{n}</button>
                                                );
                                              })}
                                            </div>
                                          </div>
                                          <div style={{ fontSize: 9, color: '#64748b', fontStyle: 'italic', paddingLeft: 68 }}>Multi-sélection : déclenche dès que (perte) ou (R parmi sélection) atteint le seuil.</div>
                                          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                                            <span style={{ fontSize: 10, color: '#64748b', minWidth: 60 }}>Fois :</span>
                                            <BtnCount value={cCount} color="#34d399" onChange={n => updateRule({ combo_count: n })} />
                                          </div>
                                        </div>
                                      )}
                                    </div>
                                  );
                                })()}

                                {/* ── Condition D : À partir de tel rattrapage ── */}
                                <div style={{ display: 'flex', flexDirection: 'column', gap: 6, padding: '8px 10px', borderRadius: 8, background: rFrom != null ? 'rgba(251,191,36,0.07)' : 'rgba(255,255,255,0.02)', border: `1px solid ${rFrom != null ? 'rgba(251,191,36,0.22)' : 'rgba(255,255,255,0.05)'}` }}>
                                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                                    <CondToggle active={rFrom != null} color="#fbbf24"
                                      onClick={() => updateRule({ range_from: rFrom != null ? null : 3, range_count: 1 })} />
                                    <span style={{ fontSize: 11, fontWeight: 700, color: rFrom != null ? '#fbbf24' : '#475569' }}>À partir de tel rattrapage</span>
                                    {rFrom != null && <span style={{ fontSize: 10, color: '#94a3b8', marginLeft: 'auto' }}>{dCount}× (R≥R{rFrom}) → relance</span>}
                                  </div>
                                  {rFrom != null && (
                                    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                                      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                                        <span style={{ fontSize: 10, color: '#64748b', minWidth: 80 }}>Déclencher si R ≥</span>
                                        <div style={{ display: 'flex', gap: 3, flexWrap: 'wrap' }}>
                                          {[1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16,17,18,19,20].map(n => {
                                            const active = rFrom === n;
                                            return (
                                              <button key={n} type="button" onClick={() => updateRule({ range_from: n })}
                                                style={{ padding: '1px 6px', height: 24, borderRadius: 5, cursor: 'pointer', fontWeight: 700, fontSize: 10, border: active ? '2px solid #fbbf24' : '1px solid rgba(255,255,255,0.1)', background: active ? 'rgba(251,191,36,0.25)' : 'rgba(255,255,255,0.03)', color: active ? '#fbbf24' : '#6b7280' }}>R{n}</button>
                                            );
                                          })}
                                        </div>
                                      </div>
                                      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                                        <span style={{ fontSize: 10, color: '#64748b', minWidth: 80 }}>Nombre de fois :</span>
                                        <BtnCount value={dCount} color="#fbbf24" onChange={n => updateRule({ range_count: n })} />
                                      </div>
                                    </div>
                                  )}
                                </div>

                                {/* ── Condition E : Intervalle de rattrapage ── */}
                                <div style={{ display: 'flex', flexDirection: 'column', gap: 6, padding: '8px 10px', borderRadius: 8, background: iMin != null ? 'rgba(168,85,247,0.07)' : 'rgba(255,255,255,0.02)', border: `1px solid ${iMin != null ? 'rgba(168,85,247,0.22)' : 'rgba(255,255,255,0.05)'}` }}>
                                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                                    <CondToggle active={iMin != null} color="#a855f7"
                                      onClick={() => updateRule({ interval_min: iMin != null ? null : 1, interval_max: iMax ?? 5, interval_count: 1 })} />
                                    <span style={{ fontSize: 11, fontWeight: 700, color: iMin != null ? '#a855f7' : '#475569' }}>Intervalle de rattrapage</span>
                                    {iMin != null && iMax != null && <span style={{ fontSize: 10, color: '#94a3b8', marginLeft: 'auto' }}>{eCount}× R{iMin}→R{iMax} → relance</span>}
                                  </div>
                                  {iMin != null && (
                                    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                                      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                                        <span style={{ fontSize: 10, color: '#64748b', minWidth: 80 }}>De (R min) :</span>
                                        <div style={{ display: 'flex', gap: 3, flexWrap: 'wrap' }}>
                                          {[1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16,17,18,19,20].map(n => {
                                            const active = iMin === n;
                                            return (
                                              <button key={n} type="button" onClick={() => updateRule({ interval_min: n, interval_max: iMax != null && iMax < n ? n : iMax })}
                                                style={{ padding: '1px 5px', height: 22, borderRadius: 4, cursor: 'pointer', fontWeight: 700, fontSize: 10, border: active ? '2px solid #a855f7' : '1px solid rgba(255,255,255,0.1)', background: active ? 'rgba(168,85,247,0.25)' : 'rgba(255,255,255,0.03)', color: active ? '#a855f7' : '#6b7280' }}>R{n}</button>
                                            );
                                          })}
                                        </div>
                                      </div>
                                      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                                        <span style={{ fontSize: 10, color: '#64748b', minWidth: 80 }}>À (R max) :</span>
                                        <div style={{ display: 'flex', gap: 3, flexWrap: 'wrap' }}>
                                          {[1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16,17,18,19,20].map(n => {
                                            const disabled = n < (iMin || 1);
                                            const active = iMax === n;
                                            return (
                                              <button key={n} type="button" onClick={() => !disabled && updateRule({ interval_max: n })}
                                                style={{ padding: '1px 5px', height: 22, borderRadius: 4, cursor: disabled ? 'not-allowed' : 'pointer', fontWeight: 700, fontSize: 10, border: active ? '2px solid #a855f7' : '1px solid rgba(255,255,255,0.1)', background: active ? 'rgba(168,85,247,0.25)' : disabled ? 'rgba(255,255,255,0.01)' : 'rgba(255,255,255,0.03)', color: active ? '#a855f7' : disabled ? '#334155' : '#6b7280', opacity: disabled ? 0.4 : 1 }}>R{n}</button>
                                            );
                                          })}
                                        </div>
                                      </div>
                                      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                                        <span style={{ fontSize: 10, color: '#64748b', minWidth: 80 }}>Nombre de fois :</span>
                                        <BtnCount value={eCount} color="#a855f7" onChange={n => updateRule({ interval_count: n })} />
                                      </div>
                                    </div>
                                  )}
                                </div>

                                {/* Résumé */}
                                {summaryParts.length > 0 ? (
                                  <div style={{ fontSize: 10, color: '#64748b', fontStyle: 'italic', paddingLeft: 4 }}>
                                    → Déclenche si : {summaryParts.join(' OU ')}
                                  </div>
                                ) : (
                                  <div style={{ fontSize: 10, color: '#ef4444', fontStyle: 'italic', paddingLeft: 4 }}>
                                    ⚠ Activez au moins une condition ci-dessus
                                  </div>
                                )}
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                    {(stratForm.relance_rules || []).length === 0 && (
                      <div style={{ marginTop: 10, padding: '8px 12px', borderRadius: 8, background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.25)', fontSize: 12, color: '#f87171' }}>
                        ⚠️ Cochez au moins une stratégie source pour activer la relance
                      </div>
                    )}
                  </div>
                )}

                {/* Mode — masqué pour multi-stratégie */}
                <div>
                  <label style={{ display: 'block', color: '#94a3b8', fontSize: 12, marginBottom: 5 }}>Mode</label>
                  <select value={stratForm.mode} onChange={e => {
                    const m = e.target.value;
                    const isNew = m === 'absence_apparition' || m === 'apparition_absence' || m === 'distribution' || m === 'carte_3_vers_2' || m === 'carte_2_vers_3' || m === 'victoire_adverse' || m === 'absence_victoire';
                    setStratForm(p => ({
                      ...p,
                      mode: m,
                      ...(isNew ? { threshold: Math.max(p.threshold, 1), max_rattrapage: 20 } : {}),
                      ...(m === 'relance' ? { max_rattrapage: 1 } : {}),
                    }));
                  }}
                    style={{ width: '100%', padding: '8px 12px', background: '#1e1b2e', border: '1px solid rgba(168,85,247,0.35)', borderRadius: 8, color: '#fff', fontSize: 13 }}>
                    <option value="manquants">Manquants — prédit l'absent</option>
                    <option value="apparents">Apparents — prédit le fréquent</option>
                    <option value="absence_apparition">Absence → Apparition</option>
                    <option value="apparition_absence">Apparition → Absence</option>
                    <option value="distribution">📊 Distribution</option>
                    <option value="carte_3_vers_2">3️⃣ 3 cartes → prédit 2 cartes</option>
                    <option value="carte_2_vers_3">2️⃣ 2 cartes → prédit 3 cartes</option>
                    <option value="taux_miroir">⚖️ Miroir Taux</option>
                    <option value="compteur_adverse">🔄 Compteur Adverse</option>
                    <option value="absence_victoire">🏆 Absence Victoire (Joueur / Banquier)</option>
                    <option value="lecture_passee">📖 Lecture des jeux passés (cartes_jeu)</option>
                    <option value="intelligent_cartes">🧠 Intelligent Cartes (analyse de patterns)</option>
                    <option value="union_enseignes">🔗 Union Enseignes (accord multi-sources)</option>
                    <option value="carte_valeur">🃏 Carte Valeur</option>
                    <option value="relance">🔁 Séquences de Relance</option>
                    <option value="aleatoire">🎲 Stratégie Aléatoire</option>
                  </select>
                  {stratForm.mode === 'lecture_passee' && (
                    <div style={{ marginTop: 8, padding: '12px 14px', borderRadius: 8, background: 'rgba(34,197,94,0.08)', border: '1px solid rgba(34,197,94,0.25)', fontSize: 12, color: '#86efac', lineHeight: 1.7 }}>
                      <div style={{ fontWeight: 700, marginBottom: 6, fontSize: 13 }}>📖 Mode Lecture des jeux passés</div>
                      <div>Quand le live arrive sur le jeu <code style={{ background: 'rgba(34,197,94,0.18)', padding: '1px 5px', borderRadius: 4 }}>N</code>, on prédit pour le jeu <strong>go = N+p</strong> le costume de la carte <strong>#position</strong> de la main choisie au jeu <strong>zk = go−h</strong> (lu depuis la 2ème base <em>cartes_jeu</em>).</div>
                      <div style={{ marginTop: 6 }}>Ex. <code>p=2 · h=32 · position=1 · main=Joueur</code> · live=91 → prédit pour go=93 le costume de la carte #1 du Joueur au jeu zk=61.</div>
                      <div style={{ marginTop: 6 }}>L'<strong>écart</strong> impose un nombre minimum de jeux entre deux prédictions consécutives. Le <strong>max_rattrapage</strong> et les <strong>exceptions</strong> standards s'appliquent normalement.</div>
                    </div>
                  )}
                  {stratForm.mode === 'intelligent_cartes' && (
                    <div style={{ marginTop: 8, padding: '12px 14px', borderRadius: 8, background: 'rgba(168,85,247,0.08)', border: '1px solid rgba(168,85,247,0.25)', fontSize: 12, color: '#d8b4fe', lineHeight: 1.7 }}>
                      <div style={{ fontWeight: 700, marginBottom: 6, fontSize: 13 }}>🧠 Mode Intelligent Cartes</div>
                      <div>Lit la 2ème base <em>cartes_jeu</em> sur une <strong>fenêtre</strong> de N jeux passés. Pour la main choisie, calcule le costume qui apparaît le plus souvent à <strong>(jeu+offset)</strong> après chaque séquence des <strong>pattern</strong> derniers jeux identique à la séquence courante.</div>
                      <div style={{ marginTop: 6 }}>Si le motif <strong>♦♣♠</strong> est suivi <em>min_count</em> fois ou plus par <strong>♣</strong> dans l'historique, le moteur prédit ♣ pour le prochain jeu.</div>
                      <div style={{ marginTop: 6 }}>Plus la fenêtre est grande, plus les corrélations sont fiables. Augmentez <em>min_count</em> pour réduire les faux signaux.</div>
                    </div>
                  )}
                  {stratForm.mode === 'union_enseignes' && (
                    <div style={{ marginTop: 8, padding: '12px 14px', borderRadius: 8, background: 'rgba(99,102,241,0.08)', border: '1px solid rgba(99,102,241,0.25)', fontSize: 12, color: '#a5b4fc', lineHeight: 1.7 }}>
                      <div style={{ fontWeight: 700, marginBottom: 6, fontSize: 13 }}>🔗 Mode Union Enseignes</div>
                      <div>Surveille les prédictions en cours de plusieurs stratégies sources. Quand au moins <strong>Seuil</strong> sources s'accordent sur le <strong>même costume</strong> → émet ce costume pour le prochain jeu.</div>
                      <div style={{ marginTop: 6 }}>Contrairement à Multi-Stratégie (qui attend que toutes les sources se déclenchent simultanément), Union Enseignes se déclenche dès qu'un consensus de N sources est atteint, même à des moments différents.</div>
                      <div style={{ marginTop: 6 }}>Configurez les <strong>stratégies sources</strong> ci-dessous et le <strong>seuil</strong> (nombre minimum de sources en accord).</div>
                    </div>
                  )}
                  {stratForm.mode === 'carte_valeur' && (
                    <div style={{ marginTop: 8, padding: '12px 14px', borderRadius: 8, background: 'rgba(251,191,36,0.08)', border: '1px solid rgba(251,191,36,0.25)', fontSize: 12, color: '#fde68a', lineHeight: 1.7 }}>
                      <div style={{ fontWeight: 700, marginBottom: 6, fontSize: 13 }}>🃏 Mode Carte Valeur</div>
                      <div>Suit de façon <strong>cumulative</strong> le nombre d'apparitions de chaque <strong>valeur</strong> (A, K, Q, J, 10, 9, 8, 7, 6) dans la main configurée.</div>
                      <div style={{ marginTop: 6 }}>Quand <strong>exactement une valeur</strong> n'a jamais été vue (compteur à 0) et que toutes les autres ont été vues → envoie une alerte : <em>"Manque de la valeur : X"</em>.</div>
                      <div style={{ marginTop: 6 }}>Quand <strong>toutes les valeurs</strong> ont été vues au moins une fois → les compteurs se <strong>réinitialisent</strong> pour un nouveau cycle.</div>
                      <div style={{ marginTop: 6, color: '#fbbf24', fontWeight: 600 }}>⚠️ Pas de décalage, pas de rattrapage, pas de mappings — mode alerte informatif uniquement.</div>
                    </div>
                  )}

                  {/* ── Champs spécifiques mode lecture_passee ── */}
                  {stratForm.mode === 'lecture_passee' && (
                    <div style={{ marginTop: 12, padding: '14px', borderRadius: 10, background: 'rgba(34,197,94,0.05)', border: '1px solid rgba(34,197,94,0.2)' }}>
                      <div style={{ fontSize: 11, fontWeight: 800, color: '#86efac', letterSpacing: 1.2, textTransform: 'uppercase', marginBottom: 10 }}>📖 Paramètres de lecture</div>
                      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 10, marginBottom: 10 }}>
                        <div>
                          <label style={{ display: 'block', color: '#94a3b8', fontSize: 11, marginBottom: 4, fontWeight: 600 }}>p (avance) — go = live + p</label>
                          <input type="number" min="1" max="50" value={stratForm.carte_p}
                            onChange={e => setStratForm(prev => ({ ...prev, carte_p: Math.max(1, parseInt(e.target.value) || 1) }))}
                            style={{ width: '100%', padding: '7px 10px', background: '#0f172a', border: '1px solid rgba(34,197,94,0.3)', borderRadius: 7, color: '#fff', fontSize: 13 }} />
                        </div>
                        <div>
                          <label style={{ display: 'block', color: '#94a3b8', fontSize: 11, marginBottom: 4, fontWeight: 600 }}>h (recul) — zk = go − h</label>
                          <input type="number" min="1" max="500" value={stratForm.carte_h}
                            onChange={e => setStratForm(prev => ({ ...prev, carte_h: Math.max(1, parseInt(e.target.value) || 1) }))}
                            style={{ width: '100%', padding: '7px 10px', background: '#0f172a', border: '1px solid rgba(34,197,94,0.3)', borderRadius: 7, color: '#fff', fontSize: 13 }} />
                        </div>
                        <div>
                          <label style={{ display: 'block', color: '#94a3b8', fontSize: 11, marginBottom: 4, fontWeight: 600 }}>écart (min jeux entre prédictions)</label>
                          <input type="number" min="1" max="100" value={stratForm.carte_ecart}
                            onChange={e => setStratForm(prev => ({ ...prev, carte_ecart: Math.max(1, parseInt(e.target.value) || 1) }))}
                            style={{ width: '100%', padding: '7px 10px', background: '#0f172a', border: '1px solid rgba(34,197,94,0.3)', borderRadius: 7, color: '#fff', fontSize: 13 }} />
                        </div>
                      </div>
                      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                        <div>
                          <label style={{ display: 'block', color: '#94a3b8', fontSize: 11, marginBottom: 4, fontWeight: 600 }}>Main source (lecture)</label>
                          <select value={stratForm.carte_source_hand}
                            onChange={e => setStratForm(prev => ({ ...prev, carte_source_hand: e.target.value }))}
                            style={{ width: '100%', padding: '7px 10px', background: '#0f172a', border: '1px solid rgba(34,197,94,0.3)', borderRadius: 7, color: '#fff', fontSize: 13 }}>
                            <option value="joueur">👤 Joueur</option>
                            <option value="banquier">🏦 Banquier</option>
                          </select>
                        </div>
                        <div>
                          <label style={{ display: 'block', color: '#94a3b8', fontSize: 11, marginBottom: 4, fontWeight: 600 }}>Position de la carte (1-3)</label>
                          <div style={{ display: 'flex', gap: 6 }}>
                            {[1,2,3].map(n => {
                              const active = stratForm.carte_position === n;
                              return (
                                <button key={n} type="button"
                                  onClick={() => setStratForm(prev => ({ ...prev, carte_position: n }))}
                                  style={{ flex: 1, padding: '7px 0', borderRadius: 7, fontWeight: 800, fontSize: 13,
                                    border: active ? '2px solid #22c55e' : '1px solid rgba(34,197,94,0.25)',
                                    background: active ? 'rgba(34,197,94,0.25)' : 'rgba(34,197,94,0.05)',
                                    color: active ? '#86efac' : '#64748b', cursor: 'pointer' }}>
                                  Carte #{n}
                                </button>
                              );
                            })}
                          </div>
                        </div>
                      </div>
                      <div style={{ marginTop: 10, padding: '8px 10px', background: 'rgba(34,197,94,0.1)', borderRadius: 7, fontSize: 11, color: '#86efac', lineHeight: 1.6 }}>
                        💡 <strong>Déclencheur</strong> : quand le live atteint le numéro N, prédiction pour <strong>go = N + {stratForm.carte_p}</strong> (lit la carte #{stratForm.carte_position} du {stratForm.carte_source_hand === 'banquier' ? 'Banquier' : 'Joueur'} au jeu zk = go − {stratForm.carte_h}).
                      </div>
                    </div>
                  )}

                  {/* ── Champs spécifiques mode intelligent_cartes ── */}
                  {stratForm.mode === 'intelligent_cartes' && (
                    <div style={{ marginTop: 12, padding: '14px', borderRadius: 10, background: 'rgba(168,85,247,0.05)', border: '1px solid rgba(168,85,247,0.2)' }}>
                      <div style={{ fontSize: 11, fontWeight: 800, color: '#d8b4fe', letterSpacing: 1.2, textTransform: 'uppercase', marginBottom: 10 }}>🧠 Paramètres d'analyse</div>
                      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 10 }}>
                        <div>
                          <label style={{ display: 'block', color: '#94a3b8', fontSize: 11, marginBottom: 4, fontWeight: 600 }}>Fenêtre d'analyse (jeux)</label>
                          <input type="number" min="20" max="2000" value={stratForm.intelligent_window}
                            onChange={e => setStratForm(prev => ({ ...prev, intelligent_window: Math.max(20, Math.min(2000, parseInt(e.target.value) || 300)) }))}
                            style={{ width: '100%', padding: '7px 10px', background: '#0f172a', border: '1px solid rgba(168,85,247,0.3)', borderRadius: 7, color: '#fff', fontSize: 13 }} />
                        </div>
                        <div>
                          <label style={{ display: 'block', color: '#94a3b8', fontSize: 11, marginBottom: 4, fontWeight: 600 }}>Longueur du motif (1-8)</label>
                          <input type="number" min="1" max="8" value={stratForm.intelligent_pattern}
                            onChange={e => setStratForm(prev => ({ ...prev, intelligent_pattern: Math.max(1, Math.min(8, parseInt(e.target.value) || 3)) }))}
                            style={{ width: '100%', padding: '7px 10px', background: '#0f172a', border: '1px solid rgba(168,85,247,0.3)', borderRadius: 7, color: '#fff', fontSize: 13 }} />
                        </div>
                        <div>
                          <label style={{ display: 'block', color: '#94a3b8', fontSize: 11, marginBottom: 4, fontWeight: 600 }}>Confiance min. (occurrences)</label>
                          <input type="number" min="1" max="50" value={stratForm.intelligent_min_count}
                            onChange={e => setStratForm(prev => ({ ...prev, intelligent_min_count: Math.max(1, Math.min(50, parseInt(e.target.value) || 3)) }))}
                            style={{ width: '100%', padding: '7px 10px', background: '#0f172a', border: '1px solid rgba(168,85,247,0.3)', borderRadius: 7, color: '#fff', fontSize: 13 }} />
                        </div>
                      </div>
                      <div style={{ marginTop: 10, padding: '8px 10px', background: 'rgba(168,85,247,0.1)', borderRadius: 7, fontSize: 11, color: '#d8b4fe', lineHeight: 1.6 }}>
                        💡 Analyse les <strong>{stratForm.intelligent_window}</strong> derniers jeux. Pour chaque motif de <strong>{stratForm.intelligent_pattern}</strong> jeux égal au motif courant, compte le costume qui suit. Prédit si confiance ≥ <strong>{stratForm.intelligent_min_count}</strong> occurrences. La <strong>main</strong> et l'<strong>offset</strong> sont configurés en Section 2.
                      </div>
                    </div>
                  )}
                  {stratForm.mode === 'absence_victoire' && (
                    <div style={{ marginTop: 8, padding: '10px 14px', borderRadius: 8, background: 'rgba(250,204,21,0.08)', border: '1px solid rgba(250,204,21,0.3)', fontSize: 12, color: '#fde68a', lineHeight: 1.7 }}>
                      🏆 <strong>Absence Victoire</strong> — fonctionne exactement comme Absence → Apparition mais sur les résultats :<br/>
                      Deux compteurs indépendants tournent en parallèle : <strong>absences de victoire Joueur</strong> et <strong>absences de victoire Banquier</strong>.<br/>
                      Dès qu'une victoire Joueur survient après ≥ B jeux sans victoire Joueur → <strong>WIN_P prédit</strong>.<br/>
                      Dès qu'une victoire Banquier survient après ≥ B jeux sans victoire Banquier → <strong>WIN_B prédit</strong>.<br/>
                      Les égalités incrémentent les deux compteurs. Pas de mapping — la prédiction est toujours le vainqueur déclencheur.
                    </div>
                  )}
                  {stratForm.mode === 'absence_apparition' && (
                    <div style={{ marginTop: 8, padding: '10px 14px', borderRadius: 8, background: 'rgba(34,197,94,0.08)', border: '1px solid rgba(34,197,94,0.25)', fontSize: 12, color: '#86efac', lineHeight: 1.6 }}>
                      ⚡ Dès qu'un costume absent depuis ≥ B jeux réapparaît dans la main (même avant la fin du tirage), il est prédit automatiquement pour le jeu suivant. Pas de mapping — la prédiction est toujours le costume déclencheur.
                    </div>
                  )}
                  {stratForm.mode === 'distribution' && (
                    <div style={{ marginTop: 8, padding: '10px 14px', borderRadius: 8, background: 'rgba(99,211,255,0.08)', border: '1px solid rgba(99,211,255,0.25)', fontSize: 12, color: '#7dd3fc', lineHeight: 1.6 }}>
                      📊 Compte les <strong>absences de distribution</strong> de chaque costume. Dès qu'un costume manque depuis ≥ B jeux consécutifs et est <strong>enfin distribué</strong> (réapparaît dans la main), il est prédit automatiquement pour le jeu suivant. Déclenchement en temps réel — toujours le costume distribué.
                    </div>
                  )}
                  {stratForm.mode === 'carte_3_vers_2' && (
                    <div style={{ marginTop: 8, padding: '10px 14px', borderRadius: 8, background: 'rgba(251,191,36,0.08)', border: '1px solid rgba(251,191,36,0.25)', fontSize: 12, color: '#fde68a', lineHeight: 1.6 }}>
                      3️⃣ Compte le nombre de fois où la main choisie a tiré <strong>3 cartes</strong>. Dès que le compteur atteint le seuil B, prédit que le prochain jeu (ou après offset) aura <strong>2 cartes</strong> (naturel) pour la même main.
                    </div>
                  )}
                  {stratForm.mode === 'carte_2_vers_3' && (
                    <div style={{ marginTop: 8, padding: '10px 14px', borderRadius: 8, background: 'rgba(167,243,208,0.08)', border: '1px solid rgba(167,243,208,0.25)', fontSize: 12, color: '#6ee7b7', lineHeight: 1.6 }}>
                      2️⃣ Compte le nombre de fois où la main choisie a reçu <strong>2 cartes</strong> (naturel). Dès que le compteur atteint le seuil B, prédit que le prochain jeu tirera <strong>3 cartes</strong> pour la même main.
                    </div>
                  )}
                  {stratForm.mode === 'compteur_adverse' && (
                    <div style={{ marginTop: 8, padding: '10px 14px', borderRadius: 8, background: 'rgba(168,85,247,0.08)', border: '1px solid rgba(168,85,247,0.25)', fontSize: 12, color: '#d8b4fe', lineHeight: 1.6 }}>
                      🔄 Compte les costumes <strong>manquants de la main ADVERSE</strong> (opposée à la main choisie). Dès qu'un costume est absent depuis ≥ B jeux dans la main adverse → prédit le costume défini dans le mapping pour la main sélectionnée. Ex : main=Joueur, seuil=5 → observe les absences du Banquier.
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
                  {stratForm.mode === 'relance' && (
                    <div style={{ marginTop: 8, padding: '12px 14px', borderRadius: 8, background: 'rgba(251,146,60,0.08)', border: '1px solid rgba(251,146,60,0.25)', fontSize: 12, color: '#fdba74', lineHeight: 1.8 }}>
                      <div style={{ fontWeight: 700, marginBottom: 6, fontSize: 13 }}>🔁 Mode Séquences de Relance — Comment ça fonctionne ?</div>
                      <div>Ce mode <strong>ne prédit pas directement</strong> — il surveille les <strong>pertes consécutives</strong> des stratégies sélectionnées ci-dessus.</div>
                      <div style={{ marginTop: 6 }}>Dès qu'une stratégie atteint son seuil de pertes, la relance se déclenche automatiquement et envoie une prédiction via le canal Telegram configuré.</div>
                      <div style={{ marginTop: 6 }}>Les prédictions de relance apparaissent <strong>séparément</strong> dans le canal avec le type de perte/rattrapage choisi en Section 2.</div>
                    </div>
                  )}
                  {stratForm.mode === 'aleatoire' && (
                    <div style={{ marginTop: 8, padding: '12px 14px', borderRadius: 8, background: 'rgba(99,102,241,0.08)', border: '1px solid rgba(99,102,241,0.3)', fontSize: 12, color: '#a5b4fc', lineHeight: 1.9 }}>
                      <div style={{ fontWeight: 700, marginBottom: 6, fontSize: 13 }}>🎲 Mode Stratégie Aléatoire — Comment ça fonctionne ?</div>
                      <div>Ce mode est <strong>manuel</strong> : l'administrateur ou l'utilisateur choisit le numéro à prédire directement via le bot Telegram.</div>
                      <div style={{ marginTop: 6 }}>Dans le canal ou en privé avec le bot, tapez <code style={{ background: 'rgba(99,102,241,0.2)', padding: '1px 5px', borderRadius: 4 }}>/predire</code> → sélectionnez <strong>Joueur ❤️</strong> ou <strong>Banquier ♣️</strong> → entrez un numéro de <strong>1 à 1440</strong>.</div>
                      <div style={{ marginTop: 6 }}>Si le numéro saisi est <strong>supérieur au tour en cours</strong>, le costume correspondant est prédit et envoyé automatiquement dans le canal.</div>
                      <div style={{ marginTop: 8, padding: '6px 10px', borderRadius: 6, background: 'rgba(99,102,241,0.12)', lineHeight: 2.2 }}>
                        <div>❤️ <strong>Joueur</strong> : ❤️♣️♦️♠️ — cycle de 4 sur les 1440 tours</div>
                        <div>♣️ <strong>Banquier</strong> : ♣️❤️♠️♦️ — cycle de 4 sur les 1440 tours</div>
                      </div>
                    </div>
                  )}
                </div>

                {/* Seuil B / Différence — masqué pour relance, aleatoire, lecture_passee, intelligent_cartes, carte_valeur */}
                {stratForm.mode !== 'relance' && stratForm.mode !== 'aleatoire' && stratForm.mode !== 'lecture_passee' && stratForm.mode !== 'intelligent_cartes' && stratForm.mode !== 'carte_valeur' && <div style={stratForm.mode === 'taux_miroir' ? { gridColumn: '1 / -1' } : {}}>
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
                        {(stratForm.mode === 'absence_apparition' || stratForm.mode === 'apparition_absence' || stratForm.mode === 'distribution')
                          ? 'Minimum B (≥4 requis)'
                          : 'Seuil B (1–50)'}
                      </label>
                      <input type="number"
                        min={(stratForm.mode === 'absence_apparition' || stratForm.mode === 'apparition_absence' || stratForm.mode === 'distribution') ? 4 : 1}
                        max={50} value={stratForm.threshold}
                        onChange={e => {
                          const min = (stratForm.mode === 'absence_apparition' || stratForm.mode === 'apparition_absence' || stratForm.mode === 'distribution') ? 4 : 1;
                          setStratForm(p => ({ ...p, threshold: Math.max(min, parseInt(e.target.value) || min) }));
                        }}
                        style={{ width: '100%', padding: '8px 12px', background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(168,85,247,0.35)', borderRadius: 8, color: '#fff', fontSize: 14 }}
                      />
                    </div>
                  )}
                </div>}

                {/* ── Stratégies sources — MODE UNION ENSEIGNES ── */}
                {stratForm.mode === 'union_enseignes' && (
                  <div style={{ gridColumn: '1 / -1', padding: '14px 16px', borderRadius: 12, background: 'rgba(99,102,241,0.07)', border: '1px solid rgba(99,102,241,0.25)' }}>
                    <div style={{ fontWeight: 700, fontSize: 12, color: '#818cf8', marginBottom: 4 }}>🔗 Stratégies sources à surveiller</div>
                    <div style={{ fontSize: 11, color: '#475569', marginBottom: 12 }}>Cochez les stratégies dont les prédictions en cours seront agrégées. Le <strong>Seuil B</strong> définit le nombre minimum de sources devant prédire le même costume pour déclencher.</div>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                      {[
                        { id: 'C1', label: '♠ Pique Noir' },
                        { id: 'C2', label: '♥ Cœur Rouge' },
                        { id: 'C3', label: '♦ Carreau Doré' },
                        { id: 'DC', label: '♣ Double Canal' },
                        ...strategies.filter(s => s.mode !== 'union_enseignes').map(s => ({ id: `S${s.id}`, label: s.name })),
                      ].map(({ id, label }) => {
                        const checked = (stratForm.multi_source_ids || []).includes(id);
                        return (
                          <label key={id} style={{ display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer', padding: '7px 10px', borderRadius: 8,
                            background: checked ? 'rgba(99,102,241,0.12)' : 'rgba(255,255,255,0.02)', border: `1px solid ${checked ? 'rgba(99,102,241,0.3)' : 'rgba(255,255,255,0.06)'}` }}>
                            <input type="checkbox" checked={checked} onChange={e => setStratForm(p => {
                              const cur = p.multi_source_ids || [];
                              return { ...p, multi_source_ids: e.target.checked ? [...cur, id] : cur.filter(x => x !== id) };
                            })} style={{ accentColor: '#818cf8', width: 15, height: 15, cursor: 'pointer' }} />
                            <span style={{ flex: 1, color: checked ? '#e2e8f0' : '#64748b', fontSize: 13 }}>{label}</span>
                            <span style={{ fontSize: 10, color: '#475569', fontFamily: 'monospace', background: 'rgba(255,255,255,0.04)', padding: '2px 7px', borderRadius: 5 }}>{id}</span>
                          </label>
                        );
                      })}
                    </div>
                    {(stratForm.multi_source_ids || []).length > 0 && (
                      <div style={{ marginTop: 8, fontSize: 11, color: '#818cf8' }}>
                        ✓ {stratForm.multi_source_ids.length} source(s) · seuil = {stratForm.threshold} accord(s) minimum
                      </div>
                    )}
                  </div>
                )}

                {/* ── Paires fixes — MODE MIROIR UNIQUEMENT ── */}
                {stratForm.mode === 'taux_miroir' && (
                  <div style={{ gridColumn: '1 / -1', padding: '14px 16px', borderRadius: 12, background: 'rgba(99,102,241,0.08)', border: '1px solid rgba(99,102,241,0.25)' }}>
                    <div style={{ fontWeight: 700, fontSize: 12, color: '#818cf8', marginBottom: 4 }}>
                      ⚖️ Paires à surveiller — cochez pour activer
                    </div>
                    <div style={{ fontSize: 11, color: '#475569', marginBottom: 12 }}>
                      Cochez les combinaisons à comparer. Pour chaque paire cochée, définissez l'écart déclenchant.
                    </div>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                      {[
                        { a: '♠', b: '♥', la: 'Pique',   lb: 'Cœur' },
                        { a: '♦', b: '♣', la: 'Carreau', lb: 'Trèfle' },
                        { a: '♠', b: '♦', la: 'Pique',   lb: 'Carreau' },
                        { a: '♥', b: '♣', la: 'Cœur',    lb: 'Trèfle' },
                        { a: '♠', b: '♣', la: 'Pique',   lb: 'Trèfle' },
                        { a: '♥', b: '♦', la: 'Cœur',    lb: 'Carreau' },
                      ].map(pair => {
                        const found = (stratForm.mirror_pairs || []).find(p =>
                          (p.a === pair.a && p.b === pair.b) || (p.a === pair.b && p.b === pair.a));
                        const isActive = !!found;
                        const thr = found?.threshold ?? stratForm.threshold;
                        const togglePair = () => {
                          setStratForm(p => {
                            const cur = (p.mirror_pairs || []).filter(x =>
                              !((x.a === pair.a && x.b === pair.b) || (x.a === pair.b && x.b === pair.a)));
                            if (!isActive) return { ...p, mirror_pairs: [...cur, { a: pair.a, b: pair.b, threshold: stratForm.threshold }] };
                            return { ...p, mirror_pairs: cur };
                          });
                        };
                        return (
                          <div key={`${pair.a}${pair.b}`}
                            onClick={togglePair}
                            style={{
                              display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer',
                              background: isActive ? 'rgba(99,102,241,0.18)' : 'rgba(99,102,241,0.04)',
                              border: isActive ? '2px solid rgba(99,102,241,0.55)' : '1px solid rgba(99,102,241,0.15)',
                              borderRadius: 10, padding: '10px 14px',
                              transition: 'all 0.15s',
                            }}>
                            {/* Checkbox visuel */}
                            <div style={{
                              width: 20, height: 20, borderRadius: 6, flexShrink: 0,
                              border: isActive ? '2px solid #6366f1' : '2px solid rgba(99,102,241,0.3)',
                              background: isActive ? '#6366f1' : 'transparent',
                              display: 'flex', alignItems: 'center', justifyContent: 'center',
                              transition: 'all 0.15s',
                            }}>
                              {isActive && <span style={{ color: '#fff', fontSize: 13, fontWeight: 900, lineHeight: 1 }}>✓</span>}
                            </div>
                            <span style={{ fontSize: 22, flexShrink: 0, lineHeight: 1, opacity: isActive ? 1 : 0.4 }}>{pair.a}</span>
                            <span style={{ color: isActive ? '#94a3b8' : '#374151', fontSize: 11, flexShrink: 0 }}>{pair.la}</span>
                            <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8 }}>
                              <span style={{ color: '#475569', fontSize: 11 }}>vs</span>
                            </div>
                            <span style={{ color: isActive ? '#94a3b8' : '#374151', fontSize: 11, flexShrink: 0, textAlign: 'right' }}>{pair.lb}</span>
                            <span style={{ fontSize: 22, flexShrink: 0, lineHeight: 1, opacity: isActive ? 1 : 0.4 }}>{pair.b}</span>
                            {/* Écart — visible seulement si activé */}
                            {isActive && (
                              <div onClick={e => e.stopPropagation()} style={{ display: 'flex', alignItems: 'center', gap: 6, marginLeft: 8 }}>
                                <span style={{ color: '#6366f1', fontSize: 10, fontWeight: 700 }}>ÉCART</span>
                                <input type="number" min={1} max={50} value={thr}
                                  onChange={e => {
                                    const val = Math.max(1, parseInt(e.target.value) || 1);
                                    setStratForm(p => {
                                      const cur = (p.mirror_pairs || []).filter(x =>
                                        !((x.a === pair.a && x.b === pair.b) || (x.a === pair.b && x.b === pair.a)));
                                      return { ...p, mirror_pairs: [...cur, { a: pair.a, b: pair.b, threshold: val }] };
                                    });
                                  }}
                                  style={{ width: 50, padding: '4px 6px', background: 'rgba(99,102,241,0.25)', border: '1px solid rgba(99,102,241,0.55)', borderRadius: 7, color: '#a5b4fc', fontSize: 16, fontWeight: 900, textAlign: 'center' }}
                                />
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                    <div style={{ marginTop: 10, fontSize: 11, color: '#6366f1', lineHeight: 1.5, padding: '7px 10px', borderRadius: 7, background: 'rgba(99,102,241,0.06)' }}>
                      {(stratForm.mirror_pairs?.length || 0) === 0
                        ? '⚠️ Aucune paire cochée — toutes les combinaisons seront comparées avec le seuil global.'
                        : `✓ ${stratForm.mirror_pairs.length} paire(s) active(s) — seules ces combinaisons seront surveillées.`}
                    </div>
                  </div>
                )}

                {/* Numéro à prédire (+1, +2, ...) */}
                {stratForm.mode !== 'relance' && stratForm.mode !== 'taux_miroir' && stratForm.mode !== 'aleatoire' && stratForm.mode !== 'carte_valeur' && <div style={{ gridColumn: '1 / -1' }}>
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
                </div>}

                {/* ── Rattrapages max par stratégie ── */}
                {stratForm.mode !== 'relance' && stratForm.mode !== 'carte_valeur' && (
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
                )}

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
              {stratForm.mode !== 'relance' && stratForm.mode !== 'taux_miroir' && stratForm.mode !== 'aleatoire' && stratForm.mode !== 'carte_valeur' && <>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, margin: '24px 0 14px', padding: '8px 14px', borderRadius: 9, background: 'rgba(251,146,60,0.08)', border: '1px solid rgba(251,146,60,0.2)' }}>
                <span style={{ fontSize: 13 }}>🔁</span>
                <span style={{ fontSize: 11, fontWeight: 800, color: '#fb923c', letterSpacing: 1.2, textTransform: 'uppercase', flex: 1 }}>Séquences de Relance</span>
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
              </>}

              {/* ══════════════ SECTION 4 — MAPPINGS ══════════════ */}
              {stratForm.mode !== 'absence_apparition' && stratForm.mode !== 'distribution' && stratForm.mode !== 'carte_3_vers_2' && stratForm.mode !== 'carte_2_vers_3' && stratForm.mode !== 'taux_miroir' && stratForm.mode !== 'relance' && stratForm.mode !== 'aleatoire' && stratForm.mode !== 'victoire_adverse' && stratForm.mode !== 'abs_3_vers_2' && stratForm.mode !== 'abs_3_vers_3' && stratForm.mode !== 'absence_victoire' && stratForm.mode !== 'lecture_passee' && stratForm.mode !== 'intelligent_cartes' && stratForm.mode !== 'carte_valeur' && stratForm.mode !== 'union_enseignes' && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, margin: '24px 0 14px', padding: '8px 14px', borderRadius: 9, background: 'rgba(148,163,184,0.06)', border: '1px solid rgba(148,163,184,0.15)' }}>
                <span style={{ fontSize: 13 }}>🗺️</span>
                <span style={{ fontSize: 11, fontWeight: 800, color: '#94a3b8', letterSpacing: 1.2, textTransform: 'uppercase', flex: 1 }}>Mappings de prédiction</span>
              </div>
              )}

              {/* Presets de combinaison — masqué pour modes automatiques */}
              {stratForm.mode !== 'absence_apparition' && stratForm.mode !== 'distribution' && stratForm.mode !== 'carte_3_vers_2' && stratForm.mode !== 'carte_2_vers_3' && stratForm.mode !== 'taux_miroir' && stratForm.mode !== 'relance' && stratForm.mode !== 'aleatoire' && stratForm.mode !== 'victoire_adverse' && stratForm.mode !== 'abs_3_vers_2' && stratForm.mode !== 'abs_3_vers_3' && stratForm.mode !== 'absence_victoire' && stratForm.mode !== 'lecture_passee' && stratForm.mode !== 'intelligent_cartes' && stratForm.mode !== 'carte_valeur' && stratForm.mode !== 'union_enseignes' && <div style={{ marginTop: 0 }}>
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

              {/* Mappings manuels — masqué pour modes automatiques */}
              {stratForm.mode !== 'absence_apparition' && stratForm.mode !== 'distribution' && stratForm.mode !== 'carte_3_vers_2' && stratForm.mode !== 'carte_2_vers_3' && stratForm.mode !== 'taux_miroir' && stratForm.mode !== 'relance' && stratForm.mode !== 'aleatoire' && stratForm.mode !== 'victoire_adverse' && stratForm.mode !== 'abs_3_vers_2' && stratForm.mode !== 'abs_3_vers_3' && stratForm.mode !== 'absence_victoire' && stratForm.mode !== 'lecture_passee' && stratForm.mode !== 'intelligent_cartes' && stratForm.mode !== 'carte_valeur' && stratForm.mode !== 'union_enseignes' && <div style={{ marginTop: 16 }}>
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
              {stratForm.mode !== 'relance' && <>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, margin: '24px 0 14px', padding: '8px 14px', borderRadius: 9, background: 'rgba(239,68,68,0.06)', border: '1px solid rgba(239,68,68,0.18)' }}>
                <span style={{ fontSize: 13 }}>🚫</span>
                <span style={{ fontSize: 11, fontWeight: 800, color: '#f87171', letterSpacing: 1.2, textTransform: 'uppercase', flex: 1 }}>Règles d'exception (optionnel)</span>
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
                    { val: 'consec_appearances',   label: '🔁 Apparitions consécutives',    desc: 'Bloquer si la carte prédite est apparue N fois de suite' },
                    { val: 'recent_frequency',     label: '📊 Fréquence récente',            desc: 'Bloquer si la carte prédite est apparue N fois sur W parties' },
                    { val: 'already_pending',      label: '⏳ Déjà en attente',               desc: 'Bloquer si une prédiction pour cette carte est déjà active' },
                    { val: 'max_consec_losses',    label: '📉 Série de défaites',             desc: 'Bloquer si les N dernières prédictions ont été perdues' },
                    { val: 'trigger_overload',     label: '⚡ Déclencheur surchargé',         desc: 'Bloquer si la carte déclencheur est trop fréquente (N fois/W parties)' },
                    { val: 'last_game_appeared',   label: '🎯 Présente au dernier jeu',       desc: 'Bloquer si la carte prédite était présente dans la dernière partie' },
                    { val: 'time_window_block',    label: '🕐 Fenêtre horaire (½ heure)',     desc: 'Bloquer les prédictions pendant la 1ʳᵉ ou 2ᵉ moitié de chaque heure' },
                    { val: 'minute_interval_block',label: '🕑 Intervalle de minutes',         desc: 'Bloquer entre H:MM et H:MM dans chaque heure (ex: :00–:10, :10–:20…)' },
                    { val: 'min_history',          label: '📋 Historique minimum',            desc: 'Bloquer si moins de N parties ont été enregistrées (données insuffisantes)' },
                    { val: 'consec_wins',          label: '🏆 Série de victoires',            desc: 'Bloquer après N victoires consécutives (prise de recul)' },
                    { val: 'suit_absent_long',     label: '💤 Costume absent trop longtemps', desc: 'Bloquer si la carte prédite n\'est pas apparue dans les N dernières parties' },
                    { val: 'high_win_rate',        label: '📈 Taux de victoire élevé',        desc: 'Bloquer si déjà ≥ N victoires sur W parties récentes' },
                    { val: 'pending_overload',     label: '🔢 Trop de prédictions actives',   desc: 'Bloquer si plus de N prédictions sont en attente simultanément' },
                    { val: 'game_parity',          label: '🔀 Parité du jeu',                 desc: 'Bloquer si le numéro de jeu est pair ou impair' },
                    { val: 'dominant_streak',      label: '🔥 Costume dominant répété',       desc: 'Bloquer si la carte prédite a été présente dans les N dernières parties' },
                    { val: 'cold_start',           label: '🧊 Démarrage à froid',             desc: 'Bloquer les N premières parties après démarrage (pas assez de données)' },
                    { val: 'bad_hour',             label: '🌙 Tranche horaire bloquée',       desc: 'Bloquer pendant une plage horaire définie dans la journée (ex: 0h–6h)' },
                    { val: 'double_suit_last',     label: '🃏 Double costume dernier jeu',    desc: 'Bloquer si le dernier jeu avait à la fois la carte prédite et le déclencheur' },
                    { val: 'loss_streak_pause',    label: '⏸️ Pause après défaites',           desc: 'Bloquer pendant N jeux après une série de K défaites consécutives' },
                    { val: 'trigger_card_position', label: '📍 Position carte déclencheur',    desc: 'Bloquer si la carte prédite est à la position 1, 2 ou 3 dans la MAIN CHOISIE du jeu déclencheur (position 1 = 1ère carte de la main, position 2 = 2ème carte…)' },
                    { val: 'consec_same_suit_pred', label: '🚫 Prédictions consécutives même costume', desc: 'Bloquer si le même costume a été prédit N fois de suite. Libération automatique si un autre costume est prédit ou après 20 min.' },
                  ];

                  const needsValue  = ['consec_appearances','recent_frequency','max_consec_losses','trigger_overload','min_history','consec_wins','suit_absent_long','high_win_rate','pending_overload','dominant_streak','cold_start','loss_streak_pause','consec_same_suit_pred'].includes(ex.type);
                  const needsWindow = ['recent_frequency','trigger_overload','high_win_rate','loss_streak_pause'].includes(ex.type);
                  const needsHalf   = ex.type === 'time_window_block';
                  const needsMinInterval = ex.type === 'minute_interval_block';
                  const needsParity = ex.type === 'game_parity';
                  const needsBadHour = ex.type === 'bad_hour';
                  const needsTriggerPos = ex.type === 'trigger_card_position';
                  const currentOpt  = EX_OPTS.find(o => o.val === ex.type);

                  const INP = { padding: '4px 8px', background: '#1e1b2e', border: '1px solid rgba(239,68,68,0.3)', borderRadius: 6, color: '#fff', fontSize: 12 };

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
                                {ex.type === 'max_consec_losses' ? 'Défaites :' : ex.type === 'loss_streak_pause' ? 'Défaites K =' : 'N ='}
                              </label>
                              <input type="number" min="1" max="20" value={ex.value ?? 2}
                                onChange={e => setEx({ value: parseInt(e.target.value) || 2 })}
                                style={{ width: 60, ...INP }} />
                            </div>
                          )}
                          {needsWindow && (
                            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                              <label style={{ color: '#94a3b8', fontSize: 11, whiteSpace: 'nowrap' }}>
                                {ex.type === 'loss_streak_pause' ? 'Pause (jeux) =' : 'Fenêtre W ='}
                              </label>
                              <input type="number" min="2" max="20" value={ex.window ?? 5}
                                onChange={e => setEx({ window: parseInt(e.target.value) || 5 })}
                                style={{ width: 60, ...INP }} />
                            </div>
                          )}
                          <div style={{ color: '#4b5563', fontSize: 11, fontStyle: 'italic' }}>
                            {ex.type === 'consec_appearances'  && `→ bloque si vu ${ex.value ?? 2}x de suite`}
                            {ex.type === 'recent_frequency'    && `→ bloque si ≥ ${ex.value ?? 3}x dans les ${ex.window ?? 5} dernières`}
                            {ex.type === 'max_consec_losses'   && `→ bloque après ${ex.value ?? 3} défaites d'affilée`}
                            {ex.type === 'trigger_overload'    && `→ bloque si déclencheur ≥ ${ex.value ?? 3}x dans les ${ex.window ?? 5} parties`}
                            {ex.type === 'min_history'         && `→ bloque si < ${ex.value ?? 5} parties en mémoire`}
                            {ex.type === 'consec_wins'         && `→ bloque après ${ex.value ?? 3} victoires consécutives`}
                            {ex.type === 'suit_absent_long'    && `→ bloque si absent des ${ex.value ?? 5} dernières parties`}
                            {ex.type === 'high_win_rate'       && `→ bloque si ≥ ${ex.value ?? 4} victoires dans les ${ex.window ?? 5} dernières`}
                            {ex.type === 'pending_overload'    && `→ bloque si ≥ ${ex.value ?? 2} prédictions simultanées`}
                            {ex.type === 'dominant_streak'     && `→ bloque si présent dans les ${ex.value ?? 3} dernières parties`}
                            {ex.type === 'cold_start'          && `→ bloque les ${ex.value ?? 10} premières parties`}
                            {ex.type === 'loss_streak_pause'   && `→ pause ${ex.window ?? 2} jeux après ${ex.value ?? 3} défaites de suite`}
                            {ex.type === 'consec_same_suit_pred' && `→ bloque si le même costume est prédit ${ex.value ?? 3}x de suite (libéré après autre costume ou 20 min)`}
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
                            <button key={opt.val} type="button" onClick={() => setEx({ half: opt.val })} title={opt.hint}
                              style={{ padding: '4px 12px', borderRadius: 6, fontSize: 11, cursor: 'pointer',
                                background: (ex.half ?? 'second') === opt.val ? 'rgba(239,68,68,0.25)' : 'rgba(239,68,68,0.07)',
                                border: `1px solid ${(ex.half ?? 'second') === opt.val ? 'rgba(239,68,68,0.6)' : 'rgba(239,68,68,0.2)'}`,
                                color: (ex.half ?? 'second') === opt.val ? '#fca5a5' : '#6b7280',
                                fontWeight: (ex.half ?? 'second') === opt.val ? 700 : 400,
                              }}>{opt.label}</button>
                          ))}
                          <div style={{ color: '#4b5563', fontSize: 11, fontStyle: 'italic' }}>
                            → bloque pendant la {(ex.half ?? 'second') === 'first' ? '1ʳᵉ (00–29 min)' : '2ᵉ (30–59 min)'} moitié de chaque heure
                          </div>
                        </div>
                      )}

                      {needsMinInterval && (
                        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                          <label style={{ color: '#94a3b8', fontSize: 11, whiteSpace: 'nowrap' }}>Intervalle bloqué :</label>
                          <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
                            <span style={{ color: '#94a3b8', fontSize: 11 }}>H:</span>
                            <input type="number" min="0" max="58" value={ex.from ?? 0}
                              onChange={e => setEx({ from: parseInt(e.target.value) || 0 })}
                              style={{ width: 55, ...INP }} />
                            <span style={{ color: '#94a3b8', fontSize: 11 }}>→ H:</span>
                            <input type="number" min="1" max="59" value={ex.to ?? 10}
                              onChange={e => setEx({ to: parseInt(e.target.value) || 10 })}
                              style={{ width: 55, ...INP }} />
                          </div>
                          <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                            {[[0,10],[10,20],[20,30],[30,40],[40,50],[50,59]].map(([f,t]) => (
                              <button key={f} type="button" onClick={() => setEx({ from: f, to: t })}
                                style={{ padding: '3px 8px', borderRadius: 5, fontSize: 10, cursor: 'pointer',
                                  background: (ex.from??0) === f && (ex.to??10) === t ? 'rgba(239,68,68,0.3)' : 'rgba(239,68,68,0.07)',
                                  border: `1px solid ${(ex.from??0) === f && (ex.to??10) === t ? 'rgba(239,68,68,0.7)' : 'rgba(239,68,68,0.2)'}`,
                                  color: (ex.from??0) === f && (ex.to??10) === t ? '#fca5a5' : '#6b7280' }}>
                                :{String(f).padStart(2,'0')}–:{String(t).padStart(2,'0')}
                              </button>
                            ))}
                          </div>
                          <div style={{ color: '#4b5563', fontSize: 11, fontStyle: 'italic', width: '100%' }}>
                            → bloque de H:{String(ex.from??0).padStart(2,'0')} à H:{String(ex.to??10).padStart(2,'0')} chaque heure
                          </div>
                        </div>
                      )}

                      {needsParity && (
                        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                          <label style={{ color: '#94a3b8', fontSize: 11, whiteSpace: 'nowrap' }}>Bloquer si jeu :</label>
                          {[{ val: 'even', label: '2️⃣ Pair' }, { val: 'odd', label: '1️⃣ Impair' }].map(opt => (
                            <button key={opt.val} type="button" onClick={() => setEx({ parity: opt.val })}
                              style={{ padding: '4px 14px', borderRadius: 6, fontSize: 11, cursor: 'pointer',
                                background: (ex.parity ?? 'even') === opt.val ? 'rgba(239,68,68,0.25)' : 'rgba(239,68,68,0.07)',
                                border: `1px solid ${(ex.parity ?? 'even') === opt.val ? 'rgba(239,68,68,0.6)' : 'rgba(239,68,68,0.2)'}`,
                                color: (ex.parity ?? 'even') === opt.val ? '#fca5a5' : '#6b7280',
                                fontWeight: (ex.parity ?? 'even') === opt.val ? 700 : 400 }}>{opt.label}</button>
                          ))}
                          <div style={{ color: '#4b5563', fontSize: 11, fontStyle: 'italic' }}>
                            → bloque quand le numéro de jeu est {(ex.parity ?? 'even') === 'even' ? 'pair' : 'impair'}
                          </div>
                        </div>
                      )}

                      {needsBadHour && (
                        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                          <label style={{ color: '#94a3b8', fontSize: 11, whiteSpace: 'nowrap' }}>Tranche bloquée :</label>
                          <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
                            <input type="number" min="0" max="23" value={ex.from_hour ?? 0}
                              onChange={e => setEx({ from_hour: parseInt(e.target.value) || 0 })}
                              style={{ width: 55, ...INP }} />
                            <span style={{ color: '#94a3b8', fontSize: 11 }}>h → </span>
                            <input type="number" min="0" max="23" value={ex.to_hour ?? 6}
                              onChange={e => setEx({ to_hour: parseInt(e.target.value) || 6 })}
                              style={{ width: 55, ...INP }} />
                            <span style={{ color: '#94a3b8', fontSize: 11 }}>h</span>
                          </div>
                          <div style={{ color: '#4b5563', fontSize: 11, fontStyle: 'italic' }}>
                            → bloque de {ex.from_hour ?? 0}h à {ex.to_hour ?? 6}h chaque jour
                          </div>
                        </div>
                      )}

                      {needsTriggerPos && (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                          <label style={{ color: '#94a3b8', fontSize: 11 }}>Bloquer si la carte prédite est à la position dans la main choisie :</label>
                          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                            {[
                              { pos: 1, label: '1ʳᵉ carte', hint: '1ère carte de la main choisie' },
                              { pos: 2, label: '2ᵉ carte',  hint: '2ème carte de la main choisie' },
                              { pos: 3, label: '3ᵉ carte',  hint: '3ème carte de la main (si droit)' },
                            ].map(({ pos, label, hint }) => {
                              const cur = Array.isArray(ex.positions) ? ex.positions.map(Number) : [1];
                              const active = cur.includes(pos);
                              return (
                                <button key={pos} type="button" title={hint}
                                  onClick={() => {
                                    const next = active ? cur.filter(p => p !== pos) : [...cur, pos];
                                    setEx({ positions: next.length ? next : [pos] });
                                  }}
                                  style={{ padding: '4px 12px', borderRadius: 6, fontSize: 11, cursor: 'pointer',
                                    background: active ? 'rgba(239,68,68,0.3)' : 'rgba(239,68,68,0.07)',
                                    border: `1px solid ${active ? 'rgba(239,68,68,0.7)' : 'rgba(239,68,68,0.2)'}`,
                                    color: active ? '#fca5a5' : '#6b7280', fontWeight: active ? 700 : 400 }}>
                                  {label}
                                </button>
                              );
                            })}
                          </div>
                          <div style={{ color: '#4b5563', fontSize: 11, fontStyle: 'italic' }}>
                            → bloque si la carte prédite est en position {(Array.isArray(ex.positions) ? ex.positions : [1]).sort((a,b)=>a-b).join(', ')} dans la main choisie du jeu déclencheur
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
              </>}

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
            <div style={{ display: 'flex', gap: 8 }}>
              <button
                onClick={loadStratStats}
                style={{ padding: '6px 14px', borderRadius: 8, border: '1px solid rgba(251,191,36,0.4)', background: 'transparent', color: '#fbbf24', cursor: 'pointer', fontSize: 12, fontWeight: 700 }}
              >🔄 Actualiser</button>
              <button
                onClick={async () => {
                  if (!confirm(
                    '🧹 NETTOYAGE DES PRÉDICTIONS\n\n' +
                    'SERA SUPPRIMÉ :\n' +
                    '✓ Tout l\'historique de prédictions (gains, pertes)\n' +
                    '✓ Messages Telegram stockés\n' +
                    '✓ Compteurs d\'absences (redémarrage à 0)\n' +
                    '✓ Bilan quotidien\n\n' +
                    'SERA CONSERVÉ :\n' +
                    '✓ Comptes utilisateurs\n' +
                    '✓ Canaux Telegram configurés\n' +
                    '✓ Configuration des stratégies\n' +
                    '✓ Format de message, styles\n\n' +
                    'Confirmer ?'
                  )) return;
                  const r = await fetch('/api/admin/reset-all-stats', { method: 'POST', credentials: 'include' });
                  const d = await r.json();
                  if (d.ok) {
                    alert(`✅ Base nettoyée — ${d.deleted} prédiction(s) supprimée(s)\nCompteurs remis à 0. Prêt à reprendre.`);
                    loadStratStats();
                  } else alert('❌ ' + (d.error || 'Erreur'));
                }}
                style={{ padding: '6px 14px', borderRadius: 8, border: '1px solid rgba(239,68,68,0.4)', background: 'transparent', color: '#f87171', cursor: 'pointer', fontSize: 12, fontWeight: 700 }}
              >🧹 Repartir à zéro</button>
            </div>
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

                      {/* ── Bouton reset stats ── */}
                      {st.total > 0 && (
                        <button
                          type="button"
                          onClick={async () => {
                            if (!confirm(`Supprimer tout l'historique de ${ch.name} (${st.total} prédictions) ?\n\nCette action est irréversible.`)) return;
                            const r = await fetch(`/api/admin/strategies/${ch.id}/reset-stats`, { method: 'POST', credentials: 'include' });
                            const d = await r.json();
                            if (d.ok) { alert(`✅ ${d.deleted} prédiction(s) supprimée(s)`); loadStratStats(); }
                            else alert('❌ ' + (d.error || 'Erreur'));
                          }}
                          style={{ marginTop: 10, width: '100%', padding: '6px 0', borderRadius: 7, border: '1px solid rgba(239,68,68,0.3)', background: 'rgba(239,68,68,0.06)', color: '#f87171', fontWeight: 700, fontSize: 11, cursor: 'pointer', letterSpacing: 0.4 }}
                        >
                          🔄 Remettre à 0
                        </button>
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

        {/* ── EFFACEMENT MANUEL DES PRÉDICTIONS ── */}
        {/* ── EFFACER DONNÉES D'UNE STRATÉGIE SPÉCIFIQUE ── */}
        {adminTab === 'systeme' && (
        <div className="tg-admin-card" style={{ borderColor: 'rgba(168,85,247,0.45)', marginBottom: 20 }}>
          <div className="tg-admin-header">
            <span className="tg-admin-icon">🗑️</span>
            <div style={{ flex: 1 }}>
              <h2 className="tg-admin-title">Effacer les données d'une stratégie</h2>
              <p className="tg-admin-sub">
                Supprime toutes les <strong style={{ color: '#c084fc' }}>prédictions</strong> et messages Telegram liés à <em>une seule stratégie</em> choisie — libère ses verrous en mémoire.<br/>
                <span style={{ color: '#6b7280', fontSize: 11 }}>Fonctionne pour les stratégies par défaut (C1, C2, C3, DC), les stratégies personnalisées (S1-S16) et les stratégies Pro (S5001+). Les configurations sont conservées.</span>
              </p>
            </div>
          </div>
          <div style={{ display: 'flex', gap: 10, alignItems: 'flex-end', flexWrap: 'wrap', marginTop: 12 }}>
            <div style={{ flex: 1, minWidth: 200 }}>
              <label style={{ fontSize: 11, color: '#94a3b8', fontWeight: 700, display: 'block', marginBottom: 5 }}>Stratégie à vider</label>
              <select
                value={clearStratId}
                onChange={e => { setClearStratId(e.target.value); setClearStratMsg(null); }}
                style={{ width: '100%', padding: '9px 12px', borderRadius: 8, border: '1px solid rgba(168,85,247,0.4)', background: '#0f172a', color: '#e2e8f0', fontSize: 13 }}
              >
                <option value="">-- Choisir une stratégie --</option>
                <optgroup label="Stratégies par défaut">
                  {[['C1','♠ Pique Noir (C1)'],['C2','♥ Cœur Rouge (C2)'],['C3','♦ Carreau Doré (C3)'],['DC','♣ Double Canal (DC)']].map(([v,l])=>
                    <option key={v} value={v}>{l}</option>
                  )}
                </optgroup>
                {strategies.length > 0 && (
                  <optgroup label="Stratégies personnalisées">
                    {strategies.map(s => <option key={s.id} value={String(s.id)}>S{s.id} — {s.name}</option>)}
                  </optgroup>
                )}
                {proStrategies.length > 0 && (
                  <optgroup label="Stratégies Pro (S5001+)">
                    {proStrategies.map(s => <option key={s.id} value={String(s.id)}>S{s.id} — {s.strategy_name || s.name || s.filename}</option>)}
                  </optgroup>
                )}
              </select>
            </div>
            <button
              disabled={!clearStratId || clearStratBusy}
              onClick={async () => {
                if (!clearStratId) return;
                const label = clearStratId;
                if (!confirm(`🗑️ Effacer TOUTES les données de prédiction pour la stratégie ${label} ?\n\n✓ Prédictions (gagnées, perdues, en attente)\n✓ Messages Telegram liés\n✓ Déblocage des verrous mémoire\n\nLa configuration de la stratégie est conservée.\n\nConfirmer ?`)) return;
                setClearStratBusy(true);
                setClearStratMsg(null);
                try {
                  const r = await fetch(`/api/admin/strategies/${clearStratId}/data`, { method: 'DELETE', credentials: 'include' });
                  const d = await r.json();
                  if (r.ok && d.ok) {
                    setClearStratMsg({ ok: true, text: `✅ ${d.deleted} prédiction(s) supprimée(s) pour ${d.strategy}.` });
                  } else {
                    setClearStratMsg({ ok: false, text: '❌ ' + (d.error || 'Erreur inconnue') });
                  }
                } catch (e) {
                  setClearStratMsg({ ok: false, text: '❌ Erreur réseau : ' + e.message });
                } finally { setClearStratBusy(false); }
              }}
              style={{
                padding: '9px 22px', borderRadius: 8, border: 'none',
                background: clearStratId && !clearStratBusy ? 'linear-gradient(135deg,#7c3aed,#5b21b6)' : '#1e293b',
                color: clearStratId && !clearStratBusy ? '#fff' : '#475569',
                fontWeight: 700, fontSize: 13, cursor: clearStratId && !clearStratBusy ? 'pointer' : 'default',
                transition: 'all .15s', whiteSpace: 'nowrap',
              }}
            >
              {clearStratBusy ? '⏳ Suppression…' : '🗑️ Effacer les données'}
            </button>
          </div>
          {clearStratMsg && (
            <div style={{ marginTop: 10, padding: '8px 12px', borderRadius: 8, fontSize: 13, fontWeight: 600,
              background: clearStratMsg.ok ? 'rgba(34,197,94,0.1)' : 'rgba(239,68,68,0.1)',
              color: clearStratMsg.ok ? '#4ade80' : '#f87171',
              border: `1px solid ${clearStratMsg.ok ? 'rgba(34,197,94,0.3)' : 'rgba(239,68,68,0.3)'}`,
            }}>
              {clearStratMsg.text}
            </div>
          )}
        </div>)}

        {adminTab === 'systeme' && (
        <div className="tg-admin-card" style={{ borderColor: 'rgba(251,146,60,0.5)', marginBottom: 20 }}>
          <div className="tg-admin-header">
            <span className="tg-admin-icon">🧹</span>
            <div style={{ flex: 1 }}>
              <h2 className="tg-admin-title">Effacer toutes les prédictions</h2>
              <p className="tg-admin-sub">
                Supprime <strong style={{ color: '#fb923c' }}>toutes les prédictions stockées et vérifiées</strong> en base de données ainsi que les messages Telegram associés.<br/>
                Libère immédiatement toutes les stratégies bloquées en attente.<br/>
                <span style={{ color: '#6b7280', fontSize: 11 }}>Conserve : stratégies, canaux, utilisateurs, bilan, compteurs d'absences.</span>
              </p>
            </div>
          </div>
          <button
            className="btn btn-sm"
            style={{
              background: 'linear-gradient(135deg,#ea580c,#c2410c)',
              border: 'none', color: '#fff', fontWeight: 700, fontSize: 13,
              padding: '10px 28px', borderRadius: 10, cursor: 'pointer', marginTop: 8,
            }}
            onClick={async () => {
              if (!confirm('🧹 Effacer TOUTES les prédictions stockées en base de données ?\n\n✓ Prédictions (gagnées, perdues, en attente)\n✓ Messages Telegram liés\n✓ Déblocage de toutes les stratégies\n\nLes stratégies, canaux et configs sont conservés.\n\nConfirmer ?')) return;
              try {
                const r = await fetch('/api/admin/clear-predictions', { method: 'POST', credentials: 'include' });
                const d = await r.json();
                if (d.ok) {
                  const ext = d.extDeleted > 0 ? `\n📡 Base Render externe : ${d.extDeleted} supprimée(s)` : '';
                  alert(`✅ Prédictions effacées !\n\n🗄️ Base locale : ${d.deleted} prédiction(s)\n${ext}\n\nToutes les stratégies sont libérées et prêtes pour de nouvelles prédictions.`);
                } else {
                  alert('❌ Erreur : ' + (d.error || 'Échec'));
                }
              } catch (e) { alert('❌ Erreur réseau : ' + e.message); }
            }}
          >
            🧹 Effacer toutes les prédictions
          </button>
        </div>)}

        {/* ── RESET USINE ── */}
        {adminTab === 'systeme' && (
        <div className="tg-admin-card" style={{ borderColor: 'rgba(239,68,68,0.5)', marginBottom: 20 }}>
          <div className="tg-admin-header">
            <span className="tg-admin-icon">🔄</span>
            <div style={{ flex: 1 }}>
              <h2 className="tg-admin-title">Réinitialisation complète</h2>
              <p className="tg-admin-sub">
                Remet <strong style={{ color: '#f87171' }}>tout le système à zéro</strong> : stratégies, séquences de relance, prédictions, canaux Telegram, routage, annonces, compteurs, et tous les paramètres.
                <br/><span style={{ color: '#f87171', fontWeight: 600, fontSize: 11 }}>⚠️ Cette action est irréversible.</span>
              </p>
            </div>
          </div>
          <button
            className="btn btn-sm"
            style={{
              background: 'linear-gradient(135deg,#dc2626,#991b1b)',
              border: 'none',
              color: '#fff',
              fontWeight: 700,
              fontSize: 13,
              padding: '10px 28px',
              borderRadius: 10,
              cursor: 'pointer',
              marginTop: 8,
            }}
            onClick={async () => {
              const c1 = confirm('⚠️ ATTENTION : Cela va supprimer TOUTES les données (stratégies, prédictions, canaux, relances, annonces…)\n\nVoulez-vous vraiment continuer ?');
              if (!c1) return;
              const c2 = confirm('🔴 DERNIÈRE CONFIRMATION\n\nTout sera effacé définitivement.\nÊtes-vous absolument sûr ?');
              if (!c2) return;
              try {
                const r = await fetch('/api/admin/factory-reset', { method: 'POST', credentials: 'include' });
                const d = await r.json();
                if (r.ok) {
                  alert('✅ Système réinitialisé avec succès.\nLa page va se recharger.');
                  window.location.reload();
                } else {
                  alert('❌ Erreur : ' + (d.error || 'Échec du reset'));
                }
              } catch (e) {
                alert('❌ Erreur réseau : ' + e.message);
              }
            }}
          >
            🗑️ Réinitialiser tout le système
          </button>
        </div>)}

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

          {/* ── Fichiers JSON déjà sur le serveur ── */}
          <div style={{ marginBottom: 14, background: 'rgba(34,197,94,0.05)', border: '1px solid rgba(34,197,94,0.2)', borderRadius: 12, padding: '14px 16px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 }}>
              <span style={{ fontSize: 16 }}>🗂️</span>
              <span style={{ fontWeight: 700, color: '#86efac', fontSize: 13, flex: 1 }}>Fichiers JSON sur le serveur</span>
              <button
                className="btn btn-sm"
                style={{ background: 'rgba(34,197,94,0.15)', border: '1px solid rgba(34,197,94,0.3)', color: '#86efac', fontSize: 12, padding: '4px 12px', borderRadius: 7, cursor: 'pointer' }}
                onClick={loadServerUpdateFiles}
                disabled={serverFilesLoading}
              >
                {serverFilesLoading ? '⏳' : '🔄 Actualiser'}
              </button>
            </div>

            {serverUpdateFiles.length === 0 && !serverFilesLoading && (
              <div style={{ fontSize: 12, color: '#64748b', textAlign: 'center', padding: '8px 0' }}>
                Cliquez sur "Actualiser" pour voir les fichiers JSON disponibles sur le serveur.
              </div>
            )}

            {serverUpdateFiles.map(f => (
              <div key={f.name} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 10px', background: 'rgba(0,0,0,0.2)', borderRadius: 8, marginBottom: 6 }}>
                <span style={{ fontSize: 14 }}>📄</span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontWeight: 600, color: '#e2e8f0', fontSize: 13, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{f.name}</div>
                  {f.preview && <div style={{ fontSize: 11, color: '#94a3b8', marginTop: 2 }}>{f.preview}</div>}
                  <div style={{ fontSize: 10, color: '#475569', marginTop: 1 }}>{(f.size / 1024).toFixed(1)} Ko — {new Date(f.mtime).toLocaleString('fr-FR')}</div>
                </div>
                <button
                  className="btn btn-sm"
                  style={{ background: 'linear-gradient(135deg,#16a34a,#22c55e)', border: 'none', color: '#fff', fontWeight: 700, fontSize: 12, padding: '6px 14px', borderRadius: 7, cursor: 'pointer', whiteSpace: 'nowrap', opacity: serverApplyingFile === f.name ? 0.7 : 1 }}
                  disabled={!!serverApplyingFile}
                  onClick={() => applyServerFile(f.name)}
                >
                  {serverApplyingFile === f.name ? '⏳…' : '⚡ Appliquer'}
                </button>
              </div>
            ))}

            {serverUpdateResult && (
              <div style={{ marginTop: 10, background: serverUpdateResult.ok ? 'rgba(34,197,94,0.08)' : 'rgba(248,113,113,0.08)', border: `1px solid ${serverUpdateResult.ok ? 'rgba(34,197,94,0.3)' : 'rgba(248,113,113,0.3)'}`, borderRadius: 8, padding: '10px 14px' }}>
                <div style={{ fontWeight: 700, fontSize: 13, color: serverUpdateResult.ok ? '#22c55e' : '#f87171', marginBottom: 6 }}>
                  {serverUpdateResult.ok ? `✅ "${serverUpdateResult.filename}" appliqué — ${serverUpdateResult.total_applied} changement(s)` : `❌ Erreur : ${serverUpdateResult.error || 'Échec'}`}
                </div>
                {(serverUpdateResult.results || []).map((r2, i) => (
                  <div key={i} style={{ fontSize: 12, color: r2.applied > 0 ? '#86efac' : '#fca5a5', marginBottom: 3 }}>
                    <strong>{r2.type}</strong>: {r2.applied} appliqué(s)
                    {r2.errors?.length > 0 && <span style={{ color: '#fbbf24' }}> ⚠️ {r2.errors.join(' | ')}</span>}
                  </div>
                ))}
                {serverUpdateResult.errors?.length > 0 && !serverUpdateResult.results && (
                  <div style={{ fontSize: 12, color: '#fca5a5' }}>{serverUpdateResult.errors.join(' | ')}</div>
                )}
                <button className="btn btn-sm" style={{ marginTop: 8, fontSize: 11, color: '#94a3b8', background: 'rgba(100,116,139,0.1)', border: '1px solid rgba(100,116,139,0.2)' }} onClick={() => setServerUpdateResult(null)}>Fermer</button>
              </div>
            )}
          </div>

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

          {/* ── Export configuration ── */}
          <div style={{
            marginTop: 18, background: 'rgba(6,182,212,0.06)',
            border: '1px solid rgba(6,182,212,0.25)', borderRadius: 12, padding: '14px 18px',
            display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap',
          }}>
            <div style={{ flex: 1 }}>
              <div style={{ fontWeight: 700, color: '#22d3ee', fontSize: 13 }}>📤 Exporter la configuration</div>
              <div style={{ fontSize: 11, color: '#64748b', marginTop: 3 }}>
                Télécharge un fichier JSON <strong style={{ color: '#22d3ee' }}>v3.0 — 100% complet</strong> : stratégies, séquences, canaux Telegram, annonces, messages utilisateurs, bot de chat, vidéos tutoriels, clés API IA, bots Programmation, CSS, styles, tokens &amp; URLs.
                Peut être réimporté directement via le bouton "Fichier de mise à jour" ci-dessus — aucune donnée perdue.
              </div>
            </div>
            <button
              className="btn btn-sm"
              style={{ background: 'linear-gradient(135deg,#0891b2,#06b6d4)', border: 'none', color: '#fff', fontWeight: 700, fontSize: 13, padding: '9px 20px', borderRadius: 9, cursor: 'pointer', whiteSpace: 'nowrap' }}
              onClick={async () => {
                try {
                  const r = await fetch('/api/admin/export-config', { credentials: 'include' });
                  if (!r.ok) { alert('❌ Erreur lors de l\'export'); return; }
                  const blob = await r.blob();
                  const url = URL.createObjectURL(blob);
                  const a = document.createElement('a');
                  a.href = url;
                  a.download = `baccarat-pro-config-${new Date().toISOString().slice(0,10)}.json`;
                  a.click(); URL.revokeObjectURL(url);
                } catch (e) { alert('❌ Erreur : ' + e.message); }
              }}
            >
              📥 Télécharger config.json
            </button>
          </div>

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
                  ⚠️ Redémarrez le serveur par Sossou Kouamé, les changements backend seront appliqués en cours.
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

          {/* CSS personnalisé actif */}
          {customCssInfo.length > 0 && (
            <div style={{ borderTop: '1px solid rgba(52,211,153,0.15)', paddingTop: 12, marginTop: 4 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div style={{ fontSize: 12, fontWeight: 700, color: '#34d399' }}>
                  💉 CSS personnalisé actif — {customCssInfo.length} caractères (injecté sans rebuild)
                </div>
                <button
                  className="btn btn-sm"
                  style={{ fontSize: 11, color: '#f87171', background: 'rgba(248,113,113,0.08)', border: '1px solid rgba(248,113,113,0.2)' }}
                  onClick={async () => {
                    if (!confirm('Supprimer tout le CSS personnalisé ?')) return;
                    await fetch('/api/admin/custom-css', { method: 'DELETE', credentials: 'include' });
                    setCustomCssInfo({ css: '', length: 0 });
                    injectCustomCss('');
                  }}
                >🗑️ Supprimer</button>
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

        {/* ── CONTRÔLE SERVEURS (STOP) ── */}
        {adminTab === 'systeme' && (
        <div className="tg-admin-card" style={{ borderColor: 'rgba(239,68,68,0.5)', marginTop: 20 }}>
          <div className="tg-admin-header">
            <span className="tg-admin-icon">⚡</span>
            <div style={{ flex: 1 }}>
              <h2 className="tg-admin-title">Contrôle des serveurs</h2>
              <p className="tg-admin-sub">
                Arrêtez le serveur Replit (redémarrage automatique via workflow) ou suspendez le service Render.com via l'API REST.<br/>
                <span style={{ color: '#6b7280', fontSize: 11 }}>Pour Render : configurez d'abord le Service ID et la clé API ci-dessous.</span>
              </p>
            </div>
          </div>
          <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginBottom: 16 }}>
            <button
              className="btn btn-sm"
              style={{ background: 'linear-gradient(135deg,#b45309,#d97706)', border: 'none', color: '#fff', fontWeight: 700, fontSize: 13, padding: '10px 22px', borderRadius: 10, cursor: 'pointer' }}
              onClick={async () => {
                if (!confirm('⚡ Arrêter le serveur Replit maintenant ?\nIl redémarrera automatiquement via le workflow.')) return;
                try {
                  const r = await fetch('/api/admin/stop-server', { method: 'POST', credentials: 'include' });
                  const d = await r.json();
                  alert(d.message || '✅ Commande envoyée');
                } catch (e) { alert('❌ Erreur : ' + e.message); }
              }}
            >⏹ Arrêter Replit</button>
            <button
              className="btn btn-sm"
              style={{ background: 'linear-gradient(135deg,#7c3aed,#a855f7)', border: 'none', color: '#fff', fontWeight: 700, fontSize: 13, padding: '10px 22px', borderRadius: 10, cursor: 'pointer' }}
              onClick={async () => {
                if (!confirm('🟣 Suspendre le service Render.com ?\nIl s\'arrêtera et consommera 0 heures jusqu\'à la prochaine requête entrante.')) return;
                try {
                  const r = await fetch('/api/admin/stop-render', { method: 'POST', credentials: 'include' });
                  const d = await r.json();
                  if (r.ok) alert('✅ ' + d.message);
                  else alert('❌ ' + d.error);
                } catch (e) { alert('❌ Erreur réseau : ' + e.message); }
              }}
            >🟣 Suspendre Render</button>
          </div>

          {/* Config Render API */}
          <div style={{ borderTop: '1px solid rgba(255,255,255,0.08)', paddingTop: 14 }}>
            <div style={{ fontSize: 12, fontWeight: 700, color: '#94a3b8', marginBottom: 10 }}>Configuration API Render.com</div>
            {[
              { key: 'render_service_id', label: 'Render Service ID (srv-xxxxx)', placeholder: 'srv-xxxxxxxxxxxxxxxxxxxxx' },
              { key: 'render_api_key',    label: 'Render API Key', placeholder: 'rnd_xxxxxxxxxxxx', type: 'password' },
            ].map(({ key, label, placeholder, type }) => (
              <div key={key} style={{ marginBottom: 10 }}>
                <label style={{ fontSize: 11, color: '#94a3b8', display: 'block', marginBottom: 3 }}>{label}</label>
                <div style={{ display: 'flex', gap: 8 }}>
                  <input
                    type={type || 'text'}
                    className="tg-input"
                    placeholder={placeholder}
                    style={{ flex: 1, fontFamily: 'monospace', fontSize: 12 }}
                    onBlur={async (e) => {
                      const val = e.target.value.trim();
                      if (!val) return;
                      await fetch('/api/admin/settings', {
                        method: 'POST', credentials: 'include',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ key, value: val }),
                      });
                      e.target.value = '';
                      e.target.placeholder = '✅ Sauvegardé';
                      setTimeout(() => { e.target.placeholder = placeholder; }, 2000);
                    }}
                  />
                </div>
              </div>
            ))}
          </div>
        </div>)}

        {/* ── RÉPARATION IA — dans Système ── */}
        {adminTab === 'systeme' && (
        <div className="tg-admin-card" style={{ borderColor: 'rgba(168,85,247,0.4)', marginTop: 20 }}>
          <div className="tg-admin-header">
            <span className="tg-admin-icon">🔧</span>
            <div style={{ flex: 1 }}>
              <h2 className="tg-admin-title">Réparation IA automatique</h2>
              <p className="tg-admin-sub">
                L'IA analyse l'état du moteur, les prédictions bloquées et les logs d'erreurs, puis propose des corrections de code applicables en un clic.
                {!aiConfigData.hasKey && (
                  <span style={{ color: '#f87171', marginLeft: 6 }}>⚠️ Configurez d'abord un provider IA dans l'onglet <strong>🧠 Config IA</strong></span>
                )}
              </p>
            </div>
            {aiConfigData.hasKey && (
              <span style={{ fontSize: 11, padding: '4px 12px', borderRadius: 20, background: 'rgba(34,197,94,0.12)', border: '1px solid rgba(34,197,94,0.3)', color: '#4ade80', fontWeight: 700 }}>
                🧠 {aiConfigData.provider} actif
              </span>
            )}
          </div>

          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginBottom: aiRepairResult ? 16 : 0 }}>
            <button
              onClick={async () => {
                setAiSmartRepairing(true); setAiRepairResult(null); setAiApplyLog([]);
                try {
                  const r = await fetch('/api/ai/repair-smart', { method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ autofix: true }) });
                  const d = await r.json();
                  setAiRepairResult(d);
                } catch (e) { setAiRepairResult({ ok: false, error: e.message }); }
                setAiSmartRepairing(false);
              }}
              disabled={aiSmartRepairing || aiRepairing}
              style={{ padding: '13px 22px', borderRadius: 12, border: 'none', background: aiSmartRepairing ? 'rgba(34,197,94,0.2)' : 'linear-gradient(135deg,#059669,#10b981)', color: '#fff', fontWeight: 800, fontSize: 13, cursor: (aiSmartRepairing || aiRepairing) ? 'not-allowed' : 'pointer', display: 'flex', alignItems: 'center', gap: 8 }}
            >
              {aiSmartRepairing ? (
                <><span style={{ display: 'inline-block', width: 14, height: 14, border: '2px solid rgba(255,255,255,0.3)', borderTopColor: '#fff', borderRadius: '50%', animation: 'spin 0.8s linear infinite' }} /> Analyse…</>
              ) : <><span>⚡</span> Diagnostic intelligent</>}
            </button>
            <button
              onClick={async () => {
                if (!aiConfigData.hasKey) {
                  alert('Configurez d\'abord un provider IA dans l\'onglet "🧠 Config IA".');
                  setAdminTab('config-ia');
                  return;
                }
                setAiRepairing(true); setAiRepairResult(null); setAiApplyLog([]);
                try {
                  const r = await fetch('/api/ai/repair', { method: 'POST', credentials: 'include' });
                  const d = await r.json();
                  setAiRepairResult(d);
                } catch (e) { setAiRepairResult({ ok: false, error: e.message }); }
                setAiRepairing(false);
              }}
              disabled={aiRepairing || aiSmartRepairing}
              style={{ padding: '13px 22px', borderRadius: 12, border: '1px solid rgba(168,85,247,0.4)', background: aiRepairing ? 'rgba(168,85,247,0.1)' : 'transparent', color: '#c084fc', fontWeight: 700, fontSize: 13, cursor: (aiRepairing || aiSmartRepairing) ? 'not-allowed' : 'pointer', display: 'flex', alignItems: 'center', gap: 8 }}
            >
              {aiRepairing ? (
                <><span style={{ display: 'inline-block', width: 14, height: 14, border: '2px solid rgba(168,85,247,0.3)', borderTopColor: '#c084fc', borderRadius: '50%', animation: 'spin 0.8s linear infinite' }} /> Analyse IA (30–60s)…</>
              ) : <><span>🔍</span> Diagnostic IA</>}
            </button>
          </div>

          {aiRepairResult && !aiRepairResult.ok && (
            <div style={{ padding: '12px 16px', borderRadius: 10, background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.35)', color: '#f87171', fontSize: 13 }}>
              ❌ {aiRepairResult.error}
            </div>
          )}

          {aiRepairResult?.result && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              {/* Score santé */}
              <div style={{ display: 'flex', alignItems: 'center', gap: 14, padding: '14px 18px', borderRadius: 12, background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)' }}>
                <div style={{ fontSize: 38, fontWeight: 900, color: aiRepairResult.result.score_sante >= 80 ? '#4ade80' : aiRepairResult.result.score_sante >= 50 ? '#fbbf24' : '#f87171' }}>
                  {aiRepairResult.result.score_sante}%
                </div>
                <div>
                  <div style={{ fontWeight: 700, color: '#e2e8f0', fontSize: 14, marginBottom: 4 }}>Score de santé du système</div>
                  <div style={{ fontSize: 12, color: '#94a3b8', lineHeight: 1.6 }}>{aiRepairResult.result.diagnostic}</div>
                </div>
              </div>

              {/* Corrections automatiques appliquées */}
              {(aiRepairResult.result.fixesApplied || []).length > 0 && (
                <div>
                  <div style={{ fontSize: 11, color: '#64748b', fontWeight: 800, textTransform: 'uppercase', letterSpacing: 1, marginBottom: 8 }}>✅ Corrections appliquées automatiquement</div>
                  {aiRepairResult.result.fixesApplied.map((f, i) => (
                    <div key={i} style={{ padding: '9px 14px', borderRadius: 10, marginBottom: 6, border: '1px solid rgba(34,197,94,0.3)', background: 'rgba(34,197,94,0.07)', fontSize: 12, color: '#86efac', display: 'flex', alignItems: 'center', gap: 8 }}>
                      <span>{f.icon || '🔧'}</span> {f.description}
                    </div>
                  ))}
                </div>
              )}

              {/* Problèmes */}
              {(aiRepairResult.result.problemes || []).length > 0 && (
                <div>
                  <div style={{ fontSize: 11, color: '#64748b', fontWeight: 800, textTransform: 'uppercase', letterSpacing: 1, marginBottom: 8 }}>Problèmes détectés</div>
                  {aiRepairResult.result.problemes.map((p, i) => (
                    <div key={i} style={{ padding: '10px 14px', borderRadius: 10, marginBottom: 8, border: `1px solid ${p.severity === 'critical' ? 'rgba(239,68,68,0.35)' : p.severity === 'warning' ? 'rgba(234,179,8,0.3)' : 'rgba(99,102,241,0.3)'}`, background: p.severity === 'critical' ? 'rgba(239,68,68,0.07)' : p.severity === 'warning' ? 'rgba(234,179,8,0.07)' : 'rgba(99,102,241,0.07)' }}>
                      <div style={{ fontWeight: 700, fontSize: 13, color: p.severity === 'critical' ? '#f87171' : p.severity === 'warning' ? '#fbbf24' : '#a5b4fc', marginBottom: 4 }}>
                        {p.severity === 'critical' ? '🔴 Critique' : p.severity === 'warning' ? '🟡 Avertissement' : '🔵 Info'} — {p.description}
                      </div>
                      {p.solution && <div style={{ fontSize: 12, color: '#94a3b8' }}>💡 {p.solution}</div>}
                    </div>
                  ))}
                </div>
              )}

              {/* Corrections IA proposées */}
              {(aiRepairResult.result.corrections || []).length > 0 ? (
                <div>
                  <div style={{ fontSize: 11, color: '#64748b', fontWeight: 800, textTransform: 'uppercase', letterSpacing: 1, marginBottom: 8 }}>
                    {aiRepairResult.result.corrections.length} correction(s) proposée(s)
                  </div>
                  {aiRepairResult.result.corrections.map((c, i) => {
                    const applied = aiApplyLog.find(l => l.i === i);
                    return (
                      <div key={i} style={{ padding: '12px 14px', borderRadius: 10, marginBottom: 10, border: `1px solid ${applied?.ok ? 'rgba(34,197,94,0.4)' : 'rgba(99,102,241,0.3)'}`, background: applied?.ok ? 'rgba(34,197,94,0.07)' : 'rgba(99,102,241,0.06)' }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                          <div>
                            <span style={{ fontWeight: 700, fontSize: 12, color: '#c084fc' }}>{c.file}</span>
                            <span style={{ fontSize: 12, color: '#94a3b8', marginLeft: 10 }}>{c.description}</span>
                          </div>
                          {!applied ? (
                            <button
                              onClick={async () => {
                                try {
                                  const r = await fetch('/api/ai/apply-fix', { method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ file: c.file, old_string: c.old_string, new_string: c.new_string, description: c.description }) });
                                  const d = await r.json();
                                  setAiApplyLog(prev => [...prev, { i, ok: d.ok, error: d.error }]);
                                } catch (e) { setAiApplyLog(prev => [...prev, { i, ok: false, error: e.message }]); }
                              }}
                              style={{ padding: '7px 14px', borderRadius: 8, border: 'none', background: 'linear-gradient(135deg,#6366f1,#a855f7)', color: '#fff', fontWeight: 700, fontSize: 11, cursor: 'pointer', whiteSpace: 'nowrap' }}
                            >⚡ Appliquer</button>
                          ) : (
                            <span style={{ fontSize: 12, fontWeight: 700, color: applied.ok ? '#4ade80' : '#f87171' }}>
                              {applied.ok ? '✅ Appliqué' : `❌ ${applied.error}`}
                            </span>
                          )}
                        </div>
                        <details style={{ marginTop: 8 }}>
                          <summary style={{ fontSize: 11, color: '#64748b', cursor: 'pointer' }}>Voir le code</summary>
                          <pre style={{ marginTop: 8, padding: 10, borderRadius: 8, background: '#0a0e1a', fontSize: 11, color: '#94a3b8', overflowX: 'auto', whiteSpace: 'pre-wrap', wordBreak: 'break-all', maxHeight: 250 }}>
                            <span style={{ color: '#f87171' }}>- {(c.old_string || '').slice(0, 500)}</span>{'\n'}
                            <span style={{ color: '#4ade80' }}>+ {(c.new_string || '').slice(0, 500)}</span>
                          </pre>
                        </details>
                      </div>
                    );
                  })}
                </div>
              ) : (
                <div style={{ padding: '12px 16px', borderRadius: 10, background: 'rgba(34,197,94,0.08)', border: '1px solid rgba(34,197,94,0.25)', color: '#4ade80', fontSize: 13, fontWeight: 700 }}>
                  ✅ Aucune correction nécessaire — le système est sain.
                </div>
              )}
            </div>
          )}
        </div>
        )}

        {/* ══════════════ ONGLET HÉBERGEMENT BOTS ══════════════ */}
        {adminTab === 'bots' && (
        <div className="tg-admin-card" style={{ borderColor: 'rgba(34,158,217,0.5)', marginBottom: 20 }}>
          <div className="tg-admin-header">
            <span className="tg-admin-icon">🤖</span>
            <div style={{ flex: 1 }}>
              <h2 className="tg-admin-title">Hébergement Bots Telegram</h2>
              <p className="tg-admin-sub">Déployez vos bots Python ou Node.js en uploadant un fichier ZIP. Chaque bot tourne dans son propre processus avec redémarrage automatique.</p>
            </div>
            {hostedBots.filter(b => b.running).length > 0 && (
              <span className="tg-badge-connected">🟢 {hostedBots.filter(b => b.running).length} actif{hostedBots.filter(b => b.running).length > 1 ? 's' : ''}</span>
            )}
          </div>

          {/* Liste des bots existants */}
          {hostedBots.length > 0 && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginBottom: 20 }}>
              {hostedBots.map(bot => (
                <div key={bot.id} style={{
                  borderRadius: 12, padding: '12px 16px',
                  background: bot.running ? 'rgba(34,197,94,0.06)' : bot.status === 'installing' ? 'rgba(251,191,36,0.04)' : 'rgba(255,255,255,0.03)',
                  border: `1px solid ${bot.running ? 'rgba(34,197,94,0.3)' : bot.status === 'installing' ? 'rgba(251,191,36,0.35)' : 'rgba(255,255,255,0.1)'}`,
                }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                    <span style={{ fontSize: 16 }}>{bot.language === 'node' ? '🟨' : '🐍'}</span>
                    <span style={{ fontWeight: 700, color: '#e2e8f0', flex: 1 }}>{bot.name}</span>
                    <span style={{ fontSize: 11, fontWeight: 700, padding: '2px 8px', borderRadius: 20,
                      background: bot.running ? 'rgba(34,197,94,0.15)' : bot.status === 'installing' ? 'rgba(251,191,36,0.2)' : 'rgba(107,114,128,0.2)',
                      color: bot.running ? '#22c55e' : bot.status === 'installing' ? '#fbbf24' : '#9ca3af' }}>
                      {bot.running ? '🟢 Actif' : bot.status === 'installing' ? '⏳ Installation...' : '⚫ Arrêté'}
                    </span>
                    {bot.restarts > 0 && <span style={{ fontSize: 10, color: '#fbbf24' }}>🔄 {bot.restarts} redémarrage{bot.restarts > 1 ? 's' : ''}</span>}
                    {bot.is_prediction_bot && <span style={{ fontSize: 10, color: '#818cf8', background: 'rgba(129,140,248,0.12)', padding: '1px 6px', borderRadius: 10, border: '1px solid rgba(129,140,248,0.3)' }}>🎯 Prédiction</span>}
                  </div>
                  <div style={{ fontSize: 11, color: '#64748b', marginTop: 4 }}>
                    {bot.language} · 
                    <span style={{ color: '#7dd3fc', marginLeft: 4 }}>
                      📄 {bot.work_dir ? bot.work_dir.split('/').slice(-1)[0] + '/' : ''}{bot.main_file}
                    </span>
                    {' · '}canal: {bot.channel_id || '—'}
                  </div>
                  <div style={{ display: 'flex', gap: 8, marginTop: 10, flexWrap: 'wrap' }}>
                    {!bot.running ? (
                      <button className="btn btn-sm" style={{ background: 'rgba(34,197,94,0.15)', border: '1px solid rgba(34,197,94,0.3)', color: '#22c55e', fontSize: 12, padding: '5px 14px', borderRadius: 8, cursor: 'pointer' }}
                        onClick={async () => {
                          const r = await fetch(`/api/admin/bots/${bot.id}/start`, { method: 'POST', credentials: 'include' });
                          const d = await r.json();
                          if (d.ok) { setBotMsg('✅ Bot démarré'); await loadHostedBots(); }
                          else setBotMsg('❌ ' + d.error);
                        }}>▶ Démarrer</button>
                    ) : (
                      <button className="btn btn-sm" style={{ background: 'rgba(248,113,113,0.15)', border: '1px solid rgba(248,113,113,0.3)', color: '#f87171', fontSize: 12, padding: '5px 14px', borderRadius: 8, cursor: 'pointer' }}
                        onClick={async () => {
                          await fetch(`/api/admin/bots/${bot.id}/stop`, { method: 'POST', credentials: 'include' });
                          setBotMsg('⏹ Bot arrêté'); await loadHostedBots();
                        }}>⏹ Arrêter</button>
                    )}
                    <button className="btn btn-sm" style={{ background: 'rgba(34,158,217,0.12)', border: '1px solid rgba(34,158,217,0.3)', color: '#7dd3fc', fontSize: 12, padding: '5px 14px', borderRadius: 8, cursor: 'pointer' }}
                      onClick={async () => {
                        if (botLogId === bot.id) { setBotLogId(null); setBotLogs([]); return; }
                        const r = await fetch(`/api/admin/bots/${bot.id}/logs`, { credentials: 'include' });
                        const d = await r.json();
                        setBotLogs(Array.isArray(d) ? d : []);
                        setBotLogId(bot.id);
                      }}>📋 Logs</button>
                    <label className="btn btn-sm" style={{ background: 'rgba(251,191,36,0.12)', border: '1px solid rgba(251,191,36,0.3)', color: '#fbbf24', fontSize: 12, padding: '5px 14px', borderRadius: 8, cursor: 'pointer' }}>
                      📁 Mettre à jour ZIP
                      <input type="file" accept=".zip" style={{ display: 'none' }}
                        onChange={async (e) => {
                          const file = e.target.files[0]; if (!file) return;
                          const b64 = await new Promise(res => { const fr = new FileReader(); fr.onload = ev => res(ev.target.result.split(',')[1]); fr.readAsDataURL(file); });
                          const r = await fetch(`/api/admin/bots/${bot.id}/upload`, {
                            method: 'POST', credentials: 'include',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({ zip_base64: b64 }),
                          });
                          const d = await r.json();
                          setBotMsg(d.ok ? '✅ Code mis à jour' : '❌ ' + d.error);
                          await loadHostedBots();
                        }} />
                    </label>
                    <button className="btn btn-sm" style={{ background: 'rgba(239,68,68,0.12)', border: '1px solid rgba(239,68,68,0.3)', color: '#f87171', fontSize: 12, padding: '5px 14px', borderRadius: 8, cursor: 'pointer' }}
                      onClick={async () => {
                        if (!confirm(`Supprimer définitivement le bot "${bot.name}" ?`)) return;
                        await fetch(`/api/admin/bots/${bot.id}`, { method: 'DELETE', credentials: 'include' });
                        setBotMsg('🗑️ Bot supprimé'); await loadHostedBots();
                        if (botLogId === bot.id) { setBotLogId(null); setBotLogs([]); }
                      }}>🗑 Supprimer</button>
                  </div>

                  {/* Zone logs — avec auto-refresh pendant installation */}
                  {botLogId === bot.id && (() => {
                    const isInstalling = bot.status === 'installing';
                    return (
                      <div style={{ marginTop: 12 }}>
                        {isInstalling && (
                          <div style={{ fontSize: 10, color: '#fbbf24', marginBottom: 6, display: 'flex', alignItems: 'center', gap: 6 }}>
                            <span style={{ animation: 'spin 1s linear infinite', display: 'inline-block' }}>⏳</span>
                            Installation des dépendances en cours... les logs se rafraîchissent automatiquement.
                          </div>
                        )}
                        <div style={{ background: '#0f172a', borderRadius: 8, padding: '10px 12px', maxHeight: 280, overflowY: 'auto', fontFamily: 'monospace', fontSize: 11 }}>
                          {botLogs.length === 0 ? (
                            <span style={{ color: '#64748b' }}>Aucun log disponible.</span>
                          ) : botLogs.map((l, i) => {
                            const isInstallLog = l.m && l.m.startsWith('[Install]');
                            const clr = l.s === 'err'
                              ? '#f87171'
                              : isInstallLog ? '#fbbf24'
                              : '#86efac';
                            return (
                              <div key={i} style={{ color: clr, marginBottom: 2 }}>
                                <span style={{ color: '#475569', marginRight: 6 }}>[{new Date(l.t).toLocaleTimeString()}]</span>{l.m}
                              </div>
                            );
                          })}
                        </div>
                        <div style={{ marginTop: 6, display: 'flex', gap: 6 }}>
                          <button style={{ fontSize: 10, padding: '3px 10px', borderRadius: 6, background: 'rgba(99,102,241,0.12)', border: '1px solid rgba(99,102,241,0.25)', color: '#818cf8', cursor: 'pointer' }}
                            onClick={async () => {
                              const r = await fetch(`/api/admin/bots/${bot.id}/logs`, { credentials: 'include' });
                              const d = await r.json();
                              setBotLogs(Array.isArray(d) ? d : []);
                              await loadHostedBots();
                            }}>↻ Rafraîchir</button>
                          <button style={{ fontSize: 10, padding: '3px 10px', borderRadius: 6, background: 'rgba(100,116,139,0.12)', border: '1px solid rgba(100,116,139,0.25)', color: '#94a3b8', cursor: 'pointer' }}
                            onClick={() => { setBotLogId(null); setBotLogs([]); }}>✕ Fermer</button>
                        </div>
                      </div>
                    );
                  })()}
                </div>
              ))}
            </div>
          )}

          {botMsg && (
            <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 12, color: botMsg.startsWith('✅') ? '#22c55e' : '#f87171' }}>
              {botMsg}
            </div>
          )}

          {/* Formulaire ajout nouveau bot */}
          <div style={{ borderTop: hostedBots.length > 0 ? '1px solid rgba(255,255,255,0.08)' : 'none', paddingTop: hostedBots.length > 0 ? 16 : 0 }}>
            <div style={{ fontSize: 13, fontWeight: 700, color: '#e2e8f0', marginBottom: 12 }}>➕ Ajouter un nouveau bot</div>
            <div style={{ display: 'grid', gap: 10 }}>
              <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
                <div style={{ flex: 2, minWidth: 180 }}>
                  <label style={{ fontSize: 11, color: '#94a3b8', display: 'block', marginBottom: 3 }}>Nom du bot *</label>
                  <input className="tg-input" value={newBot.name} onChange={e => setNewBot(p => ({ ...p, name: e.target.value }))} placeholder="MonBot" style={{ width: '100%' }} />
                </div>
                <div style={{ flex: 1, minWidth: 120 }}>
                  <label style={{ fontSize: 11, color: '#94a3b8', display: 'block', marginBottom: 3 }}>Langage</label>
                  <select className="tg-input" value={newBot.language} onChange={e => setNewBot(p => ({ ...p, language: e.target.value, main_file: '' }))}>
                    <option value="python">🐍 Python</option>
                    <option value="node">🟨 Node.js</option>
                  </select>
                </div>
              </div>
              <div>
                <label style={{ fontSize: 11, color: '#94a3b8', display: 'block', marginBottom: 3 }}>Token Bot Telegram *</label>
                <input className="tg-input" value={newBot.token} onChange={e => setNewBot(p => ({ ...p, token: e.target.value }))} placeholder="123456789:ABCdefGHIjklMNOpqrSTUvwxYZ" style={{ width: '100%', fontFamily: 'monospace', fontSize: 12 }} />
              </div>
              <div>
                <label style={{ fontSize: 11, color: '#94a3b8', display: 'block', marginBottom: 3 }}>Channel ID <span style={{ color: '#f87171' }}>*</span> <span style={{ color: '#64748b' }}>(requis pour message bienvenue)</span></label>
                <input className="tg-input" value={newBot.channel_id} onChange={e => setNewBot(p => ({ ...p, channel_id: e.target.value }))} placeholder="-100123456789" style={{ width: '100%' }} />
                <div style={{ fontSize: 10, color: '#64748b', marginTop: 3 }}>
                  Le fichier principal est détecté automatiquement depuis le ZIP (main.py, bot.py, index.js…). Le bot doit être <strong style={{ color: '#94a3b8' }}>admin du canal</strong> pour envoyer des messages.
                </div>
              </div>
              <div>
                <label style={{ fontSize: 11, color: '#94a3b8', display: 'block', marginBottom: 3 }}>
                  Fichier ZIP du bot {newBotZipB64 ? <span style={{ color: '#22c55e' }}>✅ Chargé ({(newBotZipB64.length * 0.75 / 1024).toFixed(0)} Ko)</span> : <span style={{ color: '#f87171' }}>* (requis)</span>}
                </label>
                <input type="file" accept=".zip"
                  style={{ fontSize: 12, color: '#e2e8f0' }}
                  onChange={async (e) => {
                    const file = e.target.files[0]; if (!file) return;
                    const b64 = await new Promise(res => { const fr = new FileReader(); fr.onload = ev => res(ev.target.result.split(',')[1]); fr.readAsDataURL(file); });
                    setNewBotZipB64(b64);
                  }}
                />
              </div>
            </div>
            <button
              className="btn btn-gold btn-sm"
              disabled={botSaving || !newBot.name || !newBot.token || !newBotZipB64}
              style={{ marginTop: 14, background: 'linear-gradient(135deg,#1e40af,#3b82f6)', border: 'none', color: '#fff', fontWeight: 700, fontSize: 13, padding: '10px 28px', borderRadius: 10, cursor: 'pointer', opacity: (!newBot.name || !newBot.token || !newBotZipB64) ? 0.4 : 1 }}
              onClick={async () => {
                setBotSaving(true); setBotMsg('');
                try {
                  const body = {
                    name: newBot.name.trim(),
                    language: newBot.language,
                    token: newBot.token.trim(),
                    channel_id: newBot.channel_id.trim(),
                    zip_base64: newBotZipB64,
                  };
                  const r = await fetch('/api/admin/bots', {
                    method: 'POST', credentials: 'include',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(body),
                  });
                  const d = await r.json();
                  if (r.ok) {
                    const w = d.bot?._welcome;
                    const wMsg = !newBot.channel_id.trim()
                      ? ' — ⚠️ Channel ID manquant, message bienvenue non envoyé'
                      : w?.ok
                        ? ' — ✅ Message bienvenue envoyé sur Telegram'
                        : ` — ⚠️ Message bienvenue échoué : ${w?.error || 'inconnu'} (vérifiez que le bot est admin du canal)`;
                    setBotMsg('✅ Bot créé ! Démarrez-le avec le bouton ▶' + wMsg);
                    setNewBot({ name: '', language: 'python', token: '', channel_id: '' });
                    setNewBotZipB64('');
                    await loadHostedBots();
                  } else {
                    setBotMsg('❌ ' + d.error);
                  }
                } catch (e) { setBotMsg('❌ Erreur réseau : ' + e.message); }
                setBotSaving(false);
              }}
            >{botSaving ? '⏳ Création…' : '🤖 Créer le bot'}</button>
          </div>
        </div>)}

        {/* ── PRÉ-VÉRIFICATION IA DU BOT ── */}
        {adminTab === 'bots' && (
        <div className="tg-admin-card" style={{ borderColor: 'rgba(168,85,247,0.35)', marginTop: 20 }}>
          <div className="tg-admin-header">
            <span className="tg-admin-icon">🔍</span>
            <div style={{ flex: 1 }}>
              <h2 className="tg-admin-title">Pré-vérification IA du Bot</h2>
              <p className="tg-admin-sub">
                Avant de déployer, l'IA analyse le ZIP de votre bot et détecte les problèmes potentiels (erreurs de configuration, tokens manquants, code défaillant).
                {!aiConfigData.hasKey && <span style={{ color: '#f87171', marginLeft: 6 }}>⚠️ Configurez l'IA d'abord (onglet 🧠 Config IA)</span>}
              </p>
            </div>
          </div>

          <div style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap', marginBottom: aiBotPrecheck ? 16 : 0 }}>
            <div style={{ flex: 1, minWidth: 200, fontSize: 13, color: '#94a3b8' }}>
              {newBotZipB64
                ? <span style={{ color: '#a5b4fc' }}>✅ Fichier ZIP prêt ({(newBotZipB64.length * 0.75 / 1024).toFixed(0)} Ko) — chargé depuis le formulaire ci-dessus</span>
                : <span style={{ color: '#64748b' }}>Chargez d'abord un fichier ZIP dans le formulaire ci-dessus</span>}
            </div>
            <button
              onClick={async () => {
                if (!newBotZipB64) { alert('Chargez d\'abord un fichier ZIP dans le formulaire.'); return; }
                if (!aiConfigData.hasKey) { alert('Configurez d\'abord l\'IA dans l\'onglet "🧠 Config IA".'); return; }
                setAiBotChecking(true); setAiBotPrecheck(null);
                try {
                  const r = await fetch('/api/ai/bot-precheck', { method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ zip_base64: newBotZipB64, language: newBot.language || 'python' }) });
                  const d = await r.json();
                  setAiBotPrecheck(d);
                  if (d.correctedZip64) {
                    setNewBotZipB64(d.correctedZip64);
                  }
                } catch (e) { setAiBotPrecheck({ ok: false, error: e.message }); }
                setAiBotChecking(false);
              }}
              disabled={aiBotChecking || !newBotZipB64 || !aiConfigData.hasKey}
              style={{ padding: '10px 20px', borderRadius: 10, border: 'none', background: (aiBotChecking || !newBotZipB64 || !aiConfigData.hasKey) ? 'rgba(168,85,247,0.2)' : 'linear-gradient(135deg,#7c3aed,#a855f7)', color: '#fff', fontWeight: 700, fontSize: 13, cursor: (aiBotChecking || !newBotZipB64 || !aiConfigData.hasKey) ? 'not-allowed' : 'pointer', whiteSpace: 'nowrap', opacity: (!newBotZipB64 || !aiConfigData.hasKey) ? 0.5 : 1 }}
            >
              {aiBotChecking ? '⏳ Analyse…' : '🔍 Analyser avec l\'IA'}
            </button>
          </div>

          {aiBotPrecheck && !aiBotPrecheck.ok && (
            <div style={{ padding: '12px 16px', borderRadius: 10, background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.35)', color: '#f87171', fontSize: 13 }}>
              ❌ {aiBotPrecheck.error}
            </div>
          )}

          {aiBotPrecheck?.result && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              <div style={{ padding: '12px 16px', borderRadius: 10, border: `1px solid ${aiBotPrecheck.result.can_deploy ? 'rgba(34,197,94,0.4)' : 'rgba(239,68,68,0.4)'}`, background: aiBotPrecheck.result.can_deploy ? 'rgba(34,197,94,0.08)' : 'rgba(239,68,68,0.08)', color: aiBotPrecheck.result.can_deploy ? '#4ade80' : '#f87171', fontWeight: 700, fontSize: 14 }}>
                {aiBotPrecheck.result.can_deploy ? '✅ Bot déployable — aucun problème bloquant détecté' : '❌ Des problèmes bloquants ont été détectés'}
              </div>

              {(aiBotPrecheck.result.issues || []).length > 0 && (
                <div>
                  {aiBotPrecheck.result.issues.map((iss, i) => (
                    <div key={i} style={{ padding: '9px 14px', borderRadius: 10, marginBottom: 7, border: `1px solid ${iss.severity === 'critical' ? 'rgba(239,68,68,0.35)' : 'rgba(234,179,8,0.3)'}`, background: iss.severity === 'critical' ? 'rgba(239,68,68,0.07)' : 'rgba(234,179,8,0.07)', fontSize: 12 }}>
                      <span style={{ fontWeight: 700, color: iss.severity === 'critical' ? '#f87171' : '#fbbf24' }}>{iss.severity === 'critical' ? '🔴' : '🟡'} {iss.file}</span>
                      <span style={{ color: '#94a3b8', marginLeft: 10 }}>{iss.description}</span>
                    </div>
                  ))}
                </div>
              )}

              {aiBotPrecheck.correctedZip64 && (
                <div style={{ padding: '12px 16px', borderRadius: 10, background: 'rgba(99,102,241,0.1)', border: '1px solid rgba(99,102,241,0.35)', color: '#a5b4fc', fontSize: 13, fontWeight: 700 }}>
                  ⚡ Des corrections ont été appliquées automatiquement. Le ZIP corrigé est maintenant chargé dans le formulaire — vous pouvez déployer directement.
                </div>
              )}
            </div>
          )}
        </div>
        )}

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
                  {/* Aperçu du média (image / vidéo) */}
                  {ann.media_type && (ann.media_data || ann.media_url) && (
                    <div style={{ display: 'flex', gap: 10, alignItems: 'flex-start' }}>
                      {ann.media_type === 'image' ? (
                        <img
                          src={ann.media_data ? `data:image/*;base64,${ann.media_data}` : ann.media_url}
                          alt="Aperçu"
                          style={{ width: 110, height: 80, objectFit: 'cover', borderRadius: 8, border: '1px solid rgba(251,191,36,0.3)' }}
                        />
                      ) : (
                        <video
                          src={ann.media_data ? `data:video/mp4;base64,${ann.media_data}` : ann.media_url}
                          style={{ width: 110, height: 80, objectFit: 'cover', borderRadius: 8, border: '1px solid rgba(251,191,36,0.3)', background: '#000' }}
                          muted
                        />
                      )}
                      <div style={{ fontSize: 11, color: '#94a3b8' }}>
                        <div><b style={{ color: '#fbbf24' }}>{ann.media_type === 'image' ? '🖼️ Image' : '🎬 Vidéo'} attachée</b></div>
                        {ann.media_filename && <div style={{ marginTop: 2 }}>📄 {ann.media_filename}</div>}
                        {ann.media_url && !ann.media_data && <div style={{ marginTop: 2, wordBreak: 'break-all', maxWidth: 280 }}>🔗 {ann.media_url.slice(0, 50)}…</div>}
                      </div>
                    </div>
                  )}

                  <div style={{ fontSize: 12, color: '#94a3b8', lineHeight: 1.5, background: 'rgba(0,0,0,0.2)', padding: '8px 12px', borderRadius: 6, whiteSpace: 'pre-wrap' }}>
                    {annExpandedId === ann.id || ann.text.length <= 200
                      ? ann.text
                      : ann.text.slice(0, 200) + '…'}
                    {ann.text.length > 200 && (
                      <button
                        type="button"
                        onClick={() => setAnnExpandedId(annExpandedId === ann.id ? null : ann.id)}
                        style={{ display: 'block', marginTop: 6, padding: '3px 10px', borderRadius: 5, border: 'none', cursor: 'pointer', fontSize: 11, fontWeight: 700, background: 'rgba(125,211,252,0.12)', color: '#7dd3fc' }}>
                        {annExpandedId === ann.id ? '▲ Réduire' : `▼ Voir tout (${ann.text.length} caractères)`}
                      </button>
                    )}
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
                      onClick={() => {
                        setAnnEditingId(ann.id);
                        setAnnForm({
                          name: ann.name || '',
                          bot_token: ann.bot_token || '',
                          channel_id: ann.channel_id || '',
                          text: ann.text || '',
                          media_type: ann.media_type || '',
                          media_url: ann.media_url || '',
                          media_data: ann.media_data || '',
                          media_filename: ann.media_filename || '',
                          schedule_type: ann.schedule_type || 'interval',
                          interval_hours: ann.interval_hours ?? 1,
                          times_input: Array.isArray(ann.times) ? ann.times.join(', ') : '',
                        });
                        setAnnOpen(true);
                        setAnnMsg('');
                        // Le défilement vers le formulaire est géré par useEffect
                        // (annEditingId, annOpen) — plus fiable qu'un setTimeout.
                      }}
                      style={{ padding: '5px 14px', borderRadius: 8, cursor: 'pointer', fontSize: 12, fontWeight: 700, background: 'rgba(168,85,247,0.25)', color: '#c4b5fd', border: '1px solid rgba(168,85,247,0.4)' }}>
                      ✏️ Modifier cette annonce
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
            onClick={() => {
              if (annOpen) {
                setAnnOpen(false);
                setAnnEditingId(null);
                setAnnForm(ANN_BLANK);
              } else {
                setAnnOpen(true);
                setAnnEditingId(null);
                setAnnForm(ANN_BLANK);
              }
              setAnnMsg('');
            }}
            style={{ padding: '9px 20px', borderRadius: 10, border: 'none', cursor: 'pointer', fontSize: 13, fontWeight: 700,
              background: annOpen ? 'rgba(239,68,68,0.12)' : 'linear-gradient(135deg,#92400e,#fbbf24)',
              color: annOpen ? '#f87171' : '#fff', marginBottom: annOpen ? 16 : 0 }}>
            {annOpen ? (annEditingId ? '✕ Annuler la modification' : '✕ Fermer le formulaire') : '+ Nouvelle annonce'}
          </button>

          {annOpen && (
            <form ref={annFormRef} onSubmit={async e => {
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
                  media_data: annForm.media_data || null,
                  media_filename: annForm.media_filename || null,
                  schedule_type: annForm.schedule_type,
                  interval_hours: annForm.schedule_type === 'interval' ? parseFloat(annForm.interval_hours) : null,
                  times,
                };
                const isEdit = annEditingId !== null;
                const url = isEdit
                  ? `/api/admin/announcements/${annEditingId}`
                  : '/api/admin/announcements';
                const r = await fetch(url, {
                  method: isEdit ? 'PATCH' : 'POST', credentials: 'include',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify(body),
                });
                const d = await r.json();
                if (d.ok) {
                  setAnnMsg(isEdit ? '✅ Annonce modifiée !' : '✅ Annonce créée !');
                  setAnnForm(ANN_BLANK);
                  setAnnOpen(false);
                  setAnnEditingId(null);
                  loadAnnouncements();
                } else {
                  setAnnMsg('❌ ' + (d.error || 'Erreur'));
                }
              } catch { setAnnMsg('❌ Erreur réseau'); }
              setAnnSaving(false);
            }}
            style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>

              {/* ── BANDEAU MODE ÉDITION (visible uniquement en modification) ── */}
              {annEditingId && (() => {
                const editingAnn = announcements.find(a => a.id === annEditingId);
                return (
                  <div style={{
                    gridColumn: '1 / -1',
                    padding: '14px 18px', borderRadius: 12,
                    background: 'linear-gradient(135deg, rgba(168,85,247,0.18), rgba(251,191,36,0.12))',
                    border: '2px solid rgba(168,85,247,0.5)',
                    display: 'flex', gap: 14, alignItems: 'center', flexWrap: 'wrap',
                  }}>
                    <div style={{ fontSize: 28 }}>✏️</div>
                    <div style={{ flex: 1, minWidth: 200 }}>
                      <div style={{ color: '#e9d5ff', fontWeight: 800, fontSize: 14, letterSpacing: 0.3 }}>
                        MODIFICATION DE L'ANNONCE #{annEditingId}
                      </div>
                      <div style={{ color: '#c4b5fd', fontSize: 12, marginTop: 3 }}>
                        Vous modifiez : <b>« {annForm.name || editingAnn?.name || '—'} »</b>.
                        Vos changements <b>remplaceront</b> l'annonce existante (pas de doublon).
                      </div>
                    </div>
                    {/* Aperçu du média actuel */}
                    {annForm.media_type && (annForm.media_data || annForm.media_url) && (
                      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4 }}>
                        {annForm.media_type === 'image' ? (
                          <img
                            src={annForm.media_data ? `data:image/*;base64,${annForm.media_data}` : annForm.media_url}
                            alt="Média actuel"
                            style={{ width: 90, height: 70, objectFit: 'cover', borderRadius: 8, border: '2px solid rgba(168,85,247,0.4)' }}
                          />
                        ) : (
                          <video
                            src={annForm.media_data ? `data:video/mp4;base64,${annForm.media_data}` : annForm.media_url}
                            style={{ width: 90, height: 70, objectFit: 'cover', borderRadius: 8, border: '2px solid rgba(168,85,247,0.4)', background: '#000' }}
                            muted
                          />
                        )}
                        <div style={{ fontSize: 10, color: '#a78bfa', fontWeight: 700 }}>
                          {annForm.media_type === 'image' ? '🖼️ Image actuelle' : '🎬 Vidéo actuelle'}
                        </div>
                      </div>
                    )}
                    <button type="button"
                      onClick={() => {
                        setAnnEditingId(null);
                        setAnnForm(ANN_BLANK);
                        setAnnMsg('');
                      }}
                      style={{ padding: '6px 12px', borderRadius: 8, border: '1px solid rgba(239,68,68,0.4)', cursor: 'pointer', fontSize: 11, fontWeight: 700, background: 'rgba(239,68,68,0.12)', color: '#fca5a5' }}>
                      ✕ Annuler la modification
                    </button>
                  </div>
                );
              })()}

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
              <div style={{ gridColumn: '1 / -1' }}>
                <label style={{ display: 'block', color: '#94a3b8', fontSize: 12, marginBottom: 5 }}>🎞️ Type de média (optionnel)</label>
                <select value={annForm.media_type} onChange={e => setAnnForm(p => ({ ...p, media_type: e.target.value, media_url: '', media_data: '', media_filename: '' }))}
                  style={{ width: '100%', padding: '9px 12px', background: '#1e1b2e', border: '1px solid rgba(251,191,36,0.3)', borderRadius: 8, color: '#fff', fontSize: 13 }}>
                  <option value="">Aucun (texte uniquement)</option>
                  <option value="image">🖼️ Image</option>
                  <option value="video">🎬 Vidéo</option>
                </select>
              </div>

              {annForm.media_type && (
                <>
                  {/* Upload direct du fichier */}
                  <div style={{ gridColumn: '1 / -1', padding: '12px 14px', borderRadius: 10, background: 'rgba(168,85,247,0.06)', border: '1px solid rgba(168,85,247,0.25)' }}>
                    <label style={{ display: 'block', color: '#c4b5fd', fontSize: 12, marginBottom: 8, fontWeight: 700 }}>
                      📁 Téléverser un fichier {annForm.media_type === 'image' ? 'image' : 'vidéo'} depuis votre appareil
                    </label>
                    <input
                      type="file"
                      accept={annForm.media_type === 'image' ? 'image/*' : 'video/*'}
                      disabled={annUploading}
                      onChange={async ev => {
                        const f = ev.target.files?.[0];
                        if (!f) return;
                        const maxMB = annForm.media_type === 'video' ? 50 : 10;
                        if (f.size > maxMB * 1024 * 1024) {
                          setAnnMsg(`❌ Fichier trop lourd (max ${maxMB} Mo pour ${annForm.media_type === 'video' ? 'vidéo' : 'image'})`);
                          ev.target.value = '';
                          return;
                        }
                        setAnnUploading(true);
                        try {
                          const reader = new FileReader();
                          reader.onload = () => {
                            const dataUrl = reader.result; // "data:image/png;base64,..."
                            const base64 = String(dataUrl).split(',')[1] || '';
                            setAnnForm(p => ({
                              ...p,
                              media_data: base64,
                              media_filename: f.name,
                              media_url: '', // efface l'URL si on téléverse un fichier
                            }));
                            setAnnUploading(false);
                            setAnnMsg(`✅ Fichier "${f.name}" prêt (${(f.size / 1024 / 1024).toFixed(2)} Mo)`);
                            setTimeout(() => setAnnMsg(''), 4000);
                          };
                          reader.onerror = () => {
                            setAnnUploading(false);
                            setAnnMsg('❌ Erreur lecture du fichier');
                          };
                          reader.readAsDataURL(f);
                        } catch (err) {
                          setAnnUploading(false);
                          setAnnMsg('❌ ' + err.message);
                        }
                      }}
                      style={{ width: '100%', padding: 8, background: '#1e1b2e', border: '1px dashed rgba(168,85,247,0.4)', borderRadius: 8, color: '#fff', fontSize: 12, boxSizing: 'border-box' }}
                    />
                    {annForm.media_data && (
                      <div style={{ marginTop: 10, padding: 10, borderRadius: 8, background: 'rgba(34,197,94,0.08)', border: '1px solid rgba(34,197,94,0.25)' }}>
                        <div style={{ display: 'flex', gap: 12, alignItems: 'flex-start' }}>
                          {annForm.media_type === 'image' ? (
                            <img
                              src={`data:image/*;base64,${annForm.media_data}`}
                              alt="Aperçu"
                              style={{ width: 120, height: 90, objectFit: 'cover', borderRadius: 6, border: '1px solid rgba(34,197,94,0.3)' }}
                            />
                          ) : (
                            <video
                              src={`data:video/mp4;base64,${annForm.media_data}`}
                              controls
                              style={{ width: 160, height: 90, objectFit: 'cover', borderRadius: 6, border: '1px solid rgba(34,197,94,0.3)', background: '#000' }}
                              muted
                            />
                          )}
                          <div style={{ flex: 1, fontSize: 12, color: '#86efac' }}>
                            <div style={{ fontWeight: 700 }}>✓ {annForm.media_filename || 'Fichier prêt'}</div>
                            <div style={{ marginTop: 3, color: '#94a3b8' }}>
                              ≈ {Math.round(annForm.media_data.length * 0.75 / 1024)} Ko
                            </div>
                            <button type="button"
                              onClick={() => setAnnForm(p => ({ ...p, media_data: '', media_filename: '' }))}
                              style={{ marginTop: 6, padding: '4px 12px', borderRadius: 6, border: 'none', cursor: 'pointer', fontSize: 11, fontWeight: 700, background: 'rgba(239,68,68,0.18)', color: '#fca5a5' }}>
                              ✕ Retirer le fichier
                            </button>
                          </div>
                        </div>
                      </div>
                    )}
                    <div style={{ fontSize: 10, color: '#64748b', marginTop: 6, lineHeight: 1.4 }}>
                      Limite : {annForm.media_type === 'video' ? '50 Mo' : '10 Mo'} (limite Telegram).
                      Si vous téléversez un fichier, l'URL ci-dessous est ignorée.
                    </div>
                  </div>

                  {/* OU URL */}
                  <div style={{ gridColumn: '1 / -1' }}>
                    <label style={{ display: 'block', color: '#94a3b8', fontSize: 12, marginBottom: 5 }}>
                      🔗 …ou URL distante de l'{annForm.media_type === 'image' ? 'image' : 'vidéo'}
                    </label>
                    <input value={annForm.media_url}
                      onChange={e => setAnnForm(p => ({ ...p, media_url: e.target.value, media_data: '', media_filename: '' }))}
                      placeholder="https://example.com/image.jpg"
                      disabled={!!annForm.media_data}
                      style={{ width: '100%', padding: '9px 12px', background: annForm.media_data ? '#111' : '#1e1b2e', border: '1px solid rgba(251,191,36,0.3)', borderRadius: 8, color: annForm.media_data ? '#475569' : '#fff', fontSize: 13, boxSizing: 'border-box' }} />
                  </div>
                </>
              )}

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
                  {annSaving ? '⏳ Enregistrement…' : (annEditingId ? '💾 Enregistrer les modifications' : '✅ Créer l\'annonce')}
                </button>
              </div>
            </form>
          )}
        </div>)}

        {/* ════════════════════════════════════════════════
            ── TAB : CANAUX TELEGRAM ──
        ════════════════════════════════════════════════ */}
        {adminTab === 'canaux' && <>

        {/* ── SECTION 0 : DIFFUSION LIVE DES JEUX (multi-canaux) ── */}
        <div className="tg-admin-card" style={{ borderColor: 'rgba(168,85,247,0.4)', marginBottom: 20 }}>
          <div className="tg-admin-header">
            <span className="tg-admin-icon">🎰</span>
            <div style={{ flex: 1 }}>
              <h2 className="tg-admin-title">Diffusion live des jeux</h2>
              <p className="tg-admin-sub">
                Envoie chaque partie en temps réel vers un ou plusieurs canaux Telegram.
                Le message est édité au fur et à mesure que les cartes sortent, jusqu'à la fin de la partie.
                <br />
                <span style={{ fontSize: 11, color: '#94a3b8' }}>
                  Format : <code style={{ background: 'rgba(168,85,247,0.12)', padding: '1px 5px', borderRadius: 4 }}>#N1104. ✅9(8♣️A♥️) - 3(6♥️7♠️) #T12 🔵#R</code>
                  · Égalité : <code style={{ background: 'rgba(168,85,247,0.12)', padding: '1px 5px', borderRadius: 4 }}>🔰</code>
                  · En cours : <code style={{ background: 'rgba(168,85,247,0.12)', padding: '1px 5px', borderRadius: 4 }}>⏰ ▶️</code>
                </span>
              </p>
            </div>
            <span className="tg-badge-connected" style={{ background: 'rgba(168,85,247,0.15)', color: '#c084fc', border: '1px solid rgba(168,85,247,0.3)' }}>
              {lbTargets.length} cible{lbTargets.length > 1 ? 's' : ''}
            </span>
          </div>

          {lbMsg && (
            <div className={`tg-alert ${lbMsg.startsWith('✅') ? 'tg-alert-ok' : (lbMsg.startsWith('⏳') ? '' : 'tg-alert-error')}`} style={{ marginTop: 8 }}>{lbMsg}</div>
          )}

          {/* Formulaire ajout */}
          <div style={{ background: 'rgba(168,85,247,0.06)', border: '1px solid rgba(168,85,247,0.2)', borderRadius: 10, padding: 14, marginTop: 12 }}>
            <div style={{ fontSize: 12, fontWeight: 700, color: '#c084fc', marginBottom: 10 }}>➕ Ajouter une cible</div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 10 }}>
              <div>
                <label style={{ display: 'block', color: '#94a3b8', fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.8, marginBottom: 4 }}>🔑 API TOKEN BOT</label>
                <input value={lbForm.bot_token} onChange={e => setLbForm(p => ({ ...p, bot_token: e.target.value }))}
                  placeholder="123456:AAF-xxxxx…"
                  style={{ width: '100%', padding: '9px 11px', borderRadius: 8, border: '1px solid rgba(168,85,247,0.3)', background: 'rgba(168,85,247,0.06)', color: '#e2e8f0', fontSize: 12, fontFamily: 'monospace', boxSizing: 'border-box' }} />
              </div>
              <div>
                <label style={{ display: 'block', color: '#94a3b8', fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.8, marginBottom: 4 }}>📢 ID CANAL</label>
                <input value={lbForm.channel_id} onChange={e => setLbForm(p => ({ ...p, channel_id: e.target.value }))}
                  placeholder="@canal ou -1001234…"
                  style={{ width: '100%', padding: '9px 11px', borderRadius: 8, border: '1px solid rgba(168,85,247,0.3)', background: 'rgba(168,85,247,0.06)', color: '#e2e8f0', fontSize: 12, fontFamily: 'monospace', boxSizing: 'border-box' }} />
              </div>
            </div>
            <div style={{ display: 'flex', gap: 10, alignItems: 'flex-end' }}>
              <div style={{ flex: 1 }}>
                <label style={{ display: 'block', color: '#94a3b8', fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.8, marginBottom: 4 }}>📛 Étiquette (optionnel)</label>
                <input value={lbForm.label} onChange={e => setLbForm(p => ({ ...p, label: e.target.value }))}
                  placeholder="ex : Canal VIP"
                  style={{ width: '100%', padding: '9px 11px', borderRadius: 8, border: '1px solid rgba(168,85,247,0.3)', background: 'rgba(168,85,247,0.06)', color: '#e2e8f0', fontSize: 12, boxSizing: 'border-box' }} />
              </div>
              <button type="button" onClick={addLbTarget} disabled={lbSaving}
                style={{ padding: '10px 18px', borderRadius: 8, border: '1px solid rgba(168,85,247,0.5)', background: 'rgba(168,85,247,0.18)', color: '#e9d5ff', fontWeight: 700, fontSize: 12, cursor: lbSaving ? 'wait' : 'pointer' }}>
                {lbSaving ? '⏳…' : '➕ Ajouter'}
              </button>
            </div>
          </div>

          {/* Liste des cibles */}
          <div style={{ marginTop: 14 }}>
            {lbLoading && <div style={{ fontSize: 12, color: '#64748b', fontStyle: 'italic', textAlign: 'center', padding: 10 }}>⏳ Chargement…</div>}
            {!lbLoading && lbTargets.length === 0 && (
              <div style={{ fontSize: 12, color: '#64748b', fontStyle: 'italic', textAlign: 'center', padding: '14px 10px' }}>
                Aucune cible configurée. Ajoutez un canal ci-dessus pour commencer la diffusion.
              </div>
            )}
            {!lbLoading && lbTargets.length > 0 && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {lbTargets.map(t => (
                  <div key={t.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 14px', background: 'rgba(15,23,42,0.5)', borderRadius: 8, border: `1px solid ${t.enabled ? 'rgba(34,197,94,0.25)' : 'rgba(100,116,139,0.25)'}` }}>
                    <span style={{ fontSize: 18 }}>{t.enabled ? '🟢' : '⚪'}</span>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 13, fontWeight: 700, color: '#e2e8f0' }}>
                        {t.label || <span style={{ color: '#64748b', fontStyle: 'italic' }}>Sans étiquette</span>}
                        <span style={{ fontSize: 11, color: '#a78bfa', marginLeft: 8, fontFamily: 'monospace' }}>{t.channel_id}</span>
                      </div>
                      <div style={{ fontSize: 10, color: '#64748b', fontFamily: 'monospace', marginTop: 2 }}>
                        🔑 {t.bot_token_preview} · {new Date(t.created_at).toLocaleString('fr-FR')}
                      </div>
                    </div>
                    <button type="button" onClick={() => testLbTarget(t.id)} title="Envoyer un message test"
                      style={{ padding: '5px 11px', borderRadius: 6, border: '1px solid rgba(99,102,241,0.4)', background: 'rgba(99,102,241,0.1)', color: '#a5b4fc', fontSize: 11, fontWeight: 700, cursor: 'pointer' }}>📨 Test</button>
                    <button type="button" onClick={() => toggleLbTarget(t.id, !t.enabled)} title={t.enabled ? 'Désactiver' : 'Activer'}
                      style={{ padding: '5px 11px', borderRadius: 6, border: `1px solid ${t.enabled ? 'rgba(251,191,36,0.4)' : 'rgba(34,197,94,0.4)'}`, background: t.enabled ? 'rgba(251,191,36,0.1)' : 'rgba(34,197,94,0.1)', color: t.enabled ? '#fbbf24' : '#4ade80', fontSize: 11, fontWeight: 700, cursor: 'pointer' }}>
                      {t.enabled ? '⏸ Pause' : '▶ Activer'}
                    </button>
                    <button type="button" onClick={() => deleteLbTarget(t.id)} title="Supprimer"
                      style={{ padding: '5px 11px', borderRadius: 6, border: '1px solid rgba(239,68,68,0.4)', background: 'rgba(239,68,68,0.08)', color: '#f87171', fontSize: 11, fontWeight: 700, cursor: 'pointer' }}>🗑</button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

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

                      {/* ── Message d'annonce planifiée ── */}
                      {(() => {
                        const annSub = getAnnSub(ch.id);
                        return (
                          <div style={{ marginBottom: 14, borderRadius: 10, border: '1px solid rgba(251,191,36,0.25)', overflow: 'hidden' }}>
                            {/* Toggle header */}
                            <button type="button"
                              onClick={() => setAnnSub(ch.id, { open: !annSub.open })}
                              style={{ width: '100%', display: 'flex', alignItems: 'center', gap: 10, padding: '10px 14px', background: annSub.open ? 'rgba(251,191,36,0.1)' : 'rgba(251,191,36,0.04)', border: 'none', cursor: 'pointer', textAlign: 'left' }}>
                              <span style={{ fontSize: 16 }}>📢</span>
                              <span style={{ flex: 1, fontWeight: 700, fontSize: 12, color: annSub.open ? '#fbbf24' : '#94a3b8' }}>Message d'annonce planifiée</span>
                              <span style={{ fontSize: 11, color: annSub.text.trim() ? '#fbbf24' : '#475569', fontWeight: 600 }}>
                                {annSub.text.trim() ? (annSub.schedule_type === 'interval' ? `⏱ toutes les ${annSub.interval_hours}h` : `🕐 ${annSub.times_input || 'heures à définir'}`) : 'Optionnel'}
                              </span>
                              <span style={{ color: '#64748b', fontSize: 13 }}>{annSub.open ? '▲' : '▼'}</span>
                            </button>
                            {annSub.open && (
                              <div style={{ padding: '14px', background: 'rgba(0,0,0,0.2)', display: 'flex', flexDirection: 'column', gap: 14 }}>

                                {/* 1 — Texte */}
                                <div>
                                  <label style={{ display: 'block', color: '#94a3b8', fontSize: 11, fontWeight: 700, marginBottom: 6, textTransform: 'uppercase', letterSpacing: 0.6 }}>💬 Texte du message</label>
                                  <textarea
                                    rows={4} value={annSub.text}
                                    onChange={e => setAnnSub(ch.id, { text: e.target.value })}
                                    placeholder="Ex: 🎯 Nouvelle prédiction disponible ! Rejoignez notre canal..."
                                    style={{ width: '100%', padding: '10px 12px', background: '#1e1b2e', border: '1px solid rgba(251,191,36,0.3)', borderRadius: 8, color: '#fff', fontSize: 13, boxSizing: 'border-box', resize: 'vertical', fontFamily: 'inherit', lineHeight: 1.6 }}
                                  />
                                  <div style={{ fontSize: 10, color: '#475569', marginTop: 4 }}>HTML supporté : &lt;b&gt;texte gras&lt;/b&gt; · &lt;i&gt;italique&lt;/i&gt; · &lt;a href="…"&gt;lien&lt;/a&gt;</div>
                                </div>

                                {/* 2 — Média : Image ou Vidéo */}
                                <div>
                                  <label style={{ display: 'block', color: '#94a3b8', fontSize: 11, fontWeight: 700, marginBottom: 8, textTransform: 'uppercase', letterSpacing: 0.6 }}>📎 Média accompagnateur</label>
                                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                                    {/* Carte Image */}
                                    <div
                                      onClick={() => setAnnSub(ch.id, { media_type: annSub.media_type === 'image' ? '' : 'image', media_url: '' })}
                                      style={{ cursor: 'pointer', borderRadius: 10, padding: '14px 12px', border: annSub.media_type === 'image' ? '2px solid #38bdf8' : '1px solid rgba(255,255,255,0.1)', background: annSub.media_type === 'image' ? 'rgba(56,189,248,0.1)' : 'rgba(255,255,255,0.03)', transition: 'all 0.15s', textAlign: 'center' }}>
                                      <div style={{ fontSize: 28, marginBottom: 6 }}>🖼️</div>
                                      <div style={{ fontWeight: 700, fontSize: 12, color: annSub.media_type === 'image' ? '#38bdf8' : '#94a3b8' }}>Image</div>
                                      <div style={{ fontSize: 10, color: '#475569', marginTop: 3 }}>JPG, PNG, GIF, WebP</div>
                                      {annSub.media_type === 'image' && <div style={{ marginTop: 6, fontSize: 11, color: '#38bdf8', fontWeight: 700 }}>✓ Sélectionnée</div>}
                                    </div>
                                    {/* Carte Vidéo */}
                                    <div
                                      onClick={() => setAnnSub(ch.id, { media_type: annSub.media_type === 'video' ? '' : 'video', media_url: '' })}
                                      style={{ cursor: 'pointer', borderRadius: 10, padding: '14px 12px', border: annSub.media_type === 'video' ? '2px solid #a78bfa' : '1px solid rgba(255,255,255,0.1)', background: annSub.media_type === 'video' ? 'rgba(167,139,250,0.1)' : 'rgba(255,255,255,0.03)', transition: 'all 0.15s', textAlign: 'center' }}>
                                      <div style={{ fontSize: 28, marginBottom: 6 }}>🎬</div>
                                      <div style={{ fontWeight: 700, fontSize: 12, color: annSub.media_type === 'video' ? '#a78bfa' : '#94a3b8' }}>Vidéo</div>
                                      <div style={{ fontSize: 10, color: '#475569', marginTop: 3 }}>MP4, MOV, AVI</div>
                                      {annSub.media_type === 'video' && <div style={{ marginTop: 6, fontSize: 11, color: '#a78bfa', fontWeight: 700 }}>✓ Sélectionnée</div>}
                                    </div>
                                  </div>
                                  {/* URL du média (si sélectionné) */}
                                  {annSub.media_type && (
                                    <div style={{ marginTop: 10 }}>
                                      <label style={{ display: 'block', color: '#94a3b8', fontSize: 11, fontWeight: 600, marginBottom: 5 }}>
                                        🔗 URL de {annSub.media_type === 'image' ? "l'image" : 'la vidéo'}
                                      </label>
                                      <input
                                        value={annSub.media_url}
                                        onChange={e => setAnnSub(ch.id, { media_url: e.target.value })}
                                        placeholder={annSub.media_type === 'image' ? 'https://example.com/image.jpg' : 'https://example.com/video.mp4'}
                                        style={{ width: '100%', padding: '8px 10px', background: '#1e1b2e', border: `1px solid ${annSub.media_type === 'image' ? 'rgba(56,189,248,0.4)' : 'rgba(167,139,250,0.4)'}`, borderRadius: 7, color: '#fff', fontSize: 12, boxSizing: 'border-box', fontFamily: 'monospace' }}
                                      />
                                    </div>
                                  )}
                                  {!annSub.media_type && (
                                    <div style={{ marginTop: 8, fontSize: 11, color: '#334155', textAlign: 'center' }}>Aucun média — texte seul envoyé dans Telegram</div>
                                  )}
                                </div>

                                {/* 3 — Mode d'envoi */}
                                <div>
                                  <label style={{ display: 'block', color: '#94a3b8', fontSize: 11, fontWeight: 700, marginBottom: 8, textTransform: 'uppercase', letterSpacing: 0.6 }}>⏰ Planification</label>
                                  <div style={{ display: 'flex', gap: 8 }}>
                                    {[{ v: 'interval', l: '⏱ Intervalle régulier', d: 'ex: toutes les 2h' }, { v: 'times', l: '🕐 Heures fixes', d: 'ex: 13:00, 18:00' }].map(opt => (
                                      <button key={opt.v} type="button"
                                        onClick={() => setAnnSub(ch.id, { schedule_type: opt.v })}
                                        style={{ flex: 1, padding: '10px 12px', borderRadius: 9, cursor: 'pointer', textAlign: 'left', border: annSub.schedule_type === opt.v ? '2px solid #fbbf24' : '1px solid rgba(251,191,36,0.2)', background: annSub.schedule_type === opt.v ? 'rgba(251,191,36,0.12)' : 'rgba(255,255,255,0.03)', color: annSub.schedule_type === opt.v ? '#fbbf24' : '#64748b' }}>
                                        <div style={{ fontWeight: 700, fontSize: 12 }}>{opt.l}</div>
                                        <div style={{ fontSize: 10, opacity: 0.7, marginTop: 2 }}>{opt.d}</div>
                                      </button>
                                    ))}
                                  </div>
                                  <div style={{ marginTop: 10 }}>
                                    {annSub.schedule_type === 'interval' ? (
                                      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                                        <label style={{ color: '#94a3b8', fontSize: 12, fontWeight: 600, whiteSpace: 'nowrap' }}>Toutes les</label>
                                        <input type="number" min="0.5" max="168" step="0.5"
                                          value={annSub.interval_hours}
                                          onChange={e => setAnnSub(ch.id, { interval_hours: e.target.value })}
                                          style={{ width: 90, padding: '8px 10px', background: '#1e1b2e', border: '1px solid rgba(251,191,36,0.3)', borderRadius: 7, color: '#fff', fontSize: 14, fontWeight: 700 }} />
                                        <span style={{ color: '#94a3b8', fontSize: 13 }}>heure(s)</span>
                                        <span style={{ color: '#475569', fontSize: 11 }}>· 0.5 = 30 min · 1 = 1h · 24 = par jour</span>
                                      </div>
                                    ) : (
                                      <div>
                                        <label style={{ display: 'block', color: '#94a3b8', fontSize: 11, fontWeight: 600, marginBottom: 5 }}>Heures d'envoi (HH:MM, séparées par des virgules)</label>
                                        <input value={annSub.times_input}
                                          onChange={e => setAnnSub(ch.id, { times_input: e.target.value })}
                                          placeholder="13:00, 18:00, 21:30"
                                          style={{ width: '100%', padding: '8px 10px', background: '#1e1b2e', border: '1px solid rgba(251,191,36,0.3)', borderRadius: 7, color: '#fff', fontSize: 13, boxSizing: 'border-box' }} />
                                        <div style={{ fontSize: 10, color: '#475569', marginTop: 4 }}>Fuseau horaire serveur · format 24h</div>
                                      </div>
                                    )}
                                  </div>
                                </div>

                                <div style={{ fontSize: 11, color: '#334155', padding: '8px 12px', background: 'rgba(251,191,36,0.05)', borderRadius: 7, border: '1px solid rgba(251,191,36,0.1)' }}>
                                  ℹ️ Le bot token et l'ID canal sont repris automatiquement depuis la configuration ci-dessus lors de la sauvegarde.
                                </div>
                              </div>
                            )}
                          </div>
                        );
                      })()}

                      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
                        <button className="btn btn-ghost btn-sm" type="button" onClick={() => setDefaultChOpen(null)}>Annuler</button>
                        <button
                          className="btn btn-gold btn-sm"
                          type="button"
                          disabled={defaultTgSaving}
                          onClick={async () => {
                            await saveDefaultStratTg(ch.id, { name: ch.name, emoji: ch.emoji, color: ch.color });
                            await saveAnnSub(ch.id, cfg.bot_token, cfg.channel_id, ch.name);
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
              const validTargets = (s.tg_targets || []).filter(t => t.bot_token && t.channel_id);
              const tgt = validTargets[0];
              const isConfigured = validTargets.length > 0;
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
                          <span style={{ fontSize: 11, padding: '2px 8px', borderRadius: 5, fontWeight: 700, background: 'rgba(34,197,94,0.15)', color: '#22c55e', border: '1px solid rgba(34,197,94,0.35)' }}>
                            ✅ {validTargets.length} canal{validTargets.length > 1 ? 'x' : ''}
                          </span>
                        ) : (
                          <span style={{ fontSize: 11, padding: '2px 8px', borderRadius: 5, fontWeight: 700, background: 'rgba(239,68,68,0.12)', color: '#f87171', border: '1px solid rgba(239,68,68,0.3)' }}>⚠️ Non configuré</span>
                        )}
                      </div>
                      {isConfigured && (
                        <div style={{ fontSize: 11, color: '#64748b', marginTop: 3, display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                          {validTargets.map((t, i) => (
                            <span key={i} style={{ fontFamily: 'monospace', background: 'rgba(168,85,247,0.1)', padding: '1px 6px', borderRadius: 4, color: '#a78bfa' }}>
                              {t.channel_id}{t.tg_format ? ` F${t.tg_format}` : ''}
                            </span>
                          ))}
                        </div>
                      )}
                    </div>
                    <button
                      type="button"
                      onClick={() => {
                        if (isOpen) { setStratChOpen(null); setStratChForm({ bot_token: '', channel_id: '', tg_format: null }); return; }
                        setStratChOpen(s.id);
                        // Si un seul canal configuré → pré-remplir pour modification directe
                        const existingTargets = (s.tg_targets || []).filter(t => t.bot_token && t.channel_id);
                        if (existingTargets.length === 1) {
                          const t = existingTargets[0];
                          setStratChForm({ bot_token: t.bot_token, channel_id: t.channel_id, tg_format: t.tg_format ?? s.tg_format ?? null });
                        } else {
                          setStratChForm({ bot_token: '', channel_id: '', tg_format: s.tg_format ?? null });
                        }
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

                      {/* ── Liste des canaux existants ── */}
                      {(s.tg_targets || []).filter(t => t.channel_id).length > 0 && (
                        <div style={{ marginBottom: 14 }}>
                          <div style={{ fontSize: 11, color: '#64748b', fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.6, marginBottom: 8 }}>Canaux configurés</div>
                          {(s.tg_targets || []).filter(t => t.channel_id).map((tgt, ti) => (
                            <div key={ti} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 12px', background: 'rgba(168,85,247,0.07)', border: '1px solid rgba(168,85,247,0.2)', borderRadius: 8, marginBottom: 6 }}>
                              <div style={{ flex: 1, minWidth: 0 }}>
                                <div style={{ fontFamily: 'monospace', fontSize: 12, color: '#e2e8f0', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                  {tgt.channel_id}
                                </div>
                                <div style={{ fontSize: 11, color: '#94a3b8', marginTop: 2 }}>
                                  Format : <span style={{ color: '#a78bfa', fontWeight: 700 }}>
                                    {(() => {
                                      const effectiveFmt = tgt.tg_format ?? s.tg_format;
                                      if (!effectiveFmt) return TG_FORMATS[0]?.label || 'Par défaut';
                                      const fObj = TG_FORMATS.find(f => String(f.value) === String(effectiveFmt));
                                      return fObj ? `#${effectiveFmt} — ${fObj.label}` : `Format ${effectiveFmt}`;
                                    })()}
                                  </span>
                                </div>
                              </div>
                              <button
                                type="button"
                                onClick={() => { if (confirm(`Supprimer le canal ${tgt.channel_id} ?`)) removeStratTgTarget(s.id, tgt.channel_id); }}
                                style={{ padding: '5px 10px', borderRadius: 6, background: 'rgba(239,68,68,0.12)', color: '#f87171', border: '1px solid rgba(239,68,68,0.3)', cursor: 'pointer', fontSize: 12, fontWeight: 700, flexShrink: 0 }}
                              >🗑️</button>
                            </div>
                          ))}
                        </div>
                      )}

                      {/* ── Formulaire ajout / modification canal ── */}
                      <div style={{ fontSize: 11, color: '#64748b', fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.6, marginBottom: 8 }}>
                        {(s.tg_targets || []).filter(t => t.bot_token && t.channel_id).length === 1 ? '✏️ Modifier le canal' : '➕ Ajouter un canal'}
                      </div>
                      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 10 }}>
                        <div>
                          <label style={{ display: 'block', color: '#94a3b8', fontSize: 11, fontWeight: 600, marginBottom: 5 }}>Token Bot Telegram</label>
                          <input
                            type="text"
                            placeholder="123456:ABCdef..."
                            value={stratChForm.bot_token}
                            onChange={e => setStratChForm(p => ({ ...p, bot_token: e.target.value }))}
                            style={{ width: '100%', padding: '8px 10px', background: '#1e1b2e', border: '1px solid rgba(255,255,255,0.12)', borderRadius: 7, color: '#fff', fontSize: 12, fontFamily: 'monospace', boxSizing: 'border-box' }}
                          />
                        </div>
                        <div>
                          <label style={{ display: 'block', color: '#94a3b8', fontSize: 11, fontWeight: 600, marginBottom: 5 }}>ID Canal Telegram</label>
                          <input
                            type="text"
                            placeholder="@moncanal ou -100123456789"
                            value={stratChForm.channel_id}
                            onChange={e => setStratChForm(p => ({ ...p, channel_id: e.target.value }))}
                            style={{ width: '100%', padding: '8px 10px', background: '#1e1b2e', border: '1px solid rgba(255,255,255,0.12)', borderRadius: 7, color: '#fff', fontSize: 12, fontFamily: 'monospace', boxSizing: 'border-box' }}
                          />
                        </div>
                      </div>
                      <div style={{ marginBottom: 12 }}>
                        <label style={{ display: 'block', color: '#94a3b8', fontSize: 11, fontWeight: 600, marginBottom: 5 }}>
                          📋 Format de prédiction pour ce canal
                        </label>
                        <select
                          value={stratChForm.tg_format ?? ''}
                          onChange={e => setStratChForm(p => ({ ...p, tg_format: e.target.value }))}
                          style={{ width: '100%', padding: '8px 10px', background: '#1e1b2e', border: '1px solid rgba(168,85,247,0.3)', borderRadius: 7, color: '#fff', fontSize: 12 }}
                        >
                          {TG_FORMATS.map(f => <option key={f.value} value={f.value}>{f.label}</option>)}
                        </select>
                      </div>

                      {/* ── Message d'annonce planifiée ── */}
                      {(() => {
                        const annKey = `strat_${s.id}`;
                        const annSub = getAnnSub(annKey);
                        return (
                          <div style={{ marginBottom: 14, borderRadius: 10, border: '1px solid rgba(251,191,36,0.25)', overflow: 'hidden' }}>
                            <button type="button"
                              onClick={() => setAnnSub(annKey, { open: !annSub.open })}
                              style={{ width: '100%', display: 'flex', alignItems: 'center', gap: 10, padding: '10px 14px', background: annSub.open ? 'rgba(251,191,36,0.1)' : 'rgba(251,191,36,0.04)', border: 'none', cursor: 'pointer', textAlign: 'left' }}>
                              <span style={{ fontSize: 16 }}>📢</span>
                              <span style={{ flex: 1, fontWeight: 700, fontSize: 12, color: annSub.open ? '#fbbf24' : '#94a3b8' }}>Message d'annonce planifiée</span>
                              <span style={{ fontSize: 11, color: annSub.text.trim() ? '#fbbf24' : '#475569', fontWeight: 600 }}>
                                {annSub.text.trim() ? (annSub.schedule_type === 'interval' ? `⏱ toutes les ${annSub.interval_hours}h` : `🕐 ${annSub.times_input || 'heures à définir'}`) : 'Optionnel'}
                              </span>
                              <span style={{ color: '#64748b', fontSize: 13 }}>{annSub.open ? '▲' : '▼'}</span>
                            </button>
                            {annSub.open && (
                              <div style={{ padding: '14px', background: 'rgba(0,0,0,0.2)', display: 'flex', flexDirection: 'column', gap: 14 }}>

                                {/* 1 — Texte */}
                                <div>
                                  <label style={{ display: 'block', color: '#94a3b8', fontSize: 11, fontWeight: 700, marginBottom: 6, textTransform: 'uppercase', letterSpacing: 0.6 }}>💬 Texte du message</label>
                                  <textarea
                                    rows={4} value={annSub.text}
                                    onChange={e => setAnnSub(annKey, { text: e.target.value })}
                                    placeholder="Ex: 🎯 Nouvelle prédiction disponible ! Rejoignez notre canal..."
                                    style={{ width: '100%', padding: '10px 12px', background: '#1e1b2e', border: '1px solid rgba(251,191,36,0.3)', borderRadius: 8, color: '#fff', fontSize: 13, boxSizing: 'border-box', resize: 'vertical', fontFamily: 'inherit', lineHeight: 1.6 }}
                                  />
                                  <div style={{ fontSize: 10, color: '#475569', marginTop: 4 }}>HTML supporté : &lt;b&gt;texte gras&lt;/b&gt; · &lt;i&gt;italique&lt;/i&gt; · &lt;a href="…"&gt;lien&lt;/a&gt;</div>
                                </div>

                                {/* 2 — Média : Image ou Vidéo */}
                                <div>
                                  <label style={{ display: 'block', color: '#94a3b8', fontSize: 11, fontWeight: 700, marginBottom: 8, textTransform: 'uppercase', letterSpacing: 0.6 }}>📎 Média accompagnateur</label>
                                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                                    <div
                                      onClick={() => setAnnSub(annKey, { media_type: annSub.media_type === 'image' ? '' : 'image', media_url: '' })}
                                      style={{ cursor: 'pointer', borderRadius: 10, padding: '14px 12px', border: annSub.media_type === 'image' ? '2px solid #38bdf8' : '1px solid rgba(255,255,255,0.1)', background: annSub.media_type === 'image' ? 'rgba(56,189,248,0.1)' : 'rgba(255,255,255,0.03)', transition: 'all 0.15s', textAlign: 'center' }}>
                                      <div style={{ fontSize: 28, marginBottom: 6 }}>🖼️</div>
                                      <div style={{ fontWeight: 700, fontSize: 12, color: annSub.media_type === 'image' ? '#38bdf8' : '#94a3b8' }}>Image</div>
                                      <div style={{ fontSize: 10, color: '#475569', marginTop: 3 }}>JPG, PNG, GIF, WebP</div>
                                      {annSub.media_type === 'image' && <div style={{ marginTop: 6, fontSize: 11, color: '#38bdf8', fontWeight: 700 }}>✓ Sélectionnée</div>}
                                    </div>
                                    <div
                                      onClick={() => setAnnSub(annKey, { media_type: annSub.media_type === 'video' ? '' : 'video', media_url: '' })}
                                      style={{ cursor: 'pointer', borderRadius: 10, padding: '14px 12px', border: annSub.media_type === 'video' ? '2px solid #a78bfa' : '1px solid rgba(255,255,255,0.1)', background: annSub.media_type === 'video' ? 'rgba(167,139,250,0.1)' : 'rgba(255,255,255,0.03)', transition: 'all 0.15s', textAlign: 'center' }}>
                                      <div style={{ fontSize: 28, marginBottom: 6 }}>🎬</div>
                                      <div style={{ fontWeight: 700, fontSize: 12, color: annSub.media_type === 'video' ? '#a78bfa' : '#94a3b8' }}>Vidéo</div>
                                      <div style={{ fontSize: 10, color: '#475569', marginTop: 3 }}>MP4, MOV, AVI</div>
                                      {annSub.media_type === 'video' && <div style={{ marginTop: 6, fontSize: 11, color: '#a78bfa', fontWeight: 700 }}>✓ Sélectionnée</div>}
                                    </div>
                                  </div>
                                  {annSub.media_type && (
                                    <div style={{ marginTop: 10 }}>
                                      <label style={{ display: 'block', color: '#94a3b8', fontSize: 11, fontWeight: 600, marginBottom: 5 }}>
                                        🔗 URL de {annSub.media_type === 'image' ? "l'image" : 'la vidéo'}
                                      </label>
                                      <input
                                        value={annSub.media_url}
                                        onChange={e => setAnnSub(annKey, { media_url: e.target.value })}
                                        placeholder={annSub.media_type === 'image' ? 'https://example.com/image.jpg' : 'https://example.com/video.mp4'}
                                        style={{ width: '100%', padding: '8px 10px', background: '#1e1b2e', border: `1px solid ${annSub.media_type === 'image' ? 'rgba(56,189,248,0.4)' : 'rgba(167,139,250,0.4)'}`, borderRadius: 7, color: '#fff', fontSize: 12, boxSizing: 'border-box', fontFamily: 'monospace' }}
                                      />
                                    </div>
                                  )}
                                  {!annSub.media_type && (
                                    <div style={{ marginTop: 8, fontSize: 11, color: '#334155', textAlign: 'center' }}>Aucun média — texte seul envoyé dans Telegram</div>
                                  )}
                                </div>

                                {/* 3 — Mode d'envoi */}
                                <div>
                                  <label style={{ display: 'block', color: '#94a3b8', fontSize: 11, fontWeight: 700, marginBottom: 8, textTransform: 'uppercase', letterSpacing: 0.6 }}>⏰ Planification</label>
                                  <div style={{ display: 'flex', gap: 8 }}>
                                    {[{ v: 'interval', l: '⏱ Intervalle régulier', d: 'ex: toutes les 2h' }, { v: 'times', l: '🕐 Heures fixes', d: 'ex: 13:00, 18:00' }].map(opt => (
                                      <button key={opt.v} type="button"
                                        onClick={() => setAnnSub(annKey, { schedule_type: opt.v })}
                                        style={{ flex: 1, padding: '10px 12px', borderRadius: 9, cursor: 'pointer', textAlign: 'left', border: annSub.schedule_type === opt.v ? '2px solid #fbbf24' : '1px solid rgba(251,191,36,0.2)', background: annSub.schedule_type === opt.v ? 'rgba(251,191,36,0.12)' : 'rgba(255,255,255,0.03)', color: annSub.schedule_type === opt.v ? '#fbbf24' : '#64748b' }}>
                                        <div style={{ fontWeight: 700, fontSize: 12 }}>{opt.l}</div>
                                        <div style={{ fontSize: 10, opacity: 0.7, marginTop: 2 }}>{opt.d}</div>
                                      </button>
                                    ))}
                                  </div>
                                  <div style={{ marginTop: 10 }}>
                                    {annSub.schedule_type === 'interval' ? (
                                      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                                        <label style={{ color: '#94a3b8', fontSize: 12, fontWeight: 600, whiteSpace: 'nowrap' }}>Toutes les</label>
                                        <input type="number" min="0.5" max="168" step="0.5"
                                          value={annSub.interval_hours}
                                          onChange={e => setAnnSub(annKey, { interval_hours: e.target.value })}
                                          style={{ width: 90, padding: '8px 10px', background: '#1e1b2e', border: '1px solid rgba(251,191,36,0.3)', borderRadius: 7, color: '#fff', fontSize: 14, fontWeight: 700 }} />
                                        <span style={{ color: '#94a3b8', fontSize: 13 }}>heure(s)</span>
                                        <span style={{ color: '#475569', fontSize: 11 }}>· 0.5 = 30 min · 1 = 1h · 24 = par jour</span>
                                      </div>
                                    ) : (
                                      <div>
                                        <label style={{ display: 'block', color: '#94a3b8', fontSize: 11, fontWeight: 600, marginBottom: 5 }}>Heures d'envoi (HH:MM, séparées par des virgules)</label>
                                        <input value={annSub.times_input}
                                          onChange={e => setAnnSub(annKey, { times_input: e.target.value })}
                                          placeholder="13:00, 18:00, 21:30"
                                          style={{ width: '100%', padding: '8px 10px', background: '#1e1b2e', border: '1px solid rgba(251,191,36,0.3)', borderRadius: 7, color: '#fff', fontSize: 13, boxSizing: 'border-box' }} />
                                        <div style={{ fontSize: 10, color: '#475569', marginTop: 4 }}>Fuseau horaire serveur · format 24h</div>
                                      </div>
                                    )}
                                  </div>
                                </div>

                                <div style={{ fontSize: 11, color: '#334155', padding: '8px 12px', background: 'rgba(251,191,36,0.05)', borderRadius: 7, border: '1px solid rgba(251,191,36,0.1)' }}>
                                  ℹ️ Le bot token et l'ID canal sont repris automatiquement depuis la configuration ci-dessus lors de la sauvegarde.
                                </div>
                              </div>
                            )}
                          </div>
                        );
                      })()}

                      <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
                        <button className="btn btn-ghost btn-sm" type="button" onClick={() => { setStratChOpen(null); setStratChForm({ bot_token: '', channel_id: '', tg_format: null }); }}>Fermer</button>
                        <button
                          className="btn btn-gold btn-sm"
                          type="button"
                          disabled={stratChSaving || !stratChForm.bot_token.trim() || !stratChForm.channel_id.trim()}
                          onClick={async () => {
                            await saveStratTg(s.id);
                            await saveAnnSub(`strat_${s.id}`, stratChForm.bot_token, stratChForm.channel_id, s.name);
                          }}
                          style={{ background: 'linear-gradient(135deg,#7e22ce,#a855f7)' }}
                        >
                          {stratChSaving ? '⏳ Sauvegarde…' : '➕ Ajouter ce canal'}
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
        )}

        {/* ── SECTION 2-bis : STRATÉGIES PRO (S5001-S5100) ── */}
        <div className="tg-admin-card" style={{ borderColor: 'rgba(99,102,241,0.5)', marginBottom: 20 }}>
          <div className="tg-admin-header">
            <span className="tg-admin-icon">🔷</span>
            <div style={{ flex: 1 }}>
              <h2 className="tg-admin-title">Stratégies Pro — cibles Telegram</h2>
              <p className="tg-admin-sub">
                Toutes les stratégies Pro importées (S5001 à S5100). Configurez un <strong>bot_token</strong>, un <strong>channel_id</strong> et un <strong>format</strong> dédiés à chaque stratégie. À défaut, la stratégie envoie sur la <em>config Telegram du propriétaire</em>.
              </p>
            </div>
            <button
              type="button"
              onClick={loadProStratsTg}
              disabled={proStratsTgLoading}
              style={{ marginRight: 8, padding: '6px 12px', borderRadius: 6, border: '1px solid rgba(99,102,241,0.4)', background: 'rgba(99,102,241,0.1)', color: '#a5b4fc', cursor: 'pointer', fontWeight: 700, fontSize: 12 }}
            >
              {proStratsTgLoading ? '⏳ …' : '🔄 Recharger'}
            </button>
            <span className="tg-badge-connected" style={{ background: 'rgba(99,102,241,0.15)', color: '#818cf8', border: '1px solid rgba(99,102,241,0.35)' }}>
              {proStratsTg.length} pro
            </span>
          </div>

          {proStratsTg.length === 0 && !proStratsTgLoading && (
            <div style={{ padding: '20px 4px', color: '#64748b', textAlign: 'center', fontSize: 13 }}>
              Aucune stratégie Pro importée. Demandez à un compte Pro d'en charger une depuis sa Config Pro.
            </div>
          )}

          {proStratsTg.length > 0 && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 0, marginTop: 8 }}>
              {proStratsTg.map((p, idx) => {
                const targets = p.tg_targets || [];
                const open = proStratTgOpen === p.id;
                const f = proStratTgForm[p.id] || { bot_token: '', channel_id: '', tg_format: null };
                return (
                  <div key={p.id} style={{
                    borderBottom: idx < proStratsTg.length - 1 ? '1px solid rgba(255,255,255,0.05)' : 'none',
                    padding: '12px 0',
                  }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
                      <div style={{ width: 42, height: 42, borderRadius: 10, background: 'rgba(99,102,241,0.12)', border: '2px solid rgba(99,102,241,0.3)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 18, flexShrink: 0 }}>🔷</div>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                          <span style={{ fontWeight: 700, color: '#e2e8f0', fontSize: 14 }}>{p.strategy_name}</span>
                          <span style={{ fontSize: 11, padding: '1px 7px', borderRadius: 5, fontWeight: 700, background: 'rgba(99,102,241,0.18)', color: '#818cf8', border: '1px solid rgba(99,102,241,0.35)' }}>S{p.id}</span>
                          {p.engine_type && (
                            <span style={{ fontSize: 10, padding: '1px 6px', borderRadius: 4, background: 'rgba(255,255,255,0.06)', color: '#94a3b8', fontWeight: 700, textTransform: 'uppercase' }}>{p.engine_type}</span>
                          )}
                          <span style={{ fontSize: 11, padding: '2px 7px', borderRadius: 5, fontWeight: 600,
                            background: p.hand === 'banquier' ? 'rgba(239,68,68,0.15)' : 'rgba(34,197,94,0.15)',
                            color: p.hand === 'banquier' ? '#f87171' : '#4ade80',
                          }}>
                            {p.hand === 'banquier' ? '🎮 Banquier' : '🤖 Joueur'}
                          </span>
                          {targets.length > 0 ? (
                            <span style={{ fontSize: 11, padding: '2px 8px', borderRadius: 5, fontWeight: 700, background: 'rgba(34,197,94,0.15)', color: '#22c55e', border: '1px solid rgba(34,197,94,0.35)' }}>
                              ✅ {targets.length} canal{targets.length > 1 ? 'x' : ''}
                            </span>
                          ) : p.owner_default_telegram ? (
                            <span style={{ fontSize: 11, padding: '2px 8px', borderRadius: 5, fontWeight: 700, background: 'rgba(168,85,247,0.15)', color: '#a78bfa', border: '1px solid rgba(168,85,247,0.35)' }}>
                              🪪 Config Pro propriétaire
                            </span>
                          ) : (
                            <span style={{ fontSize: 11, padding: '2px 8px', borderRadius: 5, fontWeight: 700, background: 'rgba(239,68,68,0.12)', color: '#f87171', border: '1px solid rgba(239,68,68,0.3)' }}>
                              ⚠️ Aucun canal
                            </span>
                          )}
                        </div>
                        <div style={{ fontSize: 12, color: '#94a3b8', marginTop: 3 }}>
                          {p.filename}
                          {p.owner_username && <> · 👤 <span style={{ color: '#cbd5e1' }}>{p.owner_username}</span></>}
                          {p.decalage != null && <> · décalage +{p.decalage}</>}
                          <> · R{p.max_rattrapage}</>
                        </div>
                        {targets.length > 0 && (
                          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 6 }}>
                            {targets.map(t => (
                              <span key={`${t.channel_id}_${t.bot_token?.slice(0,6)}`} style={{
                                display: 'inline-flex', alignItems: 'center', gap: 6,
                                fontSize: 11, padding: '3px 8px', borderRadius: 6,
                                background: 'rgba(34,158,217,0.1)', color: '#7dd3fc',
                                border: '1px solid rgba(34,158,217,0.3)',
                              }}>
                                ✈️ {t.channel_id} · fmt {t.format ?? 1}
                                <button type="button"
                                  onClick={() => removeProStratTgTarget(p.id, t.channel_id)}
                                  title="Retirer"
                                  style={{ border: 'none', background: 'transparent', color: '#f87171', cursor: 'pointer', fontSize: 13, padding: 0 }}
                                >✕</button>
                              </span>
                            ))}
                            <button type="button"
                              onClick={() => testProStratTg(p.id)}
                              style={{ fontSize: 11, padding: '3px 8px', borderRadius: 6, border: '1px solid rgba(34,197,94,0.4)', background: 'rgba(34,197,94,0.1)', color: '#4ade80', cursor: 'pointer', fontWeight: 600 }}
                            >🧪 Tester</button>
                          </div>
                        )}
                      </div>
                      <div style={{ flexShrink: 0 }}>
                        <button type="button"
                          onClick={() => setProStratTgOpen(open ? null : p.id)}
                          style={{ fontSize: 12, padding: '6px 12px', borderRadius: 6, border: '1px solid rgba(99,102,241,0.4)', background: open ? 'rgba(99,102,241,0.2)' : 'rgba(99,102,241,0.08)', color: '#a5b4fc', cursor: 'pointer', fontWeight: 700 }}
                        >
                          {open ? '▾ Fermer' : '✏️ Modifier'}
                        </button>
                      </div>
                    </div>

                    {open && (
                      <div style={{ marginTop: 12, padding: 12, borderRadius: 8, background: 'rgba(15,23,42,0.5)', border: '1px solid rgba(99,102,241,0.25)' }}>
                        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 10 }}>
                          <div>
                            <label style={{ fontSize: 11, color: '#94a3b8', fontWeight: 700 }}>Bot token</label>
                            <input type="text" value={f.bot_token}
                              onChange={e => setProStratTgForm(p2 => ({ ...p2, [p.id]: { ...f, bot_token: e.target.value } }))}
                              placeholder="123456:ABCdef..."
                              style={{ width: '100%', marginTop: 4, padding: '8px 10px', borderRadius: 6, border: '1px solid rgba(255,255,255,0.1)', background: '#0f172a', color: '#e2e8f0', fontSize: 13 }} />
                          </div>
                          <div>
                            <label style={{ fontSize: 11, color: '#94a3b8', fontWeight: 700 }}>Channel ID</label>
                            <input type="text" value={f.channel_id}
                              onChange={e => setProStratTgForm(p2 => ({ ...p2, [p.id]: { ...f, channel_id: e.target.value } }))}
                              placeholder="-100123456..."
                              style={{ width: '100%', marginTop: 4, padding: '8px 10px', borderRadius: 6, border: '1px solid rgba(255,255,255,0.1)', background: '#0f172a', color: '#e2e8f0', fontSize: 13 }} />
                          </div>
                          <div>
                            <label style={{ fontSize: 11, color: '#94a3b8', fontWeight: 700 }}>Format (1-11)</label>
                            <input type="number" min="1" max="11" value={f.tg_format ?? ''}
                              onChange={e => setProStratTgForm(p2 => ({ ...p2, [p.id]: { ...f, tg_format: e.target.value } }))}
                              placeholder="1"
                              style={{ width: '100%', marginTop: 4, padding: '8px 10px', borderRadius: 6, border: '1px solid rgba(255,255,255,0.1)', background: '#0f172a', color: '#e2e8f0', fontSize: 13 }} />
                          </div>
                        </div>
                        <div style={{ marginTop: 10, display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
                          <button type="button"
                            onClick={() => setProStratTgOpen(null)}
                            style={{ fontSize: 12, padding: '7px 14px', borderRadius: 6, border: '1px solid rgba(255,255,255,0.15)', background: 'transparent', color: '#94a3b8', cursor: 'pointer', fontWeight: 600 }}
                          >Annuler</button>
                          <button type="button"
                            onClick={() => saveProStratTgTarget(p.id)}
                            disabled={!!proStratTgSaving[p.id]}
                            style={{ fontSize: 12, padding: '7px 14px', borderRadius: 6, border: 'none', background: '#6366f1', color: '#fff', cursor: 'pointer', fontWeight: 700 }}
                          >
                            {proStratTgSaving[p.id] ? '⏳ Enregistrement…' : '💾 Enregistrer'}
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>

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
              {(() => {
                const mu = users.find(u => u.id === visModal.userId);
                return mu?.is_premium
                  ? <><strong style={{ color: '#fbbf24' }}>⭐ Compte Premium</strong> — accès aux canaux assignés + compteurs d'absences visibles.</>
                  : <><strong style={{ color: '#94a3b8' }}>👤 Utilisateur standard</strong> — accès aux canaux assignés, sans compteurs.</>;
              })()}
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
                  {[
                    ...ALL_STRATEGIES,
                    ...strategies.map(s => ({ id: `S${s.id}`, name: s.name, emoji: '⚙' })),
                    ...proStrategies
                      .filter(s => s.owner_user_id === visModal.userId)
                      .map(s => ({ id: `S${s.id}`, name: s.name || s.strategy_name || `Stratégie S${s.id}`, emoji: '⭐' })),
                  ].map(st => {
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

      {/* ══════════════ PANEL STRATÉGIE ALÉATOIRE ══════════════ */}
      {aleatPanel && (
        <div
          onClick={e => { if (e.target === e.currentTarget) setAleatPanel(null); }}
          style={{ position: 'fixed', inset: 0, zIndex: 9999, background: 'rgba(0,0,0,0.88)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}
        >
          <div style={{ background: '#0f0d1a', border: '1px solid rgba(99,102,241,0.45)', borderRadius: 20, padding: 24, width: '100%', maxWidth: 400, maxHeight: '90vh', overflowY: 'auto', position: 'relative', boxShadow: '0 24px 80px rgba(0,0,0,0.6)' }}>

            {/* Header */}
            <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 22 }}>
              <div>
                <div style={{ fontSize: 10, color: '#6366f1', fontWeight: 800, textTransform: 'uppercase', letterSpacing: 1.2, marginBottom: 4 }}>🎲 Stratégie Aléatoire</div>
                <div style={{ fontSize: 17, fontWeight: 800, color: '#e2e8f0' }}>{aleatPanel.stratName}</div>
              </div>
              <button onClick={() => setAleatPanel(null)} style={{ background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)', color: '#94a3b8', fontSize: 16, cursor: 'pointer', borderRadius: 8, width: 32, height: 32, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>✕</button>
            </div>

            {/* STEP 1 — Choisir la main */}
            {aleatPanel.step === 'hand' && (
              <div>
                <div style={{ fontSize: 13, color: '#94a3b8', marginBottom: 18, textAlign: 'center' }}>Choisissez la main à prédire :</div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
                  <button
                    onClick={() => setAleatPanel(p => ({ ...p, hand: 'joueur', step: 'number' }))}
                    style={{ padding: '24px 12px', borderRadius: 14, border: '2px solid rgba(239,68,68,0.45)', background: 'rgba(239,68,68,0.09)', cursor: 'pointer', color: '#f87171', fontWeight: 800, fontSize: 22, textAlign: 'center' }}
                  >
                    ❤️<br /><span style={{ fontSize: 13, marginTop: 6, display: 'block' }}>Joueur</span>
                  </button>
                  <button
                    onClick={() => setAleatPanel(p => ({ ...p, hand: 'banquier', step: 'number' }))}
                    style={{ padding: '24px 12px', borderRadius: 14, border: '2px solid rgba(34,197,94,0.45)', background: 'rgba(34,197,94,0.09)', cursor: 'pointer', color: '#4ade80', fontWeight: 800, fontSize: 22, textAlign: 'center' }}
                  >
                    ♣️<br /><span style={{ fontSize: 13, marginTop: 6, display: 'block' }}>Banquier</span>
                  </button>
                </div>
              </div>
            )}

            {/* STEP 2 — Saisir le numéro à prédire */}
            {aleatPanel.step === 'number' && (
              <div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 20 }}>
                  <button onClick={() => setAleatPanel(p => ({ ...p, step: 'hand', hand: null, gameInput: '' }))} style={{ background: 'none', border: 'none', color: '#6366f1', cursor: 'pointer', fontSize: 13, padding: 0 }}>← Retour</button>
                  <span style={{ fontSize: 15, color: '#e2e8f0', fontWeight: 700 }}>{aleatPanel.hand === 'joueur' ? '❤️ Joueur' : '♣️ Banquier'}</span>
                </div>
                <div style={{ background: 'rgba(99,102,241,0.08)', border: '1px solid rgba(99,102,241,0.2)', borderRadius: 10, padding: 12, marginBottom: 16, fontSize: 12, color: '#a5b4fc', lineHeight: 1.6 }}>
                  💡 Le système prend les <strong>cartes du jeu en cours</strong> et en choisit aléatoirement pour prédire le numéro saisi. Le numéro doit être <strong>supérieur au jeu actuel</strong>.
                </div>
                <label style={{ display: 'block', color: '#94a3b8', fontSize: 12, marginBottom: 10 }}>Numéro de tour à prédire :</label>
                <input
                  type="number" min="1" max="1440"
                  value={aleatPanel.gameInput || ''}
                  onChange={e => setAleatPanel(p => ({ ...p, gameInput: e.target.value }))}
                  onKeyDown={e => e.key === 'Enter' && submitAleatPrediction()}
                  placeholder="ex: 145"
                  autoFocus
                  style={{ width: '100%', padding: '16px', background: '#1a1730', border: '2px solid rgba(99,102,241,0.45)', borderRadius: 12, color: '#e2e8f0', fontSize: 26, fontWeight: 800, textAlign: 'center', boxSizing: 'border-box', marginBottom: 14, outline: 'none' }}
                />
                <button
                  onClick={submitAleatPrediction}
                  disabled={!aleatPanel.gameInput}
                  style={{ width: '100%', padding: '15px', borderRadius: 12, border: 'none', cursor: aleatPanel.gameInput ? 'pointer' : 'not-allowed', fontWeight: 800, fontSize: 14, background: aleatPanel.gameInput ? 'linear-gradient(135deg,#6366f1,#a855f7)' : 'rgba(99,102,241,0.15)', color: aleatPanel.gameInput ? '#fff' : '#6b7280', transition: 'all 0.2s' }}
                >
                  🎯 Lancer la prédiction
                </button>
              </div>
            )}

            {/* STEP 3 — Résultat */}
            {aleatPanel.step === 'result' && aleatPanel.result && (
              <div style={{ textAlign: 'center' }}>
                <div style={{ fontSize: 64, marginBottom: 6 }}>{aleatPanel.result.suit_emoji}</div>
                <div style={{ fontSize: 22, fontWeight: 800, color: '#e2e8f0', marginBottom: 4 }}>Tour #{aleatPanel.result.game_number}</div>
                <div style={{ fontSize: 13, color: '#94a3b8', marginBottom: 4 }}>
                  {aleatPanel.hand === 'joueur' ? '❤️ Joueur' : '♣️ Banquier'} → <strong style={{ color: '#a5b4fc' }}>{aleatPanel.result.predicted_suit}</strong> prédit
                </div>
                <div style={{ fontSize: 12, color: '#64748b', marginBottom: 10 }}>
                  Cartes du jeu #{aleatPanel.result.source_game} : {(aleatPanel.result.source_cards_emoji || []).join(' ')}
                </div>
                <div style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '6px 16px', borderRadius: 20, background: 'rgba(234,179,8,0.12)', border: '1px solid rgba(234,179,8,0.35)', color: '#fbbf24', fontSize: 12, fontWeight: 700, marginBottom: 22 }}>
                  <span style={{ display: 'inline-block', width: 7, height: 7, borderRadius: '50%', background: '#fbbf24', animation: 'pulse 1.5s infinite' }} />
                  En cours de vérification par le moteur…
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                  <button
                    onClick={() => setAleatPanel(p => ({ ...p, step: 'hand', hand: null, gameInput: '', result: null }))}
                    style={{ padding: '13px', borderRadius: 11, border: '1px solid rgba(99,102,241,0.4)', background: 'rgba(99,102,241,0.12)', color: '#a5b4fc', cursor: 'pointer', fontWeight: 700, fontSize: 13 }}
                  >🎲 Nouveau</button>
                  <button
                    onClick={() => setAleatPanel(p => ({ ...p, step: 'number', result: null, gameInput: '' }))}
                    style={{ padding: '13px', borderRadius: 11, border: '1px solid rgba(168,85,247,0.4)', background: 'rgba(168,85,247,0.12)', color: '#c084fc', cursor: 'pointer', fontWeight: 700, fontSize: 13 }}
                  >🔢 Autre numéro</button>
                </div>
              </div>
            )}

            {/* Historique de session */}
            {(aleatPanel.history || []).length > 0 && (
              <div style={{ marginTop: 24, borderTop: '1px solid rgba(255,255,255,0.07)', paddingTop: 16 }}>
                <div style={{ fontSize: 10, color: '#475569', fontWeight: 800, textTransform: 'uppercase', letterSpacing: 1, marginBottom: 10 }}>Historique de session</div>
                {[...(aleatPanel.history || [])].reverse().map((h, i) => (
                  <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '9px 12px', borderRadius: 10, background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.05)', marginBottom: 7 }}>
                    <span style={{ fontSize: 22 }}>{h.suit_emoji}</span>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 13, fontWeight: 700, color: '#e2e8f0' }}>Tour #{h.game_number}</div>
                      <div style={{ fontSize: 11, color: '#64748b' }}>
                        {h.hand === 'joueur' ? '❤️ Joueur' : '♣️ Banquier'} — {h.predicted_suit}
                        {h.source_game ? ` (source: #${h.source_game} ${(h.source_cards_emoji || []).join('')})` : ''}
                      </div>
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
        </>}

      {/* ══════════════════════════════════════════════
          TAB : CONFIG IA
      ══════════════════════════════════════════════ */}
      {adminTab === 'config-ia' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>

          {/* ── Sélection du provider ── */}
          <div className="tg-admin-card" style={{ borderColor: 'rgba(168,85,247,0.4)' }}>
            <div className="tg-admin-header">
              <span className="tg-admin-icon">🧠</span>
              <div style={{ flex: 1 }}>
                <h2 className="tg-admin-title">Configuration du Provider IA</h2>
                <p className="tg-admin-sub">
                  Choisissez un provider IA gratuit et entrez votre clé API.
                  {aiConfigData.provider && aiConfigData.hasKey && (
                    <> Actuel : <strong style={{ color: '#a5b4fc' }}>{aiConfigData.provider}</strong> <span style={{ color: '#4ade80' }}>✅ Clé configurée</span></>
                  )}
                </p>
              </div>
              {aiMsg && (
                <span style={{ fontSize: 12, fontWeight: 700, color: aiMsg.startsWith('✅') ? '#22c55e' : '#f87171' }}>{aiMsg}</span>
              )}
            </div>

            {/* Liste des providers */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 10, marginBottom: 20 }}>
              {aiProviders.map(prov => {
                const active = aiSelectedProv === prov.id;
                const isCurrent = aiConfigData.provider === prov.id;
                return (
                  <div
                    key={prov.id}
                    onClick={() => setAiSelectedProv(prov.id)}
                    style={{
                      padding: '13px 16px', borderRadius: 12, cursor: 'pointer', transition: 'all .2s',
                      border: `2px solid ${active ? 'rgba(168,85,247,0.6)' : 'rgba(255,255,255,0.07)'}`,
                      background: active ? 'rgba(168,85,247,0.12)' : 'rgba(255,255,255,0.03)',
                    }}
                  >
                    <div style={{ fontWeight: 700, fontSize: 13, color: active ? '#c084fc' : '#cbd5e1', marginBottom: 4 }}>
                      {active ? '✅ ' : ''}{prov.name}
                      {isCurrent && aiConfigData.hasKey && <span style={{ marginLeft: 8, fontSize: 11, color: '#4ade80', fontWeight: 700 }}>EN COURS</span>}
                    </div>
                    <div style={{ fontSize: 11, color: '#64748b' }}>Modèle : {prov.model}</div>
                    <a href={prov.keyUrl} target="_blank" rel="noreferrer" onClick={e => e.stopPropagation()} style={{ fontSize: 11, color: '#6366f1', textDecoration: 'none' }}>
                      🔑 Obtenir la clé API gratuitement →
                    </a>
                  </div>
                );
              })}
            </div>

            {/* Clé API */}
            <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'flex-end' }}>
              <div style={{ flex: 1, minWidth: 260 }}>
                <label style={{ display: 'block', color: '#94a3b8', fontSize: 12, marginBottom: 6 }}>
                  Clé API {aiSelectedProv.toUpperCase()} {aiConfigData.provider === aiSelectedProv && aiConfigData.hasKey ? '(clé déjà enregistrée, laissez vide pour conserver)' : ''}
                </label>
                <input
                  type="password"
                  value={aiApiKey}
                  onChange={e => setAiApiKey(e.target.value)}
                  placeholder={aiConfigData.provider === aiSelectedProv && aiConfigData.hasKey ? '••••••••••••••••••••••' : 'Collez votre clé API ici…'}
                  style={{ width: '100%', padding: '12px 14px', background: '#0f1729', border: '2px solid rgba(168,85,247,0.3)', borderRadius: 10, color: '#e2e8f0', fontSize: 13, boxSizing: 'border-box', outline: 'none' }}
                />
              </div>
              <button
                onClick={async () => {
                  setAiSaving(true); setAiMsg('');
                  try {
                    const r = await fetch('/api/ai/config', { method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ provider: aiSelectedProv, key: aiApiKey }) });
                    const d = await r.json();
                    if (d.ok) { setAiMsg('✅ Configuré avec succès'); setAiApiKey(''); await loadAiConfig(); }
                    else setAiMsg('❌ ' + (d.error || 'Erreur'));
                  } catch { setAiMsg('❌ Erreur réseau'); }
                  setAiSaving(false);
                }}
                disabled={aiSaving}
                style={{ padding: '12px 22px', borderRadius: 10, border: 'none', background: 'linear-gradient(135deg,#7c3aed,#a855f7)', color: '#fff', fontWeight: 700, fontSize: 13, cursor: aiSaving ? 'not-allowed' : 'pointer', whiteSpace: 'nowrap' }}
              >
                {aiSaving ? '⏳ Sauvegarde…' : '💾 Enregistrer'}
              </button>
              <button
                onClick={async () => {
                  setAiTesting(true); setAiTestResult(null);
                  try {
                    const r = await fetch('/api/ai/test', { method: 'POST', credentials: 'include' });
                    const d = await r.json();
                    setAiTestResult(d);
                  } catch (e) { setAiTestResult({ ok: false, error: e.message }); }
                  setAiTesting(false);
                }}
                disabled={aiTesting || !aiConfigData.hasKey}
                style={{ padding: '12px 18px', borderRadius: 10, border: '1px solid rgba(34,197,94,0.4)', background: 'rgba(34,197,94,0.1)', color: '#4ade80', fontWeight: 700, fontSize: 13, cursor: (aiTesting || !aiConfigData.hasKey) ? 'not-allowed' : 'pointer', whiteSpace: 'nowrap', opacity: aiConfigData.hasKey ? 1 : 0.5 }}
              >
                {aiTesting ? '⏳ Test…' : '🔌 Tester la connexion'}
              </button>
            </div>

            {aiTestResult && (
              <div style={{ marginTop: 14, padding: '12px 16px', borderRadius: 10, border: `1px solid ${aiTestResult.ok ? 'rgba(34,197,94,0.35)' : 'rgba(239,68,68,0.35)'}`, background: aiTestResult.ok ? 'rgba(34,197,94,0.08)' : 'rgba(239,68,68,0.08)', fontSize: 13, color: aiTestResult.ok ? '#4ade80' : '#f87171' }}>
                {aiTestResult.ok ? `✅ Connexion OK — Réponse : "${aiTestResult.response}"` : `❌ Échec : ${aiTestResult.error}`}
              </div>
            )}
          </div>

          {/* ── Clé API gratuite Vision (paiements) ── */}
          <div className="tg-admin-card" style={{ borderColor: 'rgba(251,191,36,0.4)' }}>
            <div className="tg-admin-header">
              <span className="tg-admin-icon">🎁</span>
              <div style={{ flex: 1 }}>
                <h2 className="tg-admin-title">Clé API gratuite — Vérification des paiements</h2>
                <p className="tg-admin-sub">
                  Clé <b>Gemini Vision</b> (gratuite) utilisée pour analyser les captures d'écran de paiement
                  envoyées par les utilisateurs (montant, devise, date, référence, identifiant).
                  {visionKeyData.hasKey
                    ? <span style={{ color: '#4ade80', marginLeft: 6 }}>✅ Clé enregistrée</span>
                    : <span style={{ color: '#f87171', marginLeft: 6 }}>⚠️ Aucune clé — la vérification IA des paiements est désactivée</span>}
                </p>
              </div>
              {visionKeyMsg && (
                <span style={{ fontSize: 12, fontWeight: 700, color: visionKeyMsg.startsWith('✅') ? '#22c55e' : '#f87171' }}>{visionKeyMsg}</span>
              )}
            </div>

            <div style={{ marginBottom: 12, fontSize: 12, color: '#94a3b8' }}>
              📌 Obtenez votre clé gratuite sur{' '}
              <a href="https://aistudio.google.com/app/apikey" target="_blank" rel="noreferrer" style={{ color: '#6366f1' }}>
                aistudio.google.com/app/apikey
              </a>
              {' '}— totalement gratuite, sans carte bancaire. Si vous laissez cette section vide,
              la clé du provider Gemini configuré ci-dessus sera utilisée.
            </div>

            <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'flex-end' }}>
              <div style={{ flex: 1, minWidth: 260 }}>
                <label style={{ display: 'block', color: '#94a3b8', fontSize: 12, marginBottom: 6 }}>
                  Clé API Gemini gratuite {visionKeyData.hasKey ? '(laissez vide pour conserver l\'actuelle)' : ''}
                </label>
                <input
                  type="password"
                  value={visionKeyInput}
                  onChange={e => setVisionKeyInput(e.target.value)}
                  placeholder={visionKeyData.hasKey ? '••••••••••••••••••••••' : 'AIza...'}
                  style={{ width: '100%', padding: '12px 14px', background: '#0f1729', border: '2px solid rgba(251,191,36,0.3)', borderRadius: 10, color: '#e2e8f0', fontSize: 13, boxSizing: 'border-box', outline: 'none' }}
                />
              </div>
              <button
                onClick={async () => {
                  if (!visionKeyInput.trim()) { setVisionKeyMsg('❌ Clé vide'); return; }
                  setVisionKeySaving(true); setVisionKeyMsg('');
                  try {
                    const r = await fetch('/api/ai/vision-key', { method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ key: visionKeyInput.trim() }) });
                    const d = await r.json();
                    if (d.ok) { setVisionKeyMsg('✅ Clé enregistrée'); setVisionKeyInput(''); await loadAiConfig(); }
                    else setVisionKeyMsg('❌ ' + (d.error || 'Erreur'));
                  } catch { setVisionKeyMsg('❌ Erreur réseau'); }
                  setVisionKeySaving(false);
                }}
                disabled={visionKeySaving}
                style={{ padding: '12px 22px', borderRadius: 10, border: 'none', background: 'linear-gradient(135deg,#f59e0b,#fbbf24)', color: '#0f172a', fontWeight: 800, fontSize: 13, cursor: visionKeySaving ? 'not-allowed' : 'pointer', whiteSpace: 'nowrap' }}
              >
                {visionKeySaving ? '⏳ Sauvegarde…' : '💾 Enregistrer'}
              </button>
              {visionKeyData.hasKey && (
                <button
                  onClick={async () => {
                    if (!confirm('Supprimer la clé Vision enregistrée ?')) return;
                    try {
                      await fetch('/api/ai/vision-key', { method: 'DELETE', credentials: 'include' });
                      setVisionKeyMsg('✅ Supprimée');
                      await loadAiConfig();
                    } catch { setVisionKeyMsg('❌ Erreur'); }
                  }}
                  style={{ padding: '12px 16px', borderRadius: 10, border: '1px solid rgba(239,68,68,0.4)', background: 'rgba(239,68,68,0.08)', color: '#f87171', fontWeight: 700, fontSize: 12, cursor: 'pointer' }}
                >
                  🗑 Retirer
                </button>
              )}
            </div>
          </div>

          {/* ── Réparation automatique ── */}
          <div className="tg-admin-card" style={{ borderColor: 'rgba(34,197,94,0.3)' }}>
            <div className="tg-admin-header">
              <span className="tg-admin-icon">🔧</span>
              <div style={{ flex: 1 }}>
                <h2 className="tg-admin-title">Réparation IA automatique</h2>
                <p className="tg-admin-sub">
                  L'IA analyse l'état du moteur, les prédictions bloquées, les logs d'erreurs et propose des corrections de code appliquables en un clic.
                </p>
              </div>
            </div>

            <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginBottom: 16 }}>
              <button
                onClick={async () => {
                  setAiSmartRepairing(true); setAiRepairResult(null); setAiApplyLog([]);
                  try {
                    const r = await fetch('/api/ai/repair-smart', { method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ autofix: true }) });
                    const d = await r.json();
                    setAiRepairResult(d);
                  } catch (e) { setAiRepairResult({ ok: false, error: e.message }); }
                  setAiSmartRepairing(false);
                }}
                disabled={aiSmartRepairing || aiRepairing}
                style={{ padding: '13px 22px', borderRadius: 12, border: 'none', background: aiSmartRepairing ? 'rgba(34,197,94,0.2)' : 'linear-gradient(135deg,#059669,#10b981)', color: '#fff', fontWeight: 800, fontSize: 13, cursor: (aiSmartRepairing || aiRepairing) ? 'not-allowed' : 'pointer', display: 'flex', alignItems: 'center', gap: 8 }}
              >
                {aiSmartRepairing ? (
                  <><span style={{ display: 'inline-block', width: 14, height: 14, border: '2px solid rgba(255,255,255,0.3)', borderTopColor: '#fff', borderRadius: '50%', animation: 'spin 0.8s linear infinite' }} /> Analyse…</>
                ) : <><span>⚡</span> Diagnostic intelligent</>}
              </button>
              <button
                onClick={async () => {
                  if (!aiConfigData.hasKey) { setAiRepairResult({ ok: false, error: 'Configurez d\'abord un provider IA ci-dessus.' }); return; }
                  setAiRepairing(true); setAiRepairResult(null); setAiApplyLog([]);
                  try {
                    const r = await fetch('/api/ai/repair', { method: 'POST', credentials: 'include' });
                    const d = await r.json();
                    setAiRepairResult(d);
                  } catch (e) { setAiRepairResult({ ok: false, error: e.message }); }
                  setAiRepairing(false);
                }}
                disabled={aiRepairing || aiSmartRepairing}
                style={{ padding: '13px 22px', borderRadius: 12, border: '1px solid rgba(168,85,247,0.4)', background: aiRepairing ? 'rgba(168,85,247,0.1)' : 'transparent', color: '#c084fc', fontWeight: 700, fontSize: 13, cursor: (aiRepairing || aiSmartRepairing) ? 'not-allowed' : 'pointer', display: 'flex', alignItems: 'center', gap: 8 }}
              >
                {aiRepairing ? (
                  <><span style={{ display: 'inline-block', width: 14, height: 14, border: '2px solid rgba(168,85,247,0.3)', borderTopColor: '#c084fc', borderRadius: '50%', animation: 'spin 0.8s linear infinite' }} /> Analyse IA (30–60s)…</>
                ) : <><span>🔍</span> Diagnostic IA</>}
              </button>
            </div>

            {aiRepairResult && !aiRepairResult.ok && (
              <div style={{ padding: '12px 16px', borderRadius: 10, background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.35)', color: '#f87171', fontSize: 13 }}>
                ❌ {aiRepairResult.error}
              </div>
            )}

            {aiRepairResult?.result && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
                {/* Score santé */}
                <div style={{ display: 'flex', alignItems: 'center', gap: 14, padding: '14px 18px', borderRadius: 12, background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)' }}>
                  <div style={{ fontSize: 38, fontWeight: 900, color: aiRepairResult.result.score_sante >= 80 ? '#4ade80' : aiRepairResult.result.score_sante >= 50 ? '#fbbf24' : '#f87171' }}>
                    {aiRepairResult.result.score_sante}%
                  </div>
                  <div>
                    <div style={{ fontWeight: 700, color: '#e2e8f0', fontSize: 14, marginBottom: 4 }}>Score de santé du système</div>
                    <div style={{ fontSize: 12, color: '#94a3b8', lineHeight: 1.6 }}>{aiRepairResult.result.diagnostic}</div>
                  </div>
                </div>

                {/* Corrections automatiques appliquées */}
                {(aiRepairResult.result.fixesApplied || []).length > 0 && (
                  <div>
                    <div style={{ fontSize: 11, color: '#64748b', fontWeight: 800, textTransform: 'uppercase', letterSpacing: 1, marginBottom: 8 }}>✅ Corrections appliquées automatiquement</div>
                    {aiRepairResult.result.fixesApplied.map((f, i) => (
                      <div key={i} style={{ padding: '9px 14px', borderRadius: 10, marginBottom: 6, border: '1px solid rgba(34,197,94,0.3)', background: 'rgba(34,197,94,0.07)', fontSize: 12, color: '#86efac', display: 'flex', alignItems: 'center', gap: 8 }}>
                        <span>{f.icon || '🔧'}</span> {f.description}
                      </div>
                    ))}
                  </div>
                )}

                {/* Problèmes */}
                {(aiRepairResult.result.problemes || []).length > 0 && (
                  <div>
                    <div style={{ fontSize: 11, color: '#64748b', fontWeight: 800, textTransform: 'uppercase', letterSpacing: 1, marginBottom: 8 }}>Problèmes détectés</div>
                    {aiRepairResult.result.problemes.map((p, i) => (
                      <div key={i} style={{ padding: '10px 14px', borderRadius: 10, marginBottom: 8, border: `1px solid ${p.severity === 'critical' ? 'rgba(239,68,68,0.35)' : p.severity === 'warning' ? 'rgba(234,179,8,0.3)' : 'rgba(99,102,241,0.3)'}`, background: p.severity === 'critical' ? 'rgba(239,68,68,0.07)' : p.severity === 'warning' ? 'rgba(234,179,8,0.07)' : 'rgba(99,102,241,0.07)' }}>
                        <div style={{ fontWeight: 700, fontSize: 13, color: p.severity === 'critical' ? '#f87171' : p.severity === 'warning' ? '#fbbf24' : '#a5b4fc', marginBottom: 4 }}>
                          {p.severity === 'critical' ? '🔴 Critique' : p.severity === 'warning' ? '🟡 Avertissement' : '🔵 Info'} — {p.description}
                        </div>
                        {p.solution && <div style={{ fontSize: 12, color: '#94a3b8' }}>💡 {p.solution}</div>}
                      </div>
                    ))}
                  </div>
                )}

                {/* Corrections proposées */}
                {(aiRepairResult.result.corrections || []).length > 0 ? (
                  <div>
                    <div style={{ fontSize: 11, color: '#64748b', fontWeight: 800, textTransform: 'uppercase', letterSpacing: 1, marginBottom: 8 }}>
                      {aiRepairResult.result.corrections.length} correction(s) proposée(s)
                    </div>
                    {aiRepairResult.result.corrections.map((c, i) => {
                      const applied = aiApplyLog.find(l => l.i === i);
                      return (
                        <div key={i} style={{ padding: '12px 14px', borderRadius: 10, marginBottom: 10, border: `1px solid ${applied?.ok ? 'rgba(34,197,94,0.4)' : 'rgba(99,102,241,0.3)'}`, background: applied?.ok ? 'rgba(34,197,94,0.07)' : 'rgba(99,102,241,0.06)' }}>
                          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                            <div>
                              <span style={{ fontWeight: 700, fontSize: 12, color: '#c084fc' }}>{c.file}</span>
                              <span style={{ fontSize: 12, color: '#94a3b8', marginLeft: 10 }}>{c.description}</span>
                            </div>
                            {!applied ? (
                              <button
                                onClick={async () => {
                                  try {
                                    const r = await fetch('/api/ai/apply-fix', { method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ file: c.file, old_string: c.old_string, new_string: c.new_string, description: c.description }) });
                                    const d = await r.json();
                                    setAiApplyLog(prev => [...prev, { i, ok: d.ok, error: d.error }]);
                                  } catch (e) { setAiApplyLog(prev => [...prev, { i, ok: false, error: e.message }]); }
                                }}
                                style={{ padding: '7px 14px', borderRadius: 8, border: 'none', background: 'linear-gradient(135deg,#6366f1,#a855f7)', color: '#fff', fontWeight: 700, fontSize: 11, cursor: 'pointer', whiteSpace: 'nowrap' }}
                              >
                                ⚡ Appliquer
                              </button>
                            ) : (
                              <span style={{ fontSize: 12, fontWeight: 700, color: applied.ok ? '#4ade80' : '#f87171' }}>
                                {applied.ok ? '✅ Appliqué' : `❌ ${applied.error}`}
                              </span>
                            )}
                          </div>
                          <details style={{ marginTop: 8 }}>
                            <summary style={{ fontSize: 11, color: '#64748b', cursor: 'pointer' }}>Voir le code</summary>
                            <pre style={{ marginTop: 8, padding: 10, borderRadius: 8, background: '#0a0e1a', fontSize: 11, color: '#94a3b8', overflowX: 'auto', whiteSpace: 'pre-wrap', wordBreak: 'break-all', maxHeight: 250 }}>
                              <span style={{ color: '#f87171' }}>- {(c.old_string || '').slice(0, 500)}</span>{'\n'}
                              <span style={{ color: '#4ade80' }}>+ {(c.new_string || '').slice(0, 500)}</span>
                            </pre>
                          </details>
                        </div>
                      );
                    })}
                  </div>
                ) : (
                  <div style={{ padding: '12px 16px', borderRadius: 10, background: 'rgba(34,197,94,0.08)', border: '1px solid rgba(34,197,94,0.25)', color: '#4ade80', fontSize: 13, fontWeight: 700 }}>
                    ✅ Aucune correction de code nécessaire — le système semble sain.
                  </div>
                )}
              </div>
            )}
          </div>

        </div>
      )}

      {/* ── TAB : MISE À JOUR PAR BASE DE DONNÉES ── */}
      {adminTab === 'maj-db' && (
        <>
          <ProjectBackupPanel />
          <DeployLogsPanel />
        </>
      )}
      </div>{/* end admin-content */}
    </div>{/* end admin-page */}

    {/* ══════════════════════════════════════════════
        MODAL DE CONFIRMATION POST-SAVE TELEGRAM
    ══════════════════════════════════════════════ */}
    {tgSaveModal && (
      <div
        onClick={() => setTgSaveModal(null)}
        style={{
          position: 'fixed', inset: 0, zIndex: 9999,
          background: 'rgba(0,0,0,0.75)', backdropFilter: 'blur(6px)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          padding: 24,
        }}
      >
        <div
          onClick={e => e.stopPropagation()}
          style={{
            background: 'linear-gradient(160deg,#0f172a,#1e293b)',
            border: `2px solid ${tgSaveModal.color || 'rgba(34,197,94,0.5)'}`,
            borderRadius: 20, padding: '32px 36px',
            maxWidth: 520, width: '100%',
            boxShadow: `0 0 60px ${tgSaveModal.color || '#22c55e'}33`,
            fontFamily: 'sans-serif', position: 'relative',
          }}
        >
          {/* Bouton fermer */}
          <button
            onClick={() => setTgSaveModal(null)}
            style={{ position: 'absolute', top: 16, right: 16, background: 'rgba(255,255,255,0.07)', border: 'none', borderRadius: 8, color: '#94a3b8', cursor: 'pointer', fontSize: 18, padding: '4px 10px' }}
          >✕</button>

          {/* En-tête */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginBottom: 24 }}>
            <div style={{
              width: 56, height: 56, borderRadius: 14,
              background: `${tgSaveModal.color || '#22c55e'}22`,
              border: `2px solid ${tgSaveModal.color || '#22c55e'}55`,
              display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 26, flexShrink: 0,
            }}>
              {tgSaveModal.emoji || '✅'}
            </div>
            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                <span style={{ fontWeight: 900, fontSize: 18, color: '#f8fafc' }}>{tgSaveModal.name}</span>
                <span style={{ fontSize: 12, padding: '2px 10px', borderRadius: 20, fontWeight: 700, background: `${tgSaveModal.color || '#22c55e'}22`, color: tgSaveModal.color || '#22c55e', border: `1px solid ${tgSaveModal.color || '#22c55e'}44` }}>
                  {tgSaveModal.id}
                </span>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 5 }}>
                <span style={{ fontSize: 13, fontWeight: 700, color: '#22c55e' }}>✅ Configuration Telegram enregistrée</span>
              </div>
            </div>
          </div>

          {/* Infos configuration */}
          <div style={{ background: 'rgba(255,255,255,0.04)', borderRadius: 12, padding: '18px 20px', marginBottom: 16 }}>
            <div style={{ fontSize: 11, fontWeight: 800, color: '#64748b', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 14 }}>📡 Configuration Telegram</div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 14 }}>
              <div>
                <div style={{ fontSize: 11, color: '#64748b', marginBottom: 3 }}>Canal ID</div>
                <div style={{ fontSize: 13, color: '#e2e8f0', fontWeight: 700, fontFamily: 'monospace', wordBreak: 'break-all' }}>{tgSaveModal.channel_id}</div>
              </div>
              <div>
                <div style={{ fontSize: 11, color: '#64748b', marginBottom: 3 }}>Bot Token</div>
                <div style={{ fontSize: 13, color: '#94a3b8', fontFamily: 'monospace' }}>{tgSaveModal.bot_token_preview}</div>
              </div>
              <div style={{ gridColumn: '1 / -1' }}>
                <div style={{ fontSize: 11, color: '#64748b', marginBottom: 3 }}>Max rattrapages</div>
                <div style={{ fontSize: 13, color: '#fbbf24', fontWeight: 700 }}>🔄 {tgSaveModal.max_rattrapage} tentative{tgSaveModal.max_rattrapage > 1 ? 's' : ''}</div>
              </div>
            </div>

            {/* Format de prédiction — section détaillée */}
            <div style={{ background: 'rgba(167,139,250,0.08)', border: '1px solid rgba(167,139,250,0.25)', borderRadius: 10, padding: '14px 16px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10, flexWrap: 'wrap' }}>
                <span style={{ fontSize: 10, fontWeight: 800, color: '#64748b', textTransform: 'uppercase', letterSpacing: 1 }}>📋 Format de prédiction</span>
                {tgSaveModal.format_id ? (
                  <span style={{ fontSize: 11, padding: '2px 9px', borderRadius: 20, fontWeight: 800, background: 'rgba(167,139,250,0.25)', color: '#c4b5fd', border: '1px solid rgba(167,139,250,0.5)' }}>
                    #{tgSaveModal.format_id}
                  </span>
                ) : (
                  <span style={{ fontSize: 11, padding: '2px 9px', borderRadius: 20, fontWeight: 700, background: 'rgba(100,116,139,0.2)', color: '#64748b', border: '1px solid rgba(100,116,139,0.3)' }}>
                    Global
                  </span>
                )}
              </div>
              <div style={{ fontWeight: 800, fontSize: 15, color: '#a78bfa', marginBottom: 10 }}>
                {tgSaveModal.format_label}
              </div>
              {tgSaveModal.format_id ? (() => {
                const maxR = tgSaveModal.max_rattrapage ?? 20;
                const G = 1234;
                const PREVIEWS = {
                  1:  `⚜ #N${G} Игрок    +${maxR} ⚜\n◽Масть ♥️\n◼️ Результат ⌛`,
                  2:  `🎲𝐁𝐀𝐂𝐂𝐀𝐑𝐀 𝐏𝐑𝐄𝐌𝐈𝐔𝐌+${maxR} ✨🎲\nGame ${G} :♥️\nEn cours :⌛`,
                  3:  `𝐁𝐀𝐂𝐂𝐀𝐑𝐀 𝐏𝐑𝐎 ✨\n🎮GAME: #N${G}\n🃏Carte ♥️:⌛\nMode: Dogon ${maxR}`,
                  4:  `🎰 PRÉDICTION #${G}\n🎯 Couleur: ♥️ Cœur\n📊 Statut: En cours ⏳\n🔍 Vérification en cours`,
                  5:  `🎰 PRÉDICTION #${G}\n🎯 Couleur: ♥️ Cœur\n\n🔍 Vérification jeu #${G}\n🟦⬜⬜⬜⬜\n⏳ Analyse...`,
                  6:  `🏆 PRÉDICTION #${G}\n\n🎯 Couleur: ♥️ Cœur\n⏳ Statut: En cours`,
                  7:  `Le joueur recevra une carte ♥️ Cœur\n\n⏳ En attente du résultat...`,
                  8:  `🤖 joueur :${G}\n🔰Couleur de la carte :♥️\n🔰 Rattrapages : ${maxR}(🔰+${maxR})\n🧨 Résultats : ⌛`,
                  9:  `🤖 joueur :${G}\n🔰Couleur de la carte :♥️\n🔰 Rattrapages : ${maxR}(🔰+${maxR})\n🧨 Résultats : ⌛`,
                  10: `🎮 banquier №${G}\n⚜️ Couleur de la carte:♥️\n🎰 Poursuite  🔰+${maxR} jeux\n🗯️ Résultats : ⌛`,
                  11: `🃏 LE JEU VA SE TERMINER SUR LA DISTRIBUTION\n📌 Jeu #${G}\n━━━━━━━━━━━━━━━\n✅ Distribution : OUI\n⌛ En cours de vérification...`,
                };
                const WIN_PREVIEWS = {
                  1:  `⚜ #N${G} Игрок    +${maxR} ⚜\n◽Масть ♥️\n◼️ Результат ✅ 🎯`,
                  2:  `🎲𝐁𝐀𝐂𝐂𝐀𝐑𝐀 𝐏𝐑𝐄𝐌𝐈𝐔𝐌+${maxR} ✨🎲\nGame ${G} :♥️\nStatut :✅ 🎯`,
                  3:  `𝐁𝐀𝐂𝐂𝐀𝐑𝐀 𝐏𝐑𝐎 ✨\n🎮GAME: #N${G}\n🃏Carte ♥️:✅ 🎯\nMode: Dogon ${maxR}`,
                  4:  `🎰 PRÉDICTION #${G}\n🎯 Couleur: ♥️ Cœur\n📊 Statut: ✅ 🎯\n🔍 Vérifié ✓`,
                  5:  `🎰 PRÉDICTION #${G}\n🎯 Couleur: ♥️ Cœur\n\n🔍 Vérification jeu #${G}\n🟩⬜⬜⬜⬜\n✅ 🎯`,
                  6:  `🏆 PRÉDICTION #${G}\n\n🎯 Couleur: ♥️ Cœur\n✅ Statut: ✅ 🎯`,
                  7:  `Le joueur recevra une carte ♥️ Cœur\n\n✅ GAGNÉ 🎯`,
                  8:  `🤖 joueur :${G}\n🔰Couleur de la carte :♥️\n🔰 Rattrapages : ${maxR}(🔰+${maxR})\n🧨 Résultats : ✅🎯GAGNÉ`,
                  9:  `🤖 joueur :${G}\n🔰Couleur de la carte :♥️\n🔰 Rattrapages : ${maxR}(🔰+${maxR})\n🧨 Résultats : ✅🎯GAGNÉ`,
                  10: `🎮 banquier №${G}\n⚜️ Couleur de la carte:♥️\n🎰 Poursuite  🔰+${maxR} jeux\n🗯️ Résultats : ✅🎯GAGNÉ`,
                  11: `🃏 LE JEU VA SE TERMINER SUR LA DISTRIBUTION\n📌 Jeu #${G}\n━━━━━━━━━━━━━━━\n✅ Distribution : OUI\n✅ 0️⃣GAGNÉ 🎯`,
                };
                const fid = parseInt(tgSaveModal.format_id);
                const prev = PREVIEWS[fid];
                const winPrev = WIN_PREVIEWS[fid];
                if (!prev) return null;
                return (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                    <div style={{ background: '#1e2433', borderRadius: 8, padding: '10px 12px', border: '1px solid rgba(255,255,255,0.06)' }}>
                      <div style={{ fontSize: 9, color: '#93c5fd', fontWeight: 700, marginBottom: 6, textTransform: 'uppercase', letterSpacing: 0.5 }}>⌛ Envoi initial — en attente</div>
                      <pre style={{ margin: 0, fontSize: '0.72rem', color: '#cbd5e1', fontFamily: 'inherit', whiteSpace: 'pre-wrap', lineHeight: 1.6 }}>{prev}</pre>
                    </div>
                    <div style={{ background: '#1a2a1a', borderRadius: 8, padding: '10px 12px', border: '1px solid rgba(34,197,94,0.15)' }}>
                      <div style={{ fontSize: 9, color: '#86efac', fontWeight: 700, marginBottom: 6, textTransform: 'uppercase', letterSpacing: 0.5 }}>✅ Après résultat — Gagné</div>
                      <pre style={{ margin: 0, fontSize: '0.72rem', color: '#86efac', fontFamily: 'inherit', whiteSpace: 'pre-wrap', lineHeight: 1.6 }}>{winPrev}</pre>
                    </div>
                  </div>
                );
              })() : (
                <div style={{ fontSize: 12, color: '#64748b', fontStyle: 'italic', padding: '8px 0' }}>
                  ℹ️ Le format global sera appliqué (défini dans Paramètres → Format des messages)
                </div>
              )}
            </div>
          </div>

          {/* Infos stratégie (uniquement pour stratégies perso) */}
          {tgSaveModal.type === 'strategie' && (
            <div style={{ background: 'rgba(168,85,247,0.06)', border: '1px solid rgba(168,85,247,0.2)', borderRadius: 12, padding: '16px 20px', marginBottom: 16 }}>
              <div style={{ fontSize: 11, fontWeight: 800, color: '#64748b', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 14 }}>⚙️ Paramètres de la stratégie</div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                <div>
                  <div style={{ fontSize: 11, color: '#64748b', marginBottom: 3 }}>Mode</div>
                  <div style={{ fontSize: 13, color: '#e2e8f0', fontWeight: 700 }}>🎯 {tgSaveModal.mode}</div>
                </div>
                <div>
                  <div style={{ fontSize: 11, color: '#64748b', marginBottom: 3 }}>Main cible</div>
                  <div style={{ fontSize: 13, color: '#e2e8f0', fontWeight: 700 }}>{tgSaveModal.hand}</div>
                </div>
                <div>
                  <div style={{ fontSize: 11, color: '#64748b', marginBottom: 3 }}>Seuil de déclenchement</div>
                  <div style={{ fontSize: 13, color: '#38bdf8', fontWeight: 700 }}>⚡ {tgSaveModal.threshold} parties</div>
                </div>
                <div>
                  <div style={{ fontSize: 11, color: '#64748b', marginBottom: 3 }}>Statut</div>
                  <div style={{ fontSize: 13, fontWeight: 700, color: tgSaveModal.enabled ? '#22c55e' : '#f87171' }}>
                    {tgSaveModal.enabled ? '🟢 Active' : '🔴 Désactivée'}
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* Compteurs */}
          <div style={{ background: 'rgba(255,255,255,0.03)', borderRadius: 12, padding: '16px 20px', marginBottom: 24 }}>
            <div style={{ fontSize: 11, fontWeight: 800, color: '#64748b', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 14 }}>📊 Compteurs (total historique)</div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 10, textAlign: 'center' }}>
              {[
                { label: 'Total', value: tgSaveModal.total, color: '#e2e8f0', bg: 'rgba(255,255,255,0.06)' },
                { label: '✅ Gagnés', value: tgSaveModal.wins, color: '#4ade80', bg: 'rgba(34,197,94,0.1)' },
                { label: '❌ Perdus', value: tgSaveModal.losses, color: '#f87171', bg: 'rgba(239,68,68,0.1)' },
                { label: '⏳ En cours', value: tgSaveModal.pending, color: '#fbbf24', bg: 'rgba(234,179,8,0.1)' },
              ].map(c => (
                <div key={c.label} style={{ background: c.bg, borderRadius: 10, padding: '12px 8px' }}>
                  <div style={{ fontSize: 20, fontWeight: 900, color: c.color }}>{c.value}</div>
                  <div style={{ fontSize: 10, color: '#64748b', marginTop: 3, fontWeight: 600 }}>{c.label}</div>
                </div>
              ))}
            </div>
            {(tgSaveModal.wins + tgSaveModal.losses) > 0 && (
              <div style={{ marginTop: 12 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, color: '#64748b', marginBottom: 4 }}>
                  <span>Taux de réussite</span>
                  <span style={{ color: '#4ade80', fontWeight: 700 }}>
                    {((tgSaveModal.wins / (tgSaveModal.wins + tgSaveModal.losses)) * 100).toFixed(1)}%
                  </span>
                </div>
                <div style={{ height: 6, borderRadius: 99, background: 'rgba(255,255,255,0.06)', overflow: 'hidden' }}>
                  <div style={{ height: '100%', borderRadius: 99, background: 'linear-gradient(90deg,#22c55e,#4ade80)', width: `${(tgSaveModal.wins / (tgSaveModal.wins + tgSaveModal.losses)) * 100}%`, transition: 'width 0.5s' }} />
                </div>
              </div>
            )}
          </div>

          {/* Bouton fermer */}
          <button
            onClick={() => setTgSaveModal(null)}
            style={{ width: '100%', padding: '12px', borderRadius: 12, border: 'none', cursor: 'pointer', fontWeight: 800, fontSize: 15, background: `linear-gradient(135deg,${tgSaveModal.color || '#22c55e'},${tgSaveModal.color || '#4ade80'})`, color: '#0f172a' }}
          >
            Parfait, fermer
          </button>
        </div>
      </div>
    )}
    </>
  );
}
