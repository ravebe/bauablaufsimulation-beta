// KapazitaetsCheckManager.tsx — zweiter Tab im Dialog "Kranplanung" (siehe KranPlanungManager) in Tab
// AVOR: prüft je Kran (Spalte "Kräne" in Tab Kalkulation — dieselbe Zuordnung wie Kranoptik und Kran-Personal), ob ein
// frei eingegebenes Personal-Budget den aus Menge × Leistungswert ermittelten Bedarf deckt und ob die Kranstunden in die
// Verfügbarkeit des Krans passen. Zwei Modi: "gantt" nutzt die echten Termine der Tasks des Krans, "sandbox" eine
// unabhängig eingegebene Zieldauer je Kran — z.B. um vor der Grobterminierung zu testen, ob eine Strategie aufgehen kann.
import type { SimProjekt, KapazitaetsCheck, KapazitaetsPhase, Zeitraster } from "../types";
import { LEERE_STAMMDATEN } from "./stammdatenHelpers";
import { LEERER_KALENDER } from "./kalenderHelpers";
import {
  kapazitaetJeKran, auswertungPhase,
  MAX_PERSONEN_PRO_KRAN, personenstundenProKranUndBucket, personalRichtwertJeBucket,
} from "./kapazitaetsCheckHelpers";

import { fmtZahl } from "./zahlFormat";
interface Props { sim: SimProjekt; updateSim: (s: SimProjekt) => void; readOnly?: boolean; }

const LEERER_CHECK: KapazitaetsCheck = { modus: "gantt", phasen: [] };

const fmt = fmtZahl;
const datumCh = (iso: string) => { const [j, m, t] = iso.split("-"); return `${t}.${m}.${j}`; };

