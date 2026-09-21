# App Integral REST · Módulo financiero y cobranzas · Fase 2

Fecha de candidata: 21/09/2026  
Rama: `work/modulo-financiero-fase2`  
Base: `work/modulo-financiero-fase1` (`0931c0f` local; mismo contenido aprobado en la rama remota de Fase 1)

## Resultado de esta etapa

Se agregó un circuito administrativo de **simulación segura** para evaluar la futura registración de cobranzas sin escribir datos financieros.

Incluye:

- Simulación de cobro total de una cuota.
- Simulación de cobro parcial.
- Fecha y hora efectiva del pago de prueba, usando horario de Argentina.
- Medio de pago, referencia y observaciones.
- Validación contra importes nulos, negativos y superiores al saldo.
- Bloqueo de fechas efectivas futuras.
- Recibo de prueba imprimible con saldo anterior y saldo resultante.
- Marca visible `SIN VALIDEZ` y texto que aclara que el recibo no acredita un pago.
- Promesas de pago de prueba con fecha, importe, canal y observaciones.
- Resumen de cobros, recibos y promesas creados durante la sesión.
- Opción para borrar todas las pruebas sin afectar ningún registro real.

## Límites deliberados

Esta candidata no registra operaciones financieras reales.

- No inserta cobros.
- No actualiza `cuotas_credito.importe_pagado`.
- No actualiza `cuentas_credito.saldo_actual`.
- No crea números de recibo oficiales.
- No conserva promesas de pago al recargar o cerrar la página.
- No llama a una RPC de cobro.
- No modifica G-CRED.
- No importa cartera.
- No incorpora Motos.

Las pruebas se mantienen únicamente en memoria dentro de la pestaña abierta. La agenda continúa mostrando los valores reales consultados y presenta cualquier movimiento simulado en una leyenda separada.

## Seguridad de la candidata

El módulo continúa disponible únicamente dentro del panel autenticado de Administración. Las consultas siguen protegidas por las políticas RLS existentes.

El bloque financiero de `index.html` no contiene llamadas a:

- `insert`
- `update`
- `upsert`
- `delete`
- `rpc`

Por lo tanto, los botones nuevos no tienen una ruta técnica para modificar Supabase.

La rama `main`, la producción y la URL pública permanecen sin cambios.

## Comportamiento del cobro de prueba

1. Administración abre `Cobranzas`.
2. Elige un vencimiento con saldo pendiente.
3. Presiona `SIMULAR COBRO`.
4. Elige pago total o parcial.
5. Completa fecha efectiva, medio de pago y datos opcionales.
6. La pantalla calcula el saldo simulado resultante.
7. Se genera un recibo de prueba imprimible.
8. La agenda mantiene el saldo real y muestra por separado lo simulado en esa sesión.

Si se realizan varias pruebas sobre la misma cuota, el validador descuenta las pruebas anteriores de esa sesión para impedir un sobrepago simulado.

## Comportamiento de la promesa de prueba

1. Administración presiona `PROMESA DE PRUEBA`.
2. Indica fecha prometida, importe, canal y observaciones.
3. La fecha debe ser igual o posterior al día actual de Argentina.
4. El importe no puede superar el saldo todavía disponible dentro de la simulación.
5. La promesa aparece en `Pruebas de esta sesión` como borrador no persistido.

## Diseño previsto para la futura conexión

Antes de habilitar registraciones reales se propone una migración aditiva, todavía no creada ni aplicada, con estas responsabilidades:

| Componente futuro | Responsabilidad |
|---|---|
| Cobro | Cabecera inmutable con clave de idempotencia, fecha efectiva, importe, medio, referencia, usuario y estado. |
| Aplicación de cobro | Distribución exacta del cobro entre una o más cuotas. |
| Recibo | Número oficial y snapshot de los datos mostrados al momento de emitirlo. |
| Promesa de pago | Fecha, importe, canal, estado, seguimiento y usuario responsable. |
| Reversión | Corrección auditada que compense un cobro; nunca eliminación silenciosa. |
| Auditoría | Quién realizó cada acción, cuándo y sobre qué cuenta, cuota o cobro. |

La operación real deberá ejecutarse mediante una RPC transaccional e idempotente que:

1. verifique que el usuario sea Administración;
2. bloquee la cuota y la cuenta durante la operación;
3. impida sobrepagos y dobles envíos;
4. registre el cobro y su aplicación;
5. recalcule cuota y cuenta;
6. emita el número de recibo;
7. escriba la auditoría;
8. confirme todo junto o revierta todo ante un error.

Las tablas futuras deberán tener RLS activa. La aplicación no recibirá permisos directos de escritura sobre cobros o aplicaciones: la escritura quedará limitada a las RPC autorizadas.

## Pruebas automatizadas

`tests/finance-module.test.js` ejecuta 51 controles sobre las funciones reales de `index.html`.

Además de los controles de Fase 1, verifica:

- suma de cobros simulados por cuota;
- saldo simulado sin mutar el saldo real;
- pago parcial válido;
- proyección del saldo posterior;
- bloqueo de sobrepago;
- bloqueo de importe cero;
- bloqueo de fecha efectiva futura;
- bloqueo de medio de pago no permitido;
- bloqueo de cobro sobre una cuota anulada;
- promesa futura válida;
- bloqueo de promesa vencida;
- bloqueo de promesa superior al saldo;
- bloqueo de promesa sobre una cuota anulada;
- identificador de recibo de prueba;
- modo de simulación declarado;
- marca `SIN VALIDEZ`;
- ausencia de escrituras y RPC dentro del módulo;
- presencia de panel de acción, actividad de sesión y área de impresión;
- ausencia de identificadores HTML duplicados.

Comando:

```bash
node tests/finance-module.test.js
```

Resultado:

```text
OK: 51 controles del módulo financiero superados
```

## Guía de prueba para Edgar

1. Ingresar al enlace de preview con el usuario administrador.
2. Abrir `Cobranzas`.
3. Elegir una cuota con saldo pendiente.
4. Probar primero `SIMULAR COBRO` como pago parcial.
5. Revisar el saldo simulado y generar el recibo.
6. Abrir `VER RECIBO` y probar la impresión.
7. Volver a la misma cuota y probar el pago por el saldo restante.
8. En otra cuota, crear una `PROMESA DE PRUEBA`.
9. Revisar `Pruebas de esta sesión`.
10. Presionar `BORRAR PRUEBAS` y confirmar que la agenda real conserva los mismos saldos.

## Pendiente de autorización expresa

Después de la prueba visual y funcional, Edgar deberá decidir si autoriza una base de prueba aislada para validar persistencia, reversión, numeración de recibos y auditoría. No se debe aplicar ninguna migración al proyecto activo ni habilitar cobros reales hasta recibir esa autorización.
