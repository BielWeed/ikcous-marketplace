// @vitest-environment jsdom
//
// Endereço novo (`addAddress`) quando a conexão CAI no meio (27/11/2026). No
// iPhone, trocar de app durante o "Salvar" derruba o fetch na hora: o
// supabase-js não lança, devolve `{ error: { message: "TypeError: Load
// failed", code: "" } }` (postgrest-js 2.117.2), e o servidor PODE já ter
// gravado. Antes, só o prazo esgotado era tratado como incerto: a queda rápida
// dizia "Erro ao adicionar endereço", a cliente salvava de novo e o endereço
// entrava duas vezes. Agora a queda segue o ramo do prazo: manda conferir a
// lista antes de repetir e RELÊ a lista do servidor.
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

describe("useAddresses — a conexão cai no meio do Salvar", () => {
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

  async function responder(indice: number, resposta: unknown) {
    await act(async () => {
      chamadas.at(indice)?.resolver(resposta as never);
      await vi.advanceTimersByTimeAsync(0);
    });
  }

  const quedaDoFetch = {
    data: null,
    error: {
      message: "TypeError: Load failed",
      details: "TypeError: Load failed",
      hint: "",
      code: "",
    },
  };

  it("a conexão caiu: não diz 'erro', manda conferir a lista e relê do servidor", async () => {
    await renderizar();
    const { promessa } = await iniciar(() => espelho.hook!.addAddress(NOVO_A));
    expect(chamadas[0].op).toBe("insert");

    await responder(0, quedaDoFetch);

    await expect(promessa).resolves.toBeNull();
    expect(toast.success).not.toHaveBeenCalled();
    expect(toast.error).toHaveBeenCalledTimes(1);
    const [frase] = toast.error.mock.calls[0];
    expect(frase).not.toBe("Erro ao adicionar endereço");
    expect(frase).toContain("Confira");
    expect(frase).toContain("antes de tentar de novo");

    // A releitura traz o que o servidor realmente gravou.
    expect(chamadas).toHaveLength(2);
    expect(chamadas[1].op).toBe("select");
    await responder(1, { data: [END_A, GRAVADO_A2], error: null });
    expect(espelho.hook!.addresses).toEqual([END_A, GRAVADO_A2]);
  });

  it("controle: erro HTTP com corpo e sem código segue 'Erro ao adicionar endereço', sem releitura", async () => {
    await renderizar();
    const { promessa } = await iniciar(() => espelho.hook!.addAddress(NOVO_A));
    await responder(0, {
      data: null,
      error: { message: "Bad Gateway", details: "", hint: "", code: "" },
    });

    await expect(promessa).resolves.toBeNull();
    expect(toast.error).toHaveBeenCalledWith("Erro ao adicionar endereço");
    expect(chamadas).toHaveLength(1);
  });

  it("a conta trocou antes de a queda chegar: sem aviso e sem releitura para a conta nova", async () => {
    await renderizar();
    const { promessa } = await iniciar(() => espelho.hook!.addAddress(NOVO_A));
    sessao.usuario = { id: "conta-b" };
    await renderizar();

    await responder(0, quedaDoFetch);

    await expect(promessa).resolves.toBeNull();
    expect(toast.error).not.toHaveBeenCalled();
    expect(chamadas).toHaveLength(1);
  });
});
