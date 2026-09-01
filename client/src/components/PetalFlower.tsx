/**
 * PetalFlower — paper-theme devil's-trumpet based on the original
 * interface sketch.
 *
 *   - All 8 leaves emerge from a single base point at bottom-center
 *   - Single-weight ink stroke on cream paper (no glow, no gradients)
 *   - Bulb-shaped almond petals, slightly varied in size/curve so the
 *     cluster reads as organic rather than mechanical
 *   - One detached "trial" bud floats above the cluster (matches the
 *     sketch's separate top bud)
 *
 * Per-status visual (matches the existing socket payload statuses):
 *   - pending  → faint pencil outline, no fill
 *   - building → ink outline + diagonal hatch fill that progressively
 *                reveals from base toward tip as `progress` climbs
 *   - completed → leaf wash + small devil's-trumpet flower at the tip
 *   - skipped  → very faint pencil outline (Phase-1 reality: forensics /
 *                id_confession / etc. mark themselves skipped today)
 *   - failed   → red ink stroke + faint red wash
 *
 * Click behavior is owned by the parent — pass `onPetalClick` to receive
 * the petal key. Clicking a bloomed petal surfaces the retained-source
 * summary for that research corpus.
 *
 * The "Growing petal / building research corpus" callout that floats next to
 * the active leaf is rendered HERE inside the SVG so its leader-line
 * can anchor precisely to the leaf's midpoint.
 */
import { useMemo } from "react";
import type {
  PetalProgressPayload,
  PetalStatus,
} from "@/hooks/usePetalsSocket";

interface CatalogEntry {
  key: string;
  label: string;
  description: string;
}

interface PetalFlowerProps {
  catalog: CatalogEntry[];
  progressByKey: Record<string, PetalProgressPayload>;
  activeKey?: string | null;
  onPetalClick?: (key: string) => void;
  /** Hide the inline "growing pedal" callout (e.g. when the parent
   *  renders it elsewhere on small screens). Default: false. */
  hideBuildingCallout?: boolean;
}

const VIEWBOX_W = 760;
const VIEWBOX_H = 980;

/**
 * Per-petal geometry. Each entry is one research domain from the registry;
 * order matches `server/petals/registry.ts` so the build sequence
 * (laws → jurisprudence → … → cost) reads left-to-right / outside-in
 * across the plant exactly like the sketch.
 *
 *   stem  — quadratic curve from base → tip (the leaf's center axis)
 *   leaf  — outline path of the almond/bulb shape
 *   tip   — {x,y} where the bloom flower lands when completed
 *   mid   — {x,y} for the callout leader-line anchor
 *   subs  — short list of sub-categories shown inside the active-petal
 *           callout (this is the content the original "Laws bubble" was an
 *           example of — it lives in the callout now, not as a
 *           separate floating bubble)
 */
