import { NextRequest, NextResponse } from "next/server";
import { verifyAdminAPI } from "@/lib/admin-auth";
import { PurchaseInputError } from "@/lib/adminPurchaseFields";
import { applyLinkCheck, getLinkCheck, parseLinkCheck, parseLinkCheckTarget } from "@/lib/bonusLinkChecks";
import { BonusLifecycleError, validOperationId } from "@/lib/bonusLifecycle";

function errorResponse(error: unknown) {
  if (error instanceof PurchaseInputError) {
    return NextResponse.json({ code: "invalid_input", error: error.message }, { status: 400 });
  }
  if (error instanceof BonusLifecycleError) {
    return NextResponse.json({ code: error.code, error: error.message }, {
      status: error.code === "not_found" ? 404 : 409,
    });
  }
  console.error("[bonusLinkChecks] request failed", error);
  return NextResponse.json({ error: "상품 링크 확인 기록을 처리하지 못했습니다." }, { status: 500 });
}

export async function GET(request: NextRequest) {
  const unauthorized = await verifyAdminAPI();
  if (unauthorized) return unauthorized;
  try {
    const query = request.nextUrl.searchParams;
    const target = parseLinkCheckTarget(query.get("albumId"), query.get("storeKey"));
    const operationId = query.get("operationId");
    if (operationId !== null && !validOperationId(operationId)) {
      throw new PurchaseInputError("작업 ID를 확인해 주세요.");
    }
    return NextResponse.json(await getLinkCheck(target, operationId ?? undefined), {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function POST(request: NextRequest) {
  const unauthorized = await verifyAdminAPI();
  if (unauthorized) return unauthorized;
  try {
    return NextResponse.json(await applyLinkCheck(parseLinkCheck(await request.json().catch(() => null))));
  } catch (error) {
    return errorResponse(error);
  }
}
