import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from './../src/app.module.js';

describe('Phase 4B Architecture Boundaries (e2e)', () => {
  let app: INestApplication;
  
  let vendorAdminCookie: string;
  let enterpriseAdminCookie: string;
  let companyAdminCookie: string;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    const cookieParser = require('cookie-parser');
    app.use(cookieParser());
    await app.init();
    
    const resVendor = await request(app.getHttpServer())
      .post('/customer/auth/e2e/session')
      .send({ testIdentity: 'vendor-admin' });
    vendorAdminCookie = resVendor.headers['set-cookie'][0].split(';')[0];
    
    const resEnterprise = await request(app.getHttpServer())
      .post('/customer/auth/e2e/session')
      .send({ testIdentity: 'enterprise-admin-acme' });
    enterpriseAdminCookie = resEnterprise.headers['set-cookie'][0].split(';')[0];
    
    const resCompany = await request(app.getHttpServer())
      .post('/customer/auth/e2e/session')
      .send({ testIdentity: 'company-admin-acme-india' });
    companyAdminCookie = resCompany.headers['set-cookie'][0].split(';')[0];
  });

  afterAll(async () => {
    await app.close();
  });

  describe('Security: Principal Isolation', () => {
    it('Vendor Admin CAN access vendor APIs', () => {
      return request(app.getHttpServer())
        .get('/vendor/entitlements/entit-acme-1') // use a real seed ID if possible, or expect 404 instead of 401
        .set('Cookie', vendorAdminCookie)
        .expect(200);
    });

    it('Customer Admin CANNOT access vendor APIs -> 403 Forbidden', () => {
      return request(app.getHttpServer())
        .get('/vendor/entitlements/entit-acme-1')
        .set('Cookie', enterpriseAdminCookie)
        .expect(403)
        .expect(res => expect(res.body.message).toContain('Vendor access required'));
    });

    it('Customer Admin CAN access customer APIs', () => {
      return request(app.getHttpServer())
        .get('/customer/licenses')
        .set('Cookie', enterpriseAdminCookie)
        .expect(200);
    });

    it('Vendor Admin CANNOT access customer APIs -> 403 Forbidden', () => {
      return request(app.getHttpServer())
        .get('/customer/licenses')
        .set('Cookie', vendorAdminCookie)
        .expect(403)
        .expect(res => expect(res.body.message).toContain('Customer access required'));
    });
  });

  describe('Tenant & IDOR Security', () => {
    it('Company Admin cannot allocate from an entitlement belonging to a different Enterprise', () => {
      return request(app.getHttpServer())
        .post('/customer/licenses/allocate')
        .set('Cookie', companyAdminCookie) // acme india
        .send({ entitlementId: 'entit-globex-1', companyId: 'comp-acme-in', quantity: 10 })
        .expect(400);
    });
  });

});
