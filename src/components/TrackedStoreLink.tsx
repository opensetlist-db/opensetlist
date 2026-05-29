"use client";

import type { CSSProperties, ReactNode } from "react";
import { trackStoreClick, type StoreClickSurface } from "@/lib/analytics";

/*
 * External store link that fires the `store_click` GA4 event on click,
 * then lets the browser navigate normally.
 *
 * Used for the album-page ListingCard "구매하기" button (the only
 * external store link in the album surfaces at b10c). A client island
 * because the click handler needs the browser; the server component
 * that renders it (ListingCard) passes the already-stringified params.
 *
 * No `preventDefault` / manual navigation — `trackStoreClick` pushes to
 * gtag synchronously inside the handler, and the browser proceeds to
 * the href after the handler returns, so the event is recorded without
 * blocking or racing navigation. `target="_blank"` keeps the store in a
 * new tab (same as the original ListingCard anchor), which also means
 * navigation never tears down this page before the event flushes.
 *
 * b16 hook: when affiliate-tag injection lands, this wrapper is where
 * the href gets rewritten + `isAffiliate` flips to true (see the
 * trackStoreClick contract comment in lib/analytics.ts). No separate
 * affiliate_click event.
 */
export function TrackedStoreLink({
  href,
  albumId,
  storeKey,
  storeStatus,
  surface,
  isAffiliate,
  bonusId,
  style,
  children,
}: {
  href: string;
  albumId: string;
  storeKey: string;
  storeStatus: string;
  surface: StoreClickSurface;
  isAffiliate: boolean;
  bonusId?: string;
  style?: CSSProperties;
  children: ReactNode;
}) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      style={style}
      onClick={() =>
        trackStoreClick({
          albumId,
          storeKey,
          storeStatus,
          surface,
          isAffiliate,
          bonusId,
        })
      }
    >
      {children}
    </a>
  );
}
