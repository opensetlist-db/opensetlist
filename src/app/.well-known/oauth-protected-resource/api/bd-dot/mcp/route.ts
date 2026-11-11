import { bdDotConfig, mcpPath } from "@/lib/bdDotOAuth";

export function GET(request: Request) {
  const config = bdDotConfig();
  if (!config || new URL(request.url).origin !== config.origin) return new Response(null, { status: 404 });
  return Response.json({
    resource: config.origin + mcpPath,
    authorization_servers: [config.issuer],
    bearer_methods_supported: ["header"],
    scopes_supported: ["openid", "offline_access"],
  });
}
