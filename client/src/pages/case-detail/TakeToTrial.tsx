/**
 * TakeToTrial — fixed bottom-right "Take to trial." button.
 *
 * Disabled until the case is bloomed. When ready, clicking it opens the
 * grounded prosecutor/defense comparison (CaseDetail handles that wiring).
 */
interface TakeToTrialProps {
  ready: boolean;
  onClick: () => void;
}

export default function TakeToTrial({ ready, onClick }: TakeToTrialProps) {
  return (
    <div className="fixed z-50" style={{ right: 28, bottom: 56 }}>
      <button
        type="button"
        disabled={!ready}
        onClick={onClick}
        className="ttt inline-flex items-center gap-2.5"
        style={{
          background: ready ? "var(--ink)" : "var(--paper)",
          color: ready ? "var(--paper)" : "var(--ink-soft)",
          border: `1.5px solid ${ready ? "var(--ink)" : "var(--rule)"}`,
          padding: "12px 22px 10px",
          fontFamily: "var(--font-display)",
          fontSize: 28,
          lineHeight: 1,
          cursor: ready ? "pointer" : "not-allowed",
          letterSpacing: "0.01em",
          borderRadius: 4,
          transition: "background .3s, color .3s, opacity .3s",
        }}
      >
        <svg
          width="22"
          height="22"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.4"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M 5 13 L 11 7 M 4 14 L 6 12 L 10 16 L 8 18 Z M 12 6 L 18 12 M 11 7 L 17 13 M 16 4 L 20 8 M 7 21 L 17 21" />
        </svg>
        Take to trial.
      </button>
      {!ready && (
        <div
          className="mono text-right"
          style={{
            fontSize: 10,
            color: "var(--ink-soft)",
            marginTop: 6,
            letterSpacing: "0.06em",
          }}
        >
          unlocks once the case record and research are ready
        </div>
      )}
    </div>
  );
}
