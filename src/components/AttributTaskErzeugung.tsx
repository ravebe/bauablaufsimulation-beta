// AttributTaskErzeugung.tsx — Tasks aus Bauteil-Attributen erzeugen (Gruppierung nach Attributwert-Kombination)
import { useState, useRef, useEffect } from "react";
import type { SimProjekt, Task, AttrRef } from "../types";
import { datumPlusTage } from "../types";
import type { ApiInstance } from "../hooks/useApi";
import { getModellObjekte, ladeObjektAttribute, ladeAttributListe, type AttrItem } from "./modelHelpers";

interface Props {
  api: ApiInstance | null;
  sim: SimProjekt;
  onUpdate: (tasks: Task[], konfig: { tasknameAttr: AttrRef; zusatzAttrs: AttrRef[] }) => void;
  done?: boolean;
}

interface Row { query: string; attr: AttrItem | null; acOffen: boolean; }

const MIN_ZUSATZ_SLOTS = 5;
const MAX_ZUSATZ_SLOTS = 15;

function leereRow(attr?: AttrRef): Row {
  return { query: attr ? `${attr.name} › ${attr.pset}` : "", attr: attr ?? null, acOffen: false };
}

// Kanonischer Schlüssel einer Attribut-Werte-Kombination — unabhängig von der Objekt-Einfüge-
// Reihenfolge, damit bestehende Tasks bei erneuter Generierung zuverlässig wiedererkannt werden.
function gruppenSchluessel(attrGruppe: Record<string, string>): string {
  return Object.entries(attrGruppe).sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => `${k}=${v}`).join("");
}

