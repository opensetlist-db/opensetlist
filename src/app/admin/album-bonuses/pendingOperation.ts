export type PendingOperation = { operationId: string; body: string };

export function storedOperation(key: string): PendingOperation | null {
  try {
    const value = JSON.parse(sessionStorage.getItem(key) ?? "null");
    return typeof value?.operationId === "string" && typeof value?.body === "string" ? value : null;
  } catch {
    return null;
  }
}

export function storeOperation(key: string, value: PendingOperation) {
  try {
    sessionStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Keep the operation in the mounted form if browser storage is unavailable.
  }
}

export function forgetOperation(key: string, operationId: string) {
  try {
    if (storedOperation(key)?.operationId === operationId) sessionStorage.removeItem(key);
  } catch {
    // A later open can still verify the stored operation again.
  }
}
