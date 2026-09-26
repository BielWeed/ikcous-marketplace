// @vitest-environment jsdom
//
// Só este arquivo precisa de DOM (`document`) para o carregamento do SDK do
// Brick. O resto da suíte roda em `environment: "node"` (vitest.config.ts) —
// não subimos jsdom globalmente por um único arquivo.
import { PagamentoOnline } from "@/components/checkout/PagamentoOnline";
import { lerFlagPagamentoOnline } from "@/lib/flags";
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// `PagamentoOnline` importa `useOrders`, que importa `@/lib/supabase` — e esse
// módulo lê VITE_SUPABASE_URL/VITE_SUPABASE_ANON_KEY em `@/lib/env` e EXPLODE
// (por design, ver env.ts) se faltarem. Os testes abaixo não chamam nada do
// Supabase de verdade — `criarPagamento` chega como dublê nos testes de
// `dispararPagamentoPix`, e os de `carregarSdkMercadoPago` nem importam esse caminho —
// então o dublê fica vazio. Mesmo padrão de `create-order-rpc.test.ts`.
vi.mock("@/lib/supabase", () => ({
  supabase: {
    rpc: vi.fn(),
    functions: { invoke: vi.fn() },
  },
}));

// Mocado também para o describe de renderização real: precisamos que
// `criarPagamento` seja uma referência ESTÁVEL entre re-renders — exatamente
// o contrato real (`useCallback(..., [])` em useOrders.ts:958-1003) — sem
// carregar useAuth/useLeaderElection/os efeitos de sincronização do
// `useOrders` de verdade, que não são o que este arquivo testa. Declarada via
// `vi.hoisted` (mesmo padrão de checkout-guest-cep.test.tsx e
// address-form-cep-race.test.tsx) — é o mecanismo do Vitest para uma `const`
// sobreviver ao hoisting do `vi.mock` para o topo do arquivo — assim a
// factory e o helper `renderComPix` (mais abaixo) compartilham a MESMA
// referência sem que o teste precise invocar o hook para alcançá-la.
const { criarPagamento } = vi.hoisted(() => ({ criarPagamento: vi.fn() }));

vi.mock("@/hooks/useOrders", () => ({
  useOrders: () => ({ criarPagamento }),
}));

// Este arquivo não usa @testing-library — só `act` puro (ver o describe
// "PagamentoOnline (render de verdade)") — e sem este flag o React avisa
// "not configured to support act(...)" em todo render, mesmo dentro de
// act(). @testing-library seta isto por trás das cortinas; aqui setamos à
// mão.
// @ts-expect-error flag interna do React, sem tipo público
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

describe("flag de pagamento online", () => {
  it("liga apenas com a string exata 'true'", () => {
    expect(lerFlagPagamentoOnline("true")).toBe(true);
  });

  it("fica desligada para tudo o mais — inclusive ausente", () => {
    // Falha fechada de propósito: enquanto o webhook não existe (Fase 3),
    // ligar por engano faz TODO pedido pago expirar em 30 minutos.
    for (const v of [undefined, "", "false", "TRUE", "1", "yes", " true"]) {
      expect(lerFlagPagamentoOnline(v)).toBe(false);
    }
  });
});

/**
 * `carregarSdkMercadoPago` guarda a promessa em variável de MÓDULO — é isso que
 * impede o StrictMode de injetar duas tags. O efeito colateral é que o segundo
 * teste herdaria a promessa já resolvida do primeiro e nunca injetaria script
 * nenhum. Por isso cada teste reimporta o módulo do zero.
 */
async function importarLimpo() {
  vi.resetModules();
  return await import("@/components/checkout/PagamentoOnline");
}

