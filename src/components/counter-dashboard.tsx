"use client";

import { Bell, CheckCircle2, MessageSquareWarning, PauseCircle, PlayCircle, RotateCcw, XCircle } from "lucide-react";
import { useMemo, useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { demoPickupWindows } from "@/lib/data/demo";
import { getNextOrderActions } from "@/lib/domain/order-state";
import type { Order, OrderStatus, PickupWindow } from "@/lib/domain/types";
import { getOrderUrgency } from "@/lib/domain/urgency";
import { cn, formatCurrency, formatTimeRange } from "@/lib/utils";

const columns: { status: OrderStatus; label: string }[] = [
  { status: "incoming", label: "Incoming" },
  { status: "prepping", label: "Prepping" },
  { status: "ready", label: "Ready" },
  { status: "collected", label: "Collected" },
];

export function CounterDashboard({ initialOrders }: { initialOrders: Order[] }) {
  const [orders, setOrders] = useState(initialOrders);
  const [incomingAlertCount, setIncomingAlertCount] = useState(0);
  const [liveMode, setLiveMode] = useState<"realtime" | "polling">("realtime");

  const windowsById = useMemo(
    () => new Map(demoPickupWindows.map((window) => [window.id, window])),
    [],
  );

  function playNewOrderTone() {
    const AudioContextClass =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    const context = new AudioContextClass();
    const oscillator = context.createOscillator();
    const gain = context.createGain();

    oscillator.type = "sine";
    oscillator.frequency.value = 880;
    gain.gain.value = 0.05;
    oscillator.connect(gain);
    gain.connect(context.destination);
    oscillator.start();
    oscillator.stop(context.currentTime + 0.18);
  }

  function simulateNewOrder() {
    const nextOrder: Order = {
      ...orders[0],
      id: crypto.randomUUID(),
      orderRef: `PTM-${new Date().toISOString().slice(2, 10).replaceAll("-", "")}-${String(orders.length + 45).padStart(4, "0")}`,
      customerName: "New customer",
      status: "incoming",
      createdAt: new Date().toISOString(),
      readySmsSentAt: null,
    };

    setOrders((current) => [nextOrder, ...current]);
    setIncomingAlertCount((current) => current + 1);
    playNewOrderTone();
  }

  function moveOrder(orderId: string, nextStatus: OrderStatus) {
    setOrders((current) =>
      current.map((order) =>
        order.id === orderId
          ? {
              ...order,
              status: nextStatus,
              readySmsSentAt: nextStatus === "ready" ? new Date().toISOString() : order.readySmsSentAt,
            }
          : order,
      ),
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-[#ded6ca] bg-white p-4">
        <div className="flex items-center gap-3">
          <Badge tone={liveMode === "realtime" ? "green" : "amber"}>
            {liveMode === "realtime" ? "Realtime connected" : "Live updates paused"}
          </Badge>
          {liveMode === "polling" && (
            <span className="text-sm text-[#7a4b00]">Checking every 30 seconds.</span>
          )}
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" size="sm" onClick={() => setLiveMode(liveMode === "realtime" ? "polling" : "realtime")}>
            <RotateCcw className="h-4 w-4" aria-hidden />
            Toggle fallback
          </Button>
          <Button size="sm" onClick={simulateNewOrder}>
            <Bell className="h-4 w-4" aria-hidden />
            Simulate new order
          </Button>
        </div>
      </div>

      <div className="grid gap-4 xl:grid-cols-4">
        {columns.map((column) => {
          const columnOrders = orders.filter((order) => order.status === column.status);

          return (
            <section key={column.status} className="min-h-[520px] rounded-lg border border-[#ded6ca] bg-[#f7f3ed]">
              <header className="flex h-14 items-center justify-between border-b border-[#ded6ca] px-4">
                <h2 className="font-black">{column.label}</h2>
                <Badge tone={column.status === "incoming" && incomingAlertCount > 0 ? "amber" : "neutral"}>
                  {column.status === "incoming" && incomingAlertCount > 0 ? incomingAlertCount : columnOrders.length}
                </Badge>
              </header>
              <div className="space-y-3 p-3">
                {columnOrders.map((order) => (
                  <CounterOrderCard
                    key={order.id}
                    order={order}
                    pickupWindow={order.pickupWindowId ? windowsById.get(order.pickupWindowId) : undefined}
                    onMove={moveOrder}
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
  pickupWindow,
  onMove,
}: {
  order: Order;
  pickupWindow: PickupWindow | undefined;
  onMove: (orderId: string, nextStatus: OrderStatus) => void;
}) {
  const urgency = getOrderUrgency(order, pickupWindow);
  const nextActions = getNextOrderActions(order.status);
  const smsState = order.readySmsSentAt ? "sent" : order.smsFailureReason ? "failed" : "pending";

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
          <p className="text-2xl font-black tracking-normal">{order.orderRef}</p>
          <p className="font-semibold text-[#5c5148]">{order.customerName}</p>
        </div>
        <SmsBadge state={smsState} />
      </div>

      <div className="mt-4 rounded-md bg-[#fbfaf7] p-3 text-sm">
        <p className="font-bold">{pickupWindow?.label ?? "Pickup window"}</p>
        {pickupWindow && (
          <p className="text-[#6c5e52]">{formatTimeRange(pickupWindow.startTime, pickupWindow.endTime)}</p>
        )}
      </div>

      <div className="mt-4 text-sm">
        <p className="font-semibold">
          {order.items.length} item{order.items.length === 1 ? "" : "s"} - {formatCurrency(order.subtotal)}
        </p>
        <ul className="mt-2 space-y-1 text-[#5c5148]">
          {order.items.slice(0, 2).map((item) => (
            <li key={item.id}>
              {item.quantity} {item.unitType} {item.productNameSnapshot}
            </li>
          ))}
        </ul>
        {order.notes && <p className="mt-2 text-xs font-semibold text-[#7a4b00]">Notes attached</p>}
      </div>

      {nextActions.length > 0 && (
        <div className="mt-4 grid gap-2">
          {nextActions.map((action) => (
            <Button
              key={action}
              variant={action === "cancelled" ? "destructive" : "default"}
              size="lg"
              onClick={() => {
                if (action === "cancelled" && !window.confirm("Cancel this order?")) {
                  return;
                }

                onMove(order.id, action);
              }}
            >
              {action === "prepping" && <PlayCircle className="h-4 w-4" aria-hidden />}
              {action === "ready" && <PauseCircle className="h-4 w-4" aria-hidden />}
              {action === "collected" && <CheckCircle2 className="h-4 w-4" aria-hidden />}
              {action === "cancelled" && <XCircle className="h-4 w-4" aria-hidden />}
              {labelForAction(action)}
            </Button>
          ))}
        </div>
      )}
    </article>
  );
}

function SmsBadge({ state }: { state: "sent" | "failed" | "pending" }) {
  if (state === "sent") {
    return <Badge tone="green">SMS sent</Badge>;
  }

  if (state === "failed") {
    return (
      <Badge tone="red">
        <MessageSquareWarning className="mr-1 h-3 w-3" aria-hidden />
        SMS failed
      </Badge>
    );
  }

  return <Badge tone="neutral">SMS pending</Badge>;
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
