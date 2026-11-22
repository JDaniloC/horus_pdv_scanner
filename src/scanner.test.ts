import { describe, expect, it } from "vitest";
import { extractPricesFromOcrText } from "../src/utils/priceExtractor";
import {
  calculateMarginPercent,
  calculateSalePriceFromMargin,
  calculateUnitCostFromPack,
} from "../src/utils/packPricing";
import { SheetStore, parseMoneyPtBr, formatMoneyPtBr } from "../server/sheetStore";

describe("Extrator OCR de Preços de Gôndola (pt-BR)", () => {
  it("extrai preços com prefixo R$, POR e OFERTA com alta confiança", () => {
    const rawOcr = "ARROZ TIPO 1 5KG\nOFERTA R$ 27,90 UNID\nCOD 7891000100103";
    const candidates = extractPricesFromOcrText(rawOcr);
    expect(candidates.length).toBeGreaterThan(0);
    expect(candidates[0]?.formatted).toBe("27,90");
    expect(candidates[0]?.numeric).toBe(27.9);
  });

  it("corrige erros comuns de OCR como RS ou R5 antes do valor", () => {
    const rawOcr = "FEIJAO CARIOCA 1KG RS 8,90";
    const candidates = extractPricesFromOcrText(rawOcr);
    expect(candidates[0]?.formatted).toBe("8,90");
  });

  it("ignora pesos/volumes (ex: 1,50kg) e captura o preço real da etiqueta", () => {
    const rawOcr = "REFRIGERANTE 2,00L POR 11,49";
    const candidates = extractPricesFromOcrText(rawOcr);
    expect(candidates[0]?.formatted).toBe("11,49");
  });
});

describe("Cálculo de Fardo (Custo Unitário e Margem de Venda)", () => {
  it("deduz o preço de custo unitário a partir do preço do fardo e quantidade no fardo", () => {
    const unitCost = calculateUnitCostFromPack("42,00", "12");
    expect(unitCost.numeric).toBe(3.5);
    expect(unitCost.formatted).toBe("3,50");

    const suggestedSale = calculateSalePriceFromMargin(unitCost.formatted, "40");
    expect(suggestedSale.numeric).toBe(4.9);
    expect(suggestedSale.formatted).toBe("4,90");

    expect(calculateMarginPercent("3,50", "4,90")).toBe(40);
  });
});

