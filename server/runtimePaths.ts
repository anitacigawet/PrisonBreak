import * as path from "node:path";

/** One runtime root is shared by uploads, settings, research and local RAG. */
export function getDataRoot(): string {
  return path.resolve(process.env.PRISONBREAK_DATA_DIR ?? path.join(process.cwd(), "data"));
}
