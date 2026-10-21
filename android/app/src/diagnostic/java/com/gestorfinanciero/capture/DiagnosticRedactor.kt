package com.gestorfinanciero.capture

import java.util.Locale

/**
 * Privacy-first discovery, NOT a parser. Unknown words and identifiers never leave
 * the phone. Only an allowlist of financial grammar survives. Currency-prefixed
 * amounts retain their formatting with substituted digits. Lost vocabulary must
 * be reviewed on the phone; it must not be guessed when implementing a parser.
 */
object DiagnosticRedactor {
    private val words = ("io yape yapaste yapear yapeo yapeaste yapearon google wallet " +
        "recibiste recibido recibida recibimos recibes recibo recibir recibió recibí recibe " +
        "enviaste enviado enviada envió envia envío enviar envias enviaremos " +
        "pagaste pagado pagada pago pagos pagar pagó realizó realizaste realizada realizado " +
        "compra compras compraste consumo consumos consumiste consumido " +
        "transferencia transferencias transferiste transferido transferida devolución devuelto devuelta " +
        "reembolso reembolsado reembolsada abono abonado abonada cargo cargado cargada " +
        "retiro retiraste retirado recibida operación operaciones transacción transacciones " +
        "aprobada aprobado aceptada aceptado rechazado rechazada denegada denegado cancelada cancelado " +
        "pendiente pendientes procesando procesada procesado exitosa exitoso éxito correctamente " +
        "tarjeta tarjetas cuenta cuentas crédito débito virtual física terminada terminado termina " +
        "últimos dígitos monto importe total moneda soles dólares pen usd eur " +
        "por de del la el las los un una unos unas tu tus su sus te a al en con sin " +
        "se ha han hemos has es fue fueron y o desde hasta para fecha hora hoy ayer " +
        "disponible saldo nuevo nueva notificación notificaciones más detalles ver comercio " +
        "código seguridad confirmación confirmada confirmado exitosamente with").split(' ').toSet()
    private val amount = Regex("(?i)(?:S/\\.?|US\\$|PEN|USD|EUR)\\s*[0-9][0-9.,]*(?![0-9])")
    private val token = Regex("[\\p{L}\\p{M}\\p{N}_]+")
    private val privateContact = Regex("(?i)https?://\\S+|www\\.\\S+|[\\p{L}\\p{N}._%+-]+@[\\p{L}\\p{N}.-]+\\.[\\p{L}]{2,}")

    fun redact(value: String?): String? {
        if (value == null) return null
        if (value.length > 2_000) return "[OVERSIZED_REDACTED]"
        val withoutContacts = privateContact.replace(value, "[PRIVATE]")
        val amounts = mutableListOf<String>()
        val protected = amount.replace(withoutContacts) { match ->
            // Long numeric values could be account/card numbers, even after a
            // currency label. They are never treated as a discoverable amount.
            if (match.value.count(Char::isDigit) > 9) "[PRIVATE]" else {
                amounts += match.value.map { if (it.isDigit()) '1' else it }.joinToString("")
                "\uE000${amounts.lastIndex}\uE001"
            }
        }
        // Process around protected amounts so their internal placeholder digits
        // cannot collide with input or escape the identifier redaction.
        val output = StringBuilder()
        val placeholder = Regex("\uE000([0-9]+)\uE001")
        var offset = 0
        for (match in placeholder.findAll(protected)) {
            output.append(redactWords(protected.substring(offset, match.range.first)))
            output.append(amounts.getOrNull(match.groupValues[1].toIntOrNull() ?: -1) ?: "[PRIVATE]")
            offset = match.range.last + 1
        }
        output.append(redactWords(protected.substring(offset)))
        return output.toString()
    }

    private fun redactWords(value: String): String = token.replace(value) { match ->
        if (match.value.lowercase(Locale.ROOT) in words) match.value else "[PRIVATE]"
    }
}
