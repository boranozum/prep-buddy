// The only file I/O in the data pipeline: packages/core stays pure (no I/O,
// per CLAUDE.md "Pure core"), so reading YAML off disk lives here in the CLI.
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { parse } from 'yaml';

/** Maps file id (basename without .yaml) -> parsed document. Missing dir = empty map. */
export function loadYamlDir(dir: string): Map<string, unknown> {
  const out = new Map<string, unknown>();
  if (!existsSync(dir)) return out;
  for (const fname of readdirSync(dir).sort()) {
    if (!fname.endsWith('.yaml')) continue;
    const id = fname.slice(0, -'.yaml'.length);
    out.set(id, parse(readFileSync(path.join(dir, fname), 'utf-8')));
  }
  return out;
}
