// Tagesablauf.tsx — Tab AVOR → Personalauslastung, nach Klick auf einen Tag unter der Tabelle: wie die Arbeit dieses Tages abläuft.
// Je laufendem Task ein Balken über den Arbeitstag mit seinen Arbeiten zur jeweiligen Zeit (Gewerk, Personen, Stunden) aus dem
// Tagesplan (tagesplan.ts: Team unter dem Kran, Min. Personen, Kranzeit) — derselbe wie die Spalte Dauer der Tabelle. Darunter die
// Summen, die zur Tabelle führen, und die Überstunden des Tages je Unternehmer und Kran. Darunter in einem eigenen grauen Kasten
// "Erklärung & Optimierung": überzieht der Tag, warum (Kranzeit, Arbeit des Gantts gleichmässig auf die Tage des Tasks verteilt,
// später Start); ist das eingeplante Personal nicht ausgelastet, was die übrigen Arbeiten zurückhält (Kranzeit, Vorgänger mit
// Wartetagen, Startdatum) — je mit dem, was sich von Hand ändern liesse. Beide Kästen lassen sich zuklappen.
import type { Task, Kran } from "../types";
import { vorgaengerListe, istGruppe } from "../types";
import type { Stammdaten } from "./stammdatenHelpers";
import { hatKalkulationsWerte } from "./stammdatenHelpers";
import type { Kalender } from "./kalenderHelpers";
import { kranstundenJeTagFuerTask, aufwandJeTagFuerTask } from "./avorHelpers";
import type { Tagesplan, TagesplanPhase } from "./tagesplan";
import { unternehmerLabel } from "./tagesplan";
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
  /** Zugeklappt: Tagesablauf / Erklärung & Optimierung (in Tab AVOR je Projekt gemerkt) */
  zu: { ablauf: boolean; erklaerung: boolean };
  onToggle: (welcher: "ablauf" | "erklaerung") => void;
}

const datumText = (iso: string) => iso.split("-").reverse().join(".");

/** Kopfzeile eines zuklappbaren Kastens: Dreieck + Titel, zugeklappt mit Kurzinfo daneben */
function KastenKopf({ titel, zu, onToggle, info, farbe }: { titel: string; zu: boolean; onToggle: () => void; info?: React.ReactNode; farbe?: string }) {
  return (
    <div onClick={onToggle} style={{ display: "flex", alignItems: "baseline", gap: 6, cursor: "pointer", userSelect: "none", marginBottom: zu ? 0 : 4 }}>
      <span style={{ display: "inline-block", transform: `scaleX(1.4) rotate(${zu ? -90 : 0}deg)`, transition: "transform .15s", fontSize: 8, color: FARBEN.textMuted }}>▼</span>
      <span style={{ fontWeight: 600, color: farbe ?? FARBEN.textPrimaer }}>{titel}</span>
      {zu && info && <span style={{ color: FARBEN.textSekundaer }}>{info}</span>}
    </div>
  );
}

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

