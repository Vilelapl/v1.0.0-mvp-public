# Dashboard web del MVP

React 19.3.0, TypeScript 7.0.2 y Vite 8.3.0, conectado a los contratos de Express.
El despliegue público y la validación integral se documentan en el
[estado del proyecto](../ESTADO_PROYECTO.md).

## Requisitos y arranque

- Node.js 24 o superior y npm.
- PostgreSQL local y backend preparados según el README raíz: migración,
  bootstrap del propietario y seed de categorías.
- Navegador moderno con soporte de `dialog` (Chrome, Edge o Firefox actuales).

Desde `web/`:

```powershell
npm ci
Copy-Item .env.example .env
npm run dev
```

Abrir **http://127.0.0.1:5173**. Vite usa puerto fijo y falla si está ocupado,
para evitar que cambie silenciosamente el origen de autenticación.

En `backend/.env`, configurar `WEB_ORIGIN=http://127.0.0.1:5173` y el puerto
backend, normalmente `PORT=3000`. Iniciar el backend desde `backend/` con
`npm run dev`. Usar el mismo host en el navegador y en `WEB_ORIGIN`:
`localhost` y `127.0.0.1` son orígenes distintos. El ejemplo raíz usa
`localhost`; hay que ajustar ese valor para este comando de Vite.

## Variables

| Variable en `web/.env` | Predeterminado | Uso |
|---|---|---|
| `VITE_API_BASE_URL` | `/api/v1` | Prefijo público de la API |
| `API_PROXY_TARGET` | `http://127.0.0.1:3000` | Destino del proxy local, solo leído por Vite |

El proxy reenvía `/api` conservando `Origin`. No desactiva CORS, las comprobaciones
de origen ni las protecciones de cookie. No colocar contraseñas, tokens,
credenciales PostgreSQL ni claves privadas en variables `VITE_`.

`VITE_API_BASE_URL` también admite una URL completa; el backend debe permitir
exactamente el origen de la web. Para el desarrollo habitual se recomienda el
proxy anterior, con web y API vistas desde el mismo origen.

## Web en producción

Ejecutar `npm ci` y `npm run build` con `VITE_API_BASE_URL=/api/v1`; desplegar el
contenido de `dist/` como archivos estáticos. El servidor debe devolver
`index.html` para `/login` y `/dashboard`, y reenviar `/api/` al backend bajo el
mismo origen HTTPS. El proxy de Vite solo existe durante desarrollo y no se
incluye en `dist/`; `vite preview` sirve para revisar la compilación local.

Configuración del proxy, TLS, variables y checklist en la
[guía de producción](../docs/PRODUCCION.md) y su
[plantilla nginx](../deploy/nginx.conf.example).

## Sesión y cliente HTTP

- Al abrir la aplicación se consulta `GET /auth/me`; no se muestra el dashboard
  hasta conocer el resultado. Un error de conexión ofrece reintento y un 401
  lleva al login.
- Login usa email/contraseña y `POST /auth/login`; establece el usuario público
  devuelto. La cookie `HttpOnly` la administra exclusivamente el navegador.
- `POST /auth/logout` revoca la sesión. La interfaz vuelve al login y desmonta
  el estado financiero y los formularios. Un 401 financiero hace lo mismo.
- No hay tokens en JavaScript, localStorage ni sessionStorage; tampoco JWT o
  credenciales Android. No hay registro público.
- `src/api/client.ts` contiene la única llamada a `fetch`: GET, POST, PATCH,
  DELETE, `credentials: include`, JSON cuando hay cuerpo, `cache: no-store`,
  timeout de 15 segundos y cancelación mediante `AbortController`.
- `ApiError` recoge estado, código, detalles y requestId. La UI muestra mensajes
  seguros para validación, sesión, permisos, recurso inexistente, conflicto,
  límite de peticiones, error interno y problemas de conexión.

## Funcionalidad y límites del contrato

- Resumen de ingresos, gastos y balance de `/summary`, separado por moneda.
  `currency=null` aparece como **Moneda no especificada**, en un grupo independiente.
  El frontend no recalcula totales ni convierte monedas.
