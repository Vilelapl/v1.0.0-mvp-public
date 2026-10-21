# Validación local del Hito 9

Este documento resume comprobaciones reproducibles sin incluir evidencias de
movimientos, dispositivos o bases de datos reales. Las capturas y los reportes
privados de la validación física permanecen fuera del repositorio.

## Regresión automatizada

| Componente | Comprobación registrada al preparar el repositorio |
|---|---|
| Backend | 112 pruebas, Prisma validate/generate, typecheck y build |
| PostgreSQL | Migraciones aplicadas en una base temporal vacía y estado al día |
| Web | 91 pruebas, typecheck y build |
| Android | 63 pruebas debug y 63 release, APK debug y lint sin errores |

Los comandos y las condiciones están en [PREPARACION_GITHUB.md](PREPARACION_GITHUB.md).
Tras el saneamiento se verificó que las 11 fixtures Android son JSON válido,
con fechas sintéticas distintas y los cuatro campos que leen los tests.
La suite Android no se volvió a ejecutar en este commit. La suite web pasó
91 pruebas tras sustituir las fechas de su fixture.

## Contratos comprobados

- Login/logout, sesiones protegidas y aislamiento por propietario.
- Pairing temporal, revocación y autenticación de dispositivos.
- Sincronización idempotente por UUID y conservación de correcciones web.
- Dinero decimal, fechas UTC/Lima y resúmenes separados por moneda.
- Cola Room, estados, reintentos, recuperación y parsers por fuente.
- Health checks y cierre ordenado del backend.

## Límites

La compilación y las pruebas locales no significan que exista infraestructura
de producción. Los formatos de notificación soportados son los documentados;
no hay deduplicación entre aplicaciones. La primera ejecución en otro equipo
necesita descargar dependencias y configurar PostgreSQL y Android SDK según la
[guía de desarrollo](GITHUB.md).
