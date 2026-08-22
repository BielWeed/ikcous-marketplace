import { LazyImage } from "@/components/LazyImage";
import { AdminHelpModal } from "@/components/admin/AdminHelpModal";
import {
  AdminKpiCarousel,
  type KpiCardConfig,
} from "@/components/admin/AdminKpiCarousel";
import { LocalBufferedInput } from "@/components/admin/LocalBufferedInput";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { ImageAdjuster } from "@/components/ui/custom/ImageAdjuster";

import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { branding } from "@/config/branding";
import { useStore } from "@/contexts/StoreContext";
import { useBanners } from "@/hooks/useBanners";
import { useCategories } from "@/hooks/useCategories";
import { useCoupons } from "@/hooks/useCoupons";
import { useLocalStorage } from "@/hooks/useLocalStorage";
import { useOnlineStatus } from "@/hooks/useOnlineStatus";
import { useProducts } from "@/hooks/useProducts";
import { useScrollRestoration } from "@/hooks/useScrollRestoration";
import { cn } from "@/lib/utils";
import type { Banner, View } from "@/types";
import { AnimatePresence, type Variants, motion } from "framer-motion";
import {
  ArrowDown,
  ArrowUp,
  Bell,
  ChevronDown,
  ChevronUp,
  Edit,
  ExternalLink,
  Eye,
  HelpCircle,
  Layout,
  LayoutGrid,
  List,
  Loader2,
  Play,
  Plus,
  Search,
  SlidersHorizontal,
  Sparkles,
  Trash,
  Upload,
  X,
  Zap,
} from "lucide-react";
import {
  type ChangeEvent,
  memo,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { toast } from "sonner";

const getLuminance = (hex: string): number => {
  if (!hex) return 0;
  const c = hex.replace("#", "");
  if (c.length !== 3 && c.length !== 6) return 0;
  let hexColor = c;
  if (c.length === 3) {
    hexColor = c[0] + c[0] + c[1] + c[1] + c[2] + c[2];
  }
  const r = Number.parseInt(hexColor.substring(0, 2), 16) / 255;
  const g = Number.parseInt(hexColor.substring(2, 4), 16) / 255;
  const b = Number.parseInt(hexColor.substring(4, 6), 16) / 255;
  const a = [r, g, b].map((v) => {
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * a[0] + 0.7152 * a[1] + 0.0722 * a[2];
};

const toLocalDatetimeLocal = (isoString?: string | null): string => {
  if (!isoString) return "";
  const d = new Date(isoString);
  if (Number.isNaN(d.getTime())) return "";
  const offset = d.getTimezoneOffset();
  const localDate = new Date(d.getTime() - offset * 60 * 1000);
  return localDate.toISOString().slice(0, 16);
};

const formatDistanceToNow = (
  dateStringOrDate: string | Date | null | undefined,
): string => {
  if (!dateStringOrDate) return "";
  const d = new Date(dateStringOrDate);
  if (Number.isNaN(d.getTime())) return "";
  const now = new Date();
  const diffMs = d.getTime() - now.getTime();
  const absDiff = Math.abs(diffMs);

  const minutes = Math.floor(absDiff / (1000 * 60));
  const hours = Math.floor(absDiff / (1000 * 60 * 60));
  const days = Math.floor(absDiff / (1000 * 60 * 60 * 24));

  if (diffMs > 0) {
    if (days > 0) return `em ${days} ${days === 1 ? "dia" : "dias"}`;
    if (hours > 0) return `em ${hours}h ${minutes % 60}m`;
    return `em ${minutes}m`;
  }
  if (days > 0) return `há ${days} ${days === 1 ? "dia" : "dias"}`;
  if (hours > 0) return `há ${hours}h ${minutes % 60}m`;
  return `há ${minutes}m`;
};

const blendColors = (
  color1: string,
  color2: string,
  weight: number,
): string => {
  const c1 = (color1 || "#FFFFFF").replace("#", "");
  const c2 = (color2 || "#000000").replace("#", "");

  const hex1 =
    c1.length === 3 ? c1[0] + c1[0] + c1[1] + c1[1] + c1[2] + c1[2] : c1;
  const hex2 =
    c2.length === 3 ? c2[0] + c2[0] + c2[1] + c2[1] + c2[2] + c2[2] : c2;

  const r1 = Number.parseInt(hex1.substring(0, 2), 16) || 255;
  const g1 = Number.parseInt(hex1.substring(2, 4), 16) || 255;
  const b1 = Number.parseInt(hex1.substring(4, 6), 16) || 255;

  const r2 = Number.parseInt(hex2.substring(0, 2), 16) || 0;
  const g2 = Number.parseInt(hex2.substring(2, 4), 16) || 0;
  const b2 = Number.parseInt(hex2.substring(4, 6), 16) || 0;

  const r = Math.round(r1 * (1 - weight) + r2 * weight);
  const g = Math.round(g1 * (1 - weight) + g2 * weight);
  const b = Math.round(b1 * (1 - weight) + b2 * weight);

  const toHex = (n: number) =>
    Math.min(255, Math.max(0, n)).toString(16).padStart(2, "0");
  return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
};

const getContrastRatio = (color1: string, color2: string): number => {
  const l1 = getLuminance(color1);
  const l2 = getLuminance(color2);
  const lighter = Math.max(l1, l2);
  const darker = Math.min(l1, l2);
  return Number(((lighter + 0.05) / (darker + 0.05)).toFixed(2));
};

const analyzeImageBrightness = (url: string): Promise<"light" | "dark"> => {
  return new Promise((resolve) => {
    if (!url) {
      resolve("dark");
      return;
    }
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => {
      try {
        const canvas = document.createElement("canvas");
        const ctx = canvas.getContext("2d");
        if (!ctx) {
          resolve("dark");
          return;
        }
        canvas.width = 30;
        canvas.height = 30;
        ctx.drawImage(img, 0, 0, 30, 30);
        const imgData = ctx.getImageData(0, 0, 30, 30);
        const data = imgData.data;
        let totalLuminance = 0;
        let count = 0;
        for (let i = 0; i < data.length; i += 4) {
          if (data[i + 3] < 50) continue;
          const r = data[i] / 255;
          const g = data[i + 1] / 255;
          const b = data[i + 2] / 255;
          const lum = 0.2126 * r + 0.7152 * g + 0.0722 * b;
          totalLuminance += lum;
          count++;
        }
        if (count === 0) {
          resolve("dark");
          return;
        }
        const avgLuminance = totalLuminance / count;
        resolve(avgLuminance > 0.5 ? "light" : "dark");
      } catch (err) {
        console.warn("CORS or canvas issue during brightness analysis:", err);
        resolve("dark");
      }
    };
    img.onerror = () => {
      resolve("dark");
    };
    img.src = url;
  });
};

const extractImageColors = (url: string): Promise<string[]> => {
  return new Promise((resolve) => {
    if (!url) {
      resolve([]);
      return;
    }
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => {
      try {
        const canvas = document.createElement("canvas");
        const ctx = canvas.getContext("2d");
        if (!ctx) {
          resolve([]);
          return;
        }
        canvas.width = 30;
        canvas.height = 30;
        ctx.drawImage(img, 0, 0, 30, 30);
        const imgData = ctx.getImageData(0, 0, 30, 30);
        const data = imgData.data;

        const colorCounts: { [hex: string]: number } = {};
        for (let i = 0; i < data.length; i += 4) {
          const r = data[i];
          const g = data[i + 1];
          const b = data[i + 2];
          const a = data[i + 3];
          if (a < 150) continue;

          const qr = Math.round(r / 24) * 24;
          const qg = Math.round(g / 24) * 24;
          const qb = Math.round(b / 24) * 24;

          const toHex = (n: number) =>
            Math.min(255, Math.max(0, n)).toString(16).padStart(2, "0");
          const hex = `#${toHex(qr)}${toHex(qg)}${toHex(qb)}`.toUpperCase();
          colorCounts[hex] = (colorCounts[hex] || 0) + 1;
        }

        const sortedColors = Object.keys(colorCounts)
          .map((hex) => ({ hex, count: colorCounts[hex] }))
          .sort((a, b) => b.count - a.count);

        const resultColors: string[] = [];

        const getDistance = (c1: string, c2: string) => {
          const r1 = Number.parseInt(c1.substring(1, 3), 16);
          const g1 = Number.parseInt(c1.substring(3, 5), 16);
          const b1 = Number.parseInt(c1.substring(5, 7), 16);
          const r2 = Number.parseInt(c2.substring(1, 3), 16);
          const g2 = Number.parseInt(c2.substring(3, 5), 16);
          const b2 = Number.parseInt(c2.substring(5, 7), 16);
          return Math.sqrt((r1 - r2) ** 2 + (g1 - g2) ** 2 + (b1 - b2) ** 2);
        };

        for (const item of sortedColors) {
          if (resultColors.length >= 6) break;
          const isDistinct = resultColors.every(
            (c) => getDistance(c, item.hex) > 50,
          );
          if (isDistinct) {
            resultColors.push(item.hex);
          }
        }

        if (resultColors.length < 4) {
          for (const item of sortedColors) {
            if (resultColors.length >= 6) break;
            if (!resultColors.includes(item.hex)) {
              resultColors.push(item.hex);
            }
          }
        }

        resolve(resultColors);
      } catch (err) {
        console.warn("Error extracting image colors:", err);
        resolve([]);
      }
    };
    img.onerror = () => {
      resolve([]);
    };
    img.src = url;
  });
};

interface AdminBannersViewProps {
  onNavigate: (view: View) => void;
  active?: boolean;
  onSetDirty?: (dirty: boolean) => void;
  onSetBackOverride?: (fn: (() => void) | null) => void;
}

const containerVariants: Variants = {
  hidden: { opacity: 0 },
  visible: { opacity: 1, transition: { staggerChildren: 0.05 } },
};

const itemVariants: Variants = {
  hidden: { opacity: 0, y: 15, scale: 0.98 },
  visible: {
    opacity: 1,
    y: 0,
    scale: 1,
    transition: { type: "spring", stiffness: 120, damping: 14 },
  },
};

export const AdminBannersView = memo(function AdminBannersView({
  onNavigate: _onNavigate,
  active = true,
  onSetDirty,
  onSetBackOverride,
}: AdminBannersViewProps) {
  const {
    banners,
    isLoaded,
    uploadBannerImage,
    addBanner,
    updateBanner,
    deleteBanner,
    deleteStorageFile,
    reorderBanners,
    refreshBanners,
  } = useBanners(true);
  const { products } = useProducts();
  useCoupons(true);
  const { categories } = useCategories();

  const [searchQueryList, setSearchQueryList] = useState("");
  const [statusFilter, setStatusFilter] = useState<
    "all" | "active" | "paused" | "scheduled" | "expired"
  >("all");

  const isOffline = useOnlineStatus();
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const isSavedRef = useRef(false);
  const [showHelpModal, setShowHelpModal] = useState(false);
  const [editingBanner, setEditingBanner] = useState<Banner | null>(null);
  const [uploading, setUploading] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [selectedTab, setSelectedTab] = useLocalStorage<
    "all" | "home_top" | "home_middle" | "home_bottom"
  >("admin_banners_selected_tab", "all");
  const [viewMode, setViewMode] = useLocalStorage<"detailed" | "compact">(
    "admin_banners_view_mode",
    "compact",
  );
  const [bannerToDelete, setBannerToDelete] = useState<{
    id: string;
    imageUrl: string;
  } | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const [activeAction, setActiveAction] = useState<{
    id: string;
    type: "up" | "down" | "toggle" | "delete";
  } | null>(null);
  const [activeStep, setActiveStep] = useState<1 | 2 | 3>(1);
  const [bannerMode, setBannerMode] = useState<"simple" | "complete">("simple");
  const [bgBrightnessType, setBgBrightnessType] = useState<"light" | "dark">(
    "dark",
  );
  const [destinationMode, setDestinationMode] = useState<
    "none" | "product" | "route" | "custom"
  >("none");
  const [selectedCouponCode, setSelectedCouponCode] = useState<string>("");

  const { config } = useStore();
  const [activeColorElement, setActiveColorElement] = useState<
    | "titleColor"
    | "subtitleColor"
    | "buttonBgColor"
    | "buttonTextColor"
    | "overlayColor"
  >("titleColor");
  const [extractedColors, setExtractedColors] = useState<string[]>([]);

  const [formData, setFormData] = useState<Partial<Banner>>({
    title: "",
    imageUrl: "",
    link: "",
    position: "home_top",
    active: true,
    order: 0,
    subtitle: "",
    titleColor: "",
    subtitleColor: "",
    buttonText: "",
    buttonBgColor: "",
    buttonTextColor: "",
    fontFamily: "",
    overlayColor: "",
    overlayOpacity: 40,
    badgeText: "",
    templateType: "default",
    productId: "",
    startDate: null,
    endDate: null,
    showTextOverlay: true,
  });

  // Sync destinationMode based on link or productId
  useEffect(() => {
    if (formData.productId || formData.link?.includes("/product-detail")) {
      setDestinationMode("product");
    } else if (
      formData.link?.startsWith("http://") ||
      formData.link?.startsWith("https://")
    ) {
      setDestinationMode("custom");
    } else if (formData.link) {
      setDestinationMode("route");
    } else {
      setDestinationMode("none");
    }
  }, [formData.productId, formData.link]);

  const hasButtonText = Boolean(
    formData.buttonText && formData.buttonText.trim().length > 0,
  );
  const targetColorEl =
    !hasButtonText &&
    (activeColorElement === "buttonBgColor" ||
      activeColorElement === "buttonTextColor")
      ? "titleColor"
      : activeColorElement;

  const colorElements = useMemo(
    () => [
      {
        id: "titleColor" as const,
        label: "Título",
        value: formData.titleColor || "#FFFFFF",
      },
      {
        id: "subtitleColor" as const,
        label: "Subtítulo",
        value: formData.subtitleColor || "#9CA3AF",
      },
      ...(hasButtonText
        ? [
            {
              id: "buttonBgColor" as const,
              label: "Fundo Botão",
              value: formData.buttonBgColor || "#FFBF00",
            },
            {
              id: "buttonTextColor" as const,
              label: "Texto Botão",
              value: formData.buttonTextColor || "#000000",
            },
          ]
        : []),
      {
        id: "overlayColor" as const,
        label: "Filtro Fundo",
        value: formData.overlayColor || "#000000",
      },
    ],
    [
      hasButtonText,
      formData.titleColor,
      formData.subtitleColor,
      formData.buttonBgColor,
      formData.buttonTextColor,
      formData.overlayColor,
    ],
  );

  const dynamicRouteSuggestions = useMemo(() => {
    const base = [
      { label: "Sem Redirecionamento", path: "" },
      { label: "Início", path: "/" },
      { label: "Produtos", path: "/produtos" },
      { label: "Carrinho", path: "/checkout" },
      { label: "Perfil", path: "/profile" },
    ];
    const categoryChips = categories
      .filter((c) => c.isActive)
      .map((c) => ({
        label: `Categoria: ${c.name}`,
        path: `/?category=${c.name}`,
      }));
    return [...base, ...categoryChips];
  }, [categories]);

  const themePresets = useMemo(
    () => [
      {
        name: "Dourado Premium",
        description: "Estilo elegante dourado e preto",
        templateType: "glassmorphic",
        fontFamily: "font-display",
        titleColor: "#FFBF00",
        subtitleColor: "#F59E0B",
        buttonBgColor: "#FFBF00",
        buttonTextColor: "#000000",
        overlayColor: "#000000",
        overlayOpacity: 55,
      },
      {
        name: "Neon Cyber",
        description: "Visual futurista rosa e violeta",
        templateType: "neon_glow",
        fontFamily: "font-mono",
        titleColor: "#EC4899",
        subtitleColor: "#A78BFA",
        buttonBgColor: "#EC4899",
        buttonTextColor: "#FFFFFF",
        overlayColor: "#0a090b",
        overlayOpacity: 45,
      },
      {
        name: "Oceano Moderno",
        description: "Design clean ciano e azul marinho",
        templateType: "split_center",
        fontFamily: "system",
        titleColor: "#22D3EE",
        subtitleColor: "#2DD4BF",
        buttonBgColor: "#22D3EE",
        buttonTextColor: "#0F172A",
        overlayColor: "#0B1329",
        overlayOpacity: 30,
      },
      {
        name: "Minimal Escuro",
        description: "Elegância em tons de cinza e branco",
        templateType: "default",
        fontFamily: "system",
        titleColor: "#FFFFFF",
        subtitleColor: "#9CA3AF",
        buttonBgColor: "#FFFFFF",
        buttonTextColor: "#000000",
        overlayColor: "#000000",
        overlayOpacity: 40,
      },
      {
        name: "Sunset Warm",
        description: "Tons quentes de sol e areia",
        templateType: "split_left",
        fontFamily: "font-serif",
        titleColor: "#F59E0B",
        subtitleColor: "#FDA4AF",
        buttonBgColor: "#F59E0B",
        buttonTextColor: "#000000",
        overlayColor: "#1C0A10",
        overlayOpacity: 50,
      },
    ],
    [],
  );

  const presetColors = useMemo(
    () => [
      { name: "Branco", hex: "#FFFFFF" },
      { name: "Preto", hex: "#000000" },
      { name: "Dourado", hex: "#FFBF00" },
      { name: "Rosa Neon", hex: "#EC4899" },
      { name: "Ciano", hex: "#22D3EE" },
      { name: "Esmeralda", hex: "#10B981" },
      { name: "Vermelho", hex: "#EF4444" },
      { name: "Laranja", hex: "#F59E0B" },
      { name: "Violeta", hex: "#8B5CF6" },
    ],
    [],
  );

  const brandingColors = useMemo(() => {
    const list: { name: string; hex: string }[] = [];
    if (config?.primaryColor) {
      list.push({ name: "Primária do Config", hex: config.primaryColor });
    }
    if (branding?.theme?.primary) {
      list.push({ name: "Primária da Marca", hex: branding.theme.primary });
    }
    if (branding?.theme?.secondary) {
      list.push({ name: "Secundária da Marca", hex: branding.theme.secondary });
    }
    if (branding?.theme?.accent) {
      list.push({ name: "Destaque da Marca", hex: branding.theme.accent });
    }
    const seen = new Set<string>();
    return list.filter((item) => {
      const normalized = item.hex.toUpperCase();
      if (seen.has(normalized)) return false;
      seen.add(normalized);
      return true;
    });
  }, [config?.primaryColor]);

  const { ref: viewRef } = useScrollRestoration(
    "admin-banners",
    active ?? false,
    banners.length > 0,
  );

  // Auto-refresh when coming back online
  const wasOfflineRef = useRef(isOffline);
  useEffect(() => {
    if (wasOfflineRef.current && !isOffline && active) {
      toast.success("Conexão restabelecida. Atualizando banners...", {
        icon: "⚡",
      });
      refreshBanners(false, true);
    }
    wasOfflineRef.current = isOffline;
  }, [isOffline, active, refreshBanners]);

  // Image Adjuster integration
  const [isAdjusterOpen, setIsAdjusterOpen] = useState(false);
  const [adjustingImgUrl, setAdjustingImgUrl] = useState("");
  const [isUploadingAdjusted, setIsUploadingAdjusted] = useState(false);

  const openAdjuster = (url: string) => {
    setAdjustingImgUrl(url);
    setIsAdjusterOpen(true);
  };

  const handleAdjustConfirm = async (croppedBlob: Blob) => {
    if (isOffline) {
      toast.error("Sem conexão com a internet", {
        description: "Você precisa estar online para salvar a imagem ajustada.",
      });
      return;
    }
    setIsUploadingAdjusted(true);
    const file = new File([croppedBlob], `banner-image-${Date.now()}.jpg`, {
      type: "image/jpeg",
    });
    const loadingToast = toast.loading("Enviando imagem recortada...");
    try {
      const url = await uploadBannerImage(file);
      if (formData.imageUrl && formData.imageUrl !== editingBanner?.imageUrl) {
        deleteStorageFile(formData.imageUrl).catch(() => {});
      }
      setFormData((prev) => ({ ...prev, imageUrl: url }));
      toast.success("Imagem ajustada com sucesso!", { id: loadingToast });
      setIsAdjusterOpen(false);
    } catch (error) {
      console.error("Error uploading adjusted banner image:", error);
      toast.error("Erro ao salvar imagem ajustada", { id: loadingToast });
    } finally {
      setIsUploadingAdjusted(false);
    }
  };

  const [productSearch, setProductSearch] = useState("");
  const [isPreviewCollapsed, setIsPreviewCollapsed] = useState(false);

  const filteredProducts = useMemo(() => {
    if (!productSearch) return products;
    return products.filter(
      (p) =>
        p.id === formData.productId ||
        p.name.toLowerCase().includes(productSearch.toLowerCase()),
    );
  }, [products, productSearch, formData.productId]);

  const selectedProduct = useMemo(() => {
    return products.find((p) => p.id === formData.productId);
  }, [products, formData.productId]);

  const productSuggestions = useMemo(() => {
    if (!selectedProduct) return null;
    const titleSuggestions = [
      selectedProduct.name,
      `Confira: ${selectedProduct.name}`,
      `Destaque: ${selectedProduct.name}`,
    ];
    if (
      selectedProduct.originalPrice &&
      selectedProduct.originalPrice > selectedProduct.price
    ) {
      const discount = Math.round(
        ((selectedProduct.originalPrice - selectedProduct.price) /
          selectedProduct.originalPrice) *
          100,
      );
      titleSuggestions.push(`${discount}% OFF em ${selectedProduct.name}`);
    }
    if (selectedProduct.freeShipping) {
      titleSuggestions.push(`FRETE GRÁTIS: ${selectedProduct.name}`);
    }

    const subtitleSuggestions = [
      `Por apenas R$ ${Number(selectedProduct.price).toFixed(2)}`,
      "Confira essa oferta especial na nossa loja!",
    ];
    if (
      selectedProduct.originalPrice &&
      selectedProduct.originalPrice > selectedProduct.price
    ) {
      subtitleSuggestions.push(
        `De R$ ${Number(selectedProduct.originalPrice).toFixed(2)} por R$ ${Number(
          selectedProduct.price,
        ).toFixed(2)}`,
      );
    }
    if (selectedProduct.freeShipping) {
      subtitleSuggestions.push("Aproveite o Frete Grátis neste produto!");
    }

    return { titles: titleSuggestions, subtitles: subtitleSuggestions };
  }, [selectedProduct]);

  const filteredBannersList = useMemo(() => {
    const now = new Date();
    return banners.filter((b) => {
      const matchesSearch =
        !searchQueryList ||
        (b.title || "").toLowerCase().includes(searchQueryList.toLowerCase()) ||
        (b.subtitle || "")
          .toLowerCase()
          .includes(searchQueryList.toLowerCase()) ||
        (b.badgeText || "")
          .toLowerCase()
          .includes(searchQueryList.toLowerCase()) ||
        (b.link || "").toLowerCase().includes(searchQueryList.toLowerCase());

      let matchesStatus = true;
      if (statusFilter === "active") {
        matchesStatus =
          b.active &&
          (!b.startDate || new Date(b.startDate) <= now) &&
          (!b.endDate || new Date(b.endDate) >= now);
      } else if (statusFilter === "paused") {
        matchesStatus = !b.active;
      } else if (statusFilter === "scheduled") {
        matchesStatus =
          b.active && !!b.startDate && new Date(b.startDate) > now;
      } else if (statusFilter === "expired") {
        matchesStatus = b.active && !!b.endDate && new Date(b.endDate) < now;
      }

      return matchesSearch && matchesStatus;
    });
  }, [banners, searchQueryList, statusFilter]);

  const computedTitleRatio = useMemo(() => {
    const textHex = formData.titleColor || "#FFFFFF";
    const overlayHex = formData.overlayColor || "#000000";
    const opacityWeight = (formData.overlayOpacity ?? 40) / 100;
    const imgHex = bgBrightnessType === "light" ? "#E5E7EB" : "#1F2937";
    const blendedBg = blendColors(imgHex, overlayHex, opacityWeight);
    return getContrastRatio(textHex, blendedBg);
  }, [
    formData.titleColor,
    formData.overlayColor,
    formData.overlayOpacity,
    bgBrightnessType,
  ]);

  const computedSubtitleRatio = useMemo(() => {
    const textHex = formData.subtitleColor || "#9CA3AF";
    const overlayHex = formData.overlayColor || "#000000";
    const opacityWeight = (formData.overlayOpacity ?? 40) / 100;
    const imgHex = bgBrightnessType === "light" ? "#E5E7EB" : "#1F2937";
    const blendedBg = blendColors(imgHex, overlayHex, opacityWeight);
    return getContrastRatio(textHex, blendedBg);
  }, [
    formData.subtitleColor,
    formData.overlayColor,
    formData.overlayOpacity,
    bgBrightnessType,
  ]);

  const computedButtonRatio = useMemo(() => {
    const btnBg = formData.buttonBgColor || "#FFBF00";
    const btnText = formData.buttonTextColor || "#000000";
    return getContrastRatio(btnBg, btnText);
  }, [formData.buttonBgColor, formData.buttonTextColor]);

  const schedulingConflicts = useMemo(() => {
    if (!formData.startDate && !formData.endDate) {
      return { list: [], level: "none" };
    }

    const start = formData.startDate ? new Date(formData.startDate) : null;
    const end = formData.endDate ? new Date(formData.endDate) : null;
    const now = new Date();

    const conflicts = banners.filter((b) => {
      if (
        b.id === editingBanner?.id ||
        !b.active ||
        b.position !== formData.position
      ) {
        return false;
      }

      const bStart = b.startDate ? new Date(b.startDate) : null;
      const bEnd = b.endDate ? new Date(b.endDate) : null;

      if (!bStart && !bEnd) {
        return true;
      }

      if (bStart && bEnd) {
        const r1Start = start || now;
        const r1End = end || new Date(8640000000000000);
        return r1Start <= bEnd && r1End >= bStart;
      }

      if (bStart && !bEnd) {
        const r1End = end || new Date(8640000000000000);
        return r1End >= bStart;
      }

      if (!bStart && bEnd) {
        const r1Start = start || now;
        return r1Start <= bEnd;
      }

      return false;
    });

    const activeCount = conflicts.length + 1;
    let level: "none" | "low" | "medium" | "high" = "none";
    if (activeCount === 1) level = "low";
    else if (activeCount === 2) level = "medium";
    else if (activeCount >= 3) level = "high";

    return { list: conflicts, level };
  }, [
    formData.startDate,
    formData.endDate,
    formData.position,
    banners,
    editingBanner,
  ]);

  // Suporte a fechamento via tecla Escape
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        if (isDialogOpen) {
          handleOpenChange(false);
        } else if (showHelpModal) {
          setShowHelpModal(false);
        } else if (isAdjusterOpen) {
          setIsAdjusterOpen(false);
        }
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isDialogOpen, showHelpModal, isAdjusterOpen]);

  // Reset modal and adjuster states when active is false to prevent focus traps and scroll lock
  useEffect(() => {
    if (!active) {
      setIsDialogOpen(false);
      setShowHelpModal(false);
      setEditingBanner(null);
      setUploading(false);
      setIsSubmitting(false);
      setBannerToDelete(null);
      setIsAdjusterOpen(false);
      setAdjustingImgUrl("");
      setIsUploadingAdjusted(false);
      setActiveStep(1);
      setSelectedCouponCode("");
      setExtractedColors([]);
    }
  }, [active]);

  useEffect(() => {
    if (onSetBackOverride) {
      if (isDialogOpen) {
        onSetBackOverride(() => () => {
          handleOpenChange(false);
        });
      } else {
        onSetBackOverride(null);
      }
    }
    return () => {
      if (onSetBackOverride) {
        onSetBackOverride(null);
      }
    };
  }, [isDialogOpen, onSetBackOverride]);

  // Analyze image brightness and extract colors when imageUrl changes
  useEffect(() => {
    if (formData.imageUrl) {
      analyzeImageBrightness(formData.imageUrl).then((result) => {
        setBgBrightnessType(result);
      });
      extractImageColors(formData.imageUrl).then((colors) => {
        setExtractedColors(colors);
      });
    } else {
      setExtractedColors([]);
    }
  }, [formData.imageUrl]);

  // Controlar estado dirty do formulário para evitar descarte involuntário
  useEffect(() => {
    if (!onSetDirty) return;
    if (!isDialogOpen) {
      onSetDirty(false);
      return;
    }

    const defaultPosition =
      editingBanner?.position ||
      (selectedTab !== "all" ? selectedTab : "home_top");
    const defaultOrder =
      banners.filter((b) => b.position === defaultPosition).length + 1;
    const initial: Banner = editingBanner || {
      id: "",
      imageUrl: "",
      title: "",
      link: "",
      position: defaultPosition,
      active: true,
      order: defaultOrder,
      subtitle: "",
      titleColor: "",
      subtitleColor: "",
      buttonText: "",
      buttonBgColor: "",
      buttonTextColor: "",
      fontFamily: "",
      overlayColor: "",
      overlayOpacity: 40,
      badgeText: "",
      templateType: "default",
      productId: "",
      startDate: null,
      endDate: null,
    };

    const isDirty =
      (formData.title || "") !== (initial.title || "") ||
      (formData.imageUrl || "") !== (initial.imageUrl || "") ||
      (formData.link || "") !== (initial.link || "") ||
      formData.position !== initial.position ||
      formData.active !== initial.active ||
      Number(formData.order) !== Number(initial.order) ||
      (formData.subtitle || "") !== (initial.subtitle || "") ||
      (formData.titleColor || "") !== (initial.titleColor || "") ||
      (formData.subtitleColor || "") !== (initial.subtitleColor || "") ||
      (formData.buttonText || "") !== (initial.buttonText || "") ||
      (formData.buttonBgColor || "") !== (initial.buttonBgColor || "") ||
      (formData.buttonTextColor || "") !== (initial.buttonTextColor || "") ||
      (formData.fontFamily || "") !== (initial.fontFamily || "") ||
      (formData.overlayColor || "") !== (initial.overlayColor || "") ||
      Number(formData.overlayOpacity ?? 40) !==
        Number(initial.overlayOpacity ?? 40) ||
      (formData.badgeText || "") !== (initial.badgeText || "") ||
      (formData.templateType || "default") !==
        (initial.templateType || "default") ||
      (formData.productId || "") !== (initial.productId || "") ||
      formData.startDate !== initial.startDate ||
      formData.endDate !== initial.endDate;

    onSetDirty(isDirty);
  }, [isDialogOpen, formData, editingBanner, banners, selectedTab, onSetDirty]);

  // State to manage draft recovery
  const [draftToRecover, setDraftToRecover] = useState<{
    formData: Partial<Banner>;
    editingBannerId?: string;
    savedAt: string;
  } | null>(null);

  // Check for drafts when dialog opens
  useEffect(() => {
    if (isDialogOpen) {
      const savedDraft = localStorage.getItem("admin_banner_form_draft");
      if (savedDraft) {
        try {
          const parsed = JSON.parse(savedDraft);
          const currentId = editingBanner?.id || undefined;
          if (parsed.editingBannerId === currentId) {
            setDraftToRecover(parsed);
          } else {
            setDraftToRecover(null);
          }
        } catch {
          setDraftToRecover(null);
        }
      } else {
        setDraftToRecover(null);
      }
    } else {
      setDraftToRecover(null);
    }
  }, [isDialogOpen, editingBanner]);

  // Debounced auto-save effect
  useEffect(() => {
    if (!isDialogOpen || isSavedRef.current) return;

    const defaultPosition =
      editingBanner?.position ||
      (selectedTab !== "all" ? selectedTab : "home_top");
    const defaultOrder =
      banners.filter((b) => b.position === defaultPosition).length + 1;
    const initial: Banner = editingBanner || {
      id: "",
      imageUrl: "",
      title: "",
      link: "",
      position: defaultPosition,
      active: true,
      order: defaultOrder,
      subtitle: "",
      titleColor: "",
      subtitleColor: "",
      buttonText: "",
      buttonBgColor: "",
      buttonTextColor: "",
      fontFamily: "",
      overlayColor: "",
      overlayOpacity: 40,
      badgeText: "",
      templateType: "default",
      productId: "",
      startDate: null,
      endDate: null,
    };

    const hasChanges =
      (formData.title || "") !== (initial.title || "") ||
      (formData.imageUrl || "") !== (initial.imageUrl || "") ||
      (formData.link || "") !== (initial.link || "") ||
      formData.position !== initial.position ||
      formData.active !== initial.active ||
      Number(formData.order) !== Number(initial.order) ||
      (formData.subtitle || "") !== (initial.subtitle || "") ||
      (formData.titleColor || "") !== (initial.titleColor || "") ||
      (formData.subtitleColor || "") !== (initial.subtitleColor || "") ||
      (formData.buttonText || "") !== (initial.buttonText || "") ||
      (formData.buttonBgColor || "") !== (initial.buttonBgColor || "") ||
      (formData.buttonTextColor || "") !== (initial.buttonTextColor || "") ||
      (formData.fontFamily || "") !== (initial.fontFamily || "") ||
      (formData.overlayColor || "") !== (initial.overlayColor || "") ||
      Number(formData.overlayOpacity ?? 40) !==
        Number(initial.overlayOpacity ?? 40) ||
      (formData.badgeText || "") !== (initial.badgeText || "") ||
      (formData.templateType || "default") !==
        (initial.templateType || "default") ||
      (formData.productId || "") !== (initial.productId || "") ||
      formData.startDate !== initial.startDate ||
      formData.endDate !== initial.endDate;

    if (!hasChanges) {
      return;
    }

    const timer = setTimeout(() => {
      const draftData = {
        formData,
        editingBannerId: editingBanner?.id || undefined,
        savedAt: new Date().toISOString(),
      };
      localStorage.setItem(
        "admin_banner_form_draft",
        JSON.stringify(draftData),
      );
    }, 1000);

    return () => clearTimeout(timer);
  }, [formData, isDialogOpen, editingBanner, banners, selectedTab]);

  const handleOpenDialog = (banner?: Banner) => {
    setActiveColorElement("titleColor");
    setProductSearch("");

    let initialCoupon = "";
    if (banner?.link) {
      const match = banner.link.match(/[?&]coupon=([^&]+)/);
      if (match?.[1]) {
        initialCoupon = match[1];
      }
    }
    setSelectedCouponCode(initialCoupon);

    isSavedRef.current = false;
    setActiveStep(1);
    if (banner?.id) {
      setEditingBanner(banner);
      const isSimple =
        !banner.title?.trim() &&
        !banner.subtitle?.trim() &&
        !banner.buttonText?.trim() &&
        !banner.badgeText?.trim();
      setBannerMode(isSimple ? "simple" : "complete");
      setFormData({
        title: banner.title || "",
        imageUrl: banner.imageUrl || "",
        link: banner.link || "",
        position: banner.position || "home_top",
        active: banner.active ?? true,
        order: banner.order || 0,
        subtitle: banner.subtitle || "",
        titleColor: banner.titleColor || "",
        subtitleColor: banner.subtitleColor || "",
        buttonText: banner.buttonText || "",
        buttonBgColor: banner.buttonBgColor || "",
        buttonTextColor: banner.buttonTextColor || "",
        fontFamily: banner.fontFamily || "",
        overlayColor: banner.overlayColor || "",
        overlayOpacity: banner.overlayOpacity ?? 40,
        badgeText: banner.badgeText || "",
        templateType: banner.templateType || "default",
        productId: banner.productId || "",
        startDate: banner.startDate || null,
        endDate: banner.endDate || null,
        showTextOverlay: banner.showTextOverlay ?? true,
      });
    } else {
      setEditingBanner(null);
      setBannerMode("simple");
      const defaultPosition =
        banner?.position || (selectedTab !== "all" ? selectedTab : "home_top");
      setFormData({
        title: "",
        imageUrl: "",
        link: "",
        position: defaultPosition,
        active: true,
        order: banners.filter((b) => b.position === defaultPosition).length + 1,
        subtitle: "",
        titleColor: "",
        subtitleColor: "",
        buttonText: "",
        buttonBgColor: "",
        buttonTextColor: "",
        fontFamily: "",
        overlayColor: "",
        overlayOpacity: 40,
        badgeText: "",
        templateType: "default",
        productId: "",
        startDate: null,
        endDate: null,
        showTextOverlay: true,
      });
    }
    setIsDialogOpen(true);
  };

  useEffect(() => {
    const handleTriggerNewBanner = () => {
      handleOpenDialog();
    };
    window.addEventListener(
      "admin:open-new-banner-dialog",
      handleTriggerNewBanner,
    );
    return () => {
      window.removeEventListener(
        "admin:open-new-banner-dialog",
        handleTriggerNewBanner,
      );
    };
  }, []);

  const handleOpenChange = (open: boolean) => {
    if (!open) {
      setProductSearch("");
      setSelectedCouponCode("");
      if (!isSavedRef.current) {
        if (
          formData.imageUrl &&
          formData.imageUrl !== editingBanner?.imageUrl
        ) {
          deleteStorageFile(formData.imageUrl).catch(() => {});
        }
      }
    }
    setIsDialogOpen(open);
  };

  const handleCloseDialog = () => {
    handleOpenChange(false);
  };

  const handleApplyDatePreset = (preset: "24h" | "weekend" | "7d" | "30d") => {
    const now = new Date();
    let start = new Date();
    let end = new Date();

    if (preset === "24h") {
      end = new Date(now.getTime() + 24 * 60 * 60 * 1000);
    } else if (preset === "weekend") {
      const currentDay = now.getDay();
      const daysToSaturday = (6 - currentDay + 7) % 7;
      if (currentDay === 6 || currentDay === 0) {
        start = now;
      } else {
        start = new Date(
          now.getFullYear(),
          now.getMonth(),
          now.getDate() + daysToSaturday,
          0,
          0,
          0,
        );
      }
      const sundayDate =
        currentDay === 0
          ? now
          : new Date(
              now.getFullYear(),
              now.getMonth(),
              now.getDate() + daysToSaturday + 1,
            );
      end = new Date(
        sundayDate.getFullYear(),
        sundayDate.getMonth(),
        sundayDate.getDate(),
        23,
        59,
        59,
      );
    } else if (preset === "7d") {
      end = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);
    } else if (preset === "30d") {
      end = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);
    }

    setFormData((prev) => ({
      ...prev,
      startDate: start.toISOString(),
      endDate: end.toISOString(),
    }));

    toast.success("Programação de campanha aplicada!", {
      description: `Período: ${start.toLocaleDateString("pt-BR")} a ${end.toLocaleDateString("pt-BR")}`,
      icon: "📅",
    });
  };

  const handleOptimizeContrast = () => {
    const isBgLight = bgBrightnessType === "light";
    setFormData((prev) => {
      const updated = { ...prev };
      if (isBgLight) {
        updated.overlayColor = "#000000";
        updated.overlayOpacity = 60;
        updated.titleColor = "#FFFFFF";
        updated.subtitleColor = "#D1D5DB";
      } else {
        updated.overlayColor = "#000000";
        updated.overlayOpacity = 30;
        updated.titleColor = "#FFFFFF";
        updated.subtitleColor = "#D1D5DB";
      }

      const btnBg = prev.buttonBgColor || "#FFBF00";
      const btnText = prev.buttonTextColor || "#000000";
      const btnRatio = getContrastRatio(btnBg, btnText);
      if (btnRatio < 4.5) {
        const bgLum = getLuminance(btnBg);
        updated.buttonTextColor = bgLum > 0.5 ? "#000000" : "#FFFFFF";
      }
      return updated;
    });

    toast.success("Contraste otimizado com sucesso!", {
      icon: "⚡",
      description:
        "Ajustamos a opacidade do overlay e cores dos textos para o padrão WCAG.",
    });
  };

  const handleAutoThemeFromImage = () => {
    if (extractedColors.length === 0) {
      toast.error("Nenhuma cor extraída da imagem ainda.");
      return;
    }

    setFormData((prev) => {
      const updated = { ...prev };
      const primaryColor = extractedColors[0];
      updated.buttonBgColor = primaryColor;

      const btnLum = getLuminance(primaryColor);
      updated.buttonTextColor = btnLum > 0.5 ? "#000000" : "#FFFFFF";

      updated.overlayColor = "#000000";
      updated.overlayOpacity = 45;
      updated.titleColor = "#FFFFFF";

      if (extractedColors.length > 1) {
        updated.subtitleColor = "#E5E7EB";
      } else {
        updated.subtitleColor = "#D1D5DB";
      }

      return updated;
    });

    toast.success("Tema inteligente gerado da imagem!", {
      icon: "🎨",
      description:
        "Definimos cores contrastantes com base na imagem do banner.",
    });
  };

  const handleFileUpload = async (e: ChangeEvent<HTMLInputElement>) => {
    if (isOffline) {
      toast.error("Sem conexão com a internet", {
        description:
          "Você precisa estar online para fazer o upload de imagens.",
      });
      return;
    }
    const file = e.target.files?.[0];
    if (!file) return;

    setUploading(true);
    const loadingToast = toast.loading("Enviando imagem do banner...");
    try {
      const url = await uploadBannerImage(file);
      if (formData.imageUrl && formData.imageUrl !== editingBanner?.imageUrl) {
        deleteStorageFile(formData.imageUrl).catch(() => {});
      }
      setFormData((prev) => ({ ...prev, imageUrl: url }));
      toast.success("Imagem enviada com sucesso", { id: loadingToast });
    } catch {
      toast.error("Erro ao enviar imagem", { id: loadingToast });
    } finally {
      setUploading(false);
    }
  };

  const handleSubmit = async () => {
    if (isOffline) {
      toast.error("Sem conexão com a internet", {
        description:
          "Você precisa estar online para salvar as alterações do banner.",
      });
      return;
    }
    if (isSubmitting) return;
    setIsSubmitting(true);
    try {
      if (!formData.imageUrl) {
        toast.error("Imagem é obrigatória");
        setIsSubmitting(false);
        return;
      }

      let sanitizedLink = formData.link ? formData.link.trim() : "";
      if (
        sanitizedLink &&
        !sanitizedLink.startsWith("/") &&
        !sanitizedLink.startsWith("http://") &&
        !sanitizedLink.startsWith("https://")
      ) {
        sanitizedLink = `/${sanitizedLink}`;
      }

      const dataToSubmit = {
        ...formData,
        link: sanitizedLink,
        ...(bannerMode === "simple"
          ? {
              title: "",
              subtitle: "",
              buttonText: "",
              badgeText: "",
              titleColor: "",
              subtitleColor: "",
              buttonBgColor: "",
              buttonTextColor: "",
              fontFamily: "",
              overlayColor: "",
              overlayOpacity: 0,
              templateType: "default",
            }
          : {}),
      };

      isSavedRef.current = true;
      localStorage.removeItem("admin_banner_form_draft");
      if (editingBanner) {
        await updateBanner(editingBanner.id, dataToSubmit);
      } else {
        await addBanner(dataToSubmit as Required<Omit<Banner, "id">>);
      }
      setIsDialogOpen(false);
    } catch (error) {
      console.error("Erro ao salvar banner:", error);
      toast.error("Erro ao salvar as configurações do banner.");
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleDelete = (id: string, imageUrl: string) => {
    if (isOffline) {
      toast.error("Sem conexão com a internet", {
        description: "Você precisa estar online para excluir banners.",
      });
      return;
    }
    setBannerToDelete({ id, imageUrl });
  };

  const confirmDeleteBanner = async () => {
    if (!bannerToDelete) return;
    setIsProcessing(true);
    setActiveAction({ id: bannerToDelete.id, type: "delete" });
    try {
      await deleteBanner(bannerToDelete.id, bannerToDelete.imageUrl);
    } catch (error) {
      console.error("Erro ao deletar banner:", error);
      toast.error("Erro ao deletar o banner.");
    } finally {
      setIsProcessing(false);
      setActiveAction(null);
      setBannerToDelete(null);
    }
  };

  const handleToggleActive = async (banner: Banner) => {
    if (isOffline) {
      toast.error("Sem conexão com a internet", {
        description:
          "Você precisa estar online para alternar a visibilidade do banner.",
      });
      return;
    }
    setIsProcessing(true);
    setActiveAction({ id: banner.id, type: "toggle" });
    try {
      await updateBanner(banner.id, { active: !banner.active });
    } catch (error) {
      console.error("Erro ao alternar status do banner:", error);
    } finally {
      setIsProcessing(false);
      setActiveAction(null);
    }
  };

  const moveBanner = async (banner: Banner, direction: "up" | "down") => {
    if (isOffline) {
      toast.error("Sem conexão com a internet", {
        description:
          "Você precisa estar online para alterar a ordem dos banners.",
      });
      return;
    }
    const bannersInPosition = banners
      .filter((b) => b.position === banner.position)
      .sort((a, b) => (a.order ?? 0) - (b.order ?? 0));

    const currentIndex = bannersInPosition.findIndex((b) => b.id === banner.id);
    const targetIndex =
      direction === "up" ? currentIndex - 1 : currentIndex + 1;

    if (targetIndex >= 0 && targetIndex < bannersInPosition.length) {
      const targetBanner = bannersInPosition[targetIndex];
      setIsProcessing(true);
      setActiveAction({ id: banner.id, type: direction });
      try {
        await reorderBanners(banner.id, targetBanner.id);
      } catch (error) {
        console.error("Erro ao reordenar banners:", error);
        toast.error("Erro ao reordenar banners.");
      } finally {
        setIsProcessing(false);
        setActiveAction(null);
      }
    }
  };

  const positions = [
    { value: "home_top", label: "Cabeçalho Inicial (Topo)" },
    { value: "home_middle", label: "Seção Intermediária (Meio)" },
    { value: "home_bottom", label: "Rodapé da Página (Base)" },
  ];

  // Compute Metrics
  const totalBanners = banners.length;
  const activeBanners = banners.filter((b) => b.active).length;
  const topActive = banners.some((b) => b.position === "home_top" && b.active);
  const middleActive = banners.some(
    (b) => b.position === "home_middle" && b.active,
  );
  const bottomActive = banners.some(
    (b) => b.position === "home_bottom" && b.active,
  );
  const activeSectionsCount = [topActive, middleActive, bottomActive].filter(
    Boolean,
  ).length;
  const impactText =
    activeSectionsCount === 3
      ? "Máximo"
      : activeSectionsCount === 2
        ? "Alto"
        : activeSectionsCount === 1
          ? "Moderado"
          : "Nenhum";

  const visiblePositions =
    selectedTab === "all"
      ? positions
      : positions.filter((pos) => pos.value === selectedTab);

  const kpiCards = useMemo<readonly KpiCardConfig[]>(
    () => [
      {
        id: "ativos",
        label: "Banners Ativos",
        icon: Eye,
        iconClass: "text-[#FFBF00] animate-pulse",
        iconBg: "bg-amber-500/10 border-amber-500/20",
        hoverBorder:
          "hover:border-[#FFBF00]/30 hover:shadow-[0_0_30px_rgba(255,191,0,0.05)]",
        value: activeBanners,
        accent: "text-[#FFBF00]",
        subValue: `/ ${totalBanners} total`,
        footer: "Banners atualmente visíveis no app",
      },
      {
        id: "distribuicao",
        label: "Distribuição",
        icon: Layout,
        iconClass: "text-amber-500",
        iconBg: "bg-zinc-900 border-white/5",
        hoverBorder:
          "hover:border-amber-500/30 hover:shadow-[0_0_30px_rgba(245,158,11,0.05)]",
        value: `${banners.filter((b) => b.position === "home_top").length} Topo`,
        accent: "text-amber-500",
        subValue: `Meio: ${banners.filter((b) => b.position === "home_middle").length} • Base: ${banners.filter((b) => b.position === "home_bottom").length}`,
        footer: "Posicionamento na Home",
      },
      {
        id: "impacto",
        label: "Impacto Estético",
        icon: Sparkles,
        iconClass: "text-[#FFBF00]",
        iconBg: "bg-[#FFBF00]/10 border-[#FFBF00]/20",
        hoverBorder:
          "hover:border-[#FFBF00]/30 hover:shadow-[0_0_30px_rgba(255,191,0,0.05)]",
        value: impactText,
        accent: "text-[#FFBF00]",
        footer: "Preenchimento das seções",
      },
    ],
    [activeBanners, totalBanners, banners, impactText],
  );

  const renderSkeleton = () => (
    <div className="animate-pulse select-none space-y-16">
      {visiblePositions.map((pos) => (
        <div key={pos.value} className="space-y-6">
          {selectedTab === "all" && (
            <div className="flex items-center justify-between border-b border-white/5 px-2 pb-4">
              <div className="flex items-center gap-3">
                <Skeleton className="size-3.5 rounded-full bg-white/5" />
                <Skeleton className="h-4.5 w-32 rounded bg-white/5" />
              </div>
              <Skeleton className="h-3 w-16 rounded bg-white/5" />
            </div>
          )}
          <div className="grid gap-6">
            {[1, 2].map((i) => (
              <div
                key={i}
                className="flex h-[230px] flex-col items-center gap-6 rounded-[2.5rem] border border-white/5 bg-zinc-950/30 p-4 sm:h-[180px] sm:p-5 lg:h-[230px] lg:flex-row xl:h-[180px]"
              >
                <Skeleton className="aspect-[21/9] w-full shrink-0 rounded-2xl bg-white/5 lg:w-[380px] xl:w-[440px]" />
                <div className="w-full flex-1 space-y-4">
                  <div className="flex items-start justify-between gap-4">
                    <div className="flex-1 space-y-2">
                      <Skeleton className="h-5 w-1/2 rounded bg-white/5" />
                      <div className="flex gap-2">
                        <Skeleton className="h-4.5 w-16 rounded bg-white/5" />
                        <Skeleton className="h-4.5 w-16 rounded bg-white/5" />
                      </div>
                    </div>
                    <Skeleton className="h-8 w-16 rounded bg-white/5" />
                  </div>
                  <div className="h-px w-full bg-white/5" />
                  <div className="flex gap-3">
                    <Skeleton className="h-9 flex-1 rounded-xl bg-white/5" />
                    <Skeleton className="h-9 w-20 rounded-xl bg-white/5" />
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );

  const renderCompactSkeleton = () => (
    <div className="animate-pulse select-none space-y-12">
      {visiblePositions.map((pos) => (
        <div key={pos.value} className="space-y-4">
          {selectedTab === "all" && (
            <div className="flex items-center justify-between border-b border-white/5 px-2 pb-2">
              <div className="flex items-center gap-2">
                <Skeleton className="size-2 rounded-full bg-white/5" />
                <Skeleton className="h-4 w-24 rounded bg-white/5" />
              </div>
              <Skeleton className="h-3 w-12 rounded bg-white/5" />
            </div>
          )}
          <div className="grid gap-3">
            {[1, 2, 3].map((i) => (
              <div
                key={i}
                className="flex flex-col gap-3 rounded-2xl border border-white/5 bg-zinc-950/10 p-3 sm:flex-row sm:items-center sm:justify-between"
              >
                <div className="flex min-w-0 flex-1 items-center gap-3">
                  <Skeleton className="aspect-[21/9] w-24 shrink-0 rounded-lg bg-white/5 sm:w-28" />
                  <div className="min-w-0 flex-1 space-y-2">
                    <div className="flex items-center gap-1.5">
                      <Skeleton className="h-4 w-1/3 rounded bg-white/5" />
                      <Skeleton className="h-3.5 w-8 rounded bg-white/5" />
                    </div>
                    <Skeleton className="h-3 w-1/2 rounded bg-white/5" />
                  </div>
                </div>
                <div className="flex shrink-0 items-center justify-between gap-3 border-t border-white/5 pt-2 sm:justify-end sm:border-t-0 sm:pt-0">
                  <div className="flex gap-1">
                    <Skeleton className="size-7 rounded bg-white/5" />
                    <Skeleton className="size-7 rounded bg-white/5" />
                  </div>
                  <Skeleton className="h-5 w-10 rounded-full bg-white/5" />
                </div>
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );

  return (
    <div
      ref={viewRef}
      className="relative h-auto w-full max-w-full overflow-x-hidden bg-[#09090b] pb-admin lg:pb-12 font-sans text-zinc-400 selection:bg-admin-gold/30 selection:text-white"
    >
      {/* Ambient subtle glow */}
      <div className="pointer-events-none absolute left-1/4 top-0 h-[400px] w-[400px] rounded-full bg-admin-gold/5 blur-[120px]" />
      <div className="pointer-events-none absolute right-1/4 top-1/3 h-[500px] w-[500px] rounded-full bg-amber-500/5 blur-[150px]" />

      {/* Sticky Desktop Header */}
      {!isDialogOpen && (
        <>
          <div className="hidden lg:block sticky top-0 z-40 w-full border-b border-white/10 bg-[#09090b]/95 px-3.5 sm:px-5 py-2 shadow-lg backdrop-blur-xl transition-all duration-300">
            <div className="mx-auto flex max-w-7xl items-center justify-between gap-2">
              <div className="flex items-center gap-2.5 min-w-0">
                <div className="flex size-7.5 items-center justify-center rounded-lg border border-[#FFBF00]/25 bg-[#FFBF00]/10 text-[#FFBF00] shadow-[0_0_10px_rgba(255,191,0,0.15)] shrink-0">
                  <LayoutGrid className="size-3.5" />
                </div>
                <div className="flex flex-col min-w-0">
                  <div className="flex items-center gap-1.5 min-w-0">
                    <h1 className="select-none text-xs font-black uppercase tracking-wider text-white truncate sm:text-sm">
                      Gerenciador de Banners
                    </h1>
                    <button
                      type="button"
                      onClick={() => setShowHelpModal(true)}
                      className="flex size-4 shrink-0 items-center justify-center rounded-full border border-white/10 bg-zinc-900/80 text-zinc-400 transition-all duration-300 hover:border-[#FFBF00]/40 hover:bg-[#FFBF00]/10 hover:text-[#FFBF00] active:scale-95"
                      title="Guia do Gerenciador de Banners"
                    >
                      <HelpCircle className="size-2.5" />
                    </button>
                  </div>
                  <div className="flex items-center gap-1.5 text-[9px] font-medium text-zinc-400">
                    <span className="flex items-center gap-1">
                      <span className="size-1.5 rounded-full bg-emerald-400 shadow-[0_0_6px_rgba(52,211,153,0.6)] animate-pulse" />
                      <span className="font-semibold text-emerald-400 uppercase text-[9px] tracking-wider">
                        {activeBanners} Ativo{activeBanners !== 1 ? "s" : ""}
                      </span>
                    </span>
                    <span className="text-zinc-600">•</span>
                    <span className="text-zinc-400 text-[9px] uppercase tracking-wider">
                      {totalBanners} Total
                    </span>
                  </div>
                </div>
              </div>

              {isLoaded && banners.length > 0 && (
                <button
                  type="button"
                  onClick={() => handleOpenDialog()}
                  disabled={isOffline}
                  className="group flex shrink-0 items-center justify-center gap-1.5 rounded-lg border border-[#FFBF00]/30 bg-gradient-to-r from-[#FFBF00] via-amber-450 to-amber-500 px-3 py-1.5 text-[10px] sm:text-xs font-black uppercase tracking-wider text-black shadow-[0_2px_12px_rgba(255,191,0,0.2)] transition-all duration-300 hover:scale-[1.02] hover:from-amber-400 hover:to-amber-500 active:scale-[0.98] disabled:pointer-events-none disabled:opacity-50"
                >
                  <Plus className="size-3 stroke-[3px] transition-transform duration-300 group-hover:rotate-90" />
                  <span>Novo Banner</span>
                </button>
              )}
            </div>
          </div>

          <div className="relative z-10 mx-auto max-w-7xl space-y-8 p-4 sm:p-6 lg:p-8">
            {/* Stats Carousel Row */}
            {isLoaded && banners.length > 0 && (
              <div className="space-y-4">
                <AdminKpiCarousel
                  cards={kpiCards}
                  active={active}
                  title="Métricas Visuais"
                />
              </div>
            )}

            {/* Filter Tabs & Options */}
            {isLoaded && banners.length > 0 && (
              <div className="select-none space-y-4">
                <div className="flex items-center justify-between gap-2 border-b border-white/5 pb-3">
                  <div className="relative flex items-center rounded-xl border border-white/5 bg-zinc-950 p-0.5">
                    <button
                      onClick={() => setSelectedTab("all")}
                      className={cn(
                        "px-3 py-1.5 rounded-lg text-[9px] font-black uppercase tracking-wider transition-all duration-300 relative",
                        selectedTab === "all"
                          ? "text-black"
                          : "text-zinc-500 hover:text-zinc-300",
                      )}
                    >
                      <span className="relative z-10">Todos</span>
                      {selectedTab === "all" && (
                        <motion.div
                          layoutId="activeBannerTab"
                          className="absolute inset-0 rounded-lg bg-gradient-to-r from-[#FFBF00] to-amber-500 shadow-md"
                          transition={{
                            type: "spring",
                            stiffness: 380,
                            damping: 30,
                          }}
                        />
                      )}
                    </button>
                    <button
                      onClick={() => setSelectedTab("home_top")}
                      className={cn(
                        "px-3 py-1.5 rounded-lg text-[9px] font-black uppercase tracking-wider transition-all duration-300 relative",
                        selectedTab === "home_top"
                          ? "text-black"
                          : "text-zinc-500 hover:text-zinc-300",
                      )}
                    >
                      <span className="relative z-10">Topo</span>
                      {selectedTab === "home_top" && (
                        <motion.div
                          layoutId="activeBannerTab"
                          className="absolute inset-0 rounded-lg bg-gradient-to-r from-[#FFBF00] to-amber-500 shadow-md"
                          transition={{
                            type: "spring",
                            stiffness: 380,
                            damping: 30,
                          }}
                        />
                      )}
                    </button>
                    <button
                      onClick={() => setSelectedTab("home_middle")}
                      className={cn(
                        "px-3 py-1.5 rounded-lg text-[9px] font-black uppercase tracking-wider transition-all duration-300 relative",
                        selectedTab === "home_middle"
                          ? "text-black"
                          : "text-zinc-500 hover:text-zinc-300",
                      )}
                    >
                      <span className="relative z-10">Meio</span>
                      {selectedTab === "home_middle" && (
                        <motion.div
                          layoutId="activeBannerTab"
                          className="absolute inset-0 rounded-lg bg-gradient-to-r from-[#FFBF00] to-amber-500 shadow-md"
                          transition={{
                            type: "spring",
                            stiffness: 380,
                            damping: 30,
                          }}
                        />
                      )}
                    </button>
                    <button
                      onClick={() => setSelectedTab("home_bottom")}
                      className={cn(
                        "px-3 py-1.5 rounded-lg text-[9px] font-black uppercase tracking-wider transition-all duration-300 relative",
                        selectedTab === "home_bottom"
                          ? "text-black"
                          : "text-zinc-500 hover:text-zinc-300",
                      )}
                    >
                      <span className="relative z-10">Base</span>
                      {selectedTab === "home_bottom" && (
                        <motion.div
                          layoutId="activeBannerTab"
                          className="absolute inset-0 rounded-lg bg-gradient-to-r from-[#FFBF00] to-amber-500 shadow-md"
                          transition={{
                            type: "spring",
                            stiffness: 380,
                            damping: 30,
                          }}
                        />
                      )}
                    </button>
                  </div>

                  <Button
                    variant="outline"
                    size="icon"
                    onClick={() =>
                      setViewMode((prev) =>
                        prev === "detailed" ? "compact" : "detailed",
                      )
                    }
                    className="group size-8 shrink-0 rounded-lg border-zinc-800 bg-zinc-900/60 transition-all hover:border-admin-gold/50 hover:bg-zinc-800 focus-visible:ring-0 focus-visible:ring-offset-0"
                    title={
                      viewMode === "detailed"
                        ? "Visualização Compacta"
                        : "Visualização Detalhada"
                    }
                  >
                    {viewMode === "detailed" ? (
                      <List className="size-4 text-zinc-500 transition-colors group-hover:text-admin-gold" />
                    ) : (
                      <LayoutGrid className="size-4 text-zinc-500 transition-colors group-hover:text-admin-gold" />
                    )}
                  </Button>
                </div>

                {/* Search & Status Filters Row */}
                <div className="flex w-full items-center gap-2 border-b border-white/5 pb-3">
                  <div className="relative flex-1">
                    <Input
                      id="banner-search-input"
                      name="bannerSearch"
                      type="text"
                      placeholder="Buscar campanhas..."
                      value={searchQueryList}
                      onChange={(e) => setSearchQueryList(e.target.value)}
                      className="h-10 rounded-xl border-white/10 bg-zinc-900/50 px-10 text-xs text-white placeholder:text-zinc-500 focus:ring-[#FFBF00]"
                    />
                    <Search className="pointer-events-none absolute left-3.5 top-1/2 size-4 -translate-y-1/2 text-zinc-500" />
                    {searchQueryList && (
                      <button
                        onClick={() => setSearchQueryList("")}
                        className="absolute right-3.5 top-1/2 -translate-y-1/2 text-zinc-500 hover:text-white"
                      >
                        <X className="size-4" />
                      </button>
                    )}
                  </div>
                  <div className="w-28 shrink-0">
                    <Select
                      name="statusFilter"
                      value={statusFilter}
                      onValueChange={(val: any) => setStatusFilter(val)}
                    >
                      <SelectTrigger
                        id="banner-status-filter"
                        className="h-10 rounded-xl border-white/10 bg-zinc-900/50 text-[10px] font-bold uppercase tracking-wider focus:ring-[#FFBF00]"
                      >
                        <SelectValue placeholder="Status" />
                      </SelectTrigger>
                      <SelectContent className="border-white/10 bg-zinc-950 text-white">
                        <SelectItem value="all" className="text-xs">
                          Todos
                        </SelectItem>
                        <SelectItem value="active" className="text-xs">
                          Ativos
                        </SelectItem>
                        <SelectItem value="paused" className="text-xs">
                          Pausados
                        </SelectItem>
                        <SelectItem value="scheduled" className="text-xs">
                          Agendados
                        </SelectItem>
                        <SelectItem value="expired" className="text-xs">
                          Expirados
                        </SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>
              </div>
            )}

            {/* Banner Content List */}
            {!isLoaded && banners.length === 0 ? (
              <div className="py-6">
                {viewMode === "compact"
                  ? renderCompactSkeleton()
                  : renderSkeleton()}
              </div>
            ) : isLoaded && filteredBannersList.length === 0 ? (
              <div className="group/empty flex flex-col items-center justify-center rounded-[2.5rem] border border-dashed border-white/5 bg-zinc-950/20 p-12 py-16 text-center backdrop-blur-sm transition-all duration-300 hover:border-zinc-800">
                <SlidersHorizontal className="mb-3 size-8 animate-pulse text-zinc-700 transition-colors group-hover/empty:text-zinc-500" />
                <p className="mb-2 text-[10px] font-bold uppercase tracking-widest text-zinc-500">
                  Nenhum Banner encontrado
                </p>
                <p className="text-zinc-655 max-w-xs text-[9px] leading-relaxed">
                  Tente ajustar a busca ou o filtro de status para visualizar as
                  campanhas.
                </p>
                {(searchQueryList || statusFilter !== "all") && (
                  <button
                    onClick={() => {
                      setSearchQueryList("");
                      setStatusFilter("all");
                    }}
                    className="mt-3 text-[10px] font-black uppercase tracking-widest text-[#FFBF00] underline transition-colors hover:text-white"
                  >
                    Limpar Filtros
                  </button>
                )}
              </div>
            ) : (
              <motion.div
                variants={containerVariants}
                initial="hidden"
                animate="visible"
                className={cn(
                  viewMode === "compact" ? "space-y-10" : "space-y-16",
                )}
              >
                {visiblePositions.map((pos) => {
                  const positionBanners = filteredBannersList
                    .filter((b) => b.position === pos.value)
                    .sort((a, b) => (a.order ?? 0) - (b.order ?? 0));

                  return (
                    <div
                      key={pos.value}
                      className={cn(
                        viewMode === "compact" ? "space-y-4" : "space-y-6",
                      )}
                    >
                      {selectedTab === "all" && (
                        <div className="flex select-none items-center justify-between border-b border-white/5 px-2 pb-2">
                          <div className="flex items-center gap-3">
                            <div className="size-2.5 animate-pulse rounded-full bg-gradient-to-br from-[#FFBF00] to-amber-500 shadow-[0_0_10px_rgba(255,191,0,0.5)]" />
                            <h2 className="text-xs font-black uppercase italic tracking-widest text-white">
                              {pos.label}
                            </h2>
                          </div>
                          <span className="text-[9px] font-bold uppercase tracking-widest text-zinc-500">
                            {positionBanners.length}{" "}
                            {positionBanners.length === 1
                              ? "Banner"
                              : "Banners"}
                          </span>
                        </div>
                      )}

                      {positionBanners.length === 0 ? (
                        <div className="group/empty flex flex-col items-center justify-center rounded-[2.5rem] border border-dashed border-white/5 bg-zinc-950/20 p-12 text-center backdrop-blur-sm transition-all duration-300 hover:border-zinc-800">
                          <Layout className="mb-3 size-8 text-zinc-700 transition-colors group-hover/empty:text-zinc-500" />
                          <p className="mb-2 text-[10px] font-bold uppercase tracking-widest text-zinc-500">
                            {searchQueryList || statusFilter !== "all"
                              ? "Nenhum Banner neste setor para os filtros ativos"
                              : "Nenhum Banner cadastrado neste Setor"}
                          </p>
                          {!searchQueryList && statusFilter === "all" && (
                            <button
                              onClick={() =>
                                handleOpenDialog({
                                  position: pos.value,
                                } as Banner)
                              }
                              disabled={isOffline}
                              className="text-[10px] font-black uppercase tracking-widest text-[#FFBF00] underline transition-colors hover:text-white disabled:pointer-events-none disabled:opacity-50 disabled:grayscale"
                            >
                              + Adicionar Primeiro Banner
                            </button>
                          )}
                        </div>
                      ) : (
                        <motion.div
                          layout
                          className={
                            viewMode === "compact" ? "grid gap-3" : "grid gap-6"
                          }
                        >
                          {positionBanners.map((banner, index) => {
                            if (viewMode === "compact") {
                              return (
                                <motion.div
                                  layout
                                  key={banner.id}
                                  variants={itemVariants}
                                  className={cn(
                                    "group relative w-full max-w-full overflow-hidden bg-zinc-950/20 border border-white/5 rounded-2xl p-3 transition-all duration-300 hover:border-zinc-800 hover:bg-zinc-950/40 hover:shadow-lg",
                                    !banner.active && "opacity-60",
                                  )}
                                >
                                  <div className="flex w-full max-w-full flex-col gap-2.5 sm:flex-row sm:items-center sm:justify-between">
                                    {/* Left Side: Thumbnail, Title, Sector/Order badges, and Link */}
                                    <div className="flex min-w-0 w-full flex-1 items-center gap-3">
                                      {/* Thumbnail */}
                                      <div className="relative aspect-[21/9] w-24 shrink-0 overflow-hidden rounded-lg border border-white/5 bg-zinc-900 shadow-md sm:w-28">
                                        <LazyImage
                                          src={banner.imageUrl}
                                          alt={banner.title || "Banner"}
                                          className="size-full object-cover"
                                        />
                                        {!banner.active && (
                                          <div className="absolute inset-0 flex items-center justify-center bg-black/60 text-[7px] font-black uppercase tracking-wider text-white/80">
                                            Pausado
                                          </div>
                                        )}
                                      </div>

                                      {/* Title, Badge and Link Info */}
                                      <div className="min-w-0 flex-1 space-y-1 overflow-hidden">
                                        <div className="flex flex-wrap items-center gap-1.5 min-w-0">
                                          <h4 className="truncate min-w-0 max-w-full text-xs font-bold text-white transition-colors group-hover:text-admin-gold">
                                            {banner.title ||
                                              "Campanha sem Título"}
                                          </h4>
                                          <div className="shrink-0 rounded border border-white/5 bg-zinc-900 px-1.5 py-0.5 text-[8px] font-bold text-zinc-400">
                                            #{banner.order}
                                          </div>
                                          {selectedTab === "all" && (
                                            <div className="shrink-0 rounded border border-white/5 bg-zinc-900 px-1.5 py-0.5 text-[8px] font-bold text-zinc-400">
                                              {pos.label.split(" ")[0]}
                                            </div>
                                          )}
                                          {(() => {
                                            if (!banner.active) return null;
                                            const now = new Date();
                                            if (
                                              banner.startDate &&
                                              new Date(banner.startDate) > now
                                            ) {
                                              return (
                                                <div className="shrink-0 rounded border border-amber-500/20 bg-amber-500/10 px-1.5 py-0.5 text-[8px] font-black uppercase text-[#FFBF00]">
                                                  Agendado (
                                                  {formatDistanceToNow(
                                                    banner.startDate,
                                                  )}
                                                  )
                                                </div>
                                              );
                                            }
                                            if (
                                              banner.endDate &&
                                              new Date(banner.endDate) < now
                                            ) {
                                              return (
                                                <div className="shrink-0 rounded border border-rose-500/20 bg-rose-500/10 px-1.5 py-0.5 text-[8px] font-black uppercase text-rose-400">
                                                  Expirado (
                                                  {formatDistanceToNow(
                                                    banner.endDate,
                                                  )}
                                                  )
                                                </div>
                                              );
                                            }
                                            if (
                                              banner.endDate &&
                                              new Date(banner.endDate) >= now
                                            ) {
                                              return (
                                                <div className="shrink-0 rounded border border-emerald-500/20 bg-emerald-500/10 px-1.5 py-0.5 text-[8px] font-black uppercase text-emerald-400">
                                                  Ativo (expira{" "}
                                                  {formatDistanceToNow(
                                                    banner.endDate,
                                                  )}
                                                  )
                                                </div>
                                              );
                                            }
                                            if (
                                              banner.startDate &&
                                              new Date(banner.startDate) <= now
                                            ) {
                                              return (
                                                <div className="shrink-0 rounded border border-emerald-500/20 bg-emerald-500/10 px-1.5 py-0.5 text-[8px] font-black uppercase text-emerald-400">
                                                  Ativo (iniciou{" "}
                                                  {formatDistanceToNow(
                                                    banner.startDate,
                                                  )}
                                                  )
                                                </div>
                                              );
                                            }
                                            return null;
                                          })()}
                                        </div>
                                        <div className="flex min-w-0 w-full items-center gap-1 font-mono text-[8px] text-zinc-500">
                                          <ExternalLink className="size-2.5 shrink-0 text-amber-500" />
                                          <span className="truncate min-w-0 flex-1">
                                            {banner.link || "Início (Sem Rota)"}
                                          </span>
                                        </div>
                                        {banner.startDate &&
                                          banner.endDate &&
                                          banner.active &&
                                          (() => {
                                            const now = new Date();
                                            const start = new Date(
                                              banner.startDate,
                                            );
                                            const end = new Date(
                                              banner.endDate,
                                            );
                                            if (now >= start && now <= end) {
                                              const total =
                                                end.getTime() - start.getTime();
                                              const elapsed =
                                                now.getTime() - start.getTime();
                                              const pct = Math.min(
                                                100,
                                                Math.max(
                                                  0,
                                                  (elapsed / total) * 100,
                                                ),
                                              );
                                              return (
                                                <div className="w-full space-y-1 pt-1 duration-300 animate-in fade-in">
                                                  <div className="flex items-center justify-between text-[7px] font-bold uppercase tracking-widest text-zinc-500">
                                                    <span>Campanha</span>
                                                    <span className="text-emerald-450 font-mono">
                                                      {Math.round(pct)}%
                                                    </span>
                                                  </div>
                                                  <div className="h-0.5 w-full overflow-hidden rounded-full border border-white/5 bg-zinc-900">
                                                    <div
                                                      className="h-full rounded-full bg-gradient-to-r from-emerald-500 to-teal-400"
                                                      style={{
                                                        width: `${pct}%`,
                                                      }}
                                                    />
                                                  </div>
                                                </div>
                                              );
                                            }
                                            return null;
                                          })()}
                                      </div>
                                    </div>

                                    {/* Right Side: Reordering, Switch & Actions */}
                                    <div className="flex w-full shrink-0 items-center justify-between gap-2 border-t border-white/5 pt-2 sm:w-auto sm:justify-end sm:border-t-0 sm:pt-0">
                                      {/* Reordering & Status Toggle */}
                                      <div className="flex items-center gap-1.5 sm:gap-2">
                                        {/* Up/Down buttons in a small pill */}
                                        <div className="flex items-center gap-0.5 rounded-lg border border-white/5 bg-zinc-900/40 p-0.5">
                                          <button
                                            onClick={() =>
                                              moveBanner(banner, "up")
                                            }
                                            disabled={
                                              index === 0 ||
                                              isProcessing ||
                                              isOffline
                                            }
                                            className="flex size-6 items-center justify-center rounded bg-zinc-950 text-zinc-400 transition-colors hover:text-white disabled:opacity-10"
                                            title="Mover para cima"
                                          >
                                            {activeAction?.id === banner.id &&
                                            activeAction?.type === "up" ? (
                                              <Loader2 className="size-3 animate-spin text-[#FFBF00]" />
                                            ) : (
                                              <ArrowUp className="size-3" />
                                            )}
                                          </button>
                                          <button
                                            onClick={() =>
                                              moveBanner(banner, "down")
                                            }
                                            disabled={
                                              index ===
                                                positionBanners.length - 1 ||
                                              isProcessing ||
                                              isOffline
                                            }
                                            className="flex size-6 items-center justify-center rounded bg-zinc-950 text-zinc-400 transition-colors hover:text-white disabled:opacity-10"
                                            title="Mover para baixo"
                                          >
                                            {activeAction?.id === banner.id &&
                                            activeAction?.type === "down" ? (
                                              <Loader2 className="size-3 animate-spin text-[#FFBF00]" />
                                            ) : (
                                              <ArrowDown className="size-3" />
                                            )}
                                          </button>
                                        </div>

                                        {/* Visibility Switch */}
                                        <div className="flex items-center gap-1 rounded-lg border border-white/5 bg-zinc-900/40 px-1.5 py-1">
                                          <span className="text-[7px] font-bold uppercase tracking-wider text-zinc-500">
                                            Exibir
                                          </span>
                                          <Switch
                                            checked={banner.active}
                                            onCheckedChange={() =>
                                              handleToggleActive(banner)
                                            }
                                            disabled={
                                              (activeAction?.id === banner.id &&
                                                activeAction?.type ===
                                                  "toggle") ||
                                              isOffline
                                            }
                                            className="scale-75 data-[state=checked]:bg-[#FFBF00]"
                                          />
                                        </div>
                                      </div>

                                      {/* Actions Toolbar */}
                                      <div className="flex items-center gap-1">
                                        <button
                                          onClick={() =>
                                            handleOpenDialog(banner)
                                          }
                                          disabled={isProcessing || isOffline}
                                          className="flex size-7 items-center justify-center rounded-md border border-white/5 bg-zinc-900 text-zinc-400 transition-all hover:bg-zinc-800 hover:text-white active:scale-95"
                                          title="Editar"
                                        >
                                          <Edit className="size-3.5 text-[#FFBF00]" />
                                        </button>
                                        <button
                                          onClick={() =>
                                            handleDelete(
                                              banner.id,
                                              banner.imageUrl,
                                            )
                                          }
                                          disabled={isProcessing || isOffline}
                                          className="flex size-7 items-center justify-center rounded-md border border-red-500/20 bg-red-500/10 text-red-400 transition-all hover:bg-red-500 hover:text-white active:scale-95"
                                          title="Excluir"
                                        >
                                          {activeAction?.id === banner.id &&
                                          activeAction?.type === "delete" ? (
                                            <Loader2 className="size-3 animate-spin" />
                                          ) : (
                                            <Trash className="size-3.5" />
                                          )}
                                        </button>
                                      </div>
                                    </div>
                                  </div>
                                </motion.div>
                              );
                            }

                            return (
                              <motion.div
                                layout
                                key={banner.id}
                                variants={itemVariants}
                                className={cn(
                                  "group relative w-full max-w-full overflow-hidden bg-zinc-950/30 backdrop-blur-md border border-white/5 rounded-2xl p-3 sm:p-5 sm:rounded-[2.5rem] transition-all duration-300 hover:border-zinc-800 hover:bg-zinc-950/50 hover:shadow-2xl",
                                  !banner.active && "opacity-50",
                                )}
                              >
                                <div className="flex w-full max-w-full flex-col gap-3 sm:gap-6 lg:flex-row lg:items-center">
                                  {/* Top Row / Main Area: Image Thumbnail + Details */}
                                  <div className="flex min-w-0 w-full flex-1 items-center gap-3 sm:gap-4">
                                    {/* Image Preview Thumbnail */}
                                    <div className="relative aspect-[21/9] w-24 shrink-0 overflow-hidden rounded-xl border border-white/5 bg-zinc-900 shadow-md transition-all duration-300 sm:w-48 sm:rounded-2xl lg:w-[360px] xl:w-[420px]">
                                      <LazyImage
                                        src={banner.imageUrl}
                                        alt={banner.title || "Banner"}
                                        className="size-full object-cover transition-transform duration-700 group-hover:scale-105"
                                      />
                                      <div className="absolute inset-0 bg-gradient-to-t from-black/60 via-transparent to-transparent opacity-80" />
                                      {!banner.active && (
                                        <div className="absolute inset-0 flex items-center justify-center bg-black/65 px-2 text-center text-[7.5px] font-black uppercase italic tracking-wider text-white/80 backdrop-blur-[1px] sm:text-[9px]">
                                          Pausado
                                        </div>
                                      )}
                                    </div>

                                    {/* Details and Metadata */}
                                    <div className="min-w-0 flex-1 space-y-1 overflow-hidden">
                                      <div className="flex flex-wrap items-center gap-1 sm:gap-1.5 min-w-0">
                                        <h3 className="truncate min-w-0 max-w-full text-xs font-bold leading-snug tracking-tight text-white transition-colors duration-300 group-hover:text-admin-gold sm:text-base">
                                          {banner.title ||
                                            "Campanha sem Título"}
                                        </h3>
                                        <div className="shrink-0 rounded border border-white/5 bg-zinc-900 px-1.5 py-0.5 text-[8px] font-bold text-zinc-400 sm:text-[9px]">
                                          #{banner.order}
                                        </div>
                                        {selectedTab === "all" && (
                                          <div className="shrink-0 rounded border border-white/5 bg-zinc-900 px-1.5 py-0.5 text-[8px] font-bold text-zinc-400 sm:text-[9px]">
                                            {pos.label.split(" ")[0]}
                                          </div>
                                        )}
                                        {(() => {
                                          if (!banner.active) return null;
                                          const now = new Date();
                                          if (
                                            banner.startDate &&
                                            new Date(banner.startDate) > now
                                          ) {
                                            return (
                                              <div className="shrink-0 rounded border border-amber-500/20 bg-amber-500/10 px-1.5 py-0.5 text-[8px] font-black uppercase text-[#FFBF00]">
                                                Agendado
                                              </div>
                                            );
                                          }
                                          if (
                                            banner.endDate &&
                                            new Date(banner.endDate) < now
                                          ) {
                                            return (
                                              <div className="shrink-0 rounded border border-rose-500/20 bg-rose-500/10 px-1.5 py-0.5 text-[8px] font-black uppercase text-rose-400">
                                                Expirado
                                              </div>
                                            );
                                          }
                                          if (
                                            banner.startDate ||
                                            banner.endDate
                                          ) {
                                            return (
                                              <div className="shrink-0 rounded border border-emerald-500/20 bg-emerald-500/10 px-1.5 py-0.5 text-[8px] font-black uppercase text-emerald-400">
                                                Programado
                                              </div>
                                            );
                                          }
                                          return null;
                                        })()}
                                      </div>

                                      {/* Link Route Line */}
                                      <div className="flex min-w-0 w-full max-w-full items-center gap-1 font-mono text-[8.5px] text-zinc-400 sm:text-xs">
                                        <ExternalLink className="size-2.5 shrink-0 text-[#FFBF00] sm:size-3" />
                                        <span className="truncate min-w-0 flex-1">
                                          {banner.link || "Início (Sem Rota)"}
                                        </span>
                                      </div>

                                      {/* Campaign Progress Bar */}
                                      {banner.startDate &&
                                        banner.endDate &&
                                        banner.active &&
                                        (() => {
                                          const now = new Date();
                                          const start = new Date(
                                            banner.startDate,
                                          );
                                          const end = new Date(banner.endDate);
                                          if (now >= start && now <= end) {
                                            const total =
                                              end.getTime() - start.getTime();
                                            const elapsed =
                                              now.getTime() - start.getTime();
                                            const pct = Math.min(
                                              100,
                                              Math.max(
                                                0,
                                                (elapsed / total) * 100,
                                              ),
                                            );
                                            return (
                                              <div className="w-full space-y-0.5 pt-0.5">
                                                <div className="flex items-center justify-between text-[7px] font-bold uppercase tracking-widest text-zinc-500">
                                                  <span>Progresso</span>
                                                  <span className="font-mono text-emerald-400">
                                                    {Math.round(pct)}%
                                                  </span>
                                                </div>
                                                <div className="h-0.5 w-full overflow-hidden rounded-full border border-white/5 bg-zinc-900">
                                                  <div
                                                    className="h-full rounded-full bg-gradient-to-r from-emerald-500 to-teal-400"
                                                    style={{
                                                      width: `${pct}%`,
                                                    }}
                                                  />
                                                </div>
                                              </div>
                                            );
                                          }
                                          return null;
                                        })()}
                                    </div>
                                  </div>

                                  {/* Controls & Actions Toolbar */}
                                  <div className="flex w-full shrink-0 items-center justify-between gap-1.5 border-t border-white/5 pt-2 sm:w-auto sm:justify-end sm:border-t-0 sm:pt-0">
                                    {/* Reordering arrows & Visibility Switch */}
                                    <div className="flex items-center gap-1.5 sm:gap-2">
                                      {/* Up/Down buttons pill */}
                                      <div className="flex items-center gap-0.5 rounded-lg border border-white/5 bg-zinc-900/40 p-0.5">
                                        <button
                                          onClick={() =>
                                            moveBanner(banner, "up")
                                          }
                                          disabled={
                                            index === 0 ||
                                            isProcessing ||
                                            isOffline
                                          }
                                          className="flex size-6 sm:size-7 items-center justify-center rounded bg-zinc-950 text-zinc-400 transition-colors hover:text-white disabled:opacity-10"
                                          title="Mover para cima"
                                        >
                                          {activeAction?.id === banner.id &&
                                          activeAction?.type === "up" ? (
                                            <Loader2 className="size-3 animate-spin text-[#FFBF00]" />
                                          ) : (
                                            <ArrowUp className="size-3" />
                                          )}
                                        </button>
                                        <button
                                          onClick={() =>
                                            moveBanner(banner, "down")
                                          }
                                          disabled={
                                            index ===
                                              positionBanners.length - 1 ||
                                            isProcessing ||
                                            isOffline
                                          }
                                          className="flex size-6 sm:size-7 items-center justify-center rounded bg-zinc-950 text-zinc-400 transition-colors hover:text-white disabled:opacity-10"
                                          title="Mover para baixo"
                                        >
                                          {activeAction?.id === banner.id &&
                                          activeAction?.type === "down" ? (
                                            <Loader2 className="size-3 animate-spin text-[#FFBF00]" />
                                          ) : (
                                            <ArrowDown className="size-3" />
                                          )}
                                        </button>
                                      </div>

                                      {/* Fast Status Switch */}
                                      <div className="flex items-center gap-1 rounded-lg border border-white/5 bg-zinc-900/40 px-1.5 py-1">
                                        <span className="text-[7.5px] sm:text-[9px] font-bold uppercase tracking-wider text-zinc-500">
                                          Exibir
                                        </span>
                                        <Switch
                                          id={`banner-card-active-${banner.id}`}
                                          checked={banner.active}
                                          onCheckedChange={() =>
                                            handleToggleActive(banner)
                                          }
                                          disabled={
                                            (activeAction?.id === banner.id &&
                                              activeAction?.type ===
                                                "toggle") ||
                                            isOffline
                                          }
                                          className="scale-75 data-[state=checked]:bg-[#FFBF00]"
                                        />
                                      </div>
                                    </div>

                                    {/* Action Buttons Toolbar */}
                                    <div className="flex items-center gap-1">
                                      <button
                                        onClick={() => handleOpenDialog(banner)}
                                        disabled={isProcessing || isOffline}
                                        className="flex h-7 sm:h-8 items-center justify-center gap-1.5 rounded-lg border border-white/5 bg-zinc-900 px-2 sm:px-3 text-[10px] sm:text-xs font-semibold text-zinc-300 transition-all hover:bg-zinc-800 hover:text-white active:scale-95 disabled:pointer-events-none disabled:opacity-50"
                                        title="Editar Banner"
                                      >
                                        <Edit className="size-3 shrink-0 text-[#FFBF00]" />
                                        <span className="hidden sm:inline">
                                          Editar
                                        </span>
                                      </button>
                                      <button
                                        onClick={() =>
                                          handleDelete(
                                            banner.id,
                                            banner.imageUrl,
                                          )
                                        }
                                        disabled={isProcessing || isOffline}
                                        className="flex h-7 sm:h-8 items-center justify-center gap-1.5 rounded-lg border border-red-500/20 bg-red-500/10 px-2 sm:px-3 text-[10px] sm:text-xs font-semibold text-red-400 transition-all hover:border-transparent hover:bg-red-500 hover:text-white active:scale-95 disabled:pointer-events-none disabled:opacity-50"
                                        title="Excluir Banner"
                                      >
                                        {activeAction?.id === banner.id &&
                                        activeAction?.type === "delete" ? (
                                          <Loader2 className="size-3 animate-spin" />
                                        ) : (
                                          <Trash className="size-3 shrink-0" />
                                        )}
                                        <span className="hidden sm:inline">
                                          Excluir
                                        </span>
                                      </button>
                                    </div>
                                  </div>
                                </div>
                              </motion.div>
                            );
                          })}
                        </motion.div>
                      )}
                    </div>
                  );
                })}
              </motion.div>
            )}
          </div>
        </>
      )}

      {/* Formulário de Cadastro / Edição (Renderizado Inline como Página) */}
      {isDialogOpen && (
        <div className="relative z-10 mx-auto w-full max-w-2xl space-y-4 overflow-x-hidden px-4 pb-6 pt-0 text-white sm:px-6 sm:pb-8 sm:pt-0 lg:px-8 lg:pb-10 lg:pt-0">
          <div className="pointer-events-none absolute -right-40 -top-40 size-80 rounded-full bg-admin-gold/5 blur-[120px]" />
          <div className="pointer-events-none absolute bottom-0 -left-40 size-80 rounded-full bg-[#FFBF00]/5 blur-[120px]" />

          <div className="w-full space-y-4 sm:space-y-5">
            {/* CABEÇALHO ANCORADO / STICKY COM PRÉ-VISUALIZAÇÃO AO VIVO INTEGRADA */}
            <div className="sticky top-0 z-40 -mx-4 px-4 sm:-mx-6 sm:px-6 lg:-mx-8 lg:px-8 bg-[#09090b] border-b border-white/10 shadow-2xl pt-1.5 pb-2 sm:pb-2.5 space-y-1.5 sm:space-y-2 transition-all duration-300">
              {/* Cabeçalho Ultra-Compacto em Duas Linhas Independentes (Zero Sobreposição) */}
              <div className="space-y-1.5">
                {/* Linha 1: Título e Seleção de Modo (Simples / Completo) */}
                <div className="flex select-none items-center justify-between gap-2 border-b border-white/5 pb-1.5">
                  <h2 className="flex items-center gap-1.5 text-xs sm:text-sm font-black uppercase italic tracking-wider text-white shrink-0">
                    <Sparkles className="size-4 shrink-0 text-[#FFBF00] sm:size-5" />
                    <span>
                      {editingBanner ? "Editar Banner" : "Novo Banner"}
                    </span>
                  </h2>

                  {/* Segmented Control de Modo (Simples / Completo) */}
                  <div className="flex shrink-0 select-none items-center gap-0.5 rounded-xl border border-white/5 bg-zinc-950 p-0.5">
                    <button
                      type="button"
                      onClick={() => setBannerMode("simple")}
                      className={cn(
                        "px-2 py-0.5 sm:px-2.5 sm:py-1 rounded-lg text-[8.5px] sm:text-[9px] font-bold uppercase tracking-wider transition-all duration-300 relative",
                        bannerMode === "simple"
                          ? "text-black font-extrabold"
                          : "text-zinc-500 hover:text-zinc-300",
                      )}
                    >
                      <span className="relative z-10">Simples</span>
                      {bannerMode === "simple" && (
                        <motion.div
                          layoutId="activeBannerMode"
                          className="absolute inset-0 rounded-lg bg-gradient-to-r from-[#FFBF00] to-amber-500 shadow-md"
                          transition={{
                            type: "spring",
                            stiffness: 380,
                            damping: 30,
                          }}
                        />
                      )}
                    </button>
                    <button
                      type="button"
                      onClick={() => setBannerMode("complete")}
                      className={cn(
                        "px-2 py-0.5 sm:px-2.5 sm:py-1 rounded-lg text-[8.5px] sm:text-[9px] font-bold uppercase tracking-wider transition-all duration-300 relative",
                        bannerMode === "complete"
                          ? "text-black font-extrabold"
                          : "text-zinc-500 hover:text-zinc-300",
                      )}
                    >
                      <span className="relative z-10">Completo</span>
                      {bannerMode === "complete" && (
                        <motion.div
                          layoutId="activeBannerMode"
                          className="absolute inset-0 rounded-lg bg-gradient-to-r from-[#FFBF00] to-amber-500 shadow-md"
                          transition={{
                            type: "spring",
                            stiffness: 380,
                            damping: 30,
                          }}
                        />
                      )}
                    </button>
                  </div>
                </div>

                {/* Linha 2: Stepper Horizontal Compacto e Independente (1 Conteúdo | 2 Estilo | 3 Destino) */}
                {bannerMode === "complete" && (
                  <div className="flex items-center justify-center gap-1.5 sm:gap-2.5 py-0.5 select-none border-b border-white/5 pb-1.5">
                    {[
                      { step: 1, label: "Conteúdo" },
                      { step: 2, label: "Estilo" },
                      { step: 3, label: "Destino" },
                    ].map((s) => {
                      const isActive = activeStep === s.step;
                      const isCompleted = activeStep > s.step;
                      return (
                        <button
                          key={s.step}
                          type="button"
                          onClick={() => {
                            if (
                              editingBanner ||
                              isCompleted ||
                              s.step < activeStep
                            ) {
                              setActiveStep(s.step as any);
                            }
                          }}
                          disabled={
                            !editingBanner &&
                            !isCompleted &&
                            s.step > activeStep
                          }
                          className={cn(
                            "flex cursor-pointer items-center gap-1.5 px-2 py-0.5 rounded-lg border transition-all duration-200 focus:outline-none disabled:opacity-40",
                            isActive
                              ? "border-[#FFBF00] bg-[#FFBF00]/15 text-white shadow-[0_0_10px_rgba(255,191,0,0.15)] ring-1 ring-[#FFBF00]/50"
                              : isCompleted
                                ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-400"
                                : "border-white/5 bg-zinc-900/40 text-zinc-500 hover:border-white/10",
                          )}
                        >
                          <div
                            className={cn(
                              "flex size-4.5 items-center justify-center rounded-full text-[9px] font-black shrink-0 transition-all",
                              isActive
                                ? "bg-[#FFBF00] text-black shadow-sm"
                                : isCompleted
                                  ? "bg-emerald-500 text-black"
                                  : "bg-zinc-800 text-zinc-400",
                            )}
                          >
                            {isCompleted ? "✓" : s.step}
                          </div>
                          <span
                            className={cn(
                              "text-[8.5px] font-black uppercase tracking-wider leading-none",
                              isActive
                                ? "text-[#FFBF00]"
                                : isCompleted
                                  ? "text-emerald-400"
                                  : "text-zinc-400",
                            )}
                          >
                            {s.label}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>

              {/* CARD SUPERIOR: PAINEL DE PRÉ-VISUALIZAÇÃO AO VIVO DO BANNER (ANCORADO / STICKY EM TODOS OS MODOS) */}
              <div className="space-y-1.5 sm:space-y-2.5 rounded-xl sm:rounded-2xl border border-amber-500/20 bg-zinc-950 p-2 sm:p-3.5 shadow-2xl transition-all duration-300">
                <div className="flex select-none items-center justify-between border-b border-white/5 pb-1.5 sm:pb-2">
                  <div className="flex items-center gap-1.5 min-w-0">
                    <Eye className="size-3.5 shrink-0 text-[#FFBF00] animate-pulse" />
                    <h3 className="text-[10px] sm:text-[11px] font-black uppercase italic tracking-wider text-white truncate">
                      <span>Pré-Visualização ao Vivo</span>
                      <span className="hidden md:inline text-zinc-400 font-semibold normal-case not-italic ml-1">
                        (Como o cliente verá)
                      </span>
                    </h3>
                  </div>
                  <div className="flex items-center gap-1.5 shrink-0">
                    <span className="rounded-full border border-amber-500/30 bg-amber-500/10 px-1.5 py-0.5 text-[7px] sm:text-[7.5px] font-black uppercase tracking-wider text-[#FFBF00] whitespace-nowrap">
                      <span className="sm:hidden">Ao vivo ⚡</span>
                      <span className="hidden sm:inline">
                        Atualização em Tempo Real ⚡
                      </span>
                    </span>
                    <button
                      type="button"
                      onClick={() => setIsPreviewCollapsed((prev) => !prev)}
                      className="flex size-5.5 sm:size-6 items-center justify-center rounded-md sm:rounded-lg border border-white/10 bg-zinc-900 text-zinc-400 transition-all hover:border-amber-400/40 hover:text-white active:scale-95"
                      title={
                        isPreviewCollapsed
                          ? "Expandir pré-visualização"
                          : "Recolher pré-visualização"
                      }
                    >
                      {isPreviewCollapsed ? (
                        <ChevronDown className="size-3 sm:size-3.5" />
                      ) : (
                        <ChevronUp className="size-3 sm:size-3.5" />
                      )}
                    </button>
                  </div>
                </div>

                {!isPreviewCollapsed && (
                  <div className="relative aspect-[21/9] w-full select-none overflow-hidden rounded-xl border border-white/10 bg-zinc-900 shadow-inner duration-200 animate-in fade-in">
                    {formData.imageUrl ? (
                      <img
                        src={formData.imageUrl}
                        alt="Banner Preview"
                        className="size-full object-cover"
                      />
                    ) : (
                      <div className="flex size-full items-center justify-center bg-gradient-to-br from-zinc-800 via-zinc-900 to-black p-4 text-center">
                        <span className="text-[10px] font-extrabold uppercase tracking-widest text-zinc-600">
                          {bannerMode === "simple"
                            ? "Insira uma imagem de banner para pré-visualizar"
                            : "Insira uma imagem no Passo 1 ou selecione as cores abaixo"}
                        </span>
                      </div>
                    )}

                    {bannerMode !== "simple" &&
                      formData.showTextOverlay !== false && (
                        <>
                          <div
                            className="absolute inset-0 transition-all duration-200"
                            style={{
                              backgroundColor:
                                formData.overlayColor || "#000000",
                              opacity: (formData.overlayOpacity ?? 40) / 100,
                            }}
                          />

                          <div
                            className={cn(
                              "absolute inset-0 flex flex-col p-3.5 sm:p-5 transition-all duration-300",
                              (formData.templateType || "default") ===
                                "split_center" &&
                                "items-center justify-center text-center",
                              formData.templateType === "split_right" &&
                                "items-end justify-center text-right",
                              formData.templateType === "split_left" &&
                                "items-start justify-center text-left",
                              formData.templateType === "glassmorphic" &&
                                "items-center justify-center p-3 text-center",
                              (formData.templateType || "default") ===
                                "default" &&
                                "items-start justify-end text-left",
                            )}
                          >
                            <div
                              className={cn(
                                "flex flex-col gap-1 max-w-[88%] transition-all duration-300",
                                formData.templateType === "glassmorphic" &&
                                  "rounded-xl border border-white/15 bg-black/40 p-3 backdrop-blur-md shadow-xl",
                              )}
                            >
                              {formData.badgeText && (
                                <span
                                  className="w-max rounded-md bg-[#FFBF00] px-2 py-0.5 text-[8px] font-black uppercase tracking-wider text-black shadow-md self-start"
                                  style={{
                                    alignSelf:
                                      formData.templateType ===
                                        "split_center" ||
                                      formData.templateType === "glassmorphic"
                                        ? "center"
                                        : formData.templateType ===
                                            "split_right"
                                          ? "flex-end"
                                          : "flex-start",
                                  }}
                                >
                                  {formData.badgeText}
                                </span>
                              )}

                              <h2
                                className={cn(
                                  "text-xs sm:text-base md:text-lg font-black leading-tight tracking-wide transition-colors",
                                  formData.fontFamily || "font-sans",
                                )}
                                style={{
                                  color: formData.titleColor || "#FFFFFF",
                                  textShadow:
                                    formData.templateType === "neon_glow"
                                      ? `0 0 12px ${formData.titleColor || "#FFBF00"}`
                                      : "0 2px 4px rgba(0,0,0,0.6)",
                                }}
                              >
                                {formData.title || "Título da Sua Campanha"}
                              </h2>

                              <p
                                className={cn(
                                  "text-[9px] sm:text-xs font-medium leading-snug opacity-90 transition-colors line-clamp-2",
                                  formData.fontFamily || "font-sans",
                                )}
                                style={{
                                  color: formData.subtitleColor || "#9CA3AF",
                                  textShadow: "0 1px 3px rgba(0,0,0,0.7)",
                                }}
                              >
                                {formData.subtitle ||
                                  "Subtítulo atraente descrevendo sua oferta especial."}
                              </p>

                              {formData.buttonText && (
                                <div className="mt-0.5">
                                  <span
                                    className={cn(
                                      "inline-block rounded-lg px-2.5 py-0.5 text-[8px] sm:text-[9.5px] font-black uppercase tracking-wider shadow-lg transition-transform hover:scale-105",
                                      formData.fontFamily || "font-sans",
                                    )}
                                    style={{
                                      backgroundColor:
                                        formData.buttonBgColor || "#FFBF00",
                                      color:
                                        formData.buttonTextColor || "#000000",
                                      boxShadow:
                                        formData.templateType === "neon_glow"
                                          ? `0 0 10px ${formData.buttonBgColor || "#FFBF00"}`
                                          : undefined,
                                    }}
                                  >
                                    {formData.buttonText}
                                  </span>
                                </div>
                              )}
                            </div>
                          </div>
                        </>
                      )}
                  </div>
                )}
              </div>
            </div>

            {/* Draft Recovery Alert */}
            {draftToRecover && (
              <motion.div
                initial={{ opacity: 0, y: -10 }}
                animate={{ opacity: 1, y: 0 }}
                className="flex select-none flex-col justify-between gap-3.5 rounded-2xl border border-amber-500/25 bg-amber-500/10 p-4 duration-300 animate-in fade-in slide-in-from-top-3 sm:flex-row sm:items-center"
              >
                <div className="flex items-start gap-3">
                  <Sparkles className="mt-0.5 size-5 shrink-0 animate-pulse text-[#FFBF00]" />
                  <div>
                    <h4 className="text-xs font-black uppercase tracking-wider text-white">
                      Rascunho Auto-salvo Detectado
                    </h4>
                    <p className="mt-1 text-[10px] font-medium leading-tight text-zinc-400">
                      Você possui alterações não salvas criadas{" "}
                      {formatDistanceToNow(draftToRecover.savedAt)}. Deseja
                      recuperar?
                    </p>
                  </div>
                </div>
                <div className="flex shrink-0 items-center gap-2 self-end sm:sm:self-center">
                  <button
                    type="button"
                    onClick={() => {
                      localStorage.removeItem("admin_banner_form_draft");
                      setDraftToRecover(null);
                      toast.info("Rascunho descartado.");
                    }}
                    className="cursor-pointer rounded-xl border border-white/10 bg-zinc-950 px-3.5 py-2 text-[9px] font-black uppercase tracking-wider text-zinc-400 transition-all hover:border-white/20 hover:text-white active:scale-95"
                  >
                    Descartar
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setFormData(draftToRecover.formData);
                      setDraftToRecover(null);
                      toast.success("Rascunho recuperado com sucesso!", {
                        icon: "⚡",
                      });
                    }}
                    className="cursor-pointer rounded-xl bg-[#FFBF00] px-4 py-2 text-[9px] font-black uppercase tracking-wider text-black shadow-md transition-all hover:bg-[#FFBF00]/95 active:scale-95"
                  >
                    Recuperar
                  </button>
                </div>
              </motion.div>
            )}

            <div className="space-y-5">
              <AnimatePresence mode="wait">
                {bannerMode === "simple" ? (
                  <motion.div
                    key="simple-view"
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -10 }}
                    transition={{ duration: 0.2 }}
                    className="space-y-5"
                  >
                    {/* Card 1: Imagem da Campanha */}
                    <div className="space-y-4 rounded-2xl border border-white/5 bg-zinc-900/10 p-4">
                      <div className="flex select-none items-center gap-2 border-b border-white/5 pb-2">
                        <Upload className="size-4 text-[#FFBF00]" />
                        <h3 className="text-xs font-black uppercase italic tracking-wider text-white">
                          Imagem do Banner
                        </h3>
                      </div>

                      <div className="space-y-1.5">
                        <div className="mb-0.5 flex select-none items-baseline justify-between">
                          <Label
                            htmlFor="banner-upload"
                            className="ml-1 text-[9px] font-black uppercase italic tracking-widest text-zinc-500 opacity-85"
                          >
                            Imagem do Banner
                          </Label>
                          <span className="text-[8px] font-bold uppercase tracking-wider text-zinc-500">
                            {formData.position === "home_top"
                              ? "Recomendado: 4:1 (ex: 1200x300px)"
                              : "Recomendado: 21:9 (ex: 1200x500px)"}
                          </span>
                        </div>
                        <div className="flex flex-col gap-3">
                          {uploading ? (
                            <div className="flex h-24 w-full flex-col items-center justify-center gap-2 rounded-2xl border border-white/5 bg-zinc-900/40">
                              <div className="size-6 animate-spin rounded-full border-2 border-zinc-700 border-t-[#FFBF00]" />
                              <span className="text-[9px] font-black uppercase tracking-[0.2em] text-zinc-500">
                                Enviando Imagem...
                              </span>
                            </div>
                          ) : formData.imageUrl ? (
                            <div className="flex flex-col justify-between gap-3 rounded-2xl border border-white/10 bg-zinc-950/70 p-3 shadow-inner sm:flex-row sm:items-center">
                              <div className="flex items-center gap-3 min-w-0">
                                <div className="relative h-14 w-28 shrink-0 overflow-hidden rounded-xl border border-white/10 bg-zinc-900 shadow-md">
                                  <img
                                    src={formData.imageUrl}
                                    alt="Preview Thumbnail"
                                    className="size-full object-cover"
                                  />
                                </div>
                                <div className="flex flex-col min-w-0">
                                  <span className="text-[10px] font-black uppercase italic tracking-wider text-white truncate">
                                    Imagem Selecionada
                                  </span>
                                  <span className="mt-0.5 flex items-center gap-1.5 text-[8px] font-bold tracking-wider text-emerald-400">
                                    <span className="size-1.5 rounded-full bg-emerald-400 animate-pulse shrink-0" />
                                    Carregada com Sucesso
                                  </span>
                                </div>
                              </div>

                              <div className="flex items-center gap-2 shrink-0">
                                <Label
                                  htmlFor="banner-upload"
                                  className="cursor-pointer select-none rounded-xl border border-white/10 bg-zinc-900 px-3.5 py-2 text-[9px] font-black uppercase tracking-widest text-white transition-all hover:border-white/20 hover:bg-zinc-800 active:scale-95"
                                >
                                  Alterar
                                </Label>
                                <Button
                                  type="button"
                                  onClick={() =>
                                    openAdjuster(formData.imageUrl!)
                                  }
                                  className="flex cursor-pointer select-none items-center gap-1.5 rounded-xl bg-[#FFBF00] px-3.5 py-2 text-[9px] font-black uppercase tracking-widest text-black shadow-md transition-all duration-200 hover:bg-[#FFBF00]/90 active:scale-95"
                                >
                                  <SlidersHorizontal className="size-3.5" />
                                  Ajustar
                                </Button>
                              </div>
                            </div>
                          ) : (
                            <div className="relative">
                              <Label
                                htmlFor="banner-upload"
                                className="group flex h-28 w-full cursor-pointer flex-col items-center justify-center gap-2.5 rounded-2xl border-2 border-dashed border-white/5 bg-zinc-900/50 text-[10px] font-black uppercase tracking-[0.2em] text-zinc-650 transition-all hover:border-amber-400/30 hover:bg-zinc-900"
                              >
                                <Upload className="size-7 text-zinc-500 transition-colors group-hover:text-[#FFBF00]" />
                                <span>Enviar Imagem Principal</span>
                              </Label>
                            </div>
                          )}
                          <Input
                            id="banner-upload"
                            name="banner-upload"
                            type="file"
                            accept="image/*"
                            className="hidden"
                            onChange={handleFileUpload}
                            disabled={uploading}
                          />
                        </div>
                      </div>
                    </div>

                    {/* Card 2: Seletor de Posição Interativo e Configurações */}
                    <div className="space-y-4 rounded-2xl border border-white/5 bg-zinc-900/10 p-4">
                      <div className="flex select-none items-center gap-2 border-b border-white/5 pb-2">
                        <Layout className="size-4 text-[#FFBF00]" />
                        <h3 className="text-xs font-black uppercase italic tracking-wider text-white">
                          Posição de Exibição
                        </h3>
                      </div>

                      <div className="space-y-3">
                        <span className="ml-1 block text-[9px] font-black uppercase italic tracking-widest text-zinc-500">
                          Selecione a Posição na Home do PWA (Clique para
                          Ativar)
                        </span>
                        <div className="flex select-none justify-center rounded-2xl border border-white/5 bg-zinc-900/10 py-4">
                          <div className="isolate bg-zinc-955 relative flex h-64 w-36 flex-col justify-between overflow-hidden rounded-[1.8rem] border-2 border-zinc-700 p-2.5 text-left shadow-2xl">
                            {/* Notch */}
                            <div className="absolute left-1/2 top-0 z-10 h-3 w-16 -translate-x-1/2 rounded-b-lg bg-zinc-700" />

                            {/* Top Banner Region */}
                            <button
                              type="button"
                              onClick={() => {
                                const nextOrder =
                                  banners.filter(
                                    (b) => b.position === "home_top",
                                  ).length + 1;
                                setFormData((prev) => ({
                                  ...prev,
                                  position: "home_top",
                                  order: nextOrder,
                                }));
                              }}
                              className={cn(
                                "relative h-12 w-full rounded-lg border flex flex-col items-center justify-center transition-all duration-300 overflow-hidden shrink-0 mt-3 cursor-pointer",
                                formData.position === "home_top"
                                  ? "border-[#FFBF00] bg-[#FFBF00]/25 shadow-[0_0_15px_rgba(255,191,0,0.15)]"
                                  : "border-dashed border-white/10 bg-zinc-900/40 hover:bg-zinc-900",
                              )}
                            >
                              {formData.position === "home_top" && (
                                <div className="absolute right-1 top-1 size-1 animate-ping rounded-full bg-[#FFBF00]" />
                              )}
                              <span
                                className={cn(
                                  "text-[7px] font-black uppercase tracking-wider",
                                  formData.position === "home_top"
                                    ? "text-[#FFBF00]"
                                    : "text-zinc-550",
                                )}
                              >
                                Topo do App
                              </span>
                              <span className="mt-0.5 text-[5.5px] font-bold leading-none text-zinc-650">
                                Cabeçalho Home
                              </span>
                            </button>

                            {/* Middle Content mock */}
                            <div className="flex flex-1 flex-col justify-center gap-1.5 py-2">
                              {/* Search mock */}
                              <div className="flex h-4 w-full shrink-0 items-center rounded-md border border-white/5 bg-zinc-900/60 px-1.5">
                                <div className="h-1.5 w-12 rounded bg-zinc-800" />
                              </div>

                              {/* Middle Banner Region */}
                              <button
                                type="button"
                                onClick={() => {
                                  const nextOrder =
                                    banners.filter(
                                      (b) => b.position === "home_middle",
                                    ).length + 1;
                                  setFormData((prev) => ({
                                    ...prev,
                                    position: "home_middle",
                                    order: nextOrder,
                                  }));
                                }}
                                className={cn(
                                  "relative h-12 w-full rounded-lg border flex flex-col items-center justify-center transition-all duration-300 overflow-hidden shrink-0 cursor-pointer",
                                  formData.position === "home_middle"
                                    ? "border-[#FFBF00] bg-[#FFBF00]/25 shadow-[0_0_15px_rgba(255,191,0,0.15)]"
                                    : "border-dashed border-white/10 bg-zinc-900/40 hover:bg-zinc-900",
                                )}
                              >
                                {formData.position === "home_middle" && (
                                  <div className="absolute right-1 top-1 size-1 animate-ping rounded-full bg-[#FFBF00]" />
                                )}
                                <span
                                  className={cn(
                                    "text-[7px] font-black uppercase tracking-wider",
                                    formData.position === "home_middle"
                                      ? "text-[#FFBF00]"
                                      : "text-zinc-550",
                                  )}
                                >
                                  Meio do App
                                </span>
                                <span className="mt-0.5 text-[5.5px] font-bold leading-none text-zinc-650">
                                  Entre Vitrines
                                </span>
                              </button>

                              {/* Product mock list */}
                              <div className="flex shrink-0 gap-1.5 overflow-hidden py-0.5">
                                {[1, 2].map((i) => (
                                  <div
                                    key={i}
                                    className="flex h-10 w-12 flex-col justify-between rounded border border-white/5 bg-zinc-900/20 p-1"
                                  >
                                    <div className="size-4 rounded bg-zinc-800" />
                                    <div className="h-1 w-8 rounded bg-zinc-850" />
                                  </div>
                                ))}
                              </div>
                            </div>

                            {/* Bottom Banner Region */}
                            <button
                              type="button"
                              onClick={() => {
                                const nextOrder =
                                  banners.filter(
                                    (b) => b.position === "home_bottom",
                                  ).length + 1;
                                setFormData((prev) => ({
                                  ...prev,
                                  position: "home_bottom",
                                  order: nextOrder,
                                }));
                              }}
                              className={cn(
                                "relative h-12 w-full rounded-lg border flex flex-col items-center justify-center transition-all duration-300 overflow-hidden shrink-0 mb-1 cursor-pointer",
                                formData.position === "home_bottom"
                                  ? "border-[#FFBF00] bg-[#FFBF00]/25 shadow-[0_0_15px_rgba(255,191,0,0.15)]"
                                  : "border-dashed border-white/10 bg-zinc-900/40 hover:bg-zinc-900",
                              )}
                            >
                              {formData.position === "home_bottom" && (
                                <div className="absolute right-1 top-1 size-1 animate-ping rounded-full bg-[#FFBF00]" />
                              )}
                              <span
                                className={cn(
                                  "text-[7px] font-black uppercase tracking-wider",
                                  formData.position === "home_bottom"
                                    ? "text-[#FFBF00]"
                                    : "text-zinc-555",
                                )}
                              >
                                Rodapé (Base)
                              </span>
                              <span className="mt-0.5 text-[5.5px] font-bold leading-none text-zinc-650">
                                Final da Home
                              </span>
                            </button>

                            {/* Navigation mock */}
                            <div className="flex h-4 shrink-0 items-center justify-between border-t border-white/5 bg-zinc-900/20 px-2">
                              <div className="h-1 w-3 rounded bg-[#FFBF00]" />
                            </div>
                          </div>
                        </div>
                      </div>

                      {/* Ordem e Ativo */}
                      <div className="grid grid-cols-1 gap-3.5 border-t border-white/5 pt-3 sm:grid-cols-2">
                        <div className="space-y-1.5">
                          <Label
                            htmlFor="banner-simple-order"
                            className="ml-1 text-[9px] font-black uppercase italic tracking-widest text-zinc-500"
                          >
                            Prioridade de Exibição (Ordem)
                          </Label>
                          <Input
                            id="banner-simple-order"
                            name="order"
                            type="number"
                            value={formData.order ?? ""}
                            onChange={(e) =>
                              setFormData({
                                ...formData,
                                order: Number(e.target.value),
                              })
                            }
                            className="h-10 rounded-xl border-white/10 bg-zinc-900/50 text-sm font-bold text-white focus:ring-[#FFBF00]"
                          />
                        </div>

                        <div className="flex h-10 select-none items-center justify-between self-end rounded-xl border border-white/5 bg-black/40 p-3 shadow-inner">
                          <Label
                            htmlFor="banner-simple-active"
                            className="flex cursor-pointer items-center gap-2 text-[9px] font-black uppercase tracking-wider text-white"
                          >
                            Banner Ativo{" "}
                            <Zap className="size-3 text-[#FFBF00]" />
                          </Label>
                          <Switch
                            id="banner-simple-active"
                            name="active"
                            checked={formData.active}
                            onCheckedChange={(checked) =>
                              setFormData({ ...formData, active: checked })
                            }
                            className="scale-90 data-[state=checked]:bg-[#FFBF00]"
                          />
                        </div>
                      </div>
                    </div>
                  </motion.div>
                ) : activeStep === 1 ? (
                  <motion.div
                    key="step-1"
                    initial={{ opacity: 0, x: -15 }}
                    animate={{ opacity: 1, x: 0 }}
                    exit={{ opacity: 0, x: 15 }}
                    transition={{ duration: 0.2 }}
                    className="space-y-5"
                  >
                    {/* Card 1: Imagem */}
                    <div className="space-y-2.5 rounded-xl sm:rounded-2xl border border-white/5 bg-zinc-900/10 p-2.5 sm:p-3.5">
                      <div className="flex select-none items-center justify-between border-b border-white/5 pb-1.5">
                        <div className="flex items-center gap-1.5">
                          <Upload className="size-3.5 text-[#FFBF00]" />
                          <h3 className="text-[10.5px] sm:text-xs font-black uppercase italic tracking-wider text-white">
                            1. Imagem do Banner
                          </h3>
                        </div>
                      </div>

                      <div className="space-y-2">
                        <div className="mb-0.5 flex select-none items-baseline justify-between">
                          <Label
                            htmlFor="banner-upload"
                            className="ml-1 text-[8.5px] font-black uppercase italic tracking-widest text-zinc-400 opacity-90"
                          >
                            Imagem do Banner
                          </Label>
                          <span className="text-[7.5px] font-bold uppercase tracking-wider text-zinc-500">
                            {formData.position === "home_top"
                              ? "Recomendado: 4:1 (ex: 1200x300px)"
                              : "Recomendado: 21:9 (ex: 1200x500px)"}
                          </span>
                        </div>

                        {uploading ? (
                          <div className="flex h-24 w-full flex-col items-center justify-center gap-2 rounded-2xl border border-white/5 bg-zinc-900/40">
                            <div className="size-6 animate-spin rounded-full border-2 border-zinc-700 border-t-[#FFBF00]" />
                            <span className="text-[9px] font-black uppercase tracking-[0.2em] text-zinc-500">
                              Enviando Imagem...
                            </span>
                          </div>
                        ) : formData.imageUrl ? (
                          <div className="flex flex-col justify-between gap-3 rounded-2xl border border-white/10 bg-zinc-950/70 p-3 shadow-inner sm:flex-row sm:items-center">
                            <div className="flex items-center gap-3 min-w-0">
                              <div className="relative h-14 w-28 shrink-0 overflow-hidden rounded-xl border border-white/10 bg-zinc-900 shadow-md">
                                <img
                                  src={formData.imageUrl}
                                  alt="Preview Thumbnail"
                                  className="size-full object-cover"
                                />
                              </div>
                              <div className="flex flex-col min-w-0">
                                <span className="text-[10px] font-black uppercase italic tracking-wider text-white truncate">
                                  Imagem Selecionada
                                </span>
                                <span className="mt-0.5 flex items-center gap-1.5 text-[8px] font-bold tracking-wider text-emerald-400">
                                  <span className="size-1.5 rounded-full bg-emerald-400 animate-pulse shrink-0" />
                                  Carregada com Sucesso
                                </span>
                              </div>
                            </div>

                            <div className="flex items-center gap-2 shrink-0">
                              <Label
                                htmlFor="banner-upload"
                                className="cursor-pointer select-none rounded-xl border border-white/10 bg-zinc-900 px-3.5 py-2 text-[9px] font-black uppercase tracking-widest text-white transition-all hover:border-white/20 hover:bg-zinc-800 active:scale-95"
                              >
                                Alterar
                              </Label>
                              <Button
                                type="button"
                                onClick={() => openAdjuster(formData.imageUrl!)}
                                className="flex cursor-pointer select-none items-center gap-1.5 rounded-xl bg-[#FFBF00] px-3.5 py-2 text-[9px] font-black uppercase tracking-widest text-black shadow-md transition-all duration-200 hover:bg-[#FFBF00]/90 active:scale-95"
                              >
                                <SlidersHorizontal className="size-3.5" />
                                Ajustar
                              </Button>
                            </div>
                          </div>
                        ) : (
                          <div className="relative">
                            <Label
                              htmlFor="banner-upload"
                              className="group flex h-28 w-full cursor-pointer flex-col items-center justify-center gap-2.5 rounded-2xl border-2 border-dashed border-white/5 bg-zinc-900/50 text-[10px] font-black uppercase tracking-[0.2em] text-zinc-650 transition-all hover:border-amber-400/30 hover:bg-zinc-900"
                            >
                              <Upload className="size-7 text-zinc-500 transition-colors group-hover:text-[#FFBF00]" />
                              <span>Enviar Imagem Principal</span>
                            </Label>
                          </div>
                        )}

                        <Input
                          id="banner-upload"
                          name="banner-upload"
                          type="file"
                          accept="image/*"
                          className="hidden"
                          onChange={handleFileUpload}
                          disabled={uploading}
                        />
                      </div>
                    </div>

                    {/* Card 2: Conteúdo Principal */}
                    <div className="space-y-2.5 rounded-xl sm:rounded-2xl border border-white/5 bg-zinc-900/10 p-2.5 sm:p-3.5">
                      <div className="flex select-none items-center gap-2 border-b border-white/5 pb-1.5">
                        <Layout className="size-3.5 text-[#FFBF00]" />
                        <h3 className="text-[10.5px] sm:text-xs font-black uppercase italic tracking-wider text-white">
                          2. Textos do Banner
                        </h3>
                      </div>
                      <div className="flex items-center justify-between rounded-xl border border-white/10 bg-zinc-900/60 p-3 mb-2">
                        <div className="space-y-0.5">
                          <Label className="text-xs font-bold text-white">
                            Exibir Textos e Botão Sobrepostos
                          </Label>
                          <p className="text-[10px] text-zinc-400">
                            Desative se a imagem já possui texto ou arte gráfica
                            integrada.
                          </p>
                        </div>
                        <Switch
                          checked={formData.showTextOverlay !== false}
                          onCheckedChange={(checked) =>
                            setFormData((prev) => ({
                              ...prev,
                              showTextOverlay: checked,
                            }))
                          }
                        />
                      </div>

                      <div className="space-y-1">
                        <Label
                          htmlFor="banner-title"
                          className="ml-1 text-[8.5px] font-black uppercase italic tracking-widest text-zinc-500"
                        >
                          Título da Campanha
                        </Label>
                        <LocalBufferedInput
                          id="banner-title"
                          name="title"
                          value={formData.title || ""}
                          onFlush={(val) =>
                            setFormData((prev) => ({ ...prev, title: val }))
                          }
                          placeholder="Ex: Coleção de Verão"
                          useShadcn={true}
                          className="h-9 rounded-xl border-white/10 bg-zinc-900/50 text-xs font-bold text-white transition-all focus:border-[#FFBF00]/50 focus:ring-[#FFBF00]"
                        />
                        {productSuggestions &&
                          productSuggestions.titles.length > 0 && (
                            <div className="mt-1 select-none duration-200 animate-in fade-in">
                              <span className="text-[7.5px] font-black uppercase tracking-wider text-zinc-550">
                                Sugestões do Produto Selecionado:
                              </span>
                              <div className="mt-0.5 flex flex-wrap gap-1">
                                {productSuggestions.titles.map(
                                  (titleSuggestion, idx) => (
                                    <button
                                      key={idx}
                                      type="button"
                                      onClick={() => {
                                        setFormData((prev) => ({
                                          ...prev,
                                          title: titleSuggestion,
                                        }));
                                        toast.success("Título preenchido!");
                                      }}
                                      className="cursor-pointer rounded-lg border border-white/5 bg-zinc-950 px-2 py-0.5 text-[7.5px] font-medium text-zinc-400 transition-all hover:bg-zinc-900 hover:text-white"
                                    >
                                      {titleSuggestion}
                                    </button>
                                  ),
                                )}
                              </div>
                            </div>
                          )}
                      </div>

                      <div className="space-y-1">
                        <Label
                          htmlFor="banner-subtitle"
                          className="ml-1 text-[8.5px] font-black uppercase italic tracking-widest text-zinc-500"
                        >
                          Subtítulo / Descrição da Oferta
                        </Label>
                        <Input
                          id="banner-subtitle"
                          name="subtitle"
                          value={formData.subtitle || ""}
                          onChange={(e) =>
                            setFormData((prev) => ({
                              ...prev,
                              subtitle: e.target.value,
                            }))
                          }
                          placeholder="Ex: Apenas hoje com cupom de desconto"
                          className="h-9 rounded-xl border-white/10 bg-zinc-900/50 text-xs font-bold text-white focus:ring-[#FFBF00]"
                        />
                        {productSuggestions &&
                          productSuggestions.subtitles.length > 0 && (
                            <div className="mt-1 select-none duration-200 animate-in fade-in">
                              <span className="text-[7.5px] font-black uppercase tracking-wider text-zinc-550">
                                Sugestões do Produto Selecionado:
                              </span>
                              <div className="mt-0.5 flex flex-wrap gap-1">
                                {productSuggestions.subtitles.map(
                                  (subtitleSuggestion, idx) => (
                                    <button
                                      key={idx}
                                      type="button"
                                      onClick={() => {
                                        setFormData((prev) => ({
                                          ...prev,
                                          subtitle: subtitleSuggestion,
                                        }));
                                        toast.success("Subtítulo preenchido!");
                                      }}
                                      className="cursor-pointer rounded-lg border border-white/5 bg-zinc-950 px-2 py-0.5 text-[7.5px] font-medium text-zinc-400 transition-all hover:bg-zinc-900 hover:text-white"
                                    >
                                      {subtitleSuggestion}
                                    </button>
                                  ),
                                )}
                              </div>
                            </div>
                          )}
                      </div>

                      <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
                        <div className="space-y-1">
                          <Label
                            htmlFor="banner-badge"
                            className="ml-1 text-[8.5px] font-black uppercase italic tracking-widest text-zinc-500"
                          >
                            Tag / Etiqueta do Cartaz (Badge)
                          </Label>
                          <Input
                            id="banner-badge"
                            name="badgeText"
                            value={formData.badgeText || ""}
                            onChange={(e) =>
                              setFormData((prev) => ({
                                ...prev,
                                badgeText: e.target.value,
                              }))
                            }
                            placeholder="Ex: 50% OFF, Lançamento"
                            className="h-9 rounded-xl border-white/10 bg-zinc-900/50 text-xs font-bold text-white focus:ring-[#FFBF00]"
                          />
                        </div>

                        <div className="space-y-1">
                          <Label
                            htmlFor="banner-btn-text"
                            className="ml-1 text-[8.5px] font-black uppercase italic tracking-widest text-zinc-500"
                          >
                            Texto do Botão (CTA)
                          </Label>
                          <Input
                            id="banner-btn-text"
                            name="buttonText"
                            value={formData.buttonText || ""}
                            onChange={(e) =>
                              setFormData((prev) => ({
                                ...prev,
                                buttonText: e.target.value,
                              }))
                            }
                            placeholder="Ex: Comprar Agora"
                            className="h-9 rounded-xl border-white/10 bg-zinc-900/50 text-xs font-bold text-white focus:ring-[#FFBF00]"
                          />
                          <span className="ml-1 mt-0.5 block text-[7.5px] font-medium italic text-zinc-500">
                            Opcional. Ao preencher, exibe o botão no banner e
                            ativa as cores do botão no Passo 2 (Estilo).
                          </span>
                        </div>
                      </div>
                    </div>
                  </motion.div>
                ) : activeStep === 2 ? (
                  <motion.div
                    key="step-2"
                    initial={{ opacity: 0, x: -15 }}
                    animate={{ opacity: 1, x: 0 }}
                    exit={{ opacity: 0, x: 15 }}
                    transition={{ duration: 0.2 }}
                    className="space-y-6"
                  >
                    {/* CARD 1: TEMAS ESTÉTICOS RÁPIDOS */}
                    <div className="space-y-2 rounded-xl sm:rounded-2xl border border-white/5 bg-zinc-900/10 p-2.5 sm:p-3.5">
                      <div className="flex select-none items-center justify-between border-b border-white/5 pb-1.5">
                        <div className="flex items-center gap-1.5">
                          <Sparkles className="size-3.5 text-[#FFBF00]" />
                          <h3 className="text-[10.5px] sm:text-xs font-black uppercase italic tracking-wider text-white">
                            Temas Estéticos Rápidos
                          </h3>
                        </div>
                        <span className="text-[8px] font-bold uppercase tracking-wider text-zinc-500 hidden sm:inline">
                          Prontos para usar
                        </span>
                      </div>

                      <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-3">
                        {themePresets.map((preset) => {
                          const isPresetSelected =
                            formData.templateType === preset.templateType &&
                            formData.fontFamily === preset.fontFamily &&
                            formData.titleColor === preset.titleColor &&
                            formData.subtitleColor === preset.subtitleColor &&
                            formData.buttonBgColor === preset.buttonBgColor &&
                            formData.buttonTextColor ===
                              preset.buttonTextColor &&
                            formData.overlayColor === preset.overlayColor &&
                            Number(formData.overlayOpacity ?? 40) ===
                              Number(preset.overlayOpacity);

                          return (
                            <motion.button
                              key={preset.name}
                              type="button"
                              whileHover={{ scale: 1.01 }}
                              whileTap={{ scale: 0.98 }}
                              onClick={() => {
                                setFormData((prev) => ({
                                  ...prev,
                                  templateType: preset.templateType,
                                  fontFamily: preset.fontFamily,
                                  titleColor: preset.titleColor,
                                  subtitleColor: preset.subtitleColor,
                                  buttonBgColor: preset.buttonBgColor,
                                  buttonTextColor: preset.buttonTextColor,
                                  overlayColor: preset.overlayColor,
                                  overlayOpacity: preset.overlayOpacity,
                                }));
                                toast.success(
                                  `Tema "${preset.name}" aplicado!`,
                                  {
                                    icon: "🎨",
                                  },
                                );
                              }}
                              className={cn(
                                "group flex items-center justify-between gap-1.5 rounded-xl border px-2.5 py-1.5 text-left transition-all cursor-pointer relative overflow-hidden select-none",
                                isPresetSelected
                                  ? "border-[#FFBF00] bg-[#FFBF00]/10 shadow-[0_0_12px_rgba(255,191,0,0.12)]"
                                  : "border-white/5 bg-zinc-900/40 hover:border-amber-400/20 hover:bg-zinc-900",
                              )}
                            >
                              <div className="flex items-center gap-2 min-w-0 flex-1">
                                {/* Swatches de Cores Compactas */}
                                <div className="flex shrink-0 select-none items-center -space-x-1">
                                  <div
                                    className="size-2.5 rounded-full border border-white/20 shadow-sm z-2"
                                    style={{
                                      backgroundColor: preset.titleColor,
                                    }}
                                    title={`Título: ${preset.titleColor}`}
                                  />
                                  <div
                                    className="size-2.5 rounded-full border border-white/20 shadow-sm z-1"
                                    style={{
                                      backgroundColor: preset.buttonBgColor,
                                    }}
                                    title={`Botão: ${preset.buttonBgColor}`}
                                  />
                                  <div
                                    className="size-2.5 rounded-full border border-white/20 shadow-sm"
                                    style={{
                                      backgroundColor: preset.overlayColor,
                                    }}
                                    title={`Fundo: ${preset.overlayColor}`}
                                  />
                                </div>

                                <div className="flex flex-col min-w-0">
                                  <span
                                    className={cn(
                                      "text-[9px] font-black truncate leading-tight",
                                      isPresetSelected
                                        ? "text-[#FFBF00]"
                                        : "text-white group-hover:text-[#FFBF00]",
                                    )}
                                  >
                                    {preset.name}
                                  </span>
                                  <span className="truncate text-[7.5px] leading-none text-zinc-400">
                                    {preset.description}
                                  </span>
                                </div>
                              </div>

                              {isPresetSelected && (
                                <span className="text-[9px] font-bold text-[#FFBF00] shrink-0">
                                  ✓
                                </span>
                              )}
                            </motion.button>
                          );
                        })}
                      </div>
                    </div>

                    {/* CARD 2: MODELO DE LAYOUT E TIPOGRAFIA */}
                    <div className="space-y-2.5 rounded-xl sm:rounded-2xl border border-white/5 bg-zinc-900/10 p-2.5 sm:p-3.5">
                      <div className="flex select-none items-center gap-2 border-b border-white/5 pb-1.5">
                        <SlidersHorizontal className="size-3.5 text-[#FFBF00]" />
                        <h3 className="text-[10.5px] sm:text-xs font-black uppercase italic tracking-wider text-white">
                          Disposição do Layout & Estilo da Fonte
                        </h3>
                      </div>

                      {/* Seleção do Layout do Conteúdo */}
                      <div className="space-y-1.5">
                        <span className="ml-1 block text-[8.5px] font-black uppercase italic tracking-widest text-zinc-400">
                          Alinhamento e Estilo do Layout
                        </span>
                        <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-3">
                          {[
                            {
                              value: "default",
                              label: "Inferior Esquerda",
                              badge: "Padrão",
                              desc: "Texto no canto inferior esquerdo",
                            },
                            {
                              value: "split_center",
                              label: "Centralizado",
                              badge: "Centro",
                              desc: "Texto limpo centralizado",
                            },
                            {
                              value: "split_left",
                              label: "Alinhado à Esquerda",
                              badge: "Esquerda",
                              desc: "Totalmente à esquerda",
                            },
                            {
                              value: "split_right",
                              label: "Alinhado à Direita",
                              badge: "Direita",
                              desc: "Totalmente à direita",
                            },
                            {
                              value: "neon_glow",
                              label: "Efeito Neon",
                              badge: "Brilho Cyber",
                              desc: "Letras brilhantes e modernas",
                            },
                            {
                              value: "glassmorphic",
                              label: "Cartão Vidro",
                              badge: "Efeito Glass",
                              desc: "Fundo em vidro translúcido",
                            },
                          ].map((t) => {
                            const isSelected =
                              (formData.templateType || "default") === t.value;
                            return (
                              <button
                                key={t.value}
                                type="button"
                                onClick={() =>
                                  setFormData((prev) => ({
                                    ...prev,
                                    templateType: t.value,
                                  }))
                                }
                                className={cn(
                                  "group flex flex-col gap-1 items-start px-2 py-1.5 rounded-xl border text-left transition-all duration-200 active:scale-[0.98] select-none cursor-pointer",
                                  isSelected
                                    ? "border-[#FFBF00] bg-[#FFBF00]/10 shadow-[0_0_12px_rgba(255,191,0,0.12)]"
                                    : "border-white/5 bg-zinc-900/30 hover:border-white/10 hover:bg-zinc-900",
                                )}
                              >
                                <div className="flex w-full items-center justify-between gap-1">
                                  <span
                                    className={cn(
                                      "text-[9px] font-black uppercase tracking-wider truncate",
                                      isSelected
                                        ? "text-[#FFBF00]"
                                        : "text-white",
                                    )}
                                  >
                                    {t.label}
                                  </span>
                                  <span
                                    className={cn(
                                      "text-[7px] font-bold px-1 py-0.2 rounded border shrink-0",
                                      isSelected
                                        ? "border-[#FFBF00]/40 text-[#FFBF00] bg-[#FFBF00]/10"
                                        : "border-white/10 text-zinc-400 bg-black/40",
                                    )}
                                  >
                                    {t.badge}
                                  </span>
                                </div>

                                <p className="text-[7.5px] leading-tight text-zinc-400 truncate w-full">
                                  {t.desc}
                                </p>
                              </button>
                            );
                          })}
                        </div>
                      </div>

                      {/* Seleção de Tipografia (Fonte) */}
                      <div className="space-y-1.5 pt-1.5 border-t border-white/5">
                        <span className="ml-1 block text-[8.5px] font-black uppercase italic tracking-widest text-zinc-400">
                          Estilo da Fonte (Tipografia)
                        </span>
                        <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-4">
                          {[
                            {
                              value: "system",
                              label: "Sem Serifa",
                              fontClass: "font-sans",
                              preview: "Aa",
                              desc: "Clean & Moderno",
                            },
                            {
                              value: "font-serif",
                              label: "Serifa Clássica",
                              fontClass: "font-serif",
                              preview: "Aa",
                              desc: "Editorial",
                            },
                            {
                              value: "font-mono",
                              label: "Moderno Mono",
                              fontClass: "font-mono",
                              preview: "Aa",
                              desc: "Digital Cyber",
                            },
                            {
                              value: "font-display",
                              label: "Display Impacto",
                              fontClass: "font-display font-black uppercase",
                              preview: "AA",
                              desc: "Forte Imponente",
                            },
                          ].map((f) => {
                            const isSelected =
                              (formData.fontFamily || "system") === f.value;
                            return (
                              <button
                                key={f.value}
                                type="button"
                                onClick={() =>
                                  setFormData((prev) => ({
                                    ...prev,
                                    fontFamily: f.value,
                                  }))
                                }
                                className={cn(
                                  "group flex flex-col gap-1 items-center justify-between px-2 py-1.5 rounded-xl border text-center transition-all duration-200 active:scale-[0.98] select-none cursor-pointer",
                                  isSelected
                                    ? "border-[#FFBF00] bg-[#FFBF00]/10 shadow-[0_0_12px_rgba(255,191,0,0.12)]"
                                    : "border-white/5 bg-zinc-900/30 hover:border-white/10 hover:bg-zinc-900",
                                )}
                              >
                                <div
                                  className={cn(
                                    "size-7 sm:size-8 rounded-lg bg-zinc-950 border border-white/10 flex items-center justify-center text-sm font-black transition-colors shrink-0",
                                    f.fontClass,
                                    isSelected
                                      ? "text-[#FFBF00] border-[#FFBF00]/30 bg-[#FFBF00]/5"
                                      : "text-zinc-400 group-hover:text-white",
                                  )}
                                >
                                  {f.preview}
                                </div>

                                <div className="space-y-0.5">
                                  <h5
                                    className={cn(
                                      "text-[8.5px] font-black uppercase tracking-wider leading-none",
                                      isSelected
                                        ? "text-[#FFBF00]"
                                        : "text-white group-hover:text-[#FFBF00]",
                                    )}
                                  >
                                    {f.label}
                                  </h5>
                                  <p className="text-[7px] leading-tight text-zinc-400">
                                    {f.desc}
                                  </p>
                                </div>
                              </button>
                            );
                          })}
                        </div>
                      </div>
                    </div>

                    {/* CARD 3: PERSONALIZAÇÃO DE CORES E FILTRO DE ESCURECIMENTO */}
                    <div className="space-y-2.5 rounded-xl sm:rounded-2xl border border-white/5 bg-zinc-900/10 p-2.5 sm:p-3.5">
                      <div className="flex select-none items-center gap-2 border-b border-white/5 pb-1.5">
                        <SlidersHorizontal className="size-3.5 text-[#FFBF00]" />
                        <h3 className="text-[10.5px] sm:text-xs font-black uppercase italic tracking-wider text-white">
                          {hasButtonText
                            ? "Personalização de Cores dos Textos e Botão"
                            : "Personalização de Cores dos Textos e Filtro"}
                        </h3>
                      </div>

                      {/* Seletor do Elemento Ativo para Alterar Cor */}
                      <div className="space-y-1.5">
                        <span className="ml-1 block text-[8.5px] font-black uppercase italic tracking-widest text-zinc-400">
                          Escolha o Elemento para Mudar a Cor:
                        </span>
                        <div
                          className={cn(
                            "grid grid-cols-3 gap-1",
                            hasButtonText ? "sm:grid-cols-5" : "sm:grid-cols-3",
                          )}
                        >
                          {colorElements.map((el) => {
                            const isActive = targetColorEl === el.id;
                            return (
                              <button
                                key={el.id}
                                type="button"
                                onClick={() => setActiveColorElement(el.id)}
                                className={cn(
                                  "flex items-center justify-between gap-1 px-2 py-1 rounded-lg border transition-all duration-200 select-none cursor-pointer",
                                  isActive
                                    ? "border-[#FFBF00] bg-[#FFBF00]/15 text-white shadow-[0_0_10px_rgba(255,191,0,0.15)] ring-1 ring-[#FFBF00]/50"
                                    : "border-white/5 bg-zinc-950 text-zinc-400 hover:border-white/10 hover:text-zinc-200",
                                )}
                              >
                                <span className="line-clamp-1 text-[8px] font-extrabold uppercase tracking-wider">
                                  {el.label}
                                </span>
                                <span
                                  className="size-3 rounded-full border border-white/20 shadow-inner shrink-0"
                                  style={{ backgroundColor: el.value }}
                                />
                              </button>
                            );
                          })}
                        </div>
                      </div>

                      {/* Painel do Editor de Cor do Elemento Selecionado */}
                      <div className="flex flex-col gap-2 rounded-xl border border-white/10 bg-zinc-950/80 p-2.5 duration-200 animate-in fade-in">
                        {/* Linha Principal: Seletor Interativo + Nome + Restaurar */}
                        <div className="flex select-none items-center justify-between gap-2 rounded-lg bg-zinc-900/60 p-1.5 border border-white/5">
                          <div className="flex items-center gap-2.5">
                            {/* Círculo Interativo Seletor de Cor Nativo */}
                            <div
                              className="relative flex size-7 shrink-0 items-center justify-center overflow-hidden rounded-full border border-white/20 shadow-md ring-2 ring-amber-400/30 transition-transform hover:scale-110 active:scale-95 cursor-pointer"
                              title="Clique para escolher uma cor personalizada"
                            >
                              <span
                                className="absolute inset-0 rounded-full"
                                style={{
                                  backgroundColor:
                                    formData[targetColorEl] || "#FFFFFF",
                                }}
                              />
                              <input
                                id={targetColorEl}
                                name={targetColorEl}
                                type="color"
                                value={formData[targetColorEl] || "#FFFFFF"}
                                onChange={(e) =>
                                  setFormData((prev) => ({
                                    ...prev,
                                    [targetColorEl]: e.target.value,
                                  }))
                                }
                                className="absolute inset-0 size-[150%] -translate-x-[15%] -translate-y-[15%] cursor-pointer opacity-0"
                              />
                            </div>

                            <div className="flex flex-col">
                              <span className="text-[8px] font-extrabold uppercase tracking-wider text-zinc-400">
                                Cor de:{" "}
                                <span className="font-black text-[#FFBF00]">
                                  {targetColorEl === "titleColor"
                                    ? "Título Principal"
                                    : targetColorEl === "subtitleColor"
                                      ? "Subtítulo / Descrição"
                                      : targetColorEl === "buttonBgColor"
                                        ? "Fundo do Botão (CTA)"
                                        : targetColorEl === "buttonTextColor"
                                          ? "Texto do Botão (CTA)"
                                          : "Filtro da Imagem"}
                                </span>
                              </span>
                              <span className="text-[7.5px] font-mono text-zinc-400">
                                {formData[targetColorEl] || "#FFFFFF"}
                              </span>
                            </div>
                          </div>

                          <button
                            type="button"
                            onClick={() => {
                              const defaults = {
                                titleColor: "#FFFFFF",
                                subtitleColor: "#9CA3AF",
                                buttonBgColor: "#FFBF00",
                                buttonTextColor: "#000000",
                                overlayColor: "#000000",
                              };
                              setFormData((prev) => ({
                                ...prev,
                                [targetColorEl]: defaults[targetColorEl],
                              }));
                            }}
                            className="cursor-pointer text-[8px] font-extrabold uppercase tracking-wider text-amber-500 hover:text-amber-400 hover:underline transition-colors px-1.5 py-0.5"
                          >
                            Restaurar Padrão
                          </button>
                        </div>

                        {/* Cores Frequentes */}
                        <div className="flex items-center justify-between gap-2 pt-0.5">
                          <span className="select-none text-[8px] font-bold uppercase tracking-wider text-zinc-400 shrink-0">
                            Cores Frequentes:
                          </span>
                          <div className="flex select-none flex-wrap gap-1">
                            {presetColors.map((color) => {
                              const isSelected =
                                formData[targetColorEl] === color.hex;
                              return (
                                <button
                                  key={color.hex}
                                  type="button"
                                  onClick={() =>
                                    setFormData((prev) => ({
                                      ...prev,
                                      [targetColorEl]: color.hex,
                                    }))
                                  }
                                  className={cn(
                                    "size-5 rounded-full border border-white/10 relative transition-all duration-150 hover:scale-110 active:scale-95 cursor-pointer",
                                    isSelected &&
                                      "ring-2 ring-amber-400 ring-offset-1 ring-offset-zinc-950 scale-110",
                                  )}
                                  style={{ backgroundColor: color.hex }}
                                  title={color.name}
                                />
                              );
                            })}
                          </div>
                        </div>

                        {/* Cores da Marca da Loja */}
                        {brandingColors.length > 0 && (
                          <div className="flex items-center justify-between gap-2 border-t border-white/5 pt-1.5">
                            <span className="select-none text-[8px] font-extrabold uppercase tracking-wider text-[#FFBF00] shrink-0">
                              Cores da Sua Marca:
                            </span>
                            <div className="flex select-none flex-wrap gap-1">
                              {brandingColors.map((color) => {
                                const isSelected =
                                  formData[targetColorEl] === color.hex;
                                return (
                                  <button
                                    key={color.hex}
                                    type="button"
                                    onClick={() =>
                                      setFormData((prev) => ({
                                        ...prev,
                                        [targetColorEl]: color.hex,
                                      }))
                                    }
                                    className={cn(
                                      "group relative flex items-center gap-1 rounded-full border border-white/10 px-2 py-0.5 text-[7.5px] font-bold transition-all duration-150 hover:scale-105 active:scale-95 cursor-pointer",
                                      isSelected
                                        ? "border-[#FFBF00] bg-[#FFBF00]/15 text-[#FFBF00]"
                                        : "bg-zinc-900 text-zinc-300 hover:border-white/20",
                                    )}
                                    style={{
                                      backgroundColor: `${color.hex}20`,
                                    }}
                                  >
                                    <span
                                      className="size-2 rounded-full border border-white/20 shadow-sm"
                                      style={{
                                        backgroundColor: color.hex,
                                      }}
                                    />
                                    <span>{color.name}</span>
                                  </button>
                                );
                              })}
                            </div>
                          </div>
                        )}
                      </div>
                    </div>

                    {/* Controle de Escurecimento do Fundo */}
                    <div className="space-y-2 border-t border-white/5 pt-3">
                      <div className="flex select-none justify-between items-center">
                        <Label
                          htmlFor="banner-overlay-opacity"
                          className="ml-1 text-[9px] font-black uppercase italic tracking-widest text-zinc-400"
                        >
                          Escurecimento da Imagem de Fundo (Filtro):{" "}
                          <span className="text-[#FFBF00]">
                            {formData.overlayOpacity ?? 40}%
                          </span>
                        </Label>
                      </div>

                      <input
                        id="banner-overlay-opacity"
                        name="overlayOpacity"
                        type="range"
                        min="0"
                        max="90"
                        step="5"
                        value={formData.overlayOpacity ?? 40}
                        onChange={(e) =>
                          setFormData((prev) => ({
                            ...prev,
                            overlayOpacity: Number(e.target.value),
                          }))
                        }
                        className="w-full cursor-pointer accent-[#FFBF00]"
                      />

                      {/* Botões Rápidos de Ajuste do Filtro */}
                      <div className="flex gap-2 pt-1">
                        {[
                          { label: "Suave (20%)", val: 20 },
                          { label: "Equilibrado (40%)", val: 40 },
                          { label: "Intenso (70%)", val: 70 },
                        ].map((opt) => (
                          <button
                            key={opt.val}
                            type="button"
                            onClick={() =>
                              setFormData((prev) => ({
                                ...prev,
                                overlayOpacity: opt.val,
                              }))
                            }
                            className={cn(
                              "flex-1 py-1 rounded-lg border text-[8px] font-extrabold uppercase transition-all cursor-pointer",
                              (formData.overlayOpacity ?? 40) === opt.val
                                ? "border-[#FFBF00] bg-[#FFBF00]/15 text-[#FFBF00]"
                                : "border-white/5 bg-zinc-900/50 text-zinc-400 hover:border-white/10",
                            )}
                          >
                            {opt.label}
                          </button>
                        ))}
                      </div>

                      {/* Cores Extraídas da Imagem */}
                      {extractedColors.length > 0 && (
                        <div className="space-y-1 border-t border-white/5 pt-1.5">
                          <div className="flex select-none items-center justify-between">
                            <span className="text-[8px] font-extrabold uppercase tracking-wider text-amber-400">
                              Sugestões da Imagem 📸
                            </span>
                            <button
                              type="button"
                              onClick={handleAutoThemeFromImage}
                              className="cursor-pointer text-[7.5px] font-black uppercase tracking-wider text-[#FFBF00] transition-colors hover:text-white"
                            >
                              ✨ Tema Inteligente
                            </button>
                          </div>
                          <div className="flex select-none flex-wrap gap-1">
                            {extractedColors.map((color) => {
                              const isSelected =
                                formData[activeColorElement] === color;
                              return (
                                <button
                                  key={color}
                                  type="button"
                                  onClick={() =>
                                    setFormData((prev) => ({
                                      ...prev,
                                      [activeColorElement]: color,
                                    }))
                                  }
                                  className={cn(
                                    "size-5 rounded-full border border-white/10 relative transition-all duration-150 hover:scale-110 active:scale-95 cursor-pointer",
                                    isSelected &&
                                      "ring-2 ring-amber-400 ring-offset-1 ring-offset-zinc-950 scale-110",
                                  )}
                                  style={{ backgroundColor: color }}
                                  title={color}
                                />
                              );
                            })}
                          </div>
                        </div>
                      )}
                    </div>

                    {/* CARD 4: GUIA INTELIGENTE DE LEGIBILIDADE E LEITURA FÁCIL (VERSÃO ULTRA COMPACTA) */}
                    <div className="flex flex-col gap-1.5 rounded-xl border border-white/5 bg-zinc-900/20 p-2 sm:p-2.5 duration-300 animate-in fade-in select-none">
                      {/* Cabeçalho Compacto com Diagnóstico Resumido e Ação */}
                      {(() => {
                        const isTitleOk = computedTitleRatio >= 3.0;
                        const isSubtitleOk = computedSubtitleRatio >= 4.5;
                        const isBtnOk = computedButtonRatio >= 4.5;
                        const isAllOk = isTitleOk && isSubtitleOk && isBtnOk;

                        return (
                          <div className="flex flex-wrap items-center justify-between gap-1.5 border-b border-white/5 pb-1.5">
                            <div className="flex items-center gap-1.5">
                              <Sparkles className="size-3 text-[#FFBF00]" />
                              <span className="text-[10px] font-black uppercase italic tracking-wider text-white">
                                Guia de Legibilidade
                              </span>
                              <span
                                className={cn(
                                  "text-[7.5px] font-black uppercase px-1.5 py-0.2 rounded-full border",
                                  isAllOk
                                    ? "bg-emerald-500/10 text-emerald-400 border-emerald-500/30"
                                    : "bg-amber-500/10 text-amber-400 border-amber-500/30",
                                )}
                              >
                                {isAllOk
                                  ? "Excelente 🟢"
                                  : "Ajuste Recomendado 🟡"}
                              </span>
                            </div>

                            <button
                              type="button"
                              onClick={handleOptimizeContrast}
                              className="flex cursor-pointer items-center gap-1 rounded-md border border-amber-400/30 bg-amber-500/15 px-2 py-0.5 text-[7.5px] font-black uppercase tracking-wider text-[#FFBF00] transition-all hover:bg-[#FFBF00] hover:text-black active:scale-95 ml-auto"
                            >
                              <Sparkles className="size-2.5" /> Auto-Ajustar
                              Cores
                            </button>
                          </div>
                        );
                      })()}

                      {/* Indicadores Visuais de Contraste para Cada Elemento em Linha Única Compacta */}
                      <div className="grid grid-cols-3 gap-1">
                        <div className="flex items-center justify-between rounded-lg border border-white/5 bg-zinc-950/70 px-2 py-1">
                          <span className="text-[7.5px] font-extrabold uppercase text-zinc-400">
                            Título
                          </span>
                          <span
                            className={cn(
                              "text-[7.5px] font-black uppercase px-1 py-0.2 rounded",
                              computedTitleRatio >= 3.0
                                ? "bg-emerald-500/10 text-emerald-400"
                                : "bg-rose-500/10 text-rose-400",
                            )}
                          >
                            {computedTitleRatio >= 3.0
                              ? "Fácil ✓"
                              : "Escurecer ⚠️"}
                          </span>
                        </div>

                        <div className="flex items-center justify-between rounded-lg border border-white/5 bg-zinc-950/70 px-2 py-1">
                          <span className="text-[7.5px] font-extrabold uppercase text-zinc-400">
                            Subtítulo
                          </span>
                          <span
                            className={cn(
                              "text-[7.5px] font-black uppercase px-1 py-0.2 rounded",
                              computedSubtitleRatio >= 4.5
                                ? "bg-emerald-500/10 text-emerald-400"
                                : "bg-rose-500/10 text-rose-400",
                            )}
                          >
                            {computedSubtitleRatio >= 4.5
                              ? "Fácil ✓"
                              : "Escurecer ⚠️"}
                          </span>
                        </div>

                        <div className="flex items-center justify-between rounded-lg border border-white/5 bg-zinc-950/70 px-2 py-1">
                          <span className="text-[7.5px] font-extrabold uppercase text-zinc-400">
                            Botão CTA
                          </span>
                          <span
                            className={cn(
                              "text-[7.5px] font-black uppercase px-1 py-0.2 rounded",
                              computedButtonRatio >= 4.5
                                ? "bg-emerald-500/10 text-emerald-400"
                                : "bg-rose-500/10 text-rose-400",
                            )}
                          >
                            {computedButtonRatio >= 4.5
                              ? "Destacado ✓"
                              : "Ajustar ⚠️"}
                          </span>
                        </div>
                      </div>
                    </div>
                  </motion.div>
                ) : activeStep === 3 ? (
                  <motion.div
                    key="step-3"
                    initial={{ opacity: 0, x: -15 }}
                    animate={{ opacity: 1, x: 0 }}
                    exit={{ opacity: 0, x: 15 }}
                    transition={{ duration: 0.2 }}
                    className="space-y-5"
                  >
                    {/* Seletor de Posição Interativo */}
                    <div className="space-y-4 rounded-2xl border border-white/5 bg-zinc-900/10 p-4">
                      <div className="flex select-none items-center gap-2 border-b border-white/5 pb-2">
                        <Layout className="size-4 text-[#FFBF00]" />
                        <h3 className="text-xs font-black uppercase italic tracking-wider text-white">
                          Posição de Exibição
                        </h3>
                      </div>

                      <div className="space-y-3">
                        <span className="ml-1 block text-[9px] font-black uppercase italic tracking-widest text-zinc-500">
                          Selecione a Posição na Home do PWA (Clique para
                          Ativar)
                        </span>
                        <div className="flex select-none justify-center rounded-2xl border border-white/5 bg-zinc-900/10 py-4">
                          <div className="isolate bg-zinc-955 relative flex h-64 w-36 flex-col justify-between overflow-hidden rounded-[1.8rem] border-2 border-zinc-700 p-2.5 text-left shadow-2xl">
                            {/* Notch */}
                            <div className="absolute left-1/2 top-0 z-10 h-3 w-16 -translate-x-1/2 rounded-b-lg bg-zinc-700" />

                            {/* Top Banner Region */}
                            <button
                              type="button"
                              onClick={() => {
                                const nextOrder =
                                  banners.filter(
                                    (b) => b.position === "home_top",
                                  ).length + 1;
                                setFormData((prev) => ({
                                  ...prev,
                                  position: "home_top",
                                  order: nextOrder,
                                }));
                              }}
                              className={cn(
                                "relative h-12 w-full rounded-lg border flex flex-col items-center justify-center transition-all duration-300 overflow-hidden shrink-0 mt-3 cursor-pointer",
                                formData.position === "home_top"
                                  ? "border-[#FFBF00] bg-[#FFBF00]/25 shadow-[0_0_15px_rgba(255,191,0,0.15)]"
                                  : "border-dashed border-white/10 bg-zinc-900/40 hover:bg-zinc-900",
                              )}
                            >
                              {formData.position === "home_top" && (
                                <div className="absolute right-1 top-1 size-1 animate-ping rounded-full bg-[#FFBF00]" />
                              )}
                              <span
                                className={cn(
                                  "text-[7px] font-black uppercase tracking-wider",
                                  formData.position === "home_top"
                                    ? "text-[#FFBF00]"
                                    : "text-zinc-550",
                                )}
                              >
                                Topo do App
                              </span>
                              <span className="mt-0.5 text-[5.5px] font-bold leading-none text-zinc-650">
                                Cabeçalho Home
                              </span>
                            </button>

                            {/* Middle Content mock */}
                            <div className="flex flex-1 flex-col justify-center gap-1.5 py-2">
                              {/* Search mock */}
                              <div className="flex h-4 w-full shrink-0 items-center rounded-md border border-white/5 bg-zinc-900/60 px-1.5">
                                <div className="h-1.5 w-12 rounded bg-zinc-800" />
                              </div>

                              {/* Middle Banner Region */}
                              <button
                                type="button"
                                onClick={() => {
                                  const nextOrder =
                                    banners.filter(
                                      (b) => b.position === "home_middle",
                                    ).length + 1;
                                  setFormData((prev) => ({
                                    ...prev,
                                    position: "home_middle",
                                    order: nextOrder,
                                  }));
                                }}
                                className={cn(
                                  "relative h-12 w-full rounded-lg border flex flex-col items-center justify-center transition-all duration-300 overflow-hidden shrink-0 cursor-pointer",
                                  formData.position === "home_middle"
                                    ? "border-[#FFBF00] bg-[#FFBF00]/25 shadow-[0_0_15px_rgba(255,191,0,0.15)]"
                                    : "border-dashed border-white/10 bg-zinc-900/40 hover:bg-zinc-900",
                                )}
                              >
                                {formData.position === "home_middle" && (
                                  <div className="absolute right-1 top-1 size-1 animate-ping rounded-full bg-[#FFBF00]" />
                                )}
                                <span
                                  className={cn(
                                    "text-[7px] font-black uppercase tracking-wider",
                                    formData.position === "home_middle"
                                      ? "text-[#FFBF00]"
                                      : "text-zinc-550",
                                  )}
                                >
                                  Meio do App
                                </span>
                                <span className="mt-0.5 text-[5.5px] font-bold leading-none text-zinc-650">
                                  Entre Vitrines
                                </span>
                              </button>

                              {/* Product mock list */}
                              <div className="flex shrink-0 gap-1.5 overflow-hidden py-0.5">
                                {[1, 2].map((i) => (
                                  <div
                                    key={i}
                                    className="flex h-10 w-12 flex-col justify-between rounded border border-white/5 bg-zinc-900/20 p-1"
                                  >
                                    <div className="size-4 rounded bg-zinc-800" />
                                    <div className="h-1 w-8 rounded bg-zinc-850" />
                                  </div>
                                ))}
                              </div>
                            </div>

                            {/* Bottom Banner Region */}
                            <button
                              type="button"
                              onClick={() => {
                                const nextOrder =
                                  banners.filter(
                                    (b) => b.position === "home_bottom",
                                  ).length + 1;
                                setFormData((prev) => ({
                                  ...prev,
                                  position: "home_bottom",
                                  order: nextOrder,
                                }));
                              }}
                              className={cn(
                                "relative h-12 w-full rounded-lg border flex flex-col items-center justify-center transition-all duration-300 overflow-hidden shrink-0 mb-1 cursor-pointer",
                                formData.position === "home_bottom"
                                  ? "border-[#FFBF00] bg-[#FFBF00]/25 shadow-[0_0_15px_rgba(255,191,0,0.15)]"
                                  : "border-dashed border-white/10 bg-zinc-900/40 hover:bg-zinc-900",
                              )}
                            >
                              {formData.position === "home_bottom" && (
                                <div className="absolute right-1 top-1 size-1 animate-ping rounded-full bg-[#FFBF00]" />
                              )}
                              <span
                                className={cn(
                                  "text-[7px] font-black uppercase tracking-wider",
                                  formData.position === "home_bottom"
                                    ? "text-[#FFBF00]"
                                    : "text-zinc-555",
                                )}
                              >
                                Rodapé (Base)
                              </span>
                              <span className="mt-0.5 text-[5.5px] font-bold leading-none text-zinc-650">
                                Final da Home
                              </span>
                            </button>

                            {/* Navigation mock */}
                            <div className="flex h-4 shrink-0 items-center justify-between border-t border-white/5 bg-zinc-900/20 px-2">
                              <div className="h-1 w-3 rounded bg-[#FFBF00]" />
                            </div>
                          </div>
                        </div>
                      </div>
                    </div>
                    <div className="space-y-3.5 rounded-xl sm:rounded-2xl border border-white/5 bg-zinc-900/10 p-3 sm:p-4">
                      {/* Título Principal do Bloco Único */}
                      <div className="flex select-none flex-col gap-1 border-b border-white/5 pb-2.5">
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-2">
                            <ExternalLink className="size-4 text-[#FFBF00]" />
                            <h3 className="text-[11px] sm:text-xs font-black uppercase italic tracking-wider text-white">
                              3. DESTINO E AÇÃO DO BANNER
                            </h3>
                          </div>
                          {/* Indicator Badge of Link Origin */}
                          {(() => {
                            if (
                              formData.productId &&
                              selectedProduct &&
                              formData.link?.includes(
                                `/product-detail?id=${formData.productId}`,
                              )
                            ) {
                              return (
                                <span className="rounded border border-emerald-500/30 bg-emerald-500/15 px-2.5 py-0.5 font-mono text-[8px] font-bold text-emerald-400">
                                  📦 Produto: {selectedProduct.name}
                                </span>
                              );
                            }
                            if (
                              formData.link?.startsWith("http://") ||
                              formData.link?.startsWith("https://")
                            ) {
                              return (
                                <span className="rounded border border-sky-500/30 bg-sky-500/15 px-2.5 py-0.5 font-mono text-[8px] font-bold text-sky-400">
                                  🌐 Link Externo
                                </span>
                              );
                            }
                            if (formData.link) {
                              return (
                                <span className="rounded border border-purple-500/30 bg-purple-500/15 px-2.5 py-0.5 font-mono text-[8px] font-bold text-purple-300">
                                  📌 Página da Loja{" "}
                                  {selectedCouponCode
                                    ? `(Cupom: ${selectedCouponCode})`
                                    : ""}
                                </span>
                              );
                            }
                            return (
                              <span className="rounded border border-white/5 bg-zinc-800/80 px-2.5 py-0.5 font-mono text-[8px] font-bold text-zinc-400">
                                ⚪ Apenas Foto (Sem Clique)
                              </span>
                            );
                          })()}
                        </div>
                        <p className="text-[8.5px] text-zinc-400">
                          Escolha o que acontece quando o cliente clica neste
                          banner. Simples e rápido.
                        </p>
                      </div>

                      {/* SELETOR DE INTENÇÃO DE DESTINO (SIMPLES E INTUITIVO) */}
                      <div className="space-y-1.5 select-none">
                        <Label className="text-[8.5px] font-black uppercase tracking-wider text-amber-400">
                          Escolha a Ação ao Clicar no Banner:
                        </Label>
                        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                          {/* 1. Apenas Foto */}
                          <button
                            type="button"
                            onClick={() => {
                              setDestinationMode("none");
                              setFormData((prev) => ({
                                ...prev,
                                link: "",
                                productId: "",
                              }));
                              toast.info("Banner definido como apenas visual.");
                            }}
                            className={cn(
                              "flex flex-col items-center justify-center p-2.5 rounded-xl border transition-all cursor-pointer text-center duration-200",
                              destinationMode === "none"
                                ? "border-amber-400 bg-amber-400/15 text-white font-black shadow-[0_0_12px_rgba(255,191,0,0.15)]"
                                : "border-white/10 bg-zinc-900/60 text-zinc-400 hover:border-white/20 hover:text-white",
                            )}
                          >
                            <span className="text-base">⚪</span>
                            <span className="mt-1 text-[9.5px] font-bold">
                              Apenas Foto
                            </span>
                            <span className="text-[7.5px] font-medium text-zinc-500">
                              Sem clique
                            </span>
                          </button>

                          {/* 2. Produto Específico */}
                          <button
                            type="button"
                            onClick={() => {
                              setDestinationMode("product");
                            }}
                            className={cn(
                              "flex flex-col items-center justify-center p-2.5 rounded-xl border transition-all cursor-pointer text-center duration-200",
                              destinationMode === "product"
                                ? "border-emerald-400 bg-emerald-400/15 text-white font-black shadow-[0_0_12px_rgba(52,211,153,0.15)]"
                                : "border-white/10 bg-zinc-900/60 text-zinc-400 hover:border-white/20 hover:text-white",
                            )}
                          >
                            <span className="text-base">📦</span>
                            <span className="mt-1 text-[9.5px] font-bold">
                              Abrir Produto
                            </span>
                            <span className="text-[7.5px] font-medium text-zinc-500">
                              Leva a 1 item
                            </span>
                          </button>

                          {/* 3. Página da Loja */}
                          <button
                            type="button"
                            onClick={() => {
                              setDestinationMode("route");
                              if (
                                !formData.link ||
                                formData.link.includes("/product-detail")
                              ) {
                                setFormData((prev) => ({
                                  ...prev,
                                  link: "/produtos",
                                  productId: "",
                                }));
                              }
                            }}
                            className={cn(
                              "flex flex-col items-center justify-center p-2.5 rounded-xl border transition-all cursor-pointer text-center duration-200",
                              destinationMode === "route"
                                ? "border-purple-400 bg-purple-400/15 text-white font-black shadow-[0_0_12px_rgba(192,132,252,0.15)]"
                                : "border-white/10 bg-zinc-900/60 text-zinc-400 hover:border-white/20 hover:text-white",
                            )}
                          >
                            <span className="text-base">🏷️</span>
                            <span className="mt-1 text-[9.5px] font-bold">
                              Página da Loja
                            </span>
                            <span className="text-[7.5px] font-medium text-zinc-500">
                              Home, Ofertas...
                            </span>
                          </button>

                          {/* 4. Link ou URL Externa */}
                          <button
                            type="button"
                            onClick={() => {
                              setDestinationMode("custom");
                            }}
                            className={cn(
                              "flex flex-col items-center justify-center p-2.5 rounded-xl border transition-all cursor-pointer text-center duration-200",
                              destinationMode === "custom"
                                ? "border-sky-400 bg-sky-400/15 text-white font-black shadow-[0_0_12px_rgba(56,189,248,0.15)]"
                                : "border-white/10 bg-zinc-900/60 text-zinc-400 hover:border-white/20 hover:text-white",
                            )}
                          >
                            <span className="text-base">🌐</span>
                            <span className="mt-1 text-[9.5px] font-bold">
                              Link / URL
                            </span>
                            <span className="text-[7.5px] font-medium text-zinc-500">
                              Link customizado
                            </span>
                          </button>
                        </div>
                      </div>

                      {/* CONFIGURAÇÃO DO BOTÃO CTA (TEXTO DO BOTÃO NO BANNER) */}
                      {destinationMode !== "none" && (
                        <div className="space-y-1.5 border-t border-white/5 pt-3">
                          <div className="flex select-none items-center justify-between">
                            <Label
                              htmlFor="banner-btn-text-step3"
                              className="text-[8.5px] font-black uppercase tracking-wider text-amber-400"
                            >
                              <span>Texto do Botão de Ação (CTA)</span>
                            </Label>
                            <span className="text-[7.5px] font-medium text-zinc-500">
                              {formData.buttonText
                                ? `Botão: "${formData.buttonText}"`
                                : "Sem Botão Explícito"}
                            </span>
                          </div>

                          <LocalBufferedInput
                            id="banner-btn-text-step3"
                            name="buttonText"
                            value={formData.buttonText || ""}
                            onFlush={(val) =>
                              setFormData((prev) => ({
                                ...prev,
                                buttonText: val,
                              }))
                            }
                            placeholder="Ex: Comprar Agora, Ver Oferta, Confira..."
                            useShadcn={true}
                            className="h-9 rounded-xl border-white/10 bg-zinc-900/90 font-sans text-xs font-bold text-white transition-all placeholder:text-zinc-600 focus:border-[#FFBF00] focus:ring-[#FFBF00]"
                          />

                          <div className="flex select-none flex-wrap items-center gap-1 pt-0.5">
                            <span className="mr-1 text-[7.5px] font-bold uppercase text-zinc-500">
                              Sugestões:
                            </span>
                            {[
                              { label: "🛍️ Ver Produto", value: "Ver Produto" },
                              {
                                label: "🛒 Comprar Agora",
                                value: "Comprar Agora",
                              },
                              {
                                label: "🔥 Aproveitar Oferta",
                                value: "Aproveitar Oferta",
                              },
                              { label: "👁️ Confira", value: "Confira" },
                            ].map((btn) => (
                              <button
                                key={btn.value}
                                type="button"
                                onClick={() =>
                                  setFormData((prev) => ({
                                    ...prev,
                                    buttonText: btn.value,
                                  }))
                                }
                                className={cn(
                                  "cursor-pointer rounded-lg border border-white/5 bg-zinc-900 px-2 py-0.5 text-[8px] font-bold text-zinc-300 transition-all hover:border-amber-400/30 hover:bg-zinc-800 hover:text-white active:scale-95",
                                  formData.buttonText === btn.value &&
                                    "border-[#FFBF00] bg-[#FFBF00]/20 font-black text-white",
                                )}
                              >
                                {btn.label}
                              </button>
                            ))}
                            {formData.buttonText && (
                              <button
                                type="button"
                                onClick={() =>
                                  setFormData((prev) => ({
                                    ...prev,
                                    buttonText: "",
                                  }))
                                }
                                className="cursor-pointer rounded-lg border border-red-500/20 bg-red-500/10 px-2 py-0.5 text-[8px] font-bold text-red-400 transition-all hover:bg-red-500/20 active:scale-95"
                              >
                                ❌ Limpar Botão
                              </button>
                            )}
                          </div>
                        </div>
                      )}

                      {/* SUB-PAINEL DINÂMICO PARA CADA MODO */}
                      {destinationMode === "none" && (
                        <div className="select-none rounded-xl border border-white/5 bg-zinc-900/30 p-3 text-center">
                          <p className="text-[10px] font-bold text-zinc-300">
                            ⚪ Este banner é apenas visual.
                          </p>
                          <p className="mt-0.5 text-[8px] text-zinc-500">
                            Ao ser exibido para os clientes, ele não terá
                            redirecionamento ao ser clicado.
                          </p>
                        </div>
                      )}

                      {destinationMode === "product" && (
                        <div className="space-y-2 border-t border-white/5 pt-3">
                          <div className="flex select-none items-center justify-between">
                            <span className="font-sans text-[8.5px] font-black uppercase italic tracking-widest text-emerald-400">
                              📦 Vincular Produto Específico
                            </span>
                            <span className="text-[7.5px] font-medium text-zinc-500">
                              Leva o cliente diretamente para a página do
                              produto
                            </span>
                          </div>

                          {formData.productId && selectedProduct ? (
                            <div className="bg-emerald-550/5 flex select-none items-center justify-between rounded-xl border border-emerald-500/20 p-2.5 duration-200 animate-in fade-in zoom-in-95">
                              <div className="flex min-w-0 items-center gap-2.5">
                                <div className="size-10 shrink-0 overflow-hidden rounded-lg border border-white/10 bg-zinc-900">
                                  {selectedProduct.images?.[0] ? (
                                    <img
                                      src={selectedProduct.images[0]}
                                      alt={selectedProduct.name}
                                      className="size-full object-cover"
                                    />
                                  ) : (
                                    <div className="flex size-full items-center justify-center bg-zinc-950 text-[8px] text-zinc-650">
                                      Sem foto
                                    </div>
                                  )}
                                </div>
                                <div className="min-w-0">
                                  <div className="flex items-center gap-1.5">
                                    <span className="rounded bg-emerald-500 px-1.5 py-0.2 text-[7.5px] font-black uppercase text-black">
                                      Vinculado
                                    </span>
                                    <span className="truncate font-mono text-[7.5px] font-bold text-zinc-550">
                                      ID: {selectedProduct.id.slice(0, 8)}...
                                    </span>
                                  </div>
                                  <h4 className="mt-0.5 truncate text-[11px] font-bold leading-snug text-white">
                                    {selectedProduct.name}
                                  </h4>
                                  <p className="mt-0.5 font-mono text-[9.5px] font-black leading-none text-amber-500">
                                    R${" "}
                                    {Number(selectedProduct.price).toFixed(2)}
                                  </p>
                                </div>
                              </div>
                              <button
                                type="button"
                                onClick={() => {
                                  setFormData((prev) => ({
                                    ...prev,
                                    productId: "",
                                    link: "",
                                  }));
                                  toast.info("Vínculo com o produto removido.");
                                }}
                                className="shrink-0 cursor-pointer rounded-lg border border-red-500/20 bg-red-500/5 px-2.5 py-1.5 text-[8.5px] font-black uppercase tracking-wider text-red-400 transition-all hover:border-red-500/40 hover:bg-red-500/10 active:scale-95"
                              >
                                Desvincular
                              </button>
                            </div>
                          ) : (
                            <div className="space-y-2">
                              <div className="relative">
                                <Input
                                  id="banner-product-search"
                                  name="productSearch"
                                  type="text"
                                  placeholder="Pesquise o produto pelo nome para vincular..."
                                  value={productSearch}
                                  onChange={(e) =>
                                    setProductSearch(e.target.value)
                                  }
                                  className="h-9 rounded-xl border-white/10 bg-zinc-900/50 pl-9 pr-8 text-xs text-white placeholder:text-zinc-500 focus:border-[#FFBF00]/50 focus:ring-[#FFBF00]"
                                />
                                <Search className="pointer-events-none absolute left-3 top-1/2 size-3.5 -translate-y-1/2 text-zinc-500" />
                                {productSearch && (
                                  <button
                                    onClick={() => setProductSearch("")}
                                    className="absolute right-3 top-1/2 -translate-y-1/2 text-zinc-500 hover:text-white"
                                  >
                                    <X className="size-3.5" />
                                  </button>
                                )}
                              </div>

                              <div className="custom-scrollbar max-h-40 space-y-1 overflow-y-auto pr-1">
                                {filteredProducts.slice(0, 5).map((p) => (
                                  <button
                                    key={p.id}
                                    type="button"
                                    onClick={() => {
                                      setFormData((prev) => ({
                                        ...prev,
                                        productId: p.id,
                                        link: `/product-detail?id=${p.id}`,
                                      }));
                                      setProductSearch("");
                                      toast.success(`Vinculado a: ${p.name}!`);
                                    }}
                                    className="flex w-full cursor-pointer select-none items-center justify-between rounded-xl border border-white/5 bg-zinc-950/40 p-1.5 text-left transition-all hover:border-amber-500/20 hover:bg-zinc-900/30 active:scale-[0.99]"
                                  >
                                    <div className="flex min-w-0 items-center gap-2">
                                      <div className="size-7 shrink-0 overflow-hidden rounded-lg border border-white/5 bg-zinc-900">
                                        {p.images?.[0] ? (
                                          <img
                                            src={p.images[0]}
                                            alt={p.name}
                                            className="size-full object-cover"
                                          />
                                        ) : (
                                          <div className="flex size-full items-center justify-center text-[6px] text-zinc-600">
                                            Sem foto
                                          </div>
                                        )}
                                      </div>
                                      <div className="min-w-0">
                                        <h5 className="truncate text-[10.5px] font-bold leading-snug text-white">
                                          {p.name}
                                        </h5>
                                        <p className="truncate text-[8px] leading-none text-zinc-500">
                                          {p.category || "Sem categoria"}
                                        </p>
                                      </div>
                                    </div>
                                    <div className="flex shrink-0 items-center gap-1.5">
                                      <span className="font-mono text-[9px] font-black text-amber-500">
                                        R$ {Number(p.price).toFixed(2)}
                                      </span>
                                      <span className="rounded border border-white/10 bg-zinc-900 px-1.5 py-0.5 text-[7.5px] font-black uppercase text-zinc-400 transition-colors group-hover:text-white">
                                        Vincular
                                      </span>
                                    </div>
                                  </button>
                                ))}

                                {filteredProducts.length === 0 && (
                                  <div className="py-2 text-center text-[9px] italic text-zinc-650">
                                    Nenhum produto correspondente encontrado.
                                  </div>
                                )}
                              </div>
                            </div>
                          )}
                        </div>
                      )}

                      {destinationMode === "route" && (
                        <div className="space-y-2 border-t border-white/5 pt-3">
                          <span className="text-[8.5px] font-black uppercase tracking-wider text-purple-400">
                            🏷️ Escolha a Página da Loja
                          </span>
                          <div className="custom-scrollbar flex max-h-28 flex-wrap gap-1 overflow-y-auto p-0.5">
                            {dynamicRouteSuggestions.map((route) => (
                              <button
                                key={route.path}
                                type="button"
                                onClick={() => {
                                  setFormData((prev) => ({
                                    ...prev,
                                    link: route.path,
                                    productId: "",
                                  }));
                                  toast.success(
                                    `Página "${route.label}" selecionada!`,
                                  );
                                }}
                                className={cn(
                                  "cursor-pointer rounded-lg border border-white/10 bg-zinc-900/80 px-2.5 py-1 text-[8px] font-bold text-zinc-300 transition-all hover:border-purple-400/30 hover:text-white active:scale-95",
                                  formData.link === route.path &&
                                    "border-purple-400 bg-purple-400/20 font-extrabold text-white shadow-[0_0_10px_rgba(192,132,252,0.2)]",
                                )}
                              >
                                {route.label} {route.path && `(${route.path})`}
                              </button>
                            ))}
                          </div>
                        </div>
                      )}

                      {destinationMode === "custom" && (
                        <div className="space-y-2 border-t border-white/5 pt-3">
                          <span className="text-[8.5px] font-black uppercase tracking-wider text-sky-400">
                            🌐 Digite a URL ou Link Customizado
                          </span>
                          <LocalBufferedInput
                            id="banner-link-custom"
                            name="link"
                            value={formData.link || ""}
                            onFlush={(val) =>
                              setFormData((prev) => ({ ...prev, link: val }))
                            }
                            placeholder="Ex: https://wa.me/5511999999999 ou link externo"
                            useShadcn={true}
                            className="h-9 rounded-xl border-white/10 bg-zinc-900/90 font-mono text-xs text-white placeholder:text-zinc-600 focus:border-sky-400 focus:ring-sky-400"
                          />
                        </div>
                      )}
                    </div>

                    {/* Seção de Agendamento */}
                    <div className="space-y-2.5 rounded-xl border border-white/5 bg-zinc-900/20 p-2.5 sm:p-3">
                      <div className="flex select-none items-center justify-between">
                        <Label
                          htmlFor="banner-scheduling-toggle"
                          className="flex cursor-pointer select-none items-center gap-1.5 text-[9.5px] font-black uppercase italic tracking-wider text-white"
                        >
                          Programação Temporal{" "}
                          <span title="Define uma data e hora para início e fim da exibição deste banner automaticamente.">
                            <HelpCircle className="size-3 text-zinc-500 transition-colors hover:text-white" />
                          </span>
                        </Label>
                        <Switch
                          id="banner-scheduling-toggle"
                          checked={
                            formData.startDate !== null ||
                            formData.endDate !== null
                          }
                          onCheckedChange={(checked) => {
                            if (checked) {
                              const now = new Date();
                              const startStr = now.toISOString();
                              const tomorrow = new Date(
                                now.getTime() + 24 * 60 * 60 * 1000,
                              );
                              const endStr = tomorrow.toISOString();
                              setFormData((prev) => ({
                                ...prev,
                                startDate: startStr,
                                endDate: endStr,
                              }));
                            } else {
                              setFormData((prev) => ({
                                ...prev,
                                startDate: null,
                                endDate: null,
                              }));
                            }
                          }}
                          className="scale-90 data-[state=checked]:bg-[#FFBF00]"
                        />
                      </div>

                      {(formData.startDate !== null ||
                        formData.endDate !== null) && (
                        <div className="space-y-2 pt-0.5 duration-300 animate-in fade-in slide-in-from-top-2">
                          {/* Quick Date Presets */}
                          <div className="flex select-none flex-wrap gap-1">
                            {[
                              { label: "⚡ Próximas 24h", value: "24h" },
                              {
                                label: "📅 Fim de Semana",
                                value: "weekend",
                              },
                              { label: "🗓️ 7 Dias", value: "7d" },
                              { label: "📆 30 Dias", value: "30d" },
                            ].map((preset) => (
                              <button
                                key={preset.value}
                                type="button"
                                onClick={() =>
                                  handleApplyDatePreset(preset.value as any)
                                }
                                className="cursor-pointer rounded-lg border border-white/5 bg-zinc-900 px-2 py-0.5 text-[8px] font-bold text-zinc-300 transition-all hover:border-[#FFBF00]/30 hover:bg-zinc-800 hover:text-white active:scale-95"
                              >
                                {preset.label}
                              </button>
                            ))}
                          </div>

                          <div className="grid grid-cols-1 gap-2.5 pt-0.5 sm:grid-cols-2">
                            <div className="space-y-1">
                              <Label
                                htmlFor="banner-start-date"
                                className="ml-1 text-[8.5px] font-black uppercase italic tracking-widest text-zinc-500"
                              >
                                Data/Hora de Início
                              </Label>
                              <Input
                                id="banner-start-date"
                                name="startDate"
                                type="datetime-local"
                                value={toLocalDatetimeLocal(formData.startDate)}
                                onChange={(e) =>
                                  setFormData((prev) => ({
                                    ...prev,
                                    startDate: e.target.value
                                      ? new Date(e.target.value).toISOString()
                                      : null,
                                  }))
                                }
                                className="h-9 rounded-xl border-white/10 bg-zinc-900/50 text-xs font-semibold text-white focus:ring-[#FFBF00]"
                              />
                            </div>

                            <div className="space-y-1">
                              <Label
                                htmlFor="banner-end-date"
                                className="ml-1 text-[8.5px] font-black uppercase italic tracking-widest text-zinc-500"
                              >
                                Data/Hora de Fim (Expiração)
                              </Label>
                              <Input
                                id="banner-end-date"
                                name="endDate"
                                type="datetime-local"
                                value={toLocalDatetimeLocal(formData.endDate)}
                                onChange={(e) =>
                                  setFormData((prev) => ({
                                    ...prev,
                                    endDate: e.target.value
                                      ? new Date(e.target.value).toISOString()
                                      : null,
                                  }))
                                }
                                className="h-9 rounded-xl border-white/10 bg-zinc-900/50 text-xs font-semibold text-white focus:ring-[#FFBF00]"
                              />
                            </div>

                            {formData.startDate &&
                              formData.endDate &&
                              new Date(formData.startDate) >
                                new Date(formData.endDate) && (
                                <div className="col-span-2 select-none rounded-lg border border-rose-500/20 bg-rose-500/10 p-2 text-[8.5px] font-bold text-rose-400">
                                  ⚠️ Atenção: A data de expiração deve ser
                                  posterior à data de início.
                                </div>
                              )}
                          </div>

                          {/* Scheduling Sentinel - Campaign Overlap & Clutter Auditor */}
                          {(() => {
                            const { list, level } = schedulingConflicts;
                            if (level === "none") return null;

                            let borderClass =
                              "border-emerald-500/20 bg-emerald-500/5 text-emerald-400";
                            let title = "Fricção Baixa (1 Banner Ativo) ✓";
                            let desc =
                              "Esta campanha será a única em exibição neste setor durante o período selecionado. Foco total do cliente.";
                            let IconComponent = Play;

                            if (level === "medium") {
                              borderClass =
                                "border-amber-500/20 bg-amber-500/5 text-amber-400";
                              title = "Fricção Média (2 Banners Ativos) ⇄";
                              desc =
                                "Duas campanhas estarão ativas simultaneamente. Os banners serão exibidos em formato de carrossel rotativo.";
                              IconComponent = SlidersHorizontal;
                            } else if (level === "high") {
                              borderClass =
                                "border-rose-500/20 bg-rose-500/5 text-rose-400";
                              title = "Fricção Alta (3+ Banners Ativos) ⚠️";
                              desc =
                                "Atenção: Três ou mais campanhas estarão ativas simultaneamente. O excesso de rotações pode reduzir o engajamento e a conversão de cada banner individual.";
                              IconComponent = Bell;
                            }

                            return (
                              <div
                                className={cn(
                                  "rounded-xl border p-2.5 space-y-2 mt-2 select-none animate-in fade-in slide-in-from-top-2 duration-300",
                                  borderClass,
                                )}
                              >
                                <div className="flex items-center gap-1.5 text-[8.5px] font-black uppercase tracking-wider">
                                  <IconComponent className="size-3 shrink-0" />
                                  <span>{title}</span>
                                </div>
                                <p className="text-[8.5px] font-medium leading-relaxed opacity-80">
                                  {desc}
                                </p>
                                {list.length > 0 && (
                                  <div className="space-y-1 border-t border-white/5 pt-1.5">
                                    <span className="text-[7.5px] font-black uppercase tracking-wider text-zinc-500">
                                      Campanhas Concorrentes:
                                    </span>
                                    <div className="flex flex-wrap gap-1">
                                      {list.map((c) => (
                                        <div
                                          key={c.id}
                                          className="flex shrink-0 items-center gap-1 rounded-lg border border-white/5 bg-zinc-950/60 px-1.5 py-0.5 text-[7.5px] font-bold text-white"
                                        >
                                          <div className="size-2.5 shrink-0 overflow-hidden rounded-sm border border-white/10 bg-zinc-900">
                                            {c.imageUrl && (
                                              <img
                                                src={c.imageUrl}
                                                className="size-full object-cover"
                                                alt=""
                                              />
                                            )}
                                          </div>
                                          <span className="max-w-[90px] truncate">
                                            {c.title || "Sem título"}
                                          </span>
                                          <span className="font-mono text-[7px] text-zinc-550">
                                            (#{c.order})
                                          </span>
                                        </div>
                                      ))}
                                    </div>
                                  </div>
                                )}
                              </div>
                            );
                          })()}
                        </div>
                      )}
                    </div>

                    <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
                      <div className="space-y-1">
                        <Label
                          htmlFor="banner-order"
                          className="ml-1 text-[8.5px] font-black uppercase italic tracking-widest text-zinc-500"
                        >
                          Prioridade de Exibição (Ordem)
                        </Label>
                        <Input
                          id="banner-order"
                          name="order"
                          type="number"
                          value={formData.order ?? ""}
                          onChange={(e) =>
                            setFormData({
                              ...formData,
                              order: Number(e.target.value),
                            })
                          }
                          className="h-9 rounded-xl border-white/10 bg-zinc-900/50 text-xs font-bold text-white focus:ring-[#FFBF00]"
                        />
                      </div>

                      <div className="flex h-9 items-center justify-between self-end rounded-xl border border-white/5 bg-black/40 px-3 shadow-inner">
                        <Label
                          htmlFor="banner-active"
                          className="flex cursor-pointer select-none items-center gap-1.5 text-[8.5px] font-black uppercase italic tracking-wider text-white"
                        >
                          Banner Ativo <Zap className="size-3 text-[#FFBF00]" />
                        </Label>
                        <Switch
                          id="banner-active"
                          name="active"
                          checked={formData.active}
                          onCheckedChange={(checked) =>
                            setFormData({ ...formData, active: checked })
                          }
                          className="scale-85 data-[state=checked]:bg-[#FFBF00]"
                        />
                      </div>
                    </div>
                  </motion.div>
                ) : null}
              </AnimatePresence>
            </div>

            {/* Footer Action buttons */}
            <div className="flex select-none flex-col gap-2 border-t border-white/5 pt-3 sm:flex-row sm:gap-3">
              {bannerMode === "simple" ? (
                <>
                  <Button
                    variant="ghost"
                    onClick={handleCloseDialog}
                    className="h-9.5 flex-1 cursor-pointer rounded-xl text-[9.5px] font-black uppercase tracking-wider text-zinc-500 transition-all hover:bg-white/5 hover:text-white"
                  >
                    Cancelar
                  </Button>
                  <Button
                    onClick={handleSubmit}
                    disabled={uploading || isSubmitting || isOffline}
                    className="h-9.5 flex-[2] cursor-pointer rounded-xl border border-amber-400/20 bg-gradient-to-r from-[#FFBF00] to-amber-500 text-[9.5px] font-black uppercase tracking-wider text-black shadow-lg transition-all hover:scale-[1.01] hover:shadow-[0_0_20px_rgba(255,191,0,0.2)] active:scale-95 disabled:pointer-events-none disabled:scale-100 disabled:border-white/5 disabled:from-zinc-850 disabled:to-zinc-900 disabled:text-zinc-650 disabled:shadow-none"
                  >
                    {isOffline
                      ? "Modo Offline"
                      : uploading
                        ? "Enviando Imagem..."
                        : isSubmitting
                          ? "Salvando..."
                          : "Salvar Banner"}
                  </Button>
                </>
              ) : (
                <>
                  {activeStep > 1 ? (
                    <Button
                      variant="ghost"
                      onClick={() => setActiveStep((prev) => (prev - 1) as any)}
                      className="h-9.5 flex-1 cursor-pointer rounded-xl text-[9.5px] font-black uppercase tracking-wider text-zinc-400 transition-all hover:bg-white/5 hover:text-white"
                    >
                      Voltar
                    </Button>
                  ) : (
                    <Button
                      variant="ghost"
                      onClick={handleCloseDialog}
                      className="h-9.5 flex-1 cursor-pointer rounded-xl text-[9.5px] font-black uppercase tracking-wider text-zinc-500 transition-all hover:bg-white/5 hover:text-white"
                    >
                      Cancelar
                    </Button>
                  )}
                  {activeStep < 3 ? (
                    <Button
                      onClick={() => {
                        if (!formData.imageUrl) {
                          toast.error(
                            "Por favor, envie uma imagem antes de prosseguir.",
                            {
                              icon: "📸",
                            },
                          );
                          return;
                        }
                        setActiveStep((prev) => (prev + 1) as any);
                      }}
                      className="h-9.5 flex-[2] cursor-pointer rounded-xl border border-amber-400/20 bg-gradient-to-r from-[#FFBF00] to-amber-500 text-[9.5px] font-black uppercase tracking-wider text-black shadow-lg transition-all hover:scale-[1.01] active:scale-95"
                    >
                      Continuar
                    </Button>
                  ) : (
                    <Button
                      onClick={handleSubmit}
                      disabled={uploading || isSubmitting || isOffline}
                      className="h-9.5 flex-[2] cursor-pointer rounded-xl border border-amber-400/20 bg-gradient-to-r from-[#FFBF00] to-amber-500 text-[9.5px] font-black uppercase tracking-wider text-black shadow-lg transition-all hover:scale-[1.01] hover:shadow-[0_0_20px_rgba(255,191,0,0.2)] active:scale-95 disabled:pointer-events-none disabled:scale-100 disabled:border-white/5 disabled:from-zinc-850 disabled:to-zinc-900 disabled:text-zinc-650 disabled:shadow-none"
                    >
                      {isOffline
                        ? "Modo Offline"
                        : uploading
                          ? "Enviando Imagem..."
                          : isSubmitting
                            ? "Salvando..."
                            : "Salvar Alterações"}
                    </Button>
                  )}
                </>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Modal de Ajuda */}
      <AdminHelpModal
        isOpen={showHelpModal}
        onClose={() => setShowHelpModal(false)}
        title="Manual do Gerenciador de Banners"
      >
        <div className="space-y-4">
          <p className="leading-relaxed">
            O Gerenciador de Banners permite que você faça a curadoria dos
            banners rotativos na página inicial do aplicativo do cliente. Essa
            seção é a principal vitrine de promoções e produtos em destaque.
          </p>

          <div className="space-y-3">
            <h4 className="border-l-2 border-amber-500 pl-2 text-[10px] font-black uppercase tracking-[0.2em] text-[#FFBF00]">
              Parâmetros dos Banners
            </h4>
            <div className="grid select-none grid-cols-1 gap-3 sm:grid-cols-2">
              <div className="space-y-1 rounded-2xl border border-white/5 bg-zinc-900/40 p-4">
                <div className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-wider text-white">
                  <Layout className="size-4 text-emerald-500" />
                  Imagem Promocional
                </div>
                <p className="text-[10px] text-zinc-500">
                  Ideal usar proporção horizontal de 21:9. Imagens com boa
                  legibilidade aumentam a conversão.
                </p>
              </div>

              <div className="space-y-1 rounded-2xl border border-white/5 bg-zinc-900/40 p-4">
                <div className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-wider text-white">
                  <ExternalLink className="size-4 text-[#FFBF00]" />
                  Link de Destino
                </div>
                <p className="text-[10px] text-zinc-500">
                  A rota interna do app para onde o cliente será direcionado
                  (ex: `/produtos` ou `/categoria/calcados`).
                </p>
              </div>

              <div className="space-y-1 rounded-2xl border border-white/5 bg-zinc-900/40 p-4">
                <div className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-wider text-white">
                  <ArrowUp className="size-4 text-sky-500" />
                  Sequência / Ordenação
                </div>
                <p className="text-[10px] text-zinc-500">
                  Prioridade de exibição na fila de slides. Ordene usando os
                  controles simples no painel.
                </p>
              </div>

              <div className="space-y-1 rounded-2xl border border-white/5 bg-zinc-900/40 p-4">
                <div className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-wider text-white">
                  <Sparkles className="size-4 text-purple-500" />
                  Status de Exibição
                </div>
                <p className="text-[10px] text-zinc-500">
                  Suspenda ou ative a visibilidade de qualquer campanha
                  instantaneamente usando o botão de alternar.
                </p>
              </div>
            </div>
          </div>
        </div>
      </AdminHelpModal>

      {/* Image Adjuster Modal */}
      <AnimatePresence>
        {isAdjusterOpen && (
          <ImageAdjuster
            isOpen={isAdjusterOpen}
            onClose={() => setIsAdjusterOpen(false)}
            imageUrl={adjustingImgUrl}
            onConfirm={handleAdjustConfirm}
            isSubmitting={isUploadingAdjusted}
            allowedPresets={["2:1", "4:1"]}
            defaultPreset="2:1"
            bannerPreview={{
              title: formData.title ?? undefined,
              subtitle: formData.subtitle ?? undefined,
              buttonText: formData.buttonText ?? undefined,
              titleColor: formData.titleColor ?? undefined,
              subtitleColor: formData.subtitleColor ?? undefined,
              buttonBgColor: formData.buttonBgColor ?? undefined,
              buttonTextColor: formData.buttonTextColor ?? undefined,
              badgeText: formData.badgeText ?? undefined,
              templateType: formData.templateType ?? undefined,
              fontFamily: formData.fontFamily ?? undefined,
              overlayColor: formData.overlayColor ?? undefined,
              overlayOpacity: formData.overlayOpacity ?? undefined,
              showTextOverlay: formData.showTextOverlay,
            }}
          />
        )}
      </AnimatePresence>

      {/* Diálogo de Confirmação de Exclusão de Banner */}
      <AlertDialog
        open={bannerToDelete !== null}
        onOpenChange={(open) => !open && setBannerToDelete(null)}
      >
        <AlertDialogContent className="max-w-md rounded-3xl border border-white/10 bg-zinc-950">
          <AlertDialogHeader>
            <AlertDialogTitle className="text-lg font-black uppercase tracking-tight text-white">
              Excluir Banner?
            </AlertDialogTitle>
            <AlertDialogDescription className="text-xs text-zinc-400">
              Tem certeza que deseja excluir este banner? Esta ação não pode ser
              desfeita e removerá a campanha do catálogo.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter className="mt-4 gap-2">
            <AlertDialogCancel className="rounded-xl border border-0 border-white/10 bg-white/5 px-4 py-2 text-xs font-bold text-zinc-400 hover:bg-white/10 hover:text-white">
              Cancelar
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={confirmDeleteBanner}
              className="bg-rose-650 rounded-xl border-0 px-4 py-2 text-xs font-bold text-white hover:bg-rose-700"
            >
              Excluir Banner
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
});
