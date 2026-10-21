# Diagnósticos Android

El código de diagnóstico opcional sirve para validar parsers y la cola en un
dispositivo de prueba. Los archivos exportados desde teléfonos y bases de datos
no forman parte de este repositorio: pueden contener UUID de transacciones,
instantes exactos y metadatos de cuentas o dispositivos.

Las fixtures de `../app/src/test/resources/notifications/` contienen texto
redactado y fechas sintéticas. Conservan únicamente la estructura necesaria para
probar los parsers. No deben interpretarse como registros financieros reales.

Para un diagnóstico nuevo, trabaja con datos de prueba y conserva cualquier
evidencia física fuera del repositorio.
