// KranPersonalEditor.tsx — Tab Ressourcen → "Kräne & Personal": Kräne mit Verfügbarkeit (von/bis), darunter das Personal unter
// dem Kran je Unternehmer und Zeitraum. Grundlage für "Perfekte Auslastung" (Tab AVOR) und "Auslastung optimieren" (Tab Bauteile):
// Personal desselben Unternehmers unter einem Kran ist ein Pool von Allroundern; die Summe aller Unternehmer ist die Höchstzahl
// der Leute an kranpflichtigen Arbeiten dieses Krans pro Tag (Richtwert 13 nur als Hinweis).
import { useState } from "react";
import type { SimProjekt, Kran, KranPersonal, UnternehmerPersonal } from "../types";
import { istGruppe } from "../types";
import { personalJeUnternehmerAusKraenen, neuerKran, kranAusTasksEntfernen, kraeneDesTasks, kranPersonalAmTag, RICHTWERT_PERSONEN_PRO_KRAN, kranLuecken, tageAlsZeitraeume, kranVerlaengernVorschlag, kranVerlaengern } from "./kranHelpers";
import { LEERE_STAMMDATEN } from "./stammdatenHelpers";
import { LEERER_KALENDER } from "./kalenderHelpers";

interface Props { sim: SimProjekt; updateSim: (s: SimProjekt) => void; readOnly?: boolean; bekannteUnternehmer: string[];
  /** zur Auswahl: alle Unternehmer (Leistungspositionen und Kräne) */
  alleUnternehmer: string[];
  /** Knopf «Zur Kranoptik» im Hinweis «Kran fehlt» → Tab AVOR */
  onZuKranoptik?: () => void }

const feld: React.CSSProperties = { fontSize: 11, padding: "3px 5px", border: "1px solid #d4dce4", fontFamily: "inherit" };

/** Grösste Summe des Personals aller Unternehmer an einem Tag (geprüft an jedem Beginn eines Zeitraums). */
function maxSumme(kran: Kran): { summe: number; tag: string | null } {
  const tage = new Set<string>([kran.verfuegbarVon ?? "0000-01-01"]);
  for (const p of kran.personal ?? []) if (p.von) tage.add(p.von);
  let best = { summe: 0, tag: null as string | null };
  for (const tag of tage) {
    let s = 0;
    for (const v of kranPersonalAmTag(kran, tag).values()) s += v;
    if (s > best.summe) best = { summe: s, tag: tag === "0000-01-01" ? null : tag };
  }
  return best;
}

/** Warnung über der Kranoptik bzw. in Tab Ressourcen: kranpflichtige Arbeit ohne verfügbaren Kran und Kräne, an deren Tasks an
 *  manchen Tagen gearbeitet wird, ohne dass Personal unter dem Kran erfasst ist (siehe kranLuecken).
 *  Knöpfe rechts im Balken: onZuKranplanung «Zur Kranplanung» (aus Tab AVOR → Tab Ressourcen), onZuKranoptik «Zur Kranoptik» (aus Tab
 *  Ressourcen → Tab AVOR), verlaengern = «Kran fehlt» direkt beheben (Kran verlängern, siehe kranVerlaengernVorschlag) */
