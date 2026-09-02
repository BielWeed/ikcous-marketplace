import { LazyImage } from "@/components/LazyImage";
import { AdminHelpModal } from "@/components/admin/AdminHelpModal";
import {
  LocalBufferedInput,
  LocalBufferedTextarea,
} from "@/components/admin/LocalBufferedInput";
import { PhoneSimulator } from "@/components/admin/PhoneSimulator";
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
import { ImageAdjuster } from "@/components/ui/custom/ImageAdjuster";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { useStore } from "@/contexts/StoreContext";
import { useCategories } from "@/hooks/useCategories";
import { useOnlineStatus } from "@/hooks/useOnlineStatus";
import { useProducts } from "@/hooks/useProducts";
import { cn } from "@/lib/utils";
import type { ProductVariant, View } from "@/types";
import { temGrupoDemais, travaDeUmGrupoSo } from "@/utils/um-grupo-de-variacao";
import { AnimatePresence, motion } from "framer-motion";
import {
  AlertTriangle,
  BookOpen,
  Camera,
  Check,
  DollarSign,
  Edit2,
  HelpCircle,
  Image as ImageIcon,
  Info,
  Layers,
  Loader2,
  Package,
  Plus,
  Scissors,
  ShieldCheck,
  Smartphone,
  Trash2,
  TrendingDown,
  TrendingUp,
  Truck,
} from "lucide-react";
import React, { useState, useEffect, useCallback, useRef } from "react";
import { createPortal } from "react-dom";
import { toast } from "sonner";
// Exportado só para o teste chamar direto (não passa pelo componente inteiro)
// — continua sendo um detalhe interno desta tela, não uma API pública. Nome
// `compressProductImage` (não `compressImage`) de propósito: já existe um
// `compressImage` em `src/utils/avatars.ts` (assinatura incompatível,
// `string` → `Promise<string>`), e o TypeScript pega o auto-import errado
// quando os dois se chamam igual.
export const compressProductImage = (
  file: File,
  maxWidth = 1200,
  maxHeight = 1200,
  quality = 0.85,
): Promise<File> => {
  return new Promise((resolve) => {
    if (!file.type.startsWith("image/") || file.size < 100 * 1024) {
      resolve(file);
      return;
    }

    const img = new Image();
    const objectUrl = URL.createObjectURL(file);

    img.onload = () => {
      let width = img.width;
      let height = img.height;

      if (width > height) {
        if (width > maxWidth) {
          height = Math.round((height * maxWidth) / width);
          width = maxWidth;
        }
      } else {
        if (height > maxHeight) {
          width = Math.round((width * maxHeight) / height);
          height = maxHeight;
        }
      }

      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;

      const ctx = canvas.getContext("2d");
      if (!ctx) {
        URL.revokeObjectURL(objectUrl);
        resolve(file);
        return;
      }

      // JPEG não tem canal alfa: sem pintar um fundo antes, a área
      // transparente de um PNG (produto recortado, sem fundo) é composta
      // sobre PRETO por padrão do canvas no `toBlob` abaixo — a foto que
      // vende o produto na vitrine aparece com um retângulo preto atrás.
      // Mesmo conserto de `src/utils/avatars.ts`/`src/utils/covers.ts`:
      // branco, ANTES do `drawImage`, mantendo `image/jpeg` (o upload e o
      // resto do app já esperam esse tipo).
      ctx.fillStyle = "#FFFFFF";
      ctx.fillRect(0, 0, width, height);
      ctx.drawImage(img, 0, 0, width, height);

      canvas.toBlob(
        (blob) => {
          URL.revokeObjectURL(objectUrl);
          if (blob) {
            const compressedFile = new File([blob], file.name, {
              type: "image/jpeg",
              lastModified: Date.now(),
            });
            resolve(compressedFile);
          } else {
            resolve(file);
          }
        },
        "image/jpeg",
        quality,
      );
    };

    img.onerror = () => {
      URL.revokeObjectURL(objectUrl);
      resolve(file);
    };

    img.src = objectUrl;
  });
};

interface AdminProductFormViewProps {
  productId?: string;
  onNavigate: (view: View, id?: string, bypassDirtyCheck?: boolean) => void;
  onSetDirty?: (dirty: boolean) => void;
}

const containerVariants = {
  hidden: { opacity: 0 },
  visible: {
    opacity: 1,
    transition: {
      staggerChildren: 0.1,
      delayChildren: 0.2,
    },
  },
};

// const itemVariants = {
//   hidden: { opacity: 0, y: 20 },
//   visible: { opacity: 1, y: 0 }
// };

interface ProductFormFields {
  name: string;
  description: string;
  price: string;
  costPrice: string;
  originalPrice: string;
  stock: string;
  category: string;
  images: string[];
  freeShipping: boolean;
  isBestseller: boolean;
  isActive: boolean;
  metaTitle: string;
  metaDescription: string;
  sku: string;
  variants: ProductVariant[];
  weightKg: string;
  widthCm: string;
  heightCm: string;
  lengthCm: string;
}

function isProductFormDirty(
  a: ProductFormFields,
  b: ProductFormFields,
): boolean {
  if (a.name !== b.name) return true;
  if (a.description !== b.description) return true;
  if (a.price !== b.price) return true;
  if (a.costPrice !== b.costPrice) return true;
  if (a.originalPrice !== b.originalPrice) return true;
  if (a.stock !== b.stock) return true;
  if (a.category !== b.category) return true;
  if (a.freeShipping !== b.freeShipping) return true;
  if (a.isBestseller !== b.isBestseller) return true;
  if (a.isActive !== b.isActive) return true;
  if (a.metaTitle !== b.metaTitle) return true;
  if (a.metaDescription !== b.metaDescription) return true;
  if (a.sku !== b.sku) return true;
  if (a.weightKg !== b.weightKg) return true;
  if (a.widthCm !== b.widthCm) return true;
  if (a.heightCm !== b.heightCm) return true;
  if (a.lengthCm !== b.lengthCm) return true;

  if (a.images.length !== b.images.length) return true;
  for (let i = 0; i < a.images.length; i++) {
    if (a.images[i] !== b.images[i]) return true;
  }

  if (a.variants.length !== b.variants.length) return true;
  for (let i = 0; i < a.variants.length; i++) {
    const vA = a.variants[i];
    const vB = b.variants[i];
    if (
      vA.id !== vB.id ||
      vA.productId !== vB.productId ||
      vA.sku !== vB.sku ||
      vA.name !== vB.name ||
      vA.value !== vB.value ||
      vA.stockIncrement !== vB.stockIncrement ||
      vA.stock !== vB.stock ||
      vA.priceOverride !== vB.priceOverride ||
      vA.active !== vB.active ||
      vA.imageUrl !== vB.imageUrl
    )
      return true;
  }

  return false;
}