/**
 * Espera a fila de microtarefas drenar por inteiro (inclusive as que uma
 * promise resolvida agenda outras, em cadeia). Um `setTimeout(0)` funciona
 * porque o event loop só passa para a próxima macrotarefa depois de esvaziar
 * a fila de microtarefas — mesmo as que foram enfileiradas durante o dreno.
 * Preferido a `vi.waitFor` (que não está disponível nesta versão do vitest
 * sem `@testing-library`) e mais confiável que contar `await Promise.resolve()`
 * à mão, que quebra se a cadeia de `await`s do componente crescer.
 */
function esperarMicrotarefas(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

describe("carregarSdkMercadoPago", () => {
  beforeEach(() => {
    document.head.innerHTML = "";
  });

  afterEach(() => {
    document.querySelectorAll("script[data-mp-sdk]").forEach((s) => s.remove());
    // @ts-expect-error limpando o global entre testes
    globalThis.MercadoPago = undefined;
    vi.restoreAllMocks();
  });

  it("injeta a tag uma vez só, mesmo com duas chamadas", async () => {
    const { carregarSdkMercadoPago } = await importarLimpo();
    const p1 = carregarSdkMercadoPago();
    const p2 = carregarSdkMercadoPago();

    const tags = document.querySelectorAll("script[data-mp-sdk]");
    expect(tags.length).toBe(1);

    // @ts-expect-error simulando o SDK ficando pronto
    globalThis.MercadoPago = () => {};
    tags[0].dispatchEvent(new Event("load"));

    await expect(p1).resolves.toBeUndefined();
    await expect(p2).resolves.toBeUndefined();
  });

  it("rejeita quando o script não carrega", async () => {
    const { carregarSdkMercadoPago } = await importarLimpo();
    const p = carregarSdkMercadoPago();
    const tag = document.querySelector("script[data-mp-sdk]")!;
    tag.dispatchEvent(new Event("error"));
    await expect(p).rejects.toThrow();
  });

  // Revisão da Task 4: o teste acima ("injeta a tag uma vez só") sobrevive à
  // remoção de QUALQUER UM dos dois mecanismos que fazem isso acontecer — só
  // morre se os dois sumirem juntos, porque um cobre o outro. Os dois testes
  // abaixo isolam cada mecanismo, para que cada um tenha um teste que morre
  // sozinho quando ele some.
  it("chamadas repetidas devolvem a MESMA promessa — memoização de módulo", async () => {
    const { carregarSdkMercadoPago } = await importarLimpo();
    const p1 = carregarSdkMercadoPago();
    const p2 = carregarSdkMercadoPago();

    // Identidade, não só resultado: sem o `if (promessaSdk) return
    // promessaSdk`, a segunda chamada monta uma Promise NOVA (mesmo que o
    // reuso da tag via querySelector, testado abaixo, ainda evite uma
    // segunda tag no DOM — por isso o teste de contagem de tags não pega
    // essa mutação sozinho).
    expect(p1).toBe(p2);

    // @ts-expect-error simulando o SDK ficando pronto
    globalThis.MercadoPago = () => {};
    document
      .querySelector("script[data-mp-sdk]")!
      .dispatchEvent(new Event("load"));
    await expect(p1).resolves.toBeUndefined();
  });

  it("reaproveita a tag do DOM mesmo com o módulo reimportado do zero", async () => {
    // Reimportar o módulo zera a memoização de `promessaSdk` (é um closure
    // novo), sem tocar o DOM — isola o reuso via `querySelector` do reuso
    // via variável de módulo, que o teste anterior já cobre.
    const primeira = await importarLimpo();
    primeira.carregarSdkMercadoPago();
    expect(document.querySelectorAll("script[data-mp-sdk]").length).toBe(1);

    const segunda = await importarLimpo();
    segunda.carregarSdkMercadoPago();

    // Sem o `existente = document.querySelector(...)`, esta segunda chamada
    // (módulo novo, `promessaSdk` null de novo) criaria e anexaria uma tag
    // NOVA em vez de reaproveitar a que já está no head.
    expect(document.querySelectorAll("script[data-mp-sdk]").length).toBe(1);
  });

  // B3 da revisão: o listener de erro zerava `promessaSdk` mas deixava a tag
  // morta no head. A chamada seguinte achava essa tag via querySelector,
  // pulava o `src`/`appendChild` (guardados atrás de `if (!existente)`) e os
  // listeners novos nunca recebiam evento nenhum — nem resolve, nem rejeita.
  it("depois de uma falha de rede, a chamada seguinte também rejeita — não pendura", async () => {
    const { carregarSdkMercadoPago } = await importarLimpo();

    const p1 = carregarSdkMercadoPago();
    const tag1 = document.querySelector("script[data-mp-sdk]")!;
    tag1.dispatchEvent(new Event("error"));
    await expect(p1).rejects.toThrow();

    // A tag morta não pode sobrar: é o rastro que prova o remove().
    expect(document.querySelector("script[data-mp-sdk]")).toBeNull();

    const p2 = carregarSdkMercadoPago();
    const tag2 = document.querySelector("script[data-mp-sdk]");
    expect(tag2).not.toBeNull();
    expect(tag2).not.toBe(tag1);
    tag2!.dispatchEvent(new Event("error"));
    await expect(p2).rejects.toThrow();
  });
});

// Tipo das opções de `dispararPagamentoPix`, extraído do próprio módulo
// (fonte única de verdade) em vez de duplicado à mão aqui. Fica no nível do
// arquivo — não dentro do describe — porque em 80 colunas o formatter do
// biome quebra a linha do `typeof import(...)` em várias, e o esbuild do vite
// não faz o parse de `typeof import(\n "...",\n)` com vírgula à direita.
//
// 26/09/2026: o describe de `montarBrick` (Payment Brick só-PIX, sem caller
// em produção desde o PIX direto de 25/09) saiu junto com a função. O ciclo
// de vida do Brick (StrictMode, desmontagem, create em voo, SDK que não
// carrega, texto do bundle que não vaza) é provado agora no Brick de CARTÃO,
// em pagamento-com-cartao.test.tsx; a classificação da resposta do PIX
// (recusado/expirado/estornado/desconhecido/ausente) passou para o describe
// de `dispararPagamentoPix`, abaixo — o único caminho que a usa.
type ModuloComponente = typeof import("@/components/checkout/PagamentoOnline");
type OpcoesDispararPagamentoPix = Parameters<
  ModuloComponente["dispararPagamentoPix"]
>[0];

// Pedido do dono (25/09/2026): depois de escolher "Pagar agora com PIX", o
// cliente caía na tela do Payment Brick pedindo pra escolher Pix DE NOVO e
// digitar um e-mail que a conta já tem. `dispararPagamentoPix` substitui o
// `onSubmit` do Brick como origem do disparo — a classificação de resposta
// (`classificarRespostaPagamento`) é provada aqui, status a status.
describe("dispararPagamentoPix", () => {
  function opcoesPadrao(
    sobrepor: Partial<OpcoesDispararPagamentoPix> = {},
  ): OpcoesDispararPagamentoPix {
    return {
      orderId: "ped-1",
      criarPagamento: vi.fn(),
      onErro: vi.fn(),
      onPix: vi.fn(),
      ...sobrepor,
    };
  }

  function respostaPixOk(sobrepor: Record<string, unknown> = {}) {
    return {
      paymentId: "pay-1",
      statusPagamento: "aguardando",
      expiraEm: "2026-09-25T12:00:00.000Z",
      qrCode: "000201...",
      qrCodeBase64: "abc123",
      ...sobrepor,
    };
  }

  // Teste 1 do brief: ao montar, chama criar-pagamento com metodo "pix" DIRETO
  // — sem interação nenhuma com Brick ou SDK (nem `document.head`, nem
  // `globalThis.MercadoPago` são tocados neste describe inteiro) — e o QR
  // aparece assim que a resposta volta.
  it("dispara criarPagamento com metodo 'pix' uma vez ao montar, sem Brick, e entrega o QR", async () => {
    const { dispararPagamentoPix } = await importarLimpo();
    const onPix = vi.fn();
    const criarPagamento = vi.fn().mockResolvedValue(respostaPixOk());

    dispararPagamentoPix(opcoesPadrao({ criarPagamento, onPix }));
    await esperarMicrotarefas();

    expect(criarPagamento).toHaveBeenCalledTimes(1);
    // Nem `email` nem `documento`: a conta já logada não precisa digitar de
    // novo o que o servidor já resolve sozinho (criar-pagamento/index.ts).
    expect(criarPagamento).toHaveBeenCalledWith({
      orderId: "ped-1",
      metodo: "pix",
    });
    expect(onPix).toHaveBeenCalledWith({
      qrCodeBase64: "abc123",
      qrCode: "000201...",
      expiraEm: "2026-09-25T12:00:00.000Z",
    });
  });

  // Teste 2 do brief: StrictMode monta o efeito, desmonta e remonta de forma
  // SÍNCRONA (tudo antes de qualquer microtarefa rodar) — sem o cache por
  // `orderId`, a segunda montagem chamaria `criarPagamento` de novo antes da
  // primeira resposta voltar, duplicando a cobrança.
  it("StrictMode (mount → cleanup → mount antes da resposta voltar) chama criarPagamento uma vez só", async () => {
    const { dispararPagamentoPix } = await importarLimpo();
    let resolverCriacao!: (v: ReturnType<typeof respostaPixOk>) => void;
    const criarPagamento = vi.fn(
      () =>
        new Promise<ReturnType<typeof respostaPixOk>>((resolve) => {
          resolverCriacao = resolve;
        }),
    );
    const onPix = vi.fn();

    const cleanup1 = dispararPagamentoPix(
      opcoesPadrao({ criarPagamento, onPix }),
    );
    cleanup1(); // "fake unmount" do StrictMode, ANTES da resposta voltar
    const cleanup2 = dispararPagamentoPix(
      opcoesPadrao({ criarPagamento, onPix }),
    );

    resolverCriacao(respostaPixOk());
    await esperarMicrotarefas();

    expect(criarPagamento).toHaveBeenCalledTimes(1);
    // Só a segunda montagem (a que sobreviveu) repassa o QR — a primeira
    // ficou cancelada e não chama nada.
    expect(onPix).toHaveBeenCalledTimes(1);
    cleanup2();
  });

  // Teste 3 do brief: erro recuperável mostra "Tentar de novo" (CheckoutView)
  // e a nova tentativa — uma REMONTAGEM de verdade do componente, não o
  // StrictMode — chama criarPagamento de novo. Pelo momento em que o cliente
  // consegue clicar, a promessa anterior já assentou (o onErro já disparou) e
  // já saiu do cache — é isso que este teste prova.
  it("erro recuperável chama onErro com 'recuperavel', e uma nova tentativa (remontagem) chama criarPagamento de novo", async () => {
    const { dispararPagamentoPix } = await importarLimpo();
    const onErro = vi.fn();
    const criarPagamento = vi
      .fn()
      .mockRejectedValueOnce(new Error("Não foi possível gerar a cobrança."));

    const cleanup1 = dispararPagamentoPix(
      opcoesPadrao({ criarPagamento, onErro, onPix: vi.fn() }),
    );
    await esperarMicrotarefas();

    expect(onErro).toHaveBeenCalledWith(
      "Não foi possível gerar a cobrança.",
      "recuperavel",
    );
    cleanup1(); // o CheckoutView trocou a tela por "Tentar de novo"

    criarPagamento.mockResolvedValueOnce(respostaPixOk());
    const onPix2 = vi.fn();
    dispararPagamentoPix(
      opcoesPadrao({ criarPagamento, onErro, onPix: onPix2 }),
    );
    await esperarMicrotarefas();

    expect(criarPagamento).toHaveBeenCalledTimes(2);
    expect(onPix2).toHaveBeenCalledTimes(1);
  });

  // Teste 4 do brief: erro terminal não pode virar loop — uma chamada só,
  // mesmo esperando uma folga extra de microtarefas (se houvesse retentativa
  // automática escondida em algum `.then`, apareceria aqui).
  it("erro terminal chama onErro com 'terminal' uma vez só — sem retentativa automática", async () => {
    const { dispararPagamentoPix } = await importarLimpo();
    const onErro = vi.fn();
    const erro = Object.assign(
      new Error(
        "Este pagamento foi recusado e não pode ser tentado novamente neste pedido. Faça um pedido novo ou fale com a loja.",
      ),
      { terminal: true },
    );
    const criarPagamento = vi.fn().mockRejectedValue(erro);

    dispararPagamentoPix(
      opcoesPadrao({ criarPagamento, onErro, onPix: vi.fn() }),
    );
    await esperarMicrotarefas();
    await esperarMicrotarefas(); // folga extra: um loop apareceria aqui

    expect(onErro).toHaveBeenCalledTimes(1);
    expect(onErro).toHaveBeenCalledWith(erro.message, "terminal");
    expect(criarPagamento).toHaveBeenCalledTimes(1);
  });

  // Portados do antigo describe de `montarBrick` (CHECKOUT-080, #213): cada
  // status terminal tem a SUA mensagem, e nenhum deles vira QR. 'recusado'
  // não fala em cartão nem sugere tentar de novo NESTE pedido pelo PIX
  // (`reconsultar` devolve a MESMA cobrança recusada). Status desconhecido
  // (o par cru "status:detalhe" da reconsulta) e AUSENTE (function antiga
  // ainda no ar na janela de deploy) caem na rede de segurança — nunca
  // sucesso silencioso, mesmo com QR no corpo.
  it.each([
    [
      "recusado",
      "Este pagamento foi recusado e não pode ser tentado novamente neste pedido. Faça um pedido novo ou fale com a loja.",
    ],
    [
      "expirado",
      "O prazo deste PIX venceu antes do pagamento ser confirmado. Faça um pedido novo para gerar um QR code novo.",
    ],
    [
      "estornado",
      "Este pagamento foi estornado e não pode ser confirmado neste pedido. Faça um pedido novo ou fale com a loja.",
    ],
    ["in_mediation:um_detalhe_novo", "Não foi possível confirmar o pagamento."],
    [undefined, "Não foi possível confirmar o pagamento."],
  ])(
    "statusPagamento %s é terminal, com mensagem própria, e não vira QR",
    async (statusPagamento, mensagem) => {
      const { dispararPagamentoPix } = await importarLimpo();
      const onErro = vi.fn();
      const onPix = vi.fn();
      const criarPagamento = vi
        .fn()
        .mockResolvedValue(respostaPixOk({ statusPagamento }));

      dispararPagamentoPix(opcoesPadrao({ criarPagamento, onErro, onPix }));
      await esperarMicrotarefas();

      expect(onErro).toHaveBeenCalledTimes(1);
      expect(onErro).toHaveBeenCalledWith(mensagem, "terminal");
      expect(onPix).not.toHaveBeenCalled();
      if (statusPagamento === "recusado") {
        expect(mensagem).not.toMatch(/cart[aã]o/i);
      }
    },
  );

  it("statusPagamento 'pago' com QR ainda entrega o QR (a confirmação vem do CheckoutView)", async () => {
    const { dispararPagamentoPix } = await importarLimpo();
    const onPix = vi.fn();
    const criarPagamento = vi
      .fn()
      .mockResolvedValue(respostaPixOk({ statusPagamento: "pago" }));

    dispararPagamentoPix(opcoesPadrao({ criarPagamento, onPix }));
    await esperarMicrotarefas();

    expect(onPix).toHaveBeenCalledTimes(1);
  });

  // Rede de segurança: sem QR (os dois campos ausentes) é recuperável, MESMO
  // com statusPagamento "conhecido".
  it("resposta sem QR (qrCode e qrCodeBase64 ausentes) chama onErro com 'recuperavel', não onPix", async () => {
    const { dispararPagamentoPix } = await importarLimpo();
    const onErro = vi.fn();
    const onPix = vi.fn();
    const criarPagamento = vi.fn().mockResolvedValue({
      paymentId: "pay-1",
      statusPagamento: "aguardando",
      expiraEm: "2026-09-25T12:00:00.000Z",
    });

    dispararPagamentoPix(opcoesPadrao({ criarPagamento, onErro, onPix }));
    await esperarMicrotarefas();

    expect(onErro).toHaveBeenCalledWith(
      "Não foi possível gerar o QR code do PIX.",
      "recuperavel",
    );
    expect(onPix).not.toHaveBeenCalled();
  });
});

// Revisão da rodada de correção 1: remover o `jaMontou` (para o StrictMode
// funcionar, B1) amarrou a vida do efeito à identidade de `onErro` — um prop
// que, na forma natural de escrever a Task 5 (`onErro={(m) => setErro(m)}`),
// é um closure NOVO a cada render do pai. Com `onErro` nas deps do efeito,
// qualquer re-render (um toast, um evento realtime do useOrders, o contador
// regressivo do prazo) disparava `criarPagamento` de novo, silenciosamente.
//
// Adaptado em 25/09/2026 (pedido do dono: PIX sem Brick): a versão antiga
// media isto pelo número de vezes que o Brick era CRIADO
// (`mp.bricks().create()`); sem Brick nenhum no caminho de PIX, a mesma
// garantia agora se mede pelo número de vezes que `criarPagamento` é
// CHAMADO — o resto do teste (identidade nova de `onErro` a cada render)
// não mudou.
//
// Só um teste que renderiza `PagamentoOnline` de verdade (não só
// `dispararPagamentoPix`) prova isto — a identidade do prop só existe no
// ciclo de render do React, não em uma chamada direta de função.
describe("PagamentoOnline (render de verdade)", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;

  beforeEach(() => {
    hospedeiro = document.createElement("div");
    document.body.appendChild(hospedeiro);
    raiz = createRoot(hospedeiro);
  });

  afterEach(() => {
    act(() => {
      raiz.unmount();
    });
    hospedeiro.remove();
    vi.restoreAllMocks();
  });

  /**
   * Cada chamada de `Pai()` cria um `onErro` NOVO — closure inline, o mesmo
   * padrão que `onErro={(m) => setErro(m)}` produziria na Task 5. É essa
   * identidade nova a cada render que expõe o bug: `<PagamentoOnline />`
   * continua na mesma posição da árvore (mesmo tipo, mesmo pai), então o
   * React RE-renderiza — não remonta — a cada `raiz.render(<Pai />)`.
   */
  function Pai() {
    return <PagamentoOnline orderId="ped-1" valor={100} onErro={() => {}} />;
  }

  it("re-render do pai com onErro inline NÃO dispara criarPagamento de novo", async () => {
    criarPagamento.mockReset().mockResolvedValue({
      paymentId: "pay-1",
      statusPagamento: "aguardando",
      expiraEm: "2026-09-25T12:00:00.000Z",
      qrCode: "000201...",
      qrCodeBase64: "abc123",
    });

    await act(async () => {
      raiz.render(<Pai />);
    });
    await act(async () => {
      await esperarMicrotarefas();
    });

    expect(criarPagamento).toHaveBeenCalledTimes(1);

    // Três re-renders do pai — cada um com `onErro` NOVO. Reproduz a rede: um
    // toast do sonner, um evento realtime, o contador regressivo do prazo.
    for (let i = 0; i < 3; i++) {
      await act(async () => {
        raiz.render(<Pai />);
      });
    }

    expect(criarPagamento).toHaveBeenCalledTimes(1);
  });
});

