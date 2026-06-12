export type OwnerAwayHeadlineInput = {
  ownerAway: boolean;
  shopOpened: boolean;
  openAlertCount: number;
  orderCount: number;
  evidenceReviewCount: number;
  certificateReviewCount: number;
};

export function buildOwnerAwayHeadline(input: OwnerAwayHeadlineInput) {
  if (input.openAlertCount > 0 || input.evidenceReviewCount > 0 || input.certificateReviewCount > 0) {
    return "Owner checks needed";
  }

  if (!input.shopOpened) {
    return input.ownerAway ? "Shop not opened yet" : "No opening saved yet";
  }

  if (input.orderCount === 0) {
    return input.ownerAway ? "Shop is open, no sales yet" : "Shop is open";
  }

  return input.ownerAway ? "Shop is running while you are away" : "Shop is running";
}

export function ownerAwayStatusLabel(ownerAway: boolean) {
  return ownerAway ? "Owner Away is on" : "Owner Away is off";
}

export function formatSimpleCount(count: number, singular: string, plural = `${singular}s`) {
  return `${count} ${count === 1 ? singular : plural}`;
}
