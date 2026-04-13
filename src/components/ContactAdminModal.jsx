import { useState } from 'react';

export default function ContactAdminModal({ trigger }) {
  const [open, setOpen]       = useState(false);
  const [text, setText]       = useState('');
  const [sending, setSending] = useState(false);
  const [result, setResult]   = useState('');

  const openModal = () => { setOpen(true); setResult(''); };
  const close     = () => { setOpen(false); setResult(''); };

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
        setTimeout(close, 2000);
      } else {
        const d = await r.json();
        setResult(`❌ ${d.error || 'Erreur'}`);
      }
    } catch { setResult('❌ Erreur réseau'); }
    setSending(false);
  };

  return (
    <>
      {trigger ? trigger(openModal) : (
        <button
          onClick={openModal}
          className="btn btn-ghost btn-sm"
          style={{ display: 'flex', alignItems: 'center', gap: 5 }}
        >
          ✉️ <span>Écrire à l'admin</span>
        </button>
      )}

      {open && (
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
            padding: '24px 22px',
            width: '100%', maxWidth: 420,
            boxShadow: '0 20px 60px rgba(0,0,0,0.6)',
          }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
              <div>
                <div style={{ fontSize: 15, fontWeight: 800, color: '#e2e8f0' }}>✉️ Message à l'administrateur</div>
                <div style={{ fontSize: 11, color: '#64748b', marginTop: 2 }}>Votre message sera lu par l'admin dès que possible.</div>
              </div>
              <button onClick={close} style={{ background: 'none', border: 'none', color: '#475569', fontSize: 18, cursor: 'pointer', lineHeight: 1 }}>✕</button>
            </div>

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
              >
                {sending ? '⏳ Envoi…' : '📨 Envoyer'}
              </button>
              <button
                onClick={close}
                style={{
                  background: 'rgba(100,116,139,0.1)', border: '1px solid rgba(100,116,139,0.25)',
                  borderRadius: 10, color: '#64748b', fontWeight: 600, fontSize: 12,
                  padding: '10px 16px', cursor: 'pointer',
                }}
              >Annuler</button>
            </div>

            {result && (
              <div style={{ marginTop: 10, fontSize: 12, fontWeight: 600, color: result.startsWith('✅') ? '#22c55e' : '#f87171', textAlign: 'center' }}>
                {result}
              </div>
            )}
          </div>
        </div>
      )}
    </>
  );
}
