// formelHelpers.ts — Mengen-Formeln für Leistungspositionen (Tab Ressourcen): ein kleiner
// Excel-ähnlicher Ausdrucks-Parser, der aus IFC-Attributen eines einzelnen Bauteils eine Zahl
// berechnet. Attribute werden als {Pset||Property} referenziert (gleicher Schlüssel wie in
// AttributeFilter.tsx/TabTasks.tsx). Die Formel wird pro zugeordnetem Bauteil ausgewertet und über
// alle Bauteile eines Tasks summiert (Tab Kalkulation) — nicht umgekehrt, da z.B. "Länge × Breite"
// pro Bauteil berechnet werden muss, bevor man summiert.

export class FormelFehler extends Error {}

type Token =
  | { t: "num"; v: number }
  | { t: "attr"; v: string }
  | { t: "op"; v: string }
  | { t: "lparen" } | { t: "rparen" } | { t: "comma" }
  | { t: "ident"; v: string };

function tokenize(src: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;
  while (i < src.length) {
    const c = src[i];
    if (/\s/.test(c)) { i++; continue; }
    if (c === "{") {
      const end = src.indexOf("}", i);
      if (end === -1) throw new FormelFehler("Fehlende schließende Klammer „}" + `" bei Attribut-Referenz`);
      tokens.push({ t: "attr", v: src.slice(i + 1, end) });
      i = end + 1; continue;
    }
    if (c === "(") { tokens.push({ t: "lparen" }); i++; continue; }
    if (c === ")") { tokens.push({ t: "rparen" }); i++; continue; }
    if (c === ",") { tokens.push({ t: "comma" }); i++; continue; }
    if (c === "+" || c === "-" || c === "*" || c === "/") { tokens.push({ t: "op", v: c }); i++; continue; }
    if (c === ">" || c === "<") {
      let op = c; i++;
      if (src[i] as string === "=") { op += "="; i++; }
      tokens.push({ t: "op", v: op }); continue;
    }
    if (c === "=") { tokens.push({ t: "op", v: "=" }); i++; continue; }
    if (/[0-9.]/.test(c)) {
      let j = i;
      while (j < src.length && /[0-9.]/.test(src[j])) j++;
      const raw = src.slice(i, j);
      const n = Number(raw);
      if (isNaN(n)) throw new FormelFehler(`Ungültige Zahl „${raw}"`);
      tokens.push({ t: "num", v: n });
      i = j; continue;
    }
    if (/[A-Za-zÄÖÜäöü_]/.test(c)) {
      let j = i;
      while (j < src.length && /[A-Za-zÄÖÜäöü0-9_]/.test(src[j])) j++;
      tokens.push({ t: "ident", v: src.slice(i, j) });
      i = j; continue;
    }
    throw new FormelFehler(`Unerwartetes Zeichen „${c}"`);
  }
  return tokens;
}

type Node =
  | { t: "num"; v: number }
  | { t: "attr"; v: string }
  | { t: "neg"; v: Node }
  | { t: "bin"; op: string; l: Node; r: Node }
  | { t: "call"; name: string; args: Node[] };

class Parser {
  private pos = 0;
  private tokens: Token[];
  constructor(tokens: Token[]) { this.tokens = tokens; }
  private peek(): Token | undefined { return this.tokens[this.pos]; }
  private next(): Token {
    const t = this.tokens[this.pos];
    if (!t) throw new FormelFehler("Unerwartetes Ende der Formel");
    this.pos++;
    return t;
  }

  parseExpr(): Node { return this.parseComparison(); }

  private parseComparison(): Node {
    let l = this.parseAdditive();
    const t = this.peek();
    if (t?.t === "op" && [">", "<", ">=", "<=", "="].includes(t.v)) {
      this.next();
      const r = this.parseAdditive();
      l = { t: "bin", op: t.v, l, r };
    }
    return l;
  }

