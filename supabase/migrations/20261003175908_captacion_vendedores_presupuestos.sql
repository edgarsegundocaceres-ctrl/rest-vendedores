-- APP INTEGRAL REST · Captación de vendedores y presupuestos trazables
-- Migración aditiva. No corresponde a REST Motos y no modifica datos operativos existentes.

begin;

create table public.programa_vendedores_config (
  id text primary key default 'principal' check (id = 'principal'),
  activo boolean not null default true,
  titulo text not null check (char_length(btrim(titulo)) between 5 and 140),
  bajada text not null check (char_length(btrim(bajada)) between 10 and 500),
  presentacion text not null check (char_length(btrim(presentacion)) between 10 and 3000),
  como_funciona text not null check (char_length(btrim(como_funciona)) between 10 and 3000),
  herramientas text not null check (char_length(btrim(herramientas)) between 10 and 3000),
  modalidades text not null check (char_length(btrim(modalidades)) between 10 and 3000),
  comisiones text not null check (char_length(btrim(comisiones)) between 10 and 3000),
  pago_comisiones text not null check (char_length(btrim(pago_comisiones)) between 10 and 3000),
  preguntas_frecuentes jsonb not null default '[]'::jsonb
    check (jsonb_typeof(preguntas_frecuentes) = 'array'),
  actualizado_por uuid references public.perfiles(id) on delete restrict,
  creado_en timestamptz not null default now(),
  actualizado_en timestamptz not null default now()
);

insert into public.programa_vendedores_config (
  id, titulo, bajada, presentacion, como_funciona, herramientas,
  modalidades, comisiones, pago_comisiones, preguntas_frecuentes
) values (
  'principal',
  '¿Querés vender para REST y generar nuevos ingresos?',
  'Sumate como vendedor o vendedora freelance y ofrecé productos de Hogar y Celulares con el acompañamiento de REST.',
  'REST acerca productos y alternativas comerciales a sus clientes. Como vendedor freelance podés desarrollar tu propia cartera usando tus contactos, recomendaciones y canales digitales.',
  'Elegís productos del catálogo vigente, preparás una cotización con las condiciones autorizadas y acompañás al cliente. Cuando existe intención de compra, la operación continúa por el circuito de revisión de REST.',
  'Contás con catálogo, calculadora de planes, presupuestos comerciales y herramientas para compartir por WhatsApp y redes sociales.',
  'Las modalidades disponibles se obtienen del catálogo y de las condiciones comerciales vigentes. Los precios y planes no se cargan manualmente.',
  'Las comisiones dependen de la categoría y de las condiciones asignadas por Administración. Una cotización no genera comisión por sí sola.',
  'Una venta genera comisión cuando cumple las condiciones vigentes del sistema. Administración informa el importe, el estado y la modalidad de pago aplicable.',
  '[{"pregunta":"¿La postulación me da acceso inmediato?","respuesta":"No. Administración debe revisar, aprobar y activar la solicitud."},{"pregunta":"¿Dónde puedo ofrecer los productos?","respuesta":"Podés trabajar con WhatsApp, estados, redes sociales, contactos personales, referidos y venta presencial."}]'::jsonb
);

