// IfcImportDialog.tsx — Meldung beim Hinzufügen eines Modells, in dessen IFC ein Bauablauf hinterlegt ist
// (z.B. aus dem eigenen IFC-4D-Export / "In Connect übernehmen", aber auch aus anderen 4D-Programmen).
// Auf Wunsch werden daraus die Tasks der Simulation erstellt und die Bauteile zugeordnet — die IFC-GUIDs
// aus der Datei werden dazu im geladenen Modell in Viewer-Runtime-IDs umgesetzt.
import { useState } from "react";
import type { Kran, SimModell, SimProjekt, Task } from "../types";
import type { ApiInstance } from "../hooks/useApi";
import { batchConvertToRuntimeIds } from "../hooks/useApi";
import { ladeTcDatei } from "../hooks/tcDateien";
import { leseBauablaufAusIfc } from "./ifcImport";
import type { Kalender } from "./kalenderHelpers";
import { ladeModellVersion } from "./modellVersionHelpers";

export interface IfcImportUebernahme {
  tasks: Task[];
  kalender?: Kalender;
  kraene: Kran[];
  bericht: { tasks: number; bauteile: number; nichtGefunden: number };
}

interface Props {
  api: ApiInstance | null;
  sim: SimProjekt;
  modell: SimModell;
  onUebernehmen: (u: IfcImportUebernahme) => void;
  onClose: () => void;
}

const pause = (ms: number) => new Promise(r => setTimeout(r, ms));

export default function IfcImportDialog({ api, sim, modell, onUebernehmen, onClose }: Props) {
  const [schritt, setSchritt] = useState<string | null>(null);
  const [fehler, setFehler] = useState<string | null>(null);
  const bestehend = sim.tasks.length;

  async function uebernehmen() {
    if (!api) { setFehler("Trimble-Connect-API nicht verbunden."); return; }
    setFehler(null);
    try {
      setSchritt("IFC aus Trimble Connect laden …");
      const bytes = await ladeTcDatei(api, modell.id, modell.versionId);
      setSchritt("Bauablauf lesen …");
      const r = leseBauablaufAusIfc(new TextDecoder("windows-1252").decode(bytes));

      // IFC-GUIDs → Runtime-IDs im geladenen Modell (Modell ggf. erst laden, Viewer braucht etwas Zeit)
      setSchritt("Bauteile im Modell zuordnen …");
      await ladeModellVersion(api, modell.id, modell.versionId);
      const guids = [...new Set([...r.bauteilGuids.values()].flat())];
      let rIds = new Map<string, number>();
      for (let versuch = 1; versuch <= 12 && guids.length > 0; versuch++) {
        rIds = await batchConvertToRuntimeIds(api, modell.id, guids);
        if (rIds.size > 0) break;
        setSchritt(`Bauteile im Modell zuordnen … (Versuch ${versuch + 1})`);
        await pause(5000);
      }
      if (guids.length > 0 && rIds.size === 0) throw new Error("Die Bauteile wurden im geladenen Modell nicht gefunden.");

      let bauteile = 0, nichtGefunden = 0;
      const tasks = r.tasks.map(t => {
        const objektGuids: string[] = [];
        for (const g of r.bauteilGuids.get(t.id) ?? []) {
          const id = rIds.get(g);
          if (id === undefined) { nichtGefunden++; continue; }
          objektGuids.push(`${modell.id}:::${id}`); bauteile++;
        }
        return { ...t, objektGuids };
      });
      onUebernehmen({ tasks, kalender: r.kalender, kraene: r.kraene, bericht: { tasks: tasks.length, bauteile, nichtGefunden } });
    } catch (e) {
      setFehler(e instanceof Error ? e.message : String(e));
      setSchritt(null);
    }
  }

  const laeuft = schritt !== null && !fehler;
  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,.4)", zIndex: 1000, display: "flex", alignItems: "center", justifyContent: "center" }}
      onClick={() => { if (!laeuft) onClose(); }}>
      <div style={{ background: "#fff", width: 440, maxWidth: "92vw", boxShadow: "0 8px 30px rgba(0,0,0,.25)", fontFamily: "var(--tc-font)" }}
        onClick={e => e.stopPropagation()}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "14px 18px", borderBottom: "1px solid var(--tc-border-light)" }}>
          <div style={{ fontSize: 16, fontWeight: 700, color: "var(--tc-text)" }}>Bauablauf im Modell gefunden</div>
          <button className="tc-btn-ghost" style={{ fontSize: 14, padding: "2px 8px" }} disabled={laeuft} onClick={onClose}>✕</button>
        </div>
        <div style={{ padding: "16px 18px" }}>
          <div style={{ fontSize: 12, color: "var(--tc-text-2)", lineHeight: 1.5, marginBottom: 12 }}>
            In <strong>{modell.name}</strong> ist ein Bauablauf hinterlegt (Vorgänge, Termine, Vorgänger und Bauteil-Zuordnungen).
            Soll daraus die Simulation <strong>{sim.name}</strong> erstellt werden — Tasks anlegen und Bauteile zuordnen?
          </div>
          {bestehend > 0 && (
            <div className="alert info" style={{ marginBottom: 12, fontSize: 11 }}>
              ⚠ Die Simulation hat bereits {bestehend} Task(s) — diese werden ersetzt.
            </div>
          )}
          {schritt && !fehler && <div style={{ fontSize: 11, color: "var(--tc-text-2)", marginBottom: 12 }}>⟳ {schritt}</div>}
          {fehler && <div style={{ fontSize: 11, color: "#c0392b", marginBottom: 12, lineHeight: 1.4 }}>{fehler}</div>}
          <div style={{ display: "flex", gap: 6 }}>
            <button className="tc-btn-primary" style={{ flex: 1 }} disabled={laeuft} onClick={uebernehmen}>
              Tasks erstellen und Bauteile zuordnen
            </button>
            <button className="tc-btn-secondary" disabled={laeuft} onClick={onClose}>Nein, nur Modell</button>
          </div>
        </div>
      </div>
    </div>
  );
}
