/**
 * tRPC setup. Single procedure type — no auth, no roles. The previous
 * `protectedProcedure` and `adminProcedure` are aliased to
 * `publicProcedure` so existing routers compile without churn until
 * they're rewritten to drop the distinction entirely.
 */
import { initTRPC } from "@trpc/server";
import superjson from "superjson";
import type { TrpcContext } from "./context";

const t = initTRPC.context<TrpcContext>().create({
  transformer: superjson,
});

export const router = t.router;
export const publicProcedure = t.procedure;

// Compatibility aliases. Local-only app, no real auth.
export const protectedProcedure = t.procedure;
export const adminProcedure = t.procedure;
