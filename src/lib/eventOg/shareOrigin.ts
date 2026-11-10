import { publicationOrigin, invalid } from "./contracts";

/** Only this project's provider-supplied immutable Preview URL overrides the
 * configured origin. Request Host/Forwarded headers are never an authority.
 * Legacy event canonical URLs and personal sharing keep their existing config. */
export function sharePageOrigin(env: Record<string, string | undefined> = process.env) {
  if (env.VERCEL_ENV !== "preview") return publicationOrigin();
  if (env.VERCEL !== "1" || !/^opensetlist-[a-z0-9]+-opensetlist-projects\.vercel\.app$/.test(env.VERCEL_URL ?? "")) {
    throw invalid("검증된 Preview 배포 origin이 필요합니다.");
  }
  return publicationOrigin(`https://${env.VERCEL_URL}`);
}
