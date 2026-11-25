// @vitest-environment jsdom
//
// Caderno das guias na tela (Gestão Fiscal, tarefa 20). É um componente de
// APRESENTAÇÃO: recebe os meses prontos e o `abrirFolha` do Financeiro. Abre escrita
// de dinheiro só por esse caminho (a lojista confere e confirma na folha), então
// aqui se prova principalmente o que ele ENTREGA à folha:
//   - "Lançar a guia deste mês" entrega o objeto de `guiaDoMes`, com o valor VAZIO no
//     Simples e em loja sem cadastro, mesmo com estimativa na mão;
//   - "Pagar" entrega o alvo da baixa que a aba mandou, sem inventar nenhum;
//   - o arquivo nunca importa módulo de escrita nem fala com o banco.
// Fixtures inventadas: nenhum dado de loja real.
import { readFileSync } from "node:fs";
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

import {
  CadernoDeGuias,
  type MesParaOCaderno,
} from "@/components/admin/financeiro/impostos/CadernoDeGuias";
import type {
  AbrirFolha,
  AlvoDaBaixa,
} from "@/components/admin/financeiro/navegacao";
import { ContextoValoresOcultos } from "@/components/admin/financeiro/partes";
import type { EstadoDoMes, MesDoCaderno } from "@/lib/fiscal/caderno";
import { compararEstimativaComGuia } from "@/lib/fiscal/comparacao";
import { guiaDoMes } from "@/lib/fiscal/guia-do-mes";
import { parametrosDoAno } from "@/lib/fiscal/parametros-da-lei";
import { CATEGORIA_DE_IMPOSTOS_ID } from "@/lib/fiscal/receita-do-mes";

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

const SIMPLES = { regime: "simples", atividade: "comercio" } as const;
const MEI = { regime: "mei", atividade: "comercio" } as const;

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

function item(
  caderno: MesDoCaderno,
  extra: Partial<Omit<MesParaOCaderno, "caderno">> = {},
): MesParaOCaderno {
  return { caderno, ...extra };
}

function alvo(id: string, descricao: string, valor: number): AlvoDaBaixa {
  return {
    id,
    descricao,
    valor,
    contaId: null,
    lado: "saida",
    vencimento: "2026-11-20",
  };
}

async function montar(
  meses: readonly MesParaOCaderno[],
  opcoes: {
    cadastro?: Parameters<typeof CadernoDeGuias>[0]["cadastro"];
    abrirFolha?: ReturnType<typeof vi.fn>;
    ocultos?: boolean;
  } = {},
) {
  const abrirFolha = opcoes.abrirFolha ?? vi.fn();
  await act(async () =>
    root.render(
      <ContextoValoresOcultos.Provider value={opcoes.ocultos ?? false}>
        <CadernoDeGuias
          meses={meses}
          cadastro={opcoes.cadastro === undefined ? null : opcoes.cadastro}
          abrirFolha={abrirFolha as AbrirFolha}
        />
      </ContextoValoresOcultos.Provider>,
    ),
  );
  return abrirFolha;
}

const normalizar = (t: string | null | undefined) =>
  (t ?? "").replace(/\s+/g, " ").trim();

function cartao(competencia: string): HTMLElement {
  const el = host.querySelector<HTMLElement>(`li[data-mes="${competencia}"]`);
  if (!el) throw new Error(`cartão de ${competencia} não encontrado`);
  return el;
}

function botoes(dentro: ParentNode, texto: string): HTMLButtonElement[] {
  return Array.from(dentro.querySelectorAll("button")).filter((b) =>
    normalizar(b.textContent).startsWith(texto),
  );
}

async function clicar(botao: HTMLElement) {
  await act(async () => {
    botao.click();
  });
}

/** O texto do valor ao lado de um rótulo ("Valor da guia" → "R$ 100,50"). */
function valorDe(dentro: ParentNode, rotulo: string): string {
  const dt = Array.from(dentro.querySelectorAll("dt")).find(
    (d) => normalizar(d.textContent) === rotulo,
  );
  if (!dt) throw new Error(`rótulo "${rotulo}" não encontrado`);
  return normalizar(dt.nextElementSibling?.textContent);
}

