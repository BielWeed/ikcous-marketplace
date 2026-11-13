// @vitest-environment jsdom
//
// Endereço novo marcado como principal toma a marca do anterior TAMBÉM na
// lista que a cliente vê. O banco desmarca o antigo por gatilho
// (`handle_default_address`), mas a lista local é atualizada sem reler: se ela
// continuasse com dois principais, o checkout pré-selecionaria o endereço
// errado até a próxima leitura. O dublê só devolve a linha como o banco
// devolveria; o hook é o real.
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useAddresses } from "@/hooks/useAddresses";

type Resultado = { data: unknown; error: unknown };

const banco = vi.hoisted(() => ({
  leituras: [] as Array<(r: { data: unknown; error: unknown }) => void>,
  insercoes: [] as Array<Record<string, unknown>>,
}));

vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({ user: { id: "conta-a" } }),
}));

vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn() },
}));

vi.mock("@/lib/supabase", () => ({
  supabase: {
    from: () => ({
      select: () => {
        const promessa = new Promise<Resultado>((resolve) => {
          banco.leituras.push(resolve);
        });
        const cadeia: any = Object.assign(promessa, {
          eq: () => cadeia,
          order: () => cadeia,
        });
        return cadeia;
      },
      insert: (linha: Record<string, unknown>) => {
        banco.insercoes.push(linha);
        return {
          select: () => ({
            single: async () => ({
              data: { id: `novo-${banco.insercoes.length}`, ...linha },
              error: null,
            }),
          }),
        };
      },
    }),
  },
}));

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

type Hook = ReturnType<typeof useAddresses>;

const ENDERECO_NOVO = {
  name: "Trabalho",
  recipient_name: "Ana",
  cep: "38500-000",
  street: "Rua do Comércio",
  number: "10",
  complement: null,
  neighborhood: "Centro",
  city: "Monte Carmelo",
  state: "MG",
  reference: null,
  is_default: false,
};

const CASA = {
  id: "end-casa",
  user_id: "conta-a",
  name: "Casa",
  recipient_name: "Ana",
  cep: "38500-001",
  street: "Rua Principal",
  number: "100",
  complement: null,
  neighborhood: "Centro",
  city: "Monte Carmelo",
  state: "MG",
  reference: null,
  is_default: true,
};

const SITIO = {
  ...CASA,
  id: "end-sitio",
  name: "Sítio",
  street: "Estrada Velha",
  is_default: false,
};

describe("addAddress — o novo principal desmarca o anterior na lista local", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;
  let atual: Hook | undefined;

  function Sonda() {
    guardar(useAddresses());
    return null;
  }
  function guardar(hook: Hook) {
    atual = hook;
  }
  const tela = (): Hook => {
    if (!atual) throw new Error("tela não montada");
    return atual;
  };

  beforeEach(async () => {
    banco.leituras.length = 0;
    banco.insercoes.length = 0;
    atual = undefined;
    localStorage.clear();
    vi.spyOn(console, "error").mockImplementation(() => {});
    hospedeiro = document.createElement("div");
    document.body.appendChild(hospedeiro);
    raiz = createRoot(hospedeiro);
    await act(async () => {
      raiz.render(<Sonda />);
    });
  });

  afterEach(() => {
    act(() => raiz.unmount());
    hospedeiro.remove();
    localStorage.clear();
    vi.restoreAllMocks();
  });

  async function ler(resultado: Resultado) {
    let leitura!: Promise<void>;
    await act(async () => {
      leitura = tela().fetchAddresses();
    });
    const resolver = banco.leituras.shift();
    expect(resolver).toBeDefined();
    await act(async () => {
      resolver!(resultado);
      await leitura;
    });
  }

  async function salvar(dados: typeof ENDERECO_NOVO) {
    await act(async () => {
      await tela().addAddress(dados);
    });
  }

  it("lista com a casa principal + novo marcado principal: sobra UM principal, o novo", async () => {
    await ler({ data: [CASA, SITIO], error: null });
    expect(
      tela()
        .addresses.filter((a) => a.is_default)
        .map((a) => a.id),
    ).toEqual(["end-casa"]);

    await salvar({ ...ENDERECO_NOVO, is_default: true });

    const principais = tela().addresses.filter((a) => a.is_default);
    expect(principais.map((a) => a.name)).toEqual(["Trabalho"]);
    // Os outros continuam na lista, só sem a marca.
    expect(
      tela()
        .addresses.map((a) => a.name)
        .sort(),
    ).toEqual(["Casa", "Sítio", "Trabalho"]);
  });

  it("CONTROLE: novo sem marca de principal não tira a marca da casa", async () => {
    await ler({ data: [CASA], error: null });

    await salvar({ ...ENDERECO_NOVO, is_default: false });

    const principais = tela().addresses.filter((a) => a.is_default);
    expect(principais.map((a) => a.id)).toEqual(["end-casa"]);
    expect(tela().addresses).toHaveLength(2);
  });
});
