// @vitest-environment jsdom
//
// EDITAR COM A TELA VELHA NÃO REGRAVA POR CIMA DA CORREÇÃO FEITA EM OUTRO
// APARELHO (r180-a).
//
// A cliente corrige o número de 10 para 100 no celular. No tablet o "Editar
// endereço" abre do cache (número 10) e, logo depois, a consulta ao servidor
// traz o MESMO endereço (mesmo id) já com 100. O formulário só se preenchia de
// novo quando o ID mudava: ela mexia só no complemento, salvava, o aviso era
// "Endereço atualizado" e o número voltava para 10 no banco (o envio leva TODOS
// os campos). Agora, chegando conteúdo novo do MESMO id, só os campos que a
// pessoa ainda NÃO mexeu recebem o valor novo; o que ela digitou fica.
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

import type { DadosDoFormularioDeEndereco } from "@/components/ui/custom/AddressForm";
import type { Address } from "@/types";

vi.mock("@/contexts/StoreContext", () => ({
  useStore: () => ({ config: {}, isLoaded: true }),
}));
vi.mock("@/lib/supabase", () => ({ supabase: {} }));

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

function digitar(id: string, valor: string) {
  const el = document.getElementById(id) as HTMLInputElement;
  expect(el, `campo ${id} deve estar visível`).not.toBeNull();
  const setter = Object.getOwnPropertyDescriptor(
    globalThis.HTMLInputElement.prototype,
    "value",
  )!.set!;
  setter.call(el, valor);
  el.dispatchEvent(new Event("input", { bubbles: true }));
}

async function esvaziar() {
  await act(async () => {
    for (let i = 0; i < 40; i++) await Promise.resolve();
  });
}

const casa = (extra: Partial<Address> = {}): Address => ({
  id: "end-a",
  user_id: "conta",
  name: "Casa",
  recipient_name: "Ana",
  cep: "38500-000",
  street: "Rua do Comércio",
  number: "10",
  complement: "",
  neighborhood: "Centro",
  city: "Monte Carmelo",
  state: "MG",
  reference: "",
  is_default: true,
  ...extra,
});

