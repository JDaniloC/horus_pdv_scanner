/**
 * Arquivo: src/utils/soundEffects.ts
 * Objetivo: Emite bipes sonoros estilo leitor de supermercado via Web Audio API e vibração háptica
 *           ao capturar códigos de barras e preços no celular.
 */

let audioCtx: AudioContext | null = null;

function getAudioContext(): AudioContext | null {
  if (typeof window === "undefined") return null;
  if (!audioCtx) {
    const AudioContextClass =
      window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (AudioContextClass) {
      audioCtx = new AudioContextClass();
    }
  }
  if (audioCtx && audioCtx.state === "suspended") {
    audioCtx.resume().catch(() => {});
  }
  return audioCtx;
}

export function playScannerBeep(type: "created" | "incremented" | "price_updated" | "error" = "created"): void {
  try {
    if (typeof navigator !== "undefined" && "vibrate" in navigator) {
      if (type === "error") {
        navigator.vibrate([70, 40, 70]);
      } else {
        navigator.vibrate(45);
      }
    }

    const ctx = getAudioContext();
    if (!ctx) return;

    const osc = ctx.createOscillator();
    const gain = ctx.createGain();

    osc.connect(gain);
    gain.connect(ctx.destination);

    const now = ctx.currentTime;

    if (type === "created") {
      // Bipe clássico de scanner laser de supermercado (2400Hz curto e limpo)
      osc.type = "sine";
      osc.frequency.setValueAtTime(2350, now);
      gain.gain.setValueAtTime(0.14, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.09);
      osc.start(now);
      osc.stop(now + 0.095);
    } else if (type === "incremented") {
      // Duplo bipe ascendente para item somado (+1)
      osc.type = "sine";
      osc.frequency.setValueAtTime(1950, now);
      osc.frequency.setValueAtTime(2600, now + 0.055);
      gain.gain.setValueAtTime(0.13, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.12);
      osc.start(now);
      osc.stop(now + 0.125);
    } else if (type === "price_updated") {
      // Acorde rápido para confirmação de novo preço detectado
      osc.type = "triangle";
      osc.frequency.setValueAtTime(1760, now);
      osc.frequency.setValueAtTime(2637, now + 0.06);
      gain.gain.setValueAtTime(0.15, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.15);
      osc.start(now);
      osc.stop(now + 0.155);
    } else {
      osc.type = "sawtooth";
      osc.frequency.setValueAtTime(320, now);
      gain.gain.setValueAtTime(0.12, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.18);
      osc.start(now);
      osc.stop(now + 0.185);
    }
  } catch {
    // Silencia em navegadores que bloqueiam áudio sem interação prévia
  }
}
