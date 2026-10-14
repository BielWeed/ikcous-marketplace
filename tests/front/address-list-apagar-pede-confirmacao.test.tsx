// @vitest-environment jsdom
//
// Apagar endereço no Perfil pede confirmação (caçada de 14/10/2026, dado de cliente): a lixeira do cartão é um
// quadradinho de 24 px colado no lápis e apagava na hora, sem "tem certeza?" — um toque errado e o endereço da
// cliente sumia (e, antes da migration 20261229, o pedido ainda ligado a ele ficava sem endereço). Agora o toque na
// lixeira só ABRE a pergunta; quem apaga é o botão "Apagar" dela. Vale nos dois ramos do cartão (compacto e
// expandido) e só para o endereço em que se tocou.
import { AddressList } from "@/components/ui/custom/AddressList";
import type { Address } from "@/types";
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

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}
vi.stubGlobal("ResizeObserver", ResizeObserverStub);

const CASA: Address = {
  id: "addr-1",
  user_id: "user-1",
  name: "Casa",
  recipient_name: "Maria de Lourdes",
  cep: "38600-123",
  street: "Rua das Acácias",
  number: "120",
  complement: "Apto 301",
  neighborhood: "Jardim Primavera",
  city: "Paracatu",
  state: "MG",
  reference: null,
  is_default: true,
};
const TRABALHO: Address = {
  ...CASA,
  id: "addr-2",
  name: "Trabalho",
  street: "Avenida Paulista",
  number: "1578",
  city: "São Paulo",
  state: "SP",
  is_default: false,
};

const pergunta = () =>
  document.body.querySelector<HTMLElement>('[role="alertdialog"]');
const botao = (rotulo: string, raizDoBotao: ParentNode = document.body) =>
  [...raizDoBotao.querySelectorAll<HTMLButtonElement>("button")].find(
    (b) =>
      b.getAttribute("aria-label") === rotulo ||
      b.textContent?.trim() === rotulo,
  );

describe.each([
  ["compacto", true],
  ["expandido", false],
])("AddressList (%s) — apagar endereço pede confirmação", (_nome, compacto) => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;
  let onDelete: Mock<(id: string) => void>;

  beforeEach(() => {
    onDelete = vi.fn<(id: string) => void>();
    hospedeiro = document.createElement("div");
    document.body.appendChild(hospedeiro);
    raiz = createRoot(hospedeiro);
    act(() => {
      raiz.render(
        <AddressList
          addresses={[CASA, TRABALHO]}
          compact={compacto}
          onEdit={() => {}}
          onDelete={onDelete}
        />,
      );
    });
  });

  afterEach(() => {
    act(() => raiz.unmount());
    hospedeiro.remove();
    document.body.innerHTML = "";
  });

  const lixeiras = () => [
    ...hospedeiro.querySelectorAll<HTMLButtonElement>(
      'button[aria-label="Excluir"]',
    ),
  ];

  it("tocar na lixeira NAO apaga: abre a pergunta com o nome do endereco e nada e chamado", () => {
    expect(lixeiras()).toHaveLength(2);
    expect(pergunta()).toBeNull();
    act(() => lixeiras()[0].click());
    expect(onDelete).not.toHaveBeenCalled();
    const p = pergunta();
    expect(p).not.toBeNull();
    expect(p?.textContent).toContain("Apagar este endereço?");
    expect(p?.textContent).toContain("Casa");
    expect(p?.textContent).toContain("Rua das Acácias, 120");
  });

  it("Cancelar fecha a pergunta e NAO apaga", () => {
    act(() => lixeiras()[0].click());
    act(() => botao("Cancelar")?.click());
    expect(onDelete).not.toHaveBeenCalled();
    expect(pergunta()).toBeNull();
  });

  it("Escape fecha a pergunta e NAO apaga", () => {
    act(() => lixeiras()[0].click());
    expect(pergunta()).not.toBeNull();
    act(() => {
      pergunta()?.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
      );
    });
    expect(onDelete).not.toHaveBeenCalled();
    expect(pergunta()).toBeNull();
  });

  it("Apagar confirma: chama onDelete UMA vez, com o id do endereco em que se tocou (nao o do outro), e fecha", () => {
    act(() => lixeiras()[1].click());
    expect(pergunta()?.textContent).toContain("Trabalho");
    act(() => botao("Apagar")?.click());
    expect(onDelete).toHaveBeenCalledTimes(1);
    expect(onDelete).toHaveBeenCalledWith("addr-2");
    expect(pergunta()).toBeNull();
  });

  it("depois de cancelar, tocar em OUTRA lixeira pergunta pelo outro endereco (nao fica preso no primeiro)", () => {
    act(() => lixeiras()[0].click());
    act(() => botao("Cancelar")?.click());
    act(() => lixeiras()[1].click());
    expect(pergunta()?.textContent).toContain("Trabalho");
    act(() => botao("Apagar")?.click());
    expect(onDelete).toHaveBeenCalledTimes(1);
    expect(onDelete).toHaveBeenCalledWith("addr-2");
  });
});

describe("AddressList — o que nao muda", () => {
  it("o seletor do checkout (selectable) nao tem lixeira nem pergunta", () => {
    const hospedeiro = document.createElement("div");
    document.body.appendChild(hospedeiro);
    const raiz = createRoot(hospedeiro);
    act(() =>
      raiz.render(
        <AddressList
          addresses={[CASA, TRABALHO]}
          selectable
          onSelect={() => {}}
        />,
      ),
    );
    expect(hospedeiro.querySelector('button[aria-label="Excluir"]')).toBeNull();
    expect(pergunta()).toBeNull();
    act(() => raiz.unmount());
    hospedeiro.remove();
  });

  it("sem onDelete nao ha lixeira (o lapis continua)", () => {
    const hospedeiro = document.createElement("div");
    document.body.appendChild(hospedeiro);
    const raiz = createRoot(hospedeiro);
    act(() =>
      raiz.render(<AddressList addresses={[CASA]} onEdit={() => {}} />),
    );
    expect(hospedeiro.querySelector('button[aria-label="Excluir"]')).toBeNull();
    expect(
      hospedeiro.querySelector('button[aria-label="Editar"]'),
    ).not.toBeNull();
    act(() => raiz.unmount());
    hospedeiro.remove();
  });
});
