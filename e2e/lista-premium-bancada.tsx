// Bancada do navegador real da lista de escolha do painel (tarefas 0.16 e Z.4).
//
// Dois jeitos de abrir:
//  - `?mae=painel|financeiro&abrir=<id>` (0.16): a lista DENTRO das duas
//    folhas do painel (FolhaDoPainel e FolhaFinanceira), com campos de exemplo.
//  - `?tela=<nome>` (Z.4): a folha ou seção DE VERDADE de cada tela que trocou
//    o `<select>` pela lista, com dados de mentira (sem banco, sem login, sem
//    rede: ver `lista-premium.vite.config.ts`). A bancada deixa a tela no
//    ponto e publica em `window.__bancada` o id do botão do campo; quem abre a
//    lista é o `lista-premium-fotos.mjs`, pelo teclado (↓), como a lojista.
//
// Fora do build, do tsconfig do app e do knip: só o `npx vite` da worktree
// serve esta página. `&tema=escuro|claro|confortavel` vale para os dois.
import "@/index.css";
import "@/components/layouts/temas-do-painel.css";
import "@/components/layouts/temas-do-painel-cores.css";
import { AbaExtrato } from "@/components/admin/financeiro/AbaExtrato";
import { ContaFolha } from "@/components/admin/financeiro/FolhasDeCadastro";
import { FolhaFinanceira } from "@/components/admin/financeiro/FolhaFinanceira";
import { NovoLancamentoFolha } from "@/components/admin/financeiro/NovoLancamentoFolha";
import { CadastroFiscalFolha } from "@/components/admin/financeiro/impostos/CadastroFiscalFolha";
import { ExportarParaContador } from "@/components/admin/financeiro/impostos/ExportarParaContador";
import { FolhaDoFornecedor } from "@/components/admin/fornecedores/FolhaDoFornecedor";
import { FolhaDoPainel } from "@/components/admin/primitivos/FolhaDoPainel";
import { CampoDeEscolha } from "@/components/admin/primitivos/lista-de-escolha/CampoDeEscolha";
import { ListaDeEscolha } from "@/components/admin/primitivos/lista-de-escolha/ListaDeEscolha";
import type { OpcaoDaLista } from "@/components/admin/primitivos/lista-de-escolha/tipos";
import { FormasDePagamentoSection } from "@/components/admin/settings/FormasDePagamentoCard";
import {
  CONTA_BANCARIA,
  CONTA_CAIXA_DA_LOJA,
  CONTA_MERCADO_PAGO,
  type CategoriaFinanceira,
  type ContaFinanceira,
} from "@/types/financeiro";
import { AdminBannersView } from "@/views/admin/AdminBannersView";
import { Banknote, ChevronDown, Landmark, Layers, Wallet } from "lucide-react";
import { type ReactNode, StrictMode, useEffect, useState } from "react";
import { createRoot } from "react-dom/client";

declare global {
  interface Window {
    /** O que o script de fotos espera: o botão do campo, ou o porquê de não achar. */
    __bancada?: { readonly gatilho: string } | { readonly erro: string };
  }
}

const parametros = new URLSearchParams(location.search);
const tema = parametros.get("tema") ?? "escuro";
const mae = parametros.get("mae") === "financeiro" ? "financeiro" : "painel";
const abrir = parametros.get("abrir");
const tela = parametros.get("tela");

if (tema === "claro" || tema === "confortavel") {
  document.documentElement.setAttribute("data-admin-tema", tema);
}

const PARCELAS: OpcaoDaLista[] = Array.from({ length: 12 }, (_, i) => ({
  valor: String(i + 1),
  rotulo: `${i + 1}x`,
  ...(i === 0 ? { subinfo: "à vista" } : {}),
}));

