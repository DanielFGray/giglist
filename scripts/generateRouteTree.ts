/**
 * Write src/routeTree.gen.ts from src/routes, as the vite plugin does on each start. A tree
 * with no vite run behind it (a fresh worktree, or the one `ops signoff` exports) has no
 * route tree, and the type check fails without one. Both read tsr.config.json.
 */
import { Generator, getConfig } from "@tanstack/router-generator";

const root = process.cwd();
await new Generator({ config: getConfig({}, root), root }).run();
