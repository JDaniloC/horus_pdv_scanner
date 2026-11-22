/**
 * Arquivo: src/utils/productNameQuality.ts
 * Objetivo: Identifica quando um produto capturado veio com nome genérico, estranho ou incompleto
 *           para abrir automaticamente o formulário pré-preenchido de cadastro rápido logo abaixo da câmera.
 */

export function isProductNameUnclear(
  rawName: string | undefined | null,
  catalogSource?: string,
): boolean {
  const name = String(rawName ?? "").trim();
  if (!name || name.length < 4) return true;

  if (/^produto\s+(ean|pes[aá]vel)/i.test(name)) return true;
  if (catalogSource === "Cadastro Instantâneo") return true;

  // Sem letras (apenas números/símbolos)
  if (!/[a-zA-ZÀ-ÿ]{2,}/.test(name)) return true;

  // Caracteres estranhos comuns em bases estrangeiras/corrompidas (^, , múltiplos símbolos)
  if (/[\^~`]/.test(name)) return true;

  return false;
}
