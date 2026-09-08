//
// Onda 3 do laudo de acessibilidade da LOJA — SÓ INVISÍVEL (decisão do
// `socio`, entregas/20260908-laudo-socio-frentes-da-janela-paralela.md):
// os 6 itens aqui só existem para quem navega por teclado ou leitor de
// tela. Quem usa o dedo (mouse/touch) não vê UM pixel mudar — a mesma
// trava das ondas 1-2 (acess-onda1-0509-contrato.test.tsx,
// acess-onda2-contrato.test.tsx), que este arquivo espelha.
//
// Por que lê FONTE e não renderiza os componentes: as views arrastam
// hooks, supabase e framer-motion (mesma decisão dos contratos
// anteriores). O que se prova aqui é a marcação.
//
// `import.meta.glob` com `?raw` lê os arquivos em tempo de build do
// vitest, sem API de Node.
import { describe, expect, it } from "vitest";

const FONTES_CUSTOMER = import.meta.glob<string>("/src/views/customer/*.tsx", {
  query: "?raw",
  import: "default",
  eager: true,
});

const FONTES_COMPONENTES = import.meta.glob<string>(
  "/src/components/ui/custom/*.tsx",
  { query: "?raw", import: "default", eager: true },
);

const FONTES: Record<string, string> = {
  ...FONTES_CUSTOMER,
  ...FONTES_COMPONENTES,
};

function fonte(caminho: string): string {
  expect(FONTES, `falta o fonte de ${caminho}`).toHaveProperty(caminho);
  return FONTES[caminho] as string;
}

const SEARCH_BAR = "/src/components/ui/custom/SearchBar.tsx";
const HEADER = "/src/components/ui/custom/Header.tsx";
const HOME = "/src/views/customer/HomeView.tsx";
const CART = "/src/views/customer/CartView.tsx";
const PRODUCT = "/src/views/customer/ProductView.tsx";
const ORDER_DETAILS = "/src/views/customer/OrderDetailsView.tsx";

describe("o glob casou os arquivos que a onda 3 toca (nada de prova vazia)", () => {
  const esperados = [SEARCH_BAR, HEADER, HOME, CART, PRODUCT, ORDER_DETAILS];
  it("os 6 fontes existem no glob", () => {
    for (const caminho of esperados) {
      expect(FONTES, `falta o fonte de ${caminho}`).toHaveProperty(caminho);
    }
  });
});

describe("item 1 — anel de foco do campo de busca", () => {
  it("o input global-search repõe focus-visible:ring-2 (padrão do PR #437)", () => {
    const src = fonte(SEARCH_BAR);
    expect(src).toContain(
      "focus-visible:ring-2 focus-visible:ring-zinc-900/50",
    );
    // O override que apagava o anel (M3 do laudo 05/09, aqui esquecido no
    // input de busca) não pode sobreviver.
    expect(src).not.toMatch(/focus-visible:ring-0/);
    expect(src).not.toMatch(/focus-visible:outline-none/);
  });

  it("só o anel muda — o resto da classe do input é byte-idêntico", () => {
    const src = fonte(SEARCH_BAR);
    expect(src).toContain(
      'className="relative z-20 h-full rounded-full border-transparent bg-transparent pl-12 pr-10 text-sm font-bold tracking-tight text-zinc-900 shadow-none placeholder:font-medium placeholder:text-zinc-500 focus:outline-none focus:ring-0 focus-visible:ring-2 focus-visible:ring-zinc-900/50"',
    );
  });
});

describe("item 2 — B1: h1 oculto na home e no carrinho", () => {
  it("HomeView ganha um h1 sr-only com o nome da loja", () => {
    const src = fonte(HOME);
    expect(src).toMatch(/<h1\s+className="sr-only">\{nomeDaLoja\}<\/h1>/);
  });

  it("CartView ganha um h1 sr-only 'Carrinho'", () => {
    const src = fonte(CART);
    expect(src).toMatch(/<h1\s+className="sr-only">Carrinho<\/h1>/);
  });
});

