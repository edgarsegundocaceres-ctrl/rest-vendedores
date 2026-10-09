const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');

const moduleRoot=process.env.PGLITE_MODULE_DIR;
if(!moduleRoot)throw new Error('Definí PGLITE_MODULE_DIR con el directorio node_modules que contiene @electric-sql/pglite.');
const {PGlite}=require(path.join(moduleRoot,'@electric-sql/pglite'));
const root=path.resolve(__dirname,'..');
const base=fs.readFileSync(path.join(__dirname,'fixtures/app-integral-rest-base.sql'),'utf8');
const migration=fs.readFileSync(path.join(root,'supabase/migrations/20261008145528_catalogo_publico_vendedor_solicitudes_compra.sql'),'utf8');

async function scalar(db,sql,key){const result=await db.query(sql);return result.rows[0]?.[key]}

(async()=>{
  const db=new PGlite();
  await db.exec(base);
  await db.exec(fs.readFileSync(path.join(__dirname,'fixtures/credito-fase1-existente.sql'),'utf8'));
  await db.exec(fs.readFileSync(path.join(__dirname,'fixtures/funciones-operativas-vigentes.sql'),'utf8'));
  await db.exec(migration);

  const token=await scalar(db,"select catalogo_token::text token from public.vendedores where id='cccccccc-cccc-4ccc-8ccc-cccccccccccc'",'token');
  assert.match(token,/^[0-9a-f-]{36}$/);
  const catalog=await scalar(db,`select public.obtener_catalogo_publico('${token}') data`,'data');
  assert.equal(catalog.disponible,true);
  assert.equal(catalog.productos.length,2);
  const quoteVersion=catalog.productos[0].version_cotizacion;
  assert.equal(Number(catalog.productos[0].opciones.contado.total),100000);
  assert.equal(Number(catalog.productos[0].opciones.credito_6.total),157000);
  assert.equal(Number(catalog.productos[0].opciones.credito_9.total),199000);
  assert.equal((await scalar(db,"select public.obtener_catalogo_publico('inventado') data",'data')).disponible,false);
  await db.exec("update public.productos set catalogo_publico=false where id='dddddddd-dddd-4ddd-8ddd-000000000002'");
  assert.equal((await scalar(db,`select public.obtener_catalogo_publico('${token}') data`,'data')).productos.length,1);
  await db.exec("update public.productos set catalogo_publico=true where id='dddddddd-dddd-4ddd-8ddd-000000000002'");

  const key='eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';
  const customer=JSON.stringify({nombre:'Lucía',apellido:'Fernández',dni:'30111222',telefono:'5493855550101',localidad:'Santiago del Estero',domicilio:'San Martín 145',observaciones:'Por la tarde'}).replaceAll("'","''");
  const created=await scalar(db,`select public.crear_solicitud_compra_publica('${token}','dddddddd-dddd-4ddd-8ddd-dddddddddddd','credito_6','${customer}'::jsonb,'${key}','${quoteVersion}',null) data`,'data');
  assert.equal(created.ok,true);
  const duplicate=await scalar(db,`select public.crear_solicitud_compra_publica('${token}','dddddddd-dddd-4ddd-8ddd-dddddddddddd','credito_6','${customer}'::jsonb,'${key}','${quoteVersion}',null) data`,'data');
  assert.equal(duplicate.duplicado,true);
  assert.equal(Number(await scalar(db,"select count(*)::integer n from public.solicitudes_venta",'n')),1);
  assert.equal(Number(await scalar(db,"select count(*)::integer n from public.ventas",'n')),0);
  await assert.rejects(db.query(`select public.crear_solicitud_compra_publica('${token}','dddddddd-dddd-4ddd-8ddd-dddddddddddd','credito_9','${customer}'::jsonb,'${key}','${quoteVersion}',null)`),/Clave de envío inválida/);

  // RLS ejecutada realmente bajo roles de visitante, propietario y otro vendedor.
  await db.exec("set role anon");
  assert.equal((await scalar(db,`select public.obtener_catalogo_publico('${token}') data`,'data')).disponible,true);
  await assert.rejects(db.query('select * from public.solicitudes_venta'),/permission denied/);
  await assert.rejects(db.query('select * from public.solicitudes_compra_historial'),/permission denied/);
  await assert.rejects(db.query("select public.convertir_solicitud_compra('00000000-0000-4000-8000-000000000001')"),/permission denied/);
  await db.exec("reset role; set role authenticated; set app.test_uid='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'");
  assert.equal(Number(await scalar(db,'select count(*)::integer n from public.solicitudes_venta','n')),1);
  assert.equal(Number(await scalar(db,'select count(*)::integer n from public.solicitudes_compra_historial','n')),0);
  await assert.rejects(db.query('update public.solicitudes_venta set estado_comercial=\'aprobada\''),/permission denied/);
  await db.exec("set app.test_uid='bbbbbbbb-bbbb-4bbb-8bbb-000000000002'");
  assert.equal(Number(await scalar(db,'select count(*)::integer n from public.solicitudes_venta','n')),0);
  await db.exec('reset role; reset app.test_uid');

  const requestId=await scalar(db,"select id::text id from public.solicitudes_venta limit 1",'id');
  const originalSnapshot=await scalar(db,`select snapshot_solicitado data from public.solicitudes_venta where id='${requestId}'`,'data');
  assert.equal(Number(originalSnapshot.producto.precio_contado),100000);
  assert.equal(originalSnapshot.vendedor_origen.id,'cccccccc-cccc-4ccc-8ccc-cccccccccccc');
  await db.exec("update public.productos set precio_contado=120000 where id='dddddddd-dddd-4ddd-8ddd-dddddddddddd'");
  const persistedSnapshot=await scalar(db,`select snapshot_solicitado data from public.solicitudes_venta where id='${requestId}'`,'data');
  assert.deepEqual(persistedSnapshot,originalSnapshot);
  const stale=await scalar(db,`select public.crear_solicitud_compra_publica('${token}','dddddddd-dddd-4ddd-8ddd-dddddddddddd','credito_6','${customer}'::jsonb,'00000000-0000-4000-8000-000000000004','${quoteVersion}',null) data`,'data');
  assert.equal(stale.ok,false);assert.equal(stale.condiciones_actualizadas,true);
  assert.equal(Number(stale.producto_actualizado.precio_contado),120000);
  assert.equal(Number(await scalar(db,"select count(*)::integer n from public.solicitudes_venta",'n')),1);

  await assert.rejects(db.exec(`update public.solicitudes_venta set vendedor_id=null where id='${requestId}'`),/vendedor de origen es inmutable/);
  await assert.rejects(db.exec(`update public.solicitudes_venta set snapshot_solicitado='{}'::jsonb where id='${requestId}'`),/snapshot solicitado son inmutables/);
  await assert.rejects(db.exec(`update public.solicitudes_venta set estado_comercial='convertida_en_venta' where id='${requestId}'`),/circuito administrativo/);

  const currentCatalog=await scalar(db,`select public.obtener_catalogo_publico('${token}') data`,'data');
  const currentVersion=currentCatalog.productos[0].version_cotizacion;
  const rejectedKey='ffffffff-ffff-4fff-8fff-ffffffffffff';
  await scalar(db,`select public.crear_solicitud_compra_publica('${token}','dddddddd-dddd-4ddd-8ddd-dddddddddddd','contado','${customer}'::jsonb,'${rejectedKey}','${currentVersion}',null) data`,'data');
  const rejectedId=await scalar(db,`select id::text id from public.solicitudes_venta where clave_idempotencia='${rejectedKey}'`,'id');
  await db.exec("set app.test_uid='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'");
  await scalar(db,`select public.actualizar_estado_solicitud_compra('${rejectedId}','rechazada','No cumple las condiciones comerciales') data`,'data');
  assert.equal(await scalar(db,`select estado from public.solicitudes_venta where id='${rejectedId}'`,'estado'),'rechazada');
  await assert.rejects(db.query(`select public.convertir_solicitud_compra('${rejectedId}')`),/Primero aprobá la solicitud/);

  await scalar(db,`select public.actualizar_estado_solicitud_compra('${requestId}','aprobada',null) data`,'data');
  assert.equal(Number(await scalar(db,'select count(*)::integer n from public.ventas','n')),0);
  await assert.rejects(db.query(`select public.aprobar_solicitud_venta('${requestId}')`),/circuito administrativo/);
  assert.equal(Number(await scalar(db,'select count(*)::integer n from public.ventas','n')),0);
  const finalSnapshot=await scalar(db,`select public.guardar_condiciones_finales_solicitud('${requestId}','credito_9') data`,'data');
  assert.equal(Number(finalSnapshot.producto.precio_contado),120000);
  assert.equal(Number(finalSnapshot.seleccion.total),238800);
  assert.equal(Number((await scalar(db,`select snapshot_solicitado data from public.solicitudes_venta where id='${requestId}'`,'data')).producto.precio_contado),100000);
  await db.exec("insert into public.clientes(id,nombre,dni,telefono,creado_por_vendedor_id) values('99999999-9999-4999-8999-999999999999','Lucía Fernández','30111222','5493855550101','cccccccc-cccc-4ccc-8ccc-cccccccccccc')");
  await db.exec("update public.vendedores set activo=false where id='cccccccc-cccc-4ccc-8ccc-cccccccccccc'");
  const unavailable=await scalar(db,`select public.obtener_catalogo_publico('${token}') data`,'data');
  assert.equal(unavailable.disponible,false);
  const converted=await scalar(db,`select public.convertir_solicitud_compra('${requestId}') data`,'data');
  assert.equal(converted.ok,true);
  assert.equal(converted.duplicado,false);
  assert.equal(Number(await scalar(db,"select count(*)::integer n from public.cuentas_credito",'n')),1);
  assert.equal(Number(await scalar(db,"select count(*)::integer n from public.cuotas_credito",'n')),9);
  assert.equal(Number(await scalar(db,"select sum(importe) n from public.cuotas_credito",'n')),238800);
  assert.equal(Number(await scalar(db,"select count(*)::integer n from public.comisiones",'n')),0);
  const secondConversion=await scalar(db,`select public.convertir_solicitud_compra('${requestId}') data`,'data');
  assert.equal(secondConversion.duplicado,true);
  assert.equal(Number(await scalar(db,"select count(*)::integer n from public.ventas",'n')),1);
  assert.equal(Number(await scalar(db,"select count(*)::integer n from public.clientes",'n')),1);
  assert.equal(await scalar(db,"select vendedor_id::text id from public.ventas limit 1",'id'),'cccccccc-cccc-4ccc-8ccc-cccccccccccc');
  assert.equal(Number(await scalar(db,"select monto_total n from public.ventas limit 1",'n')),238800);

  // Trigger operativo real: comisión al entregar, una sola vez.
  await db.exec(`update public.ventas set estado='entregada' where id='${converted.venta_id}'`);
  assert.equal(Number(await scalar(db,'select count(*)::integer n from public.comisiones','n')),1);
  assert.equal(Number(await scalar(db,'select importe_original n from public.comisiones limit 1','n')),11940);
  assert.equal(await scalar(db,'select vendedor_id::text id from public.comisiones limit 1','id'),'cccccccc-cccc-4ccc-8ccc-cccccccccccc');
  await db.exec(`update public.ventas set estado='en_cobranza' where id='${converted.venta_id}'; update public.ventas set estado='consolidada' where id='${converted.venta_id}'`);
  assert.equal(Number(await scalar(db,'select count(*)::integer n from public.comisiones','n')),1);
  assert.equal(Number(await scalar(db,'select count(*)::integer n from public.movimientos_vendedor','n')),1);

  // Arquitectura general: solicitud, venta y crédito directos con vendedor NULL.
  await db.exec(`insert into public.solicitudes_venta(clave_idempotencia,vendedor_id,producto_id,unidad,producto_nombre,producto_precio_contado,cliente_nombre,cliente_dni,forma_pago,monto_total,anticipo,frecuencia,estado,canal_origen,estado_comercial,snapshot_solicitado)
    values(gen_random_uuid(),null,'dddddddd-dddd-4ddd-8ddd-dddddddddddd','hogar','Alacena 120 cm',120000,'Cliente REST directo','30111223','Contado',120000,120000,'unico','pendiente','catalogo_publico_directo','nueva',jsonb_build_object('producto',jsonb_build_object('nombre','Alacena 120 cm'),'seleccion',jsonb_build_object('codigo','contado','titulo','Contado','total',120000,'anticipo',120000,'cantidad_cuotas',0,'valor_cuota',0,'frecuencia','unico')))`);
  const directId=await scalar(db,"select id::text id from public.solicitudes_venta where canal_origen='catalogo_publico_directo'",'id');
  await scalar(db,`select public.actualizar_estado_solicitud_compra('${directId}','aprobada',null) data`,'data');
  const direct=await scalar(db,`select public.convertir_solicitud_compra('${directId}') data`,'data');
  assert.equal(await scalar(db,`select vendedor_id from public.ventas where id='${direct.venta_id}'`,'vendedor_id'),null);
  assert.equal(await scalar(db,`select vendedor_id from public.cuentas_credito where id='${direct.cuenta_credito_id}'`,'vendedor_id'),null);
  await db.exec(`update public.ventas set estado='entregada' where id='${direct.venta_id}'`);
  assert.equal(Number(await scalar(db,'select count(*)::integer n from public.comisiones','n')),1);

  // Límite antiabuso: sexta solicitud de una misma ventana rechazada.
  await db.exec("set request.headers='{\"x-forwarded-for\":\"192.0.2.44\",\"user-agent\":\"sql-rate-test\"}'");
  for(let n=0;n<5;n++)await db.query('select private.controlar_limite_solicitud_catalogo()');
  await assert.rejects(db.query('select private.controlar_limite_solicitud_catalogo()'),/Demasiados intentos/);

  const anonCanRead=await scalar(db,"select has_table_privilege('anon','public.solicitudes_venta','select') allowed",'allowed');
  assert.equal(anonCanRead,false);
  const sellerCanExecuteAdmin=await scalar(db,"select has_function_privilege('authenticated','public.convertir_solicitud_compra(uuid)','execute') allowed",'allowed');
  assert.equal(sellerCanExecuteAdmin,true);
  await db.exec("set app.test_uid='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'");
  await assert.rejects(db.query(`select public.actualizar_estado_solicitud_compra('${requestId}','en_revision',null)`),/Solo Administración|cerrada/);

  await db.close();
  console.log('SQL smoke: migración, catálogo, snapshot, atribución, conversión e idempotencia OK');
})().catch(error=>{console.error(error.message);process.exitCode=1});
