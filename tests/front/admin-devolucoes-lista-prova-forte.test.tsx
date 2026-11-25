// @vitest-environment jsdom
//
// Provas fortes da lista de Devoluções do painel (AdminDevolucoesView +
// CartaoDaDevolucao). Cada asserção aqui existe porque um defeito de uma
// linha na tela (ordem trocada, chip contando o grupo errado, "Mostrar mais"
// chamando todo mundo, aviso de prazo invertido...) passava nos testes
// anteriores. Valores esperados escritos à mão, nunca calculados pelo código.
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import {
  type Mock,
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

import type { LinhaDevolucaoAdmin } from "@/types/devolucao";

const { rpc } = vi.hoisted(() => ({ rpc: vi.fn() }));

vi.mock("@/lib/supabase", () => ({
  supabase: { rpc, functions: { invoke: vi.fn() }, storage: { from: vi.fn() } },
}));
vi.mock("sonner", () => ({
  toast: Object.assign(vi.fn(), {
    success: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
    warning: vi.fn(),
  }),
}));
// A ficha tem testes próprios: aqui ela é só um painel com os 4 recados que a
// lista escuta (fechar, mudou, sujo, abrir pedido).
vi.mock("@/components/admin/devolucoes/DetalheDaDevolucao", () => ({
  DetalheDaDevolucao: (p: {
    id: string;
    onFechar: () => void;
    onMudou: () => void;
    onSujoMudou: (sujo: boolean) => void;
    onAbrirPedido: (orderId: string) => void;
  }) => (
    <div data-testid="ficha-falsa" data-id={p.id}>
      <button type="button" data-fechar-ficha="" onClick={p.onFechar}>
        fechar-falso
      </button>
      <button type="button" onClick={p.onMudou}>
        mudou-falso
      </button>
      <button type="button" onClick={() => p.onSujoMudou(true)}>
        sujar-falso
      </button>
      <button type="button" onClick={() => p.onAbrirPedido("pedido-9")}>
        pedido-falso
      </button>
    </div>
  ),
}));

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

type Linha = Record<string, unknown>;

function linha(id: string, extra: Linha = {}): Linha {
  return {
    id,
    protocolo: `DV-${id}`,
    order_id: "o-1",
    cliente_nome: "Maria",
    cliente_whatsapp: "34999999999",
    tipo: "arrependimento",
    motivo: "tamanho_pequeno",
    status: "solicitada",
    resolucao_desejada: "reembolso",
    metodo_retorno: "envio_proprio",
    modalidade: "nacional",
    valor_itens: 10,
    prazo_ate: "2026-10-01",
    created_at: "2026-09-26T10:00:00Z",
    ...extra,
  };
}

const CONTAGEM_CHEIA = {
  solicitada: 2,
  aprovada: 1,
  em_transito: 3,
  recebida: 4,
  concluida: 5,
  recusada: 6,
  cancelada: 7,
  reprovada: 8,
};

/** Responde `admin_devolucoes_listar` por status (null = todas). */
function servir(
  porStatus: Record<string, Linha[]>,
  opcoes: {
    contagem?: Record<string, number>;
    totais?: Record<string, number>;
  } = {},
) {
  rpc.mockImplementation(
    async (_nome: string, args: { p_status: string | null }) => {
      const chave = args.p_status ?? "todas";
      // eslint-disable-next-line security/detect-object-injection -- chave vem do teste
      const itens = porStatus[chave] ?? [];
      return {
        data: {
          // eslint-disable-next-line security/detect-object-injection -- chave vem do teste
          total: opcoes.totais?.[chave] ?? itens.length,
          contagem: opcoes.contagem ?? {},
          itens,
        },
        error: null,
      };
    },
  );
}

let raiz: Root;
let hospedeiro: HTMLDivElement;
let onNavigate: Mock<
  (view: string, id?: string, bypassDirtyCheck?: boolean) => void
>;

beforeEach(() => {
  vi.clearAllMocks();
  rpc.mockReset();
  onNavigate = vi.fn();
  hospedeiro = document.createElement("div");
  document.body.appendChild(hospedeiro);
  raiz = createRoot(hospedeiro);
});

afterEach(() => {
  act(() => raiz.unmount());
  hospedeiro.remove();
  document.body.className = "";
  vi.useRealTimers();
  vi.restoreAllMocks();
});

async function drenar() {
  await act(async () => {
    for (let i = 0; i < 20; i++) await Promise.resolve();
  });
}

async function montar(active = true) {
  const { AdminDevolucoesView } = await import(
    "@/views/admin/AdminDevolucoesView"
  );
  await act(async () => {
    raiz.render(
      <AdminDevolucoesView onNavigate={onNavigate} active={active} />,
    );
  });
  await drenar();
}

const chips = () =>
  Array.from(
    hospedeiro.querySelectorAll('[aria-label="Filtrar por status"] button'),
  );
const textosDosChips = () => chips().map((c) => c.textContent);
const chip = (rotulo: string) =>
  chips().find((c) => c.textContent?.startsWith(rotulo)) as HTMLButtonElement;
const idsDosCartoes = () =>
  Array.from(hospedeiro.querySelectorAll<HTMLElement>("[data-devolucao]")).map(
    (c) => c.dataset.devolucao,
  );
const tela = () => (hospedeiro.textContent ?? "").replace(/\s+/g, " ");

async function clicar(el: Element | null | undefined) {
  await act(async () => {
    el?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });
  await drenar();
}

describe("Devoluções — chips de status", () => {
  it("cada chip mostra a contagem do SEU grupo (Todas = soma dos 8, Abertas = soma dos 4 em andamento)", async () => {
    servir({ todas: [] }, { contagem: CONTAGEM_CHEIA });
    await montar();

    expect(textosDosChips()).toEqual([
      "Todas36",
      "Abertas10",
      "Solicitadas2",
      "Aprovadas1",
      "A caminho3",
      "Recebidas4",
      "Concluídas5",
      "Recusadas6",
      "Canceladas7",
      "Reprovadas8",
    ]);
  });

  it("só o chip escolhido fica marcado, e a consulta usa o status dele", async () => {
    servir({ todas: [], aprovada: [] }, { contagem: CONTAGEM_CHEIA });
    await montar();

    const marcados = () =>
      chips()
        .filter((c) => c.getAttribute("aria-pressed") === "true")
        .map((c) => c.textContent);
    expect(marcados()).toEqual(["Todas36"]);

    await clicar(chip("Aprovadas"));
    expect(marcados()).toEqual(["Aprovadas1"]);
    expect(rpc.mock.calls.at(-1)?.[1]).toMatchObject({
      p_status: "aprovada",
      p_busca: null,
      p_offset: 0,
    });
  });

  it("o chip Solicitadas com pedidos esperando fica destacado; sem pedidos, não", async () => {
    servir({ todas: [] }, { contagem: CONTAGEM_CHEIA });
    await montar();
    expect(chip("Solicitadas").querySelector("span")?.className).toContain(
      "bg-foreground",
    );
    expect(chip("Aprovadas").querySelector("span")?.className).not.toContain(
      "bg-foreground",
    );

    servir({ todas: [] }, { contagem: { ...CONTAGEM_CHEIA, solicitada: 0 } });
    await clicar(chip("Todas"));
    await clicar(chip("Abertas"));
    await clicar(chip("Todas"));
    expect(chip("Solicitadas").querySelector("span")?.className).not.toContain(
      "bg-foreground",
    );
  });
});

describe("Devoluções — chip Abertas junta os 4 estados em andamento", () => {
  const solicitada = [
    linha("d-a", { status: "solicitada", created_at: "2026-10-01T10:00:00Z" }),
  ];
  const aprovada = [
    linha("d-b", { status: "aprovada", created_at: "2026-10-03T10:00:00Z" }),
  ];
  const emTransito = [
    linha("d-c", { status: "em_transito", created_at: "2026-10-02T10:00:00Z" }),
  ];
  const recebida = [
    linha("d-d", { status: "recebida", created_at: "2026-09-30T10:00:00Z" }),
    // mudou de estado entre duas consultas: aparece também no grupo anterior
    linha("d-b", { status: "aprovada", created_at: "2026-10-03T10:00:00Z" }),
  ];

  async function abrirAbertas() {
    servir(
      {
        todas: [linha("d-x", { status: "concluida" })],
        solicitada,
        aprovada,
        em_transito: emTransito,
        recebida,
      },
      { contagem: CONTAGEM_CHEIA },
    );
    await montar();
    expect(idsDosCartoes()).toEqual(["d-x"]);
    rpc.mockClear();
    servirDepois();
    await clicar(chip("Abertas"));
  }
  // Mantém o mesmo servidor depois do mockClear (mockClear não tira a implementação).
  function servirDepois() {}

  it("consulta UMA vez cada um dos 4 estados e nenhuma consulta de 'todas'", async () => {
    await abrirAbertas();
    const status = rpc.mock.calls.map(
      (c) => (c[1] as { p_status: string | null }).p_status,
    );
    expect(status.sort()).toEqual([
      "aprovada",
      "em_transito",
      "recebida",
      "solicitada",
    ]);
  });

  it("mostra a mais nova primeiro, sem repetir a devolução que apareceu em dois grupos", async () => {
    await abrirAbertas();
    // 03/10 (d-b), 02/10 (d-c), 01/10 (d-a), 30/09 (d-d)
    expect(idsDosCartoes()).toEqual(["d-b", "d-c", "d-a", "d-d"]);
  });
});

describe("Devoluções — Abertas: carregar mais e falhas parciais", () => {
  function paginaDe(prefixo: string, de: number, ate: number) {
    return Array.from({ length: ate - de + 1 }, (_, i) =>
      linha(`${prefixo}-${de + i}`, {
        status: "solicitada",
        // dias distintos só para a ordem ser estável
        created_at: `2026-09-${String(10 + ((de + i) % 15)).padStart(2, "0")}T10:00:00Z`,
      }),
    );
  }

  it("'Mostrar mais' pede a próxima página SÓ do grupo que ainda tem mais (offset 50) e trava enquanto carrega", async () => {
    let soltar: (v: unknown) => void = () => {};
    rpc.mockImplementation(
      async (_n: string, a: { p_status: string | null; p_offset: number }) => {
        if (a.p_status === "solicitada" && a.p_offset === 50) {
          return new Promise((r) => {
            soltar = r;
          });
        }
        if (a.p_status === "solicitada") {
          return {
            data: { total: 60, contagem: {}, itens: paginaDe("s", 1, 50) },
            error: null,
          };
        }
        if (a.p_status === "aprovada") {
          return {
            data: {
              total: 1,
              contagem: {},
              itens: [linha("ap-1", { status: "aprovada" })],
            },
            error: null,
          };
        }
        return { data: { total: 0, contagem: {}, itens: [] }, error: null };
      },
    );
    await montar();
    await clicar(chip("Abertas"));
    expect(idsDosCartoes()).toHaveLength(51);

    const mais = () =>
      Array.from(hospedeiro.querySelectorAll("button")).find((b) =>
        b.textContent?.includes("Mostrar mais"),
      ) as HTMLButtonElement;
    expect(mais()).toBeTruthy();
    expect(mais().disabled).toBe(false);

    rpc.mockClear();
    await clicar(mais());

    // só a solicitada tem mais: nenhum outro grupo é consultado de novo
    expect(
      rpc.mock.calls.map((c) => {
        const a = c[1] as { p_status: string | null; p_offset: number };
        return `${a.p_status}:${a.p_offset}`;
      }),
    ).toEqual(["solicitada:50"]);
    // carregando: botão travado (um toque a mais não repete a página)
    expect(mais().disabled).toBe(true);

    await act(async () => {
      soltar({
        data: { total: 60, contagem: {}, itens: paginaDe("s", 51, 60) },
        error: null,
      });
    });
    await drenar();
    expect(idsDosCartoes()).toHaveLength(61);
    expect(
      Array.from(hospedeiro.querySelectorAll("button")).some((b) =>
        b.textContent?.includes("Mostrar mais"),
      ),
    ).toBe(false);
  });

  it("um grupo que falha já mostra o erro (e as outras devoluções continuam na tela)", async () => {
    rpc.mockImplementation(
      async (_n: string, a: { p_status: string | null }) => {
        if (a.p_status === "solicitada") {
          return { data: null, error: { message: "boom" } };
        }
        if (a.p_status === "aprovada") {
          return {
            data: {
              total: 1,
              contagem: {},
              itens: [linha("ap-1", { status: "aprovada" })],
            },
            error: null,
          };
        }
        return { data: { total: 0, contagem: {}, itens: [] }, error: null };
      },
    );
    await montar();
    await clicar(chip("Abertas"));

    expect(tela()).toContain("Não consegui carregar as devoluções.");
    expect(idsDosCartoes()).toEqual(["ap-1"]);
  });

  it("enquanto UM grupo ainda carrega, mostra 'Carregando…' e não diz que não há devolução aberta", async () => {
    let soltar: (v: unknown) => void = () => {};
    rpc.mockImplementation(
      async (_n: string, a: { p_status: string | null }) => {
        if (a.p_status === "solicitada") {
          return new Promise((r) => {
            soltar = r;
          });
        }
        return { data: { total: 0, contagem: {}, itens: [] }, error: null };
      },
    );
    await montar();
    await clicar(chip("Abertas"));

    expect(tela()).toContain("Carregando…");
    expect(tela()).not.toContain("Nenhuma devolução aberta");

    await act(async () => {
      soltar({ data: { total: 0, contagem: {}, itens: [] }, error: null });
    });
    await drenar();
    expect(tela()).toContain("Nenhuma devolução aberta");
    expect(tela()).not.toContain("Carregando…");
  });
});

describe("Devoluções — o atalho do aviso limpa a busca da visita anterior", () => {
  it("ao voltar pelo aviso, a primeira consulta de Solicitadas já vai SEM a busca antiga", async () => {
    vi.useFakeTimers();
    servir({ todas: [], solicitada: [] }, { contagem: CONTAGEM_CHEIA });
    const { AdminDevolucoesView } = await import(
      "@/views/admin/AdminDevolucoesView"
    );
    await act(async () => {
      raiz.render(<AdminDevolucoesView onNavigate={onNavigate} active />);
    });
    const campo =
      hospedeiro.querySelector<HTMLInputElement>("#busca-devolucoes")!;
    const atribuir = Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      "value",
    )?.set;
    await act(async () => {
      atribuir?.call(campo, "maria");
      campo.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(400);
    });
    expect(rpc.mock.calls.at(-1)?.[1]).toMatchObject({ p_busca: "maria" });

    // a tela vai para segundo plano e o aviso pede "Solicitadas"
    await act(async () => {
      raiz.render(
        <AdminDevolucoesView onNavigate={onNavigate} active={false} />,
      );
    });
    const { pedirDevolucoesSolicitadas } = await import(
      "@/lib/aviso-leva-a-devolucoes-solicitadas"
    );
    pedirDevolucoesSolicitadas();
    rpc.mockClear();
    await act(async () => {
      raiz.render(<AdminDevolucoesView onNavigate={onNavigate} active />);
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(10);
    });

    const aposVoltar = rpc.mock.calls.map(
      (c) => c[1] as { p_status: string | null; p_busca: string | null },
    );
    expect(aposVoltar.length).toBeGreaterThan(0);
    expect(aposVoltar.some((a) => a.p_busca === "maria")).toBe(false);
    expect(aposVoltar.at(-1)).toMatchObject({
      p_status: "solicitada",
      p_busca: null,
    });
  });
});

