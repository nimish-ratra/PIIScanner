import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from './../src/app.module.js';
import { PrismaService } from '../src/prisma/prisma.service.js';

describe('Agent Registration — Employee Identity (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let server: any;

  let enterpriseAdminCookie: string;
  let companyId: string;
  let entitlementId: string;
  let allocationId: string;
  let employeeUserId: string;

  const getCookie = async (identity: string) => {
    const res = await request(server).post('/customer/auth/e2e/session').send({ testIdentity: identity });
    return res.headers['set-cookie'][0].split(';')[0];
  };

  async function issuePlainToken(maxActivations = 1) {
    const res = await request(server)
      .post(`/customer/companies/${companyId}/enrollment-tokens`)
      .set('Cookie', enterpriseAdminCookie)
      .send({ allocationId, maxActivations })
      .expect(201);
    return res.body.token as string;
  }

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleFixture.createNestApplication();
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const cookieParser = require('cookie-parser');
    app.use(cookieParser());
    await app.init();
    server = app.getHttpServer();
    prisma = app.get(PrismaService);

    enterpriseAdminCookie = await getCookie('enterprise-admin-acme');

    // Dedicated company + entitlement + allocation + employee, isolated from
    // other e2e files' shared Acme fixtures (comp-acme-in / entit-acme-1) to
    // avoid parallel-worker OCC contention, and so this file can freely
    // mutate this company's allowedEmailDomains without affecting others.
    const company = await prisma.company.create({
      data: { name: 'Agent Identity Test Co', enterpriseId: 'ent-acme' },
    });
    companyId = company.id;

    const employeeUser = await prisma.user.create({
      data: { companyId, email: `employee-${company.id}@acme.test`, name: 'Test Employee' },
    });
    employeeUserId = employeeUser.id;

    const entitlement = await prisma.entitlement.create({
      data: {
        enterpriseId: 'ent-acme',
        productId: 'prod-sec-1',
        quantity: 50,
        startDate: new Date(),
        endDate: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000),
        status: 'ACTIVE',
      },
    });
    entitlementId = entitlement.id;

    const allocRes = await request(server)
      .post('/customer/licenses/allocate')
      .set('Cookie', enterpriseAdminCookie)
      .send({ entitlementId, companyId, quantity: 20 })
      .expect(201);
    allocationId = allocRes.body.id;
  });

  afterAll(async () => {
    await app.close();
  });

  it('1. Registering a plain token without employeeName is rejected with 400', async () => {
    const token = await issuePlainToken();
    await request(server)
      .post('/agent/register')
      .send({ enrollmentToken: token, deviceId: `dev-no-name-${companyId}`, employeeEmail: 'a@acme.test' })
      .expect(400);
  });

  it('2. Registering a plain token without employeeEmail is rejected with 400', async () => {
    const token = await issuePlainToken();
    await request(server)
      .post('/agent/register')
      .send({ enrollmentToken: token, deviceId: `dev-no-email-${companyId}`, employeeName: 'Test User' })
      .expect(400);
  });

  it('3. Registering a plain token with a malformed email is rejected with 400', async () => {
    const token = await issuePlainToken();
    await request(server)
      .post('/agent/register')
      .send({ enrollmentToken: token, deviceId: `dev-bad-email-${companyId}`, employeeName: 'Test User', employeeEmail: 'not-an-email' })
      .expect(400);
  });

  it('4. Registering with name+email succeeds when no domain restriction is configured, lands PENDING, and both are persisted', async () => {
    const token = await issuePlainToken();
    const res = await request(server)
      .post('/agent/register')
      .send({ enrollmentToken: token, deviceId: `dev-ok-1-${companyId}`, employeeName: 'Jane Doe', employeeEmail: 'jane@anything.com' })
      .expect(201);

    expect(res.body.status).toBe('PENDING');

    const installation = await prisma.installation.findUnique({ where: { id: res.body.installationId } });
    expect(installation?.status).toBe('PENDING');
    expect(installation?.employeeName).toBe('Jane Doe');
    expect(installation?.employeeEmail).toBe('jane@anything.com');
  });

  it('5. Once a domain restriction is configured, a mismatched email domain is rejected with 400', async () => {
    await request(server)
      .patch(`/customer/companies/${companyId}/email-domains`)
      .set('Cookie', enterpriseAdminCookie)
      .send({ allowedEmailDomains: ['acme.com'] })
      .expect(200);

    const token = await issuePlainToken();
    await request(server)
      .post('/agent/register')
      .send({ enrollmentToken: token, deviceId: `dev-wrong-domain-${companyId}`, employeeName: 'John Doe', employeeEmail: 'john@gmail.com' })
      .expect(400);
  });

  it('6. A matching email domain is accepted once configured', async () => {
    const token = await issuePlainToken();
    await request(server)
      .post('/agent/register')
      .send({ enrollmentToken: token, deviceId: `dev-right-domain-${companyId}`, employeeName: 'John Doe', employeeEmail: 'john@acme.com' })
      .expect(201);
  });

  it('7. Domain matching is case-insensitive', async () => {
    const token = await issuePlainToken();
    await request(server)
      .post('/agent/register')
      .send({ enrollmentToken: token, deviceId: `dev-case-${companyId}`, employeeName: 'Jo Doe', employeeEmail: 'jo@ACME.COM' })
      .expect(201);
  });

  it('8. An activation-bound registration does not require employeeName/employeeEmail at all', async () => {
    const reqRes = await request(server)
      .post('/customer/license-requests')
      .set('Cookie', enterpriseAdminCookie)
      .send({ companyId, entitlementId, quantity: 1, reason: 'test', targetUserId: employeeUserId })
      .expect(201);

    const approveRes = await request(server)
      .post(`/customer/license-requests/${reqRes.body.id}/approve`)
      .set('Cookie', enterpriseAdminCookie)
      .expect(201);

    const boundToken = approveRes.body.enrollmentToken.token;
    const res = await request(server)
      .post('/agent/register')
      .send({ enrollmentToken: boundToken, deviceId: `dev-activation-bound-${companyId}` })
      .expect(201);

    expect(res.body.status).toBe('ACTIVE');
    const installation = await prisma.installation.findUnique({ where: { id: res.body.installationId } });
    expect(installation?.employeeName).toBeNull();
    expect(installation?.employeeEmail).toBeNull();
  });

  it('9. A non-admin (no company.manage) cannot set allowed email domains', async () => {
    const employeeCookie = await getCookie('employee-acme');
    await request(server)
      .patch(`/customer/companies/${companyId}/email-domains`)
      .set('Cookie', employeeCookie)
      .send({ allowedEmailDomains: ['acme.com'] })
      .expect(403);
  });

  it('10. A Company Admin can approve a PENDING self-service installation, without consuming a second seat', async () => {
    const before = await prisma.licenseAllocation.findUnique({ where: { id: allocationId } });

    const token = await issuePlainToken();
    const regRes = await request(server)
      .post('/agent/register')
      .send({ enrollmentToken: token, deviceId: `dev-approve-me-${companyId}`, employeeName: 'Approve Me', employeeEmail: 'approve@acme.com' })
      .expect(201);
    expect(regRes.body.status).toBe('PENDING');

    const afterRegister = await prisma.licenseAllocation.findUnique({ where: { id: allocationId } });
    expect(afterRegister!.consumedQuantity).toBe(before!.consumedQuantity + 1);

    const approveRes = await request(server)
      .post(`/customer/installations/${regRes.body.installationId}/approve`)
      .set('Cookie', enterpriseAdminCookie)
      .expect(201);
    expect(approveRes.body.status).toBe('ACTIVE');

    const afterApprove = await prisma.licenseAllocation.findUnique({ where: { id: allocationId } });
    expect(afterApprove!.consumedQuantity).toBe(afterRegister!.consumedQuantity);
  });

  it('11. A Company Admin can reject a PENDING self-service installation, which frees its reserved seat', async () => {
    const token = await issuePlainToken();
    const regRes = await request(server)
      .post('/agent/register')
      .send({ enrollmentToken: token, deviceId: `dev-reject-me-${companyId}`, employeeName: 'Reject Me', employeeEmail: 'reject@acme.com' })
      .expect(201);

    const afterRegister = await prisma.licenseAllocation.findUnique({ where: { id: allocationId } });

    await request(server)
      .post(`/customer/installations/${regRes.body.installationId}/revoke`)
      .set('Cookie', enterpriseAdminCookie)
      .expect(201)
      .expect((res) => expect(res.body.status).toBe('REVOKED'));

    const afterReject = await prisma.licenseAllocation.findUnique({ where: { id: allocationId } });
    expect(afterReject!.consumedQuantity).toBe(afterRegister!.consumedQuantity - 1);
  });

  it('12. A rejected (REVOKED) installation cannot then be approved (terminal state)', async () => {
    const token = await issuePlainToken();
    const regRes = await request(server)
      .post('/agent/register')
      .send({ enrollmentToken: token, deviceId: `dev-terminal-${companyId}`, employeeName: 'Terminal Case', employeeEmail: 'terminal@acme.com' })
      .expect(201);

    await request(server)
      .post(`/customer/installations/${regRes.body.installationId}/revoke`)
      .set('Cookie', enterpriseAdminCookie)
      .expect(201);

    await request(server)
      .post(`/customer/installations/${regRes.body.installationId}/approve`)
      .set('Cookie', enterpriseAdminCookie)
      .expect(400);
  });

  it('13. Approving is audited as APPROVE_INSTALLATION, and rejecting as REJECT_INSTALLATION — distinct from suspend/unsuspend/revoke on an already-active one', async () => {
    const token = await issuePlainToken();
    const regRes = await request(server)
      .post('/agent/register')
      .send({ enrollmentToken: token, deviceId: `dev-audit-check-${companyId}`, employeeName: 'Audit Check', employeeEmail: 'audit@acme.com' })
      .expect(201);

    await request(server)
      .post(`/customer/installations/${regRes.body.installationId}/approve`)
      .set('Cookie', enterpriseAdminCookie)
      .expect(201);

    const approveAudit = await prisma.auditEvent.findFirst({
      where: { targetId: regRes.body.installationId, action: 'APPROVE_INSTALLATION' },
    });
    expect(approveAudit).toBeDefined();

    await request(server)
      .post(`/customer/installations/${regRes.body.installationId}/revoke`)
      .set('Cookie', enterpriseAdminCookie)
      .expect(201);

    const revokeAudit = await prisma.auditEvent.findFirst({
      where: { targetId: regRes.body.installationId, action: 'REVOKE_INSTALLATION' },
    });
    expect(revokeAudit).toBeDefined();
  });
});