const UFS: OpcaoDaLista[] = [
  ["AC", "Acre"],
  ["AL", "Alagoas"],
  ["AP", "Amapá"],
  ["AM", "Amazonas"],
  ["BA", "Bahia"],
  ["CE", "Ceará"],
  ["DF", "Distrito Federal"],
  ["ES", "Espírito Santo"],
  ["GO", "Goiás"],
  ["MA", "Maranhão"],
  ["MT", "Mato Grosso"],
  ["MS", "Mato Grosso do Sul"],
  ["MG", "Minas Gerais"],
  ["PA", "Pará"],
  ["PB", "Paraíba"],
  ["PR", "Paraná"],
  ["PE", "Pernambuco"],
  ["PI", "Piauí"],
  ["RJ", "Rio de Janeiro"],
  ["RN", "Rio Grande do Norte"],
  ["RS", "Rio Grande do Sul"],
  ["RO", "Rondônia"],
  ["RR", "Roraima"],
  ["SC", "Santa Catarina"],
  ["SP", "São Paulo"],
  ["SE", "Sergipe"],
  ["TO", "Tocantins"],
].map(([sigla, nome]) => ({ valor: sigla, rotulo: nome, sigla }));

const CONTAS: OpcaoDaLista[] = [
  { valor: "caixa", rotulo: "Caixa da loja", icone: Banknote },
  { valor: "banco", rotulo: "Conta no banco", icone: Landmark },
  { valor: "mp", rotulo: "Mercado Pago", icone: Wallet },
  {
    valor: "velha",
    rotulo: "Carteira antiga",
    icone: Wallet,
    desabilitada: true,
  },
];

const FILTRO: OpcaoDaLista[] = [
  {
    valor: "",
    rotulo: "Todas as contas",
    subinfo: "Somar tudo",
    icone: Layers,
  },
  {
    valor: "caixa",
    rotulo: "Caixa da loja",
    subinfo: "Dinheiro em espécie",
    icone: Banknote,
  },
  {
    valor: "banco",
    rotulo: "Conta no banco",
    subinfo: "Conta bancária",
    icone: Landmark,
  },
  {
    valor: "mp",
    rotulo: "Mercado Pago",
    subinfo: "Saldo no Mercado Pago",
    icone: Wallet,
  },
];

function Campos() {
  const [parcelas, setParcelas] = useState("12");
  const [uf, setUf] = useState("SP");
  const [conta, setConta] = useState("");
  const [filtro, setFiltro] = useState("");

  // Abre o campo pedido depois de a folha-mãe montar (o clique é o da lojista).
  useEffect(() => {
    if (!abrir) return;
    const t = window.setTimeout(
      () => document.getElementById(abrir)?.click(),
      400,
    );
    return () => window.clearTimeout(t);
  }, []);

  return (
    <div style={{ display: "grid", gap: 16 }}>
      <ListaDeEscolha
        id="bancada-filtro"
        rotulo="Conta"
        tituloDaLista="Mostrar contas"
        opcoes={FILTRO}
        valor={filtro}
        aoMudar={setFiltro}
        gatilho={({ botao, textoMostrado, escolhida }) => (
          <button
            {...botao}
            aria-label={`Conta, ${textoMostrado}`}
            className="lista-de-escolha-anel inline-flex min-h-11 w-fit items-center gap-2 rounded-full border border-solid border-admin-border-strong bg-admin-raised px-4 text-sm font-semibold"
          >
            {escolhida?.icone ? (
              <escolhida.icone aria-hidden="true" className="size-4" />
            ) : null}
            <span className="lista-de-escolha-texto">{textoMostrado}</span>
            <ChevronDown aria-hidden="true" className="size-4" />
          </button>
        )}
      />
      <CampoDeEscolha
        id="bancada-parcelas"
        rotulo="Parcelar em até"
        opcoes={PARCELAS}
        valor={parcelas}
        aoMudar={setParcelas}
        busca={false}
        ajuda="Até quantas vezes o cliente pode dividir a compra no cartão."
      />
      <CampoDeEscolha
        id="bancada-uf"
        rotulo="Estado"
        opcoes={UFS}
        valor={uf}
        aoMudar={setUf}
      />
      <CampoDeEscolha
        id="bancada-conta"
        rotulo="Conta"
        opcoes={CONTAS}
        valor={conta}
        aoMudar={setConta}
        placeholder="Escolha uma conta"
        erro={conta === ""}
      />
      <CampoDeEscolha
        id="bancada-desabilitado"
        rotulo="Forma"
        opcoes={[{ valor: "pix", rotulo: "Pix" }]}
        valor="pix"
        aoMudar={() => {}}
        desabilitado
      />
    </div>
  );
}

function Bancada() {
  return mae === "financeiro" ? (
    <FolhaFinanceira titulo="Novo lançamento" aoFechar={() => {}}>
      <Campos />
    </FolhaFinanceira>
  ) : (
    <FolhaDoPainel aberta onFechar={() => {}} titulo="Ajustes do cartão">
      <Campos />
    </FolhaDoPainel>
  );
}

