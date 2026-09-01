/**
 * Server-side runtime config.
 *
 * Retrieval and research settings are read directly by their bridges
 * from `PRISONBREAK_*` environment variables. Orchestration provider
 * keys remain in the local settings store configured through the UI.
 */
export const ENV = {
  isProduction: process.env.NODE_ENV === "production",

  /** SQLite database file location. */
  databasePath: process.env.DATABASE_PATH ?? "./data/app.db",
};
