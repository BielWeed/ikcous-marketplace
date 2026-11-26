// @vitest-environment jsdom
//
// Bordas da folha "Gerenciar categorias" que os testes vizinhos não seguram:
//
// 1. ENTER no campo "Novo nome" envia o formulário sem passar pelo botão: o
//    botão "Salvar nome" apagado (nome igual, vazio, "Todas") não protege nada
//    nesse caminho. O envio tem de recusar sozinho, senão o banco recebe um
//    renome que a própria tela já tinha marcado como inválido.
// 2. A releitura da lista depois de um erro depende do TIPO do erro: o aviso do
//    banco (55006, "a categoria mudou") só fecha a confirmação e relê quando o
//    erro veio de APAGAR; num renome o mesmo código não relê; e a resposta que
//    nunca chegou relê em segundo plano.
// 3. A dica "Para apagar: …" some enquanto o campo de nome está aberto.
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { rpcMock, renameCategory, deleteCategory, setCategoryActive } =
  vi.hoisted(() => ({
    rpcMock: vi.fn(),
    renameCategory: vi.fn(),
    deleteCategory: vi.fn(),
    setCategoryActive: vi.fn(),
  }));

vi.mock("@/lib/supabase", () => ({ supabase: { rpc: rpcMock } }));
vi.mock("@/hooks/useCategories", () => ({
  useCategories: () => ({ renameCategory, deleteCategory, setCategoryActive }),
}));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

import { GerenciarCategorias } from "@/components/admin/categorias/GerenciarCategorias";
import { ErroDeCategoria } from "@/lib/gestao-de-categorias";
import { erroDeConsultaSemResposta } from "@/lib/prazo-da-requisicao";

const VAZIA = {
  id: "c-joias",
  nome: "Joias",
  slug: "joias",
  ativo: true,
  produtos: 0,
  produtos_excluidos: 0,
  banners: 0,
  regra_devolucao: 0,
};
const EM_USO = { ...VAZIA, produtos: 2 };

function botao(nome: string): HTMLButtonElement {
  const achado = [...document.querySelectorAll("button")].find(
    (b) =>
      b.getAttribute("aria-label") === nome || b.textContent?.trim() === nome,
  );
  if (!achado) throw new Error(`Botão "${nome}" não está na tela.`);
  return achado;
}

function campoDoNome(): HTMLInputElement {
  const campo = document.querySelector<HTMLInputElement>(
    "#nome-da-categoria-c-joias",
  );
  if (!campo) throw new Error("Campo do nome não está na tela.");
  return campo;
}

function digitar(texto: string) {
  const setter = Object.getOwnPropertyDescriptor(
    HTMLInputElement.prototype,
    "value",
  )?.set;
  setter?.call(campoDoNome(), texto);
  campoDoNome().dispatchEvent(new Event("input", { bubbles: true }));
}

/** O que ENTER faz no campo: envia o formulário, sem olhar o botão. */
function apertarEnter() {
  const form = campoDoNome().closest("form");
  if (!form) throw new Error("Formulário do nome não está na tela.");
  form.requestSubmit();
}

const espera = () => new Promise<void>((resolve) => setTimeout(resolve, 0));
const leituras = () =>
  rpcMock.mock.calls.filter(([nome]) => nome === "categorias_com_uso").length;