- El resumen inicia con **el mes calendario actual completo** en Lima: desde
  el día 1 a las 00:00 hasta el día 1 del siguiente mes exclusivo. La cabecera
  indica el mes y año; el período avanza automáticamente a medianoche y al
  regresar de una pestaña suspendida. Guardar movimientos o pulsar Actualizar
  recarga los totales. La lista general conserva su historial.
- Seleccionar fechas en Transacciones cambia el período del resumen; Limpiar
  vuelve al mes actual. Un período personalizado se conserva al cambiar de mes.
- Lista de `/transactions`, 20 por página, con anterior/siguiente, total y página.
  Muestra fecha/hora, descripción, monto/moneda, tipo, categoría, cuenta, fuente
  y procesamiento. Los gastos aparecen en rojo. Los IDs se usan internamente
  y no se presentan en la tabla.
- Filtros: días de Lima, categoría, tipo y nombre exacto de cuenta. Se envían
  únicamente `from`, `to`, `categoryId`, `type`, `account`, `page` y `pageSize`.
  Cambiar filtros reinicia la página. El formulario está dentro de Transacciones.
- El resumen general usa `from` y `to`; categoría, tipo y cuenta filtran
  únicamente la lista general. `/summary` también acepta `account` y `type`,
  usados por el resumen exclusivo de iO, y mantiene los totales en PostgreSQL.
- **Ciclo de facturación actual**, antes de Transacciones: solo movimientos
  `expense` de la cuenta exacta `IO crédito`, de todas sus fuentes, desde el
  día 26 a las 00:00 de Lima hasta el siguiente 26 exclusivo (día 25 completo).
  Cambia de ciclo automáticamente y al volver a la pestaña.
- El ciclo tiene filtros propios de fecha y categoría, restringidos al período,
  y paginación independiente. Su mini dashboard muestra **todos** los gastos
  del ciclo, aunque se filtre la lista o se cambie de página. Siempre separa
  PEN y USD, con cero cuando no hay gastos; otras monedas y `null` siguen
  separados. No hay conversión ni deduplicación entre fuentes.
- `/categories` alimenta los selectores. Alta y edición permiten **Sin categoría**
  con `null`. El backend no admite filtrar categorías por `null`, así que el
  filtro ofrece todas las categorías o una categoría existente, sin inventar
  un parámetro para buscar solo las no categorizadas.
- Alta manual con los siete campos autorizados. Los campos opcionales vacíos
  se envían como `null`. PATCH envía únicamente los campos modificados; guardar
  sin cambios no envía PATCH ni altera el procesamiento de una captura.
- Fuente y procesamiento son informativos: IO, Yape, Google Wallet y Manual;
  Automático, Modificado manualmente y Creado manualmente. El backend decide
  cualquier transición de estado.
- Lista y resumen se recargan juntos tras guardar; respuestas antiguas se
  cancelan/descartan al cambiar filtros o cerrar sesión. Ante una confirmación
  de guardado perdida por red/timeout se pide actualizar antes de reenviar.
- Estados de carga, error, vacío y éxito; formularios con etiquetas, foco,
  Escape, diálogo nativo y tabla desplazable horizontalmente en pantallas estrechas.

## Dinero y fechas

`amount` se conserva como string en DTOs, estado, formularios y transporte.
Se valida positivo, con hasta 12 enteros y 2 decimales. Para mostrarlo se
agrupan dígitos como texto, sin `Number`, `parseFloat` ni aritmética flotante.
El punto es el separador decimal del formulario.

Los timestamps UTC se presentan con `Intl.DateTimeFormat` y `America/Lima`.
`@js-temporal/polyfill` convierte días y fecha/hora locales a instantes usando
la zona IANA: no se suman/restan cinco horas manualmente. El filtro **Hasta**
incluye ese día y envía el inicio del día siguiente como `to` exclusivo.
La edición preserva segundos y milisegundos del instante original.
La etiqueta **Fecha / hora** no presupone que sea la hora exacta de la compra;
algunas capturas usan la hora de publicación de la notificación.

## Compatibilidad con Yape decimal — revisión del 14/09/2026

La corrección Android conserva el contrato existente: `amount` textual,
`type=income`, `currency=PEN`, `source=yape_notification`, descripción y cuenta
`null`. El backend admite enteros y uno o dos decimales, usa Decimal/NUMERIC y
devuelve dos decimales: `1.1` se presenta como `1.10` sin cambiar su valor.
No se requiere cambiar la lógica del dashboard ni convertir dinero a Number.

