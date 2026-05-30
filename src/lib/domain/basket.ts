import type { Basket, BasketItem, Product } from "./types";
import { DEFAULT_MAX_QUANTITY_PER_SKU } from "./checkout-rules";

export const BASKET_TTL_MS = 24 * 60 * 60 * 1000;

export type RecalculatedLine = {
  productId: string;
  productNameSnapshot: string;
  quantity: number;
  unitType: Product["unitType"];
  unitPriceSnapshot: number;
  lineTotal: number;
};

export type RecalculatedBasket = {
  lines: RecalculatedLine[];
  subtotal: number;
};

export function getBasketStorageKey(branchId: string) {
  return `ptm_basket_${branchId}`;
}

export function createEmptyBasket(branchId: string): Basket {
  return {
    branchId,
    items: [],
    updatedAt: new Date().toISOString(),
  };
}

export function isBasketExpired(updatedAt: string, now = new Date()) {
  const updatedAtTime = new Date(updatedAt).getTime();

  if (Number.isNaN(updatedAtTime)) {
    return true;
  }

  return now.getTime() - updatedAtTime > BASKET_TTL_MS;
}

export function upsertBasketItem(basket: Basket, item: BasketItem): Basket {
  const existingItem = basket.items.find((current) => current.productId === item.productId);
  const nextItems = existingItem
    ? basket.items.map((current) =>
        current.productId === item.productId
          ? { ...current, quantity: roundQuantity(current.quantity + item.quantity) }
          : current,
      )
    : [...basket.items, item];

  return {
    ...basket,
    items: nextItems,
    updatedAt: new Date().toISOString(),
  };
}

export function recalculateBasket(items: BasketItem[], products: Product[]): RecalculatedBasket {
  if (items.length === 0) {
    throw new Error("Basket is empty.");
  }

  const productsById = new Map(products.map((product) => [product.id, product]));
  const lines = items.map((item) => {
    const product = productsById.get(item.productId);

    if (!product) {
      throw new Error(`Product ${item.productId} was not found.`);
    }

    if (!product.isAvailable || product.stockStatus === "out_of_stock") {
      throw new Error(`${product.name} is no longer available.`);
    }

    if (item.quantity < product.minOrderQuantity) {
      throw new Error(`${product.name} minimum order is ${product.minOrderQuantity}${product.unitType}.`);
    }

    const maxOrderQuantity = product.maxOrderQuantity ?? DEFAULT_MAX_QUANTITY_PER_SKU;

    if (item.quantity > maxOrderQuantity) {
      throw new Error(`${product.name} maximum order is ${maxOrderQuantity}${product.unitType}.`);
    }

    const lineTotal = roundMoney(item.quantity * product.pricePerUnit);

    return {
      productId: product.id,
      productNameSnapshot: product.name,
      quantity: item.quantity,
      unitType: product.unitType,
      unitPriceSnapshot: product.pricePerUnit,
      lineTotal,
    };
  });

  return {
    lines,
    subtotal: roundMoney(lines.reduce((total, line) => total + line.lineTotal, 0)),
  };
}

export function roundMoney(value: number) {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

function roundQuantity(value: number) {
  return Math.round((value + Number.EPSILON) * 1000) / 1000;
}
