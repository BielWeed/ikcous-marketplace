// @vitest-environment jsdom
//
// Cadastro fiscal em DOIS APARELHOS: o último a gravar não desfaz o que o outro mudou.
//
// O defeito: a folha guardava uma cópia do cadastro ao abrir e mandava os quatro
// campos dessa cópia. A dona abre a folha no computador (MEI), troca para Simples no
// celular e salva; depois, no computador, corrige só a data de abertura e salva: o
// regime voltava para MEI sem aviso, e a tela dizia "salvo".
//
// A correção (mesma régua de "editar fornecedor manda só o mexido", PR #1964): a folha
// sabe quais campos a dona MEXEU; logo antes de gravar, relê o cadastro de agora e
// manda os mexidos por cima dele. O banco (`fiscal_cadastro_salvar`) continua
// recebendo a foto inteira, então aqui ele é imitado com a mesma regra: grava os
// quatro campos que chegam, e repetir o que já está lá não muda nada.
//
// O que prova:
//   D1  o cenário do defeito: o regime trocado no celular sobrevive à data corrigida
//       no computador
//   D2  Salvar sem mexer em nada, com a folha velha, não desfaz o celular
//   D3  o mesmo campo mexido nos dois: vale o último (é o que a dona escolheu agora)
//   D4  folha aberta SEM cadastro, e o outro aparelho criou um: o que a dona não
//       preencheu fica como o outro gravou
//   D5  a releitura falha (recusa, rede, prazo): NADA é gravado, a frase diz que nada
//       foi salvo e o Salvar continua livre (não é "sem resposta")
//   J   a junção pura (`juntarAoCadastroDeAgora`)
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { banco, falhaDaReleitura } = vi.hoisted(() => ({
  /** A linha única de `fiscal_cadastro` (null = loja sem cadastro). */
  banco: {
    linha: null as Record<string, string | boolean | null> | null,
    leituras: 0,
    gravacoes: [] as Array<Record<string, unknown>>,
  },
  /** Como a próxima releitura falha (`null` = responde normal). */
  falhaDaReleitura: {
    modo: null as null | "recusa" | "rede" | "prazo" | "tabela_ausente",
  },
}));

const mesmosCampos = (
  a: Record<string, unknown> | null,
  b: Record<string, unknown>,
) =>
  a !== null &&
  a.regime === b.regime &&
  a.atividade === b.atividade &&
  a.aberta_em === b.aberta_em &&
  a.vende_no_app_desde === b.vende_no_app_desde;

vi.mock("@/lib/supabase", () => ({
  supabase: {
    // Imita `fiscal_cadastro_salvar`: grava a FOTO INTEIRA que chega (campo ausente
    // grava vazio) e não toca a linha quando os quatro campos são os de agora.
    rpc: async (
      nome: string,
      args: { p: Record<string, string | boolean | null> },
    ) => {
      if (nome !== "fiscal_cadastro_salvar") {
        throw new Error(`rpc inesperada: ${nome}`);
      }
      const p = args.p;
      banco.gravacoes.push(p);
      const nova = {
        regime: p.regime,
        atividade: p.atividade,
        aberta_em: p.aberta_em ?? null,
        vende_no_app_desde: p.vende_no_app_desde ?? null,
      };
      if (!mesmosCampos(banco.linha, nova)) {
        banco.linha = {
          id: true,
          ...nova,
          atualizado_em: `2026-11-24T12:00:0${banco.gravacoes.length}Z`,
          atualizado_por: "uid-dona",
        };
      }
      return { data: { ...banco.linha }, error: null };
    },
    from: (tabela: string) => {
      if (tabela !== "fiscal_cadastro") {
        throw new Error(`leitura inesperada: ${tabela}`);
      }
      return {
        select: () => ({
          maybeSingle: async () => {
            banco.leituras += 1;
            const modo = falhaDaReleitura.modo;
            if (modo === "recusa") {
              return {
                data: null,
                error: { code: "PGRST301", message: "JWT expired" },
              };
            }
            if (modo === "tabela_ausente") {
              return {
                data: null,
                error: { code: "42P01", message: "relation does not exist" },
              };
            }
            if (modo === "rede") throw new TypeError("Failed to fetch");
            if (modo === "prazo") return new Promise(() => {});
            return {
              data: banco.linha ? { ...banco.linha } : null,
              error: null,
            };
          },
        }),
      };
    },
  },
}));

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

