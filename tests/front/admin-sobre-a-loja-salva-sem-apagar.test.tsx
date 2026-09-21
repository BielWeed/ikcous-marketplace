// @vitest-environment jsdom
//
// Frente "Sobre a Loja" (pedido do dono, 20/09/2026): a tela do painel grava
// endereço e descrição (os campos novos da 20261167000000) num único
// updateConfig — e o payload NUNCA leva os campos que não são dela
// (horário/WhatsApp/nome/logo são de outros editores; o CASE da RPC só
// sobrescreve o que veio, mas o aceite começa na tela não mandando). A
// entrada no TIPO_DAS_COLUNAS_STORE_CONFIG é a outra metade do contrato: sem
// ela o save "grava" e a conferência acusa falha (falso negativo do
// ADMIN-010 ao contrário). O helper da descrição também é provado aqui:
// parágrafos por linha em branco, escape de &<>, vazio → vazio.
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import {
  type Mock,
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

let updateConfigMock: ReturnType<typeof vi.fn>;
let configAtual: Record<string, unknown>;

vi.mock("@/contexts/StoreContext", () => ({
  useStore: () => ({
    config: configAtual,
    updateConfig: updateConfigMock,
    isLoaded: true,
  }),
  // O teste da tela precisa da MESMA Map que o contexto usa — o contrato
  // "coluna desconhecida nunca fica confirmada" mora nela.
  TIPO_DAS_COLUNAS_STORE_CONFIG: new Map<string, string>([
    ["store_address", "texto"],
    ["store_description", "texto"],
    ["business_hours", "texto"],
  ]),
}));

vi.mock("@/hooks/useOnlineStatus", () => ({
  useOnlineStatus: () => false,
}));

// O editor de horário (BusinessHoursSection) tem guarda de admin via
// useAuth — que importa o cliente real do Supabase, e o jsdom não tem Web
// Worker para o realtime. Mocka-se o auth (molde dos testes da ficha: nunca
// o cliente real no jsdom).
vi.mock("@/lib/supabase", () => ({
  supabase: {},
}));
vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({
    user: { id: "admin-1" },
    session: { user: { id: "admin-1" } },
    isAdmin: true,
    adminStatus: "admin",
  }),
}));

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const BASE_CONFIG = {
  storeName: "Ateliê da Serra",
  storeCity: "Monte Carmelo",
  storeState: "MG",
  originCep: "38500-000",
  businessHours: "Seg-Sex: 8h às 19h",
  whatsappNumber: "(34) 99999-9999",
  storeAddress: null,
  storeDescription: null,
};