export default function AttributTaskErzeugung({ api, sim, onUpdate, done }: Props) {
  const [offen, setOffen] = useState(false);
  const [bestaetigen, setBestaetigen] = useState(false);
  const [allAttrs, setAllAttrs] = useState<AttrItem[]>([]);
  const [attrLaedt, setAttrLaedt] = useState(false);
  const [tasknameRow, setTasknameRow] = useState<Row>(() => leereRow(sim.attributKonfig?.tasknameAttr));
  const [zusatzRows, setZusatzRows] = useState<Row[]>(() => {
    const vorbelegt = (sim.attributKonfig?.zusatzAttrs ?? []).map(a => leereRow(a));
    while (vorbelegt.length < MIN_ZUSATZ_SLOTS) vorbelegt.push(leereRow());
    return vorbelegt;
  });
  const [laeuft, setLaeuft] = useState(false);
  const [fortschritt, setFortschritt] = useState("");
  const [fortschrittProzent, setFortschrittProzent] = useState(0);
  const [ergebnis, setErgebnis] = useState<string | null>(null);
  const wrapRef = useRef<HTMLDivElement>(null);

  // Autocomplete-Dropdowns schließen bei Klick außerhalb
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) {
        setTasknameRow(r => (r.acOffen ? { ...r, acOffen: false } : r));
        setZusatzRows(rows => rows.map(r => (r.acOffen ? { ...r, acOffen: false } : r)));
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  if (sim.modelle.length === 0) return null;

  async function ladeAttr() {
    if (!api || allAttrs.length > 0) return;
    setAttrLaedt(true);
    try {
      const attrsMap = new Map<string, AttrItem>();
      for (const m of sim.modelle) {
        if (!m.id) continue;
        for (const a of await ladeAttributListe(api, m.id)) if (!attrsMap.has(a.key)) attrsMap.set(a.key, a);
      }
      setAllAttrs([...attrsMap.values()].sort((a, b) => a.key.localeCompare(b.key)));
    } catch { /* ignore */ }
    setAttrLaedt(false);
  }

  const gewaehlteZusatz = zusatzRows.filter(r => r.attr);
  const kannStarten = !!tasknameRow.attr && gewaehlteZusatz.length >= 1;

  function addSlot() {
    setZusatzRows(prev => (prev.length >= MAX_ZUSATZ_SLOTS ? prev : [...prev, leereRow()]));
  }
  function removeSlot(idx: number) {
    setZusatzRows(prev => (prev.length <= MIN_ZUSATZ_SLOTS ? prev : prev.filter((_, i) => i !== idx)));
  }

  async function starten() {
    if (!api || !tasknameRow.attr || gewaehlteZusatz.length === 0) return;
    setBestaetigen(false);
    setLaeuft(true);
    setFortschrittProzent(0);
    setErgebnis(null);

    const tasknameAttr = tasknameRow.attr;
    const zusatzAttrs = gewaehlteZusatz.map(r => r.attr!);
    const selectedAttrs = [tasknameAttr, ...zusatzAttrs];
    const totalModelle = Math.max(1, sim.modelle.length);

    try {
      // Attribut-Werte aller Bauteile in allen Modellen laden
      const werte = new Map<string, Record<string, string>>();
      for (let mi = 0; mi < sim.modelle.length; mi++) {
        const modell = sim.modelle[mi];
        if (!modell.id) continue;
        setFortschritt(`⟳ Modell ${modell.name} laden…`);
        setFortschrittProzent(Math.round((mi / totalModelle) * 90));
        const ids = await getModellObjekte(api, modell.id);
        if (ids.length === 0) continue;
        const guids = ids.map(id => `${modell.id}:::${id}`);
        const modellWerte = await ladeObjektAttribute(api, guids);
        for (const [g, w] of modellWerte) werte.set(g, w);
      }

      setFortschritt("⟳ Gruppiere Bauteile…");
      setFortschrittProzent(92);

      // Nach der Kombination der gewählten Attributwerte gruppieren — nur Bauteile, die für ALLE
      // gewählten Attribute einen Wert haben, gehören zu einer Gruppe (= zukünftiger Task).
      const gruppen = new Map<string, { attrGruppe: Record<string, string>; baseName: string; guids: string[] }>();
      let ohneAttribute = 0;
      for (const [guid, w] of werte) {
        if (selectedAttrs.some(a => !w[a.key])) { ohneAttribute++; continue; }
        const attrGruppe: Record<string, string> = {};
        for (const a of selectedAttrs) attrGruppe[a.key] = w[a.key];
        const key = gruppenSchluessel(attrGruppe);
        let g = gruppen.get(key);
        if (!g) { g = { attrGruppe, baseName: w[tasknameAttr.key], guids: [] }; gruppen.set(key, g); }
        g.guids.push(guid);
      }

      // Tasknamen eindeutig machen: Gruppen mit identischem Taskname-Attributwert bekommen die
      // Werte der Zusatzattribute als Klammerzusatz angehängt.
      const nachBaseName = new Map<string, string[]>();
      for (const [key, g] of gruppen) {
        if (!nachBaseName.has(g.baseName)) nachBaseName.set(g.baseName, []);
        nachBaseName.get(g.baseName)!.push(key);
      }
      const finalNamen = new Map<string, string>();
      for (const [baseName, keys] of nachBaseName) {
        if (keys.length === 1) { finalNamen.set(keys[0], baseName); continue; }
        for (const key of keys) {
          const g = gruppen.get(key)!;
          const suffix = zusatzAttrs.map(a => `${a.name}: ${g.attrGruppe[a.key]}`).join(", ");
          finalNamen.set(key, `${baseName} (${suffix})`);
        }
      }

      // Bestehende, per Attribut-Erzeugung entstandene Tasks anhand des Gruppen-Schlüssels
      // wiedererkennen — Termine/ID bleiben erhalten, nur Name/Bauteile werden aufgefrischt.
      const bestehendeByKey = new Map<string, Task>();
      for (const t of sim.tasks) if (t.attrGruppe) bestehendeByKey.set(gruppenSchluessel(t.attrGruppe), t);
      const unveraenderteTasks = sim.tasks.filter(t => !t.attrGruppe);

      const heute = new Date().toISOString().slice(0, 10);
      let neu = 0, aktualisiert = 0;
      const sortierteGruppen = [...gruppen.entries()].sort((a, b) =>
        (finalNamen.get(a[0]) ?? "").localeCompare(finalNamen.get(b[0]) ?? ""));
      const erzeugteTasks: Task[] = sortierteGruppen.map(([key, g]) => {
        const name = finalNamen.get(key) ?? g.baseName;
        const bestehender = bestehendeByKey.get(key);
        if (bestehender) { aktualisiert++; return { ...bestehender, name, objektGuids: g.guids, attrGruppe: g.attrGruppe }; }
        neu++;
        return { id: crypto.randomUUID(), name, start: heute, end: datumPlusTage(heute, 1), typ: "neubau", objektGuids: g.guids, attrGruppe: g.attrGruppe } as Task;
      });

      setFortschrittProzent(100);
      onUpdate([...unveraenderteTasks, ...erzeugteTasks], { tasknameAttr, zusatzAttrs });
      const teile = [`✓ ${erzeugteTasks.length} Tasks (${neu} neu, ${aktualisiert} aktualisiert)`];
      if (ohneAttribute > 0) teile.push(`${ohneAttribute} Bauteile ohne alle gewählten Attribute übersprungen`);
      setErgebnis(teile.join(" — "));
    } catch (e) {
      setErgebnis(`Fehler: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setLaeuft(false);
      setFortschritt("");
      setFortschrittProzent(0);
    }
  }

  function renderAttrInput(row: Row, onChange: (patch: Partial<Row>) => void, placeholder: string) {
    const acItems = row.query.length >= 1
      ? allAttrs.filter(a => a.name.toLowerCase().includes(row.query.toLowerCase()) || a.pset.toLowerCase().includes(row.query.toLowerCase())).slice(0, 20)
      : [];
    return (
      <div style={{ position: "relative" }}>
        <input className="ac-input" style={{ paddingRight: 24 }} placeholder={placeholder} value={row.query}
          onChange={e => onChange({ query: e.target.value, attr: null, acOffen: true })}
          onFocus={() => { onChange({ acOffen: true }); if (allAttrs.length === 0) ladeAttr(); }} />
        {row.query && <button style={{ position: "absolute", right: 6, top: "50%", transform: "translateY(-50%)", background: "none", border: "none", cursor: "pointer", color: "#999", fontSize: 14, padding: 2 }}
          onClick={() => onChange({ query: "", attr: null })}>✕</button>}
        {row.acOffen && acItems.length > 0 && (
          <div className="ac-dropdown">
            {acItems.map((item, i) => (
              <div key={i} className="ac-item" onMouseDown={() => onChange({ query: `${item.name} › ${item.pset}`, attr: item, acOffen: false })}>
                <div style={{ fontWeight: 500, color: "var(--tc-text)" }}>{item.name}</div>
                <div style={{ fontSize: 9, color: "var(--tc-text-3)" }}>{item.pset}</div>
              </div>
            ))}
          </div>
        )}
      </div>
    );
  }

  return (
    <div style={{ marginTop: 6 }} ref={wrapRef}>
      {!offen ? (
        <div style={{ position: "relative" }}>
          <button className={done ? "tc-btn-secondary" : "tc-btn-primary"}
            style={{ width: "100%", fontSize: 11, opacity: done ? 0.7 : 1 }}
            onClick={() => { setOffen(true); if (allAttrs.length === 0) ladeAttr(); }}>
            {laeuft ? (
              <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
                <span className="spin-icon">⟳</span> {fortschritt}
              </span>
            ) : done ? (
              <>✓ Attribut-Tasks ({1 + gewaehlteZusatz.length} Attribute)</>
            ) : (
              <>🏷️ Attribut-Tasks erzeugen</>
            )}
          </button>
          {laeuft && (
            <div style={{ position: "absolute", left: 0, right: 0, bottom: 0, height: 3, background: "rgba(255,255,255,.3)", overflow: "hidden" }}>
              <div style={{ height: "100%", width: `${fortschrittProzent}%`, background: "#fff", transition: "width .2s ease" }} />
            </div>
          )}
        </div>
      ) : (
        <div style={{ border: "1px solid var(--tc-border)", padding: 8, fontSize: 11 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
            <span style={{ fontWeight: 600, color: "var(--tc-text)" }}>Attribut-Tasks erzeugen</span>
            <button style={{ background: "none", border: "none", cursor: "pointer", color: "#999", fontSize: 14 }}
              onClick={() => { setOffen(false); setBestaetigen(false); }}>✕</button>
          </div>

          <div style={{ color: "var(--tc-text-3)", marginBottom: 6, fontSize: 10 }}>
            Wähle ein Attribut für den Tasknamen sowie mindestens ein weiteres Attribut zur Gruppierung.
            Für jede vorkommende Werte-Kombination wird ein eigener Task erzeugt; nur Bauteile mit Werten
            für alle gewählten Attribute werden zugeordnet. Je mehr Attribute gewählt sind, desto mehr (kleinere) Tasks entstehen.
          </div>

          {attrLaedt && <div style={{ fontSize: 10, color: "var(--tc-text-3)", marginBottom: 6 }}>⟳ Attribute laden…</div>}

          {/* Taskname-Attribut */}
          <div style={{ marginBottom: 8 }}>
            <div style={{ fontSize: 10, fontWeight: 600, color: "var(--tc-text-2)", marginBottom: 2 }}>Taskname-Attribut</div>
            {renderAttrInput(tasknameRow, patch => setTasknameRow(r => ({ ...r, ...patch })), "Attribut für Taskname…")}
          </div>

          {/* Zusatzattribute */}
          <div style={{ marginBottom: 8 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 2 }}>
              <span style={{ fontSize: 10, fontWeight: 600, color: "var(--tc-text-2)" }}>
                Zusätzliche Attribute ({gewaehlteZusatz.length} gewählt, min. 1 nötig)
              </span>
              {zusatzRows.length < MAX_ZUSATZ_SLOTS && (
                <button className="tc-btn-ghost" style={{ padding: "1px 6px", fontSize: 11 }} onClick={addSlot}>
                  + ({zusatzRows.length}/{MAX_ZUSATZ_SLOTS})
                </button>
              )}
            </div>
            {zusatzRows.map((row, idx) => (
              <div key={idx} style={{ marginBottom: 4, display: "flex", gap: 4, alignItems: "flex-start" }}>
                <div style={{ flex: 1 }}>
                  {renderAttrInput(row, patch => setZusatzRows(rows => rows.map((r, i) => i === idx ? { ...r, ...patch } : r)), `Zusatzattribut ${idx + 1}…`)}
                </div>
                {idx >= MIN_ZUSATZ_SLOTS && (
                  <button style={{ background: "none", border: "none", cursor: "pointer", color: "#999", fontSize: 14, padding: "4px 2px" }}
                    onClick={() => removeSlot(idx)}>✕</button>
                )}
              </div>
            ))}
          </div>

          {/* Bestätigung */}
          {bestaetigen && !laeuft && (
            <div style={{ background: "#FFF7ED", border: "1px solid #FB923C", padding: 8, marginBottom: 6 }}>
              <div style={{ fontWeight: 600, color: "#C2410C", marginBottom: 4 }}>
                ⚠ Attribut-Tasks erzeugen?
              </div>
              <div style={{ fontSize: 10, color: "#9A3412", marginBottom: 6 }}>
                Taskname: {tasknameRow.attr?.name}. Gruppierung zusätzlich nach: {gewaehlteZusatz.map(r => r.attr!.name).join(", ")}.
                Bestehende, zuvor so erzeugte Tasks werden aktualisiert; nicht mehr vorkommende Kombinationen werden entfernt.
              </div>
              <div style={{ display: "flex", gap: 6 }}>
                <button className="tc-btn-primary" style={{ flex: 1, fontSize: 10, background: "#2d7dbd" }}
                  onClick={starten}>Ja, erzeugen</button>
                <button className="tc-btn-ghost" style={{ flex: 1, fontSize: 10 }}
                  onClick={() => setBestaetigen(false)}>Abbrechen</button>
              </div>
            </div>
          )}

          {/* Fortschritt */}
          {laeuft && (
            <div style={{ marginBottom: 6 }}>
              <div className="alert info" style={{ marginBottom: 4 }}>{fortschritt || "⟳ Wird verarbeitet…"}</div>
              <div style={{ height: 6, background: "#e4e7ea", overflow: "hidden" }}>
                <div style={{ height: "100%", width: `${fortschrittProzent}%`, background: "#2d7dbd", transition: "width .2s ease" }} />
              </div>
              <div style={{ fontSize: 9, color: "var(--tc-text-3)", textAlign: "right", marginTop: 2 }}>{fortschrittProzent}%</div>
            </div>
          )}

          {/* Ergebnis */}
          {ergebnis && (
            <div className={`alert ${ergebnis.startsWith("✓") ? "ok" : "err"}`} style={{ marginBottom: 6 }}>{ergebnis}</div>
          )}

          {/* Start-Button */}
          {!bestaetigen && !laeuft && (
            <button className="tc-btn-green" style={{ width: "100%", fontSize: 11 }}
              disabled={!kannStarten}
              onClick={() => setBestaetigen(true)}>
              🏷️ Tasks erzeugen ({1 + gewaehlteZusatz.length} Attribute)
            </button>
          )}
        </div>
      )}
    </div>
  );
}