describe("Caderno das guias — os três estados", () => {
  it("mostra, por mês, Valor da guia, A pagar e Pago com o valor de cada um", async () => {
    await montar([
      item(mes("2026-10", "a_pagar", { guia: 100.5, pago: 40, aPagar: 60.5 })),
    ]);
    const c = cartao("2026-10");
    expect(valorDe(c, "Valor da guia")).toBe("R$ 100,50");
    expect(valorDe(c, "A pagar")).toBe("R$ 60,50");
    expect(valorDe(c, "Pago")).toBe("R$ 40,00");
    expect(normalizar(c.textContent)).toContain("outubro de 2026");
  });

  it("mês sem guia não inventa R$ 0,00: diz que não há guia lançada", async () => {
    await montar([item(mes("2026-09", "sem_guia"))]);
    const c = cartao("2026-09");
    expect(normalizar(c.textContent)).toContain("Sem guia lançada");
    expect(c.querySelector("dt")).toBeNull();
    expect(normalizar(c.textContent)).not.toContain("R$");
  });

  it("cada situação tem texto E ícone (a cor nunca é a única pista)", async () => {
    await montar([
      item(mes("2026-07", "sem_guia")),
      item(mes("2026-08", "paga", { guia: 80, pago: 80 })),
      item(mes("2026-09", "vencida", { guia: 80, aPagar: 80 })),
      item(mes("2026-10", "a_pagar", { guia: 80, aPagar: 80 })),
    ]);
    const esperado: Record<string, string> = {
      "2026-07": "Sem guia lançada",
      "2026-08": "Paga",
      "2026-09": "Vencida",
      "2026-10": "Falta pagar",
    };
    for (const [competencia, texto] of Object.entries(esperado)) {
      const c = cartao(competencia);
      const selo = c.querySelector("[data-selo-do-mes]");
      expect(normalizar(selo?.textContent), competencia).toBe(texto);
      expect(selo?.querySelector("svg"), competencia).not.toBeNull();
    }
  });

  it("mostra o mês mais recente primeiro, qualquer que seja a ordem recebida", async () => {
    await montar([
      item(mes("2026-08", "sem_guia")),
      item(mes("2026-10", "sem_guia")),
      item(mes("2026-09", "sem_guia")),
    ]);
    const ordem = Array.from(host.querySelectorAll("li[data-mes]")).map((li) =>
      li.getAttribute("data-mes"),
    );
    expect(ordem).toEqual(["2026-10", "2026-09", "2026-08"]);
  });

  it("sem nenhum mês para mostrar: estado vazio honesto, sem cartão", async () => {
    await montar([]);
    expect(host.querySelector("li[data-mes]")).toBeNull();
    expect(normalizar(host.textContent)).toContain("Nenhum mês para mostrar");
  });
});

