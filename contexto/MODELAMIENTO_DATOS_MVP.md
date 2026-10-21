# Modelamiento de datos implementable del MVP — Gestor financiero personal

## 1. Alcance del modelo

PostgreSQL es la fuente de verdad de movimientos, categorías y credenciales. Room mantiene únicamente la cola durable del teléfono. El modelo soporta un usuario propietario hoy, pero conserva `userId` para que autenticación y autorización no dependan de una base implícitamente single-user.

Entidades PostgreSQL mínimas:

- `User`: propietario y credencial de acceso web;
- `WebSession`: sesiones opacas revocables del dashboard;
- `Device`: teléfono emparejado y su credencial revocable;
- `PairingCode`: autorización breve y de un solo uso para emparejar;
- `Category`: categorías del propietario;
- `Transaction`: movimientos automáticos y manuales.

No se modelan correo, IA, comercio, cuenta bancaria, evidencia multifuente ni deduplicación probabilística.

## 2. Relaciones

```text
User 1 ─── 0..N WebSession
User 1 ─── 0..N PairingCode
User 1 ─── 0..N Device
User 1 ─── 0..N Category
User 1 ─── 0..N Transaction
Device 1 ─ 0..N Transaction (nullable en manuales)
Category 1 ─ 0..N Transaction (categoryId nullable)
```

Todas las consultas de negocio incluyen el `userId` obtenido de la sesión o del dispositivo. Nunca aceptan `userId` desde un DTO cliente.

## 3. Esquema Prisma de referencia

El siguiente esquema fija nombres, tipos y restricciones. Puede ajustarse la sintaxis a la versión instalada de Prisma sin cambiar su semántica.

```prisma
enum TransactionType {
  income
  expense
}

enum TransactionSource {
  io_notification
  yape_notification
  google_wallet_notification
  manual
}

enum ProcessingStatus {
  automatic
  manually_modified
  manually_created
}

model User {
  id           String        @id @default(uuid()) @db.Uuid
  email        String        @unique @db.VarChar(254)
  passwordHash String        @map("password_hash") @db.Text
  createdAt    DateTime      @default(now()) @map("created_at") @db.Timestamptz(3)
  updatedAt    DateTime      @updatedAt @map("updated_at") @db.Timestamptz(3)
  sessions     WebSession[]
  devices      Device[]
  pairingCodes PairingCode[]
  categories   Category[]
  transactions Transaction[]

  @@map("users")
}

model WebSession {
  id        String    @id @default(uuid()) @db.Uuid
  userId    String    @map("user_id") @db.Uuid
  tokenHash String    @unique @map("token_hash") @db.Char(64)
  expiresAt DateTime  @map("expires_at") @db.Timestamptz(3)
  revokedAt DateTime? @map("revoked_at") @db.Timestamptz(3)
  createdAt DateTime  @default(now()) @map("created_at") @db.Timestamptz(3)
  user      User      @relation(fields: [userId], references: [id], onDelete: Cascade)

  @@index([userId, expiresAt])
  @@map("web_sessions")
}

model Device {
  id           String        @id @default(uuid()) @db.Uuid
  userId       String        @map("user_id") @db.Uuid
  name         String        @db.VarChar(100)
  tokenHash    String        @unique @map("token_hash") @db.Char(64)
  lastSeenAt   DateTime?     @map("last_seen_at") @db.Timestamptz(3)
  revokedAt    DateTime?     @map("revoked_at") @db.Timestamptz(3)
  createdAt    DateTime      @default(now()) @map("created_at") @db.Timestamptz(3)
  user         User          @relation(fields: [userId], references: [id], onDelete: Cascade)
  transactions Transaction[]

  @@index([userId, revokedAt])
  @@map("devices")
}

model PairingCode {
  id         String    @id @default(uuid()) @db.Uuid
  userId     String    @map("user_id") @db.Uuid
  codeHash   String    @unique @map("code_hash") @db.Char(64)
  expiresAt  DateTime  @map("expires_at") @db.Timestamptz(3)
  consumedAt DateTime? @map("consumed_at") @db.Timestamptz(3)
  createdAt  DateTime  @default(now()) @map("created_at") @db.Timestamptz(3)
  user       User      @relation(fields: [userId], references: [id], onDelete: Cascade)

  @@index([userId, expiresAt])
  @@map("pairing_codes")
}

model Category {
  id             String        @id @default(uuid()) @db.Uuid
  userId         String        @map("user_id") @db.Uuid
  name           String        @db.VarChar(80)
  normalizedName String        @map("normalized_name") @db.VarChar(80)
  createdAt      DateTime      @default(now()) @map("created_at") @db.Timestamptz(3)
  updatedAt      DateTime      @updatedAt @map("updated_at") @db.Timestamptz(3)
  user           User          @relation(fields: [userId], references: [id], onDelete: Cascade)
  transactions   Transaction[]

  @@unique([userId, normalizedName])
  @@index([userId, name])
  @@map("categories")
}

model Transaction {
  id                  String             @id @default(uuid()) @db.Uuid
  userId              String             @map("user_id") @db.Uuid
  deviceId            String?            @map("device_id") @db.Uuid
  clientTransactionId String?            @map("client_transaction_id") @db.Uuid
  amount              Decimal            @db.Decimal(14, 2)
  currency            String?            @db.Char(3)
  occurredAt          DateTime           @map("occurred_at") @db.Timestamptz(3)
  description         String?            @db.VarChar(300)
  type                TransactionType
  account             String?            @db.VarChar(120)
  categoryId          String?            @map("category_id") @db.Uuid
  source              TransactionSource
  processingStatus    ProcessingStatus   @map("processing_status")
  createdAt           DateTime           @default(now()) @map("created_at") @db.Timestamptz(3)
  updatedAt           DateTime           @updatedAt @map("updated_at") @db.Timestamptz(3)
  user                User               @relation(fields: [userId], references: [id], onDelete: Restrict)
  device              Device?            @relation(fields: [deviceId], references: [id], onDelete: SetNull)
  category            Category?          @relation(fields: [categoryId], references: [id], onDelete: SetNull)

  @@unique([userId, clientTransactionId])
  @@index([userId, occurredAt(sort: Desc)])
  @@index([userId, type, occurredAt(sort: Desc)])
  @@index([userId, categoryId, occurredAt(sort: Desc)])
  @@map("transactions")
}
```

