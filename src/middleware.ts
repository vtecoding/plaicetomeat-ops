import { createServerClient } from "@supabase/ssr";
import { type NextFetchEvent, type NextRequest, NextResponse } from "next/server";

import { canAccessStaffPath, isStaffFacingPath, type StaffRole } from "@/lib/domain/route-access";
import { SECURITY_REASON, securityEventForSession } from "@/lib/domain/security-events";
import { slideEnvelope } from "@/lib/domain/session-envelope";
import { recordSecurityEvent, type SecurityEventInput } from "@/lib/server/security-audit";
import {
  evaluateStaffSession,
  hasStaffSessionSecret,
  signEnvelope,
  STAFF_SESSION_COOKIE,
} from "@/lib/server/staff-session";

export async function middleware(request: NextRequest, event: NextFetchEvent) {
  const { pathname } = request.nextUrl;

  // Fire-and-forget security audit so a denied request is never slowed by it.
  const audit = (input: SecurityEventInput) => {
    const promise = recordSecurityEvent(input);
    if (event && typeof event.waitUntil === "function") {
      event.waitUntil(promise);
    }
  };

  if (!isStaffFacingPath(pathname)) {
    return NextResponse.next();
  }

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!supabaseUrl || !supabaseAnonKey) {
    return redirectHome(request);
  }

  // The staff session envelope is signed/verified with STAFF_SESSION_SECRET (or
  // ORDER_ACCESS_SECRET). Without it, evaluateStaffSession()/signEnvelope() call
  // getSecret() which THROWS in production — an unhandled throw here becomes a
  // 500 MIDDLEWARE_INVOCATION_FAILED on every /admin and /counter route. A
  // missing secret is a configuration fault, not an auth decision, so we fail
  // closed to home (consistent with the Supabase env guard above) instead.
  if (!hasStaffSessionSecret()) {
    console.error("[middleware] staff session secret not configured; denying staff path:", pathname);
    return redirectHome(request);
  }

  try {
    let response = NextResponse.next({
      request,
    });

    const supabase = createServerClient(supabaseUrl, supabaseAnonKey, {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
          response = NextResponse.next({
            request,
          });
          cookiesToSet.forEach(({ name, value, options }) => response.cookies.set(name, value, options));
        },
      },
    });

    // Identity first: a valid Supabase session is required before we trust any
    // activity envelope. getUser() re-validates the JWT server-side, so a tampered,
    // expired, or cross-user auth cookie fails closed here.
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return redirectToLogin(request);
    }

    // Signed, timestamped, user-bound activity envelope. A MISSING envelope is
    // treated as EXPIRED (never silently accepted); a tampered/forged or
    // cross-user envelope is INVALID.
    const sessionToken = request.cookies.get(STAFF_SESSION_COOKIE)?.value;
    const session = await evaluateStaffSession(sessionToken, user.id);

    if (session.status !== "valid") {
      const securityEvent = securityEventForSession(session);
      if (securityEvent) {
        audit({
          reason: securityEvent.reason,
          targetType: "session",
          targetId: user.id,
          metadata: { route: pathname, ...(securityEvent.detail ? { detail: securityEvent.detail } : {}) },
        });
      }

      await supabase.auth.signOut();
      // Timeouts (idle/absolute/missing) send the user back to sign in; a forged or
      // cross-user envelope is a hard authority failure and lands on /unauthorised.
      const target = session.status === "expired" ? redirectToLogin(request) : redirectUnauthorised(request);
      target.cookies.delete(STAFF_SESSION_COOKIE);
      return target;
    }

    const { data: profile } = await supabase
      .from("profiles")
      .select("role,is_active")
      .eq("id", user.id)
      .maybeSingle<{ role: StaffRole | null; is_active: boolean | null }>();

    if (!profile?.is_active || !canAccessStaffPath(profile.role, pathname)) {
      audit({
        reason: SECURITY_REASON.UNAUTHORISED_ROUTE,
        targetType: "authority",
        targetId: user.id,
        metadata: { route: pathname, role: profile?.role ?? null, active: profile?.is_active ?? false },
      });
      return redirectUnauthorised(request);
    }

    // Slide the activity marker forward (idle window) while preserving the original
    // issue time (absolute window), then re-sign.
    const next = slideEnvelope(session.envelope);
    response.cookies.set(STAFF_SESSION_COOKIE, await signEnvelope(next), {
      httpOnly: true,
      sameSite: "lax",
      secure: request.nextUrl.protocol === "https:",
      path: "/",
    });

    return response;
  } catch (error) {
    // Last-resort safety net: a staff route must never surface an unhandled
    // middleware fault as a 500 (MIDDLEWARE_INVOCATION_FAILED). Fail closed to
    // home so the rest of the site stays up while the fault is investigated.
    console.error("[middleware] unexpected failure on staff path:", pathname, error);
    return redirectHome(request);
  }
}

function redirectHome(request: NextRequest) {
  return NextResponse.redirect(new URL("/", request.url));
}

function redirectUnauthorised(request: NextRequest) {
  return NextResponse.redirect(new URL("/unauthorised", request.url));
}

function redirectToLogin(request: NextRequest) {
  const url = new URL("/login", request.url);
  // pathname is internal by construction (matched staff path); pass it through
  // so the login flow can return the user to where they were heading.
  url.searchParams.set("returnTo", request.nextUrl.pathname + request.nextUrl.search);
  return NextResponse.redirect(url);
}

export const config = {
  matcher: ["/counter/:path*", "/admin/:path*"],
};