describe("AddressForm — versão nova do MESMO endereço chega com o formulário aberto", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;
  let onSubmit: Mock<(dados: DadosDoFormularioDeEndereco) => Promise<void>>;

  beforeEach(() => {
    vi.stubGlobal(
      "ResizeObserver",
      class {
        observe() {}
        unobserve() {}
        disconnect() {}
      },
    );
    vi.spyOn(console, "error").mockImplementation(() => {});
    onSubmit = vi
      .fn<(dados: DadosDoFormularioDeEndereco) => Promise<void>>()
      .mockResolvedValue(undefined);
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
    vi.restoreAllMocks();
  });

  // Abre OU reemite: o pai re-renderiza com o objeto que a consulta devolveu.
  async function mostrar(initialData?: Address) {
    const { AddressForm } = await import("@/components/ui/custom/AddressForm");
    await act(async () => {
      raiz.render(
        <AddressForm
          initialData={initialData}
          onSubmit={onSubmit}
          onCancel={vi.fn()}
        />,
      );
    });
    await esvaziar();
  }

  async function salvar() {
    await act(async () => {
      hospedeiro
        .querySelector("form")!
        .dispatchEvent(
          new Event("submit", { bubbles: true, cancelable: true }),
        );
    });
    await esvaziar();
  }

  const valor = (id: string) =>
    (document.getElementById(id) as HTMLInputElement).value;

  const enviado = () => {
    expect(onSubmit).toHaveBeenCalledTimes(1);
    return onSubmit.mock.calls[0][0] as Record<string, unknown>;
  };

  it("o defeito: cache com número 10, chega 100, ela muda só o complemento e salva: o número NOVO vai", async () => {
    await mostrar(casa({ number: "10" }));
    expect(valor("number")).toBe("10");

    // A consulta atualizada: MESMO id, outro objeto, número corrigido.
    await mostrar(casa({ number: "100" }));
    expect(valor("number")).toBe("100");

    await act(async () => {
      digitar("complement", "Apto 3");
    });
    await salvar();

    const dados = enviado();
    expect(dados.number).toBe("100");
    expect(dados.complement).toBe("Apto 3");
  });

  it("controle: campo que ela JÁ editou não é sobrescrito; o que ela não mexeu recebe o valor novo", async () => {
    await mostrar(casa({ number: "10", complement: "" }));
    await act(async () => {
      digitar("number", "55");
    });

    await mostrar(casa({ number: "100", complement: "Bloco B" }));

    expect(valor("number")).toBe("55");
    expect(valor("complement")).toBe("Bloco B");

    await salvar();
    const dados = enviado();
    expect(dados.number).toBe("55");
    expect(dados.complement).toBe("Bloco B");
  });

  it("controle: o MESMO conteúdo reemitido (objeto novo, nada mudou) não zera o que ela digitou", async () => {
    await mostrar(casa());
    await act(async () => {
      digitar("number", "55");
      digitar("complement", "Fundos");
    });

    // Cada leitura do servidor devolve objetos NOVOS, mesmo sem mudança.
    await mostrar(casa());
    await mostrar(casa());

    expect(valor("number")).toBe("55");
    expect(valor("complement")).toBe("Fundos");
    await salvar();
    expect(enviado().number).toBe("55");
  });

  it("controle: o MESMO conteúdo reemitido não apaga o aviso de erro que ela está vendo", async () => {
    await mostrar(casa());
    await act(async () => {
      digitar("number", "");
    });
    await salvar();
    expect(onSubmit).not.toHaveBeenCalled();
    expect(document.getElementById("erro-number")?.textContent).toContain(
      "Número é obrigatório",
    );

    // A releitura de fundo traz o endereço igual: nada deve mudar na tela.
    await mostrar(casa());

    expect(document.getElementById("erro-number")?.textContent).toContain(
      "Número é obrigatório",
    );
  });

  it("controle: OUTRO id reseta como sempre (o que ela digitou no anterior não vale)", async () => {
    await mostrar(casa({ id: "end-a" }));
    await act(async () => {
      digitar("number", "55");
    });

    await mostrar(casa({ id: "end-b", name: "Trabalho", number: "7" }));

    expect(valor("number")).toBe("7");
    await salvar();
    expect(enviado().number).toBe("7");
  });

  it("CEP que ela não tocou: o CEP e o endereço ligado a ele acompanham o servidor", async () => {
    await mostrar(casa());

    await mostrar(
      casa({
        cep: "38500-001",
        street: "Rua Nova",
        neighborhood: "Bairro Novo",
        city: "Uberaba",
        state: "MG",
      }),
    );
    await act(async () => {
      digitar("number", "11");
    });
    await salvar();

    const dados = enviado();
    expect(dados.cep).toBe("38500-001");
    expect(dados.street).toBe("Rua Nova");
    expect(dados.neighborhood).toBe("Bairro Novo");
    expect(dados.city).toBe("Uberaba");
    expect(dados.number).toBe("11");
  });

  it("CEP que ela JÁ trocou: rua, bairro e cidade são do CEP dela, o servidor não escreve por cima (mesmo se a busca trouxe a mesma rua de antes)", async () => {
    // O ViaCEP devolve, para o CEP novo, a MESMA rua do endereço salvo (rua
    // comprida tem vários CEPs): o valor do campo não "parece" mexido.
    vi.stubGlobal(
      "fetch",
      vi.fn(() =>
        Promise.resolve({
          ok: true,
          status: 200,
          json: async () => ({
            logradouro: "Rua do Comércio",
            bairro: "Centro",
            localidade: "Monte Carmelo",
            uf: "MG",
          }),
        }),
      ),
    );
    await mostrar(casa());
    await act(async () => {
      digitar("cep", "38500999");
    });
    await esvaziar();
    expect(valor("cep")).toBe("38500-999");

    // Outro aparelho corrigiu a rua do mesmo endereço.
    await mostrar(casa({ street: "Rua do Comércio Nova" }));

    await salvar();
    const dados = enviado();
    expect(dados.cep).toBe("38500-999");
    expect(dados.street).toBe("Rua do Comércio");
  });

  // CEP, rua, bairro, cidade e UF são UM bloco: quem decide é a pessoa, nas
  // duas direções. Mexeu em qualquer um, o bloco inteiro fica dela (nada do
  // servidor entra, senão sai um endereço misturado: CEP de um lugar com a rua
  // de outro). Não mexeu em nenhum, o bloco inteiro vem do servidor.
  async function abrirOsCampos() {
    const editar = Array.from(hospedeiro.querySelectorAll("button")).find(
      (b) => b.textContent === "Editar",
    );
    expect(editar, "o cartão do endereço tem o botão Editar").toBeDefined();
    await act(async () => {
      editar!.click();
    });
    await esvaziar();
  }

  const servidorMudouTudo = () =>
    casa({
      cep: "38500-001",
      street: "Rua Nova",
      neighborhood: "Bairro Novo",
      city: "Uberaba",
      state: "GO",
    });

  it("bloco do CEP: ela editou SÓ a rua e o servidor trocou CEP, bairro e cidade: o bloco inteiro fica o dela, nada misturado", async () => {
    await mostrar(casa());
    await abrirOsCampos();
    await act(async () => {
      digitar("street", "Rua do Comércio Corrigida");
    });

    await mostrar(servidorMudouTudo());
    await salvar();

    const dados = enviado();
    expect(dados.street).toBe("Rua do Comércio Corrigida");
    expect(dados.cep).toBe("38500-000");
    expect(dados.neighborhood).toBe("Centro");
    expect(dados.city).toBe("Monte Carmelo");
    expect(dados.state).toBe("MG");
  });

  it("bloco do CEP: ela editou SÓ a cidade e o servidor trocou a rua (e o resto): o bloco inteiro fica o dela", async () => {
    await mostrar(casa());
    await abrirOsCampos();
    await act(async () => {
      digitar("city", "Monte Carmelo II");
    });

    await mostrar(servidorMudouTudo());
    await salvar();

    const dados = enviado();
    expect(dados.city).toBe("Monte Carmelo II");
    expect(dados.street).toBe("Rua do Comércio");
    expect(dados.cep).toBe("38500-000");
    expect(dados.neighborhood).toBe("Centro");
    expect(dados.state).toBe("MG");
  });

  it("bloco do CEP: ela editou SÓ a UF e o servidor trocou o resto do bloco: o bloco inteiro fica o dela", async () => {
    await mostrar(casa());
    await abrirOsCampos();
    await act(async () => {
      digitar("state", "SP");
    });

    await mostrar(servidorMudouTudo());
    await salvar();

    const dados = enviado();
    expect(dados.state).toBe("SP");
    expect(dados.cep).toBe("38500-000");
    expect(dados.street).toBe("Rua do Comércio");
    expect(dados.neighborhood).toBe("Centro");
    expect(dados.city).toBe("Monte Carmelo");
  });

  it("bloco do CEP: ela editou SÓ o número e o servidor trocou o bloco todo: o bloco vem do servidor e o número é dela", async () => {
    await mostrar(casa());
    await act(async () => {
      digitar("number", "55");
    });

    await mostrar(servidorMudouTudo());
    await salvar();

    const dados = enviado();
    expect(dados.number).toBe("55");
    expect(dados.cep).toBe("38500-001");
    expect(dados.street).toBe("Rua Nova");
    expect(dados.neighborhood).toBe("Bairro Novo");
    expect(dados.city).toBe("Uberaba");
    expect(dados.state).toBe("GO");
  });

  it("principal: ela não mexeu no botão e o servidor trocou a marca: continua NÃO mandando is_default", async () => {
    await mostrar(casa({ is_default: true }));
    await mostrar(casa({ is_default: false }));
    expect(
      document.getElementById("is_default")!.getAttribute("aria-checked"),
    ).toBe("false");

    await act(async () => {
      digitar("number", "11");
    });
    await salvar();

    expect("is_default" in enviado()).toBe(false);
  });

  it("principal: ela LIGOU o botão de propósito e chega versão nova: a escolha dela fica e vai", async () => {
    await mostrar(casa({ is_default: false }));
    await act(async () => {
      document.getElementById("is_default")!.click();
    });
    expect(
      document.getElementById("is_default")!.getAttribute("aria-checked"),
    ).toBe("true");

    await mostrar(casa({ is_default: false, number: "100" }));

    expect(
      document.getElementById("is_default")!.getAttribute("aria-checked"),
    ).toBe("true");
    expect(valor("number")).toBe("100");
    await salvar();
    expect(enviado().is_default).toBe(true);
  });
});
