export const DEFAULT_SAME_DAY_CUTOFF_HOUR = 16;
export const DEFAULT_MAX_QUANTITY_PER_SKU = 20;
export const DEFAULT_MIN_ORDER_VALUE = 0;

const UK_MOBILE_E164_PATTERN = /^\+447\d{9}$/;
const UK_MOBILE_LOCAL_PATTERN = /^07\d{9}$/;

export function normalizeUkMobileNumber(value: string) {
  const compact = value.replace(/[\s-]/g, "");

  if (UK_MOBILE_LOCAL_PATTERN.test(compact)) {
    return `+44${compact.slice(1)}`;
  }

  return compact;
}

export function isUkMobileNumber(value: string) {
  return UK_MOBILE_E164_PATTERN.test(normalizeUkMobileNumber(value));
}

export function getLocalIsoDate(now = new Date()) {
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
}

export function isPickupDateAllowed(
  pickupDate: string,
  options: {
    now?: Date;
    sameDayCutoffHour?: number;
  } = {},
) {
  const now = options.now ?? new Date();
  const sameDayCutoffHour = options.sameDayCutoffHour ?? DEFAULT_SAME_DAY_CUTOFF_HOUR;
  const today = getLocalIsoDate(now);

  if (!/^\d{4}-\d{2}-\d{2}$/.test(pickupDate)) {
    return false;
  }

  if (pickupDate < today) {
    return false;
  }

  if (pickupDate === today && now.getHours() >= sameDayCutoffHour) {
    return false;
  }

  return true;
}

export function getPickupDateError(
  pickupDate: string,
  options: {
    now?: Date;
    sameDayCutoffHour?: number;
  } = {},
) {
  const now = options.now ?? new Date();
  const today = getLocalIsoDate(now);
  const sameDayCutoffHour = options.sameDayCutoffHour ?? DEFAULT_SAME_DAY_CUTOFF_HOUR;

  if (!pickupDate) {
    return "Pickup date is required.";
  }

  if (!/^\d{4}-\d{2}-\d{2}$/.test(pickupDate)) {
    return "Pickup date is required.";
  }

  if (pickupDate < today) {
    return "Pickup date cannot be in the past.";
  }

  if (pickupDate === today && now.getHours() >= sameDayCutoffHour) {
    return `Same-day orders close at ${formatCutoffHour(sameDayCutoffHour)}.`;
  }

  return null;
}

export function formatCutoffHour(hour: number) {
  const suffix = hour >= 12 ? "pm" : "am";
  const displayHour = hour % 12 === 0 ? 12 : hour % 12;

  return `${displayHour}${suffix}`;
}
