import {PGlite} from '/preview-runtime/pglite/index.js';
const files=['tests/fixtures/app-integral-rest-base.sql','tests/fixtures/credito-fase1-existente.sql','tests/fixtures/funciones-operativas-vigentes.sql','supabase/migrations/20261008145528_catalogo_publico_vendedor_solicitudes_compra.sql','tests/fixtures/cobranzas-legacy-existente.sql','tests/fixtures/cobranzas-demo.sql','supabase/migrations/20261011140519_fase2_cobranzas_trazables.sql','supabase/migrations/20261003175908_captacion_vendedores_presupuestos.sql','supabase/migrations/20261013140257_motor_precios_hogar_celulares.sql','supabase/migrations/20261022121122_cuotas_comerciales_multiplos_100.sql','supabase/migrations/20261025033232_presupuestos_multiproducto_multiopcion.sql'];
const db=new PGlite(),$=id=>document.getElementById(id);
const admin='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',seller='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const phone='dddddddd-dddd-4ddd-8ddd-000000000002',home='dddddddd-dddd-4ddd-8ddd-dddddddddddd',second='dddddddd-dddd-4ddd-8ddd-000000000098';
const rpc=async(name,args={})=>{const keys=Object.keys(args);return(await db.query(`select public.${name}(${keys.map((k,i)=>`${k}=>$${i+1}`).join(',')}) data`,Object.values(args).map(v=>v&&typeof v==='object'?JSON.stringify(v):v))).rows[0].data};
window.sb={rpc:async(name,args)=>{try{return {data:await rpc(name,args)}}catch(error){return {error}}}};
window.loadSellerBudgets=async()=>{const rows=(await db.query("select * from presupuestos where condiciones_snapshot->>'version'='2' order by creado_en desc")).rows;$('saved').innerHTML='';for(const r of rows){const card=document.createElement('article');card.className='card';$('saved').appendChild(card);RESTPresupuestos.showRecord(r,card)}};
try{
 for(const file of files)await db.exec(await(await fetch('/'+file)).text());
 await rpc('guardar_costo_producto_rest',{p_producto:phone,p_costo:420});
 await db.exec(`reset role;update productos set precio_contado=123457,nombre='TEST Sommier 140 · LEGACY' where id='${home}';insert into productos(id,nombre,categoria,precio_contado,activo,catalogo_publico) values('${second}','TEST Colchón 140 × 30 · LEGACY','hogar',223459,true,true);update vendedores set categoria_actual='experto';set role authenticated;set app.test_uid='${seller}';`);
 const products=(await db.query('select id,nombre,categoria from productos where id=any($1::uuid[]) order by nombre',[[phone,home,second]])).rows;
 for(const p of products){const card=document.createElement('article');card.className='card';const name=document.createElement('h3');name.textContent=p.nombre;card.appendChild(name);const btn=document.createElement('button');btn.className='btn';btn.textContent='AGREGAR A PRESUPUESTO';btn.onclick=()=>RESTPresupuestos.add(p);card.appendChild(btn);$('products').appendChild(card)}
 $('status').textContent='TEST listo · UI y RPC reales · datos ficticios';
 $('evidenceBtn').onclick=async()=>{const rows=(await db.query("select v.id,v.estado,v.producto,v.monto_total,v.anticipo_esperado,p.codigo,p.condiciones_snapshot->'items' productos from ventas v join presupuestos p on p.venta_id=v.id where p.condiciones_snapshot->>'version'='2'")).rows;$('evidence').textContent=JSON.stringify(rows,null,2)};
}catch(e){$('status').textContent=e.message}
