package com.gestorfinanciero.capture

import com.gestorfinanciero.Fixtures
import com.gestorfinanciero.capture.parsers.IgnoreReason
import com.gestorfinanciero.capture.parsers.NotificationParser
import com.gestorfinanciero.capture.parsers.ParseResult
import com.gestorfinanciero.domain.NotificationSource
import org.junit.Assert.*
import org.junit.Test

class NotificationRouterTest {
    @Test fun `each supported source dispatches only its parser`() {
        val called = mutableListOf<NotificationSource>()
        val parsers = NotificationSource.entries.associateWith { source ->
            NotificationParser { called += source; ParseResult.Parsed(Fixtures.parsed) }
        }
        val router = NotificationRouter(FinancialSourceRegistry(Fixtures.packages), parsers)
        for ((pkg, source) in Fixtures.packages) {
            called.clear()
            assertEquals(RouteResult.Parsed(Fixtures.parsed, source), router.route(Fixtures.notification.copy(packageName = pkg)))
            assertEquals(listOf(source), called)
        }
    }

    @Test fun `unknown or similar package is ignored before parsing`() {
        val router = NotificationRouter(FinancialSourceRegistry(Fixtures.packages),
            mapOf(NotificationSource.IO to NotificationParser { error("Must not be called") }))
        for (pkg in listOf("other.app", "fixture.io.spoof", "FIXTURE.IO")) {
            assertEquals(RouteResult.Ignored(IgnoreReason.UNSUPPORTED_PACKAGE), router.route(Fixtures.notification.copy(packageName = pkg)))
        }
    }

    @Test fun `known source without a real parser reports that it is pending`() {
        val router = NotificationRouter(FinancialSourceRegistry(Fixtures.packages), emptyMap())
        assertEquals(RouteResult.Ignored(IgnoreReason.PARSER_NOT_IMPLEMENTED), router.route(Fixtures.notification))
    }

    @Test fun `nonfinancial notification returns a diagnostic without exceptions`() {
        val router = NotificationRouter(FinancialSourceRegistry(Fixtures.packages), mapOf(
            NotificationSource.IO to NotificationParser { ParseResult.Ignored(IgnoreReason.NOT_FINANCIAL) },
        ))
        assertEquals(RouteResult.Ignored(IgnoreReason.NOT_FINANCIAL), router.route(Fixtures.notification))
    }

    @Test fun `production accepts only the packages observed on the phone`() {
        for (pkg in Fixtures.packages.keys) assertNull(FinancialSourceRegistry.production().sourceFor(pkg))
        for ((pkg, source) in FinancialSourceRegistry.verifiedPackages) {
            assertEquals(source, FinancialSourceRegistry.production().sourceFor(pkg))
            assertNull(FinancialSourceRegistry.production().sourceFor("$pkg.spoof"))
        }
    }
}
