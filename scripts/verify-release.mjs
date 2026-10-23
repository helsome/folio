import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { validateVersion, verifyRelease } from './release-lib.mjs';
const version = validateVersion(JSON.parse(readFileSync('package.json')).version,
  JSON.parse(readFileSync('apps/electron/package.json')).version, process.env.RELEASE_TAG);
if (!/^[a-f0-9]{40}$/.test(process.env.FINAGENT_BUILD_SHA || '')) throw new Error('Expected full build SHA');
verifyRelease(resolve('dist/release'), version, process.env.FINAGENT_BUILD_SHA);
console.log('All three installers, checksums and native validation reports verified.');
