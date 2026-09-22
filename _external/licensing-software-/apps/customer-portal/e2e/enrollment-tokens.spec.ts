import { test, expect, type Page } from '@playwright/test';

async function selectFirstAllocation(page: Page) {
  const trigger = page.getByRole('combobox', { name: 'Allocation' });
  await trigger.click();
  await page.getByRole('listbox').waitFor();
  await page.getByRole('option').first().click();
  await expect(trigger).not.toContainText('Select an allocation');
}

test.describe('Customer Portal Enrollment Tokens', () => {

  test.beforeEach(async ({ context }) => {
    // Authenticate as Acme India Company Admin — holds installation.enroll
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
  });

  test('1. Enrollment tokens tab lists tokens without error', async ({ page }) => {
    await page.goto('/licenses');
    await page.getByRole('tab', { name: 'Enrollment Tokens' }).click();

    // Either a table or the empty state renders — never an error boundary
    await expect(page.getByText('Something went wrong')).toHaveCount(0);
    await expect(
      page.locator('table').or(page.getByText('No Enrollment Tokens'))
    ).toBeVisible();
  });

  test('2. Authorized user can generate a token, and 4. plaintext is shown exactly once', async ({ page }) => {
    const label = `pw-test-${Date.now()}`;

    await page.goto('/licenses');
    await page.getByRole('tab', { name: 'Enrollment Tokens' }).click();
    await page.getByRole('button', { name: 'Generate Token' }).first().click();

    await expect(page.getByText('Generate Enrollment Token')).toBeVisible();

    // Allocation is scoped to a single company (Acme India) for this identity,
    // so the Company select is pre-filled — just choose the allocation.
    await selectFirstAllocation(page);

    await page.getByLabel('Label (optional)').fill(label);
    await page.locator('button[type="submit"]').click();

    // Success state: plaintext token shown exactly once
    await expect(page.getByText('Enrollment Token Created')).toBeVisible();
    const tokenField = page.locator('input[readonly]');
    await expect(tokenField).toBeVisible();
    const tokenValue = await tokenField.inputValue();
    expect(tokenValue.length).toBeGreaterThan(10);

    await page.getByRole('button', { name: 'Done' }).click();

    // 3. Token status is displayed correctly — the new row shows Active
    const row = page.locator('tr', { hasText: label });
    await expect(row).toBeVisible();
    await expect(row.getByText('Active')).toBeVisible();

    // Security: the plaintext token itself must never reappear in the list view
    await expect(page.getByText(tokenValue)).toHaveCount(0);
  });

  test('5. Enrollment token can be revoked', async ({ page }) => {
    const label = `pw-revoke-${Date.now()}`;

    await page.goto('/licenses');
    await page.getByRole('tab', { name: 'Enrollment Tokens' }).click();
    await page.getByRole('button', { name: 'Generate Token' }).first().click();
    await selectFirstAllocation(page);
    await page.getByLabel('Label (optional)').fill(label);
    await page.locator('button[type="submit"]').click();
    await expect(page.getByText('Enrollment Token Created')).toBeVisible();
    await page.getByRole('button', { name: 'Done' }).click();

    const row = page.locator('tr', { hasText: label });
    await expect(row.getByText('Active')).toBeVisible();

    await row.getByRole('button', { name: 'Revoke' }).click();
    await expect(page.getByText('Revoke Enrollment Token?')).toBeVisible();
    await page.getByRole('button', { name: 'Revoke Token' }).click();

    await expect(row.getByText('Revoked')).toBeVisible();
    // A revoked token's Revoke action must no longer be available
    await expect(row.getByRole('button', { name: 'Revoke' })).toBeDisabled();
  });

  test('6. A user without installation.enroll cannot see token management controls', async ({ page, context }) => {
    // Re-authenticate as a plain employee (User role — license.read only)
    const res = await context.request.post('http://127.0.0.1:3001/api/v1/customer/auth/e2e/session', {
      data: { testIdentity: 'employee-acme' }
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

    await page.goto('/licenses');
    await page.getByRole('tab', { name: 'Enrollment Tokens' }).click();
    await expect(page.getByRole('button', { name: 'Generate Token' })).toHaveCount(0);
  });
});
