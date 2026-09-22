import { test, expect } from '@playwright/test';

test.describe('Customer Portal Security Boundaries', () => {
  test('unauthenticated user is blocked', async ({ page }) => {
    await page.goto('/overview');
    // Middleware redirects unauthenticated users to /login
    await expect(page).toHaveURL(/\/login/);
  });

  test('customer cannot access vendor API', async ({ request }) => {
    // Attempt to login as customer
    await request.post('http://127.0.0.1:3001/api/v1/customer/auth/e2e/session', {
      data: { testIdentity: 'company-admin-acme-india' }
    });

    // Try to hit admin portal API route which doesn't exist here or requires TrustfabricAdmin
    const res = await request.get('http://127.0.0.1:3001/api/v1/admin/companies');
    expect(res.status()).toBe(404); // or 401/403
  });

  test('company A cannot access company B resource', async ({ context }) => {
    const sessionRes = await context.request.post('http://127.0.0.1:3001/api/v1/customer/auth/e2e/session', {
      data: { testIdentity: 'company-admin-globex' } // Globex user
    });
    const setCookieHeader = sessionRes.headers()['set-cookie'];
    if (setCookieHeader) {
      const match = setCookieHeader.match(/E2E_SESSION=([^;]+)/);
      if (match) {
        await context.addCookies([{ name: 'E2E_SESSION', value: match[1], domain: 'localhost', path: '/' }]);
      }
    }

    // Try to get Acme company details directly via API
    const res = await context.request.get('http://127.0.0.1:3001/api/v1/customer/companies/comp-acme-in');
    expect(res.status()).toBe(404);
  });

  test('employee cannot perform admin operations', async ({ context }) => {
    const sessionRes = await context.request.post('http://127.0.0.1:3001/api/v1/customer/auth/e2e/session', {
      data: { testIdentity: 'employee-acme' } // Normal employee
    });
    const setCookieHeader = sessionRes.headers()['set-cookie'];
    if (setCookieHeader) {
      const match = setCookieHeader.match(/E2E_SESSION=([^;]+)/);
      if (match) {
        await context.addCookies([{ name: 'E2E_SESSION', value: match[1], domain: 'localhost', path: '/' }]);
      }
    }
    
    // Try to approve a license request
    const res = await context.request.put('http://127.0.0.1:3001/api/v1/customer/license-requests/req-1/approve');
    expect(res.status()).toBe(404);
  });
});
