export type AnimalMapType = "lamb" | "goat" | "mutton" | "beef" | "chicken";

export type CutMapRegion = {
  id: string;
  label: string;
  path: string;
  labelX: number;
  labelY: number;
  aliases: readonly string[];
};

export type CutMap = {
  animalType: AnimalMapType;
  title: string;
  sourceNote: string;
  viewBox: string;
  outlinePath: string;
  regions: readonly CutMapRegion[];
};

export type CutToolGuidance = {
  tools: readonly string[];
  difficulty: "basic" | "intermediate" | "specialist";
  sourceRegion: string;
  /** Short shop-floor caution line. */
  caution: string;
  /** One short thing to avoid on the shop floor. */
  avoid: string;
};

// Recognisable smooth silhouettes (head, back, rump, two legs, tail) drawn as the
// cream backdrop under the cut regions — the chicken map's style applied to the
// side-profile animals. Authored on a fixed viewBox and verified by region bbox.
const LAMB_OUTLINE =
  "M74 168 C70 150 88 132 112 126 C120 108 134 100 150 118 C220 96 305 88 380 95 C418 99 450 106 472 116 C492 152 486 188 466 200 C460 204 456 208 454 214 L454 294 C454 298 450 298 448 296 L424 296 C420 296 418 294 418 290 L418 218 C392 224 350 228 300 228 L288 228 L288 292 C288 297 284 297 282 296 L258 296 C254 296 252 294 252 290 L252 222 C220 220 192 214 176 206 C160 197 154 182 154 170 C140 174 110 178 86 174 C72 172 68 170 74 168 Z M470 118 C486 120 500 130 500 146 C500 156 489 159 480 153 Z";

const BEEF_OUTLINE =
  "M70 176 C66 156 86 138 112 132 C120 112 138 104 156 124 C236 100 340 92 430 100 C476 104 512 114 540 128 C560 140 556 176 532 196 C524 202 518 208 516 216 L516 320 C516 325 511 325 509 322 L484 322 C480 322 478 320 478 314 L478 224 C440 232 380 238 320 238 L300 238 L300 318 C300 323 296 323 294 320 L270 320 C266 320 264 318 264 312 L264 230 C224 228 188 220 170 210 C156 200 150 184 150 172 C136 176 106 180 84 176 C70 174 66 178 70 176 Z M538 132 C556 134 568 146 566 162 C564 176 552 178 542 170 Z";

// Side-profile small-ruminant chart (facing left): smooth back/belly curves, a
// recognisable head and two legs, with primals laid along the body. Curved long
// edges follow the silhouette so cuts read as a clean butcher diagram rather than
// jagged polygons. Shared vertical dividers keep regions tiling cleanly.
const lambRegions: readonly CutMapRegion[] = [
  {
    id: "neck",
    label: "Neck",
    path: "M150 118 C168 110 182 106 195 104 L195 210 C188 210 180 209 176 206 C160 196 152 180 150 168 Z",
    labelX: 172,
    labelY: 150,
    aliases: ["neck"],
  },
  {
    id: "shoulder",
    label: "Shoulder",
    path: "M195 104 C220 98 240 95 258 94 L258 168 C236 167 216 166 195 166 Z",
    labelX: 226,
    labelY: 132,
    aliases: ["shoulder"],
  },
  {
    id: "rack",
    label: "Rack",
    path: "M258 94 C280 91 300 90 320 90 L320 170 C300 169 278 168 258 168 Z",
    labelX: 289,
    labelY: 131,
    aliases: ["rack", "best-end", "best end", "rack / best end", "ribs", "ribs / chops", "ribs-chops"],
  },
  {
    id: "loin",
    label: "Loin",
    path: "M320 90 C345 91 362 93 380 95 L380 168 C360 169 340 169 320 170 Z",
    labelX: 350,
    labelY: 131,
    aliases: ["loin", "loin-chops", "loin chops", "chops"],
  },
  {
    id: "leg",
    label: "Leg",
    path: "M380 95 C418 99 450 106 470 114 C490 150 484 186 468 196 C440 208 408 212 380 210 Z",
    labelX: 426,
    labelY: 150,
    aliases: ["leg"],
  },
  {
    id: "breast",
    label: "Breast",
    path: "M195 166 C230 167 265 168 300 170 L300 230 C260 230 220 220 195 210 Z",
    labelX: 245,
    labelY: 198,
    aliases: ["breast"],
  },
  {
    id: "shank",
    label: "Shank",
    path: "M252 222 C250 250 250 280 256 296 L280 296 C284 270 282 246 286 226 Z M420 218 C418 248 418 278 424 296 L448 296 C452 270 450 244 454 216 Z",
    labelX: 269,
    labelY: 262,
    aliases: ["shank", "shanks"],
  },
  {
    id: "mince-trim",
    label: "Mince/trim",
    path: "M300 170 L380 168 L380 210 C352 218 326 224 300 230 Z",
    labelX: 340,
    labelY: 198,
    aliases: ["mince-trim", "mince & trim", "curry-mince", "curry pieces & mince", "waste", "bone, fat & trim loss"],
  },
];

