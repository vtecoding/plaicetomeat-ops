LOCAL TEST DATA ONLY
NOT VALID FOR LAUNCH CERTIFICATION

# Disaster Recovery Certification - V13.3

## Recovery Summary

- environment: LOCAL
- drill type: TEST
- operator: Mara Manager <manager@ptm.test>
- timestamp: 2026-07-09T23:35:29.239234+00:00
- restore completed: 2026-07-09T23:35:29.256+00:00

## Backup Evidence

- artifact: local-test-backup-evidence.json
- backup size: 923 bytes
- checksum: 94f0c1e6549b99be0ac51036d1ffbcc171f9b88e2305ce9360714c9f19b3dfc0
- timestamp: 2026-07-09T23:35:29.242Z

## Parity Results

| Table | Source | Restored | Variance | Status |
| --- | ---: | ---: | ---: | --- |
| profiles | 6 | 6 | 0 | PASS |
| orders | 6 | 6 | 0 | PASS |
| order_items | 6 | 6 | 0 | PASS |
| products | 17 | 17 | 0 | PASS |
| inventory | 35 | 35 | 0 | PASS |
| audit_logs | 338 | 338 | 0 | PASS |
| compliance_logs | 1 | 1 | 0 | PASS |
| pricing_validations | 1 | 1 | 0 | PASS |

## Integrity Results

| Sample | Identifier | Status |
| --- | --- | --- |
| latest order | c93c185b-fe75-498d-8cdc-a185b8c054b8 | PASS |
| oldest order | 5192e315-aefc-49a0-a343-aeb970d64aa4 | PASS |
| random order | c93c185b-fe75-498d-8cdc-a185b8c054b8 | PASS |
| latest audit event | 5ed87517-f16f-4669-9809-d9c2198e82a2 | PASS |
| oldest audit event | bdf3fa99-bbd2-4059-b0db-da0841ff3ec4 | PASS |
| latest compliance log | 22e46458-98e0-4606-a1e3-a774db0c73bc | PASS |
| latest pricing validation | 2e014b0c-9b29-43ab-9386-f99b4abf7cea | PASS |

## Final Verdict

RECOVERY CERTIFIED