describe("AdminAboutStoreView — salvar endereço/descrição sem apagar os outros campos", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;
  let onSetDirty: Mock<(dirty: boolean) => void>;

  beforeEach(() => {
    configAtual = { ...BASE_CONFIG };
    updateConfigMock = vi.fn(async () => true);
    onSetDirty = vi.fn((_dirty: boolean) => {});
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

  async function renderizarTela() {
    const { AdminAboutStoreView } = await import(
      "@/views/admin/AdminAboutStoreView"
    );
    await act(async () => {
      raiz.render(
        <AdminAboutStoreView onNavigate={() => {}} onSetDirty={onSetDirty} />,
      );
    });
  }

  async function preencherESalvar(endereco: string, descricao: string) {
    const enderecoInput = hospedeiro.querySelector(
      "#store-address",
    ) as HTMLInputElement;
    const descricaoInput = hospedeiro.querySelector(
      "#store-description",
    ) as HTMLTextAreaElement;
    // inputs controlados do React: setar valor via setter nativo
    const setter = Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      "value",
    )?.set;
    setter?.call(enderecoInput, endereco);
    await act(async () => {
      enderecoInput.dispatchEvent(new Event("input", { bubbles: true }));
    });
    const setterTa = Object.getOwnPropertyDescriptor(
      HTMLTextAreaElement.prototype,
      "value",
    )?.set;
    setterTa?.call(descricaoInput, descricao);
    await act(async () => {
      descricaoInput.dispatchEvent(new Event("input", { bubbles: true }));
    });

    const botaoSalvar = hospedeiro.querySelector(
      "button.bg-admin-gold",
    ) as HTMLButtonElement | null;
    expect(botaoSalvar).not.toBeNull();
    await act(async () => {
      botaoSalvar?.click();
      await Promise.resolve();
      await Promise.resolve();
    });
  }

  it("na montagem limpa o botão Salvar nasce desabilitado — ele é SÓ do form (pendência de identidade/horário não o habilita)", async () => {
    await renderizarTela();
    const botao = hospedeiro.querySelector(
      "button.bg-admin-gold",
    ) as HTMLButtonElement | null;
    expect(botao).not.toBeNull();
    expect(botao?.disabled).toBe(true);
  });

  it("salvar manda SÓ os campos da tela (endereço + descrição), nunca horário/nome/whatsapp", async () => {
    await renderizarTela();
    await preencherESalvar(
      "Rua das Flores, 123",
      "Primeiro parágrafo\n\nSegundo",
    );

    expect(updateConfigMock).toHaveBeenCalledTimes(1);
    const updates = updateConfigMock.mock.calls[0][0] as Record<
      string,
      unknown
    >;
    expect(updates.storeAddress).toBe("Rua das Flores, 123");
    expect(updates.storeDescription).toBe(
      "<p>Primeiro parágrafo</p><p>Segundo</p>",
    );
    // O aceite "um campo não apaga os outros" começa aqui: a tela não manda
    // o que não é dela — o CASE da RPC preserva o resto no banco.
    expect(updates.businessHours).toBeUndefined();
    expect(updates.storeName).toBeUndefined();
    expect(updates.whatsappNumber).toBeUndefined();
    expect(updates.logoUrl).toBeUndefined();
  });

  it("campos em branco gravam null (ausência honesta), não string vazia", async () => {
    await renderizarTela();
    await preencherESalvar("   ", "");
    const updates = updateConfigMock.mock.calls[0][0] as Record<
      string,
      unknown
    >;
    expect(updates.storeAddress).toBeNull();
    expect(updates.storeDescription).toBeNull();
  });

  it("o save falha fechado: updateConfig devolvendo false NÃO limpa o dirty", async () => {
    updateConfigMock = vi.fn(async () => false);
    await renderizarTela();
    // montagem relata dirty false antes de qualquer digitação
    expect(onSetDirty).toHaveBeenCalledWith(false);
    await preencherESalvar("Rua das Flores, 123", "texto");
    // dirty verdadeiro propagado ao digitar (formDirty)…
    expect(onSetDirty).toHaveBeenCalledWith(true);
    // …e NÃO voltou a false depois da falha (o lojista não perde o texto
    // achando que salvou): a última chamada de dirty tem de ser a true.
    const ultimas = onSetDirty.mock.calls.map((c) => c[0]);
    expect(ultimas.lastIndexOf(true)).toBeGreaterThan(
      ultimas.lastIndexOf(false),
    );
  });
  // A entrada das duas colunas no TIPO_DAS_COLUNAS_STORE_CONFIG (o contrato
  // "coluna desconhecida nunca fica confirmada") é provada contra o módulo
  // REAL em
  // store-context-vitrine-nao-declara-sucesso-sem-conferir.test.tsx — aqui
  // o módulo é mockado, e um it sobre o mock se provaria sozinho.
});

