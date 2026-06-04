import { ChecklistPage } from "@/components/ops-capture/checklist-page";

export const dynamic = "force-dynamic";

export default function ClosePage() {
  return <ChecklistPage kind="closing" testid="close-checklist-page" />;
}
