import { test, expect, Page } from '@playwright/test';

/**
 * Vendor commercial control plane UI: Product -> Edition -> Feature catalog
 * management, Customer creation/status, and Entitlement issuance/lifecycle.
 * Exercises the real backend (see e2e/global-setup.ts) via the actual UI —
 * no mocked API responses.
 */

const RUN_ID = Date.now();
const PRODUCT_NAME = `E2E Product ${RUN_ID}`;

async function createProduct(page: Page, name: string) {
  await page.goto('/products');
  await page.getByRole('button', { name: 'Create Product' }).click();
  await page.getByLabel('Product name').fill(name);
  await page.getByRole('button', { name: 'Create Product' }).last().click();
  await expect(page.getByRole('dialog')).toBeVisible();
}

async function createCustomer(page: Page, name: string) {
  const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-');
  await page.goto('/customers');
  await page.getByRole('button', { name: 'Create Customer' }).click();
  await page.getByLabel('Customer name').fill(name);
  await page.getByLabel('Admin name').fill('E2E Admin');
  await page.getByLabel('Admin email').fill(`${slug}@example.com`);
  await page.getByRole('button', { name: 'Create Customer' }).last().click();
  // Success view shows the one-time password — close it before moving on.
  await expect(page.getByText('Customer Created')).toBeVisible();
  await page.getByRole('button', { name: 'Done' }).click();
}

