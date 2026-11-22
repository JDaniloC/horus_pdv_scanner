/**
 * Arquivo: src/components/LiveCameraScanner.tsx
 * Objetivo: Visor de câmera sempre aberta para celular com análise contínua ao vivo (screenshots em tempo real).
 *           Detecta códigos de barras (EAN-13, EAN-8, UPC, Code128) via BarcodeDetector/ZXing
 *           e extrai preços da etiqueta de gôndola (R$ XX,XX) via OCR no navegador (Tesseract.js),
 *           contabilizando automaticamente os itens na planilha ativa.
 */

import {
  Camera,
  CameraOff,
  CheckCircle2,
  Flashlight,
  RefreshCw,
  ScanBarcode,
  Sparkles,
  Tag,
  Volume2,
  VolumeX,
  Zap,
} from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { BarcodeDetector as BarcodeDetectorPolyfill } from "barcode-detector/pure";
import { createWorker, type Worker as TesseractWorker } from "tesseract.js";
import type {
  DuplicateScanBehavior,
  LiveScanResponse,
} from "@/types/scanner";
import type { CatalogSampleItem } from "@/services/scannerApi";
import {
  capturePriceRoiToDataUrl,
  extractPricesFromOcrText,
  type ExtractedPriceCandidate,
} from "@/utils/priceExtractor";

interface LiveCameraScannerProps {
  sheetName: string;
  sheetCode: string;
  duplicateBehavior: DuplicateScanBehavior;
  onDuplicateBehaviorChange: (behavior: DuplicateScanBehavior) => void;
  soundEnabled: boolean;
  onToggleSound: () => void;
  onCaptureScan: (input: {
    productCode: string;
    detectedSalePrice?: string;
    productName?: string;
    priceSource?: "ocr" | "manual" | "catalog";
  }) => Promise<LiveScanResponse | null>;
  onCameraActiveChange: (active: boolean) => void;
  catalogSamples: CatalogSampleItem[];
  lastCaptureResult: LiveScanResponse | null;
}

const SUPPORTED_BARCODE_FORMATS = [
  "ean_13",
  "ean_8",
  "upc_a",
  "upc_e",
  "code_128",
  "code_39",
  "itf",
] as const;

