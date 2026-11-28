import { nucleoSemver } from "@/lib/versao-do-servidor";

// Roda no boot de TODA visita (cliente e lojista), então fica no JS de abertura
// da vitrine: por isso NÃO importa as notas das versões (~15 kB brotli de texto
// que só a lojista lê, na tela de Avisos). Aqui só se anota a faixa de versões
// atravessada; o texto entra quando o painel lê (armazenamento-local.ts).
// tests/front/novidades/boot-nao-carrega-as-notas.test.ts trava o grafo.

// O prefixo "notificacoes-" preserva as chaves na purga de dados antigos.
export const CHAVE_ULTIMA_VISTA = "notificacoes-ultima-versao-vista-do-app-v1";
export const CHAVE_PENDENTES = "notificacoes-novidades-pendentes-do-app-v1";
// Aparelho que nunca abre o painel (o da cliente) não acumula sem fim.
const LIMITE_DE_FAIXAS = 20;

export interface FaixaPendente {
  de: string;
  para: string;
  /** Quando o boot atravessou a faixa: vira a data mostrada na nota. */
  em: string;
}

function lerFaixa(valor: unknown): FaixaPendente | null {
  if (!valor || typeof valor !== "object" || Array.isArray(valor)) return null;
  const campos = valor as Record<string, unknown>;
  const de = nucleoSemver(typeof campos.de === "string" ? campos.de : null);
  const para = nucleoSemver(
    typeof campos.para === "string" ? campos.para : null,
  );
  if (!de || !para || typeof campos.em !== "string") return null;
  const em = Date.parse(campos.em);
  if (!Number.isFinite(em)) return null;
  return { de, para, em: new Date(em).toISOString() };
}

/** Anotação corrompida (escrita interrompida) vale como vazia. */
export function lerFaixasPendentes(texto: string | null): FaixaPendente[] {
  if (texto === null) return [];
  try {
    const valor: unknown = JSON.parse(texto);
    if (!Array.isArray(valor)) return [];
    return valor
      .map((item: unknown) => lerFaixa(item))
      .filter((item): item is FaixaPendente => item !== null);
  } catch {
    return [];
  }
}

function anotarFaixa(de: string, para: string, agora: Date): void {
  const faixas = lerFaixasPendentes(
    window.localStorage.getItem(CHAVE_PENDENTES),
  );
  const ultima = faixas.at(-1);
  // O mesmo boot repetido (a versão vista não chegou a ser gravada).
  if (ultima?.de === de && ultima.para === para) return;
  const data = Number.isFinite(agora.getTime()) ? agora : new Date();
  faixas.push({ de, para, em: data.toISOString() });
  while (faixas.length > LIMITE_DE_FAIXAS) {
    const [primeira, segunda] = faixas;
    // Faixas encadeadas se fundem sem perder versão (só a data das mais
    // antigas fica a da segunda); fora de cadeia, a mais antiga sai.
    faixas.splice(
      0,
      2,
      ...(primeira.para === segunda.de
        ? [{ de: primeira.de, para: segunda.para, em: segunda.em }]
        : [segunda]),
    );
  }
  window.localStorage.setItem(CHAVE_PENDENTES, JSON.stringify(faixas));
}

/** A versão vista sobrevive ao fechamento do app e à purga da atualização. */
export function registrarNovidadesAoIniciar(
  versaoAtual: string,
  origemProvada?: string | null,
  agora: Date = new Date(),
): void {
  const para = nucleoSemver(versaoAtual);
  if (!para || typeof window === "undefined") return;
  try {
    // Sem a chave (aparelho que ainda roda o build anterior a ela), a origem
    // PROVADA da troca de build — gravada pela própria atualização — faz as
    // vezes da última versão vista; sem prova, só se estabelece a referência.
    const de =
      nucleoSemver(window.localStorage.getItem(CHAVE_ULTIMA_VISTA)) ??
      nucleoSemver(origemProvada ?? null);
    // Primeiro acesso (ou origem ilegível) só estabelece a referência.
    if (de && de !== para) anotarFaixa(de, para, agora);
    window.localStorage.setItem(CHAVE_ULTIMA_VISTA, para);
  } catch {
    // Armazenamento indisponível nunca impede o boot.
  }
}
