package com.gestorfinanciero.capture

import com.gestorfinanciero.capture.parsers.GoogleWalletNotificationParser
import com.gestorfinanciero.capture.parsers.ParseResult
import com.gestorfinanciero.domain.TransactionType
import java.time.Instant
import org.junit.Assert.*
import org.junit.Test

class GoogleWalletNotificationParserTest {
    private val parser = GoogleWalletNotificationParser { alias -> when (alias) {
        "[IO_CREDIT_CARD]" -> WalletCard.IO_CREDIT
        "[BCP_DEBIT_CARD]" -> WalletCard.BCP_DEBIT
        else -> null
    } }

    @Test fun `both real purchase variants use explicit account mapping without retaining alias or merchant`() {
        for ((path, account) in listOf("purchase-credit-observed-01.json" to "IO crédito", "purchase-debit-observed-01.json" to "BCP débito")) {
            val observed = notificationFixture("google-wallet/$path")
            val parsed = (parser.parse(observed) as ParseResult.Parsed).transaction
            assertEquals("1.11", parsed.amount)
            assertEquals("PEN", parsed.currency)
            assertEquals(TransactionType.EXPENSE, parsed.type)
            assertEquals(account, parsed.account)
            assertNull(parsed.description)
            assertEquals(Instant.ofEpochMilli(observed.postTime).toString(), parsed.occurredAt)
        }
    }

    @Test fun `real empty companion and unrelated observed information are ignored`() {
        assertTrue(parser.parse(notificationFixture("google-wallet/empty-observed-01.json")) is ParseResult.Ignored)
        assertTrue(parser.parse(notificationFixture("yape/informational-observed-01.json")) is ParseResult.Ignored)
        // No informational Wallet message has been observed; none is invented.
    }

    @Test fun `missing owner mapping and structural corruptions cannot infer a transaction`() {
        val observed = notificationFixture("google-wallet/purchase-credit-observed-01.json")
        assertTrue(GoogleWalletNotificationParser { null }.parse(observed) is ParseResult.Ignored)
        for (input in listOf(observed.copy(title = null), observed.copy(text = null), observed.copy(postTime = 0),
            observed.copy(text = observed.text!!.replace("PEN", "")),
            observed.copy(text = observed.text!!.replace("with", "")),
            observed.copy(text = observed.text!! + " extra"))) {
            assertTrue(parser.parse(input) is ParseResult.Ignored)
        }
    }
}