export default function LiveCameraScanner({
  sheetName,
  sheetCode,
  duplicateBehavior,
  onDuplicateBehaviorChange,
  soundEnabled,
  onToggleSound,
  onCaptureScan,
  onCameraActiveChange,
  catalogSamples,
  lastCaptureResult,
}: LiveCameraScannerProps) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const ocrWorkerRef = useRef<TesseractWorker | null>(null);
  const ocrBusyRef = useRef(false);
  const lastScannedCodeRef = useRef<{ code: string; timestamp: number }>({
    code: "",
    timestamp: 0,
  });

  const [isCameraActive, setIsCameraActive] = useState(false);
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [facingMode, setFacingMode] = useState<"environment" | "user">("environment");
  const [torchOn, setTorchOn] = useState(false);
  const [hasTorch, setHasTorch] = useState(false);

  // Estado da análise ao vivo (screenshots contínuos)
  const [liveOcrEnabled, setLiveOcrEnabled] = useState(true);
  const [ocrStatus, setOcrStatus] = useState<"idle" | "initializing" | "scanning">("idle");
  const [detectedPriceCandidates, setDetectedPriceCandidates] = useState<ExtractedPriceCandidate[]>([]);
  const [lockedPrice, setLockedPrice] = useState<string>("");
  const [liveBarcodePreview, setLiveBarcodePreview] = useState<string>("");
  const [screenshotsAnalyzed, setScreenshotsAnalyzed] = useState(0);
  const [cooldownMs, setCooldownMs] = useState(2400);
  const [scanFlash, setScanFlash] = useState(false);

  // Entrada manual rápida / pistola leitora ou teste instantâneo
  const [manualBarcode, setManualBarcode] = useState("");
  const [manualPrice, setManualPrice] = useState("");
  const [manualName, setManualName] = useState("");
  const [isSubmittingManual, setIsSubmittingManual] = useState(false);

  // Simulador de Gôndola ao Vivo (quando não há câmera física ou o usuário quer testar o fluxo ao vivo)
  const [autoSimulateShelf, setAutoSimulateShelf] = useState(false);
  const [simActiveProduct, setSimActiveProduct] = useState<CatalogSampleItem | null>(null);

  const activePriceToApply =
    lockedPrice ||
    manualPrice ||
    (detectedPriceCandidates[0]?.formatted ?? "");

  const stopCamera = useCallback(() => {
    if (streamRef.current) {
      for (const track of streamRef.current.getTracks()) {
        track.stop();
      }
      streamRef.current = null;
    }
    if (videoRef.current) {
      videoRef.current.srcObject = null;
    }
    setIsCameraActive(false);
    setTorchOn(false);
    onCameraActiveChange(false);
  }, [onCameraActiveChange]);

  const startCamera = useCallback(async () => {
    setCameraError(null);
    stopCamera();

    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      setCameraError(
        "Câmera não disponível neste navegador ou conexão sem HTTPS. Use a bancada de gôndola virtual ou entrada rápida abaixo.",
      );
      return;
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: false,
        video: {
          facingMode: { ideal: facingMode },
          width: { ideal: 1280 },
          height: { ideal: 720 },
        },
      });

      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
      }

      // Verifica suporte a lanterna (torch) no celular
      const videoTrack = stream.getVideoTracks()[0];
      if (videoTrack && "getCapabilities" in videoTrack) {
        const caps = videoTrack.getCapabilities() as Record<string, unknown>;
        setHasTorch(Boolean(caps?.torch));
      } else {
        setHasTorch(false);
      }

      setIsCameraActive(true);
      onCameraActiveChange(true);
    } catch (err) {
      const message =
        err instanceof Error && err.name === "NotAllowedError"
          ? "Permissão da câmera negada. Autorize o uso da câmera no navegador ou utilize o modo de gôndola virtual abaixo."
          : "Não foi possível abrir a câmera física neste dispositivo. Você pode usar a Gôndola Ao Vivo ou entrada rápida abaixo.";
      setCameraError(message);
      setIsCameraActive(false);
      onCameraActiveChange(false);
    }
  }, [facingMode, onCameraActiveChange, stopCamera]);

  // Tenta abrir a câmera automaticamente ao entrar na tela (câmera sempre aberta)
  useEffect(() => {
    startCamera();
    return () => {
      stopCamera();
    };
  }, [startCamera, stopCamera]);

  const toggleTorch = async () => {
    if (!streamRef.current) return;
    const track = streamRef.current.getVideoTracks()[0];
    if (!track) return;
    try {
      const next = !torchOn;
      await track.applyConstraints({
        advanced: [{ torch: next } as MediaTrackConstraintSet],
      });
      setTorchOn(next);
    } catch {
      // ignora se o aparelho não aceitar
    }
  };

  // Inicializa o worker de OCR (Tesseract.js) quando o OCR ao vivo está habilitado
  useEffect(() => {
    let cancelled = false;
    if (!liveOcrEnabled || !isCameraActive) {
      return;
    }

    async function initOcr() {
      if (ocrWorkerRef.current) return;
      try {
        setOcrStatus("initializing");
        const worker = await createWorker("por");
        if (cancelled) {
          await worker.terminate();
          return;
        }
        await worker.setParameters({
          tessedit_char_whitelist: "0123456789R$r$,.PORofertaOFERTA ",
        });
        ocrWorkerRef.current = worker;
        setOcrStatus("scanning");
      } catch {
        setOcrStatus("idle");
      }
    }

    initOcr();

    return () => {
      cancelled = true;
    };
  }, [liveOcrEnabled, isCameraActive]);

  // Finaliza worker de OCR ao desmontar
  useEffect(() => {
    return () => {
      if (ocrWorkerRef.current) {
        ocrWorkerRef.current.terminate().catch(() => {});
        ocrWorkerRef.current = null;
      }
    };
  }, []);

  // Loop contínuo 1: Captura de screenshots para Código de Barras (~5 vezes por segundo)
  useEffect(() => {
    if (!isCameraActive) return;

    let active = true;
    let detector: InstanceType<typeof BarcodeDetectorPolyfill> | null = null;

    try {
      const NativeDetector = (
        window as unknown as {
          BarcodeDetector?: typeof BarcodeDetectorPolyfill;
        }
      ).BarcodeDetector;
      const DetectorClass = NativeDetector || BarcodeDetectorPolyfill;
      detector = new DetectorClass({
        formats: [...SUPPORTED_BARCODE_FORMATS],
      });
    } catch {
      detector = new BarcodeDetectorPolyfill({
        formats: [...SUPPORTED_BARCODE_FORMATS],
      });
    }

    const interval = window.setInterval(async () => {
      if (!active || !videoRef.current || videoRef.current.readyState < 2 || !detector) {
        return;
      }

      try {
        const barcodes = await detector.detect(videoRef.current);
        setScreenshotsAnalyzed((c) => c + 1);

        if (barcodes.length > 0) {
          const rawValue = String(barcodes[0]?.rawValue ?? "").trim();
          const digits = rawValue.replace(/\D/g, "");
          const validCode = digits.length >= 8 ? digits : rawValue;

          if (validCode.length >= 8) {
            setLiveBarcodePreview(validCode);
            const now = Date.now();
            const isSameRecent =
              lastScannedCodeRef.current.code === validCode &&
              now - lastScannedCodeRef.current.timestamp < cooldownMs;

            if (!isSameRecent) {
              lastScannedCodeRef.current = { code: validCode, timestamp: now };
              setScanFlash(true);
              window.setTimeout(() => setScanFlash(false), 380);

              const priceToSend =
                lockedPrice ||
                manualPrice ||
                (detectedPriceCandidates[0]?.formatted ?? undefined);

              await onCaptureScan({
                productCode: validCode,
                detectedSalePrice: priceToSend,
                priceSource: priceToSend ? "ocr" : "catalog",
              });
            }
          }
        }
      } catch {
        // continua analisando o próximo frame
      }
    }, 240);

    return () => {
      active = false;
      window.clearInterval(interval);
    };
  }, [
    isCameraActive,
    cooldownMs,
    lockedPrice,
    manualPrice,
    detectedPriceCandidates,
    onCaptureScan,
  ]);

  // Loop contínuo 2: Captura de screenshots da região da etiqueta para OCR de Preço (R$ XX,XX)
  useEffect(() => {
    if (!isCameraActive || !liveOcrEnabled) return;

    const interval = window.setInterval(async () => {
      if (
        ocrBusyRef.current ||
        !ocrWorkerRef.current ||
        !videoRef.current ||
        videoRef.current.readyState < 2
      ) {
        return;
      }

      const roiDataUrl = capturePriceRoiToDataUrl(videoRef.current);
      if (!roiDataUrl) return;

      ocrBusyRef.current = true;
      try {
        const result = await ocrWorkerRef.current.recognize(roiDataUrl);
        const extracted = extractPricesFromOcrText(result.data.text);
        if (extracted.length > 0) {
          setDetectedPriceCandidates(extracted.slice(0, 4));
        }
      } catch {
        // ignora falha pontual de frame
      } finally {
        ocrBusyRef.current = false;
      }
    }, 1150);

    return () => {
      window.clearInterval(interval);
    };
  }, [isCameraActive, liveOcrEnabled]);

  // Loop contínuo 3: Simulador de Gôndola ao Vivo (para testar/demonstrar o fluxo contínuo mesmo sem câmera física)
  useEffect(() => {
    if (!autoSimulateShelf || catalogSamples.length === 0) return;

    const runStep = async () => {
      const sample =
        catalogSamples[Math.floor(Math.random() * catalogSamples.length)];
      if (!sample) return;

      setSimActiveProduct(sample);
      setScreenshotsAnalyzed((c) => c + 4);
      setLiveBarcodePreview(sample.barcode);

      const priceFormatted = sample.suggestedSalePrice
        ? sample.suggestedSalePrice.toFixed(2).replace(".", ",")
        : "9,90";

      setDetectedPriceCandidates([
        {
          formatted: priceFormatted,
          numeric: sample.suggestedSalePrice ?? 9.9,
          rawMatch: `R$ ${priceFormatted}`,
          confidenceScore: 96,
        },
      ]);

      setScanFlash(true);
      window.setTimeout(() => setScanFlash(false), 360);

      await onCaptureScan({
        productCode: sample.barcode,
        detectedSalePrice: lockedPrice || priceFormatted,
        productName: sample.productName,
        priceSource: "ocr",
      });
    };

    const timer = window.setInterval(runStep, 2600);
    return () => window.clearInterval(timer);
  }, [autoSimulateShelf, catalogSamples, lockedPrice, onCaptureScan]);

  const handleManualSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const cleanCode = manualBarcode.trim();
    if (!cleanCode) return;

    setIsSubmittingManual(true);
    try {
      setScanFlash(true);
      window.setTimeout(() => setScanFlash(false), 350);
      await onCaptureScan({
        productCode: cleanCode,
        detectedSalePrice: manualPrice.trim() || activePriceToApply || undefined,
        productName: manualName.trim() || undefined,
        priceSource: manualPrice.trim() ? "manual" : "ocr",
      });
      setManualBarcode("");
      setManualName("");
    } finally {
      setIsSubmittingManual(false);
    }
  };

  const triggerInstantSampleScan = async (sample: CatalogSampleItem) => {
    setSimActiveProduct(sample);
    setScreenshotsAnalyzed((c) => c + 1);
    setLiveBarcodePreview(sample.barcode);
    const priceFormatted = sample.suggestedSalePrice
      ? sample.suggestedSalePrice.toFixed(2).replace(".", ",")
      : "8,90";
    setDetectedPriceCandidates([
      {
        formatted: priceFormatted,
        numeric: sample.suggestedSalePrice ?? 8.9,
        rawMatch: `R$ ${priceFormatted}`,
        confidenceScore: 98,
      },
    ]);
    setScanFlash(true);
    window.setTimeout(() => setScanFlash(false), 350);

    await onCaptureScan({
      productCode: sample.barcode,
      detectedSalePrice: lockedPrice || manualPrice || priceFormatted,
      productName: sample.productName,
      priceSource: "ocr",
    });
  };

  return (
    <section className="scanner-card" aria-label="Câmera e Coletor ao Vivo">
      {/* Barra superior do coletor */}
      <div className="scanner-topbar">
        <div className="scanner-status-group">
          <span
            className={`live-indicator ${isCameraActive || autoSimulateShelf ? "is-live" : "is-standby"}`}
          >
            <span className="live-dot" />
            {isCameraActive
              ? "CÂMERA AO VIVO"
              : autoSimulateShelf
                ? "GÔNDOLA VIRTUAL AO VIVO"
                : "MODO COLETOR"}
          </span>
          <span className="frame-counter" title="Frames analisados em tempo real">
            {screenshotsAnalyzed} frames analisados
          </span>
        </div>

        <div className="scanner-controls-row">
          <button
            type="button"
            id="btn-toggle-sound"
            onClick={onToggleSound}
            className="icon-pill-btn"
            title={soundEnabled ? "Som de bipe ativado" : "Som silenciado"}
          >
            {soundEnabled ? <Volume2 size={16} /> : <VolumeX size={16} />}
          </button>

          {hasTorch && isCameraActive ? (
            <button
              type="button"
              id="btn-toggle-torch"
              onClick={toggleTorch}
              className={`icon-pill-btn ${torchOn ? "is-active" : ""}`}
              title="Lanterna para iluminar gôndola"
            >
              <Flashlight size={16} />
            </button>
          ) : null}

          {isCameraActive ? (
            <button
              type="button"
              id="btn-switch-camera"
              onClick={() =>
                setFacingMode((prev) => (prev === "environment" ? "user" : "environment"))
              }
              className="icon-pill-btn"
              title="Alternar câmera traseira/frontal"
            >
              <RefreshCw size={16} />
            </button>
          ) : null}

          <button
            type="button"
            id="btn-toggle-camera"
            onClick={() => (isCameraActive ? stopCamera() : startCamera())}
            className={`icon-pill-btn ${isCameraActive ? "is-active" : ""}`}
          >
            {isCameraActive ? <CameraOff size={16} /> : <Camera size={16} />}
            <span>{isCameraActive ? "Pausar" : "Abrir Câmera"}</span>
          </button>
        </div>
      </div>

      {/* Visor HUD da Câmera Sempre Aberta */}
      <div className={`camera-viewport ${scanFlash ? "scan-flash-active" : ""}`}>
        <video
          ref={videoRef}
          playsInline
          muted
          autoPlay
          className={`camera-video ${isCameraActive ? "is-visible" : "is-hidden"}`}
        />

        {/* Overlay de Mira Dupla: Código de Barras + Etiqueta de Preço */}
        <div className="hud-overlay">
          {/* Guia Superior: Código de Barras EAN / GTIN */}
          <div className="hud-zone hud-zone-barcode">
            <div className="hud-corner tl" />
            <div className="hud-corner tr" />
            <div className="hud-corner bl" />
            <div className="hud-corner br" />
            <div className="laser-line" />
            <div className="hud-zone-header">
              <ScanBarcode size={14} />
              <span>ZONA 1 · CÓDIGO DE BARRAS (EAN-13 / GTIN)</span>
            </div>
            <div className="hud-zone-readout">
              {liveBarcodePreview ? (
                <span className="detected-code-badge">{liveBarcodePreview}</span>
              ) : (
                <span className="hud-hint">Aponte para o código de barras do produto</span>
              )}
            </div>
          </div>

          {/* Guia Inferior: OCR de Preço da Etiqueta de Gôndola */}
          <div className="hud-zone hud-zone-price">
            <div className="hud-zone-header">
              <Tag size={14} />
              <span>
                ZONA 2 · PREÇO NA ETIQUETA (OCR{" "}
                {ocrStatus === "scanning"
                  ? "ATIVO"
                  : ocrStatus === "initializing"
                    ? "INICIANDO..."
                    : "PRONTO"}
                )
              </span>
            </div>
            <div className="hud-zone-readout">
              {activePriceToApply ? (
                <span className="detected-price-badge">
                  R$ {activePriceToApply}
                  {lockedPrice ? " (travado)" : " (ao vivo)"}
                </span>
              ) : (
                <span className="hud-hint">Enquadre o valor R$ XX,XX da gôndola</span>
              )}
            </div>
          </div>
        </div>

        {/* Caso câmera física não esteja aberta (ex: desktop sem webcam ou permissão pendente), exibe o Simulador Interativo de Gôndola */}
        {!isCameraActive ? (
          <div className="virtual-shelf-stage">
            <div className="virtual-shelf-header">
              <div>
                <p className="virtual-shelf-eyebrow">
                  {cameraError || "Câmera em espera · Bancada de Gôndola ao Vivo pronta"}
                </p>
                <h3 className="virtual-shelf-title">
                  Toque em um produto na prateleira ou ative o Scanner Contínuo Automático
                </h3>
              </div>
              <button
                type="button"
                id="btn-auto-simulate-shelf"
                onClick={() => setAutoSimulateShelf((prev) => !prev)}
                className={`btn-live-shelf ${autoSimulateShelf ? "is-running" : ""}`}
              >
                <Zap size={15} />
                {autoSimulateShelf ? "Parar Captura Contínua" : "Simular Câmera Contínua"}
              </button>
            </div>

            {simActiveProduct ? (
              <div className="sim-current-frame">
                <span className="sim-badge">FRAME CAPTURADO</span>
                <strong>{simActiveProduct.productName}</strong>
                <span className="sim-meta">
                  EAN {simActiveProduct.barcode} · R${" "}
                  {(simActiveProduct.suggestedSalePrice ?? 0).toFixed(2).replace(".", ",")}
                </span>
              </div>
            ) : null}
          </div>
        ) : null}
      </div>

      {/* Feedback imediato da última leitura contabilizada */}
      {lastCaptureResult ? (
        <div
          className={`last-capture-toast action-${lastCaptureResult.action}`}
          role="status"
          aria-live="polite"
        >
          <div className="last-capture-icon">
            <CheckCircle2 size={20} />
          </div>
          <div className="last-capture-body">
            <div className="last-capture-topline">
              <span className="capture-action-pill">
                {lastCaptureResult.action === "created"
                  ? "NOVO PRODUTO"
                  : lastCaptureResult.action === "updated_price"
                    ? "QTD +1 & PREÇO ATUALIZADO"
                    : lastCaptureResult.action === "incremented"
                      ? `CONTABILIZADO (+1 → ${lastCaptureResult.item.productQnt} UN)`
                      : "IGNORADO (JÁ CADASTRADO)"}
              </span>
              <span className="capture-barcode-mono">
                {lastCaptureResult.item.productCode}
              </span>
            </div>
            <p className="last-capture-name">{lastCaptureResult.item.productName}</p>
            <div className="last-capture-metrics">
              <span>
                Venda: <strong>R$ {lastCaptureResult.item.productSalePrice}</strong>
              </span>
              <span>
                Custo est.: <strong>R$ {lastCaptureResult.item.productUnitPrice}</strong>
              </span>
              <span>
                Qtd na planilha: <strong>{lastCaptureResult.item.productQnt}</strong>
              </span>
              <span>
                Fonte: <strong>{lastCaptureResult.item.catalogSource}</strong>
              </span>
            </div>
          </div>
        </div>
      ) : null}

      {/* Painel de Preços Detectados pelo OCR nos Screenshots ao Vivo */}
      <div className="ocr-prices-strip">
        <div className="ocr-strip-header">
          <div className="ocr-strip-title">
            <Sparkles size={15} />
            <span>Preços capturados pela câmera (toque para travar antes do código):</span>
          </div>
          <label className="ocr-toggle-label">
            <input
              type="checkbox"
              checked={liveOcrEnabled}
              onChange={(e) => setLiveOcrEnabled(e.target.checked)}
            />
            <span>OCR de Preço ao Vivo</span>
          </label>
        </div>

        <div className="price-chips-row">
          {detectedPriceCandidates.length === 0 ? (
            <span className="empty-price-chip">
              Nenhum preço travado (usará o preço do frame atual ou sugerido do catálogo)
            </span>
          ) : (
            detectedPriceCandidates.map((cand) => {
              const isLocked = lockedPrice === cand.formatted;
              return (
                <button
                  key={cand.formatted}
                  type="button"
                  onClick={() => setLockedPrice(isLocked ? "" : cand.formatted)}
                  className={`price-candidate-chip ${isLocked ? "is-locked" : ""}`}
                >
                  <span>R$ {cand.formatted}</span>
                  <small>{isLocked ? "Travado" : `${cand.confidenceScore}%`}</small>
                </button>
              );
            })
          )}
          {lockedPrice ? (
            <button
              type="button"
              onClick={() => setLockedPrice("")}
              className="clear-price-lock-btn"
            >
              Limpar trava (R$ {lockedPrice})
            </button>
          ) : null}
        </div>
      </div>

      {/* Configuração rápida de comportamento ao ler produto repetido */}
      <div className="scanner-config-bar">
        <div className="config-field">
          <label htmlFor="select-duplicate-behavior">Ao ler o mesmo código:</label>
          <select
            id="select-duplicate-behavior"
            value={duplicateBehavior}
            onChange={(e) =>
              onDuplicateBehaviorChange(e.target.value as DuplicateScanBehavior)
            }
            className="scanner-select"
          >
            <option value="increment">
              Somar quantidade (+1) e atualizar preço
            </option>
            <option value="ignore">
              Ignorar código repetido (apenas catalogar únicos)
            </option>
            <option value="new_row">Criar nova linha separada</option>
          </select>
        </div>

        <div className="config-field">
          <label htmlFor="select-cooldown">Intervalo entre leituras iguais:</label>
          <select
            id="select-cooldown"
            value={cooldownMs}
            onChange={(e) => setCooldownMs(Number(e.target.value))}
            className="scanner-select"
          >
            <option value={1500}>1,5 seg (Rápido)</option>
            <option value={2400}>2,4 seg (Padrão)</option>
            <option value={4000}>4,0 seg (Pausado)</option>
          </select>
        </div>
      </div>

      {/* Prateleira Rápida de Produtos de Mercadinho (1 toque para simular leitura de câmera) */}
      <div className="quick-shelf-drawer">
        <div className="quick-shelf-header">
          <span>
            Simulador de Gôndola · Toque num item para disparar captura de código + preço em{" "}
            <strong>{sheetName}</strong> ({sheetCode}):
          </span>
        </div>
        <div className="quick-shelf-grid">
          {catalogSamples.slice(0, 8).map((sample) => (
            <button
              key={sample.barcode}
              type="button"
              onClick={() => triggerInstantSampleScan(sample)}
              className="shelf-sample-btn"
            >
              <span className="shelf-sample-code">{sample.barcode}</span>
              <span className="shelf-sample-name">{sample.productName}</span>
              <span className="shelf-sample-price">
                R$ {(sample.suggestedSalePrice ?? 0).toFixed(2).replace(".", ",")}
              </span>
            </button>
          ))}
        </div>
      </div>

      {/* Entrada Rápida / Leitor USB ou Bluetooth / Ajuste de Preço antes de capturar */}
      <form onSubmit={handleManualSubmit} className="manual-capture-form">
        <div className="manual-inputs-grid">
          <div className="input-group">
            <label htmlFor="input-manual-barcode">Código de Barras (EAN / GTIN)</label>
            <input
              id="input-manual-barcode"
              type="text"
              inputMode="numeric"
              placeholder="Ex: 7894900011517"
              value={manualBarcode}
              onChange={(e) => setManualBarcode(e.target.value)}
              className="scanner-input font-mono"
            />
          </div>

          <div className="input-group">
            <label htmlFor="input-manual-price">Preço Venda (R$)</label>
            <input
              id="input-manual-price"
              type="text"
              inputMode="decimal"
              placeholder={activePriceToApply ? `Auto: ${activePriceToApply}` : "Ex: 8,90"}
              value={manualPrice}
              onChange={(e) => setManualPrice(e.target.value)}
              className="scanner-input font-mono"
            />
          </div>

          <div className="input-group">
            <label htmlFor="input-manual-name">Nome (opcional — busca automática)</label>
            <input
              id="input-manual-name"
              type="text"
              placeholder="Automático via EAN"
              value={manualName}
              onChange={(e) => setManualName(e.target.value)}
              className="scanner-input"
            />
          </div>
        </div>

        <button
          type="submit"
          id="btn-submit-manual-scan"
          disabled={!manualBarcode.trim() || isSubmittingManual}
          className="btn-primary-capture"
        >
          <ScanBarcode size={18} />
          <span>
            {isSubmittingManual
              ? "Consultando EAN & Contabilizando..."
              : "Capturar Código + Preço na Planilha"}
          </span>
        </button>
      </form>
    </section>
  );
}
