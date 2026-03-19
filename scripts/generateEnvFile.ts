#!/usr/bin/env bun
/**
 * generateEnvFile — create or fill missing values in .env
 *
 * Preserves existing values. Only generates passwords/secrets for missing fields.
 * Derived fields (URLs) are rebuilt from their component values.
 */
import crypto from "crypto";
import path from "path";
import { Effect, pipe, Record as R } from "effect";
import { NodeContext, NodeRuntime } from "@effect/platform-node";
import { FileSystem } from "@effect/platform";

const genPassword = (len = 32) => crypto.randomBytes(len).toString("base64url");
const genSecret = (len = 64) => crypto.randomBytes(len).toString("hex");

type Ctx = Record<string, string>;

interface FieldDef {
  default?: string;
  generate?: () => string;
  derive?: (ctx: Ctx) => string;
}

const fields: [string, FieldDef][] = [
  ["NODE_ENV", { default: "development" }],

  ["ROOT_DATABASE_USER", { default: "postgres" }],
  ["ROOT_DATABASE_PASSWORD", { default: "postgres" }],
  ["DATABASE_HOST", { default: "localhost" }],
  ["DATABASE_PORT", { default: "5432" }],
  ["DATABASE_NAME", { default: "setlist" }],

  ["DATABASE_OWNER", { derive: (c) => c.DATABASE_NAME }],
  ["DATABASE_OWNER_PASSWORD", { generate: genPassword }],
  ["DATABASE_AUTHENTICATOR", { derive: (c) => `${c.DATABASE_NAME}_authenticator` }],
  ["DATABASE_AUTHENTICATOR_PASSWORD", { generate: genPassword }],
  ["DATABASE_VISITOR", { derive: (c) => `${c.DATABASE_NAME}_visitor` }],
  ["SHADOW_DATABASE_PASSWORD", { generate: genPassword }],

  ["ROOT_DATABASE_URL", {
    derive: (c) =>
      `postgres://${c.ROOT_DATABASE_USER}:${c.ROOT_DATABASE_PASSWORD}@${c.DATABASE_HOST}:${c.DATABASE_PORT}/template1`,
  }],
  ["DATABASE_URL", {
    derive: (c) =>
      `postgres://${c.DATABASE_OWNER}:${c.DATABASE_OWNER_PASSWORD}@${c.DATABASE_HOST}:${c.DATABASE_PORT}/${c.DATABASE_NAME}`,
  }],
  ["AUTH_DATABASE_URL", {
    derive: (c) =>
      `postgres://${c.DATABASE_AUTHENTICATOR}:${c.DATABASE_AUTHENTICATOR_PASSWORD}@${c.DATABASE_HOST}:${c.DATABASE_PORT}/${c.DATABASE_NAME}`,
  }],
  ["SHADOW_DATABASE_URL", {
    derive: (c) =>
      `postgres://${c.DATABASE_NAME}_shadow:${c.SHADOW_DATABASE_PASSWORD}@${c.DATABASE_HOST}:${c.DATABASE_PORT}/${c.DATABASE_NAME}_shadow`,
  }],

  ["PORT", { default: "3001" }],
  ["VITE_ROOT_URL", { derive: (c) => `http://localhost:${c.PORT}` }],
  ["SECRET", { generate: genSecret }],
  ["VALKEY_URL", { derive: (c) => `redis://${c.DATABASE_HOST}:6380` }],
  ["RESEND_API_KEY", { default: "" }],
  ["ADMIN_EMAIL", { default: "danielfgray@gmail.com" }],
];

const DOTENV_PATH = path.resolve(import.meta.dir, "..", ".env");

const parseDotenv = (content: string): Ctx =>
  content.split("\n").reduce<Ctx>((acc, line) => {
    const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
    return m ? { ...acc, [m[1]]: m[2] } : acc;
  }, {});

const resolveField = (key: string, def: FieldDef, existing: Ctx, resolved: Ctx): string => {
  if (def.derive) return def.derive(resolved);
  if (existing[key]) return existing[key];
  if (def.generate) return def.generate();
  return def.default ?? "";
};

const program = Effect.gen(function* () {
  const fs = yield* FileSystem.FileSystem;

  const existing = yield* pipe(
    fs.readFileString(DOTENV_PATH),
    Effect.map(parseDotenv),
    Effect.orElseSucceed((): Ctx => ({})),
  );

  // Resolve fields in order, preserving existing values
  const resolved = fields.reduce<Ctx>(
    (ctx, [key, def]) => ({ ...ctx, [key]: resolveField(key, def, existing, ctx) }),
    {},
  );

  // Preserve extra user-added keys
  const knownKeys = new Set(fields.map(([k]) => k));
  const extras = R.filter(existing, (_, k) => !knownKeys.has(k));
  const merged = { ...resolved, ...extras };

  const content = Object.entries(merged)
    .map(([k, v]) => `${k}=${v}`)
    .join("\n")
    .concat("\n");

  yield* fs.writeFileString(DOTENV_PATH, content);

  const action = Object.keys(existing).length > 0 ? "Updated" : "Wrote";
  yield* Effect.log(`${action} .env`);
});

program.pipe(Effect.provide(NodeContext.layer), NodeRuntime.runMain);
