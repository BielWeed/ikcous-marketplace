import { IconePix } from "@/components/admin/primitivos/IconePix";
import { cn } from "@/lib/utils";
import { AnimatePresence, motion } from "framer-motion";
import { CreditCard } from "lucide-react";
import { type ComponentType, useId, useState } from "react";

// Termômetros somente de leitura: ligado + chave pública, sem testar o provedor.
type EstadoDaLeitura = "ok" | "carregando" | "falhou";
type NivelDoPagamento = "ok" | "alerta" | "off" | "carregando" | "falhou";

interface StatusPagamentoPixProps {
  readonly ligado: boolean;
  readonly chaveOk: boolean;
}

// Map (não Record indexado por variável): o eslint-security acusa
// `detect-object-injection` em dicionário[variável] — e o teto do lint
// reprova warning novo.
// Texto na língua da loja (G4 do painel simples): cada nível diz o que houve
// e o que fazer, sem nome de segredo, de servidor nem de configuração interna.
// O "ok" só enxerga ligado + chave pública: a senha dos avisos (sem a qual a
// cobrança do PIX é recusada) não chega aqui, então o texto não promete mais.
const DIAGNOSTICO_DO_PIX = new Map<NivelDoPagamento, string>([
  [
    "ok",
    "Ligado e com a chave pública da loja. Se algum cliente não conseguir pagar por PIX, confira em Pagamentos › Mercado Pago se não falta nenhuma chave.",
  ],
  [
    "alerta",
    "O pagamento online está ligado, mas falta a chave pública da loja: a tela de pagamento não abre para o cliente. Salve as chaves de novo em Pagamentos › Mercado Pago; se continuar, fale com o suporte técnico.",
  ],
  [
    "off",
    "O cliente paga na entrega. Para receber por PIX no app, cadastre as chaves em Pagamentos › Mercado Pago.",
  ],
]);

const DIAGNOSTICO_DO_CARTAO = new Map<NivelDoPagamento, string>([
  [
    "ok",
    "Isso só confirma que está ligado e com a chave pública da loja. Não confirma uma cobrança. Para conferir, faça a compra de valor baixo indicada em Formas de pagamento.",
  ],
  [
    "alerta",
    "O cartão pelo app está ligado, mas falta a chave pública da loja. Salve as chaves de novo em Pagamentos › Mercado Pago.",
  ],
  [
    "off",
    "Para receber com cartão pelo app, ligue crédito ou débito em Formas de pagamento. O pagamento pelo app também precisa estar liberado em Pagamentos › Mercado Pago.",
  ],
  ["carregando", "Estou lendo a configuração do cartão. Aguarde um instante."],
  [
    "falhou",
    "Não consegui ler a configuração do cartão. Abra Formas de pagamento para tentar de novo.",
  ],
]);

const ROTULO = new Map<NivelDoPagamento, string>([
  ["ok", "Funcionando"],
  ["alerta", "Chave ausente"],
  ["off", "Desligado"],
  ["carregando", "Verificando…"],
  ["falhou", "Não consegui verificar"],
]);

/** Barra acesa mais alta por nível (o "nível do termômetro"). */
const NIVEL_ACESO = new Map<NivelDoPagamento, number>([
  ["ok", 3],
  ["alerta", 1],
  ["off", 0],
]);

export function StatusPagamentoPix({
  ligado,
  chaveOk,
}: StatusPagamentoPixProps) {
  return (
    <StatusPagamento
      nome="Pagamento online (PIX)"
      icone={IconePix}
      ligado={ligado}
      chaveOk={chaveOk}
      diagnosticos={DIAGNOSTICO_DO_PIX}
    />
  );
}

export function StatusPagamentoCartao({
  ligado,
  chaveOk,
  estado,
}: StatusPagamentoPixProps & { readonly estado: EstadoDaLeitura }) {
  return (
    <StatusPagamento
      nome="Cartão pelo app"
      icone={CreditCard}
      ligado={ligado}
      chaveOk={chaveOk}
      estado={estado}
      diagnosticos={DIAGNOSTICO_DO_CARTAO}
    />
  );
}

function StatusPagamento({
  nome,
  icone: Icone,
  ligado,
  chaveOk,
  estado = "ok",
  diagnosticos,
}: StatusPagamentoPixProps & {
  readonly nome: string;
  readonly icone: ComponentType<{ className?: string }>;
  readonly estado?: EstadoDaLeitura;
  readonly diagnosticos: ReadonlyMap<NivelDoPagamento, string>;
}) {
  const [aberto, setAberto] = useState(false);
  const diagnosticoId = useId();

  const nivel: NivelDoPagamento =
    estado !== "ok" ? estado : !ligado ? "off" : chaveOk ? "ok" : "alerta";
  const rotulo = ROTULO.get(nivel) ?? "";

  const corAcesa =
    nivel === "ok" ? "bg-emerald-400" : nivel === "alerta" ? "bg-red-400" : "";
  const corDoRotulo =
    nivel === "ok"
      ? "text-emerald-400"
      : nivel === "alerta"
        ? "text-red-400"
        : "text-zinc-400";

  const alturas = ["h-1.5", "h-2.5", "h-3.5"];

  return (
    <div className="rounded-2xl border border-white/5 bg-zinc-950/40">
      <button
        type="button"
        onClick={() => setAberto((antes) => !antes)}
        aria-label={`${nome}: ${rotulo}`}
        aria-expanded={aberto}
        aria-controls={diagnosticoId}
        className="grid min-h-11 w-full grid-cols-2 items-center gap-3 rounded-2xl px-4 py-2.5 text-left transition-colors hover:bg-white/[0.02] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-300"
      >
        <span className="flex min-w-0 items-center gap-2.5">
          <span aria-hidden="true" className={cn("shrink-0", corDoRotulo)}>
            <Icone className="size-4" />
          </span>
          <span className="min-w-0 break-words text-[11px] font-bold text-zinc-200">
            {nome}
          </span>
        </span>

        <span className="flex min-w-0 items-center justify-end gap-2.5">
          <span
            className={cn(
              "min-w-0 break-words text-right text-[11px] font-bold",
              corDoRotulo,
            )}
          >
            {rotulo}
          </span>
          {/* Termômetro: 3 barras; acesas até o nível do estado. */}
          <span
            className="flex shrink-0 items-end gap-[3px]"
            aria-hidden="true"
          >
            {alturas.map((altura, indice) => (
              <span
                key={altura}
                className={cn(
                  "w-[3px] rounded-full transition-colors",
                  altura,
                  indice < (NIVEL_ACESO.get(nivel) ?? 0)
                    ? corAcesa
                    : "bg-zinc-700/80",
                  nivel === "alerta" &&
                    indice === 0 &&
                    "animate-pulse shadow-[0_0_6px_rgba(248,113,113,0.6)]",
                )}
              />
            ))}
          </span>
        </span>
      </button>

      <AnimatePresence initial={false}>
        {aberto && (
          <motion.div
            id={diagnosticoId}
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2, ease: "easeOut" }}
            className="overflow-hidden"
          >
            <p className="border-t border-white/5 px-4 pb-3 pt-2.5 text-[11px] leading-relaxed text-zinc-400">
              {diagnosticos.get(nivel) ?? ""}
            </p>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
