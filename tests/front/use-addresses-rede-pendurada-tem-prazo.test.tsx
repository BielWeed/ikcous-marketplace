// @vitest-environment jsdom
//
// Rede "pendurada" (conecta e não responde) nas chamadas de endereço.
//
// Sem prazo, "Salvar" (checkout e Perfil) travava o formulário inteiro e o
// "Editar endereço" abria em "Carregando…" sem botão Voltar. Contrato provado
// aqui, com fake timers e promessa que nunca resolve:
//   - LEITURA (fetchAddresses): estourou -> `loading` solto, `erroAoCarregar`
//     ligado (é ele que faz a tela de Editar mostrar o Voltar) e a lista que
//     já estava na memória fica;
//   - ESCRITA (addAddress / updateAddress): estourou -> null/false, a frase
//     manda CONFERIR A LISTA antes de repetir (o servidor pode ter gravado
//     depois do prazo: repetir às cegas duplica o endereço), e nenhum
//     "sucesso" é avisado;
//   - a escrita que chega DEPOIS do estouro reconcilia a lista (relê do
//     servidor) -- a lista da tela passa a dizer a verdade --, mas só se a
//     conta ainda é a mesma e só se o servidor gravou de fato;
//   - resposta dentro do prazo: comportamento de sempre e nenhum relógio sobra.
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { Address } from "@/types";

const { sessao, toast, supabase, chamadas } = vi.hoisted(() => {
  interface Resultado {
    data: unknown;
    error: unknown;
  }
  interface Chamada {
    op: string | null;
    resolver: (valor: Resultado) => void;
  }
  const chamadas: Chamada[] = [];
  // Promessa REAL (como nos vizinhos): `then` nativo, species nativa.
  class Cadeia extends Promise<Resultado> {
    static override get [Symbol.species]() {
      return Promise;
    }
    registro: Chamada;
    constructor() {
      const registro: Chamada = { op: null, resolver: () => {} };
      super((resolve) => {
        registro.resolver = resolve;
      });
      this.registro = registro;
      chamadas.push(registro);
    }
    private marcar(op: string): Cadeia {
      if (!this.registro.op) this.registro.op = op;
      return this;
    }
    insert(): Cadeia {
      return this.marcar("insert");
    }
    delete(): Cadeia {
      return this.marcar("delete");
    }
    update(): Cadeia {
      return this.marcar("update");
    }
    select(): Cadeia {
      return this.marcar("select");
    }
    eq(): Cadeia {
      return this;
    }
    order(): Cadeia {
      return this;
    }
    single(): Cadeia {
      return this;
    }
  }
  return {
    sessao: { usuario: null as { id: string } | null },
    toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn() },
    supabase: { from: (_tabela: string) => new Cadeia() },
    chamadas,
  };
});

vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({ user: sessao.usuario }),
}));
vi.mock("@/lib/supabase", () => ({ supabase }));
vi.mock("sonner", () => ({ toast }));

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

import { PRAZO_DAS_CHAMADAS_DE_ENDERECO_MS } from "@/hooks/useAddresses";

const END_A: Address = {
  id: "end-a1",
  user_id: "conta-a",
  name: "Casa",
  recipient_name: "Ana",
  cep: "38000-000",
  street: "Rua A",
  number: "10",
  neighborhood: "Centro",
  city: "Uberaba",
  state: "MG",
  is_default: true,
};
const NOVO_A: Omit<Address, "id" | "user_id"> = {
  name: "Trabalho",
  recipient_name: "Ana",
  cep: "38000-000",
  street: "Rua Nova",
  number: "50",
  neighborhood: "Centro",
  city: "Uberaba",
  state: "MG",
  is_default: false,
};
const GRAVADO_A2: Address = { ...NOVO_A, id: "end-a2", user_id: "conta-a" };

interface ContratoHook {
  addresses: Address[];
  loading: boolean;
  erroAoCarregar: boolean;
  fetchAddresses: () => Promise<void>;
  addAddress: (
    endereco: Omit<Address, "id" | "user_id">,
  ) => Promise<Address | null>;
  updateAddress: (id: string, mudancas: Partial<Address>) => Promise<boolean>;
  deleteAddress: (id: string) => Promise<boolean>;
}

const espelho: { hook: ContratoHook | null } = { hook: null };
const modulo: { useAddresses: (() => ContratoHook) | null } = {
  useAddresses: null,
};

function Hospedeiro() {
  espelho.hook = modulo.useAddresses!();
  return null;
}

