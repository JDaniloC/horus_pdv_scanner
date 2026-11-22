/**
 * Arquivo: src/components/MultiSheetMergerPanel.tsx
 * Objetivo: Permite que diversos celulares capturem produtos ao mesmo tempo (na mesma planilha
 *           ou em planilhas/corredores diferentes) e junta tudo automaticamente em uma planilha
 *           consolidada pronta para o Horus PDV, incluindo upload de arquivos .xlsx/.csv externos.
 */

import {
  CheckSquare,
  Download,
  FileSpreadsheet,
  GitMerge,
  Plus,
  QrCode,
  Smartphone,
  Square,
  Trash2,
  Upload,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import QRCode from "qrcode";
import type {
  ConnectedDevice,
  MergeSheetsResult,
  PriceMergeStrategy,
  SheetDetail,
  SheetSummary,
} from "@/types/scanner";
import {
  exportToHorusPdvCsv,
  exportToHorusPdvXlsx,
  parseExternalSpreadsheetFile,
} from "@/utils/horusSpreadsheetCodec";

interface MultiSheetMergerPanelProps {
  sheets: SheetSummary[];
  activeSheet: SheetDetail;
  connectedDevices: ConnectedDevice[];
  currentDeviceId: string;
  currentDeviceName: string;
  onDeviceNameChange: (name: string) => void;
  onSelectSheet: (sheetIdOrCode: string) => Promise<void>;
  onCreateSheet: (input: {
    name: string;
    aisleOrSector: string;
    defaultSupplier: string;
  }) => Promise<void>;
  onDeleteSheet: (sheetId: string) => Promise<void>;
  onMergeSheets: (input: {
    sourceSheetIds: string[];
    targetMode: "new_sheet" | "into_existing" | "virtual_preview";
    newSheetName?: string;
    priceStrategy: PriceMergeStrategy;
    sumQuantities: boolean;
  }) => Promise<MergeSheetsResult | null>;
  onImportExternalRows: (
    sheetName: string,
    rows: Array<{
      productCode: string;
      productName: string;
      productSupplier: string;
      productDescription: string;
      productQnt: number;
      productUnitPrice: string;
      productSalePrice: string;
    }>,
  ) => Promise<void>;
}

export default function MultiSheetMergerPanel({
  sheets,
  activeSheet,
  connectedDevices,
  currentDeviceId,
  currentDeviceName,
  onDeviceNameChange,
  onSelectSheet,
  onCreateSheet,
  onDeleteSheet,
  onMergeSheets,
  onImportExternalRows,
}: MultiSheetMergerPanelProps) {
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [selectedForMerge, setSelectedForMerge] = useState<Set<string>>(
    () => new Set(sheets.map((s) => s.id)),
  );
  const [priceStrategy, setPriceStrategy] = useState<PriceMergeStrategy>("latest");
  const [sumQuantities, setSumQuantities] = useState(true);
  const [mergedSheetName, setMergedSheetName] = useState(
    "Planilha Geral Unificada - Mercadinho",
  );
  const [mergeResult, setMergeResult] = useState<MergeSheetsResult | null>(null);
  const [isMerging, setIsMerging] = useState(false);

  // Nova planilha / corredor
  const [newName, setNewName] = useState("");
  const [newAisle, setNewAisle] = useState("");
  const [newSupplier, setNewSupplier] = useState("Distribuidora Brasil");
  const [joinCodeInput, setJoinCodeInput] = useState("");

  // QR Code para outros celulares entrarem na mesma sessão
  const [qrDataUrl, setQrDataUrl] = useState<string>("");
  const [showQrModal, setShowQrModal] = useState(false);

  useEffect(() => {
    setSelectedForMerge((prev) => {
      const next = new Set(prev);
      for (const s of sheets) {
        if (!next.has(s.id) && prev.size === 0) {
          next.add(s.id);
        }
      }
      return next;
    });
  }, [sheets]);

  useEffect(() => {
    const shareUrl = `${window.location.origin}/?sheet=${encodeURIComponent(activeSheet.code)}`;
    QRCode.toDataURL(shareUrl, {
      width: 220,
      margin: 1,
      color: {
        dark: "#0b111e",
        light: "#ffffff",
      },
    })
      .then((url) => setQrDataUrl(url))
      .catch(() => setQrDataUrl(""));
  }, [activeSheet.code]);

  const toggleSheetSelection = (sheetId: string) => {
    setSelectedForMerge((prev) => {
      const next = new Set(prev);
      if (next.has(sheetId)) {
        next.delete(sheetId);
      } else {
        next.add(sheetId);
      }
      return next;
    });
  };

  const selectAllSheets = () => {
    setSelectedForMerge(new Set(sheets.map((s) => s.id)));
  };

  const handleCreateNewSheet = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newName.trim()) return;
    await onCreateSheet({
      name: newName.trim(),
      aisleOrSector: newAisle.trim() || "Geral",
      defaultSupplier: newSupplier.trim() || "Distribuidora Geral",
    });
    setNewName("");
    setNewAisle("");
  };

  const handlePreviewOrDownloadUnified = async (
    mode: "virtual_preview" | "new_sheet",
    autoExportFormat?: "xlsx" | "csv",
  ) => {
    const ids = Array.from(selectedForMerge);
    if (ids.length === 0) return;

    setIsMerging(true);
    try {
      const res = await onMergeSheets({
        sourceSheetIds: ids,
        targetMode: mode,
        newSheetName: mergedSheetName.trim() || "Planilha Unificada Horus PDV",
        priceStrategy,
        sumQuantities,
      });
      if (res) {
        setMergeResult(res);
        if (autoExportFormat === "xlsx") {
          await exportToHorusPdvXlsx(
            res.mergedItems,
            mergedSheetName || "planilha-unificada",
          );
        } else if (autoExportFormat === "csv") {
          exportToHorusPdvCsv(
            res.mergedItems,
            mergedSheetName || "planilha-unificada",
          );
        }
      }
    } finally {
      setIsMerging(false);
    }
  };

  const handleExternalFileUpload = async (file: File | null) => {
    if (!file) return;
    const rows = await parseExternalSpreadsheetFile(file);
    if (rows.length === 0) return;
    const cleanTitle = file.name.replace(/\.(xlsx|csv)$/i, "");
    await onImportExternalRows(`Importada: ${cleanTitle}`, rows);
    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
  };

  return (
    <div className="merger-container">
      {/* Bloco 1: Identificação deste Celular & Sincronização Multi-Celulares */}
      <section className="merger-card">
        <div className="merger-card-header">
          <div>
            <span className="section-eyebrow">MULTI-DISPOSITIVOS EM TEMPO REAL</span>
            <h2 className="merger-title">Celulares Conectados & Sessão Atual</h2>
          </div>
          <button
            type="button"
            id="btn-show-qr-invite"
            onClick={() => setShowQrModal((v) => !v)}
            className="btn-outline-action"
          >
            <QrCode size={16} />
            <span>{showQrModal ? "Ocultar QR Code" : "Convidar Celulares"}</span>
          </button>
        </div>

        <div className="device-identity-bar">
          <div className="input-group">
            <label htmlFor="input-device-name">Nome deste Celular / Operador:</label>
            <input
              id="input-device-name"
              type="text"
              value={currentDeviceName}
              onChange={(e) => onDeviceNameChange(e.target.value)}
              placeholder="Ex: Celular Danilo - Corredor 1"
              className="scanner-input"
            />
          </div>

          <div className="input-group">
            <label htmlFor="input-join-code">Entrar por Código de Planilha:</label>
            <div className="inline-join-box">
              <input
                id="input-join-code"
                type="text"
                value={joinCodeInput}
                onChange={(e) => setJoinCodeInput(e.target.value.toUpperCase())}
                placeholder="Ex: MERC-101"
                className="scanner-input font-mono"
              />
              <button
                type="button"
                id="btn-join-by-code"
                onClick={() => {
                  if (joinCodeInput.trim()) {
                    onSelectSheet(joinCodeInput.trim());
                    setJoinCodeInput("");
                  }
                }}
                className="btn-join-code"
              >
                Conectar
              </button>
            </div>
          </div>
        </div>

        {showQrModal && qrDataUrl ? (
          <div className="qr-invite-box">
            <img
              src={qrDataUrl}
              alt={`QR Code para planilha ${activeSheet.code}`}
              className="qr-image"
            />
            <div className="qr-invite-info">
              <strong>Aponte outros celulares para entrar na planilha {activeSheet.name}</strong>
              <p>
                Código de acesso rápido: <code className="qr-code-pill">{activeSheet.code}</code>
              </p>
              <span>
                Qualquer celular pode escanear na mesma planilha ao mesmo tempo ou criar uma
                planilha separada por corredor para juntar tudo depois.
              </span>
            </div>
          </div>
        ) : null}

        <div className="connected-devices-grid">
          {connectedDevices.map((dev) => {
            const targetSheet = sheets.find((s) => s.id === dev.sheetId);
            const isMe = dev.deviceId === currentDeviceId;
            return (
              <div
                key={dev.deviceId}
                className={`device-chip ${isMe ? "is-current-device" : ""}`}
              >
                <Smartphone size={16} />
                <div className="device-chip-info">
                  <strong>
                    {dev.deviceName} {isMe ? "(Você)" : ""}
                  </strong>
                  <span>
                    Planilha: {targetSheet?.name ?? "Geral"} · {dev.scansCount} leituras
                  </span>
                </div>
                <span
                  className={`device-cam-dot ${dev.isCameraActive ? "cam-on" : "cam-idle"}`}
                  title={dev.isCameraActive ? "Câmera aberta" : "Em espera"}
                />
              </div>
            );
          })}
        </div>
      </section>

      {/* Bloco 2: Unificador / Fusão de Múltiplas Planilhas de Diferentes Celulares */}
      <section className="merger-card">
        <div className="merger-card-header">
          <div>
            <span className="section-eyebrow">UNIFICAÇÃO AUTOMÁTICA DE PLANILHAS</span>
            <h2 className="merger-title">
              Juntar Planilhas de Diferentes Celulares / Corredores
            </h2>
            <p className="merger-desc">
              Selecione abaixo quais planilhas (de diferentes aparelhos ou arquivos externos) você
              deseja unificar. Códigos de barras iguais terão as quantidades somadas e os preços
              consolidados.
            </p>
          </div>

          <div>
            <input
              ref={fileInputRef}
              type="file"
              accept=".xlsx,.csv"
              className="sr-only"
              onChange={(e) => handleExternalFileUpload(e.target.files?.[0] ?? null)}
            />
            <button
              type="button"
              id="btn-upload-external-sheet"
              onClick={() => fileInputRef.current?.click()}
              className="btn-outline-action"
            >
              <Upload size={15} />
              <span>Importar .xlsx/.csv Externo para Juntar</span>
            </button>
          </div>
        </div>

        {/* Lista de planilhas disponíveis com checkbox para mesclar e botão para ativar na câmera */}
        <div className="sheets-selection-header">
          <span>
            {selectedForMerge.size} de {sheets.length} planilha(s) selecionadas para juntar
          </span>
          <button type="button" onClick={selectAllSheets} className="text-link-btn">
            Selecionar todas as planilhas
          </button>
        </div>

        <div className="sheets-selector-list">
          {sheets.map((sheet) => {
            const isSelectedForMerge = selectedForMerge.has(sheet.id);
            const isCurrentActive = sheet.id === activeSheet.id;
            return (
              <div
                key={sheet.id}
                className={`sheet-selector-item ${isCurrentActive ? "is-active-sheet" : ""}`}
              >
                <button
                  type="button"
                  onClick={() => toggleSheetSelection(sheet.id)}
                  className="sheet-check-btn"
                  aria-label={`Selecionar ${sheet.name} para unificação`}
                >
                  {isSelectedForMerge ? (
                    <CheckSquare size={20} className="text-emerald" />
                  ) : (
                    <Square size={20} />
                  )}
                </button>

                <div className="sheet-selector-body">
                  <div className="sheet-selector-topline">
                    <span className="sheet-code-tag">{sheet.code}</span>
                    <strong>{sheet.name}</strong>
                    {isCurrentActive ? (
                      <span className="active-sheet-pill">ATIVA NA CÂMERA</span>
                    ) : null}
                  </div>
                  <div className="sheet-selector-stats">
                    <span>{sheet.itemCount} produtos únicos</span>
                    <span>·</span>
                    <span>{sheet.totalUnits} unid.</span>
                    <span>·</span>
                    <span>
                      R${" "}
                      {sheet.estimatedTotalSaleValue.toLocaleString("pt-BR", {
                        minimumFractionDigits: 2,
                        maximumFractionDigits: 2,
                      })}
                    </span>
                  </div>
                </div>

                <div className="sheet-selector-actions">
                  {!isCurrentActive ? (
                    <button
                      type="button"
                      onClick={() => onSelectSheet(sheet.id)}
                      className="btn-use-sheet"
                    >
                      Usar na Câmera
                    </button>
                  ) : null}
                  {sheets.length > 1 ? (
                    <button
                      type="button"
                      onClick={() => onDeleteSheet(sheet.id)}
                      className="action-icon-btn danger"
                      title="Excluir planilha"
                    >
                      <Trash2 size={15} />
                    </button>
                  ) : null}
                </div>
              </div>
            );
          })}
        </div>

        {/* Opções de Regra de Unificação */}
        <div className="merge-rules-grid">
          <div className="input-group">
            <label htmlFor="input-merged-sheet-name">Nome da Planilha Unificada Final:</label>
            <input
              id="input-merged-sheet-name"
              type="text"
              value={mergedSheetName}
              onChange={(e) => setMergedSheetName(e.target.value)}
              className="scanner-input"
            />
          </div>

          <div className="input-group">
            <label htmlFor="select-price-strategy">
              Se dois celulares capturarem preços diferentes para o mesmo EAN:
            </label>
            <select
              id="select-price-strategy"
              value={priceStrategy}
              onChange={(e) => setPriceStrategy(e.target.value as PriceMergeStrategy)}
              className="scanner-select"
            >
              <option value="latest">Usar o preço capturado mais recentemente</option>
              <option value="highest">Usar o maior preço de venda</option>
              <option value="lowest">Usar o menor preço de venda</option>
              <option value="keep_first">Manter o primeiro preço registrado</option>
            </select>
          </div>

          <label className="merge-checkbox-row">
            <input
              type="checkbox"
              checked={sumQuantities}
              onChange={(e) => setSumQuantities(e.target.checked)}
            />
            <span>
              Somar quantidades de códigos repetidos entre as planilhas (ex: 4 un no Celular A + 2
              un no Celular B = 6 un)
            </span>
          </label>
        </div>

        {/* Botões de Unificação e Download Direto */}
        <div className="merge-actions-bar">
          <button
            type="button"
            id="btn-merge-download-xlsx"
            disabled={selectedForMerge.size === 0 || isMerging}
            onClick={() => handlePreviewOrDownloadUnified("virtual_preview", "xlsx")}
            className="btn-primary-merge"
          >
            <FileSpreadsheet size={18} />
            <span>Juntar Tudo & Baixar Excel (.xlsx) Horus PDV</span>
          </button>

          <button
            type="button"
            id="btn-merge-download-csv"
            disabled={selectedForMerge.size === 0 || isMerging}
            onClick={() => handlePreviewOrDownloadUnified("virtual_preview", "csv")}
            className="btn-secondary-merge"
          >
            <Download size={17} />
            <span>Juntar & Baixar CSV</span>
          </button>

          <button
            type="button"
            id="btn-merge-create-sheet"
            disabled={selectedForMerge.size === 0 || isMerging}
            onClick={() => handlePreviewOrDownloadUnified("new_sheet")}
            className="btn-secondary-merge"
          >
            <GitMerge size={17} />
            <span>Criar Planilha Consolidada no Painel</span>
          </button>
        </div>

        {/* Resultado da última fusão */}
        {mergeResult ? (
          <div className="merge-result-banner" role="region" aria-label="Resumo da Unificação">
            <div className="merge-result-stats">
              <div>
                <span>Planilhas Juntadas</span>
                <strong>{mergeResult.stats.sheetsProcessed}</strong>
              </div>
              <div>
                <span>Produtos Únicos (EAN)</span>
                <strong>{mergeResult.stats.uniqueBarcodes}</strong>
              </div>
              <div>
                <span>Total Unidades Somadas</span>
                <strong className="text-emerald">{mergeResult.stats.totalMergedUnits}</strong>
              </div>
              <div>
                <span>Valor Total Unificado</span>
                <strong className="text-amber">
                  R${" "}
                  {mergeResult.stats.totalEstimatedValue.toLocaleString("pt-BR", {
                    minimumFractionDigits: 2,
                    maximumFractionDigits: 2,
                  })}
                </strong>
              </div>
            </div>
          </div>
        ) : null}
      </section>

      {/* Bloco 3: Criar Nova Planilha Separada (ex: por Corredor ou por Operador) */}
      <section className="merger-card">
        <span className="section-eyebrow">NOVA FRENTE DE COLETA</span>
        <h2 className="merger-title">Criar Nova Planilha / Corredor</h2>
        <form onSubmit={handleCreateNewSheet} className="create-sheet-form">
          <div className="manual-inputs-grid">
            <div className="input-group">
              <label htmlFor="input-new-sheet-name">Nome da Planilha</label>
              <input
                id="input-new-sheet-name"
                type="text"
                placeholder="Ex: Corredor 3 · Limpeza e Higiene"
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                className="scanner-input"
              />
            </div>
            <div className="input-group">
              <label htmlFor="input-new-sheet-aisle">Setor / Corredor</label>
              <input
                id="input-new-sheet-aisle"
                type="text"
                placeholder="Ex: Corredor 03"
                value={newAisle}
                onChange={(e) => setNewAisle(e.target.value)}
                className="scanner-input"
              />
            </div>
            <div className="input-group">
              <label htmlFor="input-new-sheet-supplier">Fornecedor Padrão</label>
              <input
                id="input-new-sheet-supplier"
                type="text"
                placeholder="Ex: Distribuidora Brasil"
                value={newSupplier}
                onChange={(e) => setNewSupplier(e.target.value)}
                className="scanner-input"
              />
            </div>
          </div>
          <button
            type="submit"
            id="btn-create-new-sheet"
            disabled={!newName.trim()}
            className="btn-create-sheet"
          >
            <Plus size={17} />
            <span>Criar Planilha e Abrir na Câmera</span>
          </button>
        </form>
      </section>
    </div>
  );
}
