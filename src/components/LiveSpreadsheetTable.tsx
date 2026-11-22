/**
 * Arquivo: src/components/LiveSpreadsheetTable.tsx
 * Objetivo: Exibe a planilha ao vivo alimentada pela câmera de um ou mais celulares,
 *           permitindo ajuste rápido de preço/quantidade (+/-), categoria (com criação na hora),
 *           cálculo de custo por fardo na edição e exportação para Excel (.xlsx) e CSV do Horus PDV.
 */

import {
  Check,
  Download,
  Edit3,
  FileSpreadsheet,
  FolderPlus,
  Minus,
  Plus,
  Search,
  Smartphone,
  Trash2,
  X,
} from "lucide-react";
import { useMemo, useState } from "react";
import type { ScannedProductItem, SheetDetail } from "@/types/scanner";
import {
  exportToHorusPdvCsv,
  exportToHorusPdvXlsx,
} from "@/utils/horusSpreadsheetCodec";
import {
  calculateMarginPercent,
  calculateSalePriceFromMargin,
  calculateUnitCostFromPack,
} from "@/utils/packPricing";

interface LiveSpreadsheetTableProps {
  sheet: SheetDetail;
  categories: string[];
  onCreateCategory: (name: string) => Promise<string | null>;
  onUpdateItem: (
    itemId: string,
    updates: Partial<ScannedProductItem>,
  ) => Promise<void>;
  onDeleteItem: (itemId: string) => Promise<void>;
}

