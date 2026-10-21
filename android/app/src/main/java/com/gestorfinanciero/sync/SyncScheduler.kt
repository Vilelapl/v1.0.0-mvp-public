package com.gestorfinanciero.sync

import android.content.Context
import androidx.work.BackoffPolicy
import androidx.work.Constraints
import androidx.work.ExistingWorkPolicy
import androidx.work.NetworkType
import androidx.work.OneTimeWorkRequest
import androidx.work.OneTimeWorkRequestBuilder
import androidx.work.WorkManager
import java.util.concurrent.TimeUnit
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.NonCancellable
import kotlinx.coroutines.withContext

class SyncScheduler(private val context: Context) {
    private val preferences = context.getSharedPreferences("sync-scheduling", Context.MODE_PRIVATE)
    suspend fun enqueue() = withContext(Dispatchers.IO) {
        // Only immediate work belongs to this chain. A capture arriving during
        // the final queue read still gets a successor, without inheriting a
        // previous capture's hours-long retry delay.
        WorkManager.getInstance(context).enqueueUniqueWork(READY_WORK_NAME, ExistingWorkPolicy.APPEND_OR_REPLACE, request()).result.get()
        Unit
    }

    /** Called only by the serialized engine, after its HTTP calls and claims finish. */
    suspend fun scheduleAfter(delayMillis: Long) = withContext(Dispatchers.IO + NonCancellable) {
        if (delayMillis <= 0) enqueue()
        else WorkManager.getInstance(context).enqueueUniqueWork(
            DEFERRED_WORK_NAME, ExistingWorkPolicy.REPLACE, request(delayMillis),
        ).result.get()
        Unit
    }

    /** Never cancels the immediate chain or a capture's last wake-up. */
    suspend fun cancelDeferred() = withContext(Dispatchers.IO + NonCancellable) {
        WorkManager.getInstance(context).cancelUniqueWork(DEFERRED_WORK_NAME).result.get()
        Unit
    }

    // Startup replaces the old delayed chain. An interrupted old worker releases
    // its claims; new workers share the engine mutex and retain the same UUIDs.
    suspend fun migrateLegacyOnce() = withContext(Dispatchers.IO + NonCancellable) {
        if (preferences.getBoolean("separateDeferredWork", false)) return@withContext
        WorkManager.getInstance(context).cancelUniqueWork(WORK_NAME).result.get()
        check(preferences.edit().putBoolean("separateDeferredWork", true).commit())
    }

    companion object {
        const val WORK_NAME = "financial-capture-sync"
        const val READY_WORK_NAME = "$WORK_NAME-ready"
        const val DEFERRED_WORK_NAME = "$WORK_NAME-deferred"
        fun request(delayMillis: Long = 0): OneTimeWorkRequest = OneTimeWorkRequestBuilder<TransactionSyncWorker>()
            .setConstraints(Constraints.Builder().setRequiredNetworkType(NetworkType.CONNECTED).build())
            .setInitialDelay(delayMillis.coerceAtLeast(0), TimeUnit.MILLISECONDS)
            .setBackoffCriteria(BackoffPolicy.EXPONENTIAL, SyncPolicy.BASE_BACKOFF_MILLIS, TimeUnit.MILLISECONDS)
            .addTag(WORK_NAME).build()
    }
}
