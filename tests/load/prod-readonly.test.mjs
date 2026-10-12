// node --test tests/load/prod-readonly.test.mjs
//
// The production read-only guards: target classification, the flag
// allow-list (write-capable flags refused by name), the anon-key proof,
// and each tool's validator (observer --prod-readonly, wake-check,
// transition-sampler, attribution-smoke's event guard).
import test from "node:test";
import assert from "node:assert/strict";
import {
  classifyBase, isWriteishFlag, refuseFlags, supabaseRefOf, maskRef, keyInfo, checkAnonKeyEnvName,
  validateObserverProd, validateWakeCheck, validateSampler, attributionEventGuard, parseArgs,
} from "./prod-readonly.mjs";

const REF = "abcdefghijklmnopqrst"; // 20 chars, like a project ref
const OTHER = "zyxwvutsrqponmlkjihg";
const jwt = (payload) => `eyJhbGciOiJIUzI1NiJ9.${Buffer.from(JSON.stringify(payload)).toString("base64url")}.sig`;
const ANON = jwt({ iss: "supabase", ref: REF, role: "anon" });
const SERVICE = jwt({ iss: "supabase", ref: REF, role: "service_role" });
const DEV_ALIAS = "https://opensetlist-git-dev-opensetlist-projects.vercel.app";
const argsOf = (...a) => parseArgs(a);

test("classifyBase: dev / prod / deployment / refused", () => {
  assert.equal(classifyBase(DEV_ALIAS), "dev");
  assert.equal(classifyBase("http://localhost:3000"), "dev");
  assert.equal(classifyBase("https://opensetlist.com"), "prod");
  assert.equal(classifyBase("https://www.opensetlist.com/"), "prod");
  assert.equal(classifyBase("https://opensetlist-abc123def-opensetlist-projects.vercel.app"), "deployment");
  assert.equal(classifyBase("http://opensetlist.com"), null);
  assert.equal(classifyBase("https://opensetlist.com.evil.example"), null);
  assert.equal(classifyBase("https://opensetlist.com/ja"), null);
  assert.equal(classifyBase("https://example.com"), null);
  assert.equal(classifyBase(undefined), null);
});

test("write-capable flag names are recognised; read-only ones are not", () => {
  for (const f of ["admin", "save-offsets", "idle-saves", "first-save-at", "cleanup", "delete", "restore-positions", "edit-mode", "publish", "send", "spam-rate", "poison-rev", "drop", "drill", "fixture", "markers", "anchor", "after-row", "race", "wake", "load-rps", "storms", "private", "topic", "password", "database-url", "db-url", "service-role-key", "login", "token"]) {
    assert.equal(isWriteishFlag(f), true, f);
  }
  for (const f of ["base", "event-id", "listeners", "duration-s", "out", "label", "locales", "pages", "wait-s", "deployment", "path", "expect"]) {
    assert.equal(isWriteishFlag(f), false, f);
  }
});

test("refuseFlags: allow-list, write-ish named as such, positional refused", () => {
  const errs = refuseFlags(argsOf("--base=x", "--admin", "--frobnicate=1"), ["base"], ["stray"]);
  assert.equal(errs.length, 3);
  assert.match(errs[0], /--admin is a write-capable option/);
  assert.match(errs[1], /unknown flag --frobnicate/);
  assert.match(errs[2], /unexpected argument "stray"/);
});

test("supabase ref, masking, key kinds", () => {
  assert.equal(supabaseRefOf(`https://${REF}.supabase.co`), REF);
  assert.equal(supabaseRefOf(`https://${REF}.supabase.co/rest`), null);
  assert.equal(supabaseRefOf(`http://${REF}.supabase.co`), null);
  assert.equal(supabaseRefOf(`https://${REF}.supabase.co.evil.io`), null);
  assert.equal(maskRef(REF), "abcd…");
  assert.deepEqual(keyInfo(ANON), { kind: "jwt", role: "anon", ref: REF });
  assert.equal(keyInfo(SERVICE).role, "service_role");
  assert.equal(keyInfo("sb_publishable_xyz").role, "anon");
  assert.equal(keyInfo("sb_secret_xyz").role, "service_role");
  assert.equal(keyInfo("garbage").kind, "unknown");
  assert.equal(checkAnonKeyEnvName("PROD_SUPABASE_ANON_KEY"), null);
  assert.match(checkAnonKeyEnvName("SUPABASE_SERVICE_ROLE_KEY"), /privileged/);
  assert.match(checkAnonKeyEnvName("ADMIN_PASSWORD"), /privileged/);
  assert.match(checkAnonKeyEnvName("lower-case"), /must name an environment variable/);
});

