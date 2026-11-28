// @vitest-environment jsdom
//
// ENDEREÇOS NÃO SOMEM NA JANELA EM QUE O TOKEN NÃO RENOVOU (caça 28/11/2026).
//
// A cliente volta ao app depois de horas; a renovação do token falha uns
// segundos e o supabase-js 2.117 guarda a falha por 60 s: `getSession()` dá
// `session: null` com erro de rede, sem SIGNED_OUT. A consulta sai com a chave
// anônima e a RLS devolve `[]`. A leitura tratava esse `[]` como "lida e
// confirmada": gravava a lista vazia no aparelho, espalhava para as outras
// telas, e o checkout perdia o endereço de entrega (e o frete). Se a cliente
// recadastrava, o endereço duplicava.
//
// Regra: lista vazia só vale com a sessão da DONA. Sem ela a lista e a cópia
// ficam, nada é marcado como confirmado, e a leitura se refaz quando a sessão
// desta conta volta (TOKEN_REFRESHED/SIGNED_IN).
import { AuthRetryableFetchError } from "@supabase/supabase-js";
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useAddresses } from "@/hooks/useAddresses";
import { enderecoDeEntregaEfetivo } from "@/lib/endereco-de-entrega";

type Ouvinte = (evento: string, sessao: unknown) => void;

const estado = vi.hoisted(() => ({
  linhas: [] as unknown[],
  leituras: 0,
  insercoes: [] as Array<Record<string, unknown>>,
  sessaoDe: "conta-a" as string | null,
  erroDaSessao: null as unknown,
  ouvintes: new Set<(evento: string, sessao: unknown) => void>(),
}));

vi.mock("@/hooks/useAuth", () => {
  const user = { id: "conta-a" };
  return { useAuth: () => ({ user }) };
});

vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn() },
}));

vi.mock("@/lib/supabase", () => ({
  supabase: {
    from: () => ({
      select: () => {
        const cadeia: any = {
          eq: () => cadeia,
          order: () => cadeia,
          // biome-ignore lint/suspicious/noThenProperty: mock de consulta precisa ser awaitable
          then: (
            res: (v: unknown) => unknown,
            rej: (r: unknown) => unknown,
          ) => {
            estado.leituras += 1;
            return Promise.resolve({
              data: [...estado.linhas],
              error: null,
            }).then(res, rej);
          },
        };
        return cadeia;
      },
      insert: (linha: Record<string, unknown>) => {
        estado.insercoes.push(linha);
        return {
          select: () => ({
            single: async () => ({
              data: { id: `novo-${estado.insercoes.length}`, ...linha },
              error: null,
            }),
          }),
        };
      },
    }),
    auth: {
      getSession: async () => ({
        data: {
          session: estado.sessaoDe ? { user: { id: estado.sessaoDe } } : null,
        },
        error: estado.erroDaSessao,
      }),
      onAuthStateChange: (ouvinte: Ouvinte) => {
        estado.ouvintes.add(ouvinte);
        return {
          data: {
            subscription: {
              unsubscribe: () => {
                estado.ouvintes.delete(ouvinte);
              },
            },
          },
        };
      },
    },
  },
}));

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

type Hook = ReturnType<typeof useAddresses>;

const CACHE = "ikcous_addresses_cache_conta-a";

const CASA = {
  id: "end-casa",
  user_id: "conta-a",
  name: "Casa",
  recipient_name: "Ana Teste",
  cep: "38500-001",
  street: "Rua Inventada",
  number: "100",
  complement: null,
  neighborhood: "Centro",
  city: "Cidade Exemplo",
  state: "MG",
  reference: null,
  is_default: true,
};
const TRABALHO = {
  ...CASA,
  id: "end-trabalho",
  name: "Trabalho",
  street: "Avenida Fictícia",
  is_default: false,
};

const deixarAndar = () => new Promise((r) => setTimeout(r, 0));

function avisar(evento: string, userId: string | null) {
  for (const ouvinte of [...estado.ouvintes]) {
    ouvinte(evento, userId ? { user: { id: userId } } : null);
  }
}

function renovacaoFalhando() {
  estado.sessaoDe = null;
  estado.erroDaSessao = new AuthRetryableFetchError("Failed to fetch", 0);
}

function renovacaoVoltou() {
  estado.sessaoDe = "conta-a";
  estado.erroDaSessao = null;
}

