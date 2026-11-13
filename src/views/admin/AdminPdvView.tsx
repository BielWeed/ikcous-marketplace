// A tela do caixa de balcão (tarefa C3.2, plano §5.3 e §5.6). VIEW FINA
// de propósito: todo o cérebro mora em `useVendaPresencial` (C3.1) e cada
// seção (Cupom/Cliente/Fechamento/Recibo) só recebe `estado`/`despachar` —
// esta view é a ÚNICA que chama Supabase, e injeta as três buscas por prop
// nas seções de baixo.
//
// O CAMINHO DO ARQUIVO TEM UM MAPA: `vite.config.ts` (`identityEntries`) dá a
// `src/views/admin/AdminPdvView.tsx` o nome de chunk `PdvBalcao` — mudar o
// caminho exige mudar o mapa junto. Esta tela NÃO está no precache do service
// worker: o balcão é do painel e vai pela rede (ele não precisa funcionar sem
// internet — dono, 28/10/2026; ver `scripts/precacheSemPainel.ts`).
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
import { AvisoDeVendaAntiga } from "@/components/admin/pdv/AvisoDeVendaAntiga";
import { BuscaDeProduto } from "@/components/admin/pdv/BuscaDeProduto";
import type {
  PaginaDeProdutosEncontrados,
  ProdutoEncontradoNaBusca,
} from "@/components/admin/pdv/BuscaDeProduto";
import { ClienteDaVenda } from "@/components/admin/pdv/ClienteDaVenda";
import type {
  LinhaDeClienteEncontrado,
  PaginaDeClientesEncontrados,
} from "@/components/admin/pdv/ClienteDaVenda";
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
import {
  fraseDaFalhaDoCodigo,
  precosDaVendaRecusada,
} from "@/lib/erro-da-venda-presencial";
import type { Leitura } from "@/lib/leitor/decodificador";
import {
  PRAZO_DA_CONSULTA_DO_PAINEL_MS,
  aguardarComPrazo,
  erroDeConsultaSemResposta,
} from "@/lib/prazo-da-requisicao";
import { rotuloDaVariacao } from "@/lib/rotulo-da-variacao";
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

/** Quanto a tela espera pela consulta de um código bipado antes de avisar que
 * a conexão está lenta. É só leitura: passado o prazo, a resposta que chegar
 * depois é descartada, então quem bipa de novo não leva a peça em dobro. */
const PRAZO_DA_CONSULTA_DO_CODIGO_MS = 10_000;

/** Quanto o recibo espera pelo tamanho/cor de uma peça que a tela não tem. A
 * venda JÁ está gravada: passado o prazo, o recibo sai sem o rótulo. */
const PRAZO_DO_ROTULO_DA_VARIACAO_MS = 4_000;

export interface AdminPdvViewProps {
  readonly onNavigate: (view: View, id?: string) => void;
  readonly active?: boolean;
  /** O painel passa o mesmo conjunto de props a todas as telas; o balcão não
   * o usa (venda em andamento não é "alteração não salva" — ver o comentário
   * de `vendaEmAndamento`). */
  readonly onSetDirty?: (dirty: boolean) => void;
  readonly onSetBackOverride?: (fn: (() => void) | null) => void;
}

