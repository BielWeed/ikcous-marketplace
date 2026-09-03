import { AlertCircle, CheckCircle2, ExternalLink, HelpCircle, RefreshCw } from "lucide-react";
import { memo } from "react";

/**
 * Bloco "Frete nacional" da tela de Frete v2 — para quem compra FORA da
 * cidade. Verdade nova desta frente (ordem do dono, 03/09/2026): a cotação
 * de fora é SÓ de transportadora real (Melhor Envio/Frenet) — o card "Taxa
 * de entrega fixa" MORRE e não volta (o campo `shippingFee` fica órfão no
 * banco de propósito; este bloco nem o exibe nem o salva).
 *
 * O estado da conexão chega PRONTO da view (que lê a credencial salva da
 * mesma tabela que a seção de Transportadoras em Ajustes grava — esta tela
 * só LÊ, nunca grava credencial nem `shippingProvider`):
 * - "conectado": credencial com token para o provedor salvo;
 * - "desconectado": provedor de cotação salvo sem credencial, ou taxa fixa
 *   remanescente de loja antiga — em ambos, a loja de fora NÃO é atendida;
 * - "indeterminado": a leitura das credenciais falhou — a tela não sabe, e
 *   não finge saber (estados honestos são a lei deste repo).
 */
export type EstadoConexaoNacional =
  | "conectado"
  | "desconectado"
  | "indeterminado";

const formatCEP = (val: string) => {
  const clean = val.replace(/\D/g, "");
  if (clean.length <= 5) return clean;
  return `${clean.slice(0, 5)}-${clean.slice(5, 8)}`;
};

