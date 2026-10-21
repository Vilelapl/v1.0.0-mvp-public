package com.gestorfinanciero.capture

import com.google.gson.JsonParser
import com.gestorfinanciero.capture.parsers.ParseResult
import com.gestorfinanciero.capture.parsers.YapeNotificationParser
import com.gestorfinanciero.domain.TransactionType
import java.time.Instant
import org.junit.Assert.*
import org.junit.Test

class YapeNotificationParserTest {
    private val parser = YapeNotificationParser()

    @Test fun `real incoming notification uses evidence and authorized publication timestamp`() {
        val observed = fixture("income-observed-01.json")
        val result = parser.parse(observed) as ParseResult.Parsed
        assertEquals("1", result.transaction.amount)
        assertEquals("PEN", result.transaction.currency)
        assertEquals(TransactionType.INCOME, result.transaction.type)
        assertEquals(Instant.ofEpochMilli(observed.postTime).toString(), result.transaction.occurredAt)
        assertNull(result.transaction.description)
        assertNull(result.transaction.account)
    }

    @Test fun `real empty companion and informational notification are ignored`() {
        assertTrue(parser.parse(fixture("empty-observed-01.json")) is ParseResult.Ignored)
        assertTrue(parser.parse(fixture("informational-observed-01.json")) is ParseResult.Ignored)
    }

    @Test fun `new real whole and decimal payments preserve the complete amount`() {
        for ((name, amount) in mapOf(
            "income-decimal-observed-01.json" to "1.1",
            "income-decimal-observed-02.json" to "1.1",
            "income-whole-observed-02.json" to "11",
            "income-whole-observed-03.json" to "111",
        )) {
            val observed = fixture(name)
            val parsed = (parser.parse(observed) as ParseResult.Parsed).transaction
            assertEquals(amount, parsed.amount)
            assertEquals("PEN", parsed.currency)
            assertEquals(TransactionType.INCOME, parsed.type)
            assertEquals(Instant.ofEpochMilli(observed.postTime).toString(), parsed.occurredAt)
            assertNull(parsed.description)
            assertNull(parsed.account)
        }
    }

    @Test fun `sender changes do not change the parsed payment or persist the name`() {
        val observed = fixture("income-decimal-observed-01.json")
        val expected = parser.parse(observed)
        // Synthetic sender substitutions test invariance, not alleged real identities.
        val suffix = observed.text!!.substringAfter(" te envió")
        for (sender in listOf("Remitente A*", "Otra Persona Apellido*", "ÁÉÍÓÚ Ñ-Ñ*")) {
            assertEquals(expected, parser.parse(observed.copy(text = "$sender te envió$suffix")))
        }
    }

    @Test fun `decimal grammar never truncates malformed or unsupported amounts`() {
        val observed = fixture("income-decimal-observed-01.json")
        // Negative mutations: these are not claimed as observed Yape formats.
        for (amount in listOf("1.111", "1,1", "1,111.11", "1.111,11", "-1.1", "1.", ".1")) {
            assertTrue(amount, parser.parse(observed.copy(text = observed.text!!.replace("S/ 1.1.", "S/ $amount."))) is ParseResult.Ignored)
        }
        assertTrue(parser.parse(observed.copy(text = observed.text!!.replace("S/", ""))) is ParseResult.Ignored)
    }

    @Test fun `corruptions of the real fixture cannot fabricate a movement`() {
        // Negative structural mutations, not alleged real notification variants.
        val observed = fixture("income-observed-01.json")
        for (input in listOf(observed.copy(text = null), observed.copy(title = null),
            observed.copy(postTime = 0), observed.copy(text = observed.text!!.substringBefore("te envió")))) {
            assertTrue(parser.parse(input) is ParseResult.Ignored)
        }
    }

    private fun fixture(name: String): CapturedNotification {
        val text = requireNotNull(javaClass.classLoader?.getResourceAsStream("notifications/yape/$name"))
            .bufferedReader(Charsets.UTF_8).use { it.readText() }.removePrefix("\uFEFF")
        val json = JsonParser.parseString(text).asJsonObject
        fun optional(key: String): String? = json[key]?.takeUnless { it.isJsonNull }?.asString
        return CapturedNotification(json["packageName"].asString, optional("title"), optional("text"), json["postTime"].asLong, "fixture-key")
    }
}
