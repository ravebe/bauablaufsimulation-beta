// useUndo.ts — alle Änderungen an den Simulationen laufen über aendereSims (bzw. setSimsMitUndo mit der
// Signatur von setState, für Komponenten wie TabProjekte) → jede Benutzeraktion ist rückgängig machbar,
// letzte 15 Schritte je Sitzung. Laden/Konflikt-Auflösung (useCloudSync) setzen den Stand direkt und
// leeren den Verlauf — sonst würde "Rückgängig" den Cloud-Stand durch einen älteren lokalen ersetzen.
// Logik in undoVerlauf.ts.
import { useEffect, useRef, useState } from "react";
import type { Dispatch, SetStateAction } from "react";
import type { SimProjekt } from "../types";
import { LEERER_VERLAUF, aufzeichnen, gleicherStand, rueckgaengig, wiederholen } from "./undoVerlauf";
import type { Verlauf } from "./undoVerlauf";

export function useUndo(sims: SimProjekt[], setSims: Dispatch<SetStateAction<SimProjekt[]>>, userName: string) {
  const verlauf = useRef<Verlauf>(LEERER_VERLAUF);
  // Aktueller Stand auch zwischen zwei Renderings (mehrere Änderungen im selben Klick bauen aufeinander auf)
  const aktuell = useRef(sims);
  useEffect(() => { aktuell.current = sims; }, [sims]);
  // Stapel-Längen als echter State, damit die Undo-/Redo-Buttons korrekt neu rendern
  const [undoLen, setUndoLen] = useState(0);
  const [redoLen, setRedoLen] = useState(0);
  const anzeigen = () => { setUndoLen(verlauf.current.undo.length); setRedoLen(verlauf.current.redo.length); };

  function aendereSims(fn: (prev: SimProjekt[]) => SimProjekt[]) {
    const vorher = aktuell.current;
    const nachher = fn(vorher);
    if (gleicherStand(vorher, nachher)) return;
    verlauf.current = aufzeichnen(verlauf.current, vorher);
    aktuell.current = nachher;
    setSims(nachher);
    anzeigen();
  }

  /** Drop-in für setSims (gleiche Signatur), aber mit Rückgängig */
  const setSimsMitUndo: Dispatch<SetStateAction<SimProjekt[]>> = action =>
    aendereSims(prev => (typeof action === "function" ? action(prev) : action));

  function updateSim(updated: SimProjekt) {
    const gestempelt = { ...updated, geaendertAm: new Date().toISOString(), geaendertVon: userName || undefined };
    aendereSims(prev => prev.map(s => (s.id === updated.id ? gestempelt : s)));
  }

  function undo() {
    const r = rueckgaengig(verlauf.current, aktuell.current);
    if (!r) return;
    verlauf.current = r.verlauf; aktuell.current = r.stand;
    setSims(r.stand); anzeigen();
  }

  function redo() {
    const r = wiederholen(verlauf.current, aktuell.current);
    if (!r) return;
    verlauf.current = r.verlauf; aktuell.current = r.stand;
    setSims(r.stand); anzeigen();
  }

  function verlaufLeeren() {
    verlauf.current = LEERER_VERLAUF;
    anzeigen();
  }

  return { updateSim, aendereSims, setSimsMitUndo, undo, redo, undoLen, redoLen, verlaufLeeren };
}