// Side-profile beef chart (facing left): a larger, blockier bovine silhouette in
// the same smooth style as the lamb/chicken maps. Primals along the top
// (chuck/rib/sirloin/rump) with brisket/flank/trim/topside below and two shin
// legs. Shared vertical dividers (244/338/416) keep the rows tiling cleanly.
const beefRegions: readonly CutMapRegion[] = [
  {
    id: "chuck",
    label: "Chuck",
    path: "M156 124 C188 116 214 112 244 110 L244 200 C212 198 184 196 162 188 C150 180 150 150 156 124 Z",
    labelX: 200,
    labelY: 152,
    aliases: ["chuck", "chuck & blade"],
  },
  {
    id: "rib",
    label: "Rib",
    path: "M244 110 C278 106 308 104 338 104 L338 196 C308 197 276 198 244 200 Z",
    labelX: 291,
    labelY: 150,
    aliases: ["rib", "fore rib"],
  },
  {
    id: "sirloin",
    label: "Sirloin",
    path: "M338 104 C366 104 392 105 416 108 L416 192 C390 193 364 195 338 196 Z",
    labelX: 377,
    labelY: 148,
    aliases: ["sirloin"],
  },
  {
    id: "rump",
    label: "Rump",
    path: "M416 108 C452 112 500 120 532 134 C552 152 548 180 524 192 C490 196 452 194 416 192 Z",
    labelX: 470,
    labelY: 150,
    aliases: ["rump"],
  },
  {
    id: "brisket",
    label: "Brisket",
    path: "M162 188 C184 196 212 198 244 200 L244 238 C220 236 192 226 172 216 C164 208 162 198 162 188 Z",
    labelX: 203,
    labelY: 216,
    aliases: ["brisket"],
  },
  {
    id: "flank",
    label: "Flank",
    path: "M244 200 C276 198 308 197 338 196 L338 238 C306 238 274 238 244 238 Z",
    labelX: 291,
    labelY: 219,
    aliases: ["flank", "thin flank"],
  },
  {
    id: "silverside-topside",
    label: "Topside/silverside",
    path: "M416 194 C448 195 478 196 500 198 L500 236 C470 238 442 238 416 238 Z",
    labelX: 457,
    labelY: 217,
    aliases: ["topside", "silverside", "silverside/topside"],
  },
  {
    id: "shin",
    label: "Shin",
    path: "M268 232 C266 256 266 290 272 318 L296 318 C300 290 298 258 300 234 Z M484 226 C482 256 482 292 488 320 L512 320 C516 290 514 258 516 222 Z",
    labelX: 284,
    labelY: 284,
    aliases: ["shin"],
  },
  {
    id: "mince-trim",
    label: "Mince/trim",
    path: "M338 196 C364 195 390 195 416 194 L416 238 C390 238 364 238 338 238 Z",
    labelX: 377,
    labelY: 219,
    aliases: ["mince-trim", "mince & trim", "waste", "bone, fat & trim loss"],
  },
];