export function KranLueckenHinweis({ luecken, kraene, onZuKranplanung, onZuKranoptik, verlaengern }: {
  luecken: ReturnType<typeof kranLuecken>; kraene: SimProjekt["kraene"]; onZuKranplanung?: () => void; onZuKranoptik?: () => void;
  verlaengern?: { label: string; title: string; onClick: () => void };
}) {
  const datum = (iso: string) => iso.split("-").reverse().join(".");
  const zeitraeume = (tage: string[]) => {
    const z = tageAlsZeitraeume(tage);
    return z.slice(0, 4).map(r => r.von === r.bis ? datum(r.von) : `${datum(r.von)}–${datum(r.bis)}`).join(", ") + (z.length > 4 ? " …" : "");
  };
  const ohnePersonal = [...luecken.ohnePersonal].map(([id, l]) => ({ name: (kraene ?? []).find(k => k.id === id)?.name ?? "Kran", l }));
  if (luecken.ohneKran.tage.length === 0 && ohnePersonal.length === 0) return null;
  const stil: React.CSSProperties = { fontSize: 11, color: "#8a5a00", background: "#fff7e6", border: "1px solid #f5d9a8", padding: "6px 10px", marginBottom: 6,
    display: "flex", alignItems: "center", flexWrap: "wrap", gap: "4px 8px" };
  const knopfStil: React.CSSProperties = { flexShrink: 0, fontSize: 11, padding: "2px 8px", whiteSpace: "nowrap" };
  const navigation = (
    <span style={{ marginLeft: "auto", display: "flex", gap: 6, flexWrap: "wrap" }}>
      {onZuKranplanung && <button type="button" className="tc-btn-secondary" onClick={onZuKranplanung} title="Zu Tab Ressourcen → Kräne & Personal" style={knopfStil}>Zur Kranplanung →</button>}
      {onZuKranoptik && <button type="button" className="tc-btn-secondary" onClick={onZuKranoptik} title="Zu Tab AVOR → Kranoptik" style={knopfStil}>Zur Kranoptik →</button>}
    </span>
  );
  return (<>
    {luecken.ohneKran.tage.length > 0 && (
      <div style={stil} title="Diese Arbeiten brauchen einen Kran (kranpflichtige Leistungsposition), aber an diesen Tagen ist keiner der Kräne des Tasks verfügbar bzw. dem Task ist kein Kran zugewiesen. Kran in Tab Ressourcen → Kräne & Personal ergänzen oder seine Verfügbarkeit (von/bis) anpassen, bei mehreren Kränen in Tab Kalkulation → Kräne zuweisen.">
        <span>⚠ <strong>Kran fehlt:</strong> {luecken.ohneKran.taskIds.length} Task{luecken.ohneKran.taskIds.length === 1 ? "" : "s"} mit kranpflichtiger Arbeit ohne verfügbaren Kran ({zeitraeume(luecken.ohneKran.tage)})</span>
        <span style={{ marginLeft: "auto", display: "flex", gap: 6, flexWrap: "wrap" }}>
          {verlaengern && <button type="button" className="tc-btn-primary" onClick={verlaengern.onClick} title={verlaengern.title} style={knopfStil}>{verlaengern.label}</button>}
          {navigation}
        </span>
      </div>
    )}
    {ohnePersonal.map(({ name, l }) => (
      <div key={name} style={stil} title="An diesen Tagen ist der Kran verfügbar und es gibt Arbeit an seinen Tasks, aber kein Personal unter dem Kran (Tab Ressourcen → Kräne & Personal, von/bis der Unternehmer). Auslastung optimieren plant dort ohne Personalgrenze.">
        <span>⚠ <strong>{name} ohne Personal:</strong> Arbeit an {l.taskIds.length} Task{l.taskIds.length === 1 ? "" : "s"}, aber kein Personal unter dem Kran ({zeitraeume(l.tage)})</span>
        {navigation}
      </div>
    ))}
  </>);
}

/** Unternehmer-Feld: frei eintippen oder aus allen bekannten Unternehmern wählen — die Liste zeigt immer alle, nicht nur die zum
 *  Eingetippten passenden (anders als ein Browser-datalist). */
