/**
 * TakeToTrialPanel — replaces the RightDrawer once the user clicks
 * "Take to trial." Splits into:
 *
 *   - middle column: vertical "construction tape" — slow downward motion
 *     showing the orchestrator is working. Each pass-start advances the
 *     tape; pass-end stops it briefly; the next pass-start restarts.
 *   - right column: stream of AI "thinking" stages — pass labels, tool
 *     calls, tool result previews — appearing as the backend emits them.
 *     When the synthesizer completes, the stream is replaced by the
 *     verdict reveal (uncontested findings, structural pivots,
 *     unsupported claims, summary).
 *
 * Driven by useTrialSocket — every line in the right column corresponds
 * to a real backend transition, no cosmetic timers.
 */
import { useEffect, useMemo, useRef } from "react";
import type { TrialStageEvent, TrialState } from "@/hooks/useTrialSocket";
import AiSimulationBand from "./AiSimulationBand";

interface TakeToTrialPanelProps {
  state: TrialState;
  onClose: () => void;
}

interface VerdictShape {
  uncontested?: Array<{ finding: string; citations?: Array<{ sourceLabel: string; passage: string }> }>;
  pivots?: Array<{
    description: string;
    prosecutorPosition?: { text?: string; about?: string };
    defenderPosition?: { text?: string; about?: string };
    kind?: string;
    strength?: "strong" | "moderate" | "speculative";
  }>;
  unsupported?: Array<{ finding: string; note: string }>;
  summary?: string;
}

type PivotStrength = "strong" | "moderate" | "speculative" | undefined;

/** Pivot strength → border color + label color. Strong pivots get the
 *  load-bearing ink color; moderate get amber; speculative get a muted
 *  soft ink tone so the defendant's eye prioritizes the strong ones. */
function strengthChrome(strength: PivotStrength) {
  if (strength === "strong") {
    return { color: "var(--ink)", label: "STRONG", labelColor: "var(--ink)", borderWidth: 4 };
  }
  if (strength === "speculative") {
    return { color: "var(--ink-soft)", label: "SPECULATIVE", labelColor: "var(--ink-soft)", borderWidth: 2 };
  }
  // Default + "moderate"
  return { color: "var(--amber)", label: "MODERATE", labelColor: "var(--amber)", borderWidth: 3 };
}

const PASS_LABEL: Record<string, string> = {
  prosecutor: "prosecutor pass",
  defender: "defender pass",
  synthesizer: "synthesizer pass",
};

export default function TakeToTrialPanel({ state, onClose }: TakeToTrialPanelProps) {
  return (
    <>
      <ConstructionTape state={state} />
      <div className="flex-1 min-w-0 relative overflow-auto" style={{ background: "var(--paper)" }}>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close trial"
          className="absolute z-10 cursor-pointer"
          style={{
            top: 14,
            right: 14,
            background: "transparent",
            border: "none",
            fontFamily: "var(--font-display)",
            fontSize: 28,
            color: "var(--ink-soft)",
            lineHeight: 1,
          }}
        >
          ×
        </button>
        <div className="animate-fade-in-up" style={{ padding: 24 }}>
          {state.kind === "running" && <ThinkingStream events={state.stream} />}
          {state.kind === "complete" && <Verdict verdict={state.verdict as VerdictShape} />}
          {state.kind === "error" && <ErrorState message={state.message} />}
          {state.kind === "idle" && <Idle />}
        </div>
      </div>
    </>
  );
}

/* ─── Middle column: construction tape ──────────────────────────────────── */

function ConstructionTape({ state }: { state: TrialState }) {
  const isActive = state.kind === "running";
  return (
    <div
      className="flex flex-col items-center flex-shrink-0 relative"
      style={{
        width: 96,
        borderLeft: "1.4px solid var(--ink)",
        borderRight: "1.4px solid var(--ink)",
        overflow: "hidden",
      }}
      aria-hidden
    >
      {/* Static label at the top */}
      <div
        style={{
          padding: "16px 8px 10px",
          fontFamily: "var(--font-display)",
          fontSize: 22,
          textAlign: "center",
          color: "var(--ink)",
          borderBottom: "1px solid var(--rule)",
          width: "100%",
        }}
      >
        trial
      </div>
      {/* The downward-scrolling tape stripes */}
      <div
        className="relative flex-1 w-full overflow-hidden"
        style={{
          background:
            "repeating-linear-gradient(45deg, var(--paper) 0 12px, var(--paper-deep) 12px 24px)",
        }}
      >
        <div
          className="absolute inset-0"
          style={{
            background:
              "repeating-linear-gradient(45deg, transparent 0 8px, var(--ink) 8px 9px, transparent 9px 24px)",
            animation: isActive ? "tape-scroll 1.8s linear infinite" : "none",
            opacity: isActive ? 0.5 : 0.2,
          }}
        />
        {/* CAUTION-style border bars */}
        <div
          className="absolute left-0 right-0"
          style={{ top: 0, height: 4, background: "var(--ink)" }}
        />
        <div
          className="absolute left-0 right-0"
          style={{ bottom: 0, height: 4, background: "var(--ink)" }}
        />
        <style>{`
          @keyframes tape-scroll {
            0%   { transform: translateY(-24px); }
            100% { transform: translateY(0); }
          }
        `}</style>
      </div>
      {/* Footer label */}
      <div
        className="mono uppercase"
        style={{
          fontSize: 9,
          letterSpacing: "0.18em",
          padding: "8px 4px",
          color: "var(--ink-soft)",
          borderTop: "1px solid var(--rule)",
          width: "100%",
          textAlign: "center",
        }}
      >
        {isActive ? "in session" : state.kind === "complete" ? "verdict" : "idle"}
      </div>
    </div>
  );
}

