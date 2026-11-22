/**
 * Arquivo: src/utils/packPricing.ts
 * Objetivo: Utilitários para deduzir o preço de custo unitário a partir do valor do fardo/caixa
 *           e quantidade por fardo, além de calcular preço de venda sugerido por margem de lucro
 *           e margem real sobre custo.
 */

export function parseMoneyInputPtBr(raw: string | number | undefined | null): number {
  if (typeof raw === "number") {
    return Number.isFinite(raw) && raw >= 0 ? Math.round(raw * 100) / 100 : 0;
  }
  const str = String(raw ?? "").trim();
  if (!str) return 0;
  const cleaned = str.replace(/[R$\s]/gi, "");
  let normalized = cleaned;
  if (cleaned.includes(",") && cleaned.includes(".")) {
    normalized = cleaned.replace(/\./g, "").replace(",", ".");
  } else if (cleaned.includes(",")) {
    normalized = cleaned.replace(",", ".");
  }
  const value = Number.parseFloat(normalized);
  return Number.isFinite(value) && value >= 0 ? Math.round(value * 100) / 100 : 0;
}

export function formatMoneyOutputPtBr(value: number): string {
  if (!Number.isFinite(value) || value <= 0) return "";
  return value.toFixed(2).replace(".", ",");
}

/**
 * Calcula o preço de custo unitário dividindo o preço pago no fardo pela quantidade de itens do fardo.
 */
export function calculateUnitCostFromPack(
  packPriceRaw: string | number,
  packQuantityRaw: string | number,
): { numeric: number; formatted: string } {
  const packPrice = parseMoneyInputPtBr(packPriceRaw);
  const qtyNum =
    typeof packQuantityRaw === "number"
      ? packQuantityRaw
      : Number.parseFloat(String(packQuantityRaw ?? "").replace(",", "."));

  if (!Number.isFinite(packPrice) || packPrice <= 0 || !Number.isFinite(qtyNum) || qtyNum <= 0) {
    return { numeric: 0, formatted: "" };
  }

  const unitCost = Math.round((packPrice / qtyNum) * 100) / 100;
  return {
    numeric: unitCost,
    formatted: formatMoneyOutputPtBr(unitCost),
  };
}

/**
 * Calcula o preço de venda sugerido aplicando a margem de lucro (%) sobre o custo unitário (markup).
 */
export function calculateSalePriceFromMargin(
  unitCostRaw: string | number,
  marginPercentRaw: string | number,
): { numeric: number; formatted: string } {
  const unitCost = parseMoneyInputPtBr(unitCostRaw);
  const margin =
    typeof marginPercentRaw === "number"
      ? marginPercentRaw
      : Number.parseFloat(String(marginPercentRaw ?? "").replace(",", "."));

  if (!Number.isFinite(unitCost) || unitCost <= 0 || !Number.isFinite(margin) || margin < 0) {
    return { numeric: 0, formatted: "" };
  }

  const salePrice = Math.round(unitCost * (1 + margin / 100) * 100) / 100;
  return {
    numeric: salePrice,
    formatted: formatMoneyOutputPtBr(salePrice),
  };
}

/**
 * Calcula a margem (%) atual com base no preço de custo unitário e no preço de venda.
 */
export function calculateMarginPercent(
  unitCostRaw: string | number,
  salePriceRaw: string | number,
): number | null {
  const cost = parseMoneyInputPtBr(unitCostRaw);
  const sale = parseMoneyInputPtBr(salePriceRaw);
  if (cost <= 0 || sale <= 0) return null;
  return Math.round(((sale - cost) / cost) * 1000) / 10;
}
