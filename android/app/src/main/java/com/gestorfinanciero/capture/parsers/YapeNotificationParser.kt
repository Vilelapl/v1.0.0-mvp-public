package com.gestorfinanciero.capture.parsers

import com.gestorfinanciero.capture.CapturedNotification
import com.gestorfinanciero.domain.ParsedTransaction
import com.gestorfinanciero.domain.TransactionType
import java.time.Instant

/** Only the supported incoming-payment format is enabled. */
class YapeNotificationParser : NotificationParser {
    override fun parse(notification: CapturedNotification): ParseResult {
        if (notification.title != "Confirmación de Pago") return ParseResult.Ignored(IgnoreReason.NOT_FINANCIAL)
        val match = INCOMING.matchEntire(notification.text.orEmpty())
            ?: return ParseResult.Ignored(IgnoreReason.INSUFFICIENT_DATA)
        if (notification.postTime <= 0) return ParseResult.Ignored(IgnoreReason.INSUFFICIENT_DATA)
        // If the text has no event date,
        // use the actual notification publication instant, not a fabricated date.
        // Sender identity and security-code suffix are never persisted.
        return ParseResult.Parsed(ParsedTransaction(
            amount = match.groupValues[1], currency = "PEN",
            occurredAt = Instant.ofEpochMilli(notification.postTime).toString(),
            description = null, type = TransactionType.INCOME, account = null,
        ))
    }

    private companion object {
        // Real 2026-09-14 notifications also use a decimal point (one fractional
        // digit observed). Accept the contract's 1–2 fractional digits as text;
        // the following full stop belongs to the sentence, not the amount.
        // Sender names are variable, never a list of known people or placeholders.
        val INCOMING = Regex("[^\\r\\n]+ te envió un pago por S/ ([0-9]{1,12}(?:\\.[0-9]{1,2})?)\\. El [^\\r\\n]+ de seguridad es: [^\\r\\n]+")
    }
}