function UnternehmerFeld({ wert, alle, disabled, unbekannt, onChange }: { wert: string; alle: string[]; disabled?: boolean; unbekannt: boolean; onChange: (u: string) => void }) {
  const [offen, setOffen] = useState(false);
  return (
    <div style={{ position: "relative" }}>
      <input disabled={disabled} value={wert} placeholder="Unternehmer"
        title={unbekannt ? "Keine Leistungsposition hat diesen Unternehmer (Spalte Unternehmer in den Kategorien oben)" : undefined}
        onFocus={() => setOffen(true)} onBlur={() => setTimeout(() => setOffen(false), 150)} onChange={e => onChange(e.target.value)}
        style={{ ...feld, width: "100%", boxSizing: "border-box", paddingRight: 18, borderColor: unbekannt ? "#e08a00" : "#d4dce4" }} />
      {!disabled && alle.length > 0 && (
        <span onMouseDown={e => { e.preventDefault(); setOffen(o => !o); }}
          style={{ position: "absolute", right: 4, top: "50%", transform: "translateY(-50%)", fontSize: 9, color: "var(--tc-text-3)", cursor: "pointer" }}>▾</span>
      )}
      {offen && !disabled && alle.length > 0 && (
        <div style={{ position: "absolute", top: "100%", left: 0, right: 0, zIndex: 20, background: "#fff", border: "1px solid var(--tc-border)", boxShadow: "0 2px 8px rgba(0,0,0,.12)", maxHeight: 180, overflowY: "auto" }}>
          {alle.map(u => (
            <div key={u} onMouseDown={e => { e.preventDefault(); onChange(u); setOffen(false); }}
              style={{ fontSize: 11, padding: "4px 6px", cursor: "pointer", background: u === wert.trim() ? "var(--tc-blue-bg)" : undefined }}>{u}</div>
          ))}
        </div>
      )}
    </div>
  );
}

