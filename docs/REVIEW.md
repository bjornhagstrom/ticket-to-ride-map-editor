# Code review: when, how, and what is looked for

A second pair of eyes on the code, by an agent that knows this project's rules (`ttr-reviewer`, defined
in `.claude/agents/`, which is kept out of the repository like AGENTS.md; this page is its checklist and
is read by it). It **reads and reports; it never edits, runs the app, publishes or contacts anything**, and
a hook enforces that for shell commands. Its findings are claims to check, not facts: whoever asked for the
review reads each one against the code before changing anything, and says which were right.

## What the design rests on

Researched on 2026-10-06; each choice below has a reason from somewhere. Sources at the end.

- **A fresh context, and not the author's.** A reviewer that sees only the diff and the criteria judges the
  result on its own terms; one that has the author's reasoning goes along with it. In a test with 150 planted
  errors a review in a fresh session found more than a second pass in the same session, and a fresh
  subagent that was handed the generation prompt did worse than one that got the artefact alone. So the
  reviewer is given **what the change must do and the diff, not why the author thinks it is right.**
- **Not the author's own model.** A model that reviews code written in its own style rates it too kindly,
  and can state the rule it then breaks. The author of most of this repository's code is Claude Sonnet; the
  reviewer is set to a different, stronger model (`opus`), and the owner's `/code-review ultra` is a third
  opinion when it matters.
- **Precision, but not at the cost of what is missed.** A reviewer told to find gaps will report some even
  when the work is sound, and chasing every one of them leads to over-engineering. Anthropic's own review
  plugin scores each finding 0 to 100 and reports only those from 80. But when an agent reads first, a
  missed defect is the dearer mistake, and the highest-precision tools in one benchmark ranked fourth
  because they missed too much. So: findings from 75 up are reported as findings, findings from 50 to 74 go
  on a short, separate "uncertain" list (at most five), and under 50 is dropped.
- **Evidence for every claim.** Meta's work on structured prompts (premises, traced execution, a conclusion
  that follows from them) took reviewing accuracy from 86 to 93 per cent, at about three times the tokens.
  So each finding carries the trace (the path through the code that ends in the wrong result), and a finding
  without one is not made.
- **The checklist is the source of truth.** G-Research's reviewer validates every finding against an index of
  rules and rejects invented ones. Here each finding names the checklist item it is under (1 to 9 below), or
  says it is a correctness fault; "this seems bad" is not a rule.
- **A second look at what blocks.** A fresh model trying to *refute* a finding is the cheapest check
  there is. Every BLOCKER is given to a new `ttr-reviewer` run with only the claim and the code, asked to
  disprove it, before anyone acts.
- **Small enough to read.** Defect finding falls off after a few hundred changed lines. Reviewers read whole
  files and tests, not only the diff (a missing case is usually outside it), but each is given a share of no
  more than about 600 changed lines.
- **A person decides.** The reviewer prepares; the owner authorises what leaves the machine, as always.
- **It is tested.** `tests/review-seeds/` holds six planted defects and one decoy; the reviewer is
  run on them when its prompt or model changes, and must find the BLOCKERs and most of the rest without
  flagging the decoy (the same way G-Research asserts recall for what must be found and precision overall).
- **It learns from what it got wrong.** Findings that were judged wrong are written under "Findings that were
  wrong" below, with the reason, so that the checklist grows the right exclusions.

## When

| When | What is reviewed | Who asks |
| --- | --- | --- |
| Before work is merged into `main`, when it is more than a small change: a feature, a change to what is written or read, anything in the suggester or the analysis | `git diff main...<branch>` | the agent doing the work, as a step of the merge tier (`docs/TESTING.md`) |
| **Before every release**, before the owner is asked for the go to push | everything since the last release: `git diff origin/main...main` while `origin/main` is the last release, otherwise from the last release's commit | the agent preparing the release |
| When the owner asks | whatever they name | the owner |

The built-in reviews are in addition, not instead: `/code-review` for bugs in the diff (and `/code-review
ultra`, which the owner starts, is the deep one in the cloud, billed), and `/security-review` for what
touches files, import, downloads and storage. This reviewer is about the project's own rules, which they do
not know.

## How

