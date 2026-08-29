// Máscara e validação de WhatsApp com a MESMA regra do rastreio de pedido.
//
// O banco normaliza não-dígitos nas RPCs de rastreio, mas o front delas
// (OrderSearch) EXIGE >= 10 dígitos — então um WhatsApp cadastrado com lixo
// na conta impedia o cliente de rastrear os próprios pedidos sem nunca ter
// sido avisado. `AccountSettingsView` (o único lugar do app que GRAVA esse
// dado) usa este arquivo como fonte única de máscara e validação.
//
// ⚠️ Isto NÃO unificou as outras cópias privadas de máscara de telefone que
// já existiam no repositório — elas continuam divergentes (algumas usam
// `.replaceAll`, outras têm limite de dígito diferente) em
// `OrderSearch.tsx`, `CheckoutView.tsx`, `AuthView.tsx` e
// `components/admin/LocalBufferedInput.tsx` (achado de auditoria de
// 26/08/2026). Unificar aquelas é trabalho à parte — mexeria em arquivo que
// não é deste escopo.

/**
 * Formata "(11) 91234-5678" progressivamente a partir de qualquer entrada.
 *
 * ⚠️ NÃO É EXPORTADA, e isso é a trava, não descuido. Ela faz `.slice(0, 11)`:
 * acima de 11 dígitos ela DESCARTA o excedente e REINTERPRETA o que sobra (o
 * código do país vira DDD), devolvendo um número diferente que passa em
 * `validarWhatsApp` sem nenhum aviso. Chamá-la direto num campo de tela foi o
 * defeito CONTA-09, e ele nasceu três vezes seguidas em cinco rodadas de
 * correção neste mesmo arquivo. Use `formatarWhatsAppDigitando` (digitação) ou
 * `formatarWhatsAppParaExibicao` (valor já gravado) — as duas guardam o caso
 * de não caber. Se você veio aqui para exportá-la, o que você quer é uma
 * dessas duas.
 */
function formatarWhatsApp(bruto: string): string {
  const limpo = bruto.replace(/\D/g, "").slice(0, 11);
  if (limpo.length <= 2) return limpo;
  if (limpo.length <= 6) return `(${limpo.slice(0, 2)}) ${limpo.slice(2)}`;
  if (limpo.length <= 10)
    return `(${limpo.slice(0, 2)}) ${limpo.slice(2, 6)}-${limpo.slice(6)}`;
  return `(${limpo.slice(0, 2)}) ${limpo.slice(2, 7)}-${limpo.slice(7)}`;
}

/** DDD + numero: exatamente 10 ou 11 dígitos, o que o rastreio aceita. */
export function validarWhatsApp(bruto: string): boolean {
  const digitos = bruto.replace(/\D/g, "");
  return digitos.length === 10 || digitos.length === 11;
}

// CONTA-09 (auditoria de 26/08/2026, camada 5) — `formatarWhatsApp` acima
// faz `.slice(0, 11)` sobre TODOS os dígitos digitados/colados. Acima de 11
// dígitos, os excedentes somem em silêncio e os 11 que sobram são
// REINTERPRETADOS (o código do país vira DDD) — o resultado tem exatamente
// 11 dígitos, então `validarWhatsApp` aprova, nenhum toast dispara, e um
// número DIFERENTE do que a pessoa digitou vai para a RPC. Ex.: colar
// "+55 34 99999-8888" (DDD 34, número real) virava "(55) 34999-9988" —
// outro número, com "55" sendo DDD real (Santa Maria/RS), o que torna o
// defeito invisível numa conferência humana.
/**
 * Formata ENQUANTO A PESSOA DIGITA/COLA no campo. Só aplica a máscara
 * progressiva de `formatarWhatsApp` quando ela cabe (<= 11 dígitos) — acima
 * disso, devolve o texto exatamente como veio, sem descartar nada, para que
 * `validarWhatsApp` recuse no Salvar em vez de aceitar um número fabricado
 * pelo truncamento. Não mascarar aqui NÃO é o mesmo defeito de
 * `formatarWhatsAppParaExibicao` (abaixo): aquela é para valor JÁ GRAVADO
 * (não muda com a digitação); esta acompanha cada tecla, e é a que
 * `AccountSettingsView` usa no `onChange` do campo WhatsApp.
 */
export function formatarWhatsAppDigitando(bruto: string): string {
  const digitos = bruto.replace(/\D/g, "");
  if (digitos.length > 11) return bruto;
  return formatarWhatsApp(bruto);
}

// CONTA-08 (auditoria de 26/08/2026) — `formatarWhatsApp` acima TRUNCA de
// propósito para bater com o que o rastreio de pedido aceita, e isso é
// correto para a máscara PROGRESSIVA enquanto a pessoa digita (ninguém
// digita mais de 11 dígitos úteis). Mas usar a mesma função para EXIBIR um
// valor já gravado é outra conta: um WhatsApp legado com mais de 11 dígitos
// (alcançável hoje pelo cadastro, que não limita comprimento) virava, só de
// abrir a tela, um número de 11 dígitos válido pela máscara — mentindo
// sobre o que está no banco.
/**
 * Formata para EXIBIÇÃO de um valor JÁ GRAVADO: só aplica a máscara quando
 * ela cabe (<= 11 dígitos). Quando não cabe, devolve o valor cru — feio,
 * mas verdadeiro, e sinaliza para a pessoa que aquele número precisa de
 * conserto. No `onChange` de digitação use `formatarWhatsAppDigitando`
 * (acima) — mesma guarda, função separada porque uma acompanha o valor
 * gravado e a outra acompanha cada tecla; nunca `formatarWhatsApp` puro
 * ali, que é exatamente o CONTA-09.
 */
export function formatarWhatsAppParaExibicao(bruto: string): string {
  const digitos = bruto.replace(/\D/g, "");
  if (digitos.length > 11) return bruto;
  return formatarWhatsApp(bruto);
}
