// @vitest-environment jsdom
//
// EtiquetasEnvioCard-116: a lista de etiquetas só trazia os 20 pedidos vivos
// mais recentes (`.limit(20)`, sem paginação nem busca) e não dizia quais já
// tinham etiqueta — o lojista descobria com um 400 depois de clicar
// "Confirmar e gerar". Este teste cobre as três pernas da correção:
//
//   1. "CARREGAR MAIS": a consulta pagina por `.range()` — o pedido de ontem
//      que caiu fora da primeira janela de 20 fica alcançável com um clique,
//      sem digitar nada.
//   2. BUSCA por número do pedido (sufixo do id, o que a tela mostra) ou por
//      nome do cliente — alcança um pedido MESMO fora da janela carregada.
//   3. SELO NA PRÓPRIA LISTA: pedido com `shipping_label_id` aparece como
//      "já etiquetado" (não mais por `tracking_code`, que nasce vazio às
//      vezes num pedido já etiquetado — revisor "reprodução"); pedido com
//      frete grátis e sem `shipping_option_id` do Melhor Envio no
//      `customer_data` (o caso descrito na tarefa irmã da edge,
//      index-691) aparece como "sem serviço do ME" ANTES do clique.
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { invokeMock, chamadasRange, pedidosPorPagina, colunasPedidas, adiados } =
  vi.hoisted(() => ({
    invokeMock: vi.fn(),
    // Cada consulta de página grava o [offset, offsetFinal] que recebeu — é
    // como o teste prova que "Carregar mais" pede a PRÓXIMA janela, não
    // repete a primeira.
    chamadasRange: [] as Array<[number, number]>,
    // Fila de respostas: a Nª chamada de `.range()` consome `pedidosPorPagina[N]`
    // (ou array vazio quando a fila acaba) — simula o servidor paginando de
    // verdade em vez de devolver a lista inteira de uma vez. Uma entrada
    // pode ser um array comum (resolve na hora) ou `{ __adiar: true, __linhas }`
    // (resolve só quando o teste chamar `adiados[N]()` — simula uma resposta
    // de rede que chega DEPOIS de uma consulta mais nova, achado ANOTADO da
    // rodada de correção: "Buscar"/"Limpar busca"/"Carregar mais" viraram
    // três gatilhos concorrentes sem nenhum cancelar o anterior).
    pedidosPorPagina: [] as any[],
    // A STRING que `select(...)` recebeu em cada chamada — sem capturar isso
    // o mock aceitaria QUALQUER coluna (inclusive nenhuma) e a suíte ficaria
    // verde mesmo se um refator apagasse `shipping_label_id`/`customer_data`
    // da consulta real, quebrando o selo "já etiquetado" em produção sem
    // nenhum teste vermelho (achado ANOTADO da rodada de revisão).
    colunasPedidas: [] as string[],
    // Resolvers das chamadas `{ __adiar: true }`, indexados igual a
    // `chamadasRange`/`pedidosPorPagina` — o teste dispara na hora que quiser.
    adiados: [] as Array<() => void>,
  }));

vi.mock("@/hooks/useOnlineStatus", () => ({ useOnlineStatus: () => false }));

vi.mock("@/lib/supabase", () => ({
  supabase: {
    from: (_table: string) => ({
      select: (colunas: string) => {
        colunasPedidas.push(colunas);
        return {
          in: () => ({
            in: () => ({
              order: () => ({
                range: (inicio: number, fim: number) => {
                  chamadasRange.push([inicio, fim]);
                  const entrada = pedidosPorPagina[chamadasRange.length - 1];
                  if (entrada?.__adiar) {
                    return new Promise((resolve) => {
                      adiados[chamadasRange.length - 1] = () =>
                        resolve({ data: entrada.__linhas, error: null });
                    });
                  }
                  return Promise.resolve({ data: entrada || [], error: null });
                },
              }),
            }),
          }),
        };
      },
    }),
    functions: { invoke: invokeMock },
  },
}));

vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() },
}));

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

function esperarMicrotarefas(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

// React embrulha o setter nativo de `value` do <input> para rastrear
// mudanças — atribuir `input.value = x` direto não dispara o `onChange`
// controlado. Precisa chamar o setter NATIVO antes do evento (mesmo truque
// usado pela própria suíte de testes do React).
function digitar(input: HTMLInputElement, valor: string) {
  const setter = Object.getOwnPropertyDescriptor(
    window.HTMLInputElement.prototype,
    "value",
  )?.set;
  setter?.call(input, valor);
  input.dispatchEvent(new Event("input", { bubbles: true }));
}

// Pedido comum, com serviço do ME normal escolhido no checkout. O campo é
// `shipping_option_id` SOLTO na linha (não `customer_data.shipping_option_id`)
// — é o formato que o PostgREST devolve para `customer_data->>shipping_option_id`
// no `select` (achado ANTES DE CRESCER da rodada de correção: a consulta
// não baixa mais `customer_data` inteiro, só o campo usado).
function pedido(over: { id: string } & Record<string, any>) {
  return {
    customer_name: "Cliente",
    status: "processing",
    payment_status: "pago",
    shipping: 24.9,
    tracking_code: null,
    shipping_label_id: null,
    created_at: "2026-09-10T10:00:00Z",
    shipping_option_id: "melhor-envio-3",
    ...over,
  };
}

const PEDIDO_ABERTO = pedido({
  id: "11111111-1111-1111-1111-111111111111",
  customer_name: "Maria Souza",
});
// Já etiquetado: shipping_label_id presente e tracking_code AINDA null (a
// etiqueta pode nascer sem rastreio — melhor-envio-etiqueta/index.ts) —
// o selo tem que vir do shipping_label_id, não do tracking_code.
const PEDIDO_ETIQUETADO = pedido({
  id: "22222222-2222-2222-2222-222222222222",
  customer_name: "João Pires",
  shipping_label_id: "10b87ac0-e99d-4aa4-b8b0-b147a84e16bf",
  tracking_code: null,
});
// Frete grátis (index-691, tarefa irmã): shipping = 0 e sem
// shipping_option_id do Melhor Envio — a tela avisa ANTES do clique, não
// deixa o lojista descobrir só com o 400.
const PEDIDO_FRETE_GRATIS = pedido({
  id: "33333333-3333-3333-3333-333333333333",
  customer_name: "Ana Frete Grátis",
  shipping: 0,
  shipping_option_id: null,
});
// Pedido "de ontem" que caiu fora da primeira janela de 20 — só aparece na
// segunda página (Carregar mais) ou pela busca.
const PEDIDO_DE_ONTEM = pedido({
  id: "44444444-4444-4444-4444-999999999999",
  customer_name: "Pedro Ontem",
  created_at: "2026-09-09T08:00:00Z",
});

describe("EtiquetasEnvioCard — pagina, busca e marca quem já tem etiqueta", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;

  beforeEach(() => {
    vi.clearAllMocks();
    chamadasRange.length = 0;
    pedidosPorPagina.length = 0;
    colunasPedidas.length = 0;
    adiados.length = 0;
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

  async function abrirCard() {
    const { EtiquetasEnvioCard } = await import(
      "@/components/admin/shipping/EtiquetasEnvioCard"
    );
    await act(async () => {
      raiz.render(<EtiquetasEnvioCard />);
    });
    await act(async () => {
      await esperarMicrotarefas();
    });
    await act(async () => {
      await esperarMicrotarefas();
    });
  }

  const botao = (texto: string) =>
    [...hospedeiro.querySelectorAll("button")].find((b) =>
      b.textContent?.includes(texto),
    );

  const opcoesDoSelect = () =>
    [
      ...hospedeiro.querySelectorAll<HTMLOptionElement>(
        "#pedido-etiqueta-select option",
      ),
    ].map((o) => o.textContent || "");

  it("a primeira página já pede 20 linhas por .range() — sem .limit() cego", async () => {
    pedidosPorPagina.push([PEDIDO_ABERTO]);
    await abrirCard();

    expect(chamadasRange).toEqual([[0, 19]]);
  });

  it("selo na lista: já etiquetado (por shipping_label_id) e sem serviço do ME (frete grátis sem opção) aparecem ANTES do clique", async () => {
    pedidosPorPagina.push([
      PEDIDO_ABERTO,
      PEDIDO_ETIQUETADO,
      PEDIDO_FRETE_GRATIS,
    ]);
    await abrirCard();

    const opcoes = opcoesDoSelect();
    expect(opcoes.some((t) => t.includes("João Pires"))).toBe(true);
    expect(opcoes.find((t) => t.includes("João Pires"))).toMatch(
      /já etiquetado/i,
    );
    expect(opcoes.find((t) => t.includes("Ana Frete Grátis"))).toMatch(
      /sem serviço do ME/i,
    );
    // O pedido comum (com serviço do ME e sem etiqueta) NÃO leva nenhum dos
    // dois selos — mostra o status normalmente.
    const linhaComum = opcoes.find((t) => t.includes("Maria Souza"));
    expect(linhaComum).not.toMatch(/já etiquetado|sem serviço do ME/i);
    // Guarda de verdade: se um refator um dia enxugar a `select` e apagar
    // `shipping_label_id`/`customer_data`, os dois selos acima passam a
    // mentir em produção (todo pedido vira "sem serviço do ME"), mas SEM
    // essa asserção a suíte continuaria verde — o mock ignorava o argumento
    // de `select()` (achado ANOTADO da rodada de revisão).
    expect(colunasPedidas[0]).toMatch(/shipping_label_id/);
    expect(colunasPedidas[0]).toMatch(/customer_data/);
  });

  it("Carregar mais: pede a PRÓXIMA janela (.range(20, 39)) e soma os pedidos à lista já carregada, sem repetir a primeira página", async () => {
    pedidosPorPagina.push(
      Array.from({ length: 20 }, (_, i) =>
        pedido({
          id: `aaaaaaaa-0000-0000-0000-${String(i).padStart(12, "0")}`,
          customer_name: `Cliente Página1 ${i}`,
        }),
      ),
      [PEDIDO_DE_ONTEM],
    );
    await abrirCard();

    expect(botao("Carregar mais")).toBeTruthy();
    await act(async () => {
      botao("Carregar mais")?.click();
      await esperarMicrotarefas();
    });
    await act(async () => {
      await esperarMicrotarefas();
    });

    expect(chamadasRange).toEqual([
      [0, 19],
      [20, 39],
    ]);
    const opcoes = opcoesDoSelect();
    // As 20 da primeira página continuam na tela — "carregar mais" soma.
    expect(opcoes.some((t) => t.includes("Cliente Página1 0"))).toBe(true);
    // E o pedido de ontem, que tinha saído da janela de 20, agora aparece.
    expect(opcoes.some((t) => t.includes("Pedro Ontem"))).toBe(true);
  });

  it("busca por nome alcança um pedido fora da janela carregada, sem precisar de Carregar mais", async () => {
    pedidosPorPagina.push([PEDIDO_ABERTO], [PEDIDO_DE_ONTEM]);
    await abrirCard();

    expect(opcoesDoSelect().some((t) => t.includes("Pedro Ontem"))).toBe(false);

    const input = hospedeiro.querySelector<HTMLInputElement>(
      "#busca-pedido-etiqueta",
    );
    expect(input).toBeTruthy();
    await act(async () => {
      digitar(input!, "Pedro Ontem");
    });
    await act(async () => {
      botao("Buscar")?.click();
      await esperarMicrotarefas();
    });
    await act(async () => {
      await esperarMicrotarefas();
    });

    expect(opcoesDoSelect().some((t) => t.includes("Pedro Ontem"))).toBe(true);
  });

  it("busca por número do pedido (sufixo do id mostrado na lista) também alcança o pedido", async () => {
    pedidosPorPagina.push([PEDIDO_ABERTO], [PEDIDO_DE_ONTEM]);
    await abrirCard();

    const sufixo = String(PEDIDO_DE_ONTEM.id).slice(-6);
    const input = hospedeiro.querySelector<HTMLInputElement>(
      "#busca-pedido-etiqueta",
    );
    await act(async () => {
      digitar(input!, sufixo);
    });
    await act(async () => {
      botao("Buscar")?.click();
      await esperarMicrotarefas();
    });
    await act(async () => {
      await esperarMicrotarefas();
    });

    expect(opcoesDoSelect().some((t) => t.includes("Pedro Ontem"))).toBe(true);
  });

  // Seleciona uma opção do <select> de pedidos pelo VALOR (id do pedido) —
  // mesmo truque do setter nativo usado em `digitar`, porque o React também
  // embrulha o setter de `value` do <select>.
  function selecionarPedido(id: string) {
    const el = document.getElementById(
      "pedido-etiqueta-select",
    ) as HTMLSelectElement;
    const setter = Object.getOwnPropertyDescriptor(
      globalThis.HTMLSelectElement.prototype,
      "value",
    )!.set!;
    setter.call(el, id);
    el.dispatchEvent(new Event("change", { bubbles: true }));
  }

  const selectPedido = () =>
    hospedeiro.querySelector<HTMLSelectElement>("#pedido-etiqueta-select");
  const botaoGerar = () => botao("Gerar etiqueta") as HTMLButtonElement;

  it("BLOQUEIA: buscar, selecionar um pedido da busca e limpar a busca não pode deixar 'Gerar etiqueta' habilitado para um id que sumiu da tela", async () => {
    // Página 1 (sem busca) só tem a Maria; a busca por "Pedro" troca a lista
    // inteira para o pedido do Pedro, que o lojista seleciona; "Limpar busca"
    // refaz a consulta (3ª chamada) e a página 1 (só a Maria) volta.
    pedidosPorPagina.push([PEDIDO_ABERTO], [PEDIDO_DE_ONTEM], [PEDIDO_ABERTO]);
    await abrirCard();

    const input = hospedeiro.querySelector<HTMLInputElement>(
      "#busca-pedido-etiqueta",
    );
    await act(async () => {
      digitar(input!, "Pedro Ontem");
    });
    await act(async () => {
      botao("Buscar")?.click();
      await esperarMicrotarefas();
    });
    await act(async () => {
      await esperarMicrotarefas();
    });

    await act(async () => {
      selecionarPedido(PEDIDO_DE_ONTEM.id);
    });
    expect(selectPedido()!.value).toBe(PEDIDO_DE_ONTEM.id);

    // "Limpar busca" refaz a consulta e a lista volta a ser só a página 1
    // (Maria) — o pedido do Pedro, selecionado, não está mais nela.
    await act(async () => {
      botao("Limpar busca")?.click();
      await esperarMicrotarefas();
    });
    await act(async () => {
      await esperarMicrotarefas();
    });

    // A tela não pode discordar do estado: ou o <select> ainda mostra o
    // pedido escolhido (impossível — ele não está na lista recarregada), ou
    // a seleção foi limpa e "Gerar etiqueta" está desabilitado. O bug
    // (achado BLOQUEIA) era o <select> voltar a "Selecione o pedido…" com o
    // botão de gasto CONTINUANDO habilitado.
    expect(selectPedido()!.value).toBe("");
    expect(botaoGerar().disabled).toBe(true);
  });

  it("BLOQUEIA: o mesmo cenário pelo caminho sem busca — fetchPedidos() chamado por um handler criado ANTES da seleção (erro de resgate) não pode ler a seleção velha do fechamento", async () => {
    // Página 1 com 20 pedidos comuns; página 2 só com PEDIDO_DE_ONTEM.
    pedidosPorPagina.push(
      Array.from({ length: 20 }, (_, i) =>
        pedido({
          id: `aaaaaaaa-0000-0000-0000-${String(i).padStart(12, "0")}`,
          customer_name: `Cliente Página1 ${i}`,
        }),
      ),
      [PEDIDO_DE_ONTEM],
      // Terceira chamada: o fetchPedidos() disparado pelo erro de resgate
      // devolve a lista à página 1 (sem o pedido de ontem).
      Array.from({ length: 20 }, (_, i) =>
        pedido({
          id: `aaaaaaaa-0000-0000-0000-${String(i).padStart(12, "0")}`,
          customer_name: `Cliente Página1 ${i}`,
        }),
      ),
    );
    await abrirCard();

    await act(async () => {
      botao("Carregar mais")?.click();
      await esperarMicrotarefas();
    });
    await act(async () => {
      await esperarMicrotarefas();
    });

    // Seleciona o pedido de ontem, da 2ª página — isso NÃO recria o
    // `fetchPedidos` memoizado (só muda quando a busca aplicada muda), então
    // qualquer closure velha que o chame ainda "lembra" da seleção de antes
    // desse clique (aqui, nenhuma).
    await act(async () => {
      selecionarPedido(PEDIDO_DE_ONTEM.id);
    });
    expect(selectPedido()!.value).toBe(PEDIDO_DE_ONTEM.id);

    // Abre a confirmação e gera — a function devolve erro de RESGATE
    // (`resgate: true`), que dispara `fetchPedidos()` e a lista volta à
    // página 1 sem o pedido de ontem.
    await act(async () => {
      botaoGerar().click();
    });
    invokeMock.mockRejectedValueOnce({
      context: {
        json: async () => ({
          error: "Este pedido já tem etiqueta gerada.",
          resgate: true,
        }),
      },
    });
    await act(async () => {
      botao("Confirmar e gerar")?.click();
      await esperarMicrotarefas();
    });
    await act(async () => {
      await esperarMicrotarefas();
    });
    await act(async () => {
      await esperarMicrotarefas();
    });

    expect(selectPedido()!.value).toBe("");
    expect(botaoGerar().disabled).toBe(true);
  });

  it("uma seleção que CONTINUA na lista recarregada não pode ser apagada por engano — a guarda tem que ler a seleção ATUAL, não a de quando o fetchPedidos foi criado", async () => {
    // Página 1 sempre devolve o MESMO pedido nas duas chamadas (a inicial e
    // a disparada pelo erro de resgate) — o pedido selecionado continua na
    // lista recarregada e não pode virar "Selecione o pedido…".
    pedidosPorPagina.push([PEDIDO_ABERTO], [PEDIDO_ABERTO]);
    await abrirCard();

    await act(async () => {
      selecionarPedido(PEDIDO_ABERTO.id);
    });
    expect(selectPedido()!.value).toBe(PEDIDO_ABERTO.id);

    await act(async () => {
      botaoGerar().click();
    });
    invokeMock.mockRejectedValueOnce({
      context: {
        json: async () => ({
          error: "Este pedido já tem etiqueta gerada.",
          resgate: true,
        }),
      },
    });
    await act(async () => {
      botao("Confirmar e gerar")?.click();
      await esperarMicrotarefas();
    });
    await act(async () => {
      await esperarMicrotarefas();
    });
    await act(async () => {
      await esperarMicrotarefas();
    });

    // A seleção sobrevive: o pedido ainda está na lista recarregada.
    expect(selectPedido()!.value).toBe(PEDIDO_ABERTO.id);
  });

  it("ANOTADO: 'Carregar mais' não duplica pedido cuja fronteira de páginas se repetiu (chave duplicada no <select>)", async () => {
    // A página 2 repete o ÚLTIMO pedido da página 1 (empate de created_at na
    // fronteira, sem desempate estável) — sem deduplicar, o mesmo id apareceria
    // duas vezes na lista.
    const pedidoDeFronteira = pedido({
      id: "bbbbbbbb-0000-0000-0000-000000000019",
      customer_name: "Cliente Fronteira",
    });
    pedidosPorPagina.push(
      [
        ...Array.from({ length: 19 }, (_, i) =>
          pedido({
            id: `aaaaaaaa-0000-0000-0000-${String(i).padStart(12, "0")}`,
            customer_name: `Cliente Página1 ${i}`,
          }),
        ),
        pedidoDeFronteira,
      ],
      [pedidoDeFronteira, PEDIDO_DE_ONTEM],
    );
    await abrirCard();

    await act(async () => {
      botao("Carregar mais")?.click();
      await esperarMicrotarefas();
    });
    await act(async () => {
      await esperarMicrotarefas();
    });

    const ocorrencias = opcoesDoSelect().filter((t) =>
      t.includes("Cliente Fronteira"),
    );
    expect(ocorrencias.length).toBe(1);
    // O pedido novo da segunda página continua alcançável.
    expect(opcoesDoSelect().some((t) => t.includes("Pedro Ontem"))).toBe(true);
  });

  it("ANTES DE CRESCER: busca sem resultado avisa que a janela dos 500 mais recentes foi truncada, em vez de dizer que o pedido não existe", async () => {
    // A janela de busca veio CHEIA (500 linhas) e nenhuma bate com o termo —
    // o pedido pode estar fora da janela, não necessariamente inexistente.
    pedidosPorPagina.push(
      [PEDIDO_ABERTO],
      Array.from({ length: 500 }, (_, i) =>
        pedido({
          id: `cccccccc-0000-0000-0000-${String(i).padStart(12, "0")}`,
          customer_name: `Cliente ${i}`,
        }),
      ),
    );
    await abrirCard();

    const input = hospedeiro.querySelector<HTMLInputElement>(
      "#busca-pedido-etiqueta",
    );
    await act(async () => {
      digitar(input!, "termo-que-nao-bate-com-nada");
    });
    await act(async () => {
      botao("Buscar")?.click();
      await esperarMicrotarefas();
    });
    await act(async () => {
      await esperarMicrotarefas();
    });

    const texto = hospedeiro.textContent || "";
    expect(texto).not.toMatch(
      /Nenhum pedido encontrado para "termo-que-nao-bate-com-nada"/,
    );
    expect(texto).toMatch(/500 pedidos mais recentes/i);
  });

  it("ANTES DE CRESCER: o aviso de truncagem também aparece quando a busca ACHA resultados dentro da janela de 500 (não só quando dá zero)", async () => {
    // A janela veio CHEIA (500) e 3 delas batem com "Silva" — pode existir um
    // 4º Silva mais antigo, fora da janela, e a tela tem que avisar mesmo
    // tendo resultado (achado ANTES DE CRESCER: antes só avisava com zero).
    const silvas = Array.from({ length: 3 }, (_, i) =>
      pedido({
        id: `ffffffff-0000-0000-0000-${String(i).padStart(12, "0")}`,
        customer_name: `Silva ${i}`,
      }),
    );
    const janelaCheia = [
      ...Array.from({ length: 497 }, (_, i) =>
        pedido({
          id: `cccccccc-0000-0000-0000-${String(i).padStart(12, "0")}`,
          customer_name: `Cliente ${i}`,
        }),
      ),
      ...silvas,
    ];
    pedidosPorPagina.push([PEDIDO_ABERTO], janelaCheia);
    await abrirCard();

    const input = hospedeiro.querySelector<HTMLInputElement>(
      "#busca-pedido-etiqueta",
    );
    await act(async () => {
      digitar(input!, "Silva");
    });
    await act(async () => {
      botao("Buscar")?.click();
      await esperarMicrotarefas();
    });
    await act(async () => {
      await esperarMicrotarefas();
    });

    expect(opcoesDoSelect().filter((t) => t.includes("Silva")).length).toBe(3);
    expect(hospedeiro.textContent || "").toMatch(/500 pedidos mais recentes/i);
  });

  it("BLOQUEIA: o painel de sucesso (código de rastreio) sobrevive ao fetchPedidos() do SUCESSO quando o pedido gerado só existia na 2ª página", async () => {
    // Página 1 com 20 pedidos comuns; página 2 só com PEDIDO_DE_ONTEM; a 3ª
    // chamada é o fetchPedidos() disparado pelo SUCESSO de handleGerarEtiqueta
    // — ele recarrega a PÁGINA 1, sem o pedido de ontem.
    pedidosPorPagina.push(
      Array.from({ length: 20 }, (_, i) =>
        pedido({
          id: `aaaaaaaa-0000-0000-0000-${String(i).padStart(12, "0")}`,
          customer_name: `Cliente Página1 ${i}`,
        }),
      ),
      [PEDIDO_DE_ONTEM],
      Array.from({ length: 20 }, (_, i) =>
        pedido({
          id: `aaaaaaaa-0000-0000-0000-${String(i).padStart(12, "0")}`,
          customer_name: `Cliente Página1 ${i}`,
        }),
      ),
    );
    await abrirCard();

    await act(async () => {
      botao("Carregar mais")?.click();
      await esperarMicrotarefas();
    });
    await act(async () => {
      await esperarMicrotarefas();
    });

    await act(async () => {
      selecionarPedido(PEDIDO_DE_ONTEM.id);
    });
    expect(selectPedido()!.value).toBe(PEDIDO_DE_ONTEM.id);

    await act(async () => {
      botaoGerar().click();
    });
    invokeMock.mockResolvedValueOnce({
      data: {
        tracking_code: "BR123456789",
        label_url: "https://www.melhorenvio.com.br/etiqueta/abc",
        label_id: "555",
        already: false,
      },
      error: null,
    });
    await act(async () => {
      botao("Confirmar e gerar")?.click();
      await esperarMicrotarefas();
    });
    await act(async () => {
      await esperarMicrotarefas();
    });
    await act(async () => {
      await esperarMicrotarefas();
    });

    // O painel verde continua na tela mesmo depois do fetchPedidos() do
    // sucesso recarregar a página 1 sem o pedido de ontem — era exatamente
    // aqui que a guarda de seleção órfã antiga chamava `setFase("ocioso")`
    // e apagava o painel (achado BLOQUEIA da rodada de correção).
    const codigoRastreio = hospedeiro.querySelector(
      '[data-testid="codigo-rastreio"]',
    );
    expect(codigoRastreio).toBeTruthy();
    expect(codigoRastreio?.textContent).toMatch(/BR123456789/);
    expect(hospedeiro.querySelector('[href*="melhorenvio"]')).toBeTruthy();
  });

  it("BLOQUEIA: a mensagem de RESGATE (com o id da etiqueta já paga) sobrevive ao refetch que limpa a seleção órfã", async () => {
    // Mesma armação da 2ª página, mas o clique termina em erro de RESGATE
    // (etiqueta paga, url não salva) — a mensagem carrega o label_id que é
    // o único lugar onde o lojista pode reimprimir pelo site do ME.
    pedidosPorPagina.push(
      Array.from({ length: 20 }, (_, i) =>
        pedido({
          id: `aaaaaaaa-0000-0000-0000-${String(i).padStart(12, "0")}`,
          customer_name: `Cliente Página1 ${i}`,
        }),
      ),
      [PEDIDO_DE_ONTEM],
      Array.from({ length: 20 }, (_, i) =>
        pedido({
          id: `aaaaaaaa-0000-0000-0000-${String(i).padStart(12, "0")}`,
          customer_name: `Cliente Página1 ${i}`,
        }),
      ),
    );
    await abrirCard();

    await act(async () => {
      botao("Carregar mais")?.click();
      await esperarMicrotarefas();
    });
    await act(async () => {
      await esperarMicrotarefas();
    });

    await act(async () => {
      selecionarPedido(PEDIDO_DE_ONTEM.id);
    });

    await act(async () => {
      botaoGerar().click();
    });
    invokeMock.mockRejectedValueOnce({
      context: {
        json: async () => ({
          error:
            "A etiqueta foi paga no Melhor Envio (id 987654) mas não conseguimos salvar a url de impressão. Reimprima pela sua conta no site do Melhor Envio.",
          resgate: true,
        }),
      },
    });
    await act(async () => {
      botao("Confirmar e gerar")?.click();
      await esperarMicrotarefas();
    });
    await act(async () => {
      await esperarMicrotarefas();
    });
    await act(async () => {
      await esperarMicrotarefas();
    });

    // A seleção órfã foi limpa (mesma guarda dos outros testes BLOQUEIA)...
    expect(selectPedido()!.value).toBe("");
    // ...mas a mensagem de resgate, com o id da etiqueta já paga, continua
    // na tela — não pode sumir junto com a seleção (achado BLOQUEIA: a
    // guarda antiga também chamava `setErroMsg(null)`).
    const erro = hospedeiro.querySelector('[data-testid="erro-etiqueta"]');
    expect(erro).toBeTruthy();
    expect(erro?.textContent).toMatch(/987654/);
  });

  it("ANOTADO: resposta atrasada de uma busca abandonada não sobrescreve a lista já limpa por 'Limpar busca' (geração descarta o resultado obsoleto)", async () => {
    const PEDIDO_BUSCA_SILVA = pedido({
      id: "99999999-9999-9999-9999-999999999999",
      customer_name: "Silva Um",
    });
    pedidosPorPagina.push(
      [PEDIDO_ABERTO], // idx0: fetch inicial (sem busca)
      { __adiar: true, __linhas: [PEDIDO_BUSCA_SILVA] }, // idx1: "Buscar" — fica pendurada
      [PEDIDO_ABERTO], // idx2: "Limpar busca" — resolve na hora
    );
    await abrirCard();

    const input = hospedeiro.querySelector<HTMLInputElement>(
      "#busca-pedido-etiqueta",
    );
    await act(async () => {
      digitar(input!, "Silva");
    });
    await act(async () => {
      botao("Buscar")?.click();
      await esperarMicrotarefas();
    });

    // O lojista desiste antes da busca voltar e limpa — essa consulta (idx2)
    // é MAIS NOVA e resolve na hora.
    await act(async () => {
      botao("Limpar busca")?.click();
      await esperarMicrotarefas();
    });
    await act(async () => {
      await esperarMicrotarefas();
    });

    expect(opcoesDoSelect().some((t) => t.includes("Maria Souza"))).toBe(true);
    expect(botao("Limpar busca")).toBeFalsy();

    // Só agora a resposta VELHA da busca chega. Sem o contador de geração
    // (achado ANOTADO da rodada de correção) ela sobrescreveria a lista já
    // limpa com o resultado filtrado do "Silva", prendendo o lojista numa
    // lista sem "Limpar busca" nem "Carregar mais".
    await act(async () => {
      adiados[1]?.();
      await esperarMicrotarefas();
    });
    await act(async () => {
      await esperarMicrotarefas();
    });

    expect(opcoesDoSelect().some((t) => t.includes("Silva Um"))).toBe(false);
    expect(opcoesDoSelect().some((t) => t.includes("Maria Souza"))).toBe(true);
    expect(botao("Limpar busca")).toBeFalsy();
  });
});
