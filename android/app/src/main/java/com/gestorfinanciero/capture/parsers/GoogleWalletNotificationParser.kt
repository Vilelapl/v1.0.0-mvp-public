package com.gestorfinanciero.capture.parsers

import com.gestorfinanciero.capture.CapturedNotification
import com.gestorfinanciero.capture.WalletCard
import com.gestorfinanciero.domain.ParsedTransaction
import com.gestorfinanciero.domain.TransactionType
import java.time.Instant

/** Two purchase receipts observed on Wallet 26.35.975423890, confirmed by owner. */
class GoogleWalletNotificationParser(private val resolveCard: (String) -> WalletCard?) : NotificationParser {
    override fun parse(notification: CapturedNotification): ParseResult {
        if (notification.title.isNullOrBlank()) return ParseResult.Ignored(IgnoreReason.INSUFFICIENT_DATA)
        val match = PURCHASE.matchEntire(notification.text.orEmpty())
            ?: return ParseResult.Ignored(IgnoreReason.NOT_FINANCIAL)
        // No issuer/type inference from arbitrary card names or tc/db suffixes.
        val card = resolveCard(match.groupValues[2])
            ?: return ParseResult.Ignored(IgnoreReason.INSUFFICIENT_DATA)
        if (notification.postTime <= 0) return ParseResult.Ignored(IgnoreReason.INSUFFICIENT_DATA)
        return ParseResult.Parsed(ParsedTransaction(
            amount = match.groupValues[1], currency = "PEN",
            occurredAt = Instant.ofEpochMilli(notification.postTime).toString(),
            description = null, type = TransactionType.EXPENSE, account = card.account,
        ))
    }

    private companion object {
        val PURCHASE = Regex("PEN([0-9]{1,12}\\.[0-9]{2}) with ([^\\r\\n]{1,120})")
    }
}