describe("Caderno das guias — Lançar a guia deste mês", () => {
  it("entrega a `abrirFolha` o objeto de guiaDoMes, com o valor VAZIO no Simples mesmo com estimativa", async () => {
    const abrirFolha = await montar(
      [item(mes("2026-10", "sem_guia"), { estimativa: 410 })],
      { cadastro: SIMPLES },
    );
    const [lancar] = botoes(cartao("2026-10"), "Lançar a guia deste mês");
    expect(lancar).toBeDefined();
    await clicar(lancar as HTMLElement);

    expect(abrirFolha).toHaveBeenCalledTimes(1);
    const chamada = abrirFolha.mock.calls[0]?.[0];
    expect(chamada).toEqual({
      tipo: "novo-lancamento",
      inicial: guiaDoMes(SIMPLES, "2026-10", 2026),
    });
    // O que importa, dito sem depender da função: despesa a pagar na categoria de
    // impostos, competência no mês das vendas e NENHUM valor.
    expect(chamada.inicial).toMatchObject({
      tipo: "saida",
      situacao: "previsto",
      categoriaId: CATEGORIA_DE_IMPOSTOS_ID,
      dataCompetencia: "2026-10-01",
      descricao: "DAS 10/2026",
      valor: "",
    });
    expect(JSON.stringify(chamada)).not.toContain("410");
  });

  it("loja SEM cadastro fiscal também vê o caderno e lança a guia com o valor vazio", async () => {
    const abrirFolha = await montar(
      [
        item(mes("2026-10", "sem_guia"), { estimativa: 410 }),
        item(mes("2026-09", "paga", { guia: 90, pago: 90 })),
      ],
      { cadastro: null },
    );
    expect(host.querySelector("li[data-mes]")).not.toBeNull();
    const [lancar] = botoes(cartao("2026-10"), "Lançar a guia deste mês");
    await clicar(lancar as HTMLElement);
    expect(abrirFolha).toHaveBeenCalledTimes(1);
    expect(abrirFolha.mock.calls[0]?.[0]).toEqual({
      tipo: "novo-lancamento",
      inicial: guiaDoMes(null, "2026-10", 2026),
    });
    expect(abrirFolha.mock.calls[0]?.[0].inicial.valor).toBe("");
  });

  it("MEI recebe exatamente o que guiaDoMes entrega (a lei decide o valor, nunca a estimativa)", async () => {
    const abrirFolha = await montar(
      [item(mes("2026-10", "sem_guia"), { estimativa: 999 })],
      { cadastro: MEI },
    );
    const [lancar] = botoes(cartao("2026-10"), "Lançar a guia deste mês");
    await clicar(lancar as HTMLElement);
    const esperado = guiaDoMes(MEI, "2026-10", 2026);
    expect(abrirFolha.mock.calls[0]?.[0]).toEqual({
      tipo: "novo-lancamento",
      inicial: esperado,
    });
    // 2026 é o ano conferido na lei: o MEI sai com o DAS fixo (não vazio). Se um dia o
    // ano deixar de estar conferido, este teste avisa em vez de passar no vazio.
    expect(parametrosDoAno(2026).conferido).toBe(true);
    expect(esperado?.valor).not.toBe("");
    expect(abrirFolha.mock.calls[0]?.[0].inicial.valor).not.toBe("999.00");
    expect(abrirFolha.mock.calls[0]?.[0].inicial.valor).not.toBe("999");
  });

  it("o ano da lei é o do mês das vendas (virada de ano não empresta o valor do ano errado)", async () => {
    const abrirFolha = await montar([item(mes("2027-01", "sem_guia"))], {
      cadastro: MEI,
    });
    const [lancar] = botoes(cartao("2027-01"), "Lançar a guia deste mês");
    await clicar(lancar as HTMLElement);
    expect(abrirFolha.mock.calls[0]?.[0].inicial).toEqual(
      guiaDoMes(MEI, "2027-01", 2027),
    );
    expect(abrirFolha.mock.calls[0]?.[0].inicial.valor).toBe("");
  });

  it("só oferece lançar onde NÃO há guia (mês com guia não ganha a segunda)", async () => {
    await montar([
      item(mes("2026-07", "sem_guia")),
      item(mes("2026-08", "paga", { guia: 80, pago: 80 })),
      item(mes("2026-09", "vencida", { guia: 80, aPagar: 80 })),
      item(mes("2026-10", "a_pagar", { guia: 80, aPagar: 80 })),
    ]);
    expect(botoes(cartao("2026-07"), "Lançar a guia deste mês")).toHaveLength(
      1,
    );
    for (const c of ["2026-08", "2026-09", "2026-10"]) {
      expect(botoes(cartao(c), "Lançar a guia deste mês"), c).toHaveLength(0);
    }
  });

  it("competência que não é aaaa-mm não abre formulário com data inventada", async () => {
    const abrirFolha = await montar([item(mes("2026-13", "sem_guia"))], {
      cadastro: SIMPLES,
    });
    expect(botoes(host, "Lançar a guia deste mês")).toHaveLength(0);
    expect(abrirFolha).not.toHaveBeenCalled();
  });

  it("o botão diz de qual mês é (leitor de tela) e tem alvo de toque de 44 px", async () => {
    await montar([item(mes("2026-10", "sem_guia"))], { cadastro: SIMPLES });
    const [lancar] = botoes(cartao("2026-10"), "Lançar a guia deste mês");
    expect(lancar?.getAttribute("aria-label")).toBe(
      "Lançar a guia deste mês (outubro de 2026)",
    );
    expect(lancar?.className).toContain("min-h-11");
  });
});

