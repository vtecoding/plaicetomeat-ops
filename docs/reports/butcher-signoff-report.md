# Butcher Sign-off Report — V13.1 Pricing Validation

_Generated: 2026-06-07T23:40:30.647Z · Branch: 00000000-0000-4000-8000-000000000001_

## Verdict: CHANGES REQUIRED

- Saleable cuts approved: **0 / 30**
- Cuts needing changes: **1**
- Butcher(s): _not recorded_
- Last reviewed: 2026-06-07T23:40:24.626214+00:00

> **The butcher rejected one or more pricing assumptions.** Per the V13 spec this is a
> launch FAIL until the flagged cuts are corrected and re-approved. See the notes below.

## Lamb — CHANGES REQUIRED (0/8 approved)

| Cut | System yield | System £/kg | Butcher yield | Butcher £/kg | Variance | Verdict | Notes |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Leg | 31% | £15.00 | 29% | £12.00 | -20% | Changes required | too high |
| shoulder | — | — | — | — | — | _not reviewed_ | |
| loin-chops | — | — | — | — | — | _not reviewed_ | |
| rack | — | — | — | — | — | _not reviewed_ | |
| breast | — | — | — | — | — | _not reviewed_ | |
| neck | — | — | — | — | — | _not reviewed_ | |
| shanks | — | — | — | — | — | _not reviewed_ | |
| mince-trim | — | — | — | — | — | _not reviewed_ | |

_Outstanding (unreviewed): shoulder, loin-chops, rack, breast, neck, shanks, mince-trim_

## Goat — INCOMPLETE (0/7 approved)

| Cut | System yield | System £/kg | Butcher yield | Butcher £/kg | Variance | Verdict | Notes |
| --- | --- | --- | --- | --- | --- | --- | --- |
| leg | — | — | — | — | — | _not reviewed_ | |
| shoulder | — | — | — | — | — | _not reviewed_ | |
| ribs-chops | — | — | — | — | — | _not reviewed_ | |
| loin | — | — | — | — | — | _not reviewed_ | |
| neck | — | — | — | — | — | _not reviewed_ | |
| shanks | — | — | — | — | — | _not reviewed_ | |
| curry-mince | — | — | — | — | — | _not reviewed_ | |

_Outstanding (unreviewed): leg, shoulder, ribs-chops, loin, neck, shanks, curry-mince_

## Beef — INCOMPLETE (0/10 approved)

| Cut | System yield | System £/kg | Butcher yield | Butcher £/kg | Variance | Verdict | Notes |
| --- | --- | --- | --- | --- | --- | --- | --- |
| chuck | — | — | — | — | — | _not reviewed_ | |
| brisket | — | — | — | — | — | _not reviewed_ | |
| rib | — | — | — | — | — | _not reviewed_ | |
| sirloin | — | — | — | — | — | _not reviewed_ | |
| rump | — | — | — | — | — | _not reviewed_ | |
| topside | — | — | — | — | — | _not reviewed_ | |
| silverside | — | — | — | — | — | _not reviewed_ | |
| flank | — | — | — | — | — | _not reviewed_ | |
| shin | — | — | — | — | — | _not reviewed_ | |
| mince-trim | — | — | — | — | — | _not reviewed_ | |

_Outstanding (unreviewed): chuck, brisket, rib, sirloin, rump, topside, silverside, flank, shin, mince-trim_

## Chicken — INCOMPLETE (0/5 approved)

| Cut | System yield | System £/kg | Butcher yield | Butcher £/kg | Variance | Verdict | Notes |
| --- | --- | --- | --- | --- | --- | --- | --- |
| breast | — | — | — | — | — | _not reviewed_ | |
| thigh | — | — | — | — | — | _not reviewed_ | |
| drumstick | — | — | — | — | — | _not reviewed_ | |
| wing | — | — | — | — | — | _not reviewed_ | |
| carcass | — | — | — | — | — | _not reviewed_ | |

_Outstanding (unreviewed): breast, thigh, drumstick, wing, carcass_

---

_Evidence note: every row was written through the manager-gated `record_pricing_validation`
RPC (no forgeable direct writes) and is mirrored by a `pricing_validation_recorded` audit log._
