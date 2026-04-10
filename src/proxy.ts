import createMiddleware from "next-intl/middleware";
import { routing } from "./i18n/routing";

export default createMiddleware(routing);

export const config = {
  matcher: [
    // Match all pathnames except for internal Next.js paths and static files
    "/((?!api|admin|_next|_vercel|.*\\..*).*)",
  ],
};
