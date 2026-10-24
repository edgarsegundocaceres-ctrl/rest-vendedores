# Primera cuota al cargar venta — corrección posterior a PR #7

Base: main 3c98b85d4d6900757e51e2e3a1b5a942885b09d4. No requiere migración.

## Causa y alcance
`index.html:loadQuoteIntoSale` copiaba `currentQuote.down` a `down.value`.
`motor-precios.js:quote` recibe del RPC `calcular_presupuesto_rest` `down=0` para crédito personal: no hay anticipo adicional. La primera cuota se expresa en `primera_cuota=al_inicio` y `value`. El mismo error de presentación existe en main anterior al PR #7 (117fd0d), por lo que no fue introducido por el redondeo.

`RESTPrecios.initialPayment` selecciona el valor oficial de cuota cuando `primera_cuota` es exactamente `al_inicio`; para los demás planes conserva `down`. El formulario permanece bloqueado. No recalcula fórmulas económicas.

## Flujo completo y contrato backend
- Cotización: RPC oficial; cuota, total y condición al inicio conservados.
- Presupuesto: `crear_presupuesto_vendedor` recibe anticipo adicional cero, guarda total/cuota/condición en snapshot. No convertir primera cuota en anticipo adicional.
- Formulario: muestra cuota oficial como importe inicial si corresponde.
- Payload: conserva `anticipo=0`, `valor_cuota=X`, `cantidad_cuotas=N`, `monto_total=N*X`. Son conceptos distintos, no un importe perdido.
- `registrar_venta_catalogo` recotiza y valida los importes. Ya escribe `ventas.anticipo_esperado=X` cuando `primera_cuota=al_inicio`. Cambiar el payload a `anticipo=X` sería incorrecto y el backend lo rechaza.
- La venta permanece pendiente, sin registrar cobros. La limitación previa de no generar cuenta/cuotas automáticamente al aprobar ventas directas del vendedor se conserva.
- La conversión de solicitud pública sí genera cuenta/cuotas desde el snapshot; la suite PR #7 comprueba N cuotas iguales y primera al inicio cuando corresponde.
- Comisión: trigger vigente al entregar, porcentaje sin cambios; aplicada sobre total N*X, una sola comisión por venta. No sumar X al total.

## Casos TEST ficticios, dólar 1550
| Motor | Cuotas | Cuota | Inicial | Total | Comisión 5% |
|---|---:|---:|---:|---:|---:|
| Nuevo, costo USD 420 | 6 | 277800 | 277800 | 1666800 | 83340 |
| Nuevo, costo USD 420 | 9 | 237000 | 237000 | 2133000 | 106650 |
| Legacy, contado 140000 | 6 | 36700 | 0 | 220200 | 11010 |
| Legacy, contado 140000 | 9 | 31000 | 0 | 279000 | 13950 |

Los planes legacy actuales NO indican primera al inicio. Conservar cero en esos casos es intencional; no se cambia su condición económica. La función selecciona X para cualquier plan que sí indique al_inicio.

## Validación
`tests/primera-cuota-venta.cjs` carga las funciones UI reales `qshow`, `loadQuoteIntoSale`, `RESTPrecios.quote/submit` y RPC/triggers en PostgreSQL PGlite aislado. Verifica formulario readonly, presupuesto, payload capturado, venta pendiente, snapshot, rechazo de importe manipulado/anticipo adicional indebido, entrega y comisión única, históricos sin cambios.
Ejecutar con PGLITE_MODULE_DIR apuntando al directorio externo de dependencias.
`tests/cuotas-100.cjs`: 32 controles de redondeo, catálogo, presupuesto, solicitud/conversión, cuentas/cuotas, históricos.
`tests/cuotas-100-finance-regression.cjs`: 79 controles financieros.

## Preview y publicación
`/primera-cuota-preview.html` usa PGlite en memoria, fixtures ficticios y las mismas funciones UI y migraciones. No usa Supabase ni autentica usuarios reales. Permite calcular 6/9, cargar el formulario, generar presupuesto y enviar venta TEST; muestra la fila/snapshot resultante. Recargar descarta todo.
Archivos preview excluidos del build de producción. Service worker actualizado para que la corrección futura reemplace el shell anterior. No se aplicaron migraciones ni cambios productivos. Esperar autorización antes del merge/publicación.