export function AdminPdvView({
  onNavigate,
  active,
  onSetBackOverride,
}: AdminPdvViewProps): ReactElement {
  // L10: o rascunho do caixa é do usuário que está nele (`:<uid>`).
  const { user } = useAuth();
  const {
    estado,
    despachar,
    subtotal,
    limparCupom: limparCupomDaVenda,
    rascunhoAntigo,
    continuarVendaAntiga,
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
  // Desvio de USO ÚNICO da devolução da entrada no recibo (ver o ramo
  // `recibo` abaixo): o engolidor que o efeito do Voltar registra no lugar do
  // `null`, e os dois relógios (a devolução e a rede de segurança).
  const engolidorDoReciboRef = useRef<(() => void) | null>(null);
  const relogioDaDevolucaoRef = useRef<
    ReturnType<typeof setTimeout> | undefined
  >(undefined);
  const relogioDoEngolidorRef = useRef<
    ReturnType<typeof setTimeout> | undefined
  >(undefined);
  useEffect(
    () => () => {
      clearTimeout(relogioDaDevolucaoRef.current);
      clearTimeout(relogioDoEngolidorRef.current);
      engolidorDoReciboRef.current = null;
    },
    [],
  );
  useEffect(() => {
    if (camadaAberta) {
      // Nova camada antes de o popstate da devolução chegar: o desvio da
      // camada assume e a devolução pendente deixa de valer.
      clearTimeout(relogioDaDevolucaoRef.current);
      clearTimeout(relogioDoEngolidorRef.current);
      engolidorDoReciboRef.current = null;
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
        if (estado.etapa === "recibo" && !onSetBackOverride) {
          // Sem quem consuma o Voltar (o App sempre passa), não há como
          // engolir o popstate: só limpa a marca, sem navegar.
          window.history.replaceState(
            {},
            "",
            window.location.pathname + window.location.search,
          );
        } else if (estado.etapa === "recibo" && onSetBackOverride) {
          // VENDA REGISTRADA: a entrada tem de ser CONSUMIDA de verdade. O
          // `replaceState({})` que havia aqui só apagava a marca e deixava a
          // entrada no histórico: cada venda somava uma, e o Voltar do celular
          // "não fazia nada" uma vez por venda (o App vê "mesma tela").
          //
          // Mas o `history.back()` dispara um popstate que corre ANTES do dirty
          // cair no painel (efeitos passivos perdem para a tarefa do popstate)
          // — e o diálogo "alterações não salvas" abria sobre o RECIBO de uma
          // venda já registrada (relato do dono, 19/09). Por isso o `back()`
          // vai com um desvio de USO ÚNICO (mesmo desenho do Financeiro): o
          // efeito do Voltar, logo abaixo, registra o engolidor no lugar do
          // `null`, e o popstate dessa devolução cai nele, antes do gate de
          // dirty do App. O `back()` sai numa macrotarefa própria, para o
          // painel já ter recebido o desvio e o dirty limpo.
          const soltar = () => {
            clearTimeout(relogioDaDevolucaoRef.current);
            clearTimeout(relogioDoEngolidorRef.current);
            if (engolidorDoReciboRef.current !== engolidor) return;
            engolidorDoReciboRef.current = null;
            onSetBackOverride(null);
          };
          const engolidor = () => soltar();
          engolidorDoReciboRef.current = engolidor;
          // Rede de segurança: se o popstate nunca chegar, o desvio não pode
          // ficar preso engolindo o Voltar de verdade.
          relogioDoEngolidorRef.current = setTimeout(soltar, 1500);
          relogioDaDevolucaoRef.current = setTimeout(() => {
            // Só se a entrada ainda for a nossa: se o lojista já voltou pelo
            // aparelho, o navegador a consumiu e não há o que devolver.
            if (window.history.state?.modal === "pdv") window.history.back();
          }, 0);
        } else {
          window.history.back();
        }
      }
    }
  }, [camadaAberta, estado.etapa, onSetBackOverride]);

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
      // Recibo recém-aberto: este efeito roda DEPOIS do de histórico (acima),
      // que deixa o engolidor da devolução armado — ele tem de vencer o `null`.
      const engolidor = engolidorDoReciboRef.current;
      onSetBackOverride(engolidor ? () => engolidor : null);
    }
    return () => {
      onSetBackOverride(null);
    };
  }, [camadaAberta, estado.etapa, onSetBackOverride, despachar]);

  // Venda em andamento (cupom com peça, sem recibo) NÃO é "alteração não
  // salva": o cupom é gravado no aparelho (`useVendaPresencial`, inclusive ao
  // sair da tela) e volta quando o balcão é reaberto. Por isso a tela NÃO liga
  // o `dirty` do painel — ele abria "Alterações Não Salvas — serão perdidas
  // permanentemente" ao tocar em outra aba, no Voltar ou em "Cadastrar
  // produto", o que era falso e prendia a lojista na tela com medo de perder a
  // venda. Navegar com cupom montado simplesmente navega.
  //
  // O que o `dirty` fazia "de brinde" (segurar o aviso de atualização do app)
  // continua valendo, pelo registro de operações sensíveis: com peça no cupom
  // a atualização espera, e solta quando a venda acaba ou a tela fecha. Depois
  // da venda registrada a marca do cupom cai (o recibo tem a sua própria,
  // abaixo) — por isso a derivação olha `recibo`, não só `itens.length`.
  const vendaEmAndamento = estado.itens.length > 0 && estado.recibo === null;
  useEffect(() => {
    if (!vendaEmAndamento) return;
    return marcarOperacaoSensivel("venda-em-andamento-do-pdv");
  }, [vendaEmAndamento]);

  // O recibo vive SÓ em memória (useVendaPresencial não o grava no rascunho
  // de propósito) e a marca da venda em andamento cai quando ele aparece —
  // então, sozinho, nada
  // segurava uma atualização esperando: a lojista toca em "Enviar por
  // WhatsApp", o app vai para segundo plano (ponto de parada do momento
  // seguro), a atualização instala e o recibo some antes de ser enviado.
  // Enquanto o recibo está na tela, marca operação sensível: a instalação e o
  // veto de recarga esperam até "Nova venda" (ou até a tela ser fechada — o
  // cleanup solta a marca nos dois casos). Dep booleana: só marca/solta na
  // mudança de "há recibo", não a cada render.
  const haRecibo = estado.recibo !== null;
  useEffect(() => {
    if (!haRecibo) return;
    return marcarOperacaoSensivel("recibo-do-pdv");
  }, [haRecibo]);

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
    //
    // Com prazo: rede "pendurada" conecta e não responde, e sem ele o aparelho
    // apitava e nada mais acontecia. É uma LEITURA (nada é gravado), então
    // desistir de esperar é seguro; a resposta tardia é descartada.
    const { data, error } = await aguardarComPrazo(
      Promise.resolve(
        supabase.rpc("buscar_por_codigo_barras", {
          p_codigo: codigo,
        }),
      ),
      PRAZO_DA_CONSULTA_DO_CODIGO_MS,
      () => erroDeConsultaSemResposta(),
    );
    if (error) throw error;
    return data as unknown as RespostaDoCodigo;
  }

  // Quantas consultas de código estão no ar. Conta (não é um sim/não): dois
  // bips pendurados a seguir valem duas consultas, e o aviso só some quando a
  // última termina.
  const [consultasDeCodigoNoAr, setConsultasDeCodigoNoAr] = useState(0);

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
    setConsultasDeCodigoNoAr((n) => n + 1);
    try {
      const resposta = await buscarPorCodigo(leitura.codigo);
      if (chaveDaLeitura !== chaveDaVendaRef.current) return;
      despachar({
        tipo: "codigo_resolvido",
        codigo: leitura.codigo,
        resposta,
        em: Date.now(),
        deTeclado: leitura.deTeclado === true,
      });
    } catch (erro) {
      console.error("Erro ao consultar código de barras no balcão:", erro);
      toast.error(fraseDaFalhaDoCodigo(erro));
    } finally {
      setConsultasDeCodigoNoAr((n) => n - 1);
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
  ): Promise<PaginaDeClientesEncontrados> {
    const rodada = ++rodadaClientesRef.current;
    // Com prazo: rede "pendurada" conecta e não responde, e sem ele a tela
    // ficava em "Buscando…" para sempre. É uma LEITURA: desistir de esperar é
    // seguro e a resposta tardia é descartada. Estourou = cai no erro de busca
    // que a tela já mostra, e repetir o mesmo termo refaz a consulta.
    const { data, error } = await aguardarComPrazo(
      Promise.resolve(
        supabase.rpc("get_admin_customers_paged", {
          p_search: termo,
          p_sort_field: "created_at",
          p_sort_direction: "desc",
          p_page: 0,
          p_page_size: 8,
        }),
      ),
      PRAZO_DA_CONSULTA_DO_PAINEL_MS,
      () => erroDeConsultaSemResposta(),
    );
    if (rodada !== rodadaClientesRef.current) return { clientes: [], total: 0 };
    if (error) throw error;
    const clientes = ((data as any)?.data ?? []) as LinhaDeClienteEncontrado[];
    // `total_count` é quantas contas o termo acha no banco inteiro, não só
    // nas 8 desta página — é o que deixa a tela avisar que há mais.
    const total = Number((data as any)?.total_count);
    return {
      clientes,
      total: Number.isFinite(total) ? total : clientes.length,
    };
  }

  async function buscarProdutos(
    termo: string,
    pagina: number,
  ): Promise<PaginaDeProdutosEncontrados> {
    const rodada = ++rodadaProdutosRef.current;
    // Com prazo, pelo mesmo motivo da busca de clientes acima: leitura, então
    // desistir de esperar é seguro; estourou = a falha de busca com "Tentar de
    // novo" (que repete a MESMA página) e a resposta tardia é descartada.
    const { data, error } = await aguardarComPrazo(
      Promise.resolve(
        supabase.rpc("get_admin_products_paged", {
          p_search: termo,
          p_category: "all",
          p_status: "active",
          p_stock: "all",
          p_page: pagina,
          p_page_size: 8,
        }),
      ),
      PRAZO_DA_CONSULTA_DO_PAINEL_MS,
      () => erroDeConsultaSemResposta(),
    );
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
    const nome = (pedido.customer_name ?? "").trim();
    if (pedido.user_id) {
      // Cliente cadastrada sem nome no perfil: o banco grava o literal de
      // venda sem cliente (ver acima). Na tela de escolher a cliente isso já
      // é "Cliente" (ClienteDaVenda.tsx); o recibo diz o mesmo, não "Venda no
      // balcão" — que ela não é.
      return {
        tipo: "cadastrado",
        userId: pedido.user_id,
        nome:
          nome === "" || nome === NOME_DE_VENDA_SEM_CLIENTE ? "Cliente" : nome,
        whatsapp,
      };
    }
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
  //
  // `rotulos` (variant_id → "Tamanho M") cobre a peça gravada que a TELA não
  // tem mais (retentativa depois de a lojista tirar a peça): sem ele ela sairia
  // sem tamanho/cor no recibo, no papel e no aviso "a venda gravada tem a mais".
  function montarItensDoRecibo(
    itensGravados: readonly ItemGravadoNoPedido[],
    rotulos: Readonly<Record<string, string>>,
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
        variacao:
          doCarrinho?.variacao ??
          (gravado.variant_id ? rotulos[gravado.variant_id] : undefined) ??
          null,
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

  // O rótulo da variação das peças gravadas que o cupom da tela não explica,
  // lido em `product_variants` (o mesmo `rotuloDaVariacao` da ficha do pedido).
  // Peça que a tela explica não gera consulta. Enfeite: se a leitura falhar ou
  // estourar o prazo, devolve vazio e o recibo sai sem o rótulo, nunca quebra.
  async function rotulosDasPecasForaDaTela(
    itensGravados: readonly ItemGravadoNoPedido[],
  ): Promise<Record<string, string>> {
    const ids = new Set<string>();
    for (const gravado of itensGravados) {
      if (!gravado.variant_id) continue;
      const doCarrinho = estado.itens.find(
        (item) =>
          item.productId === gravado.product_id &&
          item.variantId === gravado.variant_id,
      );
      if (!doCarrinho?.variacao) ids.add(gravado.variant_id);
    }
    if (ids.size === 0) return {};
    try {
      const { data, error } = await aguardarComPrazo(
        Promise.resolve(
          supabase
            .from("product_variants")
            .select("id, name, value")
            .in("id", [...ids]),
        ),
        PRAZO_DO_ROTULO_DA_VARIACAO_MS,
        () => new Error("A leitura da variação não respondeu a tempo."),
      );
      if (error || !data) return {};
      const lidos: Record<string, string> = {};
      for (const v of data) {
        const rotulo = rotuloDaVariacao(v.name, v.value);
        if (rotulo) lidos[v.id] = rotulo;
      }
      return lidos;
    } catch {
      return {};
    }
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
            // Avulso e CADASTRADO mandam o WhatsApp: o recibo liga o "Enviar
            // por WhatsApp" a partir do que o banco gravou aqui. Sem cliente,
            // ou cadastrado sem WhatsApp no perfil, vai null.
            p_cliente_whatsapp:
              estado.cliente.tipo === "sem_cliente"
                ? null
                : estado.cliente.whatsapp,
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

      const rotulos = await rotulosDasPecasForaDaTela(resposta.items);

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
        itens: montarItensDoRecibo(resposta.items, rotulos),
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

      {/* Cupom que voltou e NÃO é de hoje: a lojista decide (continuar ou
          descartar); nada é registrado nem apagado sozinho. */}
      {rascunhoAntigo && estado.etapa === "cupom" && (
        <AvisoDeVendaAntiga
          salvoEm={rascunhoAntigo.salvoEm}
          lidoEm={rascunhoAntigo.lidoEm}
          aoContinuar={continuarVendaAntiga}
          aoDescartar={limparCupom}
        />
      )}

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

      {/* Texto VISÍVEL (a câmera só tem o "Código lido" para leitor de tela):
          o aparelho já apitou, e sem isto parecia que o bip tinha falhado. */}
      {estado.etapa === "cupom" && consultasDeCodigoNoAr > 0 && (
        <p role="status" className="pdv-heading">
          Consultando…
        </p>
      )}

      {estado.etapa !== "recibo" && (
        <div
          id="busca-do-balcao"
          role="tabpanel"
          aria-labelledby="modo-buscar-produto"
          hidden={estado.etapa !== "cupom" || modoDeProduto !== "buscar"}
        >
          <BuscaDeProduto
            onNavigate={onNavigate}
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
