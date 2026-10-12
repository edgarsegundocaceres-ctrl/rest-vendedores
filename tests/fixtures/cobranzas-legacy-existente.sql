-- Forma REAL de la tabla anterior. SOLO fixtures locales, sin datos de producción.
-- Lectura de ventas usada por la política de cobranzas, verificada en Supabase el 12/10/2026.
grant select on public.ventas to authenticated;
alter table public.ventas enable row level security;
create policy ventas_select_own_or_admin on public.ventas for select using(vendedor_id=public.mi_vendedor_id() or public.es_admin());
create table public.cobranzas_ventas (
 id uuid primary key default gen_random_uuid(),
 venta_id uuid not null references public.ventas(id) on delete cascade,
 numero_cuota integer not null check(numero_cuota>=1),
 monto numeric not null check(monto>0),
 fecha_pago timestamptz not null default now(),
 registrado_por uuid references public.perfiles(id) on delete set null,
 notas text,
 creado_en timestamptz not null default now(),
 unique(venta_id,numero_cuota)
);
alter table public.cobranzas_ventas enable row level security;
grant all on public.cobranzas_ventas to anon,authenticated;
create policy cobranzas_admin_all on public.cobranzas_ventas for all using(public.es_admin()) with check(public.es_admin());
create policy cobranzas_select_own_or_admin on public.cobranzas_ventas for select using(exists(select 1 from public.ventas v where v.id=cobranzas_ventas.venta_id and (v.vendedor_id=public.mi_vendedor_id() or public.es_admin())));
