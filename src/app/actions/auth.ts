"use server";

import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";

import { resolvePostLoginPath } from "@/lib/domain/auth";
import type { StaffRole } from "@/lib/domain/route-access";
import { isLoginLocked, recordLoginAttempt } from "@/lib/server/login-attempts";
import { createSupabaseServerClient, createSupabaseServiceClient, hasSupabasePublicEnv } from "@/lib/supabase/server";

const STAFF_LAST_SEEN_COOKIE = "ptm_staff_last_seen";

export type LoginActionState = {
  error: string | null;
};

type ProfileRow = {
  role: StaffRole | null;
  is_active: boolean | null;
};

async function clientIp(): Promise<string | null> {
  const headerStore = await headers();
  const forwarded = headerStore.get("x-forwarded-for");

  if (forwarded) {
    const first = forwarded.split(",")[0]?.trim();
    if (first) {
      return first;
    }
  }

  return headerStore.get("x-real-ip");
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

  const ip = await clientIp();

  const lock = await isLoginLocked(email);
  if (lock.locked) {
    return {
      error: "Too many failed attempts. Please wait a few minutes and try again.",
    };
  }

  let role: StaffRole | null = null;

  try {
    const supabase = await createSupabaseServerClient();
    const { data, error } = await supabase.auth.signInWithPassword({ email, password });

    if (error || !data.user) {
      console.error("loginAction signIn failed", {
        email,
        message: error?.message ?? null,
        status: error?.status ?? null,
        code: error?.code ?? null,
      });
      await recordLoginAttempt({ email, success: false, ipAddress: ip });
      return { error: genericError };
    }

    const profileClient = createSupabaseServiceClient();
    const { data: profile } = await profileClient
      .from("profiles")
      .select("role,is_active")
      .eq("id", data.user.id)
      .maybeSingle<ProfileRow>();

    if (!profile || profile.is_active !== true || !profile.role) {
      console.error("loginAction profile missing or inactive", {
        email,
        userId: data.user.id,
        profile,
      });
      // Authenticated but not an active staff member - refuse and clear session.
      await supabase.auth.signOut();
      await recordLoginAttempt({ email, success: false, ipAddress: ip });
      return { error: genericError };
    }

    role = profile.role;
    await recordLoginAttempt({ email, success: true, ipAddress: ip });
  } catch {
    return { error: "Sign-in failed. Please try again." };
  }

  // Seed the staff "last seen" cookie the middleware uses for idle timeout.
  const cookieStore = await cookies();
  cookieStore.set(STAFF_LAST_SEEN_COOKIE, String(Date.now()), {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
  });

  // redirect() throws NEXT_REDIRECT - must be outside the try/catch above.
  redirect(resolvePostLoginPath(role, returnTo));
}

export async function logoutAction(): Promise<void> {
  if (hasSupabasePublicEnv()) {
    try {
      const supabase = await createSupabaseServerClient();
      await supabase.auth.signOut();
    } catch {
      // ignore - we still clear cookies and redirect below
    }
  }

  const cookieStore = await cookies();
  cookieStore.delete(STAFF_LAST_SEEN_COOKIE);

  redirect("/login");
}
