require('dotenv').config();
const { Client } = require('pg');

async function run() {
    const connectionString = process.env.DATABASE_URL;

    if (!connectionString) {
        console.error('❌ ERRO CRÍTICO: Variável de ambiente DATABASE_URL não encontrada no arquivo .env!');
        console.info('Dica: Certifique-se de que o arquivo .env existe na raiz do projeto e contém a chave DATABASE_URL.');
        process.exit(1);
    }

    const client = new Client({ connectionString });
    try {
        await client.connect();
        const res = await client.query('SELECT role FROM public.profiles WHERE id = $1', ['eaaf85fc-62c0-4356-9a25-e51b64fb4620']);
        console.log('✅ Resultado para Gabriel:', res.rows);
    } catch (err) {
        console.error('❌ Erro durante a execução da consulta:', err.message);
    } finally {
        await client.end();
    }
}

run();
