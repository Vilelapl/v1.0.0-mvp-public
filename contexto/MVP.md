# Alcance cerrado del MVP — Gestor financiero personal

## Resultado esperado

Una aplicación Android detecta movimientos desde notificaciones de IO, Yape y Google Wallet, los conserva aunque no haya red, los sincroniza de forma segura y el dashboard web permite consultarlos, filtrarlos, crearlos y corregirlos.

## Incluido

1. **Captura Android**
   - Kotlin y `NotificationListenerService`.
   - Parser independiente por fuente.
   - Extracción de monto, moneda cuando sea conocida, fecha/hora, descripción, tipo, cuenta y fuente.
   - Room como cola durable y WorkManager para sincronización y reintentos.
   - Retrofit + OkHttp para HTTPS.

2. **Backend y persistencia**
   - Node.js + TypeScript + Express.
   - Zod para entradas y configuración.
   - Prisma ORM, migraciones Prisma y PostgreSQL.
   - Idempotencia por `clientTransactionId`; no deduplicación entre eventos distintos.
   - Errores JSON consistentes y logs sin secretos ni notificaciones completas.

3. **Dashboard**
   - React + TypeScript + Vite.
   - `fetch` nativo mediante un wrapper común.
   - Balance/resumen, ingresos, gastos y lista paginada.
   - Filtros por fecha, categoría, tipo y medio de pago.
   - Alta y edición manual, especialmente categoría y descripción.
   - Categorías predefinidas y asignación manual.

4. **Autenticación personal segura**
   - Un propietario creado administrativamente; sin registro público.
   - Dashboard con sesión opaca en cookie segura `HttpOnly`.
   - Android emparejado con código de un solo uso y token de dispositivo revocable guardado mediante Android Keystore.
   - Solo hashes de sesiones y tokens en PostgreSQL; ningún secreto fijo en React o Android.

5. **Calidad operativa mínima**
   - Variables de entorno validadas y `.env.example` sin secretos.
   - Migraciones versionadas y seed idempotente de categorías.
   - Pruebas críticas de parsers, dinero y fechas, autenticación, Room/WorkManager, API e idempotencia concurrente.

## No incluido

- lectura o análisis de correos;
- agentes, extracción o categorización con IA;
- deduplicación avanzada o fusión entre fuentes;
- cuentas bancarias como entidad, conciliación o saldos por cuenta;
- presupuestos, alertas, proyecciones o analítica avanzada;
- registro público, recuperación de contraseña y administración multiusuario;
- iOS u otras plataformas móviles.

## Criterios de aceptación

- Una notificación válida se guarda primero en Room y se sincroniza al recuperar conectividad.
- Repetir el mismo envío no crea otra transacción.
- Un dispositivo revocado deja de sincronizar y ninguna aplicación cliente contiene secretos de servidor.
- El dashboard trabaja con datos reales de PostgreSQL y permite resumen, lista, filtros, alta y edición.
- Dinero se maneja como decimal y las fechas como ISO 8601 con zona.
- El proyecto puede recrearse desde una base vacía aplicando migraciones, seed y bootstrap documentados.

Los detalles implementables, contratos, estructura y pruebas están en `ARQUITECTURA_MVP.md`; el esquema y las reglas de persistencia están en `MODELAMIENTO_DATOS_MVP.md`.
