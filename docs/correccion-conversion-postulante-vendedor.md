# APP INTEGRAL REST — Corrección Postulante → Vendedor

Fecha de actualización: 5 de octubre de 2026

Rama de consolidación: `fix/admin-vendedores-layout-copy-link`

Base: `origin/main` (`77d0eef`)

Repositorio: `edgarsegundocaceres-ctrl/rest-vendedores`

## Alcance

Corrección puntual del circuito de captación de vendedores de **APP INTEGRAL REST**. No incluye cambios de catálogo, precios, financiación, clientes, ventas, cobranzas ni otros módulos. **APP INTEGRAL REST Motos no fue consultada ni modificada.**

## Diagnóstico confirmado

El botón **APROBAR** ejecutaba únicamente:

```text
actualizar_postulante_vendedor(..., "aprobado", ...)
```

La RPC cambiaba el estado de la postulación, pero no insertaba ni vinculaba una fila en `vendedores`. La creación real quedaba para un segundo botón, **CREAR ACCESO Y VINCULAR**. Por eso el listado de vendedores —cuya consulta sí era correcta— no tenía ningún registro que mostrar.

El caso ya aprobado quedó exactamente en ese estado intermedio:

- postulación: `APROBADO`;
- `vendedor_id`: vacío;
- usuario Auth: inexistente;
- perfil/rol: inexistente;
- vendedor: inexistente.

Los registros de actividad de la API confirmaron que, al aprobar, se invocó `actualizar_postulante_vendedor`, pero no la función `crear-vendedor` ni `vincular_postulante_vendedor`.

## Comportamiento corregido

### Aprobar

La nueva RPC `aprobar_postulante_vendedor`:

1. bloquea la postulación durante la operación;
2. acepta `PENDIENTE`, `CONTACTADO` o un reintento en `APROBADO`;
3. reutiliza la tabla existente `vendedores`;
4. busca coincidencias fuertes por DNI o por email de un usuario Auth ya vinculado;
5. no vincula automáticamente por teléfono solamente;
6. crea, cuando corresponde, un vendedor provisional con `activo = false` y `user_id = null`;
7. vincula `postulantes_vendedores.vendedor_id`;
8. conserva la postulación y su historial;
9. devuelve el mismo vendedor ante un segundo clic, sin duplicarlo.

El registro aparece inmediatamente en **Administración → Vendedores** con la etiqueta **Pendiente de acceso**.

### Configurar acceso

La Edge Function versionada `crear-vendedor` conserva el alta manual histórica. Cuando recibe `postulante_id`:

1. comprueba que quien llama sea Administración;
2. comprueba que la postulación esté aprobada y tenga vendedor provisional;
3. crea el usuario mediante Supabase Auth;
4. ejecuta `activar_postulante_vendedor`;
5. la RPC crea/actualiza el perfil con rol `vendedor`, completa el mismo registro de `vendedores` y cambia la postulación a `ACTIVO` o `SUSPENDIDO` dentro de una sola transacción;
6. si la transacción falla, elimina el usuario Auth recién creado para evitar un alta parcial.

No existe una columna de contraseña y la contraseña no se registra en logs ni tablas.

### Vendedor ya existente

`vincular_postulante_vendedor` ahora:

- exige un usuario real con perfil de rol `vendedor`;
- activa perfil y vendedor juntos;
- conserva el vendedor ya preparado y no lo reemplaza silenciosamente;
- admite reintentos sin crear duplicados.

## Archivos

- `captacion-vendedores.css`
- `captacion-vendedores.js`
- `index.html`
- `sw.js`
- `supabase/migrations/20261004145535_fix_postulante_vendedor_conversion.sql`
- `supabase/functions/crear-vendedor/index.ts`
- `tests/recruitment-budget.test.js`

## Pruebas y verificaciones

- 19 pruebas automáticas de JavaScript, responsive y contratos de seguridad: correctas.
- Sintaxis de `captacion-vendedores.js` y scripts embebidos: correcta.
- Migración completa ejecutada dentro de `BEGIN … ROLLBACK`: correcta.
- Postulación ficticia → aprobación → vendedor provisional: correcta.
- Segunda aprobación: devolvió el mismo `vendedor_id` y no duplicó el historial.
- Reutilización de un vendedor real con Auth/rol dentro de rollback: correcta.
- Vínculo y activación idempotentes dentro de rollback: correctos.
- Caso aprobado preexistente: reparado y vinculado a un vendedor pendiente de acceso sin duplicar.
- Verificación posterior: funciones de prueba y datos ficticios no quedaron persistidos.
- `git diff --check`: correcto.
- Preview separado desplegado desde la rama de consolidación: correcto.
- Página pública de captación verificada en navegador: carga completa y formulario disponible en modo demostración.
- Administración verificada en navegador: al aprobar, conserva la ficha original, muestra `APROBADO`, crea el bloque **Vendedor vinculado**, etiqueta al vendedor como **Pendiente de acceso** y ofrece **CREAR ACCESO SEGURO**.
- La tarjeta **Vendedores REST** y sus pestañas se adaptan a escritorio y a los breakpoints móviles sin superposición ni scroll horizontal.
- **COPIAR LINK PÚBLICO** conserva la pantalla actual, copia la URL pública canónica y muestra **Link copiado**; incluye fallback para navegadores sin Clipboard API.
- No se registraron errores propios de la aplicación en la consola del preview.

## Estado de publicación

La migración `20261004145535_fix_postulante_vendedor_conversion` ya está registrada en el proyecto Supabase de APP INTEGRAL REST. La Edge Function `crear-vendedor` está activa con verificación JWT. No se debe volver a ejecutar la migración ni repetir la reparación del registro existente.

La prueba real de postulación, aprobación, creación de acceso, activación, login como vendedor, generación de presupuesto y atribución al vendedor fue satisfactoria. Las políticas RLS y las funciones administrativas continúan exigiendo el rol correspondiente.

La consolidación del frontend y su despliegue deben realizarse desde la rama indicada, después de verificar las diferencias y las pruebas, mediante el flujo normal del repositorio y Vercel.
