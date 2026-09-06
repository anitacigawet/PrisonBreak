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
      let failure: Error | undefined;
      let killer: ReturnType<typeof spawn> | undefined;
      let killCompleted: Promise<void> = Promise.resolve();

      const child = spawn(invocation.executable, invocation.args, {
        cwd: invocation.cwd,
        env: invocation.env ?? process.env,
        shell: false,
        detached: process.platform !== "win32",
        windowsHide: true,
        stdio: ["pipe", "pipe", "pipe"],
      });

      let timer: NodeJS.Timeout;
      const finishWithError = (error: Error) => {
        if (settled || failure) return;
        failure = error;
        clearTimeout(timer);
        // Keep the caller's operation lease until close; child.kill() is a
        // request, not evidence the process (or its descendants) has exited.
        if (child.pid && process.platform === "win32") {
          killer = spawn("taskkill", ["/PID", String(child.pid), "/T", "/F"],
            { windowsHide: true, shell: false, stdio: "ignore" });
          killCompleted = new Promise<void>(done => {
            const fallback = setTimeout(() => {
              child.kill("SIGKILL");
              killer!.kill("SIGKILL");
            }, 2000);
            killer!.once("close", code => {
              clearTimeout(fallback);
              if (code !== 0) child.kill("SIGKILL");
              done();
            });
            killer!.once("error", () => { clearTimeout(fallback); child.kill("SIGKILL"); done(); });
          });
        } else if (child.pid) {
          try { process.kill(-child.pid, "SIGKILL"); } catch { child.kill("SIGKILL"); }
        }
      };

      const append = (
        current: string,
        chunk: Buffer,
        streamName: string
      ): string => {
        if (failure) return current;
        const next = current + chunk.toString("utf8");
        if (Buffer.byteLength(next, "utf8") > MAX_CAPTURE_BYTES) {
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
      child.on("close", async code => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        await killCompleted;
        if (failure) { reject(failure); return; }
        resolve({ exitCode: code ?? -1, stdout, stderr });
      });

      timer = setTimeout(() => {
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
