// @vitest-environment jsdom
//
// EnderecoDaLoja (Minha loja, painel simples §4): a lojista digita o CEP e a
// tela preenche rua, bairro, cidade e UF; falta só o número. Sem ele, não dá
// para salvar e o MOTIVO fica à vista. Com ele, `onMudou` entrega as quatro
// colunas que já existem (originCep, storeAddress, storeCity, storeState).
// Endereço de antes (texto livre) aparece como texto e pede "Confirme pelo
// CEP"; CEP que não existe diz "CEP não encontrado" sem apagar o que estava.
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { MudancaDoEndereco } from "@/components/admin/minha-loja/EnderecoDaLoja";

vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() },
}));

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const ENDERECOS_POR_CEP = new Map<string, Record<string, string>>([
  [
    "01310100",
    {
      logradouro: "Avenida Paulista",
      bairro: "Bela Vista",
      localidade: "São Paulo",
      uf: "SP",
    },
  ],
  [
    "13010000",
    {
      logradouro: "Rua Barão de Jaguara",
      bairro: "Centro",
      localidade: "Campinas",
      uf: "SP",
    },
  ],
]);

function instalarProvedorDeCep() {
  const fetchDeCep = vi.fn(async (url: string) => {
    const cep = /(\d{8})/.exec(url)?.[1] ?? "";
    const endereco = ENDERECOS_POR_CEP.get(cep);
    // Cada provedor diz "esse CEP não existe" do seu jeito (provedores-de-cep):
    // ViaCEP com 200 e `erro`; OpenCEP e AwesomeAPI com 404 e um JSON.
    if (!endereco) {
      if (url.includes("viacep")) {
        return new Response(JSON.stringify({ erro: "true" }), { status: 200 });
      }
      const corpo = url.includes("opencep")
        ? { error: true }
        : { code: "not_found" };
      return new Response(JSON.stringify(corpo), { status: 404 });
    }
    return new Response(JSON.stringify(endereco), { status: 200 });
  });
  vi.stubGlobal("fetch", fetchDeCep);
  return fetchDeCep;
}

