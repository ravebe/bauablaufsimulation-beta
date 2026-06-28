import { useState, useRef, useCallback, useEffect } from "react";
import type { SimProjekt, Task } from "../types";
import type { ApiInstance } from "../hooks/useApi";
import { formatDatum, parseDateUniversal } from "../types";
import GanttChart from "./GanttChart";

interface Props { api: ApiInstance | null; aktiveSim: SimProjekt | null; aktivesModellId: string | null; taskSort?: "gantt" | "datum" | "aktiv"; sharedNadelTag?: React.MutableRefObject<number>; }

const FARBEN = { neubau: "#6cc07a", bestand: "#999999", abbruch: "#edb94c", temporaer: "#a0522d" };

function tagVonDatum(s: string, min: Date): number {
  const d = parseDateUniversal(s);
  if (!d) return 0;
  return Math.round((d.getTime() - min.getTime()) / 86400000);
}

function datumBeiTag(min: Date, tag: number): string {
  const d = new Date(min.getTime() + tag * 86400000);
  return d.toLocaleDateString("de-DE", { day: "2-digit", month: "2-digit", year: "numeric" });
}

export default function TabAbspielen({ api, aktiveSim, aktivesModellId, taskSort = "gantt", sharedNadelTag }: Props) {
  const [sekProTag, setSekProTag] = useState(0.5);
  const [laeuft, setLaeuft] = useState(false);
  const [currentTag, setCurrentTag] = useState(0);
  const [status, setStatus] = useState<string | null>(null);
  const stopRef = useRef(false);
  const animRef = useRef<number | null>(null);
  const lastTimeRef = useRef(0);
  const currentTagRef = useRef(0);
  const [ganttOffen, setGanttOffen] = useState(false);
  const [selTaskId, setSelTaskId] = useState<string | null>(null);
  const [taskListHeight, setTaskListHeight] = useState(() => {
    try { return Number(localStorage.getItem("4d-list-height-abspielen")) || 350; } catch { return 350; }
  });
  const resizingRef = useRef(false);

  useEffect(() => { localStorage.setItem("4d-list-height-abspielen", String(taskListHeight)); }, [taskListHeight]);
  // Tracking: welche Tasks bereits gestartet/beendet wurden
  const gestartet = useRef(new Set<string>());
  const beendet = useRef(new Set<string>());
  // Selection polling
  const [selGuids, setSelGuids] = useState<Set<string>>(new Set());
  const selRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const modellIds = [...new Set([...(aktiveSim?.modelle.map(m => m.id) ?? []), ...(aktivesModellId ? [aktivesModellId] : [])])].filter(Boolean);

  // Alle Tasks mit gültigem Startdatum (aus ALLEN Modellen)
  const tasks = (aktiveSim?.tasks ?? []).filter(t => t.start && parseDateUniversal(t.start));

  const { minDate, maxDate, totalTage } = (() => {
    if (tasks.length === 0) return { minDate: null, maxDate: null, totalTage: 0 };
    const allDates: Date[] = [];
    for (const t of tasks) {
      const s = parseDateUniversal(t.start); if (s) allDates.push(s);
      const e = parseDateUniversal(t.end); if (e) allDates.push(e);
    }
    if (allDates.length === 0) return { minDate: null, maxDate: null, totalTage: 0 };
    const min = new Date(Math.min(...allDates.map(d => d.getTime())));
    const max = new Date(Math.max(...allDates.map(d => d.getTime())));
    return { minDate: min, maxDate: max, totalTage: Math.max(1, Math.round((max.getTime() - min.getTime()) / 86400000)) };
  })();

  useEffect(() => () => { if (animRef.current) cancelAnimationFrame(animRef.current); }, []);
  useEffect(() => {
    currentTagRef.current = currentTag;
    if (sharedNadelTag && minDate && currentTag >= 0) {
      sharedNadelTag.current = minDate.getTime() + currentTag * 86400000;
    }
  }, [currentTag]);

  // Selection polling
  useEffect(() => {
    if (!api) return;
    async function check() {
      try {
        const sel = await (api!.viewer as any).getSelection();
        const guids = new Set<string>();
        if (Array.isArray(sel)) for (const s of sel) { const mid = s?.modelId ?? ""; for (const rId of s?.objectRuntimeIds ?? []) guids.add(`${mid}:::${rId}`); }
        setSelGuids(guids);
      } catch { setSelGuids(new Set()); }
    }
    check(); selRef.current = setInterval(check, 1500);
    return () => { if (selRef.current) clearInterval(selRef.current); };
  }, [api]);

  // --- API Helpers ---
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
    const batch = zuBatch(guids); if (batch.length === 0) return;
    api.viewer.setObjectState({ modelObjectIds: batch } as any, opts as any).catch(() => {});
  }

  async function selektieren(guids: string[]) {
    if (!api || guids.length === 0) return;
    try { await (api.viewer as any).setSelection({ modelObjectIds: zuBatch(guids) }, "set"); } catch {}
  }

  function selektierenAsync(guids: string[]) {
    if (!api || guids.length === 0) return;
    (api!.viewer as any).setSelection({ modelObjectIds: zuBatch(guids) }, "set").catch(() => {});
  }

  // --- Ist Task aktiv bei Tag? ---
  function istAktiv(t: Task, tag: number): boolean {
    if (!minDate) return false;
    const s = tagVonDatum(t.start, minDate);
    const e = t.end ? tagVonDatum(t.end, minDate) : s;
    return tag >= s && tag <= e;
  }

  function istVorbei(t: Task, tag: number): boolean {
    if (!minDate) return false;
    const e = t.end ? tagVonDatum(t.end, minDate) : tagVonDatum(t.start, minDate);
    return tag > e;
  }

  // --- Startzustand ---
  async function startzustand() {
    if (!api || !aktiveSim) return;
    gestartet.current.clear(); beendet.current.clear();
    setStatus("⟳ Bereit machen…");

    // Alle Tasks der Simulation (nicht nur gefilterte)
    const alleTasks = aktiveSim.tasks;

    // Bestand grau einblenden
    for (const t of alleTasks) {
      if (t.typ === "bestand" && t.objektGuids.length > 0)
        await setzeZustand(t.objektGuids, { visible: true, color: FARBEN.bestand });
      else if ((t.typ === "abbruch" || t.typ === "temporaer") && t.objektGuids.length > 0)
        await setzeZustand(t.objektGuids, { visible: true });
    }
    setCurrentTag(0); currentTagRef.current = 0;
    setStatus("✓ Bereit");
  }

  // --- Zustand bei Tag aufbauen (Slider/Klick) — BATCHED ---
  async function zustandBeiTag(tag: number) {
    if (!api || !aktiveSim || !minDate) return;
    const alleTasks = aktiveSim.tasks;

    // Sammle alle Guids in Kategorien (ein Durchlauf, kein API-Call)
    const showGuids: string[] = [];
    const hideGuids: string[] = [];
    const colorBestand: string[] = [];
    const colorAbbruch: string[] = [];
    const selGuidsLocal: string[] = [];

    for (const t of alleTasks) {
      if (t.objektGuids.length === 0) continue;
      const s = tagVonDatum(t.start, minDate);
      const e = t.end ? tagVonDatum(t.end, minDate) : s;

      if (t.typ === "neubau") {
        if (tag >= s) { showGuids.push(...t.objektGuids); if (tag <= e) selGuidsLocal.push(...t.objektGuids); }
        else hideGuids.push(...t.objektGuids);
      } else if (t.typ === "bestand") {
        showGuids.push(...t.objektGuids); colorBestand.push(...t.objektGuids);
      } else if (t.typ === "abbruch") {
        if (tag > e) hideGuids.push(...t.objektGuids);
        else { showGuids.push(...t.objektGuids); if (tag >= s) colorAbbruch.push(...t.objektGuids); }
      } else if (t.typ === "temporaer") {
        if (tag > e) hideGuids.push(...t.objektGuids);
        else showGuids.push(...t.objektGuids);
      }
    }

    // Max 5 gebatchte API-Calls statt 610+
    if (hideGuids.length > 0) await setzeZustand(hideGuids, { visible: false });
    if (showGuids.length > 0) await setzeZustand(showGuids, { visible: true });
    if (colorBestand.length > 0) setzeZustandAsync(colorBestand, { color: FARBEN.bestand });
    if (colorAbbruch.length > 0) setzeZustandAsync(colorAbbruch, { color: FARBEN.abbruch });
    if (selGuidsLocal.length > 0) await selektieren(selGuidsLocal);

    const aktive = alleTasks.filter(t => t.objektGuids.length > 0 && istAktiv(t, tag));
    if (aktive.length > 0) setStatus(aktive.map(t => `${t.typ === "neubau" ? "🟢" : t.typ === "abbruch" ? "🟡" : t.typ === "temporaer" ? "🟤" : "⚫"} ${t.name}`).join(", "));
  }

  // --- Pre-computed Events (sortiert nach Tag) ---
  const events = (() => {
    if (!minDate) return [] as { tag: number; taskId: string; type: "start" | "end" }[];
    const evts: { tag: number; taskId: string; type: "start" | "end" }[] = [];
    for (const t of tasks) {
      evts.push({ tag: tagVonDatum(t.start, minDate), taskId: t.id, type: "start" });
      if (t.end) evts.push({ tag: tagVonDatum(t.end, minDate), taskId: t.id, type: "end" });
    }
    return evts.sort((a, b) => a.tag - b.tag);
  })();

  const letzterEventTag = useRef(-1);

  // --- Playback: Nur bei Event-Grenzen API aufrufen ---
  function pruefeTaskEvents(tag: number) {
    if (!minDate || !api) return;

    // Prüfe ob wir eine neue Event-Grenze überschritten haben
    let neueEvents = false;
    for (const evt of events) {
      if (evt.tag > letzterEventTag.current && evt.tag <= tag) {
        neueEvents = true;
        break;
      }
    }
    if (!neueEvents && gestartet.current.size > 0) {
      letzterEventTag.current = tag;
      return; // Kein neues Event → nichts tun
    }
    letzterEventTag.current = tag;

    // Neue Events verarbeiten
    const showGuids: string[] = [];
    const hideGuids: string[] = [];
    const selGuidsLocal: string[] = [];
    let statusChanged = false;

    for (const t of tasks) {
      const s = tagVonDatum(t.start, minDate);
      const e = t.end ? tagVonDatum(t.end, minDate) : s;

      // Start-Event
      if (tag >= s && !gestartet.current.has(t.id)) {
        gestartet.current.add(t.id);
        statusChanged = true;
        if (t.typ === "neubau") {
          showGuids.push(...t.objektGuids);
        } else if (t.typ === "abbruch") {
          // Abbruch wird erst bei End-Event ausgeblendet
          setzeZustandAsync(t.objektGuids, { color: FARBEN.abbruch });
        } else if (t.typ === "temporaer") {
          selektierenAsync(t.objektGuids);
          setTimeout(() => { (api!.viewer as any).setSelection({ modelObjectIds: [] }, "set").catch(() => {}); }, 1000);
        }
      }

      // Neubau bleibt selektiert während aktiv
      if (t.typ === "neubau" && tag >= s && tag <= e) selGuidsLocal.push(...t.objektGuids);

      // End-Event
      if (tag > e && !beendet.current.has(t.id)) {
        beendet.current.add(t.id);
        statusChanged = true;
        if (t.typ === "abbruch") {
          hideGuids.push(...t.objektGuids);
        } else if (t.typ === "temporaer") {
          selektierenAsync(t.objektGuids);
          const batch = zuBatch(t.objektGuids); const viewer = api!.viewer;
          setTimeout(() => {
            viewer.setObjectState({ modelObjectIds: batch } as any, { visible: false } as any).catch(() => {});
          }, 1000);
        }
      }
    }

    // Gebatchte API-Calls (maximal 3 statt hunderte)
    if (showGuids.length > 0) setzeZustandAsync(showGuids, { visible: true });
    if (hideGuids.length > 0) setzeZustandAsync(hideGuids, { visible: false });
    if (statusChanged && selGuidsLocal.length > 0) selektierenAsync(selGuidsLocal);

    if (statusChanged) {
      const aktive = tasks.filter(t => istAktiv(t, tag));
      if (aktive.length > 0) setStatus(aktive.map(t => `${t.typ === "neubau" ? "🟢" : t.typ === "abbruch" ? "🟡" : t.typ === "temporaer" ? "🟤" : "⚫"} ${t.name}`).join(", "));
    }
  }

  // --- Playback ---
  const starten = useCallback(async () => {
    if (!api || !aktiveSim || laeuft || modellIds.length === 0 || tasks.length === 0) return;
    stopRef.current = false; setLaeuft(true);
    // Polling pausieren während Playback
    if (selRef.current) { clearInterval(selRef.current); selRef.current = null; }
    letzterEventTag.current = -1;
    if (currentTagRef.current <= 0) { await startzustand(); if (stopRef.current) { setLaeuft(false); return; } }
    lastTimeRef.current = performance.now();

    function frame(now: number) {
      if (stopRef.current) return;
      const delta = (now - lastTimeRef.current) / 1000;
      lastTimeRef.current = now;
      const tageProSek = sekProTag > 0 ? 1 / sekProTag : 1;
      const neuerTag = currentTagRef.current + delta * tageProSek;
      if (neuerTag >= totalTage) {
        setCurrentTag(totalTage); currentTagRef.current = totalTage;
        setLaeuft(false); setStatus("✓ Simulation abgeschlossen"); return;
      }
      setCurrentTag(neuerTag); currentTagRef.current = neuerTag;
      pruefeTaskEvents(neuerTag);
      animRef.current = requestAnimationFrame(frame);
    }
    animRef.current = requestAnimationFrame(frame);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [api, aktiveSim, laeuft, sekProTag, modellIds, tasks, totalTage]);

  function stoppen() {
    stopRef.current = true;
    if (animRef.current) { cancelAnimationFrame(animRef.current); animRef.current = null; }
    setLaeuft(false); setStatus("■ Gestoppt");
    // Polling wieder starten
    if (api && !selRef.current) {
      const check = async () => {
        try {
          const sel = await (api!.viewer as any).getSelection();
          const guids = new Set<string>();
          if (Array.isArray(sel)) for (const s of sel) { const mid = s?.modelId ?? ""; for (const rId of s?.objectRuntimeIds ?? []) guids.add(`${mid}:::${rId}`); }
          setSelGuids(guids);
        } catch { setSelGuids(new Set()); }
      };
      selRef.current = setInterval(check, 1500);
    }
  }

  const sliderDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  async function sliderChange(tag: number) {
    if (laeuft) return;
    setCurrentTag(tag); currentTagRef.current = tag;
    // Debounce: nur letzten Wert ausführen
    if (sliderDebounceRef.current) clearTimeout(sliderDebounceRef.current);
    sliderDebounceRef.current = setTimeout(async () => {
      gestartet.current.clear(); beendet.current.clear();
      tasks.forEach(t => { const s = tagVonDatum(t.start, minDate!); const e = t.end ? tagVonDatum(t.end, minDate!) : s; if (tag >= s) gestartet.current.add(t.id); if (tag > e) beendet.current.add(t.id); });
      await zustandBeiTag(tag);
    }, 150);
  }

  async function zuTask(idx: number) {
    if (laeuft || idx < 0 || idx >= tasks.length || !minDate) return;
    setSelTaskId(tasks[idx].id);
    const tag = tagVonDatum(tasks[idx].start, minDate);
    await sliderChange(tag);
  }

  if (!aktiveSim) return <div className="tc-empty"><div className="tc-empty-icon">▶</div><div className="tc-empty-title">Keine aktive Simulation</div></div>;

  const aktuellesDatum = minDate ? datumBeiTag(minDate, currentTag) : "";
  const dot = (typ: string) => ({ width: 8, height: 8, borderRadius: "50%" as const, display: "inline-block" as const, marginRight: 6, flexShrink: 0 as const,
    background: typ === "neubau" ? FARBEN.neubau : typ === "abbruch" ? FARBEN.abbruch : typ === "temporaer" ? FARBEN.temporaer : FARBEN.bestand });

  return (
    <div className="tc-setup-content">
      <div style={{ display: "flex", gap: 6 }}>
        {!laeuft ? (
          <button className="tc-btn-green" style={{ flex: 1 }} disabled={!api || tasks.length === 0} onClick={starten}>▶ Starten</button>
        ) : (
          <button className="tc-btn-danger" style={{ flex: 1 }} onClick={stoppen}>■ Stoppen</button>
        )}
        <input type="number" min={0.1} max={10} step={0.1} value={sekProTag}
          onChange={e => setSekProTag(Number(e.target.value))} disabled={laeuft}
          title="Sekunden pro Tag"
          style={{ width: 38, height: 38, textAlign: "center", border: "1px solid #d4dce4", fontSize: 12, fontFamily: "inherit", padding: 0 }} />
      </div>

      {totalTage > 0 && minDate && maxDate && (
        <div style={{ marginTop: 10 }}>
          <div style={{ textAlign: "center", fontSize: 13, fontWeight: 700, color: "var(--tc-text)", marginBottom: 4 }}>{aktuellesDatum}</div>
          <input type="range" min={0} max={totalTage} step={0.5} value={currentTag}
            onChange={e => sliderChange(Number(e.target.value))} disabled={laeuft} style={{ width: "100%" }} />
          <div style={{ display: "flex", justifyContent: "space-between", fontSize: 9, color: "var(--tc-text-3)" }}>
            <span>{formatDatum(minDate.toISOString().slice(0, 10))}</span>
            <span>{formatDatum(maxDate.toISOString().slice(0, 10))}</span>
          </div>
        </div>
      )}

      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 8, marginBottom: 4 }}>
        <div className="detail-block-title" style={{ margin: 0 }}>
          {ganttOffen ? "Gantt-Chart" : "Timeline"} ({tasks.length})
        </div>
        <button className="tc-btn-secondary" style={{ fontSize: 10, padding: "2px 8px" }}
          onClick={() => setGanttOffen(g => !g)}>
          {ganttOffen ? "☰ Liste" : "▤ Gantt"}
        </button>
      </div>

      {ganttOffen ? (
          <GanttChart
            tasks={tasks}
            currentTag={currentTag}
            totalTage={totalTage}
            minDate={minDate}
            laeuft={laeuft}
            onTaskClick={idx => zuTask(idx)}
            onSliderChange={tag => sliderChange(tag)}
            selTaskId={selTaskId}
            selGuids={selGuids}
            taskSort={taskSort}
            height={taskListHeight}
            dateColor="#333"
          />
      ) : (
      <div className="player-card" style={{ padding: 0, overflow: "hidden", maxHeight: taskListHeight, overflowY: "auto" }}>
        {tasks.length === 0 ? (
          <div style={{ padding: 10, fontSize: 11, color: "var(--tc-text-3)", textAlign: "center" }}>Keine Tasks mit Bauteilen</div>
        ) : (() => {
          const sorted = [...tasks].map((t, i) => ({ task: t, origIdx: i }));
          if (taskSort === "datum") {
            sorted.sort((a, b) => {
              const sa = parseDateUniversal(a.task.start)?.getTime() ?? 0;
              const sb = parseDateUniversal(b.task.start)?.getTime() ?? 0;
              if (sa !== sb) return sa - sb;
              const ea = parseDateUniversal(a.task.end)?.getTime() ?? sa;
              const eb = parseDateUniversal(b.task.end)?.getTime() ?? sb;
              return ea - eb;
            });
          } else if (taskSort === "aktiv") {
            sorted.sort((a, b) => {
              const aHat = selGuids.size > 0 && a.task.objektGuids.some(g => selGuids.has(g)) ? 1 : 0;
              const bHat = selGuids.size > 0 && b.task.objektGuids.some(g => selGuids.has(g)) ? 1 : 0;
              return bHat - aHat;
            });
          }
          return sorted.map(({ task, origIdx }) => {
          const aktiv = minDate ? istAktiv(task, currentTag) : false;
          const vorbei = minDate ? istVorbei(task, currentTag) : false;
          const hatSel = selGuids.size > 0 && task.objektGuids.some(g => selGuids.has(g));
          const sd = parseDateUniversal(task.start);
          const ed = parseDateUniversal(task.end);
          const dauer = sd && ed ? Math.max(1, Math.round((ed.getTime() - sd.getTime()) / 86400000)) : 1;
          const istSelTask = selTaskId === task.id;
          return (
            <div key={task.id} style={{
              display: "flex", alignItems: "center", padding: "5px 8px", gap: 6,
              borderBottom: "1px solid #eef1f4", cursor: laeuft ? "default" : "pointer",
              background: istSelTask ? "#e8f0fe" : hatSel ? "#f0f0f0" : aktiv ? "#edf7ed" : "transparent",
              opacity: vorbei ? 0.5 : 1, fontWeight: aktiv || hatSel || istSelTask ? 600 : 400,
            }} onClick={() => zuTask(origIdx)}>
              {aktiv && <span style={{ fontSize: 8, color: "#6cc07a" }}>▶</span>}
              <span style={dot(task.typ)} />
              <span style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontSize: 12 }}>{task.name}</span>
              <span style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", flexShrink: 0, lineHeight: 1.3 }}>
                <span style={{ fontSize: 11, color: "#333" }}>{formatDatum(task.start)}</span>
                <span style={{ fontSize: 11, color: "#333" }}>{formatDatum(task.end)}</span>
              </span>
              <span style={{ fontSize: 12, color: "#8a9baa", flexShrink: 0, minWidth: 28, textAlign: "right" }}>{dauer}d</span>
            </div>
          );
        });
        })()}
      </div>
      )}

      {/* Resize Handle */}
      <div
        style={{ height: 8, cursor: "ns-resize", display: "flex", alignItems: "center", justifyContent: "center", userSelect: "none" }}
        onMouseDown={e => {
          e.preventDefault();
          resizingRef.current = true;
          const startY = e.clientY;
          const startH = taskListHeight;
          const onMove = (ev: MouseEvent) => {
            if (!resizingRef.current) return;
            setTaskListHeight(Math.max(150, Math.min(800, startH + ev.clientY - startY)));
          };
          const onUp = () => { resizingRef.current = false; document.removeEventListener("mousemove", onMove); document.removeEventListener("mouseup", onUp); };
          document.addEventListener("mousemove", onMove);
          document.addEventListener("mouseup", onUp);
        }}
      >
        <div style={{ width: 40, height: 3, background: "#ccc", borderRadius: 2 }} />
      </div>

      <div style={{ padding: "4px 0", fontSize: 10, color: "var(--tc-text-3)", display: "flex", gap: 10, flexWrap: "wrap" }}>
        <span><span style={{ ...dot("neubau"), width: 6, height: 6, marginRight: 3 }} />Neubau</span>
        <span><span style={{ ...dot("bestand"), width: 6, height: 6, marginRight: 3 }} />Bestand</span>
        <span><span style={{ ...dot("abbruch"), width: 6, height: 6, marginRight: 3 }} />Abbruch</span>
        <span><span style={{ ...dot("temporaer"), width: 6, height: 6, marginRight: 3 }} />Temporär</span>
      </div>

      {status && (
        <div className={`alert ${status.startsWith("✓") ? "ok" : status.startsWith("■") ? "err" : "info"}`} style={{ marginTop: 8 }}>{status}</div>
      )}
    </div>
  );
}