For a branch, ask `ttr-reviewer` to review `git diff main...<branch>`, and say **what the change must do**
in a line or two, as a requirement and not as a defence. For a release the diff is split into areas, each
reviewed by its own `ttr-reviewer` at the same time (they only read, so they do not get in each other's
way), and the findings are put together by the one who asked. On 2026-10-06 the diff since 0.4.1 was about
900 lines of code, 1,470 of tests and 380 of documents, so:

| Reviewer | Paths | Looks mostly for |
| --- | --- | --- |
| Logic and files | `app/ticket-suggester*.ts`, `app/map-analysis.ts`, `app/ticket-valuation.ts`, `app/map-geometry.ts`, `app/use-ticket-suggestion.ts`, `app/map-data.ts`, `app/map-storage.ts`, `app/csv-*.ts`, `app/ttr-map-generator-export.ts`, `app/board.ts` | items 1, 2, 3, 8 |
| Screens | `app/*.tsx` (except `about/` and `whats-new/`), `app/*.css`, `components/` | items 3, 6, 7 |
| Tests and scripts | `tests/`, `scripts/`, `package.json` | item 4: does each check fail without the change, and does it check what it should |
| Documents and notes | `docs/`, `README.md`, `BACKLOG.md`, `CHANGELOG.md`, `app/version.ts`, `app/about/`, `app/whats-new/` | items 2 (the contract in `docs/FILE-FORMAT.md`), 5 |

Past about 600 changed lines in a share, split it by files. Each reviewer is given the diff command for its
paths (`git diff <base>...<head> -- <paths>`), what the work must do, and nothing else; it reads the rest itself.

## What is looked for

In this order, most important first. Each is a question with a concrete way to look.

1. **Correctness.** Does the changed code do what it says, in the cases around the ones tested? Edge cases:
   an empty map, one stop, a map with no tickets, two to five players, a standing board, a map from an
   older file. Arithmetic on units (board units, millimetres, centimetres), off-by-ones, state that is read
   after it has changed, a branch that is never reached.
2. **Files and compatibility.** AGENTS.md: a change to what the editor writes or reads (map, network,
   background and ticket files, CSV, the envelope: a field renamed, removed or given another meaning, a
   migration, a version bump) is checked with the owner *before* it is built. An addition (a new optional
   field) needs its name, place, what an older build does with it and how it can grow thought through, and
   is in `docs/FILE-FORMAT.md` in the same change, with a test that reads a real older file
   (`tests/file-format.cjs`). Look for a field whose meaning changed quietly, a default that changed for old
   files, and a file an older build would now corrupt on a round trip.
