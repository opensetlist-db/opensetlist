import Link from "next/link";
import { colors } from "@/styles/tokens";

interface Props {
  title: string;
  link?: { href: string; label: string };
}

export function SectionHeader({ title, link }: Props) {
  return (
    <div className="mb-3 flex items-center justify-between lg:mb-3.5">
      <h2
        className="text-sm font-bold lg:text-base"
        style={{ color: colors.textPrimary, letterSpacing: "-0.01em" }}
      >
        {title}
      </h2>
      {link && (
        <Link
          href={link.href}
          className="text-xs font-semibold"
          style={{ color: colors.primary }}
        >
          {link.label}
        </Link>
      )}
    </div>
  );
}
