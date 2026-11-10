"use client";

import Link from "next/link";
import type { ComponentProps } from "react";
import { trackAlbumClick, type AlbumClickSurface } from "@/lib/analytics";

export function TrackedAlbumLink({
  albumId,
  albumSlug,
  surface,
  eventId,
  ...props
}: Omit<ComponentProps<typeof Link>, "onClick" | "onAuxClick"> & {
  albumId: string;
  albumSlug: string;
  surface: AlbumClickSurface;
  eventId?: string;
}) {
  const track = () => {
    if (props["aria-current"] !== "page") {
      trackAlbumClick({ albumId, albumSlug, surface, eventId });
    }
  };
  return (
    <Link
      {...props}
      onClick={(event) => {
        if (event.button === 0) track();
      }}
      onAuxClick={(event) => {
        if (event.button === 1) track();
      }}
    />
  );
}