export default function Tagesablauf({ iso, tasks, stammdaten, kalender, farbeJeGewerk, eingeplant, mitKranPersonal, kraene, plan, zu, onToggle }: Props) {
  const std = stammdaten.arbeitszeitStdProTag;
  const gewerkLabel = new Map(stammdaten.gewerke.map(g => [g.key, g.label]));
  const zeilen = plan.tasks;
  if (zeilen.length === 0) return null;

  const arbeit = plan.arbeit;
  const skala = Math.max(std, plan.dauer); // Balkenbreite: Arbeitstag, oder länger, wenn die Arbeit überzieht
  const sichtbar = zeilen.slice(0, MAX_TASKS);
  const datum = iso.split("-").reverse().join(".");
  const ueberzogen = plan.dauer > std + 1e-6;
  const ueberU = [...plan.ueberstunden.jeUnternehmer].filter(([, h]) => h > 1e-6).sort((a, b) => b[1] - a[1]);
  const ueberK = [...plan.ueberstunden.jeKran].filter(([, h]) => h > 1e-6).sort((a, b) => b[1] - a[1]);
  const kranName = (id: string) => kraene.find(k => k.id === id)?.name ?? "Kran";

  const auslastung = eingeplant && eingeplant.total > 0 ? arbeit / std / eingeplant.total : null;
  const zuWenigArbeit = auslastung != null && auslastung < AUSLASTUNG_HINWEIS;
  const gruende = ueberzogen || zuWenigArbeit ? wartegruende(iso, tasks, stammdaten, kalender, kraene) : null;

  return (<>
    <div style={{ margin: "6px 0 6px", padding: "8px 10px", background: "#fafbfc", border: `1px solid ${FARBEN.gridline}`, fontSize: 11 }}>
      <KastenKopf titel={`Tagesablauf ${datum}`} zu={zu.ablauf} onToggle={() => onToggle("ablauf")}
        info={<>— {zeilen.length} Task{zeilen.length === 1 ? "" : "s"}, fertig nach {fmtZahl(plan.dauer)} h
          {ueberzogen && <span style={{ color: FARBEN.status.critical, fontWeight: 600 }}> ({fmtZahl(plan.dauer - std)} h nach Arbeitsende)</span>}</>} />
      {!zu.ablauf && (<>
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
          {(ueberU.length > 0 || ueberK.length > 0) && (
            <div style={{ color: FARBEN.status.critical }}>
              <strong>Überstunden:</strong> {ueberU.map(([u, h]) => `${unternehmerLabel(u)} ${fmtZahl(h)} Personenstunden`).join(", ")}
              {ueberK.length > 0 && <>{ueberU.length > 0 ? "; " : ""}{ueberK.map(([id, h]) => `${kranName(id)} ${fmtZahl(h)} Kranstunden`).join(", ")}</>}
              {" "}nach Arbeitsende.
            </div>
          )}
        </div>
      </>)}
    </div>
    {gruende && (
      <div style={{ margin: "0 0 10px", padding: "8px 10px", background: "#eceef0", border: "1px solid #d6dade", fontSize: 11, color: FARBEN.textSekundaer, lineHeight: 1.6 }}>
        <KastenKopf titel="Erklärung & Optimierung" zu={zu.erklaerung} onToggle={() => onToggle("erklaerung")}
          info={<>— {[ueberzogen && "warum der Tag überzieht", zuWenigArbeit && "warum nicht mehr Personen arbeiten"].filter(Boolean).join(", ")}</>} />
        {!zu.erklaerung && (<>
          {ueberzogen && <Ueberzug iso={iso} plan={plan} std={std} tasks={tasks} stammdaten={stammdaten} kalender={kalender}
            kranUeber={gruende.kranVoll.filter(k => k.stunden > std + 1e-6)} />}
          {zuWenigArbeit && eingeplant && (() => {
            const { kranVoll, wartend } = gruende;
            const arten = new Set(wartend.map(w => w.art));
            const frei = eingeplant.total - arbeit / std;
            return (
              <div style={ueberzogen ? { marginTop: 8, paddingTop: 6, borderTop: "1px solid #d6dade" } : undefined}>
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
                {kranVoll.length > 0
                  ? <div style={{ paddingLeft: 10 }}>– Solange der Kran der Engpass ist, bringt mehr Personal unter dem Kran nichts — eher weniger Personal unter dem Kran für diesen Zeitraum (Tab Ressourcen → Kräne & Personal, von/bis).</div>
                  : <div style={{ paddingLeft: 10 }}>– Wenn nichts anderes möglich ist: weniger Personal unter dem Kran für diesen Zeitraum (Tab Ressourcen → Kräne & Personal, von/bis).</div>}
              </div>
            );
          })()}
        </>)}
      </div>
    )}
  </>);
}

/** Warum die Arbeit des Tages erst nach Arbeitsende fertig wird: das Gantt verteilt die Arbeit eines Tasks gleichmässig auf seine
 *  Tage und kennt keine Uhrzeiten — liegen an einem Tag mehr Arbeiten, als Kran und Personal schaffen, wird es später. Je Task, der
 *  nach Arbeitsende fertig wird: sein Anteil an diesem Tag und ob er erst spät beginnen kann. */
