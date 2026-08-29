import { redirect } from "next/navigation";

export default function PickupWindowsRedirectPage() {
  redirect("/admin/schedule#collection-times");
}
