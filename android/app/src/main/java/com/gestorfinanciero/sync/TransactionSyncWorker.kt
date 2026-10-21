package com.gestorfinanciero.sync

import android.content.Context
import androidx.work.CoroutineWorker
import androidx.work.WorkerParameters
import com.gestorfinanciero.FinanceApplication
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext

class TransactionSyncWorker @JvmOverloads constructor(
    context: Context,
    parameters: WorkerParameters,
    private val suppliedEngine: SyncEngine? = null,
) : CoroutineWorker(context, parameters) {
    override suspend fun doWork(): Result = withContext(Dispatchers.IO) {
        try {
            val engine = suppliedEngine ?: (applicationContext as FinanceApplication).syncEngine
            engine.run(runAttemptCount)
            // The engine schedules its one deferred wake-up. Returning retry
            // here would block fresh captures behind this immediate work chain.
            Result.success()
        } catch (error: CancellationException) { throw error }
        // The engine already tried to persist a separate deferred wake-up.
        // If that also failed, retain WorkManager's existing durable request
        // rather than abandon the queue or fail already-enqueued successors.
        catch (_: Exception) { Result.retry() } // No sensitive exception text in logs/data.
    }
}
