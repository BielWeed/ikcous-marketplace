import { LazyImage } from "@/components/LazyImage";
import { usePrefetchOnHover } from "@/hooks/usePrefetchOnHover";
import { isViewTransitionSupported } from "@/hooks/useViewTransition";
import { imagemRedimensionada } from "@/lib/imageUrl";
import { rotuloDeFavoritar } from "@/lib/rotulo-favoritar";
import { cn, formatCurrency } from "@/lib/utils";
import type { Product, ProductVariant } from "@/types";
import { triggerFlyingCartAnimation } from "@/utils/cartAnimation";
import { AnimatePresence, motion } from "framer-motion";
import {
  Check,
  ChevronDown,
  Flame,
  Heart,
  Loader2,
  ShoppingCart,
  Truck,
  X,
} from "lucide-react";
import { memo, useEffect, useId, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { StarRating } from "./StarRating";

interface ProductCardProps {
  product: Product;
  isFavorite: boolean;
  onToggleFavorite: (product: Product, e: React.MouseEvent) => void;
  onAddToCart?: (product: Product, e: React.MouseEvent) => void;
  onQuickBuy?: (product: Product, e: React.MouseEvent) => void;
  /**
   * Card inteligente (pedido do Gabriel, 02/09): presente, o botão "Escolher
   * opções" EXPANDE as variações no próprio card — preço e imagem reagem à
   * escolha — e "Adicionar" entrega a variação escolhida. Ausente, o botão
   * leva para a tela do produto (comportamento de sempre, retrocompatível).
   * Assinatura igual ao `handleAddToCart` do App com quantity fixo em 1.
   */
  onAddToCartWithVariants?: (
    product: Product,
    variantId: string | undefined,
    variantNames: string,
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
  // Foco: ao abrir o painel, vai para o X (primeiro controle dele); ao
  // fechar, volta para o botão de ação -- sem isso o painel vira uma camada
  // que aparece por cima da foto sem o teclado/leitor de tela acompanhar
  // (laudos de acessibilidade 03/09 e 08/09). A guarda da primeira
  // renderização existe para NÃO roubar o foco de toda a vitrine no mount
  // (o efeito rodaria uma vez por card, e "toda página abre com foco no
  // botão do último card" seria pior que o problema original).
  const primeiraRenderPainelRef = useRef(true);
  const fecharBtnRef = useRef<HTMLButtonElement>(null);
  const actionBtnRef = useRef<HTMLButtonElement>(null);

  const discount = product.originalPrice
    ? Math.round(
        ((product.originalPrice - product.price) / product.originalPrice) * 100,
      )
    : 0;

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
  const [painelOpcoesAberto, setPainelOpcoesAberto] = useState(false);
  const [selecionadas, setSelecionadas] = useState<Map<string, string>>(
    () => new Map(),
  );

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

  // Loja recém-criada ou produto com variantes cadastradas mas TODAS sem
  // estoque: sem isso o painel abre só com chips riscados e o botão fica
  // preso em "Escolha acima" para sempre -- a única saída seria o X, o que
  // parece a tela travada com o painel cobrindo a foto.
  const nenhumaOpcaoDisponivel =
    temGruposDeOpcao &&
    Array.from(variantGroups.values()).every((valores) =>
      valores.every((v) => (v.stockIncrement ?? 0) <= 0),
    );

  useEffect(() => {
    if (primeiraRenderPainelRef.current) {
      primeiraRenderPainelRef.current = false;
      return;
    }
    if (painelOpcoesAberto) {
      fecharBtnRef.current?.focus();
    } else {
      actionBtnRef.current?.focus();
    }
  }, [painelOpcoesAberto]);

  // Safely determine if this specific card should have the view transition name applied.
  // We apply it strictly to the clicked instance (via activeTransitionCardId) to avoid duplicate transition names.
  let shouldApplyTransitionName = false;
  if (isViewTransitionSupported && selectedProductId === product.id) {
    if (activeTransitionCardId === instanceId) {
      shouldApplyTransitionName = true;
    }
  }

  // O card não pode deixar comprar sem escolher a variação.
  // Com a prop `onAddToCartWithVariants`, o botão EXPANDE as opções no
  // próprio card — a escolha acontece aqui, sem sair da vitrine. Sem a
  // prop, leva para a tela do produto, que é onde a escolha é obrigatória
  // (ProductView.tsx). Sem isso o pedido nascia com `variant_id = NULL` no
  // banco, cobrando o preço do produto (ignorando `price_override`) e
  // decrementando só `produtos.estoque`, nunca a variação escolhida.
  const hasActiveVariant = product.variants?.some((v) => v.active) ?? false;

  const handleAddToCartClick = (e: React.MouseEvent) => {
    e.stopPropagation();

    // Card inteligente: o mesmo botão abre o painel de opções e, com a
    // escolha completa, vira "Adicionar" — o clique final é o
    // `handleAdicionarComOpcoes`, abaixo.
    if (hasActiveVariant && onAddToCartWithVariants) {
      if (estoqueAtual <= 0 || cartStatus !== "idle") return;
      if (!painelOpcoesAberto) {
        setPainelOpcoesAberto(true);
        return;
      }
      handleAdicionarComOpcoes(e);
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
    triggerFlyingCartAnimation(e.currentTarget as HTMLElement, imgSrc);
    onAddToCartWithVariants?.(product, variantId, variantNames);

    // Decisão desta tarefa (não estava no pedido original -- ver relatório):
    // o painel NÃO fecha nem limpa a escolha sozinho depois do "Salvo!".
    // Antes, com o painel no fluxo, o fechamento automático só encolhia o
    // card; como camada sobreposta à foto, fechar sozinho parecia o card
    // "se apagando" sem ninguém ter tocado em nada -- e apagava junto a
    // escolha de quem estava comprando DUAS variações do mesmo produto (P e
    // M, dois sabores), forçando recomeçar do zero. Fechar passa a ser
    // sempre um gesto explícito (X ou tocar fora do painel).
    const idLoading = window.setTimeout(() => {
      setCartStatus("success");
      const idSuccess = window.setTimeout(() => {
        setCartStatus("idle");
      }, 1500);
      timersRef.current.push(idSuccess);
    }, 600);
    timersRef.current.push(idLoading);
  };

  const alternarOpcao = (e: React.MouseEvent, nome: string, valor: string) => {
    e.stopPropagation();
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

  // O painel virou uma camada por cima da foto -- sem isto, tocar fora dele
  // para "fechar" na verdade navegava para a página do produto e descartava
  // a escolha feita (o wrapper raiz sempre teve `onClick={abrirProduto}`).
  // Enquanto o painel está aberto, o clique no fundo do card fecha o painel
  // em vez de abrir o produto; o X e o Escape (dentro do painel) fazem o
  // mesmo.
  const handleWrapperClick = () => {
    if (painelOpcoesAberto) {
      setPainelOpcoesAberto(false);
      return;
    }
    abrirProduto();
  };

  return (
    // B3 (laudo de acessibilidade, 08/09): este wrapper é INTENCIONALMENTE
    // um div não-interativo (sem role/tabIndex) -- o teclado é servido pelo
    // <button> do nome, logo abaixo. O `onClick` aqui cobre só mouse/toque
    // em área vazia do card; o eslint-disable é o mesmo padrão já usado em
    // AdminWhatsAppConfigView.tsx para overlay clicável sem foco próprio.
    // eslint-disable-next-line jsx-a11y/click-events-have-key-events, jsx-a11y/no-static-element-interactions
    <div
      ref={cardRef}
      onClick={handleWrapperClick}
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
        // A correção de 12/09 tira o painel do FLUXO: ele passa a ser uma
        // camada `absolute` sobreposta à faixa foto+meta (ver o wrapper
        // "relative" logo abaixo, antes do bloco de preço/botão), nunca um
        // filho que cresce entre o preço e o botão. Com isso, abrir o
        // painel deixa de mudar a altura de CONTEÚDO do card -- fechado e
        // aberto medem o mesmo tanto (medido no navegador, ver relatório da
        // tarefa). Sendo a altura constante, `h-full`/`flex-1` VOLTAM aqui:
        // a grade pode esticar o card com segurança, porque não existe mais
        // um EVENTO (abrir o painel) que muda essa altura no meio da vida
        // do card -- só o efeito estático normal de grid (nome de 1 linha
        // vs. 2 linhas), que sempre existiu e nunca foi o bug relatado.
        "group bg-zinc-50/30 rounded-[2rem] overflow-hidden hover:-translate-y-2 hover:shadow-[0_20px_40px_-15px_rgba(0,0,0,0.05)] hover:bg-white transition-[transform,box-shadow,background-color] duration-300 ease-out cursor-pointer border border-zinc-200/60 flex h-full flex-1 flex-col relative active:scale-[0.98] gpu-accelerated",
        className,
      )}
    >
      {/* Foto + metadados: bloco que o painel de opções cobre quando aberto
          (ver AnimatePresence logo abaixo) -- nunca o preço nem o botão de
          ação, que ficam no bloco seguinte, fora daqui, sempre visíveis e
          clicáveis. Medido no navegador a 375px (12/09): a foto sozinha
          (aspect-[4/5], ~207px) mal cabia DOIS grupos de variação com a
          fileira de chips atual; foto+meta juntos dão a folga real que o
          caso comum (2 grupos) precisa sem rolar -- ver relatório da
          tarefa. `relative` é o que ancora o painel `absolute` a ESTA faixa,
          não ao card inteiro. */}
      <div className="relative">
        {/* Image Container */}
        {/* Correção da rodada 1 (revisão, 12/09): com o painel aberto esta
            faixa fica coberta por uma camada OPACA (o `motion.div` logo
            abaixo, `bg-white`), mas sem `inert` o botão de favoritar
            continuava focável e na árvore de acessibilidade -- Shift+Tab
            chegava nele invisível, e Enter favoritava o produto sem a
            pessoa ver nada acontecer. `inert` tira foco + árvore de
            acessibilidade + eventos de ponteiro de uma vez, casando com o
            que a camada opaca já faz visualmente (React 19.2 suporta
            `inert` como prop booleana nativa). Nunca no wrapper `relative`
            do pai (que contém o próprio painel) -- inert ali mataria o X e
            os chips. */}
        <div
          className="relative aspect-[4/5] overflow-hidden bg-slate-50"
          inert={painelOpcoesAberto}
        >
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
        {/* Mesma correção acima: com o painel aberto, o <button> do NOME
            (logo abaixo) fica coberto pela camada opaca -- `inert` tira ele
            e a categoria/estoque da árvore de foco e de acessibilidade
            enquanto durar a sobreposição. */}
        <div className="space-y-0.5 p-2.5 pb-1" inert={painelOpcoesAberto}>
          <div className="flex flex-wrap items-center gap-1.5">
            <p className="max-w-[80%] truncate text-[9px] font-bold uppercase tracking-widest text-slate-400">
              {product.category}
            </p>
            {/* O selo só pode afirmar o que é verdade PARA ESTE produto: o
                card não conhece o subtotal do carrinho nem se a cliente
                está logada, então não tem como saber se ela cumpre o
                mínimo da loja (`config.freeShippingMin`) -- só o próprio
                `product.freeShipping` é verdade aqui, sempre. A promessa
                por valor de compra mora no `FreeShippingBlock` (Home). */}
            {product.freeShipping && (
              <div className="flex shrink-0 items-center gap-1 rounded-md border border-emerald-100/50 bg-emerald-50 px-1.5 py-0.5 text-[8px] font-black text-emerald-800">
                <Truck className="animate-bounce-subtle size-2.5 shrink-0" />
                <span className="truncate">Frete Grátis</span>
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

        {/* Painel de opções NO CARD (card inteligente, pedido do Gabriel
            02/09; redesenhado em 12/09 para não empurrar o card -- ver o
            comentário do wrapper raiz). Sobrepõe a faixa foto+meta acima --
            por isso mora aqui no DOM, logo depois da foto: a ordem de
            leitura/Tab bate com a ordem visual (WCAG 1.3.2/2.4.3; laudos de
            acessibilidade 03/09 e 08/09). Anima opacidade/escala, nunca
            altura: o nó está FORA do fluxo (absolute) -- animar `height`
            nele não faz sentido e briga com a rolagem interna. A rolagem
            mora no FILHO dedicado (overflow-y-auto + overscroll-contain),
            nunca no nó que o framer-motion mede -- ver `min-h-0` abaixo
            (sem ele, o filho flex não encolhe para disparar o scroll). O
            stopPropagation impede o clique (e o Enter) de fechar o painel
            via handleWrapperClick, ou de abrir a página do produto,
            enquanto o cliente escolhe. */}
        <AnimatePresence initial={false}>
          {painelOpcoesAberto &&
            hasActiveVariant &&
            onAddToCartWithVariants && (
              <motion.div
                data-testid="product-card-options-panel"
                initial={{ opacity: 0, scale: 0.97 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.97 }}
                transition={{ duration: 0.16, ease: "easeOut" }}
                className="absolute inset-0 z-10 flex flex-col overflow-hidden rounded-b-2xl border border-zinc-200/70 bg-white p-2.5 shadow-lg"
                onClick={(e) => e.stopPropagation()}
                onKeyDown={(e) => {
                  e.stopPropagation();
                  if (e.key === "Escape") {
                    setPainelOpcoesAberto(false);
                  }
                }}
              >
                <div className="flex shrink-0 items-center justify-between gap-2">
                  <div className="flex min-w-0 items-center gap-1.5">
                    {/* Miniatura da imagem ATUAL (produto ou variante
                        escolhida): o painel cobre a foto grande, mas a
                        promessa do card inteligente ("preço e imagem
                        reagem à escolha", docblock de
                        `onAddToCartWithVariants` acima) continua visível
                        aqui -- sem isto, quem escolhe cor nunca veria a
                        foto da cor escolhida, porque o painel fica bem em
                        cima do único lugar onde ela aparecia. */}
                    <img
                      src={imagemRedimensionada(srcImagem, { width: 64 })}
                      alt=""
                      className="size-6 shrink-0 rounded-md object-cover"
                    />
                    <span className="truncate text-[8px] font-black uppercase tracking-widest text-zinc-400">
                      Escolha as opções
                    </span>
                  </div>
                  <button
                    ref={fecharBtnRef}
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      setPainelOpcoesAberto(false);
                    }}
                    aria-label="Fechar opções"
                    className="shrink-0 rounded-lg p-1 text-zinc-400 transition-colors hover:bg-zinc-100 hover:text-zinc-700"
                  >
                    <X className="size-3" />
                  </button>
                </div>

                {/* Filho dedicado à rolagem: o card NUNCA cresce para caber
                    conteúdo -- produto com muitos grupos (cor + tamanho +
                    sabor) rola AQUI dentro, sem esticar o card nem a
                    foto. */}
                <div
                  data-testid="product-card-options-scroll"
                  className="mt-2 min-h-0 flex-1 space-y-2.5 overflow-y-auto overscroll-contain"
                >
                  {nenhumaOpcaoDisponivel ? (
                    <p className="py-4 text-center text-[10px] font-bold uppercase tracking-wide text-zinc-400">
                      Sem opções disponíveis no momento.
                    </p>
                  ) : (
                    Array.from(variantGroups).map(([nome, valores]) => (
                      <div key={nome}>
                        <span className="text-[8px] font-black uppercase tracking-widest text-zinc-500">
                          {nome}
                        </span>
                        <div className="mt-1 flex flex-wrap gap-1.5">
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
                                onClick={(e) => alternarOpcao(e, nome, v.value)}
                                title={
                                  semEstoque
                                    ? `${v.value} — sem estoque`
                                    : undefined
                                }
                                className={cn(
                                  "rounded-xl border px-2.5 py-1 text-[9px] font-black uppercase tracking-wide transition-all active:scale-95",
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
                </div>
              </motion.div>
            )}
        </AnimatePresence>
      </div>

      {/* Preço + botão: NUNCA cobertos pelo painel -- ficam fora do bloco
          foto+meta acima, sempre visíveis e clicáveis mesmo com as opções
          abertas (sem isso, quem escolhe a variação não teria como
          adicionar ao carrinho -- pior que o bug original). */}
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

        {/* Action Button */}
        <div className="mt-1.5">
          <button
            ref={actionBtnRef}
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
            {cartStatus === "idle" &&
              estoqueAtual > 0 &&
              !(painelOpcoesAberto && onAddToCartWithVariants) && (
                <ShoppingCart className="size-3 shrink-0" />
              )}
            <span className="truncate">
              {estoqueAtual <= 0
                ? "Esgotado"
                : painelOpcoesAberto && onAddToCartWithVariants
                  ? cartStatus === "loading"
                    ? "Salvando..."
                    : cartStatus === "success"
                      ? "Salvo!"
                      : escolhaCompleta
                        ? "Adicionar"
                        : "Escolha acima"
                  : hasActiveVariant
                    ? "Escolher opções"
                    : cartStatus === "idle"
                      ? "Carrinho"
                      : cartStatus === "loading"
                        ? "Salvando..."
                        : "Salvo!"}
            </span>
            {hasActiveVariant &&
              onAddToCartWithVariants &&
              estoqueAtual > 0 && (
                <ChevronDown
                  className={cn(
                    "size-3 shrink-0 transition-transform duration-200",
                    painelOpcoesAberto && "rotate-180",
                  )}
                />
              )}
          </button>
        </div>
      </div>
    </div>
  );
});
