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
  caution: string;
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

const chickenRegions: readonly CutMapRegion[] = [
  {
    id: "breast",
    label: "Breast",
    path: "M170 103 C219 64 291 64 340 103 C328 149 302 180 255 190 C208 180 182 149 170 103 Z",
    labelX: 255,
    labelY: 125,
    aliases: ["breast"],
  },
  {
    id: "wing",
    label: "Wing",
    path: "M158 111 C101 119 63 151 45 207 L116 198 C137 171 151 142 158 111 Z M352 111 C409 119 447 151 465 207 L394 198 C373 171 359 142 352 111 Z",
    labelX: 83,
    labelY: 165,
    aliases: ["wing", "wings"],
  },
  {
    id: "thigh",
    label: "Thigh",
    path: "M176 191 C207 191 231 208 239 238 L199 302 C166 282 151 243 176 191 Z M334 191 C303 191 279 208 271 238 L311 302 C344 282 359 243 334 191 Z",
    labelX: 198,
    labelY: 241,
    aliases: ["thigh"],
  },
  {
    id: "drumstick",
    label: "Drumstick",
    path: "M199 302 L239 238 L244 334 L218 363 Z M311 302 L271 238 L266 334 L292 363 Z",
    labelX: 255,
    labelY: 326,
    aliases: ["drumstick"],
  },
  {
    id: "carcass",
    label: "Carcass/bone",
    path: "M239 238 C234 210 222 192 255 190 C288 192 276 210 271 238 L266 334 L244 334 Z",
    labelX: 255,
    labelY: 263,
    aliases: ["carcass", "back / carcass", "back", "bone"],
  },
  {
    id: "skin-trim",
    label: "Skin/trim",
    path: "M170 103 C162 141 166 174 176 191 C151 243 166 282 199 302 L218 363 L174 335 C120 294 102 234 116 198 L45 207 C63 151 101 119 158 111 Z M340 103 C348 141 344 174 334 191 C359 243 344 282 311 302 L292 363 L336 335 C390 294 408 234 394 198 L465 207 C447 151 409 119 352 111 Z",
    labelX: 393,
    labelY: 235,
    aliases: ["waste", "trim loss", "skin", "skin/trimming zone"],
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
    viewBox: "0 0 510 390",
    outlinePath:
      "M170 103 C219 64 291 64 340 103 C348 105 352 108 352 111 C409 119 447 151 465 207 L394 198 C408 234 390 294 336 335 L292 363 L266 334 L244 334 L218 363 L174 335 C120 294 102 234 116 198 L45 207 C63 151 101 119 158 111 C158 108 162 105 170 103 Z",
    regions: chickenRegions,
  },
};

