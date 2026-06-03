// Smoke test for classifyCommands command policy handling. Not part of the build — run with:
//   npm run build && node tests/smoke-classifyCommands.mjs
import { classifyCommands } from "../dist/core/codexExec.js";

let failed = 0;
function assert(name, cond, detail) {
  if (cond) {
    console.log(`  ok   ${name}`);
  } else {
    console.log(`  FAIL ${name}${detail ? ` — ${detail}` : ""}`);
    failed++;
  }
}

function includesOnly(haystack, needles) {
  return haystack.length === needles.length && needles.every((needle) => haystack.includes(needle));
}

console.log("classifyCommands");

const forbiddenCommands = ["rm -rf build", "sudo apt update", "git push origin main"];
const forbiddenResult = classifyCommands(forbiddenCommands);
assert(
  "forbidden patterns are classified as forbidden",
  includesOnly(forbiddenResult.forbidden, forbiddenCommands),
  `got ${JSON.stringify(forbiddenResult.forbidden)}`,
);
assert(
  "forbidden patterns are not classified as ask",
  forbiddenResult.ask.length === 0,
  `got ${JSON.stringify(forbiddenResult.ask)}`,
);

const askCommands = ["npm install left-pad", "pip install requests"];
const askResult = classifyCommands(askCommands);
assert(
  "ask patterns are classified as ask",
  includesOnly(askResult.ask, askCommands),
  `got ${JSON.stringify(askResult.ask)}`,
);
assert(
  "ask patterns are not classified as forbidden",
  askResult.forbidden.length === 0,
  `got ${JSON.stringify(askResult.forbidden)}`,
);

const safeCommands = ["npm run lint", "npm test", "git status"];
const safeResult = classifyCommands(safeCommands);
assert(
  "safe commands are not forbidden",
  safeResult.forbidden.length === 0,
  `got ${JSON.stringify(safeResult.forbidden)}`,
);
assert("safe commands do not require ask", safeResult.ask.length === 0, `got ${JSON.stringify(safeResult.ask)}`);

const forbiddenAndAskCommand = "sudo npm install left-pad";
const priorityResult = classifyCommands([forbiddenAndAskCommand]);
assert(
  "forbidden takes precedence over ask",
  priorityResult.forbidden.includes(forbiddenAndAskCommand) && !priorityResult.ask.includes(forbiddenAndAskCommand),
  `got ${JSON.stringify(priorityResult)}`,
);

console.log(`\n${failed === 0 ? "ALL OK" : `FAILED: ${failed}`}`);
process.exit(failed === 0 ? 0 : 1);
