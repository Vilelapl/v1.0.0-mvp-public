package com.gestorfinanciero.capture

import com.gestorfinanciero.capture.parsers.IoNotificationParser
import com.gestorfinanciero.capture.parsers.ParseResult
import com.gestorfinanciero.domain.TransactionType
import com.google.gson.JsonParser
import java.time.Instant
import org.junit.Assert.*
import org.junit.Test

class IoNotificationParserTest {
    private val parser = IoNotificationParser()

    @Test fun `real purchase keeps decimal text and only owner confirmed account`() {
        val observed = observed()
        val result = (parser.parse(observed) as ParseResult.Parsed).transaction
        assertEquals("1.11", result.amount)
        assertEquals("PEN", result.currency)
        assertEquals(TransactionType.EXPENSE, result.type)
        assertEquals("IO crédito", result.account)
        assertEquals(Instant.ofEpochMilli(observed.postTime).toString(), result.occurredAt)
        assertNull(result.description)
    }

    @Test fun `structural corruptions and unrelated observed information cannot become purchases`() {
        val observed = observed()
        for (input in listOf(observed.copy(title = null), observed.copy(text = null),
            observed.copy(postTime = 0), observed.copy(text = observed.text!!.replace("S/", "")),
            observed.copy(text = observed.text!!.substringBefore(" por ")))) {
            assertTrue(parser.parse(input) is ParseResult.Ignored)
        }
        val unrelated = notificationFixture("yape/informational-observed-01.json")
        assertTrue(parser.parse(unrelated) is ParseResult.Ignored)
        // This is a real informational Yape sample used as a negative input;
        // no informational IO format has been observed or claimed as supported.
    }

    private fun observed() = notificationFixture("io/purchase-observed-01.json")
}

internal fun notificationFixture(path: String): CapturedNotification {
    val text = requireNotNull(IoNotificationParserTest::class.java.classLoader?.getResourceAsStream("notifications/$path"))
        .bufferedReader(Charsets.UTF_8).use { it.readText() }.removePrefix("\uFEFF")
    val json = JsonParser.parseString(text).asJsonObject
    fun optional(key: String): String? = json[key]?.takeUnless { it.isJsonNull }?.asString
    return CapturedNotification(json["packageName"].asString, optional("title"), optional("text"), json["postTime"].asLong, "real-fixture")
}
