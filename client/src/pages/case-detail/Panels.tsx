/**
 * Right-drawer panels — Timeline, Notes, Analysis.
 *
 * Every panel takes a `caseId` and pulls live data via tRPC. The visual
 * design (ink-frames, hand-drawn headers) matches the rest of the
 * post-redesign case page. Empty/loading/error states render in the
 * same frame language so the UI stays coherent before data lands.
 */
import { useState } from "react";
import { trpc } from "@/lib/trpc";
import AiSimulationBand from "./AiSimulationBand";
import HandoffView from "./HandoffView";

/** Pivot strength → visual chrome. Strong pivots get the load-bearing
 *  ink color + thicker border; moderate get amber; speculative get a
 *  muted soft tone + thin border so the defendant's eye prioritizes
 *  the legally heaviest pivots. Mirrors the helper in TakeToTrialPanel
 *  so the rendering matches whether the verdict is shown live during a
 *  trial run or read back from cache via the Analysis panel. */
function pivotStrengthChrome(
  strength: "strong" | "moderate" | "speculative" | undefined,
) {
  if (strength === "strong") {
    return { color: "var(--ink)", label: "STRONG", labelColor: "var(--ink)", borderWidth: 4 };
  }
  if (strength === "speculative") {
    return { color: "var(--ink-soft)", label: "SPECULATIVE", labelColor: "var(--ink-soft)", borderWidth: 2 };
  }
  return { color: "var(--amber)", label: "MODERATE", labelColor: "var(--amber)", borderWidth: 3 };
}

/* ─── Section header (kicker + handwritten title) ───────────────────────── */

interface SectionHeaderProps {
  kicker: string;
  title: string;
  children?: React.ReactNode;
}
function SectionHeader({ kicker, title, children }: SectionHeaderProps) {
  return (
    <div
      className="flex items-end justify-between gap-3.5"
      style={{
        borderBottom: "1px solid var(--rule)",
        paddingBottom: 10,
        marginBottom: 18,
      }}
    >
      <div>
        <div
          className="mono uppercase"
          style={{
            fontSize: 10,
            letterSpacing: "0.22em",
            color: "var(--ink-soft)",
          }}
        >
          {kicker}
        </div>
        <h2
          style={{
            margin: "2px 0 0",
            fontFamily: "var(--font-display)",
            fontSize: 36,
            lineHeight: 1,
            color: "var(--ink)",
            fontWeight: 600,
          }}
        >
          {title}
        </h2>
      </div>
      <div>{children}</div>
    </div>
  );
}

function EmptyState({ message }: { message: string }) {
  return (
    <div
      className="ink-frame-soft"
      style={{
        padding: "20px 18px",
        color: "var(--ink-soft)",
        fontFamily: "var(--font-display)",
        fontSize: 22,
        textAlign: "center",
      }}
    >
      {message}
    </div>
  );
}

function ErrorState({ message }: { message: string }) {
  return (
    <div className="ink-frame" style={{ padding: 14, borderColor: "var(--hot)" }}>
      <div
        className="mono uppercase"
        style={{ fontSize: 10, letterSpacing: "0.18em", color: "var(--hot)", marginBottom: 4 }}
      >
        error
      </div>
      <p style={{ margin: 0, fontSize: 13.5, lineHeight: 1.5, color: "var(--ink)" }}>{message}</p>
    </div>
  );
}

function MonoTag({ children }: { children: React.ReactNode }) {
  return (
    <span
      className="mono"
      style={{ fontSize: 10, color: "var(--ink-soft)", letterSpacing: "0.08em" }}
    >
      {children}
    </span>
  );
}

function fmtDate(iso: string | Date | null | undefined): string {
  if (!iso) return "";
  const d = typeof iso === "string" ? new Date(iso) : iso;
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleDateString(undefined, { month: "short", day: "2-digit", year: "numeric" });
}

