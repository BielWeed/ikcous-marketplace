// @vitest-environment jsdom
//
// Frente "Sobre a Loja" (pedido do dono, 20/09/2026) → "Minha loja" (painel
// simples, 09/10/2026): a tela do painel grava endereço e descrição num único
// updateConfig — e o payload NUNCA leva os campos que não são dela
// (horário/WhatsApp/nome/logo são de outros editores; o CASE da RPC só
// sobrescreve o que veio, mas o aceite começa na tela não mandando). O
// endereço é a fonte única da loja: CEP, texto, cidade e UF vão JUNTOS, na
// MESMA chamada da descrição, e só quando a lojista mexeu no endereço. A
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

import { pararABuscaDeCep } from "./duble-busca-de-cep";

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
    ["store_city", "texto"],
    ["store_state", "texto"],
    ["origin_cep", "texto"],
    ["store_description", "texto"],
    ["business_hours", "texto"],
  ]),
}));

vi.mock("@/hooks/useOnlineStatus", () => ({
  useOnlineStatus: () => false,
}));

// sonner é espiado (não mockado): o teste quer PROVAR que a tela avisa a
// falha — e não depender da renderização real de toasts no jsdom.
vi.mock("sonner", () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
  },
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

// Os provedores de CEP respondendo com a Avenida Paulista (ViaCEP é o 1º da
// cadeia; os outros nem são consultados). Cada teste que PRECISA da busca
// instala este; os demais ficam com `pararABuscaDeCep` (nunca vai à rede).
function instalarCepDeSaoPaulo(
  endereco: Record<string, string> = {
    logradouro: "Avenida Paulista",
    bairro: "Bela Vista",
    localidade: "São Paulo",
    uf: "SP",
  },
) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response(JSON.stringify(endereco), { status: 200 })),
  );
}

