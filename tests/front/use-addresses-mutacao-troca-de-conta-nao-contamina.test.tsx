// @vitest-environment jsdom
//
// Achado [2·BLOQUEANTE] da revisão independente de 22/09/2026
// (ikcous-cep-review.txt): add/update/delete em voo da conta A respondiam
// DEPOIS de a sessão ter trocado para B — liam `prev.itens` DE B, gravavam
// sob `ikcous_addresses_cache_A` e avisavam sucesso: contaminação
// persistida no disco, exposta de volta a A no retorno.
//
// Contrato provado aqui, para cada mutação:
//   1. RESPOSTA COM CONTA TROCADA — A inicia, sessão vira B (cache B
//      semeado), A responde: estado de B, cache_A e cache_B intactos,
//      retorno null/false, nenhum toast; voltando a A, nenhum item de B.
//   2. MESMA CONTA — a operação normal grava estado, cache e avisa.
//
// Padrões de address-form-cep-race.test.tsx: createRoot + act, dublês
// secos, localStorage stubado com um Map, promessa controlada no dublê do
// supabase (uma por mutação, consumida na ordem).
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { Address } from "@/types";

const { sessao, toast, supabase, resolvidores } = vi.hoisted(() => {
  interface Resultado {
    data: unknown;
    error: unknown;
  }
  const resolvidores: ((valor: Resultado) => void)[] = [];
  // Promessa REAL que também encadeia: `then` nativo herdado, nunca
  // propriedade própria — o await de delete (sem .single) usa a Promise.
  class Cadeia extends Promise<Resultado> {
    // then/await derivam a promessa de resultado pela species: NATIVA,
    // nunca uma nova Cadeia (o constructor da subclasse não é um executor
    // externo — derivar por ela quebrava o settle com "not callable").
    static override get [Symbol.species]() {
      return Promise;
    }
    constructor() {
      super((resolve) => {
        resolvidores.push(resolve);
      });
    }
    insert(): Cadeia {
      return this;
    }
    update(): Cadeia {
      return this;
    }
    delete(): Cadeia {
      return this;
    }
    select(): Cadeia {
      return this;
    }
    eq(): Cadeia {
      return this;
    }
    single(): Cadeia {
      return this;
    }
  }
  const supabase = {
    from: (_tabela: string) => new Cadeia(),
  };
  return {
    sessao: { usuario: null as { id: string } | null },
    toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn() },
    supabase,
    resolvidores,
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
const END_B: Address = {
  id: "end-b1",
  user_id: "conta-b",
  name: "Casa B",
  recipient_name: "Bia",
  cep: "01000-000",
  street: "Rua B",
  number: "20",
  neighborhood: "Centro",
  city: "São Paulo",
  state: "SP",
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

type Op = "add" | "update" | "delete";

interface ContratoHook {
  addresses: Address[];
  addAddress: (
    endereco: Omit<Address, "id" | "user_id">,
  ) => Promise<Address | null>;
  updateAddress: (id: string, mudancas: Partial<Address>) => Promise<boolean>;
  deleteAddress: (id: string) => Promise<boolean>;
}

// Hospedeiro ESTÁVEL: uma única identidade de componente para todos os
// renders — trocar de conta re-renderiza a MESMA instância (efeitos de
// atualização; o `usuarioAtualRef` da instância montada vira B), em vez de
// desmontar o hook de A e montar outro.
const espelho: { hook: ContratoHook | null } = { hook: null };
const modulo: { useAddresses: (() => ContratoHook) | null } = {
  useAddresses: null,
};

function Hospedeiro() {
  espelho.hook = modulo.useAddresses!();
  return null;
}

describe("useAddresses — mutação em voo não atravessa troca de conta", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;
  let armazem: Map<string, string>;

  beforeEach(() => {
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
    armazem.set("ikcous_addresses_cache_conta-b", JSON.stringify([END_B]));
    sessao.usuario = { id: "conta-a" };
    resolvidores.length = 0;
    toast.success.mockClear();
    toast.error.mockClear();
    toast.warning.mockClear();
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

  async function renderizar() {
    if (!modulo.useAddresses) {
      modulo.useAddresses = (await import("@/hooks/useAddresses")).useAddresses;
    }
    await act(async () => {
      raiz.render(<Hospedeiro />);
    });
  }

  async function trocarConta(id: string) {
    sessao.usuario = { id };
    await renderizar();
  }

  // Aguarda o PRÓPRIO act (a mutação fica pendente no await do supabase) e
  // devolve a promessa SEM assimilá-la — quem resolve é o teste, depois,
  // com os acts de troca/resolução nunca sobrepostos ao da inicialização.
  async function iniciar(op: Op): Promise<{ promessa: Promise<unknown> }> {
    const hook = espelho.hook!;
    const entrega: { promessa: Promise<unknown> | null } = { promessa: null };
    await act(async () => {
      if (op === "add") entrega.promessa = hook.addAddress(NOVO_A);
      else if (op === "update") {
        entrega.promessa = hook.updateAddress("end-a1", {
          street: "Rua Editada",
        });
      } else {
        entrega.promessa = hook.deleteAddress("end-a1");
      }
    });
    return { promessa: entrega.promessa! };
  }

  function respostaDa(op: Op): { data: unknown; error: unknown } {
    if (op === "add") {
      return {
        data: { ...NOVO_A, id: "end-a2", user_id: "conta-a" },
        error: null,
      };
    }
    if (op === "update") {
      return { data: { ...END_A, street: "Rua Editada" }, error: null };
    }
    return { data: null, error: null };
  }

  async function resolverEmVoo(op: Op) {
    await act(async () => {
      resolvidores.shift()!(respostaDa(op));
      for (let i = 0; i < 10; i++) await Promise.resolve();
    });
  }

  it.each(["add", "update", "delete"] as const)(
    "resposta de %s da conta A não muda B, não grava disco, não avisa, não retorna sucesso",
    async (op) => {
      await renderizar();
      expect(espelho.hook!.addresses).toEqual([END_A]);

      const { promessa } = await iniciar(op);
      await trocarConta("conta-b");
      expect(espelho.hook!.addresses).toEqual([END_B]);

      await resolverEmVoo(op);

      expect(await promessa).toBe(op === "add" ? null : false);
      expect(toast.success).not.toHaveBeenCalled();
      expect(toast.error).not.toHaveBeenCalled();
      expect(espelho.hook!.addresses).toEqual([END_B]);
      expect(
        JSON.parse(armazem.get("ikcous_addresses_cache_conta-a")!),
      ).toEqual([END_A]);
      expect(
        JSON.parse(armazem.get("ikcous_addresses_cache_conta-b")!),
      ).toEqual([END_B]);

      await trocarConta("conta-a");
      expect(espelho.hook!.addresses).toEqual([END_A]);
      expect(JSON.stringify(espelho.hook!.addresses)).not.toContain("end-b1");
    },
  );

  // Resultado esperado como DADO da parametrização — sem acesso computado
  // (security/detect-object-injection).
  const casosNormais: [Op, Address[]][] = [
    ["add", [END_A, { ...NOVO_A, id: "end-a2", user_id: "conta-a" }]],
    ["update", [{ ...END_A, street: "Rua Editada" }]],
    ["delete", []],
  ];

  it.each(casosNormais)(
    "operação normal: %s na mesma conta grava estado, cache e avisa sucesso",
    async (op, listaEsperada) => {
      await renderizar();
      const { promessa } = await iniciar(op);
      await resolverEmVoo(op);

      expect(await promessa).toBeTruthy();
      expect(espelho.hook!.addresses).toEqual(listaEsperada);
      expect(
        JSON.parse(armazem.get("ikcous_addresses_cache_conta-a")!),
      ).toEqual(listaEsperada);
      expect(toast.success).toHaveBeenCalled();
      expect(toast.error).not.toHaveBeenCalled();
    },
  );
});
