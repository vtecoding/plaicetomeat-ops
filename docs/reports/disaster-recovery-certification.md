LOCAL TEST DATA ONLY
NOT VALID FOR LAUNCH CERTIFICATION

# Disaster Recovery Certification - V13.2

## Recovery Summary

- environment: LOCAL
- drill type: TEST
- operator: Mara Manager <manager@ptm.test>
- timestamp: 2026-06-08T00:24:01.17114+00:00
- restore completed: 2026-06-08T00:24:01.199+00:00

## Backup Evidence

- artifact: local-test-backup-evidence.json
- backup size: 925 bytes
- checksum: 51f0121191607d853db7f36e7f703b2c7b9bf323c71bbdaed6826993b7090564
- timestamp: 2026-06-08T00:24:01.175Z

## Parity Results

| Table | Source | Restored | Variance | Status |
| --- | ---: | ---: | ---: | --- |
| profiles | 5 | 5 | 0 | PASS |
| orders | 8 | 8 | 0 | PASS |
| order_items | 8 | 8 | 0 | PASS |
| products | 22 | 22 | 0 | PASS |
| inventory | 39 | 39 | 0 | PASS |
| audit_logs | 1008 | 1008 | 0 | PASS |
| compliance_logs | 1 | 1 | 0 | PASS |
| pricing_validations | 1 | 1 | 0 | PASS |

## Integrity Results

| Sample | Identifier | Status |
| --- | --- | --- |
| latest order | 855a68ed-e103-4a47-818b-23124be10a66 | PASS |
| oldest order | d5b9f070-ea7e-4cc9-be4f-5565a60ff16e | PASS |
| random order | 855a68ed-e103-4a47-818b-23124be10a66 | PASS |
| latest audit event | fb4091d4-3327-4a9b-83eb-6413ba519aec | PASS |
| oldest audit event | af6921de-30ea-4c69-99be-44baf28073f3 | PASS |
| latest compliance log | 28ad2ade-3de7-4a27-998f-21baaadcd59d | PASS |
| latest pricing validation | 9cd75837-22ca-4f85-abac-b253aa6c9db0 | PASS |

## Final Verdict

RECOVERY CERTIFIED
