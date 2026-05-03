import { useState, useRef, useEffect } from 'react';
import { useLanguage } from '../context/LanguageContext';

export default function LanguageSwitcher({ compact = false }) {
  const { lang, setLang, langInfo, languages, t } = useLanguage();
  const [open, setOpen] = useState(false);
  const ref = useRef(null);

  useEffect(() => {
    const handler = (e) => {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  return (
    <div className="lang-switcher" ref={ref} style={{ position: 'relative', display: 'inline-block' }}>
      <button
        className="lang-switcher-btn"
        onClick={() => setOpen(o => !o)}
        title={t('lang.choose')}
        aria-haspopup="listbox"
        aria-expanded={open}
      >
        <span className="lang-flag">{langInfo.flag}</span>
        {!compact && <span className="lang-label">{langInfo.label}</span>}
        <span className="lang-arrow" style={{ transition: 'transform .2s', display: 'inline-block', transform: open ? 'rotate(180deg)' : 'rotate(0deg)' }}>▾</span>
      </button>

      {open && (
        <div className="lang-dropdown" role="listbox" aria-label={t('lang.choose')}>
          <div className="lang-dropdown-header">{t('lang.choose')}</div>
          {languages.map(l => (
            <button
              key={l.code}
              className={`lang-option${l.code === lang ? ' lang-option--active' : ''}`}
              role="option"
              aria-selected={l.code === lang}
              onClick={() => { setLang(l.code); setOpen(false); }}
            >
              <span className="lang-option-flag">{l.flag}</span>
              <span className="lang-option-label">{l.label}</span>
              {l.code === lang && <span className="lang-option-check">✓</span>}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
