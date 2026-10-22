import { LazyImage } from "@/components/LazyImage";
import { Sheet, SheetContent } from "@/components/ui/sheet";
import { usePrefetchOnHover } from "@/hooks/usePrefetchOnHover";
import { isViewTransitionSupported } from "@/hooks/useViewTransition";
import {
  CLASSE_PRECO_PROMOCIONAL_TEXTO_PEQUENO,
  CLASSE_SELO_DESCONTO,
} from "@/lib/cor-do-preco-promocional";
import {
  type PromessasDeFrete,
  fraseDoSeloDeFreteGratis,
} from "@/lib/estrategias-de-frete";
import { imagemRedimensionada } from "@/lib/imageUrl";
import { rotuloDeFavoritar } from "@/lib/rotulo-favoritar";
import { textoEstoqueBaixo } from "@/lib/texto-estoque-baixo";
import { cn, formatCurrency } from "@/lib/utils";
import type { Product, ProductVariant } from "@/types";
import {
  pontoDeSaidaVisivel,
  triggerFlyingCartAnimation,
} from "@/utils/cartAnimation";
import {
  criarEixosDaVariacao,
  disponibilidadeDoValor,
  eixoEhCor,
  escolherValorDoEixo,
  preselecionarCor,
  resolverSelecaoDosEixos,
} from "@/utils/eixos-da-variacao";
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
import { CorpoDaFolhaDeOpcoes, focarEscolhaDaFolha } from "./FolhaDeOpcoes";
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

/**
 * Solta a bolinha do voo até o carrinho a partir da foto do CARD (14/10/2026).
 * Só voa com algo anotado (`imgSrc`), a foto ainda no DOM e `pontoDeSaidaVisivel`
 * (à vista e sem nada por cima): sem ponto de partida confiável a bolinha não
 * voa e fica o "Salvo!". Fora do componente de propósito: não lê nem escreve
 * estado, só medidas do DOM.
 */
