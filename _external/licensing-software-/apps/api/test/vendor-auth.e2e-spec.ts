import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from './../src/app.module.js';

// Exercises the real POST /vendor/auth/login path (AuthGuard's
// AUTH_MODE=password branch, vendor URL prefix), not the E2E_SESSION cookie
// override the other e2e specs use.
process.env.AUTH_MODE = 'password';

const VALID_PASSWORD = 'DevPassword!123';
const ACTIVE_EMAIL = 'admin@trustfabric.test';
const DISABLED_EMAIL = 'disabled-admin@trustfabric.test';

describe('Vendor Password Login (e2e)', () => {
  let app: INestApplication;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    const cookieParser = require('cookie-parser');
    app.use(cookieParser());
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it('1. Valid login succeeds and sets a vendor session cookie', async () => {
    const res = await request(app.getHttpServer())
      .post('/vendor/auth/login')
      .send({ email: ACTIVE_EMAIL, password: VALID_PASSWORD })
      .expect(200);

    expect(res.body).toEqual({ status: 'OK' });
    expect(res.headers['set-cookie']).toBeDefined();
    const cookie = res.headers['set-cookie'][0];
    expect(cookie).toContain('HttpOnly');
    // Distinct cookie name from the Customer Portal's session — not TF_SESSION.
    expect(cookie).toContain('TF_VENDOR_SESSION');
  });

  it('2. Invalid password is rejected with a generic message', async () => {
    const res = await request(app.getHttpServer())
      .post('/vendor/auth/login')
      .send({ email: ACTIVE_EMAIL, password: 'not-the-password' })
      .expect(401);

    expect(res.body.message).toBe('Invalid email or password');
  });

  it('3. Invalid email/password combination gives the identical generic message', async () => {
    const res = await request(app.getHttpServer())
      .post('/vendor/auth/login')
      .send({ email: 'nobody-at-all@trustfabric.test', password: 'whatever' })
      .expect(401);

    expect(res.body.message).toBe('Invalid email or password');
  });

  it('4. Inactive vendor user is rejected even with the correct password', async () => {
    const res = await request(app.getHttpServer())
      .post('/vendor/auth/login')
      .send({ email: DISABLED_EMAIL, password: VALID_PASSWORD })
      .expect(401);

    expect(res.body.message).toBe('Invalid email or password');
  });

  it('5. Session creation: the cookie from login authenticates subsequent requests', async () => {
    const loginRes = await request(app.getHttpServer())
      .post('/vendor/auth/login')
      .send({ email: ACTIVE_EMAIL, password: VALID_PASSWORD })
      .expect(200);
    const cookie = loginRes.headers['set-cookie'][0].split(';')[0];

    await request(app.getHttpServer())
      .get('/vendor/auth/me')
      .set('Cookie', cookie)
      .expect(200);
  });

  it('6. Logout clears the session cookie — a real cookie-jar client is logged out', async () => {
    const agent = request.agent(app.getHttpServer());
    await agent.post('/vendor/auth/login').send({ email: ACTIVE_EMAIL, password: VALID_PASSWORD }).expect(200);
    await agent.get('/vendor/auth/me').expect(200);

    await agent.post('/vendor/auth/logout').expect(200);
    await agent.get('/vendor/auth/me').expect(401);
  });

  it('7. /auth/me returns the authenticated vendor principal resolved from the database', async () => {
    const loginRes = await request(app.getHttpServer())
      .post('/vendor/auth/login')
      .send({ email: ACTIVE_EMAIL, password: VALID_PASSWORD })
      .expect(200);
    const cookie = loginRes.headers['set-cookie'][0].split(';')[0];

    const meRes = await request(app.getHttpServer())
      .get('/vendor/auth/me')
      .set('Cookie', cookie)
      .expect(200);

    expect(meRes.body.email).toBe(ACTIVE_EMAIL);
    expect(meRes.body.id).toBe('user-vendor-admin');
    expect(meRes.body.roles).toContain('TrustfabricAdmin');
    expect(meRes.body.allowedCompanyIds).toEqual(['*']);
  });

  it('8. Client-injected roles/permissions/principalType in the login body are ignored', async () => {
    const res = await request(app.getHttpServer())
      .post('/vendor/auth/login')
      .send({
        email: ACTIVE_EMAIL,
        password: VALID_PASSWORD,
        roles: ['SuperAdmin'],
        permissions: ['nuke.everything'],
        principalType: 'CUSTOMER',
      })
      .expect(200);
    const cookie = res.headers['set-cookie'][0].split(';')[0];

    const meRes = await request(app.getHttpServer())
      .get('/vendor/auth/me')
      .set('Cookie', cookie)
      .expect(200);

    expect(meRes.body.roles).toEqual(['TrustfabricAdmin']);
  });

  it('9. Unknown-email and wrong-password failures are indistinguishable to the client', async () => {
    const unknownRes = await request(app.getHttpServer())
      .post('/vendor/auth/login')
      .send({ email: `unknown-${Date.now()}@trustfabric.test`, password: 'x' });
    const wrongPasswordRes = await request(app.getHttpServer())
      .post('/vendor/auth/login')
      .send({ email: ACTIVE_EMAIL, password: 'definitely-wrong' });

    expect(unknownRes.status).toBe(wrongPasswordRes.status);
    expect(unknownRes.body.message).toBe(wrongPasswordRes.body.message);
  });

  it('10. Repeated failed attempts are rate-limited (429)', async () => {
    const email = `ratelimit-vendor-${Date.now()}@trustfabric.test`;
    let sawRateLimit = false;

    for (let i = 0; i < 7; i++) {
      const res = await request(app.getHttpServer())
        .post('/vendor/auth/login')
        .send({ email, password: 'wrong' });
      if (res.status === 429) sawRateLimit = true;
    }

    expect(sawRateLimit).toBe(true);
  });

  it('11. passwordHash never appears in any auth response', async () => {
    const loginRes = await request(app.getHttpServer())
      .post('/vendor/auth/login')
      .send({ email: ACTIVE_EMAIL, password: VALID_PASSWORD })
      .expect(200);
    expect(JSON.stringify(loginRes.body)).not.toMatch(/passwordHash|\$argon2/i);

    const cookie = loginRes.headers['set-cookie'][0].split(';')[0];
    const meRes = await request(app.getHttpServer())
      .get('/vendor/auth/me')
      .set('Cookie', cookie)
      .expect(200);
    expect(JSON.stringify(meRes.body)).not.toMatch(/passwordHash|\$argon2/i);
  });

  it('12. A vendor session cannot reach a customer-only endpoint (principal isolation)', async () => {
    const loginRes = await request(app.getHttpServer())
      .post('/vendor/auth/login')
      .send({ email: ACTIVE_EMAIL, password: VALID_PASSWORD })
      .expect(200);
    const cookie = loginRes.headers['set-cookie'][0].split(';')[0];

    await request(app.getHttpServer())
      .get('/customer/auth/me')
      .set('Cookie', cookie)
      .expect(401); // no TF_SESSION cookie present — vendor cookie doesn't authenticate customer routes
  });

  it('13. A customer session cannot reach /vendor/auth/me (principal isolation)', async () => {
    const loginRes = await request(app.getHttpServer())
      .post('/customer/auth/login')
      .send({ email: 'india-admin@acme.test', password: VALID_PASSWORD })
      .expect(200);
    const cookie = loginRes.headers['set-cookie'][0].split(';')[0];

    await request(app.getHttpServer())
      .get('/vendor/auth/me')
      .set('Cookie', cookie)
      .expect(401); // no TF_VENDOR_SESSION cookie present — customer cookie doesn't authenticate vendor routes
  });

  it('14. A single browser can hold a customer session and a vendor session simultaneously without collision', async () => {
    // Distinct cookie names (TF_SESSION vs TF_VENDOR_SESSION) mean logging
    // into one portal must not clobber or interfere with the other.
    const agent = request.agent(app.getHttpServer());

    await agent.post('/customer/auth/login').send({ email: 'india-admin@acme.test', password: VALID_PASSWORD }).expect(200);
    await agent.post('/vendor/auth/login').send({ email: ACTIVE_EMAIL, password: VALID_PASSWORD }).expect(200);

    const customerMe = await agent.get('/customer/auth/me').expect(200);
    expect(customerMe.body.email).toBe('india-admin@acme.test');

    const vendorMe = await agent.get('/vendor/auth/me').expect(200);
    expect(vendorMe.body.email).toBe(ACTIVE_EMAIL);
  });

  it('No legacy OIDC routes remain exposed', async () => {
    await request(app.getHttpServer()).get('/vendor/auth/callback').expect(404);
  });
});
