// Seed the main-owned locale preference (app-preferences.json) so E2E harnesses
// are deterministic regardless of the host OS locale. This is the same file the
// Settings → Language switch writes, so it exercises the real preference path.
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';

export function seedLocale(userDataDir, locale = 'en-US') {
  try {
    writeFileSync(
      join(userDataDir, 'app-preferences.json'),
      JSON.stringify({ locale }),
      'utf8'
    );
  } catch (error) {
    console.warn(`seedLocale: could not write preference (${String(error)})`);
  }
}
