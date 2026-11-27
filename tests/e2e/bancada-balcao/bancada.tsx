// Bancada do fechamento do balcão (servida por
// `tests/e2e/jornada-balcao-desconto-no-celular.spec.ts`).
//
// Monta `FechamentoDaVenda` com a máquina REAL da venda (`reducerDaVenda`) e
// um item no cupom, dentro da mesma cadeia de caixas que o painel desenha no
// celular: o `<main>` de altura cheia do AdminLayout, sem padding lateral, e a
// `.pdv-viewport` na etapa "fechamento". A barra de ações fica de fora: no
// aparelho ela vai para a prateleira de baixo, fora da área medida.
import "@/index.css";
import "@/components/layouts/temas-do-painel.css";
import "@/components/layouts/temas-do-painel-cores.css";
import { FechamentoDaVenda } from "@/components/admin/pdv/FechamentoDaVenda";
import { ContextoDaBarra } from "@/components/layouts/AcaoDaBarra";
import {
  type EstadoDaVenda,
  estadoInicialDaVenda,
  reducerDaVenda,
} from "@/hooks/useVendaPresencial";
import { StrictMode, useReducer } from "react";
import { createRoot } from "react-dom/client";

// As classes do balcão moram no pdv.css, não no Tailwind.
const CAIXA_DO_BALCAO = "pdv pdv-viewport";

// Celular SEM prateleira montada: `AcaoDaBarra` não desenha nada (como com o
// teclado aberto), em vez de cair inline por cima do fechamento.
const BARRA_DO_CELULAR = {
  destino: null,
  receberPrateleira: () => {},
  larga: false,
  altura: 0,
};

function vendaNoFechamento(): EstadoDaVenda {
  return {
    ...estadoInicialDaVenda(),
    etapa: "fechamento",
    itens: [
      {
        chave: "produto-1::",
        productId: "produto-1",
        variantId: null,
        nome: "Vestido da Bancada",
        variacao: null,
        preco: 199_999.99,
        quantidade: 1,
        estoque: 10,
        imagem: "",
      },
    ],
  };
}

function Bancada() {
  const [estado, despachar] = useReducer(
    reducerDaVenda,
    undefined,
    vendaNoFechamento,
  );
  return (
    <ContextoDaBarra.Provider value={BARRA_DO_CELULAR}>
      <main style={{ width: "100%", height: "100dvh", overflowX: "hidden" }}>
        <div className={CAIXA_DO_BALCAO} data-etapa={estado.etapa}>
          <FechamentoDaVenda
            estado={estado}
            despachar={despachar}
            aoRegistrarVenda={async () => {}}
            limparCupom={() => {}}
          />
        </div>
      </main>
    </ContextoDaBarra.Provider>
  );
}

createRoot(document.getElementById("raiz") as HTMLElement).render(
  <StrictMode>
    <Bancada />
  </StrictMode>,
);
