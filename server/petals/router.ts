/**
 * tRPC procedures for the petals subsystem.
 *
 * Mounted at `petals.*` in the root router. The flower UI in
 * CaseDetail consumes these three procedures:
 *
 *  - start:   kick off a sequential grow run for a case (returns immediately)
 *  - list:    fetch all petal rows for a case (used on page load + as fallback if WebSocket missed events)
 *  - catalog: the static spec list (key, label, description, ordered) so the UI can render the outline even before rows exist
 */
import { z } from "zod";
import { publicProcedure, router } from "../_core/trpc";
import { listPetalsForCase } from "./db";
import { PETAL_SPECS } from "./registry";
import { startPetalGrowth } from "./runner";

export const petalsRouter = router({
  catalog: publicProcedure.query(() => {
    return PETAL_SPECS.map(spec => ({
      key: spec.key,
      label: spec.label,
      description: spec.description,
    }));
  }),

  list: publicProcedure
    .input(z.object({ caseId: z.number() }))
    .query(async ({ input }) => {
      return listPetalsForCase(input.caseId);
    }),

  start: publicProcedure
    .input(z.object({ caseId: z.number() }))
    .mutation(({ input }) => {
      startPetalGrowth(input.caseId);
      return { started: true, caseId: input.caseId };
    }),
});
