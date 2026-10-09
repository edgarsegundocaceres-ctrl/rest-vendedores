-- APP INTEGRAL REST · Catálogo público personalizado y solicitudes de compra
-- Migración aditiva para Hogar y Celulares. No corresponde a APP INTEGRAL REST MOTOS.

begin;

create schema if not exists private;
revoke all on schema private from public, anon, authenticated;

-- Campos comerciales en la fuente existente, sin otro catálogo.
alter table public.productos
  add column if not exists descripcion_publica text check (char_length(descripcion_publica) <= 1500),
  add column if not exists catalogo_publico boolean not null default true;

-- REST directo conserva NULL durante todo el circuito futuro.
alter table public.ventas alter column vendedor_id drop not null;
alter table public.cuentas_credito alter column vendedor_id drop not null;
drop trigger if exists trg_al_entregar_venta on public.ventas;
create trigger trg_al_entregar_venta before update of estado on public.ventas
for each row when (new.vendedor_id is not null) execute function public.al_entregar_venta();
drop trigger if exists trg_recalcular_mes_venta on public.ventas;
create trigger trg_recalcular_mes_venta after insert or update of estado, fecha_entrega, monto_total on public.ventas
for each row when (new.vendedor_id is not null) execute function public.al_cambiar_estado_venta();

alter table public.vendedores
  add column if not exists catalogo_token uuid;

update public.vendedores
set catalogo_token = gen_random_uuid()
where catalogo_token is null;

alter table public.vendedores
  alter column catalogo_token set default gen_random_uuid(),
  alter column catalogo_token set not null;

create unique index if not exists vendedores_catalogo_token_uq
  on public.vendedores (catalogo_token);

alter table public.solicitudes_venta
  alter column vendedor_id drop not null,
  add column if not exists codigo text,
  add column if not exists canal_origen text not null default 'portal_vendedor',
  add column if not exists estado_comercial text not null default 'nueva',
  add column if not exists snapshot_solicitado jsonb not null default '{}'::jsonb,
  add column if not exists snapshot_final jsonb,
  add column if not exists contactado_en timestamptz,
  add column if not exists aprobado_comercial_en timestamptz,
  add column if not exists rechazado_comercial_en timestamptz,
  add column if not exists convertido_en timestamptz,
  add column if not exists actualizado_comercial_por uuid references public.perfiles(id) on delete restrict;

update public.solicitudes_venta
set codigo = 'SC-' || to_char(creado_en, 'YYYYMMDD') || '-' || upper(substr(replace(id::text, '-', ''), 1, 10))
where codigo is null;

alter table public.solicitudes_venta
  alter column codigo set default (
    'SC-' || to_char(now(), 'YYYYMMDD') || '-' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 10))
  ),
  alter column codigo set not null;

alter table public.solicitudes_venta
  drop constraint if exists solicitudes_venta_canal_origen_check,
  add constraint solicitudes_venta_canal_origen_check check (
    canal_origen in ('portal_vendedor','catalogo_publico_vendedor','catalogo_publico_directo')
  ),
  drop constraint if exists solicitudes_venta_estado_comercial_check,
  add constraint solicitudes_venta_estado_comercial_check check (
    estado_comercial in ('nueva','en_revision','contactado','aprobada','rechazada','convertida_en_venta')
  ),
  drop constraint if exists solicitudes_venta_snapshot_solicitado_check,
  add constraint solicitudes_venta_snapshot_solicitado_check check (
    jsonb_typeof(snapshot_solicitado) = 'object'
  ),
  drop constraint if exists solicitudes_venta_snapshot_final_check,
  add constraint solicitudes_venta_snapshot_final_check check (
    snapshot_final is null or jsonb_typeof(snapshot_final) = 'object'
  );

create unique index if not exists solicitudes_venta_codigo_uq
  on public.solicitudes_venta (codigo);
create index if not exists solicitudes_venta_estado_comercial_fecha_idx
  on public.solicitudes_venta (estado_comercial, creado_en desc);
create index if not exists solicitudes_venta_vendedor_origen_fecha_idx
  on public.solicitudes_venta (vendedor_id, creado_en desc);

