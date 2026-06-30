-- Phase 2 — Information Necessity elimination: the phantom counter customer.
--
-- A walk-in counter sale has no customer. Until now the operator Serve flow had to
-- fabricate a customer to satisfy NOT NULL columns, stamping every shop sale with the
-- fiction name 'Shop sale' and phone '07000000000'. That fiction polluted order data
-- and collapsed every walk-in into one fake "regular" in the customer-intelligence
-- engine (grouped by phone). Stock, audit, money and order lookup all key off
-- branch/order — never the customer — so removing it is safe.
--
-- 1) Allow an order to carry no customer identity (counter sales).
-- 2) Backfill: erase the historical fiction so existing reports stop treating walk-ins
--    as a real phone customer. Scoped tightly to the exact sentinel pair the old code
--    wrote, so no genuine customer order is touched.
--
-- Online checkout is unaffected: create_checkout_order still inserts btrim'd real
-- name/phone, which validation requires before this code path is ever reached.

alter table public.orders alter column customer_name drop not null;
alter table public.orders alter column customer_phone drop not null;

update public.orders
   set customer_name = null,
       customer_phone = null
 where customer_name = 'Shop sale'
   and customer_phone = '07000000000';
