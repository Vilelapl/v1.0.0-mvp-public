package com.gestorfinanciero.data.local

import com.gestorfinanciero.domain.CapturedTransaction
import java.time.Clock

class PendingTransactionRepository(
    private val dao: PendingTransactionDao,
    private val clock: Clock = Clock.systemUTC(),
    private val onPersisted: suspend () -> Unit = {},
) {
    suspend fun persist(transaction: CapturedTransaction): PendingTransactionEntity {
        val entity = PendingTransactionEntity.pending(transaction, clock.millis())
        dao.insertPending(entity)
        onPersisted()
        return entity
    }
}
