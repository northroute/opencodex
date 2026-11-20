import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildChildEnv, envFilePath, loadDotEnv, withheldEnvKeys } from "../env.js";

describe("gateway .env handling", () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "opencodex-env-"));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
    delete process.env.OCX_TEST_FROM_FILE;
    delete process.env.OCX_TEST_PRESET;
    delete process.env.OCX_TEST_KEEP;
  });

  it("resolves .env next to config.yaml", () => {
    expect(envFilePath("/srv/ocx/config.yaml")).toBe("/srv/ocx/.env");
  });

  it("returns no keys when the file is absent", () => {
    expect(loadDotEnv(join(dir, ".env"))).toEqual([]);
  });

  it("loads values without overriding the existing environment", () => {
    process.env.OCX_TEST_PRESET = "from-env";
    const path = join(dir, ".env");
    writeFileSync(path, "OCX_TEST_FROM_FILE=from-file\nOCX_TEST_PRESET=from-file\n");

    expect(loadDotEnv(path).sort()).toEqual(["OCX_TEST_FROM_FILE", "OCX_TEST_PRESET"]);
    expect(process.env.OCX_TEST_FROM_FILE).toBe("from-file");
    expect(process.env.OCX_TEST_PRESET).toBe("from-env");
  });

  it("withholds .env keys and the Telegram token from the child env, keeps the rest", () => {
    const path = join(dir, ".env");
    writeFileSync(path, "OCX_TEST_FROM_FILE=secret\n");
    loadDotEnv(path);
    process.env.OCX_TEST_KEEP = "keep-me";

    const child = buildChildEnv({
      ...process.env,
      TELEGRAM_BOT_TOKEN: "123:abc",
    });

    expect(child.OCX_TEST_FROM_FILE).toBeUndefined();
    expect(child.TELEGRAM_BOT_TOKEN).toBeUndefined();
    expect(child.OCX_TEST_KEEP).toBe("keep-me");
    expect(child.PATH).toBe(process.env.PATH);
    expect(withheldEnvKeys()).toContain("OCX_TEST_FROM_FILE");
  });
});
