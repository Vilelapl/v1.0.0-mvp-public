# Operación y preparación de producción

El MVP usa una instancia de Express, archivos estáticos React y PostgreSQL.
Esta guía prepara un despliegue; no afirma que exista infraestructura pública.
La elección de proveedor, dominio y recursos externos corresponde al propietario.

## Configuración

1. Instalar Node.js 24 compatible y PostgreSQL. Mantener la base en red privada
   o loopback; publicar únicamente el proxy HTTPS.
2. Preparar `backend/.env` desde [`.env.example`](../.env.example), o inyectar
   esas variables con el gestor de procesos de la plataforma. No versionar secretos.
3. Para producción, usar `NODE_ENV=production`, `PORT=3000` y
   `WEB_ORIGIN=https://<dominio-real>` sin slash final. La cookie sigue siendo
   `HttpOnly`, `Secure`, `SameSite=Strict`. Nunca desactivar Secure para hacerla funcionar.
4. Compilar web con `VITE_API_BASE_URL=/api/v1`. Es una ruta pública; ninguna
   contraseña, token ni `DATABASE_URL` puede aparecer en `VITE_*`.
5. `BOOTSTRAP_USER_EMAIL` solo se necesita en bootstrap/seed y
   `BOOTSTRAP_USER_PASSWORD` solo en bootstrap. Retirarlas del proceso servidor.
   Repetir bootstrap cambia la contraseña del propietario indicado; no ejecutarlo
   en cada reinicio del servidor.

`TEST_DATABASE_URL` pertenece exclusivamente a pruebas sobre una base desechable
cuyo nombre contenga `test`; la suite borra datos allí. Nunca apuntarla a producción.

## Roles de PostgreSQL

Usar un rol de migración propietario del esquema y un rol distinto para la app,
ambos sin superusuario, creación de roles ni creación de bases. El administrador
crea la base una vez; sus credenciales globales no van en `DATABASE_URL` de la app.

Después de migrar, conectado como propietario del esquema, adaptar los nombres:

```sql
REVOKE CREATE ON SCHEMA public FROM PUBLIC;
GRANT USAGE ON SCHEMA public TO gestor_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON
  users, web_sessions, pairing_codes, devices, categories, transactions
  TO gestor_app;
```

El rol app no necesita modificar el esquema ni `_prisma_migrations`. En futuras
migraciones otorgar solo los permisos que requieran las nuevas tablas. Limitar
también la conectividad mediante firewall/reglas del proveedor. Si la conexión
cruza una red, verificar TLS y la CA del proveedor; no desactivar la validación
de certificados. Conservar las opciones UTC de la fábrica Prisma.

## Construcción y activación

Desde `backend/`, instalar también herramientas de build y migración:

```text
npm ci
npm run prisma:validate
npm run prisma:generate
npm run typecheck
npm run build
npm run prisma:migrate:deploy
npm run bootstrap
npm run db:seed
```

Los tres últimos comandos se ejecutan con el entorno administrativo apropiado:
migración con su rol; bootstrap y seed con acceso de escritura y el email inicial.
Comprobar `npm run prisma:migrate:status`. No usar `db push` ni cambiar SQL de
migraciones ya aplicadas. Antes de una migración riesgosa, realizar backup.

Desde `web/`:

```text
npm ci
npm run typecheck
npm test -- --maxWorkers=1
npm run build
```

Servir `web/dist/` y reenviar `/api/` a Express bajo el mismo origen. El proxy
de desarrollo Vite no existe dentro de `dist`; `vite preview` no es el servidor
de producción. [La plantilla nginx](../deploy/nginx.conf.example) incluye rutas
SPA, API y health. Es una plantilla: sustituir dominio, rutas y certificado y
validar `nginx -t` en el host elegido antes de recargarlo.

Ejecutar `npm start` desde `backend/` mediante el supervisor del proveedor, con
reinicio ante fallo y un usuario de sistema sin privilegios. Excluir del artefacto
`.env`, `.cache`, bases, logs de pruebas, capturas y credenciales administrativas.
Conservar `dist/`, Prisma generado/compilado, dependencias de ejecución y migraciones.
El puerto de Node no debe quedar públicamente accesible.

