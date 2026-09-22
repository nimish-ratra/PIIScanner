import { execSync } from 'child_process';
import { resolve } from 'path';
import { mkdirSync } from 'fs';
import { request } from '@playwright/test';

const AUTH_FILE = resolve(__dirname, '.auth/vendor-admin.json');
// Must match apiClient's API_BASE host exactly ("localhost", not "127.0.0.1")
// — cookies are scoped per-hostname, so logging in against a different host
// than the one the app actually calls at runtime silently produces a
// storageState cookie the browser never sends.
const VENDOR_API_BASE = 'http://localhost:3001/api/v1/vendor';
// Matches apps/api/prisma/seed-e2e.ts's `user-vendor-admin` fixture and
// DEV_TEST_PASSWORD — local dev/test database only, never a real password.
const VENDOR_EMAIL = 'admin@trustfabric.test';
const VENDOR_PASSWORD = 'DevPassword!123';

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

  // Log in via the REAL POST /vendor/auth/login endpoint once, then save the
  // resulting session cookie as storageState — every test project's
  // `use.storageState` starts already authenticated (see playwright.config.ts),
  // so the ~17 pre-existing tests that assume "already logged in" don't each
  // need their own login boilerplate. The login page's own behavior (render,
  // wrong password, redirect-when-unauthenticated, logout) is covered
  // separately by e2e/vendor-auth.spec.ts, which opts out of this
  // storageState with `test.use({ storageState: { cookies: [], origins: [] } })`.
  console.log('[globalSetup] Logging in as vendor-admin to seed storage state...');
  const ctx = await request.newContext();
  try {
    const res = await ctx.post(`${VENDOR_API_BASE}/auth/login`, {
      data: { email: VENDOR_EMAIL, password: VENDOR_PASSWORD },
    });
    if (!res.ok()) {
      console.error(`[globalSetup] Vendor login failed (${res.status()}) — tests will run unauthenticated.`);
    }
    mkdirSync(resolve(__dirname, '.auth'), { recursive: true });
    await ctx.storageState({ path: AUTH_FILE });
  } finally {
    await ctx.dispose();
  }
}