create table if not exists public.solicitudes_compra_historial (
  id bigint generated always as identity primary key,
  solicitud_id uuid not null references public.solicitudes_venta(id) on delete restrict,
  tipo text not null check (tipo in (
    'creada','estado_actualizado','condiciones_finales','convertida_en_venta'
  )),
  estado_anterior text,
  estado_nuevo text,
  detalle jsonb not null default '{}'::jsonb check (jsonb_typeof(detalle) = 'object'),
  actor_tipo text not null default 'sistema' check (actor_tipo in ('publico','admin','sistema')),
  realizado_por uuid references public.perfiles(id) on delete restrict,
  creado_en timestamptz not null default now()
);

create index if not exists solicitudes_compra_historial_solicitud_fecha_idx
  on public.solicitudes_compra_historial (solicitud_id, creado_en desc);

create table if not exists public.solicitudes_compra_notas (
  id uuid primary key default gen_random_uuid(),
  solicitud_id uuid not null references public.solicitudes_venta(id) on delete restrict,
  nota text not null check (char_length(btrim(nota)) between 1 and 2000),
  creado_por uuid not null references public.perfiles(id) on delete restrict,
  creado_en timestamptz not null default now()
);

create index if not exists solicitudes_compra_notas_solicitud_fecha_idx
  on public.solicitudes_compra_notas (solicitud_id, creado_en desc);

create table if not exists private.catalogo_solicitudes_rate_limit (
  id bigint generated always as identity primary key,
  fingerprint text not null,
  creado_en timestamptz not null default now()
);
alter table private.catalogo_solicitudes_rate_limit enable row level security;

create index if not exists catalogo_solicitudes_rate_limit_busqueda_idx
  on private.catalogo_solicitudes_rate_limit (fingerprint, creado_en desc);

create or replace function private.solicitudes_compra_historial_inmutable()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'El historial de solicitudes de compra es inmutable';
end;
$$;

drop trigger if exists solicitudes_compra_historial_no_update
  on public.solicitudes_compra_historial;
create trigger solicitudes_compra_historial_no_update
before update or delete on public.solicitudes_compra_historial
for each row execute function private.solicitudes_compra_historial_inmutable();

create or replace function private.proteger_origen_solicitud_catalogo()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_cambio_autorizado boolean := (
    coalesce(current_setting('app.catalogo_solicitud_autorizada', true),'') = old.id::text
    and auth.uid() is not null
    and public.es_admin()
  );
begin
  if old.canal_origen not in ('catalogo_publico_vendedor','catalogo_publico_directo') then
    return new;
  end if;

  if new.canal_origen is distinct from old.canal_origen
     or new.clave_idempotencia is distinct from old.clave_idempotencia
     or new.snapshot_solicitado is distinct from old.snapshot_solicitado then
    raise exception 'El origen y el snapshot solicitado son inmutables';
  end if;

  if old.canal_origen = 'catalogo_publico_vendedor'
     and new.vendedor_id is distinct from old.vendedor_id then
    raise exception 'El vendedor de origen es inmutable';
  end if;

  if not v_cambio_autorizado and (
    new.interes_cliente_id is distinct from old.interes_cliente_id
    or new.producto_id is distinct from old.producto_id
    or new.unidad is distinct from old.unidad
    or new.producto_nombre is distinct from old.producto_nombre
    or new.producto_precio_contado is distinct from old.producto_precio_contado
    or new.cliente_nombre is distinct from old.cliente_nombre
    or new.cliente_dni is distinct from old.cliente_dni
    or new.cliente_telefono is distinct from old.cliente_telefono
    or new.cliente_fecha_nacimiento is distinct from old.cliente_fecha_nacimiento
    or new.cliente_direccion is distinct from old.cliente_direccion
    or new.cliente_ciudad is distinct from old.cliente_ciudad
    or new.cliente_telefono_referencia is distinct from old.cliente_telefono_referencia
    or new.forma_pago is distinct from old.forma_pago
    or new.monto_total is distinct from old.monto_total
    or new.anticipo is distinct from old.anticipo
    or new.cantidad_cuotas is distinct from old.cantidad_cuotas
    or new.valor_cuota is distinct from old.valor_cuota
    or new.frecuencia is distinct from old.frecuencia
    or new.primer_vencimiento is distinct from old.primer_vencimiento
    or new.notas is distinct from old.notas
    or new.estado is distinct from old.estado
    or new.estado_comercial is distinct from old.estado_comercial
    or new.snapshot_final is distinct from old.snapshot_final
    or new.venta_id is distinct from old.venta_id
    or new.cuenta_credito_id is distinct from old.cuenta_credito_id
    or new.vendedor_id is distinct from old.vendedor_id
    or new.convertido_en is distinct from old.convertido_en
  ) then
    raise exception 'Usá el circuito administrativo de solicitudes de compra';
  end if;

  return new;
