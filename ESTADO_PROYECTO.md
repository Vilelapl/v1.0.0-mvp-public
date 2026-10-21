# Estado del proyecto — Gestor Financiero

El MVP Android + API + dashboard está implementado y validado localmente. No hay
un despliegue permanente. El alcance y las limitaciones están en
[Requerimientos](docs/REQUERIMIENTOS.md) y [MVP](contexto/MVP.md).

## Componentes

- Android: captura de notificaciones admitidas, parsers, Room, WorkManager,
  pairing y recuperación de reintentos.
- Backend: autenticación, dispositivos, movimientos, categorías, resúmenes,
  Prisma y PostgreSQL.
- Web: sesión, lista, filtros, alta y edición manual, resumen mensual y ciclo iO.

No existe deduplicación entre eventos de fuentes distintas. IO y Wallet pueden
representar una misma compra en dos filas; ambas cuentan en los totales.

## Verificación técnica

La [verificación de la copia](docs/PREPARACION_GITHUB.md) registró 112 pruebas
del backend, 91 de la web y 63 por variante Android, más compilaciones y lint.
Tras reemplazar los metadatos observados por fechas sintéticas, la suite web
pasó 91 pruebas y se comprobó la estructura JSON de las 11 fixtures Android.
La suite Android no se volvió a ejecutar en este commit; consulta
[la validación](docs/HITO9_VALIDACION.md).
Las evidencias vinculadas con movimientos o dispositivos reales se mantienen
fuera del repositorio.

## Pendientes

Para uso diario hacen falta backend y PostgreSQL disponibles, dominio/HTTPS,
backups operativos y firma de distribución Android. La
[guía de producción](docs/PRODUCCION.md) describe esos pasos. Correo, IA,
categorización automática, conciliación y presupuestos están fuera del MVP.
