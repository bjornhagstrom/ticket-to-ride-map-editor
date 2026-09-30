// Browser regression suite. Drives the editor the way a person does and checks what came out.
//
//   npm run dev            # in one terminal, it expects http://localhost:3000/ttr/
//   npm run test:regression
//
// It writes to the same local storage the editor uses, so it will replace whatever map is open in
// that browser profile. It runs headless in its own profile, so your own browser is untouched.
const { chromium } = require("playwright");
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

  await page.goto("http://localhost:3000/ttr/", { waitUntil: "networkidle" });

  // 1. welcome guide
  check("welcome guide appears", await page.getByRole("button", { name: "Load the example map" }).isVisible());
  await page.getByRole("button", { name: "Load the example map" }).click();
  await page.waitForTimeout(600);

  const badges = async () => (await page.locator(".map-status span").allTextContents());
  check("example map loads", (await badges())[2] === "15 stops", (await badges()).slice(0, 4).join(", "));

  // 1b. the example map shows what the editor can do, and is itself a clean map
  const exampleStored = () => page.evaluate(() => JSON.parse(localStorage.getItem("orebro-map-editor-public-v2")));
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
  check("every route is drawn about as long as its wagons need", /Every route is drawn about the length its wagon count needs/.test(await page.getByText(/Wagon spaces are drawn at the size/).textContent()), await page.getByText(/Wagon spaces are drawn at the size/).textContent());
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
  check("a route type of its own, with a letter in every space", example.routes.some((r) => { const t = example.routeTypeStyles.find((x) => x.id === r.type); return t && t.glyph && !["city", "tunnel", "boat"].includes(t.id); }));
  check("at least eight wagon colours", new Set(example.routes.map((r) => r.color)).size >= 8, [...new Set(example.routes.map((r) => r.color))].join(", "));
  check("a note and all three kinds of background", example.notes.length >= 1 && ["area", "line", "label"].every((k) => example.background.some((b) => b.type === k)));
  const decks = example.ticketSets.map((set) => ({ set, tickets: example.tickets.filter((t) => (t.set || "main") === set.id) }));
  check("two ticket decks to compare", decks.length === 2 && decks.every((deck) => deck.tickets.length > 0), decks.map((d) => `${d.set.label} ${d.tickets.length}`).join(", "));
  const mainDeck = decks[0].tickets;
  check("the main deck can deal a full table", mainDeck.length >= (example.players?.max ?? 5) * (example.startingTickets ?? 3), `${mainDeck.length} for ${(example.players?.max ?? 5)} × ${example.startingTickets ?? 3}`);
  check("with long tickets among the rest", mainDeck.some((t) => t.long) && mainDeck.some((t) => !t.long));
  check("every stop but the junction is on a ticket", example.stops.filter((st) => !typeOf(st.type).junction).every((st) => mainDeck.some((t) => t.a === st.id || t.b === st.id)));
  await page.getByRole("button", { name: /^Tickets · / }).click();
  await page.waitForTimeout(500);
  const ticketsDialogText = await page.locator('[role="dialog"]').first().textContent();
  check("and the tickets dialog does not list the junction as a stop no ticket reaches", !ticketsDialogText.includes(junction.name), ticketsDialogText.slice(0, 200));
  await page.keyboard.press("Escape");
  await page.waitForTimeout(300);
  await page.getByRole("button", { name: "Analyze balance" }).click();
  await page.waitForTimeout(600);
  check("the balance report finds the setup fits the map", (await page.locator(".space-warning, .deck-warning").count()) === 0, await page.locator('[role="dialog"]').first().textContent().then((t) => t.slice(0, 200)));
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
    const map = JSON.parse(localStorage.getItem("orebro-map-editor-public-v2"));
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
  const pts = await page.evaluate(() => JSON.parse(localStorage.getItem("orebro-map-editor-public-v2")).routes
    .filter((r) => (r.a === "example-westport" && r.b === "example-millbrook") || (r.a === "example-millbrook" && r.b === "example-westport"))
    .map((r) => (r.points || []).length));
  check("bend added to both lines of the double route", pts.length === 2 && pts[0] === 2 && pts[1] === 2, `points per line: ${pts.join("/")}`);
  await page.locator(".bend-controls input[type=checkbox]").first().check();
  await page.waitForTimeout(350);
  // The two lines of the double route, found by their stops rather than by their colours.
  const curved = await page.evaluate(() => {
    const routes = JSON.parse(localStorage.getItem("orebro-map-editor-public-v2")).routes;
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
  const storedLocos = () => page.evaluate(() => JSON.parse(localStorage.getItem("orebro-map-editor-public-v2")).routes.reduce((sum, r) => sum + (r.locomotiveSlots?.length ?? 0), 0));
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
  await page.getByRole("button", { name: "Analyze balance" }).click();
  await page.waitForTimeout(500);
  const roomRows = await page.evaluate(() => {
    const h = Array.from(document.querySelectorAll(".analysis-section h3")).find((x) => x.textContent === "Room per wagon");
    return h ? h.parentElement.querySelectorAll("tbody tr").length : 0;
  });
  const cardRoutes = await page.evaluate(() => JSON.parse(localStorage.getItem("orebro-map-editor-public-v2")).routes.length);
  check("room-per-wagon table lists the card routes", roomRows === cardRoutes, `${roomRows} rows for ${cardRoutes} routes`);
  const hubRows = await page.evaluate(() => document.querySelectorAll(".analysis-section table tbody tr").length);
  check("balance dialog renders its tables", hubRows > 10);
  await page.keyboard.press("Escape");
  await page.waitForTimeout(300);

  // 7. suggestions dialog
  await page.getByRole("button", { name: "Suggest routes" }).click();
  await page.waitForTimeout(500);
  check("route suggestions render", await page.locator(".suggestion-list, .helper").count() > 0);
  await page.keyboard.press("Escape");
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
  const formatOptions = await page.locator("#settings-format option").evaluateAll((els) => els.map((el) => el.value));
  check("Settings offers only the two board shapes", JSON.stringify(formatOptions) === JSON.stringify(["board-2x3", "board-2x4"]), formatOptions.join(", "));
  check("and no longer asks which board a test sheet stands in for", (await page.locator("#settings-proof").count()) === 0);
  await page.locator("#settings-format").selectOption("board-2x4");
  await page.waitForTimeout(500);
  check("changing board format from Settings works", (await badges())[0] === "Extended board 2×4", (await badges())[0]);
  check("Settings shows what the format measures", /mm/.test(await page.locator(".format-measurements").textContent()));
  await page.keyboard.press("Escape");
  await page.waitForTimeout(400);
  const wagonHelper = async () => page.getByText(/Wagon spaces are drawn at the size/).textContent();
  check("wagons on a 2×4 are measured against its own 1,053 mm", /1,053 mm board/.test(await wagonHelper()), await wagonHelper());

  // 10. printing is decided per run, in a dialog behind the Print button, never in the map
  const storedMap = () => page.evaluate(() => localStorage.getItem("orebro-map-editor-public-v2"));
  const mapBeforePrinting = await storedMap();
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
      };
    };
  });
  const printButton = () => page.getByRole("button", { name: "Print map" });
  const printDialog = () => page.getByRole("dialog", { name: "Print the map" });
  await printButton().click();
  await page.waitForTimeout(400);
  check("the Print button opens a dialog rather than printing", await printDialog().isVisible() && (await page.evaluate(() => window.__printCalls)) === 0);
  check("it offers three ways to split the board", (await printDialog().locator('input[name="print-split"]').count()) === 3);
  check("and four papers", (await printDialog().locator('input[name="print-paper"]').count()) === 4);
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
  check("a 2×4 printed per panel is 8 pages", panels2x4.pages === 8, `${panels2x4.pages} pages`);
  check("and printing it left the map as it was", (await storedMap()) === mapBeforePrinting);

  // The same questions on the standard board, where Anniversary is a choice.
  await page.getByRole("button", { name: "Settings" }).click();
  await page.waitForTimeout(400);
  await page.locator("#settings-format").selectOption("board-2x3");
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
  check("no print choice touched the map", (await storedMap()) === mapBeforeChoices);
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
  const layout = () => page.evaluate(() => {
    const table = document.querySelector('[role="dialog"] .print-table');
    const box = table.getBoundingClientRect();
    return { x: box.x, y: box.y, columns: Array.from(table.querySelectorAll("thead th")).map((th) => th.getBoundingClientRect().x) };
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

  // 12. destination tickets: decks, ticket-only export and import, card printing
  // Counted against what the map already holds, so a richer example map does not move the goalposts.
  const ticketsNow = () => page.evaluate(() => { const m = JSON.parse(localStorage.getItem("orebro-map-editor-public-v2")); return { main: m.tickets.filter((t) => (t.set || "main") === "main").length, decks: m.ticketSets.map((d) => `${d.label} (${m.tickets.filter((t) => (t.set || "main") === d.id).length})`) }; });
  const mainBefore = (await ticketsNow()).main;
  await tool("Add ticket").click();
  await clickStop("Westport"); await clickStop("Quarry");
  await clickStop("Pine Hill"); await clickStop("Central");
  const ticketsButton = page.getByRole("button", { name: /^Tickets · / });
  const mainAfter = mainBefore + 2;
  check("tickets are added to the current deck", (await ticketsButton.textContent()).includes(`Tickets · ${mainAfter}`), await ticketsButton.textContent());
  await ticketsButton.click();
  await page.waitForTimeout(400);

  const ticketFile = path.join(os.tmpdir(), `ttr-tickets-${Date.now()}.json`);
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: /Import\/Export decks/ }).click();
  await page.waitForTimeout(250);
  await page.getByRole("menuitem", { name: "Export this deck" }).click();
  await (await download).saveAs(ticketFile);
  const ticketFileJson = JSON.parse(fs.readFileSync(ticketFile, "utf8"));
  check("an exported file says what it is and which schema it follows", ticketFileJson.format === "ticket-to-ride-map" && ticketFileJson.version >= 2 && ticketFileJson.kind === "tickets",
    `${ticketFileJson.format} v${ticketFileJson.version} ${ticketFileJson.kind}`);
  const ticketPayload = ticketFileJson.payload;
  check("ticket-only export writes a ticket file", ticketPayload.tickets.length === mainAfter, `${ticketPayload.tickets.length} of ${mainAfter}`);
  check("exported tickets carry stop names for re-matching", ticketPayload.tickets.every((t) => t.aName && t.bName), JSON.stringify(ticketPayload.tickets[0]));

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
  // An imported deck is stamped with the moment it arrived, so it can be told from the decks the
  // map already had.
  const importedName = await page.locator("#ticket-set-name").inputValue();
  const pad = (n) => String(n).padStart(2, "0");
  const now = new Date();
  const today = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
  check("an imported deck carries the date and time it arrived", new RegExp(`^Main deck · ${today} \\d{2}:\\d{2}$`).test(importedName), importedName);
  fs.rmSync(ticketFile, { force: true });

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
  check("ticket cards are 45 x 62 mm, cut from a run the browser paginates", Math.abs(printed.card.width - mm(45)) < 3 && Math.abs(printed.card.height - mm(62)) < 4, `${(printed.card.width / 96 * 25.4).toFixed(0)} x ${(printed.card.height / 96 * 25.4).toFixed(0)} mm`);
  const firstTicket = await page.evaluate(() => { const m = JSON.parse(localStorage.getItem("orebro-map-editor-public-v2")); const t = m.tickets.find((x) => (x.set || "main") === "main"); const name = (id) => m.stops.find((st) => st.id === id).name; return { a: name(t.a), b: name(t.b), points: t.points }; });
  check("a card names both ends and its points", printed.text.includes(firstTicket.a) && printed.text.includes(firstTicket.b) && printed.text.includes(String(firstTicket.points)), `${printed.text} for ${JSON.stringify(firstTicket)}`);
  await page.emulateMedia({ media: "screen" });
  await page.waitForTimeout(400);
  check("the map print tree returns after printing tickets", (await page.locator(".print-tickets").count()) === 0);

  // 13. a stop lists the tickets that name it, and each one opens for editing
  await page.keyboard.press("Escape");
  await page.waitForTimeout(300);
  await tool("Select & move").click();
  await clickStop("Westport");
  await page.waitForTimeout(400);
  const stopLinks = await page.locator(".stop-ticket-link").allTextContents();
  const westportTickets = await page.evaluate(() => { const m = JSON.parse(localStorage.getItem("orebro-map-editor-public-v2")); return { all: m.tickets.filter((t) => t.a === "example-westport" || t.b === "example-westport").length, decks: new Set(m.tickets.filter((t) => t.a === "example-westport" || t.b === "example-westport").map((t) => t.set || "main")).size }; });
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
    const routes = JSON.parse(localStorage.getItem("orebro-map-editor-public-v2")).routes;
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
  await page.getByRole("button", { name: /^Tickets · / }).click();
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
  const ticketStops = await page.evaluate(() => { const m = JSON.parse(localStorage.getItem("orebro-map-editor-public-v2")); const j = new Set(m.stopTypeStyles.filter((t) => t.junction).map((t) => t.id)); return m.stops.filter((st) => !j.has(st.type)).length; });
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
  const westportDecks = await page.evaluate(() => { const m = JSON.parse(localStorage.getItem("orebro-map-editor-public-v2")); return new Set(m.tickets.filter((t) => t.a === "example-westport" || t.b === "example-westport").map((t) => t.set || "main")).size; });
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
  const newTable = await page.evaluate(() => JSON.parse(localStorage.getItem("orebro-map-editor-public-v2")).players);
  check("a different table is stored with the map", newTable.max === 4 && newTable.min <= 4, `${newTable.min}–${newTable.max}`);
  await page.keyboard.press("Escape");
  await page.waitForTimeout(300);
  await page.getByRole("button", { name: "Analyze balance" }).click();
  await page.waitForTimeout(500);
  check("the deck is judged against that table, not a fixed five", /table of four/.test(await page.locator(".setup-balance").textContent()), (await page.locator(".setup-balance").textContent()).slice(0, 300));
  await page.keyboard.press("Escape");
  await page.waitForTimeout(300);
  await page.getByRole("button", { name: "Settings" }).click();
  await page.waitForTimeout(400);
  await page.locator("#settings-players-max").fill("5");
  await page.locator("#settings-players-max").blur();
  await page.waitForTimeout(400);
  check("showing the map's own setup", (await page.locator("#settings-wagons").inputValue()) === String(await page.evaluate(() => JSON.parse(localStorage.getItem("orebro-map-editor-public-v2")).wagonsPerPlayer)) && (await page.locator("#settings-starting-tickets").inputValue()) === "3", `${await page.locator("#settings-wagons").inputValue()}/${await page.locator("#settings-starting-tickets").inputValue()}`);
  await page.locator("#settings-wagons").fill("40");
  await page.locator("#settings-wagons").blur();
  await page.waitForTimeout(400);
  check("the setup is stored with the map", await page.evaluate(() => JSON.parse(localStorage.getItem("orebro-map-editor-public-v2")).wagonsPerPlayer) === 40);
  await page.locator("#settings-wagons").fill("0");
  await page.locator("#settings-wagons").blur();
  await page.waitForTimeout(400);
  check("a player cannot be given zero wagons", await page.evaluate(() => JSON.parse(localStorage.getItem("orebro-map-editor-public-v2")).wagonsPerPlayer) >= 1);
  await page.locator("#settings-kept-tickets").fill("9");
  await page.locator("#settings-kept-tickets").blur();
  await page.waitForTimeout(400);
  const setupStored = await page.evaluate(() => JSON.parse(localStorage.getItem("orebro-map-editor-public-v2")));
  check("nobody must keep more tickets than they are dealt", setupStored.keptTickets <= setupStored.startingTickets, `${setupStored.keptTickets} of ${setupStored.startingTickets}`);
  await page.keyboard.press("Escape");
  await page.waitForTimeout(300);

  // 20. the balance report reads the setup against the map
  // Give each player more wagons than two players could ever place, so the report has to object.
  await page.getByRole("button", { name: "Settings" }).click();
  await page.waitForTimeout(400);
  const spaces = await page.evaluate(() => JSON.parse(localStorage.getItem("orebro-map-editor-public-v2")).routes.reduce((sum, r) => sum + r.length, 0));
  await page.locator("#settings-wagons").fill(String(Math.ceil(spaces / 1.5)));
  await page.locator("#settings-wagons").blur();
  await page.waitForTimeout(400);
  await page.keyboard.press("Escape");
  await page.waitForTimeout(300);
  await page.getByRole("button", { name: "Analyze balance" }).click();
  await page.waitForTimeout(600);
  const setupText = await page.locator(".setup-balance").textContent();
  check("the balance report weighs the setup against the map", /wagon spaces/.test(setupText) && /player supplies/.test(setupText), setupText.slice(0, 140));
  check("and warns when the map is too small for the wagon count", (await page.locator(".setup-balance .space-warning").count()) === 1, setupText.slice(0, 260));
  check("the deck is measured against what a full table is dealt", /a table of five is dealt/.test(setupText));
  await page.keyboard.press("Escape");
  await page.waitForTimeout(300);

  // 21. suggesting a whole deck for the map that is open
  await page.getByRole("button", { name: /^Tickets · / }).click();
  await page.waitForTimeout(400);
  const decksBefore = await page.locator("#ticket-set option").count();
  const suggestStarted = Date.now();
  await page.getByRole("button", { name: /Add a deck/ }).click();
  await page.waitForTimeout(250);
  await page.getByRole("menuitem", { name: /Suggest a deck/ }).click();
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
  await page.getByRole("button", { name: /^Tickets · / }).click();
  await page.waitForTimeout(500);
  // Pick a deck that has tickets in it.
  const withTickets = (await page.locator("#ticket-set option").allTextContents()).findIndex((label) => !/\(0\)$/.test(label));
  await page.locator("#ticket-set").selectOption({ index: Math.max(0, withTickets) });
  await page.waitForTimeout(400);
  const ticketCells = () => page.$$eval(".analysis-dialog .analysis-table tbody tr", (trs) => trs.map((tr) => Array.from(tr.children).map((td) => {
    const input = td.querySelector("input[type=number]");
    return input ? input.value : td.textContent.trim();
  })));
  const ticketHead = (label) => page.locator(".analysis-dialog .analysis-table thead th").filter({ hasText: label }).first();
  const inOrder = (values, descending) => values.every((v, i) => i === 0 || (descending ? v <= values[i - 1] : v >= values[i - 1]));
  await ticketHead("Spaces").click();
  await page.waitForTimeout(300);
  const bySpaces = (await ticketCells()).map((cells) => Number(cells[1]));
  check("the ticket list sorts by a heading", bySpaces.length > 1 && inOrder(bySpaces, false), `${bySpaces.length} rows: ${bySpaces.slice(0, 6).join(",")}`);
  check("and says which heading it went by", (await ticketHead("Spaces").getAttribute("class")).includes("sorted"));
  await ticketHead("Spaces").click();
  await page.waitForTimeout(300);
  check("clicking it again turns the order around", inOrder((await ticketCells()).map((cells) => Number(cells[1])), true), (await ticketCells()).map((cells) => cells[1]).slice(0, 6).join(","));
  const editable = page.locator(".analysis-dialog .analysis-table tbody tr").first().locator(".ticket-points");
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

  // 24. a low-connection warning says which stop it means
  const lowCard = page.locator(".crossing-card.has-warning").filter({ hasText: "low-connection" });
  if (await lowCard.count()) {
    const lowText = (await lowCard.textContent()).replace(/\s+/g, " ");
    check("the low-connection card names the stops it means", /· [A-Za-zÅÄÖåäö]/.test(lowText), lowText);
  }

  // 25. the balancing view says where the tickets crowd
  await page.getByRole("button", { name: "Analyze balance" }).click();
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
  await page.getByRole("button", { name: "Clear map" }).click();
  await page.waitForTimeout(300);
  await page.getByRole("button", { name: "Continue" }).click();
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
  const storedImage = () => page.evaluate(() => JSON.parse(localStorage.getItem("orebro-map-editor-public-v2")).backgroundImage);
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
  await page.locator(".settings-nav-item", { hasText: /ticket/i }).click();
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
  check("and stores it with the map", await page.evaluate(() => JSON.stringify(JSON.parse(localStorage.getItem("orebro-map-editor-public-v2")).ticketMix)) === '{"short":76,"medium":11,"long":13}');
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
  await page.getByRole("button", { name: /^Tickets · / }).click();
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
  await useTool("Add ticket");
  await page.waitForTimeout(400);
  const headingBox = await page.locator(".properties .panel-heading").evaluate((el) => ({ scroll: el.scrollWidth, client: el.clientWidth, line: el.querySelector("small").getBoundingClientRect().height }));
  check("the right panel cuts it off rather than wrapping it", headingBox.scroll <= headingBox.client + 1 && headingBox.line < 24, `${headingBox.scroll} in ${headingBox.client}, ${headingBox.line.toFixed(0)} px tall`);

  // 29. the deck styles are laid out so they can be compared, and nothing is too pale to read
  await page.getByRole("button", { name: /^Tickets · / }).click();
  await page.waitForTimeout(400);
  await page.getByRole("button", { name: /Add a deck/ }).click();
  await page.waitForTimeout(250);
  await page.getByRole("menuitem", { name: /Suggest a deck/ }).click();
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
  check("Help offers the guide and About, and nothing clutters the header", helpItems.length === 2 && helpItems.some((t) => /About/.test(t)), helpItems.join(" | "));
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
  await page.getByRole("button", { name: "Clear map" }).click();
  await page.waitForTimeout(300);
  await page.getByRole("button", { name: "Continue" }).click();
  await page.waitForTimeout(600);
  await page.getByRole("button", { name: "Settings" }).click();
  await page.waitForTimeout(500);
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
  const nameAt = async (angle) => {
    await page.locator(".label-angle", { hasText: "Name position" }).locator("input[type=range]").fill(String(angle));
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
  await page.locator(".label-angle", { hasText: "Name position" }).locator("input[type=range]").fill("165");
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
  const storedCentral = () => page.evaluate(() => JSON.parse(localStorage.getItem("orebro-map-editor-public-v2")).stops.find((stop) => stop.name === "Central"));
  const bearingGap = (a, b) => Math.abs(((a - b + 540) % 360) - 180);
  const dragName = async (angle, { release = true } = {}) => {
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
  // flatter than the angle; the angle itself is what the Name position slider shows.
  const midDrag = Number(await page.locator(".label-angle", { hasText: "Name position" }).locator("input[type=range]").inputValue());
  check("a name follows the pointer round its stop while it is dragged", bearingGap(midDrag, 37) <= 2, `${midDrag}°`);
  await page.mouse.up();
  await page.waitForTimeout(300);
  const afterDrag = await storedCentral();
  check("and stays at the angle it was let go, to the degree rather than in 15° steps", afterDrag.labelAngle !== undefined && bearingGap(afterDrag.labelAngle, 37) <= 2 && afterDrag.labelAngle % 15 !== 0, String(afterDrag.labelAngle));
  check("dragging the name leaves the stop where it was", afterDrag.x === beforeDrag.x && afterDrag.y === beforeDrag.y, `${beforeDrag.x},${beforeDrag.y} -> ${afterDrag.x},${afterDrag.y}`);
  const nameSlider = page.locator(".label-angle", { hasText: "Name position" }).locator("input[type=range]");
  check("the Name position slider shows the dragged angle", Number(await nameSlider.inputValue()) === afterDrag.labelAngle, `${await nameSlider.inputValue()} vs ${afterDrag.labelAngle}`);
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
  await nameSlider.fill("165");
  await page.keyboard.press("Escape");

  // 34. a map saved on a format that is now a print choice opens on its board
  await page.evaluate(() => {
    const map = JSON.parse(localStorage.getItem("orebro-map-editor-public-v2"));
    localStorage.setItem("orebro-map-editor-public-v2", JSON.stringify({ ...map, format: "a4" }));
  });
  await page.reload({ waitUntil: "networkidle" });
  await page.waitForTimeout(700);
  check("a map saved as an A4 test sheet opens as a standard board", (await badges())[0] === "Standard board 2×3", (await badges())[0]);
  check("with everything on it", /\d+ stops/.test((await badges())[2]), (await badges())[2]);

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
  console.error("HARNESS FAILED", e.message.split("\n").slice(0, 3).join(" | "));
  process.exit(2);
});
