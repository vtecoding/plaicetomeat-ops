import { createServerClient } from "@supabase/ssr";
import { type NextRequest, NextResponse } from "next/server";

import { canAccessStaffPath, isStaffFacingPath, isStaffSessionExpired, type StaffRole } from "@/lib/domain/route-access";

const STAFF_LAST_SEEN_COOKIE = "ptm_staff_last_seen";

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  if (!isStaffFacingPath(pathname)) {
    return NextResponse.next();
  }

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!supabaseUrl || !supabaseAnonKey) {
    return redirectHome(request);
  }

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

  const lastSeen = request.cookies.get(STAFF_LAST_SEEN_COOKIE)?.value;

  if (isStaffSessionExpired(lastSeen)) {
    await supabase.auth.signOut();

    const expiredResponse = redirectHome(request);
    expiredResponse.cookies.delete(STAFF_LAST_SEEN_COOKIE);

    return expiredResponse;
  }

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return redirectHome(request);
  }

  const { data: profile } = await supabase
    .from("profiles")
    .select("role,is_active")
    .eq("id", user.id)
    .maybeSingle<{ role: StaffRole | null; is_active: boolean | null }>();

  if (!profile?.is_active || !canAccessStaffPath(profile.role, pathname)) {
    return redirectHome(request);
  }

  response.cookies.set(STAFF_LAST_SEEN_COOKIE, String(Date.now()), {
    httpOnly: true,
    sameSite: "lax",
    secure: request.nextUrl.protocol === "https:",
    path: "/",
  });

  return response;
}

function redirectHome(request: NextRequest) {
  return NextResponse.redirect(new URL("/", request.url));
}

export const config = {
  matcher: ["/counter/:path*", "/admin/:path*", "/compliance/:path*"],
};