create table public.postulantes_vendedores (
  id uuid primary key default gen_random_uuid(),
  nombre text not null check (char_length(btrim(nombre)) between 2 and 80),
  apellido text not null check (char_length(btrim(apellido)) between 2 and 80),
  dni text not null check (regexp_replace(dni, '[^0-9]', '', 'g') ~ '^[0-9]{6,9}$'),
  dni_normalizado text generated always as (regexp_replace(coalesce(dni, ''), '[^0-9]', '', 'g')) stored,
  fecha_nacimiento date check (fecha_nacimiento is null or fecha_nacimiento <= current_date),
  telefono text not null check (char_length(btrim(telefono)) between 8 and 40),
  telefono_normalizado text generated always as (regexp_replace(coalesce(telefono, ''), '[^0-9]', '', 'g')) stored,
  email text not null check (char_length(btrim(email)) between 5 and 254),
  email_normalizado text generated always as (lower(btrim(email))) stored,
  localidad text not null check (char_length(btrim(localidad)) between 2 and 120),
  provincia text not null check (char_length(btrim(provincia)) between 2 and 120),
  ocupacion_actual text check (ocupacion_actual is null or char_length(ocupacion_actual) <= 180),
  trabaja_actualmente boolean,
  actividad_actual text check (actividad_actual is null or char_length(actividad_actual) <= 500),
  experiencia_ventas boolean,
  descripcion_experiencia text check (descripcion_experiencia is null or char_length(descripcion_experiencia) <= 1500),
  motivacion text not null check (char_length(btrim(motivacion)) between 10 and 2000),
  canales text[] not null check (
    cardinality(canales) between 1 and 10
    and canales <@ array[
      'whatsapp','estados_whatsapp','facebook','facebook_marketplace','instagram',
      'tiktok','contactos_personales','referidos','venta_presencial','otros'
    ]::text[]
  ),
  canales_otros text check (canales_otros is null or char_length(canales_otros) <= 300),
  disponibilidad text not null check (
    disponibilidad in ('horas_semana','1_2_horas_dia','3_4_horas_dia','jornada_completa','otro')
  ),
  disponibilidad_otro text check (disponibilidad_otro is null or char_length(disponibilidad_otro) <= 300),
  estado text not null default 'pendiente' check (
    estado in ('pendiente','contactado','aprobado','rechazado','activo','suspendido')
  ),
  observaciones_internas text check (observaciones_internas is null or char_length(observaciones_internas) <= 4000),
  condiciones_comision text check (condiciones_comision is null or char_length(condiciones_comision) <= 2000),
  vendedor_id uuid unique references public.vendedores(id) on delete restrict,
  contactado_en timestamptz,
  aprobado_en timestamptz,
  rechazado_en timestamptz,
  activado_en timestamptz,
  suspendido_en timestamptz,
  ultima_revision_por uuid references public.perfiles(id) on delete restrict,
  creado_en timestamptz not null default now(),
  actualizado_en timestamptz not null default now()
);

create table public.postulantes_vendedores_historial (
  id bigint generated always as identity primary key,
  postulante_id uuid not null references public.postulantes_vendedores(id) on delete restrict,
  estado_anterior text,
  estado_nuevo text not null,
  detalle jsonb not null default '{}'::jsonb,
  realizado_por uuid references public.perfiles(id) on delete restrict,
  creado_en timestamptz not null default now()
);

create table public.presupuestos (
  id uuid primary key default gen_random_uuid(),
  codigo text not null unique default (
    'REST-' || to_char(now(), 'YYYYMMDD') || '-' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 6))
  ),
  vendedor_id uuid not null references public.vendedores(id) on delete restrict,
  cliente_id uuid references public.clientes(id) on delete restrict,
  producto_id uuid not null references public.productos(id) on delete restrict,
  prospecto_nombre text check (prospecto_nombre is null or char_length(prospecto_nombre) <= 160),
  prospecto_telefono text check (prospecto_telefono is null or char_length(prospecto_telefono) <= 40),
  prospecto_email text check (prospecto_email is null or char_length(prospecto_email) <= 254),
  producto_nombre_snapshot text not null,
  producto_categoria_snapshot text not null check (producto_categoria_snapshot in ('hogar','celulares')),
  producto_imagen_url_snapshot text,
  precio_contado_snapshot numeric(14,2) not null check (precio_contado_snapshot > 0),
  modalidad_snapshot text not null,
  anticipo_snapshot numeric(14,2) not null default 0 check (anticipo_snapshot >= 0),
  cantidad_cuotas_snapshot integer not null default 0 check (cantidad_cuotas_snapshot between 0 and 120),
  valor_cuota_snapshot numeric(14,2) not null default 0 check (valor_cuota_snapshot >= 0),
  frecuencia_snapshot text not null check (frecuencia_snapshot in ('unico','semanal','mensual')),
  total_snapshot numeric(14,2) not null check (total_snapshot > 0),
  condiciones_snapshot jsonb not null,
  vigencia_dias integer not null default 7 check (vigencia_dias between 1 and 30),
  vigente_hasta date not null,
  estado text not null default 'vigente' check (estado in ('vigente','convertido','anulado')),
  venta_id uuid unique references public.ventas(id) on delete restrict,
  convertido_en timestamptz,
  creado_en timestamptz not null default now(),
  actualizado_en timestamptz not null default now()
);

create index postulantes_vendedores_estado_fecha_idx
  on public.postulantes_vendedores (estado, creado_en desc);
create index postulantes_vendedores_busqueda_idx
  on public.postulantes_vendedores (apellido, nombre, creado_en desc);
create unique index postulantes_vendedores_dni_activo_uq
  on public.postulantes_vendedores (dni_normalizado)
  where estado in ('pendiente','contactado','aprobado','activo');