describe("Caderno das guias — Pagar", () => {
  it("abre a folha de baixa que já existe, com o alvo que a aba mandou", async () => {
    const guia = alvo("g-1", "DAS 10/2026", 60.5);
    const abrirFolha = await montar([
      item(mes("2026-10", "a_pagar", { guia: 60.5, aPagar: 60.5 }), {
        guiasAPagar: [guia],
      }),
    ]);
    const [pagar] = botoes(cartao("2026-10"), "Pagar");
    expect(pagar).toBeDefined();
    await clicar(pagar as HTMLElement);
    expect(abrirFolha).toHaveBeenCalledTimes(1);
    expect(abrirFolha).toHaveBeenCalledWith({ tipo: "baixar", alvo: guia });
  });

  it("duas guias a pagar no mesmo mês: um Pagar para cada, cada um com o seu alvo", async () => {
    const a = alvo("g-a", "DAS 10/2026", 60);
    const b = alvo("g-b", "DAS 10/2026 (complementar)", 15.25);
    const abrirFolha = await montar([
      item(mes("2026-10", "vencida", { guia: 75.25, aPagar: 75.25 }), {
        guiasAPagar: [a, b],
      }),
    ]);
    const pagar = botoes(cartao("2026-10"), "Pagar");
    expect(pagar).toHaveLength(2);
    expect(pagar.map((p) => p.getAttribute("aria-label"))).toEqual([
      "Pagar DAS 10/2026",
      "Pagar DAS 10/2026 (complementar)",
    ]);
    await clicar(pagar[1] as HTMLElement);
    expect(abrirFolha).toHaveBeenCalledTimes(1);
    expect(abrirFolha).toHaveBeenCalledWith({ tipo: "baixar", alvo: b });
  });

  it("mês pago ou sem guia não tem Pagar", async () => {
    await montar([
      item(mes("2026-08", "paga", { guia: 80, pago: 80 })),
      item(mes("2026-09", "sem_guia")),
    ]);
    expect(botoes(host, "Pagar")).toHaveLength(0);
    // Nem o recado de "vá a Pagar e receber": não há nada a pagar nesses meses.
    expect(normalizar(host.textContent)).not.toContain("Pagar e receber");
  });

  it("mês pago não mostra Pagar nem que a aba mande uma guia (a guarda é do mês, não da aba)", async () => {
    await montar([
      item(mes("2026-08", "paga", { guia: 80, pago: 80 }), {
        guiasAPagar: [alvo("g-9", "DAS 08/2026", 80)],
      }),
      item(mes("2026-09", "sem_guia"), {
        guiasAPagar: [alvo("g-8", "DAS 09/2026", 80)],
      }),
    ]);
    expect(botoes(host, "Pagar")).toHaveLength(0);
    expect(normalizar(host.textContent)).not.toContain("DAS 08/2026");
  });

  it("o título do mês só põe maiúscula na primeira letra (nunca 'De')", async () => {
    await montar([item(mes("2026-10", "a_pagar", { guia: 80, aPagar: 80 }))]);
    const titulo = cartao("2026-10").querySelector("h3");
    expect(titulo?.textContent).toBe("outubro de 2026");
    expect(titulo?.className).toContain("first-letter:uppercase");
    expect(titulo?.className).not.toContain("capitalize");
  });

  it("há valor a pagar mas a aba não mandou o alvo: não inventa botão, manda ir a Pagar e receber", async () => {
    const abrirFolha = await montar([
      item(mes("2026-10", "a_pagar", { guia: 80, aPagar: 80 })),
    ]);
    expect(botoes(host, "Pagar")).toHaveLength(0);
    expect(normalizar(cartao("2026-10").textContent)).toContain(
      "Pagar e receber",
    );
    expect(abrirFolha).not.toHaveBeenCalled();
  });

  it("o botão tem alvo de toque de 44 px e o nome do botão não vaza o valor", async () => {
    await montar(
      [
        item(mes("2026-10", "a_pagar", { guia: 60.5, aPagar: 60.5 }), {
          guiasAPagar: [alvo("g-1", "DAS 10/2026", 60.5)],
        }),
      ],
      { ocultos: true },
    );
    const [pagar] = botoes(cartao("2026-10"), "Pagar");
    expect(pagar?.className).toContain("min-h-11");
    expect(pagar?.getAttribute("aria-label")).not.toMatch(/\d{2},\d{2}/);
  });
});

