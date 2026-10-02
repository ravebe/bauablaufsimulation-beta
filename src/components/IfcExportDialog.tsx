// IfcExportDialog.tsx — Fenster für den IFC-4D-Export (Optionen-Menü → Export → IFC 4D). Je Modell der
// Simulation wird die Original-IFC aus Trimble Connect geladen (oder manuell gewählt), um den Bauablauf
// ergänzt (siehe ifcExport.ts) und als "<Modell>_4D.ifc" heruntergeladen. IFC4/IFC2X3 wird automatisch
// erkannt.
import { useRef, useState } from "react";
import type { SimProjekt } from "../types";
import type { ApiInstance } from "../hooks/useApi";
import { batchConvertToObjectIds } from "../hooks/useApi";
import { ladeTcDatei } from "../hooks/tcDateien";
import { erzeuge4dIfc } from "./ifcExport";
import type { IfcExportErgebnis } from "./ifcExport";

interface Props { sim: SimProjekt; api: ApiInstance | null; geladeneModelle: { id: string; name: string }[]; onClose: () => void; }

type Status =
  | { art: "bereit" }
  | { art: "laeuft"; schritt: string }
  | { art: "fertig"; erg: IfcExportErgebnis; dateiname: string }
  | { art: "fehler"; meldung: string };

function download(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = filename; a.click();
  URL.revokeObjectURL(url);
}

