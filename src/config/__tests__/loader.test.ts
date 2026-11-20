import { describe, it, expect } from "vitest";
import { parseConfig, expandEnvVars, resolveBots } from "../loader.js";

describe("expandEnvVars", () => {
  it("expands ${VAR} references", () => {
    process.env.TEST_TOKEN = "abc123";
    expect(expandEnvVars("token: ${TEST_TOKEN}")).toBe("token: abc123");
    delete process.env.TEST_TOKEN;
  });

  it("fails closed on unset vars, naming the variable", () => {
    expect(() => expandEnvVars("${NONEXISTENT_VAR}")).toThrow(/NONEXISTENT_VAR/);
  });

  it("fails closed on empty vars without printing other values", () => {
    process.env.TEST_SECRET_SET = "s3cr3t-value";
    process.env.TEST_EMPTY = "";
    let message = "";
    try {
      expandEnvVars("a: ${TEST_SECRET_SET}\nb: ${TEST_EMPTY}");
    } catch (err) {
      message = (err as Error).message;
    }
    expect(message).toMatch(/TEST_EMPTY/);
    expect(message).not.toMatch(/TEST_SECRET_SET|s3cr3t-value/);
    delete process.env.TEST_SECRET_SET;
    delete process.env.TEST_EMPTY;
  });
});

describe("parseConfig", () => {
  it("defaults to Codex engine and OpenCodex data dir", () => {
    const cfg = parseConfig(`
bots:
  - name: "bot"
    token: "123:abc"
`);
    expect(cfg.gateway.dataDir).toBe("~/.opencodex");
    expect(cfg.engine.type).toBe("codex");
    expect(cfg.engine.codex.binary).toBe("codex");
    expect(cfg.engine.maxProcesses).toBe(10);
  });

  it("loads legacy claude config into engine claude config", () => {
    const cfg = parseConfig(`
gateway:
  dataDir: "~/.openclaude"
claude:
  binary: "/usr/local/bin/claude"
  model: "opus"
  idleTimeoutMs: 12345
  maxProcesses: 3
  extraArgs: ["--debug"]
bots:
  - name: "bot"
    token: "123:abc"
`);
    expect(cfg.engine.type).toBe("codex");
    expect(cfg.engine.maxProcesses).toBe(3);
    expect(cfg.engine.idleTimeoutMs).toBe(12345);
    expect(cfg.engine.claude.binary).toBe("/usr/local/bin/claude");
    expect(cfg.engine.claude.model).toBe("opus");
    expect(cfg.engine.claude.extraArgs).toEqual(["--debug"]);
  });

  it("preserves explicit engine claude config when legacy claude only provides process limits", () => {
    const cfg = parseConfig(`
engine:
  claude:
    binary: "/opt/bin/claude"
    model: "engine-opus"
    extraArgs: ["--engine"]
claude:
  idleTimeoutMs: 12345
  maxProcesses: 3
bots:
  - name: "bot"
    token: "123:abc"
`);
    expect(cfg.engine.maxProcesses).toBe(3);
    expect(cfg.engine.idleTimeoutMs).toBe(12345);
    expect(cfg.engine.claude.binary).toBe("/opt/bin/claude");
    expect(cfg.engine.claude.model).toBe("engine-opus");
    expect(cfg.engine.claude.extraArgs).toEqual(["--engine"]);
  });

  it("keeps explicit engine claude values when legacy claude config is also present", () => {
    const cfg = parseConfig(`
engine:
  claude:
    binary: "/opt/bin/claude"
    model: "engine-opus"
    extraArgs: ["--engine"]
claude:
  binary: "/usr/local/bin/claude"
  model: "legacy-opus"
  extraArgs: ["--legacy"]
  idleTimeoutMs: 12345
  maxProcesses: 3
bots:
  - name: "bot"
    token: "123:abc"
`);
    expect(cfg.engine.maxProcesses).toBe(3);
    expect(cfg.engine.idleTimeoutMs).toBe(12345);
    expect(cfg.engine.claude.binary).toBe("/opt/bin/claude");
    expect(cfg.engine.claude.model).toBe("engine-opus");
    expect(cfg.engine.claude.extraArgs).toEqual(["--engine"]);
  });

  it("parses valid config yaml string", () => {
    const yaml = `
gateway:
  logLevel: info
claude:
  binary: claude
  idleTimeoutMs: 600000
  maxProcesses: 10
auth:
  defaultPolicy: pairing
channels:
  telegram:
    botToken: "test-token"
    dmPolicy: pairing
    groupPolicy: disabled
    allowFrom: []
    groups: {}
`;
    const cfg = parseConfig(yaml);
    expect(cfg.gateway.logLevel).toBe("info");
    expect(cfg.channels!.telegram.botToken).toBe("test-token");
    expect(cfg.auth.defaultPolicy).toBe("pairing");
  });

  it("rejects invalid config", () => {
    expect(() => parseConfig("gateway: 123")).toThrow();
  });

  it("applies defaults for optional fields", () => {
    const yaml = `
channels:
  telegram:
    botToken: "tok"
`;
    const cfg = parseConfig(yaml);
    expect(cfg.gateway.logLevel).toBe("info");
    expect(cfg.claude.idleTimeoutMs).toBe(600000);
    expect(cfg.channels!.telegram.dmPolicy).toBe("pairing");
  });
});

describe("resolveBots", () => {
  it("uses selected codex engine model and extra args", () => {
    const cfg = parseConfig(`
engine:
  type: "codex"
  codex:
    model: "gpt-5"
    extraArgs: ["--fast"]
bots:
  - name: "bot"
    token: "123:abc"
`);
    const bots = resolveBots(cfg);
    expect(bots[0].model).toBe("gpt-5");
    expect(bots[0].extraArgs).toEqual(["--fast"]);
  });

  it("uses selected claude engine model and extra args", () => {
    const cfg = parseConfig(`
engine:
  type: "claude"
  claude:
    model: "opus"
    extraArgs: ["--debug"]
bots:
  - name: "bot"
    token: "123:abc"
`);
    const bots = resolveBots(cfg);
    expect(bots[0].model).toBe("opus");
    expect(bots[0].extraArgs).toEqual(["--debug"]);
  });
});