import { CadastroFiscalFolha } from "@/components/admin/financeiro/impostos/CadastroFiscalFolha";
import {
  type CadastroFiscal,
  type PayloadDoCadastroFiscal,
  juntarAoCadastroDeAgora,
  parseCadastroFiscal,
} from "@/lib/fiscal/cadastro";
import { supabase } from "@/lib/supabase";
import { escolherNaLista, valorDaLista } from "./helpers/lista-de-escolha";

const HOJE = "2026-11-24";
const ID_REGIME = "fiscal-cadastro-regime";
const ID_ATIVIDADE = "fiscal-cadastro-atividade";
const ID_ABERTA = "fiscal-cadastro-aberta-em";
const ID_VENDE = "fiscal-cadastro-vende-desde";

const LINHA_MEI = {
  id: true,
  regime: "mei",
  atividade: "comercio",
  aberta_em: "2024-05-10",
  vende_no_app_desde: "2025-01-01",
  atualizado_em: "2026-11-20T15:30:00Z",
  atualizado_por: "uid-dona",
};

/** O cadastro como a folha o recebe do cartão (o que estava no banco ao abrir). */
function cadastroDoBanco(): CadastroFiscal | null {
  const lido = parseCadastroFiscal(banco.linha);
  return lido.estado === "com_cadastro" ? lido.cadastro : null;
}

/** O OUTRO aparelho grava pela mesma porta do banco (a foto inteira dele). */
async function celularGrava(mudanca: Record<string, string | null>) {
  await supabase.rpc("fiscal_cadastro_salvar", {
    p: {
      regime: banco.linha?.regime ?? null,
      atividade: banco.linha?.atividade ?? null,
      aberta_em: banco.linha?.aberta_em ?? null,
      vende_no_app_desde: banco.linha?.vende_no_app_desde ?? null,
      ...mudanca,
    },
  });
}

let raiz: Root;
let hospedeiro: HTMLDivElement;
const aoFechar = vi.fn();
const aoSalvar = vi.fn();
const aoSemResposta = vi.fn();

async function assentar() {
  await act(async () => {
    await new Promise((r) => setTimeout(r, 10));
  });
}

async function abrirFolha(cadastro: CadastroFiscal | null) {
  hospedeiro = document.createElement("div");
  document.body.appendChild(hospedeiro);
  raiz = createRoot(hospedeiro);
  await act(async () => {
    raiz.render(
      <CadastroFiscalFolha
        cadastro={cadastro}
        hoje={HOJE}
        situacao="sou_o_dono"
        aoFechar={aoFechar}
        aoSalvar={aoSalvar}
        aoSemResposta={aoSemResposta}
      />,
    );
  });
  await assentar();
}

const texto = () => document.body.textContent ?? "";
function botao(rotulo: string): HTMLButtonElement {
  const achado = [...document.querySelectorAll("button")].find((b) =>
    b.textContent?.includes(rotulo),
  );
  if (!achado) throw new Error(`Botão "${rotulo}" não está na tela.`);
  return achado;
}
async function clicar(el: HTMLElement) {
  await act(async () => {
    el.click();
  });
  await assentar();
}
function campo(id: string): HTMLElement {
  const el = document.getElementById(id);
  if (!el) throw new Error(`Campo ${id} não está na tela.`);
  return el;
}
/** Regime e atividade são listas de escolha (botão que abre a lista). */
function ehLista(el: HTMLElement): boolean {
  return el.getAttribute("aria-haspopup") === "listbox";
}
/**
 * Preenche como a lojista: nas listas toca no campo e na opção (e espera a
 * lista fechar, o foco volta numa tarefa seguinte); nas datas digita.
 */
