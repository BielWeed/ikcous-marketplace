// @vitest-environment jsdom
//
// Financeiro — aba "Contas": a releitura das contas falhou (rede pendurada,
// erro do banco) mas o hook MANTÉM a lista de antes. A aba só mostrava erro
// quando não havia lista nenhuma; com lista antiga ela seguia mostrando
// "Saldo atual R$ 100" (o real, depois de uma saída de R$ 30, era R$ 70) sem
// aviso e sem "Tentar de novo". Agora a lista continua (é o que se viu), mas
// com o aviso de que os saldos podem estar velhos e o botão de tentar de novo.
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

import { AbaContasECategorias } from "@/components/admin/financeiro/AbaContasECategorias";
import type { ConsultaFinanceira } from "@/hooks/useFinanceiro";
import type { CategoriaFinanceira, ContaFinanceira } from "@/types/financeiro";

const AVISO =
  "Não deu para atualizar os saldos agora; estes valores podem estar desatualizados.";

const conta: ContaFinanceira = {
  id: "banco-teste",
  nome: "Banco de teste",
  tipo: "banco",
  saldoInicial: 0,
  saldoInicialEm: "2026-01-01",
  ativa: true,
  ordem: 1,
  sistema: false,
  saldo: 100,
};
const categoria: CategoriaFinanceira = {
  id: "despesa-teste",
  nome: "Material",
  natureza: "despesa",
  grupoDre: "despesa_fixa",
  ativa: true,
  sistema: false,
};

function consulta<T>(
  parcial: Partial<ConsultaFinanceira<T>>,
): ConsultaFinanceira<T> {
  return {
    dados: null,
    carregando: false,
    erro: null,
    recarregar: vi.fn(),
    ...parcial,
  };
}

describe("Financeiro — aba Contas com a releitura falhada", () => {
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
  });

  async function montar(
    contas: ConsultaFinanceira<ContaFinanceira[]>,
    categorias = consulta<CategoriaFinanceira[]>({ dados: [categoria] }),
  ) {
    await act(async () => {
      raiz.render(
        <AbaContasECategorias
          contas={contas}
          categorias={categorias}
          abrirFolha={vi.fn()}
        />,
      );
    });
  }

  const texto = () => (hospedeiro.textContent ?? "").replace(/\s+/g, " ");
  const botaoTentar = () =>
    [...hospedeiro.querySelectorAll("button")].filter(
      (b) => b.textContent?.trim() === "Tentar de novo",
    );

  it("erro com lista de antes: mostra a lista E avisa que o saldo pode estar velho", async () => {
    const recarregar = vi.fn();
    await montar(
      consulta({
        dados: [conta],
        erro: "A internet demorou demais.",
        recarregar,
      }),
    );

    // O que se viu continua na tela...
    expect(texto()).toContain("Banco de teste");
    expect(texto()).toContain("Saldo atual");
    expect(texto()).toContain("100,00");
    // ...mas com o aviso honesto, visível, e o botão que refaz a leitura.
    expect(texto()).toContain(AVISO);
    expect(hospedeiro.querySelector('[role="alert"]')?.textContent).toContain(
      AVISO,
    );
    const botoes = botaoTentar();
    expect(botoes).toHaveLength(1);
    await act(async () => {
      botoes[0]?.click();
    });
    expect(recarregar).toHaveBeenCalledTimes(1);
  });

  it("leitura em ordem: sem aviso e sem botão de tentar de novo", async () => {
    await montar(consulta({ dados: [conta] }));

    expect(texto()).toContain("100,00");
    expect(texto()).not.toContain("desatualizados");
    expect(botaoTentar()).toHaveLength(0);
  });

  it("atualizando por baixo da lista (sem erro ainda): não acusa falha", async () => {
    await montar(consulta({ dados: [conta], carregando: true }));

    expect(texto()).not.toContain("desatualizados");
    expect(botaoTentar()).toHaveLength(0);
  });

  it("erro sem nenhuma lista: segue o estado de erro de sempre, sem lista", async () => {
    await montar(
      consulta({ erro: "A internet demorou demais.", recarregar: vi.fn() }),
    );

    expect(texto()).toContain("A internet demorou demais.");
    expect(texto()).not.toContain("Saldo atual");
    expect(texto()).not.toContain(AVISO);
    expect(botaoTentar()).toHaveLength(1);
  });

  it("erro com lista de antes VAZIA: não esconde o estado vazio atrás do aviso de saldo", async () => {
    await montar(consulta({ dados: [], erro: "A internet demorou demais." }));

    expect(texto()).toContain("Nenhuma conta");
    expect(texto()).toContain(AVISO);
  });

  it("só o saldo das contas ganha o aviso: a falha das categorias não o dispara", async () => {
    await montar(
      consulta({ dados: [conta] }),
      consulta<CategoriaFinanceira[]>({
        dados: [categoria],
        erro: "A internet demorou demais.",
      }),
    );

    expect(texto()).not.toContain(AVISO);
  });
});
