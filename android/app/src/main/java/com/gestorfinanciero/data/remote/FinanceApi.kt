package com.gestorfinanciero.data.remote

import com.gestorfinanciero.data.local.PendingTransactionEntity
import retrofit2.Response
import retrofit2.http.Body
import retrofit2.http.POST

class PairRequest(val code: String, val deviceName: String)
class PairData(val deviceId: String?, val deviceToken: String?)
class PairResponse(val data: PairData?)
data class SyncData(val transactionId: String?, val clientTransactionId: String?, val syncResult: String?)
data class SyncResponse(val data: SyncData?)

data class DeviceTransactionSyncInput(
    val clientTransactionId: String, val amount: String, val currency: String?,
    val occurredAt: String, val description: String?, val type: String,
    val account: String?, val source: String,
) {
    companion object {
        fun from(row: PendingTransactionEntity) = DeviceTransactionSyncInput(
            row.clientTransactionId, row.amount, row.currency, row.occurredAt,
            row.description, row.type.value, row.account, row.source.value,
        )
    }
}

interface FinanceApi {
    @POST("api/v1/devices/pair")
    suspend fun pair(@Body input: PairRequest): Response<PairResponse>

    @POST("api/v1/device/transactions/sync")
    suspend fun sync(@Body input: DeviceTransactionSyncInput): Response<SyncResponse>
}
