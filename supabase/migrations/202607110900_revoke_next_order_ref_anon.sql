-- Revoke anon/PUBLIC execution of next_order_ref (PTM-SEC-003).
--
-- next_order_ref(uuid, date) advances public.order_annual_sequences and returns
-- the next human order reference (PTM-YYYY-NNNNN). It is only ever invoked from
-- trusted internal command paths:
--
--   * create_checkout_order   -- SECURITY DEFINER; runs as the function owner, so
--                                it does NOT need a direct role EXECUTE grant.
--   * operator serve action   -- server-side only, uses the service_role client.
--
-- No browser / anon / authenticated code path calls it directly (verified by a
-- full src/ scan: the sole caller is src/app/actions/operator/serve.ts via the
-- service-role client). Legacy Supabase CLI defaults nonetheless granted EXECUTE
-- to anon + PUBLIC, so an unauthenticated caller holding the public anon key could
-- POST /rest/v1/rpc/next_order_ref and advance the order-number sequence — causing
-- accounting-continuity gaps and an unthrottled numbering DoS (the rate limiter
-- lives in the server action, not the RPC).
--
-- Fail closed: strip EXECUTE from every role that does not require direct
-- execution, and keep it only for the trusted internal command path (service_role).
-- Expand-safe: no signature change, no behaviour change for checkout or serve.

REVOKE EXECUTE ON FUNCTION public.next_order_ref(uuid, date) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.next_order_ref(uuid, date) TO service_role;
