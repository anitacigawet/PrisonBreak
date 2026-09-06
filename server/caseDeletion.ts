import { TRPCError } from "@trpc/server";
import * as db from "./db";
import { withCaseOperation } from "./caseOperations";

/** Retain a tombstone and source identities until every store is clean. */
export async function deleteCaseWithCleanup(caseId: number, removeVectors: () => Promise<unknown>): Promise<{ success: true }> {
  return withCaseOperation(caseId, "delete", async () => {
    await db.beginCaseDeletion(caseId);
    try {
      await removeVectors();
      db.deleteCaseFiles(caseId);
      await db.deleteCase(caseId);
      return { success: true };
    } catch {
      await db.failCaseDeletion(caseId);
      throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Case deletion is incomplete. The case has been kept so cleanup can be retried." });
    }
  });
}
