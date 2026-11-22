/**
 * Arquivo: src/utils/horusSpreadsheetCodec.ts
 * Objetivo: Exporta e importa planilhas (.xlsx e .csv) 100% compatíveis com o ProductImportDrawer
 *           do Horus PDV (colunas: Codigo, Nome, Fornecedor, Descricao, Quantidade, PrecoCusto, PrecoVenda).
 */

import { readSheet } from "read-excel-file/browser";
import writeXlsxFile, { type SheetData } from "write-excel-file/browser";
import type { ScannedProductItem } from "@/types/scanner";

export interface ImportedSpreadsheetRow {
  productCode: string;
  productName: string;
  productSupplier: string;
  productDescription: string;
  productQnt: number;
  productUnitPrice: string;
  productSalePrice: string;
  productCategory?: string;
}

const HEADER_ALIASES: Record<string, keyof ImportedSpreadsheetRow> = {
  codigo: "productCode",
  codigodoproduto: "productCode",
  productcode: "productCode",
  sku: "productCode",
  ean: "productCode",
  gtin: "productCode",
  nome: "productName",
  nomedoproduto: "productName",
  produto: "productName",
  productname: "productName",
  fornecedor: "productSupplier",
  productsupplier: "productSupplier",
  descricao: "productDescription",
  descricaodoproduto: "productDescription",
  productdescription: "productDescription",
  quantidade: "productQnt",
  estoque: "productQnt",
  qtd: "productQnt",
  productqnt: "productQnt",
  precocusto: "productUnitPrice",
  custo: "productUnitPrice",
  precounitario: "productUnitPrice",
  custounitario: "productUnitPrice",
  productunitprice: "productUnitPrice",
  precovenda: "productSalePrice",
  venda: "productSalePrice",
  precodevenda: "productSalePrice",
  preco: "productSalePrice",
  productsaleprice: "productSalePrice",
  categoria: "productCategory",
  productcategory: "productCategory",
};

function normalizeHeader(value: unknown): string {
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]/g, "");
}

function sanitizeFileSlug(rawName: string): string {
  return (
    rawName
      .trim()
      .toLowerCase()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "") || "planilha-horus-pdv"
  );
}

/**
 * Gera e faz download do arquivo Excel (.xlsx) no exato layout do modelo oficial do Horus PDV (+ Categoria).
 */
export async function exportToHorusPdvXlsx(
  items: ScannedProductItem[],
  sheetTitle: string,
): Promise<void> {
  const data: SheetData = [
    [
      { value: "Codigo", fontWeight: "bold" },
      { value: "Nome", fontWeight: "bold" },
      { value: "Fornecedor", fontWeight: "bold" },
      { value: "Descricao", fontWeight: "bold" },
      { value: "Quantidade", fontWeight: "bold" },
      { value: "PrecoCusto", fontWeight: "bold" },
      { value: "PrecoVenda", fontWeight: "bold" },
      { value: "Categoria", fontWeight: "bold" },
    ],
    ...items.map((item) => [
      { type: String, value: String(item.productCode || "") },
      { type: String, value: String(item.productName || "") },
      { type: String, value: String(item.productSupplier || "Distribuidora Geral") },
      { type: String, value: String(item.productDescription || item.productName || "") },
      { type: Number, value: Number.isFinite(item.productQnt) ? item.productQnt : 1 },
      {
        type: String,
        value:
          item.productUnitPrice && item.productUnitPrice !== "0,00"
            ? item.productUnitPrice
            : "1,00",
      },
      {
        type: String,
        value:
          item.productSalePrice && item.productSalePrice !== "0,00"
            ? item.productSalePrice
            : "1,00",
      },
      { type: String, value: String(item.productCategory || "Mercearia") },
    ]),
  ];

  const fileName = `${sanitizeFileSlug(sheetTitle)}-horus-pdv.xlsx`;
  await writeXlsxFile(data).toFile(fileName);
}

/**
 * Gera e faz download do arquivo CSV separado por ponto-e-vírgula (;) compatível com Excel BR e Horus PDV.
 */
