# Arquitectura e implementación del MVP — Gestor financiero personal

## 1. Objetivo y alcance

El MVP detecta movimientos financieros a partir de notificaciones de IO, Yape y Google Wallet en un teléfono Android, los normaliza, los sincroniza con un backend y los muestra en un dashboard web. El usuario puede crear y corregir movimientos y asignar categorías.

El diseño prioriza automatización, tolerancia a desconexiones, seguridad básica e implementación directa. Quedan fuera del MVP:

- lectura de correo y extracción desde correo;
- agentes o categorización mediante IA;
- deduplicación probabilística entre fuentes distintas;
- conciliación, presupuestos, alertas y analítica avanzada;
- soporte móvil distinto de Android;
- registro público, recuperación de contraseña o administración multiusuario.

La deduplicación del MVP solo evita que los reintentos del mismo evento Android creen otra fila.

## 2. Decisiones tecnológicas cerradas

| Capa | Decisión |
|---|---|
| Android | Kotlin, `NotificationListenerService`, Room, WorkManager, Retrofit y OkHttp |
| Backend | Node.js LTS, TypeScript estricto y Express |
| Validación | Zod en los límites HTTP y variables de entorno |
| Acceso a datos | Prisma ORM y Prisma Migrate |
| Base de datos | PostgreSQL |
| Web | React, TypeScript y Vite |
| HTTP web | `fetch` nativo detrás de un wrapper común; no se añade Axios |
| Autenticación web | sesión opaca en cookie `HttpOnly`, `Secure` y `SameSite=Strict` |
| Autenticación Android | credencial opaca de dispositivo obtenida mediante emparejamiento de un solo uso |
| Pruebas | Vitest, Supertest, React Testing Library, JUnit, Room Test y MockWebServer |

No se introducen microservicios, cola externa, GraphQL, Redux, generación automática de clientes ni un framework de inyección de dependencias. Podrán añadirse después solo ante una necesidad comprobable.

El proveedor de hosting sigue abierto. La arquitectura exige únicamente HTTPS, PostgreSQL privado y soporte para variables de entorno y migraciones.

## 3. Vista general

```text
Android
  NotificationListenerService
    -> parser por fuente
    -> normalizador
    -> Room (cola durable)
    -> WorkManager
    -> Retrofit/OkHttp + Bearer device token
                         |
                         | HTTPS + JSON
                         v
Backend Express + TypeScript
  middleware: request id, autenticación, Zod, errores
  servicios: auth, sync, transactions, categories, summary
  repositorios Prisma
                         |
                         v
                    PostgreSQL
                         ^
                         |
React + Vite
  fetch same-origin + cookie HttpOnly
  resumen, filtros, creación y edición
```

El backend es la única capa que accede a PostgreSQL y contiene las reglas definitivas. Room es una cola local, no una segunda fuente de verdad.

## 4. Organización del repositorio

Se recomienda un repositorio único con tres aplicaciones independientes:

```text
gestor-financiero/
├─ backend/
│  ├─ prisma/
│  │  ├─ schema.prisma
│  │  ├─ migrations/
│  │  └─ seed.ts
│  ├─ src/
│  │  ├─ app.ts                 # configura Express, sin escuchar puerto
│  │  ├─ server.ts              # arranque y cierre ordenado
│  │  ├─ config/env.ts          # esquema Zod de process.env
│  │  ├─ middleware/
│  │  │  ├─ authenticateWeb.ts
│  │  │  ├─ authenticateDevice.ts
│  │  │  ├─ validate.ts
│  │  │  ├─ requestId.ts
│  │  │  └─ errorHandler.ts
│  │  ├─ modules/
│  │  │  ├─ auth/
│  │  │  ├─ devices/
│  │  │  ├─ transactions/
│  │  │  ├─ categories/
│  │  │  └─ summary/
│  │  └─ lib/prisma.ts
│  └─ tests/
├─ web/
│  ├─ src/
│  │  ├─ api/client.ts          # único wrapper de fetch
│  │  ├─ api/dtos.ts
│  │  ├─ components/
│  │  ├─ features/auth/
│  │  ├─ features/dashboard/
│  │  ├─ features/transactions/
│  │  ├─ features/categories/
│  │  └─ routes/
│  └─ tests/
├─ android/
│  └─ app/src/
│     ├─ main/java/.../
│     │  ├─ capture/
│     │  │  ├─ FinanceNotificationListener.kt
│     │  │  ├─ NotificationRouter.kt
│     │  │  └─ parsers/
│     │  ├─ domain/
│     │  ├─ data/local/         # Room entity, DAO y database
│     │  ├─ data/remote/        # Retrofit DTOs y API
│     │  ├─ sync/               # WorkManager
│     │  ├─ auth/               # pairing y almacenamiento seguro
│     │  └─ ui/
│     └─ test/
├─ .env.example
└─ README.md
```

