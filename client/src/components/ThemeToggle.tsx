/**
 * ThemeToggle — paper/ink toggle for the case page header.
 *
 * Replaces the generic shadcn Button + lucide Moon/Sun. The redesigned
 * toggle reads as a hand-drawn pair of switches in the manuscript voice:
 *   ☼ paper  |  ◐ ink
 * The active mode is underlined in the bloom color; the inactive mode is
 * faded. Clicking either word flips the theme — there is no separate
 * "button"; the words themselves are the control.
 */
import { useTheme } from "@/hooks/useTheme";

interface ThemeToggleProps {
  /** Compact mode hides the words and just shows the two glyphs. */
  compact?: boolean;
  className?: string;
}

export default function ThemeToggle({ compact = false, className = "" }: ThemeToggleProps) {
  const { theme, toggleTheme } = useTheme();
  const isDark = theme === "dark";

  return (
    <div
      role="group"
      aria-label="Theme"
      className={`inline-flex items-baseline gap-2 select-none ${className}`}
      style={{ fontFamily: "var(--font-display)" }}
    >
      <button
        type="button"
        onClick={isDark ? toggleTheme : undefined}
        aria-pressed={!isDark}
        title="Paper mode"
        className="bg-transparent border-0 cursor-pointer p-0 leading-none"
        style={{
          color: isDark ? "var(--ink-soft)" : "var(--ink)",
          fontSize: 22,
          textDecoration: !isDark ? "underline" : "none",
          textDecorationColor: "var(--bloom)",
          textUnderlineOffset: 4,
          textDecorationThickness: 2,
        }}
      >
        <span aria-hidden style={{ marginRight: 4 }}>☼</span>
        {!compact && "paper"}
      </button>

      <span
        aria-hidden
        style={{ color: "var(--rule)", fontSize: 18, lineHeight: 1 }}
      >
        /
      </span>

      <button
        type="button"
        onClick={!isDark ? toggleTheme : undefined}
        aria-pressed={isDark}
        title="Ink mode"
        className="bg-transparent border-0 cursor-pointer p-0 leading-none"
        style={{
          color: isDark ? "var(--ink)" : "var(--ink-soft)",
          fontSize: 22,
          textDecoration: isDark ? "underline" : "none",
          textDecorationColor: "var(--bloom)",
          textUnderlineOffset: 4,
          textDecorationThickness: 2,
        }}
      >
        <span aria-hidden style={{ marginRight: 4 }}>◐</span>
        {!compact && "ink"}
      </button>
    </div>
  );
}
