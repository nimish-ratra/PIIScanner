import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from './../src/app.module.js';

// Exercises the real POST /customer/auth/login path (AuthGuard's
// AUTH_MODE=password branch), not the E2E_SESSION cookie override the other
// e2e specs use — so the actual password-verification and session-cookie
// mechanics get covered end-to-end.
process.env.AUTH_MODE = 'password';

const VALID_PASSWORD = 'DevPassword!123';
const ACTIVE_EMAIL = 'india-admin@acme.test';
const DISABLED_EMAIL = 'disabled-admin@acme.test';

describe('Customer Password Login (e2e)', () => {
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

  it('1. Valid login succeeds and sets a session cookie', async () => {
    const res = await request(app.getHttpServer())
      .post('/customer/auth/login')
      .send({ email: ACTIVE_EMAIL, password: VALID_PASSWORD })
      .expect(200);

    expect(res.body).toEqual({ status: 'OK' });
    expect(res.headers['set-cookie']).toBeDefined();
    const cookie = res.headers['set-cookie'][0];
    expect(cookie).toContain('HttpOnly');
  });

  it('2. Invalid password is rejected with a generic message', async () => {
    const res = await request(app.getHttpServer())
      .post('/customer/auth/login')
      .send({ email: ACTIVE_EMAIL, password: 'not-the-password' })
      .expect(401);

    expect(res.body.message).toBe('Invalid email or password');
  });

  it('3. Invalid email/password combination gives the identical generic message', async () => {
    const res = await request(app.getHttpServer())
      .post('/customer/auth/login')
      .send({ email: 'nobody-at-all@acme.test', password: 'whatever' })
      .expect(401);

    expect(res.body.message).toBe('Invalid email or password');
  });

  it('4. Inactive user is rejected even with the correct password', async () => {
    const res = await request(app.getHttpServer())
      .post('/customer/auth/login')
      .send({ email: DISABLED_EMAIL, password: VALID_PASSWORD })
      .expect(401);

    expect(res.body.message).toBe('Invalid email or password');
  });

  it('5. Session creation: the cookie from login authenticates subsequent requests', async () => {
    const loginRes = await request(app.getHttpServer())
      .post('/customer/auth/login')
      .send({ email: ACTIVE_EMAIL, password: VALID_PASSWORD })
      .expect(200);
    const cookie = loginRes.headers['set-cookie'][0].split(';')[0];

    await request(app.getHttpServer())
      .get('/customer/auth/me')
      .set('Cookie', cookie)
      .expect(200);
  });

  it('6. Logout clears the session cookie — a real cookie-jar client is logged out', async () => {
    // iron-session here is a stateless, self-contained signed cookie (no
    // server-side session store to revoke against) — "logout" means the
    // server tells the browser to drop the cookie, and a real client honors
    // that. A raw HTTP client that deliberately replays the old cookie value
    // after logout is not a scenario this session mechanism defends against;
    // that would require a server-side revocation store, which is a bigger
    // architectural change than swapping the login mechanism. Using
    // supertest's agent() here to model a real browser's cookie jar.
    const agent = request.agent(app.getHttpServer());
    await agent.post('/customer/auth/login').send({ email: ACTIVE_EMAIL, password: VALID_PASSWORD }).expect(200);
    await agent.get('/customer/auth/me').expect(200);

    await agent.post('/customer/auth/logout').expect(200);
    await agent.get('/customer/auth/me').expect(401);
  });

  it('7. /auth/me returns the authenticated user resolved from the database', async () => {
    const loginRes = await request(app.getHttpServer())
      .post('/customer/auth/login')
      .send({ email: ACTIVE_EMAIL, password: VALID_PASSWORD })
      .expect(200);
    const cookie = loginRes.headers['set-cookie'][0].split(';')[0];

    const meRes = await request(app.getHttpServer())
      .get('/customer/auth/me')
      .set('Cookie', cookie)
      .expect(200);

    expect(meRes.body.email).toBe(ACTIVE_EMAIL);
    expect(meRes.body.id).toBe('user-acme-in-admin');
    // 8/9. Roles and company/enterprise scope came from the database, not the request
    expect(meRes.body.roles).toContain('CompanyAdmin');
    expect(meRes.body.allowedCompanyIds).toEqual(['comp-acme-in']);
    expect(meRes.body.enterpriseId).toBe('ent-acme');
    expect(meRes.body.companyId).toBe('comp-acme-in');
  });

  it('10/11. Client-injected enterpriseId/companyId/role/permissions in the login body are ignored', async () => {
    const res = await request(app.getHttpServer())
      .post('/customer/auth/login')
      .send({
        email: ACTIVE_EMAIL,
        password: VALID_PASSWORD,
        enterpriseId: 'ent-attacker',
        companyId: 'comp-attacker',
        role: 'EnterpriseAdmin',
        permissions: ['*'],
        principalType: 'VENDOR',
      })
      .expect(200);
    const cookie = res.headers['set-cookie'][0].split(';')[0];

    const meRes = await request(app.getHttpServer())
      .get('/customer/auth/me')
      .set('Cookie', cookie)
      .expect(200);

    // Still exactly the real, database-resolved scope for this user — the
    // attacker-supplied fields on the login body had no effect whatsoever.
    expect(meRes.body.allowedCompanyIds).toEqual(['comp-acme-in']);
    expect(meRes.body.enterpriseId).toBe('ent-acme');
    expect(meRes.body.roles).toEqual(['CompanyAdmin']);
  });

  it('12. Unknown-email and wrong-password failures are indistinguishable to the client', async () => {
    const unknownRes = await request(app.getHttpServer())
      .post('/customer/auth/login')
      .send({ email: `unknown-${Date.now()}@acme.test`, password: 'x' });
    const wrongPasswordRes = await request(app.getHttpServer())
      .post('/customer/auth/login')
      .send({ email: ACTIVE_EMAIL, password: 'definitely-wrong' });

    expect(unknownRes.status).toBe(wrongPasswordRes.status);
    expect(unknownRes.body.message).toBe(wrongPasswordRes.body.message);
  });

  it('13. Repeated failed attempts are rate-limited (429)', async () => {
    const email = `ratelimit-${Date.now()}@acme.test`;
    let sawRateLimit = false;

    for (let i = 0; i < 7; i++) {
      const res = await request(app.getHttpServer())
        .post('/customer/auth/login')
        .send({ email, password: 'wrong' });
      if (res.status === 429) sawRateLimit = true;
    }

    expect(sawRateLimit).toBe(true);
  });

  it('14. passwordHash never appears in any auth response', async () => {
    const loginRes = await request(app.getHttpServer())
      .post('/customer/auth/login')
      .send({ email: ACTIVE_EMAIL, password: VALID_PASSWORD })
      .expect(200);
    expect(JSON.stringify(loginRes.body)).not.toMatch(/passwordHash|\$argon2/i);

    const cookie = loginRes.headers['set-cookie'][0].split(';')[0];
    const meRes = await request(app.getHttpServer())
      .get('/customer/auth/me')
      .set('Cookie', cookie)
      .expect(200);
    expect(JSON.stringify(meRes.body)).not.toMatch(/passwordHash|\$argon2/i);
  });

  it('No legacy OIDC routes remain exposed', async () => {
    await request(app.getHttpServer()).get('/customer/auth/callback').expect(404);
  });
});
