/**
 * DisclaimerFooter — quiet mono rule at the bottom of the page.
 *
 * Replaces the loud red destructive banner. The new treatment is a single
 * monospaced line hugging the bottom rule, in the ink-soft color, with a
 * small amber Caveat ⚠ glyph. It's always visible but doesn't fight for
 * attention.
 *
 * Tip: render in App.tsx as before; CaseDetail leaves 56px of bottom
 * padding on the stage when this is mounted.
 */
export function DisclaimerFooter() {
  return (
    <div className="disclaimer-rule" role="note">
      <span className="glyph" aria-hidden>
        ⚠
      </span>
      <span>
        AI-assisted research · not legal advice · review every source and finding
        with a licensed attorney before any action · © 2026 ScootSolute LLC.
      </span>
    </div>
  );
}
