package com.gestorfinanciero.domain

import com.gestorfinanciero.Fixtures
import org.junit.Assert.*
import org.junit.Test
import java.util.UUID

class TransactionNormalizerTest {
    @Test fun `decimal strings retain exact cents and trailing zeroes`() {
        for (amount in listOf("0.10", "10.90", "1250.00", "999999999999.99")) {
            assertEquals(amount, Fixtures.transaction(amount).amount)
        }
    }

    @Test fun `invalid money never allocates an ID`() {
        val normalizer = TransactionNormalizer { error("Must not allocate an ID") }
        for (amount in listOf("0", "0.00", "-1", "1.001", "1e2", "1,20", "NaN", "1000000000000.00", "")) {
            assertEquals(NormalizationResult.Invalid(InvalidField.AMOUNT),
                normalizer.normalize(Fixtures.parsed.copy(amount = amount), NotificationSource.IO))
        }
    }

    @Test fun `normalization uses an explicit instant and preserves absent data`() {
        val transaction = Fixtures.transaction()
        assertEquals("2026-09-10T13:00:00Z", transaction.occurredAt)
        assertNull(transaction.currency)
        assertNull(transaction.description)
        assertNull(transaction.account)
    }

    @Test fun `rejects local dates invalid calendars and unsupported UTC years`() {
        val normalizer = TransactionNormalizer()
        for (date in listOf("2026-09-10T08:00:00", "2026-02-30T08:00:00Z",
            "2026-09-10T24:00:00Z", "0000-01-01T00:00:00Z", "0001-01-01T00:00:00+01:00",
            "9999-12-31T23:59:59-01:00", "2026-09-10T08:00:00+25:00")) {
            assertEquals(date, NormalizationResult.Invalid(InvalidField.OCCURRED_AT),
                normalizer.normalize(Fixtures.parsed.copy(occurredAt = date), NotificationSource.IO))
        }
    }

    @Test fun `trims known fields without inferring missing values`() {
        val result = TransactionNormalizer().normalize(Fixtures.parsed.copy(
            amount = " 0.10 ", currency = " PEN ", description = " Comercio ", account = " Cuenta ",
        ), NotificationSource.YAPE) as NormalizationResult.Valid
        assertEquals("0.10", result.transaction.amount)
        assertEquals("PEN", result.transaction.currency)
        assertEquals("Comercio", result.transaction.description)
        assertEquals("Cuenta", result.transaction.account)
        assertEquals(NotificationSource.YAPE, result.transaction.source)
    }

    @Test fun `rejects invalid currencies and bounded text`() {
        val inputs = listOf(
            Fixtures.parsed.copy(currency = "pen") to InvalidField.CURRENCY,
            Fixtures.parsed.copy(currency = "S/") to InvalidField.CURRENCY,
            Fixtures.parsed.copy(description = " ") to InvalidField.DESCRIPTION,
            Fixtures.parsed.copy(description = "x".repeat(301)) to InvalidField.DESCRIPTION,
            Fixtures.parsed.copy(account = "x".repeat(121)) to InvalidField.ACCOUNT,
            Fixtures.parsed.copy(account = "a\u0000b") to InvalidField.ACCOUNT,
        )
        for ((input, field) in inputs) {
            assertEquals(NormalizationResult.Invalid(field), TransactionNormalizer().normalize(input, NotificationSource.IO))
        }
    }

    @Test fun `one UUID is allocated after normalization and remains in the domain object`() {
        var calls = 0
        val uuid = UUID.randomUUID()
        val result = TransactionNormalizer { calls++; uuid }.normalize(Fixtures.parsed, NotificationSource.IO)
            as NormalizationResult.Valid
        assertEquals(1, calls)
        assertEquals(uuid.toString(), result.transaction.clientTransactionId)
        assertEquals(uuid.toString(), result.transaction.copy().clientTransactionId)
        assertNotEquals(Fixtures.transaction().clientTransactionId, Fixtures.transaction().clientTransactionId)
    }
}
