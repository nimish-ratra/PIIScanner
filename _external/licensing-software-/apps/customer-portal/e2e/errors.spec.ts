import { test, expect } from '@playwright/test';

test.describe('Customer Portal Failure Handling', () => {

  test.beforeEach(async ({ context }) => {
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
  });

  test('should securely handle API 403 response', async ({ page }) => {
    await page.route('**/api/v1/customer/companies', async route => {
      await route.fulfill({ status: 403, body: JSON.stringify({ message: 'Forbidden Access' }) });
    });
    await page.goto('/companies');
    
    await expect(page.locator('text=Something went wrong')).toBeVisible();
    await expect(page.locator('text=Forbidden Access')).toBeVisible();
  });

  test('should securely handle API 404 response', async ({ page }) => {
    await page.route('**/api/v1/customer/licenses/summary', async route => {
      await route.fulfill({ status: 404, body: JSON.stringify({ message: 'Resource not found' }) });
    });
    await page.goto('/overview');
    
    await expect(page.locator('text=Something went wrong')).toBeVisible();
    await expect(page.locator('text=Resource not found').first()).toBeVisible();
  });
  
  test('should securely handle complete API unavailability', async ({ page }) => {
    await page.route('**/api/v1/customer/licenses/summary', async route => {
      route.abort('failed');
    });
    await page.goto('/overview');
    
    await expect(page.locator('text=Something went wrong')).toBeVisible();
    await expect(page.locator('text=Failed to fetch')).toBeVisible();
  });
});
