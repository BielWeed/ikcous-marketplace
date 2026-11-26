// @vitest-environment jsdom
//
// Caça por mutação (25/11/2026) — Impostos: caderno das guias e "Exportar para o
// contador". RISCO: dinheiro (guia de imposto) e arquivo que vai ao contador.
//
// O que os testes antigos não viam:
//  Caderno
//   - mês "a pagar" SEM guia para pagar não desenha uma lista vazia: só a frase
//     que manda abrir a aba Pagar e receber;
//   - guia com vencimento diz "Vence em dd/mm/aaaa"; sem vencimento diz "Sem vencimento";
//   - o aviso "Nenhuma guia lançada neste período" só aparece quando NENHUM mês
//     tem guia (um mês com guia basta para ele sumir);
//   - o selo de cada estado tem o tom certo (vencida vermelho, a pagar âmbar...).
//  Exportar
//   - a frase do aviso escreve o MÊS por extenso (janeiro e dezembro incluídos),
//     nos quatro desfechos (baixado, vazio, erro, ano);
//   - as listas de mês e de ano (12 meses; ano atual e 5 anteriores) e a data de
//     hoje no fuso de Brasília (virada do ano às 23h30 do dia 31);
//   - durante a leitura os DOIS botões ficam "aria-disabled" e só o clicado
//     mostra "Gerando…"; ao terminar os dois voltam;
//   - o link temporário do download não fica no documento;
//   - o aviso de erro é vermelho e os outros não.
// Fixtures inventadas (nenhum dado de loja).
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

import {
  CadernoDeGuias,
  type MesParaOCaderno,
} from "@/components/admin/financeiro/impostos/CadernoDeGuias";
import { ExportarParaContador } from "@/components/admin/financeiro/impostos/ExportarParaContador";
import type {
  AbrirFolha,
  AlvoDaBaixa,
} from "@/components/admin/financeiro/navegacao";
import { ContextoValoresOcultos } from "@/components/admin/financeiro/partes";
import type { EstadoDoMes, MesDoCaderno } from "@/lib/fiscal/caderno";
import { classeDoTexto } from "@/lib/tons-de-estado";

const normalizar = (t: string | null | undefined) =>
  (t ?? "")
    .replaceAll(String.fromCharCode(160), " ")
    .replace(/\s+/g, " ")
    .trim();

// ---------------------------------------------------------------------------
// Caderno das guias
// ---------------------------------------------------------------------------

