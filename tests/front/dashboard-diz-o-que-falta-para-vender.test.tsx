// @vitest-environment jsdom
//
// Dashboard do painel admin ganha um bloco que diz, sem o lojista ter de
// adivinhar: quantos produtos estão acabando (com atalho para a lista) e se
// a loja já está pronta para vender (3 pré-requisitos, cada pendência já
// levando para a tela certa).
//
// O componente é PURO (mesma escolha de StatusPagamentoPix.tsx): recebe tudo
// por props, não lê import.meta.env, não chama hook de dados. Isso é o que
// permite os testes abaixo exercitarem cada estado sem montar o Dashboard
// inteiro nem stubar Supabase.
//
// Sem @testing-library/react (não instalado neste projeto) — mesmo padrão
// dos outros testes de componente (ver tests/front/admin-kpi-carousel-compacto.test.tsx).
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// @ts-expect-error flag interna do React, sem tipo público — mesmo padrão
// dos outros testes de componente deste projeto.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

let hospedeiro: HTMLDivElement;
let raiz: Root;

async function montar(elemento: React.ReactElement) {
  await act(async () => {
    raiz.render(elemento);
  });
}

/** Acha, entre os botões renderizados, o que tem o texto pedido (equivalente
 * a getByRole("button", { name }) sem depender de @testing-library). */
function botaoComTexto(trecho: string | RegExp): HTMLButtonElement | undefined {
  const botoes = Array.from(hospedeiro.querySelectorAll("button"));
  return botoes.find((botao) =>
    typeof trecho === "string"
      ? (botao.textContent ?? "").includes(trecho)
      : trecho.test(botao.textContent ?? ""),
  );
}

async function clicar(botao: HTMLButtonElement) {
  await act(async () => {
    botao.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });
}

