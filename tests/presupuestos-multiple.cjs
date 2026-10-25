const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {setup,rpc,root}=require('./motor-precios-db.cjs');
const {PGlite}=require(path.join(process.env.PGLITE_MODULE_DIR,'@electric-sql/pglite'));
const migration='supabase/migrations/20261025033232_presupuestos_multiproducto_multiopcion.sql';
const admin='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',seller='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const phone='dddddddd-dddd-4ddd-8ddd-000000000002',home='dddddddd-dddd-4ddd-8ddd-dddddddddddd',other='dddddddd-dddd-4ddd-8ddd-000000000098',phone2='dddddddd-dddd-4ddd-8ddd-000000000097';
const item=(id,n=1)=>({producto_id:id,cantidad:n}),op=(n=0,mode=n?'Crédito personal':'Contado',down=0)=>({modalidad:mode,cuotas:n,anticipo:down});
(async()=>{const db=new PGlite();let passed=0;const pass=s=>{passed++;console.log('PASS '+s)};try{
 await setup(db);await db.exec(fs.readFileSync(path.join(root,'supabase/migrations/20261022121122_cuotas_comerciales_multiplos_100.sql'),'utf8'));
 const history=(await db.query('select id,to_jsonb(v) snapshot from ventas v')).rows;
 await db.exec(fs.readFileSync(path.join(root,migration),'utf8'));
 const call=(name,args={})=>rpc(db,name,Object.fromEntries(Object.entries(args).map(([k,v])=>[k,v&&typeof v==='object'?JSON.stringify(v):v])));
 const role=uid=>db.exec(`reset role;set role authenticated;set app.test_uid='${uid}'`);
 await role(admin);await call('guardar_costo_producto_rest',{p_producto:phone,p_costo:420});
 await db.exec(`reset role;insert into productos(id,nombre,categoria,precio_contado,activo,catalogo_publico) values('${other}','TEST Colchón','hogar',123457,true,true),('${phone2}','TEST Segundo celular','celulares',100000,true,true); update vendedores set categoria_actual='experto';`);
 await role(admin);await call('guardar_costo_producto_rest',{p_producto:phone2,p_costo:301});await role(seller);
 const quote=(its,ops)=>call('cotizar_presupuesto_multiple',{p_items:its,p_opciones:ops});
 for(const ids of [[phone],[home],[phone,phone2],[home,other]])for(const n of [0,6,9]){
  const q=await quote(ids.map(id=>item(id)),[op(n)]),p=q.opciones[0];assert(q.items.length===ids.length);assert.equal(p.down,0);
  if(n){assert.equal(p.total,p.value*n);assert.equal(p.value%100,0);assert.equal(p.pago_inicial,ids[0]===phone?p.value:0)}else assert.equal(p.total,q.contado);
  assert(!JSON.stringify(q).includes('costo_proveedor'));pass(ids.length+' productos '+(ids[0]===phone?'nuevo':'legacy')+' '+n);
 }
 const mixed=await quote([item(phone),item(home)],[op()]);assert.equal(mixed.items.length,2);
 await assert.rejects(quote([item(phone),item(home)],[op(6)]),/mixto/);await assert.rejects(quote([item(phone),item(home)],[op(9)]),/mixto/);pass('mixto contado permitido; crédito 6/9 bloqueado');
 for(const ids of [[phone],[home],[phone,phone2],[home,other]]){const q=await quote(ids.map(id=>item(id,2)),[op(),op(6),op(9)]);assert.equal(q.opciones.length,3);assert(q.items.every(x=>x.cantidad===2));pass('multiopción y cantidades '+ids.length+' '+ids[0])}
 const indiv=(await quote([item(other)],[op(6)])).opciones[0];const combo=(await quote([item(other,2)],[op(6)])).opciones[0];assert.equal(combo.value,Math.ceil(123457*2*1.57/6/100)*100);assert.notEqual(combo.value,indiv.value*2);pass('redondeo solo al final: no suma de cuotas individuales');
 const cfg=await call('opciones_presupuesto_multiple',{p_items:[item(phone),item(home)]});assert(cfg.mixto);assert(!cfg.opciones.some(x=>x.modalidad==='Crédito personal'));
 for(const c of cfg.opciones){const q=(await quote([item(phone),item(home)],[op(c.cuotas,c.modalidad,c.anticipo_min||0)])).opciones[0];assert.equal(q.total,q.count?q.down+q.count*q.value:mixed.contado);if(c.anticipo_min){assert.equal(q.pago_inicial,c.anticipo_min);assert.equal(q.primera_cuota,null)}}pass('todas las modalidades comunes y anticipo adicional mixto');
 const q9=(await quote([item(phone)],[op(9)])).opciones[0];assert.equal(q9.value,237000);assert.equal(q9.total,2133000);assert.equal(q9.pago_inicial,237000);pass('A56 primera cuota incluida');
 for(const bad of [[{...item(phone),total:1}],[item(phone,0)],[item(phone,1.2)],[item(phone),item(phone)]])await assert.rejects(quote(bad,[op(6)]));
 await assert.rejects(quote([item(phone)],[{...op(6),value:1}]));await assert.rejects(quote([item(phone)],[op(6,'Crédito personal',237000)]));await assert.rejects(quote([item(phone)],[op(6),op(6)]));pass('manipulación, duplicados, cantidades y anticipo indebido rechazados');
 const params={p_items:[item(phone),item(phone2)],p_opciones:[op(),op(6),op(9)],p_clave:crypto.randomUUID(),p_nombre:'TEST Cliente',p_vigencia:7};
 const r=await call('crear_presupuesto_multiple',params);const again=await call('crear_presupuesto_multiple',params);assert.equal(r.id,again.id);await assert.rejects(call('crear_presupuesto_multiple',{...params,p_nombre:'Otro'}),/reutilizada/);pass('emisión idempotente');
 await role(admin);await call('guardar_costo_producto_rest',{p_producto:phone,p_costo:500});await call('actualizar_dolar_rest',{p_valor:1600});await role(seller);
 assert.deepEqual((await db.query('select condiciones_snapshot from presupuestos where id=$1',[r.id])).rows[0].condiciones_snapshot,r.condiciones_snapshot);assert.notEqual((await quote(params.p_items,[op(9)])).opciones[0].total,r.condiciones_snapshot.opciones[2].total);pass('snapshot inmutable tras cambios costo/dólar TEST');
 const clients=await call('clientes_presupuesto_multiple');assert(clients.length);const conversion={p_presupuesto:r.id,p_opcion:'Crédito personal:9',p_cliente_id:clients[0].id};
 await assert.rejects(call('convertir_presupuesto_multiple',{...conversion,p_opcion:null}),/alternativa/);
 await assert.rejects(call('convertir_presupuesto_multiple',{...conversion,p_cliente_id:crypto.randomUUID()}),/Cliente/);
 const sale=await call('convertir_presupuesto_multiple',conversion);assert.equal((await call('convertir_presupuesto_multiple',conversion)).id,sale.id);await assert.rejects(call('convertir_presupuesto_multiple',{...conversion,p_opcion:'Contado:0'}),/ya convertido/);
 await db.exec('reset role');const v=(await db.query('select * from ventas where id=$1',[sale.id])).rows[0];const chosen=r.condiciones_snapshot.opciones[2];assert.equal(Number(v.monto_total),chosen.total);assert.equal(Number(v.anticipo_esperado),chosen.value);assert(v.producto.includes('TEST Segundo celular'));
 const audit=(await db.query("select detalle from private.motor_precios_auditoria where tipo='venta_presupuesto_multiple' and entidad_id=$1",[sale.id])).rows[0].detalle;assert.deepEqual(audit.items,r.condiciones_snapshot.items);pass('una alternativa, una venta, todos los productos, condición histórica');
 await db.query("update ventas set estado='aprobada_entrega' where id=$1",[sale.id]);await db.query("update ventas set estado='entregada' where id=$1",[sale.id]);await db.query("update ventas set estado='en_cobranza' where id=$1",[sale.id]);const com=(await db.query('select * from comisiones where venta_id=$1',[sale.id])).rows;assert.equal(com.length,1);assert.equal(Number(com[0].importe_original),chosen.total*.05);pass('comisión vigente 5%, única');
 // Force failure after sale insert: transaction must also roll back budget conversion.
 await role(seller);const r2=await call('crear_presupuesto_multiple',{...params,p_clave:crypto.randomUUID()});await db.exec("reset role;create function private.test_fail() returns trigger language plpgsql as $$begin if new.tipo='venta_presupuesto_multiple' then raise exception 'TEST rollback';end if;return new;end$$;create trigger test_fail before insert on private.motor_precios_auditoria for each row execute function private.test_fail();");
 const count=(await db.query('select count(*)::int n from ventas')).rows[0].n;await role(seller);await assert.rejects(call('convertir_presupuesto_multiple',{...conversion,p_presupuesto:r2.id}),/TEST rollback/);await db.exec('reset role;drop trigger test_fail on private.motor_precios_auditoria;drop function private.test_fail()');assert.equal((await db.query('select count(*)::int n from ventas')).rows[0].n,count);assert.equal((await db.query('select estado from presupuestos where id=$1',[r2.id])).rows[0].estado,'vigente');pass('rollback completo conversión');
 await db.exec("set role anon");await assert.rejects(quote([item(phone)],[op()]));await assert.rejects(db.query('select * from presupuestos'));await db.exec('reset role');await role('cccccccc-cccc-4ccc-8ccc-cccccccccccc');await assert.rejects(call('convertir_presupuesto_multiple',conversion));pass('anon y otro usuario bloqueados');
 await db.exec('reset role');for(const h of history)assert.deepEqual((await db.query('select to_jsonb(v) snapshot from ventas v where id=$1',[h.id])).rows[0].snapshot,h.snapshot);pass('históricos intactos');
 console.log(`RESULTADO: ${passed} grupos aprobados`);
 }finally{await db.close()}})().catch(e=>{console.error(e.message,e.where);process.exitCode=1});