export default function LiveSpreadsheetTable({
  sheet,
  categories,
  onCreateCategory,
  onUpdateItem,
  onDeleteItem,
}: LiveSpreadsheetTableProps) {
  const [search, setSearch] = useState("");
  const [selectedCategoryFilter, setSelectedCategoryFilter] = useState("ALL");
  const [editingItemId, setEditingItemId] = useState<string | null>(null);
  const [inlineNewCategory, setInlineNewCategory] = useState("");
  const [showInlineCategoryCreate, setShowInlineCategoryCreate] = useState(false);

  const [editDraft, setEditDraft] = useState<{
    productName: string;
    productSupplier: string;
    productCategory: string;
    productQnt: string;
    productUnitPrice: string;
    productSalePrice: string;
    packPrice: string;
    packQuantity: string;
    marginPercent: string;
  }>({
    productName: "",
    productSupplier: "",
    productCategory: "",
    productQnt: "1",
    productUnitPrice: "0,00",
    productSalePrice: "0,00",
    packPrice: "",
    packQuantity: "",
    marginPercent: "35",
  });

  const filteredItems = useMemo(() => {
    const term = search.trim().toLowerCase();
    return sheet.items.filter((item) => {
      if (
        selectedCategoryFilter !== "ALL" &&
        item.productCategory.toLowerCase() !== selectedCategoryFilter.toLowerCase()
      ) {
        return false;
      }
      if (!term) return true;
      return (
        item.productCode.toLowerCase().includes(term) ||
        item.productName.toLowerCase().includes(term) ||
        item.productCategory.toLowerCase().includes(term) ||
        item.productSupplier.toLowerCase().includes(term) ||
        item.lastCapturedByDeviceName.toLowerCase().includes(term)
      );
    });
  }, [sheet.items, search, selectedCategoryFilter]);

  const sheetCategories = useMemo(() => {
    const set = new Set<string>(categories);
    for (const item of sheet.items) {
      if (item.productCategory?.trim()) set.add(item.productCategory.trim());
    }
    return Array.from(set).sort((a, b) => a.localeCompare(b, "pt-BR"));
  }, [categories, sheet.items]);

  const startEditing = (item: ScannedProductItem) => {
    setEditingItemId(item.id);
    setShowInlineCategoryCreate(false);
    setInlineNewCategory("");
    const existingMargin = calculateMarginPercent(item.productUnitPrice, item.productSalePrice);
    setEditDraft({
      productName: item.productName,
      productSupplier: item.productSupplier,
      productCategory: item.productCategory || "Mercearia",
      productQnt: String(item.productQnt),
      productUnitPrice: item.productUnitPrice,
      productSalePrice: item.productSalePrice,
      packPrice: item.packPrice ?? "",
      packQuantity: item.packQuantity ? String(item.packQuantity) : "",
      marginPercent: existingMargin !== null && existingMargin > 0 ? String(Math.round(existingMargin)) : "35",
    });
  };

  const handleEditPackChange = (nextPackPrice: string, nextPackQty: string) => {
    const computed = calculateUnitCostFromPack(nextPackPrice, nextPackQty);
    setEditDraft((d) => {
      const nextCost = computed.formatted || d.productUnitPrice;
      const suggestedSale = computed.formatted
        ? calculateSalePriceFromMargin(nextCost, d.marginPercent).formatted
        : "";
      return {
        ...d,
        packPrice: nextPackPrice,
        packQuantity: nextPackQty,
        productUnitPrice: nextCost,
        ...(suggestedSale ? { productSalePrice: suggestedSale } : {}),
      };
    });
  };

  const handleEditMarginChange = (nextMargin: string) => {
    setEditDraft((d) => {
      const suggested = calculateSalePriceFromMargin(d.productUnitPrice, nextMargin);
      return {
        ...d,
        marginPercent: nextMargin,
        ...(suggested.formatted ? { productSalePrice: suggested.formatted } : {}),
      };
    });
  };

  const handleCreateInlineCategory = async () => {
    const trimmed = inlineNewCategory.trim();
    if (!trimmed) return;
    const created = await onCreateCategory(trimmed);
    if (created) {
      setEditDraft((d) => ({ ...d, productCategory: created }));
      setInlineNewCategory("");
      setShowInlineCategoryCreate(false);
    }
  };

  const saveEditing = async (itemId: string) => {
    const parsedQnt = Number.parseFloat(editDraft.productQnt.replace(",", "."));
    const parsedPackQty = Number.parseFloat(editDraft.packQuantity.replace(",", "."));
    await onUpdateItem(itemId, {
      productName: editDraft.productName,
      productSupplier: editDraft.productSupplier,
      productCategory: editDraft.productCategory,
      productQnt: Number.isFinite(parsedQnt) && parsedQnt >= 0 ? parsedQnt : 1,
      productUnitPrice: editDraft.productUnitPrice,
      productSalePrice: editDraft.productSalePrice,
      packPrice: editDraft.packPrice || undefined,
      packQuantity: Number.isFinite(parsedPackQty) && parsedPackQty > 0 ? parsedPackQty : undefined,
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
            <code>PrecoCusto</code>, <code>PrecoVenda</code> e <code>Categoria</code>.
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

      {/* Filtro rápido + Filtro de Categoria */}
      <div className="sheet-filter-row">
        <div className="sheet-search-bar">
          <Search size={16} className="search-icon" />
          <input
            id="input-search-sheet-items"
            type="search"
            placeholder="Filtrar por código EAN, nome, fornecedor ou celular..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="sheet-search-input"
          />
        </div>
        <select
          id="select-filter-sheet-category"
          value={selectedCategoryFilter}
          onChange={(e) => setSelectedCategoryFilter(e.target.value)}
          className="sheet-category-filter"
          aria-label="Filtrar itens por categoria"
        >
          <option value="ALL">Todas categorias</option>
          {sheetCategories.map((cat) => (
            <option key={cat} value={cat}>
              {cat}
            </option>
          ))}
        </select>
      </div>

      {/* Lista / Tabela responsiva de produtos capturados */}
      {filteredItems.length === 0 ? (
        <div className="empty-sheet-state">
          <FileSpreadsheet size={32} />
          <p>Nenhum produto contabilizado nesta planilha ainda.</p>
          <span>
            Aponte a câmera para o código de barras e a etiqueta de preço ou preencha quantidade,
            fardo e categoria ao lado.
          </span>
        </div>
      ) : (
        <div className="captured-items-list">
          {filteredItems.map((item) => {
            const isEditing = editingItemId === item.id;
            const margin = calculateMarginPercent(item.productUnitPrice, item.productSalePrice);
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
                        <div className="edit-supplier-cat-grid">
                          <input
                            type="text"
                            value={editDraft.productSupplier}
                            onChange={(e) =>
                              setEditDraft((d) => ({ ...d, productSupplier: e.target.value }))
                            }
                            placeholder="Fornecedor"
                            className="scanner-input"
                          />
                          <div className="edit-category-picker">
                            <select
                              value={editDraft.productCategory}
                              onChange={(e) =>
                                setEditDraft((d) => ({ ...d, productCategory: e.target.value }))
                              }
                              className="scanner-select"
                            >
                              {sheetCategories.map((cat) => (
                                <option key={cat} value={cat}>
                                  {cat}
                                </option>
                              ))}
                            </select>
                            <button
                              type="button"
                              onClick={() => setShowInlineCategoryCreate((v) => !v)}
                              className="action-icon-btn"
                              title="Criar nova categoria"
                            >
                              <FolderPlus size={15} />
                            </button>
                          </div>
                        </div>

                        {showInlineCategoryCreate ? (
                          <div className="inline-cat-row">
                            <input
                              type="text"
                              value={inlineNewCategory}
                              onChange={(e) => setInlineNewCategory(e.target.value)}
                              placeholder="Nova categoria..."
                              className="scanner-input"
                            />
                            <button
                              type="button"
                              onClick={handleCreateInlineCategory}
                              className="btn-create-category-confirm"
                            >
                              Criar
                            </button>
                          </div>
                        ) : null}
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

                {/* Linha inferior com Preço de Venda, Preço de Custo (e fardo na edição) e Ações */}
                <div className="item-card-bottom">
                  {isEditing ? (
                    <div className="edit-full-pricing-block">
                      <div className="item-pack-edit-grid">
                        <label>
                          <span>Fardo (R$)</span>
                          <input
                            type="text"
                            placeholder="Ex: 48,00"
                            value={editDraft.packPrice}
                            onChange={(e) =>
                              handleEditPackChange(e.target.value, editDraft.packQuantity)
                            }
                            className="scanner-input font-mono"
                          />
                        </label>
                        <label>
                          <span>Qtd Fardo</span>
                          <input
                            type="text"
                            placeholder="Ex: 12"
                            value={editDraft.packQuantity}
                            onChange={(e) =>
                              handleEditPackChange(editDraft.packPrice, e.target.value)
                            }
                            className="scanner-input font-mono"
                          />
                        </label>
                        <label>
                          <span>Margem (%)</span>
                          <input
                            type="text"
                            value={editDraft.marginPercent}
                            onChange={(e) => handleEditMarginChange(e.target.value)}
                            className="scanner-input font-mono"
                          />
                        </label>
                      </div>

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
                          <span>Custo Unit. (R$)</span>
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
                    </div>
                  ) : (
                    <div className="item-prices-group">
                      <div className="price-pill sale-price-pill">
                        <span className="price-label">Venda</span>
                        <strong>R$ {item.productSalePrice}</strong>
                      </div>
                      <div className="price-pill cost-price-pill">
                        <span className="price-label">Custo Unit.</span>
                        <strong>R$ {item.productUnitPrice}</strong>
                      </div>
                      {item.packPrice && item.packQuantity ? (
                        <div className="price-pill pack-info-pill">
                          <span>
                            Fardo R$ {item.packPrice} / {item.packQuantity}un
                          </span>
                        </div>
                      ) : null}
                      {margin !== null ? (
                        <div className="price-pill margin-info-pill">
                          <span>{margin > 0 ? `+${margin}%` : `${margin}%`}</span>
                        </div>
                      ) : null}
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
                          title="Editar preço, fardo, categoria ou fornecedor"
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