export default function IfcExportDialog({ sim, api, geladeneModelle, onClose }: Props) {
  // Modelle der Simulation + alle, auf die Tasks verweisen
  const modellIds = [...new Set([
    ...sim.modelle.map(m => m.id),
    ...sim.tasks.flatMap(t => t.objektGuids.filter(g => g.includes(":::")).map(g => g.slice(0, g.indexOf(":::")))),
  ])];
  const modellName = (id: string) => sim.modelle.find(m => m.id === id)?.name ?? geladeneModelle.find(m => m.id === id)?.name ?? id;
  const [status, setStatus] = useState<Record<string, Status>>({});
  const dateiInputs = useRef<Record<string, HTMLInputElement | null>>({});

  const setze = (id: string, s: Status) => setStatus(prev => ({ ...prev, [id]: s }));

  async function exportieren(mid: string, dateiBytes?: Uint8Array<ArrayBuffer>) {
    if (!api) { setze(mid, { art: "fehler", meldung: "Trimble-Connect-API nicht verbunden." }); return; }
    try {
      // 1. Runtime-IDs dieses Modells → IFC-GlobalIds
      setze(mid, { art: "laeuft", schritt: "Bauteil-GUIDs ermitteln …" });
      const rIdsJeTask = new Map<string, number[]>();
      for (const t of sim.tasks) {
        const ids = t.objektGuids.filter(g => g.startsWith(`${mid}:::`)).map(g => Number(g.slice(mid.length + 3))).filter(n => !isNaN(n));
        if (ids.length) rIdsJeTask.set(t.id, ids);
      }
      const alleRIds = [...new Set([...rIdsJeTask.values()].flat())];
      const guidById = alleRIds.length ? await batchConvertToObjectIds(api, mid, alleRIds) : new Map<number, string>();
      if (alleRIds.length > 0 && guidById.size === 0) throw new Error("Keine IFC-GUIDs erhalten — bitte das Modell im Viewer laden und erneut versuchen.");
      const bauteilGuidsJeTask = new Map<string, string[]>();
      for (const [taskId, ids] of rIdsJeTask) bauteilGuidsJeTask.set(taskId, ids.map(i => guidById.get(i)).filter((g): g is string => !!g));

      // 2. Original-IFC
      setze(mid, { art: "laeuft", schritt: dateiBytes ? "Datei lesen …" : "IFC aus Trimble Connect laden …" });
      const versionId = sim.modelle.find(m => m.id === mid)?.versionId;
      const bytes = dateiBytes ?? await ladeTcDatei(api, mid, versionId);

      // 3. 4D-Daten erzeugen — windows-1252 bildet jedes Byte auf genau ein Zeichen ab, d.h. die
      //    Einfügeposition im Text ist zugleich die Byte-Position (Original-Bytes bleiben unangetastet)
      setze(mid, { art: "laeuft", schritt: "4D-Daten schreiben …" });
      const text = new TextDecoder("windows-1252").decode(bytes);
      const erg = erzeuge4dIfc({
        ifcText: text, simId: sim.id, simName: sim.name, modellId: mid,
        tasks: sim.tasks, kalender: sim.kalender, kraene: sim.kraene, bauteilGuidsJeTask,
      });
      const blob = new Blob([bytes.slice(0, erg.einfuegePos), new TextEncoder().encode(erg.einfuegeText), bytes.slice(erg.einfuegePos)],
        { type: "application/x-step" });
      const dateiname = `${modellName(mid).replace(/\.ifc$/i, "")}_4D.ifc`;
      download(blob, dateiname);
      setze(mid, { art: "fertig", erg, dateiname });
    } catch (e) {
      setze(mid, { art: "fehler", meldung: e instanceof Error ? e.message : String(e) });
    }
  }

  async function dateiGewaehlt(mid: string, datei: File | undefined) {
    if (!datei) return;
    await exportieren(mid, new Uint8Array(await datei.arrayBuffer()));
  }

  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,.4)", zIndex: 1000, display: "flex", alignItems: "center", justifyContent: "center" }}
      onClick={onClose}>
      <div style={{ background: "#fff", width: 520, maxWidth: "92vw", maxHeight: "85vh", overflowY: "auto",
        boxShadow: "0 8px 30px rgba(0,0,0,.25)", fontFamily: "var(--tc-font)" }}
        onClick={e => e.stopPropagation()}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "14px 18px", borderBottom: "1px solid var(--tc-border-light)" }}>
          <div style={{ fontSize: 16, fontWeight: 700, color: "var(--tc-text)" }}>IFC 4D-Export</div>
          <button className="tc-btn-ghost" style={{ fontSize: 14, padding: "2px 8px" }} onClick={onClose}>✕</button>
        </div>

        <div style={{ padding: "14px 18px" }}>
          <div style={{ fontSize: 11, color: "var(--tc-text-2)", lineHeight: 1.5, marginBottom: 12 }}>
            Ergänzt die Original-IFC je Modell um den Bauablauf dieser Simulation (Terminplan, Vorgänge, Termine,
            Vorgänger, Hierarchie, Bauteil-Zuordnung, Kalender) und lädt sie als <b>…_4D.ifc</b> herunter. Das
            Schema (IFC4 oder IFC2X3) wird automatisch erkannt. Zusätzlich erhält jedes zugeordnete Bauteil das
            Property Set <b>Bauablauf</b>, das auch in Trimble Connect unter den Eigenschaften sichtbar ist.
          </div>

          {modellIds.length === 0 && (
            <div style={{ fontSize: 11, color: "var(--tc-text-3)" }}>Diese Simulation hat noch keine Modelle bzw. Bauteile.</div>
          )}

          {modellIds.map(mid => {
            const s = status[mid] ?? { art: "bereit" };
            const name = modellName(mid);
            const istIfc = /\.ifc$/i.test(name);
            return (
              <div key={mid} style={{ padding: "10px 0", borderBottom: "1px solid var(--tc-border-light)" }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <div style={{ flex: 1, minWidth: 0, fontSize: 12, fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={name}>{name}</div>
                  <button className="tc-btn-primary" style={{ fontSize: 10, padding: "4px 10px" }}
                    disabled={s.art === "laeuft" || !istIfc} onClick={() => exportieren(mid)}
                    title={istIfc ? "Original-IFC aus Trimble Connect laden und exportieren" : "Kein .ifc-Modell — bitte IFC-Datei manuell wählen"}>
                    Exportieren
                  </button>
                  <button className="tc-btn-secondary" style={{ fontSize: 10, padding: "4px 10px" }}
                    disabled={s.art === "laeuft"} onClick={() => dateiInputs.current[mid]?.click()}
                    title="Die IFC-Datei dieses Modells von der Festplatte wählen">
                    Datei wählen …
                  </button>
                  <input type="file" accept=".ifc" style={{ display: "none" }} ref={el => { dateiInputs.current[mid] = el; }}
                    onChange={e => { dateiGewaehlt(mid, e.target.files?.[0]); e.target.value = ""; }} />
                </div>
                {s.art === "laeuft" && <div style={{ fontSize: 11, color: "var(--tc-text-2)", marginTop: 6 }}>{s.schritt}</div>}
                {s.art === "fehler" && (
                  <div style={{ fontSize: 11, color: "#c0392b", marginTop: 6, lineHeight: 1.4 }}>
                    {s.meldung}<br />Alternativ die IFC-Datei über „Datei wählen …“ manuell auswählen.
                  </div>
                )}
                {s.art === "fertig" && (
                  <div style={{ fontSize: 11, color: "var(--tc-text-2)", marginTop: 6, lineHeight: 1.5 }}>
                    <div style={{ color: "#2e7d32", fontWeight: 600 }}>✓ {s.dateiname} heruntergeladen ({s.erg.schema})</div>
                    {s.erg.anzahl.tasks} Vorgänge · {s.erg.anzahl.sequenzen} Vorgänger-Beziehungen · {s.erg.anzahl.verknuepfteBauteile} Bauteile verknüpft · {s.erg.anzahl.entitaeten} neue IFC-Entitäten
                    {s.erg.hinweise.map((h, i) => <div key={i} style={{ color: "#b26a00" }}>⚠ {h}</div>)}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
