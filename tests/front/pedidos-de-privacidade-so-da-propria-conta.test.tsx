// @vitest-environment jsdom
//
// Onda 119 (achado 1 de exclusao-de-conta-lgpd): a policy de SELECT de
// `pedidos_de_privacidade` (migration 20261238000000) deixa o ADMIN atual ler os
// pedidos de TODAS as clientes (`user_id = auth.uid() OR rls_admin_atual()`).
// Entao o unico freio do lado do app, na tela "Privacidade e meus dados" que o
// admin abre na conta de cliente dele, e o `.eq("user_id", userId)` do hook
// `usePedidosDePrivacidade`. Sem ele:
//   - a tela do admin mostra o e-mail novo pedido por OUTRA cliente e a
//     observacao que a loja escreveu para ela;
//   - `ultimoPedidoDoTipo` escolhe o mais recente de TODAS as contas, a tela diz
//     "pedido aberto" que nao e dele e esconde o botao de pedir.
//
// O teste vizinho (privacidade-e-meus-dados) usa um `eq: () => ...` que ignora
// (coluna, valor): apagar o filtro nao deixava nada vermelho. Aqui o duble guarda
// as linhas de DUAS contas, aplica o `eq` de verdade (so devolve as que casam) e
// registra cada consulta que chegou ao banco.
import { PrivacidadeEMeusDados } from "@/components/account/PrivacidadeEMeusDados";
import { usePedidosDePrivacidade } from "@/hooks/usePedidosDePrivacidade";
import {
  type PedidoDePrivacidade,
  ultimoPedidoDoTipo,
} from "@/lib/pedidos-de-privacidade";
import { act, useEffect } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// @ts-expect-error flag interna do React, sem tipo publico.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}
vi.stubGlobal("ResizeObserver", ResizeObserverStub);

const ADMIN = "admin-1";
const OUTRA = "cliente-2";
const EMAIL_DA_OUTRA = "outra.cliente@exemplo.com";
const OBSERVACAO_PARA_A_OUTRA = "Atendido: conta da outra cliente anonimizada";

type Consulta = {
  tabela: string;
  colunas: string;
  filtros: { coluna: string; valor: unknown }[];
};

const mundo = vi.hoisted(() => ({
  linhas: [] as Record<string, unknown>[],
  consultas: [] as Consulta[],
}));

vi.mock("@/lib/supabase", () => ({
  supabase: {
    from: (tabela: string) => ({
      select: (colunas: string) => {
        const filtros: { coluna: string; valor: unknown }[] = [];
        const consulta = {
          // O `eq` de verdade: acumula o filtro; quem aplica e o `order`.
          eq: (coluna: string, valor: unknown) => {
            filtros.push({ coluna, valor });
            return consulta;
          },
          // O hook sempre ordena por `criado_em`; o duble ordena por ele.
          order: async (_coluna: string, opcoes: { ascending: boolean }) => {
            mundo.consultas.push({ tabela, colunas, filtros: [...filtros] });
            const casam = mundo.linhas.filter((linha) =>
              filtros.every((f) => linha[f.coluna] === f.valor),
            );
            const ordenadas = [...casam].sort((a, b) =>
              String(a.criado_em).localeCompare(String(b.criado_em)),
            );
            if (!opcoes.ascending) ordenadas.reverse();
            return { data: ordenadas, error: null };
          },
        };
        return consulta;
      },
    }),
  },
}));

function pedido(extra: Record<string, unknown>) {
  return {
    email_novo: null,
    situacao: "aberto",
    atendido_em: null,
    atendido_por: null,
    observacao: null,
    ...extra,
  };
}

// Admin: 1 pedido ja atendido (o mais antigo). Outra cliente: pedidos MAIS
// RECENTES do mesmo tipo, um aberto e um atendido com observacao da loja.
const LINHAS = [
  pedido({
    id: "ped-admin-exclusao",
    user_id: ADMIN,
    tipo: "excluir_conta",
    situacao: "recusado",
    criado_em: "2026-10-01T10:00:00Z",
    atendido_em: "2026-10-02T10:00:00Z",
  }),
  pedido({
    id: "ped-outra-exclusao",
    user_id: OUTRA,
    tipo: "excluir_conta",
    situacao: "aberto",
    criado_em: "2026-11-05T10:00:00Z",
  }),
  pedido({
    id: "ped-outra-email",
    user_id: OUTRA,
    tipo: "corrigir_email",
    situacao: "aberto",
    email_novo: EMAIL_DA_OUTRA,
    criado_em: "2026-11-06T10:00:00Z",
  }),
  pedido({
    id: "ped-outra-email-antigo",
    user_id: OUTRA,
    tipo: "corrigir_email",
    situacao: "atendido",
    criado_em: "2026-10-20T10:00:00Z",
    atendido_em: "2026-10-21T10:00:00Z",
    observacao: OBSERVACAO_PARA_A_OUTRA,
  }),
];

