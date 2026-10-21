package com.gestorfinanciero.data.local

import android.content.Context
import androidx.room.Room
import androidx.test.core.app.ApplicationProvider
import com.gestorfinanciero.Fixtures
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.async
import kotlinx.coroutines.awaitAll
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.runBlocking
import org.junit.After
import org.junit.Assert.*
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config
import org.robolectric.annotation.SQLiteMode
import java.util.UUID

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [35])
@SQLiteMode(SQLiteMode.Mode.NATIVE)
class PendingTransactionDaoTest {
    private lateinit var database: FinanceDatabase
    private lateinit var dao: PendingTransactionDao
    private val context: Context get() = ApplicationProvider.getApplicationContext()

    @Before fun setup() {
        database = Room.inMemoryDatabaseBuilder(context, FinanceDatabase::class.java).build()
        dao = database.pendingTransactions()
    }

    @After fun close() { database.close() }

    private suspend fun insert(amount: String = "10.90", now: Long = 1_000): PendingTransactionEntity {
        val row = PendingTransactionEntity.pending(Fixtures.transaction(amount), now)
        dao.insertPending(row)
        return row
    }

    @Test fun `insert pending and read by UUID preserves every financial field`() = runBlocking {
        for (amount in listOf("0.10", "10.90", "1250.00")) {
            val row = insert(amount)
            assertEquals(row, dao.getById(row.clientTransactionId))
            assertEquals(SyncStatus.PENDING, row.syncStatus)
            assertEquals(0, row.attempts)
            assertNull(row.serverTransactionId)
        }
        assertEquals(3, dao.listByStatus(SyncStatus.PENDING).size)
        assertNull(dao.getById(UUID.randomUUID().toString()))
    }

    @Test fun `claim increments attempts and applies all five states without changing UUID`() = runBlocking {
        val row = insert()
        val first = dao.claimEligible(2_000, 10).single()
        assertEquals(row.clientTransactionId, first.clientTransactionId)
        assertEquals(SyncStatus.SYNCING, first.syncStatus)
        assertEquals(1, first.attempts)
        assertEquals(2_000L, first.lastAttemptAt)
        assertEquals(1, dao.markRetry(first.clientTransactionId, 1, LocalErrorCode.TIMEOUT, 3_000, 2_100))
        val retry = dao.getById(row.clientTransactionId)!!
        assertEquals(SyncStatus.RETRY, retry.syncStatus)
        assertEquals(LocalErrorCode.TIMEOUT, retry.lastErrorCode)
        assertEquals(3_000L, retry.nextAttemptAt)
        val second = dao.claimEligible(3_000, 10).single()
        assertEquals(2, second.attempts)
        val server = UUID.randomUUID().toString()
        assertEquals(1, dao.markSynced(second.clientTransactionId, 2, server, 3_100))
        val synced = dao.getById(row.clientTransactionId)!!
        assertEquals(SyncStatus.SYNCED, synced.syncStatus)
        assertEquals(server, synced.serverTransactionId)
        assertEquals(row.amount, synced.amount)
        assertEquals(row.occurredAt, synced.occurredAt)
        assertEquals(row.createdAt, synced.createdAt)
        assertNull(synced.lastErrorCode)
        assertNull(synced.nextAttemptAt)
    }

    @Test fun `synced and failed captures are never claimed again`() = runBlocking {
        insert(); insert()
        val claimed = dao.claimEligible(2_000, 10)
        assertEquals(1, dao.markSynced(claimed[0].clientTransactionId, 1, UUID.randomUUID().toString(), 2_100))
        assertEquals(1, dao.markFailed(claimed[1].clientTransactionId, 1, LocalErrorCode.INVALID_CAPTURE, 2_100))
        assertEquals(LocalErrorCode.INVALID_CAPTURE, dao.listByStatus(SyncStatus.FAILED).single().lastErrorCode)
        assertTrue(dao.claimEligible(100_000, 10).isEmpty())
        assertEquals(0, dao.markRetry(claimed[0].clientTransactionId, 1, LocalErrorCode.TIMEOUT, 3_000, 2_200))
    }

    @Test fun `retry waits until nextAttemptAt including exact boundary`() = runBlocking {
        val row = insert()
        dao.claimEligible(2_000, 10)
        dao.markRetry(row.clientTransactionId, 1, LocalErrorCode.TIMEOUT, 5_000, 2_100)
        assertTrue(dao.claimEligible(4_999, 10).isEmpty())
        assertEquals(row.clientTransactionId, dao.claimEligible(5_000, 10).single().clientTransactionId)
        assertTrue(dao.claimEligible(5_001, 10).isEmpty())
    }

    @Test fun `manual retry advances only network errors preserving server cooldowns and claims`() = runBlocking {
        val errors = listOf(LocalErrorCode.NETWORK_ERROR, LocalErrorCode.TIMEOUT,
            LocalErrorCode.RATE_LIMITED, LocalErrorCode.SERVER_ERROR, LocalErrorCode.INVALID_RESPONSE)
        val retryRows = errors.map { error ->
            val row = insert()
            val claim = dao.claimEligible(2_000, 10).single()
            dao.markRetry(row.clientTransactionId, claim.attempts, error, 600_000, 2_100)
            requireNotNull(dao.getById(row.clientTransactionId))
        }
        val active = insert()
        dao.claimEligible(2_000, 10)
        val activeBefore = dao.getById(active.clientTransactionId)
        val pending = insert()
        assertEquals(2, dao.retryNetworkErrorsNow(3_000))
        for (before in retryRows) {
            val after = requireNotNull(dao.getById(before.clientTransactionId))
            val eligible = before.lastErrorCode in setOf(LocalErrorCode.NETWORK_ERROR, LocalErrorCode.TIMEOUT)
            assertEquals(if (eligible) before.copy(nextAttemptAt = 3_000, updatedAt = 3_000) else before, after)
        }
        assertEquals(activeBefore, dao.getById(active.clientTransactionId))
        assertEquals(pending, dao.getById(pending.clientTransactionId))
        assertEquals(0, dao.retryNetworkErrorsNow(3_000))
    }

