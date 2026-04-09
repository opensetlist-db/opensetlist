import { defineRouting } from "next-intl/routing";

export const routing = defineRouting({
  locales: ["ko", "ja", "en", "zh-CN"],
  defaultLocale: "ko",
});
