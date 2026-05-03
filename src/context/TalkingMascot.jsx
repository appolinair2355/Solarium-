import { useEffect, useRef, useState } from 'react';

/**
 * TalkingMascot — animated character that "speaks" via Web Speech API
 * and shows the words in a typewriter speech bubble.
 *
 * Props:
 *   lines        : string[]        — phrases dites les unes après les autres
 *   onDone       : () => void      — appelé quand toutes les phrases sont finies
 *   primaryColor : string          — couleur dominante du badge / bulle
 *   character    : '🧑‍💼'|'😊'|'🎩' etc — emoji du mascotte (par défaut un homme souriant)
 *   skipLabel    : string          — texte du bouton de skip
 */
export default function TalkingMascot({
  lines = [],
  onDone,
  primaryColor = '#fbbf24',
  character = '🧑‍💼',
  skipLabel = 'Passer ▶',
  imageSrc = null,
}) {
  const [lineIdx, setLineIdx] = useState(0);
  const [shown, setShown]     = useState('');
  const [speaking, setSpeaking] = useState(false);
  const cancelled = useRef(false);
  const utterRef = useRef(null);

  // Cancel TTS on unmount
  useEffect(() => () => {
    cancelled.current = true;
    try { window.speechSynthesis?.cancel(); } catch {}
  }, []);

  // Type out + speak the current line
  useEffect(() => {
    if (cancelled.current) return;
    if (lineIdx >= lines.length) {
      onDone && onDone();
      return;
    }
    const text = lines[lineIdx];
    setShown('');
    setSpeaking(true);

    // Typewriter
    let i = 0;
    const typeTimer = setInterval(() => {
      if (cancelled.current) { clearInterval(typeTimer); return; }
      i++;
      setShown(text.slice(0, i));
      if (i >= text.length) clearInterval(typeTimer);
    }, 38);

    // Text-to-speech (FR)
    let useTts = false;
    try {
      if (typeof window !== 'undefined' && window.speechSynthesis) {
        useTts = true;
        const synth = window.speechSynthesis;
        synth.cancel();
        const utter = new SpeechSynthesisUtterance(text);
        utter.lang = 'fr-FR';
        utter.rate = 0.96;
        utter.pitch = 1.05;
        // Try to pick a French voice if available
        const pickVoice = () => {
          const voices = synth.getVoices();
          const fr = voices.find(v => /fr[-_]FR/i.test(v.lang)) || voices.find(v => /^fr/i.test(v.lang));
          if (fr) utter.voice = fr;
          synth.speak(utter);
        };
        if (synth.getVoices().length === 0) {
          // Voices may load async on some browsers
          synth.onvoiceschanged = () => { synth.onvoiceschanged = null; pickVoice(); };
          // Fallback if event never fires
          setTimeout(() => { if (!utterRef.current) pickVoice(); }, 250);
        } else {
          pickVoice();
        }
        utterRef.current = utter;
        utter.onend = () => {
          if (cancelled.current) return;
          setSpeaking(false);
          setTimeout(() => setLineIdx(n => n + 1), 350);
        };
        utter.onerror = () => {
          if (cancelled.current) return;
          // Fallback to timed advance
          setTimeout(() => setLineIdx(n => n + 1), Math.max(1800, text.length * 55));
        };
      }
    } catch { useTts = false; }

    // Fallback: advance by reading time if no TTS
    let fallbackTimer = null;
    if (!useTts) {
      fallbackTimer = setTimeout(() => {
        if (cancelled.current) return;
        setSpeaking(false);
        setLineIdx(n => n + 1);
      }, Math.max(2200, text.length * 55));
    }

    return () => {
      clearInterval(typeTimer);
      if (fallbackTimer) clearTimeout(fallbackTimer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lineIdx]);

  const skip = () => {
    cancelled.current = true;
    try { window.speechSynthesis?.cancel(); } catch {}
    onDone && onDone();
  };

  return (
    <div className="mascot-wrap" style={{ '--mascot-color': primaryColor }}>
      <div className={`mascot-character ${speaking ? 'speaking' : ''}`}>
        <div className="mascot-glow" />
        {imageSrc ? (
          <img src={imageSrc} alt="mascot" className="mascot-photo" />
        ) : (
          <div className="mascot-face">{character}</div>
        )}
        <div className="mascot-mouth-dots">
          <span /><span /><span />
        </div>
      </div>

      <div className="mascot-bubble">
        <div className="mascot-bubble-text">
          {shown}
          <span className="mascot-caret">|</span>
        </div>
        <div className="mascot-progress">
          {lines.map((_, i) => (
            <span key={i} className={i <= lineIdx ? 'on' : ''} />
          ))}
        </div>
      </div>

      <button type="button" className="mascot-skip" onClick={skip}>{skipLabel}</button>
    </div>
  );
}