export const AdminProductFormView = React.memo(function AdminProductFormView({
  productId,
  onNavigate,
  onSetDirty,
}: AdminProductFormViewProps) {
  const {
    addProduct,
    updateProduct,
    upsertVariants,
    deleteVariants,
    uploadProductImages,
    fetchProduct,
  } = useProducts({ autoFetch: false });
  const { categories: dbCategories, addCategory } = useCategories();
  const isOffline = useOnlineStatus();
  const { config } = useStore();
  const isLocalShipping = config?.shippingCoverage === "local";

  const [isLoading, setIsLoading] = useState(!!productId);
  const [formData, setFormData] = useState({
    name: "",
    description: "",
    price: "",
    costPrice: "",
    originalPrice: "",
    stock: "",
    category: "",
    images: [] as string[],
    freeShipping: false,
    isBestseller: false,
    isActive: true,
    metaTitle: "",
    metaDescription: "",
    sku: "",
    variants: [] as ProductVariant[],
    weightKg: "",
    widthCm: "",
    heightCm: "",
    lengthCm: "",
  });

  const [initialData, setInitialData] = useState({
    name: "",
    description: "",
    price: "",
    costPrice: "",
    originalPrice: "",
    stock: "",
    category: "",
    images: [] as string[],
    freeShipping: false,
    isBestseller: false,
    isActive: true,
    metaTitle: "",
    metaDescription: "",
    sku: "",
    variants: [] as ProductVariant[],
    weightKg: "",
    widthCm: "",
    heightCm: "",
    lengthCm: "",
  });

  const [isSubmitting, setIsSubmitting] = useState(false);
  const [showSuccess, setShowSuccess] = useState(false);
  const [draftChecked, setDraftChecked] = useState(false);
  const [showVariantForm, setShowVariantForm] = useState(false);
  const [editingVariant, setEditingVariant] = useState<ProductVariant | null>(
    null,
  );
  const [variantFormData, setVariantFormData] = useState({
    name: "",
    value: "",
    sku: "",
    stockIncrement: "0",
    priceOverride: "",
    active: true,
    imageUrl: "",
  });
  const [currentProduct, setCurrentProduct] = useState<any>(null);
  const [showCategoryForm, setShowCategoryForm] = useState(false);
  const [newCategoryName, setNewCategoryName] = useState("");
  const [deletedVariantIds, setDeletedVariantIds] = useState<string[]>([]);
  const [variantToDelete, setVariantToDelete] = useState<string | null>(null);
  const [isPromoActive, setIsPromoActive] = useState(false);

  const [skuError, setSkuError] = useState("");
  const [priceError, setPriceError] = useState("");
  const [costError, setCostError] = useState("");
  const [originalPriceError, setOriginalPriceError] = useState("");
  const [stockError, setStockError] = useState("");
  const [previewMode, setPreviewMode] = useState<"card" | "page">("card");
  const [isPreviewOpen, setIsPreviewOpen] = useState(false);
  const [showHelpModal, setShowHelpModal] = useState(false);
  const [activeDetailTab, setActiveDetailTab] = useState<
    "description" | "reviews" | "questions"
  >("description");
  const [previewImgIndex, setPreviewImgIndex] = useState(0);
  const [previewSelectedVariants, setPreviewSelectedVariants] = useState<
    Record<string, string>
  >({});

  // Image Adjustment and Quality state variables
  const [imageMetadata, setImageMetadata] = useState<
    Record<
      string,
      {
        width: number;
        height: number;
        status:
          | "loading"
          | "excellent"
          | "warning_aspect"
          | "warning_res"
          | "good";
      }
    >
  >({});
  const evaluatedImagesRef = useRef<Set<string>>(new Set());
  // #98 (ADMIN-060): guarda o setTimeout de navegação pós-sucesso para poder
  // cancelá-lo se o admin sair da tela antes dos 1,5s — sem isto, onNavigate
  // dispara mesmo com o componente já desmontado.
  const successTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [isAdjusterOpen, setIsAdjusterOpen] = useState(false);
  const [adjustingImgUrl, setAdjustingImgUrl] = useState("");
  const [adjustingImgIndex, setAdjustingImgIndex] = useState<number | null>(
    null,
  );
  const [isUploadingAdjusted, setIsUploadingAdjusted] = useState(false);
  const [isUploadingImages, setIsUploadingImages] = useState(false);
  const [imageUploadStep, setImageUploadStep] = useState<
    "compressing" | "uploading" | "idle"
  >("idle");
  const isImageUploading = isUploadingImages || isUploadingAdjusted;
  const [isDragging, setIsDragging] = useState(false);

  const [showPhotoGuide, setShowPhotoGuide] = useState(false);
  const [expandedHelp, setExpandedHelp] = useState<Record<string, boolean>>({});

  const toggleHelp = (key: string) => {
    setExpandedHelp((prev) => ({
      ...prev,
      [key]: !prev[key],
    }));
  };

  // Um produto so pode ter UM grupo de variacao -- ver `um-grupo-de-variacao.ts`.
  // Enquanto nao ha nenhuma variante, sugerir os grupos comuns ajuda; a partir
  // da primeira, sugerir "Tamanho" a quem ja escolheu "Cor" seria convidar
  // para o estado que a trava logo abaixo recusa.
  const gruposJaUsados = formData.variants.map((v) => v.name).filter(Boolean);
  const suggestedAttributes = Array.from(
    new Set(
      gruposJaUsados.length > 0
        ? gruposJaUsados
        : ["Cor", "Tamanho", "Voltagem"],
    ),
  ).filter(Boolean);
  const produtoTemGrupoDemais = temGrupoDemais(formData.variants);

  useEffect(() => {
    formData.images.forEach((url) => {
      if (evaluatedImagesRef.current.has(url)) return;
      evaluatedImagesRef.current.add(url);

      setImageMetadata((prev) => ({
        ...prev,
        [url]: { width: 0, height: 0, status: "loading" },
      }));

      const img = new Image();
      img.crossOrigin = "anonymous";
      img.onload = () => {
        const w = img.naturalWidth;
        const h = img.naturalHeight;
        const ratio = w / h;
        const res = w * h;

        let status: "excellent" | "warning_aspect" | "warning_res" | "good" =
          "good";

        if (res < 600 * 600) {
          status = "warning_res";
        } else if (
          (ratio < 0.7 || ratio > 0.9) &&
          (ratio < 0.95 || ratio > 1.05)
        ) {
          status = "warning_aspect";
        } else if (res >= 1000 * 1000) {
          status = "excellent";
        }

        setImageMetadata((prev) => ({
          ...prev,
          [url]: { width: w, height: h, status },
        }));
      };
      img.onerror = () => {
        setImageMetadata((prev) => ({
          ...prev,
          [url]: { width: 0, height: 0, status: "good" },
        }));
      };
      img.src = url;
    });
  }, [formData.images]);

  // Lock body scroll when variant or category forms are open
  useEffect(() => {
    if (showVariantForm || showCategoryForm) {
      document.body.classList.add("admin-modal-open");
      return () => {
        document.body.classList.remove("admin-modal-open");
      };
    }
  }, [showVariantForm, showCategoryForm]);

  const openAdjuster = (url: string, index: number) => {
    setAdjustingImgUrl(url);
    setAdjustingImgIndex(index);
    setIsAdjusterOpen(true);
  };

  const handleAdjustConfirm = async (croppedBlob: Blob) => {
    if (adjustingImgIndex === null) return;
    setIsUploadingAdjusted(true);

    const file = new File([croppedBlob], `product-image-${Date.now()}.jpg`, {
      type: "image/jpeg",
    });
    const loadingToast = toast.loading("Enviando imagem recortada...");

    try {
      const urls = await uploadProductImages([file]);
      if (urls && urls.length > 0) {
        const newUrl = urls[0];
        setFormData((prev) => {
          const newImages = [...prev.images];
          newImages[adjustingImgIndex] = newUrl;
          return {
            ...prev,
            images: newImages,
          };
        });

        // Pre-evaluate the newly cropped image immediately
        const img = new Image();
        img.onload = () => {
          setImageMetadata((prev) => ({
            ...prev,
            [newUrl]: {
              width: img.naturalWidth,
              height: img.naturalHeight,
              status: "excellent",
            },
          }));
        };
        img.src = newUrl;

        toast.success("Imagem ajustada com sucesso!", { id: loadingToast });
        setIsAdjusterOpen(false);
        setAdjustingImgIndex(null);
      } else {
        throw new Error("Upload returned empty list");
      }
    } catch (error) {
      console.error("Error uploading adjusted image:", error);
      toast.error("Erro ao salvar imagem ajustada", { id: loadingToast });
    } finally {
      setIsUploadingAdjusted(false);
    }
  };

  useEffect(() => {
    if (productId) {
      const loadProduct = async () => {
        setIsLoading(true);
        // PAINEL-06: distinguir "não existe" de "não consegui carregar".
        // Antes: fetchProduct engolia erro de rede e devolvia null —
        // a view dizia "não encontrado" e expulsava o lojista.
        let product: ReturnType<typeof fetchProduct> extends Promise<infer T>
          ? T
          : never = null;
        try {
          product = await fetchProduct(productId);
        } catch (err) {
          console.error("[ProductForm] Erro ao carregar produto:", err);
          toast.error("Erro ao carregar produto. Verifique a conexão.");
          setIsLoading(false);
          // B3 da 2a revisao: SEM isto, o formulario vazio renderizava
          // normalmente — e Salvar com currentProduct null chamava
          // updateProduct com o objeto inteiro, APAGANDO os dados do
          // produto real (imagem_urls=[], custo=null, sold=0).
          // B3: currentProduct ja esta null (produto nao carregou) —
          // handleSubmit usa currentProduct para decidir update vs insert,
          // entao um save daqui seria um INSERT vazio, nao um UPDATE
          // destrutivo. Mas para nao deixar o lojista parado num form que
          // parece editavel, a tela de erro deve ocupar o render inteiro.
          return;
        }
        if (product) {
          const productFields = {
            name: product.name,
            description: product.description,
            price: product.price.toString(),
            costPrice: product.costPrice?.toString() || "",
            originalPrice: product.originalPrice?.toString() || "",
            stock: product.stock.toString(),
            category: product.category,
            images: product.images,
            freeShipping: product.freeShipping,
            isBestseller: product.isBestseller,
            isActive: product.isActive,
            metaTitle: product.metaTitle || "",
            metaDescription: product.metaDescription || "",
            sku: product.sku || "",
            variants: product.variants || [],
            weightKg: product.weightKg?.toString() || "",
            widthCm: product.widthCm?.toString() || "",
            heightCm: product.heightCm?.toString() || "",
            lengthCm: product.lengthCm?.toString() || "",
          };
          setFormData(productFields);
          setInitialData(productFields);
          setIsPromoActive(!!product.originalPrice);
          setCurrentProduct(product);
        } else {
          toast.error("Produto não encontrado");
          onNavigate("admin-products");
        }
        setIsLoading(false);
      };
      loadProduct();
    }
  }, [productId, fetchProduct, onNavigate]);
  // Draft recovery on mount for new products
  useEffect(() => {
    if (!productId) {
      const savedDraft = localStorage.getItem("ikcous_product_form_draft");
      if (savedDraft) {
        try {
          const parsed = JSON.parse(savedDraft);
          const draftFields = {
            name: parsed.name || "",
            description: parsed.description || "",
            price: parsed.price || "",
            costPrice: parsed.costPrice || "",
            originalPrice: parsed.originalPrice || "",
            stock: parsed.stock || "",
            category: parsed.category || "",
            images: parsed.images || [],
            freeShipping: !!parsed.freeShipping,
            isBestseller: !!parsed.isBestseller,
            isActive: parsed.isActive !== false,
            metaTitle: parsed.metaTitle || "",
            metaDescription: parsed.metaDescription || "",
            sku: parsed.sku || "",
            variants: parsed.variants || [],
            weightKg: parsed.weightKg || "",
            widthCm: parsed.widthCm || "",
            heightCm: parsed.heightCm || "",
            lengthCm: parsed.lengthCm || "",
          };
          setFormData(draftFields);
          setInitialData(draftFields);
          setIsPromoActive(!!parsed.originalPrice);

          toast.success("Rascunho recuperado automaticamente!", {
            description:
              "Você pode continuar editando o produto de onde parou.",
            action: {
              label: "Descartar",
              onClick: () => {
                localStorage.removeItem("ikcous_product_form_draft");
                const emptyFields = {
                  name: "",
                  description: "",
                  price: "",
                  costPrice: "",
                  originalPrice: "",
                  stock: "",
                  category: "",
                  images: [] as string[],
                  freeShipping: false,
                  isBestseller: false,
                  isActive: true,
                  metaTitle: "",
                  metaDescription: "",
                  sku: "",
                  variants: [] as ProductVariant[],
                  weightKg: "",
                  widthCm: "",
                  heightCm: "",
                  lengthCm: "",
                };
                setFormData(emptyFields);
                setInitialData(emptyFields);
                setIsPromoActive(false);
                toast.info("Rascunho descartado.");
              },
            },
            duration: 6000,
          });
        } catch (e) {
          console.error("[AdminProductFormView] Failed to parse draft:", e);
        }
      }
      setDraftChecked(true);
    }
  }, [productId]);

  // Draft recovery on mount for existing products
  useEffect(() => {
    if (productId && !isLoading) {
      const draftKey = `ikcous_product_form_draft_edit_${productId}`;
      const savedDraft = localStorage.getItem(draftKey);
      if (savedDraft) {
        try {
          const parsed = JSON.parse(savedDraft);

          // Only prompt if the draft actually contains modified data compared to DB (initialData)
          const draftFields = {
            name: parsed.name ?? initialData.name,
            description: parsed.description ?? initialData.description,
            price: parsed.price ?? initialData.price,
            costPrice: parsed.costPrice ?? initialData.costPrice,
            originalPrice: parsed.originalPrice ?? initialData.originalPrice,
            stock: parsed.stock ?? initialData.stock,
            category: parsed.category ?? initialData.category,
            images: parsed.images ?? initialData.images,
            freeShipping:
              parsed.freeShipping !== undefined
                ? !!parsed.freeShipping
                : initialData.freeShipping,
            isBestseller:
              parsed.isBestseller !== undefined
                ? !!parsed.isBestseller
                : initialData.isBestseller,
            isActive:
              parsed.isActive !== undefined
                ? !!parsed.isActive
                : initialData.isActive,
            metaTitle: parsed.metaTitle ?? initialData.metaTitle,
            metaDescription:
              parsed.metaDescription ?? initialData.metaDescription,
            sku: parsed.sku ?? initialData.sku,
            variants: parsed.variants ?? initialData.variants,
            weightKg: parsed.weightKg ?? initialData.weightKg,
            widthCm: parsed.widthCm ?? initialData.widthCm,
            heightCm: parsed.heightCm ?? initialData.heightCm,
            lengthCm: parsed.lengthCm ?? initialData.lengthCm,
          };

          const isDraftDifferent = isProductFormDirty(draftFields, initialData);

          if (isDraftDifferent) {
            toast.info("Rascunho não salvo encontrado para este produto", {
              description:
                "Deseja restaurar as alterações que você fez anteriormente?",
              action: {
                label: "Restaurar",
                onClick: () => {
                  setFormData(draftFields);
                  setIsPromoActive(!!draftFields.originalPrice);
                  toast.success("Rascunho restaurado!");
                },
              },
              cancel: {
                label: "Descartar",
                onClick: () => {
                  localStorage.removeItem(draftKey);
                  toast.info("Rascunho descartado.");
                },
              },
              duration: 10000,
            });
          } else {
            // Draft matches database state, clean it up
            localStorage.removeItem(draftKey);
          }
        } catch (e) {
          console.error(
            "[AdminProductFormView] Failed to parse edit draft:",
            e,
          );
        }
      }
      setDraftChecked(true);
    }
  }, [productId, isLoading, initialData]);

  // Prevent leaving with unsaved changes
  useEffect(() => {
    if (!onSetDirty) return;
    const isDirty = isProductFormDirty(formData, initialData);
    onSetDirty(isDirty);
    return () => {
      onSetDirty(false);
    };
  }, [formData, initialData, onSetDirty]);

  useEffect(() => {
    // Validar SKU
    if (formData.sku) {
      const hasSpecialChars = /[^A-Z0-9-]/i.test(formData.sku);
      if (hasSpecialChars) {
        setSkuError("O SKU deve conter apenas letras, números e hífens.");
      } else {
        setSkuError("");
      }
    } else {
      setSkuError("");
    }
  }, [formData.sku]);

  useEffect(() => {
    // Validar Preço de Venda
    const price = Number.parseFloat(formData.price);
    if (formData.price && (Number.isNaN(price) || price <= 0)) {
      setPriceError("Preço de venda deve ser maior que zero.");
    } else {
      setPriceError("");
    }
  }, [formData.price]);

  useEffect(() => {
    // Validar Preço de Custo
    const price = Number.parseFloat(formData.price) || 0;
    const cost = Number.parseFloat(formData.costPrice);
    if (formData.costPrice && !Number.isNaN(cost)) {
      if (cost < 0) {
        setCostError("Preço de custo não pode ser negativo.");
      } else if (price > 0 && cost >= price) {
        setCostError(
          "Aviso: Preço de custo é maior ou igual ao preço de venda (prejuízo!).",
        );
      } else {
        setCostError("");
      }
    } else {
      setCostError("");
    }
  }, [formData.costPrice, formData.price]);

  useEffect(() => {
    // Validar Preço Original (De:)
    const price = Number.parseFloat(formData.price) || 0;
    const orig = Number.parseFloat(formData.originalPrice);
    if (isPromoActive && formData.originalPrice && !Number.isNaN(orig)) {
      if (orig <= price) {
        setOriginalPriceError(
          'Preço original ("De:") deve ser maior que o preço promocional.',
        );
      } else {
        setOriginalPriceError("");
      }
    } else {
      setOriginalPriceError("");
    }
  }, [formData.originalPrice, formData.price, isPromoActive]);

  useEffect(() => {
    // Validar Estoque
    const stock = Number.parseInt(formData.stock);
    if (formData.stock && (Number.isNaN(stock) || stock < 0)) {
      setStockError("O estoque deve ser maior ou igual a zero.");
    } else {
      setStockError("");
    }
  }, [formData.stock]);

  // Sync stock dynamically if there are active variants
  useEffect(() => {
    const activeVariants = formData.variants.filter((v) => v.active);
    if (activeVariants.length > 0) {
      const sum = activeVariants.reduce(
        (acc, v) => acc + (v.stockIncrement || 0),
        0,
      );
      if (formData.stock !== sum.toString()) {
        setFormData((prev) => ({ ...prev, stock: sum.toString() }));
      }
    }
  }, [formData.variants, formData.stock]);

  // Draft auto-save on changes
  //
  // #98 (ADMIN-060): este efeito NUNCA remove a chave do rascunho — só
  // decide se salva (quando o formulário está sujo). Antes do conserto, o
  // `else` chamava `localStorage.removeItem(draftKey)` sempre que
  // formData === initialData — que é EXATAMENTE o estado em que o formulário
  // nasce ao abrir um produto para edição (os dois vêm do mesmo `product`
  // carregado). Resultado: 1s depois de abrir a tela, o rascunho pendente
  // era apagado sozinho, enquanto o toast de recuperação ainda prometia 10s
  // para restaurar. Remoção só acontece por decisão explícita do usuário —
  // Restaurar ou Descartar, no efeito de verificação acima.
  //
  // #99 (revisão): uma versão anterior deste efeito também parava de SALVAR
  // enquanto o toast de rascunho pendente estivesse aberto (guarda
  // `draftResolvedRef.current`). O toast tem `duration: 10000` e nenhum
  // `onAutoClose`/`onDismiss` — se o admin não clicasse em Restaurar/
  // Descartar, a flag ficava presa em `false` pelo resto da sessão de edição
  // e o auto-save morria: as próximas edições nunca eram gravadas. Isso
  // trocava a perda de trabalho da #98 (rascunho velho apagado) por outra
  // (edições novas nunca salvas), no mesmo caminho.
  //
  // A guarda foi removida porque não defendia nada que já não estivesse
  // defendido: o botão "Restaurar" aplica `draftFields`, uma variável
  // capturada no closure do toast, não uma releitura do `localStorage` — o
  // auto-save pode sobrescrever a chave enquanto o toast está aberto sem
  // quebrar o Restaurar.
  useEffect(() => {
    if (isLoading || !draftChecked) return;

    const timer = setTimeout(() => {
      const isDirty = isProductFormDirty(formData, initialData);
      const draftKey = !productId
        ? "ikcous_product_form_draft"
        : `ikcous_product_form_draft_edit_${productId}`;
      if (isDirty) {
        localStorage.setItem(draftKey, JSON.stringify(formData));
      }
    }, 1000);

    return () => clearTimeout(timer);
  }, [formData, initialData, productId, isLoading, draftChecked]);

  const processAndUploadImages = useCallback(
    async (files: File[]) => {
      if (files.length === 0) return;

      const currentImagesCount = formData.images.length;
      if (currentImagesCount + files.length > 10) {
        toast.error(
          `Limite de imagens excedido. Você já possui ${currentImagesCount} imagens e tentou adicionar mais ${files.length}. O máximo permitido são 10 imagens.`,
        );
        return;
      }

      const MAX_SINGLE_SIZE = 12 * 1024 * 1024; // 12MB
      const MAX_TOTAL_SIZE = 30 * 1024 * 1024; // 30MB
      let totalSize = 0;

      for (const file of files) {
        if (file.size > MAX_SINGLE_SIZE) {
          toast.error(
            `O arquivo "${file.name}" excede o tamanho limite de 12MB. Envie uma imagem menor.`,
          );
          return;
        }
        totalSize += file.size;
      }

      if (totalSize > MAX_TOTAL_SIZE) {
        toast.error(
          `O tamanho total das imagens selecionadas (${(totalSize / (1024 * 1024)).toFixed(1)}MB) excede o limite de 30MB por envio.`,
        );
        return;
      }

      setIsUploadingImages(true);
      setImageUploadStep("compressing");
      const loadingToast = toast.loading(
        `Comprimindo ${files.length} imagem(ns)...`,
      );
      try {
        const compressedFiles = await Promise.all(
          files.map((file) => compressProductImage(file)),
        );

        setImageUploadStep("uploading");
        toast.loading("Enviando imagens processadas...", { id: loadingToast });

        const urls = await uploadProductImages(compressedFiles);
        if (urls && urls.length > 0) {
          setFormData((prev) => ({
            ...prev,
            images: [...prev.images, ...urls],
          }));
          toast.success("Imagens processadas e enviadas com sucesso!", {
            id: loadingToast,
          });
        } else {
          throw new Error("Falha no upload.");
        }
      } catch (error) {
        console.error("[Upload] Process error:", error);
        toast.error("Erro ao processar ou enviar imagens.", {
          id: loadingToast,
          description:
            "Por favor, verifique sua conexão e tente enviar novamente.",
        });
      } finally {
        setIsUploadingImages(false);
        setImageUploadStep("idle");
      }
    },
    [formData.images.length, uploadProductImages],
  );

  const handleImageUpload = useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>) => {
      if (isOffline) {
        toast.error("Não é possível enviar imagens em modo offline.");
        return;
      }
      const files = Array.from(e.target.files || []);
      await processAndUploadImages(files);
    },
    [processAndUploadImages, isOffline],
  );

  const removeImage = useCallback((index: number) => {
    setFormData((prev) => ({
      ...prev,
      images: prev.images.filter((_, i) => i !== index),
    }));
  }, []);

  const handleVariantSubmit = () => {
    if (!variantFormData.name.trim()) {
      toast.error("O nome do atributo (ex: Cor, Tamanho) é obrigatório.");
      return;
    }
    if (!variantFormData.value.trim()) {
      toast.error("O valor do atributo (ex: Espacial Grey) é obrigatório.");
      return;
    }

    // Um grupo por produto. Com dois, o estoque passa a ser somado em dobro, o
    // carrinho funde combinacoes diferentes numa linha so e o pedido guarda
    // metade da escolha -- quem compra um P e um M recebe dois P. O porque
    // inteiro, medido, esta em `src/utils/um-grupo-de-variacao.ts`.
    const trava = travaDeUmGrupoSo(
      formData.variants,
      editingVariant?.id ?? null,
      variantFormData.name,
    );
    if (trava.bloqueia) {
      toast.error(`Este produto já usa "${trava.grupoEmUso}"`, {
        description:
          "Cada produto aceita um tipo de variação só. Para vender cor e " +
          "tamanho juntos, crie as opções combinadas dentro do mesmo tipo " +
          '(ex: "Rosa P", "Rosa M") — assim o estoque e o pedido saem certos.',
        duration: 10000,
      });
      return;
    }

    const cleanNumberString = (val: string) => {
      if (!val) return "";
      let clean = val.replace(",", ".").replace(/[^\d.-]/g, "");
      const parts = clean.split(".");
      if (parts.length > 2) {
        clean = `${parts[0]}.${parts.slice(1).join("")}`;
      }
      return clean;
    };

    const sanitizedVarPrice = cleanNumberString(variantFormData.priceOverride);
    const sanitizedVarStock = variantFormData.stockIncrement.replace(/\D/g, "");

    const parsedPriceOverride = sanitizedVarPrice
      ? Number.parseFloat(sanitizedVarPrice)
      : undefined;
    const sanitizedVarSku = variantFormData.sku
      ? variantFormData.sku.trim().toUpperCase().replace(/\s+/g, "-")
      : undefined;

    const vData = {
      productId: productId || "",
      name: variantFormData.name.trim(),
      value: variantFormData.value.trim(),
      sku: sanitizedVarSku || undefined,
      stockIncrement: Number.parseInt(sanitizedVarStock) || 0,
      priceOverride:
        parsedPriceOverride !== undefined
          ? Math.max(0, parsedPriceOverride)
          : undefined,
      active: variantFormData.active,
      imageUrl: variantFormData.imageUrl || undefined,
    };

    if (editingVariant) {
      setFormData((prev) => ({
        ...prev,
        variants: prev.variants.map((v) =>
          v.id === editingVariant.id ? { ...v, ...vData } : v,
        ),
      }));
    } else {
      setFormData((prev) => ({
        ...prev,
        variants: [
          ...prev.variants,
          {
            ...vData,
            id: `temp-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
          } as any,
        ],
      }));
    }

    setShowVariantForm(false);
    setEditingVariant(null);
    setVariantFormData({
      name: "",
      value: "",
      sku: "",
      stockIncrement: "0",
      priceOverride: "",
      active: true,
      imageUrl: "",
    });
  };

  const handleDeleteVariant = useCallback((vId: string) => {
    setVariantToDelete(vId);
  }, []);

  const handleEditVariant = useCallback((v: ProductVariant) => {
    setEditingVariant(v);
    setVariantFormData({
      name: v.name,
      value: v.value,
      sku: v.sku || "",
      stockIncrement: v.stockIncrement.toString(),
      priceOverride: v.priceOverride?.toString() || "",
      active: v.active,
      imageUrl: v.imageUrl || "",
    });
    setShowVariantForm(true);
  }, []);

  const confirmDeleteVariant = () => {
    if (!variantToDelete) return;
    if (!variantToDelete.startsWith("temp-")) {
      setDeletedVariantIds((prev) => [...prev, variantToDelete]);
    }
    setFormData((prev) => ({
      ...prev,
      variants: prev.variants.filter((v) => v.id !== variantToDelete),
    }));
    setVariantToDelete(null);
  };

  const handleSubmit = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    // #98 (ADMIN-060): showSuccess também bloqueia reentrada. Entre o
    // sucesso e a navegação (1,5s) `isSubmitting` já voltou a false mas o
    // botão ainda mostra "Salvo" — sem checar showSuccess aqui, um segundo
    // clique nessa janela reentrava e criava um produto duplicado.
    if (isSubmitting || showSuccess) return;
    if (isOffline) {
      toast.error("Não é possível salvar alterações em modo offline.");
      return;
    }
    setIsSubmitting(true);

    const cleanNumberString = (val: string) => {
      if (!val) return "";
      let clean = val.replace(",", ".").replace(/[^\d.-]/g, "");
      const parts = clean.split(".");
      if (parts.length > 2) {
        clean = `${parts[0]}.${parts.slice(1).join("")}`;
      }
      return clean;
    };

    const sanitizedPrice = cleanNumberString(formData.price);
    const sanitizedCost = cleanNumberString(formData.costPrice);
    const sanitizedOriginal = cleanNumberString(formData.originalPrice);
    const sanitizedStock = formData.stock.replace(/\D/g, "");
    const sanitizedWeight = cleanNumberString(formData.weightKg);
    const sanitizedWidth = cleanNumberString(formData.widthCm);
    const sanitizedHeight = cleanNumberString(formData.heightCm);
    const sanitizedLength = cleanNumberString(formData.lengthCm);

    const pPrice = Number.parseFloat(sanitizedPrice) || 0;
    const pCostRaw = sanitizedCost
      ? Number.parseFloat(sanitizedCost)
      : undefined;
    const pCost =
      pCostRaw !== undefined && !Number.isNaN(pCostRaw) ? pCostRaw : undefined;
    const pOriginalRaw = sanitizedOriginal
      ? Number.parseFloat(sanitizedOriginal)
      : undefined;
    const pOriginal =
      pOriginalRaw !== undefined && !Number.isNaN(pOriginalRaw)
        ? pOriginalRaw
        : undefined;
    const pStock = Number.parseInt(sanitizedStock) || 0;

    const pWeightRaw = sanitizedWeight
      ? Number.parseFloat(sanitizedWeight)
      : undefined;
    const pWeight =
      pWeightRaw !== undefined && !Number.isNaN(pWeightRaw)
        ? pWeightRaw
        : undefined;
    const pWidthRaw = sanitizedWidth
      ? Number.parseFloat(sanitizedWidth)
      : undefined;
    const pWidth =
      pWidthRaw !== undefined && !Number.isNaN(pWidthRaw)
        ? pWidthRaw
        : undefined;
    const pHeightRaw = sanitizedHeight
      ? Number.parseFloat(sanitizedHeight)
      : undefined;
    const pHeight =
      pHeightRaw !== undefined && !Number.isNaN(pHeightRaw)
        ? pHeightRaw
        : undefined;
    const pLengthRaw = sanitizedLength
      ? Number.parseFloat(sanitizedLength)
      : undefined;
    const pLength =
      pLengthRaw !== undefined && !Number.isNaN(pLengthRaw)
        ? pLengthRaw
        : undefined;

    const sanitizedSku = formData.sku
      ? formData.sku.trim().toUpperCase().replace(/\s+/g, "-")
      : undefined;

    /*
      CAMPO VAZIO VAI COMO `null`, NUNCA COMO `undefined` (ADMIN-050, #96).

      Este formulário sempre envia o objeto inteiro — não existe patch parcial
      saindo daqui. Logo, campo vazio aqui só pode significar "quero limpar", e
      nunca "não mexi nesse". `undefined` significaria a segunda coisa: a guarda
      `updates.X !== undefined` do useProducts descarta a chave, o UPDATE sai
      sem a coluna, o valor antigo sobrevive — e a tela confirma "Salvo".

      Era assim que desmarcar "Produto em Promoção" mantinha o preço riscado na
      loja. `null` atravessa a guarda e apaga de verdade.
    */
    const productData = {
      name: formData.name.trim(),
      description: formData.description.trim(),
      price: Math.max(0, pPrice),
      costPrice: pCost !== undefined ? Math.max(0, pCost) : null,
      originalPrice:
        isPromoActive && pOriginal !== undefined
          ? Math.max(0, pOriginal)
          : null,
      stock: Math.max(0, pStock),
      category: formData.category,
      images: formData.images,
      freeShipping: formData.freeShipping,
      isBestseller: formData.isBestseller,
      isActive: formData.isActive,
      metaTitle: formData.metaTitle.trim(),
      metaDescription: formData.metaDescription.trim(),
      sku: sanitizedSku || null,
      variants: formData.variants,
      sold: productId ? currentProduct?.sold || 0 : 0,
      /*
        As dimensões são a ÚNICA exceção à regra do bloco acima, e de propósito:
        com entrega local a tela nem mostra esses campos, então `undefined` aqui
        é literalmente "não mexi" — é o que impede que ligar entrega local apague
        peso e medidas que a lojista já tinha cadastrado para o Melhor Envio.
        Com entrega nacional a tela mostra os campos, e aí vazio quer dizer
        limpar, como no resto do formulário.
      */
      weightKg: isLocalShipping
        ? undefined
        : pWeight !== undefined
          ? Math.max(0, pWeight)
          : null,
      widthCm: isLocalShipping
        ? undefined
        : pWidth !== undefined
          ? Math.max(0, pWidth)
          : null,
      heightCm: isLocalShipping
        ? undefined
        : pHeight !== undefined
          ? Math.max(0, pHeight)
          : null,
      lengthCm: isLocalShipping
        ? undefined
        : pLength !== undefined
          ? Math.max(0, pLength)
          : null,
    };

    try {
      if (productId) {
        // 1. Atualizar produto principal
        await updateProduct(productId, productData);

        // 2. Deletar variantes que foram excluídas localmente
        if (deletedVariantIds.length > 0) {
          await deleteVariants(deletedVariantIds);
        }

        // 3. Salvar variantes restantes em lote
        if (formData.variants.length > 0) {
          const variantsWithSanitizedSku = formData.variants.map((v) => ({
            ...v,
            sku: v.sku
              ? v.sku.trim().toUpperCase().replace(/\s+/g, "-")
              : undefined,
          }));
          await upsertVariants(productId, variantsWithSanitizedSku);
        }
      } else {
        const variantsWithSanitizedSku = formData.variants.map((v) => ({
          ...v,
          sku: v.sku
            ? v.sku.trim().toUpperCase().replace(/\s+/g, "-")
            : undefined,
        }));
        await addProduct({
          ...productData,
          variants: variantsWithSanitizedSku,
        });
      }

      setIsSubmitting(false);
      setShowSuccess(true);
      // Achado da re-revisão da #98: iguala formData/initialData depois de
      // publicar, para o auto-save já agendado (efeito acima) encontrar
      // isDirty=false e não regravar a chave que a linha abaixo acabou de
      // remover — sem isto, o timer pendente na última edição publica o
      // rascunho de volta ~1s depois.
      setInitialData(formData);
      if (!productId) {
        localStorage.removeItem("ikcous_product_form_draft");
      } else {
        localStorage.removeItem(`ikcous_product_form_draft_edit_${productId}`);
      }

      // #98 (ADMIN-060): guardado em ref e cancelado no unmount (efeito
      // logo abaixo) — sem isto, sair da tela na janela de "Salvo" ainda
      // deixava esta navegação disparar 1,5s depois, com o componente já
      // desmontado.
      successTimerRef.current = setTimeout(() => {
        successTimerRef.current = null;
        onSetDirty?.(false);
        onNavigate("admin-products", undefined, true);
      }, 1500);
    } catch (error) {
      setIsSubmitting(false);
      console.error("Erro ao salvar produto:", error);
      // Laudo 0109 (A12): o toast ficou no hook (useProducts traduz o erro
      // com mensagemAmigavelErroProduto e já avisou) — a tela não repete
      // com um aviso genérico por cima (era o "dois toasts empilhados").
    }
  };

  // #98 (ADMIN-060): cancela o setTimeout de navegação pós-sucesso se o
  // componente desmontar antes dele disparar (ex.: admin clica em Voltar
  // logo depois de salvar).
  useEffect(() => {
    return () => {
      if (successTimerRef.current) clearTimeout(successTimerRef.current);
    };
  }, []);

  const isValid =
    formData.name &&
    formData.description &&
    formData.price &&
    formData.stock &&
    formData.category !== "" &&
    Number.parseFloat(formData.price) > 0 &&
    Number.parseInt(formData.stock) >= 0 &&
    !skuError &&
    !priceError &&
    (!costError || costError.startsWith("Aviso")) &&
    !originalPriceError &&
    !stockError;

  // B3 da 2a revisao: produto pediu para editar mas nao carregou —
  // formulario vazio editavel e armadilha (save destrutivo). Erro na tela.
  if (productId && !isLoading && !currentProduct) {
    return (
      <div className="flex min-h-[60vh] flex-col items-center justify-center bg-[#09090b] text-white">
        <div className="flex size-16 items-center justify-center rounded-full border border-red-500/20 bg-red-500/10">
          <svg
            className="size-8 text-red-400"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth={1.5}
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M12 9v3.75m9-.75a9 9 0 11-18 0 9 9 0 0118 0zm-9 3.75h.008v.008H12v-.008z"
            />
          </svg>
        </div>
        <p className="mt-6 text-[10px] font-black uppercase tracking-[0.2em] text-red-400">
          Não foi possível carregar este produto
        </p>
        <p className="mt-1 text-[9px] text-zinc-500">
          Verifique a conexão — o formulário fica bloqueado para proteger os
          dados
        </p>
        <button
          onClick={() => window.location.reload()}
          className="mt-4 rounded-lg border border-white/10 bg-white/5 px-4 py-2 text-[9px] font-black uppercase tracking-widest text-white hover:border-amber-500/30"
        >
          Recarregar
        </button>
      </div>
    );
  }

  if (isLoading) {
    return (
      <div className="min-h-screen animate-pulse select-none bg-zinc-950 pb-12 text-white">
        {/* Background Decor */}
        <div className="pointer-events-none fixed inset-0 overflow-hidden">
          <div className="absolute right-0 top-0 h-[500px] w-[500px] rounded-full bg-emerald-500/5 blur-[120px]" />
          <div className="absolute bottom-0 left-0 h-[500px] w-[500px] rounded-full bg-blue-500/5 blur-[120px]" />
        </div>

        <header className="sticky top-0 z-30 border-b border-white/5 bg-zinc-950/80 px-4 py-3 backdrop-blur-md md:px-6 md:py-4">
          <div className="mx-auto flex max-w-5xl items-center justify-between">
            <div className="flex items-center gap-3 md:gap-4">
              <div className="size-9 rounded-xl border border-white/10 bg-white/5 md:size-10" />
              <div className="space-y-1.5">
                <Skeleton className="h-4 w-32 rounded bg-white/5" />
                <Skeleton className="hidden h-3 w-48 rounded bg-white/5 sm:block" />
              </div>
            </div>
            <Skeleton className="h-10 w-24 rounded-xl border border-white/10 bg-white/5" />
          </div>
        </header>

        <div className="mx-auto max-w-screen-xl space-y-8 p-6">
          <div className="grid grid-cols-1 gap-8 lg:grid-cols-12">
            {/* Left Column */}
            <div className="space-y-8 lg:col-span-8">
              {/* Photos section */}
              <div className="space-y-6 rounded-[2.5rem] border border-white/5 bg-zinc-900/20 p-6">
                <div className="flex items-center justify-between">
                  <Skeleton className="h-4.5 w-24 rounded bg-white/5" />
                </div>
                <div className="flex gap-6">
                  <Skeleton className="size-36 shrink-0 rounded-3xl bg-white/5" />
                  <Skeleton className="size-36 shrink-0 rounded-3xl bg-white/5" />
                </div>
              </div>

              {/* General Data section */}
              <div className="space-y-6 rounded-[2.5rem] border border-white/5 bg-zinc-900/20 p-6">
                <Skeleton className="h-4.5 w-32 rounded bg-white/5" />
                <div className="space-y-3">
                  <Skeleton className="h-3 w-20 rounded bg-white/5" />
                  <Skeleton className="h-14 w-full rounded-2xl bg-white/5" />
                </div>
                <div className="space-y-3">
                  <Skeleton className="h-3 w-28 rounded bg-white/5" />
                  <Skeleton className="h-32 w-full rounded-3xl bg-white/5" />
                </div>
              </div>
            </div>

            {/* Right Column */}
            <div className="space-y-8 lg:col-span-4">
              <div className="space-y-6 rounded-[2.5rem] border border-white/5 bg-zinc-900/20 p-6">
                <Skeleton className="h-4.5 w-24 rounded bg-white/5" />
                {[1, 2, 3].map((i) => (
                  <div key={i} className="flex items-center justify-between">
                    <div className="space-y-1">
                      <Skeleton className="h-3 w-16 rounded bg-white/5" />
                      <Skeleton className="h-2 w-24 rounded bg-white/5" />
                    </div>
                    <Skeleton className="h-6 w-10 rounded-full bg-white/5" />
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  const priceVal = Number.parseFloat(formData.price) || 0;
  const costPriceVal = Number.parseFloat(formData.costPrice) || 0;
  const marginPct =
    priceVal > 0 ? ((priceVal - costPriceVal) / priceVal) * 100 : 0;
  const hasActiveVariants = formData.variants.some((v) => v.active);

  return (
    <div className="relative h-auto min-h-full overflow-x-hidden bg-zinc-950 pb-[calc(11.25rem+var(--safe-area-bottom-fixed,env(safe-area-inset-bottom,0px)))] lg:pb-28 text-white">
      {/* Background Decor */}
      <div className="pointer-events-none fixed inset-0 overflow-hidden">
        <div className="absolute right-0 top-0 h-[500px] w-[500px] rounded-full bg-emerald-500/5 blur-[120px]" />
        <div className="absolute bottom-0 left-0 h-[500px] w-[500px] rounded-full bg-blue-500/5 blur-[120px]" />
      </div>

      {typeof document !== "undefined" &&
        createPortal(
          <AnimatePresence>
            {showCategoryForm && (
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                className="fixed inset-0 z-[110] flex items-center justify-center bg-black/80 p-4 backdrop-blur-sm"
              >
                <motion.div
                  initial={{ scale: 0.9, y: 20 }}
                  animate={{ scale: 1, y: 0 }}
                  className="gpu-accelerated relative w-full max-w-md overflow-hidden rounded-[2.5rem] border border-white/10 bg-zinc-900 p-8 shadow-2xl"
                >
                  <div className="pointer-events-none absolute right-0 top-0 p-8 opacity-5">
                    <Layers className="size-24 text-white" />
                  </div>

                  <div className="relative z-10 mb-8 flex items-center gap-4">
                    <div className="flex size-12 items-center justify-center rounded-2xl border border-emerald-500/20 bg-emerald-500/10">
                      <Layers className="size-6 text-emerald-500" />
                    </div>
                    <div>
                      <h3 className="text-xl font-black tracking-tight">
                        Nova Categoria
                      </h3>
                      <p className="mt-1 text-[10px] font-bold uppercase leading-none tracking-widest text-zinc-500">
                        Classificação de Estoque
                      </p>
                    </div>
                  </div>

                  <div className="relative z-10 space-y-6">
                    <div className="space-y-2">
                      <label
                        htmlFor="cat-name"
                        className="ml-1 text-[10px] font-black uppercase tracking-widest text-zinc-500"
                      >
                        Nome do Setor / Categoria
                      </label>
                      <LocalBufferedInput
                        id="cat-name"
                        name="categoryName"
                        type="text"
                        delay={150}
                        value={newCategoryName}
                        onFlush={setNewCategoryName}
                        className="w-full rounded-2xl border border-white/5 bg-zinc-950 px-5 py-4 text-sm font-bold transition-all focus:border-emerald-500/50 focus:outline-none focus:ring-2 focus:ring-emerald-500/20"
                        placeholder="Ex: Vestuário"
                      />
                    </div>
                  </div>

                  <div className="relative z-10 flex gap-4 pt-8">
                    <button
                      type="button"
                      onClick={() => {
                        setShowCategoryForm(false);
                        setNewCategoryName("");
                        setFormData((prev) => ({
                          ...prev,
                          category: formData.category || "",
                        }));
                      }}
                      className="flex-1 py-5 text-xs font-black uppercase tracking-widest text-zinc-500 transition-colors hover:text-white"
                    >
                      Cancelar
                    </button>
                    <button
                      type="button"
                      onClick={async () => {
                        if (newCategoryName.trim()) {
                          const loadingId = toast.loading(
                            "Criando categoria...",
                          );
                          try {
                            await addCategory(
                              {
                                name: newCategoryName.trim(),
                                description: "",
                                isActive: true,
                              },
                              true,
                            );
                            setFormData((prev) => ({
                              ...prev,
                              category: newCategoryName.trim(),
                            }));
                            toast.success("Categoria criada com sucesso!", {
                              id: loadingId,
                            });
                            setShowCategoryForm(false);
                            setNewCategoryName("");
                          } catch {
                            toast.error("Erro ao salvar categoria", {
                              id: loadingId,
                            });
                          }
                        }
                      }}
                      className="flex-[2] rounded-2xl bg-emerald-500 py-5 text-xs font-black uppercase tracking-widest text-emerald-950 shadow-[0_10px_30px_rgba(16,185,129,0.3)] transition-all hover:scale-105 active:scale-95"
                    >
                      Criar Setor
                    </button>
                  </div>
                </motion.div>
              </motion.div>
            )}
          </AnimatePresence>,
          document.body,
        )}

      {typeof document !== "undefined" &&
        createPortal(
          <AnimatePresence>
            {showVariantForm && (
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                className="fixed inset-0 z-[100] flex items-center justify-center bg-black/80 p-4 backdrop-blur-sm"
              >
                <motion.div
                  initial={{ scale: 0.9, y: 20 }}
                  animate={{ scale: 1, y: 0 }}
                  className="gpu-accelerated flex max-h-[90vh] w-full max-w-md flex-col overflow-hidden rounded-[2.5rem] border border-white/10 bg-zinc-900 shadow-2xl"
                >
                  <div className="relative z-10 flex shrink-0 items-center gap-4 border-b border-white/5 bg-zinc-900 p-8 pb-5">
                    <div className="flex size-12 items-center justify-center rounded-2xl border border-emerald-500/20 bg-emerald-500/10">
                      <Layers className="size-6 text-emerald-500" />
                    </div>
                    <div>
                      <h3 className="text-xl font-black tracking-tight">
                        {editingVariant ? "Editar Variante" : "Nova Variante"}
                      </h3>
                      <p className="mt-1 text-[10px] font-bold uppercase leading-none tracking-widest text-zinc-500">
                        Grade de Produto
                      </p>
                    </div>
                  </div>

                  <div className="scrollbar-hide flex-1 space-y-6 overflow-y-auto p-8 py-6">
                    {/* Atributo */}
                    <div className="space-y-2">
                      <label
                        htmlFor="variant-name"
                        className="ml-1 text-[10px] font-black uppercase tracking-widest text-zinc-500"
                      >
                        Atributo (ex: Cor, Tamanho)
                      </label>
                      <LocalBufferedInput
                        id="variant-name"
                        name="variant-name"
                        type="text"
                        value={variantFormData.name}
                        onFlush={(val) =>
                          setVariantFormData((p) => ({ ...p, name: val }))
                        }
                        className="w-full rounded-2xl border border-white/5 bg-zinc-950 px-5 py-4 text-sm font-bold transition-all focus:border-emerald-500/50 focus:outline-none focus:ring-2 focus:ring-emerald-500/20"
                        placeholder="Ex: Cor"
                      />
                      {suggestedAttributes.length > 0 && (
                        <div className="ml-1 mt-1.5 flex flex-wrap gap-1.5">
                          {suggestedAttributes.map((attr) => (
                            <button
                              key={attr}
                              type="button"
                              onClick={() =>
                                setVariantFormData((p) => ({
                                  ...p,
                                  name: attr,
                                }))
                              }
                              className={cn(
                                "px-2.5 py-1 rounded-full text-[9px] font-black uppercase tracking-widest border transition-all active:scale-95",
                                variantFormData.name === attr
                                  ? "bg-emerald-500/20 border-emerald-500/40 text-emerald-400"
                                  : "bg-zinc-950 border-white/5 text-zinc-500 hover:text-zinc-300 hover:border-white/10",
                              )}
                            >
                              {attr}
                            </button>
                          ))}
                        </div>
                      )}
                    </div>

                    {/* Valor do Atributo */}
                    <div className="space-y-2">
                      <label
                        htmlFor="variant-value"
                        className="ml-1 text-[10px] font-black uppercase tracking-widest text-zinc-500"
                      >
                        Valor do Atributo
                      </label>
                      <LocalBufferedInput
                        id="variant-value"
                        name="variant-value"
                        type="text"
                        value={variantFormData.value}
                        onFlush={(val) =>
                          setVariantFormData((p) => ({ ...p, value: val }))
                        }
                        className="w-full rounded-2xl border border-white/5 bg-zinc-950 px-5 py-4 text-sm font-bold transition-all focus:border-emerald-500/50 focus:outline-none focus:ring-2 focus:ring-emerald-500/20"
                        placeholder="Ex: Espacial Grey"
                      />
                    </div>

                    {/* SKU & Status */}
                    <div className="grid grid-cols-2 gap-4">
                      <div className="space-y-2">
                        <label
                          htmlFor="variant-sku"
                          className="ml-1 text-[10px] font-black uppercase tracking-widest text-zinc-500"
                        >
                          Código SKU
                        </label>
                        <LocalBufferedInput
                          id="variant-sku"
                          name="variant-sku"
                          type="text"
                          value={variantFormData.sku}
                          onFlush={(val) =>
                            setVariantFormData((p) => ({
                              ...p,
                              sku: val
                                .trim()
                                .toUpperCase()
                                .replace(/\s+/g, "-"),
                            }))
                          }
                          className="w-full rounded-2xl border border-white/5 bg-zinc-950 px-5 py-4 font-mono text-sm font-bold uppercase transition-all focus:border-emerald-500/50 focus:outline-none focus:ring-2 focus:ring-emerald-500/20"
                          placeholder="Ex: SKU-COR-TAM"
                        />
                      </div>
                      <div className="space-y-2">
                        <label
                          htmlFor="variant-status"
                          className="ml-1 text-[10px] font-black uppercase tracking-widest text-zinc-500"
                        >
                          Status no Catálogo
                        </label>
                        <button
                          id="variant-status"
                          type="button"
                          onClick={() =>
                            setVariantFormData((p) => ({
                              ...p,
                              active: !p.active,
                            }))
                          }
                          className={cn(
                            "w-full px-5 py-4 border rounded-2xl text-xs font-black uppercase tracking-widest transition-all flex items-center justify-between active:scale-95 select-none",
                            variantFormData.active
                              ? "bg-emerald-500/10 border-emerald-500/20 text-emerald-500 hover:bg-emerald-500/20"
                              : "bg-zinc-950 border-white/5 text-zinc-500 hover:bg-white/5",
                          )}
                        >
                          <span>
                            {variantFormData.active ? "Ativo" : "Offline"}
                          </span>
                          <span
                            className={cn(
                              "w-2.5 h-2.5 rounded-full shadow-[0_0_8px_currentColor] transition-all",
                              variantFormData.active
                                ? "bg-emerald-500 text-emerald-500/50 scale-100"
                                : "bg-zinc-700 text-zinc-700/50 scale-90",
                            )}
                          />
                        </button>
                      </div>
                    </div>

                    {/* Quantidade em Estoque & Sobrescrever Preço */}
                    <div className="grid grid-cols-2 gap-4">
                      <div className="space-y-2">
                        <label
                          htmlFor="variant-stock"
                          className="ml-1 text-[10px] font-black uppercase tracking-widest text-zinc-500"
                        >
                          Quantidade em Estoque
                        </label>
                        <LocalBufferedInput
                          id="variant-stock"
                          name="variant-stock"
                          type="number"
                          value={variantFormData.stockIncrement}
                          onFlush={(val) =>
                            setVariantFormData((p) => ({
                              ...p,
                              stockIncrement: val,
                            }))
                          }
                          className="w-full rounded-2xl border border-white/5 bg-zinc-950 px-5 py-4 text-sm font-black transition-all focus:border-emerald-500/50 focus:outline-none focus:ring-2 focus:ring-emerald-500/20"
                        />
                        <span className="ml-1 mt-1 block text-[10px] leading-tight text-zinc-500">
                          Estoque físico real para esta variação específica.
                        </span>
                      </div>
                      <div className="space-y-2">
                        <label
                          htmlFor="variant-price"
                          className="ml-1 text-[10px] font-black uppercase tracking-widest text-zinc-500"
                        >
                          Sobrescrever R$
                        </label>
                        <div className="relative flex items-center">
                          <span className="absolute left-5 text-xs font-black text-zinc-600">
                            R$
                          </span>
                          <LocalBufferedInput
                            id="variant-price"
                            name="variant-price"
                            mask="currency"
                            value={variantFormData.priceOverride}
                            onFlush={(val) =>
                              setVariantFormData((p) => ({
                                ...p,
                                priceOverride: val,
                              }))
                            }
                            className="w-full rounded-2xl border border-white/5 bg-zinc-950 py-4 pl-11 pr-5 text-sm font-black transition-all focus:border-emerald-500/50 focus:outline-none focus:ring-2 focus:ring-emerald-500/20"
                            placeholder="Auto"
                          />
                        </div>
                        <span className="ml-1 mt-1 block text-[10px] leading-tight text-zinc-500">
                          Deixe em branco para usar o preço padrão.
                        </span>
                      </div>
                    </div>

                    {/* Imagem da Variante — APONTA uma das imagens do produto
                        (pedido do Gabriel, 02/09: o upload era ineficiente;
                        a imagem já foi enviada quando o produto a recebeu, a
                        variante só referencia a URL). */}
                    <div className="space-y-2">
                      <span className="ml-1 block text-[10px] font-black uppercase tracking-widest text-zinc-500">
                        Imagem da Variante (Opcional)
                      </span>
                      {formData.images.length === 0 &&
                      !variantFormData.imageUrl ? (
                        <p className="rounded-2xl border border-white/5 bg-zinc-950/60 px-4 py-3 text-[10px] font-bold leading-relaxed text-zinc-500">
                          Adicione imagens ao produto primeiro — a variante
                          aponta para uma delas em vez de enviar arquivo novo.
                        </p>
                      ) : (
                        <div className="custom-scrollbar-hidden flex w-full snap-x gap-3 overflow-x-auto py-1">
                          {/* Imagem gravada na variante que não pertence mais
                              ao produto (foi removida depois): segue visível
                              para poder ser mantida ou trocada. */}
                          {variantFormData.imageUrl &&
                            !formData.images.includes(
                              variantFormData.imageUrl,
                            ) && (
                              <button
                                type="button"
                                aria-pressed="true"
                                title="Imagem atual da variante — toque para remover"
                                onClick={() =>
                                  setVariantFormData((p) => ({
                                    ...p,
                                    imageUrl: "",
                                  }))
                                }
                                className="relative size-16 shrink-0 snap-start overflow-hidden rounded-2xl border-2 border-emerald-500 ring-2 ring-emerald-500/40 transition-all"
                              >
                                <img
                                  src={variantFormData.imageUrl}
                                  alt=""
                                  className="size-full object-cover"
                                />
                                <span className="absolute inset-x-0 bottom-0 bg-emerald-500/90 py-0.5 text-center text-[8px] font-black uppercase tracking-widest text-black">
                                  Atual
                                </span>
                              </button>
                            )}
                          {formData.images.map((url) => {
                            const selecionada =
                              variantFormData.imageUrl === url;
                            return (
                              <button
                                key={url}
                                type="button"
                                aria-pressed={selecionada}
                                title={
                                  selecionada
                                    ? "Selecionada — toque para remover"
                                    : "Usar esta imagem na variante"
                                }
                                onClick={() =>
                                  setVariantFormData((p) => ({
                                    ...p,
                                    imageUrl: selecionada ? "" : url,
                                  }))
                                }
                                className={cn(
                                  "relative size-16 shrink-0 snap-start overflow-hidden rounded-2xl border transition-all",
                                  selecionada
                                    ? "border-2 border-emerald-500 ring-2 ring-emerald-500/40"
                                    : "border-white/10 hover:border-emerald-500/50",
                                )}
                              >
                                <img
                                  src={url}
                                  alt=""
                                  className="size-full object-cover"
                                />
                                {selecionada && (
                                  <span className="absolute inset-x-0 bottom-0 bg-emerald-500/90 py-0.5 text-center text-[8px] font-black uppercase tracking-widest text-black">
                                    Selecionada
                                  </span>
                                )}
                              </button>
                            );
                          })}
                        </div>
                      )}
                      <span className="ml-1 block text-[10px] leading-tight text-zinc-500">
                        Aponta para uma das imagens do produto — nada é enviado
                        de novo. Facilita a visualização do produto na tela de
                        checkout e na seleção de atributos.
                      </span>
                    </div>
                  </div>

                  <div className="relative z-10 flex shrink-0 gap-4 border-t border-white/5 bg-zinc-950/40 p-8 pt-5">
                    <button
                      type="button"
                      onClick={() => {
                        setShowVariantForm(false);
                        setEditingVariant(null);
                      }}
                      className="flex-1 py-4 text-xs font-black uppercase tracking-widest text-zinc-500 transition-colors hover:text-white"
                    >
                      Cancelar
                    </button>
                    <button
                      type="button"
                      onClick={async (e) => {
                        e.preventDefault();
                        await handleVariantSubmit();
                      }}
                      className="flex-[2] rounded-2xl bg-emerald-500 py-4 text-xs font-black uppercase tracking-widest text-emerald-950 shadow-[0_10px_30px_rgba(16,185,129,0.3)] transition-all hover:scale-105 active:scale-95"
                    >
                      {editingVariant
                        ? "Salvar Protocolo"
                        : "Efetivar Variante"}
                    </button>
                  </div>
                </motion.div>
              </motion.div>
            )}
          </AnimatePresence>,
          document.body,
        )}

      <header className="sticky top-0 z-30 border-b border-white/5 bg-zinc-950/80 px-4 py-3 backdrop-blur-md md:px-6 md:py-4">
        <div className="mx-auto flex max-w-5xl items-center justify-between">
          <div className="flex items-center gap-3 md:gap-4">
            <div>
              <div className="flex items-center gap-2">
                <h1 className="flex items-center gap-2 whitespace-nowrap text-sm font-black uppercase italic tracking-tight text-white md:text-base">
                  <span>{productId ? "Editar " : "Novo "}</span>
                  <span className="text-emerald-500">Produto</span>
                </h1>
                <button
                  type="button"
                  onClick={() => setShowHelpModal(true)}
                  className="flex size-7 shrink-0 items-center justify-center rounded-full border border-white/5 bg-zinc-900/60 text-zinc-500 transition-all duration-300 hover:border-white/10 hover:text-white active:scale-95"
                  title="Guia de Cadastro e Ajuda"
                >
                  <HelpCircle className="size-3.5" />
                </button>
              </div>
              <p className="mt-0.5 hidden items-center gap-1.5 text-[9px] font-bold uppercase tracking-[0.2em] text-zinc-500 sm:flex md:text-[10px]">
                <ShieldCheck className="size-3 shrink-0 text-emerald-500" />
                Ambiente de Gerenciamento Unificado
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2 md:gap-3">
            <div className="hidden flex-col items-end md:flex">
              <span className="text-[10px] font-black uppercase tracking-widest text-zinc-500">
                ID do Sistema
              </span>
              <span className="font-mono text-xs font-bold text-zinc-300">
                {productId || "NEW_ENTRY"}
              </span>
            </div>

            {isOffline && (
              <span className="mr-1 animate-pulse rounded-lg border border-rose-500/20 bg-rose-500/10 px-2.5 py-1.5 text-[9px] font-black uppercase tracking-wider text-rose-500">
                Sem Conexão
              </span>
            )}

            <button
              type="button"
              onClick={() => handleSubmit()}
              disabled={
                // #98 (ADMIN-060): showSuccess entra aqui — entre o sucesso
                // e a navegação (1,5s) o botão mostra "Salvo" mas
                // isSubmitting já é false; sem showSuccess o botão reabria
                // para um segundo clique nessa janela.
                !isValid ||
                isSubmitting ||
                showSuccess ||
                isOffline ||
                isImageUploading
              }
              className={cn(
                "px-3 py-2 md:px-4 md:py-2.5 rounded-xl flex items-center justify-center gap-1.5 md:gap-2 transition-all active:scale-[0.98] font-black uppercase tracking-wider text-[9px] md:text-[10px] border shrink-0",
                isOffline
                  ? "bg-zinc-900 border-rose-500/20 text-rose-400 cursor-not-allowed"
                  : "bg-gradient-to-r from-emerald-600 to-emerald-500 hover:from-emerald-500 hover:to-emerald-400 text-emerald-950 border-white/10 shadow-lg shadow-emerald-500/20 disabled:from-zinc-800/80 disabled:to-zinc-800/80 disabled:text-zinc-500 disabled:border-white/5 disabled:shadow-none disabled:pointer-events-none",
              )}
            >
              {isSubmitting ? (
                <div className="size-3.5 animate-spin rounded-full border-2 border-emerald-950/30 border-t-emerald-950" />
              ) : showSuccess ? (
                <>
                  <Check className="size-3.5" />
                  Salvo
                </>
              ) : isOffline ? (
                <>
                  <AlertTriangle className="size-3.5" />
                  Offline
                </>
              ) : (
                <>
                  {productId ? (
                    <Edit2 className="size-3.5" />
                  ) : (
                    <Plus className="size-3.5" />
                  )}
                  {productId ? "Salvar" : "Publicar"}
                </>
              )}
            </button>
          </div>
        </div>
      </header>

      <motion.form
        variants={containerVariants}
        initial="hidden"
        animate="visible"
        onSubmit={handleSubmit}
        className="gpu-accelerated mx-auto max-w-5xl space-y-4 p-4 md:space-y-8 md:p-6"
      >
        {isOffline && (
          <div className="flex select-none items-center gap-3 rounded-2xl border border-red-500/20 bg-red-500/10 p-4 text-xs font-bold uppercase tracking-wider text-red-400 duration-300 animate-in fade-in slide-in-from-top-2">
            <AlertTriangle className="size-5 shrink-0 animate-pulse text-red-500" />
            <span>
              Você está offline. O salvamento e alteração de produtos estão
              temporariamente suspensos.
            </span>
          </div>
        )}
        {/* Visual Media Section */}
        <section className="group relative">
          <div className="pointer-events-none absolute right-0 top-0 p-8 opacity-5 transition-opacity group-hover:opacity-10">
            <ImageIcon className="size-24 text-white" />
          </div>

          <div className="mb-3 flex items-center justify-between md:mb-6">
            <div className="flex items-center gap-3">
              <div className="flex size-10 items-center justify-center rounded-xl border border-emerald-500/20 bg-emerald-500/10">
                <Camera className="size-5 text-emerald-500" />
              </div>
              <h3 className="text-xs font-black uppercase tracking-[0.2em] text-zinc-400">
                Fotos do Produto
              </h3>
              <button
                type="button"
                onClick={() => setShowPhotoGuide((prev) => !prev)}
                className={cn(
                  "w-8 h-8 rounded-full flex items-center justify-center text-xs font-black border transition-all shrink-0 active:scale-95 select-none touch-manipulation",
                  showPhotoGuide
                    ? "bg-emerald-500 border-emerald-400 text-emerald-950 shadow-md shadow-emerald-500/10 scale-110"
                    : "bg-zinc-950/50 border-white/10 text-zinc-400",
                )}
                title="Ajuda / Guia de Fotos"
              >
                ?
              </button>
            </div>

            {/* "+" Button - Only visible when images exist */}
            {formData.images.length > 0 && (
              <label
                htmlFor="product-image-upload"
                className={cn(
                  "flex size-10 items-center justify-center rounded-xl border border-emerald-500/20 bg-emerald-500/10 text-emerald-500 cursor-pointer transition-all duration-300 hover:bg-emerald-500 hover:text-emerald-950 hover:scale-105 active:scale-95 shadow-md shadow-emerald-500/10",
                  (isSubmitting || isImageUploading) &&
                    "opacity-40 pointer-events-none",
                )}
                title="Adicionar Mais Imagens"
              >
                <Plus className="size-5" />
                <input
                  id="product-image-upload"
                  name="product-images"
                  type="file"
                  accept="image/*"
                  multiple
                  onChange={handleImageUpload}
                  className="hidden"
                  disabled={isSubmitting || isImageUploading}
                />
              </label>
            )}
          </div>

          <div className="w-full">
            {formData.images.length === 0 ? (
              // Falso positivo: o label TEM texto visível ("Adicionar Fotos do
              // Produto" e a instrução de arrastar), e o input com o id casado
              // está dentro dele. A regra só olha `depth: 2` por padrão e o
              // texto está em label > div > div > p. Pôr `aria-label` aqui
              // resolveria o lint e pioraria a acessibilidade: substituiria
              // esse texto rico pelo rótulo curto no nome acessível.
              // eslint-disable-next-line jsx-a11y/label-has-associated-control
              <label
                htmlFor="product-image-upload"
                onDragOver={(e) => {
                  e.preventDefault();
                  setIsDragging(true);
                }}
                onDragLeave={() => setIsDragging(false)}
                onDrop={async (e) => {
                  e.preventDefault();
                  setIsDragging(false);
                  if (isOffline) {
                    toast.error("Não é possível enviar imagens offline.");
                    return;
                  }
                  if (isImageUploading) return;
                  const files = Array.from(e.dataTransfer.files || []);
                  await processAndUploadImages(files);
                }}
                className={cn(
                  "w-full h-48 sm:h-64 rounded-3xl border-2 border-dashed flex flex-col items-center justify-center cursor-pointer transition-all duration-300 group/upload relative overflow-hidden select-none",
                  isDragging
                    ? "border-emerald-500 bg-emerald-500/10 scale-[1.01] shadow-[0_0_30px_rgba(16,185,129,0.15)]"
                    : "border-white/10 bg-zinc-900/30 hover:bg-emerald-500/5 hover:border-emerald-500/30",
                  (isSubmitting || isImageUploading) &&
                    "opacity-40 pointer-events-none",
                )}
              >
                <div className="absolute inset-0 bg-gradient-to-br from-emerald-500/0 via-transparent to-emerald-500/5" />
                <div className="relative z-10 flex flex-col items-center text-center p-6 space-y-3">
                  <div className="flex size-14 items-center justify-center rounded-2xl border border-white/5 bg-zinc-950/80 text-zinc-400 group-hover/upload:border-emerald-500/30 group-hover/upload:text-emerald-500 group-hover/upload:scale-110 transition-all duration-300 shadow-xl">
                    <Camera className="size-6" />
                  </div>
                  <div className="space-y-1">
                    <p className="text-xs font-black uppercase tracking-widest text-zinc-300 group-hover/upload:text-emerald-400 transition-colors">
                      {isDragging
                        ? "Solte para enviar!"
                        : "Adicionar Fotos do Produto"}
                    </p>
                    <p className="text-[10px] font-bold text-zinc-500 uppercase tracking-wider">
                      Arraste as imagens aqui ou clique para buscar
                    </p>
                  </div>
                  <div className="flex items-center gap-3 pt-2 text-[8px] font-black uppercase tracking-widest text-zinc-650">
                    <span>Proporção ideal: 4:5</span>
                    <span className="size-1 rounded-full bg-zinc-700" />
                    <span>Máx: 10 fotos</span>
                    <span className="size-1 rounded-full bg-zinc-700" />
                    <span>Até 12MB cada</span>
                  </div>
                </div>
                <input
                  id="product-image-upload"
                  name="product-images"
                  type="file"
                  accept="image/*"
                  multiple
                  onChange={handleImageUpload}
                  className="hidden"
                  disabled={isSubmitting || isImageUploading}
                />
              </label>
            ) : (
              <div className="relative w-full">
                {/* Single horizontal scroll carousel for ALL images */}
                <div className="flex flex-row gap-4 overflow-x-auto px-2 pb-4 pt-2 snap-x scroll-smooth scrollbar-thin scrollbar-thumb-zinc-800 scrollbar-track-transparent">
                  <AnimatePresence>
                    {formData.images.map((image, index) => {
                      const meta = imageMetadata[image];
                      const isCover = index === 0;
                      return (
                        <motion.div
                          key={image}
                          initial={{ scale: 0.8, opacity: 0 }}
                          animate={{ scale: 1, opacity: 1 }}
                          exit={{ scale: 0.8, opacity: 0 }}
                          className={cn(
                            "group/img relative aspect-[4/5] w-40 sm:w-48 shrink-0 snap-start rounded-2xl",
                            isCover &&
                              "ring-2 ring-emerald-500 ring-offset-2 ring-offset-zinc-950",
                          )}
                        >
                          <div className="absolute inset-0 z-0 overflow-hidden rounded-2xl border border-white/5 bg-zinc-900 shadow-md transition-all duration-300 group-hover/img:border-emerald-500/30">
                            <img
                              src={image}
                              alt=""
                              className="size-full object-cover transition-transform duration-700 group-hover/img:scale-105"
                            />

                            {/* Actions Overlay */}
                            <div className="absolute inset-0 flex items-center justify-center bg-gradient-to-t from-black/90 via-black/35 to-transparent opacity-100 transition-opacity hover-hover:opacity-0 hover-hover:group-hover/img:opacity-100 duration-300">
                              <div className="flex items-center gap-1.5">
                                <button
                                  type="button"
                                  onClick={() => openAdjuster(image, index)}
                                  className="flex size-9 items-center justify-center rounded-lg bg-emerald-500 text-emerald-950 shadow-lg transition-all hover:scale-110 hover:bg-emerald-400 active:scale-95"
                                  title="Ajustar e Cortar"
                                >
                                  <Scissors className="size-4" />
                                </button>
                                <button
                                  type="button"
                                  onClick={() => removeImage(index)}
                                  className="flex size-9 items-center justify-center rounded-lg bg-red-500 text-white shadow-lg transition-all hover:scale-110 hover:bg-red-400 active:scale-95"
                                  title="Excluir"
                                >
                                  <Trash2 className="size-4" />
                                </button>
                              </div>
                            </div>
                          </div>

                          {/* Status Warning Badge */}
                          {meta && meta.status !== "loading" && (
                            <div className="absolute right-2.5 top-2.5 z-20">
                              <div
                                className={`group/tooltip relative transition-opacity duration-300 ${
                                  meta.status === "warning_aspect" ||
                                  meta.status === "warning_res"
                                    ? "opacity-100"
                                    : "opacity-0 group-hover/img:opacity-100"
                                }`}
                              >
                                <span
                                  className={`flex size-4.5 cursor-help items-center justify-center rounded-full border border-white/10 text-[8px] font-black shadow-lg ${
                                    meta.status === "excellent"
                                      ? "bg-emerald-500 text-emerald-950"
                                      : meta.status === "warning_aspect"
                                        ? "bg-amber-500 text-zinc-950"
                                        : meta.status === "warning_res"
                                          ? "bg-red-500 text-white"
                                          : "bg-blue-500 text-white"
                                  }`}
                                >
                                  {meta.status === "excellent"
                                    ? "✓"
                                    : meta.status === "warning_aspect"
                                      ? "!"
                                      : meta.status === "warning_res"
                                        ? "⚠"
                                        : "i"}
                                </span>
                                <div className="pointer-events-none absolute bottom-6 right-0 z-30 w-36 rounded-xl border border-white/10 bg-zinc-950 p-2.5 text-[8px] font-black uppercase leading-normal tracking-wider text-white opacity-0 shadow-2xl transition-opacity group-hover/tooltip:opacity-100">
                                  <span className="mb-0.5 block text-emerald-400">
                                    Dim: {meta.width}x{meta.height}
                                  </span>
                                  {meta.status === "excellent" && "Excelente!"}
                                  {meta.status === "warning_aspect" &&
                                    "Ajuste para 4:5."}
                                  {meta.status === "warning_res" &&
                                    "Resolução baixa."}
                                  {meta.status === "good" && "Boa qualidade."}
                                </div>
                              </div>
                            </div>
                          )}

                          {/* Cover / Index Badge */}
                          <div
                            className={cn(
                              "absolute bottom-2.5 left-2.5 z-10 rounded-md border px-1.5 py-0.5 text-[7px] font-black uppercase tracking-widest backdrop-blur-md",
                              isCover
                                ? "border-emerald-400/50 bg-emerald-500/90 text-emerald-950 shadow-md"
                                : "border-white/10 bg-black/55 text-white/60",
                            )}
                          >
                            {isCover ? "Principal" : `#${index + 1}`}
                          </div>
                        </motion.div>
                      );
                    })}

                    {isUploadingImages && (
                      <motion.div
                        key="uploading-shimmer"
                        initial={{ scale: 0.8, opacity: 0 }}
                        animate={{ scale: 1, opacity: 1 }}
                        exit={{ scale: 0.8, opacity: 0 }}
                        className="relative flex aspect-[4/5] w-40 sm:w-48 shrink-0 snap-start animate-pulse flex-col items-center justify-center space-y-2 overflow-hidden rounded-2xl border border-white/10 bg-white/5"
                      >
                        <Loader2 className="size-5 animate-spin text-emerald-400" />
                        <span className="text-[8px] font-black uppercase tracking-wider text-zinc-500">
                          {imageUploadStep === "compressing"
                            ? "Comprimindo..."
                            : "Enviando..."}
                        </span>
                      </motion.div>
                    )}
                  </AnimatePresence>
                </div>

                {formData.images.length > 1 && (
                  <span className="ml-1 mt-1 block text-[9px] font-bold text-zinc-500 uppercase tracking-wider flex items-center gap-1.5 animate-pulse select-none">
                    ↔ Deslize para o lado para ver mais fotos
                  </span>
                )}
              </div>
            )}
          </div>
        </section>

        {/* Guide Section */}
        <AnimatePresence>
          {showPhotoGuide && (
            <motion.section
              initial={{ opacity: 0, y: -10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              transition={{ duration: 0.2 }}
              className="space-y-4 border-t border-white/5 pt-6"
            >
              <h3 className="flex items-center gap-2 text-[10px] font-black uppercase tracking-[0.2em] text-zinc-500">
                <BookOpen className="size-4 text-emerald-400" />
                Guia de Fotos do Produto
              </h3>
              <div className="space-y-4 rounded-2xl border border-white/5 bg-zinc-950/40 p-5">
                <p className="text-[10px] font-medium leading-relaxed text-zinc-400">
                  Imagens de alta qualidade aumentam a conversão de vendas. Siga
                  as orientações recomendadas:
                </p>
                <ul className="list-disc space-y-2 pl-4 text-[10px] font-medium text-zinc-500">
                  <li>
                    <b className="text-zinc-350">Proporção 4:5 (Card):</b>{" "}
                    Essencial para que os produtos caibam no card da vitrine sem
                    cortes laterais automáticos. Use o enquadramento "Vitrine".
                  </li>
                  <li>
                    <b className="text-zinc-350">Proporção 1:1 (Detalhe):</b>{" "}
                    Ideal para a galeria interna do produto. Mantém a
                    consistência visual em carrosséis.
                  </li>
                  <li>
                    <b className="text-zinc-350">Resolução Recomendada:</b>{" "}
                    Imagens com pelo menos 800px a 1200px de altura garantem
                    nitidez no zoom.
                  </li>
                  <li>
                    <b className="text-zinc-350">Fundo e Contraste:</b> Fundos
                    neutros (branco/cinza) e produtos bem iluminados destacam os
                    detalhes e transmitem profissionalismo.
                  </li>
                </ul>
                <div className="flex items-center justify-between border-t border-white/5 pt-3 text-[9px] font-black uppercase tracking-widest text-emerald-400">
                  <span>Proporção ideal: 4:5 ou 1:1</span>
                  <span>Res: &gt; 800px</span>
                </div>
              </div>
            </motion.section>
          )}
        </AnimatePresence>

        {/* Product Variants Section */}
        <section className="relative space-y-4 border-t border-white/5 pt-6 md:pt-8">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="flex size-10 items-center justify-center rounded-xl border border-emerald-500/20 bg-emerald-500/10">
                <Layers className="size-5 text-emerald-500" />
              </div>
              <h3 className="text-xs font-black uppercase tracking-[0.2em] text-zinc-400">
                Variações do Produto
              </h3>
              <button
                type="button"
                onClick={() => toggleHelp("productVariants")}
                className={cn(
                  "w-8 h-8 rounded-full flex items-center justify-center text-xs font-black border transition-all shrink-0 active:scale-95 select-none touch-manipulation",
                  expandedHelp.productVariants
                    ? "bg-emerald-500 border-emerald-400 text-emerald-950 shadow-md shadow-emerald-500/10 scale-110"
                    : "bg-zinc-950/50 border-white/10 text-zinc-400",
                )}
                title="Ajuda / Guia de Variações"
              >
                ?
              </button>
            </div>
            <button
              type="button"
              onClick={() => {
                setEditingVariant(null);
                setVariantFormData({
                  name: "",
                  value: "",
                  sku: "",
                  stockIncrement: "0",
                  priceOverride: "",
                  active: true,
                  imageUrl: "",
                });
                setShowVariantForm(true);
              }}
              className="rounded-lg border border-emerald-500/20 bg-emerald-500/10 px-3 py-1.5 text-[10px] font-black uppercase tracking-widest text-emerald-500 transition-all hover:bg-emerald-500 hover:text-emerald-950 active:scale-95"
            >
              + Novo
            </button>
          </div>

          {/* O produto ja esta no estado que mente: dois grupos de variacao.
              A trava impede chegar aqui, mas produto antigo pode ja estar --
              e nesse caso o numero de estoque na tela acima esta errado. Dizer
              isso e' melhor que somar em silencio. */}
          {produtoTemGrupoDemais && (
            <div className="space-y-2 rounded-2xl border border-amber-500/30 bg-amber-500/10 p-4">
              <p className="text-[11px] font-black uppercase tracking-widest text-amber-400">
                Este produto tem tipos de variação demais
              </p>
              <p className="text-[10px] font-medium leading-relaxed text-amber-200/80">
                Cada produto aceita <b>um tipo só</b> de variação. Com mais de
                um, o estoque mostrado acima soma as opções em dobro e o pedido
                do cliente guarda só metade da escolha — quem pedir um P e um M
                recebe dois P.
              </p>
              <p className="text-[10px] font-medium leading-relaxed text-amber-200/80">
                Para consertar, edite as variações abaixo e junte tudo num tipo
                só, com as opções combinadas (ex: <i>Rosa P</i>, <i>Rosa M</i>).
              </p>
            </div>
          )}

          {/* Variants Guide Section */}
          <AnimatePresence>
            {expandedHelp.productVariants && (
              <motion.div
                initial={{ opacity: 0, y: -10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -10 }}
                transition={{ duration: 0.2 }}
                className="w-full space-y-3 border-b border-white/5 pb-4"
              >
                <h3 className="flex items-center gap-2 text-[10px] font-black uppercase tracking-[0.2em] text-zinc-500">
                  <BookOpen className="size-4 text-emerald-400" />
                  Como usar as Variações
                </h3>
                <div className="space-y-3 rounded-2xl border border-white/5 bg-zinc-950/40 p-4">
                  <p className="text-[10px] font-medium leading-relaxed text-zinc-400">
                    Variações permitem vender o mesmo produto com diferentes
                    opções — cor, tamanho, voltagem. Cada produto aceita{" "}
                    <b className="text-zinc-350">um tipo só</b>: para vender cor
                    e tamanho juntos, combine os dois no valor da opção (ex:
                    Nome: <i>Modelo</i>, Valores: <i>Rosa P</i>, <i>Rosa M</i>).
                  </p>
                  <ul className="list-none space-y-2 pl-0 text-[10px] font-medium text-zinc-500">
                    <li className="flex items-start gap-2.5">
                      <div className="mt-1.5 size-1.5 shrink-0 rounded-full bg-emerald-500" />
                      <span>
                        <b className="text-zinc-350">
                          Atributo (Nome e Valor):
                        </b>{" "}
                        Defina a característica (ex: Nome: <i>Tamanho</i>,
                        Valor: <i>G</i>; ou Nome: <i>Cor</i>, Valor: <i>Azul</i>
                        ).
                      </span>
                    </li>
                    <li className="flex items-start gap-2.5">
                      <div className="mt-1.5 size-1.5 shrink-0 rounded-full bg-emerald-500" />
                      <span>
                        <b className="text-zinc-350">
                          Ajuste de Preço (Opcional):
                        </b>{" "}
                        Se uma variante custar mais caro (ex: tamanho especial
                        ou material premium), preencha o campo de preço
                        substituto. Se deixar em branco, o preço principal do
                        produto será usado.
                      </span>
                    </li>
                    <li className="flex items-start gap-2.5">
                      <div className="mt-1.5 size-1.5 shrink-0 rounded-full bg-emerald-500" />
                      <span>
                        <b className="text-zinc-350">Ajuste de Estoque:</b>{" "}
                        Defina a variação de estoque (ex: se o produto principal
                        tem 10 unidades e a variante G tem mais 5, use o
                        incremento correto de estoque para que o cliente saiba
                        exatamente o que há disponível).
                      </span>
                    </li>
                    <li className="flex items-start gap-2.5">
                      <div className="mt-1.5 size-1.5 shrink-0 rounded-full bg-emerald-500" />
                      <span>
                        <b className="text-zinc-350">Foto da Variante:</b>{" "}
                        Vincule uma foto específica da variação. Quando o
                        comprador selecioná-la na página do produto, o carrossel
                        exibirá automaticamente a foto correspondente.
                      </span>
                    </li>
                  </ul>
                </div>
              </motion.div>
            )}
          </AnimatePresence>

          <div className="space-y-3">
            {formData.variants.length === 0 ? (
              <div className="rounded-3xl border border-dashed border-white/5 bg-zinc-900 p-8 text-center">
                <p className="text-[10px] font-black uppercase tracking-[0.3em] text-zinc-700">
                  Nenhuma Variação Adicionada
                </p>
              </div>
            ) : (
              formData.variants.map((v) => (
                <VariantItem
                  key={v.id}
                  variant={v}
                  onEdit={handleEditVariant}
                  onDelete={handleDeleteVariant}
                />
              ))
            )}
          </div>
        </section>

        {/* Content Section */}
        <section className="space-y-4 border-t border-white/5 pt-6 md:space-y-8 md:pt-12">
          <div className="flex items-center gap-3">
            <div className="flex size-10 items-center justify-center rounded-xl border border-blue-500/20 bg-blue-500/10">
              <Info className="size-5 text-blue-500" />
            </div>
            <h3 className="text-xs font-black uppercase tracking-[0.2em] text-zinc-400">
              Dados do Produto
            </h3>
            <button
              type="button"
              onClick={() => toggleHelp("productData")}
              className={cn(
                "w-8 h-8 rounded-full flex items-center justify-center text-xs font-black border transition-all shrink-0 active:scale-95 select-none touch-manipulation",
                expandedHelp.productData
                  ? "bg-blue-500 border-blue-400 text-blue-950 shadow-md shadow-blue-500/10 scale-110"
                  : "bg-zinc-950/50 border-white/10 text-zinc-400",
              )}
              title="Ajuda / Guia de Dados do Produto"
            >
              ?
            </button>
          </div>

          {/* Data Guide Section */}
          <AnimatePresence>
            {expandedHelp.productData && (
              <motion.div
                initial={{ opacity: 0, y: -10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -10 }}
                transition={{ duration: 0.2 }}
                className="space-y-4 border-b border-white/5 pb-6 pt-2"
              >
                <h3 className="flex items-center gap-2 text-[10px] font-black uppercase tracking-[0.2em] text-zinc-500">
                  <BookOpen className="size-4 text-blue-400" />
                  Guia de Cadastro e Informações
                </h3>
                <div className="space-y-4 rounded-2xl border border-white/5 bg-zinc-950/40 p-5">
                  <p className="text-[10px] font-medium leading-relaxed text-zinc-400">
                    O preenchimento correto dos dados melhora a indexação do
                    produto e facilita a decisão do cliente.
                  </p>
                  <ul className="list-none space-y-3 pl-0 text-[10px] font-medium text-zinc-500">
                    <li className="flex items-start gap-2.5">
                      <div className="mt-1.5 size-1.5 shrink-0 rounded-full bg-blue-500" />
                      <span>
                        <b className="text-zinc-300">Nome do Produto:</b> Seja
                        claro, indicando o tipo do item, a marca e a
                        característica principal (ex:{" "}
                        <i>Camiseta Algodão Egípcio Slim - Preta</i>). Evite
                        excesso de adjetivos promocionais.
                      </span>
                    </li>
                    <li className="flex items-start gap-2.5">
                      <div className="mt-1.5 size-1.5 shrink-0 rounded-full bg-blue-500" />
                      <span>
                        <b className="text-zinc-350">Descrição Detalhada:</b>{" "}
                        Informe materiais, dimensões, tabelas de medidas,
                        garantia e cuidados de conservação. Uma boa descrição
                        reduz as dúvidas no WhatsApp e diminui devoluções.
                      </span>
                    </li>
                    <li className="flex items-start gap-2.5">
                      <div className="mt-1.5 size-1.5 shrink-0 rounded-full bg-blue-500" />
                      <span>
                        <b className="text-zinc-350">Setor / Categoria:</b>{" "}
                        Classifique adequadamente para que o produto seja
                        filtrado na vitrine da loja e apareça nos setores
                        corretos do catálogo.
                      </span>
                    </li>
                    <li className="flex items-start gap-2.5">
                      <div className="mt-1.5 size-1.5 shrink-0 rounded-full bg-blue-500" />
                      <span>
                        <b className="text-zinc-350">Código SKU:</b> Código
                        identificador único do produto (Stock Keeping Unit).
                        Útil para controle interno, integração de estoque e
                        identificação ágil.
                      </span>
                    </li>
                    <li className="flex items-start gap-2.5">
                      <div className="mt-1.5 size-1.5 shrink-0 rounded-full bg-blue-500" />
                      <span>
                        <b className="text-zinc-350">Estoque Base:</b>{" "}
                        Quantidade física disponível. Se utilizar variações, o
                        estoque de cada variante será somado ou deduzido deste
                        total conforme as vendas.
                      </span>
                    </li>
                  </ul>
                </div>
              </motion.div>
            )}
          </AnimatePresence>

          <div className="grid grid-cols-1 gap-4 md:grid-cols-2 md:gap-6">
            <div className="space-y-1.5 md:col-span-2 md:space-y-3">
              <label
                htmlFor="product-name"
                className="ml-1 text-[10px] font-black uppercase tracking-widest text-zinc-500"
              >
                Nome do Produto *
              </label>
              <LocalBufferedInput
                id="product-name"
                name="product-name"
                type="text"
                value={formData.name}
                onFlush={(val) =>
                  setFormData((prev) => ({ ...prev, name: val }))
                }
                placeholder="Ex: Camiseta Básica Preta - Tamanho M"
                className="w-full rounded-xl border border-white/5 bg-zinc-950/50 px-4 py-3 text-sm font-black text-white transition-all placeholder:text-zinc-800 focus:border-emerald-500 focus:outline-none focus:ring-2 focus:ring-emerald-500/20 sm:rounded-2xl sm:px-6 sm:py-5 sm:text-base"
              />
            </div>

            <div className="space-y-1.5 md:col-span-2 md:space-y-3">
              <label
                htmlFor="product-description"
                className="ml-1 text-[10px] font-black uppercase tracking-widest text-zinc-500"
              >
                Descrição do Produto *
              </label>
              <LocalBufferedTextarea
                id="product-description"
                name="product-description"
                value={formData.description}
                onFlush={(val) =>
                  setFormData((prev) => ({ ...prev, description: val }))
                }
                placeholder="Digite os detalhes e informações do product..."
                rows={6}
                className="w-full resize-none rounded-2xl border border-white/5 bg-zinc-950/50 px-4 py-3.5 text-sm font-medium leading-relaxed text-zinc-300 transition-all placeholder:text-zinc-800 focus:border-emerald-500 focus:outline-none focus:ring-2 focus:ring-emerald-500/20 sm:rounded-3xl sm:px-6 sm:py-5"
              />
            </div>

            <div className="space-y-1.5 md:space-y-3">
              <span className="ml-1 block text-[10px] font-black uppercase tracking-widest text-zinc-500">
                Setor / Categoria *
              </span>
              <div className="group relative">
                <Select
                  name="category"
                  value={formData.category || ""}
                  onValueChange={async (val) => {
                    if (val === "NEW_CATEGORY") {
                      setShowCategoryForm(true);
                    } else {
                      setFormData((prev) => ({ ...prev, category: val }));
                    }
                  }}
                >
                  <SelectTrigger
                    id="product-category"
                    className="h-auto w-full rounded-xl border border-white/5 bg-zinc-950/50 px-4 py-3 text-sm font-black text-white transition-all hover:border-white/10 hover:bg-zinc-900/50 focus:border-emerald-500 focus:outline-none focus:ring-2 focus:ring-emerald-500/20 sm:rounded-2xl sm:px-6 sm:py-5 [&>svg]:opacity-50"
                  >
                    <SelectValue placeholder="Selecionar Setor" />
                  </SelectTrigger>
                  <SelectContent className="rounded-xl border-white/10 bg-zinc-900/95 p-2 shadow-[0_10px_40px_rgba(0,0,0,0.8)] backdrop-blur-xl">
                    {dbCategories.map((category) => (
                      <SelectItem
                        key={category.id}
                        value={category.name}
                        className="cursor-pointer rounded-lg px-4 py-3 font-bold text-zinc-300 focus:bg-white/5 focus:text-emerald-400"
                      >
                        {category.name.toUpperCase()}
                      </SelectItem>
                    ))}
                    <div className="mx-1 my-2 h-px bg-white/10" />
                    <SelectItem
                      value="NEW_CATEGORY"
                      className="cursor-pointer rounded-lg px-4 py-3 font-black text-emerald-500 focus:bg-emerald-500/10 focus:text-emerald-400"
                    >
                      <span className="flex items-center gap-2">
                        ➕ CRIAR NOVA CATEGORIA
                      </span>
                    </SelectItem>
                  </SelectContent>
                </Select>
                <div className="pointer-events-none absolute right-12 top-1/2 -translate-y-1/2 text-zinc-600 transition-colors group-hover:text-emerald-500">
                  <Layers className="size-5" />
                </div>
              </div>
            </div>

            <div className="space-y-1.5 md:space-y-3">
              <label
                htmlFor="product-sku"
                className="ml-1 text-[10px] font-black uppercase tracking-widest text-zinc-500"
              >
                Código SKU
              </label>
              <div className="group relative">
                <LocalBufferedInput
                  id="product-sku"
                  name="product-sku"
                  type="text"
                  value={formData.sku}
                  onFlush={(val) =>
                    setFormData((prev) => ({
                      ...prev,
                      sku: val.trim().toUpperCase().replace(/\s+/g, "-"),
                    }))
                  }
                  placeholder="Ex: SKU-PROD-BASE"
                  className="w-full rounded-xl border border-white/5 bg-zinc-950/50 px-4 py-3 text-sm font-black text-white transition-all placeholder:text-zinc-800 focus:border-emerald-500 focus:outline-none focus:ring-2 focus:ring-emerald-500/20 sm:rounded-2xl sm:px-6 sm:py-5"
                />
                <div className="pointer-events-none absolute right-6 top-1/2 -translate-y-1/2 text-zinc-600">
                  <Layers className="size-5" />
                </div>
              </div>
              {skuError && (
                <span className="ml-1 mt-1 block text-[10px] font-bold text-red-500">
                  {skuError}
                </span>
              )}
            </div>

            <div className="space-y-1.5 md:col-span-2 md:space-y-3">
              <label
                htmlFor="product-stock"
                className="ml-1 block cursor-pointer text-[10px] font-black uppercase tracking-widest text-zinc-500"
              >
                Quantidade em Estoque *
              </label>
              <div className="group relative">
                <LocalBufferedInput
                  id="product-stock"
                  name="stock"
                  type="number"
                  min="0"
                  value={formData.stock}
                  onFlush={(val) =>
                    setFormData((prev) => ({ ...prev, stock: val }))
                  }
                  disabled={hasActiveVariants}
                  className="w-full rounded-xl border border-white/5 bg-zinc-950/50 px-4 py-3 text-sm font-black tabular-nums text-white transition-all focus:border-emerald-500 focus:outline-none focus:ring-2 focus:ring-emerald-500/20 disabled:cursor-not-allowed disabled:text-zinc-400 disabled:opacity-50 sm:rounded-2xl sm:px-6 sm:py-5"
                />
                <div className="pointer-events-none absolute right-6 top-1/2 -translate-y-1/2 text-zinc-600">
                  <Package className="size-5" />
                </div>
              </div>
              {hasActiveVariants ? (
                <span className="ml-1 mt-1 block flex items-center gap-1.5 text-[10px] font-bold text-amber-500">
                  <Info className="size-3.5 shrink-0" />
                  Estoque gerenciado pelas variantes ativas ({formData.stock}{" "}
                  un).
                </span>
              ) : (
                stockError && (
                  <span className="ml-1 mt-1 block text-[10px] font-bold text-red-500">
                    {stockError}
                  </span>
                )
              )}
            </div>

            {/* Peso e Dimensões de Envio (Logística) */}
            {!isLocalShipping && (
              <div className="space-y-3 border-t border-white/5 pt-5 md:col-span-2">
                <h3 className="flex items-center gap-2 text-[10px] font-black uppercase tracking-[0.2em] text-zinc-500">
                  <Truck className="size-4 animate-pulse text-zinc-500" />
                  Dimensões e Logística (Frete)
                </h3>
                <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
                  <div className="space-y-1">
                    <label
                      htmlFor="product-weight"
                      className="ml-1 block cursor-pointer text-[9px] font-black uppercase tracking-wider text-zinc-500"
                    >
                      Peso (kg)
                    </label>
                    <LocalBufferedInput
                      id="product-weight"
                      name="weightKg"
                      type="number"
                      step="0.001"
                      min="0"
                      placeholder="Ex: 0.350"
                      value={formData.weightKg}
                      onFlush={(val) =>
                        setFormData((prev) => ({ ...prev, weightKg: val }))
                      }
                      className="w-full rounded-lg border border-white/5 bg-zinc-950/50 px-3 py-2.5 text-xs font-bold text-white transition-all focus:outline-none focus:ring-2 focus:ring-emerald-500/20 sm:rounded-xl sm:px-4 sm:py-3.5"
                    />
                  </div>
                  <div className="space-y-1">
                    <label
                      htmlFor="product-width"
                      className="ml-1 block cursor-pointer text-[9px] font-black uppercase tracking-wider text-zinc-500"
                    >
                      Largura (cm)
                    </label>
                    <LocalBufferedInput
                      id="product-width"
                      name="widthCm"
                      type="number"
                      min="0"
                      placeholder="Ex: 15"
                      value={formData.widthCm}
                      onFlush={(val) =>
                        setFormData((prev) => ({ ...prev, widthCm: val }))
                      }
                      className="w-full rounded-lg border border-white/5 bg-zinc-950/50 px-3 py-2.5 text-xs font-bold text-white transition-all focus:outline-none focus:ring-2 focus:ring-emerald-500/20 sm:rounded-xl sm:px-4 sm:py-3.5"
                    />
                  </div>
                  <div className="space-y-1">
                    <label
                      htmlFor="product-height"
                      className="ml-1 block cursor-pointer text-[9px] font-black uppercase tracking-wider text-zinc-500"
                    >
                      Altura (cm)
                    </label>
                    <LocalBufferedInput
                      id="product-height"
                      name="heightCm"
                      type="number"
                      min="0"
                      placeholder="Ex: 15"
                      value={formData.heightCm}
                      onFlush={(val) =>
                        setFormData((prev) => ({ ...prev, heightCm: val }))
                      }
                      className="w-full rounded-lg border border-white/5 bg-zinc-950/50 px-3 py-2.5 text-xs font-bold text-white transition-all focus:outline-none focus:ring-2 focus:ring-emerald-500/20 sm:rounded-xl sm:px-4 sm:py-3.5"
                    />
                  </div>
                  <div className="space-y-1">
                    <label
                      htmlFor="product-length"
                      className="ml-1 block cursor-pointer text-[9px] font-black uppercase tracking-wider text-zinc-500"
                    >
                      Comprimento (cm)
                    </label>
                    <LocalBufferedInput
                      id="product-length"
                      name="lengthCm"
                      type="number"
                      min="0"
                      placeholder="Ex: 15"
                      value={formData.lengthCm}
                      onFlush={(val) =>
                        setFormData((prev) => ({ ...prev, lengthCm: val }))
                      }
                      className="w-full rounded-lg border border-white/5 bg-zinc-950/50 px-3 py-2.5 text-xs font-bold text-white transition-all focus:outline-none focus:ring-2 focus:ring-emerald-500/20 sm:rounded-xl sm:px-4 sm:py-3.5"
                    />
                  </div>
                </div>
                <span className="text-zinc-455 block text-[8px] font-medium leading-normal">
                  * O peso e as dimensões da embalagem individual são utilizados
                  para a cotação de frete automática (Correios/Melhor
                  Envio/Frenet). Se não informados, o sistema utilizará valores
                  padrão (0.3 kg e 15x15x15 cm).
                </span>
              </div>
            )}
          </div>
        </section>

        {/* Pricing Section */}
        <section className="relative space-y-4 border-t border-white/5 pt-6 md:pt-8">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="flex size-10 items-center justify-center rounded-xl border border-emerald-500/20 bg-emerald-500/10">
                <DollarSign className="size-5 text-emerald-500" />
              </div>
              <h3 className="text-xs font-black uppercase tracking-[0.2em] text-zinc-400">
                Precificação do Produto
              </h3>
              <button
                type="button"
                onClick={() => toggleHelp("productPricing")}
                className={cn(
                  "w-8 h-8 rounded-full flex items-center justify-center text-xs font-black border transition-all shrink-0 active:scale-95 select-none touch-manipulation",
                  expandedHelp.productPricing
                    ? "bg-emerald-500 border-emerald-400 text-emerald-950 shadow-md shadow-emerald-500/10 scale-110"
                    : "bg-zinc-950/50 border-white/10 text-zinc-400",
                )}
                title="Ajuda / Guia de Precificação"
              >
                ?
              </button>
            </div>

            {priceVal > 0 && (
              <div className="flex gap-3">
                <div className="flex flex-col items-end">
                  <span className="mb-1 text-right text-[8px] font-black uppercase tracking-widest text-zinc-600">
                    Margem Líquida
                  </span>
                  <div className="flex items-center gap-2">
                    <div className="h-1 w-16 overflow-hidden rounded-full bg-zinc-800">
                      <motion.div
                        initial={{ width: 0 }}
                        animate={{
                          width: `${Math.min(100, Math.max(0, marginPct))}%`,
                        }}
                        className={`h-full ${marginPct > 30 ? "bg-emerald-500" : "bg-orange-500"}`}
                      />
                    </div>
                    <span
                      className={`text-sm font-black ${marginPct > 30 ? "text-emerald-500" : "text-orange-500"}`}
                    >
                      {marginPct.toFixed(1)}%
                    </span>
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* Pricing Guide Section */}
          <AnimatePresence>
            {expandedHelp.productPricing && (
              <motion.div
                initial={{ opacity: 0, y: -10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -10 }}
                transition={{ duration: 0.2 }}
                className="space-y-4 border-b border-white/5 pb-4"
              >
                <h3 className="flex items-center gap-2 text-[10px] font-black uppercase tracking-[0.2em] text-zinc-500">
                  <BookOpen className="size-4 text-emerald-400" />
                  Guia de Custos e Margens
                </h3>
                <div className="space-y-4 rounded-2xl border border-white/5 bg-zinc-950/40 p-5">
                  <p className="text-[10px] font-medium leading-relaxed text-zinc-400">
                    Configure os preços de forma estratégica. O sistema calcula
                    a lucratividade automaticamente em tempo real.
                  </p>
                  <ul className="list-none space-y-3 pl-0 text-[10px] font-medium text-zinc-500">
                    <li className="flex items-start gap-2.5">
                      <div className="mt-1.5 size-1.5 shrink-0 rounded-full bg-emerald-500" />
                      <span>
                        <b className="text-zinc-350">
                          Preço de Custo (Opcional):
                        </b>{" "}
                        O valor total que você pagou para adquirir ou fabricar o
                        produto. Esse dado é estritamente confidencial e é usado
                        apenas pelo sistema para calcular a margem de lucro e o
                        retorno sobre investimento (ROI) exibidos abaixo.
                      </span>
                    </li>
                    <li className="flex items-start gap-2.5">
                      <div className="mt-1.5 size-1.5 shrink-0 rounded-full bg-emerald-500" />
                      <span>
                        <b className="text-zinc-350">Preço de Venda:</b> O preço
                        final cobrado do cliente. Pense em embutir custos fixos,
                        impostos e taxas para manter sua operação saudável.
                      </span>
                    </li>
                    <li className="flex items-start gap-2.5">
                      <div className="mt-1.5 size-1.5 shrink-0 rounded-full bg-emerald-500" />
                      <span>
                        <b className="text-zinc-350">Produto em Promoção:</b>{" "}
                        Ative para indicar um preço promocional riscado (ex: De:
                        R$ 100,00 por R$ 79,90). No aplicativo do cliente, isso
                        criará etiquetas com o percentual de desconto (ex: 20%
                        OFF), incentivando a compra impulsiva.
                      </span>
                    </li>
                    <li className="flex items-start gap-2.5">
                      <div className="mt-1.5 size-1.5 shrink-0 rounded-full bg-emerald-500" />
                      <span>
                        <b className="text-zinc-350">
                          Painel de Lucratividade:
                        </b>{" "}
                        O sistema analisa a diferença entre o preço de venda e o
                        preço de custo. É recomendada uma margem de lucro
                        líquida de pelo menos 30%. O sistema emitirá um alerta
                        caso a margem esteja zerada ou negativa.
                      </span>
                    </li>
                  </ul>
                </div>
              </motion.div>
            )}
          </AnimatePresence>

          <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
            <div className="space-y-1.5 md:space-y-3">
              <label
                htmlFor="product-cost-price"
                className="ml-1 block cursor-pointer text-[10px] font-black uppercase tracking-widest text-zinc-500"
              >
                Preço de Custo
              </label>
              <div className="group relative">
                <span className="absolute left-4 top-1/2 -translate-y-1/2 text-sm font-bold text-zinc-600 sm:left-6">
                  R$
                </span>
                <LocalBufferedInput
                  id="product-cost-price"
                  name="costPrice"
                  mask="currency"
                  value={formData.costPrice}
                  onFlush={(val) =>
                    setFormData((prev) => ({ ...prev, costPrice: val }))
                  }
                  className="w-full rounded-xl border border-white/5 bg-zinc-950/50 py-3 pl-11 pr-4 text-base font-black tabular-nums text-white transition-all focus:outline-none focus:ring-2 focus:ring-emerald-500/20 sm:rounded-2xl sm:py-5 sm:pl-14 sm:pr-6 sm:text-lg"
                />
              </div>
              {costError && (
                <span
                  className={cn(
                    "text-[10px] font-bold mt-1 ml-1 block",
                    costError.includes("Aviso")
                      ? "text-amber-500"
                      : "text-red-500",
                  )}
                >
                  {costError}
                </span>
              )}
            </div>

            <div className="space-y-1.5 md:space-y-3">
              <label
                htmlFor="product-sale-price"
                className="ml-1 block cursor-pointer text-[10px] font-black uppercase tracking-widest text-zinc-500"
              >
                Preço de Venda
              </label>
              <div className="group relative">
                <span className="absolute left-4 top-1/2 -translate-y-1/2 text-sm font-bold text-emerald-500/50 sm:left-6">
                  R$
                </span>
                <LocalBufferedInput
                  id="product-sale-price"
                  name="price"
                  mask="currency"
                  value={formData.price}
                  onFlush={(val) =>
                    setFormData((prev) => ({ ...prev, price: val }))
                  }
                  className="w-full rounded-xl border border-emerald-500/20 bg-zinc-950 py-3 pl-11 pr-4 text-base font-black tabular-nums text-emerald-500 shadow-inner transition-all focus:outline-none focus:ring-4 focus:ring-emerald-500/10 sm:rounded-2xl sm:py-5 sm:pl-14 sm:pr-6 sm:text-lg"
                />
              </div>
              {priceError && (
                <span className="ml-1 mt-1 block text-[10px] font-bold text-red-500">
                  {priceError}
                </span>
              )}
            </div>

            <div className="space-y-3.5">
              <label
                htmlFor="product-promo-active"
                className="flex cursor-pointer select-none items-center justify-between rounded-xl border border-white/5 bg-zinc-900/40 p-2.5 transition-all hover:border-emerald-500/10 sm:rounded-2xl sm:p-3.5"
              >
                <div className="space-y-0.5">
                  <span className="text-[10px] font-black uppercase italic tracking-tight text-white transition-colors group-hover:text-emerald-400">
                    Produto em Promoção
                  </span>
                  <span className="block text-[8px] font-medium uppercase tracking-wider text-zinc-500">
                    Ativar preço cortado (De/Por)
                  </span>
                </div>
                <input
                  id="product-promo-active"
                  name="isPromoActive"
                  type="checkbox"
                  aria-label="Produto em Promoção"
                  checked={isPromoActive}
                  onChange={(e) => {
                    setIsPromoActive(e.target.checked);
                    if (!e.target.checked) {
                      setFormData((prev) => ({
                        ...prev,
                        originalPrice: "",
                      }));
                    }
                  }}
                  className="size-5 cursor-pointer rounded border-white/10 bg-zinc-950 text-emerald-500 transition-all focus:ring-emerald-500/20"
                />
              </label>

              {isPromoActive && (
                <div className="space-y-1.5 duration-300 animate-in fade-in slide-in-from-top-2 md:space-y-3">
                  <label
                    htmlFor="product-original-price"
                    className="ml-1 block cursor-pointer text-[10px] font-black uppercase tracking-widest text-zinc-500"
                  >
                    Preço Original ("De:")
                  </label>
                  <div className="group relative">
                    <span className="absolute left-4 top-1/2 -translate-y-1/2 text-sm font-bold text-zinc-600 sm:left-6">
                      R$
                    </span>
                    <LocalBufferedInput
                      id="product-original-price"
                      name="originalPrice"
                      mask="currency"
                      value={formData.originalPrice}
                      onFlush={(val) =>
                        setFormData((prev) => ({
                          ...prev,
                          originalPrice: val,
                        }))
                      }
                      placeholder="Ex: 99.90"
                      className="w-full rounded-xl border border-white/5 bg-zinc-950/50 py-3 pl-11 pr-4 text-base font-black tabular-nums text-zinc-600 transition-all focus:outline-none sm:rounded-2xl sm:py-5 sm:pl-14 sm:pr-6 sm:text-lg"
                    />
                  </div>
                  {originalPriceError && (
                    <span className="ml-1 mt-1 block text-[10px] font-bold text-red-500">
                      {originalPriceError}
                    </span>
                  )}
                </div>
              )}
            </div>
          </div>

          {priceVal > 0 && costPriceVal > 0 && (
            <div className="group/roi relative mt-4">
              {/* Glassmorphism Background with animated border logic */}
              <div
                className={cn(
                  "absolute -inset-[1px] rounded-[2rem] blur-[2px] opacity-50 group-hover/roi:opacity-100 transition-opacity duration-500",
                  marginPct <= 0
                    ? "bg-gradient-to-r from-rose-500/20 via-rose-400/40 to-rose-500/20"
                    : "bg-gradient-to-r from-emerald-500/20 via-emerald-400/40 to-emerald-500/20",
                )}
              />

              <div className="relative flex flex-col items-center justify-between gap-4 overflow-hidden rounded-2xl border border-white/10 bg-zinc-950/40 p-4 backdrop-blur-3xl sm:rounded-[2rem] sm:p-7 md:flex-row md:gap-6">
                {/* Animated Glow Decor */}
                <div
                  className={cn(
                    "absolute top-0 right-0 w-32 h-32 blur-[50px] rounded-full pointer-events-none transition-all duration-700",
                    marginPct <= 0
                      ? "bg-rose-500/10 group-hover/roi:bg-rose-500/20"
                      : "bg-emerald-500/10 group-hover/roi:bg-emerald-500/20",
                  )}
                />

                <div className="flex w-full items-center gap-4 sm:gap-6 md:w-auto">
                  <div className="relative">
                    <div
                      className={cn(
                        "absolute inset-0 blur-xl rounded-2xl transition-all",
                        marginPct <= 0
                          ? "bg-rose-500/20 group-hover/roi:bg-rose-500/40"
                          : "bg-emerald-500/20 group-hover/roi:bg-emerald-500/40",
                      )}
                    />
                    <div
                      className={cn(
                        "relative w-12 h-12 sm:w-16 sm:h-16 rounded-xl sm:rounded-2xl flex items-center justify-center border transition-transform duration-500 shadow-lg",
                        marginPct <= 0
                          ? "bg-gradient-to-br from-rose-500/20 to-rose-600/10 border-rose-500/30 group-hover/roi:scale-110 shadow-rose-500/10 text-rose-400"
                          : "bg-gradient-to-br from-emerald-500/20 to-emerald-600/10 border-emerald-500/30 group-hover/roi:scale-110 shadow-emerald-500/10 text-emerald-400",
                      )}
                    >
                      {marginPct <= 0 ? (
                        <TrendingDown className="size-6 text-rose-400 drop-shadow-[0_0_8px_rgba(244,63,94,0.5)] sm:size-8" />
                      ) : (
                        <TrendingUp className="size-6 text-emerald-400 drop-shadow-[0_0_8px_rgba(52,211,153,0.5)] sm:size-8" />
                      )}
                    </div>
                  </div>

                  <div className="flex flex-col">
                    <p
                      className={cn(
                        "text-[10px] font-black uppercase tracking-[0.3em] mb-1.5 opacity-80",
                        marginPct <= 0 ? "text-rose-400" : "text-emerald-400",
                      )}
                    >
                      {marginPct <= 0 ? "Alerta de Margem" : "Análise de Lucro"}
                    </p>
                    <div className="flex items-baseline gap-2.5">
                      <span className="text-xl font-black tabular-nums tracking-tighter text-white drop-shadow-sm sm:text-2xl md:text-3xl">
                        R${" "}
                        {(priceVal - costPriceVal).toLocaleString("pt-BR", {
                          minimumFractionDigits: 2,
                        })}
                      </span>
                      <span
                        className={cn(
                          "text-[10px] font-black uppercase tracking-widest italic",
                          marginPct <= 0
                            ? "text-rose-500/40"
                            : "text-emerald-500/40",
                        )}
                      >
                        / por unidade
                      </span>
                    </div>
                  </div>
                </div>

                <div className="flex w-full flex-col items-center gap-2 border-t border-white/5 pt-3 sm:gap-3 md:w-auto md:items-end md:border-t-0 md:pt-0">
                  <div className="flex flex-col items-center md:items-end">
                    <span className="mb-1.5 text-[9px] font-black uppercase tracking-[0.2em] text-zinc-500">
                      Análise do Sistema
                    </span>
                    <div className="group/badge relative">
                      <div
                        className={cn(
                          "absolute inset-0 blur-md rounded-xl opacity-0 group-hover/roi:opacity-100 transition-opacity",
                          marginPct <= 0
                            ? "bg-rose-500/40"
                            : "bg-emerald-500/40",
                        )}
                      />
                      <div
                        className={cn(
                          "px-3 py-1.5 sm:px-5 sm:py-2.5 rounded-lg sm:rounded-xl font-black text-[9px] sm:text-[11px] uppercase tracking-wider relative z-10 flex items-center gap-2 group-hover/roi:scale-105 transition-transform duration-500",
                          marginPct <= 0
                            ? "bg-rose-500 text-rose-950 shadow-[0_10px_20px_rgba(244,63,94,0.3)]"
                            : "bg-emerald-500 text-emerald-950 shadow-[0_10px_20px_rgba(16,185,129,0.3)]",
                        )}
                      >
                        {marginPct <= 0 ? (
                          <>
                            <AlertTriangle className="size-3.5" />
                            Margem Negativa
                          </>
                        ) : (
                          <>
                            <Check className="size-3.5" />
                            Alta Performance
                          </>
                        )}
                      </div>
                    </div>
                  </div>
                </div>

                {/* Interactive background lines */}
                <div className="absolute inset-x-0 bottom-0 h-px bg-gradient-to-r from-transparent via-emerald-500/30 to-transparent opacity-20" />
              </div>
            </div>
          )}
        </section>
      </motion.form>

      {/* Image Cropper Modal */}
      <AnimatePresence>
        {isAdjusterOpen && (
          <ImageAdjuster
            isOpen={isAdjusterOpen}
            onClose={() => {
              setIsAdjusterOpen(false);
              setAdjustingImgIndex(null);
            }}
            imageUrl={adjustingImgUrl}
            onConfirm={handleAdjustConfirm}
            isSubmitting={isUploadingAdjusted}
          />
        )}
      </AnimatePresence>

      {/* Floating Action Button */}
      {typeof document !== "undefined" &&
        createPortal(
          // Sobe acima do nav inferior do admin no mobile. O nav é
          // `fixed left-4 right-4 z-[60]` com bottom calculado
          // (AdminLayout.tsx:944) — ele ganha no empilhamento e ocupa a mesma
          // faixa, então `bottom-6` deixava este botão escondido atrás dele.
          // A partir de `lg` o nav some (`lg:hidden`) e o botão volta ao pé.
          <div className="fixed bottom-[calc(6.5rem+var(--safe-area-bottom-fixed,env(safe-area-inset-bottom,0px)))] right-6 z-50 lg:bottom-6">
            <button
              type="button"
              onClick={() => setIsPreviewOpen(true)}
              className="group flex cursor-pointer select-none items-center gap-2.5 rounded-full border border-white/10 bg-zinc-900 px-5 py-3.5 text-white shadow-[0_15px_30px_rgba(0,0,0,0.6)] backdrop-blur-xl transition-all hover:scale-105 hover:border-emerald-500/30 hover:bg-zinc-800 hover:shadow-[0_15px_30px_rgba(16,185,129,0.15)] active:scale-95"
            >
              <div className="relative flex items-center justify-center">
                <span className="absolute inline-flex size-2.5 animate-ping rounded-full bg-emerald-400 opacity-75" />
                <span className="relative inline-flex size-2.5 rounded-full bg-emerald-500" />
              </div>
              <Smartphone className="size-4 text-zinc-400 transition-colors group-hover:text-emerald-400" />
              <span className="text-[10px] font-black uppercase tracking-wider">
                Visualizar App
              </span>
            </button>
          </div>,
          document.body,
        )}

      {/* Live Preview Fullscreen Modal */}
      <AnimatePresence>
        {isPreviewOpen && (
          <PhoneSimulator
            onClose={() => setIsPreviewOpen(false)}
            formData={formData}
            previewMode={previewMode}
            setPreviewMode={setPreviewMode}
            previewImgIndex={previewImgIndex}
            setPreviewImgIndex={setPreviewImgIndex}
            previewSelectedVariants={previewSelectedVariants}
            setPreviewSelectedVariants={setPreviewSelectedVariants}
            activeDetailTab={activeDetailTab}
            setActiveDetailTab={setActiveDetailTab}
          />
        )}
      </AnimatePresence>
      {/* Modal de Ajuda */}
      <AdminHelpModal
        isOpen={showHelpModal}
        onClose={() => setShowHelpModal(false)}
        title="Engenharia & Cadastro de Produtos"
      >
        <div className="space-y-4">
          <p className="text-xs leading-relaxed text-zinc-400">
            Nesta tela você pode cadastrar novos produtos ou editar produtos
            existentes no catálogo da sua loja. Preencha os campos com atenção
            para garantir a melhor experiência para os compradores.
          </p>

          <div className="space-y-3">
            <h4 className="border-l-2 border-admin-gold pl-2 text-[10px] font-black uppercase tracking-[0.2em] text-zinc-400">
              Estrutura do Formulário
            </h4>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div className="space-y-1 rounded-2xl border border-white/5 bg-zinc-900/40 p-4">
                <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-white">
                  <Package className="size-4 text-emerald-500" />
                  Informações Básicas & SKU
                </div>
                <p className="text-xs text-zinc-400">
                  Nome do produto, descrição detalhada e o{" "}
                  <strong className="text-white">SKU</strong> (código único de
                  controle de estoque interno da sua loja).
                </p>
              </div>

              <div className="space-y-1 rounded-2xl border border-white/5 bg-zinc-900/40 p-4">
                <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-white">
                  <DollarSign className="size-4 text-admin-gold" />
                  Precificação & Custos
                </div>
                <p className="text-xs text-zinc-400">
                  Configure o preço de venda e o custo unitário. O sistema
                  calcula automaticamente o lucro líquido e a margem de
                  contribuição.
                </p>
              </div>

              <div className="space-y-1 rounded-2xl border border-white/5 bg-zinc-900/40 p-4">
                <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-white">
                  <Layers className="size-4 text-sky-500" />
                  Grade de Variações
                </div>
                <p className="text-xs text-zinc-400">
                  Adicione variantes (como cores, tamanhos ou voltagens) com
                  estoques separados e possíveis acréscimos ou descontos de
                  preço.
                </p>
              </div>

              <div className="space-y-1 rounded-2xl border border-white/5 bg-zinc-900/40 p-4">
                <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-white">
                  <ShieldCheck className="size-4 text-purple-500" />
                  Galeria de Mídia
                </div>
                <p className="text-xs text-zinc-400">
                  Adicione fotos e organize a galeria de imagens para a vitrine
                  do produto.
                </p>
              </div>
            </div>
          </div>

          <div className="space-y-3">
            <h4 className="border-l-2 border-admin-gold pl-2 text-[10px] font-black uppercase tracking-[0.2em] text-zinc-400">
              Dicas para um Cadastro de Sucesso
            </h4>
            <ul className="list-inside list-disc space-y-2 text-xs text-zinc-400">
              <li>
                Use fotos de alta qualidade com fundo claro ou neutro
                (idealmente quadradas ou 1:1).
              </li>
              <li>
                Descreva detalhadamente o produto, incluindo dimensões,
                materiais e políticas de garantia.
              </li>
              <li>
                Certifique-se de que o SKU cadastrado é único na loja para
                evitar problemas na baixa de estoque.
              </li>
            </ul>
          </div>
        </div>
      </AdminHelpModal>

      {/* Diálogo de Confirmação de Exclusão de Variante */}
      <AlertDialog
        open={variantToDelete !== null}
        onOpenChange={(open) => !open && setVariantToDelete(null)}
      >
        <AlertDialogContent className="max-w-md rounded-3xl border border-white/10 bg-zinc-950">
          <AlertDialogHeader>
            <AlertDialogTitle className="text-lg font-black uppercase tracking-tight text-white">
              Excluir Variante?
            </AlertDialogTitle>
            <AlertDialogDescription className="text-xs text-zinc-400">
              Tem certeza que deseja excluir esta variante? Ela será removida da
              lista. Para salvar essa alteração permanentemente no banco de
              dados, você precisa salvar o formulário do produto.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter className="mt-4 gap-2">
            <AlertDialogCancel className="rounded-xl border border-0 border-white/10 bg-white/5 px-4 py-2 text-xs font-bold text-zinc-400 hover:bg-white/10 hover:text-white">
              Cancelar
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={confirmDeleteVariant}
              className="bg-rose-650 rounded-xl border-0 px-4 py-2 text-xs font-bold text-white hover:bg-rose-700"
            >
              Excluir Variante
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
});

interface VariantItemProps {
  readonly variant: ProductVariant;
  readonly onEdit: (v: ProductVariant) => void;
  readonly onDelete: (id: string) => void;
}

const VariantItem = React.memo(function VariantItem({
  variant,
  onEdit,
  onDelete,
}: VariantItemProps) {
  return (
    <div className="group flex items-center justify-between rounded-2xl border border-white/5 bg-zinc-900 p-4 transition-all hover:border-emerald-500/30">
      <div className="flex items-center gap-3">
        {variant.imageUrl && (
          <div className="size-12 shrink-0 overflow-hidden rounded-lg border border-white/5">
            <LazyImage
              src={variant.imageUrl}
              alt={`${variant.name}: ${variant.value}`}
              className="size-full object-cover"
            />
          </div>
        )}
        <div>
          <div className="mb-1 flex items-center gap-2">
            <span
              data-testid="variante-cadastrada"
              className="text-xs font-black uppercase italic tracking-tight text-white"
            >
              {variant.name}: {variant.value}
            </span>
            {!variant.active && (
              <span className="rounded border border-white/5 bg-zinc-800 px-1.5 py-0.5 text-[7px] font-black uppercase text-zinc-500">
                Offline
              </span>
            )}
          </div>
          <div className="flex items-center gap-4 text-[9px] font-black uppercase tracking-tighter text-zinc-500">
            <span className="flex items-center gap-1.5 rounded-md border border-white/5 bg-white/5 px-2 py-1">
              <Package className="size-3 text-zinc-400" />
              <span className="text-zinc-300">
                {variant.stockIncrement} UND
              </span>
            </span>
            {variant.priceOverride && (
              <span className="flex items-center gap-1.5 rounded-md border border-emerald-500/20 bg-emerald-500/10 px-2 py-1 text-emerald-500">
                <DollarSign className="size-3" />
                R$ {Number(variant.priceOverride).toFixed(2)}
              </span>
            )}
          </div>
        </div>
      </div>
      <div className="flex items-center gap-1">
        <button
          type="button"
          onClick={() => onEdit(variant)}
          className="flex size-8 items-center justify-center rounded-lg text-zinc-600 transition-all hover:bg-white/5 hover:text-white"
        >
          <Edit2 className="size-3.5" />
        </button>
        <button
          type="button"
          onClick={() => onDelete(variant.id)}
          className="flex size-8 items-center justify-center rounded-lg text-zinc-600 transition-all hover:bg-red-500/5 hover:text-red-500"
        >
          <Trash2 className="size-3.5" />
        </button>
      </div>
    </div>
  );
});
