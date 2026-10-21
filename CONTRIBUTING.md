# Trabajar en este repositorio

El repositorio contiene el MVP personal de Gestor Financiero. Antes de ampliar
funcionalidades, consulta el [alcance](contexto/MVP.md), los
[requerimientos actuales](docs/REQUERIMIENTOS.md) y las [reglas de datos](docs/DATOS.md).

## Entorno

Sigue la [guía de instalación](docs/GITHUB.md). Instala con `npm ci`, conserva los
lockfiles y regenera Prisma. Usa una base separada cuyo nombre contenga `test`
para las suites del backend; las pruebas eliminan sus datos.

## Cambios y comprobaciones

Crea una rama a partir de `main` y describe el problema, el cambio y su validación
al preparar un commit o una solicitud de cambios. Ejecuta las comprobaciones
correspondientes a la parte modificada:

| Área | Comprobaciones |
|---|---|
| Backend | Prisma validate/generate, typecheck, pruebas con PostgreSQL y build |
| Web | Typecheck, pruebas Vitest y build |
| Android | Pruebas debug/release, lint y compilación del APK |
| Documentación | Enlaces, comandos, consistencia con implementación y alcance |

Los comandos completos y particularidades de Windows están en las guías de cada
componente y en el [informe de validación](docs/PREPARACION_GITHUB.md).

Conserva la precisión decimal, el aislamiento por propietario y la idempotencia.
Las migraciones nuevas deben ser aditivas al historial; no reescribas una migración
ya aplicada. Si modificas contratos o comportamiento, actualiza la documentación
y añade una regresión cuando sea necesaria.

## Archivos locales

Configura secretos fuera de Git y utiliza `.env.example` para documentar nombres
y valores ficticios. Antes de subir, revisa `git status` y `git diff --cached`.
Los APKs, bases, logs, cachés y claves de firma quedan excluidos. Las pruebas y
capturas de documentación deben usar datos sintéticos o muestras anonimizadas.
