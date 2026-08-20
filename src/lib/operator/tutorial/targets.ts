export const tutorialTargets = [
  "nav-open", "open-checklist", "open-temperature", "open-float", "open-confirm",
  "nav-serve", "serve-product-chicken", "serve-weight", "serve-payment-cash", "serve-confirm",
  "nav-stock", "stock-received", "stock-product-lamb", "stock-weight", "stock-expiry", "stock-evidence", "stock-confirm",
  "nav-waste", "waste-product-chicken", "waste-weight", "waste-reason", "waste-confirm",
  "nav-till", "till-count", "till-confirm", "nav-help", "nav-close", "close-checklist",
  "close-temperature", "close-till", "close-confirm",
] as const;

export type TutorialTarget = (typeof tutorialTargets)[number];
