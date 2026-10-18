import { checkReleaseProvider, releaseProviderEnv } from './release-provider.mjs';
checkReleaseProvider(releaseProviderEnv(process.env));
console.log('Longbridge release credential/quote preflight passed (response suppressed).');
