// What must happen to the tickets of the decks that stay when an import replaces the stops. Written before
// the code. A ticket end is fine when the stop is still there with the same id and the same name; any other
// end is flagged, grouped by the old stop, so that the person chooses once per stop which new stop it is, or
// that its tickets go.
//
//   npm run test:ticket-rebind
const { execFileSync } = require("child_process");
const fs = require("fs");
const os = require("os");
const path = require("path");

const root = path.join(__dirname, "..");
const out = fs.mkdtempSync(path.join(os.tmpdir(), "ttr-rebind-"));
execFileSync(path.join(root, "node_modules", ".bin", "tsc"), ["app/ticket-rebind.ts", "--outDir", out, "--module", "commonjs", "--target", "es2022", "--moduleResolution", "node", "--skipLibCheck", "--lib", "es2022,dom"], { cwd: root, stdio: "inherit" });
const { planRebind, applyRebind } = require(path.join(out, "ticket-rebind.js"));

const ok = [];
const bad = [];
const check = (label, pass, detail = "") => { (pass ? ok : bad).push(`${label}${detail ? " — " + detail : ""}`); };
const stop = (id, name) => ({ id, name, type: "city", x: 0, y: 0 });
const ticket = (id, a, b, extra = {}) => ({ id, a, b, points: 5, ...extra });
const choices = (o) => new Map(Object.entries(o));
const clone = (value) => JSON.parse(JSON.stringify(value));

const before = [stop("a", "Alpha"), stop("b", "Beta"), stop("c", "Gamma"), stop("d", "Delta")];

// ---------------------------------------------------------------- what is fine
{
  const after = [stop("a", "Alpha"), stop("b", "  beta "), stop("c", "GAMMA"), stop("d", "Delta")];
  const plan = planRebind(before, after, [ticket("t1", "a", "b"), ticket("t2", "c", "d")]);
  check("tickets whose stops are all still there under the same names are left alone", plan.length === 0, JSON.stringify(plan));
  check("a name that differs only in case or spaces is the same name", plan.length === 0);
}

// ---------------------------------------------------------------- a stop that is gone
{
  const after = [stop("a", "Alpha"), stop("n-1", "Beta"), stop("n-2", "Gamma")];
  const plan = planRebind(before, after, [ticket("t1", "a", "b"), ticket("t2", "b", "c"), ticket("t3", "a", "d")]);
  const byOld = Object.fromEntries(plan.map((g) => [g.oldId, g]));
  check("a stop whose id is gone is flagged as missing, once, with how many tickets name it", byOld.b && byOld.b.status === "missing" && byOld.b.tickets === 2, JSON.stringify(plan));
  check("a new stop with the same name is suggested", byOld.b.suggested === "n-1" && byOld.c.suggested === "n-2");
  check("no suggestion when no new stop has the name", byOld.d && byOld.d.suggested === null && byOld.d.status === "missing");
  check("the stops that are fine are not listed", !byOld.a);
  check("the old name is kept for the list, so the person sees what was meant", byOld.b.oldName === "Beta" && byOld.d.oldName === "Delta");
  check("the groups come most tickets first", plan[0].oldId === "b");
}

// ---------------------------------------------------------------- an id that now means another stop
{
  const after = [stop("a", "Alpha"), stop("b", "Eastgate"), stop("n-9", "Beta"), stop("c", "Gamma"), stop("d", "Delta")];
  const plan = planRebind(before, after, [ticket("t1", "a", "b")]);
  check("an id that exists but with another name is flagged as changed, not as fine", plan.length === 1 && plan[0].status === "changed" && plan[0].oldId === "b", JSON.stringify(plan));
  check("it says what the id means now, and suggests the stop that has the old name, not the colliding one", plan[0].newName === "Eastgate" && plan[0].suggested === "n-9");
}

