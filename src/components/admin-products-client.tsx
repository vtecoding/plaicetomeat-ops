"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { AlertCircle, CheckCircle2 } from "lucide-react";

import {
  createProduct,
  updateProduct,
  updateProductAvailability,
  updateProductPrice,
  type AdminProductResult,
} from "@/app/actions/admin-products";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import type { Product, ProductCategory } from "@/lib/domain/types";
import { formatCurrency } from "@/lib/utils";

const UNIT_TYPES = ["kg", "each", "box"] as const;
const STOCK_STATUSES = [
  { value: "in_stock", label: "In stock" },
  { value: "low_stock", label: "Low stock" },
  { value: "out_of_stock", label: "Out of stock" },
] as const;

type Feedback = { tone: "ok" | "error"; message: string } | null;

export function AdminProductsClient({
  branchId,
  initialProducts,
  categories,
}: {
  branchId: string;
  initialProducts: Product[];
  categories: ProductCategory[];
}) {
  const router = useRouter();
  const [showAdd, setShowAdd] = useState(false);
  const [feedback, setFeedback] = useState<Feedback>(null);

  function announce(result: AdminProductResult) {
    setFeedback(result.ok ? { tone: "ok", message: result.message } : { tone: "error", message: result.message });
    if (result.ok) {
      // Re-derive the product list from the server so the UI never diverges from
      // the canonical database state (no optimistic-only rows).
      router.refresh();
    }
  }

  return (
    <div>
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-sm font-black uppercase tracking-[0.12em] text-[#0f5132]">Admin</p>
          <h1 className="mt-2 text-3xl font-black">Products</h1>
        </div>
        <Button type="button" data-testid="add-product-button" onClick={() => setShowAdd((v) => !v)}>
          {showAdd ? "Close" : "Add product"}
        </Button>
      </div>

      {feedback && (
        <div
          role="status"
          data-testid="product-feedback"
          className={
            "mt-4 flex items-center gap-2 rounded-lg border p-3 text-sm " +
            (feedback.tone === "ok"
              ? "border-[#0f5132]/30 bg-[#e6efe9] text-[#0f5132]"
              : "border-[#f0c66e] bg-[#fff6df] text-[#5a3900]")
          }
        >
          {feedback.tone === "ok" ? (
            <CheckCircle2 className="h-4 w-4 shrink-0" aria-hidden />
          ) : (
            <AlertCircle className="h-4 w-4 shrink-0" aria-hidden />
          )}
          <span>{feedback.message}</span>
        </div>
      )}

      {showAdd && (
        <AddProductForm
          branchId={branchId}
          categories={categories}
          onResult={(r) => {
            announce(r);
            if (r.ok) setShowAdd(false);
          }}
        />
      )}

      <div className="mt-8 grid gap-4">
        {initialProducts.length === 0 && (
          <p className="rounded-lg border border-[#ded6ca] bg-white p-5 text-sm text-[#6c5e52]">
            No products yet. Use “Add product” to create your first one.
          </p>
        )}
        {initialProducts.map((product) => (
          <ProductRow key={product.id} product={product} categories={categories} onResult={announce} />
        ))}
      </div>
    </div>
  );
}

function AddProductForm({
  branchId,
  categories,
  onResult,
}: {
  branchId: string;
  categories: ProductCategory[];
  onResult: (r: AdminProductResult) => void;
}) {
  const [isPending, startTransition] = useTransition();
  const [name, setName] = useState("");
  const [price, setPrice] = useState("");
  const [unitType, setUnitType] = useState<string>("each");
  const [categoryId, setCategoryId] = useState<string>("");
  const [description, setDescription] = useState("");

  function submit() {
    startTransition(async () => {
      const result = await createProduct({
        branchId,
        name,
        price: Number(price),
        unitType,
        categoryId: categoryId || null,
        description: description || null,
      });
      onResult(result);
      if (result.ok) {
        setName("");
        setPrice("");
        setDescription("");
      }
    });
  }

  return (
    <form
      className="mt-6 grid gap-4 rounded-lg border border-[#ded6ca] bg-white p-5"
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
    >
      <h2 className="text-lg font-black">New product</h2>
      <div className="grid gap-4 sm:grid-cols-2">
        <label className="grid gap-1 text-sm font-semibold">
          Name
          <Input data-testid="new-product-name" value={name} onChange={(e) => setName(e.target.value)} maxLength={120} required />
        </label>
        <label className="grid gap-1 text-sm font-semibold">
          Price (£)
          <Input
            data-testid="new-product-price"
            value={price}
            onChange={(e) => setPrice(e.target.value)}
            type="number"
            step="0.01"
            min="0.01"
            inputMode="decimal"
            required
          />
        </label>
        <label className="grid gap-1 text-sm font-semibold">
          Unit
          <Select data-testid="new-product-unit" value={unitType} onChange={(e) => setUnitType(e.target.value)}>
            {UNIT_TYPES.map((u) => (
              <option key={u} value={u}>
                {u}
              </option>
            ))}
          </Select>
        </label>
        <label className="grid gap-1 text-sm font-semibold">
          Category
          <Select value={categoryId} onChange={(e) => setCategoryId(e.target.value)}>
            <option value="">No category</option>
            {categories.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </Select>
        </label>
      </div>
      <label className="grid gap-1 text-sm font-semibold">
        Description
        <Textarea value={description} onChange={(e) => setDescription(e.target.value)} maxLength={500} />
      </label>
      <div className="flex justify-end">
        <Button type="submit" data-testid="new-product-submit" disabled={isPending}>
          {isPending ? "Creating…" : "Create product"}
        </Button>
      </div>
    </form>
  );
}

function ProductRow({
  product,
  categories,
  onResult,
}: {
  product: Product;
  categories: ProductCategory[];
  onResult: (r: AdminProductResult) => void;
}) {
  const [isPending, startTransition] = useTransition();
  const [name, setName] = useState(product.name);
  const [description, setDescription] = useState(product.description ?? "");
  const [unitType, setUnitType] = useState<string>(product.unitType);
  const [categoryId, setCategoryId] = useState<string>(product.categoryId ?? "");
  const [price, setPrice] = useState(String(product.pricePerUnit));
  const [stockStatus, setStockStatus] = useState<string>(product.stockStatus);
  const [available, setAvailable] = useState(product.isAvailable);

  function saveDetails() {
    startTransition(async () => {
      const detail = await updateProduct({
        productId: product.id,
        name,
        description: description || null,
        categoryId: categoryId || null,
        unitType,
      });
      if (!detail.ok) {
        onResult(detail);
        return;
      }
      if (Number(price) !== product.pricePerUnit) {
        const priceResult = await updateProductPrice({ productId: product.id, price: Number(price) });
        onResult(priceResult);
        return;
      }
      onResult(detail);
    });
  }

  function changeAvailability(nextAvailable: boolean, nextStock: string) {
    startTransition(async () => {
      const result = await updateProductAvailability({
        productId: product.id,
        isAvailable: nextAvailable,
        stockStatus: nextStock,
      });
      onResult(result);
      if (result.ok) {
        setAvailable(nextAvailable);
        setStockStatus(nextStock);
      }
    });
  }

  return (
    <article
      data-testid="product-row"
      data-slug={product.slug}
      className="rounded-lg border border-[#ded6ca] bg-white p-5"
    >
      <h3 data-testid="product-row-name" className="mb-3 text-lg font-black">
        {product.name}
      </h3>
      <div className="grid gap-4 sm:grid-cols-2">
        <label className="grid gap-1 text-sm font-semibold">
          Name
          <Input data-testid="product-name-input" value={name} onChange={(e) => setName(e.target.value)} maxLength={120} />
        </label>
        <label className="grid gap-1 text-sm font-semibold">
          Price (£) — currently {formatCurrency(product.pricePerUnit)}
          <Input
            data-testid="product-price-input"
            value={price}
            onChange={(e) => setPrice(e.target.value)}
            type="number"
            step="0.01"
            min="0.01"
            inputMode="decimal"
          />
        </label>
        <label className="grid gap-1 text-sm font-semibold">
          Unit
          <Select value={unitType} onChange={(e) => setUnitType(e.target.value)}>
            {UNIT_TYPES.map((u) => (
              <option key={u} value={u}>
                {u}
              </option>
            ))}
          </Select>
        </label>
        <label className="grid gap-1 text-sm font-semibold">
          Category
          <Select value={categoryId} onChange={(e) => setCategoryId(e.target.value)}>
            <option value="">No category</option>
            {categories.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </Select>
        </label>
      </div>
      <label className="mt-4 grid gap-1 text-sm font-semibold">
        Description
        <Textarea value={description} onChange={(e) => setDescription(e.target.value)} maxLength={500} />
      </label>

      <div className="mt-4 flex flex-wrap items-end justify-between gap-3">
        <div className="flex flex-wrap items-end gap-3">
          <label className="grid gap-1 text-sm font-semibold">
            Stock status
            <Select
              data-testid="product-stock-select"
              value={stockStatus}
              onChange={(e) => changeAvailability(available, e.target.value)}
            >
              {STOCK_STATUSES.map((s) => (
                <option key={s.value} value={s.value}>
                  {s.label}
                </option>
              ))}
            </Select>
          </label>
          <Button
            type="button"
            variant={available ? "secondary" : "default"}
            data-testid="product-availability-toggle"
            disabled={isPending}
            onClick={() => changeAvailability(!available, available ? "out_of_stock" : "in_stock")}
          >
            {available ? "Mark unavailable" : "Mark available"}
          </Button>
          <span
            data-testid="product-availability-state"
            className={
              "rounded-full px-3 py-1 text-xs font-bold " +
              (available ? "bg-[#e6efe9] text-[#0f5132]" : "bg-[#fde8e6] text-[#b42318]")
            }
          >
            {available ? "Available" : "Unavailable"}
          </span>
        </div>
        <Button type="button" data-testid="product-save" disabled={isPending} onClick={saveDetails}>
          {isPending ? "Saving…" : "Save changes"}
        </Button>
      </div>
    </article>
  );
}
