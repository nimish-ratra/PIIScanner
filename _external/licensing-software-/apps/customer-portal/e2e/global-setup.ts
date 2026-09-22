import { execSync } from 'child_process';
import { resolve } from 'path';

export default async function globalSetup() {
  console.log('[globalSetup] Reseeding dev database before Playwright run...');

  const apiPath = resolve(__dirname, '../../api');

  try {
    // Runs the TypeScript seed source directly via ts-node's ESM loader
    // (apps/api's package.json is "type": "module", so plain ts-node/node
    // can't load a .ts file without this) against the running dev database.
    execSync('node --loader ts-node/esm prisma/seed-e2e.ts', {
      cwd: apiPath,
      stdio: 'inherit',
    });
    console.log('[globalSetup] Database seeded successfully.');
  } catch (err) {
    console.error('[globalSetup] Seed failed — tests may use stale data.', err);
    // Don't throw: allow tests to proceed and fail with descriptive errors
  }
}
