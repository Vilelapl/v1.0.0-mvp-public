package com.gestorfinanciero.sync

import android.app.Application
import android.content.Context
import androidx.room.Room
import androidx.test.core.app.ApplicationProvider
import androidx.work.BackoffPolicy
import androidx.work.Configuration
import androidx.work.ExistingWorkPolicy
import androidx.work.ListenableWorker
import androidx.work.NetworkType
import androidx.work.WorkInfo
import androidx.work.WorkManager
import androidx.work.WorkerFactory
import androidx.work.WorkerParameters
import androidx.work.testing.WorkManagerTestInitHelper
import androidx.work.testing.TestListenableWorkerBuilder
import com.gestorfinanciero.data.local.FinanceDatabase
import com.gestorfinanciero.Fixtures
import com.gestorfinanciero.auth.DeviceCredential
import com.gestorfinanciero.data.local.PendingTransactionEntity
import com.gestorfinanciero.data.local.SyncStatus
import com.gestorfinanciero.data.remote.FinanceApiFactory
import java.util.UUID
import java.util.concurrent.Executors
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.withTimeout
import okhttp3.mockwebserver.MockResponse
import okhttp3.mockwebserver.MockWebServer
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [35], application = Application::class)
class WorkManagerTest {
    @Test fun `one time request requires network and uses exponential backoff`() {
        val request = SyncScheduler.request(123_000)
        assertEquals(NetworkType.CONNECTED, request.workSpec.constraints.requiredNetworkType)
        assertEquals(BackoffPolicy.EXPONENTIAL, request.workSpec.backoffPolicy)
        assertEquals(60_000L, request.workSpec.backoffDelayDuration)
        assertEquals(123_000L, request.workSpec.initialDelay)
        assertFalse(request.workSpec.isPeriodic)
        assertTrue(request.workSpec.input.keyValueMap.isEmpty())
    }

    @Test fun `TestDriver releases worker only after network constraint is met`() = runBlocking {
        val context = ApplicationProvider.getApplicationContext<Context>()
        val database = Room.inMemoryDatabaseBuilder(context, FinanceDatabase::class.java).build()
        val executor = Executors.newFixedThreadPool(2)
        var executions = 0
        val engine = SyncEngine(database.pendingTransactions(), TestCredentialStore(null), FinanceApiFactory(), {})
        val factory = object : WorkerFactory() {
            override fun createWorker(appContext: Context, workerClassName: String, workerParameters: WorkerParameters): ListenableWorker? {
                if (workerClassName != TransactionSyncWorker::class.java.name) return null
                executions++
                return TransactionSyncWorker(appContext, workerParameters, engine)
            }
        }
        try {
            WorkManagerTestInitHelper.initializeTestWorkManager(context,
                Configuration.Builder().setExecutor(executor).setWorkerFactory(factory).build())
            val manager = WorkManager.getInstance(context)
            val request = SyncScheduler.request()
            manager.enqueue(request).result.get()
            assertEquals(WorkInfo.State.ENQUEUED, manager.getWorkInfoById(request.id).get()?.state)
            assertEquals(0, executions)
            requireNotNull(WorkManagerTestInitHelper.getTestDriver(context)).setAllConstraintsMet(request.id)
            val finished = withTimeout(10_000) { manager.getWorkInfoByIdFlow(request.id).first { it?.state?.isFinished == true } }
            assertEquals(WorkInfo.State.SUCCEEDED, finished?.state)
            assertEquals(1, executions)
        } finally { executor.shutdownNow(); database.close() }
    }

