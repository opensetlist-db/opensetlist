import { defineRouting } from "next-intl/routing";

export const routing = defineRouting({
  locales: ["ko"],
  defaultLocale: "ko",
  localeDetection: false,
});
