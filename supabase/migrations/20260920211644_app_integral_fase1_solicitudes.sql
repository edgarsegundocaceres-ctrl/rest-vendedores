-- App Integral REST · Fase 1
-- Solicitudes de venta para Hogar y Celulares, aprobación atómica y cuenta propia.
-- Migración aditiva: no modifica ni migra ventas históricas.

begin;

create table public.solicitudes_venta (
  id uuid primary key default gen_random_uuid(),
  clave_idempotencia uuid not null unique,
  vendedor_id uuid not null references public.vendedores(id) on delete restrict,
  interes_cliente_id uuid references public.intereses_clientes(id) on delete set null,
  producto_id uuid not null references public.productos(id) on delete restrict,
  unidad text not null check (unidad in ('hogar', 'celulares')),
  producto_nombre text not null check (char_length(btrim(producto_nombre)) between 2 and 180),
  producto_precio_contado numeric not null check (
    producto_precio_contado >= 0
    and producto_precio_contado::text !~ '^(NaN|[-+]?Infinity)$'
  ),
  cliente_nombre text not null check (char_length(btrim(cliente_nombre)) between 2 and 120),
  cliente_dni text not null check (cliente_dni ~ '^[0-9]{6,9}$'),
  cliente_telefono text check (cliente_telefono is null or char_length(cliente_telefono) <= 40),
  cliente_fecha_nacimiento date,
  cliente_direccion text check (cliente_direccion is null or char_length(cliente_direccion) <= 240),
  cliente_ciudad text check (cliente_ciudad is null or char_length(cliente_ciudad) <= 120),
  cliente_telefono_referencia text check (cliente_telefono_referencia is null or char_length(cliente_telefono_referencia) <= 40),
  forma_pago text not null check (char_length(btrim(forma_pago)) between 2 and 180),
  monto_total numeric not null check (
    monto_total > 0
    and monto_total::text !~ '^(NaN|[-+]?Infinity)$'
  ),
  anticipo numeric not null default 0 check (
    anticipo >= 0
    and anticipo <= monto_total
    and anticipo::text !~ '^(NaN|[-+]?Infinity)$'
  ),
  monto_financiado numeric generated always as (monto_total - anticipo) stored,
  cantidad_cuotas integer not null default 0 check (cantidad_cuotas between 0 and 120),
  valor_cuota numeric not null default 0 check (
    valor_cuota >= 0
    and valor_cuota::text !~ '^(NaN|[-+]?Infinity)$'
  ),
  frecuencia text not null default 'unico' check (frecuencia in ('unico', 'semanal', 'quincenal', 'mensual')),
  primer_vencimiento date,
  notas text check (notas is null or char_length(notas) <= 4000),
  estado text not null default 'pendiente' check (
    estado in ('pendiente', 'correccion_solicitada', 'aprobada', 'rechazada', 'anulada')
  ),
  motivo_revision text check (motivo_revision is null or char_length(motivo_revision) <= 2000),
  revisada_por uuid references public.perfiles(id) on delete restrict,
  revisada_en timestamptz,
  venta_id uuid unique references public.ventas(id) on delete restrict,
  cuenta_credito_id uuid unique,
  version integer not null default 1 check (version >= 1),
  creado_en timestamptz not null default now(),
  actualizado_en timestamptz not null default now(),
  constraint solicitudes_venta_plan_coherente check (
    (
      frecuencia = 'unico'
      and cantidad_cuotas = 0
      and valor_cuota = 0
      and primer_vencimiento is null
    )
    or
    (
      frecuencia in ('semanal', 'quincenal', 'mensual')
      and cantidad_cuotas > 0
      and valor_cuota > 0
      and primer_vencimiento is not null
      and monto_financiado > 0
      and abs(monto_financiado - cantidad_cuotas * valor_cuota) <= cantidad_cuotas * 0.01
      and monto_financiado - ((cantidad_cuotas - 1) * valor_cuota) > 0
    )
  )
);

