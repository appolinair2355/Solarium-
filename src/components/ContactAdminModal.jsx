import { useState, useEffect } from 'react';

export default function ContactAdminModal({ trigger }) {
  const [open, setOpen]       = useState(false);
  const [tab, setTab]         = useState('compose');
  const [text, setText]       = useState('');
  const [sending, setSending] = useState(false);
  const [result, setResult]   = useState('');
  const [history, setHistory] = useState([]);
  const [histLoading, setHistLoading] = useState(false);

  const openModal = () => { setOpen(true); setResult(''); loadHistory(); };
  const close     = () => { setOpen(false); setResult(''); };

  const loadHistory = async () => {
    setHistLoading(true);
    try {
      const r = await fetch('/api/user/my-messages', { credentials: 'include' });
      if (r.ok) setHistory(await r.json());
    } catch {}
    setHistLoading(false);
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

  const unreadReplies = history.filter(m => m.admin_reply && !m._replyRead).length;

  if (!open) {
    return trigger ? trigger(openModal) : (
      <button onClick={openModal} className="btn btn-ghost btn-sm" style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
        ✉️ <span>Écrire à l'admin</span>
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
            { id: 'compose',    label: '✏️ Nouveau message' },
            { id: 'historique', label: `📬 Historique${history.length > 0 ? ` (${history.length})` : ''}` },
          ].map(t => (
            <button key={t.id} onClick={() => setTab(t.id)} style={{
              flex: 1, padding: '7px 10px', borderRadius: 9, fontSize: 12, fontWeight: tab === t.id ? 700 : 500, cursor: 'pointer',
              background: tab === t.id ? 'rgba(99,102,241,0.2)' : 'rgba(255,255,255,0.04)',
              border: tab === t.id ? '1px solid rgba(99,102,241,0.5)' : '1px solid rgba(255,255,255,0.07)',
              color: tab === t.id ? '#a5b4fc' : '#64748b',
              transition: 'all 0.15s',
            }}>{t.label}</button>
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
                    border: '1px solid rgba(99,102,241,0.2)',
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
                      <div style={{ padding: '10px 14px', background: 'rgba(99,102,241,0.08)', borderTop: '1px solid rgba(99,102,241,0.18)' }}>
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
            <button onClick={loadHistory} style={{
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
