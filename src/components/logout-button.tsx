"use client";

import { LogOut } from "lucide-react";
import { useActionState } from "react";

import { type LogoutActionState, logoutAction } from "@/app/actions/auth";
import { Button } from "@/components/ui/button";
import { useOperatorI18n } from "@/lib/operator/i18n/context";

const initialState: LogoutActionState = { error: null };

export function LogoutButton() {
  const [state, formAction, isPending] = useActionState(logoutAction, initialState);
  const { active, t, error } = useOperatorI18n();

  return (
    <div className="flex flex-col items-end gap-1">
      <form action={formAction}>
        <Button type="submit" variant="outline" size="sm" className="min-h-11" disabled={isPending}>
          <LogOut className="h-4 w-4" aria-hidden />
          {isPending ? t("shell.signingOut") : t("shell.signOut")}
        </Button>
      </form>
      {state.error ? (
        <p className="max-w-[16rem] text-right text-xs font-semibold text-[#7a1b1b]" role="alert">
          {active ? error(state.error) : state.error}
        </p>
      ) : null}
    </div>
  );
}
