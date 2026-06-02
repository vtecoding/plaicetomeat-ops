"use client";

import { AlertCircle, CheckCircle2, KeyRound } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { createSupabaseBrowserClient } from "@/lib/supabase/browser";

type Phase = "checking" | "ready" | "no_link" | "done";

/**
 * Handles the Supabase password-recovery flow. Recovery emails redirect here with
 * the session in the URL hash (`#access_token=...&type=recovery`). We exchange
 * that for a session, scrub it from the address bar, then let the user set a new
 * password. Also works for an already-signed-in user who wants to change theirs.
 */
export function UpdatePasswordForm() {
  const router = useRouter();
  const [supabase] = useState(() => createSupabaseBrowserClient());
  const [phase, setPhase] = useState<Phase>("checking");
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    async function init() {
      const rawHash = window.location.hash.startsWith("#") ? window.location.hash.slice(1) : "";
      const params = new URLSearchParams(rawHash);
      const accessToken = params.get("access_token");
      const refreshToken = params.get("refresh_token");
      const errorDescription = params.get("error_description");

      if (errorDescription) {
        setPhase("no_link");
        setNotice("This reset link has expired or was already used. Request a new one below.");
        return;
      }

      if (accessToken && refreshToken) {
        const { error: sessionError } = await supabase.auth.setSession({
          access_token: accessToken,
          refresh_token: refreshToken,
        });
        // Remove the tokens from the URL/history immediately.
        window.history.replaceState(null, "", window.location.pathname);
        if (sessionError) {
          setPhase("no_link");
          setNotice("This reset link has expired. Request a new one below.");
          return;
        }
        setPhase("ready");
        return;
      }

      // No recovery token — allow an already-signed-in user to change their password.
      const { data } = await supabase.auth.getSession();
      setPhase(data.session ? "ready" : "no_link");
      if (!data.session) {
        setNotice("Open the link from your password-reset email to set a new password.");
      }
    }

    void init();
  }, [supabase]);

  async function onSubmit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    if (password.length < 10) {
      setError("Use at least 10 characters.");
      return;
    }
    if (password !== confirm) {
      setError("The two passwords don't match.");
      return;
    }

    setSaving(true);
    const { error: updateError } = await supabase.auth.updateUser({ password });
    setSaving(false);

    if (updateError) {
      setError("Couldn't save the new password — the reset link may have expired. Request a new one.");
      return;
    }

    // Don't leave the recovery session active; send them to a clean sign-in.
    await supabase.auth.signOut();
    setPhase("done");
    setTimeout(() => router.push("/login"), 2500);
  }

  if (phase === "checking") {
    return <p className="text-sm text-[#6c5e52]">Checking your reset link…</p>;
  }

  if (phase === "done") {
    return (
      <div className="flex items-start gap-3 rounded-lg border border-[#badbc8] bg-[#eaf7ef] p-4 text-[#103d29]">
        <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0" aria-hidden />
        <div>
          <p className="font-bold">Password updated.</p>
          <p className="mt-1 text-sm">Taking you to the sign-in page…</p>
        </div>
      </div>
    );
  }

  if (phase === "no_link") {
    return (
      <div className="grid gap-4">
        {notice ? (
          <div className="flex gap-3 rounded-lg border border-[#f0d8a8] bg-[#fdf6e9] p-4 text-sm text-[#92510a]" role="alert">
            <AlertCircle className="mt-0.5 h-5 w-5 shrink-0" aria-hidden />
            <span>{notice}</span>
          </div>
        ) : null}
        <Button asChild variant="outline">
          <Link href="/login">Back to sign in</Link>
        </Button>
      </div>
    );
  }

  return (
    <form onSubmit={onSubmit} className="grid gap-5" noValidate>
      <div className="grid gap-2">
        <label className="text-sm font-semibold" htmlFor="new-password">
          New password
        </label>
        <Input
          id="new-password"
          name="new-password"
          type="password"
          autoComplete="new-password"
          required
          minLength={10}
          placeholder="At least 10 characters"
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          disabled={saving}
        />
      </div>

      <div className="grid gap-2">
        <label className="text-sm font-semibold" htmlFor="confirm-password">
          Confirm new password
        </label>
        <Input
          id="confirm-password"
          name="confirm-password"
          type="password"
          autoComplete="new-password"
          required
          minLength={10}
          placeholder="Type it again"
          value={confirm}
          onChange={(event) => setConfirm(event.target.value)}
          disabled={saving}
        />
      </div>

      {error ? (
        <div className="flex gap-3 rounded-lg border border-[#f0a3a3] bg-[#fdeaea] p-4 text-sm text-[#7a1b1b]" role="alert">
          <AlertCircle className="mt-0.5 h-5 w-5 shrink-0" aria-hidden />
          <span>{error}</span>
        </div>
      ) : null}

      <Button type="submit" size="lg" disabled={saving}>
        <KeyRound className="h-4 w-4" aria-hidden />
        {saving ? "Saving…" : "Set new password"}
      </Button>
    </form>
  );
}