const GEOMETRY: Record<string, {
  stem: string | null;
  leaf: string;
  tail?: string;
  tip: { x: number; y: number };
  mid: { x: number; y: number };
  subs: string[];
  detached?: boolean;
}> = {
  laws: {
    // mid-left leaf. Stem terminates at the leaf's base-facing edge
    // (lower-right of the leaf) rather than the tip — so the line
    // visually touches the leaf without entering its body.
    stem: "M380,900 C 360,830 310,750 265,665",
    leaf: "M215,535 C 160,520 110,560 105,620 C 105,675 175,690 240,650 C 300,610 280,548 215,535 Z",
    tip:  { x: 215, y: 535 },
    mid:  { x: 195, y: 595 },
    subs: ["city", "state", "county", "federal"],
  },
  jurisprudence: {
    // mid-right leaf. Stem ends at the lower-left edge of the leaf.
    stem: "M380,900 C 405,830 455,750 495,665",
    leaf: "M555,540 C 610,530 660,575 660,630 C 660,680 595,685 530,650 C 475,615 495,548 555,540 Z",
    tip:  { x: 555, y: 540 },
    mid:  { x: 580, y: 595 },
    subs: ["precedent", "holdings", "citations"],
  },
  procedural: {
    // upper-left leaf — nudged LEFT 30 units to clear id_confession.
    // Shape unchanged; coordinates translated.
    stem: "M380,900 C 360,780 320,640 285,495",
    leaf: "M240,330 C 190,320 145,355 145,420 C 145,495 215,520 275,470 C 325,425 300,345 240,330 Z",
    tip:  { x: 240, y: 330 },
    mid:  { x: 210, y: 415 },
    subs: ["motions", "deadlines", "filings"],
  },
  patterns: {
    // upper-right leaf — nudged RIGHT 30 units to clear id_confession.
    stem: "M380,900 C 400,780 440,640 480,495",
    leaf: "M530,330 C 585,318 635,355 635,420 C 635,495 560,520 500,470 C 450,425 475,345 530,330 Z",
    tip:  { x: 530, y: 330 },
    mid:  { x: 565, y: 415 },
    subs: ["priors", "modus", "statistics"],
  },
  demographics: {
    // lower-left out-swing — nudged DOWN 45 total from original so the
    // leaf clears the laws leaf above it cleanly.
    stem: "M380,900 C 365,870 295,830 220,780",
    leaf: "M175,685 C 120,657 70,685 55,745 C 50,785 95,805 160,785 C 230,765 250,725 175,685 Z",
    tip:  { x: 175, y: 685 },
    mid:  { x: 165, y: 745 },
    subs: ["venue", "jury pool", "bias"],
  },
  forensics: {
    // lower-right out-swing — nudged DOWN 45 total to clear jurisprudence.
    stem: "M380,900 C 405,870 480,830 560,785",
    leaf: "M590,705 C 640,695 690,725 700,775 C 695,820 640,820 575,790 C 525,765 535,717 590,705 Z",
    tip:  { x: 590, y: 705 },
    mid:  { x: 615, y: 750 },
    subs: ["lab", "chain of custody", "expert"],
  },
  id_confession: {
    // tall central leaf going straight up. Stem ends at the leaf's
    // bottom point (right where the leaf body begins).
    stem: "M380,900 C 380,750 380,580 380,440",
    leaf: "M380,250 C 340,250 310,290 315,360 C 320,430 365,440 380,440 C 395,440 440,430 445,360 C 450,290 420,250 380,250 Z",
    tip:  { x: 380, y: 250 },
    mid:  { x: 380, y: 350 },
    subs: ["procedures", "miranda", "statements"],
  },
  cost: {
    // detached top bud — floats above the cluster, matches the sketch.
    // (The "tail" curl on the bud was removed after visual review —
    // the squiggle didn't read clean against the rest of the plant.)
    stem: null,
    leaf: "M395,140 C 350,130 320,160 320,200 C 320,238 360,250 395,238 C 432,225 442,180 432,160 C 422,142 410,140 395,140 Z",
    tip:  { x: 380, y: 175 },
    mid:  { x: 380, y: 195 },
    subs: ["budget", "time", "risk"],
    detached: true,
  },
};

const STATUS_ORDER: Record<PetalStatus, number> = {
  skipped: 0,
  pending: 1,
  failed: 2,
  completed: 3,
  building: 4,
};

function inkStrokeFor(status: PetalStatus): { color: string; width: number; opacity: number } {
  switch (status) {
    case "completed": return { color: "var(--ink)", width: 1.4, opacity: 1 };
    case "building":  return { color: "var(--ink)", width: 1.6, opacity: 1 };
    case "failed":    return { color: "var(--hot)", width: 1.4, opacity: 1 };
    case "skipped":   return { color: "var(--ink)", width: 1.0, opacity: 0.35 };
    case "pending":
    default:          return { color: "var(--ink)", width: 1.0, opacity: 0.55 };
  }
}

function Bloom() {
  return (
    <g>
      <path
        d="M -14 -2 C -18 -22, 14 -22, 14 -2 C 12 8, -12 8, -14 -2 Z"
        fill="var(--paper)"
        stroke="var(--ink)"
        strokeWidth="1"
      />
      <path
        d="M -10 -2 C -12 -16, 10 -16, 10 -2 Z"
        fill="var(--flower)"
        fillOpacity="0.5"
      />
      <circle cx="0" cy="-1" r="1.2" fill="var(--ink)" />
      <path d="M 0 -2 L 0 -14" stroke="var(--ink)" strokeWidth="0.7" />
      <path d="M -4 -3 L -6 -13" stroke="var(--ink)" strokeWidth="0.6" />
      <path d="M 4 -3 L 6 -13" stroke="var(--ink)" strokeWidth="0.6" />
    </g>
  );
}