describe("AdminAboutStoreView — salvar endereço/descrição sem apagar os outros campos", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;
  let onSetDirty: Mock<(dirty: boolean) => void>;

  beforeEach(() => {
    configAtual = { ...BASE_CONFIG };
    updateConfigMock = vi.fn(async () => true);
    onSetDirty = vi.fn((_dirty: boolean) => {});
    // A conferência do CEP salvo não pode ir à rede de verdade.
    pararABuscaDeCep();
    hospedeiro = document.createElement("div");
    document.body.appendChild(hospedeiro);
    raiz = createRoot(hospedeiro);
  });

  afterEach(() => {
    act(() => {
      raiz.unmount();
    });
    hospedeiro.remove();
    vi.unstubAllGlobals();
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

  const botaoSalvar = () =>
    hospedeiro.querySelector("button.bg-admin-gold") as HTMLButtonElement;

  async function digitarNaDescricao(descricao: string) {
    const descricaoInput = hospedeiro.querySelector(
      "#store-description",
    ) as HTMLTextAreaElement;
    const setterTa = Object.getOwnPropertyDescriptor(
      HTMLTextAreaElement.prototype,
      "value",
    )?.set;
    setterTa?.call(descricaoInput, descricao);
    await act(async () => {
      descricaoInput.dispatchEvent(new Event("input", { bubbles: true }));
    });
  }

  async function clicarSalvar() {
    const botao = botaoSalvar();
    expect(botao).not.toBeNull();
    await act(async () => {
      botao.click();
      await Promise.resolve();
      await Promise.resolve();
    });
  }

  async function preencherESalvar(descricao: string) {
    await digitarNaDescricao(descricao);
    await clicarSalvar();
  }

  // Os campos do endereço entregam o valor 200 ms depois de parar de digitar.
  async function digitarNoEndereco(id: string, valor: string) {
    const input = hospedeiro.querySelector(`#${id}`) as HTMLInputElement;
    const setter = Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      "value",
    )?.set;
    await act(async () => {
      input.focus();
      setter?.call(input, valor);
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 260));
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

  it("o título da tela é 'Minha loja'", async () => {
    await renderizarTela();
    expect(hospedeiro.querySelector("h1")?.textContent).toBe("Minha loja");
  });

  it("salvar só a descrição manda SÓ a descrição, nunca endereço/horário/nome/whatsapp", async () => {
    await renderizarTela();
    await preencherESalvar("Primeiro parágrafo\n\nSegundo");

    expect(updateConfigMock).toHaveBeenCalledTimes(1);
    const updates = updateConfigMock.mock.calls[0][0] as Record<
      string,
      unknown
    >;
    expect(updates.storeDescription).toBe(
      "<p>Primeiro parágrafo</p><p>Segundo</p>",
    );
    // O aceite "um campo não apaga os outros" começa aqui: a tela não manda
    // o que não é dela — o CASE da RPC preserva o resto no banco. O endereço
    // que a lojista NÃO mexeu também não vai de carona.
    expect(updates.storeAddress).toBeUndefined();
    expect(updates.originCep).toBeUndefined();
    expect(updates.storeCity).toBeUndefined();
    expect(updates.storeState).toBeUndefined();
    expect(updates.businessHours).toBeUndefined();
    expect(updates.storeName).toBeUndefined();
    expect(updates.whatsappNumber).toBeUndefined();
    expect(updates.logoUrl).toBeUndefined();
  });

  it("mudar CEP e número e salvar: UMA chamada com CEP, endereço, cidade, UF e descrição", async () => {
    instalarCepDeSaoPaulo();
    await renderizarTela();
    await digitarNoEndereco("endereco-cep", "01310100");
    await digitarNoEndereco("endereco-numero", "1578");
    await digitarNaDescricao("Nossa história");
    await clicarSalvar();

    expect(updateConfigMock).toHaveBeenCalledTimes(1);
    expect(updateConfigMock.mock.calls[0][0]).toEqual({
      originCep: "01310-100",
      storeAddress:
        "Avenida Paulista, 1578 — Bela Vista, São Paulo/SP — CEP 01310-100",
      storeCity: "São Paulo",
      storeState: "SP",
      storeDescription: "<p>Nossa história</p>",
    });
    const { toast } = await import("sonner");
    expect(toast.success).toHaveBeenCalled();
  });

  it("CEP digitado sem número: o Salvar espera, com o motivo à vista; nada é gravado", async () => {
    instalarCepDeSaoPaulo();
    await renderizarTela();
    await digitarNoEndereco("endereco-cep", "01310100");
    await digitarNaDescricao("Nossa história");

    expect(botaoSalvar().disabled).toBe(true);
    expect(hospedeiro.textContent).toContain("Falta o número do endereço");
    // dirty de verdade: sair da tela agora perderia o que ela digitou
    expect(onSetDirty).toHaveBeenLastCalledWith(true);
    await clicarSalvar();
    expect(updateConfigMock).not.toHaveBeenCalled();
  });

  it("descrição em branco grava null (ausência honesta), não string vazia", async () => {
    configAtual = {
      ...BASE_CONFIG,
      storeDescription: "<p>Texto de antes</p>",
    };
    await renderizarTela();
    await preencherESalvar("   ");
    const updates = updateConfigMock.mock.calls[0][0] as Record<
      string,
      unknown
    >;
    expect(updates.storeDescription).toBeNull();
  });

  it("o save falha fechado: updateConfig devolvendo false NÃO limpa o dirty, avisa o erro e preserva o texto", async () => {
    updateConfigMock = vi.fn(async () => false);
    await renderizarTela();
    // montagem relata dirty false antes de qualquer digitação
    expect(onSetDirty).toHaveBeenCalledWith(false);
    await preencherESalvar("texto");
    // dirty verdadeiro propagado ao digitar (formDirty)…
    expect(onSetDirty).toHaveBeenCalledWith(true);
    // …e NÃO voltou a false depois da falha (o lojista não perde o texto
    // achando que salvou): a última chamada de dirty tem de ser a true.
    const ultimas = onSetDirty.mock.calls.map((c) => c[0]);
    expect(ultimas.lastIndexOf(true)).toBeGreaterThan(
      ultimas.lastIndexOf(false),
    );
    // a falha é AVISADA (silent:true suprime os toasts de dentro do
    // updateConfig — o aviso de falha é responsabilidade da tela)
    const { toast } = await import("sonner");
    expect(toast.error).toHaveBeenCalled();
  });

  it("updateConfig lançando (rede fora): o erro é avisado em frase de pessoa e o rascunho não some", async () => {
    updateConfigMock = vi.fn(async () => {
      throw new Error("Failed to fetch");
    });
    await renderizarTela();
    await preencherESalvar("texto");
    const { toast } = await import("sonner");
    const aviso = vi.mocked(toast.error).mock.calls.at(-1)?.[0] as string;
    // pelo erro-do-painel: sem a mensagem crua da rede
    expect(aviso).toContain("Sem conexão");
    expect(aviso).not.toContain("Failed to fetch");
    // o texto digitado permanece no campo (rascunho preservado)
    expect(
      (hospedeiro.querySelector("#store-description") as HTMLTextAreaElement)
        .value,
    ).toBe("texto");
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
    configAtual = {
      ...BASE_CONFIG,
      storeAddress: null,
      storeDescription: null,
    };
    updateConfigMock = vi.fn(async () => true);
    onSetDirty = vi.fn((_dirty: boolean) => {});
    // A conferência do CEP salvo não pode ir à rede de verdade.
    pararABuscaDeCep();
    hospedeiro = document.createElement("div");
    document.body.appendChild(hospedeiro);
    raiz = createRoot(hospedeiro);
  });

  afterEach(() => {
    act(() => {
      raiz.unmount();
    });
    hospedeiro.remove();
    vi.unstubAllGlobals();
  });

  async function renderizarTela() {
    const modulo = await import("@/views/admin/AdminAboutStoreView");
    Componente = modulo.AdminAboutStoreView;
    await act(async () => {
      raiz.render(<Componente onNavigate={() => {}} onSetDirty={onSetDirty} />);
    });
  }

  const ENDERECO_NOVO =
    "Avenida Paulista, 1578 — Bela Vista, São Paulo/SP — CEP 01310-100";

  it("config chega DEPOIS da montagem (hidratação): os campos sincronizam e o botão nasce desabilitado", async () => {
    await renderizarTela();

    // o fetch completa: o config ganha os valores do banco e o React
    // re-renderiza (mesma árvore — os estados internos PRESERVAM)
    await act(async () => {
      configAtual = {
        ...BASE_CONFIG,
        originCep: "01310-100",
        storeCity: "São Paulo",
        storeState: "SP",
        storeAddress: ENDERECO_NOVO,
        storeDescription: "<p>Descrição do banco</p>",
      };
      raiz.render(<Componente onNavigate={() => {}} onSetDirty={onSetDirty} />);
    });

    const campo = (id: string) =>
      (hospedeiro.querySelector(`#${id}`) as HTMLInputElement).value;
    const descricao = hospedeiro.querySelector(
      "#store-description",
    ) as HTMLTextAreaElement;
    expect(campo("endereco-cep")).toBe("01310-100");
    expect(campo("endereco-rua")).toBe("Avenida Paulista");
    expect(campo("endereco-numero")).toBe("1578");
    expect(campo("endereco-cidade")).toBe("São Paulo");
    expect(descricao.value).toBe("Descrição do banco");
    // sem edição nenhuma do lojista, nada está pendente
    expect(onSetDirty).toHaveBeenLastCalledWith(false);
    const botao = hospedeiro.querySelector(
      "button.bg-admin-gold",
    ) as HTMLButtonElement;
    expect(botao.disabled).toBe(true);
  });

  it("a atualização do config NÃO apaga edição real em andamento do lojista", async () => {
    await renderizarTela();

    // o lojista digita antes do fetch completar
    const descricao = hospedeiro.querySelector(
      "#store-description",
    ) as HTMLTextAreaElement;
    const setter = Object.getOwnPropertyDescriptor(
      HTMLTextAreaElement.prototype,
      "value",
    )?.set;
    await act(async () => {
      setter?.call(descricao, "Digitando minha história real…");
      descricao.dispatchEvent(new Event("input", { bubbles: true }));
    });

    // o config atualiza por fora (realtime/fetch) com valor do banco
    await act(async () => {
      configAtual = {
        ...BASE_CONFIG,
        storeDescription: "<p>Valor do banco que chegou depois</p>",
      };
      raiz.render(<Componente onNavigate={() => {}} onSetDirty={onSetDirty} />);
    });

    // a edição do lojista é PRESERVADA (o sync não sobrescreve quem digitou)
    expect(
      (hospedeiro.querySelector("#store-description") as HTMLTextAreaElement)
        .value,
    ).toBe("Digitando minha história real…");
    expect(onSetDirty).toHaveBeenLastCalledWith(true);
  });

  it("a atualização do config NÃO apaga o número que a lojista está digitando no endereço", async () => {
    configAtual = {
      ...BASE_CONFIG,
      originCep: "01310-100",
      storeCity: "São Paulo",
      storeState: "SP",
      storeAddress: ENDERECO_NOVO,
    };
    await renderizarTela();

    const numero = hospedeiro.querySelector(
      "#endereco-numero",
    ) as HTMLInputElement;
    const setter = Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      "value",
    )?.set;
    await act(async () => {
      numero.focus();
      setter?.call(numero, "2000");
      numero.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 260));
    });

    // chega descrição nova de fora; o endereço continua como ela deixou
    await act(async () => {
      configAtual = {
        ...configAtual,
        storeDescription: "<p>Chegou de fora</p>",
      };
      raiz.render(<Componente onNavigate={() => {}} onSetDirty={onSetDirty} />);
    });

    expect(
      (hospedeiro.querySelector("#endereco-numero") as HTMLInputElement).value,
    ).toBe("2000");
    expect(onSetDirty).toHaveBeenLastCalledWith(true);
  });
});