  private parseAdditive(): Node {
    let l = this.parseTerm();
    for (;;) {
      const t = this.peek();
      if (t?.t === "op" && (t.v === "+" || t.v === "-")) { this.next(); l = { t: "bin", op: t.v, l, r: this.parseTerm() }; }
      else break;
    }
    return l;
  }

  private parseTerm(): Node {
    let l = this.parseUnary();
    for (;;) {
      const t = this.peek();
      if (t?.t === "op" && (t.v === "*" || t.v === "/")) { this.next(); l = { t: "bin", op: t.v, l, r: this.parseUnary() }; }
      else break;
    }
    return l;
  }

  private parseUnary(): Node {
    const t = this.peek();
    if (t?.t === "op" && t.v === "-") { this.next(); return { t: "neg", v: this.parseUnary() }; }
    return this.parsePrimary();
  }

  private parsePrimary(): Node {
    const t = this.next();
    if (t.t === "num") return { t: "num", v: t.v };
    if (t.t === "attr") return { t: "attr", v: t.v };
    if (t.t === "lparen") {
      const inner = this.parseExpr();
      const close = this.next();
      if (close.t !== "rparen") throw new FormelFehler(`Erwarte „)"`);
      return inner;
    }
    if (t.t === "ident") {
      const name = t.v;
      const open = this.peek();
      if (open?.t === "lparen") {
        this.next();
        const args: Node[] = [];
        if (this.peek()?.t !== "rparen") {
          args.push(this.parseExpr());
          while (this.peek()?.t === "comma") { this.next(); args.push(this.parseExpr()); }
        }
        const close = this.next();
        if (close.t !== "rparen") throw new FormelFehler(`Erwarte „)" nach ${name}(...)`);
        return { t: "call", name, args };
      }
      throw new FormelFehler(`Unbekannter Bezeichner „${name}" — Funktionsaufrufe brauchen Klammern`);
    }
    throw new FormelFehler("Unerwarteter Ausdruck in der Formel");
  }

  erwarteEnde() { if (this.pos < this.tokens.length) throw new FormelFehler("Unerwartete Zeichen am Formelende"); }
}

/** Parst eine Formel — wirft FormelFehler bei ungültiger Syntax. Zum Validieren beim Speichern in Tab Ressourcen. */
export function parseFormel(formula: string): Node {
  const tokens = tokenize(formula);
  const parser = new Parser(tokens);
  const ast = parser.parseExpr();
  parser.erwarteEnde();
  return ast;
}

const FUNKTIONEN = new Set(["ROUND", "ABS", "MIN", "MAX", "IF"]);

function rufeFunktion(name: string, args: number[]): number {
  switch (name.toUpperCase()) {
    case "ROUND": { const f = 10 ** (args[1] ?? 0); return Math.round(args[0] * f) / f; }
    case "ABS": return Math.abs(args[0]);
    case "MIN": return Math.min(...args);
    case "MAX": return Math.max(...args);
    case "IF": return args[0] ? args[1] : args[2];
    default: throw new FormelFehler(`Unbekannte Funktion „${name}" — erlaubt: ${[...FUNKTIONEN].join(", ")}`);
  }
}

/** Attribut-Referenzen, die eine Formel verwendet (für Autocomplete-Hinweise/Validierung). */
export function referenzierteAttribute(ast: Node): string[] {
  const set = new Set<string>();
  (function walk(n: Node) {
    if (n.t === "attr") set.add(n.v);
    else if (n.t === "neg") walk(n.v);
    else if (n.t === "bin") { walk(n.l); walk(n.r); }
    else if (n.t === "call") n.args.forEach(walk);
  })(ast);
  return [...set];
}

export interface AuswertungsErgebnis { wert: number | null; fehlendeAttribute: string[]; }

