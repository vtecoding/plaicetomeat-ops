"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";

import {
  DEFAULT_OPERATOR_LOCALE,
  OPERATOR_LOCALE_COOKIE,
  isOperatorLocale,
  operatorDirection,
  translateOperator,
  translateOperatorError,
  translateOperatorProduct,
  type OperatorLocale,
  type OperatorTranslationKey,
} from "./resources";

type OperatorI18n = {
  active: boolean;
  locale: OperatorLocale;
  dir: "ltr" | "rtl";
  setLocale: (locale: OperatorLocale) => void;
  t: (key: OperatorTranslationKey, values?: Record<string, string | number>) => string;
  error: (message: string | null | undefined) => string;
  product: (name: string) => string;
};

const fallback: OperatorI18n = {
  active: false,
  locale: DEFAULT_OPERATOR_LOCALE,
  dir: "ltr",
  setLocale: () => undefined,
  t: (key, values) => translateOperator(DEFAULT_OPERATOR_LOCALE, key, values),
  error: (message) => translateOperatorError(DEFAULT_OPERATOR_LOCALE, message),
  product: (name) => translateOperatorProduct(DEFAULT_OPERATOR_LOCALE, name),
};

const OperatorI18nContext = createContext<OperatorI18n>(fallback);

export function OperatorLocaleProvider({
  initialLocale,
  children,
  applyDocumentDirection = false,
}: {
  initialLocale: OperatorLocale;
  children: ReactNode;
  applyDocumentDirection?: boolean;
}) {
  const [locale, setLocaleState] = useState<OperatorLocale>(initialLocale);
  const dir = operatorDirection(locale);

  const setLocale = useCallback((next: OperatorLocale) => {
    if (!isOperatorLocale(next)) return;
    document.cookie = `${OPERATOR_LOCALE_COOKIE}=${encodeURIComponent(next)}; Path=/; Max-Age=31536000; SameSite=Lax`;
    setLocaleState(next);
  }, []);

  useEffect(() => {
    if (!applyDocumentDirection) return;
    const html = document.documentElement;
    const previousLang = html.lang;
    const previousDir = html.dir;
    html.lang = locale === "ps-AF" ? "ps-AF" : "en";
    html.dir = dir;
    return () => {
      html.lang = previousLang || "en";
      html.dir = previousDir;
    };
  }, [applyDocumentDirection, dir, locale]);

  const value = useMemo<OperatorI18n>(() => ({
    active: true,
    locale,
    dir,
    setLocale,
    t: (key, values) => translateOperator(locale, key, values),
    error: (message) => translateOperatorError(locale, message),
    product: (name) => translateOperatorProduct(locale, name),
  }), [dir, locale, setLocale]);

  return <OperatorI18nContext.Provider value={value}>{children}</OperatorI18nContext.Provider>;
}

export function useOperatorI18n(): OperatorI18n {
  return useContext(OperatorI18nContext);
}
