# APP INTEGRAL REST — Captación de vendedores y presupuestos comerciales

## Alcance y proyecto

- Repositorio: `edgarsegundocaceres-ctrl/rest-vendedores`.
- Proyecto Supabase auditado: `gajlmcqaylezudttoaju` (`REST Vendedores`).
- Proyecto Vercel: `rest-vendedores`.
- Rama de trabajo: `work/captacion-vendedores-presupuestos`.
- Rama base verificada: `work/modulo-financiero-fase2`, commit `2483ede`.
- `main`, la URL pública y producción no se modifican.
- REST Motos no forma parte del cambio. No se aplican planes, entregas pactadas, contratos ni datos de esa aplicación.

## Estado inicial auditado

La aplicación ya incluía:

- autenticación de Supabase y roles `admin`, `vendedor` y repartidor;
- tabla y portal existente de vendedores;
- funciones seguras `crear-vendedor` y `gestionar-vendedor`;
- catálogo con productos, precios e imágenes;
- RPC `cotizar_producto`, que calcula las condiciones vigentes;
- flujo de solicitudes de venta para Hogar y Celulares;
- ventas, comisiones, oportunidades, referidos y logística;
- calculadora del catálogo y una acción de WhatsApp sólo en texto.

No existían tablas ni flujos para:

- postulaciones públicas de vendedores;
- contenido administrable de captación;
- historial de estados del postulante;
- presupuestos persistentes con snapshot histórico.

## Funcionalidades agregadas

### Página pública

Ruta de la candidata:

```text
/?postularme=1
```

Incluye:

- landing mobile-first con identidad REST;
- explicación de propuesta, herramientas, modalidades y comisiones;
- canales de venta y preguntas frecuentes;
- formulario de postulación;
- validación de DNI, teléfono, email y campos obligatorios;
- campo trampa antispam;
- confirmación sin creación de usuario ni rol.

El contenido comercial se obtiene mediante `obtener_programa_vendedores_publico()`. Si la migración aún no está instalada, la candidata muestra contenido seguro de respaldo y avisa que es una vista preliminar.

### Administración

Dentro de **Vendedores** se agregan:

- Vendedores activos;
- Postulantes;
- Presupuestos;
- Contenido público.

La ficha del postulante permite:

- ver todos los datos enviados;
- registrar observaciones internas;
- registrar condiciones de comisión;
- marcar como contactado;
- aprobar o rechazar;
- crear el acceso mediante la función existente `crear-vendedor`;
- vincular un vendedor ya existente para evitar duplicados;
- suspender o reactivar mediante `gestionar-vendedor`;
- consultar la trazabilidad de estados.

Las contraseñas provisorias se generan con Web Crypto, se envían a Supabase Auth y nunca se almacenan en las tablas nuevas.

### Portal del vendedor

Después de calcular una condición vigente para un producto de Hogar o Celulares, aparece:

```text
GENERAR PRESUPUESTO + IMAGEN
```

El presupuesto:

- vuelve a validar producto, categoría, precio y plan en el servidor;
- reutiliza `cotizar_producto`;
- no acepta un total ni precio enviado por el frontend;
- conserva nombre, categoría, imagen, precio contado, modalidad, anticipo, cuotas, total y vigencia;
- queda asociado al vendedor autenticado;
- permite prospecto opcional;
- aparece en **Mis presupuestos**.

La imagen comercial:

- se genera a 1080 × 1350 px;
- usa la foto del catálogo;
- incluye REST, producto, condición, total, código, vigencia y vendedor;
- puede compartirse con el menú nativo o descargarse como PNG;
- ofrece además texto directo para WhatsApp.

El navegador no permite adjuntar automáticamente una imagen a un chat específico de WhatsApp. En dispositivos compatibles, **Compartir imagen** abre el menú nativo y el usuario elige WhatsApp, Estados u otra aplicación. El botón **WhatsApp** abre un mensaje preparado en texto.

No se agregó PDF porque el módulo actual no generaba PDF y el alcance corregido lo dejó condicionado a que ya existiera. La salida nueva de esta etapa es la imagen comercial.

## Migración preparada, no aplicada

Archivo:

```text
supabase/migrations/20261003175908_captacion_vendedores_presupuestos.sql
```

Tablas nuevas:

