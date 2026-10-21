# Referencia técnica del MVP

Gestor financiero personal cuyo MVP detecta movimientos desde notificaciones de IO, Yape y Google Wallet en Android, los conserva localmente cuando no haya red y los sincroniza de forma segura. El dashboard React permite consultar, filtrar, crear y corregir movimientos, además de asignar categorías.

## Arquitectura

```text
Android (Kotlin, NotificationListenerService, Room, WorkManager, Retrofit/OkHttp)
   ↓ HTTPS
Backend (Node.js LTS, TypeScript, Express, Zod y Prisma) ↔ PostgreSQL
   ↑ HTTPS
Dashboard (React, TypeScript, Vite y fetch)
```

El backend es la única capa con acceso a PostgreSQL; Room funciona como cola durable local del dispositivo Android.

## Estado

Estado actual: Hito 9 — completado localmente pero pendiente de deployment.
Cierre del teléfono confirmado por el usuario. Backend 112, web 91 y Android
63/63 pruebas normales/release aprobadas; flujo real y recuperación verificados.
Se conservan los Hitos 0–8, incluido Android para los formatos reales observados. Consulta la verificación y sus límites en
[`ESTADO_PROYECTO.md`](../ESTADO_PROYECTO.md).

## Estructura y requisitos

| Directorio | Contenido |
|---|---|
| `backend/` | Express, Prisma, migraciones y pruebas PostgreSQL |
| `web/` | Dashboard React, Vite y pruebas de navegador |
| `android/` | Captura, parsers, Room, Keystore y WorkManager |
| `contexto/` | Alcance y arquitectura de referencia |
| `docs/` y `deploy/` | Operación, backups y plantilla del proxy de producción |

Requisitos: Node.js 24 o superior compatible con el lockfile, npm, PostgreSQL
(pruebas locales con 18.4), Android SDK 36 y JDK compatible con Gradle 8.13.
El teléfono real se necesita para las pruebas instrumentadas y notificaciones;
las suites unitarias se ejecutan sin él.

El backend expone:

```http
POST /api/v1/auth/login
POST /api/v1/auth/logout
GET  /api/v1/auth/me
POST /api/v1/devices/pairing-codes
POST /api/v1/devices/pair
GET  /api/v1/devices
DELETE /api/v1/devices/:id
POST /api/v1/device/transactions/sync
GET  /api/v1/transactions
GET  /api/v1/transactions/:id
POST /api/v1/transactions
PATCH /api/v1/transactions/:id
GET  /api/v1/categories
GET  /api/v1/summary
```

No existe registro público. El propietario se crea con el bootstrap
administrativo.

## Android: captura y sincronización

`android/` contiene una aplicación Kotlin con Activity mínima,
`FinanceNotificationListener`, router y contrato de parsers, normalización y
una cola Room durable. Las capturas válidas reciben un UUID una sola vez y se
guardan primero como `pending`. El DAO incluye claim transaccional, reintentos,
confirmación, fallos y recuperación de reclamos abandonados.

El usuario debe habilitar manualmente el acceso a notificaciones desde los
ajustes de Android; la app incluye un botón para abrirlos. Los paquetes reales de
IO, Yape y Google Wallet cuentan con parsers y fixtures de texto redactado
y fechas sintéticas. El pairing guarda el token cifrado con Android Keystore;
WorkManager envía lotes con conectividad, Retrofit/OkHttp y backoff. Se verificó
el flujo físico hasta PostgreSQL, reemparejamiento y reenvío del mismo UUID.
La coincidencia IO/Wallet del mismo pago todavía produce dos capturas; no hay
deduplicación entre fuentes. El dashboard muestra ambas capturas con fuente y cuenta, y advierte de su posible duplicidad junto a los totales.

Usa Android SDK 36 y un JDK compatible con Gradle 8.13. Desde `android/`:

```powershell
.\gradlew.bat test
.\gradlew.bat assembleDebug
.\gradlew.bat lintDebug
```

La configuración local, estructura, dependencias, operaciones de cola y límites
están descritos en [`android/README.md`](../android/README.md).

## Dashboard web en desarrollo

Desde `web/`, ejecutar `npm ci` y `npm run dev`. Abrir
`http://127.0.0.1:5173` y configurar en el backend
`WEB_ORIGIN=http://127.0.0.1:5173`. Vite envía `/api` al backend local en
`http://127.0.0.1:3000`; `API_PROXY_TARGET` permite cambiar ese destino.
`VITE_API_BASE_URL` vale `/api/v1` y no contiene secretos.

