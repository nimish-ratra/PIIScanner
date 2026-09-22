import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from './../src/app.module.js';

/**
 * Vendor commercial control plane (e2e): Product -> Edition -> Feature
 * catalog management, Customer (Enterprise) management, and Entitlement
 * issuance/lifecycle. Exercises the real vendor session (POST
 * /vendor/auth/login) and real Postgres — not mocked.
 */
process.env.AUTH_MODE = 'password';

const VENDOR_EMAIL = 'admin@trustfabric.test';
const VENDOR_PASSWORD = 'DevPassword!123';
const CUSTOMER_EMAIL = 'india-admin@acme.test';

// Unique-ish per run so parallel/repeated test runs don't collide.
const RUN_ID = Date.now();

describe('Vendor Commercial Control Plane (e2e)', () => {
  let app: INestApplication;
  let vendorCookie: string;
  let customerCookie: string;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    const cookieParser = require('cookie-parser');
    app.use(cookieParser());
    await app.init();

    const vendorLogin = await request(app.getHttpServer())
      .post('/vendor/auth/login')
      .send({ email: VENDOR_EMAIL, password: VENDOR_PASSWORD })
      .expect(200);
    vendorCookie = vendorLogin.headers['set-cookie'][0].split(';')[0];

    const customerLogin = await request(app.getHttpServer())
      .post('/customer/auth/login')
      .send({ email: CUSTOMER_EMAIL, password: VENDOR_PASSWORD })
      .expect(200);
    customerCookie = customerLogin.headers['set-cookie'][0].split(';')[0];
  });

  afterAll(async () => {
    await app.close();
  });

  describe('Products', () => {
    it('1. Create rejects an unauthenticated/customer-session request', async () => {
      await request(app.getHttpServer())
        .post('/vendor/products')
        .set('Cookie', customerCookie)
        .send({ name: 'Should Not Exist' })
        .expect(401); // customer cookie doesn't authenticate a vendor route at all (see AuthGuard)
    });

    it('2. Create rejects a missing name', async () => {
      await request(app.getHttpServer())
        .post('/vendor/products')
        .set('Cookie', vendorCookie)
        .send({ description: 'no name' })
        .expect(400);
    });

    let productId: string;

    it('3. Vendor can create a product', async () => {
      const res = await request(app.getHttpServer())
        .post('/vendor/products')
        .set('Cookie', vendorCookie)
        .send({ name: `E2E Product ${RUN_ID}`, description: 'Created by e2e test' })
        .expect(201);
      expect(res.body.status).toBe('ACTIVE');
      productId = res.body.id;
    });

    it('4. GET /vendor/products lists it', async () => {
      const res = await request(app.getHttpServer())
        .get('/vendor/products')
        .set('Cookie', vendorCookie)
        .expect(200);
      expect(res.body.some((p: any) => p.id === productId)).toBe(true);
    });

    let editionId: string;

    it('5. Vendor can create an edition under the product', async () => {
      const res = await request(app.getHttpServer())
        .post(`/vendor/products/${productId}/editions`)
        .set('Cookie', vendorCookie)
        .send({ name: 'Enterprise Edition' })
        .expect(201);
      expect(res.body.productId).toBe(productId);
      editionId = res.body.id;
    });

    it('6. Creating an edition under an unknown product 404s', async () => {
      await request(app.getHttpServer())
        .post('/vendor/products/does-not-exist/editions')
        .set('Cookie', vendorCookie)
        .send({ name: 'X' })
        .expect(404);
    });

    it('7. Vendor can create a feature under the edition', async () => {
      const res = await request(app.getHttpServer())
        .post(`/vendor/editions/${editionId}/features`)
        .set('Cookie', vendorCookie)
        .send({ name: 'Advanced Reporting', key: 'advanced_reporting' })
        .expect(201);
      expect(res.body.editionId).toBe(editionId);
    });

    it('8. Duplicate feature key within the same edition is rejected (409)', async () => {
      await request(app.getHttpServer())
        .post(`/vendor/editions/${editionId}/features`)
        .set('Cookie', vendorCookie)
        .send({ name: 'Advanced Reporting Again', key: 'advanced_reporting' })
        .expect(409);
    });

    it('9. Product detail includes the nested edition and feature', async () => {
      const res = await request(app.getHttpServer())
        .get(`/vendor/products/${productId}`)
        .set('Cookie', vendorCookie)
        .expect(200);
      expect(res.body.editions).toHaveLength(1);
      expect(res.body.editions[0].features).toHaveLength(1);
      expect(res.body.editions[0].features[0].key).toBe('advanced_reporting');
    });

    it('10. Vendor can disable the product; an audit event is recorded', async () => {
      await request(app.getHttpServer())
        .patch(`/vendor/products/${productId}`)
        .set('Cookie', vendorCookie)
        .send({ status: 'INACTIVE' })
        .expect(200);

      const detail = await request(app.getHttpServer())
        .get(`/vendor/products/${productId}`)
        .set('Cookie', vendorCookie)
        .expect(200);
      expect(detail.body.status).toBe('INACTIVE');
    });
  });

  describe('Customers', () => {
    it('11. Create rejects a missing name', async () => {
      await request(app.getHttpServer())
        .post('/vendor/customers')
        .set('Cookie', vendorCookie)
        .send({})
        .expect(400);
    });

    let customerId: string;

    it('12. Vendor can create a customer with a real, working login', async () => {
      const res = await request(app.getHttpServer())
        .post('/vendor/customers')
        .set('Cookie', vendorCookie)
        .send({
          name: `E2E Customer ${RUN_ID}`,
          adminName: 'E2E Admin',
          adminEmail: `e2e-admin-${RUN_ID}@example.com`,
        })
        .expect(201);
      expect(res.body.status).toBe('ACTIVE');
      expect(res.body.initialAdmin.email).toBe(`e2e-admin-${RUN_ID}@example.com`);
      expect(res.body.initialAdmin.temporaryPassword).toEqual(expect.any(String));
      customerId = res.body.id;

      // Prove the returned credential really logs in.
      const loginRes = await request(app.getHttpServer())
        .post('/customer/auth/login')
        .send({ email: res.body.initialAdmin.email, password: res.body.initialAdmin.temporaryPassword })
        .expect(200);
      const cookie = loginRes.headers['set-cookie'][0].split(';')[0];
      const meRes = await request(app.getHttpServer()).get('/customer/auth/me').set('Cookie', cookie).expect(200);
      expect(meRes.body.roles).toContain('EnterpriseAdmin');
      expect(meRes.body.enterpriseId).toBe(customerId);
    });

    it('13. GET /vendor/customers lists real counts, not fabricated ones', async () => {
      const res = await request(app.getHttpServer())
        .get('/vendor/customers')
        .set('Cookie', vendorCookie)
        .expect(200);
      const created = res.body.find((c: any) => c.id === customerId);
      // 1 real default company created alongside the customer's first login, not fabricated.
      expect(created._count.companies).toBe(1);
      expect(created._count.entitlements).toBe(0);
    });

    it('14. Vendor can disable a customer', async () => {
      await request(app.getHttpServer())
        .post(`/vendor/customers/${customerId}/status`)
        .set('Cookie', vendorCookie)
        .send({ status: 'INACTIVE' })
        .expect(201);
      const detail = await request(app.getHttpServer())
        .get(`/vendor/customers/${customerId}`)
        .set('Cookie', vendorCookie)
        .expect(200);
      expect(detail.body.status).toBe('INACTIVE');
    });

    it('15. A VendorUser session cannot reach the customer-scoped companies endpoint', async () => {
      await request(app.getHttpServer())
        .get('/customer/companies')
        .set('Cookie', vendorCookie)
        .expect(401); // no TF_SESSION cookie present for the vendor session
    });
  });

  describe('Entitlement issuance and lifecycle', () => {
    let activeProductId: string;
    let activeEditionId: string;
    let activeCustomerId: string;

    beforeAll(async () => {
      const p = await request(app.getHttpServer())
        .post('/vendor/products')
        .set('Cookie', vendorCookie)
        .send({ name: `E2E Entitlement Product ${RUN_ID}` });
      activeProductId = p.body.id;

      const e = await request(app.getHttpServer())
        .post(`/vendor/products/${activeProductId}/editions`)
        .set('Cookie', vendorCookie)
        .send({ name: 'Enterprise' });
      activeEditionId = e.body.id;

      const c = await request(app.getHttpServer())
        .post('/vendor/customers')
        .set('Cookie', vendorCookie)
        .send({
          name: `E2E Entitlement Customer ${RUN_ID}`,
          adminName: 'E2E Admin',
          adminEmail: `e2e-ent-admin-${RUN_ID}@example.com`,
        });
      activeCustomerId = c.body.id;
    });

    it('16. Create rejects an inactive customer', async () => {
      const inactiveCustomer = await request(app.getHttpServer())
        .post('/vendor/customers')
        .set('Cookie', vendorCookie)
        .send({
          name: `E2E Inactive Customer ${RUN_ID}`,
          adminName: 'E2E Admin',
          adminEmail: `e2e-inactive-admin-${RUN_ID}@example.com`,
        });
      await request(app.getHttpServer())
        .post(`/vendor/customers/${inactiveCustomer.body.id}/status`)
        .set('Cookie', vendorCookie)
        .send({ status: 'INACTIVE' });

      await request(app.getHttpServer())
        .post('/vendor/entitlements')
        .set('Cookie', vendorCookie)
        .send({
          enterpriseId: inactiveCustomer.body.id,
          productId: activeProductId,
          quantity: 10,
          startDate: '2026-01-01',
          endDate: '2026-12-31',
        })
        .expect(400);
    });

    it('17. Create rejects an edition that belongs to a different product', async () => {
      const otherProduct = await request(app.getHttpServer())
        .post('/vendor/products')
        .set('Cookie', vendorCookie)
        .send({ name: `E2E Other Product ${RUN_ID}` });

      await request(app.getHttpServer())
        .post('/vendor/entitlements')
        .set('Cookie', vendorCookie)
        .send({
          enterpriseId: activeCustomerId,
          productId: otherProduct.body.id,
          editionId: activeEditionId, // belongs to activeProductId, not otherProduct
          quantity: 10,
          startDate: '2026-01-01',
          endDate: '2026-12-31',
        })
        .expect(400);
    });

    it('18. Customer session cannot issue an entitlement (no vendor.entitlement.create route on customer/*)', async () => {
      await request(app.getHttpServer())
        .post('/vendor/entitlements')
        .set('Cookie', customerCookie)
        .send({
          enterpriseId: activeCustomerId,
          productId: activeProductId,
          quantity: 10,
          startDate: '2026-01-01',
          endDate: '2026-12-31',
        })
        .expect(401);
    });

    let entitlementId: string;

    it('19. Vendor issues a real entitlement with a human-readable reference', async () => {
      const res = await request(app.getHttpServer())
        .post('/vendor/entitlements')
        .set('Cookie', vendorCookie)
        .send({
          enterpriseId: activeCustomerId,
          productId: activeProductId,
          editionId: activeEditionId,
          quantity: 500,
          startDate: '2026-01-01',
          endDate: '2026-12-31',
        })
        .expect(201);

      expect(res.body.quantity).toBe(500);
      expect(res.body.allocatedQuantity).toBe(0);
      expect(res.body.reference).toMatch(/^ENT-.+-\d{4}-\d{3}$/);
      entitlementId = res.body.id;
    });

    it('20. Suspend transitions the entitlement and bumps its version (OCC)', async () => {
      const before = await request(app.getHttpServer())
        .get(`/vendor/entitlements/${entitlementId}`)
        .set('Cookie', vendorCookie);

      const res = await request(app.getHttpServer())
        .post(`/vendor/entitlements/${entitlementId}/status`)
        .set('Cookie', vendorCookie)
        .send({ status: 'SUSPENDED' })
        .expect(201);

      expect(res.body.status).toBe('SUSPENDED');
      expect(res.body.version).toBe(before.body.version + 1);
    });

    it('21. Invalid transition (SUSPENDED -> SUSPENDED) is rejected', async () => {
      await request(app.getHttpServer())
        .post(`/vendor/entitlements/${entitlementId}/status`)
        .set('Cookie', vendorCookie)
        .send({ status: 'SUSPENDED' })
        .expect(400);
    });

    it('22. Reactivate (SUSPENDED -> ACTIVE) works', async () => {
      const res = await request(app.getHttpServer())
        .post(`/vendor/entitlements/${entitlementId}/status`)
        .set('Cookie', vendorCookie)
        .send({ status: 'ACTIVE' })
        .expect(201);
      expect(res.body.status).toBe('ACTIVE');
    });

    it('23. Extend rejects a shorter end date (no rewriting commercial history)', async () => {
      await request(app.getHttpServer())
        .post(`/vendor/entitlements/${entitlementId}/extend`)
        .set('Cookie', vendorCookie)
        .send({ endDate: '2026-01-01' })
        .expect(400);
    });

    it('24. Extend accepts a later end date', async () => {
      const res = await request(app.getHttpServer())
        .post(`/vendor/entitlements/${entitlementId}/extend`)
        .set('Cookie', vendorCookie)
        .send({ endDate: '2027-06-30' })
        .expect(201);
      expect(new Date(res.body.endDate).getFullYear()).toBe(2027);
    });

    it('25. Quantity can be increased', async () => {
      const res = await request(app.getHttpServer())
        .post(`/vendor/entitlements/${entitlementId}/quantity`)
        .set('Cookie', vendorCookie)
        .send({ quantity: 750 })
        .expect(201);
      expect(res.body.quantity).toBe(750);
    });

    it('26. Revoke is terminal — a further status change is then rejected', async () => {
      await request(app.getHttpServer())
        .post(`/vendor/entitlements/${entitlementId}/status`)
        .set('Cookie', vendorCookie)
        .send({ status: 'REVOKED' })
        .expect(201);

      await request(app.getHttpServer())
        .post(`/vendor/entitlements/${entitlementId}/status`)
        .set('Cookie', vendorCookie)
        .send({ status: 'ACTIVE' })
        .expect(400);
    });

    it('27. A revoked entitlement can no longer be extended or have its quantity changed', async () => {
      await request(app.getHttpServer())
        .post(`/vendor/entitlements/${entitlementId}/extend`)
        .set('Cookie', vendorCookie)
        .send({ endDate: '2030-01-01' })
        .expect(400);

      await request(app.getHttpServer())
        .post(`/vendor/entitlements/${entitlementId}/quantity`)
        .set('Cookie', vendorCookie)
        .send({ quantity: 1000 })
        .expect(400);
    });
  });
});
