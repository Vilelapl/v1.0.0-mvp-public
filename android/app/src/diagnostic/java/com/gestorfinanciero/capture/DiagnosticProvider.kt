package com.gestorfinanciero.capture

import android.Manifest
import android.content.ContentProvider
import android.content.ContentValues
import android.database.Cursor
import android.net.Uri
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import androidx.room.withTransaction
import com.gestorfinanciero.FinanceApplication
import com.gestorfinanciero.capture.parsers.ParseResult
import com.gestorfinanciero.capture.parsers.YapeNotificationParser
import com.gestorfinanciero.data.local.PendingTransactionEntity
import com.gestorfinanciero.data.local.SyncStatus
import com.gestorfinanciero.data.remote.DeviceTransactionSyncInput
import com.gestorfinanciero.data.remote.FinanceApiFactory
import com.gestorfinanciero.domain.NotificationSource
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.runBlocking
import java.time.Instant
import java.util.concurrent.CompletableFuture
import java.util.concurrent.TimeUnit
import org.json.JSONArray
import org.json.JSONObject

/** ADB-only opt-in diagnostics. Capture never writes files/logs or accesses the network. */
class DiagnosticProvider : ContentProvider() {
    override fun onCreate() = true

    override fun call(method: String, arg: String?, extras: Bundle?): Bundle {
        // ContentProvider.call does not enforce read/write permissions itself.
        requireNotNull(context).enforceCallingPermission(Manifest.permission.DUMP, "ADB diagnostic only")
        val result = try {
            when (method) {
                "packages" -> packages()
                "arm" -> JSONObject().put("status", NotificationDiagnostics.arm(requireNotNull(arg)))
                "take" -> NotificationDiagnostics.take()
                "stop" -> { NotificationDiagnostics.stop(); JSONObject().put("status", "DISABLED") }
                "queue" -> runBlocking(Dispatchers.IO) { queue() }
                "audit-yape" -> {
                    val future = CompletableFuture<List<CapturedNotification>?>()
                    Handler(Looper.getMainLooper()).post {
                        try { future.complete(NotificationDiagnostics.activeYapeForAudit()) }
                        catch (_: Exception) { future.complete(null) }
                    }
                    val notifications = future.get(5, TimeUnit.SECONDS)
                    if (notifications == null) JSONObject().put("status", "LISTENER_DISCONNECTED")
                    else runBlocking(Dispatchers.IO) {
                        val app = requireNotNull(context).applicationContext as FinanceApplication
                        app.database.withTransaction {
                            val results = JSONArray()
                            for (notification in notifications) {
                                val parsed = YapeNotificationParser().parse(notification)
                                val matches = matchingYapeRows(app, notification)
                                results.put(JSONObject().put("postTime", notification.postTime)
                                    .put("parserResult", if (parsed is ParseResult.Parsed) "PARSED" else "IGNORED")
                                    .put("matches", JSONArray(matches.map { row -> JSONObject()
                                        .put("clientTransactionId", row.clientTransactionId).put("status", row.syncStatus.value) })))
                            }
                            JSONObject().put("status", "AUDITED").put("notifications", results)
                        }
                    }
                }
                "configure-wallet-card" -> {
                    val parts = requireNotNull(arg).split(':')
                    require(parts.size == 2)
                    WalletCardRegistry(requireNotNull(context)).configure(parts[0], WalletCard.valueOf(parts[1]))
                    JSONObject().put("status", "CARD_MAPPING_SAVED")
                }
                "replay-synced" -> runBlocking(Dispatchers.IO) { replaySynced(requireNotNull(arg)) }
                "capture-active" -> {
                    val future = CompletableFuture<CapturedNotification?>()
                    Handler(Looper.getMainLooper()).post {
                        try { future.complete(NotificationDiagnostics.activeForCapture(requireNotNull(arg))) }
                        catch (_: Exception) { future.complete(null) }
                    }
                    val notification = future.get(5, TimeUnit.SECONDS)
                    if (notification == null) JSONObject().put("status", "NOT_AVAILABLE_OR_ALREADY_IMPORTED")
                    else runBlocking(Dispatchers.IO) {
                        val app = requireNotNull(context).applicationContext as FinanceApplication
                        app.database.withTransaction {
                            val existing = matchingYapeRows(app, notification)
                            if (existing.isNotEmpty()) JSONObject().put("status", "ALREADY_CAPTURED")
                                .put("clientTransactionIds", JSONArray(existing.map { it.clientTransactionId }))
                            else when (val captured = app.captureProcessor.capture(notification)) {
                                is CaptureResult.Persisted -> JSONObject().put("status", "PERSISTED").put("clientTransactionId", captured.clientTransactionId)
                                is CaptureResult.Ignored -> JSONObject().put("status", "IGNORED").put("reason", captured.reason.name)
                                is CaptureResult.Invalid -> JSONObject().put("status", "INVALID").put("field", captured.field.name)
                            }
                        }
                    }
                }
                "snapshot" -> {
                    val future = CompletableFuture<JSONObject>()
                    Handler(Looper.getMainLooper()).post {
                        try { future.complete(NotificationDiagnostics.snapshot()) }
                        catch (_: Exception) { future.complete(JSONObject().put("status", "CAPTURE_UNAVAILABLE")) }
                    }
                    future.get(5, TimeUnit.SECONDS)
                }
                else -> JSONObject().put("status", "UNKNOWN_METHOD")
            }
        } catch (error: Exception) {
            // Class name only, never exception message/stack or financial payload.
            JSONObject().put("status", "DIAGNOSTIC_UNAVAILABLE").put("failureKind", error.javaClass.simpleName)
        }
        return Bundle().apply { putString("result", result.toString()) }
    }