async function preencher(id: string, valor: string) {
  const el = campo(id);
  if (ehLista(el)) {
    await act(async () => {
      escolherNaLista(id, valor);
    });
    await act(async () => {
      await new Promise((resolver) => setTimeout(resolver, 0));
    });
    return;
  }
  await act(async () => {
    Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      "value",
    )?.set?.call(el, valor);
    el.dispatchEvent(new Event("input", { bubbles: true }));
  });
}
/** O que o campo mostra: o valor da lista ou o texto do campo de data. */
function valorDo(id: string): string {
  const el = campo(id);
  return ehLista(el) ? valorDaLista(id) : (el as HTMLInputElement).value;
}

beforeEach(() => {
  banco.linha = { ...LINHA_MEI };
  banco.leituras = 0;
  banco.gravacoes = [];
  falhaDaReleitura.modo = null;
  aoFechar.mockReset();
  aoSalvar.mockReset();
  aoSemResposta.mockReset();
});
afterEach(() => {
  act(() => raiz?.unmount());
  hospedeiro?.remove();
  vi.useRealTimers();
});

describe("Cadastro fiscal em dois aparelhos", () => {
  it("D1 o regime trocado no celular sobrevive à data corrigida no computador", async () => {
    // 1. O computador abre a folha com MEI.
    await abrirFolha(cadastroDoBanco());
    expect(valorDo(ID_REGIME)).toBe("mei");

    // 2. No celular, a dona troca para Simples Nacional e salva.
    await celularGrava({ regime: "simples" });
    expect(banco.linha?.regime).toBe("simples");

    // 3. No computador, com a folha ainda aberta (MEI na tela), corrige só a data.
    await preencher(ID_ABERTA, "2024-06-01");
    await clicar(botao("Salvar"));

    // 4. O regime continua Simples, e a data nova ficou.
    expect(banco.linha).toMatchObject({
      regime: "simples",
      atividade: "comercio",
      aberta_em: "2024-06-01",
      vende_no_app_desde: "2025-01-01",
    });
    expect(aoSalvar).toHaveBeenCalledTimes(1);
    expect(aoSemResposta).not.toHaveBeenCalled();
  });

  it("D1b o mês das vendas mexido no computador não desfaz a atividade trocada no celular", async () => {
    await abrirFolha(cadastroDoBanco());
    await celularGrava({ atividade: "com_servico", aberta_em: null });

    await preencher(ID_VENDE, "2025-03");
    await clicar(botao("Salvar"));

    expect(banco.linha).toMatchObject({
      regime: "mei",
      atividade: "com_servico",
      aberta_em: null,
      vende_no_app_desde: "2025-03-01",
    });
  });

  it("D2 Salvar sem mexer em nada, com a folha velha, não desfaz o celular", async () => {
    await abrirFolha(cadastroDoBanco());
    await celularGrava({ regime: "simples", aberta_em: "2023-02-02" });
    const linhaDoCelular = { ...banco.linha };

    await clicar(botao("Salvar"));

    expect(banco.linha).toEqual(linhaDoCelular);
    expect(aoSalvar).toHaveBeenCalledTimes(1);
  });

  it("D3 o mesmo campo mexido nos dois aparelhos: vale o que a dona escolheu por último", async () => {
    await abrirFolha(cadastroDoBanco());
    await celularGrava({ regime: "simples", aberta_em: "2023-02-02" });

    await preencher(ID_REGIME, "nao_sei");
    await clicar(botao("Salvar"));

    expect(banco.linha).toMatchObject({
      regime: "nao_sei",
      // O que o computador não mexeu continua como o celular deixou.
      aberta_em: "2023-02-02",
    });
  });

  it("D4 folha aberta sem cadastro e o outro aparelho criou um: o que a dona não preencheu fica", async () => {
    banco.linha = null;
    await abrirFolha(cadastroDoBanco());
    expect(valorDo(ID_REGIME)).toBe("");

    banco.linha = { ...LINHA_MEI, regime: "simples" };

    await preencher(ID_REGIME, "mei");
    await preencher(ID_ATIVIDADE, "comercio");
    await clicar(botao("Salvar"));

    expect(banco.linha).toMatchObject({
      regime: "mei",
      atividade: "comercio",
      aberta_em: "2024-05-10",
      vende_no_app_desde: "2025-01-01",
    });
  });

  it.each([
    [
      "recusa do servidor",
      "recusa" as const,
      "Entre de novo com a conta de administrador.",
    ],
    ["queda de rede", "rede" as const, "A conexão falhou e nada foi salvo."],
    [
      "tabela ausente",
      "tabela_ausente" as const,
      "O cadastro fiscal ainda não foi instalado no banco desta loja.",
    ],
  ])(
    "D5 a releitura falha (%s): nada é gravado, a frase é a da falha e o Salvar segue livre",
    async (_como, modo, frase) => {
      await abrirFolha(cadastroDoBanco());
      falhaDaReleitura.modo = modo;

      await preencher(ID_ABERTA, "2024-06-01");
      await clicar(botao("Salvar"));

      expect(banco.leituras).toBe(1);
      expect(banco.gravacoes).toHaveLength(0);
      expect(banco.linha).toEqual(LINHA_MEI);
      expect(aoSalvar).not.toHaveBeenCalled();
      // Não é "sem resposta": nada foi ao banco, então repetir é seguro.
      expect(aoSemResposta).not.toHaveBeenCalled();
      expect(botao("Salvar").getAttribute("aria-disabled")).not.toBe("true");
      expect(texto()).toContain(frase);
      // Nunca a frase de "pode ter gravado".
      expect(texto()).not.toContain("antes de tentar de novo");

      // A rede voltou: o mesmo Salvar grava (só o mexido).
      falhaDaReleitura.modo = null;
      await clicar(botao("Salvar"));
      expect(banco.gravacoes).toHaveLength(1);
      expect(banco.linha).toMatchObject({ aberta_em: "2024-06-01" });
      expect(aoSalvar).toHaveBeenCalledTimes(1);
    },
  );

  it("D5b a releitura passa do prazo: nada é gravado e a frase diz que nada foi salvo", async () => {
    await abrirFolha(cadastroDoBanco());
    vi.useFakeTimers();
    falhaDaReleitura.modo = "prazo";

    await preencher(ID_ABERTA, "2024-06-01");
    await act(async () => {
      botao("Salvar").click();
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(20_000);
    });

    expect(banco.gravacoes).toHaveLength(0);
    expect(aoSemResposta).not.toHaveBeenCalled();
    expect(texto()).toContain(
      "A internet demorou demais e nada foi salvo. Toque em Salvar de novo.",
    );
    expect(texto()).not.toContain("antes de tentar de novo");
    expect(botao("Salvar").getAttribute("aria-disabled")).not.toBe("true");
  });
});

