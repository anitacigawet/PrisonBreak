import { Server as HTTPServer } from "http";
import { Server as SocketIOServer } from "socket.io";
import { getCaseById } from "../db";
import type { LocalSecurity } from "./localSecurity";

let io: SocketIOServer | null = null;

export function initializeWebSocket(httpServer: HTTPServer, security: LocalSecurity, canJoin = async (caseId: number) => {
  const record = await getCaseById(caseId);
  return Boolean(record && record.deletionState === "active");
}) {
  io = new SocketIOServer(httpServer, {
    cors: {
      origin: (origin, callback) => callback(null, security.isAllowedOrigin(origin)),
      methods: ["GET", "POST"],
      credentials: true,
    },
    path: "/api/socket.io",
    allowRequest: (req, callback) => callback(null, security.authorize(req)),
  });

  // Engine.IO handles upgrades and polling outside Express. Check every request,
  // not only the first handshake of a session.
  io.engine.use((req: import("node:http").IncomingMessage, _res: unknown, next: (error?: Error) => void) => {
    next(security.authorize(req) ? undefined : new Error("Local session required"));
  });

  io.on("connection", (socket) => {
    console.log(`[WebSocket] Client connected: ${socket.id}`);

    socket.on("disconnect", () => {
      console.log(`[WebSocket] Client disconnected: ${socket.id}`);
    });

    // Join case-specific room for targeted updates
    socket.on("join-case", async (caseId: unknown, acknowledge?: (result: { ok: boolean }) => void) => {
      const respond = (ok: boolean) => { if (typeof acknowledge === "function") acknowledge({ ok }); };
      if (typeof caseId !== "number" || !Number.isSafeInteger(caseId) || caseId <= 0) { respond(false); return; }
      try {
        const allowed = await canJoin(caseId) && socket.connected;
        if (allowed) await socket.join(`case-${caseId}`);
        respond(allowed);
      } catch {
        respond(false);
        socket.emit("case-unavailable", { caseId });
      }
    });

    socket.on("leave-case", (caseId: number) => {
      if (!Number.isSafeInteger(caseId) || caseId <= 0) return;
      socket.leave(`case-${caseId}`);
      console.log(`[WebSocket] Client ${socket.id} left case-${caseId}`);
    });
  });

  return io;
}

// ──────────────────────────────────────────────────────────────────
// Petals events — source-grounded research-domain visualization
// ──────────────────────────────────────────────────────────────────

export interface PetalProgressPayload {
  key: string;
  label: string;
  description: string;
  status: "pending" | "building" | "completed" | "failed" | "skipped";
  progress: number;
  summary: string | null;
  reasonSkipped: string | null;
  errorMessage: string | null;
  corpusKey: string | null;
  sourceCount: number;
}

export function emitPetalsStarted(caseId: number, data: { total: number }) {
  if (io) io.to(`case-${caseId}`).emit("petals-started", data);
}

export function emitPetalProgress(caseId: number, payload: PetalProgressPayload) {
  if (io) io.to(`case-${caseId}`).emit("petal-progress", payload);
}

export function emitPetalsComplete(
  caseId: number,
  data: { total: number; completed: number; skipped: number; failed: number }
) {
  if (io) io.to(`case-${caseId}`).emit("petals-complete", data);
}

/* ───────── Take to Trial (Phase-2 orchestrator) ─────────────────────── */

/**
 * Stage events streamed during a Take-to-Trial run. The frontend
 * visualization renders these one-by-one as the construction-tape +
 * thinking-stream UI. Mirrors the petal-progress pattern.
 */
export function emitTrialStage(caseId: number, payload: unknown) {
  if (io) io.to(`case-${caseId}`).emit("trial-stage", payload);
}
