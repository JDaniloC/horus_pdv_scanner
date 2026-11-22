/**
 * Arquivo: server/barcodeCatalogLookup.ts
 * Objetivo: Busca melhor-esforço de nome, marca, categoria, descrição, imagem e preço sugerido
 *           a partir de um código de barras (GTIN/EAN/UPC) em bases públicas (Open Food/Beauty/Products/PetFood Facts,
 *           Cosmos Bluesoft opcional via COSMOS_TOKEN e catálogo de produtos populares de mercadinho brasileiro).
 */

import type { BarcodeCatalogInfo } from "../src/types/scanner.ts";

interface CacheEntry {
  response: BarcodeCatalogInfo;
  expiresAt: number;
}

const cache = new Map<string, CacheEntry>();
const FOUND_TTL_MS = 30 * 60 * 1000;
const NOT_FOUND_TTL_MS = 5 * 60 * 1000;
const PER_SOURCE_TIMEOUT_MS = 3800;

const CATEGORY_TRANSLATIONS: Record<string, string> = {
  beverages: "Bebidas",
  "carbonated-drinks": "Bebidas",
  sodas: "Refrigerantes",
  waters: "Águas",
  juices: "Sucos",
  beers: "Cervejas",
  "alcoholic-beverages": "Bebidas Alcoólicas",
  dairies: "Laticínios",
  milks: "Laticínios",
  cheeses: "Queijos e Frios",
  yogurts: "Laticínios",
  snacks: "Salgadinhos e Snacks",
  "sweet-snacks": "Doces e Biscoitos",
  "biscuits-and-cakes": "Biscoitos e Bolos",
  chocolates: "Chocolates e Doces",
  candies: "Doces e Balas",
  "cereals-and-potatoes": "Mercearia",
  pasta: "Massas",
  breads: "Padaria",
  meats: "Carnes e Frios",
  "fruits-and-vegetables": "Hortifruti",
  "frozen-foods": "Congelados",
  condiments: "Temperos e Molhos",
  sauces: "Molhos e Condimentos",
  oils: "Óleos e Azeites",
  coffees: "Cafés e Chás",
  teas: "Cafés e Chás",
  "cleaning-products": "Limpeza",
  household: "Casa e Limpeza",
  "personal-care": "Higiene Pessoal",
  "hair-care": "Higiene Pessoal",
  shampoos: "Higiene Pessoal",
  soaps: "Higiene Pessoal",
  cosmetics: "Cosméticos",
  deodorants: "Higiene Pessoal",
  "oral-hygiene": "Higiene Bucal",
  "pet-food": "Pet Shop",
  "dog-food": "Pet Shop",
  "cat-food": "Pet Shop",
  electronics: "Eletrônicos",
  "office-supplies": "Papelaria",
};

/**
 * Catálogo embarcado de itens clássicos de mercadinho brasileiro para resposta instantânea
 * e funcionamento offline/demonstração imediata.
 */
