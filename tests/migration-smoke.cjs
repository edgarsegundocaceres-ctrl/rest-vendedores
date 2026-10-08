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
  await db.exec(migration);

  const token=await scalar(db,"select catalogo_token::text token from public.vendedores where id='cccccccc-cccc-4ccc-8ccc-cccccccccccc'",'token');
  assert.match(token,/^[0-9a-f-]{36}$/);
  const catalog=await scalar(db,`select public.obtener_catalogo_publico('${token}') data`,'data');
  assert.equal(catalog.disponible,true);
  assert.equal(catalog.productos.length,1);
  assert.equal(Number(catalog.productos[0].opciones.contado.total),100000);
  assert.equal(Number(catalog.productos[0].opciones.credito_6.total),157000);
  assert.equal(Number(catalog.productos[0].opciones.credito_9.total),199000);

  const key='eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';
  const customer=JSON.stringify({nombre:'Lucía',apellido:'Fernández',dni:'30111222',telefono:'5493855550101',localidad:'Santiago del Estero',domicilio:'San Martín 145',observaciones:'Por la tarde'}).replaceAll("'","''");
  const created=await scalar(db,`select public.crear_solicitud_compra_publica('${token}','dddddddd-dddd-4ddd-8ddd-dddddddddddd','credito_6','${customer}'::jsonb,'${key}',null) data`,'data');
  assert.equal(created.ok,true);
  const duplicate=await scalar(db,`select public.crear_solicitud_compra_publica('${token}','dddddddd-dddd-4ddd-8ddd-dddddddddddd','credito_6','${customer}'::jsonb,'${key}',null) data`,'data');
  assert.equal(duplicate.duplicado,true);
  assert.equal(Number(await scalar(db,"select count(*)::integer n from public.solicitudes_venta",'n')),1);

  const requestId=await scalar(db,"select id::text id from public.solicitudes_venta limit 1",'id');
  const originalSnapshot=await scalar(db,`select snapshot_solicitado data from public.solicitudes_venta where id='${requestId}'`,'data');
  assert.equal(Number(originalSnapshot.producto.precio_contado),100000);
  assert.equal(originalSnapshot.vendedor_origen.id,'cccccccc-cccc-4ccc-8ccc-cccccccccccc');
  await db.exec("update public.productos set precio_contado=120000 where id='dddddddd-dddd-4ddd-8ddd-dddddddddddd'");
  const persistedSnapshot=await scalar(db,`select snapshot_solicitado data from public.solicitudes_venta where id='${requestId}'`,'data');
  assert.deepEqual(persistedSnapshot,originalSnapshot);

  await assert.rejects(db.exec(`update public.solicitudes_venta set vendedor_id=null where id='${requestId}'`),/vendedor de origen es inmutable/);
  await assert.rejects(db.exec(`update public.solicitudes_venta set snapshot_solicitado='{}'::jsonb where id='${requestId}'`),/snapshot solicitado son inmutables/);

  const rejectedKey='ffffffff-ffff-4fff-8fff-ffffffffffff';
  await scalar(db,`select public.crear_solicitud_compra_publica('${token}','dddddddd-dddd-4ddd-8ddd-dddddddddddd','contado','${customer}'::jsonb,'${rejectedKey}',null) data`,'data');
  const rejectedId=await scalar(db,`select id::text id from public.solicitudes_venta where clave_idempotencia='${rejectedKey}'`,'id');
  await db.exec("set app.test_uid='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'");
  await scalar(db,`select public.actualizar_estado_solicitud_compra('${rejectedId}','rechazada','No cumple las condiciones comerciales') data`,'data');
  assert.equal(await scalar(db,`select estado from public.solicitudes_venta where id='${rejectedId}'`,'estado'),'rechazada');
  await assert.rejects(db.query(`select public.convertir_solicitud_compra('${rejectedId}')`),/Primero aprobá la solicitud/);

  await scalar(db,`select public.actualizar_estado_solicitud_compra('${requestId}','aprobada',null) data`,'data');
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
  const secondConversion=await scalar(db,`select public.convertir_solicitud_compra('${requestId}') data`,'data');
  assert.equal(secondConversion.duplicado,true);
  assert.equal(Number(await scalar(db,"select count(*)::integer n from public.ventas",'n')),1);
  assert.equal(Number(await scalar(db,"select count(*)::integer n from public.clientes",'n')),1);
  assert.equal(await scalar(db,"select vendedor_id::text id from public.ventas limit 1",'id'),'cccccccc-cccc-4ccc-8ccc-cccccccccccc');
  assert.equal(Number(await scalar(db,"select monto_total n from public.ventas limit 1",'n')),238800);

  const anonCanRead=await scalar(db,"select has_table_privilege('anon','public.solicitudes_venta','select') allowed",'allowed');
  assert.equal(anonCanRead,false);
  const sellerCanExecuteAdmin=await scalar(db,"select has_function_privilege('authenticated','public.convertir_solicitud_compra(uuid)','execute') allowed",'allowed');
  assert.equal(sellerCanExecuteAdmin,true);
  await db.exec("set app.test_uid='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'");
  await assert.rejects(db.query(`select public.actualizar_estado_solicitud_compra('${requestId}','en_revision',null)`),/Solo Administración|cerrada/);

  await db.close();
  console.log('SQL smoke: migración, catálogo, snapshot, atribución, conversión e idempotencia OK');
})().catch(error=>{console.error(error);process.exitCode=1});