function soltarVooDoCard(
  imgSrc: string | null,
  foto: HTMLElement | null,
  card: HTMLElement | null,
) {
  if (imgSrc === null || !foto?.isConnected || !card) return;
  if (!pontoDeSaidaVisivel(foto, card)) return;
  triggerFlyingCartAnimation(foto, imgSrc);
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
  const fotoDoCardRef = useRef<HTMLDivElement>(null);
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
  // Foco: o diálogo da folha (Radix) leva o foco para dentro ao abrir e o
  // prende lá (focus trap) -- isso é dele (13/09). A DEVOLUÇÃO ao fechar NÃO
  // é: o Radix só devolve ao `Trigger`, e esta folha abre por ESTADO, sem
  // SheetTrigger (o gatilho é o botão do card, com handler próprio). Medido
  // em 14/10/2026: ao fechar, o foco caía no <body> e o leitor de tela
  // recomeçava do topo da página. Por isso o botão do card guarda um ref e a
  // folha o devolve em `onCloseAutoFocus` (mesmo padrão do seletor de
  // endereço do carrinho, CartView). O foco manual do painel antigo (laudos
  // de acessibilidade 03/09 e 08/09) foi embora junto com o painel.
  const botaoDeAcaoRef = useRef<HTMLButtonElement>(null);

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
  // Bolinha do voo até o carrinho quando a escolha vem da FOLHA (14/10/2026).
  // A peça 18 (14/09) soltava a bolinha NO TOQUE do "Adicionar", partindo da
  // foto da folha. Medido no Chromium (375x812): ela boiava sobre o conteúdo
  // da folha (45 de 45 amostras do voo dentro da folha aberta) e ia para um
  // carrinho que a própria folha cobre (folha z-130 acima da barra z-120) —
  // o relato do dono: "fica passando em cima da aba sem sentido". Agora o
  // toque só ANOTA a foto a voar aqui; a bolinha sai quando a folha já foi
  // embora (`soltarVooDoCard`), partindo da foto do CARD, que está visível
  // ao fundo. `null` = nada a voar.
  const vooPendenteRef = useRef<string | null>(null);

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
  const modeloDeEixos = useMemo(
    () => criarEixosDaVariacao(product.variants ?? []),
    [product.variants],
  );
  const [escolhasDosEixos, setEscolhasDosEixos] = useState<Map<string, string>>(
    () => new Map(),
  );
  const [eixoAberto, setEixoAberto] = useState<string | null>(null);
  const [avisoDaEscolha, setAvisoDaEscolha] = useState<{
    chave: string;
    texto: string;
  } | null>(null);
  const idDaFolha = `${instanceId}-opcoes`;
  const primeiroEixoPendente = modeloDeEixos.eixos.find(
    (e) => !escolhasDosEixos.has(e.chave),
  );

  const aplicarEscolhasDosEixos = (escolhas: Map<string, string>) => {
    setEscolhasDosEixos(escolhas);
    setSelecionadas((antes) =>
      resolverSelecaoDosEixos(modeloDeEixos, escolhas, antes),
    );
  };

  // Pré-escolha só ao abrir. Nem um único tamanho/voltagem é comprado por
  // suposição. Reabrir preserva a escolha anterior do mesmo card.
  const abrirFolhaDeOpcoes = () => {
    const escolhas = preselecionarCor(
      modeloDeEixos,
      escolherValorDoEixo(modeloDeEixos, escolhasDosEixos),
    );
    aplicarEscolhasDosEixos(escolhas);
    setEixoAberto(
      modeloDeEixos.eixos.find((e) => !escolhas.has(e.chave))?.chave ?? null,
    );
    setAvisoDaEscolha(null);
    setFolhaOpcoesAberta(true);
  };

  useEffect(() => {
    if (folhaOpcoesAberta) focarEscolhaDaFolha(idDaFolha, eixoAberto);
  }, [folhaOpcoesAberta, eixoAberto, idDaFolha]);

  // Estoque recebido em tempo real pode invalidar uma escolha já feita.
  // Limpa só o valor incompatível e explica, sem selecionar um substituto.
  useEffect(() => {
    if (!folhaOpcoesAberta) return;
    const validas = escolherValorDoEixo(modeloDeEixos, escolhasDosEixos);
    const removido = modeloDeEixos.eixos.find(
      (e) => escolhasDosEixos.has(e.chave) && !validas.has(e.chave),
    );
    if (!removido) return;
    const outros = modeloDeEixos.eixos
      .filter((e) => e.chave !== removido.chave)
      .flatMap((e) => escolhasDosEixos.get(e.chave) ?? [])
      .join(" / ");
    setAvisoDaEscolha({
      chave: removido.chave,
      texto: `${escolhasDosEixos.get(removido.chave)}${outros ? ` em ${outros}` : ""} acabou agora.`,
    });
    setEscolhasDosEixos(validas);
    setSelecionadas((antes) =>
      resolverSelecaoDosEixos(modeloDeEixos, validas, antes),
    );
    setEixoAberto(removido.chave);
  }, [modeloDeEixos, escolhasDosEixos, folhaOpcoesAberta]);

  const fotoDaCor = modeloDeEixos.grupos.flatMap((g) =>
    g.linhas.filter(
      (l) =>
        l.variante.imageUrl &&
        g.eixos
          .filter(eixoEhCor)
          .some(
            (e) =>
              escolhasDosEixos.has(e.chave) &&
              l.valores[e.indice] === escolhasDosEixos.get(e.chave),
          ),
    ),
  )[0]?.variante.imageUrl;

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
    Array.from(variantGroups.values()).some((valores) =>
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

  // Defesa (caçada de 14/10/2026): sem `onAddToCart` não há ninguém para
  // adicionar. Antes o botão rodava o ciclo inteiro ("Salvando..." -> "Salvo!"
  // verde, bolinha voando) e NADA entrava no carrinho — Busca e Favoritos
  // montavam o card assim. Sem como adicionar, o botão não confirma em falso:
  // faz o que faz a peça que "pode ter tamanho/cor" — abre a página do
  // produto, onde a compra acontece de verdade.
  const soAbreAPagina =
    !hasActiveVariant && (!!product.variantsUnavailable || !onAddToCart);

  // Nome acessível do botão do card (leitor de tela). Na vitrine são dezenas
  // de botões; o rótulo visível ("Carrinho", "Escolher opções"...) sozinho os
  // deixava IGUAIS. Cada nome CONTÉM o rótulo visível (WCAG 2.5.3, "rótulo no
  // nome" -- quem comanda por voz diz o que lê) e acrescenta o produto.
  // Só no estado parado: durante "Salvando..."/"Salvo!" o próprio texto do
  // botão é o nome (e o aviso falado diz qual produto entrou).
  const semEstoqueNoCard = temGruposDeOpcao
    ? nenhumaOpcaoDisponivel
    : estoqueAtual <= 0;
  const rotuloAcessivelDoBotao =
    cartStatus !== "idle"
      ? undefined
      : semEstoqueNoCard
        ? `${product.name} esgotado`
        : hasActiveVariant
          ? `Escolher opções de ${product.name}`
          : soAbreAPagina
            ? `Ver produto ${product.name}`
            : `Adicionar ${product.name} ao carrinho`;

  // Aviso falado de "entrou no carrinho" (região `role="status"` abaixo).
  // Espelha EXATAMENTE o "Salvo!" que quem enxerga vê -- mesmo gatilho, mesmo
  // momento -- e nasce VAZIO: leitor de tela só anuncia mudança de conteúdo em
  // região que já estava na árvore. Card com folha de opções (variação) tem a
  // região DENTRO da folha; o card sem folha, no próprio card (ver
  // `temFolhaDeOpcoes`). Uma região viva FORA da folha, num card que tem
  // folha, ainda faria o Radix poupar o card do `aria-hidden` da folha modal
  // (a biblioteca preserva o caminho até qualquer `aria-live`) -- por isso só
  // um dos dois lugares existe em cada card.
  const temFolhaDeOpcoes = hasActiveVariant && !!onAddToCartWithVariants;
  const avisoDeAdicionado =
    cartStatus === "success" ? `Adicionado ao carrinho: ${product.name}` : "";

  const handleAddToCartClick = (e: React.MouseEvent) => {
    e.stopPropagation();

    // Durante "Salvando..."/"Salvo!" o botão fica `aria-disabled` (não
    // `disabled`, para o leitor de tela não perder o foco) -- e `aria-disabled`
    // NÃO bloqueia clique. Quem bloqueia é esta guarda: o `disabled` de antes
    // calava TODOS os caminhos abaixo, inclusive o que abre o produto.
    if (cartStatus !== "idle") return;

    // Card inteligente (folha, 13/09): o botão do card SÓ ABRE a folha — a
    // escolha e o "Adicionar" moram no rodapé dela. O rótulo do botão do
    // card é sempre "Escolher opções".
    if (hasActiveVariant && onAddToCartWithVariants) {
      if (semEstoqueNoCard) return;
      abrirFolhaDeOpcoes();
      return;
    }

    // `variantsUnavailable`: a leitura das variações falhou (faixa de
    // recomendações) — não se sabe se a peça tem tamanho/cor, então ela
    // também só abre a página, onde a escolha é obrigatória. Sem
    // `onAddToCart` (ver `soAbreAPagina`) também: nada a confirmar.
    if (hasActiveVariant || soAbreAPagina) {
      onClick(product.id);
      return;
    }

    if (cartStatus !== "idle") return;

    setCartStatus("loading");

    onAddToCart?.(product, e);

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

  const handleAdicionarComOpcoes = () => {
    if (cartStatus !== "idle" || nenhumaOpcaoDisponivel) return;
    if (primeiroEixoPendente) {
      setEixoAberto(primeiroEixoPendente.chave);
      focarEscolhaDaFolha(idDaFolha, primeiroEixoPendente.chave);
      toast.warning("Falta escolher", {
        description: `Escolha a opção de ${primeiroEixoPendente.nome} antes de adicionar ao carrinho.`,
      });
      return;
    }
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
    // A bolinha NÃO voa agora: com a folha aberta ela cruzaria o conteúdo
    // dela rumo a um carrinho coberto. Fica anotada e sai quando a folha
    // terminar de fechar (ver `vooPendenteRef` e `soltarVooDoCard`).
    vooPendenteRef.current = imgSrc;
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
      // 700 ms de "Salvo!" visível: o olho registra a confirmação antes da
      // folha deslizar para fora — e é quando ela termina de sair que a
      // bolinha voa (`soltarVooDoCard`).
      const idFechar = window.setTimeout(() => {
        setCartStatus("idle");
        setQuantidade(1);
        setFolhaOpcoesAberta(false);
      }, 700);
      timersRef.current.push(idFechar);
    }, 600);
    timersRef.current.push(idLoading);
  };

  const escolherOpcaoDoEixo = (chave: string, valor: string) => {
    if (cartStatus !== "idle") return;
    if (escolhasDosEixos.get(chave) === valor) {
      // O marcado só recolhe; todos os demais valores com estoque global
      // continuam tocáveis, mesmo incompatíveis com a combinação atual.
      setEixoAberto(null);
      focarEscolhaDaFolha(idDaFolha, null);
      return;
    }
    const depois = escolherValorDoEixo(
      modeloDeEixos,
      escolhasDosEixos,
      chave,
      valor,
    );
    const removido = modeloDeEixos.eixos.find(
      (e) =>
        e.chave !== chave &&
        escolhasDosEixos.has(e.chave) &&
        !depois.has(e.chave),
    );
    const disponibilidade = removido
      ? disponibilidadeDoValor(
          modeloDeEixos,
          depois,
          removido.chave,
          escolhasDosEixos.get(removido.chave)!,
        )
      : null;
    setAvisoDaEscolha(
      removido
        ? {
            chave: removido.chave,
            texto: disponibilidade?.existe
              ? `${escolhasDosEixos.get(removido.chave)} em ${valor} está esgotado.`
              : `${escolhasDosEixos.get(removido.chave)} não tem em ${valor}.`,
          }
        : null,
    );
    aplicarEscolhasDosEixos(depois);
    const proximo =
      modeloDeEixos.eixos.find((e) => !depois.has(e.chave))?.chave ?? null;
    setEixoAberto(proximo);
    // Se o mesmo eixo continua aberto (ex.: toque no CTA pendente), o efeito
    // não repete; o caminho de seleção completa sempre termina no botão.
    if (proximo === null) focarEscolhaDaFolha(idDaFolha, null);
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
        {/* Image Container. O `ref` é o ponto de partida da bolinha do voo
            até o carrinho quando a escolha vem da folha (ver
            `soltarVooDoCard`). */}
        <div
          ref={fotoDoCardRef}
          data-testid="product-card-photo"
          className="relative aspect-[4/5] overflow-hidden bg-slate-50"
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
                    ? textoEstoqueBaixo(estoqueAtual)
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
                <span
                  className={cn(
                    "mt-1 text-[15px] font-black leading-none tracking-tight",
                    CLASSE_PRECO_PROMOCIONAL_TEXTO_PEQUENO,
                  )}
                >
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
              <span
                className={cn(
                  "shrink-0 select-none rounded border px-1.5 py-0.5 text-[8px] font-black uppercase tracking-wider",
                  CLASSE_SELO_DESCONTO,
                )}
              >
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
            ref={botaoDeAcaoRef}
            data-testid="product-card-action"
            onClick={handleAddToCartClick}
            // Esgotado é estado PERMANENTE: `disabled` de verdade. "Salvando..."/
            // "Salvo!" é passageiro: `aria-disabled` mantém o botão na ordem de
            // foco (com `disabled` o foco caía no body e o leitor de tela
            // ficava mudo); o bloqueio do clique é a guarda de `cartStatus` no
            // handler.
            disabled={semEstoqueNoCard}
            aria-disabled={
              !semEstoqueNoCard && cartStatus !== "idle" ? true : undefined
            }
            aria-label={rotuloAcessivelDoBotao}
            className={cn(
              // `aria-disabled:active:scale-100`: o botão `disabled` não
              // encolhia ao toque; aria-disabled não o desliga sozinho -- a
              // classe mantém o visual de antes.
              "w-full py-2 px-3 rounded-xl text-[10px] font-black uppercase tracking-wider transition-all duration-150 active:scale-95 aria-disabled:active:scale-100 shadow-[0_4px_10px_rgba(24,24,27,0.1)] flex items-center justify-center gap-1.5",
              semEstoqueNoCard
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
            {cartStatus === "idle" && !semEstoqueNoCard && (
              <ShoppingCart className="size-3 shrink-0" />
            )}
            <span className="truncate">
              {semEstoqueNoCard
                ? "Esgotado"
                : hasActiveVariant
                  ? "Escolher opções"
                  : soAbreAPagina
                    ? "Ver produto"
                    : cartStatus === "idle"
                      ? "Carrinho"
                      : cartStatus === "loading"
                        ? "Salvando..."
                        : "Salvo!"}
            </span>
          </button>
          {/* Região viva SEMPRE montada e invisível (sr-only): fala o
              "Adicionado ao carrinho" que o leitor de tela não ouvia
              (remover já era falado, pelo toast). Quem enxerga não vê nada. */}
          {!temFolhaDeOpcoes && (
            <span role="status" aria-live="polite" className="sr-only">
              {avisoDeAdicionado}
            </span>
          )}
        </div>
      </div>

      {/* ── FOLHA DE OPÇÕES (13/09, direção B — mockup do Gabriel) ──────
          Bottom sheet em PORTAL: substitui o painel que expandia dentro do
          card (reprovado pelo dono). A folha NUNCA é descendente do card --
          abrir opções não muda a árvore nem a altura de nada aqui (ver o
          comentário do wrapper raiz). Controlada por estado, sem
          SheetTrigger: o gatilho é o botão do card, que tem handler próprio
          (stopPropagation + abertura de produto para cuidar). Estrutura
          compacta (21/10): alça, miniatura inteira, eixos dobráveis e rodapé
          com quantidade/total. Só o grupo de eixos rola; cabeçalho e CTA
          ficam fixos. A folha e seu véu param acima da barra de navegação.
          Foco para dentro, Escape e
          clique fora são do Radix; a DEVOLUÇÃO do foco ao fechar NÃO (sem
          SheetTrigger o Radix não tem para onde devolver) -- é o
          `onCloseAutoFocus` abaixo (ver comentário no topo). */}
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
            className="bottom-[var(--folha-acima-da-barra)] mx-auto max-h-[calc(100dvh-var(--folha-acima-da-barra)-72px)] gap-0 rounded-t-3xl border-t-0 bg-white ease-out motion-reduce:animate-none motion-reduce:transition-none sm:max-w-md"
            style={{
              animationDuration: "240ms",
              animationTimingFunction: "ease-out",
            }}
            overlayClassName="bottom-[var(--folha-acima-da-barra)] motion-reduce:animate-none"
            onOpenAutoFocus={(evento) => {
              evento.preventDefault();
              focarEscolhaDaFolha(idDaFolha, eixoAberto);
            }}
            // Devolve o foco ao botão do card (o Radix só devolve ao Trigger,
            // e aqui não há: cairia no body). Sem a guarda `isConnected`, o
            // card que saiu da vitrine com a folha aberta (repaginou, o item
            // foi removido) tentaria focar um nó que já não existe.
            onCloseAutoFocus={(evento) => {
              evento.preventDefault();
              // A folha TERMINOU de sair (o Radix só avisa depois da animação
              // de saída, com a folha já fora do DOM): é a hora da bolinha
              // anotada no "Adicionar". Vale uma vez — o anotado é limpo
              // antes de qualquer saída, e reabrir/fechar depois não repete.
              // A bolinha sai ANTES de devolver o foco: `focus()` rola a
              // página até o botão (no pé do card) e, em grade larga com foto
              // alta, o centro da foto já teria saído da tela quando
              // `pontoDeSaidaVisivel` perguntasse (medido no Chromium,
              // 15/10/2026) — sobrava só o "Salvo!".
              const imgSrc = vooPendenteRef.current;
              vooPendenteRef.current = null;
              soltarVooDoCard(imgSrc, fotoDoCardRef.current, cardRef.current);
              const botao = botaoDeAcaoRef.current;
              if (botao?.isConnected) botao.focus();
            }}
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
              className="focus:outline-hidden absolute left-1/2 top-0 z-10 flex h-11 w-20 -translate-x-1/2 cursor-pointer touch-none items-start justify-center rounded-full pt-2 focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
            >
              <span
                aria-hidden="true"
                className="h-1 w-9 rounded-full bg-zinc-300"
              />
            </button>
            <div aria-hidden="true" className="h-5 shrink-0" />
            <CorpoDaFolhaDeOpcoes
              id={idDaFolha}
              product={product}
              modelo={modeloDeEixos}
              escolhas={escolhasDosEixos}
              eixoAberto={eixoAberto}
              aviso={avisoDaEscolha}
              imagem={imagemDaVariante || fotoDaCor || product.images[0]}
              preco={precoAtual}
              estoque={estoqueAtual}
              quantidade={quantidade}
              indisponivel={nenhumaOpcaoDisponivel}
              cartStatus={cartStatus}
              avisoDeAdicionado={avisoDeAdicionado}
              onAbrirEixo={setEixoAberto}
              onEscolher={escolherOpcaoDoEixo}
              onQuantidade={setQuantidade}
              onAdicionar={handleAdicionarComOpcoes}
              onDetalhes={() => {
                setFolhaOpcoesAberta(false);
                abrirProduto();
              }}
            />
          </SheetContent>
        </Sheet>
      )}
    </div>
  );
});
