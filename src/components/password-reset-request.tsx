"use client";

import { CheckCircle2 } from "lucide-react";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { createSupabaseBrowserClient } from "@/lib/supabase/browser";

/**
 * "Forgot your password?" — sends a Supabase recovery email that redirects to
 * /auth/update-password on the current origin. The redirect target must be in the
 * Supabase Auth "Redirect URLs" allowlist for the email link to be honoured.
 *
 * Always shows the same confirmation regardless of whether the email exists, so
 * it never reveals which addresses have accounts.
 */
export function PasswordResetRequest() {
  const [open, setOpen] = useState(false);
  const [email, setEmail] = useState("");
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);

  async function onSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (!email.trim()) return;
    setSending(true);
    const supabase = createSupabaseBrowserClient();
    await supabase.auth.resetPasswordForEmail(email.trim(), {
      redirectTo: `${window.location.origin}/auth/update-password`,
    });
    setSending(false);
    setSent(true);
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="text-sm font-bold text-[#0f5132] underline-offset-2 hover:underline"
      >
        Forgot your password?
      </button>
    );
  }

  if (sent) {
    return (
      <div className="flex items-start gap-2 rounded-lg border border-[#badbc8] bg-[#eaf7ef] p-3 text-sm text-[#103d29]">
        <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
        <span>If that email has an account, a reset link is on its way. Check your inbox.</span>
      </div>
    );
  }

  return (
    <form onSubmit={onSubmit} className="grid gap-2">
      <label className="text-sm font-semibold" htmlFor="reset-email">
        Email for the reset link
      </label>
      <Input
        id="reset-email"
        type="email"
        autoComplete="username"
        required
        placeholder="you@plaicetomeat.co.uk"
        value={email}
        onChange={(event) => setEmail(event.target.value)}
        disabled={sending}
      />
      <Button type="submit" variant="outline" size="sm" disabled={sending}>
        {sending ? "Sending…" : "Send reset link"}
      </Button>
    </form>
  );
}