Cada módulo backend usa, como máximo, `route -> controller -> service -> repository`. Los controladores traducen HTTP; los servicios contienen reglas; los repositorios encapsulan Prisma. No se crean capas vacías por uniformidad.

## 5. Responsabilidades

### 5.1 Android

`NotificationListenerService` filtra exclusivamente los paquetes admitidos y entrega título, texto, paquete y hora a `NotificationRouter`. Cada fuente tiene su parser (`IoNotificationParser`, `YapeNotificationParser`, `GoogleWalletNotificationParser`) y devuelve datos estructurados o `Ignored` con una causa diagnóstica.

El normalizador:

- convierte el monto a un decimal textual;
- usa códigos ISO 4217, por ejemplo `PEN`, solo cuando la moneda es conocida;
- produce tiempos ISO 8601 con offset o UTC;
- no inventa descripción, cuenta o moneda;
- genera un UUID `clientTransactionId` una sola vez;
- persiste en Room antes de iniciar cualquier envío.

WorkManager requiere conectividad, procesa lotes pequeños y usa backoff exponencial. Un `2xx` marca el elemento como sincronizado; `401` pausa los envíos hasta reemparejar; `422` lo marca `failed` para revisión; `429`, timeout y `5xx` producen reintento. El worker nunca genera un identificador nuevo para un reintento.

Retrofit define la interfaz HTTP. OkHttp añade el token del dispositivo, tiempos de espera y redacción de encabezados sensibles. Los cuerpos HTTP no se registran en producción.

### 5.2 Backend

Express expone una API versionada bajo `/api/v1`. La petición atraviesa: identificador de solicitud, límite de cuerpo, control de origen, autenticación, validación Zod, controlador, servicio y Prisma. El manejador global transforma errores conocidos a un contrato estable y oculta trazas internas.

Prisma realiza acceso a datos y migraciones. Las operaciones que afectan varias filas, como consumir un código de emparejamiento y crear una credencial, usan una transacción de base de datos.

### 5.3 Dashboard web

React consume la API, presenta el resumen y permite listar, filtrar, crear y editar movimientos. La validación del formulario mejora la experiencia, pero Zod en el backend es la autoridad.

`web/src/api/client.ts` es el único punto que usa `fetch`. Configura `credentials: "include"`, JSON, timeout con `AbortController` y traducción de `ApiError`. Axios no aporta una ventaja suficiente para el alcance actual.

Vite solo expone variables prefijadas con `VITE_`; ninguna contiene secretos. En producción se sirve web y API bajo el mismo origen, o mediante un proxy que conserve ese comportamiento.

## 6. Autenticación y autorización

### 6.1 Principios

- El MVP tiene un propietario, pero todas las filas financieras llevan `userId`.
- No hay registro público. El usuario inicial se crea con un comando de bootstrap administrativo.
- Las contraseñas se almacenan con Argon2id, nunca cifradas ni en texto plano.
- React y Android son clientes públicos: no contienen `JWT_SECRET`, contraseña maestra, API key global ni credenciales de PostgreSQL.
- Toda consulta filtra por el `userId` autenticado, incluso siendo single-user.

