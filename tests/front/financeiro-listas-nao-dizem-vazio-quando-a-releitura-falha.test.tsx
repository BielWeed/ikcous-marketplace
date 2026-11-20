// @vitest-environment jsdom
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { AbaCaixa } from "@/components/admin/financeiro/AbaCaixa";
import { AbaContasECategorias } from "@/components/admin/financeiro/AbaContasECategorias";
import { useCategoriasFinanceiras } from "@/hooks/useFinanceiro";

const { rpc } = vi.hoisted(() => ({ rpc: vi.fn() }));
vi.mock("@/lib/supabase", () => ({ supabase: { rpc } }));
vi.mock("@/hooks/useAuth", () => ({ useAuth: () => ({ user: null }) }));

// @ts-expect-error flag interna do React.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const abrirFolha = vi.fn();
const caixaDaTela = {
  dados: { sessao: null },
  carregando: false,
  erro: null,
  recarregar: vi.fn(),
};
const contas = { ...caixaDaTela, dados: [] };

function Categorias({ versao }: { readonly versao: number }) {
  const categorias = useCategoriasFinanceiras(true, versao);
  return (
    <AbaContasECategorias
      contas={contas}
      categorias={categorias}
      abrirFolha={abrirFolha}
    />
  );
}

let raiz: Root;
let host: HTMLDivElement;

beforeEach(() => {
  rpc.mockReset();
  host = document.createElement("div");
  document.body.appendChild(host);
  raiz = createRoot(host);
});

afterEach(async () => {
  await act(async () => raiz.unmount());
  host.remove();
});

describe.each([
  {
    secao: "Histórico do caixa",
    consulta: "fin_caixa_historico",
    vazio: "Nenhum caixa fechado ainda.",
    aviso: "Não foi possível atualizar o histórico",
    item: "Gaveta do balcão",
    dados: [
      {
        id: "caixa-1",
        conta_nome: "Gaveta do balcão",
        aberto_em: "2026-11-19T11:00:00Z",
        fechado_em: "2026-11-19T21:00:00Z",
        esperado: 100,
        contado: 100,
      },
    ],
    montar: (versao: number) => (
      <AbaCaixa
        ativo
        versao={versao}
        abrirFolha={abrirFolha}
        caixaDaTela={caixaDaTela}
      />
    ),
  },
  {
    secao: "Categorias",
    consulta: "fin_categorias_listar",
    vazio: "Nenhuma categoria",
    aviso: "Não foi possível atualizar as categorias",
    item: "Material de embalagem",
    dados: [
      {
        id: "categoria-1",
        nome: "Material de embalagem",
        natureza: "despesa",
        grupo_dre: "despesa_fixa",
      },
    ],
    montar: (versao: number) => <Categorias versao={versao} />,
  },
])(
  "$secao quando a releitura falha",
  ({ secao, consulta, vazio, aviso, item, dados, montar }) => {
    const cartao = () =>
      host.querySelector<HTMLElement>(`section[aria-label="${secao}"]`);
    const ler = async (versao: number) => {
      await act(async () => raiz.render(montar(versao)));
    };
    const falha = { data: null, error: new Error("Failed to fetch") };

    it("troca o vazio antigo por um aviso e permite confirmar o vazio novamente", async () => {
      rpc
        .mockResolvedValueOnce({ data: [], error: null })
        .mockResolvedValueOnce(falha)
        .mockResolvedValueOnce({ data: [], error: null });

      await ler(0);
      expect(cartao()?.textContent).toContain(vazio);
      await ler(1);
      expect(cartao()?.textContent).not.toContain(vazio);
      expect(
        cartao()?.querySelector('[role="alert"]')?.textContent ?? "",
      ).toContain(aviso);

      const tentar = [...(cartao()?.querySelectorAll("button") ?? [])].find(
        (botao) => botao.textContent?.trim() === "Tentar de novo",
      );
      expect(tentar).toBeDefined();
      await act(async () => tentar?.click());
      expect(rpc).toHaveBeenCalledTimes(3);
      expect(rpc.mock.calls[2]?.[0]).toBe(consulta);
      expect(cartao()?.textContent).toContain(vazio);
      expect(cartao()?.querySelector('[role="alert"]')).toBeNull();
    });

    it("avisa que a lista pode estar desatualizada sem remover o item conhecido", async () => {
      rpc
        .mockResolvedValueOnce({ data: dados, error: null })
        .mockResolvedValueOnce(falha);
      await ler(0);
      expect(cartao()?.textContent).toContain(item);
      await ler(1);
      expect(cartao()?.textContent).toContain(item);
      expect(
        cartao()?.querySelector('[role="alert"]')?.textContent ?? "",
      ).toContain("pode estar desatualizada");
    });
  },
);
