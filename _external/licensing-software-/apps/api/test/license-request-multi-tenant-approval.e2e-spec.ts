import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from './../src/app.module.js';
import { PrismaService } from '../src/prisma/prisma.service.js';

describe('License Request Approval — Multi-Tenant Capacity Rule (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let server: any;

  let enterpriseAdminCookie: string;
  let companyAdminCookie: string;
  let entitlementId: string;

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

    enterpriseAdminCookie = await getCookie('enterprise-admin-acme');
    // Genuinely company-scoped (allowedCompanyIds: ['comp-acme-in']), unlike
    // enterpriseAdminCookie's wildcard scope — exactly the contrast this
    // rule depends on.
    companyAdminCookie = await getCookie('company-admin-acme-india');

    // A dedicated entitlement, isolated from other e2e files' shared
    // entit-acme-1 fixture (exhausted from accumulated test runs today).
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
  });

  afterAll(async () => {
    await app.close();
  });

  it('1. A company-scoped admin cannot approve a capacity request for their OWN company', async () => {
    const reqRes = await request(server)
      .post('/customer/license-requests')
      .set('Cookie', enterpriseAdminCookie)
      .send({ companyId: 'comp-acme-in', entitlementId, quantity: 5, reason: 'capacity test' })
      .expect(201);

    await request(server)
      .post(`/customer/license-requests/${reqRes.body.id}/approve`)
      .set('Cookie', companyAdminCookie)
      .expect(403);
  });

  it('2. An enterprise-scoped admin CAN approve that same capacity request', async () => {
    const reqRes = await request(server)
      .post('/customer/license-requests')
      .set('Cookie', enterpriseAdminCookie)
      .send({ companyId: 'comp-acme-in', entitlementId, quantity: 5, reason: 'capacity test 2' })
      .expect(201);

    const approveRes = await request(server)
      .post(`/customer/license-requests/${reqRes.body.id}/approve`)
      .set('Cookie', enterpriseAdminCookie)
      .expect(201);
    expect(approveRes.body.status).toBe('APPROVED');
  });

  it('3. A company-scoped admin CAN still approve a NAMED request for their own company (unaffected)', async () => {
    const namedReq = await request(server)
      .post('/customer/license-requests')
      .set('Cookie', companyAdminCookie)
      .send({ companyId: 'comp-acme-in', entitlementId, quantity: 1, reason: 'named self', targetUserId: 'user-acme-employee' })
      .expect(201);

    await request(server)
      .post(`/customer/license-requests/${namedReq.body.id}/approve`)
      .set('Cookie', companyAdminCookie)
      .expect(201)
      .expect((res) => expect(res.body.status).toBe('APPROVED'));
  });
});