### 6.2 Sesión web

`POST /api/v1/auth/login` verifica correo y contraseña y crea una sesión opaca aleatoria. El navegador recibe una cookie `HttpOnly`, `Secure` en producción, `SameSite=Strict`, `Path=/` y con vencimiento, inicialmente 12 horas.

La base almacena únicamente el hash SHA-256 del token, `userId`, expiración y revocación. `POST /auth/logout` revoca la sesión y elimina la cookie. Las operaciones mutables verifican también el encabezado `Origin`; al operar same-origin y con `SameSite=Strict` no se añade un sistema CSRF más complejo en el MVP. Se limita la frecuencia de intentos de login.

### 6.3 Emparejamiento Android

Android no guarda la contraseña del usuario. El flujo es:

1. El usuario inicia sesión en el dashboard.
2. Solicita un código de emparejamiento, válido una sola vez durante 5 minutos.
3. Introduce o escanea el código en Android.
4. Android envía el código y un nombre de dispositivo a `POST /devices/pair`.
5. El backend consume el código atómicamente y entrega una credencial aleatoria de alta entropía una sola vez.
6. Android la guarda cifrada mediante Android Keystore.
7. Las sincronizaciones usan `Authorization: Bearer <device-token>`.

PostgreSQL conserva solo el hash SHA-256 de la credencial. El dashboard permite revocar un dispositivo y reemparejarlo. Un token revocado devuelve `401 AUTH_REQUIRED`; no se comparte la sesión web con Android. Para el MVP la credencial no caduca automáticamente: la rotación se realiza reemparejando, lo que evita renovar tokens en segundo plano sin reducir la capacidad de revocación.

## 7. Contratos HTTP principales

Todos los nombres JSON usan `camelCase`. UUID, fecha/hora y decimal viajan como strings. Los DTO de respuesta no exponen hashes ni datos internos.

### 7.1 Sincronización Android

```http
POST /api/v1/device/transactions/sync
Authorization: Bearer <device-token>
Content-Type: application/json
```

```json
{
  "clientTransactionId": "9e15374d-a4c8-4b97-8d68-6cbdd168d14f",
  "amount": "24.90",
  "currency": "PEN",
  "occurredAt": "2026-08-31T14:20:00-05:00",
  "description": "Comercio ejemplo",
  "type": "expense",
  "account": "IO Crédito",
  "source": "io_notification"
}
```

Respuesta para inserción o reintento reconocido:

```json
{
  "data": {
    "transactionId": "42e32b39-cc95-4de0-a36c-9d93b752fce1",
    "clientTransactionId": "9e15374d-a4c8-4b97-8d68-6cbdd168d14f",
    "syncResult": "created"
  }
}
```

`syncResult` es `created` o `already_exists`. La unicidad se resuelve en PostgreSQL, no con una consulta previa vulnerable a carreras.

### 7.2 DTO web de transacción

```json
{
  "id": "42e32b39-cc95-4de0-a36c-9d93b752fce1",
  "amount": "24.90",
  "currency": "PEN",
  "occurredAt": "2026-08-31T19:20:00.000Z",
  "description": "Comercio ejemplo",
  "type": "expense",
  "account": "IO Crédito",
  "categoryId": null,
  "source": "io_notification",
  "processingStatus": "automatic",
  "createdAt": "2026-08-31T19:20:05.000Z",
  "updatedAt": "2026-08-31T19:20:05.000Z"
}
```

`CreateManualTransactionDto` admite `amount`, `currency`, `occurredAt`, `description`, `type`, `account` y `categoryId`. El servidor fija `source=manual` y `processingStatus=manually_created`.

`UpdateTransactionDto` es parcial, pero solo permite esos campos. Si se edita una transacción automática, el servidor fija `processingStatus=manually_modified`; no permite cambiar `source`, propietario, identificadores ni auditoría.

