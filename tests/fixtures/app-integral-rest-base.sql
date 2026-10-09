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
  pro_permanente boolean not null default false,
  actualizado_en timestamptz not null default now(),
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
  id uuid primary key default gen_random_uuid(),
  vendedor_id uuid references public.vendedores(id),
  producto_id uuid references public.productos(id),
  estado text,
  venta_id uuid,
  convertido_en timestamptz,
  actualizado_en timestamptz default now()
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
  fecha_entrega timestamptz,
  creado_en timestamptz not null default now(),
  actualizado_en timestamptz not null default now(),
  fecha_venta timestamptz not null default now()
);


create table public.cupos_financiacion_mensual (mes date primary key, monto_cupo numeric not null);
insert into public.cupos_financiacion_mensual values(date_trunc('month',current_date)::date,10000000);
create table public.comisiones (
 id uuid primary key default gen_random_uuid(), venta_id uuid not null unique references public.ventas(id),
 vendedor_id uuid not null references public.vendedores(id), porcentaje numeric not null,
 importe_original numeric not null, importe_vigente numeric not null,
 porcentaje_conservado numeric not null default 100, estado text not null default 'generada',
 generado_en timestamptz not null default now(), actualizado_en timestamptz not null default now()
);
create table public.movimientos_vendedor (
 id uuid primary key default gen_random_uuid(), vendedor_id uuid not null references public.vendedores(id),
 tipo text not null, importe numeric not null, venta_id uuid references public.ventas(id),
 comision_id uuid references public.comisiones(id), descripcion text, registrado_por uuid references public.perfiles(id)
);
create table public.estado_mensual_vendedor (
 vendedor_id uuid not null references public.vendedores(id), mes date not null,
 ventas_validas integer not null default 0, facturacion_valida numeric not null default 0,
 categoria_provisional text not null default 'junior', basico_provisional numeric not null default 0,
 actualizado_en timestamptz not null default now(), primary key(vendedor_id,mes)
);
create or replace function public.rest_set_actualizado_en() returns trigger language plpgsql as $$
begin new.actualizado_en=now(); return new; end; $$;
create or replace function public.mi_vendedor_id() returns uuid language sql stable security definer as $$
 select id from public.vendedores where user_id=auth.uid() and activo limit 1; $$;
create or replace function public.es_admin() returns boolean language sql stable security definer as $$
 select exists(select 1 from public.perfiles where id=auth.uid() and rol='admin' and activo); $$;
create or replace function public.es_vendedor_asignado_interes(p_interes_id uuid) returns boolean language sql stable as $$ select false; $$;
grant usage on schema auth to anon,authenticated;
insert into public.perfiles(id,nombre,rol,activo) values
 ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','Administración REST','admin',true),
 ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb','Sofía Gómez','vendedor',true),
 ('bbbbbbbb-bbbb-4bbb-8bbb-000000000002','Otro vendedor','vendedor',true);
insert into public.vendedores(id,user_id,nombre,categoria_actual,activo) values
 ('cccccccc-cccc-4ccc-8ccc-cccccccccccc','bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb','Sofía Gómez','pro',true),
 ('cccccccc-cccc-4ccc-8ccc-000000000002','bbbbbbbb-bbbb-4bbb-8bbb-000000000002','Otro vendedor','junior',true);
insert into public.productos(id,nombre,categoria,subcategoria,precio_contado,imagen_url,activo,orden) values
 ('dddddddd-dddd-4ddd-8ddd-dddddddddddd','Alacena 120 cm','hogar','Muebles',100000,'https://example.test/alacena.jpg',true,1),
 ('dddddddd-dddd-4ddd-8ddd-000000000002','Teléfono de prueba','celulares','Celulares',140000,null,true,2),
 ('dddddddd-dddd-4ddd-8ddd-000000000003','Producto oculto','hogar','Muebles',20000,null,false,3),
 ('dddddddd-dddd-4ddd-8ddd-000000000004','Modelo ajeno al canal','motos',null,200000,null,true,4);
