/**
 * Arquivo: server/sheetStore.ts
 * Objetivo: Armazenamento persistente (JSON em disco) e gerenciamento de múltiplas planilhas/sessões
 *           em tempo real, dispositivos conectados e unificação/fusão (merge) de planilhas de diferentes celulares.
 */

import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import type {
  ConnectedDevice,
  DuplicateScanBehavior,
  LiveScanPayload,
  LiveScanResponse,
  MergeSheetsRequest,
  MergeSheetsResult,
  PriceMergeStrategy,
  ScannedProductItem,
  SheetDetail,
  SheetSummary,
} from "../src/types/scanner.ts";
import { lookupBarcodeCatalog, normalizeBarcode } from "./barcodeCatalogLookup.ts";
import { normalizeExpirationDate } from "../src/utils/expirationDate.ts";

interface PersistedDatabase {
  sheets: SheetDetail[];
  categories?: string[];
}

const DEFAULT_CATEGORIES = [
  "Bebidas",
  "Mercearia",
  "Padaria",
  "Hortifruti",
  "Laticínios",
  "Doces e Biscoitos",
  "Salgadinhos e Snacks",
  "Limpeza",
  "Higiene Pessoal",
  "Carnes e Frios",
  "Óleos e Azeites",
  "Cafés e Chás",
  "Pet Shop",
  "Outros",
];

const DATA_DIR = path.resolve(process.cwd(), "data");
const DB_FILE = path.join(DATA_DIR, "scanner_db.json");

export function parseMoneyPtBr(raw: string | number | undefined | null): number {
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

export function formatMoneyPtBr(value: number | string | undefined | null): string {
  const num = typeof value === "number" ? value : parseMoneyPtBr(value);
  if (!Number.isFinite(num) || num <= 0) return "0,00";
  return num.toFixed(2).replace(".", ",");
}

/**
 * Estima um preço de custo padrão (72% do preço de venda) quando apenas o preço de gôndola
 * foi capturado pela câmera, já que o Horus PDV exige PrecoCusto > 0 na importação em lote.
 */
export function estimateUnitCostFromSalePrice(salePriceStr: string, explicitCostStr?: string): string {
  const explicitCost = parseMoneyPtBr(explicitCostStr);
  if (explicitCost > 0) {
    return formatMoneyPtBr(explicitCost);
  }
  const sale = parseMoneyPtBr(salePriceStr);
  if (sale <= 0) return "1,00";
  const estimated = Math.max(0.01, Math.round(sale * 0.72 * 100) / 100);
  return formatMoneyPtBr(estimated);
}

function generateJoinCode(name: string): string {
  const prefix = name
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^A-Za-z0-9]/g, "")
    .toUpperCase()
    .slice(0, 4) || "MERC";
  const suffix = Math.floor(100 + Math.random() * 900);
  return `${prefix}-${suffix}`;
}

export class SheetStore {
  private sheets: Map<string, SheetDetail> = new Map();
  private devices: Map<string, ConnectedDevice> = new Map();
  private categories: Set<string> = new Set(DEFAULT_CATEGORIES);
  private persistToDisk: boolean;

  constructor(options?: { persistToDisk?: boolean }) {
    this.persistToDisk = options?.persistToDisk ?? true;
    if (this.persistToDisk) {
      this.loadFromDisk();
    }
    if (this.sheets.size === 0) {
      this.seedDefaultSheets();
    }
  }

  private loadFromDisk(): void {
    try {
      if (!fs.existsSync(DATA_DIR)) {
        fs.mkdirSync(DATA_DIR, { recursive: true });
      }
      if (!fs.existsSync(DB_FILE)) return;
      const raw = fs.readFileSync(DB_FILE, "utf-8");
      const parsed = JSON.parse(raw) as PersistedDatabase;
      if (Array.isArray(parsed?.categories)) {
        for (const cat of parsed.categories) {
          if (typeof cat === "string" && cat.trim()) {
            this.categories.add(cat.trim());
          }
        }
      }
      if (Array.isArray(parsed?.sheets)) {
        for (const sheet of parsed.sheets) {
          this.sheets.set(sheet.id, sheet);
          for (const item of sheet.items ?? []) {
            if (item.productCategory?.trim()) {
              this.categories.add(item.productCategory.trim());
            }
          }
        }
      }
    } catch (err) {
      console.error("Aviso: falha ao carregar banco local, iniciando novo:", err);
    }
  }

