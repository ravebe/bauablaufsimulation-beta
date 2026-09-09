// KapazitaetsCheckManager.tsx — Checkfenster in Tab AVOR: prüft pro Bauphase (= Kranbereich, siehe
// Task.kranbereich), ob ein frei eingegebenes Personal-/Kran-Budget den aus Menge × Leistungswert
// ermittelten Bedarf deckt. Zwei Modi: "gantt" nutzt die echten Task-Termine je Kranbereich,
// "sandbox" eine unabhängig eingegebene Zieldauer je Phase — z.B. um vor der Grobterminierung zu
// testen, ob eine Personal-/Kranstrategie überhaupt aufgehen kann.
import { useState } from "react";
import type { SimProjekt, KapazitaetsCheck, KapazitaetsPhase } from "../types";
import { LEERE_STAMMDATEN } from "./stammdatenHelpers";
import { LEERER_KALENDER } from "./kalenderHelpers";
import {
  personenstundenBedarfProKranbereich, zeitraumProKranbereich, kranSpitzenbedarfProKranbereich,
  kranpflichtigeTaskAnzahlProKranbereich, auswertungPhase, arbeitstageGanttModus,
} from "./kapazitaetsCheckHelpers";

interface Props { sim: SimProjekt; updateSim: (s: SimProjekt) => void; readOnly?: boolean; onClose: () => void; }

const LEERER_CHECK: KapazitaetsCheck = { modus: "gantt", phasen: [] };

function fmt(n: number): string {
  return n.toLocaleString("de-CH", { maximumFractionDigits: 0 });
}