React 19.3.0 + TypeScript + Vite 8.3.0, con sesión HttpOnly, resumen por moneda,
lista paginada, filtros integrados, alta/edición y categorías. Antes de
Transacciones aparece el ciclo actual de la tarjeta iO (del 26 al 25), con
gastos y totales completos separados por moneda, y filtros independientes.
Fechas en Lima e importes como strings; los gastos de las listas aparecen en rojo.
El resumen general abre con el mes calendario actual completo, del día 1 al
último día en Lima, y avanza automáticamente al cambiar de mes. Las fechas
de Transacciones permiten consultar otro período; Limpiar restaura el mes actual.
Categoría, tipo y cuenta filtran la lista general. No hay deduplicación ni
despliegue permanente.

Comprobaciones: `npm run typecheck`, `npm test`, `npm run build`.
Configuración, estructura y smoke test real en [`web/README.md`](../web/README.md).

## Backend en desarrollo

Desde `backend/`, instala dependencias y crea `backend/.env` a partir de
`../.env.example`. Completa como mínimo `NODE_ENV`, `PORT`, `DATABASE_URL`,
`WEB_ORIGIN`, `SESSION_COOKIE_NAME`, `SESSION_TTL_MINUTES` y
`PAIRING_CODE_TTL_MINUTES` (valor recomendado: `5`).

```text
npm ci
npm run prisma:generate
npm run dev
```

`app.ts` exporta la fábrica de la aplicación Express sin abrir un puerto y
`server.ts` realiza el arranque y el cierre ordenado. En producción, configura
`NODE_ENV=production` y sirve la aplicación mediante HTTPS.

La sesión web es opaca: el navegador conserva el token únicamente en una cookie
`HttpOnly`, `SameSite=Strict`, `Path=/` y `Secure` en producción. PostgreSQL
conserva solo su SHA-256. El valor sugerido de `SESSION_TTL_MINUTES=720` equivale
a 12 horas. Login y logout requieren que `Origin` coincida exactamente con
`WEB_ORIGIN`; las peticiones desde otro origen se rechazan.

## Emparejamiento y dispositivos

El usuario inicia sesión en web, genera un código temporal e introduce ese
código junto al nombre del teléfono en el cliente Android. El backend lo consume
una sola vez y devuelve la credencial del dispositivo, que Android cifra con
AES-256-GCM y una clave de Android Keystore. El dashboard actual no incorpora una
pantalla de dispositivos; para emitir códigos se utiliza el endpoint autenticado
descrito abajo. La web nunca recibe el device token.

| Método y ruta | Requisitos | Respuesta correcta |
|---|---|---|
| `POST /api/v1/devices/pairing-codes` | Cookie web y `Origin` igual a `WEB_ORIGIN`; sin body o `{}` | `201 { data: { code, expiresAt } }` |
| `POST /api/v1/devices/pair` | `{ "code": "<código temporal>", "deviceName": "Mi teléfono" }`; sin sesión web ni `Origin` obligatorio | `201 { data: { deviceId, deviceToken } }` |
| `GET /api/v1/devices` | Cookie web | `200 { data: [{ id, name, lastSeenAt, revokedAt, createdAt }] }` |
| `DELETE /api/v1/devices/:id` | Cookie web, `Origin` válido y UUID del dispositivo | `204`, sin cuerpo |

- Código: 10 símbolos aleatorios de un alfabeto de 32 caracteres sin `I`, `O`,
  `0` ni `1` (50 bits de entropía). Se aceptan minúsculas, espacios en los
  extremos y un guion opcional entre los dos grupos de cinco. Se persiste solo
  el SHA-256 del código normalizado, en mayúsculas y sin guion.
- La expiración se calcula desde `PAIRING_CODE_TTL_MINUTES`; el valor sugerido
  es 5 minutos. Un código inexistente, vencido o consumido recibe el mismo
  `400 VALIDATION_ERROR`, sin indicar cuál de esas condiciones ocurrió.
- Una transacción PostgreSQL en `ReadCommitted` reclama el código mediante
  `UPDATE ... WHERE code_hash = ... AND consumed_at IS NULL AND expires_at > ...
  RETURNING user_id` y crea el dispositivo. El bloqueo de fila impide el doble
  consumo; si falla la creación, también se revierte el consumo.
- La credencial contiene 256 bits aleatorios en base64url, es opaca, no es JWT y
  no caduca automáticamente. Solo su SHA-256 se guarda en `Device.tokenHash`.
  Código y token se devuelven una sola vez, con `Cache-Control: no-store`.
