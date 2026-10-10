// listenScroll.ts — gemeinsame Scroll-Lage der Task-Listen (Tab Bauteile: Liste/Gantt, Tab Abspielen: Liste/Gantt).
// Gemerkt wird nicht der Pixelwert (Zeilenhöhen unterscheiden sich), sondern die erste sichtbare Zeile
// (data-taskid). Beim Wechsel Liste ↔ Gantt oder Tab ↔ Tab steht dieselbe Zeile wieder zuoberst.
import { useEffect, useMemo, useRef } from "react";

let ersteZeileId: string | null = null;

function merke(container: HTMLElement) {
  const oben = container.getBoundingClientRect().top;
  for (const row of Array.from(container.querySelectorAll<HTMLElement>("[data-taskid]"))) {
    if (row.getBoundingClientRect().bottom > oben + 1) { ersteZeileId = row.dataset.taskid ?? null; return; }
  }
}

function stelleWiederHer(container: HTMLElement) {
  if (!ersteZeileId) return;
  const el = container.querySelector<HTMLElement>(`[data-taskid="${ersteZeileId.replace(/"/g, '\\"')}"]`);
  if (el) container.scrollTop += el.getBoundingClientRect().top - container.getBoundingClientRect().top;
}

/** Stellt die gemerkte Lage her (jetzt und sobald der Container sichtbar/gross wird, z.B. nach Tab-Wechsel
 *  mit display:none) und merkt sich künftiges Scrollen. Gibt die Aufräum-Funktion zurück. */
export function bindeListenScroll(container: HTMLElement | null): () => void {
  if (!container) return () => {};
  let letzteHoehe = 0;
  let wiederherstellen = false;
  const onScroll = () => { if (!wiederherstellen) merke(container); };
  const ro = new ResizeObserver(() => {
    const h = container.clientHeight;
    if (h > 0 && letzteHoehe === 0) {
      wiederherstellen = true;
      stelleWiederHer(container);
      requestAnimationFrame(() => { stelleWiederHer(container); wiederherstellen = false; });
    }
    letzteHoehe = h;
  });
  ro.observe(container);
  container.addEventListener("scroll", onScroll, { passive: true });
  return () => { ro.disconnect(); container.removeEventListener("scroll", onScroll); };
}

/** Zeile vertikal in der Mitte des Scroll-Containers platzieren (am Rand wird nur bis zum Anschlag gescrollt). */
export function zentriereZeile(container: HTMLElement, row: HTMLElement) {
  if (container.clientHeight === 0) return; // Tab gerade nicht sichtbar
  const dy = row.getBoundingClientRect().top - container.getBoundingClientRect().top - (container.clientHeight - row.getBoundingClientRect().height) / 2;
  container.scrollTop += dy;
}

/**
 * Meldet eine NEUE Modell-Selektion (Bauteile im 3D-Modell markiert). Beim Einhängen der Komponente (z.B. Wechsel
 * Liste ↔ Gantt) wird die bestehende Selektion nicht erneut gemeldet, damit die gemerkte Scroll-Lage bleibt.
 * Rückgabe von fn: die selektierten Bauteil-GUIDs ("modelId:::runtimeId").
 */
export function useSelektionFokus(selGuids: Set<string> | undefined, aktiv: boolean, fn: (guids: string[]) => void) {
  const key = useMemo(() => (selGuids ? [...selGuids].sort().join("|") : ""), [selGuids]);
  const prev = useRef(key);
  const fnRef = useRef(fn);
  fnRef.current = fn;
  useEffect(() => {
    if (key === prev.current) return;
    prev.current = key;
    if (!aktiv || !key) return;
    fnRef.current(key.split("|"));
  }, [key, aktiv]);
}
