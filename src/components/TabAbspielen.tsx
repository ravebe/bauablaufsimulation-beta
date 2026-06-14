import { useState, useRef, useCallback, useEffect } from "react";
import type { SimProjekt, Task } from "../types";
import { formatDatum } from "../types";
import type { ApiInstance } from "../hooks/useApi";

interface Props {
  api: ApiInstance | null;
  aktiveSim: SimProjekt | null;
  aktivesModellId: string | null;
}

interface TaskGruppe { datum: string; tage: number; tasks: Task[]; }

const FARBEN = { neubau: "#22C55E", bestand: "#999999", abbruch: "#EAB308" };

function parseDatum(s: string): Date | null {
  if (!s) return null;
  const d = new Date(s + "T00:00:00");
  return isNaN(d.getTime()) ? null : d;
}
function tageDiff(a: Date, b: Date): number { return Math.round((b.getTime() - a.getTime()) / 86400000); }
function datumBeiTag(min: Date, tag: number): string {
  const d = new Date(min.getTime() + tag * 86400000);
  return d.toLocaleDateString("de-DE", { day: "2-digit", month: "2-digit", year: "numeric" });
}

export default function TabAbspielen({ api, aktiveSim, aktivesModellId }: Props) {
  const [sekProTag, setSekProTag] = useState(0.5);
  const [laeuft, setLaeuft] = useState(false);
  const [currentTag, setCurrentTag] = useState(0);
  const [status, setStatus] = useState<string | null>(null);
  const stopRef = useRef(false);
  const animRef = useRef<number | null>(null);
  const lastTimeRef = useRef(0);
  const currentTagRef = useRef(0);
  const aktivierteGruppen = useRef(new Set<number>());
  const [selGuids, setSelGuids] = useState<Set<string>>(new Set());
  const selIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Selektion alle 1.5s pollen
  useEffect(() => {
    if (!api) return;
    async function check() {
      try {
        const sel = await (api!.viewer as any).getSelection();
        const guids = new Set<string>();
        if (Array.isArray(sel)) {
          for (const s of sel) {
            const mid = s?.modelId ?? "";
            for (const rId of s?.objectRuntimeIds ?? []) guids.add(`${mid}:::${rId}`);
            for (const o of s?.objects ?? []) guids.add(`${mid}:::${o?.id ?? o}`);
          }
        }
        setSelGuids(guids);
      } catch { setSelGuids(new Set()); }
    }
    check();
    selIntervalRef.current = setInterval(check, 1500);
    return () => { if (selIntervalRef.current) clearInterval(selIntervalRef.current); };
  }, [api]);

  const modellIds = [...new Set([
    ...(aktiveSim?.modelle.map(m => m.id) ?? []),
    ...(aktivesModellId ? [aktivesModellId] : [])
  ])].filter(Boolean);

  const { gruppen, minDate, maxDate, totalTage } = (() => {
    const tasks = (aktiveSim?.tasks ?? []).filter(t => t.objektGuids.length > 0 && t.start);
    if (tasks.length === 0) return { gruppen: [] as TaskGruppe[], minDate: null, maxDate: null, totalTage: 0 };
    const daten = tasks.map(t => parseDatum(t.start!)).filter(Boolean) as Date[];
    const min = new Date(Math.min(...daten.map(d => d.getTime())));
    const max = new Date(Math.max(...daten.map(d => d.getTime())));
    const total = Math.max(1, tageDiff(min, max));
    const map = new Map<string, Task[]>();
    for (const t of tasks) { if (!map.has(t.start)) map.set(t.start, []); map.get(t.start)!.push(t); }
    const g: TaskGruppe[] = [...map.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([datum, tasks]) => ({ datum, tage: tageDiff(min, parseDatum(datum)!), tasks }));
    return { gruppen: g, minDate: min, maxDate: max, totalTage: total };
  })();

  useEffect(() => () => { if (animRef.current) cancelAnimationFrame(animRef.current); }, []);
  useEffect(() => { currentTagRef.current = currentTag; }, [currentTag]);

  function zuBatch(guids: string[]): { modelId: string; objectRuntimeIds: number[] }[] {
    const byModel = new Map<string, Set<number>>();
    for (const g of guids) {
      if (!g.includes(":::")) continue;
      const sep = g.indexOf(":::"); const mid = g.slice(0, sep); const rId = Number(g.slice(sep + 3));
      if (mid && !isNaN(rId)) { if (!byModel.has(mid)) byModel.set(mid, new Set()); byModel.get(mid)!.add(rId); }
    }
    return [...byModel.entries()].map(([modelId, rIds]) => ({ modelId, objectRuntimeIds: [...rIds] }));
  }

  async function setzeZustand(guids: string[], opts: { visible?: boolean; color?: string | null }) {
    if (!api || guids.length === 0) return;
    const batch = zuBatch(guids);
    if (batch.length === 0) return;
    try { await api.viewer.setObjectState({ modelObjectIds: batch } as any, opts as any); } catch {}
  }

  function setzeZustandAsync(guids: string[], opts: { visible?: boolean; color?: string | null }) {
    if (!api || guids.length === 0) return;
    const batch = zuBatch(guids);
    if (batch.length === 0) return;
    api.viewer.setObjectState({ modelObjectIds: batch } as any, opts as any).catch(() => {});
  }

  async function selektieren(guids: string[]) {
    if (!api || guids.length === 0) return;
    try { await (api.viewer as any).setSelection({ modelObjectIds: zuBatch(guids) }, "set"); } catch {}
  }

  // --- Startzustand ---
  async function startzustand() {
    if (!api || !aktiveSim) return;
    aktivierteGruppen.current.clear();
    setStatus("⟳ Bereit machen…");

    // Bestand (grau) einblenden
    const bestandGuids = aktiveSim.tasks.filter(t => t.typ === "bestand").flatMap(t => t.objektGuids);
    if (bestandGuids.length > 0) await setzeZustand(bestandGuids, { visible: true, color: FARBEN.bestand });

    // Abbruch einblenden (steht noch)
    const abbruchGuids = aktiveSim.tasks.filter(t => t.typ === "abbruch").flatMap(t => t.objektGuids);
    if (abbruchGuids.length > 0) await setzeZustand(abbruchGuids, { visible: true });

    setCurrentTag(0);
    currentTagRef.current = 0;
    setStatus("✓ Bereit");
  }

  // --- Zustand bei Tag aufbauen (Slider + Task-Klick) ---
  async function zustandBeiTag(tag: number) {
    if (!api || !aktiveSim) return;

    const zeigeAn: string[] = [];
    const verberge: string[] = [];
    const bestandGuids: string[] = [];
    const selGuids: string[] = [];

    for (const g of gruppen) {
      for (const t of g.tasks) {
        if (t.typ === "bestand") {
          bestandGuids.push(...t.objektGuids);
        } else if (t.typ === "neubau") {
          if (g.tage <= tag) zeigeAn.push(...t.objektGuids);
          else verberge.push(...t.objektGuids);
        } else if (t.typ === "abbruch") {
          if (g.tage <= tag) verberge.push(...t.objektGuids);
          else zeigeAn.push(...t.objektGuids);
        }
      }
    }

    if (bestandGuids.length > 0) await setzeZustand(bestandGuids, { visible: true, color: FARBEN.bestand });
    if (zeigeAn.length > 0) await setzeZustand(zeigeAn, { visible: true });
    if (verberge.length > 0) await setzeZustand(verberge, { visible: false });

    // Aktuelle Gruppe hervorheben
    const aktGruppe = gruppen.find(g => g.tage === Math.floor(tag));
    if (aktGruppe) {
      for (const t of aktGruppe.tasks) {
        if (t.typ === "abbruch" && aktGruppe.tage <= tag) {
          await setzeZustand(t.objektGuids, { visible: true, color: FARBEN.abbruch });
        }
        if (t.typ === "neubau" || t.typ === "abbruch") selGuids.push(...t.objektGuids);
      }
    }
    if (selGuids.length > 0) await selektieren(selGuids);

    if (aktGruppe) {
      const namen = aktGruppe.tasks.map(t => `${t.typ === "neubau" ? "🟢" : t.typ === "abbruch" ? "🟡" : "⚫"} ${t.name}`).join(", ");
      setStatus(`${aktGruppe.datum} · ${namen}`);
    }
  }

  // --- Gruppe inkrementell aktivieren (Playback, fire-and-forget) ---
  function gruppeAktivierenAsync(g: TaskGruppe) {
    const selGuids: string[] = [];
    for (const t of g.tasks) {
      if (t.typ === "neubau") {
        setzeZustandAsync(t.objektGuids, { visible: true });
        selGuids.push(...t.objektGuids);
      } else if (t.typ === "abbruch") {
        setzeZustandAsync(t.objektGuids, { color: FARBEN.abbruch });
        selGuids.push(...t.objektGuids);
        // Nach Pause ausblenden
        const batch = zuBatch(t.objektGuids);
        const viewer = api!.viewer;
        const delay = Math.max(1500, sekProTag * 1000);
        setTimeout(() => {
          console.log("[abbruch] ausblenden:", batch.map(b => b.objectRuntimeIds.length).join(","), "nach", delay, "ms");
          // Erst Farbe entfernen, dann ausblenden
          viewer.setObjectState({ modelObjectIds: batch } as any, { color: null } as any).catch(() => {});
          viewer.setObjectState({ modelObjectIds: batch } as any, { visible: false } as any).catch(() => {});
        }, delay);
      }
    }
    if (selGuids.length > 0) {
      (api!.viewer as any).setSelection({ modelObjectIds: zuBatch(selGuids) }, "set").catch(() => {});
    }
    const namen = g.tasks.map(t => `${t.typ === "neubau" ? "🟢" : t.typ === "abbruch" ? "🟡" : "⚫"} ${t.name}`).join(", ");
    setStatus(`${formatDatum(g.datum)} · ${namen}`);
  }

  // --- Playback ---
  const starten = useCallback(async () => {
    if (!api || !aktiveSim || laeuft || modellIds.length === 0 || gruppen.length === 0) return;
    stopRef.current = false;
    setLaeuft(true);

    // Nur Startzustand aufbauen wenn noch am Anfang
    if (currentTagRef.current <= 0) {
      await startzustand();
      if (stopRef.current) { setLaeuft(false); return; }
    }

    lastTimeRef.current = performance.now();
    // Weiter ab aktueller Position (nicht auf 0 zurücksetzen)

    function frame(now: number) {
      if (stopRef.current) return;
      const delta = (now - lastTimeRef.current) / 1000;
      lastTimeRef.current = now;
      const tageProSekunde = sekProTag > 0 ? 1 / sekProTag : 1;
      const neuerTag = currentTagRef.current + delta * tageProSekunde;
      if (neuerTag >= totalTage) {
        setCurrentTag(totalTage);
        currentTagRef.current = totalTage;
        setLaeuft(false);
        setStatus("✓ Simulation abgeschlossen");
        return;
      }
      setCurrentTag(neuerTag);
      currentTagRef.current = neuerTag;
      for (let i = 0; i < gruppen.length; i++) {
        if (gruppen[i].tage <= neuerTag && !aktivierteGruppen.current.has(i)) {
          aktivierteGruppen.current.add(i);
          gruppeAktivierenAsync(gruppen[i]);
        }
      }
      animRef.current = requestAnimationFrame(frame);
    }
    animRef.current = requestAnimationFrame(frame);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [api, aktiveSim, laeuft, sekProTag, modellIds, gruppen, totalTage]);

  function stoppen() {
    stopRef.current = true;
    if (animRef.current) { cancelAnimationFrame(animRef.current); animRef.current = null; }
    setLaeuft(false);
    setStatus("■ Gestoppt");
  }

  async function sliderChange(tag: number) {
    if (laeuft) return;
    setCurrentTag(tag); currentTagRef.current = tag;
    aktivierteGruppen.current.clear();
    gruppen.forEach((g, i) => { if (g.tage <= tag) aktivierteGruppen.current.add(i); });
    await zustandBeiTag(tag);
  }

  async function zuGruppe(gi: number) {
    if (laeuft || gi < 0 || gi >= gruppen.length) return;
    await sliderChange(gruppen[gi].tage);
  }

  async function reset() {
    if (!api) return;
    stoppen();
    setCurrentTag(0); currentTagRef.current = 0;
    aktivierteGruppen.current.clear();
    try { await api.viewer.reset(); } catch {}
    try { await (api.viewer as any).setSelection({ modelObjectIds: [] }, "set"); } catch {}
    setStatus("↺ Modell zurückgesetzt");
  }

  if (!aktiveSim) {
    return (
      <div className="tc-empty">
        <div className="tc-empty-icon">▶</div>
        <div className="tc-empty-title">Keine aktive Simulation</div>
        <div className="tc-empty-sub">Tab „Projekte" → Simulation aktivieren</div>
      </div>
    );
  }

  const fortschritt = totalTage > 0 ? Math.round((currentTag / totalTage) * 100) : 0;
  const aktuellesDatum = minDate ? datumBeiTag(minDate, currentTag) : "";
  const dot = (typ: string) => ({ width: 8, height: 8, borderRadius: "50%", display: "inline-block" as const, marginRight: 6, flexShrink: 0 as const,
    background: typ === "neubau" ? FARBEN.neubau : typ === "abbruch" ? FARBEN.abbruch : FARBEN.bestand });

  return (
    <div className="tc-setup-content">
      <div className="player-card">
        <div className="detail-block-title">Einstellungen</div>
        <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 11 }}>
          <span style={{ flex: 1, color: "var(--tc-text-2)" }}>Sekunden pro Tag</span>
          <input type="number" min={0.1} max={10} step={0.1} value={sekProTag}
            onChange={e => setSekProTag(Number(e.target.value))} disabled={laeuft} className="player-sek-input" />
        </div>
        <div style={{ fontSize: 9, color: "var(--tc-text-3)", marginTop: 3 }}>
          Gesamtdauer: ~{totalTage > 0 ? Math.round(totalTage * sekProTag) : 0}s für {totalTage} Tage
        </div>
      </div>

      <div style={{ display: "flex", gap: 6, marginTop: 6 }}>
        {!laeuft ? (
          <button className="tc-btn-green" style={{ flex: 1 }}
            disabled={!api || modellIds.length === 0 || gruppen.length === 0}
            onClick={starten}>▶ Starten</button>
        ) : (
          <button className="tc-btn-danger" style={{ flex: 1 }} onClick={stoppen}>■ Stoppen</button>
        )}
        <button className="tc-btn-secondary" disabled={laeuft || !api} onClick={reset} title="Reset">↺</button>
      </div>

      {totalTage > 0 && minDate && maxDate && (
        <div style={{ marginTop: 10 }}>
          <div style={{ textAlign: "center", fontSize: 13, fontWeight: 700, color: "var(--tc-text)", marginBottom: 4 }}>
            {aktuellesDatum}
          </div>
          <input type="range" min={0} max={totalTage} step={0.5} value={currentTag}
            onChange={e => sliderChange(Number(e.target.value))} disabled={laeuft} style={{ width: "100%" }} />
          <div style={{ display: "flex", justifyContent: "space-between", fontSize: 9, color: "var(--tc-text-3)" }}>
            <span>{formatDatum(minDate.toISOString().slice(0, 10))}</span>
            <span>{formatDatum(maxDate.toISOString().slice(0, 10))}</span>
          </div>
        </div>
      )}

      {(laeuft || currentTag > 0) && (
        <div className="player-card" style={{ marginTop: 6 }}>
          <div className="player-progress">
            <div className="player-progress-fill" style={{ width: `${fortschritt}%`, transition: laeuft ? "none" : "width 0.3s" }} />
          </div>
        </div>
      )}

      <div className="detail-block-title" style={{ marginTop: 8, marginBottom: 4 }}>
        Timeline ({gruppen.length} Zeitpunkte, {gruppen.reduce((s, g) => s + g.tasks.length, 0)} Tasks)
      </div>
      <div className="player-card" style={{ padding: 0, overflow: "hidden" }}>
        {gruppen.length === 0 ? (
          <div style={{ padding: 10, fontSize: 11, color: "var(--tc-text-3)", textAlign: "center" }}>Keine Tasks mit Bauteilen + Startdatum</div>
        ) : gruppen.map((g, gi) => {
          const istAktiv = g.tage <= currentTag && (gi === gruppen.length - 1 || gruppen[gi + 1].tage > currentTag);
          const istVorbei = !istAktiv && g.tage < currentTag;
          return (
            <div key={g.datum} style={{ borderBottom: "1px solid var(--tc-border)", cursor: laeuft ? "default" : "pointer" }}
              onClick={() => zuGruppe(gi)}>
              <div style={{ padding: "4px 8px", fontSize: 9, fontWeight: 600,
                color: istAktiv ? "var(--tc-blue)" : istVorbei ? "var(--tc-text-3)" : "var(--tc-text-2)",
                background: istAktiv ? "#EFF6FF" : "transparent", display: "flex", justifyContent: "space-between" }}>
                <span>{istAktiv ? "▶ " : ""}{formatDatum(g.datum)}</span>
                <span>{g.tasks.length} Task{g.tasks.length > 1 ? "s" : ""}</span>
              </div>
              {g.tasks.map((task, ti) => {
                const hatSel = selGuids.size > 0 && task.objektGuids.some(g => selGuids.has(g));
                const selAnz = hatSel ? task.objektGuids.filter(g => selGuids.has(g)).length : 0;
                return (
                <div key={task.id} style={{ display: "flex", alignItems: "center", padding: "5px 8px 5px 16px",
                  fontSize: 13, opacity: istVorbei ? 0.5 : 1, gap: 6,
                  borderBottom: ti < g.tasks.length - 1 ? "1px solid #eef1f4" : "none",
                  background: hatSel ? "#f0f0f0" : istAktiv ? "#f5f9fc" : "transparent",
                  fontWeight: hatSel ? 600 : 400 }}>
                  <span style={dot(task.typ)} />
                  <span style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{task.name}</span>
                  <span style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", lineHeight: 1.2, flexShrink: 0 }}>
                    <span style={{ fontSize: 10, color: hatSel ? "#2d7dbd" : "#8a9baa" }}>
                      {hatSel ? `${selAnz}/${task.objektGuids.length}` : `⬡ ${task.objektGuids.length}`}
                    </span>
                    {task.end && <span style={{ fontSize: 8, color: "#b0bec5" }}>{formatDatum(task.start)} – {formatDatum(task.end)}</span>}
                  </span>
                </div>
                );
              })}
            </div>
          );
        })}
      </div>

      <div style={{ padding: "8px 0", fontSize: 10, color: "var(--tc-text-3)" }}>
        <span style={{ ...dot("neubau"), width: 6, height: 6, marginRight: 3 }} /> Neubau
        <span style={{ ...dot("bestand"), width: 6, height: 6, marginLeft: 10, marginRight: 3 }} /> Bestand
        <span style={{ ...dot("abbruch"), width: 6, height: 6, marginLeft: 10, marginRight: 3 }} /> Abbruch
      </div>

      {status && (
        <div className={`alert ${status.startsWith("✓") ? "ok" : status.startsWith("■") ? "err" : "info"}`}
          style={{ marginTop: 8 }}>{status}</div>
      )}
    </div>
  );
}
