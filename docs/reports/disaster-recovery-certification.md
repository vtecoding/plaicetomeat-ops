LOCAL TEST DATA ONLY
NOT VALID FOR LAUNCH CERTIFICATION

# Disaster Recovery Certification - V13.3

## Recovery Summary

- environment: LOCAL
- drill type: TEST
- operator: Mara Manager <manager@ptm.test>
- timestamp: 2026-07-15T11:03:12.582504+00:00
- restore completed: 2026-07-15T11:03:12.604+00:00

## Backup Evidence

- artifact: local-test-backup-evidence.json
- backup size: 917 bytes
- checksum: b8739ccb59f3fa287ae5906409542d6ff6f51336f4f878a362b0f7ee21280f26
- timestamp: 2026-07-15T11:03:12.587Z

## Parity Results

| Table | Source | Restored | Variance | Status |
| --- | ---: | ---: | ---: | --- |
| profiles | 6 | 6 | 0 | PASS |
| orders | 7 | 7 | 0 | PASS |
| order_items | 7 | 7 | 0 | PASS |
| products | 8 | 8 | 0 | PASS |
| inventory | 6 | 6 | 0 | PASS |
| audit_logs | 79 | 79 | 0 | PASS |
| compliance_logs | 1 | 1 | 0 | PASS |
| pricing_validations | 1 | 1 | 0 | PASS |

## Integrity Results

| Sample | Identifier | Status |
| --- | --- | --- |
| latest order | 59abc826-d6a7-426f-b26c-f6a844bd0a56 | PASS |
| oldest order | 928fac57-a300-4485-917b-b97ff6446d27 | PASS |
| random order | a2e88598-184c-453b-8fac-954c4878008a | PASS |
| latest audit event | ef97dea7-008d-487b-86ac-b713cf0064c8 | PASS |
| oldest audit event | f5716591-f607-46aa-8ab3-1506af0a7669 | PASS |
| latest compliance log | d723c2ea-0bd0-45c0-8142-3113d1d4c12f | PASS |
| latest pricing validation | 6b7b060b-3ff6-4d17-99fc-b42280c6592f | PASS |

## Final Verdict

RECOVERY CERTIFIED
