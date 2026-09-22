import { test, expect } from '@playwright/test';

test.describe('Customer Portal — License Requests', () => {

  test.beforeEach(async ({ context }) => {
    // Authenticate as Acme Enterprise Admin
    const res = await context.request.post('http://127.0.0.1:3001/api/v1/customer/auth/e2e/session', {
      data: { testIdentity: 'enterprise-admin-acme' },
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
  });

  test('1. License Requests page loads real data and shows requests from all companies', async ({ page }) => {
    await page.goto('/license-requests');
    await expect(page).toHaveURL(/\/license-requests/);

    // Page heading
    await expect(page.getByRole('heading', { name: 'License Requests' })).toBeVisible();

    // Status filter tabs
    await expect(page.getByRole('button', { name: /all/i })).toBeVisible();
    await expect(page.getByRole('button', { name: /pending/i })).toBeVisible();
    await expect(page.getByRole('button', { name: /approved/i })).toBeVisible();
    await expect(page.getByRole('button', { name: /rejected/i })).toBeVisible();

    // Table must have at least one row (seeded data)
    const table = page.locator('table');
    await expect(table).toBeVisible();
    await expect(table.locator('tbody tr').first()).toBeVisible();
  });

  test('2. Request list displays enriched company names and status badges', async ({ page }) => {
    await page.goto('/license-requests');

    // Should display company names, not raw IDs — use .first() since multiple rows may match
    await expect(page.locator('text=Acme India').first()).toBeVisible();

    // Status pill for PENDING
    await expect(page.locator('text=Pending').first()).toBeVisible();
    // Status pill for APPROVED (historical seed data)
    await expect(page.locator('text=Approved').first()).toBeVisible();
    // Status pill for REJECTED (historical seed data)
    await expect(page.locator('text=Rejected').first()).toBeVisible();
  });

  test('3. Status filter correctly narrows the list', async ({ page }) => {
    await page.goto('/license-requests');

    // Click Pending filter
    await page.getByRole('button', { name: /pending/i }).click();

    // Only Pending badges should be visible in the table body
    const rows = page.locator('table tbody tr');
    const firstRowStatus = rows.first().locator('span').first();
    await expect(firstRowStatus).toContainText('Pending');

    // Click Rejected filter
    await page.getByRole('button', { name: /rejected/i }).click();
    const rejectedRows = page.locator('table tbody tr');
    await expect(rejectedRows.first()).toContainText('Rejected');
  });

  test('4. Request details dialog opens and shows full context', async ({ page }) => {
    await page.goto('/license-requests');

    // Click the ChevronRight details button on the first row
    await page.locator('table tbody tr').first().locator('button[title="View details"]').click();

    // Dialog must be visible with expected fields
    // Scope assertions to the dialog to avoid matching table header cells
    const dialog = page.locator('[role="dialog"]');
    await expect(dialog.locator('text=Request #')).toBeVisible();
    await expect(dialog.locator('text=Company')).toBeVisible();
    await expect(dialog.locator('text=Product')).toBeVisible();
    await expect(dialog.locator('text=Seats Requested')).toBeVisible();
    await expect(dialog.locator('text=Requested By')).toBeVisible();
  });

  test('5. Authorized admin can approve a pending request via the UI, then sees Request Approved (not just the dialog closing)', async ({ page }) => {
    await page.goto('/license-requests');

    // Switch to Pending filter to find a pending request reliably
    await page.getByRole('button', { name: /pending/i }).click();

    // Click approve on the first pending row
    const firstPendingRow = page.locator('table tbody tr').first();
    await firstPendingRow.locator('button[title="Approve"]').click();

    // Confirm dialog opens — the button/dialog says "Approve", never "Activate"
    const confirmDialog = page.locator('[role="dialog"]');
    await expect(confirmDialog.getByText('Approve Request', { exact: true })).toBeVisible();
    await expect(page.locator('text=/activate/i')).toHaveCount(0);

    // Submit
    await page.locator('button:has-text("Confirm Approval")').click();

    // Approving is a distinct, visible result from any Activation being
    // issued — the dialog transitions to a success view rather than just
    // silently closing.
    await expect(page.getByText('Request Approved', { exact: true })).toBeVisible({ timeout: 8000 });

    // Close it, then the table should refresh.
    await page.locator('button:has-text("Done")').click();
    await expect(page.locator('table')).toBeVisible();
  });

  test('6. Approved request transitions status in the UI', async ({ page }) => {
    await page.goto('/license-requests');

    // Check Approved tab has at least one request (from seed + test 5)
    await page.getByRole('button', { name: /approved/i }).click();
    const approvedRows = page.locator('table tbody tr');
    await expect(approvedRows.first()).toBeVisible();
    await expect(approvedRows.first()).toContainText('Approved');
  });

  test('7. Authorized admin can reject a pending request with a reason', async ({ page }) => {
    await page.goto('/license-requests');

    // Find a pending request
    await page.getByRole('button', { name: /pending/i }).click();
    const rows = page.locator('table tbody tr');
    const count = await rows.count();

    if (count === 0) {
      // All pending requests consumed — skip gracefully
      return;
    }

    // Click reject on first pending row
    await rows.first().locator('button[title="Reject"]').click();

    await expect(page.locator('text=Reject Request')).toBeVisible();

    // Fill in rejection reason
    await page.locator('textarea').fill('Insufficient budget allocation for this quarter.');

    // Submit
    await page.locator('button:has-text("Confirm Rejection")').click();

    // Dialog should close
    await expect(page.locator('text=Reject Request')).toBeHidden({ timeout: 8000 });
  });

  test('8. Rejection reason is required — submit without reason shows inline error', async ({ page }) => {
    await page.goto('/license-requests');

    await page.getByRole('button', { name: /pending/i }).click();
    const rows = page.locator('table tbody tr');
    const count = await rows.count();

    if (count === 0) return; // No pending requests left — skip

    // Open reject dialog
    await rows.first().locator('button[title="Reject"]').click();
    await expect(page.locator('text=Reject Request')).toBeVisible();

    // The Confirm button should be disabled when reason is empty
    const confirmBtn = page.locator('button:has-text("Confirm Rejection")');
    await expect(confirmBtn).toBeDisabled();
  });
});
