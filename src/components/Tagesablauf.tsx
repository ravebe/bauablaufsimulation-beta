// Tagesablauf.tsx — Tab AVOR → Personalauslastung, nach Klick auf einen Tag unter der Tabelle: wie das Gantt diesen Tag rechnet.
// Je laufendem Task ein Balken über den Arbeitstag: die Schritte nacheinander (Arbeitsablauf je Leistungsposition), je Phase
// Gewerk, Personen (Min. Personen aus Tab Ressourcen) und Stunden (Arbeit des Tages ÷ Personen) — dieselbe Rechnung wie
// aufwandJeTagUndPhaseFuerTask, auf der Tabelle und Diagramm beruhen. Darunter die Summen, die zur Tabelle führen.
import type { Task } from "../types";
import type { Stammdaten } from "./stammdatenHelpers";
import type { Kalender } from "./kalenderHelpers";
import { aufwandJeTagUndPhaseFuerTask } from "./avorHelpers";
import type { EingeplantTag } from "./kranHelpers";
import { fmtZahl } from "./zahlFormat";
import { FARBEN } from "./cockpitCharts";

const MAX_TASKS = 12;

interface Props {
  iso: string; tasks: Task[]; stammdaten: Stammdaten; kalender: Kalender;
  farbeJeGewerk: Map<string, string>; eingeplant?: EingeplantTag; mitKranPersonal: boolean;
}

