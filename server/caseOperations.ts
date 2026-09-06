import { TRPCError } from "@trpc/server";
import { getCaseById } from "./db";

const operations = new Map<number, { kind: string; token: symbol }>();

export function getActiveCaseOperation(caseId: number): string | null {
  return operations.get(caseId)?.kind ?? null;
}

/** Reserve synchronously before the first await; retain until every write settles. */
export async function acquireCaseOperation(caseId: number, kind: string): Promise<() => void> {
  if (!Number.isSafeInteger(caseId) || caseId <= 0) throw new TRPCError({ code: "BAD_REQUEST", message: "Invalid case ID" });
  const current = operations.get(caseId);
  if (current) throw new TRPCError({ code: "CONFLICT", message: `Case is busy (${current.kind}). Wait for it to finish.` });
  const token = Symbol(kind);
  operations.set(caseId, { kind, token });
  const release = () => { if (operations.get(caseId)?.token === token) operations.delete(caseId); };
  try {
    const row = await getCaseById(caseId);
    if (!row) throw new TRPCError({ code: "NOT_FOUND", message: "Case not found" });
    if (row.deletionState !== "active" && kind !== "delete") {
      throw new TRPCError({ code: "CONFLICT", message: "Case deletion is incomplete. Retry deleting this case." });
    }
    return release;
  } catch (error) { release(); throw error; }
}

export async function withCaseOperation<T>(caseId: number, kind: string, operation: () => Promise<T>): Promise<T> {
  const release = await acquireCaseOperation(caseId, kind);
  try { return await operation(); } finally { release(); }
}
