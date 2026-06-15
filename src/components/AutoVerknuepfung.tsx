// AutoVerknuepfung.tsx — Automatische Bauteil-Task-Verknüpfung
import { useState } from "react";
import type { SimProjekt, Task } from "../types";
import type { ApiInstance } from "../hooks/useApi";
import { getModellObjekte } from "./modelHelpers";

interface Props {
  api: ApiInstance | null;
  sim: SimProjekt;
  onUpdate: (tasks: Task[]) => void;
}

export default function AutoVerknuepfung({ api, sim, onUpdate }: Props) {
  const [offen, setOffen] = useState(false);
  const [bestaetigen, setBestaetigen] = useState(false);
  const [gewaehlt, setGewaehlt] = useState<Set<string>>(new Set());
  const [laeuft, setLaeuft] = useState(false);
  const [fortschritt, setFortschritt] = useState("");
  const [ergebnis, setErgebnis] = useState<string | null>(null);

  // Verfügbare Extra-Spalten aus Tasks sammeln
  const alleSpalten = (() => {
    const set = new Set<string>();
    for (const t of sim.tasks) {
      if (t.extraSpalten) for (const k of Object.keys(t.extraSpalten)) set.add(k);
    }
    return [...set].sort();
  })();

  // Tasks die Extra-Spalten haben
  const tasksWithExtras = sim.tasks.filter(t => t.extraSpalten && Object.keys(t.extraSpalten).length > 0);

  if (sim.tasks.length === 0 || sim.modelle.length === 0) return null;
  if (alleSpalten.length === 0) return null; // Keine Extra-Spalten → kein Button

  function toggleSpalte(s: string) {
    const neu = new Set(gewaehlt);
    if (neu.has(s)) neu.delete(s); else if (neu.size < 6) neu.add(s);
    setGewaehlt(neu);
  }

  async function starten() {
    if (!api || gewaehlt.size === 0) return;
    setBestaetigen(false);
    setLaeuft(true);
    setErgebnis(null);

    const spalten = [...gewaehlt];
    const updatedTasks = [...sim.tasks];
    let totalVerknuepft = 0;
    let tasksMitTreffer = 0;

    try {
      // Für jedes Modell: alle Objekte + Properties laden
      for (const modell of sim.modelle) {
        if (!modell.id) continue;
        setFortschritt(`⟳ Modell ${modell.name} laden…`);
        const alleIds = await getModellObjekte(api, modell.id);
        if (alleIds.length === 0) continue;

        // Properties für alle Objekte laden und cachen
        setFortschritt(`⟳ ${alleIds.length} Objekte scannen…`);
        const objProps = new Map<number, Record<string, string>>(); // rId → { propKey: value }

        for (let i = 0; i < alleIds.length; i++) {
          const rId = alleIds[i];
          if (i % 50 === 0) setFortschritt(`⟳ Objekte scannen… ${i}/${alleIds.length}`);

          const props: Record<string, string> = {};
          try {
            const res = await api.viewer.getObjectProperties(modell.id, [rId]);
            if (Array.isArray(res) && res.length > 0) {
              const obj = res[0];
              // Flach alle Properties sammeln
              const sammel = (g: any, pn: string) => {
                for (const p of (g?.properties ?? (g as any)?.items ?? [])) {
                  if (!p?.name) continue;
                  const sub = (p as any).properties ?? (p as any).items;
                  if (Array.isArray(sub) && sub.length > 0) { sammel(p, p.name); continue; }
                  if (p.value != null) {
                    const v = String(p.value).trim();
                    if (v && v !== "null") {
                      props[p.name.toLowerCase()] = v;
                      props[`${pn}||${p.name}`.toLowerCase()] = v;
                    }
                  }
                }
              };
              for (const g of (obj?.properties ?? [])) sammel(g, g?.name || "");
              if (obj?.product?.name) props["product name"] = String(obj.product.name);
              if (obj?.product?.objectType) props["common type"] = String(obj.product.objectType);
              if (obj?.product?.objectType) props["objecttype"] = String(obj.product.objectType);
            }
          } catch {}

          // Layer
          try {
            const layers = await api.viewer.getLayers(modell.id) as any[];
            if (Array.isArray(layers)) {
              for (const l of layers) {
                if (l?.name && (l.objectRuntimeIds ?? []).includes(rId)) {
                  props["layer"] = String(l.name);
                  break;
                }
              }
            }
          } catch {}

          if (Object.keys(props).length > 0) objProps.set(rId, props);
        }

        // Für jeden Task: Matching
        for (let ti = 0; ti < updatedTasks.length; ti++) {
          const task = updatedTasks[ti];
          if (!task.extraSpalten) continue;

          setFortschritt(`⟳ Task ${ti + 1}/${updatedTasks.length}: „${task.name}"…`);

          // Werte für gewählte Spalten
          const kriterien: { spalte: string; wert: string }[] = [];
          for (const sp of spalten) {
            const wert = task.extraSpalten[sp];
            if (wert) kriterien.push({ spalte: sp.toLowerCase(), wert: wert.toLowerCase() });
          }
          if (kriterien.length === 0) continue;

          // Objekte matchen
          const treffer: string[] = [];
          for (const [rId, props] of objProps.entries()) {
            let allePasst = true;
            for (const k of kriterien) {
              // Suche in allen Property-Keys nach dem Spaltennamen
              let gefunden = false;
              for (const [propKey, propVal] of Object.entries(props)) {
                if (propKey.includes(k.spalte) && propVal.toLowerCase().includes(k.wert)) {
                  gefunden = true;
                  break;
                }
              }
              if (!gefunden) { allePasst = false; break; }
            }
            if (allePasst) treffer.push(`${modell.id}:::${rId}`);
          }

          if (treffer.length > 0) {
            // Zuweisen (exklusiv: aus anderen Tasks entfernen)
            const neuGuids = new Set([...task.objektGuids, ...treffer]);
            updatedTasks[ti] = { ...task, objektGuids: [...neuGuids] };
            // Aus anderen Tasks entfernen
            for (let oi = 0; oi < updatedTasks.length; oi++) {
              if (oi === ti) continue;
              updatedTasks[oi] = {
                ...updatedTasks[oi],
                objektGuids: updatedTasks[oi].objektGuids.filter(g => !treffer.includes(g))
              };
            }
            totalVerknuepft += treffer.length;
            tasksMitTreffer++;
          }
        }
      }

      onUpdate(updatedTasks);
      setErgebnis(`✓ ${totalVerknuepft} Bauteile automatisch verknüpft in ${tasksMitTreffer} Tasks`);
    } catch (e) {
      setErgebnis(`Fehler: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setLaeuft(false);
      setFortschritt("");
    }
  }

  return (
    <div style={{ marginTop: 6 }}>
      {!offen ? (
        <button className="tc-btn-primary" style={{ width: "100%", fontSize: 11 }}
          onClick={() => setOffen(true)}>
          🔗 Auto-Verknüpfung ({alleSpalten.length} Spalten verfügbar)
        </button>
      ) : (
        <div style={{ border: "1px solid var(--tc-border)", padding: 8, fontSize: 11 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
            <span style={{ fontWeight: 600, color: "var(--tc-text)" }}>Auto-Verknüpfung</span>
            <button style={{ background: "none", border: "none", cursor: "pointer", color: "#999", fontSize: 14 }}
              onClick={() => { setOffen(false); setBestaetigen(false); }}>✕</button>
          </div>

          <div style={{ color: "var(--tc-text-3)", marginBottom: 6, fontSize: 10 }}>
            Wähle bis zu 6 Spalten aus der Gantt-Datei. Objekte werden automatisch den Tasks zugewiesen wenn die Attributwerte übereinstimmen.
          </div>

          {/* Spalten-Auswahl */}
          <div style={{ display: "flex", flexWrap: "wrap", gap: 4, marginBottom: 8 }}>
            {alleSpalten.map(s => {
              const aktiv = gewaehlt.has(s);
              return (
                <button key={s} onClick={() => toggleSpalte(s)}
                  style={{
                    padding: "2px 8px", fontSize: 10, cursor: "pointer", fontFamily: "inherit",
                    background: aktiv ? "#2d7dbd" : "#fff", color: aktiv ? "#fff" : "#555",
                    border: `1px solid ${aktiv ? "#2d7dbd" : "#d4dce4"}`,
                  }}>
                  {aktiv ? "✓ " : ""}{s}
                </button>
              );
            })}
          </div>

          {/* Vorschau: wie viele Tasks haben Werte */}
          {gewaehlt.size > 0 && (
            <div style={{ fontSize: 10, color: "var(--tc-text-3)", marginBottom: 6 }}>
              {tasksWithExtras.filter(t => [...gewaehlt].every(s => t.extraSpalten?.[s])).length} von {sim.tasks.length} Tasks haben Werte für alle gewählten Spalten
            </div>
          )}

          {/* Bestätigung */}
          {bestaetigen && !laeuft && (
            <div style={{ background: "#FFF7ED", border: "1px solid #FB923C", padding: 8, marginBottom: 6 }}>
              <div style={{ fontWeight: 600, color: "#C2410C", marginBottom: 4 }}>
                ⚠ Auto-Verknüpfung starten?
              </div>
              <div style={{ fontSize: 10, color: "#9A3412", marginBottom: 6 }}>
                {sim.tasks.length} Tasks × {sim.modelle.length} Modell(e) werden durchsucht.
                Gewählte Spalten: {[...gewaehlt].join(", ")}.
                Bestehende Zuweisungen können überschrieben werden.
              </div>
              <div style={{ display: "flex", gap: 6 }}>
                <button className="tc-btn-primary" style={{ flex: 1, fontSize: 10, background: "#2d7dbd" }}
                  onClick={starten}>Ja, starten</button>
                <button className="tc-btn-ghost" style={{ flex: 1, fontSize: 10 }}
                  onClick={() => setBestaetigen(false)}>Abbrechen</button>
              </div>
            </div>
          )}

          {/* Fortschritt */}
          {laeuft && (
            <div className="alert info" style={{ marginBottom: 6 }}>
              {fortschritt || "⟳ Wird verarbeitet…"}
            </div>
          )}

          {/* Ergebnis */}
          {ergebnis && (
            <div className={`alert ${ergebnis.startsWith("✓") ? "ok" : "err"}`} style={{ marginBottom: 6 }}>
              {ergebnis}
            </div>
          )}

          {/* Start-Button */}
          {!bestaetigen && !laeuft && (
            <button className="tc-btn-green" style={{ width: "100%", fontSize: 11 }}
              disabled={gewaehlt.size === 0}
              onClick={() => setBestaetigen(true)}>
              🔗 Verknüpfung starten ({gewaehlt.size} Spalte{gewaehlt.size !== 1 ? "n" : ""})
            </button>
          )}
        </div>
      )}
    </div>
  );
}
