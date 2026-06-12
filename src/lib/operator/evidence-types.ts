export type OperatorEvidenceType =
  | "delivery_note"
  | "supplier_document"
  | "certificate"
  | "fridge_check"
  | "waste_photo"
  | "other";

export type OperatorEvidenceSourceType =
  | "operator_workflow_run"
  | "inventory_batch"
  | "waste_event"
  | "compliance_log"
  | "supplier_document"
  | "compliance_document";

export type OperatorEvidenceStatus = "uploaded" | "linked" | "needs_owner_review" | "deleted" | "failed";

export type OperatorEvidenceUploadResult =
  | { ok: true; id: string; fileName: string; message: string }
  | { ok: false; id?: string; message: string };