describe("Devoluções — abrir, fechar e descartar a ficha", () => {
  const duas = [linha("d-1"), linha("d-2")];

  it("abrir cartão avisa o roteador com o id (sem pular o aviso de alterações), repetir o mesmo cartão não navega de novo", async () => {
    servir({ todas: duas }, { contagem: CONTAGEM_CHEIA });
    await montar();

    const cartao = (id: string) =>
      hospedeiro.querySelector<HTMLElement>(`[data-devolucao="${id}"]`);
    await clicar(cartao("d-1"));
    expect(onNavigate).toHaveBeenCalledTimes(1);
    expect(onNavigate).toHaveBeenLastCalledWith(
      "admin-devolucoes",
      "d-1",
      true,
    );
    expect(
      hospedeiro
        .querySelector("[data-testid=ficha-falsa]")
        ?.getAttribute("data-id"),
    ).toBe("d-1");
    expect(cartao("d-1")?.getAttribute("aria-current")).toBe("true");
    expect(cartao("d-2")?.getAttribute("aria-current")).toBeNull();

    await clicar(cartao("d-1"));
    expect(onNavigate).toHaveBeenCalledTimes(1);
  });

  it("fechar a ficha volta à lista sem id; abrir o pedido leva o número do pedido; 'mudou' relê a lista", async () => {
    servir({ todas: duas }, { contagem: CONTAGEM_CHEIA });
    await montar();
    const botao = (texto: string) =>
      Array.from(hospedeiro.querySelectorAll("button")).find(
        (b) => b.textContent === texto,
      );

    await clicar(hospedeiro.querySelector('[data-devolucao="d-2"]'));
    expect(document.body.classList.contains("admin-modal-open")).toBe(true);

    onNavigate.mockClear();
    await clicar(botao("pedido-falso"));
    expect(onNavigate).toHaveBeenCalledTimes(1);
    expect(onNavigate).toHaveBeenLastCalledWith(
      "admin-orders",
      "pedido-9",
      true,
    );

    const consultasAntes = rpc.mock.calls.length;
    await clicar(botao("mudou-falso"));
    expect(rpc.mock.calls.length).toBe(consultasAntes + 1);
    expect(rpc.mock.calls.at(-1)?.[1]).toMatchObject({
      p_status: null,
      p_offset: 0,
    });

    onNavigate.mockClear();
    await clicar(botao("fechar-falso"));
    expect(onNavigate).toHaveBeenCalledTimes(1);
    expect(onNavigate).toHaveBeenLastCalledWith(
      "admin-devolucoes",
      undefined,
      true,
    );
    expect(hospedeiro.querySelector("[data-testid=ficha-falsa]")).toBeNull();
    expect(document.body.classList.contains("admin-modal-open")).toBe(false);
  });

  it("com texto não enviado na ficha, trocar de cartão pergunta UMA vez e só troca se a lojista confirmar", async () => {
    servir({ todas: duas }, { contagem: CONTAGEM_CHEIA });
    const confirmar = vi.spyOn(globalThis, "confirm").mockReturnValue(false);
    await montar();
    const botao = (texto: string) =>
      Array.from(hospedeiro.querySelectorAll("button")).find(
        (b) => b.textContent === texto,
      );

    await clicar(hospedeiro.querySelector('[data-devolucao="d-1"]'));
    // ficha limpa: nenhuma pergunta
    await clicar(hospedeiro.querySelector('[data-devolucao="d-2"]'));
    expect(confirmar).not.toHaveBeenCalled();
    expect(onNavigate).toHaveBeenLastCalledWith(
      "admin-devolucoes",
      "d-2",
      true,
    );

    await clicar(botao("sujar-falso"));
    onNavigate.mockClear();
    await clicar(hospedeiro.querySelector('[data-devolucao="d-1"]'));
    expect(confirmar).toHaveBeenCalledTimes(1);
    expect(confirmar).toHaveBeenCalledWith(
      "Você escreveu algo que ainda não foi enviado. Descartar e sair?",
    );
    expect(onNavigate).not.toHaveBeenCalled();
    expect(
      hospedeiro
        .querySelector("[data-testid=ficha-falsa]")
        ?.getAttribute("data-id"),
    ).toBe("d-2");

    confirmar.mockReturnValue(true);
    await clicar(hospedeiro.querySelector('[data-devolucao="d-1"]'));
    expect(onNavigate).toHaveBeenCalledTimes(1);
    expect(onNavigate).toHaveBeenLastCalledWith(
      "admin-devolucoes",
      "d-1",
      true,
    );
    expect(
      hospedeiro
        .querySelector("[data-testid=ficha-falsa]")
        ?.getAttribute("data-id"),
    ).toBe("d-1");
  });
});

