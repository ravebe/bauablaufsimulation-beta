// Tagesablauf.tsx — Tab AVOR → Personalauslastung, nach Klick auf einen Tag unter der Tabelle: wie die Arbeit dieses Tages abläuft.
// Je laufendem Task ein Balken über den Arbeitstag mit seinen Arbeiten zur jeweiligen Zeit (Gewerk, Personen, Stunden) aus dem
// Tagesplan (tagesplan.ts: Team unter dem Kran, Min. Personen, Kranzeit) — derselbe wie die Spalte Dauer der Tabelle. Darunter die
// Summen, die zur Tabelle führen. Ist das
// eingeplante Personal nicht ausgelastet, erklärt "Warum arbeiten nicht mehr Personen?", was die übrigen Arbeiten zurückhält
// (Kranzeit, Vorgänger mit Wartetagen, Startdatum) und was sich von Hand ändern liesse.
import type { Task, Kran } from "../types";
import { vorgaengerListe, istGruppe } from "../types";
import type { Stammdaten } from "./stammdatenHelpers";
import { hatKalkulationsWerte } from "./stammdatenHelpers";
import type { Kalender } from "./kalenderHelpers";
import { kranstundenJeTagFuerTask } from "./avorHelpers";
import type { Tagesplan, TagesplanPhase } from "./tagesplan";
import type { EingeplantTag } from "./kranHelpers";
import { kraeneDesTasks, istKranVerfuegbarAn } from "./kranHelpers";
import { endZeitpunkt, folgeStartZeitpunkt } from "./zeitHelpers";
import { fmtZahl } from "./zahlFormat";
import { FARBEN } from "./cockpitCharts";

const MAX_TASKS = 12;
const MAX_WARTENDE = 6;
/** Unter dieser Auslastung erklärt der Tagesablauf, was die übrigen Arbeiten zurückhält */
const AUSLASTUNG_HINWEIS = 0.9;

interface Props {
  iso: string; tasks: Task[]; stammdaten: Stammdaten; kalender: Kalender;
  farbeJeGewerk: Map<string, string>; eingeplant?: EingeplantTag; mitKranPersonal: boolean; kraene: Kran[];
  /** Ablauf des Tages (tagesplan) — derselbe wie in der Spalte Dauer */
  plan: Tagesplan;
}

const datumText = (iso: string) => iso.split("-").reverse().join(".");

/** Warum laufen am Tag iso nicht mehr Arbeiten? Kranzeit je Kran und die nächsten Tasks, die noch nicht begonnen haben, mit dem
 *  Grund aus dem Gantt: letzter Vorgänger (+ Wartetage), Start ohne Vorgänger, oder bereit (dann hält Personal/Kranzeit/Reihenfolge
 *  sie zurück). */
