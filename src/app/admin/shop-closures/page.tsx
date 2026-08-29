import { redirect } from "next/navigation";

export default function ShopClosuresRedirectPage() {
  redirect("/admin/schedule#closed-days");
}