describe("useAddresses — rede pendurada tem prazo", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;
  let armazem: Map<string, string>;

  beforeEach(() => {
    vi.useFakeTimers();
    armazem = new Map<string, string>();
    vi.stubGlobal("localStorage", {
      getItem: (chave: string) => armazem.get(chave) ?? null,
      setItem: (chave: string, valor: string) => {
        armazem.set(chave, valor);
      },
      removeItem: (chave: string) => {
        armazem.delete(chave);
      },
    });
    armazem.set("ikcous_addresses_cache_conta-a", JSON.stringify([END_A]));
    sessao.usuario = { id: "conta-a" };
    chamadas.length = 0;
    toast.success.mockClear();
    toast.error.mockClear();
    toast.warning.mockClear();
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
    vi.useRealTimers();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  async function renderizar() {
    if (!modulo.useAddresses) {
      modulo.useAddresses = (await import("@/hooks/useAddresses")).useAddresses;
    }
    await act(async () => {
      raiz.render(<Hospedeiro />);
    });
  }

  // Dispara a operação SEM esperá-la (sem prazo ela nunca voltaria) e deixa
  // o teste afirmar "a espera acabou" por uma marca.
  async function iniciar(
    fazer: () => Promise<unknown>,
  ): Promise<{ promessa: Promise<unknown>; marca: { terminou: boolean } }> {
    const entrega: { promessa: Promise<unknown> | null } = { promessa: null };
    await act(async () => {
      entrega.promessa = fazer();
    });
    const marca = { terminou: false };
    void entrega.promessa!.then(() => {
      marca.terminou = true;
    });
    return { promessa: entrega.promessa!, marca };
  }

  async function passar(ms: number) {
    await act(async () => {
      await vi.advanceTimersByTimeAsync(ms);
    });
  }

  async function responder(indice: number, resposta: unknown) {
    await act(async () => {
      chamadas.at(indice)?.resolver(resposta as never);
      await vi.advanceTimersByTimeAsync(0);
    });
  }

  const PRAZO = PRAZO_DAS_CHAMADAS_DE_ENDERECO_MS;

  describe("leitura (fetchAddresses)", () => {
    it("consulta que nunca responde: solta o loading, liga erroAoCarregar e mantém a lista que estava na memória", async () => {
      await renderizar();
      const { marca } = await iniciar(() => espelho.hook!.fetchAddresses());

      await passar(PRAZO - 1);
      expect(marca.terminou).toBe(false);
      expect(espelho.hook!.erroAoCarregar).toBe(false);

      await passar(1);
      expect(marca.terminou).toBe(true);
      expect(espelho.hook!.loading).toBe(false);
      // É este flag que faz a tela de Editar trocar "Carregando…" por
      // "Não conseguimos carregar este endereço." + Voltar.
      expect(espelho.hook!.erroAoCarregar).toBe(true);
      expect(espelho.hook!.addresses).toEqual([END_A]);
      expect(toast.error).toHaveBeenCalledTimes(1);
    });

    it("sem cache (loading ligado): o estouro desliga o loading", async () => {
      armazem.clear();
      await renderizar();
      const { marca } = await iniciar(() => espelho.hook!.fetchAddresses());
      expect(espelho.hook!.loading).toBe(true);

      await passar(PRAZO);
      expect(marca.terminou).toBe(true);
      expect(espelho.hook!.loading).toBe(false);
      expect(espelho.hook!.erroAoCarregar).toBe(true);
    });

    it("resposta dentro do prazo: lista gravada, sem erro e nenhum relógio sobrando", async () => {
      await renderizar();
      const relogiosAntes = vi.getTimerCount();
      const { marca } = await iniciar(() => espelho.hook!.fetchAddresses());
      await responder(0, {
        data: [{ ...END_A, street: "Rua Nova" }],
        error: null,
      });

      expect(marca.terminou).toBe(true);
      expect(espelho.hook!.addresses[0].street).toBe("Rua Nova");
      expect(espelho.hook!.erroAoCarregar).toBe(false);
      expect(toast.error).not.toHaveBeenCalled();
      expect(vi.getTimerCount()).toBeLessThanOrEqual(relogiosAntes);
    });

    it("resposta que chega DEPOIS do estouro é descartada (a tela já deu a leitura por falha)", async () => {
      await renderizar();
      const { marca } = await iniciar(() => espelho.hook!.fetchAddresses());
      await passar(PRAZO);
      expect(marca.terminou).toBe(true);

      await responder(0, { data: [], error: null });
      expect(espelho.hook!.addresses).toEqual([END_A]);
    });

    it("troca de conta durante a espera: o estouro não vira erro nem toast da conta nova", async () => {
      await renderizar();
      const { marca } = await iniciar(() => espelho.hook!.fetchAddresses());
      sessao.usuario = { id: "conta-b" };
      await renderizar();

      await passar(PRAZO);
      expect(marca.terminou).toBe(true);
      expect(espelho.hook!.erroAoCarregar).toBe(false);
      expect(toast.error).not.toHaveBeenCalled();
      expect(espelho.hook!.loading).toBe(false);
    });
  });

  describe("escrita (addAddress)", () => {
    it("insert que nunca responde: devolve null, manda conferir a lista antes de repetir e não avisa sucesso", async () => {
      await renderizar();
      const { promessa, marca } = await iniciar(() =>
        espelho.hook!.addAddress(NOVO_A),
      );
      expect(chamadas[0].op).toBe("insert");

      await passar(PRAZO - 1);
      expect(marca.terminou).toBe(false);

      await passar(1);
      expect(marca.terminou).toBe(true);
      await expect(promessa).resolves.toBeNull();
      expect(toast.success).not.toHaveBeenCalled();
      expect(toast.error).toHaveBeenCalledTimes(1);
      const [frase] = toast.error.mock.calls[0];
      expect(frase).toContain("Confira");
      expect(frase).toContain("antes de tentar de novo");
      // Nada foi inventado na lista nem no disco.
      expect(espelho.hook!.addresses).toEqual([END_A]);
      expect(
        JSON.parse(armazem.get("ikcous_addresses_cache_conta-a")!),
      ).toEqual([END_A]);
    });

    it("insert que o servidor grava DEPOIS do estouro: a lista é relida e passa a conter o endereço (sem 'sucesso' falso)", async () => {
      await renderizar();
      const { marca } = await iniciar(() => espelho.hook!.addAddress(NOVO_A));
      await passar(PRAZO);
      expect(marca.terminou).toBe(true);
      expect(chamadas).toHaveLength(1);

      // A resposta tardia do insert dispara a releitura da lista...
      await responder(0, { data: GRAVADO_A2, error: null });
      expect(chamadas).toHaveLength(2);
      expect(chamadas[1].op).toBe("select");
      // ...e a releitura traz o que o servidor realmente tem.
      await responder(1, { data: [END_A, GRAVADO_A2], error: null });

      expect(espelho.hook!.addresses).toEqual([END_A, GRAVADO_A2]);
      expect(
        JSON.parse(armazem.get("ikcous_addresses_cache_conta-a")!),
      ).toEqual([END_A, GRAVADO_A2]);
      expect(toast.success).not.toHaveBeenCalled();
    });

    it("insert que o servidor RECUSA depois do estouro: nada a reconciliar, nenhuma releitura", async () => {
      await renderizar();
      await iniciar(() => espelho.hook!.addAddress(NOVO_A));
      await passar(PRAZO);

      await responder(0, { data: null, error: { message: "violates rls" } });
      expect(chamadas).toHaveLength(1);
      expect(espelho.hook!.addresses).toEqual([END_A]);
    });

    it("conta trocada durante a espera: sem toast e, se o servidor gravar depois, sem releitura para a conta nova", async () => {
      await renderizar();
      const { promessa } = await iniciar(() =>
        espelho.hook!.addAddress(NOVO_A),
      );
      sessao.usuario = { id: "conta-b" };
      await renderizar();

      await passar(PRAZO);
      await expect(promessa).resolves.toBeNull();
      expect(toast.error).not.toHaveBeenCalled();

      await responder(0, { data: GRAVADO_A2, error: null });
      // Nenhuma leitura nova: soltaria o loading/erro da conta B por engano.
      expect(chamadas).toHaveLength(1);
      expect(espelho.hook!.loading).toBe(false);
    });

    it("resposta dentro do prazo: grava, avisa sucesso e nenhum relógio sobra", async () => {
      await renderizar();
      const relogiosAntes = vi.getTimerCount();
      const { promessa } = await iniciar(() =>
        espelho.hook!.addAddress(NOVO_A),
      );
      await responder(0, { data: GRAVADO_A2, error: null });

      await expect(promessa).resolves.toEqual(GRAVADO_A2);
      expect(toast.success).toHaveBeenCalled();
      expect(toast.error).not.toHaveBeenCalled();
      expect(vi.getTimerCount()).toBeLessThanOrEqual(relogiosAntes);
      // A resposta tardia que não houve não reconcilia nada.
      await passar(PRAZO * 2);
      expect(chamadas).toHaveLength(1);
    });

    it("erro do servidor dentro do prazo continua sendo a mensagem de sempre (não a de 'conexão lenta')", async () => {
      await renderizar();
      const { promessa } = await iniciar(() =>
        espelho.hook!.addAddress(NOVO_A),
      );
      await responder(0, { data: null, error: { message: "boom" } });

      await expect(promessa).resolves.toBeNull();
      expect(toast.error).toHaveBeenCalledWith("Erro ao adicionar endereço");
    });
  });

  describe("excluir e promover", () => {
    it("delete pendurado termina, avisa a incerteza e relê mesmo com resposta tardia sem data", async () => {
      await renderizar();
      const { marca, promessa } = await iniciar(() =>
        espelho.hook!.deleteAddress(END_A.id),
      );
      expect(chamadas[0].op).toBe("delete");
      await passar(PRAZO);
      expect(marca.terminou).toBe(true);
      await expect(promessa).resolves.toBe(false);
      expect(toast.error.mock.calls[0][0]).toContain("antes de tentar de novo");
      expect(toast.success).not.toHaveBeenCalled();
      expect(chamadas[1].op).toBe("select");
      await responder(1, { data: [END_A], error: null });
      await responder(0, { data: null, error: null });
      expect(chamadas[2].op).toBe("select");
      await responder(2, { data: [], error: null });
      expect(espelho.hook!.addresses).toEqual([]);
      expect(toast.success).not.toHaveBeenCalled();
    });

    it("promoção pendurada não prende a exclusão e a confirmação tardia relê o principal real", async () => {
      await renderizar();
      const { marca, promessa } = await iniciar(() =>
        espelho.hook!.deleteAddress(END_A.id),
      );
      await responder(0, { data: null, error: null });
      const restante = { ...GRAVADO_A2, is_default: false };
      await responder(1, { data: [restante], error: null });
      expect(chamadas[2].op).toBe("update");
      await passar(PRAZO);
      expect(marca.terminou).toBe(true);
      await expect(promessa).resolves.toBe(true);
      expect(espelho.hook!.addresses).toEqual([restante]);
      expect(toast.error.mock.calls[0][0]).toContain("antes de tentar de novo");
      await responder(3, {
        data: [{ ...restante, is_default: true }],
        error: null,
      });
      expect(espelho.hook!.addresses[0].is_default).toBe(true);
      const sucessos = toast.success.mock.calls.length;
      await responder(2, { data: null, error: null });
      expect(chamadas[4].op).toBe("select");
      await responder(4, {
        data: [{ ...restante, is_default: true }],
        error: null,
      });
      expect(espelho.hook!.addresses[0].is_default).toBe(true);
      expect(toast.success).toHaveBeenCalledTimes(sucessos);
    });
  });

  describe("escrita (updateAddress)", () => {
    it("update que nunca responde: devolve false e manda conferir o endereço antes de repetir", async () => {
      await renderizar();
      const { promessa, marca } = await iniciar(() =>
        espelho.hook!.updateAddress("end-a1", { street: "Rua Editada" }),
      );
      expect(chamadas[0].op).toBe("update");

      await passar(PRAZO);
      expect(marca.terminou).toBe(true);
      await expect(promessa).resolves.toBe(false);
      expect(toast.success).not.toHaveBeenCalled();
      const [frase] = toast.error.mock.calls[0];
      expect(frase).toContain("Confira");
      expect(frase).toContain("antes de tentar de novo");
      expect(espelho.hook!.addresses).toEqual([END_A]);
    });

    it("update que o servidor grava DEPOIS do estouro: a lista é relida com a versão nova", async () => {
      await renderizar();
      await iniciar(() =>
        espelho.hook!.updateAddress("end-a1", { street: "Rua Editada" }),
      );
      await passar(PRAZO);

      await responder(0, {
        data: { ...END_A, street: "Rua Editada" },
        error: null,
      });
      expect(chamadas[1].op).toBe("select");
      await responder(1, {
        data: [{ ...END_A, street: "Rua Editada" }],
        error: null,
      });

      expect(espelho.hook!.addresses[0].street).toBe("Rua Editada");
      expect(toast.success).not.toHaveBeenCalled();
    });

    it("resposta dentro do prazo: grava e avisa sucesso", async () => {
      await renderizar();
      const { promessa } = await iniciar(() =>
        espelho.hook!.updateAddress("end-a1", { street: "Rua Editada" }),
      );
      await responder(0, {
        data: { ...END_A, street: "Rua Editada" },
        error: null,
      });

      await expect(promessa).resolves.toBe(true);
      expect(espelho.hook!.addresses[0].street).toBe("Rua Editada");
      expect(toast.success).toHaveBeenCalled();
    });
  });
});
