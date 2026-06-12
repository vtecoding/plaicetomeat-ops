import type { Product } from "@/lib/domain/types";

export type ServeTileId = "chicken" | "lamb" | "beef" | "mutton" | "mince" | "steak" | "other";

export type ServeTile = {
  id: ServeTileId;
  label: string;
  productId: string | null;
  fallbackName: string;
};

const TILE_ORDER: Array<{ id: ServeTileId; label: string; words: string[] }> = [
  { id: "chicken", label: "Chicken", words: ["chicken"] },
  { id: "lamb", label: "Lamb", words: ["lamb"] },
  { id: "beef", label: "Beef", words: ["beef"] },
  { id: "mutton", label: "Mutton", words: ["mutton"] },
  { id: "mince", label: "Mince", words: ["mince", "minced"] },
  { id: "steak", label: "Steak", words: ["steak"] },
];

export const SERVE_AMOUNT_CHOICES = [
  { id: "500g", label: "500g", kg: 0.5 },
  { id: "1kg", label: "1kg", kg: 1 },
  { id: "2kg", label: "2kg", kg: 2 },
] as const;

function tileMatchValue(product: Product, words: string[]) {
  const name = product.name.toLowerCase();
  const matched = words.some((word) => name.includes(word));
  if (!matched) return -1;
  let value = 0;
  if (product.unitType === "kg") value += 100;
  if (product.isAvailable) value += 20;
  if (!product.requiresWeightConfirmation) value += 5;
  value -= product.sortOrder / 1000;
  value -= product.name.length / 10000;
  return value;
}

export function buildServeTiles(products: Product[]): ServeTile[] {
  const tiles = TILE_ORDER.map((tile) => {
    const product = products
      .map((item) => ({ item, value: tileMatchValue(item, tile.words) }))
      .filter((match) => match.value >= 0)
      .sort((a, b) => b.value - a.value || a.item.name.localeCompare(b.item.name))[0]?.item;

    return {
      id: tile.id,
      label: tile.label,
      productId: product?.id ?? null,
      fallbackName: product?.name ?? tile.label,
    };
  });

  return [...tiles, { id: "other", label: "Other", productId: null, fallbackName: "Other" }];
}