### 7.3 Rutas del MVP

| Método | Ruta | Autenticación | Uso |
|---|---|---|---|
| `POST` | `/api/v1/auth/login` | pública, limitada | iniciar sesión web |
| `POST` | `/api/v1/auth/logout` | sesión | cerrar y revocar sesión |
| `GET` | `/api/v1/auth/me` | sesión | obtener usuario actual |
| `POST` | `/api/v1/devices/pairing-codes` | sesión | crear código de un solo uso |
| `GET` | `/api/v1/devices` | sesión | listar dispositivos |
| `DELETE` | `/api/v1/devices/:id` | sesión | revocar dispositivo |
| `POST` | `/api/v1/devices/pair` | código temporal | emitir token de dispositivo |
| `POST` | `/api/v1/device/transactions/sync` | dispositivo | sincronizar captura Android |
| `GET` | `/api/v1/transactions` | sesión | listar y filtrar |
| `GET` | `/api/v1/transactions/:id` | sesión | ver detalle |
| `POST` | `/api/v1/transactions` | sesión | crear manualmente |
| `PATCH` | `/api/v1/transactions/:id` | sesión | editar campos permitidos |
| `GET` | `/api/v1/categories` | sesión | listar categorías |
| `GET` | `/api/v1/summary` | sesión | balance, ingresos y gastos |

`GET /transactions` acepta `from`, `to`, `categoryId`, `type`, `account`, `page` y `pageSize` (máximo 100), ordena por `occurredAt desc, id desc` y devuelve `{ data, meta: { page, pageSize, total } }`. El frontend convierte días locales de `America/Lima` a instantes antes de enviarlos.

`GET /summary` usa los mismos límites temporales y devuelve strings decimales. Nunca suma monedas diferentes en un único total.

## 8. Validación y errores

Zod valida parámetros, query, cuerpo y configuración. Reglas mínimas:

- `amount`: decimal positivo, máximo dos decimales y dentro de `Decimal(14,2)`;
- `currency`: tres letras mayúsculas o `null`;
- `occurredAt`: ISO 8601 con zona/offset;
- textos: recortados y con límites explícitos;
- enums: únicamente valores documentados;
- IDs: UUID;
- campos desconocidos: rechazados en comandos de escritura.

Formato común:

```json
{
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "La solicitud contiene datos inválidos",
    "details": [{ "field": "amount", "message": "Debe ser un decimal positivo" }],
    "requestId": "01J6N..."
  }
}
```

Códigos: `VALIDATION_ERROR` (`400` o `422` para una captura no procesable), `AUTH_REQUIRED` (`401`), `FORBIDDEN` (`403`), `NOT_FOUND` (`404`), `CONFLICT` (`409`), `RATE_LIMITED` (`429`) e `INTERNAL_ERROR` (`500`). Los mensajes de base de datos y stacks no salen al cliente. Los logs nunca incluyen cookies, bearer tokens, contraseñas ni notificaciones completas.

## 9. Flujo de captura e idempotencia

1. Llega una notificación de una aplicación admitida.
2. El parser decide si es financiera y extrae datos.
3. El normalizador crea el UUID y el DTO estable.
4. Room inserta con estado `pending`.
5. WorkManager reclama el registro y cambia a `syncing`.
6. Retrofit lo envía con la credencial del dispositivo.
7. Zod valida; el backend deriva `userId` y `deviceId` de la credencial.
8. Prisma intenta insertar usando la restricción única de idempotencia.
9. El backend responde `created` o `already_exists` con el ID definitivo.
10. Android marca `synced`. Si la respuesta se pierde, repite exactamente el mismo DTO.

## 10. Configuración y secretos

El repositorio incluye `.env.example`, nunca `.env`. El backend valida al arrancar:

```text
NODE_ENV
PORT
DATABASE_URL
WEB_ORIGIN
SESSION_COOKIE_NAME
SESSION_TTL_MINUTES
PAIRING_CODE_TTL_MINUTES
```

El bootstrap inicial puede leer `BOOTSTRAP_USER_EMAIL` y `BOOTSTRAP_USER_PASSWORD` solo durante su ejecución; esas variables se retiran del entorno normal después. No se necesita secreto de firma porque las credenciales son opacas y se verifican por hash.

En Android, la URL base es configuración no secreta y el token emitido vive en Android Keystore. En web, `VITE_API_BASE_URL` puede ser público y normalmente vale `/api/v1`; no se incluyen claves privadas.

Producción exige HTTPS, PostgreSQL no público, un usuario de base con privilegios mínimos, backups y CORS restringido al origen exacto si no puede usarse same-origin.

## 11. Migraciones y datos iniciales

Desarrollo:

1. levantar PostgreSQL local;
2. copiar `.env.example` a `.env` y completar valores locales;
3. ejecutar `prisma migrate dev`;
4. ejecutar el seed idempotente de categorías;
5. ejecutar una sola vez el bootstrap del propietario.

Despliegue:

1. construir y probar un artefacto con la migración versionada;
2. realizar backup cuando la migración sea riesgosa;
3. ejecutar `prisma migrate deploy` una vez antes de activar la versión;
4. desplegar backend y frontend;
5. comprobar `/health/live` y `/health/ready`.

No se usa `prisma db push` en producción ni se editan migraciones aplicadas. El seed usa `upsert` y no elimina datos del usuario.

## 12. Pruebas básicas

### Backend

- unitarias para servicios, validadores y estados;
- integración con PostgreSQL de prueba para filtros y aislamiento por `userId`;
- Supertest para login, cookies, pairing, autorización y errores;
- concurrencia: dos envíos con el mismo `clientTransactionId` producen una fila.

### Android

- fixtures anonimizados por parser y casos ignorados;
- normalizador, UUID estable y clasificación de errores;
- Room en memoria para transiciones de cola;
- MockWebServer para `created`, `already_exists`, `401`, `422`, `429`, `5xx` y timeout;
- una prueba instrumentada del worker con restricción de red.

### Web

- React Testing Library para formularios, filtros y estados de carga/vacío/error;
- wrapper `fetch` y traducción de `ApiError`;
- smoke test de login, listado, creación y edición; Playwright puede incorporarse al completar el flujo vertical.

Para aprobar cambios: typecheck, lint y pruebas de cada aplicación. Se priorizan autenticación, idempotencia, dinero, fechas y parsers, no un porcentaje de cobertura arbitrario.

## 13. Orden de implementación

1. Esquema Prisma, migración, seed y bootstrap.
2. Express base, configuración, errores, login y sesiones.
3. Pairing y credenciales de dispositivo.
4. Sincronización idempotente con prueba concurrente.
5. Room, parsers, normalizador, Retrofit y WorkManager.
6. Consultas, filtros, categorías y resumen.
7. React: login, dashboard, lista, filtros, alta y edición.
8. Límites, redacción de logs, backups y smoke tests.

El primer hito vertical prueba una notificación fixture desde Android hasta PostgreSQL y su visualización en React antes de ampliar todos los parsers.

## 14. Criterios de terminado

- Una notificación válida queda en Room antes de enviarse y sobrevive a reinicios.
- Los reintentos generan una sola fila y reciben el ID original.
- React y Android no contienen secretos compartidos ni credenciales de base de datos.
- Un dispositivo puede emparejarse y revocarse; una sesión puede cerrarse y expirar.
- Toda lectura/escritura financiera está limitada al usuario autenticado.
- Dinero y fechas conservan precisión y zona temporal.
- El dashboard lista, filtra, resume, crea y edita datos reales.
- Migraciones, seed y pruebas críticas se ejecutan de forma repetible.
- Correo, IA y deduplicación avanzada siguen fuera del MVP.