/* ─── Right column: thinking stream ─────────────────────────────────────── */

function ThinkingStream({ events }: { events: TrialStageEvent[] }) {
  const scrollerRef = useRef<HTMLDivElement | null>(null);

  // Auto-scroll to the latest event as it arrives.
  useEffect(() => {
    const el = scrollerRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [events]);

  const lines = useMemo(() => renderEventLines(events), [events]);

  return (
    <div ref={scrollerRef} className="flex flex-col gap-3" style={{ paddingTop: 8 }}>
      <SectionHead
        kicker="Take to trial · running"
        title="Watching the case through both lenses…"
      />
      <ol className="list-none p-0 m-0 flex flex-col gap-1.5">
        {lines.map((line, i) => (
          <li
            key={i}
            className={line.dim ? "mono" : ""}
            style={{
              fontFamily: line.dim ? "var(--font-mono)" : "var(--font-display)",
              fontSize: line.dim ? 11 : 18,
              color: line.dim ? "var(--ink-soft)" : "var(--ink)",
              letterSpacing: line.dim ? "0.04em" : 0,
              lineHeight: line.dim ? 1.4 : 1.25,
              paddingLeft: line.indent ? 14 : 0,
            }}
          >
            {line.text}
          </li>
        ))}
      </ol>
    </div>
  );
}

interface RenderedLine {
  text: string;
  dim?: boolean;
  indent?: boolean;
}

function renderEventLines(events: TrialStageEvent[]): RenderedLine[] {
  const out: RenderedLine[] = [];
  for (const e of events) {
    if (e.kind === "start") {
      out.push({ text: "Opening the case file…" });
      continue;
    }
    if (e.kind === "pass-start") {
      out.push({ text: e.label });
      continue;
    }
    if (e.kind === "tool-call") {
      const target = e.target ? ` (${e.target})` : "";
      out.push({
        text: `→ ${e.tool}${target}: ${truncate(e.query, 70)}`,
        dim: true,
        indent: true,
      });
      continue;
    }
    if (e.kind === "tool-result") {
      out.push({
        text: `   ↵ ${truncate(e.preview, 90)}`,
        dim: true,
        indent: true,
      });
      continue;
    }
    if (e.kind === "pass-end") {
      out.push({ text: `${PASS_LABEL[e.pass] ?? e.pass} complete.`, dim: true });
      continue;
    }
  }
  return out;
}

function truncate(s: string, n: number) {
  return s.length > n ? s.slice(0, n - 1) + "…" : s;
}

/* ─── Verdict reveal ────────────────────────────────────────────────────── */

function Verdict({ verdict }: { verdict: VerdictShape }) {
  if (!verdict) return null;
  return (
    <div className="flex flex-col gap-4">
      <SectionHead kicker="Take to trial · verdict" title="Where this case turns." />
      <AiSimulationBand />
      {verdict.summary && (
        <div className="ink-frame" style={{ padding: 18 }}>
          <div
            className="mono uppercase"
            style={{ fontSize: 10, letterSpacing: "0.22em", color: "var(--ink-soft)", marginBottom: 6 }}
          >
            Plain-English summary
          </div>
          <p style={{ margin: 0, fontSize: 15, lineHeight: 1.55, color: "var(--ink)" }}>
            {verdict.summary}
          </p>
        </div>
      )}

      {verdict.pivots && verdict.pivots.length > 0 && (
        <div className="ink-frame" style={{ padding: 18 }}>
          <div
            className="mono uppercase"
            style={{ fontSize: 10, letterSpacing: "0.22em", color: "var(--ink-soft)", marginBottom: 10 }}
          >
            Structural pivots ({verdict.pivots.length})
          </div>
          <div className="flex flex-col gap-3">
            {verdict.pivots.map((p, i) => {
              const chrome = strengthChrome(p.strength);
              return (
              <div
                key={i}
                style={{
                  borderLeft: `${chrome.borderWidth}px solid ${chrome.color}`,
                  padding: "10px 14px",
                  background: "var(--paper-deep)",
                }}
              >
                <div
                  style={{
                    fontFamily: "var(--font-display)",
                    fontSize: 22,
                    lineHeight: 1.1,
                    color: "var(--ink)",
                  }}
                >
                  {p.description}
                </div>
                <div className="flex items-center gap-3" style={{ marginTop: 4 }}>
                  {p.kind && (
                    <div
                      className="mono uppercase"
                      style={{
                        fontSize: 9.5,
                        letterSpacing: "0.18em",
                        color: "var(--ink-soft)",
                      }}
                    >
                      {p.kind}
                    </div>
                  )}
                  <div
                    className="mono uppercase"
                    style={{
                      fontSize: 9.5,
                      letterSpacing: "0.18em",
                      color: chrome.labelColor,
                      fontWeight: 600,
                    }}
                    title="Legal weight of this pivot (separate from how actionable it is)"
                  >
                    · {chrome.label}
                  </div>
                </div>
                <div className="grid gap-2 mt-2" style={{ gridTemplateColumns: "1fr 1fr" }}>
                  <div>
                    <div
                      className="mono uppercase"
                      style={{ fontSize: 9, color: "var(--hot)", letterSpacing: "0.16em" }}
                    >
                      prosecutor
                    </div>
                    <p style={{ margin: "3px 0 0", fontSize: 13.5, lineHeight: 1.5 }}>
                      {p.prosecutorPosition?.text ?? "—"}
                    </p>
                  </div>
                  <div>
                    <div
                      className="mono uppercase"
                      style={{ fontSize: 9, color: "var(--bloom)", letterSpacing: "0.16em" }}
                    >
                      defender
                    </div>
                    <p style={{ margin: "3px 0 0", fontSize: 13.5, lineHeight: 1.5 }}>
                      {p.defenderPosition?.text ?? "—"}
                    </p>
                  </div>
                </div>
              </div>
              );
            })}
          </div>
        </div>
      )}

      {verdict.uncontested && verdict.uncontested.length > 0 && (
        <div className="ink-frame-soft" style={{ padding: 14 }}>
          <div
            className="mono uppercase"
            style={{ fontSize: 10, letterSpacing: "0.22em", color: "var(--ink-soft)", marginBottom: 8 }}
          >
            Uncontested ({verdict.uncontested.length})
          </div>
          <ul className="list-none p-0 m-0 flex flex-col gap-1.5">
            {verdict.uncontested.map((u, i) => (
              <li key={i} style={{ fontSize: 13.5, lineHeight: 1.45, color: "var(--ink)" }}>
                · {u.finding}
              </li>
            ))}
          </ul>
        </div>
      )}

      {verdict.unsupported && verdict.unsupported.length > 0 && (
        <div className="ink-frame-soft" style={{ padding: 14, borderLeft: "3px solid var(--hot)" }}>
          <div
            className="mono uppercase"
            style={{ fontSize: 10, letterSpacing: "0.22em", color: "var(--hot)", marginBottom: 8 }}
          >
            Unsupported ({verdict.unsupported.length})
          </div>
          <ul className="list-none p-0 m-0 flex flex-col gap-2">
            {verdict.unsupported.map((u, i) => (
              <li key={i} style={{ fontSize: 13.5, lineHeight: 1.5, color: "var(--ink)" }}>
                <strong>{u.finding}.</strong>{" "}
                <span style={{ color: "var(--ink-soft)" }}>{u.note}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

/* ─── Idle / error states ───────────────────────────────────────────────── */

function Idle() {
  return (
    <div
      className="flex flex-col items-center justify-center"
      style={{ minHeight: 320, color: "var(--ink-soft)" }}
    >
      <div style={{ fontFamily: "var(--font-display)", fontSize: 28 }}>
        ready to run.
      </div>
      <div className="mono uppercase" style={{ fontSize: 10, letterSpacing: "0.18em", marginTop: 6 }}>
        click take to trial. to begin
      </div>
    </div>
  );
}

function ErrorState({ message }: { message: string }) {
  return (
    <div className="ink-frame" style={{ padding: 18, borderColor: "var(--hot)" }}>
      <div
        className="mono uppercase"
        style={{ fontSize: 10, letterSpacing: "0.22em", color: "var(--hot)", marginBottom: 6 }}
      >
        error
      </div>
      <p style={{ margin: 0, fontSize: 14, lineHeight: 1.5, color: "var(--ink)" }}>
        {message}
      </p>
    </div>
  );
}

function SectionHead({ kicker, title }: { kicker: string; title: string }) {
  return (
    <div style={{ borderBottom: "1px solid var(--rule)", paddingBottom: 10, marginBottom: 12 }}>
      <div
        className="mono uppercase"
        style={{ fontSize: 10, letterSpacing: "0.22em", color: "var(--ink-soft)" }}
      >
        {kicker}
      </div>
      <h2
        style={{
          margin: "2px 0 0",
          fontFamily: "var(--font-display)",
          fontSize: 32,
          lineHeight: 1.05,
          color: "var(--ink)",
          fontWeight: 600,
        }}
      >
        {title}
      </h2>
    </div>
  );
}
