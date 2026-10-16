/**
 * PROTOTYPE dev server: the page, plus alphaTab's runtime assets (worker
 * script, music font, soundfont), which alphaTab loads by URL at run time.
 *
 * Usage: bun server.ts   (http://localhost:4410)
 */
import path from "node:path";
import page from "./index.html";

const alphaTabDist = path.join(import.meta.dir, "node_modules/@coderline/alphatab/dist");

Bun.serve({
  port: Number(process.env.PORT ?? 4410),
  development: true,
  routes: {
    "/": page,
    "/alphatab/*": (request) => {
      const file = path.normalize(new URL(request.url).pathname.slice("/alphatab/".length));
      if (file.startsWith("..")) return new Response("not found", { status: 404 });
      return new Response(Bun.file(path.join(alphaTabDist, file)));
    },
  },
});

console.log(`chart-anchoring prototype on http://localhost:${process.env.PORT ?? 4410}`);