La lista muestra **Ingreso**, **Yape**, **Sin descripción** y **Sin cuenta**.
Para consultar estos ingresos se puede filtrar por Tipo=Ingreso y fechas;
el filtro Cuenta compara la cuenta exacta, por lo que escribir `Yape` no busca
la fuente. Dejarlo vacío permite incluir las capturas con cuenta null.

La fecha recibida es el `postTime` autorizado convertido a UTC; la web lo
presenta en Lima y conserva sus milisegundos al editar otros campos. El resumen
mensual incluye los ingresos sincronizados según esa fecha. El ciclo iO sigue
exclusivo de gastos de `IO crédito`, y no incluye los ingresos Yape.

Los contadores de Room (pendientes, reintento, sincronizadas) no son datos del
dashboard. Las capturas recuperadas solo aparecerán tras sincronizarse y
actualizar la vista; no se generan filas ni se ajustan totales para igualarlos.
Las pruebas de compatibilidad usan respuestas simuladas en memoria e importes
anonimizados, sin escribir movimientos en backend o celular.

## Posible duplicidad entre fuentes

IO y Google Wallet pueden registrar la misma operación como eventos distintos.
Se muestran ambas filas, con su fuente y cuenta. No se fusionan, ocultan ni
agrupan por heurísticas. Una nota junto a los totales advierte:

> Los movimientos pueden incluir registros provenientes de distintas fuentes que representen una misma operación.

Los totales reflejan los registros almacenados, sin conciliación entre fuentes.
`account` es el texto recibido; no hay entidad ni administración de cuentas.

## Estructura

```text
src/
  api/                  cliente, DTOs y llamadas financieras
  components/           marca y estados de petición
  features/auth/        sesión y login
  features/dashboard/   coordinación de datos y resumen por moneda
  features/billing/     ciclo 26–25 de iO, totales y lista independientes
  features/transactions/filtros, lista, formulario, dinero y fechas
  features/categories/  opciones de categorías
  routes/               rutas /login y /dashboard protegidas
  App.tsx, main.tsx, styles.css
tests/
  client.test.ts        cliente HTTP y errores
  format.test.ts        precisión decimal y zonas horarias
  app.test.tsx          flujos React y contratos de peticiones
  billing.test.tsx      límites del ciclo, totales y filtros independientes
  month.test.tsx        mes completo de Lima, rollover y fechas personalizadas
  yape.test.tsx         ingresos decimales, null, filtros, postTime y edición
  fixtures.ts, setup.ts
  smoke.mjs             navegador real con backend y PostgreSQL
  billing-smoke.mjs     ciclo iO en navegador, sin modificar movimientos
```

React Router se usa solo para login/dashboard y protección de navegación.
No hay Redux, Axios ni librería de componentes.

## Pruebas y build

```powershell
npm run typecheck
npm test
npm run build
```

91 pruebas Vitest/React Testing Library: cliente y estados HTTP, timeout y
cancelación, sesión/rutas/logout, estados del dashboard, monedas y null,
categorías, fuentes distintas sin fusión, paginación, filtros, altas/PATCH,
errores, respuestas antiguas, dinero y UTC/Lima; ciclo 26–25, cambio de mes/año,
rollover automático, totales completos, filtros independientes e importes rojos.
También cubren el mes calendario completo, febrero, fin de año, pestañas
suspendidas y restauración del mes actual al limpiar fechas personalizadas.
La revisión Yape añade importes enteros/con uno o dos decimales, presentación
de ingresos/null, fechas de publicación, filtros y PATCH de categoría sin
alterar importe, instante ni opcionales vacíos.
En entornos con recursos limitados: `npm test -- --maxWorkers=1`.
No se configuró un linter.

Regresión del Hito 9, 17/09/2026: **91 pruebas en seis archivos aprobadas**,
typecheck y build correctos. Los procesos de prueba de Windows tuvieron
timeouts al crear workers; la ejecución completa pasó reutilizando uno, sin
cambiar la configuración del repositorio ni omitir pruebas:

