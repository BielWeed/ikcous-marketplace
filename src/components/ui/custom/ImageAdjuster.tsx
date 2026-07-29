import { cn } from "@/lib/utils";
import { motion } from "framer-motion";
import {
  AlertCircle,
  ArrowLeft,
  Check,
  RotateCw,
  Sparkles,
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
  bannerPreview?: {
    title?: string;
    subtitle?: string;
    buttonText?: string;
    titleColor?: string;
    subtitleColor?: string;
    buttonBgColor?: string;
    buttonTextColor?: string;
    badgeText?: string;
    templateType?: string;
    fontFamily?: string;
    overlayColor?: string;
    overlayOpacity?: number;
    showTextOverlay?: boolean;
  };
}

const PRESET_LABELS: Record<AspectRatioPreset, string> = {
  "4:5": "Vitrine (4:5)",
  "1:1": "Detalhe (1:1)",
  "2:1": "Celular (2:1)",
  "4:1": "Desktop (4:1)",
  free: "Livre",
};

export interface ColorPreset {
  id: string;
  name: string;
  brightness: number;
  contrast: number;
  saturation: number;
  grayscale: number;
  sepia: number;
}

export const COLOR_PRESETS: ColorPreset[] = [
  {
    id: "original",
    name: "Original",
    brightness: 100,
    contrast: 100,
    saturation: 100,
    grayscale: 0,
    sepia: 0,
  },
  {
    id: "vivid",
    name: "Vívido",
    brightness: 105,
    contrast: 115,
    saturation: 125,
    grayscale: 0,
    sepia: 0,
  },
  {
    id: "ecommerce",
    name: "E-comm Pro",
    brightness: 110,
    contrast: 105,
    saturation: 102,
    grayscale: 0,
    sepia: 0,
  },
  {
    id: "warm",
    name: "Quente",
    brightness: 102,
    contrast: 98,
    saturation: 110,
    grayscale: 0,
    sepia: 15,
  },
  {
    id: "cool",
    name: "Frio",
    brightness: 100,
    contrast: 105,
    saturation: 90,
    grayscale: 0,
    sepia: 0,
  },
  {
    id: "mono",
    name: "P&B",
    brightness: 105,
    contrast: 120,
    saturation: 0,
    grayscale: 100,
    sepia: 0,
  },
];

const getCorsImageUrl = (url: string): string => {
  if (!url) return url;
  if (!url.startsWith("http://") && !url.startsWith("https://")) {
    return url;
  }
  try {
    const parsed = new URL(url);
    parsed.searchParams.set("cors", "true");
    return parsed.toString();
  } catch {
    return url;
  }
};

export interface ImageStats {
  luminance: number;
  contrast: number;
  vibrancy: number;
  exposureLabel: "dark" | "good" | "bright";
  contrastLabel: "low" | "good" | "high";
  vibrancyLabel: "flat" | "good" | "saturated";
  histogram: number[];
  isTainted: boolean;
}

const renderPresetIcon = (preset: AspectRatioPreset, isActive: boolean) => {
  const baseClass = cn(
    "border rounded transition-all duration-300",
    isActive
      ? "border-emerald-500 bg-emerald-500/20"
      : "border-zinc-800 bg-zinc-950/40",
  );

  switch (preset) {
    case "4:5":
      return <div className={cn(baseClass, "w-3 h-3.5")} />;
    case "1:1":
      return <div className={cn(baseClass, "w-3 h-3")} />;
    case "2:1":
      return <div className={cn(baseClass, "w-4.5 h-2.5")} />;
    case "4:1":
      return <div className={cn(baseClass, "w-6 h-1.5")} />;
    default:
      return (
        <div
          className={cn(
            baseClass,
            "w-4 h-3 border-dashed flex items-center justify-center",
          )}
        >
          <span className="scale-90 text-[6px] font-bold text-zinc-650">L</span>
        </div>
      );
  }
};

