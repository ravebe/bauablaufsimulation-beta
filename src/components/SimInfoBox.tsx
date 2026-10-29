// SimInfoBox.tsx — Zusammenfassung einer Simulation in Abschnitten (Allgemein, Terminplan, Bauteile & Modelle, Kalkulation).
// Eigenes Fenster (wie Hilfe), geöffnet im ⋮-Menü der Simulationskarte unter "Info", siehe SimKebabMenu.tsx.
import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import type { SimProjekt } from "../types";
import { formatDatum, TASK_TYP_LABEL, TASK_TYP_LISTE } from "../types";
import { ZEITEINHEIT_LABEL } from "./zeitHelpers";
import type { ApiInstance } from "../hooks/useApi";
import { simInfoDaten } from "./simInfo";

const datumZeit = (iso?: string) => {
  const d = iso ? new Date(iso) : null;
  return d && !isNaN(d.getTime()) ? d.toLocaleString("de-CH", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" }) : null;
};

export default function SimInfoBox({ sim, api, onClose }: { sim: SimProjekt; api?: ApiInstance | null; onClose: () => void }) {
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
  const anz = (n: number, ein: string, mehr: string) => `${n} ${n === 1 ? ein : mehr}`;
  const typen = TASK_TYP_LISTE.filter(t => d.typen[t]).map(t => `${TASK_TYP_LABEL[t]} ${d.typen[t]}`).join(" · ");
  const bearbeiter = Object.values(sim.zugriff ?? {}).filter(z => z === "edit").length;
  const vierD = sim.modelle.filter(m => m.vierD).map(m => `${m.name} (${datumZeit(m.vierD!.am) ?? "—"})`);
  const abschnitte: [string, [string, React.ReactNode][]][] = [
    ["Allgemein", [
      ["Ersteller", erstellerName ?? (sim.erstellerId ? "—" : "unbekannt")],
      ["Erstellt", erstellt ?? "—"],
      ["Letzte Änderung", geaendert ? `${geaendert}${sim.geaendertVon ? ` · ${sim.geaendertVon}` : ""}` : "—"],
      ["Bearbeiten erlaubt", bearbeiter > 0 ? anz(bearbeiter, "Person", "Personen") + " (zusätzlich zum Ersteller)" : "nur Ersteller"],
    ]],
    ["Terminplan", [
      ["Tasks", `${d.anzahlTasks}${d.anzahlGruppen > 0 ? ` in ${anz(d.anzahlGruppen, "Gruppe", "Gruppen")}` : ""}${d.meilensteine > 0 ? ` · ${anz(d.meilensteine, "Meilenstein", "Meilensteine")}` : ""}`],
      ["Zeitraum", d.start && d.ende ? `${formatDatum(d.start)} – ${formatDatum(d.ende)}${d.arbeitstage != null ? ` (${d.arbeitstage} Arbeitstage)` : ""}` : "—"],
      ["Vorgänger", `${d.tasksMitVorgaenger} von ${d.anzahlTasks + d.anzahlGruppen} Tasks/Gruppen verknüpft`],
      ["Zeiteinheit", ZEITEINHEIT_LABEL[sim.zeiteinheit ?? "tage"]],
      ["Kalender", d.feiertage + d.ferien > 0 ? `${anz(d.feiertage, "Feiertag", "Feiertage")} · ${anz(d.ferien, "Ferienzeitraum", "Ferienzeiträume")}` : "nur Wochenenden arbeitsfrei"],
      ["Gantt-Datei", sim.ganttImport ? `${sim.ganttImport.dateiname} · Version ${sim.ganttImport.version}` : "—"],
    ]],
    ["Bauteile & Modelle", [
      ["Bauteile", `${d.bauteile} zugeordnet${d.tasksOhneBauteile > 0 ? ` · ${d.tasksOhneBauteile} Tasks ohne Bauteile` : ""}${d.ausgeschlossen > 0 ? ` · ${d.ausgeschlossen} entfernt` : ""}`],
      ["Typen", typen || "—"],
      ["Verknüpfung", sim.verknuepfungsModus === "attribut" ? "Tasks aus IFC-Attributen" : sim.autoVerknuepft ? "Auto-Verknüpfung" : "manuell"],
      ["Modelle", sim.modelle.length === 0 ? "keine" : sim.modelle.map(m => m.name).join(", ")],
      ["IFC 4D in Connect", vierD.length ? vierD.join(", ") : "—"],
    ]],
    ["Kalkulation", [
      ["Leistungsposition", `${d.tasksMitKuerzel} von ${d.anzahlTasks} Tasks`],
      ["Kräne", d.kraene > 0 ? String(d.kraene) : "—"],
    ]],
  ];
  return createPortal(
    <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,.4)", zIndex: 1000, display: "flex", alignItems: "center", justifyContent: "center" }}
      onClick={onClose}>
      <div style={{ background: "#fff", borderRadius: 8, width: 460, maxWidth: "92vw", maxHeight: "85vh", overflowY: "auto",
        boxShadow: "0 8px 30px rgba(0,0,0,.25)", fontFamily: "var(--tc-font)" }}
        onClick={e => e.stopPropagation()}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, padding: "14px 18px", borderBottom: "1px solid var(--tc-border-light)" }}>
          <div style={{ fontSize: 16, fontWeight: 700, color: "var(--tc-text)" }}>Info</div>
          <button className="tc-btn-ghost" style={{ fontSize: 14, padding: "2px 8px" }} onClick={onClose}>✕</button>
        </div>
      <div style={{ padding: "14px 18px 16px", fontSize: 12, lineHeight: 1.5 }}>
      <div style={{ fontWeight: 700, fontSize: 13, color: "var(--tc-text)", marginBottom: 8, wordBreak: "break-word" }}>{sim.name}</div>
      {abschnitte.map(([titel, zeilen]) => (
        <div key={titel} style={{ marginTop: 10 }}>
          <div style={{ fontSize: 10, fontWeight: 600, color: "var(--tc-text-3)", letterSpacing: ".5px", paddingBottom: 3, marginBottom: 4, borderBottom: "1px solid var(--tc-border-light)" }}>{titel.toUpperCase()}</div>
          <div style={{ display: "grid", gridTemplateColumns: "auto 1fr", columnGap: 14, rowGap: 3 }}>
            {zeilen.map(([k, v]) => (
              <div key={k} style={{ display: "contents" }}>
                <span style={{ color: "var(--tc-text-3)", whiteSpace: "nowrap" }}>{k}</span>
                <span style={{ color: "var(--tc-text)", wordBreak: "break-word" }}>{v}</span>
              </div>
            ))}
          </div>
        </div>
      ))}
      </div>
      </div>
    </div>,
    document.body
  );
}