    @Test fun `new capture bypasses older delay and deferred worker can replace and cancel itself`() = runBlocking {
        val context = ApplicationProvider.getApplicationContext<Context>()
        val database = Room.inMemoryDatabaseBuilder(context, FinanceDatabase::class.java).build()
        val dao = database.pendingTransactions()
        val executor = Executors.newFixedThreadPool(4)
        val server = MockWebServer().apply { start() }
        val clock = TestClock()
        val credentials = TestCredentialStore(DeviceCredential(server.url("/").newBuilder().host("127.0.0.1").build().toString(), UUID.randomUUID().toString(), "t".repeat(43)))
        val scheduler = SyncScheduler(context)
        val engine = SyncEngine(dao, credentials, FinanceApiFactory(), { scheduler.scheduleAfter(it) }, clock,
            cancelDeferred = { scheduler.cancelDeferred() })
        val factory = object : WorkerFactory() {
            override fun createWorker(appContext: Context, workerClassName: String, workerParameters: WorkerParameters): ListenableWorker? =
                if (workerClassName == TransactionSyncWorker::class.java.name) TransactionSyncWorker(appContext, workerParameters, engine) else null
        }
        fun success(id: String) = MockResponse().setResponseCode(201).setHeader("Content-Type", "application/json")
            .setBody("""{"data":{"transactionId":"10000000-0000-4000-8000-000000000001","clientTransactionId":"$id","syncResult":"created"}}""")
        try {
            WorkManagerTestInitHelper.initializeTestWorkManager(context,
                Configuration.Builder().setExecutor(executor).setWorkerFactory(factory).build())
            val manager = WorkManager.getInstance(context)
            val driver = requireNotNull(WorkManagerTestInitHelper.getTestDriver(context))
            suspend fun runReady() {
                val ready = manager.getWorkInfosForUniqueWork(SyncScheduler.READY_WORK_NAME).get().single { !it.state.isFinished }
                assertEquals(WorkInfo.State.ENQUEUED, ready.state)
                driver.setAllConstraintsMet(ready.id)
                val finished = withTimeout(10_000) { manager.getWorkInfoByIdFlow(ready.id).first { it?.state?.isFinished == true } }
                assertEquals(WorkInfo.State.SUCCEEDED, finished?.state)
                // WorkInfo counts the completed execution; WorkerParameters
                // supplied to that first execution uses attempt zero.
                assertEquals(1, finished?.runAttemptCount)
            }
            val old = PendingTransactionEntity.pending(Fixtures.transaction(), clock.millis())
            dao.insertPending(old)
            server.enqueue(MockResponse().setResponseCode(429).setHeader("Retry-After", "600"))
            scheduler.enqueue(); runReady()
            val deferred = manager.getWorkInfosForUniqueWork(SyncScheduler.DEFERRED_WORK_NAME).get().single { !it.state.isFinished }
            assertEquals(600_000L, deferred.initialDelayMillis)
            val fresh = PendingTransactionEntity.pending(Fixtures.transaction(), clock.millis())
            dao.insertPending(fresh)
            server.enqueue(success(fresh.clientTransactionId))
            scheduler.enqueue(); runReady()
            assertEquals(SyncStatus.SYNCED, dao.getById(fresh.clientTransactionId)?.syncStatus)
            assertEquals(SyncStatus.RETRY, dao.getById(old.clientTransactionId)?.syncStatus)
            assertEquals(2, server.requestCount)
            assertEquals(clock.millis() + 600_000, dao.getById(old.clientTransactionId)?.nextAttemptAt)
            val next = manager.getWorkInfosForUniqueWork(SyncScheduler.DEFERRED_WORK_NAME).get().single { !it.state.isFinished }
            clock.now += 600_000
            server.enqueue(MockResponse().setResponseCode(429).setHeader("Retry-After", "900"))
            driver.setAllConstraintsMet(next.id)
            driver.setInitialDelayMet(next.id)
            // REPLACE deletes the previous WorkSpec, so its flow may emit null
            // without exposing a terminal state. The persisted successor is
            // the observable guarantee that the retry still has a wake-up.
            val successor = withTimeout(10_000) {
                manager.getWorkInfosForUniqueWorkFlow(SyncScheduler.DEFERRED_WORK_NAME).first { infos -> infos.any { !it.state.isFinished && it.id != next.id } }
            }.single { !it.state.isFinished }
            assertEquals(SyncStatus.RETRY, dao.getById(old.clientTransactionId)?.syncStatus)
            assertEquals(2, dao.getById(old.clientTransactionId)?.attempts)
            assertEquals(clock.millis() + 900_000, dao.getById(old.clientTransactionId)?.nextAttemptAt)
            assertEquals(900_000L, successor.initialDelayMillis)
            assertEquals(3, server.requestCount)
            clock.now += 900_000
            server.enqueue(success(old.clientTransactionId))
            driver.setAllConstraintsMet(successor.id)
            driver.setInitialDelayMet(successor.id)
            withTimeout(10_000) { manager.getWorkInfoByIdFlow(successor.id).first { it?.state?.isFinished == true } }
            assertEquals(SyncStatus.SYNCED, dao.getById(old.clientTransactionId)?.syncStatus)
            assertEquals(4, server.requestCount)
            assertTrue(manager.getWorkInfosForUniqueWork(SyncScheduler.DEFERRED_WORK_NAME).get().all { it.state.isFinished })
        } finally { server.shutdown(); executor.shutdownNow(); database.close() }
    }

