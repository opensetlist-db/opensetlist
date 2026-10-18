// @vitest-environment node
//
// The Sentry scrubber (`src/lib/sentryScrub.ts`): the browser anon id is
// a bearer credential (fan board picks, impression edits), so it must
// not reach Sentry through any capture path — request headers, JSON
// bodies (object or string form), query strings in URLs, span / trace
// attributes, breadcrumbs. Synthetic values only.
import { describe, it, expect } from "vitest";
import { FILTERED, scrubAnon } from "@/lib/sentryScrub";

const ID = "0f5e7c1a-1111-4222-8333-444455556666";

describe("scrubAnon", () => {
  it("masks the credential header in any case", () => {
    const event = {
      request: {
        headers: {
          "opensetlist-anon-token": ID,
          "OpenSetlist-Anon-Token": ID,
          "user-agent": "ua",
        },
      },
    };
    const out = scrubAnon(event);
    expect(out.request.headers["opensetlist-anon-token"]).toBe(FILTERED);
    expect(out.request.headers["OpenSetlist-Anon-Token"]).toBe(FILTERED);
    expect(out.request.headers["user-agent"]).toBe("ua");
  });

  it("masks anonId keys in object bodies, nested and in arrays", () => {
    const out = scrubAnon({
      request: { data: { anonId: ID, songId: "10", nested: [{ anon_id: ID }] } },
    });
    expect(out.request.data.anonId).toBe(FILTERED);
    expect(out.request.data.songId).toBe("10");
    expect(out.request.data.nested[0].anon_id).toBe(FILTERED);
  });

  it("masks anonId inside string bodies and URLs", () => {
    const out = scrubAnon({
      request: {
        data: `{"groupId":"1","anonId":"${ID}","songId":"10"}`,
        url: `https://opensetlist.com/api/events/107/board/mine?anonId=${ID}&locale=ko`,
        query_string: `anonId=${ID}&locale=ko`,
      },
      breadcrumbs: [
        { category: "fetch", data: { url: `/api/x?locale=ko&anonId=${ID}` } },
      ],
    });
    const json = JSON.stringify(out);
    expect(json).not.toContain(ID);
    expect(out.request.data).toBe(`{"groupId":"1","anonId":"${FILTERED}","songId":"10"}`);
    expect(out.request.url).toBe(
      `https://opensetlist.com/api/events/107/board/mine?anonId=${FILTERED}&locale=ko`,
    );
    expect(out.breadcrumbs[0].data.url).toBe(`/api/x?locale=ko&anonId=${FILTERED}`);
  });

  it("masks span / trace attributes keyed by the header", () => {
    const out = scrubAnon({
      spans: [
        {
          data: {
            "http.request.header.opensetlist-anon-token": ID,
            "http.request.header.opensetlist_anon_token": [ID],
            "url.query": `anonId=${ID}`,
            "http.method": "GET",
          },
        },
      ],
      contexts: { trace: { data: { "http.request.header.opensetlist-anon-token": ID } } },
    });
    expect(JSON.stringify(out)).not.toContain(ID);
    expect(out.spans[0].data["http.method"]).toBe("GET");
  });

  it("leaves unrelated data alone and survives cycles / non-plain values", () => {
    const cyclic: Record<string, unknown> = { message: "anonymous user", n: 3 };
    cyclic.self = cyclic;
    const out = scrubAnon(cyclic);
    expect(out.message).toBe("anonymous user");
    expect(out.n).toBe(3);
    expect(scrubAnon(null)).toBeNull();
    expect(scrubAnon("plain")).toBe("plain");
  });
});