PostgreSQL permite varios `NULL` en la restricción única compuesta, por lo que las transacciones manuales pueden tener `clientTransactionId = null`. La capa de servicio exige que una fuente Android sí tenga `deviceId` y `clientTransactionId`. Puede añadirse una migración SQL con `CHECK`, pero la validación de servicio y sus pruebas siguen siendo obligatorias.

## 4. Reglas por entidad

### 4.1 `User`

- En el MVP existe un propietario y no hay endpoint público de registro.
- El email se guarda normalizado en minúsculas.
- `passwordHash` es Argon2id con parámetros revisados para el entorno de despliegue.
- El bootstrap es idempotente por email y no imprime la contraseña.

### 4.2 `WebSession`

- El token aleatorio solo se entrega en la cookie al crearse.
- `tokenHash` es SHA-256 hexadecimal; una filtración de base de datos no entrega sesiones utilizables directamente.
- Una sesión es válida si no expiró ni fue revocada.
- Logout establece `revokedAt`. La limpieza de sesiones vencidas es mantenimiento, no parte del camino crítico.

### 4.3 `PairingCode` y `Device`

- El código caduca en 5 minutos y es de un solo uso.
- Su consumo y la creación de `Device` ocurren en una transacción con actualización condicional para impedir doble consumo.
- El token se entrega una vez, se guarda con Android Keystore y solo su hash se persiste.
- Revocar un dispositivo invalida accesos nuevos sin borrar transacciones; la acción normal es revocarlo, no eliminarlo.
- `lastSeenAt` se actualiza de forma limitada para evitar una escritura en cada petición.

### 4.4 `Category`

- Categorías iniciales: Comida, Transporte, Entretenimiento, Compras, Servicios, Salud, Educación y Otros.
- El seed crea categorías por usuario mediante `upsert`.
- `normalizedName` se obtiene al recortar, pasar a minúsculas y normalizar espacios.
- Una transacción puede quedar sin categoría.

### 4.5 `Transaction`

- `amount` siempre es positivo; `type` determina si suma como ingreso o gasto.
- La API recibe y devuelve dinero como string decimal. Prisma/PostgreSQL usan `Decimal`.
- `currency` es ISO 4217 mayúsculo o `null`; no se infiere sin evidencia.
- `occurredAt` se guarda como instante UTC (`timestamptz`) y se presenta inicialmente en `America/Lima`.
- `description`, `account` y `categoryId` son opcionales.
- Las fuentes Android crean con `processingStatus=automatic`.
- Una edición web de una automática cambia a `manually_modified`.
- Una alta web usa `source=manual`, `processingStatus=manually_created`, `deviceId=null` y `clientTransactionId=null`.
- El usuario no puede editar fuente, estado, IDs, propietario ni auditoría directamente.
- Al asignar una categoría, el servicio verifica que pertenezca al mismo `userId`.

## 5. Valores controlados

```text
TransactionType: income | expense
TransactionSource: io_notification | yape_notification |
                   google_wallet_notification | manual
ProcessingStatus: automatic | manually_modified | manually_created
```

No se añade `unknown`: si el parser no determina ingreso o gasto con suficiente seguridad, la notificación no se sincroniza automáticamente y queda como fallo revisable en la cola local.

## 6. Modelo Room

Room usa columnas explícitas en lugar de un JSON opaco:

```kotlin
@Entity(tableName = "pending_transactions")
data class PendingTransactionEntity(
    @PrimaryKey val clientTransactionId: String,
    val amount: String,
    val currency: String?,
    val occurredAt: String,
    val description: String?,
    val type: String,
    val account: String?,
    val source: String,
    val syncStatus: String,
    val attempts: Int,
    val nextAttemptAt: Long?,
    val lastAttemptAt: Long?,
    val lastErrorCode: String?,
    val serverTransactionId: String?,
    val createdAt: Long,
    val updatedAt: Long
)
```