describe("LojaProntaEEstoqueBaixo — o painel diz o que falta para vender", () => {
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

  // ── Aceite 1: o card de estoque mostra o número e navega para os avisos ──
  it("card de estoque mostra o número de stats.inventoryAlerts e o clique navega para admin-notifications", async () => {
    const { LojaProntaEEstoqueBaixo } = await import(
      "@/components/admin/dashboard/LojaProntaEEstoqueBaixo"
    );
    const onNavigate = vi.fn();

    await montar(
      <LojaProntaEEstoqueBaixo
        stats={{ inventoryAlerts: 3 }}
        originCep="38500-000"
        ligado={true}
        chaveOk={true}
        produtos={[{ isActive: true }]}
        configCarregando={false}
        produtosCarregando={false}
        onNavigate={onNavigate}
        onTentarDeNovo={vi.fn()}
      />,
    );

    expect(hospedeiro.textContent).toContain("3");
    const cardEstoque = botaoComTexto(/estoque baixo/i);
    expect(cardEstoque).toBeTruthy();
    expect(cardEstoque!.tagName).toBe("BUTTON");

    await clicar(cardEstoque!);
    expect(onNavigate).toHaveBeenCalledWith("admin-notifications");
  });

  // ── Aceite 2: "não sei" nunca é zero ──
  it("stats nulo: o card diz que não conseguiu conferir, NUNCA mostra 0, e tem botão de tentar de novo", async () => {
    const { LojaProntaEEstoqueBaixo } = await import(
      "@/components/admin/dashboard/LojaProntaEEstoqueBaixo"
    );
    const onTentarDeNovo = vi.fn();

    await montar(
      <LojaProntaEEstoqueBaixo
        stats={null}
        originCep="38500-000"
        ligado={true}
        chaveOk={true}
        produtos={[{ isActive: true }]}
        configCarregando={false}
        produtosCarregando={false}
        onNavigate={vi.fn()}
        onTentarDeNovo={onTentarDeNovo}
      />,
    );

    // Nunca "0" no lugar do número de estoque — "não sei" não é zero.
    expect(botaoComTexto(/estoque baixo/i)).toBeFalsy();
    expect(hospedeiro.textContent).toMatch(/não consegui|não foi possível/i);
    expect(hospedeiro.textContent).not.toMatch(/estoque baixo:\s*0/i);

    const tentar = botaoComTexto(/tentar de novo/i);
    expect(tentar).toBeTruthy();
    await clicar(tentar!);
    expect(onTentarDeNovo).toHaveBeenCalledTimes(1);
  });

  it("inventoryAlerts não numérico (ex.: veio como string do banco): mesmo tratamento de 'não sei'", async () => {
    const { LojaProntaEEstoqueBaixo } = await import(
      "@/components/admin/dashboard/LojaProntaEEstoqueBaixo"
    );

    await montar(
      <LojaProntaEEstoqueBaixo
        stats={{ inventoryAlerts: Number.NaN }}
        originCep="38500-000"
        ligado={true}
        chaveOk={true}
        produtos={[{ isActive: true }]}
        configCarregando={false}
        produtosCarregando={false}
        onNavigate={vi.fn()}
        onTentarDeNovo={vi.fn()}
      />,
    );

    expect(hospedeiro.textContent).toMatch(/não consegui|não foi possível/i);
    expect(botaoComTexto(/tentar de novo/i)).toBeTruthy();
  });

  // ── Aceite 3: CEP de origem ──
  it("CEP de origem vazio: item pendente, e o clique navega para admin-shipping", async () => {
    const { LojaProntaEEstoqueBaixo } = await import(
      "@/components/admin/dashboard/LojaProntaEEstoqueBaixo"
    );
    const onNavigate = vi.fn();

    await montar(
      <LojaProntaEEstoqueBaixo
        stats={{ inventoryAlerts: 0 }}
        originCep=""
        ligado={true}
        chaveOk={true}
        produtos={[{ isActive: true }]}
        configCarregando={false}
        produtosCarregando={false}
        onNavigate={onNavigate}
        onTentarDeNovo={vi.fn()}
      />,
    );

    const cepPendente = botaoComTexto(/cep/i);
    expect(cepPendente).toBeTruthy();
    await clicar(cepPendente!);
    expect(onNavigate).toHaveBeenCalledWith("admin-shipping");
  });

  it("CEP de origem ausente (undefined): mesmo tratamento de pendente", async () => {
    const { LojaProntaEEstoqueBaixo } = await import(
      "@/components/admin/dashboard/LojaProntaEEstoqueBaixo"
    );

    await montar(
      <LojaProntaEEstoqueBaixo
        stats={{ inventoryAlerts: 0 }}
        originCep={undefined}
        ligado={true}
        chaveOk={true}
        produtos={[{ isActive: true }]}
        configCarregando={false}
        produtosCarregando={false}
        onNavigate={vi.fn()}
        onTentarDeNovo={vi.fn()}
      />,
    );

    expect(botaoComTexto(/cep/i)).toBeTruthy();
  });

  it("CEP de origem preenchido: item feito, sem botão", async () => {
    const { LojaProntaEEstoqueBaixo } = await import(
      "@/components/admin/dashboard/LojaProntaEEstoqueBaixo"
    );

    await montar(
      <LojaProntaEEstoqueBaixo
        stats={{ inventoryAlerts: 0 }}
        originCep="38500-000"
        ligado={true}
        chaveOk={true}
        produtos={[{ isActive: true }]}
        configCarregando={false}
        produtosCarregando={false}
        onNavigate={vi.fn()}
        onTentarDeNovo={vi.fn()}
      />,
    );

    expect(botaoComTexto(/cep/i)).toBeFalsy();
  });

  // ── Aceite 4: PIX, mesma regra do StatusPagamentoPix ──
  it("PIX ligado e com chave: item feito", async () => {
    const { LojaProntaEEstoqueBaixo } = await import(
      "@/components/admin/dashboard/LojaProntaEEstoqueBaixo"
    );

    await montar(
      <LojaProntaEEstoqueBaixo
        stats={{ inventoryAlerts: 0 }}
        originCep="38500-000"
        ligado={true}
        chaveOk={true}
        produtos={[{ isActive: true }]}
        configCarregando={false}
        produtosCarregando={false}
        onNavigate={vi.fn()}
        onTentarDeNovo={vi.fn()}
      />,
    );

    expect(botaoComTexto(/pix/i)).toBeFalsy();
  });

  it("PIX ligado sem chave pública: pendente, clique navega para admin-settings", async () => {
    const { LojaProntaEEstoqueBaixo } = await import(
      "@/components/admin/dashboard/LojaProntaEEstoqueBaixo"
    );
    const onNavigate = vi.fn();

    await montar(
      <LojaProntaEEstoqueBaixo
        stats={{ inventoryAlerts: 0 }}
        originCep="38500-000"
        ligado={true}
        chaveOk={false}
        produtos={[{ isActive: true }]}
        configCarregando={false}
        produtosCarregando={false}
        onNavigate={onNavigate}
        onTentarDeNovo={vi.fn()}
      />,
    );

    const pixPendente = botaoComTexto(/pix/i);
    expect(pixPendente).toBeTruthy();
    await clicar(pixPendente!);
    expect(onNavigate).toHaveBeenCalledWith("admin-settings");
  });

  it("PIX desligado: pendente, clique também navega para admin-settings", async () => {
    const { LojaProntaEEstoqueBaixo } = await import(
      "@/components/admin/dashboard/LojaProntaEEstoqueBaixo"
    );
    const onNavigate = vi.fn();

    await montar(
      <LojaProntaEEstoqueBaixo
        stats={{ inventoryAlerts: 0 }}
        originCep="38500-000"
        ligado={false}
        chaveOk={false}
        produtos={[{ isActive: true }]}
        configCarregando={false}
        produtosCarregando={false}
        onNavigate={onNavigate}
        onTentarDeNovo={vi.fn()}
      />,
    );

    const pixPendente = botaoComTexto(/pix/i);
    expect(pixPendente).toBeTruthy();
    await clicar(pixPendente!);
    expect(onNavigate).toHaveBeenCalledWith("admin-settings");
  });

  // ── Aceite 5: produto ativo — tem de ser isActive, não products.length ──
  it("nenhum produto ativo (lista só com produto INATIVO): pendente, clique navega para admin-products", async () => {
    const { LojaProntaEEstoqueBaixo } = await import(
      "@/components/admin/dashboard/LojaProntaEEstoqueBaixo"
    );
    const onNavigate = vi.fn();

    await montar(
      <LojaProntaEEstoqueBaixo
        stats={{ inventoryAlerts: 0 }}
        originCep="38500-000"
        ligado={true}
        chaveOk={true}
        produtos={[{ isActive: false }]}
        configCarregando={false}
        produtosCarregando={false}
        onNavigate={onNavigate}
        onTentarDeNovo={vi.fn()}
      />,
    );

    const produtoPendente = botaoComTexto(/produto ativo/i);
    expect(produtoPendente).toBeTruthy();
    await clicar(produtoPendente!);
    expect(onNavigate).toHaveBeenCalledWith("admin-products");
  });

  it("com 1+ produto ativo: feito, e os 3 itens feitos dizem que a loja está pronta para vender", async () => {
    const { LojaProntaEEstoqueBaixo } = await import(
      "@/components/admin/dashboard/LojaProntaEEstoqueBaixo"
    );

    await montar(
      <LojaProntaEEstoqueBaixo
        stats={{ inventoryAlerts: 0 }}
        originCep="38500-000"
        ligado={true}
        chaveOk={true}
        produtos={[{ isActive: false }, { isActive: true }]}
        configCarregando={false}
        produtosCarregando={false}
        onNavigate={vi.fn()}
        onTentarDeNovo={vi.fn()}
      />,
    );

    expect(botaoComTexto(/produto ativo/i)).toBeFalsy();
    // Frase declarativa (ponto final) — distinta do título "...vender?"
    // (interrogação), que aparece em TODA renderização do bloco.
    expect(hospedeiro.textContent).toMatch(/está pronta para vender\./);
  });

  // ── D4 — enquanto carrega, "conferindo…", nunca "pendente" (alarme falso) ──
  it("config e produtos ainda carregando: os itens mostram 'conferindo…', não 'pendente' nem 'feito'", async () => {
    const { LojaProntaEEstoqueBaixo } = await import(
      "@/components/admin/dashboard/LojaProntaEEstoqueBaixo"
    );

    await montar(
      <LojaProntaEEstoqueBaixo
        stats={{ inventoryAlerts: 0 }}
        originCep={undefined}
        ligado={true}
        chaveOk={false}
        produtos={[]}
        configCarregando={true}
        produtosCarregando={true}
        onNavigate={vi.fn()}
        onTentarDeNovo={vi.fn()}
      />,
    );

    // Nenhum botão de pendência aparece enquanto carrega — alarme falso é
    // exatamente o que D4 proíbe.
    expect(botaoComTexto(/cep/i)).toBeFalsy();
    expect(botaoComTexto(/pix/i)).toBeFalsy();
    expect(botaoComTexto(/produto ativo/i)).toBeFalsy();
    expect(hospedeiro.textContent).toMatch(/conferindo/i);
    // E o bloco não pode alegar que a loja está pronta sem ter conferido.
    expect(hospedeiro.textContent).not.toMatch(/está pronta para vender\./);
  });

  // ── Aceite 7: acessibilidade ──
  it("o card de estoque e cada item pendente têm nome acessível (são <button>)", async () => {
    const { LojaProntaEEstoqueBaixo } = await import(
      "@/components/admin/dashboard/LojaProntaEEstoqueBaixo"
    );

    await montar(
      <LojaProntaEEstoqueBaixo
        stats={{ inventoryAlerts: 5 }}
        originCep=""
        ligado={false}
        chaveOk={false}
        produtos={[]}
        configCarregando={false}
        produtosCarregando={false}
        onNavigate={vi.fn()}
        onTentarDeNovo={vi.fn()}
      />,
    );

    for (const botao of Array.from(hospedeiro.querySelectorAll("button"))) {
      expect((botao.textContent ?? "").trim().length).toBeGreaterThan(0);
    }
    expect(botaoComTexto(/estoque baixo/i)).toBeTruthy();
    expect(botaoComTexto(/cep/i)).toBeTruthy();
    expect(botaoComTexto(/pix/i)).toBeTruthy();
    expect(botaoComTexto(/produto ativo/i)).toBeTruthy();
  });
});

