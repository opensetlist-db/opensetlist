"use client";

import { colors } from "@/styles/tokens";
import { useImageFallback } from "./useImageFallback";

/*
 * Event/series art region — the shared image + fallback contract from
 * redesign packet 03-v1.1 (design-contract.md, "Cards, fallback and
 * responsive behavior"). Page tickets (home 15, concert list 17, detail
 * 19, series 33, search 13) compose cards around this; 06 only fixes the
 * region itself so every consumer reserves the same geometry and falls
 * back the same way.
 *
 * Geometry is reserved up front and never depends on the image:
 *   standard  full card width × 156px (126px under 700px)
 *   compact   96×96 at ≥1100px, 76×120 below (taller than wide so
 *             localized short titles fit; the slot need not be square)
 *   detail    288×160 above 800px, 220×148 at 700–800px, and a full
 *             row up to 320×140 on phones. Wide marks remain readable
 *             beside the title on desktop and above it on phones.
 *
 * Logo rendering: `object-fit: contain` with an 8px safe inset in the
 * detail slot (16px in cards). A neutral midtone supports both pale and
 * dark details in transparent artwork. Approved logos are never cropped,
 * stretched or replaced by posters.
 *
 * Fallback: when `logoUrl` is empty OR the image fails to load, the same
 * region shows typography (eyebrow / short title / caption) on the
 * neutral pastel wash. No retry, no ancestor-logo substitution here —
 * WHICH logo applies (event override vs inherited series logo) is
 * resolved upstream by ticket 07; this component only renders the one
 * URL it is handed. "No logo" and "failed logo" therefore converge
 * visually, and the card height never changes between them.
 *
 * Date, day label, venue and status never belong in this region — they
 * stay live text in the card body.
 *
 * Accessibility: the card body carries the event's readable name, so the
 * art is decorative by default (`alt=""`, fallback typography
 * aria-hidden). Pass `alt` only where the art is the sole identifier.
 */

export type EventArtVariant = "standard" | "compact" | "detail";

export interface EventArtProps {
  /** Resolved logo URL (07's resolver output). Null/empty → typography. */
  logoUrl?: string | null;
  /** Short display title used by the typography fallback. */
  title: string;
  /** Small line above the title (e.g. franchise/series family). Standard only. */
  eyebrow?: string | null;
  /** Small line below the title (e.g. anniversary label). Standard only. */
  caption?: string | null;
  variant?: EventArtVariant;
  /** Accessible name when the art is the only identifier. Default decorative. */
  alt?: string;
  /**
   * Representative colour (`#RRGGBB`, 07's `PublicLogo.color`). Washes the
   * region at low opacity (hex alpha 0x18 ≈ 9%) into the lavender accent.
   * Background only: the typography keeps its fixed dark tones whatever
   * the raw artist colour is, so contrast never depends on it. Anything
   * other than a 6-digit hex falls back to the neutral wash.
   */
  tint?: string | null;
  className?: string;
}

const HEX_COLOR = /^#[0-9a-fA-F]{6}$/;

const REGION: Record<EventArtVariant, string> = {
  standard: "h-[126px] w-full px-[22px] py-5 min-[700px]:h-[156px]",
  compact:
    "h-[120px] w-[76px] rounded-lg p-2 min-[1100px]:h-24 min-[1100px]:w-24",
  detail:
    "h-[140px] w-full max-w-[320px] rounded-xl p-3 min-[700px]:h-[148px] min-[700px]:w-[220px] min-[700px]:rounded-[18px] min-[801px]:h-[160px] min-[801px]:w-[288px]",
};

export function EventArt(props: EventArtProps) {
  // `key` resets the failure state when the URL changes (e.g. an admin
  // swaps the logo while a client page stays mounted).
  return <EventArtInner key={props.logoUrl ?? ""} {...props} />;
}

function EventArtInner({
  logoUrl,
  title,
  eyebrow,
  caption,
  variant = "standard",
  alt = "",
  tint,
  className = "",
}: EventArtProps) {
  const { failed, imgProps } = useImageFallback();
  const showLogo = Boolean(logoUrl) && !failed;
  const compact = variant === "compact";
  const detail = variant === "detail";

  return (
    <div
      data-testid="event-art"
      data-state={showLogo ? "logo" : "fallback"}
      className={`relative flex shrink-0 items-center justify-center overflow-hidden text-center ${REGION[variant]} ${className}`}
      // Tint belongs to the typography fallback; artwork keeps a neutral
      // background so pale lettering does not disappear into the wash.
      style={{
        background: showLogo
          ? colors.logoSurface
          : tint && HEX_COLOR.test(tint)
            ? `linear-gradient(135deg, ${tint}18, ${colors.accentLavender})`
            : colors.artWash,
      }}
    >
      {/* Two faint rings on the wash (03 mockup `.art:before/:after`).
          The detail slot (18-v3 `.logo-slot`) is drawn without them. */}
      {variant === "standard" && !showLogo && (
        <>
          <span
            aria-hidden="true"
            className="pointer-events-none absolute -right-[50px] -top-[105px] h-[200px] w-[200px] rounded-full border border-white/70"
          />
          <span
            aria-hidden="true"
            className="pointer-events-none absolute -bottom-[95px] -left-[50px] h-[140px] w-[140px] rounded-full border border-white/70"
          />
        </>
      )}
      {showLogo ? (
        // Plain <img>: remote storage logo; next/image would need every
        // storage host whitelisted and adds nothing for a contain-fit
        // mark of known slot size.
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={logoUrl ?? undefined}
          alt={alt}
          referrerPolicy="no-referrer"
          {...imgProps}
          className={`absolute object-contain ${detail
            ? "inset-2 h-[calc(100%-16px)] w-[calc(100%-16px)]"
            : "inset-4 h-[calc(100%-32px)] w-[calc(100%-32px)]"
          }`}
        />
      ) : (
        <div aria-hidden={alt ? undefined : true} className="relative w-full">
          {alt && <span className="sr-only">{alt}</span>}
          {!compact && eyebrow && (
            <small
              className="mb-1 block text-[10px] tracking-[0.14em]"
              style={{ color: colors.artEyebrow }}
            >
              {eyebrow}
            </small>
          )}
          <strong
            className={`block font-bold [overflow-wrap:anywhere] ${
              compact
                ? "text-[12px] leading-normal min-[700px]:text-[13px]"
                : detail
                  ? "text-[15px] leading-[1.35] tracking-[-0.04em] min-[700px]:text-[24px]"
                  : "text-[22px] leading-[1.35] tracking-[-0.04em] min-[700px]:text-[24px]"
            }`}
            style={{ color: colors.artTitle }}
          >
            {title}
          </strong>
          {!compact && caption && (
            <em
              className={`mt-[7px] text-[12px] not-italic ${
                detail ? "hidden min-[700px]:block" : "block"
              }`}
              style={{ color: colors.artCaption }}
            >
              {caption}
            </em>
          )}
        </div>
      )}
    </div>
  );
}
