import Link from "next/link";
import { LogIn } from "lucide-react";

import { LogoutButton } from "@/components/logout-button";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { resolveNav } from "@/lib/domain/site-nav";
import { getCurrentProfile } from "@/lib/server/auth";
import { getPublicBranchResult } from "@/lib/server/catalog";

/** A small butcher's-stamp seal carrying a serif monogram — the brand mark. */
function BrandSeal() {
  return (
    <span className="relative grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-gradient-to-b from-[#13653e] to-[#0a3a24] text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.28),0_8px_18px_-10px_rgba(15,81,50,0.7)] ring-1 ring-[#0a3a24]">
      <span className="font-display text-lg font-semibold italic leading-none">P</span>
      <span aria-hidden className="pointer-events-none absolute inset-[3px] rounded-lg ring-1 ring-white/15" />
    </span>
  );
}

export async function SiteHeader() {
  const [profile, branchResult] = await Promise.all([getCurrentProfile(), getPublicBranchResult()]);
  const branchAddress = branchResult.data?.address ?? "Branch configuration required";

  const { primary, shopView } = resolveNav(profile?.role);

  return (
    <header className="sticky top-0 z-30 border-b border-[var(--line)] bg-[var(--paper)]/85 backdrop-blur-md">
      <div className="mx-auto flex min-h-16 max-w-7xl items-center justify-between gap-4 px-4 sm:px-6 lg:px-8">
        <Link href="/" className="group flex min-w-0 items-center gap-3">
          <BrandSeal />
          <span className="min-w-0">
            <span className="block truncate font-display text-[17px] font-semibold leading-none tracking-[-0.01em] text-[var(--ink)]">
              PlaiceToMeat
            </span>
            <span className="mt-1 block truncate text-xs font-medium text-[var(--muted)]">{branchAddress}</span>
          </span>
        </Link>

        <nav className="hidden items-center gap-1 md:flex" aria-label={shopView ? "Staff tools" : "Shop"}>
          {primary.map((link) => (
            <Button key={link.href} asChild variant="ghost" size="sm">
              <Link href={link.href}>
                <link.icon className="h-4 w-4" aria-hidden />
                {link.label}
              </Link>
            </Button>
          ))}
          {shopView && (
            <>
              <span aria-hidden className="mx-1 h-5 w-px bg-[var(--line-strong)]" />
              <Button asChild variant="ghost" size="sm">
                <Link href={shopView.href} className="text-[var(--muted)]" data-testid="nav-shop-view">
                  <shopView.icon className="h-4 w-4" aria-hidden />
                  Shop view
                </Link>
              </Button>
            </>
          )}
        </nav>

        <div className="flex items-center gap-2">
          {profile ? (
            <>
              <Badge tone="green" className="hidden sm:inline-flex">
                {profile.fullName ?? profile.email}
              </Badge>
              <LogoutButton />
            </>
          ) : (
            <Button asChild variant="outline" size="sm">
              <Link href="/login">
                <LogIn className="h-4 w-4" aria-hidden />
                Staff login
              </Link>
            </Button>
          )}
        </div>
      </div>
    </header>
  );
}

export function PageFrame({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen">
      <SiteHeader />
      {children}
    </div>
  );
}
