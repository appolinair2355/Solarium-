import { useState, useEffect, useRef } from 'react';

const SEEN_KEY = 'seen_admin_replies';

function getSeenIds() {
  try { return new Set(JSON.parse(localStorage.getItem(SEEN_KEY) || '[]')); }
  catch { return new Set(); }
}
function markSeen(ids) {
  try { localStorage.setItem(SEEN_KEY, JSON.stringify([...ids])); } catch {}
}

function fmtDate(d) {
  try {
    return new Date(d).toLocaleDateString('fr-FR', {
      day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit',
    });
  } catch { return ''; }
}

export default function ContactAdminModal({ trigger }) {
  const [open, setOpen]           = useState(false);
  const [tab, setTab]             = useState('historique');
  const [text, setText]           = useState('');
  const [replyContext, setReplyContext] = useState('');
  const [sending, setSending]     = useState(false);
  const [result, setResult]       = useState('');
  const [history, setHistory]     = useState([]);
  const [histLoading, setHistLoading] = useState(false);
  const [seenIds, setSeenIds]     = useState(getSeenIds);
  const pollRef  = useRef(null);
  const textRef  = useRef(null);

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
    setReplyContext('');
    if (pollRef.current) clearInterval(pollRef.current);
  };

  useEffect(() => {
    loadHistory(true);
    const bg = setInterval(() => loadHistory(true), 30000);
    return () => clearInterval(bg);
  }, []);

  useEffect(() => {
    if (open) {
      pollRef.current = setInterval(() => loadHistory(true), 10000);
    } else {
      if (pollRef.current) clearInterval(pollRef.current);
    }
    return () => { if (pollRef.current) clearInterval(pollRef.current); };
  }, [open]);

  // Compter les non-lus : réponses admin + messages système non vus
  const repliedMessages  = history.filter(m => m.admin_reply || m.from_system);
  const repliedIds       = new Set(repliedMessages.map(m => String(m.id)));
  const unreadCount      = repliedMessages.filter(m => !seenIds.has(String(m.id))).length;

  const handleOpenHistorique = () => {
    setTab('historique');
    const newSeen = new Set([...seenIds, ...repliedIds]);
    setSeenIds(newSeen);
    markSeen(newSeen);
  };

  // Répondre à un message admin — pré-remplit la zone de saisie avec la citation
  const handleReply = (msg) => {
    const quote = msg.admin_reply?.text || msg.text || '';
    const shortQuote = quote.length > 80 ? quote.slice(0, 80) + '…' : quote;
    const context = `[En réponse à l'admin : "${shortQuote}"]\n\n`;
    setReplyContext(context);
    setText(context);
    setTab('compose');
    setTimeout(() => {
      if (textRef.current) {
        textRef.current.focus();
        textRef.current.setSelectionRange(context.length, context.length);
      }
    }, 80);
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
        setReplyContext('');
        await loadHistory();
        setTimeout(() => { handleOpenHistorique(); setResult(''); }, 1200);
      } else {
        const d = await r.json();
        setResult(`❌ ${d.error || 'Erreur'}`);
      }
    } catch { setResult('❌ Erreur réseau'); }
    setSending(false);
  };

  if (!open) {
    return trigger ? trigger(openModal, unreadCount) : (
      <button onClick={openModal} className="btn btn-ghost btn-sm"
        style={{ display: 'flex', alignItems: 'center', gap: 5, position: 'relative' }}>
        ✉️ <span>Messages</span>
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
        background: 'rgba(0,0,0,0.65)', backdropFilter: 'blur(5px)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        padding: 20,
      }}
    >
      <div style={{
        background: '#0f172a',
        border: '1px solid rgba(99,102,241,0.4)',
        borderRadius: 18,
        width: '100%', maxWidth: 480,
        boxShadow: '0 24px 70px rgba(0,0,0,0.7)',
        overflow: 'hidden',
        display: 'flex', flexDirection: 'column', maxHeight: '90vh',
      }}>
        {/* ── Header ── */}
        <div style={{ padding: '18px 20px 14px', borderBottom: '1px solid rgba(255,255,255,0.06)', flexShrink: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <div>
              <div style={{ fontSize: 15, fontWeight: 800, color: '#e2e8f0' }}>✉️ Mes messages</div>
              <div style={{ fontSize: 11, color: '#64748b', marginTop: 2 }}>
                Notifications, échanges avec l'administration
              </div>
            </div>
            <button onClick={close}
              style={{ background: 'none', border: 'none', color: '#475569', fontSize: 20, cursor: 'pointer', lineHeight: 1 }}>
              ✕
            </button>
          </div>

          {/* Tabs */}
          <div style={{ display: 'flex', marginTop: 14, gap: 6 }}>
            {[
              { id: 'historique', label: `📬 Boîte de réception${history.length > 0 ? ` (${history.length})` : ''}`, action: handleOpenHistorique },
              { id: 'compose',    label: '✏️ Nouveau message', action: () => setTab('compose') },
            ].map(t => (
              <button key={t.id} onClick={t.action} style={{
                flex: 1, padding: '7px 10px', borderRadius: 9, fontSize: 12,
                fontWeight: tab === t.id ? 700 : 500, cursor: 'pointer',
                background: tab === t.id ? 'rgba(99,102,241,0.2)' : 'rgba(255,255,255,0.04)',
                border: tab === t.id ? '1px solid rgba(99,102,241,0.5)' : '1px solid rgba(255,255,255,0.07)',
                color: tab === t.id ? '#a5b4fc' : '#64748b',
                transition: 'all 0.15s', position: 'relative',
              }}>
                {t.label}
                {t.id === 'historique' && unreadCount > 0 && (
                  <span style={{
                    marginLeft: 5,
                    background: '#ef4444', color: '#fff',
                    borderRadius: 999, fontSize: 10, fontWeight: 800,
                    padding: '1px 6px', display: 'inline-block', verticalAlign: 'middle',
                    boxShadow: '0 0 5px rgba(239,68,68,0.6)',
                  }}>{unreadCount}</span>
                )}
              </button>
            ))}
          </div>
        </div>

        {/* ── Body ── */}
        <div style={{ padding: '16px 20px 20px', overflowY: 'auto', flex: 1 }}>

          {/* ── TAB: Historique / Boîte de réception ── */}
          {tab === 'historique' && (<>
            {histLoading ? (
              <div style={{ textAlign: 'center', color: '#475569', padding: '30px 0', fontSize: 13 }}>⏳ Chargement…</div>
            ) : history.length === 0 ? (
              <div style={{ textAlign: 'center', color: '#475569', padding: '30px 0', fontSize: 13 }}>
                <div style={{ fontSize: 32, marginBottom: 8 }}>📭</div>
                Aucun message pour l'instant.
                <div style={{ marginTop: 12 }}>
                  <button onClick={() => setTab('compose')} style={{
                    background: 'rgba(99,102,241,0.15)', border: '1px solid rgba(99,102,241,0.3)',
                    borderRadius: 8, padding: '7px 16px', color: '#a5b4fc', fontSize: 12,
                    fontWeight: 700, cursor: 'pointer',
                  }}>✏️ Écrire un message</button>
                </div>
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                {history.map(msg => {
                  const isSystem = msg.from_system || msg.type === 'system';
                  const isNew = !seenIds.has(String(msg.id));

                  if (isSystem) {
                    // ── Message système (notification bonus parrain, etc.) ──
                    return (
                      <div key={msg.id} style={{
                        borderRadius: 12, overflow: 'hidden',
                        border: '1.5px solid rgba(251,191,36,0.4)',
                        background: 'linear-gradient(135deg, rgba(251,191,36,0.08), rgba(245,158,11,0.04))',
                        position: 'relative',
                      }}>
                        {isNew && (
                          <span style={{
                            position: 'absolute', top: 10, right: 12,
                            background: '#f0b429', color: '#000', borderRadius: 999,
                            fontSize: 9, fontWeight: 900, padding: '2px 7px',
                          }}>NOUVEAU</span>
                        )}
                        <div style={{ padding: '12px 14px' }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 8 }}>
                            <span style={{ fontSize: 16 }}>🔔</span>
                            <span style={{ fontSize: 11, fontWeight: 800, color: '#f0b429', letterSpacing: 0.5 }}>
                              NOTIFICATION SYSTÈME
                            </span>
                            <span style={{ marginLeft: 'auto', fontSize: 10, color: '#64748b' }}>
                              {fmtDate(msg.date)}
                            </span>
                          </div>
                          <div style={{
                            fontSize: 12.5, color: '#fcd34d', lineHeight: 1.75,
                            whiteSpace: 'pre-wrap', fontFamily: 'inherit',
                          }}>
                            {msg.text}
                          </div>
                        </div>
                      </div>
                    );
                  }

                  // ── Message utilisateur ↔ admin ──
                  return (
                    <div key={msg.id} style={{
                      borderRadius: 12, overflow: 'hidden',
                      border: `1px solid ${msg.admin_reply ? 'rgba(99,102,241,0.4)' : 'rgba(99,102,241,0.15)'}`,
                      background: 'rgba(255,255,255,0.02)',
                      position: 'relative',
                    }}>
                      {/* Message utilisateur */}
                      <div style={{ padding: '10px 14px' }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 5 }}>
                          <span style={{ fontSize: 11, fontWeight: 700, color: '#94a3b8' }}>👤 Votre message</span>
                          <span style={{ fontSize: 10, color: '#475569' }}>{fmtDate(msg.date)}</span>
                        </div>
                        <div style={{ fontSize: 12, color: '#cbd5e1', lineHeight: 1.6, whiteSpace: 'pre-wrap' }}>
                          {msg.text}
                        </div>
                      </div>

                      {/* Réponse admin */}
                      {msg.admin_reply ? (
                        <div style={{ padding: '10px 14px', background: 'rgba(99,102,241,0.1)', borderTop: '1px solid rgba(99,102,241,0.2)' }}>
                          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 5 }}>
                            <span style={{ fontSize: 11, fontWeight: 700, color: '#818cf8' }}>↩️ Réponse de l'administrateur</span>
                            <span style={{ fontSize: 10, color: '#475569' }}>{fmtDate(msg.admin_reply.date)}</span>
                          </div>
                          <div style={{ fontSize: 12.5, color: '#c7d2fe', lineHeight: 1.65, whiteSpace: 'pre-wrap' }}>
                            {msg.admin_reply.text}
                          </div>
                          {/* Bouton Répondre */}
                          <button
                            onClick={() => handleReply(msg)}
                            style={{
                              marginTop: 10, padding: '6px 14px', borderRadius: 8,
                              background: 'rgba(99,102,241,0.18)',
                              border: '1px solid rgba(99,102,241,0.4)',
                              color: '#a5b4fc', fontSize: 11, fontWeight: 700,
                              cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 5,
                            }}
                          >
                            ↩️ Répondre
                          </button>
                          {isNew && (
                            <span style={{
                              marginLeft: 8, background: '#ef4444', color: '#fff',
                              borderRadius: 999, fontSize: 9, fontWeight: 900,
                              padding: '2px 7px', verticalAlign: 'middle',
                            }}>NOUVEAU</span>
                          )}
                        </div>
                      ) : (
                        <div style={{ padding: '8px 14px', borderTop: '1px solid rgba(255,255,255,0.04)' }}>
                          <span style={{ fontSize: 11, color: '#475569', fontStyle: 'italic' }}>⏳ En attente de réponse de l'administrateur…</span>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
            <button onClick={() => loadHistory()} style={{
              marginTop: 14, width: '100%', padding: '8px', borderRadius: 8, fontSize: 12,
              background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)',
              color: '#64748b', cursor: 'pointer',
            }}>🔄 Actualiser</button>
          </>)}

          {/* ── TAB: Composer ── */}
          {tab === 'compose' && (<>
            {replyContext && (
              <div style={{
                marginBottom: 10, padding: '8px 12px', borderRadius: 8,
                background: 'rgba(99,102,241,0.1)', border: '1px solid rgba(99,102,241,0.25)',
                fontSize: 11, color: '#94a3b8', display: 'flex', alignItems: 'center', justifyContent: 'space-between',
              }}>
                <span>↩️ Réponse en cours de rédaction…</span>
                <button onClick={() => { setReplyContext(''); setText(''); }}
                  style={{ background: 'none', border: 'none', color: '#475569', cursor: 'pointer', fontSize: 13 }}>✕</button>
              </div>
            )}
            <textarea
              ref={textRef}
              rows={6} maxLength={800}
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
            <div style={{ display: 'flex', gap: 10, marginTop: 12 }}>
              <button
                onClick={send}
                disabled={sending || !text.trim()}
                style={{
                  flex: 1,
                  background: 'linear-gradient(135deg,#4338ca,#6366f1)',
                  border: 'none', borderRadius: 10,
                  color: '#fff', fontWeight: 700, fontSize: 13,
                  padding: '11px 0', cursor: 'pointer',
                  opacity: (sending || !text.trim()) ? 0.5 : 1,
                }}
              >{sending ? '⏳ Envoi…' : '📨 Envoyer'}</button>
              <button onClick={() => { setTab('historique'); setReplyContext(''); setText(''); }} style={{
                background: 'rgba(100,116,139,0.1)', border: '1px solid rgba(100,116,139,0.25)',
                borderRadius: 10, color: '#64748b', fontWeight: 600, fontSize: 12,
                padding: '11px 16px', cursor: 'pointer',
              }}>Annuler</button>
            </div>
            {result && (
              <div style={{ marginTop: 10, fontSize: 12, fontWeight: 600, textAlign: 'center',
                color: result.startsWith('✅') ? '#22c55e' : '#f87171' }}>
                {result}
              </div>
            )}
          </>)}

        </div>
      </div>
    </div>
  );
}