describe("AdminAboutStoreView — hidratação assíncrona do config (NULL → valores)", () => {
  // O DEFETO que este describe prende (revisão do coordenador, 3ª rodada
  // real): a tela monta com o config ainda vazio (cache) e o fetch completa
  // DEPOIS. Nessa transição o baseline novo chegava e o formDirty derivado
  // virava true no mesmo render — pulando a sincronização para sempre:
  // campos presos vazios e botão Salvar habilitado sem edição nenhuma.
  let raiz: Root;
  let hospedeiro: HTMLDivElement;
  let onSetDirty: Mock<(dirty: boolean) => void>;
  let Componente: React.ComponentType<{
    onNavigate: (view: string) => void;
    active?: boolean;
    onSetDirty?: (dirty: boolean) => void;
  }>;

  beforeEach(() => {
    configAtual = { ...BASE_CONFIG, storeAddress: null, storeDescription: null };
    updateConfigMock = vi.fn(async () => true);
    onSetDirty = vi.fn((_dirty: boolean) => {});
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

  async function renderizarTela() {
    const modulo = await import("@/views/admin/AdminAboutStoreView");
    Componente = modulo.AdminAboutStoreView;
    await act(async () => {
      raiz.render(
        <Componente onNavigate={() => {}} onSetDirty={onSetDirty} />,
      );
    });
  }

  it("config chega DEPOIS da montagem (hidratação): os campos sincronizam e o botão nasce desabilitado", async () => {
    await renderizarTela();

    // o fetch completa: o config ganha os valores do banco e o React
    // re-renderiza (mesma árvore — os estados internos PRESERVAM)
    await act(async () => {
      configAtual = {
        ...BASE_CONFIG,
        storeAddress: "Rua do Banco, 9",
        storeDescription: "<p>Descrição do banco</p>",
      };
      raiz.render(
        <Componente onNavigate={() => {}} onSetDirty={onSetDirty} />,
      );
    });

    const endereco = hospedeiro.querySelector("#store-address") as HTMLInputElement;
    const descricao = hospedeiro.querySelector("#store-description") as HTMLTextAreaElement;
    expect(endereco.value).toBe("Rua do Banco, 9");
    expect(descricao.value).toBe("Descrição do banco");
    // sem edição nenhuma do lojista, nada está pendente
    expect(onSetDirty).toHaveBeenLastCalledWith(false);
    const botao = hospedeiro.querySelector("button.bg-admin-gold") as HTMLButtonElement;
    expect(botao.disabled).toBe(true);
  });

  it("a atualização do config NÃO apaga edição real em andamento do lojista", async () => {
    await renderizarTela();

    // o lojista digita antes do fetch completar
    const endereco = hospedeiro.querySelector("#store-address") as HTMLInputElement;
    const setter = Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      "value",
    )?.set;
    await act(async () => {
      setter?.call(endereco, "Digitando meu endereço real…");
      endereco.dispatchEvent(new Event("input", { bubbles: true }));
    });

    // o config atualiza por fora (realtime/fetch) com valor do banco
    await act(async () => {
      configAtual = {
        ...BASE_CONFIG,
        storeAddress: "Valor do banco que chegou depois",
      };
      raiz.render(
        <Componente onNavigate={() => {}} onSetDirty={onSetDirty} />,
      );
    });

    // a edição do lojista é PRESERVADA (o sync não sobrescreve quem digitou)
    expect(
      (hospedeiro.querySelector("#store-address") as HTMLInputElement).value,
    ).toBe("Digitando meu endereço real…");
    expect(onSetDirty).toHaveBeenLastCalledWith(true);
  });
});

describe("descricaoDaLojaParaHtml — o helper da descrição", () => {
  it("linha em branco vira parágrafo; &<> são escapados; vazio vira vazio", async () => {
    const { descricaoDaLojaParaHtml } = await import("@/lib/texto-da-loja");
    expect(
      descricaoDaLojaParaHtml("Parágrafo um\n\nParágrafo <dois> & tal"),
    ).toBe("<p>Parágrafo um</p><p>Parágrafo &lt;dois&gt; &amp; tal</p>");
    expect(descricaoDaLojaParaHtml("   ")).toBe("");
    expect(descricaoDaLojaParaHtml("")).toBe("");
  });

  it("ida e volta exata: texto → HTML (save) → texto (reabrir) reproduz o digitado — formDirty nunca nasce de diferença de reconstituição", async () => {
    const { descricaoDaLojaParaHtml, textoDaLoja } = await import(
      "@/lib/texto-da-loja"
    );
    const digitado =
      "Importados escolhidos a dedo, direto de São Paulo para a sua casa.\n\nNovos lançamentos toda semana — fale com a gente pelo WhatsApp.";
    const gravado = descricaoDaLojaParaHtml(digitado);
    expect(textoDaLoja(gravado)).toBe(digitado);
    // e o inverso do vazio é vazio (ausência honesta)
    expect(textoDaLoja(null)).toBe("");
    expect(textoDaLoja("")).toBe("");
  });
});