// ---------------------------------------------------------------- a name that is not unique
{
  const after = [stop("a", "Alpha"), stop("n-1", "Beta"), stop("n-2", "Beta"), stop("c", "Gamma"), stop("d", "Delta")];
  const plan = planRebind(before, after, [ticket("t1", "a", "b")]);
  check("when two new stops have the name, nothing is suggested: the person decides", plan.length === 1 && plan[0].suggested === null);
}

// ---------------------------------------------------------------- both ends of one ticket
{
  const after = [stop("a", "Alpha"), stop("n-1", "Beta"), stop("n-2", "Gamma")];
  const tickets = [ticket("t1", "b", "c")];
  const plan = planRebind(before, after, tickets);
  check("a ticket with both ends flagged counts in both groups", plan.length === 2 && plan.every((g) => g.tickets === 1));
  const done = applyRebind(tickets, choices({ b: "n-1", c: "n-2" }));
  check("and both ends are moved", done.tickets.length === 1 && done.tickets[0].a === "n-1" && done.tickets[0].b === "n-2" && done.moved === 1 && done.removed === 0, JSON.stringify(done));
}

// ---------------------------------------------------------------- applying the choices
{
  const tickets = [ticket("t1", "a", "b", { set: "main", points: 7, long: true }), ticket("t2", "b", "c"), ticket("t3", "c", "d"), ticket("t4", "a", "c")];
  const snapshot = clone(tickets);
  const done = applyRebind(tickets, choices({ b: "n-1", c: null }));
  check("a ticket whose stop is sent to a new stop follows it, and keeps its points, deck and long mark", done.tickets.find((t) => t.id === "t1" && t.a === "a" && t.b === "n-1" && t.points === 7 && t.set === "main" && t.long === true) !== undefined, JSON.stringify(done.tickets));
  check("a ticket whose stop is removed goes, whichever end it was", !done.tickets.some((t) => ["t2", "t3", "t4"].includes(t.id)) && done.removed === 3, JSON.stringify(done));
  check("the count of moved and removed adds up", done.moved === 1 && done.moved + done.removed === 4);
  check("the tickets given are not changed", JSON.stringify(tickets) === JSON.stringify(snapshot));
  const same = applyRebind([ticket("t5", "b", "a")], choices({ b: "a" }));
  check("a ticket that would run from a stop to itself is removed, and counted", same.tickets.length === 0 && same.removed === 1, JSON.stringify(same));
  const untouched = applyRebind([ticket("t6", "a", "d")], choices({}));
  check("with no choices nothing changes", untouched.tickets.length === 1 && untouched.moved === 0 && untouched.removed === 0);
}

// ---------------------------------------------------------------- odd input
{
  const dangling = planRebind(before, [stop("a", "Alpha")], [ticket("t1", "a", "ghost")]);
  check("a ticket that named a stop the old map never had is flagged too, by its id", dangling.length === 1 && dangling[0].oldId === "ghost" && dangling[0].status === "missing" && dangling[0].oldName === "ghost", JSON.stringify(dangling));
  check("nothing to plan for no tickets; with no stops at all, a ticket's two ends are both flagged, by their ids", planRebind(before, [], []).length === 0 && planRebind([], [], [ticket("t", "a", "b")]).length === 2);
  const proto = planRebind(before, [stop("a", "Alpha")], [ticket("t1", "a", "__proto__")]);
  check("an id such as __proto__ is only an id", proto.length === 1 && proto[0].oldId === "__proto__" && ({}).polluted === undefined);
  const choose = applyRebind([ticket("t1", "__proto__", "b")], new Map([["__proto__", "a"]]));
  check("and a choice for it works as for any other", choose.tickets.length === 1 && choose.tickets[0].a === "a" && choose.tickets[0].b === "b" && choose.moved === 1, JSON.stringify(choose));
}

for (const line of ok) console.log(`  ok    ${line}`);
for (const line of bad) console.log(`  FAIL  ${line}`);
console.log(`\n${ok.length} passed, ${bad.length} failed`);
fs.rmSync(out, { recursive: true, force: true });
process.exit(bad.length ? 1 : 0);
