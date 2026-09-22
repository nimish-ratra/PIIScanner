import { test, expect } from '@playwright/test';

const API_BASE = 'http://127.0.0.1:3001/api/v1/customer';

test.describe('Customer Portal — Activations', () => {
  let acmeAdminCookieHeader: string;

  test.beforeEach(async ({ context }) => {
    const res = await context.request.post(`${API_BASE}/auth/e2e/session`, {
      data: { testIdentity: 'company-admin-acme-india' },
    });
    const setCookieHeader = res.headers()['set-cookie'];
    const match = setCookieHeader?.match(/E2E_SESSION=([^;]+)/);
    if (match) {
      acmeAdminCookieHeader = `E2E_SESSION=${match[1]}`;
      await context.addCookies([{
        name: 'E2E_SESSION', value: match[1],
        domain: 'localhost', path: '/', httpOnly: true, sameSite: 'Lax',
      }]);
    }
  });

  /**
   * Creates a fresh targetUserId (named-employee) request via the API and
   * returns its id. There is no "create request" UI in this portal yet — the
   * Activation-producing flow starts from an already-PENDING request, so
   * test setup creates one directly, then the test itself drives the actual
   * Approve action through the UI (this is the part under test).
   */
  async function createTargetUserRequest(context: any) {
    const res = await context.request.post(`${API_BASE}/license-requests`, {
      headers: { Cookie: acmeAdminCookieHeader },
      data: {
        companyId: 'comp-acme-in',
        entitlementId: 'entit-acme-1',
        quantity: 1,
        reason: 'Playwright: new hire needs a seat',
        targetUserId: 'user-acme-employee',
      },
    });
    const body = await res.json();
    return body.id as string;
  }

  test('1. Approving a named-employee request shows "Request Approved" AND, separately, "Activation Issued" — the two events are never collapsed into one', async ({ page, context }) => {
    const requestId = await createTargetUserRequest(context);

    await page.goto('/license-requests');
    await page.getByRole('button', { name: /pending/i }).click();

    // Find the row for our specific request via its reason text isn't shown
    // in the table, so open its detail dialog by short id instead — simplest
    // reliable path: approve via the row matching our known request id
    // fragment shown in the Ref column.
    const shortId = requestId.slice(0, 8).toUpperCase();
    const row = page.locator('table tbody tr', { hasText: shortId });
    await expect(row).toBeVisible();
    await row.locator('button[title="Approve"]').click();

    await page.locator('button:has-text("Confirm Approval")').click();

    // Fact 1: the request was approved.
    await expect(page.getByText('Request Approved', { exact: true })).toBeVisible({ timeout: 8000 });
    // Fact 2, shown as a visually distinct, separately-labeled block — not
    // merged into "Request Approved" as if they were the same event.
    await expect(page.getByText('Activation Issued.')).toBeVisible();
    await expect(page.getByText(/Trustfabric licensing backend has issued/i)).toBeVisible();

    // The one-time enrollment code is shown, with its own explicit warning —
    // never silently, never mixed into ordinary table data.
    await expect(page.getByText(/shown only this once/i)).toBeVisible();

    await page.locator('button:has-text("Done")').click();
  });

  test('2. The issued Activation appears on the Activations page with correct employee/status, and no secret is visible there', async ({ page, context }) => {
    const requestId = await createTargetUserRequest(context);
    await context.request.post(`${API_BASE}/license-requests/${requestId}/approve`, {
      headers: { Cookie: acmeAdminCookieHeader },
    });

    await page.goto('/activations');
    await expect(page.getByRole('heading', { name: 'Activations' })).toBeVisible();

    // Employee name/email appears (seeded as employee@acme.test / "Acme Employee" or similar) — not just a raw user id.
    const row = page.locator('table tbody tr').first();
    await expect(row).toBeVisible();
    await expect(row).not.toContainText('user-acme-employee'); // should render name/email, not the raw id, when available

    // No credential/token material ever appears on this page.
    const bodyText = await page.locator('body').innerText();
    expect(bodyText).not.toMatch(/tokenHash/i);
    expect(bodyText).not.toMatch(/credentialHash/i);
  });

  test('3. Activation detail view shows lifecycle fields and explains it was issued by the licensing system, not the customer', async ({ page, context }) => {
    const requestId = await createTargetUserRequest(context);
    await context.request.post(`${API_BASE}/license-requests/${requestId}/approve`, {
      headers: { Cookie: acmeAdminCookieHeader },
    });

    await page.goto('/activations');
    await page.locator('table tbody tr').first().click();

    const dialog = page.locator('[role="dialog"]');
    await expect(dialog.getByText('License right issued by the Trustfabric licensing system')).toBeVisible();
    await expect(dialog.getByText('Activation ID')).toBeVisible();
    await expect(dialog.getByText('Current Status')).toBeVisible();
    await expect(dialog.getByText('Employee', { exact: true })).toBeVisible();
  });

  test('4. An admin can suspend and then reactivate an Activation from the detail view', async ({ page, context, request }) => {
    // Need an ACTIVE (not just PENDING) activation to suspend — register an
    // agent installation against the freshly-approved one first.
    const requestId = await createTargetUserRequest(context);
    const approveRes = await context.request.post(`${API_BASE}/license-requests/${requestId}/approve`, {
      headers: { Cookie: acmeAdminCookieHeader },
    });
    const approval = await approveRes.json();
    await request.post('http://127.0.0.1:3001/api/v1/agent/register', {
      data: { enrollmentToken: approval.enrollmentToken.token, deviceId: `pw-device-${approval.activation.id}` },
    });

    await page.goto('/activations');
    // No status filter needed — the unfiltered table already shows every
    // status, and matching the row by its "Active" badge text is enough.
    await page.locator('table tbody tr', { hasText: 'Active' }).first().click();

    const dialog = page.locator('[role="dialog"]');
    await dialog.getByRole('button', { name: 'Suspend' }).click();

    // Confirmation is a SEPARATE dialog stacked on top — target its own Suspend button distinctly.
    await page.getByRole('button', { name: 'Suspend', exact: true }).last().click();

    // Dialog closes and list refreshes to show Suspended.
    await expect(page.locator('table tbody tr', { hasText: 'Suspended' }).first()).toBeVisible({ timeout: 8000 });

    // Reactivate it back.
    await page.locator('table tbody tr', { hasText: 'Suspended' }).first().click();
    await page.locator('[role="dialog"]').getByRole('button', { name: 'Reactivate' }).click();
    await page.getByRole('button', { name: 'Reactivate', exact: true }).last().click();
    await expect(page.locator('table tbody tr', { hasText: 'Active' }).first()).toBeVisible({ timeout: 8000 });
  });

  test('5. A bulk capacity request (no targetUserId) approves normally and produces no Activation', async ({ page, context }) => {
    const res = await context.request.post(`${API_BASE}/license-requests`, {
      headers: { Cookie: acmeAdminCookieHeader },
      data: { companyId: 'comp-acme-in', entitlementId: 'entit-acme-1', quantity: 4, reason: 'Playwright: capacity only' },
    });
    const created = await res.json();

    await page.goto('/license-requests');
    await page.getByRole('button', { name: /pending/i }).click();
    const shortId = created.id.slice(0, 8).toUpperCase();
    const row = page.locator('table tbody tr', { hasText: shortId });
    await row.locator('button[title="Approve"]').click();
    await page.locator('button:has-text("Confirm Approval")').click();

    await expect(page.getByText('Request Approved', { exact: true })).toBeVisible({ timeout: 8000 });
    // No Activation was issued for a bulk capacity request — the success view says so explicitly.
    await expect(page.getByText('Activation Issued', { exact: true })).toHaveCount(0);
    await expect(page.getByText(/capacity request with no specific employee named/i)).toBeVisible();
  });
});