describe("Caderno das guias — bordas", () => {
  let host: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    host = document.createElement("div");
    document.body.appendChild(host);
    root = createRoot(host);
  });
  afterEach(() => {
    act(() => root.unmount());
    host.remove();
  });

  function mes(
    competencia: string,
    estado: EstadoDoMes,
    valores: { guia?: number; pago?: number; aPagar?: number } = {},
  ): MesDoCaderno {
    return {
      mes: competencia,
      guia: valores.guia ?? 0,
      pago: valores.pago ?? 0,
      aPagar: valores.aPagar ?? 0,
      estado,
    };
  }

  function alvo(
    id: string,
    descricao: string,
    vencimento: string | null,
  ): AlvoDaBaixa {
    return {
      id,
      descricao,
      valor: 100,
      contaId: null,
      lado: "saida",
      vencimento,
    };
  }

  async function montar(meses: readonly MesParaOCaderno[]) {
    await act(async () =>
      root.render(
        <ContextoValoresOcultos.Provider value={false}>
          <CadernoDeGuias
            meses={meses}
            cadastro={null}
            abrirFolha={vi.fn() as unknown as AbrirFolha}
          />
        </ContextoValoresOcultos.Provider>,
      ),
    );
  }

  const cartao = (competencia: string): HTMLElement => {
    const el = host.querySelector<HTMLElement>(`li[data-mes="${competencia}"]`);
    if (!el) throw new Error(`cartão de ${competencia} não encontrado`);
    return el;
  };

  it("mês a pagar sem nenhuma guia para pagar: só a frase da aba Pagar e receber, sem lista vazia", async () => {
    await montar([
      {
        caderno: mes("2026-10", "a_pagar", { guia: 100, aPagar: 100 }),
        guiasAPagar: [],
      },
    ]);
    const c = cartao("2026-10");
    expect(normalizar(c.textContent)).toContain(
      "Para dar baixa nesta guia, abra a aba Pagar e receber.",
    );
    expect(c.querySelector("ul")).toBeNull();
    expect(normalizar(c.textContent)).not.toContain("Pagar Pagar");
  });

  it("guia com vencimento diz 'Vence em dd/mm/aaaa'; sem vencimento diz 'Sem vencimento'", async () => {
    await montar([
      {
        caderno: mes("2026-10", "a_pagar", { guia: 200, aPagar: 200 }),
        guiasAPagar: [
          alvo("g1", "DAS de outubro", "2026-11-20"),
          alvo("g2", "Parcelamento", null),
        ],
      },
    ]);
    const itens = [...cartao("2026-10").querySelectorAll("ul > li")];
    expect(itens).toHaveLength(2);
    const [comData, semData] = itens.map((li) => normalizar(li.textContent));
    expect(comData).toContain("Vence em 20/11/2026");
    expect(comData).not.toContain("Sem vencimento");
    expect(semData).toContain("Sem vencimento");
    expect(semData).not.toContain("Vence em");
  });

  it("'Nenhuma guia lançada neste período' só aparece quando NENHUM mês tem guia", async () => {
    const AVISO = "Nenhuma guia lançada neste período";
    await montar([
      { caderno: mes("2026-09", "sem_guia") },
      { caderno: mes("2026-10", "paga", { guia: 50, pago: 50 }) },
    ]);
    expect(normalizar(host.textContent)).not.toContain(AVISO);

    act(() => root.unmount());
    root = createRoot(host);
    await montar([
      { caderno: mes("2026-09", "sem_guia") },
      { caderno: mes("2026-10", "sem_guia") },
    ]);
    expect(normalizar(host.textContent)).toContain(AVISO);
  });

  it.each<
    [EstadoDoMes, string, "neutro" | "atencao" | "negativo" | "positivo"]
  >([
    ["sem_guia", "Sem guia lançada", "neutro"],
    ["a_pagar", "Falta pagar", "atencao"],
    ["vencida", "Vencida", "negativo"],
    ["paga", "Paga", "positivo"],
  ])("o selo de '%s' diz '%s' com o tom %s", async (estado, rotulo, tom) => {
    await montar([{ caderno: mes("2026-10", estado) }]);
    const selo =
      cartao("2026-10").querySelector<HTMLElement>("[data-selo-do-mes]");
    expect(normalizar(selo?.textContent)).toBe(rotulo);
    expect(selo?.className).toContain(classeDoTexto(tom));
    // E só esse tom: nenhum outro tom de significado no mesmo selo.
    for (const outro of [
      "neutro",
      "atencao",
      "negativo",
      "positivo",
    ] as const) {
      if (outro === tom) continue;
      if (classeDoTexto(outro) === classeDoTexto(tom)) continue;
      expect(selo?.className).not.toContain(classeDoTexto(outro));
    }
  });
});

// ---------------------------------------------------------------------------
// Exportar para o contador
// ---------------------------------------------------------------------------

type Linhas = Parameters<typeof ExportarParaContador>[0] extends {
  buscarLinhas: (...args: never[]) => Promise<infer R>;
}
  ? R
  : never;

const AGORA = new Date("2026-10-15T15:00:00Z");
const COM_VENDA: Linhas = {
  extrato: [
    {
      origem: "venda_online",
      tipo: "entrada",
      status: "realizado",
      valor: 150,
      data: "2026-10-05",
      descricao: "Pedido de teste",
    },
  ],
  guias: [],
};
const SEM_NADA: Linhas = { extrato: [], guias: [] };

