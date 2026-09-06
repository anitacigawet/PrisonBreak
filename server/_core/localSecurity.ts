import { randomBytes, timingSafeEqual } from "node:crypto";
import type { IncomingMessage } from "node:http";
import type { Express, RequestHandler } from "express";

/** Local browser boundary, not authentication for a public or shared host. */
export function createLocalSecurity(port: number) {
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error("Invalid local port");
  const authorities = [`127.0.0.1:${port}`, `localhost:${port}`, `[::1]:${port}`];
  const origins = new Set(authorities.map(host => new URL(`http://${host}`).origin));
  // Browsers omit the default HTTP port from Origin and normally from Host;
  // an explicit :80 Host denotes the same authority and is also valid.
  const hostOrigins = new Map(authorities.flatMap(host => {
    const url = new URL(`http://${host}`);
    return [[host, url.origin], [url.host, url.origin]];
  }));
  const cookieName = `prisonbreak_session_${port}`;
  const token = randomBytes(32).toString("hex");
  const isAllowedOrigin = (origin: unknown): boolean => typeof origin === "string" && origins.has(origin);
  const validRequest = (req: IncomingMessage): boolean => {
    if (typeof req.headers.host !== "string" || !hostOrigins.has(req.headers.host)) return false;
    if (req.headers.origin !== undefined && req.headers.origin !== hostOrigins.get(req.headers.host)) return false;
    if (req.headers.upgrade && !isAllowedOrigin(req.headers.origin)) return false;
    const site = req.headers["sec-fetch-site"];
    return site === undefined || site === "same-origin" || site === "none";
  };
  const hasSession = (req: IncomingMessage): boolean => {
    const values = (req.headers.cookie ?? "").split(";").map(part => part.trim()).filter(part => part.startsWith(`${cookieName}=`));
    if (values.length !== 1) return false;
    const candidate = values[0].slice(cookieName.length + 1);
    return /^[a-f0-9]{64}$/.test(candidate) && timingSafeEqual(Buffer.from(candidate), Buffer.from(token));
  };
  const authorize = (req: IncomingMessage): boolean => validRequest(req) && hasSession(req);
  const install = (app: Express): void => {
    const guard: RequestHandler = (req, res, next) => {
      res.set({ "X-Content-Type-Options": "nosniff", "X-Frame-Options": "DENY", "Content-Security-Policy": "frame-ancestors 'none'; object-src 'none'", "Cross-Origin-Opener-Policy": "same-origin" });
      if (!validRequest(req)) { res.status(403).end("Local origin required"); return; }
      next();
    };
    app.use(guard);
    app.post("/api/session", (req, res) => {
      // A page loaded from this exact origin may bootstrap. A foreign page,
      // navigation, DNS-rebinding hostname, or bare cross-site form may not.
      if (!isAllowedOrigin(req.headers.origin) && req.headers["sec-fetch-site"] !== "same-origin") {
        res.status(403).end("Same-origin bootstrap required"); return;
      }
      res.set("Cache-Control", "no-store");
      res.cookie(cookieName, token, { httpOnly: true, sameSite: "strict", path: "/" });
      res.status(204).end();
    });
    app.use("/api", (req, res, next) => {
      res.set("Cache-Control", "no-store");
      if (!authorize(req)) { res.status(403).end("Open the local application to establish a session"); return; }
      next();
    });
  };
  return { isAllowedOrigin, validRequest, authorize, install };
}

export type LocalSecurity = ReturnType<typeof createLocalSecurity>;

/** Uploaded HTML is evidence, never executable application content. */
export const uploadedFileHeaders = {
  "Content-Security-Policy": "sandbox; default-src 'none'; frame-ancestors 'none'",
  "X-Content-Type-Options": "nosniff",
  "Cache-Control": "no-store",
};