describe("item 3 — B2: abas semânticas do carrinho e do produto", () => {
  it("CartView: Carrinho/Meus Pedidos viram tablist com tabs e painéis ligados", () => {
    const src = fonte(CART);
    expect(src).toContain('role="tablist"');
    // Cada botão de aba precisa do PRÓPRIO role="tab" — checagem genérica
    // (um "toContain" só) passa mesmo faltando num dos dois, porque o
    // outro ainda casa (mutação #1: tirar o role="tab" do botão "cart" e
    // ver este teste cair sozinho, sem depender do botão "orders").
    const blocoTabCart = src.slice(
      src.indexOf('id="tab-cart"'),
      src.indexOf("</button>", src.indexOf('id="tab-cart"')),
    );
    const blocoTabOrders = src.slice(
      src.indexOf('id="tab-orders"'),
      src.indexOf("</button>", src.indexOf('id="tab-orders"')),
    );
    expect(blocoTabCart).toContain('role="tab"');
    expect(blocoTabCart).toContain('aria-selected={activeTab === "cart"}');
    expect(blocoTabCart).toContain('aria-controls="painel-cart"');
    expect(blocoTabOrders).toContain('role="tab"');
    expect(blocoTabOrders).toContain('aria-selected={activeTab === "orders"}');
    expect(blocoTabOrders).toContain('aria-controls="painel-orders"');
    expect(src).toContain('role="tabpanel"');
    expect(src).toContain('id="painel-cart"');
    expect(src).toContain('id="painel-orders"');
    expect(src).toContain('aria-labelledby="tab-cart"');
    expect(src).toContain('aria-labelledby="tab-orders"');
  });

  it("ProductView: Detalhes/Avaliações/Perguntas viram tablist ligada aos painéis", () => {
    const src = fonte(PRODUCT);
    expect(src).toContain('role="tablist"');
    expect(src).toContain('role="tab"');
    expect(src).toMatch(/aria-selected=\{isActive\}/);
    expect(src).toMatch(/aria-controls=\{painelDaAba\(tabId\)\}/);
    expect(src).toContain('role="tabpanel"');
    expect(src).toContain('aria-labelledby="tab-description"');
    expect(src).toContain('aria-labelledby="tab-reviews"');
    expect(src).toContain('aria-labelledby="tab-questions"');
  });

  it("classes visuais dos botões de aba do produto preservadas byte a byte", () => {
    const src = fonte(PRODUCT);
    expect(src).toContain(
      'className="relative flex-1 rounded-full p-1 text-[9px] font-bold uppercase tracking-wider outline-none transition-colors duration-300 focus-visible:ring-2 focus-visible:ring-zinc-900/50"',
    );
  });
});

describe("item 4 — B5: Esc fecha de verdade", () => {
  it("menu de ordenar da home: o listbox escuta Escape e devolve o foco ao botão que abriu", () => {
    const src = fonte(HOME);
    // A escuta viva sai do overlay morto (tabIndex=-1, nunca alcançado por
    // teclado) e passa a existir de fato no container do menu.
    expect(src).toContain("sortButtonRef");
    expect(src).toContain("sortButtonRef.current?.focus()");
    const inicio = src.indexOf('role="listbox"');
    const fim = src.indexOf('<div className="mb-1 border-b border-zinc-50');
    expect(inicio).toBeGreaterThan(-1);
    expect(fim).toBeGreaterThan(inicio);
    const aberturaDoMenu = src.slice(inicio, fim);
    expect(aberturaDoMenu).toMatch(/e\.key === "Escape"/);
    expect(aberturaDoMenu).toContain("setShowSortMenu(false)");
    // O overlay morto não intercepta mais Escape — só Enter/Espaço.
    const inicioOverlay = src.indexOf('aria-label="Fechar menu"');
    const trechoOverlay = src.slice(inicioOverlay, inicio);
    expect(trechoOverlay).not.toMatch(/e\.key === "Escape"/);
  });

  it("folha de avaliação do pedido: dialog semântico, Escape fecha e o foco volta ao gatilho", () => {
    const src = fonte(ORDER_DETAILS);
    expect(src).toContain('role="dialog"');
    expect(src).toContain('aria-modal="true"');
    expect(src).toContain('aria-labelledby="titulo-avaliacao"');
    expect(src).toContain('id="titulo-avaliacao"');
    expect(src).toContain("avaliarTriggerRef");
    expect(src).toContain("fecharAvaliacao");
  });
});

describe("item 6 — B9: aviso do topo do Header alcançável por teclado", () => {
  it("o card do aviso vira motion.button (Tab alcança, Enter nativo, Esc fecha)", () => {
    const src = fonte(HEADER);
    const inicio = src.indexOf("<motion.button");
    // O fim da abertura da tag é o próprio className do card — usado
    // também na prova de classes preservadas logo abaixo.
    const fim = src.indexOf(
      'backdrop-blur-md transition-all hover:border-zinc-700 active:scale-95"',
    );
    expect(inicio).toBeGreaterThan(-1);
    expect(fim).toBeGreaterThan(inicio);
    const aberturaDoBotao = src.slice(inicio, fim);
    expect(aberturaDoBotao).toContain('type="button"');
    expect(aberturaDoBotao).toMatch(/e\.key === "Escape"/);
    expect(aberturaDoBotao).toContain("setActiveToast(null)");
  });

  it("classes visuais do card do aviso preservadas byte a byte", () => {
    const src = fonte(HEADER);
    expect(src).toContain(
      'className="flex shrink-0 cursor-pointer items-center gap-2 overflow-hidden whitespace-nowrap rounded-full border border-zinc-800 bg-gradient-to-r from-zinc-950 via-zinc-900 to-zinc-950 py-1.5 pl-2 pr-3.5 text-white shadow-[0_8px_25px_rgba(0,0,0,0.4)] backdrop-blur-md transition-all hover:border-zinc-700 active:scale-95"',
    );
  });
});