end;
$$;

drop trigger if exists solicitudes_venta_protege_origen_catalogo
  on public.solicitudes_venta;
create trigger solicitudes_venta_protege_origen_catalogo
before update on public.solicitudes_venta
for each row execute function private.proteger_origen_solicitud_catalogo();

create or replace function private.calcular_cotizacion_producto(p_producto_id uuid)
returns jsonb
language plpgsql
stable
set search_path = ''
as $$
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

  if v_producto.categoria = 'hogar' then
    v_resultado := jsonb_build_object(
      'contado', v_producto.precio_contado,
      'credito_personal', jsonb_build_array(
        jsonb_build_object('cuotas',6,'cuota',round((v_producto.precio_contado*(1+0.095*6))/6,2),'total',round(v_producto.precio_contado*(1+0.095*6),2)),
        jsonb_build_object('cuotas',9,'cuota',round((v_producto.precio_contado*(1+0.11*9))/9,2),'total',round(v_producto.precio_contado*(1+0.11*9),2))
      ),
      'mensual', jsonb_build_object('anticipo_min',round(v_producto.precio_contado*0.40,2),'tasa',0.075,'cuotas',jsonb_build_array(6,9,12)),
      'semanal', jsonb_build_object('anticipo_min',round(v_producto.precio_contado*0.35,2),'tasa',0.0105,'cuotas',jsonb_build_array(12,16,20))
    );
  elsif v_producto.categoria = 'celulares' then
    v_resultado := jsonb_build_object(
      'contado', v_producto.precio_contado,
      'credito_personal', jsonb_build_array(
        jsonb_build_object('cuotas',6,'cuota',round((v_producto.precio_contado*(1+0.095*6))/6,2),'total',round(v_producto.precio_contado*(1+0.095*6),2)),
        jsonb_build_object('cuotas',9,'cuota',round((v_producto.precio_contado*(1+0.11*9))/9,2),'total',round(v_producto.precio_contado*(1+0.11*9),2))
      ),
      'mensual', jsonb_build_object('anticipo_min',round(v_producto.precio_contado*0.40,2),'tasa',0.075,'cuotas',jsonb_build_array(6,9,12)),
      'semanal', jsonb_build_object('anticipo_min',round(v_producto.precio_contado*0.35,2),'tasa',0.0105,'cuotas',jsonb_build_array(12,16,20))
    );
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
$$;

create or replace function public.cotizar_producto(p_producto_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null then raise exception 'No autorizado'; end if;
  return private.calcular_cotizacion_producto(p_producto_id);
end;
$$;

create or replace function private.opciones_catalogo_producto(p_producto_id uuid)
returns jsonb
language plpgsql
stable
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
    and p.precio_contado > 0;
  if not found then raise exception 'Producto REST no disponible'; end if;

  v_cotizacion := private.calcular_cotizacion_producto(p_producto_id);
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
      'regla',jsonb_build_object('fuente','cotizar_producto','tipo','interes_simple_mensual',
        'tasa_mensual',round(((v_seis->>'total')::numeric/v_producto.precio_contado-1)/6,6))
    ) end,
    'credito_9', case when v_nueve is not null then jsonb_build_object(
      'codigo','credito_9','titulo','Crédito personal · 9 cuotas',
      'total',(v_nueve->>'total')::numeric,'anticipo',0,'cantidad_cuotas',9,
      'valor_cuota',(v_nueve->>'cuota')::numeric,'frecuencia','mensual',
      'regla',jsonb_build_object('fuente','cotizar_producto','tipo','interes_simple_mensual',
        'tasa_mensual',round(((v_nueve->>'total')::numeric/v_producto.precio_contado-1)/9,6))
    ) end
  ));