function wartegruende(iso: string, tasks: Task[], stammdaten: Stammdaten, kalender: Kalender, kraene: Kran[]) {
  const std = stammdaten.arbeitszeitStdProTag;
  const byId = new Map(tasks.map(t => [t.id, t]));
  // Kranzeit des Tages je Kran (wie Kranoptik: auf die verfügbaren Kräne des Tasks verteilt)
  const kranBelegt = new Map<string, { stunden: number; tasks: string[] }>();
  for (const t of tasks) {
    const h = kranstundenJeTagFuerTask(t, stammdaten, kalender).get(iso);
    if (!h) continue;
    const ids = kraeneDesTasks(t, kraene).filter(id => { const k = kraene.find(x => x.id === id); return !!k && istKranVerfuegbarAn(k, iso); });
    for (const id of ids) {
      const e = kranBelegt.get(id) ?? { stunden: 0, tasks: [] };
      e.stunden += h / ids.length; e.tasks.push(t.name);
      kranBelegt.set(id, e);
    }
  }
  const kranVoll = [...kranBelegt].filter(([, e]) => e.stunden >= std * 0.9)
    .map(([id, e]) => ({ name: kraene.find(k => k.id === id)?.name ?? "Kran", stunden: e.stunden, tasks: e.tasks }));

  // nächste noch nicht begonnene Tasks mit Arbeit
  const wartend = tasks.filter((t, i) => !t.isGroup && !istGruppe(tasks, i) && !t.meilenstein && t.start > iso && hatKalkulationsWerte(t, stammdaten))
    .sort((a, b) => a.start.localeCompare(b.start)).slice(0, MAX_WARTENDE)
    .map(t => {
      let spaetester: { name: string; ab: string; lag: number; ende: string } | null = null;
      for (const v of vorgaengerListe(t)) {
        const vt = byId.get(v.id);
        if (!vt?.end) continue;
        const ab = folgeStartZeitpunkt(endZeitpunkt(vt), v.lagDays, kalender).datum;
        if (!spaetester || ab > spaetester.ab) spaetester = { name: vt.name, ab, lag: v.lagDays, ende: vt.end };
      }
      const art: "vorgaenger" | "start" | "bereit" = spaetester && spaetester.ab > iso ? "vorgaenger" : vorgaengerListe(t).length === 0 ? "start" : "bereit";
      const text = art === "vorgaenger" && spaetester
        ? `wartet auf «${spaetester.name}» (Ende ${datumText(spaetester.ende)}${spaetester.lag ? ", +" + spaetester.lag + " Wartetage" : ""})`
        : art === "start" ? `beginnt laut Gantt erst am ${datumText(t.start)} (ohne Vorgänger)`
        : `Vorgänger fertig — könnte schon laufen, beginnt laut Gantt am ${datumText(t.start)}`;
      return { t, art, text };
    });
  return { kranVoll, wartend };
}

