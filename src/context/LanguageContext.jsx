import { createContext, useContext, useState, useEffect, useCallback, useRef } from 'react';
import { translate, LANGUAGES, DEFAULT_LANG } from '../i18n/translations';
import { getCached, fetchTranslation, hashText } from '../i18n/autoTranslate';

const LanguageContext = createContext(null);
const LS_KEY = 'bp_lang';

function detectBrowserLang() {
  const nav = navigator.language || navigator.userLanguage || 'fr';
  const code = nav.slice(0, 2).toLowerCase();
  return LANGUAGES.find(l => l.code === code)?.code || DEFAULT_LANG;
}

export function LanguageProvider({ children }) {
  const [lang, setLangState] = useState(() => {
    try {
      const saved = localStorage.getItem(LS_KEY);
      if (saved && LANGUAGES.find(l => l.code === saved)) return saved;
    } catch {}
    return detectBrowserLang();
  });

  const [transMap, setTransMap] = useState({});
  const _enqueued = useRef(new Set());

  useEffect(() => {
    setTransMap({});
    _enqueued.current.clear();
  }, [lang]);

  useEffect(() => {
    const info = LANGUAGES.find(l => l.code === lang);
    document.documentElement.lang = lang;
    document.documentElement.dir  = info?.dir || 'ltr';
  }, [lang]);

  const setLang = useCallback((code) => {
    if (!LANGUAGES.find(l => l.code === code)) return;
    try { localStorage.setItem(LS_KEY, code); } catch {}
    setLangState(code);
  }, []);

  const t = useCallback((key, vars) => translate(key, lang, vars), [lang]);

  const autoT = useCallback((frText) => {
    if (!frText || typeof frText !== 'string' || lang === 'fr') return frText;
    const key = `${lang}:${hashText(frText)}`;
    if (transMap[key]) return transMap[key];
    const ls = getCached(frText, lang);
    if (ls) {
      if (!_enqueued.current.has(key)) {
        _enqueued.current.add(key);
        setTransMap(m => ({ ...m, [key]: ls }));
      }
      return ls;
    }
    if (!_enqueued.current.has(key)) {
      _enqueued.current.add(key);
      fetchTranslation(frText, lang).then(translated => {
        setTransMap(m => ({ ...m, [key]: translated }));
      });
    }
    return frText;
  }, [lang, transMap]);

  const langInfo = LANGUAGES.find(l => l.code === lang) || LANGUAGES[0];

  return (
    <LanguageContext.Provider value={{ lang, setLang, t, autoT, langInfo, languages: LANGUAGES }}>
      {children}
    </LanguageContext.Provider>
  );
}

export function useLanguage() {
  const ctx = useContext(LanguageContext);
  if (!ctx) throw new Error('useLanguage must be used inside LanguageProvider');
  return ctx;
}
