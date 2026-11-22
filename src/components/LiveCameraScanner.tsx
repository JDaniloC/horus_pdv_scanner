/**
 * Arquivo: src/components/LiveCameraScanner.tsx
 * Objetivo: Visor de câmera sempre aberta para celular com análise contínua ao vivo (screenshots em tempo real).
 *           Logo abaixo do leitor, disponibiliza preenchimento rápido de Quantidade, Preço Unitário de Venda/Custo,
 *           Calculadora de Fardo (deduz custo unitário + sugere preço de venda por margem) e
 *           criação/seleção instantânea de Categoria na hora.
 */

import {
  AlertTriangle,
  Calculator,
  Calendar,
  Camera,
  CameraOff,
  CheckCircle2,
  Flashlight,
  FolderPlus,
  Globe,
  Minus,
  Package,
  Plus,
  RefreshCw,
  Save,
  ScanBarcode,
  Search,
  Sparkles,
  Tag,
  Volume2,
  VolumeX,
  Zap,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { BarcodeDetector as BarcodeDetectorPolyfill } from "barcode-detector/pure";
import { createWorker, type Worker as TesseractWorker } from "tesseract.js";
import type {
  BarcodeCatalogInfo,
  DuplicateScanBehavior,
  LiveScanResponse,
} from "@/types/scanner";
import { scannerApi, type CatalogSampleItem } from "@/services/scannerApi";
import {
  capturePriceRoiToDataUrl,
  extractPricesFromOcrText,
  type ExtractedPriceCandidate,
} from "@/utils/priceExtractor";
import {
  calculateMarginPercent,
  calculateSalePriceFromMargin,
  calculateUnitCostFromPack,
} from "@/utils/packPricing";
import {
  addDaysIsoDate,
  formatExpirationPtBr,
  type ExpirationPresetMode,
} from "@/utils/expirationDate";
import { isProductNameUnclear } from "@/utils/productNameQuality";

interface LiveCameraScannerProps {
  sheetName: string;
  sheetCode: string;
  categories: string[];
  onCreateCategory: (name: string) => Promise<string | null>;
  duplicateBehavior: DuplicateScanBehavior;
  onDuplicateBehaviorChange: (behavior: DuplicateScanBehavior) => void;
  soundEnabled: boolean;
  onToggleSound: () => void;
  onCaptureScan: (input: {
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
  }) => Promise<LiveScanResponse | null>;
  onApplyValuesToLastItem?: (
    itemId: string,
    updates: {
      productName?: string;
      productQnt?: number;
      productSalePrice?: string;
      productUnitPrice?: string;
      packPrice?: string;
      packQuantity?: number;
      expirationDate?: string | null;
      productCategory?: string;
    },
  ) => Promise<void>;
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

const MARGIN_PRESETS = [25, 30, 40, 50];
const QUICK_QTY_PRESETS = [1, 6, 12, 24];

export default function LiveCameraScanner({
  sheetName,
  sheetCode,
  categories,
  onCreateCategory,
  duplicateBehavior,
  onDuplicateBehaviorChange,
  soundEnabled,
  onToggleSound,
  onCaptureScan,
  onApplyValuesToLastItem,
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

  // Inputs rápidos logo abaixo do leitor: Quantidade, Preço Unitário de Venda e Custo
  const [scanQuantity, setScanQuantity] = useState("1");
  const [resetQuantityAfterScan, setResetQuantityAfterScan] = useState(true);
  const [manualSalePrice, setManualSalePrice] = useState("");
  const [manualUnitCost, setManualUnitCost] = useState("");

  // Calculadora de Fardo (Preço do Fardo + Qtd no Fardo -> Custo Unitário + Sugestão de Venda)
  const [showPackCalculator, setShowPackCalculator] = useState(true);
  const [packPriceInput, setPackPriceInput] = useState("");
  const [packQtyInput, setPackQtyInput] = useState("");
  const [marginPercentInput, setMarginPercentInput] = useState("35");

  // Seleção e criação imediata de Categoria na hora
  const [selectedCategory, setSelectedCategory] = useState<string>("");
  const [showNewCategoryForm, setShowNewCategoryForm] = useState(false);
  const [newCategoryName, setNewCategoryName] = useState("");
  const [creatingCategory, setCreatingCategory] = useState(false);

  // Data de Vencimento (Sem vencimento / Nulo, +30 dias, ou data específica)
  const [expirationMode, setExpirationMode] = useState<ExpirationPresetMode>("none");
  const [customExpirationDate, setCustomExpirationDate] = useState<string>(() =>
    addDaysIsoDate(30),
  );

  // Entrada manual rápida / pistola leitora
  const [manualBarcode, setManualBarcode] = useState("");
  const [manualName, setManualName] = useState("");
  const [manualDescription, setManualDescription] = useState("");
  const [manualBrand, setManualBrand] = useState("");
  const [manualImageUrl, setManualImageUrl] = useState("");
  const [isSubmittingManual, setIsSubmittingManual] = useState(false);
  const [applyingToLast, setApplyingToLast] = useState(false);

  // Pesquisa de produto na internet por nome/marca
  const [internetSearchQuery, setInternetSearchQuery] = useState("");
  const [internetResults, setInternetResults] = useState<BarcodeCatalogInfo[]>([]);
  const [isSearchingInternet, setIsSearchingInternet] = useState(false);
  const [internetSearchDone, setInternetSearchDone] = useState(false);

  // Formulário pré-preenchido automático quando o nome do produto capturado não está claro
  const reviewNameInputRef = useRef<HTMLInputElement | null>(null);
  const lastAutoReviewedIdRef = useRef<string>("");
  const [reviewOpen, setReviewOpen] = useState(false);
  const [reviewItemId, setReviewItemId] = useState<string | null>(null);
  const [reviewBarcode, setReviewBarcode] = useState("");
  const [reviewIsUnclearAlert, setReviewIsUnclearAlert] = useState(false);
  const [reviewSaving, setReviewSaving] = useState(false);
  const [reviewForm, setReviewForm] = useState<{
    productName: string;
    productQnt: string;
    productSalePrice: string;
    productUnitPrice: string;
    productCategory: string;
    expirationMode: ExpirationPresetMode;
    customExpirationDate: string;
  }>({
    productName: "",
    productQnt: "1",
    productSalePrice: "",
    productUnitPrice: "",
    productCategory: "",
    expirationMode: "none",
    customExpirationDate: addDaysIsoDate(30),
  });

  // Simulador de Gôndola ao Vivo
  const [autoSimulateShelf, setAutoSimulateShelf] = useState(false);
  const [simActiveProduct, setSimActiveProduct] = useState<CatalogSampleItem | null>(null);

  // Abre o formulário pré-preenchido automaticamente se o produto capturado tiver nome estranho/genérico
  useEffect(() => {
    if (!lastCaptureResult) return;
    const item = lastCaptureResult.item;
    if (lastAutoReviewedIdRef.current === item.id) return;
    lastAutoReviewedIdRef.current = item.id;

    const unclear = isProductNameUnclear(item.productName, item.catalogSource);
    if (unclear) {
      const isGenericPlaceholder = /^produto\s+(ean|pes[aá]vel)/i.test(item.productName);
      setReviewItemId(item.id);
      setReviewBarcode(item.productCode);
      setReviewIsUnclearAlert(true);
      setReviewForm({
        productName: isGenericPlaceholder ? "" : item.productName,
        productQnt: String(item.productQnt || 1),
        productSalePrice: item.productSalePrice === "0,00" ? "" : item.productSalePrice,
        productUnitPrice: item.productUnitPrice === "0,00" ? "" : item.productUnitPrice,
        productCategory: item.productCategory || "Mercearia",
        expirationMode: item.expirationDate ? "custom" : "none",
        customExpirationDate: item.expirationDate || addDaysIsoDate(30),
      });
      setReviewOpen(true);
      window.setTimeout(() => {
        reviewNameInputRef.current?.focus();
      }, 60);
    }
  }, [lastCaptureResult]);

  const effectiveExpirationDate = useMemo<string | null>(() => {
    if (expirationMode === "none") return null;
    if (expirationMode === "30_days") return addDaysIsoDate(30);
    return customExpirationDate.trim() || null;
  }, [expirationMode, customExpirationDate]);

  const packUnitCost = useMemo(
    () => calculateUnitCostFromPack(packPriceInput, packQtyInput),
    [packPriceInput, packQtyInput],
  );

  // Custo efetivo: se usuário digitou custo unitário manualmente ou calculou pelo fardo
  const effectiveUnitCost = manualUnitCost.trim() || packUnitCost.formatted;

  const suggestedSaleFromMargin = useMemo(
    () => calculateSalePriceFromMargin(effectiveUnitCost, marginPercentInput),
    [effectiveUnitCost, marginPercentInput],
  );

  const activeSalePriceToApply =
    lockedPrice ||
    manualSalePrice.trim() ||
    (detectedPriceCandidates[0]?.formatted ?? "");

  const currentMarginPercent = useMemo(
    () => calculateMarginPercent(effectiveUnitCost, activeSalePriceToApply),
    [effectiveUnitCost, activeSalePriceToApply],
  );

  const parsedScanQty = useMemo(() => {
    const val = Number.parseFloat(scanQuantity.replace(",", "."));
    return Number.isFinite(val) && val > 0 ? Math.round(val * 1000) / 1000 : 1;
  }, [scanQuantity]);

  const parsedPackQty = useMemo(() => {
    const val = Number.parseFloat(packQtyInput.replace(",", "."));
    return Number.isFinite(val) && val > 0 ? val : undefined;
  }, [packQtyInput]);

  // Quando o fardo ou margem muda e deduz um novo custo unitário, atualiza o input de custo e sugere venda
  const handlePackPriceOrQtyChange = (nextPackPrice: string, nextPackQty: string) => {
    setPackPriceInput(nextPackPrice);
    setPackQtyInput(nextPackQty);
    const computed = calculateUnitCostFromPack(nextPackPrice, nextPackQty);
    if (computed.formatted) {
      setManualUnitCost(computed.formatted);
      const suggested = calculateSalePriceFromMargin(computed.formatted, marginPercentInput);
      if (suggested.formatted) {
        setManualSalePrice(suggested.formatted);
      }
    }
  };

  const handleMarginChange = (nextMargin: string) => {
    setMarginPercentInput(nextMargin);
    if (effectiveUnitCost) {
      const suggested = calculateSalePriceFromMargin(effectiveUnitCost, nextMargin);
      if (suggested.formatted) {
        setManualSalePrice(suggested.formatted);
      }
    }
  };

  const handleStepScanQty = (delta: number) => {
    const next = Math.max(1, Math.round((parsedScanQty + delta) * 1000) / 1000);
    setScanQuantity(String(next));
  };

  const handleCreateCategoryInline = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    const trimmed = newCategoryName.trim();
    if (!trimmed) return;
    setCreatingCategory(true);
    try {
      const created = await onCreateCategory(trimmed);
      if (created) {
        setSelectedCategory(created);
        setNewCategoryName("");
        setShowNewCategoryForm(false);
      }
    } finally {
      setCreatingCategory(false);
    }
  };

  const buildCurrentScanExtras = useCallback(() => {
    const salePrice =
      lockedPrice ||
      manualSalePrice.trim() ||
      (detectedPriceCandidates[0]?.formatted ?? undefined);

    return {
      detectedSalePrice: salePrice,
      detectedUnitPrice: effectiveUnitCost || undefined,
      packPrice: packPriceInput.trim() || undefined,
      packQuantity: parsedPackQty,
      expirationDate: effectiveExpirationDate,
      productCategory: selectedCategory || undefined,
      quantityDelta: parsedScanQty,
      priceSource: (lockedPrice || manualSalePrice.trim()
        ? "manual"
        : salePrice
          ? "ocr"
          : "catalog") as "ocr" | "manual" | "catalog",
    };
  }, [
    lockedPrice,
    manualSalePrice,
    detectedPriceCandidates,
    effectiveUnitCost,
    packPriceInput,
    parsedPackQty,
    effectiveExpirationDate,
    selectedCategory,
    parsedScanQty,
  ]);

  const finalizeAfterScan = useCallback(() => {
    if (resetQuantityAfterScan) {
      setScanQuantity("1");
    }
  }, [resetQuantityAfterScan]);

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

  // Inicializa o worker de OCR (Tesseract.js)
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

              const extras = buildCurrentScanExtras();
              await onCaptureScan({
                productCode: validCode,
                ...extras,
              });
              finalizeAfterScan();
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
    buildCurrentScanExtras,
    onCaptureScan,
    finalizeAfterScan,
  ]);

  // Loop contínuo 2: OCR de Preço na etiqueta
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
        // ignora falha pontual
      } finally {
        ocrBusyRef.current = false;
      }
    }, 1150);

    return () => {
      window.clearInterval(interval);
    };
  }, [isCameraActive, liveOcrEnabled]);

  // Loop contínuo 3: Simulador de Gôndola ao Vivo
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

      const extras = buildCurrentScanExtras();
      await onCaptureScan({
        productCode: sample.barcode,
        productName: sample.productName,
        ...extras,
        detectedSalePrice: extras.detectedSalePrice || priceFormatted,
      });
      finalizeAfterScan();
    };

    const timer = window.setInterval(runStep, 2600);
    return () => window.clearInterval(timer);
  }, [
    autoSimulateShelf,
    catalogSamples,
    buildCurrentScanExtras,
    onCaptureScan,
    finalizeAfterScan,
  ]);

  const handleInternetSearch = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    const q = internetSearchQuery.trim();
    if (q.length < 2) return;
    setIsSearchingInternet(true);
    setInternetSearchDone(false);
    try {
      const { results } = await scannerApi.searchCatalogByName(q);
      setInternetResults(results);
      setInternetSearchDone(true);
    } catch {
      setInternetResults([]);
      setInternetSearchDone(true);
    } finally {
      setIsSearchingInternet(false);
    }
  };

  const applyInternetResult = async (
    item: BarcodeCatalogInfo,
    captureImmediately: boolean,
  ) => {
    const codeToUse = item.barcode || manualBarcode.trim() || `INT-${Date.now().toString().slice(-6)}`;
    if (item.productCategory) {
      const exists = categories.some(
        (c) => c.toLowerCase() === item.productCategory.toLowerCase(),
      );
      if (!exists) {
        await onCreateCategory(item.productCategory);
      }
      setSelectedCategory(item.productCategory);
    }
    if (item.suggestedSalePrice && item.suggestedSalePrice > 0 && !manualSalePrice.trim()) {
      setManualSalePrice(item.suggestedSalePrice.toFixed(2).replace(".", ","));
    }

    if (captureImmediately) {
      setScanFlash(true);
      window.setTimeout(() => setScanFlash(false), 350);
      const extras = buildCurrentScanExtras();
      await onCaptureScan({
        productCode: codeToUse,
        productName: item.productName,
        productDescription: item.productDescription,
        brand: item.brand,
        productImageUrl: item.productImageUrl,
        ...extras,
        productCategory: item.productCategory || extras.productCategory,
        detectedSalePrice:
          extras.detectedSalePrice ||
          (item.suggestedSalePrice
            ? item.suggestedSalePrice.toFixed(2).replace(".", ",")
            : undefined),
      });
      finalizeAfterScan();
      setInternetResults([]);
      setInternetSearchQuery("");
      setInternetSearchDone(false);
      return;
    }

    setManualBarcode(codeToUse);
    setManualName(item.productName);
    setManualDescription(item.productDescription);
    setManualBrand(item.brand);
    setManualImageUrl(item.productImageUrl);
    setInternetResults([]);
    setInternetSearchDone(false);
  };

  const handleManualSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const cleanCode = manualBarcode.trim();
    if (!cleanCode) return;

    setIsSubmittingManual(true);
    try {
      setScanFlash(true);
      window.setTimeout(() => setScanFlash(false), 350);
      const extras = buildCurrentScanExtras();
      await onCaptureScan({
        productCode: cleanCode,
        productName: manualName.trim() || undefined,
        productDescription: manualDescription.trim() || undefined,
        brand: manualBrand.trim() || undefined,
        productImageUrl: manualImageUrl.trim() || undefined,
        ...extras,
      });
      setManualBarcode("");
      setManualName("");
      setManualDescription("");
      setManualBrand("");
      setManualImageUrl("");
      finalizeAfterScan();
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

    const extras = buildCurrentScanExtras();
    await onCaptureScan({
      productCode: sample.barcode,
      productName: sample.productName,
      ...extras,
      detectedSalePrice: extras.detectedSalePrice || priceFormatted,
    });
    finalizeAfterScan();
  };

  const handleApplyToLastCaptured = async () => {
    if (!lastCaptureResult || !onApplyValuesToLastItem) return;
    setApplyingToLast(true);
    try {
      const extras = buildCurrentScanExtras();
      await onApplyValuesToLastItem(lastCaptureResult.item.id, {
        productQnt: parsedScanQty,
        ...(extras.detectedSalePrice ? { productSalePrice: extras.detectedSalePrice } : {}),
        ...(extras.detectedUnitPrice ? { productUnitPrice: extras.detectedUnitPrice } : {}),
        ...(extras.packPrice ? { packPrice: extras.packPrice } : {}),
        ...(extras.packQuantity ? { packQuantity: extras.packQuantity } : {}),
        expirationDate: extras.expirationDate,
        ...(extras.productCategory ? { productCategory: extras.productCategory } : {}),
      });
    } finally {
      setApplyingToLast(false);
    }
  };

  const openReviewForLastItem = () => {
    if (!lastCaptureResult) return;
    const item = lastCaptureResult.item;
    const isGenericPlaceholder = /^produto\s+(ean|pes[aá]vel)/i.test(item.productName);
    setReviewItemId(item.id);
    setReviewBarcode(item.productCode);
    setReviewIsUnclearAlert(isProductNameUnclear(item.productName, item.catalogSource));
    setReviewForm({
      productName: isGenericPlaceholder ? "" : item.productName,
      productQnt: String(item.productQnt || 1),
      productSalePrice: item.productSalePrice === "0,00" ? "" : item.productSalePrice,
      productUnitPrice: item.productUnitPrice === "0,00" ? "" : item.productUnitPrice,
      productCategory: item.productCategory || "Mercearia",
      expirationMode: item.expirationDate ? "custom" : "none",
      customExpirationDate: item.expirationDate || addDaysIsoDate(30),
    });
    setReviewOpen(true);
    window.setTimeout(() => {
      reviewNameInputRef.current?.focus();
    }, 50);
  };

  const handleSaveReviewForm = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!reviewItemId || !onApplyValuesToLastItem) return;
    setReviewSaving(true);
    try {
      const qnt = Number.parseFloat(reviewForm.productQnt.replace(",", "."));
      const finalExp =
        reviewForm.expirationMode === "none"
          ? null
          : reviewForm.expirationMode === "30_days"
            ? addDaysIsoDate(30)
            : reviewForm.customExpirationDate.trim() || null;

      await onApplyValuesToLastItem(reviewItemId, {
        ...(reviewForm.productName.trim()
          ? { productName: reviewForm.productName.trim() }
          : {}),
        productQnt: Number.isFinite(qnt) && qnt > 0 ? qnt : 1,
        ...(reviewForm.productSalePrice.trim()
          ? { productSalePrice: reviewForm.productSalePrice.trim() }
          : {}),
        ...(reviewForm.productUnitPrice.trim()
          ? { productUnitPrice: reviewForm.productUnitPrice.trim() }
          : {}),
        productCategory: reviewForm.productCategory || "Mercearia",
        expirationDate: finalExp,
      });
      setReviewOpen(false);
    } finally {
      setReviewSaving(false);
    }
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
          <div className="hud-zone hud-zone-barcode">
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
              {activeSalePriceToApply ? (
                <span className="detected-price-badge">
                  R$ {activeSalePriceToApply}
                  {lockedPrice ? " (travado)" : manualSalePrice ? " (definido)" : " (ao vivo)"}
                </span>
              ) : (
                <span className="hud-hint">Enquadre o valor R$ XX,XX da gôndola</span>
              )}
            </div>
          </div>
        </div>

        {/* Caso câmera física não esteja aberta */}
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

      {/* FORMULÁRIO PRÉ-PREENCHIDO AUTOMÁTICO (aparece logo abaixo da câmera quando o nome não está claro) */}
      {reviewOpen && reviewItemId ? (
        <form
          onSubmit={handleSaveReviewForm}
          className={`review-unclear-card ${reviewIsUnclearAlert ? "is-unclear" : ""}`}
          aria-label="Completar Cadastro do Produto"
        >
          <div className="review-card-header">
            <div className="review-card-title">
              <AlertTriangle size={16} />
              <span>
                {reviewIsUnclearAlert
                  ? "Nome não identificado claramente — complete os dados abaixo:"
                  : "Editar Cadastro Rápido:"}
              </span>
            </div>
            <span className="capture-barcode-mono">{reviewBarcode}</span>
          </div>

          <div className="review-name-row">
            <input
              ref={reviewNameInputRef}
              id="input-review-product-name"
              type="text"
              placeholder="Digite o nome real (ex: Refrigerante Coca-Cola 2L)..."
              value={reviewForm.productName}
              onChange={(e) =>
                setReviewForm((f) => ({ ...f, productName: e.target.value }))
              }
              className="scanner-input"
            />
            <button
              type="button"
              id="btn-review-search-internet"
              disabled={reviewForm.productName.trim().length < 2 || isSearchingInternet}
              onClick={() => {
                setInternetSearchQuery(reviewForm.productName.trim());
                scannerApi
                  .searchCatalogByName(reviewForm.productName.trim())
                  .then(({ results }) => {
                    if (results[0]) {
                      setReviewForm((f) => ({
                        ...f,
                        productName: results[0].productName,
                        productCategory: results[0].productCategory || f.productCategory,
                      }));
                    } else {
                      setInternetResults([]);
                      setInternetSearchDone(true);
                    }
                  })
                  .catch(() => {});
              }}
              className="btn-review-web-lookup"
              title="Preencher nome e categoria buscando na internet"
            >
              <Globe size={14} />
              <span>Buscar</span>
            </button>
          </div>

          <div className="review-fields-grid">
            <div className="input-group">
              <label htmlFor="input-review-qty">Quantidade</label>
              <input
                id="input-review-qty"
                type="text"
                inputMode="decimal"
                value={reviewForm.productQnt}
                onChange={(e) =>
                  setReviewForm((f) => ({ ...f, productQnt: e.target.value }))
                }
                className="scanner-input font-mono"
              />
            </div>

            <div className="input-group">
              <label htmlFor="input-review-cost">Custo Unit. (R$)</label>
              <input
                id="input-review-cost"
                type="text"
                inputMode="decimal"
                placeholder="Ex: 5,20"
                value={reviewForm.productUnitPrice}
                onChange={(e) =>
                  setReviewForm((f) => ({ ...f, productUnitPrice: e.target.value }))
                }
                className="scanner-input font-mono"
              />
            </div>

            <div className="input-group">
              <label htmlFor="input-review-sale">Preço Venda (R$)</label>
              <input
                id="input-review-sale"
                type="text"
                inputMode="decimal"
                placeholder="Ex: 7,90"
                value={reviewForm.productSalePrice}
                onChange={(e) =>
                  setReviewForm((f) => ({ ...f, productSalePrice: e.target.value }))
                }
                className="scanner-input font-mono"
              />
            </div>

            <div className="input-group">
              <label htmlFor="select-review-category">Categoria</label>
              <select
                id="select-review-category"
                value={reviewForm.productCategory}
                onChange={(e) =>
                  setReviewForm((f) => ({ ...f, productCategory: e.target.value }))
                }
                className="scanner-select"
              >
                {categories.map((cat) => (
                  <option key={cat} value={cat}>
                    {cat}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div className="review-expiration-row">
            <span className="expiration-label">
              <Calendar size={13} />
              <span>Vencimento:</span>
            </span>
            <button
              type="button"
              onClick={() =>
                setReviewForm((f) => ({ ...f, expirationMode: "none" }))
              }
              className={`exp-mode-btn ${reviewForm.expirationMode === "none" ? "is-selected" : ""}`}
            >
              Nulo
            </button>
            <button
              type="button"
              onClick={() =>
                setReviewForm((f) => ({ ...f, expirationMode: "30_days" }))
              }
              className={`exp-mode-btn ${reviewForm.expirationMode === "30_days" ? "is-selected" : ""}`}
            >
              +30 dias
            </button>
            <button
              type="button"
              onClick={() =>
                setReviewForm((f) => ({ ...f, expirationMode: "custom" }))
              }
              className={`exp-mode-btn ${reviewForm.expirationMode === "custom" ? "is-selected" : ""}`}
            >
              Data
            </button>
            {reviewForm.expirationMode === "custom" ? (
              <input
                type="date"
                value={reviewForm.customExpirationDate}
                onChange={(e) =>
                  setReviewForm((f) => ({ ...f, customExpirationDate: e.target.value }))
                }
                className="scanner-input exp-date-inline font-mono"
              />
            ) : null}
          </div>

          <div className="review-actions-row">
            <button
              type="button"
              onClick={() => setReviewOpen(false)}
              className="btn-review-dismiss"
            >
              Fechar
            </button>
            <button
              type="submit"
              id="btn-save-review-form"
              disabled={reviewSaving}
              className="btn-review-save"
            >
              <Save size={15} />
              <span>{reviewSaving ? "Salvando..." : "Salvar Cadastro"}</span>
            </button>
          </div>
        </form>
      ) : null}

      {/* PAINEL RÁPIDO LOGO ABAIXO DO LEITOR: Quantidade, Preço Unitário, Fardo e Categoria na Hora */}
      <div className="quick-entry-dock" aria-label="Preenchimento Rápido de Quantidade, Preço, Fardo e Categoria">
        <div className="quick-dock-header">
          <div className="quick-dock-title">
            <Package size={15} />
            <span>Preenchimento Rápido para Leitura</span>
          </div>
          <label className="ocr-toggle-label">
            <input
              type="checkbox"
              checked={resetQuantityAfterScan}
              onChange={(e) => setResetQuantityAfterScan(e.target.checked)}
            />
            <span>Voltar Qtd p/ 1 após bipar</span>
          </label>
        </div>

        {/* Linha 1: Quantidade + Preço de Venda Unitário + Preço de Custo Unitário */}
        <div className="quick-qty-price-grid">
          <div className="input-group">
            <label htmlFor="input-quick-qty">Quantidade</label>
            <div className="qty-input-stepper">
              <button
                type="button"
                id="btn-quick-qty-minus"
                onClick={() => handleStepScanQty(-1)}
                className="qty-step-btn"
                aria-label="Diminuir quantidade"
              >
                <Minus size={15} />
              </button>
              <input
                id="input-quick-qty"
                type="text"
                inputMode="decimal"
                value={scanQuantity}
                onChange={(e) => setScanQuantity(e.target.value)}
                className="qty-numeric-input font-mono"
              />
              <button
                type="button"
                id="btn-quick-qty-plus"
                onClick={() => handleStepScanQty(1)}
                className="qty-step-btn"
                aria-label="Aumentar quantidade"
              >
                <Plus size={15} />
              </button>
            </div>
            <div className="mini-presets-row">
              {QUICK_QTY_PRESETS.map((q) => (
                <button
                  key={q}
                  type="button"
                  onClick={() => setScanQuantity(String(q))}
                  className={`mini-chip-btn ${parsedScanQty === q ? "is-selected" : ""}`}
                >
                  {q}x
                </button>
              ))}
            </div>
          </div>

          <div className="input-group">
            <label htmlFor="input-quick-unit-cost">Custo Unitário (R$)</label>
            <input
              id="input-quick-unit-cost"
              type="text"
              inputMode="decimal"
              placeholder={packUnitCost.formatted ? `Fardo: ${packUnitCost.formatted}` : "Auto ou fardo"}
              value={manualUnitCost}
              onChange={(e) => setManualUnitCost(e.target.value)}
              className="scanner-input font-mono"
            />
            <span className="field-helper-text">
              {packUnitCost.formatted
                ? `Calculado pelo fardo: R$ ${packUnitCost.formatted}`
                : "Ou use o cálculo do fardo abaixo"}
            </span>
          </div>

          <div className="input-group">
            <label htmlFor="input-quick-sale-price">Preço Unitário Venda (R$)</label>
            <input
              id="input-quick-sale-price"
              type="text"
              inputMode="decimal"
              placeholder={
                lockedPrice
                  ? `Travado: ${lockedPrice}`
                  : suggestedSaleFromMargin.formatted
                    ? `Sug.: ${suggestedSaleFromMargin.formatted}`
                    : detectedPriceCandidates[0]?.formatted
                      ? `OCR: ${detectedPriceCandidates[0].formatted}`
                      : "Ex: 8,90"
              }
              value={manualSalePrice}
              onChange={(e) => setManualSalePrice(e.target.value)}
              className="scanner-input font-mono"
            />
            <span className="field-helper-text">
              {currentMarginPercent !== null ? (
                <span className="margin-badge-inline">
                  Margem real: <strong>{currentMarginPercent > 0 ? `+${currentMarginPercent}%` : `${currentMarginPercent}%`}</strong>
                </span>
              ) : (
                "Vazio = usa OCR/catálogo"
              )}
            </span>
          </div>
        </div>

        {/* Linha 2: Calculadora de Fardo / Caixa -> Custo Unitário e Sugestão de Venda */}
        <div className="pack-calc-box">
          <div className="pack-calc-header">
            <button
              type="button"
              id="btn-toggle-pack-calc"
              onClick={() => setShowPackCalculator((v) => !v)}
              className="pack-calc-toggle"
            >
              <Calculator size={15} />
              <span>Calcular Custo & Venda pelo Fardo / Caixa</span>
              <span className="pack-chevron">{showPackCalculator ? "Ocultar" : "Abrir"}</span>
            </button>
            {packUnitCost.formatted ? (
              <span className="pack-result-pill">
                Custo/un: <strong>R$ {packUnitCost.formatted}</strong>
              </span>
            ) : null}
          </div>

          {showPackCalculator ? (
            <div className="pack-calc-body">
              <div className="pack-inputs-grid">
                <div className="input-group">
                  <label htmlFor="input-pack-price">Preço pago no Fardo (R$)</label>
                  <input
                    id="input-pack-price"
                    type="text"
                    inputMode="decimal"
                    placeholder="Ex: 48,00"
                    value={packPriceInput}
                    onChange={(e) => handlePackPriceOrQtyChange(e.target.value, packQtyInput)}
                    className="scanner-input font-mono"
                  />
                </div>

                <div className="input-group">
                  <label htmlFor="input-pack-qty">Qtd no Fardo (unid.)</label>
                  <input
                    id="input-pack-qty"
                    type="text"
                    inputMode="numeric"
                    placeholder="Ex: 12"
                    value={packQtyInput}
                    onChange={(e) => handlePackPriceOrQtyChange(packPriceInput, e.target.value)}
                    className="scanner-input font-mono"
                  />
                </div>

                <div className="input-group">
                  <label htmlFor="input-pack-margin">Margem p/ Venda (%)</label>
                  <input
                    id="input-pack-margin"
                    type="text"
                    inputMode="decimal"
                    placeholder="35"
                    value={marginPercentInput}
                    onChange={(e) => handleMarginChange(e.target.value)}
                    className="scanner-input font-mono"
                  />
                </div>
              </div>

              <div className="pack-actions-strip">
                <div className="mini-presets-row">
                  <span className="presets-label">Margem rápida:</span>
                  {MARGIN_PRESETS.map((m) => (
                    <button
                      key={m}
                      type="button"
                      onClick={() => handleMarginChange(String(m))}
                      className={`mini-chip-btn amber ${Number(marginPercentInput) === m ? "is-selected" : ""}`}
                    >
                      +{m}%
                    </button>
                  ))}
                </div>

                {parsedPackQty ? (
                  <button
                    type="button"
                    id="btn-use-pack-qty-stock"
                    onClick={() => setScanQuantity(String(parsedPackQty))}
                    className="btn-use-pack-qty"
                  >
                    Jogar {parsedPackQty} un. na Quantidade
                  </button>
                ) : null}
              </div>

              {packUnitCost.formatted ? (
                <div className="pack-summary-line">
                  <span>
                    Fardo R$ {packPriceInput} ÷ {packQtyInput} un ={" "}
                    <strong className="text-emerald">Custo R$ {packUnitCost.formatted}</strong>
                  </span>
                  {suggestedSaleFromMargin.formatted ? (
                    <span>
                      · Sugestão (+{marginPercentInput || 0}%):{" "}
                      <strong className="text-amber">Venda R$ {suggestedSaleFromMargin.formatted}</strong>
                    </span>
                  ) : null}
                </div>
              ) : null}
            </div>
          ) : null}
        </div>

        {/* Linha 3: Selecionar ou Criar Categoria na Hora */}
        <div className="category-instant-box">
          <div className="category-select-row">
            <div className="input-group category-select-wrap">
              <label htmlFor="select-instant-category">Categoria do Produto (selecionar na hora)</label>
              <select
                id="select-instant-category"
                value={selectedCategory}
                onChange={(e) => setSelectedCategory(e.target.value)}
                className="scanner-select"
              >
                <option value="">Automática (identificar pelo código de barras)</option>
                {categories.map((cat) => (
                  <option key={cat} value={cat}>
                    {cat}
                  </option>
                ))}
              </select>
            </div>

            <button
              type="button"
              id="btn-toggle-new-category"
              onClick={() => setShowNewCategoryForm((v) => !v)}
              className={`btn-new-category ${showNewCategoryForm ? "is-active" : ""}`}
            >
              <FolderPlus size={16} />
              <span>Nova Categoria</span>
            </button>
          </div>

          {showNewCategoryForm ? (
            <form onSubmit={handleCreateCategoryInline} className="new-category-inline-form">
              <input
                id="input-new-category-name"
                type="text"
                placeholder="Nome da nova categoria (ex: Bomboniere, Frios, Padaria...)"
                value={newCategoryName}
                onChange={(e) => setNewCategoryName(e.target.value)}
                className="scanner-input"
              />
              <button
                type="submit"
                id="btn-confirm-new-category"
                disabled={!newCategoryName.trim() || creatingCategory}
                className="btn-create-category-confirm"
              >
                {creatingCategory ? "Criando..." : "Criar & Selecionar"}
              </button>
            </form>
          ) : null}
        </div>

        {/* Linha 4: Data de Vencimento (Nulo, +30 dias ou Data Específica) */}
        <div className="expiration-instant-box">
          <div className="expiration-header-row">
            <span className="expiration-label">
              <Calendar size={14} />
              <span>Validade / Data de Vencimento:</span>
            </span>
            <span className="expiration-preview-badge">
              {effectiveExpirationDate
                ? `Vence em ${formatExpirationPtBr(effectiveExpirationDate)}`
                : "Sem vencimento (Nulo)"}
            </span>
          </div>

          <div className="expiration-modes-row">
            <button
              type="button"
              id="btn-exp-none"
              onClick={() => setExpirationMode("none")}
              className={`exp-mode-btn ${expirationMode === "none" ? "is-selected" : ""}`}
            >
              Sem vencimento (Nulo)
            </button>

            <button
              type="button"
              id="btn-exp-30d"
              onClick={() => setExpirationMode("30_days")}
              className={`exp-mode-btn ${expirationMode === "30_days" ? "is-selected" : ""}`}
            >
              +30 dias ({formatExpirationPtBr(addDaysIsoDate(30))})
            </button>

            <button
              type="button"
              id="btn-exp-custom"
              onClick={() => setExpirationMode("custom")}
              className={`exp-mode-btn ${expirationMode === "custom" ? "is-selected" : ""}`}
            >
              Escolher Data
            </button>

            {expirationMode === "custom" ? (
              <input
                id="input-custom-expiration-date"
                type="date"
                value={customExpirationDate}
                onChange={(e) => setCustomExpirationDate(e.target.value)}
                className="scanner-input exp-date-input font-mono"
              />
            ) : null}
          </div>
        </div>
      </div>

      {/* Feedback imediato da última leitura contabilizada + botão para aplicar valores nela */}
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
                    ? "QTD & PREÇO ATUALIZADOS"
                    : lastCaptureResult.action === "incremented"
                      ? `CONTABILIZADO (TOTAL: ${lastCaptureResult.item.productQnt} UN)`
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
                Custo: <strong>R$ {lastCaptureResult.item.productUnitPrice}</strong>
              </span>
              <span>
                Qtd: <strong>{lastCaptureResult.item.productQnt}</strong>
              </span>
              <span>
                Categoria: <strong>{lastCaptureResult.item.productCategory}</strong>
              </span>
              <span>
                Vencimento:{" "}
                <strong>
                  {lastCaptureResult.item.expirationDate
                    ? formatExpirationPtBr(lastCaptureResult.item.expirationDate)
                    : "Nulo"}
                </strong>
              </span>
            </div>
            {onApplyValuesToLastItem ? (
              <div className="last-capture-actions">
                <button
                  type="button"
                  id="btn-open-review-last"
                  onClick={openReviewForLastItem}
                  className="btn-apply-last"
                >
                  Editar Nome / Preço / Vencimento
                </button>
                <button
                  type="button"
                  id="btn-apply-to-last-item"
                  disabled={applyingToLast}
                  onClick={handleApplyToLastCaptured}
                  className="btn-apply-last secondary"
                >
                  {applyingToLast
                    ? "Atualizando..."
                    : "Aplicar campos acima"}
                </button>
              </div>
            ) : null}
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
              Nenhum preço travado (usará o preço digitado, do frame atual ou do catálogo)
            </span>
          ) : (
            detectedPriceCandidates.map((cand) => {
              const isLocked = lockedPrice === cand.formatted;
              return (
                <button
                  key={cand.formatted}
                  type="button"
                  onClick={() => {
                    const next = isLocked ? "" : cand.formatted;
                    setLockedPrice(next);
                    if (next) setManualSalePrice(next);
                  }}
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
              Somar quantidade e atualizar preço
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

      {/* Prateleira Rápida de Produtos de Mercadinho */}
      <div className="quick-shelf-drawer">
        <div className="quick-shelf-header">
          <span>
            Simulador de Gôndola · Toque num item para disparar captura em{" "}
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

      {/* Pesquisa de Produto na Internet pelo Nome / Marca para já preencher */}
      <div className="internet-search-box">
        <div className="internet-search-header">
          <Globe size={15} />
          <span>Pesquisar Produto na Internet (por Nome ou Marca) para já preencher:</span>
        </div>

        <form onSubmit={handleInternetSearch} className="internet-search-form">
          <input
            id="input-internet-search"
            type="text"
            placeholder="Ex: Coca Cola, Detergente Ypê, Shampoo Dove, Arroz Camil..."
            value={internetSearchQuery}
            onChange={(e) => setInternetSearchQuery(e.target.value)}
            className="scanner-input"
          />
          <button
            type="submit"
            id="btn-internet-search"
            disabled={internetSearchQuery.trim().length < 2 || isSearchingInternet}
            className="btn-internet-search"
          >
            <Search size={15} />
            <span>{isSearchingInternet ? "Buscando..." : "Pesquisar"}</span>
          </button>
        </form>

        {internetResults.length > 0 ? (
          <div className="internet-results-list" role="region" aria-label="Resultados da Internet">
            {internetResults.map((res, idx) => (
              <div key={`${res.barcode}-${idx}`} className="internet-result-card">
                {res.productImageUrl ? (
                  <img
                    src={res.productImageUrl}
                    alt={res.productName}
                    className="internet-result-thumb"
                    loading="lazy"
                  />
                ) : (
                  <div className="internet-result-thumb placeholder">
                    <Package size={18} />
                  </div>
                )}

                <div className="internet-result-info">
                  <strong>{res.productName}</strong>
                  <div className="internet-result-meta">
                    {res.barcode ? <span className="item-ean-badge">{res.barcode}</span> : null}
                    <span className="item-category-badge">{res.productCategory}</span>
                    <span className="internet-source-tag">{res.source}</span>
                  </div>
                </div>

                <div className="internet-result-actions">
                  <button
                    type="button"
                    onClick={() => applyInternetResult(res, false)}
                    className="btn-fill-from-web"
                  >
                    Preencher
                  </button>
                  <button
                    type="button"
                    onClick={() => applyInternetResult(res, true)}
                    className="btn-capture-from-web"
                  >
                    + Lançar
                  </button>
                </div>
              </div>
            ))}
          </div>
        ) : internetSearchDone && !isSearchingInternet ? (
          <p className="internet-empty-msg">
            Nenhum produto encontrado para &ldquo;{internetSearchQuery}&rdquo;. Tente outro nome ou
            marca.
          </p>
        ) : null}
      </div>

      {/* Entrada Manual Rápida por Código de Barras */}
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
              : `Capturar (${parsedScanQty}x)${selectedCategory ? ` · ${selectedCategory}` : ""}`}
          </span>
        </button>
      </form>
    </section>
  );
}
