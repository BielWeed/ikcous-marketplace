import { motion } from "framer-motion";
import {
  AlertCircle,
  Check,
  Info,
  RotateCw,
  Sparkles,
  X,
  ZoomIn,
  ZoomOut,
} from "lucide-react";
import type React from "react";
import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { toast } from "sonner";

export type AspectRatioPreset = "4:5" | "1:1" | "2:1" | "4:1" | "free";

export interface ImageAdjusterProps {
  isOpen: boolean;
  onClose: () => void;
  imageUrl: string;
  onConfirm: (croppedBlob: Blob) => Promise<void>;
  isSubmitting?: boolean;
  allowedPresets?: AspectRatioPreset[];
  defaultPreset?: AspectRatioPreset;
}

const PRESET_LABELS: Record<AspectRatioPreset, string> = {
  "4:5": "Vitrine (4:5)",
  "1:1": "Detalhe (1:1)",
  "2:1": "Celular (2:1)",
  "4:1": "Desktop (4:1)",
  free: "Livre",
};

export function ImageAdjuster({
  isOpen,
  onClose,
  imageUrl,
  onConfirm,
  isSubmitting = false,
  allowedPresets,
  defaultPreset,
}: ImageAdjusterProps) {
  const presets = allowedPresets || ["4:5", "1:1", "free"];
  const [aspectRatio, setAspectRatio] = useState<AspectRatioPreset>(() => {
    if (defaultPreset && presets.includes(defaultPreset)) return defaultPreset;
    return presets[0];
  });
  const [zoom, setZoom] = useState(1);
  const [rotation, setRotation] = useState<0 | 90 | 180 | 270>(0);
  const [isDragging, setIsDragging] = useState(false);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const [imageSize, setImageSize] = useState({
    width: 0,
    height: 0,
    naturalWidth: 0,
    naturalHeight: 0,
  });
  const [loading, setLoading] = useState(true);
  const [qualityScore, setQualityScore] = useState<{
    score: "excellent" | "good" | "low";
    details: string;
  }>({ score: "good", details: "" });

  const containerRef = useRef<HTMLDivElement>(null);
  const imageRef = useRef<HTMLImageElement>(null);
  const dragStart = useRef({ x: 0, y: 0 });
  const initialOffset = useRef({ x: 0, y: 0 });

  // Viewport sizes for the crop frame (in pixels)
  const getViewportDimensions = useCallback(() => {
    const maxWidth = 300;
    const maxHeight = 375;

    if (aspectRatio === "4:5") {
      return { width: maxWidth, height: maxHeight };
    }
    if (aspectRatio === "1:1") {
      return { width: maxWidth, height: maxWidth };
    }
    if (aspectRatio === "2:1") {
      return { width: maxWidth, height: maxWidth / 2 };
    }
    if (aspectRatio === "4:1") {
      return { width: maxWidth, height: maxWidth / 4 };
    }
    // Freeform/Original aspect ratio helper
    if (imageSize.naturalWidth && imageSize.naturalHeight) {
      const imgAspect = imageSize.naturalWidth / imageSize.naturalHeight;
      if (imgAspect > 1) {
        // landscape
        return { width: maxWidth, height: maxWidth / imgAspect };
      }
      // portrait
      return { width: maxHeight * imgAspect, height: maxHeight };
    }
    return { width: maxWidth, height: maxWidth };
  }, [aspectRatio, imageSize.naturalWidth, imageSize.naturalHeight]);

  const { width: viewportWidth, height: viewportHeight } =
    getViewportDimensions();

  // Calculate base scale to cover viewport
  const getBaseScale = useCallback(() => {
    if (!imageSize.naturalWidth || !imageSize.naturalHeight) return 1;

    // Rotate checks - swap width/height if rotated 90 or 270 deg
    const rotated = rotation === 90 || rotation === 270;
    const w = rotated ? imageSize.naturalHeight : imageSize.naturalWidth;
    const h = rotated ? imageSize.naturalWidth : imageSize.naturalHeight;

    const scaleX = viewportWidth / w;
    const scaleY = viewportHeight / h;

    // Cover the viewport
    return Math.max(scaleX, scaleY);
  }, [
    imageSize.naturalWidth,
    imageSize.naturalHeight,
    viewportWidth,
    viewportHeight,
    rotation,
  ]);

  const baseScale = getBaseScale();
  const currentScale = baseScale * zoom;

  // Reset positioning when image, aspect ratio or rotation changes
  useEffect(() => {
    if (!loading && imageSize.naturalWidth) {
      setZoom(1);

      const rotated = rotation === 90 || rotation === 270;
      const w =
        (rotated ? imageSize.naturalHeight : imageSize.naturalWidth) *
        baseScale;
      const h =
        (rotated ? imageSize.naturalWidth : imageSize.naturalHeight) *
        baseScale;

      setOffset({
        x: (viewportWidth - w) / 2,
        y: (viewportHeight - h) / 2,
      });
    }
  }, [
    aspectRatio,
    rotation,
    loading,
    imageSize.naturalWidth,
    imageSize.naturalHeight,
    viewportWidth,
    viewportHeight,
    baseScale,
  ]);

  // Handle image load to check natural sizes and quality
  const handleImageLoad = (e: React.SyntheticEvent<HTMLImageElement>) => {
    const img = e.currentTarget;
    const naturalWidth = img.naturalWidth;
    const naturalHeight = img.naturalHeight;

    setImageSize({
      width: img.width,
      height: img.height,
      naturalWidth,
      naturalHeight,
    });

    // Quality evaluation
    const resolution = naturalWidth * naturalHeight;
    let score: "excellent" | "good" | "low" = "good";
    let details = "Proporção recomendada. Detalhes nítidos.";

    if (resolution < 500 * 500) {
      score = "low";
      details =
        "Baixa resolução. Recomendado enviar imagens maiores que 800px para evitar borrões.";
    } else if (resolution >= 1200 * 1200) {
      score = "excellent";
      details =
        "Excelente resolução! Imagem perfeita para zoom em alta definição na galeria.";
    } else {
      score = "good";
      details = "Resolução adequada. Imagem nítida.";
    }

    setQualityScore({ score, details });
    setLoading(false);
  };

  // Bounds enforcement helper
  const clampOffset = useCallback(
    (x: number, y: number, currentZoom: number) => {
      const scale = baseScale * currentZoom;
      const rotated = rotation === 90 || rotation === 270;
      const w =
        (rotated ? imageSize.naturalHeight : imageSize.naturalWidth) * scale;
      const h =
        (rotated ? imageSize.naturalWidth : imageSize.naturalHeight) * scale;

      let minX = viewportWidth - w;
      let maxX = 0;
      let minY = viewportHeight - h;
      let maxY = 0;

      // If image is smaller than viewport (shouldn't happen with cover scale, but just in case)
      if (minX > 0) {
        minX = minX / 2;
        maxX = minX;
      }
      if (minY > 0) {
        minY = minY / 2;
        maxY = minY;
      }

      return {
        x: Math.max(minX, Math.min(maxX, x)),
        y: Math.max(minY, Math.min(maxY, y)),
      };
    },
    [
      baseScale,
      rotation,
      imageSize.naturalWidth,
      imageSize.naturalHeight,
      viewportWidth,
      viewportHeight,
    ],
  );

  // Dragging event handlers
  const handleStart = (clientX: number, clientY: number) => {
    if (loading) return;
    setIsDragging(true);
    dragStart.current = { x: clientX, y: clientY };
    initialOffset.current = { ...offset };
  };

  const handleMove = (clientX: number, clientY: number) => {
    if (!isDragging) return;
    const dx = clientX - dragStart.current.x;
    const dy = clientY - dragStart.current.y;

    const newX = initialOffset.current.x + dx;
    const newY = initialOffset.current.y + dy;

    const clamped = clampOffset(newX, newY, zoom);
    setOffset(clamped);
  };

  const handleEnd = () => {
    setIsDragging(false);
  };

  // Handle mouse events
  const handleMouseDown = (e: React.MouseEvent) => {
    e.preventDefault();
    handleStart(e.clientX, e.clientY);
  };

  const handleMouseMove = (e: React.MouseEvent) => {
    handleMove(e.clientX, e.clientY);
  };

  // Handle touch events (mobile friendly)
  const handleTouchStart = (e: React.TouchEvent) => {
    if (e.touches.length === 1) {
      handleStart(e.touches[0].clientX, e.touches[0].clientY);
    }
  };

  const handleTouchMove = (e: React.TouchEvent) => {
    if (e.touches.length === 1) {
      handleMove(e.touches[0].clientX, e.touches[0].clientY);
    }
  };

  // Rotation
  const rotateImage = () => {
    setRotation((prev) => {
      if (prev === 0) return 90;
      if (prev === 90) return 180;
      if (prev === 180) return 270;
      return 0;
    });
  };

  // Zoom slider adjustment
  const handleZoomChange = (newZoom: number) => {
    setZoom(newZoom);
    // Recenter and clamp offsets after zoom changes
    setOffset((prev) => {
      const clamped = clampOffset(prev.x, prev.y, newZoom);
      return clamped;
    });
  };

  // Perform canvas cropping and submit
  const handleCrop = async () => {
    if (!imageRef.current || loading) return;

    try {
      const canvas = document.createElement("canvas");
      const ctx = canvas.getContext("2d");
      if (!ctx) throw new Error("Não foi possível obter contexto do canvas");

      const targetWidth = 1000;
      const targetHeight = Math.round(
        targetWidth * (viewportHeight / viewportWidth),
      );

      canvas.width = targetWidth;
      canvas.height = targetHeight;

      // Draw color background
      ctx.fillStyle = "#FFFFFF";
      ctx.fillRect(0, 0, targetWidth, targetHeight);

      // Load original image to canvas
      const img = new Image();
      img.crossOrigin = "anonymous"; // Avoid CORS issues

      const loadPromise = new Promise<void>((resolve, reject) => {
        img.onload = () => resolve();
        img.onerror = () =>
          reject(new Error("Falha ao recarregar imagem para corte"));
      });
      img.src = imageUrl;
      await loadPromise;

      // Draw the image onto canvas using rotation, scale and offset
      // Calculate scale relative to physical canvas size
      const scaleCanvas = targetWidth / viewportWidth;

      ctx.save();

      // Move to center of canvas for rotation and offset translation
      ctx.translate(targetWidth / 2, targetHeight / 2);
      ctx.rotate((rotation * Math.PI) / 180);

      // Calculate physical scale
      const physScale = baseScale * zoom * scaleCanvas;

      // Calculate physical offsets
      // Offset was relative to viewport top-left. Translate coordinates to canvas-center relative
      const rotated = rotation === 90 || rotation === 270;
      const displayW =
        (rotated ? imageSize.naturalHeight : imageSize.naturalWidth) *
        (baseScale * zoom);
      const displayH =
        (rotated ? imageSize.naturalWidth : imageSize.naturalHeight) *
        (baseScale * zoom);

      // Compute coordinates of the image's top-left in viewport coordinate system, relative to viewport center
      const viewCenterX = viewportWidth / 2;
      const viewCenterY = viewportHeight / 2;
      const imgLeftFromCenter = offset.x + displayW / 2 - viewCenterX;
      const imgTopFromCenter = offset.y + displayH / 2 - viewCenterY;

      // Convert these translations to canvas coordinates
      ctx.translate(
        imgLeftFromCenter * scaleCanvas,
        imgTopFromCenter * scaleCanvas,
      );

      // Now draw the image centered on this coordinate
      const imgDrawW = imageSize.naturalWidth * physScale;
      const imgDrawH = imageSize.naturalHeight * physScale;

      ctx.drawImage(img, -imgDrawW / 2, -imgDrawH / 2, imgDrawW, imgDrawH);
      ctx.restore();

      // Convert canvas to Blob
      canvas.toBlob(
        async (blob) => {
          if (blob) {
            await onConfirm(blob);
          } else {
            toast.error("Erro ao processar imagem final");
          }
        },
        "image/jpeg",
        0.92, // 92% JPEG quality (ideal for web/PWA loading speed vs quality)
      );
    } catch (error) {
      console.error("Error cropping image:", error);
      toast.error("Erro ao recortar a imagem. Tente novamente.");
    }
  };

  // Lock body scroll when adjuster is open
  useEffect(() => {
    if (isOpen) {
      const originalOverflow = document.body.style.overflow;
      document.body.style.overflow = "hidden";
      return () => {
        document.body.style.overflow = originalOverflow;
      };
    }
  }, [isOpen]);

  if (!isOpen) return null;
  if (typeof document === "undefined") return null;

  return createPortal(
    <div className="fixed inset-0 z-[130] flex items-center justify-center bg-zinc-950/80 p-2 backdrop-blur-xl sm:p-4">
      <motion.div
        initial={{ opacity: 0, scale: 0.95, y: 20 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        className="relative flex max-h-[95vh] w-full max-w-lg flex-col overflow-hidden rounded-3xl border border-white/10 bg-zinc-950 shadow-[0_20px_50px_rgba(0,0,0,0.8)] md:max-h-[90vh] md:rounded-[2.5rem]"
      >
        {/* Header */}
        <div className="flex items-center justify-between border-b border-white/5 bg-zinc-900/50 px-6 py-4 md:px-8 md:py-6">
          <div className="flex items-center gap-3">
            <div className="flex size-8 items-center justify-center rounded-lg border border-emerald-500/20 bg-emerald-500/10">
              <Sparkles className="size-4 text-emerald-400" />
            </div>
            <div>
              <h3 className="text-sm font-black uppercase tracking-wider text-white">
                Ajustar e Cortar Imagem
              </h3>
              <p className="mt-0.5 text-[10px] font-bold uppercase tracking-widest text-zinc-500">
                Enquadramento ideal para o PWA
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="rounded-full p-2 text-zinc-400 transition-all hover:bg-white/5 hover:text-white active:scale-95"
            disabled={isSubmitting}
          >
            <X className="size-5" />
          </button>
        </div>

        {/* Workspace Content */}
        <div className="flex flex-1 flex-col items-center space-y-4 overflow-y-auto p-4 md:space-y-6 md:p-6">
          {/* Quality Indicator Banner */}
          {!loading && (
            <div
              className={`flex w-full max-w-sm items-start gap-3 rounded-2xl border p-3 text-xs font-medium transition-colors md:p-4 ${
                qualityScore.score === "excellent"
                  ? "border-emerald-500/20 bg-emerald-500/5 text-emerald-400"
                  : qualityScore.score === "good"
                    ? "border-blue-500/20 bg-blue-500/5 text-blue-400"
                    : "border-amber-500/20 bg-amber-500/5 text-amber-400"
              }`}
            >
              <Info className="mt-0.5 size-4 flex-shrink-0" />
              <div>
                <span className="mb-1 block text-[9px] font-black uppercase tracking-wider">
                  Resolução: {imageSize.naturalWidth} x{" "}
                  {imageSize.naturalHeight} (
                  {qualityScore.score === "excellent"
                    ? "Excelente"
                    : qualityScore.score === "good"
                      ? "Boa"
                      : "Baixa"}
                  )
                </span>
                <p className="text-[11px] leading-relaxed text-zinc-400">
                  {qualityScore.details}
                </p>
              </div>
            </div>
          )}

          {/* Canvas/Editor Frame Container */}
          {/* eslint-disable-next-line jsx-a11y/no-noninteractive-element-interactions */}
          <div
            ref={containerRef}
            role="application"
            aria-label="Ajustador de imagem: clique e arraste para posicionar"
            className="relative flex aspect-[4/5] w-full max-w-sm cursor-move items-center justify-center overflow-hidden rounded-3xl border border-white/5 bg-zinc-900 shadow-inner"
            onMouseDown={handleMouseDown}
            onMouseMove={handleMouseMove}
            onMouseUp={handleEnd}
            onMouseLeave={handleEnd}
            onTouchStart={handleTouchStart}
            onTouchMove={handleTouchMove}
            onTouchEnd={handleEnd}
          >
            {loading && (
              <div className="absolute inset-0 z-20 flex flex-col items-center justify-center gap-3 bg-zinc-950/80">
                <span className="border-3 size-8 animate-spin rounded-full border-emerald-500/30 border-t-emerald-500" />
                <span className="text-[10px] font-black uppercase tracking-widest text-zinc-400">
                  Carregando Imagem...
                </span>
              </div>
            )}

            {/* Crop Boundary Overlays (Shade masks) */}
            {!loading && (
              <>
                {/* Semi-transparent dark mask overlay around the viewport */}
                <div className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center bg-black/60">
                  <div
                    className="relative overflow-hidden rounded-2xl border-2 border-emerald-500/80 shadow-[0_0_0_9999px_rgba(0,0,0,0.7)]"
                    style={{
                      width: viewportWidth,
                      height: viewportHeight,
                      transition: "width 0.3s ease-out, height 0.3s ease-out",
                    }}
                  >
                    {/* Grid Lines helper */}
                    <div className="pointer-events-none absolute inset-0 grid grid-cols-3 grid-rows-3 opacity-20">
                      <div className="col-span-1 border-r border-dashed border-white" />
                      <div className="col-span-1 border-r border-dashed border-white" />
                      <div className="absolute inset-x-0 top-1/3 col-span-3 row-span-1 border-b border-dashed border-white" />
                      <div className="absolute inset-x-0 top-2/3 col-span-3 row-span-1 border-b border-dashed border-white" />
                    </div>
                  </div>
                </div>
              </>
            )}

            {/* Editable Image */}
            <img
              ref={imageRef}
              src={imageUrl}
              alt="Ajuste"
              onLoad={handleImageLoad}
              className="pointer-events-none absolute max-w-none origin-center select-none"
              style={{
                transform: `translate(${offset.x}px, ${offset.y}px) rotate(${rotation}deg) scale(${currentScale})`,
                opacity: loading ? 0 : 1,
                transition: isDragging ? "none" : "transform 0.15s ease-out",
              }}
            />
          </div>

          {/* Controls Panel */}
          <div className="w-full max-w-sm space-y-4 rounded-3xl border border-white/5 bg-zinc-900/40 p-4 md:space-y-5 md:p-5">
            {/* Presets Selectors */}
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-[9px] font-black uppercase tracking-widest text-zinc-500">
                  Enquadramento / Proporção
                </span>
                <span className="animate-pulse text-[8px] font-bold uppercase tracking-wider text-emerald-400">
                  Vitrine (4:5) é recomendado
                </span>
              </div>
              <div className="flex flex-wrap gap-2">
                {presets.map((preset) => (
                  <button
                    key={preset}
                    type="button"
                    onClick={() => setAspectRatio(preset)}
                    className={`min-w-[80px] flex-1 rounded-xl border py-2 text-[10px] font-black uppercase tracking-wider transition-all active:scale-95 ${
                      aspectRatio === preset
                        ? "border-emerald-400 bg-emerald-500 text-emerald-950 shadow-lg shadow-emerald-500/10"
                        : "border-white/5 bg-zinc-950/50 text-zinc-400 hover:bg-zinc-900 hover:text-white"
                    }`}
                  >
                    {PRESET_LABELS[preset]}
                  </button>
                ))}
              </div>
            </div>

            {/* Zoom Slider */}
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <label
                  htmlFor="zoom-slider"
                  className="text-[9px] font-black uppercase tracking-widest text-zinc-500"
                >
                  Zoom da Imagem
                </label>
                <span className="text-[10px] font-black text-zinc-400">
                  {Math.round(zoom * 100)}%
                </span>
              </div>
              <div className="flex items-center gap-3">
                <button
                  type="button"
                  onClick={() => handleZoomChange(Math.max(1, zoom - 0.25))}
                  className="rounded-xl border border-white/5 bg-zinc-950 p-2 text-zinc-400 transition-all hover:bg-zinc-900 hover:text-white active:scale-90"
                >
                  <ZoomOut className="size-3.5" />
                </button>

                <input
                  id="zoom-slider"
                  type="range"
                  min="1"
                  max="3"
                  step="0.01"
                  value={zoom}
                  onChange={(e) =>
                    handleZoomChange(Number.parseFloat(e.target.value))
                  }
                  className="h-1 flex-1 cursor-pointer appearance-none rounded-lg bg-zinc-950 accent-emerald-500"
                />

                <button
                  type="button"
                  onClick={() => handleZoomChange(Math.min(3, zoom + 0.25))}
                  className="rounded-xl border border-white/5 bg-zinc-950 p-2 text-zinc-400 transition-all hover:bg-zinc-900 hover:text-white active:scale-90"
                >
                  <ZoomIn className="size-3.5" />
                </button>
              </div>
            </div>

            {/* Rotator */}
            <div className="flex items-center justify-between border-t border-white/5 pt-1">
              <span className="text-[9px] font-black uppercase tracking-widest text-zinc-500">
                Rotacionar Imagem
              </span>
              <button
                type="button"
                onClick={rotateImage}
                className="flex items-center gap-2 rounded-xl border border-white/5 bg-zinc-950 px-3 py-1.5 text-[10px] font-black uppercase tracking-widest text-zinc-300 transition-all hover:bg-zinc-900 active:scale-95"
              >
                <RotateCw className="size-3.5" />
                90° graus
              </button>
            </div>
          </div>
        </div>

        {/* Footer actions */}
        <div className="flex items-center justify-between border-t border-white/5 bg-zinc-900/50 px-6 py-4 md:px-8 md:py-6">
          <div className="flex items-center gap-2 text-[10px] font-medium text-zinc-500">
            <AlertCircle className="size-3.5 text-zinc-500" />
            <span>O corte definitivo será processado e enviado.</span>
          </div>

          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={onClose}
              disabled={isSubmitting}
              className="rounded-2xl border border-white/5 bg-zinc-950 px-5 py-3 text-xs font-black uppercase tracking-widest text-zinc-400 transition-all hover:border-white/10 hover:bg-zinc-900 hover:text-white active:scale-95"
            >
              Cancelar
            </button>
            <button
              type="button"
              onClick={handleCrop}
              disabled={isSubmitting || loading}
              className="flex items-center gap-2 rounded-2xl bg-emerald-500 px-6 py-3 text-xs font-black uppercase tracking-widest text-emerald-950 shadow-lg shadow-emerald-500/10 transition-all hover:bg-emerald-400 hover:shadow-emerald-500/20 active:scale-95 disabled:bg-zinc-800 disabled:text-zinc-600 disabled:shadow-none"
            >
              {isSubmitting ? (
                <>
                  <span className="size-4 animate-spin rounded-full border-2 border-emerald-950/30 border-t-emerald-950" />
                  Salvando...
                </>
              ) : (
                <>
                  <Check className="size-4" />
                  Salvar Ajuste
                </>
              )}
            </button>
          </div>
        </div>
      </motion.div>
    </div>,
    document.body,
  );
}
