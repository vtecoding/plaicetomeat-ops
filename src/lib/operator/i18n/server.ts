import { cookies } from "next/headers";

import {
  DEFAULT_OPERATOR_LOCALE,
  OPERATOR_LOCALE_COOKIE,
  isOperatorLocale,
  type OperatorLocale,
} from "./resources";

export async function getOperatorLocale(): Promise<OperatorLocale> {
  const value = (await cookies()).get(OPERATOR_LOCALE_COOKIE)?.value;
  return isOperatorLocale(value) ? value : DEFAULT_OPERATOR_LOCALE;
}
