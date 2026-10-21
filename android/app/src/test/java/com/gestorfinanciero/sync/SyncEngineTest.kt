package com.gestorfinanciero.sync

import android.content.Context
import androidx.room.Room
import androidx.test.core.app.ApplicationProvider
import com.google.gson.JsonParser
import com.gestorfinanciero.Fixtures
import com.gestorfinanciero.auth.DeviceCredential
import com.gestorfinanciero.auth.PairingManager
import com.gestorfinanciero.auth.PairingResult
import com.gestorfinanciero.auth.PairingState
import com.gestorfinanciero.data.local.FinanceDatabase
import com.gestorfinanciero.data.local.LocalErrorCode
import com.gestorfinanciero.data.local.PendingTransactionEntity
import com.gestorfinanciero.data.local.SyncStatus
import com.gestorfinanciero.data.remote.FinanceApiFactory
import java.time.Clock
import java.time.Instant
import java.time.ZoneId
import java.time.ZoneOffset
import java.util.UUID
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicInteger
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.async
import kotlinx.coroutines.runBlocking
import okhttp3.mockwebserver.Dispatcher
import okhttp3.mockwebserver.MockResponse
import okhttp3.mockwebserver.MockWebServer
import okhttp3.mockwebserver.RecordedRequest
import okhttp3.mockwebserver.SocketPolicy
import org.junit.After
import org.junit.Assert.*
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config
import org.robolectric.shadows.ShadowLog

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [35])
class SyncEngineTest {
    private lateinit var database: FinanceDatabase
    private val dao get() = database.pendingTransactions()
    private lateinit var server: MockWebServer
    private lateinit var credentials: TestCredentialStore
    private val clock = TestClock()
    private val scheduled = mutableListOf<Long>()
    private val token = "t".repeat(43)
    private val serverId = "10000000-0000-4000-8000-000000000001"

    @Before fun setup() {
        database = Room.inMemoryDatabaseBuilder(ApplicationProvider.getApplicationContext<Context>(), FinanceDatabase::class.java).build()
        server = MockWebServer().apply { start() }
        credentials = TestCredentialStore(DeviceCredential(server.url("/").newBuilder().host("127.0.0.1").build().toString(), UUID.randomUUID().toString(), token))
    }

    @After fun teardown() { server.shutdown(); database.close() }

    private fun engine(timeout: Long = 2_000) = SyncEngine(dao, credentials, FinanceApiFactory(timeout), { scheduled += it }, clock)
    private suspend fun insert(): PendingTransactionEntity = PendingTransactionEntity.pending(Fixtures.transaction(), clock.millis()).also { dao.insertPending(it) }
    private fun success(id: String, status: String = "created", transactionId: String = serverId) = MockResponse()
        .setResponseCode(if (status == "created") 201 else 200).setHeader("Content-Type", "application/json")
        .setBody("""{"data":{"transactionId":"$transactionId","clientTransactionId":"$id","syncResult":"$status"}}""")

    @Test fun `created and already exists both store server UUID and synced state`() = runBlocking {
        for (status in listOf("created", "already_exists")) {
            val row = insert()
            server.enqueue(success(row.clientTransactionId, status))
            assertEquals(SyncRunResult.COMPLETE, engine().run(0))
            val saved = requireNotNull(dao.getById(row.clientTransactionId))
            assertEquals(SyncStatus.SYNCED, saved.syncStatus)
            assertEquals(serverId, saved.serverTransactionId)
            assertEquals(1, saved.attempts)
            val request = requireNotNull(server.takeRequest(2, TimeUnit.SECONDS))
            assertEquals("/api/v1/device/transactions/sync", request.path)
            assertEquals("Bearer $token", request.getHeader("Authorization"))
            val body = JsonParser.parseString(request.body.readUtf8()).asJsonObject
            assertEquals(setOf("clientTransactionId", "amount", "currency", "occurredAt", "description", "type", "account", "source"), body.keySet())
            assertTrue(body["amount"].asJsonPrimitive.isString)
            assertTrue(body["currency"].isJsonNull)
            assertEquals(row.clientTransactionId, body["clientTransactionId"].asString)
            assertFalse(saved.toString().contains(token))
        }
        assertTrue(ShadowLog.getLogs().none { it.msg.orEmpty().contains(token) })
    }

