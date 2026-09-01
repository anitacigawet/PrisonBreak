/**
 * HandoffView — renders the Defender Handoff one-pager.
 *
 * Two display modes share the same DOM:
 *   - **Screen**: readable inline, includes a "Print" button at the top.
 *   - **Print** (`@media print`): single-page legal-letter layout, plain
 *     serif/mono typography (NOT the hand-drawn aesthetic — boring is
 *     intentionally restrained). PrisonBreak branding is
 *     hidden in print; the page reads as something a paralegal typed up.
 *
 * The component takes a DefenderHandoff and the case title (for the
 * printable page header). It does NOT fetch — the parent handles
 * loading state.
 */
import type { DefenderHandoff } from "@/types/handoff";

interface HandoffViewProps {
  handoff: DefenderHandoff;
  caseTitle: string;
}

export default function HandoffView({ handoff, caseTitle }: HandoffViewProps) {
  return (
    <>
      {/* Screen-only styles live alongside the component. The .handoff-doc
          container holds everything that should print. */}
      <style>{`
        .handoff-doc {
          font-family: Georgia, "Times New Roman", serif;
          color: #1a1a1a;
          background: #fefefe;
          padding: 32px 36px;
          border: 1px solid #d4d4d4;
          border-radius: 4px;
          max-width: 720px;
          margin: 0 auto;
          line-height: 1.55;
        }
        .handoff-doc h1, .handoff-doc h2, .handoff-doc h3 {
          font-family: "Courier New", Consolas, monospace;
          font-weight: 700;
          letter-spacing: 0.02em;
          color: #1a1a1a;
        }
        .handoff-doc h1 {
          font-size: 18px;
          margin: 0 0 4px;
          text-transform: uppercase;
        }
        .handoff-doc .doc-subtitle {
          font-family: "Courier New", Consolas, monospace;
          font-size: 11px;
          letter-spacing: 0.18em;
          text-transform: uppercase;
          color: #555;
          margin-bottom: 18px;
        }
        .handoff-doc .case-header {
          font-size: 14px;
          font-style: italic;
          margin: 0 0 22px;
          padding-bottom: 14px;
          border-bottom: 1px solid #888;
        }
        .handoff-doc h2 {
          font-size: 12px;
          margin: 0 0 12px;
          text-transform: uppercase;
        }
        .handoff-doc .question {
          margin-bottom: 16px;
          padding-bottom: 14px;
          border-bottom: 1px dotted #ccc;
        }
        .handoff-doc .question:last-of-type { border-bottom: none; }
        .handoff-doc .question-text {
          font-size: 15px;
          font-weight: 600;
          margin: 0 0 8px;
        }
        .handoff-doc .question-meta {
          font-size: 13px;
          margin: 4px 0;
        }
        .handoff-doc .unverified {
          margin: 6px 0;
          padding: 6px 10px;
          background: #fff8e8;
          border-left: 2px solid #b88a00;
          font-size: 11.5px;
          color: #4a3500;
        }
        .handoff-doc .question-meta-label {
          font-family: "Courier New", Consolas, monospace;
          font-size: 10px;
          text-transform: uppercase;
          letter-spacing: 0.12em;
          color: #666;
          display: inline-block;
          margin-right: 6px;
        }
        .handoff-doc blockquote {
          margin: 6px 0 6px 12px;
          padding: 4px 12px;
          border-left: 2px solid #888;
          font-style: italic;
          font-size: 13px;
        }
        .handoff-doc .open-question {
          margin: 22px 0 16px;
          padding: 12px 14px;
          background: #f5f5f0;
          border-left: 3px solid #888;
          font-size: 13.5px;
          font-style: italic;
        }
        .handoff-doc .disclaimer {
          margin-top: 18px;
          padding-top: 14px;
          border-top: 1px solid #ccc;
          font-size: 11.5px;
          color: #555;
          line-height: 1.5;
        }
        .handoff-doc .empty {
          padding: 24px;
          color: #777;
          font-style: italic;
          text-align: center;
        }

        /* Dark mode adjustments — keep contrast but stay plain. */
        @media (prefers-color-scheme: dark) {
          .handoff-doc {
            background: #2b2520;
            color: #ece5dd;
            border-color: #5a4a3d;
          }
          .handoff-doc h1, .handoff-doc h2, .handoff-doc h3 { color: #ece5dd; }
          .handoff-doc .doc-subtitle { color: #b9a89b; }
          .handoff-doc .case-header { border-bottom-color: #7a6857; }
          .handoff-doc .question { border-bottom-color: #4a3e34; }
          .handoff-doc .question-meta-label { color: #b9a89b; }
          .handoff-doc blockquote { border-left-color: #b9a89b; }
          .handoff-doc .open-question { background: #3a312a; border-left-color: #b9a89b; }
          .handoff-doc .disclaimer { color: #b9a89b; border-top-color: #5a4a3d; }
          .handoff-doc .unverified {
            background: #3a2e1a;
            border-left-color: #d4a838;
            color: #f0d896;
          }
        }

        /* Print: single page, plain background, no surrounding chrome. */
        @media print {
          @page { size: letter; margin: 0.6in; }
          body * { visibility: hidden !important; }
          .handoff-doc, .handoff-doc * { visibility: visible !important; }
          .handoff-doc {
            position: absolute !important;
            inset: 0 !important;
            background: #fff !important;
            color: #000 !important;
            border: none !important;
            padding: 0 !important;
            max-width: none !important;
            font-size: 11.5pt;
          }
          .handoff-doc .print-hide { display: none !important; }
          .handoff-doc blockquote { font-size: 10.5pt; }
          .handoff-doc .question-meta { font-size: 10.5pt; }
          .handoff-doc .disclaimer { color: #444 !important; }
        }
      `}</style>

      <div className="handoff-doc">
        <h1>Questions for my public defender</h1>
        <div className="doc-subtitle">re: {caseTitle}</div>

        <p className="case-header">{handoff.caseHeader}</p>

        {handoff.questions.length === 0 ? (
          <div className="empty">
            No actionable pivots were identified from the current verdict. Discuss
            the verdict directly with your attorney.
          </div>
        ) : (
          <>
            <h2>Three questions, in priority order</h2>
            {handoff.questions.map((q, i) => (
              <div key={i} className="question">
                <div className="question-text">
                  Q{i + 1}. {q.question}
                </div>
                <div className="question-meta">
                  <span className="question-meta-label">Why I'm asking:</span>
                  {q.whyAsking}
                </div>
                {q.verified === false && (
                  <div className="unverified">
                    <strong>Quote not auto-verified.</strong>{" "}
                    {q.verificationNote ??
                      "Open the source document directly to confirm the exact wording."}
                  </div>
                )}
                <div className="question-meta">
                  <span className="question-meta-label">Source:</span>
                  {q.sourceUrl ? (
                    <a href={q.sourceUrl} target="_blank" rel="noreferrer">
                      <em>{q.sourceLabel}</em>
                    </a>
                  ) : (
                    <em>{q.sourceLabel}</em>
                  )}
                  {q.locator ? ` · ${q.locator}` : ""}
                </div>
                <div className="question-meta">
                  <span className="question-meta-label">If yes:</span>
                  {q.whatYesMeans}
                </div>
                <div className="question-meta">
                  <span className="question-meta-label">If no:</span>
                  {q.whatNoMeans}
                </div>
              </div>
            ))}
          </>
        )}

        <p className="open-question">{handoff.openQuestion}</p>

        <p className="disclaimer">{handoff.disclaimer}</p>
      </div>
    </>
  );
}
