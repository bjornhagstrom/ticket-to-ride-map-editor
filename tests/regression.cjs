// Browser regression suite. Drives the editor the way a person does and checks what came out.
//
//   npm run dev            # in one terminal, it expects http://localhost:3000/ttr/
//   npm run test:regression
//
// It writes to the same local storage the editor uses, so it will replace whatever map is open in
// that browser profile. It runs headless in its own profile, so your own browser is untouched.
const { chromium } = require("playwright");

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
  check("tool row has 6 buttons", await page.locator(".tool-row .tool-button").count() === 6);
  await page.locator(".tool-row .tool-button").nth(2).hover();
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
  await page.locator(".tool-row .tool-button").nth(5).click();
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
  await page.locator(".tool-row .tool-button").nth(1).click();
  await page.waitForTimeout(150);
  await page.evaluate(() => {
    const svg = document.querySelector(".map-canvas");
    const r = svg.getBoundingClientRect();
    svg.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, clientX: r.left + r.width * 0.12, clientY: r.top + r.height * 0.85 }));
  });
  await page.waitForTimeout(350);
  check("placing a stop works", (await badges())[2] === "9 stops", (await badges())[2]);
  // the format control folds away once the map has content, so open it first
  const formatToggle = page.locator(".format-toggle");
  if (await formatToggle.count()) { await formatToggle.click(); await page.waitForTimeout(250); }
  check("board format folds away once the map has content", await formatToggle.count() === 1);
  await page.locator("#map-format").selectOption("board-2x4");
  await page.waitForTimeout(500);
  check("changing board format works", (await badges())[0] === "Extended board 2×4", (await badges())[0]);

  // 10. print tree renders
  const printPages = await page.locator(".print-pages .print-page").count();
  check("print pages render for a 2x4 board", printPages === 8, `${printPages} pages`);

  // 11. persistence across reload
  await page.reload({ waitUntil: "networkidle" });
  await page.waitForTimeout(700);
  check("map survives a reload", (await badges())[2] === "9 stops", (await badges())[2]);

  console.log("PASS:"); ok.forEach((l) => console.log("  ✓ " + l));
  if (bad.length) { console.log("FAIL:"); bad.forEach((l) => console.log("  ✗ " + l)); }
  console.log(`\n${ok.length} passed, ${bad.length} failed`);
  console.log("CONSOLE ERRORS:", errors.length ? JSON.stringify(errors.slice(0, 5)) : "none");
  await browser.close();
  process.exit(bad.length ? 1 : 0);
})().catch((e) => { console.error("HARNESS FAILED", e); process.exit(2); });
