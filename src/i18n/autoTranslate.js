/**
 * autoTranslate.js — Service de traduction automatique via MyMemory API (gratuit, sans clé)
 * - Cache localStorage persistant
 * - Déduplique les requêtes en vol
 * - Retourne le texte français en attendant la réponse
 */

const LS_PREFIX = 'bpat_v3_';
const _inflight = new Map();

export function hashText(str) {
  if (!str) return '0';
  let h = 5381;
  const len = Math.min(str.length, 300);
  for (let i = 0; i < len; i++) h = ((h << 5) + h) ^ str.charCodeAt(i);
  return (h >>> 0).toString(36);
}

function lsKey(text, lang) {
  return `${LS_PREFIX}${lang}_${hashText(text)}`;
}

export function getCached(text, lang) {
  if (!text || lang === 'fr') return text;
  try { return localStorage.getItem(lsKey(text, lang)) || null; } catch { return null; }
}

function setCached(text, lang, val) {
  try { localStorage.setItem(lsKey(text, lang), val); } catch {}
}

export async function fetchTranslation(text, lang) {
  if (!text || lang === 'fr') return text;
  const cached = getCached(text, lang);
  if (cached) return cached;

  const key = `${lang}|${hashText(text)}`;
  if (_inflight.has(key)) return _inflight.get(key);

  const p = (async () => {
    try {
      const url = `https://api.mymemory.translated.net/get?q=${encodeURIComponent(text)}&langpair=fr|${lang}`;
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 9000);
      const r = await fetch(url, { signal: ctrl.signal });
      clearTimeout(timer);
      if (!r.ok) return text;
      const d = await r.json();
      const result = d?.responseData?.translatedText;
      if (result && d?.responseStatus === 200) {
        setCached(text, lang, result);
        return result;
      }
      return text;
    } catch {
      return text;
    } finally {
      _inflight.delete(key);
    }
  })();

  _inflight.set(key, p);
  return p;
}
