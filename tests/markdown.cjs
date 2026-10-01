// The rules text: a small, safe subset of markdown, and [[Stop]] / [[Stop–Stop]] references.
//
//   npm run test:markdown
//
// The parser returns plain data, never HTML, so nothing typed into the rules box can become markup.
const { execFileSync } = require("child_process");
const fs = require("fs");
const os = require("os");
const path = require("path");

const root = path.join(__dirname, "..");
const out = fs.mkdtempSync(path.join(os.tmpdir(), "ttr-markdown-"));
execFileSync("npx", ["tsc", "app/markdown.ts", "app/map-data.ts", "--outDir", out, "--module", "commonjs", "--target", "es2022", "--moduleResolution", "node", "--skipLibCheck", "--lib", "es2022,dom"], { cwd: root, stdio: "inherit" });
const md = require(path.join(out, "markdown.js"));
const { initialMap } = require(path.join(out, "map-data.js"));

const ok = [];
const bad = [];
const check = (label, pass, detail = "") => { (pass ? ok : bad).push(`${label}${detail ? " — " + detail : ""}`); };
const text = (inlines) => inlines.map((i) => (i.t === "text" ? i.v : i.t === "ref" ? `[[${i.name}]]` : i.t === "code" ? `\`${i.v}\`` : text(i.c))).join("");

// ------------------------------------------------------------------ blocks
let blocks = md.parseMarkdown("# One\n\n## Two\n### Three\n#### Four\n");
check("headings one to three are headings", blocks.slice(0, 3).map((b) => `${b.t}${b.level}`).join() === "h1,h2,h3", JSON.stringify(blocks.map((b) => b.t + (b.level || ""))));
check("a fourth level is still a heading, at the lowest size", blocks[3].t === "h" && blocks[3].level === 3);
blocks = md.parseMarkdown("First line\ncontinues here.\n\nSecond paragraph.");
check("a blank line makes a new paragraph, a line break does not", blocks.length === 2 && text(blocks[0].c) === "First line continues here.", JSON.stringify(blocks));
blocks = md.parseMarkdown("- apples\n- pears\n  - green\n  - yellow\n- plums");
check("a list has its items, and a deeper indent nests", blocks.length === 1 && blocks[0].t === "ul" && blocks[0].items.length === 3 && blocks[0].items[1].sub && blocks[0].items[1].sub.items.length === 2, JSON.stringify(blocks));
blocks = md.parseMarkdown("1. draw\n2. claim\n3. score");
check("a numbered list is ordered", blocks[0].t === "ol" && blocks[0].items.length === 3);
blocks = md.parseMarkdown("* star\n+ plus\n- dash");
check("stars, pluses and dashes all start a list", blocks.length === 1 && blocks[0].items.length === 3);
blocks = md.parseMarkdown("> Remember this.\n> And this.");
check("a quote keeps its lines together", blocks.length === 1 && blocks[0].t === "quote" && /Remember this\. And this\./.test(text(blocks[0].c)));
blocks = md.parseMarkdown("Above\n\n---\n\nBelow");
check("three dashes are a rule", blocks.map((b) => b.t).join() === "p,hr,p");
blocks = md.parseMarkdown("| Players | Wagons |\n| --- | ---: |\n| 2 | 45 |\n| 5 | 30 |");
check("a table has a head and its rows", blocks.length === 1 && blocks[0].t === "table" && blocks[0].head.length === 2 && blocks[0].rows.length === 2 && text(blocks[0].rows[1][1]) === "30", JSON.stringify(blocks));
check("and a column marked with a colon on the right is right-aligned", blocks[0].align[1] === "right" && !blocks[0].align[0]);
check("empty text is no blocks", md.parseMarkdown("").length === 0 && md.parseMarkdown("  \n\n ").length === 0);