// Clean butcher-style whole-bird diagram (symmetric top view): head nub at the
// top, breast in the centre, wings angled off the shoulders, thighs and
// drumsticks down each side, backbone and trim down the middle. Center axis x=230.
const chickenRegions: readonly CutMapRegion[] = [
  {
    id: "breast",
    label: "Breast",
    path: "M230 78 C190 78 158 98 158 140 C158 180 196 206 230 210 C264 206 302 180 302 140 C302 98 270 78 230 78 Z",
    labelX: 230,
    labelY: 138,
    aliases: ["breast"],
  },
  {
    id: "wing",
    label: "Wings",
    path: "M158 118 L112 92 L84 112 L102 138 L130 152 L160 140 Z M302 118 L348 92 L376 112 L358 138 L330 152 L300 140 Z",
    labelX: 116,
    labelY: 116,
    aliases: ["wing", "wings"],
  },
  {
    id: "thigh",
    label: "Thighs",
    path: "M170 206 C140 210 126 234 136 260 C144 280 170 282 190 266 C202 252 202 222 188 208 Z M290 206 C320 210 334 234 324 260 C316 280 290 282 270 266 C258 252 258 222 272 208 Z",
    labelX: 158,
    labelY: 240,
    aliases: ["thigh", "thighs"],
  },
  {
    id: "drumstick",
    label: "Drums",
    path: "M152 260 C138 286 140 314 158 334 C170 346 184 342 186 324 C190 300 184 276 176 262 Z M308 260 C322 286 320 314 302 334 C290 346 276 342 274 324 C270 300 276 276 284 262 Z",
    labelX: 161,
    labelY: 312,
    aliases: ["drumstick", "drums"],
  },
  {
    id: "carcass",
    label: "Back",
    path: "M212 210 L248 210 L245 270 C243 286 217 286 215 270 Z",
    labelX: 230,
    labelY: 244,
    aliases: ["carcass", "back / carcass", "back", "bone"],
  },
  {
    id: "skin-trim",
    label: "Skin/trim",
    path: "M216 288 C214 304 222 318 230 320 C238 318 246 304 244 288 C240 296 220 296 216 288 Z",
    labelX: 230,
    labelY: 340,
    aliases: ["waste", "trim loss", "skin", "skin-trim", "skin/trimming zone"],
  },
];

export const CUT_MAPS: Record<AnimalMapType, CutMap> = {
  lamb: {
    animalType: "lamb",
    title: "Lamb cut map",
    sourceNote: "Visual guide only. Actual carcasses vary by breed, age, fat cover and dressing.",
    viewBox: "0 0 560 360",
    outlinePath: LAMB_OUTLINE,
    regions: lambRegions,
  },
  goat: {
    animalType: "goat",
    title: "Goat cut map",
    sourceNote: "Uses the lamb-style small-ruminant map with goat cut labels. Visual guide only.",
    viewBox: "0 0 560 360",
    outlinePath: LAMB_OUTLINE,
    regions: lambRegions,
  },
  mutton: {
    animalType: "mutton",
    title: "Mutton cut map",
    sourceNote: "Uses the lamb-style small-ruminant map with mutton cut labels. Visual guide only.",
    viewBox: "0 0 560 360",
    outlinePath: LAMB_OUTLINE,
    regions: lambRegions,
  },
  beef: {
    animalType: "beef",
    title: "Beef cut map",
    sourceNote: "Visual guide only. This supports sides/quarters or primals entered into the calculator.",
    viewBox: "0 0 580 380",
    outlinePath: BEEF_OUTLINE,
    regions: beefRegions,
  },
  chicken: {
    animalType: "chicken",
    title: "Chicken cut map",
    sourceNote: "Visual guide only. Whole bird yields vary by size, trim and whether skin is retained.",
    viewBox: "0 0 460 372",
    outlinePath:
      "M230 46 C242 46 250 58 246 72 C290 76 316 104 314 150 C311 200 280 252 230 312 C180 252 149 200 146 150 C144 104 170 76 214 72 C210 58 218 46 230 46 Z",
    regions: chickenRegions,
  },
};

