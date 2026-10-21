package com.gestorfinanciero

import android.app.Application
import com.gestorfinanciero.auth.KeystoreCredentialStore
import com.gestorfinanciero.auth.PairingManager
import com.gestorfinanciero.capture.FinancialSourceRegistry
import com.gestorfinanciero.capture.NotificationCaptureProcessor
import com.gestorfinanciero.capture.NotificationRouter
import com.gestorfinanciero.capture.parsers.YapeNotificationParser
import com.gestorfinanciero.capture.parsers.IoNotificationParser
import com.gestorfinanciero.capture.parsers.GoogleWalletNotificationParser
import com.gestorfinanciero.capture.WalletCardRegistry
import com.gestorfinanciero.data.local.FinanceDatabase
import com.gestorfinanciero.data.local.PendingTransactionRepository
import com.gestorfinanciero.domain.TransactionNormalizer
import com.gestorfinanciero.domain.NotificationSource
import com.gestorfinanciero.data.remote.FinanceApiFactory
import com.gestorfinanciero.sync.SyncEngine
import com.gestorfinanciero.sync.SyncPolicy
import com.gestorfinanciero.sync.SyncScheduler
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.launch

class FinanceApplication : Application() {
    val sources: FinancialSourceRegistry = FinancialSourceRegistry.production()
    val database by lazy { FinanceDatabase.create(this) }
    val credentials by lazy { KeystoreCredentialStore(this) }
    val walletCards by lazy { WalletCardRegistry(this) }
    private val apiFactory by lazy { FinanceApiFactory() }
    val scheduler by lazy { SyncScheduler(this) }
    val pairing by lazy { PairingManager(credentials, apiFactory, BuildConfig.DEBUG) { scheduler.enqueue() } }
    val syncEngine by lazy { SyncEngine(database.pendingTransactions(), credentials, apiFactory,
        { scheduler.scheduleAfter(it) }, cancelDeferred = { scheduler.cancelDeferred() }) }
    private val startupScope = CoroutineScope(SupervisorJob() + Dispatchers.IO)

    override fun onCreate() {
        super.onCreate()
        // One startup recovery, no timer, loop or perpetual service.
        startupScope.launch {
            try {
                scheduler.migrateLegacyOnce()
                requestPendingSync()
            } catch (_: Exception) { /* queue remains durable */ }
        }
    }

    suspend fun requestPendingSync(manualRetry: Boolean = false) {
        if (credentials.current() == null) return
        val now = System.currentTimeMillis()
        val dao = database.pendingTransactions()
        if (manualRetry) dao.retryNetworkErrorsNow(now)
        if (dao.nextWakeAt(now, SyncPolicy.STALE_AFTER_MILLIS) == null) return
        scheduler.enqueue()
    }
    val captureProcessor by lazy {
        NotificationCaptureProcessor(
            NotificationRouter(sources, mapOf(
                NotificationSource.YAPE to YapeNotificationParser(),
                NotificationSource.IO to IoNotificationParser(),
                NotificationSource.GOOGLE_WALLET to GoogleWalletNotificationParser(walletCards::resolve),
            )),
            TransactionNormalizer(),
            PendingTransactionRepository(database.pendingTransactions(), onPersisted = {
                if (credentials.current() != null) scheduler.enqueue()
            }),
        )
    }
}
