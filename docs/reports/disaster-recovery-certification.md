LOCAL TEST DATA ONLY
NOT VALID FOR LAUNCH CERTIFICATION

# Disaster Recovery Certification - V13.3

## Recovery Summary

- environment: LOCAL
- drill type: TEST
- operator: Mara Manager <manager@ptm.test>
- timestamp: 2026-06-30T17:32:21.163184+00:00
- restore completed: 2026-06-30T17:32:21.198+00:00

## Backup Evidence

- artifact: local-test-backup-evidence.json
- backup size: 937 bytes
- checksum: 692ee4d2b4100f54eee84052abe1aaa8c28211548c9499ba884e4584125dc67b
- timestamp: 2026-06-30T17:32:21.173Z

## Parity Results

| Table | Source | Restored | Variance | Status |
| --- | ---: | ---: | ---: | --- |
| profiles | 6 | 6 | 0 | PASS |
| orders | 140 | 140 | 0 | PASS |
| order_items | 143 | 143 | 0 | PASS |
| products | 135 | 135 | 0 | PASS |
| inventory | 310 | 310 | 0 | PASS |
| audit_logs | 1630 | 1630 | 0 | PASS |
| compliance_logs | 2 | 2 | 0 | PASS |
| pricing_validations | 1 | 1 | 0 | PASS |

## Integrity Results

| Sample | Identifier | Status |
| --- | --- | --- |
| latest order | 703d336a-3a11-42d4-8036-b24281034d4e | PASS |
| oldest order | 01362f2b-a3cd-431e-85db-c30be29692e5 | PASS |
| random order | 8c03574d-b239-4060-9d0d-8d7ff2ba1db1 | PASS |
| latest audit event | 05bd8533-9093-486e-bf1c-a6dde0cee6ef | PASS |
| oldest audit event | af6921de-30ea-4c69-99be-44baf28073f3 | PASS |
| latest compliance log | 63df772c-168c-4eed-9f98-a5c9a9a1bf7f | PASS |
| latest pricing validation | 7f659f7c-46ae-4ad3-8c0f-fe8ad01747fe | PASS |

## Final Verdict

RECOVERY CERTIFIED