    @Test fun `400 and 422 are permanent and never retain the sensitive error body`() = runBlocking {
        for (code in listOf(400, 422)) {
            val row = insert()
            server.enqueue(MockResponse().setResponseCode(code).setBody("PRIVATE_FINANCIAL_ERROR_BODY"))
            engine().run(0)
            val saved = requireNotNull(dao.getById(row.clientTransactionId))
            assertEquals(SyncStatus.FAILED, saved.syncStatus)
            assertEquals(LocalErrorCode.INVALID_CAPTURE, saved.lastErrorCode)
            assertNull(saved.nextAttemptAt)
            assertFalse(saved.toString().contains("PRIVATE_FINANCIAL_ERROR_BODY"))
        }
        engine().run(0)
        assertEquals(2, server.requestCount)
    }

    @Test fun `429 and 500 retry with WorkManager exponential delay and respect eligibility`() = runBlocking {
        for ((code, error) in listOf(429 to LocalErrorCode.RATE_LIMITED, 500 to LocalErrorCode.SERVER_ERROR)) {
            val row = insert()
            server.enqueue(MockResponse().setResponseCode(code))
            assertEquals(SyncRunResult.RETRY_SCHEDULED, engine().run(2))
            val saved = requireNotNull(dao.getById(row.clientTransactionId))
            assertEquals(SyncStatus.RETRY, saved.syncStatus)
            assertEquals(error, saved.lastErrorCode)
            assertEquals(clock.millis() + 240_000, saved.nextAttemptAt)
        }
        engine().run(3)
        assertEquals(2, server.requestCount)
        assertEquals(240_000L, scheduled.last())
    }

    @Test fun `timeout resend preserves UUID and already exists completes the original row`() = runBlocking {
        val row = insert()
        server.enqueue(MockResponse().setSocketPolicy(SocketPolicy.NO_RESPONSE))
        assertEquals(SyncRunResult.RETRY_SCHEDULED, engine(200).run(0))
        val retried = requireNotNull(dao.getById(row.clientTransactionId))
        assertEquals(LocalErrorCode.TIMEOUT, retried.lastErrorCode)
        assertEquals(SyncStatus.RETRY, retried.syncStatus)
        clock.now = requireNotNull(retried.nextAttemptAt)
        server.enqueue(success(row.clientTransactionId, "already_exists"))
        engine().run(1)
        val first = requireNotNull(server.takeRequest(2, TimeUnit.SECONDS)).body.readUtf8()
        val second = requireNotNull(server.takeRequest(2, TimeUnit.SECONDS)).body.readUtf8()
        assertEquals(first, second)
        assertEquals(SyncStatus.SYNCED, dao.getById(row.clientTransactionId)?.syncStatus)
        assertEquals(2, dao.getById(row.clientTransactionId)?.attempts)
    }

    @Test fun `401 keeps all claimed captures and pairing allows them to resume with bearer`() = runBlocking {
        val rows = listOf(insert(), insert())
        server.enqueue(MockResponse().setResponseCode(401))
        assertEquals(SyncRunResult.COMPLETE, engine().run(0))
        assertEquals(PairingState.REPAIR_REQUIRED, credentials.state())
        for (row in rows) assertEquals(SyncStatus.RETRY, dao.getById(row.clientTransactionId)?.syncStatus)
        engine().run(0)
        assertEquals(1, server.requestCount)
        val freshToken = "n".repeat(43)
        val deviceId = UUID.randomUUID().toString()
        server.enqueue(MockResponse().setResponseCode(201).setBody("""{"data":{"deviceId":"$deviceId","deviceToken":"$freshToken"}}"""))
        var requested = false
        val manager = PairingManager(credentials, FinanceApiFactory(), true) { requested = true }
        assertEquals(PairingResult.PAIRED, manager.pair(server.url("/").newBuilder().host("127.0.0.1").build().toString(), "ABCDE-FGHJK", "S25 de prueba"))
        assertTrue(requested)
        server.takeRequest(2, TimeUnit.SECONDS)
        val pairingRequest = requireNotNull(server.takeRequest(2, TimeUnit.SECONDS))
        assertEquals("/api/v1/devices/pair", pairingRequest.path)
        assertNull(pairingRequest.getHeader("Authorization"))
        respondToCaptures()
        engine().run(0)
        for (row in rows) assertEquals(SyncStatus.SYNCED, dao.getById(row.clientTransactionId)?.syncStatus)
        repeat(2) { assertEquals("Bearer $freshToken", server.takeRequest(2, TimeUnit.SECONDS)?.getHeader("Authorization")) }
        assertEquals(PairingState.PAIRED, credentials.state())
    }

