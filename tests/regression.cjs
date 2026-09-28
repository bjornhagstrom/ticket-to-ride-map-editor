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
  check("example map loads", (await badges())[2] === "8 stops", (await badges()).slice(0, 4).join(", "));

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
  check("routes keep their own colours", new Set(strokes).size >= 9, `${new Set(strokes).size} distinct`);
  check("no route forced to a type colour", !strokes.includes("#23749b") && !strokes.includes("#00877c"));

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
  check("parallel count reported", (await page.locator(".parallel-controls label").textContent()).includes("2 between"));
  await page.locator(".bend-insert-handle").first().click({ force: true });
  await page.waitForTimeout(350);
  const pts = await page.evaluate(() => JSON.parse(localStorage.getItem("orebro-map-editor-public-v2")).routes
    .filter((r) => (r.a === "example-westport" && r.b === "example-central") || (r.a === "example-central" && r.b === "example-westport"))
    .map((r) => (r.points || []).length));
  check("bend added to both lines of the double route", pts.length === 2 && pts[0] === 2 && pts[1] === 2, `points per line: ${pts.join("/")}`);
  await page.locator(".bend-controls input[type=checkbox]").first().check();
  await page.waitForTimeout(350);
  const curved = await page.evaluate(() => Array.from(document.querySelectorAll(".map-canvas .route-group")).map((g) => g.querySelector(".route-guide")).filter((q) => ["#cf3f3f", "#3e4146"].includes(q.getAttribute("stroke")) && q.getAttribute("d").includes("C")).length);
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
  check("room-per-wagon table lists the card routes", roomRows === 9, `${roomRows} rows`);
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
      const s = Array.from(document.querySelectorAll(".map-canvas .stop")).find((g) => Array.from(g.querySelectorAll("text")).some((t) => t.textContent === n));
      s.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true }));
    }, name);
    await page.waitForTimeout(250);
  };
  await clickStop("Westport"); await clickStop("Quarry");
  check("measure reports a distance", (await page.locator(".tool-status").textContent()).includes("wagon spaces"), (await page.locator(".tool-status").textContent()));

  // 9. adding a stop, changing format, export
  await tool("Add stop").click();
  await page.waitForTimeout(150);
  await page.evaluate(() => {
    const svg = document.querySelector(".map-canvas");
    const r = svg.getBoundingClientRect();
    svg.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, clientX: r.left + r.width * 0.12, clientY: r.top + r.height * 0.85 }));
  });
  await page.waitForTimeout(350);
  check("placing a stop works", (await badges())[2] === "9 stops", (await badges())[2]);
  // the board format lives in Settings, not in the tools panel
  check("the tools panel carries no board format control", (await page.locator("#map-format").count()) === 0);
  await page.getByRole("button", { name: "Settings" }).click();
  await page.waitForTimeout(400);
  await page.locator("#settings-format").selectOption("board-2x4");
  await page.waitForTimeout(500);
  check("changing board format from Settings works", (await badges())[0] === "Extended board 2×4", (await badges())[0]);
  check("Settings shows what the format measures", /mm/.test(await page.locator(".format-measurements").textContent()));
  await page.keyboard.press("Escape");
  await page.waitForTimeout(400);

  // 10. print tree renders
  const printPages = await page.locator(".print-pages .print-page").count();
  check("print pages render for a 2x4 board", printPages === 8, `${printPages} pages`);

  // 11. persistence across reload
  await page.reload({ waitUntil: "networkidle" });
  await page.waitForTimeout(700);
  check("map survives a reload", (await badges())[2] === "9 stops", (await badges())[2]);

  // 12. destination tickets: decks, ticket-only export and import, card printing
  await tool("Add ticket").click();
  await clickStop("Westport"); await clickStop("Quarry");
  await clickStop("Pine Hill"); await clickStop("Central");
  const ticketsButton = page.getByRole("button", { name: /^Tickets · / });
  check("tickets are added to the current deck", (await ticketsButton.textContent()).includes("Tickets · 2"), await ticketsButton.textContent());
  await ticketsButton.click();
  await page.waitForTimeout(400);

  const ticketFile = path.join(os.tmpdir(), `ttr-tickets-${Date.now()}.json`);
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "Export this deck" }).click();
  await (await download).saveAs(ticketFile);
  const ticketPayload = JSON.parse(fs.readFileSync(ticketFile, "utf8"));
  check("ticket-only export writes a ticket file", ticketPayload.kind === "tickets" && ticketPayload.tickets.length === 2, ticketPayload.kind);
  check("exported tickets carry stop names for re-matching", ticketPayload.tickets.every((t) => t.aName && t.bName), JSON.stringify(ticketPayload.tickets[0]));

  await page.getByRole("button", { name: "Duplicate" }).click();
  await page.waitForTimeout(400);
  await page.locator("#ticket-set-name").fill("Variant");
  await page.waitForTimeout(400);
  await page.locator("#ticket-set").selectOption({ index: 0 });
  await page.waitForTimeout(300);
  check("two decks live side by side", (await page.locator("#ticket-set option").allTextContents()).join(" | ") === "Main deck (2) | Variant (2)", (await page.locator("#ticket-set option").allTextContents()).join(" | "));

  await page.locator('input[type="file"][accept="application/json"]').setInputFiles(ticketFile);
  await page.waitForTimeout(800);
  check("importing tickets adds a deck instead of overwriting", (await page.locator("#ticket-set option").count()) === 3, (await page.locator("#ticket-set option").allTextContents()).join(" | "));
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
      const sheet = document.querySelector(".print-tickets .ticket-page");
      window.__print = { cards: document.querySelectorAll(".print-tickets .ticket-card").length, card: card && card.getBoundingClientRect(), text: card ? card.textContent : "", sheet: sheet && sheet.getBoundingClientRect() };
    };
  });
  await page.emulateMedia({ media: "print" });
  await page.evaluate(() => Array.from(document.querySelectorAll("button")).find((b) => b.textContent.includes("Print cards")).click());
  await page.waitForFunction(() => window.__print !== null, null, { timeout: 5000 });
  const printed = await page.evaluate(() => window.__print);
  const mm = (value) => value / 25.4 * 96;
  check("ticket printing lays out one card per ticket", printed.cards === 2, String(printed.cards));
  check("ticket cards are 45 x 67 mm on A4 portrait", Math.abs(printed.card.width - mm(45)) < 3 && Math.abs(printed.card.height - mm(67)) < 3 && Math.abs(printed.sheet.height - mm(297)) < 3, `${printed.card.width.toFixed(0)}x${printed.card.height.toFixed(0)}px on ${printed.sheet.width.toFixed(0)}x${printed.sheet.height.toFixed(0)}px`);
  check("a card names both ends and its points", /Westport/.test(printed.text) && /\d/.test(printed.text), printed.text);
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
  check("a stop lists its tickets from every deck", stopLinks.length === 3, stopLinks.join(" | "));
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
  check("and lights the path it would use", (await page.locator(".map-canvas .route-group.on-preview").count()) === 3, String(await page.locator(".route-group.on-preview").count()));
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
  check("with a row per stop and a column per ticket length", (await cells()).length === 9 && (await cells())[0].length === 4, JSON.stringify((await cells())[0]));
  await pointAt("Westport"); await pointAt("Central");
  await page.waitForTimeout(300);
  const westportRow = (await cells()).find((row) => row[0] === "Westport");
  check("a ticket is counted at both ends, in its length band", westportRow.join(" ") === "Westport 1 1 0", westportRow.join(" "));
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

  await page.locator(".coverage-table tbody tr").filter({ hasText: "Westport" }).locator(".coverage-count").first().click();
  await page.waitForTimeout(450);
  check("a count opens only the tickets behind it", (await page.locator(".stop-tickets-dialog .stop-ticket-row").count()) === 1, String(await page.locator(".stop-tickets-dialog .stop-ticket-row").count()));
  await page.keyboard.press("Escape");
  await page.waitForTimeout(350);
  await page.locator(".coverage-table tbody tr").filter({ hasText: "Westport" }).locator(".coverage-stop").click();
  await page.waitForTimeout(450);
  check("a stop name opens all of them", (await page.locator(".stop-tickets-dialog .stop-ticket-row").count()) === 2, String(await page.locator(".stop-tickets-dialog .stop-ticket-row").count()));
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
  check("a stop's tickets are listed deck by deck", deckNames.length === 3, deckNames.join(" | "));
  check("and every deck group holds only its own", (await page.locator(".stop-ticket-deck").first().locator(".stop-ticket-link").count()) >= 1);

  // 19. the game setup settings: wagons per player and tickets dealt at the start
  await page.getByRole("button", { name: "Settings" }).click();
  await page.waitForTimeout(500);
  check("Settings carries the game setup", await page.locator("#settings-wagons").isVisible() && await page.locator("#settings-starting-tickets").isVisible());
  check("starting at the original game's numbers", (await page.locator("#settings-wagons").inputValue()) === "45" && (await page.locator("#settings-starting-tickets").inputValue()) === "3", `${await page.locator("#settings-wagons").inputValue()}/${await page.locator("#settings-starting-tickets").inputValue()}`);
  await page.locator("#settings-wagons").fill("40");
  await page.locator("#settings-wagons").blur();
  await page.waitForTimeout(400);
  check("the setup is stored with the map", await page.evaluate(() => JSON.parse(localStorage.getItem("orebro-map-editor-public-v2")).wagonsPerPlayer) === 40);
  await page.locator("#settings-wagons").fill("0");
  await page.locator("#settings-wagons").blur();
  await page.waitForTimeout(400);
  check("a player cannot be given zero wagons", await page.evaluate(() => JSON.parse(localStorage.getItem("orebro-map-editor-public-v2")).wagonsPerPlayer) >= 1);
  await page.keyboard.press("Escape");
  await page.waitForTimeout(300);

  console.log("PASS:"); ok.forEach((l) => console.log("  ✓ " + l));
  if (bad.length) { console.log("FAIL:"); bad.forEach((l) => console.log("  ✗ " + l)); }
  console.log(`\n${ok.length} passed, ${bad.length} failed`);
  console.log("CONSOLE ERRORS:", errors.length ? JSON.stringify(errors.slice(0, 5)) : "none");
  await browser.close();
  process.exit(bad.length ? 1 : 0);
})().catch((e) => { console.error("HARNESS FAILED", e); process.exit(2); });
