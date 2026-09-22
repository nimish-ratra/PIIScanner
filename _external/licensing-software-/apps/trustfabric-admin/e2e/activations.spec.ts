import { test, expect } from '@playwright/test';

const CUSTOMER_API_BASE = 'http://127.0.0.1:3001/api/v1/customer';

test.describe('Trustfabric Admin — Activations (global vendor view)', () => {
  /**
   * Activations can only ever be created via a Customer Admin approving a
   * targetUserId request — there is no vendor-side creation path (see
   * docs/activation-domain.md). Test setup goes through the real customer
   * e2e-session + license-requests endpoints directly to produce a genuine
   * Activation for the vendor UI to then display and act on.
   */
  async function createAcmeActivation(request: any) {
    const sessionRes = await request.post(`${CUSTOMER_API_BASE}/auth/e2e/session`, {
      data: { testIdentity: 'company-admin-acme-india' },
    });
    const setCookie = sessionRes.headers()['set-cookie'];
    const match = /E2E_SESSION=([^;]+)/.exec(Array.isArray(setCookie) ? setCookie[0] : setCookie);
    const cookieHeader = `E2E_SESSION=${match![1]}`;

    const createRes = await request.post(`${CUSTOMER_API_BASE}/license-requests`, {
      headers: { Cookie: cookieHeader },
      data: {
        companyId: 'comp-acme-in',
        entitlementId: 'entit-acme-1',
        quantity: 1,
        reason: 'Playwright vendor-view fixture',
        targetUserId: 'user-acme-employee',
      },
    });
    const created = await createRes.json();

    const approveRes = await request.post(`${CUSTOMER_API_BASE}/license-requests/${created.id}/approve`, {
      headers: { Cookie: cookieHeader },
    });
    return approveRes.json();
  }

  test('1. A vendor sees an Activation created via customer approval, with no vendor-side create action anywhere', async ({ page, request }) => {
    const approval = await createAcmeActivation(request);

    await page.goto('/activations');
    await expect(page.getByRole('heading', { name: 'Activations' })).toBeVisible();

    // No "Create"/"New Activation"/"Activate" button anywhere on this page —
    // issuance is exclusively an automatic backend consequence of customer approval.
    await expect(page.getByRole('button', { name: /^(create|new|activate)\b/i })).toHaveCount(0);

    const row = page.locator('table tbody tr', { hasText: 'Acme' });
    await expect(row).toBeVisible();
    // The approval response's `activation` is unjoined (plain create() result,
    // no `user` relation) — the vendor list endpoint, unlike that response,
    // fully joins `user`, which is what actually resolves the friendly name
    // shown here. Assert against the known seed fixture name directly rather
    // than re-deriving it from the under-joined approval payload.
    expect(approval.activation.id).toBeTruthy();
    await expect(row).toContainText('Acme Employee');
  });

  test('2. Sort by Company groups activations from different customers together', async ({ page, request }) => {
    await createAcmeActivation(request);
    await page.goto('/activations');

    await page.getByRole('button', { name: 'Sort by Company' }).click();
    const rows = page.locator('table tbody tr');
    const count = await rows.count();
    expect(count).toBeGreaterThan(0);

    // Extract the "Customer" column (3rd cell) from every row and assert it's sorted.
    const companyNames = await rows.evaluateAll((trs) =>
      trs.map((tr) => tr.querySelectorAll('td')[2]?.textContent?.trim() ?? ''),
    );
    const sorted = [...companyNames].sort((a, b) => a.localeCompare(b));
    expect(companyNames).toEqual(sorted);
  });

  test('3. Vendor can suspend and then reactivate an Activation belonging to any customer', async ({ page, request }) => {
    const approval = await createAcmeActivation(request);
    // Bring it to ACTIVE via a real agent registration so a lifecycle action is available.
    await request.post('http://127.0.0.1:3001/api/v1/agent/register', {
      data: { enrollmentToken: approval.enrollmentToken.token, deviceId: `pw-vendor-${approval.activation.id}` },
    });

    await page.goto('/activations');
    await page.locator('table tbody tr', { hasText: 'Active' }).first().click();

    const dialog = page.locator('[role="dialog"]');
    await dialog.getByRole('button', { name: 'Suspend' }).click();
    await page.getByRole('button', { name: 'Suspend', exact: true }).last().click();

    await expect(page.locator('table tbody tr', { hasText: 'Suspended' }).first()).toBeVisible({ timeout: 8000 });

    await page.locator('table tbody tr', { hasText: 'Suspended' }).first().click();
    await page.locator('[role="dialog"]').getByRole('button', { name: 'Reactivate' }).click();
    await page.getByRole('button', { name: 'Reactivate', exact: true }).last().click();
    await expect(page.locator('table tbody tr', { hasText: 'Active' }).first()).toBeVisible({ timeout: 8000 });
  });

  test('4. Vendor detail view never exposes credential/token material', async ({ page, request }) => {
    await createAcmeActivation(request);
    await page.goto('/activations');
    await page.locator('table tbody tr').first().click();

    const bodyText = await page.locator('body').innerText();
    expect(bodyText).not.toMatch(/tokenHash/i);
    expect(bodyText).not.toMatch(/credentialHash/i);
  });
});