describe("CartaoDaDevolucao — o que a lojista lê em cada linha", () => {
  async function desenhar(l: Linha, agora = new Date("2026-10-02T15:00:00Z")) {
    const { CartaoDaDevolucao } = await import(
      "@/components/admin/devolucoes/CartaoDaDevolucao"
    );
    const onAbrir = vi.fn();
    await act(async () => {
      raiz.render(
        <CartaoDaDevolucao
          linha={l as unknown as LinhaDevolucaoAdmin}
          selecionada={false}
          agora={agora}
          onAbrir={onAbrir}
        />,
      );
    });
    return { onAbrir, botao: hospedeiro.querySelector("button")! };
  }

  it("mostra protocolo, status, tipo, cliente, motivo, valor e idade com o texto exato", async () => {
    const { botao } = await desenhar(
      linha("c-1", {
        protocolo: "DV-2026-0042",
        status: "aprovada",
        tipo: "vicio",
        motivo: "defeito",
        cliente_nome: "Joana Souza",
        valor_itens: 129.9,
        created_at: "2026-09-29T15:00:00Z",
      }),
    );
    const linhas = Array.from(botao.querySelectorAll("p, span")).map(
      (e) => e.textContent,
    );
    expect(linhas).toContain("DV-2026-0042");
    expect(linhas).toContain("Aprovada");
    expect(linhas).toContain("Problema no produto");
    expect(linhas).toContain("Joana Souza");
    expect(linhas).toContain("Veio com defeito");
    expect(linhas.some((t) => /^R\$\s?129,90$/.test(t ?? ""))).toBe(true);
    expect(linhas).toContain("há 3 dias");
  });

  it("sem nome do cliente, escreve 'Cliente'", async () => {
    const { botao } = await desenhar(linha("c-2", { cliente_nome: null }));
    const paragrafos = Array.from(botao.querySelectorAll("p")).map(
      (p) => p.textContent,
    );
    expect(paragrafos[0]).toBe("Cliente");
  });

  it("aberta e pedida dentro do prazo: 'Pedido dentro do prazo (até 01/10)', sem destaque de alerta", async () => {
    const { botao } = await desenhar(
      linha("c-3", {
        status: "solicitada",
        created_at: "2026-09-26T10:00:00Z",
        prazo_ate: "2026-10-01",
      }),
    );
    const aviso = Array.from(botao.querySelectorAll("span")).find((s) =>
      s.textContent?.includes("prazo"),
    )!;
    expect(aviso.textContent).toBe("Pedido dentro do prazo (até 01/10)");
    expect(aviso.className).toContain("text-zinc-500");
    expect(aviso.className).not.toContain("text-amber-300");
  });

  it("aberta e pedida DEPOIS do prazo: 'Pedido feito depois do prazo (até 01/10)' em âmbar", async () => {
    const { botao } = await desenhar(
      linha("c-4", {
        status: "recebida",
        created_at: "2026-10-02T12:00:00Z",
        prazo_ate: "2026-10-01",
      }),
    );
    const aviso = Array.from(botao.querySelectorAll("span")).find((s) =>
      s.textContent?.includes("prazo"),
    )!;
    expect(aviso.textContent).toBe("Pedido feito depois do prazo (até 01/10)");
    expect(aviso.className).toContain("text-amber-300");
  });

  it("pedida às 23h do último dia (Brasília) ainda está dentro do prazo, e às 00h30 do dia seguinte não", async () => {
    // 01/10 23:00 em Brasília = 02/10 02:00 UTC
    const dentro = await desenhar(
      linha("c-5", {
        status: "solicitada",
        created_at: "2026-10-02T02:00:00Z",
        prazo_ate: "2026-10-01",
      }),
    );
    expect(dentro.botao.textContent).toContain(
      "Pedido dentro do prazo (até 01/10)",
    );
    act(() => raiz.unmount());
    raiz = createRoot(hospedeiro);
    // 02/10 00:30 em Brasília = 02/10 03:30 UTC
    const fora = await desenhar(
      linha("c-6", {
        status: "solicitada",
        created_at: "2026-10-02T03:30:00Z",
        prazo_ate: "2026-10-01",
      }),
    );
    expect(fora.botao.textContent).toContain("Pedido feito depois do prazo");
  });

  it("devolução encerrada não mostra o aviso de prazo", async () => {
    const { botao } = await desenhar(
      linha("c-7", {
        status: "concluida",
        created_at: "2026-10-02T12:00:00Z",
        prazo_ate: "2026-10-01",
      }),
    );
    expect(botao.textContent).not.toContain("prazo");
  });

  it("clicar chama onAbrir com o id da linha", async () => {
    const { botao, onAbrir } = await desenhar(linha("c-8"));
    await act(async () => {
      botao.click();
    });
    expect(onAbrir).toHaveBeenCalledTimes(1);
    expect(onAbrir).toHaveBeenCalledWith("c-8");
  });

  it("os selos de status mudam de cor conforme o tom (atenção, andamento, sucesso, negativo)", async () => {
    const cor = async (status: string) => {
      const { botao } = await desenhar(linha(`t-${status}`, { status }));
      const selo = Array.from(botao.querySelectorAll("span")).find(
        (s) =>
          s.className.includes("uppercase") && s.className.includes("border-"),
      )!;
      const classes = selo.className;
      act(() => raiz.unmount());
      raiz = createRoot(hospedeiro);
      return classes;
    };
    expect(await cor("solicitada")).toContain("text-amber-300");
    expect(await cor("aprovada")).toContain("text-sky-300");
    expect(await cor("concluida")).toContain("text-emerald-300");
    expect(await cor("recusada")).toContain("text-red-300");
  });

  it("cada tipo tem o seu texto e a sua cor (arrependimento, problema no produto, troca)", async () => {
    const selo = async (tipo: string) => {
      const { botao } = await desenhar(linha(`tp-${tipo}`, { tipo }));
      const el = Array.from(botao.querySelectorAll("span")).find((s) =>
        ["Arrependimento", "Problema no produto", "Troca"].includes(
          s.textContent ?? "",
        ),
      )!;
      const lido = { texto: el.textContent, classes: el.className };
      act(() => raiz.unmount());
      raiz = createRoot(hospedeiro);
      return lido;
    };
    const arrependimento = await selo("arrependimento");
    expect(arrependimento.texto).toBe("Arrependimento");
    expect(arrependimento.classes).toContain("text-violet-300");
    const vicio = await selo("vicio");
    expect(vicio.texto).toBe("Problema no produto");
    expect(vicio.classes).toContain("text-orange-300");
    const troca = await selo("troca");
    expect(troca.texto).toBe("Troca");
    expect(troca.classes).toContain("text-zinc-300");
  });
});