export const CUT_TOOL_GUIDANCE: Record<string, CutToolGuidance> = {
  leg: {
    tools: ["boning knife", "saw", "slicing knife", "tray/packaging"],
    difficulty: "intermediate",
    sourceRegion: "hind leg",
    caution: "High-value joint.",
    avoid: "Aggressive trimming.",
  },
  shoulder: {
    tools: ["boning knife", "saw", "cleaver", "tray/packaging"],
    difficulty: "intermediate",
    sourceRegion: "front shoulder",
    caution: "Good slow-cook value.",
    avoid: "Over-trimming the braising fat.",
  },
  rack: {
    tools: ["boning knife", "saw", "slicing knife"],
    difficulty: "specialist",
    sourceRegion: "rib/rack section",
    caution: "High-value cut.",
    avoid: "Cutting before you are sure of the spec.",
  },
  loin: {
    tools: ["boning knife", "saw", "slicing knife"],
    difficulty: "specialist",
    sourceRegion: "loin",
    caution: "Premium quick-cook meat.",
    avoid: "Uneven portion thickness.",
  },
  breast: {
    tools: ["boning knife", "cleaver", "tray/packaging"],
    difficulty: "basic",
    sourceRegion: "breast",
    caution: "Value cut, often fatty.",
    avoid: "Discounting before checking trim.",
  },
  neck: {
    tools: ["saw", "cleaver", "tray/packaging"],
    difficulty: "intermediate",
    sourceRegion: "neck",
    caution: "Bone-in slow-cook cut.",
    avoid: "Unclear cooking-time labelling.",
  },
  shank: {
    tools: ["saw", "boning knife", "tray/packaging"],
    difficulty: "intermediate",
    sourceRegion: "lower leg",
    caution: "Slow-braise cut.",
    avoid: "Cross-cutting without trained staff.",
  },
  chuck: {
    tools: ["boning knife", "slicing knife", "mincer", "tray/packaging"],
    difficulty: "intermediate",
    sourceRegion: "forequarter shoulder",
    caution: "Workhorse beef.",
    avoid: "Mixing braising pieces into mince trim.",
  },
  brisket: {
    tools: ["boning knife", "slicing knife", "tray/packaging"],
    difficulty: "intermediate",
    sourceRegion: "lower chest",
    caution: "Slow-cook cut.",
    avoid: "Selling as quick-cook steak.",
  },
  rib: {
    tools: ["saw", "boning knife", "slicing knife"],
    difficulty: "specialist",
    sourceRegion: "rib section",
    caution: "Premium roast/steak area.",
    avoid: "Cutting expensive portions before confirming spec.",
  },
  sirloin: {
    tools: ["boning knife", "slicing knife"],
    difficulty: "specialist",
    sourceRegion: "short loin",
    caution: "Highest-value steak cut.",
    avoid: "Careless trimming — every gram counts.",
  },
  rump: {
    tools: ["boning knife", "slicing knife"],
    difficulty: "intermediate",
    sourceRegion: "hindquarter rump",
    caution: "Good steak value.",
    avoid: "Uneven steak thickness.",
  },
  topside: {
    tools: ["boning knife", "slicing knife", "tray/packaging"],
    difficulty: "intermediate",
    sourceRegion: "hindquarter round",
    caution: "Lean roast.",
    avoid: "Selling without cooking guidance.",
  },
  silverside: {
    tools: ["boning knife", "slicing knife", "tray/packaging"],
    difficulty: "intermediate",
    sourceRegion: "hindquarter round",
    caution: "Lean economical roast.",
    avoid: "Labelling it as a quick roast.",
  },
  flank: {
    tools: ["boning knife", "mincer", "tray/packaging"],
    difficulty: "basic",
    sourceRegion: "thin flank",
    caution: "Mostly mince/value pack.",
    avoid: "Letting low-margin trim hide premium waste.",
  },
  shin: {
    tools: ["saw", "cleaver", "tray/packaging"],
    difficulty: "intermediate",
    sourceRegion: "lower leg",
    caution: "Bone-in slow-cook beef.",
    avoid: "Cross-cutting without proper equipment.",
  },
  "mince-trim": {
    tools: ["mincer", "boning knife", "tray/packaging"],
    difficulty: "basic",
    sourceRegion: "trim allocation",
    caution: "Commercial outlet for trim.",
    avoid: "Inconsistent fat balance.",
  },
  thigh: {
    tools: ["boning knife", "cleaver", "tray/packaging"],
    difficulty: "basic",
    sourceRegion: "upper leg",
    caution: "Good curry/roast value.",
    avoid: "Mixing bone-in and boneless specs.",
  },
  drumstick: {
    tools: ["boning knife", "cleaver", "tray/packaging"],
    difficulty: "basic",
    sourceRegion: "lower leg",
    caution: "Family value cut.",
    avoid: "Discounting before the display plan is set.",
  },
  wing: {
    tools: ["cleaver", "boning knife", "tray/packaging"],
    difficulty: "basic",
    sourceRegion: "wing",
    caution: "Small high-turnover cut.",
    avoid: "Letting a low price hide poor margin.",
  },
  carcass: {
    tools: ["cleaver", "tray/packaging"],
    difficulty: "basic",
    sourceRegion: "back and frame",
    caution: "Low-value stock/soup line.",
    avoid: "Binning it with the trim waste.",
  },
  waste: {
    tools: ["tray/packaging"],
    difficulty: "basic",
    sourceRegion: "bone, fat, skin or trimming allocation",
    caution: "For accounting only.",
    avoid: "Moving weight into saleable cuts.",
  },
};

