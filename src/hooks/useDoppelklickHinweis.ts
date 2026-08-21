import { useState, useRef, useEffect, useLayoutEffect, useCallback } from "react";

// Zeigt einen kurzen Hinweis-Toast, wenn derselbe (nicht editierbare) Punkt 2x innert 2 Sekunden angeklickt wird.
// Die Position wird nach dem Rendern an die tatsächliche Toast-Größe geklemmt, damit der Text nie über den
// Bildschirmrand hinausragt — egal wo geklickt wird.
export function useDoppelklickHinweis() {
  const [klick, setKlick] = useState<{ x: number; y: number } | null>(null);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);
  const hinweisRef = useRef<HTMLDivElement>(null);
  const letzterKlick = useRef<{ key: string; zeit: number } | null>(null);

  useLayoutEffect(() => {
    if (!klick) { setPos(null); return; }
    const el = hinweisRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const pad = 6;
    const left = Math.min(Math.max(klick.x - r.width / 2, pad), window.innerWidth - r.width - pad);
    const top = Math.max(klick.y - r.height - 10, pad);
    setPos({ left, top });
  }, [klick]);

  useEffect(() => {
    if (!klick) return;
    const t = setTimeout(() => setKlick(null), 2000);
    return () => clearTimeout(t);
  }, [klick]);

  const melden = useCallback((key: string, x: number, y: number) => {
    const jetzt = Date.now();
    if (letzterKlick.current && letzterKlick.current.key === key && jetzt - letzterKlick.current.zeit <= 2000) {
      setKlick({ x, y });
      letzterKlick.current = null;
    } else {
      letzterKlick.current = { key, zeit: jetzt };
    }
  }, []);

  return { sichtbar: !!klick, pos, hinweisRef, melden };
}