function fmtDateTime(iso: string | Date | null | undefined): string {
  if (!iso) return "";
  const d = typeof iso === "string" ? new Date(iso) : iso;
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleString(undefined, {
    month: "short",
    day: "2-digit",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

/* ─── Timeline ──────────────────────────────────────────────────────────── */
// Built chronologically from real case milestones: case-opened, each
// document upload, the analyze step (if caseFacts populated), each
// completed petal, the trial completion. No fabricated case events.

export function TimelinePanel({ caseId }: { caseId: number }) {
  const caseQuery = trpc.cases.getById.useQuery({ id: caseId });
  const docsQuery = trpc.documents.list.useQuery({ caseId });
  const petalsQuery = trpc.petals.list.useQuery({ caseId });
  const trialQuery = trpc.cases.getTrialResult.useQuery({ caseId });

  const loading =
    caseQuery.isLoading || docsQuery.isLoading || petalsQuery.isLoading || trialQuery.isLoading;
  const error =
    caseQuery.error?.message ??
    docsQuery.error?.message ??
    petalsQuery.error?.message ??
    trialQuery.error?.message ??
    null;

  type TimelineEvt = { at: Date; tag: string; title: string; body: string };
  const events: TimelineEvt[] = [];

  if (caseQuery.data) {
    events.push({
      at: new Date(caseQuery.data.createdAt),
      tag: "opened",
      title: "Case opened",
      body: `${caseQuery.data.title}${caseQuery.data.caseNumber ? ` · ${caseQuery.data.caseNumber}` : ""}.`,
    });
    if (caseQuery.data.caseFacts) {
      events.push({
        at: new Date(caseQuery.data.updatedAt),
        tag: "analyze",
        title: "Facts extracted",
        body: "The indexed case record populated the structured fact sheet.",
      });
    }
  }

  if (docsQuery.data) {
    for (const d of docsQuery.data) {
      events.push({
        at: new Date(d.uploadedAt),
        tag: "upload",
        title: `Uploaded: ${d.fileName}`,
        body: `${(d.fileSize ?? 0).toLocaleString()} bytes · saved locally for indexing.`,
      });
    }
  }

  if (petalsQuery.data) {
    for (const p of petalsQuery.data) {
      if (p.status === "completed" && p.completedAt) {
        events.push({
          at: new Date(p.completedAt),
          tag: "petal",
          title: `Petal bloomed: ${p.petalKey}`,
          body: p.summary ?? "Research corpus built with domain sources.",
        });
      } else if (p.status === "skipped" && p.completedAt) {
        events.push({
          at: new Date(p.completedAt),
          tag: "petal",
          title: `Petal skipped: ${p.petalKey}`,
          body: p.reasonSkipped ?? "Not applicable to this case.",
        });
      }
    }
  }

  if (trialQuery.data) {
    events.push({
      at: new Date(trialQuery.data.completedAt),
      tag: "trial",
      title: "Take-to-Trial verdict ready",
      body: `${trialQuery.data.verdict.pivots.length} structural pivot${trialQuery.data.verdict.pivots.length === 1 ? "" : "s"} identified · ${trialQuery.data.provider}/${trialQuery.data.model}.`,
    });
  }

  events.sort((a, b) => a.at.getTime() - b.at.getTime());

  return (
    <div>
      <SectionHeader kicker="Section · 01" title="Timeline">
        <MonoTag>
          {events.length} event{events.length === 1 ? "" : "s"} · built from case state
        </MonoTag>
      </SectionHeader>
      {loading && <EmptyState message="loading timeline…" />}
      {!loading && error && <ErrorState message={error} />}
      {!loading && !error && events.length === 0 && (
        <EmptyState message="nothing yet — upload documents to start." />
      )}
      {!loading && !error && events.length > 0 && (
        <ol className="list-none p-0 m-0 relative">
          <div
            style={{
              position: "absolute",
              left: 92,
              top: 8,
              bottom: 8,
              width: 1.4,
              background: "var(--ink)",
              opacity: 0.35,
            }}
          />
          {events.map((e, i) => (
            <li key={i} className="flex gap-4" style={{ padding: "10px 0" }}>
              <div
                className="mono text-right flex-shrink-0"
                style={{
                  width: 84,
                  fontSize: 11,
                  color: "var(--ink-soft)",
                  letterSpacing: "0.04em",
                  paddingTop: 7,
                }}
              >
                {fmtDate(e.at)}
              </div>
              <div
                className="flex justify-center flex-shrink-0 relative"
                style={{ width: 14, paddingTop: 11, zIndex: 1 }}
              >
                <span
                  style={{
                    width: 9,
                    height: 9,
                    borderRadius: 9999,
                    background: "var(--paper)",
                    border: "1.4px solid var(--ink)",
                  }}
                />
              </div>
              <div className="ink-frame flex-1" style={{ padding: "10px 14px 12px" }}>
                <div className="flex items-baseline justify-between gap-2.5">
                  <h3
                    style={{
                      margin: 0,
                      fontFamily: "var(--font-display)",
                      fontSize: 22,
                      lineHeight: 1,
                      color: "var(--ink)",
                      fontWeight: 600,
                    }}
                  >
                    {e.title}
                  </h3>
                  <span
                    className="mono uppercase"
                    style={{ fontSize: 9.5, color: "var(--ink-soft)", letterSpacing: "0.14em" }}
                  >
                    {e.tag}
                  </span>
                </div>
                <p style={{ margin: "6px 0 0", fontSize: 14, color: "var(--ink)", lineHeight: 1.5 }}>
                  {e.body}
                </p>
              </div>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}

/* ─── Notes ─────────────────────────────────────────────────────────────── */

export function NotesPanel({ caseId }: { caseId: number }) {
  const utils = trpc.useUtils();
  const notesQuery = trpc.notes.list.useQuery({ caseId });
  const createMutation = trpc.notes.create.useMutation({
    onSuccess: () => {
      void utils.notes.list.invalidate({ caseId });
    },
  });
  const [draft, setDraft] = useState("");

  const notes = notesQuery.data ?? [];
  const submit = () => {
    const content = draft.trim();
    if (!content) return;
    createMutation.mutate({ caseId, content });
    setDraft("");
  };

  return (
    <div>
      <SectionHeader kicker="Section · 02" title="Notes">
        <MonoTag>
          {notes.length} entr{notes.length === 1 ? "y" : "ies"} · your scratch pad
        </MonoTag>
      </SectionHeader>

      <div className="ink-frame" style={{ padding: 14 }}>
        <textarea
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder="Jot something down…"
          rows={3}
          className="w-full"
          style={{
            border: "none",
            outline: "none",
            background: "transparent",
            color: "var(--ink)",
            fontFamily: "var(--font-sans)",
            fontSize: 15,
            lineHeight: 1.55,
            resize: "vertical",
          }}
        />
        <div className="flex justify-between items-center" style={{ marginTop: 8 }}>
          <span className="mono" style={{ fontSize: 10, color: "var(--ink-soft)", letterSpacing: "0.06em" }}>
            saves to this case only
          </span>
          <InkBtn onClick={submit} disabled={createMutation.isPending || !draft.trim()}>
            {createMutation.isPending ? "Adding…" : "Add note"}
          </InkBtn>
        </div>
      </div>

      {notesQuery.error && (
        <div style={{ marginTop: 14 }}>
          <ErrorState message={notesQuery.error.message} />
        </div>
      )}

      <div className="flex flex-col gap-2.5" style={{ marginTop: 18 }}>
        {notesQuery.isLoading && <EmptyState message="loading notes…" />}
        {!notesQuery.isLoading && notes.length === 0 && (
          <EmptyState message="no notes yet — your first goes above." />
        )}
        {notes.map((n) => (
          <div
            key={n.id}
            className="ink-frame-soft"
            style={{ padding: "12px 14px", borderLeft: "3px solid var(--ink)" }}
          >
            <div className="mono" style={{ fontSize: 10, color: "var(--ink-soft)", letterSpacing: "0.06em" }}>
              {fmtDateTime(n.createdAt)}
            </div>
            <p style={{ margin: "4px 0 0", fontSize: 14.5, lineHeight: 1.55, color: "var(--ink)", whiteSpace: "pre-wrap" }}>
              {n.content}
            </p>
          </div>
        ))}
      </div>
    </div>
  );
}

/* ─── Analysis ──────────────────────────────────────────────────────────── */
// Shows the Phase-2 orchestrator verdict (pivots + uncontested +
// unsupported + summary). The legacy "AI-detected errors" surface is
// retired from this panel per the deterministic / simulative split —
// errors moved into Take-to-Trial's grounded reading. Run Take-to-Trial
// from the post-bloom button to populate this panel.

export function AnalysisPanel({ caseId }: { caseId: number }) {
  const utils = trpc.useUtils();
  const trialQuery = trpc.cases.getTrialResult.useQuery({ caseId });
  const caseQuery = trpc.cases.getById.useQuery({ id: caseId });
  const handoffQuery = trpc.cases.getHandoff.useQuery({ caseId });
  const generateHandoffMutation = trpc.cases.generateHandoff.useMutation({
    onSuccess: () => void utils.cases.getHandoff.invalidate({ caseId }),
  });

  const result = trialQuery.data;
  const verdict = result?.verdict;
  const handoff = handoffQuery.data;
  const caseTitle = caseQuery.data?.title ?? `Case #${caseId}`;

  return (
    <div>
      <SectionHeader kicker="Section · 03" title="Analysis">
        <MonoTag>
          {verdict
            ? `${verdict.pivots.length} pivot${verdict.pivots.length === 1 ? "" : "s"} · ${verdict.uncontested.length} uncontested · ${verdict.unsupported.length} unsupported`
            : "Take-to-Trial not yet run"}
        </MonoTag>
      </SectionHeader>

      {trialQuery.isLoading && <EmptyState message="loading verdict…" />}
      {trialQuery.error && <ErrorState message={trialQuery.error.message} />}
      {!trialQuery.isLoading && !trialQuery.error && !result && (
        <EmptyState message="Run Take-to-Trial (bottom-right of the case page) to generate the analysis." />
      )}

      {verdict && (
        <div className="flex flex-col gap-4">
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

          {verdict.pivots.length > 0 && (
            <div className="ink-frame" style={{ padding: 18 }}>
              <div
                className="mono uppercase"
                style={{ fontSize: 10, letterSpacing: "0.22em", color: "var(--ink-soft)", marginBottom: 10 }}
              >
                Structural pivots ({verdict.pivots.length})
              </div>
              <div className="flex flex-col gap-3">
                {verdict.pivots.map((p, i) => {
                  const chrome = pivotStrengthChrome(p.strength);
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
                          {p.prosecutorPosition.text}
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
                          {p.defenderPosition.text}
                        </p>
                      </div>
                    </div>
                  </div>
                  );
                })}
              </div>
            </div>
          )}

          {verdict.uncontested.length > 0 && (
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

          {verdict.unsupported.length > 0 && (
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

          <div
            className="mono"
            style={{
              fontSize: 10,
              letterSpacing: "0.06em",
              color: "var(--ink-soft)",
              textAlign: "right",
            }}
          >
            generated {fmtDateTime(result?.completedAt)} · {result?.provider}/{result?.model}
          </div>

          {/* Defender Handoff — the artifact the defendant brings to their
              PD. The wrapper deliberately uses the same boring legal-letter
              typography as the printed HandoffView (no manuscript flourish,
              no ink-frame) so scrolling from CTA to document doesn't read
              as flashy-AI-tool → paralegal-letter. */}
          <div
            className="print-hide"
            style={{
              fontFamily: 'Georgia, "Times New Roman", serif',
              border: "1px solid var(--rule)",
              padding: "18px 20px",
              borderRadius: 4,
            }}
          >
            <div
              style={{
                fontFamily: '"Courier New", Consolas, monospace',
                fontSize: 10,
                letterSpacing: "0.18em",
                textTransform: "uppercase",
                color: "var(--ink-soft)",
                marginBottom: 6,
              }}
            >
              Bring this to your attorney
            </div>
            <div
              style={{
                fontFamily: '"Courier New", Consolas, monospace',
                fontWeight: 700,
                fontSize: 16,
                color: "var(--ink)",
                marginBottom: 8,
              }}
            >
              DEFENDER HANDOFF — ONE PRINTABLE PAGE
            </div>
            <p style={{ margin: "0 0 14px", fontSize: 13.5, lineHeight: 1.55, color: "var(--ink)" }}>
              The verdict above is for you, to think through your own case. The handoff is for{" "}
              <strong>your public defender</strong> — three prioritized questions, each with a verbatim
              passage cited so they can verify in 30 seconds. Read in under 90 seconds.
            </p>

            {!handoff && !generateHandoffMutation.isPending && (
              <PlainBtn onClick={() => generateHandoffMutation.mutate({ caseId })}>
                Draft one-pager for my PD
              </PlainBtn>
            )}
            {generateHandoffMutation.isPending && (
              <div
                style={{
                  fontFamily: '"Courier New", Consolas, monospace',
                  fontSize: 11,
                  color: "var(--ink-soft)",
                }}
              >
                Composing your handoff… (one LLM call, ~10–30s)
              </div>
            )}
            {generateHandoffMutation.error && (
              <div style={{ marginTop: 10 }}>
                <ErrorState message={generateHandoffMutation.error.message} />
              </div>
            )}
          </div>

          {handoff && (
            <div>
              <div
                className="flex justify-between items-center print-hide"
                style={{ marginBottom: 10 }}
              >
                <span
                  style={{
                    fontFamily: '"Courier New", Consolas, monospace',
                    fontSize: 10,
                    color: "var(--ink-soft)",
                    letterSpacing: "0.06em",
                  }}
                >
                  {handoff.questions.length} question{handoff.questions.length === 1 ? "" : "s"} · printable on one page
                </span>
                <div className="flex gap-2">
                  <PlainBtn onClick={() => window.print()}>Print</PlainBtn>
                  <PlainBtn
                    variant="outline"
                    onClick={() => generateHandoffMutation.mutate({ caseId })}
                  >
                    Regenerate
                  </PlainBtn>
                </div>
              </div>
              <HandoffView handoff={handoff} caseTitle={caseTitle} />
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/* ─── Empty graph-paper placeholder ─────────────────────────────────────── */

export function GraphPaperEmpty() {
  return (
    <div
      className="graph-paper absolute inset-0 flex flex-col items-center justify-center gap-1.5"
      style={{ padding: 24 }}
    >
      <div
        style={{
          fontFamily: "var(--font-display)",
          fontSize: 30,
          color: "var(--ink-soft)",
          lineHeight: 1,
        }}
      >
        click a tab to read
      </div>
      <div
        className="mono uppercase"
        style={{ fontSize: 10, color: "var(--ink-soft)", letterSpacing: "0.18em" }}
      >
        case · constellation · ready
      </div>
    </div>
  );
}

/* ─── Shared ink button ─────────────────────────────────────────────────── */

/** Boring legal-letter button — used by the handoff CTA + actions so they
 *  match the printed HandoffView aesthetic (Georgia serif, plain border).
 *  Distinct from `InkBtn` which is the manuscript-aesthetic primary
 *  button used throughout the rest of the case detail page. */
function PlainBtn({
  onClick,
  children,
  disabled,
  variant = "filled",
}: {
  onClick: () => void;
  children: React.ReactNode;
  disabled?: boolean;
  variant?: "filled" | "outline";
}) {
  const filled = variant === "filled";
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="cursor-pointer flex-shrink-0"
      style={{
        background: filled ? "var(--ink)" : "transparent",
        color: filled ? "var(--paper)" : "var(--ink)",
        border: "1px solid var(--ink)",
        padding: "8px 14px",
        borderRadius: 3,
        fontFamily: '"Courier New", Consolas, monospace',
        fontWeight: 700,
        fontSize: 12,
        letterSpacing: "0.08em",
        textTransform: "uppercase",
        lineHeight: 1.3,
        opacity: disabled ? 0.5 : 1,
      }}
    >
      {children}
    </button>
  );
}

function InkBtn({
  onClick,
  children,
  disabled,
}: {
  onClick: () => void;
  children: React.ReactNode;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="cursor-pointer flex-shrink-0"
      style={{
        background: "var(--ink)",
        color: "var(--paper)",
        border: "1.4px solid var(--ink)",
        padding: "10px 18px 8px",
        borderRadius: 4,
        fontFamily: "var(--font-display)",
        fontSize: 22,
        lineHeight: 1,
        letterSpacing: "0.01em",
        opacity: disabled ? 0.5 : 1,
      }}
    >
      {children}
    </button>
  );
}