create unique index postulantes_vendedores_email_activo_uq
  on public.postulantes_vendedores (email_normalizado)
  where estado in ('pendiente','contactado','aprobado','activo');
create index postulantes_vendedores_historial_postulante_idx
  on public.postulantes_vendedores_historial (postulante_id, creado_en desc);
create index presupuestos_vendedor_fecha_idx
  on public.presupuestos (vendedor_id, creado_en desc);
create index presupuestos_estado_vigencia_idx
  on public.presupuestos (estado, vigente_hasta, creado_en desc);
create index presupuestos_producto_idx
  on public.presupuestos (producto_id, creado_en desc);

create trigger programa_vendedores_config_set_actualizado_en
before update on public.programa_vendedores_config
for each row execute function public.rest_set_actualizado_en();

create trigger postulantes_vendedores_set_actualizado_en
before update on public.postulantes_vendedores
for each row execute function public.rest_set_actualizado_en();

create trigger presupuestos_set_actualizado_en
before update on public.presupuestos
for each row execute function public.rest_set_actualizado_en();

create or replace function public.postulantes_vendedores_auditar_estado()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if old.estado is distinct from new.estado then
    insert into public.postulantes_vendedores_historial (
      postulante_id, estado_anterior, estado_nuevo, detalle, realizado_por
    ) values (
      new.id, old.estado, new.estado,
      jsonb_build_object('origen', 'administracion'), auth.uid()
    );
  end if;
  return new;
end;
$$;

create trigger postulantes_vendedores_auditar_estado
after update of estado on public.postulantes_vendedores
for each row execute function public.postulantes_vendedores_auditar_estado();

create or replace function public.postulantes_vendedores_historial_inmutable()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'El historial de postulantes es inmutable';
end;
$$;

create trigger postulantes_vendedores_historial_no_update
before update or delete on public.postulantes_vendedores_historial
for each row execute function public.postulantes_vendedores_historial_inmutable();

create or replace function public.obtener_programa_vendedores_publico()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'titulo', c.titulo,
    'bajada', c.bajada,
    'presentacion', c.presentacion,
    'como_funciona', c.como_funciona,
    'herramientas', c.herramientas,
    'modalidades', c.modalidades,
    'comisiones', c.comisiones,
    'pago_comisiones', c.pago_comisiones,
    'preguntas_frecuentes', c.preguntas_frecuentes
  )
  from public.programa_vendedores_config c
  where c.id = 'principal' and c.activo = true;
$$;

