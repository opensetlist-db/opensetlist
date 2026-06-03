"use client";

import { useEffect } from "react";
import { trackAlbumView } from "@/lib/analytics";

/*
 * Fires the `album_view` GA4 event when its params change (incl. first
 * mount), then renders nothing.
 *
 * Mounted by the (server-rendered) Album detail page — a client island
 * is the minimal way to run the effect without turning the page into a
 * client component. All params are resolved server-side and passed in
 * already-stringified (GA4 params are string/number/boolean; a raw
 * BigInt id would throw), so this component does no data work.
 *
 * The effect depends on the individual params rather than `[]`: App
 * Router soft navigation between `/albums/1` → `/albums/2` keeps this
 * client instance mounted and only updates props, so an empty-dep effect
 * would fire `album_view` only for the first album. Depending on the
 * params re-fires on the album change (they all change together with the
 * id) while staying inert across same-album re-renders like `?tab=`
 * switches (none of the params depend on the tab). Self-contained so no
 * call site has to remember a remount `key`.
 *
 * Dev StrictMode double-invokes the effect; production fires once per
 * params change — acceptable per the b10c spec.
 */
export function FireAlbumView({
  albumId,
  albumType,
  artistId,
  locale,
  hasAmazonListing,
}: {
  albumId: string;
  albumType: string;
  artistId: string;
  locale: string;
  hasAmazonListing: boolean;
}) {
  useEffect(() => {
    trackAlbumView({ albumId, albumType, artistId, locale, hasAmazonListing });
  }, [albumId, albumType, artistId, locale, hasAmazonListing]);
  return null;
}
