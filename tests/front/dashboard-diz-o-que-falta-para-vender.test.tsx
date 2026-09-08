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
    expect(hospedeiro.textContent).toMatch(/3 produtos/);
    const cardEstoque = botaoComTexto(/estoque baixo/i);
    expect(cardEstoque).toBeTruthy();
    expect(cardEstoque!.tagName).toBe("BUTTON");

    await clicar(cardEstoque!);
    expect(onNavigate).toHaveBeenCalledWith("admin-notifications");
  });

  // ── A1 (laudo 08/09): "1 produtos" está errado — plural fixo ──
  it("com inventoryAlerts = 1, o card diz '1 produto' (singular), NUNCA '1 produtos'", async () => {
    const { LojaProntaEEstoqueBaixo } = await import(
      "@/components/admin/dashboard/LojaProntaEEstoqueBaixo"
    );

    await montar(
      <LojaProntaEEstoqueBaixo
        stats={{ inventoryAlerts: 1 }}
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

    expect(hospedeiro.textContent).toMatch(/1 produto\b/);
    expect(hospedeiro.textContent).not.toMatch(/1 produtos/);
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

    // chaveOk=true (não false): depois de A3 o item PIX não depende mais de
    // configCarregando — resolve direto para "feito"/"pendente". Para este
    // teste continuar cobrindo "nenhum PENDENTE aparece enquanto carrega",
    // a combinação usada é a que resolve PIX como feito (sem botão), e não
    // como "conferindo" — isso é coberto à parte pelo teste de A3 abaixo.
    await montar(
      <LojaProntaEEstoqueBaixo
        stats={{ inventoryAlerts: 0 }}
        originCep={undefined}
        ligado={true}
        chaveOk={true}
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

  // ── A2 (laudo 08/09, achado mais importante): trava dos 3 itens ──
  //
  // O revisor mostrou, mutando, que um 4º item acrescentado ao array `itens`
  // com estado "feito" passa pelos 16 testes antigos sem nenhum ficar
  // vermelho. O número de itens do checklist é DECISÃO DE PRODUTO do dono
  // ("nenhum item além desses três") — não é escolha de quem programa, e até
  // aqui nada impedia um 4º item de entrar em silêncio. Os dois testes
  // abaixo contam de verdade os `<li>` renderizados dentro da lista do
  // checklist (não um seletor que possa "passar por acaso" contando outra
  // coisa) e travam em exatamente 3, nomeando quais são os três.
  it("checklist com os 3 itens 'feito': exatamente 3 <li>, e são PIX, CEP e produto ativo — nenhum a mais", async () => {
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

    const itensDoChecklist = hospedeiro.querySelectorAll("ul > li");
    expect(itensDoChecklist.length).toBe(3);
    expect(itensDoChecklist[0]!.textContent ?? "").toMatch(/pix/i);
    expect(itensDoChecklist[1]!.textContent ?? "").toMatch(/cep/i);
    expect(itensDoChecklist[2]!.textContent ?? "").toMatch(/produto ativo/i);
  });

  it("checklist com os 3 itens 'pendente': exatamente 3 <li>, e são PIX, CEP e produto ativo — nenhum a mais", async () => {
    const { LojaProntaEEstoqueBaixo } = await import(
      "@/components/admin/dashboard/LojaProntaEEstoqueBaixo"
    );

    await montar(
      <LojaProntaEEstoqueBaixo
        stats={{ inventoryAlerts: 0 }}
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

    const itensDoChecklist = hospedeiro.querySelectorAll("ul > li");
    expect(itensDoChecklist.length).toBe(3);
    expect(itensDoChecklist[0]!.textContent ?? "").toMatch(/pix/i);
    expect(itensDoChecklist[1]!.textContent ?? "").toMatch(/cep/i);
    expect(itensDoChecklist[2]!.textContent ?? "").toMatch(/produto ativo/i);
  });

  // ── A3 (laudo 08/09): PIX não depende do carregamento da loja ──
  //
  // A resposta do item PIX vem de constantes de BUILD (`ligado`/`chaveOk`,
  // calculadas no import e que nunca mudam) — não do StoreContext. Antes,
  // o item ficava em "Conferindo…" enquanto `configCarregando` era `true`,
  // mesmo já sabendo a resposta: "não sei" na direção errada. Os outros dois
  // itens (CEP, produto) continuam gated pelo carregamento deles, porque
  // esses sim dependem de dado que ainda não chegou.
  it("PIX resolve direto para 'feito' mesmo com configCarregando=true; CEP continua 'conferindo'", async () => {
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
        configCarregando={true}
        produtosCarregando={false}
        onNavigate={vi.fn()}
        onTentarDeNovo={vi.fn()}
      />,
    );

    const itensDoChecklist = hospedeiro.querySelectorAll("ul > li");
    const textoPix = itensDoChecklist[0]!.textContent ?? "";
    const textoCep = itensDoChecklist[1]!.textContent ?? "";

    expect(textoPix).toMatch(/pagamento pix configurado/i);
    expect(textoPix).not.toMatch(/conferindo/i);
    expect(textoCep).toMatch(/conferindo/i);
  });

  // ── A4 (laudo 08/09): durante o carregamento, dizer QUAL item está ──
  //
  // Antes, os itens em carregamento mostravam o texto idêntico "Conferindo…"
  // sem identificação — quem usa leitor de tela não sabia o que estava
  // sendo conferido. Depois de A3, o item PIX nunca mais fica em
  // "carregando" (resolve na hora), então só CEP e produto podem estar
  // carregando ao mesmo tempo; o teste cobre exatamente esses dois e exige
  // que cada linha identifique o próprio item.
  it("com CEP e produto carregando, cada linha mostra um texto distinto que identifica o próprio item", async () => {
    const { LojaProntaEEstoqueBaixo } = await import(
      "@/components/admin/dashboard/LojaProntaEEstoqueBaixo"
    );

    await montar(
      <LojaProntaEEstoqueBaixo
        stats={{ inventoryAlerts: 0 }}
        originCep={undefined}
        ligado={true}
        chaveOk={true}
        produtos={[]}
        configCarregando={true}
        produtosCarregando={true}
        onNavigate={vi.fn()}
        onTentarDeNovo={vi.fn()}
      />,
    );

    const itensDoChecklist = hospedeiro.querySelectorAll("ul > li");
    const textoCep = itensDoChecklist[1]!.textContent ?? "";
    const textoProduto = itensDoChecklist[2]!.textContent ?? "";

    expect(textoCep).toMatch(/conferindo/i);
    expect(textoProduto).toMatch(/conferindo/i);
    expect(textoCep).not.toBe(textoProduto);
    expect(textoCep).toMatch(/cep/i);
    expect(textoProduto).toMatch(/produto/i);
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
