// KranVerfuegbarkeitManager.tsx — Dialog in Tab AVOR: Kräne anlegen und ihre Verfügbarkeit (von/bis)
// pflegen, dargestellt als Matrix Kran × Zeitraum (Monat/Woche). Fundament für Etappe 2-4 (Kran-
// Zuweisung, Kranoptik, Kapazitäts-Check) — hier nur Stammdaten, keine Auswertung.
import { useState } from "react";
import type { SimProjekt, Kran, Zeitraster } from "../types";
import { LEERER_KALENDER } from "./kalenderHelpers";
import { zeitrasterBuckets, kranAktivInBucket, neuerKran, kranAusTasksEntfernen } from "./kranHelpers";

interface Props { sim: SimProjekt; updateSim: (s: SimProjekt) => void; readOnly?: boolean; onClose: () => void; }

export default function KranVerfuegbarkeitManager({ sim, updateSim, readOnly, onClose }: Props) {
  const kraene = sim.kraene ?? [];
  const raster: Zeitraster = sim.zeitraster ?? "monat";
  const kalender = sim.kalender ?? LEERER_KALENDER;
  void kalender; // reserviert für Etappe 3 (Kranoptik) — Matrix selbst braucht keinen Kalender
  const [umbenennenId, setUmbenennenId] = useState<string | null>(null);

  function speichern(neueKraene: Kran[]) {
    updateSim({ ...sim, kraene: neueKraene });
  }

  function kranHinzufuegen() {
    speichern([...kraene, neuerKran(kraene)]);
  }

  function kranAendern(id: string, patch: Partial<Kran>) {
    speichern(kraene.map(k => k.id === id ? { ...k, ...patch } : k));
  }

  function kranEntfernen(id: string) {
    const zugeordnet = sim.tasks.filter(t => t.kraene?.includes(id)).length;
    if (zugeordnet > 0 && !confirm(`Dieser Kran ist ${zugeordnet} Task${zugeordnet === 1 ? "" : "s"} zugeordnet — die Zuordnung wird dort ebenfalls entfernt. Fortfahren?`)) return;
    updateSim({ ...sim, kraene: kraene.filter(k => k.id !== id), tasks: kranAusTasksEntfernen(sim.tasks, id) });
  }

  // Klick in eine Matrixzelle: erster Klick setzt "von" (Bereich offen bis Projektende), ein zweiter
  // Klick auf/nach dieser Spalte setzt "bis". Ein Klick VOR dem gesetzten "von" bzw. auf einen bereits
  // vollständigen Bereich startet neu — kein Lochraster, siehe Kran in types.ts.
  function zelleKlick(kran: Kran, bucket: { start: string; end: string }) {
    if (kran.verfuegbarVon && !kran.verfuegbarBis && bucket.start >= kran.verfuegbarVon) {
      kranAendern(kran.id, { verfuegbarBis: bucket.end });
    } else {
      kranAendern(kran.id, { verfuegbarVon: bucket.start, verfuegbarBis: undefined });
    }
  }

  const buckets = zeitrasterBuckets(sim.tasks, raster);

  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,.4)", zIndex: 1000, display: "flex", alignItems: "center", justifyContent: "center" }}
      onClick={onClose}>
      <div style={{ background: "#fff", width: 820, maxWidth: "94vw", maxHeight: "88vh", overflowY: "auto",
        boxShadow: "0 8px 30px rgba(0,0,0,.25)", fontFamily: "var(--tc-font)" }}
        onClick={e => e.stopPropagation()}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "14px 18px", borderBottom: "1px solid var(--tc-border-light)" }}>
          <div style={{ fontSize: 16, fontWeight: 700, color: "var(--tc-text)" }}>Kran-Verfügbarkeit</div>
          <button className="tc-btn-ghost" style={{ fontSize: 14, padding: "2px 8px" }} onClick={onClose}>✕</button>
        </div>

        <div style={{ padding: "14px 18px" }}>
          <div style={{ fontSize: 11, color: "var(--tc-text-2)", lineHeight: 1.5, marginBottom: 12 }}>
            Kräne anlegen und den Zeitraum festlegen, in dem sie auf der Baustelle verfügbar sind — Grundlage
            für Kranoptik und Kapazitäts-Check. Richtwert zur Plausibilisierung, keine exakte Einsatzplanung.
            Kein von/bis gesetzt = durchgehend verfügbar.
          </div>

          <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 14, fontSize: 11 }}>
            <span style={{ fontWeight: 600, color: "var(--tc-text-2)" }}>Zeitraster:</span>
            {(["monat", "woche"] as const).map(r => (
              <button key={r} disabled={readOnly} onClick={() => updateSim({ ...sim, zeitraster: r })}
                style={{ fontSize: 11, fontWeight: 600, padding: "4px 9px", cursor: readOnly ? "default" : "pointer",
                  border: `1px solid ${raster === r ? "var(--tc-blue)" : "var(--tc-border)"}`,
                  background: raster === r ? "var(--tc-blue-bg)" : "#fff", color: raster === r ? "var(--tc-blue)" : "var(--tc-text-2)" }}>
                {r === "monat" ? "Monat" : "Woche"}
              </button>
            ))}
          </div>

          {kraene.length === 0 && (
            <div style={{ fontSize: 11, color: "var(--tc-text-3)", marginBottom: 10 }}>Noch keine Kräne angelegt.</div>
          )}

          {kraene.map(kran => (
            <div key={kran.id} style={{ border: "1px solid var(--tc-border-light)", marginBottom: 10, padding: "10px 12px" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", marginBottom: 8 }}>
                {umbenennenId === kran.id ? (
                  <input type="text" autoFocus disabled={readOnly} value={kran.name}
                    onChange={e => kranAendern(kran.id, { name: e.target.value })}
                    onBlur={() => setUmbenennenId(null)}
                    onKeyDown={e => e.key === "Enter" && setUmbenennenId(null)}
                    style={{ width: 120, fontSize: 12, fontWeight: 600, padding: "3px 5px", border: "1px solid #d4dce4", fontFamily: "inherit" }} />
                ) : (
                  <span onClick={() => !readOnly && setUmbenennenId(kran.id)}
                    title={readOnly ? undefined : "Klicken zum Umbenennen"}
                    style={{ width: 120, fontSize: 12, fontWeight: 600, color: "var(--tc-text)", cursor: readOnly ? "default" : "pointer" }}>
                    {kran.name}
                  </span>
                )}

                <label style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 11, color: "var(--tc-text-2)" }}>
                  von
                  <input type="date" disabled={readOnly} value={kran.verfuegbarVon ?? ""}
                    onChange={e => kranAendern(kran.id, { verfuegbarVon: e.target.value || undefined })}
                    style={{ fontSize: 11, padding: "3px 5px", border: "1px solid #d4dce4", fontFamily: "inherit" }} />
                </label>
                <label style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 11, color: "var(--tc-text-2)" }}>
                  bis
                  <input type="date" disabled={readOnly} value={kran.verfuegbarBis ?? ""}
                    onChange={e => kranAendern(kran.id, { verfuegbarBis: e.target.value || undefined })}
                    style={{ fontSize: 11, padding: "3px 5px", border: "1px solid #d4dce4", fontFamily: "inherit" }} />
                </label>

                {!readOnly && (
                  <button className="tc-btn-ghost" style={{ fontSize: 11, padding: "2px 6px", marginLeft: "auto" }} onClick={() => kranEntfernen(kran.id)}>
                    Entfernen
                  </button>
                )}
              </div>

              {buckets.length === 0 ? (
                <div style={{ fontSize: 11, color: "var(--tc-text-3)" }}>
                  Noch keine Tasks mit Terminen im Bauablauf — Matrix erscheint, sobald der Projektzeitraum bekannt ist. Von/bis oben funktioniert bereits.
                </div>
              ) : (
                <div style={{ display: "flex", gap: 2, overflowX: "auto", paddingBottom: 2 }}>
                  {buckets.map(b => {
                    const aktiv = kranAktivInBucket(kran, b);
                    return (
                      <div key={b.key} onClick={() => !readOnly && zelleKlick(kran, b)}
                        title={`${b.label}${readOnly ? "" : " — klicken zum Setzen von/bis"}`}
                        style={{ minWidth: 30, textAlign: "center", fontSize: 9, padding: "3px 2px", userSelect: "none",
                          cursor: readOnly ? "default" : "pointer",
                          background: aktiv ? "var(--tc-blue)" : "#eef1f4", color: aktiv ? "#fff" : "var(--tc-text-3)",
                          fontWeight: aktiv ? 600 : 400 }}>
                        {b.label}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          ))}

          {!readOnly && (
            <button className="tc-btn-secondary" style={{ fontSize: 11, padding: "5px 10px", marginTop: 4 }} onClick={kranHinzufuegen}>
              + Kran hinzufügen
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