export default function Tagesablauf({ iso, tasks, stammdaten, kalender, farbeJeGewerk, eingeplant, mitKranPersonal, kraene, plan }: Props) {
  const std = stammdaten.arbeitszeitStdProTag;
  const gewerkLabel = new Map(stammdaten.gewerke.map(g => [g.key, g.label]));
  const zeilen = plan.tasks;
  if (zeilen.length === 0) return null;

  const arbeit = plan.arbeit;
  const skala = Math.max(std, plan.dauer); // Balkenbreite: Arbeitstag, oder länger, wenn die Arbeit überzieht
  const sichtbar = zeilen.slice(0, MAX_TASKS);
  const datum = iso.split("-").reverse().join(".");
  const ueberzogen = plan.dauer > std + 1e-6;

  return (
    <div style={{ margin: "6px 0 10px", padding: "8px 10px", background: "#fafbfc", border: `1px solid ${FARBEN.gridline}`, fontSize: 11 }}>
      <div style={{ fontWeight: 600, color: FARBEN.textPrimaer, marginBottom: 2 }}>Tagesablauf {datum}</div>
      <div style={{ color: FARBEN.textSekundaer, marginBottom: 6, lineHeight: 1.5 }}>
        Die Arbeit des Tages laut Gantt, verteilt auf das Personal: {mitKranPersonal
          ? "das Personal unter dem Kran arbeitet als Team (Allrounder) — jede Arbeit mindestens mit ihren Min. Personen, freie Leute verstärken bis aufs Doppelte; Positionen ohne Kran mit ihren Min. Personen."
          : "jede Leistungsposition mit ihren Min. Personen, dieselbe Position nie an zwei Tasks gleichzeitig."}
        {" "}Kranpflichtige Arbeiten gehen nur so schnell, wie der Kran nachkommt (Kranzeit %). Schritte eines Tasks nacheinander. Balken = {fmtZahl(std)} h Arbeitstag.
      </div>
      {sichtbar.map(z => {
        // parallele Arbeiten eines Tasks übereinander (Spuren)
        const spuren: TagesplanPhase[][] = [];
        for (const p of [...z.phasen].sort((a, b) => a.von - b.von)) {
          const spur = spuren.find(s => s[s.length - 1].bis <= p.von + 1e-6);
          if (spur) spur.push(p); else spuren.push([p]);
        }
        const hoehe = 18;
        return (
          <div key={z.t.id} style={{ display: "grid", gridTemplateColumns: "minmax(110px, 180px) 1fr 64px", alignItems: "center", columnGap: 8, marginBottom: 3 }}>
            <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", color: FARBEN.textPrimaer }} title={z.t.name}>{z.t.name}</span>
            <div style={{ position: "relative", height: hoehe, background: "#eef1f4" }}>
              {ueberzogen && <div style={{ position: "absolute", left: `${std / skala * 100}%`, top: -3, bottom: -3, borderLeft: `2px solid ${FARBEN.status.critical}` }}
                title={`Arbeitsende (${fmtZahl(std)} h)`} />}
              {spuren.map((spur, si) => spur.map((p, pi) => (
                <div key={`${si}-${pi}`}
                  title={`${gewerkLabel.get(p.gewerkKey) ?? p.gewerkKey} · ${p.kuerzel}: ${fmtZahl(p.arbeit)} Personenstunden mit ${fmtZahl(p.personen)} Personen (Min. ${fmtZahl(p.minPersonen)}${p.unterKran ? ", Personal unter dem Kran" : ""}) = ${fmtZahl(p.bis - p.von)} h, ${fmtZahl(p.von)}–${fmtZahl(p.bis)} h nach Arbeitsbeginn${p.kranBegrenzt ? "\nDurch die Kranzeit begrenzt: mehr Leute wären frei gewesen, aber der Kran kommt nicht nach (Kranzeit % in Tab Ressourcen)." : ""}`}
                  style={{ position: "absolute", left: `${p.von / skala * 100}%`, width: `${Math.max(p.bis - p.von, 0.05) / skala * 100}%`,
                    top: si * hoehe / spuren.length, height: hoehe / spuren.length, background: farbeJeGewerk.get(p.gewerkKey) ?? FARBEN.andere,
                    borderRight: "1px solid #fff", color: "#fff", fontSize: 9, lineHeight: `${hoehe / spuren.length}px`, overflow: "hidden", whiteSpace: "nowrap", paddingLeft: 3,
                    backgroundImage: p.kranBegrenzt ? "repeating-linear-gradient(135deg, rgba(255,255,255,.25) 0 4px, transparent 4px 8px)" : undefined }}>
                  {spuren.length === 1 ? `${fmtZahl(p.personen)} P · ${fmtZahl(p.bis - p.von)} h${p.kranBegrenzt ? " · Kran" : ""}` : ""}
                </div>
              )))}
            </div>
            <span style={{ textAlign: "right", fontWeight: z.bis > std + 1e-6 ? 700 : 400, color: z.bis > std + 1e-6 ? FARBEN.status.critical : FARBEN.textSekundaer }}
              title={z.bis > std + 1e-6 ? "Fertig erst nach Arbeitsende — die Arbeit dieses Tages ist in der normalen Arbeitszeit nicht zu schaffen" : "Fertig nach so vielen Stunden ab Arbeitsbeginn"}>
              bis {fmtZahl(z.bis)} h</span>
          </div>
        );
      })}
      {zeilen.length > MAX_TASKS && <div style={{ color: FARBEN.textMuted }}>… und {zeilen.length - MAX_TASKS} weitere Tasks</div>}
      <div style={{ marginTop: 6, color: FARBEN.textSekundaer, lineHeight: 1.6 }}>
        <div><strong>Arbeit:</strong> {zeilen.length} Task{zeilen.length === 1 ? "" : "s"} zusammen {fmtZahl(arbeit)} Personenstunden = {fmtZahl(arbeit / std)} Personen × {fmtZahl(std)} h (Spalten Arbeit und Benötigt).</div>
        {eingeplant && (mitKranPersonal ? (
          <div><strong>Eingeplant:</strong> {fmtZahl(eingeplant.kranPersonal)} Personen unter dem Kran
            {eingeplant.kolonnen > 0 ? ` + ${fmtZahl(eingeplant.kolonnen)} Personen ohne Kran` : ""} = <strong>{fmtZahl(eingeplant.total)} Personen</strong>,
            davon frei {fmtZahl(Math.max(0, eingeplant.total - arbeit / std))}. Auslastung = {fmtZahl(arbeit / std)} ÷ {fmtZahl(eingeplant.total)} = {eingeplant.total > 0 ? `${fmtZahl(arbeit / std / eingeplant.total * 100)} %` : "–"}.</div>
        ) : (
          <div><strong>Eingeplant:</strong> Summe der Min. Personen der an diesem Tag aktiven Leistungspositionen = <strong>{fmtZahl(eingeplant.total)} Personen</strong>.</div>
        ))}
        <div style={{ color: ueberzogen ? FARBEN.status.critical : undefined, fontWeight: ueberzogen ? 600 : undefined }}>
          <strong>Dauer:</strong> Die Arbeit des Tages ist nach {fmtZahl(plan.dauer)} h fertig{ueberzogen ? ` — ${fmtZahl(plan.dauer - std)} h nach Arbeitsende` : ""} (Spalte Dauer).
        </div>
      </div>
      {eingeplant && eingeplant.total > 0 && arbeit / std / eingeplant.total < AUSLASTUNG_HINWEIS && (() => {
        const { kranVoll, wartend } = wartegruende(iso, tasks, stammdaten, kalender, kraene);
        const arten = new Set(wartend.map(w => w.art));
        const frei = eingeplant.total - arbeit / std;
        return (
          <div style={{ marginTop: 8, paddingTop: 6, borderTop: `1px solid ${FARBEN.gridline}`, color: FARBEN.textSekundaer, lineHeight: 1.6 }}>
            <div style={{ fontWeight: 600, color: "#8a5a00" }}>Warum arbeiten nicht mehr Personen? (rund {fmtZahl(frei)} Personen ohne Arbeit)</div>
            {kranVoll.map(k => (
              <div key={k.name}>• <strong>{k.name} ist ausgelastet:</strong> {fmtZahl(k.stunden)} h von {fmtZahl(std)} h Kranzeit belegt
                ({k.tasks.slice(0, 3).join(", ")}{k.tasks.length > 3 ? " …" : ""}) — weitere kranpflichtige Arbeiten haben keinen Platz unter dem Kran.</div>
            ))}
            {wartend.length === 0 && kranVoll.length === 0 && <div>• Danach folgen keine weiteren Tasks mit Mengen.</div>}
            {wartend.length > 0 && <div>Die nächsten Arbeiten im Gantt:</div>}
            {wartend.map(w => <div key={w.t.id} style={{ paddingLeft: 10 }}>– {w.t.name}: {w.text}</div>)}
            <div style={{ marginTop: 4 }}><strong>Was sich von Hand verbessern lässt:</strong></div>
            {kranVoll.length > 0 && <div style={{ paddingLeft: 10 }}>– Kranzeit % in Tab Ressourcen prüfen: Braucht die Position den Kran wirklich die ganze Zeit (z.B. Beton mit Pumpe → tiefe Kranzeit oder nicht kranpflichtig)? Oder einen zweiten Kran einplanen.</div>}
            {arten.has("vorgaenger") && <div style={{ paddingLeft: 10 }}>– Vorgänger und Wartetage prüfen: Sind alle nötig? Oft verkettet «Auto-Vorgänger» Tasks nacheinander, die parallel laufen könnten (z.B. andere Etappe oder anderes Geschoss).</div>}
            {arten.has("start") && <div style={{ paddingLeft: 10 }}>– Tasks ohne Vorgänger früher beginnen lassen: «Auslastung optimieren» mit «Lücken füllen».</div>}
            {arten.has("bereit") && <div style={{ paddingLeft: 10 }}>– Bereite Tasks: «Auslastung optimieren» ausführen — es zieht sie vor, soweit Personal und Kranzeit reichen.</div>}
            <div style={{ paddingLeft: 10 }}>– Wenn nichts anderes möglich ist: weniger Personal unter dem Kran für diesen Zeitraum (Tab Ressourcen → Kräne & Personal, von/bis).</div>
          </div>
        );
      })()}
    </div>
  );
}