export function KapazitaetsCheckInhalt({ sim, updateSim, readOnly }: Props) {
  const kc = sim.kapazitaetsCheck ?? LEERER_CHECK;
  const stammdaten = sim.stammdaten ?? LEERE_STAMMDATEN;
  const kalender = sim.kalender ?? LEERER_KALENDER;
  const std = stammdaten.arbeitszeitStdProTag;

  function speichern(neu: KapazitaetsCheck) {
    updateSim({ ...sim, kapazitaetsCheck: neu });
  }

  // Eingaben je Kran (Personal-Budget, Sandbox-Dauer) — als "Phase" mit kranId gespeichert, beim ersten Ändern angelegt
  function eingabeVonKran(kranId: string): KapazitaetsPhase | undefined {
    return kc.phasen.find(p => p.kranId === kranId);
  }
  function eingabeAendern(kranId: string, patch: Partial<KapazitaetsPhase>) {
    const bestehend = eingabeVonKran(kranId);
    const phasen = bestehend
      ? kc.phasen.map(p => p.kranId === kranId ? { ...p, ...patch } : p)
      : [...kc.phasen, { id: crypto.randomUUID(), kranId, anzahlPersonen: 0, ...patch }];
    speichern({ ...kc, phasen });
  }

  const kraene = sim.kraene ?? [];
  const kranById = new Map(kraene.map(k => [k.id, k]));
  const raster: Zeitraster = sim.zeitraster ?? "monat";
  const { buckets: personalBuckets, serien: personalSerien } = personenstundenProKranUndBucket(sim.tasks, kraene, stammdaten, kalender, raster);
  const kranHatPersonalBedarf = personalSerien.some(s => s.personenstunden.some(v => v > 0));

  return (
        <div style={{ padding: "14px 18px" }}>
          <div style={{ fontSize: 11, color: "var(--tc-text-2)", lineHeight: 1.5, marginBottom: 12 }}>
            Prüft je Kran (Zuordnung in Tab Kalkulation, Spalte "Kräne"), ob das eingetragene Personal das mit
            Menge × Leistungswert hinterlegte Arbeitsvolumen in der verfügbaren Zeit schafft und ob die Kranstunden in die
            Verfügbarkeit des Krans passen — anhand der echten Gantt-Termine oder als unabhängiges Testszenario.
            Tasks mit mehreren Kränen zählen bei jedem Kran anteilig.
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

          {kraene.length === 0 && (
            <div style={{ fontSize: 11, color: "var(--tc-text-3)", marginBottom: 8 }}>
              Noch keine Kräne angelegt — im Tab "Kräne &amp; Verfügbarkeit" anlegen und in Tab Kalkulation den Tasks zuordnen.
            </div>
          )}

          {kraene.map(kran => {
            const eingabe = eingabeVonKran(kran.id);
            const personen = eingabe?.anzahlPersonen ?? 0;
            const k = kapazitaetJeKran(sim.tasks, kran, stammdaten, kalender);
            const arbeitstage = kc.modus === "gantt" ? k.arbeitstage : (eingabe?.dauerTageSandbox ?? 0);
            const auswertung = auswertungPhase(personen, k.personenstunden, std, arbeitstage);
            // Kran: Gantt = Arbeitstage, an denen der Kran im Zeitraum verfügbar ist; Sandbox = eingegebene Dauer
            const kranKapazitaet = (kc.modus === "gantt" ? k.kranVerfuegbarTage : arbeitstage) * std;
            const kranOk = k.kranstunden <= kranKapazitaet + 1e-9;

            return (
              <div key={kran.id} style={{ border: "1px solid var(--tc-border-light)", marginBottom: 10, padding: "10px 12px" }}>
                <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", marginBottom: 8 }}>
                  <span style={{ fontSize: 12, fontWeight: 700, color: "var(--tc-text)", minWidth: 80 }}>{kran.name}</span>
                  <label style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 11, color: "var(--tc-text-2)" }}
                    title="Vorgesehenes Personal für die Tasks dieses Krans (Personen pro Tag)">
                    Personal
                    <input type="number" className="no-spinner" disabled={readOnly} value={personen || ""} placeholder="0"
                      onChange={e => eingabeAendern(kran.id, { anzahlPersonen: e.target.value === "" ? 0 : Number(e.target.value) })}
                      style={{ width: 55, fontSize: 12, padding: "3px 5px", border: "1px solid #d4dce4", fontFamily: "inherit" }} />
                    Pers.
                  </label>
                  {kc.modus === "sandbox" && (
                    <label style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 11, color: "var(--tc-text-2)" }}>
                      Dauer
                      <input type="number" className="no-spinner" disabled={readOnly} value={eingabe?.dauerTageSandbox ?? ""} placeholder="0"
                        onChange={e => eingabeAendern(kran.id, { dauerTageSandbox: e.target.value === "" ? undefined : Number(e.target.value) })}
                        style={{ width: 55, fontSize: 12, padding: "3px 5px", border: "1px solid #d4dce4", fontFamily: "inherit" }} />
                      Arbeitstage
                    </label>
                  )}
                  <span style={{ fontSize: 10, color: "var(--tc-text-3)", marginLeft: "auto" }}>{k.taskAnzahl} Task{k.taskAnzahl === 1 ? "" : "s"}</span>
                </div>

                {k.taskAnzahl === 0 ? (
                  <div style={{ fontSize: 11, color: "var(--tc-text-3)" }}>Diesem Kran sind noch keine Tasks mit Mengen zugeordnet (Tab Kalkulation, Spalte "Kräne").</div>
                ) : arbeitstage === 0 ? (
                  <div style={{ fontSize: 11, color: "var(--tc-text-3)" }}>
                    {kc.modus === "gantt" ? "Die Tasks dieses Krans haben keine Termine." : "Dauer eintragen, um Bedarf und Angebot zu vergleichen."}
                  </div>
                ) : (
                  <div style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: 11 }}>
                    <div style={{ display: "flex", gap: 14, flexWrap: "wrap", color: "var(--tc-text-2)" }}>
                      <span>Arbeitstage: <strong>{fmt(arbeitstage)}</strong>{kc.modus === "gantt" && k.zeitraum ? ` (${datumCh(k.zeitraum.start)} – ${datumCh(k.zeitraum.end)})` : ""}</span>
                      <span>Personal-Bedarf: <strong>{fmt(auswertung.bedarfPersonenstunden)} Pstd.</strong></span>
                      <span>Angebot: <strong>{fmt(auswertung.angebotPersonenstunden)} Pstd.</strong></span>
                    </div>
                    <div style={{ color: auswertung.deckung === "ok" ? "var(--tc-green-dark)" : "var(--tc-red)", fontWeight: 600 }}>
                      {personen === 0
                        ? <span style={{ color: "var(--tc-text-3)", fontWeight: 400 }}>Personal eintragen, um die Deckung zu prüfen (nötig im Schnitt: {fmt(auswertung.bedarfPersonenstunden / (std * arbeitstage))} Pers.)</span>
                        : auswertung.deckung === "ok"
                          ? "✓ Personal reicht"
                          : `✗ Personal reicht nicht — es fehlen ${fmt(auswertung.fehlendePersonen)} Personen (Vollzeit-Äquivalent)`}
                    </div>
                    <div style={{ color: kranOk ? "var(--tc-green-dark)" : "var(--tc-red)", fontWeight: 600 }}>
                      {kranOk
                        ? `✓ Kran reicht — ${fmt(k.kranstunden)} h Bedarf, ${fmt(kranKapazitaet)} h verfügbar`
                        : `✗ Kran reicht nicht — ${fmt(k.kranstunden)} h Bedarf, nur ${fmt(kranKapazitaet)} h verfügbar`}
                      {kc.modus === "gantt" && k.kranVerfuegbarTage < arbeitstage - 1e-9 && (
                        <span style={{ fontWeight: 400, color: "var(--tc-text-3)" }}> (Kran nur an {fmt(k.kranVerfuegbarTage)} von {fmt(arbeitstage)} Arbeitstagen verfügbar)</span>
                      )}
                    </div>
                  </div>
                )}
              </div>
            );
          })}

          {kraene.length > 0 && (
            <div style={{ marginTop: 18, paddingTop: 14, borderTop: "1px solid var(--tc-border-light)" }}>
              <div style={{ fontSize: 13, fontWeight: 700, color: "var(--tc-text)", marginBottom: 6 }}>Kräne — ungefährer Personalbedarf</div>
              <div style={{ fontSize: 11, color: "var(--tc-text-2)", lineHeight: 1.5, marginBottom: 10 }}>
                Richtwert aus Personenstunden (Menge × Leistungswert kranpflichtiger Gewerke) je Kran und Zeitraum
                gegen die Kran-Verfügbarkeit — Ampel zur Plausibilisierung, keine exakte Personalrechnung. Nutzt
                die Kran-Zuweisung in Tab Kalkulation (Spalte "Kräne"), wie die Prüfung oben. Die
                Obergrenze je Kran ("Max. Personen") wird im Tab "Kräne & Verfügbarkeit" festgelegt.
              </div>
              {!kranHatPersonalBedarf ? (
                <div style={{ fontSize: 11, color: "var(--tc-text-3)" }}>
                  Noch keinen Task einem Kran zugewiesen (Tab Kalkulation → Spalte "Kräne") oder kein Kürzel als kranpflichtig markiert.
                </div>
              ) : personalSerien.map(s => (
                <div key={s.kranId} style={{ marginBottom: 10 }}>
                  <div style={{ fontSize: 11, fontWeight: 600, color: "var(--tc-text)", marginBottom: 3 }}>{s.kranName}</div>
                  <div style={{ display: "flex", gap: 2, overflowX: "auto", paddingBottom: 2 }}>
                    {personalBuckets.map((b, bi) => {
                      const maxPersonenDiesesKrans = kranById.get(s.kranId)?.maxPersonen ?? MAX_PERSONEN_PRO_KRAN;
                      const rw = personalRichtwertJeBucket(s.personenstunden[bi], s.arbeitstageVerfuegbar[bi], stammdaten.arbeitszeitStdProTag, maxPersonenDiesesKrans);
                      const titel = rw.kranNichtVerfuegbar
                        ? `${b.label}: Bedarf vorhanden, Kran aber nicht verfügbar`
                        : `${b.label}: ${fmt(rw.richtwert ?? 0)} Personen (Vollzeit-Äquivalent)${rw.engpass ? " — über dem Maximum" : ""}`;
                      return (
                        <div key={b.key} title={titel}
                          style={{ minWidth: 34, textAlign: "center", fontSize: 9, whiteSpace: "nowrap", padding: "3px 2px", fontWeight: rw.engpass ? 700 : 400,
                            background: rw.engpass ? "var(--tc-red)" : "#eef1f4", color: rw.engpass ? "#fff" : "var(--tc-text-3)" }}>
                          {rw.richtwert == null ? "–" : fmt(rw.richtwert)}
                        </div>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
  );
}