    @Test fun `small batches continue and never resend synced or failed rows`() = runBlocking {
        val failed = insert()
        val claimed = dao.claimEligible(clock.millis(), 1).single()
        dao.markFailed(failed.clientTransactionId, claimed.attempts, LocalErrorCode.INVALID_CAPTURE, clock.millis())
        repeat(11) { insert() }
        respondToCaptures()
        engine().run(0)
        assertEquals(10, server.requestCount)
        assertEquals(1, dao.listByStatus(SyncStatus.PENDING).size)
        assertEquals(listOf(0L), scheduled)
        engine().run(0)
        engine().run(0)
        assertEquals(11, server.requestCount)
        assertEquals(11, dao.listByStatus(SyncStatus.SYNCED).size)
        assertEquals(SyncStatus.FAILED, dao.getById(failed.clientTransactionId)?.syncStatus)
    }

    @Test fun `abandoned syncing is recovered only after its lease and keeps its UUID`() = runBlocking {
        val row = insert()
        dao.claimEligible(clock.millis(), 1)
        engine().run(0)
        assertEquals(0, server.requestCount)
        assertEquals(SyncPolicy.STALE_AFTER_MILLIS + 1, scheduled.single())
        clock.now += SyncPolicy.STALE_AFTER_MILLIS + 1
        server.enqueue(success(row.clientTransactionId))
        engine().run(0)
        assertEquals(2, dao.getById(row.clientTransactionId)?.attempts)
        assertEquals(SyncStatus.SYNCED, dao.getById(row.clientTransactionId)?.syncStatus)
    }

    @Test fun `old HTTP completion cannot overwrite a recovered newer attempt`() = runBlocking {
        val row = insert()
        val arrived = CountDownLatch(1)
        val release = CountDownLatch(1)
        val calls = AtomicInteger()
        val newServerId = UUID.randomUUID().toString()
        server.dispatcher = object : Dispatcher() {
            override fun dispatch(request: RecordedRequest): MockResponse {
                if (calls.incrementAndGet() == 1) { arrived.countDown(); release.await(8, TimeUnit.SECONDS); return success(row.clientTransactionId) }
                return success(row.clientTransactionId, transactionId = newServerId)
            }
        }
        val older = async(Dispatchers.IO) { engine(10_000).run(0) }
        try {
            assertTrue(arrived.await(4, TimeUnit.SECONDS))
            clock.now += SyncPolicy.STALE_AFTER_MILLIS + 1
            engine().run(0)
        } finally { release.countDown() }
        older.await()
        val saved = requireNotNull(dao.getById(row.clientTransactionId))
        assertEquals(2, saved.attempts)
        assertEquals(SyncStatus.SYNCED, saved.syncStatus)
        assertEquals(newServerId, saved.serverTransactionId)
    }

    @Test fun `a late 401 does not revoke a newly paired credential`() = runBlocking {
        val row = insert()
        val arrived = CountDownLatch(1)
        val release = CountDownLatch(1)
        server.dispatcher = object : Dispatcher() {
            override fun dispatch(request: RecordedRequest): MockResponse {
                arrived.countDown(); release.await(8, TimeUnit.SECONDS)
                return MockResponse().setResponseCode(401)
            }
        }
        val older = async(Dispatchers.IO) { engine(10_000).run(0) }
        val fresh = DeviceCredential(server.url("/").newBuilder().host("127.0.0.1").build().toString(), UUID.randomUUID().toString(), "n".repeat(43))
        try { assertTrue(arrived.await(4, TimeUnit.SECONDS)); credentials.save(fresh) }
        finally { release.countDown() }
        older.await()
        assertSame(fresh, credentials.current())
        assertEquals(SyncStatus.RETRY, dao.getById(row.clientTransactionId)?.syncStatus)
        assertEquals(listOf(0L), scheduled)
    }

    @Test fun `Retry After longer than backoff schedules one delayed request`() = runBlocking {
        val row = insert()
        server.enqueue(MockResponse().setResponseCode(429).setHeader("Retry-After", "600"))
        assertEquals(SyncRunResult.RETRY_SCHEDULED, engine().run(0))
        assertEquals(clock.millis() + 600_000, dao.getById(row.clientTransactionId)?.nextAttemptAt)
        assertEquals(listOf(600_000L), scheduled)
    }

