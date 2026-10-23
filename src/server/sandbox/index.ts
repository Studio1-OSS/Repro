// A free, local sandbox for checking fixes: a throwaway copy of the project, run in a Docker container
// (node:22, 2 CPUs, 2 GB) when Docker is running, or as a plain child process when it isn't ("not isolated").
import { execFile, spawn, type ChildProcess } from "node:child_process";
import { cp, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { applyEdits, type Edit } from "../ai/fix";
import { IGNORED_DIR } from "../source";

const exec = promisify(execFile);
export const SANDBOX_IMAGE = process.env.SANDBOX_IMAGE || "node:22-bookworm-slim";

export type Provider = "docker" | "process";
export type CommandResult = { exitCode: number; output: string; durationMs: number; timedOut: boolean };

export async function detectProvider(): Promise<Provider> {
  if (process.env.SANDBOX_PROVIDER === "process") return "process";
  try {
    await exec("docker", ["info", "--format", "{{.ServerVersion}}"], { timeout: 5000 });
    return "docker";
  } catch {
    return "process";
  }
}

/** A throwaway copy of the project (without dependencies or build output), optionally with edits applied. */
export async function prepareWorkspace(from: { dir: string } | { tarball: Buffer }, edits: Edit[] = []) {
  const dir = await mkdtemp(join(tmpdir(), "repro-sbx-"));
  if ("dir" in from) {
    await cp(from.dir, dir, { recursive: true, filter: (src) => !IGNORED_DIR.test(src.slice(from.dir.length)) });
  } else {
    const tar = join(dir, ".repro-src.tgz");
    await writeFile(tar, from.tarball);
    await exec("tar", ["-xzf", tar, "-C", dir, "--strip-components=1"]);
    await rm(tar);
  }
  if (edits.length) {
    const files = new Map<string, string>();
    for (const e of edits) files.set(e.path, await readFile(join(dir, e.path), "utf8").catch(() => undefined as unknown as string));
    for (const [k, v] of files) if (v === undefined) files.delete(k);
    const applied = applyEdits(files, edits);
    if (applied.errors.length) throw new Error(`The fix doesn't apply: ${applied.errors.join("; ")}`);
    for (const e of edits) await writeFile(join(dir, e.path), applied.files.get(e.path)!);
  }
  return { dir, cleanup: () => rm(dir, { recursive: true, force: true }) };
}

/** A minimal environment for the project's commands: none of Repro's own secrets leak into it. */
const sandboxEnv = (dir: string, extra: Record<string, string> = {}) =>
  ({ PATH: process.env.PATH ?? "/usr/local/bin:/usr/bin:/bin", HOME: dir, ...extra }) as unknown as NodeJS.ProcessEnv;

const tail = (s: string, n = 8000) => (s.length > n ? `…${s.slice(-n)}` : s);
const name = () => `repro-sbx-${Math.random().toString(36).slice(2, 10)}`;

/** Runs a command (e.g. the project's tests) in the workspace and returns its exit code and output tail. */
export async function runCommand(dir: string, command: string, opts: { provider: Provider; timeoutMs?: number; onOutput?: (chunk: string) => void }): Promise<CommandResult> {
  const started = Date.now();
  const container = name();
  const child =
    opts.provider === "docker"
      ? spawn("docker", ["run", "--rm", "--name", container, "-v", `${dir}:/app`, "-w", "/app", "--memory", "2g", "--cpus", "2", "-e", "CI=1", SANDBOX_IMAGE, "sh", "-lc", command])
      : spawn("sh", ["-lc", command], { cwd: dir, env: sandboxEnv(dir, { CI: "1" }) });
  let output = "";
  const onData = (d: Buffer) => {
    output += d.toString();
    opts.onOutput?.(d.toString());
  };
  child.stdout?.on("data", onData);
  child.stderr?.on("data", onData);
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    if (opts.provider === "docker") void exec("docker", ["kill", container]).catch(() => {});
    child.kill("SIGKILL");
  }, opts.timeoutMs ?? 240_000);
  const exitCode = await new Promise<number>((resolve) => child.on("close", (code) => resolve(code ?? 1)));
  clearTimeout(timer);
  return { exitCode: timedOut ? 124 : exitCode, output: tail(output), durationMs: Date.now() - started, timedOut };
}

async function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = createServer();
    srv.listen(0, "127.0.0.1", () => {
      const port = (srv.address() as { port: number }).port;
      srv.close(() => resolve(port));
    });
    srv.on("error", reject);
  });
}

async function waitForHttp(url: string, timeoutMs: number, isAlive: () => boolean) {
  const until = Date.now() + timeoutMs;
  while (Date.now() < until) {
    if (!isAlive()) throw new Error("The app exited before it started listening.");
    try {
      await fetch(url, { redirect: "manual", signal: AbortSignal.timeout(2000) });
      return;
    } catch {
      await new Promise((r) => setTimeout(r, 400));
    }
  }
  throw new Error(`The app didn't answer on ${url} within ${Math.round(timeoutMs / 1000)}s.`);
}

/** Starts the app from the workspace and waits until it answers. `port` is the port the app listens on. */
export async function startApp(dir: string, command: string, port: number, opts: { provider: Provider; timeoutMs?: number }) {
  let output = "";
  if (opts.provider === "docker") {
    const container = name();
    await exec("docker", ["run", "-d", "--rm", "--name", container, "-v", `${dir}:/app`, "-w", "/app", "--memory", "2g", "--cpus", "2", "-p", `127.0.0.1::${port}`, "-e", `PORT=${port}`, "-e", "HOST=0.0.0.0", SANDBOX_IMAGE, "sh", "-lc", command]);
    const { stdout } = await exec("docker", ["port", container, String(port)]);
    const hostPort = stdout.trim().split("\n")[0].split(":").pop();
    const url = `http://127.0.0.1:${hostPort}`;
    let alive = true;
    const watcher = spawn("docker", ["wait", container]);
    watcher.on("close", () => (alive = false));
    try {
      await waitForHttp(url, opts.timeoutMs ?? 90_000, () => alive);
    } catch (e) {
      const logs = await exec("docker", ["logs", container]).catch(() => ({ stdout: "", stderr: "" }));
      await exec("docker", ["rm", "-f", container]).catch(() => {});
      throw new Error(`${(e as Error).message}\n${tail(logs.stdout + logs.stderr, 2000)}`);
    }
    return { url, stop: () => exec("docker", ["rm", "-f", container]).then(() => {}, () => {}) };
  }
  const hostPort = await freePort();
  const child: ChildProcess = spawn("sh", ["-lc", command], { cwd: dir, env: sandboxEnv(dir, { PORT: String(hostPort), HOST: "127.0.0.1" }), detached: true });
  child.stdout?.on("data", (d) => (output += d));
  child.stderr?.on("data", (d) => (output += d));
  let alive = true;
  child.on("exit", () => (alive = false));
  const url = `http://127.0.0.1:${hostPort}`;
  const stop = async () => {
    try {
      process.kill(-child.pid!, "SIGKILL");
    } catch {}
  };
  try {
    await waitForHttp(url, opts.timeoutMs ?? 90_000, () => alive);
  } catch (e) {
    await stop();
    throw new Error(`${(e as Error).message}\n${tail(output, 2000)}`);
  }
  return { url, stop };
}
