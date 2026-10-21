# Requerimientos vigentes del MVP

Esta lista resume el alcance implementado. Complementa la
[definición cerrada del MVP](../contexto/MVP.md) y distingue la implementación
actual de los [requerimientos iniciales](../contexto/requerimietos.md), que también
proponían correo, IA y fusión de operaciones.

## Funcionales

| ID | Requerimiento | Alcance actual |
|---|---|---|
| RF-01 | Capturar notificaciones financieras Android | IO, Yape y Google Wallet; formatos observados y probados |
| RF-02 | Ignorar notificaciones no procesables | Parsers por fuente; no inventar importes, monedas ni datos ausentes |
| RF-03 | Normalizar movimientos | Importe decimal, moneda cuando se conoce, instante, tipo, cuenta, descripción y fuente |
| RF-04 | Conservar capturas sin conexión | Room persiste primero, asignando un UUID estable |
| RF-05 | Sincronizar al recuperar conectividad | WorkManager, reintentos y confirmación por el backend |
| RF-06 | Hacer idempotente un reenvío | El mismo propietario y UUID cliente producen una sola fila |
| RF-07 | Autenticar al propietario | Bootstrap administrativo, login y logout; sin registro público |
| RF-08 | Emparejar y revocar Android | Código temporal, credencial protegida por Keystore; endpoints de dispositivos |
| RF-09 | Consultar movimientos | Lista paginada y filtros por fechas, categoría, tipo y cuenta |
| RF-10 | Crear y corregir manualmente | Formulario web, validación y persistencia; auditoría del origen y estado |
| RF-11 | Asignar categorías | Categorías iniciales por propietario y selección manual |
| RF-12 | Mostrar resumen mensual | Ingresos, gastos y balance separados por moneda; fechas en Lima |
| RF-13 | Mostrar ciclo iO | Gastos de la cuenta configurada en el código para el ciclo 26–25 |
| RF-14 | Comprobar disponibilidad | Health checks de proceso y de conexión a PostgreSQL |

La gestión de dispositivos está disponible por API; el dashboard actual no tiene
una pantalla dedicada. La asociación de tarjetas Wallet es local y aún no cuenta
con editor en la interfaz mínima Android. El filtro de cuenta compara su texto;
no equivale a filtrar por aplicación fuente.

## Reglas de calidad

| ID | Regla | Evidencia en el proyecto |
|---|---|---|
| RNF-01 | Precisión monetaria | Strings en DTOs; `Decimal(14,2)` en PostgreSQL; sin suma monetaria con coma flotante |
| RNF-02 | Coherencia temporal | ISO 8601 con zona, persistencia UTC y presentación en `America/Lima` |
| RNF-03 | Aislamiento por propietario | Consultas y mutaciones filtran por usuario autenticado |
| RNF-04 | Protección de credenciales | Argon2id, hashes de tokens, cookies HttpOnly y Keystore |
| RNF-05 | Persistencia y recuperación | Cola Room, estados de sincronización y reintentos verificables |
| RNF-06 | Reproducción del entorno | Lockfiles, migraciones, Gradle Wrapper, variables de ejemplo y guías |
| RNF-07 | Privacidad en diagnósticos | Redacción de datos y exclusión de secretos, bases y evidencias locales de Git |
| RNF-08 | Operación básica | Readiness, cierre ordenado, procedimiento de backups y restauración |

## Criterios de aceptación

- Una captura válida se conserva localmente y puede enviarse tras recuperar red.
- Reenviar el mismo UUID no duplica la transacción ni revierte correcciones web.
- Un dispositivo revocado deja de poder sincronizar.
- La web consulta datos de PostgreSQL y persiste altas y ediciones manuales.
- Los importes mantienen precisión decimal y los resúmenes no mezclan monedas.
- Una base vacía puede prepararse mediante migraciones, bootstrap y seed.

Los resultados y el alcance de las pruebas están en
[PREPARACION_GITHUB.md](PREPARACION_GITHUB.md) y [HITO9_VALIDACION.md](HITO9_VALIDACION.md).

## Fuera del MVP

Correo electrónico, IA, categorización automática, deduplicación entre fuentes,
conciliación, entidades bancarias/cuentas con saldos, presupuestos, alertas,
proyecciones, registro público, recuperación de contraseña, administración
multiusuario e iOS. No se afirma soporte para formatos de notificación no observados.

La hora de publicación Android puede usarse como fecha de captura cuando el
aviso no contiene fecha; no siempre representa el instante financiero exacto.
IO y Wallet pueden registrar el mismo pago en filas distintas y sumar ambas.
