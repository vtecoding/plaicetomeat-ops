"use client";

import { AlertCircle } from "lucide-react";
import { useActionState } from "react";

import { type LoginActionState, loginAction } from "@/app/actions/auth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

const initialLoginState: LoginActionState = { error: null };

export function LoginForm({ returnTo }: { returnTo?: string }) {
  const [state, formAction, isPending] = useActionState(loginAction, initialLoginState);

  return (
    <form action={formAction} className="grid gap-5" noValidate>
      {returnTo ? <input type="hidden" name="returnTo" value={returnTo} /> : null}

      <div className="grid gap-2">
        <label className="text-sm font-semibold" htmlFor="email">
          Work email
        </label>
        <Input
          id="email"
          name="email"
          type="email"
          autoComplete="username"
          required
          placeholder="you@plaicetomeat.co.uk"
          disabled={isPending}
        />
      </div>

      <div className="grid gap-2">
        <label className="text-sm font-semibold" htmlFor="password">
          Password
        </label>
        <Input
          id="password"
          name="password"
          type="password"
          autoComplete="current-password"
          required
          placeholder="Your password"
          disabled={isPending}
        />
      </div>

      {state.error ? (
        <div
          className="flex gap-3 rounded-lg border border-[#f0a3a3] bg-[#fdeaea] p-4 text-sm text-[#7a1b1b]"
          role="alert"
        >
          <AlertCircle className="mt-0.5 h-5 w-5 shrink-0" aria-hidden />
          <span>{state.error}</span>
        </div>
      ) : null}

      <Button type="submit" size="lg" disabled={isPending}>
        {isPending ? "Signing in..." : "Sign in"}
      </Button>
    </form>
  );
}
