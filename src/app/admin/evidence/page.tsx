import { redirect } from "next/navigation";

export default function EvidenceRedirectPage() {
  redirect("/admin/compliance#supporting-files");
}
