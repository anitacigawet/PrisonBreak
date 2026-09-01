/**
 * PrebloomCard — the single ink-frame card that appears below the tree
 * during the Upload / Analyze / Analyzing / Begin-grow phases.
 *
 * Replaces the older "meh" CTA card; now the card morphs through the four
 * phases in place rather than being four separate cards.
 */
import { useEffect, useState } from "react";
import type { CaseDoc, CasePhase } from "./types";

interface PrebloomCardProps {
  phase: CasePhase;
  docs: CaseDoc[];
  onUpload: () => void;
  onAnalyze: () => void;
  onBeginGrow: () => void;
}

const ANALYZE_PHASES = [
  "Opening the case notebook…",
  "Reading the uploaded sources…",
  "Reasoning over the case structure…",
  "Drafting the standardized fact sheet…",
  "Validating proofs and citations…",
];

export default function PrebloomCard({ phase, docs, onUpload, onAnalyze, onBeginGrow }: PrebloomCardProps) {
  return (
    <div
      className="animate-fade-in-up"
      style={{ maxWidth: 620, margin: "0 auto 24px", padding: "0 24px" }}
    >
      <div className="ink-frame" style={{ padding: 22 }}>
        {phase === "upload" && <UploadStep onUpload={onUpload} />}
        {phase === "analyze" && <AnalyzeStep docs={docs} onAnalyze={onAnalyze} />}
        {phase === "analyzing" && <AnalyzingStep />}
        {phase === "grow" && <BeginGrowStep onBeginGrow={onBeginGrow} />}
      </div>
    </div>
  );
}

/* ─── Sub-phases ────────────────────────────────────────────────────────── */

function UploadStep({ onUpload }: { onUpload: () => void }) {
  return (
    <>
      <Step n={1} label="Upload case documents" />
      <div
        onClick={onUpload}
        role="button"
        tabIndex={0}
        className="text-center cursor-pointer"
        style={{
          marginTop: 14,
          padding: "26px 18px",
          border: "1.2px dashed var(--ink)",
          borderRadius: 4,
          background: "transparent",
        }}
      >
        <UploadGlyph />
        <div
          style={{
            fontFamily: "var(--font-display)",
            fontSize: 24,
            color: "var(--ink)",
            marginTop: 6,
            lineHeight: 1,
          }}
        >
          Drop files or click to browse
        </div>
        <div
          className="mono"
          style={{
            fontSize: 10.5,
            color: "var(--ink-soft)",
            marginTop: 8,
            letterSpacing: "0.08em",
          }}
        >
          pdf · docx · txt
        </div>
      </div>
    </>
  );
}

function AnalyzeStep({ docs, onAnalyze }: { docs: CaseDoc[]; onAnalyze: () => void }) {
  return (
    <div className="flex items-center justify-between gap-4">
      <div className="min-w-0">
        <Step n={2} label="Analyze documents" />
        <div
          className="mono"
          style={{
            fontSize: 11,
            color: "var(--ink-soft)",
            marginTop: 6,
            letterSpacing: "0.08em",
          }}
        >
          {docs.length} document{docs.length === 1 ? "" : "s"} ready · extracts a standardized fact sheet
        </div>
      </div>
      <InkButton onClick={onAnalyze} label="Analyze →" />
    </div>
  );
}

function AnalyzingStep() {
  const [idx, setIdx] = useState(0);
  useEffect(() => {
    setIdx(0);
    const t = setInterval(() => setIdx((p) => Math.min(ANALYZE_PHASES.length - 1, p + 1)), 1800);
    return () => clearInterval(t);
  }, []);
  return (
    <div className="flex items-center gap-3.5">
      <Spinner />
      <div
        style={{
          flex: 1,
          fontFamily: "var(--font-display)",
          fontSize: 24,
          color: "var(--ink)",
          lineHeight: 1,
          transition: "opacity .3s",
        }}
      >
        {ANALYZE_PHASES[idx]}
      </div>
      <span
        className="mono uppercase flex-shrink-0"
        style={{
          fontSize: 10.5,
          color: "var(--ink-soft)",
          letterSpacing: "0.08em",
        }}
      >
        stage {idx + 1} of {ANALYZE_PHASES.length}
      </span>
    </div>
  );
}

function BeginGrowStep({ onBeginGrow }: { onBeginGrow: () => void }) {
  return (
    <div className="flex items-center justify-between gap-4">
      <div className="min-w-0">
        <Step n={3} label="Begin growing" />
        <div
          className="mono"
          style={{
            fontSize: 11,
            color: "var(--ink-soft)",
            marginTop: 6,
            letterSpacing: "0.08em",
          }}
        >
          one source-grounded corpus per research domain · 8 in this case
        </div>
      </div>
      <InkButton onClick={onBeginGrow} label="🌱  Begin growing" />
    </div>
  );
}

/* ─── Atoms ─────────────────────────────────────────────────────────────── */

function Step({ n, label }: { n: number; label: string }) {
  return (
    <div>
      <div
        style={{
          fontFamily: "var(--font-display)",
          fontSize: 28,
          lineHeight: 1,
          color: "var(--ink)",
        }}
      >
        {label}
      </div>
      <div
        className="mono uppercase"
        style={{
          fontSize: 10.5,
          color: "var(--ink-soft)",
          marginTop: 4,
          letterSpacing: "0.18em",
        }}
      >
        step {n} of 3
      </div>
    </div>
  );
}

function InkButton({ onClick, label, disabled }: { onClick: () => void; label: string; disabled?: boolean }) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      type="button"
      style={{
        background: "var(--ink)",
        color: "var(--paper)",
        border: "1.4px solid var(--ink)",
        padding: "10px 18px 8px",
        borderRadius: 4,
        fontFamily: "var(--font-display)",
        fontSize: 22,
        lineHeight: 1,
        cursor: disabled ? "not-allowed" : "pointer",
        opacity: disabled ? 0.4 : 1,
        flexShrink: 0,
        letterSpacing: "0.01em",
      }}
    >
      {label}
    </button>
  );
}

function Spinner() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" className="flex-shrink-0">
      <circle cx="12" cy="12" r="9" fill="none" stroke="var(--rule)" strokeWidth="1.8" />
      <path
        d="M 12 3 A 9 9 0 0 1 21 12"
        fill="none"
        stroke="var(--ink)"
        strokeWidth="1.8"
        strokeLinecap="round"
      >
        <animateTransform
          attributeName="transform"
          type="rotate"
          from="0 12 12"
          to="360 12 12"
          dur=".9s"
          repeatCount="indefinite"
        />
      </path>
    </svg>
  );
}

function UploadGlyph() {
  return (
    <svg
      width="28"
      height="28"
      viewBox="0 0 24 24"
      fill="none"
      stroke="var(--ink-soft)"
      strokeWidth="1.4"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="inline-block"
    >
      <path d="M 12 4 L 12 16 M 7 9 L 12 4 L 17 9 M 4 19 L 20 19" />
    </svg>
  );
}
