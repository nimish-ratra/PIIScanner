import { test, expect } from '@playwright/test';

/**
 * vendor-auth.spec.ts — Trustfabric Admin login flow.
 *
 * Trustfabric Admin login is real, Trustfabric-managed email/password
 * (POST /vendor/auth/login) against VendorUser.passwordHash — not the
 * automatic E2E_SESSION bootstrap the rest of this suite's specs rely on via
 * playwright.config.ts's `storageState` (see global-setup.ts). These tests
 * specifically exercise the login PAGE and unauthenticated behavior, so they
 * opt out of that pre-authenticated storage state.
 *
 * Credentials below match apps/api/prisma/seed-e2e.ts's `user-vendor-admin` /
 * `user-vendor-disabled` fixtures and DEV_TEST_PASSWORD — local dev/test
 * database only, never a real password.
 */
test.use({ storageState: { cookies: [], origins: [] } });

const VALID_EMAIL = 'admin@trustfabric.test';
const DISABLED_EMAIL = 'disabled-admin@trustfabric.test';
const VALID_PASSWORD = 'DevPassword!123';

test.describe('Trustfabric Admin Authentication', () => {

  test('1. /login renders the email/password form, no OIDC or dev-login UI', async ({ page }) => {
    await page.goto('/login');
    await expect(page).toHaveURL(/\/login/);
    await expect(page.locator('h1')).toContainText('Trustfabric');
    await expect(page.getByLabel('Email')).toBeVisible();
    await expect(page.getByLabel('Password')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Sign in' })).toBeVisible();

    await expect(page.locator('#btn-continue-with-microsoft')).toHaveCount(0);
    await expect(page.locator('#btn-development-login')).toHaveCount(0);
    await expect(page.getByText('Continue with Microsoft')).toHaveCount(0);
  });

  test('2. Unauthenticated user cannot access a protected route', async ({ page }) => {
    await page.goto('/dashboard');
    await expect(page).toHaveURL(/\/login/);
  });

  test('3. Valid credentials authenticate and 4. reach the dashboard', async ({ page }) => {
    await page.goto('/login');
    await page.getByLabel('Email').fill(VALID_EMAIL);
    await page.getByLabel('Password').fill(VALID_PASSWORD);
    await page.getByRole('button', { name: 'Sign in' }).click();

    await expect(page).toHaveURL(/\/dashboard/);
    await expect(page.locator('h1')).toContainText('Overview');
  });

  test('5. Invalid credentials display a generic error, no redirect', async ({ page }) => {
    await page.goto('/login');
    await page.getByLabel('Email').fill(VALID_EMAIL);
    await page.getByLabel('Password').fill('definitely-the-wrong-password');
    await page.getByRole('button', { name: 'Sign in' }).click();

    await expect(page.getByText('Invalid email or password')).toBeVisible();
    await expect(page).toHaveURL(/\/login/);
  });

  test('5b. Unknown email shows the identical generic error (no user enumeration)', async ({ page }) => {
    await page.goto('/login');
    await page.getByLabel('Email').fill('nobody-at-all@trustfabric.test');
    await page.getByLabel('Password').fill('whatever');
    await page.getByRole('button', { name: 'Sign in' }).click();

    await expect(page.getByText('Invalid email or password')).toBeVisible();
  });

  test('5c. A disabled vendor account is rejected even with the correct password', async ({ page }) => {
    await page.goto('/login');
    await page.getByLabel('Email').fill(DISABLED_EMAIL);
    await page.getByLabel('Password').fill(VALID_PASSWORD);
    await page.getByRole('button', { name: 'Sign in' }).click();

    await expect(page.getByText('Invalid email or password')).toBeVisible();
    await expect(page).toHaveURL(/\/login/);
  });

  test('6. Logout works and returns to /login', async ({ page }) => {
    await page.goto('/login');
    await page.getByLabel('Email').fill(VALID_EMAIL);
    await page.getByLabel('Password').fill(VALID_PASSWORD);
    await page.getByRole('button', { name: 'Sign in' }).click();
    await expect(page).toHaveURL(/\/dashboard/);

    await page.locator('#btn-user-menu').click();
    await page.locator('#btn-logout').click();

    await expect(page).toHaveURL(/\/login/);
    // The session must actually be gone server-side, not just a client redirect
    await page.goto('/dashboard');
    await expect(page).toHaveURL(/\/login/);
  });

  test('7. Refresh preserves the authenticated session', async ({ page }) => {
    await page.goto('/login');
    await page.getByLabel('Email').fill(VALID_EMAIL);
    await page.getByLabel('Password').fill(VALID_PASSWORD);
    await page.getByRole('button', { name: 'Sign in' }).click();
    await expect(page).toHaveURL(/\/dashboard/);

    await page.reload();
    await expect(page).toHaveURL(/\/dashboard/);
    await expect(page.locator('h1')).toContainText('Overview');
  });

  test('8. A customer session does not authenticate the vendor portal (principal isolation)', async ({ context, page }) => {
    // Must hit the same host ("localhost") the app itself calls — the
    // cookie is scoped per-hostname, so a 127.0.0.1 login wouldn't even be
    // sent to a localhost:3002 page and this test would pass vacuously.
    const res = await context.request.post('http://localhost:3001/api/v1/customer/auth/login', {
      data: { email: 'india-admin@acme.test', password: VALID_PASSWORD },
    });
    expect(res.ok()).toBe(true);

    // TF_SESSION (customer) really is present in the browser now — but the
    // vendor portal's middleware only recognizes TF_VENDOR_SESSION, so it
    // must still redirect to /login.
    await page.goto('/dashboard');
    await expect(page).toHaveURL(/\/login/);
  });
});