export function normalizeCutKey(value: string) {
  return value
    .toLowerCase()
    .replace(/&/g, "and")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

export function canonicalAnimalType(value: string): AnimalMapType | null {
  const key = normalizeCutKey(value);
  if (key.includes("lamb")) return "lamb";
  if (key.includes("goat")) return "goat";
  if (key.includes("mutton")) return "mutton";
  if (key.includes("beef")) return "beef";
  if (key.includes("chicken")) return "chicken";
  return null;
}

export function getCutMap(animalType: string): CutMap | null {
  const canonical = canonicalAnimalType(animalType);
  return canonical ? CUT_MAPS[canonical] : null;
}

export function findCutMapRegion(animalType: string, cutIdOrName: string): CutMapRegion | null {
  const map = getCutMap(animalType);
  if (!map) return null;

  const key = normalizeCutKey(cutIdOrName);
  return (
    map.regions.find((region) => {
      if (normalizeCutKey(region.id) === key || normalizeCutKey(region.label) === key) return true;
      return region.aliases.some((alias) => normalizeCutKey(alias) === key);
    }) ?? null
  );
}

export function getToolGuidance(cutIdOrName: string): CutToolGuidance | null {
  const key = normalizeCutKey(cutIdOrName);
  if (CUT_TOOL_GUIDANCE[key]) return CUT_TOOL_GUIDANCE[key];

  if (key.includes("shank")) return CUT_TOOL_GUIDANCE.shank;
  if (key.includes("loin")) return CUT_TOOL_GUIDANCE.loin;
  if (key.includes("rack") || key.includes("rib")) return CUT_TOOL_GUIDANCE.rack;
  if (key.includes("mince") || key.includes("trim")) return CUT_TOOL_GUIDANCE["mince-trim"];
  if (key.includes("waste") || key.includes("loss")) return CUT_TOOL_GUIDANCE.waste;
  if (key.includes("topside")) return CUT_TOOL_GUIDANCE.topside;
  if (key.includes("silverside")) return CUT_TOOL_GUIDANCE.silverside;
  if (key.includes("wing")) return CUT_TOOL_GUIDANCE.wing;

  return null;
}
