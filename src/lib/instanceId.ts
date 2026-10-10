import { randomUUID } from "node:crypto";

/**
 * Per-process id stamped on the live-path diagnostic log lines
 * (`[liveSnapshot] …`, `[prisma] pool …`, `[liveWriter] …`, `[setlist] …`).
 *
 * Vercel Fluid runs many concurrent requests in one function instance
 * and spreads a burst over many instances; the log summariser groups
 * lines by this id to count builds per instance and to sum each
 * instance's pool size into a pooler-client estimate. Every module that
 * logs must therefore use THIS value — two modules minting their own
 * ids would make one instance look like two.
 */
export const INSTANCE_ID = randomUUID().slice(0, 8);