export default function Tagesablauf({ iso, tasks, stammdaten, kalender, farbeJeGewerk, eingeplant, mitKranPersonal }: Props) {
  const std = stammdaten.arbeitszeitStdProTag;
  const gewerkLabel = new Map(stammdaten.gewerke.map(g => [g.key, g.label]));

  // je Task die Schritte des Tages: Phasen eines Schritts gleichzeitig, Schritte nacheinander
  const zeilen = tasks.flatMap(t => {
    const liste = aufwandJeTagUndPhaseFuerTask(t, stammdaten, kalender).get(iso)?.filter(a => a.personenstunden > 1e-9) ?? [];
    if (liste.length === 0) return [];
    const jeSchritt = new Map<number, { gewerk: string; kuerzel: string; personen: number; stunden: number; arbeit: number }[]>();
    for (const a of liste) {
      const phasen = jeSchritt.get(a.schritt) ?? [];
      phasen.push({ gewerk: a.phase.gewerkKey, kuerzel: a.phase.position.split("::")[1] ?? "", personen: a.phase.kolonne,
        stunden: a.personenstunden / a.phase.kolonne, arbeit: a.personenstunden });
      jeSchritt.set(a.schritt, phasen);
    }
    const schritte = [...jeSchritt.entries()].sort((x, y) => x[0] - y[0]).map(([, phasen]) => ({ phasen, stunden: Math.max(...phasen.map(p => p.stunden)) }));
    return [{ t, schritte, stunden: schritte.reduce((s, x) => s + x.stunden, 0), arbeit: liste.reduce((s, a) => s + a.personenstunden, 0) }];
  });
  if (zeilen.length === 0) return null;

  const arbeit = zeilen.reduce((s, z) => s + z.arbeit, 0);
  const skala = Math.max(std, ...zeilen.map(z => z.stunden)); // Balkenbreite: Arbeitstag, oder länger, wenn ein Task überzieht
  const sichtbar = zeilen.slice(0, MAX_TASKS);
  const datum = iso.split("-").reverse().join(".");

  return (
    <div style={{ margin: "6px 0 10px", padding: "8px 10px", background: "#fafbfc", border: `1px solid ${FARBEN.gridline}`, fontSize: 11 }}>
      <div style={{ fontWeight: 600, color: FARBEN.textPrimaer, marginBottom: 2 }}>So rechnet das Gantt den {datum}</div>
      <div style={{ color: FARBEN.textSekundaer, marginBottom: 6, lineHeight: 1.5 }}>
        Jeder Task arbeitet mit den Min. Personen seiner Leistungspositionen (Tab Ressourcen). Die Schritte eines Tasks folgen
        nacheinander (z.B. Schalung → Bewehrung → Beton), verschiedene Tasks laufen gleichzeitig. Die Arbeit eines Tasks verteilt sich
        gleichmässig über seine Dauer im Gantt — hier der Anteil dieses Tages. Balken = {fmtZahl(std)} h Arbeitstag.
      </div>
      {sichtbar.map(z => (
        <div key={z.t.id} style={{ display: "grid", gridTemplateColumns: "minmax(110px, 180px) 1fr 52px", alignItems: "center", columnGap: 8, marginBottom: 3 }}>
          <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", color: FARBEN.textPrimaer }} title={z.t.name}>{z.t.name}</span>
          <div style={{ position: "relative", height: 18, background: "#eef1f4" }}>
            {/* Ende des Arbeitstags, falls ein Task länger braucht */}
            {skala > std && <div style={{ position: "absolute", left: `${std / skala * 100}%`, top: -2, bottom: -2, borderLeft: `1.5px dashed ${FARBEN.status.critical}` }} />}
            {(() => {
              let von = 0;
              return z.schritte.map((s, si) => {
                const links = von; von += s.stunden;
                return (
                  <div key={si} style={{ position: "absolute", left: `${links / skala * 100}%`, width: `${s.stunden / skala * 100}%`, top: 0, bottom: 0, display: "flex", flexDirection: "column" }}>
                    {s.phasen.map((p, pi) => (
                      <div key={pi} title={`${gewerkLabel.get(p.gewerk) ?? p.gewerk} · ${p.kuerzel}: ${fmtZahl(p.arbeit)} Personenstunden ÷ ${fmtZahl(p.personen)} Personen = ${fmtZahl(p.stunden)} h`}
                        style={{ flex: 1, width: `${p.stunden / s.stunden * 100}%`, background: farbeJeGewerk.get(p.gewerk) ?? FARBEN.andere, borderRight: "1px solid #fff",
                          color: "#fff", fontSize: 9, lineHeight: `${18 / s.phasen.length}px`, overflow: "hidden", whiteSpace: "nowrap", paddingLeft: 3 }}>
                        {s.phasen.length === 1 ? `${fmtZahl(p.personen)} P · ${fmtZahl(p.stunden)} h` : ""}
                      </div>
                    ))}
                  </div>
                );
              });
            })()}
          </div>
          <span style={{ textAlign: "right", color: z.stunden > std + 1e-6 ? FARBEN.status.critical : FARBEN.textSekundaer }}
            title="Wie lange dieser Task am Tag braucht: Summe seiner Schritte">{fmtZahl(z.stunden)} h</span>
        </div>
      ))}
      {zeilen.length > MAX_TASKS && <div style={{ color: FARBEN.textMuted }}>… und {zeilen.length - MAX_TASKS} weitere Tasks</div>}
      <div style={{ marginTop: 6, color: FARBEN.textSekundaer, lineHeight: 1.6 }}>
        <div><strong>Arbeit:</strong> {zeilen.length} Task{zeilen.length === 1 ? "" : "s"} zusammen {fmtZahl(arbeit)} Personenstunden = {fmtZahl(arbeit / std)} Personen × {fmtZahl(std)} h (Spalten Arbeit und Personen).</div>
        {eingeplant && (mitKranPersonal ? (
          <div><strong>Eingeplant:</strong> {fmtZahl(eingeplant.kranPersonal)} Personen unter dem Kran (Tab Ressourcen → Kräne & Personal — sie arbeiten als Allrounder an allen Gewerken mit «unter Kran»)
            {eingeplant.kolonnen > 0 ? ` + ${fmtZahl(eingeplant.kolonnen)} Personen ohne Kran (Min. Personen der übrigen Positionen)` : ""} = <strong>{fmtZahl(eingeplant.total)} Personen</strong>.
            Auslastung = {fmtZahl(arbeit / std)} ÷ {fmtZahl(eingeplant.total)} = {eingeplant.total > 0 ? `${fmtZahl(arbeit / std / eingeplant.total * 100)} %` : "–"}.</div>
        ) : (
          <div><strong>Eingeplant:</strong> Summe der Min. Personen der an diesem Tag aktiven Leistungspositionen = <strong>{fmtZahl(eingeplant.total)} Personen</strong>
            {" "}(dieselbe Position an mehreren Tasks zählt einmal).</div>
        ))}
      </div>
    </div>
  );
}
