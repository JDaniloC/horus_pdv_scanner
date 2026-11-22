/**
 * Arquivo: src/services/scannerApi.ts
 * Objetivo: Cliente HTTP para comunicação com o backend de planilhas colaborativas e catálogo de produtos.
 */

import type {
  BarcodeCatalogInfo,
  ConnectedDevice,
  LiveScanPayload,
  LiveScanResponse,
  MergeSheetsRequest,
  MergeSheetsResult,
  ScannedProductItem,
  SheetDetail,
  SheetSummary,
} from "@/types/scanner";

export interface CatalogSampleItem extends Omit<BarcodeCatalogInfo, "found"> {
  barcode: string;
}

async function requestJson<T>(url: string, options?: RequestInit): Promise<T> {
  const response = await fetch(url, {
    headers: {
      "Content-Type": "application/json",
      ...(options?.headers ?? {}),
    },
    ...options,
  });

  if (!response.ok) {
    let errorMsg = `Erro HTTP ${response.status}`;
    try {
      const errJson = (await response.json()) as { message?: string };
      if (errJson?.message) errorMsg = errJson.message;
    } catch {
      // ignora
    }
    throw new Error(errorMsg);
  }

  return (await response.json()) as T;
}

export const scannerApi = {
  listSheets(): Promise<{ sheets: SheetSummary[]; devices: ConnectedDevice[] }> {
    return requestJson("/api/sheets");
  },

  getSheet(idOrCode: string): Promise<{ sheet: SheetDetail; devices: ConnectedDevice[] }> {
    return requestJson(`/api/sheets/${encodeURIComponent(idOrCode)}`);
  },

  createSheet(input: {
    name: string;
    aisleOrSector?: string;
    defaultSupplier?: string;
  }): Promise<{ sheet: SheetDetail }> {
    return requestJson("/api/sheets", {
      method: "POST",
      body: JSON.stringify(input),
    });
  },

  deleteSheet(sheetId: string): Promise<{ deleted: boolean; sheets: SheetSummary[] }> {
    return requestJson(`/api/sheets/${encodeURIComponent(sheetId)}`, {
      method: "DELETE",
    });
  },

  recordScan(payload: LiveScanPayload): Promise<LiveScanResponse> {
    return requestJson("/api/scans", {
      method: "POST",
      body: JSON.stringify(payload),
    });
  },

  updateItem(
    sheetId: string,
    itemId: string,
    updates: Partial<ScannedProductItem> & { deviceName?: string },
  ): Promise<{ item: ScannedProductItem; sheet: SheetSummary }> {
    return requestJson(
      `/api/sheets/${encodeURIComponent(sheetId)}/items/${encodeURIComponent(itemId)}`,
      {
        method: "PATCH",
        body: JSON.stringify(updates),
      },
    );
  },

  deleteItem(sheetId: string, itemId: string): Promise<{ deleted: boolean; sheet: SheetSummary }> {
    return requestJson(
      `/api/sheets/${encodeURIComponent(sheetId)}/items/${encodeURIComponent(itemId)}`,
      {
        method: "DELETE",
      },
    );
  },

  mergeSheets(payload: MergeSheetsRequest): Promise<MergeSheetsResult> {
    return requestJson("/api/sheets/merge", {
      method: "POST",
      body: JSON.stringify(payload),
    });
  },

  lookupBarcode(barcode: string): Promise<BarcodeCatalogInfo> {
    return requestJson(`/api/barcode/${encodeURIComponent(barcode)}`);
  },

  getCatalogSamples(): Promise<{ samples: CatalogSampleItem[] }> {
    return requestJson("/api/catalog/samples");
  },

  searchCatalogByName(query: string): Promise<{ results: BarcodeCatalogInfo[] }> {
    return requestJson(`/api/catalog/search?q=${encodeURIComponent(query)}`);
  },

  listCategories(): Promise<{ categories: string[] }> {
    return requestJson("/api/categories");
  },

  createCategory(name: string): Promise<{ category: string; categories: string[] }> {
    return requestJson("/api/categories", {
      method: "POST",
      body: JSON.stringify({ name }),
    });
  },
};
