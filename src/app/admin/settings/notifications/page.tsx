import { NotificationSettings } from "./notification-settings";
import { PageFrame } from "@/components/site-header";
import { BackLink, Masthead, Surface } from "@/components/ui/page";
import { listOwnerNotificationDevices } from "@/lib/server/notification-devices";
import { requireStaffContext } from "@/lib/server/staff-context";
export const dynamic="force-dynamic";
export default async function NotificationSettingsPage(){await requireStaffContext("owner",{branchScoped:true});const devices=await listOwnerNotificationDevices();return <PageFrame><main className="mx-auto max-w-3xl px-4 py-8 sm:px-6"><Masthead back={<BackLink href="/admin/settings">Back to settings</BackLink>} eyebrow="Owner notifications" title="Notification devices" subtitle="Verify each browser before PTM sends real shop alerts to it."/><Surface className="mt-6 p-5"><NotificationSettings initialDevices={devices}/></Surface></main></PageFrame>}
