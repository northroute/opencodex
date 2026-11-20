import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { parseEnv } from "node:util";

/** Variables that must never reach the engine child process, even if not in .env. */
const ALWAYS_WITHHELD = ["TELEGRAM_BOT_TOKEN"];

/** Keys loaded from (or named in) the gateway .env file during this process. */
const withheldKeys = new Set<string>(ALWAYS_WITHHELD);

/** Default config path: ~/.opencodex/config.yaml */
export function defaultConfigPath(): string {
  return resolve(process.env.HOME ?? "~", ".opencodex", "config.yaml");
}

/** The .env file lives next to config.yaml (by default ~/.opencodex/.env). */
export function envFilePath(configPath?: string): string {
  return resolve(dirname(configPath ?? defaultConfigPath()), ".env");
}

/**
 * Load the gateway .env file into process.env.
 *
 * Variables already present in the environment are not overridden. Every key
 * named in the file is remembered and withheld from engine child processes
 * (see buildChildEnv), whether its value came from the file or the caller.
 *
 * Returns the keys named in the file (empty if the file does not exist).
 */
export function loadDotEnv(path: string): string[] {
  if (!existsSync(path)) return [];
  const parsed = parseEnv(readFileSync(path, "utf-8"));
  const keys = Object.keys(parsed);
  for (const key of keys) {
    withheldKeys.add(key);
    if (process.env[key] === undefined) {
      process.env[key] = parsed[key];
    }
  }
  return keys;
}

/** Environment for engine child processes: the current env minus gateway secrets. */
export function buildChildEnv(base: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...base };
  for (const key of withheldKeys) {
    delete env[key];
  }
  return env;
}

/** Names withheld from engine child processes (for diagnostics; never values). */
export function withheldEnvKeys(): string[] {
  return [...withheldKeys].sort();
}
