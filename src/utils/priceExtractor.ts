/**
 * Arquivo: src/utils/priceExtractor.ts
 * Objetivo: Extrai valores monetários brasileiros (R$ XX,XX, POR XX,XX, etc.) de textos de OCR
 *           capturados de etiquetas de gôndola e pré-processa frames de vídeo para aumentar a acurácia.
 */

export interface ExtractedPriceCandidate {
  formatted: string;
  numeric: number;
  rawMatch: string;
  confidenceScore: number;
}

/**
 * Extrai e ranqueia preços em Reais (pt-BR) a partir de um texto bruto de OCR de etiqueta de supermercado.
 * Prioriza padrões com "R$", "POR", "OFERTA" ou números com centavos explícitos (vírgula + 2 dígitos).
 */
export function extractPricesFromOcrText(rawText: string): ExtractedPriceCandidate[] {
  if (!rawText || !rawText.trim()) return [];

  // Normaliza erros comuns de OCR em etiquetas de preço:
  // "RS 12,90" -> "R$ 12,90", "R5 9,99" -> "R$ 9,99", "12.90" -> "12,90"
  const normalized = rawText
    .replace(/\r\n|\n/g, " ")
    .replace(/\bR[S58]\s*(?=\d)/gi, "R$ ")
    .replace(/(\d)\s*,\s*(\d{2})\b/g, "$1,$2");

  const candidates: ExtractedPriceCandidate[] = [];
  const seenFormatted = new Set<string>();

  // Padrão 1: Preço precedido de R$, POR, OFERTA, APENAS (alta confiança)
  const prefixedRegex =
    /(?:R\$|POR|OFERTA|APENAS|PRE[CÇ]O|UNID\.?)\s*:?\s*(\d{1,4})[,.](\d{2})\b/gi;
  let match: RegExpExecArray | null;
  while ((match = prefixedRegex.exec(normalized)) !== null) {
    const intPart = Number.parseInt(match[1], 10);
    const decPart = Number.parseInt(match[2], 10);
    const numeric = intPart + decPart / 100;
    if (numeric >= 0.25 && numeric <= 2500) {
      const formatted = numeric.toFixed(2).replace(".", ",");
      if (!seenFormatted.has(formatted)) {
        seenFormatted.add(formatted);
        candidates.push({
          formatted,
          numeric,
          rawMatch: match[0].trim(),
          confidenceScore: 95,
        });
      }
    }
  }

  // Padrão 2: Número decimal isolado no formato brasileiro XX,XX (média-alta confiança)
  // Ignora números seguidos de kg, g, ml, l, un para não confundir peso/volume com preço
  const standaloneDecimalRegex =
    /\b(\d{1,3}),(\d{2})(?!\s*(?:kg|g|gr|ml|l|lt|un|und|pct|%))\b/gi;
  while ((match = standaloneDecimalRegex.exec(normalized)) !== null) {
    const intPart = Number.parseInt(match[1], 10);
    const decPart = Number.parseInt(match[2], 10);
    const numeric = intPart + decPart / 100;
    if (numeric >= 0.5 && numeric <= 999.99) {
      const formatted = numeric.toFixed(2).replace(".", ",");
      if (!seenFormatted.has(formatted)) {
        seenFormatted.add(formatted);
        // Preços terminados em ,90 ,99 ,89 ,79 ,49 ,50 são extremamente típicos em mercadinhos
        const isRetailEnding = [99, 90, 89, 79, 69, 59, 49, 50, 29, 19, 0].includes(decPart);
        candidates.push({
          formatted,
          numeric,
          rawMatch: match[0].trim(),
          confidenceScore: isRetailEnding ? 84 : 72,
        });
      }
    }
  }

  return candidates.sort((a, b) => b.confidenceScore - a.confidenceScore);
}

/**
 * Recorta a região da etiqueta de preço do vídeo/canvas e aplica aumento de contraste em escala de cinza
 * para facilitar a leitura rápida pelo Tesseract.js mesmo em etiquetas amarelas ou iluminação de mercado.
 */
export function capturePriceRoiToDataUrl(
  source: HTMLVideoElement | HTMLCanvasElement,
  roiBox: { xRatio: number; yRatio: number; widthRatio: number; heightRatio: number } = {
    xRatio: 0.12,
    yRatio: 0.54,
    widthRatio: 0.76,
    heightRatio: 0.24,
  },
): string | null {
  const sourceWidth =
    source instanceof HTMLVideoElement ? source.videoWidth : source.width;
  const sourceHeight =
    source instanceof HTMLVideoElement ? source.videoHeight : source.height;

  if (!sourceWidth || !sourceHeight) return null;

  const sx = Math.max(0, Math.floor(sourceWidth * roiBox.xRatio));
  const sy = Math.max(0, Math.floor(sourceHeight * roiBox.yRatio));
  const sw = Math.min(sourceWidth - sx, Math.floor(sourceWidth * roiBox.widthRatio));
  const sh = Math.min(sourceHeight - sy, Math.floor(sourceHeight * roiBox.heightRatio));

  if (sw <= 16 || sh <= 16) return null;

  const canvas = document.createElement("canvas");
  canvas.width = sw;
  canvas.height = sh;
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;

  ctx.drawImage(source, sx, sy, sw, sh, 0, 0, sw, sh);

  // Pré-processamento de alto contraste para destacar os dígitos do preço na etiqueta
  const imageData = ctx.getImageData(0, 0, sw, sh);
  const data = imageData.data;
  for (let i = 0; i < data.length; i += 4) {
    const r = data[i];
    const g = data[i + 1];
    const b = data[i + 2];
    const lum = 0.299 * r + 0.587 * g + 0.114 * b;
    // Aumenta nitidez entre fundo claro/amarelo da etiqueta e tinta escura
    const contrasted = lum < 138 ? Math.max(0, (lum - 40) * 0.7) : Math.min(255, lum * 1.15);
    data[i] = contrasted;
    data[i + 1] = contrasted;
    data[i + 2] = contrasted;
  }
  ctx.putImageData(imageData, 0, 0);

  return canvas.toDataURL("image/png");
}
