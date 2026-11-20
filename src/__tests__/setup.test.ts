import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { chmodSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { parseConfig } from "../config/loader.js";
import {
  ENV_TEMPLATE,
  buildLauncher,
  buildProfileConfig,
  listeningAddresses,
  runDoctor,
  runSetup,
} from "../setup.js";

const mode = (p: string) => statSync(p).mode & 0o777;

describe("opencodex setup", () => {
  let home: string;
  let configPath: string;
  const oldHome = process.env.HOME;

  beforeEach(() => {
    home = mkdtempSync(join(tmpdir(), "opencodex-setup-"));
    process.env.HOME = home;
    configPath = join(home, ".opencodex", "config.yaml");
  });

  afterEach(() => {
    process.env.HOME = oldHome;
    rmSync(home, { recursive: true, force: true });
    delete process.env.TELEGRAM_BOT_TOKEN;
    delete process.env.TELEGRAM_CHAT_ID;
  });

  it(".env.example matches the template written by setup", () => {
    const example = readFileSync(resolve(__dirname, "../../.env.example"), "utf-8");
    expect(example).toBe(ENV_TEMPLATE);
  });

  it("creates private config, .env and launcher on a clean HOME", () => {
    const report = runSetup({ configPath, repoRoot: "/opt/ocx", nodePath: "/usr/bin/node" });

    const dir = join(home, ".opencodex");
    expect(mode(dir)).toBe(0o700);
    expect(mode(join(dir, ".env"))).toBe(0o600);
    expect(mode(join(dir, "bin", "opencodex"))).toBe(0o700);
    expect(readFileSync(join(dir, ".env"), "utf-8")).toBe(ENV_TEMPLATE);
    expect(readFileSync(join(dir, "bin", "opencodex"), "utf-8"))
      .toBe(buildLauncher("/usr/bin/node", "/opt/ocx"));
    expect(report.emptyVars).toEqual(["TELEGRAM_BOT_TOKEN", "TELEGRAM_CHAT_ID"]);
    expect(report.created).toHaveLength(4);
  });

  it("generates a config that parses into the allowlist-only profile", () => {
    process.env.TELEGRAM_BOT_TOKEN = "123:abc";
    process.env.TELEGRAM_CHAT_ID = "-1001";
    const cfg = parseConfig(buildProfileConfig({ dataDir: "~/.opencodex", botName: "plane-agent", codexBinary: "codex" }));

    expect(cfg.engine.maxProcesses).toBe(1);
    expect(cfg.engine.codex.sandbox).toBe("read-only");
    expect(cfg.engine.codex.approvalPolicy).toBe("never");
    expect(cfg.bots?.[0].auth?.dmPolicy).toBe("disabled");
    expect(cfg.bots?.[0].auth?.groupPolicy).toBe("allowlist");
    expect(Object.keys(cfg.bots?.[0].auth?.groups ?? {})).toEqual(["-1001"]);
  });

  it("is idempotent: a second run changes nothing", () => {
    runSetup({ configPath, repoRoot: "/opt/ocx", nodePath: "/usr/bin/node" });
    const files = [".env", "config.yaml", "bin/opencodex"].map((f) => join(home, ".opencodex", f));
    const before = files.map((f) => [readFileSync(f, "utf-8"), statSync(f).mtimeMs]);

    const report = runSetup({ configPath, repoRoot: "/opt/ocx", nodePath: "/usr/bin/node" });

    expect(report.created).toEqual([]);
    expect(report.fixed).toEqual([]);
    expect(report.warnings).toEqual([]);
    expect(files.map((f) => [readFileSync(f, "utf-8"), statSync(f).mtimeMs])).toEqual(before);
  });

  it("never overwrites existing config, .env or a foreign launcher; tightens permissions", () => {
    const dir = join(home, ".opencodex");
    mkdirSync(join(dir, "bin"), { recursive: true });
    mkdirSync(join(dir, "logs"));
    chmodSync(dir, 0o755);
    chmodSync(join(dir, "logs"), 0o755);
    writeFileSync(configPath, "gateway:\n  dataDir: \"~/.opencodex\"\nengine:\n  codex:\n    binary: \"/x/codex-sanitized\"\n");
    writeFileSync(join(dir, ".env"), "TELEGRAM_BOT_TOKEN=keep\nTELEGRAM_CHAT_ID=-1\n", { mode: 0o644 });
    writeFileSync(join(dir, "bin", "opencodex"), "#!/bin/sh\necho custom\n");

    const report = runSetup({ configPath, repoRoot: "/opt/ocx", nodePath: "/usr/bin/node" });

    expect(readFileSync(configPath, "utf-8")).toContain("codex-sanitized");
    expect(readFileSync(join(dir, ".env"), "utf-8")).toBe("TELEGRAM_BOT_TOKEN=keep\nTELEGRAM_CHAT_ID=-1\n");
    expect(readFileSync(join(dir, "bin", "opencodex"), "utf-8")).toBe("#!/bin/sh\necho custom\n");
    expect(mode(dir)).toBe(0o700);
    expect(mode(join(dir, ".env"))).toBe(0o600);
    expect(mode(join(dir, "logs"))).toBe(0o700);
    expect(report.emptyVars).toEqual([]);
    expect(report.warnings.join("\n")).toMatch(/codex-sanitized/);
    expect(report.warnings.join("\n")).toMatch(/not overwritten/);
  });
});

describe("opencodex doctor", () => {
  let home: string;
  let configPath: string;
  const oldHome = process.env.HOME;

  beforeEach(() => {
    home = mkdtempSync(join(tmpdir(), "opencodex-doctor-"));
    process.env.HOME = home;
    configPath = join(home, ".opencodex", "config.yaml");
    runSetup({ configPath, repoRoot: "/opt/ocx", nodePath: "/usr/bin/node", codexBinary: "/nonexistent/codex" });
  });

  afterEach(() => {
    process.env.HOME = oldHome;
    rmSync(home, { recursive: true, force: true });
    delete process.env.TELEGRAM_BOT_TOKEN;
    delete process.env.TELEGRAM_CHAT_ID;
  });

  const byName = (results: ReturnType<typeof runDoctor>, name: string) =>
    results.find((r) => r.name === name);

  it("fails on empty variables, naming them without values", () => {
    const results = runDoctor({ configPath, procNetTcp: [] });
    expect(byName(results, "required variables")?.status).toBe("FAIL");
    expect(byName(results, "required variables")?.detail).toMatch(/TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID/);
  });

  it("fails on a world-readable .env and a missing codex binary", () => {
    process.env.TELEGRAM_BOT_TOKEN = "123:secret-value";
    process.env.TELEGRAM_CHAT_ID = "-1001";
    chmodSync(join(home, ".opencodex", ".env"), 0o644);

    const results = runDoctor({ configPath, procNetTcp: [] });

    expect(byName(results, "env file permissions")?.status).toBe("FAIL");
    expect(byName(results, "required variables")?.status).toBe("PASS");
    expect(byName(results, "telegram allowlist")?.status).toBe("PASS");
    expect(byName(results, "codex binary")?.status).toBe("FAIL");
    expect(byName(results, "codex login")?.status).toBe("SKIP");
    expect(JSON.stringify(results)).not.toContain("secret-value");
  });

  it("checks the API bind only with a loaded config", () => {
    const header = "  sl  local_address rem_address   st\n";
    const exposed = header + "   0: 00000000:4966 00000000:0000 0A 0\n";

    expect(byName(runDoctor({ configPath, procNetTcp: [exposed] }), "api bind")?.status).toBe("SKIP");

    process.env.TELEGRAM_BOT_TOKEN = "123:abc";
    process.env.TELEGRAM_CHAT_ID = "-1001";
    expect(byName(runDoctor({ configPath, procNetTcp: [exposed] }), "api bind")?.status).toBe("FAIL");
    const loopback = header + "   0: 0100007F:4966 00000000:0000 0A 0\n";
    expect(byName(runDoctor({ configPath, procNetTcp: [loopback] }), "api bind")?.status).toBe("PASS");
  });
});

describe("listeningAddresses", () => {
  const header = "  sl  local_address rem_address   st tx_queue rx_queue tr tm->when retrnsmt   uid  timeout inode\n";

  it("finds listeners on the port and ignores other states/ports", () => {
    const tcp = header
      + "   0: 0100007F:4966 00000000:0000 0A 00000000:00000000 00:00000000 00000000  1000        0 1\n"
      + "   1: 00000000:4966 0100007F:1234 01 00000000:00000000 00:00000000 00000000  1000        0 2\n"
      + "   2: 00000000:1F90 00000000:0000 0A 00000000:00000000 00:00000000 00000000  1000        0 3\n";
    expect(listeningAddresses(18790, [tcp])).toEqual(["0100007F"]);
  });
});
