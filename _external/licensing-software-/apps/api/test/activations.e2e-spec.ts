import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from './../src/app.module.js';
import { PrismaService } from '../src/prisma/prisma.service.js';

describe('Activation Domain (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let server: any;

  let acmeCompanyAdminCookie: string; // CompanyAdmin — Acme India (files + approves)
  let acmeEnterpriseAdminCookie: string; // EnterpriseAdmin — Acme (only this scope may approve a capacity request)
  let globexAdminCookie: string; // CompanyAdmin — Globex (must never see Acme's activations)
  let vendorAdminCookie: string; // Trustfabric vendor — global cross-customer scope
  let entitlementId: string;

  // E2eAuthController is mounted at customer/auth regardless of the
  // principal type it mints — 'vendor-admin' is just another testIdentity
  // value handled by the same single endpoint (see e2e-auth.controller.ts).
  const getCookie = async (identity: string) => {
    const res = await request(server).post('/customer/auth/e2e/session').send({ testIdentity: identity });
    return res.headers['set-cookie'][0].split(';')[0];
  };

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleFixture.createNestApplication();
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const cookieParser = require('cookie-parser');
    app.use(cookieParser());
    await app.init();
    server = app.getHttpServer();

    prisma = app.get(PrismaService);

    [acmeCompanyAdminCookie, acmeEnterpriseAdminCookie, globexAdminCookie, vendorAdminCookie] = await Promise.all([
      getCookie('company-admin-acme-india'),
      getCookie('enterprise-admin-acme'),
      getCookie('company-admin-globex'),
      getCookie('vendor-admin'),
    ]);

    // A dedicated Entitlement, not shared with license-requests.e2e-spec.ts's
    // fixtures (entit-acme-1) — vitest runs e2e spec files as parallel
    // workers against the same live Postgres database, and both files
    // otherwise contend for the same entitlement's OCC version, causing
    // spurious ConflictExceptions unrelated to the behavior under test here.
    const entitlement = await prisma.entitlement.create({
      data: {
        enterpriseId: 'ent-acme',
        productId: 'prod-sec-1',
        quantity: 100,
        startDate: new Date(),
        endDate: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000),
        status: 'ACTIVE',
      },
    });
    entitlementId = entitlement.id;
  });

  afterAll(async () => {
    await app.close();
  });

  /** Creates a fresh PENDING quantity-1 targetUserId request and approves it, returning the approval response body. */
  async function createAndApprove(targetUserId = 'user-acme-employee') {
    const createRes = await request(server)
      .post('/customer/license-requests')
      .set('Cookie', acmeCompanyAdminCookie)
      .send({
        companyId: 'comp-acme-in',
        entitlementId,
        quantity: 1,
        reason: 'New hire needs a seat',
        targetUserId,
      })
      .expect(201);

    const approveRes = await request(server)
      .post(`/customer/license-requests/${createRes.body.id}/approve`)
      .set('Cookie', acmeCompanyAdminCookie)
      .expect(201);

    return { request: createRes.body, approval: approveRes.body };
  }

  // ─── 1-2. Request identity: targetUserId, not requestedBy ──────────────────

  it('1. A request can name a targetUserId distinct from the filer (requestedBy)', async () => {
    const { request: req } = await createAndApprove();
    expect(req.requestedBy).toBe('user-acme-in-admin'); // the CompanyAdmin who filed it
    expect(req.targetUserId).toBe('user-acme-employee'); // NOT the same person
  });

  it('2. Approval creates exactly one Activation whose userId is targetUserId, never requestedBy', async () => {
    const { approval } = await createAndApprove();
    expect(approval.activation).toBeDefined();
    expect(approval.activation.status).toBe('PENDING');
    expect(approval.activation.userId).toBe('user-acme-employee');
    expect(approval.activation.userId).not.toBe('user-acme-in-admin');
  });

  it('3. A quantity>1 request with no targetUserId creates NO Activation (pure capacity provisioning, unchanged legacy behavior)', async () => {
    const createRes = await request(server)
      .post('/customer/license-requests')
      .set('Cookie', acmeCompanyAdminCookie)
      .send({ companyId: 'comp-acme-in', entitlementId, quantity: 3, reason: 'Team capacity' })
      .expect(201);
    // A capacity request (no targetUserId) can only be approved by an
    // enterprise-scoped admin, not the requesting company's own admin.
    const approveRes = await request(server)
      .post(`/customer/license-requests/${createRes.body.id}/approve`)
      .set('Cookie', acmeEnterpriseAdminCookie)
      .expect(201);

    expect(approveRes.body.activation).toBeNull();
    const found = await prisma.activation.findUnique({ where: { requestId: createRes.body.id } });
    expect(found).toBeNull();
  });

  it('4. A request with targetUserId but quantity != 1 is rejected with 400', async () => {
    await request(server)
      .post('/customer/license-requests')
      .set('Cookie', acmeCompanyAdminCookie)
      .send({
        companyId: 'comp-acme-in',
        entitlementId,
        quantity: 2,
        reason: 'Bad request',
        targetUserId: 'user-acme-employee',
      })
      .expect(400);
  });

  // ─── 5. Bound enrollment token + agent registration (deterministic, no heuristic) ──

  it('5. Approval returns a one-time activation-bound enrollment token, and the agent registers with it deterministically', async () => {
    const { approval } = await createAndApprove();
    expect(approval.enrollmentToken?.token).toEqual(expect.any(String));

    const registerRes = await request(server)
      .post('/agent/register')
      .send({ enrollmentToken: approval.enrollmentToken.token, deviceId: `device-${approval.activation.id}` })
      .expect(201);

    expect(registerRes.body.credential).toEqual(expect.any(String));
    expect(registerRes.body.status).toBe('ACTIVE');

    const activation = await prisma.activation.findUnique({ where: { id: approval.activation.id } });
    expect(activation?.status).toBe('ACTIVE');
    expect(activation?.installationId).toBeTruthy();

    const installation = await prisma.installation.findUnique({ where: { id: activation!.installationId! } });
    expect(installation?.activationId).toBe(approval.activation.id); // immutable provenance FK set correctly
  });

  it('6. Determinism proof: with TWO simultaneously-PENDING activations on the SAME allocation, the bound token links only its OWN activation — never a heuristic guess at the other', async () => {
    // Two separately-approved requests naturally get separate allocations
    // (allocate() always creates a new one), so to genuinely prove
    // determinism rather than "there happened to be only one candidate", we
    // manually attach a second PENDING activation to the SAME allocation the
    // first one uses, then confirm registering with activation A's token
    // links installation to A and leaves B untouched.
    const { approval: approvalA } = await createAndApprove();
    const activationA = approvalA.activation;

    const allocation = await prisma.licenseAllocation.findUnique({ where: { id: activationA.allocationId } });
    const requestB = await prisma.licenseRequest.create({
      data: {
        enterpriseId: 'ent-acme',
        companyId: 'comp-acme-in',
        entitlementId,
        requestedBy: 'user-acme-in-admin',
        targetUserId: 'user-acme-employee',
        quantity: 1,
        status: 'APPROVED',
        reviewedBy: 'user-acme-in-admin',
        reviewedAt: new Date(),
      },
    });
    const activationB = await prisma.activation.create({
      data: {
        requestId: requestB.id,
        allocationId: allocation!.id, // SAME allocation as activation A
        userId: 'user-acme-employee',
        companyId: 'comp-acme-in',
        productId: 'prod-sec-1',
        status: 'PENDING',
      },
    });

    const registerRes = await request(server)
      .post('/agent/register')
      .send({ enrollmentToken: approvalA.enrollmentToken.token, deviceId: `device-determinism-${activationA.id}` })
      .expect(201);

    const reloadedA = await prisma.activation.findUnique({ where: { id: activationA.id } });
    const reloadedB = await prisma.activation.findUnique({ where: { id: activationB.id } });

    expect(reloadedA?.installationId).toBeTruthy();
    expect(reloadedA?.status).toBe('ACTIVE');
    // B must be completely untouched — proves there is no "find a pending
    // activation for this allocation" heuristic left anywhere.
    expect(reloadedB?.installationId).toBeNull();
    expect(reloadedB?.status).toBe('PENDING');
    expect(registerRes.body.status).toBe('ACTIVE');
  });

  // ─── 7. Seat accounting: consumed exactly once across approve + register ───

  it('7. consumedQuantity increments exactly once at approval time, NOT again at registration', async () => {
    const { approval } = await createAndApprove();
    const afterApproval = await prisma.licenseAllocation.findUnique({ where: { id: approval.activation.allocationId } });
    expect(afterApproval?.consumedQuantity).toBe(1);

    await request(server)
      .post('/agent/register')
      .send({ enrollmentToken: approval.enrollmentToken.token, deviceId: `device-seat-${approval.activation.id}` })
      .expect(201);

    const afterRegister = await prisma.licenseAllocation.findUnique({ where: { id: approval.activation.allocationId } });
    expect(afterRegister?.consumedQuantity).toBe(1); // unchanged — not double-consumed
  });

  // ─── 8-12. Lifecycle: suspend / reactivate / revoke, reflected in agent policy ──

  async function setupActiveActivation() {
    const { approval } = await createAndApprove();
    const registerRes = await request(server)
      .post('/agent/register')
      .send({ enrollmentToken: approval.enrollmentToken.token, deviceId: `device-lifecycle-${approval.activation.id}` })
      .expect(201);
    return { activationId: approval.activation.id, credential: registerRes.body.credential as string };
  }

  it('8. Heartbeat on a healthy ACTIVE activation reports not suspended/revoked', async () => {
    const { credential } = await setupActiveActivation();
    const res = await request(server).post('/agent/heartbeat').set('Authorization', `Bearer ${credential}`).send({}).expect(201);
    expect(res.body.suspended).toBe(false);
    expect(res.body.revoked).toBe(false);
  });

  it('9. Suspending the Activation blocks agent heartbeat/policy even though the Installation itself is still ACTIVE', async () => {
    const { activationId, credential } = await setupActiveActivation();
    await request(server)
      .post(`/customer/activations/${activationId}/suspend`)
      .set('Cookie', acmeCompanyAdminCookie)
      .expect(201);

    const res = await request(server).get('/agent/policy').set('Authorization', `Bearer ${credential}`).expect(200);
    expect(res.body.suspended).toBe(true);
  });

  it('10. Reactivating restores access', async () => {
    const { activationId, credential } = await setupActiveActivation();
    await request(server).post(`/customer/activations/${activationId}/suspend`).set('Cookie', acmeCompanyAdminCookie).expect(201);
    await request(server).post(`/customer/activations/${activationId}/reactivate`).set('Cookie', acmeCompanyAdminCookie).expect(201);

    const res = await request(server).get('/agent/policy').set('Authorization', `Bearer ${credential}`).expect(200);
    expect(res.body.suspended).toBe(false);
  });

  it('11. Revoking blocks the agent and frees the seat exactly once', async () => {
    const { activationId, credential } = await setupActiveActivation();
    const activationBefore = await prisma.activation.findUnique({ where: { id: activationId } });
    const before = await prisma.licenseAllocation.findUnique({ where: { id: activationBefore!.allocationId } });

    await request(server).post(`/customer/activations/${activationId}/revoke`).set('Cookie', acmeCompanyAdminCookie).expect(201);

    const res = await request(server).get('/agent/policy').set('Authorization', `Bearer ${credential}`).expect(200);
    expect(res.body.revoked).toBe(true);

    const after = await prisma.licenseAllocation.findUnique({ where: { id: activationBefore!.allocationId } });
    expect(after!.consumedQuantity).toBe(before!.consumedQuantity - 1);
  });

  it('12. A revoked Activation cannot be suspended/reactivated again (terminal state)', async () => {
    const { activationId } = await setupActiveActivation();
    await request(server).post(`/customer/activations/${activationId}/revoke`).set('Cookie', acmeCompanyAdminCookie).expect(201);
    await request(server).post(`/customer/activations/${activationId}/reactivate`).set('Cookie', acmeCompanyAdminCookie).expect(400);
  });

  // ─── 13-15. Device replacement: DEACTIVATED, not REVOKED, seat retained ────

  it('13. Revoking the linked Installation directly (device retirement) deactivates the Activation WITHOUT freeing the seat', async () => {
    const { approval } = await createAndApprove();
    const registerRes = await request(server)
      .post('/agent/register')
      .send({ enrollmentToken: approval.enrollmentToken.token, deviceId: `device-replace-${approval.activation.id}` })
      .expect(201);

    const before = await prisma.licenseAllocation.findUnique({ where: { id: approval.activation.allocationId } });

    await request(server)
      .post(`/customer/installations/${registerRes.body.installationId}/revoke`)
      .set('Cookie', acmeCompanyAdminCookie)
      .expect(201);

    const activation = await prisma.activation.findUnique({ where: { id: approval.activation.id } });
    expect(activation?.status).toBe('DEACTIVATED');
    expect(activation?.installationId).toBeNull();

    const after = await prisma.licenseAllocation.findUnique({ where: { id: approval.activation.allocationId } });
    expect(after?.consumedQuantity).toBe(before?.consumedQuantity); // seat retained, not freed
  });

  it('14. A replacement enrollment token can be minted for a DEACTIVATED activation, and the new device links to the SAME activation without a second seat consumption', async () => {
    const { approval } = await createAndApprove();
    const firstRegister = await request(server)
      .post('/agent/register')
      .send({ enrollmentToken: approval.enrollmentToken.token, deviceId: `device-old-${approval.activation.id}` })
      .expect(201);
    await request(server)
      .post(`/customer/installations/${firstRegister.body.installationId}/revoke`)
      .set('Cookie', acmeCompanyAdminCookie)
      .expect(201);

    const before = await prisma.licenseAllocation.findUnique({ where: { id: approval.activation.allocationId } });

    const replacementRes = await request(server)
      .post(`/customer/activations/${approval.activation.id}/reactivate-enrollment`)
      .set('Cookie', acmeCompanyAdminCookie)
      .expect(201);
    expect(replacementRes.body.enrollmentToken.token).toEqual(expect.any(String));

    const secondRegister = await request(server)
      .post('/agent/register')
      .send({ enrollmentToken: replacementRes.body.enrollmentToken.token, deviceId: `device-new-${approval.activation.id}` })
      .expect(201);

    const activation = await prisma.activation.findUnique({ where: { id: approval.activation.id } });
    expect(activation?.status).toBe('ACTIVE');
    expect(activation?.installationId).toBe(secondRegister.body.installationId);

    const after = await prisma.licenseAllocation.findUnique({ where: { id: approval.activation.allocationId } });
    expect(after?.consumedQuantity).toBe(before?.consumedQuantity); // still no new seat consumed
  });

  it('15. A replacement enrollment token cannot be minted for a still-ACTIVE activation', async () => {
    const { activationId } = await setupActiveActivation();
    await request(server)
      .post(`/customer/activations/${activationId}/reactivate-enrollment`)
      .set('Cookie', acmeCompanyAdminCookie)
      .expect(400);
  });

  // ─── 16-17. Tenant isolation ─────────────────────────────────────────────────

  it('16. A CompanyAdmin from another company/enterprise cannot read Acme\'s activation (404, not 403 — no IDOR leak)', async () => {
    const { approval } = await createAndApprove();
    await request(server)
      .get(`/customer/activations/${approval.activation.id}`)
      .set('Cookie', globexAdminCookie)
      .expect(404);
  });

  it('17. A targetUserId belonging to another company is rejected when creating the request', async () => {
    await request(server)
      .post('/customer/license-requests')
      .set('Cookie', acmeCompanyAdminCookie)
      .send({
        companyId: 'comp-acme-in',
        entitlementId,
        quantity: 1,
        reason: 'Cross-company attempt',
        targetUserId: 'user-globex-admin', // belongs to Globex, not Acme
      })
      .expect(400);
  });

  // ─── 18-19. Concurrency ──────────────────────────────────────────────────────

  it('18. Concurrently approving the SAME request twice creates only one Activation and consumes only one seat', async () => {
    const createRes = await request(server)
      .post('/customer/license-requests')
      .set('Cookie', acmeCompanyAdminCookie)
      .send({
        companyId: 'comp-acme-in',
        entitlementId,
        quantity: 1,
        reason: 'Concurrent double-approve test',
        targetUserId: 'user-acme-employee',
      })
      .expect(201);

    const [resA, resB] = await Promise.all([
      request(server).post(`/customer/license-requests/${createRes.body.id}/approve`).set('Cookie', acmeCompanyAdminCookie),
      request(server).post(`/customer/license-requests/${createRes.body.id}/approve`).set('Cookie', acmeCompanyAdminCookie),
    ]);

    const statuses = [resA.status, resB.status];
    expect(statuses.filter((s) => s === 201).length).toBe(1);
    expect(statuses.some((s) => s === 400 || s === 409)).toBe(true);

    const activations = await prisma.activation.findMany({ where: { requestId: createRes.body.id } });
    expect(activations.length).toBe(1);
  });

  it('19. A retried approval on an already-APPROVED request is rejected (no duplicate Activation), matching existing double-approve behavior', async () => {
    const { request: req } = await createAndApprove();
    await request(server)
      .post(`/customer/license-requests/${req.id}/approve`)
      .set('Cookie', acmeCompanyAdminCookie)
      .expect(400);

    const activations = await prisma.activation.findMany({ where: { requestId: req.id } });
    expect(activations.length).toBe(1);
  });

  // ─── 20. Approval ≠ Activation: no customer-facing manual activation endpoint ──

  it('20. There is no public endpoint for a customer to manually create an Activation — issuance is exclusively a side effect of approval', async () => {
    // No route is registered at all for POST /customer/activations (only
    // GET list/detail and the lifecycle sub-routes exist) — this proves the
    // absence structurally, not just that it happens to reject with 403.
    await request(server).post('/customer/activations').set('Cookie', acmeCompanyAdminCookie).send({}).expect(404);
  });

  it('21. The CREATE_ACTIVATION audit event attributes issuance to SYSTEM, never to the approving Customer Admin', async () => {
    const { approval, request: req } = await createAndApprove();
    const auditRow = await prisma.auditEvent.findFirst({
      where: { action: 'CREATE_ACTIVATION', targetId: approval.activation.id },
    });
    expect(auditRow?.actorType).toBe('SYSTEM');
    expect(auditRow?.actorId).toBe('SYSTEM');
    // The approving admin (user-acme-in-admin) is still traceable in the reason, just not as the actor.
    expect(auditRow?.reason).toContain('user-acme-in-admin');
    // And the separate APPROVE_LICENSE_REQUEST event is correctly attributed to that same admin as ITS actor.
    const approvalAudit = await prisma.auditEvent.findFirst({
      where: { action: 'APPROVE_LICENSE_REQUEST', targetId: req.id },
    });
    expect(approvalAudit?.actorType).toBe('USER');
    expect(approvalAudit?.actorId).toBe('user-acme-in-admin');
  });

  it('22. The approval response never includes an enrollmentToken on an idempotent path (only the response that actually mints one carries the plaintext)', async () => {
    // A quantity>1 capacity-only request never mints a token at all.
    const createRes = await request(server)
      .post('/customer/license-requests')
      .set('Cookie', acmeCompanyAdminCookie)
      .send({ companyId: 'comp-acme-in', entitlementId, quantity: 2, reason: 'No token expected' })
      .expect(201);
    // A capacity request (no targetUserId) can only be approved by an
    // enterprise-scoped admin, not the requesting company's own admin.
    const approveRes = await request(server)
      .post(`/customer/license-requests/${createRes.body.id}/approve`)
      .set('Cookie', acmeEnterpriseAdminCookie)
      .expect(201);
    expect(approveRes.body.enrollmentToken).toBeNull();
    expect(JSON.stringify(approveRes.body)).not.toMatch(/tokenHash/);
  });

  // ─── 23-26. Vendor (Trustfabric Admin) global Activation visibility + lifecycle control ──

  it('23. A vendor can see an Activation via the global endpoint that a Globex (different enterprise) session could never reach', async () => {
    const { approval } = await createAndApprove(); // an Acme India activation

    // Proves global reach: the vendor endpoint returns an Acme-owned
    // Activation with no company/enterprise scoping applied at all — a
    // customer session (even a valid one, just from a different company)
    // could never see this via /customer/activations (see test 16).
    const res = await request(server).get('/vendor/activations').set('Cookie', vendorAdminCookie).expect(200);
    const ids = res.body.map((a: any) => a.id);
    expect(ids).toContain(approval.activation.id);
  });

  it('24. A customer session cannot reach the vendor Activations endpoint (principal-type isolation)', async () => {
    await request(server).get('/vendor/activations').set('Cookie', acmeCompanyAdminCookie).expect(403);
  });

  it('25. A vendor can suspend and revoke an Activation belonging to any customer, without needing that customer\'s own session', async () => {
    const { activationId } = await setupActiveActivation();

    await request(server).post(`/vendor/activations/${activationId}/suspend`).set('Cookie', vendorAdminCookie).expect(201);
    const afterSuspend = await prisma.activation.findUnique({ where: { id: activationId } });
    expect(afterSuspend?.status).toBe('SUSPENDED');

    await request(server).post(`/vendor/activations/${activationId}/revoke`).set('Cookie', vendorAdminCookie).expect(201);
    const afterRevoke = await prisma.activation.findUnique({ where: { id: activationId } });
    expect(afterRevoke?.status).toBe('REVOKED');
  });

  it('26. A vendor-initiated suspend/revoke is still fully audited, distinctly from a customer-initiated one', async () => {
    const { activationId } = await setupActiveActivation();
    await request(server).post(`/vendor/activations/${activationId}/suspend`).set('Cookie', vendorAdminCookie).expect(201);

    const auditRow = await prisma.auditEvent.findFirst({
      where: { action: 'SUSPEND_ACTIVATION', targetId: activationId },
    });
    expect(auditRow?.actorId).toBe('user-vendor-admin');
  });
});