create table public.cuentas_credito (
  id uuid primary key default gen_random_uuid(),
  solicitud_id uuid not null unique references public.solicitudes_venta(id) on delete restrict,
  venta_id uuid not null unique references public.ventas(id) on delete restrict,
  cliente_id uuid not null references public.clientes(id) on delete restrict,
  vendedor_id uuid not null references public.vendedores(id) on delete restrict,
  unidad text not null check (unidad in ('hogar', 'celulares')),
  forma_pago text not null,
  monto_total numeric not null check (monto_total > 0),
  anticipo numeric not null default 0 check (anticipo >= 0 and anticipo <= monto_total),
  monto_financiado numeric not null check (monto_financiado >= 0),
  saldo_actual numeric not null check (saldo_actual >= 0 and saldo_actual <= monto_financiado),
  estado text not null check (estado in ('sin_saldo', 'activa', 'finalizada', 'anulada')),
  creada_por uuid not null references public.perfiles(id) on delete restrict,
  creada_en timestamptz not null default now(),
  actualizado_en timestamptz not null default now(),
  constraint cuentas_credito_estado_coherente check (
    (monto_financiado = 0 and saldo_actual = 0 and estado in ('sin_saldo', 'anulada'))
    or
    (monto_financiado > 0 and estado in ('activa', 'finalizada', 'anulada'))
  )
);

alter table public.solicitudes_venta
  add constraint solicitudes_venta_cuenta_credito_id_fkey
  foreign key (cuenta_credito_id) references public.cuentas_credito(id) on delete restrict;

create table public.cuotas_credito (
  id uuid primary key default gen_random_uuid(),
  cuenta_id uuid not null references public.cuentas_credito(id) on delete restrict,
  numero integer not null check (numero between 1 and 120),
  vencimiento date not null,
  importe numeric not null check (importe > 0 and importe::text !~ '^(NaN|[-+]?Infinity)$'),
  importe_pagado numeric not null default 0 check (
    importe_pagado >= 0
    and importe_pagado <= importe
    and importe_pagado::text !~ '^(NaN|[-+]?Infinity)$'
  ),
  saldo numeric generated always as (importe - importe_pagado) stored,
  estado text not null default 'pendiente' check (estado in ('pendiente', 'parcial', 'pagada', 'vencida', 'anulada')),
  pagada_en timestamptz,
  creada_en timestamptz not null default now(),
  actualizado_en timestamptz not null default now(),
  unique (cuenta_id, numero)
);

create table public.credito_auditoria (
  id bigint generated always as identity primary key,
  accion text not null check (char_length(btrim(accion)) between 2 and 80),
  entidad text not null check (entidad in ('solicitud_venta', 'cuenta_credito', 'cuota_credito')),
  entidad_id uuid not null,
  usuario_id uuid not null references public.perfiles(id) on delete restrict,
  detalle jsonb not null default '{}'::jsonb,
  creada_en timestamptz not null default now()
);

comment on table public.solicitudes_venta is
  'Bandeja transaccional previa a ventas. Fase 1: Hogar y Celulares.';
comment on table public.cuentas_credito is
  'Cuenta REST creada únicamente al aprobar una solicitud de venta.';
comment on table public.cuotas_credito is
  'Cronograma inicial de cada cuenta REST; no reemplaza cobranzas históricas.';
comment on table public.credito_auditoria is
  'Registro inmutable de decisiones y altas del flujo de crédito REST.';

create index solicitudes_venta_estado_creado_idx
  on public.solicitudes_venta (estado, creado_en desc);
create index solicitudes_venta_vendedor_estado_idx
  on public.solicitudes_venta (vendedor_id, estado, creado_en desc);
create index solicitudes_venta_unidad_estado_idx
  on public.solicitudes_venta (unidad, estado, creado_en desc);
create index solicitudes_venta_producto_idx
  on public.solicitudes_venta (producto_id);
create index solicitudes_venta_interes_idx
  on public.solicitudes_venta (interes_cliente_id)
  where interes_cliente_id is not null;
create index solicitudes_venta_revisada_por_idx
  on public.solicitudes_venta (revisada_por, revisada_en desc)
  where revisada_por is not null;
create unique index solicitudes_venta_interes_activo_uq
  on public.solicitudes_venta (interes_cliente_id)
  where interes_cliente_id is not null
    and estado not in ('rechazada', 'anulada');
create index solicitudes_venta_dni_normalizado_idx
  on public.solicitudes_venta ((regexp_replace(cliente_dni, '[^0-9]', '', 'g')));

-- No es UNIQUE: la base histórica ya contiene DNI repetidos. La aprobación los
-- detecta y se detiene para que Administración resuelva el caso sin fusionar a ciegas.
create index if not exists clientes_dni_normalizado_idx
  on public.clientes ((regexp_replace(coalesce(dni, ''), '[^0-9]', '', 'g')))
  where nullif(regexp_replace(coalesce(dni, ''), '[^0-9]', '', 'g'), '') is not null;