  private saveToDisk(): void {
    if (!this.persistToDisk) return;
    try {
      if (!fs.existsSync(DATA_DIR)) {
        fs.mkdirSync(DATA_DIR, { recursive: true });
      }
      const data: PersistedDatabase = {
        sheets: Array.from(this.sheets.values()),
        categories: Array.from(this.categories),
      };
      fs.writeFileSync(DB_FILE, JSON.stringify(data, null, 2), "utf-8");
    } catch (err) {
      console.error("Erro ao persistir banco local:", err);
    }
  }

  public listCategories(): string[] {
    const merged = new Set<string>(this.categories);
    for (const sheet of this.sheets.values()) {
      for (const item of sheet.items) {
        if (item.productCategory?.trim()) {
          merged.add(item.productCategory.trim());
        }
      }
    }
    return Array.from(merged).sort((a, b) => a.localeCompare(b, "pt-BR"));
  }

  public createCategory(rawName: string): { category: string; categories: string[] } {
    const trimmed = rawName.trim().slice(0, 100);
    if (!trimmed) {
      throw new Error("Informe o nome da categoria.");
    }
    const existing = Array.from(this.categories).find(
      (c) => c.toLowerCase() === trimmed.toLowerCase(),
    );
    const finalName = existing ?? trimmed;
    this.categories.add(finalName);
    this.saveToDisk();
    return {
      category: finalName,
      categories: this.listCategories(),
    };
  }

