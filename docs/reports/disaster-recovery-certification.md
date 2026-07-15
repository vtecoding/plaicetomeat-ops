LOCAL TEST DATA ONLY
NOT VALID FOR LAUNCH CERTIFICATION

# Disaster Recovery Certification - V13.3

## Recovery Summary

- environment: LOCAL
- drill type: TEST
- operator: Mara Manager <manager@ptm.test>
- timestamp: 2026-07-15T23:06:21.890524+00:00
- restore completed: 2026-07-15T23:06:21.922+00:00

## Backup Evidence

- artifact: local-test-backup-evidence.json
- backup size: 917 bytes
- checksum: abf1cdaf0c60adbaa7bc87cffad55b01eee69ed8e8f32c1d9f828aebbe551c4a
- timestamp: 2026-07-15T23:06:21.896Z

## Parity Results

| Table | Source | Restored | Variance | Status |
| --- | ---: | ---: | ---: | --- |
| profiles | 6 | 6 | 0 | PASS |
| orders | 7 | 7 | 0 | PASS |
| order_items | 7 | 7 | 0 | PASS |
| products | 8 | 8 | 0 | PASS |
| inventory | 6 | 6 | 0 | PASS |
| audit_logs | 75 | 75 | 0 | PASS |
| compliance_logs | 1 | 1 | 0 | PASS |
| pricing_validations | 1 | 1 | 0 | PASS |

## Integrity Results

| Sample | Identifier | Status |
| --- | --- | --- |
| latest order | 54b92c67-0e90-48ad-8985-e7068f923c40 | PASS |
| oldest order | c5e7eed1-3915-4aae-a164-ace433a0c5ff | PASS |
| random order | 54b92c67-0e90-48ad-8985-e7068f923c40 | PASS |
| latest audit event | f97d8aa5-04a7-43ab-827c-a7c106e7cb8f | PASS |
| oldest audit event | a98cd439-9422-4ad3-8691-a001445dbda9 | PASS |
| latest compliance log | f15c6540-9695-4612-9167-0410f7184bfb | PASS |
| latest pricing validation | a3a68bbb-49f7-45e9-8ce3-b74e456da119 | PASS |

## Final Verdict

RECOVERY CERTIFIED