interface PetalProps {
  geometryKey: string;
  status: PetalStatus;
  progress: number; // 0..100
  isActive: boolean;
  onClick?: () => void;
}

function Petal({ geometryKey, status, progress, isActive, onClick }: PetalProps) {
  const g = GEOMETRY[geometryKey];
  if (!g) return null;
  const stroke = inkStrokeFor(status);
  const pct = Math.max(0, Math.min(100, progress)) / 100;

  // Diagonal hatching for the building state — stripes are progressively
  // revealed by toggling their opacity based on `progress`.
  const stripeCount = 44;
  const stripes = Array.from({ length: stripeCount }, (_, i) => i - 20);

  return (
    <g
      onClick={onClick}
      style={{ cursor: onClick ? "pointer" : "default" }}
      data-petal={geometryKey}
      data-status={status}
    >
      {/* stem */}
      {g.stem && (
        <path
          d={g.stem}
          stroke={stroke.color}
          strokeWidth={status === "pending" || status === "skipped" ? 1 : 1.4}
          strokeOpacity={stroke.opacity}
          fill="none"
          strokeLinecap="round"
          style={{ transition: "stroke 0.4s, stroke-opacity 0.4s" }}
        />
      )}
      {/* curl on detached bud */}
      {g.tail && (
        <path
          d={g.tail}
          stroke={stroke.color}
          strokeWidth="1.2"
          strokeOpacity={stroke.opacity}
          fill="none"
          strokeLinecap="round"
        />
      )}

      {/* completed-state leaf wash */}
      {status === "completed" && (
        <>
          <path d={g.leaf} fill="var(--bloom)" fillOpacity="0.16" />
          <path d={g.leaf} fill="var(--bloom-soft)" fillOpacity="0.42" />
          {g.stem && (
            <path d={g.stem} stroke="var(--bloom)" strokeWidth="0.9" strokeOpacity="0.55" fill="none" />
          )}
        </>
      )}

      {/* failed-state faint wash */}
      {status === "failed" && (
        <path d={g.leaf} fill="var(--hot)" fillOpacity="0.10" />
      )}

      {/* building-state hatching (clipped to the leaf shape) */}
      {status === "building" && (
        <g clipPath={`url(#clip-${geometryKey})`}>
          <path d={g.leaf} fill="var(--paper-deep)" fillOpacity="0.55" />
          {stripes.map((i) => {
            const x = i * 14;
            const visible = (i / 24) < pct * 1.2 - 0.15;
            return (
              <line
                key={`s-${i}`}
                x1={x}
                y1={-200}
                x2={x + 260}
                y2={1100}
                stroke="var(--ink)"
                strokeWidth="0.9"
                strokeOpacity={visible ? 0.7 : 0}
                style={{ transition: "stroke-opacity 0.4s ease" }}
              />
            );
          })}
          {/* cross-hatching on the leading edge for the back half */}
          <g style={{ opacity: pct > 0.55 ? (pct - 0.55) / 0.45 * 0.55 : 0, transition: "opacity 0.4s" }}>
            {stripes.map((i) => (
              <line
                key={`x-${i}`}
                x1={i * 16 - 200}
                y1={1000}
                x2={i * 16 + 200}
                y2={-200}
                stroke="var(--ink)"
                strokeWidth="0.7"
                strokeOpacity="0.6"
              />
            ))}
          </g>
        </g>
      )}

      {/* outline — always last so it stays crisp */}
      <path
        d={g.leaf}
        fill="transparent"
        stroke={stroke.color}
        strokeWidth={isActive ? stroke.width + 0.4 : stroke.width}
        strokeOpacity={stroke.opacity}
        strokeLinejoin="round"
        strokeLinecap="round"
        style={{ transition: "stroke-width 0.3s, stroke-opacity 0.4s" }}
      />

      {/* bloom flower at tip — completed only */}
      {status === "completed" && (
        <g transform={`translate(${g.tip.x} ${g.tip.y})`}>
          <Bloom />
        </g>
      )}
    </g>
  );
}

interface CalloutProps {
  label: string;
  description: string;
  subs: string[];
  progress: number;
  anchor: { x: number; y: number };
}

const STAGES = ["seed", "outline", "leaflets", "bloom"];