// ------------------------------------------------------------------ inline
let inl = md.parseInline("a **bold** and *italic* and _also_ and `code`");
check("bold, italic, underscored italic and code", inl.map((i) => i.t).join() === "text,strong,text,em,text,em,text,code", inl.map((i) => i.t).join());
inl = md.parseInline("2 * 3 * 4 and snake_case_name and **unclosed");
check("a lone star, an underscore inside a word and an unclosed mark stay literal", inl.every((i) => i.t === "text") && text(inl) === "2 * 3 * 4 and snake_case_name and **unclosed", JSON.stringify(inl));
inl = md.parseInline("\\*not italic\\* and \\[[not a link]]");
check("a backslash makes a mark literal", inl.every((i) => i.t === "text") && text(inl) === "*not italic* and [[not a link]]", JSON.stringify(inl));
inl = md.parseInline("<script>alert(1)</script> <b>bold?</b>");
check("typed HTML is only text", inl.every((i) => i.t === "text") && /<script>alert\(1\)<\/script> <b>bold\?<\/b>/.test(text(inl)));
inl = md.parseInline("see [[Westport]] and [[Westport–Central]].");
check("[[...]] is a reference", inl.filter((i) => i.t === "ref").map((i) => i.name).join("|") === "Westport|Westport–Central", JSON.stringify(inl));
inl = md.parseInline("`[[Westport]]` in code");
check("a reference inside code stays code", inl[0].t === "code" && inl.every((i) => i.t !== "ref"));
inl = md.parseInline("**Go to [[Westport]]** now");
check("a reference can sit inside bold", inl[0].t === "strong" && inl[0].c.some((i) => i.t === "ref"), JSON.stringify(inl));
inl = md.parseInline("[[]] and [[ ]] and [[unclosed");
check("an empty or unclosed reference is text", inl.every((i) => i.t === "text"), JSON.stringify(inl));

// ------------------------------------------------------------------ references against a map
const map = JSON.parse(JSON.stringify(initialMap));
const names = map.stops.map((s) => s.name);
const a = map.routes[0], from = map.stops.find((s) => s.id === a.a), to = map.stops.find((s) => s.id === a.b);
let r = md.resolveRef(from.name, map);
check("a stop name finds the stop", r.kind === "stop" && r.stop.id === from.id, JSON.stringify(r).slice(0, 80));
r = md.resolveRef(from.name.toLowerCase().toUpperCase(), map);
check("in any case", r.kind === "stop" && r.stop.id === from.id);
r = md.resolveRef(`${from.name}–${to.name}`, map);
check("two names with an en dash find the route between them", r.kind === "route" && r.routes.some((x) => x.id === a.id), JSON.stringify(r).slice(0, 100));
for (const sep of ["-", "—", " → ", "->", " - "]) {
  const rr = md.resolveRef(`${from.name}${sep}${to.name}`, map);
  check(`and with “${sep.trim()}” as the dash`, rr.kind === "route" && rr.routes.some((x) => x.id === a.id));
}
r = md.resolveRef(`${to.name}–${from.name}`, map);
check("in either direction", r.kind === "route" && r.routes.some((x) => x.id === a.id));
const hyphen = JSON.parse(JSON.stringify(map));
hyphen.stops[0].name = "Stoke-on-Trent";
r = md.resolveRef("Stoke-on-Trent", hyphen);
check("a stop with hyphens in its name is still a stop", r.kind === "stop" && r.stop.id === hyphen.stops[0].id);
const other = hyphen.routes.find((x) => x.a === hyphen.stops[0].id || x.b === hyphen.stops[0].id);
if (other) {
  const mate = hyphen.stops.find((s) => s.id === (other.a === hyphen.stops[0].id ? other.b : other.a));
  r = md.resolveRef(`Stoke-on-Trent–${mate.name}`, hyphen);
  check("and takes part in a route reference", r.kind === "route" && r.routes.some((x) => x.id === other.id), JSON.stringify(r).slice(0, 100));
}
r = md.resolveRef("Atlantis", map);
check("a name that is no stop is missing", r.kind === "missing" && r.reason === "stop");
const unlinked = map.stops.find((s) => !map.routes.some((x) => (x.a === from.id && x.b === s.id) || (x.b === from.id && x.a === s.id)) && s.id !== from.id);
r = md.resolveRef(`${from.name}–${unlinked.name}`, map);
check("two stops with no route between them are missing, and say so", r.kind === "missing" && r.reason === "route", JSON.stringify(r).slice(0, 100));
const doubled = JSON.parse(JSON.stringify(map));
doubled.routes.push({ ...a, id: "twin", color: "red" });
r = md.resolveRef(`${from.name}–${to.name}`, doubled);
check("a double route gives both its routes", r.kind === "route" && r.routes.length >= 2);
check("the names in the map are what the test used", names.length > 3);

