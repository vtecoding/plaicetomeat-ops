const ORDER_REF_PATTERN = /^PTM-\d{6}-\d{4}$/;

export function generateOrderRef(date: Date, sequence: number) {
  if (!Number.isInteger(sequence) || sequence < 1 || sequence > 9999) {
    throw new Error("Order sequence must be an integer between 1 and 9999.");
  }

  const yy = String(date.getFullYear()).slice(-2);
  const mm = String(date.getMonth() + 1).padStart(2, "0");
  const dd = String(date.getDate()).padStart(2, "0");
  const nnnn = String(sequence).padStart(4, "0");

  return `PTM-${yy}${mm}${dd}-${nnnn}`;
}

export function isOrderRef(value: string) {
  return ORDER_REF_PATTERN.test(value);
}
