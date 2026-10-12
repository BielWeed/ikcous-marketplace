// @vitest-environment jsdom
//
// Varredura de bugs: lista de Devoluções do painel (useDevolucoesAdmin +
// AdminDevolucoesView). Prende: filtro trocado não deixa linhas antigas nem
// anexa página do filtro errado; primeiro render não afirma "vazio";
// recarregar não encolhe a lista; carregarMais não duplica id; "agora"
// acompanha a volta da aba.
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { renderToString } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

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
vi.mock("@/components/admin/devolucoes/CartaoDaDevolucao", () => ({
  CartaoDaDevolucao: ({
    linha,
    agora,
    onAbrir,
  }: {
    linha: { id: string };
    agora: Date;
    onAbrir: (id: string) => void;
  }) => (
    <button
      type="button"
      data-testid="cartao"
      data-id={linha.id}
      data-agora={agora.getTime()}
      onClick={() => onAbrir(linha.id)}
    >
      {linha.id}
    </button>
  ),
}));

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

function linha(id: string, status = "recebida") {
  return {
    id,
    protocolo: `DV-${id}`,
    order_id: "o-1",
    cliente_nome: "Maria",
    cliente_whatsapp: "34999999999",
    tipo: "arrependimento",
    motivo: "tamanho_pequeno",
    status,
    resolucao_desejada: "reembolso",
    metodo_retorno: "envio_proprio",
    modalidade: "nacional",
    valor_itens: 10,
    prazo_ate: "2026-10-01",
    created_at: "2026-09-26T10:00:00Z",
  };
}

function pagina(ids: string[], total: number, status = "recebida") {
  return {
    data: {
      total,
      contagem: { recebida: total },
      itens: ids.map((i) => linha(i, status)),
    },
    error: null,
  };
}

const ids = (de: number, ate: number) =>
  Array.from({ length: ate - de + 1 }, (_, i) => `d-${de + i}`);

let raiz: Root;
let hospedeiro: HTMLDivElement;

beforeEach(() => {
  vi.clearAllMocks();
  hospedeiro = document.createElement("div");
  document.body.appendChild(hospedeiro);
  raiz = createRoot(hospedeiro);
});

afterEach(() => {
  act(() => raiz.unmount());
  hospedeiro.remove();
  vi.useRealTimers();
});

async function drenar() {
  await act(async () => {
    for (let i = 0; i < 15; i++) await Promise.resolve();
  });
}

async function montar(active = true) {
  const { AdminDevolucoesView } = await import(
    "@/views/admin/AdminDevolucoesView"
  );
  const el = (a: boolean) => (
    <AdminDevolucoesView onNavigate={vi.fn()} active={a} />
  );
  await act(async () => {
    raiz.render(el(active));
  });
  await drenar();
  return async (a: boolean) => {
    await act(async () => {
      raiz.render(el(a));
    });
    await drenar();
  };
}

const cartoes = () =>
  Array.from(hospedeiro.querySelectorAll<HTMLElement>("[data-testid=cartao]"));
const idsNaTela = () => cartoes().map((c) => c.dataset.id);

function chip(indice: number): HTMLButtonElement {
  const grupo = hospedeiro.querySelector('[role="group"]');
  return grupo!.querySelectorAll("button").item(indice);
}

async function clicar(el: Element | null | undefined) {
  await act(async () => {
    el?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });
  await drenar();
}

function mostrarMais() {
  return Array.from(hospedeiro.querySelectorAll("button")).find((b) =>
    b.textContent?.includes("Mostrar mais"),
  );
}

