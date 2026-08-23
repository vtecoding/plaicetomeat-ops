import type { OperatorLocale, OperatorTranslationKey } from "@/lib/operator/i18n/resources";

export type TutorialPlacement = "top" | "bottom" | "left" | "right";

export type TutorialEvent = {
  id: string;
  name: string;
  value?: string | number | boolean;
};

export type TutorialStep = {
  id: string;
  route: string;
  target: string | null;
  titleKey: OperatorTranslationKey;
  instructionKey: OperatorTranslationKey;
  feedbackKey?: OperatorTranslationKey;
  placement?: TutorialPlacement;
  requiredEvent?: string;
  expectedValue?: string | number | boolean;
};

export type SimulatedState = {
  shopOpen: boolean;
  openingClean: boolean;
  openingTemperature: string;
  openingFloat: string;
  sale: { product: string; weight: string; payment: string; complete: boolean };
  delivery: { started: boolean; product: string; weight: string; expiry: string; evidence: boolean; complete: boolean };
  waste: { product: string; weight: string; reason: string; complete: boolean };
  till: { counted: string; confirmed: boolean };
  helpOpened: boolean;
  close: { clean: boolean; temperature: string; till: string; complete: boolean };
};

export type DryRunSession = {
  id: string;
  scenarioId: "complete-shop-day-v3";
  mode: "dry-run";
  locale: OperatorLocale;
  currentStep: number;
  completedSteps: string[];
  simulatedState: SimulatedState;
  snapshots: SimulatedState[];
  processedEventIds: string[];
  startedAt: string;
  expiresAt: string;
  status: "active" | "completed";
};
