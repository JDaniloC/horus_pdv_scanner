/**
 * Arquivo: src/utils/expirationDate.ts
 * Objetivo: Utilitários para cálculo e formatação de data de vencimento (Nulo, +30 dias ou data específica).
 */

export type ExpirationPresetMode = "none" | "30_days" | "custom";

/**
 * Retorna a data no formato ISO YYYY-MM-DD somando `days` a partir da data base (padrão: hoje).
 */
export function addDaysIsoDate(days: number, baseDate: Date = new Date()): string {
  const target = new Date(baseDate.getFullYear(), baseDate.getMonth(), baseDate.getDate());
  target.setDate(target.getDate() + days);
  const year = target.getFullYear();
  const month = String(target.getMonth() + 1).padStart(2, "0");
  const day = String(target.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

/**
 * Normaliza entradas de vencimento ("", null, "none", "30_days", "DD/MM/YYYY", "YYYY-MM-DD")
 * retornando ISO "YYYY-MM-DD" ou null.
 */
export function normalizeExpirationDate(
  raw: string | null | undefined,
  baseDate: Date = new Date(),
): string | null {
  if (raw === null || raw === undefined) return null;
  const trimmed = String(raw).trim();
  if (!trimmed || trimmed.toLowerCase() === "null" || trimmed.toLowerCase() === "none") {
    return null;
  }
  if (trimmed === "30_days" || trimmed === "30d") {
    return addDaysIsoDate(30, baseDate);
  }
  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
    return trimmed;
  }
  const brMatch = trimmed.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (brMatch) {
    return `${brMatch[3]}-${brMatch[2]}-${brMatch[1]}`;
  }
  return null;
}

/**
 * Formata "YYYY-MM-DD" para "DD/MM/AAAA" (pt-BR) ou retorna string vazia se nulo.
 */
export function formatExpirationPtBr(isoDate: string | null | undefined): string {
  if (!isoDate) return "";
  const match = String(isoDate).trim().match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return "";
  return `${match[3]}/${match[2]}/${match[1]}`;
}
