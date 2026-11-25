// @vitest-environment jsdom
//
// Lista de endereços do Perfil (modo compacto) — bordas sem guarda:
//  - o selo "Principal" aparece SÓ no endereço principal (nunca em todos);
//  - Editar só existe quando a tela passa `onEdit`, e Excluir só quando passa
//    `onDelete` (um botão sem handler quebraria no toque);
//  - exclusão que FALHA (a promessa rejeita): a pergunta fecha, o botão não
//    fica preso em "Excluindo..." e o erro não escapa como rejeição solta
//    (quem apaga é que avisa a cliente do erro).
import { AddressList } from "@/components/ui/custom/AddressList";
import type { Address } from "@/types";
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}
vi.stubGlobal("ResizeObserver", ResizeObserverStub);

const CASA: Address = {
  id: "addr-casa",
  user_id: "user-1",
  name: "Casa",
  recipient_name: "Maria Teste",
  cep: "01001-000",
  street: "Rua Exemplo",
  number: "10",
  complement: "",
  neighborhood: "Centro",
  city: "Cidade Exemplo",
  state: "SP",
  reference: null,
  is_default: true,
};
const TRABALHO: Address = {
  ...CASA,
  id: "addr-trabalho",
  name: "Trabalho",
  street: "Avenida Fictícia",
  number: "99",
  is_default: false,
};

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
  document.body.innerHTML = "";
});

function montar(props: Partial<Parameters<typeof AddressList>[0]> = {}) {
  act(() => {
    raiz.render(
      <AddressList addresses={[CASA, TRABALHO]} compact {...props} />,
    );
  });
}

const rotulos = () =>
  [...hospedeiro.querySelectorAll("button")].map(
    (b) => b.getAttribute("aria-label") ?? "",
  );
const pergunta = () =>
  document.body.querySelector<HTMLElement>('[role="alertdialog"]');
const botaoDaPergunta = (texto: string) =>
  [...(pergunta()?.querySelectorAll<HTMLButtonElement>("button") ?? [])].find(
    (b) => b.textContent?.trim() === texto,
  );

describe("AddressList compacto — o selo Principal", () => {
  it("aparece uma vez só, na linha do endereço principal", () => {
    montar();
    const linhas = [...hospedeiro.querySelectorAll("li")];
    expect(linhas).toHaveLength(2);
    const [casa, trabalho] = linhas;
    expect(casa.textContent).toContain("Casa");
    expect(casa.textContent).toContain("Principal");
    expect(trabalho.textContent).toContain("Trabalho");
    expect(trabalho.textContent).not.toContain("Principal");
    expect(hospedeiro.textContent?.match(/Principal/g)).toHaveLength(1);
  });
});

describe("AddressList compacto — botões só com handler", () => {
  it("só onDelete: nenhum Editar; só onEdit: nenhum Excluir", () => {
    montar({ onDelete: vi.fn() });
    expect(rotulos().filter((r) => r.startsWith("Editar endereço"))).toEqual(
      [],
    );
    expect(
      rotulos().filter((r) => r.startsWith("Excluir endereço")),
    ).toHaveLength(2);

    montar({ onEdit: vi.fn(), onDelete: undefined });
    expect(
      rotulos().filter((r) => r.startsWith("Editar endereço")),
    ).toHaveLength(2);
    expect(rotulos().filter((r) => r.startsWith("Excluir endereço"))).toEqual(
      [],
    );
  });
});

describe("AddressList cartão completo — id do botão Editar (volta de foco do checkout)", () => {
  const editar = (nome: string) =>
    hospedeiro.querySelector<HTMLButtonElement>(
      `button[aria-label="Editar endereço ${nome}"]`,
    );

  it("só no checkout (selectable) o botão tem o id que a tela usa para devolver o foco", () => {
    montar({ compact: false, selectable: true, onEdit: vi.fn() });
    expect(editar("Casa")?.id).toBe("checkout-editar-endereco-addr-casa");
    expect(editar("Trabalho")?.id).toBe(
      "checkout-editar-endereco-addr-trabalho",
    );

    montar({ compact: false, selectable: false, onEdit: vi.fn() });
    expect(editar("Casa")).not.toBeNull();
    expect(editar("Casa")?.id).toBe("");
    expect(editar("Trabalho")?.id).toBe("");
  });
});