  private seedDefaultSheets(): void {
    const now = new Date().toISOString();
    const sheet1Id = "sheet-corredor-mercearia";
    const sheet2Id = "sheet-corredor-bebidas";

    const sheet1: SheetDetail = {
      id: sheet1Id,
      code: "MERC-101",
      name: "Corredor 1 · Mercearia & Grãos",
      aisleOrSector: "Corredor 01 - Mercearia",
      defaultSupplier: "Distribuidora Brasil",
      itemCount: 3,
      totalUnits: 12,
      estimatedTotalSaleValue: 185.7,
      activeDevicesCount: 0,
      createdAt: now,
      updatedAt: now,
      items: [
        {
          id: crypto.randomUUID(),
          sheetId: sheet1Id,
          productCode: "7891000100103",
          productName: "Arroz Agulhinha Tipo 1 Camil 5kg",
          productSupplier: "Distribuidora Brasil",
          productDescription: "Arroz polido longo fino tipo 1 · Marca: Camil · Conteúdo: 5kg",
          productQnt: 4,
          productUnitPrice: "19,90",
          productSalePrice: "27,90",
          productCategory: "Mercearia",
          brand: "Camil",
          productImageUrl: "",
          unitType: "UN",
          catalogSource: "Catálogo Mercadinho BR",
          lastCapturedByDeviceId: "seed-device-1",
          lastCapturedByDeviceName: "Celular Caixa 01",
          captureCount: 4,
          priceHistory: [
            {
              price: "27,90",
              deviceName: "Celular Caixa 01",
              timestamp: now,
              source: "ocr",
            },
          ],
          createdAt: now,
          updatedAt: now,
        },
        {
          id: crypto.randomUUID(),
          sheetId: sheet1Id,
          productCode: "7891000200205",
          productName: "Feijão Carioca Tipo 1 Kicaldo 1kg",
          productSupplier: "Distribuidora Brasil",
          productDescription: "Feijão carioca tipo 1 pacote · Marca: Kicaldo · Conteúdo: 1kg",
          productQnt: 5,
          productUnitPrice: "6,40",
          productSalePrice: "8,90",
          productCategory: "Mercearia",
          brand: "Kicaldo",
          productImageUrl: "",
          unitType: "UN",
          catalogSource: "Catálogo Mercadinho BR",
          lastCapturedByDeviceId: "seed-device-1",
          lastCapturedByDeviceName: "Celular Caixa 01",
          captureCount: 5,
          priceHistory: [
            {
              price: "8,90",
              deviceName: "Celular Caixa 01",
              timestamp: now,
              source: "ocr",
            },
          ],
          createdAt: now,
          updatedAt: now,
        },
        {
          id: crypto.randomUUID(),
          sheetId: sheet1Id,
          productCode: "7896004006277",
          productName: "Óleo de Soja Liza PET 900ml",
          productSupplier: "Distribuidora Brasil",
          productDescription: "Óleo de soja refinado tipo 1 · Marca: Liza · Conteúdo: 900ml",
          productQnt: 3,
          productUnitPrice: "5,25",
          productSalePrice: "7,29",
          productCategory: "Óleos e Azeites",
          brand: "Liza",
          productImageUrl: "",
          unitType: "UN",
          catalogSource: "Catálogo Mercadinho BR",
          lastCapturedByDeviceId: "seed-device-2",
          lastCapturedByDeviceName: "Celular Estoque 02",
          captureCount: 3,
          priceHistory: [
            {
              price: "7,29",
              deviceName: "Celular Estoque 02",
              timestamp: now,
              source: "ocr",
            },
          ],
          createdAt: now,
          updatedAt: now,
        },
      ],
    };

    const sheet2: SheetDetail = {
      id: sheet2Id,
      code: "BEBI-202",
      name: "Corredor 2 · Bebidas & Geladeira",
      aisleOrSector: "Corredor 02 - Bebidas",
      defaultSupplier: "Ambev / Coca-Cola FEMSA",
      itemCount: 2,
      totalUnits: 18,
      estimatedTotalSaleValue: 109.78,
      activeDevicesCount: 0,
      createdAt: now,
      updatedAt: now,
      items: [
        {
          id: crypto.randomUUID(),
          sheetId: sheet2Id,
          productCode: "7894900011517",
          productName: "Refrigerante Coca-Cola Original Lata 350ml",
          productSupplier: "Ambev / Coca-Cola FEMSA",
          productDescription: "Refrigerante de cola tradicional · Marca: Coca-Cola · Conteúdo: 350ml",
          productQnt: 12,
          productUnitPrice: "3,59",
          productSalePrice: "4,99",
          productCategory: "Refrigerantes",
          brand: "Coca-Cola",
          productImageUrl: "",
          unitType: "UN",
          catalogSource: "Catálogo Mercadinho BR",
          lastCapturedByDeviceId: "seed-device-2",
          lastCapturedByDeviceName: "Celular Estoque 02",
          captureCount: 12,
          priceHistory: [
            {
              price: "4,99",
              deviceName: "Celular Estoque 02",
              timestamp: now,
              source: "ocr",
            },
          ],
          createdAt: now,
          updatedAt: now,
        },
        {
          id: crypto.randomUUID(),
          sheetId: sheet2Id,
          productCode: "7891000100103",
          productName: "Arroz Agulhinha Tipo 1 Camil 5kg",
          productSupplier: "Distribuidora Brasil",
          productDescription: "Arroz polido longo fino tipo 1 · Marca: Camil · Conteúdo: 5kg",
          productQnt: 2,
          productUnitPrice: "20,40",
          productSalePrice: "28,50",
          productCategory: "Mercearia",
          brand: "Camil",
          productImageUrl: "",
          unitType: "UN",
          catalogSource: "Catálogo Mercadinho BR",
          lastCapturedByDeviceId: "seed-device-3",
          lastCapturedByDeviceName: "Celular Reposição 03",
          captureCount: 2,
          priceHistory: [
            {
              price: "28,50",
              deviceName: "Celular Reposição 03",
              timestamp: now,
              source: "ocr",
            },
          ],
          createdAt: now,
          updatedAt: now,
        },
      ],
    };

    this.recalculateSheetMetrics(sheet1);
    this.recalculateSheetMetrics(sheet2);
    this.sheets.set(sheet1.id, sheet1);
    this.sheets.set(sheet2.id, sheet2);
    this.saveToDisk();
  }

  private recalculateSheetMetrics(sheet: SheetDetail): SheetSummary {
    let totalUnits = 0;
    let totalValue = 0;
    for (const item of sheet.items) {
      const qnt = Number.isFinite(item.productQnt) ? item.productQnt : 0;
      const sale = parseMoneyPtBr(item.productSalePrice);
      totalUnits += qnt;
      totalValue += qnt * sale;
    }
    const activeDevices = Array.from(this.devices.values()).filter(
      (d) => d.sheetId === sheet.id,
    ).length;

    sheet.itemCount = sheet.items.length;
    sheet.totalUnits = Math.round(totalUnits * 1000) / 1000;
    sheet.estimatedTotalSaleValue = Math.round(totalValue * 100) / 100;
    sheet.activeDevicesCount = activeDevices;

    const { items: _items, ...summary } = sheet;
    return summary;
  }

