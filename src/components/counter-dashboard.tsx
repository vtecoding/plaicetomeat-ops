"use client";

import {
  AlertCircle,
  CheckCircle2,
  MessageSquare,
  MessageSquareWarning,
  PlayCircle,
  RefreshCw,
  RotateCcw,
  Wifi,
  WifiOff,
  XCircle,
} from "lucide-react";
import { useCallback, useMemo, useState } from "react";

import { addOrderNote, getCounterSnapshot, updateOrderStatus } from "@/app/actions/counter";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { type CounterConnectionState, useCounterRealtime } from "@/lib/client/use-counter-realtime";
import { getNextOrderActions } from "@/lib/domain/order-state";
import { getSmsBadgeState, SMS_BADGE_LABELS, type SmsStatus } from "@/lib/domain/sms";
import type { Order, OrderNote, OrderStatus, PickupWindow } from "@/lib/domain/types";
import { getOrderUrgency } from "@/lib/domain/urgency";
import { cn, formatCurrency, formatTimeRange } from "@/lib/utils";

const columns: { status: OrderStatus; label: string }[] = [
  { status: "incoming", label: "Incoming" },
  { status: "prepping", label: "Prepping" },
  { status: "ready", label: "Ready" },
  { status: "collected", label: "Collected" },
];

const CONNECTION_META: Record<CounterConnectionState, { tone: "green" | "amber" | "red" | "neutral"; label: string }> = {
  connecting: { tone: "neutral", label: "Connecting..." },
  live: { tone: "green", label: "Realtime connected" },
  reconnecting: { tone: "amber", label: "Reconnecting..." },
  stale: { tone: "amber", label: "Updates may be stale" },
  failed: { tone: "red", label: "Realtime unavailable" },
  polling: { tone: "amber", label: "Polling every 15s (realtime off)" },
};

export function CounterDashboard({
  initialOrders,
  initialNotes,
  pickupWindows,
  branchId,
  realtimeMode,
}: {
  initialOrders: Order[];
  initialNotes: Record<string, OrderNote[]>;
  pickupWindows: PickupWindow[];
  branchId: string;
  realtimeMode: "websocket" | "polling" | "auto";
}) {
  const [orders, setOrders] = useState(initialOrders);
  const [notesByOrderId, setNotesByOrderId] = useState(initialNotes);
  const [pending, setPending] = useState<ReadonlySet<string>>(new Set());
  const [error, setError] = useState<string | null>(null);
  const [forcePolling, setForcePolling] = useState(realtimeMode === "polling");

  const windowsById = useMemo(() => new Map(pickupWindows.map((window) => [window.id, window])), [pickupWindows]);

  const refetch = useCallback(async () => {
    const result = await getCounterSnapshot(branchId);
    if ("error" in result) {
      return false;
    }
    setOrders(result.orders);
    setNotesByOrderId(result.notesByOrderId);
    return true;
  }, [branchId]);

  const { state: connectionState } = useCounterRealtime({
    branchId,
    refetch,
    forcePolling: realtimeMode === "polling" || forcePolling,
  });

  const setPendingFor = useCallback((orderId: string, value: boolean) => {
    setPending((current) => {
      const next = new Set(current);
      if (value) {
        next.add(orderId);
      } else {
        next.delete(orderId);
      }
      return next;
    });
  }, []);

  const handleMove = useCallback(
    async (orderId: string, nextStatus: OrderStatus) => {
      setError(null);
      setPendingFor(orderId, true);

      const previousOrders = orders;
      // Optimistic move; rolled back on failure.
      setOrders((current) => current.map((order) => (order.id === orderId ? { ...order, status: nextStatus } : order)));

      const result = await updateOrderStatus({ orderId, nextStatus });
      setPendingFor(orderId, false);

      if (!result.ok) {
        setOrders(previousOrders);
        setError(result.message);
        return;
      }

      setOrders((current) => current.map((order) => (order.id === orderId ? result.order : order)));
    },
    [orders, setPendingFor],
  );

  const handleAddNote = useCallback(async (orderId: string, note: string) => {
    const result = await addOrderNote({ orderId, note });
    if (!result.ok) {
      return result.message;
    }
    setNotesByOrderId((current) => ({ ...current, [orderId]: result.notes }));
    return null;
  }, []);

  const connection = CONNECTION_META[connectionState];

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-[#ded6ca] bg-white p-4">
        <div className="flex items-center gap-3">
          <Badge tone={connection.tone}>
            {connectionState === "live" ? (
              <Wifi className="mr-1 h-3 w-3" aria-hidden />
            ) : (
              <WifiOff className="mr-1 h-3 w-3" aria-hidden />
            )}
            {connection.label}
          </Badge>
          <span className="text-xs font-semibold uppercase tracking-[0.08em] text-[#6c5e52]">
            REALTIME_MODE={realtimeMode}
          </span>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" size="sm" onClick={() => void refetch()}>
            <RefreshCw className="h-4 w-4" aria-hidden />
            Refresh
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => setForcePolling((value) => !value)}
            title="Switch between realtime and polling"
          >
            <RotateCcw className="h-4 w-4" aria-hidden />
            {forcePolling ? "Resume realtime" : "Use polling"}
          </Button>
        </div>
      </div>

      {error ? (
        <div className="flex gap-3 rounded-lg border border-[#f0a3a3] bg-[#fdeaea] p-4 text-sm text-[#7a1b1b]" role="alert">
          <AlertCircle className="mt-0.5 h-5 w-5 shrink-0" aria-hidden />
          <span>{error}</span>
        </div>
      ) : null}

      <div className="grid gap-4 xl:grid-cols-4">
        {columns.map((column) => {
          const columnOrders = orders
            .filter((order) => order.status === column.status)
            .sort((a, b) => {
              const aWindow = a.pickupWindowId ? windowsById.get(a.pickupWindowId) : undefined;
              const bWindow = b.pickupWindowId ? windowsById.get(b.pickupWindowId) : undefined;
              return (aWindow?.startTime ?? "99:99").localeCompare(bWindow?.startTime ?? "99:99");
            });

          return (
            <section key={column.status} className="min-h-[520px] rounded-lg border border-[#ded6ca] bg-[#f7f3ed]">
              <header className="flex h-14 items-center justify-between border-b border-[#ded6ca] px-4">
                <h2 className="font-black">{column.label}</h2>
                <Badge tone="neutral">{columnOrders.length}</Badge>
              </header>
              <div className="space-y-3 p-3">
                {columnOrders.map((order) => (
                  <CounterOrderCard
                    key={order.id}
                    order={order}
                    notes={notesByOrderId[order.id] ?? []}
                    pickupWindow={order.pickupWindowId ? windowsById.get(order.pickupWindowId) : undefined}
                    isPending={pending.has(order.id)}
                    onMove={handleMove}
                    onAddNote={handleAddNote}
                  />
                ))}
              </div>
            </section>
          );
        })}
      </div>
    </div>
  );
}

