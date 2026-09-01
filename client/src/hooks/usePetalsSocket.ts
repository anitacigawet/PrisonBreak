/**
 * Subscribe to per-case petal-growth events over WebSocket.
 *
 * Returns a live map of the latest progress payload per petal key,
 * plus a flag for whether growth is currently in flight. The
 * `seedFromList` callback lets the caller pre-populate the map from a
 * REST fetch (`petals.list`) so the UI reflects already-built petals
 * the moment the page loads, not just newly-arriving events.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { io, type Socket } from "socket.io-client";

export type PetalStatus = "pending" | "building" | "completed" | "failed" | "skipped";

export interface PetalProgressPayload {
  key: string;
  label: string;
  description: string;
  status: PetalStatus;
  progress: number;
  summary: string | null;
  reasonSkipped: string | null;
  errorMessage: string | null;
  corpusKey: string | null;
  sourceCount: number;
}

export interface PetalsCompletePayload {
  total: number;
  completed: number;
  skipped: number;
  failed: number;
}

export function usePetalsSocket(caseId: number | null) {
  const [progressByKey, setProgressByKey] = useState<Record<string, PetalProgressPayload>>({});
  const [isGrowing, setIsGrowing] = useState(false);
  const [completion, setCompletion] = useState<PetalsCompletePayload | null>(null);
  const socketRef = useRef<Socket | null>(null);

  useEffect(() => {
    if (!caseId) return;

    const socket = io({ path: "/api/socket.io", transports: ["websocket", "polling"] });
    socketRef.current = socket;

    socket.on("connect", () => socket.emit("join-case", caseId));

    socket.on("petals-started", () => {
      setIsGrowing(true);
      setCompletion(null);
    });

    socket.on("petal-progress", (data: PetalProgressPayload) => {
      setProgressByKey(prev => ({ ...prev, [data.key]: data }));
    });

    socket.on("petals-complete", (data: PetalsCompletePayload) => {
      setIsGrowing(false);
      setCompletion(data);
    });

    return () => {
      socket.emit("leave-case", caseId);
      socket.disconnect();
      socketRef.current = null;
    };
  }, [caseId]);

  /** Pre-populate the map from a REST list (run on first load). */
  const seedFromList = useCallback((rows: Array<Partial<PetalProgressPayload> & { petalKey?: string; key?: string }>) => {
    setProgressByKey(prev => {
      const next = { ...prev };
      for (const row of rows) {
        const key = (row as any).petalKey ?? row.key;
        if (!key) continue;
        // Map DB row shape -> progress payload shape if needed.
        const status = (row.status as PetalStatus) ?? "pending";
        next[key] = {
          key,
          label: row.label ?? key,
          description: row.description ?? "",
          status,
          progress: row.progress ?? 0,
          summary: row.summary ?? null,
          reasonSkipped: row.reasonSkipped ?? null,
          errorMessage: row.errorMessage ?? null,
          corpusKey: row.corpusKey ?? null,
          sourceCount: row.sourceCount ?? 0,
        };
      }
      return next;
    });
    // If any row is in flight, treat as growing.
    if (rows.some(r => r.status === "building")) setIsGrowing(true);
  }, []);

  return { progressByKey, isGrowing, completion, seedFromList };
}