export const CUT_TOOL_GUIDANCE: Record<string, CutToolGuidance> = {
  leg: {
    tools: ["boning knife", "saw", "slicing knife", "tray/packaging"],
    difficulty: "intermediate",
    sourceRegion: "hind leg",
    caution: "High-value joint. Keep trimming controlled and ask an experienced butcher before changing seam lines.",
  },
  shoulder: {
    tools: ["boning knife", "saw", "cleaver", "tray/packaging"],
    difficulty: "intermediate",
    sourceRegion: "front shoulder",
    caution: "Good slow-cook value. Avoid over-trimming fat that customers expect for braising.",
  },
  rack: {
    tools: ["boning knife", "saw", "slicing knife"],
    difficulty: "specialist",
    sourceRegion: "rib/rack section",
    caution: "High-value cut. If unsure, avoid aggressive trimming and ask an experienced butcher before cutting.",
  },
  loin: {
    tools: ["boning knife", "saw", "slicing knife"],
    difficulty: "specialist",
    sourceRegion: "loin",
    caution: "Premium quick-cook meat. Keep portions consistent before display pricing.",
  },
  breast: {
    tools: ["boning knife", "cleaver", "tray/packaging"],
    difficulty: "basic",
    sourceRegion: "breast/belly or breast meat depending on animal",
    caution: "Value cut. Check fat and trim before discounting; it may suit mince or rolled packs.",
  },
  neck: {
    tools: ["saw", "cleaver", "tray/packaging"],
    difficulty: "intermediate",
    sourceRegion: "neck",
    caution: "Bone-in slow-cook cut. Keep labelling clear so customers understand cooking time.",
  },
  shank: {
    tools: ["saw", "boning knife", "tray/packaging"],
    difficulty: "intermediate",
    sourceRegion: "lower leg",
    caution: "Slow-braise cut. Cross-cut work should be handled by trained staff.",
  },
  chuck: {
    tools: ["boning knife", "slicing knife", "mincer", "tray/packaging"],
    difficulty: "intermediate",
    sourceRegion: "forequarter shoulder",
    caution: "Workhorse beef. Separate braising pieces from mince trim to protect margin.",
  },
  brisket: {
    tools: ["boning knife", "slicing knife", "tray/packaging"],
    difficulty: "intermediate",
    sourceRegion: "lower chest",
    caution: "Slow-cook cut. Do not sell as quick-cook steak.",
  },
  rib: {
    tools: ["saw", "boning knife", "slicing knife"],
    difficulty: "specialist",
    sourceRegion: "rib section",
    caution: "Premium roast/steak area. Confirm spec before cutting expensive portions.",
  },
  sirloin: {
    tools: ["boning knife", "slicing knife"],
    difficulty: "specialist",
    sourceRegion: "short loin",
    caution: "Highest-value steak cut. Small trimming errors have commercial impact.",
  },
  rump: {
    tools: ["boning knife", "slicing knife"],
    difficulty: "intermediate",
    sourceRegion: "hindquarter rump",
    caution: "Good steak value. Keep portion thickness consistent.",
  },
  topside: {
    tools: ["boning knife", "slicing knife", "tray/packaging"],
    difficulty: "intermediate",
    sourceRegion: "hindquarter round",
    caution: "Lean roast. Avoid drying-value claims; give clear cooking guidance at counter.",
  },
  silverside: {
    tools: ["boning knife", "slicing knife", "tray/packaging"],
    difficulty: "intermediate",
    sourceRegion: "hindquarter round",
    caution: "Lean economical roast. Label for slow/pot roasting if appropriate.",
  },
  flank: {
    tools: ["boning knife", "mincer", "tray/packaging"],
    difficulty: "basic",
    sourceRegion: "thin flank",
    caution: "Often mince/value pack. Avoid letting low-margin trim hide premium waste.",
  },
  shin: {
    tools: ["saw", "cleaver", "tray/packaging"],
    difficulty: "intermediate",
    sourceRegion: "lower leg",
    caution: "Bone-in slow-cook beef. Cross-cut only with suitable equipment and trained staff.",
  },
  "mince-trim": {
    tools: ["mincer", "boning knife", "tray/packaging"],
    difficulty: "basic",
    sourceRegion: "trim allocation",
    caution: "Commercial outlet for trim. Keep fat balance and labelling consistent.",
  },
  thigh: {
    tools: ["boning knife", "cleaver", "tray/packaging"],
    difficulty: "basic",
    sourceRegion: "upper leg",
    caution: "Good curry/roast value. Keep bone-in and boneless specs separate.",
  },
  drumstick: {
    tools: ["boning knife", "cleaver", "tray/packaging"],
    difficulty: "basic",
    sourceRegion: "lower leg",
    caution: "Family value cut. Watch marinade/display plans before discounting.",
  },
  wing: {
    tools: ["cleaver", "boning knife", "tray/packaging"],
    difficulty: "basic",
    sourceRegion: "wing",
    caution: "Small high-turnover cut. Pack consistently so low price does not hide poor margin.",
  },
  carcass: {
    tools: ["cleaver", "tray/packaging"],
    difficulty: "basic",
    sourceRegion: "back and frame",
    caution: "Low-value stock/soup line. Keep separate from trim waste.",
  },
  waste: {
    tools: ["tray/packaging"],
    difficulty: "basic",
    sourceRegion: "bone, fat, skin or trimming allocation",
    caution: "Waste guidance is for accounting only. Do not silently move weight into saleable cuts.",
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
