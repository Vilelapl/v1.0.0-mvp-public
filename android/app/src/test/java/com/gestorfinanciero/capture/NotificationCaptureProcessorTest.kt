package com.gestorfinanciero.capture

import android.content.Context
import androidx.room.Room
import androidx.test.core.app.ApplicationProvider
import com.gestorfinanciero.Fixtures
import com.gestorfinanciero.capture.parsers.IgnoreReason
import com.gestorfinanciero.capture.parsers.NotificationParser
import com.gestorfinanciero.capture.parsers.ParseResult
import com.gestorfinanciero.capture.parsers.YapeNotificationParser
import com.gestorfinanciero.data.local.FinanceDatabase
import com.gestorfinanciero.data.local.PendingTransactionRepository
import com.gestorfinanciero.data.local.SyncStatus
import com.gestorfinanciero.domain.NotificationSource
import com.gestorfinanciero.domain.TransactionNormalizer
import com.gestorfinanciero.domain.TransactionType
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
import java.time.Clock
import java.time.Instant
import java.time.ZoneOffset
import java.util.UUID

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [35])
@SQLiteMode(SQLiteMode.Mode.NATIVE)
class NotificationCaptureProcessorTest {
    private lateinit var database: FinanceDatabase
    private val clock = Clock.fixed(Instant.parse("2026-09-10T13:00:05Z"), ZoneOffset.UTC)

    @Before fun setup() {
        database = Room.inMemoryDatabaseBuilder(
            ApplicationProvider.getApplicationContext<Context>(), FinanceDatabase::class.java,
        ).build()
    }

    @After fun close() { database.close() }

    private fun processor(
        parser: NotificationParser = NotificationParser { ParseResult.Parsed(Fixtures.parsed) },
        normalizer: TransactionNormalizer = TransactionNormalizer(),
    ) = NotificationCaptureProcessor(
        NotificationRouter(FinancialSourceRegistry(Fixtures.packages), mapOf(NotificationSource.IO to parser)),
        normalizer, PendingTransactionRepository(database.pendingTransactions(), clock),
    )

    @Test fun `fixture traverses router parser normalization and Room with UUID allocated before insertion`() = runBlocking {
        val dao = database.pendingTransactions()
        val uuid = UUID.randomUUID()
        var allocated = 0
        val processor = processor(normalizer = TransactionNormalizer {
            // A synchronous read on another thread verifies allocation precedes Room insertion.
            assertNull(runBlocking(Dispatchers.IO) { dao.getById(uuid.toString()) })
            allocated++
            uuid
        })
        val result = processor.capture(Fixtures.notification) as CaptureResult.Persisted
        assertEquals(1, allocated)
        assertEquals(uuid.toString(), result.clientTransactionId)
        val stored = dao.getById(result.clientTransactionId)!!
        assertEquals("10.90", stored.amount)
        assertEquals("2026-09-10T13:00:00Z", stored.occurredAt)
        assertEquals(NotificationSource.IO, stored.source)
        assertEquals(SyncStatus.PENDING, stored.syncStatus)
        assertEquals(0, stored.attempts)
        assertNull(stored.serverTransactionId)
        assertNull(stored.currency)
        assertNull(stored.description)
        assertNull(stored.account)
        assertEquals(clock.millis(), stored.createdAt)
        assertEquals(stored, dao.getById(result.clientTransactionId))
        assertEquals(1, allocated)
    }

    @Test fun `ignored unknown and invalid captures never reach Room or allocate UUID`() = runBlocking {
        val noId = TransactionNormalizer { error("Unexpected UUID allocation") }
        val ignored = processor(NotificationParser { ParseResult.Ignored(IgnoreReason.NOT_FINANCIAL) }, noId)
        assertTrue(ignored.capture(Fixtures.notification) is CaptureResult.Ignored)
        assertTrue(processor(normalizer = noId).capture(Fixtures.notification.copy(packageName = "other.app")) is CaptureResult.Ignored)
        val invalid = processor(NotificationParser { ParseResult.Parsed(Fixtures.parsed.copy(amount = "0.00")) }, noId)
        assertTrue(invalid.capture(Fixtures.notification) is CaptureResult.Invalid)
        for (state in SyncStatus.entries) assertTrue(database.pendingTransactions().listByStatus(state).isEmpty())
    }

    @Test fun `notification bursts preserve independent captures without financial deduplication`() = runBlocking {
        val processor = processor()
        val results = coroutineScope {
            (1..30).map { index -> async(Dispatchers.Default) {
                processor.capture(Fixtures.notification.copy(notificationKey = "fixture-$index")) as CaptureResult.Persisted
            } }.awaitAll()
        }
        val stored = database.pendingTransactions().listByStatus(SyncStatus.PENDING)
        assertEquals(30, stored.size)
        assertEquals(30, results.map { it.clientTransactionId }.toSet().size)
        assertTrue(stored.all { it.amount == "10.90" && it.attempts == 0 })
    }

    @Test fun `Room columns store normalized fields without raw notification metadata`() = runBlocking(Dispatchers.IO) {
        processor().capture(Fixtures.notification)
        database.openHelper.readableDatabase.query("SELECT * FROM pending_transactions").use { cursor ->
            assertTrue(cursor.moveToFirst())
            assertEquals(setOf("clientTransactionId", "amount", "currency", "occurredAt", "description", "type",
                "account", "source", "syncStatus", "attempts", "nextAttemptAt", "lastAttemptAt", "lastErrorCode",
                "serverTransactionId", "createdAt", "updatedAt"), cursor.columnNames.toSet())
            assertEquals("pending", cursor.getString(cursor.getColumnIndexOrThrow("syncStatus")))
            assertEquals("expense", cursor.getString(cursor.getColumnIndexOrThrow("type")))
            assertEquals("io_notification", cursor.getString(cursor.getColumnIndexOrThrow("source")))
        }
    }

    @Test fun `observed decimal Yapes reach Room independently with exact amounts and publication times`() = runBlocking {
        var allocated = 0
        val processor = NotificationCaptureProcessor(
            NotificationRouter(FinancialSourceRegistry.production(), mapOf(NotificationSource.YAPE to YapeNotificationParser())),
            TransactionNormalizer { allocated++; UUID.randomUUID() },
            PendingTransactionRepository(database.pendingTransactions(), clock),
        )
        val observations = listOf("income-decimal-observed-01.json", "income-decimal-observed-02.json")
            .map { notificationFixture("yape/$it") }
        val results = observations.map { processor.capture(it) as CaptureResult.Persisted }
        val stored = database.pendingTransactions().listByStatus(SyncStatus.PENDING)
        assertEquals(2, allocated)
        assertEquals(2, stored.size)
        assertEquals(2, results.map { it.clientTransactionId }.toSet().size)
        assertEquals(observations.map { Instant.ofEpochMilli(it.postTime).toString() }.toSet(), stored.map { it.occurredAt }.toSet())
        assertTrue(stored.all { it.amount == "1.1" && it.currency == "PEN" && it.type == TransactionType.INCOME
            && it.source == NotificationSource.YAPE && it.attempts == 0 && it.description == null && it.account == null })
    }
}
