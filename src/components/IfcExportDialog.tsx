// IfcExportDialog.tsx — Fenster für den IFC-4D-Export (Optionen-Menü → Export → IFC 4D). Je Modell der
// Simulation wird die Original-IFC aus Trimble Connect geladen, um den Bauablauf ergänzt (siehe
// ifcExport.ts) und entweder
//  - als "<Modell>_4D.ifc" heruntergeladen ("Herunterladen"), oder
//  - direkt als neue Version derselben Datei in Trimble Connect hochgeladen ("In Connect übernehmen"):
//    danach wird die Simulation auf die neue Version umgestellt und ihre Bauteil-Zuordnungen über die
//    IFC-GUIDs auf die Runtime-IDs der neuen Version umgeschrieben.
// Ausgangsbasis ist immer die Version OHNE 4D-Daten (SimModell.vierD.basisVersionId), damit erneute
// Übernahmen den Bauablauf ersetzen statt ihn doppelt anzuhängen. IFC4/IFC2X3 wird automatisch erkannt.
import { useEffect, useRef, useState } from "react";
import type { SimModell, SimProjekt } from "../types";
import type { ApiInstance } from "../hooks/useApi";
import { batchConvertToObjectIds, batchConvertToRuntimeIds } from "../hooks/useApi";
import { ladeTcDatei, ladeTcVersionHoch, tcDateiInfo, warteAufVerarbeitung } from "../hooks/tcDateien";
import { erzeuge4dIfc } from "./ifcExport";
import type { IfcExportErgebnis } from "./ifcExport";

interface Props {
  sim: SimProjekt;
  updateSim: (s: SimProjekt) => void;
  api: ApiInstance | null;
  geladeneModelle: { id: string; name: string }[];
  benutzer?: string;
  readOnly?: boolean;
  onClose: () => void;
}

type Status =
  | { art: "bereit" }
  | { art: "laeuft"; schritt: string }
  | { art: "heruntergeladen"; erg: IfcExportErgebnis; dateiname: string }
  | { art: "uebernommen"; erg: IfcExportErgebnis; umgestellt: number; nichtGefunden: number }
  | { art: "fehler"; meldung: string };

function download(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = filename; a.click();
  URL.revokeObjectURL(url);
}

const pause = (ms: number) => new Promise(r => setTimeout(r, ms));

/** Version ohne 4D-Daten, auf der ein Export/eine Übernahme aufbauen soll */
function basisVersion(sm: SimModell | undefined): string | undefined {
  if (sm?.vierD && sm.versionId === sm.vierD.versionId) return sm.vierD.basisVersionId;
  return sm?.versionId;
}

