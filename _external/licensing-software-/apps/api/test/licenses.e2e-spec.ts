import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from './../src/app.module.js';
import { PrismaService } from '../src/prisma/prisma.service.js';

describe('Customer Licensing Management (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  
  let acmeAdminCookie: string;
  let globexAdminCookie: string;
  let acmeUserCookie: string;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    const cookieParser = require('cookie-parser');
    app.use(cookieParser());
    await app.init();
    
    prisma = app.get(PrismaService);

    // Get session cookies
    const resAcme = await request(app.getHttpServer())
      .post('/customer/auth/e2e/session')
      .send({ testIdentity: 'enterprise-admin-acme' });
    acmeAdminCookie = resAcme.headers['set-cookie'][0].split(';')[0];
    
    const resGlobex = await request(app.getHttpServer())
      .post('/customer/auth/e2e/session')
      .send({ testIdentity: 'company-admin-globex' });
    globexAdminCookie = resGlobex.headers['set-cookie'][0].split(';')[0];
    
    const resUser = await request(app.getHttpServer())
      .post('/customer/auth/e2e/session')
      .send({ testIdentity: 'employee-acme' });
    acmeUserCookie = resUser.headers['set-cookie'][0].split(';')[0];
  });

  afterAll(async () => {
    await app.close();
  });

  describe('Authorization & Tenant Isolation', () => {
    it('1. Authorized customer can read its entitlements', async () => {
      const res = await request(app.getHttpServer())
        .get('/customer/entitlements')
        .set('Cookie', acmeAdminCookie)
        .expect(200);
        
      expect(Array.isArray(res.body)).toBe(true);
      expect(res.body.length).toBeGreaterThan(0);
      expect(res.body.find((e: any) => e.id === 'entit-acme-1')).toBeDefined();
    });

    it('2. Customer cannot access another enterprise\'s entitlement', async () => {
      // Globex admin trying to fetch Acme's entitlement
      await request(app.getHttpServer())
        .get('/customer/entitlements/entit-acme-1')
        .set('Cookie', globexAdminCookie)
        .expect(404);
    });

    it('5. Unauthorized user cannot allocate', async () => {
      // acmeUserCookie only has 'license.read' permission
      await request(app.getHttpServer())
        .post('/customer/licenses/allocate')
        .set('Cookie', acmeUserCookie)
        .send({ entitlementId: 'entit-acme-1', companyId: 'comp-acme-in', quantity: 10 })
        .expect(403);
    });
    
    it('8. Allocation cannot cross company/enterprise scope', async () => {
      // Globex admin trying to allocate seats from Acme's entitlement
      await request(app.getHttpServer())
        .post('/customer/licenses/allocate')
        .set('Cookie', globexAdminCookie)
        .send({ entitlementId: 'entit-acme-1', companyId: 'comp-globex-in', quantity: 10 })
        .expect(400); // Entitlement mismatch throws 400 Bad Request
    });
  });

  describe('Capacity & Concurrency Limits (OCC)', () => {
    it('3. Customer cannot allocate beyond remaining capacity', async () => {
      // entit-acme-1 has 500 total, 300 allocated. Remaining = 200.
      await request(app.getHttpServer())
        .post('/customer/licenses/allocate')
        .set('Cookie', acmeAdminCookie)
        .send({ entitlementId: 'entit-acme-1', companyId: 'comp-acme-in', quantity: 201 })
        .expect(400)
        .expect(res => expect(res.body.message).toContain('Insufficient entitlement quantity'));
    });

    it('4. Concurrent allocations cannot oversubscribe an entitlement', async () => {
      // Current available is 200.
      // We send 5 concurrent requests of 50 each (total 250).
      // 4 should succeed (200), 1 should fail (Conflict or BadRequest).
      const reqs = Array.from({ length: 5 }).map(() => 
        request(app.getHttpServer())
          .post('/customer/licenses/allocate')
          .set('Cookie', acmeAdminCookie)
          .send({ entitlementId: 'entit-acme-1', companyId: 'comp-acme-in', quantity: 50 })
      );
      
      const responses = await Promise.all(reqs);
      
      const successful = responses.filter(r => r.status === 201);
      const failed = responses.filter(r => r.status !== 201);
      
      expect(successful.length).toBeLessThanOrEqual(4);
      expect(failed.length).toBeGreaterThanOrEqual(1);
      
      // Verify the final database state NEVER exceeds 500 (300 initial + 200 allocated)
      const entitlement = await prisma.entitlement.findUnique({
        where: { id: 'entit-acme-1' }
      });
      
      expect(entitlement?.allocatedQuantity).toBeLessThanOrEqual(500);
      expect(entitlement?.quantity).toBe(500);
    });

    it('6. Successful allocation persists correctly and 7. creates an AuditEvent', async () => {
      // First, get an entitlement to test with (globex has 50 available)
      const quantity = 5;
      
      const res = await request(app.getHttpServer())
        .post('/customer/licenses/allocate')
        .set('Cookie', globexAdminCookie)
        .send({ entitlementId: 'entit-globex-1', companyId: 'comp-globex-in', quantity })
        .expect(201);
        
      expect(res.body.status).toBe('ALLOCATED');
      expect(res.body.quantity).toBe(quantity);
      
      const allocId = res.body.id;
      
      // Verify persistence
      const savedAlloc = await prisma.licenseAllocation.findUnique({
        where: { id: allocId }
      });
      expect(savedAlloc).toBeDefined();
      expect(savedAlloc?.quantity).toBe(quantity);
      
      // Verify Audit Event
      const audit = await prisma.auditEvent.findFirst({
        where: { 
          targetId: allocId,
          action: 'ALLOCATE_LICENSE'
        }
      });
      
      expect(audit).toBeDefined();
      expect(audit?.companyId).toBe('comp-globex-in');
      expect(audit?.actorId).toBe('user-globex-admin');
    });
  });

  describe('Allocation Lifecycle (suspend / reactivate / revoke)', () => {
    async function createAllocation() {
      const res = await request(app.getHttpServer())
        .post('/customer/licenses/allocate')
        .set('Cookie', acmeAdminCookie)
        .send({ entitlementId: 'entit-acme-1', companyId: 'comp-acme-in', quantity: 1 })
        .expect(201);
      return res.body.id as string;
    }

    it('9. A freshly allocated batch can be suspended, then reactivated back to ACTIVE', async () => {
      const id = await createAllocation();

      await request(app.getHttpServer())
        .post(`/customer/licenses/${id}/suspend`)
        .set('Cookie', acmeAdminCookie)
        .expect(201)
        .expect((res) => expect(res.body.status).toBe('SUSPENDED'));

      // This is the route that was previously entirely missing —
      // LicensesService.setStatus() supported SUSPENDED -> ACTIVE
      // internally, but no controller route ever called it that way.
      await request(app.getHttpServer())
        .post(`/customer/licenses/${id}/reactivate`)
        .set('Cookie', acmeAdminCookie)
        .expect(201)
        .expect((res) => expect(res.body.status).toBe('ACTIVE'));
    });

    it('10. Revoke is terminal — cannot be suspended or reactivated afterwards', async () => {
      const id = await createAllocation();

      await request(app.getHttpServer())
        .post(`/customer/licenses/${id}/revoke`)
        .set('Cookie', acmeAdminCookie)
        .expect(201)
        .expect((res) => expect(res.body.status).toBe('REVOKED'));

      await request(app.getHttpServer())
        .post(`/customer/licenses/${id}/reactivate`)
        .set('Cookie', acmeAdminCookie)
        .expect(400);
      await request(app.getHttpServer())
        .post(`/customer/licenses/${id}/suspend`)
        .set('Cookie', acmeAdminCookie)
        .expect(400);
    });

    it('11. A user from a different company/enterprise cannot suspend or reactivate this allocation', async () => {
      const id = await createAllocation();

      await request(app.getHttpServer())
        .post(`/customer/licenses/${id}/suspend`)
        .set('Cookie', globexAdminCookie)
        .expect(404); // 404, not 403 — avoid IDOR leak, matches findOne()'s existing convention
    });

    it('12. Reactivate audits as UPDATE_LICENSE_STATUS, same as suspend/revoke', async () => {
      const id = await createAllocation();
      await request(app.getHttpServer()).post(`/customer/licenses/${id}/suspend`).set('Cookie', acmeAdminCookie).expect(201);
      await request(app.getHttpServer()).post(`/customer/licenses/${id}/reactivate`).set('Cookie', acmeAdminCookie).expect(201);

      const audit = await prisma.auditEvent.findFirst({
        where: { targetId: id, action: 'UPDATE_LICENSE_STATUS', reason: 'Status changed to ACTIVE' },
      });
      expect(audit).toBeDefined();
      expect(audit?.result).toBe('SUCCESS');
    });
  });
});
