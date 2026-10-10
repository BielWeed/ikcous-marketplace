// @vitest-environment jsdom
//
// Frente B (28/09/2026): o bloco "Quem pode usar" do formulário de cupom do
// painel, SOZINHO (sem o formulário em volta). Três alcances; no exclusivo, a
// lojista busca clientes e monta a lista. O bloco não fala com o banco: a
// busca é injetada. O que dói aqui:
//   - a resposta de uma busca ANTIGA não pode sobrescrever a mais nova;
//   - lista que não carregou (ou carregando) não pode ser editada — salvar em
//     cima de uma lista que a tela não viu apagaria clientes de verdade;
//   - nunca aparece CPF, mesmo que a linha da busca traga um.
import { QuemPodeUsarOCupom } from "@/components/admin/coupons/QuemPodeUsarOCupom";
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

type Props = Parameters<typeof QuemPodeUsarOCupom>[0];

let raiz: Root;
let hospedeiro: HTMLDivElement;

const onAlcance = vi.fn();
const onClientes = vi.fn();
const onCarregarDeNovo = vi.fn();
const buscarClientes = vi.fn();

function props(extra: Partial<Props> = {}): Props {
  return {
    alcance: "exclusivo",
    onAlcance,
    clientes: [],
    onClientes,
    carregandoClientes: false,
    buscarClientes,
    semLimiteNemValidade: false,
    desabilitado: false,
    onCarregarDeNovo,
    ...extra,
  };
}

async function montar(extra: Partial<Props> = {}) {
  await act(async () => {
    raiz.render(<QuemPodeUsarOCupom {...props(extra)} />);
  });
}

function botao(texto: string): HTMLButtonElement {
  const achado = [...hospedeiro.querySelectorAll("button")].find(
    (b) =>
      b.textContent?.trim().startsWith(texto) ||
      b.getAttribute("aria-label") === texto,
  );
  if (!achado) throw new Error(`botão "${texto}" não encontrado`);
  return achado as HTMLButtonElement;
}

const campoDeBusca = () =>
  hospedeiro.querySelector("#coupon-clientes-busca") as HTMLInputElement;

