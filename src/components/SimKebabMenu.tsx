// SimKebabMenu.tsx — ⋮-Menü der Simulationskarte: Gantt-Vorlage/-Export, Kopieren, Löschen
// Zugriffskontrolle liegt nicht mehr hier, sondern zentral im Zugriffskontrollmanager (App-Header, ⋮),
// siehe ZugriffskontrollManager.tsx — nur dort einstellbar, für Admins/Ersteller.
import { useState } from "react";
import * as XLSX from "xlsx";
import type { SimProjekt } from "../types";
import { EXPORT_FORMATE } from "./ganttExportFormate";
import { useClickOutside } from "../hooks/useClickOutside";

interface Props {
  sim: SimProjekt;
  istErsteller: boolean;
  onKopieren: () => void;
  onUmbenennen: (neuerName: string) => void;
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

export default function SimKebabMenu({ sim, istErsteller, onKopieren, onUmbenennen, onLoeschen }: Props) {
  const [offen, setOffen] = useState(false);
  const [exportSubOffen, setExportSubOffen] = useState(false);
  const [umbenennOffen, setUmbenennOffen] = useState(false);
  const [neuerName, setNeuerName] = useState("");
  const ref = useClickOutside<HTMLDivElement>(offen, () => { setOffen(false); setExportSubOffen(false); setUmbenennOffen(false); });

  function speichernUmbenennen() {
    if (neuerName.trim()) onUmbenennen(neuerName.trim());
    setUmbenennOffen(false);
    setOffen(false);
  }

  return (
    <div ref={ref} style={{ position: "relative" }} onClick={e => e.stopPropagation()}>
      <button
        style={{ background: "none", border: "none", cursor: "pointer", fontSize: 16, color: "var(--tc-text-3)", padding: "0 4px" }}
        onClick={() => { setOffen(o => !o); setExportSubOffen(false); setUmbenennOffen(false); }}
      >⋮</button>
      {offen && (
        <div style={{
          position: "absolute", right: 0, top: "100%", background: "white",
          border: "0.5px solid var(--tc-border)", borderRadius: 5,
          boxShadow: "0 2px 8px rgba(0,0,0,.12)", zIndex: 100, minWidth: 200,
        }}>
          {istErsteller && (
            umbenennOffen ? (
              <div style={{ padding: "8px 14px", borderBottom: "0.5px solid #eef1f4" }}>
                <input className="tc-input" style={{ width: "100%", fontSize: 11, boxSizing: "border-box" }} autoFocus
                  value={neuerName}
                  onChange={e => setNeuerName(e.target.value)}
                  onKeyDown={e => { if (e.key === "Enter") speichernUmbenennen(); if (e.key === "Escape") setUmbenennOffen(false); }}
                />
                <div style={{ display: "flex", gap: 6, marginTop: 6 }}>
                  <button className="tc-btn-primary" style={{ flex: 1, fontSize: 10, padding: "4px 8px" }}
                    onClick={speichernUmbenennen}>Speichern</button>
                  <button className="tc-btn-secondary" style={{ fontSize: 10, padding: "4px 8px" }}
                    onClick={() => setUmbenennOffen(false)}>Abbrechen</button>
                </div>
              </div>
            ) : (
              <button
                style={{ display: "block", width: "100%", padding: "8px 14px", background: "none", border: "none", textAlign: "left", fontSize: 11, cursor: "pointer", borderBottom: "0.5px solid #eef1f4" }}
                onClick={() => { setNeuerName(sim.name); setUmbenennOffen(true); }}
              >Simulation umbenennen</button>
            )
          )}
          {istErsteller && (
            <button
              style={{ display: "block", width: "100%", padding: "8px 14px", background: "none", border: "none", textAlign: "left", fontSize: 11, cursor: "pointer", borderBottom: "0.5px solid #eef1f4" }}
              onClick={() => { downloadGanttVorlage(); setOffen(false); }}
            >Gantt-Vorlage</button>
          )}
          {istErsteller && sim.tasks.length > 0 && (
            <>
              <button
                style={{ display: "flex", width: "100%", justifyContent: "space-between", alignItems: "center", padding: "8px 14px", background: "none", border: "none", fontSize: 11, cursor: "pointer", borderBottom: "0.5px solid #eef1f4" }}
                onClick={() => setExportSubOffen(o => !o)}
              >
                <span>Gantt-Export</span>
                <span>{exportSubOffen ? "▲" : "▼"}</span>
              </button>
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
          <button
            style={{ display: "block", width: "100%", padding: "8px 14px", background: "none", border: "none", textAlign: "left", fontSize: 11, cursor: "pointer" }}
            onClick={() => { onLoeschen(); setOffen(false); }}
          >Simulation löschen</button>
          )}
        </div>
      )}
    </div>
  );
}
