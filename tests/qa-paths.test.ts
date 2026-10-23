import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { join, resolve } from 'node:path';
import { readdirSync } from 'node:fs';
import { expect, it } from 'vitest';
import config from '../tools/qa-paths.json';

const require = createRequire(import.meta.url);
const root = resolve(__dirname, '..');
const helper = join(root, 'tools/qa-paths.cjs');
const probe = (relative: string, external?: string) => {
  const env = { ...process.env, VDOC_QA_EVIDENCE: external ?? '' };
  return execFileSync(process.execPath, ['-e', 'process.stdout.write(require(process.argv[1]).qaPath(process.argv[2]))', helper, relative], { cwd: '/tmp', env, encoding: 'utf8' });
};

it('keeps only automated inputs in the fixture tree', () => {
  expect(readdirSync(join(root, ...config.fixtureDirectory)).sort()).toEqual([...config.retainedFixtureDirectories].sort());
});
it('uses a configurable evidence root while keeping retained inputs in the repository', () => {
  const external = '/tmp/QA evidence with spaces';
  expect(probe('reader-control-20261011/audit.json')).toBe(join(root, 'qa-evidence/reader-control-20261011/audit.json'));
  expect(probe('reader-control-20261011/audit.json', external)).toBe(join(external, 'reader-control-20261011/audit.json'));
  expect(probe('safari-preview/source.vdoc.json', external)).toBe(join(root, 'tests/fixtures/safari-preview/source.vdoc.json'));
  expect(probe('reader-control-20261011/', external)).toBe(join(external, 'reader-control-20261011') + '/');
});
it('resolves old report paths and new logical names in Python without changing historical records', () => {
  const external = '/tmp/QA evidence with spaces';
  const output = execFileSync('python3', ['-c', [
    'import sys,json;sys.path.insert(0,sys.argv[1])',
    'from qa_paths import qa_path,recorded_path,recorded_name',
    "print(json.dumps([str(qa_path('reader-control-20261011/audit.json')), str(recorded_path('tests/fixtures/reader-control-20261011/audit.json')), str(recorded_path('qa-evidence/reader-control-20261011/audit.json')), recorded_name(qa_path('reader-control-20261011/audit.json')), str(qa_path('safari-preview/source.vdoc.json'))]))",
  ].join(';'), join(root, 'tools')], { env: { ...process.env, VDOC_QA_EVIDENCE: external }, encoding: 'utf8' });
  const expected = join(external, 'reader-control-20261011/audit.json');
  expect(JSON.parse(output)).toEqual([expected, expected, expected, 'qa-evidence/reader-control-20261011/audit.json', join(root, 'tests/fixtures/safari-preview/source.vdoc.json')]);
});
it('resolves legacy JavaScript report paths through the same root', () => {
  const { recordedPath, qaPath } = require(helper);
  expect(recordedPath('tests/fixtures/reader-control-20261011/audit.json')).toBe(qaPath('reader-control-20261011/audit.json'));
  expect(recordedPath('lib/usecases/engine.ts')).toBe(join(root, 'lib/usecases/engine.ts'));
});
it('verifies archive recovery and rejects corruption or missing inventory entries', () => {
  expect(() => execFileSync('python3', [join(root, 'tools/test_qa_archive.py'), '--quiet'], { encoding: 'utf8', stdio: 'pipe' })).not.toThrow();
});
