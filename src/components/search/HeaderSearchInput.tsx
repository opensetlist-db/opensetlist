"use client";

import { Suspense, type CSSProperties } from "react";
import { useSearchParams } from "next/navigation";
import { usePathname } from "@/i18n/navigation";
import { QUERY_MAX_LENGTH } from "@/lib/globalSearch/params";

/*
 * The header search field. On `/[locale]/search` it shows the current
 * `q` (approved 12-v1.2: the header field mirrors the page query); on
 * every other page it starts empty.
 *
 * `useSearchParams` sits behind its own Suspense boundary: Nav renders in
 * the root locale layout, and an unbounded `useSearchParams` there would
 * client-render every statically generated page up to the nearest
 * boundary. With this boundary only the input itself falls back (to the
 * same empty field) during prerendering.
 */

type Props = {
  id: string;
  placeholder: string;
  className: string;
  style: CSSProperties;
};

function Field({ value = "", ...props }: Props & { value?: string }) {
  return (
    <input
      // Remount when the URL query changes so the uncontrolled field
      // picks up the new default value.
      key={value}
      type="search"
      name="q"
      maxLength={QUERY_MAX_LENGTH}
      autoComplete="off"
      defaultValue={value}
      {...props}
    />
  );
}

function SyncedField(props: Props) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const value = pathname === "/search" ? (searchParams.get("q") ?? "").trim() : "";
  return <Field {...props} value={value} />;
}

export function HeaderSearchInput(props: Props) {
  return (
    <Suspense fallback={<Field {...props} />}>
      <SyncedField {...props} />
    </Suspense>
  );
}