- `authenticateDevice` protege la sincronización financiera mediante
  `Authorization: Bearer <device-token>`. Consulta el hash y la revocación en
  PostgreSQL en cada solicitud y adjunta `request.deviceAuth` con `userId` y
  `deviceId`. Credenciales ausentes, inválidas o revocadas devuelven
  `401 AUTH_REQUIRED`.
- `lastSeenAt` empieza en `null`. Se actualiza en la primera autenticación y
  después solo si han pasado al menos cinco minutos. La actualización incluye
  una condición en base de datos para evitar escrituras redundantes concurrentes.
- Listado y revocación filtran por el propietario de la sesión. El listado
  incluye dispositivos revocados y solo expone los cinco campos públicos.
  Revocar establece `revokedAt`, conserva el dispositivo y su historial y
  rechaza su token en nuevas solicitudes. Repetir la revocación devuelve `204`
  conservando la fecha original. UUID inexistente o de otro propietario:
  `404 NOT_FOUND` idéntico.
- `deviceName` se recorta y admite de 1 a 100 caracteres. Los comandos rechazan
  campos desconocidos; estas rutas tampoco admiten parámetros query. El cliente
  nunca establece el propietario.
- Pairing público: 5 intentos por IP cada 5 minutos, incluidos payloads inválidos,
  con `429 RATE_LIMITED` y `Retry-After`. Reutiliza el limitador en memoria del
  login con un contador independiente. No se confía en `X-Forwarded-For`.
- Las rutas mutables con cookie reutilizan la protección `Origin`. El cliente
  Android puede hacer pairing sin ese encabezado; si se envía, sigue sujeto a
  la política CORS global de `WEB_ORIGIN`.

La suite comprueba aislamiento entre dos usuarios, rollback ante un fallo real
de inserción, revocación, autenticación, límites de actividad y logs sin secretos.
La prueba concurrente bloquea una fila y verifica en `pg_stat_activity` que dos
peticiones HTTP esperan en PostgreSQL antes de liberarlas: debe obtener un
`201`, un `400`, un dispositivo y un código consumido.

## API de transacciones

Las rutas web requieren cookie de sesión. POST y PATCH manuales exigen además
`Origin` igual a `WEB_ORIGIN`. Sync requiere exclusivamente Bearer de dispositivo
y funciona sin Origin ni cookie.

| Método y ruta (prefijo `/api/v1`) | Entrada | Respuesta |
|---|---|---|
| `POST /device/transactions/sync` | Campos financieros, UUID `clientTransactionId` y `source` Android | `201` al crear; `200` en retry; `{ data: { transactionId, clientTransactionId, syncResult } }` |
| `GET /transactions` | `from`, `to`, `categoryId`, `type`, `account`, `page`, `pageSize` | `{ data: TransactionDto[], meta: { page, pageSize, total } }` |
| `GET /transactions/:id` | UUID | `{ data: TransactionDto }`; `404` también para otro propietario |
| `POST /transactions` | `amount`, `currency`, `occurredAt`, `description`, `type`, `account`, `categoryId` | `201 { data: TransactionDto }` |
| `PATCH /transactions/:id` | Al menos uno de los campos de alta manual | `200 { data: TransactionDto }` |
| `GET /categories` | Sin parámetros | `{ data: [{ id, name }] }` del propietario |
| `GET /summary` | `from`, `to`, `account`, `type` opcionales | `{ data: [{ currency, income, expenses, balance }] }` |

- Dinero: string positivo de hasta 12 dígitos enteros y 2 decimales; respuestas
  con dos decimales. `currency` es obligatoria en altas: tres letras mayúsculas
  o `null`. Descripción (300 caracteres), cuenta (120) y categoría son opcionales;
  los textos se recortan y no admiten valores vacíos. Todos los IDs son UUID.
- Fechas: ISO 8601 con offset/Z. Los rangos son **`from` inclusivo, `to` exclusivo**;
  ambos opcionales y, si se envían juntos, `from < to`. La web convierte los días
  de Lima a instantes. Las respuestas devuelven fechas UTC.
- Paginación: página inicial 1, tamaño predeterminado 20, máximo 100. Orden:
  `occurredAt DESC, id DESC`. Cuenta se compara exactamente tras trim.
- Summary admite cuenta exacta y tipo (`income`/`expense`) para calcular los
  totales completos del ciclo iO en PostgreSQL, sin depender de la paginación.
- Sync admite `io_notification`, `yape_notification` y
  `google_wallet_notification`. Intenta INSERT; solo ante conflicto UNIQUE busca
  `(userId, clientTransactionId)` y devuelve `already_exists` con el ID original.
  Un retry conserva las correcciones web y no fusiona eventos distintos.