  public listSheets(): SheetSummary[] {
    return Array.from(this.sheets.values())
      .map((sheet) => this.recalculateSheetMetrics(sheet))
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }

  public getSheet(idOrCode: string): SheetDetail | null {
    const direct = this.sheets.get(idOrCode);
    if (direct) {
      this.recalculateSheetMetrics(direct);
      return direct;
    }
    const normalizedCode = idOrCode.trim().toUpperCase();
    for (const sheet of this.sheets.values()) {
      if (sheet.code.toUpperCase() === normalizedCode) {
        this.recalculateSheetMetrics(sheet);
        return sheet;
      }
    }
    return null;
  }

  public createSheet(input: {
    name: string;
    aisleOrSector?: string;
    defaultSupplier?: string;
  }): SheetDetail {
    const now = new Date().toISOString();
    const id = `sheet-${crypto.randomUUID().slice(0, 8)}`;
    const name = input.name.trim() || "Nova Planilha de Coleta";
    const sheet: SheetDetail = {
      id,
      code: generateJoinCode(name),
      name,
      aisleOrSector: input.aisleOrSector?.trim() || "Geral",
      defaultSupplier: input.defaultSupplier?.trim() || "Fornecedor Padrão",
      itemCount: 0,
      totalUnits: 0,
      estimatedTotalSaleValue: 0,
      activeDevicesCount: 0,
      createdAt: now,
      updatedAt: now,
      items: [],
    };
    this.sheets.set(id, sheet);
    this.saveToDisk();
    return sheet;
  }

  public deleteSheet(sheetId: string): boolean {
    if (this.sheets.size <= 1) {
      return false;
    }
    const deleted = this.sheets.delete(sheetId);
    if (deleted) {
      this.saveToDisk();
    }
    return deleted;
  }

