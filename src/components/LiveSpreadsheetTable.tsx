/**
 * Arquivo: src/components/LiveSpreadsheetTable.tsx
 * Objetivo: Exibe a planilha ao vivo alimentada pela câmera de um ou mais celulares,
 *           permitindo ajuste rápido de preço/quantidade (+/-), busca e exportação direta
 *           para Excel (.xlsx) e CSV no formato oficial do Horus PDV.
 */

import {
  Download,
  Edit3,
  FileSpreadsheet,
  Minus,
  Plus,
  Search,
  Smartphone,
  Trash2,
  Check,
  X,
} from "lucide-react";
import { useMemo, useState } from "react";
import type { ScannedProductItem, SheetDetail } from "@/types/scanner";
import {
  exportToHorusPdvCsv,
  exportToHorusPdvXlsx,
} from "@/utils/horusSpreadsheetCodec";

interface LiveSpreadsheetTableProps {
  sheet: SheetDetail;
  onUpdateItem: (
    itemId: string,
    updates: Partial<ScannedProductItem>,
  ) => Promise<void>;
  onDeleteItem: (itemId: string) => Promise<void>;
}

export default function LiveSpreadsheetTable({
  sheet,
  onUpdateItem,
  onDeleteItem,
}: LiveSpreadsheetTableProps) {
  const [search, setSearch] = useState("");
  const [editingItemId, setEditingItemId] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState<{
    productName: string;
    productSupplier: string;
    productQnt: string;
    productUnitPrice: string;
    productSalePrice: string;
  }>({
    productName: "",
    productSupplier: "",
    productQnt: "1",
    productUnitPrice: "0,00",
    productSalePrice: "0,00",
  });

  const filteredItems = useMemo(() => {
    const term = search.trim().toLowerCase();
    if (!term) return sheet.items;
    return sheet.items.filter(
      (item) =>
        item.productCode.toLowerCase().includes(term) ||
        item.productName.toLowerCase().includes(term) ||
        item.productCategory.toLowerCase().includes(term) ||
        item.productSupplier.toLowerCase().includes(term) ||
        item.lastCapturedByDeviceName.toLowerCase().includes(term),
    );
  }, [sheet.items, search]);

  const startEditing = (item: ScannedProductItem) => {
    setEditingItemId(item.id);
    setEditDraft({
      productName: item.productName,
      productSupplier: item.productSupplier,
      productQnt: String(item.productQnt),
      productUnitPrice: item.productUnitPrice,
      productSalePrice: item.productSalePrice,
    });
  };

  const saveEditing = async (itemId: string) => {
    const parsedQnt = Number.parseFloat(editDraft.productQnt.replace(",", "."));
    await onUpdateItem(itemId, {
      productName: editDraft.productName,
      productSupplier: editDraft.productSupplier,
      productQnt: Number.isFinite(parsedQnt) && parsedQnt >= 0 ? parsedQnt : 1,
      productUnitPrice: editDraft.productUnitPrice,
      productSalePrice: editDraft.productSalePrice,
    });
    setEditingItemId(null);
  };

  const handleQuickQuantityStep = async (item: ScannedProductItem, delta: number) => {
    const nextQnt = Math.max(1, Math.round((item.productQnt + delta) * 1000) / 1000);
    await onUpdateItem(item.id, { productQnt: nextQnt });
  };

  return (
    <section className="sheet-panel" aria-label="Planilha Capturada ao Vivo">
      <div className="sheet-panel-header">
        <div className="sheet-title-block">
          <div className="sheet-badge-row">
            <span className="sheet-code-tag">{sheet.code}</span>
            <span className="sheet-sector-tag">{sheet.aisleOrSector}</span>
          </div>
          <h2 className="sheet-main-title">{sheet.name}</h2>
          <p className="sheet-subtitle">
            Colunas prontas para o Horus PDV: <code>Codigo</code>, <code>Nome</code>,{" "}
            <code>Fornecedor</code>, <code>Descricao</code>, <code>Quantidade</code>,{" "}
            <code>PrecoCusto</code> e <code>PrecoVenda</code>.
          </p>
        </div>

        <div className="sheet-export-actions">
          <button
            type="button"
            id="btn-export-xlsx"
            disabled={sheet.items.length === 0}
            onClick={() => exportToHorusPdvXlsx(sheet.items, sheet.name)}
            className="btn-export-xlsx"
          >
            <FileSpreadsheet size={16} />
            <span>Baixar Excel (.xlsx)</span>
          </button>
          <button
            type="button"
            id="btn-export-csv"
            disabled={sheet.items.length === 0}
            onClick={() => exportToHorusPdvCsv(sheet.items, sheet.name)}
            className="btn-export-csv"
          >
            <Download size={16} />
            <span>Baixar CSV</span>
          </button>
        </div>
      </div>

      {/* Resumo de métricas da planilha atual */}
      <div className="sheet-metrics-strip">
        <div className="metric-box">
          <span className="metric-label">Produtos Únicos</span>
          <strong className="metric-value">{sheet.itemCount}</strong>
        </div>
        <div className="metric-box">
          <span className="metric-label">Unidades Contabilizadas</span>
          <strong className="metric-value text-emerald">{sheet.totalUnits}</strong>
        </div>
        <div className="metric-box">
          <span className="metric-label">Valor Total (Venda)</span>
          <strong className="metric-value text-amber">
            R${" "}
            {sheet.estimatedTotalSaleValue.toLocaleString("pt-BR", {
              minimumFractionDigits: 2,
              maximumFractionDigits: 2,
            })}
          </strong>
        </div>
      </div>

      {/* Filtro rápido */}
      <div className="sheet-search-bar">
        <Search size={16} className="search-icon" />
        <input
          id="input-search-sheet-items"
          type="search"
          placeholder="Filtrar por código EAN, nome do produto, categoria ou celular..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="sheet-search-input"
        />
      </div>

      {/* Lista / Tabela responsiva de produtos capturados */}
      {filteredItems.length === 0 ? (
        <div className="empty-sheet-state">
          <FileSpreadsheet size={32} />
          <p>Nenhum produto contabilizado nesta planilha ainda.</p>
          <span>
            Aponte a câmera para o código de barras e a etiqueta de preço ou toque em um item da
            Gôndola ao Vivo.
          </span>
        </div>
      ) : (
        <div className="captured-items-list">
          {filteredItems.map((item) => {
            const isEditing = editingItemId === item.id;
            return (
              <article key={item.id} className="captured-item-card">
                <div className="item-card-top">
                  <div className="item-identity">
                    <div className="item-code-row">
                      <span className="item-ean-badge">{item.productCode}</span>
                      <span className="item-category-badge">{item.productCategory}</span>
                      <span className="item-device-badge" title="Último celular que capturou">
                        <Smartphone size={11} />
                        {item.lastCapturedByDeviceName}
                      </span>
                    </div>
                    {isEditing ? (
                      <div className="item-edit-fields">
                        <input
                          type="text"
                          value={editDraft.productName}
                          onChange={(e) =>
                            setEditDraft((d) => ({ ...d, productName: e.target.value }))
                          }
                          placeholder="Nome do produto"
                          className="scanner-input"
                        />
                        <input
                          type="text"
                          value={editDraft.productSupplier}
                          onChange={(e) =>
                            setEditDraft((d) => ({ ...d, productSupplier: e.target.value }))
                          }
                          placeholder="Fornecedor"
                          className="scanner-input"
                        />
                      </div>
                    ) : (
                      <>
                        <h3 className="item-title">{item.productName}</h3>
                        <p className="item-description">
                          {item.productDescription} · Fornecedor:{" "}
                          <strong>{item.productSupplier}</strong>
                        </p>
                      </>
                    )}
                  </div>

                  {/* Controles de quantidade rápida (+/-) */}
                  <div className="item-qnt-stepper">
                    <button
                      type="button"
                      onClick={() => handleQuickQuantityStep(item, -1)}
                      className="qnt-step-btn"
                      aria-label="Diminuir quantidade"
                    >
                      <Minus size={14} />
                    </button>
                    <span className="qnt-display">{item.productQnt}</span>
                    <button
                      type="button"
                      onClick={() => handleQuickQuantityStep(item, 1)}
                      className="qnt-step-btn"
                      aria-label="Aumentar quantidade"
                    >
                      <Plus size={14} />
                    </button>
                  </div>
                </div>

                {/* Linha inferior com Preço de Venda, Preço de Custo e Ações */}
                <div className="item-card-bottom">
                  {isEditing ? (
                    <div className="item-price-edit-grid">
                      <label>
                        <span>Qtd</span>
                        <input
                          type="text"
                          value={editDraft.productQnt}
                          onChange={(e) =>
                            setEditDraft((d) => ({ ...d, productQnt: e.target.value }))
                          }
                          className="scanner-input font-mono"
                        />
                      </label>
                      <label>
                        <span>Custo (R$)</span>
                        <input
                          type="text"
                          value={editDraft.productUnitPrice}
                          onChange={(e) =>
                            setEditDraft((d) => ({ ...d, productUnitPrice: e.target.value }))
                          }
                          className="scanner-input font-mono"
                        />
                      </label>
                      <label>
                        <span>Venda (R$)</span>
                        <input
                          type="text"
                          value={editDraft.productSalePrice}
                          onChange={(e) =>
                            setEditDraft((d) => ({ ...d, productSalePrice: e.target.value }))
                          }
                          className="scanner-input font-mono"
                        />
                      </label>
                    </div>
                  ) : (
                    <div className="item-prices-group">
                      <div className="price-pill sale-price-pill">
                        <span className="price-label">Preço Venda</span>
                        <strong>R$ {item.productSalePrice}</strong>
                      </div>
                      <div className="price-pill cost-price-pill">
                        <span className="price-label">Custo Unit.</span>
                        <strong>R$ {item.productUnitPrice}</strong>
                      </div>
                    </div>
                  )}

                  <div className="item-row-actions">
                    {isEditing ? (
                      <>
                        <button
                          type="button"
                          onClick={() => saveEditing(item.id)}
                          className="action-icon-btn save"
                          title="Salvar alterações"
                        >
                          <Check size={15} />
                        </button>
                        <button
                          type="button"
                          onClick={() => setEditingItemId(null)}
                          className="action-icon-btn"
                          title="Cancelar"
                        >
                          <X size={15} />
                        </button>
                      </>
                    ) : (
                      <>
                        <button
                          type="button"
                          onClick={() => startEditing(item)}
                          className="action-icon-btn"
                          title="Editar preço, nome ou fornecedor"
                        >
                          <Edit3 size={15} />
                        </button>
                        <button
                          type="button"
                          onClick={() => onDeleteItem(item.id)}
                          className="action-icon-btn danger"
                          title="Remover item da planilha"
                        >
                          <Trash2 size={15} />
                        </button>
                      </>
                    )}
                  </div>
                </div>
              </article>
            );
          })}
        </div>
      )}
    </section>
  );
}
