/**
 * AiSimulationBand — permanent, prominent disclaimer rendered at the top
 * of any view that displays the Take-to-Trial verdict.
 *
 * The verdict reveal must always carry this warning above any pivot —
 * the orchestrator's output is an adversarial
 * AI-assisted comparison of the documents, not a forecast of how the case will
 * resolve. The wording is the locked framing from RATIONALE.md.
 *
 * Used by both TakeToTrialPanel (during/after the orchestrator runs)
 * and AnalysisPanel (when the verdict is rendered from cache).
 */

export default function AiSimulationBand() {
  return (
    <div
      style={{
        border: "1.4px solid var(--disclaimer, var(--amber))",
        background:
          "repeating-linear-gradient(135deg, color-mix(in srgb, var(--disclaimer, var(--amber)) 14%, var(--paper)) 0 10px, color-mix(in srgb, var(--disclaimer, var(--amber)) 22%, var(--paper)) 10px 11px)",
        padding: "12px 14px",
        borderRadius: 4,
      }}
      role="note"
      aria-label="AI-assisted comparison disclaimer"
    >
      <div className="flex items-baseline gap-2" style={{ marginBottom: 4 }}>
        <span
          aria-hidden
          style={{
            fontFamily: "var(--font-display)",
            fontSize: 18,
            color: "var(--ink)",
            lineHeight: 1,
          }}
        >
          ⚠
        </span>
        <span
          className="mono uppercase"
          style={{ fontSize: 10, letterSpacing: "0.22em", color: "var(--ink)" }}
        >
          AI-assisted comparison · not a forecast
        </span>
      </div>
      <p style={{ margin: 0, fontSize: 13, lineHeight: 1.55, color: "var(--ink)" }}>
        This is an AI-assisted prosecutor-and-defense comparison of the documents you uploaded. It does
        <strong> not</strong> account for: tampered or fabricated evidence,
        prosecutorial discretion, judge tendencies, jury composition, witness
        performance at trial, rulings on similar past cases, evidence not yet
        disclosed, or factors no model can predict. Treat it as a thinking aid,
        not a forecast — and never as a substitute for your attorney's judgment.
      </p>
    </div>
  );
}
