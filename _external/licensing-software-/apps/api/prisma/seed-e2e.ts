import { PrismaClient } from '@prisma/client';
import argon2 from 'argon2';

const prisma = new PrismaClient();

// Local dev/test credential only — never a real password, never used outside
// this seed fixture. See docs/security-model.md for the full disclosure.
export const DEV_TEST_PASSWORD = 'DevPassword!123';

async function main() {
  console.log('Seeding E2E database...');
  const passwordHash = await argon2.hash(DEV_TEST_PASSWORD, { type: argon2.argon2id });

  // Reset in dependency order. Activation and Installation hold FKs to EACH
  // OTHER (Activation.installationId = current live link, Installation.activationId
  // = immutable provenance) — neither table's rows can be deleted while the
  // other cycle edge still points at them, so the Activation -> Installation
  // edge is nulled out first to break the cycle before either table is cleared.
  await prisma.activation.updateMany({ data: { installationId: null } });
  await prisma.auditEvent.deleteMany();
  await prisma.installation.deleteMany();
  await prisma.enrollmentToken.deleteMany();
  await prisma.activation.deleteMany();
  await prisma.licenseAllocation.deleteMany();
  await prisma.licenseRequest.deleteMany();
  await prisma.entitlement.deleteMany();
  await prisma.feature.deleteMany();
  await prisma.edition.deleteMany();
  await prisma.product.deleteMany();
  await prisma.externalIdentity.deleteMany();
  await prisma.roleAssignment.deleteMany();
  await prisma.invitation.deleteMany();
  await prisma.user.deleteMany();
  await prisma.role.deleteMany();
  await prisma.company.deleteMany();
  await prisma.enterprise.deleteMany();
  await prisma.vendorUser.deleteMany();

  // ─── 1. Products ────────────────────────────────────────────────────────────
  const product = await prisma.product.create({
    data: {
      id:          'prod-sec-1',
      name:        'Enterprise Security Suite',
      description: 'Complete security platform',
    },
  });

  // ─── 2. Enterprises ─────────────────────────────────────────────────────────
  const acmeEnterprise = await prisma.enterprise.create({
    data: { id: 'ent-acme', name: 'Acme Corporation' },
  });
  const globexEnterprise = await prisma.enterprise.create({
    data: { id: 'ent-globex', name: 'Globex Corporation' },
  });

  // ─── 3. Companies ───────────────────────────────────────────────────────────
  const acmeIndia = await prisma.company.create({
    data: { id: 'comp-acme-in', name: 'Acme India', enterpriseId: acmeEnterprise.id },
  });
  const acmeUK = await prisma.company.create({
    data: { id: 'comp-acme-uk', name: 'Acme UK', enterpriseId: acmeEnterprise.id },
  });
  const acmeGermany = await prisma.company.create({
    data: { id: 'comp-acme-de', name: 'Acme Germany', enterpriseId: acmeEnterprise.id },
  });
  const globexIndia = await prisma.company.create({
    data: { id: 'comp-globex-in', name: 'Globex India', enterpriseId: globexEnterprise.id },
  });

  // ─── 4. Roles (per company — permissions match PermissionsGuard logic) ──────
  const acmeEnterpriseAdminRole = await prisma.role.create({
    data: {
      id:          'role-acme-enterprise-admin',
      companyId:   acmeIndia.id,  // owned by the root company
      name:        'EnterpriseAdmin',
      permissions: ['*'],
    },
  });
  const acmeCompanyAdminRole = await prisma.role.create({
    data: {
      id:          'role-acme-company-admin',
      companyId:   acmeIndia.id,
      name:        'CompanyAdmin',
      permissions: [
        'company.read', 'company.manage',
        'user.read', 'user.manage',
        'entitlement.read',
        'license.read', 'license.allocate', 'license.suspend', 'license.revoke',
        'installation.read', 'installation.manage', 'installation.enroll',
        'license_request.read', 'license_request.create',
        'license_request.approve', 'license_request.reject', 'license_request.cancel',
        'activation.read', 'activation.manage',
        'audit.read',
      ],
    },
  });
  const acmeUserRole = await prisma.role.create({
    data: {
      id:          'role-acme-user',
      companyId:   acmeIndia.id,
      name:        'User',
      permissions: ['license.read'],
    },
  });
  const globexCompanyAdminRole = await prisma.role.create({
    data: {
      id:          'role-globex-company-admin',
      companyId:   globexIndia.id,
      name:        'CompanyAdmin',
      permissions: [
        'company.read', 'company.manage',
        'user.read', 'user.manage',
        'entitlement.read',
        'license.read', 'license.allocate', 'license.suspend', 'license.revoke',
        'installation.read', 'installation.manage', 'installation.enroll',
        'license_request.read', 'license_request.create',
        'license_request.approve', 'license_request.reject', 'license_request.cancel',
        'activation.read', 'activation.manage',
        'audit.read',
      ],
    },
  });

  // ─── 5. Users ───────────────────────────────────────────────────────────────
  // All seeded users share DEV_TEST_PASSWORD above — local dev/test only.
  const acmeAdmin = await prisma.user.create({
    data: { id: 'user-acme-admin', email: 'admin@acme.test', name: 'Acme Admin', companyId: acmeIndia.id, passwordHash },
  });
  const acmeInAdmin = await prisma.user.create({
    data: { id: 'user-acme-in-admin', email: 'india-admin@acme.test', name: 'Acme India Admin', companyId: acmeIndia.id, passwordHash },
  });
  const acmeEmployee = await prisma.user.create({
    data: { id: 'user-acme-employee', email: 'employee@acme.test', name: 'Acme Employee', companyId: acmeIndia.id, passwordHash },
  });
  const globexAdmin = await prisma.user.create({
    data: { id: 'user-globex-admin', email: 'admin@globex.test', name: 'Globex Admin', companyId: globexIndia.id, passwordHash },
  });
  // Inactive account fixture — for password-login "inactive user rejected" tests.
  const acmeDisabledAdmin = await prisma.user.create({
    data: {
      id: 'user-acme-disabled-admin',
      email: 'disabled-admin@acme.test',
      name: 'Acme Disabled Admin',
      companyId: acmeIndia.id,
      passwordHash,
      isActive: false,
    },
  });

  // ─── 5b. Vendor Users ───────────────────────────────────────────────────────
  // id/email match the E2E-mode `vendor-admin` test-fixture identity in
  // e2e-auth.controller.ts, so both auth paths refer to the same person.
  await prisma.vendorUser.create({
    data: {
      id: 'user-vendor-admin',
      email: 'admin@trustfabric.test',
      name: 'Trustfabric Administrator',
      roles: ['TrustfabricAdmin'],
      passwordHash,
    },
  });
  // Inactive vendor account fixture — for password-login "inactive user rejected" tests.
  await prisma.vendorUser.create({
    data: {
      id: 'user-vendor-disabled',
      email: 'disabled-admin@trustfabric.test',
      name: 'Disabled Trustfabric Administrator',
      roles: ['TrustfabricAdmin'],
      passwordHash,
      isActive: false,
    },
  });

  // ─── 6. Role Assignments ────────────────────────────────────────────────────
  // Enterprise Admin — companyId=null means enterprise-wide scope
  await prisma.roleAssignment.create({
    data: { userId: acmeAdmin.id, roleId: acmeEnterpriseAdminRole.id, companyId: null },
  });
  // Company Admin — scoped to Acme India
  await prisma.roleAssignment.create({
    data: { userId: acmeInAdmin.id, roleId: acmeCompanyAdminRole.id, companyId: acmeIndia.id },
  });
  // Regular user — scoped to Acme India
  await prisma.roleAssignment.create({
    data: { userId: acmeEmployee.id, roleId: acmeUserRole.id, companyId: acmeIndia.id },
  });
  // Globex Company Admin
  await prisma.roleAssignment.create({
    data: { userId: globexAdmin.id, roleId: globexCompanyAdminRole.id, companyId: globexIndia.id },
  });
  // Disabled Company Admin — role assignment exists, but login must still be rejected
  await prisma.roleAssignment.create({
    data: { userId: acmeDisabledAdmin.id, roleId: acmeCompanyAdminRole.id, companyId: acmeIndia.id },
  });

  // ─── 7. Entitlements ────────────────────────────────────────────────────────
  const acmeEntitlement = await prisma.entitlement.create({
    data: {
      id:                'entit-acme-1',
      enterpriseId:      acmeEnterprise.id,
      productId:         product.id,
      quantity:          500,
      allocatedQuantity: 300,
      status:            'ACTIVE',
      startDate:         new Date(),
      endDate:           new Date(new Date().setFullYear(new Date().getFullYear() + 1)),
    },
  });
  const globexEntitlement = await prisma.entitlement.create({
    data: {
      id:                'entit-globex-1',
      enterpriseId:      globexEnterprise.id,
      productId:         product.id,
      quantity:          100,
      allocatedQuantity: 50,
      status:            'ACTIVE',
      startDate:         new Date(),
      endDate:           new Date(new Date().setFullYear(new Date().getFullYear() + 1)),
    },
  });

  // ─── 8. License Allocations ─────────────────────────────────────────────────
  const allocAcmeIn = await prisma.licenseAllocation.create({
    data: { id: 'alloc-acme-in', companyId: acmeIndia.id, entitlementId: acmeEntitlement.id, quantity: 200, consumedQuantity: 1, status: 'ACTIVE' },
  });
  const allocAcmeUK = await prisma.licenseAllocation.create({
    data: { id: 'alloc-acme-uk', companyId: acmeUK.id, entitlementId: acmeEntitlement.id, quantity: 100, status: 'ACTIVE' },
  });
  const allocGlobexIn = await prisma.licenseAllocation.create({
    data: { id: 'alloc-globex-in', companyId: globexIndia.id, entitlementId: globexEntitlement.id, quantity: 50, consumedQuantity: 1, status: 'ACTIVE' },
  });

  // ─── 9. Installations ──────────────────────────────────────────────────────
  await prisma.installation.create({
    data: {
      companyId:       acmeIndia.id,
      allocationId:    allocAcmeIn.id,
      deviceId:        'dev-123',
      hostname:        'laptop-in-01',
      os:              'Windows 11',
      agentVersion:    '1.0.0',
      status:          'ACTIVE',
      lastHeartbeatAt: new Date(),
    },
  });
  await prisma.installation.create({
    data: {
      companyId:       globexIndia.id,
      allocationId:    allocGlobexIn.id,
      deviceId:        'dev-456',
      hostname:        'server-gl-01',
      os:              'Ubuntu 22.04',
      agentVersion:    '1.0.0',
      status:          'ACTIVE',
      lastHeartbeatAt: new Date(),
    },
  });

  // ─── 10. License Requests ────────────────────────────────────────────────────
  // Pending — Acme India requests 10 seats (approve/reject tests)
  await prisma.licenseRequest.create({
    data: {
      id:            'req-acme-pending-1',
      enterpriseId:  acmeEnterprise.id,
      companyId:     acmeIndia.id,
      entitlementId: acmeEntitlement.id,
      requestedBy:   acmeEmployee.id,
      quantity:      10,
      reason:        'New hire onboarding batch Q1',
      status:        'PENDING',
    },
  });

  // Pending — Acme UK requests 50 seats (concurrency / capacity tests)
  await prisma.licenseRequest.create({
    data: {
      id:            'req-acme-pending-2',
      enterpriseId:  acmeEnterprise.id,
      companyId:     acmeUK.id,
      entitlementId: acmeEntitlement.id,
      requestedBy:   acmeEmployee.id,
      quantity:      50,
      reason:        'UK expansion project',
      status:        'PENDING',
    },
  });

  // Historical — already APPROVED
  await prisma.licenseRequest.create({
    data: {
      id:            'req-acme-approved-1',
      enterpriseId:  acmeEnterprise.id,
      companyId:     acmeIndia.id,
      entitlementId: acmeEntitlement.id,
      requestedBy:   acmeEmployee.id,
      quantity:      5,
      reason:        'Security team expansion',
      status:        'APPROVED',
      reviewedBy:    acmeAdmin.id,
      reviewedAt:    new Date(),
    },
  });

  // Historical — REJECTED with reason
  await prisma.licenseRequest.create({
    data: {
      id:            'req-acme-rejected-1',
      enterpriseId:  acmeEnterprise.id,
      companyId:     acmeIndia.id,
      entitlementId: acmeEntitlement.id,
      requestedBy:   acmeEmployee.id,
      quantity:      100,
      reason:        'Full department rollout',
      status:        'REJECTED',
      reviewedBy:    acmeAdmin.id,
      reviewedAt:    new Date(),
      reviewReason:  'Insufficient enterprise capacity at this time. Resubmit in Q2.',
    },
  });

  // Globex pending — used for cross-enterprise IDOR tests
  await prisma.licenseRequest.create({
    data: {
      id:            'req-globex-pending-1',
      enterpriseId:  globexEnterprise.id,
      companyId:     globexIndia.id,
      entitlementId: globexEntitlement.id,
      requestedBy:   globexAdmin.id,
      quantity:      5,
      reason:        'Globex new deployment',
      status:        'PENDING',
    },
  });

  console.log('E2E database seeded successfully.');

}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
