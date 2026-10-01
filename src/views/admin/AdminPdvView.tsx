// A tela do caixa de balcão (tarefa C3.2, plano §5.3 e §5.6). VIEW FINA
// de propósito: todo o cérebro mora em `useVendaPresencial` (C3.1) e cada
// seção (Cupom/Cliente/Fechamento/Recibo) só recebe `estado`/`despachar` —
// esta view é a ÚNICA que chama Supabase, e injeta as três buscas por prop
// nas seções de baixo.
//
// O NOME DO ARQUIVO NÃO É LIVRE: `vite.config.ts:99-116` mapeia
// `src/views/admin/AdminPdvView.tsx` para o chunk `PdvBalcao`, fora do
// precache do service worker (contexto da tarefa, fato 4) — mudar o nome ou
// o caminho quebra esse mapa.
//
// REGISTRADA no roteador (C3.3, plano §5.3 e §5.6): os 12 pontos manuais
// vivem em src/types/index.ts, src/config/rotas.ts, scripts/hospedagem.mjs,
// src/App.tsx, src/components/layouts/AdminArea.tsx e
// src/utils/pai-da-tela-do-admin.ts. Voltar por camada e o dirty enquanto
// há cupom (abaixo) nasceram junto do registro, como o plano pede.
//
// FECHAMENTO DE VERDADE (C3.4, plano §5.3): `aoRegistrarVenda`, logo abaixo,
// chama `registrar_venda_presencial` (migration 20261162000000, commitada em
// 8c4b6cf — C1.3) por nome, com a MESMA `chaveDeIdempotencia` do cupom em
// toda tentativa. Quem traduz o erro para português é
// `mensagemDaFalhaDaVenda` (src/lib/erro-da-venda-presencial.ts), chamada
// dentro de `FechamentoDaVenda` — esta view deixa o erro CRU subir.

