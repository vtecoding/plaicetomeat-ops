# Owner alert delivery

Use this when Setup or Owner Away says phone delivery is missing or failing.

1. Open **Owner jobs** first. The in-app job is authoritative even when phone
   delivery is unavailable.
2. If the page says **No delivery channel set**, check the owner-alert secrets,
   the explicit at-most-once acceptance switch, and the branch owner contact.
   The warning is based on the worker's durable heartbeat, not the web process's
   environment. If the heartbeat is missing or older than 20 minutes, inspect
   the latest **Owner Alert Dispatch** workflow run before changing secrets.
3. If it says delivery needs attention, do not blindly resend a terminal or
   uncertain Twilio attempt. Resolve the shop problem from Owner jobs and inspect
   the workflow log before deciding on a manual phone call.
4. For a field check, run **Owner Alert Dispatch** manually with `field_proof`
   enabled after creating one seeded critical alert. A green run proves Twilio
   accepted every claimed message, not that the handset received it.
5. Record the handset receipt time separately for gate G-B1.

Turning the channel off stops external sends but keeps Owner jobs and the Help
screen's tap-to-call fallback available.