const BUILTIN_BRAZILIAN_MARKET_CATALOG: Record<string, Omit<BarcodeCatalogInfo, "barcode" | "found">> = {
  "7891000100103": {
    source: "Catálogo Mercadinho BR",
    productName: "Arroz Agulhinha Tipo 1 Camil 5kg",
    brand: "Camil",
    productCategory: "Mercearia",
    productDescription: "Arroz polido longo fino tipo 1 · Marca: Camil · Conteúdo: 5kg",
    productImageUrl: "",
    suggestedUnitType: "UN",
    suggestedSalePrice: 27.9,
  },
  "7891000200205": {
    source: "Catálogo Mercadinho BR",
    productName: "Feijão Carioca Tipo 1 Kicaldo 1kg",
    brand: "Kicaldo",
    productCategory: "Mercearia",
    productDescription: "Feijão carioca tipo 1 pacote · Marca: Kicaldo · Conteúdo: 1kg",
    productImageUrl: "",
    suggestedUnitType: "UN",
    suggestedSalePrice: 8.9,
  },
  "7894900011517": {
    source: "Catálogo Mercadinho BR",
    productName: "Refrigerante Coca-Cola Original Lata 350ml",
    brand: "Coca-Cola",
    productCategory: "Refrigerantes",
    productDescription: "Refrigerante de cola tradicional · Marca: Coca-Cola · Conteúdo: 350ml",
    productImageUrl: "",
    suggestedUnitType: "UN",
    suggestedSalePrice: 4.99,
  },
  "7894900027013": {
    source: "Catálogo Mercadinho BR",
    productName: "Refrigerante Coca-Cola Original PET 2L",
    brand: "Coca-Cola",
    productCategory: "Refrigerantes",
    productDescription: "Refrigerante de cola garrafa PET · Marca: Coca-Cola · Conteúdo: 2L",
    productImageUrl: "",
    suggestedUnitType: "UN",
    suggestedSalePrice: 11.49,
  },
  "7891991010856": {
    source: "Catálogo Mercadinho BR",
    productName: "Cerveja Pilsen Skol Lata 350ml",
    brand: "Skol",
    productCategory: "Cervejas",
    productDescription: "Cerveja clara pilsen lata · Marca: Skol · Conteúdo: 350ml",
    productImageUrl: "",
    suggestedUnitType: "UN",
    suggestedSalePrice: 4.29,
  },
  "7891000053508": {
    source: "Catálogo Mercadinho BR",
    productName: "Leite Condensado Moça Nestlé 395g",
    brand: "Nestlé",
    productCategory: "Doces e Biscoitos",
    productDescription: "Leite condensado integral tradicional · Marca: Nestlé · Conteúdo: 395g",
    productImageUrl: "",
    suggestedUnitType: "UN",
    suggestedSalePrice: 7.49,
  },
  "7891000142202": {
    source: "Catálogo Mercadinho BR",
    productName: "Achocolatado em Pó Nescau 2.0 Lata 370g",
    brand: "Nestlé",
    productCategory: "Matinais e Achocolatados",
    productDescription: "Achocolatado em pó vitaminado · Marca: Nestlé · Conteúdo: 370g",
    productImageUrl: "",
    suggestedUnitType: "UN",
    suggestedSalePrice: 9.8,
  },
  "7896004006277": {
    source: "Catálogo Mercadinho BR",
    productName: "Óleo de Soja Liza PET 900ml",
    brand: "Liza",
    productCategory: "Óleos e Azeites",
    productDescription: "Óleo de soja refinado tipo 1 · Marca: Liza · Conteúdo: 900ml",
    productImageUrl: "",
    suggestedUnitType: "UN",
    suggestedSalePrice: 7.29,
  },
  "7896089011357": {
    source: "Catálogo Mercadinho BR",
    productName: "Café Torrado e Moído Pilão Tradicional 500g",
    brand: "Pilão",
    productCategory: "Cafés e Chás",
    productDescription: "Café torrado e moído intensidade 8 · Marca: Pilão · Conteúdo: 500g",
    productImageUrl: "",
    suggestedUnitType: "UN",
    suggestedSalePrice: 19.9,
  },
  "7891150054349": {
    source: "Catálogo Mercadinho BR",
    productName: "Lava-Roupas em Pó Omo Lavagem Perfeita 800g",
    brand: "Omo",
    productCategory: "Limpeza",
    productDescription: "Detergente em pó para lavar roupas · Marca: Omo · Conteúdo: 800g",
    productImageUrl: "",
    suggestedUnitType: "UN",
    suggestedSalePrice: 13.9,
  },
  "7896098900208": {
    source: "Catálogo Mercadinho BR",
    productName: "Detergente Líquido Neutro Ypê 500ml",
    brand: "Ypê",
    productCategory: "Limpeza",
    productDescription: "Lava-louças líquido neutro concentrado · Marca: Ypê · Conteúdo: 500ml",
    productImageUrl: "",
    suggestedUnitType: "UN",
    suggestedSalePrice: 2.79,
  },
  "7896213004088": {
    source: "Catálogo Mercadinho BR",
    productName: "Leite UHT Integral Italac 1L",
    brand: "Italac",
    productCategory: "Laticínios",
    productDescription: "Leite longa vida UHT integral · Marca: Italac · Conteúdo: 1L",
    productImageUrl: "",
    suggestedUnitType: "UN",
    suggestedSalePrice: 5.49,
  },
  "7891962051345": {
    source: "Catálogo Mercadinho BR",
    productName: "Biscoito Recheado Chocolate Bauducco 140g",
    brand: "Bauducco",
    productCategory: "Doces e Biscoitos",
    productDescription: "Biscoito recheado sabor chocolate · Marca: Bauducco · Conteúdo: 140g",
    productImageUrl: "",
    suggestedUnitType: "UN",
    suggestedSalePrice: 3.49,
  },
};

