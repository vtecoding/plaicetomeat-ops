| Pattern | Tested route | Role | Dynamic resolved | Desktop result |
|---|---:|---|---|---|
| `/` | `/` | anon | yes | covered |
| `/admin` | `/admin` | owner | yes | covered |
| `/admin/audit` | `/admin/audit` | owner | yes | covered |
| `/admin/away` | `/admin/away` | owner | yes | covered |
| `/admin/briefing` | `/admin/briefing` | owner | yes | redirect -> /admin/today |
| `/admin/close` | `/admin/close` | owner | yes | covered |
| `/admin/compliance` | `/admin/compliance` | owner | yes | covered |
| `/admin/cutting-guide` | `/admin/cutting-guide` | owner | yes | covered |
| `/admin/evidence` | `/admin/evidence` | owner | yes | covered |
| `/admin/guide` | `/admin/guide` | owner | yes | covered |
| `/admin/inventory` | `/admin/inventory` | owner | yes | covered |
| `/admin/open` | `/admin/open` | owner | yes | covered |
| `/admin/orders` | `/admin/orders` | owner | yes | covered |
| `/admin/pickup-windows` | `/admin/pickup-windows` | owner | yes | covered |
| `/admin/playbooks` | `/admin/playbooks` | owner | yes | covered |
| `/admin/playbooks/[slug]` | `/admin/playbooks/butcher-words` | owner | yes | covered |
| `/admin/products` | `/admin/products` | owner | yes | covered |
| `/admin/purchasing` | `/admin/purchasing` | owner | yes | covered |
| `/admin/releases` | `/admin/releases` | owner | yes | covered |
| `/admin/settings` | `/admin/settings` | owner | yes | covered |
| `/admin/setup` | `/admin/setup` | owner | yes | covered |
| `/admin/shop-closures` | `/admin/shop-closures` | owner | yes | covered |
| `/admin/stock-count` | `/admin/stock-count` | owner | yes | covered |
| `/admin/today` | `/admin/today` | owner | yes | covered |
| `/admin/today/[id]` | `/admin/today/action-system-realtime-degraded` | owner | yes | covered |
| `/admin/today/walk` | `/admin/today/walk` | owner | yes | covered |
| `/admin/validation/pricing` | `/admin/validation/pricing` | owner | yes | covered |
| `/auth/update-password` | `/auth/update-password` | anon | yes | covered |
| `/basket` | `/basket` | anon | yes | covered |
| `/checkout` | `/checkout` | anon | yes | covered |
| `/counter` | `/counter` | owner | yes | covered |
| `/counter/compliance` | `/counter/compliance` | owner | yes | covered |
| `/counter/orders/[id]` | `/counter/orders/4e48e914-6f9d-40a7-a699-71172d3933e2` | owner | yes | covered |
| `/login` | `/login` | anon | yes | covered |
| `/operator` | `/operator` | operator_mode | yes | covered |
| `/operator/certificate` | `/operator/certificate` | operator_mode | yes | covered |
| `/operator/close` | `/operator/close` | operator_mode | yes | covered |
| `/operator/help` | `/operator/help` | operator_mode | yes | covered |
| `/operator/open` | `/operator/open` | operator_mode | yes | covered |
| `/operator/serve` | `/operator/serve` | operator_mode | yes | covered |
| `/operator/stock` | `/operator/stock` | operator_mode | yes | covered |
| `/operator/waste` | `/operator/waste` | operator_mode | yes | covered |
| `/order/[orderRef]` | `/order/PTM-2026-90003` | anon | yes | redirect -> /order/lookup |
| `/order/[orderRef]/cancel` | `/order/PTM-2026-90003/cancel` | anon | yes | redirect -> /order/lookup |
| `/order/lookup` | `/order/lookup` | anon | yes | covered |
| `/order/status/[publicAccessId]` | `/order/status/b9c36916-8811-4866-98da-a473cb19987e` | anon | yes | covered |
| `/order/status/[publicAccessId]/cancel` | `/order/status/b9c36916-8811-4866-98da-a473cb19987e/cancel` | anon | yes | covered |
| `/our-halal-promise` | `/our-halal-promise` | anon | yes | covered |
| `/privacy` | `/privacy` | anon | yes | covered |
| `/product/[slug]` | `/product/chicken-breast-fillets` | anon | yes | covered |
| `/shop` | `/shop` | anon | yes | covered |
| `/unauthorised` | `/unauthorised` | anon | yes | covered |
| `/__missing_dad_audit_route__` | `/__missing_dad_audit_route__` | anon | yes | covered |
| `/admin/today/[id] (bad)` | `/admin/today/not-a-real-decision` | owner | yes | redirect -> /admin/today |
| `/product/[slug] (bad)` | `/product/not-a-real-product` | anon | yes | covered |
| `/counter/orders/[id] (bad)` | `/counter/orders/00000000-0000-4000-8000-000000000000` | staff | yes | covered |

New routes vs old map: `/admin/audit`, `/admin/away`, `/admin/briefing`, `/admin/close`, `/admin/cutting-guide`, `/admin/evidence`, `/admin/guide`, `/admin/open`, `/admin/playbooks`, `/admin/playbooks/[slug]`, `/admin/releases`, `/admin/setup`, `/admin/stock-count`, `/admin/today/[id]`, `/admin/today/walk`, `/admin/validation/pricing`, `/auth/update-password`, `/counter/orders/[id]`, `/operator`, `/operator/certificate`, `/operator/close`, `/operator/help`, `/operator/open`, `/operator/serve`, `/operator/stock`, `/operator/waste`, `/order/[orderRef]`, `/order/[orderRef]/cancel`, `/order/lookup`, `/order/status/[publicAccessId]`, `/order/status/[publicAccessId]/cancel`, `/product/[slug]`, `/unauthorised`, `/__missing_dad_audit_route__`, `/admin/today/[id] (bad)`, `/product/[slug] (bad)`, `/counter/orders/[id] (bad)`.

Missing old routes: none.

Login precondition: owner=ok, manager=ok, staff=ok, operator=ok.
