"use server";

import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import { prisma } from "@/prisma/client";
import { logger } from "@/lib/logger";
import { getSessionFromRequest } from "@/utils/auth";
import { createAuditLog } from "@/prisma/audit-log";
import { mergeProductListWhere } from "@/lib/products/product-query";
import {
  calculateProductStatus,
  createProductSchema,
  updateProductSchema,
} from "@/lib/validations";
import { checkAndSendStockAlerts } from "@/lib/email/notifications";
import {
  deleteProductImageFromImageKit,
  generateAndUploadQRCode,
} from "@/lib/imagekit";
import { isImageKitNotFoundError } from "@/lib/imagekit-errors";
import type {
  CreateProductInput,
  Product,
  ProductStatus,
  UpdateProductInput,
} from "@/types";

type ProductActionResult =
  | { success: true; product: Product }
  | { success: false; error: string };

export type ProductFormActionState =
  | { status: "idle" }
  | { status: "success"; product: Product; mode: "create" | "update" }
  | { status: "error"; error: string; mode: "create" | "update" };

function getFormString(formData: FormData, key: string) {
  const value = formData.get(key);
  return typeof value === "string" ? value.trim() : "";
}

function getFormNumber(formData: FormData, key: string) {
  const raw = getFormString(formData, key).replace(/,/g, "");
  return raw === "" ? 0 : Number(raw);
}

function getOptionalFormString(formData: FormData, key: string) {
  const value = getFormString(formData, key);
  return value === "" ? undefined : value;
}

function buildProductInputFromForm(formData: FormData) {
  const quantity = getFormNumber(formData, "quantity");

  return {
    name: getFormString(formData, "productName"),
    sku: getFormString(formData, "sku"),
    price: getFormNumber(formData, "price"),
    quantity,
    status: calculateProductStatus(quantity),
    categoryId: getFormString(formData, "categoryId"),
    supplierId: getFormString(formData, "supplierId"),
    userId: getFormString(formData, "userId"),
    imageUrl: getOptionalFormString(formData, "imageUrl"),
    imageFileId: getOptionalFormString(formData, "imageFileId"),
    expirationDate: getOptionalFormString(formData, "expirationDate"),
  };
}

async function getActionSession() {
  const cookieStore = await cookies();
  return getSessionFromRequest({ cookies: cookieStore });
}

function toProductView(
  product: Awaited<ReturnType<typeof prisma.product.create>>,
  categoryName?: string | null,
  supplierName?: string | null,
): Product {
  return {
    id: product.id,
    name: product.name,
    sku: product.sku,
    price: Number(product.price),
    quantity: Number(product.quantity),
    reservedQuantity: Number(product.reservedQuantity ?? 0),
    status: product.status as ProductStatus,
    categoryId: product.categoryId,
    supplierId: product.supplierId,
    category: categoryName || "Unknown",
    supplier: supplierName || "Unknown",
    userId: product.userId,
    createdBy: product.createdBy,
    updatedBy: product.updatedBy || null,
    createdAt: product.createdAt,
    updatedAt: product.updatedAt || null,
    qrCodeUrl: product.qrCodeUrl || undefined,
    qrCodeFileId: product.qrCodeFileId || undefined,
    imageUrl: product.imageUrl || undefined,
    imageFileId: product.imageFileId || undefined,
    expirationDate: product.expirationDate || null,
  };
}

async function refreshProductViews() {
  const { invalidateOnProductChange } = await import("@/lib/cache");
  await invalidateOnProductChange().catch((error) => {
    logger.error("Failed to invalidate cache after product Server Action:", error);
  });

  revalidatePath("/products");
  revalidatePath("/admin/products");
  revalidatePath("/categories");
  revalidatePath("/suppliers");
}

export async function createProductAction(
  input: CreateProductInput,
): Promise<ProductActionResult> {
  try {
    const session = await getActionSession();
    if (!session) return { success: false, error: "Unauthorized" };
    if (session.role === "supplier") {
      return {
        success: false,
        error: "Suppliers cannot create products; only admins can.",
      };
    }

    const parsed = createProductSchema.safeParse({ ...input, userId: session.id });
    if (!parsed.success) {
      return { success: false, error: parsed.error.issues[0]?.message || "Invalid product data" };
    }

    const existingProduct = await prisma.product.findUnique({
      where: { sku: parsed.data.sku },
    });
    if (existingProduct) {
      return { success: false, error: "SKU must be unique" };
    }

    const product = await prisma.product.create({
      data: {
        name: parsed.data.name,
        sku: parsed.data.sku,
        price: parsed.data.price,
        quantity: BigInt(parsed.data.quantity) as any,
        status: parsed.data.status,
        userId: session.id,
        createdBy: session.id,
        categoryId: parsed.data.categoryId,
        supplierId: parsed.data.supplierId,
        imageUrl: input.imageUrl || null,
        imageFileId: input.imageFileId || null,
        expirationDate: input.expirationDate ? new Date(input.expirationDate) : null,
        createdAt: new Date(),
        updatedAt: null,
      },
    });

    createAuditLog({
      userId: session.id,
      action: "create",
      entityType: "product",
      entityId: product.id,
      details: { productName: product.name, sku: product.sku, via: "server-action" },
    }).catch(() => {});

    const [category, supplier, user] = await Promise.all([
      prisma.category.findUnique({ where: { id: product.categoryId } }),
      prisma.supplier.findUnique({ where: { id: product.supplierId } }),
      prisma.user.findUnique({
        where: { id: session.id },
        select: { email: true, name: true },
      }),
    ]);

    generateAndUploadQRCode(
      JSON.stringify({ productId: product.id, sku: product.sku, name: product.name }),
      `product-${product.sku}`,
      200,
      "/stock-inventory/qr-codes/",
    )
      .then(async (qrCodeData) => {
        await prisma.product.update({
          where: { id: product.id },
          data: { qrCodeUrl: qrCodeData.url, qrCodeFileId: qrCodeData.fileId },
        });
      })
      .catch((error) => logger.error("Failed to generate QR code for product Server Action:", error));

    checkAndSendStockAlerts(
      {
        name: product.name,
        quantity: Number(product.quantity),
        sku: product.sku,
        category: category?.name,
      },
      undefined,
      user?.email || undefined,
      user?.name || undefined,
      session.id,
    ).catch((error) => logger.error("Failed to send stock alert from product Server Action:", error));

    await refreshProductViews();

    return { success: true, product: toProductView(product, category?.name, supplier?.name) };
  } catch (error) {
    logger.error("Error creating product via Server Action:", error);
    return { success: false, error: "Failed to create product" };
  }
}

