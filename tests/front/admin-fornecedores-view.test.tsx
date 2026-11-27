// @vitest-environment jsdom
//
// Central de Fornecedores, E1: a tela "Meus fornecedores" (subtela
// `admin-fornecedores`). O hook de dados já tem prova própria
// (use-fornecedores.test.tsx); aqui ele é simulado e se prova o que a PESSOA vê
// e toca: lista, atalhos de um toque seguros, busca, favoritos, cadastro com
// validação, edição, exclusão com confirmação, estado vazio, erro e SEM INTERNET.
//
// Fixtures inventadas (telefones 5511900000000, domínios .invalid).
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ErroDosFornecedores } from "@/hooks/useFornecedores";
import type { DadosDoFornecedor, Fornecedor } from "@/lib/fornecedores";
import { escolherNaLista, valorDaLista } from "./helpers/lista-de-escolha";

const criar = vi.fn();
const editar = vi.fn();
const favoritar = vi.fn();
const excluir = vi.fn();
const recarregar = vi.fn();
const onNavigate = vi.fn();
const onSetDirty = vi.fn();
const toastErro = vi.fn();
const toastSucesso = vi.fn();

let estado: {
  fornecedores: Fornecedor[] | null;
  carregando: boolean;
  erro: string | null;
} = { fornecedores: [], carregando: false, erro: null };

// O hook real puxa o Supabase (EnvGuard), então vira dublê inteiro. A tela só
// mostra a frase que `mensagemDeErroDosFornecedores` devolve: o dublê repete o
// contrato (a classe de erro do hook passa direto, qualquer outro erro vira a
// frase genérica) e a tela nunca mostra o texto cru de um `Error` qualquer.
vi.mock("@/hooks/useFornecedores", () => {
  class ErroDosFornecedores extends Error {}
  return {
    ErroDosFornecedores,
    mensagemDeErroDosFornecedores: (erro: unknown) =>
      erro instanceof ErroDosFornecedores
        ? erro.message
        : "Não deu certo agora. Tente de novo em instantes.",
    useFornecedores: () => ({
      ...estado,
      recarregar,
      criar,
      editar,
      favoritar,
      excluir,
    }),
  };
});

// O hook real é um `useSyncExternalStore`: quando a internet cai, a tela é avisada.
// O dublê faz o mesmo, para provar a queda COM a folha aberta.
const rede = vi.hoisted(() => ({
  offline: false,
  ouvintes: new Set<() => void>(),
}));
vi.mock("@/hooks/useOnlineStatus", async () => {
  const { useSyncExternalStore } = await import("react");
  return {
    useOnlineStatus: () =>
      useSyncExternalStore(
        (aviso) => {
          rede.ouvintes.add(aviso);
          return () => rede.ouvintes.delete(aviso);
        },
        () => rede.offline,
      ),
  };
});
async function definirOffline(valor: boolean) {
  rede.offline = valor;
  await act(async () => {
    for (const aviso of rede.ouvintes) aviso();
  });
}

vi.mock("@/lib/uuid-v4", () => ({
  gerarUuidV4: () => "00000000-0000-4000-8000-000000000001",
}));

vi.mock("sonner", () => ({
  toast: { success: toastSucesso, error: toastErro, loading: vi.fn() },
}));

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

function f(
  id: string,
  nome: string,
  extra: Partial<Fornecedor> = {},
): Fornecedor {
  return {
    id,
    nome,
    whatsapp: null,
    instagram: null,
    site: null,
    cidade: null,
    uf: null,
    observacoes: null,
    favorito: false,
    ...extra,
  };
}

const COMPLETO = f("a", "Atacado Fixture", {
  whatsapp: "11900000000",
  instagram: "loja.fixture",
  site: "https://exemplo.fixture.invalid/",
  cidade: "São Paulo",
  uf: "SP",
  observacoes: "Pedido mínimo de 10 peças.",
  favorito: true,
});
const SEM_CONTATO = f("b", "Brás Moda");

