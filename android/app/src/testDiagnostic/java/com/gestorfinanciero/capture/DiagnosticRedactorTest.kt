package com.gestorfinanciero.capture

import org.junit.Assert.*
import org.junit.Test

/** Synthetic adversarial privacy tests; these texts MUST NOT become parser fixtures. */
class DiagnosticRedactorTest {
    @Test fun `private names contacts card numbers and free text are removed`() {
        val output = DiagnosticRedactor.redact("Zyxname Qwerty 4111 1111 1111 1111 zyx@example.test https://example.test/private ABCSECRET")!!
        for (secret in listOf("Zyxname", "Qwerty", "4111", "1111", "example", "private", "ABCSECRET")) {
            assertFalse(output.contains(secret))
        }
    }

    @Test fun `amounts are substituted without keeping identifying numbers`() {
        assertEquals("S/ 11.11", DiagnosticRedactor.redact("S/ 82.34"))
        assertEquals("PEN 1,111.11", DiagnosticRedactor.redact("PEN 2,345.67"))
        assertFalse(DiagnosticRedactor.redact("PEN 4111111111111111")!!.contains("4111"))
    }

    @Test fun `missing text stays absent and oversized text is not retained`() {
        assertNull(DiagnosticRedactor.redact(null))
        assertEquals("[OVERSIZED_REDACTED]", DiagnosticRedactor.redact("x".repeat(2_001)))
    }
}
