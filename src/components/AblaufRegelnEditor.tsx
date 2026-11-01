// AblaufRegelnEditor.tsx — Tab Ressourcen → Bauablauf → 3. Ablaufregeln: «erst A fertig, dann B» je Simulation (SimProjekt.ablaufRegeln);
// Export/Import im Kopf des Bauablaufs (TabRessourcen.tsx). Daraus setzt ablaufRegeln.ts nach jeder Änderung automatische Vorgänger (blau).
import { useEffect, useMemo, useRef, useState } from "react";
import type { AblaufRegel, RegelBedingung, RegelFeld, SimProjekt } from "../types";
import { LEERE_STAMMDATEN } from "./stammdatenHelpers";
import { LEERER_KALENDER } from "./kalenderHelpers";
import { bauablaufReihenfolge } from "./gruppenReihenfolge";
import { regelnAnwenden, regelWirkt, regelOptionen, auswahlText, bezugText, REGEL_FELD_LABEL } from "./ablaufRegeln";
import type { RegelOptionen } from "./ablaufRegeln";
import type { FestWiderspruch } from "./auslastungOptimierenKran";

const feldStil: React.CSSProperties = { fontSize: 11, padding: "2px 4px", border: "1px solid #d4dce4", fontFamily: "inherit", background: "#fff" };
const knopf: React.CSSProperties = { border: "1px solid var(--tc-border)", background: "#fff", cursor: "pointer", fontSize: 10, padding: "0 5px", lineHeight: "18px", color: "var(--tc-text-2)" };
const neueId = () => `regel-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;

interface Props { sim: SimProjekt; updateSim: (s: SimProjekt) => void; readOnly: boolean
  /** zählt bei jedem «↻ Aktualisieren» (TabRessourcen) hoch — weggeklickte Hinweise erscheinen dann wieder */
  aktualisiertSignal?: number
  /** «fest» aufgehoben (beim «Aktualisieren»), weil ein Vorgänger aus dieser Regel wegen «fest» erst danach darf — die Meldung
   *  steht unter der Regel; ✕ = onFestAusblenden (bis zum nächsten «Aktualisieren») */
  festKonflikte?: (FestWiderspruch & { regelId?: string })[]
  onFestAusblenden?: () => void
  /** zählt hoch → Regel «Geschoss nach Decke darunter» als Entwurf anlegen (Hinweis nach «Aktualisieren» in TabRessourcen) */
  vorlageSignal?: number }

export default function AblaufRegelnEditor({ sim, updateSim, readOnly, aktualisiertSignal = 0, festKonflikte = [], onFestAusblenden, vorlageSignal = 0 }: Props) {
  const regeln = useMemo(() => sim.ablaufRegeln ?? [], [sim.ablaufRegeln]);
  const stammdaten = sim.stammdaten ?? LEERE_STAMMDATEN;
  const reihenfolge = useMemo(() => bauablaufReihenfolge({ gruppenReihenfolge: sim.gruppenReihenfolge, tasks: sim.tasks, stammdaten: sim.stammdaten }), [sim.gruppenReihenfolge, sim.tasks, sim.stammdaten]);
  const optionen = useMemo(() => regelOptionen(sim.tasks, stammdaten, reihenfolge), [sim.tasks, stammdaten, reihenfolge]);
  // Wirkung: wie viele Vorgänger jede Regel setzt, Zirkelbezüge, zu viele Vorgänger
  const wirkung = useMemo(() => regelnAnwenden(sim.tasks, regeln, stammdaten, reihenfolge, sim.kalender ?? LEERER_KALENDER),
    [sim.tasks, regeln, stammdaten, reihenfolge, sim.kalender]);
  // Bearbeiten als Entwurf: die aufgeklappte Regel wird erst mit «Speichern» übernommen (setzt dann die Vorgänger, danach erst die
  // gelben Meldungen) — «Abbrechen» verwirft. Eine neue Regel ist bis zum Speichern nur Entwurf. «aktiv» (Haken) gilt sofort.
  const [entwurf, setEntwurf] = useState<AblaufRegel | null>(null);
  const [entwurfNeu, setEntwurfNeu] = useState(false);
  const offen = entwurf?.id ?? null;
  const ohneAktiv = (r: AblaufRegel | undefined) => JSON.stringify(r ? { ...r, aktiv: true } : null);
  const ungespeichert = !!entwurf && (entwurfNeu || ohneAktiv(entwurf) !== ohneAktiv(regeln.find(r => r.id === entwurf.id)));
  /** Regel aufklappen (null = zuklappen) — ungespeicherte Änderungen nur nach Rückfrage verwerfen */
  const oeffnen = (id: string | null): boolean => {
    if (id === offen) return true;
    if (ungespeichert && !confirm(`Ungespeicherte Änderungen an «${entwurf!.name || "Regel"}» verwerfen?`)) return false;
    const r = id ? regeln.find(x => x.id === id) : undefined;
    setEntwurf(r ? { ...r } : null); setEntwurfNeu(false);
    return true;
  };
  const entwurfAendern = (patch: Partial<AblaufRegel>) => setEntwurf(e => e && { ...e, ...patch });
  useEffect(() => { setEntwurf(null); setEntwurfNeu(false); }, [sim.id]); // andere Simulation → Entwurf gehört nicht dazu
  // «Zeigen ›» im gelben Balken: nicht gesetzte Verknüpfung Nr. … — ihre Regel aufklappen, hinscrollen, hervorheben
  const [zeigeNr, setZeigeNr] = useState<number | null>(null);
  const [zeigeSignal, setZeigeSignal] = useState(0);
  const regelRefs = useRef(new Map<string, HTMLDivElement>());
  // ✕ im gelben Balken: Hinweise (Balken, Hervorhebung, Kasten in der Regel) ausblenden bis zum nächsten «↻ Aktualisieren»
  const [weggeklickt, setWeggeklickt] = useState(false);
  useEffect(() => setWeggeklickt(false), [aktualisiertSignal]);
  const stellen = weggeklickt ? [] : wirkung.zirkelStellen;
  const stelle = zeigeNr !== null ? stellen[zeigeNr % Math.max(1, stellen.length)] : undefined;
  const taskName = useMemo(() => new Map(sim.tasks.map(t => [t.id, t.name])), [sim.tasks]);
  const zeigen = () => {
    if (!stellen.length) return;
    const nr = zeigeNr === null ? 0 : (zeigeNr + 1) % stellen.length;
    if (!oeffnen(stellen[nr].regel)) return;
    setZeigeNr(nr); setZeigeSignal(n => n + 1);
  };
  useEffect(() => {
    if (stelle) regelRefs.current.get(stelle.regel)?.scrollIntoView({ behavior: "smooth", block: "center" });
  }, [zeigeSignal]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (!stellen.length) setZeigeNr(null); }, [stellen.length]);

  const speichern = (neu: AblaufRegel[]) => updateSim({ ...sim, ablaufRegeln: neu.length ? neu : undefined });
  const aendern = (id: string, patch: Partial<AblaufRegel>) => speichern(regeln.map(r => r.id === id ? { ...r, ...patch } : r));
  const hinzufuegen = (r: Omit<AblaufRegel, "id">) => {
    if (!oeffnen(null)) return;
    setEntwurf({ ...r, id: neueId() }); setEntwurfNeu(true);
  };
  const entwurfSpeichern = () => {
    if (!entwurf) return;
    const alt = regeln.find(r => r.id === entwurf.id);
    speichern(alt ? regeln.map(r => r.id === entwurf.id ? { ...entwurf, aktiv: r.aktiv } : r) : [...regeln, entwurf]);
    setEntwurfNeu(false); // bleibt offen — gelbe Meldungen zu dieser Regel erscheinen gleich darin
  };
  const unterste = optionen.ebenen.length ? optionen.ebenen[optionen.ebenen.length - 1].ebene : 1;
  // Vorlage «Geschoss nach Decke darunter»: alles in einer Gruppe (z.B. EG) erst nach der Decke der Gruppe darunter (UG) — Bauteilart
  // der Decke vorbelegt, wenn eine Leistungsposition «Decke» heisst
  const geschossVorlage = (): Omit<AblaufRegel, "id"> => {
    const decke = optionen.kuerzel.filter(k => /decke/i.test(k.label));
    return { name: "Geschoss nach Decke darunter", aktiv: true, vor: [{ feld: "kuerzel", werte: decke.length === 1 ? [decke[0].wert] : [] }], nach: [],
      bezug: "darunter", ebene: unterste, wartetage: 0 };
  };
  useEffect(() => {
    if (!vorlageSignal) return;
    const vorlage = geschossVorlage();
    if (!oeffnen(null)) return;
    const id = neueId();
    setEntwurf({ ...vorlage, id }); setEntwurfNeu(true);
    const t = setTimeout(() => regelRefs.current.get(id)?.scrollIntoView({ behavior: "smooth", block: "center" }), 80);
    return () => clearTimeout(t);
  }, [vorlageSignal]); // eslint-disable-line react-hooks/exhaustive-deps
  const liste = entwurf && entwurfNeu ? [...regeln, entwurf] : regeln;

  return (
    <div style={{ fontSize: 11 }}>
      {liste.length === 0 && <div style={{ color: "var(--tc-text-3)", marginBottom: 8 }}>Noch keine Ablaufregeln.</div>}
      {liste.map((gespeichert, i) => {
        const istOffen = offen === gespeichert.id;
        const istNeu = istOffen && entwurfNeu;
        const r = istOffen ? entwurf! : gespeichert; // offen: Anzeige des Entwurfs
        const n = wirkung.anzahl.get(r.id) ?? 0;
        const fest = festKonflikte.filter(w => w.regelId === r.id);
        const hervorheben = stelle?.regel === r.id;
        const eigeneStellen = istOffen && ungespeichert ? [] : stellen.filter(s => s.regel === r.id);
        return (
          <div key={r.id} ref={el => { if (el) regelRefs.current.set(r.id, el); else regelRefs.current.delete(r.id); }}
            style={{ border: hervorheben ? "1px solid #e0a43a" : "1px solid var(--tc-border-light)", boxShadow: hervorheben ? "0 0 0 2px #fbe3b5" : undefined,
              background: "#fff", marginBottom: 6, opacity: gespeichert.aktiv ? 1 : 0.6 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 6, padding: "6px 8px" }}>
              <input type="checkbox" checked={gespeichert.aktiv} disabled={readOnly || istNeu} title="Regel anwenden (gilt sofort)" style={{ margin: 0 }}
                onChange={e => aendern(r.id, { aktiv: e.target.checked })} />
              <div style={{ flex: 1, minWidth: 0, cursor: "pointer" }} onClick={() => oeffnen(istOffen ? null : r.id)}>
                <div style={{ fontWeight: 600, color: "var(--tc-text)" }}>{istOffen ? "▾" : "▸"} {r.name || `Regel ${i + 1}`}</div>
                <div style={{ color: "var(--tc-text-3)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                  Erst {auswahlText(r.vor, optionen)} fertig, dann {auswahlText(r.nach, optionen)} — {bezugText(r)}{r.wartetage ? `, +${r.wartetage} Wartetage` : ""}
                </div>
              </div>
              {istOffen && ungespeichert
                ? <span style={{ color: "#d9622b", whiteSpace: "nowrap", fontWeight: 600 }} title="Änderungen gelten erst nach «Speichern»">{istNeu ? "neu — " : ""}nicht gespeichert</span>
                : <span title="So viele Vorgänger setzt diese Regel im Moment (ohne unnötige)"
                    style={{ color: !gespeichert.aktiv ? "var(--tc-text-3)" : !regelWirkt(gespeichert) ? "#d9622b" : n > 0 ? "var(--tc-blue)" : "var(--tc-text-3)", whiteSpace: "nowrap" }}>{!gespeichert.aktiv ? "aus" : !regelWirkt(gespeichert) ? "Wert fehlt" : `${n} Vorgänger`}</span>}
              {!readOnly && !istNeu && <>
                <button type="button" style={knopf} disabled={i === 0} title="Nach oben"
                  onClick={() => { const neu = [...regeln]; [neu[i - 1], neu[i]] = [neu[i], neu[i - 1]]; speichern(neu); }}>▲</button>
                <button type="button" style={knopf} disabled={i === regeln.length - 1} title="Nach unten"
                  onClick={() => { const neu = [...regeln]; [neu[i + 1], neu[i]] = [neu[i], neu[i + 1]]; speichern(neu); }}>▼</button>
                <button type="button" style={knopf} title="Regel löschen — ihre Vorgänger werden entfernt"
                  onClick={() => { if (confirm(`Regel «${r.name || `Regel ${i + 1}`}» löschen?`)) { if (istOffen) setEntwurf(null); speichern(regeln.filter(x => x.id !== r.id)); } }}>✕</button>
              </>}
            </div>
            {fest.length > 0 && (
              <div className="alert err" style={{ margin: "0 8px 6px 28px", display: "flex", alignItems: "flex-start", gap: 8 }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontWeight: 600 }}>! Widerspricht der festen Reihenfolge — «fest» für {fest.length} Task{fest.length === 1 ? "" : "s"} aufgehoben:</div>
                  {fest.slice(0, 5).map((w, k) => (
                    <div key={k}>«{taskName.get(w.taskId) ?? w.taskId}»{w.taskWert ? ` (${w.taskWert})` : ""} wartet auf «{taskName.get(w.vorgaengerId) ?? w.vorgaengerId}»{w.vorgaengerWert ? ` (${w.vorgaengerWert})` : ""}</div>
                  ))}
                  {fest.length > 5 && <div>… und {fest.length - 5} weitere</div>}
                  {(() => {
                    const s = fest.find(w => w.stufe);
                    return s ? <div style={{ marginTop: 3 }}>
                      Diese Regel setzt den Vorgänger, «fest» bei <b>{s.stufe}</b> lässt {s.vorgaengerWert} aber erst beginnen, wenn alles in {s.taskWert} (derselben
                      Gruppen darüber) fertig ist — beides geht nicht. Lösung: Regel enger fassen (z.B. Bezug «in derselben Gruppe» statt «überall»)
                      oder ausschalten, oder {s.stufe} in Stufe 2 auf «weich» stellen.
                    </div> : <div style={{ marginTop: 3 }}>Die Vorgänger aus dieser Regel sind selbst wegen «fest» blockiert.</div>;
                  })()}
                </div>
                {onFestAusblenden && <button type="button" title="Hinweis ausblenden — erscheint wieder beim nächsten «↻ Aktualisieren»"
                  style={{ background: "none", border: "none", cursor: "pointer", fontSize: 14, color: "inherit", padding: "2px 0 0", lineHeight: 1, flexShrink: 0 }}
                  onClick={onFestAusblenden}>✕</button>}
              </div>
            )}
            {istOffen && (
              <div style={{ padding: "4px 8px 8px 28px", display: "grid", gap: 6, borderTop: "1px solid var(--tc-border-light)", background: "#fafbfc" }}>
                {eigeneStellen.length > 0 && (
                  <div style={{ padding: "4px 6px", background: "#fff7e6", border: "1px solid #f5d9a8", color: "#8a5a00" }}>
                    <div style={{ fontWeight: 600, marginBottom: 2 }}>Nicht gesetzt (Zirkelbezug) — B ist über andere Vorgänger schon vor A:</div>
                    {eigeneStellen.slice(0, 10).map((s, k) => (
                      <div key={k} style={{ fontWeight: s === stelle ? 600 : undefined }}>
                        A «{taskName.get(s.a) ?? s.a}» → B «{taskName.get(s.b) ?? s.b}»
                      </div>
                    ))}
                    {eigeneStellen.length > 10 && <div>… und {eigeneStellen.length - 10} weitere</div>}
                    {gespeichert.bezug === "gleich" && n === 0 && !readOnly && (
                      <div style={{ marginTop: 6, paddingTop: 6, borderTop: "1px solid #f5d9a8", display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                        <span style={{ flex: 1, minWidth: 200 }}>Alle Verknüpfungen dieser Regel ergeben einen Zirkelbezug — «in derselben Gruppe» heisst: A und B im selben
                          Geschoss. <b>Meinten Sie «Gruppe darunter»?</b> (z.B. EG erst nach der Decke im UG derselben Etappe)</span>
                        <button type="button" className="tc-btn-secondary" style={{ fontSize: 11, padding: "3px 10px", flexShrink: 0 }}
                          title="Bezug auf «Gruppe darunter» (gleiche Ebene) umstellen und speichern"
                          onClick={() => { const neu = { ...gespeichert, bezug: "darunter" as const, ebene: gespeichert.ebene ?? unterste };
                            speichern(regeln.map(x => x.id === neu.id ? neu : x)); setEntwurf({ ...neu }); }}>Auf «Gruppe darunter» umstellen</button>
                      </div>
                    )}
                  </div>
                )}
                <Zeile label="Name">
                  <input value={r.name} disabled={readOnly} style={{ ...feldStil, width: 220 }} onChange={e => entwurfAendern({ name: e.target.value })} />
                </Zeile>
                <Zeile label="Erst fertig">
                  <AuswahlEditor bed={r.vor} optionen={optionen} disabled={readOnly} onChange={vor => entwurfAendern({ vor })} />
                </Zeile>
                <Zeile label="dann beginnt">
                  <AuswahlEditor bed={r.nach} optionen={optionen} disabled={readOnly} onChange={nach => entwurfAendern({ nach })} />
                </Zeile>
                <Zeile label="Bezug">
                  <select value={r.bezug} disabled={readOnly} style={feldStil}
                    onChange={e => { const bezug = e.target.value as AblaufRegel["bezug"]; entwurfAendern({ bezug, ebene: bezug === "ueberall" ? undefined : r.ebene ?? unterste }); }}>
                    <option value="ueberall">überall</option>
                    <option value="gleich" disabled={!optionen.ebenen.length}>in derselben Gruppe</option>
                    <option value="darunter" disabled={!optionen.ebenen.length}>Gruppe darunter</option>
                  </select>
                  {r.bezug !== "ueberall" && (
                    <select value={r.ebene ?? unterste} disabled={readOnly} style={{ ...feldStil, maxWidth: 260 }} onChange={e => entwurfAendern({ ebene: Number(e.target.value) })}>
                      {optionen.ebenen.map(e => <option key={e.ebene} value={e.ebene}>{ebeneLabel(e)}</option>)}
                    </select>
                  )}
                </Zeile>
                <Zeile label="Wartetage">
                  <input type="number" min={0} step={1} value={r.wartetage} disabled={readOnly} style={{ ...feldStil, width: 56 }}
                    onChange={e => entwurfAendern({ wartetage: Math.max(0, Math.round(Number(e.target.value) || 0)) })} />
                  <span style={{ color: "var(--tc-text-3)" }}>Kalendertage nach dem Ende von A (z.B. Trocknung)</span>
                </Zeile>
                {!readOnly && (
                  <div style={{ display: "flex", alignItems: "center", gap: 6, paddingTop: 2 }}>
                    <button type="button" className="tc-btn-primary" style={{ fontSize: 11, padding: "0 12px", height: 24 }} disabled={!ungespeichert}
                      title="Regel übernehmen — setzt ihre Vorgänger; danach erscheinen allfällige Meldungen (gelb)" onClick={entwurfSpeichern}>Speichern</button>
                    <button type="button" className="tc-btn-secondary" style={{ fontSize: 11, padding: "0 10px", height: 24 }}
                      title={ungespeichert ? "Änderungen verwerfen und zuklappen" : "Zuklappen"}
                      onClick={() => { setEntwurf(null); setEntwurfNeu(false); }}>{ungespeichert ? "Abbrechen" : "Schliessen"}</button>
                    {ungespeichert && <span style={{ color: "#d9622b" }}>Änderungen gelten erst nach «Speichern».</span>}
                  </div>
                )}
              </div>
            )}
          </div>
        );
      })}

      {!weggeklickt && !ungespeichert && (wirkung.zirkel > 0 || wirkung.zuViele.length > 0) && (
        <div style={{ margin: "6px 0", padding: "6px 8px", background: "#fff7e6", border: "1px solid #f5d9a8", color: "#8a5a00", display: "flex", alignItems: "flex-start", gap: 8 }}>
          <div style={{ flex: 1, minWidth: 0 }}>
          {wirkung.zirkel > 0 && (
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <span style={{ flex: 1 }}>{wirkung.zirkel} Verknüpfung{wirkung.zirkel === 1 ? "" : "en"} nicht gesetzt — sie hätte{wirkung.zirkel === 1 ? "" : "n"} einen Zirkelbezug ergeben (Regeln widersprechen sich oder einem Vorgänger von Hand).</span>
              <button type="button" className="tc-btn-secondary" style={{ flexShrink: 0, fontSize: 11, padding: "3px 10px" }}
                title="Zur Regel springen, deren Verknüpfung nicht gesetzt wurde, und die betroffenen Tasks zeigen — nochmals klicken: nächste Stelle"
                onClick={zeigen}>{stellen.length > 1 && zeigeNr !== null ? `Zeigen ${zeigeNr % stellen.length + 1}/${stellen.length} ›` : "Zeigen ›"}</button>
            </div>
          )}
          {wirkung.zuViele.length > 0 && <div>Mehr als 30 Vorgänger bei: {wirkung.zuViele.slice(0, 5).join(", ")}{wirkung.zuViele.length > 5 ? ` … und ${wirkung.zuViele.length - 5} weitere` : ""} — Auswahl der Regel enger fassen.</div>}
          </div>
          <button type="button" title="Hinweise ausblenden — erscheinen wieder beim nächsten «↻ Aktualisieren»"
            style={{ background: "none", border: "none", cursor: "pointer", fontSize: 14, color: "#8a5a00", padding: "2px 0 0", lineHeight: 1, flexShrink: 0 }}
            onClick={() => { setWeggeklickt(true); setZeigeNr(null); }}>✕</button>
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
            <select value={b.nicht ? "ausser" : "ist"} disabled={disabled} title="ist = einer der Werte trifft zu · ausser = keiner der Werte trifft zu"
              style={{ ...feldStil, ...(b.nicht ? { color: "#b5452b", borderColor: "#e3b3a6", fontWeight: 600 } : {}) }}
              onChange={e => { const { nicht: _alt, ...rest } = b; void _alt; setze(i, e.target.value === "ausser" ? { ...rest, nicht: true } : rest); }}>
              <option value="ist">ist</option>
              <option value="ausser">ausser</option>
            </select>
            <select value={b.feld} disabled={disabled} style={feldStil}
              onChange={e => { const feld = e.target.value as RegelFeld; setze(i, { feld, ...(feld === "gruppe" ? { ebene: optionen.ebenen[0]?.ebene ?? 1 } : {}), werte: [], ...(b.nicht ? { nicht: true } : {}) }); }}>
              {felder.map(f => <option key={f} value={f} disabled={f === "gruppe" && !optionen.ebenen.length}>{REGEL_FELD_LABEL[f]}</option>)}
            </select>
            {b.feld === "gruppe" && (
              <select value={b.ebene ?? 1} disabled={disabled} style={{ ...feldStil, maxWidth: 200 }} onChange={e => setze(i, { ...b, ebene: Number(e.target.value), werte: [] })}>
                {optionen.ebenen.map(e => <option key={e.ebene} value={e.ebene}>{ebeneLabel(e)}</option>)}
              </select>
            )}
            {b.werte.map((w, wi) => (
              <span key={w + wi} style={{ display: "inline-flex", alignItems: "center", gap: 3, padding: "0 4px", whiteSpace: "nowrap",
                ...(b.nicht ? { border: "1px solid #e3b3a6", background: "#fdf1ee", color: "#b5452b" } : { border: "1px solid var(--tc-blue)", background: "var(--tc-blue-bg)", color: "var(--tc-blue)" }) }}>
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
          <button type="button" style={{ ...knopf, marginLeft: 4 }} title="Ausnahme: Tasks, auf die einer der Werte zutrifft, gehören nicht dazu"
            onClick={() => onChange([...bed, { feld: "name", werte: [], nicht: true }])}>+ ausser …</button>
        </div>
      )}
    </div>
  );
}