  public async recordLiveScan(payload: LiveScanPayload): Promise<LiveScanResponse> {
    let sheet = this.getSheet(payload.sheetId);
    if (!sheet) {
      sheet = Array.from(this.sheets.values())[0];
      if (!sheet) {
        sheet = this.createSheet({ name: "Coleta Principal Mercadinho" });
      }
    }

    const rawCode = String(payload.productCode ?? "").trim();
    const digitsOnly = normalizeBarcode(rawCode);
    const productCode = digitsOnly.length >= 4 ? digitsOnly : rawCode;
    if (!productCode) {
      throw new Error("Código de barras inválido ou vazio.");
    }

    const catalog = await lookupBarcodeCatalog(productCode);
    const now = new Date().toISOString();
    const quantityDelta =
      typeof payload.quantityDelta === "number" && payload.quantityDelta > 0
        ? payload.quantityDelta
        : 1;
    const behavior: DuplicateScanBehavior = payload.duplicateBehavior ?? "increment";

    const incomingPriceNum =
      parseMoneyPtBr(payload.detectedSalePrice) ||
      (catalog.suggestedSalePrice && catalog.suggestedSalePrice > 0
        ? catalog.suggestedSalePrice
        : 0);
    const formattedIncomingPrice = incomingPriceNum > 0 ? formatMoneyPtBr(incomingPriceNum) : "";

    // Deduz preço de custo unitário se vier explicitamente ou via cálculo do fardo (packPrice / packQuantity)
    const explicitUnitCostNum = parseMoneyPtBr(payload.detectedUnitPrice);
    const packPriceNum = parseMoneyPtBr(payload.packPrice);
    const packQtyNum =
      typeof payload.packQuantity === "number" && payload.packQuantity > 0
        ? payload.packQuantity
        : 0;
    const deducedFromPackCost =
      packPriceNum > 0 && packQtyNum > 0
        ? Math.round((packPriceNum / packQtyNum) * 100) / 100
        : 0;
    const explicitOrPackUnitCost =
      explicitUnitCostNum > 0
        ? formatMoneyPtBr(explicitUnitCostNum)
        : deducedFromPackCost > 0
          ? formatMoneyPtBr(deducedFromPackCost)
          : "";

    const explicitCategory = payload.productCategory?.trim() || "";
    if (explicitCategory) {
      this.categories.add(explicitCategory);
    }

    const hasExplicitExpiration = payload.expirationDate !== undefined;
    const normalizedExpiration = hasExplicitExpiration
      ? normalizeExpirationDate(payload.expirationDate)
      : undefined;

    // Verifica se o produto já existe nesta planilha
    const existingItem =
      behavior !== "new_row"
        ? sheet.items.find((item) => item.productCode === productCode)
        : undefined;

    if (existingItem) {
      if (behavior === "ignore") {
        const summary = this.recalculateSheetMetrics(sheet);
        return {
          action: "ignored",
          item: existingItem,
          sheet: summary,
          catalog,
          priceChanged: false,
          previousPrice: existingItem.productSalePrice,
        };
      }

      const previousPrice = existingItem.productSalePrice;
      let priceChanged = false;

      existingItem.productQnt = Math.round((existingItem.productQnt + quantityDelta) * 1000) / 1000;
      existingItem.captureCount += 1;
      existingItem.lastCapturedByDeviceId = payload.deviceId;
      existingItem.lastCapturedByDeviceName = payload.deviceName;
      existingItem.updatedAt = now;

      if (explicitCategory) {
        existingItem.productCategory = explicitCategory;
      }

      if (hasExplicitExpiration) {
        existingItem.expirationDate = normalizedExpiration ?? null;
      }

      if (packPriceNum > 0 && packQtyNum > 0) {
        existingItem.packPrice = formatMoneyPtBr(packPriceNum);
        existingItem.packQuantity = packQtyNum;
      }

      // Atualiza o preço de venda se um novo valor válido foi detectado pela câmera/OCR ou digitado
      if (formattedIncomingPrice && formattedIncomingPrice !== "0,00") {
        if (previousPrice !== formattedIncomingPrice) {
          priceChanged = true;
          existingItem.productSalePrice = formattedIncomingPrice;
          existingItem.productUnitPrice = estimateUnitCostFromSalePrice(
            formattedIncomingPrice,
            explicitOrPackUnitCost || existingItem.productUnitPrice,
          );
          existingItem.priceHistory.push({
            price: formattedIncomingPrice,
            deviceName: payload.deviceName,
            timestamp: now,
            source: payload.priceSource ?? "ocr",
          });
        } else if (explicitOrPackUnitCost) {
          existingItem.productUnitPrice = explicitOrPackUnitCost;
        }
      } else if (explicitOrPackUnitCost) {
        existingItem.productUnitPrice = explicitOrPackUnitCost;
      }

      // Completa dados de catálogo se estavam genéricos antes
      if (
        catalog.found &&
        (existingItem.productName.startsWith("Produto ") || !existingItem.productName)
      ) {
        existingItem.productName = catalog.productName;
        if (!explicitCategory && catalog.productCategory) {
          existingItem.productCategory = catalog.productCategory;
        }
        existingItem.brand = catalog.brand || existingItem.brand;
        existingItem.productDescription =
          catalog.productDescription || existingItem.productDescription;
        existingItem.productImageUrl = catalog.productImageUrl || existingItem.productImageUrl;
        existingItem.catalogSource = catalog.source;
      }

      sheet.updatedAt = now;
      const summary = this.recalculateSheetMetrics(sheet);
      this.saveToDisk();

      this.touchDeviceScan(payload.deviceId, payload.deviceName, sheet.id);

      return {
        action: priceChanged ? "updated_price" : "incremented",
        item: existingItem,
        sheet: summary,
        catalog,
        priceChanged,
        previousPrice,
      };
    }

    // Novo item na planilha
    const finalSalePrice =
      formattedIncomingPrice && formattedIncomingPrice !== "0,00"
        ? formattedIncomingPrice
        : "0,00";
    const finalUnitCost = estimateUnitCostFromSalePrice(
      finalSalePrice,
      explicitOrPackUnitCost,
    );

    const productName =
      payload.productName?.trim() ||
      catalog.productName ||
      `Produto EAN ${productCode}`;

    const productCategory =
      explicitCategory ||
      catalog.productCategory ||
      "Mercearia";

    if (productCategory) {
      this.categories.add(productCategory);
    }

    const brand = payload.brand?.trim() || catalog.brand || "";

    const productSupplier =
      payload.productSupplier?.trim() ||
      sheet.defaultSupplier ||
      (brand ? `Fornecedor ${brand}` : "Distribuidora Geral");

    const productDescription =
      payload.productDescription?.trim() ||
      catalog.productDescription ||
      `${productName}${productCategory ? ` · Categoria: ${productCategory}` : ""}`;

    const newItem: ScannedProductItem = {
      id: crypto.randomUUID(),
      sheetId: sheet.id,
      productCode,
      productName,
      productSupplier,
      productDescription,
      productQnt: quantityDelta,
      productUnitPrice: finalUnitCost,
      productSalePrice: finalSalePrice,
      productCategory,
      brand,
      productImageUrl: payload.productImageUrl?.trim() || catalog.productImageUrl || "",
      unitType: catalog.suggestedUnitType ?? "UN",
      catalogSource: catalog.found ? catalog.source : "Cadastro Instantâneo",
      expirationDate: normalizedExpiration ?? null,
      ...(packPriceNum > 0 && packQtyNum > 0
        ? { packPrice: formatMoneyPtBr(packPriceNum), packQuantity: packQtyNum }
        : {}),
      lastCapturedByDeviceId: payload.deviceId,
      lastCapturedByDeviceName: payload.deviceName,
      captureCount: 1,
      priceHistory:
        finalSalePrice !== "0,00"
          ? [
              {
                price: finalSalePrice,
                deviceName: payload.deviceName,
                timestamp: now,
                source: payload.priceSource ?? "ocr",
              },
            ]
          : [],
      createdAt: now,
      updatedAt: now,
    };

    sheet.items.unshift(newItem);
    sheet.updatedAt = now;
    const summary = this.recalculateSheetMetrics(sheet);
    this.saveToDisk();

    this.touchDeviceScan(payload.deviceId, payload.deviceName, sheet.id);

    return {
      action: "created",
      item: newItem,
      sheet: summary,
      catalog,
      priceChanged: false,
      previousPrice: null,
    };
  }

