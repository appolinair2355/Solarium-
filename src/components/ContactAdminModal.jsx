import { useState, useEffect, useRef } from 'react';

const SEEN_KEY = 'seen_admin_replies';

function getSeenIds() {
  try { return new Set(JSON.parse(localStorage.getItem(SEEN_KEY) || '[]')); }
  catch { return new Set(); }
}
function markSeen(ids) {
  try { localStorage.setItem(SEEN_KEY, JSON.stringify([...ids])); } catch {}
}

export default function ContactAdminModal({ trigger }) {
  const [open, setOpen]       = useState(false);
  const [tab, setTab]         = useState('compose');
  const [text, setText]       = useState('');
  const [sending, setSending] = useState(false);
  const [result, setResult]   = useState('');
  const [history, setHistory] = useState([]);
  const [histLoading, setHistLoading] = useState(false);
  const [seenIds, setSeenIds] = useState(getSeenIds);
  const pollRef = useRef(null);

  const loadHistory = async (silent = false) => {
    if (!silent) setHistLoading(true);
    try {
      const r = await fetch('/api/user/my-messages', { credentials: 'include' });
      if (r.ok) setHistory(await r.json());
    } catch {}
    if (!silent) setHistLoading(false);
  };

  const openModal = () => {
    setOpen(true);
    setResult('');
    loadHistory();
  };

  const close = () => {
    setOpen(false);
    setResult('');
    if (pollRef.current) clearInterval(pollRef.current);
  };

  // Charge l'historique au montage et le rafraîchit en arrière-plan toutes les
  // 30 s — comme ça, le badge "réponse non-lue" devient visible AVANT même
  // d'ouvrir la modale.
  useEffect(() => {
    loadHistory(true);
    const bgPoll = setInterval(() => loadHistory(true), 30000);
    return () => clearInterval(bgPoll);
  }, []);

  // Quand la modale est ouverte, on accélère le polling à 10 s
  useEffect(() => {
    if (open) {
      pollRef.current = setInterval(() => loadHistory(true), 10000);
    } else {
      if (pollRef.current) clearInterval(pollRef.current);
    }
    return () => { if (pollRef.current) clearInterval(pollRef.current); };
  }, [open]);

  const repliedMessages = history.filter(m => m.admin_reply);
  const repliedIds = new Set(repliedMessages.map(m => String(m.id)));
  const unreadCount = repliedMessages.filter(m => !seenIds.has(String(m.id))).length;

  const handleOpenHistorique = () => {
    setTab('historique');
    const newSeen = new Set([...seenIds, ...repliedIds]);
    setSeenIds(newSeen);
    markSeen(newSeen);
  };

  const send = async () => {
    if (!text.trim()) return;
    setSending(true); setResult('');
    try {
      const r = await fetch('/api/user/message-admin', {
        method: 'POST', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: text.trim() }),
      });
      if (r.ok) {
        setResult('✅ Message envoyé à l\'administrateur.');
        setText('');
        await loadHistory();
        setTimeout(() => { setTab('historique'); setResult(''); }, 1200);
      } else {
        const d = await r.json();
        setResult(`❌ ${d.error || 'Erreur'}`);
      }
    } catch { setResult('❌ Erreur réseau'); }
    setSending(false);
  };

  if (!open) {
    return trigger ? trigger(openModal, unreadCount) : (
      <button onClick={openModal} className="btn btn-ghost btn-sm" style={{ display: 'flex', alignItems: 'center', gap: 5, position: 'relative' }}>
        ✉️ <span>Écrire à l'admin</span>
        {unreadCount > 0 && (
          <span style={{
            position: 'absolute', top: -5, right: -5,
            background: '#ef4444', color: '#fff',
            borderRadius: '50%', fontSize: 10, fontWeight: 800,
            width: 17, height: 17, display: 'flex', alignItems: 'center', justifyContent: 'center',
            boxShadow: '0 0 6px rgba(239,68,68,0.7)',
          }}>{unreadCount}</span>
        )}
      </button>
    );
  }

  return (
    <div
      onClick={e => { if (e.target === e.currentTarget) close(); }}
      style={{
        position: 'fixed', inset: 0, zIndex: 10000,
        background: 'rgba(0,0,0,0.6)', backdropFilter: 'blur(4px)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        padding: 20,
      }}
    >
      <div style={{
        background: '#0f172a',
        border: '1px solid rgba(99,102,241,0.4)',
        borderRadius: 16,
        padding: '0',
        width: '100%', maxWidth: 440,
        boxShadow: '0 20px 60px rgba(0,0,0,0.6)',
        overflow: 'hidden',
      }}>
        {/* Header */}
        <div style={{ padding: '18px 20px 0', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div>
            <div style={{ fontSize: 15, fontWeight: 800, color: '#e2e8f0' }}>✉️ Contact administrateur</div>
            <div style={{ fontSize: 11, color: '#64748b', marginTop: 2 }}>Envoyez un message ou consultez vos échanges.</div>
          </div>
          <button onClick={close} style={{ background: 'none', border: 'none', color: '#475569', fontSize: 18, cursor: 'pointer', lineHeight: 1 }}>✕</button>
        </div>

        {/* Tabs */}
        <div style={{ display: 'flex', margin: '14px 20px 0', gap: 6 }}>
          {[
            { id: 'compose',    label: '✏️ Nouveau message', onClick: () => setTab('compose') },
            { id: 'historique', label: `📬 Historique${history.length > 0 ? ` (${history.length})` : ''}`, onClick: handleOpenHistorique },
          ].map(t => (
            <button key={t.id} onClick={t.onClick} style={{
              flex: 1, padding: '7px 10px', borderRadius: 9, fontSize: 12, fontWeight: tab === t.id ? 700 : 500, cursor: 'pointer',
              background: tab === t.id ? 'rgba(99,102,241,0.2)' : 'rgba(255,255,255,0.04)',
              border: tab === t.id ? '1px solid rgba(99,102,241,0.5)' : '1px solid rgba(255,255,255,0.07)',
              color: tab === t.id ? '#a5b4fc' : '#64748b',
              transition: 'all 0.15s',
              position: 'relative',
            }}>
              {t.label}
              {t.id === 'historique' && unreadCount > 0 && (
                <span style={{
                  marginLeft: 5,
                  background: '#ef4444', color: '#fff',
                  borderRadius: 999, fontSize: 10, fontWeight: 800,
                  padding: '1px 6px',
                  display: 'inline-block',
                  verticalAlign: 'middle',
                  boxShadow: '0 0 5px rgba(239,68,68,0.6)',
                }}>{unreadCount} nouveau{unreadCount > 1 ? 'x' : ''}</span>
              )}
            </button>
          ))}
        </div>

        <div style={{ padding: '16px 20px 20px' }}>

          {/* ── TAB: Composer ── */}
          {tab === 'compose' && (<>
            <textarea
              rows={5} maxLength={800}
              value={text}
              onChange={e => setText(e.target.value)}
              placeholder="Écrivez votre message ici…"
              style={{
                width: '100%', boxSizing: 'border-box',
                background: 'rgba(255,255,255,0.04)',
                border: '1px solid rgba(99,102,241,0.3)',
                borderRadius: 10, padding: '10px 12px',
                color: '#e2e8f0', fontSize: 13, lineHeight: 1.6,
                resize: 'vertical', fontFamily: 'inherit', outline: 'none',
              }}
            />
            <div style={{ fontSize: 10, color: '#475569', textAlign: 'right', marginTop: 2 }}>{text.length}/800</div>
            <div style={{ display: 'flex', gap: 10, marginTop: 14 }}>
              <button
                onClick={send}
                disabled={sending || !text.trim()}
                style={{
                  flex: 1,
                  background: 'linear-gradient(135deg,#4338ca,#6366f1)',
                  border: 'none', borderRadius: 10,
                  color: '#fff', fontWeight: 700, fontSize: 13,
                  padding: '10px 0', cursor: 'pointer',
                  opacity: (sending || !text.trim()) ? 0.5 : 1,
                }}
              >{sending ? '⏳ Envoi…' : '📨 Envoyer'}</button>
              <button onClick={close} style={{
                background: 'rgba(100,116,139,0.1)', border: '1px solid rgba(100,116,139,0.25)',
                borderRadius: 10, color: '#64748b', fontWeight: 600, fontSize: 12,
                padding: '10px 16px', cursor: 'pointer',
              }}>Annuler</button>
            </div>
            {result && (
              <div style={{ marginTop: 10, fontSize: 12, fontWeight: 600, color: result.startsWith('✅') ? '#22c55e' : '#f87171', textAlign: 'center' }}>
                {result}
              </div>
            )}
          </>)}

          {/* ── TAB: Historique ── */}
          {tab === 'historique' && (<>
            {histLoading ? (
              <div style={{ textAlign: 'center', color: '#475569', padding: '20px 0', fontSize: 13 }}>⏳ Chargement…</div>
            ) : history.length === 0 ? (
              <div style={{ textAlign: 'center', color: '#475569', padding: '20px 0', fontSize: 13 }}>
                Aucun message envoyé pour l'instant.
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10, maxHeight: 340, overflowY: 'auto' }}>
                {history.map(msg => (
                  <div key={msg.id} style={{
                    borderRadius: 10, overflow: 'hidden',
                    border: `1px solid ${msg.admin_reply ? 'rgba(99,102,241,0.4)' : 'rgba(99,102,241,0.2)'}`,
                    background: 'rgba(255,255,255,0.02)',
                  }}>
                    {/* User message */}
                    <div style={{ padding: '10px 14px' }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 5 }}>
                        <span style={{ fontSize: 11, fontWeight: 700, color: '#94a3b8' }}>👤 Votre message</span>
                        <span style={{ fontSize: 10, color: '#475569' }}>
                          {new Date(msg.date).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' })}{' '}
                          {new Date(msg.date).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}
                        </span>
                      </div>
                      <div style={{ fontSize: 12, color: '#cbd5e1', lineHeight: 1.6, whiteSpace: 'pre-wrap' }}>{msg.text}</div>
                    </div>

                    {/* Admin reply */}
                    {msg.admin_reply ? (
                      <div style={{ padding: '10px 14px', background: 'rgba(99,102,241,0.1)', borderTop: '1px solid rgba(99,102,241,0.25)' }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 5 }}>
                          <span style={{ fontSize: 11, fontWeight: 700, color: '#818cf8' }}>↩️ Réponse admin</span>
                          <span style={{ fontSize: 10, color: '#475569' }}>
                            {new Date(msg.admin_reply.date).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' })}{' '}
                            {new Date(msg.admin_reply.date).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}
                          </span>
                        </div>
                        <div style={{ fontSize: 12, color: '#c7d2fe', lineHeight: 1.6, whiteSpace: 'pre-wrap' }}>{msg.admin_reply.text}</div>
                      </div>
                    ) : (
                      <div style={{ padding: '8px 14px', background: 'rgba(255,255,255,0.01)', borderTop: '1px solid rgba(255,255,255,0.05)' }}>
                        <span style={{ fontSize: 11, color: '#475569', fontStyle: 'italic' }}>⏳ En attente de réponse…</span>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
            <button onClick={() => loadHistory()} style={{
              marginTop: 12, width: '100%', padding: '8px', borderRadius: 8, fontSize: 12,
              background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)',
              color: '#64748b', cursor: 'pointer',
            }}>🔄 Actualiser</button>
          </>)}

        </div>
      </div>
    </div>
  );
}
