package com.gestorfinanciero.capture.parsers

import com.gestorfinanciero.capture.CapturedNotification
import com.gestorfinanciero.domain.ParsedTransaction

fun interface NotificationParser {
    fun parse(notification: CapturedNotification): ParseResult
}

sealed interface ParseResult {
    data class Parsed(val transaction: ParsedTransaction) : ParseResult
    data class Ignored(val reason: IgnoreReason) : ParseResult
}

/** Diagnostic codes only, never raw notification text. */
enum class IgnoreReason { UNSUPPORTED_PACKAGE, PARSER_NOT_IMPLEMENTED, NOT_FINANCIAL, INSUFFICIENT_DATA }
