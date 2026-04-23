"use client";

import { useState } from "react";

export default function AnonIdChip({ id }: { id: string }) {
  const [copied, setCopied] = useState(false);

  const handleClick = async () => {
    try {
      await navigator.clipboard.writeText(id);
      setCopied(true);
      setTimeout(() => setCopied(false), 1000);
    } catch {
      // clipboard unavailable; title attribute + text selection is the fallback
    }
  };

  return (
    <button
      type="button"
      onClick={handleClick}
      title={id}
      className="rounded bg-zinc-100 px-2 py-0.5 font-mono text-xs text-zinc-700 hover:bg-zinc-200"
    >
      {copied ? "복사됨" : `${id.slice(0, 8)}…`}
    </button>
  );
}