// ── Z.4: as telas de verdade ────────────────────────────────────────────────

const HOJE = "2026-11-26";
const nada = () => {};

const conta = (
  id: string,
  nome: string,
  tipo: ContaFinanceira["tipo"],
  ativa = true,
  sistema = false,
): ContaFinanceira => ({
  id,
  nome,
  tipo,
  saldoInicial: 0,
  saldoInicialEm: "2026-01-01",
  ativa,
  ordem: 0,
  sistema,
  saldo: 1250.4,
});

const CONTAS_DO_FINANCEIRO: ContaFinanceira[] = [
  conta(CONTA_CAIXA_DA_LOJA, "Caixa da loja", "caixa", true, true),
  conta(CONTA_BANCARIA, "Conta no banco", "banco", true, true),
  conta(CONTA_MERCADO_PAGO, "Mercado Pago", "mercado_pago", true, true),
  conta("c-cofre", "Cofre do escritório", "outro"),
  conta("c-antiga", "Carteira antiga", "outro", false),
];

const categoria = (
  id: string,
  nome: string,
  natureza: CategoriaFinanceira["natureza"],
  grupoDre: CategoriaFinanceira["grupoDre"],
): CategoriaFinanceira => ({
  id,
  nome,
  natureza,
  grupoDre,
  ativa: true,
  sistema: false,
});

const CATEGORIAS: CategoriaFinanceira[] = [
  categoria("k1", "Aluguel", "despesa", "despesa_fixa"),
  categoria("k2", "Embalagens", "despesa", "custo_variavel"),
  categoria("k3", "Energia elétrica", "despesa", "despesa_fixa"),
  categoria("k4", "Frete de compra", "despesa", "custo_variavel"),
  categoria("k5", "Internet e telefone", "despesa", "despesa_fixa"),
  categoria("k6", "Mercadoria para revenda", "despesa", "custo_variavel"),
  categoria("k7", "Tarifas do banco", "despesa", "despesa_fixa"),
  categoria("k8", "Vendas", "receita", "receita"),
  categoria("k9", "Serviços", "receita", "receita"),
];

const esperar = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** O botão do campo pelo texto do rótulo (campos com id de `useId`). */
function idPeloRotulo(rotulo: string): string | null {
  const label = [...document.querySelectorAll("label")].find(
    (l) => l.textContent?.trim() === rotulo && l.htmlFor,
  );
  return label?.htmlFor ?? null;
}

function abrirResumo(texto: string): boolean {
  const resumo = [...document.querySelectorAll("summary")].find(
    (s) => s.textContent?.trim() === texto,
  );
  if (resumo && !resumo.parentElement?.hasAttribute("open")) resumo.click();
  return !!resumo;
}

/** Banners: Editar o primeiro → Mais opções → textos ligados → Cores. */
async function prepararBanners(): Promise<string | null> {
  const editar = document.querySelector<HTMLButtonElement>(
    'button[title="Editar"]',
  );
  if (!editar) return null;
  editar.click();
  await esperar(600);
  if (!abrirResumo("Mais opções")) return null;
  await esperar(300);
  const textos = document.querySelector<HTMLButtonElement>("#banner-textos");
  if (textos?.getAttribute("aria-checked") !== "true") textos?.click();
  await esperar(300);
  if (!abrirResumo("Cores e filtro da imagem")) return null;
  await esperar(300);
  return "banner-theme";
}

interface TelaDaBancada {
  readonly montar: () => ReactNode;
  /** Deixa a tela no ponto e devolve o id do botão do campo. */
  readonly preparar: () => Promise<string | null> | string | null;
}

const pagina = (filho: ReactNode) => (
  <main className="min-h-screen bg-admin-bg px-4 py-6">
    <div className="mx-auto max-w-3xl">{filho}</div>
  </main>
);

const lancamento = (transferencia: boolean) => () => (
  <NovoLancamentoFolha
    hoje={HOJE}
    contas={CONTAS_DO_FINANCEIRO}
    categorias={CATEGORIAS}
    inicial={transferencia ? { tipo: "transferencia" } : undefined}
    aoFechar={nada}
    aoSalvar={nada}
    aoMudarSujo={nada}
  />
);

