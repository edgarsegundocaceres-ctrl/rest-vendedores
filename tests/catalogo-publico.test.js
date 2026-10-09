const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');

const root=path.resolve(__dirname,'..');
const script=fs.readFileSync(path.join(root,'catalogo-publico.js'),'utf8');
const styles=fs.readFileSync(path.join(root,'catalogo-publico.css'),'utf8');
const html=fs.readFileSync(path.join(root,'index.html'),'utf8');
const migration=fs.readFileSync(path.join(root,'supabase/migrations/20261008145528_catalogo_publico_vendedor_solicitudes_compra.sql'),'utf8');

function helpers(){
  const sandbox={console,Intl,Date,URL,URLSearchParams};
  vm.createContext(sandbox);
  vm.runInContext(`${script}\n;globalThis.__helpers={catalogPublicUrl,catalogDemoOptions,catalogNormalizeClient,catalogValidateClient,catalogModalityLabel,catalogRequestStateLabel,catalogWhatsAppPhone,catalogMoney};`,sandbox);
  return sandbox.__helpers;
}

function functionSql(name,nextName){
  const start=migration.indexOf(`create or replace function public.${name}`);
  const end=nextName?migration.indexOf(`create or replace function public.${nextName}`,start):migration.length;
  assert.ok(start>=0,`No se encontró ${name}`);
  return migration.slice(start,end<0?migration.length:end);
}

test('un vendedor activo obtiene un enlace personal con UUID no secuencial',()=>{
  const {catalogPublicUrl}=helpers();
  const token='8d7e0f6a-506a-4c0b-b9fd-13aa93d60723';
  assert.equal(catalogPublicUrl(token),'https://rest-vendedores.vercel.app/?catalogo=8d7e0f6a-506a-4c0b-b9fd-13aa93d60723');
  assert.match(migration,/add column if not exists catalogo_token uuid/);
  assert.match(migration,/vendedores_catalogo_token_uq/);
  assert.match(html,/id="sellerCatalogLink"/);
  assert.match(html,/COMPARTIR POR WHATSAPP/);
});

test('el backend resuelve el vendedor por token y exige vendedor y perfil activos',()=>{
  const getCatalog=functionSql('obtener_catalogo_publico','crear_solicitud_compra_publica');
  assert.match(getCatalog,/v\.catalogo_token::text = lower/);
  assert.match(getCatalog,/v\.activo = true/);
  assert.match(getCatalog,/p\.activo = true/);
  assert.match(getCatalog,/p\.rol = 'vendedor'/);
  assert.doesNotMatch(getCatalog,/dni|telefono|email|comision|costo/i);
});

test('el catálogo abre antes del login y sus RPC públicos tienen permisos mínimos',()=>{
  assert.match(html,/else if\(catalogToken\)bootCatalogPublic\(catalogToken\);else if\(sellerApplicationRoute\)/);
  assert.match(migration,/grant execute on function public\.obtener_catalogo_publico\(text\) to anon, authenticated/);
  assert.match(migration,/grant execute on function public\.crear_solicitud_compra_publica\(text,uuid,text,jsonb,uuid,text,text\) to anon, authenticated/);
  assert.match(migration,/revoke all on table public\.solicitudes_venta from anon/);
  assert.doesNotMatch(migration,/grant\s+select\s+on\s+table\s+public\.solicitudes_venta\s+to\s+anon/i);
});

test('el catálogo expone solo productos activos de Hogar y Celulares',()=>{
  const getCatalog=functionSql('obtener_catalogo_publico','crear_solicitud_compra_publica');
  assert.match(getCatalog,/p\.activo = true/);
  assert.match(getCatalog,/p\.categoria in \('hogar','celulares'\)/);
  assert.match(getCatalog,/private\.proyectar_producto_catalogo\(p\.id\)/);
  assert.doesNotMatch(getCatalog,/productos_costos|margen|comision/);
});