/** Wertet eine geparste Formel für EIN Bauteil aus. `werte` sind dessen flache Pset||Property-Attribute. */
export function auswerten(ast: Node, werte: Record<string, string>): AuswertungsErgebnis {
  const fehlend = new Set<string>();
  function getAttr(key: string): number {
    const raw = werte[key];
    if (raw === undefined || raw === "") { fehlend.add(key); return NaN; }
    const n = Number(String(raw).trim().replace(",", "."));
    if (isNaN(n)) { fehlend.add(key); return NaN; }
    return n;
  }
  function ev(n: Node): number {
    switch (n.t) {
      case "num": return n.v;
      case "attr": return getAttr(n.v);
      case "neg": return -ev(n.v);
      case "bin": {
        const l = ev(n.l), r = ev(n.r);
        switch (n.op) {
          case "+": return l + r;
          case "-": return l - r;
          case "*": return l * r;
          case "/": return r === 0 ? NaN : l / r;
          case ">": return l > r ? 1 : 0;
          case "<": return l < r ? 1 : 0;
          case ">=": return l >= r ? 1 : 0;
          case "<=": return l <= r ? 1 : 0;
          case "=": return l === r ? 1 : 0;
          default: throw new FormelFehler(`Unbekannter Operator „${n.op}"`);
        }
      }
      case "call": return rufeFunktion(n.name, n.args.map(ev));
    }
  }
  const wert = ev(ast);
  if (fehlend.size > 0 || isNaN(wert) || !isFinite(wert)) return { wert: null, fehlendeAttribute: [...fehlend] };
  return { wert, fehlendeAttribute: [] };
}

export interface MengeErgebnis {
  wert: number | null;       // Summe über alle auswertbaren Bauteile, null wenn kein einziges auswertbar war
  anzahlObjekte: number;     // Bauteile insgesamt (task.objektGuids.length)
  anzahlFehler: number;      // davon ohne auswertbaren Wert ODER mit Ergebnis 0
  anzahlNull: number;        // davon mit einem auswertbaren, aber auf 0 lautenden Ergebnis (z.B. Volumen=0 — meist ein Datenfehler im Attribut)
  fehlendeAttribute: string[]; // eindeutige fehlende/ungültige Attribut-Keys, für Tooltip
  fehler?: string;           // Formel-Syntaxfehler, falls die Formel selbst ungültig ist
}

/** Formel über alle Bauteil-Attribute eines Tasks auswerten und summieren. Jedes Element von
 *  `objektWerteListe` sind die flachen Attribute EINES zugeordneten Bauteils. Ein Bauteil, dessen
 *  Formel auswertbar ist, aber genau 0 ergibt (z.B. Volumen=0), zählt als Fehler statt als gültiger
 *  Wert — 0 deutet fast immer auf ein fehlerhaftes/nicht gepflegtes Attribut hin, nicht auf ein
 *  tatsächlich volumenloses Bauteil. */
export function berechneMenge(formula: string, objektWerteListe: Record<string, string>[]): MengeErgebnis {
  let ast: Node;
  try { ast = parseFormel(formula); }
  catch (e) {
    return { wert: null, anzahlObjekte: objektWerteListe.length, anzahlFehler: objektWerteListe.length, anzahlNull: 0, fehlendeAttribute: [], fehler: e instanceof Error ? e.message : String(e) };
  }
  if (objektWerteListe.length === 0) return { wert: null, anzahlObjekte: 0, anzahlFehler: 0, anzahlNull: 0, fehlendeAttribute: [] };

  let summe = 0, ok = 0, anzahlNull = 0;
  const fehlend = new Set<string>();
  for (const w of objektWerteListe) {
    const { wert, fehlendeAttribute } = auswerten(ast, w);
    if (wert === null) { fehlendeAttribute.forEach(a => fehlend.add(a)); continue; }
    if (wert === 0) { anzahlNull++; continue; }
    summe += wert; ok++;
  }
  const anzahlFehler = objektWerteListe.length - ok;
  return { wert: ok > 0 ? Math.round(summe * 1000) / 1000 : null, anzahlObjekte: objektWerteListe.length, anzahlFehler, anzahlNull, fehlendeAttribute: [...fehlend] };
}
