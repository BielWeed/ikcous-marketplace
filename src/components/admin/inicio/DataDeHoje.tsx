import { instanteDoDia, useDiaDeSaoPaulo } from "@/hooks/useDiaDeSaoPaulo";

const PARTES_DA_DATA = new Intl.DateTimeFormat("pt-BR", {
  weekday: "long",
  day: "numeric",
  month: "long",
  timeZone: "America/Sao_Paulo",
});

/** "Quarta, 21 de outubro": dia da semana sem o "-feira". */
export function dataPorExtenso(instante: Date): string {
  const partes = Object.fromEntries(
    PARTES_DA_DATA.formatToParts(instante).map((p) => [p.type, p.value]),
  );
  const semana = String(partes.weekday ?? "").replace(/-feira$/, "");
  const frase = `${semana}, ${partes.day} de ${partes.month}`;
  return frase.charAt(0).toUpperCase() + frase.slice(1);
}

/**
 * A data do dia sob o título do Início. Acompanha o relógio: o Início fica
 * aberto (ou congelado em segundo plano) de um dia para o outro, e a data não
 * pode ficar presa em ontem.
 */
export function DataDeHoje({ className }: Readonly<{ className?: string }>) {
  const dia = useDiaDeSaoPaulo();
  return (
    <p data-testid="inicio-data" className={className}>
      {dataPorExtenso(instanteDoDia(dia))}
    </p>
  );
}
