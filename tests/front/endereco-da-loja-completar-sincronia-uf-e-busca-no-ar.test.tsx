// @vitest-environment jsdom
//
// EnderecoDaLoja (Minha loja) — bordas da busca do CEP e da sincronia com o
// que está salvo, que as provas vizinhas não pisam:
//  - sair do campo do CEP sem mudá-lo COMPLETA só o que está vazio (o que a
//    lojista escreveu fica; campo só com espaços conta como vazio);
//  - dado novo que chega do banco troca a tela só se ela não tinha sido mexida;
//  - a UF vira maiúscula e tem no máximo 2 letras (digitada ou colada);
//  - sem cidade salva não há consulta de conferência; com cidade salva há uma;
//  - a busca do CEP nunca avisa por toast (o aviso é da própria tela);
//  - sair do campo do CEP com a mesma busca ainda no ar não dispara outra.
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { MudancaDoEndereco } from "@/components/admin/minha-loja/EnderecoDaLoja";

const toasts = vi.hoisted(() => ({
  success: vi.fn(),
  error: vi.fn(),
  info: vi.fn(),
}));
vi.mock("sonner", () => ({ toast: toasts }));

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const PAULISTA = {
  logradouro: "Avenida Paulista",
  bairro: "Bela Vista",
  localidade: "São Paulo",
  uf: "SP",
};

/** Provedor que responde na hora, com a Paulista, para qualquer CEP. */
function provedorQueResponde() {
  const f = vi.fn(
    async () => new Response(JSON.stringify(PAULISTA), { status: 200 }),
  );
  vi.stubGlobal("fetch", f);
  return f;
}

/** Provedor que nunca responde (a busca fica no ar), como o `fetch` real. */
function provedorQueNaoResponde() {
  const f = vi.fn(
    (_url: string, init?: RequestInit) =>
      new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () =>
          reject(Object.assign(new Error("Aborted"), { name: "AbortError" })),
        );
      }),
  );
  vi.stubGlobal("fetch", f);
  return f;
}

const salvoCompleto = {
  originCep: "01310-100",
  storeAddress:
    "Avenida Paulista, 1578 — Bela Vista, São Paulo/SP — CEP 01310-100",
  storeCity: "São Paulo",
  storeState: "SP",
};

type Salvo = {
  originCep: string | null;
  storeAddress: string | null;
  storeCity: string | null;
  storeState: string | null;
};

