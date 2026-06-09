// Audit probe: prove whether collecting an order moves inventory. LOCAL only.
import { createClient } from "@supabase/supabase-js";
const URL = "http://127.0.0.1:54321";
const KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU";
const db = createClient(URL, KEY, { auth: { persistSession: false } });

const sale = await db.from("inventory_movements").select("id", { count: "exact", head: true }).eq("movement_type", "SALE");
const batches = await db.from("inventory_batches").select("id,remaining_weight_kg,status,product_id").eq("status", "active");
const orders = await db.from("orders").select("order_ref,status").in("status", ["ready", "collected"]).order("order_ref");
const totalStock = (batches.data || []).reduce((s, b) => s + Number(b.remaining_weight_kg), 0);

console.log(JSON.stringify({
  SALE_movements_ever: sale.count,
  active_batches: (batches.data || []).length,
  total_active_kg: Number(totalStock.toFixed(3)),
  ready_or_collected_orders: orders.data,
}, null, 2));
