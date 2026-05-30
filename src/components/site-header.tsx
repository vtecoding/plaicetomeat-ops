import Link from "next/link";
import { Beef, ClipboardCheck, LayoutDashboard, ShoppingBasket } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { demoBranch } from "@/lib/data/demo";

const links = [
  { href: "/shop", label: "Shop", icon: Beef },
  { href: "/basket", label: "Basket", icon: ShoppingBasket },
  { href: "/counter", label: "Counter", icon: LayoutDashboard },
  { href: "/counter/compliance", label: "Compliance", icon: ClipboardCheck },
];

export function SiteHeader() {
  return (
    <header className="sticky top-0 z-30 border-b border-[#e2d9cc] bg-[#fbfaf7]/95 backdrop-blur">
      <div className="mx-auto flex min-h-16 max-w-7xl items-center justify-between gap-4 px-4 sm:px-6 lg:px-8">
        <Link href="/" className="flex min-w-0 items-center gap-3">
          <span className="grid h-10 w-10 shrink-0 place-items-center rounded-md bg-[#0f5132] text-sm font-black text-white">
            PTM
          </span>
          <span className="min-w-0">
            <span className="block truncate text-sm font-black uppercase tracking-[0.08em]">
              PlaiceToMeat Ops
            </span>
            <span className="block truncate text-xs text-[#6c5e52]">{demoBranch.address}</span>
          </span>
        </Link>

        <nav className="hidden items-center gap-1 md:flex">
          {links.map((link) => (
            <Button key={link.href} asChild variant="ghost" size="sm">
              <Link href={link.href}>
                <link.icon className="h-4 w-4" aria-hidden />
                {link.label}
              </Link>
            </Button>
          ))}
        </nav>

        <Badge tone="green" className="hidden sm:inline-flex">
          Pay on collection
        </Badge>
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
