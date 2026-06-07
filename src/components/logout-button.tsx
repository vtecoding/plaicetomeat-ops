"use client";

import { LogOut } from "lucide-react";
import { useActionState } from "react";

import { type LogoutActionState, logoutAction } from "@/app/actions/auth";
import { Button } from "@/components/ui/button";

const initialState: LogoutActionState = { error: null };

export function LogoutButton() {
  const [state, formAction, isPending] = useActionState(logoutAction, initialState);

  return (
    <div className="flex flex-col items-end gap-1">
      <form action={formAction}>
        <Button type="submit" variant="outline" size="sm" disabled={isPending}>
          <LogOut className="h-4 w-4" aria-hidden />
          {isPending ? "Signing out..." : "Sign out"}
        </Button>
      </form>
      {state.error ? (
        <p className="max-w-[16rem] text-right text-xs font-semibold text-[#7a1b1b]" role="alert">
          {state.error}
        </p>
      ) : null}
    </div>
  );
}