export function ImageAdjuster({
  isOpen,
  onClose,
  imageUrl,
  onConfirm,
  isSubmitting = false,
  allowedPresets,
  defaultPreset,
  bannerPreview,
}: ImageAdjusterProps) {
  const corsImageUrl = getCorsImageUrl(imageUrl);
  const presets = allowedPresets || ["4:5", "1:1"];
  const [aspectRatio, setAspectRatio] = useState<AspectRatioPreset>(() => {
    if (defaultPreset && presets.includes(defaultPreset)) return defaultPreset;
    return presets[0];
  });
  const [zoom, setZoom] = useState(1);
  const [showBannerSimulation, setShowBannerSimulation] = useState(true);
  const [rotation, setRotation] = useState<0 | 90 | 180 | 270>(0);
  const [isDragging, setIsDragging] = useState(false);
  const [isPinching, setIsPinching] = useState(false);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const [imageSize, setImageSize] = useState({
    width: 0,
    height: 0,
    naturalWidth: 0,
    naturalHeight: 0,
  });
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<"crop" | "filters" | "export">(
    "crop",
  );
  const [exportWidth, setExportWidth] = useState<number>(1200);
  const userSetWidth = false;
  const exportFormat = "image/webp";
  const exportQuality = 85;

  const [gridType, setGridType] = useState<"thirds" | "golden" | "none">(
    "thirds",
  );
  const [brightness, setBrightness] = useState(100);
  const [contrast, setContrast] = useState(100);
  const [saturation, setSaturation] = useState(100);
  const [fineRotation, setFineRotation] = useState(0);
  const [grayscale, setGrayscale] = useState(0);
  const [sepia, setSepia] = useState(0);
  const [selectedPreset, setSelectedPreset] = useState("original");
  const [imageStats, setImageStats] = useState<ImageStats | null>(null);

  // Reset imageStats when image URL changes or component closes/opens
  useEffect(() => {
    if (isOpen) {
      setImageStats(null);
    }
  }, [imageUrl, isOpen]);

  const analyzeImage = useCallback((imgEl: HTMLImageElement) => {
    try {
      const canvas = document.createElement("canvas");
      canvas.width = 64;
      canvas.height = 64;
      const ctx = canvas.getContext("2d");
      if (!ctx) return;

      // Draw the loaded image onto offscreen canvas
      ctx.drawImage(imgEl, 0, 0, 64, 64);

      let imgData;
      try {
        imgData = ctx.getImageData(0, 0, 64, 64);
      } catch (_corsError) {
        // Tainted canvas due to CORS
        setImageStats({
          luminance: 128,
          contrast: 50,
          vibrancy: 50,
          exposureLabel: "good",
          contrastLabel: "good",
          vibrancyLabel: "good",
          histogram: [20, 40, 60, 40, 20],
          isTainted: true,
        });
        return;
      }

      const data = imgData.data;
      let totalLuminance = 0;
      let totalVibrancy = 0;
      const pixelLuminances: number[] = [];
      let count = 0;

      for (let i = 0; i < data.length; i += 4) {
        const r = data[i];
        const g = data[i + 1];
        const b = data[i + 2];

        // Relative luminance formula
        const lum = 0.299 * r + 0.587 * g + 0.114 * b;
        pixelLuminances.push(lum);
        totalLuminance += lum;

        // Vibrancy approximation
        const maxVal = Math.max(r, g, b);
        const minVal = Math.min(r, g, b);
        totalVibrancy += maxVal - minVal;
        count++;
      }

      const avgLuminance = totalLuminance / count;
      const avgVibrancy = totalVibrancy / count;

      // Standard deviation of luminance for contrast
      let sumSqDiff = 0;
      for (const lum of pixelLuminances) {
        sumSqDiff += (lum - avgLuminance) ** 2;
      }
      const stdDevLuminance = Math.sqrt(sumSqDiff / count);

      // Compute histogram bins (5 ranges of luminance)
      const histogram = [0, 0, 0, 0, 0];
      for (const lum of pixelLuminances) {
        const bin = Math.min(4, Math.floor(lum / 51.2));
        histogram[bin]++;
      }

      // Normalize histogram bins to percentage of max bin
      const maxBin = Math.max(...histogram) || 1;
      const normalizedHist = histogram.map((val) =>
        Math.round((val / maxBin) * 100),
      );

      const exposureLabel =
        avgLuminance < 85 ? "dark" : avgLuminance > 185 ? "bright" : "good";
      const contrastLabel =
        stdDevLuminance < 38 ? "low" : stdDevLuminance > 75 ? "high" : "good";
      const vibrancyLabel =
        avgVibrancy < 22 ? "flat" : avgVibrancy > 80 ? "saturated" : "good";

      setImageStats({
        luminance: Math.round(avgLuminance),
        contrast: Math.round(stdDevLuminance),
        vibrancy: Math.round(avgVibrancy),
        exposureLabel,
        contrastLabel,
        vibrancyLabel,
        histogram: normalizedHist,
        isTainted: false,
      });
    } catch (err) {
      console.error("Análise inteligente falhou:", err);
    }
  }, []);

  const containerRef = useRef<HTMLDivElement>(null);
  const imageRef = useRef<HTMLImageElement>(null);
  const dragStart = useRef({ x: 0, y: 0 });
  const initialOffset = useRef({ x: 0, y: 0 });

  // Touch refs
  const lastTouchDistance = useRef<number | null>(null);
  const lastTap = useRef<number>(0);

  const [containerSize, setContainerSize] = useState({
    width: 400,
    height: 300,
  });

  useEffect(() => {
    if (!containerRef.current) return;

    const resizeObserver = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const { width, height } = entry.contentRect;
        if (width && height) {
          setContainerSize({
            width,
            height,
          });
        }
      }
    });

    resizeObserver.observe(containerRef.current);
    return () => {
      resizeObserver.disconnect();
    };
  }, [aspectRatio, imageUrl, isOpen]);

  const viewportWidth = containerSize.width;
  const viewportHeight = containerSize.height;

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

      setOffset({
        x: (viewportWidth - imageSize.naturalWidth) / 2,
        y: (viewportHeight - imageSize.naturalHeight) / 2,
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

    // Run smart canvas analysis
    analyzeImage(img);

    setLoading(false);
  };

  // Automatically adjust default export resolution based on aspect ratio
  useEffect(() => {
    if (userSetWidth) return;
    if (aspectRatio === "4:1") {
      setExportWidth(1600);
    } else if (aspectRatio === "2:1") {
      setExportWidth(1200);
    } else {
      setExportWidth(1000);
    }
  }, [aspectRatio, userSetWidth]);

  // Bounds enforcement helper
  const clampOffset = useCallback(
    (x: number, y: number, currentZoom: number) => {
      const scale = baseScale * currentZoom;
      const rotated = rotation === 90 || rotation === 270;
      const w =
        (rotated ? imageSize.naturalHeight : imageSize.naturalWidth) * scale;
      const h =
        (rotated ? imageSize.naturalWidth : imageSize.naturalHeight) * scale;

      let minX = viewportWidth - w / 2 - imageSize.naturalWidth / 2;
      let maxX = w / 2 - imageSize.naturalWidth / 2;
      let minY = viewportHeight - h / 2 - imageSize.naturalHeight / 2;
      let maxY = h / 2 - imageSize.naturalHeight / 2;

      // If image is smaller than viewport, center it
      if (minX > maxX) {
        const cx = (viewportWidth - imageSize.naturalWidth) / 2;
        minX = cx;
        maxX = cx;
      }
      if (minY > maxY) {
        const cy = (viewportHeight - imageSize.naturalHeight) / 2;
        minY = cy;
        maxY = cy;
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

  // Helper to reset positioning
  const resetImagePositionAndZoom = useCallback(() => {
    if (!imageSize.naturalWidth) return;
    setZoom(1);
    setFineRotation(0);

    setOffset({
      x: (viewportWidth - imageSize.naturalWidth) / 2,
      y: (viewportHeight - imageSize.naturalHeight) / 2,
    });
    toast.success("Enquadramento redefinido!");
  }, [
    imageSize.naturalWidth,
    imageSize.naturalHeight,
    viewportWidth,
    viewportHeight,
  ]);

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
    setIsPinching(false);
    lastTouchDistance.current = null;
  };

  // Handle mouse events
  const handleMouseDown = (e: React.MouseEvent) => {
    e.preventDefault();
    handleStart(e.clientX, e.clientY);
  };

  const handleMouseMove = (e: React.MouseEvent) => {
    handleMove(e.clientX, e.clientY);
  };

  // Handle touch events (mobile friendly with gestures support)
  // Double click / tap handler to toggle zoom
  const handleDoubleClickOrTap = useCallback(
    (e?: React.MouseEvent | React.TouchEvent) => {
      if (!imageSize.naturalWidth) return;

      if (zoom <= 1.05) {
        // Zoom in to 2.0x
        setZoom(2.0);

        // Determine target focus coordinates relative to container center
        let focusX = 0;
        let focusY = 0;

        if (e && containerRef.current) {
          const rect = containerRef.current.getBoundingClientRect();
          let clientX = 0;
          let clientY = 0;

          if ("clientX" in e) {
            clientX = e.clientX;
            clientY = e.clientY;
          } else if ("touches" in e && e.touches && e.touches[0]) {
            clientX = e.touches[0].clientX;
            clientY = e.touches[0].clientY;
          }

          if (clientX && clientY) {
            focusX = clientX - (rect.left + rect.width / 2);
            focusY = clientY - (rect.top + rect.height / 2);
          }
        }

        // Target offset to center the focused point at zoom 2.0
        const targetX = (viewportWidth - imageSize.naturalWidth) / 2 - focusX;
        const targetY = (viewportHeight - imageSize.naturalHeight) / 2 - focusY;

        setOffset(clampOffset(targetX, targetY, 2.0));
        toast.success("Zoom aplicado (2x)!");
      } else {
        // Reset zoom and center
        setZoom(1.0);
        setFineRotation(0);

        setOffset({
          x: (viewportWidth - imageSize.naturalWidth) / 2,
          y: (viewportHeight - imageSize.naturalHeight) / 2,
        });
        toast.success("Enquadramento redefinido!");
      }
    },
    [
      zoom,
      imageSize.naturalWidth,
      imageSize.naturalHeight,
      viewportWidth,
      viewportHeight,
      clampOffset,
      setFineRotation,
    ],
  );

  const handleTouchStart = (e: React.TouchEvent) => {
    if (e.touches.length === 1) {
      lastTouchDistance.current = null;
      setIsPinching(false);
      handleStart(e.touches[0].clientX, e.touches[0].clientY);

      // Double tap check
      const now = Date.now();
      if (now - lastTap.current < 300) {
        handleDoubleClickOrTap(e);
      }
      lastTap.current = now;
    } else if (e.touches.length === 2) {
      setIsDragging(false);
      setIsPinching(true);
      const dist = Math.hypot(
        e.touches[0].clientX - e.touches[1].clientX,
        e.touches[0].clientY - e.touches[1].clientY,
      );
      lastTouchDistance.current = dist;
    }
  };

  const handleTouchMove = (e: React.TouchEvent) => {
    if (e.touches.length === 1 && !lastTouchDistance.current) {
      handleMove(e.touches[0].clientX, e.touches[0].clientY);
    } else if (e.touches.length === 2 && lastTouchDistance.current) {
      const dist = Math.hypot(
        e.touches[0].clientX - e.touches[1].clientX,
        e.touches[0].clientY - e.touches[1].clientY,
      );
      const factor = dist / lastTouchDistance.current;
      const newZoom = Math.max(1, Math.min(3, zoom * factor));
      handleZoomChange(newZoom);
      lastTouchDistance.current = dist;
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

  // Zoom by mouse wheel natively to support non-passive event listener (avoiding Chrome passive listener console warnings)
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const handleWheelNative = (e: WheelEvent) => {
      e.preventDefault();
      const zoomStep = 0.05;
      const factor = e.deltaY < 0 ? 1 + zoomStep : 1 - zoomStep;
      const newZoom = Math.max(1, Math.min(3, zoom * factor));
      handleZoomChange(newZoom);
    };

    container.addEventListener("wheel", handleWheelNative, { passive: false });
    return () => {
      container.removeEventListener("wheel", handleWheelNative);
    };
  }, [zoom, handleZoomChange]);

  // Render a responsive banner text simulation overlay
  const renderBannerOverlay = (scale: number) => {
    if (!bannerPreview) return null;

    const title = bannerPreview.title || "";
    const titleColor = bannerPreview.titleColor || "#FFFFFF";
    const subtitle = bannerPreview.subtitle || "";
    const subtitleColor = bannerPreview.subtitleColor || "#D1D5DB";
    const buttonText = bannerPreview.buttonText || "";
    const buttonBgColor = bannerPreview.buttonBgColor || "#FFBF00";
    const buttonTextColor = bannerPreview.buttonTextColor || "#000000";
    const badgeText = bannerPreview.badgeText || "";
    const templateType = bannerPreview.templateType || "default";
    const fontFamily = bannerPreview.fontFamily || "system";
    const overlayColor = bannerPreview.overlayColor || "#000000";
    const overlayOpacity = bannerPreview.overlayOpacity ?? 40;

    const titleFontClass =
      fontFamily === "font-serif"
        ? "font-serif"
        : fontFamily === "font-mono"
          ? "font-mono"
          : fontFamily === "font-display"
            ? "font-display font-black uppercase"
            : "font-sans";

    const overlayStyle = {
      backgroundColor: overlayColor,
      opacity: overlayOpacity / 100,
    };

    const titleStyle = {
      color: titleColor,
      fontSize: `${Math.max(8, Math.round(14 * scale))}px`,
    };

    const subtitleStyle = {
      color: subtitleColor,
      fontSize: `${Math.max(6, Math.round(10 * scale))}px`,
    };

    const buttonStyle = {
      backgroundColor: buttonBgColor,
      color: buttonTextColor,
      fontSize: `${Math.max(5, Math.round(9 * scale))}px`,
      padding: `${Math.max(2, Math.round(4 * scale))}px ${Math.max(6, Math.round(10 * scale))}px`,
      borderRadius: `${Math.max(2, Math.round(6 * scale))}px`,
    };

    const isGlass = templateType === "glassmorphic";
    const isNeon = templateType === "neon_glow";
    const isSplitLeft = templateType === "split_left";
    const isSplitRight = templateType === "split_right";
    const isSplitCenter = templateType === "split_center";

    const showTextOverlay = bannerPreview.showTextOverlay !== false;
    const hasOverlayText =
      showTextOverlay &&
      (title.trim() !== "" ||
        subtitle.trim() !== "" ||
        buttonText.trim() !== "" ||
        badgeText.trim() !== "");

    if (!hasOverlayText) return null;

    return (
      <div
        className={cn(
          "absolute inset-0 z-[15] pointer-events-none select-none overflow-hidden",
          aspectRatio === "2:1" || aspectRatio === "4:1"
            ? "rounded-none sm:rounded-2xl"
            : "rounded-2xl",
        )}
      >
        {/* Background Overlay */}
        <div
          className="absolute inset-0 transition-opacity"
          style={overlayStyle}
        />

        {/* Content wrapper */}
        <div
          className={cn(
            "absolute inset-0 flex flex-col justify-end text-white",
            isSplitCenter && "items-center justify-center text-center",
            isSplitRight && "items-end justify-end text-right",
            isSplitLeft && "items-start justify-end text-left",
            isGlass && "justify-center text-center",
          )}
          style={{
            padding: `${Math.max(6, Math.round(14 * scale))}px`,
            gap: `${Math.max(2, Math.round(4 * scale))}px`,
          }}
        >
          <div
            className={cn(
              "w-full flex flex-col",
              isGlass &&
                "bg-black/35 border border-white/10 text-center items-center",
            )}
            style={{
              borderRadius: isGlass
                ? `${Math.max(4, Math.round(10 * scale))}px`
                : undefined,
              padding: isGlass
                ? `${Math.max(4, Math.round(10 * scale))}px`
                : undefined,
              backdropFilter: isGlass ? `blur(${2 * scale}px)` : undefined,
              gap: `${Math.max(2, Math.round(4 * scale))}px`,
            }}
          >
            {/* Badge */}
            {badgeText && (
              <span
                className="inline-block w-fit bg-[#FFBF00] font-black uppercase tracking-wider text-black"
                style={{
                  fontSize: `${Math.max(5, Math.round(8 * scale))}px`,
                  padding: `${Math.max(1, Math.round(2 * scale))}px ${Math.max(4, Math.round(6 * scale))}px`,
                  borderRadius: `${Math.max(1, Math.round(4 * scale))}px`,
                  marginBottom: `${Math.max(1, Math.round(2 * scale))}px`,
                  alignSelf: isSplitRight
                    ? "flex-end"
                    : isSplitCenter
                      ? "center"
                      : "flex-start",
                }}
              >
                {badgeText}
              </span>
            )}

            {/* Title */}
            {title && (
              <h4
                className={cn(
                  "font-black tracking-tight leading-tight w-full truncate",
                  titleFontClass,
                )}
                style={{
                  ...titleStyle,
                  textShadow: isNeon
                    ? `0 0 ${Math.round(5 * scale)}px ${titleColor || "#FFBF00"}`
                    : undefined,
                }}
              >
                {title}
              </h4>
            )}

            {/* Subtitle */}
            {subtitle && (
              <p
                className="w-full truncate font-medium text-zinc-300"
                style={subtitleStyle}
              >
                {subtitle}
              </p>
            )}

            {/* CTA Button */}
            {buttonText && (
              <button
                type="button"
                className={cn(
                  "font-extrabold uppercase tracking-wider w-fit",
                  isNeon && "animate-pulse",
                )}
                style={{
                  ...buttonStyle,
                  boxShadow: isNeon
                    ? `0 0 ${Math.round(8 * scale)}px ${buttonBgColor || "#FFBF00"}`
                    : undefined,
                  alignSelf: isSplitRight
                    ? "flex-end"
                    : isSplitCenter
                      ? "center"
                      : "flex-start",
                }}
              >
                {buttonText}
              </button>
            )}
          </div>
        </div>
      </div>
    );
  };

  // Filters helpers
  const applyPreset = (presetId: string) => {
    const found = COLOR_PRESETS.find((p) => p.id === presetId);
    if (!found) return;

    setSelectedPreset(presetId);
    setBrightness(found.brightness);
    setContrast(found.contrast);
    setSaturation(found.saturation);
    setGrayscale(found.grayscale);
    setSepia(found.sepia);

    toast.success(`Filtro "${found.name}" aplicado!`, {
      id: "preset-applied",
      duration: 1500,
    });
  };

  const applyAutoEnhance = () => {
    if (imageStats && !imageStats.isTainted) {
      let targetBrightness = 100;
      let targetContrast = 100;
      let targetSaturation = 100;

      // Smart Brightness boost if underexposed
      if (imageStats.luminance < 90) {
        targetBrightness = Math.round(100 + (90 - imageStats.luminance) * 0.4);
      } else if (imageStats.luminance > 180) {
        targetBrightness = Math.round(
          100 - (imageStats.luminance - 180) * 0.15,
        );
      }

      // Smart Contrast boost if flat
      if (imageStats.contrast < 42) {
        targetContrast = Math.round(100 + (42 - imageStats.contrast) * 0.75);
      }

      // Smart Saturation boost if color is flat
      if (imageStats.vibrancy < 30) {
        targetSaturation = Math.round(100 + (30 - imageStats.vibrancy) * 0.8);
      }

      // Clamps to sliders limits (brightness: 50-150, contrast: 50-150, saturation: 0-200)
      targetBrightness = Math.max(80, Math.min(135, targetBrightness));
      targetContrast = Math.max(90, Math.min(130, targetContrast));
      targetSaturation = Math.max(95, Math.min(135, targetSaturation));

      setBrightness(targetBrightness);
      setContrast(targetContrast);
      setSaturation(targetSaturation);
      setGrayscale(0);
      setSepia(0);
      setSelectedPreset("custom");

      toast.success("Ajustes inteligentes aplicados!", {
        description: `Brilho: ${targetBrightness}%, Contraste: ${targetContrast}%, Saturação: ${targetSaturation}%`,
        icon: "✨",
      });
    } else {
      // Fallback preset
      setBrightness(105);
      setContrast(112);
      setSaturation(110);
      setGrayscale(0);
      setSepia(0);
      setSelectedPreset("custom");
      toast.success("Filtros otimizados aplicados!", {
        icon: "✨",
      });
    }
  };

  const resetFilters = () => {
    setBrightness(100);
    setContrast(100);
    setSaturation(100);
    setGrayscale(0);
    setSepia(0);
    setSelectedPreset("original");
    toast.success("Filtros redefinidos");
  };

  const isAdjusting = isDragging || isPinching;

  // Perform canvas cropping and submit
  const handleCrop = async () => {
    if (!imageRef.current || loading) return;

    try {
      const canvas = document.createElement("canvas");
      const ctx = canvas.getContext("2d");
      if (!ctx) throw new Error("Não foi possível obter contexto do canvas");

      const targetWidth = exportWidth;
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
      img.src = corsImageUrl;
      await loadPromise;

      // Draw the image onto canvas using rotation, scale and offset
      // Calculate scale relative to physical canvas size
      const scaleCanvas = targetWidth / viewportWidth;

      ctx.save();

      // Apply image filters to canvas context
      ctx.filter = `brightness(${brightness}%) contrast(${contrast}%) saturate(${saturation}%) grayscale(${grayscale}%) sepia(${sepia}%)`;

      // Move to center of canvas
      ctx.translate(targetWidth / 2, targetHeight / 2);

      // Calculate physical scale
      const physScale = baseScale * zoom * scaleCanvas;

      // Compute coordinates of the image's center in viewport coordinate system, relative to viewport center
      const viewCenterX = viewportWidth / 2;
      const viewCenterY = viewportHeight / 2;
      const imgLeftFromCenter =
        offset.x + imageSize.naturalWidth / 2 - viewCenterX;
      const imgTopFromCenter =
        offset.y + imageSize.naturalHeight / 2 - viewCenterY;

      // Convert these translations to canvas coordinates and translate BEFORE rotation
      ctx.translate(
        imgLeftFromCenter * scaleCanvas,
        imgTopFromCenter * scaleCanvas,
      );

      // Rotate around the center of the translated image
      ctx.rotate(((rotation + fineRotation) * Math.PI) / 180);

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
        exportFormat,
        exportQuality / 100,
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
    <div className="fixed inset-0 z-[130] flex h-screen w-screen flex-col bg-zinc-950">
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        className="relative flex size-full flex-col overflow-hidden bg-zinc-950"
      >
        <style>{`
          @keyframes adjust-shimmer {
            0% { transform: translateX(-100%); }
            100% { transform: translateX(100%); }
          }
          .animate-adjust-shimmer {
            animation: adjust-shimmer 2s infinite linear;
          }
          /* Custom track styles to override standard browser accent colors and sizes */
          input[type="range"]::-webkit-slider-runnable-track {
            background: #1f1f23;
            height: 4px;
            border-radius: 9999px;
          }
          input[type="range"]::-moz-range-track {
            background: #1f1f23;
            height: 4px;
            border-radius: 9999px;
          }
          input[type="range"]::-webkit-slider-thumb {
            margin-top: -5px;
          }
        `}</style>
        {/* Header */}
        <div className="flex items-center justify-between border-b border-white/5 bg-zinc-900/50 px-4 py-3 sm:px-6 sm:py-4 md:px-8 md:py-6">
          <div className="flex items-center gap-2 sm:gap-4">
            <button
              onClick={onClose}
              className="flex size-8 items-center justify-center rounded-full border border-white/10 bg-zinc-900 text-white transition-all hover:border-white/20 hover:bg-zinc-800 active:scale-95 disabled:opacity-50 sm:w-auto sm:px-4 sm:py-2"
              disabled={isSubmitting}
              title="Voltar"
            >
              <ArrowLeft className="size-4" />
              <span className="hidden text-[10px] font-black uppercase tracking-widest sm:inline">
                Voltar
              </span>
            </button>
            <div className="hidden h-6 w-px bg-white/5 sm:block" />
            <div className="flex items-center gap-3">
              <div className="hidden size-8 items-center justify-center rounded-lg border border-emerald-500/20 bg-emerald-500/10 md:flex">
                <Sparkles className="size-4 text-emerald-400" />
              </div>
              <div>
                <h3 className="text-xs font-black uppercase tracking-wider text-white sm:text-sm">
                  Ajustar Imagem
                </h3>
                <p className="mt-0.5 hidden text-[10px] font-bold uppercase tracking-widest text-zinc-500 sm:block">
                  Enquadramento ideal para o PWA
                </p>
              </div>
            </div>
          </div>
          <div className="hidden items-center gap-2 sm:flex">
            <span className="flex items-center gap-1.5 rounded-full bg-emerald-500/10 px-2.5 py-1 text-[8px] font-black uppercase tracking-widest text-emerald-400">
              <span className="size-1.5 animate-pulse rounded-full bg-emerald-500" />
              Editor Ativo
            </span>
          </div>
        </div>

        {/* Workspace Content */}
        <div
          className={cn(
            "flex flex-1 flex-col items-center gap-4 sm:gap-6 overflow-y-auto min-h-0 w-full transition-all duration-300 md:p-8",
            aspectRatio === "2:1" || aspectRatio === "4:1"
              ? "px-0 py-3 sm:px-4 sm:py-4"
              : "p-3 sm:p-4",
            aspectRatio !== "4:1" &&
              "lg:flex-row lg:items-start lg:justify-center lg:gap-8 lg:max-w-6xl lg:mx-auto",
          )}
        >
          {/* Left Column: Image Canvas (Unified Pure Editor Card) */}
          <div
            className={cn(
              "flex flex-col w-full bg-zinc-900/40 shadow-2xl shrink-0 transition-all duration-300",
              aspectRatio === "2:1" || aspectRatio === "4:1"
                ? "border-0 sm:border border-white/5 rounded-none sm:rounded-3xl overflow-hidden"
                : "border border-white/5 rounded-3xl overflow-hidden",
              aspectRatio === "4:1" && "max-w-7xl",
              aspectRatio === "2:1" &&
                "max-w-full sm:max-w-xl lg:max-w-[450px]",
              aspectRatio === "1:1" &&
                "max-w-[280px] xs:max-w-[320px] sm:max-w-[360px] md:max-w-md lg:max-w-[400px]",
              aspectRatio === "4:5" &&
                "max-w-[245px] xs:max-w-[280px] sm:max-w-[320px] md:max-w-sm lg:max-w-[360px]",
              aspectRatio === "free" &&
                "max-w-[245px] xs:max-w-[280px] sm:max-w-[320px] md:max-w-sm lg:max-w-[360px]",
            )}
          >
            {/* Body: Canvas/Editor viewport */}
            {/* eslint-disable-next-line jsx-a11y/no-noninteractive-element-interactions */}
            <div
              ref={containerRef}
              role="application"
              aria-label="Ajustador de imagem: clique e arraste para posicionar"
              className={cn(
                "relative flex w-full cursor-move items-center justify-center overflow-hidden bg-zinc-950/40 shadow-inner transition-all duration-300",
                aspectRatio === "4:5" && "aspect-[4/5]",
                aspectRatio === "1:1" && "aspect-square",
                aspectRatio === "2:1" && "aspect-[2/1]",
                aspectRatio === "4:1" && "aspect-[4/1]",
                aspectRatio === "free" && "aspect-[4/5]",
              )}
              onMouseDown={handleMouseDown}
              onMouseMove={handleMouseMove}
              onMouseUp={handleEnd}
              onMouseLeave={handleEnd}
              onTouchStart={handleTouchStart}
              onTouchMove={handleTouchMove}
              onTouchEnd={handleEnd}
              onDoubleClick={handleDoubleClickOrTap}
            >
              {loading && (
                <div className="absolute inset-0 z-20 flex flex-col items-center justify-center gap-3 bg-zinc-950/80">
                  <span className="border-3 size-8 animate-spin rounded-full border-emerald-500/30 border-t-emerald-500" />
                  <span className="text-[10px] font-black uppercase tracking-widest text-zinc-400">
                    Carregando Imagem...
                  </span>
                </div>
              )}

              {/* Crop Viewfinder Corner L-Handles */}
              {!loading && (
                <>
                  <div className="pointer-events-none absolute left-3.5 top-3.5 z-[11] size-4 rounded-tl-sm border-l-2 border-t-2 border-white/70" />
                  <div className="pointer-events-none absolute right-3.5 top-3.5 z-[11] size-4 rounded-tr-sm border-r-2 border-t-2 border-white/70" />
                  <div className="pointer-events-none absolute bottom-3.5 left-3.5 z-[11] size-4 rounded-bl-sm border-b-2 border-l-2 border-white/70" />
                  <div className="pointer-events-none absolute bottom-3.5 right-3.5 z-[11] size-4 rounded-br-sm border-b-2 border-r-2 border-white/70" />
                </>
              )}

              {/* Render live banner simulation overlay if toggled and available */}
              {bannerPreview && showBannerSimulation && !loading && (
                <div className="pointer-events-none absolute inset-0 z-10">
                  {renderBannerOverlay(1.0)}
                </div>
              )}

              {/* Grid Lines helper */}
              {!loading && gridType === "thirds" && (
                <div className="pointer-events-none absolute inset-0 z-10 grid grid-cols-3 grid-rows-3 opacity-30">
                  <div className="col-span-1 border-r border-dashed border-emerald-400" />
                  <div className="col-span-1 border-r border-dashed border-emerald-400" />
                  <div className="absolute inset-x-0 top-1/3 col-span-3 row-span-1 border-b border-dashed border-emerald-400" />
                  <div className="absolute inset-x-0 top-2/3 col-span-3 row-span-1 border-b border-dashed border-emerald-400" />
                </div>
              )}
              {!loading && gridType === "golden" && (
                <div className="pointer-events-none absolute inset-0 z-10 opacity-30">
                  {/* Vertical golden ratio lines */}
                  <div
                    className="absolute inset-y-0 border-r border-dashed border-amber-400"
                    style={{ left: "38.2%" }}
                  />
                  <div
                    className="absolute inset-y-0 border-r border-dashed border-amber-400"
                    style={{ left: "61.8%" }}
                  />
                  {/* Horizontal golden ratio lines */}
                  <div
                    className="absolute inset-x-0 border-b border-dashed border-amber-400"
                    style={{ top: "38.2%" }}
                  />
                  <div
                    className="absolute inset-x-0 border-b border-dashed border-amber-400"
                    style={{ top: "61.8%" }}
                  />
                </div>
              )}

              {/* Guidelines for cross-device viewports (only for banners) */}
              {bannerPreview && !loading && (
                <>
                  {aspectRatio === "2:1" && (
                    <>
                      {/* Top and Bottom cut-off zones for Desktop 4:1 */}
                      <div className="pointer-events-none absolute inset-x-0 top-0 z-10 h-1/4 border-b border-dashed border-[#FFBF00]/40 bg-black/40 transition-all" />
                      <div className="pointer-events-none absolute inset-x-0 bottom-0 z-10 h-1/4 border-t border-dashed border-[#FFBF00]/40 bg-black/40 transition-all" />
                    </>
                  )}
                  {aspectRatio === "4:1" && (
                    <>
                      {/* Left and Right cut-off zones for Mobile 2:1 */}
                      <div className="pointer-events-none absolute inset-y-0 left-0 z-10 w-1/4 border-r border-dashed border-[#FFBF00]/40 bg-black/40 transition-all" />
                      <div className="pointer-events-none absolute inset-y-0 right-0 z-10 w-1/4 border-l border-dashed border-[#FFBF00]/40 bg-black/40 transition-all" />
                    </>
                  )}
                </>
              )}

              {/* Editable Image */}
              <img
                ref={imageRef}
                src={corsImageUrl}
                crossOrigin="anonymous"
                alt="Ajuste"
                onLoad={handleImageLoad}
                className="pointer-events-none absolute left-0 top-0 max-w-none origin-center select-none"
                style={{
                  width: imageSize.naturalWidth || "auto",
                  height: imageSize.naturalHeight || "auto",
                  transform: `translate(${offset.x}px, ${offset.y}px) rotate(${rotation + fineRotation}deg) scale(${currentScale})`,
                  opacity: loading ? 0 : 1,
                  transition: isAdjusting ? "none" : "transform 0.15s ease-out",
                  filter: `brightness(${brightness}%) contrast(${contrast}%) saturate(${saturation}%) grayscale(${grayscale}%) sepia(${sepia}%)`,
                }}
              />
            </div>
          </div>

          {/* Controls Panel */}
          <div
            className={cn(
              "space-y-4 sm:space-y-5 rounded-3xl border border-white/5 bg-zinc-900/40 p-4 sm:p-5 shrink-0 transition-all duration-300",
              aspectRatio === "2:1" || aspectRatio === "4:1"
                ? "w-[calc(100%-2rem)] mx-auto sm:w-full sm:mx-0"
                : "w-full",
              aspectRatio === "4:1" && "max-w-7xl",
              aspectRatio === "2:1" && "max-w-xl lg:max-w-[380px]",
              aspectRatio === "1:1" && "max-w-md lg:max-w-[380px]",
              aspectRatio === "4:5" && "max-w-sm lg:max-w-[380px]",
              aspectRatio === "free" && "max-w-sm lg:max-w-[380px]",
            )}
          >
            {/* Tab Navigation */}
            <div className="relative flex w-full rounded-2xl border border-white/5 bg-zinc-950/85 p-1">
              {(["crop", "filters"] as const).map((tab) => {
                const isActive = activeTab === tab;
                return (
                  <button
                    key={tab}
                    type="button"
                    onClick={() => setActiveTab(tab)}
                    className={cn(
                      "relative flex-1 py-2 text-[10px] font-black uppercase tracking-wider transition-all text-center rounded-xl",
                      isActive
                        ? "text-emerald-400"
                        : "text-zinc-500 hover:text-zinc-300",
                    )}
                  >
                    {isActive && (
                      <motion.div
                        layoutId="activeTabBackground"
                        className="absolute inset-0 rounded-xl border border-emerald-500/20 bg-emerald-500/10"
                        transition={{
                          type: "spring",
                          stiffness: 380,
                          damping: 30,
                        }}
                      />
                    )}
                    <span className="relative z-10 flex items-center justify-center gap-1.5">
                      {tab === "crop" ? "Corte" : "Filtros"}
                      {tab === "filters" &&
                        (brightness !== 100 ||
                          contrast !== 100 ||
                          saturation !== 100 ||
                          grayscale !== 0 ||
                          sepia !== 0 ||
                          selectedPreset !== "original") && (
                          <span className="size-1.5 animate-pulse rounded-full bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.8)]" />
                        )}
                    </span>
                  </button>
                );
              })}
            </div>

            <motion.div
              key={activeTab}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.15 }}
              className="space-y-4"
            >
              {activeTab === "crop" ? (
                <>
                  {/* Presets Selectors */}
                  <div className="space-y-2">
                    <span className="block text-[9px] font-black uppercase tracking-widest text-zinc-500">
                      Enquadramento / Proporção
                    </span>
                    <div className="grid grid-cols-2 gap-2">
                      {presets.map((preset) => (
                        <button
                          key={preset}
                          type="button"
                          onClick={() => setAspectRatio(preset)}
                          className={cn(
                            "flex flex-col items-center justify-center gap-2 rounded-2xl border py-2 px-1.5 sm:py-3 sm:px-2 text-[10px] font-black uppercase tracking-wider transition-all active:scale-95 text-center",
                            aspectRatio === preset
                              ? "border-emerald-450 bg-emerald-500/10 text-emerald-455 shadow-lg shadow-emerald-500/5"
                              : "border-white/5 bg-zinc-950/40 text-zinc-550 hover:bg-zinc-900/60 hover:text-white",
                          )}
                        >
                          {renderPresetIcon(preset, aspectRatio === preset)}
                          <span>{PRESET_LABELS[preset]}</span>
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* Zoom Slider */}
                  <div className="space-y-2">
                    <div
                      className="flex select-none items-center justify-between"
                      onDoubleClick={() => handleZoomChange(1)}
                    >
                      <span className="cursor-pointer text-[9px] font-black uppercase tracking-widest text-zinc-500 transition-colors hover:text-zinc-300">
                        Zoom da Imagem
                      </span>
                      <span className="cursor-pointer text-[10px] font-black text-zinc-400 transition-colors hover:text-zinc-300">
                        {Math.round(zoom * 100)}%
                      </span>
                    </div>
                    <div className="flex items-center gap-3">
                      <button
                        type="button"
                        onClick={() =>
                          handleZoomChange(Math.max(1, zoom - 0.25))
                        }
                        className="rounded-xl border border-white/5 bg-zinc-950 p-2 text-zinc-400 transition-all hover:bg-zinc-900 hover:text-white active:scale-90"
                      >
                        <ZoomOut className="size-3.5" />
                      </button>

                      <input
                        id="zoom-slider"
                        name="zoom-slider"
                        type="range"
                        min="1"
                        max="3"
                        step="0.01"
                        value={zoom}
                        onChange={(e) =>
                          handleZoomChange(Number.parseFloat(e.target.value))
                        }
                        className="h-1 flex-1 cursor-pointer appearance-none rounded-lg bg-zinc-950 accent-emerald-500
                                   [&::-moz-range-thumb]:size-3.5 [&::-moz-range-thumb]:appearance-none [&::-moz-range-thumb]:rounded-full [&::-moz-range-thumb]:border-2 [&::-moz-range-thumb]:border-emerald-500 [&::-moz-range-thumb]:bg-white [&::-moz-range-thumb]:shadow-md [&::-moz-range-thumb]:transition-all [&::-moz-range-thumb]:hover:scale-110 [&::-moz-range-thumb]:active:scale-125
                                   [&::-webkit-slider-thumb]:size-3.5 [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:border-2 [&::-webkit-slider-thumb]:border-emerald-500 [&::-webkit-slider-thumb]:bg-white [&::-webkit-slider-thumb]:shadow-md [&::-webkit-slider-thumb]:transition-all [&::-webkit-slider-thumb]:hover:scale-110 [&::-webkit-slider-thumb]:active:scale-125"
                      />

                      <button
                        type="button"
                        onClick={() =>
                          handleZoomChange(Math.min(3, zoom + 0.25))
                        }
                        className="rounded-xl border border-white/5 bg-zinc-950 p-2 text-zinc-400 transition-all hover:bg-zinc-900 hover:text-white active:scale-90"
                      >
                        <ZoomIn className="size-3.5" />
                      </button>
                    </div>
                    {/* Rotator and Guides */}
                    <div className="grid grid-cols-2 gap-3 border-t border-white/5 pt-3 sm:gap-4 sm:pt-4">
                      <div className="space-y-2">
                        <span className="block text-[9px] font-black uppercase tracking-widest text-zinc-500">
                          Guias de Grade
                        </span>
                        <div className="flex gap-1.5">
                          {(["thirds", "golden", "none"] as const).map(
                            (type) => (
                              <button
                                key={type}
                                type="button"
                                onClick={() => setGridType(type)}
                                className={cn(
                                  "flex-1 rounded-xl border py-1.5 text-[8px] font-black uppercase tracking-wider transition-all active:scale-95 text-center",
                                  gridType === type
                                    ? "border-emerald-400 bg-emerald-500/10 text-emerald-400"
                                    : "border-white/5 bg-zinc-950/30 text-zinc-400 hover:bg-zinc-900 hover:text-white",
                                )}
                              >
                                {type === "thirds"
                                  ? "Terços"
                                  : type === "golden"
                                    ? "Áurea"
                                    : "Sem Grade"}
                              </button>
                            ),
                          )}
                        </div>
                      </div>

                      <div className="space-y-2">
                        <span className="block text-[9px] font-black uppercase tracking-widest text-zinc-500">
                          Rotacionar Imagem
                        </span>
                        <button
                          type="button"
                          onClick={rotateImage}
                          className="flex w-full items-center justify-center gap-2 rounded-xl border border-white/5 bg-zinc-950 py-2 text-[9px] font-black uppercase tracking-widest text-zinc-300 transition-all hover:bg-zinc-900 active:scale-95 sm:py-2.5"
                        >
                          <RotateCw className="size-3.5" />
                          Girar 90°
                        </button>
                      </div>
                    </div>{" "}
                  </div>

                  {/* Banner Simulation and Reset */}
                  <div className="space-y-3 border-t border-white/5 pt-4">
                    {bannerPreview && (
                      <div className="flex items-center justify-between">
                        <span className="text-[10px] font-bold text-zinc-300">
                          Simular Textos do Banner
                        </span>
                        <button
                          type="button"
                          onClick={() =>
                            setShowBannerSimulation((prev) => !prev)
                          }
                          className={cn(
                            "relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none items-center",
                            showBannerSimulation
                              ? "bg-emerald-500"
                              : "bg-zinc-700",
                          )}
                        >
                          <span
                            className={cn(
                              "pointer-events-none inline-block size-4 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out",
                              showBannerSimulation
                                ? "translate-x-4"
                                : "translate-x-0",
                            )}
                          />
                        </button>
                      </div>
                    )}

                    <div className="flex justify-start">
                      <button
                        type="button"
                        onClick={resetImagePositionAndZoom}
                        className="text-[9px] font-black uppercase tracking-widest text-zinc-500 transition-colors hover:text-white"
                      >
                        Redefinir Posição
                      </button>
                    </div>
                  </div>
                </>
              ) : (
                <>
                  {/* Auto Enhance and Reset Filters */}
                  <div className="flex gap-2">
                    <button
                      type="button"
                      onClick={applyAutoEnhance}
                      className="group relative flex flex-1 items-center justify-center gap-2 overflow-hidden rounded-xl bg-gradient-to-r from-emerald-500 via-teal-500 to-emerald-500 py-2 text-[10px] font-black uppercase tracking-wider text-emerald-950 shadow-lg shadow-emerald-500/10 transition-all hover:opacity-90 active:scale-95"
                    >
                      <span className="group-hover:animate-adjust-shimmer absolute inset-0 size-full -translate-x-full bg-gradient-to-r from-transparent via-white/20 to-transparent" />
                      <Sparkles className="size-3.5 text-emerald-950 transition-transform group-hover:rotate-12" />
                      Otimizar
                    </button>
                    <button
                      type="button"
                      onClick={resetFilters}
                      className="flex-1 rounded-xl border border-white/5 bg-zinc-950/50 py-2 text-[10px] font-black uppercase tracking-wider text-zinc-400 transition-all hover:bg-zinc-900 hover:text-white active:scale-95"
                    >
                      Limpar Filtros
                    </button>
                  </div>

                  {/* Presets Rápidos */}
                  <div className="space-y-2">
                    <span className="text-[9px] font-black uppercase tracking-widest text-zinc-500">
                      Presets de Filtros
                    </span>
                    <div className="no-scrollbar flex gap-2 overflow-x-auto scroll-smooth pb-1">
                      {COLOR_PRESETS.map((p) => (
                        <button
                          key={p.id}
                          type="button"
                          onClick={() => applyPreset(p.id)}
                          className={cn(
                            "flex-shrink-0 rounded-xl border px-3 py-1.5 text-[9px] font-black uppercase tracking-wider transition-all active:scale-95",
                            selectedPreset === p.id
                              ? "border-emerald-450 bg-emerald-500/10 text-emerald-400"
                              : "border-white/5 bg-zinc-950/30 text-zinc-450 hover:bg-zinc-900 hover:text-white",
                          )}
                        >
                          {p.name}
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* Manual Sliders */}
                  <div className="space-y-4 border-t border-white/5 pt-4">
                    {/* Brightness Slider */}
                    <div className="space-y-1.5">
                      <div
                        className="flex select-none items-center justify-between"
                        onDoubleClick={() => {
                          setBrightness(100);
                          setSelectedPreset("custom");
                        }}
                      >
                        <label
                          htmlFor="adjust-brightness"
                          className="flex cursor-pointer items-center text-[9px] font-black uppercase tracking-widest text-zinc-500 transition-colors hover:text-zinc-300"
                        >
                          Brilho
                          {brightness !== 100 && (
                            <span className="ml-1.5 inline-block size-1.5 rounded-full bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.6)]" />
                          )}
                        </label>
                        <span className="text-zinc-450 cursor-pointer text-[10px] font-black transition-colors hover:text-zinc-300">
                          {brightness}%
                        </span>
                      </div>
                      <input
                        id="adjust-brightness"
                        name="brightness"
                        type="range"
                        min="50"
                        max="150"
                        value={brightness}
                        onChange={(e) => {
                          setBrightness(Number(e.target.value));
                          setSelectedPreset("custom");
                        }}
                        className="h-1 w-full cursor-pointer appearance-none rounded-lg bg-zinc-950 accent-emerald-500
                                   [&::-moz-range-thumb]:size-3.5 [&::-moz-range-thumb]:appearance-none [&::-moz-range-thumb]:rounded-full [&::-moz-range-thumb]:border-2 [&::-moz-range-thumb]:border-emerald-500 [&::-moz-range-thumb]:bg-white [&::-moz-range-thumb]:shadow-md [&::-moz-range-thumb]:transition-all [&::-moz-range-thumb]:hover:scale-110 [&::-moz-range-thumb]:active:scale-125
                                   [&::-webkit-slider-thumb]:size-3.5 [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:border-2 [&::-webkit-slider-thumb]:border-emerald-500 [&::-webkit-slider-thumb]:bg-white [&::-webkit-slider-thumb]:shadow-md [&::-webkit-slider-thumb]:transition-all [&::-webkit-slider-thumb]:hover:scale-110 [&::-webkit-slider-thumb]:active:scale-125"
                      />
                    </div>

                    {/* Contrast Slider */}
                    <div className="space-y-1.5">
                      <div
                        className="flex select-none items-center justify-between"
                        onDoubleClick={() => {
                          setContrast(100);
                          setSelectedPreset("custom");
                        }}
                      >
                        <label
                          htmlFor="adjust-contrast"
                          className="flex cursor-pointer items-center text-[9px] font-black uppercase tracking-widest text-zinc-500 transition-colors hover:text-zinc-300"
                        >
                          Contraste
                          {contrast !== 100 && (
                            <span className="ml-1.5 inline-block size-1.5 rounded-full bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.6)]" />
                          )}
                        </label>
                        <span className="text-zinc-450 cursor-pointer text-[10px] font-black transition-colors hover:text-zinc-300">
                          {contrast}%
                        </span>
                      </div>
                      <input
                        id="adjust-contrast"
                        name="contrast"
                        type="range"
                        min="50"
                        max="150"
                        value={contrast}
                        onChange={(e) => {
                          setContrast(Number(e.target.value));
                          setSelectedPreset("custom");
                        }}
                        className="h-1 w-full cursor-pointer appearance-none rounded-lg bg-zinc-950 accent-emerald-500
                                   [&::-moz-range-thumb]:size-3.5 [&::-moz-range-thumb]:appearance-none [&::-moz-range-thumb]:rounded-full [&::-moz-range-thumb]:border-2 [&::-moz-range-thumb]:border-emerald-500 [&::-moz-range-thumb]:bg-white [&::-moz-range-thumb]:shadow-md [&::-moz-range-thumb]:transition-all [&::-moz-range-thumb]:hover:scale-110 [&::-moz-range-thumb]:active:scale-125
                                   [&::-webkit-slider-thumb]:size-3.5 [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:border-2 [&::-webkit-slider-thumb]:border-emerald-500 [&::-webkit-slider-thumb]:bg-white [&::-webkit-slider-thumb]:shadow-md [&::-webkit-slider-thumb]:transition-all [&::-webkit-slider-thumb]:hover:scale-110 [&::-webkit-slider-thumb]:active:scale-125"
                      />
                    </div>

                    {/* Saturation Slider */}
                    <div className="space-y-1.5">
                      <div
                        className="flex select-none items-center justify-between"
                        onDoubleClick={() => {
                          setSaturation(100);
                          setSelectedPreset("custom");
                        }}
                      >
                        <label
                          htmlFor="adjust-saturation"
                          className="flex cursor-pointer items-center text-[9px] font-black uppercase tracking-widest text-zinc-500 transition-colors hover:text-zinc-300"
                        >
                          Saturação
                          {saturation !== 100 && (
                            <span className="ml-1.5 inline-block size-1.5 rounded-full bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.6)]" />
                          )}
                        </label>
                        <span className="text-zinc-450 cursor-pointer text-[10px] font-black transition-colors hover:text-zinc-300">
                          {saturation}%
                        </span>
                      </div>
                      <input
                        id="adjust-saturation"
                        name="saturation"
                        type="range"
                        min="0"
                        max="200"
                        value={saturation}
                        onChange={(e) => {
                          setSaturation(Number(e.target.value));
                          setSelectedPreset("custom");
                        }}
                        className="h-1 w-full cursor-pointer appearance-none rounded-lg bg-zinc-950 accent-emerald-500
                                   [&::-moz-range-thumb]:size-3.5 [&::-moz-range-thumb]:appearance-none [&::-moz-range-thumb]:rounded-full [&::-moz-range-thumb]:border-2 [&::-moz-range-thumb]:border-emerald-500 [&::-moz-range-thumb]:bg-white [&::-moz-range-thumb]:shadow-md [&::-moz-range-thumb]:transition-all [&::-moz-range-thumb]:hover:scale-110 [&::-moz-range-thumb]:active:scale-125
                                   [&::-webkit-slider-thumb]:size-3.5 [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:border-2 [&::-webkit-slider-thumb]:border-emerald-500 [&::-webkit-slider-thumb]:bg-white [&::-webkit-slider-thumb]:shadow-md [&::-webkit-slider-thumb]:transition-all [&::-webkit-slider-thumb]:hover:scale-110 [&::-webkit-slider-thumb]:active:scale-125"
                      />
                    </div>

                    {/* Grayscale Slider */}
                    <div className="space-y-1.5">
                      <div
                        className="flex select-none items-center justify-between"
                        onDoubleClick={() => {
                          setGrayscale(0);
                          setSelectedPreset("custom");
                        }}
                      >
                        <label
                          htmlFor="adjust-grayscale"
                          className="flex cursor-pointer items-center text-[9px] font-black uppercase tracking-widest text-zinc-500 transition-colors hover:text-zinc-300"
                        >
                          Escala de Cinza
                          {grayscale !== 0 && (
                            <span className="ml-1.5 inline-block size-1.5 rounded-full bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.6)]" />
                          )}
                        </label>
                        <span className="text-zinc-450 cursor-pointer text-[10px] font-black transition-colors hover:text-zinc-300">
                          {grayscale}%
                        </span>
                      </div>
                      <input
                        id="adjust-grayscale"
                        name="grayscale"
                        type="range"
                        min="0"
                        max="100"
                        value={grayscale}
                        onChange={(e) => {
                          setGrayscale(Number(e.target.value));
                          setSelectedPreset("custom");
                        }}
                        className="h-1 w-full cursor-pointer appearance-none rounded-lg bg-zinc-950 accent-emerald-500
                                   [&::-moz-range-thumb]:size-3.5 [&::-moz-range-thumb]:appearance-none [&::-moz-range-thumb]:rounded-full [&::-moz-range-thumb]:border-2 [&::-moz-range-thumb]:border-emerald-500 [&::-moz-range-thumb]:bg-white [&::-moz-range-thumb]:shadow-md [&::-moz-range-thumb]:transition-all [&::-moz-range-thumb]:hover:scale-110 [&::-moz-range-thumb]:active:scale-125
                                   [&::-webkit-slider-thumb]:size-3.5 [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:border-2 [&::-webkit-slider-thumb]:border-emerald-500 [&::-webkit-slider-thumb]:bg-white [&::-webkit-slider-thumb]:shadow-md [&::-webkit-slider-thumb]:transition-all [&::-webkit-slider-thumb]:hover:scale-110 [&::-webkit-slider-thumb]:active:scale-125"
                      />
                    </div>

                    {/* Sepia Slider */}
                    <div className="space-y-1.5">
                      <div
                        className="flex select-none items-center justify-between"
                        onDoubleClick={() => {
                          setSepia(0);
                          setSelectedPreset("custom");
                        }}
                      >
                        <label
                          htmlFor="adjust-sepia"
                          className="flex flex-shrink-0 cursor-pointer items-center text-[9px] font-black uppercase tracking-widest text-zinc-500 transition-colors hover:text-zinc-300"
                        >
                          Sépia
                          {sepia !== 0 && (
                            <span className="ml-1.5 inline-block size-1.5 rounded-full bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.6)]" />
                          )}
                        </label>
                        <span className="text-zinc-450 cursor-pointer text-[10px] font-black transition-colors hover:text-zinc-300">
                          {sepia}%
                        </span>
                      </div>
                      <input
                        id="adjust-sepia"
                        name="sepia"
                        type="range"
                        min="0"
                        max="100"
                        value={sepia}
                        onChange={(e) => {
                          setSepia(Number(e.target.value));
                          setSelectedPreset("custom");
                        }}
                        className="h-1 w-full cursor-pointer appearance-none rounded-lg bg-zinc-950 accent-emerald-500
                                   [&::-moz-range-thumb]:size-3.5 [&::-moz-range-thumb]:appearance-none [&::-moz-range-thumb]:rounded-full [&::-moz-range-thumb]:border-2 [&::-moz-range-thumb]:border-emerald-500 [&::-moz-range-thumb]:bg-white [&::-moz-range-thumb]:shadow-md [&::-moz-range-thumb]:transition-all [&::-moz-range-thumb]:hover:scale-110 [&::-moz-range-thumb]:active:scale-125
                                   [&::-webkit-slider-thumb]:size-3.5 [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:border-2 [&::-webkit-slider-thumb]:border-emerald-500 [&::-webkit-slider-thumb]:bg-white [&::-webkit-slider-thumb]:shadow-md [&::-webkit-slider-thumb]:transition-all [&::-webkit-slider-thumb]:hover:scale-110 [&::-webkit-slider-thumb]:active:scale-125"
                      />
                    </div>
                  </div>
                </>
              )}
            </motion.div>
          </div>
        </div>

        {/* Footer actions */}
        <div className="flex w-full items-center justify-between border-t border-white/5 bg-zinc-900/50 px-4 py-3 sm:px-6 sm:py-4 md:px-8 md:py-6">
          <div className="hidden items-center gap-2 text-[10px] font-medium text-zinc-500 sm:flex">
            <AlertCircle className="size-3.5 text-zinc-500" />
            <span>O corte definitivo será processado e enviado.</span>
          </div>

          <div className="flex w-full items-center gap-3 sm:w-auto">
            <button
              type="button"
              onClick={onClose}
              disabled={isSubmitting}
              className="flex-1 justify-center rounded-xl border border-white/5 bg-zinc-950 px-5 py-2.5 text-[10px] font-black uppercase tracking-widest text-zinc-400 transition-all hover:border-white/10 hover:bg-zinc-900 hover:text-white active:scale-95 sm:flex-none"
            >
              Cancelar
            </button>
            <button
              type="button"
              onClick={handleCrop}
              disabled={isSubmitting || loading}
              className="flex flex-1 items-center justify-center gap-2 rounded-xl bg-emerald-500 px-6 py-2.5 text-[10px] font-black uppercase tracking-widest text-emerald-950 shadow-lg shadow-emerald-500/10 transition-all hover:bg-emerald-400 hover:shadow-emerald-500/20 active:scale-95 disabled:bg-zinc-800 disabled:text-zinc-600 disabled:shadow-none sm:flex-none"
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
