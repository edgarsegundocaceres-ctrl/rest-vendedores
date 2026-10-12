// Este preview utiliza PostgreSQL aislado en la pestaña. No importa Supabase ni sus claves.
import {PGlite} from '/preview-runtime/pglite/index.js';
const fixtures=[
 '/tests/fixtures/app-integral-rest-base.sql','/tests/fixtures/credito-fase1-existente.sql',
 '/tests/fixtures/funciones-operativas-vigentes.sql',
 '/supabase/migrations/20261008145528_catalogo_publico_vendedor_solicitudes_compra.sql',
 '/tests/fixtures/cobranzas-legacy-existente.sql','/tests/fixtures/cobranzas-demo.sql',
 '/supabase/migrations/20261011140519_fase2_cobranzas_trazables.sql'
];
const db=new PGlite();
document.getElementById('previewReset').onclick=()=>location.reload();
async function rpc(name,args){
 const keys=Object.keys(args||{});
 if(!/^[a-z_]+$/.test(name)||keys.some(k=>!/^p_[a-z_]+$/.test(k)))throw Error('Solicitud inválida');
 try{const r=await db.query(`select public.${name}(${keys.map((k,i)=>`${k} => $${i+1}`).join(',')}) data`,Object.values(args||{}));return {data:r.rows[0].data};}catch(error){return {error};}
}
try{
 const sql=await Promise.all(fixtures.map(async p=>{const r=await fetch(p);if(!r.ok)throw Error('No se pudo cargar la base de prueba');return r.text();}));
 for(const s of sql)await db.exec(s);
 // Crédito finalizado y cuota vencida parcialmente pagada, mediante las mismas RPC.
 const x=await rpc('cobranzas_tablero',{p_filtro:'todas'});
 for(const [nombre,importe] of [['TEST María Pérez',25000],['TEST Lucía Gómez',300000]]){
   const q=x.data.agenda.find(q=>q.cliente_nombre===nombre);
   const p=await rpc('previsualizar_cobro',{p_cuenta_id:q.cuenta_id,p_importe:importe});if(p.error)throw p.error;
   const fecha=new Date(x.data.hoy+'T12:00:00Z');fecha.setUTCDate(fecha.getUTCDate()-3);
   const r=await rpc('registrar_cobro_credito',{p_cuenta_id:q.cuenta_id,p_importe:importe,p_fecha_efectiva:fecha.toISOString().slice(0,10),p_medio_pago:'transferencia',p_clave_idempotencia:crypto.randomUUID(),p_revision:p.data.revision,p_referencia:'TEST comprobante de ejemplo'});if(r.error)throw r.error;
 }
 RESTCobranza.init({rpc,isAdmin:()=>true,demo:true});await RESTCobranza.load();
 // Disponible para inspección automatizada de las fronteras UI → RPC → datos, solo en esta página TEST.
 window.RESTPreviewDB=db;
}catch(e){document.getElementById('cobranzasRoot').textContent='No se pudo preparar la prueba: '+e.message;}