export default function KranPersonalEditor({ sim, updateSim, readOnly, bekannteUnternehmer, alleUnternehmer, onZuKranoptik }: Props) {
  const kraene = sim.kraene ?? [];
  const speichern = (neu: Kran[]) => updateSim({ ...sim, kraene: neu });
  const kranAendern = (id: string, patch: Partial<Kran>) => speichern(kraene.map(k => k.id === id ? { ...k, ...patch } : k));
  // Verfügbarkeit des Krans ändern: Personal-Zeilen, die genau am bisherigen Anfang/Ende des Krans anfangen/aufhören, ziehen mit
  // (wie kranVerlaengern) — sonst müsste jedes Datum mehrmals eingegeben werden
  const kranZeitraumAendern = (kran: Kran, feldName: "verfuegbarVon" | "verfuegbarBis", wert: string | undefined) => {
    const alt = kran[feldName], zeile = feldName === "verfuegbarVon" ? "von" : "bis";
    kranAendern(kran.id, { [feldName]: wert,
      personal: kran.personal?.map(p => alt && p[zeile] === alt ? { ...p, [zeile]: wert } : p) });
  };
  const personalAendern = (kran: Kran, liste: KranPersonal[]) => kranAendern(kran.id, { personal: liste });

  function kranEntfernen(id: string) {
    const zugeordnet = sim.tasks.filter(t => t.kraene?.includes(id)).length;
    if (zugeordnet > 0 && !confirm(`Dieser Kran ist ${zugeordnet} Task${zugeordnet === 1 ? "" : "s"} zugeordnet — die Zuordnung wird dort ebenfalls entfernt. Fortfahren?`)) return;
    updateSim({ ...sim, kraene: kraene.filter(k => k.id !== id), tasks: kranAusTasksEntfernen(sim.tasks, id) });
  }

  return (
    <div>
      {(() => {
        const luecken = kranLuecken(sim.tasks, kraene, sim.stammdaten ?? LEERE_STAMMDATEN, sim.kalender ?? LEERER_KALENDER);
        const v = readOnly ? null : kranVerlaengernVorschlag(sim.tasks, kraene, luecken.ohneKran);
        const kran = v && kraene.find(k => k.id === v.kranId);
        const d = (iso: string) => iso.split("-").reverse().join(".");
        const verlaengern = v && kran ? {
          label: v.von && v.bis ? `${kran.name}: ${d(v.von)}–${d(v.bis)} verfügbar` : v.bis ? `${kran.name} bis ${d(v.bis)} verlängern` : `${kran.name} ab ${d(v.von!)} verfügbar`,
          title: `Verfügbarkeit von ${kran.name} so anpassen, dass die betroffenen Tasks einen Kran haben — Personal-Zeilen, die genau am bisherigen ${v.bis ? "Ende" : "Anfang"} ${v.bis ? "aufhören" : "anfangen"}, werden mit angepasst. Rückgängig oben in der Kopfzeile.`,
          onClick: () => speichern(kranVerlaengern(kraene, v)),
        } : undefined;
        return <KranLueckenHinweis luecken={luecken} kraene={kraene} onZuKranoptik={onZuKranoptik} verlaengern={verlaengern} />;
      })()}
      {kraene.length === 0 && <div style={{ fontSize: 11, color: "var(--tc-text-3)", marginBottom: 8 }}>Noch keine Kräne angelegt.</div>}
      {kraene.map(kran => {
        const { summe, tag } = maxSumme(kran);
        const tasksAmKran = sim.tasks.filter((t, i) => !t.isGroup && !istGruppe(sim.tasks, i) && kraeneDesTasks(t, kraene).includes(kran.id)).length;
        return (
          <div key={kran.id} style={{ border: "1px solid var(--tc-border-light)", padding: "8px 10px", marginBottom: 8 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
              <input disabled={readOnly} value={kran.name} onChange={e => kranAendern(kran.id, { name: e.target.value })}
                style={{ ...feld, width: 110, fontSize: 12, fontWeight: 700 }} />
              <label style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 11, color: "var(--tc-text-2)" }}>
                von <input type="date" disabled={readOnly} value={kran.verfuegbarVon ?? ""} onChange={e => kranZeitraumAendern(kran, "verfuegbarVon", e.target.value || undefined)} style={feld} />
              </label>
              <label style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 11, color: "var(--tc-text-2)" }}>
                bis <input type="date" disabled={readOnly} value={kran.verfuegbarBis ?? ""} onChange={e => kranZeitraumAendern(kran, "verfuegbarBis", e.target.value || undefined)} style={feld} />
              </label>
              <span style={{ fontSize: 11, fontWeight: 600, color: "var(--tc-text-2)" }}
                title="Summe des Personals aller Unternehmer (grösster Tageswert) — Höchstzahl der Leute unter diesem Kran pro Tag">
                {summe} Pers. unter dem Kran
              </span>
              <span style={{ fontSize: 10, color: "var(--tc-text-3)" }}
                title={kraene.length === 1 ? "Bei nur einem Kran gelten alle Tasks ohne Kran-Zuweisung (Tab Kalkulation → Kräne) automatisch als Tasks dieses Krans" : "Kran-Zuweisung in Tab Kalkulation → Spalte Kräne"}>
                {tasksAmKran} Task{tasksAmKran === 1 ? "" : "s"}{kraene.length === 1 ? " (inkl. Tasks ohne Zuweisung)" : " zugewiesen"}</span>
              {!readOnly && (
                <button className="tc-btn-ghost" style={{ fontSize: 11, padding: "2px 6px", marginLeft: "auto" }} onClick={() => kranEntfernen(kran.id)}>Entfernen</button>
              )}
            </div>
            <div style={{ marginTop: 6, paddingLeft: 12 }}>
              {(kran.personal ?? []).length > 0 && (() => {
                const abweichend = (kran.personal ?? []).some(p => (p.von ?? "") !== (kran.verfuegbarVon ?? "") || (p.bis ?? "") !== (kran.verfuegbarBis ?? ""));
                return (
                  <div style={{ display: "grid", gridTemplateColumns: "180px 70px 130px 130px 20px", columnGap: 6, alignItems: "end", fontSize: 9, fontWeight: 600, color: "var(--tc-text-3)", marginBottom: 2 }}>
                    <span>Unternehmer</span><span>Personen</span>
                    <span style={{ gridColumn: "3 / 5", display: "grid", gridTemplateColumns: "130px 130px", columnGap: 6, alignItems: "end" }}>
                      <span>von</span>
                      <span style={{ display: "flex", alignItems: "end", justifyContent: "space-between" }}>bis
                        {!readOnly && abweichend && (
                          <button type="button" className="tc-btn-ghost" style={{ fontSize: 9, padding: "0 5px", lineHeight: "15px", fontWeight: 600 }}
                            title={`Zeitraum des Krans (von/bis oben) für alle Unternehmer übernehmen. Danach ziehen sie mit, wenn sich von/bis des Krans ändert.`}
                            onClick={() => personalAendern(kran, (kran.personal ?? []).map(p => ({ ...p, von: kran.verfuegbarVon, bis: kran.verfuegbarBis })))}>
                            ↓ wie Kran
                          </button>
                        )}
                      </span>
                    </span>
                    <span />
                  </div>
                );
              })()}
              {(kran.personal ?? []).map(p => {
                const aendern = (patch: Partial<KranPersonal>) => personalAendern(kran, (kran.personal ?? []).map(x => x.id === p.id ? { ...x, ...patch } : x));
                const unbekannt = p.unternehmer.trim() !== "" && !bekannteUnternehmer.includes(p.unternehmer.trim());
                return (
                  <div key={p.id} style={{ display: "grid", gridTemplateColumns: "180px 70px 130px 130px 20px", columnGap: 6, alignItems: "center", marginBottom: 3 }}>
                    <UnternehmerFeld wert={p.unternehmer} alle={alleUnternehmer} disabled={readOnly} unbekannt={unbekannt} onChange={u => aendern({ unternehmer: u })} />
                    <input type="number" className="no-spinner" disabled={readOnly} value={p.personen || ""} min={0}
                      onChange={e => aendern({ personen: Number(e.target.value) || 0 })} style={feld} />
                    <input type="date" disabled={readOnly} value={p.von ?? ""} onChange={e => aendern({ von: e.target.value || undefined })} style={feld} />
                    <input type="date" disabled={readOnly} value={p.bis ?? ""} onChange={e => aendern({ bis: e.target.value || undefined })} style={feld} />
                    {!readOnly ? (
                      <button title="Entfernen" onClick={() => personalAendern(kran, (kran.personal ?? []).filter(x => x.id !== p.id))}
                        style={{ background: "none", border: "none", cursor: "pointer", fontSize: 14, color: "var(--tc-text-3)", padding: 0, lineHeight: 1 }}>×</button>
                    ) : <span />}
                  </div>
                );
              })}
              {!readOnly && (
                <button className="tc-btn-ghost" style={{ fontSize: 10, padding: "2px 8px", marginTop: 2 }}
                  onClick={() => {
                    // Vorbelegung von oben: Zeitraum und Personen der letzten Zeile, sonst die Verfügbarkeit des Krans; als Unternehmer der
                    // erste, der unter diesem Kran noch fehlt
                    const liste = kran.personal ?? [];
                    const letzte = liste[liste.length - 1];
                    const vorhanden = new Set(liste.map(x => x.unternehmer.trim()));
                    personalAendern(kran, [...liste, { id: crypto.randomUUID(),
                      unternehmer: alleUnternehmer.find(u => !vorhanden.has(u)) ?? bekannteUnternehmer[0] ?? "",
                      personen: letzte?.personen ?? 0,
                      von: letzte ? letzte.von : kran.verfuegbarVon, bis: letzte ? letzte.bis : kran.verfuegbarBis }]);
                  }}>
                  + Unternehmer
                </button>
              )}
              {summe > RICHTWERT_PERSONEN_PRO_KRAN && (
                <div style={{ fontSize: 10, color: "#b5750a", marginTop: 4 }}>
                  ⚠ {summe} Personen{tag ? ` ab ${tag.split("-").reverse().join(".")}` : ""} — mehr als der Richtwert von {RICHTWERT_PERSONEN_PRO_KRAN} Personen, die ein Kran etwa versorgen kann.
                </div>
              )}
            </div>
          </div>
        );
      })}
      {!readOnly && (
        <button className="tc-btn-secondary" style={{ fontSize: 11, padding: "5px 10px" }} onClick={() => speichern([...kraene, neuerKran(kraene)])}>+ Kran hinzufügen</button>
      )}
      <UnternehmerPersonalEditor sim={sim} updateSim={updateSim} readOnly={readOnly} bekannteUnternehmer={bekannteUnternehmer} alleUnternehmer={alleUnternehmer} />
    </div>
  );
}

