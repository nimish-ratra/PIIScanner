import { test, expect } from '@playwright/test';

/**
 * These tests exercise the real backend (see e2e/global-setup.ts, which
 * reseeds the dev database via prisma/seed-e2e.ts the same way the Customer
 * Portal's suite does) rather than mocking `/api/v1/**`. Every spec here
 * starts already authenticated via the `storageState` set in
 * playwright.config.ts — global-setup.ts performs one real
 * POST /api/v1/vendor/auth/login and saves the resulting session cookie, so
 * these tests don't each need their own login boilerplate. The login page
 * itself (render, wrong password, logout, principal isolation) is covered
 * separately in e2e/vendor-auth.spec.ts, which opts out of that storageState.
 */
test.describe('Trustfabric Admin Portal', () => {

  test('should load the dashboard as the real vendor-admin identity', async ({ page }) => {
    await page.goto('/');
    await expect(page).toHaveURL(/.*\/dashboard/);
    await expect(page.locator('h1')).toContainText('Overview');
    await expect(page.locator('header')).toContainText('admin@trustfabric.test');
  });

  test('should navigate to customers page', async ({ page }) => {
    // Customers is now real: derived from GET /vendor/entitlements, since no
    // vendor/companies endpoint exists — see lib/derive.ts.
    // Scoped to the sidebar <nav> — the Overview page's own "Customers" metric
    // card is also a link to /customers and would otherwise match too.
    await page.goto('/dashboard');
    await expect(page.locator('h1')).toContainText('Overview');
    await page.locator('nav').getByRole('link', { name: 'Customers' }).click();
    await expect(page).toHaveURL(/\/customers/);
  });

  test('vendor session is rejected by customer-only endpoints (401 — no matching session cookie)', async ({ page }) => {
    // The vendor session lives in TF_VENDOR_SESSION, a different cookie from
    // the Customer Portal's TF_SESSION (see session.service.ts) — a
    // customer-prefixed request never even finds a session to evaluate, so
    // this fails at authentication (401), one layer earlier than the old
    // E2E-fixture-based 403 authorization check.
    await page.goto('/dashboard');
    await expect(page.locator('h1')).toContainText('Overview');
    const result = await page.evaluate(async () => {
      const res = await fetch('http://localhost:3001/api/v1/customer/licenses', {
        credentials: 'include',
      });
      return { status: res.status };
    });
    expect(result.status).toBe(401);
  });

  test.describe('Global Installations', () => {
    test('loads and shows installations across every customer (global visibility)', async ({ page }) => {
      await page.goto('/installations');
      // Seeded fixtures: one Acme installation, one Globex installation.
      // A vendor must see both — proving this isn't scoped to a single tenant.
      await expect(page.getByText('laptop-in-01')).toBeVisible();
      await expect(page.getByText('server-gl-01')).toBeVisible();
      await expect(page.locator('tr', { hasText: 'Acme India' })).toBeVisible();
      await expect(page.locator('tr', { hasText: 'Globex India' })).toBeVisible();
    });

    test('details view is read-only — no lifecycle actions are exposed', async ({ page }) => {
      await page.goto('/installations');
      await page.locator('tr', { hasText: 'laptop-in-01' }).click();

      await expect(page.getByText('Identity')).toBeVisible();
      await expect(page.getByText('read-only')).toBeVisible();

      // The vendor API has no suspend/unsuspend/revoke routes for installations —
      // the portal must not offer controls that would call nonexistent endpoints.
      await expect(page.getByRole('button', { name: 'Suspend' })).toHaveCount(0);
      await expect(page.getByRole('button', { name: 'Unsuspend' })).toHaveCount(0);
      await expect(page.getByRole('button', { name: 'Revoke' })).toHaveCount(0);
    });

    test('status and company filters narrow the list client-side', async ({ page }) => {
      await page.goto('/installations');
      await expect(page.getByText('laptop-in-01')).toBeVisible();
      await expect(page.getByText('server-gl-01')).toBeVisible();

      // Filter down to a single company. Render order is fixed: Status,
      // Company, Platform — index 1 is Company (both conditional filters
      // render here since the seed data has >1 company and >1 OS).
      await page.getByRole('combobox').nth(1).click();
      await page.locator('[role="option"]', { hasText: 'Acme India' }).click();

      await expect(page.getByText('laptop-in-01')).toBeVisible();
      await expect(page.getByText('server-gl-01')).toHaveCount(0);
    });
  });

  test.describe('Shell', () => {
    test('sidebar navigation covers every real page', async ({ page }) => {
      // Scoped to <nav> — the Overview page's "Customers" stat card is also a
      // link to /customers and would otherwise collide with the sidebar link.
      await page.goto('/dashboard');
      for (const [name, url] of [
        ['Customers', /\/customers/],
        ['Products', /\/products/],
        ['Entitlements', /\/entitlements/],
        ['Installations', /\/installations/],
        ['Audit Logs', /\/audit/],
      ] as const) {
        await page.locator('nav').getByRole('link', { name }).click();
        await expect(page).toHaveURL(url);
        await page.goto('/dashboard');
      }
    });

    test('header profile menu opens and exposes sign out', async ({ page }) => {
      await page.goto('/dashboard');
      await expect(page.locator('#btn-user-menu')).toBeVisible();
      await page.locator('#btn-user-menu').click();
      await expect(page.locator('#btn-logout')).toBeVisible();
    });

    test('no customer/company context switcher exists (vendor is global, not scoped)', async ({ page }) => {
      await page.goto('/dashboard');
      await expect(page.getByText('All Companies')).toHaveCount(0);
      await expect(page.getByText('Impersonate')).toHaveCount(0);
    });
  });

  test.describe('Overview', () => {
    test('loads real global metrics with no fake trends', async ({ page }) => {
      await page.goto('/dashboard');
      await expect(page.getByText('Customers')).toBeVisible();
      await expect(page.getByText('Total Entitled Seats')).toBeVisible();
      await expect(page.getByText('Allocated Seats')).toBeVisible();
      await expect(page.getByText('Available Capacity')).toBeVisible();
      await expect(page.getByText('Active Installations')).toBeVisible();

      // No fabricated trend/growth indicators anywhere on the page
      await expect(page.getByText(/vs last month/i)).toHaveCount(0);
      await expect(page.getByText(/% growth/i)).toHaveCount(0);
    });
  });

  test.describe('Customers', () => {
    test('loads real customers from GET /vendor/customers', async ({ page }) => {
      await page.goto('/customers');
      await expect(page.locator('h1')).toContainText('Customers');
      await expect(page.locator('tr', { hasText: 'Acme Corporation' })).toBeVisible();
      await expect(page.locator('tr', { hasText: 'Globex Corporation' })).toBeVisible();
    });

    test('search filters the customer list', async ({ page }) => {
      await page.goto('/customers');
      await expect(page.getByText('Globex Corporation')).toBeVisible();
      await page.getByPlaceholder('Search customers...').fill('Acme');
      await expect(page.getByText('Acme Corporation')).toBeVisible();
      await expect(page.getByText('Globex Corporation')).toHaveCount(0);
    });

    test('customer details dialog shows real entitlement data', async ({ page }) => {
      await page.goto('/customers');
      await page.locator('tr', { hasText: 'Acme Corporation' }).click();
      const dialog = page.getByRole('dialog');
      await expect(dialog.getByText('Enterprise Security Suite').first()).toBeVisible();
      await expect(dialog.getByText('Entitled')).toBeVisible();
    });
  });

  test.describe('Products', () => {
    test('shows real products from GET /vendor/products, with real create support', async ({ page }) => {
      await page.goto('/products');
      await expect(page.locator('h1')).toContainText('Products');
      await expect(page.getByText('Enterprise Security Suite')).toBeVisible();
      // Product management is a real vendor capability now (see
      // src/products on the backend) — Create Product is a genuine, working
      // action, not a fabricated affordance with no API behind it. Full
      // create/edition/feature coverage lives in vendor-commercial.spec.ts.
      await expect(page.getByRole('button', { name: 'Create Product' })).toBeVisible();
    });
  });

  test.describe('Entitlements', () => {
    test('loads real entitlement data with customer names, not raw UUIDs', async ({ page }) => {
      await page.goto('/entitlements');
      await expect(page.locator('h1')).toContainText('Entitlements');
      const table = page.locator('table');
      await expect(table).toContainText('Acme Corporation');
      await expect(table).toContainText('500');
    });

    test('details dialog shows allocations with company names', async ({ page }) => {
      await page.goto('/entitlements');
      await page.locator('tr', { hasText: 'Acme Corporation' }).first().click();
      await expect(page.getByText(/^Allocations \(/)).toBeVisible();
    });
  });

  test.describe('Audit Logs', () => {
    test('honestly reports no vendor audit API is available (no fake data)', async ({ page }) => {
      await page.goto('/audit');
      await expect(page.locator('h1')).toContainText('Audit Logs');
      await expect(page.getByText(/not available/i)).toBeVisible();
    });
  });
});
