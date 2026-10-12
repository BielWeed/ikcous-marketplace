// @vitest-environment jsdom
//
// Redesenho aprovado da tela "Novo endereço" (03/10/2026): CEP primeiro e
// grande; com o CEP achado, rua/bairro/cidade/UF viram um cartão e a pessoa
// completa só o número; apelido em botões Casa/Trabalho/Outro; nome de quem
// recebe já vem com o da conta; CEP não achado (ou de cidade inteira) abre os
// campos à mão com o aviso do que falta — a cliente nunca fica travada; o
// aviso do CEP mora dentro da tela, não em toast.
//
// E a decisão de produto do dono: a busca de CEP vale em TODA loja (antes só
// a de entrega nacional). Toda a config abaixo é de loja LOCAL de propósito.
//
// O que NÃO muda — e é provado aqui — é o objeto entregue a `onSubmit`
// (vira `user_addresses`): mesmas 11 chaves, CEP com hífen ("38500-000").
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

import type { Address } from "@/types";

type EnviarEndereco = (a: Omit<Address, "id" | "user_id">) => Promise<void>;

const { mockConfig } = vi.hoisted(() => ({
  mockConfig: { shippingCoverage: "local", originCep: "38500-000" },
}));

vi.mock("@/contexts/StoreContext", () => ({
  useStore: () => ({ config: mockConfig, isLoaded: true }),
}));

vi.mock("@/lib/supabase", () => ({ supabase: {} }));

vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() },
}));

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

// As 11 chaves que o formulário sempre entregou (e que frete e antifraude
// leem). Se uma sumir ou aparecer outra, o contrato mudou.
const CHAVES_DO_ENDERECO = [
  "city",
  "complement",
  "cep",
  "is_default",
  "name",
  "neighborhood",
  "number",
  "recipient_name",
  "reference",
  "state",
  "street",
].sort();

type Cena = "achou" | "naoExiste" | "cidadeInteira" | "semRede";

const CENAS_POR_CEP = new Map<string, Cena>([
  ["38500000", "achou"],
  ["01310100", "achou"],
  ["38509999", "naoExiste"],
  ["38510000", "cidadeInteira"],
  ["38520000", "semRede"],
]);

const ENDERECOS_ACHADOS = new Map<string, Record<string, string>>([
  [
    "38500000",
    {
      logradouro: "Rua Tiradentes",
      bairro: "Centro",
      localidade: "Monte Carmelo",
      uf: "MG",
    },
  ],
  [
    "01310100",
    {
      logradouro: "Avenida Paulista",
      bairro: "Bela Vista",
      localidade: "São Paulo",
      uf: "SP",
    },
  ],
]);

function responder(url: string) {
  const cep = /(\d{8})/.exec(url)?.[1] ?? "";
  const cena = CENAS_POR_CEP.get(cep);
  if (cena === "semRede") return Promise.reject(new TypeError("offline"));
  const viacep = url.includes("viacep");
  if (cena === "achou") {
    return Promise.resolve({
      ok: true,
      status: 200,
      json: async () => ENDERECOS_ACHADOS.get(cep),
    });
  }
  if (cena === "cidadeInteira") {
    return Promise.resolve({
      ok: true,
      status: 200,
      json: async () => ({
        logradouro: "",
        bairro: "",
        localidade: "Monte Carmelo",
        uf: "MG",
      }),
    });
  }
  // naoExiste (e qualquer CEP fora da tabela): TODOS os provedores dizem que
  // não existe.
  return Promise.resolve(
    viacep
      ? { ok: true, status: 200, json: async () => ({ erro: "true" }) }
      : {
          ok: false,
          status: 404,
          json: async () => ({ error: true, code: "not_found" }),
        },
  );
}

