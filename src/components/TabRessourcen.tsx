// TabRessourcen.tsx — Stammdaten-Editor (Leistungswerte/Personal/CHF je Bauteil-Kürzel), Basis
// für die Menge→Tage-Kalkulation (Tab Kalkulation) und die Kosten-Auswertung (Tab Kosten).
import { useState, useEffect, useRef } from "react";
import type { SimProjekt } from "../types";
import { istGruppe, nsKey } from "../types";
import type { Gewerk, GewerkeKatalog, Rate, Stammdaten } from "./stammdatenHelpers";
import { LEERE_STAMMDATEN, GEWERKE_KATALOGE, alleKuerzel } from "./stammdatenHelpers";
import { StatTile } from "./cockpitCharts";
import type { ApiInstance } from "../hooks/useApi";
import { ladeAttributListe, ladeObjektAttribute, attrItemsAusWerten, type AttrItem } from "./modelHelpers";
import { parseFormel, FormelFehler } from "./formelHelpers";

interface Props {
  sim: SimProjekt | null; updateSim: (s: SimProjekt) => void; readOnly?: boolean; api?: ApiInstance | null;
  selektion?: number[]; aktivesModellId?: string | null; projectId?: string | null;
}

const NEUE_RATE: Rate = { kuerzel: "", bezeichnung: "", leistungswertHProEinheit: null, anzahlPersonen: 1, chfProEinheit: null };

// Grid-Spalten der Raten-Tabelle — verstellbar per Drag, siehe startResize (gleiches Prinzip wie
// Tab Kalkulation). "aktion" fasst die fixen ƒx/×-Buttons am Zeilenende zusammen, nicht verstellbar.
const RATEN_SPALTEN = ["kuerzel", "bezeichnung", "lw", "personen", "chf"] as const;
type RatenSpalte = typeof RATEN_SPALTEN[number];
const RATEN_SPALTEN_LABEL: Record<RatenSpalte, string> = { kuerzel: "Kürzel", bezeichnung: "Bezeichnung", lw: "LW [h/Einh.]", personen: "Personen", chf: "CHF/Einh." };
const RATEN_COL_DEFAULT: Record<RatenSpalte, number> = { kuerzel: 60, bezeichnung: 220, lw: 80, personen: 60, chf: 70 };
const AKTION_BREITE = 54; // fx (26) + gap (10) + × (18), exakt an den Inhalt angepasst
const LS_RATEN_COLW = "4d-ressourcen-raten-colw";

