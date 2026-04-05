const { TruthGate } = require('./src/utils/truth_gate');

console.log('--- Iniciando Verificação de Segurança (TruthGate Axioms) ---');

try {
    console.log('\nTeste 1: Validando Produto com Preço Negativo...');
    TruthGate.verifyProductAxiom({
        name: 'Produto Teste',
        price: -10,
        stock: 10,
        category: 'Teste'
    });
    console.error('❌ ERRO: TruthGate falhou ao permitir preço negativo!');
} catch (err) {
    console.log('✅ SUCESSO: TruthGate bloqueou preço negativo corretamente:', err.message);
}

try {
    console.log('\nTeste 2: Validando Produto com Nome Vazio...');
    TruthGate.verifyProductAxiom({
        name: '',
        price: 100,
        stock: 10,
        category: 'Teste'
    });
    console.error('❌ ERRO: TruthGate falhou ao permitir nome vazio!');
} catch (err) {
    console.log('✅ SUCESSO: TruthGate bloqueou nome vazio corretamente:', err.message);
}

console.log('\n--- Verificação Concluída com Sucesso ---');