export function normalizeBarcode(raw: string | undefined | null): string {
  return String(raw ?? "").replace(/\D/g, "");
}

function isComplete(info: BarcodeCatalogInfo): boolean {
  return Boolean(info.productName && info.productCategory);
}

function mergeInto(target: BarcodeCatalogInfo, candidate: BarcodeCatalogInfo | null): void {
  if (!candidate || !candidate.found) return;

  if (!target.source && candidate.source) {
    target.source = candidate.source;
  } else if (
    candidate.source &&
    !target.source.toLowerCase().includes(candidate.source.toLowerCase()) &&
    !target.productImageUrl &&
    candidate.productImageUrl
  ) {
    target.source = `${target.source} + ${candidate.source}`;
  }

  if (!target.productName && candidate.productName) target.productName = candidate.productName;
  if (!target.brand && candidate.brand) target.brand = candidate.brand;
  if (!target.productCategory && candidate.productCategory) {
    target.productCategory = candidate.productCategory;
  }
  if (!target.productDescription && candidate.productDescription) {
    target.productDescription = candidate.productDescription;
  }
  if (!target.productImageUrl && candidate.productImageUrl) {
    target.productImageUrl = candidate.productImageUrl;
  }
  if (target.suggestedSalePrice === null && candidate.suggestedSalePrice && candidate.suggestedSalePrice > 0) {
    target.suggestedSalePrice = candidate.suggestedSalePrice;
  }
  if (target.suggestedUnitType === "UN" && candidate.suggestedUnitType === "KG") {
    target.suggestedUnitType = "KG";
  }
}

function composeProductName(rawName: string, brand: string, quantity: string): string {
  let name = rawName.trim();
  if (!name) {
    name = brand.trim();
  } else if (brand.trim() && !name.toLowerCase().includes(brand.trim().toLowerCase())) {
    name = `${name} ${brand.trim()}`;
  }

  const normalizedQty = quantity.trim();
  if (name && normalizedQty && !name.toLowerCase().includes(normalizedQty.toLowerCase())) {
    name = `${name} ${normalizedQty}`;
  }

  return name.trim().slice(0, 180);
}

function buildDescription(brand: string, quantity: string, generic: string): string {
  const parts: string[] = [];
  if (generic.trim()) parts.push(generic.trim());
  if (brand.trim()) parts.push(`Marca: ${brand.trim()}`);
  if (quantity.trim()) parts.push(`Conteúdo: ${quantity.trim()}`);
  return parts.join(" · ").slice(0, 500);
}

function normalizeCategory(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) return "";
  const slug = trimmed.toLowerCase().replace(/\s+/g, "-");
  if (CATEGORY_TRANSLATIONS[slug]) {
    return CATEGORY_TRANSLATIONS[slug];
  }
  return (trimmed.charAt(0).toUpperCase() + trimmed.slice(1)).slice(0, 100);
}

function extractOpenFactsCategory(product: Record<string, unknown>): string {
  const hierarchy = Array.isArray(product.categories_hierarchy)
    ? (product.categories_hierarchy as unknown[]).map((item) => String(item ?? "").trim()).filter(Boolean)
    : [];

  for (let i = hierarchy.length - 1; i >= 0; i--) {
    const tag = hierarchy[i];
    if (tag.toLowerCase().startsWith("pt:")) {
      return normalizeCategory(tag.slice(3).replace(/-/g, " "));
    }
  }

  for (let i = hierarchy.length - 1; i >= 0; i--) {
    const tag = hierarchy[i];
    const slug = tag.includes(":") ? tag.slice(tag.indexOf(":") + 1) : tag;
    if (CATEGORY_TRANSLATIONS[slug.toLowerCase()]) {
      return CATEGORY_TRANSLATIONS[slug.toLowerCase()];
    }
  }

  const categoriesText = String(product.categories ?? "").trim();
  if (!categoriesText) return "";

  const firstReadable = categoriesText
    .split(",")
    .map((item) => item.trim())
    .map((item) => (item.includes(":") ? item.slice(item.indexOf(":") + 1) : item))
    .find(Boolean);

  return normalizeCategory(firstReadable ?? "");
}

