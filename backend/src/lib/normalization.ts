export function normalizeEmail(value: string): string {
  return value.trim().toLowerCase();
}

export function normalizeCategoryName(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/gu, " ");
}
