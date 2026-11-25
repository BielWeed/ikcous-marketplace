// @vitest-environment jsdom
//
// Caça de provas fracas (24/11/2026), papéis: reabrir a tela com a leitura de
// `dono_da_loja` JÁ guardada não pode mostrar, nem por um quadro, um estado
// diferente do guardado.
//   - recusa definitiva guardada (leitura negada, 42501): o estado inicial do
//     render precisa nascer como "não consegui ler" e travado. Se nascesse como
//     "a loja não tem dono" (tabela vazia), as chaves de pagamento ficariam
//     LIBERADAS por um quadro até o efeito corrigir — trava que abre na dúvida;
//   - dono já lido: nunca volta a "carregando" ao reabrir (o botão de promover
//     não pisca).
// O teste vizinho (`quais-recusas-ficam-guardadas`) só olha o estado FINAL,
// depois dos efeitos; aqui cada quadro commitado é conferido.
// Ids fictícios; nenhuma chamada de rede.
import { act, useEffect } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  uid: "dono-ficticio" as string | null,
  from: vi.fn(),
  resposta: undefined as unknown,
}));

vi.mock("@/lib/supabase", () => ({
  supabase: { from: (...args: unknown[]) => h.from(...args) },
}));
// Objeto estável: um novo a cada render reiniciaria o efeito do hook.
const SESSAO = { user: { id: "dono-ficticio" } };
vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => SESSAO,
}));

import {
  type EstadoDoDono,
  limparDonoDaLoja,
  useDonoDaLoja,
} from "@/hooks/useDonoDaLoja";
import {
  type PodeTrocarCredenciais,
  usePodeTrocarCredenciais,
} from "@/hooks/usePodeTrocarCredenciais";

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

interface Quadro {
  readonly dono: EstadoDoDono;
  readonly trava: PodeTrocarCredenciais;
}

let quadros: Quadro[] = [];
function Sonda() {
  const dono = useDonoDaLoja();
  const trava = usePodeTrocarCredenciais(
    "Só o dono da loja troca estas chaves.",
  );
  useEffect(() => {
    quadros.push({ dono, trava });
  });
  return null;
}

let raiz: Root;
let hospedeiro: HTMLDivElement;

async function montar() {
  raiz = createRoot(hospedeiro);
  await act(async () => {
    raiz.render(<Sonda />);
  });
  await act(async () => {
    await new Promise((r) => setTimeout(r, 5));
  });
}

async function desmontar() {
  await act(async () => raiz.unmount());
}

beforeEach(() => {
  quadros = [];
  limparDonoDaLoja();
  h.from.mockReset();
  h.from.mockImplementation(() => ({
    select: () => ({ maybeSingle: () => Promise.resolve(h.resposta) }),
  }));
  hospedeiro = document.createElement("div");
  document.body.appendChild(hospedeiro);
});

afterEach(async () => {
  await desmontar();
  hospedeiro.remove();
});

describe("useDonoDaLoja: reabrir com a leitura guardada não pisca", () => {
  it("recusa guardada (42501): todos os quadros da reabertura seguem travados, em 'não consegui ler'", async () => {
    h.resposta = {
      data: null,
      error: { code: "42501", message: "leitura negada" },
    };
    await montar();
    await desmontar();

    quadros = [];
    await montar();

    expect(h.from).toHaveBeenCalledTimes(1);
    expect(quadros.length).toBeGreaterThan(0);
    for (const quadro of quadros) {
      expect(quadro.dono).toMatchObject({
        carregando: false,
        souODono: false,
        leituraFalhou: true,
      });
      expect(quadro.trava.travado).toBe(true);
    }
  });

  it("dono já lido: nenhum quadro da reabertura volta a 'carregando'", async () => {
    h.resposta = { data: { user_id: "dono-ficticio" }, error: null };
    await montar();
    await desmontar();

    quadros = [];
    await montar();

    expect(h.from).toHaveBeenCalledTimes(1);
    expect(quadros.length).toBeGreaterThan(0);
    for (const quadro of quadros) {
      expect(quadro.dono).toMatchObject({
        carregando: false,
        souODono: true,
        leituraFalhou: false,
      });
      expect(quadro.trava.travado).toBe(false);
    }
  });

  it("controle: na PRIMEIRA abertura (nada guardado) o primeiro quadro é 'carregando' e travado", async () => {
    h.resposta = { data: { user_id: "dono-ficticio" }, error: null };
    await montar();

    expect(quadros[0].dono.carregando).toBe(true);
    expect(quadros[0].trava.travado).toBe(true);
    expect(quadros.at(-1)?.dono).toMatchObject({
      carregando: false,
      souODono: true,
    });
  });
});