    @Test fun `temporary failure defers unsent claims without spending requests on an unavailable server`() = runBlocking {
        val rows = List(5) { insert() }
        server.enqueue(MockResponse().setResponseCode(500))
        assertEquals(SyncRunResult.RETRY_SCHEDULED, engine().run(0))
        assertEquals(1, server.requestCount)
        for (row in rows) {
            val saved = requireNotNull(dao.getById(row.clientTransactionId))
            assertEquals(SyncStatus.RETRY, saved.syncStatus)
            assertEquals(clock.millis() + 60_000, saved.nextAttemptAt)
            assertEquals(row.clientTransactionId, saved.clientTransactionId)
        }
    }

    @Test fun `persisted attempts retain exponential backoff when each replacement starts at zero`() = runBlocking {
        val row = insert()
        val engine = engine()
        repeat(11) { attempt ->
            server.enqueue(MockResponse().setResponseCode(500))
            assertEquals(SyncRunResult.RETRY_SCHEDULED, engine.run(0))
            val saved = requireNotNull(dao.getById(row.clientTransactionId))
            assertEquals(attempt + 1, saved.attempts)
            assertEquals(clock.millis() + SyncPolicy.backoffMillis(attempt), saved.nextAttemptAt)
            clock.now = requireNotNull(saved.nextAttemptAt)
        }
        assertEquals(SyncPolicy.MAX_BACKOFF_MILLIS, scheduled.last())
    }

    @Test fun `simultaneous workers share one engine and do not replace work during HTTP`() = runBlocking {
        val first = insert()
        val arrived = CountDownLatch(1)
        val release = CountDownLatch(1)
        val calls = AtomicInteger()
        server.dispatcher = object : Dispatcher() {
            override fun dispatch(request: RecordedRequest): MockResponse {
                val id = JsonParser.parseString(request.body.readUtf8()).asJsonObject["clientTransactionId"].asString
                if (calls.incrementAndGet() == 1) { arrived.countDown(); release.await(8, TimeUnit.SECONDS) }
                return success(id)
            }
        }
        var cancelledDeferred = 0
        val engine = SyncEngine(dao, credentials, FinanceApiFactory(10_000), { scheduled += it }, clock,
            cancelDeferred = { cancelledDeferred++ })
        val older = async(Dispatchers.IO) { engine.run(0) }
        try {
            assertTrue(arrived.await(4, TimeUnit.SECONDS))
            val second = insert()
            val entered = CompletableDeferred<Unit>()
            val newer = async(Dispatchers.IO) { entered.complete(Unit); engine.run(0) }
            entered.await()
            assertEquals(SyncStatus.PENDING, dao.getById(second.clientTransactionId)?.syncStatus)
            assertEquals(1, calls.get())
            assertTrue(scheduled.isEmpty())
            assertEquals(0, cancelledDeferred)
            release.countDown()
            older.await(); newer.await()
            assertEquals(SyncStatus.SYNCED, dao.getById(first.clientTransactionId)?.syncStatus)
            assertEquals(SyncStatus.SYNCED, dao.getById(second.clientTransactionId)?.syncStatus)
            assertEquals(listOf(0L), scheduled)
            assertEquals(1, cancelledDeferred)
        } finally { release.countDown() }
    }

    @Test fun `mismatched acknowledgement never syncs another UUID`() = runBlocking {
        val row = insert()
        server.enqueue(success(UUID.randomUUID().toString()))
        engine().run(0)
        assertEquals(SyncStatus.RETRY, dao.getById(row.clientTransactionId)?.syncStatus)
        assertEquals(LocalErrorCode.INVALID_RESPONSE, dao.getById(row.clientTransactionId)?.lastErrorCode)
        assertNull(dao.getById(row.clientTransactionId)?.serverTransactionId)
    }

    private fun respondToCaptures() {
        server.dispatcher = object : Dispatcher() {
            override fun dispatch(request: RecordedRequest): MockResponse {
                val id = JsonParser.parseString(request.body.readUtf8()).asJsonObject["clientTransactionId"].asString
                return success(id)
            }
        }
    }
}

class TestClock(@Volatile var now: Long = 1_789_089_875_231) : Clock() {
    override fun getZone(): ZoneId = ZoneOffset.UTC
    override fun withZone(zone: ZoneId): Clock = this
    override fun instant(): Instant = Instant.ofEpochMilli(now)
}
