// Schwebend.tsx — Dropdown/Popup, das nie von einem scrollenden Bereich (overflow) abgeschnitten wird:
// per Portal an document.body gehängt, position: fixed am Auslöser. Ist unten zu wenig Platz, öffnet es
// nach oben; seitlich und in der Höhe wird es ins Fenster geschoben (notfalls scrollbar).
// Auslöser: `anker`, sonst das Element, in dem <Schwebend> steht (wie früher top: 100% im
// position: relative-Container).
// Klick-ausserhalb: mousedown im Menü wird nicht an document weitergereicht — die bestehenden
// "Klick ausserhalb"-Handler (ref.contains(...)) schliessen das Menü daher nicht, obwohl es im DOM nicht
// mehr im Container liegt.
import { useLayoutEffect, useRef, useState } from "react";
import type { CSSProperties, MouseEvent, ReactNode, RefObject } from "react";
import { createPortal } from "react-dom";

interface Props {
  anker?: RefObject<HTMLElement | null>;
  menuRef?: RefObject<HTMLDivElement | null>;
  /** "rechts": rechte Kante bündig mit dem Auslöser (sonst linke) */
  ausrichtung?: "links" | "rechts";
  abstand?: number;
  /** seitlicher Versatz ab der linken Kante des Auslösers (wie früher left: N) */
  versatzX?: number;
  /** so breit wie der Auslöser (abzüglich versatzX) — wie früher left + right: 0 */
  breiteWieAnker?: boolean;
  className?: string;
  style?: CSSProperties;
  onClick?: (e: MouseEvent) => void;
  children: ReactNode;
}

const RAND = 6;

export default function Schwebend({ anker, menuRef, ausrichtung = "links", abstand = 2, versatzX = 0, breiteWieAnker, className, style, onClick, children }: Props) {
  const [pos, setPos] = useState<{ top: number; left: number; breite?: number } | null>(null);
  const platzhalter = useRef<HTMLSpanElement>(null);
  const eigenesMenu = useRef<HTMLDivElement>(null);
  const menu = menuRef ?? eigenesMenu;

  useLayoutEffect(() => {
    const platzieren = () => {
      const a = (anker?.current ?? platzhalter.current?.parentElement)?.getBoundingClientRect();
      const m = menu.current;
      if (!a || !m) return;
      const vw = window.innerWidth, vh = window.innerHeight;
      const breite = breiteWieAnker ? Math.min(a.width - versatzX, vw - 2 * RAND) : undefined;
      const w = breite ?? m.offsetWidth, h = m.offsetHeight;
      let top = a.bottom + abstand;
      if (top + h > vh - RAND) {
        // oben genug Platz → nach oben öffnen, sonst so weit hoch schieben, dass es ganz sichtbar ist
        top = a.top - abstand - h >= RAND ? a.top - abstand - h : Math.max(RAND, vh - RAND - h);
      }
      let left = ausrichtung === "rechts" ? a.right - w : a.left + versatzX;
      left = Math.min(Math.max(RAND, left), Math.max(RAND, vw - RAND - w));
      setPos(p => p && p.top === top && p.left === left && p.breite === breite ? p : { top, left, breite });
    };
    platzieren();
    // Inhalt kann nachladen (z.B. Versionsliste) → Grösse ändert sich
    const ro = new ResizeObserver(platzieren);
    if (menu.current) ro.observe(menu.current);
    window.addEventListener("resize", platzieren);
    window.addEventListener("scroll", platzieren, true);
    return () => { ro.disconnect(); window.removeEventListener("resize", platzieren); window.removeEventListener("scroll", platzieren, true); };
  }, [anker, menu, ausrichtung, abstand, versatzX, breiteWieAnker]);

  return (
    <>
      {!anker && <span ref={platzhalter} style={{ display: "none" }} />}
      {createPortal(
        <div ref={menu} className={className} onClick={onClick} onMouseDown={e => e.stopPropagation()}
          style={{
            // body hat die App-Schrift nicht (die setzen erst die Tab-Container) → hier explizit
            fontFamily: "var(--tc-font)", color: "var(--tc-text)",
            ...style, position: "fixed", zIndex: 1000, top: pos?.top ?? 0, left: pos?.left ?? 0,
            ...(pos?.breite !== undefined ? { width: pos.breite } : {}),
            maxHeight: style?.maxHeight !== undefined
              ? `min(${typeof style.maxHeight === "number" ? `${style.maxHeight}px` : style.maxHeight}, calc(100vh - ${2 * RAND}px))`
              : `calc(100vh - ${2 * RAND}px)`,
            overflowY: "auto", boxSizing: "border-box",
            visibility: pos ? undefined : "hidden",
          }}>
          {children}
        </div>,
        document.body,
      )}
    </>
  );
}