TLS termina en el proxy/plataforma con un certificado válido. Express mantiene
`trust proxy=false`: ignora cabeceras IP del cliente y sus límites de login/pairing
se comparten entre clientes que pasan por el proxy. Para este MVP de un propietario
es una limitación aceptada; múltiples instancias o usuarios requieren revisar esa
política explícitamente. No habilitar confianza global en cabeceras reenviadas.

## Health, cierre y logs

- `GET /health/live`: liveness del proceso, sin consultar PostgreSQL.
- `GET /health/ready`: consulta real de PostgreSQL; `200` cuando está disponible
  y `503` cuando falla, con respuesta acotada a tres segundos. No contiene nombres
  de base, versiones, credenciales ni SQL.
- El supervisor debe conceder tiempo para drenar HTTP y desconectar Prisma al
  recibir SIGTERM/SIGINT. El límite total es diez segundos; al excederlo termina
  con código de error. Comprobar esa integración en el host de despliegue.
- Logs de la app: requestId, método, ruta registrada, estado y duración; sin
  cuerpos, cookies, Authorization, passwords ni notificaciones completas.
  Evitar que el proxy/proveedor registre query strings, cabeceras sensibles o
  cuerpos. Limitar acceso y retención de logs, incluidos los de error del proxy:
  pueden contener la URI incluso con el access log desactivado.

## Backup y restauración

Recomendación mínima: backup diario de PostgreSQL, retención de 7 diarios y
4 semanales, copia cifrada fuera del host y verificación mensual de restauración.
Un backup antes de migraciones riesgosas es adicional al diario. Pueden usarse
backups gestionados del proveedor si se prueba su restauración y retención.

Respaldar todas las tablas, esquema y registro de migraciones. Conservar también
la versión de código, configuración operativa y secretos en un almacén seguro
separado del repositorio. Room es cola local: no reemplaza un backup PostgreSQL;
desinstalar Android o borrar sus datos pierde los registros aún no sincronizados.

Ejemplo con cliente PostgreSQL compatible, host/base/usuario reales y contraseña
mediante almacén seguro o archivo pgpass protegido; no ponerla en la línea de comando:

```text
pg_dump --host=HOST_PRIVADO --username=ROL_BACKUP --dbname=BASE --format=custom --file=gestor-AAAA-MM-DD.dump
pg_restore --list gestor-AAAA-MM-DD.dump
```

El rol backup debe poder leer todas las tablas, incluida `_prisma_migrations`.
No copiar un directorio de datos PostgreSQL en uso como sustituto de `pg_dump`.

Para restaurar, crear **otra base vacía**, detener escrituras hacia ella y usar
su rol de migración/propietario, con permisos sobre el esquema:

```text
pg_restore --host=HOST_PRIVADO --username=ROL_MIGRACION --dbname=BASE_RESTAURADA --no-owner --no-privileges --exit-on-error gestor-AAAA-MM-DD.dump
```

Reaplicar permisos del rol app; comprobar migraciones, cantidades de filas,
propietario/categorías, dinero/instantes y health/lectura HTTP antes de cambiar
el destino de la aplicación. Conservar la base original hasta verificar la
restauración. No ejecutar bootstrap salvo que se quiera cambiar la contraseña.

## Android y smoke de puesta en marcha

Compilar/probar según [Android](../android/README.md). El APK release exige HTTPS
y debe firmarse con una clave propia protegida, conservada fuera del repositorio.
La firma release y la distribución se completan en el entorno del propietario;
un APK debug de pruebas no acredita una distribución de producción.

Emparejar Android con la URL HTTPS definitiva y un código de uso único emitido
desde la sesión web. El mecanismo administrativo de pairing está descrito en el
README raíz/Android; el dashboard actual no incluye una pantalla de dispositivos.
No enviar el device token al navegador. Revisar la asociación local de tarjetas
Wallet al instalar desde cero: aún se configura mediante diagnóstico de desarrollo.