describe("EnderecoDaLoja — completar, sincronia, UF e busca no ar", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;
  let onMudou: ReturnType<typeof vi.fn<(m: MudancaDoEndereco) => void>>;

  beforeEach(() => {
    vi.clearAllMocks();
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

  async function renderizar(salvo: Partial<Salvo> = {}) {
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
  const esperar = (ms: number) =>
    act(async () => {
      await new Promise((r) => setTimeout(r, ms));
    });
  const campo = (id: string) =>
    hospedeiro.querySelector(`#${id}`) as HTMLInputElement;

  /** O campo entrega o valor depois de 200 ms parado. */
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
    await esperar(260);
  }
  /** Sai do campo do CEP sem mudá-lo: o campo entrega o valor na saída. */
  async function sairDoCep() {
    await act(async () => {
      campo("endereco-cep").focus();
      campo("endereco-cep").blur();
    });
    await esperar(40);
  }
  const ultima = () => onMudou.mock.calls.at(-1)?.[0];

  describe("sair do CEP sem mudá-lo (completar)", () => {
    // Loja de antes: tem CEP mas não tem cidade nem rua salvas.
    const soComCep = { originCep: "01310-100" };

    it("preenche só o que está vazio: a rua escrita fica, o resto vem do CEP", async () => {
      provedorQueResponde();
      await renderizar(soComCep);
      await digitar("endereco-rua", "Minha Rua Própria");
      await sairDoCep();
      expect(campo("endereco-rua").value).toBe("Minha Rua Própria");
      expect(campo("endereco-bairro").value).toBe("Bela Vista");
      expect(campo("endereco-cidade").value).toBe("São Paulo");
      expect(campo("endereco-uf").value).toBe("SP");
    });

    it("rua só com espaços conta como vazia e é preenchida", async () => {
      provedorQueResponde();
      await renderizar(soComCep);
      await digitar("endereco-rua", "   ");
      await sairDoCep();
      expect(campo("endereco-rua").value).toBe("Avenida Paulista");
      expect(campo("endereco-bairro").value).toBe("Bela Vista");
    });

    it("nenhum aviso de toast sai da busca do CEP", async () => {
      provedorQueResponde();
      await renderizar(soComCep);
      await sairDoCep();
      expect(campo("endereco-bairro").value).toBe("Bela Vista");
      expect(toasts.success).not.toHaveBeenCalled();
      expect(toasts.error).not.toHaveBeenCalled();
      expect(toasts.info).not.toHaveBeenCalled();
    });
  });

  describe("conferência ao abrir a tela", () => {
    it("CEP salvo SEM cidade: não consulta ninguém ao abrir", async () => {
      const f = provedorQueResponde();
      await renderizar({ originCep: "01310-100" });
      await esperar(60);
      expect(f).not.toHaveBeenCalled();
    });

    it("CEP salvo COM cidade: consulta uma vez ao abrir, sem mexer nos campos", async () => {
      const f = provedorQueResponde();
      await renderizar(salvoCompleto);
      await esperar(60);
      expect(f).toHaveBeenCalled();
      expect(campo("endereco-numero").value).toBe("1578");
      expect(campo("endereco-rua").value).toBe("Avenida Paulista");
    });
  });

  describe("aviso de CEP de outra cidade", () => {
    const avisos = () => hospedeiro.querySelectorAll('p[role="status"]');

    it("cidade salva igual à do CEP: nenhum aviso (nem caixa vazia)", async () => {
      provedorQueResponde();
      await renderizar(salvoCompleto);
      await esperar(80);
      expect(avisos()).toHaveLength(0);
    });

    it("cidade salva diferente da do CEP: o aviso aparece, com o texto", async () => {
      provedorQueResponde();
      await renderizar({
        ...salvoCompleto,
        storeAddress:
          "Avenida Paulista, 1578 — Bela Vista, Campinas/SP — CEP 01310-100",
        storeCity: "Campinas",
      });
      await esperar(80);
      expect(avisos()).toHaveLength(1);
      expect(avisos()[0]?.textContent?.trim().length).toBeGreaterThan(10);
    });
  });

  describe("dado novo que chega do banco", () => {
    const outro = {
      originCep: "13010-000",
      storeAddress:
        "Rua Barão de Jaguara, 10 — Centro, Campinas/SP — CEP 13010-000",
      storeCity: "Campinas",
      storeState: "SP",
    };

    it("tela intocada: passa a mostrar o endereço novo", async () => {
      provedorQueNaoResponde();
      await renderizar(salvoCompleto);
      expect(campo("endereco-rua").value).toBe("Avenida Paulista");
      await renderizar(outro);
      expect(campo("endereco-rua").value).toBe("Rua Barão de Jaguara");
      expect(campo("endereco-cidade").value).toBe("Campinas");
      expect(campo("endereco-cep").value).toBe("13010-000");
    });

    it("tela mexida: o que a lojista escreveu não é pisado", async () => {
      provedorQueNaoResponde();
      await renderizar(salvoCompleto);
      await digitar("endereco-rua", "Rua que eu digitei");
      await renderizar(outro);
      expect(campo("endereco-rua").value).toBe("Rua que eu digitei");
      expect(campo("endereco-cidade").value).toBe("São Paulo");
    });
  });

  describe("UF", () => {
    it("o campo aceita 2 letras e o que é digitado vira maiúsculo", async () => {
      provedorQueNaoResponde();
      await renderizar(salvoCompleto);
      expect(campo("endereco-uf").maxLength).toBe(2);
      await digitar("endereco-uf", "mg");
      // o que a tela entrega para gravar é a UF já em maiúsculo
      expect(ultima()?.valores?.storeState).toBe("MG");
    });

    it("UF colada com mais de 2 letras é cortada nas duas primeiras", async () => {
      provedorQueNaoResponde();
      await renderizar(salvoCompleto);
      await digitar("endereco-uf", "mgx");
      // o que a tela entrega para gravar é a UF já em maiúsculo
      expect(ultima()?.valores?.storeState).toBe("MG");
    });
  });

  describe("busca do CEP no ar", () => {
    it("só aparece 'Buscando o CEP…' enquanto a busca está no ar", async () => {
      provedorQueNaoResponde();
      await renderizar({});
      expect(hospedeiro.textContent).not.toContain("Buscando o CEP");
      await digitar("endereco-cep", "01310100");
      expect(hospedeiro.textContent).toContain("Buscando o CEP");
    });

    it("sair do campo do CEP com a mesma busca ainda no ar não dispara outra", async () => {
      const f = provedorQueNaoResponde();
      await renderizar({});
      await digitar("endereco-cep", "01310100");
      const chamadas = f.mock.calls.length;
      expect(chamadas).toBeGreaterThan(0);
      await sairDoCep();
      expect(f.mock.calls.length).toBe(chamadas);
    });

    it("busca que FALHOU: sair do campo do CEP tenta de novo (a lojista não precisa digitar o CEP outra vez)", async () => {
      const f = vi.fn(async () => new Response("erro", { status: 500 }));
      vi.stubGlobal("fetch", f);
      await renderizar({});
      await digitar("endereco-cep", "01310100");
      await esperar(80);
      expect(hospedeiro.textContent).toContain("Não foi possível buscar o CEP");
      const antes = f.mock.calls.length;
      expect(antes).toBeGreaterThan(0);
      await sairDoCep();
      await esperar(80);
      expect(f.mock.calls.length).toBeGreaterThan(antes);
    });

    it("com a busca em andamento o motivo diz para aguardar e nada é entregue para gravar", async () => {
      provedorQueNaoResponde();
      await renderizar(salvoCompleto);
      await digitar("endereco-cep", "13010000");
      expect(ultima()?.motivo).toContain("aguarde a busca do CEP terminar");
      expect(ultima()?.valores).toBeNull();
    });
  });
});
