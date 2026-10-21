package com.gestorfinanciero.capture

import com.gestorfinanciero.capture.parsers.IgnoreReason
import com.gestorfinanciero.capture.parsers.NotificationParser
import com.gestorfinanciero.capture.parsers.ParseResult
import com.gestorfinanciero.domain.NotificationSource
import com.gestorfinanciero.domain.ParsedTransaction

sealed interface RouteResult {
    data class Parsed(val transaction: ParsedTransaction, val source: NotificationSource) : RouteResult
    data class Ignored(val reason: IgnoreReason) : RouteResult
}

class NotificationRouter(
    private val sources: FinancialSourceRegistry,
    parsers: Map<NotificationSource, NotificationParser>,
) {
    private val parsers = parsers.toMap()

    fun route(notification: CapturedNotification): RouteResult {
        val source = sources.sourceFor(notification.packageName)
            ?: return RouteResult.Ignored(IgnoreReason.UNSUPPORTED_PACKAGE)
        val parser = parsers[source]
            ?: return RouteResult.Ignored(IgnoreReason.PARSER_NOT_IMPLEMENTED)
        return when (val result = parser.parse(notification)) {
            is ParseResult.Parsed -> RouteResult.Parsed(result.transaction, source)
            is ParseResult.Ignored -> RouteResult.Ignored(result.reason)
        }
    }
}
