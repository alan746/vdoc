// CommonJS implementation shared by CJS tools and the ESM facade.
const path = require('node:path');
const config = require('./qa-paths.json');
const projectRoot = path.resolve(__dirname, '..');
const evidenceRoot = path.resolve(projectRoot, process.env.VDOC_QA_EVIDENCE || config.evidenceDirectory);
const fixtureRoot = path.join(projectRoot, ...config.fixtureDirectory);
const retained = new Set(config.retainedFixtureDirectories);
function qaPath(relative = '') {
  const normalized = relative.replaceAll('\\', '/');
  const root = retained.has(normalized.split('/')[0]) ? fixtureRoot : evidenceRoot;
  // Existing QA scripts append filenames to directory strings.
  return path.resolve(root, normalized) + (normalized.endsWith('/') ? path.sep : '');
}
function recordedPath(relative) {
  const prefix = config.fixtureDirectory.join('/') + '/';
  if (relative.startsWith(prefix)) return qaPath(relative.slice(prefix.length));
  const evidencePrefix = config.evidenceDirectory + '/';
  return relative.startsWith(evidencePrefix) ? path.resolve(evidenceRoot, relative.slice(evidencePrefix.length)) : path.resolve(projectRoot, relative);
}
module.exports = { projectRoot, evidenceRoot, fixtureRoot, qaPath, recordedPath };
