// @vitest-environment jsdom
import { ContatoDaLoja } from "@/components/admin/minha-loja/ContatoDaLoja";
import { PoliticaDeDevolucaoSection } from "@/components/admin/settings/PoliticaDeDevolucaoSection";
import {
  ContextoDaBarra,
  useBarraAcoplada,
} from "@/components/layouts/AcaoDaBarra";
import { AdminCouponFormView } from "@/views/admin/AdminCouponFormView";
import { type ReactNode, act, useContext } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { pararABuscaDeCep } from "./duble-busca-de-cep";

const h = vi.hoisted(() => ({
  atualizarContato: vi.fn(),
  salvarCupom: vi.fn(),
  lerPolitica: vi.fn(),
  rpc: vi.fn(),
  navegar: vi.fn(),
  offline: false,
  toast: { error: vi.fn(), success: vi.fn() },
}));
vi.mock("@/contexts/StoreContext", () => ({
  useStore: () => ({
    config: {
      storeName: "Loja de teste",
      storeAddress: "Rua Um, 10",
      whatsappNumber: "5511999998888",
      shareText: "Confira [nome]: [link]",
      formasPagamentoEntrega: ["cash"],
    },
    isLoaded: true,
    products: [],
    updateConfig: h.atualizarContato,
  }),
  TIPO_DAS_COLUNAS_STORE_CONFIG: new Map(),
}));
vi.mock("@/hooks/useOnlineStatus", () => ({
  useOnlineStatus: () => h.offline,
}));
vi.mock("@/hooks/useCoupons", () => ({
  useCoupons: () => ({
    coupons: [
      {
        id: "cupom-1",
        code: "DEZ",
        type: "percentage",
        value: 10,
        active: true,
        usageCount: 0,
      },
    ],
    loading: false,
    alcanceSuportado: false,
    alcanceSondado: true,
    addCoupon: vi.fn(),
    updateCoupon: h.salvarCupom,
  }),
}));
vi.mock("@/hooks/useCategories", () => ({
  useCategories: () => ({ categories: [] }),
}));
vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({
    user: { id: "admin-1" },
    session: { user: { id: "admin-1" } },
    isAdmin: true,
    adminStatus: "admin",
  }),
}));
vi.mock("@/lib/supabase", () => ({
  supabase: {
    rpc: h.rpc,
    from: () => ({
      select: () => ({ eq: () => ({ maybeSingle: h.lerPolitica }) }),
    }),
    functions: {
      invoke: () => Promise.resolve({ data: null, error: null }),
    },
  },
}));
vi.mock("sonner", () => ({ toast: h.toast }));

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const POLITICA = {
  prazo_arrependimento_dias: 7,
  prazo_troca_dias: 30,
  prazo_vicio_dias: 90,
  aceita_troca: true,
  aceita_vale: true,
  exige_fotos_vicio: true,
  metodos_locais: ["entrega_na_loja", "coleta"],
  metodos_nacionais: ["etiqueta_reversa", "envio_proprio"],
  reembolso_momento: "ao_receber",
  frete_troca_pago_por: "cliente",
  categorias_sem_troca: [],
  texto_politica: null,
  endereco_devolucao: null,
  updated_at: "2026-10-17T10:00:00Z",
};

function Prateleira() {
  const barra = useContext(ContextoDaBarra);
  return <div ref={barra?.receberPrateleira} data-prateleira />;
}

function Casca({ children }: { children: ReactNode }) {
  const barra = useBarraAcoplada();
  return (
    <ContextoDaBarra.Provider value={barra}>
      <main>{children}</main>
      <nav>
        <Prateleira />
        <div data-abas>Início · Pedidos · Produtos · Clientes · Ajustes</div>
      </nav>
    </ContextoDaBarra.Provider>
  );
}

let host: HTMLDivElement;
let root: Root;
let larga = false;
beforeEach(() => {
  vi.clearAllMocks();
  larga = false;
  h.offline = false;
  h.atualizarContato.mockResolvedValue(true);
  h.salvarCupom.mockResolvedValue(undefined);
  h.lerPolitica.mockResolvedValue({ data: POLITICA, error: null });
  h.rpc.mockResolvedValue({
    data: { ...POLITICA, prazo_troca_dias: 15 },
    error: null,
  });
  vi.stubGlobal("matchMedia", (media: string) => ({
    matches: media === "(min-width: 1024px)" && larga,
    media,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  }));
  pararABuscaDeCep();
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
});

async function montar(children: ReactNode) {
  await act(async () => root.render(<Casca>{children}</Casca>));
}

function acoes(rotulo: string) {
  const grupo = host.querySelector<HTMLElement>(
    `[role="group"][aria-label="${rotulo}"]`,
  );
  expect(grupo, rotulo).not.toBeNull();
  return grupo!;
}