function digitar(id: string, valor: string) {
  const el = document.getElementById(id) as HTMLInputElement;
  const setter = Object.getOwnPropertyDescriptor(
    globalThis.HTMLInputElement.prototype,
    "value",
  )!.set!;
  setter.call(el, valor);
  el.dispatchEvent(new Event("input", { bubbles: true }));
}

function botao(texto: string): HTMLButtonElement {
  const b = [...document.querySelectorAll("button")].find(
    (x) => x.textContent?.trim() === texto,
  );
  if (!b) throw new Error(`botão "${texto}" não existe na tela`);
  return b as HTMLButtonElement;
}

function cartao(): string | null {
  return (
    document.querySelector('[data-testid="cartao-do-endereco"]')?.textContent ??
    null
  );
}

function valor(id: string): string {
  return (document.getElementById(id) as HTMLInputElement).value;
}

async function esvaziar() {
  await act(async () => {
    for (let i = 0; i < 40; i++) await Promise.resolve();
  });
}

async function esperarAte(condicao: () => boolean, timeoutMs = 2000) {
  const inicio = Date.now();
  while (!condicao()) {
    if (Date.now() - inicio > timeoutMs) {
      throw new Error(`esperarAte: não ficou verdadeiro em ${timeoutMs}ms`);
    }
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 10));
    });
  }
}