describe("Gerenciar categorias — Enter no campo e releitura por tipo de erro", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    rpcMock.mockReset().mockResolvedValue({ data: [VAZIA], error: null });
    renameCategory.mockReset();
    deleteCategory.mockReset();
    hospedeiro = document.createElement("div");
    document.body.appendChild(hospedeiro);
    raiz = createRoot(hospedeiro);
  });

  afterEach(() => {
    act(() => raiz.unmount());
    hospedeiro.remove();
    document.body.innerHTML = "";
    vi.useRealTimers();
  });

  async function abrir(linha = VAZIA) {
    rpcMock.mockResolvedValue({ data: [linha], error: null });
    await act(async () => {
      raiz.render(<GerenciarCategorias aberta onFechar={() => {}} />);
      await espera();
    });
  }

  async function comecarARenomear() {
    await act(async () => {
      botao("Renomear Joias").click();
    });
  }

  describe("Enter no campo do nome", () => {
    it("controle: um nome novo e válido, enviado com Enter, chega ao banco", async () => {
      renameCategory.mockResolvedValueOnce({
        nome: "Anéis",
        produtos: 0,
        banners: 0,
        regraDeDevolucao: 0,
      });
      await abrir();
      await comecarARenomear();
      await act(async () => {
        digitar("Anéis");
      });
      await act(async () => {
        apertarEnter();
        await espera();
      });
      expect(renameCategory).toHaveBeenCalledTimes(1);
      expect(renameCategory).toHaveBeenCalledWith("c-joias", "Anéis");
    });

    it("o mesmo nome de agora: Enter não chama o banco", async () => {
      await abrir();
      await comecarARenomear();
      expect(campoDoNome().value).toBe("Joias");
      await act(async () => {
        apertarEnter();
        await espera();
      });
      expect(renameCategory).not.toHaveBeenCalled();
    });

    it("nome só de espaços: Enter não chama o banco", async () => {
      await abrir();
      await comecarARenomear();
      await act(async () => {
        digitar("   ");
      });
      await act(async () => {
        apertarEnter();
        await espera();
      });
      expect(renameCategory).not.toHaveBeenCalled();
    });

    it("nome reservado (Todas): mostra o aviso e Enter não chama o banco", async () => {
      await abrir();
      await comecarARenomear();
      await act(async () => {
        digitar("Todas");
      });
      expect(
        document.querySelector("#nome-reservado-c-joias")?.textContent,
      ).toContain("Escolha outro nome");
      await act(async () => {
        apertarEnter();
        await espera();
      });
      expect(renameCategory).not.toHaveBeenCalled();
    });
  });

  describe("quando a lista é lida de novo depois de um erro", () => {
    it("apagar com o aviso 55006: fecha a confirmação e relê a lista", async () => {
      deleteCategory.mockRejectedValueOnce(
        new ErroDeCategoria("A categoria mudou. Veja a lista.", "55006"),
      );
      await abrir();
      await act(async () => {
        botao("Apagar Joias").click();
      });
      const antes = leituras();
      await act(async () => {
        botao("Apagar de vez").click();
        await espera();
      });
      expect(document.querySelector('[role="alert"]')?.textContent).toBe(
        "A categoria mudou. Veja a lista.",
      );
      expect(
        [...document.querySelectorAll("button")].some(
          (b) => b.textContent?.trim() === "Apagar de vez",
        ),
      ).toBe(false);
      expect(leituras()).toBe(antes + 1);
    });

    it("apagar com outro código de erro: a confirmação fica e a lista não é relida", async () => {
      deleteCategory.mockRejectedValueOnce(
        new ErroDeCategoria("Não deu para apagar agora.", "XX000"),
      );
      await abrir();
      await act(async () => {
        botao("Apagar Joias").click();
      });
      const antes = leituras();
      await act(async () => {
        botao("Apagar de vez").click();
        await espera();
      });
      expect(botao("Apagar de vez").disabled).toBe(false);
      // A frase do próprio erro de categoria aparece, mesmo com código desconhecido.
      expect(document.querySelector('[role="alert"]')?.textContent).toBe(
        "Não deu para apagar agora.",
      );
      expect(leituras()).toBe(antes);
    });

    it("renomear com o mesmo código 55006: mostra o erro e NÃO relê a lista", async () => {
      renameCategory.mockRejectedValueOnce(
        new ErroDeCategoria("A categoria mudou. Veja a lista.", "55006"),
      );
      await abrir();
      await comecarARenomear();
      await act(async () => {
        digitar("Anéis");
      });
      const antes = leituras();
      await act(async () => {
        botao("Salvar nome").click();
        await espera();
      });
      expect(document.querySelector('[role="alert"]')?.textContent).toBe(
        "A categoria mudou. Veja a lista.",
      );
      expect(leituras()).toBe(antes);
    });

    it("renomear sem resposta da rede: relê a lista em segundo plano", async () => {
      renameCategory.mockRejectedValueOnce(
        erroDeConsultaSemResposta("Sem resposta da rede. Confira a lista."),
      );
      await abrir();
      await comecarARenomear();
      await act(async () => {
        digitar("Anéis");
      });
      const antes = leituras();
      await act(async () => {
        botao("Salvar nome").click();
        await espera();
      });
      expect(leituras()).toBe(antes + 1);
    });

    it("renomear com erro comum do banco: não relê a lista", async () => {
      renameCategory.mockRejectedValueOnce(new Error("falha qualquer"));
      await abrir();
      await comecarARenomear();
      await act(async () => {
        digitar("Anéis");
      });
      const antes = leituras();
      await act(async () => {
        botao("Salvar nome").click();
        await espera();
      });
      expect(document.querySelector('[role="alert"]')).not.toBeNull();
      expect(leituras()).toBe(antes);
    });
  });

  describe("a dica de como apagar", () => {
    it("aparece na categoria em uso e some enquanto o nome está sendo editado", async () => {
      await abrir(EM_USO);
      expect(document.body.textContent).toContain(
        "Para apagar: mude os produtos",
      );
      await comecarARenomear();
      expect(document.body.textContent).not.toContain("Para apagar:");
    });
  });
});
