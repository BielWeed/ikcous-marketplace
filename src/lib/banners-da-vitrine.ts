import { DataVault } from "@/lib/dataVault";
import { atributosDeImagem } from "@/lib/imageUrl";
import { IMAGEM_DO_BANNER } from "@/lib/imagem-do-banner";
import { supabase } from "@/lib/supabase";
import type { Banner } from "@/types";

/**
 * Dono do estado, da consulta, do mapeamento e do pré-carregamento da foto dos
 * banners da vitrine.
 *
 * Existe para a consulta poder sair ANTES de a Home montar: na primeira visita
 * o banner do topo era o último elo de uma fila em série (JS da Home -> pedido
 * dos banners -> foto), e o StoreProvider agora aciona `pedirBannersNoBoot`
 * junto da configuração. O hook `useBanners` lê tudo daqui.
 *
 * O cache é COMPARTILHADO com o painel (`useBanners(true)`): por isso há UM
 * contador de geração, que vale também para o pedido do boot -- mutação local
 * (criar, editar, reordenar, excluir) vence qualquer resposta que já estava em
 * voo, venha ela do boot ou de uma tela.
 */

let cacheDeBanners: Banner[] | null = null;
let consultaEmVoo: Promise<Banner[]> | null = null;
let horaDaUltimaConsulta = 0;
let geracaoDasMutacoes = 0;
let bootJaPediu = false;

/** Lista conhecida (rede, cofre ou última mutação local); null = nada ainda. */
export function bannersEmCache(): Banner[] | null {
  return cacheDeBanners;
}

/** Consulta de rede em andamento, para a tela pegar carona em vez de duplicar. */
export function consultaDeBannersEmVoo(): Promise<Banner[]> | null {
  return consultaEmVoo;
}

/** Momento (ms) da última verdade conhecida; base do throttle de 60 s. */
export function horaDaUltimaConsultaDeBanners(): number {
  return horaDaUltimaConsulta;
}

/** Quem captura isto antes de esperar uma consulta sabe se uma edição passou. */
export function geracaoDasMutacoesDeBanners(): number {
  return geracaoDasMutacoes;
}

/**
 * Mutação local (painel): vira a última verdade conhecida e invalida toda
 * resposta que já estava em voo. A próxima montagem nasce deste cache.
 */
export function gravarBannersLocais(items: Banner[]): void {
  geracaoDasMutacoes++;
  cacheDeBanners = items;
  horaDaUltimaConsulta = Date.now();
}

/**
 * Lista lida do cofre (offline-first). Só vale se a rede ainda não confirmou
 * nada -- a rede pode ter confirmado até uma lista vazia durante a leitura.
 */
export function semearBannersDoCofre(items: Banner[]): boolean {
  if (cacheDeBanners) return false;
  cacheDeBanners = items;
  preCarregarFotoDoTopo(items);
  return true;
}

export function preCarregarFotoDoTopo(items: Banner[]): void {
  const topBanner = items.find((b) => b.position === "home_top" && b.active);
  if (topBanner?.imageUrl && typeof window !== "undefined") {
    const atributos = atributosDeImagem(topBanner.imageUrl, IMAGEM_DO_BANNER);
    const img = new Image();
    if (atributos.src !== topBanner.imageUrl) {
      img.onerror = () => {
        img.onerror = null;
        const original = new Image();
        original.src = topBanner.imageUrl;
      };
    }
    img.sizes = atributos.sizes ?? "";
    img.srcset = atributos.srcSet ?? "";
    img.src = atributos.src;
  }
}

/**
 * Antecipação da foto no boot: só na Home (`/` ou `/home`) e só quando a URL
 * passa pelo endpoint de redimensionamento. Loja sem o recurso (IKCOUS: banner
 * de 669 KB) NÃO antecipa -- a foto cheia roubaria o cano da 2a leva de JS; o
 * carrossel a pede quando monta, como sempre.
 */
function preCarregarFotoNoBoot(items: Banner[]): void {
  const caminho = globalThis.location?.pathname.replace(/\/+$/, "");
  if (caminho !== "" && caminho !== "/home") return;
  const topBanner = items.find((b) => b.position === "home_top" && b.active);
  if (!topBanner?.imageUrl) return;
  const { srcSet } = atributosDeImagem(topBanner.imageUrl, IMAGEM_DO_BANNER);
  if (!srcSet) return;
  preCarregarFotoDoTopo(items);
}

