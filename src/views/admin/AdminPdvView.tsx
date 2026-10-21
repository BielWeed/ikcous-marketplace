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
import { BuscaDeProduto } from "@/components/admin/pdv/BuscaDeProduto";
import type {
  PaginaDeProdutosEncontrados,
  ProdutoEncontradoNaBusca,
} from "@/components/admin/pdv/BuscaDeProduto";
import { ClienteDaVenda } from "@/components/admin/pdv/ClienteDaVenda";
import type { LinhaDeClienteEncontrado } from "@/components/admin/pdv/ClienteDaVenda";
import { CupomDaVenda } from "@/components/admin/pdv/CupomDaVenda";
import { FechamentoDaVenda } from "@/components/admin/pdv/FechamentoDaVenda";
import { LeitorDeCodigo } from "@/components/admin/pdv/LeitorDeCodigo";
import { ReciboDaVenda } from "@/components/admin/pdv/ReciboDaVenda";
import { branding } from "@/config/branding";
import { NOMES_DO_PAINEL } from "@/config/nomes-do-painel";
import { useStore } from "@/contexts/StoreContext";
import { useAnularVendaDoBalcao } from "@/hooks/useAnularVendaDoBalcao";
import { useAuth } from "@/hooks/useAuth";
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
import { marcarOperacaoSensivel } from "@/lib/atualizacao/operacao-sensivel";
import { precosDaVendaRecusada } from "@/lib/erro-da-venda-presencial";
import type { Leitura } from "@/lib/leitor/decodificador";
import { aguardarComPrazo } from "@/lib/prazo-da-requisicao";
import { supabase } from "@/lib/supabase";
import type { View } from "@/types";
import { Keyboard, ScanBarcode, Search } from "lucide-react";
import {
  type KeyboardEvent,
  type ReactElement,
  useEffect,
  useRef,
  useState,
} from "react";
import { toast } from "sonner";

/** Quanto o balconista espera pelo registro da venda antes de ver a frase de
 * rede e poder tentar de novo (a retentativa é idempotente). */
