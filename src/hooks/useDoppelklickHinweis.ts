import { useState, useRef, useEffect, useCallback } from "react";

// Zeigt einen kurzen Hinweis-Toast, wenn derselbe (nicht editierbare) Punkt 2x innert 2 Sekunden angeklickt wird.
export function useDoppelklickHinweis() {
  const [hinweis, setHinweis] = useState<{ x: number; y: number } | null>(null);
  const letzterKlick = useRef<{ key: string; zeit: number } | null>(null);

  useEffect(() => {
    if (!hinweis) return;
    const t = setTimeout(() => setHinweis(null), 2000);
    return () => clearTimeout(t);
  }, [hinweis]);

  const melden = useCallback((key: string, x: number, y: number) => {
    const jetzt = Date.now();
    if (letzterKlick.current && letzterKlick.current.key === key && jetzt - letzterKlick.current.zeit <= 2000) {
      setHinweis({ x, y });
      letzterKlick.current = null;
    } else {
      letzterKlick.current = { key, zeit: jetzt };
    }
  }, []);

  return { hinweis, melden };
}
