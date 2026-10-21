package com.gestorfinanciero.sync

object SyncPolicy {
    const val BATCH_SIZE = 10
    const val BASE_BACKOFF_MILLIS = 60_000L
    const val MAX_BACKOFF_MILLIS = 5 * 60 * 60_000L
    // A batch has at most 10 HTTP calls of at most 20 seconds each.
    const val STALE_AFTER_MILLIS = 15 * 60_000L

    fun backoffMillis(runAttemptCount: Int): Long =
        (BASE_BACKOFF_MILLIS * (1L shl runAttemptCount.coerceIn(0, 9))).coerceAtMost(MAX_BACKOFF_MILLIS)
}