test('contado, 6 cuotas y 9 cuotas reproducen las reglas comerciales actuales',()=>{
  const {catalogDemoOptions,catalogMoney}=helpers();
  const quote=catalogDemoOptions(100000);
  assert.equal(quote.contado.total,100000);
  assert.equal(quote.credito_6.total,157000);
  assert.equal(quote.credito_6.valor_cuota,26166.67);
  assert.equal(quote.credito_9.total,199000);
  assert.equal(quote.credito_9.valor_cuota,22111.11);
  assert.match(catalogMoney(quote.credito_6.valor_cuota),/26\.166,67/);
  assert.match(catalogMoney(quote.credito_9.valor_cuota),/22\.111,11/);
  assert.match(migration,/precio_contado\*\(1\+0\.095\*6\)/);
  assert.match(migration,/precio_contado\*\(1\+0\.11\*9\)/);
});

test('el formulario móvil valida y normaliza los datos requeridos',()=>{
  const {catalogValidateClient}=helpers();
  const valid=catalogValidateClient({nombre:' Ana ',apellido:' Pérez ',dni:'30.111.222',telefono:'+54 9 385 555 0101',localidad:'La Banda',domicilio:'San Martín 145',observaciones:''});
  assert.equal(valid.ok,true);
  assert.equal(valid.value.dni,'30111222');
  assert.equal(valid.value.telefono,'5493855550101');
  const invalid=catalogValidateClient({nombre:'A',apellido:'',dni:'12',telefono:'123',localidad:'',domicilio:''});
  assert.equal(invalid.ok,false);
  assert.ok(Object.keys(invalid.errors).length>=6);
  assert.match(styles,/@media\(max-width:520px\)/);
  assert.match(html,/inputmode="numeric"/);
  assert.match(html,/inputmode="tel"/);
});

test('la solicitud pública deriva precio, producto y vendedor en servidor',()=>{
  const create=functionSql('crear_solicitud_compra_publica','actualizar_estado_solicitud_compra');
  assert.match(create,/private\.opciones_catalogo_producto\(v_producto\.id\)/);
  assert.match(create,/v_plan := v_opciones->lower/);
  assert.match(create,/v_vendedor\.id,v_producto\.id,v_producto\.categoria,v_producto\.nombre/);
  assert.doesNotMatch(create,/p_precio|p_vendedor_id|p_monto|p_cuota/);
  assert.match(create,/p_sitio_web/);
  assert.match(create,/private\.controlar_limite_solicitud_catalogo/);
});

test('el envío conserva snapshot completo y reglas sin depender de precios futuros',()=>{
  const create=functionSql('crear_solicitud_compra_publica','actualizar_estado_solicitud_compra');
  assert.match(create,/'capturado_en',clock_timestamp\(\)/);
  assert.match(create,/'producto',jsonb_build_object/);
  assert.match(create,/'opciones',v_opciones/);
  assert.match(create,/'seleccion',v_plan/);
  assert.match(create,/'vendedor_origen'/);
  assert.match(migration,/snapshot_solicitado is distinct from old\.snapshot_solicitado/);
  assert.match(migration,/El origen y el snapshot solicitado son inmutables/);
  assert.doesNotMatch(functionSql('guardar_condiciones_finales_solicitud','agregar_nota_solicitud_compra'),/snapshot_solicitado\s*=/);
});

test('la atribución personalizada queda bloqueada y sobrevive la desactivación posterior',()=>{
  assert.match(migration,/old\.canal_origen = 'catalogo_publico_vendedor'[\s\S]*new\.vendedor_id is distinct from old\.vendedor_id/);
  const create=functionSql('crear_solicitud_compra_publica','actualizar_estado_solicitud_compra');
  assert.match(create,/v\.activo = true/);
  const convert=functionSql('convertir_solicitud_compra');
  assert.doesNotMatch(convert,/vendedores[\s\S]*activo = true/);
  assert.match(convert,/'vendedor_id',v_solicitud\.vendedor_id/);
});

test('los estados y el historial son explícitos, trazables e inmutables',()=>{
  for(const state of ['nueva','en_revision','contactado','aprobada','rechazada','convertida_en_venta'])assert.match(migration,new RegExp(`'${state}'`));
  assert.match(migration,/create table if not exists public\.solicitudes_compra_historial/);
  assert.match(migration,/before update or delete on public\.solicitudes_compra_historial/);
  assert.match(migration,/estado_anterior/);
  assert.match(migration,/estado_nuevo/);
});