export function exportToHorusPdvCsv(
  items: ScannedProductItem[],
  sheetTitle: string,
): void {
  const headers = [
    "Codigo",
    "Nome",
    "Fornecedor",
    "Descricao",
    "Quantidade",
    "PrecoCusto",
    "PrecoVenda",
    "Categoria",
  ];

  const escapeCsvCell = (val: string | number): string => {
    const str = String(val ?? "").replace(/"/g, '""');
    return str.includes(";") || str.includes('"') || str.includes("\n") ? `"${str}"` : str;
  };

  const rows = items.map((item) =>
    [
      escapeCsvCell(item.productCode),
      escapeCsvCell(item.productName),
      escapeCsvCell(item.productSupplier || "Distribuidora Geral"),
      escapeCsvCell(item.productDescription || item.productName),
      escapeCsvCell(item.productQnt),
      escapeCsvCell(
        item.productUnitPrice && item.productUnitPrice !== "0,00" ? item.productUnitPrice : "1,00",
      ),
      escapeCsvCell(
        item.productSalePrice && item.productSalePrice !== "0,00" ? item.productSalePrice : "1,00",
      ),
      escapeCsvCell(item.productCategory || "Mercearia"),
    ].join(";"),
  );

  // BOM UTF-8 para abertura correta de acentos no Microsoft Excel
  const csvContent = "\uFEFF" + [headers.join(";"), ...rows].join("\r\n");
  const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `${sanitizeFileSlug(sheetTitle)}-horus-pdv.csv`;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

function parseCsvLines(text: string): string[][] {
  const lines = text
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .split("\n")
    .filter((line) => line.trim().length > 0);
  if (lines.length === 0) return [];
  const delimiter = lines[0].includes(";") ? ";" : ",";
  return lines.map((line) =>
    line.split(delimiter).map((cell) => cell.trim().replace(/^"(.*)"$/, "$1")),
  );
}

/**
 * Lê um arquivo .xlsx ou .csv externo enviado pelo usuário para mesclar com as planilhas capturadas pelos celulares.
 */
export async function parseExternalSpreadsheetFile(
  file: File,
): Promise<ImportedSpreadsheetRow[]> {
  const lower = file.name.toLowerCase();
  let matrix: unknown[][] = [];

  if (lower.endsWith(".csv")) {
    const text = await file.text();
    matrix = parseCsvLines(text);
  } else {
    const rows = await readSheet(file);
    matrix = rows as unknown[][];
  }

  if (matrix.length < 2) return [];

  const rawHeaders = matrix[0] ?? [];
  const columnMap = new Map<number, keyof ImportedSpreadsheetRow>();
  rawHeaders.forEach((cell, idx) => {
    const normalized = normalizeHeader(cell);
    const mapped = HEADER_ALIASES[normalized];
    if (mapped) {
      columnMap.set(idx, mapped);
    }
  });

  const positionalFallback: Array<keyof ImportedSpreadsheetRow> = [
    "productCode",
    "productName",
    "productSupplier",
    "productDescription",
    "productQnt",
    "productUnitPrice",
    "productSalePrice",
    "productCategory",
  ];
  const usePositional = columnMap.size < 2;

  const parsed: ImportedSpreadsheetRow[] = [];

  for (let i = 1; i < matrix.length; i++) {
    const row = matrix[i] ?? [];
    const getCell = (field: keyof ImportedSpreadsheetRow): string => {
      if (usePositional) {
        const idx = positionalFallback.indexOf(field);
        return idx >= 0 ? String(row[idx] ?? "").trim() : "";
      }
      for (const [colIdx, mappedField] of columnMap.entries()) {
        if (mappedField === field) {
          return String(row[colIdx] ?? "").trim();
        }
      }
      return "";
    };

    const productCode = getCell("productCode");
    const productName = getCell("productName");
    if (!productCode && !productName) continue;

    const qntNum = Number.parseFloat(getCell("productQnt").replace(",", "."));
    parsed.push({
      productCode: productCode || `ITEM-${i}`,
      productName: productName || `Produto Importado ${productCode}`,
      productSupplier: getCell("productSupplier") || "Distribuidora Geral",
      productDescription: getCell("productDescription") || productName,
      productQnt: Number.isFinite(qntNum) && qntNum > 0 ? qntNum : 1,
      productUnitPrice: getCell("productUnitPrice") || "0,00",
      productSalePrice: getCell("productSalePrice") || "0,00",
      productCategory: getCell("productCategory") || undefined,
    });
  }

  return parsed;
}
