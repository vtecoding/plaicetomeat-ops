import { redirect } from "next/navigation";

// V11.3 — Briefing retired. "One door per job": Today is the only operational home,
// and the briefing's analysis (health score, coaching findings, weekly report,
// confidence) now lives on the single analysis hub at /admin ("Business Insights").
// This route redirects so any existing link/bookmark lands on Today.
export default function BriefingRedirectPage() {
  redirect("/admin/today");
}
