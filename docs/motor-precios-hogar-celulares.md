# Motor de precios Hogar + Celulares — revisión, no producción

## Alcance e identidad

Repositorio: edgarsegundocaceres-ctrl/rest-vendedores. Supabase auditado en lectura: gajlmcqaylezudttoaju. Rama: work/motor-precios-hogar-celulares, desde main a75ac4cac44d48dc9d17350f00436089b8dfefbc. No incorpora PR5 de analítica. No merge ni deployment productivo, no migración aplicada a producción.

## Auditoría y condición de activación

El cálculo vigente partía de productos.precio_contado: 6 cuotas = contado × (1 + 0,095 × 6); 9 = contado × (1 + 0,11 × 9). productos_costos ya existe y su costo no tiene moneda USD. El inventario auditado encontró 142 productos Hogar y 127 Celulares, sin registros correspondientes en productos_costos. No se dedujeron costos desde precios ni se cargaron costos reales.

**No activar con costos faltantes:** el motor rechaza cotizaciones sin costo y excluye esos productos del catálogo cotizable. Aplicar la migración ahora, sin preparar una carga autorizada de costos y Dólar REST, dejaría sin productos Hogar/Celulares cotizables. La lista posterior de celulares no resuelve por sí sola los costos ARS de Hogar. La revisión y carga reales son una etapa posterior autorizada.

## Arquitectura

Se corrige private.calcular_cotizacion_producto y se reutilizan cotizar_producto, calcular_presupuesto_rest, crear_presupuesto_vendedor, catálogo público, solicitudes_venta, presupuestos y conversión existente. No hay motor financiero nuevo.

- Hogar reutiliza productos_costos.costo (ARS).
- Celulares agrega costo_proveedor_usd nullable; costo ARS anterior se conserva sin reinterpretarlo.
- private.dolar_rest_celulares guarda valor manual, fecha y administrador. Inicialmente sin valor: no se inventa una cotización.
- private.motor_precios_auditoria guarda cambios y snapshots económicos privados inmutables. No hace backfill.
- productos.precio_contado queda como proyección compatible: triggers lo derivan del costo. Actualizar Dólar REST sincroniza únicamente precios vigentes con costo USD válido. No se actualiza ningún precio durante la instalación.
- La categoría económica de un producto existente no puede cambiarse entre monedas: requiere un producto de la categoría correcta para preservar históricos.

Administración → Administrar catálogo → Dólar REST · Celulares permite leer/actualizar el dólar con fecha/usuario. Cada producto Hogar/Celulares tiene botón COSTO ARS/USD; el formulario de alta solicita costo, no contado independiente.

## Reglas y redondeo

Celulares: base = (proveedor USD + 10) × Dólar REST. Contado = base × 1,40; 6 total = base × 2,50; 9 total = base × 3,20. Hogar: base = costo ARS; contado = base × 1,60, mismos multiplicadores financiados. No se modifica Tarjeta Sol ni reglas de anticipos auxiliares; ahora consumen el contado central.

Numeric en PostgreSQL; costo USD y dólar admiten hasta cuatro decimales. Base mantiene precisión; totales se redondean a dos decimales. Cuota nominal = round(total/n,2). Última = total − nominal × (n−1). Se reutiliza el ajuste de última cuota del módulo financiero.

| Ejemplo | Contado | Total 6 | Cuota nominal 6 | Última 6 | Total 9 | Cuota nominal 9 | Última 9 |
|---|---:|---:|---:|---:|---:|---:|---:|
| USD300 + USD10, dólar1500 | 651000 | 1162500 | 193750 | 193750 | 1488000 | 165333,33 | 165333,36 |
| Hogar ARS500000 | 800000 | 1250000 | 208333,33 | 208333,35 | 1600000 | 177777,78 | 177777,76 |

Con dólar1550: base celular480500, contado672700, total6 1201250, total9 1537600. La solicitud guardada a1500 conserva total9 1488000.

## Snapshots y nuevas ventas

Presupuestos y solicitudes conservan sus snapshots comerciales. Los costos, USD10, dólar y base ARS se guardan en auditoría privada, sin exponerlos al público ni al vendedor. Al convertir, se copia la condición económica de la solicitud/final autorizada; no se toma el dólar nuevo. La conversión reutiliza el motor financiero y asigna primer vencimiento al día operativo de la nueva venta para planes marcados al_inicio, sin registrar un pago ficticio. El cobro efectivo sigue correspondiendo al módulo de cobranzas.

