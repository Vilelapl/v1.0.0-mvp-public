package com.gestorfinanciero.domain

enum class TransactionType(val value: String) {
    INCOME("income"), EXPENSE("expense"),
}

enum class NotificationSource(val value: String) {
    IO("io_notification"),
    YAPE("yape_notification"),
    GOOGLE_WALLET("google_wallet_notification"),
}

/** Structured parser output. Missing optional information remains null. */
data class ParsedTransaction(
    val amount: String,
    val currency: String?,
    val occurredAt: String,
    val description: String?,
    val type: TransactionType,
    val account: String?,
)

/** Stable local equivalent of the Hito 5 device input; no server-owned fields. */
data class CapturedTransaction(
    val clientTransactionId: String,
    val amount: String,
    val currency: String?,
    val occurredAt: String,
    val description: String?,
    val type: TransactionType,
    val account: String?,
    val source: NotificationSource,
)
