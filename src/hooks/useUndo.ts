// useUndo.ts — Änderungen an einer Simulation mit Rückgängig/Wiederholen (letzte 15 Schritte je Sitzung).
// updateSim stempelt geaendertAm/-Von und legt den vorherigen Stand der Sim auf den Undo-Stapel.
import { useRef, useState } from "react";
import type { Dispatch, SetStateAction } from "react";
import type { SimProjekt } from "../types";

const MAX_SCHRITTE = 15;

export function useUndo(sims: SimProjekt[], setSims: Dispatch<SetStateAction<SimProjekt[]>>, userName: string) {
  const undoStack = useRef<SimProjekt[]>([]);
  const redoStack = useRef<SimProjekt[]>([]);
  // Spiegelt die Stapel-Längen als echten State (statt die Refs beim Rendern zu lesen) — nur so rendern
  // die Undo-/Redo-Buttons nach jeder Änderung korrekt neu.
  const [undoLen, setUndoLen] = useState(0);
  const [redoLen, setRedoLen] = useState(0);

  function updateSim(updated: SimProjekt) {
    const current = sims.find(s => s.id === updated.id);
    if (current) {
      undoStack.current = [...undoStack.current.slice(-(MAX_SCHRITTE - 1)), current];
      redoStack.current = [];
      setUndoLen(undoStack.current.length); setRedoLen(0);
    }
    const gestempelt = { ...updated, geaendertAm: new Date().toISOString(), geaendertVon: userName || undefined };
    setSims(prev => prev.map(s => s.id === updated.id ? gestempelt : s));
  }

  function undo() {
    if (undoStack.current.length === 0) return;
    const prev = undoStack.current.pop()!;
    const current = sims.find(s => s.id === prev.id);
    if (current) redoStack.current.push(current);
    setSims(s => s.map(sim => sim.id === prev.id ? prev : sim));
    setUndoLen(undoStack.current.length); setRedoLen(redoStack.current.length);
  }

  function redo() {
    if (redoStack.current.length === 0) return;
    const next = redoStack.current.pop()!;
    const current = sims.find(s => s.id === next.id);
    if (current) undoStack.current.push(current);
    setSims(s => s.map(sim => sim.id === next.id ? next : sim));
    setUndoLen(undoStack.current.length); setRedoLen(redoStack.current.length);
  }

  return { updateSim, undo, redo, undoLen, redoLen };
}
