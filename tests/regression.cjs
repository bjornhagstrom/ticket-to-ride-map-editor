// Browser regression suite. Drives the editor the way a person does and checks what came out.
//
//   npm run dev            # in one terminal, it expects http://localhost:3000/ttr/
//   npm run test:regression
//
// It writes to the same local storage the editor uses, so it will replace whatever map is open in
// that browser profile. It runs headless in its own profile, so your own browser is untouched.
const { chromium } = require("playwright");
// The editor to test. Another session may be serving its own working copy on 3000; point this at
// yours with TTR_URL, for example TTR_URL=http://localhost:3001/ttr/ npm run test:regression.
const BASE = process.env.TTR_URL || "http://localhost:3000/ttr/";
const fs = require("fs");
const { execFileSync } = require("child_process");
const os = require("os");
const path = require("path");

const ok = [];
const bad = [];
// TTR_BROWSER=webkit runs the suite in Safari's engine. A few checks are Chromium's own and are skipped
// there, each named here with its reason: the editor gives Safari a print profile of its own (Safari
// ignores @page margins, so full size takes 12 sheets of A4, not 9), and only Chromium saves a PDF.
const webkitRun = process.env.TTR_BROWSER === "webkit";
const CHROMIUM_ONLY = [
  [/^while Chrome keeps 9$/, "Chrome's own sheet count"],
  [/^and hears nothing about Safari$/, "Safari is told about its print profile, as it should be"],
  [/is 9 sheets of A4 at full size/, "Safari's profile makes it 12"],
  [/prints the 9 sheets its cell promises/, "a PDF count, and Safari's profile makes it 12"],
  [/^and marks to trim at on every sheet$/, "counted for 9 sheets"],
  [/upright page box that fits A4 less its margins/, "Safari's page box is smaller by its own margins"],
  [/with the browser's own margins is still 9 sheets/, "a PDF count"],
  [/^and per panel it is still 6$/, "a PDF count"],
  [/these rules take one page, and the cards at least one/, "a PDF count"],
  [/^saved as a PDF it is a single page$/, "reads the PDF"],
  [/read from the PDF itself/, "reads the PDF"],
  [/^and the pages are the sum of the three on their own/, "a PDF count: with no PDF every count is 0 and the sum holds for nothing"],
  [/^and the pages are the board's plus the rules'$/, "a PDF count, as above"],
];
const skipped = [];
const check = (label, pass, detail = "") => {
  const chromiumOnly = webkitRun && CHROMIUM_ONLY.find(([pattern]) => pattern.test(label));
  if (chromiumOnly) { skipped.push(`${label} (${chromiumOnly[1]})`); return; }
  (pass ? ok : bad).push(`${label}${detail ? " — " + detail : ""}${pass ? "" : ` [section ${sectionOpen ? sectionOpen.n : "?"}]`}`);
};
// Only Chromium saves a PDF; in WebKit the checks that read one are skipped (CHROMIUM_ONLY).
const pdfOf = (page, options) => (webkitRun ? Promise.resolve(Buffer.from("")) : page.pdf(options));

// TTR_ONLY=51,52 or TTR_ONLY=36-40 runs only those sections (docs/TESTING.md). Sections 1 to 34 share
// one page and each starts from what the one before left, so naming any of them runs all of them as a
// chain (section 33 has a page of its own, like 35 and up, and runs alone). A partial run says so.
const only = (() => {
  if (!process.env.TTR_ONLY) return null;
  const wanted = new Set();
  for (const part of process.env.TTR_ONLY.split(",").map((x) => x.trim()).filter(Boolean)) {
    const range = /^(\d+)-(\d+)$/.exec(part);
    if (range) for (let n = Number(range[1]); n <= Number(range[2]); n++) wanted.add(n);
    else if (/^\d+$/.test(part)) wanted.add(Number(part));
    else { console.error(`TTR_ONLY: "${part}" is not a section number or a range`); process.exit(2); }
  }
  return wanted;
})();
const wants = (n) => !only || only.has(n);
const runChain = !only || [...only].some((n) => (n >= 1 && n <= 32) || n === 34);

// TTR_WAIT_SCALE=0.4 shortens every fixed wait (waitForTimeout) to that share of what is written, but not below
// TTR_WAIT_FLOOR ms (25 unless set; a wait written shorter than that is left as it is), and TTR_FULL_WAITS=12,40 keeps the full waits in the sections named. Most of the written waits
// are generous: the suite spends more than half its time in them (docs/TESTING.md). Unset, nothing changes.
const waitScale = Number(process.env.TTR_WAIT_SCALE || 1);
const waitFloor = Number(process.env.TTR_WAIT_FLOOR || 25);
const fullWaitSections = new Set((process.env.TTR_FULL_WAITS || "").split(",").map((x) => Number(x.trim())).filter(Boolean));
let currentScale = 1;
// TTR_TIMES=file writes how many seconds each section took (the parallel runner balances its shards by them).
const sectionTimes = {};
let sectionOpen = null;
const sectionStart = (n) => {
  const now = Date.now();
  if (sectionOpen) sectionTimes[sectionOpen.n] = Math.round((now - sectionOpen.at) / 100) / 10;
  sectionOpen = { n, at: now };
  currentScale = fullWaitSections.has(n) ? 1 : waitScale;
};

(async () => {
  // TTR_BROWSER=webkit runs the same suite in Safari's engine (AGENTS.md: before every deploy).
  const browser = await (process.env.TTR_BROWSER === "webkit" ? require("playwright").webkit : chromium).launch();
  const page = await (await browser.newContext({ viewport: { width: 1500, height: 1000 } })).newPage();
  const errors = [];
  page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
  page.on("pageerror", (e) => errors.push(String(e)));

  // One place to scale every fixed wait: the page class's own waitForTimeout.
  const pageProto = Object.getPrototypeOf(page);
  const realWait = pageProto.waitForTimeout;
  pageProto.waitForTimeout = function (ms) { return realWait.call(this, ms > 0 && currentScale !== 1 ? Math.min(ms, Math.max(waitFloor, Math.round(ms * currentScale))) : ms); };

  await page.goto(BASE, { waitUntil: "networkidle" });

  // Millimetres to CSS pixels, for the sections that measure a print; sections of their own use it too.
  const mm = (value) => value / 25.4 * 96;
  // Spreadsheets come in through a dialog of their own: Import → Spreadsheet (CSV) → Import spreadsheets…, then Choose files….
  const openSpreadsheetDialog = async (p) => { await p.getByRole("button", { name: "Import", exact: true }).click(); await p.waitForTimeout(250); await p.getByRole("menuitem", { name: "Spreadsheet (CSV)" }).click(); await p.waitForTimeout(250); await p.getByRole("menuitem", { name: "Import spreadsheets…" }).click(); await p.waitForTimeout(300); };
  const chooseSpreadsheets = async (p, files) => { await openSpreadsheetDialog(p); const chooser = p.waitForEvent("filechooser"); await p.getByRole("dialog", { name: "Import spreadsheets" }).getByRole("button", { name: "Choose files…" }).click(); await (await chooser).setFiles(files); await p.waitForTimeout(600); };
  // The print dialog's choices are made in its table of sheets (a cell is a paper and a way to split) and with
  // its box for one big page. These work on a dialog or a whole page.
  const SPLIT_COLUMN = { sheet: 0, panel: 1, full: 2 };
  const bigPageBox = (d) => d.getByRole("checkbox", { name: "One big page, real size", exact: true });
  const pressedCell = (d) => d.locator('.print-table button[aria-pressed="true"]');
  const cellAt = (d, paper, column) => d.locator(`.print-table tbody tr[data-paper="${paper}"] td:nth-of-type(${column + 1}) button`);
  const pressedPaper = (d) => pressedCell(d).evaluate((b) => b.closest("tr").dataset.paper);
  const pressedColumn = (d) => pressedCell(d).evaluate((b) => [...b.closest("tr").querySelectorAll("td")].indexOf(b.closest("td")));
  const leaveBigPage = async (d) => { if ((await bigPageBox(d).count()) && (await bigPageBox(d).isChecked())) await bigPageBox(d).uncheck(); };
  const pickSplit = async (d, split) => { if (split === "page") { await bigPageBox(d).check(); return; } await leaveBigPage(d); await cellAt(d, await pressedPaper(d), SPLIT_COLUMN[split]).click(); };
  const PAPER_LABEL = { a4: "A4", a3: "A3", letter: "US Letter", tabloid: "Tabloid" };
  const hasTable = async (d) => (await d.locator(".print-table").count()) > 0;
  const pickPaper = async (d, paper) => { if (!(await hasTable(d))) { await d.getByRole("radio", { name: PAPER_LABEL[paper], exact: true }).check(); return; } await leaveBigPage(d); await cellAt(d, paper, await pressedColumn(d)).click(); };
  const splitIs = async (d, split) => split === "page" ? bigPageBox(d).isChecked() : !(await bigPageBox(d).isChecked()) && (split === "full" ? (await pressedColumn(d)) >= 2 : (await pressedColumn(d)) === SPLIT_COLUMN[split]);
  const paperIs = async (d, paper) => !(await hasTable(d)) ? d.getByRole("radio", { name: PAPER_LABEL[paper], exact: true }).isChecked() : !(await bigPageBox(d).isChecked()) && (await pressedPaper(d)) === paper;
  if (runChain) {
  sectionStart(1);
  // 1. welcome guide
  check("welcome guide appears", await page.getByRole("button", { name: "Load the example map" }).isVisible());
  {
    // The guide says what matters, and only that: a few short steps, tickets and rules among them,
    // and nothing about how a print is laid out.
    const steps = await page.locator(".welcome-guide .guide-steps li").evaluateAll((lis) => lis.map((li) => ({ title: li.querySelector("strong").textContent.trim(), text: li.querySelector("p").textContent.trim() })));
    const all = steps.map((s) => `${s.title}. ${s.text}`).join(" ");
    check("the guide has a handful of steps", steps.length >= 5 && steps.length <= 7, String(steps.length));
    check("drawing the map says stops and routes can come from a spreadsheet", steps.some((s) => /draw/i.test(s.title) && /spreadsheet/i.test(s.text)), steps.map((s) => s.text).join(" | "));
    check("printing says each ticket card has a small map", steps.some((s) => /print/i.test(s.title) && /small map/i.test(s.text)));
    check("one of them is about destination tickets, and says the editor can build a full deck of them", steps.some((s) => /ticket/i.test(s.title) && /build a full deck of tickets/i.test(s.text)), steps.map((s) => s.text).join(" | "));
    check("one is about the rules, one about printing, one about keeping the map safe", steps.some((s) => /rules/i.test(s.title)) && steps.some((s) => /print/i.test(s.title)) && steps.some((s) => /saved|save|backup/i.test(`${s.title} ${s.text}`)));
    check("the printing step names what can be printed: the board, the tickets as cards, the rules", (() => { const p = steps.find((s) => /print/i.test(s.title)); return Boolean(p) && /board/i.test(p.text) && /ticket/i.test(p.text) && /rules/i.test(p.text); })());
    const board = steps.find((s) => /board/i.test(s.title));
    check("choosing the board says nothing about paper or how a print is cut up", Boolean(board) && !/\b(A4|A3|letter|tabloid|paper|sheet|panel|full size|print)/i.test(board.text), board && board.text);
    check("the step on keeping the map says it is saved in the browser and can be downloaded to the computer", steps.some((s) => s.title === "Saved in your browser and download to your computer"), steps.map((s) => s.title).join(" | "));
    check("every step is short, and the whole guide is", steps.every((s) => s.text.length <= 190) && all.length <= 1000, `${Math.max(...steps.map((s) => s.text.length))} characters at most in a step, ${all.length} in all`);
  }
  await page.getByRole("button", { name: "Load the example map" }).click();
  await page.waitForTimeout(600);

  const badges = async () => (await page.locator(".map-status span").allTextContents());
  // Starting over is in Settings, under Map, behind a confirmation (block 48).
  const startOver = async (p = page) => { await p.getByRole("button", { name: "Settings" }).click(); await p.waitForTimeout(300); await p.locator(".settings-nav-item", { hasText: /^Map/ }).click(); await p.getByRole("button", { name: "Start over…" }).click(); await p.waitForTimeout(300); await p.getByRole("alertdialog").getByRole("button", { name: "Start over", exact: true }).click(); await p.waitForTimeout(400); };
  // The logo: a route, two stops joined by three wagon spaces, the same everywhere it appears, and
  // no vehicle. The favicon is the same drawing.
  const logoOn = (p) => p.evaluate(() => Array.from(document.querySelectorAll("svg.route-logo")).map((svg) => ({ wagons: svg.querySelectorAll(".route-logo-wagon").length, stops: svg.querySelectorAll(".route-logo-stop").length, label: svg.getAttribute("aria-label"), header: Boolean(svg.closest(".brand, .about-head")) })));
  {
    const logos = await logoOn(page);
    check("the header shows the route logo: two stops and three wagon spaces", logos.some((l) => l.header && l.wagons === 3 && l.stops === 2 && l.label === "Map prototypes"), JSON.stringify(logos));
    check("and no bus anywhere", (await page.locator(".lucide-bus-front").count()) === 0);
    const favicon = await page.evaluate(async () => { const link = document.querySelector('link[rel="icon"]'); if (!link) return null; const res = await fetch(link.href); return { href: link.getAttribute("href"), ok: res.ok, text: await res.text() }; });
    check("the favicon is the route logo too", Boolean(favicon) && favicon.ok && /data-logo="route"/.test(favicon.text) && (favicon.text.match(/route-logo-wagon/g) || []).length === 3, favicon && favicon.href);
  }
  check("example map loads", (await badges())[2] === "15 stops", (await badges()).slice(0, 4).join(", "));

  // 1a. Safari gets smaller sheets, and is told why. A second page claiming to be Safari.
  {
    const safariUA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_6) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15";
    const safariPage = await (await browser.newContext({ viewport: { width: 1500, height: 1000 }, userAgent: safariUA })).newPage();
    await safariPage.goto(BASE, { waitUntil: "networkidle" });
    await safariPage.getByRole("button", { name: "Load the example map" }).click();
    await safariPage.waitForTimeout(600);
    await safariPage.getByRole("button", { name: "Print map" }).click();
    await safariPage.waitForTimeout(400);
    const safariCell = await safariPage.locator('.print-table tbody tr[data-paper="a4"] td:nth-of-type(3) button').getAttribute("data-pages");
    check("in Safari the table promises 12 sheets of A4 at full size", safariCell === "12", String(safariCell));
    check("and the dialog does not go into why: that is not for the person printing", !/spilled|first print layout/i.test(await safariPage.locator('[role="dialog"]').first().textContent()));
    // Safari ignores the size of a page, so on one page the size of the board it is told what to do instead.
    await pickSplit(safariPage, "page");
    const safariPageNote = await safariPage.locator(".print-page-note").textContent();
    check("on one page the size of the board, Safari is told to add a custom paper size of 810 × 553 mm", /custom paper size of 810 × 553 mm/.test(safariPageNote) && /Safari/.test(safariPageNote), safariPageNote);
    await safariPage.context().close();
  }
  await page.getByRole("button", { name: "Print map" }).click();
  await page.waitForTimeout(400);
  check("while Chrome keeps 9", (await page.locator('.print-table tbody tr[data-paper="a4"] td:nth-of-type(3) button').getAttribute("data-pages")) === "9");
  check("and hears nothing about Safari", !/Safari/.test(await page.locator('[role="dialog"]').first().textContent()));
  await page.keyboard.press("Escape");
  await page.waitForTimeout(300);

  // 1b. the example map shows what the editor can do, and is itself a clean map
  const exampleStored = () => page.evaluate(() => JSON.parse(localStorage.getItem("ttr-map")));
  const example = await exampleStored();
  await page.reload({ waitUntil: "networkidle" });
  await page.waitForTimeout(700);
  const reloaded = await exampleStored();
  check("the example map is the same after a reload", JSON.stringify(reloaded.routeTypeStyles) === JSON.stringify(example.routeTypeStyles) && JSON.stringify(reloaded.routes) === JSON.stringify(example.routes),
    reloaded.routeTypeStyles.map((t) => t.label).join(", "));
  check("and uses no styles the file format folded away", example.routes.every((r) => !r.wagonStyle && !r.lineStyle) && (example.lineStyles || []).length === 0);
  const typeIds = new Set(example.routeTypeStyles.map((t) => t.id));
  check("every route type it uses exists", example.routes.every((r) => typeIds.has(r.type)), example.routes.filter((r) => !typeIds.has(r.type)).map((r) => r.type).join(", "));
  const panelText = await page.locator(".tool-panel, .panel").first().textContent();
  // How long routes are drawn against their wagons is read in the balance report; the left column
  // no longer repeats it.
  const roomSection = async () => {
    await page.getByRole("button", { name: "Map balance", exact: true }).click();
    await page.waitForTimeout(500);
    const section = page.locator(".analysis-section", { has: page.locator("h3", { hasText: "Room per wagon" }) });
    const result = { text: await section.textContent(), warnings: await section.locator(".analysis-warning-row").count() };
    await page.keyboard.press("Escape");
    await page.waitForTimeout(300);
    return result;
  };
  check("the left column no longer explains wagon sizes", (await page.getByText(/Wagon spaces are drawn at the size/).count()) === 0);
  const exampleRoom = await roomSection();
  check("every route is drawn about as long as its wagons need", exampleRoom.warnings === 0, `${exampleRoom.warnings} routes flagged`);
  const note = example.notes[0].text;
  check("the note says the map can be printed for quick playtests with markers in different colours", /print/i.test(note) && /playtest/i.test(note) && /marker/i.test(note) && /colou?r/i.test(note), note);
  const noteFits = await page.evaluate(() => { const el = document.querySelector(".map-canvas .note-box-text"); return { scroll: el.scrollHeight, client: el.clientHeight }; });
  check("and the whole note fits in its box", noteFits.scroll <= noteFits.client + 1, `${noteFits.scroll}px of text in ${noteFits.client}px`);
  const noteCovers = await page.evaluate(() => {
    const box = document.querySelector(".map-canvas .note-box-bg").getBoundingClientRect();
    const hit = (r) => r.left < box.right && r.right > box.left && r.top < box.bottom && r.bottom > box.top;
    return Array.from(document.querySelectorAll(".map-canvas .stop")).filter((g) => hit(g.getBoundingClientRect())).map((g) => g.textContent);
  });
  check("and it covers no stop or stop name", noteCovers.length === 0, noteCovers.join(", "));
  check("no stop name sits on a route", (await page.getByText(/stop names? on a route/).count()) === 0);
  check("no crossings and no under-connected stop", (await page.getByText("No crossings").count()) === 1 && (await page.getByText("Well connected").count()) === 1);
  void panelText;
  const typeOf = (id) => example.stopTypeStyles.find((t) => t.id === id) || {};
  const junction = example.stops.find((st) => typeOf(st.type).junction);
  check("it has a junction", Boolean(junction));
  check("whose name is not drawn", junction && !(await page.evaluate(() => Array.from(document.querySelectorAll(".map-canvas .stop text")).map((t) => t.textContent))).includes(junction.name));
  check("a stop locked in place", example.stops.some((st) => st.locked));
  check("stops of all three sizes", new Set(example.stops.map((st) => st.size || "medium")).size === 3);
  check("more than one kind of stop marking", new Set(example.stops.map((st) => st.symbol).filter(Boolean)).size >= 2);
  const pairKey = (r) => [r.a, r.b].sort().join("|");
  check("a double route", example.routes.some((r, i) => example.routes.some((o, j) => j !== i && pairKey(o) === pairKey(r))));
  check("curved routes and a straight one", example.routes.some((r) => r.curved === false) && example.routes.some((r) => r.curved !== false && (r.points || []).length));
  check("a space that needs a locomotive", example.routes.some((r) => (r.locomotiveSlots || []).length));
  const shapeOf = (r) => (example.routeTypeStyles.find((t) => t.id === r.type) || {}).shape;
  check("tunnel and boat routes", example.routes.some((r) => shapeOf(r) === "serrated") && example.routes.some((r) => shapeOf(r) === "oval"));
  // Bends that show: one route turns two ways, and a straight one has a corner you can see.
  const pos = (id) => example.stops.find((st) => st.id === id);
  const bendTurns = (r) => { const pts = [pos(r.a), ...(r.points || []), pos(r.b)]; return pts.slice(1, -1).map((p, i) => { const a = pts[i], b = pts[i + 2]; const u = { x: p.x - a.x, y: p.y - a.y }, v = { x: b.x - p.x, y: b.y - p.y }; return Math.atan2(u.x * v.y - u.y * v.x, u.x * v.x + u.y * v.y) * 180 / Math.PI; }); };
  check("a route with two bends that turn opposite ways", example.routes.some((r) => { const t = bendTurns(r); return t.length >= 2 && t.some((a) => a > 5) && t.some((a) => a < -5); }));
  check("a straight route with a sharp corner, at least 45°", example.routes.some((r) => r.curved === false && bendTurns(r).some((a) => Math.abs(a) >= 45)), example.routes.filter((r) => r.curved === false).map((r) => bendTurns(r).map((a) => a.toFixed(0)).join("/")).join(", "));
  const pairIs = (r, x, y) => (r.a === x && r.b === y) || (r.a === y && r.b === x);
  // Locomotives go on ordinary routes: no official map asks for one on a boat.
  const locos = (r) => (r.locomotiveSlots || []).length;
  const centralLakeside = example.routes.find((r) => pairIs(r, "example-central", "example-lakeside"));
  check("Central–Lakeside is an ordinary train route with two locomotives", centralLakeside && shapeOf(centralLakeside) === "plain" && locos(centralLakeside) === 2, centralLakeside ? `${shapeOf(centralLakeside)}, ${locos(centralLakeside)}` : "missing");
  check("no boat route asks for a locomotive", example.routes.filter((r) => shapeOf(r) === "oval").every((r) => locos(r) === 0));
  check("two other ordinary routes have one locomotive each", example.routes.filter((r) => r !== centralLakeside && shapeOf(r) === "plain" && locos(r) === 1).length >= 2);
  // The locomotive drawn in a space is big enough to read: most of the space's length, inside its height.
  const locoSize = await page.evaluate(() => {
    const icon = document.querySelector(".map-canvas .locomotive-icon");
    const slot = icon.closest(".wagon-slot").querySelector("rect:not(.wagon-slot-outline), path:not(.wagon-slot-outline)");
    const scale = icon.transform.baseVal.consolidate().matrix.a;
    const i = icon.getBBox(), b = slot.getBBox();
    return { width: i.width * scale / b.width, top: i.y * scale, bottom: (i.y + i.height) * scale, slotTop: b.y, slotBottom: b.y + b.height };
  });
  check("the locomotive fills most of its space, and stays inside it", locoSize.width >= 0.75 && locoSize.top >= locoSize.slotTop - 0.01 && locoSize.bottom <= locoSize.slotBottom + 0.01, JSON.stringify(Object.fromEntries(Object.entries(locoSize).map(([k, v]) => [k, +v.toFixed(2)]))));
  // A boat space has pointed ends, so it cannot be mistaken for a wagon: a point towards its corner
  // lies outside it, where it would lie inside an ordinary space.
  const pointed = await page.evaluate(() => {
    const map = JSON.parse(localStorage.getItem("ttr-map"));
    const groups = Array.from(document.querySelectorAll(".map-canvas .route-group"));
    const shapeOfRoute = (r) => (map.routeTypeStyles.find((t) => t.id === r.type) || {}).shape;
    const probe = (i) => { const slot = groups[i].querySelector(".wagon-slot"); const shape = slot.querySelector("path:not(.wagon-slot-outline), rect:not(.wagon-slot-outline)"); const box = shape.getBBox(); return shape.isPointInFill(new DOMPoint(box.x + box.width * 0.85, box.y + box.height * 0.2)); };
    const boat = map.routes.findIndex((r) => shapeOfRoute(r) === "oval"), plain = map.routes.findIndex((r) => shapeOfRoute(r) === "plain");
    return { boatInside: probe(boat), plainInside: probe(plain) };
  });
  check("boat spaces have pointed ends, unlike wagon spaces", pointed.boatInside === false && pointed.plainInside === true, JSON.stringify(pointed));
  // Boats sail on water: the Lake lies under every boat route, not beside it.
  const inside = (pt, poly) => { let hit = false; for (let a = 0, b = poly.length - 1; a < poly.length; b = a++) { if ((poly[a].y > pt.y) !== (poly[b].y > pt.y) && pt.x < (poly[b].x - poly[a].x) * (pt.y - poly[a].y) / (poly[b].y - poly[a].y) + poly[a].x) hit = !hit; } return hit; };
  const lake = example.background.find((shape) => shape.label === "Lake");
  const boatCover = example.routes.filter((r) => shapeOf(r) === "oval").map((r) => {
    const pts = [pos(r.a), ...(r.points || []), pos(r.b)];
    const samples = [];
    for (let i = 0; i < pts.length - 1; i++) for (let k = 1; k < 10; k++) samples.push({ x: pts[i].x + (pts[i + 1].x - pts[i].x) * k / 10, y: pts[i].y + (pts[i + 1].y - pts[i].y) * k / 10 });
    return samples.filter((pt) => inside(pt, lake.points)).length / samples.length;
  });
  check("the lake lies under every boat route", boatCover.length >= 2 && boatCover.every((share) => share >= 0.85), boatCover.map((share) => `${Math.round(share * 100)} %`).join(", "));
  const trainOnWater = example.routes.filter((r) => shapeOf(r) !== "oval").map((r) => {
    const pts = [pos(r.a), ...(r.points || []), pos(r.b)]; const samples = [];
    for (let i = 0; i < pts.length - 1; i++) for (let k = 1; k < 10; k++) samples.push({ x: pts[i].x + (pts[i + 1].x - pts[i].x) * k / 10, y: pts[i].y + (pts[i + 1].y - pts[i].y) * k / 10 });
    return { id: r.id, share: samples.filter((pt) => inside(pt, lake.points)).length / samples.length };
  }).filter((item) => item.share > 0.2);
  check("and no train route runs across it", trainOnWater.length === 0, trainOnWater.map((item) => `${item.id} ${Math.round(item.share * 100)} %`).join(", "));
  const harbour = pos("example-harbour");
  const nearEdge = (pt, poly) => Math.min(...poly.map((a, i) => { const b = poly[(i + 1) % poly.length]; const t = Math.max(0, Math.min(1, ((pt.x - a.x) * (b.x - a.x) + (pt.y - a.y) * (b.y - a.y)) / ((b.x - a.x) ** 2 + (b.y - a.y) ** 2))); return Math.hypot(pt.x - a.x - t * (b.x - a.x), pt.y - a.y - t * (b.y - a.y)); }));
  check("and reaches Harbour", inside(harbour, lake.points) || nearEdge(harbour, lake.points) <= 12, `${nearEdge(harbour, lake.points).toFixed(0)} units away`);
  check("a route type of its own, with a letter in every space", example.routes.some((r) => { const t = example.routeTypeStyles.find((x) => x.id === r.type); return t && t.glyph && !["city", "tunnel", "boat"].includes(t.id); }));
  check("at least eight wagon colours", new Set(example.routes.map((r) => r.color)).size >= 8, [...new Set(example.routes.map((r) => r.color))].join(", "));
  check("a note and all three kinds of background", example.notes.length >= 1 && ["area", "line", "label"].every((k) => example.background.some((b) => b.type === k)));
  const decks = example.ticketSets.map((set) => ({ set, tickets: example.tickets.filter((t) => (t.set || "main") === set.id) }));
  check("two ticket decks to compare", decks.length === 2 && decks.every((deck) => deck.tickets.length > 0), decks.map((d) => `${d.set.label} ${d.tickets.length}`).join(", "));
  const mainDeck = decks[0].tickets;
  check("the main deck can deal a full table", mainDeck.length >= (example.players?.max ?? 5) * (example.startingTickets ?? 3), `${mainDeck.length} for ${(example.players?.max ?? 5)} × ${example.startingTickets ?? 3}`);
  check("and so can the other deck: a full table of the two or three players it is made for is dealt from either", decks.every((deck) => deck.tickets.length >= 3 * (example.startingTickets ?? 3)) && example.players?.max === 3, decks.map((d) => `${d.set.label} ${d.tickets.length}`).join(", "));
  check("with long tickets among the rest", mainDeck.some((t) => t.long) && mainDeck.some((t) => !t.long));
  check("every stop but the junction is on a ticket", example.stops.filter((st) => !typeOf(st.type).junction).every((st) => mainDeck.some((t) => t.a === st.id || t.b === st.id)));
  await page.getByRole("button", { name: "Tickets", exact: true }).click();
  await page.waitForTimeout(500);
  const ticketsDialogText = await page.locator(".tickets-panel").textContent();
  check("and the tickets panel does not list the junction as a stop no ticket reaches", !ticketsDialogText.includes(junction.name), ticketsDialogText.slice(0, 200));
  await page.keyboard.press("Escape");
  await page.waitForTimeout(300);
  await page.getByRole("button", { name: "Map balance", exact: true }).click();
  await page.waitForTimeout(600);
  check("the balance report finds the deck fits the example map, and has no warning about its wagons: three players' wagons fit its spaces", (await page.locator(".deck-warning").count()) === 0 && (await page.locator(".space-warning").count()) === 0, await page.locator(".balance-panel").textContent().then((t) => t.slice(0, 200)));
  await page.keyboard.press("Escape");
  await page.waitForTimeout(300);

  const selectRoute = async (stroke) => {
    await page.evaluate((s) => {
      Array.from(document.querySelectorAll(".map-canvas .route-group"))
        .find((el) => el.querySelector(".route-guide").getAttribute("stroke") === s)
        .dispatchEvent(new PointerEvent("pointerdown", { bubbles: true }));
    }, stroke);
    await page.waitForTimeout(300);
  };

  sectionStart(2);
  // 2. per-route colours, not per-type
  const strokes = await page.evaluate(() => Array.from(document.querySelectorAll(".map-canvas .route-group")).map((g) => g.querySelector(".route-guide").getAttribute("stroke")));
  // Every route now carries its own wagon colour: the example map has no infrastructure type left,
  // whose line colour came from the type rather than the route.
  check("routes keep their own colours", new Set(strokes).size >= 8, `${new Set(strokes).size} distinct`);
  check("no route forced to a type colour", !strokes.includes("#23749b") && !strokes.includes("#00877c"));
  // Grey and black wagon spaces must be told apart at a glance: their rings sit inside the same dark
  // outline, so the two colours need real contrast between them, and grey still has to show on paper.
  const ringContrast = await page.evaluate(() => {
    const map = JSON.parse(localStorage.getItem("ttr-map"));
    const groups = Array.from(document.querySelectorAll(".map-canvas .route-group"));
    const ring = (colour) => { const i = map.routes.findIndex((r) => r.color === colour); return groups[i].querySelector(".wagon-slot > :nth-child(2)").getAttribute("stroke"); };
    const lum = (hex) => { const v = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((c) => c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4); return 0.2126 * v[0] + 0.7152 * v[1] + 0.0722 * v[2]; };
    const ratio = (a, b) => { const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x); return (hi + 0.05) / (lo + 0.05); };
    const grey = ring("neutral"), black = ring("black");
    return { grey, black, between: ratio(grey, black), greyOnPaper: ratio(grey, "#f7f1e5") };
  });
  check("grey and black wagon spaces are clearly different", ringContrast.between >= 4.5, `${ringContrast.grey} vs ${ringContrast.black}: ${ringContrast.between.toFixed(2)}:1`);
  check("and grey still shows on the paper", ringContrast.greyOnPaper >= 3, `${ringContrast.greyOnPaper.toFixed(2)}:1`);

  sectionStart(3);
  // 3. tools + tooltip
  const toolLabels = await page.locator(".tool-row .tool-button").evaluateAll((els) => els.map((el) => el.getAttribute("aria-label")));
  check("every tool has a button", toolLabels.every(Boolean) && toolLabels.length >= 6, toolLabels.join(", "));
  // by label rather than position, so adding a tool does not silently retarget these clicks
  const tool = (label) => page.locator(`.tool-row .tool-button[aria-label="${label}"]`);
  await tool("Draw route").hover();
  await page.waitForTimeout(250);
  check("tool tooltip matches the hovered button", (await page.locator('[data-slot="tooltip-content"]').textContent()).startsWith("Draw route"));

  sectionStart(4);
  // 4. route editing: bends, linked double route, curve, locomotive
  await selectRoute("#cf3f3f");
  check("route hint shows", await page.locator(".map-hint").count() === 1);
  // Curves are the default, so the hint says how to straighten a route, not how to curve one.
  const routeHint = await page.locator(".map-hint").textContent();
  check("the route hint does not offer a curve that is already on", !/tick Draw as a smooth curve[^.]*to bend it/i.test(routeHint) && /untick/i.test(routeHint) && /straight/i.test(routeHint), routeHint);
  check("parallel count reported", (await page.locator(".parallel-controls label").textContent()).includes("2 between"));
  await page.locator(".bend-insert-handle").first().click({ force: true });
  await page.waitForTimeout(350);
  const pts = await page.evaluate(() => JSON.parse(localStorage.getItem("ttr-map")).routes
    .filter((r) => (r.a === "example-westport" && r.b === "example-millbrook") || (r.a === "example-millbrook" && r.b === "example-westport"))
    .map((r) => (r.points || []).length));
  check("bend added to both lines of the double route", pts.length === 2 && pts[0] === 2 && pts[1] === 2, `points per line: ${pts.join("/")}`);
  await page.locator(".bend-controls input[type=checkbox]").first().check();
  await page.waitForTimeout(350);
  // The two lines of the double route, found by their stops rather than by their colours.
  const curved = await page.evaluate(() => {
    const routes = JSON.parse(localStorage.getItem("ttr-map")).routes;
    const groups = Array.from(document.querySelectorAll(".map-canvas .route-group"));
    const pair = new Set(["example-westport", "example-millbrook"]);
    return routes.map((r, i) => ({ r, guide: groups[i].querySelector(".route-guide") }))
      .filter(({ r, guide }) => pair.has(r.a) && pair.has(r.b) && guide.getAttribute("d").includes("C")).length;
  });
  check("both lines curve together", curved === 2, `${curved} curved paths`);
  const slotState = () => page.evaluate(() => Array.from(document.querySelector(".map-canvas .route-group.selected").querySelectorAll(".wagon-slot")).map((s) => s.classList.contains("locomotive") ? "L" : ".").join(""));
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.waitForTimeout(200);
  // Pick a wagon space that is not covered by a bend handle's hit area (see the known overlap).
  const slotIndex = await page.evaluate(() => {
    const slots = Array.from(document.querySelectorAll(".map-canvas .route-group.selected .wagon-slot"));
    return slots.findIndex((g) => {
      const r = g.getBoundingClientRect();
      const el = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
      return el && el.closest(".wagon-slot") === g;
    });
  });
  await page.locator(".map-canvas .route-group.selected .wagon-slot").nth(slotIndex).click({ force: true });
  await page.waitForTimeout(350);
  check("clicking a wagon space marks a locomotive", (await slotState()).includes("L"), await slotState());

  sectionStart(5);
  // 5. undo (which also clears the selection, so read the stored map rather than the selected group)
  const storedLocos = () => page.evaluate(() => JSON.parse(localStorage.getItem("ttr-map")).routes.reduce((sum, r) => sum + (r.locomotiveSlots?.length ?? 0), 0));
  const beforeUndo = await storedLocos();
  await page.evaluate(() => document.activeElement.blur());
  await page.keyboard.press("Meta+z");
  await page.waitForTimeout(400);
  const afterUndo = await storedLocos();
  check("Cmd+Z undoes the locomotive", afterUndo === beforeUndo - 1, `${beforeUndo} -> ${afterUndo}`);

  sectionStart(6);
  // 6. real-size wagons and the spacing warning
  const slotWidth = await page.evaluate(() => +document.querySelector(".map-canvas .wagon-slot rect:nth-of-type(2)").getAttribute("width"));
  check("wagon is 20 mm on the standard board", Math.abs(slotWidth * 790 / 1100 - 20) < 0.2, `${(slotWidth * 790 / 1100).toFixed(1)} mm`);
  const stopR = await page.evaluate(() => +document.querySelector(".map-canvas .stop circle:nth-of-type(2)").getAttribute("r"));
  check("stop circle is about 9 mm across", Math.abs(2 * stopR * 790 / 1100 - 9) < 0.6, `${(2 * stopR * 790 / 1100).toFixed(1)} mm`);
  const curveDefault = await page.evaluate(() => { const l = Array.from(document.querySelectorAll(".tool-options .checkbox-row")).find((x) => x.textContent.includes("smooth curve")); return l ? l.querySelector("input").checked : null; });
  check("new routes curve by default", curveDefault === null || curveDefault === true, String(curveDefault));
  const perStop = await page.locator("label[for=stop-end-gap]").count();
  check("per-stop spacing control exists", true, `${perStop} shown for the current selection`);

  // 6b. the shared hint box serves stops too
  await page.evaluate(() => { const g = Array.from(document.querySelectorAll(".map-canvas .stop")).find((x) => Array.from(x.querySelectorAll("text")).some((t) => t.textContent === "Pine Hill")); g.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true })); });
  await page.waitForTimeout(400);
  check("stops get their own hint box", (await page.locator(".map-hint strong").textContent()) === "Editing this stop", await page.locator(".map-hint strong").textContent());
  await page.getByRole("button", { name: "Map balance", exact: true }).click();
  await page.waitForTimeout(500);
  const roomRows = await page.evaluate(() => {
    const h = Array.from(document.querySelectorAll(".analysis-section h3")).find((x) => x.textContent === "Room per wagon");
    return h ? h.parentElement.querySelectorAll("tbody tr").length : 0;
  });
  const cardRoutes = await page.evaluate(() => JSON.parse(localStorage.getItem("ttr-map")).routes.length);
  check("room-per-wagon table lists the card routes", roomRows === cardRoutes, `${roomRows} rows for ${cardRoutes} routes`);
  const hubRows = await page.evaluate(() => document.querySelectorAll(".analysis-section table tbody tr").length);
  check("balance dialog renders its tables", hubRows > 10);
  await page.keyboard.press("Escape");
  await page.waitForTimeout(300);

  sectionStart(7);
  // 7. route suggestions open in the right column (tested in full in 33h, on a map that has some)
  await page.getByRole("button", { name: "Suggest routes" }).click();
  await page.waitForTimeout(500);
  check("route suggestions render", await page.locator(".suggestion-panel").count() === 1);
  await page.locator(".suggestion-panel").getByRole("button", { name: "Done" }).click();
  await page.waitForTimeout(300);

  sectionStart(8);
  // 8. measure tool
  await tool("Measure distance").click();
  await page.waitForTimeout(200);
  const clickStop = async (name) => {
    await page.evaluate((n) => {
      // By its drawn name, or by its hover title for a junction, whose name is not drawn.
      const s = Array.from(document.querySelectorAll(".map-canvas .stop")).find((g) => Array.from(g.querySelectorAll("text, title")).some((t) => t.textContent === n));
      s.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true }));
      // A click ends where it began. Without the release, the select tool is left holding a drag of
      // the stop, and the next real pointer movement drags it across the map.
      s.dispatchEvent(new PointerEvent("pointerup", { bubbles: true }));
    }, name);
    await page.waitForTimeout(250);
  };
  await clickStop("Westport"); await clickStop("Quarry");
  check("measure reports a distance", (await page.locator(".tool-status").textContent()).includes("wagon spaces"), (await page.locator(".tool-status").textContent()));

  sectionStart(9);
  // 9. adding a stop, changing format, export
  const stopsBefore = Number((await badges())[2].match(/\d+/)[0]);
  await tool("Add stop").click();
  await page.waitForTimeout(150);
  await page.evaluate(() => {
    const svg = document.querySelector(".map-canvas");
    const r = svg.getBoundingClientRect();
    svg.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, clientX: r.left + r.width * 0.12, clientY: r.top + r.height * 0.85 }));
  });
  await page.waitForTimeout(350);
  check("placing a stop works", (await badges())[2] === `${stopsBefore + 1} stops`, (await badges())[2]);
  // the board format lives in Settings, not in the tools panel
  check("the tools panel carries no board format control", (await page.locator("#map-format").count()) === 0);
  await page.getByRole("button", { name: "Settings" }).click();
  await page.waitForTimeout(400);
  // Settings holds the board's shape and nothing else: paper and splitting are print choices.
  const formatOptions = await page.locator('#settings-format input[type="radio"]').evaluateAll((els) => els.map((el) => el.value));
  check("the board format is a choice of radio buttons, each named by its board", (await page.getByRole("radio", { name: /Standard board 2×3/ }).count()) === 1 && (await page.getByRole("radio", { name: /Extended board 2×4/ }).count()) === 1);
  check("Settings offers the two boards it began with and the two small ones (the custom size is a button)", JSON.stringify(formatOptions) === JSON.stringify(["board-2x3", "board-2x4", "small-new-york", "small-amsterdam"]), formatOptions.join(", "));
  check("and no longer asks which board a test sheet stands in for", (await page.locator("#settings-proof").count()) === 0);
  await page.locator('#settings-format input[value="board-2x4"]').check();
  await page.waitForTimeout(500);
  check("changing board format from Settings works", (await badges())[0] === "Extended board 2×4", (await badges())[0]);
  check("the board format is labelled by its panels", /Board format \(# of panels\)/.test(await page.locator("#settings-format legend").textContent()), await page.locator("#settings-format legend").textContent());
  check("with no box of measurements under it", (await page.locator(".format-measurements").count()) === 0);
  const formatHelp = page.locator(".settings-format-help");
  check("and one short explanation, its last sentence in bold", (await formatHelp.textContent()).trim() === "The shape of the game board. You can change this whenever you like." && (await formatHelp.locator("strong").textContent()) === "You can change this whenever you like.",
    await formatHelp.textContent().catch(() => "no explanation"));
  await page.keyboard.press("Escape");
  await page.waitForTimeout(400);
  const wagonHelper = async () => (await roomSection()).text;
  check("wagons on a 2×4 are measured against its own 1,053 mm", /1,053 mm board/.test(await wagonHelper()), await wagonHelper());

  sectionStart(10);
  // 10. printing is decided per run, in a dialog behind the Print button, never in the map
  const storedMap = () => page.evaluate(() => localStorage.getItem("ttr-map"));
  const mapBeforePrinting = await storedMap();
  // A print gives the map its version number and, if asked for, a playtest box (block 39); nothing else
  // on the map may change.
  const contentOf = (json) => { const m = JSON.parse(json); delete m.mapVersion; m.notes = (m.notes || []).filter((n) => n.kind !== "playtest"); return JSON.stringify(m); };
  await page.evaluate(() => {
    window.__printCalls = 0;
    window.__printed = null;
    window.print = () => {
      window.__printCalls += 1;
      const pages = Array.from(document.querySelectorAll(".print-pages .print-page"));
      const first = pages[0];
      const svg = first && first.querySelector("svg");
      const slot = document.querySelector(".print-pages .wagon-slot rect:nth-of-type(2)");
      // Pixels per map unit from the slot's own transform: the scale of its matrix is the same
      // whichever way the sheet or the route is turned.
      const ctm = slot && slot.getScreenCTM();
      const unitPx = ctm ? Math.hypot(ctm.a, ctm.b) : 0;
      const box = first ? first.getBoundingClientRect() : null;
      void svg;
      // How far the first sheet reaches down the page, its cut marks included.
      const marks = first ? Array.from(first.querySelectorAll(".cut-mark line")).map((line) => line.getBoundingClientRect()) : [];
      const reach = box ? Math.max(box.bottom, ...marks.map((r) => r.bottom)) - Math.min(box.top, ...marks.map((r) => r.top)) : 0;
      // What the page looks like the moment print() is called: the dialog must be gone, and the page no
      // longer locked for scrolling. Safari lays out its first preview from that moment.
      const body = getComputedStyle(document.body);
      window.__printed = {
        settled: { dialog: document.querySelectorAll('[role="dialog"]').length, locked: document.body.hasAttribute("data-scroll-locked"), overflow: body.overflow, paddingRight: body.paddingRight, pointerEvents: body.pointerEvents },
        reachMm: reach / 96 * 25.4,
        pages: pages.length,
        style: Array.from(document.querySelectorAll(".print-pages style")).map((el) => el.textContent).join(" "),
        cutMarks: document.querySelectorAll(".print-pages .cut-mark").length,
        pageWidthMm: box ? box.width / 96 * 25.4 : 0,
        pageHeightMm: box ? box.height / 96 * 25.4 : 0,
        wagonMm: slot ? +slot.getAttribute("width") * unitPx / 96 * 25.4 : 0,
        // The frame round the artwork, in the sheet's millimetres: its line is centred on the rect's
        // edge, so the rect must sit half a line inside the sheet or a printer that clips at the
        // page box cuts that half off (the left edge went missing on a printed A4).
        frame: (() => { const rect = first && first.querySelector(".print-sheet-art"); if (!rect) return null; const art = rect.nextElementSibling; const stroke = parseFloat(getComputedStyle(rect).strokeWidth) || 0; return { x: +rect.getAttribute("x"), y: +rect.getAttribute("y"), width: +rect.getAttribute("width"), height: +rect.getAttribute("height"), stroke, trimmed: rect.classList.contains("trimmed"), sheetWidth: +art.getAttribute("width"), top: +art.getAttribute("y"), sheetHeight: +art.getAttribute("y") + +art.getAttribute("height") }; })(),
      };
    };
  });
  const printButton = () => page.getByRole("button", { name: "Print map" });
  const printDialog = () => page.getByRole("dialog", { name: "Print the map" });
  // What a print run holds is ticked in the dialog: the board, the tickets, the rules.
  const printPart = (name) => printDialog().getByRole("checkbox", { name, exact: true });
  const choosePrintParts = async (board, tickets, rules) => { for (const [name, want] of [["Print the board", board], ["Print the tickets", tickets], ["Print the rules", rules]]) if ((await printPart(name).isChecked()) !== want) await printPart(name).setChecked(want); };
  await printButton().click();
  await page.waitForTimeout(400);
  check("the Print button opens a dialog rather than printing", await printDialog().isVisible() && (await page.evaluate(() => window.__printCalls)) === 0);
  const headers = (await printDialog().locator(".print-table thead th").allTextContents()).map((t) => t.trim());
  check("its choices are in one table of sheets: a row for each paper and a column for each way to split", headers[0] === "Paper" && headers.includes("One sheet") && headers.includes("Per panel") && headers.some((h) => /^Full size/.test(h)) && (await printDialog().locator(".print-table tbody tr").count()) === 4, headers.join(" | "));
  check("and one box for the whole board on one big page", (await bigPageBox(printDialog()).count()) === 1);
  check("there are no separate lists for how it is split, or for the paper, or a box for Anniversary size", (await printDialog().locator('input[name="print-split"]').count()) === 0 && (await printDialog().locator('input[name="print-paper"]').count()) === 0 && (await printDialog().getByRole("checkbox", { name: "Anniversary size" }).count()) === 0);
  check("the first time, the board prints whole on one sheet of A4", (await splitIs(printDialog(), "sheet")) && (await paperIs(printDialog(), "a4")));
  // Anniversary is a column of the table, on the board that has it.
  await pickSplit(printDialog(), "full");
  await page.waitForTimeout(200);
  check("a 2×4 board has no Anniversary size to print at", !/Anniversary|Supersize/.test(await printDialog().textContent()));
  const tableCells = () => printDialog().locator(".print-table tbody tr").evaluateAll((rows) => rows.map((row) => Array.from(row.querySelectorAll("td button")).map((b) => Number(b.dataset.pages))));
  const cells2x4 = await tableCells();
  check("the comparison table has a row per paper", cells2x4.length === 4, JSON.stringify(cells2x4));
  check("and on a 2×4 no Anniversary column", cells2x4.every((row) => row.length === 3), JSON.stringify(cells2x4));
  check("which says a 2×4 is 8 sheets per panel on any paper", cells2x4.every((row) => row[1] === 8), JSON.stringify(cells2x4));
  await printDialog().getByRole("button", { name: "Cancel" }).click();
  await page.waitForTimeout(400);
  check("Cancel closes it without printing", !(await printDialog().isVisible()) && (await page.evaluate(() => window.__printCalls)) === 0);

  // What actually reaches the printer, for a choice picked from the table.
  const cell = (paper, column) => printDialog().locator(`.print-table tbody tr[data-paper="${paper}"] td:nth-of-type(${column}) button`);
  const printFrom = async (paper, column) => {
    await printButton().click();
    await page.waitForTimeout(300);
    await cell(paper, column).click();
    await page.waitForTimeout(200);
    const promised = Number(await cell(paper, column).getAttribute("data-pages"));
    await page.evaluate(() => { window.__printed = null; });
    await page.emulateMedia({ media: "print" });
    await page.evaluate(() => Array.from(document.querySelectorAll('[role="dialog"] button')).find((b) => b.textContent.trim() === "Print").click());
    await page.waitForFunction(() => window.__printed !== null, null, { timeout: 5000 });
    const printed = await page.evaluate(() => window.__printed);
    await page.emulateMedia({ media: "screen" });
    await page.waitForTimeout(300);
    return { ...printed, promised };
  };
  const panels2x4 = await printFrom("a4", 2);
  {
    const f = panels2x4.frame;
    const inside = f && f.stroke > 0 && f.x >= f.stroke / 2 - 1e-6 && f.x + f.width <= f.sheetWidth - f.stroke / 2 + 1e-6 && f.y >= f.top + f.stroke / 2 - 1e-6 && f.y + f.height <= f.sheetHeight - f.stroke / 2 + 1e-6;
    check("the frame round the printed map lies wholly inside the sheet, its line included, so no edge is clipped", Boolean(inside), JSON.stringify(f));
  }
  check("a 2×4 printed per panel is 8 pages", panels2x4.pages === 8, `${panels2x4.pages} pages`);
  check("and printing it left the map as it was, but for its version number and playtest box", contentOf(await storedMap()) === contentOf(mapBeforePrinting));

  // The same questions on the standard board, where Anniversary is a choice.
  await page.getByRole("button", { name: "Settings" }).click();
  await page.waitForTimeout(400);
  await page.locator('#settings-format input[value="board-2x3"]').check();
  await page.waitForTimeout(500);
  await page.keyboard.press("Escape");
  await page.waitForTimeout(400);
  check("wagons on a 2×3 are measured against its own 790 mm", /790 mm board/.test(await wagonHelper()), await wagonHelper());
  const mapBeforeChoices = await storedMap();
  await printButton().click();
  await page.waitForTimeout(400);
  const cells2x3 = await tableCells();
  check("the 2×3 table has an Anniversary column", cells2x3.every((row) => row.length === 4) && /Anniversary/.test(await printDialog().locator(".print-table thead").textContent()), JSON.stringify(cells2x3));
  check("it says a standard board is 9 sheets of A4 at full size", cells2x3[0][2] === 9, String(cells2x3[0][2]));
  check("12 of US Letter", cells2x3[2][2] === 12, String(cells2x3[2][2]));
  check("and 16 of A4 at Anniversary size", cells2x3[0][3] === 16, String(cells2x3[0][3]));
  await cell("letter", 3).click();
  await page.waitForTimeout(200);
  check("picking a cell sets the paper", await paperIs(printDialog(), "letter"));
  check("and the way it is split", await splitIs(printDialog(), "full"));
  check("and the picked cell is marked", (await cell("letter", 3).getAttribute("aria-pressed")) === "true");
  check("the 2×3 offers Anniversary size as a column of the table, not as a box of its own", /Anniversary/.test(await printDialog().locator(".print-table thead").textContent()) && (await printDialog().getByRole("checkbox", { name: "Anniversary size" }).count()) === 0 && !/Supersize/.test(await printDialog().textContent()));
  check("standard full size does not mark the Anniversary cell", (await cell("letter", 4).getAttribute("aria-pressed")) !== "true");
  await pickSplit(printDialog(), "sheet");
  await page.waitForTimeout(200);
  check("the table is never greyed out, even on one sheet", (await cell("letter", 4).isEnabled()) && (await printDialog().locator("fieldset:disabled").count()) === 0);
  await cell("letter", 4).click();
  await page.waitForTimeout(200);
  check("picking Anniversary prints full size, since Anniversary only exists at full size", await splitIs(printDialog(), "full"));
  check("and marks the Anniversary cell in the table", (await cell("letter", 4).getAttribute("aria-pressed")) === "true");
  check("and the notes under the table name the bigger board", /972 × 648 mm/.test(await printDialog().locator(".print-split-notes").textContent()), await printDialog().locator(".print-split-notes").textContent());
  await cell("a4", 3).click();
  await page.waitForTimeout(200);
  check("picking a standard cell takes Anniversary away", (await cell("a4", 3).getAttribute("aria-pressed")) === "true" && (await cell("letter", 4).getAttribute("aria-pressed")) !== "true");
  await cell("a3", 4).click();
  await page.waitForTimeout(200);
  check("picking an Anniversary cell marks it", (await cell("a3", 4).getAttribute("aria-pressed")) === "true");
  await cell("a3", 3).click();
  await page.waitForTimeout(200);
  check("and going back to standard keeps full size", await splitIs(printDialog(), "full") && (await cell("a3", 3).getAttribute("aria-pressed")) === "true");
  await cell("a3", 4).click();
  await pickSplit(printDialog(), "panel");
  await page.waitForTimeout(200);
  check("choosing a panel run takes Anniversary away too", (await cell("a3", 4).getAttribute("aria-pressed")) !== "true");
  await printDialog().getByRole("button", { name: "Cancel" }).click();
  await page.waitForTimeout(300);

  // Clicked the way a person clicks, on screen: the dialog then animates out while the page is still
  // locked for scrolling, and print() must wait for that to finish.
  await printButton().click();
  await page.waitForTimeout(300);
  await page.evaluate(() => { window.__printed = null; });
  await printDialog().getByRole("button", { name: "Print", exact: true }).click();
  await page.waitForFunction(() => window.__printed !== null, null, { timeout: 5000 });
  const clicked = await page.evaluate(() => window.__printed.settled);
  check("printing waits for the dialog to close and the page to unlock, when clicked on screen",
    clicked.dialog === 0 && !clicked.locked && clicked.overflow !== "hidden" && clicked.pointerEvents !== "none", JSON.stringify(clicked));
  await page.waitForTimeout(300);
  const oneSheet = await printFrom("a4", 1);
  check("print is called only once the dialog has gone and the page is unlocked",
    oneSheet.settled.dialog === 0 && !oneSheet.settled.locked && oneSheet.settled.overflow !== "hidden" && oneSheet.settled.pointerEvents !== "none", JSON.stringify(oneSheet.settled));
  check("one sheet is one page", oneSheet.pages === 1 && oneSheet.promised === 1, `${oneSheet.pages} printed, ${oneSheet.promised} promised`);
  // Every page is upright, which is what every browser prints by default: Safari ignores @page, and
  // Chrome and Firefox follow it. The landscape map is turned a quarter turn on the page instead.
  check("declared as upright A4 in millimetres", /size:\s*210mm 297mm/.test(oneSheet.style), oneSheet.style);
  const perPanel = await printFrom("a4", 2);
  check("a 2×3 per panel is 6 pages, as its cell says", perPanel.pages === 6 && perPanel.promised === 6, `${perPanel.pages} printed, ${perPanel.promised} promised`);
  const fullA4 = await printFrom("a4", 3);
  check("full size on A4 prints the 9 sheets its cell promises", fullA4.pages === 9 && fullA4.promised === 9, `${fullA4.pages} printed, ${fullA4.promised} promised`);
  check("with a wagon space the real 20 mm long", Math.abs(fullA4.wagonMm - 20) < 0.5, `${fullA4.wagonMm.toFixed(2)} mm`);
  check("and marks to trim at on every sheet", fullA4.cutMarks === 9 * 4, `${fullA4.cutMarks} marks`);
  // Safari fitted a 274 mm sheet with headers and footers on, and spilled one of 275. Keep well under.
  check("a full-size A4 sheet reaches no more than 270 mm down the page, cut marks included", fullA4.reachMm <= 270, `${fullA4.reachMm.toFixed(1)} mm`);
  // The paper's size is declared by @page. The page box itself must fit inside the paper less the
  // margins, or a browser that picks its own margins spills it onto an extra sheet or shrinks it.
  check("on an upright page box that fits A4 less its margins", fullA4.pageWidthMm <= 210 - 20 + 0.5 && fullA4.pageHeightMm <= 297 - 20 + 0.5 && fullA4.pageHeightMm > 250, `${fullA4.pageWidthMm.toFixed(1)} × ${fullA4.pageHeightMm.toFixed(1)} mm`);
  const fullLetter = await printFrom("letter", 3);
  check("on US Letter it prints 12, as its cell says", fullLetter.pages === 12 && fullLetter.promised === 12, `${fullLetter.pages} printed, ${fullLetter.promised} promised`);
  check("on an upright page box that fits Letter less its margins", fullLetter.pageWidthMm <= 215.9 - 20 + 0.5 && fullLetter.pageHeightMm <= 279.4 - 20 + 0.5, `${fullLetter.pageWidthMm.toFixed(1)} × ${fullLetter.pageHeightMm.toFixed(1)} mm`);
  const anniversary = await printFrom("a4", 4);
  check("an Anniversary board prints 16 sheets of A4", anniversary.pages === 16 && anniversary.promised === 16, `${anniversary.pages} printed, ${anniversary.promised} promised`);
  check("with wagon spaces grown to the bigger board", Math.abs(anniversary.wagonMm - 20 * 972 / 790) < 0.6, `${anniversary.wagonMm.toFixed(2)} mm`);
  const tabloidSheet = await printFrom("tabloid", 1);
  check("Tabloid is declared upright in millimetres", /size:\s*279\.4mm 431\.8mm/.test(tabloidSheet.style), tabloidSheet.style);
  check("no print choice touched the map, but for its version number and playtest box", contentOf(await storedMap()) === contentOf(mapBeforeChoices));
  check("and the map carries no print settings", !/print-?(split|paper|choice)/i.test(await storedMap()));

  await page.reload({ waitUntil: "networkidle" });
  await page.waitForTimeout(700);
  await printButton().click();
  await page.waitForTimeout(400);
  check("the last print choice is remembered in this browser", await paperIs(printDialog(), "tabloid") && await splitIs(printDialog(), "sheet"));
  await printDialog().getByRole("button", { name: "Cancel" }).click();
  await page.waitForTimeout(300);

  // A real PDF, printed the way Safari prints: its own margins, whatever @page asks for. A page box
  // the size of the paper then spills a few millimetres onto an empty sheet after every page, so
  // the same run comes out with twice the sheets. The print stub above cannot see this.
  const pdfPages = async (paper, column, landscape) => {
    await printButton().click();
    await page.waitForTimeout(300);
    await cell(paper, column).click();
    // These count the board's sheets, so the rules (the example map has some) stay out of the run.
    await choosePrintParts(true, false, false);
    const promised = Number(await cell(paper, column).getAttribute("data-pages"));
    await printDialog().getByRole("button", { name: "Cancel" }).click();
    await page.waitForTimeout(300);
    await page.emulateMedia({ media: "print" });
    const margins = await page.addStyleTag({ content: "@media print{@page{margin:8mm!important}}" });
    const pdf = await pdfOf(page, { format: "A4", landscape, printBackground: true });
    await margins.evaluate((el) => el.remove());
    await page.emulateMedia({ media: "screen" });
    await page.waitForTimeout(300);
    return { promised, pages: (pdf.toString("latin1").match(/\/Type\s*\/Page[^s]/g) || []).length };
  };
  const pdfFull = await pdfPages("a4", 3, false);
  check("full size on A4 with the browser's own margins is still 9 sheets, none blank", pdfFull.pages === pdfFull.promised, `${pdfFull.pages} sheets for ${pdfFull.promised} promised`);
  const pdfPanels = await pdfPages("a4", 2, false);
  check("and per panel it is still 6", pdfPanels.pages === pdfPanels.promised, `${pdfPanels.pages} sheets for ${pdfPanels.promised} promised`);

  // The dialog has to be readable, say what its table means, and hold still while choices change.
  await printButton().click();
  await page.waitForTimeout(400);
  check("a panel is offered by the game board's own name", /One sheet per panel of the game board/.test(await printDialog().locator(".print-split-notes").textContent()));
  const contrast = await page.evaluate(() => {
    const dialog = document.querySelector('[role="dialog"]');
    const rgba = (value) => { const m = value.match(/[\d.]+/g).map(Number); return { r: m[0], g: m[1], b: m[2], a: m.length > 3 ? m[3] : 1 }; };
    const lum = ({ r, g, b }) => { const c = [r, g, b].map((v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }); return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]; };
    const background = (el) => { for (let node = el; node; node = node.parentElement) { const bg = rgba(getComputedStyle(node).backgroundColor); if (bg.a > 0.5) return bg; } return { r: 255, g: 255, b: 255, a: 1 }; };
    const failures = [];
    let measured = 0;
    for (const el of dialog.querySelectorAll("*")) {
      const text = Array.from(el.childNodes).filter((n) => n.nodeType === 3).map((n) => n.textContent.trim()).join("");
      if (!text || !el.getClientRects().length) continue;
      const style = getComputedStyle(el);
      if (style.visibility === "hidden") continue;
      const fg = rgba(style.color), bg = background(el);
      // Text colour drawn with transparency is mixed into its background first.
      const mixed = { r: fg.r * fg.a + bg.r * (1 - fg.a), g: fg.g * fg.a + bg.g * (1 - fg.a), b: fg.b * fg.a + bg.b * (1 - fg.a) };
      const [hi, lo] = [lum(mixed), lum(bg)].sort((a, b) => b - a);
      const ratio = (hi + 0.05) / (lo + 0.05);
      const size = parseFloat(style.fontSize);
      const disabled = Boolean(el.closest("fieldset:disabled, [aria-disabled='true']"));
      const needed = size < 14 ? 7 : 4.5;
      measured += 1;
      if (!disabled && ratio < needed) failures.push(`"${text.slice(0, 30)}" ${ratio.toFixed(2)}:1 at ${size}px`);
    }
    return { measured, failures };
  });
  check("every piece of text in the print dialog has strong contrast (7:1 when small, 4.5:1 otherwise)", contrast.measured > 20 && contrast.failures.length === 0, `${contrast.measured} measured; ${contrast.failures.slice(0, 6).join("; ")}`);
  const described = await page.evaluate(() => {
    const table = document.querySelector('[role="dialog"] .print-table');
    const heading = table && document.getElementById(table.getAttribute("aria-labelledby") || "");
    const description = table && document.getElementById(table.getAttribute("aria-describedby") || "");
    return { heading: heading ? `${heading.tagName} ${heading.textContent}` : "", description: description ? description.textContent : "", cell: table ? table.querySelector("td button").textContent : "" };
  });
  check("the sheet table has a heading of its own", /^H[2-4] \S/.test(described.heading), described.heading);
  check("and a description of what its numbers are", /sheets?/i.test(described.description) && /%/.test(described.description), described.description);
  check("the dialog never asks for Landscape", !/choose Landscape|set .*Landscape/i.test(await printDialog().textContent()));
  check("which spells out what the percentage means", /100\s%[^.]*real size|real size[^.]*100\s%/i.test(described.description), described.description);
  check("every cell says sheets, not just a number", /\d+ sheets?/.test(described.cell), described.cell);
  // Measured within the dialog's own content, its scrolling counted in: the dialog may scroll to show
  // a picked cell, and that is not the table moving.
  const layout = () => page.evaluate(() => {
    const dialog = document.querySelector('[role="dialog"]');
    const table = dialog.querySelector(".print-table");
    const box = table.getBoundingClientRect(), frame = dialog.getBoundingClientRect();
    return { x: box.x - frame.x + dialog.scrollLeft, y: box.y - frame.y + dialog.scrollTop, columns: Array.from(table.querySelectorAll("thead th")).map((th) => th.getBoundingClientRect().x - frame.x + dialog.scrollLeft) };
  });
  const start = await layout();
  const moves = [];
  for (const [paper, column] of [["a4", 2], ["a3", 2], ["a4", 3], ["letter", 3], ["a4", 1], ["tabloid", 4], ["a4", 2]]) {
    await cell(paper, column).click();
    await page.waitForTimeout(150);
    const now = await layout();
    const shift = Math.max(Math.abs(now.x - start.x), Math.abs(now.y - start.y), ...now.columns.map((x, i) => Math.abs(x - start.columns[i])));
    if (shift > 0.5) moves.push(`${paper}/${column}: ${shift.toFixed(1)}px`);
  }
  check("the table holds still while choices change, 72 % to 100 % included", moves.length === 0, moves.join(", "));
  await pickSplit(printDialog(), "panel");
  const beforeRadio = await layout();
  await pickSplit(printDialog(), "full");
  await page.waitForTimeout(150);
  const afterRadio = await layout();
  check("and when full size is picked", Math.abs(afterRadio.y - beforeRadio.y) < 0.5, `${(afterRadio.y - beforeRadio.y).toFixed(1)}px`);
  await cell("a4", 4).click();
  await page.waitForTimeout(150);
  const afterTick = await layout();
  check("and when Anniversary size is picked", Math.abs(afterTick.y - beforeRadio.y) < 0.5, `${(afterTick.y - beforeRadio.y).toFixed(1)}px`);
  await printDialog().getByRole("button", { name: "Cancel" }).click();
  await page.waitForTimeout(300);
  sectionStart(11);
  // 11. persistence across reload
  await page.reload({ waitUntil: "networkidle" });
  await page.waitForTimeout(700);
  check("map survives a reload", (await badges())[2] === `${stopsBefore + 1} stops`, (await badges())[2]);

  // 11b. the board as a picture: a PNG from the Export menu, drawn like the print, without the editor's marks
  {
    const mapName = await page.evaluate(() => JSON.parse(localStorage.getItem("ttr-map")).name);
    const viewBox = await page.evaluate(() => document.querySelector(".map-canvas").getAttribute("viewBox").split(/\s+/).map(Number));
    await page.getByRole("button", { name: "Export", exact: true }).click();
    await page.waitForTimeout(250);
    check("the Export menu offers the map as an image", (await page.getByRole("menuitem", { name: /Map as image/ }).count()) === 1);
    const pngDownload = page.waitForEvent("download", { timeout: 15000 });
    await page.getByRole("menuitem", { name: /Map as image/ }).click();
    const png = await pngDownload;
    const pngFile = path.join(os.tmpdir(), `ttr-image-${Date.now()}.png`);
    await png.saveAs(pngFile);
    const bytes = fs.readFileSync(pngFile);
    const slugOf = (name) => name.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
    check("the picture is named like the map file: the map's name in lowercase, its version, the date, and .png", new RegExp(`^${slugOf(mapName)}-v\\d+-\\d{8}-\\d{6}\\.png$`).test(png.suggestedFilename()), png.suggestedFilename());
    check("and really is a PNG", bytes.subarray(0, 8).toString("hex") === "89504e470d0a1a0a");
    const pngWidth = bytes.readUInt32BE(16), pngHeight = bytes.readUInt32BE(20);
    check("it is big enough to print from, and has the board's proportions", pngWidth >= 2200 && Math.abs(pngWidth / pngHeight - viewBox[2] / viewBox[3]) < 0.01, `${pngWidth} x ${pngHeight}, board ${viewBox[2]} x ${viewBox[3]}`);
    // What is in it, read back the way a person would see it: decoded, and counted by colour.
    const pixels = await page.evaluate(async (b64) => {
      const img = new Image(); img.src = `data:image/png;base64,${b64}`; await img.decode();
      const c = document.createElement("canvas"); c.width = img.width; c.height = img.height;
      const ctx = c.getContext("2d"); ctx.drawImage(img, 0, 0);
      const d = ctx.getImageData(0, 0, c.width, c.height).data;
      const paper = [0xf7, 0xf1, 0xe5]; let inked = 0, transparent = 0; const hues = new Set();
      for (let i = 0; i < d.length; i += 4 * 7) {
        if (d[i + 3] < 250) { transparent += 1; continue; }
        if (Math.abs(d[i] - paper[0]) + Math.abs(d[i + 1] - paper[1]) + Math.abs(d[i + 2] - paper[2]) > 40) { inked += 1; hues.add(`${d[i] >> 6}${d[i + 1] >> 6}${d[i + 2] >> 6}`); }
      }
      return { inked: inked / (d.length / 28), transparent: transparent / (d.length / 28), hues: hues.size };
    }, bytes.toString("base64"));
    check("the picture has the map in it, on an opaque paper ground", pixels.inked > 0.03 && pixels.transparent === 0 && pixels.hues >= 6, JSON.stringify(pixels));
    check("and nothing is left behind on the page", (await page.locator(".image-stage").count()) === 0);
    fs.rmSync(pngFile, { force: true });
  }

  // 11c. spreadsheets: the tickets, the routes, the stops and the distances between stops as CSV,
  // from a menu of their own under Export, named after the map, readable with å, ä and ö intact.
  const readCsv = (file) => {
    const text = fs.readFileSync(file, "utf8");
    const rows = []; let row = [], cell = "", quoted = false;
    const body = text.replace(/^﻿/, "");
    for (let i = 0; i < body.length; i++) {
      const c = body[i];
      if (quoted) { if (c === '"' && body[i + 1] === '"') { cell += '"'; i++; } else if (c === '"') quoted = false; else cell += c; }
      else if (c === '"') quoted = true;
      else if (c === ",") { row.push(cell); cell = ""; }
      else if (c === "\r" && body[i + 1] === "\n") { row.push(cell); rows.push(row); row = []; cell = ""; i++; }
      else cell += c;
    }
    return { bom: text.startsWith("﻿"), header: rows[0], rows: rows.slice(1) };
  };
  const downloadFrom = async (openMenu, item) => {
    await openMenu();
    const pending = page.waitForEvent("download", { timeout: 10000 });
    await page.getByRole("menuitem", { name: item, exact: true }).click();
    const done = await pending;
    const file = path.join(os.tmpdir(), `ttr-${Date.now()}-${done.suggestedFilename()}`);
    await done.saveAs(file);
    return { name: done.suggestedFilename(), file, ...readCsv(file) };
  };
  {
    const stored = await page.evaluate(() => JSON.parse(localStorage.getItem("ttr-map")));
    const slug = stored.name.replace(/[^a-z0-9]+/gi, "-").toLowerCase();
    const openCsvMenu = async () => {
      await page.getByRole("button", { name: "Export", exact: true }).click();
      await page.waitForTimeout(250);
      await page.getByRole("menuitem", { name: "Spreadsheet (CSV)" }).click();
      await page.waitForTimeout(250);
    };
    await openCsvMenu();
    const items = await page.getByRole("menu").last().getByRole("menuitem").allTextContents();
    check("Export has a spreadsheet menu with the tickets, routes, stops and distances", ["Tickets", "Routes", "Stops", "Distances between stops"].every((name) => items.includes(name)), items.join(" | "));
    await page.keyboard.press("Escape"); await page.keyboard.press("Escape");
    await page.waitForTimeout(200);
    const tickets = await downloadFrom(openCsvMenu, "Tickets");
    check("the tickets come as a .csv named after the map", new RegExp(`^${slug}-v\\d+-tickets-`).test(tickets.name) && tickets.name.endsWith(".csv"), tickets.name);
    check("with a BOM and a header row", tickets.bom && tickets.header.includes("From") && tickets.header.includes("Points"), String(tickets.header));
    check("and a row for every ticket in every deck", tickets.rows.length === stored.tickets.length, `${tickets.rows.length} of ${stored.tickets.length}`);
    check("each named by its stops, as on the map", tickets.rows.every((r) => stored.stops.some((s) => s.name === r[tickets.header.indexOf("From")]) && stored.stops.some((s) => s.name === r[tickets.header.indexOf("To")])));
    const routes = await downloadFrom(openCsvMenu, "Routes");
    check("the routes: one row each", routes.name.endsWith(".csv") && routes.rows.length === stored.routes.length, `${routes.rows.length} of ${stored.routes.length}`);
    const stops = await downloadFrom(openCsvMenu, "Stops");
    check("the stops: one row each", stops.name.endsWith(".csv") && stops.rows.length === stored.stops.length, `${stops.rows.length} of ${stored.stops.length}`);
    const distances = await downloadFrom(openCsvMenu, "Distances between stops");
    const ends = stored.stops.filter((s) => !(stored.stopTypeStyles || []).some((t) => t.junction && t.id === s.type));
    check("the distances: a square table, a row and a column per stop a ticket can name", distances.name.endsWith(".csv") && distances.rows.length === ends.length && distances.header.length === ends.length + 1 && distances.rows.every((r) => r.length === ends.length + 1), `${distances.rows.length} rows for ${ends.length} stops`);
    // And back: the three files chosen at once from Import, over a map that has a network, so the
    // editor asks first. Stops and routes are replaced by the same ones; the tickets come as new decks.
    await page.getByRole("button", { name: "Import", exact: true }).click();
    await page.waitForTimeout(250);
    await page.getByRole("menuitem", { name: "Spreadsheet (CSV)" }).click();
    await page.waitForTimeout(250);
    const csvItems = (await page.getByRole("menu").last().getByRole("menuitem").allTextContents()).map((t) => t.trim());
    check("Import → Spreadsheet has the import first, and then, plainly marked as a download, the templates", JSON.stringify(csvItems) === JSON.stringify(["Import spreadsheets…", "Templates to fill in (.zip)"]), csvItems.join(" | "));
    await page.getByRole("menuitem", { name: "Import spreadsheets…" }).click();
    await page.waitForTimeout(300);
    const csvDialog = page.getByRole("dialog", { name: "Import spreadsheets" });
    check("it opens a dialog that says which files to choose, stops, routes and tickets, one or several", (await csvDialog.count()) === 1 && /stops/i.test(await csvDialog.textContent()) && /routes/i.test(await csvDialog.textContent()) && /tickets/i.test(await csvDialog.textContent()));
    check("with a button to choose the files and the column guide as a link, and no download in it", (await csvDialog.getByRole("button", { name: "Choose files…" }).count()) === 1 && (await csvDialog.getByRole("link", { name: /Column guide/ }).count()) === 1 && (await csvDialog.getByRole("button", { name: /Download/ }).count()) === 0);
    const guideLink = await csvDialog.getByRole("link", { name: /Column guide/ }).getAttribute("href");
    check("the column guide opens from the repository, in a new tab", guideLink === "https://github.com/bjornhagstrom/ticket-to-ride-map-editor/blob/main/docs/CSV.md" && (await csvDialog.getByRole("link", { name: /Column guide/ }).getAttribute("target")) === "_blank", String(guideLink));
    // Nothing in the dialog runs past its edge, at the usual width and at a narrow window (the buttons did).
    const fitsDialog = () => csvDialog.evaluate((el) => { const box = el.getBoundingClientRect(); return { overflow: el.scrollWidth - el.clientWidth, outside: [...el.querySelectorAll("button, a")].filter((x) => { const r = x.getBoundingClientRect(); return r.right > box.right + 0.5 || r.left < box.left - 0.5; }).map((x) => x.textContent.trim()) }; });
    const fitWide = await fitsDialog();
    check("every part of the dialog is inside it: no sideways scroll, no button past the edge", fitWide.overflow <= 1 && fitWide.outside.length === 0, JSON.stringify(fitWide));
    await page.setViewportSize({ width: 600, height: 900 });
    await page.waitForTimeout(300);
    const fitNarrow = await fitsDialog();
    check("also in a window 600 wide", fitNarrow.overflow <= 1 && fitNarrow.outside.length === 0, JSON.stringify(fitNarrow));
    await page.setViewportSize({ width: 1500, height: 1000 });
    await page.waitForTimeout(300);
    check("and the dialog says where the templates are, in the words of the menu", /Templates to fill in/.test(await csvDialog.textContent()) && /Export/.test(await csvDialog.textContent()));
    const chooser = page.waitForEvent("filechooser");
    await csvDialog.getByRole("button", { name: "Choose files…" }).click();
    await (await chooser).setFiles([stops.file, routes.file, tickets.file]);
    await page.waitForTimeout(600);
    const ask = await page.getByRole("alertdialog").textContent().catch(() => "");
    check("importing a spreadsheet over a map asks before it replaces the stops and routes", /Replace stops and routes/i.test(ask) && /new deck/i.test(ask), ask);
    await page.getByRole("button", { name: "Continue" }).click();
    await page.waitForTimeout(600);
    const after = await page.evaluate(() => JSON.parse(localStorage.getItem("ttr-map")));
    const sameStops = stored.stops.every((s) => after.stops.some((t) => t.name === s.name && Math.abs(t.x - s.x) <= .5 && Math.abs(t.y - s.y) <= .5));
    check("the map comes back from its own spreadsheets: every stop in its place, every route", after.stops.length === stored.stops.length && sameStops && after.routes.length === stored.routes.length, `${after.stops.length} stops, ${after.routes.length} routes`);
    check("and every route comes back with its bends and its curve, as it was", stored.routes.every((r) => after.routes.some((t) => t.a === r.a && t.b === r.b && t.length === r.length && JSON.stringify((t.points ?? []).map((p) => [Math.round(p.x), Math.round(p.y)])) === JSON.stringify((r.points ?? []).map((p) => [Math.round(p.x), Math.round(p.y)])) && (t.curved === false) === (r.curved === false))), `${after.routes.filter((t) => (t.points ?? []).length).length} of ${after.routes.length} routes with bends`);
    check("the tickets arrive as new decks beside the old ones, which still name stops that are there", after.ticketSets.length === stored.ticketSets.length * 2 && after.tickets.length === stored.tickets.length * 2 && after.tickets.every((t) => after.stops.some((s) => s.id === t.a) && after.stops.some((s) => s.id === t.b)), `${after.ticketSets.length} decks, ${after.tickets.length} tickets`);
    const toastText = (await page.locator("[data-sonner-toast]").allTextContents()).join(" | ");
    check("and the editor says what it read", /stops/.test(toastText) && /routes/.test(toastText) && /tickets/.test(toastText), toastText);
    check("and, since the stops came back with their own ids, asks about no ticket", (await page.getByRole("dialog", { name: "Tickets to stops that changed" }).count()) === 0);
    // The templates: one zip, from Export and from the Import menu, with the three files and the column guide in it.
    const zipDownload = async (open, item, pagePart = page) => {
      await open();
      const pending = pagePart.waitForEvent("download", { timeout: 10000 });
      await pagePart.getByRole("menuitem", { name: item.menuitem, exact: true }).click();
      const done = await pending;
      const file = path.join(os.tmpdir(), `ttr-${Date.now()}-${done.suggestedFilename()}`);
      await done.saveAs(file);
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ttr-zip-"));
      execFileSync("unzip", ["-o", "-q", file, "-d", dir]);
      return { name: done.suggestedFilename(), file, dir, entries: fs.readdirSync(dir).sort() };
    };
    const zipFromExport = await zipDownload(openCsvMenu, { menuitem: "Templates to fill in (.zip)" });
    check("Export → Spreadsheet has the templates as one zip, named for what it is", zipFromExport.name === "spreadsheet-templates.zip", zipFromExport.name);
    check("with the three templates and the column guide in it", JSON.stringify(zipFromExport.entries) === JSON.stringify(["columns.md", "routes-template.csv", "stops-template.csv", "tickets-template.csv"]), zipFromExport.entries.join(", "));
    const guideText = fs.readFileSync(path.join(zipFromExport.dir, "columns.md"), "utf8");
    check("the guide in the zip is the page of the repository: what each column means, and how ids and names go together", /Spreadsheets: what the columns mean/.test(guideText) && /## Ids and names/.test(guideText) && guideText === fs.readFileSync(path.join(__dirname, "..", "docs", "CSV.md"), "utf8"));
    check("and it does not send the reader to menus that are not there", !/Stops template|Routes template|Tickets template/.test(guideText));
    const templates = ["stops", "routes", "tickets"].map((kind) => { const file = path.join(zipFromExport.dir, `${kind}-template.csv`); return { name: `${kind}-template.csv`, file, ...readCsv(file) }; });
    check("each template is a .csv named for its kind, with a header and example rows", templates.every((t, i) => t.name === `${["stops", "routes", "tickets"][i]}-template.csv` && t.bom && t.header.length >= 3 && t.rows.length >= 2), templates.map((t) => `${t.name} ${t.rows.length}`).join(", "));
    await page.waitForTimeout(300);
    check("and the screen says that the zip was saved", /spreadsheet-templates\.zip/.test((await page.locator("[data-sonner-toast]").allTextContents()).join(" ")), (await page.locator("[data-sonner-toast]").allTextContents()).join(" | "));
    const openImportCsvMenu = async () => { await page.getByRole("button", { name: "Import", exact: true }).click(); await page.waitForTimeout(250); await page.getByRole("menuitem", { name: "Spreadsheet (CSV)" }).click(); await page.waitForTimeout(250); };
    const zipFromImport = await zipDownload(openImportCsvMenu, { menuitem: "Templates to fill in (.zip)" });
    check("the Import menu's download is the same zip as Export's: the same files, with the same contents", zipFromImport.name === "spreadsheet-templates.zip" && JSON.stringify(zipFromImport.entries) === JSON.stringify(zipFromExport.entries) && zipFromImport.entries.every((name) => fs.readFileSync(path.join(zipFromImport.dir, name), "utf8") === fs.readFileSync(path.join(zipFromExport.dir, name), "utf8")));
    await page.waitForTimeout(300);
    await page.evaluate(() => { const map = JSON.parse(localStorage.getItem("ttr-map")); localStorage.setItem("ttr-map", JSON.stringify({ ...map, stops: [], routes: [], tickets: [], ticketSets: [{ id: "main", label: "Main deck" }] })); });
    await page.reload({ waitUntil: "networkidle" });
    await page.waitForTimeout(700);
    await chooseSpreadsheets(page, templates.map((t) => t.file));
    await page.waitForTimeout(200);
    const fromTemplates = await page.evaluate(() => JSON.parse(localStorage.getItem("ttr-map")));
    const templateToast = (await page.locator("[data-sonner-toast]").allTextContents()).join(" | ");
    check("imported into an empty map, the three templates give a small working map, and nothing to warn about", fromTemplates.stops.length >= 4 && fromTemplates.routes.length >= 4 && fromTemplates.tickets.length >= 2 && !/had no position|left out|became/.test(templateToast), `${fromTemplates.stops.length} stops, ${fromTemplates.routes.length} routes | ${templateToast}`);
    // Saved from Excel on Windows as plain "CSV": semicolons and Windows-1252, not UTF-8. å, ä and ö survive.
    const excelFile = path.join(os.tmpdir(), `ttr-excel-${Date.now()}.csv`);
    fs.writeFileSync(excelFile, Buffer.from("Name;X;Y\r\nÅhus;100;100\r\nMalmö;300;300\r\nHässleholm;500;200\r\n", "latin1"));
    await chooseSpreadsheets(page, excelFile);
    if (await page.getByRole("button", { name: "Continue" }).count()) { await page.getByRole("button", { name: "Continue" }).click(); await page.waitForTimeout(500); }
    const excelNames = (await page.evaluate(() => JSON.parse(localStorage.getItem("ttr-map")))).stops.map((s) => s.name);
    check("a file Excel saved as plain CSV on Windows keeps å, ä and ö", JSON.stringify(excelNames) === JSON.stringify(["Åhus", "Malmö", "Hässleholm"]), excelNames.join(", "));
    fs.rmSync(excelFile, { force: true });
    // Leave the map as the rest of the suite expects it.
    await page.evaluate((map) => localStorage.setItem("ttr-map", JSON.stringify(map)), stored);
    await page.reload({ waitUntil: "networkidle" });
    await page.waitForTimeout(700);
  }

  // Ticket lengths against a reference: the deck's share in each of the five length bands, with the
  // official decks' share marked on each bar and, when the map has chosen rules of its own, theirs too.
  const lengthsIn = async (scope) => scope.evaluate((root) => {
    const section = Array.from(root.querySelectorAll(".analysis-section")).find((el) => el.querySelector("h3") && /^Ticket lengths$/.test(el.querySelector("h3").textContent.trim()));
    if (!section) return null;
    const rows = Array.from(section.querySelectorAll(".length-row")).map((row) => ({
      label: row.querySelector(".length-label").textContent.trim(),
      share: parseFloat(row.querySelector(".length-fill").style.width),
      count: Number(row.querySelector(".length-count").textContent.replace(/[^0-9]/g, "")),
      official: row.querySelector('.length-ref[data-ref="official"]') ? parseFloat(row.querySelector('.length-ref[data-ref="official"]').style.left) : null,
      own: row.querySelector('.length-ref[data-ref="own"]') ? parseFloat(row.querySelector('.length-ref[data-ref="own"]').style.left) : null,
    }));
    const parent = root.getBoundingClientRect();
    const spill = Array.from(section.querySelectorAll("*")).filter((el) => el.getClientRects().length && el.getBoundingClientRect().right > parent.right + 1).length;
    return { rows, verdict: (section.querySelector(".length-verdict") || { textContent: "" }).textContent, spill };
  });

  // Marked routes must be seen at a glance: a band of their own under the wagons, wider than the
  // wagons, and the rest of the routes dimmed while anything is marked. Measured on screen.
  const markInfo = (cls) => page.evaluate((cls) => {
    const groups = Array.from(document.querySelectorAll(`.map-canvas .route-group.${cls}`));
    const unmarked = Array.from(document.querySelectorAll(".map-canvas .route-group:not(.on-preview):not(.on-ticket):not(.bottleneck)"));
    const scaleOf = (el) => { const m = el.getScreenCTM(); return m ? Math.hypot(m.a, m.b) : 0; };
    const halos = groups.map((g) => g.querySelector(".route-halo"));
    const wagon = (groups[0] || document).querySelector(".wagon-slot rect");
    const wagonPx = wagon ? +wagon.getAttribute("height") * scaleOf(wagon) : 0;
    return {
      marked: groups.length,
      withHalo: halos.filter(Boolean).length,
      haloPx: halos[0] ? parseFloat(getComputedStyle(halos[0]).strokeWidth) * scaleOf(halos[0]) : 0,
      wagonPx,
      dimmed: unmarked.length > 0 && unmarked.every((g) => parseFloat(getComputedStyle(g).opacity) <= 0.5),
      undimmed: unmarked.every((g) => parseFloat(getComputedStyle(g).opacity) >= 0.99),
    };
  }, cls);
  const clearlyMarked = (info) => info.marked >= 1 && info.withHalo === info.marked && info.haloPx >= info.wagonPx + 6 && info.dimmed;

  sectionStart(12);
  // 12. destination tickets: decks, ticket-only export and import, card printing
  // Counted against what the map already holds, so a richer example map does not move the goalposts.
  const ticketsNow = () => page.evaluate(() => { const m = JSON.parse(localStorage.getItem("ttr-map")); return { main: m.tickets.filter((t) => (t.set || "main") === "main").length, decks: m.ticketSets.map((d) => `${d.label} (${m.tickets.filter((t) => (t.set || "main") === d.id).length})`) }; });
  const mainBefore = (await ticketsNow()).main;
  await tool("Add ticket").click();
  await clickStop("Westport"); await clickStop("Quarry");
  await clickStop("Pine Hill"); await clickStop("Central");
  const ticketsButton = page.getByRole("button", { name: "Tickets", exact: true });
  const mainAfter = mainBefore + 2;
  // How many tickets the deck holds sits with the other map figures above the map, not on the button.
  check("tickets are added to the current deck, and the figures above the map say how many", (await badges()).some((b) => b === `${mainAfter} tickets` || b.startsWith(`${mainAfter} tickets in `)), JSON.stringify(await badges()));
  check("the Tickets button says only Tickets", (await ticketsButton.textContent()).trim() === "Tickets", await ticketsButton.textContent());
  await ticketsButton.click();
  await page.waitForTimeout(400);

  // Tickets is a panel in the right column, like Map balance: the map stays in view and undimmed, the
  // panel scrolls and widens, and it can be opened out to read a long list.
  {
    const panel = page.locator("aside.properties .tickets-panel");
    const view = () => page.evaluate(() => {
      const box = (el) => { const r = el.getBoundingClientRect(); return { left: r.left, right: r.right, top: r.top, bottom: r.bottom, width: r.width }; };
      const aside = document.querySelector("aside.properties"), canvas = document.querySelector(".map-canvas"), wrap = document.querySelector(".map-wrap");
      return { page: document.documentElement.scrollHeight, win: innerHeight, aside: box(aside), canvas: box(canvas), wrap: box(wrap), overflow: getComputedStyle(aside).overflowY, scroll: aside.scrollHeight, client: aside.clientHeight };
    });
    check("Tickets opens in the right column, not in a dialog", (await panel.count()) === 1 && (await page.locator('[role="dialog"]').count()) === 0);
    check("and does not darken the map", (await page.locator('[data-slot="dialog-overlay"]').count()) === 0);
    const v = await view();
    check("the page does not grow with the ticket list, and the panel scrolls", v.page <= v.win + 1 && v.overflow === "auto" && v.scroll > v.client, `${v.page}/${v.win}, ${v.overflow}, ${v.scroll}/${v.client}`);
    check("the whole map is in view beside it", v.canvas.top >= 0 && v.canvas.bottom <= v.win && v.canvas.right <= v.aside.left + 1 && v.canvas.left >= v.wrap.left - 1, JSON.stringify({ canvas: v.canvas, aside: v.aside.left }));
    check("the column can be dragged wider while Tickets is open", (await page.getByRole("separator", { name: "Resize the right column" }).count()) === 1);
    const expand = panel.getByRole("button", { name: "Expand", exact: true });
    await expand.click();
    await page.waitForTimeout(250);
    const wide = await view();
    check("Expand opens the column out to read a long list", wide.aside.width >= 640 && wide.canvas.right <= wide.aside.left + 1 && wide.canvas.bottom <= wide.win, `${v.aside.width} → ${wide.aside.width}`);
    await panel.getByRole("button", { name: "Collapse", exact: true }).click();
    await page.waitForTimeout(250);
    check("and Collapse puts it back", Math.abs((await view()).aside.width - v.aside.width) <= 3);
    // Pointing at a row is enough: the ticket's path is marked before anything is clicked. Nothing is
    // picked first, so the marks that go on leaving are the hover's own.
    if (await panel.locator(".analysis-row-active").count()) { await panel.locator(".analysis-row-active").first().click(); await page.waitForTimeout(200); }
    await panel.locator(".analysis-table tbody tr").first().hover();
    await page.waitForTimeout(250);
    const hovered = await markInfo("on-ticket");
    check("pointing at a ticket marks its path, clearly", clearlyMarked(hovered), JSON.stringify(hovered));
    await page.mouse.move(700, 800);
    await page.waitForTimeout(500);
    const left = await markInfo("on-ticket");
    check("and the mark goes, and the other routes come back, when the pointer leaves", left.marked === 0 && left.undimmed, JSON.stringify(left));
    // Picking a row shows that ticket's shortest path on the map, which is in view beside the list.
    await panel.locator(".analysis-table tbody tr").first().click();
    await page.waitForTimeout(250);
    const ticketHelp = await panel.locator(".analysis-section .helper").first().textContent();
    check("the Tickets panel says pointing shows the path and a click keeps it", /point/i.test(ticketHelp) && /click/i.test(ticketHelp) && !/dialog/i.test(await panel.textContent()), ticketHelp);
    check("picking a ticket lights its path on the map beside the list", (await page.locator(".map-canvas .route-group.on-ticket").count()) >= 1);
    await panel.locator(".analysis-table tbody tr").first().click();
    // One panel at a time: Map balance takes the column, and Tickets comes back when asked.
    await page.getByRole("button", { name: "Map balance", exact: true }).click();
    await page.waitForTimeout(400);
    check("opening Map balance replaces the Tickets panel", (await page.locator(".tickets-panel").count()) === 0 && (await page.locator(".balance-panel").count()) === 1);
    await page.locator(".balance-panel").getByRole("button", { name: "Done" }).click();
    await page.waitForTimeout(250);
    await ticketsButton.click();
    await page.waitForTimeout(300);
    check("and Tickets replaces Map balance", (await page.locator(".tickets-panel").count()) === 1 && (await page.locator(".balance-panel:not(.tickets-panel)").count()) === 0);
  }

  {
    const inDeck = await page.evaluate(() => JSON.parse(localStorage.getItem("ttr-map")).tickets.filter((t) => (t.set || "main") === "main").length);
    // Tickets longer than a player can build are left out of the bars, and the section says how many.
    const left = await page.locator(".tickets-panel .length-excluded").evaluateAll((els) => els.reduce((sum, el) => sum + Number(el.dataset.skipped) + Number(el.dataset.long), 0));
    const keptInDeck = inDeck - left;
    const lengths = await lengthsIn(page.locator(".tickets-panel"));
    check("the Tickets panel shows the deck's lengths in five bands", lengths !== null && lengths.rows.length === 5, JSON.stringify(lengths && lengths.rows.map((r) => r.label)));
    check("the bands hold every ticket once, but those the section says it left out", lengths !== null && lengths.rows.reduce((sum, r) => sum + r.count, 0) === keptInDeck, `${lengths && lengths.rows.map((r) => r.count)} of ${inDeck}, ${left} left out`);
    check("and each bar is that band's share of the deck", lengths !== null && lengths.rows.every((r) => Math.abs(r.share - (r.count / keptInDeck) * 100) < 1.5), JSON.stringify(lengths && lengths.rows.map((r) => r.share)));
    check("the official decks are marked on every bar, and no rules of its own yet", lengths !== null && lengths.rows.every((r) => r.official !== null && r.own === null) && Math.abs(lengths.rows.reduce((sum, r) => sum + r.official, 0) - 100) < 2, JSON.stringify(lengths && lengths.rows.map((r) => r.official)));
    check("a sentence says where the deck is furthest from them", lengths !== null && /official/i.test(lengths.verdict) && /%/.test(lengths.verdict), lengths && lengths.verdict);
    check("and nothing spills out of the column", lengths !== null && lengths.spill === 0, String(lengths && lengths.spill));
  }

  const ticketFile = path.join(os.tmpdir(), `ttr-tickets-${Date.now()}.json`);
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: /Import\/Export decks/ }).click();
  await page.waitForTimeout(250);
  await page.getByRole("menuitem", { name: "Export this deck", exact: true }).click();
  await (await download).saveAs(ticketFile);
  const ticketFileJson = JSON.parse(fs.readFileSync(ticketFile, "utf8"));
  check("an exported file says what it is and which schema it follows", ticketFileJson.format === "ticket-to-ride-map" && ticketFileJson.version >= 2 && ticketFileJson.kind === "tickets",
    `${ticketFileJson.format} v${ticketFileJson.version} ${ticketFileJson.kind}`);
  const ticketPayload = ticketFileJson.payload;
  check("ticket-only export writes a ticket file", ticketPayload.tickets.length === mainAfter, `${ticketPayload.tickets.length} of ${mainAfter}`);
  check("exported tickets carry stop names for re-matching", ticketPayload.tickets.every((t) => t.aName && t.bName), JSON.stringify(ticketPayload.tickets[0]));
  {
    const deckCsv = await downloadFrom(async () => { await page.getByRole("button", { name: /Import\/Export decks/ }).click(); await page.waitForTimeout(250); }, "Export this deck as CSV");
    check("a deck can be exported as a spreadsheet from the Tickets panel", deckCsv.name.endsWith(".csv") && deckCsv.rows.length === mainAfter, `${deckCsv.name}: ${deckCsv.rows.length} of ${mainAfter}`);
    check("and every row is that deck's", deckCsv.rows.every((r) => r[deckCsv.header.indexOf("Deck")] === "Main deck"), [...new Set(deckCsv.rows.map((r) => r[deckCsv.header.indexOf("Deck")]))].join(", "));
  }

  await page.getByRole("button", { name: /Add a deck/ }).click();
  await page.waitForTimeout(250);
  await page.getByRole("menuitem", { name: /Duplicate this one/ }).click();
  await page.waitForTimeout(400);
  await page.locator("#ticket-set-name").fill("Variant");
  await page.waitForTimeout(400);
  await page.locator("#ticket-set").selectOption({ index: 0 });
  await page.waitForTimeout(300);
  const deckOptions = await page.locator("#ticket-set option").allTextContents();
  check("decks live side by side, the duplicate beside its original", deckOptions.length === (await ticketsNow()).decks.length && deckOptions[0] === `Main deck (${mainAfter})` && deckOptions.includes(`Variant (${mainAfter})`), deckOptions.join(" | "));

  await page.locator('input[type="file"][accept="application/json"]').setInputFiles(ticketFile);
  await page.waitForTimeout(800);
  check("importing tickets adds a deck instead of overwriting", (await page.locator("#ticket-set option").count()) === deckOptions.length + 1, (await page.locator("#ticket-set option").allTextContents()).join(" | "));
  check("imported tickets land on real stops", (await page.locator(".analysis-table tbody tr td:first-child").allTextContents()).every((r) => !r.includes("—")));
  // Two decks side by side: this deck against another, figure by figure, with the difference
  {
    const KEY = "ttr-map";
    const cmp = page.locator(".tickets-panel .deck-compare");
    const oracle = (setId) => page.evaluate(([key, id]) => { const m = JSON.parse(localStorage.getItem(key)); const first = m.ticketSets[0].id; const ts = m.tickets.filter((t) => (t.set ?? first) === id); return { tickets: ts.length, long: ts.filter((t) => t.long).length, points: ts.reduce((sum, t) => sum + t.points, 0), label: m.ticketSets.find((x) => x.id === id).label }; }, [KEY, setId]);
    const figure = async (row, col) => { const raw = await cmp.locator(`tr[data-row="${row}"] .cmp-${col}`).getAttribute("data-value"); return raw === "" || raw === null ? null : Number(raw); };
    const select = cmp.getByRole("combobox", { name: "Compare with" });
    const allIds = await page.locator("#ticket-set option").evaluateAll((os) => os.map((o) => o.value));
    const activeId = await page.locator("#ticket-set").inputValue();
    check("with several decks the panel offers to compare them", (await cmp.count()) === 1 && /Compare decks/.test(await cmp.locator("h3").textContent()) && (await select.count()) === 1);
    const others = await select.locator("option").evaluateAll((os) => os.map((o) => o.value));
    check("the other deck is chosen among the decks that are not this one, the first by default", JSON.stringify(others) === JSON.stringify(allIds.filter((id) => id !== activeId)) && (await select.inputValue()) === others[0], JSON.stringify([others, allIds, activeId]));
    const rowIds = await cmp.locator("tr[data-row]").evaluateAll((trs) => trs.map((tr) => tr.dataset.row));
    check("it compares tickets, long tickets, points, lengths, mix, length bands, uncovered stops, crowded routes, duplicates, unused routes and points off the path rule", ["tickets", "long", "points", "per-ticket", "shortest", "median", "longest", "mix-short", "mix-medium", "mix-long", "bin-0", "bin-1", "bin-2", "bin-3", "bin-4", "uncovered", "crowded", "duplicates", "unused", "off-path"].every((r) => rowIds.includes(r)), rowIds.join());
    const a = await oracle(activeId), b = await oracle(others[0]);
    check("this deck's tickets, long tickets and points are what the map holds", (await figure("tickets", "a")) === a.tickets && (await figure("long", "a")) === a.long && (await figure("points", "a")) === a.points, JSON.stringify(a));
    check("and so are the other deck's", (await figure("tickets", "b")) === b.tickets && (await figure("long", "b")) === b.long && (await figure("points", "b")) === b.points, JSON.stringify(b));
    check("the difference is the other deck against this one", (await figure("tickets", "delta")) === b.tickets - a.tickets && (await figure("points", "delta")) === b.points - a.points);
    check("the columns are headed with the decks' names", (await cmp.locator("th.cmp-a").textContent()).includes(a.label) && (await cmp.locator("th.cmp-b").textContent()).includes(b.label));
    const lengths = await lengthsIn(page.locator(".tickets-panel"));
    let binsAgree = lengths !== null;
    for (let i = 0; i < 5 && binsAgree; i += 1) binsAgree = Math.abs((await figure(`bin-${i}`, "a")) - lengths.rows[i].share) <= 1;
    check("this deck's length bands agree with the Ticket lengths section above", binsAgree, JSON.stringify(lengths && lengths.rows.map((r) => r.share)));
    const spread = /Shortest (\d+), median (\d+), longest (\d+)/.exec(await page.locator(".tickets-panel .analysis-section", { has: page.locator("h3", { hasText: "Length spread" }) }).textContent());
    check("and its shortest, median and longest agree with the Length spread section", spread !== null && (await figure("shortest", "a")) === Number(spread[1]) && (await figure("median", "a")) === Number(spread[2]) && (await figure("longest", "a")) === Number(spread[3]), spread && spread.slice(1).join());
    // another deck on the other side
    await select.selectOption(others[1]);
    await page.waitForTimeout(500);
    const b2 = await oracle(others[1]);
    check("choosing another deck puts it in the other column", (await figure("tickets", "b")) === b2.tickets && (await figure("points", "b")) === b2.points && (await cmp.locator("th.cmp-b").textContent()).includes(b2.label), JSON.stringify(b2));
    // the deck being worked on changes sides with the Deck picker
    await page.locator("#ticket-set").selectOption(others[0]);
    await page.waitForTimeout(600);
    const a3 = await oracle(others[0]);
    const others3 = await select.locator("option").evaluateAll((os) => os.map((o) => o.value));
    check("picking another deck to work on moves it to this column, and it leaves the list of others", (await figure("tickets", "a")) === a3.tickets && !others3.includes(others[0]) && others3.includes(activeId), JSON.stringify(others3));
    // an empty deck: nothing to average, nothing breaks
    await page.getByRole("button", { name: /Add a deck/ }).click();
    await page.waitForTimeout(250);
    await page.getByRole("menuitem", { name: /New, empty deck/ }).click();
    await page.waitForTimeout(500);
    check("an empty deck compares as nothing, with dashes where an average would be", (await figure("tickets", "a")) === 0 && (await figure("points", "a")) === 0 && (await figure("per-ticket", "a")) === null && (await figure("shortest", "a")) === null && (await cmp.locator('tr[data-row="per-ticket"] .cmp-a').textContent()).includes("—"));
    check("and its difference from a full one is still said", (await figure("tickets", "delta")) === (await oracle(await select.inputValue())).tickets);
    await page.getByRole("button", { name: /Delete deck/ }).click();
    await page.waitForTimeout(500);
    await page.locator("#ticket-set").selectOption(activeId);
    await page.waitForTimeout(400);
  }
  // An imported deck is stamped with the moment it arrived, so it can be told from the decks the
  // map already had.
  const importedName = await page.locator("#ticket-set-name").inputValue();
  const pad = (n) => String(n).padStart(2, "0");
  const now = new Date();
  const today = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
  check("an imported deck carries the date and time it arrived", new RegExp(`^Main deck · ${today} \\d{2}:\\d{2}$`).test(importedName), importedName);
  fs.rmSync(ticketFile, { force: true });

  // Clicked the way a person clicks, on screen: the Tickets dialog then animates out while the page is
  // still locked for scrolling, and print() must wait for that to finish, as the board's print does.
  await page.evaluate(() => {
    window.__deckSettled = null;
    window.print = () => {
      const body = getComputedStyle(document.body);
      window.__deckSettled = { dialog: document.querySelectorAll('[role="dialog"]').length, locked: document.body.hasAttribute("data-scroll-locked"), overflow: body.overflow, pointerEvents: body.pointerEvents, cards: document.querySelectorAll(".print-tickets .ticket-card").length };
    };
  });
  await page.getByRole("button", { name: "Print deck" }).click();
  await page.waitForFunction(() => window.__deckSettled !== null, null, { timeout: 5000 });
  const deckSettled = await page.evaluate(() => window.__deckSettled);
  check("printing the deck waits for the dialog to close and the page to unlock, when clicked on screen",
    deckSettled.dialog === 0 && !deckSettled.locked && deckSettled.overflow !== "hidden" && deckSettled.pointerEvents !== "none" && deckSettled.cards > 0, JSON.stringify(deckSettled));
  await page.waitForTimeout(400);
  await ticketsButton.click();
  await page.waitForTimeout(400);

  // Print media hides the dialog, so the button is clicked from script and the print tree is
  // measured inside the print() stub, while it is still mounted.
  await page.evaluate(() => {
    window.__print = null;
    window.print = () => {
      const card = document.querySelector(".print-tickets .ticket-card");
      const sheet = document.querySelector(".print-tickets .ticket-run");
      window.__print = { cards: document.querySelectorAll(".print-tickets .ticket-card").length, card: card && card.getBoundingClientRect(), text: card ? card.textContent : "", sheet: sheet && sheet.getBoundingClientRect() };
    };
  });
  // Printing is a menu item now. The menu is opened while the page is still on screen, then print
  // media is switched on: the menu is portalled onto the body, so it survives the dialog being
  // hidden, and the item can be clicked from script.
  await page.emulateMedia({ media: "print" });
  await page.evaluate(() => Array.from(document.querySelectorAll("button")).find((b) => b.textContent.includes("Print deck")).click());
  await page.waitForFunction(() => window.__print !== null, null, { timeout: 5000 });
  const printed = await page.evaluate(() => window.__print);
  check("ticket printing lays out one card per ticket", printed.cards === mainAfter, `${printed.cards} cards for ${mainAfter} tickets`);
  // No fixed sheet box any more: the browser paginates, so only the card size is ours to check.
  check("ticket cards are 62 x 45 mm, lying as the board lies, cut from a run the browser paginates", Math.abs(printed.card.width - mm(62)) < 3 && Math.abs(printed.card.height - mm(45)) < 4, `${(printed.card.width / 96 * 25.4).toFixed(0)} x ${(printed.card.height / 96 * 25.4).toFixed(0)} mm`);
  const firstTicket = await page.evaluate(() => { const m = JSON.parse(localStorage.getItem("ttr-map")); const t = m.tickets.find((x) => (x.set || "main") === "main"); const name = (id) => m.stops.find((st) => st.id === id).name; return { a: name(t.a), b: name(t.b), points: t.points }; });
  check("a card names both ends and its points", printed.text.includes(firstTicket.a) && printed.text.includes(firstTicket.b) && printed.text.includes(String(firstTicket.points)), `${printed.text} for ${JSON.stringify(firstTicket)}`);
  await page.emulateMedia({ media: "screen" });
  await page.waitForTimeout(400);
  check("the map print tree returns after printing tickets", (await page.locator(".print-tickets").count()) === 0);

  // 12b. A small map on every card, as on the real tickets: the whole network in light grey, the
  // ticket's two stops marked where they are, in black so the mark survives a black-and-white print.
  // Cards lie the way the board lies: a landscape board gives landscape cards.
  {
    const KEY = "ttr-map";
    const deckTree = async () => {
      await ticketsButton.click();
      await page.waitForTimeout(400);
      await page.evaluate(() => {
        window.__cards = null;
        window.print = () => {
          const box = (el) => { if (!el) return null; const r = el.getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height, right: r.right, bottom: r.bottom }; };
          const run = document.querySelector(".print-tickets");
          window.__cards = {
            symbols: run ? run.querySelectorAll("symbol").length : 0,
            cards: Array.from(document.querySelectorAll(".print-tickets .ticket-card")).map((card) => {
              const map = card.querySelector("svg.ticket-map");
              const ends = map ? Array.from(map.querySelectorAll(".ticket-map-end")).map((c) => ({ x: Number(c.getAttribute("cx")), y: Number(c.getAttribute("cy")), stroke: getComputedStyle(c).stroke })) : [];
              const stop = map ? map.ownerDocument.querySelector(".print-tickets symbol .ticket-map-stop") : null;
              const links = map ? Array.from(map.querySelectorAll(".ticket-map-link")).map((l) => ({ x1: Number(l.getAttribute("x1")), y1: Number(l.getAttribute("y1")), x2: Number(l.getAttribute("x2")), y2: Number(l.getAttribute("y2")), stroke: getComputedStyle(l).stroke, width: parseFloat(getComputedStyle(l).strokeWidth) })) : [];
              return {
                card: box(card), map: box(map), viewBox: map && map.getAttribute("viewBox"), uses: map ? map.querySelectorAll("use").length : 0,
                parts: ["from", "to", "points"].map((part) => box(card.querySelector(`.ticket-card-${part}`))),
                clipped: ["from", "to"].some((part) => { const p = card.querySelector(`.ticket-card-${part}`); return p && p.scrollWidth > p.clientWidth + 1; }),
                ends, links, stopFill: stop ? getComputedStyle(stop).fill : null,
              };
            }),
          };
        };
      });
      await page.emulateMedia({ media: "print" });
      await page.evaluate(() => Array.from(document.querySelectorAll("button")).find((b) => b.textContent.includes("Print deck")).click());
      await page.waitForFunction(() => window.__cards !== null, null, { timeout: 5000 });
      const result = await page.evaluate(() => window.__cards);
      await page.emulateMedia({ media: "screen" });
      await page.waitForTimeout(400);
      return result;
    };
    const stored = await page.evaluate((key) => JSON.parse(localStorage.getItem(key)), KEY);
    const board = await page.evaluate(() => document.querySelector(".map-canvas").getAttribute("viewBox").split(/\s+/).map(Number));
    const deck = stored.tickets.filter((t) => (t.set || stored.ticketSets[0].id) === stored.ticketSets[0].id);
    const tree = await deckTree();
    const lum = (css) => { const m = /(\d+),\s*(\d+),\s*(\d+)/.exec(css || ""); return m ? (0.2126 * m[1] + 0.7152 * m[2] + 0.0722 * m[3]) : NaN; };
    check("every card has a small map", tree.cards.length === deck.length && tree.cards.every((c) => c.map), `${tree.cards.filter((c) => c.map).length} of ${tree.cards.length}`);
    check("the cards lie as the board lies: landscape, 62 x 45 mm", tree.cards.every((c) => Math.abs(c.card.w - mm(62)) < 3 && Math.abs(c.card.h - mm(45)) < 3), tree.cards[0] && `${(tree.cards[0].card.w / 96 * 25.4).toFixed(0)} x ${(tree.cards[0].card.h / 96 * 25.4).toFixed(0)} mm`);
    check("the small map is the whole board, in its proportions", tree.cards.every((c) => c.viewBox === `0 0 ${board[2]} ${board[3]}` && Math.abs(c.map.w / c.map.h - board[2] / board[3]) < .03), tree.cards[0] && `${tree.cards[0].viewBox}, ${(tree.cards[0].map.w / tree.cards[0].map.h).toFixed(2)}`);
    check("the network is drawn once for the whole deck and reused on every card", tree.symbols === 1 && tree.cards.every((c) => c.uses === 1), `${tree.symbols} symbols`);
    const name = (id) => stored.stops.find((s) => s.id === id);
    check("each card marks its own two stops, where they are on the board", tree.cards.every((c, i) => { const t = deck[i], a = name(t.a), b = name(t.b); const at = (s) => c.ends.some((e) => Math.abs(e.x - s.x) < .5 && Math.abs(e.y - s.y) < .5); return c.ends.length === 2 && at(a) && at(b); }), JSON.stringify(tree.cards[0] && tree.cards[0].ends));
    // As on the real tickets, a line joins the two stops: from ring to ring, never into either.
    const onLink = (c) => { if (c.links.length !== 1 || c.ends.length !== 2) return false; const [a, b] = c.ends, l = c.links[0]; const len = Math.hypot(b.x - a.x, b.y - a.y); if (len <= 60) return Math.hypot(l.x2 - l.x1, l.y2 - l.y1) < 1; const ux = (b.x - a.x) / len, uy = (b.y - a.y) / len; const near = (x, y, px, py) => Math.hypot(x - px, y - py) < 1; return (near(l.x1, l.y1, a.x + ux * 30, a.y + uy * 30) && near(l.x2, l.y2, b.x - ux * 30, b.y - uy * 30)); };
    check("a line joins each card's two stops, from ring to ring", tree.cards.every(onLink), JSON.stringify(tree.cards[0] && { ends: tree.cards[0].ends, links: tree.cards[0].links }));
    check("and it is dark, so it reads in black and white, but thinner than the rings", tree.cards.every((c) => c.links.every((l) => lum(l.stroke) < 70 && l.width < 12)), JSON.stringify(tree.cards[0] && tree.cards[0].links));
    check("the marks are black and the other stops a light grey, so they read in black and white", tree.cards.every((c) => c.ends.every((e) => lum(e.stroke) < 40)) && lum(tree.cards[0].stopFill) > 110, `${tree.cards[0].ends.map((e) => e.stroke).join()} against ${tree.cards[0].stopFill}`);
    const inside = (c, r) => r && r.x >= c.card.x - .5 && r.right <= c.card.right + .5 && r.y >= c.card.y - .5 && r.bottom <= c.card.bottom + .5;
    check("the map, both names and the points all fit on the card", tree.cards.every((c) => inside(c, c.map) && c.parts.every((p) => inside(c, p)) && !c.clipped));
    const overlaps = (a, b) => a.x < b.right - .5 && b.x < a.right - .5 && a.y < b.bottom - .5 && b.y < a.bottom - .5;
    check("and the names and points do not sit on the map", tree.cards.every((c) => c.parts.every((p) => !overlaps(p, c.map))), JSON.stringify(tree.cards[0] && { map: tree.cards[0].map, parts: tree.cards[0].parts }));

    // Long names: the worst a designer will type still fits, on two lines if it has to.
    const first = deck[0];
    const longMap = JSON.parse(JSON.stringify(stored));
    longMap.stops.find((s) => s.id === first.a).name = "Konstantinopel-Västra Hamnen";
    longMap.stops.find((s) => s.id === first.b).name = "Sankt Petersburg Finljandskij";
    await page.evaluate(([key, map]) => localStorage.setItem(key, JSON.stringify(map)), [KEY, longMap]);
    await page.reload({ waitUntil: "networkidle" });
    await page.waitForTimeout(700);
    const long = await deckTree();
    check("a card with two long names still holds both, and its points, uncut", inside(long.cards[0], long.cards[0].parts[0]) && inside(long.cards[0], long.cards[0].parts[1]) && inside(long.cards[0], long.cards[0].parts[2]) && !long.cards[0].clipped, JSON.stringify(long.cards[0].parts));

    // Every card has its map: there is nothing to tick.
    await page.getByRole("button", { name: "Print map" }).click();
    await page.waitForTimeout(400);
    check("the print dialog has no tick box for the small map: every card has one", (await page.getByRole("checkbox", { name: /map on each ticket/i }).count()) === 0);
    await page.keyboard.press("Escape");
    await page.waitForTimeout(300);
    await page.evaluate(([key, map]) => localStorage.setItem(key, JSON.stringify(map)), [KEY, stored]);
    await page.reload({ waitUntil: "networkidle" });
    await page.waitForTimeout(700);
  }

  sectionStart(13);
  // 13. a stop lists the tickets that name it, and each one opens for editing
  await page.keyboard.press("Escape");
  await page.waitForTimeout(300);
  await tool("Select & move").click();
  await clickStop("Westport");
  await page.waitForTimeout(400);
  const stopLinks = await page.locator(".stop-ticket-link").allTextContents();
  const westportTickets = await page.evaluate(() => { const m = JSON.parse(localStorage.getItem("ttr-map")); return { all: m.tickets.filter((t) => t.a === "example-westport" || t.b === "example-westport").length, decks: new Set(m.tickets.filter((t) => t.a === "example-westport" || t.b === "example-westport").map((t) => t.set || "main")).size }; });
  check("a stop lists its tickets from every deck", stopLinks.length === westportTickets.all, `${stopLinks.length} listed, ${westportTickets.all} in the map`);
  await page.locator(".stop-ticket-link").first().click();
  await page.waitForTimeout(500);
  check("a ticket link opens that ticket for editing", await page.locator(".ticket-set-bar").isVisible() && (await page.locator(".analysis-row-active").count()) === 1, await page.locator("#ticket-set-name").inputValue());
  await page.keyboard.press("Escape");
  await page.waitForTimeout(300);

  sectionStart(14);
  // 14. the two-click tools show what they are waiting on
  const stopAt = async (name) => page.evaluate((n) => {
    const g = Array.from(document.querySelectorAll(".map-canvas .stop")).find((s) => Array.from(s.querySelectorAll("text")).some((t) => t.textContent === n));
    const r = g.querySelector(".stop-hit").getBoundingClientRect();
    return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
  }, name);
  const pointAt = async (name) => { const p = await stopAt(name); await page.mouse.move(p.x, p.y); await page.mouse.down(); await page.mouse.up(); await page.waitForTimeout(250); };
  // A click on the current tool lets it go, so enter one only when it is not already chosen.
  const useTool = async (label) => { if ((await tool(label).getAttribute("aria-pressed")) !== "true") await tool(label).click(); await page.waitForTimeout(200); };
  const pendingText = async () => page.evaluate(() => {
    const g = document.querySelector(".map-canvas .stop.pending");
    return g ? Array.from(g.querySelectorAll("text")).map((t) => t.textContent).join(" ") : null;
  });

  await useTool("Add ticket");
  await pointAt("Westport");
  check("the stop a tool is waiting on is marked on the map", String(await pendingText()).includes("Westport"), String(await pendingText()));
  check("a pending stop is not dressed as a selected one", (await page.locator(".map-canvas .stop.active").count()) === 0);
  const central = await stopAt("Central");
  await page.mouse.move(central.x - 50, central.y - 50);
  await page.waitForTimeout(250);
  check("a rubber band follows the pointer from it", (await page.locator(".map-canvas .pick-band").count()) === 1);
  const dim = await page.evaluate(() => { const el = document.querySelector(".map-canvas .background-object"); return el ? Number(getComputedStyle(el).opacity) : 1; });
  check("background objects step back while picking stops", dim < 1, String(dim));

  const quarry = await stopAt("Quarry");
  await page.mouse.move(quarry.x, quarry.y);
  await page.waitForTimeout(350);
  const previewText = (await page.locator(".pick-preview").count()) ? await page.locator(".pick-preview").textContent() : "";
  check("hovering the far end previews the ticket", /Westport/.test(previewText) && /Quarry/.test(previewText) && /point/.test(previewText), previewText);
  // The lit routes must form one unbroken path from Westport to Quarry, whatever the map looks like.
  const litPath = await page.evaluate(() => {
    const routes = JSON.parse(localStorage.getItem("ttr-map")).routes;
    const lit = Array.from(document.querySelectorAll(".map-canvas .route-group")).map((g, i) => g.classList.contains("on-preview") ? routes[i] : null).filter(Boolean);
    let at = "example-westport";
    const left = [...lit];
    while (left.length) { const i = left.findIndex((r) => r.a === at || r.b === at); if (i < 0) break; at = left[i].a === at ? left[i].b : left[i].a; left.splice(i, 1); }
    return { count: lit.length, reached: at, unused: left.length };
  });
  check("and lights the path it would use", litPath.count >= 1 && litPath.reached === "example-quarry" && litPath.unused === 0, JSON.stringify(litPath));
  await page.keyboard.press("Escape");
  await page.waitForTimeout(300);
  check("Escape drops the pick", (await pendingText()) === null && (await page.locator(".pick-band").count()) === 0);

  sectionStart(15);
  // 15. a lit ticket can be switched off again, and tools let go on a second click
  await page.getByRole("button", { name: "Tickets", exact: true }).click();
  await page.waitForTimeout(400);
  await page.locator(".analysis-row-link").first().click();
  await page.waitForTimeout(250);
  await page.keyboard.press("Escape");
  await page.waitForTimeout(400);
  check("a ticket lit in the dialog stays lit once it closes", (await page.locator(".map-canvas .route-group.on-ticket").count()) > 0);
  check("with a chip saying so", (await page.locator(".highlight-chip").count()) === 1, (await page.locator(".highlight-chip").count()) ? await page.locator(".highlight-chip").textContent() : "");
  await page.locator(".highlight-chip").getByRole("button").click();
  await page.waitForTimeout(400);
  check("and the chip switches it off", (await page.locator(".map-canvas .route-group.on-ticket").count()) === 0 && (await page.locator(".highlight-chip").count()) === 0);

  await useTool("Add ticket");
  await tool("Add ticket").click();
  await page.waitForTimeout(250);
  check("clicking the current tool lets it go, back to the pointer", (await tool("Select & move").getAttribute("aria-pressed")) === "true");

  sectionStart(16);
  // 16. the ways into Settings: a stop type in the legend opens its own section
  const legendItem = page.locator(".legend-item").nth(1);
  const wantedType = (await legendItem.textContent()).trim();
  await legendItem.click();
  await page.waitForTimeout(500);
  check("a stop type in the legend opens Settings on stop types", /stop/i.test(await page.locator(".settings-nav .active").textContent()), await page.locator(".settings-nav .active").textContent());
  check("with that type ready to edit", (await page.locator(".settings-body").textContent()).includes(wantedType), wantedType);
  await page.keyboard.press("Escape");
  await page.waitForTimeout(300);

  sectionStart(17);
  // 17. the ticket tool fills the right panel with coverage per stop
  await useTool("Add ticket");
  await page.waitForTimeout(300);
  const cells = () => page.$$eval(".coverage-table tbody tr", (trs) => trs.map((tr) => Array.from(tr.children).map((td) => td.textContent.trim())));
  check("the ticket tool fills the right panel", await page.locator(".coverage-table").isVisible());
  // A junction is never a ticket's end, so it has no row: it would sit under "not reached" for ever.
  const ticketStops = await page.evaluate(() => { const m = JSON.parse(localStorage.getItem("ttr-map")); const j = new Set(m.stopTypeStyles.filter((t) => t.junction).map((t) => t.id)); return m.stops.filter((st) => !j.has(st.type)).length; });
  check("with a row per stop a ticket can go to and a column per ticket length", (await cells()).length === ticketStops && (await cells())[0].length === 4, `${(await cells()).length} rows for ${ticketStops} stops; ${JSON.stringify((await cells())[0])}`);
  const rowOf = async (name) => (await cells()).find((row) => row[0] === name).slice(1).map(Number);
  const westportBefore = await rowOf("Westport"), centralBefore = await rowOf("Central");
  await pointAt("Westport"); await pointAt("Central");
  await page.waitForTimeout(300);
  // One new ticket: one more at each end, in the same length band at both.
  const westportAfter = await rowOf("Westport"), centralAfter = await rowOf("Central");
  const grew = (before, after) => after.map((n, i) => n - before[i]);
  const wGrew = grew(westportBefore, westportAfter), cGrew = grew(centralBefore, centralAfter);
  check("a ticket is counted at both ends, in its length band", wGrew.reduce((a, b) => a + b, 0) === 1 && JSON.stringify(wGrew) === JSON.stringify(cGrew), `Westport ${wGrew.join(" ")}, Central ${cGrew.join(" ")}`);
  const westportTotal = westportAfter.reduce((a, b) => a + b, 0);
  const names = (await cells()).map((row) => row[0]);
  check("the panel starts sorted by name", names.join() === [...names].sort().join(), names.join(" "));
  await page.locator(".coverage-table thead th").nth(1).click();
  await page.waitForTimeout(250);
  const shortCol = (await cells()).map((row) => Number(row[1]));
  check("a length column sorts on that length", shortCol[0] >= shortCol[shortCol.length - 1], shortCol.join());
  await page.getByLabel(/only stops with no tickets/i).check();
  await page.waitForTimeout(300);
  check("stops that already have tickets can be hidden", (await cells()).every((row) => row.slice(1).join("") === "000"), (await cells()).map((r) => r.join(" ")).join(" | "));
  await page.getByLabel(/only stops with no tickets/i).uncheck();
  await page.waitForTimeout(300);

  const firstCount = page.locator(".coverage-table tbody tr").filter({ hasText: "Westport" }).locator(".coverage-count").first();
  const shownCount = Number(await firstCount.textContent());
  await firstCount.click();
  await page.waitForTimeout(450);
  check("a count opens only the tickets behind it", (await page.locator(".stop-tickets-dialog .stop-ticket-row").count()) === shownCount && shownCount < westportTotal, `${await page.locator(".stop-tickets-dialog .stop-ticket-row").count()} rows for a count of ${shownCount}`);
  await page.keyboard.press("Escape");
  await page.waitForTimeout(350);
  await page.locator(".coverage-table tbody tr").filter({ hasText: "Westport" }).locator(".coverage-stop").click();
  await page.waitForTimeout(450);
  check("a stop name opens all of them", (await page.locator(".stop-tickets-dialog .stop-ticket-row").count()) === westportTotal, `${await page.locator(".stop-tickets-dialog .stop-ticket-row").count()} of ${westportTotal}`);
  await page.locator(".stop-tickets-dialog .stop-ticket-row").first().click();
  await page.waitForTimeout(500);
  check("and leads through to editing that ticket", await page.locator(".ticket-set-bar").isVisible() && (await page.locator(".analysis-row-active").count()) === 1);
  await page.keyboard.press("Escape");
  await page.waitForTimeout(300);

  sectionStart(18);
  // 18. the stop panel keeps each deck's tickets apart
  await useTool("Select & move");
  await clickStop("Westport");
  await page.waitForTimeout(400);
  const deckNames = await page.locator(".stop-ticket-deck-name").allTextContents();
  const westportDecks = await page.evaluate(() => { const m = JSON.parse(localStorage.getItem("ttr-map")); return new Set(m.tickets.filter((t) => t.a === "example-westport" || t.b === "example-westport").map((t) => t.set || "main")).size; });
  check("a stop's tickets are listed deck by deck", deckNames.length === westportDecks, `${deckNames.join(" | ")} for ${westportDecks} decks`);
  check("and every deck group holds only its own", (await page.locator(".stop-ticket-deck").first().locator(".stop-ticket-link").count()) >= 1);

  sectionStart(19);
  // 19. the game setup settings: wagons per player and tickets dealt at the start
  await page.getByRole("button", { name: "Settings" }).click();
  await page.waitForTimeout(500);
  check("Settings carries the game setup", await page.locator("#settings-wagons").isVisible() && await page.locator("#settings-starting-tickets").isVisible());
  // The example map is for two or three players: so below, a 4 that is stored must be read back from the
  // map, or Settings could be showing the default.
  check("including how many players the map is for", await page.locator("#settings-players-min").isVisible() && (await page.locator("#settings-players-min").inputValue()) === "2" && (await page.locator("#settings-players-max").inputValue()) === "3", `${await page.locator("#settings-players-min").inputValue()}–${await page.locator("#settings-players-max").inputValue()}`);
  await page.locator("#settings-players-max").fill("4");
  await page.locator("#settings-players-max").blur();
  await page.waitForTimeout(400);
  const newTable = await page.evaluate(() => JSON.parse(localStorage.getItem("ttr-map")).players);
  check("a different table is stored with the map", newTable.max === 4 && newTable.min <= 4, `${newTable.min}–${newTable.max}`);
  await page.keyboard.press("Escape");
  await page.waitForTimeout(300);
  await page.getByRole("button", { name: "Settings" }).click();
  await page.waitForTimeout(400);
  check("and Settings shows it again when reopened, not the default range", (await page.locator("#settings-players-max").inputValue()) === "4", await page.locator("#settings-players-max").inputValue());
  await page.keyboard.press("Escape");
  await page.waitForTimeout(300);
  await page.getByRole("button", { name: "Map balance", exact: true }).click();
  await page.waitForTimeout(500);
  check("the deck is judged against that table, not a fixed five", /table of four/.test(await page.locator(".setup-balance").textContent()), (await page.locator(".setup-balance").textContent()).slice(0, 300));
  await page.keyboard.press("Escape");
  await page.waitForTimeout(300);
  await page.getByRole("button", { name: "Settings" }).click();
  await page.waitForTimeout(400);
  await page.locator("#settings-players-max").fill("5");
  await page.locator("#settings-players-max").blur();
  await page.waitForTimeout(400);
  check("showing the map's own setup", (await page.locator("#settings-wagons").inputValue()) === String(await page.evaluate(() => JSON.parse(localStorage.getItem("ttr-map")).wagonsPerPlayer)) && (await page.locator("#settings-starting-tickets").inputValue()) === "3", `${await page.locator("#settings-wagons").inputValue()}/${await page.locator("#settings-starting-tickets").inputValue()}`);
  await page.locator("#settings-wagons").fill("40");
  await page.locator("#settings-wagons").blur();
  await page.waitForTimeout(400);
  check("the setup is stored with the map", await page.evaluate(() => JSON.parse(localStorage.getItem("ttr-map")).wagonsPerPlayer) === 40);
  await page.locator("#settings-wagons").fill("0");
  await page.locator("#settings-wagons").blur();
  await page.waitForTimeout(400);
  check("a player cannot be given zero wagons", await page.evaluate(() => JSON.parse(localStorage.getItem("ttr-map")).wagonsPerPlayer) >= 1);
  await page.locator("#settings-kept-tickets").fill("9");
  await page.locator("#settings-kept-tickets").blur();
  await page.waitForTimeout(400);
  const setupStored = await page.evaluate(() => JSON.parse(localStorage.getItem("ttr-map")));
  check("nobody must keep more tickets than they are dealt", setupStored.keptTickets <= setupStored.startingTickets, `${setupStored.keptTickets} of ${setupStored.startingTickets}`);
  await page.keyboard.press("Escape");
  await page.waitForTimeout(300);

  sectionStart(20);
  // 20. the balance report reads the setup against the map
  // Give each player more wagons than two players could ever place, so the report has to object.
  await page.getByRole("button", { name: "Settings" }).click();
  await page.waitForTimeout(400);
  const spaces = await page.evaluate(() => JSON.parse(localStorage.getItem("ttr-map")).routes.reduce((sum, r) => sum + r.length, 0));
  await page.locator("#settings-wagons").fill(String(Math.ceil(spaces / 1.5)));
  await page.locator("#settings-wagons").blur();
  await page.waitForTimeout(400);
  await page.keyboard.press("Escape");
  await page.waitForTimeout(300);
  await page.getByRole("button", { name: "Map balance", exact: true }).click();
  await page.waitForTimeout(600);
  const setupText = await page.locator(".setup-balance").textContent();
  check("the balance report weighs the setup against the map: the wagons a full table holds, as a share of the spaces, beside the official maps' 57–76 %", /wagon spaces/.test(setupText) && /wagons/.test(setupText) && /% of those spaces|% of the spaces/.test(setupText) && /57–76 %/.test(setupText), setupText.slice(0, 260));
  check("and warns when the map is too small for the wagon count", (await page.locator(".setup-balance .space-warning").count()) === 1, setupText.slice(0, 260));
  check("the deck is measured against what a full table is dealt", /a table of five is dealt/.test(setupText));
  await page.keyboard.press("Escape");
  await page.waitForTimeout(300);

  sectionStart(21);
  // 21. suggesting a whole deck for the map that is open
  await page.getByRole("button", { name: "Tickets", exact: true }).click();
  await page.waitForTimeout(400);
  const decksBefore = await page.locator("#ticket-set option").count();
  // Backing out of Suggest a deck leaves the deck panel where it was, not an empty column.
  {
    const deckBefore = await page.locator("#ticket-set").inputValue();
    await page.getByRole("button", { name: /Add a deck/ }).click();
    await page.waitForTimeout(250);
    const deckMenu = await page.getByRole("menu").last().getByRole("menuitem").allTextContents();
    check("the deck menu offers to build a full deck of tickets, under that name and no other", deckMenu.some((t) => /^Build a full deck of tickets…$/.test(t.trim())) && !deckMenu.some((t) => /suggest/i.test(t)), deckMenu.join(" | "));
    await page.getByRole("menuitem", { name: /Build a full deck of tickets/ }).click();
    await page.waitForSelector('[role="dialog"]', { timeout: 20000 });
    check("and the dialog is called the same", (await page.locator('[role="dialog"] h2').first().textContent()).trim() === "Build a full deck of tickets");
    const deckIntro = await page.locator('[role="dialog"] [data-slot="dialog-description"]').first().textContent();
    check("it says the deck can be saved as a new one or replace the current one, and promises no date stamp", /new deck/i.test(deckIntro) && /replace/i.test(deckIntro) && !/stamped|today/i.test(deckIntro), deckIntro);
    await page.waitForTimeout(300);
    await page.keyboard.press("Escape");
    await page.waitForTimeout(500);
    check("backing out of Suggest a deck closes the dialog", (await page.locator('[role="dialog"]').count()) === 0);
    check("and leaves the Tickets panel open on the same deck", (await page.locator(".tickets-panel").count()) === 1 && (await page.locator("#ticket-set").inputValue()) === deckBefore && (await page.locator("#ticket-set option").count()) === decksBefore, `${deckBefore}`);
    check("with its list, not an empty column", (await page.locator(".tickets-panel .analysis-table tbody tr").count()) > 0);
  }
  const suggestStarted = Date.now();
  await page.getByRole("button", { name: /Add a deck/ }).click();
  await page.waitForTimeout(250);
  await page.getByRole("menuitem", { name: /Build a full deck of tickets/ }).click();
  await page.waitForSelector(".suggest-table tbody tr", { timeout: 20000 });
  check("the suggest dialog opens at once", Date.now() - suggestStarted < 1500, `${Date.now() - suggestStarted} ms`);
  // The deck is worked out off the main thread, so the column fills a moment later.
  await page.waitForFunction(() => {
    const row = [...document.querySelectorAll(".suggest-table tbody tr")].find((tr) => tr.children[0].textContent.trim() === "Score");
    return row && row.children[2].textContent.trim() !== "—";
  }, null, { timeout: 30000 });
  const suggestRows = await page.$$eval(".suggest-table tbody tr", (trs) => trs.map((tr) => Array.from(tr.children).map((td) => td.textContent.trim())));
  const suggestedScore = Number(suggestRows.find((row) => row[0] === "Score")[2]);
  check("it scores the suggestion against the official range", suggestedScore < 5, suggestRows.find((row) => row[0] === "Score").join(" | "));
  // Shuffling repeatedly must not move the button under the pointer, nor the number being watched.
  await page.waitForTimeout(700);
  const steady = async () => page.evaluate(() => {
    const b = [...document.querySelectorAll("button")].find((x) => x.textContent.trim() === "Shuffle").getBoundingClientRect();
    const row = [...document.querySelectorAll(".suggest-table tbody tr")].find((tr) => tr.children[0].textContent.trim() === "Score").getBoundingClientRect();
    return { shuffle: Math.round(b.y), score: Math.round(row.y) };
  });
  const before = await steady();
  for (let i = 0; i < 3; i++) {
    await page.getByRole("button", { name: "Shuffle" }).click();
    await page.waitForTimeout(150);
    await page.waitForFunction(() => {
      const row = [...document.querySelectorAll(".suggest-table tbody tr")].find((tr) => tr.children[0].textContent.trim() === "Score");
      return row && row.children[2].textContent.trim() !== "—";
    }, null, { timeout: 30000 });
  }
  const after = await steady();
  check("shuffling moves neither the button nor the score row", before.shuffle === after.shuffle && before.score === after.score,
    `${before.shuffle}/${before.score} then ${after.shuffle}/${after.score}`);
  check("the dialog offers no Cancel: closing it discards the suggestion", (await page.locator(".suggest-dialog").getByRole("button", { name: "Cancel" }).count()) === 0);
  check("Shuffle, replace and save-as-new are offered", await page.locator(".suggest-dialog").getByRole("button", { name: "Shuffle" }).isVisible() && await page.locator(".suggest-dialog").getByRole("button", { name: /^Replace/ }).isVisible() && await page.locator(".suggest-dialog").getByRole("button", { name: /Save as a new deck/ }).isVisible());
  check("and shows the official range beside each measure", suggestRows.some((row) => /official/.test(row[3])), suggestRows[2].join(" | "));
  // A suggestion goes either into a deck you name yourself or over the one you are in.
  check("a new deck cannot be saved without a name", await page.getByRole("button", { name: /Save as a new deck/ }).isDisabled());
  await page.locator("#suggest-name").fill("Trial deck");
  await page.waitForTimeout(300);
  check("and can once it has one", !(await page.getByRole("button", { name: /Save as a new deck/ }).isDisabled()));
  check("replacing names the deck it would overwrite", /Replace/.test(await page.getByRole("button", { name: /^Replace/ }).textContent()), await page.getByRole("button", { name: /^Replace/ }).textContent());
  await page.getByRole("button", { name: /Save as a new deck/ }).click();
  await page.waitForTimeout(1000);
  const afterSuggest = await page.locator("#ticket-set option").allTextContents();
  check("applying leaves the old decks alone and adds the one you named", afterSuggest.length === decksBefore + 1 && afterSuggest.some((name) => name.startsWith("Trial deck")), afterSuggest.join(" | "));
  check("and the suggested deck is the one being worked on", (await page.locator("#ticket-set-name").inputValue()) === "Trial deck", await page.locator("#ticket-set-name").inputValue());
  const suggestedCount = await page.locator(".analysis-table tbody tr").count();
  check("the suggestion arrives as ordinary, editable tickets", suggestedCount > 0 && (await page.locator(".analysis-table tbody tr .ticket-points").count()) === suggestedCount, String(suggestedCount));
  await page.keyboard.press("Escape");
  await page.waitForTimeout(300);

  sectionStart(22);
  // 22. the ticket list sorts by any of its headings
  await page.getByRole("button", { name: "Tickets", exact: true }).click();
  await page.waitForTimeout(500);
  // Pick a deck that has tickets in it.
  const withTickets = (await page.locator("#ticket-set option").allTextContents()).findIndex((label) => !/\(0\)$/.test(label));
  await page.locator("#ticket-set").selectOption({ index: Math.max(0, withTickets) });
  await page.waitForTimeout(400);
  const ticketCells = () => page.$$eval(".tickets-panel .analysis-table tbody tr", (trs) => trs.map((tr) => Array.from(tr.children).map((td) => {
    const input = td.querySelector("input[type=number]");
    return input ? input.value : td.textContent.trim();
  })));
  const ticketHead = (label) => page.locator(".tickets-panel .analysis-table thead th").filter({ hasText: label }).first();
  const inOrder = (values, descending) => values.every((v, i) => i === 0 || (descending ? v <= values[i - 1] : v >= values[i - 1]));
  await ticketHead("Spaces").click();
  await page.waitForTimeout(300);
  const bySpaces = (await ticketCells()).map((cells) => Number(cells[1]));
  check("the ticket list sorts by a heading", bySpaces.length > 1 && inOrder(bySpaces, false), `${bySpaces.length} rows: ${bySpaces.slice(0, 6).join(",")}`);
  check("and says which heading it went by", (await ticketHead("Spaces").getAttribute("class")).includes("sorted"));
  await ticketHead("Spaces").click();
  await page.waitForTimeout(300);
  check("clicking it again turns the order around", inOrder((await ticketCells()).map((cells) => Number(cells[1])), true), (await ticketCells()).map((cells) => cells[1]).slice(0, 6).join(","));
  const editable = page.locator(".tickets-panel .analysis-table tbody tr").first().locator(".ticket-points");
  await editable.fill("9");
  await editable.blur();
  await page.waitForTimeout(400);
  check("a ticket can still be edited while the list is sorted", (await ticketCells()).some((cells) => cells[2] === "9"));
  await page.keyboard.press("Escape");
  await page.waitForTimeout(300);

  sectionStart(23);
  // 23. the + that adds a bend leaves its grab handle on the side the click was on
  await useTool("Select & move");
  await page.evaluate(() => {
    const group = Array.from(document.querySelectorAll(".map-canvas .route-group"))
      .find((g) => !g.querySelector(".route-guide").getAttribute("d").includes("C"));
    (group || document.querySelector(".map-canvas .route-group")).dispatchEvent(new PointerEvent("pointerdown", { bubbles: true }));
  });
  await page.waitForTimeout(400);
  const middleOf = (selector) => page.evaluate((s) => {
    const el = document.querySelector(s);
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
  }, selector);
  const plusHandle = await middleOf(".map-canvas .bend-insert-handle");
  if (plusHandle) {
    await page.mouse.click(plusHandle.x, plusHandle.y);
    await page.waitForTimeout(500);
    const grabHandle = await middleOf(".map-canvas .waypoint-handle .waypoint-hit");
    const travel = grabHandle ? Math.hypot(grabHandle.x - plusHandle.x, grabHandle.y - plusHandle.y) : Infinity;
    // It used to appear across the line, about twice the handle offset away.
    check("a new bend's handle appears where the + was, not across the route", travel < 30, `${travel.toFixed(0)} px away`);
    await page.keyboard.press("Meta+z");
    await page.waitForTimeout(400);
  }

  sectionStart(24);
  // 24. a warning about how the network holds together says which stops or routes it means
  const lowCard = page.locator(".crossing-card.shape-card.has-warning");
  if (await lowCard.count()) {
    const lowText = (await lowCard.textContent()).replace(/\s+/g, " ");
    const named = ((await lowCard.locator("p").first().textContent()) || "").trim();
    check("the network card names what it means", named.length > 2, lowText);
  }

  sectionStart(25);
  // 25. the balancing view says where the tickets crowd
  await page.getByRole("button", { name: "Map balance", exact: true }).click();
  await page.waitForTimeout(700);
  check("the balancing view has a bottleneck section", await page.locator(".bottlenecks").isVisible());
  const tableChoice = page.locator("#bottleneck-players");
  check("the table it reads at comes from the map", await tableChoice.isVisible() && (await tableChoice.inputValue()) === "5", await tableChoice.inputValue());
  const crowded = () => page.$$eval(".bottleneck-row", (els) => els.map((el) => el.textContent.replace(/\s+/g, " ").trim()));
  const atLargest = await crowded();
  if (atLargest.length) {
    check("each crowded route names its stops, lanes and tickets", /lane/.test(atLargest[0]) && /ticket/.test(atLargest[0]), atLargest[0]);
    await tableChoice.selectOption("2");
    await page.waitForTimeout(600);
    const atSmallest = await crowded();
    check("a smaller table counts a double route as one lane", atSmallest.some((row) => /1 of \d+ lanes/.test(row)) || atSmallest.every((row) => /1 of 1 lane/.test(row)), atSmallest[0] || "none");
    await page.locator(".bottleneck-row").first().click();
    await page.waitForTimeout(500);
    check("picking one marks it on the map", (await page.locator(".map-canvas .route-group.bottleneck").count()) > 0);
  }
  await page.keyboard.press("Escape");
  await page.waitForTimeout(300);

  sectionStart(26);
  // 26. a background image reaches every edge and can cover the board
  // On a clean board: the image is drawn underneath everything, so on a busy map a click at its
  // middle lands on a route instead of on the image.
  await startOver();
  await page.waitForTimeout(500);
  await useTool("Select & move");   // the image only answers the pointer in the select tool
  const probe = path.join(os.tmpdir(), `ttr-probe-${Date.now()}.png`);
  fs.writeFileSync(probe, Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAIAAAD91JpzAAAAFElEQVR4nGP8z4AATAxQxhBmAwCM4QEBnPvKcQAAAABJRU5ErkJggg==", "base64"));
  await page.locator('input[type="file"][accept^="image"]').setInputFiles(probe);
  await page.waitForTimeout(900);
  await page.evaluate(() => document.querySelector(".map-canvas").scrollIntoView({ block: "center" }));
  await page.waitForTimeout(300);
  const canvasBox = await page.evaluate(() => {
    const svg = document.querySelector(".map-canvas");
    const [, , w, h] = svg.getAttribute("viewBox").split(" ").map(Number);
    const r = svg.getBoundingClientRect();
    return { w, h, left: r.left, top: r.top, width: r.width, height: r.height };
  });
  const onScreen = (x, y) => ({ x: canvasBox.left + x / canvasBox.w * canvasBox.width, y: canvasBox.top + y / canvasBox.h * canvasBox.height });
  const storedImage = () => page.evaluate(() => JSON.parse(localStorage.getItem("ttr-map")).backgroundImage);
  let bg = await storedImage();
  check("a background image can be imported", Boolean(bg), `canvas ${JSON.stringify(canvasBox)}`);
  // The probe is two units across, so select it by the element rather than by hitting it, and give
  // it a real size before dragging it about.
  await page.locator(".map-canvas .background-image").click({ force: true });
  await page.waitForTimeout(300);
  bg = await storedImage();
  const dragTo = async (from, to) => { await page.mouse.move(from.x, from.y); await page.mouse.down(); await page.mouse.move(to.x, to.y, { steps: 10 }); await page.mouse.up(); await page.waitForTimeout(400); };
  const scaleTarget = { x: canvasBox.w * .85, y: canvasBox.h * .85 };
  await dragTo(onScreen(bg.x + bg.width, bg.y + bg.height), onScreen(scaleTarget.x, scaleTarget.y));
  const grown = await storedImage();
  check("it can be scaled from its corner handle", Math.abs(grown.x + grown.width - scaleTarget.x) < 6 && Math.abs(grown.y + grown.height - scaleTarget.y) < 6, `corner at ${(grown.x + grown.width).toFixed(0)},${(grown.y + grown.height).toFixed(0)} for ${scaleTarget.x.toFixed(0)},${scaleTarget.y.toFixed(0)}`);
  bg = grown;

  const farCorner = onScreen(canvasBox.w, canvasBox.h);
  await dragTo(onScreen(bg.x + bg.width / 2, bg.y + bg.height / 2), { x: farCorner.x + 200, y: farCorner.y + 200 });
  bg = await storedImage();
  check("it can be dragged to the far corner, held by its middle", bg.x + bg.width >= canvasBox.w && bg.y + bg.height >= canvasBox.h, `right edge ${(bg.x + bg.width).toFixed(0)} of ${canvasBox.w}, bottom ${(bg.y + bg.height).toFixed(0)} of ${canvasBox.h}`);
  check("and always keeps a hold on the board", bg.x < canvasBox.w && bg.y < canvasBox.h, `x ${bg.x.toFixed(0)}, y ${bg.y.toFixed(0)}`);

  await dragTo(onScreen(bg.x + 6, bg.y + 6), { x: onScreen(0, 0).x - 200, y: onScreen(0, 0).y - 200 });
  bg = await storedImage();
  check("and to the near corner the same way", bg.x <= 0 && bg.y <= 0 && bg.x + bg.width > 0, `x ${bg.x.toFixed(0)}, y ${bg.y.toFixed(0)}`);
  fs.rmSync(probe, { force: true });

  sectionStart(27);
  // 27. the map's own short/medium/long mix, and following an official map
  await page.getByRole("button", { name: "Settings" }).click();
  await page.waitForTimeout(500);
  // Ticket lengths now sit on the Deck rules page, with the rules the suggester follows.
  await page.locator(".settings-nav-item", { hasText: /deck rules/i }).click();
  await page.waitForTimeout(400);
  const mixShares = async () => [await page.locator("#mix-short").inputValue(), await page.locator("#mix-medium").inputValue(), await page.locator("#mix-long").inputValue()].join("/");
  check("a map carries its own ticket length mix", await page.locator("#mix-medium-edge").isVisible() && await page.locator("#mix-short").isVisible());
  check("starting on the official USA mix", (await mixShares()) === "30/47/23", await mixShares());
  // The map has been cleared by this point, so there is no longest journey to count against: the
  // boundaries are in wagon spaces and say so rather than showing a meaningless number.
  const bandHelp = await page.locator(".ticket-mix .helper").first().textContent();
  check("the boundaries are counted in wagon spaces", /wagon spaces|Draw some routes first/.test(bandHelp), bandHelp.slice(0, 80));
  check("and are held back until there is a map to count against", await page.locator("#mix-medium-edge").isDisabled());
  const mixPresets = page.locator(".mix-preset");
  check("official maps can be followed with one click", (await mixPresets.count()) >= 3, String(await mixPresets.count()));
  await mixPresets.filter({ hasText: "Ticket to Ride: Europe" }).first().click();
  await page.waitForTimeout(400);
  check("clicking one takes that map's mix", (await mixShares()) === "76/11/13", await mixShares());
  check("and stores it with the map", await page.evaluate(() => JSON.stringify(JSON.parse(localStorage.getItem("ttr-map")).ticketMix)) === '{"short":76,"medium":11,"long":13}');
  await page.locator("#mix-short").fill("50");
  await page.locator("#mix-short").blur();
  await page.waitForTimeout(400);
  check("a mix that does not add up is flagged", (await page.locator(".ticket-mix .helper-warning").count()) === 1);
  await mixPresets.first().click();
  await page.waitForTimeout(400);
  check("and a preset puts it right again", (await page.locator(".ticket-mix .helper-warning").count()) === 0, await mixShares());
  await page.keyboard.press("Escape");
  await page.waitForTimeout(300);

  sectionStart(28);
  // 28. a deck name long enough to break the button it is shown in
  const longName = "A deck with a really very long name that nobody would sensibly type";
  await page.getByRole("button", { name: "Tickets", exact: true }).click();
  await page.waitForTimeout(400);
  await page.getByRole("button", { name: /Add a deck/ }).click();
  await page.waitForTimeout(250);
  await page.getByRole("menuitem", { name: /New, empty deck/ }).click();
  await page.waitForTimeout(400);
  await page.locator("#ticket-set-name").fill(longName);
  await page.waitForTimeout(400);
  await page.keyboard.press("Escape");
  await page.waitForTimeout(400);
  const toolsWidth = (await page.locator(".tools-panel").boundingBox()).width;
  const longNameButton = page.locator(".tools-panel .analyze-button").filter({ hasText: "Tickets" });
  const buttonBox = await longNameButton.evaluate((el) => ({ scroll: el.scrollWidth, client: el.clientWidth, width: el.getBoundingClientRect().width, height: el.getBoundingClientRect().height }));
  check("a long deck name does not widen the tools panel", buttonBox.width <= toolsWidth + 1, `${buttonBox.width.toFixed(0)} in ${toolsWidth.toFixed(0)}`);
  check("and does not spill out of its button", buttonBox.scroll <= buttonBox.client + 1 && buttonBox.height < 40, `${buttonBox.scroll} wide in ${buttonBox.client}, ${buttonBox.height.toFixed(0)} px tall`);
  check("the whole name is still there to hover", (await longNameButton.getAttribute("title")).includes(longName));
  {
    // With more than one deck the figure says which deck it counts; a long name is cut short, not
    // allowed to push the row of figures wider than the map.
    const deckBadge = page.locator(".map-status .ticket-count");
    const badgeText = (await deckBadge.textContent()) ?? "";
    const fits = await page.evaluate(() => { const row = document.querySelector(".map-status"); const badge = row.querySelector(".ticket-count"); return { row: row.scrollWidth <= row.clientWidth + 1, badge: badge.scrollWidth > badge.clientWidth || badge.getBoundingClientRect().width < 320 }; });
    const decks = (await ticketsNow()).decks.length;
    check("with several decks, the ticket figure names the deck it counts", decks < 2 || badgeText.includes(longName.slice(0, 10)), `${decks} decks: ${badgeText}`);
    check("and a long deck name does not widen the row of figures", fits.row && fits.badge, JSON.stringify(fits));
    check("the whole deck name is there to hover on the figure", ((await deckBadge.getAttribute("title")) ?? "").includes(longName));
  }
  await useTool("Add ticket");
  await page.waitForTimeout(400);
  const headingBox = await page.locator(".properties .panel-heading").evaluate((el) => ({ scroll: el.scrollWidth, client: el.clientWidth, line: el.querySelector("small").getBoundingClientRect().height }));
  check("the right panel cuts it off rather than wrapping it", headingBox.scroll <= headingBox.client + 1 && headingBox.line < 24, `${headingBox.scroll} in ${headingBox.client}, ${headingBox.line.toFixed(0)} px tall`);

  sectionStart(29);
  // 29. the deck styles are laid out so they can be compared, and nothing is too pale to read
  await page.getByRole("button", { name: "Tickets", exact: true }).click();
  await page.waitForTimeout(400);
  await page.getByRole("button", { name: /Add a deck/ }).click();
  await page.waitForTimeout(250);
  await page.getByRole("menuitem", { name: /Build a full deck of tickets/ }).click();
  await page.waitForSelector(".suggest-dialog", { timeout: 20000 });
  await page.waitForTimeout(400);
  const styleCards = page.locator(".style-card");
  check("every style is described side by side: Generic, Classic, Europe and Small boards", (await styleCards.count()) === 4, (await page.locator(".style-card strong").allTextContents()).join(", "));
  const firstCard = (await styleCards.first().textContent()).toLowerCase();
  check("each says what its deck and its lengths are", /deck/.test(firstCard) && /lengths/.test(firstCard), firstCard.slice(0, 70));
  check("the chosen one is marked", (await page.locator(".style-card.chosen").count()) === 1, await page.locator(".style-card.chosen strong").textContent());
  await styleCards.nth(1).click();
  await page.waitForTimeout(500);
  check("another style can be picked", (await page.locator(".style-card.chosen strong").textContent()) === "Classic", await page.locator(".style-card.chosen strong").textContent());

  // Text has to stand out from what it sits on: 4.5:1 for ordinary text, 3:1 for large or bold.
  const faint = await page.evaluate(() => {
    const parse = (value) => { const m = value.match(/rgba?\(([^)]+)\)/); if (!m) return null; const p = m[1].split(/[ ,\/]+/).filter(Boolean).map(Number); return { r: p[0], g: p[1], b: p[2], a: p[3] === undefined ? 1 : p[3] }; };
    const lum = ({ r, g, b }) => { const f = (c) => { c /= 255; return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); }; return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b); };
    const over = (fg, bg) => ({ r: fg.r * fg.a + bg.r * (1 - fg.a), g: fg.g * fg.a + bg.g * (1 - fg.a), b: fg.b * fg.a + bg.b * (1 - fg.a), a: 1 });
    const ratio = (a, b) => { const hi = Math.max(lum(a), lum(b)), lo = Math.min(lum(a), lum(b)); return (hi + 0.05) / (lo + 0.05); };
    const backgroundOf = (el) => { let node = el; while (node) { const bg = parse(getComputedStyle(node).backgroundColor); if (bg && bg.a >= 1) return bg; node = node.parentElement; } return { r: 255, g: 255, b: 255, a: 1 }; };
    const bad = [];
    for (const el of document.querySelectorAll("body *")) {
      if (el.closest(".print-pages")) continue;
      const text = Array.from(el.childNodes).filter((n) => n.nodeType === 3).map((n) => n.textContent.trim()).join(" ").trim();
      if (!text) continue;
      const style = getComputedStyle(el);
      if (style.visibility === "hidden" || style.display === "none" || Number(style.opacity) === 0) continue;
      const box = el.getBoundingClientRect();
      if (!box.width || !box.height) continue;
      const fg = parse(style.color); if (!fg) continue;
      const bg = backgroundOf(el);
      const size = parseFloat(style.fontSize);
      // AAA, not AA: at 4.5 the greys still read as washed out against the beige.
      const need = size >= 24 || (Number(style.fontWeight) >= 700 && size >= 18.66) ? 4.5 : 7;
      const got = ratio(over(fg, bg), bg);
      if (got < need) bad.push(`${el.className || el.tagName} ${style.color} ${got.toFixed(2)}<${need}`);
    }
    return [...new Set(bad)];
  });
  check("no text is too pale against what it sits on", faint.length === 0, faint.slice(0, 4).join(" | "));
  await page.keyboard.press("Escape");
  await page.waitForTimeout(300);

  sectionStart(30);
  // 30. About sits under Help and is a page of its own
  await page.getByRole("button", { name: /Help/ }).click();
  await page.waitForTimeout(300);
  const helpItems = await page.locator('[role="menuitem"]').allTextContents();
  check("Help offers the guide, About, What's new and the source code, and nothing clutters the header", helpItems.length === 4 && helpItems.some((t) => /About/.test(t)) && helpItems.some((t) => /What.s new/.test(t)) && helpItems.some((t) => /Source code/.test(t)), helpItems.join(" | "));
  await page.getByRole("menuitem", { name: /About/ }).click();
  await page.waitForTimeout(1200);
  check("About is a page of its own", page.url().includes("/about"), page.url());
  const aboutText = (await page.locator("body").textContent()).toLowerCase();
  check("it says where the numbers come from", /shortest path/.test(aboutText) && /official/.test(aboutText));
  check("and how to keep track of wagons while playing on paper", /put one back in the box/.test(aboutText));
  check("and that full size lets you use the real trains", /lay the plastic trains on the paper/.test(aboutText));
  check("and names the version", /\d+\.\d+\.\d+/.test(aboutText), (aboutText.match(/\d+\.\d+\.\d+/) || ["none"])[0]);
  await page.getByRole("link", { name: /back to the editor/i }).first().click();
  await page.waitForTimeout(1200);
  check("and leads back to the editor", (await page.locator(".map-canvas").count()) === 1, page.url());

  sectionStart(31);
  // 31. the setup fields: selectable labels, lined up, and no stray detail
  await page.getByRole("button", { name: "Settings" }).click();
  await page.waitForTimeout(500);
  const labelSelectable = await page.evaluate(() => {
    const label = document.querySelector('label[for="settings-wagons"]');
    return label ? getComputedStyle(label).userSelect : null;
  });
  check("a label can be selected and copied like any other text", labelSelectable !== "none", String(labelSelectable));
  // Per row: the settings are laid out as two rows of fields, and each row must line up.
  const rows = await page.$$eval(".settings-pair", (pairs) => pairs.map((pair) => Array.from(pair.querySelectorAll("input")).map((el) => Math.round(el.getBoundingClientRect().top))));
  check("the setup fields line up within each row", rows.every((row) => new Set(row).size <= 1), rows.map((row) => row.join("/")).join(" · "));
  check("setting a map up no longer asks about space at stops", (await page.locator("#settings-gap").count()) === 0);
  check("the fields it does ask about are all there", await page.locator("#settings-wagons").isVisible() && await page.locator("#settings-starting-tickets").isVisible() && await page.locator("#settings-kept-tickets").isVisible());
  await page.keyboard.press("Escape");
  await page.waitForTimeout(300);

  sectionStart(32);
  // 32. Settings can be left with confidence
  await page.getByRole("button", { name: "Settings" }).click();
  await page.waitForTimeout(500);
  const settingsFooter = await page.locator(".settings-foot").textContent();
  check("Settings says its changes are already saved", /saved as you change/i.test(settingsFooter), settingsFooter.slice(0, 70));
  const doneButton = page.locator(".settings-foot button");
  check("and offers a way out that feels like confirming", (await doneButton.count()) === 1, await doneButton.textContent());
  await doneButton.click();
  await page.waitForTimeout(400);
  check("which closes it", (await page.locator("#settings-format").count()) === 0);

  // On a map with nothing on it, it says what is worth doing now and what can wait.
  await startOver();
  await page.waitForTimeout(600);
  await page.getByRole("button", { name: "Settings" }).click();
  await page.waitForTimeout(500);
  check("a new map has no deck rules of its own", await page.evaluate(() => { const m = JSON.parse(localStorage.getItem("ttr-map")); return !(m.deckRules || []).length && !m.deckRule; }));
  check("a new map starts at the original game's numbers: 45 wagons, 3 tickets, 2–5 players",
    (await page.locator("#settings-wagons").inputValue()) === "45" && (await page.locator("#settings-starting-tickets").inputValue()) === "3" && (await page.locator("#settings-players-min").inputValue()) === "2" && (await page.locator("#settings-players-max").inputValue()) === "5",
    `${await page.locator("#settings-wagons").inputValue()} / ${await page.locator("#settings-starting-tickets").inputValue()} / ${await page.locator("#settings-players-min").inputValue()}–${await page.locator("#settings-players-max").inputValue()}`);
  check("a new map is told the board format is all it needs to start", await page.locator(".settings-start").isVisible(), await page.locator(".settings-start").textContent());
  check("and the way out invites drawing", /start drawing/i.test(await page.locator(".settings-foot button").textContent()), await page.locator(".settings-foot button").textContent());
  await page.locator(".settings-foot button").click();
  await page.waitForTimeout(400);


  sectionStart(34);
  // 34. a map saved on a format that is now a print choice opens on its board
  await page.evaluate(() => {
    const map = JSON.parse(localStorage.getItem("ttr-map"));
    localStorage.setItem("ttr-map", JSON.stringify({ ...map, format: "a4" }));
  });
  await page.reload({ waitUntil: "networkidle" });
  await page.waitForTimeout(700);
  check("a map saved as an A4 test sheet opens as a standard board", (await badges())[0] === "Standard board 2×3", (await badges())[0]);
  check("with everything on it", /\d+ stops/.test((await badges())[2]), (await badges())[2]);

  } // end of the chain, sections 1 to 34

  // 33. route types are drawn, not just named
  // Section 33 is its own page now and needs nothing from sections 1 to 32.
  if (wants(33)) {
  sectionStart(33);
  const page = await (await browser.newContext({ viewport: { width: 1500, height: 1000 } })).newPage();
  page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
  page.on("pageerror", (e) => errors.push(String(e)));
  await page.goto(BASE, { waitUntil: "networkidle" });
  // It starts from an empty map, as the chain leaves it: 33b loads the example from Getting started, which only goes
  // without asking when the map has nothing on it.
  await page.getByRole("button", { name: "Start with a blank map" }).click();
  await page.waitForTimeout(400);
  await page.keyboard.press("Escape");
  await page.waitForTimeout(300);
  const tool = (label) => page.locator(`.tool-row .tool-button[aria-label="${label}"]`);
  const logoOn = (p) => p.evaluate(() => Array.from(document.querySelectorAll("svg.route-logo")).map((svg) => ({ wagons: svg.querySelectorAll(".route-logo-wagon").length, stops: svg.querySelectorAll(".route-logo-stop").length, label: svg.getAttribute("aria-label"), header: Boolean(svg.closest(".brand, .about-head")) })));
  const choosePrintParts = async (board, tickets, rules) => { for (const [name, want] of [["Print the board", board], ["Print the tickets", tickets], ["Print the rules", rules]]) if ((await printPart(name).isChecked()) !== want) await printPart(name).setChecked(want); };
  const printDialog = () => page.getByRole("dialog", { name: "Print the map" });
  const printPart = (name) => printDialog().getByRole("checkbox", { name, exact: true });
  const printButton = () => page.getByRole("button", { name: "Print map" });
  const ticketsButton = page.getByRole("button", { name: "Tickets", exact: true });
  const clearlyMarked = (info) => info.marked >= 1 && info.withHalo === info.marked && info.haloPx >= info.wagonPx + 6 && info.dimmed;
  const markInfo = (cls) => page.evaluate((cls) => {
    const groups = Array.from(document.querySelectorAll(`.map-canvas .route-group.${cls}`));
    const unmarked = Array.from(document.querySelectorAll(".map-canvas .route-group:not(.on-preview):not(.on-ticket):not(.bottleneck)"));
    const scaleOf = (el) => { const m = el.getScreenCTM(); return m ? Math.hypot(m.a, m.b) : 0; };
    const halos = groups.map((g) => g.querySelector(".route-halo"));
    const wagon = (groups[0] || document).querySelector(".wagon-slot rect");
    const wagonPx = wagon ? +wagon.getAttribute("height") * scaleOf(wagon) : 0;
    return {
      marked: groups.length,
      withHalo: halos.filter(Boolean).length,
      haloPx: halos[0] ? parseFloat(getComputedStyle(halos[0]).strokeWidth) * scaleOf(halos[0]) : 0,
      wagonPx,
      dimmed: unmarked.length > 0 && unmarked.every((g) => parseFloat(getComputedStyle(g).opacity) <= 0.5),
      undimmed: unmarked.every((g) => parseFloat(getComputedStyle(g).opacity) >= 0.99),
    };
  }, cls);
  const startOver = async (p = page) => { await p.getByRole("button", { name: "Settings" }).click(); await p.waitForTimeout(300); await p.locator(".settings-nav-item", { hasText: /^Map/ }).click(); await p.getByRole("button", { name: "Start over…" }).click(); await p.waitForTimeout(300); await p.getByRole("alertdialog").getByRole("button", { name: "Start over", exact: true }).click(); await p.waitForTimeout(400); };
  const lengthsIn = async (scope) => scope.evaluate((root) => {
    const section = Array.from(root.querySelectorAll(".analysis-section")).find((el) => el.querySelector("h3") && /^Ticket lengths$/.test(el.querySelector("h3").textContent.trim()));
    if (!section) return null;
    const rows = Array.from(section.querySelectorAll(".length-row")).map((row) => ({
      label: row.querySelector(".length-label").textContent.trim(),
      share: parseFloat(row.querySelector(".length-fill").style.width),
      count: Number(row.querySelector(".length-count").textContent.replace(/[^0-9]/g, "")),
      official: row.querySelector('.length-ref[data-ref="official"]') ? parseFloat(row.querySelector('.length-ref[data-ref="official"]').style.left) : null,
      own: row.querySelector('.length-ref[data-ref="own"]') ? parseFloat(row.querySelector('.length-ref[data-ref="own"]').style.left) : null,
    }));
    const parent = root.getBoundingClientRect();
    const spill = Array.from(section.querySelectorAll("*")).filter((el) => el.getClientRects().length && el.getBoundingClientRect().right > parent.right + 1).length;
    return { rows, verdict: (section.querySelector(".length-verdict") || { textContent: "" }).textContent, spill };
  });
  const clickStop = async (name) => {
    await page.evaluate((n) => {
      // By its drawn name, or by its hover title for a junction, whose name is not drawn.
      const s = Array.from(document.querySelectorAll(".map-canvas .stop")).find((g) => Array.from(g.querySelectorAll("text, title")).some((t) => t.textContent === n));
      s.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true }));
      // A click ends where it began. Without the release, the select tool is left holding a drag of
      // the stop, and the next real pointer movement drags it across the map.
      s.dispatchEvent(new PointerEvent("pointerup", { bubbles: true }));
    }, name);
    await page.waitForTimeout(250);
  };
  await page.getByRole("button", { name: "Settings" }).click();
  await page.waitForTimeout(400);
  await page.locator(".settings-nav-item", { hasText: /Route types/ }).click();
  await page.waitForTimeout(500);
  const listPreviews = await page.locator(".style-entry .route-preview").count();
  check("every route type is drawn beside its name", listPreviews >= 3, `${listPreviews} drawn`);
  check("and the chosen one is drawn large", await page.locator(".route-preview-large").isVisible());
  const drawn = await page.locator(".route-preview-large").evaluate((el) => ({
    line: Boolean(el.querySelector("line")),
    width: el.querySelector("line").getAttribute("stroke-width"),
    slots: el.querySelectorAll("path").length,
  }));
  check("the drawing carries the line's own thickness", drawn.line && Number(drawn.width) >= 1, `${drawn.width}px`);
  check("and the wagon spaces along it", drawn.slots >= 2, `${drawn.slots} spaces`);
  await page.keyboard.press("Escape");
  await page.waitForTimeout(300);

  // 33b. a junction keeps its name in the editor but never draws it on the map
  await page.getByRole("button", { name: "Help" }).click();
  await page.getByRole("menuitem", { name: "Getting started" }).click();
  await page.waitForTimeout(300);
  await page.getByRole("button", { name: "Load the example map" }).click();
  await page.waitForTimeout(600);
  await tool("Select & move").click();
  await clickStop("Quarry");
  await page.waitForTimeout(300);
  const stopTypeSelect = page.locator(".line-style-section", { hasText: "Stop type" }).locator("select");
  await stopTypeSelect.selectOption("junction");
  await page.waitForTimeout(400);
  const drawnNames = (root) => page.evaluate((r) => Array.from(document.querySelectorAll(`${r} .stop text`)).map((t) => t.textContent), root);
  check("a junction's name is not drawn on the map", !(await drawnNames(".map-canvas")).includes("Quarry"), (await drawnNames(".map-canvas")).join(", "));
  check("nor in print", !(await drawnNames(".print-pages")).includes("Quarry") && (await drawnNames(".print-pages")).includes("Westport"), (await drawnNames(".print-pages")).slice(0, 12).join(", "));
  check("but it keeps its name in the editor", (await page.locator("#stop-name").inputValue()) === "Quarry", await page.locator("#stop-name").inputValue());
  check("and shows it when pointed at", await page.evaluate(() => Array.from(document.querySelectorAll(".map-canvas .stop title")).some((t) => t.textContent === "Quarry")));
  check("other stops still draw their names", (await drawnNames(".map-canvas")).includes("Westport"));
  check("and its properties offer no name position to turn", (await page.locator(".label-angle", { hasText: "Name position" }).count()) === 0);
  check("but say why the name is not on the map", /junction/i.test(await page.locator(".property-form").textContent()) && /not drawn/i.test(await page.locator(".property-form").textContent()));
  await page.locator("#stop-name").fill("Quarry Junction");
  await page.waitForTimeout(300);
  check("renaming a junction draws nothing either", !(await drawnNames(".map-canvas")).some((n) => /Quarry/.test(n)));
  await page.locator("#stop-name").fill("Quarry");
  await stopTypeSelect.selectOption("city");
  await page.waitForTimeout(400);
  check("turned back into a regular stop, its name is drawn again", (await drawnNames(".map-canvas")).includes("Quarry"));
  await page.keyboard.press("Escape");

  // 33c. a name turns smoothly around its stop: no jump at the top or the bottom
  await tool("Select & move").click();
  await clickStop("Central");
  await page.waitForTimeout(300);
  // Turned by dragging the name to a point at that bearing from the stop, as a person does; there is
  // no slider for it any more.
  const nameAt = async (angle) => {
    const at = await page.evaluate(() => {
      const g = Array.from(document.querySelectorAll(".map-canvas .stop")).find((el) => Array.from(el.querySelectorAll("text")).some((t) => t.textContent === "Central"));
      const c = g.querySelector("circle").getBoundingClientRect(), t = Array.from(g.querySelectorAll("text")).find((el) => el.textContent === "Central").getBoundingClientRect();
      return { cx: c.x + c.width / 2, cy: c.y + c.height / 2, lx: t.x + t.width / 2, ly: t.y + t.height / 2 };
    });
    await page.mouse.move(at.lx, at.ly);
    await page.mouse.down();
    await page.mouse.move(at.cx + Math.cos(angle * Math.PI / 180) * 45, at.cy + Math.sin(angle * Math.PI / 180) * 45, { steps: 4 });
    await page.mouse.up();
    await page.waitForTimeout(120);
    return page.evaluate(() => {
      const g = Array.from(document.querySelectorAll(".map-canvas .stop")).find((el) => Array.from(el.querySelectorAll("text")).some((t) => t.textContent === "Central"));
      const c = g.querySelector("circle").getBoundingClientRect();
      const t = Array.from(g.querySelectorAll("text")).find((el) => el.textContent === "Central").getBoundingClientRect();
      const cx = c.x + c.width / 2, cy = c.y + c.height / 2;
      const nx = Math.max(t.left, Math.min(cx, t.right)), ny = Math.max(t.top, Math.min(cy, t.bottom));
      return { x: t.x + t.width / 2, y: t.y + t.height / 2, width: t.width, height: t.height, gap: Math.hypot(nx - cx, ny - cy) - c.width / 2 };
    });
  };
  const turns = [];
  for (let angle = 0; angle <= 360; angle += 15) turns.push({ angle, ...(await nameAt(angle % 360)) });
  // A smooth turn moves the name a few pixels per 15° step. The old placement snapped its anchor from
  // end to middle to start near the top and bottom, a jump of half the name's width per step.
  const jumps = turns.slice(1).map((now, i) => ({ at: `${turns[i].angle}→${now.angle}°`, move: Math.hypot(now.x - turns[i].x, now.y - turns[i].y), limit: now.width / 4 + 3 })).filter((step) => step.move > step.limit);
  check("a stop's name moves smoothly all the way round, top and bottom included", jumps.length === 0, jumps.map((j) => `${j.at} ${j.move.toFixed(0)}px`).join(", "));
  const badGaps = turns.filter((turn) => turn.gap < -0.5 || turn.gap > turn.height).map((turn) => `${turn.angle}°: ${turn.gap.toFixed(1)}px`);
  check("and keeps the same small distance from the stop at every angle", badGaps.length === 0, badGaps.join(", "));
  await nameAt(165);
  await page.keyboard.press("Escape");

  // 33d. a stop's name can be taken with the mouse and turned to any angle round the stop
  await tool("Select & move").click();
  const centralName = () => page.evaluate(() => {
    const g = Array.from(document.querySelectorAll(".map-canvas .stop")).find((el) => Array.from(el.querySelectorAll("text")).some((t) => t.textContent === "Central"));
    const c = g.querySelector("circle").getBoundingClientRect();
    const t = Array.from(g.querySelectorAll("text")).find((el) => el.textContent === "Central").getBoundingClientRect();
    const cx = c.x + c.width / 2, cy = c.y + c.height / 2, lx = t.x + t.width / 2, ly = t.y + t.height / 2;
    return { cx, cy, lx, ly, bearing: (Math.atan2(ly - cy, lx - cx) * 180 / Math.PI + 360) % 360 };
  });
  const storedCentral = () => page.evaluate(() => JSON.parse(localStorage.getItem("ttr-map")).stops.find((stop) => stop.name === "Central"));
  const bearingGap = (a, b) => Math.abs(((a - b + 540) % 360) - 180);
  const dragName = async (angle, { release = true } = {}) => {
    // A tall Properties panel can scroll the page, taking the map with it: bring the map back first.
    await page.evaluate(() => window.scrollTo(0, 0));
    const at = await centralName();
    const to = { x: at.cx + Math.cos(angle * Math.PI / 180) * 45, y: at.cy + Math.sin(angle * Math.PI / 180) * 45 };
    await page.mouse.move(at.lx, at.ly);
    await page.mouse.down();
    await page.mouse.move(to.x, to.y, { steps: 8 });
    if (release) { await page.mouse.up(); await page.waitForTimeout(300); }
  };
  const beforeDrag = await storedCentral();
  await dragName(37, { release: false });
  await page.waitForTimeout(150);  // the map is stored after the move is drawn; WebKit takes a moment longer
  // The name box is pushed out by half its width but only part of its height, so its centre points
  // flatter than the angle; the angle itself is what the map stores as it goes.
  const midDrag = (await storedCentral()).labelAngle;
  check("a name follows the pointer round its stop while it is dragged", bearingGap(midDrag, 37) <= 2, `${midDrag}°`);
  await page.mouse.up();
  await page.waitForTimeout(300);
  const afterDrag = await storedCentral();
  check("and stays at the angle it was let go, to the degree rather than in 15° steps", afterDrag.labelAngle !== undefined && bearingGap(afterDrag.labelAngle, 37) <= 2 && afterDrag.labelAngle % 15 !== 0, String(afterDrag.labelAngle));
  // A drag is not a text selection: the browser must not paint every stop name blue as the pointer
  // sweeps across them. A short drag does not show it; a long one across other names does.
  const selectedText = () => page.evaluate(() => { const sel = window.getSelection(); return sel && !sel.isCollapsed ? sel.toString().replace(/\s+/g, " ").slice(0, 80) : ""; });
  const sweep = async (from) => { await page.mouse.move(from.x, from.y); await page.mouse.down(); await page.mouse.move(from.x + 600, from.y + 300, { steps: 25 }); await page.mouse.up(); await page.waitForTimeout(200); };
  const nameStart = await centralName();
  await sweep({ x: nameStart.lx, y: nameStart.ly });
  const fromName = await selectedText();
  await page.evaluate(() => window.getSelection().removeAllRanges());
  await sweep({ x: nameStart.cx - 200, y: nameStart.cy + 120 });
  const fromMap = await selectedText();
  await page.evaluate(() => window.getSelection().removeAllRanges());
  check("dragging a name across the map selects no text", fromName === "", JSON.stringify(fromName));
  check("nor does dragging across the map from anywhere else", fromMap === "", JSON.stringify(fromMap));
  await page.keyboard.press("Meta+z");
  await page.waitForTimeout(300);
  await clickStop("Central");
  check("dragging the name leaves the stop where it was", afterDrag.x === beforeDrag.x && afterDrag.y === beforeDrag.y, `${beforeDrag.x},${beforeDrag.y} -> ${afterDrag.x},${afterDrag.y}`);
  check("and the stop's hint says the name can be dragged", /drag (its|the) name/i.test(await page.locator(".map-hint").textContent()), await page.locator(".map-hint").textContent());
  await page.evaluate(() => document.activeElement && document.activeElement.blur());
  await page.keyboard.press("Meta+z");
  await page.waitForTimeout(300);
  check("one undo puts the whole drag back", (await storedCentral()).labelAngle === beforeDrag.labelAngle, `${(await storedCentral()).labelAngle} vs ${beforeDrag.labelAngle}`);
  await clickStop("Central");
  await page.getByRole("button", { name: "Lock position" }).click();
  await page.waitForTimeout(200);
  await dragName(270);
  const lockedDrag = await storedCentral();
  check("a locked stop's name can still be turned", bearingGap(lockedDrag.labelAngle, 270) <= 2, String(lockedDrag.labelAngle));
  check("without the locked stop moving", lockedDrag.x === beforeDrag.x && lockedDrag.y === beforeDrag.y);
  await page.getByRole("button", { name: "Unlock position" }).click();
  await dragName(165);

  // 33e. names can be locked, one at a time or all at once, the way stop positions are
  const panelLabels = (await page.locator(".property-form label").allTextContents()).map((t) => t.trim());
  check("the panel has one Name, for the field, and Name on the map, for where it is drawn", panelLabels.filter((t) => t === "Name").length === 1 && panelLabels.includes("Name on the map"), panelLabels.join(" | "));
  check("a stop's panel has no slider for its name any more", (await page.locator(".property-form input[type=range]").count()) === 1 && (await page.getByText(/Name position/).count()) === 0,
    `${await page.locator(".property-form input[type=range]").count()} sliders`);
  const nameBefore = (await storedCentral()).labelAngle;
  await page.getByRole("button", { name: "Lock name", exact: true }).click();
  await page.waitForTimeout(200);
  check("Lock name locks it in the map", (await storedCentral()).labelLocked === true);
  await dragName(300);
  check("a locked name does not move when dragged", (await storedCentral()).labelAngle === nameBefore, `${(await storedCentral()).labelAngle} vs ${nameBefore}`);
  check("and the stop does not move instead", (await storedCentral()).x === beforeDrag.x && (await storedCentral()).y === beforeDrag.y);
  await page.keyboard.down("Shift");
  await dragName(300);
  await page.keyboard.up("Shift");
  check("but Shift-dragging turns it anyway", bearingGap((await storedCentral()).labelAngle, 300) <= 2, String((await storedCentral()).labelAngle));
  await page.getByRole("button", { name: "Unlock name", exact: true }).click();
  await page.waitForTimeout(200);
  check("Unlock name frees it again", !(await storedCentral()).labelLocked);
  await page.getByRole("button", { name: "Lock every name" }).click();
  await page.waitForTimeout(200);
  const allNamesLocked = await page.evaluate(() => JSON.parse(localStorage.getItem("ttr-map")).stops.every((st) => st.labelLocked));
  check("Lock every name locks them all", allNamesLocked);
  // Put Central's name on one of its own routes, then ask for every name to be moved clear.
  let coveredAt = null;
  for (const angle of [225, 315, 135, 45, 180, 0, 270, 90]) {
    await page.keyboard.down("Shift"); await dragName(angle); await page.keyboard.up("Shift");
    await page.waitForTimeout(200);
    if (await page.getByRole("button", { name: /^Move \d+ names? clear$/ }).count()) { coveredAt = (await storedCentral()).labelAngle; break; }
  }
  check("a locked name can still be found sitting on a route", coveredAt !== null, String(coveredAt));
  if (coveredAt !== null) {
    await page.getByRole("button", { name: /^Move \d+ names? clear$/ }).click();
    await page.waitForTimeout(300);
    check("and Move names clear leaves a locked name where it is", (await storedCentral()).labelAngle === coveredAt, `${(await storedCentral()).labelAngle} vs ${coveredAt}`);
  }
  await page.getByRole("button", { name: "Unlock every name" }).click();
  await page.waitForTimeout(200);
  check("Unlock every name frees them all", await page.evaluate(() => JSON.parse(localStorage.getItem("ttr-map")).stops.every((st) => !st.labelLocked)));
  await dragName(165);
  await page.keyboard.press("Escape");

  // 33f. deck rules: our three sets are fixed, and a set of your own changes the terms for a map
  const storedRules = () => page.evaluate(() => { const m = JSON.parse(localStorage.getItem("ttr-map")); return { rules: m.deckRules || [], chosen: m.deckRule }; });
  await page.getByRole("button", { name: "Settings" }).click();
  await page.waitForTimeout(400);
  const navItems = (await page.locator(".settings-nav-item").allTextContents()).join(" | ");
  check("Settings has Deck rules, and Ticket lengths is part of it", /Deck rules/.test(navItems) && !/Ticket lengths/.test(navItems), navItems);
  await page.locator(".settings-nav-item", { hasText: /deck rules/i }).click();
  await page.waitForTimeout(400);
  check("the ticket length bands and mix are on the Deck rules page", await page.locator("#mix-medium-edge").isVisible() && await page.locator("#mix-short").isVisible());
  const ruleChoices = await page.locator(".deck-rule-choice").allTextContents();
  check("our three sets are offered", ["Generic", "Classic", "Europe"].every((name) => ruleChoices.some((text) => text.includes(name))), ruleChoices.join(" | "));
  // With no choice of its own, a map is built on Generic, the average of the official maps, and the
  // page says so.
  check("with no choice made, a full deck is built on Generic, and the page says why", (await storedRules()).chosen === undefined && await page.getByRole("radio", { name: "Generic", exact: true }).isChecked() && /average/i.test(await page.locator(".deck-rule-default").textContent()),
    await page.locator(".deck-rule-default").textContent().catch(() => "no note"));
  await page.getByRole("radio", { name: "Generic", exact: true }).check();
  await page.waitForTimeout(200);
  // Text on the Deck rules page is measured the way the print dialog's is: 7:1 when small, 4.5:1 otherwise.
  const rulesContrast = () => page.evaluate(() => {
    const root = document.querySelector('[role="dialog"] .deck-rules');
    const rgba = (value) => { const m = value.match(/[\d.]+/g).map(Number); return { r: m[0], g: m[1], b: m[2], a: m.length > 3 ? m[3] : 1 }; };
    const lum = ({ r, g, b }) => { const c = [r, g, b].map((v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }); return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]; };
    const background = (el) => { for (let node = el; node; node = node.parentElement) { const bg = rgba(getComputedStyle(node).backgroundColor); if (bg.a > 0.5) return bg; } return { r: 255, g: 255, b: 255, a: 1 }; };
    const failures = []; let measured = 0;
    for (const el of root.querySelectorAll("*")) {
      const text = Array.from(el.childNodes).filter((n) => n.nodeType === 3).map((n) => n.textContent.trim()).join("");
      if (!text || !el.getClientRects().length) continue;
      const style = getComputedStyle(el); const fg = rgba(style.color), bg = background(el);
      const mixed = { r: fg.r * fg.a + bg.r * (1 - fg.a), g: fg.g * fg.a + bg.g * (1 - fg.a), b: fg.b * fg.a + bg.b * (1 - fg.a) };
      const [hi, lo] = [lum(mixed), lum(bg)].sort((a, b) => b - a); const ratio = (hi + 0.05) / (lo + 0.05);
      const size = parseFloat(style.fontSize); measured += 1;
      if (ratio < (size < 14 ? 7 : 4.5)) failures.push(`"${text.slice(0, 28)}" ${ratio.toFixed(2)}:1 at ${size}px`);
      // Contrast alone read too faintly here in small type, so nothing on this page is smaller than 12px.
      if (size < 12) failures.push(`"${text.slice(0, 28)}" at ${size}px`);
    }
    return { measured, failures };
  });
  const ruleValues = page.locator(".deck-rule-values");
  check("Generic's values are shown", /1\.1/.test(await ruleValues.textContent()) && /per stop/i.test(await ruleValues.textContent()), (await ruleValues.textContent()).slice(0, 160));
  check("and cannot be changed", (await ruleValues.locator("input:not([disabled]), select:not([disabled])").count()) === 0);
  check("with the official decks' range beside a value", /official/i.test(await ruleValues.textContent()));
  const fixedContrast = await rulesContrast();
  check("every piece of text on the page has strong contrast, ours shown", fixedContrast.measured > 15 && fixedContrast.failures.length === 0, `${fixedContrast.measured} measured; ${fixedContrast.failures.slice(0, 5).join("; ")}`);
  check("where tickets start and end is said plainly, not as 'Towards the edges'", !/Towards the edges/.test(await ruleValues.textContent()) && /Where tickets start and end/.test(await ruleValues.textContent()) && /average stop/i.test(await ruleValues.textContent()), (await ruleValues.textContent()).slice(-260));
  check("and it says these length shares steer the suggester until the map sets its own mix", /until you change the ticket mix below/i.test(await ruleValues.textContent()), (await ruleValues.textContent()).slice(-200));
  await page.getByRole("button", { name: "Create your own from Generic" }).click();
  await page.waitForTimeout(300);
  let rules = await storedRules();
  check("a set of your own is made from it, and chosen", rules.rules.length === 1 && rules.rules[0].ticketsPerStop === 1.1 && rules.chosen === rules.rules[0].id, JSON.stringify(rules).slice(0, 200));
  check("its values can be changed", (await ruleValues.locator("input:not([disabled])").count()) >= 8, String(await ruleValues.locator("input:not([disabled])").count()));
  const binTops = await page.evaluate(() => [0, 1, 2, 3, 4].map((i) => Math.round(document.getElementById(`rule-bin-${i}`).getBoundingClientRect().top)));
  check("the five length fields stand in one line", Math.max(...binTops) - Math.min(...binTops) <= 1, binTops.join(", "));
  const pairTops = await page.evaluate(() => ["rule-max-per-stop", "rule-length-cap"].map((id) => Math.round(document.getElementById(id).getBoundingClientRect().top)));
  check("fields side by side stand in line even when a label takes two lines", Math.abs(pairTops[0] - pairTops[1]) <= 1, pairTops.join(", "));
  const ownContrast = await rulesContrast();
  check("and with your own set open, too", ownContrast.failures.length === 0, ownContrast.failures.slice(0, 5).join("; "));
  // Own sets say where tickets end as a distance from the map's average stop, beside what the
  // official decks do, and start with no preference when made from Generic.
  check("your own set asks where long and short tickets end, from an average stop", await page.locator("#rule-long-ends").count() === 1 && await page.locator("#rule-short-ends").count() === 1 && /average stop/i.test(await ruleValues.textContent()));
  check("made from Generic, it has no preference on either end", await page.locator("#rule-long-ends-any").isChecked() && await page.locator("#rule-short-ends-any").isChecked());
  check("with the official decks beside each, to compare against", /USA \+0\.21/.test(await ruleValues.textContent()) && /Nordic \+0\.06/.test(await ruleValues.textContent()) && /Polska −0\.10/.test(await ruleValues.textContent()), (await ruleValues.textContent()).slice(-300));
  await page.locator("#rule-long-ends-any").uncheck();
  await page.locator("#rule-long-ends").fill("0.15");
  await page.locator("#rule-long-ends").blur();
  await page.waitForTimeout(250);
  check("a distance set for long tickets is kept in the map", (await storedRules()).rules[0].longEnds === 0.15 && (await storedRules()).rules[0].shortEnds === null, JSON.stringify((await storedRules()).rules[0]).slice(0, 220));
  await page.locator("#rule-tickets-per-stop").fill("0.5");
  await page.locator("#rule-tickets-per-stop").blur();
  await page.locator("#rule-name").fill("Sparse");
  await page.locator("#rule-name").blur();
  await page.waitForTimeout(300);
  rules = await storedRules();
  check("a changed value is kept in the map", rules.rules[0].ticketsPerStop === 0.5 && rules.rules[0].label === "Sparse", JSON.stringify(rules.rules[0]).slice(0, 160));
  await page.locator("#rule-bin-0").fill("50");
  await page.locator("#rule-bin-0").blur();
  await page.waitForTimeout(200);
  check("lengths that do not add up to 100 % are flagged", (await ruleValues.locator(".helper-warning").count()) >= 1);
  await page.locator("#rule-bin-0").fill("18");
  await page.locator("#rule-bin-0").blur();
  await page.waitForTimeout(200);
  check("and the flag goes when they do", (await ruleValues.locator(".helper-warning").count()) === 0);
  // The page is now taller than the window: the dialog must stay inside it and scroll within.
  const settingsBox = await page.locator('[role="dialog"]').first().boundingBox();
  const windowHeight = await page.evaluate(() => window.innerHeight);
  check("Settings stays inside the window when the page grows, and scrolls within", settingsBox.y >= 0 && settingsBox.y + settingsBox.height <= windowHeight + 1, `${Math.round(settingsBox.y)} to ${Math.round(settingsBox.y + settingsBox.height)} in a ${windowHeight}px window`);
  await page.getByRole("radio", { name: "Generic", exact: true }).check();
  await page.waitForTimeout(200);
  check("choosing a built-in set again keeps your own for later", (await storedRules()).rules.length === 1 && (await storedRules()).chosen === "generic");
  await page.getByRole("radio", { name: "Sparse", exact: true }).check();
  await page.waitForTimeout(200);
  await page.keyboard.press("Escape");
  await page.waitForTimeout(300);
  await page.reload({ waitUntil: "networkidle" });
  await page.waitForTimeout(700);
  check("your own set survives a reload", (await storedRules()).rules[0]?.label === "Sparse" && (await storedRules()).chosen === (await storedRules()).rules[0]?.id);
  // Map balance with the map's own rules chosen: the lengths against both references.
  await page.getByRole("button", { name: "Map balance", exact: true }).click();
  await page.waitForTimeout(700);
  {
    const lengths = await lengthsIn(page.locator(".balance-panel"));
    const chosenOwn = await page.evaluate(() => { const m = JSON.parse(localStorage.getItem("ttr-map")); const rule = (m.deckRules || []).find((r) => r.id === m.deckRule); return rule ? { label: rule.label, bins: rule.bins } : null; });
    check("Map balance shows the ticket lengths too", lengths !== null && lengths.rows.length === 5);
    check("with the official decks and the map's own rules both marked", lengths !== null && lengths.rows.every((r) => r.official !== null && r.own !== null), JSON.stringify(lengths && lengths.rows.map((r) => [r.official, r.own])));
    check("the own marks are the chosen rules' shares", chosenOwn !== null && lengths !== null && lengths.rows.every((r, i) => Math.abs(r.own - chosenOwn.bins[i] * 100) < 1), JSON.stringify([chosenOwn, lengths && lengths.rows.map((r) => r.own)]));
    check("and the sentence names both references", lengths !== null && /official/i.test(lengths.verdict) && chosenOwn !== null && lengths.verdict.includes(chosenOwn.label), lengths && lengths.verdict);
    check("nothing spills out of the column", lengths !== null && lengths.spill === 0);
  }
  await page.locator(".balance-panel").getByRole("button", { name: "Done" }).click();
  await page.waitForTimeout(300);
  // The suggester follows the map's rules: half a ticket per stop, floored at what a table of three
  // is dealt, instead of Generic's 1.1.
  await page.getByRole("button", { name: "Tickets", exact: true }).click();
  await page.waitForTimeout(400);
  {
    const lengths = await lengthsIn(page.locator(".tickets-panel"));
    check("with rules of its own chosen, the Tickets panel marks both references", lengths !== null && lengths.rows.every((r) => r.official !== null && r.own !== null) && /Sparse/.test(lengths.verdict) && /official/i.test(lengths.verdict), lengths && lengths.verdict);
  }
  await page.getByRole("button", { name: /Add a deck/ }).click();
  await page.waitForTimeout(250);
  await page.getByRole("menuitem", { name: /Build a full deck of tickets/ }).click();
  await page.waitForTimeout(800);
  // A card is found by its title: your own set's card also says which of ours it was made from.
  const styleCard = (name) => page.locator(".style-card").filter({ has: page.locator("strong", { hasText: new RegExp(`^${name}$`) }) });
  check("the suggester offers your own set beside ours", (await styleCard("Sparse").count()) === 1 && (await page.locator(".style-card").count()) === 5);
  check("and starts on it, because the map chose it", (await styleCard("Sparse").getAttribute("aria-pressed")) === "true");
  // A deck is sized by the stops a ticket can end at: not a junction, and not a stop no route reaches.
  const endStops = await page.evaluate(() => { const m = JSON.parse(localStorage.getItem("ttr-map")); const junction = new Set(m.stopTypeStyles.filter((t) => t.junction).map((t) => t.id)); const touched = new Set(m.routes.flatMap((r) => [r.a, r.b])); return m.stops.filter((s) => touched.has(s.id) && !junction.has(s.type)).length; });
  const sparseSize = Number(await page.locator("#suggest-size").inputValue());
  await styleCard("Generic").click();
  await page.waitForTimeout(400);
  const genericSize = Number(await page.locator("#suggest-size").inputValue());
  check("and aims at a deck its own size: far smaller than Generic's, and not held up to what a table is dealt", sparseSize > 0 && sparseSize < genericSize && genericSize === Math.round(1.1 * endStops) && sparseSize === Math.round(0.5 * endStops), `${sparseSize} against ${genericSize}, from ${endStops} stops a ticket can end at`);
  {
    // A deck too small to deal a full table is warned about and left to the person, never forced up.
    const warning = page.locator(".deck-size-warning");
    await styleCard("Sparse").click();
    await page.waitForTimeout(400);
    const dealt = await page.evaluate(() => { const m = JSON.parse(localStorage.getItem("ttr-map")); return (m.players ? m.players.max : 5) * (m.startingTickets ?? 3); });
    check("a deck too small to deal a full table says so, with the number it would take", (await warning.count()) === 1 && new RegExp(`\\b${dealt}\\b`).test(await warning.textContent()) && /It is allowed/.test(await warning.textContent()), (await warning.count()) ? await warning.textContent() : "no warning");
    check("while the deck still is the size the rules ask for", Number(await page.locator("#suggest-size").inputValue()) === Math.round(0.5 * endStops));
    check("and nothing is blocked: the deck can still be saved", (await page.getByRole("button", { name: "Save as a new deck" }).isEnabled()) || (await page.getByRole("button", { name: /^Replace / }).isEnabled()));
    await page.locator("#suggest-size").fill("5");
    await page.waitForTimeout(500);
    check("a still smaller size is kept as typed, with the warning", Number(await page.locator("#suggest-size").inputValue()) === 5 && (await warning.count()) === 1);
    await warning.getByRole("button", { name: `Use ${dealt}` }).click();
    await page.waitForTimeout(400);
    check("one click raises it to what a table is dealt, and the warning goes", Number(await page.locator("#suggest-size").inputValue()) === dealt && (await warning.count()) === 0, String(await page.locator("#suggest-size").inputValue()));
    await styleCard("Generic").click();
    await page.waitForTimeout(400);
    check("a deck of Generic's size has no warning", (await warning.count()) === 0);
  }
  await page.keyboard.press("Escape");
  await page.waitForTimeout(300);
  await page.keyboard.press("Escape");
  await page.waitForTimeout(300);
  // Deleting your own set falls back to Generic.
  await page.getByRole("button", { name: "Settings" }).click();
  await page.waitForTimeout(400);
  await page.locator(".settings-nav-item", { hasText: /deck rules/i }).click();
  await page.waitForTimeout(300);
  await page.getByRole("radio", { name: "Sparse", exact: true }).check();
  await page.getByRole("button", { name: "Delete this set" }).click();
  await page.waitForTimeout(300);
  check("deleting your own set goes back to Generic", (await storedRules()).rules.length === 0 && ["generic", undefined].includes((await storedRules()).chosen));
  // A copy of Europe carries its point targets over as distances from the average stop, and says so.
  await page.getByRole("radio", { name: "Europe", exact: true }).check();
  await page.getByRole("button", { name: "Create your own from Europe" }).click();
  await page.waitForTimeout(300);
  const fromEurope = (await storedRules()).rules[0];
  check("a copy of Europe ends long tickets +0.21 and short ones −0.05 from an average stop", fromEurope && fromEurope.longEnds === 0.21 && fromEurope.shortEnds === -0.05, JSON.stringify(fromEurope).slice(0, 200));
  check("and explains that Europe's 0.62 becomes +0.21", /0\.62/.test(await ruleValues.textContent()) && /\+0\.21/.test(await ruleValues.textContent()));
  await page.getByRole("button", { name: "Delete this set" }).click();
  await page.waitForTimeout(300);
  await page.keyboard.press("Escape");
  await page.waitForTimeout(300);
  // 33g. nothing in the editor's own panels and dialogs is smaller than 12px. The map's own lettering
  // is to scale with the printed board and is left out, as is the hidden print tree.
  const smallText = () => page.evaluate(() => {
    const found = new Map();
    for (const el of document.querySelectorAll("body *")) {
      if (el.closest(".map-canvas, .print-pages, svg")) continue;
      const text = Array.from(el.childNodes).filter((n) => n.nodeType === 3).map((n) => n.textContent.trim()).join(" ").trim();
      if (!text || !el.getClientRects().length) continue;
      const style = getComputedStyle(el);
      if (style.visibility === "hidden" || style.display === "none") continue;
      const size = parseFloat(style.fontSize);
      if (size < 12) { const key = `${el.tagName.toLowerCase()}.${String(el.className || "").split(" ")[0]} ${size}px`; if (!found.has(key)) found.set(key, text.slice(0, 30)); }
    }
    return [...found].map(([key, text]) => `${key} "${text}"`);
  });
  const tooSmall = [];
  await page.keyboard.press("Escape");
  await page.waitForTimeout(200);
  tooSmall.push(...(await smallText()).map((item) => `main: ${item}`));
  // A select shows its whole choice, not a clipped start of it.
  await clickStop("Central");
  await page.waitForTimeout(300);
  const clipped = await page.evaluate(() => Array.from(document.querySelectorAll(".property-form select")).filter((sel) => { const probe = document.createElement("span"); const cs = getComputedStyle(sel); probe.style.font = cs.font; probe.style.position = "absolute"; probe.style.visibility = "hidden"; probe.textContent = sel.options[sel.selectedIndex]?.text || ""; document.body.appendChild(probe); const need = probe.getBoundingClientRect().width + parseFloat(cs.paddingLeft) + parseFloat(cs.paddingRight); probe.remove(); return need > sel.getBoundingClientRect().width + 1; }).map((sel) => sel.options[sel.selectedIndex]?.text));
  if (clipped.length) tooSmall.push(`properties: choice cut off in its select: ${clipped.join(", ")}`);
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "Settings" }).click();
  await page.waitForTimeout(400);
  for (const section of await page.locator(".settings-nav-item").allTextContents()) {
    await page.locator(".settings-nav-item", { hasText: section.replace(/\d+$/, "").trim() }).first().click();
    await page.waitForTimeout(250);
    tooSmall.push(...(await smallText()).map((item) => `Settings/${section.replace(/\d+$/, "").trim()}: ${item}`));
  }
  await page.keyboard.press("Escape");
  await page.waitForTimeout(300);
  for (const [button, name] of [["Map balance", "balance"], [/^Tickets$/, "tickets"], ["Print map", "print"]]) {
    await page.getByRole("button", { name: button }).click();
    await page.waitForTimeout(600);
    tooSmall.push(...(await smallText()).map((item) => `${name}: ${item}`));
    // Larger text must not push anything past the dialog's edge, where it is cut off.
    const overflow = await page.evaluate(() => { const d = document.querySelector('[role="dialog"]') || document.querySelector(".balance-panel"); const box = d.getBoundingClientRect(); return Array.from(d.querySelectorAll("*")).filter((el) => el.getClientRects().length && !el.closest(".analysis-table-scroll, .print-table-wrap") && el.getBoundingClientRect().right > box.right + 1).map((el) => `${el.tagName.toLowerCase()}.${String(el.className || "").split(" ")[0]}`).slice(0, 5); });
    if (overflow.length) tooSmall.push(`${name}: runs past the dialog's edge: ${overflow.join(", ")}`);
    await page.keyboard.press("Escape");
    await page.waitForTimeout(300);
  }
  const uniqueSmall = [...new Set(tooSmall)];
  check("no text in the editor's panels and dialogs is smaller than 12px", uniqueSmall.length === 0, `${uniqueSmall.length}: ${uniqueSmall.slice(0, 12).join(" | ")}`);
  if (process.env.SHOW_SMALL) console.log(uniqueSmall.join("\n"));

  // 33h. suggested routes sit in the right column and show on the map where they would go; the
  // low-connection card lists every stop it means. A blank map with six stops has both.
  await startOver();
  await page.waitForTimeout(500);
  if (await page.locator(".settings-foot button").count()) { await page.locator(".settings-foot button").click(); await page.waitForTimeout(300); }
  await tool("Add stop").click();
  for (const [fx, fy] of [[0.15, 0.2], [0.35, 0.25], [0.55, 0.2], [0.2, 0.6], [0.45, 0.65], [0.7, 0.55]]) {
    await page.evaluate(([x, y]) => { const svg = document.querySelector(".map-canvas"); const r = svg.getBoundingClientRect(); svg.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, clientX: r.left + r.width * x, clientY: r.top + r.height * y })); svg.dispatchEvent(new PointerEvent("pointerup", { bubbles: true, clientX: r.left + r.width * x, clientY: r.top + r.height * y })); }, [fx, fy]);
    await page.waitForTimeout(150);
  }
  await tool("Select & move").click();
  const sixStops = await page.evaluate(() => JSON.parse(localStorage.getItem("ttr-map")).stops);
  check("six stops are placed", sixStops.length === 6, String(sixStops.length));
  const lowConnectionCard = page.locator(".crossing-card.shape-card");
  check("the card counts six stops with no route, as a warning", /6 stops with no route/.test(await lowConnectionCard.textContent()) && (await lowConnectionCard.evaluate((el) => el.classList.contains("has-warning"))), await lowConnectionCard.textContent());
  await lowConnectionCard.hover();
  await page.waitForTimeout(400);
  const lowTip = (await page.locator('[data-slot="tooltip-content"]').textContent().catch(() => "")) || "";
  check("and pointing at it lists every one of them", sixStops.every((st) => lowTip.includes(st.name)), lowTip.slice(0, 160));
  await page.mouse.move(5, 5);
  await page.getByRole("button", { name: "Suggest routes" }).click();
  await page.waitForTimeout(500);
  const suggestionPanel = page.locator(".suggestion-panel");
  check("suggested routes open in the right column, not in a dialog", (await suggestionPanel.count()) === 1 && (await page.locator('[role="dialog"]').count()) === 0);
  check("and the map is not darkened", (await page.locator('[data-slot="dialog-overlay"]').count()) === 0);
  const suggestionRows = suggestionPanel.locator(".suggestion-row");
  const suggestionCount = await suggestionRows.count();
  check("with suggestions for a map of loose stops", suggestionCount > 0, String(suggestionCount));
  await suggestionRows.first().hover();
  await page.waitForTimeout(300);
  const suggestionPreview = await page.evaluate(() => { const line = document.querySelector(".map-canvas .suggestion-preview"); return line ? { x1: +line.getAttribute("x1"), y1: +line.getAttribute("y1"), x2: +line.getAttribute("x2"), y2: +line.getAttribute("y2") } : null; });
  const previewEnds = suggestionPreview ? sixStops.filter((st) => (Math.abs(st.x - suggestionPreview.x1) < 1 && Math.abs(st.y - suggestionPreview.y1) < 1) || (Math.abs(st.x - suggestionPreview.x2) < 1 && Math.abs(st.y - suggestionPreview.y2) < 1)) : [];
  check("pointing at a suggestion draws it on the map, from stop to stop", suggestionPreview !== null && previewEnds.length === 2, JSON.stringify(suggestionPreview));
  await page.mouse.move(5, 5);
  await page.waitForTimeout(250);
  check("and the drawing goes when the pointer leaves", (await page.locator(".map-canvas .suggestion-preview").count()) === 0);
  const routesBefore = await page.evaluate(() => JSON.parse(localStorage.getItem("ttr-map")).routes.length);
  await suggestionRows.first().getByRole("button", { name: "Add" }).click();
  await page.waitForTimeout(400);
  check("Add puts the route on the map", (await page.evaluate(() => JSON.parse(localStorage.getItem("ttr-map")).routes.length)) === routesBefore + 1);
  check("and the panel stays open for the next one", (await suggestionPanel.count()) === 1);
  await suggestionPanel.getByRole("button", { name: "Done" }).click();
  await page.waitForTimeout(300);
  check("Done gives the column back to Properties", (await suggestionPanel.count()) === 0 && /Properties/.test(await page.locator(".panel-heading").last().textContent()));

  // 33i. the balance report sits in the right column and leaves traces on the map
  await page.getByRole("button", { name: "Help" }).click();
  await page.getByRole("menuitem", { name: "Getting started" }).click();
  await page.waitForTimeout(300);
  await page.getByRole("button", { name: "Load the example map" }).click();
  await page.waitForTimeout(300);
  // The map from the previous section has stops, so the editor asks before replacing it.
  await page.getByRole("alertdialog").getByRole("button", { name: "Continue" }).click();
  await page.waitForTimeout(700);
  await page.getByRole("button", { name: "Map balance", exact: true }).click();
  await page.waitForTimeout(700);
  const balancePanel = page.locator(".balance-panel");
  check("the balance report opens in the right column, not in a dialog", (await balancePanel.count()) === 1 && (await page.locator('[role="dialog"]').count()) === 0);
  check("the map is not darkened", (await page.locator('[data-slot="dialog-overlay"]').count()) === 0);
  const columnWidth = await page.evaluate(() => document.querySelector("aside.properties").getBoundingClientRect().width);
  check("and the column widens to hold its tables", columnWidth >= 380, `${Math.round(columnWidth)}px`);
  // The list scrolls inside its column, so the whole map stays in view beside it. Measured at the
  // suite's window and again in a small one, where the map has to shrink rather than be scrolled to.
  const frame = () => page.evaluate(() => {
    const box = (el) => { const r = el.getBoundingClientRect(); return { left: r.left, right: r.right, top: r.top, bottom: r.bottom, width: r.width }; };
    const aside = document.querySelector("aside.properties"), canvas = document.querySelector(".map-canvas"), wrap = document.querySelector(".map-wrap");
    return { page: document.documentElement.scrollHeight, win: innerHeight, winW: innerWidth, aside: box(aside), asideScroll: aside.scrollHeight, asideClient: aside.clientHeight, asideOverflow: getComputedStyle(aside).overflowY, canvas: box(canvas), wrap: box(wrap), wrapScroll: wrap.scrollWidth, wrapClient: wrap.clientWidth };
  });
  const wholeMapInView = (f) => f.canvas.top >= 0 && f.canvas.bottom <= f.win && f.canvas.left >= f.wrap.left - 1 && f.canvas.right <= f.aside.left + 1 && f.wrapScroll <= f.wrapClient + 1;
  const open = await frame();
  check("the page does not grow with the balance lists", open.page <= open.win + 1, `${open.page}px page in a ${open.win}px window`);
  check("the right column scrolls instead", open.asideOverflow === "auto" && open.asideScroll > open.asideClient, `${open.asideOverflow}, ${open.asideScroll}px of lists in ${open.asideClient}px`);
  check("and the whole map is in view beside it", wholeMapInView(open), JSON.stringify({ canvas: open.canvas, aside: open.aside.left, win: open.win }));
  await page.evaluate(() => { const a = document.querySelector("aside.properties"); a.scrollTop = a.scrollHeight; });
  await page.waitForTimeout(150);
  const scrolled = await frame();
  check("scrolling the list to its end leaves the map where it was", wholeMapInView(scrolled) && Math.abs(scrolled.canvas.top - open.canvas.top) < 1 && (await page.evaluate(() => document.querySelector("aside.properties").scrollTop)) > 0);
  await page.evaluate(() => { document.querySelector("aside.properties").scrollTop = 0; });
  await page.setViewportSize({ width: 1280, height: 760 });
  await page.waitForTimeout(250);
  const small = await frame();
  check("in a small window the map shrinks to stay whole beside the list", small.page <= small.win + 1 && wholeMapInView(small), JSON.stringify({ canvas: small.canvas, aside: small.aside.left, wrap: small.wrapScroll + "/" + small.wrapClient }));
  await page.setViewportSize({ width: 1500, height: 1000 });
  await page.waitForTimeout(250);
  // The column's left edge is a handle: dragged, nudged with the arrow keys, and reset by a double click.
  const handle = page.getByRole("separator", { name: "Resize the right column" });
  check("the column has a handle on its left edge", (await handle.count()) === 1);
  const widthAtStart = (await frame()).aside.width;
  const handleAt = await handle.boundingBox();
  await page.mouse.move(handleAt.x + handleAt.width / 2, handleAt.y + 200);
  await page.mouse.down();
  await page.mouse.move(handleAt.x + handleAt.width / 2 - 120, handleAt.y + 200, { steps: 6 });
  await page.mouse.up();
  await page.waitForTimeout(200);
  const dragged = await frame();
  check("dragging the handle left widens the column by as much", Math.abs(dragged.aside.width - (widthAtStart + 120)) <= 3, `${widthAtStart} → ${dragged.aside.width}`);
  check("and the whole map is still in view", wholeMapInView(dragged), JSON.stringify({ canvas: dragged.canvas, aside: dragged.aside.left }));
  await handle.focus();
  await page.keyboard.press("ArrowRight");
  await page.waitForTimeout(150);
  const nudged = (await frame()).aside.width;
  check("the arrow keys nudge it", nudged < dragged.aside.width - 5, `${dragged.aside.width} → ${nudged}`);
  const stored = await page.evaluate(() => localStorage.getItem("ttr-right-column-width"));
  check("the width is remembered", Number(stored) > 0, String(stored));
  await handle.dblclick();
  await page.waitForTimeout(150);
  check("a double click puts it back", Math.abs((await frame()).aside.width - widthAtStart) <= 3, `${(await frame()).aside.width} against ${widthAtStart}`);
  // Colour × length: a row of wagons per colour, and pointing at a number marks its routes on the map.
  {
    const table = balancePanel.locator(".analysis-section", { has: page.locator("h3", { hasText: "Colour × length" }) }).locator("table.analysis-table:not(.classic-table)");
    const stored = await page.evaluate(() => { const m = JSON.parse(localStorage.getItem("ttr-map")); const infra = new Set(m.routeTypeStyles.filter((x) => x.infrastructure).map((x) => x.id)); return m.routes.filter((r) => !infra.has(r.type)).map((r) => ({ length: r.length, color: r.color })); });
    const heads = (await table.locator("thead th").allTextContents()).map((t) => t.trim());
    const colourOf = (label) => (label === "Grey" ? "neutral" : label.toLowerCase());
    const colourLabels = heads.slice(1, -1);
    const wagonsRow = table.locator("tr.analysis-wagons-row");
    check("the table has a row of wagons for each colour", (await wagonsRow.count()) === 1 && /^Wagons/.test((await wagonsRow.locator("td").first().textContent()).trim()));
    const wagonCells = (await wagonsRow.locator("td").allTextContents()).slice(1).map((t) => Number(t.trim()));
    const expectedWagons = colourLabels.map((label) => stored.filter((r) => r.color === colourOf(label)).reduce((sum, r) => sum + r.length, 0));
    check("each is the colour's routes added up by length", JSON.stringify(wagonCells.slice(0, -1)) === JSON.stringify(expectedWagons), `${wagonCells.slice(0, -1)} against ${expectedWagons}`);
    check("and the last is every wagon space on the board", wagonCells.at(-1) === stored.reduce((sum, r) => sum + r.length, 0), `${wagonCells.at(-1)} against ${stored.reduce((sum, r) => sum + r.length, 0)}`);
    // Against the seven classic maps (USA, Nordic, India, Switzerland, Old West, Polska, Northern Lights):
    // the share of routes at each length, the share of grey ones, and how evenly the eight colours are
    // spread over the wagons. Ranges are the classic maps' lowest, median and highest.
    const classic = { 1: [9, 29, 35.2], 2: [23.9, 35, 50], 3: [15.7, 21, 25.5], 4: [5.9, 14, 16], 5: [0, 2, 10], 6: [0, 3, 9], grey: [11.8, 24, 44], spread: [1, 1.05, 1.12] };
    const eight = ["red", "blue", "green", "yellow", "black", "white", "orange", "purple"];
    const n = stored.length;
    const mine = { grey: 100 * stored.filter((r) => r.color === "neutral").length / n };
    for (const k of [1, 2, 3, 4, 5, 6]) mine[k] = 100 * stored.filter((r) => (k === 6 ? r.length >= 6 : r.length === k)).length / n;
    const perColour = eight.map((c) => stored.filter((r) => r.color === c).reduce((sum, r) => sum + r.length, 0));
    mine.spread = Math.max(...perColour) / (perColour.reduce((a, b) => a + b, 0) / 8);
    const verdictOf = (key) => (mine[key] < classic[key][0] ? "below" : mine[key] > classic[key][2] ? "above" : "within");
    const compare = await balancePanel.locator(".classic-compare").evaluate((root) => Array.from(root.querySelectorAll(".classic-row")).map((row) => ({ key: row.dataset.kind, this: parseFloat(row.querySelector(".classic-this").textContent), range: row.querySelector(".classic-range").textContent, verdict: row.querySelector(".classic-verdict").textContent.trim() })));
    check("the colour table is set against the classic maps in eight rows", compare.length === 8 && compare.map((r) => r.key).join() === "1,2,3,4,5,6,grey,spread", compare.map((r) => r.key).join());
    check("each shows this map's own figure", compare.every((r) => Math.abs(r.this - (r.key === "spread" ? mine.spread : mine[r.key])) < (r.key === "spread" ? 0.011 : 0.51)), JSON.stringify(compare.map((r) => r.this)) + " against " + JSON.stringify(mine));
    check("and the classic range beside it", compare.every((r) => r.range.includes(String(Math.round(classic[r.key][2] * (r.key === "spread" ? 100 : 1)) / (r.key === "spread" ? 100 : 1)))), JSON.stringify(compare.map((r) => r.range)));
    check("and says in a word whether it is within, below or above", compare.every((r) => r.verdict === verdictOf(r.key)), JSON.stringify(compare.map((r) => [r.key, r.verdict])) + " expected " + JSON.stringify(Object.keys(classic).map((k) => [k, verdictOf(k)])));
    check("with a sentence naming the maps it is set against", /USA/.test(await balancePanel.locator(".classic-compare").textContent()) && /Northern Lights/.test(await balancePanel.locator(".classic-compare").textContent()));
    // The first column only names a row, so it is as narrow as its words and the numbers get the room.
    const widths = await balancePanel.evaluate((root) => {
      const first = (sel) => { const th = root.querySelector(`${sel} thead th:first-child`); return th ? th.getBoundingClientRect().width : null; };
      const scroll = root.querySelector(".classic-table").closest(".analysis-table-scroll");
      return { colour: first("table.colour-table"), classic: first(".classic-table"), classicScrolls: scroll.scrollWidth > scroll.clientWidth + 1 };
    });
    check("in the colour table the first column is narrow", widths.colour !== null && widths.colour <= 64, `${widths.colour} px`);
    check("in the classic table too, and the table fits the column without scrolling", widths.classic !== null && widths.classic <= 100 && !widths.classicScrolls, `${widths.classic} px, scrolls: ${widths.classicScrolls}`);
    const marked = () => page.locator(".map-canvas .route-group.on-preview").count();
    // A cell with routes in it: its routes, and only those, are marked while it is pointed at.
    const body = table.locator("tbody tr:not(.analysis-total-row):not(.analysis-wagons-row)");
    let cell = null;
    for (let row = 0; row < await body.count() && !cell; row += 1) {
      const cells = await body.nth(row).locator("td").allTextContents();
      const col = cells.slice(1, -1).findIndex((t) => Number(t) > 0);
      if (col >= 0) cell = { row, col, length: Number(cells[0]), label: colourLabels[col], count: Number(cells[col + 1]) };
    }
    await body.nth(cell.row).locator("td").nth(cell.col + 1).hover();
    await page.waitForTimeout(200);
    const cellMarks = await markInfo("on-preview");
    check("the marked routes stand out from the rest", clearlyMarked(cellMarks), JSON.stringify(cellMarks));
    check("pointing at a count marks those routes on the map", (await marked()) === cell.count && cell.count === stored.filter((r) => r.length === cell.length && r.color === colourOf(cell.label)).length, `${await marked()} marked, ${cell.count} in ${cell.length} × ${cell.label}`);
    await body.nth(cell.row).locator("td").first().hover();
    await page.waitForTimeout(200);
    check("pointing at a length marks every route of that length", (await marked()) === stored.filter((r) => r.length === cell.length).length, `${await marked()}`);
    await wagonsRow.locator("td").nth(colourLabels.indexOf(cell.label) + 1).hover();
    await page.waitForTimeout(200);
    check("pointing at a colour's total marks every route of that colour", (await marked()) === stored.filter((r) => r.color === colourOf(cell.label)).length, `${await marked()}`);
    await table.locator("tr.analysis-total-row td").nth(colourLabels.indexOf(cell.label) + 1).hover();
    await page.waitForTimeout(200);
    check("and so does the count row above it", (await marked()) === stored.filter((r) => r.color === colourOf(cell.label)).length);
    await page.mouse.move(5, 5);
    await page.waitForTimeout(200);
    check("and the marks go when the pointer leaves", (await marked()) === 0);
  }
  const hubRow = balancePanel.locator(".analysis-section", { has: page.locator("h3", { hasText: "Hub degree" }) }).locator("tbody tr").first();
  const hubStop = (await hubRow.locator("td").first().textContent()).trim();
  await hubRow.hover();
  await page.waitForTimeout(250);
  const previewed = await page.evaluate(() => Array.from(document.querySelectorAll(".map-canvas .stop.previewed")).map((g) => g.textContent));
  check("pointing at a stop's row marks that stop on the map", previewed.length === 1 && previewed[0].includes(hubStop), `${hubStop}: ${previewed.join(", ")}`);
  // The mark has to be found at a glance on a busy map: a ring of its own, clear of the stop and its
  // routes, and thick enough to see. Measured on screen, where the map is scaled.
  const ring = await page.evaluate(() => {
    const g = document.querySelector(".map-canvas .stop.previewed");
    const ringEl = g && g.querySelector(".balance-ring");
    const dot = g && g.querySelector("circle:not(.stop-hit):not(.balance-ring)");
    if (!ringEl || !dot) return null;
    const ringBox = ringEl.getBoundingClientRect();
    const dotBox = dot.getBoundingClientRect();
    const scale = ringBox.width / (2 * +ringEl.getAttribute("r") + parseFloat(getComputedStyle(ringEl).strokeWidth));
    return { gapPx: (ringBox.width - dotBox.width) / 2, strokePx: parseFloat(getComputedStyle(ringEl).strokeWidth) * scale, stroke: getComputedStyle(ringEl).stroke, fill: getComputedStyle(ringEl).fill };
  });
  check("the stop pointed at gets a ring of its own", ring !== null);
  check("the ring stands clear of the stop and is thick enough to see", ring !== null && ring.gapPx >= 7 && ring.strokePx >= 3.5 && ring.fill === "none", JSON.stringify(ring));
  const roomRow = balancePanel.locator(".analysis-section", { has: page.locator("h3", { hasText: "Room per wagon" }) }).locator("tbody tr").first();
  await roomRow.hover();
  await page.waitForTimeout(250);
  check("pointing at a route's row marks that route", (await page.locator(".map-canvas .route-group.on-preview").count()) >= 1 && (await page.locator(".map-canvas .stop.previewed").count()) === 0);
  const crowdedRow = balancePanel.locator(".bottleneck-row").first();
  if (await crowdedRow.count()) {
    await crowdedRow.hover();
    await page.waitForTimeout(250);
    check("pointing at a crowded route marks it", (await page.locator(".map-canvas .route-group.on-preview").count()) >= 1);
    const crowdedMarks = await markInfo("on-preview");
    check("and marks it clearly", clearlyMarked(crowdedMarks), JSON.stringify(crowdedMarks));
  }
  await page.mouse.move(5, 5);
  await page.waitForTimeout(250);
  check("and the marks go when the pointer leaves", (await page.locator(".map-canvas .route-group.on-preview").count()) === 0 && (await page.locator(".map-canvas .stop.previewed").count()) === 0);
  // Help texts say what the controls do now: a click keeps a mark, a double click picks, and neither
  // names a dialog for what is a panel.
  {
    const text = await balancePanel.textContent();
    check("Map balance says a click keeps a row marked and a second click lets it go", /click[^.]*keep[^.]*marked/i.test(text) && /click again/i.test(text), text.slice(0, 160));
    check("and that a double click picks it for editing", /double-click/i.test(text));
    check("the rows no longer promise that one click selects", !/Pick a row to select/i.test(text));
    const hubHelp = await balancePanel.locator(".analysis-section", { has: page.locator("h3", { hasText: "Hub degree" }) }).locator(".helper").first().textContent();
    const roomHelp = await balancePanel.locator(".analysis-section", { has: page.locator("h3", { hasText: "Room per wagon" }) }).locator(".helper").first().textContent();
    check("Hub degree and Room per wagon explain click and double-click", /keep/i.test(hubHelp) && /double-click/i.test(hubHelp) && /keep/i.test(roomHelp) && /double-click/i.test(roomHelp), `${hubHelp.slice(0, 120)} | ${roomHelp.slice(0, 120)}`);
    check("the colour table says clicking keeps a number's routes marked", /click/i.test(await balancePanel.locator(".analysis-section", { has: page.locator("h3", { hasText: "Colour × length" }) }).locator(".helper").first().textContent()));
  }
  // A click pins what a row or number marks, so it stays on the map while the pointer is elsewhere; a
  // second click lets it go. A double click still picks the route or stop for editing.
  {
    const routesMarked = () => page.locator(".map-canvas .route-group.on-preview, .map-canvas .route-group.bottleneck").count();
    const away = async () => { await page.mouse.move(5, 5); await page.waitForTimeout(300); };
    // a route's row
    await roomRow.click();
    await away();
    check("a click on a route's row keeps it marked once the pointer has left", (await routesMarked()) >= 1 && (await roomRow.getAttribute("aria-pressed")) === "true" && (await balancePanel.count()) === 1);
    await roomRow.click();
    await away();
    check("and a second click lets it go", (await routesMarked()) === 0 && (await roomRow.getAttribute("aria-pressed")) === "false");
    // a stop's row: its ring
    const stopRow = balancePanel.locator(".analysis-section", { has: page.locator("h3", { hasText: "Hub degree" }) }).locator("tbody tr").first();
    await stopRow.click();
    await away();
    check("the same goes for a stop's ring", (await page.locator(".map-canvas .stop.previewed").count()) === 1 && (await stopRow.getAttribute("aria-pressed")) === "true");
    await stopRow.click();
    await away();
    check("and releasing it", (await page.locator(".map-canvas .stop.previewed").count()) === 0);
    // a number in the colour table
    const colourCell = balancePanel.locator("table.colour-table tbody tr").first().locator("td").nth(1);
    await colourCell.click();
    await away();
    check("and for a number in the colour table", (await routesMarked()) >= 1);
    await colourCell.click();
    await away();
    check("released by a second click", (await routesMarked()) === 0);
    // pinning one thing and then another moves the mark
    await roomRow.click();
    await balancePanel.locator("table.colour-table tbody tr").first().locator("td").nth(1).click();
    await away();
    const pinnedCount = await routesMarked();
    check("pinning a second thing moves the mark instead of adding to it", (await roomRow.getAttribute("aria-pressed")) === "false" && pinnedCount >= 1);
    await balancePanel.locator("table.colour-table tbody tr").first().locator("td").nth(1).click();
    await away();
    // a crowded route
    if (await crowdedRow.count()) {
      await crowdedRow.click();
      await away();
      check("a crowded route stays marked after a click", (await routesMarked()) >= 1);
      await crowdedRow.click();
      await away();
      check("and a second click lets it go", (await routesMarked()) === 0);
    }
    // a double click picks the route for editing, as a click used to
    await roomRow.dblclick();
    await page.waitForTimeout(400);
    check("a double click on a route's row picks it for editing and hands the column back", (await balancePanel.count()) === 0 && (await page.locator(".route-group.selected").count()) === 1);
    await page.getByRole("button", { name: "Map balance", exact: true }).click();
    await page.waitForTimeout(500);
    check("and nothing stays pinned when Map balance is opened again", (await routesMarked()) === 0);
  }
  await balancePanel.getByRole("button", { name: "Done" }).click();
  await page.waitForTimeout(300);
  check("Done gives the column back to Properties", (await balancePanel.count()) === 0 && /Properties/.test(await page.locator(".panel-heading").last().textContent()));
  await page.getByRole("button", { name: "Map balance", exact: true }).click();
  await page.waitForTimeout(400);
  await page.keyboard.press("Escape");
  await page.waitForTimeout(300);
  check("and Escape closes it too", (await balancePanel.count()) === 0);

  // 33b. rules text: written in markdown beside the map, previewed with live references, saved in
  // the map, and printed on pages of their own after the board when asked
  {
    const mapKey = "ttr-map";
    await page.evaluate(() => { localStorage.removeItem("ttr-print-rules"); localStorage.removeItem("ttr-print-parts"); });
    const first = await page.evaluate((key) => { const m = JSON.parse(localStorage.getItem(key)); const r = m.routes[0]; const name = (id) => m.stops.find((st) => st.id === id).name; const isJunction = (st) => Boolean((m.stopTypeStyles.find((t) => t.id === st.type) || {}).junction);
      const near = new Set(m.routes.filter((x) => x.a === r.a || x.b === r.a).map((x) => (x.a === r.a ? x.b : x.a)));
      const stranger = m.stops.find((st) => st.id !== r.a && !near.has(st.id) && !isJunction(st));
      return { a: name(r.a), b: name(r.b), color: r.color, neighbours: [...near].map(name).sort((p, q) => p.localeCompare(q)), stranger: stranger.name, stops: m.stops.length }; }, mapKey);
    const rulesButton = page.getByRole("button", { name: "Rules", exact: true });
    await rulesButton.click();
    await page.waitForTimeout(400);
    const panel = page.locator("aside.properties .rules-panel");
    check("Rules opens in the right column, not in a dialog", (await panel.count()) === 1 && (await page.locator('[role="dialog"]').count()) === 0);
    const inView = await page.evaluate(() => { const c = document.querySelector(".map-canvas").getBoundingClientRect(), a = document.querySelector("aside.properties").getBoundingClientRect(); return c.top >= 0 && c.bottom <= innerHeight && c.right <= a.left + 1 && document.documentElement.scrollHeight <= innerHeight + 1; });
    check("with the whole map in view beside it", inView);
    const box = panel.getByRole("textbox", { name: "Rules text" });
    check("a text area takes the rules", (await box.count()) === 1);
    check("it says a stop or a route can be picked by clicking on the map", /clicking the stops on the map/i.test(await panel.textContent()));
    check("which says it is markdown and how to name a stop or a route", /markdown/i.test(await panel.textContent()) && /\[\[/.test(await panel.textContent()));
    // The example map comes with rules of its own: standard rules except where it says otherwise, with a
    // stop and a route named so the preview shows them, and XXX where the rule is still to be written.
    const exampleText = await panel.getByRole("textbox", { name: "Rules text" }).inputValue();
    const examplePreview = panel.locator(".rules-preview");
    check("the example map has example rules", /standard/i.test(exampleText) && /Ticket to Ride/.test(exampleText) && (await examplePreview.locator("h1").count()) === 1, exampleText.slice(0, 120));
    check("they say the map follows the standard rules, except where they say otherwise", /follows the standard[^.]*except/i.test(await examplePreview.textContent()));
    check("with a stop and a route named, drawn in the preview", (await examplePreview.locator(".rule-ref.stop").count()) >= 1 && (await examplePreview.locator(".rule-ref.route").count()) >= 1);
    check("and every name in them is on the map", (await examplePreview.locator(".rule-ref.missing").count()) === 0);
    // The standard points for a claimed route, by its length, as the standard rules list them, with
    // every route on the example map covered.
    const pointsTable = await examplePreview.locator("table").filter({ hasText: /points/i }).first().evaluate((t) => Array.from(t.querySelectorAll("tbody tr")).map((tr) => Array.from(tr.cells).map((c) => c.textContent.trim()))).catch(() => []);
    const standardPoints = [["1", "1"], ["2", "2"], ["3", "4"], ["4", "7"], ["5", "10"], ["6", "15"], ["7", "18"], ["8", "21"]];
    check("the rules list the standard points for each length of claimed route", JSON.stringify(pointsTable) === JSON.stringify(standardPoints), JSON.stringify(pointsTable));
    const longestRoute = await page.evaluate(() => Math.max(...JSON.parse(localStorage.getItem("ttr-map")).routes.map((r) => r.length)));
    check("and the list covers the longest route on the map", longestRoute <= 8, String(longestRoute));
    check("with XXX where a rule is still to be written", (await examplePreview.locator("li").filter({ hasText: "XXX" }).count()) >= 2);
    // A link to a neutral page that explains markdown
    const help = panel.getByRole("link", { name: /markdown/i });
    check("a link to a neutral page explaining markdown", (await help.count()) === 1 && /^https:\/\/commonmark\.org\//.test(await help.getAttribute("href")) && (await help.getAttribute("target")) === "_blank" && /noopener/.test(await help.getAttribute("rel")), String(await help.getAttribute("href")));
    const written = `# House rules\n\nClaim **routes** by colouring in their spaces.\n\n- Start at [[${first.a}]]\n- Cross [[${first.a}–${first.b}]]\n- Never visit [[Atlantis]]\n\n| Players | Wagons |\n| --- | --- |\n| 2 | 45 |\n\n<b>raw</b> html stays text`;
    await box.fill(written);
    await page.waitForTimeout(400);
    const preview = panel.locator(".rules-preview");
    check("the preview shows a heading, bold text, a list and a table", (await preview.locator("h1").textContent()) === "House rules" && (await preview.locator("strong").first().textContent()) === "routes" && (await preview.locator("li").count()) === 3 && (await preview.locator("td").count()) === 2 && (await preview.locator("th").count()) === 2);
    check("lists show their bullets, as they must to read as lists", (await preview.locator("ul").first().evaluate((el) => getComputedStyle(el).listStyleType)) === "disc");
    check("and shows typed HTML as text, not as markup", (await preview.locator("b").count()) === 0 && /<b>raw<\/b> html stays text/.test(await preview.textContent()));
    check("a stop is named with its own symbol", (await preview.locator(".rule-ref.stop").count()) === 1 && (await preview.locator(".rule-ref.stop svg").count()) === 1);
    check("a route is named with its colour", (await preview.locator(".rule-ref.route").count()) === 1);
    // The swatch is the route's own colour: the one its line is drawn in on the map.
    const colours = await page.evaluate(() => {
      const asRgb = (c) => { const probe = document.createElement("span"); document.body.append(probe); probe.style.color = c; const out = getComputedStyle(probe).color; probe.remove(); return out; };
      const swatch = document.querySelector(".rules-preview .rule-ref.route .rule-swatch");
      const line = document.querySelector(".map-canvas .route-group .route-guide");
      return { swatch: asRgb(getComputedStyle(swatch).backgroundColor), line: asRgb(line.getAttribute("stroke")) };
    });
    check("a route's swatch is the colour its line has on the map", colours.swatch === colours.line, JSON.stringify(colours));
    check("a name that is no stop is marked as missing, in the editor", (await preview.locator(".rule-ref.missing").count()) === 1 && /no stop|not found|no such/i.test((await preview.locator(".rule-ref.missing").getAttribute("title")) || ""));
    // The toolbar: buttons that write the markdown for you, and pickers for a stop and a route
    const toolbar = panel.getByRole("toolbar", { name: "Format the rules" });
    check("a toolbar with the formatting buttons", (await toolbar.count()) === 1 && (await Promise.all(["Bold", "Italic", "Heading", "Bulleted list", "Numbered list", "Quote", "Table", "Line"].map((n) => toolbar.getByRole("button", { name: n, exact: true }).count()))).every((n) => n === 1));
    check("a picker for a stop, two for a route (from, then to), and a button for each to pick on the map", (await toolbar.getByRole("combobox", { name: "Insert a stop" }).count()) === 1 && (await toolbar.getByRole("combobox", { name: "Route from" }).count()) === 1 && (await toolbar.getByRole("combobox", { name: "Route to" }).count()) === 1 && (await toolbar.getByRole("button", { name: "Pick a stop on the map" }).count()) === 1 && (await toolbar.getByRole("button", { name: "Pick a route on the map" }).count()) === 1);
    const setText = async (text, from, to) => { await box.fill(text); await box.evaluate((el, [a, b]) => { el.focus(); el.setSelectionRange(a, b); }, [from ?? text.length, to ?? from ?? text.length]); };
    const value = () => box.inputValue();
    await setText("hello world", 6, 11);
    await toolbar.getByRole("button", { name: "Bold", exact: true }).click();
    check("Bold wraps the selected words", (await value()) === "hello **world**", await value());
    check("and keeps them selected, so the next click undoes it", (await box.evaluate((el) => el.value.slice(el.selectionStart, el.selectionEnd))) === "world");
    await toolbar.getByRole("button", { name: "Bold", exact: true }).click();
    check("a second click takes the bold off again", (await value()) === "hello world", await value());
    await setText("a b", 3, 3);
    await toolbar.getByRole("button", { name: "Italic", exact: true }).click();
    check("with nothing selected, Italic leaves a word to type over", (await value()) === "a b*text*" && (await box.evaluate((el) => el.value.slice(el.selectionStart, el.selectionEnd))) === "text", await value());
    await setText("hello world", 0, 5);
    await box.press("ControlOrMeta+b");
    check("Ctrl or Cmd+B does the same as the button", (await value()) === "**hello** world", await value());
    await setText("Title", 2, 2);
    const heading = toolbar.getByRole("button", { name: "Heading", exact: true });
    const seen = [];
    for (let n = 0; n < 4; n += 1) { await heading.click(); seen.push(await value()); }
    check("Heading goes through #, ## and ### and back to none", JSON.stringify(seen) === JSON.stringify(["# Title", "## Title", "### Title", "Title"]), JSON.stringify(seen));
    await setText("one\ntwo\nthree", 0, 13);
    await toolbar.getByRole("button", { name: "Bulleted list", exact: true }).click();
    check("Bulleted list marks every selected line", (await value()) === "- one\n- two\n- three", JSON.stringify(await value()));
    await toolbar.getByRole("button", { name: "Bulleted list", exact: true }).click();
    check("and a second click takes the bullets off", (await value()) === "one\ntwo\nthree", JSON.stringify(await value()));
    await box.evaluate((el) => { el.setSelectionRange(0, el.value.length); });
    await toolbar.getByRole("button", { name: "Numbered list", exact: true }).click();
    check("Numbered list counts the lines", (await value()) === "1. one\n2. two\n3. three", JSON.stringify(await value()));
    await box.evaluate((el) => { el.setSelectionRange(0, el.value.length); });
    await toolbar.getByRole("button", { name: "Numbered list", exact: true }).click();
    await setText("quoted", 0, 6);
    await toolbar.getByRole("button", { name: "Quote", exact: true }).click();
    check("Quote puts > before the line", (await value()) === "> quoted", await value());
    await setText("", 0, 0);
    await toolbar.getByRole("button", { name: "Table", exact: true }).click();
    await page.waitForTimeout(200);
    check("Table writes a table to fill in, and the preview draws it", /\| Column \| Column \|\n\| --- \| --- \|/.test(await value()) && (await preview.locator("th").count()) === 2, JSON.stringify(await value()));
    await setText("above", 5, 5);
    await toolbar.getByRole("button", { name: "Line", exact: true }).click();
    check("Line writes a line across on its own", /above\n\n---\n/.test(await value()), JSON.stringify(await value()));
    // the pickers write the references
    await setText("Start at ", 9, 9);
    await toolbar.getByRole("combobox", { name: "Insert a stop" }).selectOption({ label: first.a });
    check("the stop picker writes [[Stop]] where the cursor was", (await value()) === `Start at [[${first.a}]]`, await value());
    await page.waitForTimeout(200);
    check("which the preview draws as that stop", (await preview.locator(".rule-ref.stop").count()) === 1);
    await setText("Take ", 5, 5);
    const routeTo = toolbar.getByRole("combobox", { name: "Route to" });
    check("the second picker waits for the first", await routeTo.isDisabled());
    await toolbar.getByRole("combobox", { name: "Route from" }).selectOption({ label: first.a });
    const toOptions = (await routeTo.locator("option").allTextContents()).slice(1);
    check("and then offers only the stops that route leads to, not all of them", JSON.stringify(toOptions) === JSON.stringify(first.neighbours) && toOptions.length < first.stops - 1, `${toOptions.length} of ${first.stops}`);
    await routeTo.selectOption({ label: first.b });
    check("the two pickers write [[Stop–Stop]]", (await value()).startsWith(`Take [[${first.a}–${first.b}]]`), await value());
    await page.waitForTimeout(200);
    check("which the preview draws as that route", (await preview.locator(".rule-ref.route").count()) === 1);
    check("the pickers go back to their label, ready for the next", (await toolbar.getByRole("combobox", { name: "Insert a stop" }).inputValue()) === "" && (await toolbar.getByRole("combobox", { name: "Route from" }).inputValue()) === "" && (await routeTo.isDisabled()));
    // Picking on the map, for a stop and for a route: the map is clicked instead of a list read
    const mapStop = (name) => page.locator(".map-canvas g.stop", { hasText: name }).locator("circle").nth(1);
    const note = panel.getByRole("status");
    await setText("Go to ", 6, 6);
    await toolbar.getByRole("button", { name: "Pick a stop on the map" }).click();
    check("Pick a stop says to click one on the map", /click a stop on the map/i.test(await note.textContent()));
    await mapStop(first.a).click();
    await page.waitForTimeout(200);
    check("a click on a stop writes it where the cursor was, and the picking ends", (await value()) === `Go to [[${first.a}]]` && (await note.count()) === 0, await value());
    check("without selecting the stop for editing", (await page.locator(".map-canvas .stop.active").count()) === 0);
    await setText("Use ", 4, 4);
    await toolbar.getByRole("button", { name: "Pick a route on the map" }).click();
    check("Pick a route asks for the first stop", /first stop/i.test(await note.textContent()));
    await mapStop(first.a).click();
    await page.waitForTimeout(200);
    check("and rings it, then asks for the second", /second stop/i.test(await note.textContent()) && (await page.locator(".map-canvas .stop.previewed").count()) === 1);
    await mapStop(first.stranger).click();
    await page.waitForTimeout(200);
    check("a second stop with no route to the first is refused, and says so, and the picking goes on", /no route/i.test(await note.textContent()) && (await value()) === "Use ");
    await mapStop(first.b).click();
    await page.waitForTimeout(200);
    check("a second stop with a route writes [[Stop–Stop]], and the picking ends", (await value()) === `Use [[${first.a}–${first.b}]]` && (await note.count()) === 0 && (await page.locator(".map-canvas .stop.previewed").count()) === 0, await value());
    await setText("Keep ", 5, 5);
    await toolbar.getByRole("button", { name: "Pick a stop on the map" }).click();
    await page.evaluate(() => document.activeElement && document.activeElement.blur());
    await page.keyboard.press("Escape");
    await page.waitForTimeout(250);
    check("Escape ends the picking and writes nothing, and the panel stays", (await note.count()) === 0 && (await value()) === "Keep " && (await page.locator(".rules-panel").count()) === 1);
    await box.fill(written);
    await page.waitForTimeout(300);
    // pointing at a reference shows it on the map
    await preview.locator(".rule-ref.stop").first().hover();
    await page.waitForTimeout(250);
    check("pointing at a stop in the rules rings it on the map", (await page.locator(".map-canvas .stop.previewed").count()) === 1);
    await preview.locator(".rule-ref.route").first().hover();
    await page.waitForTimeout(250);
    check("and at a route marks it", (await page.locator(".map-canvas .route-group.on-preview").count()) >= 1 && (await page.locator(".map-canvas .stop.previewed").count()) === 0);
    await page.mouse.move(5, 5);
    await page.waitForTimeout(250);
    check("and the marks go when the pointer leaves", (await page.locator(".map-canvas .route-group.on-preview").count()) === 0);
    // kept in the map
    await page.waitForTimeout(1200);
    check("the text is kept in the map", (await page.evaluate((key) => JSON.parse(localStorage.getItem(key)).rules, mapKey)) === written);
    await page.reload({ waitUntil: "networkidle" });
    await page.waitForTimeout(700);
    await rulesButton.click();
    await page.waitForTimeout(400);
    check("and survives a reload", (await panel.getByRole("textbox", { name: "Rules text" }).inputValue()) === written);
    // exported with the map
    const rulesDownload = page.waitForEvent("download");
    await page.getByRole("button", { name: "Export", exact: true }).click();
    await page.waitForTimeout(250);
    await page.getByRole("menuitem", { name: "Full map" }).click();
    const rulesFile = path.join(os.tmpdir(), `ttr-rules-${Date.now()}.json`);
    await (await rulesDownload).saveAs(rulesFile);
    check("a full export carries the rules", JSON.parse(fs.readFileSync(rulesFile, "utf8")).payload.rules === written);
    fs.rmSync(rulesFile, { force: true });
    // one panel at a time, and Escape
    await ticketsButton.click();
    await page.waitForTimeout(300);
    check("opening Tickets takes the column from Rules", (await page.locator(".rules-panel").count()) === 0 && (await page.locator(".tickets-panel").count()) === 1);
    await rulesButton.click();
    await page.waitForTimeout(300);
    check("and Rules takes it back, with the text as it was", (await page.locator(".tickets-panel").count()) === 0 && (await panel.getByRole("textbox", { name: "Rules text" }).inputValue()) === written);
    await page.evaluate(() => document.activeElement && document.activeElement.blur());
    await page.keyboard.press("Escape");
    await page.waitForTimeout(300);
    check("Escape closes Rules once the text area has let go of the key", (await page.locator(".rules-panel").count()) === 0);
    // printing: what to print is ticked in the print dialog: the board, the tickets, the rules
    await printButton().click();
    await page.waitForTimeout(400);
    check("the print dialog asks what to print with three tick boxes: the board, the tickets and the rules", (await Promise.all(["Print the board", "Print the tickets", "Print the rules"].map((n) => printPart(n).count()))).every((n) => n === 1));
    check("the board and the rules are ticked at first, and the tickets are not", (await printPart("Print the board").isChecked()) && (await printPart("Print the rules").isChecked()) && !(await printPart("Print the tickets").isChecked()));
    await choosePrintParts(true, false, false);
    await printDialog().getByRole("button", { name: "Cancel" }).click();
    await page.waitForTimeout(300);
    const pagesOf = async () => { await page.emulateMedia({ media: "print" }); const pdf = await pdfOf(page, { format: "A4", printBackground: true }); await page.emulateMedia({ media: "screen" }); return (pdf.toString("latin1").match(/\/Type\s*\/Page[^s]/g) || []).length; };
    const tree = () => page.evaluate(() => { const root = document.querySelector(".print-pages"); return { order: Array.from(root.children).map((el) => (el.matches("style") ? "style" : el.classList.contains("print-page") ? "board" : el.classList.contains("print-tickets") ? "tickets" : el.classList.contains("print-rules") ? "rules" : "other")).filter((x, i, all) => x !== "style" && x !== all[i - 1]), boards: document.querySelectorAll(".print-pages .print-page").length, cards: document.querySelectorAll(".print-pages .ticket-card").length, rules: document.querySelectorAll(".print-pages .print-rules").length, text: (document.querySelector(".print-pages .print-rules") || { textContent: "" }).textContent, missing: document.querySelectorAll(".print-pages .print-rules .missing").length, style: Array.from(document.querySelectorAll(".print-pages style")).map((el) => el.textContent).join(" ") }; });
    const run = async (board, tickets, rules) => { await printButton().click(); await page.waitForTimeout(350); await choosePrintParts(board, tickets, rules); await printDialog().getByRole("button", { name: "Cancel" }).click(); await page.waitForTimeout(300); };
    const deckSize = await page.evaluate(() => { const m = JSON.parse(localStorage.getItem("ttr-map")); const first = m.ticketSets[0].id; const active = (m.ticketSets.find((x) => x.label === document.querySelector("#ticket-set")?.selectedOptions?.[0]?.textContent?.replace(/ \(\d+\)$/, "")) || m.ticketSets[0]).id; return m.tickets.filter((t) => (t.set ?? first) === active).length; });
    // each part on its own
    const pagesBoard = await pagesOf();
    check("with the board only, the print tree has board pages and nothing else", JSON.stringify((await tree()).order) === JSON.stringify(["board"]), JSON.stringify(await tree()).slice(0, 120));
    await run(false, true, false);
    const t1 = await tree();
    check("with the tickets only, the tree holds one card for each ticket of the deck and no board", JSON.stringify(t1.order) === JSON.stringify(["tickets"]) && t1.boards === 0 && t1.cards === deckSize && deckSize > 0, JSON.stringify([t1.order, t1.boards, t1.cards, deckSize]));
    const pagesTickets = await pagesOf();
    await run(false, false, true);
    const t2 = await tree();
    check("with the rules only, the tree holds the rules and nothing else", JSON.stringify(t2.order) === JSON.stringify(["rules"]) && t2.rules === 1 && /House rules/.test(t2.text), JSON.stringify(t2.order));
    check("a reference to something that is not there prints as its plain name, unmarked", t2.missing === 0 && /Atlantis/.test(t2.text));
    check("on upright A4 with its margin", /size:\s*210mm 297mm/.test(t2.style), t2.style);
    const pagesRules = await pagesOf();
    check("these rules take one page, and the cards at least one", pagesRules === 1 && pagesTickets >= 1, `${pagesBoard} board, ${pagesTickets} tickets, ${pagesRules} rules`);
    await run(true, true, true);
    const t3 = await tree();
    check("with all three, the board comes first, then the tickets, then the rules", JSON.stringify(t3.order) === JSON.stringify(["board", "tickets", "rules"]), JSON.stringify(t3.order));
    const pagesAll = await pagesOf();
    check("and the pages are the sum of the three on their own, each part on pages of its own", pagesAll === pagesBoard + pagesTickets + pagesRules, `${pagesAll} against ${pagesBoard} + ${pagesTickets} + ${pagesRules}`);
    await run(true, false, true);
    const t4 = await tree();
    await page.emulateMedia({ media: "print" });
    const printedBullets = await page.locator(".print-pages .print-rules ul").first().evaluate((el) => getComputedStyle(el).listStyleType);
    await page.emulateMedia({ media: "screen" });
    check("with the board and the rules, the rules come after the last board page, with their bullets", JSON.stringify(t4.order) === JSON.stringify(["board", "rules"]) && printedBullets === "disc", JSON.stringify(t4.order) + " " + printedBullets);
    check("and the pages are the board's plus the rules'", (await pagesOf()) === pagesBoard + pagesRules);
    // the dialog follows what is ticked
    await printButton().click();
    await page.waitForTimeout(400);
    check("with the board ticked, the sheet table and the box for one big page are there, and no paper to choose apart from it", (await printDialog().locator(".print-table").count()) === 1 && (await bigPageBox(printDialog()).count()) === 1 && (await printDialog().locator('input[name="print-paper"]').count()) === 0);
    await choosePrintParts(false, true, true);
    check("without the board the table and the big page go, and a paper to choose takes their place", (await bigPageBox(printDialog()).count()) === 0 && (await printDialog().locator(".print-table").count()) === 0 && (await printDialog().locator('input[name="print-paper"]').count()) === 4);
    check("the tickets' note says how many cards there are", new RegExp(`${deckSize} ticket`).test(await printDialog().locator("#print-tickets-note").textContent()));
    await choosePrintParts(false, false, false);
    check("with nothing ticked there is nothing to print, and the dialog says so", (await printDialog().getByRole("button", { name: "Print", exact: true }).isDisabled()) && /tick at least one/i.test(await printDialog().textContent()));
    await choosePrintParts(false, true, true);
    await printDialog().getByRole("button", { name: "Cancel" }).click();
    await page.waitForTimeout(300);
    // the paper chosen sets the page for everything
    await printButton().click();
    await page.waitForTimeout(400);
    await pickPaper(printDialog(), "a3");
    await printDialog().getByRole("button", { name: "Cancel" }).click();
    await page.waitForTimeout(300);
    check("the paper chosen sets the page the cards and the rules print on", /size:\s*297mm 420mm/.test((await tree()).style));
    await printButton().click();
    await page.waitForTimeout(400);
    await pickPaper(printDialog(), "a4");
    // the whole board on one page the size of the board: for a large-format printer, or to save as a PDF
    await choosePrintParts(true, false, false);
    const onePage = bigPageBox(printDialog());
    check("the board can go on one big page as big as the board", (await onePage.count()) === 1);
    await onePage.check();
    const pageNote = await printDialog().locator(".print-page-note").textContent();
    check("the dialog says how big the page is", /810 × 553 mm/.test(pageNote), pageNote);
    check("and that it is for a large-format printer or a PDF", /large-format|PDF/i.test(await printDialog().textContent()));
    check("the paper no longer matters, so it is not asked for, and the table of sheets steps aside", (await printDialog().locator('input[name="print-paper"]').count()) === 0 && (await printDialog().locator(".print-table").count()) === 0);
    check("the tickets and the rules cannot join it, and the dialog says they print apart", (await printPart("Print the tickets").isDisabled()) && (await printPart("Print the rules").isDisabled()) && /print(ed)? (them )?separately|apart/i.test(await printDialog().textContent()));
    // Without the board in the run the big page means nothing: the paper is asked for, and the tickets and the rules
    // can be ticked (found in the 1.0 review: the dialog was a dead end there).
    await printPart("Print the board").uncheck();
    await page.waitForTimeout(200);
    const wasTickets = await printPart("Print the tickets").isChecked();
    const rulesWritten = await page.evaluate(() => Boolean((JSON.parse(localStorage.getItem("ttr-map")).rules || "").trim()));
    if (deckSize > 0 && !wasTickets) await printPart("Print the tickets").check();
    check("with the board taken out, a paper is asked for and the tickets and the rules can be ticked, whatever the big page was", (await printDialog().locator('input[name="print-paper"]').count()) === 4 && (deckSize === 0 || (await printPart("Print the tickets").isEnabled())) && (!rulesWritten || (await printPart("Print the rules").isEnabled())) && (deckSize === 0 || !/Nothing is ticked/.test(await printDialog().textContent())));
    if (deckSize > 0) {
      // And the run itself: split still "page", board out, the tickets ticked: the cards print, on a page of the paper.
      await page.evaluate(() => { window.__bigRun = null; window.print = () => { const root = document.querySelector(".print-pages"); window.__bigRun = { cards: root.querySelectorAll(".ticket-card").length, boards: root.querySelectorAll(".print-board, .print-page > svg.print-sheet").length, style: [...root.querySelectorAll("style")].map((e) => e.textContent).join(" ") }; }; });
      await printDialog().getByRole("button", { name: "Print", exact: true }).click();
      await page.waitForFunction(() => window.__bigRun !== null, null, { timeout: 5000 });
      const bigRun = await page.evaluate(() => window.__bigRun);
      check("with the board out and the big page still chosen, the cards print on pages of the paper, not on one the size of the board", bigRun.cards === deckSize && !/810mm|790mm/.test(bigRun.style) && /size:\s*\d+mm \d+mm/.test(bigRun.style), JSON.stringify({ cards: bigRun.cards, deckSize, style: bigRun.style.slice(0, 80) }));
      await page.waitForTimeout(400);
      await printButton().click();
      await page.waitForTimeout(400);
    }
    if (deckSize > 0 && !wasTickets) await printPart("Print the tickets").uncheck();
    check("and only one foot note speaks of the page", (await printDialog().locator(".print-dialog-foot").count()) === 1);
    await printPart("Print the board").check();
    await page.waitForTimeout(200);
    await onePage.uncheck();
    await page.waitForTimeout(200);
    check("taking the big page away brings the table back, on one sheet of A4 as at first", (await printDialog().locator(".print-table").count()) === 1 && (await splitIs(printDialog(), "sheet")) && (await paperIs(printDialog(), "a4")));
    await onePage.check();
    await page.waitForTimeout(200);
    await printDialog().getByRole("button", { name: "Cancel" }).click();
    await page.waitForTimeout(300);
    const wholeBoard = await page.evaluate(() => ({ pages: document.querySelectorAll(".print-pages .print-page").length, cards: document.querySelectorAll(".print-pages .ticket-card").length, rules: document.querySelectorAll(".print-pages .print-rules").length, style: Array.from(document.querySelectorAll(".print-pages style")).map((el) => el.textContent).join(" ") }));
    check("the print tree is one page of the board, with no cards and no rules", wholeBoard.pages === 1 && wholeBoard.cards === 0 && wholeBoard.rules === 0, JSON.stringify({ pages: wholeBoard.pages, cards: wholeBoard.cards, rules: wholeBoard.rules }));
    check("on a page declared as 810 × 553 mm", /size:\s*810mm 553mm/.test(wholeBoard.style), wholeBoard.style);
    await page.emulateMedia({ media: "print" });
    const sheetBox = await page.evaluate(() => { const r = document.querySelector(".print-pages .print-page").getBoundingClientRect(); return { w: r.width / 96 * 25.4, h: r.height / 96 * 25.4 }; });
    const pdfWhole = await pdfOf(page, { preferCSSPageSize: true, printBackground: true });
    await page.emulateMedia({ media: "screen" });
    const pdfText = pdfWhole.toString("latin1");
    const mediaBox = /\/MediaBox\s*\[\s*0\s+0\s+([\d.]+)\s+([\d.]+)\s*\]/.exec(pdfText);
    const pts = (mm) => mm / 25.4 * 72;
    check("the board is laid out upright and at its real size on the page: 790 × 533 mm with its caption", Math.abs(sheetBox.w - 790) < 2 && Math.abs(sheetBox.h - 533) < 2, `${sheetBox.w.toFixed(1)} × ${sheetBox.h.toFixed(1)} mm`);
    check("saved as a PDF it is a single page", (pdfText.match(/\/Type\s*\/Page[^s]/g) || []).length === 1);
    check("and that page is 810 × 553 mm, the size of the board and its margin (read from the PDF itself)", Boolean(mediaBox) && Math.abs(Number(mediaBox[1]) - pts(810)) < 3 && Math.abs(Number(mediaBox[2]) - pts(553)) < 3, mediaBox ? `${mediaBox[1]} × ${mediaBox[2]} pt, wanted ${pts(810).toFixed(0)} × ${pts(553).toFixed(0)}` : "no MediaBox found");
    await printButton().click();
    await page.waitForTimeout(400);
    await pickSplit(printDialog(), "panel");
    await choosePrintParts(false, true, true);
    await page.evaluate(() => { window.__run = null; window.print = () => { window.__run = { cards: document.querySelectorAll(".print-pages .ticket-card").length, rules: document.querySelectorAll(".print-pages .print-rules").length, boards: document.querySelectorAll(".print-pages .print-page").length, dialogs: document.querySelectorAll('[role="dialog"]').length }; }; });
    await printDialog().getByRole("button", { name: "Print", exact: true }).click();
    await page.waitForFunction(() => window.__run !== null, null, { timeout: 5000 });
    const reached = await page.evaluate(() => window.__run);
    check("when Print is pressed, the cards and the rules reach the printer, and no board, after the dialog has gone", reached.cards === deckSize && reached.rules === 1 && reached.boards === 0 && reached.dialogs === 0, JSON.stringify(reached));
    // remembered, and choices an earlier build wrote still mean what they meant
    const rememberedParts = await page.evaluate(() => JSON.parse(localStorage.getItem("ttr-print-parts")));
    check("the choice is remembered", Boolean(rememberedParts) && rememberedParts.board === false && rememberedParts.tickets === true && rememberedParts.rules === true, JSON.stringify(rememberedParts));
    const ticked = async () => { await printButton().click(); await page.waitForTimeout(400); const state = [await printPart("Print the board").isChecked(), await printPart("Print the tickets").isChecked(), await printPart("Print the rules").isChecked()]; await printDialog().getByRole("button", { name: "Cancel" }).click(); await page.waitForTimeout(250); return state; };
    await page.reload({ waitUntil: "networkidle" });
    await page.waitForTimeout(600);
    check("it survives a reload", JSON.stringify(await ticked()) === JSON.stringify([false, true, true]));
    for (const [old, want] of [["off", [true, false, false]], ["board", [true, false, false]], ["on", [true, false, true]], ["both", [true, false, true]], ["rules", [false, false, true]]]) {
      await page.evaluate((value) => { localStorage.removeItem("ttr-print-parts"); localStorage.setItem("ttr-print-rules", value); }, old);
      await page.reload({ waitUntil: "networkidle" });
      await page.waitForTimeout(500);
      check(`a choice an earlier build stored as '${old}' means ${want.map((w, i) => (w ? ["the board", "the tickets", "the rules"][i] : null)).filter(Boolean).join(" and ")}`, JSON.stringify(await ticked()) === JSON.stringify(want));
    }
    await page.evaluate(() => { localStorage.removeItem("ttr-print-rules"); localStorage.removeItem("ttr-print-parts"); });
    await page.reload({ waitUntil: "networkidle" });
    await page.waitForTimeout(500);
    // an empty deck has no cards to print
    await ticketsButton.click();
    await page.waitForTimeout(300);
    await page.getByRole("button", { name: /Add a deck/ }).click();
    await page.waitForTimeout(250);
    await page.getByRole("menuitem", { name: /New, empty deck/ }).click();
    await page.waitForTimeout(400);
    await page.locator(".tickets-panel").getByRole("button", { name: "Done" }).click();
    await page.waitForTimeout(300);
    await printButton().click();
    await page.waitForTimeout(400);
    check("an empty deck has no cards to print: the tickets box cannot be ticked, and says why", (await printPart("Print the tickets").isDisabled()) && /no tickets/i.test(await printDialog().textContent()));
    await printDialog().getByRole("button", { name: "Cancel" }).click();
    await page.waitForTimeout(300);
    await ticketsButton.click();
    await page.waitForTimeout(300);
    await page.getByRole("button", { name: /Delete deck/ }).click();
    await page.waitForTimeout(400);
    await page.locator(".tickets-panel").getByRole("button", { name: "Done" }).click();
    await page.waitForTimeout(300);
    // a map with no rules cannot print any
    await rulesButton.click();
    await page.waitForTimeout(300);
    await panel.getByRole("textbox", { name: "Rules text" }).fill("");
    await page.waitForTimeout(1200);
    check("a map without rules shows an empty preview that says so", /nothing written/i.test(await panel.locator(".rules-preview").textContent()));
    await printButton().click();
    await page.waitForTimeout(400);
    check("with nothing written, the rules box cannot be ticked, and the dialog says why", (await printPart("Print the rules").isDisabled()) && !(await printPart("Print the rules").isChecked()) && /nothing written/i.test(await printDialog().textContent()));
    await printDialog().getByRole("button", { name: "Cancel" }).click();
    await page.waitForTimeout(300);
    // back to a clean state for what follows
    await panel.getByRole("button", { name: "Done" }).click();
    await page.waitForTimeout(300);
    await page.evaluate(() => { localStorage.removeItem("ttr-print-rules"); localStorage.removeItem("ttr-print-parts"); });
  }

  // 33b2. a panel open in the right column must not clip the print: a browser that lays the print out at
  // the window's width (Safari) would otherwise cut everything after the first screen, rules and all
  {
    for (const [label, open, panelSel] of [["Rules", () => page.getByRole("button", { name: "Rules", exact: true }).click(), ".rules-panel"], ["Map balance", () => page.getByRole("button", { name: "Map balance", exact: true }).click(), ".balance-panel"], ["Tickets", () => ticketsButton.click(), ".tickets-panel"]]) {
      await open();
      await page.waitForTimeout(500);
      await page.emulateMedia({ media: "print" });
      const clip = await page.evaluate(() => { const a = document.querySelector(".app-shell"); const cs = getComputedStyle(a); return { overflow: cs.overflow, height: Math.round(a.getBoundingClientRect().height), content: a.scrollHeight, rules: document.querySelectorAll(".print-pages .print-rules").length }; });
      await page.emulateMedia({ media: "screen" });
      check(`with ${label} open, the printed pages are not clipped to one screen`, clip.overflow !== "hidden" && clip.height >= clip.content - 1, JSON.stringify(clip));
      await page.locator(`${panelSel} button`).filter({ hasText: /^Done$/ }).first().click();
      await page.waitForTimeout(300);
    }
  }

  // 33c. every dialog stays inside a low window and scrolls within, with its last button reachable
  {
    await page.setViewportSize({ width: 1280, height: 420 });
    await page.waitForTimeout(300);
    const measure = () => page.evaluate(() => {
      const d = document.querySelector('[role="dialog"], [role="alertdialog"]');
      if (!d) return null;
      const r = d.getBoundingClientRect();
      const before = { top: r.top, bottom: r.bottom };
      const overflowY = getComputedStyle(d).overflowY;
      const scrolls = d.scrollHeight > d.clientHeight + 1;
      d.scrollTop = d.scrollHeight;
      const buttons = Array.from(d.querySelectorAll("button")).filter((b) => b.getClientRects().length && !b.closest("[data-slot=dialog-close]"));
      const last = buttons.at(-1);
      const lr = last ? last.getBoundingClientRect() : null;
      return { ...before, win: innerHeight, overflowY, scrolls, lastVisible: !last || (lr.top >= 0 && lr.bottom <= innerHeight + 1), height: r.height };
    });
    const dialogs = [
      ["Print", async () => { await printButton().click(); }],
      ["Settings", async () => { await page.getByRole("button", { name: "Settings" }).click(); }],
      ["Getting started", async () => { await page.getByRole("button", { name: "Help" }).click(); await page.getByRole("menuitem", { name: "Getting started" }).click(); }],
      ["Start over", async () => { await page.getByRole("button", { name: "Settings" }).click(); await page.waitForTimeout(300); await page.locator(".settings-nav-item", { hasText: /^Map/ }).click(); await page.getByRole("button", { name: "Start over…" }).click(); }],
    ];
    for (const [label, open] of dialogs) {
      await open();
      await page.waitForTimeout(500);
      const m = await measure();
      check(`the ${label} dialog fits a 420 px window`, m !== null && m.top >= 0 && m.bottom <= m.win + 1, JSON.stringify(m));
      check(`and scrolls within when it is taller than the window, with its last button in reach`, m !== null && m.overflowY !== "visible" && m.lastVisible && (!m.scrolls || m.overflowY === "auto" || m.overflowY === "scroll"), JSON.stringify(m));
      await page.keyboard.press("Escape");
      await page.waitForTimeout(350);
    }
    // Suggest a deck has a table of its own to scroll, inside a dialog that must still fit
    await ticketsButton.click();
    await page.waitForTimeout(400);
    await page.getByRole("button", { name: /Add a deck/ }).click();
    await page.waitForTimeout(250);
    await page.getByRole("menuitem", { name: /Build a full deck of tickets/ }).click();
    await page.waitForSelector(".suggest-table tbody tr", { timeout: 20000 });
    await page.waitForTimeout(300);
    const sm = await measure();
    check("the Suggest a deck dialog fits a 420 px window, with its last button in reach", sm !== null && sm.top >= 0 && sm.bottom <= sm.win + 1 && sm.lastVisible && sm.overflowY !== "visible", JSON.stringify(sm));
    await page.keyboard.press("Escape");
    await page.waitForTimeout(350);
    await page.keyboard.press("Escape");
    await page.waitForTimeout(250);
    await page.setViewportSize({ width: 1500, height: 1000 });
    await page.waitForTimeout(300);
  }

  // 33d. the version, and what is new in it
  {
    const pkgVersion = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "package.json"), "utf8")).version;
    await page.getByRole("button", { name: "Help" }).click();
    await page.waitForTimeout(250);
    const whatsNew = page.getByRole("menuitem", { name: /What.s new/ });
    check("the Help menu has What's new, as a link", (await whatsNew.count()) === 1 && /whats-new\/?$/.test((await whatsNew.getAttribute("href")) || ""), String(await whatsNew.getAttribute("href")));
    check("and says which version this is", (await page.locator('[role="menu"]').textContent()).includes(`Version ${pkgVersion}`));
    const repoItem = page.getByRole("menuitem", { name: /Source code on GitHub/ });
    check("Help links to the source code on GitHub, in a new tab that is not given the page to look at", (await repoItem.count()) === 1 && (await repoItem.getAttribute("href")) === "https://github.com/bjornhagstrom/ticket-to-ride-map-editor" && (await repoItem.getAttribute("target")) === "_blank" && /noopener/.test(await repoItem.getAttribute("rel")) && /noreferrer/.test(await repoItem.getAttribute("rel")));
    await page.keyboard.press("Escape");
    await page.waitForTimeout(250);
    const other = await (await browser.newContext({ viewport: { width: 1200, height: 900 } })).newPage();
    await other.goto(BASE + "whats-new/", { waitUntil: "networkidle" });
    check("the What's new page opens", /What.s new/.test(await other.locator("h1").first().textContent()));
    check("with the route logo in its head, and no bus", (await logoOn(other)).some((l) => l.header && l.wagons === 3) && (await other.locator(".lucide-bus-front").count()) === 0);
    const releases = other.locator("article.release");
    check("it lists the releases, newest first, each with its version and date", (await releases.count()) >= 2 && (await releases.first().locator("h2").textContent()).includes(pkgVersion) && /\d{4}-\d{2}-\d{2}/.test(await releases.first().locator("time").textContent()));
    check("each with what changed, in a list that shows its bullets", (await releases.first().locator("li").count()) >= 1 && (await releases.first().locator("ul").evaluate((el) => getComputedStyle(el).listStyleType)) === "disc");
    check("and a way back to the editor", (await other.getByRole("link", { name: /Back to the editor/ }).count()) >= 1);
    // A release leads with what it brings. 0.4.0: spreadsheets, boards that stand, tickets with a map;
    // 0.4.1: map balance to act on, and routes drawn with less fuss.
    const release = (version) => releases.filter({ has: other.locator("h2", { hasText: version }) }).first();
    const titleOf = async (version) => (await release(version).locator(".release-title").textContent()) ?? "";
    const firstOf = async (version) => (await release(version).locator("li").allTextContents()).slice(0, 3).join(" ");
    check("0.4.0 is named after what it brings", /spreadsheet/i.test(await titleOf("0.4.0")) && /stand/i.test(await titleOf("0.4.0")) && /ticket/i.test(await titleOf("0.4.0")), await titleOf("0.4.0"));
    check("and its list starts with those, not with the small things", /spreadsheet/i.test(await firstOf("0.4.0")) && /stand/i.test(await firstOf("0.4.0")) && /small map/i.test(await firstOf("0.4.0")), await firstOf("0.4.0"));
    check("0.4.1 is named after what it brings and starts with it: map balance to act on, and routes", /map balance/i.test(await titleOf("0.4.1")) && /route/i.test(await titleOf("0.4.1")) && /Map balance/.test(await firstOf("0.4.1")) && /route/i.test(await firstOf("0.4.1")), await firstOf("0.4.1"));
    await other.goto(BASE + "about/", { waitUntil: "networkidle" });
    const aboutText = await other.locator("body").textContent();
    check("the About page tells of boards that stand, of ticket cards with a small map, and of spreadsheets", /stand/.test(aboutText) && /small map/.test(aboutText) && /spreadsheet/i.test(aboutText));
    const docLinks = await other.locator('a[href*="/blob/main/docs/"]').evaluateAll((els) => els.map((el) => el.getAttribute("href")));
    check("it links to the decisions and the file format in the public source, rather than naming files", docLinks.some((h) => h.endsWith("/docs/DECISIONS.md")) && docLinks.some((h) => h.endsWith("/docs/FILE-FORMAT.md")) && docLinks.every((h) => h.startsWith("https://github.com/bjornhagstrom/ticket-to-ride-map-editor/blob/main/")), docLinks.join(", "));
    check("it says which file format a map is written in: 3, or 4 for a board that stands", /file format 3, or 4 for a standing board/.test(aboutText), (aboutText.match(/file format[^·]*/) || [""])[0]);
    // Since route load was weighted 2 the official decks score 4 to 35 (docs/TICKET-SUGGESTER.md §2b):
    // what holds is the order, official below random and a suggestion below official, not a number.
    check("the About page does not promise official decks a score below 5", !/below 5/.test(aboutText) && /random/.test(aboutText));
    check("the About page has the route logo in its head, and no bus", (await logoOn(other)).some((l) => l.header && l.wagons === 3) && (await other.locator(".lucide-bus-front").count()) === 0);
    check("the About page speaks of the many many prototypes, not of ten or twenty", /the many many prototypes/.test(aboutText) && !/ten or twenty/.test(aboutText));
    const aboutRepo = other.getByRole("link", { name: /source code/i });
    check("the About page links to the source code too", (await aboutRepo.count()) >= 1 && (await aboutRepo.first().getAttribute("href")) === "https://github.com/bjornhagstrom/ticket-to-ride-map-editor" && /noopener/.test(await aboutRepo.first().getAttribute("rel")));
    check("the About page shows the version and links to What's new", (await other.locator("body").textContent()).includes(`Version ${pkgVersion}`) && (await other.getByRole("link", { name: /What.s new/ }).count()) >= 1);
    await other.context().close();
  }
  await page.context().close();
  } // end of section 33
  // 35. a board that stands: chosen in Settings beside the format, everything on it turned a quarter
  // turn, the canvas, the print, the cards and the file all standing with it. In a window of its own.
  if (wants(35)) {
  sectionStart(35);
    const sp = await (await browser.newContext({ viewport: { width: 1500, height: 1000 } })).newPage();
    sp.on("pageerror", (e) => errors.push(String(e)));
    await sp.goto(BASE, { waitUntil: "networkidle" });
    await sp.getByRole("button", { name: "Load the example map" }).click();
    await sp.waitForTimeout(600);
    const KEY = "ttr-map";
    const storedMap = () => sp.evaluate((key) => JSON.parse(localStorage.getItem(key)), KEY);
    const lying = await storedMap();
    const viewBox = () => sp.evaluate(() => document.querySelector(".map-canvas").getAttribute("viewBox"));
    const spBadges = () => sp.locator(".map-status span").allTextContents();
    await sp.getByRole("button", { name: "Settings" }).click();
    await sp.waitForTimeout(400);
    const orientations = await sp.locator('#settings-orientation input[type="radio"]').evaluateAll((els) => els.map((el) => el.value));
    check("Settings offers the board lying or standing, beside its format", JSON.stringify(orientations) === JSON.stringify(["landscape", "portrait"]) && (await sp.getByRole("radio", { name: /Landscape/ }).isChecked()) && (await sp.getByRole("radio", { name: /Portrait/ }).count()) === 1, orientations.join(", "));
    // A line drawing beside the two choices shows what they give: the board in its proportions, its
    // fold lines between the panels, its size, and a ticket card lying or standing as the cards will.
    const preview = () => sp.evaluate(() => {
      const box = document.querySelector(".board-preview"); if (!box) return null;
      const r = (el) => el && el.getBoundingClientRect();
      const board = box.querySelector(".board-preview-board"), card = box.querySelector(".board-preview-card");
      const folds = Array.from(box.querySelectorAll(".board-preview-fold")).map((l) => (l.getAttribute("x1") === l.getAttribute("x2") ? "v" : "h")).sort().join("");
      const select = r(document.querySelector("#settings-format")), orient = r(document.querySelector("#settings-orientation")), drawn = r(box);
      return { board: board && { w: Number(board.getAttribute("width")), h: Number(board.getAttribute("height")) }, card: card && { w: Number(card.getAttribute("width")), h: Number(card.getAttribute("height")) },
        folds, text: box.textContent, beside: drawn.left >= Math.max(select.right, orient.right) - 1 && drawn.top < orient.bottom && drawn.bottom > select.top, size: { w: drawn.width, h: drawn.height } };
    });
    const lyingPreview = await preview();
    check("beside the board's format and orientation there is a drawing of the board", Boolean(lyingPreview && lyingPreview.board) && lyingPreview.beside && lyingPreview.size.w >= 80 && lyingPreview.size.w <= 220, JSON.stringify(lyingPreview && { beside: lyingPreview.beside, size: lyingPreview.size }));
    check("lying, it is 790 × 525 in proportion, folded 3 across and 2 down, and says its size", Math.abs(lyingPreview.board.w / lyingPreview.board.h - 790 / 525) < .02 && lyingPreview.folds === "hvv" && /790 × 525 mm/.test(lyingPreview.text), JSON.stringify(lyingPreview));
    check("with a ticket card lying beside it", lyingPreview.card && lyingPreview.card.w > lyingPreview.card.h && Math.abs(lyingPreview.card.w / lyingPreview.card.h - 62 / 45) < .02, JSON.stringify(lyingPreview.card));
    await sp.getByRole("radio", { name: /Portrait/ }).check();
    await sp.waitForTimeout(500);
    const standingPreview = await preview();
    check("standing, the drawing stands: 525 × 790, folded 2 across and 3 down, with a standing card", Math.abs(standingPreview.board.h / standingPreview.board.w - 790 / 525) < .02 && standingPreview.folds === "hhv" && /525 × 790 mm/.test(standingPreview.text) && standingPreview.card.h > standingPreview.card.w, JSON.stringify(standingPreview));
    await sp.keyboard.press("Escape");
    await sp.waitForTimeout(300);
    const standing = await storedMap();
    check("standing, the board is 731 wide and 1100 tall", (await viewBox()) === "0 0 731 1100", await viewBox());
    check("and the status line says so", (await spBadges())[0].includes("standing"), (await spBadges())[0]);
    check("every stop has turned a quarter turn with the board", standing.orientation === "portrait" && lying.stops.every((s, i) => Math.abs(standing.stops[i].x - (731 - s.y)) < .01 && Math.abs(standing.stops[i].y - s.x) < .01));
    const canvas = await sp.locator(".map-canvas").boundingBox();
    check("the canvas stands too, and the whole of it fits in the window", canvas.height > canvas.width * 1.4 && canvas.y + canvas.height <= 1000 + 1 && canvas.width > 200, JSON.stringify(canvas));
    const folds = await sp.evaluate(() => Array.from(document.querySelectorAll(".map-canvas .fold-guides line")).map((l) => (l.getAttribute("x1") === l.getAttribute("x2") ? "v" : "h")).sort().join(""));
    check("its fold lines mark 2 panels across and 3 down", folds === "hhv", folds);
    const labelsOff = await sp.evaluate(() => { const c = document.querySelector(".map-canvas").getBoundingClientRect(); return Array.from(document.querySelectorAll(".map-canvas .stop text")).filter((t) => { const r = t.getBoundingClientRect(); return r.width && (r.left < c.left - 1 || r.right > c.right + 1); }).map((t) => t.textContent); });
    check("no stop's name runs off the side of the standing board", labelsOff.length === 0, labelsOff.join(", "));
    await sp.getByRole("button", { name: "Undo" }).click();
    await sp.waitForTimeout(400);
    check("Undo lays it down again, every stop back where it was", (await viewBox()) === "0 0 1100 731" && (await storedMap()).stops.every((s, i) => Math.abs(s.x - lying.stops[i].x) < .01 && Math.abs(s.y - lying.stops[i].y) < .01), await viewBox());
    await sp.getByRole("button", { name: "Redo" }).click();
    await sp.waitForTimeout(400);
    await sp.reload({ waitUntil: "networkidle" });
    await sp.waitForTimeout(700);
    check("a standing map is still standing after a reload", (await viewBox()) === "0 0 731 1100", await viewBox());

    // Printed: not turned on the page, panels 2 × 3.
    await sp.getByRole("button", { name: "Print map" }).click();
    await sp.waitForTimeout(400);
    const dialog = sp.locator('[role="dialog"]').first();
    const a4Panels = await dialog.locator('.print-table tbody tr[data-paper="a4"] td:nth-of-type(2) button').getAttribute("data-pages");
    check("the print table counts six A4 sheets for its panels", a4Panels === "6", String(a4Panels));
    await pickSplit(dialog, "panel");
    check("nor does anything else in the dialog", !/turned/.test((await dialog.textContent()) || ""));
    const pages = await sp.evaluate(() => Array.from(document.querySelectorAll(".print-pages .print-page")).map((p) => p.querySelector("svg.print-sheet > g").getAttribute("transform")));
    check("the board's pages print standing, without a quarter turn", pages.length === 6 && pages.every((t) => !t), JSON.stringify(pages.slice(0, 2)));
    await sp.keyboard.press("Escape");
    await sp.waitForTimeout(300);

    // The cards stand with the board, and so does their small map.
    await sp.getByRole("button", { name: "Tickets", exact: true }).click();
    await sp.waitForTimeout(400);
    await sp.evaluate(() => { window.__stand = null; window.print = () => { const c = document.querySelector(".print-tickets .ticket-card"); const m = c && c.querySelector("svg.ticket-map"); const r = c && c.getBoundingClientRect(); window.__stand = { w: r && r.width, h: r && r.height, viewBox: m && m.getAttribute("viewBox") , points: (() => { const p = c && c.querySelector(".ticket-card-points"); const b = p && p.getBoundingClientRect(); return b ? { top: b.top, bottom: b.bottom } : null; })(), map: m ? { top: m.getBoundingClientRect().top, bottom: m.getBoundingClientRect().bottom, width: m.getBoundingClientRect().width } : null, cardBottom: r ? r.bottom : 0, mmPx: 96 / 25.4, inner: r ? r.width - parseFloat(getComputedStyle(c).paddingLeft) - parseFloat(getComputedStyle(c).paddingRight) - 2 : 0 }; }; });
    await sp.emulateMedia({ media: "print" });
    await sp.evaluate(() => Array.from(document.querySelectorAll("button")).find((b) => b.textContent.includes("Print deck")).click());
    await sp.waitForFunction(() => window.__stand !== null, null, { timeout: 5000 });
    const card = await sp.evaluate(() => window.__stand);
    await sp.emulateMedia({ media: "screen" });
    check("on a standing board the cards stand, 45 x 62 mm", Math.abs(card.w - mm(45)) < 3 && Math.abs(card.h - mm(62)) < 3, `${(card.w / 96 * 25.4).toFixed(0)} x ${(card.h / 96 * 25.4).toFixed(0)} mm`);
    check("with the standing board as their small map", card.viewBox === "0 0 731 1100", String(card.viewBox));
    // On a standing card the points sit at the top, beside the names, so the small map is not squeezed
    // beside a column of its own; a lying card keeps them in its corner.
    check("a standing card has its points at the top, above the small map", card.points && card.map && card.points.bottom <= card.map.top + 1, JSON.stringify({ points: card.points, map: card.map }));
    check("the whole small map shows, nothing cut off at the foot", card.map && card.map.bottom <= card.cardBottom + 1, JSON.stringify({ map: card.map, cardBottom: card.cardBottom }));
    check("and it is wider than when the points had a column of their own", card.map && card.map.width > card.inner - 11.5 * card.mmPx + 2, `${card.map && card.map.width.toFixed(0)} px against ${(card.inner - 11.5 * card.mmPx).toFixed(0)}`);

    // The file says it stands.
    await sp.waitForTimeout(300);
    await sp.getByRole("button", { name: "Export", exact: true }).click();
    await sp.waitForTimeout(250);
    const saved = sp.waitForEvent("download");
    await sp.getByRole("menuitem", { name: "Full map" }).click();
    const file = path.join(os.tmpdir(), `ttr-standing-${Date.now()}.json`);
    await (await saved).saveAs(file);
    const json = JSON.parse(fs.readFileSync(file, "utf8"));
    check("a standing map's file is version 4, its board frame standing", json.version === 4 && json.board.width === 731 && json.board.height === 1100 && json.payload.orientation === "portrait", JSON.stringify({ version: json.version, board: json.board, orientation: json.payload.orientation }));
    fs.rmSync(file, { force: true });
    await sp.getByRole("button", { name: "Settings" }).click();
    await sp.waitForTimeout(400);
    await sp.getByRole("radio", { name: /Extended board 2×4/ }).check();
    await sp.waitForTimeout(500);
    const tallPreview = await preview();
    check("a standing 2×4 board is drawn 526 × 1053, folded 2 across and 4 down", Math.abs(tallPreview.board.h / tallPreview.board.w - 1053 / 526) < .02 && tallPreview.folds === "hhhv" && /526 × 1,?053 mm/.test(tallPreview.text), JSON.stringify(tallPreview));
    check("and the drawing still fits beside the choices", tallPreview.beside && tallPreview.size.h <= 220, JSON.stringify(tallPreview.size));
    await sp.keyboard.press("Escape");
    await sp.context().close();
  }

  // 36. Crossings, pointed at: the card marks every route that crosses another, rings each place where
  // two cross, and lets go when the pointer leaves. A route straight across the example map makes some.
  if (wants(36)) {
  sectionStart(36);
    const cp = await (await browser.newContext({ viewport: { width: 1500, height: 1000 } })).newPage();
    cp.on("pageerror", (e) => errors.push(String(e)));
    await cp.goto(BASE, { waitUntil: "networkidle" });
    await cp.getByRole("button", { name: "Load the example map" }).click();
    await cp.waitForTimeout(600);
    await cp.evaluate(() => { const key = "ttr-map"; const m = JSON.parse(localStorage.getItem(key)); m.routes.push({ id: "r-across", a: "example-westport", b: "example-quarry", length: 6, type: m.routes[0].type, color: "neutral", curved: false }); localStorage.setItem(key, JSON.stringify(m)); });
    await cp.reload({ waitUntil: "networkidle" });
    await cp.waitForTimeout(700);
    const card = cp.locator(".crossing-card").filter({ hasText: /crossing/ });
    const count = Number(((await card.textContent()).match(/(\d+) crossing/) || [])[1] || 0);
    check("a route straight across the map crosses others, and the card counts them", count >= 2, await card.textContent());
    const state = () => cp.evaluate(() => {
      const canvas = document.querySelector(".map-canvas").getBoundingClientRect();
      const marked = Array.from(document.querySelectorAll(".map-canvas .route-group.on-preview"));
      const others = Array.from(document.querySelectorAll(".map-canvas .route-group:not(.on-preview)"));
      const rings = Array.from(document.querySelectorAll(".map-canvas .crossing-mark")).map((r) => r.getBoundingClientRect());
      return { marked: marked.length, acrossMarked: marked.some((g) => g.getAttribute("data-route-id") === "r-across"), dimmed: others.length > 0 && others.every((g) => parseFloat(getComputedStyle(g).opacity) <= 0.5),
        rings: rings.length, ringsOnCanvas: rings.every((r) => r.left >= canvas.left && r.right <= canvas.right && r.top >= canvas.top && r.bottom <= canvas.bottom), ringStroke: (() => { const r = document.querySelector(".map-canvas .crossing-mark"); return r ? getComputedStyle(r).stroke : null; })() };
    });
    check("before pointing at it, nothing is marked", (await state()).marked === 0 && (await state()).rings === 0);
    await card.hover();
    await cp.waitForTimeout(300);
    const on = await state();
    check("pointing at the card marks the crossing routes, the long one among them, and the rest step back", on.marked >= 2 && on.acrossMarked && on.dimmed, JSON.stringify(on));
    check("and rings every crossing, one ring each, on the map", on.rings === count && on.ringsOnCanvas, JSON.stringify(on));
    const tip = await cp.evaluate(() => { const t = document.querySelector('[data-slot="tooltip-content"]'); const c = document.querySelector(".map-canvas").getBoundingClientRect(); if (!t) return null; const r = t.getBoundingClientRect(); return { right: r.right, canvasLeft: c.left }; });
    check("and its explanation opens beside the column, not over the crossings on the map", !tip || tip.right <= tip.canvasLeft + 1, JSON.stringify(tip));
    await cp.mouse.move(5, 995);
    await cp.waitForTimeout(300);
    const off = await state();
    check("and lets them go when the pointer leaves", off.marked === 0 && off.rings === 0, JSON.stringify(off));
    await card.focus();
    await cp.waitForTimeout(300);
    check("the keyboard reaches it too: focusing the card marks them", (await state()).rings === count);
    await cp.context().close();
  }

  // 37. A reminder to export: the map lives in this browser only, so after a while of work without an
  // export a note says so. "Later" waits another while, "Remind me less often" waits longer each time
  // and in the end offers to stop; Settings turns it back on. Work is counted in actions: building a
  // whole deck of tickets is one, a burst of typing is one.
  if (wants(37)) {
  sectionStart(37);
    const rp = await (await browser.newContext({ viewport: { width: 1500, height: 1000 }, acceptDownloads: true })).newPage();
    rp.on("pageerror", (e) => errors.push(String(e)));
    await rp.goto(BASE, { waitUntil: "networkidle" });
    await rp.getByRole("button", { name: "Load the example map" }).click();
    await rp.waitForTimeout(600);
    const RKEY = "ttr-export-reminder";
    const state = () => rp.evaluate((k) => JSON.parse(localStorage.getItem(k) || "null"), RKEY);
    const seed = async (patch) => { await rp.evaluate(([k, p]) => localStorage.setItem(k, JSON.stringify({ ...(JSON.parse(localStorage.getItem(k) || "{}")), ...p })), [RKEY, patch]); await rp.reload({ waitUntil: "networkidle" }); await rp.waitForTimeout(600); };
    const note = rp.locator(".export-reminder");
    const oneChange = async () => { await rp.locator("#map-name").fill(`Reminder test ${Date.now()}`); await rp.waitForTimeout(1700); };
    const status = () => rp.locator(".save-state").textContent();
    check("the header says the map is saved in this browser, and not exported yet", /Saved in this browser/.test(await status()) && /not exported yet/i.test(await status()), await status());
    check("no reminder at the start of the work", (await note.count()) === 0);

    // An action is counted once, however many keystrokes it took. (A pause first, so the typing is not
    // taken as part of loading the example map a moment ago.)
    await rp.waitForTimeout(1700);
    const before = (await state())?.changes ?? 0;
    await rp.locator("#map-name").pressSequentially("abc", { delay: 40 });
    await rp.waitForTimeout(1700);
    check("typing a name counts as one change, not one per key", (await state()).changes === before + 1, `${before} -> ${(await state()).changes}`);

    // Building a whole deck of tickets is one change.
    await rp.getByRole("button", { name: "Tickets", exact: true }).click(); await rp.waitForTimeout(400);
    const deckBefore = (await state()).changes;
    await rp.getByRole("button", { name: /Add a deck/ }).click(); await rp.waitForTimeout(250);
    await rp.getByRole("menuitem", { name: /Build a full deck of tickets/ }).click();
    await rp.waitForFunction(() => { const row = [...document.querySelectorAll(".suggest-table tbody tr")].find((tr) => tr.children[0].textContent.trim() === "Score"); return row && row.children[2].textContent.trim() !== "—"; }, null, { timeout: 30000 });
    await rp.getByRole("button", { name: /^Replace / }).click();
    await rp.waitForTimeout(1700);
    check("building a whole deck of tickets counts as one change", (await state()).changes === deckBefore + 1, `${deckBefore} -> ${(await state()).changes}`);
    await rp.keyboard.press("Escape"); await rp.waitForTimeout(300);

    // The first reminder comes after 40 changes.
    await seed({ changes: 39 });
    check("39 changes in, still no reminder", (await note.count()) === 0);
    await oneChange();
    const text = await note.textContent().catch(() => "");
    check("after 40, a note in the tools column says the map is only in this browser and asks for an export", (await note.count()) === 1 && /only saved in this browser/i.test(text) && /export/i.test(text), text);
    const buttons = await note.getByRole("button").allTextContents();
    check("it offers Export map, Later and Remind me less often", ["Export map", "Later", "Remind me less often"].every((b) => buttons.includes(b)), buttons.join(" | "));
    check("the header's save line turns to a warning too", /not exported yet/i.test(await status()) && (await rp.locator(".save-state.needs-export").count()) === 1);

    // Later: gone for now, back after another 40.
    await note.getByRole("button", { name: "Later" }).click(); await rp.waitForTimeout(300);
    check("Later puts it away", (await note.count()) === 0);
    await seed({ changes: 79 }); await oneChange();
    check("and it comes back after another 40 changes", (await note.count()) === 1);

    // Less often: 120 between reminders, then 300, then an offer to stop.
    await note.getByRole("button", { name: "Remind me less often" }).click(); await rp.waitForTimeout(300);
    check("Remind me less often puts it away", (await note.count()) === 0 && (await state()).level === 1);
    await seed({ changes: (await state()).changes + 120 - 1 }); await oneChange();
    check("and waits 120 changes before the next", (await note.count()) === 1);
    await note.getByRole("button", { name: "Remind me less often" }).click(); await rp.waitForTimeout(300);
    await seed({ changes: (await state()).changes + 300 - 1 }); await oneChange();
    const last = await note.getByRole("button").allTextContents().catch(() => []);
    check("then 300, and now it offers to stop reminding altogether", (await note.count()) === 1 && last.includes("Don't remind me again") && !last.includes("Remind me less often"), last.join(" | "));
    await note.getByRole("button", { name: "Don't remind me again" }).click(); await rp.waitForTimeout(300);
    await seed({ changes: 5000 }); await oneChange();
    check("turned off, it stays away however much is changed", (await note.count()) === 0 && (await state()).off === true);

    // Settings can turn it back on, from the start.
    await rp.getByRole("button", { name: "Settings" }).click(); await rp.waitForTimeout(400);
    const box = rp.getByRole("checkbox", { name: /Remind me to export/ });
    check("Settings shows the reminder turned off", (await box.count()) === 1 && !(await box.isChecked()));
    await box.check(); await rp.waitForTimeout(300);
    check("and turns it on again, from the first step", (await state()).off === false && (await state()).level === 0);
    await rp.keyboard.press("Escape"); await rp.waitForTimeout(300);

    // Exporting the full map resets it all and says when.
    await seed({ changes: (await state()).changes + 40 - 1 }); await oneChange();
    check("the reminder is back after 40 changes", (await note.count()) === 1);
    const saved = rp.waitForEvent("download");
    await note.getByRole("button", { name: "Export map" }).click();
    await (await saved).path();
    await rp.waitForTimeout(400);
    check("Export map from the note downloads the map, puts the note away and starts counting again", (await note.count()) === 0 && (await state()).changes === 0 && Boolean((await state()).lastExport));
    check("and the header says it was exported just now", /exported just now/i.test(await status()) && (await rp.locator(".save-state.needs-export").count()) === 0, await status());
    await rp.context().close();
  }

  // 38. How the network holds together, described rather than judged. A dead end and a corner are
  // character, as Edinburgh and Iberia are on Europe; a route with one lane whose loss cuts the map in
  // two is the one thing the official maps never have, and the only one warned about. Crowding is
  // set against the official maps instead of being called a fault.
  if (wants(38)) {
  sectionStart(38);
    const np = await (await browser.newContext({ viewport: { width: 1500, height: 1000 } })).newPage();
    np.on("pageerror", (e) => errors.push(String(e)));
    await np.goto(BASE, { waitUntil: "networkidle" });
    await np.getByRole("button", { name: "Load the example map" }).click();
    await np.waitForTimeout(600);
    const KEY = "ttr-map";
    const edit = async (fn) => { await np.evaluate(([key, src]) => { const m = JSON.parse(localStorage.getItem(key)); (new Function("m", src))(m); localStorage.setItem(key, JSON.stringify(m)); }, [KEY, fn]); await np.reload({ waitUntil: "networkidle" }); await np.waitForTimeout(700); };
    const shapeCard = np.locator(".crossing-card.shape-card");
    check("the example map holds together: the card says so, with no warning", /Well connected/.test(await shapeCard.textContent()) && !(await shapeCard.evaluate((el) => el.classList.contains("has-warning"))));
    // A cape behind one route with one lane.
    await edit(`const t = m.routes[0].type; m.stops.push({ id: "cape", name: "Cape", type: "city", x: 1060, y: 120 }); m.routes.push({ id: "r-cape", a: "example-eastgate", b: "cape", length: 3, type: t, color: "red" });`);
    const cardText = (await shapeCard.textContent()).replace(/\s+/g, " ");
    check("a route with one lane that cuts the map in two is warned about, and named", (await shapeCard.evaluate((el) => el.classList.contains("has-warning"))) && /1 route cuts the map in two/.test(cardText) && /Eastgate–Cape/.test(cardText), cardText);
    await np.getByRole("button", { name: "Map balance", exact: true }).click();
    await np.waitForTimeout(700);
    const section = np.locator(".network-shape");
    const sectionText = (await section.textContent()).replace(/\s+/g, " ");
    check("Map balance has a section on how the network holds together", (await section.count()) === 1 && /How the network holds together/.test(sectionText));
    check("it lists the dead end and the route into it, with its one lane", /Cape/.test(sectionText) && /Eastgate–Cape/.test(sectionText) && /one lane/i.test(sectionText), sectionText.slice(0, 400));
    check("and says what the official maps have", /official maps/i.test(sectionText) && /Edinburgh/.test(sectionText) && /Iberia/.test(sectionText), sectionText.slice(-400));
    await section.locator(".shape-row", { hasText: "Eastgate–Cape" }).first().hover();
    await np.waitForTimeout(300);
    check("pointing at the route marks it on the map", (await np.locator('.map-canvas .route-group.on-preview[data-route-id="r-cape"]').count()) === 1);
    const crowdHelp = (await np.locator(".analysis-section.bottlenecks").textContent()).replace(/\s+/g, " ");
    check("the crowding advice sets the map against the official maps instead of calling it a fault", /official maps/i.test(crowdHelp) && !/nearly always a change to the map/i.test(crowdHelp), crowdHelp.slice(0, 300));
    // A second lane: still the only way to the cape, but now a double route, as Edinburgh–London is.
    await edit(`const t = m.routes[0].type; m.routes.push({ id: "r-cape-2", a: "example-eastgate", b: "cape", length: 3, type: t, color: "blue" });`);
    const calm = (await shapeCard.textContent()).replace(/\s+/g, " ");
    check("with a second lane, the dead end is described, not warned about", !(await shapeCard.evaluate((el) => el.classList.contains("has-warning"))) && /1 dead end/.test(calm) && /Cape/.test(calm), calm);
    await np.getByRole("button", { name: "Map balance", exact: true }).click();
    await np.waitForTimeout(700);
    check("and Map balance calls its way in a double route", /double route/i.test(await np.locator(".network-shape").textContent()));
    // A corner of two stops, reached only through two others.
    await edit(`const t = m.routes[0].type; m.stops.push({ id: "nook1", name: "Nook One", type: "city", x: 700, y: 60 }, { id: "nook2", name: "Nook Two", type: "city", x: 820, y: 60 }, { id: "nook3", name: "Nook Three", type: "city", x: 760, y: 20 }); m.routes.push({ id: "r-n1", a: "nook1", b: "nook2", length: 2, type: t, color: "green" }, { id: "r-n4", a: "nook1", b: "nook3", length: 1, type: t, color: "green" }, { id: "r-n5", a: "nook2", b: "nook3", length: 1, type: t, color: "green" }, { id: "r-n2", a: "nook1", b: "example-lakeside", length: 2, type: t, color: "green" }, { id: "r-n3", a: "nook2", b: "example-northfield", length: 2, type: t, color: "green" });`);
    await np.getByRole("button", { name: "Map balance", exact: true }).click();
    await np.waitForTimeout(700);
    const cornerRow = np.locator(".network-shape .shape-row", { hasText: "Nook One" });
    const cornerText = (await cornerRow.first().textContent().catch(() => "")).replace(/\s+/g, " ");
    check("a corner reached only through two stops is listed, with its gates", /Nook Two/.test(cornerText) && /reached only through/i.test(cornerText), cornerText);
    check("a corner is not a warning", !(await shapeCard.evaluate((el) => el.classList.contains("has-warning"))));
    await np.context().close();
  }

  // 39. A version number on everything printed or exported: one series for prints, files and images,
  // moved on only when the map has changed. On every sheet, card and rules page, and in a yellow
  // playtest box on the map with room to write the date played; the players go on the back.
  if (wants(39)) {
  sectionStart(39);
    const vp = await (await browser.newContext({ viewport: { width: 1500, height: 1000 }, acceptDownloads: true })).newPage();
    vp.on("pageerror", (e) => errors.push(String(e)));
    await vp.goto(BASE, { waitUntil: "networkidle" });
    await vp.getByRole("button", { name: "Load the example map" }).click();
    await vp.waitForTimeout(600);
    const KEY = "ttr-map";
    const stored = () => vp.evaluate((key) => JSON.parse(localStorage.getItem(key)), KEY);
    const versionBadge = () => vp.locator(".map-status .map-version");
    const stubPrint = () => vp.evaluate(() => { window.__run = null; window.print = () => { const root = document.querySelector(".print-pages"); window.__run = {
      sheets: Array.from(root.querySelectorAll(".print-page .print-sheet-name")).map((t) => t.textContent),
      cards: Array.from(root.querySelectorAll(".ticket-card")).map((c) => (c.querySelector(".ticket-card-version") || { textContent: "" }).textContent),
      rules: (root.querySelector(".print-rules-name") || { textContent: "" }).textContent,
      box: Array.from(root.querySelectorAll(".print-page .note-box.playtest")).map((b) => b.textContent.replace(/\s+/g, " ")),
    }; }; });
    const printDialog = () => vp.getByRole("dialog", { name: "Print the map" });
    const part = (name) => printDialog().getByRole("checkbox", { name, exact: true });
    const runPrint = async () => { await stubPrint(); await printDialog().getByRole("button", { name: "Print", exact: true }).click(); await vp.waitForFunction(() => window.__run !== null, null, { timeout: 5000 }); return vp.evaluate(() => window.__run); };
    check("a map that has never been printed or exported shows no version", (await versionBadge().count()) === 0 && (await stored()).mapVersion === undefined);

    await vp.getByRole("button", { name: "Print map" }).click();
    await vp.waitForTimeout(400);
    check("the print dialog says which version the print will be", /This print will be version 1/.test(await printDialog().textContent()));
    check("and offers a playtest box on the map, ticked", (await part("Print a playtest box on the map").count()) === 1 && (await part("Print a playtest box on the map").isChecked()));
    if (!(await part("Print the tickets").isChecked())) await part("Print the tickets").check();
    if (!(await part("Print the rules").isChecked())) await part("Print the rules").check();
    const first = await runPrint();
    await vp.waitForTimeout(400);
    check("every sheet of the board carries the version and its date", first.sheets.length > 0 && first.sheets.every((t) => /Version 1 · \d{1,2} [A-Z][a-z]{2} \d{4}/.test(t)), JSON.stringify(first.sheets.slice(0, 2)));
    check("every ticket card carries it", first.cards.length > 0 && first.cards.every((t) => t.trim() === "v1"), JSON.stringify(first.cards.slice(0, 3)));
    check("and so do the rules", /version 1/i.test(first.rules), first.rules);
    check("the playtest box is on the board, with the version, a line for the date and the players on the back", first.box.length >= 1 && first.box.every((b) => b === first.box[0]) && /Version 1/.test(first.box[0]) && /Played/.test(first.box[0]) && /back/i.test(first.box[0]), JSON.stringify(first.box));
    let map = await stored();
    check("the map now has version 1, and the playtest box is a note of its own", map.mapVersion && map.mapVersion.number === 1 && map.notes.some((n) => n.kind === "playtest"), JSON.stringify(map.mapVersion));
    check("the figures above the map show it", /^Version 1$/.test((await versionBadge().textContent()).trim()), await versionBadge().textContent());
    const boxOnScreen = vp.locator(".map-canvas .note-box.playtest");
    check("the playtest box is on the map on screen too, to move where it suits", (await boxOnScreen.count()) === 1 && /Version 1/.test(await boxOnScreen.textContent()));

    // Undo takes the box away again, but never the number: it is on paper already.
    await vp.getByRole("button", { name: "Undo" }).click();
    await vp.waitForTimeout(300);
    map = await stored();
    check("undo takes back the playtest box but not the version number", map.mapVersion && map.mapVersion.number === 1 && !map.notes.some((n) => n.kind === "playtest"), JSON.stringify(map.mapVersion));
    check("and the map now counts as changed since version 1", /Version 1 · changed/.test(await versionBadge().textContent()), await versionBadge().textContent());
    await vp.getByRole("button", { name: "Redo" }).click();
    await vp.waitForTimeout(300);
    check("redo brings the box back, and the map is version 1 as printed", /^Version 1$/.test((await versionBadge().textContent()).trim()), await versionBadge().textContent());
    await vp.evaluate((key) => { const m = JSON.parse(localStorage.getItem(key)); m.routes[0].length += 1; localStorage.setItem(key, JSON.stringify(m)); }, KEY);
    await vp.reload({ waitUntil: "networkidle" });
    await vp.waitForTimeout(500);
    const changedBox = (await vp.locator(".map-canvas .note-box.playtest").textContent()).replace(/\s+/g, " ");
    check("after a change the playtest box still shows the version on paper, with no note about the next print", /Version 1 ·/.test(changedBox) && !/next print/i.test(changedBox), changedBox);
    await vp.evaluate((key) => { const m = JSON.parse(localStorage.getItem(key)); m.routes[0].length -= 1; localStorage.setItem(key, JSON.stringify(m)); }, KEY);
    await vp.reload({ waitUntil: "networkidle" });
    await vp.waitForTimeout(500);

    await vp.getByRole("button", { name: "Print map" }).click();
    await vp.waitForTimeout(400);
    check("printing again unchanged says it is the same version", /version 1 too/i.test(await printDialog().textContent()), await printDialog().locator(".print-version").textContent().catch(() => ""));
    const again = await runPrint();
    await vp.waitForTimeout(400);
    check("and it is", again.sheets.every((t) => /Version 1 ·/.test(t)) && (await stored()).mapVersion.number === 1 && (await stored()).notes.filter((n) => n.kind === "playtest").length === 1);

    // A change, then an export: the next number in the same series.
    await vp.evaluate((key) => { const m = JSON.parse(localStorage.getItem(key)); m.stops[0].name = "Westport Harbour"; localStorage.setItem(key, JSON.stringify(m)); }, KEY);
    await vp.reload({ waitUntil: "networkidle" });
    await vp.waitForTimeout(500);
    check("after a change the figures say so, and the next print or export is version 2", /Version 1 · changed/.test(await versionBadge().textContent()) && /version 2/i.test(await versionBadge().getAttribute("title")), await versionBadge().getAttribute("title"));
    const saveExport = async (item) => { const download = vp.waitForEvent("download"); await vp.getByRole("button", { name: "Export", exact: true }).click(); await vp.waitForTimeout(200); await vp.getByRole("menuitem", { name: item, exact: true }).click(); const d = await download; const file = path.join(os.tmpdir(), `ttr-version-${Date.now()}-${d.suggestedFilename()}`); await d.saveAs(file); return { name: d.suggestedFilename(), file }; };
    const full = await saveExport("Full map");
    const fullJson = JSON.parse(fs.readFileSync(full.file, "utf8"));
    check("an export after a change is version 2: one series for prints and exports", fullJson.payload.mapVersion && fullJson.payload.mapVersion.number === 2 && fullJson.payload.mapVersion.issued.at(-1).by === "export", JSON.stringify(fullJson.payload.mapVersion));
    check("the file's name carries the version", /-v2-/.test(full.name), full.name);
    await vp.waitForTimeout(400);
    check("and the figures above the map move on to it", /^Version 2$/.test((await versionBadge().textContent()).trim()), await versionBadge().textContent());
    const network = await saveExport("Network only");
    check("another export of the unchanged map keeps the number, in its name too", /-v2-/.test(network.name) && (await stored()).mapVersion.number === 2, network.name);

    // An older copy of the same map brought back in: warned, with a new name suggested.
    const older = JSON.parse(JSON.stringify(fullJson));
    older.payload.mapVersion = { ...older.payload.mapVersion, number: 1, fingerprint: "00000000", issued: older.payload.mapVersion.issued.slice(0, 1) };
    const olderFile = path.join(os.tmpdir(), `ttr-older-${Date.now()}.json`);
    fs.writeFileSync(olderFile, JSON.stringify(older));
    await vp.locator('input[type="file"][accept="application/json"]').setInputFiles(olderFile);
    await vp.waitForTimeout(600);
    const toastText = (await vp.locator("[data-sonner-toast]").allTextContents()).join(" | ");
    check("opening an older copy of the same map warns that its numbers would repeat", /version 1/.test(toastText) && /version 2/.test(toastText), toastText);
    check("and suggests giving it a new name", /new name/i.test(toastText) && /\(from v1\)/.test(toastText), toastText);
    await vp.context().close();
  }

  // 40. How many wagon spaces a route has, chosen while drawing it: before, in the Draw route tool's
  // options (fitted to the distance unless a number is chosen), and right after, with − and + on the
  // new route or a digit key, without leaving the tool.
  if (wants(40)) {
  sectionStart(40);
    const rp2 = await (await browser.newContext({ viewport: { width: 1500, height: 1000 } })).newPage();
    rp2.on("pageerror", (e) => errors.push(String(e)));
    await rp2.goto(BASE, { waitUntil: "networkidle" });
    await rp2.getByRole("button", { name: "Load the example map" }).click();
    await rp2.waitForTimeout(600);
    const KEY = "ttr-map";
    const stored = () => rp2.evaluate((key) => JSON.parse(localStorage.getItem(key)), KEY);
    const tap = async (name) => { await rp2.evaluate((n) => { const s = Array.from(document.querySelectorAll(".map-canvas .stop")).find((g) => Array.from(g.querySelectorAll("text, title")).some((t) => t.textContent === n)); s.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true })); s.dispatchEvent(new PointerEvent("pointerup", { bubbles: true })); }, name); await rp2.waitForTimeout(250); };
    await rp2.locator('.tool-row .tool-button[aria-label="Draw route"]').click();
    await rp2.waitForTimeout(200);
    const lengthChoice = rp2.getByLabel("Wagon spaces for new routes");
    check("the Draw route tool lets the wagon spaces be chosen before drawing, fitted to the distance by default", (await lengthChoice.count()) === 1 && (await lengthChoice.inputValue()) === "fit");
    const before = (await stored()).routes.length;
    await tap("Millbrook"); await tap("Fernside");
    let map = await stored();
    const route = map.routes.at(-1);
    const a = map.stops.find((s) => s.name === "Millbrook"), b = map.stops.find((s) => s.name === "Fernside");
    // As many real wagons (20 mm, 5.5 mm apart, 15 mm to spare) as the straight line holds on a 790 mm board.
    const fits = Math.max(1, Math.min(8, Math.floor((Math.hypot(a.x - b.x, a.y - b.y) * 790 / 1100 - 15) / 25.5)));
    check("a new route gets as many wagon spaces as fit between its stops", map.routes.length === before + 1 && route.length === fits, `${route.length}, expected ${fits}`);
    const chip = rp2.locator(".map-canvas .length-chip");
    check("and right away offers − and + on the map to change them", (await chip.count()) === 1 && (await chip.textContent()).includes(String(fits)));
    await rp2.getByRole("button", { name: "More wagon spaces" }).click();
    await rp2.waitForTimeout(200);
    check("+ adds a wagon space", (await stored()).routes.at(-1).length === fits + 1);
    await rp2.getByRole("button", { name: "Fewer wagon spaces" }).click();
    await rp2.getByRole("button", { name: "Fewer wagon spaces" }).click();
    await rp2.waitForTimeout(200);
    check("− takes one away", (await stored()).routes.at(-1).length === fits - 1);
    await rp2.keyboard.press("4");
    await rp2.waitForTimeout(200);
    check("a digit key sets the number straight away", (await stored()).routes.at(-1).length === 4 && (await chip.textContent()).includes("4"));
    check("still in the Draw route tool, ready for the next route", (await rp2.locator('.tool-row .tool-button[aria-label="Draw route"]').getAttribute("aria-pressed")) === "true");
    await rp2.keyboard.press("Escape");
    await rp2.waitForTimeout(200);
    check("Escape puts the − and + away", (await chip.count()) === 0);
    await lengthChoice.selectOption("5");
    await tap("Lakeside"); await tap("Deepcut");
    map = await stored();
    check("a number chosen in the tool's options is what the next route gets", map.routes.at(-1).length === 5 && map.routes.length === before + 2, String(map.routes.at(-1).length));
    await tap("Westport");
    await rp2.waitForTimeout(200);
    check("starting the next route puts the − and + of the last one away", (await chip.count()) === 0);
    await rp2.keyboard.press("Escape");
    await rp2.context().close();
  }

  // 41. Small things seen in use: a tick box among the tool's options reads as a sentence, not in the
  // capitals of a field name; and in a table that scrolls sideways, the ticket names stay on top of the
  // columns sliding under them (Safari drew the points fields' arrows over the names).
  if (wants(41)) {
  sectionStart(41);
    const up = await (await browser.newContext({ viewport: { width: 1500, height: 1000 } })).newPage();
    up.on("pageerror", (e) => errors.push(String(e)));
    await up.goto(BASE, { waitUntil: "networkidle" });
    await up.getByRole("button", { name: "Load the example map" }).click();
    await up.waitForTimeout(600);
    await up.locator('.tool-row .tool-button[aria-label="Draw route"]').click();
    await up.waitForTimeout(200);
    const tick = await up.evaluate(() => { const el = document.querySelector(".tool-options .checkbox-row"); const cs = getComputedStyle(el); return { tt: cs.textTransform, ls: cs.letterSpacing }; });
    check("a tick box in the tool's options is written as a sentence, not in capitals", tick.tt === "none" && tick.ls === "normal", JSON.stringify(tick));
    const fieldName = await up.evaluate(() => getComputedStyle(document.querySelector(".tool-options [data-slot=label]")).textTransform);
    check("while the field names above it keep their small capitals", fieldName === "uppercase", fieldName);
    await up.getByRole("button", { name: "Tickets", exact: true }).click();
    await up.waitForTimeout(700);
    const sticky = await up.evaluate(() => { const td = document.querySelector(".tickets-panel .analysis-table tbody td:first-child"); const th = document.querySelector(".tickets-panel .analysis-table thead th:first-child"); return { td: getComputedStyle(td).zIndex, th: getComputedStyle(th).zIndex }; });
    check("the ticket names in a sideways-scrolling table lie above the columns that slide under them", Number(sticky.td) >= 1 && Number(sticky.th) >= 1, JSON.stringify(sticky));
    await up.context().close();
  }

  // 42. Help on hover waits a moment: passing over the tools on the way somewhere opens nothing, and
  // resting on one opens its help. The note that everything is stored in the exported file is one of
  // the figures above the map, not loose text beside them.
  if (wants(42)) {
  sectionStart(42);
    const tp = await (await browser.newContext({ viewport: { width: 1500, height: 1000 } })).newPage();
    tp.on("pageerror", (e) => errors.push(String(e)));
    await tp.goto(BASE, { waitUntil: "networkidle" });
    await tp.getByRole("button", { name: "Load the example map" }).click();
    await tp.waitForTimeout(600);
    const card = tp.locator(".crossing-card.shape-card");
    const box = await card.boundingBox();
    await tp.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await tp.waitForTimeout(250);
    check("passing over a card with help opens nothing at once", (await tp.locator('[role="tooltip"]').count()) === 0);
    await tp.waitForTimeout(900);
    check("resting on it opens its help", (await tp.locator('[role="tooltip"]').count()) > 0);
    await tp.mouse.move(5, 500);
    await tp.waitForTimeout(400);
    const note = tp.locator(".map-status [data-slot=badge]", { hasText: "Everything is stored" });
    check("the note that everything is stored in the exported file is one of the figures above the map", (await note.count()) === 1);
    await tp.context().close();
  }

  // 43. The map is kept in the browser under a neutral name, ttr-map. A map kept under the old name,
  // orebro-map-editor-public-v2, by 0.4.0 and earlier, opens as it was, and so do the settings kept
  // beside it; the old copy is left where it was, so an older build still finds it.
  if (wants(43)) {
  sectionStart(43);
    const ctx = await browser.newContext({ viewport: { width: 1500, height: 1000 } });
    const old = { name: "Kept under the old name", format: "board-2x3", background: [], stops: [{ id: "a", name: "Alpha", type: "city", x: 200, y: 200 }, { id: "b", name: "Beta", type: "city", x: 600, y: 300 }], routes: [{ id: "r1", a: "a", b: "b", length: 4, type: "city", color: "red" }], notes: [], tickets: [], ticketSets: [{ id: "main", label: "Main deck" }] };
    await ctx.addInitScript((map) => { if (sessionStorage.getItem("seeded")) return; sessionStorage.setItem("seeded", "1"); localStorage.clear(); localStorage.setItem("orebro-map-editor-public-v2", JSON.stringify(map)); localStorage.setItem("orebro-map-editor-public-v2-guide-seen", "1"); }, old);
    const op = await ctx.newPage();
    op.on("pageerror", (e) => errors.push(String(e)));
    await op.goto(BASE, { waitUntil: "networkidle" });
    await op.waitForTimeout(600);
    const keys = await op.evaluate(() => ({ now: localStorage.getItem("ttr-map"), old: localStorage.getItem("orebro-map-editor-public-v2"), guide: localStorage.getItem("ttr-guide-seen") }));
    check("a map kept under the old name opens as it was", (await op.locator(".map-title-input, input[aria-label='Map name']").first().inputValue().catch(() => "")) === "Kept under the old name" || (keys.now && JSON.parse(keys.now).name === "Kept under the old name"), keys.now && JSON.parse(keys.now).name);
    check("and is kept from now on under ttr-map", keys.now !== null && JSON.parse(keys.now).stops.length === 2);
    check("the old copy is left where it was, for an older build", keys.old !== null && JSON.parse(keys.old).name === "Kept under the old name");
    check("the settings kept beside it come along: the welcome is not shown again", keys.guide === "1" && (await op.getByRole("button", { name: "Load the example map" }).count()) === 0);
    check("nothing in the editor's storage still uses the old name", (await op.evaluate(() => Object.keys(localStorage).filter((k) => k.startsWith("orebro") && !["orebro-map-editor-public-v2", "orebro-map-editor-public-v2-guide-seen"].includes(k)))).length === 0);
    await ctx.close();
  }

  // 44. Drawing a route between two stops that already have one: it is drawn, since there can be a
  // reason to do it that way, but the editor says so and how a parallel route is added, and offers to
  // make it one: a lane that follows the first route's shape and length, in a colour of its own.
  if (wants(44)) {
  sectionStart(44);
    const dp = await (await browser.newContext({ viewport: { width: 1500, height: 1000 } })).newPage();
    dp.on("pageerror", (e) => errors.push(String(e)));
    await dp.goto(BASE, { waitUntil: "networkidle" });
    await dp.getByRole("button", { name: "Load the example map" }).click();
    await dp.waitForTimeout(600);
    const KEY = "ttr-map";
    const stored = () => dp.evaluate((key) => JSON.parse(localStorage.getItem(key)), KEY);
    const tap = async (name) => { await dp.evaluate((n) => { const s = Array.from(document.querySelectorAll(".map-canvas .stop")).find((g) => Array.from(g.querySelectorAll("text, title")).some((t) => t.textContent === n)); s.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true })); s.dispatchEvent(new PointerEvent("pointerup", { bubbles: true })); }, name); await dp.waitForTimeout(250); };
    const pair = (m, a, b) => { const ia = m.stops.find((s) => s.name === a).id, ib = m.stops.find((s) => s.name === b).id; return m.routes.filter((r) => (r.a === ia && r.b === ib) || (r.a === ib && r.b === ia)); };
    let map = await stored();
    const lanesBefore = pair(map, "Central", "Deepcut").length;
    const first = pair(map, "Central", "Deepcut")[0];
    await dp.locator('.tool-row .tool-button[aria-label="Draw route"]').click();
    await tap("Central"); await tap("Deepcut");
    await dp.waitForTimeout(300);
    map = await stored();
    check("a route between two stops that already have one is still drawn", pair(map, "Central", "Deepcut").length === lanesBefore + 1);
    const warning = (await dp.locator("[data-sonner-toast]").allTextContents()).join(" | ");
    check("but the editor says they already have one", /already/i.test(warning) && /Central/.test(warning) && /Deepcut/.test(warning), warning);
    check("and how to add a parallel route instead", /Add parallel route/.test(warning), warning);
    const instead = dp.getByRole("button", { name: "Make it a parallel route instead" });
    check("and offers to make it one", (await instead.count()) === 1);
    await instead.click();
    await dp.waitForTimeout(400);
    map = await stored();
    const lanes = pair(map, "Central", "Deepcut");
    const lane = lanes.at(-1);
    check("which replaces the route just drawn with a parallel lane", lanes.length === lanesBefore + 1, String(lanes.length));
    check("that follows the first route's length and shape, in a colour of its own", lane.length === first.length && JSON.stringify(lane.points ?? null) === JSON.stringify(first.points ?? null) && lane.type === first.type && !lanes.slice(0, -1).some((other) => other.color === lane.color), JSON.stringify({ lane, first }));
    check("and is selected, showing the parallel lines between the stops", /Parallel lines · 2 between these stops/.test(await dp.locator(".property-form, aside").last().textContent()));
    await dp.keyboard.press("Escape");
    const drawTool = dp.locator('.tool-row .tool-button[aria-label="Draw route"]');
    if ((await drawTool.getAttribute("aria-pressed")) !== "true") await drawTool.click();
    const toastsBefore = await dp.locator("[data-sonner-toast]", { hasText: "already" }).count();
    await tap("Westport"); await tap("Quarry");
    await dp.waitForTimeout(300);
    check("two stops with no route between them draw one without a word", (await dp.locator("[data-sonner-toast]", { hasText: "already" }).count()) <= toastsBefore && pair(await stored(), "Westport", "Quarry").length === 1);
    await dp.context().close();
  }

  // 45. Map balance made easier to act on: it can be widened like the Tickets and Rules panels; each
  // route's room per wagon is marked as fine, too short or roomy; and what the network section warns
  // of comes with something to do about it. Deck rules read in plain words, Generic is the default,
  // and a new map starts with the playtest box in its top right corner.
  if (wants(45)) {
  sectionStart(45);
    const bp = await (await browser.newContext({ viewport: { width: 1500, height: 1000 } })).newPage();
    bp.on("pageerror", (e) => errors.push(String(e)));
    await bp.goto(BASE, { waitUntil: "networkidle" });
    await bp.getByRole("button", { name: "Load the example map" }).click();
    await bp.waitForTimeout(600);
    const KEY = "ttr-map";
    const stored = () => bp.evaluate((key) => JSON.parse(localStorage.getItem(key)), KEY);
    const edit = async (src) => { await bp.evaluate(([key, code]) => { const m = JSON.parse(localStorage.getItem(key)); (new Function("m", code))(m); localStorage.setItem(key, JSON.stringify(m)); }, [KEY, src]); await bp.reload({ waitUntil: "networkidle" }); await bp.waitForTimeout(500); };
    await bp.getByRole("button", { name: "Map balance", exact: true }).click();
    await bp.waitForTimeout(700);
    const panel = bp.locator(".balance-panel").first();
    const widen = panel.getByRole("button", { name: "Expand" });
    check("Map balance can be expanded like the Tickets and Rules panels", (await widen.count()) === 1);
    const narrow = (await panel.boundingBox()).width;
    await widen.click();
    await bp.waitForTimeout(500);
    check("and is wider when it is", (await panel.boundingBox()).width > narrow + 50 && (await panel.getByRole("button", { name: "Collapse" }).count()) === 1);
    await panel.getByRole("button", { name: "Collapse" }).click();
    await bp.waitForTimeout(400);
    const marks = await bp.evaluate(() => Array.from(document.querySelectorAll(".balance-panel .room-mark")).map((m) => ({ cls: m.className, text: m.textContent.trim(), bg: getComputedStyle(m).backgroundColor })));
    check("every route's room per wagon is marked: fine, too short or roomy", marks.length > 0 && marks.every((m) => /\b(ok|short|long)\b/.test(m.cls) && /^(OK|Too short|Roomy)$/.test(m.text)), JSON.stringify(marks.slice(0, 3)));
    check("each in a colour of its own", new Set(marks.map((m) => m.bg)).size === new Set(marks.map((m) => m.cls)).size && marks.every((m) => m.bg !== "rgba(0, 0, 0, 0)"), JSON.stringify([...new Set(marks.map((m) => m.cls + " " + m.bg))]));
    // A cape behind one lane: the network section offers to add a second.
    await edit(`const t = m.routes[0].type; m.stops.push({ id: "cape", name: "Cape", type: "city", x: 1060, y: 60 }); m.routes.push({ id: "r-cape", a: "example-eastgate", b: "cape", length: 2, type: t, color: "green" });`);
    await bp.getByRole("button", { name: "Map balance", exact: true }).click();
    await bp.waitForTimeout(700);
    const second = bp.locator(".network-shape").getByRole("button", { name: "Add a second lane" });
    check("a route with one lane that cuts the map in two comes with a button to add a second lane", (await second.count()) === 1);
    await second.click();
    await bp.waitForTimeout(500);
    const lanes = (await stored()).routes.filter((r) => (r.a === "cape" || r.b === "cape")).length;
    check("which adds it, so the cape is a dead end behind a double route, as Edinburgh is", lanes === 2 && !(await bp.locator(".crossing-card.shape-card").evaluate((el) => el.classList.contains("has-warning"))), String(lanes));
    // A stop with no route: the section offers to select it.
    await edit(`m.stops.push({ id: "alone", name: "Alone", type: "city", x: 560, y: 40 });`);
    await bp.getByRole("button", { name: "Map balance", exact: true }).click();
    await bp.waitForTimeout(700);
    const pick = bp.locator(".network-shape").getByRole("button", { name: "Select Alone" });
    check("a stop with no route comes with a button that selects it", (await pick.count()) === 1);
    if (await pick.count()) { await pick.click(); await bp.waitForTimeout(400); }
    const fields = await bp.locator("aside.properties input").evaluateAll((els) => els.map((el) => el.value));
    check("and selecting it shows the stop, ready to connect or delete", fields.includes("Alone") && (await bp.getByRole("button", { name: "Delete stop" }).count()) === 1, JSON.stringify(fields.slice(0, 4)));
    // Deck rules, in plain words.
    await bp.getByRole("button", { name: "Settings" }).click();
    await bp.waitForTimeout(400);
    await bp.locator(".settings-nav-item", { hasText: /deck rules/i }).click();
    await bp.waitForTimeout(400);
    await bp.getByRole("radio", { name: "Classic", exact: true }).check();
    await bp.waitForTimeout(300);
    const rules = (await bp.locator(".deck-rule-values").textContent()).replace(/\s+/g, " ");
    check("ticket lengths are said in words: how many of the tickets are how long, as a share of reach", /of the tickets/i.test(rules) && /of reach/i.test(rules) && !/across the map/i.test(rules) && !/% < 30 %/.test(rules), rules.slice(0, 300));
    check("the bonus says what it is: extra points for the longest tickets, +1 and +2", /Extra points for the longest tickets/.test(rules) && /\+1/.test(rules) && /\+2/.test(rules), rules.slice(0, 400));
    await bp.keyboard.press("Escape");
    // A new map starts with the playtest box, in its top right corner.
    await bp.evaluate(() => localStorage.clear());
    await bp.reload({ waitUntil: "networkidle" });
    await bp.waitForTimeout(500);
    const blank = bp.getByRole("button", { name: /blank/i }).first();
    if (await blank.count()) { await blank.click(); await bp.waitForTimeout(600); }
    const fresh = await stored();
    const box = fresh && fresh.notes.find((n) => n.kind === "playtest");
    check("a new, empty map starts with the playtest box", Boolean(box), JSON.stringify(fresh && fresh.notes));
    check("in its top right corner", box && box.x + box.width >= 1100 - 20 && box.y <= 24, JSON.stringify(box));
    await bp.context().close();
  }

  // 46. Damaged files in the editor: one that is not a map is refused and the map stays as it was; a map
  // with damaged parts opens with what can be used and says what was left out; and a map kept in the
  // browser that cannot be read is put aside, not overwritten, and the editor still starts.
  if (wants(46)) {
  sectionStart(46);
    const cp2 = await (await browser.newContext({ viewport: { width: 1500, height: 1000 } })).newPage();
    const pageErrors = [];
    cp2.on("pageerror", (e) => { pageErrors.push(String(e)); errors.push(String(e)); });
    await cp2.goto(BASE, { waitUntil: "networkidle" });
    await cp2.getByRole("button", { name: "Load the example map" }).click();
    await cp2.waitForTimeout(600);
    const KEY = "ttr-map";
    const stored = () => cp2.evaluate((key) => localStorage.getItem(key), KEY);
    const before = await stored();
    const toasts = async () => (await cp2.locator("[data-sonner-toast]").allTextContents()).join(" | ");
    const importText = async (name, text) => { const file = path.join(os.tmpdir(), `ttr-${Date.now()}-${name}`); fs.writeFileSync(file, text); await cp2.locator('input[type="file"][accept="application/json"]').setInputFiles(file); await cp2.waitForTimeout(700); };
    await importText("not-json.json", "this is not json {");
    check("a file that is not JSON is refused, with a message, and the map stays as it was", /could not be read|not a map/i.test(await toasts()) && (await stored()) === before, await toasts());
    await importText("a-list.json", "[1, 2, 3]");
    check("a JSON file that holds no map is refused too, with its own reason", /holds no map, network, background or tickets/i.test(await toasts()) && (await stored()) === before, await toasts());
    await importText("another-tool.json", JSON.stringify({ name: "some-package", version: "1.0.0", nodes: [], links: [] }));
    check("a JSON file with none of a map's parts is refused too, and the map stays as it was", /holds no map, network, background or tickets/i.test(await toasts()) && (await stored()) === before, await toasts());
    const damaged = { format: "ticket-to-ride-map", version: 3, kind: "map", payload: { name: "Mended", stops: [{ id: "a", name: "Alpha", type: "city", x: 200, y: 200 }, { id: "b", name: "Beta", type: "city", x: 600, y: 300 }, null, { id: "c", name: "Nowhere" }], routes: [{ id: "r1", a: "a", b: "b", length: 4, type: "city", color: "red" }, { id: "r2", a: "a", b: "ghost", length: 2, type: "city", color: "red" }], tickets: [], ticketSets: [{ id: "main", label: "Main deck" }], notes: [], background: [] } };
    await importText("damaged.json", JSON.stringify(damaged));
    const opened = JSON.parse(await stored());
    check("a map with damaged parts opens with what can be used", opened.name === "Mended" && opened.stops.length === 2 && opened.routes.length === 1, `${opened.name}: ${opened.stops.length} stops, ${opened.routes.length} routes`);
    check("and says what was left out", /2 stops left out/.test(await toasts()) && /1 route left out/.test(await toasts()), await toasts());
    // A map in the browser that cannot be read: put aside, the editor starts, and it says so.
    await cp2.evaluate((key) => localStorage.setItem(key, '{"name":"cut short","stops":[{"id":"a"'), KEY);
    await cp2.reload({ waitUntil: "networkidle" });
    await cp2.waitForTimeout(800);
    const aside = await cp2.evaluate(() => Object.keys(localStorage).filter((k) => k.startsWith("ttr-map-unreadable-")).map((k) => localStorage.getItem(k)));
    check("a map kept in the browser that cannot be read is put aside, word for word", aside.length === 1 && aside[0] === '{"name":"cut short","stops":[{"id":"a"', JSON.stringify(aside));
    check("and the editor still starts, saying what happened", (await cp2.locator(".map-canvas").count()) === 1 && /could not be read/i.test(await toasts() + " " + (await cp2.locator('[role="dialog"]').allTextContents()).join(" ")), await toasts());
    // When there is no room to put the unreadable map aside, it must not be overwritten at once either
    // (found in the 1.0 review): the copy is made to fail, and the original has to be where it was.
    const cut = '{"name":"cut short, no room","stops":[{"id":"a"';
    await cp2.evaluate(([key, text]) => {
      Object.keys(localStorage).filter((k) => k.startsWith("ttr-map-unreadable-")).forEach((k) => localStorage.removeItem(k));
      localStorage.setItem(key, text); sessionStorage.setItem("failcopy", "1");
    }, [KEY, cut]);
    await cp2.addInitScript(() => {
      const set = Storage.prototype.setItem;
      Storage.prototype.setItem = function (k, v) { if (sessionStorage.getItem("failcopy") && String(k).includes("-unreadable-")) throw new DOMException("full", "QuotaExceededError"); return set.call(this, k, v); };
    });
    await cp2.reload({ waitUntil: "networkidle" });
    await cp2.waitForTimeout(800);
    check("with no room to put an unreadable map aside, it stays where it was and the editor still starts", (await stored()) === cut && (await cp2.locator(".map-canvas").count()) === 1, String(await stored()).slice(0, 60));
    check("and says it was not put aside", /no room to put a copy aside/i.test(await toasts()), await toasts());
    await cp2.evaluate(() => sessionStorage.removeItem("failcopy"));
    // A stored map with damaged parts opens mended, without an error on the page.
    await cp2.evaluate((key) => localStorage.setItem(key, JSON.stringify({ name: "Half", stops: [{ id: "a", name: "A", type: "city", x: "NaN", y: 3 }, { id: "b", name: "B", type: "city", x: 10, y: 10 }, { id: "c", name: "C", type: "city", x: 300, y: 300 }], routes: [{ id: "r", a: "b", b: "c", length: -3, type: "city", color: "red", points: "x" }], tickets: [{ id: "t", a: "b", b: "c", points: null }], notes: [null], background: [{ id: "x" }] })), KEY);
    const errorsBefore = pageErrors.length;
    await cp2.reload({ waitUntil: "networkidle" });
    await cp2.waitForTimeout(800);
    check("a stored map with damaged parts opens mended, with no error on the page", pageErrors.length === errorsBefore && (await cp2.locator(".map-canvas .stop").count()) === 2 && (await cp2.locator(".map-canvas .route-group").count()) >= 1, `${pageErrors.length - errorsBefore} errors`);
    await cp2.context().close();
  }

  // 47. Smaller windows: at 1280 × 720 the map stays clear of the Properties column; on a tablet the
  // page never scrolls sideways; on a phone the header's buttons all show, and the map pans inside its
  // own area (it keeps a width where a finger can hit a wagon space) without the page scrolling.
  if (wants(47)) sectionStart(47);
  if (wants(47)) for (const [w, h, mobile] of [[1280, 720, false], [1024, 768, false], [768, 1024, true], [390, 844, true]]) {
    const sp2 = await (await browser.newContext({ viewport: { width: w, height: h }, isMobile: mobile, hasTouch: mobile })).newPage();
    sp2.on("pageerror", (e) => errors.push(String(e)));
    await sp2.goto(BASE, { waitUntil: "networkidle" });
    await sp2.getByRole("button", { name: "Load the example map" }).click();
    await sp2.waitForTimeout(700);
    const m = await sp2.evaluate(() => { const box = (sel) => { const el = document.querySelector(sel); return el ? el.getBoundingClientRect() : null; }; const canvas = box(".map-canvas"), wrap = box(".map-wrap"), props = box("aside.properties"); return { scroll: document.documentElement.scrollWidth, client: document.documentElement.clientWidth, canvasRight: canvas.right, wrapRight: wrap.right, propsLeft: props.left, propsTop: props.top, wrapBottom: wrap.bottom }; });
    check(`${w} × ${h}: the page does not scroll sideways`, m.scroll <= m.client + 1, `${m.scroll} wide in ${m.client}`);
    if (w >= 1051) check(`${w} × ${h}: the map stays clear of the Properties column`, m.canvasRight <= m.propsLeft + 1, `map ends at ${Math.round(m.canvasRight)}, Properties begins at ${Math.round(m.propsLeft)}`);
    else if (w > 720) check(`${w} × ${h}: the map fits its area`, m.canvasRight <= m.wrapRight + 1, `${Math.round(m.canvasRight)} against ${Math.round(m.wrapRight)}`);
    if (w <= 720) { await sp2.locator("#phone-menu").tap(); await sp2.waitForTimeout(300); }
    const exportBox = await sp2.getByRole("button", { name: "Export", exact: true }).boundingBox();
    check(`${w} × ${h}: every button in the header can be seen${w <= 720 ? " (from the menu)" : ""}, Export too`, exportBox && exportBox.x >= 0 && exportBox.x + exportBox.width <= w + 1, JSON.stringify(exportBox));
    await sp2.context().close();
  }

  // 48. Starting over: in Settings, under Map, not at the foot of the tools. It says what goes, offers
  // to export first, asks before it does anything, and Undo brings the map back.
  if (wants(48)) {
  sectionStart(48);
    const op2 = await (await browser.newContext({ viewport: { width: 1500, height: 1000 }, acceptDownloads: true })).newPage();
    op2.on("pageerror", (e) => errors.push(String(e)));
    await op2.goto(BASE, { waitUntil: "networkidle" });
    await op2.getByRole("button", { name: "Load the example map" }).click();
    await op2.waitForTimeout(600);
    // A map that has been changed: an unchanged example of the editor's own is replaced without a question.
    await op2.evaluate(() => { const m = JSON.parse(localStorage.getItem("ttr-map")); m.name = "My own map"; localStorage.setItem("ttr-map", JSON.stringify(m)); }); await op2.reload({ waitUntil: "networkidle" }); await op2.waitForTimeout(600);
    const stored = () => op2.evaluate(() => JSON.parse(localStorage.getItem("ttr-map")));
    check("there is no Clear map button among the tools any more", (await op2.getByRole("button", { name: "Clear map" }).count()) === 0);
    await op2.getByRole("button", { name: "Settings" }).click();
    await op2.waitForTimeout(300);
    await op2.locator(".settings-nav-item", { hasText: /^Map/ }).click();
    const section = op2.locator(".start-over");
    check("Settings, under Map, has a Start over section that says what it does", (await section.count()) === 1 && /empty map/i.test(await section.textContent()) && /export/i.test(await section.textContent()), await section.textContent().catch(() => ""));
    check("with a way to export the map first", (await section.getByRole("button", { name: "Export the map first" }).count()) === 1);
    await section.getByRole("button", { name: "Start over…" }).click();
    await op2.waitForTimeout(300);
    const confirm = op2.getByRole("alertdialog");
    const confirmText = (await confirm.textContent()).replace(/\s+/g, " ");
    check("it asks first, naming what goes: stops, routes, tickets, rules, notes and background", /Start over with an empty map\?/.test(confirmText) && ["stops", "routes", "tickets", "rules", "notes", "background"].every((w) => confirmText.includes(w)), confirmText);
    const download = op2.waitForEvent("download");
    await confirm.getByRole("button", { name: "Export first" }).click();
    const saved = await download;
    check("the confirmation itself can export the map first", /\.json$/.test(saved.suggestedFilename()) && (await op2.getByRole("alertdialog").count()) === 1, saved.suggestedFilename());
    await op2.getByRole("alertdialog").getByRole("button", { name: "Cancel" }).click();
    await op2.waitForTimeout(300);
    check("Cancel leaves the map as it was", (await stored()).stops.length === 15);
    await op2.getByRole("button", { name: "Settings" }).click();
    await op2.waitForTimeout(300);
    await op2.locator(".settings-nav-item", { hasText: /^Map/ }).click();
    await op2.getByRole("button", { name: "Start over…" }).click();
    await op2.waitForTimeout(300);
    await op2.getByRole("alertdialog").getByRole("button", { name: "Start over", exact: true }).click();
    await op2.waitForTimeout(500);
    const fresh = await stored();
    check("starting over leaves an empty map, with the playtest box in its corner", fresh.stops.length === 0 && fresh.routes.length === 0 && fresh.tickets.length === 0 && !fresh.rules && fresh.notes.length === 1 && fresh.notes[0].kind === "playtest" && fresh.name === "New map", JSON.stringify({ stops: fresh.stops.length, notes: fresh.notes.length, name: fresh.name }));
    await op2.getByRole("button", { name: "Undo" }).click();
    await op2.waitForTimeout(400);
    check("and Undo brings the map back", (await stored()).stops.length === 15);
    await op2.context().close();
  }

  // 49. Printing and PDF: the rules can be printed alone from the Rules panel; the print dialog says it
  // saves a PDF too; a run is titled so the saved file is named after the map, its version, what it
  // holds and the date; and a page of the balance figures can go with it, as they stood.
  if (wants(49)) {
  sectionStart(49);
    const pp = await (await browser.newContext({ viewport: { width: 1500, height: 1000 } })).newPage();
    pp.on("pageerror", (e) => errors.push(String(e)));
    await pp.goto(BASE, { waitUntil: "networkidle" });
    await pp.getByRole("button", { name: "Load the example map" }).click();
    await pp.waitForTimeout(600);
    const stub = () => pp.evaluate(() => { window.__run = null; window.print = () => { const root = document.querySelector(".print-pages"); window.__run = { title: document.title, boards: root.querySelectorAll(".print-page").length, cards: root.querySelectorAll(".ticket-card").length, rules: root.querySelectorAll(".print-rules").length, balance: (root.querySelector(".print-balance") || { textContent: "" }).textContent.replace(/\s+/g, " ") }; }; });
    const run = async () => { await pp.waitForFunction(() => window.__run !== null, null, { timeout: 5000 }); await pp.waitForTimeout(300); return pp.evaluate(() => window.__run); };
    const today = await pp.evaluate(() => { const d = new Date(); const z = (n) => String(n).padStart(2, "0"); return `${d.getFullYear()}-${z(d.getMonth() + 1)}-${z(d.getDate())}`; });
    // The rules alone, from the Rules panel.
    await pp.getByRole("button", { name: "Rules", exact: true }).click();
    await pp.waitForTimeout(400);
    await stub();
    await pp.locator(".rules-panel").getByRole("button", { name: "Print the rules" }).click();
    const rulesRun = await run();
    check("the Rules panel prints the rules alone", rulesRun.rules === 1 && rulesRun.boards === 0 && rulesRun.cards === 0, JSON.stringify(rulesRun));
    check("titled for a file named after the map, its version, the rules and the date", rulesRun.title.startsWith("Example map · v1 · rules · ") && rulesRun.title.endsWith(today), rulesRun.title);
    check("and the page's own title is back after the print", !/· rules ·/.test(await pp.title()), await pp.title());
    // The last choice being "one page the size of the board" must not make the rules print on pages that
    // big (found in the 1.0 review).
    await pp.getByRole("button", { name: "Print map" }).click();
    await pp.waitForTimeout(400);
    await pickSplit(pp.getByRole("dialog", { name: "Print the map" }), "page");
    await pp.getByRole("dialog", { name: "Print the map" }).getByRole("button", { name: "Cancel" }).click();
    await pp.waitForTimeout(300);
    await pp.evaluate(() => { window.__run = null; window.print = () => { window.__run = { style: [...document.querySelectorAll(".print-pages style")].map((e) => e.textContent).join(" ") }; }; });
    await pp.locator(".rules-panel").getByRole("button", { name: "Print the rules" }).click();
    const bigRun = await run();
    check("the rules are not printed on pages the size of the board, whatever the last choice was", !/810mm|790mm/.test(bigRun.style) && /size:\s*\d+mm \d+mm/.test(bigRun.style), bigRun.style.slice(0, 200));
    await pp.getByRole("button", { name: "Print map" }).click();
    await pp.waitForTimeout(400);
    await pickSplit(pp.getByRole("dialog", { name: "Print the map" }), "panel");
    await pp.getByRole("dialog", { name: "Print the map" }).getByRole("button", { name: "Cancel" }).click();
    await pp.waitForTimeout(300);
    await stub();
    // The print dialog: PDF, the balance page, the file name.
    await pp.getByRole("button", { name: "Print map" }).click();
    await pp.waitForTimeout(400);
    const dialog = pp.getByRole("dialog", { name: "Print the map" });
    check("the print dialog says it can save a PDF, and how", /Save as PDF/.test(await dialog.textContent()));
    const balance = dialog.getByRole("checkbox", { name: "Print a page of the balance figures", exact: true });
    check("it offers a page of the balance figures, not ticked unless asked for", (await balance.count()) === 1 && !(await balance.isChecked()));
    await balance.check();
    if (!(await dialog.getByRole("checkbox", { name: "Print the rules", exact: true }).isChecked())) await dialog.getByRole("checkbox", { name: "Print the rules", exact: true }).check();
    await stub();
    await dialog.getByRole("button", { name: "Print", exact: true }).click();
    const full = await run();
    check("a run's title names what it holds: board, rules and balance", /^Example map · v[0-9]+ · board, rules, balance · [0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(full.title), full.title);
    check("the balance page has the figures as they stand", ["stops", "routes", "crossings", "dead end", "crowded", "Grey", "Version "].every((w) => full.balance.includes(w)), full.balance.slice(0, 400));
    // The balance page alone is a run of its own.
    await pp.getByRole("button", { name: "Print map" }).click();
    await pp.waitForTimeout(400);
    for (const name of ["Print the board", "Print the tickets", "Print the rules"]) { const box = dialog.getByRole("checkbox", { name, exact: true }); if (await box.isChecked()) await box.uncheck(); }
    check("with only the balance page ticked, there is still something to print, and the dialog says what", await dialog.getByRole("button", { name: "Print", exact: true }).isEnabled() && /network, crossings/i.test(await dialog.locator("#print-balance-note").textContent()), await dialog.locator("#print-balance-note").textContent());
    await stub();
    await dialog.getByRole("button", { name: "Print", exact: true }).click();
    const alone = await run();
    check("and it prints the balance page alone", alone.boards === 0 && alone.cards === 0 && alone.rules === 0 && /Map balance/.test(alone.balance), JSON.stringify({ ...alone, balance: alone.balance.slice(0, 40) }));
    await pp.context().close();
  }

  // 50. Every balance figure beside the official range, as a fact: crowded routes at a full table,
  // traffic on double routes against single ones, routes no ticket needs, most tickets on one stop,
  // and the average hub degree.
  if (wants(50)) {
  sectionStart(50);
    const ob = await (await browser.newContext({ viewport: { width: 1500, height: 1000 } })).newPage();
    ob.on("pageerror", (e) => errors.push(String(e)));
    await ob.goto(BASE, { waitUntil: "networkidle" });
    await ob.getByRole("button", { name: "Load the example map" }).click();
    await ob.waitForTimeout(600);
    await ob.getByRole("button", { name: "Map balance", exact: true }).click();
    await ob.waitForTimeout(800);
    const section = ob.locator(".analysis-section.against-official");
    // The table fits the column: no sideways scroll, the labels have room to read (one that was squeezed into
    // a sliver, five lines to a label, was seen on screen) and the figures sit beside them.
    const fit = await section.locator(".official-table").evaluate((table) => { const box = table.parentElement; const first = table.querySelector("tbody td").getBoundingClientRect(); const lines = Math.round(table.querySelector("tbody td").getBoundingClientRect().height / parseFloat(getComputedStyle(table.querySelector("tbody td")).lineHeight || "16")); return { overflow: box.scrollWidth - box.clientWidth, firstWidth: Math.round(first.width), box: box.clientWidth, lines }; });
    check("the table of official figures fits its column without scrolling sideways", fit.overflow <= 1, JSON.stringify(fit));
    check("and its labels are wide enough to read, not squeezed into a sliver", fit.firstWidth >= fit.box * 0.4, JSON.stringify(fit));
    check("Map balance opens with the map against the official maps", (await section.count()) === 1 && (await ob.locator(".balance-panel .analysis-section").first().evaluate((el) => el.classList.contains("against-official"))));
    const rows = await section.locator("tbody tr").evaluateAll((trs) => trs.map((tr) => Array.from(tr.cells).map((c) => c.textContent.trim())));
    const labels = rows.map((r) => r[0]).join(" | ");
    check("with crowded routes, double-route traffic, unneeded routes, the busiest stop and the hub degree", ["Crowded routes", "Double routes", "no ticket needs", "one stop", "Wagons at a full table", "hub degree"].every((w) => labels.includes(w)), labels);
    const wagonRow = rows.find((r) => /^Wagons at a full table/.test(r[0]));
    check("the wagon count is one of them: this map's share beside 57–76 %", wagonRow && /\d+ %/.test(wagonRow[1]) && /3 × 28 wagons for 95 spaces/.test(wagonRow[1]) && wagonRow[2] === "57–76 %", JSON.stringify(wagonRow));
    check("each with this map's figure and the official range", rows.every((r) => r.length === 3 && r[1] !== "" && /\d.*–.*\d/.test(r[2])), JSON.stringify(rows));
    const crowdedRow = rows.find((r) => /^Crowded routes/.test(r[0])) || [];
    check("crowding is a share of the connections, since a count grows with the size of the map", /as a share of all connections/.test(crowdedRow[0] || "") && /^\d+ % \(\d+ of \d+ connections, at \d players?\)$/.test(crowdedRow[1] || "") && /^\d+–\d+ %$/.test(crowdedRow[2] || ""), JSON.stringify(crowdedRow));
    check("and nothing in it is a warning", (await section.locator(".has-warning, .helper-warning, .analysis-warning-row").count()) === 0);
    check("the hub degree advice is the official range, not a guess", !/roughly 4–6/.test(await ob.locator("body").textContent()));
    await ob.context().close();
  }

  // 51. A deck's tension: a slider from calm through like the official maps to tense, 50 unless the map
  // says otherwise. Chosen when a full deck is built, and set for the map in its deck rules, which the
  // build then starts from. It is stored as a number from 0 to 100.
  if (wants(51)) {
  sectionStart(51);
    const tp2 = await (await browser.newContext({ viewport: { width: 1500, height: 1000 } })).newPage();
    tp2.on("pageerror", (e) => errors.push(String(e)));
    await tp2.goto(BASE, { waitUntil: "networkidle" });
    await tp2.getByRole("button", { name: "Load the example map" }).click();
    await tp2.waitForTimeout(600);
    const openBuild = async () => { await tp2.getByRole("button", { name: "Tickets", exact: true }).click(); await tp2.waitForTimeout(400); await tp2.getByRole("button", { name: /Add a deck/ }).click(); await tp2.waitForTimeout(250); await tp2.getByRole("menuitem", { name: /Build a full deck of tickets/ }).click(); await tp2.waitForSelector(".suggest-dialog", { timeout: 20000 }); await tp2.waitForTimeout(400); };
    await openBuild();
    const slider = tp2.locator(".suggest-dialog").getByRole("slider", { name: /Tension/ });
    const preset = (name) => tp2.locator(".suggest-dialog").getByRole("button", { name, exact: true });
    const description = () => tp2.locator(".suggest-dialog .tension-description").textContent();
    const rebuilt = () => tp2.waitForFunction(() => { const row = [...document.querySelectorAll(".suggest-table tbody tr")].find((tr) => tr.children[0].textContent.trim() === "Score"); return row && row.children[2].textContent.trim() !== "—"; }, null, { timeout: 30000 });
    // The number beside the slider sits clear of the scroll bar of the dialog's scrolling part (it was
    // seen hidden behind it in Safari).
    const clear = await tp2.locator(".suggest-scroll").evaluate((box) => { const value = box.querySelector(".tension-slider-value").getBoundingClientRect(); const edge = box.getBoundingClientRect().left + box.clientWidth; return Math.round(edge - value.right); });
    check("the number beside the slider is clear of the dialog's scroll bar", clear >= 12, `${clear} px`);
    check("Build a full deck of tickets asks how tense, on a slider from 0 to 100", (await slider.count()) === 1 && (await slider.getAttribute("min")) === "0" && (await slider.getAttribute("max")) === "100");
    check("like the official maps (50), unless the map says otherwise", (await slider.inputValue()) === "50" && (await preset("Like the official maps").getAttribute("aria-pressed")) === "true");
    check("and the map holds no tension until one is chosen", (await tp2.evaluate(() => JSON.parse(localStorage.getItem("ttr-map")).deckTension)) === undefined);
    check("the three named places are buttons beside it", (await preset("Calm").count()) === 1 && (await preset("Tense").count()) === 1);
    let text = (await description()).replace(/\s+/g, " ");
    check("it says what the place means, with figures to compare with the official decks", /Like the official maps/.test(text) && /tickets per lane/.test(text) && /official decks/.test(text), text.slice(0, 260));
    // Calm: a little calmer than the calmest official map.
    await slider.focus();
    await tp2.keyboard.press("Home");
    await rebuilt();
    text = (await description()).replace(/\s+/g, " ");
    check("the lowest end is calm, said to be a little calmer than the calmest official map", (await slider.inputValue()) === "0" && /^Calm\./.test(text) && /calmer than the calmest official/.test(text), text.slice(0, 200));
    // A screen reader on a phone moves a slider with change events only: no key goes up and no pointer is lifted. The choice is
    // made when the value has stopped changing for a moment (and not at every step along the way).
    await slider.evaluate((el) => { const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set; for (const v of ["20", "45", "70"]) { set.call(el, v); el.dispatchEvent(new Event("input", { bubbles: true })); el.dispatchEvent(new Event("change", { bubbles: true })); } });
    await tp2.waitForTimeout(150);
    check("moved by change events alone, the number follows at once and the choice is not made at every step", (await tp2.locator(".suggest-dialog .tension-slider-value").textContent()).trim() === "70" && (await tp2.evaluate(() => JSON.parse(localStorage.getItem("ttr-map")).deckTension)) === 0);
    await tp2.waitForTimeout(1800);
    check("and is made once it has stopped changing, with no key or pointer to say so: 70", (await tp2.evaluate(() => JSON.parse(localStorage.getItem("ttr-map")).deckTension)) === 70);
    await rebuilt();
    await slider.focus();
    await tp2.keyboard.press("Home");
    await rebuilt();
    // A place between: clicking the slider where a person would.
    const box = await slider.boundingBox();
    await tp2.mouse.click(box.x + box.width * 0.75, box.y + box.height / 2);
    await rebuilt();
    const between = Number(await slider.inputValue());
    text = (await description()).replace(/\s+/g, " ");
    check("a place in between is a value in between, described as between like the official maps and tense", between >= 65 && between <= 85 && /^Between like the official maps and tense\./.test(text), `${between} ${text.slice(0, 120)}`);
    check("with figures that lie between the two ends", (() => { const top = Number((/about (\d+) tickets per lane/.exec(text) || [])[1]); return top > 7 && top < 17; })(), text.slice(0, 300));
    // The extreme: a little tenser than the tensest.
    await slider.focus();
    await tp2.keyboard.press("End");
    await rebuilt();
    text = (await description()).replace(/\s+/g, " ");
    check("the top end is tense, said to be a little tenser than the tensest official map", (await slider.inputValue()) === "100" && /^Tense\./.test(text) && /tenser than the tensest official/.test(text), text.slice(0, 200));
    await preset("Calm").click();
    await rebuilt();
    check("a named place sets the slider", (await slider.inputValue()) === "0" && (await preset("Calm").getAttribute("aria-pressed")) === "true");
    await preset("Tense").click();
    await rebuilt();
    check("choosing one builds the deck again", (await slider.inputValue()) === "100" && (await preset("Tense").getAttribute("aria-pressed")) === "true");
    check("and the choice is kept with the map, so it is not lost when the dialog closes", (await tp2.evaluate(() => JSON.parse(localStorage.getItem("ttr-map")).deckTension)) === 100);
    await tp2.keyboard.press("Escape");
    await tp2.waitForTimeout(400);
    // The map's own choice, in its deck rules.
    await tp2.getByRole("button", { name: "Settings" }).click();
    await tp2.waitForTimeout(400);
    await tp2.locator(".settings-nav-item", { hasText: /deck rules/i }).click();
    await tp2.waitForTimeout(400);
    const mapSlider = tp2.locator(".deck-tension-choice").getByRole("slider", { name: /Tension/ });
    check("the deck rules have the map's own tension, which is what was chosen in Build a full deck", (await mapSlider.count()) === 1 && (await mapSlider.inputValue()) === "100");
    await mapSlider.focus();
    await tp2.keyboard.press("End");
    await tp2.waitForTimeout(300);
    check("which is kept in the map as a number", (await tp2.evaluate(() => JSON.parse(localStorage.getItem("ttr-map")).deckTension)) === 100);
    await tp2.locator(".deck-tension-choice").getByRole("button", { name: "Like the official maps", exact: true }).click();
    await tp2.waitForTimeout(300);
    check("and stays in the map even at 50, a choice made on purpose", (await tp2.evaluate(() => JSON.parse(localStorage.getItem("ttr-map")).deckTension)) === 50);
    await mapSlider.focus();
    await tp2.keyboard.press("Home");
    await tp2.waitForTimeout(300);
    await tp2.keyboard.press("Escape");
    await tp2.waitForTimeout(400);
    await tp2.keyboard.press("Escape");
    await openBuild();
    check("and a full deck starts from it", (await slider.inputValue()) === "0");
    await tp2.context().close();
  }

  // 52. Intended chokepoints and hubs: marked in Properties, kept in the map, and listed in Map balance
  // as on purpose instead of among the crowded routes.
  if (wants(52)) {
  sectionStart(52);
    const ip = await (await browser.newContext({ viewport: { width: 1500, height: 1000 } })).newPage();
    ip.on("pageerror", (e) => errors.push(String(e)));
    await ip.goto(BASE, { waitUntil: "networkidle" });
    await ip.getByRole("button", { name: "Load the example map" }).click();
    await ip.waitForTimeout(600);
    const stored = () => ip.evaluate(() => JSON.parse(localStorage.getItem("ttr-map")));
    // A stop: select Central, mark it a hub.
    await ip.evaluate(() => { const s = Array.from(document.querySelectorAll(".map-canvas .stop")).find((g) => Array.from(g.querySelectorAll("text, title")).some((t) => t.textContent === "Central")); s.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true })); s.dispatchEvent(new PointerEvent("pointerup", { bubbles: true })); });
    await ip.waitForTimeout(400);
    const hub = ip.getByRole("checkbox", { name: "A hub on purpose" });
    check("a stop can be marked a hub on purpose in Properties", (await hub.count()) === 1 && !(await hub.isChecked()));
    await hub.check();
    await ip.waitForTimeout(300);
    check("which is kept in the map", (await stored()).stops.find((s) => s.name === "Central").hub === true);
    // A route of two lanes: marking one marks the pair.
    const pair = await ip.evaluate(() => { const m = JSON.parse(localStorage.getItem("ttr-map")); const key = (r) => [r.a, r.b].sort().join("|"); const counts = {}; for (const r of m.routes) counts[key(r)] = (counts[key(r)] || 0) + 1; const r = m.routes.find((x) => counts[key(x)] === 2); return { id: r.id, key: key(r) }; });
    await ip.evaluate((id) => { const g = document.querySelector(`.map-canvas .route-group[data-route-id="${id}"]`); g.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true })); g.dispatchEvent(new PointerEvent("pointerup", { bubbles: true })); }, pair.id);
    await ip.waitForTimeout(400);
    const contested = ip.getByRole("checkbox", { name: "Contested on purpose" });
    check("a route can be marked contested on purpose in Properties", (await contested.count()) === 1);
    await contested.check();
    await ip.waitForTimeout(300);
    const lanes = (await stored()).routes.filter((r) => [r.a, r.b].sort().join("|") === pair.key);
    check("which marks every lane between the two stops", lanes.length === 2 && lanes.every((r) => r.contested === true), JSON.stringify(lanes.map((r) => r.contested)));
    await ip.keyboard.press("Escape");
    // Map balance: crowded on purpose, listed as such.
    await ip.evaluate((ids) => { const m = JSON.parse(localStorage.getItem("ttr-map")); const a = m.routes.find((r) => r.id === ids).a, b = m.routes.find((r) => r.id === ids).b; for (let i = 0; i < 8; i++) m.tickets.push({ id: `t-crowd-${i}`, a, b, points: 5, set: "main" }); localStorage.setItem("ttr-map", JSON.stringify(m)); }, pair.id);
    await ip.reload({ waitUntil: "networkidle" });
    await ip.waitForTimeout(600);
    await ip.getByRole("button", { name: "Map balance", exact: true }).click();
    await ip.waitForTimeout(800);
    const crowding = (await ip.locator(".analysis-section.bottlenecks").textContent()).replace(/\s+/g, " ");
    check("Map balance lists a route crowded on purpose as on purpose", /on purpose/i.test(crowding) && (await ip.locator(".bottleneck-row.on-purpose").count()) >= 1, crowding.slice(0, 300));
    await ip.context().close();
  }

  // 53. Pictures where words fall short, drawn from the editor's own data: a stop type as the map draws
  // it, beside its settings (and no drawing of the print's sheets in the print dialog).
  if (wants(53)) {
  sectionStart(53);
    const il = await (await browser.newContext({ viewport: { width: 1500, height: 1000 } })).newPage();
    il.on("pageerror", (e) => errors.push(String(e)));
    await il.goto(BASE, { waitUntil: "networkidle" });
    await il.getByRole("button", { name: "Load the example map" }).click();
    await il.waitForTimeout(600);
    await il.getByRole("button", { name: "Settings" }).click();
    await il.waitForTimeout(400);
    await il.locator(".settings-nav-item", { hasText: /Stop types/ }).click();
    await il.waitForTimeout(400);
    const preview = il.locator(".stop-type-preview");
    check("a stop type is shown as the map draws it, beside its settings", (await preview.count()) === 1 && (await preview.locator(".stop").count()) === 1);
    const squares = async () => preview.locator(".stop rect").count();
    const before = await squares();
    await il.getByRole("checkbox", { name: "Draw a square inside the circle" }).click();
    await il.waitForTimeout(300);
    check("and changes as its settings do", (await squares()) !== before, `${before} → ${await squares()}`);
    await il.keyboard.press("Escape");
    await il.waitForTimeout(300);
    await il.getByRole("button", { name: "Print map" }).click();
    await il.waitForTimeout(400);
    // The print dialog draws no picture of the sheets: it counted the board's sheets only, and tickets and rules
    // add pages of their own; the table says what is counted.
    const dialog = il.getByRole("dialog", { name: "Print the map" });
    check("the print dialog has no drawing of the sheets, which would count the board alone", (await dialog.locator("svg[aria-label^='How the sheets divide']").count()) === 0);
    check("and says that the table counts the board's sheets, with the tickets and the rules on pages of their own", /how many sheets the board takes/.test((await dialog.locator(".print-table-note").textContent()) || ""));
    await il.context().close();
  }

  // 54. About tells the whole loop the film does — draw, build a deck, check the balance, print, play
  // with highlighters, revise and print again with the next version number — with pictures of the
  // editor as it is.
  if (wants(54)) {
  sectionStart(54);
    const ab = await (await browser.newContext({ viewport: { width: 1300, height: 1000 } })).newPage();
    ab.on("pageerror", (e) => errors.push(String(e)));
    await ab.goto(BASE + "about/", { waitUntil: "networkidle" });
    const text = (await ab.locator("main").textContent()).replace(/\s+/g, " ");
    check("About has a section on printing, playing and printing again", (await ab.getByRole("heading", { name: "Print, play, print again" }).count()) === 1);
    check("which tells of the version number on every sheet and the playtest box", /version number/i.test(text) && /playtest box/i.test(text), text.slice(0, 120));
    check("it says the editor is free and unofficial, with nothing to install", /free/i.test(text) && /unofficial/i.test(text) && /nothing to install/i.test(text));
    check("and that a deck can be calm, like the official maps, or tense", /calm/i.test(text) && /tense/i.test(text) && /like the official maps/i.test(text));
    const pictures = await ab.locator("main figure img").evaluateAll((imgs) => imgs.map((img) => ({ src: img.getAttribute("src"), w: img.naturalWidth, alt: img.alt })));
    check("with pictures of the editor, each loaded and described", pictures.length >= 3 && pictures.every((p) => p.w > 0 && p.alt.length > 20), JSON.stringify(pictures));
    await ab.context().close();
  }

  // 55. The tour video in the welcome box: a picture with a play button until it is asked for, so
  // nothing is loaded from YouTube for someone who does not watch; then the player, from
  // youtube-nocookie.com. And a way to About, to read more. (YouTube is answered locally here.)
  if (wants(55)) {
  sectionStart(55);
    const wctx = await browser.newContext({ viewport: { width: 1300, height: 1000 } });
    const external = [];
    await wctx.route(/youtube|ytimg|googlevideo/, (route) => { external.push(route.request().url()); route.fulfill({ status: 200, contentType: "text/html", body: "<html><body>player</body></html>" }); });
    const wp = await wctx.newPage();
    wp.on("pageerror", (e) => errors.push(String(e)));
    await wp.goto(BASE, { waitUntil: "networkidle" });
    await wp.waitForTimeout(500);
    const guide = wp.getByRole("dialog", { name: "Welcome to the map editor" });
    const facade = guide.locator(".tour-video");
    check("the welcome box shows the tour video as a picture with a play button", (await facade.count()) === 1 && (await facade.getByRole("button", { name: /Play the tour/ }).count()) === 1);
    const poster = await facade.locator("img").evaluate((img) => ({ src: img.getAttribute("src"), w: img.naturalWidth }));
    check("the picture is the editor's own, loaded from this site", poster.w > 0 && poster.src.startsWith("/ttr/"), JSON.stringify(poster));
    check("and nothing is loaded from YouTube before it is asked for", external.length === 0 && (await guide.locator("iframe").count()) === 0, JSON.stringify(external));
    // Wanting it is enough to warm the connection (the pointer coming near), still without a request to YouTube.
    const preconnects = () => wp.evaluate(() => Array.from(document.querySelectorAll('link[rel="preconnect"]')).map((l) => l.href));
    check("nothing is warmed up when the box opens, only when the pointer comes near the picture", !(await preconnects()).some((h) => /youtube/.test(h)));
    await facade.getByRole("button", { name: /Play the tour/ }).hover();
    check("when it does, the connection to youtube-nocookie.com is warmed up, without a request", (await preconnects()).some((h) => /^https:\/\/www\.youtube-nocookie\.com\/?$/.test(h)) && external.length === 0, JSON.stringify({ links: await preconnects(), external }));
    await wctx.unroute(/youtube|ytimg|googlevideo/);
    await wctx.route(/youtube|ytimg|googlevideo/, async (route) => { external.push(route.request().url()); await new Promise((r) => setTimeout(r, 1200)); route.fulfill({ status: 200, contentType: "text/html", body: "<html><body>player</body></html>" }); });
    await facade.getByRole("button", { name: /Play the tour/ }).click();
    await wp.waitForTimeout(300);
    const waiting = await facade.evaluate((el) => ({ busy: el.getAttribute("aria-busy"), note: el.textContent, posterShown: !!el.querySelector("img") && el.querySelector("img").getBoundingClientRect().width > 0, frameHidden: getComputedStyle(el.querySelector("iframe")).opacity === "0" }));
    check("at the click the picture stays, saying the player is loading, instead of an empty box", waiting.busy === "true" && /Loading/i.test(waiting.note) && waiting.posterShown && waiting.frameHidden, JSON.stringify(waiting));
    await wp.waitForTimeout(1800);
    const ready = await facade.evaluate((el) => ({ busy: el.getAttribute("aria-busy"), frameShown: getComputedStyle(el.querySelector("iframe")).opacity === "1", poster: !!el.querySelector("img") }));
    check("once the player has loaded it replaces the picture", ready.busy !== "true" && ready.frameShown && !ready.poster, JSON.stringify(ready));
    const src = await guide.locator(".tour-video iframe").getAttribute("src").catch(() => "");
    check("asked for, the player comes from youtube-nocookie.com and starts", /^https:\/\/www\.youtube-nocookie\.com\/embed\/AS7XWDRvOEE\?/.test(src) && /autoplay=1/.test(src), src);
    const about = guide.getByRole("link", { name: /About/ });
    check("the welcome box links to About, to read more", (await about.count()) === 1 && /about\/?$/.test(await about.getAttribute("href")), await about.getAttribute("href").catch(() => ""));
    await wctx.close();
  }

  // 56. On a computer each column scrolls on its own: editing a stop with a tall Properties panel never
  // scrolls the page, so the map stays in view.
  if (wants(56)) sectionStart(56);
  if (wants(56)) for (const [w, h] of [[1500, 1000], [1280, 720]]) {
    const cs = await (await browser.newContext({ viewport: { width: w, height: h } })).newPage();
    cs.on("pageerror", (e) => errors.push(String(e)));
    await cs.goto(BASE, { waitUntil: "networkidle" });
    await cs.getByRole("button", { name: "Load the example map" }).click();
    await cs.waitForTimeout(600);
    await cs.evaluate(() => { const s = Array.from(document.querySelectorAll(".map-canvas .stop")).find((g) => Array.from(g.querySelectorAll("text, title")).some((t) => t.textContent === "Central")); s.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true })); s.dispatchEvent(new PointerEvent("pointerup", { bubbles: true })); });
    await cs.waitForTimeout(400);
    await cs.getByRole("button", { name: "Delete stop" }).scrollIntoViewIfNeeded();
    await cs.waitForTimeout(200);
    const m = await cs.evaluate(() => ({ pageScroll: window.scrollY, docHeight: document.documentElement.scrollHeight, viewport: window.innerHeight, mapTop: document.querySelector(".map-canvas").getBoundingClientRect().top, propsScrolls: (() => { const p = document.querySelector("aside.properties"); return p.scrollHeight > p.clientHeight ? p.scrollTop > 0 : true; })() }));
    check(`${w} × ${h}: reaching the foot of a tall Properties panel does not scroll the page`, m.pageScroll === 0 && m.docHeight <= m.viewport + 1, JSON.stringify(m));
    check(`${w} × ${h}: the map stays in view meanwhile`, m.mapTop >= 0 && m.mapTop < m.viewport / 2, JSON.stringify(m));
    check(`${w} × ${h}: the panel scrolls by itself instead`, m.propsScrolls, JSON.stringify(m));
    await cs.context().close();
  }

  // 57. The example map with problems: its own example beside the clean one, so a new user can see what
  // the warnings look like. A route that crosses another and a stop reached by one route only.
  if (wants(57)) {
  sectionStart(57);
    const xp = await (await browser.newContext({ viewport: { width: 1500, height: 1000 } })).newPage();
    xp.on("pageerror", (e) => errors.push(String(e)));
    await xp.goto(BASE, { waitUntil: "networkidle" });
    await xp.waitForTimeout(500);
    const guide = xp.getByRole("dialog", { name: "Welcome to the map editor" });
    check("the welcome box offers a map with problems beside the clean example", (await guide.getByRole("button", { name: "Load the example map" }).count()) === 1 && (await guide.getByRole("button", { name: "Load a map with problems" }).count()) === 1);
    const fit = await guide.evaluate((dlg) => { const box = dlg.getBoundingClientRect(); return Array.from(dlg.querySelectorAll('[data-slot="dialog-footer"] button')).map((b) => { const r = b.getBoundingClientRect(); return { text: b.textContent.trim(), inside: r.left >= box.left - 1 && r.right <= box.right + 1 }; }); });
    check("the four choices (a file of one's own, the example, a map with problems, a blank map) all fit inside the welcome box", fit.length === 4 && fit.every((b) => b.inside), JSON.stringify(fit));
    await guide.getByRole("button", { name: "Load a map with problems" }).click();
    await xp.waitForTimeout(800);
    check("it loads the example map with problems", (await xp.locator(".map-name input, input[aria-label='Map name']").first().inputValue().catch(() => "")) === "Example map with problems" || /Example map with problems/.test(await xp.evaluate(() => JSON.parse(localStorage.getItem("ttr-map")).name)));
    const crossingCard = xp.locator(".crossing-card").filter({ hasText: /crossing/i }).first();
    const crossingText = (await crossingCard.textContent()).replace(/\s+/g, " ");
    check("a route that crosses another turns the Crossings card into a warning", (await crossingCard.evaluate((el) => el.classList.contains("has-warning"))) && /1 crossing/.test(crossingText), crossingText);
    await crossingCard.hover();
    await xp.waitForTimeout(300);
    check("and pointing at it rings the crossing on the map", (await xp.locator(".map-canvas .crossing-mark").count()) === 1, String(await xp.locator(".map-canvas .crossing-mark").count()));
    const shapeCard = xp.locator(".crossing-card.shape-card");
    const shapeText = (await shapeCard.textContent()).replace(/\s+/g, " ");
    check("a stop reached by one route turns how the network holds together into a warning, naming the route", (await shapeCard.evaluate((el) => el.classList.contains("has-warning"))) && /1 route cuts the map in two/.test(shapeText) && /Fernside–Outpost/.test(shapeText), shapeText);
    await xp.getByRole("button", { name: "Map balance", exact: true }).click();
    await xp.waitForTimeout(800);
    const shapeSection = (await xp.locator(".network-shape").textContent()).replace(/\s+/g, " ");
    check("Map balance lists the dead end and its one lane", /Outpost/.test(shapeSection) && /one lane/i.test(shapeSection), shapeSection.slice(0, 300));
    await xp.keyboard.press("Escape");
    await xp.waitForTimeout(300);
    // The map says what is wrong, in its note and in its rules.
    check("a note on the map says what is wrong on purpose", /on purpose/.test(await xp.locator(".map-canvas").textContent()) || /on purpose/.test(await xp.evaluate(() => JSON.parse(localStorage.getItem("ttr-map")).notes.map((n) => n.text).join(" "))));
    // It can be chosen again from Getting started, asking first once the map has been changed (an unchanged example is replaced without a question).
    await xp.evaluate(() => { const m = JSON.parse(localStorage.getItem("ttr-map")); m.name = "My own map"; localStorage.setItem("ttr-map", JSON.stringify(m)); }); await xp.reload({ waitUntil: "networkidle" }); await xp.waitForTimeout(500);
    await xp.getByRole("button", { name: "Help" }).click();
    await xp.getByRole("menuitem", { name: "Getting started" }).click();
    await xp.waitForTimeout(400);
    await xp.getByRole("dialog", { name: "Welcome to the map editor" }).getByRole("button", { name: "Load the example map" }).click();
    await xp.waitForTimeout(400);
    check("choosing the clean example while this one is open asks before replacing it", (await xp.getByRole("alertdialog").count()) === 1 && /Replace the current map/.test(await xp.getByRole("alertdialog").textContent()));
    await xp.getByRole("alertdialog").getByRole("button", { name: /Replace|Load|Continue|Yes/i }).last().click();
    await xp.waitForTimeout(800);
    check("and the clean example is clean: no crossing, holds together", (await xp.getByText("No crossings").count()) === 1 && (await xp.getByText("Well connected").count()) === 1);
    await xp.context().close();
  }

  // 58. Export for ttr-map-generator: Export has a choice for it, which saves one zip, and says what the
  // tool has no place for. (What is inside the zip is checked in tests/ttr-map-generator.cjs, with the
  // tool's own code.)
  if (wants(58)) {
  sectionStart(58);
    const gp = await (await browser.newContext({ viewport: { width: 1500, height: 1000 }, acceptDownloads: true })).newPage();
    gp.on("pageerror", (e) => errors.push(String(e)));
    await gp.goto(BASE, { waitUntil: "networkidle" });
    await gp.getByRole("button", { name: "Load the example map" }).click();
    await gp.waitForTimeout(600);
    await gp.getByRole("button", { name: "Export", exact: true }).click();
    const item = gp.getByRole("menuitem", { name: /ttr-map-generator/ });
    check("Export has a choice for ttr-map-generator, saved as a zip", (await item.count()) === 1 && /zip/i.test(await item.textContent()));
    const saved = gp.waitForEvent("download");
    await item.click();
    const download = await saved;
    check("it saves a zip named for the map, its version and the tool", /ttr-map-generator.*\.zip$/.test(download.suggestedFilename()) && /example-map/.test(download.suggestedFilename()), download.suggestedFilename());
    const bytes = fs.readFileSync(await download.path());
    check("which is a zip, with the six files in it", bytes.length > 500 && bytes[0] === 0x50 && bytes[1] === 0x4b && ["locations.txt", "paths.txt", "tasks.txt", "positions.json", "make_graph.py", "README.txt"].every((name) => bytes.includes(Buffer.from(name))), `${bytes.length} bytes`);
    await gp.waitForTimeout(400);
    const message = (await gp.locator("[data-sonner-toast]").first().textContent().catch(() => "")) || "";
    check("and says what the tool has no place for", /ttr-map-generator/.test(message) && /Ticket points and decks are not carried over/.test(message) && !/Positions are not carried over/.test(message), message.slice(0, 240));
    await gp.context().close();
  }

  // 59. Deleting a stop takes its tickets with it, in every deck, says so on screen and can be undone
  // (found in the 1.0 review: tickets to a stop that is gone were left in the map and then reported as
  // damage the next time it was opened).
  if (wants(59)) {
  sectionStart(59);
    const dp = await (await browser.newContext({ viewport: { width: 1500, height: 1000 } })).newPage();
    dp.on("pageerror", (e) => errors.push(String(e)));
    await dp.goto(BASE, { waitUntil: "networkidle" });
    await dp.getByRole("button", { name: "Load the example map" }).click();
    await dp.waitForTimeout(600);
    const mapNow = () => dp.evaluate(() => JSON.parse(localStorage.getItem("ttr-map")));
    const before = await mapNow();
    const westport = before.stops.find((s) => s.name === "Westport");
    const named = (m) => m.tickets.filter((t) => t.a === westport.id || t.b === westport.id).length;
    check("the example has tickets to Westport, in more than one deck", named(before) >= 2 && new Set(before.tickets.filter((t) => t.a === westport.id || t.b === westport.id).map((t) => t.set)).size >= 2, `${named(before)} tickets`);
    await dp.evaluate(() => { const s = Array.from(document.querySelectorAll(".map-canvas .stop")).find((g) => Array.from(g.querySelectorAll("text, title")).some((t) => t.textContent === "Westport")); s.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true })); s.dispatchEvent(new PointerEvent("pointerup", { bubbles: true })); });
    await dp.waitForTimeout(400);
    await dp.getByRole("button", { name: "Delete stop" }).click();
    await dp.waitForTimeout(400);
    const asked = (await dp.getByRole("alertdialog").textContent()) || "";
    const listed = await dp.getByRole("alertdialog").evaluate((el) => ({ bold: [...el.querySelectorAll("li strong")].map((b) => b.textContent), items: el.querySelectorAll("li").length, text: el.textContent }));
    const westportTickets = before.tickets.filter((t) => t.a === westport.id || t.b === westport.id);
    const westportRoutes = before.routes.filter((r) => r.a === westport.id || r.b === westport.id);
    const nameOf = (id) => before.stops.find((s) => s.id === id).name;
    check("the question lists, in bold, the stop, how many routes and tickets go, and each route and ticket by its stops", listed.bold.includes("The stop Westport") && listed.bold.some((b) => b === `${westportRoutes.length} ${westportRoutes.length === 1 ? "route" : "routes"}`) && listed.bold.some((b) => b === `${westportTickets.length} ${westportTickets.length === 1 ? "ticket" : "tickets"}`) && westportRoutes.every((r) => listed.bold.includes(`${nameOf(r.a)}–${nameOf(r.b)}`)) && westportTickets.every((t) => listed.bold.includes(`${nameOf(t.a)}–${nameOf(t.b)}`)), JSON.stringify(listed.bold));
    check("with the deck and the points of each ticket, and that Undo brings it all back", before.ticketSets.every((set) => !westportTickets.some((t) => (t.set ?? before.ticketSets[0].id) === set.id) || listed.text.includes(set.label)) && /Undo brings it all back/.test(listed.text), listed.text.slice(0, 160));
    await dp.getByRole("alertdialog").getByRole("button", { name: "Continue" }).click();
    await dp.waitForTimeout(500);
    const after = await mapNow();
    check("deleting the stop takes every ticket that names it, and nothing else", named(after) === 0 && after.tickets.length === before.tickets.length - named(before), `${before.tickets.length} tickets before, ${after.tickets.length} after`);
    const note = (await dp.locator("[data-sonner-toast]").allTextContents()).join(" | ");
    check("and says so on screen, with how many", new RegExp(`Westport is deleted, with (\\d+ routes? that ended there and )${named(before)} tickets? that named it`).test(note), note);
    // Reopened, the map is whole: nothing is reported as damaged.
    await dp.reload({ waitUntil: "networkidle" });
    await dp.waitForTimeout(800);
    check("opened again, the map is not reported as damaged", !/could not be used|left out/i.test((await dp.locator("[data-sonner-toast]").allTextContents()).join(" ")));
    // Undo, from the notice.
    await dp.evaluate(() => { const s = Array.from(document.querySelectorAll(".map-canvas .stop")).find((g) => Array.from(g.querySelectorAll("text, title")).some((t) => t.textContent === "Millbrook")); s.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true })); s.dispatchEvent(new PointerEvent("pointerup", { bubbles: true })); });
    await dp.waitForTimeout(400);
    const millbrookTickets = (await mapNow()).tickets.filter((t) => { const id = after.stops.find((s) => s.name === "Millbrook").id; return t.a === id || t.b === id; }).length;
    await dp.getByRole("button", { name: "Delete stop" }).click();
    await dp.waitForTimeout(400);
    await dp.getByRole("alertdialog").getByRole("button", { name: "Continue" }).click();
    await dp.waitForTimeout(500);
    const toast = dp.locator("[data-sonner-toast]").filter({ hasText: /Millbrook is deleted/ });
    check("the notice offers Undo", (await toast.getByRole("button", { name: "Undo" }).count()) === 1 && millbrookTickets >= 1, `${millbrookTickets} tickets`);
    const mid = await mapNow();
    await toast.getByRole("button", { name: "Undo" }).click();
    await dp.waitForTimeout(500);
    const back = await mapNow();
    check("and Undo brings the stop, its routes and its tickets back", back.stops.length === mid.stops.length + 1 && back.tickets.length === mid.tickets.length + millbrookTickets && back.routes.length > mid.routes.length, `${mid.tickets.length} -> ${back.tickets.length} tickets`);
    // A notice's Undo undoes what it names, or says it cannot: not the last change, whatever that was.
    const gull = back.stops.find((s) => s.name === "Gull Island");
    const pickStop = (name) => dp.evaluate((n) => { const s = Array.from(document.querySelectorAll(".map-canvas .stop")).find((g) => Array.from(g.querySelectorAll("text, title")).some((t) => t.textContent === n)); s.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true })); s.dispatchEvent(new PointerEvent("pointerup", { bubbles: true })); }, name);
    await pickStop("Gull Island");
    await dp.waitForTimeout(300);
    await dp.getByRole("button", { name: "Delete stop" }).click();
    await dp.waitForTimeout(300);
    await dp.getByRole("alertdialog").getByRole("button", { name: "Continue" }).click();
    await dp.waitForTimeout(400);
    await pickStop("Pine Hill");
    await dp.waitForTimeout(300);
    await dp.getByRole("checkbox", { name: "A hub on purpose" }).check();
    await dp.waitForTimeout(300);
    await dp.locator("[data-sonner-toast]").filter({ hasText: /Gull Island is deleted/ }).getByRole("button", { name: "Undo" }).click();
    await dp.waitForTimeout(400);
    const afterUndo = await mapNow();
    check("the notice's Undo does not undo something else when another change came after", !afterUndo.stops.some((s) => s.id === gull.id) && afterUndo.stops.find((s) => s.name === "Pine Hill").hub === true && /map has changed since/.test((await dp.locator("[data-sonner-toast]").allTextContents()).join(" ")));
    // The toolbar's Undo counts as a change too: a notice's Undo after it must not undo one step further back. Pine Hill's
    // hub mark was the last change before this deletion; Undo from the toolbar takes the deletion back, and the notice's
    // Undo, pressed after that, must not take the hub mark back as well.
    await pickStop("Harbour");
    await dp.waitForTimeout(300);
    await dp.getByRole("button", { name: "Delete stop" }).click();
    await dp.waitForTimeout(300);
    await dp.getByRole("alertdialog").getByRole("button", { name: "Continue" }).click();
    await dp.waitForTimeout(400);
    const notice = dp.locator("[data-sonner-toast]").filter({ hasText: /Harbour is deleted/ });
    check("deleting Harbour gives a notice with Undo", (await notice.getByRole("button", { name: "Undo" }).count()) === 1);
    await dp.locator("header").getByRole("button", { name: "Undo", exact: true }).click();
    await dp.waitForTimeout(400);
    const harbourBack = await mapNow();
    await notice.getByRole("button", { name: "Undo" }).click();
    await dp.waitForTimeout(400);
    const afterNotice = await mapNow();
    check("the toolbar's Undo took the deletion back, and the notice's Undo after it undid nothing more: the hub mark is still there", harbourBack.stops.some((s) => s.name === "Harbour") && afterNotice.stops.find((s) => s.name === "Pine Hill").hub === true && JSON.stringify(afterNotice) === JSON.stringify(harbourBack), `${harbourBack.stops.length} / ${afterNotice.stops.length} stops, hub ${afterNotice.stops.find((s) => s.name === "Pine Hill").hub}`);
    await dp.context().close();
  }

  // 60. A network imported over the stops: the tickets of the decks that stay, whose stops are gone or now
  // mean another stop, are put to the person in a dialog that cannot be dismissed by accident; each old stop
  // is sent to a new one or its tickets go, and Undo the import brings everything back (found in the 1.0
  // review).
  if (wants(60)) {
  sectionStart(60);
    const np = await (await browser.newContext({ viewport: { width: 1500, height: 1000 } })).newPage();
    np.on("pageerror", (e) => errors.push(String(e)));
    await np.goto(BASE, { waitUntil: "networkidle" });
    await np.getByRole("button", { name: "Load the example map" }).click();
    await np.waitForTimeout(600);
    const mapNow = () => np.evaluate(() => JSON.parse(localStorage.getItem("ttr-map")));
    const before = await mapNow();
    const stopNamed = (m, name) => m.stops.find((s) => s.name === name);
    const westport = stopNamed(before, "Westport"), millbrook = stopNamed(before, "Millbrook"), fernside = stopNamed(before, "Fernside");
    const ticketsOf = (m, ...ids) => m.tickets.filter((t) => ids.includes(t.a) || ids.includes(t.b));
    const importNetwork = async (stops, routes) => {
      const file = path.join(os.tmpdir(), `ttr-${Date.now()}-network.json`);
      fs.writeFileSync(file, JSON.stringify({ format: "ticket-to-ride-map", version: 3, kind: "network", payload: { stops, routes } }));
      await np.locator('input[type="file"][accept="application/json"]').setInputFiles(file);
      await np.waitForTimeout(600);
      await np.getByRole("alertdialog").getByRole("button", { name: "Continue" }).click();
      await np.waitForTimeout(600);
    };
    const dialog = np.getByRole("dialog", { name: "Tickets to stops that changed" });
    // The new network: Westport's id now belongs to Eastgate; Millbrook is as it was; Westport is a new stop
    // with a new id; every other stop of the example is gone.
    const stopsIn = [{ id: westport.id, name: "Eastgate", type: "city", x: 200, y: 200 }, { id: millbrook.id, name: "Millbrook", type: "city", x: 500, y: 200 }, { id: "n-westport", name: "Westport", type: "city", x: 300, y: 400 }, { id: "n-lake", name: "Lakeview", type: "city", x: 700, y: 400 }];
    const routesIn = [{ id: "n-r1", a: westport.id, b: millbrook.id, length: 3, type: "city", color: "red" }, { id: "n-r2", a: "n-westport", b: "n-lake", length: 3, type: "city", color: "blue" }];
    await importNetwork(stopsIn, routesIn);
    check("the network replaces the stops and routes", (await mapNow()).stops.length === 4 && (await mapNow()).routes.length === 2);
    check("and a dialog asks about the tickets of the decks that stay", (await dialog.count()) === 1);
    const asked = (await dialog.textContent()) || "";
    const flagged = new Set(before.tickets.flatMap((t) => [t.a, t.b]).filter((id) => id !== millbrook.id));
    check("it has one row for each old stop that is gone or changed, and none for the one that is as it was", (await dialog.locator(".rebind-row").count()) === flagged.size && !/Millbrook ·/.test(asked), `${await dialog.locator(".rebind-row").count()} rows, ${flagged.size} stops`);
    const rowOf = (name) => dialog.locator(".rebind-row").filter({ has: np.locator("label strong", { hasText: new RegExp(`^${name}$`) }) });
    const westportRow = rowOf("Westport");
    check("a stop whose id now means another stop says so", /now the stop Eastgate, not Westport/.test((await westportRow.textContent()) || ""), await westportRow.textContent());
    check("and the stop with the old name is already chosen for it", (await westportRow.locator("select").inputValue()) === "n-westport");
    check("a stop that is gone and has no namesake is set to have its tickets removed", (await rowOf("Fernside").locator("select").inputValue()) === "");
    await np.keyboard.press("Escape");
    await np.waitForTimeout(300);
    check("Escape does not close it", (await dialog.count()) === 1);
    await np.mouse.click(5, 5);
    await np.waitForTimeout(300);
    check("nor does a click outside it", (await dialog.count()) === 1);
    check("while it is open the tickets are all still there", (await mapNow()).tickets.length === before.tickets.length);
    // Send Fernside to Millbrook, and apply.
    await rowOf("Fernside").locator("select").selectOption({ label: "Millbrook" });
    await dialog.getByRole("button", { name: "Apply" }).click();
    await np.waitForTimeout(600);
    const after = await mapNow();
    // Old Eastgate has a namesake in the new network (the stop that took Westport's id), so it is sent there;
    // Westport goes to the new stop of that name; Fernside was sent to Millbrook by hand; the rest go.
    const eastgate = stopNamed(before, "Eastgate");
    const sendTo = (id) => id === westport.id ? "n-westport" : id === eastgate.id ? westport.id : id === fernside.id ? millbrook.id : id === millbrook.id ? millbrook.id : null;
    const expected = before.tickets.filter((t) => sendTo(t.a) && sendTo(t.b) && sendTo(t.a) !== sendTo(t.b));
    check("Apply moves what was chosen and removes what was not, and every ticket names a stop that is there", after.tickets.length === expected.length && after.tickets.every((t) => after.stops.some((s) => s.id === t.a) && after.stops.some((s) => s.id === t.b)), `${after.tickets.length} tickets, ${expected.length} expected`);
    check("each ticket ends where its old stop was sent, end for end", expected.every((e) => { const got = after.tickets.find((t) => t.id === e.id); return got && got.a === sendTo(e.a) && got.b === sendTo(e.b) && got.points === e.points; }), JSON.stringify(after.tickets.map((t) => [t.id, t.a, t.b])));
    check("a ticket that named Westport follows it to its new stop, not to the stop that took its old id", before.tickets.filter((t) => t.a === westport.id || t.b === westport.id).every((t) => { const got = after.tickets.find((x) => x.id === t.id); return !got || (t.a === westport.id ? got.a : got.b) === "n-westport"; }));
    check("the dialog has closed and says what was done", (await dialog.count()) === 0 && /moved to other stops/.test((await np.locator("[data-sonner-toast]").allTextContents()).join(" ")));
    await np.reload({ waitUntil: "networkidle" });
    await np.waitForTimeout(800);
    check("opened again, the map is not reported as damaged", !/could not be used|left out/i.test((await np.locator("[data-sonner-toast]").allTextContents()).join(" ")));
    // Undo the import: everything as it was.
    await np.evaluate((text) => localStorage.setItem("ttr-map", text), JSON.stringify(before));
    await np.reload({ waitUntil: "networkidle" });
    await np.waitForTimeout(800);
    const again = await mapNow();
    await importNetwork(stopsIn, routesIn);
    await np.getByRole("dialog", { name: "Tickets to stops that changed" }).getByRole("button", { name: "Undo the import" }).click();
    await np.waitForTimeout(600);
    const undone = await mapNow();
    check("Undo the import brings back the stops, routes and tickets as they were", undone.stops.length === again.stops.length && undone.routes.length === again.routes.length && undone.tickets.length === again.tickets.length && (await dialog.count()) === 0, `${undone.stops.length} stops, ${undone.tickets.length} tickets`);
    // Remove them all.
    await importNetwork(stopsIn, routesIn);
    await np.getByRole("dialog", { name: "Tickets to stops that changed" }).getByRole("button", { name: "Remove them all" }).click();
    await np.waitForTimeout(600);
    const bare = await mapNow();
    const stayingOnes = again.tickets.filter((t) => t.a === millbrook.id && t.b === millbrook.id).length;
    check("Remove them all removes every ticket that named a stop that changed", bare.tickets.length === stayingOnes && (await dialog.count()) === 0, `${bare.tickets.length} tickets left`);
    // A network file that brings tickets: it carries every deck's tickets under their own ids. The decks that stay
    // must not lose theirs to the copies (found in the 1.0 review): imported tickets get ids of their own.
    await np.evaluate((text) => localStorage.setItem("ttr-map", text), JSON.stringify(before));
    await np.reload({ waitUntil: "networkidle" });
    await np.waitForTimeout(800);
    const lakeside = stopNamed(before, "Lakeside");
    const shore = { format: "ticket-to-ride-map", version: 3, kind: "network", payload: { stops: before.stops.map((s) => s.id === lakeside.id ? { ...s, name: "Lakeshore" } : s), routes: before.routes, tickets: before.tickets } };
    const shoreFile = path.join(os.tmpdir(), `ttr-${Date.now()}-network-tickets.json`); fs.writeFileSync(shoreFile, JSON.stringify(shore));
    await np.locator('input[type="file"][accept="application/json"]').setInputFiles(shoreFile);
    await np.waitForTimeout(600);
    await np.getByRole("alertdialog").getByRole("button", { name: "Continue" }).click();
    await np.waitForTimeout(700);
    await dialog.getByRole("button", { name: "Apply" }).click();
    await np.waitForTimeout(600);
    const fresh = await mapNow();
    const longBefore = before.tickets.filter((t) => t.set === "example-long");
    const longAfter = fresh.tickets.filter((t) => t.set === "example-long");
    const namesLakeside = (t) => t.a === lakeside.id || t.b === lakeside.id;
    check("the other deck keeps its tickets, but for those that named the stop that changed", longAfter.length === longBefore.filter((t) => !namesLakeside(t)).length && longBefore.filter((t) => !namesLakeside(t)).every((t) => longAfter.some((x) => x.id === t.id && x.a === t.a && x.b === t.b)), `${longAfter.length} of ${longBefore.length}`);
    check("no two tickets share an id", new Set(fresh.tickets.map((t) => t.id)).size === fresh.tickets.length, `${fresh.tickets.length} tickets`);
    check("and the tickets that came with the file are in the deck being worked on", fresh.tickets.filter((t) => (t.set ?? "main") === "main").length >= before.tickets.filter((t) => t.set !== "example-long").length);
    // Undo after Apply takes the whole import back, so no ticket is left naming a stop that has changed.
    await np.locator("[data-sonner-toast]").filter({ hasText: /moved to other stops/ }).getByRole("button", { name: "Undo" }).click();
    await np.waitForTimeout(600);
    const back = await mapNow();
    check("Undo after Apply takes back the whole import: the stops and every ticket as they were", back.stops.length === before.stops.length && back.stops.find((s) => s.id === lakeside.id).name === "Lakeside" && back.tickets.length === before.tickets.length, `${back.stops.length} stops, ${back.tickets.length} tickets`);
    // A spreadsheet replacing the stops asks too.
    await np.evaluate((text) => localStorage.setItem("ttr-map", text), JSON.stringify(before));
    await np.reload({ waitUntil: "networkidle" });
    await np.waitForTimeout(800);
    const csvStops = path.join(os.tmpdir(), `ttr-${Date.now()}-stops.csv`);
    fs.writeFileSync(csvStops, `Name,Id,X,Y\nWestport,x-westport,200,200\nMillbrook,${millbrook.id},500,200\nAlpha,x-alpha,300,400\n`);
    const csvRoutes = path.join(os.tmpdir(), `ttr-${Date.now()}-routes.csv`);
    fs.writeFileSync(csvRoutes, "From,To,Length,From id,To id\nWestport,Millbrook,3,x-westport,\nMillbrook,Alpha,2,,x-alpha\n");
    await chooseSpreadsheets(np, [csvStops, csvRoutes]);
    await np.waitForTimeout(100);
    await np.getByRole("alertdialog").getByRole("button", { name: "Continue" }).click();
    await np.waitForTimeout(700);
    check("a spreadsheet that replaces the stops asks about the tickets of the decks that stay", (await dialog.count()) === 1 && (await dialog.locator(".rebind-row").count()) === new Set(before.tickets.flatMap((t) => [t.a, t.b]).filter((id) => id !== millbrook.id)).size, `${await dialog.locator(".rebind-row").count()} rows`);
    check("with Westport's new id offered for its tickets, the stop having the same name", (await rowOf("Westport").locator("select").inputValue()) === "x-westport");
    await dialog.getByRole("button", { name: "Undo the import" }).click();
    await np.waitForTimeout(500);
    await np.context().close();
  }

  // 61. Import → Tickets only reads the tickets of a file and nothing else: from a ticket file, or from a whole map
  // file or a network file, whose stops and routes it leaves alone. Map project still takes a whole map. And a
  // template zip says on screen that it was saved (section 9).
  if (wants(61)) {
  sectionStart(61);
    const to = await (await browser.newContext({ viewport: { width: 1500, height: 1000 }, acceptDownloads: true })).newPage();
    to.on("pageerror", (e) => errors.push(String(e)));
    await to.goto(BASE, { waitUntil: "networkidle" });
    await to.getByRole("button", { name: "Load the example map" }).click();
    await to.waitForTimeout(600);
    const mapNow = () => to.evaluate(() => JSON.parse(localStorage.getItem("ttr-map")));
    const before = await mapNow();
    const [a, b] = before.stops;
    const other = JSON.parse(JSON.stringify(before));
    other.name = "Another map";
    other.stops = [...other.stops, { id: "zed", name: "Zed", type: "city", x: 900, y: 650 }];
    other.ticketSets = [{ id: "x", label: "Their deck" }];
    other.tickets = [{ id: "o1", a: a.id, b: b.id, points: 7, set: "x" }, { id: "o2", a: a.id, b: "zed", points: 9, set: "x" }];
    const wrap = (kind, payload) => ({ format: "ticket-to-ride-map", version: 3, kind, payload });
    const toFile = (name, content) => { const f = path.join(os.tmpdir(), `ttr-${Date.now()}-${name}`); fs.writeFileSync(f, JSON.stringify(content)); return f; };
    const importAs = async (item, file) => {
      await to.getByRole("button", { name: "Import", exact: true }).click(); await to.waitForTimeout(250);
      const chooser = to.waitForEvent("filechooser");
      await to.getByRole("menuitem", { name: item, exact: true }).click();
      await (await chooser).setFiles(file); await to.waitForTimeout(700);
    };
    await importAs("Tickets only", toFile("whole-map.json", wrap("map", other)));
    const after = await mapNow();
    check("Tickets only on a whole map file leaves this map as it is: its name, stops and routes", after.name === before.name && after.stops.length === before.stops.length && after.routes.length === before.routes.length, `${after.name}, ${after.stops.length} stops`);
    check("and brings the file's deck as a new deck beside the others", after.ticketSets.length === before.ticketSets.length + 1 && after.ticketSets.some((s) => /Their deck/.test(s.label)));
    const theirs = after.tickets.filter((t) => t.set === after.ticketSets.find((s) => /Their deck/.test(s.label)).id);
    check("with the ticket whose stops this map has, and not the one that names a stop it has not", theirs.length === 1 && theirs[0].a === a.id && theirs[0].b === b.id && theirs[0].points === 7, JSON.stringify(theirs));
    check("and says that one was skipped", /1 skipped/.test((await to.locator("[data-sonner-toast]").allTextContents()).join(" ")), (await to.locator("[data-sonner-toast]").allTextContents()).join(" | "));
    await to.keyboard.press("Escape"); await to.waitForTimeout(300);
    // The Tickets panel's own Import decks is the same thing: tickets only.
    await to.getByRole("button", { name: "Tickets", exact: true }).click(); await to.waitForTimeout(400);
    await to.getByRole("button", { name: /Import\/Export decks/ }).click(); await to.waitForTimeout(250);
    const deckChooser = to.waitForEvent("filechooser");
    await to.getByRole("menuitem", { name: "Import decks", exact: true }).click();
    await (await deckChooser).setFiles(toFile("whole-map-decks.json", wrap("map", other))); await to.waitForTimeout(700);
    const viaPanel = await mapNow();
    check("Import decks in the Tickets panel also takes only the tickets of a whole map file, whatever was chosen before", viaPanel.name === before.name && viaPanel.stops.length === before.stops.length && viaPanel.ticketSets.length === after.ticketSets.length + 1, `${viaPanel.name}, ${viaPanel.stops.length} stops`);
    await to.keyboard.press("Escape"); await to.waitForTimeout(300);
    // A network file with tickets: its network is left alone too.
    await importAs("Tickets only", toFile("network.json", wrap("network", { stops: other.stops, routes: other.routes, tickets: other.tickets })));
    const net = await mapNow();
    check("Tickets only on a network file leaves the stops and routes alone as well", net.stops.length === before.stops.length && net.routes.length === before.routes.length && net.ticketSets.length === before.ticketSets.length + 3, `${net.stops.length} stops, ${net.ticketSets.length} decks`);
    await to.keyboard.press("Escape"); await to.waitForTimeout(300);
    // A file with no tickets in it.
    await importAs("Tickets only", toFile("background.json", wrap("background", { background: [{ id: "bg", type: "area", points: [{ x: 1, y: 1 }, { x: 5, y: 5 }, { x: 9, y: 1 }] }] })));
    check("a file with no tickets in it is said to have none", /no tickets/i.test((await to.locator("[data-sonner-toast]").allTextContents()).join(" ")), (await to.locator("[data-sonner-toast]").allTextContents()).join(" | "));
    // Map project, over a whole map file, still replaces the map.
    await importAs("Map project", toFile("whole-map-2.json", wrap("map", other)));
    if (await to.getByRole("alertdialog").count()) { await to.getByRole("alertdialog").getByRole("button", { name: "Continue" }).click(); await to.waitForTimeout(500); }
    const whole = await mapNow();
    check("Map project takes the whole map, as before", whole.name === "Another map" && whole.stops.some((s) => s.id === "zed"), whole.name);
    await to.context().close();
  }

  // 62. A file written by a newer editor opens, and says so: which version wrote it, which this is, and what to do.
  // A file from an older version, one with no version and one with a version that is no number say nothing.
  if (wants(62)) {
  sectionStart(62);
    const nv = await (await browser.newContext({ viewport: { width: 1500, height: 1000 } })).newPage();
    nv.on("pageerror", (e) => errors.push(String(e)));
    await nv.goto(BASE, { waitUntil: "networkidle" });
    await nv.getByRole("button", { name: "Load the example map" }).click();
    await nv.waitForTimeout(600);
    const mapIs = () => nv.evaluate(() => JSON.parse(localStorage.getItem("ttr-map")));
    const base = await mapIs();
    const withApp = (name, app) => { const f = path.join(os.tmpdir(), `ttr-${Date.now()}-${name}`); const body = { format: "ticket-to-ride-map", version: 3, kind: "map", payload: { ...base, name: `From ${name}` } }; if (app !== undefined) body.app = app; fs.writeFileSync(f, JSON.stringify(body)); return f; };
    const importFile = async (file) => {
      await nv.getByRole("button", { name: "Import", exact: true }).click(); await nv.waitForTimeout(250);
      const chooser = nv.waitForEvent("filechooser");
      await nv.getByRole("menuitem", { name: "Map project", exact: true }).click();
      await (await chooser).setFiles(file); await nv.waitForTimeout(700);
      if (await nv.getByRole("alertdialog").count()) { await nv.getByRole("alertdialog").getByRole("button", { name: "Continue" }).click(); await nv.waitForTimeout(500); }
    };
    const toasts = async () => (await nv.locator("[data-sonner-toast]").allTextContents()).join(" | ");
    const clearToasts = () => nv.evaluate(() => document.querySelectorAll("[data-sonner-toast]").forEach((t) => t.remove()));
    await importFile(withApp("newer", { name: "Map prototypes", version: "99.1.0" }));
    const said = await toasts();
    check("a file from a newer editor opens", (await mapIs()).name === "From newer");
    check("and says which version wrote it and what to do", /newer version of the editor/.test(said) && /99\.1\.0/.test(said) && /Reload the page to get the newest version/.test(said), said);
    await clearToasts();
    for (const [name, label, app] of [["older", "an older version", { name: "Map prototypes", version: "1.0.0" }], ["noapp", "no version", undefined], ["odd", "a version that is no number", { name: "x", version: "next" }]]) {
      await importFile(withApp(name, app));
      const t = await toasts();
      check(`a file with ${label} says nothing about versions`, (await mapIs()).name === `From ${name}` && !/newer version of the editor/.test(t), t);
      await clearToasts();
    }
    await nv.context().close();
  }

  // 63. A board of any number of fold panels, from Settings → Board format → Custom size…: two numbers (panels along the
  // long and the short side) in a small dialog, one undoable step, kept in the map and said in the print dialog.
  if (wants(63)) {
  sectionStart(63);
    const cb = await (await browser.newContext({ viewport: { width: 1500, height: 1000 } })).newPage();
    cb.on("pageerror", (e) => errors.push(String(e)));
    await cb.goto(BASE, { waitUntil: "networkidle" });
    await cb.getByRole("button", { name: "Load the example map" }).click();
    await cb.waitForTimeout(600);
    const stored = () => cb.evaluate(() => JSON.parse(localStorage.getItem("ttr-map")));
    const before = await stored();
    await cb.getByRole("button", { name: "Settings" }).click(); await cb.waitForTimeout(400);
    check("Settings offers the boards it has, and one button for another size", (await cb.locator('#settings-format input[type="radio"]').count()) === 4 && (await cb.locator("#settings-custom-board").textContent()).trim() === "Custom size…");
    await cb.locator("#settings-custom-board").click(); await cb.waitForTimeout(300);
    check("the button opens a dialog with the panels along each side", (await cb.locator("#custom-board-long").isVisible()) && (await cb.locator("#custom-board-short").isVisible()));
    await cb.locator("#custom-board-long").fill("3"); await cb.locator("#custom-board-short").fill("3"); await cb.waitForTimeout(200);
    check("it says what size that makes", /3 panels along the long side and 3 along the short: 790 × 788 mm/.test(await cb.locator(".custom-board-result").textContent()), await cb.locator(".custom-board-result").textContent());
    await cb.locator("#custom-board-long").fill("2"); await cb.waitForTimeout(200);
    check("a short side longer than the long side is said so, and cannot be used", /cannot have more panels/.test(await cb.locator(".custom-board-result").textContent()) && (await cb.locator("#custom-board-apply").isDisabled()));
    await cb.locator("#custom-board-long").fill("9"); await cb.waitForTimeout(200);
    check("so is a number out of range", /long side needs a whole number of panels, from 2 to 6/.test(await cb.locator(".custom-board-result").textContent()) && (await cb.locator("#custom-board-apply").isDisabled()));
    await cb.locator("#custom-board-long").fill("1"); await cb.locator("#custom-board-short").fill("1"); await cb.waitForTimeout(200);
    check("one panel alone is not a board, and is said so", /long side needs a whole number of panels, from 2 to 6/.test(await cb.locator(".custom-board-result").textContent()) && (await cb.locator("#custom-board-apply").isDisabled()));
    await cb.getByRole("button", { name: "Cancel" }).click(); await cb.waitForTimeout(300);
    check("Cancel leaves the board as it was", (await stored()).format === before.format);
    await cb.locator("#settings-custom-board").click(); await cb.waitForTimeout(300);
    await cb.locator("#custom-board-long").fill("4"); await cb.locator("#custom-board-short").fill("3"); await cb.waitForTimeout(200);
    await cb.locator("#custom-board-apply").click(); await cb.waitForTimeout(600);
    const after = await stored();
    check("Use this size gives the map a 3 × 4 board, in the map as it is saved", after.format === "board-3x4", after.format);
    check("everything on the map keeps x and has its y stretched to the new height", after.stops.every((st, i) => Math.abs(st.x - before.stops[i].x) < 1e-6 && Math.abs(st.y - before.stops[i].y * (Math.round(1100 * 788 / 1053) / Math.round(1100 * 525 / 790))) < 1e-6));
    check("Settings then shows the custom board, chosen, and the button changes it", (await cb.locator('#settings-format input[value="custom"]').isChecked()) && (await cb.locator("#settings-custom-board").textContent()).trim() === "Change custom size…" && /Custom board 3×4/.test(await cb.locator("#settings-format").textContent()), await cb.locator("#settings-format").textContent());
    await cb.locator("#settings-custom-board").click(); await cb.waitForTimeout(300);
    check("which opens with the board's own numbers", (await cb.locator("#custom-board-long").inputValue()) === "4" && (await cb.locator("#custom-board-short").inputValue()) === "3");
    await cb.getByRole("button", { name: "Cancel" }).click(); await cb.waitForTimeout(300);
    await cb.locator('#settings-format input[value="board-2x3"]').check(); await cb.waitForTimeout(500);
    const back = await stored();
    check("choosing the standard board again takes the map back, and the custom board is no longer listed", back.format === "board-2x3" && (await cb.locator('#settings-format input[type="radio"]').count()) === 4 && back.stops.every((st, i) => Math.abs(st.y - before.stops[i].y) < 0.01));
    await cb.keyboard.press("Escape"); await cb.waitForTimeout(300);
    // The custom board in the print dialog: twelve panels, a sheet each.
    await cb.getByRole("button", { name: "Settings" }).click(); await cb.waitForTimeout(400);
    await cb.locator("#settings-custom-board").click(); await cb.waitForTimeout(300);
    await cb.locator("#custom-board-long").fill("4"); await cb.locator("#custom-board-short").fill("3"); await cb.locator("#custom-board-apply").click(); await cb.waitForTimeout(500);
    await cb.keyboard.press("Escape"); await cb.waitForTimeout(300);
    await cb.getByRole("button", { name: "Print map", exact: true }).click(); await cb.waitForTimeout(500);
    check("the print dialog counts a sheet for each of the twelve panels", (await cb.locator('.print-table tbody tr[data-paper="a4"] td:nth-of-type(2) button').getAttribute("data-pages")) === "12", await cb.locator('.print-table tbody tr[data-paper="a4"] td:nth-of-type(2) button').getAttribute("data-pages"));
    check("and offers no Anniversary size, which only the standard board has", (await cb.locator(".print-table thead").textContent()).indexOf("Anniversary") === -1);
    await cb.keyboard.press("Escape"); await cb.waitForTimeout(300);
    // It survives a reload (the file carrying it is checked in tests/custom-board.cjs).
    await cb.reload({ waitUntil: "networkidle" }); await cb.waitForTimeout(500);
    check("the custom board is still there after a reload", (await stored()).format === "board-3x4");
    await cb.context().close();
  }

  // 64. The lane rule in Settings: "Second lane opens from" beside the players, 4 (the standard) by default; a number is kept in the
  // map as its rule, Map balance says it and counts the spaces by it, and a rule of the map's own from a file is shown as such.
  if (wants(64)) {
  sectionStart(64);
    const lr = await (await browser.newContext({ viewport: { width: 1500, height: 1000 } })).newPage();
    lr.on("pageerror", (e) => errors.push(String(e)));
    await lr.goto(BASE, { waitUntil: "networkidle" });
    await lr.getByRole("button", { name: "Load the example map" }).click();
    await lr.waitForTimeout(600);
    const stored = () => lr.evaluate(() => JSON.parse(localStorage.getItem("ttr-map")));
    const openBalance = async () => { await lr.getByRole("button", { name: "Map balance", exact: true }).click(); await lr.waitForTimeout(600); };
    await lr.getByRole("button", { name: "Settings" }).click(); await lr.waitForTimeout(400);
    check("Settings has the second lane's setting beside the players, at 4 players, the standard", (await lr.locator("#settings-lanes-from").inputValue()) === "4" && /4 players \(standard\)/.test(await lr.locator("#settings-lanes-from").textContent()));
    check("and the map has no rule of its own saved", (await stored()).laneRule === undefined);
    await lr.locator("#settings-lanes-from").selectOption("2"); await lr.waitForTimeout(400);
    const two = await stored();
    check("choosing 2 keeps the rule in the map: both lanes always open", JSON.stringify(two.laneRule) === JSON.stringify({ "2+": "all" }), JSON.stringify(two.laneRule));
    await lr.locator("#settings-lanes-from").selectOption("3"); await lr.waitForTimeout(400);
    check("choosing 3: one lane from two players, both from three", JSON.stringify((await stored()).laneRule) === JSON.stringify({ "2+": 1, "3+": "all" }));
    await lr.locator("#settings-lanes-from").selectOption("4"); await lr.waitForTimeout(400);
    check("choosing 4 again leaves no rule, as a map that never chose", (await stored()).laneRule === undefined);
    await lr.locator("#settings-lanes-from").selectOption("2"); await lr.waitForTimeout(300);
    await lr.keyboard.press("Escape"); await lr.waitForTimeout(300);
    await openBalance();
    const text = await lr.locator(".setup-balance").textContent();
    check("Map balance counts by it: every space is open at a table of three, and nothing is said of a second lane being shut", /99 wagon spaces/.test(text) && !/of them open to a table/.test(text), text.slice(0, 260));
    await lr.keyboard.press("Escape"); await lr.waitForTimeout(300);
    await lr.getByRole("button", { name: "Settings" }).click(); await lr.waitForTimeout(400);
    await lr.locator("#settings-lanes-from").selectOption("4"); await lr.waitForTimeout(300);
    await lr.keyboard.press("Escape"); await lr.waitForTimeout(300);
    await openBalance();
    const std = await lr.locator(".setup-balance").textContent();
    check("and at the standard 4 it says that a second lane opens from four players, and counts 95 of 99 open", /95 of them open/.test(std) && /opens from 4 players/.test(std), std.slice(0, 300));
    await lr.keyboard.press("Escape"); await lr.waitForTimeout(300);
    // A rule of the map's own, from a file.
    await lr.evaluate(() => { const map = JSON.parse(localStorage.getItem("ttr-map")); map.laneRule = { "2": 1, "3": 2, "4": "all" }; localStorage.setItem("ttr-map", JSON.stringify(map)); });
    await lr.reload({ waitUntil: "networkidle" }); await lr.waitForTimeout(500);
    check("a rule of the map's own survives a reload", JSON.stringify((await stored()).laneRule) === JSON.stringify({ "2": 1, "3": 2, "4": "all" }));
    await lr.getByRole("button", { name: "Settings" }).click(); await lr.waitForTimeout(400);
    check("Settings shows it as the map's own rule, and says choosing a number replaces it", (await lr.locator("#settings-lanes-from").inputValue()) === "own" && /rule of its own/.test(await lr.locator("#settings-lanes-from").evaluate((el) => el.closest(".settings-pair").nextElementSibling.textContent)));
    await lr.locator("#settings-lanes-from").selectOption("5"); await lr.waitForTimeout(400);
    check("choosing a number replaces it, and the map's own rule is no longer offered", JSON.stringify((await stored()).laneRule) === JSON.stringify({ "2+": 1, "5+": "all" }) && (await lr.locator('#settings-lanes-from option[value="own"]').count()) === 0);
    await lr.context().close();
  }

  // 65. Turning the board moves the names that end up on a route, in the same step: the toast says how many, no name is left on a
  // route that could be placed clear, and Undo takes the turn and the names back together.
  if (wants(65)) {
  sectionStart(65);
    const tn = await (await browser.newContext({ viewport: { width: 1500, height: 1000 } })).newPage();
    tn.on("pageerror", (e) => errors.push(String(e)));
    await tn.goto(BASE, { waitUntil: "networkidle" });
    await tn.getByRole("button", { name: "Load the example map" }).click();
    await tn.waitForTimeout(600);
    const stored = () => tn.evaluate(() => JSON.parse(localStorage.getItem("ttr-map")));
    const onRoute = () => tn.getByText(/stop names? on a route/).count();
    // Start from names that are clear, as after pressing the button, so a name on a route afterwards is the turn's doing.
    if (await onRoute()) { await tn.getByRole("button", { name: /Move \d+ names? clear/ }).click(); await tn.waitForTimeout(500); }
    check("before the turn no name is on a route", (await onRoute()) === 0);
    const before = await stored();
    await tn.getByRole("button", { name: "Settings" }).click(); await tn.waitForTimeout(400);
    await tn.locator('#settings-orientation input[value="portrait"]').check(); await tn.waitForTimeout(700);
    const toasts = (await tn.locator("[data-sonner-toast]").allTextContents()).join(" | ");
    const turned = await stored();
    check("the board stands", turned.orientation === "portrait");
    check("the turn says how many names it moved clear of the routes", /Turned the board, and moved \d+ names? clear of the routes/.test(toasts), toasts);
    await tn.keyboard.press("Escape"); await tn.waitForTimeout(400);
    check("and no name sits on a route after it", (await onRoute()) === 0);
    check("some names did move: their angles are not those the plain turn gave them", turned.stops.some((st) => { const was = before.stops.find((b) => b.id === st.id); return st.labelAngle !== undefined && was && (was.labelAngle === undefined || ((was.labelAngle + 90) % 360 + 360) % 360 !== st.labelAngle); }));
    await tn.getByRole("button", { name: "Undo" }).click(); await tn.waitForTimeout(500);
    const undone = await stored();
    check("Undo takes the turn and the names back in one step: the board lies, and the names are as they were", undone.orientation === undefined && undone.stops.every((st) => { const was = before.stops.find((b) => b.id === st.id); return st.x === was.x && st.y === was.y && st.labelAngle === was.labelAngle; }));
    await tn.context().close();
  }

  // 66. The phone: the map first, the tools and the properties in sheets from a bar at the foot of the screen. At 390 px wide the
  // map is in view without scrolling, the tools are one tap away and shut again when a tool is chosen, a selected object has its
  // properties one tap away, and nothing spills sideways. A wide screen has none of it.
  if (wants(66)) {
  sectionStart(66);
    const phoneCtx = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true, deviceScaleFactor: 2 });
    const ph = await phoneCtx.newPage();
    ph.on("pageerror", (e) => errors.push(String(e)));
    await ph.goto(BASE, { waitUntil: "networkidle" });
    await ph.getByRole("button", { name: "Load the example map" }).click();
    await ph.waitForTimeout(600);
    const visibleHeight = (selector) => ph.evaluate((sel) => { const r = document.querySelector(sel).getBoundingClientRect(); return Math.max(0, Math.min(r.bottom, innerHeight) - Math.max(r.top, 0)); }, selector);
    const shown = async (selector) => (await ph.locator(selector).count()) > 0 && (await ph.locator(selector).first().isVisible());
    check("the map is in view without scrolling: at least 40 % of the screen's height", (await visibleHeight(".map-wrap")) >= 0.4 * 844, `${Math.round(await visibleHeight(".map-wrap"))} px of 844`);
    check("the top of the page is short: the map starts within the top third", (await ph.evaluate(() => document.querySelector(".map-wrap").getBoundingClientRect().top)) <= 844 / 3, String(await ph.evaluate(() => Math.round(document.querySelector(".map-wrap").getBoundingClientRect().top))));
    check("the tools are not on the page until asked for, and a bar at the foot offers them", !(await shown(".tools-panel")) && (await shown(".phone-bar")) && (await ph.locator(".phone-bar").evaluate((el) => { const r = el.getBoundingClientRect(); return Math.round(r.bottom) === innerHeight; })));
    check("nothing spills sideways", (await ph.evaluate(() => document.documentElement.scrollWidth)) <= 390, String(await ph.evaluate(() => document.documentElement.scrollWidth)));
    await ph.locator("#phone-tools").tap(); await ph.waitForTimeout(300);
    check("Tools opens the tools, above the bar and inside the screen", (await shown(".tools-panel")) && (await ph.locator(".tools-panel").evaluate((el) => { const r = el.getBoundingClientRect(), bar = document.querySelector(".phone-bar").getBoundingClientRect(); return r.bottom <= bar.top + 1 && r.top >= 0 && r.left >= 0 && r.right <= innerWidth + 1; })));
    check("with every tool and the panels reachable: Settings, Map balance, Tickets, Rules", (await ph.locator(".tools-panel").getByRole("button", { name: "Settings" }).isVisible()) && (await ph.locator(".tools-panel").getByRole("button", { name: "Map balance", exact: true }).isVisible()));
    await ph.locator("#phone-tools").tap(); await ph.waitForTimeout(300);
    check("tapping it again shuts them", !(await shown(".tools-panel")));
    await ph.locator("#phone-tools").tap(); await ph.waitForTimeout(300);
    await ph.locator(".tools-panel .tool-row button").nth(1).tap(); await ph.waitForTimeout(300);
    check("choosing a tool shuts the sheet, so the map can be touched, and the tool is the one chosen", !(await shown(".tools-panel")) && (await ph.locator(".tool-row button").nth(1).getAttribute("aria-pressed")) === "true");
    await ph.locator("#phone-tools").tap(); await ph.waitForTimeout(300);
    await ph.locator(".tools-panel .tool-row button").nth(0).tap(); await ph.waitForTimeout(300);
    await ph.locator("#phone-tools").tap(); await ph.waitForTimeout(300);
    await ph.locator(".tools-panel").getByRole("button", { name: "Settings" }).tap(); await ph.waitForTimeout(500);
    check("Settings opens as a dialog that fits the screen, and the sheet is out of its way", !(await shown(".tools-panel")) && (await ph.getByRole("dialog").evaluate((el) => { const r = el.getBoundingClientRect(); return r.left >= 0 && r.right <= innerWidth + 1; })));
    await ph.keyboard.press("Escape"); await ph.waitForTimeout(300);
    check("the properties are on the bar too, with no mark while nothing is selected", (await ph.locator("#phone-properties").count()) === 1 && (await ph.locator("#phone-properties .phone-dot").count()) === 0);
    // Select a stop by touching it.
    const stop = await ph.locator(".map-canvas .stop").first().boundingBox();
    await ph.touchscreen.tap(stop.x + stop.width / 2, stop.y + stop.height / 2); await ph.waitForTimeout(400);
    check("selecting a stop marks the Properties button", (await ph.locator("#phone-properties .phone-dot").count()) === 1);
    await ph.locator("#phone-properties").tap(); await ph.waitForTimeout(300);
    check("which opens the properties of that stop in a sheet", (await shown(".properties")) && /Name|Stop/i.test(await ph.locator(".properties").textContent()));
    const box = await ph.locator(".map-wrap").boundingBox();
    // A sheet fills the room up to the header, so the map is under it: the cross shuts it, and so does Escape (with the focus back on the bar's button).
    await ph.locator(".properties .phone-sheet-close").tap(); await ph.waitForTimeout(300);
    await ph.locator("#phone-tools").tap(); await ph.waitForTimeout(300);
    await ph.keyboard.press("Escape"); await ph.waitForTimeout(300);
    check("Escape shuts the sheet that is open, and the focus goes to the bar's button", !(await shown(".tools-panel")) && (await ph.evaluate(() => document.activeElement && document.activeElement.id === "phone-tools")));
    // A panel opened from the tools shows in the sheet of the properties.
    await ph.locator("#phone-tools").tap(); await ph.waitForTimeout(300);
    await ph.locator(".tools-panel").getByRole("button", { name: "Map balance", exact: true }).tap(); await ph.waitForTimeout(700);
    check("Map balance, opened from the tools, opens in the sheet of panels and the tools sheet is shut", (await shown(".properties")) && !(await shown(".tools-panel")) && /Map balance/.test(await ph.locator(".properties").textContent()));
    check("and still nothing spills sideways", (await ph.evaluate(() => document.documentElement.scrollWidth)) <= 390);
    // Keyboard focus follows the sheets (a keyboard, a switch and a screen reader reach the phone too): into a sheet when it opens,
    // into the opened panel when a button of the tools opens one, back to the bar's button when a sheet shuts after a choice.
    const within = (selector) => ph.evaluate((sel) => { const a = document.activeElement; return Boolean(a && a.closest(sel)); }, selector);
    await ph.locator(".properties .phone-sheet-close").tap(); await ph.waitForTimeout(300);
    await ph.locator("#phone-tools").tap(); await ph.waitForTimeout(300);
    check("opening the tools puts keyboard focus in them, not left on the bar", await within(".tools-panel"));
    await ph.locator(".tools-panel").getByRole("button", { name: "Tickets", exact: true }).focus();
    await ph.keyboard.press("Enter"); await ph.waitForTimeout(600);
    check("a panel opened with the keyboard from the tools has the focus, not the button that is now out of sight", (await shown(".properties")) && !(await shown(".tools-panel")) && (await within(".properties")));
    await ph.locator("#phone-tools").tap(); await ph.waitForTimeout(300);
    await ph.locator(".tools-panel .tool-row button").nth(1).focus();
    await ph.keyboard.press("Enter"); await ph.waitForTimeout(300);
    check("choosing a tool with the keyboard shuts the sheet and the focus goes to the bar's Tools button", !(await shown(".tools-panel")) && (await ph.evaluate(() => document.activeElement && document.activeElement.id === "phone-tools")));
    await phoneCtx.close();
    // A wide screen has none of it.
    const wide = await (await browser.newContext({ viewport: { width: 1500, height: 1000 } })).newPage();
    await wide.goto(BASE, { waitUntil: "networkidle" });
    await wide.getByRole("button", { name: "Load the example map" }).click(); await wide.waitForTimeout(500);
    check("a wide screen has no phone bar, and its tools are on the page as ever", !(await wide.locator(".phone-bar").isVisible()) && (await wide.locator(".tools-panel").isVisible()) && (await wide.locator(".properties").isVisible()));
    await wide.getByRole("button", { name: "Map balance", exact: true }).focus();
    await wide.keyboard.press("Enter"); await wide.waitForTimeout(600);
    check("and opening a panel there does not move the focus: it stays where it was", await wide.evaluate(() => { const a = document.activeElement; return !a || (!a.matches(".tools-panel, .properties") && a.tagName !== "ASIDE"); }));
    await wide.context().close();
  }

  // 67. The phone, finished: Settings and the other dialogs fit and read at 390 px, the map can be zoomed (buttons in the bar, and a
  // pinch with two fingers that keeps the point between them in place) from the whole map in view to a size to work in, and a notice
  // sits above the bar, not under it.
  if (wants(67)) {
  sectionStart(67);
    const ctx67 = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true, deviceScaleFactor: 2 });
    const pz = await ctx67.newPage();
    pz.on("pageerror", (e) => errors.push(String(e)));
    await pz.goto(BASE, { waitUntil: "networkidle" });
    await pz.getByRole("button", { name: "Load the example map" }).click();
    await pz.waitForTimeout(700);
    const canvasWidth = () => pz.evaluate(() => Math.round(document.querySelector(".map-canvas").getBoundingClientRect().width));
    const wrapInner = () => pz.evaluate(() => { const w = document.querySelector(".map-wrap"); const cs = getComputedStyle(w); return Math.round(w.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight)); });
    const sideways = () => pz.evaluate(() => document.documentElement.scrollWidth);
    // User test 47: it starts as the whole map, as wide as the area it is in (not the 900 px it had before).
    const start = await canvasWidth();
    check("the map starts whole: as wide as the area it is in, nothing to scroll sideways", Math.abs(start - (await wrapInner())) <= 2 && start < 600, `${start} against ${await wrapInner()}`);
    check("the bar has the zoom: smaller, the whole map, larger", (await pz.locator("#phone-zoom-out").isVisible()) && (await pz.locator("#phone-zoom-fit").isVisible()) && (await pz.locator("#phone-zoom-in").isVisible()));
    await pz.locator("#phone-zoom-fit").tap(); await pz.waitForTimeout(300);
    const fit = await canvasWidth(), inner = await wrapInner();
    check("Fit shows the whole map: as wide as the area it is in, no sideways scroll needed", Math.abs(fit - inner) <= 2 && (await pz.evaluate(() => { const w = document.querySelector(".map-wrap").getBoundingClientRect(), c = document.querySelector(".map-canvas").getBoundingClientRect(); return c.left >= w.left - 1 && c.right <= w.right + 1; })), `${fit} against ${inner}`);
    await pz.locator("#phone-zoom-in").tap(); await pz.waitForTimeout(300);
    const bigger = await canvasWidth();
    check("larger makes it larger, by a step", bigger > fit * 1.2, `${fit} then ${bigger}`);
    await pz.locator("#phone-zoom-out").tap(); await pz.waitForTimeout(300);
    check("smaller takes it back", Math.abs((await canvasWidth()) - fit) <= 2);
    for (let i = 0; i < 8; i++) await pz.locator("#phone-zoom-out").tap({ force: true });
    await pz.waitForTimeout(200);
    check("it does not go smaller than the whole map", (await canvasWidth()) >= inner - 2);
    for (let i = 0; i < 12; i++) await pz.locator("#phone-zoom-in").tap({ force: true });
    await pz.waitForTimeout(200);
    const most = await canvasWidth();
    check("nor larger than a limit: six times the whole map", most <= inner * 6 + 2 && most > inner * 4, `${most} of ${inner}`);
    check("and nothing spills sideways at any size", (await sideways()) <= 390);
    await pz.locator("#phone-zoom-fit").tap(); await pz.waitForTimeout(300);
    // A pinch with two fingers: pointer events, as a touch screen sends them, spread apart from the middle of the map.
    const pinch = async (from, to, centre) => pz.evaluate(([f, t, c]) => { const el = document.querySelector(".map-wrap"); const fire = (type, id, x, y) => el.dispatchEvent(new PointerEvent(type, { pointerId: id, pointerType: "touch", isPrimary: id === 1, clientX: x, clientY: y, bubbles: true, cancelable: true })); fire("pointerdown", 1, c.x - f / 2, c.y); fire("pointerdown", 2, c.x + f / 2, c.y); for (let i = 1; i <= 10; i++) { const d = f + ((t - f) * i) / 10; fire("pointermove", 1, c.x - d / 2, c.y); fire("pointermove", 2, c.x + d / 2, c.y); } fire("pointerup", 1, c.x - t / 2, c.y); fire("pointerup", 2, c.x + t / 2, c.y); }, [from, to, centre]);
    // Between the fingers is a point of the map (one outside it cannot be kept still: nothing scrolls past the map's edge).
    const centre = await pz.evaluate(() => { const r = document.querySelector(".map-canvas").getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; });
    const before = await canvasWidth();
    const under = await pz.evaluate((c) => { const r = document.querySelector(".map-canvas").getBoundingClientRect(); return { fx: (c.x - r.left) / r.width, fy: (c.y - r.top) / r.height }; }, centre);
    await pinch(60, 180, centre); await pz.waitForTimeout(300);
    const after = await canvasWidth();
    check("spreading two fingers zooms in, about as much as they spread (three times)", after > before * 2.5 && after < before * 3.5 || after >= inner * 5.9, `${before} then ${after}`);
    const kept = await pz.evaluate((arg) => { const r = document.querySelector(".map-canvas").getBoundingClientRect(), w = document.querySelector(".map-wrap"); return { x: r.left + arg.under.fx * r.width, y: r.top + arg.under.fy * r.height, atX: w.scrollLeft <= 0 || w.scrollLeft >= w.scrollWidth - w.clientWidth - 1, atY: w.scrollTop <= 0 || w.scrollTop >= w.scrollHeight - w.clientHeight - 1 }; }, { under });
    // Kept to within a few pixels, unless the map's own edge stops it: nothing scrolls past the end of what there is to scroll.
    check("and the point between the fingers stays between them (or the edge of the map stops it)", (Math.abs(kept.x - centre.x) <= 6 || kept.atX) && (Math.abs(kept.y - centre.y) <= 6 || kept.atY), `${Math.round(kept.x - centre.x)}, ${Math.round(kept.y - centre.y)} px off, at an edge: ${kept.atX}, ${kept.atY}`);
    await pinch(180, 60, centre); await pz.waitForTimeout(300);
    check("pinching together zooms out again", (await canvasWidth()) < after * 0.6, `${after} then ${await canvasWidth()}`);
    await pz.locator("#phone-zoom-fit").tap(); await pz.waitForTimeout(300);
    check("the zoom buttons carry on from where a pinch left it (the state is the map's, not the gesture's)", await (async () => { await pinch(60, 120, centre); await pz.waitForTimeout(200); const w = await canvasWidth(); await pz.locator("#phone-zoom-in").tap(); await pz.waitForTimeout(250); return (await canvasWidth()) > w * 1.2; })());
    await pz.locator("#phone-zoom-fit").tap();
    // Two fingers on the board with the Add stop tool chosen: the first finger places a stop as it always did, the second is part of a
    // pinch and places nothing.
    await pz.locator("#phone-zoom-fit").tap(); await pz.waitForTimeout(200);
    await pz.locator("#phone-tools").tap(); await pz.waitForTimeout(300);
    await pz.locator(".tools-panel .tool-row button").nth(1).tap(); await pz.waitForTimeout(300);
    const stopsBefore = await pz.locator(".map-canvas .stop").count();
    await pz.evaluate(() => { const bg = document.querySelector(".map-canvas .map-bg") || document.querySelector(".map-canvas"); const r = bg.getBoundingClientRect(); const fire = (type, id, primary, x, y) => bg.dispatchEvent(new PointerEvent(type, { pointerId: id, pointerType: "touch", isPrimary: primary, clientX: x, clientY: y, bubbles: true, cancelable: true })); const y = r.top + r.height * 0.85; fire("pointerdown", 21, true, r.left + 40, y); fire("pointerdown", 22, false, r.left + 120, y); fire("pointermove", 21, true, r.left + 30, y); fire("pointermove", 22, false, r.left + 130, y); fire("pointerup", 22, false, r.left + 130, y); fire("pointerup", 21, true, r.left + 30, y); });
    await pz.waitForTimeout(400);
    const stopsAfter = await pz.locator(".map-canvas .stop").count();
    check("a second finger lands on the board with the Add stop tool and places nothing: at most one stop for the pair", stopsAfter - stopsBefore <= 1, `${stopsBefore} then ${stopsAfter}`);
    await pz.getByRole("button", { name: "Undo" }).tap(); await pz.waitForTimeout(300);
    await pz.locator("#phone-tools").tap(); await pz.waitForTimeout(300);
    await pz.locator(".tools-panel .tool-row button").nth(0).tap(); await pz.waitForTimeout(300);
    // The zoom is brought back inside its limits when the screen's size changes (a phone turned and turned back).
    await pz.locator("#phone-zoom-fit").tap(); await pz.waitForTimeout(200);
    for (let i = 0; i < 12; i++) await pz.locator("#phone-zoom-in").tap({ force: true });
    await pz.setViewportSize({ width: 667, height: 390 }); await pz.waitForTimeout(400);
    await pz.setViewportSize({ width: 390, height: 844 }); await pz.waitForTimeout(400);
    const fitNow = await pz.evaluate(() => { const w = document.querySelector(".map-wrap"); const cs = getComputedStyle(w); return Math.round(w.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight)); });
    check("turned and turned back, the map is still within six times the whole map", (await canvasWidth()) <= fitNow * 6 + 2 && (await canvasWidth()) >= fitNow - 2, `${await canvasWidth()} of ${fitNow}`);
    await pz.locator("#phone-zoom-in").tap(); await pz.waitForTimeout(250);
    check("and larger makes it larger, not smaller", (await canvasWidth()) >= fitNow * 6 - 2 || (await canvasWidth()) > fitNow * 6 * 0.99);
    await pz.locator("#phone-zoom-fit").tap(); await pz.waitForTimeout(200);
    // Settings: a column, the pages in a row above it, the board's choices readable.
    await pz.locator("#phone-tools").tap(); await pz.waitForTimeout(300);
    await pz.locator(".tools-panel").getByRole("button", { name: "Settings" }).tap(); await pz.waitForTimeout(600);
    const settings = await pz.evaluate(() => {
      const dialog = document.querySelector("[role=dialog]"), body = dialog.querySelector(".settings-body"), nav = dialog.querySelector(".settings-nav");
      const items = [...nav.querySelectorAll(".settings-nav-item")].map((el) => Math.round(el.getBoundingClientRect().top));
      const radio = dialog.querySelector("#settings-format label span strong");
      const dr = dialog.getBoundingClientRect(), br = body.getBoundingClientRect();
      const wide = [...dialog.querySelectorAll(".settings-body *")].filter((el) => { const r = el.getBoundingClientRect(); return r.width > 0 && r.right > dr.right + 1 && !el.closest("[data-scroll], .overflow-x-auto"); }).length;
      return { dialogInside: dr.left >= 0 && dr.right <= innerWidth + 1, bodyWide: br.width, navRow: new Set(items).size === 1, labelHeight: Math.round(radio.getBoundingClientRect().height), wide };
    });
    check("Settings fits the screen, with its pages in one row on top and the settings under them using the width", settings.dialogInside && settings.navRow && settings.bodyWide >= 300, JSON.stringify(settings));
    check("the board's choices are readable: a name fits on one line, not a word to a line", settings.labelHeight <= 24, `${settings.labelHeight} px high`);
    check("and nothing in it reaches beyond the dialog's edge", settings.wide === 0, `${settings.wide} elements`);
    // Standing the board up makes a notice (names moved clear of the routes): it sits above the bar, not under it.
    await pz.locator('#settings-orientation input[value="portrait"]').check(); await pz.waitForTimeout(700);
    await pz.keyboard.press("Escape"); await pz.waitForTimeout(400);
    check("a notice sits above the bar, not under it, and not over the buttons at the top", (await pz.locator("[data-sonner-toast]").count()) > 0 && (await pz.evaluate(() => { const t = document.querySelector("[data-sonner-toast]").getBoundingClientRect(), bar = document.querySelector(".phone-bar").getBoundingClientRect(); const print = [...document.querySelectorAll("button")].find((b) => /Print map/.test(b.textContent)).getBoundingClientRect(); const hit = document.elementFromPoint(print.x + print.width / 2, print.y + print.height / 2); return t.bottom <= bar.top + 1 && t.top > print.bottom && Boolean(hit && /Print map/.test(hit.textContent || "")); })));
    await pz.locator("#phone-menu").tap(); await pz.waitForTimeout(250);
    await pz.getByRole("button", { name: "Print map" }).tap(); await pz.waitForTimeout(600);
    check("the print dialog fits too", await pz.evaluate(() => { const d = document.querySelector("[role=dialog]").getBoundingClientRect(); return d.left >= 0 && d.right <= innerWidth + 1 && document.documentElement.scrollWidth <= 390; }));
    await ctx67.close();
  }

  // 68. Hostile maps on screen: a map whose optional fields hold values the editor does not know (a word, a number, nothing: what a
  // newer version or a damaged file could hold) opens and is drawn, and Settings, Map balance, Tickets, Rules, the properties of a
  // stop and a route, and the print dialog open on it without an error. If one fails, each field is tried alone to name it.
  if (wants(68)) {
  sectionStart(68);
    const hp = await (await browser.newContext({ viewport: { width: 1500, height: 1000 } })).newPage();
    const hostileErrors = [];
    hp.on("pageerror", (e) => hostileErrors.push(String(e)));
    await hp.goto(BASE, { waitUntil: "networkidle" });
    await hp.getByRole("button", { name: "Load a map with problems" }).click();
    await hp.waitForTimeout(700);
    const baseMap = await hp.evaluate(() => JSON.parse(localStorage.getItem("ttr-map")));
    const enrich = (m) => {
      Object.assign(m.stops[0], { hub: true, size: "medium", symbol: "letter", letter: "A", labelAngle: 45, endGapMm: 2, locked: true, labelLocked: true });
      Object.assign(m.routes[0], { contested: true, points: [{ x: m.stops[0].x + 10, y: m.stops[0].y + 10 }], locomotiveSlots: [1], curved: true });
      if (m.lineStyles[0]) m.routes[0].lineStyle = m.lineStyles[0].id;
      if (m.wagonStyles && m.wagonStyles[0]) m.routes[0].wagonStyle = m.wagonStyles[0].id;
      Object.assign(m.tickets[0], { long: true, adjust: 1 });
      Object.assign(m.routeTypeStyles[0], { shape: "plain", glyph: "R" });
      if (m.wagonStyles && m.wagonStyles[0]) m.wagonStyles[0].glyph = "W";
      Object.assign(m.stopTypeStyles[0], { square: true, junction: false });
      Object.assign(m, { orientation: "portrait", rules: "Some rules.", endGapMm: 2, deckTension: 50, ticketBands: { medium: 0.35, long: 0.6 }, ticketMix: { short: 30, medium: 47, long: 23 }, ticketValuation: { longBonus: true, ferryPremium: 1 }, laneRule: { "2+": 1, "3+": "all" }, panelMm: { width: 214, height: 140 }, wagonMm: { length: 24, width: 11, gap: 7, endMargin: 18 }, stopMm: 18.5, nameMm: 5.8, players: { min: 2, max: 3 }, wagonsPerPlayer: 28, startingTickets: 3, keptTickets: 2 });
      return m;
    };
    const KEEP = new Set(["id", "x", "y", "a", "b", "length", "unknown", "stops", "routes", "tickets", "ticketSets", "points", "stopTypeStyles", "routeTypeStyles", "wagonStyles", "lineStyles", "background", "notes"]);
    // Every optional field of the first object of each list, and of the map, set to `value`: the fields a map cannot do without are left.
    const hostile = (value, only) => {
      const m = enrich(JSON.parse(JSON.stringify(baseMap)));
      const names = [];
      const visit = (obj, prefix) => { for (const key of Object.keys(obj)) { const here = `${prefix}${key}`; if (KEEP.has(key)) { if (Array.isArray(obj[key]) && obj[key].length && obj[key][0] && typeof obj[key][0] === "object" && !Array.isArray(obj[key][0]) && !["points"].includes(key)) visit(obj[key][0], `${here}.0.`); continue; } names.push(here); if (!only || only === here) obj[key] = value; } };
      visit(m, "");
      return { map: m, names };
    };
    const tryOpen = async (map) => {
      const before = hostileErrors.length;
      await hp.evaluate((m) => localStorage.setItem("ttr-map", JSON.stringify(m)), map);
      await hp.reload({ waitUntil: "networkidle" }); await hp.waitForTimeout(500);
      const alive = async () => (await hp.locator(".workspace").count()) === 1 && (await hp.locator(".map-canvas").count()) === 1 && hostileErrors.length === before;
      let ok_ = await alive();
      const steps = [
        async () => { await hp.getByRole("button", { name: "Settings" }).click(); await hp.waitForTimeout(300); for (const label of ["Deck rules", "Stop types", "Route types", "Default object style", "Map"]) { await hp.locator(".settings-nav-item", { hasText: new RegExp(`^${label}`) }).click(); await hp.waitForTimeout(150); } await hp.keyboard.press("Escape"); await hp.waitForTimeout(200); },
        async () => { await hp.getByRole("button", { name: "Map balance", exact: true }).click(); await hp.waitForTimeout(500); },
        async () => { await hp.getByRole("button", { name: "Tickets", exact: true }).click(); await hp.waitForTimeout(500); },
        async () => { await hp.getByRole("button", { name: "Rules", exact: true }).click(); await hp.waitForTimeout(400); },
        async () => { const stop = await hp.locator(".map-canvas .stop").first().boundingBox(); await hp.mouse.click(stop.x + stop.width / 2, stop.y + stop.height / 2); await hp.waitForTimeout(300); },
        async () => { await hp.getByRole("button", { name: "Print map" }).click(); await hp.waitForTimeout(500); await hp.keyboard.press("Escape"); await hp.waitForTimeout(200); },
      ];
      for (const step of steps) { if (!ok_) break; try { await step(); } catch { /* a missing control is not this test's concern: the error count is */ } ok_ = await alive(); }
      return ok_;
    };
    const failedFields = [];
    for (const [label, value] of [["a word the editor does not know", "huge"], ["a number", 5], ["nothing", null], ["true", true], ["an empty object", {}], ["an empty list", []], ["a word every object has", "constructor"], ["__proto__", "__proto__"]]) {
      const all = hostile(value);
      const fine = await tryOpen(all.map);
      check(`with every optional field set to ${label}, the map opens and everything on it opens`, fine, fine ? `${all.names.length} fields` : "");
      if (!fine) { for (const name of all.names) { const one = hostile(value, name); if (!(await tryOpen(one.map))) failedFields.push(`${name} = ${JSON.stringify(value)}`); } }
    }
    if (failedFields.length) check("and the fields that broke it, tried alone: none", false, failedFields.slice(0, 12).join("; "));
    await hp.context().close();
  }

  // 69. A cross in the top right corner of each sheet on the phone, as well as the bar's button: it shuts the sheet, and a panel that
  // is open in it (Map balance, Tickets, Rules, Suggest routes) is closed too, as its Done button does; the focus goes back to the bar.
  if (wants(69)) {
  sectionStart(69);
    const cx = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true, deviceScaleFactor: 2 });
    const px = await cx.newPage();
    px.on("pageerror", (e) => errors.push(String(e)));
    await px.goto(BASE, { waitUntil: "networkidle" });
    await px.getByRole("button", { name: "Load the example map" }).click();
    await px.waitForTimeout(600);
    const corner = (sheet) => px.evaluate((sel) => { const s = document.querySelector(sel).getBoundingClientRect(), b = document.querySelector(`${sel} .phone-sheet-close`).getBoundingClientRect(); return { fromTop: Math.round(b.top - s.top), fromRight: Math.round(s.right - b.right), size: Math.round(Math.min(b.width, b.height)) }; }, sheet);
    await px.locator("#phone-tools").tap(); await px.waitForTimeout(300);
    const t = await corner(".tools-panel");
    check("the tools sheet has a cross in its top right corner, big enough to touch", t.fromTop <= 16 && t.fromRight <= 16 && t.size >= 36, JSON.stringify(t));
    check("it is named, for a screen reader", (await px.locator(".tools-panel .phone-sheet-close").getAttribute("aria-label")) === "Close the tools");
    await px.locator(".tools-panel .phone-sheet-close").tap(); await px.waitForTimeout(300);
    check("touching it shuts the sheet and puts the focus on the bar's Tools button", !(await px.locator(".tools-panel").isVisible()) && (await px.evaluate(() => document.activeElement && document.activeElement.id === "phone-tools")));
    const stop = await px.locator(".map-canvas .stop").first().boundingBox();
    await px.touchscreen.tap(stop.x + stop.width / 2, stop.y + stop.height / 2); await px.waitForTimeout(300);
    await px.locator("#phone-properties").tap(); await px.waitForTimeout(300);
    const p_ = await corner(".properties");
    check("the properties sheet has one too", p_.fromTop <= 16 && p_.fromRight <= 16 && p_.size >= 36, JSON.stringify(p_));
    await px.locator(".properties .phone-sheet-close").tap(); await px.waitForTimeout(300);
    check("which shuts it, and the focus goes to the bar's Properties button", !(await px.locator(".properties").isVisible()) && (await px.evaluate(() => document.activeElement && document.activeElement.id === "phone-properties")));
    // The cross stays in view when the sheet is scrolled, and shuts a panel that is open in it.
    await px.locator("#phone-tools").tap(); await px.waitForTimeout(300);
    await px.locator(".tools-panel").getByRole("button", { name: "Map balance", exact: true }).tap(); await px.waitForTimeout(800);
    await px.locator(".properties").evaluate((el) => { el.scrollTop = 600; });
    await px.waitForTimeout(200);
    const still = await corner(".properties");
    check("when a panel is open and the sheet is scrolled the cross is still in the corner", still.fromTop <= 16, JSON.stringify(still));
    await px.locator(".properties .phone-sheet-close").tap(); await px.waitForTimeout(400);
    check("the cross shuts the panel as well as the sheet: Map balance is not there when the properties are opened again", !(await px.locator(".properties").isVisible()) && (await (async () => { await px.locator("#phone-properties").tap(); await px.waitForTimeout(300); return px.locator(".properties .analysis-section").count(); })()) === 0);
    await px.locator(".properties .phone-sheet-close").tap(); await px.waitForTimeout(300);
    for (const [name, heading] of [["Tickets", "Destination tickets"], ["Rules", "Rules"]]) {
      await px.locator("#phone-tools").tap(); await px.waitForTimeout(300);
      await px.locator(".tools-panel").getByRole("button", { name, exact: true }).tap(); await px.waitForTimeout(700);
      await px.locator(".properties .phone-sheet-close").tap(); await px.waitForTimeout(300);
      await px.locator("#phone-properties").tap(); await px.waitForTimeout(300);
      check(`${name} is closed by the cross too`, (await px.locator(".properties .panel-heading span", { hasText: new RegExp(`^${heading}$`) }).count()) === 0);
      await px.locator(".properties .phone-sheet-close").tap(); await px.waitForTimeout(300);
    }
    // A tall sheet takes all the room up to the header, no less: it is where the long panels are read.
    await px.locator("#phone-tools").tap(); await px.waitForTimeout(300);
    await px.locator(".tools-panel").getByRole("button", { name: "Map balance", exact: true }).tap(); await px.waitForTimeout(900);
    const tall = await px.evaluate(() => { const s = document.querySelector(".properties").getBoundingClientRect(), h = document.querySelector(".topbar").getBoundingClientRect(), bar = document.querySelector(".phone-bar").getBoundingClientRect(); return { top: Math.round(s.top), headerBottom: Math.round(h.bottom), bottom: Math.round(s.bottom), barTop: Math.round(bar.top), height: Math.round(s.height) }; });
    check("a long panel's sheet reaches up to the header (not beyond it, not short of it)", Math.abs(tall.top - tall.headerBottom) <= 2 && Math.abs(tall.bottom - tall.barTop) <= 1, JSON.stringify(tall));
    check("and that is more than the 64 % of the screen it had", tall.height > 0.64 * 844, `${tall.height} px of 844`);
    await px.locator(".properties .phone-sheet-close").tap(); await px.waitForTimeout(300);
    await px.locator("#phone-tools").tap(); await px.waitForTimeout(300);
    const short = await px.evaluate(() => { const s = document.querySelector(".tools-panel").getBoundingClientRect(), h = document.querySelector(".topbar").getBoundingClientRect(); return { top: Math.round(s.top), headerBottom: Math.round(h.bottom) }; });
    check("the tools sheet fills the room up to the header too, not only as tall as what is in it", Math.abs(short.top - short.headerBottom) <= 2, JSON.stringify(short));
    // The page works the room out itself, whatever the screen: on small, large and turned screens each sheet fills what is between the foot of the header and the top of
    // the bar, to the pixel, and the header's own height (which changes with the width) is what it goes by.
    await px.locator(".tools-panel .phone-sheet-close").tap(); await px.waitForTimeout(250);
    for (const [w, h] of [[360, 640], [430, 932], [390, 844], [667, 390]]) {
      await px.setViewportSize({ width: w, height: h }); await px.waitForTimeout(400);
      for (const [button, sheet] of [["#phone-tools", ".tools-panel"], ["#phone-properties", ".properties"]]) {
        await px.locator(button).tap(); await px.waitForTimeout(300);
        const room = await px.evaluate((sel) => { const s = document.querySelector(sel).getBoundingClientRect(), hd = document.querySelector(".topbar").getBoundingClientRect(), bar = document.querySelector(".phone-bar").getBoundingClientRect(); return { fromHeader: Math.round(s.top - hd.bottom), toBar: Math.round(bar.top - s.bottom), height: Math.round(s.height) }; }, sheet);
        check(`${w} × ${h}: ${sheet === ".tools-panel" ? "the tools" : "the properties"} fill the room between the header and the bar`, Math.abs(room.fromHeader) <= 2 && Math.abs(room.toBar) <= 1 && room.height > 150, JSON.stringify(room));
        await px.locator(`${sheet} .phone-sheet-close`).tap(); await px.waitForTimeout(250);
      }
    }
    await px.setViewportSize({ width: 390, height: 844 }); await px.waitForTimeout(300);
    // The room follows the header: with the menu open nothing moves, and after the screen is turned the sheet still ends at the header.
    await px.setViewportSize({ width: 667, height: 390 }); await px.waitForTimeout(400);
    await px.locator("#phone-tools").tap(); await px.waitForTimeout(300);
    await px.locator(".tools-panel").getByRole("button", { name: "Map balance", exact: true }).tap(); await px.waitForTimeout(800);
    const turned = await px.evaluate(() => { const s = document.querySelector(".properties").getBoundingClientRect(), h = document.querySelector(".topbar").getBoundingClientRect(); return { top: Math.round(s.top), headerBottom: Math.round(h.bottom) }; });
    check("turned on its side, the sheet still reaches up to the header and not past it", turned.top >= turned.headerBottom - 2 && turned.top <= turned.headerBottom + 4, JSON.stringify(turned));
    await cx.close();
    // Not on a wide screen.
    const wide2 = await (await browser.newContext({ viewport: { width: 1500, height: 1000 } })).newPage();
    await wide2.goto(BASE, { waitUntil: "networkidle" });
    await wide2.getByRole("button", { name: "Load the example map" }).click(); await wide2.waitForTimeout(500);
    check("a wide screen has no such cross: its panels are in the column as ever", (await wide2.locator(".phone-sheet-close").count()) === 2 && !(await wide2.locator(".phone-sheet-close").first().isVisible()) && !(await wide2.locator(".phone-sheet-close").last().isVisible()));
    await wide2.context().close();
  }

  // 70. The phone's header in two rows and the facts of the map under it: the name of the map with Undo, Redo and a menu button on the
  // second row, the other controls (Help, Import, Print, Export) in the menu, and the small boxes with facts about the map (and the
  // saving) in a row of their own under the header, which can be folded away. None of it on a wide screen.
  if (wants(70)) {
  sectionStart(70);
    const c70 = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true, deviceScaleFactor: 2 });
    const ph70 = await c70.newPage();
    ph70.on("pageerror", (e) => errors.push(String(e)));
    await ph70.goto(BASE, { waitUntil: "networkidle" });
    await ph70.getByRole("button", { name: "Load the example map" }).click();
    await ph70.waitForTimeout(700);
    const box70 = (sel) => ph70.evaluate((s) => { const r = document.querySelector(s).getBoundingClientRect(); return { top: Math.round(r.top), bottom: Math.round(r.bottom), left: Math.round(r.left), right: Math.round(r.right), height: Math.round(r.height) }; }, sel);
    const header = await box70(".topbar");
    check("the header is two rows: at most 120 px tall at 390 px wide", header.height <= 120, `${header.height} px`);
    const name = await box70("#map-name");
    check("the name of the map has the second row, with Undo, Redo and the menu button on the same row", await ph70.evaluate(() => { const top = (e) => Math.round(e.getBoundingClientRect().top); const n = document.querySelector("#map-name"); return ["Undo", "Redo"].every((l) => { const b = [...document.querySelectorAll("button")].find((x) => x.getAttribute("aria-label") === l && x.getBoundingClientRect().width > 0); return b && Math.abs(top(b) - top(n)) <= 12; }) && Math.abs(top(document.querySelector("#phone-menu")) - top(n)) <= 12; }));
    check("the saving state is not in the header any more", !(await ph70.locator(".topbar .save-state").count()) && (await ph70.locator(".phone-status .save-state").count()) === 1);
    check("Help, Import, Print map and Export are in the menu, not on the page until it is opened", await (async () => { for (const n of ["Help", "Import", "Print map", "Export"]) if (await ph70.getByRole("button", { name: n, exact: true }).isVisible().catch(() => false)) return false; return true; })());
    const mapTop = (await box70(".map-wrap")).top;
    await ph70.locator("#phone-menu").tap(); await ph70.waitForTimeout(300);
    const inScreen = await ph70.evaluate(() => ["Help", "Import", "Print map", "Export"].every((n) => { const b = [...document.querySelectorAll("button")].find((x) => x.textContent.trim() === n); if (!b) return false; const r = b.getBoundingClientRect(); return r.width > 0 && r.left >= 0 && r.right <= innerWidth + 1; }));
    check("the menu shows Help, Import, Print map and Export, all inside the screen", inScreen);
    check("it opens over the map and does not push it down", Math.abs((await box70(".map-wrap")).top - mapTop) <= 1);
    check("the menu button says whether it is open", (await ph70.locator("#phone-menu").getAttribute("aria-expanded")) === "true");
    await ph70.keyboard.press("Escape"); await ph70.waitForTimeout(250);
    check("Escape shuts it and the focus goes back to the menu button", !(await ph70.getByRole("button", { name: "Export", exact: true }).isVisible()) && (await ph70.evaluate(() => document.activeElement && document.activeElement.id === "phone-menu")));
    await ph70.locator("#phone-menu").tap(); await ph70.waitForTimeout(250);
    await ph70.getByRole("button", { name: "Print map", exact: true }).tap(); await ph70.waitForTimeout(600);
    check("choosing Print map opens the print dialog and shuts the menu", (await ph70.getByRole("dialog").count()) === 1 && !(await ph70.getByRole("button", { name: "Export", exact: true }).isVisible().catch(() => false)));
    await ph70.keyboard.press("Escape"); await ph70.waitForTimeout(300);
    await ph70.locator("#phone-menu").tap(); await ph70.waitForTimeout(250);
    const mb = await ph70.locator(".map-wrap").boundingBox();
    await ph70.touchscreen.tap(mb.x + mb.width / 2, mb.y + mb.height / 2); await ph70.waitForTimeout(300);
    check("touching the map shuts the menu", !(await ph70.getByRole("button", { name: "Export", exact: true }).isVisible().catch(() => false)));
    // The facts.
    const status = await box70(".phone-status"), head = await box70(".topbar"), wrap = await box70(".map-wrap");
    check("the facts about the map are in a row right under the header, clear of the map", status.top >= head.bottom - 1 && status.top - head.bottom <= 8 && wrap.top >= status.bottom - 1, JSON.stringify({ head: head.bottom, status, map: wrap.top }));
    check("with the number of stops and routes among them", /15 stops/.test(await ph70.locator(".phone-status").textContent()) && /20 routes/.test(await ph70.locator(".phone-status").textContent()));
    check("the chips are not over the map any more: none inside the map's area", (await ph70.locator(".map-wrap .map-status").count()) === 0);
    const before70 = (await box70(".map-wrap")).height;
    check("the row has a button to fold it away, open to begin with", (await ph70.locator("#phone-status-toggle").getAttribute("aria-expanded")) === "true");
    await ph70.locator("#phone-status-toggle").tap(); await ph70.waitForTimeout(300);
    const after70 = (await box70(".map-wrap")).height;
    check("folded, the facts are gone and the map has more room", !(await ph70.locator(".phone-status .map-status").isVisible()) && after70 >= before70 + 10 && (await ph70.locator("#phone-status-toggle").getAttribute("aria-expanded")) === "false", `${before70} then ${after70} px`);
    await ph70.reload({ waitUntil: "networkidle" }); await ph70.waitForTimeout(600);
    check("and it stays folded after a reload", (await ph70.locator("#phone-status-toggle").getAttribute("aria-expanded")) === "false" && !(await ph70.locator(".phone-status .map-status").isVisible()));
    await ph70.locator("#phone-status-toggle").tap(); await ph70.waitForTimeout(300);
    check("and opens again", await ph70.locator(".phone-status .map-status").isVisible());
    await c70.close();
    const wide70 = await (await browser.newContext({ viewport: { width: 1500, height: 1000 } })).newPage();
    await wide70.goto(BASE, { waitUntil: "networkidle" });
    await wide70.getByRole("button", { name: "Load the example map" }).click(); await wide70.waitForTimeout(500);
    check("a wide screen has none of it: no menu button, no row of facts, the controls and the chips where they were", !(await wide70.locator("#phone-menu").isVisible().catch(() => false)) && (await wide70.locator(".phone-status").count()) === 0 && (await wide70.getByRole("button", { name: "Export", exact: true }).isVisible()) && (await wide70.locator(".map-wrap .map-status").count()) === 1 && (await wide70.locator(".topbar .save-state").count()) === 1);
    await wide70.context().close();
  }

  // 71. The golden drawing: what the map's artwork draws on the boards the editor has always had must not change when stops, names and lanes are
  // worked out in millimetres for the small boards (docs/PROPOSAL-SMALL-BOARDS.md, step 2). The drawing of six maps, normalized and
  // hashed, is compared with tests/golden-drawing.json, which was recorded from the editor before that change (TTR_RECORD_GOLDEN=1 rewrites it).
  if (wants(71)) {
  sectionStart(71);
    const gp = await (await browser.newContext({ viewport: { width: 1500, height: 1000 } })).newPage();
    gp.on("pageerror", (e) => errors.push(String(e)));
    await gp.goto(BASE, { waitUntil: "networkidle" });
    await gp.getByRole("button", { name: "Load the example map" }).click();
    await gp.waitForTimeout(600);
    const example = await gp.evaluate(() => JSON.parse(localStorage.getItem("ttr-map")));
    await gp.evaluate(() => localStorage.clear()); await gp.reload({ waitUntil: "networkidle" }); await gp.waitForTimeout(500);
    await gp.getByRole("button", { name: "Load a map with problems" }).click(); await gp.waitForTimeout(600);
    const problem = await gp.evaluate(() => JSON.parse(localStorage.getItem("ttr-map")));
    const fullSample = (m) => { Object.assign(m.stops[0], { hub: true, size: "large", symbol: "letter", letter: "A", labelAngle: 45, endGapMm: 3, locked: true, labelLocked: true }); Object.assign(m.stops[1], { size: "small", symbol: "cross" }); Object.assign(m.routes[0], { contested: true, points: [{ x: m.stops[0].x + 40, y: m.stops[0].y + 30 }], curved: true }); if (m.routes[1]) m.routes[1].curved = false; return m; };
    const cases = [
      ["example on 2×3 lying", { ...example }],
      ["example on 2×4 lying", { ...example, format: "board-2x4" }],
      ["example on 3×3 standing", { ...example, format: "board-3x3", orientation: "portrait" }],
      ["problem map on 2×3 lying", { ...problem }],
      ["problem map on 3×4 standing", { ...problem, format: "board-3x4", orientation: "portrait" }],
      ["problem map with every optional field on 2×3", fullSample(JSON.parse(JSON.stringify(problem)))],
    ];
    const goldenFile = path.join(__dirname, "golden-drawing.json");
    const record = process.env.TTR_RECORD_GOLDEN === "1";
    const golden = record || !fs.existsSync(goldenFile) ? {} : JSON.parse(fs.readFileSync(goldenFile, "utf8"));
    const drawn = {};
    for (const [label, map] of cases) {
      await gp.evaluate((m) => localStorage.setItem("ttr-map", JSON.stringify(m)), map);
      await gp.reload({ waitUntil: "networkidle" }); await gp.waitForTimeout(700);
      const html = await gp.evaluate(() => { const svg = document.querySelector(".map-canvas"); const clone = svg.cloneNode(true); clone.querySelectorAll("[id]").forEach((el) => el.removeAttribute("id")); return clone.outerHTML.replace(/(clip-path|mask|filter|fill)="url\(#[^)]*\)"/g, "$1=\"url(#x)\"").replace(/\s+/g, " ").replace(/-?\d+\.\d{8,}/g, (n) => { const r = Number(n).toFixed(6); return r === "-0.000000" ? "0.000000" : r; }); });
      const hash = await gp.evaluate(async (h) => { const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(h)); return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join(""); }, html);
      drawn[label] = { hash, length: html.length };
      if (!record) check(`the drawing of the ${label} is what it was`, golden[label] && golden[label].hash === hash, golden[label] ? `${html.length} characters against ${golden[label].length}` : "no golden recorded");
      if (!record && golden[label] && golden[label].hash !== hash && process.env.TTR_GOLDEN_DUMP) fs.writeFileSync(path.join(os.tmpdir(), `golden-${label.replace(/\W+/g, "-")}.html`), html);
      if (process.env.TTR_GOLDEN_DUMP) fs.writeFileSync(path.join(os.tmpdir(), `golden-now-${label.replace(/\W+/g, "-")}.html`), html);
    }
    if (record) { fs.writeFileSync(goldenFile, `${JSON.stringify(drawn, null, 1)}\n`); check("the golden drawing was recorded", true, Object.keys(drawn).join(", ")); }
    await gp.context().close();
  }

  // 72. The small boards drawn to scale (docs/PROPOSAL-SMALL-BOARDS.md, step 2): with a board profile the wagons, the stops and the capitals of the names are
  // the sizes in millimetres the profile says, measured in the drawing itself; without one they are what they have always been.
  if (wants(72)) {
  sectionStart(72);
    const sc = await (await browser.newContext({ viewport: { width: 1500, height: 1000 } })).newPage();
    sc.on("pageerror", (e) => errors.push(String(e)));
    await sc.goto(BASE, { waitUntil: "networkidle" });
    await sc.getByRole("button", { name: "Load the example map" }).click();
    await sc.waitForTimeout(600);
    const base72 = await sc.evaluate(() => JSON.parse(localStorage.getItem("ttr-map")));
    const measure = async (map, longSideMm) => {
      await sc.evaluate((m) => localStorage.setItem("ttr-map", JSON.stringify(m)), map);
      await sc.reload({ waitUntil: "networkidle" }); await sc.waitForTimeout(700);
      return sc.evaluate((mm) => { const unit = mm / 1100;
        const stop = document.querySelector("g.stop > circle[fill]:not(.stop-symbol):not(.stop-hit)");
        const label = document.querySelector("g.stop text:not(.stop-letter)");
        const slot = document.querySelector("rect.wagon-slot-outline");
        return { unit, stopMm: 2 * Number(stop.getAttribute("r")) * unit, capitalMm: parseFloat(getComputedStyle(label).fontSize) * 0.7 * unit, wagonMm: (Number(slot.getAttribute("width")) - 2) * unit }; }, longSideMm);
    };
    const near72 = (a, b, e) => Math.abs(a - b) <= e;
    const std = await measure({ ...base72 }, 790);
    check("on the standard board a wagon is 20 mm, a stop about 9 mm across and a capital about 5.5 mm (11 units of type on screen): what they have always been", near72(std.wagonMm, 20, 0.3) && near72(std.stopMm, 9, 0.3) && near72(std.capitalMm, 5.5, 0.15), JSON.stringify(std));
    const ny72 = await measure({ ...base72, format: "board-2x2", orientation: "portrait", panelMm: { width: 214, height: 140 }, wagonMm: { length: 24 }, stopMm: 18.5, nameMm: 5.8 }, 428);
    check("New York: a wagon is 24 mm, a stop 18.5 mm across and a capital 5.8 mm high, in the drawing", near72(ny72.wagonMm, 24, 0.3) && near72(ny72.stopMm, 18.5, 0.3) && near72(ny72.capitalMm, 5.8, 0.15), JSON.stringify(ny72));
    const am72 = await measure({ ...base72, format: "board-2x2", panelMm: { width: 214, height: 165 }, wagonMm: { length: 24 }, stopMm: 14, nameMm: 4.3 }, 428);
    check("Amsterdam: a wagon is 24 mm, a stop 14 mm across and a capital 4.3 mm high", near72(am72.wagonMm, 24, 0.3) && near72(am72.stopMm, 14, 0.3) && near72(am72.capitalMm, 4.3, 0.15), JSON.stringify(am72));
    const half = await measure({ ...base72, format: "board-2x2", orientation: "portrait", panelMm: { width: 214, height: 140 } }, 428);
    check("a board of its own size with nothing else given draws a stop 9 mm across, a capital 6 mm high and a wagon of 20 mm, the standard sizes in millimetres", near72(half.stopMm, 9, 0.3) && near72(half.capitalMm, 6, 0.15) && near72(half.wagonMm, 20, 0.3), JSON.stringify(half));
    await sc.context().close();
  }

  // 73. The small boards in Settings (docs/PROPOSAL-SMALL-BOARDS.md, step 5): New York and Amsterdam (and London) as boards beside Standard and Extended, each
  // setting the board, its profile and which way it stands as one undoable step; and real sizes (panel, wagon, stop, name, in millimetres) in Custom size.
  if (wants(73)) {
  sectionStart(73);
    const sb = await (await browser.newContext({ viewport: { width: 1500, height: 1000 } })).newPage();
    sb.on("pageerror", (e) => errors.push(String(e)));
    await sb.goto(BASE, { waitUntil: "networkidle" });
    await sb.getByRole("button", { name: "Load the example map" }).click();
    await sb.waitForTimeout(600);
    const stored73 = () => sb.evaluate(() => JSON.parse(localStorage.getItem("ttr-map")));
    await sb.getByRole("button", { name: "Settings" }).click(); await sb.waitForTimeout(400);
    const values = await sb.locator('#settings-format input[type="radio"]').evaluateAll((els) => els.map((el) => el.value));
    check("Settings lists the standard board, the extended, and the two small boards", JSON.stringify(values) === JSON.stringify(["board-2x3", "board-2x4", "small-new-york", "small-amsterdam"]), values.join(", "));
    check("the standard board is the one chosen", await sb.locator('#settings-format input[value="board-2x3"]').isChecked());
    await sb.locator('#settings-format input[value="small-new-york"]').check(); await sb.waitForTimeout(600);
    const ny = await stored73();
    check("New York sets the board: 2 × 2 panels of 214 × 140 mm, 24 mm wagons, stops of 18.5 mm, capitals of 5.8 mm, the map standing", ny.format === "board-2x2" && ny.orientation === "portrait" && ny.panelMm.width === 214 && ny.panelMm.height === 140 && ny.wagonMm.length === 24 && ny.stopMm === 18.5 && ny.nameMm === 5.8, JSON.stringify([ny.format, ny.orientation, ny.panelMm, ny.wagonMm, ny.stopMm, ny.nameMm]));
    check("it is the one chosen, and Orientation says Portrait", (await sb.locator('#settings-format input[value="small-new-york"]').isChecked()) && (await sb.locator('#settings-orientation input[value="portrait"]').isChecked()));
    check("the picture of the board says 280 × 428 mm", /280 × 428 mm/.test(await sb.locator(".board-preview").textContent()) || /280 × 428 mm/.test(await sb.locator(".board-preview svg").getAttribute("aria-label")));
    check("what is on the map is on the standing board", ny.stops.every((st) => st.x >= 0 && st.x <= 720 && st.y >= 0 && st.y <= 1100));
    await sb.locator('#settings-format input[value="small-amsterdam"]').check(); await sb.waitForTimeout(600);
    const am = await stored73();
    check("Amsterdam and London: the map lies, panels of 214 × 165 mm, stops of 14 mm, capitals of 4.3 mm", am.format === "board-2x2" && !am.orientation && am.panelMm.height === 165 && am.stopMm === 14 && am.nameMm === 4.3, JSON.stringify([am.format, am.orientation, am.panelMm, am.stopMm, am.nameMm]));
    check("and the picture says 428 × 330 mm", /428 × 330 mm/.test(await sb.locator(".board-preview svg").getAttribute("aria-label")));
    await sb.locator('#settings-format input[value="board-2x3"]').check(); await sb.waitForTimeout(600);
    const back73 = await stored73();
    check("Standard takes the profile off again", back73.format === "board-2x3" && back73.panelMm === undefined && back73.wagonMm === undefined && back73.stopMm === undefined && back73.nameMm === undefined);
    await sb.keyboard.press("Escape"); await sb.waitForTimeout(300);
    await sb.getByRole("button", { name: "Undo" }).click(); await sb.waitForTimeout(500);
    check("one Undo takes the board back to Amsterdam's, profile and all", (await stored73()).panelMm && (await stored73()).panelMm.height === 165);
    // Real sizes in Custom size.
    await sb.getByRole("button", { name: "Settings" }).click(); await sb.waitForTimeout(400);
    await sb.locator("#settings-custom-board").click(); await sb.waitForTimeout(300);
    check("Custom size has fields for the real sizes: a panel, a wagon, a stop and the capitals of the names, in millimetres", await sb.locator("#custom-board-panel-long, #custom-board-panel-short, #custom-board-wagon, #custom-board-stop, #custom-board-name").count() === 5);
    await sb.locator("#custom-board-long").fill("2"); await sb.locator("#custom-board-short").fill("2");
    await sb.locator("#custom-board-panel-long").fill("200"); await sb.locator("#custom-board-panel-short").fill("300"); await sb.waitForTimeout(200);
    check("a panel whose short side is longer than its long side is said so, and cannot be used", /short side cannot be longer/i.test(await sb.locator(".custom-board-result").textContent()) && (await sb.locator("#custom-board-apply").isDisabled()));
    await sb.locator("#custom-board-panel-short").fill("150"); await sb.locator("#custom-board-wagon").fill("100"); await sb.waitForTimeout(200);
    check("a wagon of 100 mm is said to be out of 5–60 mm", /5 to 60 mm/.test(await sb.locator(".custom-board-result").textContent()) && (await sb.locator("#custom-board-apply").isDisabled()));
    await sb.locator("#custom-board-wagon").fill("22"); await sb.locator("#custom-board-stop").fill("12"); await sb.waitForTimeout(200);
    check("it says the size that makes: 2 × 2 panels of 200 × 150 mm is 400 × 300 mm", /400 × 300 mm/.test(await sb.locator(".custom-board-result").textContent()), await sb.locator(".custom-board-result").textContent());
    await sb.locator("#custom-board-apply").click(); await sb.waitForTimeout(600);
    const cu = await stored73();
    check("and applying it gives the map that board and those sizes (the capitals were filled in from Amsterdam's and stay)", cu.format === "board-2x2" && cu.panelMm.width === 200 && cu.panelMm.height === 150 && cu.wagonMm.length === 22 && cu.stopMm === 12 && cu.nameMm === 4.3, JSON.stringify([cu.format, cu.panelMm, cu.wagonMm, cu.stopMm, cu.nameMm]));
    check("the board is then a custom one in the list, chosen", (await sb.locator('#settings-format input[value="custom"]').count()) === 1 && (await sb.locator('#settings-format input[value="custom"]').isChecked()));
    // Found in review: a wagon given without a panel was thrown away, and a wagon from a file was cut down to its length.
    const reopen73 = async (edit) => { await sb.evaluate((e) => { const m = JSON.parse(localStorage.getItem("ttr-map")); const f = new Function("m", e); f(m); localStorage.setItem("ttr-map", JSON.stringify(m)); }, edit); await sb.reload({ waitUntil: "networkidle" }); await sb.waitForTimeout(600); await sb.getByRole("button", { name: "Settings" }).click(); await sb.waitForTimeout(400); await sb.locator("#settings-custom-board").click(); await sb.waitForTimeout(300); };
    await sb.keyboard.press("Escape"); await sb.keyboard.press("Escape");
    await reopen73("m.wagonMm = { length: 24, width: 11, gap: 7, endMargin: 18 };");
    await sb.locator("#custom-board-apply").click(); await sb.waitForTimeout(500);
    const kept73 = (await stored73()).wagonMm;
    check("a wagon with its own width, gap and end margin keeps them when Custom size is used again with the same length", kept73 && kept73.length === 24 && kept73.width === 11 && kept73.gap === 7 && kept73.endMargin === 18, JSON.stringify(kept73));
    await sb.keyboard.press("Escape");
    await reopen73("m.format = 'board-2x3'; delete m.panelMm; delete m.wagonMm; delete m.stopMm; delete m.nameMm; delete m.orientation;");
    await sb.locator("#custom-board-long").fill("3"); await sb.locator("#custom-board-short").fill("2");
    await sb.locator(".custom-board-real summary").click();
    for (const id of ["#custom-board-panel-long", "#custom-board-panel-short", "#custom-board-stop", "#custom-board-name"]) await sb.locator(id).fill("");
    await sb.locator("#custom-board-wagon").fill("24"); await sb.waitForTimeout(200);
    await sb.locator("#custom-board-apply").click(); await sb.waitForTimeout(500);
    const only = await stored73();
    check("a wagon given with no panel is kept, on the standard panels of that board", only.wagonMm && only.wagonMm.length === 24 && only.panelMm && only.panelMm.width === 263.3, JSON.stringify([only.wagonMm, only.panelMm]));
    await sb.context().close();
  }

  // 74. Printing a small board (docs/PROPOSAL-SMALL-BOARDS.md, step 4): a sheet per panel is one A4 sheet each, and the ticket cards come in two sizes, standard (62 × 45 mm)
  // and small (50 × 36 mm), small to begin with on a small board, and what is chosen is remembered in this browser.
  if (wants(74)) {
  sectionStart(74);
    const pp = await (await browser.newContext({ viewport: { width: 1500, height: 1000 } })).newPage();
    pp.on("pageerror", (e) => errors.push(String(e)));
    await pp.goto(BASE, { waitUntil: "networkidle" });
    await pp.getByRole("button", { name: "Load the example map" }).click();
    await pp.waitForTimeout(600);
    const cardWidth = () => pp.evaluate(() => { const c = document.querySelector(".ticket-card"); return c ? c.style.width : null; });
    const openPrint = async () => { await pp.getByRole("button", { name: "Print map", exact: true }).click(); await pp.waitForTimeout(500); };
    const tickets = pp.getByRole("checkbox", { name: "Print the tickets" });
    await openPrint();
    if (!(await tickets.isChecked())) await tickets.check();
    await pp.waitForTimeout(300);
    check("on the standard board the ticket cards are standard to begin with: 62 × 45 mm", (await pp.getByRole("radio", { name: /Standard cards/ }).isChecked()) && (await cardWidth()) === "62mm", String(await cardWidth()));
    await pp.getByRole("radio", { name: /Small cards/ }).check(); await pp.waitForTimeout(300);
    check("choosing small cards makes them 50 mm wide, and it is remembered in this browser", (await cardWidth()) === "50mm" && (await pp.evaluate(() => localStorage.getItem("ttr-print-cards"))) === "small");
    await pp.getByRole("radio", { name: /Standard cards/ }).check(); await pp.waitForTimeout(300);
    check("and standard again makes them 62", (await cardWidth()) === "62mm" && (await pp.evaluate(() => localStorage.getItem("ttr-print-cards"))) === "standard");
    await pp.keyboard.press("Escape"); await pp.waitForTimeout(300);
    // A small board: small cards unless the person has chosen, one A4 sheet for a panel.
    await pp.evaluate(() => localStorage.removeItem("ttr-print-cards")); await pp.reload({ waitUntil: "networkidle" }); await pp.waitForTimeout(500);
    await pp.getByRole("button", { name: "Settings" }).click(); await pp.waitForTimeout(300);
    await pp.locator('#settings-format input[value="small-new-york"]').check(); await pp.waitForTimeout(500);
    await pp.keyboard.press("Escape"); await pp.waitForTimeout(300);
    await openPrint();
    if (!(await tickets.isChecked())) await tickets.check();
    await pp.waitForTimeout(300);
    check("on a small board the ticket cards are small to begin with: 50 × 36 mm", (await pp.getByRole("radio", { name: /Small cards/ }).isChecked()) && (await cardWidth()) === "36mm", String(await cardWidth()));
    const panelCell = pp.locator('.print-table tbody tr[data-paper="a4"] td:nth-of-type(2) button');
    check("the table has One sheet and Per panel only: Full size would be the same four sheets", (await pp.locator(".print-table thead th").allTextContents()).join("|") === "Paper|One sheet|Per panel", (await pp.locator(".print-table thead th").allTextContents()).join("|"));
    // A Full size saved on a standard board (the choice is kept per browser) prints as Per panel on a small board, with the panel's own caption.
    await pp.keyboard.press("Escape"); await pp.waitForTimeout(300);
    await pp.evaluate(() => localStorage.setItem("ttr-print-choice", JSON.stringify({ split: "full", paper: "a4", size: "standard" })));
    await pp.reload({ waitUntil: "networkidle" }); await pp.waitForTimeout(600);
    const noteText = await pp.evaluate(() => (document.querySelector(".print-pages .print-sheet-note") || {}).textContent || "");
    check("a Full size saved on another board prints as Per panel on New York: the caption says Panel, not full size", /^Panel 1 of 4/.test(noteText) && !/^Sheet/.test(noteText), noteText);
    await openPrint();
    check("a sheet per panel is four A4 sheets on the standing New York board", (await panelCell.getAttribute("data-pages")) === "4", String(await panelCell.getAttribute("data-pages")));
    // The sheets are in the page though out of sight: a wagon of the printed board is 24 mm of the board's 428 (found in review: it printed at 19.5 on a small board).
    await pp.keyboard.press("Escape"); await pp.waitForTimeout(300);
    const share = await pp.evaluate(() => { const slot = document.querySelector(".print-pages rect.wagon-slot-outline"); return slot ? (Number(slot.getAttribute("width")) - 2) / 1100 : null; });
    check("on the printed sheets a wagon of New York is 24 of the board's 428 mm (5.6 %)", share !== null && Math.abs(share - 24 / 428) < 0.002, String(share));
    await openPrint();
    check("and there is no Anniversary size to offer", (await pp.locator(".print-table thead").textContent()).indexOf("Anniversary") === -1);
    check("the dialog calls the board by its name: Small board, New York", /Small board, New York/.test(await pp.locator(".print-dialog").textContent()), (await pp.locator(".print-dialog").textContent()).slice(0, 160));
    await pp.context().close();
  }

  // 75. The game follows a small board (docs/PROPOSAL-SMALL-BOARDS.md): a preset brings its wagons and its table unless the person chose them, says so, and Map balance quotes
  // the small official maps beside a small board and the eight classic ones beside the others.
  if (wants(75)) {
  sectionStart(75);
    const gp = await (await browser.newContext({ viewport: { width: 1500, height: 1000 } })).newPage();
    gp.on("pageerror", (e) => errors.push(String(e)));
    await gp.goto(BASE, { waitUntil: "networkidle" });
    await gp.getByRole("button", { name: "Load the example map" }).click();
    await gp.waitForTimeout(600);
    const openSettings = async () => { await gp.getByRole("button", { name: "Settings" }).click(); await gp.waitForTimeout(300); };
    const setNumber = async (id, value) => { await gp.locator(id).fill(String(value)); await gp.locator(id).blur(); };
    const game = async () => [await gp.locator("#settings-wagons").inputValue(), await gp.locator("#settings-players-max").inputValue()].join("/");
    await openSettings();
    await setNumber("#settings-wagons", 45); await setNumber("#settings-players-max", 5);
    await gp.locator('#settings-format input[value="small-new-york"]').check(); await gp.waitForTimeout(500);
    check("choosing New York on a map with the standard game gives 15 wagons and up to 4 players", (await game()) === "15/4", await game());
    check("and a message says the game followed the board", (await gp.getByText(/The game follows the board: 15 wagons a player, 2 to 4 players/).count()) > 0);
    await gp.locator('#settings-format input[value="small-amsterdam"]').check(); await gp.waitForTimeout(500);
    check("Amsterdam after it gives 16", (await game()) === "16/4", await game());
    await setNumber("#settings-wagons", 20);
    await gp.locator('#settings-format input[value="small-new-york"]').check(); await gp.waitForTimeout(500);
    check("wagons the person set (20) are kept when the board changes", (await game()) === "20/4", await game());
    await gp.locator('#settings-format input[value="board-2x3"]').check(); await gp.waitForTimeout(500);
    check("back on the standard board the wagons are still the person's, and the table a board set goes back to the standard one", (await game()) === "20/5", await game());
    // Map balance: the small maps' ranges beside a small board.
    await gp.locator('#settings-format input[value="small-new-york"]').check(); await gp.waitForTimeout(500);
    await gp.keyboard.press("Escape"); await gp.waitForTimeout(300);
    await gp.getByRole("button", { name: "Map balance", exact: true }).click(); await gp.waitForTimeout(600);
    const heading = async () => (await gp.locator(".against-official h3").textContent()) || "";
    check("Map balance on a small board is set against the small official maps", /small official maps/.test(await heading()), await heading());
    check("and says which maps and how few", /New York and Amsterdam/.test(await gp.locator(".against-official").textContent()) && /narrow/.test(await gp.locator(".against-official").textContent()));
    check("the unused-routes row quotes 17–19 %", /17–19 %/.test(await gp.locator(".official-table").textContent()), (await gp.locator(".official-table").textContent()).slice(0, 300));
    await gp.keyboard.press("Escape"); await gp.waitForTimeout(300);
    await gp.getByRole("button", { name: "Settings" }).click(); await gp.waitForTimeout(300);
    await gp.locator('#settings-format input[value="board-2x3"]').check(); await gp.waitForTimeout(500);
    await gp.keyboard.press("Escape"); await gp.waitForTimeout(300);
    if (await gp.locator(".against-official").count() === 0) { await gp.getByRole("button", { name: "Map balance", exact: true }).click(); await gp.waitForTimeout(600); }
    check("and on the standard board against the eight official maps, 7–21 % for routes no ticket needs", (await heading()) === "Against the official maps" && /7–21 %/.test(await gp.locator(".official-table").textContent()), await heading());
    await gp.context().close();
  }

  // 76. The deck builder says what it did on a small board (docs/PROPOSAL-SMALL-BOARDS.md): a line at the top of the dialog that the suggestions follow the rules made from
  // New York and Amsterdam, and how to use the large maps' instead; none on the standard board.
  if (wants(76)) {
  sectionStart(76);
    const dp = await (await browser.newContext({ viewport: { width: 1500, height: 1000 } })).newPage();
    dp.on("pageerror", (e) => errors.push(String(e)));
    await dp.goto(BASE, { waitUntil: "networkidle" });
    await dp.getByRole("button", { name: "Load the example map" }).click();
    await dp.waitForTimeout(600);
    const openBuild76 = async () => { await dp.getByRole("button", { name: "Tickets", exact: true }).click(); await dp.waitForTimeout(400); await dp.getByRole("button", { name: /Add a deck/ }).click(); await dp.waitForTimeout(250); await dp.getByRole("menuitem", { name: /Build a full deck of tickets/ }).click(); await dp.waitForSelector(".suggest-dialog", { timeout: 20000 }); await dp.waitForTimeout(400); };
    await openBuild76();
    check("on the standard board the dialog has no note about small boards", (await dp.locator(".suggest-small-note").count()) === 0 && /Generic/.test(await dp.locator(".style-card.chosen").textContent()));
    await dp.keyboard.press("Escape"); await dp.waitForTimeout(300);
    await dp.getByRole("button", { name: "Settings" }).click(); await dp.waitForTimeout(300);
    await dp.locator('#settings-format input[value="small-new-york"]').check(); await dp.waitForTimeout(500);
    await dp.keyboard.press("Escape"); await dp.waitForTimeout(300);
    await openBuild76();
    const note = async () => (await dp.locator(".suggest-small-note").count()) ? ((await dp.locator(".suggest-small-note").textContent()) || "") : "";
    check("on a small board Small boards is chosen, and a line says the suggestions follow New York and Amsterdam, about 1.3 tickets a stop", /Small boards/.test(await dp.locator(".style-card.chosen").textContent()) && /New York and Amsterdam/.test(await note()) && /1\.3 tickets/.test(await note()), await note());
    check("and how to use the large maps' targets instead", /Generic/.test(await note()));
    await dp.locator(".style-card", { hasText: "Generic" }).first().click(); await dp.waitForTimeout(300);
    check("with Generic chosen the line says Small boards would fit this board better", /small/i.test(await note()) && /Small boards/.test(await note()) && !/follow the rules made/.test(await note()), await note());
    await dp.locator(".style-card", { hasText: "Small boards" }).first().click(); await dp.waitForTimeout(300);
    await dp.keyboard.press("Escape"); await dp.waitForTimeout(300);
    // The other places that quote what the official decks measure follow the small boards' rules too (found in review).
    await dp.getByRole("button", { name: "Settings" }).click(); await dp.waitForTimeout(400);
    await dp.locator(".settings-nav-item", { hasText: /deck rules/i }).click(); await dp.waitForTimeout(400);
    check("the Deck rules page says why a small board is on Small boards, and sets it against the small official maps", /New York and Amsterdam/.test(await dp.locator(".deck-rule-default").textContent()) && /small official maps/.test(await dp.locator(".deck-rule-values").textContent()), (await dp.locator(".deck-rule-default").textContent()));
    await dp.keyboard.press("Escape"); await dp.waitForTimeout(300);
    await dp.getByRole("button", { name: "Tickets", exact: true }).click(); await dp.waitForTimeout(500);
    check("Ticket lengths on a small board is set against the small official maps, not the large ones", /Small official maps/.test(await dp.locator(".length-legend").first().textContent().catch(() => "")), await dp.locator(".length-legend").first().textContent().catch(() => "none"));
    await dp.context().close();
  }

  // 77. Background shapes (found by the owner on 2026-10-13): Ctrl+Z undoes what is done in the colour and slider fields (it did nothing with focus in them); a rectangle and a
  // circle are drawn by dragging; a shape is dragged round the board, and with its geometry locked only with Shift held; it is made larger or smaller, and every step is one undo.
  if (wants(77)) {
  sectionStart(77);
    const bp = await (await browser.newContext({ viewport: { width: 1500, height: 1000 } })).newPage();
    bp.on("pageerror", (e) => errors.push(String(e)));
    await bp.goto(BASE, { waitUntil: "networkidle" });
    await bp.getByRole("button", { name: "Start with a blank map" }).click(); await bp.waitForTimeout(500);
    if (await bp.locator('[role="dialog"]').count()) { await bp.keyboard.press("Escape"); await bp.waitForTimeout(400); }
    const shapes = () => bp.evaluate(() => JSON.parse(localStorage.getItem("ttr-map")).background);
    const settle = () => bp.waitForTimeout(350);
    const toClient = (x, y) => bp.evaluate(([x, y]) => { const svg = document.querySelector(".map-canvas"); const pt = svg.createSVGPoint(); pt.x = x; pt.y = y; const m = pt.matrixTransform(svg.getScreenCTM()); return { x: m.x, y: m.y }; }, [x, y]);
    const drag = async (from, to, { shift = false } = {}) => {
      const a = await toClient(from[0], from[1]), b = await toClient(to[0], to[1]);
      if (shift) await bp.keyboard.down("Shift");
      await bp.mouse.move(a.x, a.y); await bp.mouse.down(); await bp.mouse.move((a.x + b.x) / 2, (a.y + b.y) / 2, { steps: 4 }); await bp.mouse.move(b.x, b.y, { steps: 4 }); await bp.mouse.up();
      if (shift) await bp.keyboard.up("Shift");
      await settle();
    };
    const box = (shape) => { const xs = shape.points.map((q) => q.x), ys = shape.points.map((q) => q.y); return { x0: Math.min(...xs), y0: Math.min(...ys), x1: Math.max(...xs), y1: Math.max(...ys) }; };
    const near77 = (a, b, e = 2) => Math.abs(a - b) <= e;
    const enterDraw = async () => { if ((await bp.locator(".background-tools").count()) === 0) { await bp.getByRole("button", { name: /Draw background/ }).click(); await bp.waitForTimeout(200); } };
    await enterDraw();
    const objectChoices = await bp.locator(".background-tools select option").allTextContents();
    check("Draw background offers a rectangle and a circle beside area, line and label", ["Area", "Line", "Label", "Rectangle", "Circle"].every((name) => objectChoices.includes(name)), objectChoices.join(", "));
    // The tool says how it works, in a few lines: draw, move, lock and Shift, size, undo.
    const tips = ((await bp.locator(".background-tips").textContent().catch(() => "")) || "").replace(/\s+/g, " ");
    check("Draw background has tips on how to use it: mark a point, double-click to remove it, Shift and drag, Larger and Smaller, Esc, Ctrl+Z", /mark it/i.test(tips) && /double-click/i.test(tips) && /Shift/.test(tips) && /Larger/.test(tips) && /Esc/.test(tips) && /Ctrl\/Cmd\+Z/.test(tips) && /Option/.test(tips), tips);
    await bp.locator(".background-tools select").selectOption({ label: "Rectangle" });
    await drag([200, 150], [500, 350]);
    let list = await shapes();
    check("dragging with Rectangle chosen draws a rectangle between the two corners, and it is selected", list.length === 1 && list[0].type === "area" && list[0].points.length === 4 && near77(box(list[0]).x0, 200) && near77(box(list[0]).y0, 150) && near77(box(list[0]).x1, 500) && near77(box(list[0]).y1, 350) && (await bp.locator(".property-form #background-label").count()) === 1, JSON.stringify(list[0] && box(list[0])));
    await enterDraw();
    await bp.locator(".background-tools select").selectOption({ label: "Circle" });
    await drag([800, 300], [900, 300]);
    list = await shapes();
    const circle = list[1];
    const radii = circle ? circle.points.map((q) => Math.hypot(q.x - 800, q.y - 300)) : [];
    check("dragging with Circle chosen draws a circle from its centre out to where the pointer stops", list.length === 2 && circle.points.length >= 24 && radii.every((r) => near77(r, 100, 3)), `${circle && circle.points.length} points, radii ${Math.min(...radii).toFixed(1)}–${Math.max(...radii).toFixed(1)}`);
    await enterDraw();
    await bp.locator(".background-tools select").selectOption({ label: "Rectangle" });
    await drag([600, 500], [603, 502]);
    check("a click or a tiny drag draws nothing", (await shapes()).length === 2);
    await bp.keyboard.press("Control+z"); await settle();
    check("Ctrl+Z takes the circle away", (await shapes()).length === 1);
    await bp.keyboard.press("Control+y"); await settle();
    check("and Ctrl+Y brings it back", (await shapes()).length === 2);
    await bp.keyboard.press("Control+z"); await settle();
    // Move: drag the rectangle by its body.
    await bp.getByRole("button", { name: /Select/ }).first().click().catch(() => {}); await bp.waitForTimeout(200);
    const rect0 = box((await shapes())[0]);
    await drag([350, 250], [450, 300]);
    let rect1 = box((await shapes())[0]);
    check("dragging a shape by its body moves all of it: 100 right and 50 down", near77(rect1.x0 - rect0.x0, 100) && near77(rect1.y0 - rect0.y0, 50) && near77(rect1.x1 - rect0.x1, 100) && near77(rect1.y1 - rect0.y1, 50), JSON.stringify([rect0, rect1]));
    await bp.keyboard.press("Control+z"); await settle();
    check("one Ctrl+Z puts it back", near77(box((await shapes())[0]).x0, rect0.x0) && near77(box((await shapes())[0]).y0, rect0.y0));
    const pick = async () => { const b = box((await shapes())[0]); const c = await toClient((b.x0 + b.x1) / 2, (b.y0 + b.y1) / 2); await bp.mouse.click(c.x, c.y); await settle(); };
    await pick();
    // Size.
    const sizeNow = async () => { const b = box((await shapes())[0]); return { w: b.x1 - b.x0, h: b.y1 - b.y0, cx: (b.x0 + b.x1) / 2, cy: (b.y0 + b.y1) / 2 }; };
    const size0 = await sizeNow();
    await bp.getByRole("button", { name: /^Larger/ }).click(); await settle();
    const size1 = await sizeNow();
    check("Larger makes the shape 10 % larger round its middle", near77(size1.w, size0.w * 1.1, 1) && near77(size1.h, size0.h * 1.1, 1) && near77(size1.cx, size0.cx, 1) && near77(size1.cy, size0.cy, 1), JSON.stringify([size0, size1]));
    await bp.getByRole("button", { name: /^Smaller/ }).click(); await bp.getByRole("button", { name: /^Smaller/ }).click(); await settle();
    const size2 = await sizeNow();
    check("Smaller twice makes it smaller than it was", size2.w < size0.w && near77(size2.w, size0.w * 1.1 / 1.21, 1), JSON.stringify(size2));
    for (let i = 0; i < 3; i += 1) { await bp.keyboard.press("Control+z"); await bp.waitForTimeout(250); }
    await settle();
    check("three Ctrl+Z take the three steps back", near77((await sizeNow()).w, size0.w, 0.5));
    await pick();
    // Lock: no plain drag, Shift+drag moves.
    await bp.getByRole("button", { name: /Lock geometry/ }).click(); await settle();
    const lockedAt = box((await shapes())[0]);
    check("with the geometry locked, Larger and Smaller are off", await bp.getByRole("button", { name: /^Larger/ }).isDisabled() && await bp.getByRole("button", { name: /^Smaller/ }).isDisabled());
    await drag([350, 250], [450, 300]);
    check("a locked shape stays where it is when dragged", near77(box((await shapes())[0]).x0, lockedAt.x0));
    await drag([350, 250], [410, 250], { shift: true });
    check("and moves when dragged with Shift held", near77(box((await shapes())[0]).x0 - lockedAt.x0, 60) && (await shapes())[0].locked === true, String(box((await shapes())[0]).x0 - lockedAt.x0));
    await bp.getByRole("button", { name: /Unlock geometry/ }).click(); await settle();
    // Undo with focus in the colour field and the slider.
    const setValue = (selector, value) => bp.locator(selector).first().evaluate((el, v) => { const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set; el.focus(); set.call(el, v); el.dispatchEvent(new Event("input", { bubbles: true })); el.dispatchEvent(new Event("change", { bubbles: true })); }, value);
    const fill0 = (await shapes())[0].fill;
    await setValue(".property-form input.colour-input", "#ff0000"); await settle();
    check("the colour is changed", (await shapes())[0].fill === "#ff0000");
    await bp.keyboard.press("Control+z"); await settle();
    check("Ctrl+Z with focus in the colour field undoes it", (await shapes())[0].fill === fill0, (await shapes())[0].fill);
    await pick();
    const opacity0 = (await shapes())[0].opacity;
    for (const v of ["0.5", "0.4", "0.3"]) await setValue(".property-form input[type=range]", v);
    await settle();
    check("the slider is moved", near77((await shapes())[0].opacity, 0.3, 0.001));
    await bp.keyboard.press("Control+z"); await settle();
    check("one Ctrl+Z with focus in the slider takes back the whole movement of it, not one step", near77((await shapes())[0].opacity, opacity0, 0.001), String((await shapes())[0].opacity));
    // Merging stops where it should: two shapes, an undo in between, a plain click (found in review).
    await enterDraw();
    await bp.locator(".background-tools select").selectOption({ label: "Rectangle" });
    await drag([700, 400], [900, 550]);
    await bp.getByRole("button", { name: /Select & move/ }).click(); await bp.waitForTimeout(250);
    const ids = (await shapes()).map((x) => x.id);
    const opacityOf = async (i) => (await shapes())[i].opacity;
    const baseA = await opacityOf(0), baseB = await opacityOf(1);
    await setValue(".property-form input[type=range]", "0.5");
    const pickAt = async (i) => { const b = box((await shapes())[i]); const c = await toClient((b.x0 + b.x1) / 2, (b.y0 + b.y1) / 2); await bp.mouse.click(c.x, c.y); await bp.waitForTimeout(250); };
    await pickAt(0);
    await setValue(".property-form input[type=range]", "0.5"); await settle();
    check("two shapes' sliders moved within a moment of each other are two changes", (await opacityOf(0)) === 0.5 && (await opacityOf(1)) === 0.5 && ids.length === 2);
    await bp.keyboard.press("Control+z"); await settle();
    check("one Ctrl+Z takes back only the second shape's", (await opacityOf(0)) === baseA && (await opacityOf(1)) === 0.5, JSON.stringify([await opacityOf(0), await opacityOf(1)]));
    await bp.keyboard.press("Control+z"); await settle();
    check("and the next the first's", (await opacityOf(1)) === baseB);
    await pickAt(1);
    await setValue(".property-form input[type=range]", "0.4");
    await bp.keyboard.press("Control+z"); await bp.waitForTimeout(150);
    await pickAt(1);
    await setValue(".property-form input[type=range]", "0.3");
    await bp.keyboard.press("Control+z"); await settle();
    check("a slider moved again right after an Undo is a step of its own: Ctrl+Z goes back to where Undo left it, not through it", (await opacityOf(1)) === baseB, String(await opacityOf(1)));
    await bp.keyboard.press("Control+y"); await settle();
    check("and Ctrl+Y brings the movement back", near77(await opacityOf(1), 0.3, 0.001), String(await opacityOf(1)));
    await bp.keyboard.press("Control+z"); await settle();
    await pickAt(1);
    await setValue(".property-form input[type=range]", "0.45"); await settle();
    await pickAt(1); await pickAt(1);
    await bp.keyboard.press("Control+z"); await settle();
    check("clicking a shape without moving it adds no step of Undo", (await opacityOf(1)) === baseB, String(await opacityOf(1)));
    // A shape cannot be dragged off the board where nothing could reach it.
    await pickAt(0);
    const farLeft = await toClient(-420, 250), mid = await toClient(...[(box((await shapes())[0]).x0 + box((await shapes())[0]).x1) / 2, 250]);
    await bp.mouse.move(mid.x, mid.y); await bp.mouse.down(); await bp.mouse.move(farLeft.x, farLeft.y, { steps: 8 }); await bp.mouse.up(); await settle();
    check("dragged far off the board, a shape keeps a corner of itself on it, as a background image does", box((await shapes())[0]).x1 >= 29, JSON.stringify(box((await shapes())[0])));
    // A line and a label can be moved as well; a label has no size.
    await enterDraw();
    await bp.locator(".background-tools select").selectOption({ label: "Label" });
    await bp.mouse.click((await toClient(700, 600)).x, (await toClient(700, 600)).y); await settle();
    const labelAt = (await shapes()).at(-1);
    check("a label is made and its form shown, and it has no Larger or Smaller", labelAt.type === "label" && (await bp.getByText("Text colour").count()) === 1 && (await bp.getByRole("button", { name: /^Larger/ }).count()) === 0, JSON.stringify(labelAt && labelAt.type));
    await bp.getByRole("button", { name: /Select & move/ }).click(); await bp.waitForTimeout(250);
    const labelPoint = (await shapes()).at(-1).points[0];
    const labelScreen = await toClient(labelPoint.x + 30, labelPoint.y - 17);
    await bp.mouse.move(labelScreen.x, labelScreen.y); await bp.mouse.down(); await bp.mouse.move(labelScreen.x + 60, labelScreen.y + 30, { steps: 5 }); await bp.mouse.up(); await settle();
    const movedLabel = (await shapes()).at(-1).points[0];
    check("a label is dragged by its text", movedLabel.x - labelPoint.x > 20 && movedLabel.y - labelPoint.y > 5, JSON.stringify([labelPoint, movedLabel]));
    await bp.context().close();
  }

  // 78. Drawing a background area or line (found by the owner on 2026-10-14 and 2026-10-15): every click is saved in the map at once, so Ctrl+Z takes back the last point; the points can be moved while the
  // shape is being drawn; a point that is clicked is the marked one and the next point goes beside it, on the side of the neighbour the click is nearer; a double click on a point takes it away;
  // Shift and drag moves a shape in this tool as well; the tool stays for the next shape, and Escape goes back to the arrow, keeping what has enough points.
  if (wants(78)) {
  sectionStart(78);
    const dp78 = await (await browser.newContext({ viewport: { width: 1500, height: 1000 } })).newPage();
    dp78.on("pageerror", (e) => errors.push(String(e)));
    await dp78.goto(BASE, { waitUntil: "networkidle" });
    await dp78.getByRole("button", { name: "Start with a blank map" }).click(); await dp78.waitForTimeout(500);
    if (await dp78.locator('[role="dialog"]').count()) { await dp78.keyboard.press("Escape"); await dp78.waitForTimeout(400); }
    const shapes78 = () => dp78.evaluate(() => JSON.parse(localStorage.getItem("ttr-map")).background);
    const settle78 = () => dp78.waitForTimeout(350);
    const toClient78 = (x, y) => dp78.evaluate(([x, y]) => { const svg = document.querySelector(".map-canvas"); const pt = svg.createSVGPoint(); pt.x = x; pt.y = y; const m = pt.matrixTransform(svg.getScreenCTM()); return { x: m.x, y: m.y }; }, [x, y]);
    const click78 = async (x, y) => { const c = await toClient78(x, y); await dp78.mouse.click(c.x, c.y); await settle78(); };
    const drag78 = async (from, to, shift = false) => { const a = await toClient78(...from), b = await toClient78(...to); if (shift) await dp78.keyboard.down("Shift"); await dp78.mouse.move(a.x, a.y); await dp78.mouse.down(); await dp78.mouse.move(b.x, b.y, { steps: 6 }); await dp78.mouse.up(); if (shift) await dp78.keyboard.up("Shift"); await settle78(); };
    const inDraw = async () => (await dp78.locator(".background-tools").count()) === 1;
    const openDraw = async (label = "Area") => { if (!(await inDraw())) { await dp78.getByRole("button", { name: /Draw background/ }).click(); await dp78.waitForTimeout(200); } await dp78.locator(".background-tools select").selectOption({ label }); };
    const ptsOf = async (id) => (await shapes78()).find((x) => x.id === id).points;
    await openDraw("Area");
    await click78(200, 200);
    let list = await shapes78();
    check("the first click of an area is saved in the map at once, as a shape of one point", list.length === 1 && list[0].points.length === 1 && list[0].type === "area", JSON.stringify(list.map((x) => x.points.length)));
    await click78(400, 200); await click78(300, 350);
    list = await shapes78();
    check("each click adds a point to it: three clicks, three points, one shape", list.length === 1 && list[0].points.length === 3, JSON.stringify(list.map((x) => x.points.length)));
    await dp78.keyboard.press("Control+z"); await settle78();
    check("Ctrl+Z while drawing takes back the last point, and the drawing goes on", (await shapes78())[0].points.length === 2);
    await click78(350, 400);
    check("the next click goes on with the same shape", (await shapes78()).length === 1 && (await shapes78())[0].points.length === 3);
    for (let i = 0; i < 3; i += 1) { await dp78.keyboard.press("Control+z"); await settle78(); }
    check("three more Ctrl+Z take the shape away altogether", (await shapes78()).length === 0);
    for (let i = 0; i < 3; i += 1) { await dp78.keyboard.press("Control+y"); await settle78(); }
    check("and three Ctrl+Y bring its three points back", (await shapes78()).length === 1 && (await shapes78())[0].points.length === 3);
    const id1 = (await shapes78())[0].id;
    const first = (await ptsOf(id1))[0];
    await drag78([first.x, first.y], [first.x - 60, first.y + 40]);
    check("a point can be dragged while the shape is still being drawn, and no new point is made by it", (await ptsOf(id1)).length === 3 && Math.abs((await ptsOf(id1))[0].x - (first.x - 60)) < 3, JSON.stringify((await ptsOf(id1))[0]));
    await dp78.keyboard.press("Control+z"); await settle78();
    check("Ctrl+Z puts the point back where it was", Math.abs((await ptsOf(id1))[0].x - first.x) < 3);
    await click78(300, 450);
    let pts = await ptsOf(id1);
    check("a click goes on adding at the end while no point has been picked", pts.length === 4 && Math.abs(pts[3].x - 300) < 3);
    const handle = async (n) => { const p = (await ptsOf(id1))[n]; return [p.x, p.y]; };
    await click78(...(await handle(1)));
    check("a click on a point marks it, and adds no point", (await dp78.locator(".background-point.active").count()) === 1 && (await ptsOf(id1)).length === 4);
    // Points now: P0 (200,200)  P1 (400,200)  P2 (300,350)  P3 (300,450). P1 is marked; a click nearer P2 than P0 goes between P1 and P2.
    await click78(430, 330);
    pts = await ptsOf(id1);
    check("a click nearer the next neighbour goes between the marked point and it", pts.length === 5 && Math.abs(pts[2].x - 430) < 3 && Math.abs(pts[2].y - 330) < 3 && Math.abs(pts[1].x - 400) < 3, JSON.stringify(pts.map((q) => [Math.round(q.x), Math.round(q.y)])));
    // The new point (index 2) is marked now. A click nearer P1 (before it) goes between P1 and it.
    await click78(415, 215);
    pts = await ptsOf(id1);
    check("and a click nearer the neighbour before it goes between that one and the marked point", pts.length === 6 && Math.abs(pts[2].x - 415) < 3 && Math.abs(pts[3].x - 430) < 3, JSON.stringify(pts.map((q) => [Math.round(q.x), Math.round(q.y)])));
    const before = (await ptsOf(id1)).length;
    const dc = await toClient78(...(await handle(2)));
    await dp78.mouse.dblclick(dc.x, dc.y); await settle78();
    check("a double click on a point takes it away", (await ptsOf(id1)).length === before - 1);
    await dp78.keyboard.press("Control+z"); await settle78();
    check("and Ctrl+Z gives it back", (await ptsOf(id1)).length === before);
    const p0 = (await ptsOf(id1))[0];
    await drag78([310, 300], [360, 330], true);
    check("Shift and drag moves the shape that is being drawn, by its body", Math.abs((await ptsOf(id1))[0].x - p0.x - 50) < 3 && Math.abs((await ptsOf(id1))[0].y - p0.y - 30) < 3, JSON.stringify([p0, (await ptsOf(id1))[0]]));
    await dp78.keyboard.press("Control+z"); await settle78();
    await dp78.getByRole("button", { name: "Finish shape" }).click(); await settle78();
    check("Finish shape ends the shape, the tool stays", await inDraw() && (await shapes78()).length === 1);
    await click78(700, 200); await click78(850, 220); await click78(780, 330);
    list = await shapes78();
    check("the next click starts a new shape without choosing Area again", list.length === 2 && list[1].points.length === 3 && list[0].points.length === 6, JSON.stringify(list.map((x) => x.points.length)));
    const q0 = (await ptsOf(id1))[0];
    await drag78([300, 300], [340, 300], true);
    check("Shift and drag moves a finished shape in Draw background too", Math.abs((await ptsOf(id1))[0].x - q0.x - 40) < 3 && (await shapes78()).length === 2);
    await dp78.getByRole("button", { name: "Finish shape" }).click().catch(() => {}); await settle78();
    // Nothing is being edited now: a click on an existing shape starts editing it, with the outline and the points drawn larger.
    const poly = await ptsOf(id1);
    const id2 = (await shapes78())[1].id;
    const centre78 = { x: poly.reduce((t, v) => t + v.x, 0) / poly.length, y: poly.reduce((t, v) => t + v.y, 0) / poly.length };
    const insideOf = (q, pg) => { let inn = false; for (let k = 0, m = pg.length - 1; k < pg.length; m = k, k += 1) { if ((pg[k].y > q.y) !== (pg[m].y > q.y) && q.x < (pg[m].x - pg[k].x) * (q.y - pg[k].y) / (pg[m].y - pg[k].y) + pg[k].x) inn = !inn; } return inn; };
    let inner = null;
    for (let gx = 150; gx < 700 && !inner; gx += 10) for (let gy = 150; gy < 500 && !inner; gy += 10) if (insideOf({ x: gx, y: gy }, poly) && !insideOf({ x: gx, y: gy }, await ptsOf(id2)) && poly.every((v) => Math.hypot(v.x - gx, v.y - gy) > 45) && Math.hypot(centre78.x - gx, centre78.y - gy) > 45) inner = { x: gx, y: gy };
    check("a point inside the first shape is found, to click on", Boolean(inner));
    check("with nothing being edited no shape is drawn larger", (await dp78.locator(".background-object.editing").count()) === 0);
    await click78(inner.x, inner.y);
    check("in Draw background a click on an existing shape starts editing it, and makes no new shape", (await dp78.locator(".background-object.editing").count()) === 1 && (await shapes78()).length === 2);
    const dotR = () => dp78.evaluate(() => Number(document.querySelector(".background-object.selected .background-point > circle:last-child").getAttribute("r")));
    const bigDot = await dotR();
    const bigOutline = await dp78.locator(".background-object.editing .edit-outline").count();
    await dp78.keyboard.press("Escape"); await settle78();
    check("Escape ends the editing of that shape and the tool stays", (await dp78.locator(".background-object.editing").count()) === 0 && await inDraw());
    check("and the shape is drawn as it is, its points and outline no longer larger: a visible sign that the editing is over", (await dotR()) < bigDot && bigOutline === 1 && (await dp78.locator(".edit-outline").count()) === 0, `${bigDot} then ${await dotR()}`);
    // Alt and a click starts a new shape on top of an old one.
    const countBefore = (await shapes78()).length;
    await dp78.keyboard.down("Alt"); await click78(inner.x, inner.y); await dp78.keyboard.up("Alt");
    check("Alt and a click starts a new shape even on top of an old one", (await shapes78()).length === countBefore + 1 && (await dp78.locator(".background-object.editing").count()) === 1);
    await dp78.keyboard.press("Escape"); await settle78();
    check("a shape of one point is dropped when its editing ends", (await shapes78()).length === countBefore && await inDraw());
    // Escape while drawing ends the editing; Escape with nothing being edited goes back to the arrow.
    await click78(100, 500); await click78(200, 520); await click78(150, 600);
    await dp78.keyboard.press("Escape"); await settle78();
    list = await shapes78();
    check("Escape while an area is being drawn ends the editing of it: it is kept, and the tool stays", await inDraw() && list.length === 3 && list[2].points.length === 3, JSON.stringify(list.map((x) => x.points.length)));
    await dp78.keyboard.press("Escape"); await settle78();
    check("Escape with no shape being edited goes back to Select & move", !(await inDraw()));
    await openDraw("Area");
    await click78(900, 500); await click78(1000, 520);
    await dp78.keyboard.press("Escape"); await settle78();
    check("an area of two points is dropped when its editing ends: an area needs three", (await shapes78()).length === 3 && await inDraw());
    await dp78.keyboard.press("Escape"); await settle78();
    await openDraw("Line");
    await click78(900, 500); await click78(1000, 520);
    await dp78.keyboard.press("Escape"); await settle78();
    check("a line of two points is kept", (await shapes78()).length === 4 && (await shapes78())[3].type === "line" && await inDraw());
    await dp78.keyboard.press("Escape"); await settle78();
    await openDraw("Area");
    await click78(100, 650); await click78(250, 650); await click78(180, 700);
    await dp78.getByRole("button", { name: /Select & move/ }).click(); await settle78();
    check("choosing the arrow keeps the shape and selects it", (await shapes78()).length === 5 && (await dp78.locator(".property-form #background-label").count()) === 1);
    const area = (await shapes78())[4]; const vertex = area.points[0];
    await drag78([vertex.x, vertex.y], [vertex.x + 50, vertex.y + 30]);
    check("a point of a finished area is dragged", Math.abs((await ptsOf(area.id))[0].x - (vertex.x + 50)) < 3);
    await dp78.keyboard.press("Control+z"); await settle78();
    check("and Ctrl+Z puts it back", Math.abs((await ptsOf(area.id))[0].x - vertex.x) < 3);
    await openDraw("Rectangle");
    const n0 = (await shapes78()).length;
    await drag78([700, 450], [900, 600]);
    check("a rectangle is made, and the tool stays for the next", (await shapes78()).length === n0 + 1 && await inDraw());
    const a0 = await toClient78(100, 450), b0 = await toClient78(400, 650);
    await dp78.mouse.move(a0.x, a0.y); await dp78.mouse.down(); await dp78.mouse.move(b0.x, b0.y, { steps: 6 }); await dp78.keyboard.press("Escape"); await dp78.mouse.up(); await settle78();
    check("Escape while a rectangle is being dragged out makes none (and the tool stays)", (await shapes78()).length === n0 + 1 && await inDraw());
    await dp78.keyboard.press("Escape"); await settle78();
    check("a second Escape goes back to the arrow", !(await inDraw()));
    await dp78.context().close();
  }

  // 79. The welcome box can open a map file of one's own (found by the owner on 2026-10-15), beside the example, the map with problems and the blank map.
  if (wants(79)) {
  sectionStart(79);
    const wp = await (await browser.newContext({ viewport: { width: 1500, height: 1000 } })).newPage();
    wp.on("pageerror", (e) => errors.push(String(e)));
    await wp.goto(BASE, { waitUntil: "networkidle" });
    check("the welcome box has a button to open a map file of one's own", await wp.getByRole("button", { name: "Open a map file" }).isVisible());
    const own = path.join(os.tmpdir(), `ttr-own-${Date.now()}.json`);
    fs.writeFileSync(own, JSON.stringify({ format: "ticket-to-ride-map", version: 4, kind: "map", payload: { name: "Opened from the welcome box", format: "board-2x3", stops: [{ id: "a", name: "Alpha", type: "city", x: 200, y: 200 }, { id: "b", name: "Beta", type: "city", x: 600, y: 300 }], routes: [{ id: "r1", a: "a", b: "b", length: 3, type: "city", color: "red" }] } }));
    const chooser = wp.waitForEvent("filechooser");
    await wp.getByRole("button", { name: "Open a map file" }).click();
    await (await chooser).setFiles(own);
    await wp.waitForTimeout(800);
    const opened = await wp.evaluate(() => { const m = JSON.parse(localStorage.getItem("ttr-map") || "null"); return m && { name: m.name, stops: m.stops.length, routes: m.routes.length }; });
    check("choosing a file opens it as the map", opened && opened.name === "Opened from the welcome box" && opened.stops === 2 && opened.routes === 1, JSON.stringify(opened));
    check("and the welcome box is gone, and does not come back after a reload", (await wp.getByRole("button", { name: "Open a map file" }).count()) === 0 && (await (async () => { await wp.reload({ waitUntil: "networkidle" }); await wp.waitForTimeout(500); return wp.getByRole("button", { name: "Open a map file" }).count(); })()) === 0);
    fs.unlinkSync(own);
    // Cancelling the file box leaves the welcome box where it was.
    const wp2 = await (await browser.newContext({ viewport: { width: 1500, height: 1000 } })).newPage();
    await wp2.goto(BASE, { waitUntil: "networkidle" });
    const chooser2 = wp2.waitForEvent("filechooser");
    await wp2.getByRole("button", { name: "Open a map file" }).click();
    await chooser2;
    check("opening the file box does not close the welcome box until a file is chosen", await wp2.getByRole("button", { name: "Load the example map" }).isVisible());
    await wp.context().close(); await wp2.context().close();
  }

  // 80. The Delete key takes away what is selected (found by the owner on 2026-10-15): a shape, a stop, a route, a note; Backspace too, which is the Delete key of a Mac.
  if (wants(80)) {
  sectionStart(80);
    const kp = await (await browser.newContext({ viewport: { width: 1500, height: 1000 } })).newPage();
    kp.on("pageerror", (e) => errors.push(String(e)));
    await kp.goto(BASE, { waitUntil: "networkidle" });
    await kp.getByRole("button", { name: "Load the example map" }).click(); await kp.waitForTimeout(700);
    const counts = () => kp.evaluate(() => { const m = JSON.parse(localStorage.getItem("ttr-map")); return { stops: m.stops.length, routes: m.routes.length, background: m.background.length, notes: m.notes.length }; });
    const settleK = () => kp.waitForTimeout(350);
    const start = await counts();
    // A stop.
    const stopBox = await kp.locator("g.stop").first().boundingBox();
    await kp.mouse.click(stopBox.x + stopBox.width / 2, stopBox.y + stopBox.height / 2); await settleK();
    await kp.keyboard.press("Delete"); await settleK();
    check("Delete takes away the stop that is selected, and the routes that ended at it", (await counts()).stops === start.stops - 1 && (await counts()).routes < start.routes);
    await kp.keyboard.press("Control+z"); await settleK();
    check("and Ctrl+Z gives it all back", JSON.stringify(await counts()) === JSON.stringify(start));
    // A route.
    await kp.keyboard.press("Escape"); await settleK();
    const hit = await kp.locator(".route-hit").first().boundingBox();
    await kp.locator(".route-hit").first().click({ force: true, position: { x: hit.width / 2, y: hit.height / 2 } }); await settleK();
    await kp.keyboard.press("Delete"); await settleK();
    check("Delete takes away the route that is selected", (await counts()).routes === start.routes - 1 && (await counts()).stops === start.stops);
    await kp.keyboard.press("Control+z"); await settleK();
    // A background shape, with Backspace.
    const shape = await kp.locator(".background-object").first().boundingBox();
    await kp.mouse.click(shape.x + shape.width / 2, shape.y + shape.height / 2); await settleK();
    const hadSelection = (await kp.locator(".property-form #background-label").count()) === 1;
    if (hadSelection) { await kp.keyboard.press("Backspace"); await settleK(); }
    check("Backspace, the Delete key of a Mac, takes away the shape that is selected", hadSelection && (await counts()).background === start.background - 1, JSON.stringify(await counts()));
    await kp.keyboard.press("Control+z"); await settleK();
    check("and it comes back with Ctrl+Z", (await counts()).background === start.background);
    // Nothing is taken away while a field takes text.
    await kp.mouse.click(shape.x + shape.width / 2, shape.y + shape.height / 2); await settleK();
    await kp.locator("#background-label").focus();
    await kp.keyboard.press("Backspace"); await settleK();
    check("with the cursor in a text field Delete and Backspace edit the text, and take nothing away", (await counts()).background === start.background);
    await kp.context().close();
  }

  // 81. What the review of 1.7.0 found (2026-10-15): ending or cancelling the editing of a shape that was already there never deletes it; a label or a locked shape is not edited by clicks;
  // leaving Draw background by any way ends the drawing; the Delete key leaves a ticket row alone.
  if (wants(81)) {
  sectionStart(81);
    const rp = await (await browser.newContext({ viewport: { width: 1500, height: 1000 } })).newPage();
    rp.on("pageerror", (e) => errors.push(String(e)));
    await rp.goto(BASE, { waitUntil: "networkidle" });
    await rp.getByRole("button", { name: "Load the example map" }).click(); await rp.waitForTimeout(700);
    const store = () => rp.evaluate(() => JSON.parse(localStorage.getItem("ttr-map")));
    const settleR = () => rp.waitForTimeout(350);
    const toClientR = (x, y) => rp.evaluate(([x, y]) => { const svg = document.querySelector(".map-canvas"); const pt = svg.createSVGPoint(); pt.x = x; pt.y = y; const m = pt.matrixTransform(svg.getScreenCTM()); return { x: m.x, y: m.y }; }, [x, y]);
    const clickR = async (x, y) => { const c = await toClientR(x, y); await rp.mouse.click(c.x, c.y); await settleR(); };
    // A place on the board where nothing is: the background of the board is what is under the pointer.
    const emptySpots = async (n) => { const found = []; for (let gy = 700; gy > 40 && found.length < n; gy -= 25) for (let gx = 40; gx < 1060 && found.length < n; gx += 40) { const c = await toClientR(gx, gy); const top = await rp.evaluate(([x, y]) => { const e = document.elementsFromPoint(x, y)[0]; return e ? e.tagName + "." + (e.getAttribute("class") || "") : ""; }, [c.x, c.y]); if (top === "rect.map-bg" && found.every((f) => Math.hypot(f.x - gx, f.y - gy) > 120)) found.push({ x: gx, y: gy }); } return found; };
    const inDrawR = async () => (await rp.locator(".background-tools").count()) === 1;
    const openDrawR = async (label) => { if (!(await inDrawR())) { await rp.getByRole("button", { name: /Draw background/ }).click(); await rp.waitForTimeout(200); } await rp.locator(".background-tools select").selectOption({ label }); };
    // A label that was made, then clicked in Draw background, then Escape: it is still there.
    await openDrawR("Label");
    await clickR(560, 690);
    const labels0 = (await store()).background.filter((x) => x.type === "label").length;
    const labelAt81 = (await store()).background.filter((x) => x.type === "label").at(-1).points[0];
    const labelScreen81 = await toClientR(labelAt81.x + 30, labelAt81.y - 17);
    await rp.mouse.click(labelScreen81.x, labelScreen81.y); await settleR();
    await rp.keyboard.press("Escape"); await settleR();
    check("a label that is clicked in Draw background and left with Escape is still there", (await store()).background.filter((x) => x.type === "label").length === labels0 && labels0 >= 1);
    await rp.keyboard.press("Escape"); await settleR();
    check("and a second Escape leaves the tool", !(await inDrawR()));
    // An existing area, edited and then Cancel: it stays (Cancel only lets go of a shape that was just drawn).
    await openDrawR("Area");
    const areas = (await store()).background.filter((x) => x.type === "area");
    const target = areas[0];
    const cx = target.points.reduce((t, v) => t + v.x, 0) / target.points.length, cy = target.points.reduce((t, v) => t + v.y, 0) / target.points.length;
    const before = (await store()).background.length;
    await clickR(cx + 30, cy + 30);
    const cancel = rp.getByRole("button", { name: "Cancel" });
    if (await cancel.isEnabled().catch(() => false)) { await cancel.click(); await settleR(); }
    await rp.keyboard.press("Escape"); await settleR();
    check("an area that was there is not deleted by Cancel or by ending its editing", (await store()).background.length === before, `${before} → ${(await store()).background.length}`);
    // A locked area takes no point from a click.
    await rp.keyboard.press("Escape"); await settleR();
    await rp.evaluate(() => { const m = JSON.parse(localStorage.getItem("ttr-map")); m.background[0].locked = true; localStorage.setItem("ttr-map", JSON.stringify(m)); });
    await rp.reload({ waitUntil: "networkidle" }); await rp.waitForTimeout(700);
    await openDrawR("Area");
    const lockedPts = (await store()).background[0].points.length;
    const lockedShape = (await store()).background[0];
    const lcx = lockedShape.points.reduce((t, v) => t + v.x, 0) / lockedShape.points.length, lcy = lockedShape.points.reduce((t, v) => t + v.y, 0) / lockedShape.points.length;
    await clickR(lcx + 25, lcy + 25); await clickR(50, 700);
    check("clicks do not put points into an area whose geometry is locked", (await store()).background[0].points.length === lockedPts, `${lockedPts} → ${(await store()).background[0].points.length}`);
    await rp.keyboard.press("Escape"); await settleR(); await rp.keyboard.press("Escape"); await settleR();
    // Leaving the tool by a click on a route ends the drawing.
    await openDrawR("Area");
    const spots = await emptySpots(3);
    check("empty places on the board are found", spots.length === 3);
    await clickR(spots[0].x, spots[0].y); await clickR(spots[1].x, spots[1].y);
    const n1 = (await store()).background.length;
    const route = await rp.locator(".route-hit").first().boundingBox();
    await rp.locator(".route-hit").first().click({ force: true, position: { x: route.width / 2, y: route.height / 2 } }); await settleR();
    check("a click on a route leaves Draw background and ends the drawing: an area of two points is dropped", !(await inDrawR()) && (await store()).background.length === n1 - 1, `${n1} → ${(await store()).background.length}`);
    await openDrawR("Area");
    await clickR(spots[2].x, spots[2].y);
    check("coming back, nothing is being edited: the first click makes a new shape", (await store()).background.length === n1 && (await rp.locator(".background-object.editing").count()) === 1, `${(await store()).background.length} vs ${n1}, editing ${await rp.locator(".background-object.editing").count()}`);
    await rp.keyboard.press("Escape"); await settleR(); await rp.keyboard.press("Escape"); await settleR();
    // The Delete key leaves a ticket row alone: a stop is selected, a ticket opened from it, its row has the focus.
    const stopBox = await rp.locator("g.stop").first().boundingBox();
    await rp.mouse.click(stopBox.x + stopBox.width / 2, stopBox.y + stopBox.height / 2); await settleR();
    const stops0 = (await store()).stops.length;
    const row = rp.locator(".property-form button, .property-form [role=button]").filter({ hasText: /→|—|to/ }).first();
    const hasTicketLink = (await row.count()) > 0;
    if (hasTicketLink) { await row.click().catch(() => {}); await settleR(); }
    const ticketRow = rp.locator("tr[role=button]").first();
    if (await ticketRow.count()) { await ticketRow.focus(); await rp.keyboard.press("Delete"); await settleR(); }
    check("Delete with a ticket row in focus takes no stop away", (await store()).stops.length === stops0, `${stops0} → ${(await store()).stops.length}`);
    await rp.context().close();
  }

  // 82. What the user test of 1.7.0 found: each group of fixes adds its checks here.
  if (wants(82)) {
  sectionStart(82);
    const up = await (await browser.newContext({ viewport: { width: 1500, height: 1000 } })).newPage();
    up.on("pageerror", (e) => errors.push(String(e)));
    await up.goto(BASE, { waitUntil: "networkidle" });
    const settleU = () => up.waitForTimeout(400);
    // Group 1: figures and claims.
    await up.getByRole("button", { name: "Load a map with problems" }).click(); await settleU();
    await up.getByRole("button", { name: "Tickets", exact: true }).click(); await settleU();
    await up.locator("#ticket-set").selectOption({ label: /Long journeys/ }).catch(async () => { const opts = await up.locator("#ticket-set option").allTextContents(); const k = opts.findIndex((t) => /Long journeys/.test(t)); await up.locator("#ticket-set").selectOption({ index: k }); });
    await settleU();
    const cmpU = up.locator(".tickets-panel .deck-compare");
    check("Compare decks counts the ticket worth 22 on a path of 19 under Points off the path rule (it said 0)", (await cmpU.locator('tr[data-row="off-path"] .cmp-a').getAttribute("data-value")) === "1", await cmpU.locator('tr[data-row="off-path"]').textContent());
    check("the row about almost-equal tickets is named for what it counts: Near-duplicate pairs", /Near-duplicate pairs/.test(await cmpU.textContent()) && !/Duplicate pairs/.test((await cmpU.textContent()).replace(/Near-duplicate pairs/g, "")));
    await up.getByRole("button", { name: "Done" }).click().catch(() => {}); await settleU();
    // The deck dialog counts the tickets the deck has.
    await up.getByRole("button", { name: "Tickets", exact: true }).click(); await settleU();
    await up.getByRole("button", { name: /Add a deck/ }).click(); await up.waitForTimeout(250);
    await up.getByRole("menuitem", { name: /Build a full deck of tickets/ }).click(); await up.waitForSelector(".suggest-dialog", { timeout: 20000 }); await settleU();
    const nowCol = async (label) => ((await up.locator(".suggest-table tr", { hasText: label }).first().locator("td").nth(1).textContent()) || "").trim();
    const deckSize = await up.evaluate(() => { const m = JSON.parse(localStorage.getItem("ttr-map")); const first = m.ticketSets[0].id; const active = document.querySelector("#ticket-set") ? document.querySelector("#ticket-set").value : first; return m.tickets.filter((t) => (t.set ?? first) === active).length; });
    check("the deck dialog's Now column counts all the tickets of the deck, not only those a player could build", (await nowCol("Tickets")) === String(deckSize), `${await nowCol("Tickets")} against ${deckSize}`);
    check("and says how many it leaves out of the other figures", /left out of the figures under Now/.test(await up.locator(".suggest-dialog").textContent()));
    await up.keyboard.press("Escape"); await settleU();
    await up.getByRole("button", { name: "Done" }).click().catch(() => {}); await settleU();
    // Crowded routes: what it means.
    await up.getByRole("button", { name: "Map balance", exact: true }).click(); await settleU();
    const bal = (await up.locator(".balance-panel").textContent()) || "";
    check("Map balance says what a crowded route is: among the busiest tenth with three tickets, or at twice the average", /busiest tenth/.test(bal) && !/can carry/.test(bal), bal.slice(0, 200));
    await up.keyboard.press("Escape"); await settleU();
    // The last export belongs to a map: a new empty map has none.
    await up.evaluate(() => { const key = "ttr-export-reminder"; const r = JSON.parse(localStorage.getItem(key) || "{}"); localStorage.setItem(key, JSON.stringify({ changes: 0, nextAt: 50, level: 0, off: false, ...r, lastExport: new Date(Date.now() - 4 * 60000).toISOString() })); });
    await up.reload({ waitUntil: "networkidle" }); await settleU();
    if (await up.locator('[role="dialog"]').count()) { await up.getByRole("button", { name: "Load a map with problems" }).click(); await settleU(); }
    const exportedText = async () => ((await up.locator(".save-state, .saved-state, header").first().textContent()) || "") + " " + ((await up.locator("body").textContent()) || "").match(/(not exported yet|exported [^·]*ago|exported just now)/)?.[0];
    check("before: the saved map shows an export of 4 minutes ago", /exported 4 minutes ago/.test(await exportedText()), await exportedText());
    await up.getByRole("button", { name: "Settings" }).click(); await settleU();
    await up.getByRole("button", { name: /Start over/ }).first().click(); await settleU();
    check("starting over from an unchanged example asks nothing", (await up.locator('[role="alertdialog"]').count()) === 0);
    await up.keyboard.press("Escape"); await settleU();
    check("and the new empty map is not exported yet, whatever the last map's export was", /not exported yet/.test(await exportedText()), await exportedText());
    // A board that turns the map moves the names on routes clear of them.
    await up.getByRole("button", { name: "Settings" }).click().catch(() => {}); await settleU();
    await up.context().close();
    const up2 = await (await browser.newContext({ viewport: { width: 1500, height: 1000 } })).newPage();
    up2.on("pageerror", (e) => errors.push(String(e)));
    await up2.goto(BASE, { waitUntil: "networkidle" });
    await up2.getByRole("button", { name: "Load the example map" }).click(); await up2.waitForTimeout(500);
    await up2.getByRole("button", { name: "Settings" }).click(); await up2.waitForTimeout(400);
    await up2.locator('#settings-format input[value="small-new-york"]').check(); await up2.waitForTimeout(600);
    await up2.keyboard.press("Escape"); await up2.waitForTimeout(400);
    check("choosing New York, which stands the board up, leaves no stop name on a route", (await up2.getByText(/stop names? on a route/).count()) === 0, String(await up2.getByText(/stop names? on a route/).count()));
    // Opening a map file: asked first when the map on the screen is the person's own, not when it is an unchanged example.
    const fileU = path.join(os.tmpdir(), `ttr-own82-${Date.now()}.json`);
    fs.writeFileSync(fileU, JSON.stringify({ format: "ticket-to-ride-map", version: 4, kind: "map", payload: { name: "From a file", format: "board-2x3", stops: [{ id: "a", name: "Alpha", type: "city", x: 200, y: 200 }, { id: "b", name: "Beta", type: "city", x: 600, y: 300 }], routes: [{ id: "r1", a: "a", b: "b", length: 3, type: "city", color: "red" }] } }));
    // A fresh page with the example map as it came.
    const up3 = await (await browser.newContext({ viewport: { width: 1500, height: 1000 } })).newPage();
    up3.on("pageerror", (e) => errors.push(String(e)));
    await up3.goto(BASE, { waitUntil: "networkidle" });
    await up3.getByRole("button", { name: "Load the example map" }).click(); await up3.waitForTimeout(500);
    const storedName = () => up3.evaluate(() => JSON.parse(localStorage.getItem("ttr-map")).name);
    await up3.locator('input[type="file"][accept="application/json"]').setInputFiles(fileU); await up3.waitForTimeout(700);
    check("the example map, unchanged, is replaced by a file without a question", (await up3.locator('[role="alertdialog"]').count()) === 0 && (await storedName()) === "From a file", await storedName());
    await up3.locator('input[type="file"][accept="application/json"]').setInputFiles(fileU); await up3.waitForTimeout(700);
    check("a map of one's own is asked about first: Replace the current map with the one in the file?", /Replace the current map with the one in the file/.test((await up3.locator('[role="alertdialog"]').textContent().catch(() => "")) || ""));
    await up3.getByRole("button", { name: "Cancel" }).click(); await up3.waitForTimeout(300);
    check("Cancel leaves it as it was", (await storedName()) === "From a file" && (await up3.locator('[role="alertdialog"]').count()) === 0);
    await up3.context().close();
    // Review of the branch: a map with no stops, routes or shapes but changed settings is still the person's own work.
    const up4 = await (await browser.newContext({ viewport: { width: 1500, height: 1000 } })).newPage();
    up4.on("pageerror", (e) => errors.push(String(e)));
    await up4.goto(BASE, { waitUntil: "networkidle" });
    await up4.getByRole("button", { name: "Start with a blank map" }).click(); await up4.waitForTimeout(500);
    if (await up4.locator('[role="dialog"]').count()) { await up4.keyboard.press("Escape"); await up4.waitForTimeout(300); }
    await up4.getByRole("button", { name: "Settings" }).click(); await up4.waitForTimeout(400);
    await up4.locator('#settings-format input[value="small-new-york"]').check(); await up4.waitForTimeout(500);
    await up4.locator(".settings-nav-item", { hasText: /^Map/ }).click(); await up4.waitForTimeout(300);
    await up4.getByRole("button", { name: "Start over…" }).click(); await up4.waitForTimeout(400);
    check("a blank map with a board chosen, but no stops or routes, is asked about before Start over", (await up4.locator('[role="alertdialog"]').count()) === 1);
    await up4.context().close();
    // The far column opens a dialog that says far, not long (long is the long deck's word); the deck rules measure the cap in wagons.
    const up5 = await (await browser.newContext({ viewport: { width: 1500, height: 1000 } })).newPage();
    up5.on("pageerror", (e) => errors.push(String(e)));
    await up5.goto(BASE, { waitUntil: "networkidle" });
    await up5.getByRole("button", { name: "Load the example map" }).click(); await up5.waitForTimeout(500);
    await up5.getByRole("button", { name: "Add ticket" }).click(); await up5.waitForTimeout(400);
    const farCount = up5.locator(".coverage-table tbody tr td:nth-child(4) .coverage-count").first();
    await farCount.click(); await up5.waitForTimeout(450);
    const farText = ((await up5.locator(".stop-tickets-dialog").textContent()) || "").replace(/\s+/g, " ");
    check("a count in the far column opens a dialog that says far tickets, not long", /\d+ far tickets? names? this stop/.test(farText) && !/ long tickets? name/.test(farText), farText.slice(0, 100));
    await up5.keyboard.press("Escape"); await up5.waitForTimeout(300);
    await up5.getByRole("button", { name: "Settings" }).click(); await up5.waitForTimeout(400);
    await up5.locator(".settings-nav-item", { hasText: /deck rules/i }).click(); await up5.waitForTimeout(400);
    const dr5 = ((await up5.locator(".deck-rules").textContent()) || "").replace(/\s+/g, " ");
    check("Deck rules gives the longest regular ticket in wagons, as reach is, not as a share of reach", /Longest regular ticket\s*\d+ % of the wagons/.test(dr5) && !/Longest regular ticket\s*\d+ % of reach/.test(dr5), dr5.slice(0, 200));
    await up5.context().close();
    fs.unlinkSync(fileU);
    await up2.context().close();
    // Group 2: the interface.
    {
      // 2: a small board is called by its name, in the facts row, not Custom board.
      const bn = await (await browser.newContext({ viewport: { width: 1500, height: 1000 } })).newPage();
      bn.on("pageerror", (e) => errors.push(String(e)));
      await bn.goto(BASE, { waitUntil: "networkidle" });
      await bn.getByRole("button", { name: "Start with a blank map" }).click(); await bn.waitForTimeout(500);
      if (await bn.locator('[role="dialog"]').count()) { await bn.keyboard.press("Escape"); await bn.waitForTimeout(300); }
      await bn.getByRole("button", { name: "Settings" }).click(); await bn.waitForTimeout(400);
      await bn.locator('#settings-format input[value="small-new-york"]').check(); await bn.waitForTimeout(500);
      await bn.keyboard.press("Escape"); await bn.waitForTimeout(300);
      const facts = (await bn.locator(".map-facts, .facts-row, main").first().textContent()) || "";
      check("a small board is named in the facts row: Small board, New York, not Custom board 2×2", /Small board, New York/.test(await bn.locator("body").textContent()) && !/Custom board 2×2/.test(await bn.locator(".map-facts, [class*=facts]").first().textContent().catch(() => "")));
      // 13: the long side needs two, said for 0 and for 1 alike.
      await bn.getByRole("button", { name: "Settings" }).click(); await bn.waitForTimeout(300);
      await bn.locator("#settings-custom-board").click(); await bn.waitForTimeout(300);
      await bn.locator("#custom-board-long").fill("0"); await bn.waitForTimeout(200);
      const m0 = await bn.locator(".custom-board-result").textContent();
      await bn.locator("#custom-board-long").fill("1"); await bn.waitForTimeout(200);
      const m1 = await bn.locator(".custom-board-result").textContent();
      check("a long side of 0 and of 1 get the same word: from 2 to 6", /from 2 to 6/.test(m0) && /from 2 to 6/.test(m1), `${m0} | ${m1}`);
      await bn.context().close();
      // 12: something selected while a panel holds the column: the panel names it.
      const bp2 = await (await browser.newContext({ viewport: { width: 1500, height: 1000 } })).newPage();
      bp2.on("pageerror", (e) => errors.push(String(e)));
      await bp2.goto(BASE, { waitUntil: "networkidle" });
      await bp2.getByRole("button", { name: "Load the example map" }).click(); await bp2.waitForTimeout(500);
      const sb = await bp2.locator("g.stop").first().boundingBox();
      await bp2.mouse.click(sb.x + sb.width / 2, sb.y + sb.height / 2); await bp2.waitForTimeout(300);
      await bp2.getByRole("button", { name: "Tickets", exact: true }).click(); await bp2.waitForTimeout(400);
      check("with a stop selected and Tickets open, the panel says the stop's properties are behind it", /Properties of .+ are behind this panel/.test((await bp2.locator(".tickets-panel").textContent()) || ""));
      await bp2.context().close();
      // 1, 7, 8: welcome box, phone menu, print table.
      for (const [w, h] of [[1400, 900], [572, 821], [400, 820]]) {
        const wp2 = await (await browser.newContext({ viewport: { width: w, height: h } })).newPage();
        await wp2.goto(BASE, { waitUntil: "networkidle" }); await wp2.waitForTimeout(500);
        const lay = await wp2.evaluate(() => ({ video: document.querySelector(".tour-video").getBoundingClientRect().bottom, steps: document.querySelector(".guide-steps").getBoundingClientRect().top }));
        check(`the welcome box at ${w} px: the video does not lie over the list`, lay.steps >= lay.video - 1, JSON.stringify(lay));
        await wp2.context().close();
      }
      // Group 3: the same words and numbers wherever they stand.
      const g3 = await (await browser.newContext({ viewport: { width: 1500, height: 1000 } })).newPage();
      g3.on("pageerror", (e) => errors.push(String(e)));
      await g3.goto(BASE, { waitUntil: "networkidle" });
      await g3.getByRole("button", { name: "Load the example map" }).click(); await g3.waitForTimeout(600);
      await g3.getByRole("button", { name: "Map balance", exact: true }).click(); await g3.waitForTimeout(500);
      const balText = ((await g3.locator(".balance-panel").textContent()) || "").replace(/\s+/g, " ");
      check("Map balance counts connections and says that a double route is one", /as a share of all connections \(a double route counts as one\)/.test(balText) && /\d+ of \d+ connections/.test(balText), balText.slice(0, 120));
      check("it says the busiest stop is counted in regular tickets", /Most tickets on one stop \(regular tickets, the long ones left out\)/.test(balText));
      check("and which rules the tickets are read with, and how long a ticket may be under them", /read with the rules of [A-Za-z ]+, which allow a ticket to be as long as \d+ % of the wagons/.test(balText), balText.slice(0, 300));
      check("Ticket lengths says what reach is and where it comes from", /as a share of reach: the longest regular ticket this style asks for \(\d+ wagon spaces, \d+ % of \d+ wagons\)/.test(balText), balText.slice(balText.indexOf("Ticket lengths"), balText.indexOf("Ticket lengths") + 260));
      check("and leaves out the tickets longer than reach in those words", !/longer than a player can build/.test(balText));
      await g3.keyboard.press("Escape"); await g3.waitForTimeout(300);
      await g3.getByRole("button", { name: "Settings" }).click(); await g3.waitForTimeout(400);
      await g3.locator(".settings-nav-item", { hasText: /deck rules/i }).click(); await g3.waitForTimeout(400);
      const rulesText = ((await g3.locator(".deck-rules").textContent()) || "").replace(/\s+/g, " ");
      check("Deck rules measures the lengths in reach too, and no longer says across the map", /of reach/.test(rulesText) && !/Across the map means/.test(rulesText) && /Reach is the longest regular ticket this style asks for/.test(rulesText), rulesText.slice(0, 160));
      check("and says Most tickets on one stop, as everywhere", /Most tickets on one stop/.test(rulesText) && !/Most tickets at one stop/.test(rulesText));
      const settingsText = ((await g3.locator('[role="dialog"]').textContent()) || "").replace(/\s+/g, " ");
      check("the length groups are short, medium and far, and a long ticket is another thing", /Far from · spaces/.test(settingsText) && /is far/.test(settingsText) && /A ticket marked long is another thing/.test(settingsText));
      await g3.keyboard.press("Escape"); await g3.waitForTimeout(300);
      await g3.getByRole("button", { name: "Tickets", exact: true }).click(); await g3.waitForTimeout(400);
      await g3.getByRole("button", { name: /Add a deck/ }).click(); await g3.waitForTimeout(250);
      await g3.getByRole("menuitem", { name: /Build a full deck of tickets/ }).click(); await g3.waitForSelector(".suggest-dialog", { timeout: 20000 }); await g3.waitForTimeout(400);
      const dlg = ((await g3.locator(".suggest-dialog").textContent()) || "").replace(/\s+/g, " ");
      check("the deck dialog names the groups short / medium / far, and says what reach is", /Short \/ medium \/ far/.test(dlg) && /the longest regular ticket this style asks for: \d+ % of \d+ wagons/.test(dlg), dlg.slice(dlg.indexOf("Reach") - 20, dlg.indexOf("Reach") + 120));
      check("the average of seven is the seven classic maps", /seven classic official maps/.test(dlg));
      await g3.locator("#suggest-size").fill("999"); await g3.waitForTimeout(2500);
      const big = ((await g3.locator(".suggest-dialog").textContent()) || "").replace(/\s+/g, " ");
      check("999 tickets are said to be more than the map has, with the size the deck got", /Only \d+ different tickets could be made for this map, so that is the size of the deck, not 999/.test(big), big.slice(big.indexOf("Only"), big.indexOf("Only") + 120));
      check("and a score that means nothing is not printed as a number", !/\b\d{3,}\.\d\b/.test(((await g3.locator(".suggest-table tr", { hasText: "Score" }).first().textContent()) || "")));
      await g3.keyboard.press("Escape"); await g3.waitForTimeout(300);
      await g3.context().close();
      // Group 4: other texts.
      const g4 = await (await browser.newContext({ viewport: { width: 1500, height: 1000 } })).newPage();
      g4.on("pageerror", (e) => errors.push(String(e)));
      await g4.goto(BASE, { waitUntil: "networkidle" });
      const welcomeText = ((await g4.locator('[role="dialog"]').textContent()) || "").replace(/\s+/g, " ");
      check("the welcome box names the small boards among the boards", /the extended 2×4, a small board or a size of your own/.test(welcomeText));
      await g4.getByRole("button", { name: "Load the example map" }).click(); await g4.waitForTimeout(500);
      const aboutText = await (await g4.context().newPage()).goto(BASE.replace(/\/$/, "") + "/about/").then(async (r) => r && (await r.text()));
      check("the About page names them too", /a small board \(New York or Amsterdam\)/.test((aboutText || "").replace(/<[^>]+>/g, "").replace(/\s+/g, " ")));
      const sb4 = await g4.locator("g.stop").first().boundingBox();
      await g4.mouse.click(sb4.x + sb4.width / 2, sb4.y + sb4.height / 2); await g4.waitForTimeout(300);
      const order = await g4.evaluate(() => { const form = document.querySelector(".properties .property-form") || document.querySelector(".properties"); const text = (el) => el.textContent || ""; const nodes = [...form.querySelectorAll("label, p.helper")]; const idx = (re) => nodes.findIndex((n) => re.test(text(n))); return { symbol: idx(/^Symbol/), helper: idx(/Mark a stop with a symbol/), type: idx(/^Stop type/) }; });
      check("the line about symbols stands under Symbol, before Stop type", order.symbol >= 0 && order.helper > order.symbol && (order.type === -1 || order.helper < order.type), JSON.stringify(order));
      await g4.getByRole("button", { name: "Settings" }).click(); await g4.waitForTimeout(400);
      await g4.locator(".settings-nav-item", { hasText: /route types/i }).click(); await g4.waitForTimeout(300);
      check("Route types says that a route from the start has the colour of its type, the rest of the routes their own", /only a route that is on the board from the start takes the colour of its type/.test(((await g4.locator('[role="dialog"]').textContent()) || "").replace(/\s+/g, " ")));
      await g4.keyboard.press("Escape"); await g4.waitForTimeout(300);
      await g4.getByRole("button", { name: "Map balance", exact: true }).click(); await g4.waitForTimeout(500);
      const bal4 = ((await g4.locator(".balance-panel").textContent()) || "").replace(/\s+/g, " ");
      check("Map balance for a map with no wagon size of its own does not point at a setting that is not in use", !/Settings → Map\b/.test(bal4) && /fitted from the published/.test(bal4), bal4.slice(0, 120));
      await g4.keyboard.press("Escape"); await g4.waitForTimeout(300);
      // A map with a wagon size of its own (a small board brings one): the way to it is named as it is in Settings.
      const gw = await (await browser.newContext({ viewport: { width: 1500, height: 1000 } })).newPage();
      gw.on("pageerror", (e) => errors.push(String(e)));
      await gw.goto(BASE, { waitUntil: "networkidle" });
      await gw.getByRole("button", { name: "Load the example map" }).click(); await gw.waitForTimeout(500);
      if (await gw.locator('[role="dialog"]').count()) { await gw.keyboard.press("Escape"); await gw.waitForTimeout(300); }
      await gw.getByRole("button", { name: "Settings" }).click(); await gw.waitForTimeout(400);
      await gw.locator('#settings-format input[value="small-new-york"]').check(); await gw.waitForTimeout(500);
      await gw.keyboard.press("Escape"); await gw.waitForTimeout(300);
      await gw.getByRole("button", { name: "Map balance", exact: true }).click(); await gw.waitForTimeout(500);
      const balW = ((await gw.locator(".balance-panel").textContent()) || "").replace(/\s+/g, " ");
      check("Map balance names the way to the map's own wagon size: Settings → Board → Custom size → Real sizes", /Settings → Board → Custom size → Real sizes/.test(balW) && !/Settings → Map\b/.test(balW), balW.slice(0, 160));
      await gw.context().close();
      // A ticket file given to Map project says what it was.
      const tf = path.join(os.tmpdir(), `ttr-tix82-${Date.now()}.json`);
      const stopNames = await g4.evaluate(() => JSON.parse(localStorage.getItem("ttr-map")).stops.slice(0, 2).map((x) => ({ id: x.id, name: x.name })));
      fs.writeFileSync(tf, JSON.stringify({ format: "ticket-to-ride-map", version: 4, kind: "tickets", payload: { kind: "tickets", map: "x", sets: [{ id: "tx", label: "From a ticket file" }], tickets: [{ id: "t1", a: stopNames[0].id, b: stopNames[1].id, points: 5, set: "tx", aName: stopNames[0].name, bName: stopNames[1].name }] } }));
      await g4.locator('input[type="file"][accept="application/json"]').setInputFiles(tf); await g4.waitForTimeout(800);
      check("a ticket file opened as a map project says it holds tickets only and was added as decks", /That file holds tickets only/.test((await g4.locator("[data-sonner-toast]").allTextContents()).join(" ")), (await g4.locator("[data-sonner-toast]").allTextContents()).join(" | "));
      fs.unlinkSync(tf);
      await g4.keyboard.press("Escape"); await g4.waitForTimeout(300);
      // Shapes start with no name: nothing is written on the map.
      await g4.context().close();
      const g5 = await (await browser.newContext({ viewport: { width: 1500, height: 1000 } })).newPage();
      g5.on("pageerror", (e) => errors.push(String(e)));
      await g5.goto(BASE, { waitUntil: "networkidle" });
      await g5.getByRole("button", { name: "Start with a blank map" }).click(); await g5.waitForTimeout(500);
      if (await g5.locator('[role="dialog"]').count()) { await g5.keyboard.press("Escape"); await g5.waitForTimeout(300); }
      await g5.getByRole("button", { name: /Draw background/ }).click(); await g5.waitForTimeout(200);
      await g5.locator(".background-tools select").selectOption({ label: "Rectangle" });
      const c1 = await g5.evaluate(() => { const svg = document.querySelector(".map-canvas"); const r = svg.getBoundingClientRect(); return { x: r.left + r.width * 0.2, y: r.top + r.height * 0.3, x2: r.left + r.width * 0.4, y2: r.top + r.height * 0.5 }; });
      await g5.mouse.move(c1.x, c1.y); await g5.mouse.down(); await g5.mouse.move(c1.x2, c1.y2, { steps: 5 }); await g5.mouse.up(); await g5.waitForTimeout(400);
      const lastShape = await g5.evaluate(() => JSON.parse(localStorage.getItem("ttr-map")).background.at(-1));
      check("a rectangle starts with no name, so nothing is written on the map", lastShape && lastShape.label === "" && (await g5.locator(".property-form #background-label").getAttribute("placeholder")) === "Left empty, nothing is written on the map", JSON.stringify(lastShape && lastShape.label));
      check("and the drawing tips say Ctrl/Cmd+Z", /Ctrl\/Cmd\+Z/.test((await g5.locator(".background-tips").textContent()) || ""));
      await g5.context().close();
      // 45: a map exported and loaded again, untouched, is still the version it was.
      for (const kind of ["problems", "example"]) {
        const ev = await (await browser.newContext({ viewport: { width: 1500, height: 1000 }, acceptDownloads: true })).newPage();
        ev.on("pageerror", (e) => errors.push(String(e)));
        await ev.goto(BASE, { waitUntil: "networkidle" });
        await ev.getByRole("button", { name: kind === "problems" ? "Load a map with problems" : "Load the example map" }).click(); await ev.waitForTimeout(600);
        const dl = ev.waitForEvent("download");
        await ev.getByRole("button", { name: "Export", exact: true }).click(); await ev.waitForTimeout(250);
        await ev.getByRole("menuitem", { name: "Full map", exact: true }).click(); await dl; await ev.waitForTimeout(500);
        const before = ((await ev.locator(".map-status .map-version").textContent()) || "").trim();
        await ev.reload({ waitUntil: "networkidle" }); await ev.waitForTimeout(700);
        const after = ((await ev.locator(".map-status .map-version").textContent()) || "").trim();
        check(`the ${kind === "problems" ? "map with problems" : "example"}, exported and loaded again untouched, is not changed: ${before}`, before === "Version 1" && after === "Version 1", `${before} → ${after}`);
        await ev.context().close();
      }
      // Group 5: small things.
      {
        const g6 = await (await browser.newContext({ viewport: { width: 1500, height: 1000 } })).newPage();
        g6.on("pageerror", (e) => errors.push(String(e)));
        await g6.goto(BASE, { waitUntil: "networkidle" });
        const f6 = path.join(os.tmpdir(), `ttr-small82-${Date.now()}.json`);
        const bigName = "Ett väldigt långt stoppnamn som aldrig verkar ta slut Centralstation Norra";
        fs.writeFileSync(f6, JSON.stringify({ format: "ticket-to-ride-map", version: 4, kind: "map", payload: { name: "Small things", format: "board-2x3", stops: [{ id: "a", name: bigName, type: "city", x: 200, y: 200 }, { id: "b", name: bigName, type: "city", x: 600, y: 300 }], routes: [{ id: "r1", a: "a", b: "b", length: 3, type: "city", color: "red" }, { id: "r2", a: "a", b: "b", length: 6, type: "city", color: "blue" }], background: [{ id: "bg1", type: "area", label: "", points: [{ x: 100, y: 400 }, { x: 300, y: 400 }, { x: 200, y: 500 }], fill: "#b8ddea", stroke: "#4f8394", opacity: 0.65, strokeWidth: 3 }], tickets: [{ id: "t1", a: "a", b: "b", points: 5, set: "main" }] } }));
        await g6.locator('input[type="file"][accept="application/json"]').setInputFiles(f6); await g6.waitForTimeout(800);
        fs.unlinkSync(f6);
        const facts6 = ((await g6.locator(".map-status").textContent()) || "").replace(/\s+/g, " ");
        check("one of a thing is said in the singular: 2 stops, 2 routes, 1 background object, 1 ticket", /2 stops/.test(facts6) && /2 routes/.test(facts6) && /1 background object(?!s)/.test(facts6) && /1 ticket(?!s)/.test(facts6), facts6.slice(0, 200));
        const cards6 = ((await g6.locator(".tools-panel").textContent()) || "").replace(/\s+/g, " ");
        check("two stops with the same name are said so", /Two stops share a name/.test(cards6) && /\(2 stops\)/.test(cards6), cards6.slice(0, 260));
        check("and a double route with lanes of 3 and 6 spaces is said to be uneven", /1 double route with lanes of different lengths/.test(cards6) && /3 and 6/.test(cards6));
        // An emptied stop name becomes Unnamed stop.
        const sb6 = await g6.locator("g.stop").first().boundingBox();
        await g6.mouse.click(sb6.x + sb6.width / 2, sb6.y + sb6.height / 2); await g6.waitForTimeout(300);
        await g6.locator("#stop-name").fill(""); await g6.locator("#stop-name").blur(); await g6.waitForTimeout(400);
        check("a stop name that is emptied becomes Unnamed stop, not a blank in the lists", (await g6.locator("#stop-name").inputValue()) === "Unnamed stop");
        // Tickets: the points field can be emptied to type another number, and an empty one puts the old back.
        await g6.getByRole("button", { name: "Tickets", exact: true }).click(); await g6.waitForTimeout(400);
        const pts = g6.locator("input.ticket-points").first();
        await pts.fill(""); await g6.waitForTimeout(200);
        const stillStored = await g6.evaluate(() => JSON.parse(localStorage.getItem("ttr-map")).tickets[0].points);
        await pts.blur(); await g6.waitForTimeout(200);
        check("the points of a ticket stay 5 while the field is empty, and the field shows 5 again when it is left", stillStored === 5 && (await pts.inputValue()) === "5", `${stillStored} / ${await pts.inputValue()}`);
        const longCell = await g6.locator(".tickets-panel .analysis-table-scroll").first().evaluate((el) => { const box = el.getBoundingClientRect(); const head = [...el.querySelectorAll("thead th")].find((th) => /^Points/.test(th.textContent || "")); return Boolean(head) && head.getBoundingClientRect().right <= box.right + 1; });
        check("a long stop name in the ticket table is cut short, so the Points column after it is in view without scrolling", longCell);
        await g6.getByRole("button", { name: "Done" }).click().catch(() => {}); await g6.waitForTimeout(300);
        // Esc leaves the tools that pick two stops.
        await g6.getByRole("button", { name: /Add ticket/ }).click(); await g6.waitForTimeout(200);
        check("Add ticket is chosen", /tool-ticket/.test((await g6.locator(".map-canvas").getAttribute("class")) || ""));
        await g6.keyboard.press("Escape"); await g6.waitForTimeout(250);
        check("Escape goes back to Select & move from Add ticket", /tool-select/.test((await g6.locator(".map-canvas").getAttribute("class")) || ""));
        // A message with a button is as wide as a message, the button under the words.
        await g6.getByRole("button", { name: /Draw route/ }).click(); await g6.waitForTimeout(200);
        const pos = await g6.evaluate(() => { const m = JSON.parse(localStorage.getItem("ttr-map")); const svg = document.querySelector(".map-canvas"); const out = {}; for (const id of ["a", "b"]) { const s = m.stops.find((x) => x.id === id); const pt = svg.createSVGPoint(); pt.x = s.x; pt.y = s.y; const c = pt.matrixTransform(svg.getScreenCTM()); out[id] = { x: c.x, y: c.y }; } return out; });
        await g6.mouse.click(pos.a.x, pos.a.y); await g6.waitForTimeout(150); await g6.mouse.click(pos.b.x, pos.b.y); await g6.waitForTimeout(500);
        const toastBox = await g6.locator("[data-sonner-toast]").first().boundingBox().catch(() => null);
        check("the message about a second route between two stops is wide, not a narrow tall column", toastBox !== null && toastBox.width >= 300 && toastBox.height <= 260, JSON.stringify(toastBox));
        await g6.keyboard.press("Escape"); await g6.waitForTimeout(200);
        await g6.context().close();
        // Delete after a click on a button in Properties still takes the shape away.
        const g7 = await (await browser.newContext({ viewport: { width: 1500, height: 1000 } })).newPage();
        g7.on("pageerror", (e) => errors.push(String(e)));
        await g7.goto(BASE, { waitUntil: "networkidle" });
        await g7.getByRole("button", { name: "Start with a blank map" }).click(); await g7.waitForTimeout(500);
        if (await g7.locator('[role="dialog"]').count()) { await g7.keyboard.press("Escape"); await g7.waitForTimeout(300); }
        await g7.getByRole("button", { name: /Draw background/ }).click(); await g7.waitForTimeout(200);
        await g7.locator(".background-tools select").selectOption({ label: "Rectangle" });
        const box7 = await g7.evaluate(() => { const r = document.querySelector(".map-canvas").getBoundingClientRect(); return { x: r.left + r.width * 0.2, y: r.top + r.height * 0.3, x2: r.left + r.width * 0.4, y2: r.top + r.height * 0.5 }; });
        await g7.mouse.move(box7.x, box7.y); await g7.mouse.down(); await g7.mouse.move(box7.x2, box7.y2, { steps: 5 }); await g7.mouse.up(); await g7.waitForTimeout(400);
        await g7.getByRole("button", { name: /Lock geometry/ }).click(); await g7.waitForTimeout(300);
        await g7.keyboard.press("Delete"); await g7.waitForTimeout(400);
        check("Delete takes the selected shape away even when the last click was on Lock geometry", (await g7.evaluate(() => JSON.parse(localStorage.getItem("ttr-map")).background.length)) === 0);
        await g7.context().close();
      }
      // 34: the lists of the stop tool are wide enough for their words in a narrow window.
      {
        const nw = await (await browser.newContext({ viewport: { width: 800, height: 520 } })).newPage();
        nw.on("pageerror", (e) => errors.push(String(e)));
        await nw.goto(BASE, { waitUntil: "networkidle" });
        await nw.getByRole("button", { name: "Start with a blank map" }).click(); await nw.waitForTimeout(500);
        if (await nw.locator('[role="dialog"]').count()) { await nw.keyboard.press("Escape"); await nw.waitForTimeout(300); }
        await nw.getByRole("button", { name: /Add stop/ }).click(); await nw.waitForTimeout(300);
        const fits = await nw.locator(".tool-options select").evaluateAll((els) => els.map((e) => { const cs = getComputedStyle(e); const ctx = document.createElement("canvas").getContext("2d"); ctx.font = `${cs.fontWeight} ${cs.fontSize} ${cs.fontFamily}`; const word = e.options[e.selectedIndex].text; const room = e.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight); return { word, need: Math.ceil(ctx.measureText(word).width), room: Math.floor(room) }; }));
        check("in a narrow window the chosen words of the stop type, size and symbol lists fit in their lists", fits.length >= 3 && fits.every((f) => f.need <= f.room), JSON.stringify(fits));
        await nw.context().close();
      }
      // 46: the deck that was open is the deck that is open after a reload.
      {
        const dk = await (await browser.newContext({ viewport: { width: 1500, height: 1000 } })).newPage();
        dk.on("pageerror", (e) => errors.push(String(e)));
        await dk.goto(BASE, { waitUntil: "networkidle" });
        await dk.getByRole("button", { name: "Load the example map" }).click(); await dk.waitForTimeout(600);
        await dk.getByRole("button", { name: "Tickets", exact: true }).click(); await dk.waitForTimeout(400);
        await dk.getByRole("button", { name: /Add a deck/ }).click(); await dk.waitForTimeout(250);
        await dk.getByRole("menuitem", { name: /Duplicate this one/ }).click(); await dk.waitForTimeout(500);
        const chosen = await dk.locator("#ticket-set").inputValue();
        await dk.reload({ waitUntil: "networkidle" }); await dk.waitForTimeout(700);
        await dk.getByRole("button", { name: "Tickets", exact: true }).click(); await dk.waitForTimeout(400);
        check("the deck that was open comes back open after a reload", (await dk.locator("#ticket-set").inputValue()) === chosen && chosen !== "main", `${chosen} → ${await dk.locator("#ticket-set").inputValue()}`);
        await dk.context().close();
      }
      // Fields and tick boxes have names for a screen reader, in every page.
      {
        const g8 = await (await browser.newContext({ viewport: { width: 1500, height: 1000 } })).newPage();
        g8.on("pageerror", (e) => errors.push(String(e)));
        await g8.goto(BASE, { waitUntil: "networkidle" });
        await g8.getByRole("button", { name: "Load the example map" }).click(); await g8.waitForTimeout(600);
        const unnamedNow = () => g8.evaluate(() => [...document.querySelectorAll("input:not([type=hidden]):not([type=file]), select, textarea")].filter((e) => { const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0; }).filter((e) => { const ids = (e.getAttribute("aria-labelledby") || "").split(/\s+/).map((id) => (document.getElementById(id) || {}).textContent || "").join("").trim(); const labels = e.labels ? [...e.labels].map((l) => l.textContent).join("").trim() : ""; return !(e.getAttribute("aria-label") || ids || labels || e.getAttribute("title")); }).length);
        const sb8 = await g8.locator("g.stop").first().boundingBox(); await g8.mouse.click(sb8.x + sb8.width / 2, sb8.y + sb8.height / 2); await g8.waitForTimeout(400);
        check("a stop's Properties: every field has a name", (await unnamedNow()) === 0, String(await unnamedNow()));
        await g8.getByRole("button", { name: "Settings" }).click(); await g8.waitForTimeout(400);
        let total8 = 0; const pages8 = await g8.locator(".settings-nav-item").allTextContents();
        for (const nav of pages8) { await g8.locator(".settings-nav-item", { hasText: nav.trim() }).first().click(); await g8.waitForTimeout(250); total8 += await unnamedNow(); }
        check("Settings, every page: every field, slider and list has a name", total8 === 0, `${total8} without in ${pages8.length} pages`);
        await g8.keyboard.press("Escape"); await g8.waitForTimeout(250);
        await g8.getByRole("button", { name: "Tickets", exact: true }).click(); await g8.waitForTimeout(500);
        check("the tickets table: every tick box has a name", (await unnamedNow()) === 0, String(await unnamedNow()));
        await g8.context().close();
        const g9 = await (await browser.newContext({ viewport: { width: 400, height: 820 } })).newPage();
        await g9.goto(BASE, { waitUntil: "networkidle" }); await g9.waitForTimeout(500);
        const order9 = await g9.evaluate(() => { const b = [...document.querySelectorAll('[role="dialog"] [data-slot="dialog-footer"] button')].map((x) => x.getBoundingClientRect().top); return b; });
        check("the welcome box on a phone: the buttons are in the order that Tab goes through them, top to bottom", order9.every((t, i) => i === 0 || t >= order9[i - 1] - 1), JSON.stringify(order9));
        await g9.context().close();
      }
      const ph = await (await browser.newContext({ viewport: { width: 400, height: 820 }, hasTouch: true, isMobile: true })).newPage();
      ph.on("pageerror", (e) => errors.push(String(e)));
      await ph.goto(BASE, { waitUntil: "networkidle" });
      await ph.getByRole("button", { name: "Load the example map" }).click(); await ph.waitForTimeout(600);
      await ph.locator("#phone-properties").click(); await ph.waitForTimeout(400);
      await ph.locator("#phone-menu").click(); await ph.waitForTimeout(400);
      const menuOnTop = await ph.evaluate(() => { const item = document.querySelector(".header-actions.open button"); if (!item) return "no menu"; const r = item.getBoundingClientRect(); const top = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2); return item.contains(top) || (top && top.closest(".header-actions")) ? "on top" : (top ? top.className : "nothing"); });
      check("on a phone the menu lies over an open sheet, where it can be used", menuOnTop === "on top", String(menuOnTop));
      await ph.locator("#phone-menu").click().catch(() => {}); await ph.waitForTimeout(200);
      await ph.keyboard.press("Escape"); await ph.waitForTimeout(200);
      await ph.locator("#phone-menu").click(); await ph.waitForTimeout(300);
      await ph.getByRole("button", { name: "Print map" }).click(); await ph.waitForTimeout(600);
      const overflowing = await ph.evaluate(() => [...document.querySelectorAll(".print-table td button")].filter((b) => b.scrollWidth > b.clientWidth + 1).length);
      check("on a phone no cell of the print table runs over its edge", overflowing === 0, String(overflowing));
      await ph.context().close();
    }
  }

  if (sectionOpen) sectionTimes[sectionOpen.n] = Math.round((Date.now() - sectionOpen.at) / 100) / 10;
  if (process.env.TTR_TIMES) fs.writeFileSync(process.env.TTR_TIMES, JSON.stringify(sectionTimes));
  console.log("PASS:"); ok.forEach((l) => console.log("  ✓ " + l));
  if (bad.length) { console.log("FAIL:"); bad.forEach((l) => console.log("  ✗ " + l)); }
  if (skipped.length) { console.log("SKIPPED in WebKit (Chromium only):"); skipped.forEach((l) => console.log("  - " + l)); }
  console.log(`\n${ok.length} passed, ${bad.length} failed`);
  if (only) console.log(`PARTIAL RUN (TTR_ONLY=${process.env.TTR_ONLY}): ${runChain ? "sections 1 to 34 as a chain, " : ""}sections ${[...only].filter((n) => n >= 35).sort((a, b) => a - b).join(", ") || "none beyond the chain"}. Not the whole suite.`);
  console.log("CONSOLE ERRORS:", errors.length ? JSON.stringify(errors.slice(0, 5)) : "none");
  await browser.close();
  process.exit(bad.length ? 1 : 0);
})().catch((e) => {
  // Show what was checked before the run broke off, so one missing control does not hide the rest.
  ok.forEach((l) => console.log("  ✓ " + l));
  bad.forEach((l) => console.log("  ✗ " + l));
  console.log(`\n${ok.length} passed, ${bad.length} failed before the harness stopped`);
  console.error(`HARNESS FAILED in section ${sectionOpen ? sectionOpen.n : "?"}:`, e.message.split("\n").slice(0, 14).join(" | "));
  process.exit(2);
});
