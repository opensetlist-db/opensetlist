// Browser side of the shared admin upload contract, for the admin
// logo/cover forms. Plain module (no React): the forms own their UI and state.
//
// Preview first, network later: `startImageAttempt(file)` only creates a
// local object URL and an attempt id. Nothing is sent until `submit()`;
// `cancel()` before that revokes the preview and makes no request at all
// (spec: cancelling a preview neither uploads nor assigns).
//
// Submission is bounded and idempotent. When the outcome is unobservable
// (fetch rejected — e.g. the response was lost — or the server answered
// `outcome: "unknown"`), the same FormData is resent with the same attempt
// id and the same expected assignment, at most MAX_UPLOAD_RESUBMISSIONS
// times. The server answers a resent attempt by reconciling: "reconciled"
// if the first send committed and is still current, 409 if it committed
// but has been superseded, or a normal save if it never committed. It can
// therefore never overwrite a newer assignment, and a commit is never
// undone. If the bound is exhausted the result stays `unknown`: the form
// must tell the operator to reload and check, not claim failure.

import { formatMiB } from "./errors";
import { IMAGE_INPUT_ACCEPT, MAX_IMAGE_BYTES, MAX_UPLOAD_RESUBMISSIONS } from "./limits";

/** The two fields of a server reply this module branches on. */
function replyFields(body: unknown): { status?: unknown; outcome?: unknown } {
  return body !== null && typeof body === "object" ? (body as { status?: unknown; outcome?: unknown }) : {};
}

export type ClientUploadOutcome =
  | { kind: "saved"; status: "created" | "reconciled"; body: unknown }
  | { kind: "conflict"; body: unknown }
  | { kind: "not_saved"; httpStatus: number | null; body: unknown }
  | { kind: "unknown"; body: unknown };

export type ImageAttempt = {
  readonly attemptId: string;
  readonly file: File;
  /** Object URL for the local preview <img>. */
  readonly previewUrl: string;
  /** Sends the file; `fields` are the consumer's expected-value fields. */
  submit(
    url: string,
    fields: Record<string, string>,
    options?: { fetchImpl?: typeof fetch },
  ): Promise<ClientUploadOutcome>;
  /** Discards the preview. Never sends anything. */
  cancel(): void;
};

export { IMAGE_INPUT_ACCEPT };

/**
 * Cheap client-side precheck for instant feedback only; the server
 * decodes and decides. Returns a Korean admin message or null.
 */
export function precheckImageFile(file: File): string | null {
  if (file.size > MAX_IMAGE_BYTES) return `이미지는 ${formatMiB(MAX_IMAGE_BYTES)} 이하여야 합니다.`;
  if (!IMAGE_INPUT_ACCEPT.split(",").includes(file.type)) {
    return "PNG, JPEG, WebP 이미지만 올릴 수 있습니다.";
  }
  return null;
}

export function startImageAttempt(
  file: File,
  env: { createObjectURL?: (f: File) => string; revokeObjectURL?: (u: string) => void; randomUUID?: () => string } = {},
): ImageAttempt {
  const createObjectURL = env.createObjectURL ?? ((f: File) => URL.createObjectURL(f));
  const revokeObjectURL = env.revokeObjectURL ?? ((u: string) => URL.revokeObjectURL(u));
  const randomUUID = env.randomUUID ?? (() => crypto.randomUUID());

  const attemptId = randomUUID();
  const previewUrl = createObjectURL(file);
  let cancelled = false;

  return {
    attemptId,
    file,
    previewUrl,
    cancel() {
      if (cancelled) return;
      cancelled = true;
      revokeObjectURL(previewUrl);
    },
    async submit(url, fields, options = {}) {
      if (cancelled) throw new Error("attempt was cancelled");
      const fetchImpl = options.fetchImpl ?? fetch;
      const form = new FormData();
      form.set("file", file);
      form.set("attemptId", attemptId);
      for (const [k, v] of Object.entries(fields)) form.set(k, v);

      let last: ClientUploadOutcome = { kind: "unknown", body: null };
      for (let sent = 0; sent <= MAX_UPLOAD_RESUBMISSIONS; sent++) {
        let res: Response;
        try {
          res = await fetchImpl(url, { method: "POST", body: form, credentials: "same-origin" });
        } catch {
          last = { kind: "unknown", body: null };
          continue;
        }
        const body: unknown = await res.json().catch(() => null);
        const reply = replyFields(body);
        if (res.ok) {
          return { kind: "saved", status: reply.status === "reconciled" ? "reconciled" : "created", body };
        }
        const outcome = reply.outcome;
        // A 5xx without our JSON (platform timeout / gateway error) may
        // have cut off a request that went on to commit: unknown, not failed.
        if (outcome === "unknown" || (outcome === undefined && res.status >= 500)) {
          last = { kind: "unknown", body };
          continue;
        }
        if (outcome === "conflict" || res.status === 409) return { kind: "conflict", body };
        // A failed RESUBMISSION does not prove the first send never
        // committed (e.g. the retry hit the same DB outage before it could
        // reconcile). Once an outcome was unobservable, it stays unknown.
        if (sent > 0) return { kind: "unknown", body };
        return { kind: "not_saved", httpStatus: res.status, body };
      }
      return last;
    },
  };
}
