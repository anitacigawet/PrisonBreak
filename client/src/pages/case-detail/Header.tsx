/** Manuscript title block for the case workspace. */
import ThemeToggle from "@/components/ThemeToggle";
import type { CaseData, CaseStatus } from "./types";

interface HeaderProps {
  caseData: CaseData;
  status: CaseStatus;
  onEdit?: () => void;
  onDelete?: () => void;
  onBack?: () => void;
}

export default function Header({ caseData, status, onEdit, onDelete, onBack }: HeaderProps) {
  return (
    <header
      className="flex items-start justify-between gap-6"
      style={{ padding: "26px 36px 18px", borderBottom: "1px solid var(--rule)" }}
    >
      <div className="flex-1 min-w-0">
        <div
          className="mono uppercase"
          style={{
            fontSize: 10.5,
            letterSpacing: "0.22em",
            color: "var(--ink-soft)",
            marginBottom: 6,
          }}
        >
          PrisonBreak · Case File
        </div>
        <div className="flex items-baseline gap-3 flex-wrap">
          <h1
            style={{
              margin: 0,
              fontFamily: "var(--font-display)",
              fontWeight: 600,
              fontSize: 46,
              lineHeight: 1,
              color: "var(--ink)",
            }}
          >
            {caseData.title}
          </h1>
          <CornerIcons onEdit={onEdit} onDelete={onDelete} />
          <StatusInk status={status} />
        </div>
        <div
          className="mono"
          style={{
            fontSize: 11,
            color: "var(--ink-soft)",
            marginTop: 7,
            letterSpacing: "0.05em",
          }}
        >
          Case #{caseData.caseNumber} · {caseData.jurisdiction} · opened {caseData.opened}
        </div>
      </div>
      <RightCluster onBack={onBack} />
    </header>
  );
}

function RightCluster({ onBack }: { onBack?: () => void }) {
  return (
    <div className="flex items-center gap-3.5 flex-shrink-0" style={{ paddingTop: 4 }}>
      <BackLink onClick={onBack} />
      <ThemeToggle />
    </div>
  );
}

function BackLink({ onClick }: { onClick?: () => void }) {
  return (
    <a
      href="#"
      onClick={(event) => {
        if (onClick) {
          event.preventDefault();
          onClick();
        }
      }}
      className="mono uppercase no-underline"
      style={{
        fontSize: 10.5,
        letterSpacing: "0.18em",
        color: "var(--ink-soft)",
      }}
    >
      ← dashboard
    </a>
  );
}

function CornerIcons({ onEdit, onDelete }: { onEdit?: () => void; onDelete?: () => void }) {
  const iconButton: React.CSSProperties = {
    background: "transparent",
    border: "none",
    padding: 4,
    cursor: "pointer",
    color: "var(--ink-soft)",
    lineHeight: 0,
    borderRadius: 3,
  };

  return (
    <span className="inline-flex items-center gap-1">
      <button onClick={onEdit} title="Edit case" style={iconButton} type="button">
        <svg
          width="14"
          height="14"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.4"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M 4 18 L 4 20 L 6 20 L 18 8 L 16 6 L 4 18 Z" />
          <path d="M 15 6.5 L 17.5 9" />
        </svg>
      </button>
      <button onClick={onDelete} title="Delete case" style={iconButton} type="button">
        <svg
          width="14"
          height="14"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.4"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M 5 7 L 19 7 M 9 7 L 9 5 L 15 5 L 15 7 M 7 7 L 8 20 L 16 20 L 17 7 M 10 11 L 10 17 M 14 11 L 14 17" />
        </svg>
      </button>
    </span>
  );
}

const STATUS_META: Record<
  CaseStatus,
  { label: string; tone: "soft" | "hot" | "bloom"; pulse?: boolean }
> = {
  pending: { label: "Pending", tone: "soft" },
  analyzing: { label: "Analyzing", tone: "hot", pulse: true },
  growing: { label: "Growing", tone: "hot", pulse: true },
  completed: { label: "Bloomed", tone: "bloom" },
};

function toneColor(tone: "soft" | "hot" | "bloom") {
  if (tone === "bloom") return "var(--bloom)";
  if (tone === "hot") return "var(--hot)";
  return "var(--ink-soft)";
}

function StatusInk({ status }: { status: CaseStatus }) {
  const metadata = STATUS_META[status];
  const color = toneColor(metadata.tone);

  return (
    <span
      className="inline-flex items-center gap-2"
      style={{
        fontFamily: "var(--font-display)",
        fontSize: 30,
        lineHeight: 1,
        color,
      }}
    >
      <svg width="14" height="14" viewBox="0 0 14 14" style={{ marginBottom: 2 }}>
        <path
          d="M 7 1.5 L 12.5 7 L 7 12.5 L 1.5 7 Z"
          fill="none"
          stroke={color}
          strokeWidth="1.4"
        />
        {metadata.pulse && (
          <circle cx="7" cy="7" r="2.4" fill={color}>
            <animate
              attributeName="opacity"
              values="1;0.2;1"
              dur="1s"
              repeatCount="indefinite"
            />
          </circle>
        )}
        {metadata.tone === "bloom" && <circle cx="7" cy="7" r="2.4" fill={color} />}
      </svg>
      {metadata.label}
    </span>
  );
}