| Tabla | Finalidad |
|---|---|
| `programa_vendedores_config` | Contenido administrable de la landing |
| `postulantes_vendedores` | Solicitud y estado administrativo |
| `postulantes_vendedores_historial` | Auditoría inmutable de estados |
| `presupuestos` | Snapshot histórico y trazabilidad comercial |

Funciones nuevas:

| Función | Acceso |
|---|---|
| `obtener_programa_vendedores_publico` | Público, sólo lectura de contenido permitido |
| `enviar_postulacion_vendedor` | Público, sólo crea una postulación validada |
| `actualizar_programa_vendedores` | Administración |
| `actualizar_postulante_vendedor` | Administración |
| `vincular_postulante_vendedor` | Administración |
| `calcular_presupuesto_rest` | Vendedor habilitado o Administración |
| `crear_presupuesto_vendedor` | Vendedor habilitado |
| `vincular_presupuesto_venta` | Administración |

La migración fue ejecutada completa dentro de `BEGIN … ROLLBACK` para validar sintaxis. En la misma transacción se probó una postulación ficticia, su deduplicación, los estados `CONTACTADO` y `APROBADO`, la vinculación con la estructura existente de vendedores y la creación de un presupuesto de contado con un producto real. Después se comprobó que las cuatro tablas continuaban inexistentes en la base activa. No se modificaron datos ni esquema de producción.

## Seguridad

- RLS activa en las cuatro tablas.
- `anon` no tiene lectura directa de ninguna tabla nueva.
- El formulario público sólo puede ejecutar una función con parámetros limitados.
- La respuesta ante duplicados es genérica para no revelar datos existentes.
- DNI y email evitan postulaciones activas duplicadas; el teléfono también se comprueba en la función.
- Sólo Administración puede leer postulantes, historial y configuración interna.
- Cada vendedor sólo puede leer sus propios presupuestos.
- El cálculo persistido acepta únicamente categorías `hogar` y `celulares`.
- El servidor obtiene el precio de `productos` y recalcula el plan con `cotizar_producto`.
- No existe columna de contraseña en las tablas nuevas.
- El historial de postulantes es inmutable.
- No se conceden permisos destructivos a `anon` ni `authenticated`.

## Pruebas

Comando:

```bash
node --test tests/finance-module.test.js tests/recruitment-budget.test.js
```

Resultado local:

- 55 controles previos del módulo financiero: correctos.
- 13 pruebas nuevas: correctas.
- análisis sintáctico de JavaScript: correcto;
- IDs del DOM: 336 únicos;
- `git diff --check`: correcto;
- migración completa en rollback: correcta;
- circuito funcional dentro del rollback: correcto;
- comprobación posterior de ausencia de tablas: correcta.

Casos cubiertos por las pruebas nuevas:

- postulación válida y campos opcionales;
- rechazo de DNI, teléfono, email, motivación y canales inválidos;
- contraseña provisoria con Web Crypto;
- ruta pública antes del inicio autenticado;
- reutilización de `crear-vendedor`;
- exclusión de reglas de REST Motos;
- recálculo de precio en servidor;
- RLS, revocaciones y ausencia de lectura anónima;
- ausencia de creación automática de vendedor;
- snapshot, vendedor y conversión futura del presupuesto;
- recursos nuevos en el service worker.

## Instalación futura en un entorno de prueba

La migración debe aplicarse solamente a una rama/base de Supabase de prueba autorizada. Después:

1. desplegar esta rama a un preview de Vercel;
2. abrir `/?postularme=1` sin sesión;
3. enviar una postulación ficticia;
4. ingresar como administrador y abrir **Vendedores → Postulantes**;
5. revisar, contactar, aprobar y activar;
6. ingresar con el vendedor de prueba;
7. abrir Catálogo, elegir un producto de Hogar o Celulares y calcular el plan;
8. generar, descargar y compartir la imagen;
9. verificar que **Mis presupuestos** conserve el snapshot;
10. confirmar que el vendedor no acceda a Administración.

## Pendientes deliberados

- Aplicar la migración a una base aislada de prueba: requiere autorización/entorno disponible.
- Ejecutar el circuito real de alta y persistencia: depende de esa migración.
- Vincular visualmente un presupuesto con una venta desde Administración; la función y columnas ya quedan previstas.
- Rate limiting externo o CAPTCHA antes de una campaña pública de alto volumen.
- PDF formal: no existía previamente y no es obligatorio en el alcance corregido.

No se debe hacer merge a `main` ni promover a producción sin autorización expresa.
