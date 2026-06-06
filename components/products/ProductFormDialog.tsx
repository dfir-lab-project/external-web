"use client";

import { useActionState, useState, useEffect, useRef } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  DialogClose,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useForm, FormProvider } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useProductStore } from "@/stores";
import { useCategories, useSuppliers } from "@/hooks/queries";
import { useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import { invalidateAllRelatedQueries } from "@/lib/react-query";
import {
  createProductFormAction,
  updateProductFormAction,
  type ProductFormActionState,
} from "@/app/actions/products";
import { logger } from "@/lib/logger";
import ProductName from "./form-fields/NameField";
import SKU from "./form-fields/SKUField";
import Quantity from "./form-fields/QuantityField";
import Price from "./form-fields/PriceField";
import ImageField from "./form-fields/ImageField";
import ExpirationDateField from "./form-fields/ExpirationDateField";
import { Product } from "@/types";
import { productSchema, type ProductFormData } from "@/lib/validations";
import { DeferredSelectGate } from "@/components/shared";

interface AddProductDialogProps {
  allProducts: Product[];
  userId: string;
  children?: React.ReactNode;
}

const initialProductFormActionState: ProductFormActionState = { status: "idle" };

export default function AddProductDialog({
  allProducts,
  userId,
  children,
}: AddProductDialogProps) {
  const methods = useForm<ProductFormData>({
    resolver: zodResolver(productSchema),
    defaultValues: {
      productName: "",
      sku: "",
      quantity: "" as unknown as number,
      price: "" as unknown as number,
      imageUrl: "",
      imageFileId: "",
      expirationDate: "",
    },
  });

  const { reset } = methods;

  const [selectedCategory, setSelectedCategory] = useState<string>("");
  const [selectedSupplier, setSelectedSupplier] = useState<string>("");
  const dialogCloseRef = useRef<HTMLButtonElement | null>(null);

  // Keep UI state in Zustand (openProductDialog, selectedProduct)
  const {
    setOpenProductDialog,
    openProductDialog,
    setSelectedProduct,
    selectedProduct,
  } = useProductStore();

  // Use TanStack Query for data fetching
  const { data: categories = [] } = useCategories();
  const { data: suppliers = [] } = useSuppliers();

  // Filter to only show active categories and suppliers in dropdowns
  // Include currently selected category/supplier even if inactive (for edit mode)
  const activeCategories = categories.filter(
    (category) => category.status !== false || category.id === selectedCategory
  );
  const activeSuppliers = suppliers.filter(
    (supplier) => supplier.status !== false || supplier.id === selectedSupplier
  );

  const queryClient = useQueryClient();
  const { toast } = useToast();
  const handledActionStateRef = useRef<ProductFormActionState | null>(null);
  const [createActionState, createFormAction, isCreatePending] = useActionState(
    createProductFormAction,
    initialProductFormActionState,
  );
  const [updateActionState, updateFormAction, isUpdatePending] = useActionState(
    updateProductFormAction,
    initialProductFormActionState,
  );
  const activeActionState = selectedProduct ? updateActionState : createActionState;
  const activeFormAction = selectedProduct ? updateFormAction : createFormAction;
  const isSubmitting = isCreatePending || isUpdatePending;

  useEffect(() => {
    if (selectedProduct) {
      reset({
        productName: selectedProduct.name,
        sku: selectedProduct.sku,
        quantity: selectedProduct.quantity,
        price: selectedProduct.price,
        imageUrl: selectedProduct.imageUrl || "",
        imageFileId: selectedProduct.imageFileId || "",
        expirationDate: selectedProduct.expirationDate
          ? new Date(selectedProduct.expirationDate).toISOString().split("T")[0]
          : "",
      });
      setSelectedCategory(selectedProduct.categoryId || "");
      setSelectedSupplier(selectedProduct.supplierId || "");
    } else {
      // Reset form to default values for adding a new product
      reset({
        productName: "",
        sku: "",
        quantity: "" as unknown as number,
        price: "" as unknown as number,
        imageUrl: "",
        imageFileId: "",
        expirationDate: "",
      });
      setSelectedCategory("");
      setSelectedSupplier("");
    }
  }, [selectedProduct, openProductDialog, reset]);

  useEffect(() => {
    if (activeActionState.status === "idle") return;
    if (handledActionStateRef.current === activeActionState) return;

    handledActionStateRef.current = activeActionState;

    if (activeActionState.status === "error") {
      logger.error("Product Server Action error:", activeActionState.error);
      toast({
        title: "Error",
        description: activeActionState.error,
        variant: "destructive",
      });
      return;
    }

    invalidateAllRelatedQueries(queryClient);
    toast({
      title: "Success",
      description:
        `Product "${activeActionState.product.name}" ` +
        (activeActionState.mode === "update" ? "updated" : "created") +
        " successfully",
    });

    dialogCloseRef.current?.click();
    setOpenProductDialog(false);
  }, [activeActionState, queryClient, setOpenProductDialog, toast]);

  const handleOpenChange = (open: boolean) => {
    if (open) {
      // When opening the dialog for adding a new product, clear any selected product
      setSelectedProduct(null);
    } else {
      // When closing the dialog, also clear the selected product to ensure clean state
      setSelectedProduct(null);
    }
    setOpenProductDialog(open);
  };

  return (
    <Dialog open={openProductDialog} onOpenChange={handleOpenChange}>
      <DialogTrigger asChild>
        {children || (
          <Button className="h-10 font-semibold inline-flex items-center justify-center rounded-xl border border-rose-400/30 dark:border-rose-400/30 bg-gradient-to-r from-rose-500/40 via-rose-500/30 to-rose-500/20 dark:from-rose-500/40 dark:via-rose-500/30 dark:to-rose-500/20 text-white shadow-[0_15px_35px_rgba(225,29,72,0.35)] backdrop-blur-sm transition duration-200 hover:border-rose-300/50 hover:from-rose-500/50 hover:via-rose-500/40 hover:to-rose-500/30 dark:hover:border-rose-300/50 dark:hover:from-rose-500/50 dark:hover:via-rose-500/40 dark:hover:to-rose-500/30">
            +Add Product
          </Button>
        )}
      </DialogTrigger>
      <DialogContent
        className="p-4 sm:p-7 sm:px-8 poppins max-h-[90vh] overflow-y-auto border-rose-400/30 dark:border-rose-400/30 shadow-[0_30px_80px_rgba(225,29,72,0.35)] dark:shadow-[0_30px_80px_rgba(225,29,72,0.25)]"
        onOpenAutoFocus={(e) => e.preventDefault()}
      >
        <DialogHeader>
          <DialogTitle className="text-[22px] text-white">
            {selectedProduct ? "Update Product" : "Add Product"}
          </DialogTitle>
          <DialogDescription className="text-white/70">
            Enter the details of the product below.
          </DialogDescription>
        </DialogHeader>
        <FormProvider {...methods}>
          {/* react-hook-form handleSubmit passes a ref; rule is for raw refs during render */}
          {/* eslint-disable-next-line react-hooks/refs */}
          <form action={activeFormAction}>
            <input type="hidden" name="id" value={selectedProduct?.id || ""} />
            <input type="hidden" name="userId" value={userId} />
            <input type="hidden" name="categoryId" value={selectedCategory} />
            <input type="hidden" name="supplierId" value={selectedSupplier} />
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <ProductName />
              <SKU allProducts={allProducts} />
              <Quantity />
              <Price />
              <ExpirationDateField />
              <ImageField />
              <div className="mt-5 flex flex-col gap-2">
                <label className="text-sm font-medium text-white/80">
                  Category
                </label>
                {/* Always string value — avoids controlled/uncontrolled flip from `|| undefined` */}
                <DeferredSelectGate
                  enabled={openProductDialog}
                  placeholder={
                    <div
                      className="flex h-11 w-full items-center rounded-md border border-rose-400/30 bg-white/10 px-3 text-sm text-white/60"
                      aria-hidden
                    >
                      {activeCategories.find((c) => c.id === selectedCategory)
                        ?.name ?? "Select Category"}
                    </div>
                  }
                >
                  {({ selectRemountKey }) => (
                    <Select
                      key={selectRemountKey}
                      value={selectedCategory}
                      onValueChange={(value) => setSelectedCategory(value)}
                    >
                      <SelectTrigger className="h-11 w-full border-rose-400/30 dark:border-white/20 bg-white/10 dark:bg-white/5 backdrop-blur-sm text-white placeholder:text-white/40 focus:border-rose-400 focus:ring-rose-500/50 shadow-[0_10px_30px_rgba(225,29,72,0.15)]">
                        <SelectValue placeholder="Select Category" />
                      </SelectTrigger>
                      <SelectContent
                        className="border-rose-400/20 dark:border-white/10 bg-white/80 dark:bg-popover/50 backdrop-blur-sm z-[100]"
                        position="popper"
                        sideOffset={5}
                        align="start"
                      >
                        {activeCategories.map((category) => (
                          <SelectItem
                            key={category.id}
                            value={category.id}
                            className="cursor-pointer text-gray-900 dark:text-white focus:bg-rose-100 dark:focus:bg-white/10 focus:text-gray-900 dark:focus:text-white"
                          >
                            {category.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  )}
                </DeferredSelectGate>
              </div>
              <div className="mt-5 flex flex-col gap-2">
                <label className="text-sm font-medium text-white/80">
                  Supplier
                </label>
                <DeferredSelectGate
                  enabled={openProductDialog}
                  placeholder={
                    <div
                      className="flex h-11 w-full items-center rounded-md border border-rose-400/30 bg-white/10 px-3 text-sm text-white/60"
                      aria-hidden
                    >
                      {activeSuppliers.find((s) => s.id === selectedSupplier)
                        ?.name ?? "Select Supplier"}
                    </div>
                  }
                >
                  {({ selectRemountKey }) => (
                    <Select
                      key={selectRemountKey}
                      value={selectedSupplier}
                      onValueChange={(value) => setSelectedSupplier(value)}
                    >
                      <SelectTrigger className="h-11 w-full border-rose-400/30 dark:border-white/20 bg-white/10 dark:bg-white/5 backdrop-blur-sm text-white placeholder:text-white/40 focus:border-rose-400 focus:ring-rose-500/50 shadow-[0_10px_30px_rgba(225,29,72,0.15)]">
                        <SelectValue placeholder="Select Supplier" />
                      </SelectTrigger>
                      <SelectContent
                        className="border-rose-400/20 dark:border-white/10 bg-white/80 dark:bg-popover/50 backdrop-blur-sm z-[100]"
                        position="popper"
                        sideOffset={5}
                        align="start"
                      >
                        {activeSuppliers.map((supplier) => (
                          <SelectItem
                            key={supplier.id}
                            value={supplier.id}
                            className="cursor-pointer text-gray-900 dark:text-white focus:bg-rose-100 dark:focus:bg-white/10 focus:text-gray-900 dark:focus:text-white"
                          >
                            {supplier.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  )}
                </DeferredSelectGate>
              </div>
            </div>
            <DialogFooter className="mt-9 mb-4 flex flex-col sm:flex-row items-center gap-4">
              <DialogClose asChild>
                <Button
                  ref={dialogCloseRef}
                  variant="secondary"
                  className="h-11 w-full sm:w-auto px-11 inline-flex items-center justify-center rounded-xl border border-white/10 bg-gradient-to-r from-gray-400/40 via-gray-300/30 to-gray-400/40 dark:bg-background/50 backdrop-blur-sm shadow-[0_15px_35px_rgba(0,0,0,0.3)] dark:shadow-[0_15px_35px_rgba(255,255,255,0.25)] transition duration-200 hover:bg-gradient-to-r hover:from-gray-400/60 hover:via-gray-300/50 hover:to-gray-400/60 dark:hover:bg-accent/50 hover:border-white/20 dark:hover:border-white/20 hover:shadow-[0_20px_45px_rgba(0,0,0,0.5)] dark:hover:shadow-[0_20px_45px_rgba(255,255,255,0.4)]"
                >
                  Cancel
                </Button>
              </DialogClose>
              <Button
                type="submit"
                className="h-11 w-full sm:w-auto px-11 inline-flex items-center justify-center rounded-xl border border-rose-400/30 dark:border-rose-400/30 bg-gradient-to-r from-rose-500/70 via-rose-500/50 to-rose-500/30 dark:from-rose-500/70 dark:via-rose-500/50 dark:to-rose-500/30 text-white shadow-[0_15px_35px_rgba(225,29,72,0.45)] backdrop-blur-sm transition duration-200 hover:border-rose-300/40 hover:from-rose-500/80 hover:via-rose-500/60 hover:to-rose-500/40 dark:hover:border-rose-300/40 dark:hover:from-rose-500/80 dark:hover:via-rose-500/60 dark:hover:to-rose-500/40 hover:shadow-[0_20px_45px_rgba(225,29,72,0.6)]"
                disabled={isSubmitting}
              >
                {isSubmitting
                  ? "Loading..."
                  : selectedProduct
                  ? "Update Product"
                  : "Add Product"}
              </Button>
            </DialogFooter>
          </form>
        </FormProvider>
      </DialogContent>
    </Dialog>
  );
}