/**
 * Geometry for the callout — box position, leader-line path, and the
 * arrowhead at the leaf end. The leader-line now stops at a point JUST
 * OUTSIDE the leaf body (anchor.x - 95), so the whole line is visible
 * AND there's room for a hand-drawn arrowhead pointing AT the leaf.
 * No more "where does this line go?" ambiguity.
 */
const ARROW_GAP = 95;   // how far outside the leaf-mid the line stops
const ARROW_BARB = 11;  // arrowhead barb length

function calloutLayout(anchor: { x: number; y: number }) {
  // Box sits below the active leaf so it doesn't visually fight with
  // the petal. For laws (which is the most cramped on the left side)
  // this keeps the callout in clearer space; for the upper leaves it
  // tucks the callout in the middle area.
  const boxLeft = Math.max(20, Math.min(500, anchor.x - 120));
  const boxTop = anchor.y + 130;

  // Line endpoint sits OUTSIDE the leaf body, slightly below the mid,
  // pointing UP at the leaf so the arrowhead is unambiguous.
  const tipX = anchor.x;
  const tipY = anchor.y + 70;

  const leaderPath =
    `M ${boxLeft + 120} ${boxTop} ` +
    `C ${boxLeft + 120} ${boxTop - 20}, ` +
    `${tipX} ${(tipY + boxTop) / 2}, ` +
    `${tipX} ${tipY}`;

  // Arrowhead — direction is UP (toward the leaf, which is above the
  // box). Perpendicular is horizontal so the barbs sit at ±X of the tip.
  const dirX = 0;
  const dirY = -1;
  // perpendicular for barbs (rotate dir by 90°)
  const perpX = -dirY; // = 1
  const perpY = dirX;  // = 0
  const barb1x = tipX - ARROW_BARB * dirX + ARROW_BARB * 0.55 * perpX;
  const barb1y = tipY - ARROW_BARB * dirY + ARROW_BARB * 0.55 * perpY;
  const barb2x = tipX - ARROW_BARB * dirX - ARROW_BARB * 0.55 * perpX;
  const barb2y = tipY - ARROW_BARB * dirY - ARROW_BARB * 0.55 * perpY;
  const arrowPath =
    `M ${barb1x} ${barb1y} L ${tipX} ${tipY} L ${barb2x} ${barb2y}`;

  return { boxLeft, boxTop, leaderPath, arrowPath };
}

/** Dashed leader line + arrowhead — rendered AFTER the leaves so both
 *  are visible. The line endpoint is already outside the leaf body, so
 *  this no longer relies on the leaf to mask anything. */
function BuildingCalloutLine({ anchor }: { anchor: { x: number; y: number } }) {
  const { leaderPath, arrowPath } = calloutLayout(anchor);
  return (
    <g>
      <path className="ink-leader" d={leaderPath} />
      <path
        d={arrowPath}
        stroke="var(--ink)"
        strokeWidth={1.4}
        fill="none"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </g>
  );
}

/** Just the box (foreignObject) — rendered AFTER leaves so it sits on
 *  top of everything. Visually attached to the leader-line stub that
 *  pokes out from underneath the leaf. */
function BuildingCalloutBox({ label, subs, progress, anchor }: CalloutProps) {
  const { boxLeft, boxTop } = calloutLayout(anchor);
  const stepIdx = Math.min(3, Math.floor((progress / 100) * 4));
  return (
    <foreignObject x={boxLeft} y={boxTop} width="240" height="170">
      <div
        className="ink-frame"
        style={{ padding: "10px 12px 12px", lineHeight: 1.1 }}
      >
        <div style={{ fontFamily: "var(--font-display)", fontSize: 22, lineHeight: 1, color: "var(--ink)" }}>
          "growing pedal"
        </div>
        <div
          style={{
            fontFamily: "var(--font-mono)",
            fontSize: 10.5,
            color: "var(--ink-soft)",
            letterSpacing: ".08em",
            margin: "4px 0 8px",
          }}
        >
          ( building research corpus )
        </div>
        <div style={{ fontFamily: "var(--font-display)", fontSize: 20, color: "var(--ink)", lineHeight: 1.05 }}>
          {label}
        </div>
        {subs.length > 0 && (
          <ul style={{ margin: "4px 0 8px", padding: 0, listStyle: "none" }}>
            {subs.map((s) => (
              <li
                key={s}
                style={{
                  fontFamily: "var(--font-hand)",
                  fontSize: 14,
                  color: "var(--ink-soft)",
                  lineHeight: 1.25,
                }}
              >
                · {s}
              </li>
            ))}
          </ul>
        )}
        <div style={{ display: "flex", gap: 6, marginTop: 6 }}>
          {STAGES.map((s, i) => (
            <div
              key={s}
              style={{
                flex: 1,
                height: 6,
                background: i <= stepIdx ? "var(--ink)" : "transparent",
                border: "1px solid var(--ink)",
              }}
            />
          ))}
        </div>
        <div
          style={{
            fontFamily: "var(--font-mono)",
            fontSize: 10,
            color: "var(--ink-soft)",
            marginTop: 4,
            letterSpacing: ".04em",
          }}
        >
          stage: {STAGES[stepIdx]} · {Math.round(progress)}%
        </div>
      </div>
    </foreignObject>
  );
}

