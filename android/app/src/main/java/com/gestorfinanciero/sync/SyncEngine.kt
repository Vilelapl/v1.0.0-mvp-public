package com.gestorfinanciero.sync

import com.gestorfinanciero.auth.CredentialStore
import com.gestorfinanciero.auth.DeviceCredential
import com.gestorfinanciero.auth.isCanonicalUuid
import com.gestorfinanciero.data.local.LocalErrorCode
import com.gestorfinanciero.data.local.PendingTransactionDao
import com.gestorfinanciero.data.local.PendingTransactionEntity
import com.gestorfinanciero.data.remote.DeviceTransactionSyncInput
import com.gestorfinanciero.data.remote.FinanceApi
import com.gestorfinanciero.data.remote.FinanceApiFactory
import java.io.IOException
import java.io.InterruptedIOException
import java.time.Clock
import java.time.ZonedDateTime
import java.time.format.DateTimeFormatter
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.NonCancellable
import kotlinx.coroutines.currentCoroutineContext
import kotlinx.coroutines.ensureActive
import kotlinx.coroutines.withContext
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock

enum class SyncRunResult { COMPLETE, RETRY_SCHEDULED }

class SyncEngine(
    private val dao: PendingTransactionDao,
    private val credentials: CredentialStore,
    private val apiFactory: FinanceApiFactory,
    private val scheduleAfter: suspend (Long) -> Unit,
    private val clock: Clock = Clock.systemUTC(),
    private val cancelDeferred: suspend () -> Unit = {},
) {
    private val execution = Mutex()

    suspend fun run(runAttemptCount: Int): SyncRunResult = execution.withLock {
        try { runOnce(runAttemptCount) }
        catch (error: CancellationException) { throw error }
        catch (_: Exception) {
            // Even an unexpected local failure must not put the ready chain in
            // WorkManager backoff. A later run recovers any interrupted claims.
            scheduleAfter(SyncPolicy.BASE_BACKOFF_MILLIS)
            SyncRunResult.RETRY_SCHEDULED
        }
    }

    private suspend fun runOnce(runAttemptCount: Int): SyncRunResult {
        val started = clock.millis()
        dao.recoverAbandonedSyncing(started - SyncPolicy.STALE_AFTER_MILLIS, started)
        val credential = credentials.current() ?: run { cancelDeferred(); return SyncRunResult.COMPLETE }
        val batch = dao.claimEligible(started, SyncPolicy.BATCH_SIZE)
        // Deferred requests are replaced to keep a single earliest wake-up.
        // Persisted attempts preserve exponential backoff across replacements.
        val attempt = maxOf(runAttemptCount, batch.maxOfOrNull { it.attempts - 1 } ?: 0)
        val delay = SyncPolicy.backoffMillis(attempt)
        var needsRetry = false
        try {
            if (batch.isNotEmpty()) {
                val api = apiFactory.create(credential.baseUrl, credential)
                for (row in batch) {
                    currentCoroutineContext().ensureActive()
                    if (!stillCurrent(credential)) {
                        release(batch, LocalErrorCode.AUTH_REQUIRED, clock.millis())
                        break
                    }
                    when (val response = send(api, row)) {
                        is SendResult.Synced -> dao.markSynced(row.clientTransactionId, row.attempts, response.serverId, clock.millis())
                        is SendResult.Failed -> dao.markFailed(row.clientTransactionId, row.attempts, response.code, clock.millis())
                        is SendResult.Retry -> {
                            val now = clock.millis()
                            // A temporary outage/rate limit affects the batch: do
                            // not spend battery repeating calls for unsent claims.
                            release(batch, response.code, now, maxOf(now + delay, response.notBefore ?: now))
                            needsRetry = true
                            break
                        }
                        SendResult.AuthRequired -> {
                            credentials.invalidateIfCurrent(credential)
                            release(batch, LocalErrorCode.AUTH_REQUIRED, clock.millis())
                            break
                        }
                    }
                }
            }
        } finally {
            // OS cancellation, constraint loss and re-pairing release only this
            // attempt's remaining claims. Completed or newer attempts are immune.
            withContext(NonCancellable) { release(batch, LocalErrorCode.INTERRUPTED, clock.millis()) }
        }
        return finish(needsRetry)
    }

    private fun stillCurrent(expected: DeviceCredential): Boolean {
        val active = credentials.current() ?: return false
        return active.baseUrl == expected.baseUrl && active.deviceId == expected.deviceId && active.token == expected.token
    }

    private suspend fun release(batch: List<PendingTransactionEntity>, code: LocalErrorCode, now: Long, notBefore: Long = now) {
        for (row in batch) dao.markRetry(row.clientTransactionId, row.attempts, code, notBefore, now)
    }

    private suspend fun finish(needsRetry: Boolean): SyncRunResult {
        if (credentials.current() == null) { cancelDeferred(); return SyncRunResult.COMPLETE }
        val now = clock.millis()
        val next = dao.nextWakeAt(now, SyncPolicy.STALE_AFTER_MILLIS)
            ?: run { cancelDeferred(); return SyncRunResult.COMPLETE }
        // No HTTP call or owned claim remains here. Replacing the deferred work
        // cannot interrupt another run: all workers share this engine's mutex.
        scheduleAfter((next - now).coerceAtLeast(0))
        return if (needsRetry) SyncRunResult.RETRY_SCHEDULED else SyncRunResult.COMPLETE
    }

    private suspend fun send(api: FinanceApi, row: PendingTransactionEntity): SendResult {
        try {
            val response = api.sync(DeviceTransactionSyncInput.from(row))
            currentCoroutineContext().ensureActive()
            if (response.isSuccessful) {
                val data = response.body()?.data
                val expectedStatus = when (data?.syncResult) { "created" -> 201; "already_exists" -> 200; else -> null }
                return if (response.code() == expectedStatus && data != null && data.clientTransactionId == row.clientTransactionId && isCanonicalUuid(data.transactionId)) {
                    SendResult.Synced(requireNotNull(data.transactionId))
                } else SendResult.Retry(LocalErrorCode.INVALID_RESPONSE)
            }
            response.errorBody()?.close() // Never parse/persist/log a financial error body.
            return when (response.code()) {
                401 -> SendResult.AuthRequired
                400, 422 -> SendResult.Failed(LocalErrorCode.INVALID_CAPTURE)
                408 -> SendResult.Retry(LocalErrorCode.TIMEOUT)
                429 -> SendResult.Retry(LocalErrorCode.RATE_LIMITED, retryAfter(response.headers()["Retry-After"]))
                in 500..599 -> SendResult.Retry(LocalErrorCode.SERVER_ERROR, retryAfter(response.headers()["Retry-After"]))
                else -> SendResult.Failed(LocalErrorCode.HTTP_CLIENT_ERROR)
            }
        } catch (error: CancellationException) { throw error }
        catch (_: InterruptedIOException) { return SendResult.Retry(LocalErrorCode.TIMEOUT) }
        catch (_: IOException) { return SendResult.Retry(LocalErrorCode.NETWORK_ERROR) }
        catch (_: Exception) { return SendResult.Retry(LocalErrorCode.INVALID_RESPONSE) }
    }

    private fun retryAfter(header: String?): Long? {
        if (header == null) return null
        val seconds = header.toLongOrNull()
        if (seconds != null) {
            val now = clock.millis()
            return if (seconds in 0..((Long.MAX_VALUE - now) / 1_000)) now + seconds * 1_000 else null
        }
        return try { ZonedDateTime.parse(header, DateTimeFormatter.RFC_1123_DATE_TIME).toInstant().toEpochMilli() }
        catch (_: Exception) { null }
    }

    private sealed interface SendResult {
        data class Synced(val serverId: String) : SendResult
        data class Failed(val code: LocalErrorCode) : SendResult
        data class Retry(val code: LocalErrorCode, val notBefore: Long? = null) : SendResult
        data object AuthRequired : SendResult
    }
}