El Portal Vendedor ya no inserta ventas con importes libres: envía una solicitud validada contra el motor. Administración la revisa en Solicitudes y la convierte explícitamente. Los importes manipulados o cotizaciones desactualizadas se rechazan. No cambia comisiones históricas. Los RPC de edición no sobrescriben condiciones de solicitudes ya guardadas; Administración puede definir condiciones finales en el flujo existente.

## Seguridad

RPC de dólar/costo/inspección requieren auth.uid() y es_admin() en backend. Tablas económicas privadas sin grants públicos, RLS en costos y nuevas tablas. Funciones SECURITY DEFINER con search_path vacío y privilegios explícitos. Público recibe únicamente precios/planes finales. Vendedor no modifica costos, dólar ni importes; se bloquea INSERT directo a ventas y solicitudes para evitar saltarse la validación. ADMIN conserva permisos operativos.

Bloqueo advisory transaccional compartido al cotizar y exclusivo al actualizar costo/dólar evita mezclar valores dentro de una operación. No se afirma que PGlite demuestre concurrencia entre conexiones PostgreSQL distintas: esa comprobación nativa queda como gate de publicación.

## Migración

Única nueva: supabase/migrations/20261013140257_motor_precios_hogar_celulares.sql. No modifica migraciones históricas. No aplicada a producción. Antes de aplicar: comparar objetos y funciones contra Supabase real actualizado; resolver el registro externo de la migración financiera 20261012213147 respecto del archivo histórico local, sin ejecutarla nuevamente. Preparar carga autorizada de costos/dólar y revisar disponibilidad del catálogo.

## Pruebas

- 24 verificaciones PostgreSQL del motor e integración: ambos ejemplos, dólar nuevo, snapshots, costos privados, permisos ADMIN/vendedor/anon, cotización obsoleta, presupuesto, solicitud, conversión, primera cuota y conservación de cuentas/cuotas existentes.
- 79 controles financieros existentes con la nueva migración instalada y costos exclusivamente TEST: pagos, imputaciones, parcial, idempotencia, sobrepago, anulación, auditoría, permisos y conversión.
- UI real del nuevo módulo → RPC → PostgreSQL: dólar ADMIN, moneda de costo, cotización vendedor, doble clic sin solicitud duplicada.
- UI financiera → RPC → PostgreSQL: parcial, dos cuotas, fecha anterior, doble clic, anulación, agenda/ficha/recibo.
- 53 tests JS existentes.
- DOM catálogo, ficha, formulario, confirmación, Administración y vendedor.

Reproducir con PGLITE_MODULE_DIR y JSDOM_MODULE_DIR apuntando a node_modules con @electric-sql/pglite y jsdom:

```sh
node --test tests/*.test.js
node tests/motor-precios.test.cjs
node tests/motor-precios-ui.cjs
node tests/motor-precios-finance-regression.cjs
MOTOR_FINANCE_UI=1 node tests/motor-precios-finance-regression.cjs
node tests/ui-dom-smoke.cjs
```

## Preview y pendientes

motor-precios-preview.html ejecuta las mismas migraciones y RPC en PostgreSQL efímero dentro de la pestaña; solo fixtures identificados TEST. No importa Supabase ni credenciales. Permite cambiar dólar, comparar Hogar/Celular, enviar solicitud y aprobar/convertir mostrando cronograma. Recargar elimina la base efímera.

Pendientes antes de merge/publicación: revisión de Edgar; costos reales de ambas categorías y dólar autorizado; ensayo de migración sobre staging equivalente a producción, pruebas nativas de concurrencia y Auth real, coordinación con PR5 de analítica (archivos compartidos, ramas independientes). La página principal del deployment no tiene el backend productivo migrado: utilizar el enlace explícito al preview aislado.

No se cargó nueva lista de costos. No se recalcularon operaciones, cobranzas ni snapshots históricos. G-CRED y APP INTEGRAL REST MOTOS no modificados. No publicado en producción; detener antes del merge.
