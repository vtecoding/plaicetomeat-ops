import Link from "next/link";
import { LogIn } from "lucide-react";

import { LogoutButton } from "@/components/logout-button";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { resolveNav } from "@/lib/domain/site-nav";
import { getCurrentProfile } from "@/lib/server/auth";
import { getPublicBranchResult } from "@/lib/server/catalog";

export async function SiteHeader() {
  const [profile, branchResult] = await Promise.all([getCurrentProfile(), getPublicBranchResult()]);
  const branchAddress = branchResult.data?.address ?? "Branch configuration required";

  const { primary, shopView } = resolveNav(profile?.role);

  return (
    <header className="sticky top-0 z-30 border-b border-[#e2d9cc] bg-[#fbfaf7]/95 backdrop-blur">
      <div className="mx-auto flex min-h-16 max-w-7xl items-center justify-between gap-4 px-4 sm:px-6 lg:px-8">
        <Link href="/" className="flex min-w-0 items-center gap-3">
          <span className="grid h-10 w-10 shrink-0 place-items-center rounded-md bg-[#0f5132] text-sm font-black text-white">
            PTM
          </span>
          <span className="min-w-0">
            <span className="block truncate text-sm font-black uppercase tracking-[0.08em]">
              PlaiceToMeat
            </span>
            <span className="block truncate text-xs text-[#6c5e52]">{branchAddress}</span>
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
              <span aria-hidden className="mx-1 h-5 w-px bg-[#e2d9cc]" />
              <Button asChild variant="ghost" size="sm">
                <Link href={shopView.href} className="text-[#6c5e52]" data-testid="nav-shop-view">
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
    <div className="min-h-screen bg-[#fbfaf7]">
      <SiteHeader />
      {children}
    </div>
  );
}