end;
$$;

create or replace function private.proyectar_producto_catalogo(p_producto_id uuid)
returns jsonb language sql stable set search_path = '' as $$
  select datos || jsonb_build_object('version_cotizacion',md5(datos::text))
  from (
    select jsonb_build_object('id',p.id,'nombre',p.nombre,'categoria',p.categoria,
      'subcategoria',p.subcategoria,'descripcion_publica',p.descripcion_publica,
      'imagen_url',p.imagen_url,'precio_contado',p.precio_contado,
      'opciones',private.opciones_catalogo_producto(p.id)) datos
    from public.productos p where p.id=p_producto_id and p.activo and p.catalogo_publico
      and p.categoria in ('hogar','celulares') and p.precio_contado>0
  ) producto;
$$;

create or replace function private.controlar_limite_solicitud_catalogo()
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_headers jsonb := '{}'::jsonb;
  v_ip text;
  v_agente text;
  v_fingerprint text;
  v_intentos integer;
begin
  begin
    v_headers := coalesce(nullif(current_setting('request.headers', true), '')::jsonb, '{}'::jsonb);
  exception when others then
    v_headers := '{}'::jsonb;
  end;

  v_ip := nullif(btrim(split_part(coalesce(v_headers->>'x-forwarded-for',''), ',', 1)), '');
  v_agente := nullif(left(coalesce(v_headers->>'user-agent',''), 300), '');
  v_fingerprint := md5(coalesce(v_ip,'sin-ip') || '|' || coalesce(v_agente,'sin-agente'));

  perform pg_advisory_xact_lock(hashtextextended('rest-catalogo-limite:' || v_fingerprint,0));

  select count(*)::integer into v_intentos
  from private.catalogo_solicitudes_rate_limit r
  where r.fingerprint = v_fingerprint
    and r.creado_en >= now() - interval '10 minutes';

  if v_intentos >= 5 then
    raise exception 'Demasiados intentos. Esperá unos minutos antes de volver a enviar.';
  end if;

  insert into private.catalogo_solicitudes_rate_limit (fingerprint)
  values (v_fingerprint);

  delete from private.catalogo_solicitudes_rate_limit
  where creado_en < now() - interval '24 hours';
end;
$$;

create or replace function public.obtener_catalogo_publico(p_token text)
returns jsonb
language plpgsql
stable
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
    and p.precio_contado > 0;

  return jsonb_build_object(
    'disponible',true,
    'vendedor',jsonb_build_object('nombre',v_vendedor.nombre),
    'productos',v_productos
  );
end;
$$;

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
    and p.precio_contado > 0
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
  v_primer_vencimiento := case when v_cantidad > 0 then current_date + 30 else null end;

  v_plan := v_plan || jsonb_build_object('primer_vencimiento',v_primer_vencimiento);
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
    and s.canal_origen in ('catalogo_publico_vendedor','catalogo_publico_directo')
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
    and s.canal_origen in ('catalogo_publico_vendedor','catalogo_publico_directo')
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
    'primer_vencimiento',case when (v_plan->>'cantidad_cuotas')::integer > 0 then coalesce(p_primer_vencimiento,current_date + 30) else null end
  );

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
    and s.canal_origen in ('catalogo_publico_vendedor','catalogo_publico_directo')
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

alter table public.solicitudes_compra_historial enable row level security;
alter table public.solicitudes_compra_notas enable row level security;

drop policy if exists solicitudes_compra_historial_admin_select on public.solicitudes_compra_historial;
create policy solicitudes_compra_historial_admin_select
on public.solicitudes_compra_historial for select to authenticated
using ((select public.es_admin()));