    @Test fun `abandoned syncing returns to retry while a current claim is preserved`() = runBlocking {
        val old = insert()
        dao.claimEligible(2_000, 10)
        val recent = insert()
        dao.claimEligible(5_000, 10)
        assertEquals(1, dao.recoverAbandonedSyncing(5_000, 6_000))
        val recovered = dao.getById(old.clientTransactionId)!!
        assertEquals(SyncStatus.RETRY, recovered.syncStatus)
        assertEquals(LocalErrorCode.STALE_SYNC, recovered.lastErrorCode)
        assertEquals(6_000L, recovered.nextAttemptAt)
        assertEquals(1, recovered.attempts)
        assertEquals(SyncStatus.SYNCING, dao.getById(recent.clientTransactionId)!!.syncStatus)
        assertEquals(0, dao.recoverAbandonedSyncing(5_000, 6_000))
        assertEquals(old.clientTransactionId, dao.claimEligible(6_000, 10).single().clientTransactionId)
    }

    @Test fun `late worker cannot mutate a recovered and reclaimed attempt`() = runBlocking {
        val row = insert()
        dao.claimEligible(2_000, 10)
        dao.recoverAbandonedSyncing(2_001, 3_000)
        dao.claimEligible(3_000, 10)
        val server = UUID.randomUUID().toString()
        assertEquals(0, dao.markSynced(row.clientTransactionId, 1, server, 3_100))
        assertEquals(0, dao.markFailed(row.clientTransactionId, 1, LocalErrorCode.INVALID_CAPTURE, 3_100))
        assertEquals(0, dao.markRetry(row.clientTransactionId, 1, LocalErrorCode.TIMEOUT, 4_000, 3_100))
        assertEquals(1, dao.markSynced(row.clientTransactionId, 2, server, 3_200))
    }

    @Test fun `reinsert of known UUID cannot reset state or replace financial data`() = runBlocking {
        val row = insert()
        dao.claimEligible(2_000, 10)
        var conflict = false
        try { dao.insertPending(row.copy(amount = "999.00")) } catch (_: android.database.sqlite.SQLiteConstraintException) { conflict = true }
        assertTrue(conflict)
        val retained = dao.getById(row.clientTransactionId)!!
        assertEquals("10.90", retained.amount)
        assertEquals(SyncStatus.SYNCING, retained.syncStatus)
        assertEquals(1, retained.attempts)
    }

    @Test fun `initial insertion cannot forge a synced or previously attempted capture`() = runBlocking {
        val pending = PendingTransactionEntity.pending(Fixtures.transaction(), 1_000)
        for (invalid in listOf(pending.copy(syncStatus = SyncStatus.SYNCED), pending.copy(attempts = 1))) {
            var rejected = false
            try { dao.insertPending(invalid) } catch (_: IllegalArgumentException) { rejected = true }
            assertTrue(rejected)
        }
        assertNull(dao.getById(pending.clientTransactionId))
    }

    @Test fun `concurrent claimers receive disjoint batches across database instances`() = runBlocking {
        val name = "claims-${UUID.randomUUID()}.db"
        val first = Room.databaseBuilder(context, FinanceDatabase::class.java, name).build()
        val second = Room.databaseBuilder(context, FinanceDatabase::class.java, name).build()
        try {
            val ids = (1..20).map {
                val row = PendingTransactionEntity.pending(Fixtures.transaction(), it.toLong())
                first.pendingTransactions().insertPending(row)
                row.clientTransactionId
            }
            val start = CompletableDeferred<Unit>()
            val batches = coroutineScope {
                val tasks = listOf(first, second).map { db -> async(Dispatchers.IO) {
                    start.await()
                    db.pendingTransactions().claimEligible(2_000, 10)
                } }
                start.complete(Unit)
                tasks.awaitAll()
            }
            assertEquals(listOf(10, 10), batches.map { it.size })
            val all = batches.flatten()
            assertEquals(ids.toSet(), all.map { it.clientTransactionId }.toSet())
            assertEquals(20, all.map { it.clientTransactionId }.distinct().size)
            assertTrue(all.all { it.syncStatus == SyncStatus.SYNCING && it.attempts == 1 })
        } finally { first.close(); second.close(); context.deleteDatabase(name) }
    }

    @Test fun `on disk queue survives close and reopen with the same UUID and cents`() = runBlocking {
        val name = "durable-${UUID.randomUUID()}.db"
        val row = PendingTransactionEntity.pending(Fixtures.transaction("0.10"), 1_000)
        Room.databaseBuilder(context, FinanceDatabase::class.java, name).build().let { db ->
            try { db.pendingTransactions().insertPending(row) } finally { db.close() }
        }
        val reopened = Room.databaseBuilder(context, FinanceDatabase::class.java, name).build()
        try { assertEquals(row, reopened.pendingTransactions().getById(row.clientTransactionId)) }
        finally { reopened.close(); context.deleteDatabase(name) }
    }
}
