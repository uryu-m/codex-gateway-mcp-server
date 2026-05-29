// Smoke test for codexExec config resolution. Not part of the build — run with:
//   npm run build && node tests/smoke-codexExec.mjs
import { resolveModel } from "../dist/core/codexExec.js";

let failed = 0;
function assert(name, cond, detail) {
  if (cond) {
    console.log(`  ok   ${name}`);
  } else {
    console.log(`  FAIL ${name}${detail ? ` — ${detail}` : ""}`);
    failed++;
  }
}

const originalModel = process.env.CODEX_MODEL;

console.log("resolveModel");
delete process.env.CODEX_MODEL;
assert("undefined when no override or env", resolveModel() === undefined);

process.env.CODEX_MODEL = "gpt-5.5";
assert("uses CODEX_MODEL when override is unset", resolveModel() === "gpt-5.5");
assert("trims CODEX_MODEL", resolveModel(" ") === "gpt-5.5");
assert("override takes precedence", resolveModel("gpt-5.4") === "gpt-5.4");
assert("trims override", resolveModel("  gpt-5.4-mini  ") === "gpt-5.4-mini");

process.env.CODEX_MODEL = "   ";
assert("blank CODEX_MODEL is ignored", resolveModel() === undefined);

if (originalModel === undefined) {
  delete process.env.CODEX_MODEL;
} else {
  process.env.CODEX_MODEL = originalModel;
}

console.log(`\n${failed === 0 ? "ALL OK" : `FAILED: ${failed}`}`);
process.exit(failed === 0 ? 0 : 1);
