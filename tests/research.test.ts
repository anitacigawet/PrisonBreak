import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { NodeCommandRunner } from "../server/research/runner";
import { researchCommandEnvironment, runWebResearch, validateResearchConfiguration } from "../server/research";
import { buildProviderCommand } from "../server/research/providers";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
const require = createRequire(import.meta.url);
const { isSupportedNode } = require("../scripts/check-node.cjs");

test("Node version gate matches the declared minimum", () => {
  for (const v of ["20.19.0", "22.0.0", "22.11.9", "garbage", "22.12"]) assert.equal(isSupportedNode(v), false);
  for (const v of ["22.12.0", "22.12.1", "24.0.0"]) assert.equal(isSupportedNode(v), true);
});

test("Codex fails closed before starting any CLI; Claude keeps web-only tools", async () => {
  let calls = 0;
  await assert.rejects(runWebResearch({ query: "synthetic government sources" }, {
    env: { PRISONBREAK_RESEARCH_PROVIDER: "codex" },
    runner: { async run() { calls++; throw new Error("must not execute"); } },
  }), /Codex research is disabled/);
  assert.equal(calls, 0);
  assert.equal(validateResearchConfiguration({ PRISONBREAK_RESEARCH_PROVIDER: "claude" }), "claude");
  const command = buildProviderCommand({ provider: "claude", env: {}, workDir: "fixture",
    schemaPath: "schema", schemaJson: "{}", resultPath: "result" });
  for (const flag of ["--safe-mode", "--strict-mcp-config", "--no-session-persistence"]) assert.ok(command.args.includes(flag));
  assert.equal(command.args[command.args.indexOf("--tools") + 1], "WebSearch,WebFetch");
  assert.equal(command.args[command.args.indexOf("--mcp-config") + 1], "{}");
});

test("research environment excludes unrelated secrets and runtime overrides", () => {
  const env = researchCommandEnvironment({ Path: "fixture-bin", SystemRoot: "fixture-system",
    ANTHROPIC_API_KEY: "synthetic-auth", OPENAI_API_KEY: "synthetic-other-provider",
    UNRELATED_TOKEN: "synthetic", DATABASE_PATH: "private.db", NODE_OPTIONS: "--require=private" });
  assert.deepEqual(Object.keys(env).sort(), ["ANTHROPIC_API_KEY", "Path", "SystemRoot"]);
});

test("command runner returns ordinary output and rejects timeout only after child exit", async () => {
  const cwd = await mkdtemp(path.join(tmpdir(), "pb-runner-test-"));
  try {
    const runner = new NodeCommandRunner();
    const base = { executable: process.execPath, cwd, env: researchCommandEnvironment(process.env), timeoutMs: 1000 };
    const ok = await runner.run({ ...base, args: ["-e", "process.stdout.write('synthetic ok')"] });
    assert.equal(ok.exitCode, 0);
    assert.equal(ok.stdout, "synthetic ok");
    await assert.rejects(runner.run({ ...base, args: ["-e", "setInterval(()=>{},1000)"] }), /exceeded/);
    await assert.rejects(runner.run({ ...base, executable: path.join(cwd, "not-an-executable"), args: [] }));
  } finally { await rm(cwd, { recursive: true, force: true }); }
});