const PRAZO_DO_REGISTRO_DA_VENDA_MS = 20_000;

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
  // L10: o rascunho do caixa é do usuário que está nele (`:<uid>`).
  const { user } = useAuth();
  const {
    estado,
    despachar,
    subtotal,
    limparCupom: limparCupomDaVenda,
  } = useVendaPresencial({
    userId: user?.id,
  });
  const { anular } = useAnularVendaDoBalcao();
  // Amarra o pedido do recibo (o botão do recibo só conhece o motivo).
  const anularEstaVenda = (orderId: string) => (motivo: string) =>
    anular(orderId, motivo);
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
    estado.etapa === "fechamento";

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

  const [modoDeProduto, setModoDeProduto] = useState<
    "bipar" | "digitar" | "buscar"
  >("bipar");

  function limparCupom(): void {
    limparCupomDaVenda();
    setModoDeProduto("bipar");
  }

  async function buscarPorCodigo(codigo: string): Promise<RespostaDoCodigo> {
    // `leitura.codigo` vai DIRETO, sem normalizar (pdv-c2.json é explícito:
    // a RPC casa por igualdade e o campo é texto).
    const { data, error } = await supabase.rpc("buscar_por_codigo_barras", {
      p_codigo: codigo,
    });
    if (error) throw error;
    return data as unknown as RespostaDoCodigo;
  }

  // Chave da venda em andamento: a resposta de uma leitura só vale para a
  // venda em que o código foi lido. Cancelar a venda gira a chave, e a
  // resposta atrasada não pode colocar a peça da venda cancelada na nova.
  const chaveDaVendaRef = useRef(estado.chaveDeIdempotencia);
  useEffect(() => {
    chaveDaVendaRef.current = estado.chaveDeIdempotencia;
  }, [estado.chaveDeIdempotencia]);

  async function aoLerCodigo(leitura: Leitura): Promise<void> {
    if (estado.enviando) {
      // O cupom já foi copiado para o envio: a peça lida agora não entraria.
      toast.error("Aguarde: a venda está sendo registrada.");
      return;
    }
    const chaveDaLeitura = chaveDaVendaRef.current;
    try {
      const resposta = await buscarPorCodigo(leitura.codigo);
      if (chaveDaLeitura !== chaveDaVendaRef.current) return;
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
    pagina: number,
  ): Promise<PaginaDeProdutosEncontrados> {
    const rodada = ++rodadaProdutosRef.current;
    const { data, error } = await supabase.rpc("get_admin_products_paged", {
      p_search: termo,
      p_category: "all",
      p_status: "active",
      p_stock: "all",
      p_page: pagina,
      p_page_size: 8,
    });
    if (rodada !== rodadaProdutosRef.current) return { produtos: [], total: 0 };
    if (error) throw error;
    const produtos = ((data as any)?.data ?? []) as ProdutoEncontradoNaBusca[];
    // `total_count` é quantos produtos o termo acha no banco inteiro, não só
    // nesta página — é o que deixa a tela dizer "mostrando 8 de 22".
    const total = Number((data as any)?.total_count);
    return {
      produtos,
      total: Number.isFinite(total) ? total : produtos.length,
    };
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
    /** `to_jsonb(o.*)`: a linha inteira, então o status também vem. */
    readonly status?: string;
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
    // PRAZO PRÓPRIO: a sonda de conexão só diz "lenta" (não "sem internet")
    // quando a rede está pendurada, e o botão segue habilitado — sem prazo,
    // o clique giraria por minutos. Estourar NÃO prova que a venda não
    // chegou ao servidor: o erro sai SEM `code`, então a tradução do
    // fechamento mostra a frase de rede de sempre (cupom salvo, tentar de
    // novo), e a retentativa leva a MESMA chave de idempotência — se a venda
    // já tinha sido gravada, o servidor devolve `ja_existia` em vez de
    // debitar o estoque de novo. A resposta que chegar depois do prazo é
    // descartada por `aguardarComPrazo`.
    const desmarcar = marcarOperacaoSensivel("registro-de-venda-do-pdv");
    try {
      const { data, error } = await aguardarComPrazo(
        Promise.resolve(
          supabase.rpc("registrar_venda_presencial", {
            p_itens: estado.itens.map((item) => ({
              product_id: item.productId,
              variant_id: item.variantId,
              quantity: item.quantidade,
            })),
            p_pagamento: estado.pagamento,
            p_cliente_user_id:
              estado.cliente.tipo === "cadastrado"
                ? estado.cliente.userId
                : null,
            p_cliente_nome:
              estado.cliente.tipo === "avulso" ? estado.cliente.nome : null,
            p_cliente_whatsapp:
              estado.cliente.tipo === "avulso" ? estado.cliente.whatsapp : null,
            p_desconto: estado.desconto,
            p_total_esperado: totalDaVenda(estado),
            p_observacao:
              estado.desconto > 0 ? estado.motivoDoDesconto || null : null,
            // A MESMA chave em toda retentativa do MESMO cupom — nasce em
            // `estadoInicialDaVenda`/`cupom_limpo` (C3.1), nunca aqui. É o que
            // faz a segunda tentativa de uma venda que já foi gravada (rede
            // caindo na resposta, F5 no meio do envio) devolver `ja_existia:
            // true` em vez de debitar estoque duas vezes.
            p_idempotency_key: estado.chaveDeIdempotencia,
          }),
        ),
        PRAZO_DO_REGISTRO_DA_VENDA_MS,
        () => new Error("O registro da venda não respondeu a tempo."),
      );

      // Só a divergência de total traz os preços da conferência do banco.
      // Atualiza apenas preços; cliente, desconto, pagamento e chave ficam.
      // Falhas de rede NÃO provam recusa e nunca giram a chave.
      if (error) {
        const atualizacao = precosDaVendaRecusada(error);
        if (atualizacao) {
          despachar({
            tipo: "precos_atualizados",
            chaveDeIdempotencia: estado.chaveDeIdempotencia,
            itens: atualizacao.itens,
          });
        }
        // A tradução continua só no fechamento.
        throw error;
      }

      const resposta = data as unknown as RespostaDoFechamento;
      const pedido = resposta.order;

      // Retentativa de uma venda que JÁ foi gravada e depois ANULADA (a chave de
      // idempotência devolve o mesmo pedido): o recibo de uma compra que não vale
      // mais seria mostrado como se valesse. A recusa leva `code` 22023 para a
      // tradução do fechamento mostrar a frase e oferecer "nova venda".
      if (resposta.ja_existia && pedido.status === "cancelled") {
        throw {
          code: "22023",
          message:
            "Esta venda já foi anulada. Comece uma venda nova para registrar de novo.",
        };
      }

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
    } finally {
      desmarcar();
    }
  }

  const teclarNosModos = (evento: KeyboardEvent) => {
    if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(evento.key)) {
      return;
    }
    evento.preventDefault();
    const modos = ["bipar", "digitar", "buscar"] as const;
    const indice = modos.indexOf(modoDeProduto);
    const proximo =
      evento.key === "Home"
        ? modos[0]
        : evento.key === "End"
          ? modos[2]
          : modos[(indice + (evento.key === "ArrowRight" ? 1 : 2)) % 3];
    setModoDeProduto(proximo);
    document.getElementById(`modo-${proximo}-produto`)?.focus();
  };

  return (
    // A altura vem do painel (100dvh menos seu cabeçalho). A reserva medida
    // de AcaoDaBarra fica DENTRO dela; listas e corpos de etapa rolam por dentro.
    <div
      className="pdv pdv-viewport"
      data-etapa={estado.etapa}
      data-com-itens={estado.itens.length > 0}
      data-modo={modoDeProduto}
    >
      <div
        className={`pdv-page-heading ${estado.etapa === "cupom" ? "" : "sr-only"}`}
      >
        <AdminPageHeader titulo={NOMES_DO_PAINEL["admin-pdv"]} />
        <p className="pdv-muted">balcão</p>
      </div>

      {estado.etapa === "cupom" && (
        <div
          className="pdv-modes"
          role="tablist"
          aria-label="Adicionar produto à venda"
        >
          <button
            id="modo-bipar-produto"
            type="button"
            role="tab"
            aria-selected={modoDeProduto === "bipar"}
            tabIndex={modoDeProduto === "bipar" ? 0 : -1}
            aria-controls="leitor-do-balcao"
            onKeyDown={teclarNosModos}
            onClick={() => setModoDeProduto("bipar")}
          >
            <ScanBarcode aria-hidden="true" className="pdv-cyan size-5" />
            <span>Câmera</span>
          </button>
          <button
            id="modo-digitar-produto"
            type="button"
            role="tab"
            aria-selected={modoDeProduto === "digitar"}
            tabIndex={modoDeProduto === "digitar" ? 0 : -1}
            aria-controls="leitor-do-balcao"
            onKeyDown={teclarNosModos}
            onClick={() => setModoDeProduto("digitar")}
          >
            <Keyboard aria-hidden="true" className="size-5" />
            <span>Digitar</span>
          </button>
          <button
            id="modo-buscar-produto"
            type="button"
            role="tab"
            aria-selected={modoDeProduto === "buscar"}
            tabIndex={modoDeProduto === "buscar" ? 0 : -1}
            aria-controls="busca-do-balcao"
            onKeyDown={teclarNosModos}
            onClick={() => setModoDeProduto("buscar")}
          >
            <Search aria-hidden="true" className="pdv-blue size-5" />
            <span>Buscar</span>
          </button>
        </div>
      )}
      <div
        id="leitor-do-balcao"
        role="tabpanel"
        aria-labelledby={
          modoDeProduto === "digitar"
            ? "modo-digitar-produto"
            : "modo-bipar-produto"
        }
        hidden={estado.etapa !== "cupom" || modoDeProduto === "buscar"}
      >
        <LeitorDeCodigo
          // Gate por `active` (nova-tela.md, molde AdminProductsView): quando
          // a sub-view não está em foco, a câmera não pode continuar ligada
          // comendo bateria do tablet do balcão.
          aberto={
            active !== false &&
            modoDeProduto === "bipar" &&
            estado.etapa === "cupom"
          }
          lerTeclado={active === false ? false : estado.etapa === "cupom"}
          aoLer={aoLerCodigo}
          entradaManual={
            active !== false &&
            estado.etapa === "cupom" &&
            modoDeProduto === "digitar"
          }
          segmentado
          compacto={estado.itens.length > 0}
          titulo="Bipar produto"
          dica="Aponte para o código de barras"
        />
      </div>

      {estado.etapa !== "recibo" && (
        <div
          id="busca-do-balcao"
          role="tabpanel"
          aria-labelledby="modo-buscar-produto"
          hidden={estado.etapa !== "cupom" || modoDeProduto !== "buscar"}
        >
          <BuscaDeProduto
            despachar={despachar}
            buscarProdutos={buscarProdutos}
            visivel={
              active === false
                ? false
                : modoDeProduto === "buscar"
                  ? estado.etapa === "cupom"
                  : false
            }
          />
        </div>
      )}

      {estado.etapa !== "recibo" && (
        <CupomDaVenda
          estado={estado}
          despachar={despachar}
          subtotal={subtotal}
          onNavigate={onNavigate}
          limparCupom={limparCupom}
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
        />
      )}

      {estado.etapa === "recibo" && estado.recibo && (
        <ReciboDaVenda
          recibo={estado.recibo}
          despachar={despachar}
          limparCupom={limparCupom}
          storeName={storeName}
          aoAnular={anularEstaVenda(estado.recibo.orderId)}
        />
      )}
    </div>
  );
}
