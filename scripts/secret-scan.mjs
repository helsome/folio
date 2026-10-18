// Scan tracked source only. Report paths, never matched secret values.
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
const files = execFileSync('git', ['ls-files', '-z'], { encoding: 'utf8' }).split('\0').filter(Boolean);
const pattern = /ghp_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}|sk-[A-Za-z0-9]{20,}|AKIA[0-9A-Z]{16}|-----BEGIN [A-Z ]*PRIVATE KEY-----/;
const matches = files.filter((path) => {
  if (/^(docs|artifacts)\//.test(path) || /\.md$|\.test\.tsx?$|bun\.lock$/.test(path)) return false;
  const body = readFileSync(path);
  return !body.includes(0) && pattern.test(body.toString('utf8'));
});
if (matches.length) { console.error('Possible secret patterns in:\n' + matches.join('\n')); process.exit(1); }
console.log('No high-signal secrets found in tracked source.');
