const ORDER_REF_PATTERN = /^PTM-\d{4}-\d{5}$/;

export function generateOrderRef(date: Date, sequence: number) {
  if (!Number.isInteger(sequence) || sequence < 1 || sequence > 99999) {
    throw new Error("Order sequence must be an integer between 1 and 99999.");
  }

  const yyyy = String(date.getFullYear());
  const nnnnn = String(sequence).padStart(5, "0");

  return `PTM-${yyyy}-${nnnnn}`;
}

export function isOrderRef(value: string) {
  return ORDER_REF_PATTERN.test(value);
}
