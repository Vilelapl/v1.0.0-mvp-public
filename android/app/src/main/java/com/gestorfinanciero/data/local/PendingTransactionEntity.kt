package com.gestorfinanciero.data.local

import androidx.room.Entity
import androidx.room.Index
import androidx.room.PrimaryKey
import com.gestorfinanciero.domain.CapturedTransaction
import com.gestorfinanciero.domain.NotificationSource
import com.gestorfinanciero.domain.TransactionType

enum class SyncStatus(val value: String) {
    PENDING("pending"), SYNCING("syncing"), RETRY("retry"), SYNCED("synced"), FAILED("failed"),
}

enum class LocalErrorCode {
    STALE_SYNC, TIMEOUT, RATE_LIMITED, SERVER_ERROR, AUTH_REQUIRED, INVALID_CAPTURE, UNEXPECTED_ERROR,
    NETWORK_ERROR, INVALID_RESPONSE, HTTP_CLIENT_ERROR, INTERRUPTED,
}

data class QueueStatusCount(val syncStatus: SyncStatus, val count: Int)

@Entity(
    tableName = "pending_transactions",
    indices = [Index(value = ["syncStatus", "nextAttemptAt"]), Index(value = ["syncStatus", "lastAttemptAt"])],
)
data class PendingTransactionEntity(
    @PrimaryKey val clientTransactionId: String,
    val amount: String,
    val currency: String?,
    val occurredAt: String,
    val description: String?,
    val type: TransactionType,
    val account: String?,
    val source: NotificationSource,
    val syncStatus: SyncStatus,
    val attempts: Int,
    val nextAttemptAt: Long?,
    val lastAttemptAt: Long?,
    val lastErrorCode: LocalErrorCode?,
    val serverTransactionId: String?,
    val createdAt: Long,
    val updatedAt: Long,
) {
    companion object {
        fun pending(transaction: CapturedTransaction, now: Long) = PendingTransactionEntity(
            clientTransactionId = transaction.clientTransactionId,
            amount = transaction.amount, currency = transaction.currency,
            occurredAt = transaction.occurredAt, description = transaction.description,
            type = transaction.type, account = transaction.account, source = transaction.source,
            syncStatus = SyncStatus.PENDING, attempts = 0, nextAttemptAt = null,
            lastAttemptAt = null, lastErrorCode = null, serverTransactionId = null,
            createdAt = now, updatedAt = now,
        )
    }
}