```powershell
npm test -- --no-isolate --maxWorkers=1 --pool=threads --testTimeout=20000
```

`--no-isolate` comparte el entorno del worker entre archivos; los hooks de la
suite limpian el DOM, mocks y timers entre pruebas. La ejecución normal sigue
disponible con `npm test`.

### Smoke real

Usar **exclusivamente una base desechable**, con migración, bootstrap y categorías.
El script crea 24 movimientos identificados con la cuenta `Smoke MVP …` para comprobar
también paginación. No borra filas ni limpia la base automáticamente.
Si se desea comprobar capturas existentes, usar una copia aislada de esa base,
nunca el original. El backend debe apuntar a dicha copia y Vite a ese backend.

Con Edge instalado, definir variables de proceso (no en `web/.env` ni en Vite):

```powershell
$env:SMOKE_WEB_URL = 'http://127.0.0.1:5173'
$env:SMOKE_EMAIL = '<usuario de la base desechable>'
$env:SMOKE_PASSWORD = '<contraseña de pruebas>'
$env:SMOKE_ALLOW_WRITES = 'isolated-test-database'
npm run test:smoke
Remove-Item Env:SMOKE_PASSWORD
```

`SMOKE_BROWSER_CHANNEL` puede ser `chrome` si se utiliza Chrome en lugar de Edge.
`SMOKE_OUTPUT_DIR` cambia el directorio de capturas, por defecto
`../.cache/hito8/smoke`. No se guardan cookies, storage state ni contraseñas en
las capturas o reportes. La prueba configura el navegador en Asia/Tokyo para
comprobar que la presentación sigue siendo Lima, valida viewports de
1440/768/390 px y prueba el teclado del diálogo. Respeta el rate limit normal
del backend; muchos reintentos rápidos de login requieren esperar su ventana.

La fecha de los movimientos sintéticos se obtiene del día actual en Lima,
convirtiendo mediante su zona IANA. Se verifican importes y cambios exactos del
resumen por moneda, alta manual, edición de descripción/categoría, estado
`manually_created` conservado y persistencia mediante una lectura posterior.
La comprobación de cookie respeta el `SESSION_COOKIE_NAME` configurado.

Validación del Hito 9, 17/09/2026: smoke y billing smoke **aprobados** en Edge
contra `dist/` y Express bajo un mismo origen local, con PostgreSQL desechable.
La base contenía tres fixtures sintéticos (IO, Wallet y Yape); IO/Wallet
permanecieron en dos filas y ambos contaron en los totales. El smoke creó sus
24 movimientos de prueba y validó el flujo manual completo, persistencia,
monedas, fechas y logout. No representa nuevas notificaciones de un teléfono.
Las capturas revisadas y los reportes están en `.cache/hito9/`; la verificación
física Android se registra por separado en el estado del proyecto.

Validación del 11/09/2026: flujo completo aprobado sobre una copia de las cuatro
capturas físicas del Hito 7, con PostgreSQL 18 local y Express en loopback.
Se comprobó cookie HttpOnly/SameSite, /me, summary, lista, filtros, alta, edición,
categoría nullable, paginación, responsive, teclado y logout. El estado de
proyecto detalla la regresión backend y la preservación de Android.

### Smoke del ciclo iO (solo lectura de movimientos)

Con web y backend activos, definir `SMOKE_EMAIL` y `SMOKE_PASSWORD` como en el
ejemplo anterior y ejecutar `npm run test:billing-smoke`. No necesita
`SMOKE_ALLOW_WRITES`: inicia/cierra su sesión de prueba y consulta los datos
existentes. Para comprobar las filas y los colores, la base debe contener
gastos y categorías. Las capturas quedan por defecto en `../.cache/hito8/billing`.

Validación del 13/09/2026 aprobada con los registros existentes: cuenta/tipo y
límites de Lima correctos, totales completos que no cambian al filtrar,
independencia entre secciones, filtros integrados e importes rojos. Viewports
1440/768/390 px, sin desbordamiento de página, con navegador en Asia/Tokyo.
El smoke también comprueba el resumen mensual real y su período al limpiar.

Referencias: [Vite](https://vite.dev/guide/) y
[Temporal polyfill](https://github.com/js-temporal/temporal-polyfill).