Estados locales:

```text
pending  -> listo para enviar
syncing  -> reclamado por un worker
retry    -> fallo temporal; espera nextAttemptAt
synced   -> confirmado por el backend
failed   -> fallo permanente o dato inválido; requiere revisión
```

Reglas:

- se inserta como `pending` antes de solicitar trabajo;
- el DAO reclama filas elegibles dentro de una transacción;
- al iniciar la app, elementos `syncing` demasiado antiguos vuelven a `retry`;
- `created` y `already_exists` guardan `serverTransactionId` y pasan a `synced`;
- timeout, `429` y `5xx` pasan a `retry` con backoff;
- `422` pasa a `failed` con un código legible, sin cuerpos sensibles;
- `401` conserva la fila y solicita reemparejamiento;
- los sincronizados pueden purgarse después de un periodo corto, nunca antes de confirmar.

La credencial Android no se guarda en Room; vive en almacenamiento cifrado respaldado por Android Keystore.

## 7. DTOs y mapeo

### `DeviceTransactionSyncInput`

```ts
type DeviceTransactionSyncInput = {
  clientTransactionId: string; // UUID
  amount: string;              // decimal positivo, máximo 2 decimales
  currency: string | null;     // ISO 4217
  occurredAt: string;          // ISO 8601 con offset/Z
  description: string | null;
  type: "income" | "expense";
  account: string | null;
  source: "io_notification" | "yape_notification" |
          "google_wallet_notification";
};
```

El backend añade `userId`, `deviceId` y `processingStatus`; el cliente no puede enviarlos.

### `CreateManualTransactionInput`

Contiene los campos financieros excepto `clientTransactionId` y `source`; permite `categoryId`. El backend asigna los metadatos manuales.

### `UpdateTransactionInput`

Todos los campos son opcionales, debe existir al menos uno y solo admite: `amount`, `currency`, `occurredAt`, `description`, `type`, `account`, `categoryId`. Para limpiar un campo opcional se envía `null`; ausencia significa “no cambiar”.

### `TransactionDto`

Devuelve campos financieros, categoría, fuente, estado y auditoría. `amount` es string y las fechas salen en ISO 8601 UTC. No devuelve `userId`, `deviceId` ni hashes.

Los esquemas Zod son la definición ejecutable de los DTO web y TypeScript infiere tipos con `z.infer`. Kotlin mantiene DTOs equivalentes escritos a mano; pruebas con ejemplos JSON evitan divergencias. No se añade generación OpenAPI en el MVP.

## 8. Idempotencia y concurrencia

La identidad de una captura es `(userId, clientTransactionId)`. El UUID se genera antes de escribir Room y nunca cambia.

El endpoint intenta crear la fila. Si PostgreSQL informa violación de unicidad:

1. consulta la existente usando el mismo par;
2. verifica el usuario derivado de la credencial;
3. devuelve su ID con `syncResult=already_exists`.

No se hace “buscar y luego insertar”. La restricción única es la autoridad bajo concurrencia. No se comparan monto, fecha o descripción para fusionar eventos distintos.

## 9. Consultas y resumen

Las listas comienzan por `userId` y aplican filtros opcionales por rango, categoría, tipo y cuenta. Se ordenan por `occurredAt DESC, id DESC` y se paginan con máximo 100.

```text
income   = SUM(amount WHERE type = income)
expenses = SUM(amount WHERE type = expense)
balance  = income - expenses
```

El resumen agrupa por `currency`. Nunca se suman silenciosamente monedas distintas. Las transacciones con `currency=null` se reportan por separado y no forman parte de un total monetario único.

## 10. Migración inicial y seed

La primera migración crea enums, tablas, claves foráneas, restricciones e índices. Después:

1. el bootstrap crea o actualiza el propietario por email;
2. el seed inserta categorías para ese usuario mediante `upsert`;
3. una prueba arranca desde una base vacía y aplica todas las migraciones;
4. otra prueba verifica la idempotencia concurrente.

Las migraciones aplicadas son inmutables. En producción se usa `prisma migrate deploy`, no `db push`. Los cambios destructivos futuros se harán en fases compatibles.

## 11. Retención y privacidad

- PostgreSQL no almacena el texto completo de notificaciones, solo campos normalizados.
- Room conserva lo necesario para sincronizar y códigos de diagnóstico.
- Tokens y códigos se almacenan como hashes; contraseñas con Argon2id.
- Los logs no contienen cuerpos financieros completos ni credenciales.
- Sesiones y códigos vencidos pueden purgarse periódicamente.
- Revocar un dispositivo o sesión no elimina historial financiero.

## 12. Fuera del modelo actual

Se posponen `Account`, `Merchant`, `TransactionEvidence`, `EmailSource`, reglas de categoría, presupuestos y relaciones de deduplicación. Cuando entren correo o múltiples evidencias, podrá añadirse `TransactionEvidence` sin cambiar la identidad principal de `Transaction`.
