import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import FehlerGrenze from "./FehlerGrenze";

// Ohne Browser-Testumgebung: Zustandsübergang + Fallback-Darstellung direkt prüfen
describe("FehlerGrenze", () => {
  it("ohne Fehler: Inhalt unverändert", () => {
    const html = renderToStaticMarkup(<FehlerGrenze bereich="Tab X"><span>Inhalt</span></FehlerGrenze>);
    expect(html).toBe("<span>Inhalt</span>");
  });

  it("nach Fehler: Meldung mit Bereich, Fehlertext und Erneut-versuchen statt weisser Seite", () => {
    const g = new FehlerGrenze({ bereich: "Tab Gantt", children: <span>Inhalt</span> });
    g.state = FehlerGrenze.getDerivedStateFromError(new Error("localStorage voll"));
    const html = renderToStaticMarkup(<>{g.render()}</>);
    expect(html).toContain("Fehler in Tab Gantt");
    expect(html).toContain("localStorage voll");
    expect(html).toContain("Erneut versuchen");
    expect(html).not.toContain("Inhalt");
  });
});
