import { readdirSync } from 'node:fs';
import { join, relative } from 'node:path';
import { expect, it } from 'vitest';

// vdoc#57: file-sync clients (iCloud Drive, Dropbox) resolve conflicts by
// writing a sibling named "<name> 2.<ext>". Vitest's glob skips such copies but
// tsc includes them, and `git add -A` would commit them. The file system is
// walked rather than `git ls-files`, because untracked copies break local
// typecheck too.

const ROOT = join(__dirname, '..');
/** A space, digits, then one or more extensions: "engine 2.ts", "page.test 3.tsx". */
const SYNC_CONFLICT_COPY = / \d+(\.[^./]+)+$/;
/** Dependencies, build output and git-ignored local artifacts, plus test
 *  fixtures, whose names legitimately contain spaces and digits
 *  ("QA 20261007 DOCX … Z.docx"). */
const SKIPPED = new Set(['node_modules', 'dist', 'out', 'coverage', 'tmp', 'output', 'outputs', 'work', 'tests/fixtures', 'qa-evidence']);

function syncConflictCopies(directory = ROOT): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    const path = join(directory, entry.name), name = relative(ROOT, path);
    // Dot-directories (.git, .next, .wrangler, …) are tool state, not source.
    if (entry.name.startsWith('.') || SKIPPED.has(name)) return [];
    const own = SYNC_CONFLICT_COPY.test(entry.name) ? [name] : [];
    return entry.isDirectory() ? [...own, ...syncConflictCopies(path)] : own;
  });
}

it('recognises sync-conflict copies, and not ordinary names', () => {
  for (const name of ['engine 2.ts', 'realtime-context.test 2.ts', 'client 2.json', 'README 10.md']) expect(name).toMatch(SYNC_CONFLICT_COPY);
  for (const name of ['engine.ts', 'engine2.ts', 'v2 notes', 'h264.ts', 'QA 20261007 DOCX.docx', 'client 2']) expect(name).not.toMatch(SYNC_CONFLICT_COPY);
});

it('has no sync-conflict copies ("name 2.ts") in the working copy', () => {
  // If this fails: compare each copy with its original, keep the right content
  // in the original, and delete the copy. Keep the checkout out of synced folders.
  expect(syncConflictCopies()).toEqual([]);
});