describe("AddressForm — redesenho: CEP primeiro, cartão, botões, aviso na tela", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;
  let fetchMock: ReturnType<typeof vi.fn>;

  async function renderizar(
    props: {
      initialData?: Address;
      nomeDaConta?: string;
      onSubmit?: Mock<EnviarEndereco>;
    } = {},
  ) {
    const { AddressForm } = await import("@/components/ui/custom/AddressForm");
    const onSubmit =
      props.onSubmit ?? vi.fn<EnviarEndereco>().mockResolvedValue(undefined);
    await act(async () => {
      raiz.render(
        <AddressForm
          initialData={props.initialData}
          nomeDaConta={props.nomeDaConta}
          onSubmit={onSubmit}
          onCancel={vi.fn()}
        />,
      );
    });
    return onSubmit;
  }

  async function buscarCep(cep: string) {
    await act(async () => {
      digitar("cep", cep);
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
  }

  beforeEach(() => {
    vi.clearAllMocks();
    mockConfig.shippingCoverage = "local";
    vi.stubGlobal(
      "ResizeObserver",
      class {
        observe() {}
        unobserve() {}
        disconnect() {}
      },
    );
    fetchMock = vi.fn((url: string) => responder(url));
    vi.stubGlobal("fetch", fetchMock);
    vi.spyOn(console, "error").mockImplementation(() => {});
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

  it("tela aberta: só o CEP aparece (nada de rua, número, apelido), com o atalho para quem não sabe o CEP", async () => {
    await renderizar({ nomeDaConta: "Mariana Lopes" });

    expect(document.getElementById("cep")).not.toBeNull();
    for (const id of [
      "street",
      "number",
      "neighborhood",
      "city",
      "state",
      "recipient_name",
      "name",
    ]) {
      expect(document.getElementById(id), id).toBeNull();
    }
    expect(cartao()).toBeNull();
    expect(hospedeiro.textContent).toContain(
      "Rua, bairro e cidade aparecem aqui",
    );
    const link = hospedeiro.querySelector("a") as HTMLAnchorElement;
    expect(link.textContent).toContain("Não sei meu CEP");
    expect(link.target).toBe("_blank");
    expect(link.rel).toContain("noopener");
  });

  it("CEP achado numa loja LOCAL: rua/bairro/cidade/UF aparecem prontos num cartão e o cursor vai para o número", async () => {
    await renderizar({ nomeDaConta: "Mariana Lopes" });
    await buscarCep("38500000");

    // Decisão do dono: a busca vale em loja que não é de entrega nacional.
    expect(fetchMock).toHaveBeenCalled();
    expect(cartao()).toContain("Rua Tiradentes");
    expect(cartao()).toContain("Centro · Monte Carmelo – MG");
    expect(cartao()).toContain("Achado pelo CEP");
    // Nada de campo de rua: a pessoa só completa o número.
    expect(document.getElementById("street")).toBeNull();
    expect(document.activeElement?.id).toBe("number");
    // Aviso na tela, não em toast.
    const { toast } = await import("sonner");
    expect(toast.success).not.toHaveBeenCalled();
    expect(toast.error).not.toHaveBeenCalled();
  });

  it("durante a busca mostra 'Procurando…' dentro da tela; sem número/destinatário ainda", async () => {
    let liberar: (v: unknown) => void = () => {};
    fetchMock.mockImplementation(
      () =>
        new Promise((resolve) => {
          liberar = resolve;
        }),
    );
    await renderizar();
    await act(async () => {
      digitar("cep", "38500000");
    });

    expect(hospedeiro.textContent).toContain(
      "Procurando o endereço deste CEP…",
    );
    expect(document.getElementById("number")).toBeNull();
    // O botão não salva por cima de uma busca em voo.
    expect(botao("Salvar endereço").disabled).toBe(true);

    liberar({
      ok: true,
      status: 200,
      json: async () => ENDERECOS_ACHADOS.get("38500000"),
    });
    await esvaziar();
    expect(hospedeiro.textContent).not.toContain("Procurando");
    expect(cartao()).toContain("Rua Tiradentes");
  });

  it("destinatário vem com o nome da conta (e continua editável); apelido nasce em Casa", async () => {
    await renderizar({ nomeDaConta: "Mariana Lopes" });
    await buscarCep("38500000");

    expect(valor("recipient_name")).toBe("Mariana Lopes");
    expect(hospedeiro.textContent).toContain("da sua conta");
    expect(botao("Casa").getAttribute("aria-pressed")).toBe("true");
    expect(botao("Trabalho").getAttribute("aria-pressed")).toBe("false");

    await act(async () => {
      digitar("recipient_name", "Dona Maria");
    });
    expect(valor("recipient_name")).toBe("Dona Maria");
    expect(hospedeiro.textContent).not.toContain("da sua conta");
  });

  it("nome da conta que chega DEPOIS preenche; nunca por cima do que a pessoa digitou", async () => {
    const { AddressForm } = await import("@/components/ui/custom/AddressForm");
    const onSubmit = vi.fn<EnviarEndereco>();
    await act(async () => {
      raiz.render(<AddressForm onSubmit={onSubmit} onCancel={vi.fn()} />);
    });
    await buscarCep("38500000");
    expect(valor("recipient_name")).toBe("");

    await act(async () => {
      raiz.render(
        <AddressForm
          nomeDaConta="Mariana Lopes"
          onSubmit={onSubmit}
          onCancel={vi.fn()}
        />,
      );
    });
    expect(valor("recipient_name")).toBe("Mariana Lopes");

    await act(async () => {
      digitar("recipient_name", "Dona Maria");
    });
    await act(async () => {
      raiz.render(
        <AddressForm
          nomeDaConta="Mariana Lopes Silva"
          onSubmit={onSubmit}
          onCancel={vi.fn()}
        />,
      );
    });
    expect(valor("recipient_name")).toBe("Dona Maria");
  });

  it("CONTRATO: salvar entrega o MESMO objeto de hoje — 11 chaves, CEP com hífen, apelido 'Casa'", async () => {
    const onSubmit = await renderizar({ nomeDaConta: "Mariana Lopes" });
    await buscarCep("38500000");
    await act(async () => {
      digitar("number", "1250");
    });
    await salvar();
    await esperarAte(() => onSubmit.mock.calls.length > 0);

    expect(onSubmit).toHaveBeenCalledTimes(1);
    const gravado = onSubmit.mock.calls[0][0];
    expect(Object.keys(gravado).sort()).toEqual(CHAVES_DO_ENDERECO);
    expect(gravado).toEqual({
      name: "Casa",
      cep: "38500-000",
      street: "Rua Tiradentes",
      number: "1250",
      complement: "",
      neighborhood: "Centro",
      city: "Monte Carmelo",
      state: "MG",
      reference: "",
      recipient_name: "Mariana Lopes",
      is_default: false,
    });
    // O que o antifraude exige de `user_addresses`: CEP de 8 dígitos, UF de 2.
    expect(gravado.cep.replace(/\D/g, "")).toHaveLength(8);
    expect(gravado.state).toMatch(/^[A-Z]{2}$/);
  });

  it("sem número: salvar sem o número é recusado ('Número é obrigatório') e nada é gravado", async () => {
    const onSubmit = await renderizar({ nomeDaConta: "Mariana Lopes" });
    await buscarCep("38500000");
    await salvar();
    await esperarAte(() =>
      (hospedeiro.textContent ?? "").includes("Número é obrigatório"),
    );
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("botão 'Sem número' grava S/N (a convenção que a etiqueta de envio já lê)", async () => {
    const onSubmit = await renderizar({ nomeDaConta: "Mariana Lopes" });
    await buscarCep("38500000");
    await act(async () => {
      botao("Sem número").click();
    });
    expect(valor("number")).toBe("S/N");
    expect(botao("Sem número").getAttribute("aria-pressed")).toBe("true");
    await salvar();
    await esperarAte(() => onSubmit.mock.calls.length > 0);
    expect(onSubmit.mock.calls[0][0].number).toBe("S/N");
  });

  it("apelido por botão grava o MESMO texto de antes: Trabalho -> 'Trabalho'", async () => {
    const onSubmit = await renderizar({ nomeDaConta: "Mariana Lopes" });
    await buscarCep("38500000");
    await act(async () => {
      digitar("number", "10");
    });
    await act(async () => {
      botao("Trabalho").click();
    });
    expect(botao("Trabalho").getAttribute("aria-pressed")).toBe("true");
    expect(botao("Casa").getAttribute("aria-pressed")).toBe("false");
    await salvar();
    await esperarAte(() => onSubmit.mock.calls.length > 0);
    expect(onSubmit.mock.calls[0][0].name).toBe("Trabalho");
  });

  it("'Outro' abre o campo de texto e grava o que a pessoa escreveu — sem pular de volta para Casa", async () => {
    const onSubmit = await renderizar({ nomeDaConta: "Mariana Lopes" });
    await buscarCep("38500000");
    await act(async () => {
      digitar("number", "10");
    });
    expect(document.getElementById("name")).toBeNull();

    await act(async () => {
      botao("Outro").click();
    });
    expect(document.getElementById("name")).not.toBeNull();
    expect(valor("name")).toBe("");

    // Digitar "Casa" à mão não pode trocar a escolha para o botão Casa.
    await act(async () => {
      digitar("name", "Casa");
    });
    expect(botao("Outro").getAttribute("aria-pressed")).toBe("true");
    expect(botao("Casa").getAttribute("aria-pressed")).toBe("false");

    await act(async () => {
      digitar("name", "Casa da vó");
    });
    await salvar();
    await esperarAte(() => onSubmit.mock.calls.length > 0);
    expect(onSubmit.mock.calls[0][0].name).toBe("Casa da vó");
  });

  it("'Outro' vazio não salva: pede o nome do endereço", async () => {
    const onSubmit = await renderizar({ nomeDaConta: "Mariana Lopes" });
    await buscarCep("38500000");
    await act(async () => {
      digitar("number", "10");
    });
    await act(async () => {
      botao("Outro").click();
    });
    await salvar();
    await esperarAte(() =>
      (hospedeiro.textContent ?? "").includes("Nome/Apelido é obrigatório"),
    );
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("CEP NÃO encontrado: abre os campos à mão com o aviso na tela, sem toast — e dá para salvar", async () => {
    const onSubmit = await renderizar({ nomeDaConta: "Mariana Lopes" });
    await buscarCep("38509999");

    expect(hospedeiro.textContent).toContain(
      "Não achamos este CEP. Confira os números ou preencha o endereço abaixo.",
    );
    expect(cartao()).toBeNull();
    for (const id of ["street", "number", "neighborhood", "city", "state"]) {
      expect(document.getElementById(id), id).not.toBeNull();
    }
    // O atalho "Não sei meu CEP" continua à mão.
    expect(hospedeiro.querySelector("a")?.textContent).toContain(
      "Não sei meu CEP",
    );
    const { toast } = await import("sonner");
    expect(toast.error).not.toHaveBeenCalled();

    // Nunca travada: preenche à mão e salva.
    await act(async () => {
      digitar("street", "Rua das Acácias");
      digitar("number", "87");
      digitar("neighborhood", "Jardim");
      digitar("city", "Monte Carmelo");
      digitar("state", "MG");
    });
    await salvar();
    await esperarAte(() => onSubmit.mock.calls.length > 0);
    expect(onSubmit.mock.calls[0][0]).toMatchObject({
      cep: "38509-999",
      street: "Rua das Acácias",
      number: "87",
      neighborhood: "Jardim",
      city: "Monte Carmelo",
      state: "MG",
    });
  });

  it("sem rede: o aviso NÃO diz que o CEP não existe, e os campos abrem do mesmo jeito", async () => {
    await renderizar({ nomeDaConta: "Mariana Lopes" });
    await buscarCep("38520000");

    const texto = hospedeiro.textContent ?? "";
    expect(texto).toContain(
      "Não deu para buscar o CEP agora. Preencha o endereço abaixo.",
    );
    expect(texto).not.toContain("Não achamos este CEP");
    expect(document.getElementById("street")).not.toBeNull();
  });

  it("CEP de cidade inteira (sem rua): pede rua e bairro, com cidade e UF já preenchidos — e completar não fecha os campos no meio da digitação", async () => {
    const onSubmit = await renderizar({ nomeDaConta: "Mariana Lopes" });
    await buscarCep("38510000");

    expect(hospedeiro.textContent).toContain(
      "Este CEP não informa a rua e o bairro. Preencha abaixo.",
    );
    expect(cartao()).toBeNull();
    expect(valor("city")).toBe("Monte Carmelo");
    expect(valor("state")).toBe("MG");
    expect(valor("street")).toBe("");
    expect(valor("neighborhood")).toBe("");
    // O cursor vai para o primeiro campo que falta.
    expect(document.activeElement?.id).toBe("street");

    // Completa rua e bairro: o endereço fica completo, mas os campos NÃO
    // viram cartão enquanto a pessoa digita (senão o campo sumiria da mão).
    await act(async () => {
      digitar("street", "Rua Nova");
      digitar("neighborhood", "Centro");
    });
    expect(cartao()).toBeNull();
    expect(valor("street")).toBe("Rua Nova");

    await act(async () => {
      digitar("number", "5");
    });
    await salvar();
    await esperarAte(() => onSubmit.mock.calls.length > 0);
    expect(onSubmit.mock.calls[0][0]).toMatchObject({
      street: "Rua Nova",
      neighborhood: "Centro",
      city: "Monte Carmelo",
      state: "MG",
    });
  });

  it("trocar um CEP que não existe por um que existe volta ao cartão (nunca fica preso nos campos)", async () => {
    await renderizar({ nomeDaConta: "Mariana Lopes" });
    await buscarCep("38509999");
    expect(document.getElementById("street")).not.toBeNull();

    await buscarCep("38500000");
    expect(cartao()).toContain("Rua Tiradentes");
    expect(document.getElementById("street")).toBeNull();
    expect(hospedeiro.textContent).not.toContain("Não achamos este CEP");
  });

  it("editar o CEP apaga o aviso e o cartão antigos até o 8º dígito", async () => {
    await renderizar({ nomeDaConta: "Mariana Lopes" });
    await buscarCep("38509999");
    expect(hospedeiro.textContent).toContain("Não achamos este CEP");

    await act(async () => {
      digitar("cep", "3850999");
    });
    expect(hospedeiro.textContent).not.toContain("Não achamos este CEP");
    expect(document.getElementById("street")).toBeNull();
  });

  it("botão 'Editar' do cartão abre rua, bairro, cidade e UF para corrigir", async () => {
    const onSubmit = await renderizar({ nomeDaConta: "Mariana Lopes" });
    await buscarCep("38500000");
    expect(document.getElementById("street")).toBeNull();

    await act(async () => {
      botao("Editar").click();
    });
    expect(cartao()).toBeNull();
    expect(valor("street")).toBe("Rua Tiradentes");
    expect(valor("neighborhood")).toBe("Centro");
    expect(valor("city")).toBe("Monte Carmelo");
    expect(valor("state")).toBe("MG");

    await act(async () => {
      digitar("street", "Rua Tiradentes Corrigida");
      digitar("number", "9");
    });
    await salvar();
    await esperarAte(() => onSubmit.mock.calls.length > 0);
    expect(onSubmit.mock.calls[0][0].street).toBe("Rua Tiradentes Corrigida");
  });

  it("endereço de OUTRO CEP não sobrevive a um CEP que a busca não achou (edição)", async () => {
    const salvo: Address = {
      id: "addr-1",
      user_id: "user-1",
      name: "Casa",
      cep: "01310-100",
      street: "Avenida Paulista",
      number: "100",
      complement: "",
      neighborhood: "Bela Vista",
      city: "São Paulo",
      state: "SP",
      reference: "",
      recipient_name: "Cliente Teste",
      is_default: true,
    };
    await renderizar({ initialData: salvo });
    expect(cartao()).toContain("Avenida Paulista");
    // Endereço salvo: sem selo "Achado pelo CEP" (nenhuma busca rodou).
    expect(cartao()).not.toContain("Achado pelo CEP");
    expect(valor("recipient_name")).toBe("Cliente Teste");

    await buscarCep("38509999");

    // A rua e a cidade eram do CEP antigo: não podem ficar coladas ao CEP novo.
    expect(valor("street")).toBe("");
    expect(valor("neighborhood")).toBe("");
    expect(valor("city")).toBe("");
    expect(valor("state")).toBe("");
    expect(document.body.textContent).not.toContain("Avenida Paulista");
  });

  it("edição de apelido personalizado: 'Escritório' abre em Outro com o texto salvo", async () => {
    const salvo: Address = {
      id: "addr-2",
      user_id: "user-1",
      name: "Escritório",
      cep: "01310-100",
      street: "Avenida Paulista",
      number: "100",
      complement: "Sala 3",
      neighborhood: "Bela Vista",
      city: "São Paulo",
      state: "SP",
      reference: "Perto do metrô",
      recipient_name: "Cliente Teste",
      is_default: false,
    };
    await renderizar({ initialData: salvo });

    expect(botao("Outro").getAttribute("aria-pressed")).toBe("true");
    expect(valor("name")).toBe("Escritório");
    // Referência salva já vem aberta; complemento também.
    expect(valor("reference")).toBe("Perto do metrô");
    expect(valor("complement")).toBe("Sala 3");
  });

  it("botão Salvar fica apagado antes do CEP completo, mas tocar nele mostra o que falta", async () => {
    const onSubmit = await renderizar();
    const salvarBtn = botao("Salvar endereço");
    expect(salvarBtn.disabled).toBe(false);

    await salvar();
    await esperarAte(() =>
      (hospedeiro.textContent ?? "").includes("CEP inválido"),
    );
    expect(onSubmit).not.toHaveBeenCalled();
  });
});
