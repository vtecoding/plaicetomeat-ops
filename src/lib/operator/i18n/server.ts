import { cookies } from "next/headers";

import {
  DEFAULT_OPERATOR_LOCALE,
  DEFAULT_OPERATOR_SCRIPT_STYLE,
  OPERATOR_LOCALE_COOKIE,
  OPERATOR_SCRIPT_STYLE_COOKIE,
  isOperatorLocale,
  isOperatorScriptStyle,
  type OperatorLocale,
  type OperatorScriptStyle,
} from "./resources";

export async function getOperatorLocale(): Promise<OperatorLocale> {
  const value = (await cookies()).get(OPERATOR_LOCALE_COOKIE)?.value;
  return isOperatorLocale(value) ? value : DEFAULT_OPERATOR_LOCALE;
}

export async function getOperatorScriptStyle(): Promise<OperatorScriptStyle> {
  const value = (await cookies()).get(OPERATOR_SCRIPT_STYLE_COOKIE)?.value;
  return isOperatorScriptStyle(value) ? value : DEFAULT_OPERATOR_SCRIPT_STYLE;
}
