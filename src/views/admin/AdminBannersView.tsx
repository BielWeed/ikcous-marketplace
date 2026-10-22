import { LazyImage } from "@/components/LazyImage";
import { AdminHelpModal } from "@/components/admin/AdminHelpModal";
import { AdminPageHeader } from "@/components/admin/AdminPageHeader";
import { LocalBufferedInput } from "@/components/admin/LocalBufferedInput";
import { CamposDeTextoDoBanner } from "@/components/admin/banners/CamposDeTextoDoBanner";
import { CriarBannerComIa } from "@/components/admin/banners/CriarBannerComIa";
import { EscolherCriacaoDoBanner } from "@/components/admin/banners/EscolherCriacaoDoBanner";
import { GaleriaDeBanners } from "@/components/admin/banners/GaleriaDeBanners";
import { PreviaImagemPropria } from "@/components/admin/banners/PreviaImagemPropria";
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
import { BannerPronto } from "@/components/ui/custom/BannerPronto";
import { ImageAdjuster } from "@/components/ui/custom/ImageAdjuster";
import { NOMES_DO_PAINEL } from "@/config/nomes-do-painel";
import { modeloDoBanner } from "@/lib/banner-modelos";

import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { branding } from "@/config/branding";
import { useStore } from "@/contexts/StoreContext";
import { useAuth } from "@/hooks/useAuth";
import { useBanners } from "@/hooks/useBanners";
import { useCategories } from "@/hooks/useCategories";
import { useCoupons } from "@/hooks/useCoupons";
import { useLocalStorage } from "@/hooks/useLocalStorage";
import { useOnlineStatus } from "@/hooks/useOnlineStatus";
import { useProducts } from "@/hooks/useProducts";
import { useScrollRestoration } from "@/hooks/useScrollRestoration";
import { arquivoDaImagemRecortada } from "@/lib/arquivo-da-imagem-recortada";
import { marcarOperacaoSensivel } from "@/lib/atualizacao/operacao-sensivel";
import {
  CORES_DO_MODELO,
  INFO_DOS_MODELOS,
  templateTypeDoModelo,
} from "@/lib/catalogo-de-banners";
import {
  MENSAGEM_FIM_ANTES_DO_INICIO,
  fimDoBannerEmTexto,
  problemaDasDatas,
} from "@/lib/datas-do-banner";
import { LINK_DA_PAGINA_DA_LOJA } from "@/lib/destino-do-banner";
import { chaveDoUsuario } from "@/lib/fila-offline-por-usuario";
import {
  AVISO_DE_LINK_RECUSADO,
  avisoDoLinkDigitado,
  linkDaCategoria,
  linkDoBannerParaSalvar,
} from "@/lib/link-do-banner-no-painel";
import {
  gravarModoDoEditor,
  lerModoDoEditor,
  modoAoAbrirOBanner,
} from "@/lib/modo-do-editor-de-banner";
import { cn, formatCurrency, normalizeText } from "@/lib/utils";
import type { Banner, View } from "@/types";
import { AnimatePresence } from "framer-motion";
import {
  ArrowDown,
  ArrowUp,
  Edit,
  ExternalLink,
  HelpCircle,
  Layout,
  Loader2,
  Plus,
  Sparkles,
  Trash,
} from "lucide-react";
import {
  type ChangeEvent,
  type ComponentProps,
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

// ── Redesenho do gerenciador (peça 23): situação em UMA linha por banner ──
// Mesmos dados de antes (active/startDate/endDate + formatDistanceToNow),
// só que em vez de espalhar badges empilhadas, cada card mostra um ponto
// colorido e uma frase: "qual banner está onde e ligado ou não" em 1 olhar.
const situacaoDoBanner = (
  banner: Banner,
): { rotulo: string; ponto: string; texto: string } => {
  if (!banner.active) {
    return { rotulo: "Pausado", ponto: "bg-zinc-500", texto: "text-zinc-400" };
  }
  const agora = new Date();
  if (banner.startDate && new Date(banner.startDate) > agora) {
    return {
      rotulo: `Agendado — entra no ar ${formatDistanceToNow(banner.startDate)}`,
      ponto: "bg-amber-400",
      texto: "text-amber-400",
    };
  }
  if (banner.endDate && new Date(banner.endDate) < agora) {
    return {
      rotulo: `Expirado — saiu do ar ${formatDistanceToNow(banner.endDate)}`,
      ponto: "bg-rose-400",
      texto: "text-rose-400",
    };
  }
  if (banner.endDate) {
    return {
      rotulo: `No ar — expira ${formatDistanceToNow(banner.endDate)}`,
      ponto: "bg-emerald-400",
      texto: "text-emerald-400",
    };
  }
  if (banner.startDate) {
    return {
      rotulo: `No ar — começou ${formatDistanceToNow(banner.startDate)}`,
      ponto: "bg-emerald-400",
      texto: "text-emerald-400",
    };
  }
  return {
    rotulo: "No ar",
    ponto: "bg-emerald-400",
    texto: "text-emerald-400",
  };
};

interface ControleAtivo {
  id: string;
  type: "up" | "down" | "toggle" | "delete";
}

interface CartaoDoBannerProps {
  readonly banner: Banner;
  /** Rótulo curto da posição (mostrado só quando a lista mistura setores). */
  readonly posicaoCurta: string | null;
  readonly indice: number;
  readonly total: number;
  readonly detalhado: boolean;
  readonly isProcessing: boolean;
  readonly isOffline: boolean;
  readonly activeAction: ControleAtivo | null;
  readonly onMover: (banner: Banner, direcao: "up" | "down") => void;
  readonly onAlternar: (banner: Banner) => void;
  readonly onEditar: (banner: Banner) => void;
  readonly onExcluir: (id: string, imageUrl: string) => void;
}

function InterruptorDoBanner({
  id,
  ...props
}: ComponentProps<typeof Switch> & { id: string }) {
  return (
    <label
      htmlFor={id}
      className="flex size-11 shrink-0 cursor-pointer items-center justify-center"
    >
      <Switch
        {...props}
        id={id}
        className="data-[state=checked]:bg-admin-accent data-[state=unchecked]:bg-admin-border-strong dark:data-[state=unchecked]:bg-admin-border-strong [&_[data-slot=switch-thumb]]:bg-zinc-50"
      />
    </label>
  );
}

const CartaoDoBanner = memo(function CartaoDoBanner({
  banner,
  posicaoCurta,
  indice,
  total,
  detalhado,
  isProcessing,
  isOffline,
  activeAction,
  onMover,
  onAlternar,
  onEditar,
  onExcluir,
}: CartaoDoBannerProps) {
  const situacao = situacaoDoBanner(banner);
  const ocupado = activeAction?.id === banner.id;

  return (
    <div
      className={cn(
        "group relative w-full max-w-full overflow-hidden rounded-2xl border border-admin-border bg-admin-surface transition-colors duration-300 hover:border-white/[0.12] hover:bg-admin-raised",
        !banner.active && "bg-admin-bg",
      )}
    >
      <div
        className={cn("flex w-full flex-col gap-3 p-3", detalhado && "sm:p-4")}
      >
        {/* Conteúdo: miniatura + título + situação + rota.
            No detalhado abaixo de sm, empilha (imagem em cima) — com w-full +
            shrink-0 numa linha horizontal, a miniatura consumiria a largura
            inteira e espremeria o texto até sumir atrás do overflow-hidden. */}
        <div
          className={cn(
            "flex min-w-0 items-center gap-3",
            detalhado && "flex-col items-stretch sm:flex-row sm:items-center",
          )}
        >
          <div
            className={cn(
              "relative shrink-0 overflow-hidden rounded-xl border border-admin-border bg-zinc-900",
              detalhado
                ? "aspect-[2/1] w-full sm:w-44 lg:w-64 xl:w-80"
                : "aspect-[2/1] w-28 sm:w-32",
              !banner.active && "opacity-70 grayscale",
            )}
          >
            {modeloDoBanner(banner.templateType) ? (
              <BannerPronto banner={banner} />
            ) : (
              <LazyImage
                src={banner.imageUrl}
                alt={banner.title || "Banner"}
                className="size-full object-cover"
              />
            )}
          </div>

          <div className="min-w-0 flex-1 space-y-1">
            <div className="flex min-w-0 items-baseline gap-2">
              <h3
                className={cn(
                  "min-w-0 max-w-full truncate font-semibold",
                  banner.active ? "text-white" : "text-zinc-400",
                  detalhado ? "text-sm sm:text-base" : "text-sm",
                )}
              >
                {banner.title || "Campanha sem Título"}
              </h3>
              <span className="shrink-0 font-mono text-[11px] text-zinc-400">
                #{banner.order}
              </span>
              {posicaoCurta && (
                <span className="hidden shrink-0 text-[11px] text-zinc-400 sm:inline">
                  · {posicaoCurta}
                </span>
              )}
            </div>

            <div className="flex items-center gap-1.5 text-[11px]">
              <span
                className={cn("size-1.5 shrink-0 rounded-full", situacao.ponto)}
              />
              <span
                className={cn("min-w-0 truncate font-medium", situacao.texto)}
              >
                {situacao.rotulo}
              </span>
            </div>

            {banner.link && (
              <div className="flex min-w-0 items-center gap-1 font-mono text-[11px] text-zinc-400">
                <ExternalLink className="size-2.5 shrink-0" />
                <span className="min-w-0 truncate">{banner.link}</span>
              </div>
            )}

            {banner.startDate &&
              banner.endDate &&
              banner.active &&
              (() => {
                const agora = new Date();
                const inicio = new Date(banner.startDate!);
                const fim = new Date(banner.endDate!);
                if (agora < inicio || agora > fim) return null;
                const totalMs = fim.getTime() - inicio.getTime();
                const decorrido = agora.getTime() - inicio.getTime();
                const pct = Math.min(
                  100,
                  Math.max(0, (decorrido / totalMs) * 100),
                );
                return (
                  <div className="flex items-center gap-2 pt-0.5">
                    <div className="h-0.5 flex-1 overflow-hidden rounded-full bg-white/5">
                      <div
                        className="h-full rounded-full bg-emerald-400/80"
                        style={{ width: `${pct}%` }}
                      />
                    </div>
                    <span className="shrink-0 font-mono text-[11px] text-zinc-400">
                      {Math.round(pct)}%
                    </span>
                  </div>
                );
              })()}
          </div>
        </div>

        {/* Controles: ordem · exibir · editar · excluir */}
        <div className="flex flex-wrap items-center justify-between gap-2 border-t border-admin-border pt-2.5">
          <div className="flex flex-wrap items-center gap-1.5">
            <div className="flex items-center rounded-lg border border-admin-border bg-admin-raised p-0.5">
              <button
                onClick={() => onMover(banner, "up")}
                disabled={indice === 0 || isProcessing || isOffline}
                className="flex size-11 items-center justify-center rounded-md text-zinc-400 transition-colors hover:bg-white/5 hover:text-white disabled:opacity-25 disabled:hover:bg-transparent"
                title="Mover para cima"
              >
                {ocupado && activeAction?.type === "up" ? (
                  <Loader2 className="size-4 motion-safe:animate-spin text-zinc-200" />
                ) : (
                  <ArrowUp className="size-4" />
                )}
              </button>
              <button
                onClick={() => onMover(banner, "down")}
                disabled={indice === total - 1 || isProcessing || isOffline}
                className="flex size-11 items-center justify-center rounded-md text-zinc-400 transition-colors hover:bg-white/5 hover:text-white disabled:opacity-25 disabled:hover:bg-transparent"
                title="Mover para baixo"
              >
                {ocupado && activeAction?.type === "down" ? (
                  <Loader2 className="size-4 motion-safe:animate-spin text-zinc-200" />
                ) : (
                  <ArrowDown className="size-4" />
                )}
              </button>
            </div>

            <div className="flex items-center gap-1.5 rounded-lg border border-admin-border bg-admin-raised px-2 py-1.5">
              <span className="text-[11px] font-bold uppercase tracking-wider text-zinc-400">
                Exibir
              </span>
              <InterruptorDoBanner
                id={`banner-card-active-${banner.id}`}
                checked={banner.active}
                onCheckedChange={() => onAlternar(banner)}
                disabled={isProcessing || isOffline}
                aria-label={`Exibir ${banner.title || "banner"}`}
              />
            </div>
          </div>

          <div className="flex items-center gap-1.5">
            <button
              onClick={() => onEditar(banner)}
              disabled={isProcessing || isOffline}
              className="flex size-11 items-center justify-center rounded-lg border border-admin-border bg-admin-raised text-zinc-400 transition-colors hover:bg-white/5 hover:text-white disabled:pointer-events-none disabled:opacity-40"
              title="Editar"
            >
              <Edit className="size-4 text-zinc-200" />
            </button>
            <button
              onClick={() => onExcluir(banner.id, banner.imageUrl)}
              disabled={isProcessing || isOffline}
              className="flex size-11 items-center justify-center rounded-lg border border-rose-500/20 bg-rose-500/10 text-rose-400 transition-colors hover:bg-rose-500 hover:text-white disabled:pointer-events-none disabled:opacity-40"
              title="Excluir"
            >
              {ocupado && activeAction?.type === "delete" ? (
                <Loader2 className="size-4 motion-safe:animate-spin" />
              ) : (
                <Trash className="size-4" />
              )}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
});

// Fonte única do shape "banner vazio" (~20 campos), achado
// AdminBannersView-1198: o literal completo (title, imageUrl, link,
// position, active, order, subtitle, titleColor, ..., templateType,
// productId, startDate, endDate, showTextOverlay) era reescrito à mão no
// useState inicial do formData, nos dois "initial" de fallback
// (dirty-check e auto-save, byte-a-byte iguais) e nas duas ramificações de
// handleOpenDialog. Um campo novo que só entrasse em um desses blocos
// deixava o indicador de "alterações não salvas" ou o rascunho do
// auto-save sistematicamente errados, sem erro visível — agora os 5 pontos
// chamam esta função e só podem divergir editando ela.
// Exportada para o teste em
// tests/front/admin-banners-default-nao-diverge.test.tsx.
export const defaultBannerFor = (
  position: Banner["position"],
  order: number,
): Omit<Banner, "id"> => ({
  title: "",
  imageUrl: "",
  link: "",
  position,
  active: true,
  order,
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

// Comparação campo a campo de formData contra o baseline do formulário.
// Mesmo achado AdminBannersView-1198: dirty-check e auto-save repetiam a
// MESMA comparação de ~20 campos palavra por palavra; agora os dois chamam
// esta função. Exportada pelo mesmo motivo de defaultBannerFor.
export const isBannerFormDirty = (
  formData: Partial<Banner>,
  initial: Banner,
): boolean =>
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
  formData.endDate !== initial.endDate ||
  (formData.showTextOverlay !== false) !== (initial.showTextOverlay !== false);

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
  // L10 — o rascunho do formulário é do USUÁRIO (`admin_banner_form_draft:<uid>`):
  // cada admin só lê, grava e apaga o dele. Sem uid não há chave, e a tela
  // não lê nem grava rascunho (nunca cai numa chave compartilhada).
  const { user } = useAuth();
  const chaveDoRascunho = user?.id
    ? chaveDoUsuario("admin_banner_form_draft", user.id)
    : null;
  useCoupons(true);
  const { categories } = useCategories();

  const [searchQueryList, setSearchQueryList] = useState("");
  const [statusFilter, setStatusFilter] = useState<
    "all" | "active" | "paused" | "scheduled" | "expired"
  >("all");

  const isOffline = useOnlineStatus();
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [edicaoPendenteAposSalvar, setEdicaoPendenteAposSalvar] =
    useState(false);
  const isSavedRef = useRef(false);
  // Espelho em ref de isSubmitting: os caminhos de fechamento (Escape,
  // botão voltar) capturam handleOpenChange em closure antiga — lendo o
  // estado por ref, o bloqueio de fechamento durante a gravação vale
  // mesmo vindo de closure velha.
  const isSubmittingRef = useRef(false);
  const [showHelpModal, setShowHelpModal] = useState(false);
  const [editingBanner, setEditingBanner] = useState<Banner | null>(null);
  const [uploading, setUploading] = useState(false);
  const geracaoDoUploadPendente = useRef<number | null>(null);
  const geracaoDoEditor = useRef(0);
  const imagemEnviadaNaoSalvaRef = useRef<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [selectedTab, setSelectedTab] = useLocalStorage<
    "all" | "home_top" | "home_middle" | "home_bottom"
  >("admin_banners_selected_tab", "all");
  const [viewMode, setViewMode] = useLocalStorage<"detailed" | "compact">(
    "admin_banners_view_mode",
    "detailed",
  );
  const [bannerToDelete, setBannerToDelete] = useState<{
    id: string;
    imageUrl: string;
  } | null>(null);
  // Fim da programação já passou: pede confirmação antes de salvar.
  const [confirmarFimVencido, setConfirmarFimVencido] = useState(false);
  const fimVencidoConfirmadoRef = useRef(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [activeAction, setActiveAction] = useState<{
    id: string;
    type: "up" | "down" | "toggle" | "delete";
  } | null>(null);
  const [tela, setTela] = useState<"jeito" | "modelos" | "editor" | "ia">(
    "jeito",
  );
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

  const [formData, setFormData] = useState<Partial<Banner>>(() =>
    defaultBannerFor("home_top", 0),
  );
  const formularioAtual = useRef({ formData, bannerMode });
  // Inclui a digitação que ainda aguarda o debounce do LocalBufferedInput.
  const revisaoDaDigitacao = useRef(0);
  useEffect(() => {
    formularioAtual.current = { formData, bannerMode };
  }, [formData, bannerMode]);

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
      // Sem atalho "Produtos": a loja não tem `/produtos`; a lista de produtos
      // é a própria Home ("Início").
      { label: "Início", path: LINK_DA_PAGINA_DA_LOJA },
      { label: "Carrinho", path: "/checkout" },
      { label: "Perfil", path: "/profile" },
    ];
    const categoryChips = categories
      .filter((c) => c.isActive)
      .map((c) => ({
        label: `Categoria: ${c.name}`,
        path: linkDaCategoria(c.name),
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
  // O bloqueio síncrono pertence à geração: uma resposta antiga não libera a nova.
  const geracaoDoRecortePendente = useRef<number | null>(null);

  const openAdjuster = (url: string) => {
    if (isSubmittingRef.current) return;
    setAdjustingImgUrl(url);
    setIsAdjusterOpen(true);
  };

  const adotarImagemEnviada = (url: string) => {
    // Recorte e upload podem responder antes do próximo render. Compartilham
    // a imagem substituível, sem depender do formData capturado por cada envio.
    const imagemAnterior = imagemEnviadaNaoSalvaRef.current;
    imagemEnviadaNaoSalvaRef.current = url;
    if (
      imagemAnterior &&
      imagemAnterior !== url &&
      imagemAnterior !== editingBanner?.imageUrl
    ) {
      deleteStorageFile(imagemAnterior).catch(() => {});
    }
    setFormData((prev) => ({ ...prev, imageUrl: url }));
  };

  const handleAdjustConfirm = async (croppedBlob: Blob) => {
    if (
      isSubmittingRef.current ||
      geracaoDoRecortePendente.current === geracaoDoEditor.current
    ) {
      return;
    }
    if (isOffline) {
      toast.error("Sem conexão com a internet", {
        description: "Você precisa estar online para salvar a imagem ajustada.",
      });
      return;
    }
    const geracaoDoRecorte = geracaoDoEditor.current;
    geracaoDoRecortePendente.current = geracaoDoRecorte;
    setIsUploadingAdjusted(true);
    // Mesmo achado do produto (AdminProductFormView-499): o ImageAdjuster
    // exporta webp — nome/tipo fixos ".jpg"/"image/jpeg" mentiam sobre o
    // conteúdo e quebravam a transformação de imagem do Storage. O helper
    // derivado do tipo REAL do blob é compartilhado com a tela de produtos.
    const file = arquivoDaImagemRecortada(croppedBlob, "banner-image-");
    const loadingToast = toast.loading("Enviando imagem recortada...");
    const fim = marcarOperacaoSensivel("upload-de-banner");
    try {
      const url = await uploadBannerImage(file);
      // O recorte pertence à abertura que o iniciou, assim como o upload normal.
      if (geracaoDoRecorte !== geracaoDoEditor.current) {
        deleteStorageFile(url).catch(() => {});
        toast.dismiss(loadingToast);
        return;
      }
      adotarImagemEnviada(url);
      toast.success("Imagem ajustada com sucesso!", { id: loadingToast });
      setIsAdjusterOpen(false);
    } catch (error) {
      if (geracaoDoRecorte !== geracaoDoEditor.current) {
        toast.dismiss(loadingToast);
        return;
      }
      console.error("Error uploading adjusted banner image:", error);
      toast.error("Erro ao salvar imagem ajustada", { id: loadingToast });
    } finally {
      fim();
      if (geracaoDoRecorte === geracaoDoEditor.current) {
        geracaoDoRecortePendente.current = null;
        setIsUploadingAdjusted(false);
      }
    }
  };

  const [productSearch, setProductSearch] = useState("");
  const [mostrarProdutos, setMostrarProdutos] = useState(false);
  const [isPreviewCollapsed, setIsPreviewCollapsed] = useState(false);

  const filteredProducts = useMemo(() => {
    if (!productSearch) return products;
    // Busca sem acento acha produto acentuado ("maquina" acha "Máquina") —
    // mesma regra (normalizeText) da busca da loja.
    const q = normalizeText(productSearch);
    return products.filter(
      (p) => p.id === formData.productId || normalizeText(p.name).includes(q),
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

    // Texto que vai para a vitrine: dinheiro com vírgula e espaço comum depois
    // do "R$" (o Intl usa um espaço inquebrável, que não queremos gravado).
    // O caractere dentro da regex abaixo é o espaço inquebrável (U+00A0) de
    // propósito: é exatamente ele que o Intl coloca depois do "R$".
    const dinheiro = (valor: number) =>
      // eslint-disable-next-line no-irregular-whitespace
      formatCurrency(Number(valor)).replace(/ /g, " ");
    const subtitleSuggestions = [
      `Por apenas ${dinheiro(selectedProduct.price)}`,
      "Confira essa oferta especial na nossa loja!",
    ];
    if (
      selectedProduct.originalPrice &&
      selectedProduct.originalPrice > selectedProduct.price
    ) {
      subtitleSuggestions.push(
        `De ${dinheiro(selectedProduct.originalPrice)} por ${dinheiro(
          selectedProduct.price,
        )}`,
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
      // Busca sem acento acha banner acentuado — mesma regra (normalizeText)
      // da busca da loja.
      const q = normalizeText(searchQueryList);
      const matchesSearch =
        !searchQueryList ||
        normalizeText(b.title).includes(q) ||
        normalizeText(b.subtitle).includes(q) ||
        normalizeText(b.badgeText).includes(q) ||
        normalizeText(b.link).includes(q);

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

  // Suporte a fechamento via tecla Escape.
  // Ordem de captura: o ImageAdjuster é renderizado por cima do diálogo de
  // banner (abre a partir de dentro dele, via openAdjuster), então é o
  // overlay mais no topo e precisa ser checado ANTES de isDialogOpen — senão
  // o Esc fecha o formulário inteiro (e apaga o upload) enquanto só o
  // recorte deveria fechar. Mesma razão para a pergunta "Este banner já
  // terminou...": ela abre POR CIMA do formulário, e o Esc fecha só ela.
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        // O Radix já tratou este Esc (fechou a pergunta/diálogo e chamou
        // preventDefault) antes de o ouvinte da janela rodar; sem esta guarda
        // o mesmo Esc fecharia também o formulário de baixo.
        if (e.defaultPrevented) return;
        if (confirmarFimVencido) {
          setConfirmarFimVencido(false);
        } else if (isAdjusterOpen) {
          setIsAdjusterOpen(false);
        } else if (isDialogOpen) {
          handleOpenChange(false);
        } else if (showHelpModal) {
          setShowHelpModal(false);
        }
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isDialogOpen, showHelpModal, isAdjusterOpen, confirmarFimVencido]);

  // Reset modal and adjuster states when active is false to prevent focus traps and scroll lock
  useEffect(() => {
    if (!active) {
      geracaoDoEditor.current += 1;
      setIsDialogOpen(false);
      setShowHelpModal(false);
      setEditingBanner(null);
      setUploading(false);
      setIsSubmitting(false);
      setBannerToDelete(null);
      setIsAdjusterOpen(false);
      setAdjustingImgUrl("");
      setIsUploadingAdjusted(false);
      setTela("jeito");
      setSelectedCouponCode("");
      setExtractedColors([]);
    }
  }, [active]);

  // Empurra uma entrada de histórico virtual quando o diálogo abre e a
  // consome (history.back()) quando ele fecha — por QUALQUER caminho
  // (Cancelar, Salvar com sucesso, Escape, Voltar físico do Android ou o
  // botão Voltar do AdminLayout). Antes desta correção (achado
  // AdminBannersView-1156) este componente não empurrava nada: o Voltar
  // físico pulava direto para a URL que já estava uma posição abaixo
  // (ex.: Ajustes) e o app trocava de tela por baixo do diálogo, em vez
  // de só fechá-lo. Mesmo padrão de CheckoutView.tsx
  // (`hasPushedAddressModalState`): copia o state atual e só acrescenta
  // `modal: "banner"`, sem mudar a URL visível.
  //
  // A checagem `window.history.state?.modal === "banner"` antes do
  // `back()` é o que torna o fechamento à prova de duas coisas: (1) o
  // Voltar FÍSICO, onde o navegador já fez o pop sozinho antes do
  // popstate chegar até este componente — sem a checagem, este efeito
  // consumiria MAIS UMA entrada e o app sairia da tela de verdade, o
  // exato bug que está sendo corrigido; e (2) uma navegação real para
  // outra aba que aconteça com o diálogo aberto — o pushState dessa
  // navegação já está por cima do nosso, então a flag não bate mais e
  // este efeito não mexe no histórico dela.
  const temEntradaDeHistoricoPendenteRef = useRef(false);
  useEffect(() => {
    if (isDialogOpen) {
      if (!temEntradaDeHistoricoPendenteRef.current) {
        window.history.pushState(
          { ...window.history.state, modal: "banner" },
          "",
          window.location.pathname + window.location.search,
        );
        temEntradaDeHistoricoPendenteRef.current = true;
      }
    } else if (temEntradaDeHistoricoPendenteRef.current) {
      temEntradaDeHistoricoPendenteRef.current = false;
      if (window.history.state?.modal === "banner") {
        window.history.back();
      }
    }
  }, [isDialogOpen]);

  // Registra o fechamento do diálogo como override do Voltar. O botão
  // Voltar do AdminLayout (AdminArea.tsx:705) chama esta mesma função
  // DIRETO (sem passar pelo popstate), e o history.back() disparado pelo
  // efeito acima pode entregar um popstate que também tenta rodá-la de
  // novo antes deste efeito desregistrar — `efetuouFechamentoRef` torna a
  // segunda chamada um no-op em vez de repetir a limpeza de
  // `handleOpenChange` (ex.: apagar upload órfão duas vezes).
  const efetuouFechamentoRef = useRef(false);
  // Em Modelos ou IA, o Voltar da barra volta UMA etapa (para "Como criar"),
  // como fazia a seta que saiu do cabeçalho do editor; só nas outras fecha.
  const telaRef = useRef(tela);
  useEffect(() => {
    telaRef.current = tela;
  }, [tela]);
  // Avisa a barra superior (AdminLayout) que o editor está aberto: lá o botão
  // "Novo Banner" some enquanto a pessoa já está criando um.
  useEffect(() => {
    if (!isDialogOpen) return;
    window.dispatchEvent(
      new CustomEvent("admin:banner-dialog-state", { detail: { open: true } }),
    );
    return () => {
      window.dispatchEvent(
        new CustomEvent("admin:banner-dialog-state", {
          detail: { open: false },
        }),
      );
    };
  }, [isDialogOpen]);
  useEffect(() => {
    if (onSetBackOverride) {
      if (isDialogOpen) {
        efetuouFechamentoRef.current = false;
        onSetBackOverride(() => () => {
          if (telaRef.current === "modelos" || telaRef.current === "ia") {
            setTela("jeito");
            return;
          }
          if (efetuouFechamentoRef.current) return;
          efetuouFechamentoRef.current = true;
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
      ...defaultBannerFor(defaultPosition, defaultOrder),
    };

    onSetDirty(
      edicaoPendenteAposSalvar || isBannerFormDirty(formData, initial),
    );
  }, [
    isDialogOpen,
    formData,
    editingBanner,
    banners,
    selectedTab,
    onSetDirty,
    edicaoPendenteAposSalvar,
  ]);

  // State to manage draft recovery
  const [draftToRecover, setDraftToRecover] = useState<{
    formData: Partial<Banner>;
    editingBannerId?: string;
    imagemEnviadaNaoSalva?: string | null;
    savedAt: string;
  } | null>(null);

  // Check for drafts when dialog opens
  useEffect(() => {
    if (isDialogOpen && chaveDoRascunho) {
      const savedDraft = localStorage.getItem(chaveDoRascunho);
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
  }, [isDialogOpen, editingBanner, chaveDoRascunho]);

  // Debounced auto-save effect
  useEffect(() => {
    if (!isDialogOpen || isSavedRef.current || !chaveDoRascunho) return;

    const defaultPosition =
      editingBanner?.position ||
      (selectedTab !== "all" ? selectedTab : "home_top");
    const defaultOrder =
      banners.filter((b) => b.position === defaultPosition).length + 1;
    const initial: Banner = editingBanner || {
      id: "",
      ...defaultBannerFor(defaultPosition, defaultOrder),
    };

    const hasChanges = isBannerFormDirty(formData, initial);

    if (!hasChanges) {
      return;
    }

    const timer = setTimeout(() => {
      const draftData = {
        formData,
        editingBannerId: editingBanner?.id || undefined,
        imagemEnviadaNaoSalva: imagemEnviadaNaoSalvaRef.current,
        savedAt: new Date().toISOString(),
      };
      localStorage.setItem(chaveDoRascunho, JSON.stringify(draftData));
    }, 1000);

    return () => clearTimeout(timer);
  }, [
    formData,
    isDialogOpen,
    editingBanner,
    banners,
    selectedTab,
    chaveDoRascunho,
  ]);

  // O toque no alternador troca o modo E o lembra neste aparelho. Abrir o
  // editor nunca grava: só a escolha do lojista vira preferência.
  const escolherOModo = (modo: "simple" | "complete") => {
    setBannerMode(modo);
    gravarModoDoEditor(modo);
  };

  const handleOpenDialog = (banner?: Banner) => {
    geracaoDoEditor.current += 1;
    imagemEnviadaNaoSalvaRef.current = null;
    setUploading(false);
    setIsUploadingAdjusted(false);
    setIsAdjusterOpen(false);
    setActiveColorElement("titleColor");
    setProductSearch("");
    setMostrarProdutos(false);

    let initialCoupon = "";
    if (banner?.link) {
      const match = banner.link.match(/[?&]coupon=([^&]+)/);
      if (match?.[1]) {
        initialCoupon = match[1];
      }
    }
    setSelectedCouponCode(initialCoupon);

    isSavedRef.current = false;
    setEdicaoPendenteAposSalvar(false);
    setTela("jeito");
    if (banner?.id) {
      setTela("editor");
      setEditingBanner(banner);
      // Banner com texto abre SEMPRE em Completo: salvar em Simples apaga
      // título, subtítulo, botão, selo, cores e fonte. Sem texto, vale o modo
      // lembrado neste aparelho (Simples na primeira vez).
      setBannerMode(
        modeloDoBanner(banner.templateType)
          ? "complete"
          : modoAoAbrirOBanner(banner, lerModoDoEditor()),
      );
      // Fallback campo a campo contra defaultBannerFor (não um spread cego):
      // banner vem do banco e pode ter nascido ANTES de um campo novo
      // existir (coluna ainda não preenchida para linhas antigas) — o
      // default de "editar um banner sem esse campo" precisa ser o MESMO
      // default de "criar um banner do zero", nunca um valor hardcoded à
      // parte que alguém esqueça de manter igual (achado AdminBannersView-1198).
      const defaultsParaEdicao = defaultBannerFor(
        banner.position || "home_top",
        banner.order || 0,
      );
      setFormData({
        title: banner.title || defaultsParaEdicao.title,
        imageUrl: banner.imageUrl || defaultsParaEdicao.imageUrl,
        link: banner.link || defaultsParaEdicao.link,
        position: banner.position || defaultsParaEdicao.position,
        active: banner.active ?? defaultsParaEdicao.active,
        order: banner.order || defaultsParaEdicao.order,
        subtitle: banner.subtitle || defaultsParaEdicao.subtitle,
        titleColor: banner.titleColor || defaultsParaEdicao.titleColor,
        subtitleColor: banner.subtitleColor || defaultsParaEdicao.subtitleColor,
        buttonText: banner.buttonText || defaultsParaEdicao.buttonText,
        buttonBgColor: banner.buttonBgColor || defaultsParaEdicao.buttonBgColor,
        buttonTextColor:
          banner.buttonTextColor || defaultsParaEdicao.buttonTextColor,
        fontFamily: banner.fontFamily || defaultsParaEdicao.fontFamily,
        overlayColor: banner.overlayColor || defaultsParaEdicao.overlayColor,
        overlayOpacity:
          banner.overlayOpacity ?? defaultsParaEdicao.overlayOpacity,
        badgeText: banner.badgeText || defaultsParaEdicao.badgeText,
        templateType: banner.templateType || defaultsParaEdicao.templateType,
        productId: banner.productId || defaultsParaEdicao.productId,
        startDate: banner.startDate || defaultsParaEdicao.startDate,
        endDate: banner.endDate || defaultsParaEdicao.endDate,
        showTextOverlay:
          banner.showTextOverlay ?? defaultsParaEdicao.showTextOverlay,
      });
    } else {
      setEditingBanner(null);
      setBannerMode(modoAoAbrirOBanner(null, lerModoDoEditor()));
      const defaultPosition =
        banner?.position || (selectedTab !== "all" ? selectedTab : "home_top");
      setFormData(
        defaultBannerFor(
          defaultPosition,
          banners.filter((b) => b.position === defaultPosition).length + 1,
        ),
      );
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
      // Enquanto o add/update está em voo, fechar apagaria o upload que a
      // gravação (se resolver) passaria a referenciar — banner quebrado no
      // ar. Ignora a tentativa: no sucesso o diálogo se fecha sozinho; na
      // falha ele segue aberto com o toast de erro e o lojista decide.
      if (isSubmittingRef.current) return;
      geracaoDoEditor.current += 1;
      setUploading(false);
      setProductSearch("");
      setSelectedCouponCode("");
      if (!isSavedRef.current) {
        if (
          imagemEnviadaNaoSalvaRef.current &&
          formData.imageUrl === imagemEnviadaNaoSalvaRef.current &&
          formData.imageUrl !== editingBanner?.imageUrl
        ) {
          deleteStorageFile(formData.imageUrl).catch(() => {});
          // O rascunho pode apontar para a URL recém-apagada — limpa o
          // campo para a recuperação não restaurar uma imagem morta.
          try {
            const bruto = chaveDoRascunho
              ? localStorage.getItem(chaveDoRascunho)
              : null;
            if (chaveDoRascunho && bruto) {
              const rascunho = JSON.parse(bruto);
              if (rascunho?.formData?.imageUrl === formData.imageUrl) {
                rascunho.formData.imageUrl = "";
                localStorage.setItem(chaveDoRascunho, JSON.stringify(rascunho));
              }
            }
          } catch {
            // rascunho ausente ou corrompido: a recuperação já tolera.
          }
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
    if (
      isSubmittingRef.current ||
      geracaoDoUploadPendente.current === geracaoDoEditor.current
    ) {
      return;
    }
    if (isOffline) {
      toast.error("Sem conexão com a internet", {
        description:
          "Você precisa estar online para fazer o upload de imagens.",
      });
      return;
    }
    const input = e.target;
    const file = input.files?.[0];
    if (!file) return;
    await enviarArquivo(file);
    input.value = "";
  };

  const enviarArquivo = async (file: File) => {
    if (
      isOffline ||
      isSubmittingRef.current ||
      geracaoDoUploadPendente.current === geracaoDoEditor.current
    )
      return;

    const geracaoDoUpload = geracaoDoEditor.current;
    geracaoDoUploadPendente.current = geracaoDoUpload;
    setUploading(true);
    const loadingToast = toast.loading("Enviando imagem do banner...");
    const fim = marcarOperacaoSensivel("upload-de-banner");
    try {
      const url = await uploadBannerImage(file);
      // O upload pertence à abertura que o iniciou.
      if (geracaoDoUpload !== geracaoDoEditor.current) {
        deleteStorageFile(url).catch(() => {});
        toast.dismiss(loadingToast);
        return;
      }
      adotarImagemEnviada(url);
      toast.success("Imagem enviada com sucesso", { id: loadingToast });
    } catch {
      if (geracaoDoUpload !== geracaoDoEditor.current) {
        toast.dismiss(loadingToast);
        return;
      }
      toast.error("Erro ao enviar imagem", { id: loadingToast });
    } finally {
      fim();
      if (geracaoDoUpload === geracaoDoEditor.current) {
        geracaoDoUploadPendente.current = null;
        setUploading(false);
      }
    }
  };

  const handleSubmit = async () => {
    // A confirmação "Salvar mesmo assim" vale para ESTA chamada só: lida e
    // zerada antes de qualquer retorno antecipado (offline, salvando...),
    // senão sobraria `true` e pularia a pergunta no próximo banner vencido.
    const jaConfirmouFimVencido = fimVencidoConfirmadoRef.current;
    fimVencidoConfirmadoRef.current = false;
    if (isOffline) {
      toast.error("Sem conexão com a internet", {
        description:
          "Você precisa estar online para salvar as alterações do banner.",
      });
      return;
    }
    if (
      isSubmittingRef.current ||
      geracaoDoUploadPendente.current === geracaoDoEditor.current ||
      geracaoDoRecortePendente.current === geracaoDoEditor.current
    ) {
      return;
    }
    const revisaoEnviada = revisaoDaDigitacao.current;
    setIsSubmitting(true);
    isSubmittingRef.current = true;
    const fim = marcarOperacaoSensivel("upload-de-banner");
    try {
      if (!formData.imageUrl) {
        toast.error("Imagem é obrigatória");
        setIsSubmitting(false);
        return;
      }

      // Datas sem sentido não salvam em silêncio: fim antes do início
      // bloqueia; fim que já passou (banner que nunca vai aparecer) pergunta.
      // Banner que já estava vencido e continua com a mesma data de fim não
      // pergunta de novo (a lojista não mexeu nas datas).
      const problemaDeData = problemaDasDatas(
        formData.startDate,
        formData.endDate,
      );
      const fimMudou =
        !editingBanner ||
        (editingBanner.endDate ?? null) !== (formData.endDate ?? null);
      if (
        problemaDeData === "fim-antes-do-inicio" ||
        (problemaDeData === "fim-ja-passou" &&
          fimMudou &&
          !jaConfirmouFimVencido)
      ) {
        if (problemaDeData === "fim-antes-do-inicio") {
          toast.error(MENSAGEM_FIM_ANTES_DO_INICIO);
        } else {
          setConfirmarFimVencido(true);
        }
        setIsSubmitting(false);
        isSubmittingRef.current = false;
        return;
      }

      // Endereço de site sem https:// (`wa.me/55...`) ganha o https://; sem
      // barra no começo ganha uma (como sempre foi); `javascript:`, `data:`,
      // `//outro-site` e afins não passam: a loja abriria o link ao tocar.
      const sanitizedLink = linkDoBannerParaSalvar(formData.link);
      if (sanitizedLink === null) {
        toast.error(AVISO_DE_LINK_RECUSADO);
        setIsSubmitting(false);
        isSubmittingRef.current = false;
        return;
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

      // A bandeira de "salvo" e a limpeza do rascunho só valem DEPOIS do
      // salvar resolver: se o add/update falhar, o fechamento do diálogo
      // continua limpando o upload que não virou banner (e o rascunho
      // sobrevive para o lojista recuperar o formulário).
      if (editingBanner) {
        await updateBanner(editingBanner.id, dataToSubmit);
      } else {
        const criado = await addBanner(
          dataToSubmit as Required<Omit<Banner, "id">>,
        );
        // Se houve nova edição, o próximo salvar atualiza o banner criado.
        // A imagem enviada já está publicada e não é mais um upload órfão.
        if (criado?.id) {
          setEditingBanner({ ...dataToSubmit, id: criado.id } as Banner);
        }
      }
      // O envio agora pertence ao banner publicado, mesmo se o editor continuar aberto.
      imagemEnviadaNaoSalvaRef.current = null;
      const mudouDuranteEnvio =
        JSON.stringify(formularioAtual.current.formData) !==
          JSON.stringify(formData) ||
        formularioAtual.current.bannerMode !== bannerMode ||
        revisaoDaDigitacao.current !== revisaoEnviada;
      if (mudouDuranteEnvio) {
        setEdicaoPendenteAposSalvar(true);
        if (editingBanner) {
          setEditingBanner({ ...editingBanner, ...dataToSubmit });
        }
        onSetDirty?.(true);
        return;
      }
      isSavedRef.current = true;
      geracaoDoEditor.current += 1;
      setEdicaoPendenteAposSalvar(false);
      if (chaveDoRascunho) localStorage.removeItem(chaveDoRascunho);
      setIsDialogOpen(false);
    } catch (error) {
      console.error("Erro ao salvar banner:", error);
      toast.error("Erro ao salvar as configurações do banner.");
    } finally {
      fim();
      setIsSubmitting(false);
      isSubmittingRef.current = false;
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
      // Igual aos irmãos confirmDeleteBanner/moveBanner: sem isto o Switch só
      // voltava a ficar habilitado em silêncio e o lojista achava que a
      // troca tinha sido aplicada quando na verdade falhou.
      toast.error("Erro ao alternar status do banner.");
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

  const modelo = modeloDoBanner(formData.templateType);
  const ocupadoComImagem = uploading || isUploadingAdjusted || isSubmitting;
  const escolherProduto = (produto: (typeof products)[number]) => {
    if (
      isSubmittingRef.current ||
      geracaoDoUploadPendente.current === geracaoDoEditor.current ||
      geracaoDoRecortePendente.current === geracaoDoEditor.current
    )
      return;
    setMostrarProdutos(false);
    if (modelo) {
      const orfa = imagemEnviadaNaoSalvaRef.current;
      if (orfa) deleteStorageFile(orfa).catch(() => {});
      imagemEnviadaNaoSalvaRef.current = null;
    }
    setFormData((prev) => ({
      ...prev,
      productId: produto.id,
      link: `/product-detail?id=${encodeURIComponent(produto.id)}`,
      ...(modelo
        ? {
            imageUrl: produto.images?.[0] || "",
            title: (prev.title || produto.name).slice(0, 60),
            subtitle: (
              prev.subtitle ||
              `A partir de ${formatCurrency(Number(produto.price)).replaceAll(String.fromCharCode(160), " ")}`
            ).slice(0, 80),
            buttonText: prev.buttonText || "Comprar agora",
          }
        : {}),
    }));
  };

  return (
    <div
      ref={viewRef}
      className="min-h-full w-full bg-admin-bg pb-admin font-sans text-zinc-400"
    >
      <div className="mx-auto w-full max-w-3xl space-y-6 p-4 sm:p-6">
        {isOffline && (
          <p
            role="status"
            className="rounded-xl border border-admin-border bg-admin-surface p-3 text-sm"
          >
            Você está offline. Conecte-se para alterar os banners.
          </p>
        )}
        {!isDialogOpen ? (
          <>
            <header className="space-y-3">
              <div className="flex items-center justify-between">
                <AdminPageHeader titulo={NOMES_DO_PAINEL["admin-banners"]} />
                <Button
                  variant="ghost"
                  className="min-h-11 min-w-11 text-zinc-400"
                  title="Como usar os Banners"
                  onClick={() => setShowHelpModal(true)}
                >
                  <span aria-hidden="true">
                    <HelpCircle className="size-5" />
                  </span>
                </Button>
              </div>
              <p className="text-sm">
                O que aparece no topo, meio e base da sua loja.
              </p>
              <Button
                className="min-h-12 w-full rounded-2xl bg-white text-zinc-950 ring-1 ring-inset ring-admin-border-strong hover:ring-current hover:bg-white"
                disabled={isOffline || !isLoaded}
                onClick={() => handleOpenDialog()}
              >
                <Plus className="mr-2 size-5" />
                Novo Banner
              </Button>
            </header>
            <details className="rounded-2xl border border-admin-border bg-admin-surface p-3">
              <summary className="flex min-h-11 cursor-pointer items-center text-sm text-white">
                Opções da lista · {activeBanners} ligados de {totalBanners}
              </summary>
              <p className="py-3 text-sm">
                Preenchimento: {impactText}.{" "}
                {banners.filter((b) => b.position === "home_top").length} no
                topo ·{" "}
                {banners.filter((b) => b.position === "home_middle").length} no
                meio ·{" "}
                {banners.filter((b) => b.position === "home_bottom").length} na
                base.
              </p>
              <div className="flex flex-wrap gap-2">
                {(
                  [
                    ["all", "Todos"],
                    ["home_top", "Topo"],
                    ["home_middle", "Meio"],
                    ["home_bottom", "Base"],
                  ] as const
                ).map(([id, rotulo]) => (
                  <Button
                    key={id}
                    variant="outline"
                    aria-pressed={selectedTab === id}
                    className="min-h-11 border-admin-border bg-admin-raised text-white"
                    onClick={() => setSelectedTab(id)}
                  >
                    {rotulo}
                  </Button>
                ))}
                <Button
                  variant="outline"
                  className="min-h-11 border-admin-border bg-admin-raised text-white"
                  onClick={() =>
                    setViewMode((prev) =>
                      prev === "detailed" ? "compact" : "detailed",
                    )
                  }
                >
                  {viewMode === "detailed"
                    ? "Visualização Compacta"
                    : "Visualização Detalhada"}
                </Button>
              </div>
              <Input
                id="banner-search-input"
                className="mt-3 min-h-11 border-admin-border bg-admin-bg text-white"
                placeholder="Buscar campanhas..."
                value={searchQueryList}
                onChange={(e) => setSearchQueryList(e.target.value)}
              />
              <Label htmlFor="banner-status-filter" className="mt-3 block">
                Situação
              </Label>
              <select
                id="banner-status-filter"
                className="mt-1 min-h-11 w-full rounded-xl border border-admin-border bg-admin-bg px-3 text-white"
                value={statusFilter}
                onChange={(e) =>
                  setStatusFilter(e.target.value as typeof statusFilter)
                }
              >
                <option value="all">Todos</option>
                <option value="active">No ar</option>
                <option value="paused">Pausados</option>
                <option value="scheduled">Agendados</option>
                <option value="expired">Expirados</option>
              </select>
              <Button
                variant="ghost"
                className="min-h-11 text-white"
                onClick={() => {
                  setSearchQueryList("");
                  setStatusFilter("all");
                }}
              >
                Limpar Filtros
              </Button>
            </details>
            {!isLoaded && banners.length === 0 ? (
              <div aria-label="Carregando banners" className="space-y-3">
                <Skeleton className="h-44 w-full rounded-2xl" />
                <Skeleton className="h-44 w-full rounded-2xl" />
              </div>
            ) : filteredBannersList.length === 0 ? (
              <div className="rounded-3xl border border-dashed border-admin-border bg-admin-surface p-6 text-center">
                <h2 className="font-semibold text-white">
                  Nenhum Banner encontrado
                </h2>
                <p className="mt-2 text-sm">
                  {banners.length
                    ? "Tente ajustar a busca ou os filtros."
                    : "Crie seu primeiro banner com um modelo ou envie sua imagem."}
                </p>
              </div>
            ) : (
              visiblePositions.map((pos) => {
                const lista = filteredBannersList
                  .filter((b) => b.position === pos.value)
                  .sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
                const todosNaPosicao = banners
                  .filter((b) => b.position === pos.value)
                  .sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
                return (
                  <section key={pos.value} className="space-y-3">
                    <h2 className="flex justify-between text-xs font-semibold uppercase tracking-wider">
                      <span>{pos.label}</span>
                      <span>{lista.length} banners</span>
                    </h2>
                    {lista.length ? (
                      lista.map((b) => (
                        <CartaoDoBanner
                          key={b.id}
                          banner={b}
                          posicaoCurta={null}
                          indice={todosNaPosicao.findIndex(
                            (t) => t.id === b.id,
                          )}
                          total={todosNaPosicao.length}
                          detalhado={viewMode === "detailed"}
                          isProcessing={isProcessing}
                          isOffline={isOffline}
                          activeAction={activeAction}
                          onMover={moveBanner}
                          onAlternar={handleToggleActive}
                          onEditar={handleOpenDialog}
                          onExcluir={handleDelete}
                        />
                      ))
                    ) : (
                      <Button
                        variant="outline"
                        className="min-h-11 w-full border-admin-border bg-admin-surface text-white"
                        disabled={isOffline}
                        onClick={() =>
                          handleOpenDialog({ position: pos.value } as Banner)
                        }
                      >
                        Adicionar Primeiro Banner
                      </Button>
                    )}
                  </section>
                );
              })
            )}
          </>
        ) : (
          <div
            onInputCapture={() => {
              revisaoDaDigitacao.current += 1;
            }}
            className="space-y-6"
          >
            {/* Sem seta de voltar aqui: o "Voltar" da barra superior do painel
                (backOverride, mais abaixo) é o único e já fecha este editor,
                ou volta uma etapa quando a pessoa está em Modelos ou IA. */}
            <header className="flex items-center gap-3">
              <AdminPageHeader
                titulo={editingBanner ? "Editar Banner" : "Novo Banner"}
                tituloEncolhe
              />
            </header>
            {draftToRecover && (
              <aside className="space-y-3 rounded-2xl border border-admin-border bg-admin-surface p-4">
                <p className="text-sm text-white">
                  Rascunho salvo {formatDistanceToNow(draftToRecover.savedAt)}.
                  Deseja recuperar?
                </p>
                <div className="flex gap-2">
                  <Button
                    variant="outline"
                    className="min-h-11 border-admin-border bg-admin-raised text-white"
                    onClick={() => {
                      if (chaveDoRascunho)
                        localStorage.removeItem(chaveDoRascunho);
                      setDraftToRecover(null);
                    }}
                  >
                    Descartar
                  </Button>
                  <Button
                    className="min-h-11 bg-white text-zinc-950 ring-1 ring-inset ring-admin-border-strong hover:ring-current"
                    onClick={() => {
                      const imagem = draftToRecover.formData.imageUrl;
                      const arquivoDoRascunho =
                        imagem &&
                        (draftToRecover.imagemEnviadaNaoSalva === imagem ||
                          imagem.includes(
                            "/storage/v1/object/public/banners/",
                          ));
                      imagemEnviadaNaoSalvaRef.current =
                        arquivoDoRascunho &&
                        !banners.some((b) => b.imageUrl === imagem) &&
                        !products.some((p) => p.images?.includes(imagem))
                          ? imagem
                          : null;
                      setFormData({
                        ...defaultBannerFor(
                          editingBanner?.position || "home_top",
                          editingBanner?.order || 1,
                        ),
                        ...draftToRecover.formData,
                      });
                      setBannerMode((m) =>
                        modeloDoBanner(draftToRecover.formData.templateType)
                          ? "complete"
                          : modoAoAbrirOBanner(draftToRecover.formData, m),
                      );
                      setTela("editor");
                      setDraftToRecover(null);
                    }}
                  >
                    Recuperar
                  </Button>
                </div>
              </aside>
            )}
            {tela === "jeito" ? (
              <EscolherCriacaoDoBanner aoEscolher={setTela} />
            ) : tela === "modelos" ? (
              <GaleriaDeBanners
                fotoUrl={products[0]?.images?.[0]}
                aoEscolher={(m) => {
                  setBannerMode("complete");
                  setFormData((prev) => ({
                    ...prev,
                    templateType: templateTypeDoModelo(m),
                    overlayColor:
                      m === "claro" || m === "vitrine" ? "#EDEDF0" : "#2A2A31",
                    buttonText: "Comprar agora",
                    badgeText: m === "lancamento" ? "LANÇAMENTO" : "",
                    showTextOverlay: true,
                  }));
                  setTela("editor");
                }}
              />
            ) : tela === "ia" ? (
              <CriarBannerComIa
                nomeDaLoja={config?.storeName ?? undefined}
                produtoInicial={selectedProduct?.name}
                aoVoltar={() => setTela("jeito")}
                aoEscolherImagem={(file) => {
                  setTela("editor");
                  enviarArquivo(file);
                }}
              />
            ) : (
              <>
                <section className="space-y-3" aria-label="Prévia ao vivo">
                  <div className="flex items-center justify-between text-sm">
                    <h2 className="font-medium text-white">
                      {modelo
                        ? `Modelo ${INFO_DOS_MODELOS.find((m) => m.id === modelo)?.nome}`
                        : "Imagem própria"}
                    </h2>
                    <Button
                      variant="ghost"
                      className="min-h-11 text-zinc-400"
                      onClick={() => setIsPreviewCollapsed((prev) => !prev)}
                    >
                      {isPreviewCollapsed
                        ? "Expandir pré-visualização"
                        : "Recolher pré-visualização"}
                    </Button>
                  </div>
                  {!isPreviewCollapsed &&
                    (modelo ? (
                      <div
                        data-tema-fixo=""
                        className="aspect-[2/1] overflow-hidden rounded-2xl"
                      >
                        <BannerPronto
                          banner={{
                            ...defaultBannerFor("home_top", 1),
                            ...formData,
                            id: "previa",
                          }}
                        />
                      </div>
                    ) : (
                      <PreviaImagemPropria
                        formData={formData}
                        comTexto={bannerMode === "complete"}
                      />
                    ))}
                </section>
                {(modelo || destinationMode === "product") && (
                  <section
                    className="space-y-3"
                    aria-labelledby="produto-do-banner"
                  >
                    <h2
                      id="produto-do-banner"
                      className="text-sm font-semibold text-white"
                    >
                      Produto
                    </h2>
                    {selectedProduct && (
                      <div className="flex items-center gap-3 rounded-2xl border border-admin-border bg-admin-surface p-3">
                        {selectedProduct.images?.[0] && (
                          <img
                            src={selectedProduct.images[0]}
                            alt=""
                            className="size-12 rounded-xl object-cover"
                          />
                        )}
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-sm text-white">
                            {selectedProduct.name}
                          </p>
                          <p className="text-sm">
                            {formatCurrency(Number(selectedProduct.price))} ·
                            foto e link do produto
                          </p>
                        </div>
                        <Button
                          variant="ghost"
                          className="min-h-11 text-white"
                          disabled={ocupadoComImagem}
                          onClick={() => {
                            setProductSearch("");
                            setMostrarProdutos(true);
                          }}
                        >
                          Trocar
                        </Button>
                      </div>
                    )}
                    {(!modelo || !selectedProduct || mostrarProdutos) && (
                      <>
                        <Label
                          htmlFor="banner-product-search"
                          className="sr-only"
                        >
                          Buscar produto
                        </Label>
                        <Input
                          id="banner-product-search"
                          className="min-h-11 border-admin-border bg-admin-surface text-white"
                          placeholder="Pesquise o produto pelo nome para vincular..."
                          value={productSearch}
                          onChange={(e) => setProductSearch(e.target.value)}
                        />
                        <div className="max-h-60 space-y-2 overflow-y-auto">
                          {filteredProducts.slice(0, 20).map((p) => (
                            <div
                              key={p.id}
                              className="flex items-center justify-between gap-2 rounded-xl border border-admin-border bg-admin-surface px-3"
                            >
                              <button
                                type="button"
                                className="min-h-11 min-w-0 flex-1 truncate text-left text-sm text-white"
                                disabled={ocupadoComImagem}
                                onClick={() => escolherProduto(p)}
                              >
                                {p.name}
                              </button>
                              <span className="text-xs">
                                {formatCurrency(Number(p.price))}
                              </span>
                            </div>
                          ))}
                          {filteredProducts.length > 20 && (
                            <p className="text-xs text-zinc-400" role="status">
                              mostrando 20 de {filteredProducts.length}: refine
                              a busca
                            </p>
                          )}
                          {filteredProducts.length === 0 && (
                            <p className="text-sm">
                              Nenhum produto correspondente encontrado. Você
                              também pode usar outra foto.
                            </p>
                          )}
                        </div>
                      </>
                    )}
                  </section>
                )}
                <section className="space-y-3">
                  <div className="flex flex-wrap gap-2">
                    <Button
                      variant="outline"
                      className="min-h-11 border-admin-border bg-admin-surface text-white"
                      disabled={ocupadoComImagem}
                      onClick={() =>
                        document.getElementById("banner-upload")?.click()
                      }
                    >
                      {modelo ? "Usar outra foto" : "Enviar imagem"}
                    </Button>
                    {formData.imageUrl && (
                      <Button
                        variant="outline"
                        className="min-h-11 border-admin-border bg-admin-surface text-white"
                        disabled={ocupadoComImagem}
                        onClick={() => openAdjuster(formData.imageUrl!)}
                      >
                        Ajustar
                      </Button>
                    )}
                  </div>
                  {formData.imageUrl && !modelo && (
                    <img
                      src={formData.imageUrl}
                      alt="Preview Thumbnail"
                      className="h-16 w-32 rounded-xl object-cover"
                    />
                  )}
                  <Input
                    id="banner-upload"
                    name="banner-upload"
                    type="file"
                    accept="image/*"
                    className="hidden"
                    disabled={ocupadoComImagem}
                    onChange={handleFileUpload}
                  />
                  <p className="text-xs">
                    Imagem horizontal · recomendado 1200 × 600 px.
                  </p>
                </section>
                {modelo && (
                  <CamposDeTextoDoBanner
                    formData={formData}
                    aoMudar={setFormData}
                  />
                )}
                {modelo && (
                  <section className="space-y-3">
                    <h2 className="text-sm font-semibold text-white">
                      Cor do modelo
                    </h2>
                    <div className="flex flex-wrap gap-2">
                      {[
                        ...CORES_DO_MODELO,
                        {
                          id: "loja",
                          rotulo: "Loja",
                          hex: config?.primaryColor || "#2A2A31",
                        },
                      ].map((c) => (
                        <button
                          type="button"
                          key={c.id}
                          aria-pressed={formData.overlayColor === c.hex}
                          onClick={() =>
                            setFormData((prev) => ({
                              ...prev,
                              overlayColor: c.hex,
                            }))
                          }
                          className="flex min-h-11 min-w-11 flex-col items-center gap-1 rounded-xl border border-admin-border bg-admin-surface p-2 text-xs text-white ring-1 ring-inset ring-admin-border-strong"
                        >
                          <span
                            className={cn(
                              "size-8 rounded-full shadow-[inset_0_0_0_1px_hsl(var(--admin-border-strong))]",
                              formData.overlayColor === c.hex &&
                                "ring-2 ring-current ring-offset-2 ring-offset-admin-bg",
                            )}
                            style={{ backgroundColor: c.hex }}
                            aria-hidden="true"
                          />
                          {c.rotulo}
                        </button>
                      ))}
                    </div>
                  </section>
                )}
                <details className="rounded-2xl border border-admin-border bg-admin-surface p-4">
                  <summary className="flex min-h-11 cursor-pointer items-center font-medium text-white">
                    Mais opções
                  </summary>
                  <div className="space-y-5 pt-4">
                    <div className="space-y-2">
                      <Label htmlFor="banner-position">Onde aparece</Label>
                      <select
                        id="banner-position"
                        className="min-h-11 w-full rounded-xl border border-admin-border bg-admin-bg px-3 text-white"
                        value={formData.position}
                        onChange={(e) => {
                          const position = e.target.value as Banner["position"];
                          setFormData((prev) => ({
                            ...prev,
                            position,
                            order:
                              banners.filter((b) => b.position === position)
                                .length + 1,
                          }));
                        }}
                      >
                        {positions.map((p) => (
                          <option key={p.value} value={p.value}>
                            {p.label}
                          </option>
                        ))}
                      </select>
                    </div>
                    <Label
                      htmlFor={
                        bannerMode === "simple"
                          ? "banner-simple-order"
                          : "banner-order"
                      }
                    >
                      Ordem de exibição
                    </Label>
                    <Input
                      id={
                        bannerMode === "simple"
                          ? "banner-simple-order"
                          : "banner-order"
                      }
                      type="number"
                      className="min-h-11 border-admin-border bg-admin-bg text-white"
                      value={formData.order ?? ""}
                      onChange={(e) =>
                        setFormData((prev) => ({
                          ...prev,
                          order: Number(e.target.value),
                        }))
                      }
                    />
                    <div className="flex min-h-11 items-center justify-between">
                      <Label htmlFor="banner-active">Banner ativo</Label>
                      <InterruptorDoBanner
                        id="banner-active"
                        checked={formData.active ?? true}
                        onCheckedChange={(active) =>
                          setFormData((prev) => ({ ...prev, active }))
                        }
                      />
                    </div>
                    <section className="space-y-3">
                      <h2 className="text-sm font-semibold text-white">
                        Ao tocar no banner
                      </h2>
                      <div className="flex flex-wrap gap-2">
                        <Button
                          variant="outline"
                          className="min-h-11 border-admin-border bg-admin-raised text-white"
                          onClick={() => {
                            setDestinationMode("none");
                            setFormData((prev) => ({
                              ...prev,
                              link: "",
                              productId: "",
                            }));
                          }}
                        >
                          Apenas Foto
                        </Button>
                        <Button
                          variant="outline"
                          className="min-h-11 border-admin-border bg-admin-raised text-white"
                          onClick={() => setDestinationMode("product")}
                        >
                          Abrir Produto
                        </Button>
                        <Button
                          variant="outline"
                          className="min-h-11 border-admin-border bg-admin-raised text-white"
                          onClick={() => {
                            setDestinationMode("route");
                            setFormData((prev) => ({
                              ...prev,
                              link: LINK_DA_PAGINA_DA_LOJA,
                              productId: "",
                            }));
                          }}
                        >
                          Página da Loja · Home, Ofertas
                        </Button>
                        <Button
                          variant="outline"
                          className="min-h-11 border-admin-border bg-admin-raised text-white"
                          onClick={() => setDestinationMode("custom")}
                        >
                          Link / URL
                        </Button>
                      </div>
                      {destinationMode === "route" && (
                        <div className="flex flex-wrap gap-2">
                          {dynamicRouteSuggestions.map((r) => (
                            <Button
                              key={r.path}
                              variant="outline"
                              aria-pressed={formData.link === r.path}
                              className="min-h-11 border-admin-border bg-admin-raised text-white"
                              onClick={() =>
                                setFormData((prev) => ({
                                  ...prev,
                                  link: r.path,
                                  productId: "",
                                }))
                              }
                            >
                              {r.label} {r.path && `(${r.path})`}
                            </Button>
                          ))}
                        </div>
                      )}
                      <Label htmlFor="banner-link-custom">Link</Label>
                      <LocalBufferedInput
                        id="banner-link-custom"
                        value={formData.link || ""}
                        useShadcn
                        className="min-h-11 border-admin-border bg-admin-bg text-white"
                        validate={avisoDoLinkDigitado}
                        onFlush={(val) =>
                          setFormData((prev) => ({
                            ...prev,
                            link: linkDoBannerParaSalvar(val)?.startsWith(
                              "https://",
                            )
                              ? linkDoBannerParaSalvar(val)!
                              : val,
                          }))
                        }
                      />
                      {selectedCouponCode && (
                        <p className="text-xs">
                          Cupom no link: {selectedCouponCode}
                        </p>
                      )}
                    </section>
                    <section className="space-y-3">
                      <div className="flex min-h-11 items-center justify-between">
                        <Label htmlFor="banner-scheduling-toggle">
                          Programar datas
                        </Label>
                        <InterruptorDoBanner
                          id="banner-scheduling-toggle"
                          checked={!!(formData.startDate || formData.endDate)}
                          onCheckedChange={(checked) => {
                            if (checked) handleApplyDatePreset("24h");
                            else
                              setFormData((prev) => ({
                                ...prev,
                                startDate: null,
                                endDate: null,
                              }));
                          }}
                        />
                      </div>
                      {(formData.startDate || formData.endDate) && (
                        <>
                          <div className="flex flex-wrap gap-2">
                            {(
                              [
                                ["24h", "Próximas 24h"],
                                ["weekend", "Fim de Semana"],
                                ["7d", "7 Dias"],
                                ["30d", "30 Dias"],
                              ] as const
                            ).map(([valor, rotulo]) => (
                              <Button
                                key={valor}
                                variant="outline"
                                className="min-h-11 border-admin-border bg-admin-raised text-white"
                                onClick={() => handleApplyDatePreset(valor)}
                              >
                                {rotulo}
                              </Button>
                            ))}
                          </div>
                          <Label htmlFor="banner-start-date">
                            Data/Hora de Início
                          </Label>
                          <Input
                            id="banner-start-date"
                            type="datetime-local"
                            className="min-h-11 border-admin-border bg-admin-bg text-white"
                            value={toLocalDatetimeLocal(formData.startDate)}
                            onChange={(e) =>
                              setFormData((prev) => ({
                                ...prev,
                                startDate: e.target.value
                                  ? new Date(e.target.value).toISOString()
                                  : null,
                              }))
                            }
                          />
                          <Label htmlFor="banner-end-date">
                            Data/Hora de Fim (Expiração)
                          </Label>
                          <Input
                            id="banner-end-date"
                            type="datetime-local"
                            className="min-h-11 border-admin-border bg-admin-bg text-white"
                            value={toLocalDatetimeLocal(formData.endDate)}
                            onChange={(e) =>
                              setFormData((prev) => ({
                                ...prev,
                                endDate: e.target.value
                                  ? new Date(e.target.value).toISOString()
                                  : null,
                              }))
                            }
                          />
                          {problemaDasDatas(
                            formData.startDate,
                            formData.endDate,
                          ) === "fim-antes-do-inicio" ? (
                            <p role="alert" className="text-sm text-rose-400">
                              {MENSAGEM_FIM_ANTES_DO_INICIO}
                            </p>
                          ) : (
                            formData.endDate && (
                              <p className="text-sm">
                                {fimDoBannerEmTexto(formData.endDate)}
                              </p>
                            )
                          )}
                          {schedulingConflicts.level !== "none" && (
                            <p className="text-sm">
                              Neste período:{" "}
                              {schedulingConflicts.list.length + 1} banners
                              ligados neste setor.{" "}
                              {schedulingConflicts.list
                                .map((b) => b.title || "Sem título")
                                .join(", ")}
                            </p>
                          )}
                        </>
                      )}
                    </section>
                    {!modelo && (
                      <>
                        <div className="flex min-h-11 items-center justify-between">
                          <Label htmlFor="banner-textos">
                            Textos sobre a imagem
                          </Label>
                          <InterruptorDoBanner
                            id="banner-textos"
                            checked={bannerMode === "complete"}
                            onCheckedChange={(checked) =>
                              escolherOModo(checked ? "complete" : "simple")
                            }
                          />
                        </div>
                        {bannerMode === "complete" && (
                          <>
                            <CamposDeTextoDoBanner
                              formData={formData}
                              aoMudar={setFormData}
                            />
                            <div
                              className="flex flex-wrap gap-2"
                              aria-label="Sugestões de botão"
                            >
                              {[
                                "Ver Produto",
                                "Comprar Agora",
                                "Aproveitar Oferta",
                                "Confira",
                                "",
                              ].map((texto) => (
                                <Button
                                  key={texto}
                                  variant="outline"
                                  className="min-h-11 border-admin-border bg-admin-raised text-white"
                                  onClick={() =>
                                    setFormData((prev) => ({
                                      ...prev,
                                      buttonText: texto,
                                    }))
                                  }
                                >
                                  {texto || "Limpar botão"}
                                </Button>
                              ))}
                            </div>
                            {productSuggestions && (
                              <div className="space-y-2">
                                <p className="text-xs">Sugestões do produto</p>
                                {productSuggestions.titles.map((t) => (
                                  <Button
                                    key={t}
                                    variant="outline"
                                    className="min-h-11 max-w-full whitespace-normal border-admin-border bg-admin-raised text-white"
                                    onClick={() =>
                                      setFormData((prev) => ({
                                        ...prev,
                                        title: t.slice(0, 60),
                                      }))
                                    }
                                  >
                                    {t}
                                  </Button>
                                ))}
                                {productSuggestions.subtitles.map((t) => (
                                  <Button
                                    key={t}
                                    variant="outline"
                                    className="min-h-11 max-w-full whitespace-normal border-admin-border bg-admin-raised text-white"
                                    onClick={() =>
                                      setFormData((prev) => ({
                                        ...prev,
                                        subtitle: t.slice(0, 80),
                                      }))
                                    }
                                  >
                                    {t}
                                  </Button>
                                ))}
                              </div>
                            )}
                            <div className="flex min-h-11 items-center justify-between">
                              <Label htmlFor="banner-show-overlay">
                                Exibir textos e botão
                              </Label>
                              <InterruptorDoBanner
                                id="banner-show-overlay"
                                checked={formData.showTextOverlay !== false}
                                onCheckedChange={(showTextOverlay) =>
                                  setFormData((prev) => ({
                                    ...prev,
                                    showTextOverlay,
                                  }))
                                }
                              />
                            </div>
                            <Label htmlFor="banner-old-layout">
                              Disposição do texto
                            </Label>
                            <select
                              id="banner-old-layout"
                              className="min-h-11 w-full rounded-xl border border-admin-border bg-admin-bg px-3 text-white"
                              value={formData.templateType || "default"}
                              onChange={(e) =>
                                setFormData((prev) => ({
                                  ...prev,
                                  templateType: e.target.value,
                                }))
                              }
                            >
                              {[
                                ["default", "Inferior esquerda"],
                                ["split_center", "Centralizado"],
                                ["split_left", "À esquerda"],
                                ["split_right", "À direita"],
                                ["neon_glow", "Neon"],
                                ["glassmorphic", "Vidro"],
                              ].map(([id, nome]) => (
                                <option key={id} value={id}>
                                  {nome}
                                </option>
                              ))}
                            </select>
                            <Label htmlFor="banner-font">Fonte</Label>
                            <select
                              id="banner-font"
                              className="min-h-11 w-full rounded-xl border border-admin-border bg-admin-bg px-3 text-white"
                              value={formData.fontFamily || "system"}
                              onChange={(e) =>
                                setFormData((prev) => ({
                                  ...prev,
                                  fontFamily: e.target.value,
                                }))
                              }
                            >
                              {[
                                ["system", "Sem serifa"],
                                ["font-serif", "Serifa"],
                                ["font-mono", "Mono"],
                                ["font-display", "Display"],
                              ].map(([id, nome]) => (
                                <option key={id} value={id}>
                                  {nome}
                                </option>
                              ))}
                            </select>
                            <details>
                              <summary className="flex min-h-11 cursor-pointer items-center text-sm text-white">
                                Cores e filtro da imagem
                              </summary>
                              <div className="space-y-3 pt-3">
                                <Label htmlFor="banner-color-element">
                                  O que colorir
                                </Label>
                                <select
                                  id="banner-color-element"
                                  className="min-h-11 w-full rounded-xl border border-admin-border bg-admin-bg px-3 text-white"
                                  value={targetColorEl}
                                  onChange={(e) =>
                                    setActiveColorElement(
                                      e.target
                                        .value as typeof activeColorElement,
                                    )
                                  }
                                >
                                  {colorElements.map((c) => (
                                    <option key={c.id} value={c.id}>
                                      {c.label}
                                    </option>
                                  ))}
                                </select>
                                <Input
                                  type="color"
                                  aria-label="Cor personalizada"
                                  className="min-h-11 w-full bg-admin-bg"
                                  value={formData[targetColorEl] || "#FFFFFF"}
                                  onChange={(e) =>
                                    setFormData((prev) => ({
                                      ...prev,
                                      [targetColorEl]: e.target.value,
                                    }))
                                  }
                                />
                                <div className="flex flex-wrap gap-2">
                                  {[
                                    ...brandingColors,
                                    ...presetColors,
                                    ...extractedColors.map((hex) => ({
                                      name: hex,
                                      hex,
                                    })),
                                  ].map((c, i) => (
                                    <button
                                      key={`${c.name}-${i}`}
                                      type="button"
                                      title={c.name}
                                      aria-label={c.name}
                                      className="min-h-11 min-w-11 rounded-xl border border-admin-border-strong ring-1 ring-inset ring-admin-border-strong"
                                      style={{ backgroundColor: c.hex }}
                                      onClick={() =>
                                        setFormData((prev) => ({
                                          ...prev,
                                          [targetColorEl]: c.hex,
                                        }))
                                      }
                                    />
                                  ))}
                                </div>
                                <Label htmlFor="banner-overlay-opacity">
                                  Intensidade do filtro:{" "}
                                  {formData.overlayOpacity ?? 40}%
                                </Label>
                                <Input
                                  id="banner-overlay-opacity"
                                  type="range"
                                  min="0"
                                  max="100"
                                  className="min-h-11 w-full"
                                  value={formData.overlayOpacity ?? 40}
                                  onChange={(e) =>
                                    setFormData((prev) => ({
                                      ...prev,
                                      overlayOpacity: Number(e.target.value),
                                    }))
                                  }
                                />
                                <div className="flex flex-wrap gap-2">
                                  {[20, 40, 70].map((n) => (
                                    <Button
                                      key={n}
                                      variant="outline"
                                      className="min-h-11 border-admin-border bg-admin-raised text-white"
                                      onClick={() =>
                                        setFormData((prev) => ({
                                          ...prev,
                                          overlayOpacity: n,
                                        }))
                                      }
                                    >
                                      {n}%
                                    </Button>
                                  ))}
                                </div>
                                <p className="text-xs">
                                  Contraste estimado: título{" "}
                                  {computedTitleRatio}:1 · subtítulo{" "}
                                  {computedSubtitleRatio}:1 · botão{" "}
                                  {computedButtonRatio}:1
                                </p>
                                <Button
                                  variant="outline"
                                  className="min-h-11 border-admin-border bg-admin-raised text-white"
                                  onClick={handleOptimizeContrast}
                                >
                                  Melhorar contraste
                                </Button>
                                <Button
                                  variant="outline"
                                  className="min-h-11 border-admin-border bg-admin-raised text-white"
                                  onClick={handleAutoThemeFromImage}
                                >
                                  Usar cores da imagem
                                </Button>
                                <Label htmlFor="banner-theme">
                                  Combinações prontas
                                </Label>
                                <select
                                  id="banner-theme"
                                  defaultValue=""
                                  className="min-h-11 w-full rounded-xl border border-admin-border bg-admin-bg px-3 text-white"
                                  onChange={(e) => {
                                    const preset = themePresets.find(
                                      (p) => p.name === e.target.value,
                                    );
                                    if (preset) {
                                      const {
                                        name: _nome,
                                        description: _descricao,
                                        ...cores
                                      } = preset;
                                      setFormData((prev) => ({
                                        ...prev,
                                        ...cores,
                                      }));
                                    }
                                  }}
                                >
                                  <option value="" disabled>
                                    Escolha uma combinação
                                  </option>
                                  {themePresets.map((p) => (
                                    <option key={p.name} value={p.name}>
                                      {p.name}
                                    </option>
                                  ))}
                                </select>
                              </div>
                            </details>
                          </>
                        )}
                      </>
                    )}
                  </div>
                </details>
                <div className="flex flex-col gap-2">
                  <Button
                    className="min-h-12 w-full rounded-2xl bg-white text-zinc-950 ring-1 ring-inset ring-admin-border-strong hover:ring-current hover:bg-white"
                    onClick={handleSubmit}
                    disabled={ocupadoComImagem || isOffline}
                  >
                    {isOffline
                      ? "Modo Offline"
                      : uploading || isUploadingAdjusted
                        ? "Enviando Imagem..."
                        : isSubmitting
                          ? "Salvando..."
                          : modelo
                            ? editingBanner
                              ? "Salvar Alterações"
                              : "Salvar Banner"
                            : bannerMode === "complete"
                              ? "Salvar Alterações"
                              : "Salvar Banner"}
                  </Button>
                  <Button
                    variant="ghost"
                    className="min-h-11 text-zinc-400"
                    disabled={isSubmitting}
                    onClick={handleCloseDialog}
                  >
                    Cancelar
                  </Button>
                </div>
              </>
            )}
          </div>
        )}
      </div>
      {/* Modal de Ajuda */}
      <AdminHelpModal
        isOpen={showHelpModal}
        onClose={() => setShowHelpModal(false)}
        title={`Como usar os ${NOMES_DO_PAINEL["admin-banners"]}`}
      >
        <div className="space-y-4">
          <p className="leading-relaxed">
            Aqui você escolhe os banners rotativos na página inicial do
            aplicativo do cliente. Essa seção é a principal vitrine de promoções
            e produtos em destaque.
          </p>

          <div className="space-y-3">
            <h4 className="border-l-2 border-admin-border pl-2 text-[11px] font-black uppercase tracking-[0.2em] text-zinc-200">
              Parâmetros dos Banners
            </h4>
            <div className="grid select-none grid-cols-1 gap-3 sm:grid-cols-2">
              <div className="space-y-1 rounded-2xl border border-admin-border bg-zinc-900/40 p-4">
                <div className="flex items-center gap-2 text-[11px] font-bold uppercase tracking-wider text-white">
                  <Layout className="size-4 text-emerald-500" />
                  Imagem Promocional
                </div>
                <p className="text-[11px] text-zinc-400">
                  Ideal usar proporção horizontal de 21:9. Imagens com boa
                  legibilidade aumentam a conversão.
                </p>
              </div>

              <div className="space-y-1 rounded-2xl border border-admin-border bg-zinc-900/40 p-4">
                <div className="flex items-center gap-2 text-[11px] font-bold uppercase tracking-wider text-white">
                  <ExternalLink className="size-4 text-zinc-200" />
                  Link de Destino
                </div>
                <p className="text-[11px] text-zinc-400">
                  A página do app para onde o cliente será levado ao tocar no
                  banner (por exemplo, um produto ou uma categoria).
                </p>
              </div>

              <div className="space-y-1 rounded-2xl border border-admin-border bg-zinc-900/40 p-4">
                <div className="flex items-center gap-2 text-[11px] font-bold uppercase tracking-wider text-white">
                  <ArrowUp className="size-4 text-sky-500" />
                  Sequência / Ordenação
                </div>
                <p className="text-[11px] text-zinc-400">
                  Prioridade de exibição na fila de slides. Ordene usando os
                  controles simples no painel.
                </p>
              </div>

              <div className="space-y-1 rounded-2xl border border-admin-border bg-zinc-900/40 p-4">
                <div className="flex items-center gap-2 text-[11px] font-bold uppercase tracking-wider text-white">
                  <Sparkles className="size-4 text-purple-500" />
                  Status de Exibição
                </div>
                <p className="text-[11px] text-zinc-400">
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

      {/* Confirmação: salvar banner cujo fim já passou (nunca vai aparecer) */}
      <AlertDialog
        open={confirmarFimVencido}
        onOpenChange={(open) => !open && setConfirmarFimVencido(false)}
      >
        <AlertDialogContent className="max-w-md rounded-3xl border border-admin-border bg-admin-surface">
          <AlertDialogHeader>
            <AlertDialogTitle className="text-lg font-black uppercase tracking-tight text-white">
              Banner já terminou
            </AlertDialogTitle>
            <AlertDialogDescription className="text-xs text-zinc-400">
              Este banner já terminou e não vai aparecer. Salvar mesmo assim?
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter className="mt-4 gap-2">
            <AlertDialogCancel className="min-h-11 rounded-xl border-0 bg-admin-raised px-4 py-2 text-xs font-bold text-zinc-200 hover:bg-admin-hover hover:text-white dark:bg-admin-raised dark:hover:bg-admin-hover">
              Voltar e ajustar
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                fimVencidoConfirmadoRef.current = true;
                setConfirmarFimVencido(false);
                handleSubmit();
              }}
              className="min-h-11 rounded-xl border-0 bg-white px-4 py-2 text-xs font-bold text-black ring-1 ring-inset ring-admin-border-strong hover:bg-white"
            >
              Salvar mesmo assim
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Diálogo de Confirmação de Exclusão de Banner */}
      <AlertDialog
        open={bannerToDelete !== null}
        onOpenChange={(open) => !open && setBannerToDelete(null)}
      >
        <AlertDialogContent className="max-w-md rounded-3xl border border-admin-border bg-admin-surface">
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
            <AlertDialogCancel className="min-h-11 rounded-xl border-0 bg-admin-raised px-4 py-2 text-xs font-bold text-zinc-200 hover:bg-admin-hover hover:text-white dark:bg-admin-raised dark:hover:bg-admin-hover">
              Cancelar
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={confirmDeleteBanner}
              className="min-h-11 bg-red-600 rounded-xl border-0 px-4 py-2 text-xs font-bold text-white hover:bg-red-700"
            >
              Excluir Banner
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
});