  public updateItem(
    sheetId: string,
    itemId: string,
    updates: Partial<
      Pick<
        ScannedProductItem,
        | "productCode"
        | "productName"
        | "productSupplier"
        | "productDescription"
        | "productQnt"
        | "productUnitPrice"
        | "productSalePrice"
        | "productCategory"
        | "brand"
        | "packPrice"
        | "packQuantity"
        | "expirationDate"
      >
    > & { deviceName?: string },
  ): { item: ScannedProductItem; sheet: SheetSummary } | null {
    const sheet = this.getSheet(sheetId);
    if (!sheet) return null;

    const item = sheet.items.find((i) => i.id === itemId);
    if (!item) return null;

    const now = new Date().toISOString();

    if (updates.productCode !== undefined && updates.productCode.trim()) {
      item.productCode = updates.productCode.trim();
    }
    if (updates.productName !== undefined && updates.productName.trim()) {
      item.productName = updates.productName.trim();
    }
    if (updates.productSupplier !== undefined) {
      item.productSupplier = updates.productSupplier.trim() || sheet.defaultSupplier;
    }
    if (updates.productDescription !== undefined) {
      item.productDescription = updates.productDescription.trim() || item.productName;
    }
    if (updates.productCategory !== undefined) {
      const cat = updates.productCategory.trim();
      item.productCategory = cat;
      if (cat) {
        this.categories.add(cat);
      }
    }
    if (updates.brand !== undefined) {
      item.brand = updates.brand.trim();
    }
    if (updates.expirationDate !== undefined) {
      item.expirationDate = normalizeExpirationDate(updates.expirationDate);
    }
    if (updates.packPrice !== undefined) {
      const p = parseMoneyPtBr(updates.packPrice);
      item.packPrice = p > 0 ? formatMoneyPtBr(p) : undefined;
    }
    if (updates.packQuantity !== undefined) {
      const q = Number(updates.packQuantity);
      item.packQuantity = Number.isFinite(q) && q > 0 ? q : undefined;
    }
    if (updates.productQnt !== undefined) {
      const qnt = Number(updates.productQnt);
      if (Number.isFinite(qnt) && qnt >= 0) {
        item.productQnt = Math.round(qnt * 1000) / 1000;
      }
    }
    if (updates.productSalePrice !== undefined) {
      const parsedSale = parseMoneyPtBr(updates.productSalePrice);
      const formattedSale = formatMoneyPtBr(parsedSale);
      if (formattedSale !== item.productSalePrice) {
        item.productSalePrice = formattedSale;
        item.priceHistory.push({
          price: formattedSale,
          deviceName: updates.deviceName || "Edição Manual",
          timestamp: now,
          source: "manual",
        });
      }
      if (updates.productUnitPrice === undefined) {
        item.productUnitPrice = estimateUnitCostFromSalePrice(formattedSale);
      }
    }
    if (updates.productUnitPrice !== undefined) {
      const parsedCost = parseMoneyPtBr(updates.productUnitPrice);
      item.productUnitPrice = formatMoneyPtBr(parsedCost > 0 ? parsedCost : 1);
    }

    item.updatedAt = now;
    sheet.updatedAt = now;
    const summary = this.recalculateSheetMetrics(sheet);
    this.saveToDisk();

    return { item, sheet: summary };
  }

