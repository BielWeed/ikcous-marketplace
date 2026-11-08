// @vitest-environment jsdom
//
// Rede pendurada na folha "Gerenciar categorias". O hook já encerra a ESPERA
// depois do prazo e devolve um erro de "sem resposta" (use-categories-
// gravacao-sem-resposta); aqui se prova o que a FOLHA faz com ele:
//
// - mostra a frase que diz que NÃO se sabe se gravou (e não o "Nada foi mudado"
//   do erro comum, que seria falso);
// - solta os botões, sem apagar o nome que a lojista digitou;
// - se a gravação deu certo mas a releitura da lista pendurou, também solta.
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
import { erroDeConsultaSemResposta } from "@/lib/prazo-da-requisicao";

const CATEGORIA = {
  id: "c-joias",
  nome: "Joias",
  slug: "joias",
  ativo: true,
  produtos: 0,
  produtos_excluidos: 0,
  banners: 0,
  regra_devolucao: 0,
};

const FRASE_RENOME =
  "Sem resposta da rede. Não sabemos se o nome foi trocado. Confira na lista antes de tentar de novo.";
const FRASE_APAGAR =
  "Sem resposta da rede. Não sabemos se a categoria foi apagada. Confira na lista antes de tentar de novo.";

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

const espera = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

describe("Gerenciar categorias — gravação sem resposta", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    rpcMock.mockReset().mockResolvedValue({ data: [CATEGORIA], error: null });
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

  async function abrir() {
    await act(async () => {
      raiz.render(<GerenciarCategorias aberta onFechar={() => {}} />);
      await espera();
    });
  }

  it("renomear sem resposta: frase de não saber, nome digitado fica e os botões soltam", async () => {
    renameCategory.mockRejectedValueOnce(
      erroDeConsultaSemResposta(FRASE_RENOME),
    );
    await abrir();
    await act(async () => {
      botao("Renomear Joias").click();
    });
    await act(async () => {
      digitar("Anéis");
    });

    await act(async () => {
      botao("Salvar nome").click();
      await espera();
    });

    expect(renameCategory).toHaveBeenCalledWith("c-joias", "Anéis");
    const aviso = document.querySelector('[role="alert"]');
    expect(aviso?.textContent).toBe(FRASE_RENOME);
    expect(document.body.textContent).not.toContain("Nada foi mudado");
    expect(campoDoNome().value).toBe("Anéis");
    expect(campoDoNome().disabled).toBe(false);
    expect(botao("Salvar nome").disabled).toBe(false);
    expect(botao("Cancelar").disabled).toBe(false);
  });

  it("apagar sem resposta: frase de não saber e o botão volta", async () => {
    deleteCategory.mockRejectedValueOnce(
      erroDeConsultaSemResposta(FRASE_APAGAR),
    );
    await abrir();
    await act(async () => {
      botao("Apagar Joias").click();
    });

    await act(async () => {
      botao("Apagar de vez").click();
      await espera();
    });

    expect(document.querySelector('[role="alert"]')?.textContent).toBe(
      FRASE_APAGAR,
    );
    expect(botao("Apagar de vez").disabled).toBe(false);
    expect(botao("Manter").disabled).toBe(false);
  });

  it("gravou, mas a releitura da lista pendurou: a tela solta mesmo assim", async () => {
    setCategoryActive.mockResolvedValueOnce(undefined);
    await abrir();
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    // A releitura depois da ação nunca responde.
    rpcMock.mockReset().mockImplementation(() => new Promise<never>(() => {}));

    await act(async () => {
      botao("Esconder Joias da vitrine").click();
      await vi.advanceTimersByTimeAsync(0);
    });
    // Enquanto espera, os botões ficam apagados (uma ação por vez)...
    expect(botao("Renomear Joias").disabled).toBe(true);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(16_000);
    });

    // ...e quando o prazo da releitura estoura, soltam.
    expect(setCategoryActive).toHaveBeenCalledWith("c-joias", false);
    expect(botao("Renomear Joias").disabled).toBe(false);
    expect(document.querySelector('[role="status"]')?.textContent).toContain(
      "saiu do filtro da vitrine",
    );
    expect(document.querySelector('[role="alert"]')).toBeNull();
  });
});
