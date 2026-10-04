-- APP INTEGRAL REST · Índices de relaciones para captación y presupuestos
-- Migración aditiva posterior a captacion_vendedores_presupuestos.

begin;

create index if not exists programa_vendedores_config_actualizado_por_idx
  on public.programa_vendedores_config (actualizado_por)
  where actualizado_por is not null;

create index if not exists postulantes_vendedores_ultima_revision_por_idx
  on public.postulantes_vendedores (ultima_revision_por)
  where ultima_revision_por is not null;

create index if not exists postulantes_vendedores_historial_realizado_por_idx
  on public.postulantes_vendedores_historial (realizado_por)
  where realizado_por is not null;

create index if not exists presupuestos_cliente_idx
  on public.presupuestos (cliente_id)
  where cliente_id is not null;

commit;
