// Drives `document.visibilitychange` deterministically from tests.
// JSDOM exposes `document.hidden` as a getter, so we override the
// descriptor per-call and dispatch the event manually.
// `configurable: true` is required so the test's afterEach can
// restore the JSDOM default — without it the second test in a file
// would inherit the prior test's hidden state and silently misbehave.
//
// Shared by the live-hook visibility tests
// (`useRealtimeEventChannel.test.tsx`, `useImpressionPolling.test.tsx`)
// — a verbatim copy in each file is duplication risk for nothing.
export function setDocumentHidden(hidden: boolean) {
  Object.defineProperty(document, "hidden", {
    value: hidden,
    configurable: true,
  });
  document.dispatchEvent(new Event("visibilitychange"));
}