// ── Aceite 6: equivalência do número — o front e a RPC contam a MESMA coisa ──
//
// A ÚNICA assimetria conhecida, deliberadamente fora desta frente: a tela de
// avisos (useAvisosDoLojista.ts) varre no máximo TETO_DE_PRODUTOS = 200
// produtos e trata truncamento como FALHA da fonte de estoque; a RPC
// `low_stock_count` conta o catálogo inteiro, sem paginação. Numa loja com
// mais de 200 produtos o card deste componente mostra o número completo
// enquanto a tela de avisos diz "não consegui conferir produtos" — os dois
// lados são honestos sobre o que sabem, e reconciliar isso é outro trabalho.
describe("equivalência: o limiar do front é o MESMO literal gravado na migration do banco", () => {
  const MIGRATION = import.meta.glob<string>(
    "/supabase/migrations/20260902000000_kpi_usa_o_mesmo_estoque_que_a_tela.sql",
    { query: "?raw", import: "default", eager: true },
  );

  it("o glob achou a migration certa", () => {
    expect(Object.keys(MIGRATION).length).toBe(1);
  });

  it("COALESCE(estoque_minimo, N) do SQL é o MESMO N de LIMIAR_PADRAO_DE_ESTOQUE", async () => {
    const { LIMIAR_PADRAO_DE_ESTOQUE } = await import(
      "@/utils/avisos-do-lojista"
    );
    const sql = Object.values(MIGRATION)[0];

    const casado = sql.match(/COALESCE\(estoque_minimo,\s*(\d+)\)/);
    expect(
      casado,
      "o literal COALESCE(estoque_minimo, N) sumiu ou mudou de forma no SQL — " +
        "confira a migration 20260902000000 à mão antes de mexer no limiar do front",
    ).toBeTruthy();

    const limiarDoBanco = Number(casado![1]);
    expect(limiarDoBanco).toBe(LIMIAR_PADRAO_DE_ESTOQUE);
  });

  it("a RPC filtra o MESMO isActive (ativo = true, deleted_at IS NULL) que a tela de avisos usa", () => {
    const sql = Object.values(MIGRATION)[0];
    expect(sql).toMatch(/p\.deleted_at IS NULL AND p\.ativo = true/);
  });
});
