// markiereInhalt.ts — Eingabefeld markiert beim Hineinklicken den ganzen Inhalt (direkt überschreiben oder löschen).
// Nur select() im onFocus reicht nicht: das folgende mouseup des Klicks hebt die Markierung in Chrome wieder auf.
import type React from "react";

let gerade: HTMLInputElement | null = null;

export const markiereInhalt = {
  onFocus: (e: React.FocusEvent<HTMLInputElement>) => { gerade = e.currentTarget; e.currentTarget.select(); },
  onMouseUp: (e: React.MouseEvent<HTMLInputElement>) => { if (gerade === e.currentTarget) { e.preventDefault(); gerade = null; } },
  onBlur: () => { gerade = null; },
};
