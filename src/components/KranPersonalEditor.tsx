// KranPersonalEditor.tsx — Tab Ressourcen → "Kräne & Personal": Kräne mit Verfügbarkeit (von/bis), darunter das Personal unter
// dem Kran je Unternehmer und Zeitraum. Grundlage für "Perfekte Auslastung" (Tab AVOR) und "Auslastung optimieren" (Tab Bauteile):
// Personal desselben Unternehmers unter einem Kran ist ein Pool von Allroundern; die Summe aller Unternehmer ist die Höchstzahl
// der Leute an kranpflichtigen Arbeiten dieses Krans pro Tag (Richtwert 13 nur als Hinweis).
import type { SimProjekt, Kran, KranPersonal } from "../types";
import { istGruppe } from "../types";
import { neuerKran, kranAusTasksEntfernen, kraeneDesTasks, kranPersonalAmTag, RICHTWERT_PERSONEN_PRO_KRAN, kranLuecken, tageAlsZeitraeume } from "./kranHelpers";
import { LEERE_STAMMDATEN } from "./stammdatenHelpers";
import { LEERER_KALENDER } from "./kalenderHelpers";

interface Props { sim: SimProjekt; updateSim: (s: SimProjekt) => void; readOnly?: boolean; unternehmerListeId: string; bekannteUnternehmer: string[] }

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
 *  manchen Tagen gearbeitet wird, ohne dass Personal unter dem Kran erfasst ist (siehe kranLuecken). */
export function KranLueckenHinweis({ luecken, kraene }: { luecken: ReturnType<typeof kranLuecken>; kraene: SimProjekt["kraene"] }) {
  const datum = (iso: string) => iso.split("-").reverse().join(".");
  const zeitraeume = (tage: string[]) => {
    const z = tageAlsZeitraeume(tage);
    return z.slice(0, 4).map(r => r.von === r.bis ? datum(r.von) : `${datum(r.von)}–${datum(r.bis)}`).join(", ") + (z.length > 4 ? " …" : "");
  };
  const ohnePersonal = [...luecken.ohnePersonal].map(([id, l]) => ({ name: (kraene ?? []).find(k => k.id === id)?.name ?? "Kran", l }));
  if (luecken.ohneKran.tage.length === 0 && ohnePersonal.length === 0) return null;
  const stil: React.CSSProperties = { fontSize: 11, color: "#8a5a00", background: "#fff7e6", border: "1px solid #f5d9a8", padding: "6px 10px", marginBottom: 6 };
  return (<>
    {luecken.ohneKran.tage.length > 0 && (
      <div style={stil} title="Diese Arbeiten brauchen einen Kran (kranpflichtige Leistungsposition), aber an diesen Tagen ist keiner der Kräne des Tasks verfügbar bzw. dem Task ist kein Kran zugewiesen. Kran in Tab Ressourcen → Kräne & Personal ergänzen oder seine Verfügbarkeit (von/bis) anpassen, bei mehreren Kränen in Tab Kalkulation → Kräne zuweisen.">
        ⚠ <strong>Kran fehlt:</strong> {luecken.ohneKran.taskIds.length} Task{luecken.ohneKran.taskIds.length === 1 ? "" : "s"} mit kranpflichtiger Arbeit ohne verfügbaren Kran ({zeitraeume(luecken.ohneKran.tage)})
      </div>
    )}
    {ohnePersonal.map(({ name, l }) => (
      <div key={name} style={stil} title="An diesen Tagen ist der Kran verfügbar und es gibt Arbeit an seinen Tasks, aber kein Personal unter dem Kran (Tab Ressourcen → Kräne & Personal, von/bis der Unternehmer). Auslastung optimieren plant dort ohne Personalgrenze.">
        ⚠ <strong>{name} ohne Personal:</strong> Arbeit an {l.taskIds.length} Task{l.taskIds.length === 1 ? "" : "s"}, aber kein Personal unter dem Kran ({zeitraeume(l.tage)})
      </div>
    ))}
  </>);
}

