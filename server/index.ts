/**
 * Arquivo: server/index.ts
 * Objetivo: Servidor HTTP + WebSocket em tempo real para sincronizar capturas de câmera
 *           de múltiplos celulares simultaneamente e gerenciar planilhas para o Horus PDV.
 */

import http from "node:http";
import path from "node:path";
import fs from "node:fs";
import express from "express";
import cors from "cors";
import { WebSocketServer, WebSocket } from "ws";
import { sheetStore } from "./sheetStore.ts";
import {
  getBuiltinCatalogSamples,
  lookupBarcodeCatalog,
  searchProductsOnInternet,
} from "./barcodeCatalogLookup.ts";
import type {
  LiveScanPayload,
  MergeSheetsRequest,
  WsEventMessage,
} from "../src/types/scanner.ts";

const PORT = Number(process.env.PORT ?? 4175);
const app = express();

app.use(cors());
app.use(express.json({ limit: "5mb" }));

const server = http.createServer(app);
const wss = new WebSocketServer({ server, path: "/ws" });

const socketDeviceMap = new Map<WebSocket, string>();

function broadcastEvent(type: WsEventMessage["type"], payload: unknown): void {
  const message: WsEventMessage = {
    type,
    payload,
    timestamp: new Date().toISOString(),
  };
  const encoded = JSON.stringify(message);
  for (const client of wss.clients) {
    if (client.readyState === WebSocket.OPEN) {
      client.send(encoded);
    }
  }
}

wss.on("connection", (ws) => {
  // Envia sincronização imediata ao conectar um novo celular
  const initialSync: WsEventMessage = {
    type: "STATE_SYNC",
    payload: {
      sheets: sheetStore.listSheets(),
      devices: sheetStore.listDevices(),
      categories: sheetStore.listCategories(),
    },
    timestamp: new Date().toISOString(),
  };
  ws.send(JSON.stringify(initialSync));

  ws.on("message", (raw) => {
    try {
      const msg = JSON.parse(String(raw)) as {
        type: string;
        payload?: Record<string, unknown>;
      };

      if (msg.type === "DEVICE_HEARTBEAT" && msg.payload) {
        const deviceId = String(msg.payload.deviceId ?? "");
        const deviceName = String(msg.payload.deviceName ?? "Celular Operador");
        const sheetId = String(msg.payload.sheetId ?? "");
        const isCameraActive = Boolean(msg.payload.isCameraActive);

        if (deviceId) {
          socketDeviceMap.set(ws, deviceId);
          const devices = sheetStore.upsertDevice({
            deviceId,
            deviceName,
            sheetId,
            isCameraActive,
          });
          broadcastEvent("DEVICES_UPDATED", {
            devices,
            sheets: sheetStore.listSheets(),
          });
        }
      }
    } catch {
      // Ignora pacotes malformados
    }
  });

  ws.on("close", () => {
    const deviceId = socketDeviceMap.get(ws);
    socketDeviceMap.delete(ws);
    if (deviceId) {
      const devices = sheetStore.removeDevice(deviceId);
      broadcastEvent("DEVICES_UPDATED", {
        devices,
        sheets: sheetStore.listSheets(),
      });
    }
  });
});

// Health check
app.get("/api/health", (_req, res) => {
  res.json({
    status: "ok",
    service: "horus-pdv-scanner-server",
    sheetsCount: sheetStore.listSheets().length,
    categoriesCount: sheetStore.listCategories().length,
    connectedDevices: sheetStore.listDevices().length,
    timestamp: new Date().toISOString(),
  });
});

// Lista categorias disponíveis (padrão + criadas pelos celulares)
app.get("/api/categories", (_req, res) => {
  res.json({
    categories: sheetStore.listCategories(),
  });
});

// Cria uma nova categoria instantaneamente e sincroniza com todos os celulares
app.post("/api/categories", (req, res) => {
  try {
    const { name } = req.body as { name?: string };
    const result = sheetStore.createCategory(name ?? "");
    broadcastEvent("CATEGORIES_UPDATED", {
      categories: result.categories,
      createdCategory: result.category,
    });
    res.status(201).json(result);
  } catch (error) {
    res.status(400).json({
      message: error instanceof Error ? error.message : "Erro ao criar categoria.",
    });
  }
});

// Amostras do catálogo brasileiro embarcado para testes rápidos e demonstração
app.get("/api/catalog/samples", (_req, res) => {
  res.json({
    samples: getBuiltinCatalogSamples(),
  });
});

// Pesquisa produtos na internet pelo nome/marca para pré-preenchimento automático
app.get("/api/catalog/search", async (req, res) => {
  try {
    const q = String(req.query.q ?? "").trim();
    if (q.length < 2) {
      res.json({ results: [] });
      return;
    }
    const results = await searchProductsOnInternet(q);
    res.json({ results });
  } catch (error) {
    res.status(500).json({
      message: error instanceof Error ? error.message : "Erro ao pesquisar produtos na internet.",
    });
  }
});

// Consulta pública de código de barras (EAN/GTIN/UPC)
app.get("/api/barcode/:code", async (req, res) => {
  try {
    const info = await lookupBarcodeCatalog(req.params.code);
    res.json(info);
  } catch (error) {
    res.status(500).json({
      message: error instanceof Error ? error.message : "Erro ao consultar catálogo de barras.",
    });
  }
});