describe("ExportarParaContador — bordas", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    URL.createObjectURL = vi.fn(() => "blob:fake");
    URL.revokeObjectURL = vi.fn();
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.restoreAllMocks();
  });

  async function montar(
    buscarLinhas: (p: { modo: string; referencia: string }) => Promise<Linhas>,
    agora: Date = AGORA,
  ) {
    await act(async () => {
      root.render(
        <ExportarParaContador
          buscarLinhas={buscarLinhas as never}
          agora={agora}
        />,
      );
    });
  }

  async function esperar() {
    for (let i = 0; i < 4; i += 1) {
      await act(async () => {
        await Promise.resolve();
      });
    }
  }

  const botao = (texto: RegExp): HTMLButtonElement => {
    const achado = [...container.querySelectorAll("button")].find((b) =>
      texto.test(b.textContent ?? ""),
    );
    if (!achado) throw new Error(`botão não achado: ${texto}`);
    return achado as HTMLButtonElement;
  };

  async function clicar(el: HTMLElement) {
    await act(async () => {
      el.click();
    });
    await esperar();
  }

  const campo = (rotulo: string): HTMLSelectElement => {
    const label = [...container.querySelectorAll("label")].find(
      (l) => l.textContent === rotulo,
    );
    const select = document.getElementById(
      label?.htmlFor ?? "",
    ) as HTMLSelectElement | null;
    if (!select) throw new Error(`campo não achado: ${rotulo}`);
    return select;
  };

  async function escolher(rotulo: string, valor: string) {
    const select = campo(rotulo);
    await act(async () => {
      Object.getOwnPropertyDescriptor(
        HTMLSelectElement.prototype,
        "value",
      )?.set?.call(select, valor);
      select.dispatchEvent(new Event("change", { bubbles: true }));
    });
  }

  const faixaDoAviso = () =>
    normalizar(
      container.querySelector<HTMLElement>("[aria-live]")?.textContent,
    );

  it("a lista de meses tem os 12 meses; a de anos, o atual e os 5 anteriores", async () => {
    await montar(async () => COM_VENDA);
    const meses = [...campo("Mês").querySelectorAll("option")];
    expect(meses.map((o) => o.value)).toEqual([
      "01",
      "02",
      "03",
      "04",
      "05",
      "06",
      "07",
      "08",
      "09",
      "10",
      "11",
      "12",
    ]);
    expect(meses[0]?.textContent).toBe("janeiro");
    expect(meses[11]?.textContent).toBe("dezembro");
    expect(
      [...campo("Ano").querySelectorAll("option")].map((o) => o.value),
    ).toEqual(["2026", "2025", "2024", "2023", "2022", "2021"]);
    // O padrão é o mês e o ano de hoje.
    expect(campo("Mês").value).toBe("10");
    expect(campo("Ano").value).toBe("2026");
  });

  it("a data de hoje é a de Brasília: 23h30 de 31/12 (02h30 UTC de 1/1) ainda é dezembro de 2026", async () => {
    await montar(async () => COM_VENDA, new Date("2027-01-01T02:30:00Z"));
    expect(campo("Mês").value).toBe("12");
    expect(campo("Ano").value).toBe("2026");
    expect(
      [...campo("Ano").querySelectorAll("option")].map((o) => o.value)[0],
    ).toBe("2026");
  });

  it.each([
    ["01", "janeiro de 2026"],
    ["10", "outubro de 2026"],
    ["12", "dezembro de 2026"],
  ])("mês %s: o aviso de 'baixado' escreve '%s'", async (mes, nome) => {
    // A venda tem de cair no mês pedido, senão o gerador diz "vazio".
    const dessaData: Linhas = {
      extrato: [
        { ...COM_VENDA.extrato[0], data: `2026-${mes}-05` },
      ] as Linhas["extrato"],
      guias: [],
    };
    await montar(async () => dessaData);
    await escolher("Mês", mes);
    await clicar(botao(/Exportar mês/));
    expect(faixaDoAviso()).toBe(
      `Arquivo de ${nome} baixado. Procure na pasta de downloads do aparelho.`,
    );
  });

  it("ano: o aviso de 'baixado' escreve só o ano", async () => {
    await montar(async () => COM_VENDA);
    await clicar(botao(/Exportar ano/));
    expect(faixaDoAviso()).toBe(
      "Arquivo de 2026 baixado. Procure na pasta de downloads do aparelho.",
    );
  });

  it("período vazio e erro de leitura também escrevem o mês por extenso", async () => {
    await montar(async () => SEM_NADA);
    await escolher("Mês", "03");
    await clicar(botao(/Exportar mês/));
    expect(faixaDoAviso()).toBe(
      "Não há vendas, devoluções ou guias em março de 2026, então nenhum arquivo foi baixado.",
    );

    act(() => root.unmount());
    root = createRoot(container);
    await montar(async () => {
      throw new Error("falhou");
    });
    await escolher("Mês", "11");
    await clicar(botao(/Exportar mês/));
    expect(faixaDoAviso()).toBe(
      "Não deu para ler os dados de novembro de 2026, então nenhum arquivo foi baixado.",
    );
  });

  it("só o aviso de erro é vermelho; baixado e vazio ficam em cinza", async () => {
    await montar(async () => COM_VENDA);
    await clicar(botao(/Exportar mês/));
    const aviso = () =>
      container.querySelector<HTMLElement>("[aria-live] p") as HTMLElement;
    expect(aviso().className).toContain("text-zinc-300");
    expect(aviso().className).not.toContain("text-red-300");

    act(() => root.unmount());
    root = createRoot(container);
    await montar(async () => SEM_NADA);
    await clicar(botao(/Exportar mês/));
    expect(aviso().className).toContain("text-zinc-300");
    expect(aviso().className).not.toContain("text-red-300");

    act(() => root.unmount());
    root = createRoot(container);
    await montar(async () => {
      throw new Error("falhou");
    });
    await clicar(botao(/Exportar mês/));
    expect(aviso().className).toContain("text-red-300");
    expect(aviso().className).not.toContain("text-zinc-300");
  });

  it("depois do download o link temporário não fica no documento", async () => {
    await montar(async () => COM_VENDA);
    await clicar(botao(/Exportar mês/));
    expect(document.querySelectorAll("a[download]")).toHaveLength(0);
    expect(document.body.querySelectorAll("a")).toHaveLength(0);
  });

  const doMes = () =>
    container.querySelectorAll<HTMLButtonElement>(
      "button",
    )[0] as HTMLButtonElement;
  const doAno = () =>
    container.querySelectorAll<HTMLButtonElement>(
      "button",
    )[1] as HTMLButtonElement;

  it("lendo o ANO: os dois botões ficam desabilitados e só o do ano mostra 'Gerando…'", async () => {
    let liberar!: (l: Linhas) => void;
    const pendente = new Promise<Linhas>((resolve) => {
      liberar = resolve;
    });
    await montar(() => pendente);

    // Parado: nenhum dos dois está ocupado.
    expect(doMes().getAttribute("aria-disabled")).toBe("false");
    expect(doAno().getAttribute("aria-disabled")).toBe("false");

    await clicar(doAno());
    expect(doMes().getAttribute("aria-disabled")).toBe("true");
    expect(doMes().textContent).toContain("Exportar mês");
    expect(doMes().hasAttribute("aria-busy")).toBe(false);
    expect(doAno().getAttribute("aria-disabled")).toBe("true");
    expect(doAno().getAttribute("aria-busy")).toBe("true");
    expect(doAno().textContent).toContain("Gerando…");

    await act(async () => {
      liberar(COM_VENDA);
    });
    await esperar();
    expect(doMes().getAttribute("aria-disabled")).toBe("false");
    expect(doAno().getAttribute("aria-disabled")).toBe("false");
    expect(doAno().hasAttribute("aria-busy")).toBe(false);
    expect(doAno().textContent).toContain("Exportar ano");
  });

  it("lendo o MÊS: os dois botões ficam desabilitados e só o do mês mostra 'Gerando…'", async () => {
    let liberar!: (l: Linhas) => void;
    const pendente = new Promise<Linhas>((resolve) => {
      liberar = resolve;
    });
    await montar(() => pendente);
    await clicar(doMes());
    expect(doMes().getAttribute("aria-disabled")).toBe("true");
    expect(doMes().getAttribute("aria-busy")).toBe("true");
    expect(doMes().textContent).toContain("Gerando…");
    expect(doAno().getAttribute("aria-disabled")).toBe("true");
    expect(doAno().hasAttribute("aria-busy")).toBe(false);
    expect(doAno().textContent).toContain("Exportar ano");
    await act(async () => {
      liberar(COM_VENDA);
    });
    await esperar();
    expect(doMes().getAttribute("aria-disabled")).toBe("false");
    expect(doAno().getAttribute("aria-disabled")).toBe("false");
  });
});
