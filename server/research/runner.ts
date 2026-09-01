import { spawn } from "node:child_process";
import type { CommandInvocation, CommandResult, CommandRunner } from "./types";
import { ResearchExecutionError } from "./errors";

const MAX_CAPTURE_BYTES = 2 * 1024 * 1024;

export class NodeCommandRunner implements CommandRunner {
  async run(invocation: CommandInvocation): Promise<CommandResult> {
    return new Promise((resolve, reject) => {
      let settled = false;
      let stdout = "";
      let stderr = "";

      const child = spawn(invocation.executable, invocation.args, {
        cwd: invocation.cwd,
        env: invocation.env ?? process.env,
        shell: false,
        windowsHide: true,
        stdio: ["pipe", "pipe", "pipe"],
      });

      let timer: NodeJS.Timeout;
      const finishWithError = (error: Error) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        reject(error);
      };

      const append = (
        current: string,
        chunk: Buffer,
        streamName: string
      ): string => {
        const next = current + chunk.toString("utf8");
        if (Buffer.byteLength(next, "utf8") > MAX_CAPTURE_BYTES) {
          child.kill();
          finishWithError(
            new ResearchExecutionError(
              `${streamName} exceeded the ${MAX_CAPTURE_BYTES}-byte limit.`
            )
          );
          return current;
        }
        return next;
      };

      child.stdout.on("data", (chunk: Buffer) => {
        stdout = append(stdout, chunk, "CLI stdout");
      });
      child.stderr.on("data", (chunk: Buffer) => {
        stderr = append(stderr, chunk, "CLI stderr");
      });
      child.on("error", finishWithError);
      child.on("close", code => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve({ exitCode: code ?? -1, stdout, stderr });
      });

      timer = setTimeout(() => {
        child.kill();
        finishWithError(
          new ResearchExecutionError(
            `Research CLI exceeded ${invocation.timeoutMs}ms.`
          )
        );
      }, invocation.timeoutMs);

      child.stdin.on("error", error => {
        if ((error as NodeJS.ErrnoException).code !== "EPIPE")
          finishWithError(error);
      });
      child.stdin.end(invocation.stdin ?? "");
    });
  }
}