export default function PetalFlower({
  catalog,
  progressByKey,
  activeKey,
  onPetalClick,
  hideBuildingCallout = false,
}: PetalFlowerProps) {
  const leaves = useMemo(() => {
    // Keep registry order; only render keys we have geometry for.
    return catalog
      .filter((c) => GEOMETRY[c.key])
      .map((c) => {
        const progress = progressByKey[c.key];
        const status: PetalStatus = progress?.status ?? "pending";
        return {
          ...c,
          status,
          progress: progress?.progress ?? 0,
          summary: progress?.summary ?? null,
          corpusKey: progress?.corpusKey ?? null,
          sourceCount: progress?.sourceCount ?? 0,
          isActive: c.key === activeKey,
        };
      });
  }, [catalog, progressByKey, activeKey]);

  // Render order so the actively-building leaf is on top.
  const sorted = useMemo(
    () => [...leaves].sort((a, b) => STATUS_ORDER[a.status] - STATUS_ORDER[b.status]),
    [leaves],
  );

  // Determine which petal is currently building (for the callout).
  const buildingLeaf = leaves.find((l) => l.status === "building")
    ?? (activeKey ? leaves.find((l) => l.key === activeKey) : null);

  return (
    <svg
      viewBox={`0 0 ${VIEWBOX_W} ${VIEWBOX_H}`}
      xmlns="http://www.w3.org/2000/svg"
      className="w-full h-full"
      role="img"
      aria-label="Case analysis growth — devil's-trumpet petal visualization"
    >
      <defs>
        {Object.entries(GEOMETRY).map(([key, g]) => (
          <clipPath id={`clip-${key}`} key={`clip-${key}`}>
            <path d={g.leaf} />
          </clipPath>
        ))}
      </defs>

      {/* soil tick */}
      <path
        d="M 280 905 C 340 901, 420 901, 480 905"
        stroke="var(--ink)"
        strokeWidth="1"
        fill="none"
        strokeLinecap="round"
      />
      {/* main stalk bundle converging at the base */}
      <path d="M 380 905 C 380 880, 380 855, 380 825" stroke="var(--ink)" strokeWidth="1.5" fill="none" strokeLinecap="round" />
      <path d="M 384 905 C 386 882, 384 858, 382 828" stroke="var(--ink)" strokeWidth="1" strokeOpacity="0.6" fill="none" strokeLinecap="round" />

      {sorted.map((l) => (
        <Petal
          key={l.key}
          geometryKey={l.key}
          status={l.status}
          progress={l.progress}
          isActive={l.isActive}
          onClick={onPetalClick ? () => onPetalClick(l.key) : undefined}
        />
      ))}

      {/* Leader-line + arrowhead AFTER the leaves — the line endpoint
          now sits OUTSIDE the leaf body so the whole arrow is visible
          (no more relying on the leaf to mask anything). */}
      {!hideBuildingCallout && buildingLeaf && GEOMETRY[buildingLeaf.key] && (
        <BuildingCalloutLine anchor={GEOMETRY[buildingLeaf.key].mid} />
      )}

      {/* Callout box on top of everything else. */}
      {!hideBuildingCallout && buildingLeaf && GEOMETRY[buildingLeaf.key] && (
        <BuildingCalloutBox
          label={buildingLeaf.label}
          description={buildingLeaf.description}
          subs={GEOMETRY[buildingLeaf.key].subs}
          progress={buildingLeaf.progress}
          anchor={GEOMETRY[buildingLeaf.key].mid}
        />
      )}
    </svg>
  );
}