describe("Contabilização ao Vivo e Unificação Multi-Celulares (SheetStore)", () => {
  it("formata e converte valores monetários brasileiros corretamente", () => {
    expect(parseMoneyPtBr("R$ 19,90")).toBe(19.9);
    expect(formatMoneyPtBr(19.9)).toBe("19,90");
  });

  it("incrementa a quantidade (+1) e atualiza o preço quando o mesmo código é lido novamente", async () => {
    const store = new SheetStore({ persistToDisk: false });
    const sheet = store.createSheet({
      name: "Teste Corredor Bebidas",
      aisleOrSector: "Bebidas",
      defaultSupplier: "Ambev",
    });

    const scan1 = await store.recordLiveScan({
      sheetId: sheet.id,
      productCode: "7894900011517",
      detectedSalePrice: "4,99",
      deviceId: "cel-1",
      deviceName: "Celular 01",
    });

    expect(scan1.action).toBe("created");
    expect(scan1.item.productQnt).toBe(1);
    expect(scan1.item.productSalePrice).toBe("4,99");
    expect(scan1.item.productName).toContain("Coca-Cola");

    const scan2 = await store.recordLiveScan({
      sheetId: sheet.id,
      productCode: "7894900011517",
      detectedSalePrice: "5,29",
      deviceId: "cel-2",
      deviceName: "Celular 02",
    });

    expect(scan2.action).toBe("updated_price");
    expect(scan2.item.productQnt).toBe(2);
    expect(scan2.item.productSalePrice).toBe("5,29");
    expect(scan2.priceChanged).toBe(true);
  });

  it("cria categorias na hora e deduz custo unitário pelo fardo diretamente na captura", async () => {
    const store = new SheetStore({ persistToDisk: false });
    const createdCat = store.createCategory("Bomboniere");
    expect(createdCat.category).toBe("Bomboniere");
    expect(store.listCategories()).toContain("Bomboniere");

    const sheet = store.createSheet({ name: "Teste Fardo & Categoria" });
    const scan = await store.recordLiveScan({
      sheetId: sheet.id,
      productCode: "7891962051345",
      packPrice: "48,00",
      packQuantity: 16,
      detectedSalePrice: "4,50",
      quantityDelta: 16,
      productCategory: "Bomboniere",
      deviceId: "cel-1",
      deviceName: "Celular Caixa",
    });

    expect(scan.item.productUnitPrice).toBe("3,00");
    expect(scan.item.productSalePrice).toBe("4,50");
    expect(scan.item.productQnt).toBe(16);
    expect(scan.item.productCategory).toBe("Bomboniere");
    expect(scan.item.packPrice).toBe("48,00");
    expect(scan.item.packQuantity).toBe(16);
  });

  it("junta planilhas diferentes de múltiplos celulares somando quantidades do mesmo código de barras", async () => {
    const store = new SheetStore({ persistToDisk: false });
    const sheetA = store.createSheet({ name: "Celular A - Frente Loja" });
    const sheetB = store.createSheet({ name: "Celular B - Estoque Fundo" });

    await store.recordLiveScan({
      sheetId: sheetA.id,
      productCode: "7891000142202",
      detectedSalePrice: "9,80",
      quantityDelta: 3,
      deviceId: "cel-a",
      deviceName: "Celular A",
    });

    await store.recordLiveScan({
      sheetId: sheetB.id,
      productCode: "7891000142202",
      detectedSalePrice: "9,90",
      quantityDelta: 5,
      deviceId: "cel-b",
      deviceName: "Celular B",
    });

    const merged = store.mergeSheets({
      sourceSheetIds: [sheetA.id, sheetB.id],
      targetMode: "virtual_preview",
      priceStrategy: "highest",
      sumQuantities: true,
    });

    const nescau = merged.mergedItems.find((i) => i.productCode === "7891000142202");
    expect(nescau).toBeDefined();
    expect(nescau?.productQnt).toBe(8);
    expect(nescau?.productSalePrice).toBe("9,90");
    expect(merged.stats.conflictsResolved).toBe(1);
  });
});

import {
  addDaysIsoDate,
  formatExpirationPtBr,
  normalizeExpirationDate,
} from "../src/utils/expirationDate";

describe("Data de Vencimento (Nulo, +30 dias e Data Específica)", () => {
  it("calcula +30 dias, aceita nulo e formata corretamente para pt-BR", () => {
    const base = new Date(2026, 10, 22); // 22/11/2026
    const plus30 = addDaysIsoDate(30, base);
    expect(plus30).toBe("2026-12-22");
    expect(formatExpirationPtBr(plus30)).toBe("22/12/2026");

    expect(normalizeExpirationDate(null, base)).toBeNull();
    expect(normalizeExpirationDate("", base)).toBeNull();
    expect(normalizeExpirationDate("30_days", base)).toBe("2026-12-22");
    expect(normalizeExpirationDate("15/01/2027", base)).toBe("2027-01-15");
  });

  it("salva e atualiza data de vencimento (+30 dias ou nulo) no SheetStore", async () => {
    const store = new SheetStore({ persistToDisk: false });
    const sheet = store.createSheet({ name: "Teste Vencimento" });

    const scanWithExp = await store.recordLiveScan({
      sheetId: sheet.id,
      productCode: "7896213004088",
      detectedSalePrice: "5,49",
      expirationDate: "30_days",
      deviceId: "cel-1",
      deviceName: "Celular 01",
    });

    expect(scanWithExp.item.expirationDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);

    const updatedNull = store.updateItem(sheet.id, scanWithExp.item.id, {
      expirationDate: null,
    });
    expect(updatedNull?.item.expirationDate).toBeNull();
  });
});

import { searchProductsOnInternet } from "../server/barcodeCatalogLookup";

describe("Pesquisa de Produto na Internet pelo Nome", () => {
  it("encontra produtos pelo nome e retorna código de barras, categoria e descrição", async () => {
    const results = await searchProductsOnInternet("Coca-Cola");
    expect(results.length).toBeGreaterThan(0);
    expect(results[0]?.productName.toLowerCase()).toContain("coca");
    expect(results[0]?.barcode.length).toBeGreaterThanOrEqual(8);
  });
});