drop policy if exists solicitudes_compra_notas_admin_select on public.solicitudes_compra_notas;
create policy solicitudes_compra_notas_admin_select
on public.solicitudes_compra_notas for select to authenticated
using ((select public.es_admin()));

revoke all on table public.solicitudes_compra_historial from anon, authenticated;
revoke all on table public.solicitudes_compra_notas from anon, authenticated;
revoke all on table public.solicitudes_venta from anon;
revoke all on table private.catalogo_solicitudes_rate_limit from public, anon, authenticated;
grant select on table public.solicitudes_compra_historial to authenticated;
grant select on table public.solicitudes_compra_notas to authenticated;
grant all on table public.solicitudes_compra_historial to service_role;
grant all on table public.solicitudes_compra_notas to service_role;
grant usage, select on sequence public.solicitudes_compra_historial_id_seq to service_role;

revoke all on function private.solicitudes_compra_historial_inmutable() from public, anon, authenticated;
revoke all on function private.proteger_origen_solicitud_catalogo() from public, anon, authenticated;
revoke all on function private.calcular_cotizacion_producto(uuid) from public, anon, authenticated;
revoke all on function private.opciones_catalogo_producto(uuid) from public, anon, authenticated;
revoke all on function private.proyectar_producto_catalogo(uuid) from public, anon, authenticated;
revoke all on function private.controlar_limite_solicitud_catalogo() from public, anon, authenticated;

revoke all on function public.cotizar_producto(uuid) from public, anon, authenticated;
grant execute on function public.cotizar_producto(uuid) to authenticated, service_role;

revoke all on function public.obtener_catalogo_publico(text) from public, anon, authenticated;
revoke all on function public.crear_solicitud_compra_publica(text,uuid,text,jsonb,uuid,text,text) from public, anon, authenticated;
revoke all on function public.actualizar_estado_solicitud_compra(uuid,text,text) from public, anon, authenticated;
revoke all on function public.guardar_condiciones_finales_solicitud(uuid,text,date) from public, anon, authenticated;
revoke all on function public.agregar_nota_solicitud_compra(uuid,text) from public, anon, authenticated;
revoke all on function public.convertir_solicitud_compra(uuid) from public, anon, authenticated;

grant execute on function public.obtener_catalogo_publico(text) to anon, authenticated;
grant execute on function public.crear_solicitud_compra_publica(text,uuid,text,jsonb,uuid,text,text) to anon, authenticated;
grant execute on function public.actualizar_estado_solicitud_compra(uuid,text,text) to authenticated;
grant execute on function public.guardar_condiciones_finales_solicitud(uuid,text,date) to authenticated;
grant execute on function public.agregar_nota_solicitud_compra(uuid,text) to authenticated;
grant execute on function public.convertir_solicitud_compra(uuid) to authenticated;
grant execute on function public.obtener_catalogo_publico(text) to service_role;
grant execute on function public.crear_solicitud_compra_publica(text,uuid,text,jsonb,uuid,text,text) to service_role;
grant execute on function public.actualizar_estado_solicitud_compra(uuid,text,text) to service_role;
grant execute on function public.guardar_condiciones_finales_solicitud(uuid,text,date) to service_role;
grant execute on function public.agregar_nota_solicitud_compra(uuid,text) to service_role;
grant execute on function public.convertir_solicitud_compra(uuid) to service_role;

comment on column public.vendedores.catalogo_token is
  'Token público no secuencial para atribuir el catálogo sin exponer datos privados ni acceso al portal.';
comment on column public.solicitudes_venta.snapshot_solicitado is
  'Snapshot inmutable de producto, opciones y modalidad vistos por el cliente al enviar la solicitud.';
comment on column public.solicitudes_venta.snapshot_final is
  'Condiciones finales definidas por Administración sin sobrescribir el snapshot solicitado.';
comment on table public.solicitudes_compra_historial is
  'Trazabilidad inmutable del circuito catálogo público → solicitud → venta.';
comment on table public.solicitudes_compra_notas is
  'Notas internas visibles únicamente para Administración.';

notify pgrst, 'reload schema';

commit;
