import { test, expect, type APIRequestContext } from '@playwright/test';

const API_BASE = 'http://127.0.0.1:3001/api/v1';

async function authenticateAs(context: { request: APIRequestContext; addCookies: (c: any[]) => Promise<void> }, testIdentity: string) {
  const res = await context.request.post(`${API_BASE}/customer/auth/e2e/session`, {
    data: { testIdentity },
  });
  const setCookieHeader = res.headers()['set-cookie'];
  if (setCookieHeader) {
    const match = setCookieHeader.match(/E2E_SESSION=([^;]+)/);
    if (match) {
      await context.addCookies([{
        name: 'E2E_SESSION', value: match[1],
        domain: 'localhost', path: '/', httpOnly: true, sameSite: 'Lax',
      }]);
    }
  }
}

test.describe('Customer Portal Fleet Protection & Telemetry', () => {

  test.beforeEach(async ({ context }) => {
    await authenticateAs(context, 'company-admin-acme-india');
  });

  test('1. Fleet Protection page renders navigation and filters', async ({ page }) => {
    await page.goto('/telemetry');
    await expect(page.getByRole('heading', { name: 'Fleet Protection' })).toBeVisible();
    await expect(page.getByPlaceholder(/search hostname/i)).toBeVisible();
    await expect(page.getByRole('button', { name: /refresh/i })).toBeVisible();
  });

  test('2. Installation dialog contains Protection & Fleet tab', async ({ page }) => {
    await page.goto('/installations');
    // Click on fixture installation
    await page.locator('tr', { hasText: 'laptop-in-01' }).click();

    // Check tab list
    await expect(page.getByRole('tab', { name: 'Identity & License' })).toBeVisible();
    const protectionTab = page.getByRole('tab', { name: /Protection & Fleet/i });
    await expect(protectionTab).toBeVisible();

    // Switch to Protection tab
    await protectionTab.click();
    await expect(page.getByText('Fleet Protection')).toBeVisible();
    await expect(page.getByText('Remote Device Commands')).toBeVisible();
    await expect(page.getByText('Recent Scans')).toBeVisible();
    await expect(page.getByText('Real-Time DLP Enforcement Activity')).toBeVisible();
  });

  test('3. Settings page displays Fleet Reporting configuration card and confirm dialog', async ({ page }) => {
    await page.goto('/settings');
    await expect(page.getByText('Fleet Reporting & Telemetry Policy')).toBeVisible();
    await expect(page.getByText('Enable Fleet Telemetry')).toBeVisible();
    await expect(page.getByText('Share Literal File Paths')).toBeVisible();

    // Toggle literal file paths opens confirmation modal
    const fullPathToggle = page.locator('button', { has: page.locator('span') }).nth(1);
    await fullPathToggle.click();
    await expect(page.getByText('Enable Literal File Paths?')).toBeVisible();
    await page.getByRole('button', { name: 'Cancel' }).click();
    await expect(page.getByText('Enable Literal File Paths?')).toHaveCount(0);
  });
});