// Lista todas as planilhas/sessões ativas
app.get("/api/sheets", (_req, res) => {
  res.json({
    sheets: sheetStore.listSheets(),
    devices: sheetStore.listDevices(),
  });
});

// Obtém uma planilha específica (por ID ou código curto ex: MERC-101) com seus itens
app.get("/api/sheets/:idOrCode", (req, res) => {
  const sheet = sheetStore.getSheet(req.params.idOrCode);
  if (!sheet) {
    res.status(404).json({ message: "Planilha não encontrada." });
    return;
  }
  res.json({
    sheet,
    devices: sheetStore.listDevices(),
  });
});

// Cria uma nova planilha/sessão de coleta
app.post("/api/sheets", (req, res) => {
  const { name, aisleOrSector, defaultSupplier } = req.body as {
    name?: string;
    aisleOrSector?: string;
    defaultSupplier?: string;
  };
  if (!name || !name.trim()) {
    res.status(400).json({ message: "Informe o nome da planilha ou corredor." });
    return;
  }
  const created = sheetStore.createSheet({
    name,
    aisleOrSector,
    defaultSupplier,
  });
  broadcastEvent("SHEET_CREATED", {
    sheet: created,
    sheets: sheetStore.listSheets(),
  });
  res.status(201).json({ sheet: created });
});

// Exclui uma planilha
app.delete("/api/sheets/:sheetId", (req, res) => {
  const deleted = sheetStore.deleteSheet(req.params.sheetId);
  if (!deleted) {
    res.status(400).json({
      message: "Não foi possível excluir esta planilha (mantenha ao menos uma planilha ativa).",
    });
    return;
  }
  broadcastEvent("SHEET_DELETED", {
    sheetId: req.params.sheetId,
    sheets: sheetStore.listSheets(),
  });
  res.json({ deleted: true, sheets: sheetStore.listSheets() });
});

// Registra uma captura ao vivo da câmera (código de barras + preço detectado por OCR + enriquecimento automático)
app.post("/api/scans", async (req, res) => {
  try {
    const payload = req.body as LiveScanPayload;
    if (!payload?.productCode) {
      res.status(400).json({ message: "O código de barras (productCode) é obrigatório." });
      return;
    }

    const result = await sheetStore.recordLiveScan({
      ...payload,
      deviceId: payload.deviceId || "mobile-anon",
      deviceName: payload.deviceName || "Celular Operador",
    });

    broadcastEvent("ITEM_CAPTURED", {
      ...result,
      sheetId: result.sheet.id,
      deviceId: payload.deviceId,
      deviceName: payload.deviceName,
      sheets: sheetStore.listSheets(),
      devices: sheetStore.listDevices(),
      categories: sheetStore.listCategories(),
    });

    res.status(result.action === "created" ? 201 : 200).json(result);
  } catch (error) {
    res.status(400).json({
      message: error instanceof Error ? error.message : "Falha ao processar leitura da câmera.",
    });
  }
});

// Atualiza manualmente um item capturado (ex: ajuste fino de preço, nome ou quantidade)
app.patch("/api/sheets/:sheetId/items/:itemId", (req, res) => {
  const updated = sheetStore.updateItem(req.params.sheetId, req.params.itemId, req.body);
  if (!updated) {
    res.status(404).json({ message: "Item ou planilha não encontrada." });
    return;
  }
  broadcastEvent("ITEM_UPDATED", {
    sheetId: req.params.sheetId,
    item: updated.item,
    sheet: updated.sheet,
    sheets: sheetStore.listSheets(),
    categories: sheetStore.listCategories(),
  });
  res.json(updated);
});

// Remove um item de uma planilha
app.delete("/api/sheets/:sheetId/items/:itemId", (req, res) => {
  const summary = sheetStore.deleteItem(req.params.sheetId, req.params.itemId);
  if (!summary) {
    res.status(404).json({ message: "Item ou planilha não encontrada." });
    return;
  }
  broadcastEvent("ITEM_DELETED", {
    sheetId: req.params.sheetId,
    itemId: req.params.itemId,
    sheet: summary,
    sheets: sheetStore.listSheets(),
  });
  res.json({ deleted: true, sheet: summary });
});

// Junta/unifica múltiplas planilhas de diversos celulares em uma só
app.post("/api/sheets/merge", (req, res) => {
  try {
    const request = req.body as MergeSheetsRequest;
    const result = sheetStore.mergeSheets(request);

    if (result.targetSheet) {
      broadcastEvent("SHEETS_MERGED", {
        targetSheet: result.targetSheet,
        stats: result.stats,
        sheets: sheetStore.listSheets(),
      });
    }

    res.json(result);
  } catch (error) {
    res.status(400).json({
      message: error instanceof Error ? error.message : "Erro ao unificar planilhas.",
    });
  }
});

// Serve frontend compilado em produção se a pasta dist existir
const distPath = path.resolve(process.cwd(), "dist");
if (fs.existsSync(distPath)) {
  app.use(express.static(distPath));
  app.get("*", (req, res, next) => {
    if (req.path.startsWith("/api") || req.path.startsWith("/ws")) {
      next();
      return;
    }
    res.sendFile(path.join(distPath, "index.html"));
  });
}

server.listen(PORT, "0.0.0.0", () => {
  console.log(`Horus PDV Scanner Server rodando em http://0.0.0.0:${PORT}`);
});