const OBS = ["--prod-readonly", "--base=https://opensetlist.com", "--event-id=107", `--supabase-url=https://${REF}.supabase.co`, "--anon-key-env=PROD_ANON"];

test("observer --prod-readonly: a valid command line", () => {
  const { errors, config } = validateObserverProd(argsOf(...OBS), { PROD_ANON: ANON });
  assert.deepEqual(errors, []);
  assert.equal(config.base, "https://opensetlist.com");
  assert.equal(config.baseKind, "prod");
  assert.equal(config.listeners, 3);
  assert.equal(config.durationS, 900);
  assert.equal(config.supabaseUrl, `https://${REF}.supabase.co`);
  assert.equal(config.addListenerAfterS, null);
  const late = validateObserverProd(argsOf(...OBS, "--add-listener-after-s=300", "--duration-s=1200"), { PROD_ANON: ANON });
  assert.equal(late.config.addListenerAfterS, 300);
});

test("observer --prod-readonly: refusals", () => {
  const env = { PROD_ANON: ANON, SVC: SERVICE, PUB: "sb_publishable_ok", SEC: "sb_secret_no", OTHERKEY: jwt({ role: "anon", ref: OTHER }) };
  const refuse = (extra, pattern, base = OBS, e = env) => {
    const { errors, config } = validateObserverProd(argsOf(...base, ...extra), e);
    assert.equal(config, null, extra.join(" "));
    assert.ok(errors.some((x) => pattern.test(x)), `${extra.join(" ")} → ${errors.join(" | ")}`);
  };
  // write-capable flags borrowed from other harness commands
  for (const f of ["--admin", "--save-offsets=0,30", "--cleanup", "--spam-rate=5", "--idle-saves=2", "--publish", "--send"]) refuse([f], /write-capable/);
  refuse(["--clients=5"], /unknown flag --clients/);
  // the key must be the anon key of THIS project
  refuse(["--anon-key-env=SVC"], /service_role key/);
  refuse(["--anon-key-env=SEC"], /service_role key/);
  refuse(["--anon-key-env=SUPABASE_SERVICE_ROLE_KEY"], /privileged secret/);
  refuse(["--anon-key-env=MISSING"], /empty or unset/);
  refuse(["--anon-key-env=OTHERKEY"], /different project/);
  assert.deepEqual(validateObserverProd(argsOf(...OBS.slice(0, 4), "--anon-key-env=PUB"), env).errors, []);
  // target
  refuse(["--base=https://example.com"], /not opensetlist\.com/, OBS.filter((a) => !a.startsWith("--base")));
  refuse([], /--event-id=<n> is required/, OBS.filter((a) => !a.startsWith("--event-id")));
  refuse([], /--supabase-url/, OBS.filter((a) => !a.startsWith("--supabase-url")));
  refuse(["--prod-readonly=yes"], /takes no value/, OBS.slice(1));
  refuse(["--listeners=50"], /--listeners must be 1\.\.10/);
  refuse(["--add-listener-after-s=999"], /add-listener-after-s must be in/);
  // dev alias + dev project is fine (the smoke)
  assert.deepEqual(validateObserverProd(argsOf("--prod-readonly", `--base=${DEV_ALIAS}`, "--event-id=111", `--supabase-url=https://${REF}.supabase.co`, "--anon-key-env=PROD_ANON"), env).errors, []);
});