    /** Conservative guard for one-off Yape recovery, not general financial deduplication.
     * All comparisons stay on device; no amount, sender or security code is returned.
     * Matching the exact publication instant prevents merging later equal-value payments.
     */
    private suspend fun matchingYapeRows(app: FinanceApplication, notification: CapturedNotification): List<PendingTransactionEntity> {
        if (notification.packageName != FinancialSourceRegistry.YAPE_PACKAGE) return emptyList()
        val parsed = (YapeNotificationParser().parse(notification) as? ParseResult.Parsed)?.transaction ?: return emptyList()
        return SyncStatus.entries.flatMap { app.database.pendingTransactions().listByStatus(it) }.filter { row ->
            row.source == NotificationSource.YAPE && row.type == parsed.type && row.currency == parsed.currency &&
                Instant.parse(row.occurredAt) == Instant.ofEpochMilli(notification.postTime) &&
                row.amount.toBigDecimal().compareTo(parsed.amount.toBigDecimal()) == 0
        }
    }

    private suspend fun queue(): JSONObject {
        val app = requireNotNull(context).applicationContext as FinanceApplication
        val rows = JSONArray()
        val counts = JSONObject()
        var truncated = false
        for (status in SyncStatus.entries) {
            val matchingRows = app.database.pendingTransactions().listByStatus(status)
            counts.put(status.value, matchingRows.size)
            truncated = truncated || matchingRows.size > 100
            for (row in matchingRows.takeLast(100)) {
                rows.put(JSONObject().put("clientTransactionId", row.clientTransactionId)
                    .put("status", row.syncStatus.value).put("attempts", row.attempts)
                    .put("nextAttemptAt", row.nextAttemptAt ?: JSONObject.NULL)
                    .put("serverTransactionId", row.serverTransactionId ?: JSONObject.NULL)
                    .put("errorCode", row.lastErrorCode?.name ?: JSONObject.NULL))
            }
        }
        return JSONObject().put("pairingState", app.credentials.state().name)
            .put("counts", counts).put("truncated", truncated).put("rows", rows)
    }

    /** Explicit one-off idempotency check. Never reclassifies/requeues a synced row. */
    private suspend fun replaySynced(id: String): JSONObject {
        val app = requireNotNull(context).applicationContext as FinanceApplication
        val row = requireNotNull(app.database.pendingTransactions().getById(id))
        require(row.syncStatus == SyncStatus.SYNCED)
        val credential = requireNotNull(app.credentials.current())
        val response = FinanceApiFactory().create(credential.baseUrl, credential).sync(DeviceTransactionSyncInput.from(row))
        response.errorBody()?.close()
        return JSONObject().put("httpStatus", response.code())
            .put("syncResult", response.body()?.data?.syncResult ?: JSONObject.NULL)
            .put("clientTransactionId", response.body()?.data?.clientTransactionId ?: JSONObject.NULL)
            .put("transactionId", response.body()?.data?.transactionId ?: JSONObject.NULL)
    }

    @Suppress("DEPRECATION")
    private fun packages(): JSONObject {
        val manager = requireNotNull(context).packageManager
        val packages = JSONArray()
        for (name in FinancialSourceRegistry.verifiedPackages.keys) {
            val info = manager.getPackageInfo(name, 0)
            packages.put(JSONObject().put("packageName", name)
                .put("label", info.applicationInfo?.loadLabel(manager)?.toString())
                .put("versionName", info.versionName))
        }
        return JSONObject().put("packages", packages)
    }

    override fun query(uri: Uri, projection: Array<out String>?, selection: String?, selectionArgs: Array<out String>?, sortOrder: String?): Cursor? = null
    override fun getType(uri: Uri): String? = null
    override fun insert(uri: Uri, values: ContentValues?): Uri? = null
    override fun delete(uri: Uri, selection: String?, selectionArgs: Array<out String>?): Int = 0
    override fun update(uri: Uri, values: ContentValues?, selection: String?, selectionArgs: Array<out String>?): Int = 0
}
