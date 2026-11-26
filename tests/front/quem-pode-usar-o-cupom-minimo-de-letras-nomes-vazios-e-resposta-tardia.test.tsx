// @vitest-environment jsdom
//
// "Quem pode usar" do cupom — bordas do bloco de clientes escolhidos:
//
// - 1 letra não é busca: nem "Buscando…", nem "Nenhum cliente encontrado.";
//   espaços nas pontas não contam letra (" a " = 1 letra);
// - com 2 letras o "Buscando…" aparece na hora e some quando a resposta chega;
// - depois do aviso "A busca demorou.", a resposta que chega TARDE não repõe a
//   lista nem apaga o aviso (a busca já foi dada como perdida);
// - conta sem nome vira "Sem nome" (também quando o nome vem vazio, não só
//   nulo); na lista, o rótulo cai para o e-mail e só depois para "cliente";
// - a informação explícita do limite de uso vence a do "sem limite nem
//   validade" (o servidor é quem manda: limite preenchido = sem aviso).
import { QuemPodeUsarOCupom } from "@/components/admin/coupons/QuemPodeUsarOCupom";
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

type Props = Parameters<typeof QuemPodeUsarOCupom>[0];

let raiz: Root;
let hospedeiro: HTMLDivElement;

const buscarClientes = vi.fn();

function props(extra: Partial<Props> = {}): Props {
  return {
    alcance: "exclusivo",
    onAlcance: vi.fn(),
    clientes: [],
    onClientes: vi.fn(),
    carregandoClientes: false,
    buscarClientes,
    semLimiteNemValidade: false,
    desabilitado: false,
    onCarregarDeNovo: vi.fn(),
    ...extra,
  };
}

async function montar(extra: Partial<Props> = {}) {
  await act(async () => {
    raiz.render(<QuemPodeUsarOCupom {...props(extra)} />);
  });
}

const campoDeBusca = () =>
  hospedeiro.querySelector("#coupon-clientes-busca") as HTMLInputElement;

async function digitar(valor: string, esperaMs = 0) {
  const setter = Object.getOwnPropertyDescriptor(
    window.HTMLInputElement.prototype,
    "value",
  )?.set;
  await act(async () => {
    setter?.call(campoDeBusca(), valor);
    campoDeBusca().dispatchEvent(new Event("input", { bubbles: true }));
  });
  await act(async () => {
    await vi.advanceTimersByTimeAsync(esperaMs);
  });
}

const texto = () => hospedeiro.textContent ?? "";

beforeEach(() => {
  vi.useFakeTimers();
  buscarClientes.mockReset();
  hospedeiro = document.createElement("div");
  document.body.appendChild(hospedeiro);
  raiz = createRoot(hospedeiro);
});

afterEach(() => {
  act(() => raiz.unmount());
  hospedeiro.remove();
  vi.useRealTimers();
});

describe("busca de clientes — o mínimo de 2 letras", () => {
  it("1 letra: não busca, não mostra 'Buscando…' nem 'Nenhum cliente encontrado.'", async () => {
    await montar();
    await digitar("a", 1000);
    expect(buscarClientes).not.toHaveBeenCalled();
    expect(texto()).not.toContain("Buscando…");
    expect(texto()).not.toContain("Nenhum cliente encontrado.");
  });

  it("espaços nas pontas não contam: ' a ' é 1 letra", async () => {
    await montar();
    await digitar("  a  ", 1000);
    expect(buscarClientes).not.toHaveBeenCalled();
    expect(texto()).not.toContain("Buscando…");
    expect(texto()).not.toContain("Nenhum cliente encontrado.");
  });

  it("2 letras: 'Buscando…' na hora, depois a resposta (sem resultado: 'Nenhum cliente encontrado.')", async () => {
    buscarClientes.mockResolvedValueOnce({ clientes: [], total: 0 });
    await montar();
    await digitar("ab", 0);
    expect(texto()).toContain("Buscando…");
    expect(texto()).not.toContain("Nenhum cliente encontrado.");
    await act(async () => {
      await vi.advanceTimersByTimeAsync(350);
    });
    expect(buscarClientes).toHaveBeenCalledTimes(1);
    expect(texto()).not.toContain("Buscando…");
    expect(texto()).toContain("Nenhum cliente encontrado.");
  });

  it("apagar para 1 letra depois de achar: a lista de resultados some, sem aviso de vazio", async () => {
    buscarClientes.mockResolvedValueOnce({
      clientes: [{ id: "u1", full_name: "Ana Prova", email: null }],
      total: 1,
    });
    await montar();
    await digitar("an", 350);
    expect(texto()).toContain("Ana Prova");
    await digitar("a", 350);
    expect(texto()).not.toContain("Ana Prova");
    expect(texto()).not.toContain("Nenhum cliente encontrado.");
    expect(texto()).not.toContain("Buscando…");
  });
});