function esperar(): Promise<void> {
  return new Promise((r) => setTimeout(r, 0));
}

describe("AdminFornecedoresView (E1)", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;

  beforeEach(() => {
    vi.clearAllMocks();
    rede.offline = false;
    estado = {
      fornecedores: [COMPLETO, SEM_CONTATO],
      carregando: false,
      erro: null,
    };
    criar.mockImplementation(async (id: string, d: DadosDoFornecedor) => ({
      id,
      ...d,
    }));
    editar.mockImplementation(async (id: string, d: DadosDoFornecedor) => ({
      id,
      ...d,
    }));
    favoritar.mockResolvedValue(undefined);
    excluir.mockResolvedValue(undefined);
    vi.stubGlobal("matchMedia", (query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    }));
    vi.stubGlobal(
      "ResizeObserver",
      class {
        observe() {}
        unobserve() {}
        disconnect() {}
      },
    );
    hospedeiro = document.createElement("div");
    document.body.appendChild(hospedeiro);
    raiz = createRoot(hospedeiro);
  });

  afterEach(() => {
    act(() => raiz.unmount());
    hospedeiro.remove();
    document.body.innerHTML = "";
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  async function montar(active = true) {
    const { AdminFornecedoresView } = await import(
      "@/views/admin/AdminFornecedoresView"
    );
    await act(async () => {
      raiz.render(
        <AdminFornecedoresView
          onNavigate={onNavigate}
          active={active}
          onSetDirty={onSetDirty}
        />,
      );
    });
    await act(async () => {
      await esperar();
    });
  }

  const tela = () => document.body.textContent ?? "";
  const botao = (rotulo: string | RegExp) =>
    [...document.body.querySelectorAll<HTMLButtonElement>("button")].find(
      (b) => {
        const nome = b.getAttribute("aria-label") ?? b.textContent ?? "";
        return typeof rotulo === "string"
          ? nome.trim() === rotulo
          : rotulo.test(nome);
      },
    );
  const clicar = async (el: Element | undefined) => {
    expect(el).toBeDefined();
    await act(async () => (el as HTMLElement).click());
  };
  // O Estado é a lista de escolha do painel (lista premium, 26/11/2026): ele
  // se escolhe pelo helper `escolherNaLista`, não por aqui.
  function digitar(el: HTMLInputElement | HTMLTextAreaElement, valor: string) {
    const proto =
      el instanceof HTMLTextAreaElement
        ? HTMLTextAreaElement.prototype
        : HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(proto, "value")?.set?.call(el, valor);
    el.dispatchEvent(new Event("input", { bubbles: true }));
  }
  const campo = (rotulo: RegExp) => {
    const label = [...document.body.querySelectorAll("label")].find((l) =>
      rotulo.test(l.textContent ?? ""),
    );
    const id = label?.getAttribute("for");
    const el = id ? document.getElementById(id) : null;
    if (!el) throw new Error(`campo ${rotulo} não encontrado`);
    return el as HTMLInputElement | HTMLTextAreaElement;
  };
  const cartoes = () => [
    ...document.body.querySelectorAll<HTMLElement>("[data-fornecedor-id]"),
  ];

  describe("lista", () => {
    it("mostra o título, os cartões na ordem recebida e quantos são", async () => {
      await montar();
      expect(document.body.querySelector("h1")?.textContent).toContain(
        "Meus fornecedores",
      );
      expect(
        cartoes().map((c) => c.getAttribute("data-fornecedor-id")),
      ).toEqual(["a", "b"]);
      expect(tela()).toContain("Atacado Fixture");
      expect(tela()).toContain("São Paulo");
    });

    it("carregando: esqueleto, sem estado vazio", async () => {
      estado = { fornecedores: null, carregando: true, erro: null };
      await montar();
      expect(document.body.querySelector('[aria-busy="true"]')).not.toBeNull();
      expect(tela()).not.toContain("Cadastre quem vende para você");
    });

    it("sem nenhum fornecedor: explica em português simples e oferece cadastrar", async () => {
      estado = { fornecedores: [], carregando: false, erro: null };
      await montar();
      expect(tela()).toContain(
        "Cadastre quem vende para você: o contato fica a um toque",
      );
      await clicar(botao("Cadastrar o primeiro fornecedor"));
      expect(document.querySelector('[role="dialog"]')).not.toBeNull();
    });

    it("erro de leitura: mostra a frase pronta e 'Tentar de novo' recarrega", async () => {
      estado = {
        fornecedores: null,
        carregando: false,
        erro: "Não consegui falar com o servidor. Confira a internet e tente de novo.",
      };
      await montar();
      expect(tela()).toContain("Não consegui falar com o servidor");
      expect(tela()).not.toContain("Cadastre quem vende para você");
      await clicar(botao("Tentar de novo"));
      expect(recarregar).toHaveBeenCalledTimes(1);
    });

    it("tela escondida (active=false) não deixa o botão Novo fornecedor solto", async () => {
      await montar(false);
      expect(botao(/Novo fornecedor/)).toBeUndefined();
    });
  });

  describe("atalhos de um toque", () => {
    it("WhatsApp, Instagram e Site abrem em outra aba, sem vazar a origem", async () => {
      await montar();
      const cartao = cartoes()[0];
      const links = [...cartao.querySelectorAll<HTMLAnchorElement>("a")];
      const por = (re: RegExp) =>
        links.find((a) =>
          re.test(a.getAttribute("aria-label") ?? a.textContent ?? ""),
        );
      expect(por(/WhatsApp/)?.getAttribute("href")).toBe(
        "https://wa.me/5511900000000",
      );
      expect(por(/Instagram/)?.getAttribute("href")).toBe(
        "https://instagram.com/loja.fixture",
      );
      expect(por(/Site/)?.getAttribute("href")).toBe(
        "https://exemplo.fixture.invalid/",
      );
      expect(links).toHaveLength(3);
      for (const a of links) {
        expect(a.getAttribute("target")).toBe("_blank");
        expect(a.getAttribute("rel")).toBe("noopener noreferrer");
      }
    });

    it("só aparece o atalho do que foi preenchido", async () => {
      await montar();
      expect(cartoes()[1].querySelectorAll("a")).toHaveLength(0);
    });

    it("valor estranho já gravado no banco nunca vira link", async () => {
      estado = {
        fornecedores: [
          f("x", "Dado Estranho", {
            whatsapp: "abc",
            instagram: "javascript:alert(1)",
            site: "javascript:alert(1)",
          }),
        ],
        carregando: false,
        erro: null,
      };
      await montar();
      expect(cartoes()[0].querySelectorAll("a")).toHaveLength(0);
    });

    it("o nome acessível diz de quem é o atalho", async () => {
      await montar();
      const wa = cartoes()[0].querySelector("a");
      expect(wa?.getAttribute("aria-label")).toBe(
        "WhatsApp de Atacado Fixture (abre em outra aba)",
      );
    });
  });

  describe("busca e favoritos", () => {
    it("busca por nome ignora acento e maiúscula", async () => {
      estado = {
        fornecedores: [f("1", "Brás Moda"), f("2", "Goiânia Jeans")],
        carregando: false,
        erro: null,
      };
      await montar();
      const busca = document.body.querySelector<HTMLInputElement>(
        'input[type="search"]',
      )!;
      await act(async () => digitar(busca, "bras"));
      expect(
        cartoes().map((c) => c.getAttribute("data-fornecedor-id")),
      ).toEqual(["1"]);
      await act(async () => digitar(busca, "GOIANIA"));
      expect(
        cartoes().map((c) => c.getAttribute("data-fornecedor-id")),
      ).toEqual(["2"]);
    });

    it("busca sem resultado diz isso e oferece limpar (não mostra o vazio de quem não cadastrou)", async () => {
      await montar();
      const busca = document.body.querySelector<HTMLInputElement>(
        'input[type="search"]',
      )!;
      await act(async () => digitar(busca, "zzzz"));
      expect(cartoes()).toHaveLength(0);
      expect(tela()).toContain("Nenhum fornecedor encontrado");
      expect(tela()).not.toContain("Cadastre quem vende para você");
      await clicar(botao("Limpar filtros"));
      expect(cartoes()).toHaveLength(2);
    });

    it("filtro Favoritos liga e desliga (aria-pressed) e mostra só os favoritos", async () => {
      await montar();
      const chip = botao("Favoritos")!;
      expect(chip.getAttribute("aria-pressed")).toBe("false");
      await clicar(chip);
      expect(chip.getAttribute("aria-pressed")).toBe("true");
      expect(
        cartoes().map((c) => c.getAttribute("data-fornecedor-id")),
      ).toEqual(["a"]);
      await clicar(chip);
      expect(cartoes()).toHaveLength(2);
    });

    it("favoritos ligado sem nenhum favorito: aviso próprio, não o vazio de quem não cadastrou", async () => {
      estado = { fornecedores: [SEM_CONTATO], carregando: false, erro: null };
      await montar();
      await clicar(botao("Favoritos"));
      expect(tela()).toContain("Nenhum favorito ainda");
    });

    it("a estrela chama favoritar com o valor invertido e diz o estado (aria-pressed)", async () => {
      await montar();
      const estrelaFav = botao("Tirar Atacado Fixture dos favoritos")!;
      expect(estrelaFav.getAttribute("aria-pressed")).toBe("true");
      await clicar(estrelaFav);
      expect(favoritar).toHaveBeenCalledWith("a", false);
      await clicar(botao("Favoritar Brás Moda"));
      expect(favoritar).toHaveBeenCalledWith("b", true);
    });

    it("falha ao favoritar avisa (toast) e não finge sucesso", async () => {
      favoritar.mockRejectedValueOnce(
        new ErroDosFornecedores("Este fornecedor não existe mais"),
      );
      await montar();
      await clicar(botao("Favoritar Brás Moda"));
      expect(toastErro).toHaveBeenCalledWith("Este fornecedor não existe mais");
    });

    it("um erro cru qualquer nunca vai para o toast: aparece só a frase do hook", async () => {
      favoritar.mockRejectedValueOnce(
        new Error('duplicate key value violates unique constraint "x"'),
      );
      await montar();
      await clicar(botao("Favoritar Brás Moda"));
      expect(toastErro).toHaveBeenCalledTimes(1);
      expect(toastErro).not.toHaveBeenCalledWith(
        expect.stringContaining("duplicate key"),
      );
    });
  });

  describe("cadastrar", () => {
    async function abrirNovo() {
      await clicar(botao(/^Novo fornecedor/));
    }

    it("abre a folha vazia; sem nome não grava e mostra o erro no campo", async () => {
      await montar();
      await abrirNovo();
      expect(document.querySelector('[role="dialog"]')).not.toBeNull();
      await clicar(botao("Salvar fornecedor"));
      expect(criar).not.toHaveBeenCalled();
      expect(document.querySelector('[role="alert"]')?.textContent).toContain(
        "Digite o nome",
      );
      expect(campo(/Nome/).getAttribute("aria-invalid")).toBe("true");
    });

    it("WhatsApp curto demais e site perigoso são recusados antes de ir ao banco", async () => {
      await montar();
      await abrirNovo();
      await act(async () => digitar(campo(/Nome/), "Novo"));
      await act(async () => digitar(campo(/WhatsApp/), "123"));
      await act(async () => digitar(campo(/Site/), "javascript:alert(1)"));
      await clicar(botao("Salvar fornecedor"));
      expect(criar).not.toHaveBeenCalled();
      const alertas = [...document.querySelectorAll('[role="alert"]')]
        .map((a) => a.textContent)
        .join(" ");
      expect(alertas).toContain("DDD");
      expect(alertas).toContain("site");
    });

    it("preenchido: grava no id gerado, com dados normalizados, avisa e fecha", async () => {
      await montar();
      await abrirNovo();
      await act(async () => digitar(campo(/Nome/), "  Novo   Atacado "));
      await act(async () => digitar(campo(/WhatsApp/), "(11) 90000-0000"));
      await act(async () => digitar(campo(/Instagram/), "@novo.atacado"));
      await act(async () => digitar(campo(/Site/), "novo.fixture.invalid"));
      await act(async () => digitar(campo(/Cidade/), "Goiânia"));
      await act(async () => escolherNaLista(campo(/Estado/).id, "GO"));
      await act(async () => digitar(campo(/Observa/), "Entrega em 3 dias"));
      await clicar(botao("Salvar fornecedor"));
      expect(criar).toHaveBeenCalledTimes(1);
      expect(criar).toHaveBeenCalledWith(
        "00000000-0000-4000-8000-000000000001",
        {
          nome: "Novo Atacado",
          whatsapp: "11900000000",
          instagram: "novo.atacado",
          site: "https://novo.fixture.invalid",
          cidade: "Goiânia",
          uf: "GO",
          observacoes: "Entrega em 3 dias",
          favorito: false,
        },
      );
      expect(toastSucesso).toHaveBeenCalled();
      expect(document.querySelector('[role="dialog"]')).toBeNull();
    });

    it("Estado: a lista busca pelo nome; RJ grava 'RJ' e o campo mostra a sigla", async () => {
      await montar();
      await abrirNovo();
      await act(async () => digitar(campo(/Nome/), "Novo"));
      const estado = campo(/Estado/) as unknown as HTMLButtonElement;
      expect(estado.getAttribute("aria-haspopup")).toBe("listbox");
      expect(document.querySelector("select")).toBeNull();
      // Novo fornecedor: "Não informar" é a escolha de partida.
      expect(valorDaLista(estado.id)).toBe("");
      expect(estado.textContent).toContain("Não informar");
      await act(async () => estado.click());
      const busca = document.querySelector<HTMLInputElement>(
        '[role="combobox"]',
      ) as HTMLInputElement;
      expect(busca).not.toBeNull();
      await act(async () => digitar(busca, "rio"));
      const achadas = [
        ...document.querySelectorAll<HTMLElement>('[role="option"]'),
      ].map((o) => o.dataset.valor);
      expect(achadas).toEqual(["RJ", "RN", "RS"]);
      expect(document.body.textContent).toContain("3 resultados");
      const rj = document.querySelector<HTMLElement>(
        '[role="option"][data-valor="RJ"]',
      ) as HTMLElement;
      expect(rj.textContent).toContain("Rio de Janeiro");
      await act(async () => rj.click());
      expect(valorDaLista(estado.id)).toBe("RJ");
      // Fechado, o campo mostra a sigla (o selo "RJ").
      expect(
        [...estado.querySelectorAll("span")].some(
          (s) => s.textContent === "RJ",
        ),
      ).toBe(true);
      await clicar(botao("Salvar fornecedor"));
      expect(criar).toHaveBeenCalledWith(
        "00000000-0000-4000-8000-000000000001",
        expect.objectContaining({ uf: "RJ" }),
      );
    });

    it("Estado: 'Não informar' é opção de verdade e apaga o estado já gravado", async () => {
      await montar();
      await clicar(botao("Editar Atacado Fixture"));
      const id = campo(/Estado/).id;
      expect(valorDaLista(id)).toBe("SP");
      await act(async () => escolherNaLista(id, ""));
      expect(valorDaLista(id)).toBe("");
      await clicar(botao("Salvar fornecedor"));
      expect(editar).toHaveBeenCalledWith(
        "a",
        expect.objectContaining({ uf: null }),
      );
    });

    it("dois toques rápidos em Salvar gravam UMA vez só", async () => {
      let liberar: (v: unknown) => void = () => {};
      criar.mockImplementationOnce(
        () =>
          new Promise((r) => {
            liberar = r;
          }),
      );
      await montar();
      await abrirNovo();
      await act(async () => digitar(campo(/Nome/), "Novo"));
      const salvar = botao("Salvar fornecedor")!;
      await act(async () => {
        salvar.click();
        salvar.click();
      });
      expect(criar).toHaveBeenCalledTimes(1);
      await act(async () => liberar({ id: "x" }));
    });

    it("falha ao gravar: a folha FICA aberta, o que foi digitado fica e a frase aparece", async () => {
      criar.mockRejectedValueOnce(
        new Error(
          "Não consegui falar com o servidor. Confira a internet e tente de novo.",
        ),
      );
      await montar();
      await abrirNovo();
      await act(async () => digitar(campo(/Nome/), "Novo"));
      await clicar(botao("Salvar fornecedor"));
      expect(document.querySelector('[role="dialog"]')).not.toBeNull();
      expect(campo(/Nome/).value).toBe("Novo");
      expect(document.querySelector('[role="alert"]')?.textContent).toContain(
        "Não consegui falar com o servidor",
      );
      // Tentar de novo usa o MESMO id: o upsert do hook não duplica.
      criar.mockResolvedValueOnce({ id: "x" });
      await clicar(botao("Salvar fornecedor"));
      expect(criar).toHaveBeenLastCalledWith(
        "00000000-0000-4000-8000-000000000001",
        expect.anything(),
      );
    });

    it("fechar com algo digitado pergunta antes de descartar; sem nada digitado fecha direto", async () => {
      await montar();
      await abrirNovo();
      await clicar(botao("Fechar"));
      expect(document.querySelector('[role="dialog"]')).toBeNull();

      await abrirNovo();
      await act(async () => digitar(campo(/Nome/), "Rascunho"));
      expect(onSetDirty).toHaveBeenLastCalledWith(true);
      await clicar(botao("Fechar"));
      expect(tela()).toContain("Descartar o que você escreveu?");
      await clicar(botao("Continuar editando"));
      expect(campo(/Nome/).value).toBe("Rascunho");
      await clicar(botao("Fechar"));
      await clicar(botao("Descartar"));
      expect(document.querySelector('[role="dialog"]')).toBeNull();
      expect(onSetDirty).toHaveBeenLastCalledWith(false);
      expect(criar).not.toHaveBeenCalled();
    });
  });

  describe("estilo do botão Novo fornecedor", () => {
    it("a tela carrega o CSS de que o botão depende (.produto-principal mora em catalogo-produtos.css)", () => {
      // jsdom não aplica CSS; o que se prova é a causa do defeito: quem recarrega direto nesta
      // tela (2G/economia de dados: o prefetch é barrado) não passa pela tela de Produtos.
      // eslint-disable-next-line security/detect-non-literal-fs-filename -- caminho fixo da tela, montado só com __dirname e literal.
      const fonte = readFileSync(
        resolve(__dirname, "../../src/views/admin/AdminFornecedoresView.tsx"),
        "utf8",
      );
      expect(fonte).toContain("produto-principal");
      expect(fonte).toContain(
        'import "@/components/admin/products/catalogo-produtos.css";',
      );
    });
  });

  describe("editar e excluir", () => {
    it("editar abre a folha já preenchida e grava pelo id do fornecedor", async () => {
      await montar();
      await clicar(botao("Editar Atacado Fixture"));
      expect(campo(/Nome/).value).toBe("Atacado Fixture");
      expect(campo(/WhatsApp/).value).toBe("11900000000");
      expect(campo(/Instagram/).value).toBe("loja.fixture");
      await act(async () => digitar(campo(/Cidade/), "Campinas"));
      await clicar(botao("Salvar fornecedor"));
      expect(criar).not.toHaveBeenCalled();
      // Só a cidade foi mexida: a edição manda só ela. Nem a estrela nem o resto (a folha guarda os
      // valores de quando abriu, que podem já estar velhos se outro aparelho mudou nesse meio tempo).
      expect(editar).toHaveBeenCalledWith("a", { cidade: "Campinas" });
    });

    it("estrela mexida DENTRO da folha é uma escolha do lojista: vai na edição", async () => {
      await montar();
      await clicar(botao("Editar Atacado Fixture"));
      // O COMPLETO abre favorito; o lojista desliga o interruptor da folha.
      await clicar(campo(/Favorito/));
      await clicar(botao("Salvar fornecedor"));
      expect(editar).toHaveBeenCalledWith(
        "a",
        expect.objectContaining({ favorito: false }),
      );
    });

    it("excluir pede confirmação; cancelar não apaga nada", async () => {
      await montar();
      await clicar(botao("Excluir Brás Moda"));
      expect(tela()).toContain("Excluir Brás Moda?");
      await clicar(botao("Cancelar"));
      expect(excluir).not.toHaveBeenCalled();
    });

    it("confirmar exclui pelo id e avisa", async () => {
      await montar();
      await clicar(botao("Excluir Brás Moda"));
      await clicar(botao("Excluir fornecedor"));
      expect(excluir).toHaveBeenCalledWith("b");
      expect(toastSucesso).toHaveBeenCalled();
    });

    it("falha ao excluir avisa com a frase do hook e não some com o cartão por conta própria", async () => {
      excluir.mockRejectedValueOnce(
        new ErroDosFornecedores(
          "Só o administrador da loja mexe nos fornecedores.",
        ),
      );
      await montar();
      await clicar(botao("Excluir Brás Moda"));
      await clicar(botao("Excluir fornecedor"));
      expect(toastErro).toHaveBeenCalledWith(
        "Só o administrador da loja mexe nos fornecedores.",
      );
      expect(cartoes()).toHaveLength(2);
    });
  });

  describe("sem internet", () => {
    beforeEach(() => {
      rede.offline = true;
    });

    it("avisa com clareza e desliga tudo que grava; a lista que já está na tela continua", async () => {
      await montar();
      expect(tela()).toContain("Sem internet");
      expect(cartoes()).toHaveLength(2);
      expect(botao("Novo fornecedor indisponível sem internet")?.disabled).toBe(
        true,
      );
      expect(botao("Editar Atacado Fixture")?.disabled).toBe(true);
      expect(botao("Excluir Atacado Fixture")?.disabled).toBe(true);
      expect(botao("Tirar Atacado Fixture dos favoritos")?.disabled).toBe(true);
      // Os atalhos são links externos: não dependem do nosso banco.
      expect(cartoes()[0].querySelectorAll("a")).toHaveLength(3);
    });

    it("toque nos botões desligados não chama o banco", async () => {
      await montar();
      await clicar(botao("Tirar Atacado Fixture dos favoritos"));
      await clicar(botao("Excluir Atacado Fixture"));
      expect(favoritar).not.toHaveBeenCalled();
      expect(excluir).not.toHaveBeenCalled();
      expect(document.querySelector('[role="dialog"]')).toBeNull();
    });

    it("a internet cai com a folha aberta: Salvar desliga e a folha diz por quê, sem perder o texto", async () => {
      rede.offline = false;
      await montar();
      await clicar(botao(/^Novo fornecedor/));
      await act(async () => digitar(campo(/Nome/), "Novo"));
      await definirOffline(true);
      expect(botao("Salvar fornecedor")?.disabled).toBe(true);
      expect(document.querySelector('[role="dialog"]')?.textContent).toContain(
        "Sem internet",
      );
      expect(campo(/Nome/).value).toBe("Novo");
    });

    it("sem internet e sem lista (nunca carregou): mostra o erro, não o vazio animado", async () => {
      estado = {
        fornecedores: null,
        carregando: false,
        erro: "Não consegui falar com o servidor. Confira a internet e tente de novo.",
      };
      await montar();
      expect(tela()).toContain("Não consegui falar com o servidor");
      expect(tela()).not.toContain("Cadastre quem vende para você");
    });
  });
});
