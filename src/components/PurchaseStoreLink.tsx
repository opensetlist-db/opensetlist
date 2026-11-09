import type { ComponentProps } from "react";
import { TrackedStoreLink } from "@/components/TrackedStoreLink";
import { resolvePurchaseLink } from "@/lib/purchaseLink";

export function PurchaseStoreLink({
  href,
  disclosure,
  ...props
}: Omit<ComponentProps<typeof TrackedStoreLink>, "href" | "isAffiliate"> & {
  href: string | null | undefined;
  disclosure: string;
}) {
  const link = resolvePurchaseLink(href, process.env.AMAZON_JP_ASSOCIATE_TAG);
  if (!link) return null;

  return (
    <>
      <TrackedStoreLink {...props} {...link} />
      {link.isAffiliate && (
        <p><small>{disclosure}</small></p>
      )}
    </>
  );
}
