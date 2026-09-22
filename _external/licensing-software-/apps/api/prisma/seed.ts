import { PrismaClient } from '@prisma/client';
import argon2 from 'argon2';

const prisma = new PrismaClient();

// Local dev credential only — never a real password. Change immediately if
// this seed is ever pointed at anything beyond a local dev database.
export const DEV_PASSWORD = 'DevPassword!123';

async function main() {
  console.log('Starting DB Seed for Phase 3...');
  const passwordHash = await argon2.hash(DEV_PASSWORD, { type: argon2.argon2id });

  // 1. Enterprises
  const enterpriseA = await prisma.enterprise.upsert({
    where: { id: 'ent-a' },
    update: {},
    create: { id: 'ent-a', name: 'Acme Corporation' }
  });

  const enterpriseB = await prisma.enterprise.upsert({
    where: { id: 'ent-b' },
    update: {},
    create: { id: 'ent-b', name: 'Globex Corporation' }
  });

  // 2. Companies
  const companyA1 = await prisma.company.upsert({
    where: { id: 'company-a1' },
    update: {},
    create: { id: 'company-a1', name: 'Acme India', enterpriseId: enterpriseA.id }
  });

  const companyA2 = await prisma.company.upsert({
    where: { id: 'company-a2' },
    update: {},
    create: { id: 'company-a2', name: 'Acme UK', enterpriseId: enterpriseA.id }
  });

  const companyA3 = await prisma.company.upsert({
    where: { id: 'company-a3' },
    update: {},
    create: { id: 'company-a3', name: 'Acme Germany', enterpriseId: enterpriseA.id }
  });

  const companyB1 = await prisma.company.upsert({
    where: { id: 'company-b1' },
    update: {},
    create: { id: 'company-b1', name: 'Globex India', enterpriseId: enterpriseB.id }
  });

  // 3. Products
  const productA = await prisma.product.upsert({
    where: { id: 'prod-a' },
    update: {},
    create: { id: 'prod-a', name: 'Enterprise Security Suite', description: 'Flagship product' }
  });

  // 4. Entitlements
  const entA = await prisma.entitlement.upsert({
    where: { id: 'entitlement-a' },
    update: {},
    create: {
      id: 'entitlement-a',
      enterpriseId: enterpriseA.id,
      productId: productA.id,
      quantity: 500,
      allocatedQuantity: 450, // Pre-calculated sum
      version: 1,
      startDate: new Date(),
      endDate: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000), // 1 year
      status: 'ACTIVE'
    }
  });

  const entB = await prisma.entitlement.upsert({
    where: { id: 'entitlement-b' },
    update: {},
    create: {
      id: 'entitlement-b',
      enterpriseId: enterpriseB.id,
      productId: productA.id,
      quantity: 100,
      allocatedQuantity: 100,
      version: 1,
      startDate: new Date(),
      endDate: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000), // 1 year
      status: 'ACTIVE'
    }
  });

  // 5. License Allocations
  const allocA1 = await prisma.licenseAllocation.upsert({
    where: { id: 'alloc-a1' },
    update: {},
    create: { id: 'alloc-a1', companyId: companyA1.id, entitlementId: entA.id, quantity: 200, consumedQuantity: 1, status: 'ACTIVE' }
  });

  const allocA2 = await prisma.licenseAllocation.upsert({
    where: { id: 'alloc-a2' },
    update: {},
    create: { id: 'alloc-a2', companyId: companyA2.id, entitlementId: entA.id, quantity: 150, status: 'ACTIVE' }
  });

  const allocA3 = await prisma.licenseAllocation.upsert({
    where: { id: 'alloc-a3' },
    update: {},
    create: { id: 'alloc-a3', companyId: companyA3.id, entitlementId: entA.id, quantity: 100, status: 'ACTIVE' }
  });

  const allocB1 = await prisma.licenseAllocation.upsert({
    where: { id: 'alloc-b1' },
    update: {},
    create: { id: 'alloc-b1', companyId: companyB1.id, entitlementId: entB.id, quantity: 100, consumedQuantity: 1, status: 'ACTIVE' }
  });

  // 6. License Requests
  await prisma.licenseRequest.upsert({
    where: { id: 'req-a1' },
    update: {},
    create: {
      id: 'req-a1',
      enterpriseId: enterpriseA.id,
      companyId: companyA1.id,
      entitlementId: entA.id,
      requestedBy: 'user-a1',
      quantity: 50,
      reason: 'Expansion in India office',
      status: 'PENDING'
    }
  });

  // 7. Installations
  await prisma.installation.upsert({
    where: { id: 'inst-a1' },
    update: {},
    create: { 
      id: 'inst-a1',
      companyId: companyA1.id, 
      allocationId: allocA1.id, 
      deviceId: 'DEVICE-ACME-01',
      hostname: 'acme-server-1',
      os: 'Windows Server 2022',
      status: 'ACTIVE'
    }
  });

  await prisma.installation.upsert({
    where: { id: 'inst-b1' },
    update: {},
    create: { 
      id: 'inst-b1',
      companyId: companyB1.id, 
      allocationId: allocB1.id, 
      deviceId: 'DEVICE-GLOBEX-01',
      hostname: 'globex-db-1',
      os: 'Ubuntu 22.04',
      status: 'ACTIVE'
    }
  });

  // 8. Identity Seeding (Vendor vs Customer)
  console.log('Seeding identities...');
  // id/email match the E2E-mode `vendor-admin` test-fixture identity in
  // e2e-auth.controller.ts, so both auth paths refer to the same person.
  await prisma.vendorUser.upsert({
    where: { email: 'admin@trustfabric.test' },
    update: { passwordHash },
    create: {
      id: 'user-vendor-admin',
      email: 'admin@trustfabric.test',
      name: 'Trustfabric Administrator',
      roles: ['TrustfabricAdmin'],
      passwordHash,
    }
  });

  await prisma.user.upsert({
    where: { email: 'admin@enterprise.com' },
    update: { passwordHash },
    create: {
      id: 'user-1',
      email: 'admin@enterprise.com',
      name: 'Acme Enterprise Admin',
      companyId: companyA1.id, // Primary company association
      passwordHash,
    }
  });

  await prisma.user.upsert({
    where: { email: 'admin@company-a1.com' },
    update: { passwordHash },
    create: {
      id: 'user-2',
      email: 'admin@company-a1.com',
      name: 'Acme India Admin',
      companyId: companyA1.id,
      passwordHash,
    }
  });

  // 9. Roles & Role Assignments — required for the two users above to be
  // able to do anything once logged in via password auth (previously
  // missing: they existed with no permissions at all).
  const enterpriseAdminRole = await prisma.role.upsert({
    where: { id: 'role-a1-enterprise-admin' },
    update: {},
    create: {
      id: 'role-a1-enterprise-admin',
      companyId: companyA1.id,
      name: 'EnterpriseAdmin',
      permissions: ['*'],
    }
  });
  const companyAdminRole = await prisma.role.upsert({
    where: { id: 'role-a1-company-admin' },
    update: {},
    create: {
      id: 'role-a1-company-admin',
      companyId: companyA1.id,
      name: 'CompanyAdmin',
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
    }
  });
  // Prisma's compound-unique `where` can't match a null companyId (NULL != NULL
  // in SQL), so upsert() isn't usable here — find-then-create instead.
  const existingEnterpriseAdminAssignment = await prisma.roleAssignment.findFirst({
    where: { userId: 'user-1', roleId: enterpriseAdminRole.id, companyId: null },
  });
  if (!existingEnterpriseAdminAssignment) {
    await prisma.roleAssignment.create({
      data: { userId: 'user-1', roleId: enterpriseAdminRole.id, companyId: null },
    });
  }
  await prisma.roleAssignment.upsert({
    where: { userId_roleId_companyId: { userId: 'user-2', roleId: companyAdminRole.id, companyId: companyA1.id } },
    update: {},
    create: { userId: 'user-2', roleId: companyAdminRole.id, companyId: companyA1.id },
  });

  console.log('Seed completed successfully for Phase 4B.');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
