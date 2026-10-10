// SimInfoBox.tsx — schlanke Zusammenfassung einer Simulation (Ersteller, letzte Änderung, Tasks, Zeitraum, Bauteile, Modelle …).
// Wird im ⋮-Menü der Simulationskarte unter "Info" aufgeklappt, siehe SimKebabMenu.tsx.
import { useEffect, useState } from "react";
import type { SimProjekt } from "../types";
import { formatDatum } from "../types";
import type { ApiInstance } from "../hooks/useApi";
import { simInfoDaten } from "./simInfo";

const datumZeit = (iso?: string) => {
  const d = iso ? new Date(iso) : null;
  return d && !isNaN(d.getTime()) ? d.toLocaleString("de-CH", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" }) : null;
};

export default function SimInfoBox({ sim, api }: { sim: SimProjekt; api?: ApiInstance | null }) {
  const [erstellerName, setErstellerName] = useState<string | null>(null);
  useEffect(() => {
    if (!sim.erstellerId || !api?.project.getMembers) return;
    let abgebrochen = false;
    api.project.getMembers().then(liste => {
      const m = liste.find(x => x.id === sim.erstellerId);
      if (m && !abgebrochen) setErstellerName([m.firstName, m.lastName].filter(Boolean).join(" ").trim() || m.email || null);
    }).catch(() => { /* Name bleibt unbekannt */ });
    return () => { abgebrochen = true; };
  }, [sim.erstellerId, api]);

  const d = simInfoDaten(sim);
  const erstellt = datumZeit(sim.erstelltAm);
  const geaendert = datumZeit(sim.geaendertAm);
  const zeilen: [string, React.ReactNode][] = [
    ["Ersteller", erstellerName ?? (sim.erstellerId ? "—" : "unbekannt")],
    ["Erstellt", erstellt ?? "—"],
    ["Letzte Änderung", geaendert ? `${geaendert}${sim.geaendertVon ? ` · ${sim.geaendertVon}` : ""}` : "—"],
    ["Tasks", `${d.anzahlTasks}${d.anzahlGruppen > 0 ? ` in ${d.anzahlGruppen} Gruppe${d.anzahlGruppen === 1 ? "" : "n"}` : ""}`],
    ["Zeitraum", d.start && d.ende ? `${formatDatum(d.start)} – ${formatDatum(d.ende)}${d.arbeitstage != null ? ` (${d.arbeitstage} Arbeitstage)` : ""}` : "—"],
    ["Bauteile", `${d.bauteile} zugeordnet${d.tasksOhneBauteile > 0 ? ` · ${d.tasksOhneBauteile} Tasks ohne Bauteile` : ""}${d.ausgeschlossen > 0 ? ` · ${d.ausgeschlossen} entfernt` : ""}`],
    ["Kalkulation", `${d.tasksMitKuerzel} von ${d.anzahlTasks} Tasks mit Kürzel${d.kraene > 0 ? ` · ${d.kraene} Kran${d.kraene === 1 ? "" : "e"}` : ""}`],
    ["Modelle", sim.modelle.length === 0 ? "keine" : sim.modelle.map(m => `${m.name}${m.vierD ? " (4D)" : ""}`).join(", ")],
    ["Gantt-Datei", sim.ganttImport ? `${sim.ganttImport.dateiname} · Version ${sim.ganttImport.version}` : "—"],
  ];
  return (
    <div style={{ padding: "8px 14px 10px", background: "#fafbfc", fontSize: 10, lineHeight: 1.45, maxWidth: 320 }}>
      <div style={{ fontWeight: 700, fontSize: 11, color: "var(--tc-text)", marginBottom: 4, wordBreak: "break-word" }}>{sim.name}</div>
      <div style={{ display: "grid", gridTemplateColumns: "auto 1fr", columnGap: 10, rowGap: 2 }}>
        {zeilen.map(([k, v]) => (
          <div key={k} style={{ display: "contents" }}>
            <span style={{ color: "var(--tc-text-3)", whiteSpace: "nowrap" }}>{k}</span>
            <span style={{ color: "var(--tc-text)", wordBreak: "break-word" }}>{v}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
