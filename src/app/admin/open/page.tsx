import { ChecklistPage } from "@/components/ops-capture/checklist-page";

export const dynamic = "force-dynamic";

export default function OpenPage() {
  return <ChecklistPage kind="opening" testid="open-checklist-page" />;
}
