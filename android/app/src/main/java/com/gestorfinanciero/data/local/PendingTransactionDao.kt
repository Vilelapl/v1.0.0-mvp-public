package com.gestorfinanciero.data.local

import androidx.room.Dao
import androidx.room.Insert
import androidx.room.OnConflictStrategy
import androidx.room.Query
import androidx.room.Transaction
import java.util.UUID
import kotlinx.coroutines.flow.Flow

@Dao
abstract class PendingTransactionDao {
    // ABORT prevents a replay from replacing a known capture or resetting its state.
    @Insert(onConflict = OnConflictStrategy.ABORT)
    protected abstract suspend fun insertRow(entity: PendingTransactionEntity)

    suspend fun insertPending(entity: PendingTransactionEntity) {
        require(UUID.fromString(entity.clientTransactionId).toString() == entity.clientTransactionId)
        require(entity.syncStatus == SyncStatus.PENDING && entity.attempts == 0)
        require(entity.serverTransactionId == null && entity.lastAttemptAt == null)
        require(entity.nextAttemptAt == null && entity.lastErrorCode == null)
        require(entity.createdAt == entity.updatedAt)
        insertRow(entity)
    }

    @Query("SELECT * FROM pending_transactions WHERE clientTransactionId = :id")
    abstract suspend fun getById(id: String): PendingTransactionEntity?

    @Query("SELECT * FROM pending_transactions WHERE syncStatus = :status ORDER BY createdAt, clientTransactionId")
    abstract suspend fun listByStatus(status: SyncStatus): List<PendingTransactionEntity>

    @Query("SELECT syncStatus, COUNT(*) AS count FROM pending_transactions GROUP BY syncStatus")
    abstract fun observeStatusCounts(): Flow<List<QueueStatusCount>>

    @Query("""
        SELECT MIN(CASE syncStatus
            WHEN 'pending' THEN :now
            WHEN 'retry' THEN COALESCE(nextAttemptAt, :now)
            WHEN 'syncing' THEN COALESCE(lastAttemptAt, 0) + :staleAfterMillis + 1
        END) FROM pending_transactions WHERE syncStatus IN ('pending', 'retry', 'syncing')
    """)
    abstract suspend fun nextWakeAt(now: Long, staleAfterMillis: Long): Long?

    /** Explicit user retry only; server cooldowns and active claims stay intact. */
    @Query("""
        UPDATE pending_transactions SET nextAttemptAt = :now, updatedAt = :now
        WHERE syncStatus = 'retry' AND nextAttemptAt > :now
          AND lastErrorCode IN ('NETWORK_ERROR', 'TIMEOUT')
    """)
    abstract suspend fun retryNetworkErrorsNow(now: Long): Int

    @Query("""
        SELECT clientTransactionId FROM pending_transactions
        WHERE syncStatus = 'pending'
           OR (syncStatus = 'retry' AND (nextAttemptAt IS NULL OR nextAttemptAt <= :now))
        ORDER BY createdAt, clientTransactionId LIMIT :limit
    """)
    protected abstract suspend fun eligibleIds(now: Long, limit: Int): List<String>

    @Query("""
        UPDATE pending_transactions
        SET syncStatus = 'syncing', attempts = attempts + 1,
            lastAttemptAt = :now, nextAttemptAt = NULL, updatedAt = :now
        WHERE clientTransactionId IN (:ids)
          AND (syncStatus = 'pending'
            OR (syncStatus = 'retry' AND (nextAttemptAt IS NULL OR nextAttemptAt <= :now)))
    """)
    protected abstract suspend fun claimIds(ids: List<String>, now: Long): Int

    @Query("SELECT * FROM pending_transactions WHERE clientTransactionId IN (:ids) ORDER BY createdAt, clientTransactionId")
    protected abstract suspend fun getByIds(ids: List<String>): List<PendingTransactionEntity>

    /** Selection and mutation share a Room/SQLite transaction, including across DB instances. */
    @Transaction
    open suspend fun claimEligible(now: Long, limit: Int): List<PendingTransactionEntity> {
        require(limit in 1..100)
        val ids = eligibleIds(now, limit)
        if (ids.isEmpty()) return emptyList()
        check(claimIds(ids, now) == ids.size)
        return getByIds(ids)
    }

    // The claim's attempts counter acts as a generation. A recovered/late worker
    // cannot finish another worker's newer attempt, even at the same millisecond.
    @Query("""
        UPDATE pending_transactions
        SET syncStatus = 'retry', nextAttemptAt = :nextAttemptAt,
            lastErrorCode = :error, updatedAt = :now
        WHERE clientTransactionId = :id AND syncStatus = 'syncing' AND attempts = :expectedAttempt
    """)
    abstract suspend fun markRetry(
        id: String, expectedAttempt: Int, error: LocalErrorCode, nextAttemptAt: Long, now: Long,
    ): Int

    @Query("""
        UPDATE pending_transactions
        SET syncStatus = 'failed', nextAttemptAt = NULL, lastErrorCode = :error, updatedAt = :now
        WHERE clientTransactionId = :id AND syncStatus = 'syncing' AND attempts = :expectedAttempt
    """)
    abstract suspend fun markFailed(id: String, expectedAttempt: Int, error: LocalErrorCode, now: Long): Int

    @Query("""
        UPDATE pending_transactions
        SET syncStatus = 'synced', serverTransactionId = :serverId,
            nextAttemptAt = NULL, lastErrorCode = NULL, updatedAt = :now
        WHERE clientTransactionId = :id AND syncStatus = 'syncing' AND attempts = :expectedAttempt
    """)
    protected abstract suspend fun setSynced(id: String, expectedAttempt: Int, serverId: String, now: Long): Int

    suspend fun markSynced(id: String, expectedAttempt: Int, serverTransactionId: String, now: Long): Int {
        require(UUID.fromString(serverTransactionId).toString() == serverTransactionId)
        return setSynced(id, expectedAttempt, serverTransactionId, now)
    }

    @Query("""
        UPDATE pending_transactions
        SET syncStatus = 'retry', nextAttemptAt = :now, lastErrorCode = 'STALE_SYNC', updatedAt = :now
        WHERE syncStatus = 'syncing' AND (lastAttemptAt IS NULL OR lastAttemptAt < :olderThan)
    """)
    protected abstract suspend fun recoverRows(olderThan: Long, now: Long): Int

    /** Caller chooses a cutoff older than the maximum duration of an active attempt. */
    suspend fun recoverAbandonedSyncing(olderThan: Long, now: Long): Int {
        require(olderThan <= now)
        return recoverRows(olderThan, now)
    }
}
