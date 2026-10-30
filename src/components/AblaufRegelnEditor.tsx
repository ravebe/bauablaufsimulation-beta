// AblaufRegelnEditor.tsx — Tab Ressourcen → Ablaufregeln: «erst A fertig, dann B» je Simulation (SimProjekt.ablaufRegeln), Export/Import
// als Datei wie die Ressourcen. Daraus setzt ablaufRegeln.ts nach jeder Änderung automatische Vorgänger (blau).
import { useMemo, useRef, useState } from "react";
import type { AblaufRegel, RegelBedingung, RegelFeld, SimProjekt } from "../types";
import { LEERE_STAMMDATEN } from "./stammdatenHelpers";
import { LEERER_KALENDER } from "./kalenderHelpers";
import { gruppenReihenfolgeAbgleichen } from "./gruppenReihenfolge";
import { regelnAnwenden, regelWirkt, regelOptionen, auswahlText, bezugText, regelnAlsJson, parseRegelnJson, REGEL_FELD_LABEL } from "./ablaufRegeln";
import type { RegelOptionen } from "./ablaufRegeln";
import PunkteMenu from "./PunkteMenu";

const feldStil: React.CSSProperties = { fontSize: 11, padding: "2px 4px", border: "1px solid #d4dce4", fontFamily: "inherit", background: "#fff" };
const knopf: React.CSSProperties = { border: "1px solid var(--tc-border)", background: "#fff", cursor: "pointer", fontSize: 10, padding: "0 5px", lineHeight: "18px", color: "var(--tc-text-2)" };
const neueId = () => `regel-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;

interface Props { sim: SimProjekt; updateSim: (s: SimProjekt) => void; readOnly: boolean }

export default function AblaufRegelnEditor({ sim, updateSim, readOnly }: Props) {
  const regeln = useMemo(() => sim.ablaufRegeln ?? [], [sim.ablaufRegeln]);
  const stammdaten = sim.stammdaten ?? LEERE_STAMMDATEN;
  const reihenfolge = useMemo(() => gruppenReihenfolgeAbgleichen(sim.gruppenReihenfolge, sim.tasks), [sim.gruppenReihenfolge, sim.tasks]);
  const optionen = useMemo(() => regelOptionen(sim.tasks, stammdaten, reihenfolge), [sim.tasks, stammdaten, reihenfolge]);
  // Wirkung: wie viele Vorgänger jede Regel setzt, Zirkelbezüge, zu viele Vorgänger
  const wirkung = useMemo(() => regelnAnwenden(sim.tasks, regeln, stammdaten, reihenfolge, sim.kalender ?? LEERER_KALENDER),
    [sim.tasks, regeln, stammdaten, reihenfolge, sim.kalender]);
  const [offen, setOffen] = useState<string | null>(null);
  const [importFehler, setImportFehler] = useState<string | null>(null);
  const importRef = useRef<HTMLInputElement>(null);

  const speichern = (neu: AblaufRegel[]) => updateSim({ ...sim, ablaufRegeln: neu.length ? neu : undefined });
  const aendern = (id: string, patch: Partial<AblaufRegel>) => speichern(regeln.map(r => r.id === id ? { ...r, ...patch } : r));
  const hinzufuegen = (r: Omit<AblaufRegel, "id">) => { const id = neueId(); speichern([...regeln, { ...r, id }]); setOffen(id); };
  const unterste = optionen.ebenen.length ? optionen.ebenen[optionen.ebenen.length - 1].ebene : 1;

  function exportieren() {
    const url = URL.createObjectURL(new Blob([regelnAlsJson(regeln)], { type: "application/json" }));
    const a = document.createElement("a");
    a.href = url; a.download = `${sim.name}_Ablaufregeln.json`; a.click();
    URL.revokeObjectURL(url);
  }
  async function importieren(file: File) {
    setImportFehler(null);
    try {
      const neu = parseRegelnJson(await file.text());
      if (regeln.length > 0 && !confirm(`Bestehende Ablaufregeln (${regeln.length}) werden durch den Import ersetzt. Fortfahren?`)) return;
      speichern(neu);
    } catch (e) {
      setImportFehler(e instanceof Error ? e.message : "Import fehlgeschlagen");
    } finally {
      if (importRef.current) importRef.current.value = "";
    }
  }

  return (
    <div style={{ fontSize: 11 }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "flex-end", marginTop: -4, marginBottom: 4 }}>
        <PunkteMenu title="Ablaufregeln exportieren / importieren" abschnitte={[
          ...(regeln.length ? [{ titel: "Export", eintraege: [{ label: "JSON", onClick: exportieren, title: "Alle Ablaufregeln als Datei — für andere Simulationen oder Projekte" }] }] : []),
          ...(!readOnly ? [{ titel: "Import", eintraege: [{ label: "JSON", onClick: () => importRef.current?.click(), title: "Ablaufregeln aus einer exportierten Datei übernehmen (ersetzt die bestehenden)" }] }] : []),
        ]} />
      </div>
      <input ref={importRef} type="file" accept=".json" style={{ display: "none" }} onChange={e => e.target.files?.[0] && importieren(e.target.files[0])} />
      {importFehler && <div className="alert err" style={{ marginBottom: 8 }}>! {importFehler}</div>}

      {regeln.length === 0 && <div style={{ color: "var(--tc-text-3)", marginBottom: 8 }}>Noch keine Ablaufregeln.</div>}
      {regeln.map((r, i) => {
        const istOffen = offen === r.id;
        const n = wirkung.anzahl.get(r.id) ?? 0;
        return (
          <div key={r.id} style={{ border: "1px solid var(--tc-border-light)", background: "#fff", marginBottom: 6, opacity: r.aktiv ? 1 : 0.6 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 6, padding: "6px 8px" }}>
              <input type="checkbox" checked={r.aktiv} disabled={readOnly} title="Regel anwenden" style={{ margin: 0 }}
                onChange={e => aendern(r.id, { aktiv: e.target.checked })} />
              <div style={{ flex: 1, minWidth: 0, cursor: "pointer" }} onClick={() => setOffen(istOffen ? null : r.id)}>
                <div style={{ fontWeight: 600, color: "var(--tc-text)" }}>{istOffen ? "▾" : "▸"} {r.name || `Regel ${i + 1}`}</div>
                <div style={{ color: "var(--tc-text-3)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                  Erst {auswahlText(r.vor, optionen)} fertig, dann {auswahlText(r.nach, optionen)} — {bezugText(r)}{r.wartetage ? `, +${r.wartetage} Wartetage` : ""}
                </div>
              </div>
              <span title="So viele Vorgänger setzt diese Regel im Moment (ohne unnötige)"
                style={{ color: !r.aktiv ? "var(--tc-text-3)" : !regelWirkt(r) ? "#d9622b" : n > 0 ? "var(--tc-blue)" : "var(--tc-text-3)", whiteSpace: "nowrap" }}>{!r.aktiv ? "aus" : !regelWirkt(r) ? "Wert fehlt" : `${n} Vorgänger`}</span>
              {!readOnly && <>
                <button type="button" style={knopf} disabled={i === 0} title="Nach oben"
                  onClick={() => { const neu = [...regeln]; [neu[i - 1], neu[i]] = [neu[i], neu[i - 1]]; speichern(neu); }}>▲</button>
                <button type="button" style={knopf} disabled={i === regeln.length - 1} title="Nach unten"
                  onClick={() => { const neu = [...regeln]; [neu[i + 1], neu[i]] = [neu[i], neu[i + 1]]; speichern(neu); }}>▼</button>
                <button type="button" style={knopf} title="Regel löschen — ihre Vorgänger werden entfernt"
                  onClick={() => { if (confirm(`Regel «${r.name || `Regel ${i + 1}`}» löschen?`)) speichern(regeln.filter(x => x.id !== r.id)); }}>✕</button>
              </>}
            </div>
            {istOffen && (
              <div style={{ padding: "4px 8px 8px 28px", display: "grid", gap: 6, borderTop: "1px solid var(--tc-border-light)", background: "#fafbfc" }}>
                <Zeile label="Name">
                  <NameFeld wert={r.name} disabled={readOnly} onChange={name => aendern(r.id, { name })} />
                </Zeile>
                <Zeile label="Erst fertig">
                  <AuswahlEditor bed={r.vor} optionen={optionen} disabled={readOnly} onChange={vor => aendern(r.id, { vor })} />
                </Zeile>
                <Zeile label="dann beginnt">
                  <AuswahlEditor bed={r.nach} optionen={optionen} disabled={readOnly} onChange={nach => aendern(r.id, { nach })} />
                </Zeile>
                <Zeile label="Bezug">
                  <select value={r.bezug} disabled={readOnly} style={feldStil}
                    onChange={e => { const bezug = e.target.value as AblaufRegel["bezug"]; aendern(r.id, { bezug, ebene: bezug === "ueberall" ? undefined : r.ebene ?? unterste }); }}>
                    <option value="ueberall">überall</option>
                    <option value="gleich" disabled={!optionen.ebenen.length}>in derselben Gruppe</option>
                    <option value="darunter" disabled={!optionen.ebenen.length}>Gruppe darunter</option>
                  </select>
                  {r.bezug !== "ueberall" && (
                    <select value={r.ebene ?? unterste} disabled={readOnly} style={{ ...feldStil, maxWidth: 260 }} onChange={e => aendern(r.id, { ebene: Number(e.target.value) })}>
                      {optionen.ebenen.map(e => <option key={e.ebene} value={e.ebene}>{ebeneLabel(e)}</option>)}
                    </select>
                  )}
                </Zeile>
                <Zeile label="Wartetage">
                  <input type="number" min={0} step={1} value={r.wartetage} disabled={readOnly} style={{ ...feldStil, width: 56 }}
                    onChange={e => aendern(r.id, { wartetage: Math.max(0, Math.round(Number(e.target.value) || 0)) })} />
                  <span style={{ color: "var(--tc-text-3)" }}>Kalendertage nach dem Ende von A (z.B. Trocknung)</span>
                </Zeile>
              </div>
            )}
          </div>
        );
      })}

      {(wirkung.zirkel > 0 || wirkung.zuViele.length > 0) && (
        <div style={{ margin: "6px 0", padding: "6px 8px", background: "#fff7e6", border: "1px solid #f5d9a8", color: "#8a5a00" }}>
          {wirkung.zirkel > 0 && <div>{wirkung.zirkel} Verknüpfung{wirkung.zirkel === 1 ? "" : "en"} nicht gesetzt — sie hätte{wirkung.zirkel === 1 ? "" : "n"} einen Zirkelbezug ergeben (Regeln widersprechen sich oder einem Vorgänger von Hand).</div>}
          {wirkung.zuViele.length > 0 && <div>Mehr als 30 Vorgänger bei: {wirkung.zuViele.slice(0, 5).join(", ")}{wirkung.zuViele.length > 5 ? ` … und ${wirkung.zuViele.length - 5} weitere` : ""} — Auswahl der Regel enger fassen.</div>}
        </div>
      )}

      {!readOnly && (
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 6 }}>
          <button className="tc-btn-secondary" style={{ fontSize: 11, padding: "5px 10px" }}
            onClick={() => hinzufuegen({ name: `Regel ${regeln.length + 1}`, aktiv: true, vor: [], nach: [], bezug: "ueberall", wartetage: 0 })}>+ Neue Regel</button>
          <button className="tc-btn-secondary" style={{ fontSize: 11, padding: "5px 10px" }} disabled={!optionen.ebenen.length}
            title={optionen.ebenen.length ? "Alles in einer Gruppe (z.B. EG) beginnt erst, wenn die Platten der Gruppe darunter (z.B. UG) fertig sind — Bauteilart der Platten noch auswählen" : "Das Gantt hat noch keine Gruppen"}
            onClick={() => hinzufuegen({ name: "Platte darunter", aktiv: true, vor: [{ feld: "kuerzel", werte: [] }], nach: [], bezug: "darunter", ebene: unterste, wartetage: 0 })}>
            + Vorlage «Platte darunter»
          </button>
        </div>
      )}
    </div>
  );
}

const ebeneLabel = (e: RegelOptionen["ebenen"][number]) =>
  `Ebene ${e.ebene} (${e.werte.slice(0, 3).join(", ")}${e.werte.length > 3 ? " …" : ""})`;

function Zeile({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ display: "flex", alignItems: "flex-start", gap: 6 }}>
      <span style={{ width: 80, flexShrink: 0, paddingTop: 3, fontWeight: 600, color: "var(--tc-text-2)" }}>{label}</span>
      <div style={{ flex: 1, minWidth: 0, display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>{children}</div>
    </div>
  );
}

/** Name: erst beim Verlassen speichern (nicht jeder Tastendruck ein Rückgängig-Schritt) */
function NameFeld({ wert, disabled, onChange }: { wert: string; disabled: boolean; onChange: (v: string) => void }) {
  const [entwurf, setEntwurf] = useState<string | null>(null);
  return (
    <input value={entwurf ?? wert} disabled={disabled} style={{ ...feldStil, width: 220 }}
      onChange={e => setEntwurf(e.target.value)}
      onBlur={() => { if (entwurf !== null && entwurf !== wert) onChange(entwurf); setEntwurf(null); }}
      onKeyDown={e => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }} />
  );
}

/** Auswahl von Tasks: Bedingungen (alle müssen zutreffen), je Bedingung einer der Werte. Leer = alle Tasks. */
function AuswahlEditor({ bed, optionen, disabled, onChange }: { bed: RegelBedingung[]; optionen: RegelOptionen; disabled: boolean; onChange: (b: RegelBedingung[]) => void }) {
  const setze = (i: number, b: RegelBedingung) => onChange(bed.map((x, j) => j === i ? b : x));
  const felder: RegelFeld[] = ["gruppe", "kuerzel", "kategorie", "unternehmer", "name"];
  return (
    <div style={{ display: "grid", gap: 4, width: "100%" }}>
      {bed.length === 0 && <span style={{ color: "var(--tc-text-3)", paddingTop: 3 }}>alle Tasks</span>}
      {bed.map((b, i) => {
        const auswahl: { wert: string; label: string }[] =
          b.feld === "gruppe" ? (optionen.ebenen.find(e => e.ebene === (b.ebene ?? 1))?.werte ?? []).map(w => ({ wert: w, label: w }))
          : b.feld === "kuerzel" ? optionen.kuerzel
          : b.feld === "kategorie" ? optionen.kategorien
          : b.feld === "unternehmer" ? optionen.unternehmer.map(u => ({ wert: u, label: u }))
          : [];
        const label = (w: string) => auswahl.find(a => a.wert === w)?.label ?? (b.feld === "name" ? `«${w}»` : w);
        return (
          <div key={i} style={{ display: "flex", alignItems: "center", gap: 4, flexWrap: "wrap" }}>
            {i > 0 && <span style={{ color: "var(--tc-text-3)" }}>und</span>}
            <select value={b.feld} disabled={disabled} style={feldStil}
              onChange={e => { const feld = e.target.value as RegelFeld; setze(i, { feld, ...(feld === "gruppe" ? { ebene: optionen.ebenen[0]?.ebene ?? 1 } : {}), werte: [] }); }}>
              {felder.map(f => <option key={f} value={f} disabled={f === "gruppe" && !optionen.ebenen.length}>{REGEL_FELD_LABEL[f]}</option>)}
            </select>
            {b.feld === "gruppe" && (
              <select value={b.ebene ?? 1} disabled={disabled} style={{ ...feldStil, maxWidth: 200 }} onChange={e => setze(i, { ...b, ebene: Number(e.target.value), werte: [] })}>
                {optionen.ebenen.map(e => <option key={e.ebene} value={e.ebene}>{ebeneLabel(e)}</option>)}
              </select>
            )}
            {b.werte.map((w, wi) => (
              <span key={w + wi} style={{ display: "inline-flex", alignItems: "center", gap: 3, padding: "0 4px", border: "1px solid var(--tc-blue)", background: "var(--tc-blue-bg)", color: "var(--tc-blue)", whiteSpace: "nowrap" }}>
                {wi > 0 && <span style={{ color: "var(--tc-text-3)" }}>oder</span>} {label(w)}
                {!disabled && <button type="button" style={{ ...knopf, border: "none", background: "none", padding: 0 }} title="Wert entfernen"
                  onClick={() => setze(i, { ...b, werte: b.werte.filter((_, k) => k !== wi) })}>✕</button>}
              </span>
            ))}
            {!disabled && (b.feld === "name"
              ? <input placeholder="Text + Enter" style={{ ...feldStil, width: 110 }}
                  onKeyDown={e => { const v = (e.target as HTMLInputElement).value.trim(); if (e.key === "Enter" && v) { setze(i, { ...b, werte: [...b.werte, v] }); (e.target as HTMLInputElement).value = ""; } }} />
              : <select value="" style={{ ...feldStil, maxWidth: 200 }} onChange={e => e.target.value && setze(i, { ...b, werte: [...b.werte, e.target.value] })}>
                  <option value="">{auswahl.length ? "+ Wert …" : "keine Werte vorhanden"}</option>
                  {auswahl.filter(a => !b.werte.includes(a.wert)).map(a => <option key={a.wert} value={a.wert}>{a.label}</option>)}
                </select>)}
            {b.werte.length === 0 && <span style={{ color: "#d9622b" }}>Wert wählen</span>}
            {!disabled && <button type="button" style={knopf} title="Bedingung entfernen" onClick={() => onChange(bed.filter((_, j) => j !== i))}>✕</button>}
          </div>
        );
      })}
      {!disabled && (
        <div>
          <button type="button" style={knopf} onClick={() => onChange([...bed, { feld: "kuerzel", werte: [] }])}>+ Bedingung</button>
        </div>
      )}
    </div>
  );
}
