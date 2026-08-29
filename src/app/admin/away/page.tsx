import { redirect } from "next/navigation";

export default function OwnerAwayRedirectPage() {
  redirect("/admin/today#owner-oversight");
}
