// Caça de provas fracas (24/11/2026), papéis: `acaoDeCargoPara` decide se o
// cartão do cliente mostra "Tornar administrador" / "Remover acesso de
// administrador". Pela documentação da função, a ação NUNCA aparece no cartão
// do próprio dono nem no da pessoa logada, e sem saber quem está olhando
// (`meuId` nulo) não aparece de jeito nenhum. Pelo gancho `useDonoDaLoja` esses
// três casos se escondem uns atrás dos outros (quem é dono tem `meuId` igual a
// `donoId`); a função pura tem de manter cada trava de pé sozinha, para uma
// mudança futura no gancho não abrir a ação de remover o dono.
import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/supabase", () => ({ supabase: {} }));

import { acaoDeCargoPara } from "@/components/admin/users/PromoverAdminAcoes";
import type { Customer } from "@/utils/admin_cache";

function cartao(id: string, role: string): Customer {
  return { id, role } as unknown as Customer;
}

describe("acaoDeCargoPara — cada trava vale sozinha", () => {
  it("sem saber quem está olhando (meuId nulo): nenhuma ação, nem para cliente nem para admin", () => {
    const eu = { souODono: true, donoId: "dono", meuId: null };
    expect(acaoDeCargoPara(cartao("a", "customer"), eu)).toBeNull();
    expect(acaoDeCargoPara(cartao("a", "admin"), eu)).toBeNull();
  });

  it("quem não é o dono nunca recebe ação", () => {
    const eu = { souODono: false, donoId: "dono", meuId: "eu" };
    expect(acaoDeCargoPara(cartao("a", "customer"), eu)).toBeNull();
    expect(acaoDeCargoPara(cartao("a", "admin"), eu)).toBeNull();
  });

  it("o cartão da própria pessoa logada não tem ação", () => {
    const eu = { souODono: true, donoId: "dono", meuId: "eu" };
    expect(acaoDeCargoPara(cartao("eu", "admin"), eu)).toBeNull();
    expect(acaoDeCargoPara(cartao("eu", "customer"), eu)).toBeNull();
  });

  it("o cartão do dono não tem ação (o cargo do dono não muda)", () => {
    const eu = { souODono: true, donoId: "dono", meuId: "eu" };
    expect(acaoDeCargoPara(cartao("dono", "admin"), eu)).toBeNull();
  });

  it("controle: o dono vê 'promover' num cliente e 'remover' num administrador de outra pessoa", () => {
    const eu = { souODono: true, donoId: "eu", meuId: "eu" };
    expect(acaoDeCargoPara(cartao("a", "customer"), eu)).toBe("promover");
    expect(acaoDeCargoPara(cartao("b", "admin"), eu)).toBe("remover");
  });

  it("gerente, vendedor e papel desconhecido não têm ação (o banco só conhece admin e customer)", () => {
    const eu = { souODono: true, donoId: "eu", meuId: "eu" };
    for (const role of ["gerente", "vendedor", "ADMIN", "", "superuser"]) {
      expect(acaoDeCargoPara(cartao("a", role), eu), role).toBeNull();
    }
  });
});
