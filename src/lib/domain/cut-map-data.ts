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

const lambRegions: readonly CutMapRegion[] = [
  {
    id: "neck",
    label: "Neck",
    path: "M63 103 L105 86 L124 112 L108 145 L70 145 Z",
    labelX: 90,
    labelY: 120,
    aliases: ["neck"],
  },
  {
    id: "shoulder",
    label: "Shoulder",
    path: "M108 82 L182 66 L218 101 L203 169 L109 166 L124 112 Z",
    labelX: 160,
    labelY: 120,
    aliases: ["shoulder"],
  },
  {
    id: "rack",
    label: "Rack",
    path: "M218 72 L303 66 L317 151 L203 169 L218 101 Z",
    labelX: 260,
    labelY: 112,
    aliases: ["rack", "best-end", "best end", "rack / best end", "ribs", "ribs / chops", "ribs-chops"],
  },
  {
    id: "loin",
    label: "Loin",
    path: "M303 66 L382 76 L386 158 L317 151 Z",
    labelX: 348,
    labelY: 113,
    aliases: ["loin", "loin-chops", "loin chops", "chops"],
  },
  {
    id: "leg",
    label: "Leg",
    path: "M382 76 L462 104 L483 174 L431 214 L386 158 Z",
    labelX: 430,
    labelY: 144,
    aliases: ["leg"],
  },
  {
    id: "breast",
    label: "Breast",
    path: "M109 166 L203 169 L194 222 L118 216 L70 145 Z",
    labelX: 144,
    labelY: 192,
    aliases: ["breast"],
  },
  {
    id: "shank",
    label: "Shank",
    path: "M431 214 L483 174 L500 235 L471 267 L438 246 Z M118 216 L154 221 L143 269 L112 269 Z",
    labelX: 455,
    labelY: 238,
    aliases: ["shank", "shanks"],
  },
  {
    id: "mince-trim",
    label: "Mince/trim",
    path: "M194 222 L203 169 L386 158 L431 214 L356 239 L250 235 Z",
    labelX: 300,
    labelY: 204,
    aliases: ["mince-trim", "mince & trim", "curry-mince", "curry pieces & mince", "waste", "bone, fat & trim loss"],
  },
];

const beefRegions: readonly CutMapRegion[] = [
  {
    id: "chuck",
    label: "Chuck",
    path: "M72 119 L155 86 L208 118 L196 188 L94 190 Z",
    labelX: 142,
    labelY: 142,
    aliases: ["chuck", "chuck & blade"],
  },
  {
    id: "rib",
    label: "Rib",
    path: "M208 88 L303 78 L318 174 L196 188 L208 118 Z",
    labelX: 258,
    labelY: 126,
    aliases: ["rib", "fore rib"],
  },
  {
    id: "sirloin",
    label: "Sirloin",
    path: "M303 78 L389 84 L400 171 L318 174 Z",
    labelX: 354,
    labelY: 124,
    aliases: ["sirloin"],
  },
  {
    id: "rump",
    label: "Rump",
    path: "M389 84 L480 112 L497 178 L433 204 L400 171 Z",
    labelX: 445,
    labelY: 142,
    aliases: ["rump"],
  },
  {
    id: "brisket",
    label: "Brisket",
    path: "M94 190 L196 188 L192 237 L103 236 Z",
    labelX: 145,
    labelY: 215,
    aliases: ["brisket"],
  },
  {
    id: "flank",
    label: "Flank",
    path: "M192 237 L196 188 L318 174 L315 235 Z",
    labelX: 256,
    labelY: 211,
    aliases: ["flank", "thin flank"],
  },
  {
    id: "silverside-topside",
    label: "Topside/silverside",
    path: "M315 235 L318 174 L400 171 L433 204 L399 249 Z",
    labelX: 370,
    labelY: 211,
    aliases: ["topside", "silverside", "silverside/topside"],
  },
  {
    id: "shin",
    label: "Shin",
    path: "M103 236 L151 238 L143 292 L111 294 Z M433 204 L497 178 L511 246 L479 290 L446 255 Z",
    labelX: 462,
    labelY: 250,
    aliases: ["shin"],
  },
  {
    id: "mince-trim",
    label: "Mince/trim",
    path: "M151 238 L192 237 L315 235 L399 249 L446 255 L409 278 L249 280 L143 292 Z",
    labelX: 282,
    labelY: 263,
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
    viewBox: "0 0 560 330",
    outlinePath:
      "M62 102 C95 74 143 60 212 51 C290 41 379 55 466 89 C498 102 520 129 526 164 C533 205 512 248 471 282 L436 252 L411 278 L249 280 L143 269 L112 269 L118 216 L70 145 Z",
    regions: lambRegions,
  },
  goat: {
    animalType: "goat",
    title: "Goat cut map",
    sourceNote: "Uses the lamb-style small-ruminant map with goat cut labels. Visual guide only.",
    viewBox: "0 0 560 330",
    outlinePath:
      "M62 102 C95 74 143 60 212 51 C290 41 379 55 466 89 C498 102 520 129 526 164 C533 205 512 248 471 282 L436 252 L411 278 L249 280 L143 269 L112 269 L118 216 L70 145 Z",
    regions: lambRegions,
  },
  mutton: {
    animalType: "mutton",
    title: "Mutton cut map",
    sourceNote: "Uses the lamb-style small-ruminant map with mutton cut labels. Visual guide only.",
    viewBox: "0 0 560 330",
    outlinePath:
      "M62 102 C95 74 143 60 212 51 C290 41 379 55 466 89 C498 102 520 129 526 164 C533 205 512 248 471 282 L436 252 L411 278 L249 280 L143 269 L112 269 L118 216 L70 145 Z",
    regions: lambRegions,
  },
  beef: {
    animalType: "beef",
    title: "Beef cut map",
    sourceNote: "Visual guide only. This supports sides/quarters or primals entered into the calculator.",
    viewBox: "0 0 560 340",
    outlinePath:
      "M72 119 C122 77 199 60 300 62 C387 64 470 89 512 126 C543 154 545 205 511 246 L479 290 L446 255 L409 278 L249 280 L143 292 L111 294 L103 236 L94 190 Z",
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
