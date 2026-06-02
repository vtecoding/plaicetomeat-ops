/**
 * Butchery cut sheets — domain knowledge for a UK halal butcher.
 *
 * For each animal this captures how a whole/dressed carcass breaks down into
 * saleable cuts: the typical yield (share of carcass weight), whether the cut is
 * sold bone-in, its value tier, a sensible default target margin, what it's best
 * used for, and a one-line trade tip. This is the knowledge a butcher with years
 * of experience carries in their head — written down so someone new can lean on it.
 *
 * IMPORTANT — these are *typical UK averages*. Real yields vary with breed, age,
 * fat cover, how the carcass is dressed and how tightly it's trimmed. Treat every
 * number as an editable starting assumption, never gospel. Nothing here is a
 * guaranteed price or margin.
 *
 * No pork — halal butcher.
 */
export type CutTier = "premium" | "mid" | "value" | "stock";
export type BoneState = "bone-in" | "boneless";

export type Cut = {
  id: string;
  name: string;
  /** Share of the whole carcass weight, 0..1. All cuts (incl. the waste line) sum to ~1. */
  yieldPct: number;
  bone: BoneState;
  tier: CutTier;
  /** Default target gross margin for this cut, 0..1. Premium cuts carry more, value cuts less. */
  defaultMarginPct: number;
  /** Plain-English best use, to teach someone new. */
  bestUse: string;
  /** A short trade tip. */
  tip: string;
  /** True for the bone/fat/trim-loss line that is not sold as a cut. */
  isWaste?: boolean;
};

export type AnimalCutSheet = {
  id: string;
  /** Display name, e.g. "Whole Lamb". */
  name: string;
  animal: string;
  halal: true;
  /** A sensible default carcass weight to pre-fill the calculator (kg). */
  typicalCarcassKg: number;
  /** Realistic range for a dressed carcass (kg). */
  typicalCarcassKgRange: [number, number];
  /** One-line sourcing/handling note. */
  sourcingTip: string;
  cuts: Cut[];
};

