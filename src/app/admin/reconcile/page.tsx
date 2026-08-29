import { redirect } from "next/navigation";

export default async function ReconcileRedirectPage({
  searchParams,
}: {
  searchParams: Promise<{ alert?: string }>;
}) {
  const { alert } = await searchParams;
  const target = alert
    ? "/admin/today?alert=" + encodeURIComponent(alert) + "#owner-jobs"
    : "/admin/today#owner-jobs";
  redirect(target);
}
