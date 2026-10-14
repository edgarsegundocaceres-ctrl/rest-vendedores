-- APP INTEGRAL REST exclusivamente. Sin backfill ni modificación de costos/precios/históricos.
alter table public.productos_costos add column costo_proveedor_usd numeric(18,4)
 check(costo_proveedor_usd>0 and costo_proveedor_usd<1000000000);
create table private.dolar_rest_celulares (
 id boolean primary key default true check(id), valor numeric(18,4) check(valor>0 and valor<1000000000),
 actualizado_en timestamptz, actualizado_por uuid references public.perfiles(id)
);
insert into private.dolar_rest_celulares(id) values(true);
create table private.motor_precios_auditoria (
 id bigint generated always as identity primary key,tipo text not null,entidad_id uuid,
 detalle jsonb not null,registrado_en timestamptz not null default now(),usuario_id uuid default auth.uid()
);
create index motor_precios_auditoria_entidad on private.motor_precios_auditoria(tipo,entidad_id,id desc);
alter table private.dolar_rest_celulares enable row level security;
alter table private.motor_precios_auditoria enable row level security;
revoke all on private.dolar_rest_celulares,private.motor_precios_auditoria from public,anon,authenticated;
create function private.motor_precios_inmutable() returns trigger language plpgsql set search_path='' as $$
begin raise exception 'El historial comercial es inmutable'; end $$;
create trigger motor_precios_auditoria_inmutable before update or delete on private.motor_precios_auditoria for each row execute function private.motor_precios_inmutable();

create function private.base_comercial_producto(p_id uuid) returns jsonb language plpgsql set search_path='' as $$
declare c text; ars numeric; usd numeric; dolar numeric; base numeric; contado numeric;
begin
 perform pg_catalog.pg_advisory_xact_lock_shared(731906);
 select p.categoria,pc.costo,pc.costo_proveedor_usd into c,ars,usd from public.productos p left join public.productos_costos pc on pc.producto_id=p.id where p.id=p_id;
 if c='hogar' then
  if ars is null or not (ars>0 and ars<1000000000000) then raise exception 'Costo ARS pendiente de configuración'; end if;
  base:=ars;contado:=round(base*1.60,2);
 elsif c='celulares' then
  select valor into dolar from private.dolar_rest_celulares where id;
  if usd is null or dolar is null then raise exception 'Costo USD o Dólar REST pendiente de configuración'; end if;
  base:=(usd+10)*dolar;contado:=round(base*1.40,2);
 else raise exception 'Categoría fuera del motor Hogar/Celulares'; end if;
 return jsonb_strip_nulls(jsonb_build_object('motor_version',2,'categoria',c,'costo_ars',case when c='hogar' then ars end,
 'costo_proveedor_usd',case when c='celulares' then usd end,'adicional_usd',case when c='celulares' then 10 end,'dolar_rest',dolar,'costo_base_ars',base,'contado',contado,
 'credito_personal',jsonb_build_array(
 jsonb_build_object('cuotas',6,'total',round(base*2.50,2),'cuota',round(round(base*2.50,2)/6,2),'ultima_cuota',round(base*2.50,2)-5*round(round(base*2.50,2)/6,2),'primera_cuota','al_inicio'),
 jsonb_build_object('cuotas',9,'total',round(base*3.20,2),'cuota',round(round(base*3.20,2)/9,2),'ultima_cuota',round(base*3.20,2)-8*round(round(base*3.20,2)/9,2),'primera_cuota','al_inicio'))));
end $$;
create function private.precio_motor_disponible(p_id uuid) returns boolean language sql stable set search_path='' as $$
 select exists(select 1 from public.productos p join public.productos_costos c on c.producto_id=p.id
 where p.id=p_id and ((p.categoria='hogar' and c.costo>0 and c.costo<1000000000000) or
 (p.categoria='celulares' and c.costo_proveedor_usd>0 and exists(select 1 from private.dolar_rest_celulares where valor>0))))
$$;
create function public.obtener_dolar_rest() returns jsonb language plpgsql security definer set search_path='' as $$
begin
 if auth.uid() is null or not public.es_admin() then raise exception 'Solo Administración'; end if;
 return (select to_jsonb(d)||jsonb_build_object('administrador',p.nombre) from private.dolar_rest_celulares d left join public.perfiles p on p.id=d.actualizado_por where d.id);
end $$;
create function public.actualizar_dolar_rest(p_valor numeric) returns jsonb language plpgsql security definer set search_path='' as $$
declare anterior numeric;
begin
 if auth.uid() is null or not public.es_admin() then raise exception 'Solo Administración'; end if;
 if p_valor is null or not(p_valor>0 and p_valor<1000000000) or p_valor<>round(p_valor,4) then raise exception 'Dólar REST inválido (hasta 4 decimales)'; end if;
 perform pg_catalog.pg_advisory_xact_lock(731906);
 select valor into anterior from private.dolar_rest_celulares where id for update;
 update private.dolar_rest_celulares set valor=p_valor,actualizado_en=now(),actualizado_por=auth.uid() where id;
 insert into private.motor_precios_auditoria(tipo,detalle) values('dolar_rest',jsonb_build_object('anterior',anterior,'nuevo',p_valor));
 -- Solo proyección vigente, nunca operaciones guardadas.
 update public.productos p set precio_contado=(private.base_comercial_producto(p.id)->>'contado')::numeric where p.categoria='celulares' and private.precio_motor_disponible(p.id);
 return public.obtener_dolar_rest();
end $$;
create function private.sincronizar_precio_costo() returns trigger language plpgsql security definer set search_path='' as $$
declare pid uuid:=coalesce(new.producto_id,old.producto_id);
begin
 perform pg_catalog.pg_advisory_xact_lock(731906);
 update public.productos p set precio_contado=case when private.precio_motor_disponible(p.id) then (private.base_comercial_producto(p.id)->>'contado')::numeric else 0 end where p.id=pid and p.categoria in ('hogar','celulares');
 return coalesce(new,old);
end $$;
create trigger motor_precio_desde_costo after insert or update or delete on public.productos_costos for each row execute function private.sincronizar_precio_costo();
create function private.proteger_precio_derivado() returns trigger language plpgsql security definer set search_path='' as $$
begin
 if tg_op='UPDATE' and new.categoria is distinct from old.categoria and (new.categoria in ('hogar','celulares') or old.categoria in ('hogar','celulares')) then
  raise exception 'La categoría económica no puede cambiarse: creá un producto en la categoría correcta para preservar moneda e históricos';
 end if;
 if new.categoria in ('hogar','celulares') then
  if tg_op='INSERT' then new.precio_contado:=0;
  elsif new.precio_contado is distinct from old.precio_contado or new.categoria is distinct from old.categoria then
   new.precio_contado:=case when private.precio_motor_disponible(new.id) then (private.base_comercial_producto(new.id)->>'contado')::numeric else 0 end;
  end if;
 end if;
 return new;
end $$;
create trigger motor_proteger_precio before insert or update of precio_contado,categoria on public.productos for each row execute function private.proteger_precio_derivado();
create function public.guardar_costo_producto_rest(p_producto uuid,p_costo numeric) returns jsonb language plpgsql security definer set search_path='' as $$
declare c text;
begin
 if auth.uid() is null or not public.es_admin() then raise exception 'Solo Administración'; end if;
 if p_costo is null or not(p_costo>0 and p_costo<1000000000) or p_costo<>round(p_costo,4) then raise exception 'Costo inválido'; end if;
 perform pg_catalog.pg_advisory_xact_lock(731906);
 select categoria into c from public.productos where id=p_producto;
 if c not in ('hogar','celulares') or c is null then raise exception 'Producto REST inválido'; end if;
 if c='hogar' then insert into public.productos_costos(producto_id,costo) values(p_producto,p_costo) on conflict(producto_id) do update set costo=excluded.costo;
 else insert into public.productos_costos(producto_id,costo,costo_proveedor_usd) values(p_producto,0,p_costo) on conflict(producto_id) do update set costo_proveedor_usd=excluded.costo_proveedor_usd; end if;
 insert into private.motor_precios_auditoria(tipo,entidad_id,detalle) values('costo',p_producto,jsonb_build_object('moneda',case when c='hogar' then 'ARS' else 'USD' end,'valor',p_costo));
 return jsonb_build_object('ok',true,'cotizable',private.precio_motor_disponible(p_producto));
