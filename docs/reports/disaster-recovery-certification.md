LOCAL TEST DATA ONLY
NOT VALID FOR LAUNCH CERTIFICATION

# Disaster Recovery Certification - V13.3

## Recovery Summary

- environment: LOCAL
- drill type: TEST
- operator: Mara Manager <manager@ptm.test>
- timestamp: 2026-07-15T17:38:52.900988+00:00
- restore completed: 2026-07-15T17:38:52.931+00:00

## Backup Evidence

- artifact: local-test-backup-evidence.json
- backup size: 921 bytes
- checksum: 1de7a9d23f932f1c647214ae050767d22e9d9c3c6ee034b4d09b3c5b6be40ede
- timestamp: 2026-07-15T17:38:52.906Z

## Parity Results

| Table | Source | Restored | Variance | Status |
| --- | ---: | ---: | ---: | --- |
| profiles | 6 | 6 | 0 | PASS |
| orders | 8 | 8 | 0 | PASS |
| order_items | 8 | 8 | 0 | PASS |
| products | 9 | 9 | 0 | PASS |
| inventory | 10 | 10 | 0 | PASS |
| audit_logs | 123 | 123 | 0 | PASS |
| compliance_logs | 1 | 1 | 0 | PASS |
| pricing_validations | 1 | 1 | 0 | PASS |

## Integrity Results

| Sample | Identifier | Status |
| --- | --- | --- |
| latest order | 1ea68a0e-f457-4678-af9d-5d3f6eb51248 | PASS |
| oldest order | 5f236341-8f73-4f2a-8470-07b445f896f1 | PASS |
| random order | 5f236341-8f73-4f2a-8470-07b445f896f1 | PASS |
| latest audit event | 875d31a8-1906-492e-84e5-739c90c4ba8c | PASS |
| oldest audit event | 7ca753bd-7f53-4e47-9e9f-112123e17451 | PASS |
| latest compliance log | 5c6cb49a-19e3-408f-b95b-7766cb96ee51 | PASS |
| latest pricing validation | 680db655-82fb-42bf-8136-20b2ed4adfca | PASS |

## Final Verdict

RECOVERY CERTIFIED