function Ueberzug({ iso, plan, std, tasks, stammdaten, kalender, kranUeber }: {
  iso: string; plan: Tagesplan; std: number; tasks: Task[]; stammdaten: Stammdaten; kalender: Kalender;
  kranUeber: { name: string; stunden: number; tasks: string[] }[];
}) {
  const spaet = plan.tasks.filter(z => z.bis > std + 1e-6);
  const byId = new Map(tasks.map(t => [t.id, t]));
  return (
    <div>
      <div style={{ fontWeight: 600, color: FARBEN.status.critical }}>Warum wird die Arbeit erst nach {fmtZahl(plan.dauer)} h fertig?</div>
      <div>Das Gantt plant ganze Tage: die Arbeit eines Tasks verteilt sich gleichmässig auf alle seine Tage im Gantt (ausser nach «Auslastung
        optimieren», solange seine Termine unverändert sind — dann so, wie es dort im Arbeitstag Platz hatte). Laufen an diesem
        Tag mehr Arbeiten, als {kranUeber.length > 0 ? "der Kran" : "das Personal"} im Arbeitstag schafft, zeigt der Tagesablauf, wie lange es wirklich dauert —
        er verschiebt nichts auf den nächsten Tag.</div>
      {kranUeber.map(k => (
        <div key={k.name}>• <strong>{k.name} ist überbelegt:</strong> die kranpflichtigen Arbeiten brauchen {fmtZahl(k.stunden)} h Kranzeit,
          der Arbeitstag hat {fmtZahl(std)} h ({k.tasks.slice(0, 4).join(", ")}{k.tasks.length > 4 ? " …" : ""}). Mehr Personal hilft nicht — die Arbeiten müssen nacheinander unter den Kran.</div>
      ))}
      {spaet.map(z => {
        const t = byId.get(z.t.id) ?? z.t;
        const jeTag = aufwandJeTagFuerTask(t, stammdaten, kalender);
        let total = 0;
        for (const a of jeTag.values()) for (const h of Object.values(a)) total += h;
        const tage = jeTag.size;
        return (
          <div key={z.t.id} style={{ paddingLeft: 10 }}>
            – <strong>{z.t.name}</strong>: heute {fmtZahl(z.arbeit)} Personenstunden{total > 0 ? ` (${fmtZahl(z.arbeit / total * 100)} % seiner Arbeit, der Task läuft im Gantt an ${tage} Tag${tage === 1 ? "" : "en"})` : ""}
            {z.von > 0.01 ? ` — ${t.start === iso ? "beginnt laut Gantt heute, " : ""}kann aber erst nach ${fmtZahl(z.von)} h anfangen, weil Kran/Personal vorher mit früher begonnenen Tasks belegt sind` : ""}
            {" "}→ fertig nach {fmtZahl(z.bis)} h.
          </div>
        );
      })}
      <div style={{ marginTop: 4 }}><strong>Was sich von Hand verbessern lässt:</strong></div>
      {spaet.some(z => z.von > 0.01) && <div style={{ paddingLeft: 10 }}>– Tasks, die erst spät anfangen können, im Gantt einen Tag später beginnen lassen (z.B. ein Wartetag mehr beim Vorgänger) — ihre Arbeit fällt dann auf Tage mit freier Kranzeit.</div>}
      <div style={{ paddingLeft: 10 }}>– Tasks mit Überzug im Gantt um einen Tag verlängern — ihre Arbeit je Tag wird kleiner.</div>
      {kranUeber.length > 0 && <div style={{ paddingLeft: 10 }}>– Kranzeit % in Tab Ressourcen prüfen (z.B. Bewehrung oder Beton mit Pumpe brauchen den Kran nicht die ganze Zeit) oder einen zweiten Kran einplanen.</div>}
      <div style={{ paddingLeft: 10 }}>– «Auslastung optimieren» ausführen: es verteilt die Arbeit so auf die Tage, dass Personal und Kran im Arbeitstag fertig werden — was keinen Platz hat, geht am nächsten Tag weiter; höchstens 5 % der Arbeit eines Tasks werden noch am selben Tag in Überstunden fertig.</div>
    </div>
  );
}
