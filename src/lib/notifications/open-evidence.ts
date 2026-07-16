const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function notificationOpenDispatchId(search: string): string | null {
  const value = new URLSearchParams(search).get("notification");
  return value && UUID.test(value) ? value : null;
}
