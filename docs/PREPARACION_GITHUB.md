# Verificación de la copia para GitHub

Fecha: 1 de octubre de 2026. Copia técnica inicial del MVP.

Este informe registra la preparación local previa a la publicación. Los conteos
y el estado Git de esa etapa se conservan como evidencia histórica; después se
organizó la documentación para el repositorio distribuible.

## Contenido y separación del original

Se copiaron 204 archivos conservando las carpetas de fuentes, pruebas,
documentación, migraciones, esquemas y configuración reproducible. La copia
inicial se verificó archivo por archivo con SHA-256. Se añadieron
`.gitattributes`, `docs/GITHUB.md` y este informe: 207 archivos para el repositorio.

El proyecto original se utilizó exclusivamente como entrada de lectura.
La comprobación SHA-256 de sus 205 archivos de fuentes y configuración
(incluido `local.properties`, que no se distribuye) no encontró cambios.
Las carpetas de dependencias, cachés, builds y `.git` originales no se incluyeron
en ese inventario de hashes ni se utilizaron como destinos de escritura.

No se copió el `.git` original: la copia tiene un repositorio nuevo e independiente.
Se conservaron ambos `.env.example`, los dos lockfiles, las migraciones SQL,
el esquema Room y el Gradle Wrapper con su checksum.

## Exclusiones y ajustes

- Sin `.env`, `.cache/`, bases locales, backups, logs, APKs o artefactos de build.
- Sin `node_modules/`, Prisma generado, cachés Gradle o configuración local del SDK.
- `.gitignore` reforzado para bases, respaldos, paquetes Android y claves privadas.
- `.gitattributes` fija finales de línea portables y conserva binarios.
- `android/gradlew` tiene permiso ejecutable en el índice Git para Linux/macOS.
- Guías de instalación actualizadas con `npm ci`, generación Prisma y SDK propio;
  no dependen de rutas ni scripts de la caché histórica del equipo original.
- Limpieza de espacios finales en `contexto/requerimietos.md` y de líneas vacías
  finales en `ESTADO_PROYECTO.md` y `MainActivity.kt`, sin cambios de comportamiento.
- No se cambiaron versiones de paquetes, dependencias, lógica financiera ni migraciones.

## Reproducibilidad comprobada

Herramientas de validación: Node.js 24.15.0, npm 11.12.1, PostgreSQL 18.4,
JDK 23.0.1, Gradle 8.13 y Android SDK 36.

| Comprobación | Resultado |
|---|---|
| `npm ci` en backend y web | Correcto desde los lockfiles, descargando paquetes |
| Backend: Prisma validate/generate, typecheck y build | Correcto |
| Backend: Vitest con PostgreSQL temporal vacío | 112 pruebas aprobadas |
| Migraciones backend | Aplicadas y estado al día |
| Web: typecheck y build | Correcto |
| Web: Vitest | 91 pruebas aprobadas |
| Android: `testDebugUnitTest` | 63 pruebas aprobadas |
| Android: `testReleaseUnitTest` | 63 pruebas aprobadas |
| Android: `assembleDebug` | Correcto |
| Android: `lintDebug` | 0 errores; 26 advertencias |
| Android: `lintRelease` | 0 errores; 26 advertencias |

La suite web utilizó `--maxWorkers=1 --pool=threads --no-isolate --testTimeout=20000`
por el coste de arranque de workers en Windows. La suite backend aplicó las
migraciones a una instancia PostgreSQL nueva, con puerto propio y datos sintéticos;
la instancia se detuvo al finalizar. Incluye las regresiones de bootstrap y seed.

Android se compiló desde fuentes limpias, con copias temporales independientes
del SDK, caché de dependencias y runtime Robolectric ya descargados. Se usaron
`--offline --no-daemon --max-workers=2`, compilador Kotlin en proceso y un init
script temporal que señalaba ese runtime y una unidad temporal corta para SQLite.
El primer intento encontró dos fallos por la longitud de rutas temporales en
Windows; se corrigió solo el entorno, se repitió la suite y se retiró la unidad. No se reutilizaron APKs ni resultados de compilación
del proyecto original. Una instalación nueva necesita descargar esas
herramientas/dependencias según `docs/GITHUB.md`. No se repitieron pruebas físicas
en el teléfono ni el smoke con navegador. Los archivos generados por estas
comprobaciones se retiraron de la copia antes de prepararla en Git.

## Revisión de secretos y Git

Se revisaron patrones de claves privadas, tokens de proveedores, JWT, URLs con
credenciales, asignaciones de contraseñas/tokens, correos y rutas personales.
También se revisaron cadenas de alta entropía, URLs de los lockfiles y la imagen
de documentación. No se detectaron secretos reales ni rutas personales sensibles.
Las coincidencias revisadas son placeholders, datos ficticios de tests, nombres
y versiones de dependencias y el alfabeto usado para generar códigos de pairing.
Las fixtures de notificaciones conservan sus marcadores de anonimización.

Comprobaciones finales: búsqueda de secretos repetida, prueba de reglas de
`.gitignore`, revisión del listado preparado, `git diff --cached --check` y
`git status`. Al cerrar aquella etapa había 207 altas preparadas para el primer
commit, sin cambios pendientes fuera del índice. La rama era `main`, aún sin
commits ni remotos; en esa etapa no se creó un repositorio ni se hizo push.

## Preparación de la publicación

Se añadió un README de entrada, un índice documental, una lista de requerimientos
vigentes, resúmenes de arquitectura y datos y una guía de colaboración. La
referencia técnica extensa y los documentos originales de diseño se conservaron.
Esta organización documental no modifica el código ni las dependencias que
pasaron las pruebas anteriores. El repositorio público tiene la rama principal `main` y contiene solo el
árbol saneado.

Para continuar: [instrucciones de instalación y desarrollo](GITHUB.md).