describe("lista de devoluções do painel", () => {
  it("itens 1 e 2: trocar o filtro tira as linhas antigas já durante o carregamento", async () => {
    rpc.mockResolvedValueOnce(pagina(["a-1", "a-2"], 2));
    await montar();
    expect(idsNaTela()).toEqual(["a-1", "a-2"]);

    let soltar: (v: unknown) => void = () => {};
    rpc.mockReturnValueOnce(new Promise((r) => (soltar = r)));
    await clicar(chip(1));
    // Carregando o filtro novo: nada do filtro anterior clicável.
    expect(idsNaTela()).toEqual([]);

    await act(async () => soltar(pagina(["b-1"], 1, "solicitada")));
    await drenar();
    expect(idsNaTela()).toEqual(["b-1"]);
  });

  it("item 1: falha da RPC ao trocar o filtro não mantém linhas nem 'Mostrar mais' do filtro anterior", async () => {
    rpc.mockResolvedValueOnce(pagina(ids(1, 50), 120));
    await montar();
    expect(mostrarMais()).toBeTruthy();

    rpc.mockResolvedValueOnce({ data: null, error: { message: "boom" } });
    await clicar(chip(1));
    expect(idsNaTela()).toEqual([]);
    expect(mostrarMais()).toBeUndefined();
    expect(hospedeiro.textContent).toContain("Não consegui carregar");
  });

  it("item 3: o primeiro render não afirma 'Nenhuma devolução ainda'", async () => {
    const { AdminDevolucoesView } = await import(
      "@/views/admin/AdminDevolucoesView"
    );
    const html = renderToString(
      <AdminDevolucoesView onNavigate={vi.fn()} active />,
    );
    expect(html).not.toContain("Nenhuma devolução ainda");
  });

  it("item 4: recarregar depois de 'Mostrar mais' não encolhe a lista para uma página", async () => {
    rpc.mockResolvedValueOnce(pagina(ids(1, 50), 60));
    await montar();
    rpc.mockResolvedValueOnce(pagina(ids(51, 60), 60));
    await clicar(mostrarMais());
    expect(cartoes()).toHaveLength(60);

    rpc.mockResolvedValueOnce(pagina(ids(1, 60), 60));
    await clicar(
      hospedeiro.querySelector('[aria-label="Atualizar devoluções"]'),
    );
    const ultima = rpc.mock.calls.at(-1)![1] as { p_limite: number };
    expect(ultima.p_limite).toBeGreaterThanOrEqual(60);
    expect(cartoes()).toHaveLength(60);
  });

  it("item 4: carregarMais não duplica id quando entra item novo", async () => {
    rpc.mockResolvedValueOnce(pagina(ids(1, 50), 61));
    await montar();
    // Entrou um item novo no topo: a página 2 repete d-50.
    rpc.mockResolvedValueOnce(pagina(["d-50", ...ids(51, 59)], 61));
    await clicar(mostrarMais());
    const lista = idsNaTela();
    expect(new Set(lista).size).toBe(lista.length);
    expect(lista).toHaveLength(59);

    // Total 61, 59 na tela, mas o servidor já entregou 60 linhas cruas
    // (50 + 10): ainda faltam linhas e o próximo clique AVANÇA o offset (60).
    expect(mostrarMais()).toBeTruthy();
    rpc.mockResolvedValueOnce(pagina(["d-60", "d-61"], 61));
    await clicar(mostrarMais());
    expect((rpc.mock.calls.at(-1)![1] as { p_offset: number }).p_offset).toBe(
      60,
    );
    expect(idsNaTela()).toHaveLength(61);
    expect(mostrarMais()).toBeUndefined();
  });

  it("item 5: 'agora' é renovado quando a tela volta a ficar ativa", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-10-12T10:00:00Z"));
    rpc.mockResolvedValue(pagina(["a-1"], 1));
    const definirAtivo = await montar();
    const antes = Number(cartoes()[0].dataset.agora);

    await definirAtivo(false);
    vi.setSystemTime(new Date("2026-10-13T10:00:00Z"));
    await definirAtivo(true);
    const depois = Number(cartoes()[0].dataset.agora);
    expect(depois).toBeGreaterThan(antes);
  });
});
