/** Tiny `--key=value` / `--flag` parser — no need for a dependency here. */
export function parseArgs(argv: readonly string[]): Record<string, string> {
  const args: Record<string, string> = {};
  for (const token of argv) {
    if (!token.startsWith('--')) continue;
    const eq = token.indexOf('=');
    if (eq === -1) {
      args[token.slice(2)] = 'true';
    } else {
      args[token.slice(2, eq)] = token.slice(eq + 1);
    }
  }
  return args;
}
