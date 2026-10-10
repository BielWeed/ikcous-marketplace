// @vitest-environment jsdom
//
// Painel simples (D11): "Atendimento" deixou de ser tela. A rota
// `admin-whatsapp-config` virou APELIDO de Minha loja na seção Contato — o link
// antigo (e o push já enviado) continua abrindo, só que na tela nova, com o
// foco no bloco Contato. A view antiga (AdminWhatsAppConfigView) foi apagada e
// nada em `src` a importa mais.
/* eslint-disable security/detect-non-literal-fs-filename --
   varredura da própria árvore do repositório (caminhos vêm do disco, não de entrada de usuário) */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { APELIDOS } from "@/config/nomes-do-painel";

import { pararABuscaDeCep } from "./duble-busca-de-cep";

const CONFIG = {
  storeName: "Ateliê da Serra",
  logoUrl: "https://exemplo.test/logo.png",
  originCep: "01310-100",
  storeAddress:
    "Avenida Paulista, 1578 — Bela Vista, São Paulo/SP — CEP 01310-100",
  storeCity: "São Paulo",
  storeState: "SP",
  businessHours: "Seg a sex 9h–18h",
  whatsappNumber: "5534999998888",
  shareText: "Confira [nome] por [preco]: [link]",
  storeDescription: null,
};

vi.mock("@/contexts/StoreContext", () => ({
  useStore: () => ({
    config: CONFIG,
    updateConfig: vi.fn(async () => true),
    isLoaded: true,
    products: [],
  }),
  TIPO_DAS_COLUNAS_STORE_CONFIG: new Map<string, string>(),
}));
vi.mock("@/hooks/useOnlineStatus", () => ({ useOnlineStatus: () => false }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock("@/lib/supabase", () => ({ supabase: {} }));
vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({
    user: { id: "admin-1" },
    session: { user: { id: "admin-1" } },
    isAdmin: true,
    adminStatus: "admin",
  }),
}));
// O menu e a barra do painel não fazem parte do que se prova aqui.
vi.mock("@/components/layouts/AdminLayout", () => ({
  AdminLayout: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

function esperar(ms = 0): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

describe("admin-whatsapp-config é apelido de Minha loja › Contato", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;

  beforeEach(() => {
    HTMLElement.prototype.scrollIntoView = vi.fn();
    pararABuscaDeCep();
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

  async function abrirRota(
    rota: "admin-whatsapp-config" | "admin-about-store",
  ) {
    const { AdminArea } = await import("@/components/layouts/AdminArea");
    await act(async () => {
      raiz.render(
        <AdminArea
          currentView={rota}
          onNavigate={vi.fn()}
          selectedProductId={null}
          setIsAdminDirty={vi.fn()}
          setBackOverride={vi.fn()}
          handleAdminUserDetailBack={vi.fn()}
          backOverride={null}
          isTransitionSupported={false}
        />,
      );
    });
    // O módulo da tela vem por import dinâmico (lazy): espera o bloco nascer.
    for (let i = 0; i < 100 && !tituloDoContato(); i++) {
      await act(async () => {
        await esperar(50);
      });
    }
  }

  const tituloDoContato = () =>
    [...hospedeiro.querySelectorAll("h2")].find(
      (h) => h.textContent === "Contato",
    );

  it("navegar para admin-whatsapp-config mostra o título 'Minha loja' e o bloco Contato com o foco nele", async () => {
    await abrirRota("admin-whatsapp-config");

    expect(hospedeiro.querySelector("h1")?.textContent).toBe("Minha loja");
    const contato = tituloDoContato();
    expect(contato).toBeTruthy();
    expect(
      contato?.closest("section")?.querySelector("#settings-whatsapp"),
    ).not.toBeNull();
    expect(document.activeElement).toBe(contato);
  });

  it("a rota própria de Minha loja continua abrindo SEM puxar o foco para o Contato", async () => {
    await abrirRota("admin-about-store");

    expect(hospedeiro.querySelector("h1")?.textContent).toBe("Minha loja");
    expect(tituloDoContato()).toBeTruthy();
    expect(document.activeElement).not.toBe(tituloDoContato());
  });

  it("o apelido está declarado: vira admin-about-store na seção contato", () => {
    expect(APELIDOS["admin-whatsapp-config"]).toEqual({
      vira: "admin-about-store",
      secao: "contato",
    });
  });
});

describe("a view antiga saiu de vez", () => {
  const RAIZ = join(__dirname, "..", "..");

  function arquivosDe(pasta: string): string[] {
    const achados: string[] = [];
    for (const nome of readdirSync(pasta)) {
      const caminho = join(pasta, nome);
      if (statSync(caminho).isDirectory()) achados.push(...arquivosDe(caminho));
      else if (/\.tsx?$/.test(nome)) achados.push(caminho);
    }
    return achados;
  }

  it("nenhum arquivo de src importa views/admin/AdminWhatsAppConfigView", () => {
    const importadores = arquivosDe(join(RAIZ, "src"))
      .filter((arquivo) =>
        /views\/admin\/AdminWhatsAppConfigView/.test(
          readFileSync(arquivo, "utf8"),
        ),
      )
      .map((arquivo) => relative(RAIZ, arquivo).split(sep).join("/"));
    expect(importadores).toEqual([]);
  });

  it("o AdminArea entrega a rota antiga à AdminAboutStoreView com secaoInicial contato", () => {
    const fonte = readFileSync(
      join(RAIZ, "src/components/layouts/AdminArea.tsx"),
      "utf8",
    );
    const caso = fonte.slice(
      fonte.indexOf('case "admin-whatsapp-config":'),
      fonte.indexOf('case "admin-about-store":'),
    );
    expect(caso).toContain("component={AdminAboutStore}");
    expect(caso).toContain('secaoInicial: "contato"');
  });
});
