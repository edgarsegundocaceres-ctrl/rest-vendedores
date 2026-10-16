const assert=require('node:assert/strict'),path=require('node:path');
const {setup,rpc}=require('./motor-precios-db.cjs');
const {PGlite}=require(path.join(process.env.PGLITE_MODULE_DIR,'@electric-sql/pglite'));
const dataDir=process.env.REST_PRIVATE_PRICE_FIXTURES;
if(!dataDir)throw Error('REST_PRIVATE_PRICE_FIXTURES debe apuntar al cruce privado autorizado; no publicar costos en GitHub.');
const phones=require(path.join(dataDir,'catalogo-celulares-auditado.json')),home=require(path.join(dataDir,'catalogo-hogar-auditado.json'));
const matches=require(path.join(dataDir,'cruce-proveedor-celulares.json')).registros.filter(r=>r.clasificacion==='A');
const admin='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',seller='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
(async()=>{const db=new PGlite();let checks=0;try{
 await setup(db);await db.exec(`reset role;set app.test_uid='${admin}'`);
 for(const p of [...phones,...home])await db.query('insert into productos(id,nombre,categoria,subcategoria,precio_contado,activo,catalogo_publico) values($1,$2,$3,$4,$5,$6,$7)',[p.id,p.nombre,p.categoria,p.subcategoria,p.precio_contado,p.activo,p.catalogo_publico]);
 const token=(await db.query('select catalogo_token from vendedores limit 1')).rows[0].catalogo_token;
 const before=await rpc(db,'obtener_catalogo_publico',{p_token:token});
 await rpc(db,'actualizar_dolar_rest',{p_valor:1550});
 for(const m of matches){await rpc(db,'guardar_costo_producto_rest',{p_producto:m.producto_id,p_costo:m.costo_proveedor_usd});const q=await rpc(db,'inspeccionar_precio_rest',{p_producto:m.producto_id});const base=(m.costo_proveedor_usd+10)*1550;assert.equal(q.contado,base*14/10);assert.equal(q.credito_personal[0].total,base*2.5);assert.equal(q.credito_personal[1].total,base*32/10);checks++;}
 const after=await rpc(db,'obtener_catalogo_publico',{p_token:token});assert.deepEqual(after.productos.map(p=>p.id).sort(),before.productos.map(p=>p.id).sort());checks++;
 const safeIds=new Set(matches.map(m=>m.producto_id));
 for(const p of [...phones.filter(p=>!safeIds.has(p.id)),...home]){const saved=(await db.query('select precio_contado from productos where id=$1',[p.id])).rows[0];assert.equal(Number(saved.precio_contado),Number(p.precio_contado));if(p.activo){const q=await rpc(db,'cotizar_producto',{p_producto_id:p.id});assert.equal(q.motor_version,1);assert.equal(q.contado,Number(p.precio_contado));}checks++;}
 const a56=matches.find(m=>m.caso_control===true);let q=await rpc(db,'cotizar_producto',{p_producto_id:a56.producto_id});assert.equal(q.contado,933100);assert.equal(q.credito_personal[0].total,1666250);assert.equal(q.credito_personal[0].cuota,277708.33);assert.equal(q.credito_personal[0].ultima_cuota,277708.35);assert.equal(q.credito_personal[1].total,2132800);assert.equal(q.credito_personal[1].cuota,236977.78);assert.equal(q.credito_personal[1].ultima_cuota,236977.76);checks++;
 assert.equal((await db.query('select costo_proveedor_usd from productos_costos where producto_id=$1',[a56.producto_id])).rows[0].costo_proveedor_usd,'420.0000');checks++;
 await db.exec(`set role authenticated;set app.test_uid='${seller}'`);
 const plan=await rpc(db,'calcular_presupuesto_rest',{p_producto_id:a56.producto_id,p_modalidad:'Crédito personal',p_cuotas:6});
 const data={producto_id:a56.producto_id,modalidad:'Crédito personal',cliente_nombre:'TEST control híbrido',cliente_dni:'39999889',cantidad_cuotas:6,valor_cuota:plan.value,monto_total:plan.total,anticipo:0,frecuencia:'mensual'};
 const key=crypto.randomUUID(),reqsBefore=(await db.query('select count(*) n from solicitudes_venta')).rows[0].n;
 const sale=await rpc(db,'registrar_venta_catalogo',{p_datos:JSON.stringify(data),p_clave_idempotencia:key});
 assert.equal(sale.estado,'pendiente');assert.equal((await db.query('select count(*) n from solicitudes_venta')).rows[0].n,reqsBefore);checks++;
 for(const corrupt of [{monto_total:1},{valor_cuota:1},{anticipo:1},{frecuencia:'semanal'},{cantidad_cuotas:9}]){await assert.rejects(rpc(db,'registrar_venta_catalogo',{p_datos:JSON.stringify({...data,...corrupt}),p_clave_idempotencia:crypto.randomUUID()}));checks++;}
 const dup=await rpc(db,'registrar_venta_catalogo',{p_datos:JSON.stringify(data),p_clave_idempotencia:key});assert.equal(dup.id,sale.id);checks++;
 await assert.rejects(db.query('update ventas set monto_total=1 where id=$1',[sale.id]));checks++;
 await assert.rejects(db.query('insert into ventas(vendedor_id,cliente_id,producto,monto_total,forma_pago,estado) select vendedor_id,cliente_id,producto,1,forma_pago,estado from ventas where id=$1',[sale.id]));checks++;
 await db.exec(`reset role;set app.test_uid='${admin}'`);
 const snapshot=(await db.query("select detalle from private.motor_precios_auditoria where entidad_id=$1 and tipo='venta_portal'",[sale.id])).rows[0].detalle;
 await rpc(db,'actualizar_dolar_rest',{p_valor:1600});assert.equal((await rpc(db,'cotizar_producto',{p_producto_id:a56.producto_id})).contado,963200);
 assert.deepEqual((await db.query("select detalle from private.motor_precios_auditoria where entidad_id=$1 and tipo='venta_portal'",[sale.id])).rows[0].detalle,snapshot);checks++;
 await assert.rejects(db.query('delete from productos_costos where producto_id=$1',[a56.producto_id]),/desactivación/);checks++;
 assert.equal(matches.length,32);assert(!matches.some(m=>/usado|as ?is|open box/i.test(m.proveedor+" "+m.producto_rest)));assert(!matches.some(m=>m.producto_rest.includes('G05')));checks++;
 console.log(`PASS ${checks} verificaciones híbridas: 32 costos seguros solo TEST; 95 celulares y 142 Hogar conservados; catálogo sin pérdidas; ejemplo de control; venta pendiente; seguridad; snapshots.`);
}finally{await db.close()}})().catch(e=>{console.error(e.message,e.where,e.stack);process.exitCode=1});
