import { useState } from 'react';

/**
 * PasswordInput — champ mot de passe avec icône cadenas + bouton œil pour
 * afficher/masquer ce qui est tapé. Compatible avec les classes existantes
 * `form-input has-icon` / `input-icon` du thème.
 *
 * Props standards d'un <input> + `iconLeft` (default "🔒") et `showStrength`.
 */
export default function PasswordInput({
  value,
  onChange,
  placeholder = '••••••••',
  iconLeft = '🔒',
  showStrength = false,
  required = true,
  autoFocus = false,
  name,
  id,
}) {
  const [visible, setVisible] = useState(false);

  // very lightweight strength score 0..4
  const score = (() => {
    if (!value) return 0;
    let s = 0;
    if (value.length >= 6) s++;
    if (value.length >= 10) s++;
    if (/[A-Z]/.test(value) && /[a-z]/.test(value)) s++;
    if (/\d/.test(value) && /[^A-Za-z0-9]/.test(value)) s++;
    return s;
  })();

  const labels = ['Trop court', 'Faible', 'Moyen', 'Bon', 'Fort'];
  const colors = ['#64748b', '#ef4444', '#f59e0b', '#3b82f6', '#22c55e'];

  return (
    <div>
      <div className="input-wrap">
        <span className="input-icon">{iconLeft}</span>
        <input
          id={id}
          name={name}
          className="form-input has-icon"
          style={{ paddingRight: 44 }}
          type={visible ? 'text' : 'password'}
          placeholder={placeholder}
          value={value}
          onChange={onChange}
          required={required}
          autoFocus={autoFocus}
          autoComplete={visible ? 'off' : 'current-password'}
        />
        <button
          type="button"
          aria-label={visible ? 'Masquer le mot de passe' : 'Afficher le mot de passe'}
          onClick={() => setVisible(v => !v)}
          style={{
            position: 'absolute', right: 8, top: '50%', transform: 'translateY(-50%)',
            background: 'transparent', border: 'none', cursor: 'pointer',
            fontSize: 18, padding: '6px 8px', lineHeight: 1, color: '#94a3b8',
          }}
          tabIndex={-1}
        >
          {visible ? '🙈' : '👁️'}
        </button>
      </div>

      {showStrength && value && (
        <div style={{ marginTop: 8 }}>
          <div style={{ display: 'flex', gap: 4, marginBottom: 4 }}>
            {[0,1,2,3].map(i => (
              <div key={i} style={{
                flex: 1, height: 4, borderRadius: 2,
                background: i < score ? colors[score] : 'rgba(148,163,184,0.18)',
                transition: 'background 0.25s',
              }} />
            ))}
          </div>
          <div style={{ fontSize: 11, color: colors[score], fontWeight: 600 }}>
            {labels[score]}
          </div>
        </div>
      )}
    </div>
  );
}