describe("useAddresses — lista vazia sem a sessão da dona não apaga os endereços", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;
  const telas = new Map<string, Hook>();

  function Sonda({ nome }: { readonly nome: string }) {
    guardar(nome, useAddresses());
    return null;
  }
  function guardar(nome: string, hook: Hook) {
    telas.set(nome, hook);
  }
  const tela = (nome: string): Hook => {
    const hook = telas.get(nome);
    if (!hook) throw new Error(`tela '${nome}' não montada`);
    return hook;
  };

  async function montar(...nomes: string[]) {
    await act(async () => {
      raiz.render(
        <div>
          {nomes.map((n) => (
            <Sonda key={n} nome={n} />
          ))}
        </div>,
      );
    });
  }

  beforeEach(() => {
    estado.linhas = [];
    estado.leituras = 0;
    estado.insercoes.length = 0;
    estado.ouvintes.clear();
    renovacaoVoltou();
    telas.clear();
    localStorage.clear();
    vi.spyOn(console, "error").mockImplementation(() => {});
    hospedeiro = document.createElement("div");
    document.body.appendChild(hospedeiro);
    raiz = createRoot(hospedeiro);
  });

  afterEach(() => {
    act(() => raiz.unmount());
    hospedeiro.remove();
    localStorage.clear();
    vi.restoreAllMocks();
  });

  it("renovação falhou: o [] não apaga a lista, a cópia nem o endereço do checkout", async () => {
    localStorage.setItem(CACHE, JSON.stringify([CASA]));
    await montar("carrinho", "checkout");
    expect(enderecoDeEntregaEfetivo(tela("checkout").addresses, null)?.id).toBe(
      "end-casa",
    );

    renovacaoFalhando();
    let lida = false;
    await act(async () => {
      await tela("carrinho").fetchAddresses({
        aoLer: () => {
          lida = true;
        },
      });
    });

    expect(lida).toBe(false);
    expect(tela("carrinho").addresses.map((a) => a.id)).toEqual(["end-casa"]);
    expect(tela("checkout").addresses.map((a) => a.id)).toEqual(["end-casa"]);
    expect(enderecoDeEntregaEfetivo(tela("checkout").addresses, null)?.id).toBe(
      "end-casa",
    );
    expect(JSON.parse(localStorage.getItem(CACHE)!)).toHaveLength(1);
  });

  it("sem cópia no aparelho: vira falha (não 'nenhum endereço') e o 1º novo não é forçado a principal", async () => {
    await montar("perfil");
    renovacaoFalhando();
    await act(async () => {
      await tela("perfil").fetchAddresses();
    });

    expect(tela("perfil").erroAoCarregar).toBe(true);
    expect(localStorage.getItem(CACHE)).toBeNull();

    renovacaoVoltou();
    await act(async () => {
      await tela("perfil").addAddress({ ...TRABALHO, is_default: false });
    });
    // A lista não foi CONFIRMADA vazia: o novo não toma a marca da casa.
    expect(estado.insercoes.at(-1)?.is_default).toBe(false);
  });

  it("renovação voltou (TOKEN_REFRESHED da mesma conta): relê uma vez e traz a lista", async () => {
    localStorage.setItem(CACHE, JSON.stringify([CASA]));
    await montar("carrinho");
    renovacaoFalhando();
    await act(async () => {
      await tela("carrinho").fetchAddresses({ silencioso: true });
    });
    const leiturasAntes = estado.leituras;

    await act(async () => {
      avisar("TOKEN_REFRESHED", "outra-conta");
      await deixarAndar();
    });
    expect(estado.leituras).toBe(leiturasAntes);

    renovacaoVoltou();
    estado.linhas = [CASA, TRABALHO];
    await act(async () => {
      avisar("TOKEN_REFRESHED", "conta-a");
      await deixarAndar();
      await deixarAndar();
    });

    expect(estado.leituras).toBe(leiturasAntes + 1);
    expect(tela("carrinho").addresses.map((a) => a.id)).toEqual([
      "end-casa",
      "end-trabalho",
    ]);
    expect(tela("carrinho").erroAoCarregar).toBe(false);

    // Sem laço: o próximo aviso não relê de novo.
    await act(async () => {
      avisar("TOKEN_REFRESHED", "conta-a");
      avisar("SIGNED_IN", "conta-a");
      await deixarAndar();
    });
    expect(estado.leituras).toBe(leiturasAntes + 1);
  });

  it("lista vazia COM a sessão da dona é confirmada: o 1º endereço vira o principal", async () => {
    await montar("perfil");
    let lida: unknown = null;
    await act(async () => {
      await tela("perfil").fetchAddresses({
        aoLer: (lista) => {
          lida = lista;
        },
      });
    });
    expect(lida).toEqual([]);
    expect(tela("perfil").erroAoCarregar).toBe(false);
    expect(localStorage.getItem(CACHE)).toBe("[]");

    await act(async () => {
      await tela("perfil").addAddress({ ...TRABALHO, is_default: false });
    });
    expect(estado.insercoes.at(-1)?.is_default).toBe(true);
  });
});
