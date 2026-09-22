import { test, expect } from '@playwright/test';

/**
 * auth.spec.ts — Authentication flow E2E tests
 *
 * Customer Portal login is Trustfabric-managed email/password
 * (POST /customer/auth/login) — OIDC/SSO was removed. These tests exercise
 * the real login page and backend; only tenant/session-boundary checks that
 * need a pre-established session still use the E2E test-only session
 * endpoint (never through the login UI — that shortcut was removed from it).
 *
 * Credentials below match apps/api/prisma/seed-e2e.ts's DEV_TEST_PASSWORD —
 * local dev/test database only, never a real password.
 */

const VALID_EMAIL = 'india-admin@acme.test';
const VALID_PASSWORD = 'DevPassword!123';

test.describe('Customer Portal Authentication', () => {

  test('1. /login renders the email/password form, no OIDC or dev-login UI', async ({ page }) => {
    await page.goto('/login');
    await expect(page).toHaveURL(/\/login/);
    await expect(page.locator('h1')).toContainText('Trustfabric');
    await expect(page.getByLabel('Email')).toBeVisible();
    await expect(page.getByLabel('Password')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Sign in' })).toBeVisible();

    // OIDC/provider selection and the old dev-login shortcut must be gone
    await expect(page.locator('#btn-continue-with-microsoft')).toHaveCount(0);
    await expect(page.locator('#btn-development-login')).toHaveCount(0);
    await expect(page.getByText('Continue with Microsoft')).toHaveCount(0);
  });

  test('2. Unauthenticated user cannot access protected route', async ({ page }) => {
    await page.goto('/overview');
    await expect(page).toHaveURL(/\/login/);
  });

  test('3. Valid credentials authenticate and 4. reach Overview', async ({ page }) => {
    await page.goto('/login');
    await page.getByLabel('Email').fill(VALID_EMAIL);
    await page.getByLabel('Password').fill(VALID_PASSWORD);
    await page.getByRole('button', { name: 'Sign in' }).click();

    await expect(page).toHaveURL(/\/overview/);
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

  test("5b. Unknown email shows the identical generic error (no user enumeration)", async ({ page }) => {
    await page.goto('/login');
    await page.getByLabel('Email').fill('nobody-at-all@acme.test');
    await page.getByLabel('Password').fill('whatever');
    await page.getByRole('button', { name: 'Sign in' }).click();

    await expect(page.getByText('Invalid email or password')).toBeVisible();
  });

  test('6. Logout works and returns to /login', async ({ page }) => {
    await page.goto('/login');
    await page.getByLabel('Email').fill(VALID_EMAIL);
    await page.getByLabel('Password').fill(VALID_PASSWORD);
    await page.getByRole('button', { name: 'Sign in' }).click();
    await expect(page).toHaveURL(/\/overview/);

    await page.locator('#btn-user-menu').click();
    await page.locator('#btn-logout').click();

    await expect(page).toHaveURL(/\/login/);
    // The session must actually be gone server-side, not just a client redirect
    await page.goto('/overview');
    await expect(page).toHaveURL(/\/login/);
  });

  test('7. Refresh preserves the authenticated session', async ({ page }) => {
    await page.goto('/login');
    await page.getByLabel('Email').fill(VALID_EMAIL);
    await page.getByLabel('Password').fill(VALID_PASSWORD);
    await page.getByRole('button', { name: 'Sign in' }).click();
    await expect(page).toHaveURL(/\/overview/);

    await page.reload();
    await expect(page).toHaveURL(/\/overview/);
    await expect(page.locator('h1')).toContainText('Overview');
  });

  test('8. Expired session (cleared cookie) redirects to /login', async ({ context, page }) => {
    const res = await context.request.post('http://127.0.0.1:3001/api/v1/customer/auth/e2e/session', {
      data: { testIdentity: 'company-admin-acme-india' }
    });
    const setCookieHeader = res.headers()['set-cookie'];
    if (setCookieHeader) {
      const match = setCookieHeader.match(/E2E_SESSION=([^;]+)/);
      if (match) {
        await context.addCookies([{
          name: 'E2E_SESSION', value: match[1],
          domain: 'localhost', path: '/', httpOnly: true, sameSite: 'Lax'
        }]);
      }
    }

    await page.goto('/overview');
    await expect(page).toHaveURL(/\/overview/);

    await context.clearCookies();
    await page.goto('/overview');
    await expect(page).toHaveURL(/\/login/);
  });

  test('9. Company scope is enforced after authentication (Globex cannot see Acme)', async ({ context }) => {
    const res = await context.request.post('http://127.0.0.1:3001/api/v1/customer/auth/e2e/session', {
      data: { testIdentity: 'company-admin-globex' }
    });
    const setCookieHeader = res.headers()['set-cookie'];
    if (setCookieHeader) {
      const match = setCookieHeader.match(/E2E_SESSION=([^;]+)/);
      if (match) {
        await context.addCookies([{ name: 'E2E_SESSION', value: match[1], domain: 'localhost', path: '/' }]);
      }
    }

    const apiRes = await context.request.get('http://127.0.0.1:3001/api/v1/customer/companies/comp-acme-in');
    expect(apiRes.status()).toBe(404); // IDOR protection returns 404, not 403
  });

  test('10. Customer cannot reach vendor API', async ({ context }) => {
    const res = await context.request.post('http://127.0.0.1:3001/api/v1/customer/auth/e2e/session', {
      data: { testIdentity: 'company-admin-acme-india' }
    });
    const setCookieHeader = res.headers()['set-cookie'];
    if (setCookieHeader) {
      const match = setCookieHeader.match(/E2E_SESSION=([^;]+)/);
      if (match) {
        await context.addCookies([{ name: 'E2E_SESSION', value: match[1], domain: 'localhost', path: '/' }]);
      }
    }

    const apiRes = await context.request.get('http://127.0.0.1:3001/api/v1/vendor/companies');
    expect([403, 404]).toContain(apiRes.status());
  });
});
