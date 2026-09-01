/**
 * tRPC request context. PrisonBreak runs locally with no auth, so the
 * context exposes a single static `LOCAL_USER` — every handler resolves
 * `ctx.user` to the seeded local-user row.
 */
import type { CreateExpressContextOptions } from "@trpc/server/adapters/express";
import type { User } from "../../drizzle/schema";
import { LOCAL_USER_ID } from "../db";

const LOCAL_USER: User = {
  id: LOCAL_USER_ID,
  openId: "local-user",
  name: "Local User",
  email: null,
  loginMethod: null,
  role: "admin",
  createdAt: new Date(0),
  updatedAt: new Date(0),
  lastSignedIn: new Date(0),
};

export type TrpcContext = {
  req: CreateExpressContextOptions["req"];
  res: CreateExpressContextOptions["res"];
  user: User;
};

export async function createContext(
  opts: CreateExpressContextOptions
): Promise<TrpcContext> {
  return { req: opts.req, res: opts.res, user: LOCAL_USER };
}