describe("busca de clientes — resposta depois do prazo", () => {
  it("'A busca demorou.' e a resposta que chega tarde não repõe a lista nem some com o aviso", async () => {
    let responder!: (pagina: {
      clientes: { id: string; full_name: string; email: null }[];
      total: number;
    }) => void;
    buscarClientes.mockReturnValueOnce(
      new Promise((resolve) => {
        responder = resolve;
      }),
    );
    await montar();
    await digitar("Ana", 350);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(20_000);
    });
    expect(texto()).toContain("A busca demorou.");
    expect(texto()).not.toContain("Buscando…");

    await act(async () => {
      responder({
        clientes: [{ id: "u1", full_name: "Ana Tardia", email: null }],
        total: 1,
      });
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(texto()).not.toContain("Ana Tardia");
    expect(texto()).toContain("A busca demorou.");
    expect(texto()).not.toContain("Buscando…");
  });
});

describe("nomes que faltam", () => {
  it("resultado sem nome (nulo OU vazio) mostra 'Sem nome'; com e-mail mostra o e-mail também", async () => {
    buscarClientes.mockResolvedValueOnce({
      clientes: [
        { id: "u1", full_name: "", email: "vazio@prova.teste" },
        { id: "u2", full_name: null, email: null },
      ],
      total: 2,
    });
    await montar();
    await digitar("xx", 350);
    const itens = [
      ...hospedeiro.querySelectorAll(
        'ul[aria-label="Clientes encontrados"] li',
      ),
    ];
    expect(itens).toHaveLength(2);
    expect(itens[0]?.textContent).toContain("Sem nome");
    expect(itens[0]?.textContent).toContain("vazio@prova.teste");
    expect(itens[1]?.textContent).toContain("Sem nome");
  });

  it("na lista, sem nome o rótulo cai para o e-mail e o botão de tirar o usa; sem os dois, 'cliente'", async () => {
    await montar({
      clientes: [
        { id: "c1", nome: null, email: "so-email@prova.teste" },
        { id: "c2", nome: null, email: null },
        { id: "c3", nome: "Com Nome", email: "com@prova.teste" },
      ],
    });
    const lista = hospedeiro.querySelector(
      'ul[aria-label="Clientes que podem usar"]',
    );
    const itens = [...(lista?.querySelectorAll("li") ?? [])];
    expect(itens.map((li) => li.querySelector("span")?.textContent)).toEqual([
      "so-email@prova.teste",
      "Cliente sem nome",
      "Com Nome",
    ]);
    expect(
      [...(lista?.querySelectorAll("button") ?? [])].map((b) =>
        b.getAttribute("aria-label"),
      ),
    ).toEqual([
      "Tirar so-email@prova.teste da lista",
      "Tirar cliente da lista",
      "Tirar Com Nome da lista",
    ]);
  });
});

describe("aviso de cupom sem limite — quem manda é a informação do limite de uso", () => {
  const AVISO = "Clientes da lista podem usar o cupom sem limite de vezes";

  it("limite de uso preenchido (semLimiteDeUso=false): sem aviso, mesmo que o outro sinal diga o contrário", async () => {
    await montar({ semLimiteDeUso: false, semLimiteNemValidade: true });
    expect(texto()).not.toContain(AVISO);
  });

  it("limite de uso em zero (semLimiteDeUso=true): avisa, mesmo que a validade exista", async () => {
    await montar({ semLimiteDeUso: true, semLimiteNemValidade: false });
    expect(texto()).toContain(AVISO);
  });
});

describe("busca de clientes — falha de uma busca ANTIGA", () => {
  it("a busca por 'Ana' falha depois de a lojista já ter trocado para 'Bia': nenhum aviso de erro", async () => {
    let falhar!: (erro: Error) => void;
    buscarClientes
      .mockReturnValueOnce(
        new Promise((_resolve, rejeitar) => {
          falhar = rejeitar;
        }),
      )
      .mockResolvedValueOnce({
        clientes: [{ id: "u2", full_name: "Bia Prova", email: null }],
        total: 1,
      });
    await montar();
    await digitar("Ana", 350);
    expect(buscarClientes).toHaveBeenCalledTimes(1);
    await digitar("Bia", 0);

    await act(async () => {
      falhar(new Error("rede caiu"));
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(texto()).not.toContain("Não foi possível buscar clientes.");

    await act(async () => {
      await vi.advanceTimersByTimeAsync(350);
    });
    expect(texto()).toContain("Bia Prova");
    expect(texto()).not.toContain("Não foi possível buscar clientes.");
  });
});

describe("a opção marcada com o bloco desabilitado", () => {
  it("o destaque dourado só aparece com o bloco liberado", async () => {
    await montar({ alcance: "vitrine", desabilitado: false });
    const marcado = () =>
      hospedeiro.querySelector(
        '[role="radio"][aria-checked="true"]',
      ) as HTMLElement;
    expect(marcado().className).toContain("border-[#F5C542]");
    await montar({ alcance: "vitrine", desabilitado: true });
    expect(marcado().className).not.toContain("border-[#F5C542]");
  });
});
