/**
 * `npm-run-all` ships no type declarations and no `@types/npm-run-all` package
 * exists, so this declares the one entry point the scripts use.
 */
declare module "npm-run-all" {
  interface RunAllOptions {
    stdin?: NodeJS.ReadStream;
    stdout?: NodeJS.WriteStream;
    stderr?: NodeJS.WriteStream;
    silent?: boolean;
  }

  const runAll: (patterns: Array<string>, options?: RunAllOptions) => Promise<void>;
  export default runAll;
}