async function digitar(valor: string, esperaMs = 350) {
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

const ANA = { id: "u-ana", full_name: "Ana Prova", email: "ana@prova.teste" };

beforeEach(() => {
  vi.useFakeTimers();
  onAlcance.mockReset();
  onClientes.mockReset();
  onCarregarDeNovo.mockReset();
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

describe("QuemPodeUsarOCupom — as três opções", () => {
  it("marca só a opção do alcance atual e avisa a escolha da lojista", async () => {
    await montar({ alcance: "vitrine" });
    const marcados = [...hospedeiro.querySelectorAll('[role="radio"]')].filter(
      (r) => r.getAttribute("aria-checked") === "true",
    );
    expect(marcados).toHaveLength(1);
    expect(marcados[0].textContent).toContain("Todos os clientes");
    await act(async () => botao("Clientes escolhidos").click());
    expect(onAlcance).toHaveBeenCalledWith("exclusivo");
    await act(async () => botao("Quem tiver o código").click());
    expect(onAlcance).toHaveBeenCalledWith("codigo");
  });

  it("o aviso de 'sem limite nem validade' só aparece na vitrine sem limite", async () => {
    await montar({ alcance: "vitrine", semLimiteNemValidade: true });
    expect(hospedeiro.textContent).toContain("sem limite de uso nem validade");
    await montar({ alcance: "vitrine", semLimiteNemValidade: false });
    expect(hospedeiro.textContent).not.toContain("sem limite de uso nem");
    await montar({ alcance: "codigo", semLimiteNemValidade: true });
    expect(hospedeiro.textContent).not.toContain("sem limite de uso nem");
  });

  it("fora do exclusivo não há busca de clientes", async () => {
    await montar({ alcance: "codigo" });
    expect(campoDeBusca()).toBeNull();
  });

  it("desabilitado trava o bloco inteiro", async () => {
    await montar({ desabilitado: true });
    expect(hospedeiro.querySelector("fieldset")?.disabled).toBe(true);
  });
});

describe("QuemPodeUsarOCupom — buscar e montar a lista", () => {
  it("menos de 2 letras não busca; com 2, busca depois da pausa", async () => {
    buscarClientes.mockResolvedValue([ANA]);
    await montar();
    await digitar("a");
    expect(buscarClientes).not.toHaveBeenCalled();
    await digitar("an", 100);
    expect(buscarClientes).not.toHaveBeenCalled();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(250);
    });
    expect(buscarClientes).toHaveBeenCalledTimes(1);
    expect(buscarClientes).toHaveBeenCalledWith("an");
    expect(hospedeiro.textContent).toContain("Ana Prova");
  });

  it("adicionar manda a lista com a cliente nova no fim (id, nome, e-mail)", async () => {
    buscarClientes.mockResolvedValue([ANA]);
    const bia = { id: "u-bia", nome: "Bia", email: null };
    await montar({ clientes: [bia] });
    await digitar("an");
    await act(async () => botao("Ana Prova").click());
    expect(onClientes).toHaveBeenCalledWith([
      bia,
      { id: "u-ana", nome: "Ana Prova", email: "ana@prova.teste" },
    ]);
  });

  it("quem já está na lista aparece como 'Na lista' e não entra duas vezes", async () => {
    buscarClientes.mockResolvedValue([ANA]);
    await montar({
      clientes: [{ id: "u-ana", nome: "Ana Prova", email: null }],
    });
    await digitar("an");
    const linha = botao("Ana Prova");
    expect(linha.disabled).toBe(true);
    expect(linha.textContent).toContain("Na lista");
    await act(async () => linha.click());
    expect(onClientes).not.toHaveBeenCalled();
  });

  it("tirar da lista manda a lista sem aquela conta", async () => {
    await montar({
      clientes: [
        { id: "u-ana", nome: "Ana Prova", email: null },
        { id: "u-bia", nome: "Bia", email: null },
      ],
    });
    await act(async () => botao("Tirar Ana Prova da lista").click());
    expect(onClientes).toHaveBeenCalledWith([
      { id: "u-bia", nome: "Bia", email: null },
    ]);
  });

  it("resposta de uma busca ANTIGA que chega depois não sobrescreve a nova", async () => {
    let soltarVelha: (v: unknown) => void = () => {};
    buscarClientes
      .mockImplementationOnce(
        () =>
          new Promise((r) => {
            soltarVelha = r;
          }),
      )
      .mockResolvedValueOnce([
        { id: "u-nova", full_name: "Nova Resposta", email: null },
      ]);
    await montar();
    await digitar("an");
    await digitar("ana");
    expect(hospedeiro.textContent).toContain("Nova Resposta");
    await act(async () => {
      soltarVelha([
        { id: "u-velha", full_name: "Resposta Velha", email: null },
      ]);
    });
    expect(hospedeiro.textContent).toContain("Nova Resposta");
    expect(hospedeiro.textContent).not.toContain("Resposta Velha");
  });

  it("apagar o texto antes da resposta chegar descarta a resposta", async () => {
    let soltar: (v: unknown) => void = () => {};
    buscarClientes.mockImplementationOnce(
      () =>
        new Promise((r) => {
          soltar = r;
        }),
    );
    await montar();
    await digitar("an");
    await digitar("");
    await act(async () => {
      soltar([ANA]);
    });
    expect(hospedeiro.textContent).not.toContain("Ana Prova");
    expect(hospedeiro.textContent).not.toContain("Buscando…");
  });

  it("falha da busca avisa; sem resultado diz que não achou", async () => {
    buscarClientes.mockRejectedValueOnce(new Error("rede"));
    await montar();
    await digitar("an");
    expect(hospedeiro.querySelector('[role="alert"]')?.textContent).toContain(
      "Não foi possível buscar clientes",
    );
    expect(hospedeiro.textContent).not.toContain("Nenhum cliente encontrado");
    buscarClientes.mockResolvedValueOnce([]);
    await digitar("anx");
    expect(hospedeiro.textContent).toContain("Nenhum cliente encontrado");
    expect(hospedeiro.querySelector('[role="alert"]')).toBeNull();
  });

  it("nunca mostra CPF, mesmo que a linha da busca traga um", async () => {
    buscarClientes.mockResolvedValue([
      { ...ANA, cpf: "123.456.789-09", cpf_digits: "12345678909" },
    ]);
    await montar();
    await digitar("an");
    expect(hospedeiro.textContent).toContain("Ana Prova");
    expect(hospedeiro.textContent).not.toContain("123.456.789-09");
    expect(hospedeiro.textContent).not.toContain("12345678909");
  });
});

describe("QuemPodeUsarOCupom — lista gravada que a tela não viu", () => {
  const gravada = [{ id: "u-bia", nome: "Bia", email: null }];

  it("carregando: busca, adicionar e tirar travados, sem aviso de lista vazia", async () => {
    await montar({ carregandoClientes: true, clientes: gravada });
    expect(campoDeBusca().disabled).toBe(true);
    expect(botao("Tirar Bia da lista").disabled).toBe(true);
    expect(hospedeiro.textContent).toContain("Carregando a lista…");
    await montar({ carregandoClientes: true, clientes: [] });
    expect(hospedeiro.textContent).not.toContain("Nenhum cliente ainda");
  });

  it("falhou ao carregar: trava, avisa e 'Carregar de novo' chama o recarregar", async () => {
    await montar({ falhaAoCarregar: true, clientes: gravada });
    expect(campoDeBusca().disabled).toBe(true);
    expect(botao("Tirar Bia da lista").disabled).toBe(true);
    expect(hospedeiro.querySelector('[role="alert"]')?.textContent).toContain(
      "não carregou",
    );
    await act(async () => botao("Carregar de novo").click());
    expect(onCarregarDeNovo).toHaveBeenCalledTimes(1);
    // Lista vazia por falha NÃO é "lista vazia de verdade".
    await montar({ falhaAoCarregar: true, clientes: [] });
    expect(hospedeiro.textContent).not.toContain("Nenhum cliente ainda");
  });

  it("carregou e está vazia: avisa que ninguém vai conseguir usar", async () => {
    await montar({ clientes: [] });
    expect(hospedeiro.textContent).toContain("Na lista (0)");
    expect(hospedeiro.textContent).toContain(
      "ninguém consegue usar este cupom",
    );
  });
});
