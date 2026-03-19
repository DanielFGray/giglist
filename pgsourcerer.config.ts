import {
  defineConfig,
  kysely,
  effect,
} from "@danielfgray/pg-sourcerer"

export default defineConfig({
  connectionString: process.env.AUTH_DATABASE_URL!,
  role: process.env.DATABASE_VISITOR!,
  schemas: ["app_public"],
  outputDir: "./generated",
  plugins: [
    kysely({
      dbAsParameter: {
        types: ["KyselyDB"],
        named: ["Db"],
        path: "./src/server/db.ts",
      },
    }),
    effect({ repoModel: false }),
  ],
})