    @Test fun `startup migration cancels only the old chain and leaves ready and deferred work intact`() = runBlocking {
        val context = ApplicationProvider.getApplicationContext<Context>()
        context.getSharedPreferences("sync-scheduling", Context.MODE_PRIVATE).edit().clear().commit()
        val executor = Executors.newFixedThreadPool(2)
        try {
            WorkManagerTestInitHelper.initializeTestWorkManager(context, Configuration.Builder().setExecutor(executor).build())
            val manager = WorkManager.getInstance(context)
            val scheduler = SyncScheduler(context)
            val legacy = SyncScheduler.request(SyncPolicy.MAX_BACKOFF_MILLIS)
            manager.enqueueUniqueWork(SyncScheduler.WORK_NAME, ExistingWorkPolicy.KEEP, legacy).result.get()
            scheduler.enqueue()
            scheduler.scheduleAfter(600_000)
            scheduler.migrateLegacyOnce()
            assertEquals(WorkInfo.State.CANCELLED, manager.getWorkInfoById(legacy.id).get()?.state)
            assertEquals(WorkInfo.State.ENQUEUED, manager.getWorkInfosForUniqueWork(SyncScheduler.READY_WORK_NAME).get().single().state)
            assertEquals(WorkInfo.State.ENQUEUED, manager.getWorkInfosForUniqueWork(SyncScheduler.DEFERRED_WORK_NAME).get().single().state)
            scheduler.migrateLegacyOnce()
            assertEquals(1, manager.getWorkInfosForUniqueWork(SyncScheduler.READY_WORK_NAME).get().size)
        } finally { executor.shutdownNow() }
    }

    @Test fun `scheduler failure retains an automatic wakeup and recovers the same capture`() = runBlocking {
        val context = ApplicationProvider.getApplicationContext<Context>()
        val database = Room.inMemoryDatabaseBuilder(context, FinanceDatabase::class.java).build()
        val dao = database.pendingTransactions()
        val server = MockWebServer().apply { start() }
        val clock = TestClock()
        val credentials = TestCredentialStore(DeviceCredential(server.url("/").newBuilder().host("127.0.0.1").build().toString(), UUID.randomUUID().toString(), "t".repeat(43)))
        try {
            for (failures in listOf(1, 2)) {
                var scheduleCalls = 0
                val deferred = mutableListOf<Long>()
                val engine = SyncEngine(dao, credentials, FinanceApiFactory(), { delay ->
                    scheduleCalls++
                    if (scheduleCalls <= failures) throw IllegalStateException("Synthetic scheduler unavailable")
                    deferred += delay
                }, clock)
                val factory = object : WorkerFactory() {
                    override fun createWorker(appContext: Context, workerClassName: String, workerParameters: WorkerParameters): ListenableWorker? =
                        if (workerClassName == TransactionSyncWorker::class.java.name) TransactionSyncWorker(appContext, workerParameters, engine) else null
                }
                fun worker() = TestListenableWorkerBuilder.from(context, TransactionSyncWorker::class.java)
                    .setWorkerFactory(factory).build()
                val row = PendingTransactionEntity.pending(Fixtures.transaction(), clock.millis())
                dao.insertPending(row)
                server.enqueue(MockResponse().setResponseCode(500))
                val expected = if (failures == 1) ListenableWorker.Result.success() else ListenableWorker.Result.retry()
                assertEquals(expected, worker().doWork())
                assertEquals(2, scheduleCalls)
                assertEquals(if (failures == 1) listOf(60_000L) else emptyList<Long>(), deferred)
                val retry = requireNotNull(dao.getById(row.clientTransactionId))
                assertEquals(SyncStatus.RETRY, retry.syncStatus)
                assertEquals(1, retry.attempts)
                clock.now = requireNotNull(retry.nextAttemptAt)
                server.enqueue(MockResponse().setResponseCode(201).setHeader("Content-Type", "application/json")
                    .setBody("""{"data":{"transactionId":"10000000-0000-4000-8000-000000000001","clientTransactionId":"${row.clientTransactionId}","syncResult":"created"}}"""))
                assertEquals(ListenableWorker.Result.success(), worker().doWork())
                val saved = requireNotNull(dao.getById(row.clientTransactionId))
                assertEquals(SyncStatus.SYNCED, saved.syncStatus)
                assertEquals(row.amount, saved.amount)
                assertEquals(2, saved.attempts)
            }
            assertEquals(4, server.requestCount)
        } finally { server.shutdown(); database.close() }
    }
}
