const fs=require('node:fs'),path=require('node:path');
const {setup:financeSetup,rpc,root}=require('./finance-db.cjs');
const migration='supabase/migrations/20261013140257_motor_precios_hogar_celulares.sql';
async function setup(db){await financeSetup(db);await db.exec(fs.readFileSync(path.join(root,'supabase/migrations/20261003175908_captacion_vendedores_presupuestos.sql'),'utf8'));await db.exec(fs.readFileSync(path.join(root,migration),'utf8'));}
module.exports={setup,rpc,root,migration};
if(require.main===module)(async()=>{const {PGlite}=require(path.join(process.env.PGLITE_MODULE_DIR,'@electric-sql/pglite'));const db=new PGlite();try{await setup(db);console.log('Motor instalado en PostgreSQL aislado')}finally{await db.close()}})().catch(e=>{console.error(e.message,e.where);process.exitCode=1});