describe("Caderno das guias — comparação da estimativa com a guia", () => {
  const FRASE = "a estimativa do app ficou";

  it("aparece quando há meses com estimativa E guia, com a frase de comparacao.ts", async () => {
    const meses = [
      item(mes("2026-09", "paga", { guia: 100, pago: 100 }), {
        estimativa: 120,
      }),
      item(mes("2026-10", "a_pagar", { guia: 200, aPagar: 200 }), {
        estimativa: 220,
      }),
    ];
    await montar(meses, { cadastro: SIMPLES });
    const esperado = compararEstimativaComGuia([
      { mes: "2026-09", estimativa: 120, guia: 100 },
      { mes: "2026-10", estimativa: 220, guia: 200 },
    ]);
    expect(esperado).not.toBeNull();
    const caixa = host.querySelector("[data-comparacao-da-estimativa]");
    expect(caixa).not.toBeNull();
    expect(normalizar(caixa?.textContent)).toContain(esperado?.frase ?? "?");
    expect(normalizar(caixa?.textContent)).toContain(FRASE);
  });

  it("não aparece sem estimativa nenhuma (loja sem conta)", async () => {
    await montar([item(mes("2026-09", "paga", { guia: 100, pago: 100 }))], {
      cadastro: { regime: "presumido", atividade: "comercio" },
    });
    expect(host.querySelector("[data-comparacao-da-estimativa]")).toBeNull();
    expect(normalizar(host.textContent)).not.toContain(FRASE);
  });

  it("não aparece quando a estimativa existe mas o mês não tem guia (não é zero, é não saber)", async () => {
    await montar([item(mes("2026-10", "sem_guia"), { estimativa: 410 })], {
      cadastro: SIMPLES,
    });
    expect(host.querySelector("[data-comparacao-da-estimativa]")).toBeNull();
  });

  it("não aparece quando há guia mas o app não estimou o mês", async () => {
    await montar(
      [
        item(mes("2026-09", "paga", { guia: 100, pago: 100 }), {
          estimativa: null,
        }),
      ],
      { cadastro: SIMPLES },
    );
    expect(host.querySelector("[data-comparacao-da-estimativa]")).toBeNull();
  });

  it("a frase não traz valor em reais, então 'Ocultar valores' não tem o que esconder nela", async () => {
    await montar(
      [
        item(mes("2026-09", "paga", { guia: 100, pago: 100 }), {
          estimativa: 118,
        }),
      ],
      { cadastro: SIMPLES, ocultos: true },
    );
    const caixa = host.querySelector("[data-comparacao-da-estimativa]");
    expect(normalizar(caixa?.textContent)).not.toContain("R$");
  });
});

describe("Caderno das guias — Ocultar valores", () => {
  it("com o olho ligado nenhum valor em reais aparece, nem no texto lido", async () => {
    await montar(
      [
        item(
          mes("2026-10", "a_pagar", { guia: 123.45, pago: 3.45, aPagar: 120 }),
          {
            guiasAPagar: [alvo("g-1", "DAS 10/2026", 120)],
          },
        ),
      ],
      { ocultos: true },
    );
    const texto = normalizar(host.textContent);
    expect(texto).not.toMatch(/123,45|3,45|120,00/);
    expect(texto).toContain("Valor oculto");
  });
});

describe("Caderno das guias — o arquivo não escreve nem fala com o banco", () => {
  const fonte = readFileSync(
    "src/components/admin/financeiro/impostos/CadernoDeGuias.tsx",
    "utf8",
  );

  it("não importa nem cita nenhum módulo de escrita de lançamento financeiro", () => {
    expect(fonte).not.toMatch(
      /salvarLancamento|baixarLancamento|cancelarLancamento|fin_lancamento_salvar|fin_baixar|fin_cancelar/,
    );
  });

  it("não fala com o Supabase nem busca dado (a aba é quem lê)", () => {
    expect(fonte).not.toMatch(/supabase|useFinanceiro|useImpostos|fetch\(/);
  });

  it("o valor do lançamento nunca vem da estimativa: ela só entra na comparação", () => {
    // `guiaDoMes` nem recebe estimativa; este teste fecha a outra ponta: o arquivo
    // não monta o `inicial` por conta própria.
    expect(fonte).not.toMatch(/inicial:\s*\{/);
    expect(fonte).not.toMatch(/valor:\s*(String|\(|[a-z]*\.?estimativa)/);
  });
});
