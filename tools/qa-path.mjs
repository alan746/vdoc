// Resolve a fixture/evidence path for shell commands and external QA hosts.
import { qaPath } from './qa-paths.mjs';
console.log(qaPath(process.argv[2] || ''));