export default function KranPersonalEditor({ sim, updateSim, readOnly, unternehmerListeId, bekannteUnternehmer }: Props) {
  const kraene = sim.kraene ?? [];
  const speichern = (neu: Kran[]) => updateSim({ ...sim, kraene: neu });
  const kranAendern = (id: string, patch: Partial<Kran>) => speichern(kraene.map(k => k.id === id ? { ...k, ...patch } : k));
  const personalAendern = (kran: Kran, liste: KranPersonal[]) => kranAendern(kran.id, { personal: liste });

  function kranEntfernen(id: string) {
    const zugeordnet = sim.tasks.filter(t => t.kraene?.includes(id)).length;
    if (zugeordnet > 0 && !confirm(`Dieser Kran ist ${zugeordnet} Task${zugeordnet === 1 ? "" : "s"} zugeordnet — die Zuordnung wird dort ebenfalls entfernt. Fortfahren?`)) return;
    updateSim({ ...sim, kraene: kraene.filter(k => k.id !== id), tasks: kranAusTasksEntfernen(sim.tasks, id) });
  }

  return (
    <div>
      <div style={{ fontSize: 10, color: "var(--tc-text-3)", marginBottom: 8, lineHeight: 1.5 }}>
        Je Kran die Verfügbarkeit und darunter das Personal je Unternehmer. Die Summe ist die Höchstzahl der Leute, die pro Tag unter
        diesem Kran an kranpflichtigen Arbeiten arbeiten (beim Optimieren höchstens 1–2 mehr, wenn sonst Leute untätig wären). Leute
        desselben Unternehmers sind Allrounder und besetzen jede seiner Leistungspositionen an Tasks dieses Krans (Kran-Zuweisung in
        Tab Kalkulation, bei nur einem Kran automatisch). Von/bis leer = ganze Verfügbarkeit des Krans.
      </div>
      <KranLueckenHinweis luecken={kranLuecken(sim.tasks, kraene, sim.stammdaten ?? LEERE_STAMMDATEN, sim.kalender ?? LEERER_KALENDER)} kraene={kraene} />
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
                von <input type="date" disabled={readOnly} value={kran.verfuegbarVon ?? ""} onChange={e => kranAendern(kran.id, { verfuegbarVon: e.target.value || undefined })} style={feld} />
              </label>
              <label style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 11, color: "var(--tc-text-2)" }}>
                bis <input type="date" disabled={readOnly} value={kran.verfuegbarBis ?? ""} onChange={e => kranAendern(kran.id, { verfuegbarBis: e.target.value || undefined })} style={feld} />
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
              {(kran.personal ?? []).length > 0 && (
                <div style={{ display: "grid", gridTemplateColumns: "180px 70px 130px 130px 20px", columnGap: 6, fontSize: 9, fontWeight: 600, color: "var(--tc-text-3)", marginBottom: 2 }}>
                  <span>Unternehmer</span><span>Personen</span><span>von</span><span>bis</span><span />
                </div>
              )}
              {(kran.personal ?? []).map(p => {
                const aendern = (patch: Partial<KranPersonal>) => personalAendern(kran, (kran.personal ?? []).map(x => x.id === p.id ? { ...x, ...patch } : x));
                const unbekannt = p.unternehmer.trim() !== "" && !bekannteUnternehmer.includes(p.unternehmer.trim());
                return (
                  <div key={p.id} style={{ display: "grid", gridTemplateColumns: "180px 70px 130px 130px 20px", columnGap: 6, alignItems: "center", marginBottom: 3 }}>
                    <input disabled={readOnly} list={unternehmerListeId} value={p.unternehmer} placeholder="Unternehmer"
                      title={unbekannt ? "Keine Leistungsposition hat diesen Unternehmer (Spalte Unternehmer in den Kategorien oben)" : undefined}
                      onChange={e => aendern({ unternehmer: e.target.value })}
                      style={{ ...feld, borderColor: unbekannt ? "#e08a00" : "#d4dce4" }} />
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
                  onClick={() => personalAendern(kran, [...(kran.personal ?? []), { id: crypto.randomUUID(), unternehmer: bekannteUnternehmer[0] ?? "", personen: 0 }])}>
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
    </div>
  );
}