export default function KapazitaetsCheckManager({ sim, updateSim, readOnly, onClose }: Props) {
  const kc = sim.kapazitaetsCheck ?? LEERER_CHECK;
  const stammdaten = sim.stammdaten ?? LEERE_STAMMDATEN;
  const kalender = sim.kalender ?? LEERER_KALENDER;
  const [neuerBereichIdx, setNeuerBereichIdx] = useState<number | null>(null);

  function speichern(neu: KapazitaetsCheck) {
    updateSim({ ...sim, kapazitaetsCheck: neu });
  }

  function phaseAendern(idx: number, patch: Partial<KapazitaetsPhase>) {
    speichern({ ...kc, phasen: kc.phasen.map((p, i) => i === idx ? { ...p, ...patch } : p) });
  }

  function phaseHinzufuegen() {
    const neu: KapazitaetsPhase = {
      id: crypto.randomUUID(), kranbereich: "", anzahlPersonen: 0, anzahlKraene: 1,
      dauerTageSandbox: kc.modus === "sandbox" ? 10 : undefined,
    };
    speichern({ ...kc, phasen: [...kc.phasen, neu] });
  }

  function phaseEntfernen(idx: number) {
    speichern({ ...kc, phasen: kc.phasen.filter((_, i) => i !== idx) });
  }

  const bereichOptionen = [...new Set(sim.tasks.map(t => t.kranbereich?.trim()).filter((b): b is string => !!b))].sort();
  const bedarfMap = personenstundenBedarfProKranbereich(sim.tasks, stammdaten);
  const zeitraeume = zeitraumProKranbereich(sim.tasks);
  const kranSpitzenMap = kranSpitzenbedarfProKranbereich(sim.tasks, stammdaten, kalender);
  const kranAnzahlMap = kranpflichtigeTaskAnzahlProKranbereich(sim.tasks, stammdaten);

  const summeSandboxDauer = kc.phasen.reduce((s, p) => s + (p.dauerTageSandbox ?? 0), 0);
  const gesamtDauerAbweichend = kc.modus === "sandbox" && !!kc.gesamtDauerTageSandbox && kc.phasen.length > 0
    && summeSandboxDauer !== kc.gesamtDauerTageSandbox;

  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,.4)", zIndex: 1000, display: "flex", alignItems: "center", justifyContent: "center" }}
      onClick={onClose}>
      <div style={{ background: "#fff", width: 720, maxWidth: "94vw", maxHeight: "88vh", overflowY: "auto",
        boxShadow: "0 8px 30px rgba(0,0,0,.25)", fontFamily: "var(--tc-font)" }}
        onClick={e => e.stopPropagation()}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "14px 18px", borderBottom: "1px solid var(--tc-border-light)" }}>
          <div style={{ fontSize: 16, fontWeight: 700, color: "var(--tc-text)" }}>Kapazitäts-Check</div>
          <button className="tc-btn-ghost" style={{ fontSize: 14, padding: "2px 8px" }} onClick={onClose}>✕</button>
        </div>

        <div style={{ padding: "14px 18px" }}>
          <div style={{ fontSize: 11, color: "var(--tc-text-2)", lineHeight: 1.5, marginBottom: 12 }}>
            Prüft je Bauphase (= Kranbereich, siehe Feld "Kranbereich" in Tab Kalkulation), ob Personal und
            Kräne reichen, um das mit Menge × Leistungswert hinterlegte Arbeitsvolumen in der verfügbaren
            Zeit zu schaffen — entweder anhand der echten Gantt-Termine oder als unabhängiges Testszenario.
          </div>

          <div style={{ display: "flex", gap: 6, marginBottom: 12 }}>
            <button disabled={readOnly} onClick={() => speichern({ ...kc, modus: "gantt" })}
              style={{ fontSize: 11, fontWeight: 600, padding: "5px 10px", cursor: readOnly ? "default" : "pointer",
                border: `1px solid ${kc.modus === "gantt" ? "var(--tc-blue)" : "var(--tc-border)"}`,
                background: kc.modus === "gantt" ? "var(--tc-blue-bg)" : "#fff", color: kc.modus === "gantt" ? "var(--tc-blue)" : "var(--tc-text-2)" }}>
              Echter Gantt-Zeitraum
            </button>
            <button disabled={readOnly} onClick={() => speichern({ ...kc, modus: "sandbox" })}
              style={{ fontSize: 11, fontWeight: 600, padding: "5px 10px", cursor: readOnly ? "default" : "pointer",
                border: `1px solid ${kc.modus === "sandbox" ? "var(--tc-blue)" : "var(--tc-border)"}`,
                background: kc.modus === "sandbox" ? "var(--tc-blue-bg)" : "#fff", color: kc.modus === "sandbox" ? "var(--tc-blue)" : "var(--tc-text-2)" }}>
              Sandbox-Szenario
            </button>
          </div>

          {kc.modus === "sandbox" && (
            <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 14, fontSize: 11 }}>
              <span style={{ fontWeight: 600, color: "var(--tc-text-2)" }}>Gewünschte Gesamtdauer (Arbeitstage):</span>
              <input type="number" className="no-spinner" disabled={readOnly} value={kc.gesamtDauerTageSandbox ?? ""} placeholder="—"
                onChange={e => speichern({ ...kc, gesamtDauerTageSandbox: e.target.value === "" ? undefined : Number(e.target.value) })}
                style={{ width: 70, fontSize: 11, padding: "3px 5px", border: "1px solid #d4dce4", fontFamily: "inherit" }} />
              {gesamtDauerAbweichend && (
                <span style={{ color: "var(--tc-red)" }}>
                  Summe der Phasendauern ({fmt(summeSandboxDauer)}d) weicht von der Gesamtdauer ab
                </span>
              )}
            </div>
          )}

          {kc.phasen.length === 0 && (
            <div style={{ fontSize: 11, color: "var(--tc-text-3)", marginBottom: 8 }}>Noch keine Phasen eingetragen</div>
          )}

          {kc.phasen.map((phase, idx) => {
            const bedarf = bedarfMap.get(phase.kranbereich) ?? 0;
            const arbeitstage = kc.modus === "gantt"
              ? arbeitstageGanttModus(phase.kranbereich, zeitraeume, kalender)
              : (phase.dauerTageSandbox ?? 0);
            const auswertung = auswertungPhase(phase.anzahlPersonen, bedarf, stammdaten.arbeitszeitStdProTag, arbeitstage);
            const keineTasks = bedarf === 0 && arbeitstage === 0;
            const zeitraum = zeitraeume.get(phase.kranbereich);
            const kranSpitze = kranSpitzenMap.get(phase.kranbereich) ?? 0;
            const kranAnzahl = kranAnzahlMap.get(phase.kranbereich) ?? 0;
            const kranOk = kc.modus === "gantt" ? kranSpitze <= phase.anzahlKraene : true;

            return (
              <div key={phase.id} style={{ border: "1px solid var(--tc-border-light)", marginBottom: 10, padding: "10px 12px" }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", marginBottom: 8 }}>
                  {neuerBereichIdx === idx || (phase.kranbereich !== "" && !bereichOptionen.includes(phase.kranbereich)) ? (
                    <input type="text" disabled={readOnly} placeholder="Kranbereich / Phasenname" value={phase.kranbereich}
                      onChange={e => phaseAendern(idx, { kranbereich: e.target.value })}
                      onBlur={() => setNeuerBereichIdx(null)}
                      style={{ width: 160, fontSize: 12, fontWeight: 600, padding: "3px 5px", border: "1px solid #d4dce4", fontFamily: "inherit" }} />
                  ) : (
                    <select disabled={readOnly} value={phase.kranbereich}
                      onChange={e => e.target.value === "__neu__" ? setNeuerBereichIdx(idx) : phaseAendern(idx, { kranbereich: e.target.value })}
                      style={{ width: 160, fontSize: 12, fontWeight: 600, padding: "3px 5px", border: "1px solid #d4dce4", fontFamily: "inherit" }}>
                      <option value="">– Kranbereich wählen –</option>
                      {bereichOptionen.map(b => <option key={b} value={b}>{b}</option>)}
                      <option value="__neu__">+ neuer Kranbereich…</option>
                    </select>
                  )}

                  <label style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 11, color: "var(--tc-text-2)" }}>
                    Personen
                    <input type="number" className="no-spinner" disabled={readOnly} value={phase.anzahlPersonen || ""} placeholder="0"
                      onChange={e => phaseAendern(idx, { anzahlPersonen: e.target.value === "" ? 0 : Number(e.target.value) })}
                      style={{ width: 55, fontSize: 12, padding: "3px 5px", border: "1px solid #d4dce4", fontFamily: "inherit" }} />
                  </label>

                  <label style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 11, color: "var(--tc-text-2)" }}>
                    Kräne
                    <input type="number" className="no-spinner" disabled={readOnly} value={phase.anzahlKraene || ""} placeholder="0"
                      onChange={e => phaseAendern(idx, { anzahlKraene: e.target.value === "" ? 0 : Number(e.target.value) })}
                      style={{ width: 45, fontSize: 12, padding: "3px 5px", border: "1px solid #d4dce4", fontFamily: "inherit" }} />
                  </label>

                  {kc.modus === "sandbox" && (
                    <label style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 11, color: "var(--tc-text-2)" }}>
                      Dauer (Tage)
                      <input type="number" className="no-spinner" disabled={readOnly} value={phase.dauerTageSandbox ?? ""} placeholder="0"
                        onChange={e => phaseAendern(idx, { dauerTageSandbox: e.target.value === "" ? undefined : Number(e.target.value) })}
                        style={{ width: 55, fontSize: 12, padding: "3px 5px", border: "1px solid #d4dce4", fontFamily: "inherit" }} />
                    </label>
                  )}

                  {!readOnly && (
                    <button className="tc-btn-ghost" style={{ fontSize: 11, padding: "2px 6px", marginLeft: "auto" }} onClick={() => phaseEntfernen(idx)}>
                      Entfernen
                    </button>
                  )}
                </div>

                {!phase.kranbereich ? (
                  <div style={{ fontSize: 11, color: "var(--tc-text-3)" }}>Kranbereich wählen, um Bedarf/Angebot zu sehen.</div>
                ) : keineTasks ? (
                  <div style={{ fontSize: 11, color: "var(--tc-text-3)" }}>
                    Keine Tasks mit diesem Kranbereich {kc.modus === "gantt" ? "oder keine Dauer eingetragen" : "— trage eine Dauer ein, um den Bedarf zu prüfen"}.
                  </div>
                ) : (
                  <div style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: 11 }}>
                    <div style={{ display: "flex", gap: 14, flexWrap: "wrap", color: "var(--tc-text-2)" }}>
                      <span>Arbeitstage: <strong>{fmt(arbeitstage)}</strong>{kc.modus === "gantt" && zeitraum ? ` (${zeitraum.start} – ${zeitraum.end})` : ""}</span>
                      <span>Bedarf: <strong>{fmt(auswertung.bedarfPersonenstunden)} Pstd.</strong></span>
                      <span>Angebot: <strong>{fmt(auswertung.angebotPersonenstunden)} Pstd.</strong></span>
                    </div>
                    <div style={{ color: auswertung.deckung === "ok" ? "var(--tc-green-dark)" : "var(--tc-red)", fontWeight: 600 }}>
                      {auswertung.deckung === "ok"
                        ? "✓ Personal reicht"
                        : `✗ Personal reicht nicht — es fehlen ca. ${auswertung.fehlendePersonen} Person${auswertung.fehlendePersonen === 1 ? "" : "en"}`}
                    </div>
                    {kc.modus === "gantt" ? (
                      <div style={{ color: kranOk ? "var(--tc-green-dark)" : "var(--tc-red)", fontWeight: 600 }}>
                        {kranOk
                          ? `✓ Kräne reichen (Spitzenbedarf ${fmt(kranSpitze)} gleichzeitig aktive kranpflichtige Tasks, ${fmt(phase.anzahlKraene)} Kräne eingetragen)`
                          : `✗ Kräne reichen nicht — Spitzenbedarf ${fmt(kranSpitze)} gleichzeitig aktive kranpflichtige Tasks, nur ${fmt(phase.anzahlKraene)} Kräne eingetragen`}
                      </div>
                    ) : (
                      kranAnzahl > 0 && (
                        <div style={{ color: "var(--tc-text-3)" }}>
                          ℹ {fmt(kranAnzahl)} kranpflichtige Task{kranAnzahl === 1 ? "" : "s"} in dieser Phase — echte Gleichzeitigkeit ohne Termine unbekannt.
                        </div>
                      )
                    )}
                  </div>
                )}
              </div>
            );
          })}

          {!readOnly && (
            <button className="tc-btn-secondary" style={{ fontSize: 11, padding: "5px 10px", marginTop: 4 }} onClick={phaseHinzufuegen}>
              + Phase hinzufügen
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
