create schema auth;
create role anon nologin;
create role authenticated nologin;
create role service_role nologin bypassrls;

create or replace function auth.uid()
returns uuid
language sql
stable
as $$
  select nullif(current_setting('app.test_uid',true),'')::uuid;
$$;

create table public.perfiles (
  id uuid primary key,
  nombre text not null,
  rol text not null,
  activo boolean not null default true
);

create table public.vendedores (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references public.perfiles(id),
  nombre text not null,
  dni text,
  telefono text,
  categoria_actual text not null default 'junior',
  activo boolean not null default true
);

create table public.productos (
  id uuid primary key default gen_random_uuid(),
  nombre text not null,
  categoria text not null,
  subcategoria text,
  precio_contado numeric not null,
  imagen_url text,
  imagen_path text,
  activo boolean not null default true,
  orden integer not null default 0
);

create table public.productos_costos (
  producto_id uuid primary key references public.productos(id),
  costo numeric not null default 0
);

create table public.intereses_clientes (
  id uuid primary key default gen_random_uuid()
);

create table public.clientes (
  id uuid primary key default gen_random_uuid(),
  nombre text not null,
  dni text,
  telefono text,
  fecha_nacimiento date,
  direccion text,
  ciudad text,
  telefono_referencia text,
  creado_por_vendedor_id uuid references public.vendedores(id),
  creado_en timestamptz not null default now(),
  actualizado_en timestamptz not null default now()
);

create table public.ventas (
  id uuid primary key default gen_random_uuid(),
  vendedor_id uuid not null references public.vendedores(id),
  cliente_id uuid not null references public.clientes(id),
  producto text not null,
  monto_total numeric not null,
  forma_pago text not null,
  anticipo_esperado numeric not null default 0,
  notas text,
  estado text not null,
  aprobada_por uuid references public.perfiles(id),
  interes_cliente_id uuid references public.intereses_clientes(id),
  fecha_venta timestamptz not null default now()
);

create table public.solicitudes_venta (
  id uuid primary key default gen_random_uuid(),
  clave_idempotencia uuid not null unique,
  vendedor_id uuid not null references public.vendedores(id) on delete restrict,
  interes_cliente_id uuid references public.intereses_clientes(id) on delete set null,
  producto_id uuid not null references public.productos(id) on delete restrict,
  unidad text not null check (unidad in ('hogar','celulares')),
  producto_nombre text not null,
  producto_precio_contado numeric not null,
  cliente_nombre text not null,
  cliente_dni text not null,
  cliente_telefono text,
  cliente_fecha_nacimiento date,
  cliente_direccion text,
  cliente_ciudad text,
  cliente_telefono_referencia text,
  forma_pago text not null,
  monto_total numeric not null,
  anticipo numeric not null default 0,
  monto_financiado numeric generated always as (monto_total-anticipo) stored,
  cantidad_cuotas integer not null default 0,
  valor_cuota numeric not null default 0,
  frecuencia text not null default 'unico',
  primer_vencimiento date,
  notas text,
  estado text not null default 'pendiente',
  motivo_revision text,
  revisada_por uuid references public.perfiles(id),
  revisada_en timestamptz,
  venta_id uuid unique references public.ventas(id),
  cuenta_credito_id uuid unique,
  version integer not null default 1,
  creado_en timestamptz not null default now(),
  actualizado_en timestamptz not null default now(),
  constraint solicitudes_venta_plan_coherente check (
    (frecuencia='unico' and cantidad_cuotas=0 and valor_cuota=0 and primer_vencimiento is null)
    or
    (frecuencia in ('semanal','quincenal','mensual') and cantidad_cuotas>0 and valor_cuota>0
      and primer_vencimiento is not null and monto_financiado>0
      and abs(monto_financiado-cantidad_cuotas*valor_cuota)<=cantidad_cuotas*0.01)
  )
);

create or replace function public.es_admin()
returns boolean
language sql
stable
security definer
set search_path=''
as $$
  select exists(select 1 from public.perfiles p where p.id=auth.uid() and p.rol='admin' and p.activo=true);
$$;

create or replace function public.aprobar_solicitud_venta(p_solicitud_id uuid)
returns jsonb
language plpgsql
security definer
set search_path=''
as $$
declare
  v_s public.solicitudes_venta%rowtype;
  v_cliente uuid;
  v_venta uuid;
begin
  if auth.uid() is null or not public.es_admin() then raise exception 'Solo Administración'; end if;
  select * into v_s from public.solicitudes_venta where id=p_solicitud_id for update;
  if not found then raise exception 'Solicitud no encontrada'; end if;
  if v_s.estado='aprobada' then return to_jsonb(v_s); end if;
  if v_s.estado<>'pendiente' then raise exception 'Solicitud no pendiente'; end if;
  select id into v_cliente from public.clientes where regexp_replace(coalesce(dni,''),'[^0-9]','','g')=v_s.cliente_dni order by creado_en limit 1;
  if v_cliente is null then
    insert into public.clientes(nombre,dni,telefono,direccion,ciudad,creado_por_vendedor_id)
    values(v_s.cliente_nombre,v_s.cliente_dni,v_s.cliente_telefono,v_s.cliente_direccion,v_s.cliente_ciudad,v_s.vendedor_id)
    returning id into v_cliente;
  end if;
  insert into public.ventas(vendedor_id,cliente_id,producto,monto_total,forma_pago,anticipo_esperado,notas,estado,aprobada_por)
  values(v_s.vendedor_id,v_cliente,v_s.producto_nombre,v_s.monto_total,v_s.forma_pago,v_s.anticipo,v_s.notas,'aprobada_entrega',auth.uid())
  returning id into v_venta;
  update public.solicitudes_venta set estado='aprobada',venta_id=v_venta,revisada_por=auth.uid(),revisada_en=now() where id=p_solicitud_id returning * into v_s;
  return to_jsonb(v_s);
end;
$$;

alter table public.solicitudes_venta enable row level security;
create policy solicitudes_venta_select_propias_o_admin on public.solicitudes_venta for select to authenticated using (public.es_admin());
revoke all on table public.solicitudes_venta from anon, authenticated;
grant select on table public.solicitudes_venta to authenticated;
grant all on table public.solicitudes_venta to service_role;
grant execute on function public.aprobar_solicitud_venta(uuid) to authenticated;

insert into public.perfiles(id,nombre,rol,activo) values
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','Administración REST','admin',true),
  ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb','Sofía Gómez','vendedor',true);
insert into public.vendedores(id,user_id,nombre,categoria_actual,activo)
values('cccccccc-cccc-4ccc-8ccc-cccccccccccc','bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb','Sofía Gómez','pro',true);
insert into public.productos(id,nombre,categoria,subcategoria,precio_contado,imagen_url,activo,orden)
values('dddddddd-dddd-4ddd-8ddd-dddddddddddd','Alacena 120 cm','hogar','Muebles',100000,'https://example.test/alacena.jpg',true,1);