function mapearBanner(b: any): Banner {
  return {
    id: b.id,
    imageUrl: b.image_url || b.imagem_url,
    title: b.title || "",
    link: b.link || undefined,
    position: b.position as "home_top" | "home_middle" | "home_bottom",
    active: b.active ?? b.ativo ?? true,
    order: b.order || 0,
    subtitle: b.subtitle || "",
    titleColor: b.title_color || "",
    subtitleColor: b.subtitle_color || "",
    buttonText: b.button_text || "",
    buttonBgColor: b.button_bg_color || "",
    buttonTextColor: b.button_text_color || "",
    fontFamily: b.font_family || "",
    overlayColor: b.overlay_color || "",
    overlayOpacity:
      b.overlay_opacity !== null && b.overlay_opacity !== undefined
        ? Number(b.overlay_opacity)
        : undefined,
    badgeText: b.badge_text || "",
    templateType: b.template_type || "default",
    productId: b.product_id || undefined,
    startDate: b.start_date || null,
    endDate: b.end_date || null,
    showTextOverlay: b.show_text_overlay ?? true,
  };
}

/** Grava a lista de rede no cofre. Pelo singleton: reabre se estava fechado. */
function gravarNoCofre(items: Banner[]): void {
  DataVault.init()
    .then((vault) =>
      vault.replaceAll("banners", items).then(() => {
        vault.setLastSync("banners");
      }),
    )
    .catch(() => {});
}

/**
 * Consulta os banners na rede, compartilhando UMA consulta em voo. Rejeita se a
 * rede ou o banco falharem (quem chama decide o que fazer). Se uma edição local
 * passou enquanto esperava, devolve o cache atual e NÃO grava nada por cima.
 *
 * `cedo`: pedido do boot -- a foto do topo só é antecipada nas condições de
 * `preCarregarFotoNoBoot`. Sem `cedo` (a tela pedindo) o pré-carregamento é
 * incondicional, como sempre foi.
 */
export function pedirBanners(
  opcoes: { cedo?: boolean } = {},
): Promise<Banner[]> {
  if (consultaEmVoo) return consultaEmVoo;
  const geracao = geracaoDasMutacoes;
  const consulta: Promise<Banner[]> = (async () => {
    console.log("[Banners] Fetching banners...");
    const { data, error } = await supabase
      .from("banners")
      .select("*")
      .order("order", { ascending: true });

    // Uma edição local vence a leitura que já estava em voo.
    if (geracao !== geracaoDasMutacoes) return cacheDeBanners || [];

    if (error) {
      console.error("[Banners] Supabase error:", error);
      throw error;
    }

    console.log(`[Banners] Found ${data?.length || 0} banners`);

    if (!data) return [];
    const mapeados: Banner[] = data
      .filter((b: any) => b.image_url || b.imagem_url)
      .map(mapearBanner);

    cacheDeBanners = mapeados;
    if (opcoes.cedo) preCarregarFotoNoBoot(mapeados);
    else preCarregarFotoDoTopo(mapeados);
    horaDaUltimaConsulta = Date.now();
    gravarNoCofre(mapeados);
    return mapeados;
  })().finally(() => {
    // Antes de qualquer tela que esperava a consulta continuar: um novo pedido
    // (a nova tentativa depois de falha) não pode pegar carona numa promessa
    // que já terminou.
    if (consultaEmVoo === consulta) consultaEmVoo = null;
  });
  consultaEmVoo = consulta;
  return consulta;
}

/**
 * Pede os banners no boot da loja (StoreProvider), uma vez só, sem esperar a
 * Home montar. Nunca lança nem deixa rejeição solta: se falhar, o cache segue
 * vazio e o hook tenta de novo ao montar, como na rede fraca de sempre.
 */
export function pedirBannersNoBoot(): void {
  if (bootJaPediu) return;
  bootJaPediu = true;
  try {
    pedirBanners({ cedo: true }).catch(() => {});
  } catch {
    // sem consulta no boot: o hook pede ao montar
  }
}
