"use client";

import { AlertCircle } from "lucide-react";
import { useActionState } from "react";

import { type LoginActionState, loginAction } from "@/app/actions/auth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useOperatorI18n } from "@/lib/operator/i18n/context";

const initialLoginState: LoginActionState = { error: null };

export function LoginForm({ returnTo }: { returnTo?: string }) {
  const [state, formAction, isPending] = useActionState(loginAction, initialLoginState);
  const { t } = useOperatorI18n();
  const loginError = state.error
    ? t(
        /enter your email and password/i.test(state.error)
          ? "login.enterBoth"
          : /too many failed attempts/i.test(state.error)
            ? "login.tooMany"
            : /invalid email or password/i.test(state.error)
              ? "login.invalid"
              : "login.failed",
      )
    : null;

  return (
    <form action={formAction} className="grid gap-5" noValidate>
      {returnTo ? <input type="hidden" name="returnTo" value={returnTo} /> : null}

      <div className="grid gap-2">
        <label className="text-sm font-semibold" htmlFor="email">
          {t("login.email")}
        </label>
        <Input
          id="email"
          name="email"
          type="email"
          autoComplete="username"
          required
          placeholder={t("login.emailPlaceholder")}
          disabled={isPending}
        />
      </div>

      <div className="grid gap-2">
        <label className="text-sm font-semibold" htmlFor="password">
          {t("login.password")}
        </label>
        <Input
          id="password"
          name="password"
          type="password"
          autoComplete="current-password"
          required
          placeholder={t("login.passwordPlaceholder")}
          disabled={isPending}
        />
      </div>

      {loginError ? (
        <div
          className="flex gap-3 rounded-lg border border-[#f0a3a3] bg-[#fdeaea] p-4 text-sm text-[#7a1b1b]"
          role="alert"
        >
          <AlertCircle className="mt-0.5 h-5 w-5 shrink-0" aria-hidden />
          <span>{loginError}</span>
        </div>
      ) : null}

      <Button type="submit" size="lg" disabled={isPending}>
        {isPending ? t("login.signingIn") : t("login.title")}
      </Button>
    </form>
  );
}
