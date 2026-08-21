// TabKalkulation.tsx — Menge→Tage-Kalkulation je Task (AVOR-Logik) mit Plausibilitätsvergleich
// zur geplanten Dauer aus dem Bauablauf.
import { useState } from "react";
import type { SimProjekt, Task } from "../types";
import { istGruppe, berechneNummern } from "../types";
import { arbeitstageZwischen, LEERER_KALENDER } from "./kalenderHelpers";
import { LEERE_STAMMDATEN, alleKuerzel, gewerkeFuerKuerzel, dauerBerechnetTask } from "./stammdatenHelpers";

interface Props { sim: SimProjekt | null; updateSim: (s: SimProjekt) => void; readOnly?: boolean; }

export default function TabKalkulation({ sim, updateSim, readOnly }: Props) {
  const [wbsOffenIds, setWbsOffenIds] = useState<Set<string>>(new Set());

  if (!sim) return <div style={{ padding: 14, fontSize: 12, color: "var(--tc-text-3)" }}>Kein aktives Projekt ausgewählt</div>;

  const stammdaten = sim.stammdaten ?? LEERE_STAMMDATEN;
  const kalender = sim.kalender ?? LEERER_KALENDER;
  const kuerzelListe = alleKuerzel(stammdaten);
  const nummern = berechneNummern(sim.tasks);

  function taskAendern(taskId: string, patch: Partial<Task>) {
    updateSim({ ...sim!, tasks: sim!.tasks.map(t => t.id === taskId ? { ...t, ...patch } : t) });
  }

  function mengeAendern(task: Task, gewerkKey: string, wert: number | null) {
    const mengen = { ...(task.mengen ?? {}) };
    if (wert === null || wert === 0) delete mengen[gewerkKey]; else mengen[gewerkKey] = wert;
    taskAendern(task.id, { mengen });
  }

  if (kuerzelListe.length === 0) {
    return (
      <div style={{ padding: 14, fontSize: 12, color: "var(--tc-text-3)" }}>
        Noch keine Stammdaten hinterlegt — im Tab Ressourcen zuerst Stammdaten anlegen oder Standardwerte laden.
      </div>
    );
  }

  return (
    <div style={{ padding: 14, fontSize: 12 }}>
      <div style={{ display: "flex", gap: 6, fontSize: 9, color: "var(--tc-text-3)", padding: "0 0 4px", fontWeight: 600 }}>
        <span style={{ width: 24 }}>Nr.</span>
        <span style={{ flex: 1 }}>Task</span>
        <span style={{ width: 60 }}>Kürzel</span>
        <span style={{ flex: 2 }}>Mengen</span>
        <span style={{ width: 44, textAlign: "right" }}>Geplant</span>
        <span style={{ width: 44, textAlign: "right" }}>Berechnet</span>
        <span style={{ width: 20 }} />
      </div>
      {sim.tasks.map((t, i) => {
        if (t.isGroup || istGruppe(sim.tasks, i)) return null;
        const geplant = arbeitstageZwischen(t.start, t.end, kalender);
        const berechnet = dauerBerechnetTask(t, stammdaten);
        const gewerke = t.bauteilKuerzel ? gewerkeFuerKuerzel(stammdaten, t.bauteilKuerzel) : [];
        const abweichung = berechnet > 0 && (berechnet > geplant * 1.5 || berechnet < geplant * 0.67);
        const wbsOffen = wbsOffenIds.has(t.id);
        return (
          <div key={t.id} style={{ borderBottom: "1px solid var(--tc-border-light)" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 6, padding: "5px 0" }}>
            <span style={{ width: 24, fontSize: 10, color: "#666" }}>{nummern.get(t.id)}</span>
            <span style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{t.name}</span>
            <select disabled={readOnly} value={t.bauteilKuerzel ?? ""} onChange={e => taskAendern(t.id, { bauteilKuerzel: e.target.value || undefined })}
              style={{ width: 60, fontSize: 11, padding: "3px 4px", border: "1px solid #d4dce4", fontFamily: "inherit" }}>
              <option value="">–</option>
              {kuerzelListe.map(k => <option key={k} value={k}>{k}</option>)}
            </select>
            <div style={{ flex: 2, display: "flex", gap: 6, flexWrap: "wrap" }}>
              {gewerke.map(g => (
                <label key={g.key} title={`${g.label} [${g.einheit}]`} style={{ fontSize: 9, color: "var(--tc-text-3)", display: "flex", alignItems: "center", gap: 3 }}>
                  {g.label}
                  <input type="number" disabled={readOnly} value={t.mengen?.[g.key] ?? ""}
                    onChange={e => mengeAendern(t, g.key, e.target.value === "" ? null : Number(e.target.value))}
                    style={{ width: 56, fontSize: 10, padding: "2px 4px", border: "1px solid #d4dce4", fontFamily: "inherit" }} />
                </label>
              ))}
              {gewerke.length === 0 && <span style={{ fontSize: 9, color: "var(--tc-text-3)" }}>Kürzel wählen…</span>}
            </div>
            <span style={{ width: 44, textAlign: "right", fontSize: 11, color: "#888" }}>{geplant}d</span>
            <span style={{ width: 44, textAlign: "right", fontSize: 11, fontWeight: 600, color: abweichung ? "#d9622b" : "#333" }}
              title={abweichung ? "Deutliche Abweichung von der geplanten Dauer" : ""}>
              {berechnet}d
            </span>
            <span style={{ width: 20, textAlign: "center", cursor: "pointer", fontSize: 9, color: "var(--tc-text-3)" }}
              title="WBS-Attribute (Etappe/Geschoss/Bauabschnitt/Kranbereich)"
              onClick={() => setWbsOffenIds(prev => { const n = new Set(prev); if (n.has(t.id)) n.delete(t.id); else n.add(t.id); return n; })}>
              {wbsOffen ? "▲" : "WBS"}
            </span>
          </div>
          {wbsOffen && (
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", padding: "0 0 8px 30px" }}>
              {([["etappe", "Etappe"], ["geschoss", "Geschoss"], ["bauabschnitt", "Bauabschnitt"], ["kranbereich", "Kranbereich"]] as const).map(([feld, label]) => (
                <label key={feld} style={{ fontSize: 9, color: "var(--tc-text-3)", display: "flex", alignItems: "center", gap: 3 }}>
                  {label}
                  <input type="text" disabled={readOnly} value={t[feld] ?? ""} onChange={e => taskAendern(t.id, { [feld]: e.target.value || undefined })}
                    style={{ width: 90, fontSize: 10, padding: "2px 4px", border: "1px solid #d4dce4", fontFamily: "inherit" }} />
                </label>
              ))}
            </div>
          )}
          </div>
        );
      })}
    </div>
  );
}