create index cuentas_credito_cliente_estado_idx
  on public.cuentas_credito (cliente_id, estado);
create index cuentas_credito_unidad_estado_idx
  on public.cuentas_credito (unidad, estado);
create index cuentas_credito_vendedor_idx
  on public.cuentas_credito (vendedor_id, creada_en desc);
create index cuentas_credito_creada_por_idx
  on public.cuentas_credito (creada_por, creada_en desc);
create index cuotas_credito_vencimiento_estado_idx
  on public.cuotas_credito (vencimiento, estado);
create index cuotas_credito_cuenta_estado_idx
  on public.cuotas_credito (cuenta_id, estado, numero);
create index credito_auditoria_entidad_idx
  on public.credito_auditoria (entidad, entidad_id, creada_en desc);
create index credito_auditoria_usuario_idx
  on public.credito_auditoria (usuario_id, creada_en desc);

create trigger solicitudes_venta_set_actualizado_en
before update on public.solicitudes_venta
for each row execute function public.rest_set_actualizado_en();

create trigger cuentas_credito_set_actualizado_en
before update on public.cuentas_credito
for each row execute function public.rest_set_actualizado_en();

create trigger cuotas_credito_set_actualizado_en
before update on public.cuotas_credito
for each row execute function public.rest_set_actualizado_en();

create or replace function public.credito_auditoria_inmutable()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'La auditoría de crédito es inmutable';
end;
$$;

create or replace function public.credito_fecha_vencimiento(
  p_primer_vencimiento date,
  p_frecuencia text,
  p_numero integer
)
returns date
language plpgsql
immutable
strict
set search_path = ''
as $$
declare
  v_mes date;
  v_ultimo_dia integer;
  v_dia integer;
begin
  if p_numero < 1 then
    raise exception 'El número de cuota debe ser mayor a cero';
  end if;

  if p_frecuencia = 'semanal' then
    return p_primer_vencimiento + ((p_numero - 1) * 7);
  elsif p_frecuencia = 'quincenal' then
    return p_primer_vencimiento + ((p_numero - 1) * 14);
  elsif p_frecuencia = 'mensual' then
    v_mes := (date_trunc('month', p_primer_vencimiento)::date
      + make_interval(months => p_numero - 1))::date;
    v_ultimo_dia := extract(day from (v_mes + interval '1 month - 1 day'))::integer;
    v_dia := least(extract(day from p_primer_vencimiento)::integer, v_ultimo_dia);
    return v_mes + (v_dia - 1);
  end if;

  raise exception 'Frecuencia de cuota inválida';
end;
$$;