test("wake-check: prod needs --prod-readonly; flags allow-listed; path derived", () => {
  const ok = validateWakeCheck(argsOf("--prod-readonly", "--base=https://opensetlist.com", "--event-id=107"));
  assert.deepEqual(ok.errors, []);
  assert.equal(ok.config.eventPath, "/events/107");
  assert.deepEqual(ok.config.locales, ["ja", "ko", "en"]);
  assert.equal(ok.config.pages, 2);
  assert.equal(ok.config.pollOnly, 0);
  assert.equal(ok.config.waitS, 600);
  assert.match(validateWakeCheck(argsOf("--base=https://opensetlist.com", "--event-id=107")).errors.join(), /pass --prod-readonly/);
  assert.deepEqual(validateWakeCheck(argsOf(`--base=${DEV_ALIAS}`, "--event-id=111", "--poll-only=1")).errors, []);
  assert.match(validateWakeCheck(argsOf(`--base=${DEV_ALIAS}`, "--event-id=111", "--admin")).errors.join(), /write-capable/);
  assert.match(validateWakeCheck(argsOf(`--base=${DEV_ALIAS}`)).errors.join(), /--event-id=<n> is required/);
  assert.match(validateWakeCheck(argsOf(`--base=${DEV_ALIAS}`, "--event-id=111", "--event-path=/events/112/x")).errors.join(), /different event/);
  assert.match(validateWakeCheck(argsOf(`--base=${DEV_ALIAS}`, "--event-id=111", "--locales=ja,fr")).errors.join(), /--locales/);
  assert.match(validateWakeCheck(argsOf(`--base=${DEV_ALIAS}`, "--event-id=111", "--deployment=https://example.com")).errors.join(), /--deployment/);
});

test("transition-sampler: --event-id AND --path required, path = same event, prod needs the flag", () => {
  const base = ["--prod-readonly", "--base=https://opensetlist.com", "--event-id=107", "--path=/ja/events/107/lovelive-fes-day1", "--expect=dpl_ABC123"];
  const ok = validateSampler(argsOf(...base));
  assert.deepEqual(ok.errors, []);
  assert.equal(ok.config.intervalMs, 250);
  assert.match(validateSampler(argsOf(...base.filter((a) => !a.startsWith("--path")))).errors.join(), /--path=.* is required/);
  assert.match(validateSampler(argsOf(...base.filter((a) => !a.startsWith("--event-id")))).errors.join(), /--event-id=<n> is required/);
  assert.match(validateSampler(argsOf(...base.filter((a) => !a.startsWith("--path")), "--path=/ja/events/108/x")).errors.join(), /different event/);
  assert.match(validateSampler(argsOf(...base.filter((a) => !a.startsWith("--path")), "--path=/events/107")).errors.join(), /canonical/);
  assert.match(validateSampler(argsOf(...base.slice(1))).errors.join(), /pass --prod-readonly/);
  assert.match(validateSampler(argsOf(...base.filter((a) => !a.startsWith("--expect")))).errors.join(), /--expect/);
  assert.match(validateSampler(argsOf(...base, "--interval-ms=50")).errors.join(), /interval-ms/);
  assert.match(validateSampler(argsOf(...base, "--save-at=now")).errors.join(), /write-capable/);
});

test("attribution-smoke: default event 111 refused off the dev alias", () => {
  assert.equal(attributionEventGuard({ base: DEV_ALIAS, eventId: undefined }), null);
  assert.equal(attributionEventGuard({ base: "http://localhost:3000", eventId: undefined }), null);
  assert.match(attributionEventGuard({ base: "https://opensetlist.com", eventId: undefined }), /pass --event-id/);
  assert.match(attributionEventGuard({ base: "https://opensetlist-abc123def-opensetlist-projects.vercel.app", eventId: undefined }), /pass --event-id/);
  assert.equal(attributionEventGuard({ base: "https://opensetlist.com", eventId: "107" }), null);
  assert.match(attributionEventGuard({ base: "https://opensetlist.com", eventId: "107", eventPath: "/events/111/rehearsal-lovelive-fes-2020-day1" }), /different event/);
  assert.equal(attributionEventGuard({ base: "https://opensetlist.com", eventId: "107", eventPath: "/events/107/x" }), null);
  assert.match(attributionEventGuard({ base: "https://opensetlist.com", eventId: "107", eventPath: "/events/1070/x" }), /different event/);
});
