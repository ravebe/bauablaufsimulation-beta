// KalenderManager.tsx — Fenster zur Pflege des Arbeitstage-Kalenders (Feiertage + Ferien) einer
// Simulation. Wochenenden sind fix arbeitsfrei; hier werden zusätzliche Feiertage (Einzeltage) und
// Ferien (Zeiträume) verwaltet, die Dauer-Anzeigen, Gantt-Schattierung und den MS-Project-Export
// kalenderbewusst statt rein kalendertag-basiert machen.
import { useState } from "react";
import type { SimProjekt } from "../types";
import type { Feiertag, Ferienzeitraum } from "./kalenderHelpers";
import { schweizerFeiertage } from "./kalenderHelpers";

interface Props { sim: SimProjekt; updateSim: (s: SimProjekt) => void; onClose: () => void; }

export default function KalenderManager({ sim, updateSim, onClose }: Props) {
  const [feiertage, setFeiertage] = useState<Feiertag[]>(sim.kalender?.feiertage ?? []);
  const [ferien, setFerien] = useState<Ferienzeitraum[]>(sim.kalender?.ferien ?? []);
  // Schalter: Wochenenden, Feiertage und Ferien berücksichtigen (Standard: an). Aus = jeder Tag ist ein Arbeitstag.
  const [freieTageGelten, setFreieTageGelten] = useState<boolean>(sim.kalender?.freieTageGelten !== false);

  function heuteIso() {
    const heute = new Date();
    return `${heute.getFullYear()}-${String(heute.getMonth() + 1).padStart(2, "0")}-${String(heute.getDate()).padStart(2, "0")}`;
  }

  function speichern(neueFeiertage: Feiertag[], neueFerien: Ferienzeitraum[], gelten: boolean = freieTageGelten) {
    const feiertageSortiert = [...neueFeiertage].sort((a, b) => a.datum.localeCompare(b.datum));
    const ferienSortiert = [...neueFerien].sort((a, b) => a.von.localeCompare(b.von));
    setFeiertage(feiertageSortiert);
    setFerien(ferienSortiert);
    updateSim({ ...sim, kalender: { feiertage: feiertageSortiert, ferien: ferienSortiert, ...(gelten ? {} : { freieTageGelten: false }) } });
  }

  function schalterUmlegen() {
    if (freieTageGelten) {
      const ok = confirm(
        "Arbeitsfreie Tage ausschalten?\n\n" +
        "• Wochenenden, Feiertage und Ferien zählen dann als normale Arbeitstage — Tasks dürfen am Wochenende und in den Ferien laufen.\n" +
        "• Eine Dauer von 9 Tagen sind dann 9 Arbeitstage am Stück (Kalendertage).\n" +
        "• Starttage werden nicht mehr auf den nächsten Arbeitstag verschoben, und das Wochenende ist keine Pause mehr.\n" +
        "• Bestehende Termine bleiben unverändert; angezeigte Dauern werden neu gezählt.\n\nFortfahren?");
      if (!ok) return;
    }
    const neu = !freieTageGelten;
    setFreieTageGelten(neu);
    speichern(feiertage, ferien, neu);
  }

  function zeileAendern(idx: number, feld: "datum" | "name", wert: string) {
    speichern(feiertage.map((f, i) => i === idx ? { ...f, [feld]: wert } : f), ferien);
  }

  function zeileEntfernen(idx: number) {
    speichern(feiertage.filter((_, i) => i !== idx), ferien);
  }

  function zeileHinzufuegen() {
    speichern([...feiertage, { datum: heuteIso(), name: "" }], ferien);
  }

  function ferienZeileAendern(idx: number, feld: "von" | "bis" | "name", wert: string) {
    speichern(feiertage, ferien.map((f, i) => i === idx ? { ...f, [feld]: wert } : f));
  }

  function ferienZeileEntfernen(idx: number) {
    speichern(feiertage, ferien.filter((_, i) => i !== idx));
  }

  function ferienZeileHinzufuegen() {
    const heute = heuteIso();
    speichern(feiertage, [...ferien, { von: heute, bis: heute, name: "" }]);
  }

  function standardEinfuegen() {
    let minJahr = new Date().getFullYear(), maxJahr = minJahr;
    for (const t of sim.tasks) {
      const sj = Number(t.start?.slice(0, 4)), ej = Number(t.end?.slice(0, 4));
      if (sj) { minJahr = Math.min(minJahr, sj); maxJahr = Math.max(maxJahr, sj); }
      if (ej) { minJahr = Math.min(minJahr, ej); maxJahr = Math.max(maxJahr, ej); }
    }
    const vorhandeneDaten = new Set(feiertage.map(f => f.datum));
    const neue: Feiertag[] = [];
    for (let j = minJahr; j <= maxJahr; j++) {
      for (const f of schweizerFeiertage(j)) {
        if (!vorhandeneDaten.has(f.datum)) { neue.push(f); vorhandeneDaten.add(f.datum); }
      }
    }
    speichern([...feiertage, ...neue], ferien);
  }

  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,.4)", zIndex: 1000, display: "flex", alignItems: "center", justifyContent: "center" }}
      onClick={onClose}>
      <div style={{ background: "#fff", width: 460, maxWidth: "92vw", maxHeight: "85vh", overflowY: "auto",
        boxShadow: "0 8px 30px rgba(0,0,0,.25)", fontFamily: "var(--tc-font)" }}
        onClick={e => e.stopPropagation()}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "14px 18px", borderBottom: "1px solid var(--tc-border-light)" }}>
          <div style={{ fontSize: 16, fontWeight: 700, color: "var(--tc-text)" }}>Kalender / Feiertage / Ferien</div>
          <button className="tc-btn-ghost" style={{ fontSize: 14, padding: "2px 8px" }} onClick={onClose}>✕</button>
        </div>

        <div style={{ padding: "14px 18px" }}>
          <div style={{ fontSize: 11, color: "var(--tc-text-2)", lineHeight: 1.5, marginBottom: 12 }}>
            Wochenenden, Feiertage (Einzeltage) und Ferien (Zeiträume) sind arbeitsfrei: Tasks beginnen und enden nur an
            Arbeitstagen, die Dauer zählt nur Arbeitstage. Das wirkt sich auf Dauern, Folge-Tasks, die Gantt-Schattierung
            sowie den MS-Project- und IFC-Export dieser Simulation aus.
          </div>

          <label style={{ display: "flex", alignItems: "flex-start", gap: 8, padding: "8px 10px", marginBottom: 14, cursor: "pointer",
            background: freieTageGelten ? "var(--tc-blue-bg)" : "#fff6e5", border: `1px solid ${freieTageGelten ? "#b0d4f0" : "#f0c975"}` }}>
            <input type="checkbox" checked={freieTageGelten} onChange={schalterUmlegen} style={{ marginTop: 2 }} />
            <span style={{ fontSize: 11, lineHeight: 1.45 }}>
              <b>Wochenenden, Feiertage und Ferien berücksichtigen</b>
              <span style={{ display: "block", color: "var(--tc-text-3)", fontSize: 10 }}>
                {freieTageGelten
                  ? "Eingeschaltet (Standard): Tasks laufen nur an Arbeitstagen; ein Start am Wochenende rückt auf den nächsten Arbeitstag."
                  : "⚠ Ausgeschaltet: Wochenendarbeit erlaubt — jeder Tag zählt als Arbeitstag, nichts wird auf einen Werktag verschoben (9 Tage = 9 Arbeitstage). Die Listen unten bleiben gespeichert, wirken aber nicht."}
              </span>
            </span>
          </label>

          <div style={{ fontSize: 9, fontWeight: 600, color: "var(--tc-text-3)", letterSpacing: ".5px", marginBottom: 6 }}>FEIERTAGE</div>
          {feiertage.length === 0 && (
            <div style={{ fontSize: 11, color: "var(--tc-text-3)", marginBottom: 8 }}>Noch keine Feiertage eingetragen</div>
          )}
          {feiertage.map((f, idx) => (
            <div key={idx} style={{ display: "flex", alignItems: "center", gap: 6, padding: "5px 0", borderBottom: "1px solid var(--tc-border-light)" }}>
              <input type="date" value={f.datum} onChange={e => zeileAendern(idx, "datum", e.target.value)}
                style={{ fontSize: 11, padding: "3px 5px", border: "1px solid #d4dce4", fontFamily: "inherit", flexShrink: 0 }} />
              <input type="text" placeholder="Bezeichnung" value={f.name} onChange={e => zeileAendern(idx, "name", e.target.value)}
                style={{ fontSize: 11, padding: "3px 5px", border: "1px solid #d4dce4", fontFamily: "inherit", flex: 1, minWidth: 0 }} />
              <button className="tc-btn-ghost" style={{ fontSize: 11, padding: "2px 6px", flexShrink: 0 }} onClick={() => zeileEntfernen(idx)}>Entfernen</button>
            </div>
          ))}

          <div style={{ display: "flex", gap: 8, marginTop: 12, marginBottom: 20 }}>
            <button className="tc-btn-secondary" style={{ fontSize: 11, padding: "5px 10px" }} onClick={zeileHinzufuegen}>
              Feiertag hinzufügen
            </button>
            <button className="tc-btn-secondary" style={{ fontSize: 11, padding: "5px 10px" }} onClick={standardEinfuegen}>
              Schweizer Standard-Feiertage einfügen
            </button>
          </div>

          <div style={{ fontSize: 9, fontWeight: 600, color: "var(--tc-text-3)", letterSpacing: ".5px", marginBottom: 6 }}>FERIEN</div>
          {ferien.length === 0 && (
            <div style={{ fontSize: 11, color: "var(--tc-text-3)", marginBottom: 8 }}>Noch keine Ferien eingetragen</div>
          )}
          {ferien.map((f, idx) => (
            <div key={idx} style={{ display: "flex", alignItems: "center", gap: 6, padding: "5px 0", borderBottom: "1px solid var(--tc-border-light)", flexWrap: "wrap" }}>
              <input type="date" value={f.von} onChange={e => ferienZeileAendern(idx, "von", e.target.value)}
                style={{ fontSize: 11, padding: "3px 5px", border: "1px solid #d4dce4", fontFamily: "inherit", flexShrink: 0 }} />
              <span style={{ fontSize: 11, color: "var(--tc-text-3)" }}>bis</span>
              <input type="date" value={f.bis} onChange={e => ferienZeileAendern(idx, "bis", e.target.value)}
                style={{ fontSize: 11, padding: "3px 5px", border: "1px solid #d4dce4", fontFamily: "inherit", flexShrink: 0 }} />
              <input type="text" placeholder="Bezeichnung" value={f.name} onChange={e => ferienZeileAendern(idx, "name", e.target.value)}
                style={{ fontSize: 11, padding: "3px 5px", border: "1px solid #d4dce4", fontFamily: "inherit", flex: 1, minWidth: 90 }} />
              <button className="tc-btn-ghost" style={{ fontSize: 11, padding: "2px 6px", flexShrink: 0 }} onClick={() => ferienZeileEntfernen(idx)}>Entfernen</button>
            </div>
          ))}

          <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
            <button className="tc-btn-secondary" style={{ fontSize: 11, padding: "5px 10px" }} onClick={ferienZeileHinzufuegen}>
              Ferien hinzufügen
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
