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
// `montarBrick`, e os de `carregarSdkMercadoPago` nem importam esse caminho —
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
// `useOrders` de verdade, que não são o que este arquivo testa. A função é
// criada DENTRO da factory (não numa `const` de fora) para não esbarrar no
// hoisting do `vi.mock` — referenciar uma `const` externa aqui daria "cannot
// access before initialization".
vi.mock("@/hooks/useOrders", () => {
  const criarPagamento = vi.fn();
  return { useOrders: () => ({ criarPagamento }) };
});

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

// Tipo das opções de `montarBrick`, extraído do próprio módulo (fonte única
// de verdade) em vez de duplicado à mão aqui. Fica no nível do arquivo — não
// dentro do describe — porque em 80 colunas o formatter do biome quebra a
// linha do `typeof import(...)` em várias, e o esbuild do vite não faz o
// parse de `typeof import(\n "...",\n)` com vírgula à direita.
type ModuloComponente = typeof import("@/components/checkout/PagamentoOnline");
type OpcoesMontarBrick = Parameters<ModuloComponente["montarBrick"]>[0];

describe("montarBrick", () => {
  beforeEach(() => {
    document.head.innerHTML = "";
    vi.stubEnv("VITE_MP_PUBLIC_KEY", "TEST-000000-0000-0000-0000-000000000000");
  });

  afterEach(() => {
    document.querySelectorAll("script[data-mp-sdk]").forEach((s) => s.remove());
    // @ts-expect-error limpando o global entre testes
    globalThis.MercadoPago = undefined;
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  /** Dispara o `load` do SDK e espera a cadeia de `await`s do componente. */
  async function carregarSdk() {
    const tag = document.querySelector("script[data-mp-sdk]");
    tag?.dispatchEvent(new Event("load"));
    await esperarMicrotarefas();
  }

  function opcoesPadrao(sobrepor: Partial<OpcoesMontarBrick> = {}) {
    return {
      orderId: "ped-1",
      valor: 100,
      criarPagamento: vi.fn(),
      onErro: vi.fn(),
      onPix: vi.fn(),
      ...sobrepor,
    };
  }

  // B1 da revisão: sem essa checagem, a IIFE da montagem CANCELADA pela
  // StrictMode (mount → cleanup → mount, tudo síncrono, antes do SDK acabar
  // de carregar) batia no `if (cancelado) return` DEPOIS de já ter chamado
  // `create()` — ou nem chegava a checar, e criava o Brick duas vezes. Este
  // teste reproduz a sequência exata do bug report: cleanup ANTES do SDK
  // terminar de carregar.
  it("StrictMode (mount → cleanup → mount antes do SDK carregar) cria o Brick uma vez só", async () => {
    const { montarBrick } = await importarLimpo();

    const create = vi.fn().mockResolvedValue({ unmount: vi.fn() });
    // @ts-expect-error stub do SDK
    globalThis.MercadoPago = function MercadoPagoStub() {
      return { bricks: () => ({ create }) };
    };

    const opts = opcoesPadrao();
    const cleanup1 = montarBrick(opts);
    cleanup1(); // "fake unmount" do StrictMode, ANTES do SDK responder
    const cleanup2 = montarBrick(opts);

    await carregarSdk();

    expect(create).toHaveBeenCalledTimes(1);
    expect(opts.onErro).not.toHaveBeenCalled();

    cleanup2();
  });

  // B4 (primeiro caminho): o cliente sai do checkout e volta sem recarregar
  // a página — o componente desmonta de verdade, e o cleanup precisa
  // desmontar o Brick, não só marcar uma variável local.
  it("cleanup depois do Brick montado chama unmount() no controlador", async () => {
    const { montarBrick } = await importarLimpo();

    const unmount = vi.fn();
    const create = vi.fn().mockResolvedValue({ unmount });
    // @ts-expect-error stub do SDK
    globalThis.MercadoPago = function MercadoPagoStub() {
      return { bricks: () => ({ create }) };
    };

    const cleanup = montarBrick(opcoesPadrao());
    await carregarSdk();

    expect(create).toHaveBeenCalledTimes(1);
    expect(unmount).not.toHaveBeenCalled();

    cleanup();

    expect(unmount).toHaveBeenCalledTimes(1);
  });

  // B4 (segundo caminho): o cleanup roda DEPOIS que o cancelamento já
  // aconteceu enquanto `create()` ainda estava em voo — a criação não pode
  // ficar abandonada, senão o `Rt.app` do bundle nunca é limpo e a próxima
  // tentativa esbarra em "Brick already initialized".
  it("cancelar enquanto create() está em voo desmonta o Brick assim que ele termina de montar", async () => {
    const { montarBrick } = await importarLimpo();

    const unmount = vi.fn();
    let resolverCreate!: (v: { unmount: () => void }) => void;
    const create = vi.fn(
      () =>
        new Promise<{ unmount: () => void }>((resolve) => {
          resolverCreate = resolve;
        }),
    );
    // @ts-expect-error stub do SDK
    globalThis.MercadoPago = function MercadoPagoStub() {
      return { bricks: () => ({ create }) };
    };

    const cleanup = montarBrick(opcoesPadrao());
    await carregarSdk(); // a IIFE chega até `await mp.bricks().create(...)` e fica pendurada ali

    cleanup(); // cancela ANTES do create() responder — controlador ainda é null aqui

    resolverCreate({ unmount });
    await esperarMicrotarefas();

    expect(unmount).toHaveBeenCalledTimes(1);
  });

  // A2 da revisão: o `onSubmit` roda DEPOIS que o `await create(...)` já
  // resolveu — fora do try/catch externo. Sem um catch próprio, as quatro
  // mensagens de `criarPagamento` (useOrders.ts:974-980) somem dentro do SDK.
  it("erro dentro do onSubmit chega ao onErro e ainda propaga para o Brick sair de 'processando'", async () => {
    const { montarBrick } = await importarLimpo();

    const create = vi.fn().mockResolvedValue({ unmount: vi.fn() });
    // @ts-expect-error stub do SDK
    globalThis.MercadoPago = function MercadoPagoStub() {
      return { bricks: () => ({ create }) };
    };

    const onErro = vi.fn();
    const criarPagamento = vi
      .fn()
      .mockRejectedValue(new Error("O prazo para pagar este pedido acabou."));

    montarBrick(opcoesPadrao({ criarPagamento, onErro }));
    await carregarSdk();

    const { onSubmit } = create.mock.calls[0][2].callbacks;

    await expect(onSubmit({ formData: { token: "tok-123" } })).rejects.toThrow(
      "O prazo para pagar este pedido acabou.",
    );
    expect(onErro).toHaveBeenCalledWith(
      "O prazo para pagar este pedido acabou.",
    );
  });

  // B4 (terceiro caminho, o mais direto): o próprio componente troca o JSX
  // ao receber o PIX e arranca #mp-container do DOM por baixo do Brick vivo.
  it("ao receber o PIX, desmonta o Brick antes de repassar o QR", async () => {
    const { montarBrick } = await importarLimpo();

    const unmount = vi.fn();
    const create = vi.fn().mockResolvedValue({ unmount });
    // @ts-expect-error stub do SDK
    globalThis.MercadoPago = function MercadoPagoStub() {
      return { bricks: () => ({ create }) };
    };

    const onPix = vi.fn();
    const criarPagamento = vi.fn().mockResolvedValue({
      paymentId: "pay-1",
      status: "pending",
      expiraEm: "2026-08-06T15:30:00.000Z",
      qrCode: "000201...",
      qrCodeBase64: "abc123",
    });

    montarBrick(opcoesPadrao({ criarPagamento, onPix }));
    await carregarSdk();

    const { onSubmit } = create.mock.calls[0][2].callbacks;
    await onSubmit({ formData: {} }); // sem token => PIX

    expect(unmount).toHaveBeenCalledTimes(1);
    expect(onPix).toHaveBeenCalledWith({
      qrCodeBase64: "abc123",
      qrCode: "000201...",
      expiraEm: "2026-08-06T15:30:00.000Z",
    });
  });

  // A-1 da revisão final: cartão recusado (201 com status "rejected") não é
  // erro HTTP — criarPagamento devolve normalmente. Sem olhar `r.status`, o
  // onSubmit não fazia nada (ehPix é falso), o cliente não via aviso nenhum,
  // e ao trocar para PIX a reconsulta trazia o MESMO status "rejected" sem
  // QR — cadeia que terminava desmontando o Brick para um QR vazio.
  it("status 'rejected' chama onErro e MANTÉM o Brick vivo — não desmonta", async () => {
    const { montarBrick } = await importarLimpo();

    const unmount = vi.fn();
    const create = vi.fn().mockResolvedValue({ unmount });
    // @ts-expect-error stub do SDK
    globalThis.MercadoPago = function MercadoPagoStub() {
      return { bricks: () => ({ create }) };
    };

    const onErro = vi.fn();
    const onPix = vi.fn();
    const criarPagamento = vi.fn().mockResolvedValue({
      paymentId: "pay-1",
      status: "rejected",
      expiraEm: "2026-08-06T15:30:00.000Z",
    });

    montarBrick(opcoesPadrao({ criarPagamento, onErro, onPix }));
    await carregarSdk();

    const { onSubmit } = create.mock.calls[0][2].callbacks;
    // token presente => cartão. Mesmo assim tem que rejeitar a promise, para
    // o Brick sair de "processando" (mesmo contrato do catch de erro).
    await expect(
      onSubmit({ formData: { token: "tok-123" } }),
    ).rejects.toThrow();

    expect(onErro).toHaveBeenCalledTimes(1);
    expect(onPix).not.toHaveBeenCalled();
    expect(unmount).not.toHaveBeenCalled();
  });

  // Conserto de cópia: as duas instruções antigas ("tente outro cartão ou
  // pague com PIX") eram impossíveis de seguir — cartão está desligado no
  // Brick, e "pague com PIX" reconsulta a MESMA cobrança recusada
  // (podeCobrar manda para `reconsultar` sempre que já existe
  // gateway_payment_id, sem criar cobrança nova). A asserção de
  // `not.toMatch` é a que tem dente: sem ela, uma reescrita futura que volte
  // a falar em cartão passaria despercebida.
  it("mensagem de 'rejected' não fala em cartão nem sugere tentar de novo neste pedido", async () => {
    const { montarBrick } = await importarLimpo();

    const create = vi.fn().mockResolvedValue({ unmount: vi.fn() });
    // @ts-expect-error stub do SDK
    globalThis.MercadoPago = function MercadoPagoStub() {
      return { bricks: () => ({ create }) };
    };

    const onErro = vi.fn();
    const criarPagamento = vi.fn().mockResolvedValue({
      paymentId: "pay-1",
      status: "rejected",
      expiraEm: "2026-08-06T15:30:00.000Z",
    });

    montarBrick(opcoesPadrao({ criarPagamento, onErro }));
    await carregarSdk();

    const { onSubmit } = create.mock.calls[0][2].callbacks;
    await expect(
      onSubmit({ formData: { token: "tok-123" } }),
    ).rejects.toThrow();

    expect(onErro).toHaveBeenCalledTimes(1);
    const mensagem = onErro.mock.calls[0][0] as string;
    expect(mensagem).toBe(
      "Este pagamento foi recusado e não pode ser tentado novamente neste pedido. Faça um pedido novo ou fale com a loja.",
    );
    expect(mensagem).not.toMatch(/cart[aã]o/i);
  });

  it("status 'cancelled' chama onErro e MANTÉM o Brick vivo — não desmonta", async () => {
    const { montarBrick } = await importarLimpo();

    const unmount = vi.fn();
    const create = vi.fn().mockResolvedValue({ unmount });
    // @ts-expect-error stub do SDK
    globalThis.MercadoPago = function MercadoPagoStub() {
      return { bricks: () => ({ create }) };
    };

    const onErro = vi.fn();
    const onPix = vi.fn();
    const criarPagamento = vi.fn().mockResolvedValue({
      paymentId: "pay-1",
      status: "cancelled",
      expiraEm: "2026-08-06T15:30:00.000Z",
    });

    montarBrick(opcoesPadrao({ criarPagamento, onErro, onPix }));
    await carregarSdk();

    const { onSubmit } = create.mock.calls[0][2].callbacks;
    await expect(onSubmit({ formData: {} })).rejects.toThrow();

    expect(onErro).toHaveBeenCalledTimes(1);
    expect(onPix).not.toHaveBeenCalled();
    expect(unmount).not.toHaveBeenCalled();
  });

  // A cadeia medida pelo revisor: reconsulta de uma cobrança de CARTÃO
  // recusada, pelo caminho PIX (mesmo pedido, mesmo gateway_payment_id).
  // ehPix é true mas não há QR nenhum — nunca pode desmontar o Brick sem QR
  // de verdade, senão o cliente fica preso numa tela vazia sem volta.
  it("PIX sem QR (qrCode e qrCodeBase64 ausentes) NÃO chama onPix nem desmonta o Brick", async () => {
    const { montarBrick } = await importarLimpo();

    const unmount = vi.fn();
    const create = vi.fn().mockResolvedValue({ unmount });
    // @ts-expect-error stub do SDK
    globalThis.MercadoPago = function MercadoPagoStub() {
      return { bricks: () => ({ create }) };
    };

    const onErro = vi.fn();
    const onPix = vi.fn();
    // status "conhecido" (pending) mas SEM qrCode/qrCodeBase64 — é
    // exatamente o que a reconsulta de um pagamento de cartão devolve.
    const criarPagamento = vi.fn().mockResolvedValue({
      paymentId: "pay-1",
      status: "pending",
      expiraEm: "2026-08-06T15:30:00.000Z",
    });

    montarBrick(opcoesPadrao({ criarPagamento, onErro, onPix }));
    await carregarSdk();

    const { onSubmit } = create.mock.calls[0][2].callbacks;
    await expect(onSubmit({ formData: {} })).rejects.toThrow();

    expect(onErro).toHaveBeenCalledTimes(1);
    expect(onPix).not.toHaveBeenCalled();
    expect(unmount).not.toHaveBeenCalled();
  });

  it("status desconhecido não vira sucesso silencioso — chama onErro e mantém o Brick vivo", async () => {
    const { montarBrick } = await importarLimpo();

    const unmount = vi.fn();
    const create = vi.fn().mockResolvedValue({ unmount });
    // @ts-expect-error stub do SDK
    globalThis.MercadoPago = function MercadoPagoStub() {
      return { bricks: () => ({ create }) };
    };

    const onErro = vi.fn();
    const onPix = vi.fn();
    const criarPagamento = vi.fn().mockResolvedValue({
      paymentId: "pay-1",
      status: "in_mediation",
      expiraEm: "2026-08-06T15:30:00.000Z",
      qrCode: "000201...",
      qrCodeBase64: "abc123",
    });

    montarBrick(opcoesPadrao({ criarPagamento, onErro, onPix }));
    await carregarSdk();

    const { onSubmit } = create.mock.calls[0][2].callbacks;
    await expect(onSubmit({ formData: {} })).rejects.toThrow();

    expect(onErro).toHaveBeenCalledTimes(1);
    expect(onPix).not.toHaveBeenCalled();
    expect(unmount).not.toHaveBeenCalled();
  });

  // Task 8 da Fase 3: o caminho de cartão fica desligado até a Fase 3.5 (ver
  // comentário em PagamentoOnline.tsx) — o Brick só pode oferecer PIX. A
  // documentação do SDK (bricks/payment-review.md e
  // checkout-bricks/payment-brick/advanced-features/manage-payment-methods)
  // descreve cada chave de `paymentMethods` como "Optional — Allow payments
  // with X": a chave OMITIDA é o jeito de desligar um meio de pagamento, não
  // um valor vazio — por isso o teste confere ausência (`toBeUndefined`), não
  // `""` nem `[]`.
  it("customization.paymentMethods habilita só PIX — creditCard não entra", async () => {
    const { montarBrick } = await importarLimpo();

    const create = vi.fn().mockResolvedValue({ unmount: vi.fn() });
    // @ts-expect-error stub do SDK
    globalThis.MercadoPago = function MercadoPagoStub() {
      return { bricks: () => ({ create }) };
    };

    montarBrick(opcoesPadrao());
    await carregarSdk();

    const { paymentMethods } = create.mock.calls[0][2].customization;
    expect(paymentMethods.bankTransfer).toBe("all");
    expect(paymentMethods.creditCard).toBeUndefined();
  });
});

// Revisão da rodada de correção 1: remover o `jaMontou` (para o StrictMode
// funcionar, B1) amarrou a vida do Brick à identidade de `onErro` — um prop
// que, na forma natural de escrever a Task 5 (`onErro={(m) => setErro(m)}`),
// é um closure NOVO a cada render do pai. Com `onErro` nas deps do efeito,
// qualquer re-render (um toast, um evento realtime do useOrders, o contador
// regressivo do prazo) desmontava o Brick vivo — perdendo o que o cliente já
// tinha digitado — e recriava do zero. SILENCIOSAMENTE: o unmount roda antes
// do create seguinte, então não estoura ALREADY_INITIALIZED.
//
// Só um teste que renderiza `PagamentoOnline` de verdade (não só
// `montarBrick`) prova isto — a identidade do prop só existe no ciclo de
// render do React, não em uma chamada direta de função.
describe("PagamentoOnline (render de verdade)", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;

  beforeEach(() => {
    document.head.innerHTML = "";
    hospedeiro = document.createElement("div");
    document.body.appendChild(hospedeiro);
    raiz = createRoot(hospedeiro);
    vi.stubEnv("VITE_MP_PUBLIC_KEY", "TEST-000000-0000-0000-0000-000000000000");
  });

  afterEach(() => {
    act(() => {
      raiz.unmount();
    });
    hospedeiro.remove();
    document.querySelectorAll("script[data-mp-sdk]").forEach((s) => s.remove());
    // @ts-expect-error limpando o global entre testes
    globalThis.MercadoPago = undefined;
    vi.unstubAllEnvs();
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

  it("re-render do pai com onErro inline NÃO recria o Brick", async () => {
    const unmount = vi.fn();
    const create = vi.fn().mockResolvedValue({ unmount });
    // @ts-expect-error stub do SDK
    globalThis.MercadoPago = function MercadoPagoStub() {
      return { bricks: () => ({ create }) };
    };

    await act(async () => {
      raiz.render(<Pai />);
    });

    document
      .querySelector("script[data-mp-sdk]")
      ?.dispatchEvent(new Event("load"));
    await act(async () => {
      await esperarMicrotarefas();
    });

    expect(create).toHaveBeenCalledTimes(1);

    // Três re-renders do pai — cada um com `onErro` NOVO. Reproduz a rede: um
    // toast do sonner, um evento realtime, o contador regressivo do prazo.
    for (let i = 0; i < 3; i++) {
      await act(async () => {
        raiz.render(<Pai />);
      });
    }

    expect(create).toHaveBeenCalledTimes(1);
    expect(unmount).not.toHaveBeenCalled();
  });
});
