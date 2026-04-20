import React, { useState, useEffect, useCallback } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';

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

        {/* Bouton téléchargement ZIP */}
        <a
          href="/api/admin/project-backup/zip"
          download
          style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10,
            padding: '10px 20px', borderRadius: 12, textDecoration: 'none', fontWeight: 700, fontSize: 12,
            background: 'rgba(168,85,247,0.1)', border: '2px solid rgba(168,85,247,0.35)', color: '#c084fc',
            transition: 'all 0.2s', marginBottom: 4,
          }}>
          <span>📦</span>
          <span>Télécharger le ZIP de déploiement</span>
          <span style={{ fontSize: 10, fontWeight: 400, opacity: 0.7, marginLeft: 4 }}>fichiers actuels</span>
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
  const isSuperAdmin = user?.admin_level === 1;

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
  ];

  // stratType: 'simple' = prédiction locale seulement; 'telegram' = envoie vers canal TG custom
  const BLANK_FORM = { name: '', threshold: 5, mode: 'manquants', mappings: { '♠':['♥'],'♥':['♠'],'♦':['♣'],'♣':['♦'] }, visibility: 'admin', enabled: true, tg_targets: [], stratType: 'simple', exceptions: [], prediction_offset: 1, hand: 'joueur', max_rattrapage: 20, tg_format: null, mirror_pairs: [], trigger_on: null, trigger_strategy_id: '', trigger_count: 2, trigger_level: 3, relance_enabled: false, relance_pertes: 3, relance_types: [], relance_nombre: 1, strategy_type: 'simple', multi_source_ids: [], multi_require: 'any', loss_type: 'rattrapage', relance_rules: [] };

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
  const [successModal, setSuccessModal] = useState(null);
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
      const MODE_LABELS = { manquants:'Absences', apparents:'Apparitions', absence_apparition:'Absence → Apparition', apparition_absence:'Apparition → Absence', taux_miroir:'Taux miroir', multi_strategy:'Multi-stratégie', relance:'Relance', distribution:'Distribution', carte_3_vers_2:'3 cartes → 2 cartes', carte_2_vers_3:'2 cartes → 3 cartes', compteur_adverse:'Compteur Adverse' };
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
    setStratForm({ name: s.name, threshold: s.threshold, mode: s.mode, mappings, visibility: s.visibility, enabled: s.enabled, tg_targets, stratType, exceptions, prediction_offset: s.prediction_offset || 1, hand: s.hand === 'banquier' ? 'banquier' : 'joueur', max_rattrapage: s.max_rattrapage ?? 20, tg_format: s.tg_format ?? null, mirror_pairs: normalizeMirrorPairs(s.mirror_pairs), trigger_on: s.trigger_on ?? null, trigger_strategy_id: s.trigger_strategy_id ?? '', trigger_count: s.trigger_count ?? 2, trigger_level: s.trigger_level ?? 3, relance_enabled: s.relance_enabled ?? false, relance_pertes: s.relance_pertes ?? 3, relance_types: s.relance_types ?? [], relance_nombre: s.relance_nombre ?? 1, strategy_type: s.strategy_type || 'simple', multi_source_ids: s.multi_source_ids || [], multi_require: s.multi_require || 'any', loss_type: s.loss_type || 'rattrapage', relance_rules: s.relance_rules || [] });
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
    setStratForm({ name: `Copie de ${s.name}`, threshold: s.threshold, mode: s.mode, mappings, visibility: s.visibility, enabled: false, tg_targets, stratType, exceptions, prediction_offset: s.prediction_offset || 1, hand: s.hand === 'banquier' ? 'banquier' : 'joueur', max_rattrapage: s.max_rattrapage ?? 20, tg_format: s.tg_format ?? null, mirror_pairs: normalizeMirrorPairs(s.mirror_pairs), trigger_on: s.trigger_on ?? null, trigger_strategy_id: s.trigger_strategy_id ?? '', trigger_count: s.trigger_count ?? 2, trigger_level: s.trigger_level ?? 3, relance_enabled: s.relance_enabled ?? false, relance_pertes: s.relance_pertes ?? 3, relance_types: s.relance_types ?? [], relance_nombre: s.relance_nombre ?? 1, strategy_type: s.strategy_type || 'simple', multi_source_ids: s.multi_source_ids || [], multi_require: s.multi_require || 'any', loss_type: s.loss_type || 'rattrapage', relance_rules: s.relance_rules || [] });
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

  useEffect(() => { loadUsers(); loadChannels(); loadTokenInfo(); loadStrategies(); loadStratStats(); loadMsgFormat(); loadMaxR(); loadBotAdminTgId(); loadStrategyRoutes(); loadDefaultStratTg(); loadAnnouncements(); loadRenderDbStatus(); loadUiStyles(); loadCustomCss(); loadModifiedFiles(); loadBroadcastMessage(); loadUserMessages(); loadHostedBots(); }, [loadUsers, loadChannels, loadTokenInfo, loadStrategies, loadStratStats, loadMsgFormat, loadMaxR, loadBotAdminTgId, loadStrategyRoutes, loadDefaultStratTg, loadAnnouncements, loadRenderDbStatus, loadUiStyles, loadCustomCss, loadModifiedFiles, loadBroadcastMessage, loadUserMessages, loadHostedBots]);

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

  const modeLabels = { manquants: 'Absences', apparents: 'Apparitions', absence_apparition: 'Abs→App', apparition_absence: 'App→Abs', miroir_taux: 'Miroir Taux', aleatoire: 'Aléatoire', relance: 'Relance', multi_strategy: 'Combinaison', distribution: 'Distribution', carte_3_vers_2: '3C→2C', carte_2_vers_3: '2C→3C', taux_miroir: 'Miroir Taux', compteur_adverse: 'C. Adverse' };

  return (
    <>
    <div className="admin-page">

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
          {isSuperAdmin && <Link to="/system-logs" className="btn btn-ghost btn-sm" style={{ color: '#22c55e', fontWeight: 700 }}>🖥 Logs</Link>}
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
            { id: 'utilisateurs',   icon: '👥', label: 'Utilisateurs',   badge: isSuperAdmin ? ((nonAdmins.filter(u => u.status === 'pending').length + userMessages.filter(m => !m.read).length) || null) : null },
            { id: 'strategies',     icon: '⚙️', label: 'Stratégies',     badge: strategies.length > 0 ? strategies.length : null },
            { id: 'bilan',          icon: '📊', label: 'Bilan' },
            { id: 'canaux',         icon: '✈️', label: 'Telegram',        badge: tgChannels.length > 0 ? tgChannels.length : null },
            { id: 'config',         icon: '🔀', label: 'Routage' },
            { id: 'tg-direct',      icon: '📨', label: 'Canal Direct' },
            ...(isSuperAdmin ? [
              { id: 'systeme',      icon: '🛠️', label: 'Système' },
              { id: 'bots',         icon: '🤖', label: 'Bots',           badge: hostedBots.length > 0 ? hostedBots.length : null },
              { id: 'maj-db',       icon: '💾', label: 'Mise à jour DB' },
            ] : []),
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

        {/* ── COMPTES PREMIUM (super admin uniquement) ── */}
        {isSuperAdmin && <div className="tg-admin-card" style={{ borderColor: 'rgba(250,204,21,0.4)' }}>
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
                            <button className="btn btn-tg btn-sm" onClick={() => openVisModal(u)}>📡 Canaux</button>
                            {isSuperAdmin && u.status !== 'pending' && (
                              <button className="btn btn-danger btn-sm" onClick={() => revokeUser(u.id)}>🔒 Révoquer</button>
                            )}
                            {isSuperAdmin && <button className="btn btn-danger btn-sm" onClick={() => deleteUser(u.id)} style={{ opacity: 0.7 }}>🗑️</button>}
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
                          : s.mode;
                        const isAutoMode = s.mode === 'absence_apparition' || s.mode === 'apparition_absence' || s.mode === 'distribution' || s.mode === 'carte_3_vers_2' || s.mode === 'carte_2_vers_3';
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

                                {/* ── Condition B : Rattrapages consécutifs ── */}
                                <div style={{ display: 'flex', flexDirection: 'column', gap: 6, padding: '8px 10px', borderRadius: 8, background: rLevel != null ? 'rgba(129,140,248,0.07)' : 'rgba(255,255,255,0.02)', border: `1px solid ${rLevel != null ? 'rgba(129,140,248,0.22)' : 'rgba(255,255,255,0.05)'}` }}>
                                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                                    <CondToggle active={rLevel != null} color="#818cf8"
                                      onClick={() => updateRule({ rattrapage_level: rLevel != null ? null : 3, rattrapage_count: 1 })} />
                                    <span style={{ fontSize: 11, fontWeight: 700, color: rLevel != null ? '#818cf8' : '#475569' }}>Rattrapage consécutif</span>
                                    {rLevel != null && <span style={{ fontSize: 10, color: '#94a3b8', marginLeft: 'auto' }}>{rCount}× R{rLevel} de suite → relance</span>}
                                  </div>
                                  {rLevel != null && (
                                    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                                      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                                        <span style={{ fontSize: 10, color: '#64748b', minWidth: 50 }}>Niveau :</span>
                                        <BtnLevel value={rLevel} color="#818cf8" onChange={n => updateRule({ rattrapage_level: n })} />
                                      </div>
                                      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                                        <span style={{ fontSize: 10, color: '#64748b', minWidth: 50 }}>Fois :</span>
                                        <BtnCount value={rCount} color="#818cf8" onChange={n => updateRule({ rattrapage_count: n })} />
                                      </div>
                                    </div>
                                  )}
                                </div>

                                {/* ── Condition C : Perte + Rattrapage (combo) ── */}
                                <div style={{ display: 'flex', flexDirection: 'column', gap: 6, padding: '8px 10px', borderRadius: 8, background: cLevel != null ? 'rgba(52,211,153,0.07)' : 'rgba(255,255,255,0.02)', border: `1px solid ${cLevel != null ? 'rgba(52,211,153,0.22)' : 'rgba(255,255,255,0.05)'}` }}>
                                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                                    <CondToggle active={cLevel != null} color="#34d399"
                                      onClick={() => updateRule({ combo_level: cLevel != null ? null : 3, combo_count: 1 })} />
                                    <span style={{ fontSize: 11, fontWeight: 700, color: cLevel != null ? '#34d399' : '#475569' }}>Perte + Rattrapage</span>
                                    {cLevel != null && <span style={{ fontSize: 10, color: '#94a3b8', marginLeft: 'auto' }}>{cCount} événement{cCount > 1 ? 's' : ''} (perte ou R{cLevel}) → relance</span>}
                                  </div>
                                  {cLevel != null && (
                                    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                                      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                                        <span style={{ fontSize: 10, color: '#64748b', minWidth: 50 }}>Niveau R :</span>
                                        <BtnLevel value={cLevel} color="#34d399" onChange={n => updateRule({ combo_level: n })} />
                                      </div>
                                      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                                        <span style={{ fontSize: 10, color: '#64748b', minWidth: 50 }}>Fois :</span>
                                        <BtnCount value={cCount} color="#34d399" onChange={n => updateRule({ combo_count: n })} />
                                      </div>
                                    </div>
                                  )}
                                </div>

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

                {/* Main à surveiller : Joueur / Banquier */}
                {stratForm.mode !== 'relance' && stratForm.mode !== 'distribution' && (
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
                )}

                {/* Mode — masqué pour multi-stratégie */}
                {(<>
                <div>
                  <label style={{ display: 'block', color: '#94a3b8', fontSize: 12, marginBottom: 5 }}>Mode</label>
                  <select value={stratForm.mode} onChange={e => {
                    const m = e.target.value;
                    const isNew = m === 'absence_apparition' || m === 'apparition_absence' || m === 'distribution' || m === 'carte_3_vers_2' || m === 'carte_2_vers_3';
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
                    <option value="relance">🔁 Séquences de Relance</option>
                    <option value="aleatoire">🎲 Stratégie Aléatoire</option>
                  </select>
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

                {/* Seuil B / Différence — masqué pour relance et aleatoire */}
                {stratForm.mode !== 'relance' && stratForm.mode !== 'aleatoire' && <div style={stratForm.mode === 'taux_miroir' ? { gridColumn: '1 / -1' } : {}}>
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

                </>)}

                {/* Numéro à prédire (+1, +2, ...) */}
                {stratForm.mode !== 'relance' && stratForm.mode !== 'taux_miroir' && stratForm.mode !== 'aleatoire' && <div style={{ gridColumn: '1 / -1' }}>
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
                {stratForm.mode !== 'relance' && (
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
              {stratForm.mode !== 'relance' && stratForm.mode !== 'taux_miroir' && stratForm.mode !== 'aleatoire' && <>
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
              {stratForm.mode !== 'absence_apparition' && stratForm.mode !== 'distribution' && stratForm.mode !== 'carte_3_vers_2' && stratForm.mode !== 'carte_2_vers_3' && stratForm.mode !== 'taux_miroir' && stratForm.mode !== 'relance' && stratForm.mode !== 'aleatoire' && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, margin: '24px 0 14px', padding: '8px 14px', borderRadius: 9, background: 'rgba(148,163,184,0.06)', border: '1px solid rgba(148,163,184,0.15)' }}>
                <span style={{ fontSize: 13 }}>🗺️</span>
                <span style={{ fontSize: 11, fontWeight: 800, color: '#94a3b8', letterSpacing: 1.2, textTransform: 'uppercase', flex: 1 }}>Mappings de prédiction</span>
              </div>
              )}

              {/* Presets de combinaison — masqué pour absence_apparition, distribution, taux_miroir, relance, aleatoire */}
              {stratForm.mode !== 'absence_apparition' && stratForm.mode !== 'distribution' && stratForm.mode !== 'carte_3_vers_2' && stratForm.mode !== 'carte_2_vers_3' && stratForm.mode !== 'taux_miroir' && stratForm.mode !== 'relance' && stratForm.mode !== 'aleatoire' && <div style={{ marginTop: 0 }}>
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

              {/* Mappings manuels — masqué pour absence_apparition, distribution, taux_miroir, relance, aleatoire */}
              {stratForm.mode !== 'absence_apparition' && stratForm.mode !== 'distribution' && stratForm.mode !== 'carte_3_vers_2' && stratForm.mode !== 'carte_2_vers_3' && stratForm.mode !== 'taux_miroir' && stratForm.mode !== 'relance' && stratForm.mode !== 'aleatoire' && <div style={{ marginTop: 16 }}>
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
                  background: bot.running ? 'rgba(34,197,94,0.06)' : 'rgba(255,255,255,0.03)',
                  border: `1px solid ${bot.running ? 'rgba(34,197,94,0.3)' : 'rgba(255,255,255,0.1)'}`,
                }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                    <span style={{ fontSize: 16 }}>{bot.language === 'node' ? '🟨' : '🐍'}</span>
                    <span style={{ fontWeight: 700, color: '#e2e8f0', flex: 1 }}>{bot.name}</span>
                    <span style={{ fontSize: 11, fontWeight: 700, padding: '2px 8px', borderRadius: 20,
                      background: bot.running ? 'rgba(34,197,94,0.15)' : 'rgba(107,114,128,0.2)',
                      color: bot.running ? '#22c55e' : '#9ca3af' }}>
                      {bot.running ? '🟢 Actif' : '⚫ Arrêté'}
                    </span>
                    {bot.restarts > 0 && <span style={{ fontSize: 10, color: '#fbbf24' }}>🔄 {bot.restarts} redémarrage{bot.restarts > 1 ? 's' : ''}</span>}
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

                  {/* Zone logs */}
                  {botLogId === bot.id && (
                    <div style={{ marginTop: 12, background: '#0f172a', borderRadius: 8, padding: '10px 12px', maxHeight: 220, overflowY: 'auto', fontFamily: 'monospace', fontSize: 11 }}>
                      {botLogs.length === 0 ? (
                        <span style={{ color: '#64748b' }}>Aucun log disponible.</span>
                      ) : botLogs.map((l, i) => (
                        <div key={i} style={{ color: l.s === 'err' ? '#f87171' : '#86efac', marginBottom: 2 }}>
                          <span style={{ color: '#64748b', marginRight: 6 }}>[{new Date(l.t).toLocaleTimeString()}]</span>{l.m}
                        </div>
                      ))}
                    </div>
                  )}
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

      {/* ── TAB : MISE À JOUR PAR BASE DE DONNÉES ── */}
      {adminTab === 'maj-db' && (
        <>
          <ProjectBackupPanel />
          <DeployLogsPanel />
        </>
      )}

    </div>

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
