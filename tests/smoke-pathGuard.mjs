// Smoke test for pathGuard. Not part of the build — run with:
//   node --import tsx tests/smoke-pathGuard.mjs
// Or, after build:
//   node tests/smoke-pathGuard.mjs
import { validateChangedFiles, normalizePath, isUnder } from "../dist/core/pathGuard.js";

let failed = 0;
function assert(name, cond, detail) {
  if (cond) {
    console.log(`  ok   ${name}`);
  } else {
    console.log(`  FAIL ${name}${detail ? ` — ${detail}` : ""}`);
    failed++;
  }
}

console.log("normalizePath");
assert("strip leading ./", normalizePath("./src/file.ts") === "src/file.ts");
assert("backslash to slash", normalizePath("src\\foo\\bar.ts") === "src/foo/bar.ts");
assert("strip leading /", normalizePath("/abs/path") === "abs/path");

console.log("\nisUnder");
assert("exact match", isUnder("src/file.ts", "src/file.ts"));
assert("file under dir", isUnder("src/feature/x.ts", "src/feature"));
assert("dir with trailing slash", isUnder("src/feature/x.ts", "src/feature/"));
assert("NOT prefix collision", !isUnder("src/feature-extra/x.ts", "src/feature"),
  "src/feature must not match src/feature-extra");
assert("NOT unrelated path", !isUnder("other/x.ts", "src"));

console.log("\nvalidateChangedFiles - happy path");
{
  const r = validateChangedFiles({
    changedFiles: ["src/features/store/Form.tsx"],
    allowedPaths: ["src/features/store/"],
    forbiddenPaths: ["prisma/"],
  });
  assert("clean diff passes", r.ok, JSON.stringify(r.violations));
}

console.log("\nvalidateChangedFiles - outside allowed");
{
  const r = validateChangedFiles({
    changedFiles: ["src/features/other/Form.tsx"],
    allowedPaths: ["src/features/store/"],
    forbiddenPaths: [],
  });
  assert("rejects outside allowed_paths", !r.ok);
  assert("violation has correct reason",
    r.violations[0]?.reason === "outside_allowed_paths");
}

console.log("\nvalidateChangedFiles - .env always rejected");
{
  const r = validateChangedFiles({
    changedFiles: [".env"],
    allowedPaths: ["."],
    forbiddenPaths: [],
  });
  assert("rejects .env even with allowed_paths='.'", !r.ok);
}

console.log("\nvalidateChangedFiles - secret filename rejected");
{
  const r = validateChangedFiles({
    changedFiles: ["src/config/private_key.pem"],
    allowedPaths: ["src/"],
    forbiddenPaths: [],
  });
  assert("rejects private_key.pem", !r.ok);
  assert("flags as secret",
    r.violations.some(v => v.reason === "always_forbidden_secret"));
}

console.log("\nvalidateChangedFiles - forbidden_paths");
{
  const r = validateChangedFiles({
    changedFiles: ["src/migrations/001.sql"],
    allowedPaths: ["src/"],
    forbiddenPaths: ["src/migrations/"],
  });
  assert("rejects forbidden", !r.ok);
}

console.log("\nvalidateChangedFiles - lockfile without manifest");
{
  const r = validateChangedFiles({
    changedFiles: ["package-lock.json"],
    allowedPaths: ["."],
    forbiddenPaths: [],
  });
  assert("rejects lockfile-only", !r.ok);
}

console.log("\nvalidateChangedFiles - lockfile WITH manifest is OK by structure");
{
  const r = validateChangedFiles({
    changedFiles: ["package.json", "package-lock.json"],
    allowedPaths: ["."],
    forbiddenPaths: [],
  });
  // Note: still likely to fail because allowedPaths='.' (rejected at input layer),
  // but at the validateChangedFiles level, lockfile pairing rule passes.
  const hasLockfileViolation = r.violations.some(v => v.reason === "lockfile_without_package_json");
  assert("no lockfile-pairing violation when manifest is present", !hasLockfileViolation);
}

console.log("\nvalidateChangedFiles - prefix collision case from spec");
{
  // src/features/store/ should not accidentally allow src/features/store-extra/
  const r = validateChangedFiles({
    changedFiles: ["src/features/store-extra/leak.ts"],
    allowedPaths: ["src/features/store/"],
    forbiddenPaths: [],
  });
  assert("rejects sibling-with-shared-prefix path", !r.ok);
}

console.log(`\n${failed === 0 ? "ALL OK" : `FAILED: ${failed}`}`);
process.exit(failed === 0 ? 0 : 1);
