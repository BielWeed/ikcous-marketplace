// Bancada do navegador real da lista de escolha do painel (tarefa 0.16).
//
// Monta a lista DENTRO das duas folhas de verdade do painel (FolhaDoPainel e
// FolhaFinanceira), no tema pedido, e abre o campo pedido — para tirar as
// fotos de 390×844 e 1440×900 e medir o z-index computado. Fora do build, do
// tsconfig do app e do knip: só o `npx vite` da worktree serve esta página.
//
// Parâmetros: ?tema=escuro|claro|confortavel  &mae=painel|financeiro
//             &abrir=<id do campo>  (ex.: bancada-parcelas, bancada-uf)
import "@/index.css";
import "@/components/layouts/temas-do-painel.css";
import "@/components/layouts/temas-do-painel-cores.css";
import { FolhaFinanceira } from "@/components/admin/financeiro/FolhaFinanceira";
import { FolhaDoPainel } from "@/components/admin/primitivos/FolhaDoPainel";
import { CampoDeEscolha } from "@/components/admin/primitivos/lista-de-escolha/CampoDeEscolha";
import { ListaDeEscolha } from "@/components/admin/primitivos/lista-de-escolha/ListaDeEscolha";
import type { OpcaoDaLista } from "@/components/admin/primitivos/lista-de-escolha/tipos";
import { Banknote, ChevronDown, Landmark, Layers, Wallet } from "lucide-react";
import { StrictMode, useEffect, useState } from "react";
import { createRoot } from "react-dom/client";

const parametros = new URLSearchParams(location.search);
const tema = parametros.get("tema") ?? "escuro";
const mae = parametros.get("mae") === "financeiro" ? "financeiro" : "painel";
const abrir = parametros.get("abrir");

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

const raiz = document.getElementById("raiz");
if (raiz) {
  createRoot(raiz).render(
    <StrictMode>
      <Bancada />
    </StrictMode>,
  );
}
