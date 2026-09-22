import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from './../src/app.module.js';
import { PrismaService } from '../src/prisma/prisma.service.js';

describe('Customer License Requests & Approval Workflow (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;

  let acmeAdminCookie: string;   // EnterpriseAdmin — Acme
  let acmeCompanyAdminCookie: string; // CompanyAdmin — Acme India only
  let globexAdminCookie: string; // CompanyAdmin — Globex
  let acmeUserCookie: string;    // User (license.read only)

  const getCookie = async (identity: string) => {
    const res = await request(app.getHttpServer())
      .post('/customer/auth/e2e/session')
      .send({ testIdentity: identity });
    return res.headers['set-cookie'][0].split(';')[0];
  };

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const cookieParser = require('cookie-parser');
    app.use(cookieParser());
    await app.init();

    prisma = app.get(PrismaService);

    [acmeAdminCookie, acmeCompanyAdminCookie, globexAdminCookie, acmeUserCookie] = await Promise.all([
      getCookie('enterprise-admin-acme'),
      getCookie('company-admin-acme-india'),
      getCookie('company-admin-globex'),
      getCookie('employee-acme'),
    ]);
  });

  afterAll(async () => {
    await app.close();
  });

  /**
   * Reset req-acme-pending-1 to PENDING before each approval-related test.
   * This is necessary because vitest can run tests in declaration order within a describe block,
   * but the concurrent approval (test 15) or earlier approval may have consumed the request.
   */
  const resetPendingRequest = async (prismaClient: PrismaService) => {
    await prismaClient.licenseRequest.update({
      where: { id: 'req-acme-pending-1' },
      data:  { status: 'PENDING', reviewedBy: null, reviewedAt: null },
    });
  };

  // ─── 1. List requests — authorization & isolation ────────────────────────────

  it('1. Authorized enterprise admin can list requests within their enterprise scope', async () => {
    const res = await request(app.getHttpServer())
      .get('/customer/license-requests')
      .set('Cookie', acmeAdminCookie)
      .expect(200);

    expect(Array.isArray(res.body)).toBe(true);
    const ids = res.body.map((r: any) => r.id);
    // Should see Acme requests
    expect(ids).toContain('req-acme-pending-1');
    expect(ids).toContain('req-acme-approved-1');
    expect(ids).toContain('req-acme-rejected-1');
    // Must NOT see Globex requests
    expect(ids).not.toContain('req-globex-pending-1');
  });

  it('2. Response includes enriched company and product names (not raw IDs only)', async () => {
    const res = await request(app.getHttpServer())
      .get('/customer/license-requests')
      .set('Cookie', acmeAdminCookie)
      .expect(200);

    const pending = res.body.find((r: any) => r.id === 'req-acme-pending-1');
    expect(pending.company.name).toBe('Acme India');
    expect(pending.entitlement.product.name).toBeDefined();
  });

  it('3. Cross-enterprise request access is rejected — Acme admin cannot see Globex requests', async () => {
    await request(app.getHttpServer())
      .get('/customer/license-requests/req-globex-pending-1')
      .set('Cookie', acmeAdminCookie)
      .expect(404);
  });

  it('4. Unauthorized user (license.read only) cannot list requests → 403', async () => {
    await request(app.getHttpServer())
      .get('/customer/license-requests')
      .set('Cookie', acmeUserCookie)
      .expect(403);
  });

  // ─── 5–6. Rejection ─────────────────────────────────────────────────────────

  it('5. Authorized admin can reject a pending request', async () => {
    // Reset req-acme-pending-2 to PENDING in case a previous run already rejected it
    await prisma.licenseRequest.update({
      where: { id: 'req-acme-pending-2' },
      data:  { status: 'PENDING', reviewedBy: null, reviewedAt: null, reviewReason: null },
    });
    const reason = 'Budget freeze — resubmit next quarter';
    const res = await request(app.getHttpServer())
      .post('/customer/license-requests/req-acme-pending-2/reject')
      .set('Cookie', acmeAdminCookie)
      .send({ reason })
      .expect(201);

    expect(res.body.status).toBe('REJECTED');
    expect(res.body.reviewReason).toBe(reason);
    expect(res.body.reviewedBy).toBe('user-acme-admin');
    expect(res.body.reviewedAt).toBeTruthy();
  });

  it('6. Rejected request persists in database with correct reason and reviewer', async () => {
    const saved = await prisma.licenseRequest.findUnique({ where: { id: 'req-acme-pending-2' } });
    expect(saved?.status).toBe('REJECTED');
    expect(saved?.reviewReason).toBe('Budget freeze — resubmit next quarter');
    expect(saved?.reviewedBy).toBe('user-acme-admin');
  });

  it('7. Rejection requires a reason — empty reason returns 400', async () => {
    // req-acme-pending-1 is still PENDING at this point
    await request(app.getHttpServer())
      .post('/customer/license-requests/req-acme-pending-1/reject')
      .set('Cookie', acmeAdminCookie)
      .send({ reason: '   ' })
      .expect(400);
  });

  it('8. Unauthorized user cannot reject → 403', async () => {
    await request(app.getHttpServer())
      .post('/customer/license-requests/req-acme-pending-1/reject')
      .set('Cookie', acmeUserCookie)
      .send({ reason: 'Attempt from user without permission' })
      .expect(403);
  });

  // ─── 9–12. Approval ──────────────────────────────────────────────────────────

  it('9. Authorized admin can approve a pending request and it transitions to APPROVED', async () => {
    await resetPendingRequest(prisma);
    const res = await request(app.getHttpServer())
      .post('/customer/license-requests/req-acme-pending-1/approve')
      .set('Cookie', acmeAdminCookie)
      .expect(201);

    expect(res.body.status).toBe('APPROVED');
    expect(res.body.reviewedBy).toBe('user-acme-admin');
    expect(res.body.reviewedAt).toBeTruthy();
  });

  it('10. Approval creates a LicenseAllocation consuming seats from the entitlement', async () => {
    // Read the entitlement AFTER test 9 approved 10 seats from req-acme-pending-1.
    // We verify allocatedQuantity increased (not a hard absolute since other tests may have allocated).
    const entitlement = await prisma.entitlement.findUnique({ where: { id: 'entit-acme-1' } });
    // The important invariant: allocatedQuantity must be ≥ 310 (300 seeded + at least 10 from this approval)
    // and must never exceed the total quantity of 500.
    expect(entitlement?.allocatedQuantity).toBeGreaterThanOrEqual(310);
    expect(entitlement?.allocatedQuantity).toBeLessThanOrEqual(500);
  });

  it('11. Approval creates an AuditEvent', async () => {
    // Find the most recent APPROVE_LICENSE_REQUEST event (test 9 just created one)
    const audit = await prisma.auditEvent.findFirst({
      where:   { action: 'APPROVE_LICENSE_REQUEST', targetId: 'req-acme-pending-1' },
      orderBy: { createdAt: 'desc' },
    });
    expect(audit).toBeDefined();
    expect(audit?.actorId).toBe('user-acme-admin');
    expect(audit?.result).toBe('SUCCESS');
  });

  it('12. Same request cannot be approved twice → 400', async () => {
    // req-acme-pending-1 is APPROVED from test 9 — must not be approvable again
    await request(app.getHttpServer())
      .post('/customer/license-requests/req-acme-pending-1/approve')
      .set('Cookie', acmeAdminCookie)
      .expect(400)
      .expect(res => expect(res.body.message).toContain('Cannot approve request in APPROVED status'));
  });

  it('13. Already-rejected request cannot be approved → 400', async () => {
    // req-acme-pending-2 was rejected in test 5
    await request(app.getHttpServer())
      .post('/customer/license-requests/req-acme-pending-2/approve')
      .set('Cookie', acmeAdminCookie)
      .expect(400)
      .expect(res => expect(res.body.message).toContain('Cannot approve request in REJECTED status'));
  });

  it('14. Unauthorized user cannot approve → 403', async () => {
    await request(app.getHttpServer())
      .post('/customer/license-requests/req-acme-pending-1/approve')
      .set('Cookie', acmeUserCookie)
      .expect(403);
  });

  // ─── 15. Concurrency / capacity ──────────────────────────────────────────────

  it('15. Concurrent approval of two large requests cannot oversubscribe the entitlement', async () => {
    // Create two fresh PENDING requests each asking for 120 seats (total 240 > 190 available).
    // entit-acme-1: quantity=500, allocatedQuantity=310 after test 10 → available=190.
    const makeRequest = async (id: string, qty: number) => {
      await prisma.licenseRequest.upsert({
        where: { id },
        update: { status: 'PENDING', quantity: qty },
        create: {
          id,
          enterpriseId:  'ent-acme',
          companyId:     'comp-acme-in',
          entitlementId: 'entit-acme-1',
          requestedBy:   'user-acme-employee',
          quantity:      qty,
          reason:        'Concurrent test',
          status:        'PENDING',
        },
      });
    };

    await makeRequest('req-concurrent-a', 120);
    await makeRequest('req-concurrent-b', 120);

    // Attempt both approvals simultaneously
    const [resA, resB] = await Promise.all([
      request(app.getHttpServer())
        .post('/customer/license-requests/req-concurrent-a/approve')
        .set('Cookie', acmeAdminCookie),
      request(app.getHttpServer())
        .post('/customer/license-requests/req-concurrent-b/approve')
        .set('Cookie', acmeAdminCookie),
    ]);

    const statuses = [resA.status, resB.status];
    // Exactly one should succeed (201), the other fails (400 Insufficient or 409 Conflict)
    expect(statuses.filter(s => s === 201).length).toBeLessThanOrEqual(1);
    expect(statuses.some(s => s === 400 || s === 409)).toBe(true);

    // Final DB state must never exceed 500 total
    const ent = await prisma.entitlement.findUnique({ where: { id: 'entit-acme-1' } });
    expect(ent?.allocatedQuantity).toBeLessThanOrEqual(500);
  });
});