import { AdminPageHeader } from "@/components/admin/AdminPageHeader";
import { ClienteDaVenda } from "@/components/admin/pdv/ClienteDaVenda";
import type { LinhaDeClienteEncontrado } from "@/components/admin/pdv/ClienteDaVenda";
import { CupomDaVenda } from "@/components/admin/pdv/CupomDaVenda";
import type { ProdutoEncontradoNaBusca } from "@/components/admin/pdv/CupomDaVenda";
import {
  FechamentoDaVenda,
  type ProntidaoDoPixQr,
} from "@/components/admin/pdv/FechamentoDaVenda";
import { LeitorDeCodigo } from "@/components/admin/pdv/LeitorDeCodigo";
import { PixDoBalcao } from "@/components/admin/pdv/PixDoBalcao";
import { ReciboDaVenda } from "@/components/admin/pdv/ReciboDaVenda";
import { branding } from "@/config/branding";
import { pagamentoOnlineLigado } from "@/config/configuracaoDaLoja";
import { useStore } from "@/contexts/StoreContext";
import {
  chaveDoItemDoCupom,
  totalDaVenda,
  useVendaPresencial,
} from "@/hooks/useVendaPresencial";
import type {
  ClienteDaVenda as ClienteDaVendaTipo,
  FormaDePagamentoDoBalcao,
  ItemDoCupom,
  ReciboDaVendaRegistrada,
  RespostaDoCodigo,
} from "@/hooks/useVendaPresencial";
import type { Leitura } from "@/lib/leitor/decodificador";
import type {
  AcaoDoPixDoBalcao,
  LinhaDoPixDoBalcao,
  RespostaDoPixDoBalcao,
} from "@/lib/pix-do-balcao";
import { supabase } from "@/lib/supabase";
import type { View } from "@/types";
import { ScanBarcode } from "lucide-react";
import {
  type ReactElement,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import { toast } from "sonner";

/** Quanto a tela espera a edge responder a prontidão antes de dar "não pronto". */
const PRAZO_DA_PRONTIDAO_MS = 8_000;

export interface AdminPdvViewProps {
  readonly onNavigate: (view: View, id?: string) => void;
  readonly active?: boolean;
  readonly onSetDirty?: (dirty: boolean) => void;
  readonly onSetBackOverride?: (fn: (() => void) | null) => void;
}

export function AdminPdvView({
  onNavigate,
  active,
  onSetDirty,
  onSetBackOverride,
}: AdminPdvViewProps): ReactElement {
  const { estado, despachar, subtotal, limparCupom } = useVendaPresencial();
  const { config } = useStore();
  const storeName = config.storeName?.trim() || branding.appName;

  // Uma "camada" é uma folha por cima do cupom (variação, cliente ou
  // fechamento) — todas nascem de `cupom` e voltam pra `cupom` direto,
  // nunca uma para a outra (CupomDaVenda/ClienteDaVenda/FechamentoDaVenda
  // só disparam `etapa_pedida: "cupom"` ou `variacao_cancelada`).
  // `recibo` NÃO é camada: é o fim da venda, e o Voltar ali tem de sair da
  // tela (a única saída seria `cupom_limpo`, que gira a chave — ver o
  // comentário grande de `podeIrPara` em useVendaPresencial.ts).
  const camadaAberta =
    estado.etapa === "escolha_de_variacao" ||
    estado.etapa === "cliente" ||
    estado.etapa === "fechamento" ||
    estado.etapa === "pix";

  // Padrão MEDIDO do commit d10d635 (AdminBannersView.tsx:1230-1275),
  // adaptado de "um diálogo" para "uma das três camadas do balcão".
  //
  // Entrada de histórico da camada: ao abrir, empurra `{modal: "pdv"}`;
  // ao fechar PELA MÁQUINA (etapa voltou pra "cupom"), consome essa
  // entrada com `history.back()` — só se ainda for a nossa (a checagem
  // `state?.modal === "pdv"` é o que evita consumir a entrada de uma
  // navegação real que aconteceu por cima, ver AdminBannersView.tsx).
  const temEntradaDeHistoricoPendenteRef = useRef(false);
  useEffect(() => {
    if (camadaAberta) {
      if (!temEntradaDeHistoricoPendenteRef.current) {
        window.history.pushState(
          { ...window.history.state, modal: "pdv" },
          "",
          window.location.pathname + window.location.search,
        );
        temEntradaDeHistoricoPendenteRef.current = true;
      }
    } else if (temEntradaDeHistoricoPendenteRef.current) {
      temEntradaDeHistoricoPendenteRef.current = false;
      if (window.history.state?.modal === "pdv") {
        if (estado.etapa === "recibo") {
          // VENDA REGISTRADA: consumir a entrada SEM navegação. O
          // `history.back()` daqui dispara um popstate que corre ANTES do
          // dirty cair no painel (efeitos passivos perdem para a tarefa do
          // popstate) — e o diálogo "alterações não salvas" abria sobre o
          // RECIBO de uma venda já registrada (relato do dono em teste
          // real no celular, 19/09). replaceState limpa a marca `{modal}`
          // sem navegar: o recibo é um estado limpo, nada a perder.
          window.history.replaceState(
            {},
            "",
            window.location.pathname + window.location.search,
          );
        } else {
          window.history.back();
        }
      }
    }
  }, [camadaAberta, estado.etapa]);

  // Registra o fechamento da camada como override do Voltar do celular. O
  // botão Voltar do AdminLayout (AdminArea.tsx: `onBack={backOverride ||
  // undefined}`) chama esta mesma função DIRETO, sem passar pelo popstate
  // — e o `history.back()` do efeito acima pode entregar um popstate que
  // tenta rodá-la de novo antes deste efeito desregistrar.
  // `efetuouFechamentoRef` torna a segunda chamada um no-op em vez de
  // fechar duas camadas de um só Voltar.
  //
  // `estado.etapa` entra na lista de dependências (em vez de lido de uma
  // ref sempre-atualizada) porque escrever numa ref DURANTE o render é
  // proibido (react-hooks/refs) — e não custa nada aqui: a etapa de "qual
  // camada está aberta" não muda sem passar por "cupom" (comentário
  // acima), então o efeito não re-registra o override à toa.
  const efetuouFechamentoRef = useRef(false);
  useEffect(() => {
    if (!onSetBackOverride) return;
    const etapaDaCamada = estado.etapa;
    if (camadaAberta) {
      efetuouFechamentoRef.current = false;
      onSetBackOverride(() => () => {
        if (efetuouFechamentoRef.current) return;
        efetuouFechamentoRef.current = true;
        if (etapaDaCamada === "escolha_de_variacao") {
          despachar({ tipo: "variacao_cancelada" });
        } else if (etapaDaCamada === "pix") {
          // O PIX aberto é uma venda JÁ gravada, com estoque reservado: o
          // Voltar não pode largá-la com o QR pagável. A saída é o botão
          // "Cancelar este PIX" (cancela no Mercado Pago antes).
          efetuouFechamentoRef.current = false;
          // Voltar do NAVEGADOR (popstate) já consumiu a entrada `{modal}` —
          // sem empurrá-la de novo, o próximo Voltar sairia da tela Vender
          // com o QR aberto (revisão, rodada 1). O Voltar do painel chama
          // esta função direto, sem consumir nada: aí a entrada ainda é nossa.
          if (window.history.state?.modal !== "pdv") {
            window.history.pushState(
              { ...window.history.state, modal: "pdv" },
              "",
              window.location.pathname + window.location.search,
            );
            temEntradaDeHistoricoPendenteRef.current = true;
          }
          toast.info("Para sair, cancele o PIX na tela ou espere o pagamento.");
        } else {
          despachar({ tipo: "etapa_pedida", etapa: "cupom" });
        }
      });
    } else {
      onSetBackOverride(null);
    }
    return () => {
      onSetBackOverride(null);
    };
  }, [camadaAberta, estado.etapa, onSetBackOverride, despachar]);

  // Dirty enquanto houver cupom montado (plano §5.3, parágrafo final):
  // liga o `beforeunload`, o diálogo de navegação não-salva e — de
  // brinde — a supressão do aviso de atualização do PWA (tarefa
  // UpdateNotification-138, que lê o mesmo `isAdminDirty`). Depois da
  // venda registrada a etapa vira "recibo" e o dirty tem de CAIR mesmo
  // com os itens ainda na lista (é o recibo mostrando o que foi vendido,
  // não uma venda em aberto) — por isso a derivação olha `recibo`, não só
  // `itens.length`.
  const dirty = estado.itens.length > 0 && estado.recibo === null;
  useEffect(() => {
    onSetDirty?.(dirty);
  }, [dirty, onSetDirty]);
  // Efeito PRÓPRIO só para o unmount: sem separar dos dois de cima, todo
  // clique que muda `dirty` disparava um `onSetDirty(false)` de limpeza
  // entre um render e outro (falso "ficou limpo" por um instante) antes
  // do valor novo chegar — o painel não pode achar que a pessoa saiu no
  // meio do caminho.
  useEffect(() => {
    return () => onSetDirty?.(false);
  }, [onSetDirty]);

  // O leitor fica sempre visível acima do cupom, mas o balconista pode
  // recolher a câmera sem perder a tela (LeitorDeCodigo é um cartão inline,
  // não uma folha — contexto, fato 2).
  const [leitorAberto, setLeitorAberto] = useState(true);

  async function buscarPorCodigo(codigo: string): Promise<RespostaDoCodigo> {
    // `leitura.codigo` vai DIRETO, sem normalizar (pdv-c2.json é explícito:
    // a RPC casa por igualdade e o campo é texto).
    const { data, error } = await supabase.rpc("buscar_por_codigo_barras", {
      p_codigo: codigo,
    });
    if (error) throw error;
    return data as unknown as RespostaDoCodigo;
  }

  async function aoLerCodigo(leitura: Leitura): Promise<void> {
    try {
      const resposta = await buscarPorCodigo(leitura.codigo);
      despachar({
        tipo: "codigo_resolvido",
        codigo: leitura.codigo,
        resposta,
        em: Date.now(),
      });
    } catch (erro) {
      console.error("Erro ao consultar código de barras no balcão:", erro);
      toast.error("Não consegui consultar esse código agora. Tente de novo.");
    }
  }

  // Defesa de rodada (molde: AdminCustomersView.tsx:156-180) — compartilhada
  // pelas duas buscas injetadas abaixo, cada uma com o próprio contador:
  // uma resposta de cliente atrasada nunca deveria descartar uma busca de
  // produto mais nova, e vice-versa.
  const rodadaClientesRef = useRef(0);
  const rodadaProdutosRef = useRef(0);

  async function buscarClientes(
    termo: string,
  ): Promise<readonly LinhaDeClienteEncontrado[]> {
    const rodada = ++rodadaClientesRef.current;
    const { data, error } = await supabase.rpc("get_admin_customers_paged", {
      p_search: termo,
      p_sort_field: "created_at",
      p_sort_direction: "desc",
      p_page: 0,
      p_page_size: 8,
    });
    if (rodada !== rodadaClientesRef.current) return [];
    if (error) throw error;
    return ((data as any)?.data ?? []) as LinhaDeClienteEncontrado[];
  }

  async function buscarProdutos(
    termo: string,
  ): Promise<readonly ProdutoEncontradoNaBusca[]> {
    const rodada = ++rodadaProdutosRef.current;
    const { data, error } = await supabase.rpc("get_admin_products_paged", {
      p_search: termo,
      p_category: "all",
      p_status: "active",
      p_stock: "all",
      p_page: 0,
      p_page_size: 8,
    });
    if (rodada !== rodadaProdutosRef.current) return [];
    if (error) throw error;
    return ((data as any)?.data ?? []) as ProdutoEncontradoNaBusca[];
  }

  // A linha inteira de `marketplace_orders` que `to_jsonb(o.*)` devolve
  // dentro de `order` (migration 20261162000000:498-515) — só os campos que
  // o recibo usa; o resto da linha (endereço…) não importa aqui. Os campos
  // de cliente (`user_id`, `customer_name`, `customer_data`) entram porque o
  // recibo monta o cliente da RESPOSTA, não da tela (ver `clienteDoRecibo`).
  interface LinhaDoPedidoDoBalcao {
    readonly id: string;
    readonly created_at: string;
    readonly total: number;
    readonly subtotal: number;
    readonly discount: number;
    readonly payment_method: FormaDePagamentoDoBalcao;
    readonly user_id: string | null;
    readonly customer_name: string;
    readonly customer_data: { readonly whatsapp?: string | null } | null;
  }

  // O literal que a migration grava em `customer_name` quando a venda nasce
  // sem cliente (20261162000000:366-371, o COALESCE final) — o MESMO que
  // `ReciboDaVenda.tsx` (`nomeDoCliente`) mostra para `sem_cliente`. Três
  // lugares, um valor: a migration é a fonte; os outros dois copiam.
  const NOME_DE_VENDA_SEM_CLIENTE = "Venda no balcão";

  // B2 do item 2 da fila do bastão (19/09): o cliente do recibo sai da
  // RESPOSTA do banco, não do que está na tela — `customer_name` /
  // `customer_data.whatsapp` são o que a RPC gravou de verdade. A camada de
  // cliente é interativa por baixo do fechamento (o mesmo achado BLOQUEIA
  // dos itens): o cliente da TELA pode ter mudado entre o clique que gravou
  // e a resposta que chega; e na retentativa pós-recarregamento
  // (`ja_existia: true`) o que está na tela é o rascunho restaurado, não a
  // venda que o banco já tem — recarregar a página não pode apagar o cliente
  // do recibo. O banco manda a forma: `user_id` (cliente cadastrado),
  // `customer_name` (nome do avulso, ou o literal de venda sem cliente) e
  // `customer_data.whatsapp`.
  function clienteDoRecibo(pedido: LinhaDoPedidoDoBalcao): ClienteDaVendaTipo {
    const whatsappBruto = pedido.customer_data?.whatsapp;
    const whatsapp =
      typeof whatsappBruto === "string" && whatsappBruto.trim() !== ""
        ? whatsappBruto
        : null;
    if (pedido.user_id) {
      return {
        tipo: "cadastrado",
        userId: pedido.user_id,
        nome: pedido.customer_name,
        whatsapp,
      };
    }
    const nome = (pedido.customer_name ?? "").trim();
    if (nome === "" || nome === NOME_DE_VENDA_SEM_CLIENTE) {
      return { tipo: "sem_cliente" };
    }
    return { tipo: "avulso", nome, whatsapp: whatsapp ?? "" };
  }

  // Um item de `data.items` (migration :498-515) — o que o BANCO gravou de
  // verdade, byte a byte. `image_url` não vem de propósito (:467-470): a
  // imagem do recibo sai do que a TELA já tem em mãos (ver `montarItensDoRecibo`).
  interface ItemGravadoNoPedido {
    readonly product_id: string;
    readonly variant_id: string | null;
    readonly quantity: number;
    readonly price: number;
    readonly product_name: string;
  }

  interface RespostaDoFechamento {
    readonly ja_existia: boolean;
    readonly order: LinhaDoPedidoDoBalcao;
    readonly items: readonly ItemGravadoNoPedido[];
  }

  // Acha, por `product_id`+`variant_id`, o item do CUPOM que corresponde a um
  // item GRAVADO — só para pegar imagem e o rótulo de variação, que
  // `data.items` não traz de propósito. Achado BLOQUEIA da revisão: o resto
  // (nome, preço, quantidade) tem de vir do item GRAVADO, nunca do cupom —
  // entre o clique que gravou e a retentativa/duplo-toque que lê a resposta,
  // a TELA pode ter mudado (quantidade alterada por baixo do fechamento,
  // preço do produto trocado no banco); o item gravado é a única verdade do
  // que foi vendido e do que saiu do estoque.
  function montarItensDoRecibo(
    itensGravados: readonly ItemGravadoNoPedido[],
  ): readonly ItemDoCupom[] {
    return itensGravados.map((gravado) => {
      const doCarrinho = estado.itens.find(
        (item) =>
          item.productId === gravado.product_id &&
          item.variantId === gravado.variant_id,
      );
      return {
        chave: chaveDoItemDoCupom(gravado.product_id, gravado.variant_id),
        productId: gravado.product_id,
        variantId: gravado.variant_id,
        nome: gravado.product_name,
        variacao: doCarrinho?.variacao ?? null,
        preco: gravado.price,
        quantidade: gravado.quantity,
        // `estoque` só importa DENTRO do cupom (é o teto do "+"); no recibo,
        // que é terminal e só de leitura, o campo é inerte — 0 em vez de
        // reaproveitar `quantidade` ou o estoque da tela, que mentiria sobre
        // algo que não foi medido aqui.
        estoque: doCarrinho?.estoque ?? 0,
        imagem: doCarrinho?.imagem ?? "",
      };
    });
  }

  // Tarefa C3.4 — o fechamento de VERDADE. `registrar_venda_presencial`
  // (migration 20261162000000) só existe no banco depois de C1.3 commitada;
  // ATENÇÃO de quem ler isto depois: NÃO chame antes de conferir
  // `git log --oneline | grep 'balcao nasce inteira'` (a tarefa é explícita
  // sobre isso).
  async function aoRegistrarVenda(): Promise<void> {
    // SEMPRE por NOME (todo parâmetro a partir do terceiro tem DEFAULT na
    // RPC) e `p_itens` com EXATAMENTE as três chaves que a RPC lê
    // (:302-304) — nunca preço nem nome, que vêm SEMPRE do banco (nunca da
    // tela, contexto da tarefa).
    //
    // A máquina só chega aqui com o meio de pagamento escolhido (o botão do
    // `FechamentoDaVenda` nasce desabilitado até `pagamento` ser não nulo) —
    // a guarda torna o invariante explícito ao compilador; antes ele vivia
    // escondido pelo `as any` da chamada.
    if (!estado.pagamento) {
      throw new Error("A venda saiu sem meio de pagamento escolhido.");
    }
    const { data, error } = await supabase.rpc("registrar_venda_presencial", {
      p_itens: estado.itens.map((item) => ({
        product_id: item.productId,
        variant_id: item.variantId,
        quantity: item.quantidade,
      })),
      p_pagamento: estado.pagamento,
      p_cliente_user_id:
        estado.cliente.tipo === "cadastrado" ? estado.cliente.userId : null,
      p_cliente_nome:
        estado.cliente.tipo === "avulso" ? estado.cliente.nome : null,
      p_cliente_whatsapp:
        estado.cliente.tipo === "avulso" ? estado.cliente.whatsapp : null,
      p_desconto: estado.desconto,
      p_observacao: estado.motivoDoDesconto || null,
      // A MESMA chave em toda retentativa do MESMO cupom — nasce em
      // `estadoInicialDaVenda`/`cupom_limpo` (C3.1), nunca aqui. É o que
      // faz a segunda tentativa de uma venda que já foi gravada (rede
      // caindo na resposta, F5 no meio do envio) devolver `ja_existia:
      // true` em vez de debitar estoque duas vezes.
      p_idempotency_key: estado.chaveDeIdempotencia,
    });

    // Deixa o erro CRU subir: quem traduz para português é
    // `mensagemDaFalhaDaVenda` (C3.4), chamada de dentro de
    // `FechamentoDaVenda` — repetir a tradução aqui criaria dois lugares
    // decidindo a mesma frase (o mesmo defeito que o cabeçalho de
    // `recusaDoPedido.ts` descreve para outra RPC). Em QUALQUER falha aqui
    // (rede, 22023, 23505, 42501, PGRST202) nada é despachado: o cupom (e o
    // rascunho, que só é apagado depois de `venda_registrada` — ver o
    // efeito de gravação em `useVendaPresencial.ts`) ficam exatamente como
    // estavam. É a invariante de D3, não um `if`.
    if (error) throw error;

    const resposta = data as unknown as RespostaDoFechamento;
    const pedido = resposta.order;

    const recibo: ReciboDaVendaRegistrada = {
      orderId: pedido.id,
      // Seis últimos caracteres, maiúsculos — mesma regra de
      // `AdminOrdersView.tsx:2028`.
      numero: pedido.id.slice(-6).toUpperCase(),
      criadoEm: pedido.created_at,
      total: pedido.total,
      subtotal: pedido.subtotal,
      desconto: pedido.discount,
      pagamento: pedido.payment_method,
      // B2 (fila do bastão 19/09): da RESPOSTA do banco, nunca da tela — ver
      // `clienteDoRecibo` acima. O recibo mostra o cliente da venda que o
      // banco gravou; um F5 ou uma troca de cliente por baixo do fechamento
      // não reescreve a história.
      cliente: clienteDoRecibo(pedido),
      // PASSO 3(a) da tarefa, ao pé da letra: os itens saem de
      // `resposta.items` (o BANCO), e só imagem/variação vêm do cupom da
      // tela, por `product_id`+`variant_id` (ver `montarItensDoRecibo`
      // acima). Usar `estado.itens` aqui é o achado BLOQUEIA da revisão: o
      // cupom continua interativo por baixo do fechamento e pode ter mudado
      // entre a tentativa que gravou e esta leitura da resposta.
      itens: montarItensDoRecibo(resposta.items),
      jaExistia: resposta.ja_existia,
    };

    // (a) primeiro o recibo entra no estado — só DEPOIS disso o efeito de
    // C3.1 apaga o rascunho (ele apaga quando vê `estado.recibo !== null`,
    // não antes): se a montagem do recibo tivesse estourado ANTES deste
    // despacho, o cupom continuaria intacto em disco.
    despachar({ tipo: "venda_registrada", recibo });

    // (c) o e-mail de confirmação, SEM `await` e com `.catch` que só
    // registra — a venda JÁ está gravada, uma falha de envio não pode
    // derrubar a tela do recibo (mesma forma e mesmo motivo de
    // `useOrders.ts:2988-3020`, `enviarComprovanteAoCliente`). A edge
    // decide sozinha o caso "sem e-mail" (`comprovante.ts:280-289`) — por
    // isso NENHUMA guarda aqui.
    //
    // NÃO chamamos `notify-new-order`: quem registrou a venda é o próprio
    // lojista — avisá-lo do que ele acabou de fazer é ruído, e a edge nem
    // aceita um sinal de origem para dispensar isso (divergência da
    // tarefa, `notify-new-order/index.ts:32,150-153`).
    try {
      void (supabase.functions as any)
        .invoke("send-order-confirmation", { body: { orderId: pedido.id } })
        .then((r: any) => {
          if (r?.error) {
            console.warn(
              "send-order-confirmation: comprovante não saiu",
              r.error,
            );
          }
        })
        .catch((err: unknown) => {
          console.warn("send-order-confirmation: comprovante não saiu", err);
        });
    } catch (err) {
      console.warn("send-order-confirmation: comprovante não saiu", err);
    }
  }

  // ==========================================================================
  // PIX COM QR (frente A, 28/09/2026). A venda nasce À ESPERA do PIX em
  // `iniciar_venda_presencial_pix` (migration 20261184000000) com a chave
  // PRÓPRIA do PIX; a edge `cobrar-pix-no-balcao` cria/reconsulta/cancela a
  // cobrança; quem confirma é o caminho de sempre (webhook, reconciliação ou
  // "Conferir agora" → `confirmar_pagamento`).
  // ==========================================================================
  const pixQrDisponivel = pagamentoOnlineLigado();

  // PRONTIDÃO (01/10/2026, migration 20261186000000 + acao "prontidao" da
  // edge): a ficha ligada só MOSTRA a opção; ela habilita quando o servidor
  // diz `pronto: true`. Qualquer outra coisa — `pronto:false`, 4xx, rede,
  // resposta estranha ou nada em PRAZO_DA_PRONTIDAO_MS — é "não pronto"
  // (falha fechada: a venda reserva estoque). Cada consulta ganha um número;
  // só a MAIS NOVA escreve o estado — resposta antiga que chega atrasada não
  // reabilita a opção que uma consulta mais nova desligou.
  const [prontidaoDoPixQr, setProntidaoDoPixQr] =
    useState<ProntidaoDoPixQr>("conferindo");
  const rodadaDaProntidaoRef = useRef(0);

  const conferirProntidaoDoPix = useCallback(async (): Promise<boolean> => {
    const rodada = ++rodadaDaProntidaoRef.current;
    let pronto = false;
    let prazo: ReturnType<typeof setTimeout> | undefined;
    try {
      const resposta = await Promise.race([
        (supabase as any).functions.invoke("cobrar-pix-no-balcao", {
          body: { acao: "prontidao" },
        }),
        new Promise<null>((resolver) => {
          prazo = setTimeout(() => resolver(null), PRAZO_DA_PRONTIDAO_MS);
        }),
      ]);
      pronto = !resposta?.error && resposta?.data?.pronto === true;
    } catch {
      pronto = false;
    } finally {
      clearTimeout(prazo);
    }
    // Uma consulta mais nova começou enquanto esta esperava: esta resposta
    // não escreve o estado e NÃO autoriza nada — um `true` antigo nunca vale
    // por cima de uma conferência mais recente.
    if (rodada !== rodadaDaProntidaoRef.current) return false;
    setProntidaoDoPixQr(pronto ? "pronto" : "indisponivel");
    return pronto;
  }, []);

  const noFechamento = estado.etapa === "fechamento";
  const prontidaoJaConferidaRef = useRef(false);
  useEffect(() => {
    if (!pixQrDisponivel) return;
    // Ao montar e a cada ENTRADA no fechamento: uma queda passageira não
    // prende a opção desligada até recarregar a tela. Sair do fechamento não
    // pergunta nada.
    if (prontidaoJaConferidaRef.current && !noFechamento) return;
    prontidaoJaConferidaRef.current = true;
    void conferirProntidaoDoPix();
  }, [pixQrDisponivel, noFechamento, conferirProntidaoDoPix]);
  useEffect(
    () => () => {
      // Desmontou: nenhuma resposta em voo escreve mais nada; remontou (o
      // StrictMode faz isso em desenvolvimento), pergunta de novo.
      rodadaDaProntidaoRef.current++;
      prontidaoJaConferidaRef.current = false;
    },
    [],
  );

  async function aoGerarPix(): Promise<void> {
    // TODA tentativa confere a prontidão de novo ANTES da RPC que cria a
    // venda e reserva o estoque — venda nova (antes de a chave nascer) e
    // também o retry com chave pendente (a rede caiu no "Gerar PIX"
    // anterior). Caiu → nenhuma RPC; a opção desliga e a explicação aparece.
    // A chave pendente FICA (a venda pode já existir): o próximo toque em
    // "Gerar PIX" confere de novo e, com `true`, recupera com a MESMA chave.
    if (!(await conferirProntidaoDoPix())) return;
    // A chave nasce ANTES da chamada e vai para o rascunho: se a resposta se
    // perder, o retry usa a MESMA chave e recebe o MESMO pedido.
    const chave = estado.pix?.chave ?? globalThis.crypto.randomUUID();
    despachar({ tipo: "pix_preparado", chave });
    const { data, error } = await supabase.rpc("iniciar_venda_presencial_pix", {
      p_itens: estado.itens.map((item) => ({
        product_id: item.productId,
        variant_id: item.variantId,
        quantity: item.quantidade,
      })),
      p_idempotency_key: chave,
      p_cliente_user_id:
        estado.cliente.tipo === "cadastrado" ? estado.cliente.userId : null,
      p_cliente_nome:
        estado.cliente.tipo === "avulso" ? estado.cliente.nome : null,
      p_cliente_whatsapp:
        estado.cliente.tipo === "avulso" ? estado.cliente.whatsapp : null,
      p_desconto: estado.desconto,
      p_observacao: estado.desconto > 0 ? estado.motivoDoDesconto : null,
    });
    if (error) throw error;
    const resposta = data as unknown as RespostaDoFechamento;
    despachar({ tipo: "pix_aberto", orderId: resposta.order.id });
  }

  const orderIdDoPix = estado.pix?.orderId ?? null;

  async function cobrarPix(
    acao: AcaoDoPixDoBalcao,
  ): Promise<RespostaDoPixDoBalcao> {
    const { data, error } = await (supabase as any).functions.invoke(
      "cobrar-pix-no-balcao",
      { body: { acao, orderId: orderIdDoPix } },
    );
    if (error) {
      // Contrato do supabase-js v2: em não-2xx o corpo vem em
      // `error.context` (um Response) — a frase da edge mora lá.
      let mensagem = "Não consegui falar com o pagamento agora. Tente de novo.";
      try {
        const corpo = await (error as any).context?.json?.();
        if (typeof corpo?.error === "string") mensagem = corpo.error;
      } catch {
        // corpo ilegível: fica a frase genérica.
      }
      throw new Error(mensagem);
    }
    return data as RespostaDoPixDoBalcao;
  }

  async function consultarPix(): Promise<LinhaDoPixDoBalcao | null> {
    if (!orderIdDoPix) return null;
    const { data, error } = await supabase
      .from("marketplace_orders")
      .select("payment_status, status, expires_at")
      .eq("id", orderIdDoPix)
      .maybeSingle();
    if (error) throw error;
    return (data as LinhaDoPixDoBalcao | null) ?? null;
  }

  // Pago: o recibo sai do BANCO (a linha e os itens gravados), nunca da tela
  // — depois de um F5 a tela só tem o rascunho.
  async function aoPixPago(): Promise<void> {
    if (!orderIdDoPix) return;
    const [{ data: linha }, { data: itens }] = await Promise.all([
      supabase
        .from("marketplace_orders")
        .select(
          "id, created_at, total, subtotal, discount, payment_method, user_id, customer_name, customer_data",
        )
        .eq("id", orderIdDoPix)
        .maybeSingle(),
      supabase
        .from("marketplace_order_items")
        .select("product_id, variant_id, quantity, price, product_name")
        .eq("order_id", orderIdDoPix),
    ]);
    const pedido = (linha as unknown as LinhaDoPedidoDoBalcao | null) ?? null;
    const recibo: ReciboDaVendaRegistrada = {
      orderId: orderIdDoPix,
      numero: orderIdDoPix.slice(-6).toUpperCase(),
      criadoEm: pedido?.created_at ?? new Date().toISOString(),
      total: Number(pedido?.total ?? totalDaVenda(estado)),
      subtotal: Number(pedido?.subtotal ?? subtotal),
      desconto: Number(pedido?.discount ?? estado.desconto),
      pagamento: "pix_qr",
      cliente: pedido ? clienteDoRecibo(pedido) : estado.cliente,
      itens:
        itens && itens.length > 0
          ? montarItensDoRecibo(itens as unknown as ItemGravadoNoPedido[])
          : estado.itens,
      jaExistia: false,
    };
    despachar({ tipo: "venda_registrada", recibo });
    toast.success("PIX recebido! Venda concluída.");
    // Comprovante por e-mail só DEPOIS de pago (a edge reserva o envio uma
    // vez só — se o webhook já mandou, esta chamada não repete).
    void (supabase.functions as any)
      .invoke("send-order-confirmation", { body: { orderId: orderIdDoPix } })
      .catch((err: unknown) => {
        console.warn("send-order-confirmation: comprovante não saiu", err);
      });
  }

  // Aviso de caixa fechado no dinheiro (achado D8): lido quando o fechamento
  // abre. Falha de leitura (Financeiro não publicado, rede) = sem aviso —
  // nunca um palpite.
  const [caixaAberto, setCaixaAberto] = useState<boolean | null>(null);
  const fechamentoAberto = estado.etapa === "fechamento";
  useEffect(() => {
    if (!fechamentoAberto) return;
    let vivo = true;
    void (async () => {
      try {
        const { data, error } = await supabase.rpc("fin_caixa_atual");
        if (!vivo) return;
        setCaixaAberto(error ? null : data !== null);
      } catch {
        if (vivo) setCaixaAberto(null);
      }
    })();
    return () => {
      vivo = false;
    };
  }, [fechamentoAberto]);

  return (
    // pb-admin lg:pb-12 — o MESMO respiro das outras telas do admin: sem ele,
    // no navegador do celular o "Registrar venda" (último elemento da última
    // etapa) ficava por trás da barra de navegação fixa, e a rolagem termina
    // exatamente ali — relato do dono em teste real no aparelho (19/09):
    // "os botões não têm rolagem suficiente para eu poder clicar".
    <div className="pb-admin flex flex-col gap-4 lg:pb-12">
      <div className="flex items-center justify-between gap-3">
        <AdminPageHeader titulo="Vender" />
      </div>

      <LeitorDeCodigo
        // Gate por `active` (nova-tela.md, molde AdminProductsView): quando
        // a sub-view não está em foco, a câmera não pode continuar ligada
        // comendo bateria do tablet do balcão.
        aberto={active !== false && leitorAberto && estado.etapa === "cupom"}
        aoLer={aoLerCodigo}
        aoFechar={() => setLeitorAberto(false)}
        titulo="Bipar produto"
        dica="Aponte a câmera para o código de barras — ou digite embaixo"
      />
      {!leitorAberto && estado.etapa === "cupom" && (
        <button
          type="button"
          onClick={() => setLeitorAberto(true)}
          className="flex items-center justify-center gap-2 rounded-2xl border border-dashed border-zinc-700 p-3 text-sm font-semibold text-zinc-400"
        >
          <ScanBarcode className="size-4" />
          Abrir leitor de código
        </button>
      )}

      {estado.etapa !== "recibo" && estado.etapa !== "pix" && (
        <CupomDaVenda
          estado={estado}
          despachar={despachar}
          subtotal={subtotal}
          buscarProdutos={buscarProdutos}
          onNavigate={onNavigate}
        />
      )}

      {estado.etapa === "cliente" && (
        <ClienteDaVenda
          cliente={estado.cliente}
          despachar={despachar}
          buscarClientes={buscarClientes}
        />
      )}

      {estado.etapa === "fechamento" && (
        <FechamentoDaVenda
          estado={estado}
          despachar={despachar}
          aoRegistrarVenda={aoRegistrarVenda}
          limparCupom={limparCupom}
          pixQrDisponivel={pixQrDisponivel}
          prontidaoDoPixQr={prontidaoDoPixQr}
          aoGerarPix={aoGerarPix}
          caixaAberto={caixaAberto}
        />
      )}

      {estado.etapa === "pix" && orderIdDoPix && (
        <PixDoBalcao
          key={orderIdDoPix}
          numero={orderIdDoPix.slice(-6).toUpperCase()}
          total={totalDaVenda(estado)}
          cobrar={cobrarPix}
          consultar={consultarPix}
          aoPago={() => void aoPixPago()}
          aoEncerrado={() => despachar({ tipo: "pix_encerrado" })}
          aoDescartarCupom={limparCupom}
        />
      )}

      {estado.etapa === "recibo" && estado.recibo && (
        <ReciboDaVenda
          recibo={estado.recibo}
          despachar={despachar}
          limparCupom={limparCupom}
          storeName={storeName}
          aoAnular={async (motivo) => {
            const orderId = estado.recibo?.orderId;
            if (!orderId) return;
            const { error } = await supabase.rpc("anular_venda_presencial", {
              p_order_id: orderId,
              p_motivo: motivo,
            });
            if ((error as { code?: string } | null)?.code === "PGRST202") {
              throw new Error(
                "A anulação ainda não está liberada neste servidor. Avise quem cuida do app.",
              );
            }
            if (error) throw error;
          }}
        />
      )}
    </div>
  );
}