async function digitar(seletor: string, valor: string) {
  const campo = host.querySelector<HTMLInputElement>(seletor)!;
  await act(async () => {
    campo.focus();
    Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      "value",
    )!.set!.call(campo, valor);
    campo.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await act(async () => campo.blur());
}

const TELAS = [
  {
    nome: "cupom",
    rotulo: "Ações do cupom",
    botao: "Salvar Cupom",
    tela: () => <AdminCouponFormView onNavigate={h.navegar} />,
  },
  {
    nome: "contato",
    rotulo: "Ações do contato da loja",
    botao: "Salvar contato",
    tela: () => <ContatoDaLoja />,
  },
  {
    nome: "política",
    rotulo: "Ações da política de devolução",
    botao: "Política salva",
    tela: () => <PoliticaDeDevolucaoSection />,
  },
];

for (const tela of TELAS) {
  it.each([false, true])(
    `${tela.nome}: ações na pílula no celular e inline no desktop (larga=%s)`,
    async (desktop) => {
      larga = desktop;
      await montar(tela.tela());
      const grupo = acoes(tela.rotulo);
      expect(
        [...grupo.querySelectorAll("button")].map((b) => b.textContent),
      ).toEqual([tela.botao]);
      expect(
        host.querySelectorAll(`[aria-label="${tela.rotulo}"]`),
      ).toHaveLength(1);
      if (desktop) {
        expect(grupo.closest("main")).not.toBeNull();
        expect(grupo.className).toContain("admin-acao-inline");
        expect(host.querySelector("[data-prateleira]")?.childElementCount).toBe(
          0,
        );
      } else {
        expect(grupo.closest("[data-prateleira]")).not.toBeNull();
        expect(grupo.className).not.toContain("admin-acao-inline");
        expect(
          grupo.compareDocumentPosition(host.querySelector("[data-abas]")!) &
            Node.DOCUMENT_POSITION_FOLLOWING,
        ).toBeTruthy();
      }
    },
  );
}

it("cupom na pílula mantém a validação do código vazio e o Cancelar do cabeçalho", async () => {
  await montar(<AdminCouponFormView onNavigate={h.navegar} />);
  await act(async () =>
    acoes("Ações do cupom").querySelector("button")!.click(),
  );
  expect(h.toast.error).toHaveBeenCalledWith(
    "O código do cupom é obrigatório.",
  );
  expect(h.salvarCupom).not.toHaveBeenCalled();
  const cancelar = [...host.querySelectorAll("main button")].find(
    (b) => b.textContent === "Cancelar",
  )!;
  await act(async () => (cancelar as HTMLButtonElement).click());
  expect(h.navegar).toHaveBeenCalledWith("admin-coupons");
});

it("Salvar Cupom na pílula chama a mesma atualização e fica travado enquanto salva", async () => {
  let terminar!: () => void;
  h.salvarCupom.mockReturnValueOnce(
    new Promise<void>((resolve) => {
      terminar = resolve;
    }),
  );
  await montar(
    <AdminCouponFormView couponId="cupom-1" onNavigate={h.navegar} />,
  );
  const salvar = () => acoes("Ações do cupom").querySelector("button")!;
  await act(async () => salvar().click());
  expect(salvar().disabled).toBe(true);
  expect(salvar().textContent).toBe("Salvando...");
  expect(h.salvarCupom).toHaveBeenCalledWith(
    "cupom-1",
    expect.objectContaining({ code: "DEZ", value: 10 }),
  );
  await act(async () => terminar());
  expect(h.navegar).toHaveBeenCalledWith("admin-coupons");
});

it("contato na pílula mantém o estado limpo, o payload e o carregamento", async () => {
  let terminar!: (salvou: boolean) => void;
  h.atualizarContato.mockReturnValueOnce(
    new Promise<boolean>((resolve) => {
      terminar = resolve;
    }),
  );
  await montar(<ContatoDaLoja />);
  const salvar = () =>
    acoes("Ações do contato da loja").querySelector("button")!;
  expect(salvar().disabled).toBe(true);
  await digitar("#settings-whatsapp", "11987654321");
  expect(salvar().disabled).toBe(false);
  await act(async () => salvar().click());
  expect(salvar().disabled).toBe(true);
  expect(salvar().textContent).toBe("Salvando...");
  expect(h.atualizarContato).toHaveBeenCalledWith(
    {
      whatsappNumber: "5511987654321",
      shareText: "Confira [nome]: [link]",
    },
    { silentSuccess: true },
  );
  await act(async () => terminar(true));
  expect(h.toast.success).toHaveBeenCalledWith("Contato salvo");
});

it("política leva status, data e o mesmo Salvar para a pílula, inclusive durante erro", async () => {
  let terminar!: (resposta: unknown) => void;
  h.rpc.mockReturnValueOnce(
    new Promise((resolve) => {
      terminar = resolve;
    }),
  );
  await montar(<PoliticaDeDevolucaoSection />);
  const grupo = () => acoes("Ações da política de devolução");
  expect(grupo().querySelector("button")!.disabled).toBe(true);
  expect(grupo().querySelector('[role="status"]')?.textContent).toBe(
    "Os prazos contam da entrega",
  );
  expect(grupo().querySelector("time")?.dateTime).toBe("2026-10-17T10:00:00Z");
  await digitar("#politica-troca", "15");
  expect(grupo().querySelector('[role="status"]')?.textContent).toBe(
    "Salve antes de fechar",
  );
  await act(async () => grupo().querySelector("button")!.click());
  expect(grupo().querySelector("button")!.disabled).toBe(true);
  expect(h.rpc).toHaveBeenCalledWith("salvar_politica_de_devolucao", {
    p: {
      prazo_arrependimento_dias: 7,
      prazo_troca_dias: 15,
      prazo_vicio_dias: 90,
      aceita_troca: true,
      aceita_vale: true,
      exige_fotos_vicio: true,
      metodos_locais: ["entrega_na_loja", "coleta"],
      metodos_nacionais: ["etiqueta_reversa", "envio_proprio"],
      reembolso_momento: "ao_receber",
      frete_troca_pago_por: "cliente",
      categorias_sem_troca: [],
      texto_politica: "",
      endereco_devolucao: "",
    },
  });
  await act(async () =>
    terminar({ data: null, error: { message: "Acesso negado." } }),
  );
  expect(h.toast.error).toHaveBeenCalledWith("Acesso negado.");
  expect(grupo().querySelector("button")!.disabled).toBe(false);
  expect(host.querySelector<HTMLInputElement>("#politica-troca")!.value).toBe(
    "15",
  );
});

it("duas seções montadas só projetam as ações da ativa, sem perder o rascunho", async () => {
  const tela = (contatoAtivo: boolean) => (
    <>
      <ContatoDaLoja ativa={contatoAtivo} />
      <PoliticaDeDevolucaoSection ativa={!contatoAtivo} />
    </>
  );
  await montar(tela(true));
  await digitar("#settings-whatsapp", "11987654321");
  expect(host.querySelectorAll("[data-prateleira] [role=group]")).toHaveLength(
    1,
  );
  expect(acoes("Ações do contato da loja").closest("nav")).not.toBeNull();
  await montar(tela(false));
  expect(host.querySelectorAll("[data-prateleira] [role=group]")).toHaveLength(
    1,
  );
  expect(
    host.querySelector('[aria-label="Ações do contato da loja"]'),
  ).toBeNull();
  expect(acoes("Ações da política de devolução").closest("nav")).not.toBeNull();
  await montar(tela(true));
  expect(
    host.querySelector<HTMLInputElement>("#settings-whatsapp")!.value,
  ).toBe("(11) 98765-4321");
  expect(
    acoes("Ações do contato da loja").querySelector("button")!.disabled,
  ).toBe(false);
});

it("política que não carregou não deixa uma ação de salvar na pílula", async () => {
  h.lerPolitica.mockResolvedValueOnce({ data: null, error: new Error("rede") });
  await montar(<PoliticaDeDevolucaoSection />);
  expect(host.textContent).toContain(
    "Não consegui carregar a política de devolução.",
  );
  expect(host.querySelector("[data-prateleira]")?.childElementCount).toBe(0);
  const tentar = [...host.querySelectorAll("button")].find(
    (b) => b.textContent === "Tentar de novo",
  )!;
  await act(async () => tentar.click());
  expect(
    acoes("Ações da política de devolução").querySelector("button")!.disabled,
  ).toBe(true);
});

it("Minha loja retira a ação do contato ao ficar inativa", async () => {
  const { AdminAboutStoreView } = await import(
    "@/views/admin/AdminAboutStoreView"
  );
  await montar(<AdminAboutStoreView onNavigate={h.navegar} active />);
  expect(acoes("Ações do contato da loja").closest("nav")).not.toBeNull();
  await montar(<AdminAboutStoreView onNavigate={h.navegar} active={false} />);
  expect(host.querySelector("#settings-whatsapp")).not.toBeNull();
  expect(host.querySelector("[data-prateleira]")?.childElementCount).toBe(0);
});

it("Ajustes recolhido ou inativo retira a política da pílula sem desmontar o formulário", async () => {
  const { AdminSettingsView } = await import("@/views/admin/AdminSettingsView");
  const tela = (active: boolean) => (
    <AdminSettingsView onNavigate={h.navegar} active={active} />
  );
  await montar(tela(true));
  const abrir = host.querySelector<HTMLButtonElement>(
    '[data-cabecalho-grupo][aria-label="Regras de troca e devolução"]',
  )!;
  await act(async () => abrir.click());
  expect(acoes("Ações da política de devolução").closest("nav")).not.toBeNull();
  await act(async () => abrir.click());
  expect(host.querySelector("#politica-troca")).not.toBeNull();
  expect(host.querySelector("[data-prateleira]")?.childElementCount).toBe(0);
  await act(async () => abrir.click());
  expect(acoes("Ações da política de devolução").closest("nav")).not.toBeNull();
  await montar(tela(false));
  expect(host.querySelector("#politica-troca")).not.toBeNull();
  expect(host.querySelector("[data-prateleira]")?.childElementCount).toBe(0);
});