create or replace function public.enviar_postulacion_vendedor(
  p_nombre text,
  p_apellido text,
  p_dni text,
  p_fecha_nacimiento date,
  p_telefono text,
  p_email text,
  p_localidad text,
  p_provincia text,
  p_ocupacion_actual text,
  p_trabaja_actualmente boolean,
  p_actividad_actual text,
  p_experiencia_ventas boolean,
  p_descripcion_experiencia text,
  p_motivacion text,
  p_canales text[],
  p_canales_otros text,
  p_disponibilidad text,
  p_disponibilidad_otro text,
  p_sitio_web text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_dni text := regexp_replace(coalesce(p_dni, ''), '[^0-9]', '', 'g');
  v_tel text := regexp_replace(coalesce(p_telefono, ''), '[^0-9]', '', 'g');
  v_email text := lower(btrim(coalesce(p_email, '')));
  v_id uuid;
begin
  -- Campo trampa: los usuarios reales no lo ven ni deben completarlo.
  if nullif(btrim(coalesce(p_sitio_web, '')), '') is not null then
    return jsonb_build_object('ok', true, 'message', 'Recibimos tu solicitud correctamente.');
  end if;

  if char_length(btrim(coalesce(p_nombre, ''))) not between 2 and 80
     or char_length(btrim(coalesce(p_apellido, ''))) not between 2 and 80 then
    raise exception 'Ingresá tu nombre y apellido';
  end if;
  if v_dni !~ '^[0-9]{6,9}$' then raise exception 'Ingresá un DNI válido'; end if;
  if char_length(v_tel) not between 10 and 15 then raise exception 'Ingresá un teléfono válido con código de área'; end if;
  if v_email !~ '^[a-z0-9._%+\-]+@[a-z0-9.\-]+\.[a-z]{2,}$' then
    raise exception 'Ingresá un email válido';
  end if;
  if p_fecha_nacimiento is not null and p_fecha_nacimiento > current_date then
    raise exception 'La fecha de nacimiento no es válida';
  end if;
  if char_length(btrim(coalesce(p_localidad, ''))) not between 2 and 120
     or char_length(btrim(coalesce(p_provincia, ''))) not between 2 and 120 then
    raise exception 'Ingresá localidad y provincia';
  end if;
  if char_length(btrim(coalesce(p_motivacion, ''))) not between 10 and 2000 then
    raise exception 'Contanos brevemente por qué te interesa vender para REST';
  end if;
  if coalesce(cardinality(p_canales), 0) < 1
     or not (p_canales <@ array[
       'whatsapp','estados_whatsapp','facebook','facebook_marketplace','instagram',
       'tiktok','contactos_personales','referidos','venta_presencial','otros'
     ]::text[]) then
    raise exception 'Elegí al menos un canal de venta válido';
  end if;
  if p_disponibilidad not in ('horas_semana','1_2_horas_dia','3_4_horas_dia','jornada_completa','otro') then
    raise exception 'Elegí una disponibilidad válida';
  end if;

  -- Respuesta deliberadamente genérica: no revela si DNI, email o teléfono ya existen.
  if exists (
    select 1 from public.postulantes_vendedores p
    where p.estado in ('pendiente','contactado','aprobado','activo')
      and (p.dni_normalizado = v_dni or p.email_normalizado = v_email or p.telefono_normalizado = v_tel)
  ) then
    return jsonb_build_object('ok', true, 'message', 'Recibimos tu solicitud correctamente.');
  end if;

  insert into public.postulantes_vendedores (
    nombre, apellido, dni, fecha_nacimiento, telefono, email, localidad, provincia,
    ocupacion_actual, trabaja_actualmente, actividad_actual, experiencia_ventas,
    descripcion_experiencia, motivacion, canales, canales_otros,
    disponibilidad, disponibilidad_otro
  ) values (
    btrim(p_nombre), btrim(p_apellido), v_dni, p_fecha_nacimiento, btrim(p_telefono), v_email,
    btrim(p_localidad), btrim(p_provincia), nullif(btrim(p_ocupacion_actual), ''),
    p_trabaja_actualmente, nullif(btrim(p_actividad_actual), ''), p_experiencia_ventas,
    nullif(btrim(p_descripcion_experiencia), ''), btrim(p_motivacion), p_canales,
    nullif(btrim(p_canales_otros), ''), p_disponibilidad,
    nullif(btrim(p_disponibilidad_otro), '')
  ) returning id into v_id;

  insert into public.postulantes_vendedores_historial (
    postulante_id, estado_anterior, estado_nuevo, detalle, realizado_por
  ) values (v_id, null, 'pendiente', jsonb_build_object('origen', 'formulario_publico'), null);

  return jsonb_build_object('ok', true, 'message', 'Recibimos tu solicitud correctamente.');
exception
  when unique_violation then
    return jsonb_build_object('ok', true, 'message', 'Recibimos tu solicitud correctamente.');
end;
$$;

create or replace function public.actualizar_programa_vendedores(p_contenido jsonb)
returns public.programa_vendedores_config
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row public.programa_vendedores_config;
begin
  if not public.es_admin() then raise exception 'Solo Administración'; end if;
  if p_contenido is null or jsonb_typeof(p_contenido) <> 'object' then
    raise exception 'Contenido inválido';
  end if;

  update public.programa_vendedores_config c set
    titulo = coalesce(nullif(btrim(p_contenido->>'titulo'), ''), c.titulo),
    bajada = coalesce(nullif(btrim(p_contenido->>'bajada'), ''), c.bajada),
    presentacion = coalesce(nullif(btrim(p_contenido->>'presentacion'), ''), c.presentacion),
    como_funciona = coalesce(nullif(btrim(p_contenido->>'como_funciona'), ''), c.como_funciona),
    herramientas = coalesce(nullif(btrim(p_contenido->>'herramientas'), ''), c.herramientas),
    modalidades = coalesce(nullif(btrim(p_contenido->>'modalidades'), ''), c.modalidades),
    comisiones = coalesce(nullif(btrim(p_contenido->>'comisiones'), ''), c.comisiones),
    pago_comisiones = coalesce(nullif(btrim(p_contenido->>'pago_comisiones'), ''), c.pago_comisiones),
    preguntas_frecuentes = case
      when jsonb_typeof(p_contenido->'preguntas_frecuentes') = 'array'
        then p_contenido->'preguntas_frecuentes'
      else c.preguntas_frecuentes
    end,
    actualizado_por = auth.uid()
  where c.id = 'principal'
  returning * into v_row;

  return v_row;
end;
$$;

create or replace function public.actualizar_postulante_vendedor(
  p_postulante_id uuid,
  p_estado text default null,
  p_observaciones text default null,
  p_condiciones_comision text default null
)
returns public.postulantes_vendedores
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row public.postulantes_vendedores;
  v_estado text := lower(nullif(btrim(coalesce(p_estado, '')), ''));
begin
  if not public.es_admin() then raise exception 'Solo Administración'; end if;

  select * into v_row from public.postulantes_vendedores where id = p_postulante_id for update;
  if not found then raise exception 'Postulante no encontrado'; end if;

  if v_estado is not null and v_estado <> v_row.estado then
    if not (
      (v_row.estado = 'pendiente' and v_estado in ('contactado','aprobado','rechazado')) or
      (v_row.estado = 'contactado' and v_estado in ('aprobado','rechazado')) or
      (v_row.estado = 'aprobado' and v_estado in ('activo','rechazado')) or
      (v_row.estado = 'activo' and v_estado = 'suspendido') or
      (v_row.estado = 'suspendido' and v_estado = 'activo')
    ) then
      raise exception 'Cambio de estado no permitido: % → %', v_row.estado, v_estado;
    end if;
  end if;

  update public.postulantes_vendedores set
    estado = coalesce(v_estado, estado),
    observaciones_internas = case when p_observaciones is null then observaciones_internas else nullif(btrim(p_observaciones), '') end,
    condiciones_comision = case when p_condiciones_comision is null then condiciones_comision else nullif(btrim(p_condiciones_comision), '') end,
    contactado_en = case when v_estado = 'contactado' then now() else contactado_en end,
    aprobado_en = case when v_estado = 'aprobado' then now() else aprobado_en end,
    rechazado_en = case when v_estado = 'rechazado' then now() else rechazado_en end,
    activado_en = case when v_estado = 'activo' then now() else activado_en end,
    suspendido_en = case when v_estado = 'suspendido' then now() else suspendido_en end,
    ultima_revision_por = auth.uid()
  where id = p_postulante_id
  returning * into v_row;

  return v_row;
end;
$$;

create or replace function public.vincular_postulante_vendedor(
  p_postulante_id uuid,
  p_vendedor_id uuid,
  p_condiciones_comision text default null
)
returns public.postulantes_vendedores
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row public.postulantes_vendedores;
begin
  if not public.es_admin() then raise exception 'Solo Administración'; end if;
  if not exists (
    select 1 from public.vendedores v
    where v.id = p_vendedor_id and v.user_id is not null
  ) then raise exception 'El vendedor o su acceso no existen'; end if;

  select * into v_row from public.postulantes_vendedores where id = p_postulante_id for update;
  if not found then raise exception 'Postulante no encontrado'; end if;
  if v_row.estado <> 'aprobado' then raise exception 'Primero debe aprobarse la postulación'; end if;

  update public.postulantes_vendedores set
    vendedor_id = p_vendedor_id,
    estado = 'activo',
    condiciones_comision = coalesce(nullif(btrim(p_condiciones_comision), ''), condiciones_comision),
    activado_en = now(),
    ultima_revision_por = auth.uid()
  where id = p_postulante_id
  returning * into v_row;

  return v_row;
end;
$$;

create or replace function public.calcular_presupuesto_rest(
  p_producto_id uuid,
  p_modalidad text,
  p_cuotas integer default 0,
  p_anticipo numeric default 0
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
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
  v_cash := v_producto.precio_contado;
  if v_cash <= 0 then raise exception 'El producto no tiene un precio válido'; end if;
  v_quote := public.cotizar_producto(p_producto_id);

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
      'value',(v_option->>'cuota')::numeric,'frequency','mensual',
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
$$;

create or replace function public.crear_presupuesto_vendedor(
  p_producto_id uuid,
  p_modalidad text,
  p_cuotas integer default 0,
  p_anticipo numeric default 0,
  p_prospecto_nombre text default null,
  p_prospecto_telefono text default null,
  p_prospecto_email text default null,
  p_vigencia_dias integer default 7,
  p_cliente_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
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
    v_producto.imagen_url, v_producto.precio_contado, p_modalidad,
    (v_quote->>'down')::numeric, (v_quote->>'count')::integer,
    (v_quote->>'value')::numeric, v_quote->>'frequency', (v_quote->>'total')::numeric,
    v_quote, p_vigencia_dias, current_date + p_vigencia_dias
  ) returning * into v_row;

  return jsonb_build_object('presupuesto',to_jsonb(v_row),'cotizacion',v_quote);
end;
$$;

create or replace function public.vincular_presupuesto_venta(
  p_presupuesto_id uuid,
  p_venta_id uuid
)
returns public.presupuestos
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row public.presupuestos;
begin
  if not public.es_admin() then raise exception 'Solo Administración'; end if;
  select p.* into v_row
  from public.presupuestos p
  join public.ventas v on v.id = p_venta_id and v.vendedor_id = p.vendedor_id
  where p.id = p_presupuesto_id and p.estado = 'vigente'
  for update of p;
  if not found then raise exception 'Presupuesto o venta incompatibles'; end if;
  update public.presupuestos set estado='convertido', venta_id=p_venta_id, convertido_en=now()
  where id=p_presupuesto_id returning * into v_row;
  return v_row;
end;
$$;

alter table public.programa_vendedores_config enable row level security;
alter table public.postulantes_vendedores enable row level security;
alter table public.postulantes_vendedores_historial enable row level security;
alter table public.presupuestos enable row level security;

create policy programa_vendedores_config_admin_select
on public.programa_vendedores_config for select to authenticated
using ((select public.es_admin()));

create policy postulantes_vendedores_admin_select
on public.postulantes_vendedores for select to authenticated
using ((select public.es_admin()));

create policy postulantes_vendedores_historial_admin_select
on public.postulantes_vendedores_historial for select to authenticated
using ((select public.es_admin()));

create policy presupuestos_select_propios_o_admin
on public.presupuestos for select to authenticated
using (vendedor_id = (select public.mi_vendedor_id()) or (select public.es_admin()));

revoke all on table public.programa_vendedores_config from anon, authenticated;
revoke all on table public.postulantes_vendedores from anon, authenticated;
revoke all on table public.postulantes_vendedores_historial from anon, authenticated;
revoke all on table public.presupuestos from anon, authenticated;

grant select on table public.programa_vendedores_config to authenticated;
grant select on table public.postulantes_vendedores to authenticated;
grant select on table public.postulantes_vendedores_historial to authenticated;
grant select on table public.presupuestos to authenticated;

revoke all on function public.postulantes_vendedores_auditar_estado() from public, anon, authenticated;
revoke all on function public.postulantes_vendedores_historial_inmutable() from public, anon, authenticated;
revoke all on function public.obtener_programa_vendedores_publico() from public, anon, authenticated;
revoke all on function public.enviar_postulacion_vendedor(text,text,text,date,text,text,text,text,text,boolean,text,boolean,text,text,text[],text,text,text,text) from public, anon, authenticated;
revoke all on function public.actualizar_programa_vendedores(jsonb) from public, anon, authenticated;
revoke all on function public.actualizar_postulante_vendedor(uuid,text,text,text) from public, anon, authenticated;
revoke all on function public.vincular_postulante_vendedor(uuid,uuid,text) from public, anon, authenticated;
revoke all on function public.calcular_presupuesto_rest(uuid,text,integer,numeric) from public, anon, authenticated;
revoke all on function public.crear_presupuesto_vendedor(uuid,text,integer,numeric,text,text,text,integer,uuid) from public, anon, authenticated;
revoke all on function public.vincular_presupuesto_venta(uuid,uuid) from public, anon, authenticated;

grant execute on function public.obtener_programa_vendedores_publico() to anon, authenticated;
grant execute on function public.enviar_postulacion_vendedor(text,text,text,date,text,text,text,text,text,boolean,text,boolean,text,text,text[],text,text,text,text) to anon, authenticated;
grant execute on function public.actualizar_programa_vendedores(jsonb) to authenticated;
grant execute on function public.actualizar_postulante_vendedor(uuid,text,text,text) to authenticated;
grant execute on function public.vincular_postulante_vendedor(uuid,uuid,text) to authenticated;
grant execute on function public.calcular_presupuesto_rest(uuid,text,integer,numeric) to authenticated;
grant execute on function public.crear_presupuesto_vendedor(uuid,text,integer,numeric,text,text,text,integer,uuid) to authenticated;
grant execute on function public.vincular_presupuesto_venta(uuid,uuid) to authenticated;

comment on table public.postulantes_vendedores is
  'Solicitudes públicas de vendedores freelance. No otorgan acceso ni rol por sí mismas.';
comment on table public.presupuestos is
  'Presupuestos REST con snapshot histórico de producto, precio y plan, vinculados al vendedor.';

commit;
