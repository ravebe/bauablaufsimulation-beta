// Schwebend.tsx — Dropdown/Popup, das nie von einem scrollenden Bereich (overflow) abgeschnitten wird:
// per Portal an document.body gehängt, position: fixed am Auslöser (`anker`). Ist unten zu wenig Platz,
// öffnet es nach oben; seitlich und in der Höhe wird es ins Fenster geschoben (notfalls scrollbar).
// Klick-ausserhalb: `menuRef` zusätzlich an useClickOutside übergeben — das Menü liegt im DOM nicht
// mehr im Auslöser-Container.
import { useLayoutEffect, useState } from "react";
import type { CSSProperties, MouseEvent, ReactNode, RefObject } from "react";
import { createPortal } from "react-dom";

interface Props {
  anker: RefObject<HTMLElement | null>;
  menuRef: RefObject<HTMLDivElement | null>;
  /** "rechts": rechte Kante bündig mit dem Auslöser (sonst linke) */
  ausrichtung?: "links" | "rechts";
  abstand?: number;
  style?: CSSProperties;
  onClick?: (e: MouseEvent) => void;
  children: ReactNode;
}

const RAND = 6;

export default function Schwebend({ anker, menuRef, ausrichtung = "links", abstand = 2, style, onClick, children }: Props) {
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);

  useLayoutEffect(() => {
    const platzieren = () => {
      const a = anker.current?.getBoundingClientRect();
      const m = menuRef.current;
      if (!a || !m) return;
      const w = m.offsetWidth, h = m.offsetHeight;
      const vw = window.innerWidth, vh = window.innerHeight;
      let top = a.bottom + abstand;
      if (top + h > vh - RAND) {
        // oben genug Platz → nach oben öffnen, sonst so weit hoch schieben, dass es ganz sichtbar ist
        top = a.top - abstand - h >= RAND ? a.top - abstand - h : Math.max(RAND, vh - RAND - h);
      }
      let left = ausrichtung === "rechts" ? a.right - w : a.left;
      left = Math.min(Math.max(RAND, left), Math.max(RAND, vw - RAND - w));
      setPos(p => p && p.top === top && p.left === left ? p : { top, left });
    };
    platzieren();
    // Inhalt kann nachladen (z.B. Versionsliste) → Grösse ändert sich
    const ro = new ResizeObserver(platzieren);
    if (menuRef.current) ro.observe(menuRef.current);
    window.addEventListener("resize", platzieren);
    window.addEventListener("scroll", platzieren, true);
    return () => { ro.disconnect(); window.removeEventListener("resize", platzieren); window.removeEventListener("scroll", platzieren, true); };
  }, [anker, menuRef, ausrichtung, abstand]);

  return createPortal(
    <div ref={menuRef} onClick={onClick}
      style={{
        ...style, position: "fixed", zIndex: 1000, top: pos?.top ?? 0, left: pos?.left ?? 0,
        maxHeight: `calc(100vh - ${2 * RAND}px)`, overflowY: "auto", boxSizing: "border-box",
        visibility: pos ? undefined : "hidden",
      }}>
      {children}
    </div>,
    document.body,
  );
}