test('Administración tiene bandeja, filtros, detalle, notas y WhatsApp manual',()=>{
  assert.match(html,/data-tab="solicitudesCompraAdmin"/);
  for(const id of ['catalogRequestStateFilter','catalogRequestSellerFilter','catalogRequestModeFilter','catalogRequestDateFrom','catalogRequestDateTo','catalogRequestDetail'])assert.match(html,new RegExp(`id="${id}"`));
  assert.match(script,/CONTACTAR POR WHATSAPP/);
  assert.match(script,/window\.open\(`https:\/\/wa\.me\//);
  assert.doesNotMatch(script,/fetch\(['"]https:\/\/wa\.me/);
  assert.match(script,/solicitudes_compra_notas/);
});

test('solo Administración puede cambiar estado, condiciones, notas o convertir',()=>{
  for(const name of ['actualizar_estado_solicitud_compra','guardar_condiciones_finales_solicitud','agregar_nota_solicitud_compra','convertir_solicitud_compra']){
    const sql=functionSql(name);
    assert.match(sql,/auth\.uid\(\) is null or not public\.es_admin\(\)/);
  }
  assert.doesNotMatch(script.slice(script.indexOf('async function refreshSellerCatalogTools')),/actualizar_estado_solicitud_compra|convertir_solicitud_compra/);
});

test('aprobar no crea la venta y rechazar cierra también el estado interno',()=>{
  const stateFn=functionSql('actualizar_estado_solicitud_compra','guardar_condiciones_finales_solicitud');
  assert.doesNotMatch(stateFn,/insert into public\.ventas|aprobar_solicitud_venta/);
  assert.match(stateFn,/estado = case when v_estado = 'rechazada' then 'rechazada'/);
  assert.match(script,/Todavía no se creará la venta/);
});

test('las condiciones finales son otro snapshot y usan la cotización vigente',()=>{
  const finalFn=functionSql('guardar_condiciones_finales_solicitud','agregar_nota_solicitud_compra');
  assert.match(finalFn,/private\.opciones_catalogo_producto\(v_producto\.id\)/);
  assert.match(finalFn,/set snapshot_final = v_snapshot/);
  assert.match(finalFn,/'definido_en',clock_timestamp\(\)/);
  assert.doesNotMatch(finalFn,/set snapshot_solicitado/);
});

test('la conversión es explícita, idempotente y reutiliza el motor real de ventas',()=>{
  const convert=functionSql('convertir_solicitud_compra');
  assert.match(convert,/for update/);
  assert.match(convert,/estado_comercial = 'convertida_en_venta' and v_solicitud\.venta_id is not null/);
  assert.match(convert,/'duplicado',true/);
  assert.match(convert,/public\.aprobar_solicitud_venta\(p_solicitud_id\)/);
  assert.doesNotMatch(convert,/insert into public\.(ventas|clientes|cuentas_credito|cuotas_credito)/);
  assert.match(convert,/coalesce\(v_solicitud\.snapshot_final->'seleccion',v_solicitud\.snapshot_solicitado->'seleccion'\)/);
});

test('el motor previo conserva deduplicación de cliente, crédito y comisión sin sistemas paralelos',()=>{
  assert.match(migration,/public\.aprobar_solicitud_venta\(p_solicitud_id\)/);
  assert.doesNotMatch(migration,/create table(?: if not exists)? public\.(clientes|ventas|cuentas_credito|cuotas_credito|comisiones)/i);
  assert.doesNotMatch(migration,/insert into public\.comisiones/i);
  assert.doesNotMatch(migration,/create (?:or replace )?function[^;]*(?:comision|comisión)/i);
});

test('la creación pública no puede crear clientes, ventas, créditos ni comisiones',()=>{
  const create=functionSql('crear_solicitud_compra_publica','actualizar_estado_solicitud_compra');
  assert.match(create,/insert into public\.solicitudes_venta/);
  assert.match(create,/insert into public\.solicitudes_compra_historial/);
  assert.doesNotMatch(create,/insert into public\.(clientes|ventas|cuentas_credito|cuotas_credito|comisiones)/);
});

test('RLS oculta historial y notas al vendedor y al visitante',()=>{
  assert.match(migration,/alter table public\.solicitudes_compra_historial enable row level security/);
  assert.match(migration,/alter table public\.solicitudes_compra_notas enable row level security/);
  assert.match(migration,/solicitudes_compra_historial_admin_select[\s\S]*public\.es_admin/);
  assert.match(migration,/solicitudes_compra_notas_admin_select[\s\S]*public\.es_admin/);
  assert.match(migration,/revoke all on table public\.solicitudes_compra_historial from anon, authenticated/);
  assert.match(migration,/revoke all on table public\.solicitudes_compra_notas from anon, authenticated/);
});

test('la pantalla final no comunica compra, venta o crédito confirmados',()=>{
  const success=html.slice(html.indexOf('id="catalogSuccessView"'),html.indexOf('</section>',html.indexOf('id="catalogSuccessView"')));
  assert.match(success,/Solicitud recibida/);
  assert.match(success,/se comunicará con vos/);
  assert.doesNotMatch(success,/Compra realizada|Crédito aprobado|Venta confirmada/i);
});

test('la arquitectura admite REST directo sin asignar vendedores artificialmente',()=>{
  assert.match(migration,/alter column vendedor_id drop not null/);
  assert.match(migration,/'catalogo_publico_directo'/);
  assert.match(migration,/alter table public\.ventas alter column vendedor_id drop not null/);
  assert.doesNotMatch(functionSql('convertir_solicitud_compra'),/Asigná un vendedor/);
});

test('las rutas demo cubren catálogo, ficha, formulario, confirmación, vendedor y Administración',()=>{
  for(const route of ['catalogo-publico','catalogo-producto','catalogo-formulario','catalogo-confirmacion','solicitudes-admin','mi-catalogo'])assert.match(html,new RegExp(`recruitmentDemoRoute==='${route}'`));
  assert.match(html,/Vista previa · no envía datos reales/);
  assert.match(script,/Vista previa: solicitud convertida sin crear datos reales/);
});

test('el desarrollo nuevo permanece aislado de APP INTEGRAL REST Motos',()=>{
  assert.doesNotMatch(script,/motos|alquiler|contrato|chasis|motor/i);
  const publicSql=functionSql('obtener_catalogo_publico','crear_solicitud_compra_publica')+functionSql('crear_solicitud_compra_publica','actualizar_estado_solicitud_compra');
  assert.doesNotMatch(publicSql,/categoria\s*=\s*'motos'|rest_motos|alquiler|contrato/i);
  assert.match(publicSql,/categoria in \('hogar','celulares'\)/g);
});

test('WhatsApp acepta números argentinos locales o internacionales',()=>{
  const {catalogWhatsAppPhone}=helpers();
  assert.equal(catalogWhatsAppPhone('385 3020483'),'5493853020483');
  assert.equal(catalogWhatsAppPhone('+54 9 385 3020483'),'5493853020483');
  assert.equal(catalogWhatsAppPhone('0385 15 3020483'),'5493853020483');
});

test('las 9 cuotas siguen visibles en cards de pantallas pequeñas',()=>{
  assert.doesNotMatch(styles,/catalog-installment:nth-child\(2\)\{display:none/);
});

test('la versión comercial evita enviar importes que el cliente no vio',()=>{
  assert.match(migration,/p_version_cotizacion is distinct from v_publico->>'version_cotizacion'/);
  assert.match(script,/p_version_cotizacion:catalogPublicState.product.version_cotizacion/);
  assert.match(script,/condiciones_actualizadas/);
});

test('Administración controla descripción y visibilidad en productos existentes',()=>{
  assert.match(migration,/add column if not exists descripcion_publica/);
  assert.match(html,/Descripción pública/);
  assert.match(script,/catalogo_publico:product.catalogo_publico===false/);
});
