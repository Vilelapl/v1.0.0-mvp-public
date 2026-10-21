package com.gestorfinanciero

import com.gestorfinanciero.capture.CapturedNotification
import com.gestorfinanciero.domain.NotificationSource
import com.gestorfinanciero.domain.NormalizationResult
import com.gestorfinanciero.domain.ParsedTransaction
import com.gestorfinanciero.domain.TransactionNormalizer
import com.gestorfinanciero.domain.TransactionType

object Fixtures {
    // Deliberately synthetic: these are not real financial application identifiers.
    val packages = mapOf(
        "fixture.io" to NotificationSource.IO,
        "fixture.yape" to NotificationSource.YAPE,
        "fixture.wallet" to NotificationSource.GOOGLE_WALLET,
    )
    val notification = CapturedNotification("fixture.io", "Fixture title", "RAW_PRIVATE_TEXT", 1_000, "fixture-key")
    val parsed = ParsedTransaction("10.90", null, "2026-09-10T08:00:00-05:00", null, TransactionType.EXPENSE, null)

    fun transaction(amount: String = "10.90") =
        (TransactionNormalizer().normalize(parsed.copy(amount = amount), NotificationSource.IO) as NormalizationResult.Valid).transaction
}
