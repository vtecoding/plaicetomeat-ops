import Link from "next/link";
import { CalendarOff, ClipboardList, PackageSearch, Settings, ShoppingBag } from "lucide-react";

import { PageFrame } from "@/components/site-header";

const adminLinks = [
  { href: "/admin/products", label: "Products", detail: "Products and categories", icon: PackageSearch },
  { href: "/admin/orders", label: "Orders", detail: "Order history", icon: ShoppingBag },
  { href: "/admin/pickup-windows", label: "Pickup Windows", detail: "Slot configuration", icon: ClipboardList },
  { href: "/admin/shop-closures", label: "Shop Closures", detail: "Bank holidays and closures", icon: CalendarOff },
  { href: "/admin/compliance", label: "Compliance", detail: "Daily records", icon: ClipboardList },
  { href: "/admin/settings", label: "Settings", detail: "Branch and SMS templates", icon: Settings },
];

export default function AdminPage() {
  return (
    <PageFrame>
      <main className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
        <p className="text-sm font-black uppercase tracking-[0.12em] text-[#0f5132]">Manager console</p>
        <h1 className="mt-2 text-3xl font-black">Admin</h1>
        <div className="mt-8 grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {adminLinks.map((item) => (
            <Link key={item.href} href={item.href} className="rounded-lg border border-[#ded6ca] bg-white p-5 shadow-sm transition hover:-translate-y-0.5 hover:shadow-md">
              <item.icon className="h-6 w-6 text-[#0f5132]" aria-hidden />
              <p className="mt-4 text-lg font-black">{item.label}</p>
              <p className="mt-1 text-sm text-[#6c5e52]">{item.detail}</p>
            </Link>
          ))}
        </div>
      </main>
    </PageFrame>
  );
}
