"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";

import { resolvePostLoginPath } from "@/lib/domain/auth";
import { SECURITY_REASON } from "@/lib/domain/security-events";
import { issueEnvelope } from "@/lib/domain/session-envelope";
import type { StaffRole } from "@/lib/domain/route-access";
import { isLoginLocked, recordLoginAttempt } from "@/lib/server/login-attempts";
import { clientNetworkHash, hashIdentity } from "@/lib/server/rate-limit";
import { recordSecurityEvent } from "@/lib/server/security-audit";
import { signEnvelope, STAFF_SESSION_COOKIE } from "@/lib/server/staff-session";
import { createSupabaseServerClient, createSupabaseServiceClient, hasSupabasePublicEnv } from "@/lib/supabase/server";

export type LoginActionState = {
  error: string | null;
};

export type LogoutActionState = {
  error: string | null;
};

type ProfileRow = {
  role: StaffRole | null;
  is_active: boolean | null;
};

async function setStaffSessionCookie(userId: string): Promise<void> {
  const cookieStore = await cookies();
  cookieStore.set(STAFF_SESSION_COOKIE, await signEnvelope(issueEnvelope(userId)), {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
  });
}

export async function loginAction(_prev: LoginActionState, formData: FormData): Promise<LoginActionState> {
  const email = String(formData.get("email") ?? "")
    .trim()
    .toLowerCase();
  const password = String(formData.get("password") ?? "");
  const returnTo = formData.get("returnTo") ? String(formData.get("returnTo")) : null;

  // Generic message reused for every failure mode to avoid user enumeration.
  const genericError = "Invalid email or password.";

  if (!email || !password) {
    return { error: "Enter your email and password." };
  }

  if (!hasSupabasePublicEnv()) {
    return { error: "Sign-in is not available yet. Supabase is not configured." };
  }

  // Hashed, salted signals — never a raw email or IP (no PII at rest or in logs).
  const networkHash = await clientNetworkHash();
  const emailHash = hashIdentity("email", email);
  const securityMeta = { emailHash, networkHash };

  const lock = await isLoginLocked({ email, networkHash });
  if (lock.locked) {
    await recordSecurityEvent({ reason: SECURITY_REASON.LOGIN_LOCKED_OUT, targetType: "auth", metadata: securityMeta });
    return {
      error: "Too many failed attempts. Please wait a few minutes and try again.",
    };
  }

  let role: StaffRole | null = null;
  let userId: string | null = null;

  try {
    const supabase = await createSupabaseServerClient();
    const { data, error } = await supabase.auth.signInWithPassword({ email, password });

    if (error || !data.user) {
      // No PII: log only non-identifying failure metadata.
      console.error("[auth] sign-in failed", { code: error?.code ?? null, status: error?.status ?? null });
      await recordLoginAttempt({ email, success: false, networkHash });
      await recordSecurityEvent({ reason: SECURITY_REASON.LOGIN_FAILED, targetType: "auth", metadata: securityMeta });
      return { error: genericError };
    }

    const profileClient = createSupabaseServiceClient();
    const { data: profile } = await profileClient
      .from("profiles")
      .select("role,is_active")
      .eq("id", data.user.id)
      .maybeSingle<ProfileRow>();

    if (!profile || profile.is_active !== true || !profile.role) {
      // No PII: do not log the email or the profile row.
      console.error("[auth] authenticated account is not active staff");
      // Authenticated but not an active staff member - refuse and clear session.
      await supabase.auth.signOut();
      await recordLoginAttempt({ email, success: false, networkHash });
      await recordSecurityEvent({ reason: SECURITY_REASON.LOGIN_FAILED, targetType: "auth", metadata: { ...securityMeta, detail: "inactive_or_no_role" } });
      return { error: genericError };
    }

    role = profile.role;
    userId = data.user.id;
    await recordLoginAttempt({ email, success: true, networkHash });
  } catch {
    return { error: "Sign-in failed. Please try again." };
  }

  // Seed the signed, user-bound staff session envelope the middleware enforces.
  await setStaffSessionCookie(userId);

  // redirect() throws NEXT_REDIRECT - must be outside the try/catch above.
  redirect(resolvePostLoginPath(role, returnTo));
}

export async function logoutAction(_prev: LogoutActionState, _formData: FormData): Promise<LogoutActionState> {
  if (hasSupabasePublicEnv()) {
    let supabase;
    try {
      supabase = await createSupabaseServerClient();
    } catch {
      return { error: "Sign-out is unavailable right now. Please try again." };
    }

    // Do NOT swallow a failed sign-out: if Supabase fails to revoke the session
    // the user is still signed in, so surface it instead of pretending success.
    const { error } = await supabase.auth.signOut();
    if (error) {
      console.error("[auth] sign-out failed", { code: error.code ?? null, status: error.status ?? null });
      await recordSecurityEvent({ reason: SECURITY_REASON.LOGOUT_FAILED, targetType: "auth" });
      return { error: "We couldn't fully sign you out. Please try again." };
    }
  }

  const cookieStore = await cookies();
  cookieStore.delete(STAFF_SESSION_COOKIE);

  // redirect() throws NEXT_REDIRECT - only reached on a clean sign-out.
  redirect("/login");
}
