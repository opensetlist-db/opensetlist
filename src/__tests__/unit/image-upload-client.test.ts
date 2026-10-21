// Browser side of the shared admin upload (ticket 08): preview without
// network, cancel without network, and bounded resubmission of ONE
// attempt id when the outcome could not be observed.
import { describe, it, expect, vi } from "vitest";
import { startImageAttempt, precheckImageFile } from "@/lib/imageUpload/client";
import { MAX_UPLOAD_RESUBMISSIONS } from "@/lib/imageUpload/limits";

const ATTEMPT = "3f0c1d2e-4b5a-4c6d-8e7f-001122334455";
const env = {
  createObjectURL: vi.fn(() => "blob:preview"),
  revokeObjectURL: vi.fn(),
  randomUUID: () => ATTEMPT,
};
const file = () => new File([new Uint8Array([1, 2, 3])], "logo.png", { type: "image/png" });
const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

describe("startImageAttempt", () => {
  it("previews locally and cancelling makes no request", () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const attempt = startImageAttempt(file(), env);
    expect(attempt.previewUrl).toBe("blob:preview");
    attempt.cancel();
    expect(env.revokeObjectURL).toHaveBeenCalledWith("blob:preview");
    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
  });

  it("(control) submitting an attempt does reach the network", async () => {
    const fetchImpl = vi.fn(async () => json(201, { status: "created" }));
    await startImageAttempt(file(), env).submit("/u", {}, { fetchImpl });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("refuses to submit after cancel", async () => {
    const attempt = startImageAttempt(file(), env);
    attempt.cancel();
    const fetchImpl = vi.fn();
    await expect(attempt.submit("/api/x", {}, { fetchImpl })).rejects.toThrow(/cancelled/);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("sends the file, attempt id and the consumer's expected fields", async () => {
    const fetchImpl = vi.fn(async () => json(201, { status: "created" }));
    const out = await startImageAttempt(file(), env).submit(
      "/api/admin/event-series/7/logo",
      { expectedMode: "inherit", expectedAssetId: "" },
      { fetchImpl },
    );
    expect(out).toMatchObject({ kind: "saved", status: "created" });
    const init = (fetchImpl.mock.calls[0] as unknown as [string, RequestInit])[1];
    const form = init.body as FormData;
    expect(form.get("attemptId")).toBe(ATTEMPT);
    expect(form.get("expectedMode")).toBe("inherit");
    expect(form.get("expectedAssetId")).toBe("");
    expect(form.get("file")).toBeInstanceOf(File);
  });

  it("resubmits the SAME attempt after a lost response and reports the reconciliation", async () => {
    const fetchImpl = vi
      .fn()
      .mockRejectedValueOnce(new TypeError("network"))
      .mockResolvedValueOnce(json(200, { status: "reconciled" }));
    const out = await startImageAttempt(file(), env).submit("/u", {}, { fetchImpl });
    expect(out).toMatchObject({ kind: "saved", status: "reconciled" });
    const ids = fetchImpl.mock.calls.map((c) => ((c[1] as RequestInit).body as FormData).get("attemptId"));
    expect(ids).toEqual([ATTEMPT, ATTEMPT]);
  });

  it("stops after the bound and stays 'unknown' (never claims failure)", async () => {
    const fetchImpl = vi.fn(async () => json(503, { outcome: "unknown", error: "outcome_unknown" }));
    const out = await startImageAttempt(file(), env).submit("/u", {}, { fetchImpl });
    expect(out.kind).toBe("unknown");
    expect(fetchImpl).toHaveBeenCalledTimes(MAX_UPLOAD_RESUBMISSIONS + 1);
  });

  it("treats a platform 5xx without our JSON as unknown, and a conflict as final", async () => {
    const gateway = vi
      .fn()
      .mockResolvedValueOnce(new Response("Gateway Timeout", { status: 504 }))
      .mockResolvedValueOnce(json(409, { outcome: "conflict", error: "assignment_conflict" }));
    const out = await startImageAttempt(file(), env).submit("/u", {}, { fetchImpl: gateway });
    expect(out.kind).toBe("conflict");
    expect(gateway).toHaveBeenCalledTimes(2);
  });

  it("does not retry a known failure", async () => {
    const fetchImpl = vi.fn(async () => json(415, { outcome: "not_saved", error: "unsupported_image_type" }));
    const out = await startImageAttempt(file(), env).submit("/u", {}, { fetchImpl });
    expect(out).toMatchObject({ kind: "not_saved", httpStatus: 415 });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });
});

describe("precheckImageFile", () => {
  it("flags wrong type and oversize for instant feedback", () => {
    expect(precheckImageFile(file())).toBeNull();
    expect(precheckImageFile(new File(["x"], "a.svg", { type: "image/svg+xml" }))).toMatch(/PNG/);
    expect(precheckImageFile(new File([new Uint8Array(4 * 1024 * 1024 + 1)], "a.png", { type: "image/png" }))).toMatch(
      /4MB/,
    );
  });
});
