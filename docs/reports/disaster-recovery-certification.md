LOCAL TEST DATA ONLY
NOT VALID FOR LAUNCH CERTIFICATION

# Disaster Recovery Certification - V13.3

## Recovery Summary

- environment: LOCAL
- drill type: TEST
- operator: Mara Manager <manager@ptm.test>
- timestamp: 2026-07-15T14:02:25.240697+00:00
- restore completed: 2026-07-15T14:02:25.271+00:00

## Backup Evidence

- artifact: local-test-backup-evidence.json
- backup size: 917 bytes
- checksum: 9619646c170f4826a8b1f6969b81b47451b2db4a653fc9b7677175a2bb291419
- timestamp: 2026-07-15T14:02:25.245Z

## Parity Results

| Table | Source | Restored | Variance | Status |
| --- | ---: | ---: | ---: | --- |
| profiles | 6 | 6 | 0 | PASS |
| orders | 7 | 7 | 0 | PASS |
| order_items | 7 | 7 | 0 | PASS |
| products | 8 | 8 | 0 | PASS |
| inventory | 6 | 6 | 0 | PASS |
| audit_logs | 40 | 40 | 0 | PASS |
| compliance_logs | 1 | 1 | 0 | PASS |
| pricing_validations | 1 | 1 | 0 | PASS |

## Integrity Results

| Sample | Identifier | Status |
| --- | --- | --- |
| latest order | 5dbd3342-50f2-4887-827f-fc40827563ac | PASS |
| oldest order | fa3645fd-cefa-403c-b4b2-4eb2976317d4 | PASS |
| random order | 8358181e-b518-49b6-b641-58adce2bd151 | PASS |
| latest audit event | 5a5998f0-dfaa-40cd-a6a3-bef81f760d8b | PASS |
| oldest audit event | 2220be03-8d02-42ad-b81a-c67114a675d9 | PASS |
| latest compliance log | 57ad5cea-e2e6-4687-bb2d-1e9cf17e7bdc | PASS |
| latest pricing validation | f4d70520-5c39-449f-afb6-b82d179a5469 | PASS |

## Final Verdict

RECOVERY CERTIFIED
