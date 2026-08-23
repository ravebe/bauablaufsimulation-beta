// SimKebabMenu.tsx — ⋮-Menü der Simulationskarte: Gantt-Vorlage/-Export, Kopieren, Zugriff, Löschen
import { useState } from "react";
import * as XLSX from "xlsx";
import type { SimProjekt, Zugriff } from "../types";
import { EXPORT_FORMATE } from "./ganttExportFormate";
import { useClickOutside } from "../hooks/useClickOutside";

interface Props {
  sim: SimProjekt;
  istErsteller: boolean;
  onKopieren: () => void;
  onZugriffAendern: (key: Zugriff) => void;
  onLoeschen: () => void;
}

const GANTT_VORLAGE_HEADER = ["Name", "Start", "Ende", "Typ", "Vorgänger", "Wartetage", "Bauabschnitt", "Geschoss", "Etappe", "Objektname", "Layer"];
const GANTT_VORLAGE_BEISPIEL = [
  ["Erdarbeiten", "01.01.2025", "15.01.2025", "neubau", "", "", "BA1", "UG", "1", "Bodenplatte", "Fundament"],
  ["Bestandswand", "01.01.2025", "01.01.2025", "bestand", "", "", "BA1", "EG", "", "Wand Beton", "Bestand"],
  ["Abbruch Altbau", "16.01.2025", "20.01.2025", "abbruch", "1", "0", "BA1", "EG", "1", "Altbau Wand", "Abbruch"],
  ["Rohbau EG", "21.01.2025", "15.02.2025", "neubau", "3", "2", "BA1", "EG", "2", "Decke Beton", "Rohbau"],
  ["Gerüst", "01.02.2025", "28.02.2025", "temporaer", "", "", "BA1", "EG", "2", "Gerüst", "Temporär"],
];

function downloadGanttVorlage() {
  const ws = XLSX.utils.aoa_to_sheet([GANTT_VORLAGE_HEADER, ...GANTT_VORLAGE_BEISPIEL]);
  ws["!cols"] = GANTT_VORLAGE_HEADER.map(() => ({ wch: 16 }));
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Gantt-Vorlage");
  XLSX.writeFile(wb, "4D_Gantt_Vorlage.xlsx");
}

const ZUGRIFF_OPTIONEN = [
  { key: "edit" as const, label: "Zugriff bearbeiten", desc: "Inhalt hinzufügen, bearbeiten" },
  { key: "read" as const, label: "Schreibgeschützt", desc: "Nur Anzeigen von Inhalt" },
  { key: "none" as const, label: "Kein Zugriff", desc: "Projekt wird ausgeblendet" },
];

export default function SimKebabMenu({ sim, istErsteller, onKopieren, onZugriffAendern, onLoeschen }: Props) {
  const [offen, setOffen] = useState(false);
  const [exportSubOffen, setExportSubOffen] = useState(false);
  const ref = useClickOutside<HTMLDivElement>(offen, () => { setOffen(false); setExportSubOffen(false); });

  const aktDefault = sim.zugriff?.["__default__"] ?? "read";

  return (
    <div ref={ref} style={{ position: "relative" }} onClick={e => e.stopPropagation()}>
      <button
        style={{ background: "none", border: "none", cursor: "pointer", fontSize: 16, color: "var(--tc-text-3)", padding: "0 4px" }}
        onClick={() => { setOffen(o => !o); setExportSubOffen(false); }}
      >⋮</button>
      {offen && (
        <div style={{
          position: "absolute", right: 0, top: "100%", background: "white",
          border: "0.5px solid var(--tc-border)", borderRadius: 5,
          boxShadow: "0 2px 8px rgba(0,0,0,.12)", zIndex: 100, minWidth: 200,
        }}>
          {istErsteller && (
            <button
              style={{ display: "block", width: "100%", padding: "8px 14px", background: "none", border: "none", textAlign: "left", fontSize: 11, cursor: "pointer", borderBottom: "0.5px solid #eef1f4" }}
              onClick={() => { downloadGanttVorlage(); setOffen(false); }}
            >Gantt-Vorlage</button>
          )}
          {istErsteller && sim.tasks.length > 0 && (
            <>
              <div
                style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "8px 14px", fontSize: 11, cursor: "pointer", borderBottom: "0.5px solid #eef1f4" }}
                onClick={() => setExportSubOffen(o => !o)}
              >
                <span>Export</span>
                <span>{exportSubOffen ? "▲" : "▼"}</span>
              </div>
              {exportSubOffen && EXPORT_FORMATE.map(f => (
                <button key={f.key}
                  style={{ display: "block", width: "100%", padding: "8px 14px 8px 24px", background: "none", border: "none", textAlign: "left", fontSize: 10, cursor: "pointer", borderBottom: "0.5px solid #eef1f4" }}
                  onClick={() => { f.run(sim.tasks, sim.name, sim.kalender); setExportSubOffen(false); setOffen(false); }}
                >{f.label}</button>
              ))}
            </>
          )}
          <button
            style={{ display: "block", width: "100%", padding: "8px 14px", background: "none", border: "none", textAlign: "left", fontSize: 11, cursor: "pointer", borderBottom: "0.5px solid #eef1f4" }}
            onClick={() => { onKopieren(); setOffen(false); }}
          >Projekt kopieren</button>
          {istErsteller && (
          <>
          <div style={{ padding: "6px 14px", fontSize: 10, color: "var(--tc-text-3)", fontWeight: 600, borderBottom: "1px solid #eef1f4" }}>
            Zugriff für Projektmitglieder
          </div>
          {ZUGRIFF_OPTIONEN.map(opt => {
            const istAktiv = aktDefault === opt.key;
            return (
            <button key={opt.key}
              style={{ display: "block", width: "100%", padding: "6px 14px", background: istAktiv ? "#f0f7ff" : "none", border: "none", textAlign: "left", fontSize: 11, cursor: "pointer", borderBottom: "0.5px solid #eef1f4" }}
              onClick={() => { onZugriffAendern(opt.key); setOffen(false); }}
            >
              <div style={{ fontWeight: 500 }}>{opt.label} {istAktiv && "✓"}</div>
              {opt.desc && <div style={{ fontSize: 9, color: "var(--tc-text-3)" }}>{opt.desc}</div>}
            </button>
            );
          })}
          </>
          )}
          {istErsteller && (
          <button
            style={{ display: "block", width: "100%", padding: "8px 14px", background: "none", border: "none", textAlign: "left", fontSize: 11, color: "var(--tc-red)", cursor: "pointer" }}
            onClick={() => { onLoeschen(); setOffen(false); }}
          >Simulation löschen</button>
          )}
        </div>
      )}
    </div>
  );
}