end $$;
-- Costos siempre privados para los usuarios que no administran.
alter table public.productos_costos enable row level security;
revoke all on public.productos_costos from anon;
create policy motor_costos_admin_restrictiva on public.productos_costos as restrictive for all to authenticated using(public.es_admin()) with check(public.es_admin());


CREATE OR REPLACE FUNCTION private.calcular_cotizacion_producto(p_producto_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 VOLATILE
 SET search_path TO ''
AS $function$
declare
  v_producto public.productos%rowtype;
  v_costo numeric;
  v_resultado jsonb;
  v_anticipo numeric;
  v_saldo numeric;
begin
  select p.* into v_producto
  from public.productos p
  where p.id = p_producto_id and p.activo = true;

  if not found then raise exception 'Producto no disponible'; end if;

  select pc.costo into v_costo
  from public.productos_costos pc
  where pc.producto_id = v_producto.id;
  v_costo := coalesce(v_costo, 0);

  if v_producto.categoria in ('hogar','celulares') then
    v_resultado:=private.base_comercial_producto(p_producto_id);
    return jsonb_build_object('motor_version',2,'contado',v_resultado->'contado','credito_personal',v_resultado->'credito_personal',
      'mensual',jsonb_build_object('anticipo_min',round((v_resultado->>'contado')::numeric*0.40,2),'tasa',0.075,'cuotas',jsonb_build_array(6,9,12)),
      'semanal',jsonb_build_object('anticipo_min',round((v_resultado->>'contado')::numeric*0.35,2),'tasa',0.0105,'cuotas',jsonb_build_array(12,16,20)));
  else
    v_anticipo := round(v_costo*0.70,2);
    v_saldo := v_producto.precio_contado-v_anticipo;
    v_resultado := jsonb_build_object(
      'contado',v_producto.precio_contado,
      'credito_personal',jsonb_build_object(
        'anticipo_min',v_anticipo,
        'opciones',jsonb_build_array(
          jsonb_build_object('cuotas',3,'cuota',round((v_saldo*(1+0.09*3))/3,2),'total',round(v_anticipo+v_saldo*(1+0.09*3),2)),
          jsonb_build_object('cuotas',6,'cuota',round((v_saldo*(1+0.09*6))/6,2),'total',round(v_anticipo+v_saldo*(1+0.09*6),2)),
          jsonb_build_object('cuotas',9,'cuota',round((v_saldo*(1+0.09*9))/9,2),'total',round(v_anticipo+v_saldo*(1+0.09*9),2))
        )
      ),
      'entrega_pactada',jsonb_build_object('cuotas',9,'cuota',round((v_costo*1.80)/9,2),'entrega_cuota',3,'total',round(v_costo*1.80,2))
    );
  end if;

  return v_resultado;
end;
$function$
;

create or replace function public.cotizar_producto(p_producto_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null or (not public.es_admin() and public.mi_vendedor_id() is null) then raise exception 'No autorizado'; end if;
  return private.calcular_cotizacion_producto(p_producto_id);
end;
$$;

create or replace function private.opciones_catalogo_producto(p_producto_id uuid)
returns jsonb
language plpgsql
volatile
set search_path = ''
as $$
declare
  v_producto public.productos%rowtype;
  v_cotizacion jsonb;
  v_seis jsonb;
  v_nueve jsonb;
begin
  select p.* into v_producto
  from public.productos p
  where p.id = p_producto_id
    and p.activo = true
    and p.catalogo_publico = true
    and p.categoria in ('hogar','celulares')
    and private.precio_motor_disponible(p.id);
  if not found then raise exception 'Producto REST no disponible'; end if;

  v_cotizacion := private.calcular_cotizacion_producto(p_producto_id);
  v_producto.precio_contado:=(v_cotizacion->>'contado')::numeric;
  select value into v_seis
  from jsonb_array_elements(v_cotizacion->'credito_personal')
  where (value->>'cuotas')::integer = 6;
  select value into v_nueve
  from jsonb_array_elements(v_cotizacion->'credito_personal')
  where (value->>'cuotas')::integer = 9;

  return jsonb_strip_nulls(jsonb_build_object(
    'contado', jsonb_build_object(
      'codigo','contado','titulo','Contado','total',round(v_producto.precio_contado,2),
      'anticipo',round(v_producto.precio_contado,2),'cantidad_cuotas',0,
      'valor_cuota',0,'frecuencia','unico'
    ),
    'credito_6', case when v_seis is not null then jsonb_build_object(
      'codigo','credito_6','titulo','Crédito personal · 6 cuotas',
      'total',(v_seis->>'total')::numeric,'anticipo',0,'cantidad_cuotas',6,
      'valor_cuota',(v_seis->>'cuota')::numeric,'frecuencia','mensual',
      'motor_version',2,'primera_cuota','al_inicio','ultima_cuota',v_seis->'ultima_cuota'
    ) end,
    'credito_9', case when v_nueve is not null then jsonb_build_object(
      'codigo','credito_9','titulo','Crédito personal · 9 cuotas',
      'total',(v_nueve->>'total')::numeric,'anticipo',0,'cantidad_cuotas',9,
      'valor_cuota',(v_nueve->>'cuota')::numeric,'frecuencia','mensual',
      'motor_version',2,'primera_cuota','al_inicio','ultima_cuota',v_nueve->'ultima_cuota'
    ) end
  ));
end;
$$;

create or replace function private.proyectar_producto_catalogo(p_producto_id uuid)
returns jsonb language sql volatile set search_path = '' as $$
  select datos || jsonb_build_object('version_cotizacion',md5(datos::text))
  from (
    select jsonb_build_object('id',p.id,'nombre',p.nombre,'categoria',p.categoria,
      'subcategoria',p.subcategoria,'descripcion_publica',p.descripcion_publica,
      'imagen_url',p.imagen_url,'precio_contado',private.calcular_cotizacion_producto(p.id)->'contado',
      'opciones',private.opciones_catalogo_producto(p.id)) datos
    from public.productos p where p.id=p_producto_id and p.activo and p.catalogo_publico
      and p.categoria in ('hogar','celulares') and private.precio_motor_disponible(p.id)
  ) producto;
$$;

create or replace function public.obtener_catalogo_publico(p_token text)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_vendedor public.vendedores%rowtype;
  v_productos jsonb;
begin
  select v.* into v_vendedor
  from public.vendedores v
  join public.perfiles p on p.id = v.user_id
  where v.catalogo_token::text = lower(btrim(coalesce(p_token,'')))
    and v.activo = true
    and p.activo = true
    and p.rol = 'vendedor'
  limit 1;

  if not found then
    return jsonb_build_object('disponible',false,'mensaje','Este catálogo no está disponible.');
  end if;

  select coalesce(jsonb_agg(private.proyectar_producto_catalogo(p.id)
    order by p.orden,p.nombre),'[]'::jsonb)
  into v_productos
  from public.productos p
  where p.activo = true
    and p.catalogo_publico = true
    and p.categoria in ('hogar','celulares')
    and private.precio_motor_disponible(p.id);

  return jsonb_build_object(
    'disponible',true,
    'vendedor',jsonb_build_object('nombre',v_vendedor.nombre),
    'productos',v_productos
  );
end;
$$;

CREATE OR REPLACE FUNCTION public.calcular_presupuesto_rest(p_producto_id uuid, p_modalidad text, p_cuotas integer DEFAULT 0, p_anticipo numeric DEFAULT 0)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_producto public.productos%rowtype;
  v_quote jsonb;
  v_option jsonb;
  v_cfg jsonb;
  v_coefficients constant jsonb := '{"2":1.0819,"3":1.1232,"4":1.1658,"5":1.2098,"6":1.2552,"7":1.4161,"8":1.4854,"9":1.5577,"10":1.6331,"11":1.7935,"12":1.7935,"18":2.3629,"24":3.0948}'::jsonb;
  v_coef numeric;
  v_cash numeric;
  v_total numeric;
  v_value numeric;
  v_balance numeric;
  v_rate numeric;
  v_min numeric;
  v_frequency text;
begin
  if auth.uid() is null then raise exception 'No autorizado'; end if;
  if public.mi_vendedor_id() is null and not public.es_admin() then raise exception 'Vendedor no habilitado'; end if;

  select * into v_producto from public.productos
  where id = p_producto_id and activo = true and categoria in ('hogar','celulares');
  if not found then raise exception 'Producto REST no disponible para presupuestar'; end if;
  v_quote := public.cotizar_producto(p_producto_id);
  v_cash := (v_quote->>'contado')::numeric;
  if v_cash <= 0 then raise exception 'El producto no tiene un precio válido'; end if;

  if p_modalidad = 'Contado' then
    return jsonb_build_object(
      'title','Contado','total',round(v_cash,2),'down',0,'count',0,'value',0,
      'frequency','unico','paymentText','Contado'
    );
  elsif p_modalidad = 'Crédito personal' then
    select value into v_option
    from jsonb_array_elements(v_quote->'credito_personal')
    where (value->>'cuotas')::integer = p_cuotas;
    if v_option is null then raise exception 'Ese plan de crédito ya no está disponible'; end if;
    return jsonb_build_object(
      'title',format('Crédito personal · %s cuotas',p_cuotas),
      'total',(v_option->>'total')::numeric,'down',0,'count',p_cuotas,
      'value',(v_option->>'cuota')::numeric,'frequency','mensual','primera_cuota','al_inicio','ultima_cuota',v_option->'ultima_cuota','motor_version',2,
      'paymentText',format('Crédito personal · %s cuotas de %s',p_cuotas,(v_option->>'cuota')::numeric)
    );
  elsif p_modalidad in ('Anticipo + cuotas mensuales','Anticipo + cuotas semanales') then
    v_cfg := case when p_modalidad like '%semanales' then v_quote->'semanal' else v_quote->'mensual' end;
    if v_cfg is null or not exists (
      select 1 from jsonb_array_elements_text(v_cfg->'cuotas') q where q::integer = p_cuotas
    ) then raise exception 'Ese plan ya no está disponible'; end if;
    v_min := (v_cfg->>'anticipo_min')::numeric;
    v_rate := (v_cfg->>'tasa')::numeric;
    if coalesce(p_anticipo,0) < v_min then raise exception 'El anticipo mínimo es %', v_min; end if;
    if p_anticipo >= v_cash then raise exception 'El anticipo debe ser menor al contado'; end if;
    v_balance := v_cash - p_anticipo;
    v_total := round(p_anticipo + v_balance * (1 + v_rate * p_cuotas), 2);
    v_value := round((v_total - p_anticipo) / p_cuotas, 2);
    v_frequency := case when p_modalidad like '%semanales' then 'semanal' else 'mensual' end;
    return jsonb_build_object(
      'title',format('Anticipo + %s cuotas %s',p_cuotas,v_frequency),
      'total',v_total,'down',round(p_anticipo,2),'count',p_cuotas,'value',v_value,
      'frequency',v_frequency,
      'paymentText',format('Anticipo %s + %s cuotas %s de %s',round(p_anticipo,2),p_cuotas,v_frequency,v_value)
    );
  elsif p_modalidad = 'Tarjeta Sol' then
    v_coef := (v_coefficients->>p_cuotas::text)::numeric;
    if v_coef is null then raise exception 'No hay coeficiente vigente para esa cantidad de cuotas'; end if;
    v_total := round(v_cash * v_coef, 2);
    v_value := round(v_total / p_cuotas, 2);
    return jsonb_build_object(
      'title',format('Tarjeta Sol · %s cuotas',p_cuotas),
      'total',v_total,'down',0,'count',p_cuotas,'value',v_value,
      'frequency','mensual',
      'paymentText',format('Tarjeta Sol · %s cuotas de %s',p_cuotas,v_value)
    );
  end if;

  raise exception 'Modalidad no habilitada para presupuestos REST';
end;
$function$
;

CREATE OR REPLACE FUNCTION public.crear_presupuesto_vendedor(p_producto_id uuid, p_modalidad text, p_cuotas integer DEFAULT 0, p_anticipo numeric DEFAULT 0, p_prospecto_nombre text DEFAULT NULL::text, p_prospecto_telefono text DEFAULT NULL::text, p_prospecto_email text DEFAULT NULL::text, p_vigencia_dias integer DEFAULT 7, p_cliente_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_vendedor_id uuid := public.mi_vendedor_id();
  v_producto public.productos%rowtype;
  v_quote jsonb;
  v_row public.presupuestos;
begin
  if v_vendedor_id is null then raise exception 'Vendedor no habilitado'; end if;
  if p_vigencia_dias not between 1 and 30 then raise exception 'La vigencia debe ser de 1 a 30 días'; end if;
  if p_prospecto_email is not null and btrim(p_prospecto_email) <> ''
     and lower(btrim(p_prospecto_email)) !~ '^[a-z0-9._%+\-]+@[a-z0-9.\-]+\.[a-z]{2,}$' then
    raise exception 'Email del prospecto inválido';
  end if;
  if p_prospecto_telefono is not null and btrim(p_prospecto_telefono) <> ''
     and char_length(regexp_replace(p_prospecto_telefono, '[^0-9]', '', 'g')) not between 8 and 15 then
    raise exception 'Teléfono del prospecto inválido';
  end if;
  if p_cliente_id is not null and not exists (
    select 1 from public.clientes c
    where c.id = p_cliente_id
      and (c.creado_por_vendedor_id = v_vendedor_id or exists (
        select 1 from public.ventas ve where ve.cliente_id = c.id and ve.vendedor_id = v_vendedor_id
      ))
  ) then raise exception 'Cliente no disponible para este vendedor'; end if;

  select * into v_producto from public.productos
  where id = p_producto_id and activo = true and categoria in ('hogar','celulares');
  if not found then raise exception 'Producto REST no disponible para presupuestar'; end if;

  v_quote := public.calcular_presupuesto_rest(p_producto_id,p_modalidad,p_cuotas,p_anticipo);

  insert into public.presupuestos (
    vendedor_id, cliente_id, producto_id, prospecto_nombre, prospecto_telefono, prospecto_email,
    producto_nombre_snapshot, producto_categoria_snapshot, producto_imagen_url_snapshot,
    precio_contado_snapshot, modalidad_snapshot, anticipo_snapshot, cantidad_cuotas_snapshot,
    valor_cuota_snapshot, frecuencia_snapshot, total_snapshot, condiciones_snapshot,
    vigencia_dias, vigente_hasta
  ) values (
    v_vendedor_id, p_cliente_id, v_producto.id,
    nullif(btrim(p_prospecto_nombre), ''), nullif(btrim(p_prospecto_telefono), ''),
    nullif(lower(btrim(p_prospecto_email)), ''), v_producto.nombre, v_producto.categoria,
    v_producto.imagen_url, (private.calcular_cotizacion_producto(p_producto_id)->>'contado')::numeric, p_modalidad,
    (v_quote->>'down')::numeric, (v_quote->>'count')::integer,
    (v_quote->>'value')::numeric, v_quote->>'frequency', (v_quote->>'total')::numeric,
    v_quote, p_vigencia_dias, current_date + p_vigencia_dias
  ) returning * into v_row;

  return jsonb_build_object('presupuesto',to_jsonb(v_row),'cotizacion',v_quote);
end;
$function$
;

create or replace function public.crear_solicitud_compra_publica(
  p_token text,
  p_producto_id uuid,
  p_modalidad text,
  p_cliente jsonb,
  p_clave_idempotencia uuid,
  p_version_cotizacion text,
  p_sitio_web text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_vendedor public.vendedores%rowtype;
  v_producto public.productos%rowtype;
  v_existente public.solicitudes_venta%rowtype;
  v_solicitud public.solicitudes_venta%rowtype;
  v_opciones jsonb;
  v_plan jsonb;
  v_nombre text;
  v_apellido text;
  v_nombre_completo text;
  v_dni text;
  v_telefono text;
  v_localidad text;
  v_domicilio text;
  v_observaciones text;
  v_cantidad integer;
  v_total numeric;
  v_anticipo numeric;
  v_valor numeric;
  v_frecuencia text;
  v_primer_vencimiento date;
  v_snapshot jsonb;
  v_publico jsonb;
begin
  if p_clave_idempotencia is null then raise exception 'Identificador de envío inválido'; end if;
  if p_cliente is null or jsonb_typeof(p_cliente) <> 'object' then raise exception 'Datos del cliente inválidos'; end if;

  perform pg_advisory_xact_lock(hashtextextended('rest-catalogo-envio:' || p_clave_idempotencia::text,0));

  select v.* into v_vendedor
  from public.vendedores v
  join public.perfiles p on p.id = v.user_id
  where v.catalogo_token::text = lower(btrim(coalesce(p_token,'')))
    and v.activo = true and p.activo = true and p.rol = 'vendedor'
  limit 1;
  if not found then raise exception 'El catálogo ya no está disponible'; end if;

  select s.* into v_existente
  from public.solicitudes_venta s
  where s.clave_idempotencia = p_clave_idempotencia;
  if found then
    if v_existente.vendedor_id is distinct from v_vendedor.id
      or v_existente.producto_id is distinct from p_producto_id
      or v_existente.snapshot_solicitado->'seleccion'->>'codigo' is distinct from lower(btrim(p_modalidad))
      or v_existente.cliente_dni is distinct from regexp_replace(coalesce(p_cliente->>'dni',''),'[^0-9]','','g')
    then raise exception 'Clave de envío inválida'; end if;
    return jsonb_build_object(
      'ok',true,'duplicado',true,'codigo',v_existente.codigo,
      'producto',v_existente.producto_nombre,'modalidad',v_existente.forma_pago
    );
  end if;

  if nullif(btrim(coalesce(p_sitio_web,'')), '') is not null then
    return jsonb_build_object('ok',true,'recibida',true);
  end if;

  perform private.controlar_limite_solicitud_catalogo();

  select p.* into v_producto
  from public.productos p
  where p.id = p_producto_id
    and p.activo = true
    and p.catalogo_publico = true
    and p.categoria in ('hogar','celulares')
    and private.precio_motor_disponible(p.id)
  for share;
  if not found then raise exception 'El producto ya no está disponible'; end if;

  v_publico := private.proyectar_producto_catalogo(v_producto.id);
  if p_version_cotizacion is distinct from v_publico->>'version_cotizacion' then
    return jsonb_build_object('ok',false,'condiciones_actualizadas',true,'producto_actualizado',v_publico,
      'mensaje','Las condiciones del producto cambiaron. Revisá los nuevos importes y confirmá nuevamente.');
  end if;
  v_opciones := private.opciones_catalogo_producto(v_producto.id);
  v_plan := v_opciones->lower(btrim(coalesce(p_modalidad,'')));
  if v_plan is null then raise exception 'Elegí Contado, 6 cuotas o 9 cuotas'; end if;

  v_nombre := btrim(coalesce(p_cliente->>'nombre',''));
  v_apellido := btrim(coalesce(p_cliente->>'apellido',''));
  v_nombre_completo := btrim(concat_ws(' ',v_nombre,v_apellido));
  v_dni := regexp_replace(coalesce(p_cliente->>'dni',''), '[^0-9]', '', 'g');
  v_telefono := regexp_replace(coalesce(p_cliente->>'telefono',''), '[^0-9]', '', 'g');
  v_localidad := btrim(coalesce(p_cliente->>'localidad',''));
  v_domicilio := btrim(coalesce(p_cliente->>'domicilio',''));
  v_observaciones := nullif(btrim(coalesce(p_cliente->>'observaciones','')), '');

  if char_length(v_nombre) not between 2 and 80 then raise exception 'Ingresá tu nombre'; end if;
  if char_length(v_apellido) not between 2 and 80 then raise exception 'Ingresá tu apellido'; end if;
  if char_length(v_nombre_completo)>120 then raise exception 'El nombre completo no puede superar 120 caracteres'; end if;
  if char_length(v_dni) not between 6 and 9 then raise exception 'Ingresá un DNI válido'; end if;
  if char_length(v_telefono) not between 8 and 15 then raise exception 'Ingresá un WhatsApp válido'; end if;
  if char_length(v_localidad) not between 2 and 120 then raise exception 'Ingresá tu localidad'; end if;
  if char_length(v_domicilio) not between 4 and 240 then raise exception 'Ingresá tu domicilio'; end if;
  if v_observaciones is not null and char_length(v_observaciones) > 1000 then raise exception 'Las observaciones son demasiado largas'; end if;

  v_cantidad := (v_plan->>'cantidad_cuotas')::integer;
  v_total := (v_plan->>'total')::numeric;
  v_anticipo := (v_plan->>'anticipo')::numeric;
  v_valor := (v_plan->>'valor_cuota')::numeric;
  v_frecuencia := v_plan->>'frecuencia';
  v_primer_vencimiento := case when v_cantidad > 0 then (now() at time zone 'America/Argentina/Cordoba')::date else null end;

  v_plan := v_plan || jsonb_build_object('primer_vencimiento',v_primer_vencimiento);
  v_producto.precio_contado:=(private.calcular_cotizacion_producto(v_producto.id)->>'contado')::numeric;
  v_snapshot := jsonb_build_object(
    'version',1,
    'capturado_en',clock_timestamp(),
    'producto',jsonb_build_object(
      'id',v_producto.id,'nombre',v_producto.nombre,'categoria',v_producto.categoria,
      'subcategoria',v_producto.subcategoria,'imagen_url',v_producto.imagen_url,
      'descripcion_publica',v_producto.descripcion_publica,
      'precio_contado',v_producto.precio_contado
    ),
    'opciones',v_opciones,
    'seleccion',v_plan,
    'vendedor_origen',jsonb_build_object('id',v_vendedor.id,'nombre',v_vendedor.nombre)
  );

  insert into public.solicitudes_venta (
    clave_idempotencia,vendedor_id,producto_id,unidad,producto_nombre,
    producto_precio_contado,cliente_nombre,cliente_dni,cliente_telefono,
    cliente_direccion,cliente_ciudad,forma_pago,monto_total,anticipo,
    cantidad_cuotas,valor_cuota,frecuencia,primer_vencimiento,
    notas,estado,canal_origen,estado_comercial,snapshot_solicitado
  ) values (
    p_clave_idempotencia,v_vendedor.id,v_producto.id,v_producto.categoria,v_producto.nombre,
    v_producto.precio_contado,v_nombre_completo,v_dni,v_telefono,v_domicilio,
    v_localidad,v_plan->>'titulo',v_total,v_anticipo,
    v_cantidad,v_valor,v_frecuencia,v_primer_vencimiento,v_observaciones,
    'pendiente','catalogo_publico_vendedor','nueva',v_snapshot
  )
  on conflict (clave_idempotencia) do nothing
  returning * into v_solicitud;

  if v_solicitud.id is null then
    select s.* into v_solicitud
    from public.solicitudes_venta s
    where s.clave_idempotencia = p_clave_idempotencia;
    if not found or v_solicitud.vendedor_id is distinct from v_vendedor.id then
      raise exception 'No se pudo confirmar el envío';
    end if;
  else
    insert into public.solicitudes_compra_historial (
      solicitud_id,tipo,estado_nuevo,detalle,actor_tipo
    ) values (
      v_solicitud.id,'creada','nueva',
      jsonb_build_object('canal','catalogo_publico_vendedor','modalidad',p_modalidad),
      'publico'
    );
  end if;

  return jsonb_build_object(
    'ok',true,'duplicado',false,'codigo',v_solicitud.codigo,
    'producto',v_solicitud.producto_nombre,'modalidad',v_solicitud.forma_pago
  );
end;
$$;

create or replace function public.actualizar_estado_solicitud_compra(
  p_solicitud_id uuid,
  p_estado text,
  p_nota text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_solicitud public.solicitudes_venta%rowtype;
  v_estado text := lower(btrim(coalesce(p_estado,'')));
  v_nota text := nullif(btrim(coalesce(p_nota,'')), '');
begin
  if auth.uid() is null or not public.es_admin() then raise exception 'Solo Administración'; end if;
  if v_estado not in ('en_revision','contactado','aprobada','rechazada') then raise exception 'Estado inválido'; end if;
  if v_nota is not null and char_length(v_nota) > 2000 then raise exception 'La nota es demasiado larga'; end if;
  if v_estado = 'rechazada' and v_nota is null then raise exception 'Indicá el motivo del rechazo'; end if;

  select s.* into v_solicitud
  from public.solicitudes_venta s
  where s.id = p_solicitud_id
    and (s.canal_origen in ('catalogo_publico_vendedor','catalogo_publico_directo') or (s.canal_origen='portal_vendedor' and s.snapshot_solicitado->>'motor_version'='2'))
  for update;
  if not found then raise exception 'Solicitud no encontrada'; end if;

  if v_solicitud.estado_comercial = v_estado then return to_jsonb(v_solicitud); end if;
  if v_solicitud.estado_comercial in ('rechazada','convertida_en_venta') then
    raise exception 'La solicitud ya está cerrada';
  end if;
  if v_estado = 'en_revision' and v_solicitud.estado_comercial not in ('nueva','contactado') then
    raise exception 'Cambio de estado no permitido';
  end if;
  if v_estado = 'contactado' and v_solicitud.estado_comercial not in ('nueva','en_revision') then
    raise exception 'Cambio de estado no permitido';
  end if;
  if v_estado = 'aprobada' and v_solicitud.estado_comercial not in ('nueva','en_revision','contactado') then
    raise exception 'Cambio de estado no permitido';
  end if;
  if v_estado = 'rechazada' and v_solicitud.estado_comercial not in ('nueva','en_revision','contactado','aprobada') then
    raise exception 'Cambio de estado no permitido';
  end if;

  perform set_config('app.catalogo_solicitud_autorizada',p_solicitud_id::text,true);

  update public.solicitudes_venta
  set estado_comercial = v_estado,
      estado = case when v_estado = 'rechazada' then 'rechazada' else estado end,
      motivo_revision = case when v_estado = 'rechazada' then v_nota else motivo_revision end,
      revisada_por = case when v_estado = 'rechazada' then auth.uid() else revisada_por end,
      revisada_en = case when v_estado = 'rechazada' then now() else revisada_en end,
      contactado_en = case when v_estado = 'contactado' then coalesce(contactado_en,now()) else contactado_en end,
      aprobado_comercial_en = case when v_estado = 'aprobada' then coalesce(aprobado_comercial_en,now()) else aprobado_comercial_en end,
      rechazado_comercial_en = case when v_estado = 'rechazada' then coalesce(rechazado_comercial_en,now()) else rechazado_comercial_en end,
      actualizado_comercial_por = auth.uid(),
      actualizado_en = now()
  where id = p_solicitud_id;

  if v_nota is not null then
    insert into public.solicitudes_compra_notas (solicitud_id,nota,creado_por)
    values (p_solicitud_id,v_nota,auth.uid());
  end if;

  insert into public.solicitudes_compra_historial (
    solicitud_id,tipo,estado_anterior,estado_nuevo,detalle,actor_tipo,realizado_por
  ) values (
    p_solicitud_id,'estado_actualizado',v_solicitud.estado_comercial,v_estado,
    jsonb_strip_nulls(jsonb_build_object('nota',v_nota)),'admin',auth.uid()
  );

  select s.* into v_solicitud from public.solicitudes_venta s where s.id = p_solicitud_id;
  perform set_config('app.catalogo_solicitud_autorizada','',true);
  return to_jsonb(v_solicitud);
end;
$$;

create or replace function public.guardar_condiciones_finales_solicitud(
  p_solicitud_id uuid,
  p_modalidad text,
  p_primer_vencimiento date default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_solicitud public.solicitudes_venta%rowtype;
  v_producto public.productos%rowtype;
  v_opciones jsonb;
  v_plan jsonb;
  v_snapshot jsonb;
begin
  if auth.uid() is null or not public.es_admin() then raise exception 'Solo Administración'; end if;

  select s.* into v_solicitud
  from public.solicitudes_venta s
  where s.id = p_solicitud_id
    and (s.canal_origen in ('catalogo_publico_vendedor','catalogo_publico_directo') or (s.canal_origen='portal_vendedor' and s.snapshot_solicitado->>'motor_version'='2'))
  for update;
  if not found then raise exception 'Solicitud no encontrada'; end if;
  if v_solicitud.estado_comercial in ('rechazada','convertida_en_venta') then raise exception 'La solicitud ya está cerrada'; end if;

  select p.* into v_producto
  from public.productos p
  where p.id = v_solicitud.producto_id and p.activo = true and p.categoria in ('hogar','celulares');
  if not found then raise exception 'El producto ya no está disponible'; end if;

  v_opciones := private.opciones_catalogo_producto(v_producto.id);
  v_plan := v_opciones->lower(btrim(coalesce(p_modalidad,'')));
  if v_plan is null then raise exception 'Elegí Contado, 6 cuotas o 9 cuotas'; end if;
  if (v_plan->>'cantidad_cuotas')::integer > 0
    and p_primer_vencimiento < current_date then raise exception 'El primer vencimiento no puede estar en el pasado'; end if;
  v_plan := v_plan || jsonb_build_object(
    'primer_vencimiento',case when (v_plan->>'cantidad_cuotas')::integer > 0 then (now() at time zone 'America/Argentina/Cordoba')::date else null end
  );

  v_producto.precio_contado:=(private.calcular_cotizacion_producto(v_producto.id)->>'contado')::numeric;
  v_snapshot := jsonb_build_object(
    'version',1,'definido_en',clock_timestamp(),'definido_por',auth.uid(),
    'producto',jsonb_build_object(
      'id',v_producto.id,'nombre',v_producto.nombre,'categoria',v_producto.categoria,
      'subcategoria',v_producto.subcategoria,'imagen_url',v_producto.imagen_url,
      'descripcion_publica',v_producto.descripcion_publica,
      'precio_contado',v_producto.precio_contado
    ),
    'opciones',v_opciones,'seleccion',v_plan
  );

  perform set_config('app.catalogo_solicitud_autorizada',p_solicitud_id::text,true);
  update public.solicitudes_venta
  set snapshot_final = v_snapshot,
      actualizado_comercial_por = auth.uid(),
      actualizado_en = now()
  where id = p_solicitud_id;

  perform set_config('app.catalogo_solicitud_autorizada','',true);

  insert into public.solicitudes_compra_historial (
    solicitud_id,tipo,estado_anterior,estado_nuevo,detalle,actor_tipo,realizado_por
  ) values (
    p_solicitud_id,'condiciones_finales',v_solicitud.estado_comercial,v_solicitud.estado_comercial,
    jsonb_build_object('modalidad',p_modalidad,'seleccion',v_plan),'admin',auth.uid()
  );

  return v_snapshot;
end;
$$;

create or replace function public.agregar_nota_solicitud_compra(
  p_solicitud_id uuid,
  p_nota text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_nota public.solicitudes_compra_notas%rowtype;
begin
  if auth.uid() is null or not public.es_admin() then raise exception 'Solo Administración'; end if;
  if not exists (select 1 from public.solicitudes_venta s where s.id = p_solicitud_id) then
    raise exception 'Solicitud no encontrada';
  end if;
  if char_length(btrim(coalesce(p_nota,''))) not between 1 and 2000 then
    raise exception 'Ingresá una nota de hasta 2000 caracteres';
  end if;
  insert into public.solicitudes_compra_notas (solicitud_id,nota,creado_por)
  values (p_solicitud_id,btrim(coalesce(p_nota,'')),auth.uid())
  returning * into v_nota;
  return to_jsonb(v_nota);
end;
$$;

create or replace function public.convertir_solicitud_compra(p_solicitud_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_solicitud public.solicitudes_venta%rowtype;
  v_resultado jsonb;
  v_plan jsonb;
  v_cantidad integer;
  v_total numeric;
  v_anticipo numeric;
  v_valor numeric;
  v_frecuencia text;
  v_primer_vencimiento date;
begin
  if auth.uid() is null or not public.es_admin() then raise exception 'Solo Administración'; end if;

  select s.* into v_solicitud
  from public.solicitudes_venta s
  where s.id = p_solicitud_id
    and (s.canal_origen in ('catalogo_publico_vendedor','catalogo_publico_directo') or (s.canal_origen='portal_vendedor' and s.snapshot_solicitado->>'motor_version'='2'))
  for update;
  if not found then raise exception 'Solicitud no encontrada'; end if;

  if v_solicitud.estado_comercial = 'convertida_en_venta' and v_solicitud.venta_id is not null then
    return jsonb_build_object(
      'ok',true,'duplicado',true,'solicitud_id',v_solicitud.id,
      'venta_id',v_solicitud.venta_id,'cuenta_credito_id',v_solicitud.cuenta_credito_id
    );
  end if;
  if v_solicitud.estado_comercial <> 'aprobada' then raise exception 'Primero aprobá la solicitud'; end if;
  if v_solicitud.estado <> 'pendiente' then raise exception 'La solicitud interna ya fue resuelta'; end if;

  v_plan := coalesce(v_solicitud.snapshot_final->'seleccion',v_solicitud.snapshot_solicitado->'seleccion');
  if v_plan is null then raise exception 'La solicitud no conserva condiciones válidas'; end if;
  v_cantidad := (v_plan->>'cantidad_cuotas')::integer;
  v_total := (v_plan->>'total')::numeric;
  v_anticipo := (v_plan->>'anticipo')::numeric;
  v_valor := (v_plan->>'valor_cuota')::numeric;
  v_frecuencia := v_plan->>'frecuencia';
  v_primer_vencimiento := case
    when v_cantidad > 0 and v_plan->>'primera_cuota'='al_inicio' then (now() at time zone 'America/Argentina/Cordoba')::date
    when v_cantidad > 0 then coalesce(nullif(v_plan->>'primer_vencimiento','')::date,current_date+30)
    else null
  end;
  if v_cantidad > 0 and v_primer_vencimiento < current_date then
    raise exception 'Definí un primer vencimiento vigente en las condiciones finales antes de convertir';
  end if;

  perform set_config('app.catalogo_solicitud_autorizada',p_solicitud_id::text,true);

  update public.solicitudes_venta
  set forma_pago = v_plan->>'titulo',
      monto_total = v_total,
      anticipo = v_anticipo,
      cantidad_cuotas = v_cantidad,
      valor_cuota = v_valor,
      frecuencia = v_frecuencia,
      primer_vencimiento = v_primer_vencimiento,
      actualizado_en = now()
  where id = p_solicitud_id;

  v_resultado := public.aprobar_solicitud_venta(p_solicitud_id);

  update public.solicitudes_venta
  set estado_comercial = 'convertida_en_venta',
      convertido_en = now(),
      actualizado_comercial_por = auth.uid(),
      actualizado_en = now()
  where id = p_solicitud_id
  returning * into v_solicitud;

  perform set_config('app.catalogo_solicitud_autorizada','',true);

  insert into public.solicitudes_compra_historial (
    solicitud_id,tipo,estado_anterior,estado_nuevo,detalle,actor_tipo,realizado_por
  ) values (
    p_solicitud_id,'convertida_en_venta','aprobada','convertida_en_venta',
    jsonb_build_object(
      'venta_id',v_solicitud.venta_id,
      'cuenta_credito_id',v_solicitud.cuenta_credito_id,
      'vendedor_id',v_solicitud.vendedor_id
    ),'admin',auth.uid()
  );

  return jsonb_build_object(
    'ok',true,'duplicado',false,'solicitud_id',v_solicitud.id,
    'venta_id',v_solicitud.venta_id,'cuenta_credito_id',v_solicitud.cuenta_credito_id,
    'resultado',v_resultado
  );
end;
$$;

CREATE OR REPLACE FUNCTION public.guardar_solicitud_venta(p_datos jsonb, p_clave_idempotencia uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_usuario_id uuid := auth.uid();
  v_vendedor_id uuid;
  v_solicitud_id uuid;
  v_id_existente uuid;
  v_clave uuid;
  v_unidad text;
  v_producto_id uuid;
  v_producto public.productos%rowtype;
  v_interes_id uuid;
  v_interes public.intereses_clientes%rowtype;
  v_cliente_nombre text;
  v_cliente_dni text;
  v_cliente_telefono text;
  v_cliente_fecha_nacimiento date;
  v_cliente_direccion text;
  v_cliente_ciudad text;
  v_cliente_telefono_referencia text;
  v_forma_pago text;
  v_total numeric;
  v_anticipo numeric;
  v_financiado numeric;
  v_cantidad integer;
  v_valor_cuota numeric;
  v_frecuencia text;
  v_primer_vencimiento date;
  v_notas text;
  v_es_financiada boolean;
  v_resultado jsonb;
  v_precio jsonb;
  v_modalidad text;
begin
  if v_usuario_id is null then
    raise exception 'No autorizado';
  end if;

  select v.id
    into v_vendedor_id
  from public.vendedores v
  where v.user_id = v_usuario_id
    and v.activo = true
  limit 1;

  if v_vendedor_id is null then
    raise exception 'Vendedor no habilitado';
  end if;

  if p_datos is null or jsonb_typeof(p_datos) <> 'object' then
    raise exception 'Los datos de la solicitud son inválidos';
  end if;

  begin
    v_solicitud_id := nullif(p_datos->>'solicitud_id', '')::uuid;
    v_producto_id := nullif(p_datos->>'producto_id', '')::uuid;
    v_interes_id := nullif(p_datos->>'interes_cliente_id', '')::uuid;
    v_cliente_fecha_nacimiento := nullif(p_datos->>'cliente_fecha_nacimiento', '')::date;
    v_total := nullif(p_datos->>'monto_total', '')::numeric;
    v_anticipo := coalesce(nullif(p_datos->>'anticipo', '')::numeric, 0);
    v_cantidad := coalesce(nullif(p_datos->>'cantidad_cuotas', '')::integer, 0);
    v_valor_cuota := coalesce(nullif(p_datos->>'valor_cuota', '')::numeric, 0);
    v_primer_vencimiento := nullif(p_datos->>'primer_vencimiento', '')::date;
    v_clave := coalesce(
      p_clave_idempotencia,
      nullif(p_datos->>'clave_idempotencia', '')::uuid,
      gen_random_uuid()
    );
  exception when others then
    raise exception 'Hay valores o identificadores con formato inválido';
  end;

  if v_solicitud_id is null then
    select s.id
      into v_id_existente
    from public.solicitudes_venta s
    where s.clave_idempotencia = v_clave;

    if v_id_existente is not null then
      if not exists (
        select 1 from public.solicitudes_venta s
        where s.id = v_id_existente and s.vendedor_id = v_vendedor_id
      ) then
        raise exception 'Clave de envío inválida';
      end if;

      select to_jsonb(s) into v_resultado
      from public.solicitudes_venta s where s.id = v_id_existente;
      return v_resultado;
    end if;
  end if;

  v_unidad := lower(btrim(coalesce(p_datos->>'unidad', '')));
  v_cliente_nombre := btrim(coalesce(p_datos->>'cliente_nombre', ''));
  v_cliente_dni := regexp_replace(coalesce(p_datos->>'cliente_dni', ''), '[^0-9]', '', 'g');
  v_cliente_telefono := nullif(btrim(coalesce(p_datos->>'cliente_telefono', '')), '');
  v_cliente_direccion := nullif(btrim(coalesce(p_datos->>'cliente_direccion', '')), '');
  v_cliente_ciudad := nullif(btrim(coalesce(p_datos->>'cliente_ciudad', '')), '');
  v_cliente_telefono_referencia := nullif(btrim(coalesce(p_datos->>'cliente_telefono_referencia', '')), '');
  v_forma_pago := btrim(coalesce(p_datos->>'forma_pago', ''));
  v_frecuencia := lower(btrim(coalesce(p_datos->>'frecuencia', 'unico')));
  v_notas := nullif(btrim(coalesce(p_datos->>'notas', '')), '');

  if v_unidad not in ('hogar', 'celulares') then
    raise exception 'En esta etapa solo se aceptan solicitudes de Hogar y Celulares';
  end if;
  if v_producto_id is null then
    raise exception 'Elegí un producto activo del catálogo';
  end if;
  if char_length(v_cliente_nombre) not between 2 and 120 then
    raise exception 'Ingresá el nombre completo del cliente';
  end if;
  if char_length(v_cliente_dni) not between 6 and 9 then
    raise exception 'Ingresá un DNI válido de 6 a 9 dígitos';
  end if;
  if v_cliente_telefono is not null and char_length(v_cliente_telefono) > 40 then
    raise exception 'El teléfono del cliente es demasiado largo';
  end if;
  if v_cliente_direccion is not null and char_length(v_cliente_direccion) > 240 then
    raise exception 'La dirección es demasiado larga';
  end if;
  if v_cliente_ciudad is not null and char_length(v_cliente_ciudad) > 120 then
    raise exception 'La ciudad es demasiado larga';
  end if;
  if v_cliente_telefono_referencia is not null and char_length(v_cliente_telefono_referencia) > 40 then
    raise exception 'El teléfono de referencia es demasiado largo';
  end if;
  if char_length(v_forma_pago) not between 2 and 180 then
    raise exception 'Elegí una modalidad de pago';
  end if;
  if v_notas is not null and char_length(v_notas) > 4000 then
    raise exception 'Las notas superan el máximo permitido';
  end if;
  if v_total is null or v_total <= 0
     or v_total::text ~ '^(NaN|[-+]?Infinity)$' then
    raise exception 'El monto total debe ser mayor a cero';
  end if;
  if v_anticipo < 0 or v_anticipo > v_total
     or v_anticipo::text ~ '^(NaN|[-+]?Infinity)$' then
    raise exception 'El anticipo es inválido';
  end if;
  if v_valor_cuota < 0
     or v_valor_cuota::text ~ '^(NaN|[-+]?Infinity)$' then
    raise exception 'El valor de cuota es inválido';
  end if;

  select p.*
    into v_producto
  from public.productos p
  where p.id = v_producto_id
    and p.activo = true;

  if not found then
    raise exception 'El producto ya no está disponible';
  end if;
  if v_producto.categoria <> v_unidad then
    raise exception 'La unidad no coincide con el producto elegido';
  end if;

  if v_solicitud_id is not null then raise exception 'La condición comercial guardada no se sobrescribe; Administración debe revisarla'; end if;
  v_modalidad:=case when lower(v_forma_pago) like '%contado%' then 'Contado'
    when lower(v_forma_pago) like '%crédito personal%' then 'Crédito personal'
    when v_forma_pago like 'Tarjeta Sol%' then 'Tarjeta Sol'
    when v_forma_pago like 'Anticipo%' and v_frecuencia='semanal' then 'Anticipo + cuotas semanales'
    when v_forma_pago like 'Anticipo%' then 'Anticipo + cuotas mensuales' else null end;
  v_precio:=public.calcular_presupuesto_rest(v_producto_id,v_modalidad,v_cantidad,v_anticipo);
  if v_total<>(v_precio->>'total')::numeric or v_cantidad<>(v_precio->>'count')::integer
   or v_valor_cuota<>(v_precio->>'value')::numeric or v_frecuencia<>v_precio->>'frequency'
   or (v_modalidad<>'Contado' and v_anticipo<>(v_precio->>'down')::numeric)
  then raise exception 'La cotización cambió o los importes no son válidos. Volvé a cotizar'; end if;
  if v_precio->>'primera_cuota'='al_inicio' then v_primer_vencimiento:=(now() at time zone 'America/Argentina/Cordoba')::date; end if;
  v_producto.precio_contado:=(private.calcular_cotizacion_producto(v_producto_id)->>'contado')::numeric;
  if v_interes_id is not null then
    select i.*
      into v_interes
    from public.intereses_clientes i
    where i.id = v_interes_id;

    if not found then
      raise exception 'La oportunidad vinculada no existe';
    end if;
    if v_interes.vendedor_id is distinct from v_vendedor_id then
      raise exception 'La oportunidad vinculada no pertenece al vendedor';
    end if;
    if v_interes.estado not in ('asignado', 'en_gestion') or v_interes.venta_id is not null then
      raise exception 'La oportunidad vinculada ya está cerrada';
    end if;
    if v_interes.producto_id is not null and v_interes.producto_id <> v_producto_id then
      raise exception 'La oportunidad corresponde a otro producto';
    end if;
    if v_interes.categoria is not null and v_interes.categoria <> v_unidad then
      raise exception 'La oportunidad corresponde a otra unidad';
    end if;
  end if;

  v_es_financiada := public.es_venta_financiada(v_forma_pago);

  if not v_es_financiada then
    if lower(v_forma_pago) like '%contado%' then
      v_anticipo := v_total;
    end if;
    v_cantidad := 0;
    v_valor_cuota := 0;
    v_frecuencia := 'unico';
    v_primer_vencimiento := null;
  else
    v_financiado := v_total - v_anticipo;
    if v_financiado <= 0 then
      raise exception 'El saldo financiado debe ser mayor a cero';
    end if;
    if v_cantidad not between 1 and 120 then
      raise exception 'La cantidad de cuotas debe estar entre 1 y 120';
    end if;
    if v_valor_cuota <= 0 then
      raise exception 'El valor de cuota debe ser mayor a cero';
    end if;
    if v_frecuencia not in ('semanal', 'quincenal', 'mensual') then
      raise exception 'Elegí una periodicidad válida';
    end if;
    if v_primer_vencimiento is null then
      raise exception 'Ingresá el primer vencimiento';
    end if;
    if v_primer_vencimiento < current_date then
      raise exception 'El primer vencimiento no puede estar en el pasado';
    end if;
    if abs(v_financiado - (v_cantidad * v_valor_cuota)) > (v_cantidad * 0.01) then
      raise exception 'La suma de cuotas no coincide con el saldo financiado';
    end if;
    if v_financiado - ((v_cantidad - 1) * v_valor_cuota) <= 0 then
      raise exception 'La última cuota debe ser mayor a cero';
    end if;
  end if;

  if v_solicitud_id is not null then
    perform 1
    from public.solicitudes_venta s
    where s.id = v_solicitud_id
      and s.vendedor_id = v_vendedor_id
      and s.estado in ('pendiente', 'correccion_solicitada')
    for update;

    if not found then
      raise exception 'La solicitud ya no puede editarse';
    end if;

    update public.solicitudes_venta
    set interes_cliente_id = v_interes_id,
        producto_id = v_producto.id,
        unidad = v_unidad,
        producto_nombre = v_producto.nombre,
        producto_precio_contado = v_producto.precio_contado,
        cliente_nombre = v_cliente_nombre,
        cliente_dni = v_cliente_dni,
        cliente_telefono = v_cliente_telefono,
        cliente_fecha_nacimiento = v_cliente_fecha_nacimiento,
        cliente_direccion = v_cliente_direccion,
        cliente_ciudad = v_cliente_ciudad,
        cliente_telefono_referencia = v_cliente_telefono_referencia,
        forma_pago = v_forma_pago,
        monto_total = v_total,
        anticipo = v_anticipo,
        cantidad_cuotas = v_cantidad,
        valor_cuota = v_valor_cuota,
        frecuencia = v_frecuencia,
        primer_vencimiento = v_primer_vencimiento,
        notas = v_notas,
        estado = 'pendiente',
        motivo_revision = null,
        revisada_por = null,
        revisada_en = null,
        version = version + 1,
        actualizado_en = now()
    where id = v_solicitud_id;

    insert into public.credito_auditoria (accion, entidad, entidad_id, usuario_id, detalle)
    values (
      'solicitud_reenviada',
      'solicitud_venta',
      v_solicitud_id,
      v_usuario_id,
      jsonb_build_object('vendedor_id', v_vendedor_id, 'unidad', v_unidad)
    );
  else
    insert into public.solicitudes_venta (
      clave_idempotencia, vendedor_id, interes_cliente_id, producto_id, unidad,
      producto_nombre, producto_precio_contado, cliente_nombre, cliente_dni,
      cliente_telefono, cliente_fecha_nacimiento, cliente_direccion, cliente_ciudad,
      cliente_telefono_referencia, forma_pago, monto_total, anticipo,
      cantidad_cuotas, valor_cuota, frecuencia, primer_vencimiento, notas, snapshot_solicitado
    ) values (
      v_clave, v_vendedor_id, v_interes_id, v_producto.id, v_unidad,
      v_producto.nombre, v_producto.precio_contado, v_cliente_nombre, v_cliente_dni,
      v_cliente_telefono, v_cliente_fecha_nacimiento, v_cliente_direccion, v_cliente_ciudad,
      v_cliente_telefono_referencia, v_forma_pago, v_total, v_anticipo,
      v_cantidad, v_valor_cuota, v_frecuencia, v_primer_vencimiento, v_notas,
      jsonb_build_object('motor_version',2,'producto',jsonb_build_object('id',v_producto.id,'nombre',v_producto.nombre,'precio_contado',v_producto.precio_contado),'seleccion',
        jsonb_build_object('codigo',case when v_cantidad=0 then 'contado' else 'credito_'||v_cantidad end,'titulo',v_forma_pago,'total',v_total,'anticipo',v_anticipo,'cantidad_cuotas',v_cantidad,'valor_cuota',v_valor_cuota,'frecuencia',v_frecuencia,'primera_cuota',v_precio->'primera_cuota','ultima_cuota',v_precio->'ultima_cuota','primer_vencimiento',v_primer_vencimiento))
    )
    on conflict (clave_idempotencia) do nothing
    returning id into v_solicitud_id;

    if v_solicitud_id is null then
      select s.id
        into v_solicitud_id
      from public.solicitudes_venta s
      where s.clave_idempotencia = v_clave;

      if not exists (
        select 1 from public.solicitudes_venta s
        where s.id = v_solicitud_id and s.vendedor_id = v_vendedor_id
      ) then
        raise exception 'Clave de envío inválida';
      end if;
    else
      insert into public.credito_auditoria (accion, entidad, entidad_id, usuario_id, detalle)
      values (
        'solicitud_creada',
        'solicitud_venta',
        v_solicitud_id,
        v_usuario_id,
        jsonb_build_object('vendedor_id', v_vendedor_id, 'unidad', v_unidad)
      );
    end if;
  end if;

  select to_jsonb(s) into v_resultado
  from public.solicitudes_venta s where s.id = v_solicitud_id;
  return v_resultado;
end;
$function$
;

create function private.capturar_motor_precios() returns trigger language plpgsql security definer set search_path='' as $$
declare detalle jsonb; tipo text;
begin
 if tg_table_name='presupuestos' then
  detalle:=private.base_comercial_producto(new.producto_id)||jsonb_build_object('seleccion',new.condiciones_snapshot);
  tipo:='presupuesto';
 elsif tg_op='INSERT' then
  if new.unidad not in ('hogar','celulares') then return new; end if;
  detalle:=private.base_comercial_producto(new.producto_id)||jsonb_build_object('seleccion',new.snapshot_solicitado->'seleccion');tipo:='solicitud';
 elsif new.snapshot_final is distinct from old.snapshot_final and new.snapshot_final is not null then
  detalle:=private.base_comercial_producto(new.producto_id)||jsonb_build_object('seleccion',new.snapshot_final->'seleccion');tipo:='condiciones_finales';
 elsif new.venta_id is not null and old.venta_id is null then
  select a.detalle into detalle from private.motor_precios_auditoria a where a.entidad_id=new.id and a.tipo in ('solicitud','condiciones_finales') order by id desc limit 1;
  if detalle is not null then
   insert into private.motor_precios_auditoria(tipo,entidad_id,detalle) values('venta',new.venta_id,detalle||jsonb_build_object('solicitud_id',new.id,'primer_vencimiento_operativo',new.primer_vencimiento));
  end if;return new;
 else return new;
 end if;
 insert into private.motor_precios_auditoria(tipo,entidad_id,detalle) values(tipo,new.id,detalle);
 return new;
end $$;
create trigger motor_snapshot_presupuesto after insert on public.presupuestos for each row execute function private.capturar_motor_precios();
create trigger motor_snapshot_solicitud after insert or update on public.solicitudes_venta for each row execute function private.capturar_motor_precios();

create function public.listar_productos_comerciales() returns jsonb language plpgsql security definer set search_path='' as $$
begin
 if auth.uid() is null or (not public.es_admin() and public.mi_vendedor_id() is null) then raise exception 'No autorizado'; end if;
 return (select coalesce(jsonb_agg(to_jsonb(p)||jsonb_build_object('precio_contado',case when p.categoria in ('hogar','celulares') then (private.calcular_cotizacion_producto(p.id)->>'contado')::numeric else p.precio_contado end) order by p.orden,p.nombre),'[]'::jsonb)
 from public.productos p where p.activo and (p.categoria not in ('hogar','celulares') or private.precio_motor_disponible(p.id)));
end $$;
create function public.inspeccionar_precio_rest(p_producto uuid) returns jsonb language plpgsql security definer set search_path='' as $$
begin
 if auth.uid() is null or not public.es_admin() then raise exception 'Solo Administración'; end if;
 return private.base_comercial_producto(p_producto);
end $$;
-- El canal público continúa usando su RPC; vendedor envía solicitud y ADMIN aprueba.
-- Evita insertar ventas arbitrarias directamente mediante PostgREST.
create policy motor_ventas_insert_admin on public.ventas as restrictive for insert to authenticated with check(public.es_admin());
create policy motor_solicitudes_insert_rpc on public.solicitudes_venta as restrictive for insert to authenticated with check(public.es_admin());
create policy motor_solicitudes_update_admin on public.solicitudes_venta as restrictive for update to authenticated using(public.es_admin()) with check(public.es_admin());

revoke all on function private.base_comercial_producto(uuid),private.precio_motor_disponible(uuid),private.proteger_precio_derivado(),private.sincronizar_precio_costo(),private.capturar_motor_precios(),private.motor_precios_inmutable() from public,anon,authenticated;
revoke all on function public.obtener_dolar_rest(),public.actualizar_dolar_rest(numeric),public.guardar_costo_producto_rest(uuid,numeric),public.listar_productos_comerciales(),public.inspeccionar_precio_rest(uuid) from public,anon;
grant execute on function public.obtener_dolar_rest(),public.actualizar_dolar_rest(numeric),public.guardar_costo_producto_rest(uuid,numeric),public.listar_productos_comerciales(),public.inspeccionar_precio_rest(uuid) to authenticated;
