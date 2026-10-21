package com.gestorfinanciero.capture.parsers

import com.gestorfinanciero.capture.CapturedNotification
import com.gestorfinanciero.domain.ParsedTransaction
import com.gestorfinanciero.domain.TransactionType
import java.time.Instant

/** Purchase receipt observed on IO 3.8.38; other formats remain unsupported. */
class IoNotificationParser : NotificationParser {
    override fun parse(notification: CapturedNotification): ParseResult {
        if (notification.title != "¡Compra exitosa con tu Tarjeta iO!") return ParseResult.Ignored(IgnoreReason.NOT_FINANCIAL)
        val match = PURCHASE.matchEntire(notification.text.orEmpty())
            ?: return ParseResult.Ignored(IgnoreReason.INSUFFICIENT_DATA)
        if (notification.postTime <= 0) return ParseResult.Ignored(IgnoreReason.INSUFFICIENT_DATA)
        return ParseResult.Parsed(ParsedTransaction(
            amount = match.groupValues[1], currency = "PEN",
            occurredAt = Instant.ofEpochMilli(notification.postTime).toString(),
            description = null, type = TransactionType.EXPENSE, account = "IO crédito",
        ))
    }

    private companion object {
        // Card decoration and merchant are required by the observed template,
        // but neither is extracted or retained. Credit account confirmed by owner.
        val PURCHASE = Regex("Realizaste una compra con tu Tarjeta iO [^ \\r\\n]{1,40} por S/([0-9]{1,12}\\.[0-9]{2}) en [^\\r\\n]+\\.")
    }
}
