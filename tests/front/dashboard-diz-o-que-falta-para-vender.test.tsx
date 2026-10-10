// @vitest-environment jsdom
//
// Início do painel: o bloco que diz, sem a lojista ter de adivinhar, quantos
// produtos estão acabando (com atalho para a lista) e se a loja já está
// pronta para vender. O cartão da loja pronta é GUIADO (E3 do painel simples):
// "4 de 6 prontos", UM botão grande "Próximo passo: …" que leva ao destino do
// primeiro passo pendente, a lista dos seis recolhida (botão com
// `aria-expanded`) e, com 6/6, só a linha "Loja pronta para vender". O horário
// de atendimento NÃO conta.
//
// O componente é PURO (mesma escolha de StatusPagamentoPix.tsx): recebe tudo
// por props, não lê import.meta.env, não chama hook de dados. Isso é o que
// permite os testes abaixo exercitarem cada estado sem montar o Início
// inteiro nem stubar Supabase.
//
// Sem @testing-library/react (não instalado neste projeto) — mesmo padrão
// dos outros testes de componente (ver tests/front/admin-kpi-carousel-compacto.test.tsx).
import { LojaProntaEEstoqueBaixo } from "@/components/admin/dashboard/LojaProntaEEstoqueBaixo";
import { montarEnderecoDaLoja } from "@/lib/endereco-da-loja";
import { type ComponentProps, act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// @ts-expect-error flag interna do React, sem tipo público — mesmo padrão
// dos outros testes de componente deste projeto.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

type Props = ComponentProps<typeof LojaProntaEEstoqueBaixo>;

const ENDERECO_PRONTO = montarEnderecoDaLoja({
  cep: "01310100",
  rua: "Avenida Paulista",
  numero: "1578",
  complemento: "",
  bairro: "Bela Vista",
  cidade: "São Paulo",
  uf: "SP",
});

/** Loja toda pronta (6/6); cada teste estraga só o que quer provar. Repare:
 * nenhum horário de atendimento aqui — ele não faz parte da contagem. */
const CONFIG_PRONTA: Props["config"] = {
  storeName: "Ateliê da Serra",
  logoUrl: "https://exemplo.test/logo.png",
  originCep: ENDERECO_PRONTO.originCep,
  storeAddress: ENDERECO_PRONTO.storeAddress,
  whatsappNumber: "(34) 99999-9999",
};

function propsDoCartao(parcial: Partial<Props> = {}): Props {
  return {
    stats: { inventoryAlerts: 0 },
    config: CONFIG_PRONTA,
    ligado: true,
    chaveOk: true,
    formasNaEntrega: [],
    produtos: [{ isActive: true }],
    configCarregando: false,
    produtosCarregando: false,
    onNavigate: vi.fn(),
    onTentarDeNovo: vi.fn(),
    ...parcial,
  };
}

let hospedeiro: HTMLDivElement;
let raiz: Root;

async function montar(parcial: Partial<Props> = {}) {
  await act(async () => {
    raiz.render(<LojaProntaEEstoqueBaixo {...propsDoCartao(parcial)} />);
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

/** O botão que recolhe/abre a lista dos seis passos. */
function botaoDaLista(): HTMLButtonElement | undefined {
  return Array.from(
    hospedeiro.querySelectorAll<HTMLButtonElement>("button[aria-expanded]"),
  )[0];
}

async function abrirALista() {
  const botao = botaoDaLista();
  expect(botao).toBeTruthy();
  await clicar(botao!);
}

function linhasDaLista(): HTMLLIElement[] {
  return Array.from(hospedeiro.querySelectorAll<HTMLLIElement>("ul > li"));
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

  // ── O card de estoque mostra o número e navega para os avisos ──
  it("card de estoque mostra o número de stats.inventoryAlerts e o clique navega para admin-notifications", async () => {
    const onNavigate = vi.fn();

    await montar({ stats: { inventoryAlerts: 3 }, onNavigate });

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
    await montar({ stats: { inventoryAlerts: 1 } });

    expect(hospedeiro.textContent).toMatch(/1 produto(?!s)/);
    expect(hospedeiro.textContent).not.toMatch(/1 produtos/);
  });

  // ── "Não sei" nunca é zero ──
  it("stats nulo: o card diz que não conseguiu conferir, NUNCA mostra 0, e tem botão de tentar de novo", async () => {
    const onTentarDeNovo = vi.fn();

    await montar({ stats: null, onTentarDeNovo });

    // Nunca "0" no lugar do número de estoque — "não sei" não é zero.
    expect(botaoComTexto(/estoque baixo/i)).toBeFalsy();
    expect(hospedeiro.textContent).toMatch(/não consegui|não foi possível/i);
    expect(hospedeiro.textContent).not.toMatch(/estoque baixo:\s*0/i);

    const tentar = botaoComTexto(/tentar de novo/i);
    expect(tentar).toBeTruthy();
    await clicar(tentar!);
    expect(onTentarDeNovo).toHaveBeenCalledTimes(1);
  });

  // ── D-carregando: a busca ainda está em andamento não é falha ──
  //
  // Em toda abertura do Início sem cache, `stats` nasce `null` e a RPC só é
  // disparada depois de um atraso, então o lojista lia "não foi possível
  // conferir o estoque" antes mesmo da busca começar. `estoqueCarregando`
  // distingue "ainda não sei porque estou buscando" de "busquei e não consegui".
  it("estoqueCarregando=true e stats=null: mostra o estado de carregando, NUNCA a mensagem de falha nem o botão de tentar de novo", async () => {
    await montar({ stats: null, estoqueCarregando: true });

    expect(hospedeiro.textContent).not.toMatch(
      /não consegui|não foi possível/i,
    );
    expect(botaoComTexto(/tentar de novo/i)).toBeFalsy();
    expect(botaoComTexto(/estoque baixo/i)).toBeFalsy();
    expect(hospedeiro.textContent).toMatch(/conferindo estoque/i);
  });

  it("estoqueCarregando=false e stats=null: continua no estado de falha, com o botão de tentar de novo (comportamento já provado, não pode regredir)", async () => {
    const onTentarDeNovo = vi.fn();

    await montar({ stats: null, estoqueCarregando: false, onTentarDeNovo });

    expect(hospedeiro.textContent).toMatch(/não consegui|não foi possível/i);
    const tentar = botaoComTexto(/tentar de novo/i);
    expect(tentar).toBeTruthy();
    await clicar(tentar!);
    expect(onTentarDeNovo).toHaveBeenCalledTimes(1);
  });

  it("estoqueCarregando=true mas com stats.inventoryAlerts=3: o número em mãos ganha do carregando, mostra 3", async () => {
    const onNavigate = vi.fn();

    await montar({
      stats: { inventoryAlerts: 3 },
      estoqueCarregando: true,
      onNavigate,
    });

    expect(hospedeiro.textContent).toMatch(/3 produtos/);
    expect(hospedeiro.textContent).not.toMatch(/conferindo estoque/i);
    const cardEstoque = botaoComTexto(/estoque baixo/i);
    expect(cardEstoque).toBeTruthy();
    await clicar(cardEstoque!);
    expect(onNavigate).toHaveBeenCalledWith("admin-notifications");
  });

  it("inventoryAlerts não numérico (ex.: veio como string do banco): mesmo tratamento de 'não sei'", async () => {
    await montar({ stats: { inventoryAlerts: Number.NaN } });

    expect(hospedeiro.textContent).toMatch(/não consegui|não foi possível/i);
    expect(botaoComTexto(/tentar de novo/i)).toBeTruthy();
  });

  // ── E3: o cartão guiado, nos seis passos ──

  it("faltando WhatsApp e produto: diz '4 de 6 prontos'", async () => {
    await montar({
      config: { ...CONFIG_PRONTA, whatsappNumber: "" },
      produtos: [{ isActive: false }],
    });

    expect(hospedeiro.textContent).toContain("4 de 6 prontos");
    expect(hospedeiro.textContent).not.toMatch(/loja pronta para vender/i);
  });

  it("UM botão grande 'Próximo passo: <primeiro pendente>' leva ao destino do passo", async () => {
    const onNavigate = vi.fn();

    // WhatsApp (3º) e produto (6º) pendentes: o primeiro é o WhatsApp.
    await montar({
      config: { ...CONFIG_PRONTA, whatsappNumber: "" },
      produtos: [{ isActive: false }],
      onNavigate,
    });

    const proximos = Array.from(hospedeiro.querySelectorAll("button")).filter(
      (botao) => (botao.textContent ?? "").includes("Próximo passo"),
    );
    expect(proximos).toHaveLength(1);
    expect(proximos[0].textContent).toBe("Próximo passo: Cadastrar WhatsApp");

    await clicar(proximos[0]);
    expect(onNavigate).toHaveBeenCalledTimes(1);
    expect(onNavigate).toHaveBeenCalledWith("admin-about-store");
  });

  it.each([
    {
      caso: "nome e logo",
      parcial: { config: { ...CONFIG_PRONTA, logoUrl: "" } },
      texto: "Próximo passo: Cadastrar nome e logo da loja",
      destino: "admin-about-store",
    },
    {
      caso: "como você recebe (sem PIX e sem forma na entrega)",
      parcial: { ligado: false, chaveOk: false, formasNaEntrega: [] },
      texto: "Próximo passo: Configurar como você recebe",
      destino: "admin-settings",
    },
    {
      caso: "primeiro produto (só um inativo)",
      parcial: { produtos: [{ isActive: false }] },
      texto: "Próximo passo: Cadastrar um produto ativo",
      destino: "admin-products",
    },
  ] as const)(
    "o próximo passo '$caso' leva para $destino",
    async ({ parcial, texto, destino }) => {
      const onNavigate = vi.fn();
      await montar({ ...parcial, onNavigate } as Partial<Props>);

      const proximo = botaoComTexto("Próximo passo");
      expect(proximo?.textContent).toBe(texto);
      await clicar(proximo!);
      expect(onNavigate).toHaveBeenCalledWith(destino);
    },
  );

  it("a lista dos seis nasce RECOLHIDA: botão com aria-expanded=false e nenhum item na tela", async () => {
    await montar({ config: { ...CONFIG_PRONTA, whatsappNumber: "" } });

    const botao = botaoDaLista();
    expect(botao).toBeTruthy();
    expect(botao!.getAttribute("aria-expanded")).toBe("false");
    expect(linhasDaLista()).toHaveLength(0);
  });

  it("o botão abre e fecha a lista: aria-expanded vira true com os seis passos e volta a false", async () => {
    await montar({
      config: { ...CONFIG_PRONTA, whatsappNumber: "" },
      produtos: [{ isActive: false }],
    });

    await abrirALista();
    const botao = botaoDaLista()!;
    expect(botao.getAttribute("aria-expanded")).toBe("true");
    // O botão aponta para a lista que controla.
    const alvo = botao.getAttribute("aria-controls");
    expect(alvo).toBeTruthy();
    expect(document.getElementById(alvo!)).toBeTruthy();

    const linhas = linhasDaLista();
    expect(linhas).toHaveLength(6);
    const texto = (indice: number) => linhas.at(indice)?.textContent ?? "";
    expect(texto(0)).toMatch(/nome e logo/i);
    expect(texto(1)).toMatch(/endereço/i);
    expect(texto(2)).toMatch(/whatsapp/i);
    expect(texto(3)).toMatch(/pix/i);
    expect(texto(4)).toMatch(/entrega/i);
    expect(texto(5)).toMatch(/produto/i);

    await clicar(botaoDaLista()!);
    expect(botaoDaLista()!.getAttribute("aria-expanded")).toBe("false");
    expect(linhasDaLista()).toHaveLength(0);
  });

  it("na lista aberta, cada passo pendente é um botão que leva ao seu destino (inclusive a entrega, em admin-shipping)", async () => {
    const onNavigate = vi.fn();
    // Sem CEP nem endereço: o endereço e a entrega ficam pendentes juntos.
    await montar({
      config: { ...CONFIG_PRONTA, originCep: "", storeAddress: null },
      ligado: false,
      chaveOk: false,
      formasNaEntrega: [],
      produtos: [],
      onNavigate,
    });
    await abrirALista();

    const linhas = linhasDaLista();
    const destinoDe = async (indice: number) => {
      onNavigate.mockClear();
      const botao = linhas.at(indice)?.querySelector("button");
      expect(botao).toBeTruthy();
      await clicar(botao!);
      return onNavigate.mock.calls[0]?.[0];
    };

    expect(linhas[0].querySelector("button")).toBeNull(); // nome e logo: feito
    expect(await destinoDe(1)).toBe("admin-about-store");
    expect(linhas[2].querySelector("button")).toBeNull(); // WhatsApp: feito
    expect(await destinoDe(3)).toBe("admin-settings");
    expect(await destinoDe(4)).toBe("admin-shipping");
    expect(await destinoDe(5)).toBe("admin-products");
  });

  it("6 de 6: vira só a linha 'Loja pronta para vender' — sem contagem, sem próximo passo, sem lista", async () => {
    await montar();

    expect(hospedeiro.textContent).toContain("Loja pronta para vender");
    expect(hospedeiro.textContent).not.toContain("de 6 prontos");
    expect(hospedeiro.textContent).not.toContain("Próximo passo");
    expect(hospedeiro.textContent).not.toContain(
      "Sua loja está pronta para vender?",
    );
    expect(botaoDaLista()).toBeUndefined();
    expect(linhasDaLista()).toHaveLength(0);
    // O card de estoque continua ao lado.
    expect(hospedeiro.textContent).toMatch(/estoque baixo/i);
  });

  it("o horário de atendimento não conta: sem horário nenhum, a loja com os seis feitos está pronta", async () => {
    await montar({
      config: { ...CONFIG_PRONTA, businessHours: "" } as Props["config"],
    });

    expect(hospedeiro.textContent).toContain("Loja pronta para vender");
    expect(hospedeiro.textContent).not.toMatch(/hor[áa]rio/i);
  });

  it("loja só com pagamento na entrega (sem PIX): 'Como você recebe' está feito e a loja pronta", async () => {
    await montar({ ligado: false, chaveOk: false, formasNaEntrega: ["cash"] });

    expect(hospedeiro.textContent).toContain("Loja pronta para vender");
    expect(hospedeiro.textContent).not.toContain("Configurar como você recebe");
  });

  it("loja só na entrega: a lista aberta diz 'Pagamento na entrega configurado', não 'PIX'", async () => {
    await montar({
      ligado: false,
      chaveOk: false,
      formasNaEntrega: ["cash"],
      produtos: [],
    });
    await abrirALista();

    const recebe = linhasDaLista()[3].textContent ?? "";
    expect(recebe).toMatch(/pagamento na entrega configurado/i);
    expect(recebe).not.toMatch(/pix/i);
  });

  it("loja sem PIX e sem nenhuma forma na entrega: continua pendente, leva para admin-settings", async () => {
    const onNavigate = vi.fn();

    await montar({
      ligado: false,
      chaveOk: false,
      formasNaEntrega: [],
      onNavigate,
    });

    const pendente = botaoComTexto(
      "Próximo passo: Configurar como você recebe",
    );
    expect(pendente).toBeTruthy();
    await clicar(pendente!);
    expect(onNavigate).toHaveBeenCalledWith("admin-settings");
    expect(hospedeiro.textContent).not.toContain("Loja pronta para vender");
  });

  it("produto: só um INATIVO na lista conta como pendente; com um ativo, feito (isActive, não o tamanho da lista)", async () => {
    await montar({ produtos: [{ isActive: false }] });
    expect(hospedeiro.textContent).toContain("5 de 6 prontos");

    await montar({ produtos: [{ isActive: false }, { isActive: true }] });
    expect(hospedeiro.textContent).toContain("Loja pronta para vender");
  });

  // ── "Entrega" no Início: só o que já está na config (sem chamada de rede) ──
  it("sem CEP completo a entrega fica pendente; com CEP de oito dígitos, feita", async () => {
    await montar({
      config: { ...CONFIG_PRONTA, originCep: "1234", storeAddress: null },
    });
    await abrirALista();
    expect(linhasDaLista()[4].textContent).toMatch(/configurar a entrega/i);

    await montar({
      config: { ...CONFIG_PRONTA, storeAddress: null },
    });
    expect(linhasDaLista()[4].textContent).toMatch(/entrega configurada/i);
  });

  // ── Carregando: "conferindo…", nunca "pendente" nem "pronta" (alarme falso) ──
  it("config e produtos ainda carregando: nada de 'Próximo passo', de contagem nem de 'Loja pronta'; só 'Conferindo…'", async () => {
    await montar({
      config: {},
      ligado: true,
      chaveOk: true,
      produtos: [],
      configCarregando: true,
      produtosCarregando: true,
    });

    expect(hospedeiro.textContent).toMatch(/conferindo/i);
    expect(hospedeiro.textContent).not.toContain("Próximo passo");
    expect(hospedeiro.textContent).not.toContain("de 6 prontos");
    expect(hospedeiro.textContent).not.toContain("Loja pronta para vender");

    await abrirALista();
    // Nenhum botão de pendência enquanto carrega.
    for (const linha of linhasDaLista()) {
      expect(linha.querySelector("button")).toBeNull();
    }
    const textos = linhasDaLista().map((linha) => linha.textContent ?? "");
    // PIX vem do build: resolve na hora, mesmo com a config carregando.
    expect(textos[3]).toMatch(/pagamento pix configurado/i);
    // Os outros cinco dizem QUAL item estão conferindo (leitor de tela não
    // adivinha por posição) e são distintos entre si.
    const conferindo = textos.filter((texto) => /conferindo/i.test(texto));
    expect(conferindo).toHaveLength(5);
    expect(new Set(conferindo).size).toBe(5);
    expect(textos[0]).toMatch(/nome e logo/i);
    expect(textos[2]).toMatch(/whatsapp/i);
    expect(textos[5]).toMatch(/produto/i);
  });

  it("só os produtos carregando: não se chama 'Próximo passo' nem 'pronta' antes de saber tudo", async () => {
    await montar({ produtos: [], produtosCarregando: true });

    expect(hospedeiro.textContent).toMatch(/conferindo/i);
    expect(hospedeiro.textContent).not.toContain("Próximo passo");
    expect(hospedeiro.textContent).not.toContain("Loja pronta para vender");
  });

  // ── Acessibilidade ──
  it("o card de estoque, o próximo passo e o botão da lista têm nome acessível (são <button> com texto)", async () => {
    await montar({
      stats: { inventoryAlerts: 5 },
      config: {},
      ligado: false,
      chaveOk: false,
      produtos: [],
    });
    await abrirALista();

    for (const botao of Array.from(hospedeiro.querySelectorAll("button"))) {
      expect((botao.textContent ?? "").trim().length).toBeGreaterThan(0);
    }
    expect(botaoComTexto(/estoque baixo/i)).toBeTruthy();
    expect(botaoComTexto(/próximo passo/i)).toBeTruthy();
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
//
// 🔴 Este bloco NÃO ancora num nome de arquivo fixo. `get_admin_analytics_v2`
// já foi redefinida por inteiro várias vezes (hoje são 7 migrations que a
// redefinem) — um teste que citasse `20260902000000_kpi_usa_o_mesmo_...sql`
// direto estaria medindo contra uma definição MORTA: mudar o limiar na
// definição viva, ou numa migration futura, não deixaria este teste vermelho
// (era exatamente esse o defeito daqui até 08/09/2026). Em vez de citar um
// carimbo fixo, o teste varre TODAS as migrations, fica só com as que de
// fato REDEFINEM a função (`CREATE OR REPLACE FUNCTION ...
// get_admin_analytics_v2` + atribuição de `low_stock_count`) e mede contra a
// de MAIOR carimbo — a viva de verdade, seja ela qual for no dia em que o
// teste roda.
describe("equivalência: o limiar do front é o MESMO literal gravado na migration do banco", () => {
  const TODAS_AS_MIGRATIONS = import.meta.glob<string>(
    "/supabase/migrations/*.sql",
    { query: "?raw", import: "default", eager: true },
  );

  // `_arquivadas/` já fica de fora sozinha — o glob `*.sql` não cruza
  // subdiretório; só falta descartar os `rollback-manual-*`, que existem
  // para desfazer uma migration e não fazem parte da fila viva.
  //
  // `Object.entries` (em vez de `Object.keys` + indexação por variável)
  // evita o `security/detect-object-injection` do eslint-security — o
  // mesmo motivo do molde em recusa-do-pedido-ancora-nas-migrations.test.ts
  // usar `Object.values`.
  const REDEFINICOES = Object.entries(TODAS_AS_MIGRATIONS)
    .filter(([caminho]) => !caminho.includes("/rollback-manual-"))
    .filter(
      ([, sql]) =>
        /CREATE OR REPLACE FUNCTION\s+public\.get_admin_analytics_v2/.test(
          sql,
        ) && /low_stock_count/.test(sql),
    )
    // o nome do arquivo começa com o carimbo (timestamp) — ordem alfabética
    // é ordem cronológica, então o último da lista é o mais recente.
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));

  const CAMINHOS_DAS_REDEFINICOES = REDEFINICOES.map(([caminho]) => caminho);
  const VIVA = REDEFINICOES.at(-1);
  const CAMINHO_DA_VIVA = VIVA?.[0] ?? "";
  const SQL_DA_VIVA = VIVA?.[1] ?? "";

  // A viva pode redefinir MUITAS funções no mesmo arquivo (a 20261199000000
  // redefine 42 para exigir o admin atual). Medir o arquivo inteiro casaria o
  // primeiro COALESCE(estoque_minimo, N) de QUALQUER função; por isso o
  // limiar e o filtro se leem só no corpo de get_admin_analytics_v2 — do
  // CREATE dela até o próximo CREATE OR REPLACE FUNCTION (ou o fim do arquivo).
  const INICIO_DO_CORPO = SQL_DA_VIVA.search(
    /CREATE OR REPLACE FUNCTION\s+public\.get_admin_analytics_v2/,
  );
  const RESTO_DA_VIVA =
    INICIO_DO_CORPO < 0 ? "" : SQL_DA_VIVA.slice(INICIO_DO_CORPO);
  const FIM_DO_CORPO = RESTO_DA_VIVA.slice(1).search(
    /CREATE OR REPLACE FUNCTION/,
  );
  const CORPO_DA_VIVA =
    FIM_DO_CORPO < 0 ? RESTO_DA_VIVA : RESTO_DA_VIVA.slice(0, FIM_DO_CORPO + 1);

  it("achou pelo menos 2 migrations que redefinem get_admin_analytics_v2 (hoje são 7) — sem isso, tudo abaixo passaria por vacuidade", () => {
    expect(CAMINHOS_DAS_REDEFINICOES.length).toBeGreaterThanOrEqual(2);
    expect(
      CAMINHOS_DAS_REDEFINICOES.some((c) => c.includes("20260902000000")),
    ).toBe(true);
    expect(
      CAMINHOS_DAS_REDEFINICOES.some((c) => c.includes("20261062000000")),
    ).toBe(true);
  });

  // ── Guarda 2 (laudo da revisão, 08/09): carimbo tem de ter 14 dígitos ──
  //
  // "ordem alfabética é ordem cronológica" (comentário acima do `.sort`) só
  // vale se TODO nome começar com carimbo do mesmo tamanho. O repositório já
  // tem exceção: supabase/migrations/2026110000000_o_estorno_nasce_no_ledger.sql
  // e .../2026110000100_concluir_estorno.sql usam carimbo de 13 dígitos.
  // Hoje é inofensivo — nenhum dos dois redefine get_admin_analytics_v2 —,
  // mas se uma migration futura redefinir a função com carimbo fora do
  // padrão de 14 dígitos, a ordenação lexicográfica erra em silêncio e o
  // teste passaria a medir contra a definição errada sem avisar. Esta guarda
  // valida o FORMATO de cada arquivo aceito antes de confiar na ordenação.
  it("cada migration aceita na lista de redefinições começa com carimbo de exatamente 14 dígitos", () => {
    const foraDoPadrao = CAMINHOS_DAS_REDEFINICOES.filter((caminho) => {
      const nomeBase = caminho.split("/").at(-1) ?? "";
      return !/^\d{14}_/.test(nomeBase);
    });
    expect(
      foraDoPadrao,
      `arquivo(s) com carimbo fora do padrão de 14 dígitos (ordenação alfabética deixa de ser cronológica): ${foraDoPadrao.join(", ")}`,
    ).toEqual([]);
  });

  it("a definição VIVA é a de maior carimbo — hoje, 20261214000000", () => {
    expect(CAMINHO_DA_VIVA).toContain(
      "20261214000000_o_lucro_do_estoque_so_conta_produto_com_custo.sql",
    );
  });

  it("o corpo medido é o de get_admin_analytics_v2, inteiro e só ele", () => {
    expect(CORPO_DA_VIVA).toMatch(
      /^CREATE OR REPLACE FUNCTION\s+public\.get_admin_analytics_v2/,
    );
    expect(CORPO_DA_VIVA).toMatch(/low_stock_count/);
    expect(CORPO_DA_VIVA.slice(1)).not.toMatch(/CREATE OR REPLACE FUNCTION/);
  });

  // ── Guarda 1 (laudo da revisão, 08/09): a viva não pode ser um rollback ──
  //
  // A asserção acima ("a viva é a de maior carimbo") só prova o carimbo — e
  // `rollback-manual-20261062000000_o_hoje_do_painel_e_o_dia_do_lojista.sql`
  // CONTÉM esse mesmo carimbo como substring, ordena DEPOIS ("r" > dígito em
  // ASCII) e hoje redefine a função com o MESMO COALESCE. Se o filtro
  // `!caminho.includes("/rollback-manual-")` (acima) sumir numa refatoração
  // futura, o teste anterior continuaria verde apontando para o rollback —
  // essa é exatamente a coincidência que esta linha fecha: ela não depende
  // do filtro existir, então acusa sozinha se ele sumir.
  it("a viva NÃO é um arquivo de rollback — mesmo que o filtro acima sumisse, esta linha acusaria", () => {
    expect(CAMINHO_DA_VIVA).not.toMatch(/rollback-manual/);
  });

  it("COALESCE(estoque_minimo, N) do SQL VIVO é o MESMO N de LIMIAR_PADRAO_DE_ESTOQUE", async () => {
    const { LIMIAR_PADRAO_DE_ESTOQUE } = await import(
      "@/utils/avisos-do-lojista"
    );

    const casado = CORPO_DA_VIVA.match(/COALESCE\(estoque_minimo,\s*(\d+)\)/);
    expect(
      casado,
      `o literal COALESCE(estoque_minimo, N) sumiu ou mudou de forma na migration VIVA (${CAMINHO_DA_VIVA}) — confira à mão antes de mexer no limiar do front`,
    ).toBeTruthy();

    const limiarDoBanco = Number(casado![1]);
    expect(limiarDoBanco).toBe(LIMIAR_PADRAO_DE_ESTOQUE);
  });

  it("a RPC viva filtra o MESMO isActive (ativo = true, deleted_at IS NULL) que a tela de avisos usa", () => {
    expect(CORPO_DA_VIVA).toMatch(/p\.deleted_at IS NULL AND p\.ativo = true/);
  });
});
