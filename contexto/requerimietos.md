requerimietos:

1. Captura desde notificaciones

	- El sistema debe ser capaz de leer notificaciones financieras generadas en un dispositivo Android, especificamente:
		- App IO
		- Yape
		- Google wallet

	- Debe extraer, cuando estén disponibles, datos como monto, comercio, fecha, hora, moneda y medio de pago.
	- El sistema debe ignorar las notificaciones no procesables o que no sean de consumos o ingresos.

2. Captura desde correo electrónico con un agente de IA

	- El sistema debe distinguir correos que representan movimientos financieros reales de
	  correos informativos, promocionales, estados de cuenta u otras comunicaciones bancarias.
	- El sistema debe analizar correos financieros para identificar:
		- consumos
		- abonos
		- devoluciones
		- transferencias u otros movimientos relevantes

	- Debe extraer los datos asociados a cada operación.

3. Normalización

	- El sistema debe convertir la información proveniente de distintas fuentes a un formato común de transacción.
	- El formato común debe permitir representar, cuando estén disponibles, datos
	  como monto, moneda, fecha, hora, comercio/descripción, tipo de movimiento, cuenta/tarjeta, categoría y fuente.

4. Detección de duplicados

	- El sistema debe identificar cuando una misma operación aparece en varias fuentes.
	- Debe fusionarlas en una sola transacción, conservando la información complementaria obtenida de cada fuente.
	- El sistema debe evitar fusionar automáticamente operaciones cuando no exista suficiente información para determinar
	  que corresponden a la misma transacción.

5. Persistencia

	- El sistema debe almacenar todas las transacciones procesadas en una base de datos.
	- Debe evitar insertar transacciones duplicadas.

6. Dashboard financiero

	- El sistema debe contar con una interfaz web desarrollada en React.
	- Debe mostrar todos los movimientos financieros registrados.

7. Filtrado y segmentación

	- El dashboard debe permitir visualizar los movimientos por criterios como:
		- fecha
		- categoría
		- tipo de movimiento
		- tarjeta/cuenta
		- comercio

8. Edición manual

	- El usuario debe poder modificar manualmente una transacción.
	- Como mínimo debería poder cambiar:
		- categoría
		- descripción/comercio
		- monto
		- fecha
		- tipo de movimiento

9. Creación manual de movimientos

	- El usuario debe poder registrar manualmente una transacción que no haya sido detectada automáticamente.
	- Como mínimo, el usuario deberá poder ingresar monto, fecha, tipo de movimiento, descripción/comercio, categoría y
	  cuenta o medio de pago.

10. Estado de procesamiento

	- El sistema debe poder distinguir entre una transacción detectada automáticamente, modificada manualmente o creada
	  manualmente.

11. Trazabilidad de fuentes

	- El sistema debe conservar información sobre las fuentes desde las cuales se detectó una transacción, permitiendo conocer
	  si provino de una notificación, correo electrónico, ingreso manual o una combinación de estas.

12. Categorización de transacciones

	- El sistema debe permitir asignar una categoría a cada transacción.
	- Las categorías podrán ser asignadas automáticamente o modificadas manualmente por el usuario.
	- El sistema debe permitir identificar transacciones que todavía no tengan una categoría asignada.

13. Sincronización de información
	- Los movimientos almacenados en la base de datos deben estar disponibles en el dashboard financiero.
	- Las modificaciones o creaciones manuales realizadas desde el dashboard deben persistirse en la base de datos.
