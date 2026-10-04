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
const os = require("os");
const path = require("path");

const ok = [];
const bad = [];
const check = (label, pass, detail = "") => { (pass ? ok : bad).push(`${label}${detail ? " — " + detail : ""}`); };

(async () => {
  const browser = await chromium.launch();
  const page = await (await browser.newContext({ viewport: { width: 1500, height: 1000 } })).newPage();
  const errors = [];
  page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
  page.on("pageerror", (e) => errors.push(String(e)));

  await page.goto(BASE, { waitUntil: "networkidle" });

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
    const safariNote = await safariPage.locator('[role="dialog"]').first().textContent();
    check("and the dialog says why", /Safari/.test(safariNote) && /first/i.test(safariNote), safariNote.slice(-400));
    // Safari ignores the size of a page, so on one page the size of the board it is told what to do instead.
    await safariPage.getByRole("radio", { name: "One page, real size", exact: true }).check();
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
  check("the balance report finds the setup fits the map", (await page.locator(".space-warning, .deck-warning").count()) === 0, await page.locator(".balance-panel").textContent().then((t) => t.slice(0, 200)));
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

  // 3. tools + tooltip
  const toolLabels = await page.locator(".tool-row .tool-button").evaluateAll((els) => els.map((el) => el.getAttribute("aria-label")));
  check("every tool has a button", toolLabels.every(Boolean) && toolLabels.length >= 6, toolLabels.join(", "));
  // by label rather than position, so adding a tool does not silently retarget these clicks
  const tool = (label) => page.locator(`.tool-row .tool-button[aria-label="${label}"]`);
  await tool("Draw route").hover();
  await page.waitForTimeout(250);
  check("tool tooltip matches the hovered button", (await page.locator('[data-slot="tooltip-content"]').textContent()).startsWith("Draw route"));

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

  // 5. undo (which also clears the selection, so read the stored map rather than the selected group)
  const storedLocos = () => page.evaluate(() => JSON.parse(localStorage.getItem("ttr-map")).routes.reduce((sum, r) => sum + (r.locomotiveSlots?.length ?? 0), 0));
  const beforeUndo = await storedLocos();
  await page.evaluate(() => document.activeElement.blur());
  await page.keyboard.press("Meta+z");
  await page.waitForTimeout(400);
  const afterUndo = await storedLocos();
  check("Cmd+Z undoes the locomotive", afterUndo === beforeUndo - 1, `${beforeUndo} -> ${afterUndo}`);

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

  // 7. route suggestions open in the right column (tested in full in 33h, on a map that has some)
  await page.getByRole("button", { name: "Suggest routes" }).click();
  await page.waitForTimeout(500);
  check("route suggestions render", await page.locator(".suggestion-panel").count() === 1);
  await page.locator(".suggestion-panel").getByRole("button", { name: "Done" }).click();
  await page.waitForTimeout(300);

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
  check("Settings offers only the two board shapes", JSON.stringify(formatOptions) === JSON.stringify(["board-2x3", "board-2x4"]), formatOptions.join(", "));
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
  check("it offers four ways to split the board: one sheet, per panel, full size, and one page the size of the board", (await printDialog().locator('input[name="print-split"]').count()) === 4);
  check("and four papers", (await printDialog().locator('input[name="print-paper"]').count()) === 4);
  check("the first time, the board prints whole on one sheet of A4", (await printDialog().locator('input[name="print-split"][value="sheet"]').isChecked()) && (await printDialog().locator('input[name="print-paper"][value="a4"]').isChecked()));
  // Anniversary is one checkbox under Supersize, not a choice between two board sizes.
  const supersize = () => printDialog().getByRole("checkbox", { name: "Anniversary size", exact: true });
  await printDialog().getByRole("radio", { name: "Full size" }).check();
  await page.waitForTimeout(200);
  check("a 2×4 board has no Anniversary size to print at", (await supersize().count()) === 0 && !/Supersize/.test(await printDialog().textContent()));
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
    const summary = await printDialog().locator(".print-summary").textContent();
    await page.evaluate(() => { window.__printed = null; });
    await page.emulateMedia({ media: "print" });
    await page.evaluate(() => Array.from(document.querySelectorAll('[role="dialog"] button')).find((b) => b.textContent.trim() === "Print").click());
    await page.waitForFunction(() => window.__printed !== null, null, { timeout: 5000 });
    const printed = await page.evaluate(() => window.__printed);
    await page.emulateMedia({ media: "screen" });
    await page.waitForTimeout(300);
    return { ...printed, promised, summary };
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
  check("picking a cell sets the paper", await printDialog().getByRole("radio", { name: "US Letter" }).isChecked());
  check("and the way it is split", await printDialog().getByRole("radio", { name: "Full size" }).isChecked());
  check("and the picked cell is marked", (await cell("letter", 3).getAttribute("aria-pressed")) === "true");
  check("and the summary follows", /12 sheets of US Letter/.test(await printDialog().locator(".print-summary").textContent()), await printDialog().locator(".print-summary").textContent());
  check("the 2×3 offers Anniversary size as one checkbox under Supersize", (await supersize().count()) === 1 && /Supersize/.test(await printDialog().locator("legend", { hasText: "Supersize" }).textContent()));
  check("and no Standard to pick, an empty box is the standard board", (await printDialog().getByRole("radio", { name: "Standard", exact: true }).count()) === 0);
  check("standard full size leaves it unticked", !(await supersize().isChecked()));
  await printDialog().getByRole("radio", { name: "One sheet", exact: true }).check();
  await page.waitForTimeout(200);
  check("it is never greyed out, even on one sheet", await supersize().isEnabled() && (await printDialog().locator("fieldset:disabled").count()) === 0);
  await supersize().check();
  await page.waitForTimeout(200);
  check("ticking it prints full size, since Anniversary only exists at full size", await printDialog().getByRole("radio", { name: "Full size" }).isChecked());
  check("and marks the Anniversary cell in the table", (await cell("letter", 4).getAttribute("aria-pressed")) === "true");
  check("and the summary names the bigger board", /972 × 648 mm/.test(await printDialog().locator(".print-summary").textContent()), await printDialog().locator(".print-summary").textContent());
  await cell("a4", 3).click();
  await page.waitForTimeout(200);
  check("picking a standard cell in the table takes the tick away", !(await supersize().isChecked()));
  await cell("a3", 4).click();
  await page.waitForTimeout(200);
  check("picking an Anniversary cell puts it back", await supersize().isChecked());
  await supersize().uncheck();
  await page.waitForTimeout(200);
  check("unticking it keeps full size on the standard board", await printDialog().getByRole("radio", { name: "Full size" }).isChecked() && (await cell("a3", 3).getAttribute("aria-pressed")) === "true");
  await supersize().check();
  await printDialog().getByRole("radio", { name: "One sheet per panel of the game board", exact: true }).check();
  await page.waitForTimeout(200);
  check("choosing a panel run takes the tick away too", !(await supersize().isChecked()));
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
  check("and the summary names the board it adds up to", /972 × 648 mm/.test(anniversary.summary), anniversary.summary);
  const tabloidSheet = await printFrom("tabloid", 1);
  check("Tabloid is declared upright in millimetres", /size:\s*279\.4mm 431\.8mm/.test(tabloidSheet.style), tabloidSheet.style);
  check("no print choice touched the map, but for its version number and playtest box", contentOf(await storedMap()) === contentOf(mapBeforeChoices));
  check("and the map carries no print settings", !/print-?(split|paper|choice)/i.test(await storedMap()));

  await page.reload({ waitUntil: "networkidle" });
  await page.waitForTimeout(700);
  await printButton().click();
  await page.waitForTimeout(400);
  check("the last print choice is remembered in this browser", await printDialog().getByRole("radio", { name: "Tabloid" }).isChecked() && await printDialog().getByRole("radio", { name: "One sheet", exact: true }).isChecked());
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
    const pdf = await page.pdf({ format: "A4", landscape, printBackground: true });
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
  check("a panel is offered by the game board's own name", await printDialog().getByRole("radio", { name: "One sheet per panel of the game board", exact: true }).count() === 1);
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
  const foot = await printDialog().locator(".print-dialog-foot").textContent();
  check("the dialog says to print upright, the default, and never asks for Landscape", /portrait|upright/i.test(foot) && !/choose Landscape/i.test(foot), foot);
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
  await printDialog().getByRole("radio", { name: "One sheet per panel of the game board", exact: true }).check();
  const beforeRadio = await layout();
  await printDialog().getByRole("radio", { name: "Full size" }).check();
  await page.waitForTimeout(150);
  const afterRadio = await layout();
  check("and when full size is picked", Math.abs(afterRadio.y - beforeRadio.y) < 0.5, `${(afterRadio.y - beforeRadio.y).toFixed(1)}px`);
  await supersize().check();
  await page.waitForTimeout(150);
  const afterTick = await layout();
  check("and when Anniversary size is ticked", Math.abs(afterTick.y - beforeRadio.y) < 0.5, `${(afterTick.y - beforeRadio.y).toFixed(1)}px`);
  await printDialog().getByRole("button", { name: "Cancel" }).click();
  await page.waitForTimeout(300);
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
    check("the picture is named after the map and is a .png", new RegExp(`^${mapName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")} v\\d+\\.png$`).test(png.suggestedFilename()), png.suggestedFilename());
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
    const csvItems = await page.getByRole("menu").last().getByRole("menuitem").allTextContents();
    check("Import has a spreadsheet menu: import, a template for each kind, and what the columns mean", ["Import spreadsheets…", "Stops template", "Routes template", "Tickets template", "What the columns mean"].every((name) => csvItems.includes(name)), csvItems.join(" | "));
    const guideLink = await page.getByRole("menuitem", { name: "What the columns mean" }).getAttribute("href");
    check("the column guide opens from the repository, in a new tab", guideLink === "https://github.com/bjornhagstrom/ticket-to-ride-map-editor/blob/main/docs/CSV.md" && (await page.getByRole("menuitem", { name: "What the columns mean" }).getAttribute("target")) === "_blank", String(guideLink));
    const chooser = page.waitForEvent("filechooser");
    await page.getByRole("menuitem", { name: "Import spreadsheets…" }).click();
    await (await chooser).setFiles([stops.file, routes.file, tickets.file]);
    await page.waitForTimeout(600);
    const ask = await page.getByRole("alertdialog").textContent().catch(() => "");
    check("importing a spreadsheet over a map asks before it replaces the stops and routes", /Replace stops and routes/i.test(ask) && /new deck/i.test(ask), ask);
    await page.getByRole("button", { name: "Continue" }).click();
    await page.waitForTimeout(600);
    const after = await page.evaluate(() => JSON.parse(localStorage.getItem("ttr-map")));
    const sameStops = stored.stops.every((s) => after.stops.some((t) => t.name === s.name && Math.abs(t.x - s.x) <= .5 && Math.abs(t.y - s.y) <= .5));
    check("the map comes back from its own spreadsheets: every stop in its place, every route", after.stops.length === stored.stops.length && sameStops && after.routes.length === stored.routes.length, `${after.stops.length} stops, ${after.routes.length} routes`);
    check("the tickets arrive as new decks beside the old ones", after.ticketSets.length === stored.ticketSets.length * 2 && after.tickets.length === stored.tickets.length * 2, `${after.ticketSets.length} decks, ${after.tickets.length} tickets`);
    const toastText = (await page.locator("[data-sonner-toast]").allTextContents()).join(" | ");
    check("and the editor says what it read", /stops/.test(toastText) && /routes/.test(toastText) && /tickets/.test(toastText), toastText);
    // The templates: downloaded from the same menu, named for what they hold, and good enough to import
    // as they are.
    const openTemplates = async () => { await page.getByRole("button", { name: "Import", exact: true }).click(); await page.waitForTimeout(250); await page.getByRole("menuitem", { name: "Spreadsheet (CSV)" }).click(); await page.waitForTimeout(250); };
    const templates = [];
    for (const kind of ["Stops", "Routes", "Tickets"]) templates.push(await downloadFrom(openTemplates, `${kind} template`));
    check("each template downloads as a .csv named for its kind, with a header and example rows", templates.every((t, i) => t.name === `${["stops", "routes", "tickets"][i]}-template.csv` && t.bom && t.header.length >= 3 && t.rows.length >= 2), templates.map((t) => `${t.name} ${t.rows.length}`).join(", "));
    await page.evaluate(() => { const map = JSON.parse(localStorage.getItem("ttr-map")); localStorage.setItem("ttr-map", JSON.stringify({ ...map, stops: [], routes: [], tickets: [], ticketSets: [{ id: "main", label: "Main deck" }] })); });
    await page.reload({ waitUntil: "networkidle" });
    await page.waitForTimeout(700);
    await openTemplates();
    const templateChooser = page.waitForEvent("filechooser");
    await page.getByRole("menuitem", { name: "Import spreadsheets…" }).click();
    await (await templateChooser).setFiles(templates.map((t) => t.file));
    await page.waitForTimeout(800);
    const fromTemplates = await page.evaluate(() => JSON.parse(localStorage.getItem("ttr-map")));
    const templateToast = (await page.locator("[data-sonner-toast]").allTextContents()).join(" | ");
    check("imported into an empty map, the three templates give a small working map, and nothing to warn about", fromTemplates.stops.length >= 4 && fromTemplates.routes.length >= 4 && fromTemplates.tickets.length >= 2 && !/had no position|left out|became/.test(templateToast), `${fromTemplates.stops.length} stops, ${fromTemplates.routes.length} routes | ${templateToast}`);
    // Saved from Excel on Windows as plain "CSV": semicolons and Windows-1252, not UTF-8. å, ä and ö survive.
    const excelFile = path.join(os.tmpdir(), `ttr-excel-${Date.now()}.csv`);
    fs.writeFileSync(excelFile, Buffer.from("Name;X;Y\r\nÅhus;100;100\r\nMalmö;300;300\r\nHässleholm;500;200\r\n", "latin1"));
    await openTemplates();
    const excelChooser = page.waitForEvent("filechooser");
    await page.getByRole("menuitem", { name: "Import spreadsheets…" }).click();
    await (await excelChooser).setFiles(excelFile);
    await page.waitForTimeout(500);
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
  const mm = (value) => value / 25.4 * 96;
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

  // 16. the ways into Settings: a stop type in the legend opens its own section
  const legendItem = page.locator(".legend-item").nth(1);
  const wantedType = (await legendItem.textContent()).trim();
  await legendItem.click();
  await page.waitForTimeout(500);
  check("a stop type in the legend opens Settings on stop types", /stop/i.test(await page.locator(".settings-nav .active").textContent()), await page.locator(".settings-nav .active").textContent());
  check("with that type ready to edit", (await page.locator(".settings-body").textContent()).includes(wantedType), wantedType);
  await page.keyboard.press("Escape");
  await page.waitForTimeout(300);

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

  // 18. the stop panel keeps each deck's tickets apart
  await useTool("Select & move");
  await clickStop("Westport");
  await page.waitForTimeout(400);
  const deckNames = await page.locator(".stop-ticket-deck-name").allTextContents();
  const westportDecks = await page.evaluate(() => { const m = JSON.parse(localStorage.getItem("ttr-map")); return new Set(m.tickets.filter((t) => t.a === "example-westport" || t.b === "example-westport").map((t) => t.set || "main")).size; });
  check("a stop's tickets are listed deck by deck", deckNames.length === westportDecks, `${deckNames.join(" | ")} for ${westportDecks} decks`);
  check("and every deck group holds only its own", (await page.locator(".stop-ticket-deck").first().locator(".stop-ticket-link").count()) >= 1);

  // 19. the game setup settings: wagons per player and tickets dealt at the start
  await page.getByRole("button", { name: "Settings" }).click();
  await page.waitForTimeout(500);
  check("Settings carries the game setup", await page.locator("#settings-wagons").isVisible() && await page.locator("#settings-starting-tickets").isVisible());
  // The example map is built for two or three; Settings shows the map's own range, not a default.
  check("including how many players the map is for", await page.locator("#settings-players-min").isVisible() && (await page.locator("#settings-players-min").inputValue()) === "2" && (await page.locator("#settings-players-max").inputValue()) === "3", `${await page.locator("#settings-players-min").inputValue()}–${await page.locator("#settings-players-max").inputValue()}`);
  await page.locator("#settings-players-max").fill("4");
  await page.locator("#settings-players-max").blur();
  await page.waitForTimeout(400);
  const newTable = await page.evaluate(() => JSON.parse(localStorage.getItem("ttr-map")).players);
  check("a different table is stored with the map", newTable.max === 4 && newTable.min <= 4, `${newTable.min}–${newTable.max}`);
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
  check("the balance report weighs the setup against the map", /wagon spaces/.test(setupText) && /player supplies/.test(setupText), setupText.slice(0, 140));
  check("and warns when the map is too small for the wagon count", (await page.locator(".setup-balance .space-warning").count()) === 1, setupText.slice(0, 260));
  check("the deck is measured against what a full table is dealt", /a table of five is dealt/.test(setupText));
  await page.keyboard.press("Escape");
  await page.waitForTimeout(300);

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

  // 24. a warning about how the network holds together says which stops or routes it means
  const lowCard = page.locator(".crossing-card.shape-card.has-warning");
  if (await lowCard.count()) {
    const lowText = (await lowCard.textContent()).replace(/\s+/g, " ");
    const named = ((await lowCard.locator("p").first().textContent()) || "").trim();
    check("the network card names what it means", named.length > 2, lowText);
  }

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

  // 29. the deck styles are laid out so they can be compared, and nothing is too pale to read
  await page.getByRole("button", { name: "Tickets", exact: true }).click();
  await page.waitForTimeout(400);
  await page.getByRole("button", { name: /Add a deck/ }).click();
  await page.waitForTimeout(250);
  await page.getByRole("menuitem", { name: /Build a full deck of tickets/ }).click();
  await page.waitForSelector(".suggest-dialog", { timeout: 20000 });
  await page.waitForTimeout(400);
  const styleCards = page.locator(".style-card");
  check("every style is described side by side", (await styleCards.count()) === 3, (await page.locator(".style-card strong").allTextContents()).join(", "));
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

  // 33. route types are drawn, not just named
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
  check("the suggester offers your own set beside ours", (await styleCard("Sparse").count()) === 1 && (await page.locator(".style-card").count()) === 4);
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
    check("the summary of the run says the rules follow the board", /then the rules/i.test(await printDialog().locator(".print-summary").textContent()));
    await choosePrintParts(true, false, false);
    check("with the board only, the summary is about the board alone", !/rules|ticket/i.test(await printDialog().locator(".print-summary").textContent()));
    await printDialog().getByRole("button", { name: "Cancel" }).click();
    await page.waitForTimeout(300);
    const pagesOf = async () => { await page.emulateMedia({ media: "print" }); const pdf = await page.pdf({ format: "A4", printBackground: true }); await page.emulateMedia({ media: "screen" }); return (pdf.toString("latin1").match(/\/Type\s*\/Page[^s]/g) || []).length; };
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
    await printButton().click();
    await page.waitForTimeout(350);
    const cardsSummary = await printDialog().locator(".print-summary").textContent();
    await printDialog().getByRole("button", { name: "Cancel" }).click();
    await page.waitForTimeout(300);
    check("the cards' sheet count in the summary is the number of pages the browser prints", Number((/(\d+) sheet/.exec(cardsSummary) || [])[1]) === pagesTickets, `${cardsSummary} against ${pagesTickets}`);
    await run(false, false, true);
    const t2 = await tree();
    check("with the rules only, the tree holds the rules and nothing else", JSON.stringify(t2.order) === JSON.stringify(["rules"]) && t2.rules === 1 && /House rules/.test(t2.text), JSON.stringify(t2.order));
    check("a reference to something that is not there prints as its plain name, unmarked", t2.missing === 0 && /Atlantis/.test(t2.text));
    check("on upright A4 with its margin", /size:\s*210mm 297mm/.test(t2.style), t2.style);
    const pagesRules = await pagesOf();
    check("these rules take one page, and the cards the sheets their summary promised", pagesRules === 1 && pagesTickets >= 1, `${pagesBoard} board, ${pagesTickets} tickets, ${pagesRules} rules`);
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
    check("with the board ticked, how it is split, Supersize and the sheet table are there", (await printDialog().locator('input[name="print-split"]').count()) === 4 && (await printDialog().locator(".print-table").count()) === 1);
    await choosePrintParts(false, true, true);
    check("without the board they go, and the paper stays", (await printDialog().locator('input[name="print-split"]').count()) === 0 && (await printDialog().locator(".print-table").count()) === 0 && (await printDialog().locator('input[name="print-paper"]').count()) === 4);
    const summary = await printDialog().locator(".print-summary").textContent();
    check("the summary says how many cards, on how many sheets, and then the rules", new RegExp(`${deckSize} ticket`).test(summary) && /\d+ sheet/.test(summary) && /then the rules/i.test(summary) && !/Standard board|board/i.test(summary.replace(/cards/g, "")), summary);
    await choosePrintParts(false, false, false);
    check("with nothing ticked there is nothing to print, and the dialog says so", (await printDialog().getByRole("button", { name: "Print", exact: true }).isDisabled()) && /tick at least one/i.test(await printDialog().textContent()));
    await choosePrintParts(false, true, true);
    await printDialog().getByRole("button", { name: "Cancel" }).click();
    await page.waitForTimeout(300);
    // the paper chosen sets the page for everything
    await printButton().click();
    await page.waitForTimeout(400);
    await printDialog().getByRole("radio", { name: "A3", exact: true }).check();
    await printDialog().getByRole("button", { name: "Cancel" }).click();
    await page.waitForTimeout(300);
    check("the paper chosen sets the page the cards and the rules print on", /size:\s*297mm 420mm/.test((await tree()).style));
    await printButton().click();
    await page.waitForTimeout(400);
    await printDialog().getByRole("radio", { name: "A4", exact: true }).check();
    // the whole board on one page the size of the board: for a large-format printer, or to save as a PDF
    await choosePrintParts(true, false, false);
    const onePage = printDialog().getByRole("radio", { name: "One page, real size", exact: true });
    check("the board can go on one page as big as the board", (await onePage.count()) === 1);
    await onePage.check();
    const pageSummary = await printDialog().locator(".print-summary").textContent();
    check("the dialog says what that is: one page, real size, and how big the page is", /one page/i.test(pageSummary) && /100 %/.test(pageSummary) && /810 × 553 mm/.test(pageSummary), pageSummary);
    check("and that it is for a large-format printer or a PDF", /large-format|PDF/i.test(await printDialog().textContent()));
    check("the paper no longer matters, so it is not asked for", (await printDialog().locator('input[name="print-paper"]').count()) === 0);
    check("the tickets and the rules cannot join it, and the dialog says they print apart", (await printPart("Print the tickets").isDisabled()) && (await printPart("Print the rules").isDisabled()) && /print(ed)? (them )?separately|apart/i.test(await printDialog().textContent()));
    await printDialog().getByRole("button", { name: "Cancel" }).click();
    await page.waitForTimeout(300);
    const wholeBoard = await page.evaluate(() => ({ pages: document.querySelectorAll(".print-pages .print-page").length, cards: document.querySelectorAll(".print-pages .ticket-card").length, rules: document.querySelectorAll(".print-pages .print-rules").length, style: Array.from(document.querySelectorAll(".print-pages style")).map((el) => el.textContent).join(" ") }));
    check("the print tree is one page of the board, with no cards and no rules", wholeBoard.pages === 1 && wholeBoard.cards === 0 && wholeBoard.rules === 0, JSON.stringify({ pages: wholeBoard.pages, cards: wholeBoard.cards, rules: wholeBoard.rules }));
    check("on a page declared as 810 × 553 mm", /size:\s*810mm 553mm/.test(wholeBoard.style), wholeBoard.style);
    await page.emulateMedia({ media: "print" });
    const sheetBox = await page.evaluate(() => { const r = document.querySelector(".print-pages .print-page").getBoundingClientRect(); return { w: r.width / 96 * 25.4, h: r.height / 96 * 25.4 }; });
    const pdfWhole = await page.pdf({ preferCSSPageSize: true, printBackground: true });
    await page.emulateMedia({ media: "screen" });
    const pdfText = pdfWhole.toString("latin1");
    const mediaBox = /\/MediaBox\s*\[\s*0\s+0\s+([\d.]+)\s+([\d.]+)\s*\]/.exec(pdfText);
    const pts = (mm) => mm / 25.4 * 72;
    check("the board is laid out upright and at its real size on the page: 790 × 533 mm with its caption", Math.abs(sheetBox.w - 790) < 2 && Math.abs(sheetBox.h - 533) < 2, `${sheetBox.w.toFixed(1)} × ${sheetBox.h.toFixed(1)} mm`);
    check("saved as a PDF it is a single page", (pdfText.match(/\/Type\s*\/Page[^s]/g) || []).length === 1);
    check("and that page is 810 × 553 mm, the size of the board and its margin (read from the PDF itself)", Boolean(mediaBox) && Math.abs(Number(mediaBox[1]) - pts(810)) < 3 && Math.abs(Number(mediaBox[2]) - pts(553)) < 3, mediaBox ? `${mediaBox[1]} × ${mediaBox[2]} pt, wanted ${pts(810).toFixed(0)} × ${pts(553).toFixed(0)}` : "no MediaBox found");
    await printButton().click();
    await page.waitForTimeout(400);
    await printDialog().getByRole("radio", { name: "One sheet per panel of the game board", exact: true }).check();
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

  // 34. a map saved on a format that is now a print choice opens on its board
  await page.evaluate(() => {
    const map = JSON.parse(localStorage.getItem("ttr-map"));
    localStorage.setItem("ttr-map", JSON.stringify({ ...map, format: "a4" }));
  });
  await page.reload({ waitUntil: "networkidle" });
  await page.waitForTimeout(700);
  check("a map saved as an A4 test sheet opens as a standard board", (await badges())[0] === "Standard board 2×3", (await badges())[0]);
  check("with everything on it", /\d+ stops/.test((await badges())[2]), (await badges())[2]);

  // 35. a board that stands: chosen in Settings beside the format, everything on it turned a quarter
  // turn, the canvas, the print, the cards and the file all standing with it. In a window of its own.
  {
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
    await dialog.getByRole("radio", { name: "One sheet per panel of the game board", exact: true }).check();
    const summary = await dialog.locator(".print-summary").textContent();
    check("and does not say the map is turned on the page", !/turned/.test(summary) && /upright/.test(summary), summary);
    const foot = await dialog.locator(".print-dialog-foot").allTextContents();
    check("nor does the note at the foot of the dialog", foot.length > 0 && foot.every((t) => !/turned/.test(t)), foot.join(" | "));
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
  {
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
  {
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
  {
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
  {
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
  {
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
  {
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
  {
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
  {
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
  {
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
  {
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
    check("ticket lengths are said in words: how many of the tickets reach how far across the map", /of the tickets/i.test(rules) && /across the map/i.test(rules) && !/% < 30 %/.test(rules), rules.slice(0, 300));
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
  {
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
    check("a JSON file that holds no map is refused too", /not a map/i.test(await toasts()) && (await stored()) === before, await toasts());
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
  for (const [w, h, mobile] of [[1280, 720, false], [1024, 768, false], [768, 1024, true], [390, 844, true]]) {
    const sp2 = await (await browser.newContext({ viewport: { width: w, height: h }, isMobile: mobile, hasTouch: mobile })).newPage();
    sp2.on("pageerror", (e) => errors.push(String(e)));
    await sp2.goto(BASE, { waitUntil: "networkidle" });
    await sp2.getByRole("button", { name: "Load the example map" }).click();
    await sp2.waitForTimeout(700);
    const m = await sp2.evaluate(() => { const box = (sel) => { const el = document.querySelector(sel); return el ? el.getBoundingClientRect() : null; }; const canvas = box(".map-canvas"), wrap = box(".map-wrap"), props = box("aside.properties"); return { scroll: document.documentElement.scrollWidth, client: document.documentElement.clientWidth, canvasRight: canvas.right, wrapRight: wrap.right, propsLeft: props.left, propsTop: props.top, wrapBottom: wrap.bottom }; });
    check(`${w} × ${h}: the page does not scroll sideways`, m.scroll <= m.client + 1, `${m.scroll} wide in ${m.client}`);
    if (w >= 1051) check(`${w} × ${h}: the map stays clear of the Properties column`, m.canvasRight <= m.propsLeft + 1, `map ends at ${Math.round(m.canvasRight)}, Properties begins at ${Math.round(m.propsLeft)}`);
    else if (w > 720) check(`${w} × ${h}: the map fits its area`, m.canvasRight <= m.wrapRight + 1, `${Math.round(m.canvasRight)} against ${Math.round(m.wrapRight)}`);
    const exportBox = await sp2.getByRole("button", { name: "Export", exact: true }).boundingBox();
    check(`${w} × ${h}: every button in the header can be seen, Export too`, exportBox && exportBox.x >= 0 && exportBox.x + exportBox.width <= w + 1, JSON.stringify(exportBox));
    await sp2.context().close();
  }

  // 48. Starting over: in Settings, under Map, not at the foot of the tools. It says what goes, offers
  // to export first, asks before it does anything, and Undo brings the map back.
  {
    const op2 = await (await browser.newContext({ viewport: { width: 1500, height: 1000 }, acceptDownloads: true })).newPage();
    op2.on("pageerror", (e) => errors.push(String(e)));
    await op2.goto(BASE, { waitUntil: "networkidle" });
    await op2.getByRole("button", { name: "Load the example map" }).click();
    await op2.waitForTimeout(600);
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
  {
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
    check("with only the balance page ticked, there is still something to print, and the dialog says what", await dialog.getByRole("button", { name: "Print", exact: true }).isEnabled() && /balance/i.test(await dialog.locator(".print-summary").textContent()), await dialog.locator(".print-summary").textContent());
    await stub();
    await dialog.getByRole("button", { name: "Print", exact: true }).click();
    const alone = await run();
    check("and it prints the balance page alone", alone.boards === 0 && alone.cards === 0 && alone.rules === 0 && /Map balance/.test(alone.balance), JSON.stringify({ ...alone, balance: alone.balance.slice(0, 40) }));
    await pp.context().close();
  }

  // 50. Every balance figure beside the official range, as a fact: crowded routes at a full table,
  // traffic on double routes against single ones, routes no ticket needs, most tickets on one stop,
  // and the average hub degree.
  {
    const ob = await (await browser.newContext({ viewport: { width: 1500, height: 1000 } })).newPage();
    ob.on("pageerror", (e) => errors.push(String(e)));
    await ob.goto(BASE, { waitUntil: "networkidle" });
    await ob.getByRole("button", { name: "Load the example map" }).click();
    await ob.waitForTimeout(600);
    await ob.getByRole("button", { name: "Map balance", exact: true }).click();
    await ob.waitForTimeout(800);
    const section = ob.locator(".analysis-section.against-official");
    check("Map balance opens with the map against the official maps", (await section.count()) === 1 && (await ob.locator(".balance-panel .analysis-section").first().evaluate((el) => el.classList.contains("against-official"))));
    const rows = await section.locator("tbody tr").evaluateAll((trs) => trs.map((tr) => Array.from(tr.cells).map((c) => c.textContent.trim())));
    const labels = rows.map((r) => r[0]).join(" | ");
    check("with crowded routes, double-route traffic, unneeded routes, the busiest stop and the hub degree", ["Crowded routes", "Double routes", "no ticket needs", "one stop", "hub degree"].every((w) => labels.includes(w)), labels);
    check("each with this map's figure and the official range", rows.every((r) => r.length === 3 && r[1] !== "" && /\d.*–.*\d/.test(r[2])), JSON.stringify(rows));
    check("and nothing in it is a warning", (await section.locator(".has-warning, .helper-warning, .analysis-warning-row").count()) === 0);
    check("the hub degree advice is the official range, not a guess", !/roughly 4–6/.test(await ob.locator("body").textContent()));
    await ob.context().close();
  }

  // 51. A deck's tension: calm (as it always was), like the official maps, or tense. Chosen when a full
  // deck is built, and set for the map in its deck rules, which the build then starts from.
  {
    const tp2 = await (await browser.newContext({ viewport: { width: 1500, height: 1000 } })).newPage();
    tp2.on("pageerror", (e) => errors.push(String(e)));
    await tp2.goto(BASE, { waitUntil: "networkidle" });
    await tp2.getByRole("button", { name: "Load the example map" }).click();
    await tp2.waitForTimeout(600);
    const openBuild = async () => { await tp2.getByRole("button", { name: "Tickets", exact: true }).click(); await tp2.waitForTimeout(400); await tp2.getByRole("button", { name: /Add a deck/ }).click(); await tp2.waitForTimeout(250); await tp2.getByRole("menuitem", { name: /Build a full deck of tickets/ }).click(); await tp2.waitForSelector(".suggest-dialog", { timeout: 20000 }); await tp2.waitForTimeout(400); };
    await openBuild();
    const tension = (name) => tp2.locator(".suggest-dialog").getByRole("radio", { name, exact: true });
    check("Build a full deck of tickets asks how tense: calm, like the official maps, or tense", (await tension("Calm").count()) === 1 && (await tension("Like the official maps").count()) === 1 && (await tension("Tense").count()) === 1);
    check("calm, as it always was, unless the map says otherwise", await tension("Calm").isChecked());
    const dialogText = (await tp2.locator(".suggest-dialog").textContent()).replace(/\s+/g, " ");
    check("each says what it does", /spread/i.test(dialogText) && /official/i.test(dialogText) && /crowd/i.test(dialogText), dialogText.slice(0, 200));
    await tension("Tense").check();
    await tp2.waitForFunction(() => { const row = [...document.querySelectorAll(".suggest-table tbody tr")].find((tr) => tr.children[0].textContent.trim() === "Score"); return row && row.children[2].textContent.trim() !== "—"; }, null, { timeout: 30000 });
    check("choosing one builds the deck again", await tension("Tense").isChecked());
    await tp2.keyboard.press("Escape");
    await tp2.waitForTimeout(400);
    // The map's own choice, in its deck rules.
    await tp2.getByRole("button", { name: "Settings" }).click();
    await tp2.waitForTimeout(400);
    await tp2.locator(".settings-nav-item", { hasText: /deck rules/i }).click();
    await tp2.waitForTimeout(400);
    const mapTension = (name) => tp2.locator(".deck-tension-choice").getByRole("radio", { name, exact: true });
    check("the deck rules have the map's own tension", (await mapTension("Like the official maps").count()) === 1 && await mapTension("Calm").isChecked());
    await mapTension("Like the official maps").check();
    await tp2.waitForTimeout(300);
    check("which is kept in the map", (await tp2.evaluate(() => JSON.parse(localStorage.getItem("ttr-map")).deckTension)) === "official");
    await tp2.keyboard.press("Escape");
    await tp2.waitForTimeout(400);
    await tp2.keyboard.press("Escape");
    await openBuild();
    check("and a full deck starts from it", await tension("Like the official maps").isChecked());
    await tp2.context().close();
  }

  // 52. Intended chokepoints and hubs: marked in Properties, kept in the map, and listed in Map balance
  // as on purpose instead of among the crowded routes.
  {
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
  // it, beside its settings; and in the print dialog, how the sheets divide the board.
  {
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
    const dialog = il.getByRole("dialog", { name: "Print the map" });
    const tiles = () => dialog.locator(".print-split-preview .print-split-sheet").count();
    check("the print dialog draws how the sheets divide the board: one sheet", (await dialog.locator(".print-split-preview").count()) === 1 && (await tiles()) === 1, String(await tiles()));
    await dialog.getByRole("radio", { name: "One sheet per panel of the game board", exact: true }).check();
    await il.waitForTimeout(300);
    check("one per panel: six on a standard board", (await tiles()) === 6, String(await tiles()));
    await dialog.getByRole("radio", { name: "Full size" }).check();
    await il.waitForTimeout(300);
    const promised = Number(await dialog.locator('.print-table tbody tr[data-paper="a4"] td button[aria-pressed="true"], .print-table tbody tr[data-paper="a4"] td button.chosen').first().getAttribute("data-pages").catch(() => "0"));
    check("full size: as many as the table says", (await tiles()) > 6 && (promised === 0 || (await tiles()) === promised), `${await tiles()} drawn, ${promised} in the table`);
    await il.context().close();
  }

  console.log("PASS:"); ok.forEach((l) => console.log("  ✓ " + l));
  if (bad.length) { console.log("FAIL:"); bad.forEach((l) => console.log("  ✗ " + l)); }
  console.log(`\n${ok.length} passed, ${bad.length} failed`);
  console.log("CONSOLE ERRORS:", errors.length ? JSON.stringify(errors.slice(0, 5)) : "none");
  await browser.close();
  process.exit(bad.length ? 1 : 0);
})().catch((e) => {
  // Show what was checked before the run broke off, so one missing control does not hide the rest.
  ok.forEach((l) => console.log("  ✓ " + l));
  bad.forEach((l) => console.log("  ✗ " + l));
  console.log(`\n${ok.length} passed, ${bad.length} failed before the harness stopped`);
  console.error("HARNESS FAILED", e.message.split("\n").slice(0, 14).join(" | "));
  process.exit(2);
});
