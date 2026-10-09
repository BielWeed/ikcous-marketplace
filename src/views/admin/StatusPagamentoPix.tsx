import { cn } from "@/lib/utils";
import { AnimatePresence, motion } from "framer-motion";
import { Wallet } from "lucide-react";
import { useState } from "react";

/**
 * Termômetro do pagamento online (PIX) — tela de Ajustes.
 *
 * ANTES: um card inteiro com três parágrafos de diagnóstico por estado,
 * ocupando mais espaço que qualquer porta da tela (relato do Gabriel,
 * 02/09: "deve ser algo visualmente absolutamente compacto").
 *
 * AGORA: uma linha única com o termômetro de 3 níveis —
 *   ▮▮▮  verde     = ligado e com chave pública na configuração da loja
 *                    (frota) (funcionando);
 *   ▮▯▯  vermelho  = ligado, MAS a chave pública não está na configuração
 *                    da loja (a tela de pagamento nem carrega para o
 *                    cliente);
 *   ▯▯▯  cinza     = desligado (o cliente finaliza por pagamento na
 *                    entrega).
 * O diagnóstico completo (as instruções de correção do laudo 0109, D1)
 * continua a um clique — recolhido por padrão para a linha ficar compacta.
 *
 * Componente PURO: `ligado`/`chaveOk` chegam de fora (a configuração da
 * loja, lida da ficha em AdminSettingsView — escala etapa 3, 11/09/2026)
 * — este arquivo não lê a ficha, e é assim que os três estados são
 * exercitáveis por teste sem stub de ambiente.
 */

type NivelDoPagamento = "ok" | "alerta" | "off";

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
const DIAGNOSTICO = new Map<NivelDoPagamento, string>([
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

const ROTULO = new Map<NivelDoPagamento, string>([
  ["ok", "Funcionando"],
  ["alerta", "Chave ausente"],
  ["off", "Desligado"],
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
  const [aberto, setAberto] = useState(false);

  const nivel: NivelDoPagamento = !ligado ? "off" : chaveOk ? "ok" : "alerta";

  const corAcesa =
    nivel === "ok" ? "bg-emerald-400" : nivel === "alerta" ? "bg-red-400" : "";
  const corDoRotulo =
    nivel === "ok"
      ? "text-emerald-400"
      : nivel === "alerta"
        ? "text-red-400"
        : "text-zinc-500";

  const alturas = ["h-1.5", "h-2.5", "h-3.5"];

  return (
    <div className="rounded-2xl border border-white/5 bg-zinc-950/40">
      <button
        type="button"
        onClick={() => setAberto((antes) => !antes)}
        aria-expanded={aberto}
        className="flex w-full items-center justify-between gap-3 px-4 py-2.5 text-left transition-colors hover:bg-white/[0.02]"
      >
        <span className="flex min-w-0 items-center gap-2.5">
          <Wallet
            className={cn(
              "size-4 shrink-0",
              nivel === "ok"
                ? "text-emerald-400"
                : nivel === "alerta"
                  ? "text-red-400"
                  : "text-zinc-500",
            )}
          />
          <span className="truncate text-[11px] font-bold text-zinc-200">
            Pagamento online (PIX)
          </span>
        </span>

        <span className="flex shrink-0 items-center gap-2.5">
          <span
            className={cn(
              "text-[11px] font-black uppercase tracking-wider",
              corDoRotulo,
            )}
          >
            {ROTULO.get(nivel) ?? ""}
          </span>
          {/* Termômetro: 3 barras; acesas até o nível do estado. */}
          <span className="flex items-end gap-[3px]" aria-hidden="true">
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
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2, ease: "easeOut" }}
            className="overflow-hidden"
          >
            <p className="border-t border-white/5 px-4 pb-3 pt-2.5 text-[11px] leading-relaxed text-zinc-400">
              {DIAGNOSTICO.get(nivel) ?? ""}
            </p>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