export async function createProductFormAction(
  _previousState: ProductFormActionState,
  formData: FormData,
): Promise<ProductFormActionState> {
  const result = await createProductAction(buildProductInputFromForm(formData));

  if (!result.success) {
    return { status: "error", error: result.error, mode: "create" };
  }

  return { status: "success", product: result.product, mode: "create" };
}

export async function updateProductAction(
  input: UpdateProductInput,
): Promise<ProductActionResult> {
  try {
    const session = await getActionSession();
    if (!session) return { success: false, error: "Unauthorized" };
    if (session.role === "supplier") {
      return {
        success: false,
        error: "Suppliers cannot update products; only admins can.",
      };
    }

    const parsed = updateProductSchema.safeParse(input);
    if (!parsed.success) {
      return { success: false, error: parsed.error.issues[0]?.message || "Invalid product data" };
    }

    const existingProduct = await prisma.product.findFirst({
      where: mergeProductListWhere({ id: parsed.data.id, userId: session.id }),
    });
    if (!existingProduct) {
      return { success: false, error: "Product not found or unauthorized" };
    }

    if (parsed.data.sku && parsed.data.sku !== existingProduct.sku) {
      const skuExists = await prisma.product.findUnique({ where: { sku: parsed.data.sku } });
      if (skuExists) return { success: false, error: "SKU must be unique" };
    }

    if (parsed.data.imageUrl === "" && existingProduct.imageFileId) {
      deleteProductImageFromImageKit(existingProduct.imageFileId).catch((error) => {
        if (!isImageKitNotFoundError(error)) logger.warn("Failed to delete old product image:", error);
      });
    }

    const product = await prisma.product.update({
      where: { id: parsed.data.id },
      data: {
        ...(parsed.data.name && { name: parsed.data.name }),
        ...(parsed.data.sku && { sku: parsed.data.sku }),
        ...(parsed.data.price !== undefined && { price: parsed.data.price }),
        ...(parsed.data.quantity !== undefined && { quantity: BigInt(parsed.data.quantity) as any }),
        ...(parsed.data.status && { status: parsed.data.status }),
        ...(parsed.data.categoryId && { categoryId: parsed.data.categoryId }),
        ...(parsed.data.supplierId && { supplierId: parsed.data.supplierId }),
        ...(parsed.data.imageUrl !== undefined && {
          imageUrl: parsed.data.imageUrl === "" ? null : parsed.data.imageUrl,
        }),
        ...(parsed.data.imageFileId !== undefined && {
          imageFileId: parsed.data.imageFileId === "" ? null : parsed.data.imageFileId,
        }),
        ...(parsed.data.expirationDate !== undefined && {
          expirationDate:
            parsed.data.expirationDate === "" || parsed.data.expirationDate === null
              ? null
              : new Date(parsed.data.expirationDate),
        }),
        updatedBy: session.id,
        updatedAt: new Date(),
      },
    });

    createAuditLog({
      userId: session.id,
      action: "update",
      entityType: "product",
      entityId: product.id,
      details: { productName: product.name, via: "server-action" },
    }).catch(() => {});

    const [category, supplier] = await Promise.all([
      prisma.category.findUnique({ where: { id: product.categoryId } }),
      prisma.supplier.findUnique({ where: { id: product.supplierId } }),
    ]);

    await refreshProductViews();

    return { success: true, product: toProductView(product, category?.name, supplier?.name) };
  } catch (error) {
    logger.error("Error updating product via Server Action:", error);
    return { success: false, error: "Failed to update product" };
  }
}

export async function updateProductFormAction(
  _previousState: ProductFormActionState,
  formData: FormData,
): Promise<ProductFormActionState> {
  const result = await updateProductAction({
    ...buildProductInputFromForm(formData),
    id: getFormString(formData, "id"),
  });

  if (!result.success) {
    return { status: "error", error: result.error, mode: "update" };
  }

  return { status: "success", product: result.product, mode: "update" };
}
