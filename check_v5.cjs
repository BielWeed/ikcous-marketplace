require('dotenv').config();
const { Client } = require('pg');
const client = new Client(process.env.DATABASE_URL);
client.connect().then(() => client.query("SELECT pg_get_functiondef(p.oid) FROM pg_proc p JOIN pg_namespace n ON p.pronamespace = n.oid WHERE n.nspname = 'public' AND p.proname = 'create_marketplace_order_v5'"))
    .then(res => { console.log(res.rows[0]); client.end(); })
    .catch(e => { console.error(e); client.end(); });
