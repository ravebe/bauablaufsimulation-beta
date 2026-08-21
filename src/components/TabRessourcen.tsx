// TabRessourcen.tsx — Stammdaten-Editor (Leistungswerte/Personal/CHF je Bauteil-Kürzel), Basis
// für die Menge→Tage-Kalkulation (Tab Kalkulation) und die Kosten-Auswertung (Tab Kosten).
import type { SimProjekt } from "../types";
import { istGruppe } from "../types";
import type { Rate, Stammdaten } from "./stammdatenHelpers";
import { LEERE_STAMMDATEN, standardStammdaten, alleKuerzel } from "./stammdatenHelpers";
import { StatTile } from "./cockpitCharts";

interface Props { sim: SimProjekt | null; updateSim: (s: SimProjekt) => void; readOnly?: boolean; }

const NEUE_RATE: Rate = { kuerzel: "", bezeichnung: "", leistungswertHProEinheit: null, anzahlPersonen: 1, chfProEinheit: null };

export default function TabRessourcen({ sim, updateSim, readOnly }: Props) {
  if (!sim) return <div style={{ padding: 14, fontSize: 12, color: "var(--tc-text-3)" }}>Kein aktives Projekt ausgewählt</div>;

  const stammdaten = sim.stammdaten ?? LEERE_STAMMDATEN;

  function speichern(neu: Stammdaten) {
    updateSim({ ...sim!, stammdaten: neu });
  }

  function rateAendern(gewerkIdx: number, rateIdx: number, patch: Partial<Rate>) {
    speichern({
      ...stammdaten,
      gewerke: stammdaten.gewerke.map((g, gi) => gi !== gewerkIdx ? g : {
        ...g, raten: g.raten.map((r, ri) => ri !== rateIdx ? r : { ...r, ...patch }),
      }),
    });
  }

  function rateEntfernen(gewerkIdx: number, rateIdx: number) {
    speichern({
      ...stammdaten,
      gewerke: stammdaten.gewerke.map((g, gi) => gi !== gewerkIdx ? g : { ...g, raten: g.raten.filter((_, ri) => ri !== rateIdx) }),
    });
  }

  function rateHinzufuegen(gewerkIdx: number) {
    speichern({
      ...stammdaten,
      gewerke: stammdaten.gewerke.map((g, gi) => gi !== gewerkIdx ? g : { ...g, raten: [...g.raten, { ...NEUE_RATE }] }),
    });
  }

  function standardLaden() {
    if (stammdaten.gewerke.length > 0 && !confirm("Bestehende Stammdaten mit den Standardwerten überschreiben?")) return;
    speichern(standardStammdaten());
  }

  const numInput = (val: number | null, onChange: (v: number | null) => void, width: number) => (
    <input type="number" disabled={readOnly} value={val ?? ""} placeholder="—"
      onChange={e => onChange(e.target.value === "" ? null : Number(e.target.value))}
      style={{ width, fontSize: 11, padding: "3px 5px", border: "1px solid #d4dce4", fontFamily: "inherit" }} />
  );

  // Cockpit: Kürzel ohne Leistungswert, Kreuzcheck Stammdaten ↔ tatsächlich verwendete Kürzel
  const alleRaten = stammdaten.gewerke.flatMap(g => g.raten);
  const kuerzelOhneLw = alleRaten.filter(r => r.leistungswertHProEinheit === null).map(r => r.kuerzel);
  const kuerzelInStammdaten = new Set(alleKuerzel(stammdaten));
  const kuerzelInTasks = new Set(
    sim.tasks.filter((t, i) => !t.isGroup && !istGruppe(sim.tasks, i) && t.bauteilKuerzel).map(t => t.bauteilKuerzel!)
  );
  const kuerzelOhneRate = [...kuerzelInTasks].filter(k => !kuerzelInStammdaten.has(k));
  const kuerzelUnbenutzt = [...kuerzelInStammdaten].filter(k => !kuerzelInTasks.has(k));

  return (
    <div style={{ padding: 14, fontSize: 12 }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 14 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <span style={{ fontWeight: 600 }}>Arbeitszeit pro Tag (h):</span>
            {numInput(stammdaten.arbeitszeitStdProTag, v => speichern({ ...stammdaten, arbeitszeitStdProTag: v ?? 8.5 }), 60)}
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <span style={{ fontWeight: 600 }}>Umsatz CHF/Mannstunde:</span>
            {numInput(stammdaten.umsatzChfProMannstunde ?? 80, v => speichern({ ...stammdaten, umsatzChfProMannstunde: v ?? 80 }), 60)}
          </div>
        </div>
        {!readOnly && (
          <button className="tc-btn-secondary" style={{ fontSize: 11, padding: "5px 10px" }} onClick={standardLaden}>
            Standard-Stammdaten laden
          </button>
        )}
      </div>

      {stammdaten.gewerke.length === 0 && (
        <div style={{ fontSize: 11, color: "var(--tc-text-3)" }}>
          Noch keine Stammdaten hinterlegt — über "Standard-Stammdaten laden" starten oder Gewerke manuell anlegen.
        </div>
      )}

      {stammdaten.gewerke.length > 0 && (<>
        <div style={{ display: "flex", gap: 8, marginBottom: 12 }}>
          <StatTile label="Kürzel ohne Leistungswert" wert={String(kuerzelOhneLw.length)} status={kuerzelOhneLw.length > 0 ? "warning" : "good"} />
          <StatTile label="Kürzel ohne Stammdaten" wert={String(kuerzelOhneRate.length)} status={kuerzelOhneRate.length > 0 ? "warning" : "good"} />
          <StatTile label="Unbenutzte Kürzel" wert={String(kuerzelUnbenutzt.length)} />
        </div>
        {(kuerzelOhneLw.length > 0 || kuerzelOhneRate.length > 0) && (
          <div style={{ marginBottom: 16, fontSize: 11 }}>
            {kuerzelOhneLw.length > 0 && (
              <div style={{ color: "#b5750a", marginBottom: 3 }}>⚠ Ohne Leistungswert: {kuerzelOhneLw.join(", ")}</div>
            )}
            {kuerzelOhneRate.length > 0 && (
              <div style={{ color: "#b5750a" }}>⚠ In Tasks verwendet, aber keine Rate hinterlegt: {kuerzelOhneRate.join(", ")}</div>
            )}
          </div>
        )}
      </>)}

      {stammdaten.gewerke.map((gewerk, gi) => (
        <div key={gewerk.key} style={{ marginBottom: 18 }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 6 }}>
            <div style={{ fontSize: 10, fontWeight: 600, color: "var(--tc-text-3)", letterSpacing: ".5px" }}>
              {gewerk.label.toUpperCase()} ({gewerk.einheit})
            </div>
            <label style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 10, color: "var(--tc-text-3)", cursor: readOnly ? "default" : "pointer" }}>
              <input type="checkbox" disabled={readOnly} checked={!!gewerk.kranpflichtig}
                onChange={e => speichern({ ...stammdaten, gewerke: stammdaten.gewerke.map((g, i) => i !== gi ? g : { ...g, kranpflichtig: e.target.checked }) })} />
              kranpflichtig
            </label>
          </div>
          <div style={{ display: "flex", gap: 6, fontSize: 9, color: "var(--tc-text-3)", padding: "0 0 3px", fontWeight: 600 }}>
            <span style={{ width: 60 }}>Kürzel</span>
            <span style={{ flex: 1 }}>Bezeichnung</span>
            <span style={{ width: 80 }}>LW [h/Einh.]</span>
            <span style={{ width: 60 }}>Personen</span>
            <span style={{ width: 70 }}>CHF/Einh.</span>
            <span style={{ width: 60 }} />
          </div>
          {gewerk.raten.map((r, ri) => (
            <div key={ri} style={{ display: "flex", alignItems: "center", gap: 6, padding: "3px 0", borderBottom: "1px solid var(--tc-border-light)" }}>
              <input disabled={readOnly} value={r.kuerzel} onChange={e => rateAendern(gi, ri, { kuerzel: e.target.value })}
                style={{ width: 60, fontSize: 11, padding: "3px 5px", border: "1px solid #d4dce4", fontFamily: "inherit" }} />
              <input disabled={readOnly} value={r.bezeichnung} onChange={e => rateAendern(gi, ri, { bezeichnung: e.target.value })}
                style={{ flex: 1, minWidth: 0, fontSize: 11, padding: "3px 5px", border: "1px solid #d4dce4", fontFamily: "inherit" }} />
              {numInput(r.leistungswertHProEinheit, v => rateAendern(gi, ri, { leistungswertHProEinheit: v }), 80)}
              {numInput(r.anzahlPersonen, v => rateAendern(gi, ri, { anzahlPersonen: v ?? 1 }), 60)}
              {numInput(r.chfProEinheit, v => rateAendern(gi, ri, { chfProEinheit: v }), 70)}
              {!readOnly && (
                <button className="tc-btn-ghost" style={{ fontSize: 10, padding: "2px 6px", width: 60 }} onClick={() => rateEntfernen(gi, ri)}>
                  Entfernen
                </button>
              )}
            </div>
          ))}
          {!readOnly && (
            <button className="tc-btn-ghost" style={{ fontSize: 10, padding: "3px 8px", marginTop: 4 }} onClick={() => rateHinzufuegen(gi)}>
              + Kürzel hinzufügen
            </button>
          )}
        </div>
      ))}
    </div>
  );
}
