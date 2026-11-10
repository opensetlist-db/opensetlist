import { createHash, randomUUID } from "node:crypto";
import { bdDotConfig, metadataPath, readBdDotClaims } from "@/lib/bdDotOAuth";
import { getBonusCheckQueue } from "@/lib/bonusChecks";

const protocolVersions = ["2025-11-25", "2025-06-18", "2025-03-26"];
const tool = {
  name: "list_bd_bonus_check_targets",
  description: "List the current and review-needed BD bonus check targets from OpenSetlist.",
  inputSchema: { type: "object", properties: {}, additionalProperties: false },
  annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
};
const headers = { "Cache-Control": "no-store" };

export async function POST(request: Request) {
  const config = bdDotConfig();
  if (!config || new URL(request.url).origin !== config.origin) {
    return new Response(null, { status: 404, headers });
  }
  const requestOrigin = request.headers.get("Origin");
  if (requestOrigin && requestOrigin !== config.origin && requestOrigin !== "https://chatgpt.com") {
    return new Response(null, { status: 403, headers });
  }
  const token = request.headers.get("Authorization")?.match(/^Bearer ([^\s,]+)$/i)?.[1];
  const claims = token && await readBdDotClaims(config, token);
  if (!claims) {
    return new Response(null, {
      status: 401,
      headers: { ...headers, "WWW-Authenticate": `Bearer resource_metadata="${config.origin + metadataPath}"` },
    });
  }

  const rpc = await request.json().catch(() => null);
  const id = typeof rpc?.id === "string" || typeof rpc?.id === "number" ? rpc.id : null;
  const result = (value: unknown) => Response.json({ jsonrpc: "2.0", id, result: value }, { headers });
  const error = (code: number, message: string) =>
    Response.json({ jsonrpc: "2.0", id, error: { code, message } }, { headers });
  if (rpc?.jsonrpc !== "2.0" || typeof rpc.method !== "string") return error(-32600, "Invalid Request");
  if (id === null) return new Response(null, { status: 202, headers });

  switch (rpc.method) {
    case "initialize":
      return result({
        protocolVersion: protocolVersions.includes(rpc.params?.protocolVersion) ? rpc.params.protocolVersion : protocolVersions[0],
        capabilities: { tools: {} },
        serverInfo: { name: `opensetlist-bd-${config.environment}`, version: "0.1.0" },
      });
    case "ping":
      return result({});
    case "tools/list":
      return result({ tools: [tool] });
    case "tools/call": {
      if (rpc.params?.name !== tool.name) return error(-32602, "Unknown tool");
      const args = rpc.params.arguments ?? {};
      if (typeof args !== "object" || Array.isArray(args) || Object.keys(args).length !== 0) {
        return error(-32602, "This tool takes no arguments");
      }
      const queue = await getBonusCheckQueue().catch(() => null);
      if (!queue) {
        return result({ isError: true, content: [{ type: "text", text: "Unable to load BD check targets." }] });
      }
      const target = ({ listing, originalBonusType }: typeof queue.current[number]) => ({
        album: listing.album.originalTitle,
        store: listing.originalStoreName,
        edition: listing.originalEditionLabel,
        bonus: originalBonusType,
      });
      const receipt = randomUUID();
      const checkedAt = new Date().toISOString();
      console.info(JSON.stringify({
        event: "bd_dot_read", environment: config.environment, receipt, checkedAt, iat: claims.iat, exp: claims.exp,
        session: createHash("sha256").update(claims.session_id).digest("hex").slice(0, 16),
        current: queue.current.length, review: queue.review.length,
      }));
      return result({ content: [{ type: "text", text: JSON.stringify({
        environment: config.environment, receipt, checkedAt, current: queue.current.map(target), review: queue.review.map(target),
      }) }] });
    }
    default:
      return error(-32601, "Method not found");
  }
}
