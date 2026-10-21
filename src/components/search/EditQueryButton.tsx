"use client";

import { MAIN_QUERY_ID } from "@/lib/globalSearch/params";
import styles from "./search.module.css";

/*
 * "Edit search" action of the too-long-query state: moves focus to the
 * main field (which still holds the over-long text) so the user can
 * shorten it in place.
 */
export function EditQueryButton({ label }: { label: string }) {
  return (
    <button
      type="button"
      className={styles.secondary}
      onClick={() => {
        const input = document.getElementById(MAIN_QUERY_ID);
        if (input instanceof HTMLInputElement) {
          input.focus();
          input.select();
        }
      }}
    >
      {label}
    </button>
  );
}
