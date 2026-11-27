// Bancada do balcão COM a barra de baixo do celular (servida por
// `tests/e2e/jornada-balcao-textos-no-celular.spec.ts`).
//
// Monta o `CupomDaVenda` e, na etapa "fechamento", o `FechamentoDaVenda`, com
// a máquina REAL da venda (`reducerDaVenda`) e um item de R$ 12.345,67, na
// mesma cadeia de caixas que o AdminLayout desenha no celular: cabeçalho,
// `<main>` de altura cheia, `.pdv-viewport` e a pílula fixa de baixo, cuja
// prateleira recebe o total e o botão (`useBarraAcoplada`). A reserva da barra
// (`--admin-tab-pb`) é a mesma conta do AdminLayout.
//
// `?etapa=fechamento` abre direto no fechamento, com Dinheiro escolhido; o
// Registrar falha com 23505 (chave já usada), que é o caminho que mostra
// "Começar uma venda nova" e a janela de confirmação com o valor.
import "@/index.css";
import "@/components/layouts/temas-do-painel.css";
import "@/components/layouts/temas-do-painel-cores.css";
import { CupomDaVenda } from "@/components/admin/pdv/CupomDaVenda";
import { FechamentoDaVenda } from "@/components/admin/pdv/FechamentoDaVenda";
import {
  ContextoDaBarra,
  useBarraAcoplada,
} from "@/components/layouts/AcaoDaBarra";
import {
  type EstadoDaVenda,
  estadoInicialDaVenda,
  reducerDaVenda,
} from "@/hooks/useVendaPresencial";
import { type CSSProperties, StrictMode, useReducer } from "react";
import { createRoot } from "react-dom/client";

const NO_FECHAMENTO =
  new URLSearchParams(location.search).get("etapa") === "fechamento";

function vendaDaBancada(): EstadoDaVenda {
  return {
    ...estadoInicialDaVenda(),
    etapa: NO_FECHAMENTO ? "fechamento" : "cupom",
    pagamento: NO_FECHAMENTO ? "cash" : null,
    itens: [
      {
        chave: "produto-1::",
        productId: "produto-1",
        variantId: null,
        nome: "Vestido da Bancada",
        variacao: null,
        preco: 12_345.67,
        quantidade: 1,
        estoque: 10,
        imagem: "",
      },
    ],
  };
}

function Bancada() {
  const barra = useBarraAcoplada();
  // Desmontado antes do JSX: o `receberPrateleira` vai a um `ref`, e o
  // eslint do React passaria a tratar o objeto inteiro como ref.
  const { altura, receberPrateleira } = barra;
  const [estado, despachar] = useReducer(
    reducerDaVenda,
    undefined,
    vendaDaBancada,
  );
  const subtotal = estado.itens.reduce(
    (soma, item) => soma + item.preco * item.quantidade,
    0,
  );
  return (
    <ContextoDaBarra.Provider value={barra}>
      <div
        className="flex flex-col overflow-hidden bg-admin-bg text-zinc-50"
        style={
          {
            height: "100dvh",
            "--admin-prateleira-altura": `${altura}px`,
            "--admin-tab-pb":
              "calc(6.25rem + var(--admin-prateleira-altura, 0px))",
          } as CSSProperties
        }
      >
        <header className="flex-shrink-0 border-b border-admin-border bg-admin-nav px-4">
          <div className="flex items-center gap-2 py-2.5">
            <span className="size-10 rounded-md" />
            <span className="text-lg font-bold">Balcão</span>
          </div>
        </header>
        <main className="w-full flex-1 overflow-x-hidden bg-admin-bg">
          <div className="relative mx-auto flex size-full max-w-7xl flex-col overflow-x-hidden">
            <div className="size-full">
              <div
                className="pdv pdv-viewport"
                data-etapa={estado.etapa}
                data-com-itens={estado.itens.length > 0}
                data-modo="buscar"
              >
                <CupomDaVenda
                  estado={estado}
                  despachar={despachar}
                  subtotal={subtotal}
                  onNavigate={() => {}}
                  limparCupom={() => {}}
                  feedback={null}
                />
                {estado.etapa === "fechamento" && (
                  <FechamentoDaVenda
                    estado={estado}
                    despachar={despachar}
                    aoRegistrarVenda={() =>
                      Promise.reject({
                        code: "23505",
                        message: "duplicate key",
                      })
                    }
                    limparCupom={() => {}}
                  />
                )}
              </div>
            </div>
          </div>
        </main>
      </div>
      <nav
        aria-label="Navegação inferior do painel"
        className="fixed inset-x-5 z-[60] mx-auto max-w-lg rounded-[2rem] border border-admin-border-strong bg-admin-nav"
        style={{ bottom: "0.75rem" }}
      >
        <div
          ref={receberPrateleira}
          role="group"
          aria-label="Ações da tela"
          className="admin-prateleira"
        />
        <div className="flex h-16 items-center p-1.5" data-admin-abas />
      </nav>
    </ContextoDaBarra.Provider>
  );
}

createRoot(document.getElementById("raiz") as HTMLElement).render(
  <StrictMode>
    <Bancada />
  </StrictMode>,
);
