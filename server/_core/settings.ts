/**
 * Settings store backed by ./data/settings.json.
 *
 * Holds runtime preferences that aren't case-scoped — currently the
 * orchestrator's provider config (Claude vs OpenAI + model + API
 * keys). Settings are user-supplied via the Settings page and read
 * server-side at request time.
 *
 * API keys live here (NOT in env) so the user can swap them at runtime
 * via the UI without restarting the server. data/settings.json is
 * gitignored alongside the SQLite DB and the uploads directory.
 */
import * as fs from "node:fs";
import * as path from "node:path";
import { atomicWriteFile } from "../persistence";
import { getDataRoot } from "../runtimePaths";

export interface OrchestratorSettings {
  provider: "anthropic" | "openai";
  /** Provider-specific model identifier. Persisted as a string so
   *  future models work without a schema bump. */
  model: string;
  anthropicApiKey?: string;
  openaiApiKey?: string;
}

export interface AppSettings {
  orchestrator?: OrchestratorSettings;
}

const settingsPath = () => path.join(getDataRoot(), "settings.json");

const DEFAULTS: AppSettings = {
  orchestrator: {
    provider: "openai",
    model: "gpt-4.1-mini",
  },
};

function ensureDir(): void {
  const SETTINGS_DIR = getDataRoot();
  if (!fs.existsSync(SETTINGS_DIR)) {
    fs.mkdirSync(SETTINGS_DIR, { recursive: true });
  }
}

export function readSettings(): AppSettings {
  const SETTINGS_PATH = settingsPath();
  try {
    if (!fs.existsSync(SETTINGS_PATH)) return structuredClone(DEFAULTS);
    const raw = fs.readFileSync(SETTINGS_PATH, "utf8");
    const parsed = JSON.parse(raw) as AppSettings;
    return {
      ...DEFAULTS,
      ...parsed,
      orchestrator: {
        ...DEFAULTS.orchestrator!,
        ...(parsed.orchestrator ?? {}),
      },
    };
  } catch (err) {
    throw new Error("Settings could not be read. Restore the local settings file before saving changes.");
  }
}

export function writeSettings(patch: { orchestrator?: Partial<OrchestratorSettings> }): AppSettings {
  ensureDir();
  const current = readSettings();
  const next: AppSettings = {
    ...current,
    orchestrator: patch.orchestrator
      ? { ...current.orchestrator!, ...Object.fromEntries(Object.entries(patch.orchestrator).filter(([, value]) => value !== undefined)) }
      : current.orchestrator,
  };
  atomicWriteFile(settingsPath(), JSON.stringify(next, null, 2));
  return next;
}

/**
 * Returns a redacted snapshot for the client. API keys are exposed as
 * boolean flags ("configured" or not) so the page can show "you've
 * configured Anthropic" without leaking the key back to the browser.
 */
export function readSafeSettings(): {
  orchestrator: {
    provider: OrchestratorSettings["provider"];
    model: string;
    anthropicKeyConfigured: boolean;
    openaiKeyConfigured: boolean;
  };
} {
  const s = readSettings();
  return {
    orchestrator: {
      provider: s.orchestrator?.provider ?? "openai",
      model: s.orchestrator?.model ?? "gpt-4.1-mini",
      anthropicKeyConfigured: !!s.orchestrator?.anthropicApiKey,
      openaiKeyConfigured: !!s.orchestrator?.openaiApiKey,
    },
  };
}