describe("J juntarAoCadastroDeAgora", () => {
  const daFolha: PayloadDoCadastroFiscal = {
    regime: "mei",
    atividade: "comercio",
    aberta_em: "2024-06-01",
    vende_no_app_desde: null,
  };
  const deAgora: CadastroFiscal = {
    regime: "simples",
    atividade: "com_servico",
    abertaEm: "2020-01-01",
    vendeNoAppDesde: "2025-01-01",
    atualizadoEm: "2026-11-24T12:00:00Z",
    atualizadoPor: "uid-dona",
  };

  it("só os mexidos vêm da folha; o resto vem do cadastro de agora", () => {
    expect(juntarAoCadastroDeAgora(daFolha, ["aberta_em"], deAgora)).toEqual({
      regime: "simples",
      atividade: "com_servico",
      aberta_em: "2024-06-01",
      vende_no_app_desde: "2025-01-01",
    });
  });

  it("apagar uma data é mexer nela: o vazio da folha vale", () => {
    expect(
      juntarAoCadastroDeAgora(daFolha, ["vende_no_app_desde"], deAgora),
    ).toMatchObject({ vende_no_app_desde: null, aberta_em: "2020-01-01" });
  });

  it("nada mexido: devolve o cadastro de agora", () => {
    expect(juntarAoCadastroDeAgora(daFolha, [], deAgora)).toEqual({
      regime: "simples",
      atividade: "com_servico",
      aberta_em: "2020-01-01",
      vende_no_app_desde: "2025-01-01",
    });
  });

  it("sem cadastro agora: vale a folha inteira", () => {
    expect(juntarAoCadastroDeAgora(daFolha, ["regime"], null)).toEqual(daFolha);
  });
});