const isoTagDanach = (iso: string) => {
  const d = new Date(iso + "T00:00:00");
  d.setDate(d.getDate() + 1);
  return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
};

/** Personal je Unternehmer über alle Kräne (SimProjekt.unternehmerPersonal): je Zeile Unternehmer, «höchstens n Personen» (harte
 *  Grenze für alle seine Leute — Pools, Kolonnen ohne Kran, Überzug) oder «wie Leistungsposition» (z.B. Akkordant: jede Arbeit mit
 *  den Min. Personen ihrer Leistungsposition aus Tab Ressourcen, eigene Kolonne, auch parallel — nur die Kranzeit gilt), von/bis. «↓ von Kränen übernehmen» füllt die Zeilen aus dem Personal unter den Kränen (personalJeUnternehmerAusKraenen). */
function UnternehmerPersonalEditor({ sim, updateSim, readOnly, bekannteUnternehmer, alleUnternehmer }: {
  sim: SimProjekt; updateSim: (s: SimProjekt) => void; readOnly?: boolean; bekannteUnternehmer: string[]; alleUnternehmer: string[];
}) {
  const liste = sim.unternehmerPersonal ?? [];
  // «↓ von Kränen übernehmen»: je Unternehmer unter den Kränen dessen Summe je Zeitraum als «höchstens» — ersetzt seine bisherigen
  // «höchstens»-Zeilen; «wie Leistungsposition» und Unternehmer ohne Personal unter einem Kran bleiben
  const ausKraenen = personalJeUnternehmerAusKraenen(sim.kraene ?? []);
  function vonKraenenUebernehmen() {
    const betroffen = new Set(ausKraenen.map(z => z.unternehmer));
    const ersetzt = liste.filter(z => !z.unbegrenzt && betroffen.has(z.unternehmer.trim()));
    if (ersetzt.length > 0 && !confirm(`${ersetzt.length} bestehende «höchstens»-Zeile${ersetzt.length === 1 ? "" : "n"} von ${[...new Set(ersetzt.map(z => z.unternehmer.trim()))].join(", ")} werden durch die Werte der Kräne ersetzt. Fortfahren?`)) return;
    const bleiben = liste.filter(z => !ersetzt.includes(z));
    // «wie Leistungsposition» desselben Unternehmers geht weiterhin vor (unternehmerAmTag) — übernommene Zeilen nach seinen Zeilen
    speichern([...bleiben, ...ausKraenen.map(z => ({ id: crypto.randomUUID(), ...z }))]);
  }
  const speichern = (neu: UnternehmerPersonal[]) => updateSim({ ...sim, unternehmerPersonal: neu.length ? neu : undefined });
  const aendern = (id: string, patch: Partial<UnternehmerPersonal>) => speichern(liste.map(z => z.id === id ? { ...z, ...patch } : z));
  // Unternehmer mit «wie Leistungsposition», die auch Personal unter einem Kran haben — dieses Personal wird dann nicht verwendet
  const mitPool = new Set((sim.kraene ?? []).flatMap(k => (k.personal ?? []).filter(p => p.personen > 0).map(p => p.unternehmer.trim())));
  // Min. Personen der Leistungspositionen je Unternehmer (Tab Ressourcen) — Anzeige bei «wie Leistungsposition»
  const positionenVon = (u: string) => (sim.stammdaten?.gewerke ?? []).flatMap(g => g.raten
    .filter(r => (r.unternehmer ?? "").trim() === u.trim() && r.anzahlPersonen > 0 && r.kuerzel.trim())
    .map(r => ({ label: `${g.label} · ${r.kuerzel.trim()}`, personen: r.anzahlPersonen })));
  const spalten = "180px 150px 90px 130px 130px 20px";
  return (
    <div style={{ marginTop: 14, borderTop: "1px solid var(--tc-border-light)", paddingTop: 10 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", marginBottom: 4 }}>
        <span style={{ fontSize: 12, fontWeight: 700, color: "var(--tc-text)" }}>Personal je Unternehmer (über alle Kräne)</span>
        <span style={{ fontSize: 10, color: "var(--tc-text-3)" }}
          title={"«höchstens»: so viele Leute des Unternehmers arbeiten gleichzeitig höchstens — über alle Kräne und Arbeiten zusammen (auch nicht kranpflichtige wie Beton, ohne Überzug). Mehrere Zeilen mit von/bis = Personal im Zeitverlauf, z.B. 7, ab drei Wochen später 10.\n«wie Leistungsposition»: z.B. Akkordant — jede Arbeit bekommt die Min. Personen ihrer Leistungsposition (Tab Ressourcen, Kategorien oben) als eigene Kolonne, auch mehrere gleichzeitig; sein Personal unter dem Kran wird nicht verwendet. Die Kranzeit gilt weiterhin (Kranzeit % in den Kategorien oben).\nOhne Zeile gilt wie bisher das Personal unter den Kränen. «↓ von Kränen übernehmen» füllt die Zeilen aus dem Personal unter den Kränen. Wirkt beim nächsten Optimieren (bzw. sofort mit «Automatisch nachführen»)."}>
          ⓘ Grenze bzw. wie Leistungsposition, je Zeitraum</span>
        {!readOnly && (
          <button type="button" className="tc-btn-secondary" style={{ fontSize: 11, padding: "3px 10px", marginLeft: "auto" }} disabled={ausKraenen.length === 0}
            title={ausKraenen.length === 0 ? "Unter den Kränen ist noch kein Personal erfasst"
              : "Personal unter den Kränen übernehmen: je Unternehmer die Summe über alle Kräne und Zeiträume als «höchstens», z.B.\n"
                + ausKraenen.slice(0, 6).map(z => `${z.unternehmer}: ${z.personen}${z.von ? " ab " + z.von.split("-").reverse().join(".") : ""}${z.bis ? " bis " + z.bis.split("-").reverse().join(".") : ""}`).join("\n")
                + "\nBisherige «höchstens»-Zeilen dieser Unternehmer werden ersetzt (mit Rückfrage). Rückgängig oben in der Kopfzeile."}
            onClick={vonKraenenUebernehmen}>↓ von Kränen übernehmen</button>
        )}
      </div>
      {liste.length > 0 && (
        <div style={{ display: "grid", gridTemplateColumns: spalten, columnGap: 6, fontSize: 9, fontWeight: 600, color: "var(--tc-text-3)", marginBottom: 2 }}>
          <span>Unternehmer</span><span>Personal</span><span>Personen</span><span>von</span><span>bis</span><span />
        </div>
      )}
      {liste.map(z => {
        const unbekannt = z.unternehmer.trim() !== "" && !bekannteUnternehmer.includes(z.unternehmer.trim());
        const ohneZahl = !z.unbegrenzt && !(z.personen != null && z.personen >= 1);
        return (
          <div key={z.id} style={{ marginBottom: 3 }}>
            <div style={{ display: "grid", gridTemplateColumns: spalten, columnGap: 6, alignItems: "center" }}>
              <UnternehmerFeld wert={z.unternehmer} alle={alleUnternehmer} disabled={readOnly} unbekannt={unbekannt} onChange={u => aendern(z.id, { unternehmer: u })} />
              <select disabled={readOnly} value={z.unbegrenzt ? "noetig" : "max"} style={feld}
                onChange={e => aendern(z.id, e.target.value === "noetig" ? { unbegrenzt: true, personen: undefined } : { unbegrenzt: undefined, personen: z.personen ?? 1 })}>
                <option value="max">höchstens</option>
                <option value="noetig">wie Leistungsposition</option>
              </select>
              {z.unbegrenzt ? (() => {
                // Min. Personen aus Tab Ressourcen: eine Zahl oder von–bis, die Positionen im Tooltip
                const pos = positionenVon(z.unternehmer);
                const werte = pos.map(p => p.personen);
                const min = Math.min(...werte), max = Math.max(...werte);
                return <span style={{ fontSize: 11, color: pos.length ? "var(--tc-text-2)" : "#b5750a", whiteSpace: "nowrap" }}
                  title={pos.length ? "Min. Personen je Leistungsposition (Tab Ressourcen):\n" + pos.map(p => `${p.label}: ${p.personen}`).join("\n")
                    : "Dieser Unternehmer ist bei keiner Leistungsposition eingetragen (Spalte Unternehmer in den Kategorien oben)"}>
                  {pos.length ? (min === max ? `${min} P` : `${min}–${max} P`) : "keine Position"}</span>;
              })() : (
                <input type="number" className="no-spinner" disabled={readOnly} min={1} value={z.personen ?? ""} placeholder="Pers."
                  onChange={e => { const n = Math.floor(Number(e.target.value)); aendern(z.id, { personen: n >= 1 ? n : undefined }); }}
                  style={{ ...feld, borderColor: ohneZahl ? "#e08a00" : "#d4dce4" }}
                  title={ohneZahl ? "Mindestens 1 Person — ohne Zahl gilt keine Grenze" : undefined} />
              )}
              <input type="date" disabled={readOnly} value={z.von ?? ""} onChange={e => aendern(z.id, { von: e.target.value || undefined })} style={feld} />
              <input type="date" disabled={readOnly} value={z.bis ?? ""} onChange={e => aendern(z.id, { bis: e.target.value || undefined })} style={feld} />
              {!readOnly ? (
                <button title="Entfernen" onClick={() => speichern(liste.filter(x => x.id !== z.id))}
                  style={{ background: "none", border: "none", cursor: "pointer", fontSize: 14, color: "var(--tc-text-3)", padding: 0, lineHeight: 1 }}>×</button>
              ) : <span />}
            </div>
            {z.unbegrenzt && mitPool.has(z.unternehmer.trim()) && (
              <div style={{ fontSize: 10, color: "#b5750a", marginTop: 1 }}>⚠ {z.unternehmer.trim()} hat auch Personal unter einem Kran — mit «wie Leistungsposition» wird es in diesem Zeitraum nicht verwendet.</div>
            )}
          </div>
        );
      })}
      {!readOnly && (
        <button className="tc-btn-ghost" style={{ fontSize: 10, padding: "2px 8px", marginTop: 2 }}
          title="Neue Zeile — hat die letzte Zeile ein Ende (bis), derselbe Unternehmer ab dem Tag danach (Personal im Zeitverlauf)"
          onClick={() => {
            const letzte = liste[liste.length - 1];
            const vorhanden = new Set(liste.map(x => x.unternehmer.trim()));
            speichern([...liste, letzte?.bis
              ? { id: crypto.randomUUID(), unternehmer: letzte.unternehmer, unbegrenzt: letzte.unbegrenzt, personen: letzte.personen, von: isoTagDanach(letzte.bis) }
              : { id: crypto.randomUUID(), unternehmer: alleUnternehmer.find(u => !vorhanden.has(u)) ?? bekannteUnternehmer[0] ?? "", personen: 1 }]);
          }}>
          + Zeile
        </button>
      )}
    </div>
  );
}
