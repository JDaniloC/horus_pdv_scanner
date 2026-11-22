/**
 * Arquivo: src/types/scanner.ts
 * Objetivo: Define contratos de dados para produtos escaneados, planilhas/sessões colaborativas,
 *           eventos WebSocket em tempo real e formato de exportação compatível com o Horus PDV.
 */

export type DuplicateScanBehavior = "increment" | "ignore" | "new_row";

export type PriceMergeStrategy = "latest" | "highest" | "lowest" | "keep_first";

export interface BarcodeCatalogInfo {
  barcode: string;
  found: boolean;
  source: string;
  productName: string;
  brand: string;
  productCategory: string;
  productDescription: string;
  productImageUrl: string;
  suggestedUnitType: "UN" | "KG";
  suggestedSalePrice: number | null;
}

export interface ScannedProductItem {
  id: string;
  sheetId: string;
  /** Coluna Horus PDV: Codigo */
  productCode: string;
  /** Coluna Horus PDV: Nome */
  productName: string;
  /** Coluna Horus PDV: Fornecedor */
  productSupplier: string;
  /** Coluna Horus PDV: Descricao */
  productDescription: string;
  /** Coluna Horus PDV: Quantidade */
  productQnt: number;
  /** Coluna Horus PDV: PrecoCusto (formato pt-BR ex: "5,40") */
  productUnitPrice: string;
  /** Coluna Horus PDV: PrecoVenda (formato pt-BR ex: "8,90") */
  productSalePrice: string;
  /**Metadados extras de enriquecimento da captura */
  productCategory: string;
  brand: string;
  productImageUrl: string;
  unitType: "UN" | "KG";
  catalogSource: string;
  packPrice?: string;
  packQuantity?: number;
  expirationDate?: string | null;
  lastCapturedByDeviceId: string;
  lastCapturedByDeviceName: string;
  captureCount: number;
  priceHistory: Array<{
    price: string;
    deviceName: string;
    timestamp: string;
    source: "ocr" | "manual" | "catalog" | "import";
  }>;
  createdAt: string;
  updatedAt: string;
}

export interface ConnectedDevice {
  deviceId: string;
  deviceName: string;
  sheetId: string;
  isCameraActive: boolean;
  lastScanAt: string | null;
  scansCount: number;
  connectedAt: string;
}

export interface SheetSummary {
  id: string;
  code: string;
  name: string;
  aisleOrSector: string;
  defaultSupplier: string;
  itemCount: number;
  totalUnits: number;
  estimatedTotalSaleValue: number;
  activeDevicesCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface SheetDetail extends SheetSummary {
  items: ScannedProductItem[];
}

export interface LiveScanPayload {
  sheetId: string;
  productCode: string;
  detectedSalePrice?: string;
  detectedUnitPrice?: string;
  packPrice?: string;
  packQuantity?: number;
  expirationDate?: string | null;
  productName?: string;
  productSupplier?: string;
  productDescription?: string;
  productCategory?: string;
  brand?: string;
  productImageUrl?: string;
  quantityDelta?: number;
  duplicateBehavior?: DuplicateScanBehavior;
  priceSource?: "ocr" | "manual" | "catalog" | "import";
  deviceId: string;
  deviceName: string;
}

export interface LiveScanResponse {
  action: "created" | "incremented" | "ignored" | "updated_price";
  item: ScannedProductItem;
  sheet: SheetSummary;
  catalog: BarcodeCatalogInfo | null;
  priceChanged: boolean;
  previousPrice: string | null;
}

export interface MergeSheetsRequest {
  sourceSheetIds: string[];
  targetMode: "new_sheet" | "into_existing" | "virtual_preview";
  targetSheetId?: string;
  newSheetName?: string;
  priceStrategy: PriceMergeStrategy;
  sumQuantities: boolean;
  deviceId?: string;
  deviceName?: string;
}

export interface MergeSheetsResult {
  mergedItems: ScannedProductItem[];
  targetSheet?: SheetDetail;
  stats: {
    sheetsProcessed: number;
    totalInputRows: number;
    uniqueBarcodes: number;
    totalMergedUnits: number;
    totalEstimatedValue: number;
    conflictsResolved: number;
  };
}

export interface WsEventMessage {
  type:
    | "STATE_SYNC"
    | "ITEM_CAPTURED"
    | "ITEM_UPDATED"
    | "ITEM_DELETED"
    | "SHEET_CREATED"
    | "SHEET_UPDATED"
    | "SHEET_DELETED"
    | "SHEETS_MERGED"
    | "DEVICES_UPDATED"
    | "CATEGORIES_UPDATED";
  payload: unknown;
  timestamp: string;
}
