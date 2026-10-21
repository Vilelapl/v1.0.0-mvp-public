# Instalación y desarrollo

Esta carpeta es una copia independiente del MVP. Se conservan todas las fuentes,
pruebas, documentación, fixtures anonimizadas, migraciones SQL, esquemas Room,
`package-lock.json` y Gradle Wrapper (incluido su JAR y checksum).
Las versiones internas de la aplicación se conservan; el nombre de la carpeta
no cambia automáticamente la versión de los paquetes ni crea una release.

## Exclusiones

No se incluyen el historial/configuración `.git` del original, `.env`, `.cache/`,
`node_modules/`, Prisma generado, bases locales, backups, APKs, logs, resultados
de pruebas ni directorios de build. Tampoco se incluye `android/local.properties`.
`.gitignore` protege estos archivos y las claves de firma/credenciales habituales.
Se conservan `.env.example` y `web/.env.example` con valores ficticios.
Las referencias a `.cache/` en informes de hitos son históricas: esas evidencias
no se distribuyen y no son un requisito del código.

## Reproducir desde un clon nuevo

Requisitos: Node.js 24 compatible con los lockfiles, npm, PostgreSQL 18,
JDK compatible con Gradle 8.13 (validación local con JDK 23), Android SDK Platform
36, Build Tools 35.0.0 y Platform Tools. La primera instalación requiere acceso
a los registros de npm, Gradle, Google Maven y Maven Central.

### Backend

Desde la raíz, copiar `.env.example` a `backend/.env` y completar los valores
locales. Crear en PostgreSQL una base de desarrollo y otra **desechable** cuyo
nombre contenga `test`. Configurar `DATABASE_URL` y `TEST_DATABASE_URL` con las
URLs de esas bases; las contraseñas con caracteres especiales deben codificarse
en la URL. No usar las credenciales ficticias de la plantilla en producción.

Desde `backend/`:

```text
npm ci
npm run prisma:validate
npm run prisma:generate
npm run prisma:migrate:deploy
npm run prisma:migrate:status
npm run bootstrap
npm run db:seed
npm run typecheck
node --env-file=.env ./node_modules/vitest/vitest.mjs run
npm run build
npm run dev
```

`bootstrap` y `db:seed` requieren el email administrativo; bootstrap también
requiere una contraseña de al menos 12 caracteres. Retirar las variables
administrativas del proceso habitual una vez creado el propietario.
Las pruebas aplican las migraciones y eliminan datos solo en `TEST_DATABASE_URL`;
comprobar que apunta a una base separada. El comando Node anterior carga `.env`
para Vitest; si las variables ya están en el proceso, se puede usar `npm test`.
El cliente Prisma se regenera: no se versiona `backend/generated/prisma/`.

### Web

Desde `web/`, copiar `.env.example` a `.env` solo si se necesitan valores distintos
de los predeterminados. El backend debe permitir `http://127.0.0.1:5173` como
`WEB_ORIGIN`. Ejecutar:

```text
npm ci
npm run typecheck
npm test -- --maxWorkers=1
npm run build
npm run dev
```

La web utiliza `/api/v1` y el proxy de Vite conecta con el backend local.
Solo introducir configuración pública en variables `VITE_*`.

### Android

Definir `JAVA_HOME` y `ANDROID_HOME` con las instalaciones del equipo actual,
aceptar las licencias del SDK y ejecutar desde `android/`:

```powershell
.\gradlew.bat testDebugUnitTest testReleaseUnitTest assembleDebug --no-daemon --max-workers=2 '-Pkotlin.compiler.execution.strategy=in-process'
```

En Linux/macOS usar `./gradlew` con los mismos argumentos. El wrapper descarga la
versión fijada de Gradle y valida su SHA-256. No necesita `local.properties` si
`ANDROID_HOME` está configurado. Las pruebas instrumentadas requieren un dispositivo;
la firma de release requiere un keystore propio, excluido del repositorio.

## Repositorio y colaboración

El repositorio público es
[`Vilelapl/v1.0.0-mvp-public`](https://github.com/Vilelapl/v1.0.0-mvp-public), con rama principal
`main`. Para obtener una copia:

```text
git clone https://github.com/Vilelapl/v1.0.0-mvp-public.git
cd v1.0.0-mvp-public
```

Para trabajar en una mejora, crea una rama desde `main`, verifica los archivos
preparados y ejecuta las comprobaciones correspondientes a los cambios:

```text
git switch -c nombre-del-cambio
git status --short
git diff --cached --check
```

Consulta [CONTRIBUTING.md](../CONTRIBUTING.md) y el
[informe de preparación](PREPARACION_GITHUB.md). El repositorio no incluye
credenciales, bases reales, firma Android ni una infraestructura desplegada.
Las versiones internas y los tags se gestionan de forma explícita: el nombre
del repositorio no los cambia automáticamente.