Validar una notificación real → Room → WorkManager → API → PostgreSQL → dashboard,
el mismo UUID tras un retry, y captura pendiente al perder acceso al backend.
Recuperar conexión y verificar `synced`/una sola fila. Conservar como evidencia
solo fuente, IDs técnicos, estados y resultados. No simular notificaciones y
presentarlas como reales. Al acabar pruebas USB, retirar diagnóstico, desactivar
Depuración USB y restaurar Bloqueador automático si se desactivó.

## Checklist de activación

- [ ] Proveedor/recursos externos aprobados por el propietario.
- [ ] PostgreSQL privado y roles de migración/app preparados.
- [ ] DATABASE_URL y variables backend configuradas.
- [ ] Backup y restauración comprobados.
- [ ] Migraciones deploy/status correctas; propietario y ocho categorías presentes.
- [ ] Backend compilado bajo supervisor y puerto privado.
- [ ] WEB_ORIGIN exacto, HTTPS válido y cookie Secure activa.
- [ ] Web compilada con `/api/v1`; proxy SPA/API configurado.
- [ ] Health live/ready correctos; caída de BD devuelve ready 503.
- [ ] Firma Android propia, URL definitiva y dispositivo emparejado.
- [ ] Notification Access y asociación Wallet revisados.
- [ ] Smoke real completo, offline/retry e idempotencia comprobados.
- [ ] Logs sin datos sensibles y limitaciones comunicadas.

## Limitaciones del MVP

IO y Wallet pueden representar el mismo pago en dos filas y ambas cuentan en los
totales. No hay fusión entre fuentes. Algunas fechas son la publicación de la
notificación. Android requiere teléfono encendido, Notification Access y ejecución
de WorkManager bajo Doze/políticas del fabricante; no se garantiza entrega inmediata.
Solo se admiten formatos observados; Wallet requiere asociación exacta de tarjeta.
No se incluyen correo, IA, presupuestos, conciliación ni analítica avanzada.

## Dependencias pendientes de corregir

Revisión del 17/09/2026 sobre el informe guardado de `npm audit --omit=dev`:
**cuatro entradas high** (`prisma`, `@prisma/config`, `deepmerge-ts`, `mysql2`).
Incluyen tres avisos subyacentes y su propagación a paquetes superiores.
Persisten en el lockfile. Aunque `prisma` figura en `devDependencies`,
`@prisma/client@7.10.0` también lo declara como peer opcional; `npm explain prisma
--omit=dev` confirma esa relación y el lock marca la rama `devOptional`.
Omitir dependencias de desarrollo no acredita eliminarla del artefacto.

- `deepmerge-ts@7.1.5`, vía `@prisma/config`: agotamiento de pila al mezclar
  objetos con referencias cíclicas; JSON normal no crea esas referencias.
  [Aviso del mantenedor](https://github.com/RebeccaStevens/deepmerge-ts/security/advisories/GHSA-ggr8-5vv4-36mx).
- `mysql2@3.15.3`, vía Prisma CLI: un servidor MySQL malicioso puede solicitar
  autenticación que revela la contraseña sin TLS.
  [Aviso de autenticación](https://github.com/sidorares/node-mysql2/security/advisories/GHSA-3f6p-5ww8-9rcr).
- La misma versión tiene un aviso moderado de consumo descontrolado de memoria
  con compresión habilitada y un servidor MySQL malicioso o comprometido.
  [Aviso de descompresión](https://github.com/sidorares/node-mysql2/security/advisories/GHSA-rgwj-5xj2-c3m3).

La revisión del código actual no identifica una ruta HTTP hacia esas operaciones:
Express usa el cliente generado y `@prisma/adapter-pg`; solo `prisma.config.ts`
administrativo importa `prisma/config`, con configuración local, y no hay conexiones
MySQL. Mantener el CLI en tareas administrativas con archivos y destinos confiables,
sin publicar Studio ni aceptar configuración externa. Esto limita la exposición;
no corrige los paquetes ni demuestra riesgo cero.

Antes del despliegue público, revisar una actualización compatible de la familia
Prisma que corrija estas transitivas y repetir regresión y auditoría del artefacto
final. El informe propone Prisma `6.19.3` mediante cambio mayor; no se aplicó ese
retroceso ni `npm audit fix --force`. No asumir que `--omit=dev` resuelve el pendiente.