3. **Privacy and the outside.** Nothing is loaded from, or sent to, another site before someone asks for
   it (the tour video loads from YouTube only on play; the one exception, a connection opened when the picture is pointed at, is the owner's decision of 2026-10-06 in `docs/DECISIONS.md`); no cookies, no analytics, no account names, hosts,
   ports or keys in the repository or in `out/`; no names from the private reference data in `out/`
   (`docs/DEPLOYMENT.md`, "Safe publication procedure", step 2). Nothing in the code or the scripts
   publishes, pushes or messages anyone.
4. **Tests.** Is each new behaviour covered by a check that fails without it? Is a test written to match
   what the code does rather than what it should? Does a changed expectation say why? Is something
   untested that the change makes risky (an edge case, a second browser)?
5. **The project's habits** (AGENTS.md):
   - a note in `UNRELEASED` (or in the unreleased version's notes) for every change a user would notice,
     in plain words, in the same commit;
   - `BACKLOG.md` updated in the same commit as work on its items;
   - tests designed before the feature; the right test tier run and said so;
   - no commit of AGENTS.md, CLAUDE.md, `.claude/`, `.openai/`, or the owner's HEIC photos.
6. **Screens and access.** Text contrast 7:1 or better (the suite measures it); every control reachable by
   keyboard and named for a screen reader; nothing relying on colour alone; no layout that breaks at a
   phone width (a 16 px gutter, no sideways scroll); a dialog that fits its buttons.
7. **React and Next.js here.** This is not the Next.js of the training data: `node_modules/next/dist/docs/`
   is the reference. The lint rules are strict: no `setState` in an effect body, no state updates during
   another component's render, no effect that could be an event handler. A static export: nothing that
   needs a server.
8. **Size and speed.** Work done on every render or every pointer move that could be done once; a loop over
   all stops and routes inside a loop over them; something that blocks the page for a large map (the
   suggester runs in a worker for that reason).
9. **Plain things.** Dead code, a comment that says what the code no longer does, a name that misleads, the
   same logic written twice where one place would do. Last, and kept short.

What is **not** a finding: taste with no consequence (the wording of a label is taste unless it contradicts
`docs/TERMINOLOGY.md`); a problem that was there before the diff (mention it
once, apart, as "outside the diff"); code that looks like a bug and is not (check before claiming);
anything the type check, lint or the tests already catch; a general quality remark that no checklist item
asks for; a change to what the owner has decided (the decisions are in `BACKLOG.md`, `docs/DECISIONS.md`
and `AGENTS.md`); and a suggestion for more abstraction, more defensive code, or tests for cases that cannot
happen.

## What comes back

A short list, most serious first. Each finding has:

```
[SEVERITY, confidence 0-100] file:line: what is wrong, in one sentence.
Rule: the checklist item (1-9), or "correctness".
Trace: the path through the code that ends in the wrong result, with the input or state.
Check: how to see it (a command, a test to write, a file to read).
```

SEVERITY is **BLOCKER** (wrong, loses data, breaks an old file, publishes something, or fails a rule the owner
set), **SHOULD** (a real fault with a small cost, or a missing test for something risky), or **NOTE**
(worth a look, no harm now). Findings from 75 up come first; then an **Uncertain** list of at most five from
50 to 74, marked as such. The review ends with one line on what it did **not** look at (a path it could not
read, a thing it could not check without running the app), so that nothing is taken as checked that was not.
If nothing is found it says that, and what it looked at; it does not invent findings to fill a list.

## After the review

1. Give every BLOCKER to a new `ttr-reviewer` run with only the claim, the file and line, and the words
   "try to show that this is wrong". A BLOCKER it refutes is read again by hand before it is dropped.
2. Read every finding against the code. Say, one by one, which were right and which were not and why.
3. Fix what was right, test first where the finding is a bug (a check that fails for the reason it
   names), and run the tier that fits (`docs/TESTING.md`).
4. For a release: the list of findings, what was done about each, and what was left and why is part of the
   hand-over to the owner, before the go for the push is asked for. A BLOCKER that is not fixed stops the
   release.
5. Write what was wrong, and why, under the next heading.

## Findings that were wrong

- *2026-10-06, the seeded trial.* A NOTE (confidence 75) that the button label "Wipe all tickets" was alarming
  and that a plainer verb was better. That is taste with no consequence, which the checklist already excludes;
  the reviewer filed it under item 9. The prompt now says that the wording of a label is a finding only when it
  contradicts `docs/TERMINOLOGY.md`.

## Testing the reviewer

`node scripts/review-seeds.cjs` makes a branch `review-seed-trial` from `main` with the files in
`tests/review-seeds/` added under `app/` and prints the diff command and what must be found
(`tests/review-seeds/expected.json`). Run `ttr-reviewer` on that diff, score what it reports against the
list (found, missed, false), and delete the branch (`--delete`). It is not for merging. The bar: every
seeded BLOCKER found, at least five of the six, and the decoy not reported. Run it when the prompt, the
checklist or the reviewer's model changes. A miss is written up in the prompt or the checklist, not by
adding the seed's exact words to it.

## Trials

- **2026-10-06, first trial** (the prompt run by a general-purpose agent on `opus`, since a new
  `.claude/agents/` directory is not picked up until the session restarts). 7 findings from 75 up, none
  uncertain. All three BLOCKERs found, with correct traces (S1: it also saw that the contract says a missing
  field reads as 50, not 0, and that `normalizeTension` already does what the seed re-implements; S2; S3 with
  the right arithmetic). S4 found twice, as the off-by-one and as a test that copies the code instead of
  importing it. S6 found with the contrast worked out (about 3:1). S5 found as a NOTE only: it saw that no
  release note was missing a change a user could see, since nothing wires the button into a screen, which is
  a fair reading of the seed. The decoy was looked at and rightly left alone. One finding of taste (above).
  The bar was met: 3 of 3 BLOCKERs, 6 of 6 seeds (S5 partly), decoy not reported. 50,547 tokens, 53 seconds
  for a 47-line diff.

- **2026-10-06, second trial** (`ttr-reviewer` itself, on `opus`). 7 findings from 75 up. S1 to S4 and S6 found
  with correct traces; the decoy and the wording of the label left alone. S5 missed: the reviewer said no
  release note was due since nothing wires the button into a screen, and did not name it as a NOTE. 3 of 3
  BLOCKERs and 5 of 6 seeds, so the bar was met. 47,000 tokens, 85 seconds.
- **2026-10-06, the first full review (1.0)**, five reviewers in parallel (logic and files, screens, the
  regression suite, other tests and scripts, documents). One BLOCKER (a stored map that cannot be read was
  overwritten when there was no room to put a copy aside, while the message said it was safe), upheld by a
  second run that tried to refute it. Two findings were made independently by two reviewers (tickets left
  behind by a deleted stop are reported as damage; a file with no map fields is not refused). About 15
  SHOULD and a dozen uncertain. 40 to 65 minutes of agent time in all.
- **2026-10-07, the second review (what changed since the first, 41 commits, four shares).** Run while 1.0 was
  being published, at the owner's word to publish first and test after, so it came too late to be a gate. One
  BLOCKER, found independently by two reviewers: tickets that came with a network file kept the ids they had,
  which other decks' tickets share, so answering the question about changed stops could move or lose a deck's
  tickets. Also found: the notice's Undo undid the last change, whatever it was; Undo after the question left tickets
  naming changed stops; a spreadsheet's routes alone dropped every field of the map's stops but their place; the
  print dialog could dead-end; texts and docs that no longer said what the dialog did. All fixed in the unreleased
  notes, with a check for each that fails without its fix.
- **2026-10-07, the third review (1.0 to 1.1.0, two shares).** No BLOCKER. Fixed from it: Undo and Redo did not count
  as changes, so a notice's Undo after the toolbar's Undo undid an earlier change; the Tickets panel's Import decks
  could read a whole map as a map (it now is tickets only, like Tickets only); a routes file's unusable id was not
  said; bends were written as x:y, which Excel and Sheets read as a time (now x|y, and x:y is still read); a doc
  named a test that does not exist, and rule 6 of the file format claimed more than the reader does. Also learned:
  the dev server hides an undo-step bug (see `docs/TESTING.md`), so that check was proved against the production
  build, with and without the fix. Left, for the owner: a routes-only file whose ids differ from the map's lays the
  stops out (as written in `docs/CSV.md`), and the example rules give 22 and 18 wagons for four and five players
  while the map holds one wagon count.

## Sources

- Claude Code documentation: [Create custom subagents](https://code.claude.com/docs/en/sub-agents) (tools,
  hooks, model, description versus prompt) and [Best practices](https://code.claude.com/docs/en/best-practices)
  (a fresh context for review, "add an adversarial review step", the writer and reviewer pattern).
- Anthropic's [code-review plugin](https://github.com/anthropics/claude-code/blob/main/plugins/code-review/README.md):
  parallel reviewers, a score from 0 to 100 per finding, a threshold of 80, and what it tells them to ignore.
- Cross-context review: [Separating production and review sessions](https://arxiv.org/html/2603.12123).
- Self-review bias: [No Agent Grades Its Own Homework](https://dev.to/ohugonnot/no-agent-grades-its-own-homework-8lb),
  [LLM self-review failure](https://agentpatterns.ai/patterns/anti-patterns/self-review-modernization-failure/).
- G-Research: [Building a code review tool: the LLM patterns that actually work](https://www.gresearch.com/news/building-a-code-review-tool-the-llm-patterns-that-actually-work/)
  (a rules index as the source of truth, two passes, asserting structure and recall thresholds).
- Augment: [Recall versus precision in code review](https://www.augmentcode.com/guides/deep-code-review-recall-vs-precision).
- Meta's structured prompting: [VentureBeat](https://venturebeat.com/orchestration/metas-new-structured-prompting-technique-makes-llms-significantly-better-at).
- Review size: [Augment on code review that scales](https://www.augmentcode.com/guides/code-review-best-practices-that-scale),
  [CodeAnt on cognitive load](https://www.codeant.ai/blogs/cognitive-load-code-reviews).