let atual: ReturnType<typeof usePedidosDePrivacidade>;
function Sonda({ userId }: { userId: string | null }) {
  const hook = usePedidosDePrivacidade(userId);
  useEffect(() => {
    atual = hook;
  }, [hook]);
  return <output>{hook.carga}</output>;
}

let raiz: Root;
let hospedeiro: HTMLDivElement;
beforeEach(() => {
  mundo.linhas = LINHAS.map((l) => ({ ...l }));
  mundo.consultas = [];
  hospedeiro = document.createElement("div");
  document.body.appendChild(hospedeiro);
  raiz = createRoot(hospedeiro);
});
afterEach(() => {
  act(() => raiz.unmount());
  hospedeiro.remove();
  document.body.innerHTML = "";
});

async function assentar() {
  await act(async () => {
    await new Promise((r) => setTimeout(r, 0));
  });
}

describe("pedidos de privacidade: so lê os da própria conta", () => {
  it("o hook devolve só o pedido do admin logado, e a consulta pediu user_id = a conta dele", async () => {
    act(() => raiz.render(<Sonda userId={ADMIN} />));
    await assentar();

    expect(atual.carga).toBe("pronta");
    // Controle: o banco (dublê) de fato tem 4 linhas, 3 de outra cliente.
    expect(mundo.linhas).toHaveLength(4);
    expect(atual.pedidos.map((p) => p.id)).toEqual(["ped-admin-exclusao"]);
    expect(atual.pedidos.every((p) => p.user_id === ADMIN)).toBe(true);

    expect(mundo.consultas).toHaveLength(1);
    expect(mundo.consultas[0].tabela).toBe("pedidos_de_privacidade");
    expect(mundo.consultas[0].filtros).toEqual([
      { coluna: "user_id", valor: ADMIN },
    ]);
  });

  it("outra conta logada lê só os dela (o filtro acompanha o userId, não é fixo)", async () => {
    act(() => raiz.render(<Sonda userId={OUTRA} />));
    await assentar();

    expect(atual.pedidos.map((p) => p.id).sort()).toEqual([
      "ped-outra-email",
      "ped-outra-email-antigo",
      "ped-outra-exclusao",
    ]);
    expect(mundo.consultas[0].filtros).toEqual([
      { coluna: "user_id", valor: OUTRA },
    ]);
  });

  it("ultimoPedidoDoTipo escolhe o mais recente DA CONTA, não o mais recente de todas", async () => {
    act(() => raiz.render(<Sonda userId={ADMIN} />));
    await assentar();

    const exclusao = ultimoPedidoDoTipo(
      atual.pedidos as readonly PedidoDePrivacidade[],
      "excluir_conta",
    );
    // Dele, recusado em 01/10; o aberto de 05/11 é da outra cliente.
    expect(exclusao?.id).toBe("ped-admin-exclusao");
    expect(exclusao?.situacao).toBe("recusado");
    // Ele nunca pediu correção de e-mail: nada a mostrar (nem o da outra).
    expect(ultimoPedidoDoTipo(atual.pedidos, "corrigir_email")).toBeNull();
  });

  it("a tela do admin não mostra o e-mail pedido nem a observação da loja para outra cliente, e o botão de pedir continua lá", async () => {
    act(() => {
      raiz.render(
        <PrivacidadeEMeusDados userId={ADMIN} emailAtual="admin@exemplo.com" />,
      );
    });
    await assentar();

    const texto = document.body.textContent ?? "";
    expect(texto).not.toContain(EMAIL_DA_OUTRA);
    expect(texto).not.toContain(OBSERVACAO_PARA_A_OUTRA);
    // Pedido aberto da outra cliente esconderia o botao de pedir exclusao.
    const botoes = [...document.body.querySelectorAll("button")].map(
      (b) => b.textContent ?? "",
    );
    expect(
      botoes.some((t) => t.includes("Pedir exclusão da minha conta")),
    ).toBe(true);
    expect(mundo.consultas[0].filtros).toEqual([
      { coluna: "user_id", valor: ADMIN },
    ]);
  });

  it("sem usuário logado não consulta o banco e não mostra pedido nenhum", async () => {
    act(() => raiz.render(<Sonda userId={null} />));
    await assentar();
    act(() => raiz.render(<Sonda userId={undefined as unknown as null} />));
    await assentar();

    expect(mundo.consultas).toHaveLength(0);
    expect(atual.pedidos).toEqual([]);
  });
});
