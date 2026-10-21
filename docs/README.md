# Documentación del proyecto

## Lectura recomendada

1. [README principal](../README.md): producto, arquitectura general e instalación.
2. [Requerimientos vigentes](REQUERIMIENTOS.md) y [alcance cerrado del MVP](../contexto/MVP.md).
3. [Arquitectura](ARQUITECTURA.md) y [definiciones de datos](DATOS.md).
4. [Guía de desarrollo](GITHUB.md), [Android](../android/README.md) y [web](../web/README.md).
5. [Referencia técnica y API](REFERENCIA_TECNICA.md) y [operación en producción](PRODUCCION.md).

## Estado, verificaciones e historial

- [Preparación de la copia](PREPARACION_GITHUB.md): exclusiones, revisión de secretos
  y pruebas ejecutadas antes de la publicación inicial.
- [Validación del Hito 9](HITO9_VALIDACION.md): integración e historial de pruebas físicas.
- [Estado del proyecto](../ESTADO_PROYECTO.md): avances y pendientes documentados.

Las validaciones históricas no implican que exista un servicio en producción.
Las evidencias privadas bajo `.cache/` no se distribuyen en Git.

## Diseño original conservado

| Documento | Cómo interpretarlo |
|---|---|
| [MVP](../contexto/MVP.md) | Alcance acordado, exclusiones y criterios de aceptación |
| [Arquitectura detallada](../contexto/ARQUITECTURA_MVP.md) | Diseño y contratos de referencia |
| [Modelo de datos detallado](../contexto/MODELAMIENTO_DATOS_MVP.md) | Diseño de persistencia, DTOs y concurrencia |
| [Requerimientos iniciales](../contexto/requerimietos.md) | Visión amplia: incluye capacidades fuera del MVP |
| [Mapa de hitos](../contexto/Hitos.PNG) | Secuencia original de implementación |

Para el comportamiento actual, consultar las guías vigentes y la implementación.
El esquema efectivo está en [Prisma](../backend/prisma/schema.prisma), sus
[migraciones](../backend/prisma/migrations/) y el
[esquema Room](../android/app/schemas/). Los documentos de diseño pueden mencionar
capacidades que la interfaz actual aún no expone, como la gestión de dispositivos.