export const CUT_SHEETS: readonly AnimalCutSheet[] = [
  {
    id: "lamb",
    name: "Whole Lamb",
    animal: "Lamb",
    halal: true,
    typicalCarcassKg: 18,
    typicalCarcassKgRange: [14, 24],
    sourcingTip:
      "Usually bought as a dressed carcass — biggest seller around Eid. Hang 2–4 days for flavour and easier cutting.",
    cuts: [
      { id: "leg", name: "Leg", yieldPct: 0.31, bone: "bone-in", tier: "mid", defaultMarginPct: 0.35, bestUse: "Roast (bone-in) or dice/butterfly", tip: "Your reliable Sunday-roast seller. Butterflied legs sell well for BBQ/Eid." },
      { id: "shoulder", name: "Shoulder", yieldPct: 0.19, bone: "bone-in", tier: "mid", defaultMarginPct: 0.33, bestUse: "Slow roast, dice for curry", tip: "Fattier and cheaper than leg — perfect slow-cook and curry meat. Great value to push." },
      { id: "loin-chops", name: "Loin chops", yieldPct: 0.09, bone: "bone-in", tier: "premium", defaultMarginPct: 0.48, bestUse: "Grill / pan-fry", tip: "Premium quick-cook cut. Cut thick and price up — these carry the carcass." },
      { id: "rack", name: "Rack / best end", yieldPct: 0.07, bone: "bone-in", tier: "premium", defaultMarginPct: 0.5, bestUse: "Roast / French-trim cutlets", tip: "Your most premium cut. French-trimmed cutlets command the highest price per kg." },
      { id: "breast", name: "Breast", yieldPct: 0.09, bone: "bone-in", tier: "value", defaultMarginPct: 0.22, bestUse: "Slow roast, rolled, or mince", tip: "Cheap and fatty. Roll and stuff, or turn into mince so it doesn't sit unsold." },
      { id: "neck", name: "Neck", yieldPct: 0.07, bone: "bone-in", tier: "value", defaultMarginPct: 0.24, bestUse: "Stew / curry / hotpot", tip: "Big flavour, low cost. Sells hard in winter for stews and to curry-house trade." },
      { id: "shanks", name: "Shanks", yieldPct: 0.05, bone: "bone-in", tier: "mid", defaultMarginPct: 0.3, bestUse: "Slow braise", tip: "Trendy slow-cook cut — more popular (and pricier) than people expect." },
      { id: "mince-trim", name: "Mince & trim", yieldPct: 0.07, bone: "boneless", tier: "value", defaultMarginPct: 0.26, bestUse: "Mince, kofta, koftas, burgers", tip: "Made from offcuts — near-zero extra cost, steady seller. Keep fat ~20% for juicy kofta." },
      { id: "waste", name: "Bone, fat & trim loss", yieldPct: 0.06, bone: "boneless", tier: "value", defaultMarginPct: 0, bestUse: "Not sold (bones can be given/sold for stock)", tip: "Unavoidable loss. Bones can be bagged for customers or sold cheap for stock.", isWaste: true },
    ],
  },
  {
    id: "goat",
    name: "Whole Goat",
    animal: "Goat",
    halal: true,
    typicalCarcassKg: 13,
    typicalCarcassKgRange: [9, 18],
    sourcingTip:
      "Leaner and a touch tougher than lamb — favours slow cooking. Strong demand from South-Asian, African and Caribbean customers, and at Eid.",
    cuts: [
      { id: "leg", name: "Leg", yieldPct: 0.3, bone: "bone-in", tier: "mid", defaultMarginPct: 0.34, bestUse: "Roast or curry on the bone", tip: "Curry-on-the-bone is huge — bone-in pieces are exactly what most customers want." },
      { id: "shoulder", name: "Shoulder", yieldPct: 0.2, bone: "bone-in", tier: "mid", defaultMarginPct: 0.32, bestUse: "Slow cook / curry", tip: "Best value curry meat. Bone-in chunks for slow-cooked goat curry." },
      { id: "ribs-chops", name: "Ribs / chops", yieldPct: 0.12, bone: "bone-in", tier: "premium", defaultMarginPct: 0.42, bestUse: "Grill / fry", tip: "Quick-cook premium pieces — price above the curry cuts." },
      { id: "loin", name: "Loin", yieldPct: 0.08, bone: "bone-in", tier: "premium", defaultMarginPct: 0.44, bestUse: "Grill / roast", tip: "The tenderest part of the goat — your premium line." },
      { id: "neck", name: "Neck", yieldPct: 0.08, bone: "bone-in", tier: "value", defaultMarginPct: 0.24, bestUse: "Stew / curry", tip: "Cheap, full of flavour, ideal for slow-cooked curry." },
      { id: "shanks", name: "Shanks", yieldPct: 0.06, bone: "bone-in", tier: "mid", defaultMarginPct: 0.28, bestUse: "Slow braise / nihari", tip: "Sought after for nihari and slow braises." },
      { id: "curry-mince", name: "Curry pieces & mince", yieldPct: 0.08, bone: "boneless", tier: "value", defaultMarginPct: 0.26, bestUse: "Boneless curry / keema", tip: "Boneless curry and keema mince from trim — a fast everyday seller." },
      { id: "waste", name: "Bone, fat & trim loss", yieldPct: 0.08, bone: "boneless", tier: "value", defaultMarginPct: 0, bestUse: "Not sold", tip: "Goat is leaner so less fat loss, but more bone proportion than lamb.", isWaste: true },
    ],
  },
  {
    id: "beef",
    name: "Beef (forequarter / side)",
    animal: "Beef",
    halal: true,
    typicalCarcassKg: 140,
    typicalCarcassKgRange: [120, 170],
    sourcingTip:
      "Most small butchers buy beef by the primal rather than a whole side. Enter the weight and cost of whatever you actually buy — a primal works too.",
    cuts: [
      { id: "chuck", name: "Chuck & blade", yieldPct: 0.23, bone: "boneless", tier: "value", defaultMarginPct: 0.26, bestUse: "Stew / mince / braise", tip: "Your workhorse — braising steak and the base of good mince. High volume." },
      { id: "brisket", name: "Brisket", yieldPct: 0.07, bone: "boneless", tier: "value", defaultMarginPct: 0.28, bestUse: "Slow roast / salt beef", tip: "Cheap cut that's risen in fashion — slow-cooked and smoked. Push it." },
      { id: "rib", name: "Fore rib", yieldPct: 0.08, bone: "bone-in", tier: "premium", defaultMarginPct: 0.46, bestUse: "Roast / rib-eye steaks", tip: "Premium roasting joint and rib-eye steaks. A top earner per kg." },
      { id: "sirloin", name: "Sirloin", yieldPct: 0.07, bone: "boneless", tier: "premium", defaultMarginPct: 0.5, bestUse: "Steaks / roast", tip: "Highest-value steak cut. Trim and portion carefully — every gram counts." },
      { id: "rump", name: "Rump", yieldPct: 0.06, bone: "boneless", tier: "premium", defaultMarginPct: 0.44, bestUse: "Steaks", tip: "Great-value steak — more affordable than sirloin, big seller." },
      { id: "topside", name: "Topside", yieldPct: 0.11, bone: "boneless", tier: "mid", defaultMarginPct: 0.36, bestUse: "Roast", tip: "Lean roasting joint — the classic Sunday topside." },
      { id: "silverside", name: "Silverside", yieldPct: 0.09, bone: "boneless", tier: "mid", defaultMarginPct: 0.34, bestUse: "Roast / pot roast", tip: "Lean and economical — pot-roasts and curing." },
      { id: "flank", name: "Thin flank", yieldPct: 0.07, bone: "boneless", tier: "value", defaultMarginPct: 0.24, bestUse: "Mince / stir-fry", tip: "Mostly into mince and value packs." },
      { id: "shin", name: "Shin", yieldPct: 0.05, bone: "bone-in", tier: "value", defaultMarginPct: 0.24, bestUse: "Slow stew / osso buco", tip: "Cheap, gelatinous, brilliant slow-cooked. Cross-cut for osso buco sells higher." },
      { id: "mince-trim", name: "Mince & trim", yieldPct: 0.07, bone: "boneless", tier: "value", defaultMarginPct: 0.28, bestUse: "Mince / burgers", tip: "Blend trim to ~15–20% fat for the mince most customers want." },
      { id: "waste", name: "Bone, fat & trim loss", yieldPct: 0.1, bone: "boneless", tier: "value", defaultMarginPct: 0, bestUse: "Not sold", tip: "Beef carries more bone and fat loss than lamb — price accordingly.", isWaste: true },
    ],
  },
  {
    id: "chicken",
    name: "Whole Chicken",
    animal: "Chicken",
    halal: true,
    typicalCarcassKg: 1.6,
    typicalCarcassKgRange: [1.2, 2.2],
    sourcingTip:
      "Highest-volume, lowest-margin line. Sell whole, or joint it — jointed pieces add value over selling whole birds.",
    cuts: [
      { id: "breast", name: "Breast", yieldPct: 0.28, bone: "bone-in", tier: "premium", defaultMarginPct: 0.42, bestUse: "Grill / fry / roast", tip: "Most-wanted cut. Skinless boneless breast is your premium chicken line." },
      { id: "thigh", name: "Thigh", yieldPct: 0.18, bone: "bone-in", tier: "mid", defaultMarginPct: 0.34, bestUse: "Curry / roast / grill", tip: "Cheaper than breast, more flavour — push boneless thigh for curries." },
      { id: "drumstick", name: "Drumstick", yieldPct: 0.15, bone: "bone-in", tier: "mid", defaultMarginPct: 0.32, bestUse: "Roast / fry / BBQ", tip: "Family value cut. Marinated drumsticks sell fast in summer." },
      { id: "wing", name: "Wings", yieldPct: 0.11, bone: "bone-in", tier: "mid", defaultMarginPct: 0.3, bestUse: "Fry / BBQ / grill", tip: "Marinate for BBQ season — small margin, high turnover." },
      { id: "carcass", name: "Back / carcass", yieldPct: 0.2, bone: "bone-in", tier: "stock", defaultMarginPct: 0.12, bestUse: "Stock / soup", tip: "Low value — sell cheap for stock/soup rather than bin it." },
      { id: "waste", name: "Trim loss", yieldPct: 0.08, bone: "boneless", tier: "value", defaultMarginPct: 0, bestUse: "Not sold", tip: "Skin and trim loss when jointing.", isWaste: true },
    ],
  },
] as const;

export function getCutSheet(id: string): AnimalCutSheet | null {
  return CUT_SHEETS.find((sheet) => sheet.id === id) ?? null;
}