test.describe('Vendor Commercial Control Plane', () => {
  test.describe('Products', () => {
    test('1. Products page shows a real table with a Create Product action', async ({ page }) => {
      await page.goto('/products');
      await expect(page.locator('h1')).toContainText('Products');
      await expect(page.getByRole('button', { name: 'Create Product' })).toBeVisible();
    });

    test('2. Create Product rejects an empty name', async ({ page }) => {
      await page.goto('/products');
      await page.getByRole('button', { name: 'Create Product' }).click();
      await page.getByRole('button', { name: 'Create Product' }).last().click();
      await expect(page.getByText('Product name is required.')).toBeVisible();
    });

    test('3. Create Product, then it appears in the list', async ({ page }) => {
      await createProduct(page, PRODUCT_NAME);
      await page.goto('/products');
      await expect(page.getByText(PRODUCT_NAME)).toBeVisible();
    });

    test('4. Product detail shows editions and features after adding them', async ({ page }) => {
      const productName = `E2E Detail Product ${RUN_ID}`;
      await createProduct(page, productName);
      await page.goto('/products');
      await page.locator('tr', { hasText: productName }).click();

      const dialog = page.getByRole('dialog');
      await expect(dialog).toContainText(productName);

      await dialog.getByRole('button', { name: 'Add Edition' }).click();
      await page.getByLabel('Edition name').fill('Enterprise Edition');
      await page.getByRole('button', { name: 'Add Edition' }).last().click();
      await expect(dialog.getByText('Enterprise Edition')).toBeVisible();

      await dialog.getByRole('button', { name: 'Add Feature' }).click();
      await page.getByLabel('Feature name').fill('Advanced Reporting');
      await page.getByRole('button', { name: 'Add Feature' }).last().click();
      await expect(dialog.getByText('Advanced Reporting')).toBeVisible();
      await expect(dialog.getByText('advanced_reporting')).toBeVisible();
    });

    test('5. Products page has no fake metrics — no revenue/growth text anywhere', async ({ page }) => {
      await page.goto('/products');
      await expect(page.getByText(/revenue/i)).toHaveCount(0);
      await expect(page.getByText(/% growth/i)).toHaveCount(0);
    });
  });

  test.describe('Customers', () => {
    test('6. Customers page shows a real table with a Create Customer action', async ({ page }) => {
      await page.goto('/customers');
      await expect(page.locator('h1')).toContainText('Customers');
      await expect(page.getByRole('button', { name: 'Create Customer' })).toBeVisible();
    });

    test('7. Create Customer, then it appears in the list with a real default company and zero entitlements', async ({ page }) => {
      const name = `E2E List Customer ${RUN_ID}`;
      await createCustomer(page, name);
      await page.goto('/customers');
      const row = page.locator('tr', { hasText: name });
      await expect(row).toBeVisible();
      // Real counts, not fabricated: 1 default company created alongside the
      // customer's first login, 0 entitlements (none issued yet).
      const cells = row.locator('td');
      await expect(cells.nth(1)).toHaveText('1');
      await expect(cells.nth(2)).toHaveText('0');
    });

    test('7b. The one-time credential shown really logs the customer admin in', async ({ page }) => {
      const name = `E2E Login Customer ${RUN_ID}`;
      const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-');
      const email = `${slug}@example.com`;

      await page.goto('/customers');
      await page.getByRole('button', { name: 'Create Customer' }).click();
      await page.getByLabel('Customer name').fill(name);
      await page.getByLabel('Admin name').fill('E2E Admin');
      await page.getByLabel('Admin email').fill(email);
      await page.getByRole('button', { name: 'Create Customer' }).last().click();

      await expect(page.getByText('Customer Created')).toBeVisible();
      const password = await page.locator('input[readonly]').last().inputValue();
      expect(password.length).toBeGreaterThan(10);
      await page.getByRole('button', { name: 'Done' }).click();

      const loginRes = await page.request.post('http://localhost:3001/api/v1/customer/auth/login', {
        data: { email, password },
      });
      expect(loginRes.ok()).toBe(true);
    });

    test('8. Customer details dialog can disable and re-enable the customer', async ({ page }) => {
      const name = `E2E Status Customer ${RUN_ID}`;
      await createCustomer(page, name);
      await page.goto('/customers');
      await page.locator('tr', { hasText: name }).click();

      const dialog = page.getByRole('dialog');
      await dialog.getByRole('button', { name: 'Disable Customer' }).click();
      await expect(dialog.getByText('INACTIVE')).toBeVisible();
      await dialog.getByRole('button', { name: 'Enable Customer' }).click();
      await expect(dialog.getByText('ACTIVE')).toBeVisible();
    });

    test('9. No customer/company context switcher exists here either', async ({ page }) => {
      await page.goto('/customers');
      await expect(page.getByText('Impersonate')).toHaveCount(0);
      await expect(page.getByText('Switch customer')).toHaveCount(0);
    });
  });

  test.describe('Entitlement issuance and lifecycle', () => {
    // `fullyParallel: true` (playwright.config.ts) means tests in this block
    // can run concurrently across workers — each test below is self-contained
    // (creates its own customer/product/entitlement) rather than depending on
    // another test's side effect, which would be flaky under parallel execution.

    async function createEntitlementAndOpenDetails(page: Page, customerName: string, productName: string, quantity: string) {
      await createProduct(page, productName);
      await createCustomer(page, customerName);

      await page.goto('/entitlements');
      await page.getByRole('button', { name: 'Create Entitlement' }).click();
      await page.getByLabel('Customer').click();
      await page.getByRole('option', { name: customerName }).first().click();
      await page.getByLabel('Product').click();
      await page.getByRole('option', { name: productName }).first().click();
      await page.getByLabel('Quantity (seats)').fill(quantity);
      await page.getByRole('button', { name: 'Create Entitlement' }).last().click();

      const dialog = page.getByRole('dialog');
      await expect(dialog.getByText(/^ENT-/)).toBeVisible();
      return dialog;
    }

    test('10. Create Entitlement dialog lists real customers and products', async ({ page }) => {
      const productName = `E2E Dialog Product ${RUN_ID}`;
      const customerName = `E2E Dialog Customer ${RUN_ID}`;
      await createProduct(page, productName);
      await createCustomer(page, customerName);

      await page.goto('/entitlements');
      await page.getByRole('button', { name: 'Create Entitlement' }).click();

      await page.getByLabel('Customer').click();
      await expect(page.getByRole('option', { name: customerName }).first()).toBeVisible();
      await page.getByRole('option', { name: customerName }).first().click();

      await page.getByLabel('Product').click();
      await expect(page.getByRole('option', { name: productName }).first()).toBeVisible();
    });

    test('11. Issuing an entitlement creates a real record with a human-readable reference', async ({ page }) => {
      const productName = `E2E Issue Product ${RUN_ID}`;
      const customerName = `E2E Issue Customer ${RUN_ID}`;
      await createEntitlementAndOpenDetails(page, customerName, productName, '250');
    });

    test('12. New entitlement appears in the table with the customer and product names', async ({ page }) => {
      const productName = `E2E Table Product ${RUN_ID}`;
      const customerName = `E2E Table Customer ${RUN_ID}`;
      await createEntitlementAndOpenDetails(page, customerName, productName, '250');

      await page.goto('/entitlements');
      const row = page.locator('tr', { hasText: customerName }).filter({ hasText: productName });
      await expect(row.first()).toBeVisible();
    });

    test('13. Lifecycle actions require confirmation before applying', async ({ page }) => {
      const productName = `E2E Lifecycle Product ${RUN_ID}`;
      const customerName = `E2E Lifecycle Customer ${RUN_ID}`;
      const dialog = await createEntitlementAndOpenDetails(page, customerName, productName, '250');

      await dialog.getByRole('button', { name: 'Suspend' }).click();

      // Confirmation copy shown, status not yet changed
      await expect(dialog.getByText(/Suspend this entitlement/)).toBeVisible();
      await expect(dialog.getByText('SUSPENDED')).toHaveCount(0);

      await dialog.getByRole('button', { name: 'Confirm Suspend' }).click();
      await expect(dialog.getByText('SUSPENDED')).toBeVisible();

      // Reactivate to leave a clean, non-terminal state
      await dialog.getByRole('button', { name: 'Reactivate' }).click();
      await dialog.getByRole('button', { name: 'Confirm Reactivate' }).click();
      await expect(dialog.getByText('ACTIVE').first()).toBeVisible();
    });

    test('14. Extend requires a later date than the current one', async ({ page }) => {
      const productName = `E2E Extend Product ${RUN_ID}`;
      const customerName = `E2E Extend Customer ${RUN_ID}`;
      const dialog = await createEntitlementAndOpenDetails(page, customerName, productName, '250');

      await dialog.getByRole('button', { name: 'Extend' }).click();
      await dialog.locator('input[type="date"]').fill('2020-01-01');
      await dialog.getByRole('button', { name: 'Save' }).click();
      await expect(dialog.getByText(/must be after/i)).toBeVisible();
    });

    test('15. Revoke is terminal and disables further lifecycle actions', async ({ page }) => {
      const productName = `E2E Revoke Product ${RUN_ID}`;
      const customerName = `E2E Revoke Customer ${RUN_ID}`;
      const dialog = await createEntitlementAndOpenDetails(page, customerName, productName, '50');

      await dialog.getByRole('button', { name: 'Revoke' }).click();
      await dialog.getByRole('button', { name: 'Confirm Revoke' }).click();
      await expect(dialog.getByText('REVOKED', { exact: true })).toBeVisible();
      await expect(dialog.getByText(/no further lifecycle actions/i)).toBeVisible();
    });
  });
});
