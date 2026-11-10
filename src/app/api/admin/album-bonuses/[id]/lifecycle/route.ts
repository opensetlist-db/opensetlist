import { NextRequest, NextResponse } from "next/server";
import { verifyAdminAPI } from "@/lib/admin-auth";
import { PurchaseInputError } from "@/lib/adminPurchaseFields";
import { applyBonusOperation, BonusLifecycleError, getBonusLifecycle, parseBonusOperation, validOperationId } from "@/lib/bonusLifecycle";
import { revalidatePublicData } from "@/lib/dataCache";

type RouteProps = { params: Promise<{ id: string }> };

function lifecycleError(error: unknown, reading = false) {
  if (error instanceof PurchaseInputError) {
    return NextResponse.json({ code: "invalid_input", error: error.message }, { status: 400 });
  }
  if (error instanceof BonusLifecycleError) {
    return NextResponse.json({ code: error.code, error: error.message }, {
      status: error.code === "not_found" ? 404 : 409,
    });
  }
  console.error("[bonusLifecycle] %s failed", reading ? "read" : "write", error);
  return NextResponse.json({
    code: reading ? "read_failed" : "save_failed",
    error: reading ? "저장 상태를 조회하지 못했습니다." : "저장에 실패했습니다. 반영 여부를 확인해 주세요.",
  }, { status: 500 });
}

export async function GET(request: NextRequest, { params }: RouteProps) {
  const unauthorized = await verifyAdminAPI();
  if (unauthorized) return unauthorized;

  const { id } = await params;
  const listingId = request.nextUrl.searchParams.get("listingId");
  const operationId = request.nextUrl.searchParams.get("operationId");
  if (!id || !listingId || listingId.length > 128 || (operationId !== null && !validOperationId(operationId))) {
    return lifecycleError(new PurchaseInputError("구매 옵션과 작업 ID를 확인해 주세요."));
  }

  try {
    return NextResponse.json(await getBonusLifecycle(id, listingId, operationId ?? undefined), {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    return lifecycleError(error, true);
  }
}

export async function POST(request: NextRequest, { params }: RouteProps) {
  const unauthorized = await verifyAdminAPI();
  if (unauthorized) return unauthorized;

  const { id } = await params;
  let result;
  try {
    const input = parseBonusOperation(await request.json().catch(() => null));
    result = await applyBonusOperation(id, input);
  } catch (error) {
    return lifecycleError(error);
  }

  if (result.operation.action !== "end" && result.operation.action !== "restore") {
    return NextResponse.json(result);
  }

  // Expiry can be attempted again for a replay without changing the DB.
  let cache = "warning";
  try {
    if (revalidatePublicData()) cache = "invalidated";
  } catch (error) {
    console.error("[bonusLifecycle] public cache expiry failed after commit", error);
  }
  return NextResponse.json({ ...result, cache });
}