inl = md.parseInline("*see [[Rock*Hill]] now* and **bold [[Rock**Hill]] here**");
check("a star inside a name does not close italics or bold that began before it", inl.length === 3 && inl[0].t === "em" && inl[0].c.some((i) => i.t === "ref" && i.name === "Rock*Hill") && inl[2].t === "strong" && inl[2].c.some((i) => i.t === "ref" && i.name === "Rock**Hill"), JSON.stringify(inl));
inl = md.parseInline("*see `a*b` now*");
check("nor does one inside code", inl.length === 1 && inl[0].t === "em" && inl[0].c.some((i) => i.t === "code" && i.v === "a*b"), JSON.stringify(inl));

// ------------------------------------------------------------------ names with dashes in them
const stop = (id, name) => ({ id, name, type: "city", x: 0, y: 0 });
const road = (id, a, b) => ({ id, a, b, length: 3, type: "city", color: "neutral" });
const dashed = {
  stops: [stop("s1", "Stoke-on-Trent"), stop("s2", "Hanley"), stop("s3", "Aix–Marseille"), stop("s4", "Paris"), stop("s5", "Saint-Étienne"), stop("s6", "A"), stop("s7", "B"), stop("s8", "A-B")],
  routes: [road("r1", "s1", "s2"), road("r2", "s3", "s4"), road("r3", "s5", "s1"), road("r4", "s6", "s7"), road("r5", "s8", "s4")],
};
let d = md.resolveRef("Stoke-on-Trent", dashed);
check("a stop with hyphens in its name is that stop", d.kind === "stop" && d.stop.id === "s1");
d = md.resolveRef("Stoke-on-Trent–Hanley", dashed);
check("and the route from it, written with an en dash, is found", d.kind === "route" && d.routes[0].id === "r1");
d = md.resolveRef("Stoke-on-Trent-Hanley", dashed);
check("also when only hyphens separate the two", d.kind === "route" && d.routes[0].id === "r1", JSON.stringify(d).slice(0, 90));
d = md.resolveRef("Saint-Étienne–Stoke-on-Trent", dashed);
check("two names that both hold hyphens", d.kind === "route" && d.routes[0].id === "r3");
d = md.resolveRef("Saint-Étienne-Stoke-on-Trent", dashed);
check("even with hyphens everywhere", d.kind === "route" && d.routes[0].id === "r3", JSON.stringify(d).slice(0, 90));
d = md.resolveRef("Aix–Marseille", dashed);
check("a stop with an en dash in its own name is still that stop", d.kind === "stop" && d.stop.id === "s3");
d = md.resolveRef("Aix–Marseille–Paris", dashed);
check("and takes part in a route", d.kind === "route" && d.routes[0].id === "r2", JSON.stringify(d).slice(0, 90));
d = md.resolveRef("A–B", dashed);
check("where A, B and A-B are all stops, an en dash means the route between A and B", d.kind === "route" && d.routes[0].id === "r4", JSON.stringify(d).slice(0, 90));
d = md.resolveRef("A-B", dashed);
check("and the exact name A-B is the stop of that name", d.kind === "stop" && d.stop.id === "s8");
d = md.resolveRef("A-B–Paris", dashed);
check("and A-B to Paris is the route from that stop", d.kind === "route" && d.routes[0].id === "r5", JSON.stringify(d).slice(0, 90));
d = md.resolveRef("stoke-on-trent – hanley", dashed);
check("spaces round the dash and any case do not matter", d.kind === "route" && d.routes[0].id === "r1");
inl = md.parseInline("see [[Stoke-on-Trent–Hanley]] and [[Saint-Étienne]]");
check("the text parser keeps such a name whole inside [[ ]]", inl.filter((i) => i.t === "ref").map((i) => i.name).join("|") === "Stoke-on-Trent–Hanley|Saint-Étienne", JSON.stringify(inl));
inl = md.parseInline("a *b* and [[Rock_Hill]] and _c_");
check("an underscore in a name does not start italics", inl.some((i) => i.t === "ref" && i.name === "Rock_Hill") && inl.filter((i) => i.t === "em").length === 2, JSON.stringify(inl));

console.log(`${ok.length} passed, ${bad.length} failed`);
if (bad.length) { console.log("FAIL:"); for (const b of bad) console.log("  ✗ " + b); process.exit(1); }