- El servidor asigna propietario, dispositivo, fuente y estado. Alta manual:
  `manual` / `manually_created`, sin dispositivo ni ID cliente. Editar una captura
  cambia `automatic` a `manually_modified`; una manual conserva `manually_created`.
  En PATCH, ausencia conserva el campo y `null` limpia campos nullable. Campos
  desconocidos y metadatos enviados por el cliente se rechazan.
- Categorías y todas las operaciones se restringen al propietario autenticado.
  `TransactionDto` incluye los campos financieros, ID, fuente, estado y auditoría;
  omite `userId`, `deviceId`, `clientTransactionId` y datos internos.
- Summary calcula sumas y balance con `NUMERIC` en PostgreSQL y devuelve strings.
  Cada moneda tiene su grupo; `null` tiene uno separado. No hay conversión ni total
  global entre monedas. Sin movimientos responde `{ data: [] }`.

## Preparación local de la base de datos

La fábrica de conexiones del backend fija `TimeZone=UTC` en cada conexión de
Prisma, conservando otras opciones de la URL. Evita que adapter-pg 7.10 desplace
los `timestamptz` cuando PostgreSQL tiene otra zona. No cambia la zona del sistema
ni del servidor PostgreSQL. Las pruebas comparan el instante con SQL nativo,
además de comprobar la respuesta de Prisma.

La contraseña del bootstrap debe tener al menos 12 caracteres. Las variables
`BOOTSTRAP_USER_EMAIL` y `BOOTSTRAP_USER_PASSWORD` solo son necesarias para los
comandos administrativos y deben retirarse del entorno normal del servidor.

Con PostgreSQL disponible, prepara una base nueva en este orden:

```text
npm run prisma:migrate:deploy
npm run prisma:migrate:status
npm run bootstrap
npm run db:seed
```

El bootstrap identifica al propietario por su email normalizado. Al ejecutarlo
de nuevo para ese email, actualiza únicamente su hash de contraseña con el valor
suministrado y conserva todas sus relaciones. El seed puede repetirse y conserva
las categorías existentes.

## Comandos del backend

```text
npm run dev
npm run typecheck
npm run build
npm start
npm run prisma:validate
npm run prisma:generate
npm run prisma:migrate:deploy
npm run bootstrap
npm run db:seed
```

Las pruebas usan Vitest, Supertest y una base PostgreSQL separada. Define
`TEST_DATABASE_URL` con una base cuyo nombre contenga `test`; el setup aplica las
migraciones automáticamente y se niega a operar sobre un nombre que no parezca
de pruebas.

```text
npm test
```

El login se limita en memoria a 5 intentos por IP durante una ventana de 15
minutos. Esta estrategia es apropiada para el monolito personal de una sola
instancia; un despliegue con varias réplicas necesitará un contador compartido.

## Documentación

La documentación oficial y fuente de verdad del proyecto se encuentra en [`contexto/`](../contexto).

## Producción y operación

La [guía de producción](../docs/PRODUCCION.md) describe configuración, roles mínimos
PostgreSQL, migraciones, build, mismo origen para web/API, HTTPS en el proxy,
health checks, cierre, backups y restauración, firma Android y checklist.
Incluye una [plantilla nginx](../deploy/nginx.conf.example) que debe adaptarse al
dominio y certificado reales. No se ha contratado proveedor ni desplegado públicamente.

La app expone `GET /health/live` y `GET /health/ready`; readiness consulta
PostgreSQL y devuelve `503` cuando no está disponible, sin datos sensibles.
Producción exige `WEB_ORIGIN` HTTPS y conserva la cookie Secure. El cierre por
SIGINT/SIGTERM deja de aceptar HTTP, drena conexiones y desconecta Prisma.

## Limitaciones conocidas

- IO y Google Wallet pueden representar el mismo pago en filas distintas;
  ambas cuentan en los totales. La idempotencia solo cubre el mismo UUID.
- Algunas capturas usan la hora de publicación de la notificación, mostrada en Lima.
- El teléfono debe estar encendido, tener Notification Access habilitado y
  permitir WorkManager bajo las políticas normales de Android. Sin backend
  accesible, la cola conserva pendientes/reintentos.
- Solo están soportados los formatos observados. Wallet requiere asociación
  local del alias de tarjeta; una instalación limpia necesita configurarla de nuevo.
- No se incluyen correo, IA, deduplicación avanzada, presupuestos ni analítica avanzada.
