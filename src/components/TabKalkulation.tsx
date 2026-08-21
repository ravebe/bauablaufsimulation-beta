// TabKalkulation.tsx — Menge→Tage-Kalkulation je Task (AVOR-Logik) mit Plausibilitätsvergleich
// zur geplanten Dauer aus dem Bauablauf.
import { useState } from "react";
import type { SimProjekt, Task } from "../types";
import { istGruppe, berechneNummern } from "../types";
import type { ApiInstance } from "../hooks/useApi";
import { arbeitstageZwischen, LEERER_KALENDER } from "./kalenderHelpers";
import { LEERE_STAMMDATEN, alleKuerzel, gewerkeFuerKuerzel, dauerBerechnetTask } from "./stammdatenHelpers";
import { kuerzelVorschlag } from "./bauteilkatalogHelpers";
import { StatTile, CategoryBarChart, FARBEN } from "./cockpitCharts";

interface Props { sim: SimProjekt | null; updateSim: (s: SimProjekt) => void; readOnly?: boolean; api?: ApiInstance | null; }

export default function TabKalkulation({ sim, updateSim, readOnly, api }: Props) {
  const [wbsOffenIds, setWbsOffenIds] = useState<Set<string>>(new Set());
  const [ladeIds, setLadeIds] = useState<Set<string>>(new Set());
  const [hinweisProTask, setHinweisProTask] = useState<Record<string, string>>({});
  const [bulkLaeuft, setBulkLaeuft] = useState(false);
  const [bulkErgebnis, setBulkErgebnis] = useState<string | null>(null);

  if (!sim) return <div style={{ padding: 14, fontSize: 12, color: "var(--tc-text-3)" }}>Kein aktives Projekt ausgewählt</div>;

  const stammdaten = sim.stammdaten ?? LEERE_STAMMDATEN;
  const kalender = sim.kalender ?? LEERER_KALENDER;
  const kuerzelListe = alleKuerzel(stammdaten);
  const nummern = berechneNummern(sim.tasks);

  function taskAendern(taskId: string, patch: Partial<Task>) {
    updateSim({ ...sim!, tasks: sim!.tasks.map(t => t.id === taskId ? { ...t, ...patch } : t) });
  }

  function mengeAendern(task: Task, gewerkKey: string, wert: number | null) {
    const mengen = { ...(task.mengen ?? {}) };
    if (wert === null || wert === 0) delete mengen[gewerkKey]; else mengen[gewerkKey] = wert;
    taskAendern(task.id, { mengen });
  }

  async function vorschlagAnwenden(task: Task) {
    if (!api) return;
    setLadeIds(prev => new Set(prev).add(task.id));
    try {
      const { kuerzel, uneindeutig } = await kuerzelVorschlag(api, task.objektGuids);
      if (kuerzel) {
        taskAendern(task.id, { bauteilKuerzel: kuerzel });
        setHinweisProTask(prev => ({ ...prev, [task.id]: `✓ ${kuerzel}` }));
      } else if (uneindeutig.length > 0) {
        setHinweisProTask(prev => ({ ...prev, [task.id]: `Uneindeutig: ${uneindeutig.join(", ")}` }));
      } else {
        setHinweisProTask(prev => ({ ...prev, [task.id]: "Kein Katalog-Treffer" }));
      }
    } finally {
      setLadeIds(prev => { const n = new Set(prev); n.delete(task.id); return n; });
    }
  }

  async function alleUnzugeordnetenZuordnen() {
    if (!api) return;
    const kandidaten = sim!.tasks.filter((t, i) => !t.isGroup && !istGruppe(sim!.tasks, i) && !t.bauteilKuerzel && t.objektGuids.length > 0);
    if (kandidaten.length === 0) { setBulkErgebnis("Keine unzugeordneten Tasks mit Bauteilen gefunden."); return; }
    setBulkLaeuft(true);
    setBulkErgebnis(null);
    let zugeordnet = 0, uneindeutigN = 0, keinTreffer = 0;
    for (const t of kandidaten) {
      const { kuerzel, uneindeutig } = await kuerzelVorschlag(api, t.objektGuids);
      if (kuerzel) { taskAendern(t.id, { bauteilKuerzel: kuerzel }); zugeordnet++; }
      else if (uneindeutig.length > 0) uneindeutigN++;
      else keinTreffer++;
    }
    setBulkLaeuft(false);
    setBulkErgebnis(`${zugeordnet} zugeordnet, ${uneindeutigN} uneindeutig, ${keinTreffer} ohne Treffer`);
  }

  if (kuerzelListe.length === 0) {
    return (
      <div style={{ padding: 14, fontSize: 12, color: "var(--tc-text-3)" }}>
        Noch keine Stammdaten hinterlegt — im Tab Ressourcen zuerst Stammdaten anlegen oder Standardwerte laden.
      </div>
    );
  }

  const zeilen = sim.tasks.map((t, i) => {
    if (t.isGroup || istGruppe(sim.tasks, i)) return null;
    const geplant = arbeitstageZwischen(t.start, t.end, kalender);
    const berechnet = dauerBerechnetTask(t, stammdaten);
    const abweichung = berechnet > 0 && (berechnet > geplant * 1.5 || berechnet < geplant * 0.67);
    return { t, geplant, berechnet, abweichung };
  }).filter((z): z is NonNullable<typeof z> => z !== null);

  const tasksMitKuerzel = zeilen.filter(z => z.t.bauteilKuerzel).length;
  const anzahlAbweichung = zeilen.filter(z => z.abweichung).length;
  const abweichungsBasis = zeilen.filter(z => z.t.bauteilKuerzel && z.geplant > 0);
  const durchschnAbweichungProzent = abweichungsBasis.length > 0
    ? abweichungsBasis.reduce((s, z) => s + Math.abs(z.berechnet - z.geplant) / z.geplant, 0) / abweichungsBasis.length * 100
    : 0;

  const summeProKuerzel = new Map<string, { geplant: number; berechnet: number }>();
  for (const z of zeilen) {
    if (!z.t.bauteilKuerzel) continue;
    const e = summeProKuerzel.get(z.t.bauteilKuerzel) ?? { geplant: 0, berechnet: 0 };
    e.geplant += z.geplant; e.berechnet += z.berechnet;
    summeProKuerzel.set(z.t.bauteilKuerzel, e);
  }
  const kuerzelKategorien = [...summeProKuerzel.keys()].sort();

  return (
    <div style={{ padding: 14, fontSize: 12 }}>
      <div style={{ display: "flex", gap: 8, marginBottom: 12 }}>
        <StatTile label="Tasks mit Kürzel" wert={`${tasksMitKuerzel}/${zeilen.length}`} />
        <StatTile label="Tasks mit Abweichung" wert={String(anzahlAbweichung)} status={anzahlAbweichung > 0 ? "warning" : "good"} />
        <StatTile label="Ø Abweichung" wert={`${durchschnAbweichungProzent.toFixed(0)}%`} />
      </div>
      {kuerzelKategorien.length > 0 && (
        <div style={{ marginBottom: 16 }}>
          <CategoryBarChart einheit="Tage" kategorien={kuerzelKategorien}
            serien={[
              { key: "geplant", label: "Geplant", color: FARBEN.kategorial[0], werte: kuerzelKategorien.map(k => summeProKuerzel.get(k)!.geplant) },
              { key: "berechnet", label: "Berechnet", color: FARBEN.kategorial[1], werte: kuerzelKategorien.map(k => summeProKuerzel.get(k)!.berechnet) },
            ]} formatWert={v => v.toFixed(0)} />
        </div>
      )}

      {!readOnly && api && (
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }}>
          <button className="tc-btn-secondary" style={{ fontSize: 11, padding: "5px 10px" }} disabled={bulkLaeuft} onClick={alleUnzugeordnetenZuordnen}>
            {bulkLaeuft ? "Wird zugeordnet…" : "Alle unzugeordneten automatisch zuordnen"}
          </button>
          {bulkErgebnis && <span style={{ fontSize: 10, color: "var(--tc-text-3)" }}>{bulkErgebnis}</span>}
        </div>
      )}

      <div style={{ display: "flex", gap: 6, fontSize: 9, color: "var(--tc-text-3)", padding: "0 0 4px", fontWeight: 600 }}>
        <span style={{ width: 24 }}>Nr.</span>
        <span style={{ flex: 1 }}>Task</span>
        <span style={{ width: 60 }}>Kürzel</span>
        <span style={{ flex: 2 }}>Mengen</span>
        <span style={{ width: 44, textAlign: "right" }}>Geplant</span>
        <span style={{ width: 44, textAlign: "right" }}>Berechnet</span>
        <span style={{ width: 20 }} />
      </div>
      {zeilen.map(({ t, geplant, berechnet, abweichung }) => {
        const gewerke = t.bauteilKuerzel ? gewerkeFuerKuerzel(stammdaten, t.bauteilKuerzel) : [];
        const wbsOffen = wbsOffenIds.has(t.id);
        return (
          <div key={t.id} style={{ borderBottom: "1px solid var(--tc-border-light)" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 6, padding: "5px 0" }}>
            <span style={{ width: 24, fontSize: 10, color: "#666" }}>{nummern.get(t.id)}</span>
            <span style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{t.name}</span>
            <select disabled={readOnly} value={t.bauteilKuerzel ?? ""} onChange={e => taskAendern(t.id, { bauteilKuerzel: e.target.value || undefined })}
              style={{ width: 60, fontSize: 11, padding: "3px 4px", border: "1px solid #d4dce4", fontFamily: "inherit" }}>
              <option value="">–</option>
              {kuerzelListe.map(k => <option key={k} value={k}>{k}</option>)}
            </select>
            {!readOnly && api && !t.bauteilKuerzel && t.objektGuids.length > 0 && (
              <button className="tc-btn-ghost" disabled={ladeIds.has(t.id)} style={{ fontSize: 9, padding: "2px 5px", flexShrink: 0 }}
                onClick={() => vorschlagAnwenden(t)} title="Kürzel aus verknüpften Bauteilen vorschlagen">
                {ladeIds.has(t.id) ? "…" : "Vorschlagen"}
              </button>
            )}
            {hinweisProTask[t.id] && (
              <span style={{ fontSize: 9, color: hinweisProTask[t.id].startsWith("✓") ? FARBEN.status.good : FARBEN.status.warning, flexShrink: 0 }}>
                {hinweisProTask[t.id]}
              </span>
            )}
            <div style={{ flex: 2, display: "flex", gap: 6, flexWrap: "wrap" }}>
              {gewerke.map(g => (
                <label key={g.key} title={`${g.label} [${g.einheit}]`} style={{ fontSize: 9, color: "var(--tc-text-3)", display: "flex", alignItems: "center", gap: 3 }}>
                  {g.label}
                  <input type="number" disabled={readOnly} value={t.mengen?.[g.key] ?? ""}
                    onChange={e => mengeAendern(t, g.key, e.target.value === "" ? null : Number(e.target.value))}
                    style={{ width: 56, fontSize: 10, padding: "2px 4px", border: "1px solid #d4dce4", fontFamily: "inherit" }} />
                </label>
              ))}
              {gewerke.length === 0 && <span style={{ fontSize: 9, color: "var(--tc-text-3)" }}>Kürzel wählen…</span>}
            </div>
            <span style={{ width: 44, textAlign: "right", fontSize: 11, color: "#888" }}>{geplant}d</span>
            <span style={{ width: 44, textAlign: "right", fontSize: 11, fontWeight: 600, color: abweichung ? "#d9622b" : "#333" }}
              title={abweichung ? "Deutliche Abweichung von der geplanten Dauer" : ""}>
              {berechnet}d
            </span>
            <span style={{ width: 20, textAlign: "center", cursor: "pointer", fontSize: 9, color: "var(--tc-text-3)" }}
              title="WBS-Attribute (Etappe/Geschoss/Bauabschnitt/Kranbereich)"
              onClick={() => setWbsOffenIds(prev => { const n = new Set(prev); if (n.has(t.id)) n.delete(t.id); else n.add(t.id); return n; })}>
              {wbsOffen ? "▲" : "WBS"}
            </span>
          </div>
          {wbsOffen && (
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", padding: "0 0 8px 30px" }}>
              {([["etappe", "Etappe"], ["geschoss", "Geschoss"], ["bauabschnitt", "Bauabschnitt"], ["kranbereich", "Kranbereich"]] as const).map(([feld, label]) => (
                <label key={feld} style={{ fontSize: 9, color: "var(--tc-text-3)", display: "flex", alignItems: "center", gap: 3 }}>
                  {label}
                  <input type="text" disabled={readOnly} value={t[feld] ?? ""} onChange={e => taskAendern(t.id, { [feld]: e.target.value || undefined })}
                    style={{ width: 90, fontSize: 10, padding: "2px 4px", border: "1px solid #d4dce4", fontFamily: "inherit" }} />
                </label>
              ))}
            </div>
          )}
          </div>
        );
      })}
    </div>
  );
}
