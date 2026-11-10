#!/usr/bin/env bun
/**
 * generateEnvFile — create or fill missing values in .env
 *
 * Preserves existing values. Only generates passwords/secrets for missing fields.
 * Derived fields (URLs) are rebuilt from their component values.
 */
import crypto from "crypto";
import path from "path";
import { fileURLToPath } from "url";
import { Effect, pipe, Record as R } from "effect";
import { NodeRuntime, NodeServices } from "@effect/platform-node";
import * as FileSystem from "effect/FileSystem";

const genSecret = (len = 64) => crypto.randomBytes(len).toString("hex");

type Ctx = Record<string, string>;

interface FieldDef {
  default?: string;
  generate?: () => string;
  derive?: (ctx: Ctx) => string;
}

const fields: [string, FieldDef][] = [
  ["NODE_ENV", { default: "development" }],

  // Host/port are informational; `ops dev db up` writes DATABASE_URL /
  // AUTH_DATABASE_URL / SHADOW_DATABASE_URL / TEST_DATABASE_URL on the managed cluster.
  ["DATABASE_HOST", { default: "127.0.0.1" }],
  ["DATABASE_PORT", { default: "5417" }],
  ["DATABASE_NAME", { default: "giglist" }],

  ["DATABASE_OWNER", { derive: (c) => `${c.DATABASE_NAME}_owner` }],
  [
    "DATABASE_AUTHENTICATOR",
    { derive: (c) => `alchemy_${c.DATABASE_NAME}_api` },
  ],
  ["DATABASE_VISITOR", { derive: (c) => `${c.DATABASE_NAME}_visitor` }],

  // PORT is the Effect API server. CLIENT_PORT is the Vite dev server the browser
  // talks to. They must differ: both processes bind their own port, and Vite
  // forwards /api to PORT.
  ["PORT", { default: "3000" }],
  ["CLIENT_PORT", { default: "3001" }],
  ["VITE_ROOT_URL", { derive: (c) => `http://localhost:${c.CLIENT_PORT}` }],
  ["SECRET", { generate: genSecret }],
  ["VALKEY_URL", { derive: (c) => `redis://${c.DATABASE_HOST}:6380` }],
  // The platform sets `<cartridge name>:` in production; keys outside it are refused there.
  ["VALKEY_KEY_PREFIX", { default: "giglist:" }],
  ["RESEND_API_KEY", { default: "" }],
  ["ADMIN_EMAIL", { default: "danielfgray@gmail.com" }],
];

// `import.meta.dir` is a Bun extension; derive the directory from the module
// URL so the file is typed by @types/node and portable to plain Node.
const DOTENV_PATH = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  ".env",
);

const parseDotenv = (content: string): Ctx =>
  content.split("\n").reduce<Ctx>((acc, line) => {
    const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
    return m ? { ...acc, [m[1]]: m[2] } : acc;
  }, {});

const resolveField = (
  key: string,
  def: FieldDef,
  existing: Ctx,
  resolved: Ctx,
): string => {
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
    (ctx, [key, def]) => ({
      ...ctx,
      [key]: resolveField(key, def, existing, ctx),
    }),
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

program.pipe(Effect.provide(NodeServices.layer), NodeRuntime.runMain);
