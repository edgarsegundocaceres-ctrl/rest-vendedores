const fs=require('node:fs');
const path=require('node:path');
const root=path.resolve(__dirname,'..');
const migration='supabase/migrations/20261011140519_fase2_cobranzas_trazables.sql';
const files=[
 'tests/fixtures/app-integral-rest-base.sql',
 'tests/fixtures/credito-fase1-existente.sql',
 'tests/fixtures/funciones-operativas-vigentes.sql',
 'supabase/migrations/20261008145528_catalogo_publico_vendedor_solicitudes_compra.sql',
 'tests/fixtures/cobranzas-legacy-existente.sql',
 'tests/fixtures/cobranzas-demo.sql',
 migration
];
async function setup(db){for(const f of files)await db.exec(fs.readFileSync(path.join(root,f),'utf8'));}
async function rpc(db,name,args={}){
 if(!/^[a-z_]+$/.test(name))throw Error('RPC inválida');
 const keys=Object.keys(args);if(keys.some(k=>!/^p_[a-z_]+$/.test(k)))throw Error('Argumento inválido');
 const sql=`select public.${name}(${keys.map((k,i)=>`${k} => $${i+1}`).join(',')}) as data`;
 return (await db.query(sql,Object.values(args))).rows[0].data;
}
module.exports={setup,rpc,files,root,migration};