create or replace function public.resolver_solicitud_venta(
  p_solicitud_id uuid,
  p_accion text,
  p_motivo text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_usuario_id uuid := auth.uid();
  v_solicitud public.solicitudes_venta%rowtype;
  v_estado text;
  v_accion_auditoria text;
  v_motivo text := btrim(coalesce(p_motivo, ''));
  v_resultado jsonb;
begin
  if v_usuario_id is null or not public.es_admin() then
    raise exception 'Solo Administración puede resolver solicitudes';
  end if;
  if p_solicitud_id is null then
    raise exception 'Solicitud inválida';
  end if;
  if char_length(v_motivo) not between 1 and 2000 then
    raise exception 'Ingresá un motivo de hasta 2000 caracteres';
  end if;

  if p_accion = 'rechazar' then
    v_estado := 'rechazada';
    v_accion_auditoria := 'solicitud_rechazada';
  elsif p_accion = 'pedir_correccion' then
    v_estado := 'correccion_solicitada';
    v_accion_auditoria := 'correccion_solicitada';
  else
    raise exception 'Acción inválida';
  end if;

  select s.*
    into v_solicitud
  from public.solicitudes_venta s
  where s.id = p_solicitud_id
  for update;

  if not found then
    raise exception 'La solicitud no existe';
  end if;

  if v_solicitud.estado = v_estado
     and v_solicitud.motivo_revision = v_motivo
     and v_solicitud.revisada_por = v_usuario_id then
    return to_jsonb(v_solicitud);
  end if;

  if v_solicitud.estado <> 'pendiente' then
    raise exception 'La solicitud ya fue resuelta';
  end if;

  update public.solicitudes_venta
  set estado = v_estado,
      motivo_revision = v_motivo,
      revisada_por = v_usuario_id,
      revisada_en = now(),
      version = version + 1,
      actualizado_en = now()
  where id = p_solicitud_id;

  insert into public.credito_auditoria (accion, entidad, entidad_id, usuario_id, detalle)
  values (
    v_accion_auditoria,
    'solicitud_venta',
    p_solicitud_id,
    v_usuario_id,
    jsonb_build_object('motivo', v_motivo, 'estado_anterior', v_solicitud.estado)
  );

  select to_jsonb(s) into v_resultado
  from public.solicitudes_venta s where s.id = p_solicitud_id;
  return v_resultado;
end;
$$;

create or replace function public.aprobar_solicitud_venta(p_solicitud_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_usuario_id uuid := auth.uid();
  v_solicitud public.solicitudes_venta%rowtype;
  v_producto public.productos%rowtype;
  v_interes public.intereses_clientes%rowtype;
  v_cliente_id uuid;
  v_clientes_dni integer;
  v_venta_id uuid;
  v_cuenta_id uuid;
  v_es_financiada boolean;
  v_mes date := date_trunc('month', current_date)::date;
  v_cupo numeric := 0;
  v_usado numeric := 0;
  v_saldo numeric;
  v_importe numeric;
  v_numero integer;
  v_resultado jsonb;
begin
  if v_usuario_id is null or not public.es_admin() then
    raise exception 'Solo Administración puede aprobar solicitudes';
  end if;
  if p_solicitud_id is null then
    raise exception 'Solicitud inválida';
  end if;

  select s.*
    into v_solicitud
  from public.solicitudes_venta s
  where s.id = p_solicitud_id
  for update;

  if not found then
    raise exception 'La solicitud no existe';
  end if;
  if v_solicitud.estado = 'aprobada' then
    return to_jsonb(v_solicitud);
  end if;
  if v_solicitud.estado <> 'pendiente' then
    raise exception 'La solicitud no está pendiente de aprobación';
  end if;

  select p.*
    into v_producto
  from public.productos p
  where p.id = v_solicitud.producto_id
    and p.activo = true
  for share;

  if not found or v_producto.categoria <> v_solicitud.unidad
     or v_producto.categoria not in ('hogar', 'celulares') then
    raise exception 'El producto dejó de estar disponible para esta unidad';
  end if;

  if v_solicitud.interes_cliente_id is not null then
    select i.*
      into v_interes
    from public.intereses_clientes i
    where i.id = v_solicitud.interes_cliente_id
    for update;

    if not found then
      raise exception 'La oportunidad vinculada ya no existe';
    end if;
    if v_interes.vendedor_id is distinct from v_solicitud.vendedor_id
       or v_interes.estado not in ('asignado', 'en_gestion')
       or v_interes.venta_id is not null then
      raise exception 'La oportunidad vinculada cambió o ya fue cerrada';
    end if;
    if v_interes.producto_id is not null
       and v_interes.producto_id <> v_solicitud.producto_id then
      raise exception 'La oportunidad vinculada corresponde a otro producto';
    end if;
  end if;

  perform pg_advisory_xact_lock(
    hashtextextended('rest-cliente-dni:' || v_solicitud.cliente_dni, 0)
  );

  select count(*)::integer,
         (array_agg(c.id order by c.creado_en, c.id))[1]
    into v_clientes_dni, v_cliente_id
  from public.clientes c
  where regexp_replace(coalesce(c.dni, ''), '[^0-9]', '', 'g') = v_solicitud.cliente_dni;

  if v_clientes_dni > 1 then
    raise exception 'El DNI % aparece en más de un cliente histórico. Unificá el cliente antes de aprobar.',
      v_solicitud.cliente_dni;
  elsif v_clientes_dni = 0 then
    insert into public.clientes (
      nombre, dni, telefono, fecha_nacimiento, direccion, ciudad,
      telefono_referencia, creado_por_vendedor_id
    ) values (
      v_solicitud.cliente_nombre,
      v_solicitud.cliente_dni,
      v_solicitud.cliente_telefono,
      v_solicitud.cliente_fecha_nacimiento,
      v_solicitud.cliente_direccion,
      v_solicitud.cliente_ciudad,
      v_solicitud.cliente_telefono_referencia,
      v_solicitud.vendedor_id
    ) returning id into v_cliente_id;
  else
    update public.clientes
    set telefono = coalesce(nullif(telefono, ''), v_solicitud.cliente_telefono),
        fecha_nacimiento = coalesce(fecha_nacimiento, v_solicitud.cliente_fecha_nacimiento),
        direccion = coalesce(nullif(direccion, ''), v_solicitud.cliente_direccion),
        ciudad = coalesce(nullif(ciudad, ''), v_solicitud.cliente_ciudad),
        telefono_referencia = coalesce(nullif(telefono_referencia, ''), v_solicitud.cliente_telefono_referencia),
        actualizado_en = now()
    where id = v_cliente_id;
  end if;

  v_es_financiada := public.es_venta_financiada(v_solicitud.forma_pago);

  if v_es_financiada then
    perform pg_advisory_xact_lock(hashtextextended('rest-cupo:' || v_mes::text, 0));

    select c.monto_cupo
      into v_cupo
    from public.cupos_financiacion_mensual c
    where c.mes = v_mes
    for update;

    v_cupo := coalesce(v_cupo, 0);

    select coalesce(sum(v.monto_total), 0)
      into v_usado
    from public.ventas v
    where date_trunc('month', coalesce(v.fecha_entrega, v.fecha_venta))::date = v_mes
      and v.estado in ('aprobada_entrega', 'entregada', 'en_cobranza', 'consolidada')
      and public.es_venta_financiada(v.forma_pago);

    if v_usado + v_solicitud.monto_total > v_cupo then
      raise exception 'Cupo de financiación insuficiente. Disponible: %',
        greatest(v_cupo - v_usado, 0);
    end if;
  end if;

  insert into public.ventas (
    vendedor_id, cliente_id, producto, monto_total, forma_pago,
    anticipo_esperado, notas, estado, aprobada_por, interes_cliente_id
  ) values (
    v_solicitud.vendedor_id,
    v_cliente_id,
    v_solicitud.producto_nombre,
    v_solicitud.monto_total,
    v_solicitud.forma_pago,
    v_solicitud.anticipo,
    v_solicitud.notas,
    'aprobada_entrega',
    v_usuario_id,
    v_solicitud.interes_cliente_id
  ) returning id into v_venta_id;

  if v_solicitud.interes_cliente_id is not null then
    update public.intereses_clientes
    set venta_id = v_venta_id,
        estado = 'venta_realizada',
        convertido_en = now(),
        actualizado_en = now()
    where id = v_solicitud.interes_cliente_id;
  end if;

  v_saldo := case when v_es_financiada then v_solicitud.monto_financiado else 0 end;

  insert into public.cuentas_credito (
    solicitud_id, venta_id, cliente_id, vendedor_id, unidad, forma_pago,
    monto_total, anticipo, monto_financiado, saldo_actual, estado, creada_por
  ) values (
    v_solicitud.id,
    v_venta_id,
    v_cliente_id,
    v_solicitud.vendedor_id,
    v_solicitud.unidad,
    v_solicitud.forma_pago,
    v_solicitud.monto_total,
    v_solicitud.anticipo,
    v_saldo,
    v_saldo,
    case when v_saldo = 0 then 'sin_saldo' else 'activa' end,
    v_usuario_id
  ) returning id into v_cuenta_id;

  if v_es_financiada then
    for v_numero in 1..v_solicitud.cantidad_cuotas loop
      v_importe := case
        when v_numero < v_solicitud.cantidad_cuotas then v_solicitud.valor_cuota
        else v_solicitud.monto_financiado
          - ((v_solicitud.cantidad_cuotas - 1) * v_solicitud.valor_cuota)
      end;

      insert into public.cuotas_credito (
        cuenta_id, numero, vencimiento, importe
      ) values (
        v_cuenta_id,
        v_numero,
        public.credito_fecha_vencimiento(
          v_solicitud.primer_vencimiento,
          v_solicitud.frecuencia,
          v_numero
        ),
        v_importe
      );
    end loop;
  end if;

  update public.solicitudes_venta
  set estado = 'aprobada',
      motivo_revision = null,
      revisada_por = v_usuario_id,
      revisada_en = now(),
      venta_id = v_venta_id,
      cuenta_credito_id = v_cuenta_id,
      version = version + 1,
      actualizado_en = now()
  where id = v_solicitud.id;

  insert into public.credito_auditoria (accion, entidad, entidad_id, usuario_id, detalle)
  values (
    'solicitud_aprobada',
    'solicitud_venta',
    v_solicitud.id,
    v_usuario_id,
    jsonb_build_object(
      'venta_id', v_venta_id,
      'cuenta_credito_id', v_cuenta_id,
      'cliente_id', v_cliente_id,
      'cantidad_cuotas', case when v_es_financiada then v_solicitud.cantidad_cuotas else 0 end
    )
  );

  insert into public.credito_auditoria (accion, entidad, entidad_id, usuario_id, detalle)
  values (
    'cuenta_creada',
    'cuenta_credito',
    v_cuenta_id,
    v_usuario_id,
    jsonb_build_object(
      'solicitud_id', v_solicitud.id,
      'venta_id', v_venta_id,
      'monto_financiado', v_saldo
    )
  );

  select to_jsonb(s) into v_resultado
  from public.solicitudes_venta s where s.id = v_solicitud.id;
  return v_resultado;
end;
$$;


create trigger credito_auditoria_bloquea_cambios
before update or delete on public.credito_auditoria
for each row execute function public.credito_auditoria_inmutable();

create or replace function public.guardar_solicitud_venta(
  p_datos jsonb,
  p_clave_idempotencia uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
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
      cantidad_cuotas, valor_cuota, frecuencia, primer_vencimiento, notas
    ) values (
      v_clave, v_vendedor_id, v_interes_id, v_producto.id, v_unidad,
      v_producto.nombre, v_producto.precio_contado, v_cliente_nombre, v_cliente_dni,
      v_cliente_telefono, v_cliente_fecha_nacimiento, v_cliente_direccion, v_cliente_ciudad,
      v_cliente_telefono_referencia, v_forma_pago, v_total, v_anticipo,
      v_cantidad, v_valor_cuota, v_frecuencia, v_primer_vencimiento, v_notas
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
$$;

alter table public.solicitudes_venta enable row level security;
alter table public.cuentas_credito enable row level security;
alter table public.cuotas_credito enable row level security;
alter table public.credito_auditoria enable row level security;

create policy solicitudes_venta_select_propias_o_admin
on public.solicitudes_venta
for select
to authenticated
using (
  vendedor_id = (select public.mi_vendedor_id())
  or (select public.es_admin())
);

create policy cuentas_credito_select_propias_o_admin
on public.cuentas_credito
for select
to authenticated
using (
  vendedor_id = (select public.mi_vendedor_id())
  or (select public.es_admin())
);

create policy cuotas_credito_select_propias_o_admin
on public.cuotas_credito
for select
to authenticated
using (
  (select public.es_admin())
  or exists (
    select 1
    from public.cuentas_credito c
    where c.id = cuotas_credito.cuenta_id
      and c.vendedor_id = (select public.mi_vendedor_id())
  )
);

create policy credito_auditoria_select_admin
on public.credito_auditoria
for select
to authenticated
using ((select public.es_admin()));

revoke all on table public.solicitudes_venta from anon, authenticated;
revoke all on table public.cuentas_credito from anon, authenticated;
revoke all on table public.cuotas_credito from anon, authenticated;
revoke all on table public.credito_auditoria from anon, authenticated;

grant select on table public.solicitudes_venta to authenticated;
grant select on table public.cuentas_credito to authenticated;
grant select on table public.cuotas_credito to authenticated;
grant select on table public.credito_auditoria to authenticated;

grant all on table public.solicitudes_venta to service_role;
grant all on table public.cuentas_credito to service_role;
grant all on table public.cuotas_credito to service_role;
grant all on table public.credito_auditoria to service_role;
grant usage, select on sequence public.credito_auditoria_id_seq to service_role;

revoke execute on function public.credito_auditoria_inmutable() from public, anon, authenticated;
revoke execute on function public.credito_fecha_vencimiento(date, text, integer) from public, anon;
revoke execute on function public.guardar_solicitud_venta(jsonb, uuid) from public, anon;
revoke execute on function public.resolver_solicitud_venta(uuid, text, text) from public, anon;
revoke execute on function public.aprobar_solicitud_venta(uuid) from public, anon;

grant execute on function public.credito_fecha_vencimiento(date, text, integer) to authenticated;
grant execute on function public.guardar_solicitud_venta(jsonb, uuid) to authenticated;
grant execute on function public.resolver_solicitud_venta(uuid, text, text) to authenticated;
grant execute on function public.aprobar_solicitud_venta(uuid) to authenticated;

notify pgrst, 'reload schema';

commit;
