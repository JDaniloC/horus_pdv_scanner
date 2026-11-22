/**
 * Arquivo: src/App.tsx
 * Objetivo: Aplicação principal Horus PDV Scanner — Coletor mobile com câmera sempre aberta,
 *           sincronização em tempo real via WebSocket entre diversos celulares e unificação de planilhas.
 */

import {
  Camera,
  FileSpreadsheet,
  GitMerge,
  Layers,
  ScanBarcode,
  Smartphone,
  Wifi,
  WifiOff,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import LiveCameraScanner from "@/components/LiveCameraScanner";
import LiveSpreadsheetTable from "@/components/LiveSpreadsheetTable";
import MultiSheetMergerPanel from "@/components/MultiSheetMergerPanel";
import { scannerApi, type CatalogSampleItem } from "@/services/scannerApi";
import type {
  ConnectedDevice,
  DuplicateScanBehavior,
  LiveScanResponse,
  MergeSheetsResult,
  PriceMergeStrategy,
  ScannedProductItem,
  SheetDetail,
  SheetSummary,
  WsEventMessage,
} from "@/types/scanner";
import { playScannerBeep } from "@/utils/soundEffects";

type MobileTab = "split_live" | "sheet_only" | "merge_multi";

function getOrCreateDeviceId(): string {
  const key = "horus_scanner_device_id";
  const saved = localStorage.getItem(key);
  if (saved) return saved;
  const generated = `cel-${Math.random().toString(36).slice(2, 8)}`;
  localStorage.setItem(key, generated);
  return generated;
}

function getOrCreateDeviceName(): string {
  const key = "horus_scanner_device_name";
  const saved = localStorage.getItem(key);
  if (saved) return saved;
  const num = Math.floor(10 + Math.random() * 89);
  const generated = `Celular Coletor #${num}`;
  localStorage.setItem(key, generated);
  return generated;
}

export default function App() {
  const [deviceId] = useState<string>(getOrCreateDeviceId);
  const [deviceName, setDeviceName] = useState<string>(getOrCreateDeviceName);
  const [activeTab, setActiveTab] = useState<MobileTab>("split_live");
  const [sheets, setSheets] = useState<SheetSummary[]>([]);
  const [activeSheet, setActiveSheet] = useState<SheetDetail | null>(null);
  const [categories, setCategories] = useState<string[]>([]);
  const [connectedDevices, setConnectedDevices] = useState<ConnectedDevice[]>([]);
  const [catalogSamples, setCatalogSamples] = useState<CatalogSampleItem[]>([]);
  const [duplicateBehavior, setDuplicateBehavior] =
    useState<DuplicateScanBehavior>("increment");
  const [soundEnabled, setSoundEnabled] = useState(true);
  const [isCameraActive, setIsCameraActive] = useState(false);
  const [wsConnected, setWsConnected] = useState(false);
  const [lastCaptureResult, setLastCaptureResult] = useState<LiveScanResponse | null>(
    null,
  );
  const [statusNotice, setStatusNotice] = useState<string | null>(null);

  const wsRef = useRef<WebSocket | null>(null);
  const activeSheetIdRef = useRef<string>("");

  useEffect(() => {
    activeSheetIdRef.current = activeSheet?.id ?? "";
  }, [activeSheet?.id]);

  const showNotice = useCallback((text: string) => {
    setStatusNotice(text);
    window.setTimeout(() => {
      setStatusNotice((curr) => (curr === text ? null : curr));
    }, 3600);
  }, []);

  const handleDeviceNameChange = (name: string) => {
    setDeviceName(name);
    localStorage.setItem("horus_scanner_device_name", name);
  };

  const loadActiveSheet = useCallback(async (idOrCode: string) => {
    try {
      const { sheet, devices } = await scannerApi.getSheet(idOrCode);
      setActiveSheet(sheet);
      setConnectedDevices(devices);
    } catch {
      // fallback para a primeira planilha disponível
    }
  }, []);

  // Carrega dados iniciais e respeita ?sheet=CODIGO na URL (para convite QR Code)
  useEffect(() => {
    async function bootstrap() {
      try {
        const [{ sheets: initialSheets, devices }, { samples }, { categories: initialCategories }] =
          await Promise.all([
            scannerApi.listSheets(),
            scannerApi.getCatalogSamples(),
            scannerApi.listCategories(),
          ]);
        setSheets(initialSheets);
        setConnectedDevices(devices);
        setCatalogSamples(samples);
        setCategories(initialCategories);

        const params = new URLSearchParams(window.location.search);
        const querySheetCode = params.get("sheet");
        const targetIdOrCode = querySheetCode || initialSheets[0]?.id;
        if (targetIdOrCode) {
          await loadActiveSheet(targetIdOrCode);
        }
      } catch (err) {
        console.error("Erro ao carregar dados iniciais:", err);
      }
    }
    bootstrap();
  }, [loadActiveSheet]);

  // Conexão WebSocket para sincronização em tempo real entre vários celulares
  useEffect(() => {
    let reconnectTimer: number | null = null;
    let isUnmounted = false;

    function connectWs() {
      if (isUnmounted) return;
      const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
      const wsUrl = `${protocol}//${window.location.host}/ws`;
      const ws = new WebSocket(wsUrl);
      wsRef.current = ws;

      ws.onopen = () => {
        if (isUnmounted) return;
        setWsConnected(true);
        ws.send(
          JSON.stringify({
            type: "DEVICE_HEARTBEAT",
            payload: {
              deviceId,
              deviceName,
              sheetId: activeSheetIdRef.current,
              isCameraActive,
            },
          }),
        );
      };

      ws.onmessage = (event) => {
        try {
          const msg = JSON.parse(String(event.data)) as WsEventMessage;
          const payload = msg.payload as Record<string, unknown> | undefined;
          if (!payload) return;

          if (Array.isArray(payload.sheets)) {
            setSheets(payload.sheets as SheetSummary[]);
          }
          if (Array.isArray(payload.devices)) {
            setConnectedDevices(payload.devices as ConnectedDevice[]);
          }
          if (Array.isArray(payload.categories)) {
            setCategories(payload.categories as string[]);
          }

          if (
            (msg.type === "ITEM_CAPTURED" ||
              msg.type === "ITEM_UPDATED" ||
              msg.type === "ITEM_DELETED") &&
            payload.sheetId === activeSheetIdRef.current &&
            activeSheetIdRef.current
          ) {
            scannerApi
              .getSheet(activeSheetIdRef.current)
              .then(({ sheet }) => setActiveSheet(sheet))
              .catch(() => {});
          }

          if (msg.type === "SHEETS_MERGED" && payload.targetSheet) {
            const mergedTarget = payload.targetSheet as SheetDetail;
            setActiveSheet(mergedTarget);
            showNotice(`Planilha consolidada "${mergedTarget.name}" criada com sucesso!`);
          }
        } catch {
          // ignora
        }
      };

      ws.onclose = () => {
        if (isUnmounted) return;
        setWsConnected(false);
        reconnectTimer = window.setTimeout(connectWs, 2200);
      };
    }

    connectWs();

    return () => {
      isUnmounted = true;
      if (reconnectTimer) window.clearTimeout(reconnectTimer);
      if (wsRef.current) wsRef.current.close();
    };
  }, [deviceId, deviceName, isCameraActive, showNotice]);

  // Envia heartbeat sempre que o celular troca de planilha ou ativa/desativa a câmera
  useEffect(() => {
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN && activeSheet) {
      wsRef.current.send(
        JSON.stringify({
          type: "DEVICE_HEARTBEAT",
          payload: {
            deviceId,
            deviceName,
            sheetId: activeSheet.id,
            isCameraActive,
          },
        }),
      );
    }
  }, [deviceId, deviceName, activeSheet, isCameraActive]);

  const handleCreateCategory = useCallback(
    async (name: string): Promise<string | null> => {
      try {
        const res = await scannerApi.createCategory(name);
        setCategories(res.categories);
        showNotice(`Categoria "${res.category}" criada e selecionada!`);
        return res.category;
      } catch (err) {
        showNotice(
          err instanceof Error ? err.message : "Erro ao criar categoria.",
        );
        return null;
      }
    },
    [showNotice],
  );

  const handleCaptureScan = useCallback(
    async (input: {
      productCode: string;
      detectedSalePrice?: string;
      detectedUnitPrice?: string;
      packPrice?: string;
      packQuantity?: number;
      expirationDate?: string | null;
      productName?: string;
      productCategory?: string;
      productDescription?: string;
      brand?: string;
      productImageUrl?: string;
      quantityDelta?: number;
      priceSource?: "ocr" | "manual" | "catalog";
    }): Promise<LiveScanResponse | null> => {
      if (!activeSheet) return null;
      try {
        const result = await scannerApi.recordScan({
          sheetId: activeSheet.id,
          productCode: input.productCode,
          detectedSalePrice: input.detectedSalePrice,
          detectedUnitPrice: input.detectedUnitPrice,
          packPrice: input.packPrice,
          packQuantity: input.packQuantity,
          expirationDate: input.expirationDate,
          productName: input.productName,
          productCategory: input.productCategory,
          productDescription: input.productDescription,
          brand: input.brand,
          productImageUrl: input.productImageUrl,
          quantityDelta: input.quantityDelta,
          duplicateBehavior,
          priceSource: input.priceSource ?? "ocr",
          deviceId,
          deviceName,
        });

        setLastCaptureResult(result);

        if (soundEnabled) {
          if (result.action === "created") {
            playScannerBeep("created");
          } else if (result.action === "updated_price") {
            playScannerBeep("price_updated");
          } else {
            playScannerBeep("incremented");
          }
        }

        const refreshed = await scannerApi.getSheet(activeSheet.id);
        setActiveSheet(refreshed.sheet);

        return result;
      } catch (err) {
        if (soundEnabled) playScannerBeep("error");
        showNotice(
          err instanceof Error ? err.message : "Erro ao contabilizar leitura.",
        );
        return null;
      }
    },
    [activeSheet, duplicateBehavior, deviceId, deviceName, soundEnabled, showNotice],
  );

  const handleUpdateItem = useCallback(
    async (itemId: string, updates: Partial<ScannedProductItem>) => {
      if (!activeSheet) return;
      const updated = await scannerApi.updateItem(activeSheet.id, itemId, {
        ...updates,
        deviceName,
      });
      const refreshed = await scannerApi.getSheet(activeSheet.id);
      setActiveSheet(refreshed.sheet);
      setLastCaptureResult((prev) =>
        prev && prev.item.id === itemId
          ? {
              ...prev,
              item: updated.item,
              sheet: updated.sheet,
            }
          : prev,
      );
      showNotice("Item atualizado na planilha.");
    },
    [activeSheet, deviceName, showNotice],
  );

  const handleDeleteItem = useCallback(
    async (itemId: string) => {
      if (!activeSheet) return;
      await scannerApi.deleteItem(activeSheet.id, itemId);
      const refreshed = await scannerApi.getSheet(activeSheet.id);
      setActiveSheet(refreshed.sheet);
      showNotice("Item removido da planilha.");
    },
    [activeSheet, showNotice],
  );

  const handleCreateSheet = useCallback(
    async (input: {
      name: string;
      aisleOrSector: string;
      defaultSupplier: string;
    }) => {
      const { sheet } = await scannerApi.createSheet(input);
      const { sheets: all } = await scannerApi.listSheets();
      setSheets(all);
      setActiveSheet(sheet);
      setActiveTab("split_live");
      showNotice(`Nova planilha "${sheet.name}" (${sheet.code}) aberta na câmera!`);
    },
    [showNotice],
  );

  const handleDeleteSheet = useCallback(
    async (sheetId: string) => {
      try {
        const { sheets: remaining } = await scannerApi.deleteSheet(sheetId);
        setSheets(remaining);
        if (activeSheet?.id === sheetId && remaining[0]) {
          await loadActiveSheet(remaining[0].id);
        }
        showNotice("Planilha removida.");
      } catch (err) {
        showNotice(
          err instanceof Error ? err.message : "Não foi possível excluir a planilha.",
        );
      }
    },
    [activeSheet?.id, loadActiveSheet, showNotice],
  );

  const handleMergeSheets = useCallback(
    async (input: {
      sourceSheetIds: string[];
      targetMode: "new_sheet" | "into_existing" | "virtual_preview";
      newSheetName?: string;
      priceStrategy: PriceMergeStrategy;
      sumQuantities: boolean;
    }): Promise<MergeSheetsResult | null> => {
      try {
        const result = await scannerApi.mergeSheets({
          ...input,
          deviceId,
          deviceName,
        });
        if (result.targetSheet) {
          const { sheets: all } = await scannerApi.listSheets();
          setSheets(all);
          setActiveSheet(result.targetSheet);
        }
        showNotice(
          `Unificação concluída: ${result.stats.uniqueBarcodes} produtos únicos (${result.stats.totalMergedUnits} unid.)!`,
        );
        return result;
      } catch (err) {
        showNotice(
          err instanceof Error ? err.message : "Erro ao juntar planilhas.",
        );
        return null;
      }
    },
    [deviceId, deviceName, showNotice],
  );

  const handleImportExternalRows = useCallback(
    async (
      sheetName: string,
      rows: Array<{
        productCode: string;
        productName: string;
        productSupplier: string;
        productDescription: string;
        productQnt: number;
        productUnitPrice: string;
        productSalePrice: string;
        productCategory?: string;
        expirationDate?: string | null;
      }>,
    ) => {
      const { sheet } = await scannerApi.createSheet({
        name: sheetName,
        aisleOrSector: "Planilha Importada",
        defaultSupplier: rows[0]?.productSupplier || "Distribuidora Geral",
      });

      for (const row of rows) {
        await scannerApi.recordScan({
          sheetId: sheet.id,
          productCode: row.productCode,
          productName: row.productName,
          productSupplier: row.productSupplier,
          productDescription: row.productDescription,
          detectedSalePrice: row.productSalePrice,
          detectedUnitPrice: row.productUnitPrice,
          productCategory: row.productCategory,
          expirationDate: row.expirationDate,
          quantityDelta: row.productQnt,
          duplicateBehavior: "increment",
          priceSource: "import",
          deviceId,
          deviceName,
        });
      }

      const { sheets: all } = await scannerApi.listSheets();
      setSheets(all);
      await loadActiveSheet(sheet.id);
      showNotice(
        `Arquivo importado com ${rows.length} linhas para juntar com os celulares!`,
      );
    },
    [deviceId, deviceName, loadActiveSheet, showNotice],
  );

  const totalGlobalItems = useMemo(
    () => sheets.reduce((acc, s) => acc + s.itemCount, 0),
    [sheets],
  );

  return (
    <div className="app-shell">
      {/* Cabeçalho Compacto Mobile-First */}
      <header className="app-header">
        <div className="brand-row">
          <div className="brand-identity">
            <div className="brand-logo-badge">
              <ScanBarcode size={20} />
            </div>
            <div>
              <h1 className="brand-title">Horus PDV · Coletor Ao Vivo</h1>
              <p className="brand-subtitle">
                Câmera Sempre Aberta · Código de Barras + OCR de Preço · Multi-Celulares
              </p>
            </div>
          </div>

          <div className="header-right-pills">
            <span
              className={`ws-status-pill ${wsConnected ? "is-online" : "is-offline"}`}
              title="Sincronização em tempo real entre celulares"
            >
              {wsConnected ? <Wifi size={13} /> : <WifiOff size={13} />}
              <span>
                {wsConnected
                  ? `${Math.max(1, connectedDevices.length)} celular(es) online`
                  : "Reconectando..."}
              </span>
            </span>

            {activeSheet ? (
              <div className="header-sheet-switcher">
                <label htmlFor="select-active-sheet" className="sr-only">
                  Planilha Ativa
                </label>
                <select
                  id="select-active-sheet"
                  value={activeSheet.id}
                  onChange={(e) => loadActiveSheet(e.target.value)}
                  className="header-sheet-select"
                >
                  {sheets.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.code} · {s.name} ({s.itemCount} itens)
                    </option>
                  ))}
                </select>
              </div>
            ) : null}
          </div>
        </div>

        {/* Barra de Navegação Mobile */}
        <nav className="mobile-tab-bar" aria-label="Modos do Coletor">
          <button
            type="button"
            id="tab-split-live"
            onClick={() => setActiveTab("split_live")}
            className={`tab-btn ${activeTab === "split_live" ? "is-active" : ""}`}
          >
            <Camera size={16} />
            <span>Câmera + Planilha ao Vivo</span>
          </button>

          <button
            type="button"
            id="tab-sheet-only"
            onClick={() => setActiveTab("sheet_only")}
            className={`tab-btn ${activeTab === "sheet_only" ? "is-active" : ""}`}
          >
            <FileSpreadsheet size={16} />
            <span>
              Planilha ({activeSheet?.itemCount ?? 0})
            </span>
          </button>

          <button
            type="button"
            id="tab-merge-multi"
            onClick={() => setActiveTab("merge_multi")}
            className={`tab-btn ${activeTab === "merge_multi" ? "is-active" : ""}`}
          >
            <GitMerge size={16} />
            <span>
              Juntar Celulares ({sheets.length} planilhas · {totalGlobalItems} itens)
            </span>
          </button>
        </nav>
      </header>

      {statusNotice ? (
        <div className="floating-notice" role="status">
          <span>{statusNotice}</span>
        </div>
      ) : null}

      {/* Conteúdo Principal */}
      <main className="app-main">
        {!activeSheet ? (
          <div className="loading-state">Carregando coletor e planilhas...</div>
        ) : activeTab === "split_live" ? (
          <div className="split-live-layout">
            <LiveCameraScanner
              sheetName={activeSheet.name}
              sheetCode={activeSheet.code}
              categories={categories}
              onCreateCategory={handleCreateCategory}
              duplicateBehavior={duplicateBehavior}
              onDuplicateBehaviorChange={setDuplicateBehavior}
              soundEnabled={soundEnabled}
              onToggleSound={() => setSoundEnabled((s) => !s)}
              onCaptureScan={handleCaptureScan}
              onApplyValuesToLastItem={handleUpdateItem}
              onCameraActiveChange={setIsCameraActive}
              catalogSamples={catalogSamples}
              lastCaptureResult={lastCaptureResult}
            />

            <LiveSpreadsheetTable
              sheet={activeSheet}
              categories={categories}
              onCreateCategory={handleCreateCategory}
              onUpdateItem={handleUpdateItem}
              onDeleteItem={handleDeleteItem}
            />
          </div>
        ) : activeTab === "sheet_only" ? (
          <div className="single-column-layout">
            <LiveSpreadsheetTable
              sheet={activeSheet}
              categories={categories}
              onCreateCategory={handleCreateCategory}
              onUpdateItem={handleUpdateItem}
              onDeleteItem={handleDeleteItem}
            />
          </div>
        ) : (
          <div className="single-column-layout">
            <MultiSheetMergerPanel
              sheets={sheets}
              activeSheet={activeSheet}
              connectedDevices={connectedDevices}
              currentDeviceId={deviceId}
              currentDeviceName={deviceName}
              onDeviceNameChange={handleDeviceNameChange}
              onSelectSheet={async (idOrCode) => {
                await loadActiveSheet(idOrCode);
                setActiveTab("split_live");
              }}
              onCreateSheet={handleCreateSheet}
              onDeleteSheet={handleDeleteSheet}
              onMergeSheets={handleMergeSheets}
              onImportExternalRows={handleImportExternalRows}
            />
          </div>
        )}
      </main>

      {/* Rodapé informativo de compatibilidade direta com o Horus PDV */}
      <footer className="app-footer">
        <div className="footer-inner">
          <div className="footer-tag">
            <Smartphone size={14} />
            <span>
              Dispositivo atual: <strong>{deviceName}</strong>
            </span>
          </div>
          <div className="footer-tag">
            <Layers size={14} />
            <span>
              Exportação 100% compatível com{" "}
              <strong>Horus PDV (Importar Produtos via Planilha .xlsx / .csv)</strong>
            </span>
          </div>
        </div>
      </footer>
    </div>
  );
}