function CounterOrderCard({
  order,
  notes,
  pickupWindow,
  isPending,
  onMove,
  onAddNote,
}: {
  order: Order;
  notes: OrderNote[];
  pickupWindow: PickupWindow | undefined;
  isPending: boolean;
  onMove: (orderId: string, nextStatus: OrderStatus) => void;
  onAddNote: (orderId: string, note: string) => Promise<string | null>;
}) {
  const urgency = getOrderUrgency(order, pickupWindow);
  const nextActions = getNextOrderActions(order.status);
  const smsState = getSmsBadgeState(order.readySmsSentAt, order.smsFailureReason, order.smsStatus);
  const phoneHref = `tel:${order.customerPhone.replace(/[^\d+]/g, "")}`;

  return (
    <article
      className={cn(
        "animate-[fade-in_180ms_ease-out] rounded-lg border bg-white p-4 shadow-sm",
        urgency === "amber" && "border-[#d99b22]",
        urgency === "red" && "border-[#b42318]",
        urgency === "passed" && "animate-pulse border-[#b42318]",
        urgency === "normal" && "border-[#e4dbcf]",
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <p className="text-2xl font-black tracking-normal">{order.orderRef}</p>
            {order.isTest && (
              <Badge tone="amber" data-testid="test-order-badge">
                TEST ORDER
              </Badge>
            )}
          </div>
          <p className="font-semibold text-[#5c5148]">{order.customerName}</p>
          <a className="mt-1 block text-sm font-bold text-[#0f5132]" href={phoneHref}>
            {formatPhone(order.customerPhone)}
          </a>
        </div>
        <SmsBadge state={smsState} />
      </div>

      <div className="mt-4 rounded-md bg-[#fbfaf7] p-3 text-sm">
        <p className="font-bold">{pickupWindow?.label ?? "Pickup window"}</p>
        {pickupWindow && (
          <p className="text-[#6c5e52]">{formatTimeRange(pickupWindow.startTime, pickupWindow.endTime)}</p>
        )}
        <p className="mt-1 font-semibold text-[#7a4b00]">{urgencyLabel(order, pickupWindow)}</p>
        <p className="text-xs text-[#6c5e52]">{statusAge(order)}</p>
      </div>

      <div className="mt-4 text-sm">
        <p className="font-semibold">
          {order.items.length} item{order.items.length === 1 ? "" : "s"} - {formatCurrency(order.subtotal)}
        </p>
        <ul className="mt-2 space-y-1 text-[#5c5148]">
          {order.items.map((item) => (
            <li key={item.id}>
              {item.quantity} {item.unitType} {item.productNameSnapshot}
            </li>
          ))}
        </ul>
        {order.notes && <p className="mt-2 text-xs font-semibold text-[#7a4b00]">Customer note attached</p>}
      </div>

      <StaffNotes notes={notes} orderId={order.id} onAddNote={onAddNote} />

      {nextActions.length > 0 && (
        <div className="mt-4 grid gap-2">
          {nextActions.map((action) => (
            <Button
              key={action}
              variant={action === "cancelled" ? "destructive" : "default"}
              size="lg"
              disabled={isPending}
              onClick={() => {
                if (action === "cancelled" && !window.confirm("Cancel this order?")) {
                  return;
                }
                onMove(order.id, action);
              }}
            >
              {action === "prepping" && <PlayCircle className="h-4 w-4" aria-hidden />}
              {action === "ready" && <CheckCircle2 className="h-4 w-4" aria-hidden />}
              {action === "collected" && <CheckCircle2 className="h-4 w-4" aria-hidden />}
              {action === "cancelled" && <XCircle className="h-4 w-4" aria-hidden />}
              {isPending ? "Working..." : labelForAction(action)}
            </Button>
          ))}
        </div>
      )}
    </article>
  );
}

function StaffNotes({
  notes,
  orderId,
  onAddNote,
}: {
  notes: OrderNote[];
  orderId: string;
  onAddNote: (orderId: string, note: string) => Promise<string | null>;
}) {
  const [draft, setDraft] = useState("");
  const [saving, setSaving] = useState(false);
  const [noteError, setNoteError] = useState<string | null>(null);

  async function submit() {
    const trimmed = draft.trim();
    if (trimmed.length === 0) {
      setNoteError("Note cannot be empty.");
      return;
    }
    setSaving(true);
    setNoteError(null);
    const message = await onAddNote(orderId, trimmed);
    setSaving(false);
    if (message) {
      setNoteError(message);
      return;
    }
    setDraft("");
  }

  return (
    <div className="mt-4 border-t border-[#eee5d8] pt-3">
      <p className="flex items-center gap-1 text-xs font-bold uppercase tracking-[0.08em] text-[#6c5e52]">
        <MessageSquare className="h-3 w-3" aria-hidden />
        Staff notes (internal) · {notes.length}
      </p>

      {notes.length > 0 && (
        <ul className="mt-2 space-y-2">
          {notes.map((note) => (
            <li key={note.id} data-testid="staff-note" className="rounded-md bg-[#f7f3ed] p-2 text-xs text-[#5c5148]">
              <p>{note.note}</p>
              <p className="mt-1 text-[10px] text-[#8a7d70]">
                {note.authorName ?? "Staff"} · {new Date(note.createdAt).toLocaleTimeString()}
              </p>
            </li>
          ))}
        </ul>
      )}

      <div className="mt-2 grid gap-2">
        <Textarea
          aria-label="Add staff note"
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          maxLength={1000}
          rows={2}
          placeholder="Add an internal note"
          disabled={saving}
        />
        {noteError ? <p className="text-xs text-[#b42318]">{noteError}</p> : null}
        <Button variant="outline" size="sm" onClick={() => void submit()} disabled={saving || draft.trim().length === 0}>
          {saving ? "Saving..." : "Add note"}
        </Button>
      </div>
    </div>
  );
}

function formatPhone(phone: string) {
  return phone.replace(/^\+44/, "0").replace(/(\d{5})(\d{3})(\d+)/, "$1 $2 $3");
}

function statusAge(order: Order) {
  const minutes = Math.max(0, Math.floor((Date.now() - new Date(order.createdAt).getTime()) / 60_000));
  const label = order.status === "incoming" ? "received" : order.status;
  return `${label} ${minutes < 1 ? "just now" : `${minutes} min ago`}`;
}

function urgencyLabel(order: Order, pickupWindow: PickupWindow | undefined) {
  if (!pickupWindow) return "Pickup time not set";
  const [hours, minutes] = pickupWindow.startTime.split(":").map(Number);
  const pickup = new Date(`${order.pickupDate}T00:00:00`);
  pickup.setHours(hours ?? 0, minutes ?? 0, 0, 0);
  const diffMinutes = Math.round((pickup.getTime() - Date.now()) / 60_000);
  if (diffMinutes < 0) return "Overdue";
  if (diffMinutes <= 15) return "Due now";
  if (diffMinutes <= 60) return "Due in 15 min";
  return "Later today";
}

function SmsBadge({ state }: { state: SmsStatus }) {
  const label = SMS_BADGE_LABELS[state];

  if (state === "sent") {
    return (
      <Badge tone="green" data-testid="sms-badge" data-sms-status={state}>
        {label}
      </Badge>
    );
  }

  if (state === "failed") {
    return (
      <Badge tone="red" data-testid="sms-badge" data-sms-status={state}>
        <MessageSquareWarning className="mr-1 h-3 w-3" aria-hidden />
        {label}
      </Badge>
    );
  }

  if (state === "dry_run" || state === "queued") {
    return (
      <Badge tone="amber" data-testid="sms-badge" data-sms-status={state}>
        {label}
      </Badge>
    );
  }

  return (
    <Badge tone="neutral" data-testid="sms-badge" data-sms-status={state}>
      {label}
    </Badge>
  );
}

function labelForAction(status: OrderStatus) {
  switch (status) {
    case "prepping":
      return "Start Prep";
    case "ready":
      return "Mark Ready";
    case "collected":
      return "Collected";
    case "cancelled":
      return "Cancel";
    default:
      return status;
  }
}