describe("EnderecoDaLoja — preenche pelo CEP", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;
  let onMudou: ReturnType<typeof vi.fn<(m: MudancaDoEndereco) => void>>;

  beforeEach(() => {
    instalarProvedorDeCep();
    onMudou = vi.fn<(m: MudancaDoEndereco) => void>();
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

  async function montar(
    salvo: Partial<{
      originCep: string | null;
      storeAddress: string | null;
      storeCity: string | null;
      storeState: string | null;
    }> = {},
  ) {
    const { EnderecoDaLoja } = await import(
      "@/components/admin/minha-loja/EnderecoDaLoja"
    );
    await act(async () => {
      raiz.render(
        <EnderecoDaLoja
          originCep={salvo.originCep ?? null}
          storeAddress={salvo.storeAddress ?? null}
          storeCity={salvo.storeCity ?? null}
          storeState={salvo.storeState ?? null}
          onMudou={onMudou}
        />,
      );
    });
  }

  const campo = (id: string) =>
    hospedeiro.querySelector(`#${id}`) as HTMLInputElement;

  // LocalBufferedInput entrega o valor depois de 200 ms parado (ou no blur).
  async function digitar(id: string, valor: string) {
    const input = campo(id);
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

  async function digitarOCep(cep: string) {
    await digitar("endereco-cep", cep);
    // a busca resolve na fila de promessas
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 20));
    });
  }

  const ultima = () => onMudou.mock.calls.at(-1)?.[0];

  it("digitar o CEP preenche rua, bairro, cidade e UF", async () => {
    await montar();
    await digitarOCep("01310100");

    expect(campo("endereco-rua").value).toBe("Avenida Paulista");
    expect(campo("endereco-bairro").value).toBe("Bela Vista");
    expect(campo("endereco-cidade").value).toBe("São Paulo");
    expect(campo("endereco-uf").value).toBe("SP");
  });

  it("sem número não dá para salvar e o motivo está à vista", async () => {
    await montar();
    await digitarOCep("01310100");

    expect(hospedeiro.textContent).toContain("Falta o número do endereço");
    expect(ultima()?.valores).toBeNull();
    expect(ultima()?.motivo).toMatch(/número/i);
    // digitou algo (o CEP): a tela está alterada, só não está completa
    expect(ultima()?.alterado).toBe(true);
  });

  it("com o número, onMudou entrega as 4 chaves e o motivo some", async () => {
    await montar();
    await digitarOCep("01310100");
    await digitar("endereco-numero", "1578");

    expect(ultima()?.valores).toEqual({
      originCep: "01310-100",
      storeAddress:
        "Avenida Paulista, 1578 — Bela Vista, São Paulo/SP — CEP 01310-100",
      storeCity: "São Paulo",
      storeState: "SP",
    });
    expect(ultima()?.motivo).toBeNull();
    expect(ultima()?.alterado).toBe(true);
    expect(hospedeiro.textContent).not.toContain("Falta o número");
  });

  it("o complemento entra no texto do endereço", async () => {
    await montar();
    await digitarOCep("01310100");
    await digitar("endereco-numero", "1578");
    await digitar("endereco-complemento", "Sala 12");

    expect(ultima()?.valores?.storeAddress).toBe(
      "Avenida Paulista, 1578, Sala 12 — Bela Vista, São Paulo/SP — CEP 01310-100",
    );
  });

  it("endereço salvo no formato novo vem preenchido e NÃO conta como alterado", async () => {
    await montar({
      originCep: "01310-100",
      storeAddress:
        "Avenida Paulista, 1578 — Bela Vista, São Paulo/SP — CEP 01310-100",
      storeCity: "São Paulo",
      storeState: "SP",
    });

    expect(campo("endereco-cep").value).toBe("01310-100");
    expect(campo("endereco-rua").value).toBe("Avenida Paulista");
    expect(campo("endereco-numero").value).toBe("1578");
    expect(campo("endereco-bairro").value).toBe("Bela Vista");
    expect(campo("endereco-cidade").value).toBe("São Paulo");
    expect(campo("endereco-uf").value).toBe("SP");
    expect(ultima()?.alterado).toBe(false);
    expect(ultima()?.motivo).toBeNull();
    expect(hospedeiro.textContent).not.toContain("Confirme pelo CEP");
  });

  it("endereço antigo (texto livre) aparece como texto, com 'Confirme pelo CEP'", async () => {
    await montar({
      originCep: "38500-000",
      storeAddress: "Rua das Flores, 123 - Centro, perto da praça",
      storeCity: "Monte Carmelo",
      storeState: "MG",
    });

    expect(hospedeiro.textContent).toContain(
      "Rua das Flores, 123 - Centro, perto da praça",
    );
    expect(hospedeiro.textContent).toContain("Confirme pelo CEP");
    // nada mudou ainda: o texto antigo continua valendo até ela confirmar
    expect(ultima()?.alterado).toBe(false);
  });

  it("CEP que não existe diz 'CEP não encontrado' e não apaga o que estava", async () => {
    await montar({
      originCep: "01310-100",
      storeAddress:
        "Avenida Paulista, 1578 — Bela Vista, São Paulo/SP — CEP 01310-100",
      storeCity: "São Paulo",
      storeState: "SP",
    });
    await digitarOCep("99999999");

    expect(hospedeiro.textContent).toContain("CEP não encontrado");
    expect(campo("endereco-rua").value).toBe("Avenida Paulista");
    expect(campo("endereco-bairro").value).toBe("Bela Vista");
    expect(campo("endereco-cidade").value).toBe("São Paulo");
    expect(campo("endereco-uf").value).toBe("SP");
  });

  it("avisa, sempre, que as etiquetas do Melhor Envio saem do endereço da conta", async () => {
    await montar();
    expect(hospedeiro.textContent).toContain(
      "as etiquetas saem com o endereço da sua conta Melhor Envio",
    );
    expect(hospedeiro.textContent).toContain("confira se é este mesmo");
  });

  it("CEP salvo de outra cidade que a cadastrada: avisa 'Seu CEP é de Campinas/SP'", async () => {
    await montar({
      originCep: "13010-000",
      storeAddress: null,
      storeCity: "São Paulo",
      storeState: "SP",
    });
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 20));
    });

    expect(hospedeiro.textContent).toContain("Seu CEP é de Campinas/SP");
    expect(hospedeiro.textContent).toContain("São Paulo/SP");
  });

  it("CEP e cidade que combinam: nenhum aviso de divergência", async () => {
    await montar({
      originCep: "01310-100",
      storeAddress: null,
      storeCity: "São Paulo",
      storeState: "SP",
    });
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 20));
    });

    expect(hospedeiro.textContent).not.toContain("Seu CEP é de");
  });

  it("o campo de CEP e os de endereço têm alvo de toque de 44px (h-11)", async () => {
    await montar();
    for (const id of [
      "endereco-cep",
      "endereco-rua",
      "endereco-numero",
      "endereco-complemento",
      "endereco-bairro",
      "endereco-cidade",
      "endereco-uf",
    ]) {
      expect(campo(id).className).toContain("h-11");
    }
  });
});
