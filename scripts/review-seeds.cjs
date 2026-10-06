// Makes a trial branch for testing the code reviewer (docs/REVIEW.md, "Testing the reviewer"): `main` plus
// the planted defects in tests/review-seeds/, copied under app/ in one commit. Not for merging.
//
//   node scripts/review-seeds.cjs            # makes the branch review-seed-trial, prints what to do
//   node scripts/review-seeds.cjs --delete   # deletes it again
const { execFileSync } = require("child_process");
const fs = require("fs");
const os = require("os");
const path = require("path");

const root = path.join(__dirname, "..");
const BRANCH = "review-seed-trial";
const git = (args, cwd = root) => execFileSync("git", args, { cwd, encoding: "utf8" }).trim();

if (process.argv.includes("--delete")) {
  try { git(["worktree", "remove", "--force", path.join(os.tmpdir(), BRANCH)]); } catch { /* none */ }
  try { git(["branch", "-D", BRANCH]); console.log(`Deleted ${BRANCH}.`); } catch { console.log(`No ${BRANCH} to delete.`); }
  process.exit(0);
}
const seeds = path.join(root, "tests", "review-seeds");
const where = path.join(os.tmpdir(), BRANCH);
git(["worktree", "add", "-b", BRANCH, where, "main"]);
// The seeds are kept as .txt so that the type check, lint and the build leave them alone.
for (const file of fs.readdirSync(seeds).filter((f) => f.endsWith(".txt"))) fs.copyFileSync(path.join(seeds, file), path.join(where, "app", file.replace(/\.txt$/, "")));
git(["add", "-A"], where);
git(["-c", "user.name=review-seeds", "-c", "user.email=review-seeds@localhost", "commit", "-m", "Seeded trial for the reviewer: not for merging"], where);
console.log(`Branch ${BRANCH} is ready, in ${where}.\nReview with:  git diff main...${BRANCH}   (what the change must do: "a few small helpers for tension, units, counting and labels")\nWhat must be found: tests/review-seeds/expected.json. Delete with: node scripts/review-seeds.cjs --delete`);
