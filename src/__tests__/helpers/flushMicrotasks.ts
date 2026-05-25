import { act } from "@testing-library/react";

// Flush mount-time microtasks so assertions made immediately after
// `renderHook` don't pass vacuously while effects are still queued.
// Two `Promise.resolve()` awaits is the safe minimum that lets any
// chained microtasks (state-set → re-render → effect cleanup) drain.
//
// Shared between `useRealtimeEventChannel.test.tsx` and
// `useRealtimeImpressions.test.tsx` (the R3.5 visibility tests in both
// use the exact same pattern; verbatim duplicate inline was a
// duplication risk for nothing).
export async function flushMicrotasks(): Promise<void> {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}
