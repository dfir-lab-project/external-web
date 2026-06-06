/**
 * Seed internal demo data for the WAS01 -> DB01 MongoDB lab setup.
 *
 * Usage:
 *   npm run seed:internal-demo
 *
 * Requires DATABASE_URL to point to DB01 MongoDB.
 */

import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";

const prisma = new PrismaClient();

const PASSWORD = "12345678";
const now = () => new Date();

async function upsertUser(input: {
  email: string;
  name: string;
  username: string;
  role: string;
  googleId: string;
}) {
  const password = await bcrypt.hash(PASSWORD, 10);

  return prisma.user.upsert({
    where: { email: input.email },
    update: {
      name: input.name,
      username: input.username,
      role: input.role,
      updatedAt: now(),
    },
    create: {
      email: input.email,
      name: input.name,
      username: input.username,
      role: input.role,
      googleId: input.googleId,
      password,
      createdAt: now(),
    },
  });
}

async function ensureCategory(userId: string, name: string, description: string) {
  const existing = await prisma.category.findFirst({ where: { userId, name } });
  if (existing) return existing;

  return prisma.category.create({
    data: {
      name,
      description,
      status: true,
      notes: "Internal lab seed data",
      userId,
      createdBy: userId,
      createdAt: now(),
    },
  });
}

async function ensureSupplier(userId: string, name: string, description: string) {
  const existing = await prisma.supplier.findFirst({ where: { userId, name } });
  if (existing) return existing;

  return prisma.supplier.create({
    data: {
      name,
      description,
      status: true,
      notes: "Internal lab seed data",
      userId,
      createdBy: userId,
      createdAt: now(),
    },
  });
}

async function ensureWarehouse(userId: string, name: string, address: string) {
  const existing = await prisma.warehouse.findFirst({ where: { userId, name } });
  if (existing) return existing;

  return prisma.warehouse.create({
    data: {
      name,
      address,
      type: "main",
      status: true,
      userId,
      createdBy: userId,
      createdAt: now(),
    },
  });
}

async function main() {
  console.log("\nSeeding internal demo data for DB01 MongoDB...\n");

  const admin = await upsertUser({
    email: "admin@stockly.internal",
    name: "Internal Admin",
    username: "internaladmin",
    role: "admin",
    googleId: "internal-admin-seed",
  });

  const client = await upsertUser({
    email: "client@stockly.internal",
    name: "Internal Client",
    username: "internalclient",
    role: "client",
    googleId: "internal-client-seed",
  });

  const supplierUser = await upsertUser({
    email: "supplier@stockly.internal",
    name: "Internal Supplier",
    username: "internalsupplier",
    role: "supplier",
    googleId: "internal-supplier-seed",
  });

  const categories = await Promise.all([
    ensureCategory(admin.id, "Network Equipment", "Routers, switches, and firewall appliances."),
    ensureCategory(admin.id, "Server Parts", "Memory, storage, and server replacement parts."),
    ensureCategory(admin.id, "Office Devices", "User endpoint and office inventory."),
  ]);

  const suppliers = await Promise.all([
    ensureSupplier(supplierUser.id, "Internal Infrastructure Supplier", "Primary internal lab supplier."),
    ensureSupplier(admin.id, "Secure Hardware Partner", "Approved hardware supplier for infra operations."),
  ]);

  const warehouse = await ensureWarehouse(admin.id, "Internal Server Zone Warehouse", "Internal Server Zone / DB01 adjacent storage");

  const products = [
    {
      sku: "NET-FW-001",
      name: "pfSense Appliance Spare",
      price: 450,
      quantity: 8n,
      status: "available",
      categoryId: categories[0].id,
      supplierId: suppliers[0].id,
    },
    {
      sku: "SRV-SSD-002",
      name: "Enterprise SSD 1TB",
      price: 180,
      quantity: 24n,
      status: "available",
      categoryId: categories[1].id,
      supplierId: suppliers[1].id,
    },
    {
      sku: "USR-LAP-003",
      name: "Employee Laptop Standard",
      price: 950,
      quantity: 5n,
      status: "stock low",
      categoryId: categories[2].id,
      supplierId: suppliers[1].id,
    },
  ];

  for (const product of products) {
    await prisma.product.upsert({
      where: { sku: product.sku },
      update: {
        name: product.name,
        price: product.price,
        quantity: product.quantity,
        status: product.status,
        categoryId: product.categoryId,
        supplierId: product.supplierId,
        userId: admin.id,
        updatedBy: admin.id,
        updatedAt: now(),
      },
      create: {
        ...product,
        userId: admin.id,
        createdBy: admin.id,
        createdAt: now(),
      },
    });
  }

  const firstProduct = await prisma.product.findUnique({ where: { sku: "NET-FW-001" } });
  if (firstProduct) {
    await prisma.stockAllocation.upsert({
      where: {
        productId_warehouseId: {
          productId: firstProduct.id,
          warehouseId: warehouse.id,
        },
      },
      update: {
        quantity: 8n,
        reservedQuantity: 1n,
        updatedAt: now(),
      },
      create: {
        productId: firstProduct.id,
        warehouseId: warehouse.id,
        quantity: 8n,
        reservedQuantity: 1n,
        userId: admin.id,
        createdAt: now(),
      },
    });
  }

  console.log("Created/updated users:");
  console.log(`- ${admin.email} / ${PASSWORD}`);
  console.log(`- ${client.email} / ${PASSWORD}`);
  console.log(`- ${supplierUser.email} / ${PASSWORD}`);
  console.log("\nSeed complete.\n");
}

main()
  .catch((error) => {
    console.error("Seed failed:", error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
