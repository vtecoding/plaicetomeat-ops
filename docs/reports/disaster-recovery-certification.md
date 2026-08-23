LOCAL TEST DATA ONLY
NOT VALID FOR LAUNCH CERTIFICATION

# Disaster Recovery Certification - V13.3

## Recovery Summary

- environment: LOCAL
- drill type: TEST
- operator: Mara Manager <manager@ptm.test>
- timestamp: 2026-08-22T20:21:46.346209+00:00
- restore completed: 2026-08-22T20:21:46.375+00:00

## Backup Evidence

- artifact: local-test-backup-evidence.json
- backup size: 927 bytes
- checksum: 878ab7ee25587c6c2e3601944a14bb9acaa2ade11ae61e38bf6b05fc995ece40
- timestamp: 2026-08-22T20:21:46.349Z

## Parity Results

| Table | Source | Restored | Variance | Status |
| --- | ---: | ---: | ---: | --- |
| profiles | 6 | 6 | 0 | PASS |
| orders | 19 | 19 | 0 | PASS |
| order_items | 22 | 22 | 0 | PASS |
| products | 15 | 15 | 0 | PASS |
| inventory | 36 | 36 | 0 | PASS |
| audit_logs | 554 | 554 | 0 | PASS |
| compliance_logs | 2 | 2 | 0 | PASS |
| pricing_validations | 1 | 1 | 0 | PASS |

## Integrity Results

| Sample | Identifier | Status |
| --- | --- | --- |
| latest order | 10bccc43-bd54-4b7c-afb4-81e07e833b10 | PASS |
| oldest order | d3ce6237-b8e8-46ab-afe2-0f109fe78171 | PASS |
| random order | 82503b81-a255-415b-8259-aaa8899c81a8 | PASS |
| latest audit event | 1eeaeeca-56b2-4c08-a0fc-3a78f0405ba1 | PASS |
| oldest audit event | 70c42f80-87af-422c-ad8c-0e796d8114df | PASS |
| latest compliance log | 938f87b8-f0d1-4fac-a61a-dd512c2f57e4 | PASS |
| latest pricing validation | da57f3ce-2463-4e3f-98d0-839fc3e3d711 | PASS |

## Final Verdict

RECOVERY CERTIFIED
