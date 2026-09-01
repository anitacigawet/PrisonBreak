/**
 * useTrialSocket — subscribe to a case's Take-to-Trial progress feed.
 *
 * Mirrors the shape of usePetalsSocket but for the orchestrator's
 * `trial-stage` events. Each event is appended to a stream that drives
 * the visualization (construction tape + thinking-stream + verdict
 * reveal). The final `complete` event surfaces the TrialVerdict so the
 * panel can switch from "thinking…" to "verdict" mode.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { io, type Socket } from "socket.io-client";

export type TrialStageEvent =
  | { kind: "start" }
  | { kind: "pass-start"; pass: "prosecutor" | "defender" | "synthesizer"; label: string }
  | { kind: "tool-call"; pass: "prosecutor" | "defender" | "synthesizer"; tool: "queryCase" | "queryPetal"; query: string; target?: string }
  | { kind: "tool-result"; pass: "prosecutor" | "defender" | "synthesizer"; tool: "queryCase" | "queryPetal"; preview: string }
  | { kind: "pass-end"; pass: "prosecutor" | "defender" | "synthesizer" }
  | { kind: "complete"; verdict: unknown }
  | { kind: "error"; message: string };

export type TrialState =
  | { kind: "idle" }
  | { kind: "running"; stream: TrialStageEvent[] }
  | { kind: "complete"; stream: TrialStageEvent[]; verdict: unknown }
  | { kind: "error"; stream: TrialStageEvent[]; message: string };

export function useTrialSocket(caseId: number | null) {
  const [state, setState] = useState<TrialState>({ kind: "idle" });
  const socketRef = useRef<Socket | null>(null);

  useEffect(() => {
    if (!caseId) return;
    const socket = io({ path: "/api/socket.io", transports: ["websocket", "polling"] });
    socketRef.current = socket;

    socket.on("connect", () => socket.emit("join-case", caseId));
    socket.on("trial-stage", (event: TrialStageEvent) => {
      setState((prev) => {
        const stream =
          prev.kind === "idle" ? [] : [...prev.stream, event];
        if (event.kind === "start") {
          return { kind: "running", stream: [event] };
        }
        if (event.kind === "complete") {
          return { kind: "complete", stream, verdict: event.verdict };
        }
        if (event.kind === "error") {
          return { kind: "error", stream, message: event.message };
        }
        return { kind: "running", stream };
      });
    });

    return () => {
      socket.emit("leave-case", caseId);
      socket.disconnect();
      socketRef.current = null;
    };
  }, [caseId]);

  /** Reset to idle — call before re-running. */
  const reset = useCallback(() => setState({ kind: "idle" }), []);

  return { state, reset };
}
