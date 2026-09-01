import { Server as HTTPServer } from "http";
import { Server as SocketIOServer } from "socket.io";

let io: SocketIOServer | null = null;

export function initializeWebSocket(httpServer: HTTPServer) {
  io = new SocketIOServer(httpServer, {
    cors: {
      origin: "*",
      methods: ["GET", "POST"],
    },
    path: "/api/socket.io",
  });

  io.on("connection", (socket) => {
    console.log(`[WebSocket] Client connected: ${socket.id}`);

    socket.on("disconnect", () => {
      console.log(`[WebSocket] Client disconnected: ${socket.id}`);
    });

    // Join case-specific room for targeted updates
    socket.on("join-case", (caseId: number) => {
      socket.join(`case-${caseId}`);
      console.log(`[WebSocket] Client ${socket.id} joined case-${caseId}`);
    });

    socket.on("leave-case", (caseId: number) => {
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
