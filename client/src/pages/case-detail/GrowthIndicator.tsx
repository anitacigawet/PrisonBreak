/**
 * GrowthIndicator — the "Growing 4/8" badge pinned top-right of the tree
 * stage, with a hand-drawn arrow + "indicator" label so the user knows
 * what they're looking at.
 *
 * Replaces the floating chip that used to sit alone in the header.
 */
import type { CaseStatus } from "./types";

interface GrowthIndicatorProps {
  status: CaseStatus | "idle";
  /** Index (0-based) of the petal currently being built. */
  activeIdx: number;
  total: number;
  /** True only during the "growing" phase. */
  building: boolean;
  done: boolean;
}

export default function GrowthIndicator({
  status,
  activeIdx,
  total,
  building,
  done,
}: GrowthIndicatorProps) {
  const showAnnotation = status === "growing" || status === "completed" || done;
  const label = done
    ? "Bloomed"
    : status === "analyzing"
      ? "Analyzing"
      : status === "growing"
        ? "Growing"
        : status === "pending"
          ? "Pending"
          : "Awaiting";

  const dotColor = done
    ? "var(--bloom)"
    : status === "analyzing"
      ? "var(--amber)"
      : building
        ? "var(--hot)"
        : "var(--ink-soft)";

  const pulses = building || status === "analyzing";

  return (
    <div
      className="absolute z-10 flex flex-col items-end pointer-events-none"
      style={{ top: 18, right: 22 }}
    >
      <div
        className="pointer-events-auto"
        style={{
          border: "1.4px solid var(--ink)",
          padding: "8px 16px 6px",
          fontFamily: "var(--font-display)",
          fontSize: 28,
          lineHeight: 1,
          background: "var(--paper)",
          boxShadow: building ? "0 0 0 4px oklch(0.55 0.18 25 / .12)" : "none",
          transition: "box-shadow .3s",
          borderRadius: 4,
        }}
      >
        <span
          className="inline-block align-middle"
          style={{
            width: 10,
            height: 10,
            borderRadius: 9999,
            background: dotColor,
            marginRight: 10,
            animation: pulses ? "ink-blink 1s infinite" : "none",
          }}
        />
        {label}
      </div>
      {showAnnotation && (
        <>
          <svg
            width="150"
            height="58"
            viewBox="0 0 150 58"
            style={{ marginTop: -2, marginRight: 4 }}
          >
            <path
              d="M 110 6 C 90 18, 70 28, 50 40"
              stroke="var(--ink)"
              strokeWidth="1.2"
              fill="none"
              strokeLinecap="round"
            />
            <path
              d="M 52 32 L 50 40 L 58 40"
              stroke="var(--ink)"
              strokeWidth="1.2"
              fill="none"
              strokeLinecap="round"
            />
            <text x="0" y="54" fontFamily="Caveat, cursive" fontSize="22" fill="var(--ink)">
              indicator
            </text>
          </svg>
          <div
            className="mono"
            style={{
              fontSize: 10.5,
              color: "var(--ink-soft)",
              marginTop: -6,
              letterSpacing: "0.06em",
            }}
          >
            {done
              ? `${total}/${total} research corpora · ready`
              : `${Math.min(activeIdx + 1, total)}/${total} research corpora · ${building ? "building" : "queued"}`}
          </div>
        </>
      )}
    </div>
  );
}
