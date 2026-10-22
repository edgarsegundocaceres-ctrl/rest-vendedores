# Cuotas comerciales iguales en múltiplos de $100

Estado: preparado para revisión; migración NO aplicada a producción.
Rama: work/cuotas-multiplos-100, basada en main 117fd0df7ee875b79c5378937c357be8c6509070.

## Auditoría y alcance
El motor publicado redondeaba a dos decimales en private.base_comercial_producto y public.calcular_presupuesto_rest. Crédito personal conservaba un total teórico y ajustaba la última cuota. Catálogo consumía private.opciones_catalogo_producto. Presupuestos, solicitudes y venta pendiente del vendedor ya validaban importes en backend.

La migración incremental 20261022121122_cuotas_comerciales_multiplos_100.sql añade private.cuota_comercial_100 y private.plan_cuotas_comerciales, y actualiza únicamente las tres funciones anteriores. Sin escrituras de datos ni cambios de costos, dólar, multiplicadores, permisos públicos o tablas financieras.

Cuota = ceil(total matemático a financiar / cantidad / 100) × 100, calculada con numeric, antes de redondeos intermedios a centavos. Total final = cantidad × cuota. Cuando existe anticipo, total operación = anticipo + cantidad × cuota; el anticipo mantiene su tratamiento previo. Ultima_cuota se conserva en el contrato JSON para compatibilidad, ahora igual a cuota. Política identificada en planes/snapshots como arriba_100_v1.

Se aplica a nuevas cotizaciones de Hogar y Celulares: crédito personal 6/9, anticipo mensual/semanal y Tarjeta Sol. No incluye otras categorías ni APP INTEGRAL REST MOTOS. No se cambia la comisión porcentual, aunque el importe de futuras comisiones puede variar al variar el total de venta.

## Transición híbrida
Celulares con USD siguen usando el motor aprobado. Celulares sin USD y todo Hogar conservan su contado y fórmula base legacy (1,57 en 6; 1,99 en 9). Se agrega solo el redondeo explícitamente autorizado, no se infieren costos ni se activa Hogar desde costo.

Aumento respecto del total matemático: de $0 a menos de $100 por cuota; en 6 cuotas menos de $600 y en 9 menos de $900. Debe comunicarse el total comercial, no el teórico. El ejemplo de control resulta 6 × $277.800 = $1.666.800 y 9 × $237.000 = $2.133.000; incrementos de $550 y $200 respectivamente. Contado sin cambios.

## Históricos y primera cuota
No se modifican ventas, presupuestos, solicitudes, cuotas, pagos, cuentas, recibos, comisiones ni snapshots guardados. La conversión de una solicitud anterior sigue usando su snapshot, incluso si conserva centavos y última cuota distinta. Las nuevas solicitudes generan cuotas iguales sin modificar el generador financiero. Cuando primera_cuota=al_inicio, el anticipo esperado de la venta pendiente utiliza el mismo importe comercial; no se crea un pago ficticio.

## Interfaz
Catálogo, Portal Vendedor, ficha ADMIN y presupuesto ocultan la leyenda de última cuota cuando coincide con las demás. Formato sin decimales para importes enteros; los históricos con centavos conservan precisión y explicación de última cuota. Service worker versionado v1.6.4-cuotas-100.
Preview motor-precios-preview.html reutiliza PostgreSQL efímero y aplica la nueva migración solo en memoria. No usar la pantalla de login normal del preview para probar el cambio pendiente en producción.

## Validación reproducible
Dependencias externas al repositorio: @electric-sql/pglite 0.3.14 y jsdom 26.1.0.

```
PGLITE_MODULE_DIR=/ruta/node_modules node tests/cuotas-100.cjs
PGLITE_MODULE_DIR=/ruta/node_modules node tests/cuotas-100-finance-regression.cjs
node --test tests/*.test.js
JSDOM_MODULE_DIR=/ruta/node_modules node tests/ui-dom-smoke.cjs
VERCEL_ENV=preview node scripts/build-static.cjs
```

Tests de redondeo: cuatro ejemplos solicitados, precisión antes de centavos, planes 6/9 nuevo y legacy, anticipo mensual/semanal, tarjeta, catálogo anónimo, presupuesto, solicitud/conversión/cuotas, primera al inicio, venta pendiente, rechazo de cuota manipulada, snapshots anteriores y representación DOM real contra RPC TEST. Regresión financiera: suite existente de 79 controles sobre la migración nueva. No pruebas ni escrituras productivas.

Antes de producción: autorización de Edgar, aplicar exclusivamente esta migración y publicar juntos backend/frontend; verificar canales productivos. No reaplicar PR6 ni Fase2. Se mantiene la limitación previa de generación automática de cuentas/cuotas al aprobar ventas pendientes directas del vendedor.