async function fetchJsonWithTimeout(
  url: string,
  headers: Record<string, string> = {},
): Promise<Record<string, unknown> | null> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), PER_SOURCE_TIMEOUT_MS);
  try {
    const response = await fetch(url, {
      headers: {
        "User-Agent": "HorusPDVScanner/1.0 (https://github.com/JDaniloC/horus_pdv_scanner)",
        Accept: "application/json",
        ...headers,
      },
      signal: controller.signal,
    });
    if (!response.ok) return null;
    const data = (await response.json()) as Record<string, unknown>;
    return data;
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

async function tryLookupOpenFacts(
  baseUrl: string,
  sourceName: string,
  barcode: string,
): Promise<BarcodeCatalogInfo | null> {
  const url = `${baseUrl}/api/v2/product/${barcode}.json?fields=product_name,product_name_pt,generic_name,generic_name_pt,brands,quantity,categories,categories_hierarchy,image_front_url,image_url,image_front_small_url`;
  const json = await fetchJsonWithTimeout(url);
  if (!json || Number(json.status) !== 1 || typeof json.product !== "object" || !json.product) {
    return null;
  }

  const product = json.product as Record<string, unknown>;
  const rawName =
    String(product.product_name_pt ?? "").trim() ||
    String(product.product_name ?? "").trim() ||
    String(product.generic_name_pt ?? "").trim() ||
    String(product.generic_name ?? "").trim();
  const rawBrands = String(product.brands ?? "").trim();
  const brand = rawBrands.split(",")[0]?.trim() ?? "";
  const quantity = String(product.quantity ?? "").trim();
  const generic =
    String(product.generic_name_pt ?? "").trim() || String(product.generic_name ?? "").trim();
  const imageUrl =
    String(product.image_front_url ?? "").trim() ||
    String(product.image_url ?? "").trim() ||
    String(product.image_front_small_url ?? "").trim();
  const category = extractOpenFactsCategory(product);
  const composedName = composeProductName(rawName, brand, quantity);

  if (!composedName && !imageUrl) return null;

  return {
    barcode,
    found: true,
    source: sourceName,
    productName: composedName,
    brand: brand.slice(0, 80),
    productCategory: category || "Mercearia",
    productDescription: buildDescription(brand, quantity, generic) || composedName,
    productImageUrl: imageUrl.startsWith("http") ? imageUrl : "",
    suggestedUnitType: "UN",
    suggestedSalePrice: null,
  };
}

async function tryLookupCosmos(barcode: string, token: string): Promise<BarcodeCatalogInfo | null> {
  const json = await fetchJsonWithTimeout(`https://api.cosmos.bluesoft.com.br/gtins/${barcode}.json`, {
    "X-Cosmos-Token": token,
  });
  if (!json) return null;

  const description = String(json.description ?? "").trim();
  const brandObj = json.brand as Record<string, unknown> | undefined;
  const brand = String(brandObj?.name ?? "").trim();
  const gpcObj = json.gpc as Record<string, unknown> | undefined;
  const ncmObj = json.ncm as Record<string, unknown> | undefined;
  const category = String(gpcObj?.description ?? ncmObj?.description ?? "").trim();
  const imageUrl = String(json.thumbnail ?? "").trim();
  const avgPrice = Number(json.avg_price ?? 0);

  if (!description && !imageUrl) return null;

  return {
    barcode,
    found: true,
    source: "Cosmos Bluesoft",
    productName: description.slice(0, 180),
    brand: brand.slice(0, 80),
    productCategory: normalizeCategory(category) || "Mercearia",
    productDescription: buildDescription(brand, "", String(ncmObj?.description ?? "")) || description,
    productImageUrl: imageUrl.startsWith("http") ? imageUrl : "",
    suggestedUnitType: "UN",
    suggestedSalePrice: avgPrice > 0 ? Math.round(avgPrice * 100) / 100 : null,
  };
}

async function tryLookupUpcItemDb(barcode: string): Promise<BarcodeCatalogInfo | null> {
  const json = await fetchJsonWithTimeout(
    `https://api.upcitemdb.com/prod/trial/lookup?upc=${encodeURIComponent(barcode)}`,
  );
  if (!json || !Array.isArray(json.items) || json.items.length === 0) return null;

  const item = json.items[0] as Record<string, unknown>;
  const title = String(item.title ?? "").trim();
  const brand = String(item.brand ?? "").trim();
  const description = String(item.description ?? "").trim();
  const rawCategory = String(item.category ?? "").trim();
  const images = Array.isArray(item.images) ? (item.images as unknown[]) : [];
  const firstImage = String(images[0] ?? "").trim();

  if (!title && !firstImage) return null;

  const cleanCategory = rawCategory.includes(">")
    ? (rawCategory.split(">").pop()?.trim() ?? "")
    : rawCategory;

  return {
    barcode,
    found: true,
    source: "UPCitemdb",
    productName: composeProductName(title, brand, ""),
    brand: brand.slice(0, 80),
    productCategory: normalizeCategory(cleanCategory) || "Mercearia",
    productDescription: (description || buildDescription(brand, "", "") || title).slice(0, 500),
    productImageUrl: firstImage.startsWith("http") ? firstImage : "",
    suggestedUnitType: "UN",
    suggestedSalePrice: null,
  };
}

export async function lookupBarcodeCatalog(rawBarcode: string): Promise<BarcodeCatalogInfo> {
  const normalized = normalizeBarcode(rawBarcode);
  if (normalized.length < 8 || normalized.length > 14) {
    return {
      barcode: normalized || rawBarcode,
      found: false,
      source: "",
      productName: "",
      brand: "",
      productCategory: "",
      productDescription: "",
      productImageUrl: "",
      suggestedUnitType: "UN",
      suggestedSalePrice: null,
    };
  }

  const now = Date.now();
  const cached = cache.get(normalized);
  if (cached && cached.expiresAt > now) {
    return cached.response;
  }

  const merged: BarcodeCatalogInfo = {
    barcode: normalized,
    found: false,
    source: "",
    productName: "",
    brand: "",
    productCategory: "",
    productDescription: "",
    productImageUrl: "",
    suggestedUnitType: "UN",
    suggestedSalePrice: null,
  };

  // 0. Verifica catálogo brasileiro embarcado para resposta instantânea
  const builtin = BUILTIN_BRAZILIAN_MARKET_CATALOG[normalized];
  if (builtin) {
    mergeInto(merged, {
      barcode: normalized,
      found: true,
      ...builtin,
    });
  }

  // 1. Cosmos Bluesoft (se COSMOS_TOKEN configurado no ambiente)
  const cosmosToken = process.env.COSMOS_TOKEN?.trim();
  if (cosmosToken && !isComplete(merged)) {
    const cosmos = await tryLookupCosmos(normalized, cosmosToken);
    mergeInto(merged, cosmos);
  }

  // 2. Open Food Facts Brasil
  if (!isComplete(merged)) {
    const off = await tryLookupOpenFacts("https://br.openfoodfacts.org", "Open Food Facts BR", normalized);
    mergeInto(merged, off);
  }

  // 3. Bases complementares em paralelo (higiene, beleza, limpeza, pet e UPC)
  if (!isComplete(merged)) {
    const results = await Promise.all([
      tryLookupOpenFacts("https://world.openbeautyfacts.org", "Open Beauty Facts", normalized),
      tryLookupOpenFacts("https://world.openproductsfacts.org", "Open Products Facts", normalized),
      tryLookupOpenFacts("https://world.openpetfoodfacts.org", "Open Pet Food Facts", normalized),
      tryLookupUpcItemDb(normalized),
    ]);
    for (const candidate of results) {
      mergeInto(merged, candidate);
      if (isComplete(merged)) break;
    }
  }

  // 4. Suporte a etiqueta de balança EAN-13 (prefixo 2) do Horus PDV
  if (!merged.found && normalized.length === 13 && normalized.startsWith("2")) {
    const internalCode = normalized.slice(1, 6);
    const rawValueCents = Number(normalized.slice(6, 12));
    const suggestedPrice = rawValueCents > 0 ? Math.round(rawValueCents) / 100 : null;
    merged.found = true;
    merged.source = "Etiqueta de Balança EAN-13";
    merged.productName = `Produto Pesável Balança #${internalCode}`;
    merged.productCategory = "Hortifruti / Açougue / Padaria";
    merged.productDescription = `Etiqueta de balança detectada (código interno ${internalCode})`;
    merged.suggestedUnitType = "KG";
    merged.suggestedSalePrice = suggestedPrice;
  }

  merged.found = Boolean(merged.productName || merged.productImageUrl);

  cache.set(normalized, {
    response: merged,
    expiresAt: now + (merged.found ? FOUND_TTL_MS : NOT_FOUND_TTL_MS),
  });

  return merged;
}

export function getBuiltinCatalogSamples(): Array<{ barcode: string } & Omit<BarcodeCatalogInfo, "barcode" | "found">> {
  return Object.entries(BUILTIN_BRAZILIAN_MARKET_CATALOG).map(([barcode, info]) => ({
    barcode,
    ...info,
  }));
}
