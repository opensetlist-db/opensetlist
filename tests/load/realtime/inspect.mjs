// Read-only: print the Realtime Authorization state on dev
// (RLS on realtime.messages, policies, helper functions).
// Usage: ENV_DIR=<checkout with .env> node tests/load/realtime/inspect.mjs
import { loadEnv, assertDev, pgClient } from "./lib.mjs";
loadEnv();
assertDev();

(async () => {
  const c = pgClient();
  await c.connect();
  const q = async (label, sql) => {
    const r = await c.query(sql);
    console.log(`-- ${label}`);
    console.table(r.rows);
  };
  await q("RLS on realtime.messages", `select relname, relrowsecurity, relforcerowsecurity from pg_class where oid = 'realtime.messages'::regclass`);
  await q("policies in schema realtime", `select policyname, roles, cmd, qual, with_check from pg_policies where schemaname = 'realtime'`);
  await q("helper functions", `select p.proname, pg_get_function_identity_arguments(p.oid) as args from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'realtime' and p.proname in ('topic', 'send')`);
  await q("realtime.messages columns", `select column_name, data_type from information_schema.columns where table_schema = 'realtime' and table_name = 'messages' order by ordinal_position`);
  await q("grants on realtime.messages", `select grantee, privilege_type from information_schema.role_table_grants where table_schema = 'realtime' and table_name = 'messages' order by grantee, privilege_type`);
  await c.end();
})().catch((e) => { console.error(e.message); process.exit(1); });
