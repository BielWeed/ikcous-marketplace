import React, { useState, useEffect, useRef, useCallback } from 'react';
import { motion } from 'framer-motion';
import { X, ZoomIn, ZoomOut, Check, RotateCw, AlertCircle, Info, Sparkles } from 'lucide-react';
import { toast } from 'sonner';

export type AspectRatioPreset = '4:5' | '1:1' | '2:1' | '4:1' | 'free';

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
  '4:5': 'Vitrine (4:5)',
  '1:1': 'Detalhe (1:1)',
  '2:1': 'Celular (2:1)',
  '4:1': 'Desktop (4:1)',
  'free': 'Livre'
};

export function ImageAdjuster({
  isOpen,
  onClose,
  imageUrl,
  onConfirm,
  isSubmitting = false,
  allowedPresets,
  defaultPreset
}: ImageAdjusterProps) {
  const presets = allowedPresets || ['4:5', '1:1', 'free'];
  const [aspectRatio, setAspectRatio] = useState<AspectRatioPreset>(() => {
    if (defaultPreset && presets.includes(defaultPreset)) return defaultPreset;
    return presets[0];
  });
  const [zoom, setZoom] = useState(1);
  const [rotation, setRotation] = useState<0 | 90 | 180 | 270>(0);
  const [isDragging, setIsDragging] = useState(false);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const [imageSize, setImageSize] = useState({ width: 0, height: 0, naturalWidth: 0, naturalHeight: 0 });
  const [loading, setLoading] = useState(true);
  const [qualityScore, setQualityScore] = useState<{ score: 'excellent' | 'good' | 'low'; details: string }>({ score: 'good', details: '' });

  const containerRef = useRef<HTMLDivElement>(null);
  const imageRef = useRef<HTMLImageElement>(null);
  const dragStart = useRef({ x: 0, y: 0 });
  const initialOffset = useRef({ x: 0, y: 0 });

  // Viewport sizes for the crop frame (in pixels)
  const getViewportDimensions = useCallback(() => {
    const maxWidth = 300;
    const maxHeight = 375;

    if (aspectRatio === '4:5') {
      return { width: maxWidth, height: maxHeight };
    } else if (aspectRatio === '1:1') {
      return { width: maxWidth, height: maxWidth };
    } else if (aspectRatio === '2:1') {
      return { width: maxWidth, height: maxWidth / 2 };
    } else if (aspectRatio === '4:1') {
      return { width: maxWidth, height: maxWidth / 4 };
    } else {
      // Freeform/Original aspect ratio helper
      if (imageSize.naturalWidth && imageSize.naturalHeight) {
        const imgAspect = imageSize.naturalWidth / imageSize.naturalHeight;
        if (imgAspect > 1) {
          // landscape
          return { width: maxWidth, height: maxWidth / imgAspect };
        } else {
          // portrait
          return { width: maxHeight * imgAspect, height: maxHeight };
        }
      }
      return { width: maxWidth, height: maxWidth };
    }
  }, [aspectRatio, imageSize.naturalWidth, imageSize.naturalHeight]);

  const { width: viewportWidth, height: viewportHeight } = getViewportDimensions();

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
  }, [imageSize.naturalWidth, imageSize.naturalHeight, viewportWidth, viewportHeight, rotation]);

  const baseScale = getBaseScale();
  const currentScale = baseScale * zoom;

  // Reset positioning when image, aspect ratio or rotation changes
  useEffect(() => {
    if (!loading && imageSize.naturalWidth) {
      setZoom(1);
      
      const rotated = rotation === 90 || rotation === 270;
      const w = (rotated ? imageSize.naturalHeight : imageSize.naturalWidth) * baseScale;
      const h = (rotated ? imageSize.naturalWidth : imageSize.naturalHeight) * baseScale;
      
      setOffset({
        x: (viewportWidth - w) / 2,
        y: (viewportHeight - h) / 2
      });
    }
  }, [aspectRatio, rotation, loading, imageSize.naturalWidth, imageSize.naturalHeight, viewportWidth, viewportHeight, baseScale]);

  // Handle image load to check natural sizes and quality
  const handleImageLoad = (e: React.SyntheticEvent<HTMLImageElement>) => {
    const img = e.currentTarget;
    const naturalWidth = img.naturalWidth;
    const naturalHeight = img.naturalHeight;
    
    setImageSize({
      width: img.width,
      height: img.height,
      naturalWidth,
      naturalHeight
    });
    
    // Quality evaluation
    const resolution = naturalWidth * naturalHeight;
    let score: 'excellent' | 'good' | 'low' = 'good';
    let details = 'Proporção recomendada. Detalhes nítidos.';
    
    if (resolution < 500 * 500) {
      score = 'low';
      details = 'Baixa resolução. Recomendado enviar imagens maiores que 800px para evitar borrões.';
    } else if (resolution >= 1200 * 1200) {
      score = 'excellent';
      details = 'Excelente resolução! Imagem perfeita para zoom em alta definição na galeria.';
    } else {
      score = 'good';
      details = 'Resolução adequada. Imagem nítida.';
    }

    setQualityScore({ score, details });
    setLoading(false);
  };

  // Bounds enforcement helper
  const clampOffset = useCallback((x: number, y: number, currentZoom: number) => {
    const scale = baseScale * currentZoom;
    const rotated = rotation === 90 || rotation === 270;
    const w = (rotated ? imageSize.naturalHeight : imageSize.naturalWidth) * scale;
    const h = (rotated ? imageSize.naturalWidth : imageSize.naturalHeight) * scale;

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
      y: Math.max(minY, Math.min(maxY, y))
    };
  }, [baseScale, rotation, imageSize.naturalWidth, imageSize.naturalHeight, viewportWidth, viewportHeight]);

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
    setRotation(prev => {
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
    setOffset(prev => {
      const clamped = clampOffset(prev.x, prev.y, newZoom);
      return clamped;
    });
  };

  // Perform canvas cropping and submit
  const handleCrop = async () => {
    if (!imageRef.current || loading) return;

    try {
      const canvas = document.createElement('canvas');
      const ctx = canvas.getContext('2d');
      if (!ctx) throw new Error('Não foi possível obter contexto do canvas');

      const targetWidth = 1000;
      const targetHeight = Math.round(targetWidth * (viewportHeight / viewportWidth));

      canvas.width = targetWidth;
      canvas.height = targetHeight;

      // Draw color background
      ctx.fillStyle = '#FFFFFF';
      ctx.fillRect(0, 0, targetWidth, targetHeight);

      // Load original image to canvas
      const img = new Image();
      img.crossOrigin = 'anonymous'; // Avoid CORS issues
      
      const loadPromise = new Promise<void>((resolve, reject) => {
        img.onload = () => resolve();
        img.onerror = () => reject(new Error('Falha ao recarregar imagem para corte'));
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
      const displayW = (rotated ? imageSize.naturalHeight : imageSize.naturalWidth) * (baseScale * zoom);
      const displayH = (rotated ? imageSize.naturalWidth : imageSize.naturalHeight) * (baseScale * zoom);
      
      // Compute coordinates of the image's top-left in viewport coordinate system, relative to viewport center
      const viewCenterX = viewportWidth / 2;
      const viewCenterY = viewportHeight / 2;
      const imgLeftFromCenter = offset.x + displayW / 2 - viewCenterX;
      const imgTopFromCenter = offset.y + displayH / 2 - viewCenterY;

      // Convert these translations to canvas coordinates
      ctx.translate(imgLeftFromCenter * scaleCanvas, imgTopFromCenter * scaleCanvas);
      
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
            toast.error('Erro ao processar imagem final');
          }
        },
        'image/jpeg',
        0.92 // 92% JPEG quality (ideal for web/PWA loading speed vs quality)
      );
    } catch (error) {
      console.error('Error cropping image:', error);
      toast.error('Erro ao recortar a imagem. Tente novamente.');
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-[130] flex items-center justify-center p-2 sm:p-4 bg-zinc-950/80 backdrop-blur-xl">
      <motion.div
        initial={{ opacity: 0, scale: 0.95, y: 20 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        className="relative w-full max-w-lg bg-zinc-950 border border-white/10 rounded-3xl md:rounded-[2.5rem] overflow-hidden shadow-[0_20px_50px_rgba(0,0,0,0.8)] flex flex-col max-h-[95vh] md:max-h-[90vh]"
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 md:px-8 md:py-6 border-b border-white/5 bg-zinc-900/50">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center">
              <Sparkles className="w-4 h-4 text-emerald-400" />
            </div>
            <div>
              <h3 className="text-sm font-black text-white uppercase tracking-wider">Ajustar e Cortar Imagem</h3>
              <p className="text-[10px] text-zinc-500 font-bold uppercase tracking-widest mt-0.5">Enquadramento ideal para o PWA</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-2 rounded-full hover:bg-white/5 text-zinc-400 hover:text-white transition-all active:scale-95"
            disabled={isSubmitting}
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Workspace Content */}
        <div className="flex-1 overflow-y-auto p-4 md:p-6 space-y-4 md:space-y-6 flex flex-col items-center">
          
          {/* Quality Indicator Banner */}
          {!loading && (
            <div className={`w-full max-w-sm p-3 md:p-4 rounded-2xl border text-xs font-medium flex items-start gap-3 transition-colors ${
              qualityScore.score === 'excellent' ? 'bg-emerald-500/5 border-emerald-500/20 text-emerald-400' :
              qualityScore.score === 'good' ? 'bg-blue-500/5 border-blue-500/20 text-blue-400' :
              'bg-amber-500/5 border-amber-500/20 text-amber-400'
            }`}>
              <Info className="w-4 h-4 flex-shrink-0 mt-0.5" />
              <div>
                <span className="font-black uppercase tracking-wider block text-[9px] mb-1">
                  Resolução: {imageSize.naturalWidth} x {imageSize.naturalHeight} ({
                    qualityScore.score === 'excellent' ? 'Excelente' :
                    qualityScore.score === 'good' ? 'Boa' : 'Baixa'
                  })
                </span>
                <p className="leading-relaxed text-zinc-400 text-[11px]">{qualityScore.details}</p>
              </div>
            </div>
          )}

          {/* Canvas/Editor Frame Container */}
          <div 
            ref={containerRef}
            className="relative flex items-center justify-center w-full max-w-sm aspect-[4/5] bg-zinc-900 border border-white/5 rounded-3xl overflow-hidden shadow-inner cursor-move"
            onMouseDown={handleMouseDown}
            onMouseMove={handleMouseMove}
            onMouseUp={handleEnd}
            onMouseLeave={handleEnd}
            onTouchStart={handleTouchStart}
            onTouchMove={handleTouchMove}
            onTouchEnd={handleEnd}
          >
            {loading && (
              <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-zinc-950/80 z-20">
                <span className="w-8 h-8 border-3 border-emerald-500/30 border-t-emerald-500 rounded-full animate-spin" />
                <span className="text-[10px] font-black text-zinc-400 uppercase tracking-widest">Carregando Imagem...</span>
              </div>
            )}

            {/* Crop Boundary Overlays (Shade masks) */}
            {!loading && (
              <>
                {/* Semi-transparent dark mask overlay around the viewport */}
                <div className="absolute inset-0 bg-black/60 pointer-events-none z-10 flex items-center justify-center">
                  <div 
                    className="border-2 border-emerald-500/80 shadow-[0_0_0_9999px_rgba(0,0,0,0.7)] rounded-2xl relative overflow-hidden"
                    style={{ 
                      width: viewportWidth, 
                      height: viewportHeight,
                      transition: 'width 0.3s ease-out, height 0.3s ease-out'
                    }}
                  >
                    {/* Grid Lines helper */}
                    <div className="absolute inset-0 grid grid-cols-3 grid-rows-3 pointer-events-none opacity-20">
                      <div className="border-r border-dashed border-white col-span-1" />
                      <div className="border-r border-dashed border-white col-span-1" />
                      <div className="border-b border-dashed border-white row-span-1 col-span-3 absolute left-0 right-0 top-1/3" />
                      <div className="border-b border-dashed border-white row-span-1 col-span-3 absolute left-0 right-0 top-2/3" />
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
              className="absolute select-none pointer-events-none origin-center max-w-none"
              style={{
                transform: `translate(${offset.x}px, ${offset.y}px) rotate(${rotation}deg) scale(${currentScale})`,
                opacity: loading ? 0 : 1,
                transition: isDragging ? 'none' : 'transform 0.15s ease-out'
              }}
            />
          </div>

          {/* Controls Panel */}
          <div className="w-full max-w-sm space-y-4 md:space-y-5 bg-zinc-900/40 p-4 md:p-5 border border-white/5 rounded-3xl">
            {/* Presets Selectors */}
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <label className="text-[9px] font-black text-zinc-500 uppercase tracking-widest">Enquadramento / Proporção</label>
                <span className="text-[8px] font-bold text-emerald-400 uppercase tracking-wider animate-pulse">Vitrine (4:5) é recomendado</span>
              </div>
              <div className="flex flex-wrap gap-2">
                {presets.map((preset) => (
                  <button
                    key={preset}
                    type="button"
                    onClick={() => setAspectRatio(preset)}
                    className={`flex-1 min-w-[80px] py-2 text-[10px] font-black uppercase tracking-wider border rounded-xl transition-all active:scale-95 ${
                      aspectRatio === preset
                        ? 'bg-emerald-500 border-emerald-400 text-emerald-950 shadow-lg shadow-emerald-500/10'
                        : 'bg-zinc-950/50 border-white/5 text-zinc-400 hover:text-white hover:bg-zinc-900'
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
                <label className="text-[9px] font-black text-zinc-500 uppercase tracking-widest">Zoom da Imagem</label>
                <span className="text-[10px] font-black text-zinc-400">{Math.round(zoom * 100)}%</span>
              </div>
              <div className="flex items-center gap-3">
                <button 
                  type="button"
                  onClick={() => handleZoomChange(Math.max(1, zoom - 0.25))}
                  className="p-2 bg-zinc-950 hover:bg-zinc-900 border border-white/5 text-zinc-400 rounded-xl hover:text-white transition-all active:scale-90"
                >
                  <ZoomOut className="w-3.5 h-3.5" />
                </button>
                
                <input
                  type="range"
                  min="1"
                  max="3"
                  step="0.01"
                  value={zoom}
                  onChange={(e) => handleZoomChange(parseFloat(e.target.value))}
                  className="flex-1 accent-emerald-500 h-1 bg-zinc-950 rounded-lg appearance-none cursor-pointer"
                />

                <button 
                  type="button"
                  onClick={() => handleZoomChange(Math.min(3, zoom + 0.25))}
                  className="p-2 bg-zinc-950 hover:bg-zinc-900 border border-white/5 text-zinc-400 rounded-xl hover:text-white transition-all active:scale-90"
                >
                  <ZoomIn className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>

            {/* Rotator */}
            <div className="flex justify-between items-center pt-1 border-t border-white/5">
              <span className="text-[9px] font-black text-zinc-500 uppercase tracking-widest">Rotacionar Imagem</span>
              <button
                type="button"
                onClick={rotateImage}
                className="flex items-center gap-2 px-3 py-1.5 bg-zinc-950 hover:bg-zinc-900 border border-white/5 text-[10px] font-black text-zinc-300 uppercase tracking-widest rounded-xl transition-all active:scale-95"
              >
                <RotateCw className="w-3.5 h-3.5" />
                90° graus
              </button>
            </div>
          </div>
        </div>

        {/* Footer actions */}
        <div className="flex items-center justify-between px-6 py-4 md:px-8 md:py-6 border-t border-white/5 bg-zinc-900/50">
          <div className="flex items-center gap-2 text-[10px] font-medium text-zinc-500">
            <AlertCircle className="w-3.5 h-3.5 text-zinc-500" />
            <span>O corte definitivo será processado e enviado.</span>
          </div>
          
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={onClose}
              disabled={isSubmitting}
              className="px-5 py-3 border border-white/5 hover:border-white/10 bg-zinc-950 hover:bg-zinc-900 text-zinc-400 hover:text-white rounded-2xl text-xs font-black uppercase tracking-widest transition-all active:scale-95"
            >
              Cancelar
            </button>
            <button
              type="button"
              onClick={handleCrop}
              disabled={isSubmitting || loading}
              className="px-6 py-3 bg-emerald-500 hover:bg-emerald-400 text-emerald-950 shadow-lg shadow-emerald-500/10 hover:shadow-emerald-500/20 disabled:bg-zinc-800 disabled:text-zinc-600 disabled:shadow-none rounded-2xl text-xs font-black uppercase tracking-widest transition-all active:scale-95 flex items-center gap-2"
            >
              {isSubmitting ? (
                <>
                  <span className="w-4 h-4 border-2 border-emerald-950/30 border-t-emerald-950 rounded-full animate-spin" />
                  Salvando...
                </>
              ) : (
                <>
                  <Check className="w-4 h-4" />
                  Salvar Ajuste
                </>
              )}
            </button>
          </div>
        </div>
      </motion.div>
    </div>
  );
}