export const FreteNacionalBloco = memo(function FreteNacionalBloco({
  originCep,
  onOriginCep,
  coverage,
  onCoverage,
  conexao,
  onAbrirAjustes,
  onTentarDeNovo,
  desabilitado,
}: {
  readonly originCep: string;
  readonly onOriginCep: (cep: string) => void;
  readonly coverage: "local" | "national";
  readonly onCoverage: (coverage: "local" | "national") => void;
  readonly conexao: {
    readonly estado: EstadoConexaoNacional;
    /**
     * Nome do provedor salvo ("Melhor Envio", "Frenet") — ou NULL quando o
     * config não nomeia transportadora (flat_fee remanescente de loja antiga
     * ou ausente). REVISÃO A5: o nulo define o ARTIGO da frase do estado
     * desconectado — "conecte o Melhor Envio" x "conecte uma transportadora";
     * jamais "conecte o uma transportadora". No estado `conectado` o nome
     * nunca é nulo (a view só conecta provedor nomeado + credencial).
     */
    readonly provedorNome: string | null;
  };
  readonly onAbrirAjustes?: () => void;
  readonly onTentarDeNovo?: () => void;
  readonly desabilitado?: boolean;
}) {
  return (
    <section
      id="bloco-frete-nacional"
      aria-label="Frete nacional"
      className="relative scroll-mt-24 overflow-hidden rounded-3xl border border-white/10 bg-zinc-900/40 p-5 shadow-xl backdrop-blur-md sm:p-6"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-start gap-3">
          <div className="flex size-10 shrink-0 items-center justify-center rounded-2xl border border-sky-500/30 bg-sky-500/10 text-sky-400">
            {/* A terra inteira: frete para fora da cidade. */}
            <svg
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              className="size-5"
              aria-hidden="true"
            >
              <circle cx="12" cy="12" r="10" />
              <path d="M12 2a14.5 14.5 0 0 0 0 20 14.5 14.5 0 0 0 0-20" />
              <path d="M2 12h20" />
            </svg>
          </div>
          <div>
            <h2 className="text-sm font-extrabold text-white">
              Frete nacional
            </h2>
            <p className="mt-0.5 max-w-[26ch] text-[11px] leading-snug text-zinc-400 sm:max-w-none">
              Para quem compra fora da sua cidade — cotação real de
              transportadora, na hora.
            </p>
          </div>
        </div>
      </div>

      {/* ── Estado da conexão — o primeiro thing a se ler no bloco ── */}
      {conexao.estado === "conectado" ? (
        <div className="mt-5 flex flex-col gap-3 rounded-2xl border border-emerald-500/25 bg-emerald-500/[0.07] p-4 sm:flex-row sm:items-center sm:justify-between">
          <p className="flex items-start gap-2.5 text-[11.5px] font-semibold leading-snug text-emerald-200">
            <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-emerald-400" />
            Conectado ao {conexao.provedorNome} — o frete de fora é cotado na
            hora, com preço real da transportadora.
          </p>
          {onAbrirAjustes && (
            <button
              type="button"
              onClick={onAbrirAjustes}
              className="flex shrink-0 items-center gap-1.5 self-start rounded-lg border border-white/10 bg-zinc-900 px-3 py-2 text-[10px] font-black uppercase tracking-widest text-zinc-300 transition-colors hover:border-white/20 hover:text-white active:scale-95 sm:self-center"
            >
              <ExternalLink className="size-3.5 text-sky-400" />
              <span>Abrir Ajustes</span>
            </button>
          )}
        </div>
      ) : conexao.estado === "indeterminado" ? (
        <div className="mt-5 flex flex-col gap-3 rounded-2xl border border-white/10 bg-black/40 p-4 sm:flex-row sm:items-center sm:justify-between">
          <p className="flex items-start gap-2.5 text-[11.5px] font-medium leading-snug text-zinc-300">
            <HelpCircle className="mt-0.5 size-4 shrink-0 text-zinc-400" />
            Não foi possível confirmar a conexão com a transportadora. Sem
            confirmar, não dá para garantir que entregas fora da cidade
            funcionem.
          </p>
          {onTentarDeNovo && (
            <button
              type="button"
              onClick={onTentarDeNovo}
              className="flex shrink-0 items-center gap-1.5 self-start rounded-lg border border-white/10 bg-zinc-900 px-3 py-2 text-[10px] font-black uppercase tracking-widest text-zinc-300 transition-colors hover:border-white/20 hover:text-white active:scale-95 sm:self-center"
            >
              <RefreshCw className="size-3.5" />
              <span>Tentar de novo</span>
            </button>
          )}
        </div>
      ) : (
        /* Desconectado: o aviso que o dono pediu BEM VISÍVEL. Loja sem
           transportadora conectada só entrega na cidade — quem compra de
           fora não é atendido, e a tela diz isso sem rodeio. */
        <div className="mt-5 flex flex-col gap-3 rounded-2xl border border-amber-500/40 bg-amber-500/10 p-4 duration-200 animate-in fade-in sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-start gap-2.5">
            <AlertCircle className="mt-0.5 size-4 shrink-0 text-amber-400" />
            <div>
              <p className="text-[12px] font-black leading-snug text-amber-200">
                Nenhuma transportadora conectada — sua loja só entrega na
                sua cidade.
              </p>
              <p className="mt-1 text-[11px] font-medium leading-snug text-amber-200/80">
                {/* REVISÃO A5 (frete v2, 03/09): o artigo acompanha o nome
                    que o config salvou. Provedor nomeado leva "o" ("conecte o
                    Melhor Envio"); sem nome (flat_fee remanescente ou
                    ausente) a frase é "conecte uma transportadora" — nunca
                    "conecte o uma transportadora". */}
                Para vender para todo o Brasil,{" "}
                {conexao.provedorNome
                  ? `conecte o ${conexao.provedorNome} em Ajustes`
                  : "conecte uma transportadora em Ajustes"}
                . Quem compra de fora não consegue fechar o pedido até lá.
              </p>
            </div>
          </div>
          {onAbrirAjustes && (
            <button
              type="button"
              onClick={onAbrirAjustes}
              className="flex shrink-0 items-center gap-1.5 self-start rounded-xl border border-amber-500/40 bg-amber-500 px-4 py-2.5 text-[11px] font-black uppercase tracking-wide text-black shadow-lg shadow-amber-500/20 transition-all hover:opacity-90 active:scale-95 sm:self-center"
            >
              <span>Conectar transportadora</span>
            </button>
          )}
        </div>
      )}

      <div className="mt-5 grid grid-cols-1 gap-5 sm:grid-cols-2">
        {/* CEP da loja — a única tela onde ele se define. Campo abre VAZIO
            quando a loja não configurou (nada de CEP inventado parecendo
            configuração pronta — trava herdada da auditoria 26/08). */}
        <div className="space-y-2">
          <label
            htmlFor="origin-cep"
            className="block text-xs font-bold text-zinc-200"
          >
            CEP da loja
            <span className="ml-1.5 font-medium text-zinc-500">
              de onde os pedidos partem
            </span>
          </label>
          <input
            id="origin-cep"
            type="text"
            maxLength={9}
            value={originCep}
            onChange={(e) => onOriginCep(formatCEP(e.target.value))}
            placeholder="00000-000"
            className="h-11 w-full rounded-2xl border border-white/10 bg-black/60 px-4 font-mono text-xs font-semibold text-white placeholder-zinc-600 transition-all focus:border-sky-500 focus:outline-none"
            disabled={desabilitado}
          />
          {!originCep && (
            <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 px-3 py-2">
              <p className="flex items-start gap-1.5 text-[10.5px] font-bold text-amber-300">
                <AlertCircle className="mt-0.5 size-3.5 shrink-0" />
                SEM ISSO A LOJA NÃO VENDE: sem o CEP da loja nenhum frete é
                calculado e o botão "Finalizar Pedido" fica bloqueado para
                todo cliente. Preencha, confira o campo acima e SALVE para
                abrir as vendas.
              </p>
            </div>
          )}
        </div>

        {/* Cobertura — decide se o CEP de fora é atendido. */}
        <div className="space-y-2">
          <span className="block text-xs font-bold text-zinc-200">
            Para onde a loja entrega
          </span>
          <div className="grid grid-cols-2 gap-1 rounded-2xl border border-white/10 bg-black/60 p-1">
            <button
              type="button"
              aria-pressed={coverage === "local"}
              onClick={() => onCoverage("local")}
              disabled={desabilitado}
              className={`h-9 rounded-xl text-[11px] font-bold transition-all ${
                coverage === "local"
                  ? "bg-sky-500 text-black shadow-md shadow-sky-500/20"
                  : "text-zinc-400 hover:text-white"
              }`}
            >
              Só minha cidade
            </button>
            <button
              type="button"
              aria-pressed={coverage === "national"}
              onClick={() => onCoverage("national")}
              disabled={desabilitado}
              className={`h-9 rounded-xl text-[11px] font-bold transition-all ${
                coverage === "national"
                  ? "bg-sky-500 text-black shadow-md shadow-sky-500/20"
                  : "text-zinc-400 hover:text-white"
              }`}
            >
              Todo o Brasil
            </button>
          </div>
          <p className="text-[10.5px] leading-snug text-zinc-500">
            "Só minha cidade" fecha a loja para o resto do país. A lista de
            serviços (Sedex, PAC, Jadlog) fica em Ajustes &gt;
            Transportadoras.
          </p>
        </div>
      </div>
    </section>
  );
});
