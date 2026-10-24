"use client";

import { useRef, useState } from "react";
import { MAIN_QUERY_ID, QUERY_MAX_LENGTH, type SearchType } from "@/lib/globalSearch/params";
import { colors } from "@/styles/tokens";
import { SearchIcon } from "./SearchIcon";
import styles from "./search.module.css";

/*
 * Main search form on `/[locale]/search` (approved 12-v1.2 geometry:
 * 56px input desktop / 52px mobile, 88px / 64px submit, clear button
 * inside the field).
 *
 * A plain GET form — no client routing, no autocomplete — so it works
 * before hydration and every state stays a shareable URL. Requerying
 * from this form keeps the selected type (hidden input) and drops `page`
 * (a new query must start at page 1); the header and Hero forms, which
 * send only `q`, land on the overview instead.
 *
 * The clear button is the only client behaviour: it empties the field
 * and returns focus to it. It is hidden while the field is empty.
 */

type Props = {
  locale: string;
  q: string;
  type: SearchType | null;
  labels: {
    form: string;
    input: string;
    placeholder: string;
    submit: string;
    clear: string;
  };
};

export function SearchForm({ locale, q, type, labels }: Props) {
  const [value, setValue] = useState(q);
  const inputRef = useRef<HTMLInputElement>(null);

  return (
    <form
      role="search"
      aria-label={labels.form}
      action={`/${locale}/search`}
      method="get"
      className="mt-[22px] flex max-w-[760px] gap-2 min-[700px]:mt-[26px] min-[700px]:gap-2.5"
    >
      {type && <input type="hidden" name="type" value={type} />}
      <div className="relative min-w-0 flex-1">
        <span
          className="pointer-events-none absolute left-[13px] top-4 min-[700px]:left-[18px] min-[700px]:top-[17px]"
          style={{ color: colors.textSecondary }}
        >
          <SearchIcon />
        </span>
        <label htmlFor={MAIN_QUERY_ID} className="sr-only">
          {labels.input}
        </label>
        <input
          ref={inputRef}
          id={MAIN_QUERY_ID}
          name="q"
          type="search"
          // maxLength counts UTF-16 units; for the BMP text people type
          // here (Latin, kana, kanji, hangul) that equals the server's
          // code-point limit. A longer direct URL is handled server-side.
          maxLength={QUERY_MAX_LENGTH}
          autoComplete="off"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder={labels.placeholder}
          className={`${styles.input} h-[52px] w-full min-w-0 rounded-lg border bg-white px-[42px] text-[16px] min-[700px]:h-14 min-[700px]:px-[50px] min-[700px]:text-[17px]`}
          style={{ borderColor: colors.borderStrong, color: colors.textPrimary }}
        />
        <button
          type="button"
          aria-label={labels.clear}
          hidden={!value}
          onClick={() => {
            setValue("");
            inputRef.current?.focus();
          }}
          className="shell-interactive absolute right-0 top-1 h-11 w-11 rounded-lg text-[24px] leading-none min-[700px]:right-1 min-[700px]:top-1.5"
          style={{ color: colors.textSecondary }}
        >
          ×
        </button>
      </div>
      <button
        type="submit"
        className={`${styles.primary} min-h-[46px] min-w-16 rounded-lg px-3 text-[14px] font-bold text-white min-[700px]:min-w-[88px] min-[700px]:px-[18px] min-[700px]:text-[15px]`}
      >
        {labels.submit}
      </button>
    </form>
  );
}
