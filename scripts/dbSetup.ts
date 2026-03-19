#!/usr/bin/env bun
import pg from "pg";

const env = (k: string) => {
  const v = process.env[k];
  if (!v) throw new Error(`Missing env: ${k}`);
  return v;
};

async function main() {
  const client = new pg.Client({ connectionString: env("ROOT_DATABASE_URL") });
  await client.connect();

  const dbName = env("DATABASE_NAME");
  const owner = env("DATABASE_OWNER");
  const ownerPw = env("DATABASE_OWNER_PASSWORD");
  const auth = env("DATABASE_AUTHENTICATOR");
  const authPw = env("DATABASE_AUTHENTICATOR_PASSWORD");
  const visitor = env("DATABASE_VISITOR");
  const shadowPw = env("SHADOW_DATABASE_PASSWORD");

  const sql = (s: string) =>
    client.query(s).catch((e: any) => {
      if (!e.message.includes("does not exist")) throw e;
    });

  // Drop existing
  for (const db of [dbName, `${dbName}_shadow`, `${dbName}_test`]) {
    await sql(`DROP DATABASE IF EXISTS "${db}"`);
  }
  for (const role of [owner, auth, visitor, `${dbName}_shadow`]) {
    await sql(`DROP ROLE IF EXISTS "${role}"`);
  }

  // Create roles
  await client.query(`CREATE ROLE "${owner}" LOGIN PASSWORD '${ownerPw}'`);
  await client.query(
    `CREATE ROLE "${auth}" LOGIN PASSWORD '${authPw}' NOINHERIT`,
  );
  await client.query(`CREATE ROLE "${visitor}"`);
  await client.query(
    `CREATE ROLE "${dbName}_shadow" LOGIN PASSWORD '${shadowPw}' SUPERUSER`,
  );
  await client.query(`GRANT "${visitor}" TO "${auth}"`);

  // Create databases
  await client.query(`CREATE DATABASE "${dbName}" OWNER "${owner}"`);
  await client.query(
    `CREATE DATABASE "${dbName}_shadow" OWNER "${dbName}_shadow"`,
  );
  await client.query(`CREATE DATABASE "${dbName}_test" OWNER "${owner}"`);

  console.log(`Created databases and roles for ${dbName}`);
  await client.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
