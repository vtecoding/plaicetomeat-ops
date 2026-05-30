export type ReadySmsTemplateInput = {
  template: string;
  orderRef: string;
  address: string;
};

export function renderReadySmsTemplate({ template, orderRef, address }: ReadySmsTemplateInput) {
  return template.replaceAll("{order_ref}", orderRef).replaceAll("{address}", address);
}

export function shouldSendReadySms(readySmsSentAt: string | null | undefined) {
  return !readySmsSentAt;
}

export function getSmsBadgeState(readySmsSentAt: string | null, smsFailureReason?: string | null) {
  if (readySmsSentAt) {
    return "sent" as const;
  }

  if (smsFailureReason) {
    return "failed" as const;
  }

  return "pending" as const;
}
