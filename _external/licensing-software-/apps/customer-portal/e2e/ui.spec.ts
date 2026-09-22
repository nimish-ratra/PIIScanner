import { test, expect } from '@playwright/test';

test.describe('Customer Portal Production Foundation', () => {

  test.beforeEach(async ({ context }) => {
    // 1. Establish E2E session cookie for the Acme India admin
    const res = await context.request.post('http://127.0.0.1:3001/api/v1/customer/auth/e2e/session', {
      data: { testIdentity: 'company-admin-acme-india' }
    });
    expect(res.ok()).toBeTruthy();
    
    // Playwright APIRequestContext does not always sync cookies to the browser context automatically in older versions.
    // We manually extract it from the response.
    const setCookieHeader = res.headers()['set-cookie'];
    if (setCookieHeader) {
      // Very basic extraction of the token
      const match = setCookieHeader.match(/E2E_SESSION=([^;]+)/);
      if (match) {
        await context.addCookies([{
          name: 'E2E_SESSION',
          value: match[1],
          domain: 'localhost',
          path: '/',
          httpOnly: true,
          sameSite: 'Lax'
        }]);
      }
    }
  });

  test('should load the overview and confirm no DevAuthSwitcher exists', async ({ page }) => {
    await page.goto('/overview');
    await expect(page).toHaveURL(/.*\/overview/);
    await expect(page.locator('h1')).toContainText('Overview');
    
    // Check that Dev Auth Switcher is completely gone
    const devAuth = page.locator('text=Development Authentication');
    await expect(devAuth).toHaveCount(0);
    
    // Check that static dev identity is working via cookie
    await expect(page.locator('header')).toContainText('india-admin@acme.test');
  });

  test('should load core operational pages without employee dashboard', async ({ page }) => {
    await page.goto('/overview');
    const sidebar = page.locator('nav');
    
    // Should see these
    await expect(sidebar.locator('text=Overview')).toBeVisible();
    await expect(sidebar.locator('text=Companies')).toBeVisible();
    await expect(sidebar.locator('text=Licenses')).toBeVisible();
    
    // Should NOT see employee Users dashboard
    await expect(sidebar.locator('text=Users').first()).toHaveCount(0);
  });

  test('should load companies page via real API', async ({ page }) => {
    await page.goto('/companies');
    await expect(page.locator('h1')).toContainText('Companies');
    await expect(page.locator('table')).toBeVisible();
    
    // Acme India comes from the Prisma seed data
    await expect(page.locator('table').locator('text=Acme India')).toBeVisible();
  });

  test('should distinguish entitlements and allocations in licenses view', async ({ context, page }) => {
    // Override the beforeEach session with an enterprise admin identity to see the Entitlements tab
    const res = await context.request.post('http://127.0.0.1:3001/api/v1/customer/auth/e2e/session', {
      data: { testIdentity: 'enterprise-admin-acme' }
    });
    const setCookieHeader = res.headers()['set-cookie'];
    if (setCookieHeader) {
      const match = setCookieHeader.match(/E2E_SESSION=([^;]+)/);
      if (match) {
        await context.addCookies([{ name: 'E2E_SESSION', value: match[1], domain: 'localhost', path: '/' }]);
      }
    }

    await page.goto('/licenses');
    await expect(page.locator('h1')).toContainText('Licenses');
    
    // Click Entitlements tab
    await page.locator('button[role="tab"]:has-text("Entitlements")').click();
    await expect(page.locator('h4:has-text("ENTITLEMENT")').first()).toBeVisible();
    
    // Click Allocations tab
    await page.locator('button[role="tab"]:has-text("Allocations")').click();
    await expect(page.locator('table')).toBeVisible();
  });

  test('should display license requests correctly', async ({ page }) => {
    await page.goto('/license-requests');
    await expect(page.locator('h1')).toContainText('License Requests');
    await expect(page.locator('text=No Requests Found')).toBeVisible();
  });
});
