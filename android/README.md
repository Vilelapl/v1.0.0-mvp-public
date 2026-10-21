# Android — captura y sincronización

La app Kotlin admite notificaciones financieras de IO, Yape y Google Wallet.
Valida los formatos soportados, persiste capturas en Room y sincroniza con
WorkManager. El pairing cifra la credencial con Android Keystore. Las fixtures
del repositorio usan texto redactado y fechas sintéticas; no hay datos de una
cuenta o un dispositivo real en ellas.

## Fuentes y límites

- IO: confirmación explícita de compra con importe en PEN.
- Yape: confirmación de ingreso con importe entero o decimal.
- Google Wallet: compra con tarjeta asociada localmente a una etiqueta.

Los avisos sin datos suficientes se ignoran. El nombre del remitente, comercio,
código de seguridad y alias exacto de tarjeta no se guardan como descripción de
un movimiento. Si falta fecha financiera, se usa `postTime` como instante de
captura; puede diferir de la fecha de la operación. IO y Wallet pueden generar
dos capturas del mismo pago porque no hay deduplicación entre fuentes.

## Compilar, probar e instalar

- Android mínimo API 26; compile/target SDK 36, Build Tools 35.0.0.
- JDK compatible con Gradle 8.13; este equipo usa JDK 23.0.1.
- AGP 8.13.2, Kotlin 2.2.21, KSP 2.2.21-2.0.4, Room 2.8.4.
- WorkManager 2.11.2, Retrofit 3.0.0, OkHttp/MockWebServer 4.12.0.

Configura `JAVA_HOME` con tu JDK y `ANDROID_HOME` con tu instalación del SDK.
Instala Platform 36, Build Tools 35.0.0 y Platform Tools, y acepta las licencias
del SDK. Android Studio también puede crear `local.properties` con `sdk.dir`;
ese archivo es local y queda ignorado por Git.

Desde `android/`, PowerShell:

```powershell
.\gradlew.bat testDebugUnitTest testReleaseUnitTest lint assembleDebug '-Pkotlin.compiler.execution.strategy=in-process' --console=plain --max-workers=2
# Solo con un emulador o teléfono preparado para pruebas:
.\gradlew.bat connectedDebugAndroidTest '-Pkotlin.compiler.execution.strategy=in-process'
```

En Linux/macOS, usar `./gradlew`. La primera ejecución descarga Gradle y las
dependencias de Google Maven, Maven Central y Robolectric. No se requiere la
caché histórica del equipo original ni su script `offline-tests.gradle`.
Para limitar el uso de memoria se puede añadir `--max-workers=2`.

APK: `app/build/outputs/apk/debug/app-debug.apk`. Desde la raíz del repositorio:

```powershell
$adb = Join-Path $env:ANDROID_HOME 'platform-tools/adb.exe'
& $adb devices -l
& $adb install -r '.\android\app\build\outputs\apk\debug\app-debug.apk'
& $adb shell am start -n com.gestorfinanciero/.ui.MainActivity
```

La instalación con `-r` conserva la cola; desinstalar o borrar datos la elimina.
Las pruebas instrumentadas de Keystore usan archivos, preferencias y alias
separados: no reemplazan el token real ni borran la cola del usuario.
Los resultados resumidos están en [la validación](../docs/HITO9_VALIDACION.md).

## Acceso a notificaciones

Abre **Gestor Financiero**, pulsa **Abrir acceso a notificaciones** y habilita el
acceso manualmente. El estado se actualiza al volver a la app. El servicio usa
`BIND_NOTIFICATION_LISTENER_SERVICE` y `exported=false`; no se solicitan SMS,
contactos ni permiso para publicar notificaciones.

Solo se leen extras de los paquetes admitidos. El listener conserva únicamente
un objeto efímero y delega en el parser. Room no almacena texto bruto, título,
paquete, clave de notificación, pairing code ni device token.

## Servidor de desarrollo y pairing

La UI solicita URL raíz del servidor (sin `/api/v1`, query, fragmentos ni
credenciales), nombre del dispositivo y código de emparejamiento. No hay una URL
de producción ficticia. Release exige HTTPS. Debug permite HTTP exclusivamente
hacia IPv4 privadas o loopback, para desarrollo.

En un teléfono físico, `localhost` no apunta al PC. Con USB y ADB puede crearse
explícitamente un túnel de desarrollo, suponiendo que el backend escucha en 3000:

```powershell
& $adb reverse tcp:3000 tcp:3000
```

**Solo después de crear ese túnel**, la URL Android puede ser
`http://127.0.0.1:3000/`. La conexión desaparece al desconectar ADB; no es una URL
de producción. Si se usa LAN, se debe introducir la IPv4 real del PC, con ambos
equipos en la misma red y el puerto accesible. No se presupone una dirección LAN.

En desarrollo se puede usar un backend local y un túnel ADB temporal. Las
capturas pendientes permanecen en Room si el servidor no está disponible.

Para obtener el código se reutiliza el mecanismo backend existente:

1. Iniciar sesión con `POST /api/v1/auth/login` usando el `Origin` configurado.
2. Con esa cookie y el mismo `Origin`, llamar a `POST /api/v1/devices/pairing-codes`.
3. Introducir el código temporal en Android y pulsar **Emparejar / reemparejar**.

Los contratos y la configuración PostgreSQL/backend están en la
[referencia técnica](../docs/REFERENCIA_TECNICA.md).
El código se consume una sola vez. No se guarda en Android ni en logs; el campo
se limpia al enviar y no participa en saved state o autofill. La app llama a
`POST /api/v1/devices/pair` con `code` y `deviceName`.

El token se cifra con AES-256-GCM y una clave generada en Android Keystore. El
archivo atómico cifrado vive en `noBackupFilesDir`; ni clave ni token se guardan
en Room. Las preferencias de conexión solo contienen URL pública y un indicador de
reemparejamiento; las de Wallet contienen hashes y etiquetas de cuenta. Backup y transferencia están deshabilitados. Pérdida de la
clave o ciphertext inválido requiere emparejar de nuevo, conservando la cola.

OkHttp añade Bearer únicamente al POST de sincronización en el servidor de la
credencial. Pairing no recibe Bearer. No hay logging HTTP, caché de respuestas,
cookies, redirects automáticos, autenticador ni retry oculto de OkHttp.
Los clientes comparten conexiones; cada llamada tiene un máximo de 20 segundos.

## Cola, sincronización y batería

El normalizador existente sigue generando un UUID una sola vez antes del INSERT.
Dinero y fechas viajan como strings. Se persiste `pending` antes de solicitar un
worker; ni el claim ni HTTP crean otro UUID.

- WorkManager usa solicitudes únicas de una ejecución con `NetworkType.CONNECTED`.
- Cada ejecución reclama como máximo 10 filas mediante el DAO transaccional del
  Hito 6, y envía secuencialmente los DTO normalizados.
- Una cadena inmediata con `APPEND_OR_REPLACE` conserva un nuevo aviso aunque
  llegue cuando el worker anterior está terminando. Los reintentos futuros usan
  otro trabajo único: su espera no bloquea las capturas nuevas.
- No hay polling, trabajo periódico, foreground service propio, loops de red
  permanentes ni wakelocks manuales. Una cola vacía no hace peticiones HTTP.
- Backoff exponencial: 1 minuto inicial, máximo 5 horas, conservado mediante los
  intentos persistidos en Room. WorkManager programa el plazo `nextAttemptAt`;
  los intentos no elegibles no se envían.
- Un `Retry-After` mayor programa una única ejecución para esa fecha. Lo mismo
  ocurre si solo queda un claim sin vencer: no se consulta periódicamente la cola.
- Los claims abandonados se recuperan tras 15 minutos, superior al máximo de un
  lote de 10 llamadas de 20 segundos. La recuperación conserva UUID e intentos.
- Toda finalización exige UUID, estado `syncing` y número de intento reclamado.
  La cancelación libera solamente claims propios; una respuesta tardía no puede
  reemplazar datos confirmados por otro intento.
- Ráfagas pueden dejar solicitudes sucesoras sin datos; esas solicitudes terminan
  sin red. Android puede diferir trabajo por Doze o restricciones del fabricante.
  La medición prolongada de batería sigue pendiente.

| Respuesta | Resultado local |
|---|---|
| 201 `created` / 200 `already_exists`, UUIDs válidos y coincidentes | `synced`, guarda `serverTransactionId` |
| timeout / fallo de red | `retry` con diagnóstico fijo |
| 429 / 5xx | `retry`, respetando backoff y `Retry-After` |
| 400 (validación real del backend) / 422 | `failed`, `INVALID_CAPTURE`, sin cuerpo sensible |
| 401 | conserva filas como `retry`, invalida solo la credencial del intento y solicita reemparejamiento |
| éxito mal formado o UUID ajeno | `retry`, `INVALID_RESPONSE` |
| otros errores HTTP de cliente o redirecciones | `failed`, `HTTP_CLIENT_ERROR` |

Al reemparejar continúan las filas pendientes/retry con sus UUID originales.
`failed` y `synced` no se vuelven a reclamar automáticamente. Un 401 antiguo no
puede eliminar un token recién emparejado.

El botón **Sincronizar pendientes** adelanta reintentos por fallos de conexión
o timeout, conservando UUID y número de intento. No omite los plazos del servidor.

## Diagnóstico opcional

`src/diagnostic/` solo se incluye al compilar explícitamente con
`-PcaptureDiagnostics=true`. La variante normal no expone el provider. Consulta
[diagnostics/README.md](diagnostics/README.md) antes de generar fixtures; no
versiones exportaciones de un teléfono real. El código de producción usa los
parsers y la cola sin ese componente.

## Referencias de implementación

- [WorkManager](https://developer.android.com/jetpack/androidx/releases/work).
- [NotificationListenerService](https://developer.android.com/reference/android/service/notification/NotificationListenerService).
- [Android Keystore](https://developer.android.com/privacy-and-security/keystore).
- [Retrofit y OkHttp](https://github.com/square/retrofit/releases).