export default function IfcExportDialog({ sim, updateSim, api, geladeneModelle, benutzer, readOnly, onClose }: Props) {
  // Während einer Übernahme (kann Minuten dauern) immer auf den neuesten Stand der Simulation schreiben
  const simRef = useRef(sim);
  useEffect(() => { simRef.current = sim; });

  // Modelle der Simulation + alle, auf die Tasks verweisen
  const modellIds = [...new Set([
    ...sim.modelle.map(m => m.id),
    ...sim.tasks.flatMap(t => t.objektGuids.filter(g => g.includes(":::")).map(g => g.slice(0, g.indexOf(":::")))),
  ])];
  const modellName = (id: string) => sim.modelle.find(m => m.id === id)?.name ?? geladeneModelle.find(m => m.id === id)?.name ?? id;
  const [status, setStatus] = useState<Record<string, Status>>({});
  const laeuft = Object.values(status).some(s => s.art === "laeuft");

  const setze = (id: string, s: Status) => setStatus(prev => ({ ...prev, [id]: s }));
  const schritt = (id: string, text: string) => setze(id, { art: "laeuft", schritt: text });

  /** Original-IFC laden und um die 4D-Daten ergänzen */
  async function erzeuge(api: ApiInstance, mid: string) {
    const aktuell = simRef.current;
    // 1. Runtime-IDs dieses Modells → IFC-GlobalIds
    schritt(mid, "Bauteil-GUIDs ermitteln …");
    const rIdsJeTask = new Map<string, number[]>();
    for (const t of aktuell.tasks) {
      const ids = t.objektGuids.filter(g => g.startsWith(`${mid}:::`)).map(g => Number(g.slice(mid.length + 3))).filter(n => !isNaN(n));
      if (ids.length) rIdsJeTask.set(t.id, ids);
    }
    const alleRIds = [...new Set([...rIdsJeTask.values()].flat())];
    const guidById = alleRIds.length ? await batchConvertToObjectIds(api, mid, alleRIds) : new Map<number, string>();
    if (alleRIds.length > 0 && guidById.size === 0) throw new Error("Keine IFC-GUIDs erhalten — bitte das Modell im Viewer laden und erneut versuchen.");
    const bauteilGuidsJeTask = new Map<string, string[]>();
    for (const [taskId, ids] of rIdsJeTask) bauteilGuidsJeTask.set(taskId, ids.map(i => guidById.get(i)).filter((g): g is string => !!g));

    // 2. Original-IFC (Version ohne 4D-Daten)
    schritt(mid, "IFC aus Trimble Connect laden …");
    const basis = basisVersion(aktuell.modelle.find(m => m.id === mid));
    const bytes = await ladeTcDatei(api, mid, basis);

    // 3. 4D-Daten erzeugen — windows-1252 bildet jedes Byte auf genau ein Zeichen ab, d.h. die
    //    Einfügeposition im Text ist zugleich die Byte-Position (Original-Bytes bleiben unangetastet)
    schritt(mid, "4D-Daten schreiben …");
    const text = new TextDecoder("windows-1252").decode(bytes);
    const erg = erzeuge4dIfc({
      ifcText: text, simId: aktuell.id, simName: aktuell.name, modellId: mid,
      tasks: aktuell.tasks, kalender: aktuell.kalender, kraene: aktuell.kraene, bauteilGuidsJeTask,
      meta: { erstelltAm: aktuell.erstelltAm, geaendertAm: aktuell.geaendertAm, geaendertVon: aktuell.geaendertVon, exportiertVon: benutzer, modellVersion: basis },
    });
    const blob = new Blob([bytes.slice(0, erg.einfuegePos), new TextEncoder().encode(erg.einfuegeText), bytes.slice(erg.einfuegePos)],
      { type: "application/x-step" });
    return { erg, blob, guidById, basis };
  }

  async function herunterladen(mid: string) {
    if (!api) { setze(mid, { art: "fehler", meldung: "Trimble-Connect-API nicht verbunden." }); return; }
    try {
      const { erg, blob } = await erzeuge(api, mid);
      const dateiname = `${modellName(mid).replace(/\.ifc$/i, "")}_4D.ifc`;
      download(blob, dateiname);
      setze(mid, { art: "heruntergeladen", erg, dateiname });
    } catch (e) {
      setze(mid, { art: "fehler", meldung: e instanceof Error ? e.message : String(e) });
    }
  }

  async function uebernehmen(mid: string) {
    if (!api) { setze(mid, { art: "fehler", meldung: "Trimble-Connect-API nicht verbunden." }); return; }
    try {
      // 0. Sicherheitsprüfung: keine neuere (fremde) Version in Connect überschreiben
      schritt(mid, "Datei in Trimble Connect prüfen …");
      const sm = simRef.current.modelle.find(m => m.id === mid);
      const ziel = await tcDateiInfo(api, mid);
      if (sm?.versionId && ziel.versionId && ziel.versionId !== sm.versionId) {
        throw new Error("In Trimble Connect gibt es eine neuere Version dieses Modells, die die Simulation noch nicht verwendet. "
          + "Bitte die Simulation zuerst auf die neueste Version umstellen — sonst würde die Übernahme deren Änderungen überschreiben.");
      }

      // 1. Datei mit 4D-Daten erzeugen und als neue Version hochladen
      const { erg, blob, guidById, basis } = await erzeuge(api, mid);
      schritt(mid, `Neue Version hochladen (${(blob.size / 1048576).toFixed(1)} MB) …`);
      const neu = await ladeTcVersionHoch(api, ziel, blob);
      if (!neu.versionId) throw new Error("Upload abgeschlossen, aber keine Versions-ID erhalten.");
      if (neu.id !== mid) {
        throw new Error(`Trimble Connect hat eine neue Datei statt einer neuen Version angelegt ("${neu.name}"). Die Simulation wurde nicht umgestellt.`);
      }

      // 2. Warten, bis Connect die Version verarbeitet hat, dann im Viewer laden
      await warteAufVerarbeitung(api, mid, neu.versionId, s => schritt(mid, `Trimble Connect verarbeitet die neue Version (${s}) … das kann einige Minuten dauern.`));
      schritt(mid, "Neue Version im Viewer laden …");
      const guids = [...new Set(guidById.values())];
      let neueIds = new Map<string, number>();
      for (let versuch = 0; versuch < 18 && (guids.length === 0 || neueIds.size === 0); versuch++) {
        try { await api.viewer.toggleModelVersion({ id: mid, versionId: neu.versionId }, true); } catch { /* noch nicht bereit */ }
        if (guids.length === 0) break;
        neueIds = await batchConvertToRuntimeIds(api, mid, guids);
        if (neueIds.size === 0) { schritt(mid, `Neue Version im Viewer laden … (Versuch ${versuch + 2})`); await pause(10000); }
      }
      if (guids.length > 0 && neueIds.size === 0) {
        throw new Error(`Die neue Version ist in Trimble Connect hochgeladen, konnte aber nicht im Viewer geladen werden. Die Simulation verwendet weiterhin die bisherige Version.`);
      }

      // 3. Simulation umstellen: Version pinnen + Bauteil-Zuordnungen auf die neuen Runtime-IDs
      let umgestellt = 0, nichtGefunden = 0;
      const aktuell = simRef.current;
      const tasks = aktuell.tasks.map(t => {
        if (!t.objektGuids.some(g => g.startsWith(`${mid}:::`))) return t;
        return {
          ...t, objektGuids: t.objektGuids.map(g => {
            if (!g.startsWith(`${mid}:::`)) return g;
            const ifcGuid = guidById.get(Number(g.slice(mid.length + 3)));
            const neuId = ifcGuid ? neueIds.get(ifcGuid) : undefined;
            if (neuId === undefined) { nichtGefunden++; return g; }
            umgestellt++;
            return `${mid}:::${neuId}`;
          }),
        };
      });
      const vierD = { versionId: neu.versionId, basisVersionId: basis ?? ziel.versionId, am: new Date().toISOString() };
      const modelle = aktuell.modelle.some(m => m.id === mid)
        ? aktuell.modelle.map(m => m.id === mid ? { ...m, versionId: neu.versionId, vierD } : m)
        : [...aktuell.modelle, { id: mid, name: modellName(mid), versionId: neu.versionId, vierD }];
      updateSim({ ...aktuell, tasks, modelle });
      setze(mid, { art: "uebernommen", erg, umgestellt, nichtGefunden });
    } catch (e) {
      setze(mid, { art: "fehler", meldung: e instanceof Error ? e.message : String(e) });
    }
  }

  const schliessen = () => { if (!laeuft) onClose(); };

  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,.4)", zIndex: 1000, display: "flex", alignItems: "center", justifyContent: "center" }}
      onClick={schliessen}>
      <div style={{ background: "#fff", width: 560, maxWidth: "92vw", maxHeight: "85vh", overflowY: "auto",
        boxShadow: "0 8px 30px rgba(0,0,0,.25)", fontFamily: "var(--tc-font)" }}
        onClick={e => e.stopPropagation()}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "14px 18px", borderBottom: "1px solid var(--tc-border-light)" }}>
          <div style={{ fontSize: 16, fontWeight: 700, color: "var(--tc-text)" }}>IFC 4D-Export</div>
          <button className="tc-btn-ghost" style={{ fontSize: 14, padding: "2px 8px" }} onClick={schliessen} disabled={laeuft}
            title={laeuft ? "Bitte warten, bis der Vorgang abgeschlossen ist" : undefined}>✕</button>
        </div>

        <div style={{ padding: "14px 18px" }}>
          <div style={{ fontSize: 11, color: "var(--tc-text-2)", lineHeight: 1.5, marginBottom: 12 }}>
            Ergänzt die Original-IFC je Modell um den Bauablauf dieser Simulation (Terminplan, Vorgänge, Termine,
            Vorgänger, Hierarchie, Bauteil-Zuordnung, Kalender) — Schema IFC4 oder IFC2X3 wird automatisch erkannt.
            Jedes zugeordnete Bauteil erhält zusätzlich das Property Set <b>Bauablauf</b>.
            <br /><b>In Connect übernehmen</b> lädt die Datei als neue Version des Modells hoch und stellt die
            Simulation darauf um. <b>Herunterladen</b> speichert sie als <b>…_4D.ifc</b>.
          </div>

          {modellIds.length === 0 && (
            <div style={{ fontSize: 11, color: "var(--tc-text-3)" }}>Diese Simulation hat noch keine Modelle bzw. Bauteile.</div>
          )}

          {modellIds.map(mid => {
            const s = status[mid] ?? { art: "bereit" };
            const name = modellName(mid);
            const istIfc = /\.ifc$/i.test(name);
            const vierD = sim.modelle.find(m => m.id === mid)?.vierD;
            return (
              <div key={mid} style={{ padding: "10px 0", borderBottom: "1px solid var(--tc-border-light)" }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 12, fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={name}>{name}</div>
                    {vierD && (
                      <div style={{ fontSize: 9, color: "var(--tc-text-3)" }}>
                        4D-Daten zuletzt übernommen am {new Date(vierD.am).toLocaleString("de-CH")}
                      </div>
                    )}
                  </div>
                  <button className="tc-btn-primary" style={{ fontSize: 10, padding: "4px 10px" }}
                    disabled={laeuft || !istIfc || readOnly} onClick={() => uebernehmen(mid)}
                    title={!istIfc ? "Nur für .ifc-Modelle möglich" : readOnly ? "Keine Bearbeitungsrechte für diese Simulation" : "Als neue Version in Trimble Connect hochladen und die Simulation darauf umstellen"}>
                    In Connect übernehmen
                  </button>
                  <button className="tc-btn-secondary" style={{ fontSize: 10, padding: "4px 10px" }}
                    disabled={laeuft || !istIfc} onClick={() => herunterladen(mid)}
                    title={istIfc ? "Als …_4D.ifc herunterladen" : "Nur für .ifc-Modelle möglich"}>
                    Herunterladen
                  </button>
                </div>
                {s.art === "laeuft" && <div style={{ fontSize: 11, color: "var(--tc-text-2)", marginTop: 6 }}>{s.schritt}</div>}
                {s.art === "fehler" && (
                  <div style={{ fontSize: 11, color: "#c0392b", marginTop: 6, lineHeight: 1.4 }}>{s.meldung}</div>
                )}
                {(s.art === "heruntergeladen" || s.art === "uebernommen") && (
                  <div style={{ fontSize: 11, color: "var(--tc-text-2)", marginTop: 6, lineHeight: 1.5 }}>
                    <div style={{ color: "#2e7d32", fontWeight: 600 }}>
                      {s.art === "heruntergeladen"
                        ? `✓ ${s.dateiname} heruntergeladen (${s.erg.schema})`
                        : `✓ Als neue Version in Trimble Connect übernommen (${s.erg.schema}) — Simulation umgestellt`}
                    </div>
                    {s.erg.anzahl.tasks} Vorgänge · {s.erg.anzahl.sequenzen} Vorgänger-Beziehungen · {s.erg.anzahl.verknuepfteBauteile} Bauteile verknüpft · {s.erg.anzahl.entitaeten} neue IFC-Entitäten
                    {s.art === "uebernommen" && s.nichtGefunden > 0 && (
                      <div style={{ color: "#b26a00" }}>⚠ {s.nichtGefunden} Bauteil-Zuordnung(en) in der neuen Version nicht gefunden — unverändert gelassen.</div>
                    )}
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