describe("AdminAboutStoreView — aviso quando o CEP é de outra cidade (D4)", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;

  beforeEach(() => {
    updateConfigMock = vi.fn(async () => true);
    hospedeiro = document.createElement("div");
    document.body.appendChild(hospedeiro);
    raiz = createRoot(hospedeiro);
  });

  afterEach(() => {
    act(() => {
      raiz.unmount();
    });
    hospedeiro.remove();
    vi.unstubAllGlobals();
  });

  async function renderizarTela() {
    const { AdminAboutStoreView } = await import(
      "@/views/admin/AdminAboutStoreView"
    );
    await act(async () => {
      raiz.render(<AdminAboutStoreView onNavigate={() => {}} />);
    });
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 30));
    });
  }

  it("CEP de Campinas e cidade cadastrada São Paulo: aparece 'Seu CEP é de Campinas/SP'", async () => {
    configAtual = {
      ...BASE_CONFIG,
      originCep: "13010-000",
      storeCity: "São Paulo",
      storeState: "SP",
      storeAddress: null,
    };
    instalarCepDeSaoPaulo({
      logradouro: "Rua Barão de Jaguara",
      bairro: "Centro",
      localidade: "Campinas",
      uf: "SP",
    });
    await renderizarTela();

    expect(hospedeiro.textContent).toContain("Seu CEP é de Campinas/SP");
    expect(hospedeiro.textContent).toContain("São Paulo/SP");
  });

  it("CEP e cidade que combinam: sem aviso", async () => {
    configAtual = {
      ...BASE_CONFIG,
      originCep: "01310-100",
      storeCity: "São Paulo",
      storeState: "SP",
      storeAddress: null,
    };
    instalarCepDeSaoPaulo();
    await renderizarTela();

    expect(hospedeiro.textContent).not.toContain("Seu CEP é de");
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
