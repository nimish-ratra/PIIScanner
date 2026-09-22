import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from './../src/app.module.js';
import { PrismaService } from '../src/prisma/prisma.service.js';

describe('Entitlement Date-Based Expiry (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let server: any;

  let enterpriseAdminCookie: string;
  let companyId: string;

  const getCookie = async (identity: string) => {
    const res = await request(server).post('/customer/auth/e2e/session').send({ testIdentity: identity });
    return res.headers['set-cookie'][0].split(';')[0];
  };

  async function createEntitlement(endDate: Date) {
    return prisma.entitlement.create({
      data: {
        enterpriseId: 'ent-acme',
        productId: 'prod-sec-1',
        quantity: 50,
        startDate: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000),
        endDate,
        status: 'ACTIVE',
      },
    });
  }

  const futureDate = () => new Date(Date.now() + 365 * 24 * 60 * 60 * 1000);
  const pastDate = () => new Date(Date.now() - 24 * 60 * 60 * 1000);

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

    const company = await prisma.company.create({
      data: { name: 'Entitlement Expiry Test Co', enterpriseId: 'ent-acme' },
    });
    companyId = company.id;
  });

  afterAll(async () => {
    await app.close();
  });

  it('1. Allocating from an entitlement whose end date has already passed is rejected', async () => {
    const entitlement = await createEntitlement(pastDate());

    await request(server)
      .post('/customer/licenses/allocate')
      .set('Cookie', enterpriseAdminCookie)
      .send({ entitlementId: entitlement.id, companyId, quantity: 5 })
      .expect(400)
      .expect((res) => expect(res.body.message).toContain('end date has passed'));
  });

  it('2. Registering a NEW device is rejected once the entitlement backing its allocation has expired', async () => {
    // Allocate while still valid...
    const entitlement = await createEntitlement(futureDate());
    const allocRes = await request(server)
      .post('/customer/licenses/allocate')
      .set('Cookie', enterpriseAdminCookie)
      .send({ entitlementId: entitlement.id, companyId, quantity: 5 })
      .expect(201);

    const tokenRes = await request(server)
      .post(`/customer/companies/${companyId}/enrollment-tokens`)
      .set('Cookie', enterpriseAdminCookie)
      .send({ allocationId: allocRes.body.id })
      .expect(201);

    // ...then the contract ends (simulating time passing) before the device
    // ever gets around to redeeming its already-issued token.
    await prisma.entitlement.update({ where: { id: entitlement.id }, data: { endDate: pastDate() } });

    await request(server)
      .post('/agent/register')
      .send({ enrollmentToken: tokenRes.body.token, deviceId: `dev-expired-entitlement-${companyId}`, employeeName: 'Late Comer', employeeEmail: 'late@anything.com' })
      .expect(400)
      .expect((res) => expect(res.body.message).toContain('entitlement backing this allocation has expired'));
  });

  it('3. An already-ACTIVE installation is reported revoked on its next heartbeat once the entitlement expires', async () => {
    const entitlement = await createEntitlement(futureDate());
    const allocRes = await request(server)
      .post('/customer/licenses/allocate')
      .set('Cookie', enterpriseAdminCookie)
      .send({ entitlementId: entitlement.id, companyId, quantity: 5 })
      .expect(201);
    const tokenRes = await request(server)
      .post(`/customer/companies/${companyId}/enrollment-tokens`)
      .set('Cookie', enterpriseAdminCookie)
      .send({ allocationId: allocRes.body.id })
      .expect(201);

    const regRes = await request(server)
      .post('/agent/register')
      .send({ enrollmentToken: tokenRes.body.token, deviceId: `dev-still-valid-${companyId}`, employeeName: 'Still Valid', employeeEmail: 'valid@anything.com' })
      .expect(201);

    // While still within the contract period, heartbeat reports fine (once approved).
    await request(server)
      .post(`/customer/installations/${regRes.body.installationId}/approve`)
      .set('Cookie', enterpriseAdminCookie)
      .expect(201);

    const credential = regRes.body.credential;
    const okRes = await request(server)
      .post('/agent/heartbeat')
      .set('Authorization', `Bearer ${credential}`)
      .send({})
      .expect(201);
    expect(okRes.body.revoked).toBe(false);

    // Contract ends...
    await prisma.entitlement.update({ where: { id: entitlement.id }, data: { endDate: pastDate() } });

    const expiredRes = await request(server)
      .post('/agent/heartbeat')
      .set('Authorization', `Bearer ${credential}`)
      .send({})
      .expect(201);
    expect(expiredRes.body.revoked).toBe(true);
  });

  it('4. Extending an entitlement past its expiry correctly un-revokes an already-installed agent on its next heartbeat', async () => {
    const entitlement = await createEntitlement(futureDate());
    const allocRes = await request(server)
      .post('/customer/licenses/allocate')
      .set('Cookie', enterpriseAdminCookie)
      .send({ entitlementId: entitlement.id, companyId, quantity: 5 })
      .expect(201);
    const tokenRes = await request(server)
      .post(`/customer/companies/${companyId}/enrollment-tokens`)
      .set('Cookie', enterpriseAdminCookie)
      .send({ allocationId: allocRes.body.id })
      .expect(201);
    const regRes = await request(server)
      .post('/agent/register')
      .send({ enrollmentToken: tokenRes.body.token, deviceId: `dev-extend-me-${companyId}`, employeeName: 'Extend Me', employeeEmail: 'extend@anything.com' })
      .expect(201);
    await request(server)
      .post(`/customer/installations/${regRes.body.installationId}/approve`)
      .set('Cookie', enterpriseAdminCookie)
      .expect(201);

    const credential = regRes.body.credential;

    // Contract lapses...
    await prisma.entitlement.update({ where: { id: entitlement.id }, data: { endDate: pastDate() } });
    const lapsedRes = await request(server)
      .post('/agent/heartbeat')
      .set('Authorization', `Bearer ${credential}`)
      .send({})
      .expect(201);
    expect(lapsedRes.body.revoked).toBe(true);

    // ...then gets renewed.
    await prisma.entitlement.update({ where: { id: entitlement.id }, data: { endDate: futureDate() } });
    const renewedRes = await request(server)
      .post('/agent/heartbeat')
      .set('Authorization', `Bearer ${credential}`)
      .send({})
      .expect(201);
    expect(renewedRes.body.revoked).toBe(false);
  });
});
