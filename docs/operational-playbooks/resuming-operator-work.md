# Resuming operator work

Serve, stock-delivery and waste flows save the last completed question to the operator run. The save is convenience state only: orders, inventory and waste remain authoritative in their own ledgers.

## What the operator sees

- `Saving…` means the latest step is still being written.
- `Saved for resume` means a refresh or another device can offer that exact saved step.
- `Not saved for resume — keep going, the sale still works` means only recovery state failed. The real save at the end remains available and uses the same run idempotency key.

On re-entry during the same branch-local business day, choose **Carry on** to restore the last successfully saved step. Choose **Start fresh** to mark that old run abandoned before starting a new run.

## Failure handling

Do not re-enter a completed sale, delivery or waste record because a draft warning appeared. Completion is separately idempotent. Three consecutive draft-save failures produce a structured server log, and the failure count is persisted when the next draft write succeeds.

If a completed operation is visible in its business screen but an old resume prompt remains, treat the business record as truth and report the run id to the owner. A late draft update is status-fenced and cannot reopen a completed run.