// `ticket_url` já chega da edge function (mercadopago.ts extrai, criar-pagamento
// devolve como `ticketUrl`) e já está tipado no retorno de `criarPagamento`
// (useOrders.ts) — só faltava a tela repassar e mostrar. Em modo de teste é a
// ÚNICA forma de pagar o PIX simulado (um QR de teste não é reconhecido pelo
// app de nenhum banco real); em produção é a página do MP para acompanhar/
// pagar a mesma cobrança.
describe("PagamentoOnline - link para o ticket_url", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;

  beforeEach(() => {
    hospedeiro = document.createElement("div");
    document.body.appendChild(hospedeiro);
    raiz = createRoot(hospedeiro);
  });

  afterEach(() => {
    act(() => {
      raiz.unmount();
    });
    hospedeiro.remove();
    vi.restoreAllMocks();
  });

  /**
   * Renderiza o componente de verdade e espera a resposta de `criarPagamento`
   * — disparada DIRETO ao montar desde 25/09/2026 (pedido do dono: PIX sem
   * Brick), sem `onSubmit` de Brick nenhum para simular.
   */
  async function renderComPix(respostaPix: Record<string, unknown>) {
    // Mesma referência mocada em todo o arquivo (`vi.hoisted` no topo,
    // compartilhada com a factory do `vi.mock` de "@/hooks/useOrders") —
    // reset explícito porque `vi.restoreAllMocks()` não limpa implementação
    // de um `vi.fn()` puro (sem `vi.spyOn`).
    criarPagamento.mockReset().mockResolvedValue({
      paymentId: "pay-1",
      statusPagamento: "aguardando",
      // Prazo RELATIVO ao relógio real: com a data fixa antiga (06/08/2026)
      // a tela mostraria o aviso de horário previsto já passado (o link
      // continua — o relógio local nunca esconde nada). Este describe é sobre
      // um Pix no prazo; o horário passado é coberto em
      // pix-qr-god-senior-20260924.test.tsx.
      expiraEm: new Date(Date.now() + 30 * 60 * 1000).toISOString(),
      qrCode: "000201...",
      qrCodeBase64: "abc123",
      ...respostaPix,
    });

    await act(async () => {
      raiz.render(
        <PagamentoOnline orderId="ped-1" valor={100} onErro={() => {}} />,
      );
    });
    await act(async () => {
      await esperarMicrotarefas();
    });
  }

  it("com ticketUrl na resposta, o link aparece apontando para o endereço e com rel de segurança", async () => {
    await renderComPix({
      ticketUrl: "https://www.mercadopago.com.br/payments/checkout?id=abc123",
    });

    const link = hospedeiro.querySelector<HTMLAnchorElement>("a[href]");
    expect(link).not.toBeNull();
    expect(link!.href).toBe(
      "https://www.mercadopago.com.br/payments/checkout?id=abc123",
    );
    expect(link!.target).toBe("_blank");
    // rel de segurança para target="_blank" — impede a página aberta de
    // manipular a nossa via window.opener.
    expect(link!.rel.split(" ")).toEqual(
      expect.arrayContaining(["noopener", "noreferrer"]),
    );

    // O QR e o botão de copiar continuam sendo o caminho principal.
    expect(
      hospedeiro.querySelector("img[alt='QR code do PIX']"),
    ).not.toBeNull();
    expect(hospedeiro.textContent).toContain("Copiar código PIX");
  });

  it("sem ticketUrl na resposta, nenhum link é renderizado — QR e botão de copiar continuam lá", async () => {
    await renderComPix({ ticketUrl: undefined });

    expect(hospedeiro.querySelector("a[href]")).toBeNull();
    expect(
      hospedeiro.querySelector("img[alt='QR code do PIX']"),
    ).not.toBeNull();
    expect(hospedeiro.textContent).toContain("Copiar código PIX");
  });
});
