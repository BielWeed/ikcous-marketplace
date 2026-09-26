import { LazyImage } from "@/components/LazyImage";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetTitle,
} from "@/components/ui/sheet";
import { usePrefetchOnHover } from "@/hooks/usePrefetchOnHover";
import { isViewTransitionSupported } from "@/hooks/useViewTransition";
import {
  type PromessasDeFrete,
  fraseDoSeloDeFreteGratis,
} from "@/lib/estrategias-de-frete";
import { imagemRedimensionada } from "@/lib/imageUrl";
import { rotuloDeFavoritar } from "@/lib/rotulo-favoritar";
import { cn, formatCurrency } from "@/lib/utils";
import type { Product, ProductVariant } from "@/types";
import { triggerFlyingCartAnimation } from "@/utils/cartAnimation";
import {
  Check,
  Flame,
  Heart,
  Loader2,
  ShoppingCart,
  Truck,
} from "lucide-react";
import { memo, useEffect, useId, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { QuantitySelector } from "./QuantitySelector";
import { StarRating } from "./StarRating";

interface ProductCardProps {
  product: Product;
  isFavorite: boolean;
  onToggleFavorite: (product: Product, e: React.MouseEvent) => void;
  onAddToCart?: (product: Product, e: React.MouseEvent) => void;
  onQuickBuy?: (product: Product, e: React.MouseEvent) => void;
  /**
   * Card inteligente (pedido do Gabriel, 02/09; folha desde 13/09 — direção
   * B, mockup dele): presente, o botão "Escolher opções" ABRE a folha de
   * opções que desliza de baixo (bottom sheet, em portal fora do card) —
   * preço e imagem do card reagem à escolha, e o CTA do rodapé da folha
   * entrega a variação escolhida. Ausente, o botão leva para a tela do
   * produto (comportamento de sempre, retrocompatível). Assinatura igual ao
   * `handleAddToCart` do App; peça 18 (14/09): a folha ganhou seletor de
   * quantidade e o CTA entrega também a quantidade escolhida (padrão 1).
   */
  onAddToCartWithVariants?: (
    product: Product,
    variantId: string | undefined,
    variantNames: string,
    quantity?: number,
  ) => void;
  onClick: (productId: string) => void;
  onMouseEnter?: (productId: string) => void;
  onTouchStart?: (productId: string) => void;
  className?: string;
  priority?: boolean;
  selectedProductId?: string;
  /**
   * ADMIN-091 (#202): espelha `config.enableReviews` do StoreContext. Vem
   * por prop, não por `useStore()` direto aqui dentro, porque ProductCard é
   * renderizado aos dezenas numa grade (ProductList, SearchView,
   * FavoritesView, ProductCarousel) -- cada um desses já chama `useStore()`
   * uma vez só e repassa `showRating` do mesmo jeito. Ler o contexto em cada
   * card assinaria a árvore inteira do StoreContext (que muda a cada
   * `fetchProducts`) em cada instância, mesmo protegida por `memo`, porque
   * `useContext` força re-render independente de memo.
   * **Obrigatório de propósito, sem default.** A primeira versão desta
   * correção usava `showRating = true`, e foi exatamente isso que deixou
   * `ProductView` (produtos relacionados, no rodapé) continuar publicando a
   * nota com o interruptor desligado: quem esquece de passar o prop cai no
   * lado que a issue quer esconder, sem erro nenhum. Sendo obrigatório, o
   * `npm run typecheck` recusa qualquer chamador novo que esqueça — a
   * completude passa a ser provada pelo compilador, não por revisão.
   */
  showRating: boolean;
  /**
   * ProductCard-520 + T3 FRETE V3 (23/09/2026): o que a loja PROMETE de
   * frete grátis (local e nacional), calculado uma vez pelo chamador via
   * `promessasDeFrete(config)` (estrategias-de-frete.ts) e repassado aqui —
   * mesmo padrão do `showRating` (ler `useStore()` dentro de um card
   * renderizado aos dezenas assinaria a árvore inteira do contexto a cada
   * instância). O selo "Frete Grátis" só pode afirmar o que a loja DÁ hoje:
   * `product.freeShipping` sozinho é só a marcação do produto, que vale
   * apenas dentro do preset "por_produto" (local ou nacional) ou em
   * "sempre" (qualquer produto) — `fraseDoSeloDeFreteGratis` decide o texto
   * ("Frete grátis" quando local e nacional concordam; "...na cidade"/"...
   * para todo o Brasil" quando só um promete).
   *
   * Opcional pelo mesmo motivo do antigo `freeShippingPreset`: quando
   * ausente, o selo cai para `product.freeShipping` sozinho — sem afirmar
   * "na cidade"/"para todo o Brasil" sem saber a config da loja.
   */
  promessasDeFrete?: PromessasDeFrete;
}

// Global trackers for view transitions to prevent duplicate view-transition-names
let activeTransitionCardId: string | null = null;

export const ProductCard = memo(function ProductCard({
  product,
  isFavorite,
  onToggleFavorite,
  onAddToCart,
  onAddToCartWithVariants,
  onClick,
  onMouseEnter,
  onTouchStart,
  className,
  priority = false,
  selectedProductId,
  showRating,
  promessasDeFrete,
}: Readonly<ProductCardProps>) {
  const instanceId = useId();
  const { prefetchImage } = usePrefetchOnHover();
  // B3 (laudo de acessibilidade, 08/09): o alvo que abre o produto por
  // teclado/leitor de tela virou o botão do NOME -- o clique nele não passa
  // mais pelo wrapper (`e.currentTarget` seria o botão, sem <img> dentro).
  // O `ref` do card inteiro é o que garante achar a foto DESTE card, venha o
  // clique de onde vier.
  const cardRef = useRef<HTMLDivElement>(null);
  // Timers do fluxo "Salvando... -> Salvo!" (dois setTimeout encadeados, ver
  // handleAddToCartClick/handleAdicionarComOpcoes) -- o card pode desmontar
  // no MEIO dessa janela (a vitrine repagina, favoritos remove item com
  // animação, realtime de estoque re-renderiza a lista) e um setState depois
  // do unmount é o tipo de aviso que este cleanup existe para evitar.
  const timersRef = useRef<number[]>([]);
  useEffect(() => {
    return () => {
      timersRef.current.forEach((id) => window.clearTimeout(id));
    };
  }, []);
  // Foco: quem gerencia agora é o próprio diálogo da folha (Radix) -- foco
  // entra no conteúdo ao abrir, fica preso dentro (focus trap) e volta ao
  // elemento que abriu ao fechar (13/09). O foco manual do painel antigo
  // (refs + useEffect com guarda de primeira renderização, laudos de
  // acessibilidade 03/09 e 08/09) foi embora junto com o painel.

  const discount = product.originalPrice
    ? Math.round(
        ((product.originalPrice - product.price) / product.originalPrice) * 100,
      )
    : 0;

  // ProductCard-520 + T3 (23/09): o selo "Frete Grátis" confiava cegamente
  // em `product.freeShipping`, que só é verdade DENTRO do preset "por
  // produto marcado" (local OU nacional) ou em "sempre" de qualquer um dos
  // dois canais. Fora disso, a marcação pode ser resíduo de campanha
  // antiga: a loja desligou o frete grátis (ou trocou para "acima de
  // valor") sem desmarcar os produtos. Sem `promessasDeFrete` (chamador
  // ainda não repassou) o selo preserva o comportamento antigo -- não
  // piora nada, só ainda não corrige.
  const fraseDoSelo = promessasDeFrete
    ? fraseDoSeloDeFreteGratis(promessasDeFrete, product.freeShipping)
    : product.freeShipping
      ? "Frete Grátis"
      : null;

  const [cartStatus, setCartStatus] = useState<"idle" | "loading" | "success">(
    "idle",
  );

  // ── Escolha de opções no próprio card ──────────────────────────────────
  // Mesmas regras da página de produto (ProductView): só variantes ATIVAS
  // agrupadas por `name`; preço = último `priceOverride` da escolha (`??`
  // para override ZERO ser um preço de verdade); estoque = menor
  // `stockIncrement` das escolhidas. Map em vez de Record: objeto indexado
  // por variável é o warning `security/detect-object-injection` que o teto
  // do lint reprova — e Map é a estrutura certa para a escolha.
  const [folhaOpcoesAberta, setFolhaOpcoesAberta] = useState(false);
  const [selecionadas, setSelecionadas] = useState<Map<string, string>>(
    () => new Map(),
  );
  // ── Quantidade na folha (peça 18, 14/09 — pedido do dono) ──────────────
  // Mínimo 1; teto = estoque do item escolhido (`estoqueAtual`, o menor
  // stockIncrement da escolha) — o mesmo número que os selos da folha
  // anunciam. O seletor da casa (QuantitySelector, o da página do produto)
  // já desabilita "+" na borda.
  const [quantidade, setQuantidade] = useState(1);
  // Foto grande da folha: é dela que a bolinha do voo até o carrinho parte
  // (pedido do dono: "arrasta aquela bolinha do ícone do produto"). A folha
  // já disparava o MESMO trigger do card, mas a partir do CTA do rodapé —
  // que fica colado no carrinho na base da tela, um pulo curto que o olho
  // não pega. Partir da foto devolve o voo inteiro, igual ao caminho do card.
  const imagemDaFolhaRef = useRef<HTMLDivElement>(null);

  // ── Arrasto da alça da folha (peça 03, 13/09 — pedido do dono ao vivo) ──
  // Puxar a barrinha para baixo arrasta a folha junto; soltar além de 64px
  // fecha, soltar antes devolve ao lugar. Os listeners de move/up moram na
  // JANELA (não em setPointerCapture): o gesto continua mesmo com o dedo
  // saindo da alça, e dispensa API que o jsdom não tem. O clique simples é
  // outro caminho (onClick); depois de um arrasto de verdade o clique
  // sintético do navegador é engolido (`movimentou`) para um arrasto curto
  // que voltou ao lugar não fechar por acidente.
  const arrastoDaAlcaRef = useRef({ y: 0, ativo: false, movimentou: false });
  // A guarda `movimentou` (clique sintético pós-arrasto) só era limpa no
  // próximo pointerdown — mas ativação por TECLADO (Enter/Espaço num button)
  // dispara click SEM pointerdown: logo depois de um arrasto-que-fechou,
  // reabrir a folha e dar Enter na alça era engolido na primeira tentativa.
  // Limpar o marcador quando a folha ABRE cobre todos os caminhos de
  // abertura; o arrasto corrente dentro da sessão continua guardado.
  useEffect(() => {
    if (folhaOpcoesAberta) arrastoDaAlcaRef.current.movimentou = false;
  }, [folhaOpcoesAberta]);
  const aoPuxarAlcaDaFolha = (e: React.PointerEvent<HTMLButtonElement>) => {
    const folhaEl = e.currentTarget.closest<HTMLElement>(
      '[data-slot="sheet-content"]',
    );
    if (!folhaEl) return;
    arrastoDaAlcaRef.current = { y: e.clientY, ativo: true, movimentou: false };
    // A folha segue o dedo SEM transição — a classe base carrega
    // `transition` para abrir/fechar, e durante o arrasto ela viraria atraso.
    folhaEl.style.transition = "none";
    const aoMover = (ev: PointerEvent) => {
      if (!arrastoDaAlcaRef.current.ativo) return;
      const dy = Math.max(0, ev.clientY - arrastoDaAlcaRef.current.y);
      if (dy > 8) arrastoDaAlcaRef.current.movimentou = true;
      folhaEl.style.transform = `translateY(${dy}px)`;
    };
    const aoSoltar = (ev: PointerEvent) => {
      window.removeEventListener("pointermove", aoMover);
      window.removeEventListener("pointerup", aoSoltar);
      window.removeEventListener("pointercancel", aoSoltar);
      arrastoDaAlcaRef.current.ativo = false;
      // Limpa o transform ANTES de fechar para a animação de saída
      // (slide-out-to-bottom) partir do lugar certo.
      folhaEl.style.transition = "";
      folhaEl.style.transform = "";
      const dy = ev.clientY - arrastoDaAlcaRef.current.y;
      if (dy > 64) setFolhaOpcoesAberta(false);
    };
    window.addEventListener("pointermove", aoMover);
    window.addEventListener("pointerup", aoSoltar);
    window.addEventListener("pointercancel", aoSoltar);
  };

  const variantGroups = useMemo(() => {
    const grupos = new Map<string, ProductVariant[]>();
    product.variants?.forEach((v) => {
      if (!v.active) return;
      const lista = grupos.get(v.name);
      if (lista) lista.push(v);
      else grupos.set(v.name, [v]);
    });
    return grupos;
  }, [product.variants]);
  const temGruposDeOpcao = variantGroups.size > 0;

  const selecionadasObjs = Array.from(selecionadas)
    .map(([nome, valor]) =>
      product.variants?.find((v) => v.name === nome && v.value === valor),
    )
    .filter(Boolean) as ProductVariant[];

  const precoAtual = selecionadasObjs.reduce(
    (acc, v) => v?.priceOverride ?? acc,
    product.price,
  );
  const estoqueAtual = temGruposDeOpcao
    ? selecionadasObjs.length > 0
      ? Math.min(...selecionadasObjs.map((v) => v?.stockIncrement || 0))
      : product.stock
    : product.stock;
  const imagemDaVariante = selecionadasObjs.find((v) => v?.imageUrl)?.imageUrl;
  const srcImagem = imagemDaVariante || product.images[0];

  const escolhaCompleta =
    selecionadas.size >= variantGroups.size &&
    Array.from(variantGroups.keys()).every((nome) => selecionadas.has(nome));

  // A quantidade nunca passa do estoque do item VIVO: trocar a variação com
  // quantidade 5 na mão para uma com estoque 3 tem que descer para 3 — sem
  // isso o CTA entregaria pedido acima do que existe (o CartContext corta,
  // mas o seletor da folha não podia nem oferecer).
  useEffect(() => {
    setQuantidade((atual) => Math.min(atual, Math.max(estoqueAtual, 1)));
  }, [estoqueAtual]);

  // Loja recém-criada ou produto com variantes cadastradas mas TODAS sem
  // estoque: sem isso a folha abre só com chips riscados e nada pode ser
  // escolhido -- a única saída seria fechar, o que parece a tela travada com
  // o card coberto pela folha.
  const nenhumaOpcaoDisponivel =
    temGruposDeOpcao &&
    Array.from(variantGroups.values()).every((valores) =>
      valores.every((v) => (v.stockIncrement ?? 0) <= 0),
    );

  // Safely determine if this specific card should have the view transition name applied.
  // We apply it strictly to the clicked instance (via activeTransitionCardId) to avoid duplicate transition names.
  let shouldApplyTransitionName = false;
  if (isViewTransitionSupported && selectedProductId === product.id) {
    if (activeTransitionCardId === instanceId) {
      shouldApplyTransitionName = true;
    }
  }

  // O card não pode deixar comprar sem escolher a variação.
  // Com a prop `onAddToCartWithVariants`, o botão ABRE a folha de opções —
  // a escolha acontece ali, sem sair da vitrine. Sem a prop, leva para a
  // tela do produto, que é onde a escolha é obrigatória (ProductView.tsx).
  // Sem isso o pedido nascia com `variant_id = NULL` no banco, cobrando o
  // preço do produto (ignorando `price_override`) e decrementando só
  // `produtos.estoque`, nunca a variação escolhida.
  const hasActiveVariant = product.variants?.some((v) => v.active) ?? false;

  const handleAddToCartClick = (e: React.MouseEvent) => {
    e.stopPropagation();

    // Card inteligente (folha, 13/09): o botão do card SÓ ABRE a folha — a
    // escolha e o "Adicionar" moram no rodapé dela. O rótulo do botão do
    // card é sempre "Escolher opções".
    if (hasActiveVariant && onAddToCartWithVariants) {
      if (estoqueAtual <= 0 || cartStatus !== "idle") return;
      setFolhaOpcoesAberta(true);
      return;
    }

    if (hasActiveVariant) {
      onClick(product.id);
      return;
    }

    if (cartStatus !== "idle") return;

    setCartStatus("loading");

    if (onAddToCart) {
      onAddToCart(product, e);
    }

    const startEl = (e.currentTarget as HTMLElement) || document.body;
    triggerFlyingCartAnimation(startEl, product.images[0]);

    const idLoading = window.setTimeout(() => {
      setCartStatus("success");
      const idSuccess = window.setTimeout(() => {
        setCartStatus("idle");
      }, 1500);
      timersRef.current.push(idSuccess);
    }, 600);
    timersRef.current.push(idLoading);
  };

  const handleAdicionarComOpcoes = (e: React.MouseEvent) => {
    if (cartStatus !== "idle") return;
    if (estoqueAtual <= 0) return;

    // Mesma exigência da página de produto: TODOS os grupos de opção
    // precisam de uma escolha antes do carrinho — e a mensagem diz qual
    // falta, pelo mesmo motivo de lá.
    const faltando = Array.from(variantGroups.keys()).filter(
      (grupo) => !selecionadas.get(grupo),
    );
    if (faltando.length > 0) {
      const artigoEOpcao =
        faltando.length === 1 ? "a opção de" : "as opções de";
      toast.warning("Falta escolher", {
        description: `Escolha ${artigoEOpcao} ${faltando.join(", ")} antes de adicionar ao carrinho.`,
      });
      return;
    }

    const variantId = selecionadasObjs[0]?.id;
    const variantNames = Array.from(selecionadas)
      .map(([nome, valor]) => `${nome}: ${valor}`)
      .join(", ");
    const imgSrc = imagemDaVariante || product.images?.[0] || "";

    setCartStatus("loading");
    // Peça 18 (14/09): o MESMO trigger de voo do caminho do card, agora
    // partindo da FOTO da folha (o "ícone do produto" do pedido do dono) —
    // antes partia do CTA do rodapé, colado no carrinho, e o voo era um
    // pulo invisível na base da tela. Fallback: sem foto medida, o CTA.
    triggerFlyingCartAnimation(
      imagemDaFolhaRef.current ?? (e.currentTarget as HTMLElement),
      imgSrc,
    );
    onAddToCartWithVariants?.(
      product,
      variantId,
      variantNames,
      // Defesa na origem: quantity nunca acima do estoque do item (o
      // CartContext corta de novo, do lado de lá).
      Math.min(quantidade, estoqueAtual),
    );

    // PEÇA 18 (14/09 — novo pedido do dono, que REVOGOU a decisão de
    // 12/09): depois do "Salvo!" a folha FECHA sozinha. O fecho é pelo
    // mecanismo de sempre da folha (setFolhaOpcoesAberta — alça, clique
    // fora, Escape e guardião do sheet.tsx seguem intactos). A escolha de
    // variação continua viva no card (reabrir mantém; ver teste irmão), e a
    // quantidade volta a 1 — pedido novo começa do um.
    const idLoading = window.setTimeout(() => {
      setCartStatus("success");
      // 700 ms de "Salvo!" visível: o voo (750 ms) já aterrissou e o olho
      // registra a confirmação antes da folha deslizar para fora.
      const idFechar = window.setTimeout(() => {
        setCartStatus("idle");
        setQuantidade(1);
        setFolhaOpcoesAberta(false);
      }, 700);
      timersRef.current.push(idFechar);
    }, 600);
    timersRef.current.push(idLoading);
  };

  // Tocar num chip ativo DESELECIONA (toggle) -- mesma semântica de sempre.
  // Sem stopPropagation aqui: quem para o clique de borbulhar é o CONTEÚDO
  // da folha (SheetContent, ver comentário lá) -- um stopPropagation só, no
  // portão de entrada, cobre chips, CTA e o que mais nascer dentro dela.
  const alternarOpcao = (nome: string, valor: string) => {
    setSelecionadas((antes) => {
      const depois = new Map(antes);
      if (depois.get(nome) === valor) {
        depois.delete(nome);
      } else {
        depois.set(nome, valor);
      }
      return depois;
    });
  };

  // Uma função só, chamada pelo wrapper (clique/toque em área vazia) e pelo
  // botão do nome (clique + Enter/Espaço, de graça por ser <button> nativo)
  // -- haptic (não há aqui), activeTransitionCardId, view-transition-name e
  // onClick(product.id) acontecem exatamente UMA vez por abertura, venha ela
  // de onde vier.
  const abrirProduto = () => {
    activeTransitionCardId = instanceId;
    if (isViewTransitionSupported) {
      // Só IMAGENS: é o único nome que troca de dono entre telas
      // ("product-image"). O seletor largo `img, [style*=...]` que existia
      // aqui roubava o nome da BottomNav e do Header no clique — a metade
      // restante do pisca consertado no useViewTransition (02/09).
      document.querySelectorAll<HTMLElement>("img").forEach((el) => {
        el.style.removeProperty("view-transition-name");
      });
      // `ref` do CARD, não `e.currentTarget`: o clique pode vir do botão do
      // nome, que não tem <img> dentro dele.
      const img = cardRef.current?.querySelector("img");
      if (img) {
        img.style.setProperty("view-transition-name", "product-image");
      }
    }
    onClick(product.id);
  };

  return (
    // B3 (laudo de acessibilidade, 08/09): este wrapper é INTENCIONALMENTE
    // um div não-interativo (sem role/tabIndex) -- o teclado é servido pelo
    // <button> do nome, logo abaixo. O `onClick` aqui cobre só mouse/toque
    // em área vazia do card; o eslint-disable é o mesmo padrão já usado em
    // AdminWhatsAppConfigView.tsx para overlay clicável sem foco próprio.
    // Desde o redesenho de 13/09 este clique volta a ser SÓ `abrirProduto`:
    // com a folha aberta é o overlay dela que recebe o toque fora (e fecha
    // a folha), nunca este wrapper -- o ramo que fechava o painel aqui
    // morreu com o painel.
    // eslint-disable-next-line jsx-a11y/click-events-have-key-events, jsx-a11y/no-static-element-interactions
    <div
      ref={cardRef}
      onClick={abrirProduto}
      onMouseEnter={() => {
        prefetchImage(imagemRedimensionada(srcImagem, { width: 640 }));
        if (onMouseEnter) onMouseEnter(product.id);
      }}
      onTouchStart={() => {
        // Laudo 0109 (C1): o prefetch baixava a ORIGINAL em paralelo com a
        // variante redimensionada que o LazyImage já baixava — download
        // duplo no toque. 640 é o `src` padrão que o LazyImage deste card
        // pede; a guarda de rede lenta segue dentro do prefetchImage.
        prefetchImage(imagemRedimensionada(srcImagem, { width: 640 }));
        if (onTouchStart) onTouchStart(product.id);
      }}
      className={cn(
        // Bug relatado pelo Gabriel (12/09): o painel "Escolha as opções"
        // crescia DENTRO do fluxo do card e empurrava o resto para baixo --
        // a grade de 2 colunas (align-items: stretch por padrão) esticava o
        // card VIZINHO da mesma linha para casar essa altura, e o `mt-auto`
        // do bloco de preço absorvia o espaço extra como uma faixa em
        // branco entre o estoque e o preço/botão.
        //
        // A correção de 12/09 tirou o painel do FLUXO (virou camada
        // `absolute` sobre a faixa foto+meta) e devolveu `h-full`/`flex-1`.
        // O redesenho de 13/09 (folha que desliza de baixo, direção B
        // escolhida pelo Gabriel) tornou a garantia ESTRUTURAL: a escolha
        // não é mais descendente do card -- a folha renderiza em portal,
        // fora desta árvore, e abrir as opções não insere nenhum nó aqui.
        // As classes ficam: a altura de conteúdo do card não muda com a
        // folha aberta, só o efeito estático normal de grid (nome de 1
        // linha vs. 2 linhas), que sempre existiu e nunca foi o bug.
        "group bg-zinc-50/30 rounded-[2rem] overflow-hidden hover:-translate-y-2 hover:shadow-[0_20px_40px_-15px_rgba(0,0,0,0.05)] hover:bg-white transition-[transform,box-shadow,background-color] duration-300 ease-out cursor-pointer border border-zinc-200/60 flex h-full flex-1 flex-col relative active:scale-[0.98] gpu-accelerated",
        className,
      )}
    >
      {/* Foto + metadados: faixa que o painel de opções cobria até 13/09;
          hoje a folha é portal e nada a cobre -- o preço e o botão de ação
          continuam no bloco seguinte, fora daqui. O `relative` ancora o
          botão de favoritar (absolute) a esta caixa de foto. */}
      <div className="relative">
        {/* Image Container */}
        <div className="relative aspect-[4/5] overflow-hidden bg-slate-50">
          <LazyImage
            src={srcImagem}
            alt={product.name}
            className="size-full object-cover transition-transform duration-1000 ease-out group-hover:scale-105"
            priority={priority}
            // Grade de 2 colunas no celular, card fixo a partir do tablet.
            sizes="(min-width: 640px) 280px, 50vw"
            style={
              shouldApplyTransitionName
                ? { viewTransitionName: "product-image" }
                : undefined
            }
          />

          {/* Action Buttons */}
          <div className="absolute right-3 top-3 flex translate-x-0 flex-col gap-2 opacity-100 transition-all duration-500 ease-out hover-hover:translate-x-12 hover-hover:opacity-0 hover-hover:group-hover:translate-x-0 hover-hover:group-hover:opacity-100">
            <button
              onClick={(e) => {
                e.stopPropagation();
                onToggleFavorite(product, e);
              }}
              aria-label={rotuloDeFavoritar(product.name, isFavorite)}
              title={rotuloDeFavoritar(product.name, isFavorite)}
              className={cn(
                "p-2.5 rounded-full glass transition-all active:scale-75",
                isFavorite
                  ? "bg-red-500 text-white border-red-500/20 shadow-lg shadow-red-200/50"
                  : "text-slate-600 hover:text-red-500",
              )}
            >
              <Heart
                className={cn(
                  "size-4",
                  isFavorite && "fill-current animate-heart-pop",
                )}
              />
            </button>
          </div>
        </div>

        {/* Meta: categoria, nome, avaliação/estoque */}
        <div className="space-y-0.5 p-2.5 pb-1">
          <div className="flex flex-wrap items-center gap-1.5">
            <p className="max-w-[80%] truncate text-[9px] font-bold uppercase tracking-widest text-slate-400">
              {product.category}
            </p>
            {/* ProductCard-520: o selo só pode afirmar o que a loja
                realmente dá -- `product.freeShipping` sozinho não basta
                mais, porque só vale dentro do preset "por_produto" (ou em
                "sempre", que vale para qualquer produto). Fora disso é
                marcação de campanha antiga que a loja já desligou. A
                promessa por valor de compra mora no `FreeShippingBlock`
                (Home), que compara contra o carrinho de verdade. */}
            {fraseDoSelo && (
              <div className="flex shrink-0 items-center gap-1 rounded-md border border-emerald-100/50 bg-emerald-50 px-1.5 py-0.5 text-[8px] font-black text-emerald-800">
                <Truck className="animate-bounce-subtle size-2.5 shrink-0" />
                <span className="truncate">{fraseDoSelo}</span>
              </div>
            )}
          </div>
          {/* B3 (laudo de acessibilidade, 08/09): o wrapper do card deixou
              de ser `role="button"` -- o nome vira o ÚNICO alvo focável, um
              <button> nativo dentro do <h3> (nome acessível = nome do
              produto, ativação por Enter/Espaço de graça). O
              `stopPropagation` evita abrir o produto duas vezes (o clique
              bolhando pro wrapper, que também tem onClick). */}
          <h3>
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                abrirProduto();
              }}
              className="line-clamp-2 w-full text-left text-[13px] font-black leading-tight text-slate-900 transition-colors duration-300 group-hover:text-primary sm:text-[14px]"
            >
              {product.name}
            </button>
          </h3>
          <div className="flex flex-wrap items-center gap-2 pt-0.5">
            {/* LOJA-01 (auditoria 26/08/2026): `produtos.rating` nasce com
                DEFAULT 5 e nada recalcula esse campo a partir das
                avaliações -- sem `reviewCount > 0` não existe avaliação de
                verdade por trás do número, e mostrar a estrela seria
                inventar nota. Calcular a nota certa é outra tarefa
                (migration com gatilho); esta só impede a mentira. */}
            {showRating && (product.reviewCount ?? 0) > 0 && (
              <StarRating rating={product.rating ?? 0} size={11} />
            )}
            {/*
              ADMIN-091 (#202): com `showRating=false` a linha fica só com o
              indicador de estoque. Em vez de deixar a linha "pobre" (o que
              o plano pediu para evitar), ele ganha mais destaque -- ponto
              maior e texto um degrau maior -- reaproveitando um sinal que o
              card já tinha, em vez de inventar um selo novo.
            */}
            <div
              className={cn(
                "flex items-center gap-1 font-bold",
                showRating ? "text-[9px]" : "text-[10px]",
              )}
            >
              <span
                className={cn(
                  "rounded-full animate-pulse",
                  showRating ? "w-1 h-1" : "w-1.5 h-1.5",
                  estoqueAtual <= 0
                    ? "bg-zinc-400"
                    : estoqueAtual <= 5
                      ? "bg-rose-500"
                      : "bg-emerald-500",
                )}
              />
              <span
                className={
                  estoqueAtual <= 0
                    ? "text-zinc-500"
                    : estoqueAtual <= 5
                      ? "text-rose-600"
                      : "text-emerald-700"
                }
              >
                {estoqueAtual <= 0
                  ? "Esgotado"
                  : estoqueAtual <= 5
                    ? `Apenas ${estoqueAtual} restam!`
                    : `Estoque: ${estoqueAtual}`}
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* Preço + botão: ficam fora do bloco foto+meta acima, sempre
          visíveis e clicáveis. Com a folha em portal (13/09) nada os cobre
          nunca mais -- e o PREÇO continua dinâmico: reflete o
          `priceOverride` da escolha feita na folha, que é a promessa do
          card inteligente. */}
      <div className="flex flex-1 flex-col gap-0.5 p-2.5 pt-1">
        {/* Price */}
        <div className="mt-auto flex w-full items-end justify-between gap-2 pt-1">
          <div className="flex flex-col justify-end">
            {/* Preço DINÂMICO: com variação escolhida no card, mostra o
                priceOverride da escolha (mesma semântica da página do
                produto: `??` preserva override zero). */}
            {product.originalPrice && product.originalPrice > precoAtual ? (
              <div className="flex flex-col">
                <span className="text-[9px] font-bold uppercase leading-none tracking-wider text-slate-400">
                  De:{" "}
                  <span className="line-through">
                    {formatCurrency(product.originalPrice)}
                  </span>
                </span>
                <span className="mt-1 text-[15px] font-black leading-none tracking-tight text-rose-600">
                  Por: {formatCurrency(precoAtual)}
                </span>
              </div>
            ) : (
              <div className="flex flex-col">
                <span className="text-[15px] font-black leading-none tracking-tight text-slate-900">
                  {formatCurrency(precoAtual)}
                </span>
              </div>
            )}
          </div>

          {/* Badges */}
          <div className="flex shrink-0 items-center gap-1">
            {discount > 0 && (
              <span className="shrink-0 select-none rounded border border-rose-100 bg-rose-50 px-1.5 py-0.5 text-[8px] font-black uppercase tracking-wider text-rose-700">
                {discount}% OFF
              </span>
            )}
            {product.isBestseller && (
              <span className="flex shrink-0 select-none items-center gap-0.5 rounded border border-amber-100 bg-amber-50 px-1.5 py-0.5 text-[8px] font-black uppercase tracking-wider text-amber-700">
                <Flame className="size-2.5 shrink-0 fill-orange-500/20 text-orange-500" />
                <span>EM ALTA</span>
              </span>
            )}
          </div>
        </div>

        {/* Action Button: com variação, o rótulo é SEMPRE "Escolher opções"
            (13/09) -- ele só abre a folha; os estados de salvamento
            ("Salvando..."/"Salvo!") e o rótulo de valor moram no CTA do
            rodapé da folha. Peça 09 (14/09): SEM chevron/setinha — pedido
            do dono; o estado aberto/fechado é visível na própria folha. */}
        <div className="mt-1.5">
          <button
            data-testid="product-card-action"
            onClick={handleAddToCartClick}
            disabled={estoqueAtual <= 0 || cartStatus !== "idle"}
            className={cn(
              "w-full py-2 px-3 rounded-xl text-[10px] font-black uppercase tracking-wider transition-all duration-150 active:scale-95 shadow-[0_4px_10px_rgba(24,24,27,0.1)] flex items-center justify-center gap-1.5",
              estoqueAtual <= 0
                ? "bg-zinc-100 text-zinc-400 cursor-not-allowed shadow-none"
                : cartStatus === "success"
                  ? "bg-emerald-600 hover:bg-emerald-700 text-white"
                  : "bg-primary hover:opacity-90 text-primary-foreground",
            )}
          >
            {cartStatus === "loading" && (
              <Loader2 className="size-3 shrink-0 animate-spin" />
            )}
            {cartStatus === "success" && <Check className="size-3 shrink-0" />}
            {cartStatus === "idle" && estoqueAtual > 0 && (
              <ShoppingCart className="size-3 shrink-0" />
            )}
            <span className="truncate">
              {estoqueAtual <= 0
                ? "Esgotado"
                : hasActiveVariant
                  ? "Escolher opções"
                  : cartStatus === "idle"
                    ? "Carrinho"
                    : cartStatus === "loading"
                      ? "Salvando..."
                      : "Salvo!"}
            </span>
          </button>
        </div>
      </div>

      {/* ── FOLHA DE OPÇÕES (13/09, direção B — mockup do Gabriel) ──────
          Bottom sheet em PORTAL: substitui o painel que expandia dentro do
          card (reprovado pelo dono). A folha NUNCA é descendente do card --
          abrir opções não muda a árvore nem a altura de nada aqui (ver o
          comentário do wrapper raiz). Controlada por estado, sem
          SheetTrigger: o gatilho é o botão do card, que tem handler próprio
          (stopPropagation + abertura de produto para cuidar). Estrutura
          (de cima para baixo): alça visual -- CORPO rolável (foto grande
          que reage à escolha, categoria, título, selos, preço, grupos de
          opção) -- RODAPÉ fixo com o CTA. A rolagem mora no FILHO dedicado
          (overflow-y-auto + overscroll-contain + min-h-0, o mesmo padrão do
          painel antigo), nunca na folha inteira. Foco, Escape, clique fora
          e devolução de foco são do Radix (ver comentário no topo). */}
      {hasActiveVariant && onAddToCartWithVariants && (
        <Sheet open={folhaOpcoesAberta} onOpenChange={setFolhaOpcoesAberta}>
          {/* stopPropagation OBRIGATÓRIO (prova no teste "Adicionar ... sem
              navegar"): eventos sintéticos de conteúdo renderizado em portal
              borbulham pela ÁRVORE REACT, não pela árvore do DOM -- a folha é
              filho React DESTE componente, e o wrapper raiz tem
              onClick={abrirProduto}. Sem isto, tocar num chip ou no CTA da
              folha abriria o produto junto. É a MESMA proteção que o painel
              antigo carregava no motion.div; o portal do DOM sozinho não
              protege (o clique nunca sai do body pelo DOM, mas chega aqui
              pela árvore do React). */}
          <SheetContent
            side="bottom"
            data-testid="product-card-options-sheet"
            onClick={(e) => e.stopPropagation()}
            showCloseButton={false}
            className="mx-auto max-h-[88dvh] gap-0 border-t-0 sm:max-w-md sm:rounded-t-3xl"
          >
            {/* Alça que FECHA (peça 03, 13/09 — pedido do dono ao vivo):
                clicar nela fecha a folha; arrastar para baixo também
                (handler acima). Peça 09 (14/09): o X embutido do SheetContent
                saiu (showCloseButton={false}, pedido do dono) — esta alça é o
                ÚNICO botão de fechar e carrega sozinha o anúncio de leitor de
                tela que o X fazia ("Fechar"), mais o gesto ("arraste para
                baixo"). Botão real com área de toque generosa (h-11 = 44px,
                alvo de toque WCAG 2.5.5) — o desenho continua sendo o risco
                fino DENTRO dele. */}
            <button
              type="button"
              data-testid="product-card-options-handle"
              aria-label="Fechar (arraste para baixo)"
              onClick={() => {
                if (arrastoDaAlcaRef.current.movimentou) {
                  arrastoDaAlcaRef.current.movimentou = false;
                  return;
                }
                setFolhaOpcoesAberta(false);
              }}
              onPointerDown={aoPuxarAlcaDaFolha}
              className="focus:outline-hidden mt-3 flex h-11 w-full shrink-0 cursor-pointer touch-none items-center justify-center rounded-full focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
            >
              <span
                aria-hidden="true"
                className="h-1 w-10 rounded-full bg-zinc-300"
              />
            </button>
            <div
              data-testid="product-card-options-scroll"
              className="min-h-0 flex-1 space-y-4 overflow-y-auto overscroll-contain px-5 pb-4 pt-2"
            >
              <SheetDescription className="sr-only">
                Escolha as opções para adicionar ao carrinho.
              </SheetDescription>
              {/* Banda de FOTO grande (a promessa da direção B: a foto da
                  folha era MENOR que a do card atrás no thumbnail antigo e
                  viciava a comparação -- 104x130 vs 165x206, medido 13/09).
                  Reage à variante escolhida via `srcImagem`. Peça 18 (14/09):
                  o wrapper com ref é a âncora do VOO até o carrinho — é daqui
                  que a bolinha parte quando o CTA entrega (mesmo trigger do
                  caminho do card, triggerFlyingCartAnimation). */}
              <div
                ref={imagemDaFolhaRef}
                data-testid="product-card-options-image"
              >
                <LazyImage
                  src={srcImagem}
                  alt={product.name}
                  priority
                  sizes="(min-width: 640px) 448px, 100vw"
                  className="h-44 w-full rounded-2xl"
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400">
                  {product.category}
                </p>
                <SheetTitle className="text-base font-black tracking-tight text-slate-900">
                  {product.name}
                </SheetTitle>
                <div className="flex flex-wrap items-center gap-1.5">
                  {/* Os MESMOS selos do card -- a folha não inventa
                      promessa que o card não faz. */}
                  {discount > 0 && (
                    <span className="shrink-0 select-none rounded border border-rose-100 bg-rose-50 px-1.5 py-0.5 text-[8px] font-black uppercase tracking-wider text-rose-700">
                      {discount}% OFF
                    </span>
                  )}
                  {product.isBestseller && (
                    <span className="flex shrink-0 select-none items-center gap-0.5 rounded border border-amber-100 bg-amber-50 px-1.5 py-0.5 text-[8px] font-black uppercase tracking-wider text-amber-700">
                      <Flame className="size-2.5 shrink-0 fill-orange-500/20 text-orange-500" />
                      <span>EM ALTA</span>
                    </span>
                  )}
                  {fraseDoSelo && (
                    <span className="flex shrink-0 select-none items-center gap-0.5 rounded border border-emerald-100/50 bg-emerald-50 px-1.5 py-0.5 text-[8px] font-black text-emerald-800">
                      <Truck className="animate-bounce-subtle size-2.5 shrink-0" />
                      <span>{fraseDoSelo}</span>
                    </span>
                  )}
                  {/* Indicador de estoque: os MESMOS literais do card,
                      agora reagindo à escolha na folha também. */}
                  <span
                    className={cn(
                      "flex items-center gap-1 font-bold text-[9px]",
                      estoqueAtual <= 0
                        ? "text-zinc-500"
                        : estoqueAtual <= 5
                          ? "text-rose-600"
                          : "text-emerald-700",
                    )}
                  >
                    <span
                      className={cn(
                        "w-1 h-1 rounded-full animate-pulse",
                        estoqueAtual <= 0
                          ? "bg-zinc-400"
                          : estoqueAtual <= 5
                            ? "bg-rose-500"
                            : "bg-emerald-500",
                      )}
                    />
                    {estoqueAtual <= 0
                      ? "Esgotado"
                      : estoqueAtual <= 5
                        ? `Apenas ${estoqueAtual} restam!`
                        : `Estoque: ${estoqueAtual}`}
                  </span>
                </div>
                {/* Preço De/Por DINÂMICO na folha (mesma semântica do
                    card: `??` preserva override zero). */}
                {product.originalPrice && product.originalPrice > precoAtual ? (
                  <div className="flex flex-wrap items-baseline gap-2 pt-1">
                    <span className="text-[15px] font-black leading-none tracking-tight text-rose-600">
                      Por: {formatCurrency(precoAtual)}
                    </span>
                    <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400">
                      De:{" "}
                      <span className="line-through">
                        {formatCurrency(product.originalPrice)}
                      </span>
                    </span>
                  </div>
                ) : (
                  <div className="pt-1">
                    <span className="text-[15px] font-black leading-none tracking-tight text-slate-900">
                      {formatCurrency(precoAtual)}
                    </span>
                  </div>
                )}
              </div>

              {/* Grupos de opção: MESMA semântica do painel antigo (chips
                  com aria-pressed, disabled + title quando sem estoque,
                  line-through/opacidade), com folga maior de toque porque
                  a folha tem largura de tela inteira. */}
              {nenhumaOpcaoDisponivel ? (
                <p className="py-4 text-center text-[11px] font-bold uppercase tracking-wide text-zinc-400">
                  Sem opções disponíveis no momento.
                </p>
              ) : (
                Array.from(variantGroups).map(([nome, valores]) => (
                  <div key={nome} className="space-y-2">
                    <span className="text-[10px] font-black uppercase tracking-widest text-zinc-500">
                      {nome}
                    </span>
                    <div className="flex flex-wrap gap-2">
                      {valores.map((v) => {
                        const semEstoque = (v.stockIncrement ?? 0) <= 0;
                        const ativa = selecionadas.get(nome) === v.value;
                        return (
                          <button
                            key={v.id}
                            type="button"
                            disabled={semEstoque}
                            // Laudo de acessibilidade 03/09, achado 3: a
                            // opção marcada só se distinguia pela cor —
                            // `aria-pressed` anuncia o estado (padrão do
                            // CategoryFilter).
                            aria-pressed={ativa}
                            onClick={() => alternarOpcao(nome, v.value)}
                            title={
                              semEstoque
                                ? `${v.value} — sem estoque`
                                : undefined
                            }
                            className={cn(
                              "min-h-[40px] rounded-xl border px-3 py-1.5 text-[11px] font-black uppercase tracking-wide transition-all active:scale-95",
                              ativa
                                ? "border-zinc-900 bg-zinc-900 text-white shadow-sm"
                                : "border-zinc-200 bg-white text-zinc-600 hover:border-zinc-400 hover:text-zinc-900",
                              semEstoque &&
                                "cursor-not-allowed line-through opacity-40 hover:border-zinc-200 hover:text-zinc-600",
                            )}
                          >
                            {v.value}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                ))
              )}

              {/* ── QUANTIDADE (peça 18, 14/09 — pedido do dono) ──────────
                  Seletor da casa (o mesmo da página do produto): mínimo 1,
                  teto = estoque do item escolhido (o número que os selos
                  desta folha já anunciam). "+"/"−" desabilitam nas bordas.
                  Some só quando não há nada em estoque para escolher. */}
              {estoqueAtual > 0 && (
                <div className="space-y-2">
                  <span className="text-[10px] font-black uppercase tracking-widest text-zinc-500">
                    Quantidade
                  </span>
                  <div>
                    <QuantitySelector
                      quantity={quantidade}
                      maxQuantity={Math.max(estoqueAtual, 1)}
                      onChange={setQuantidade}
                    />
                  </div>
                </div>
              )}
            </div>

            {/* Rodapé FIXO: o CTA nunca rola para fora da folha. Padding
                inferior soma a área segura do aparelho (mesma variável
                --safe-area-bottom que os rodapés da casa usam). */}
            <div className="shrink-0 border-t border-zinc-100 bg-background px-5 pb-[calc(0.75rem+var(--safe-area-bottom,env(safe-area-inset-bottom,0px)))] pt-3">
              <button
                type="button"
                data-testid="product-card-options-add"
                onClick={handleAdicionarComOpcoes}
                disabled={cartStatus !== "idle"}
                className={cn(
                  "flex h-12 w-full items-center justify-center gap-2 rounded-xl text-[11px] font-black uppercase tracking-wider transition-all duration-150 active:scale-[0.98] shadow-[0_4px_10px_rgba(24,24,27,0.1)]",
                  cartStatus === "success"
                    ? "bg-emerald-600 hover:bg-emerald-700 text-white"
                    : "bg-primary hover:opacity-90 text-primary-foreground",
                  cartStatus === "loading" && "opacity-80",
                )}
              >
                {cartStatus === "loading" && (
                  <Loader2 className="size-4 shrink-0 animate-spin" />
                )}
                {cartStatus === "success" && (
                  <Check className="size-4 shrink-0" />
                )}
                <span className="truncate">
                  {cartStatus === "loading"
                    ? "Salvando..."
                    : cartStatus === "success"
                      ? "Salvo!"
                      : escolhaCompleta
                        ? `Adicionar · ${formatCurrency(precoAtual)}`
                        : "Adicionar"}
                </span>
              </button>
            </div>
          </SheetContent>
        </Sheet>
      )}
    </div>
  );
});
