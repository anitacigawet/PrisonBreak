/**
 * RightDrawer — the half-page panel that slides in once the tree blooms.
 *
 * Vertical tab strip (Timeline / Notes / Analysis) sits
 * between the tree and the section content. Clicking a tab toggles it open;
 * clicking it again (or the × in the section header) returns to the
 * graph-paper placeholder.
 */
import type { RightSection } from "./types";
import {
  TimelinePanel,
  NotesPanel,
  AnalysisPanel,
  GraphPaperEmpty,
} from "./Panels";

const SECTIONS: RightSection[] = ["timeline", "notes", "analysis"];

interface RightDrawerProps {
  caseId: number;
  section: RightSection | null;
  onSelect: (s: RightSection | null) => void;
}

export default function RightDrawer({ caseId, section, onSelect }: RightDrawerProps) {
  return (
    <>
      <nav
        className="flex flex-col flex-shrink-0"
        style={{
          width: 96,
          borderLeft: "1.4px solid var(--ink)",
          borderRight: "1.4px solid var(--ink)",
        }}
      >
        {SECTIONS.map((s) => (
          <button
            key={s}
            type="button"
            data-active={section === s}
            onClick={() => onSelect(section === s ? null : s)}
            className="drawer-tab"
          >
            {s.charAt(0).toUpperCase() + s.slice(1)}
          </button>
        ))}
      </nav>

      <div
        className="flex-1 min-w-0 relative overflow-auto"
        style={{ background: section ? "var(--paper)" : "transparent" }}
      >
        {section === null && <GraphPaperEmpty />}
        {section !== null && (
          <div className="animate-fade-in-up relative" style={{ padding: 24 }}>
            <button
              type="button"
              onClick={() => onSelect(null)}
              aria-label="Close section"
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
            {section === "timeline" && <TimelinePanel caseId={caseId} />}
            {section === "notes" && <NotesPanel caseId={caseId} />}
            {section === "analysis" && <AnalysisPanel caseId={caseId} />}
          </div>
        )}
      </div>
    </>
  );
}