const TELAS = new Map<string, TelaDaBancada>(
  Object.entries({
    "lancamento-categoria": {
      montar: lancamento(false),
      preparar: () => "fin-lanc-categoria",
    },
    "lancamento-sai-de": {
      montar: lancamento(true),
      preparar: () => "fin-lanc-conta",
    },
    "lancamento-entra-em": {
      montar: lancamento(true),
      preparar: () => "fin-lanc-conta-destino",
    },
    "conta-tipo": {
      montar: () => (
        <ContaFolha
          conta={null}
          hoje={HOJE}
          aoFechar={nada}
          aoSalvar={nada}
          aoMudarSujo={nada}
        />
      ),
      preparar: () => "fin-conta-tipo",
    },
    "fiscal-regime": {
      montar: () => (
        <CadastroFiscalFolha
          cadastro={{
            regime: "simples",
            atividade: "comercio",
            abertaEm: "2021-03-10",
            vendeNoAppDesde: "2025-01-01",
            atualizadoEm: null,
            atualizadoPor: null,
          }}
          hoje={HOJE}
          situacao="sou_o_dono"
          aoFechar={nada}
          aoSalvar={nada}
          aoSemResposta={nada}
        />
      ),
      preparar: () => "fiscal-cadastro-regime",
    },
    "contador-mes": {
      montar: () =>
        pagina(
          <ExportarParaContador
            agora={new Date("2026-11-26T15:00:00-03:00")}
            buscarLinhas={() => new Promise(() => {})}
          />,
        ),
      preparar: () => idPeloRotulo("Mês"),
    },
    "cartao-parcelas": {
      montar: () =>
        pagina(
          <FormasDePagamentoSection
            formasNaEntrega={["pix", "card", "cash"]}
            pixLigado
            pixChaveOk
            isOffline={false}
            updateConfig={async () => true}
            onAbrirMercadoPago={nada}
          />,
        ),
      // O campo só aparece depois da leitura (de mentira) do cartão.
      preparar: async () => {
        await esperar(300);
        return idPeloRotulo("Parcelar em até");
      },
    },
    "fornecedor-uf": {
      montar: () => (
        <FolhaDoFornecedor
          aberta
          fornecedor={{
            id: "forn-bancada",
            nome: "Distribuidora Exemplo",
            whatsapp: null,
            instagram: null,
            site: null,
            cidade: "Niterói",
            uf: "RJ",
            observacoes: null,
            favorito: false,
          }}
          offline={false}
          aoFechar={nada}
          aoSalvar={async () => undefined}
          aoMudarSujo={nada}
        />
      ),
      preparar: () => idPeloRotulo("Estado"),
    },
    "banners-combinacoes": {
      montar: () => (
        <AdminBannersView onNavigate={nada} active onSetBackOverride={nada} />
      ),
      preparar: prepararBanners,
    },
    "extrato-chip": {
      montar: () =>
        pagina(
          <AbaExtrato
            ativo
            intervalo={{ inicio: "2026-11-01", fim: "2026-11-30" }}
            hoje={HOJE}
            versao={0}
            contas={CONTAS_DO_FINANCEIRO}
            rotuloDoPeriodo="Novembro de 2026"
            abrirFolha={nada}
            aoNovoLancamento={nada}
          />,
        ),
      preparar: () => "fin-extrato-conta",
    },
  }),
);

function TelaReal({ nome }: { readonly nome: string }) {
  const escolhida = TELAS.get(nome);
  useEffect(() => {
    if (!escolhida) {
      window.__bancada = { erro: `tela desconhecida: ${nome}` };
      return;
    }
    // A folha anima ao abrir: só depois dela a tela está no ponto.
    const t = window.setTimeout(async () => {
      const gatilho = await escolhida.preparar();
      window.__bancada =
        gatilho && document.getElementById(gatilho)
          ? { gatilho }
          : { erro: `campo não achado em ${nome}` };
    }, 500);
    return () => window.clearTimeout(t);
  }, [escolhida, nome]);
  return escolhida ? escolhida.montar() : null;
}

const raiz = document.getElementById("raiz");
if (raiz) {
  createRoot(raiz).render(
    <StrictMode>{tela ? <TelaReal nome={tela} /> : <Bancada />}</StrictMode>,
  );
}
