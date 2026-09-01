/** Fail-closed citation propagation across analysis passes. */
export interface GroundedCitationValue {
  citationId: string;
  sourceLabel: string;
  passage: string;
  locator: string | null;
  sourceUrl: string | null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

export function collectGroundedCitations(value: unknown): GroundedCitationValue[] {
  const found = new Map<string, GroundedCitationValue>();
  const visit = (current: unknown): void => {
    if (Array.isArray(current)) {
      current.forEach(visit);
      return;
    }
    if (!isRecord(current)) return;
    if (
      typeof current.citationId === "string" &&
      typeof current.sourceLabel === "string" &&
      typeof current.passage === "string"
    ) {
      found.set(current.citationId, {
        citationId: current.citationId,
        sourceLabel: current.sourceLabel,
        passage: current.passage,
        locator: typeof current.locator === "string" ? current.locator : null,
        sourceUrl: typeof current.sourceUrl === "string" ? current.sourceUrl : null,
      });
    }
    Object.values(current).forEach(visit);
  };
  visit(value);
  return Array.from(found.values());
}

export function assertGroundedCitations(
  value: unknown,
  allowed: Iterable<GroundedCitationValue>,
  label: string,
): void {
  const allowedMap = new Map(Array.from(allowed, item => [item.citationId, item]));
  for (const citation of collectGroundedCitations(value)) {
    const canonical = allowedMap.get(citation.citationId);
    if (!canonical) {
      throw new Error(`${label} emitted citation ${citation.citationId} without retrieving it.`);
    }
    if (
      citation.sourceLabel !== canonical.sourceLabel ||
      citation.passage !== canonical.passage ||
      citation.locator !== canonical.locator ||
      citation.sourceUrl !== canonical.sourceUrl
    ) {
      throw new Error(`${label} altered the server-owned fields for citation ${citation.citationId}.`);
    }
  }
}

export function parseToolEvidence(output: string): GroundedCitationValue[] {
  const citations: GroundedCitationValue[] = [];
  for (const block of output.split(/\n\n---\n\n/g)) {
    const lines = block.split("\n");
    const id = lines[0]?.match(/^\[([^\]]+)\]$/)?.[1];
    const sourceLabel = lines.find(line => line.startsWith("Source: "))?.slice(8);
    const locator = lines.find(line => line.startsWith("Locator: "))?.slice(9);
    const passageLine = lines.findIndex(line => line.startsWith("Passage: "));
    if (!id || !sourceLabel || !locator || passageLine < 0) continue;
    const end = lines.findIndex(
      (line, index) => index > passageLine && (line.startsWith("Publisher: ") || line.startsWith("URL: ")),
    );
    const passage = lines
      .slice(passageLine, end === -1 ? lines.length : end)
      .join("\n")
      .slice("Passage: ".length);
    const sourceUrl = lines.find(line => line.startsWith("URL: "))?.slice(5) ?? null;
    citations.push({ citationId: id, sourceLabel, passage, locator, sourceUrl });
  }
  return citations;
}
