package com.gestorfinanciero.capture

import com.gestorfinanciero.capture.parsers.IgnoreReason
import com.gestorfinanciero.data.local.PendingTransactionRepository
import com.gestorfinanciero.domain.InvalidField
import com.gestorfinanciero.domain.NormalizationResult
import com.gestorfinanciero.domain.TransactionNormalizer

sealed interface CaptureResult {
    data class Persisted(val clientTransactionId: String) : CaptureResult
    data class Ignored(val reason: IgnoreReason) : CaptureResult
    data class Invalid(val field: InvalidField) : CaptureResult
}

class NotificationCaptureProcessor(
    private val router: NotificationRouter,
    private val normalizer: TransactionNormalizer,
    private val repository: PendingTransactionRepository,
) {
    suspend fun capture(notification: CapturedNotification): CaptureResult {
        return when (val routed = router.route(notification)) {
            is RouteResult.Ignored -> CaptureResult.Ignored(routed.reason)
            is RouteResult.Parsed -> when (val normalized = normalizer.normalize(routed.transaction, routed.source)) {
                is NormalizationResult.Invalid -> CaptureResult.Invalid(normalized.field)
                is NormalizationResult.Valid -> {
                    val saved = repository.persist(normalized.transaction)
                    CaptureResult.Persisted(saved.clientTransactionId)
                }
            }
        }
    }
}
