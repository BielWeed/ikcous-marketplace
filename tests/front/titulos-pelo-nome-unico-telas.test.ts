// Título pelo nome único (spec painel-simples §3, C10–C14): o `titulo` do
// AdminPageHeader de cada tela vem de NOMES_DO_PAINEL, não de texto solto —
// renomear a tela num lugar só renomeia o título, o menu e o "carregando".
// Teste de fonte: lê o código das telas desta frente. Os títulos de ajuda
// (AdminHelpModal) saem do jargão do glossário.
/* eslint-disable security/detect-non-literal-fs-filename --
   lê a própria árvore do repositório (caminhos fixos neste arquivo, não entrada de usuário) */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { NOMES_DO_PAINEL } from "@/config/nomes-do-painel";
import { GLOSSARIO_DO_PAINEL } from "@/lib/glossario-do-painel";
import { describe, expect, it } from "vitest";

const RAIZ = join(__dirname, "..", "..");
const ler = (caminho: string) => readFileSync(join(RAIZ, caminho), "utf8");

// tela → rota cujo nome é o título (a lista é o contrato desta frente).
const TELAS: ReadonlyArray<
  readonly [arquivo: string, rota: keyof typeof NOMES_DO_PAINEL]
> = [
  ["src/views/admin/AdminDashboardView.tsx", "admin-dashboard"],
  ["src/views/admin/AdminCouponsView.tsx", "admin-coupons"],
  ["src/views/admin/AdminBannersView.tsx", "admin-banners"],
  ["src/views/admin/AdminCarouselsView.tsx", "admin-carousels"],
  ["src/views/admin/AdminPushView.tsx", "admin-push"],
  ["src/views/admin/AdminNotificationsView.tsx", "admin-notifications"],
  ["src/views/admin/AdminUserDetailView.tsx", "admin-user-detail"],
  ["src/views/admin/AdminPdvView.tsx", "admin-pdv"],
  ["src/views/admin/AdminCrmView.tsx", "admin-crm"],
  ["src/views/admin/AdminFinanceiroView.tsx", "admin-financeiro"],
];

/** Só o que vem depois de `<AdminPageHeader` até o `titulo=` (o 1º dele). */
function tituloDoCabecalho(fonte: string): string {
  const achou = /<AdminPageHeader[^>]*?\btitulo=(\{[^\n]*|"[^"]*")/s.exec(
    fonte,
  );
  expect(achou, "a tela deve ter <AdminPageHeader titulo=…>").not.toBeNull();
  return achou![1];
}

describe("título das telas vem de NOMES_DO_PAINEL", () => {
  it.each(TELAS)("%s usa NOMES_DO_PAINEL[%s]", (arquivo, rota) => {
    const fonte = ler(arquivo);
    expect(fonte).toContain(
      'import { NOMES_DO_PAINEL } from "@/config/nomes-do-painel";',
    );
    expect(tituloDoCabecalho(fonte)).toContain(`NOMES_DO_PAINEL["${rota}"]`);
  });

  it("Novo/Editar produto: verbo + substantivo de NOMES_DO_PAINEL", () => {
    const fonte = ler("src/views/admin/AdminProductFormView.tsx");
    const titulo = tituloDoCabecalho(fonte);
    expect(titulo).toContain('NOMES_DO_PAINEL["admin-product-form"]');
    expect(titulo).toContain("Editar");
    expect(titulo).toContain("Novo");
    expect(NOMES_DO_PAINEL["admin-product-form"].toLowerCase()).toBe("produto");
  });

  it("Novo/Editar cupom: verbo + substantivo de NOMES_DO_PAINEL", () => {
    const fonte = ler("src/views/admin/AdminCouponFormView.tsx");
    const titulo = tituloDoCabecalho(fonte);
    expect(titulo).toContain('NOMES_DO_PAINEL["admin-coupon-form"]');
    expect(titulo).toContain("Editar");
    expect(titulo).toContain("Novo");
    expect(NOMES_DO_PAINEL["admin-coupon-form"].toLowerCase()).toBe("cupom");
  });

  it("os nomes que esta frente espera estão declarados", () => {
    expect(NOMES_DO_PAINEL["admin-crm"]).toBe("Relatórios");
    expect(NOMES_DO_PAINEL["admin-push"]).toBe("Avisar clientes");
    expect(NOMES_DO_PAINEL["admin-user-detail"]).toBe("Ficha do cliente");
    expect(NOMES_DO_PAINEL["admin-banners"]).toBe("Banners");
  });
});

describe("o jargão sai dos textos desta frente", () => {
  const proibidos = (nome: string) => {
    const entrada = GLOSSARIO_DO_PAINEL.find((e) => e.tecnico === nome);
    expect(entrada?.proibido, `glossário sem "${nome}"`).toBeTruthy();
    return entrada!.proibido as RegExp;
  };

  it("o Início e o atalho dizem Relatórios, não Dashboard CRM", () => {
    const cada = [
      "src/components/admin/inicio/AtalhosDoInicio.tsx",
      "src/components/admin/crm/AjudaDoCrm.tsx",
      "src/views/admin/AdminCrmView.tsx",
    ];
    const naoComentario = (fonte: string) =>
      fonte
        .split("\n")
        .filter((l) => !/^\s*(\/\/|\/\*|\*|\{\/\*)/.test(l))
        .join("\n");
    for (const arquivo of cada) {
      expect(naoComentario(ler(arquivo)), arquivo).not.toMatch(
        proibidos("Dashboard CRM"),
      );
    }
    // O texto da ajuda do Início (que aponta para o botão) também.
    expect(
      naoComentario(ler("src/views/admin/AdminDashboardView.tsx")),
    ).not.toMatch(proibidos("Dashboard CRM"));
    expect(ler("src/components/admin/inicio/AtalhosDoInicio.tsx")).toContain(
      "NOMES_DO_PAINEL",
    );
  });

  it("a ajuda dos relatórios chama-se 'Como ler os relatórios'", () => {
    const fonte = ler("src/components/admin/crm/AjudaDoCrm.tsx");
    expect(fonte).toContain('title="Como ler os relatórios"');
    expect(fonte).not.toMatch(proibidos("Central de Inteligência & KPIs"));
  });

  it("a ajuda do produto chama-se 'Como cadastrar um produto'", () => {
    const fonte = ler("src/views/admin/AdminProductFormView.tsx");
    expect(fonte).toContain('title="Como cadastrar um produto"');
    expect(fonte).not.toMatch(proibidos("Engenharia & Cadastro de Produtos"));
  });

  it("Banners e Vitrines não usam mais os nomes antigos", () => {
    for (const arquivo of [
      "src/views/admin/AdminBannersView.tsx",
      "src/views/admin/AdminCarouselsView.tsx",
    ]) {
      const fonte = ler(arquivo);
      expect(fonte, arquivo).not.toMatch(
        proibidos("Banners Promocionais / Gerenciador de Banners"),
      );
      expect(fonte, arquivo).not.toMatch(
        proibidos("Vitrines (Carrosséis) / Vitrines & Carrosséis"),
      );
    }
  });

  it("Avisar clientes e Ficha do cliente não voltam aos nomes antigos no cabeçalho", () => {
    expect(ler("src/views/admin/AdminPushView.tsx")).not.toContain(
      'titulo="Enviar Notificações"',
    );
    expect(ler("src/views/admin/AdminUserDetailView.tsx")).not.toContain(
      'titulo="Perfil do Cliente"',
    );
  });
});
