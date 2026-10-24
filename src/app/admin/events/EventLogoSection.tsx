"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import LogoAssignmentCard, { type LogoCardStatus } from "@/components/admin/LogoAssignmentCard";
import { eventResolutionText, type LogoCardState } from "@/lib/adminLogoCard";

/*
 * Event logo override section of the event edit page — the approved
 * admin "공연 로고" design, rendered by the shared LogoAssignmentCard (the
 * series card's component) with the event's endpoint and wording.
 *
 * Placement (owner-approved for this page): its own section after
 * EventForm and before the fan board / setlist sections,
 * each of which already saves on its own. The card saves only the logo;
 * EventForm's save never writes logo fields.
 *
 * After a logo save the page stays (the card re-reads its own state and
 * shows the success notice) — unlike the series page, which returns to
 * its list. Nothing else on this page depends on the logo, so there is
 * no page refresh to do.
 *
 * Leaving the page: EventForm's save navigates to the event list and is
 * NOT blocked here (the approved design locks only the image form's own
 * controls). Instead, while a logo draft or an unsettled save exists, a
 * note says exactly what is lost, and `beforeunload` covers reload/close
 * — it cannot cover client-side navigation, so it is a convenience, not
 * a guarantee.
 */

type Props = {
  /** Decimal string of the BigInt id (no Number round-trip). */
  eventId: string;
  initialState: LogoCardState;
  /** Saved values only: the preview shows what public pages render. */
  typography: { eyebrow: string | null; title: string; caption: string | null };
  /** The event's own series, for the "nothing to inherit" explanation. */
  seriesName: string | null;
};

export default function EventLogoSection({ eventId, initialState, typography, seriesName }: Props) {
  const [status, setStatus] = useState<LogoCardStatus>({ dirty: false, busy: false });
  const describeResolution = useMemo(() => eventResolutionText(seriesName), [seriesName]);
  const onStatusChange = useCallback((next: LogoCardStatus) => setStatus(next), []);

  const guard = status.dirty || status.busy;
  useEffect(() => {
    if (!guard) return;
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      // Older engines show the prompt only when returnValue is set.
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [guard]);

  return (
    <div className="max-w-[576px]" data-testid="event-logo-section">
      <LogoAssignmentCard
        endpoint={`/api/admin/events/${eventId}/logo`}
        initialState={initialState}
        copy={{
          title: "공연 로고",
          inheritTitle: "시리즈에서 상속",
          customDescription: "이 공연에만 사용할 로고를 업로드합니다.",
          savedBody: "로고 설정을 저장했습니다. 이 화면에 머뭅니다.",
        }}
        typography={typography}
        describeResolution={describeResolution}
        // Separate section: the card is independent of EventForm's dirty
        // state and saving, so neither gates the other.
        otherDirty={false}
        externalBusy={false}
        onStatusChange={onStatusChange}
      />
      {guard && (
        <p className="mt-2 text-[11px] leading-relaxed text-[#626977]" role="note">
          {status.busy
            ? "이 페이지를 떠나면 선택한 파일과 메모, 이번 저장의 확인·재시도 정보는 유지되지 않습니다. 이미 보낸 저장은 이동 후에도 완료될 수 있으며, 다시 열면 현재 적용된 로고를 확인할 수 있습니다."
            : "위 이벤트 정보 저장은 목록으로 이동하며, 저장하지 않은 로고 초안은 함께 저장되지 않습니다."}
        </p>
      )}
    </div>
  );
}
