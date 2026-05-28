// Shared Request factory for admin API route tests. The three b05
// test files previously inlined verbatim copies of this same helper
// — a method-name change in one would silently drift from the
// others. Centralizing keeps the test-side contract single-sourced.

export function jsonRequest(
  url: string,
  body: unknown,
  method: string = "POST",
): Request {
  return new Request(url, {
    method,
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}
