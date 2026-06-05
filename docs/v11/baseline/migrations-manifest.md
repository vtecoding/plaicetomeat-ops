# V11.0 Migration Manifest

Recorded at baseline freeze. SHA-256 over each migration file as tracked in the
repository at commit `db32b338a983c60f42ef8a33581b644c44b0a72b`.

| Version | File | SHA-256 | Applied (local) |
|---|---|---|---|
| 202605290001 | 202605290001_init.sql | `9ce1e8f4dba47f6d35556c61d90291e6a9efdd3f43d5b05f98c1e6b2030cb625` | yes |
| 202605300001 | 202605300001_v2_phase_a_backbone.sql | `8d48a7fe0e40b832144661b508c20f8b9734ac804c3a774aa0b52c99ea2a56f5` | yes |
| 202605300002 | 202605300002_v2_phase_b_ops.sql | `0af70e0f9756ab93c1b0e990ed4d3aa7680b40687677c1a27104ba4731a8a100` | yes |
| 202605300003 | 202605300003_v2_phase_c_admin_products.sql | `a444856fca53b77826614e77dffa29911615f5335103ae284c2da0f07a7bab70` | yes |
| 202605300004 | 202605300004_v2_phase_d_admin_ops.sql | `93d987dd953e2725440684c7766164f2aa9dcf83b4efc776cacd9ab564a86eca` | yes |
| 202605310001 | 202605310001_v2_phase_e_sms_test_mode.sql | `0a97c4ce5eef13a4b427d47ef748bc07b3a6a4b383f122936b93fa9f624da459` | yes |
| 202605310002 | 202605310002_v2_phase_e_customer_cancel.sql | `0180bb6c286b9231817c735cb07344e783c7b529ae068b4219791d5c77432607` | yes |
| 202605310003 | 202605310003_v2_1_compliance_inventory.sql | `2aa5f89c41c6e7fd9bfd7583bc7a4256bae5add41d10f15c7ccb02f3f4fad0e5` | yes |
| 202606011430 | 202606011430_v3_operational_system.sql | `086b27a1de4e03ff780f370dbd38db7de88faf7b59e7edcaba35d50be0e7e695` | yes |
| 202606011900 | 202606011900_v4_operations_intelligence.sql | `a27abe7a955a0365981a11ed325378e958e86ed33b5bda3d0a7fca748b024b6d` | yes |
| 202606012030 | 202606012030_v5_action_intelligence.sql | `3832c03f0cedb886372b9bc115e4a1e697f6af0ac544b7d795191f49c34eb98c` | yes |
| 202606021000 | 202606021000_v6_product_cost.sql | `845d49c3cd744dc242aa2a32dab0e666ef54d29b449d4643f6e3bad8f4eeb959` | yes |
| 202606021100 | 202606021100_v6_4_carcass_intake.sql | `6677e01b37477b84ab8769c0ee34947edb52261fd7f016279cc0fe5d053f0982` | yes |
| 202606021500 | 202606021500_v6_5_inventory_integrity.sql | `e0a6879973c68eddce75749770a166c0b2482ef3d8767ced156eb255ce8d33f3` | yes |
| 202606031000 | 202606031000_v6_6_inventory_reality.sql | `f2cbfd7a83c908334de10294e3d77a7a01e1523869979afcee38a7a70a46f428` | yes |
| 202606041700 | 202606041700_v10_phase2_guided_capture.sql | `25c14e0589d5622489b68fe3bc9bbbc91f3b86ff72e7c1c773a30eae36861d71` | yes |

## Parity status

- **Repository ↔ local Supabase:** EXACT. All 16 migrations above are present in
  `supabase_migrations.schema_migrations` on the local stack (queried directly).
- **Repository ↔ preview:** NOT VERIFIED — no preview credentials available in this
  environment.
- **Repository ↔ production:** NOT VERIFIED — `NEXT_PUBLIC_SUPABASE_URL` is empty in
  the tracked `.env.production.remote` / `.env.vercel.production.local`, so the
  production project ref could not be read and `supabase migration list --linked`
  could not be run. This is a required production action before any V11 deploy
  (see baseline-freeze.md → Production actions required).

## How to regenerate

```bash
# Checksums (PowerShell)
Get-ChildItem supabase/migrations/*.sql | Sort-Object Name | ForEach-Object {
  '{0}  {1}' -f (Get-FileHash $_ -Algorithm SHA256).Hash.ToLower(), $_.Name }

# Applied set (local)
docker exec supabase_db_plaicetomeat-ops psql -U postgres -d postgres -t \
  -c "select version from supabase_migrations.schema_migrations order by version;"

# Production parity (requires linked project + token — run by operator)
MIGRATION_DRIFT_CHECK_MODE=release node scripts/check-migrations.mjs
```