  public deleteItem(sheetId: string, itemId: string): SheetSummary | null {
    const sheet = this.getSheet(sheetId);
    if (!sheet) return null;

    const index = sheet.items.findIndex((i) => i.id === itemId);
    if (index === -1) return null;

    sheet.items.splice(index, 1);
    sheet.updatedAt = new Date().toISOString();
    const summary = this.recalculateSheetMetrics(sheet);
    this.saveToDisk();
    return summary;
  }

  /**
   * Unifica/junta múltiplas planilhas (ou todas as planilhas de vários celulares)
   * consolidando produtos pelo código de barras (productCode), somando quantidades
   * e aplicando a estratégia escolhida para preços divergentes.
   */
  public mergeSheets(request: MergeSheetsRequest): MergeSheetsResult {
    const sourceSheets = request.sourceSheetIds
      .map((id) => this.getSheet(id))
      .filter((s): s is SheetDetail => s !== null);

    if (sourceSheets.length === 0) {
      throw new Error("Selecione ao menos uma planilha para juntar.");
    }

    const byBarcode = new Map<string, ScannedProductItem>();
    let totalInputRows = 0;
    let conflictsResolved = 0;
    const now = new Date().toISOString();

    for (const sheet of sourceSheets) {
      // Percorre do mais antigo para o mais recente para respeitar a cronologia
      const orderedItems = [...sheet.items].sort((a, b) =>
        a.updatedAt.localeCompare(b.updatedAt),
      );

      for (const item of orderedItems) {
        totalInputRows += 1;
        const key = item.productCode.trim();
        const existing = byBarcode.get(key);

        if (!existing) {
          byBarcode.set(key, {
            ...item,
            id: crypto.randomUUID(),
            priceHistory: [...item.priceHistory],
          });
          continue;
        }

        // Consolida quantidade
        if (request.sumQuantities) {
          existing.productQnt =
            Math.round((existing.productQnt + item.productQnt) * 1000) / 1000;
        } else {
          existing.productQnt = Math.max(existing.productQnt, item.productQnt);
        }

        existing.captureCount += item.captureCount;

        // Resolução de preço entre diferentes celulares/planilhas
        const existingPrice = parseMoneyPtBr(existing.productSalePrice);
        const candidatePrice = parseMoneyPtBr(item.productSalePrice);

        if (candidatePrice > 0 && existingPrice > 0 && candidatePrice !== existingPrice) {
          conflictsResolved += 1;
        }

        const chosenPrice = this.chooseMergedPrice(
          existingPrice,
          candidatePrice,
          existing.updatedAt,
          item.updatedAt,
          request.priceStrategy,
        );

        existing.productSalePrice = formatMoneyPtBr(chosenPrice);
        existing.productUnitPrice = estimateUnitCostFromSalePrice(
          existing.productSalePrice,
          parseMoneyPtBr(item.productUnitPrice) > 0 ? item.productUnitPrice : existing.productUnitPrice,
        );

        // Enriquece textos caso um dos aparelhos tenha obtido nome ou imagem melhor
        if (
          item.productName &&
          (existing.productName.startsWith("Produto EAN") ||
            item.productName.length > existing.productName.length)
        ) {
          existing.productName = item.productName;
        }
        if (!existing.productImageUrl && item.productImageUrl) {
          existing.productImageUrl = item.productImageUrl;
        }
        if (!existing.brand && item.brand) {
          existing.brand = item.brand;
        }
        if (!existing.productCategory && item.productCategory) {
          existing.productCategory = item.productCategory;
        }
        if (item.expirationDate) {
          if (!existing.expirationDate || item.expirationDate < existing.expirationDate) {
            existing.expirationDate = item.expirationDate;
          }
        }
        if (item.updatedAt > existing.updatedAt) {
          existing.updatedAt = item.updatedAt;
          existing.lastCapturedByDeviceId = item.lastCapturedByDeviceId;
          existing.lastCapturedByDeviceName = `${existing.lastCapturedByDeviceName} + ${item.lastCapturedByDeviceName}`;
        }

        existing.priceHistory = [...existing.priceHistory, ...item.priceHistory].slice(-12);
      }
    }

    const mergedItems = Array.from(byBarcode.values()).sort((a, b) =>
      b.updatedAt.localeCompare(a.updatedAt),
    );

    let totalMergedUnits = 0;
    let totalEstimatedValue = 0;
    for (const item of mergedItems) {
      totalMergedUnits += item.productQnt;
      totalEstimatedValue += item.productQnt * parseMoneyPtBr(item.productSalePrice);
    }

    let targetSheet: SheetDetail | undefined;

    if (request.targetMode === "new_sheet") {
      const created = this.createSheet({
        name:
          request.newSheetName?.trim() ||
          `Planilha Unificada (${sourceSheets.length} coletas)`,
        aisleOrSector: "Unificação Multi-Celulares",
        defaultSupplier: sourceSheets[0]?.defaultSupplier || "Distribuidora Geral",
      });
      created.items = mergedItems.map((item) => ({
        ...item,
        sheetId: created.id,
        updatedAt: now,
      }));
      this.recalculateSheetMetrics(created);
      this.saveToDisk();
      targetSheet = created;
    } else if (request.targetMode === "into_existing" && request.targetSheetId) {
      const existingTarget = this.getSheet(request.targetSheetId);
      if (existingTarget) {
        existingTarget.items = mergedItems.map((item) => ({
          ...item,
          sheetId: existingTarget.id,
          updatedAt: now,
        }));
        existingTarget.updatedAt = now;
        this.recalculateSheetMetrics(existingTarget);
        this.saveToDisk();
        targetSheet = existingTarget;
      }
    }

    return {
      mergedItems,
      targetSheet,
      stats: {
        sheetsProcessed: sourceSheets.length,
        totalInputRows,
        uniqueBarcodes: mergedItems.length,
        totalMergedUnits: Math.round(totalMergedUnits * 1000) / 1000,
        totalEstimatedValue: Math.round(totalEstimatedValue * 100) / 100,
        conflictsResolved,
      },
    };
  }