describe("AddressList compacto — exclusão que falha", () => {
  it("a pergunta fecha, o botão não fica preso e nenhuma rejeição escapa", async () => {
    const soltas: unknown[] = [];
    const ouvinte = (motivo: unknown) => soltas.push(motivo);
    process.on("unhandledRejection", ouvinte);
    try {
      const onDelete = vi
        .fn<(id: string) => Promise<unknown>>()
        .mockRejectedValue(new Error("rede caiu"));
      montar({ onDelete });

      await act(async () => {
        hospedeiro
          .querySelector<HTMLButtonElement>(
            'button[aria-label="Excluir endereço Trabalho"]',
          )
          ?.click();
      });
      expect(pergunta()).not.toBeNull();

      await act(async () => {
        botaoDaPergunta("Apagar")?.click();
      });
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 30));
      });

      expect(onDelete).toHaveBeenCalledExactlyOnceWith("addr-trabalho");
      expect(pergunta()).toBeNull();
      expect(soltas).toEqual([]);

      // Dá para tentar de novo: a lixeira abre a pergunta com o botão normal.
      await act(async () => {
        hospedeiro
          .querySelector<HTMLButtonElement>(
            'button[aria-label="Excluir endereço Trabalho"]',
          )
          ?.click();
      });
      expect(botaoDaPergunta("Apagar")?.disabled).toBe(false);
    } finally {
      process.off("unhandledRejection", ouvinte);
    }
  });
});

describe("AddressList cartão completo — escolher só no modo de escolha", () => {
  const cartoes = () =>
    [...hospedeiro.querySelectorAll<HTMLElement>("p, span")].filter(
      (el) => el.textContent === "Casa" || el.textContent === "Trabalho",
    );
  const trabalho = () => cartoes().find((el) => el.textContent === "Trabalho");

  it("fora do modo de escolha, tocar no cartão não chama onSelect; no modo de escolha chama", async () => {
    const onSelect = vi.fn();
    montar({ compact: false, selectable: false, onSelect, onEdit: vi.fn() });
    await act(async () => {
      trabalho()?.click();
    });
    expect(onSelect).not.toHaveBeenCalled();

    montar({ compact: false, selectable: true, onSelect, onEdit: vi.fn() });
    await act(async () => {
      trabalho()?.click();
    });
    expect(onSelect).toHaveBeenCalledExactlyOnceWith(TRABALHO);
  });

  it("tocar na lixeira de um cartão do modo de escolha NÃO escolhe o endereço", async () => {
    const onSelect = vi.fn();
    montar({
      compact: false,
      selectable: true,
      onSelect,
      onDelete: vi.fn(),
    });
    await act(async () => {
      hospedeiro
        .querySelector<HTMLButtonElement>(
          'button[aria-label="Excluir endereço Trabalho"]',
        )
        ?.click();
    });
    expect(pergunta()).not.toBeNull();
    expect(onSelect).not.toHaveBeenCalled();
  });

  it("'Selecionado' (só para o leitor de tela) existe só no modo de escolha", () => {
    montar({
      compact: false,
      selectable: false,
      selectedId: "addr-casa",
      onEdit: vi.fn(),
    });
    expect(hospedeiro.textContent).not.toContain("Selecionado");

    montar({
      compact: false,
      selectable: true,
      selectedId: "addr-casa",
      onEdit: vi.fn(),
    });
    expect(hospedeiro.textContent?.match(/Selecionado/g)).toHaveLength(1);
  });
});

describe("AddressList compacto — bairro vazio e exclusão em andamento", () => {
  it("sem bairro, a linha mostra a cidade", () => {
    montar({ addresses: [{ ...CASA, neighborhood: "" }] });
    expect(hospedeiro.querySelector("li p")?.textContent).toContain(
      "Rua Exemplo, 10 · Cidade Exemplo",
    );
  });

  it("com a exclusão em andamento, Esc não fecha a pergunta", async () => {
    const onDelete = vi
      .fn<(id: string) => Promise<unknown>>()
      .mockReturnValue(new Promise(() => {}));
    montar({ onDelete });
    await act(async () => {
      hospedeiro
        .querySelector<HTMLButtonElement>(
          'button[aria-label="Excluir endereço Trabalho"]',
        )
        ?.click();
    });
    await act(async () => {
      botaoDaPergunta("Apagar")?.click();
    });
    expect(onDelete).toHaveBeenCalledTimes(1);

    await act(async () => {
      document.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
      );
    });
    expect(pergunta()).not.toBeNull();
  });
});
