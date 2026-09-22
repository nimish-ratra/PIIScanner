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

/** Creates an enrollment token then redeems it, giving each test its own isolated Installation. */
async function registerIsolatedInstallation(request: APIRequestContext, hostname: string) {
  const tokenRes = await request.post(`${API_BASE}/customer/companies/comp-acme-in/enrollment-tokens`, {
    data: { allocationId: 'alloc-acme-in', label: `pw-${hostname}` },
  });
  const { token } = await tokenRes.json();

  const registerRes = await request.post(`${API_BASE}/agent/register`, {
    data: {
      enrollmentToken: token,
      deviceId: `pw-device-${hostname}`,
      hostname,
      os: 'Windows 11',
      osVersion: '24H2',
      architecture: 'x64',
      applicationVersion: '9.9.9',
      agentVersion: '9.9.9',
    },
  });
  const body = await registerRes.json();
  return body.installationId as string;
}

test.describe('Customer Portal Installations', () => {

  test.beforeEach(async ({ context }) => {
    await authenticateAs(context, 'company-admin-acme-india');
  });

  test('1. Installations page displays finalized backend data', async ({ page }) => {
    await page.goto('/installations');
    // Seeded fixture installation from seed-e2e.ts
    await expect(page.getByText('laptop-in-01')).toBeVisible();
    await expect(page.getByText('Windows 11').first()).toBeVisible();
  });

  test('2. Installation details dialog opens with all sections', async ({ page }) => {
    await page.goto('/installations');
    await page.locator('tr', { hasText: 'laptop-in-01' }).click();

    await expect(page.getByText('Identity')).toBeVisible();
    await expect(page.getByText('Ownership')).toBeVisible();
    await expect(page.getByText('Telemetry')).toBeVisible();
    await expect(page.getByText('Lifecycle')).toBeVisible();
    // Credentials must never be rendered
    await expect(page.getByText(/credentialHash/i)).toHaveCount(0);
  });

  test('3. Suspend transitions an active installation and 4. unsuspend reverses it', async ({ page, context }) => {
    const hostname = `pw-suspend-${Date.now()}`;
    await registerIsolatedInstallation(context.request, hostname);

    await page.goto('/installations');
    await page.locator('tr', { hasText: hostname }).click();

    await page.getByRole('button', { name: 'Suspend' }).click();
    await expect(page.getByText('Suspend Installation?')).toBeVisible();
    await page.getByRole('button', { name: 'Suspend', exact: true }).last().click();

    // Dialog closes and the list reflects the new status
    await expect(page.getByText('Suspend Installation?')).toHaveCount(0);
    await expect(page.locator('tr', { hasText: hostname }).getByText('Suspended')).toBeVisible();

    // Unsuspend
    await page.locator('tr', { hasText: hostname }).click();
    await page.getByRole('button', { name: 'Unsuspend' }).click();
    await expect(page.getByText('Unsuspend Installation?')).toBeVisible();
    await page.getByRole('button', { name: 'Unsuspend', exact: true }).last().click();
    await expect(page.locator('tr', { hasText: hostname }).getByText('Active')).toBeVisible();
  });

  test('5. Revoke permanently ends an installation and 6. blocks further actions', async ({ page, context }) => {
    const hostname = `pw-revoke-${Date.now()}`;
    await registerIsolatedInstallation(context.request, hostname);

    await page.goto('/installations');
    await page.locator('tr', { hasText: hostname }).click();

    await page.getByRole('button', { name: 'Revoke' }).click();
    await expect(page.getByText('Revoke Installation?')).toBeVisible();
    await page.getByRole('button', { name: 'Revoke Installation' }).click();

    await expect(page.getByText('Revoke Installation?')).toHaveCount(0);
    await expect(page.locator('tr', { hasText: hostname }).getByText('Revoked')).toBeVisible();

    // A revoked installation must offer no further lifecycle actions
    await page.locator('tr', { hasText: hostname }).click();
    await expect(page.getByRole('button', { name: 'Suspend' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Unsuspend' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Revoke' })).toHaveCount(0);
  });

  test('7. A plain User role (no installation.read) is denied by the backend, not just hidden in the UI', async ({ page, context }) => {
    // Per docs/rbac.md the User role only holds license.read — installations
    // are not visible to it at all. This must be enforced server-side; the
    // page should surface that denial rather than silently show an empty list.
    await authenticateAs(context, 'employee-acme');
    await page.goto('/installations');
    await expect(page.getByText('Something went wrong')).toBeVisible();
    await expect(page.locator('table')).toHaveCount(0);
  });
});
