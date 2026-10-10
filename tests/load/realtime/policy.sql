-- Realtime Authorization for private broadcast channels `event:<id>`.
--
-- Used by the private-channel variant of the admission probe (n14). It
-- was written as the policy R1 would have shipped in
-- prisma/post-deploy.sql, but the probe showed private channels cannot
-- admit a Fes-sized audience (Realtime Authorization runs on a pool of
-- 2, ~0.85 s per join), so R1 uses PUBLIC channels and this policy is
-- NOT deployed anywhere. Kept so the probe stays re-runnable. Applied to
-- dev with `node tests/load/realtime/apply-policy.mjs` (dev-guarded) and
-- removed with `--drop`.
--
-- How Realtime Authorization uses it (supabase.com/docs/guides/realtime/authorization):
-- on a join with `config: { private: true }` the Realtime server checks
-- RLS on `realtime.messages` as the connecting JWT's role (`anon` for a
-- guest with the anon key). A SELECT policy that matches the topic lets
-- the client *receive* broadcasts; an INSERT policy would let it *send*.
-- `realtime.topic()` returns the channel topic being authorized.
--
-- Deliberately receive-only: no INSERT policy, so a guest cannot publish
-- a forged `rev` on `event:*`. Server-side publishing goes through
-- `realtime.send(payload, event, topic, true)` as the table owner, which
-- is not subject to these policies.
--
-- RLS itself is enabled on realtime.messages by Supabase (relrowsecurity
-- = true on both projects); with no policy at all every private join is
-- denied, which is the safe default this policy narrows.
--
-- Idempotent (safe to re-run from post-deploy.sql on every deploy).
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'realtime'
      AND tablename = 'messages'
      AND policyname = 'event_broadcast_receive'
  ) THEN
    CREATE POLICY event_broadcast_receive ON realtime.messages
      FOR SELECT
      TO anon, authenticated
      USING (
        realtime.topic() LIKE 'event:%'
        AND realtime.messages.extension = 'broadcast'
      );
  END IF;
END $$;