  private chooseMergedPrice(
    existingPrice: number,
    candidatePrice: number,
    existingUpdatedAt: string,
    candidateUpdatedAt: string,
    strategy: PriceMergeStrategy,
  ): number {
    if (existingPrice <= 0) return candidatePrice;
    if (candidatePrice <= 0) return existingPrice;

    switch (strategy) {
      case "highest":
        return Math.max(existingPrice, candidatePrice);
      case "lowest":
        return Math.min(existingPrice, candidatePrice);
      case "keep_first":
        return existingUpdatedAt <= candidateUpdatedAt ? existingPrice : candidatePrice;
      case "latest":
      default:
        return candidateUpdatedAt >= existingUpdatedAt ? candidatePrice : existingPrice;
    }
  }

  public upsertDevice(device: {
    deviceId: string;
    deviceName: string;
    sheetId: string;
    isCameraActive: boolean;
  }): ConnectedDevice[] {
    const existing = this.devices.get(device.deviceId);
    const now = new Date().toISOString();
    this.devices.set(device.deviceId, {
      deviceId: device.deviceId,
      deviceName: device.deviceName || "Celular Operador",
      sheetId: device.sheetId,
      isCameraActive: device.isCameraActive,
      lastScanAt: existing?.lastScanAt ?? null,
      scansCount: existing?.scansCount ?? 0,
      connectedAt: existing?.connectedAt ?? now,
    });
    return this.listDevices();
  }

  public touchDeviceScan(deviceId: string, deviceName: string, sheetId: string): void {
    const existing = this.devices.get(deviceId);
    const now = new Date().toISOString();
    this.devices.set(deviceId, {
      deviceId,
      deviceName: deviceName || existing?.deviceName || "Celular Operador",
      sheetId,
      isCameraActive: true,
      lastScanAt: now,
      scansCount: (existing?.scansCount ?? 0) + 1,
      connectedAt: existing?.connectedAt ?? now,
    });
  }

  public removeDevice(deviceId: string): ConnectedDevice[] {
    this.devices.delete(deviceId);
    return this.listDevices();
  }

  public listDevices(): ConnectedDevice[] {
    return Array.from(this.devices.values());
  }
}

export const sheetStore = new SheetStore();
