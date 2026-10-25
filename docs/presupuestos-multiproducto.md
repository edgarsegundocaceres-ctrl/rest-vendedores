# Presupuestos multiproducto y multiopción REST

Base auditada: main `1006198cb5d29db0664409c4e5b1d0a15ab825f7`, PR #8 ya publicado y sin modificaciones a su corrección. Supabase REST `gajlmcqaylezudttoaju` se consultó SOLO para leer funciones y columnas. No se aplicó esta migración allí.

## Auditoría
- `presupuestos` ya persiste un producto/una modalidad y `condiciones_snapshot`. RLS: vendedor propio o ADMIN, sin escritura directa del vendedor.
- “Presupuesto rápido” era una lista de nombres/precios para texto; no era financiación multiproducto.
- `calcular_presupuesto_rest`, `cotizar_producto`, `private.base_comercial_producto`, `private.plan_cuotas_comerciales` son la autoridad actual.
- Crédito personal: NUEVO MOTOR 6/9 desde costo convertido (2,50/3,20), primera al inicio; LEGACY 6/9 desde contado (1,57/1,99), sin primera al inicio.
- Anticipo mensual real: mínimo 40% contado, saldo × (1 + 0,075 × N), N=6/9/12. Semanal: mínimo 35%, tasa 0,0105, N=12/16/20. Anticipo adicional + N cuotas redondeadas; no primera cuota duplicada.
- Tarjeta Sol: coeficientes existentes para 2–12, 18 y 24 cuotas.
- `ventas` no tiene detalle normalizado multiproducto. Conserva nombre agregado; el detalle estructurado y alternativa se conservan en presupuesto y auditoría privada vinculados a la venta.
- Comisión se genera por el trigger existente sobre total comercial, porcentaje existente; no se modifica.

## Diseño
Una migración incremental: `20261025033232_presupuestos_multiproducto_multiopcion.sql`.
No tablas paralelas: nueva columna `presupuestos.solicitud_emision_id` + índice único por vendedor. Snapshot versión 2 incluye items, cantidades, precios oficiales, todas las alternativas y nombre/id del vendedor. Columnas escalares son proyecciones de compatibilidad de la primera alternativa, no sumas de alternativas; lectores nuevos muestran cada opción.

El helper central de cuotas ahora conserva también `total_sin_redondear`; no se invierte ninguna fórmula ni se suman cuotas redondeadas. El conjunto suma los totales oficiales anteriores al redondeo por cantidad y llama una vez a `cuota_comercial_100`. Los coeficientes Sol se extraen a un único helper utilizado por el RPC individual y el conjunto. No cambian valores ni reglas de cotizaciones individuales.

RPC nuevas:
- `opciones_presupuesto_multiple`: opciones comunes realmente habilitadas, mínimos de anticipo, aviso mixto; sin costos ni tasas internas.
- `cotizar_presupuesto_multiple`: revisión oficial, sin escritura.
- `crear_presupuesto_multiple`: emite snapshot con idempotencia y auditoría privada de bases económicas; vuelve a calcular al emitir.
- `clientes_presupuesto_multiple`: únicamente clientes propios o con ventas del vendedor.
- `convertir_presupuesto_multiple`: exige alternativa y cliente existente propio; bloquea fila, crea una venta pendiente y vínculo; reintentos iguales devuelven la misma venta, opción/cliente distintos se rechazan. No recalcula condiciones emitidas.

RLS existente preservada. Todas las RPC validan identidad/rol; funciones privadas revocadas a anon/authenticated, snapshots públicos no incluyen costos/USD/márgenes. Antiguo vínculo administrativo rechaza versión 2 para no omitir selección de alternativa.

## Combinación de motores
- Contado mixto: suma de contados oficiales.
- Crédito personal mixto: BLOQUEADO. Falta definir comercialmente la condición de primera cuota y base conjunta; no se presupone ni uniforma.
- Anticipo mensual/semanal mixto: se permite únicamente cuando tasas y cantidades habilitadas coinciden; suma mínimos oficiales de cada unidad. Usa el saldo conjunto con la misma regla existente, redondeando una vez. Si las condiciones difieren, falla cerrado.
- Sol mixto: mismo coeficiente central para contado conjunto.

## UI y compartir
Portal → Catálogo → AGREGAR A PRESUPUESTO → cantidades/quitar → ELEGIR FORMAS DE PAGO → revisar → emitir. Una o varias de 22 alternativas actuales; importe de anticipo adicional editable, importes oficiales nunca editables. Imagen PNG y WhatsApp en texto reutilizan funciones de compartir; imagen de altura adaptable contiene TODOS los productos y opciones. Historial de vendedor y Administración entiende versión 2. No se altera presentación de presupuestos previos.

## Conversión y límites explícitos
Seleccionar opción aceptada y cliente existente antes de confirmar una única venta pendiente. Crear clientes nuevos continúa en el circuito existente: no se agregó alta dentro del presupuesto. El presupuesto conserva todos los productos aunque `ventas.producto` siga siendo texto; trazabilidad completa en snapshot/auditoría. La limitación previa de no generar automáticamente cuenta/cuotas al aprobar una venta directa pendiente del vendedor no se resuelve aquí. No registrar pagos desde esta función.

Se preserva la condición del presupuesto dentro de su vigencia (Argentina), incluso si cambian costos/dólar; al vencer debe emitirse uno nuevo. No se recalculan históricos. Presupuesto no es cobro ni reserva de stock.

## Validación
Datos ficticios exclusivamente en PostgreSQL PGlite descartable:
- `tests/presupuestos-multiple.cjs`: 28 grupos, uno/dos productos, 1/2 unidades, nuevo/legacy, contado/6/9 y multiopción, redondeo agregado (caso distinto de suma de cuotas individuales), todas las modalidades, mixto permitido/bloqueado, primer pago, rechazo manipulación, snapshot ante cambios costo/dólar, idempotencia, opción obligatoria, una venta, comisión única, rollback forzado, anon/usuario ajeno e históricos.
- `tests/presupuestos-multiple-ui.cjs`: UI real → RPC → PostgreSQL, cantidades, 22 opciones, tres seleccionadas, emisión, texto, conversión y quitar.
- `tests/presupuestos-multiple-finance-regression.cjs`: 79 controles Fase 2 sobre esquema NUEVO.
- Regresiones previas: PR8 cuatro recorridos, PR7 32 controles, 53 tests catálogo/captación/cobranzas.
- Se actualizó una expectativa obsoleta del test de versión service worker; caché nueva incluye recursos del módulo.

Comando: `PGLITE_MODULE_DIR=/ruta/absoluta/node_modules node tests/presupuestos-multiple.cjs` (PGlite y jsdom del entorno TEST).

Preview: `/presupuestos-multiple-preview.html`, UI/RPC/migraciones reales con fixtures ficticios, PostgreSQL en memoria, sin Supabase. Recargar descarta datos. No reemplaza validación Auth real ni concurrencia entre conexiones nativas: pendientes antes de producción. No pruebas en WebView nativo Android/WhatsApp/Facebook.

No merge, no publicación productiva, no modificación de PR8, REST Motos, G-CRED, costos, dólar, comisiones ni operaciones históricas.