export default function TabRessourcen({ sim, updateSim, readOnly, api, selektion = [], aktivesModellId = null, projectId = null }: Props) {
  const [ladeErgebnis, setLadeErgebnis] = useState<string | null>(null);
  const [neueKategorieName, setNeueKategorieName] = useState("");
  const [attrListe, setAttrListe] = useState<AttrItem[] | null>(null);
  const [attrLaedt, setAttrLaedt] = useState(false);
  const [pickerOffenFuer, setPickerOffenFuer] = useState<string | null>(null); // "gewerkIdx-rateIdx"
  const [pickerQuery, setPickerQuery] = useState("");
  const pickerRef = useRef<HTMLDivElement>(null);
  const [formelOffenFuer, setFormelOffenFuer] = useState<Set<string>>(new Set()); // "gewerkIdx-rateIdx", eingeklappt per Default
  const lsRatenColwKey = nsKey(LS_RATEN_COLW, projectId);
  const [ratenColW, setRatenColW] = useState<Record<RatenSpalte, number>>(() => {
    try {
      const raw = localStorage.getItem(lsRatenColwKey);
      return raw ? { ...RATEN_COL_DEFAULT, ...JSON.parse(raw) } : { ...RATEN_COL_DEFAULT };
    } catch { return { ...RATEN_COL_DEFAULT }; }
  });

  useEffect(() => {
    try { localStorage.setItem(lsRatenColwKey, JSON.stringify(ratenColW)); } catch { /* ignore */ }
  }, [ratenColW, lsRatenColwKey]);

  function startResize(spalte: RatenSpalte, e: React.MouseEvent) {
    e.preventDefault(); e.stopPropagation();
    const sx = e.clientX, sw = ratenColW[spalte];
    const onMove = (ev: MouseEvent) => setRatenColW(prev => ({ ...prev, [spalte]: Math.max(24, sw + ev.clientX - sx) }));
    const onUp = () => { document.removeEventListener("mousemove", onMove); document.removeEventListener("mouseup", onUp); };
    document.addEventListener("mousemove", onMove); document.addEventListener("mouseup", onUp);
  }

  const ratenGridTemplate = `${RATEN_SPALTEN.map(s => `${ratenColW[s]}px`).join(" ")} ${AKTION_BREITE}px`;

  function formelUmschalten(key: string) {
    setFormelOffenFuer(prev => { const n = new Set(prev); if (n.has(key)) n.delete(key); else n.add(key); return n; });
  }

  useEffect(() => {
    if (!pickerOffenFuer) return;
    const onDocMouseDown = (e: MouseEvent) => {
      if (pickerRef.current && !pickerRef.current.contains(e.target as Node)) setPickerOffenFuer(null);
    };
    document.addEventListener("mousedown", onDocMouseDown);
    return () => document.removeEventListener("mousedown", onDocMouseDown);
  }, [pickerOffenFuer]);

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

  /** Fügt Gewerke additiv hinzu — bestehende Gewerke (gleicher key) bleiben unberührt. */
  function gewerkeHinzufuegen(neueGewerke: Gewerk[], label: string) {
    const vorhandeneKeys = new Set(stammdaten.gewerke.map(g => g.key));
    const zuErgaenzen = neueGewerke.filter(g => !vorhandeneKeys.has(g.key));
    if (zuErgaenzen.length === 0) { setLadeErgebnis(`${label}: bereits vollständig vorhanden.`); return; }
    speichern({ ...stammdaten, gewerke: [...stammdaten.gewerke, ...zuErgaenzen] });
    const uebersprungen = neueGewerke.length - zuErgaenzen.length;
    setLadeErgebnis(`${label}: ${zuErgaenzen.length} Gewerke hinzugefügt${uebersprungen > 0 ? `, ${uebersprungen} bereits vorhanden` : ""}.`);
  }

  /** Ein Katalog gilt als vollständig geladen, wenn alle seine Gewerke-Keys bereits vorhanden sind — er verschwindet dann aus dem Dropdown. */
  function katalogVollstaendigGeladen(katalog: GewerkeKatalog): boolean {
    const vorhandeneKeys = new Set(stammdaten.gewerke.map(g => g.key));
    return katalog.gewerke().every(g => vorhandeneKeys.has(g.key));
  }

  function katalogHinzufuegen(katalogKey: string) {
    const katalog = GEWERKE_KATALOGE.find(k => k.key === katalogKey);
    if (katalog) gewerkeHinzufuegen(katalog.gewerke(), katalog.label);
  }

  function eigeneKategorieErstellen() {
    const name = neueKategorieName.trim();
    if (!name) return;
    const key = `eigene_${Date.now()}`;
    speichern({ ...stammdaten, gewerke: [...stammdaten.gewerke, { key, label: name, einheit: "", raten: [] }] });
    setNeueKategorieName("");
  }

  function gewerkLabelAendern(gewerkIdx: number, label: string) {
    speichern({ ...stammdaten, gewerke: stammdaten.gewerke.map((g, i) => i !== gewerkIdx ? g : { ...g, label }) });
  }

  // Attribut-Quellen in Prioritätsreihenfolge: 1) aktuelle Viewer-Selektion (das, was gerade im
  // Eigenschaften-Panel steht) — 2) bereits Tasks zugeordnete Bauteile (meist dieselbe Objektart wie
  // die Formel adressieren soll) — 3) blinde Modell-Stichprobe als letzter Ausweg. Eine blinde
  // Stichprobe allein trifft oft nur Hierarchie-Knoten (Site/Building/Storey) ohne die gesuchten
  // Mengen-Attribute, siehe ladeAttributListe().
  async function attrListeLaden() {
    if (!api || !sim || attrListe || attrLaedt) return;
    setAttrLaedt(true);
    try {
      const guids = new Set<string>();
      if (selektion.length > 0 && aktivesModellId) {
        for (const rId of selektion.slice(0, 30)) guids.add(`${aktivesModellId}:::${rId}`);
      }
      for (const t of sim.tasks) {
        if (guids.size >= 60) break;
        for (const g of t.objektGuids) { guids.add(g); if (guids.size >= 60) break; }
      }

      let ergebnis: AttrItem[] = [];
      if (guids.size > 0) ergebnis = attrItemsAusWerten((await ladeObjektAttribute(api, [...guids])).values());

      if (ergebnis.length === 0) {
        const modelId = sim.modelle[0]?.id;
        if (modelId) ergebnis = await ladeAttributListe(api, modelId);
      }
      setAttrListe(ergebnis);
    } catch { setAttrListe([]); }
    setAttrLaedt(false);
  }

  function attributEinfuegen(gewerkIdx: number, rateIdx: number, key: string) {
    const aktuell = stammdaten.gewerke[gewerkIdx].raten[rateIdx].formel ?? "";
    const trenner = aktuell && !/\s$/.test(aktuell) ? " " : "";
    rateAendern(gewerkIdx, rateIdx, { formel: `${aktuell}${trenner}{${key}}` });
    setPickerOffenFuer(null);
    setPickerQuery("");
  }

  function formelValidieren(formel: string | undefined): string | null {
    if (!formel || !formel.trim()) return null;
    try { parseFormel(formel); return null; }
    catch (e) { return e instanceof FormelFehler ? e.message : "Ungültige Formel"; }
  }

  const numInput = (val: number | null, onChange: (v: number | null) => void, width: number | string = "100%") => (
    <input type="number" disabled={readOnly} value={val ?? ""} placeholder="—"
      onChange={e => onChange(e.target.value === "" ? null : Number(e.target.value))}
      style={{ width, minWidth: 0, fontSize: 11, padding: "3px 5px", border: "1px solid #d4dce4", fontFamily: "inherit" }} />
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
      <div style={{ display: "flex", alignItems: "center", gap: 16, marginBottom: 10 }}>
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
        <div style={{ marginBottom: 14 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <select value="" onChange={e => { if (e.target.value) katalogHinzufuegen(e.target.value); }}
              style={{ fontSize: 11, padding: "5px 8px", border: "1px solid #d4dce4", fontFamily: "inherit", color: "var(--tc-text-3)" }}>
              <option value="">+ Kategorie hinzufügen…</option>
              {GEWERKE_KATALOGE.filter(k => !katalogVollstaendigGeladen(k)).map(k => (
                <option key={k.key} value={k.key}>{k.label}</option>
              ))}
            </select>
          </div>
          <div style={{ fontSize: 9, color: "var(--tc-text-3)", marginTop: 4 }}>
            Nur "Rohbau" enthält reale Referenzwerte aus der AVOR-Excel — alle anderen Kategorien legen
            nur Gewerke/Kürzel/Einheiten an und müssen selbst befüllt werden. Kategorien lassen sich
            nach dem Hinzufügen frei umbenennen, bereits vollständig geladene verschwinden aus der Liste.
          </div>
          {ladeErgebnis && <div style={{ fontSize: 10, color: "var(--tc-text-3)", marginTop: 4 }}>{ladeErgebnis}</div>}
        </div>
      )}

      {stammdaten.gewerke.length === 0 && (
        <div style={{ fontSize: 11, color: "var(--tc-text-3)" }}>
          Noch keine Stammdaten hinterlegt — über einen der Lade-Buttons starten oder Gewerke manuell anlegen.
        </div>
      )}

      {stammdaten.gewerke.length > 0 && (<>
        <div style={{ display: "flex", gap: 8, marginBottom: 12 }}>
          <StatTile label="Elemente ohne Leistungswert" wert={String(kuerzelOhneLw.length)} status={kuerzelOhneLw.length > 0 ? "warning" : "good"} />
          <StatTile label="Elemente ohne Stammdaten" wert={String(kuerzelOhneRate.length)} status={kuerzelOhneRate.length > 0 ? "warning" : "good"} />
          <StatTile label="Unbenutzte Elemente" wert={String(kuerzelUnbenutzt.length)} />
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

      <div style={{ overflowX: "auto" }}>
      {stammdaten.gewerke.map((gewerk, gi) => (
        <div key={gewerk.key} style={{ marginBottom: 18 }}>
          <div style={{ position: "sticky", top: 0, background: "#fff", zIndex: 2, paddingBottom: 3 }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 6 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 5, fontSize: 10, fontWeight: 600, color: "var(--tc-text-3)", letterSpacing: ".5px" }}>
                <input disabled={readOnly} value={gewerk.label} title="Kategorie umbenennen"
                  onChange={e => gewerkLabelAendern(gi, e.target.value)}
                  style={{ width: 160, fontSize: 10, fontWeight: 600, letterSpacing: ".5px", textTransform: "uppercase",
                    padding: "1px 3px", border: "1px solid transparent", background: "transparent", fontFamily: "inherit", color: "var(--tc-text-3)" }}
                  onFocus={e => e.currentTarget.style.border = "1px solid #d4dce4"}
                  onBlur={e => e.currentTarget.style.border = "1px solid transparent"} />
                <span>(</span>
                <input disabled={readOnly} value={gewerk.einheit} title="Einheit (z.B. m², m³, m1, Stk.)"
                  onChange={e => speichern({ ...stammdaten, gewerke: stammdaten.gewerke.map((g, i) => i !== gi ? g : { ...g, einheit: e.target.value }) })}
                  style={{ width: 44, fontSize: 10, fontWeight: 600, padding: "1px 3px", border: "1px solid #d4dce4", fontFamily: "inherit", color: "var(--tc-text-3)" }} />
                <span>)</span>
              </div>
              <label style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 10, color: "var(--tc-text-3)", cursor: readOnly ? "default" : "pointer" }}>
                <input type="checkbox" disabled={readOnly} checked={!!gewerk.kranpflichtig}
                  onChange={e => speichern({ ...stammdaten, gewerke: stammdaten.gewerke.map((g, i) => i !== gi ? g : { ...g, kranpflichtig: e.target.checked }) })} />
                kranpflichtig
              </label>
            </div>
            <div style={{ display: "grid", gridTemplateColumns: ratenGridTemplate, columnGap: 6, fontSize: 9, color: "var(--tc-text-3)", padding: "0 0 3px", fontWeight: 600 }}>
              {RATEN_SPALTEN.map((s, i) => (
                <div key={s} style={{ position: "relative", textAlign: "left", paddingLeft: i > 0 ? 8 : 0, overflow: "hidden", whiteSpace: "nowrap" }}>
                  {RATEN_SPALTEN_LABEL[s]}
                  <div className="col-resize-handle" onMouseDown={e => startResize(s, e)}
                    style={{ position: "absolute", top: -4, right: -3, width: 7, height: 18, cursor: "col-resize", zIndex: 2 }} />
                </div>
              ))}
              <span />
            </div>
          </div>
          {gewerk.raten.map((r, ri) => {
            const pickerKey = `${gi}-${ri}`;
            const formelFehler = formelValidieren(r.formel);
            const acItems = attrListe
              ? attrListe.filter(a => !pickerQuery || a.name.toLowerCase().includes(pickerQuery.toLowerCase()) || a.pset.toLowerCase().includes(pickerQuery.toLowerCase())).slice(0, 20)
              : [];
            return (
            <div key={ri} style={{ padding: "3px 0", borderBottom: "1px solid var(--tc-border-light)" }}>
              <div style={{ display: "grid", gridTemplateColumns: ratenGridTemplate, alignItems: "center", columnGap: 6 }}>
                <input disabled={readOnly} value={r.kuerzel} onChange={e => rateAendern(gi, ri, { kuerzel: e.target.value })}
                  style={{ width: "100%", minWidth: 0, fontSize: 11, padding: "3px 5px", border: "1px solid #d4dce4", fontFamily: "inherit" }} />
                <input disabled={readOnly} value={r.bezeichnung} onChange={e => rateAendern(gi, ri, { bezeichnung: e.target.value })}
                  style={{ width: "100%", minWidth: 0, fontSize: 11, padding: "3px 5px", border: "1px solid #d4dce4", fontFamily: "inherit" }} />
                {numInput(r.leistungswertHProEinheit, v => rateAendern(gi, ri, { leistungswertHProEinheit: v }))}
                {numInput(r.anzahlPersonen, v => rateAendern(gi, ri, { anzahlPersonen: v ?? 1 }))}
                {numInput(r.chfProEinheit, v => rateAendern(gi, ri, { chfProEinheit: v }))}
                <div style={{ display: "flex", alignItems: "center", gap: 10, justifyContent: "flex-start" }}>
                  {(!readOnly || r.formel) && (
                    <button className="tc-btn-ghost" title={r.formel ? "Formel anzeigen/ausblenden" : "Formel hinterlegen"}
                      onClick={() => formelUmschalten(pickerKey)}
                      style={{ fontSize: 11, fontStyle: "italic", fontFamily: "serif", padding: "2px 6px", width: 26, flexShrink: 0,
                        color: r.formel ? "var(--tc-blue)" : "var(--tc-text-3)",
                        border: `1px solid ${formelOffenFuer.has(pickerKey) ? "var(--tc-blue)" : "#d4dce4"}` }}>
                      ƒx
                    </button>
                  )}
                  {!readOnly && (
                    <button title="Entfernen" onClick={() => rateEntfernen(gi, ri)}
                      style={{ background: "none", border: "none", cursor: "pointer", fontSize: 14, color: "var(--tc-text-3)", padding: 0, width: 18, flexShrink: 0, lineHeight: 1 }}>
                      ×
                    </button>
                  )}
                </div>
              </div>
              {(!readOnly || r.formel) && formelOffenFuer.has(pickerKey) && (
                <div ref={pickerOffenFuer === pickerKey ? pickerRef : undefined}
                  style={{ display: "flex", alignItems: "center", gap: 4, marginTop: 3, paddingLeft: ratenColW.kuerzel + 6, position: "relative" }}>
                  <span style={{ fontSize: 9, color: "var(--tc-text-3)", width: 40, flexShrink: 0 }}>Formel</span>
                  <input disabled={readOnly} value={r.formel ?? ""} placeholder="z.B. {Qto_WallBaseQuantities||NetVolume}"
                    onChange={e => rateAendern(gi, ri, { formel: e.target.value })}
                    style={{ flex: 1, minWidth: 0, fontSize: 10, padding: "3px 5px", fontFamily: "monospace", border: `1px solid ${formelFehler ? "var(--tc-red)" : "#d4dce4"}` }} />
                  {api && !readOnly && (
                    <button className="tc-btn-ghost" style={{ fontSize: 9, padding: "2px 6px", flexShrink: 0 }}
                      onClick={() => { const opening = pickerOffenFuer !== pickerKey; setPickerOffenFuer(opening ? pickerKey : null); setPickerQuery(""); if (opening) attrListeLaden(); }}>
                      + Attribut
                    </button>
                  )}
                  {pickerOffenFuer === pickerKey && (
                    <div style={{ position: "absolute", top: "100%", left: 66, right: 0, marginTop: 2, background: "#fff", border: "1px solid var(--tc-border)", boxShadow: "0 2px 8px rgba(0,0,0,.12)", zIndex: 50, maxHeight: 220, overflowY: "auto" }}>
                      <input autoFocus value={pickerQuery} onChange={e => setPickerQuery(e.target.value)} placeholder="Attribut suchen…"
                        style={{ width: "100%", boxSizing: "border-box", fontSize: 10, padding: "5px 6px", border: "none", borderBottom: "1px solid var(--tc-border-light)" }} />
                      {attrLaedt && <div style={{ padding: 6, fontSize: 10, color: "var(--tc-text-3)" }}>⟳ Attribute laden…</div>}
                      {!attrLaedt && acItems.length === 0 && <div style={{ padding: 6, fontSize: 10, color: "var(--tc-text-3)" }}>Keine Treffer</div>}
                      {!attrLaedt && acItems.map(a => (
                        <div key={a.key} onMouseDown={() => attributEinfuegen(gi, ri, a.key)}
                          style={{ padding: "5px 8px", cursor: "pointer", fontSize: 10 }}
                          onMouseEnter={e => (e.currentTarget.style.background = "#f5f9fc")}
                          onMouseLeave={e => (e.currentTarget.style.background = "")}>
                          <div style={{ fontWeight: 500 }}>{a.name}</div>
                          <div style={{ fontSize: 9, color: "var(--tc-text-3)" }}>{a.pset}</div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
              {formelFehler && <div style={{ fontSize: 9, color: "var(--tc-red)", marginTop: 2, paddingLeft: ratenColW.kuerzel + 6 }}>⚠ {formelFehler}</div>}
            </div>
            );
          })}
          {!readOnly && (
            <button className="tc-btn-ghost" style={{ fontSize: 10, padding: "3px 8px", marginTop: 4 }} onClick={() => rateHinzufuegen(gi)}>
              + Kürzel hinzufügen
            </button>
          )}
        </div>
      ))}
      </div>
      {!readOnly && (
        <div style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 14 }}>
          <input value={neueKategorieName} placeholder="Neue Kategorie…" onChange={e => setNeueKategorieName(e.target.value)}
            onKeyDown={e => { if (e.key === "Enter") eigeneKategorieErstellen(); }}
            style={{ fontSize: 11, padding: "5px 8px", border: "1px solid #d4dce4", fontFamily: "inherit", width: 200 }} />
          <button className="tc-btn-secondary" style={{ fontSize: 11, padding: "5px 10px" }}
            disabled={!neueKategorieName.trim()} onClick={eigeneKategorieErstellen}>
            + Eigene Kategorie erstellen
          </button>
        </div>
      )}
    </div>
  );
}
