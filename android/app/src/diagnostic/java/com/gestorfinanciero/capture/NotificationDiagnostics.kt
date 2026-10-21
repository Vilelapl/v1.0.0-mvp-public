package com.gestorfinanciero.capture

import android.app.Notification
import android.os.SystemClock
import android.service.notification.NotificationListenerService
import java.lang.ref.WeakReference
import org.json.JSONArray
import org.json.JSONObject

/** Only compiled with -PcaptureDiagnostics=true in debug. Never retains raw text. */
object NotificationDiagnostics {
    private var listener = WeakReference<NotificationListenerService>(null)
    private var expiresAt = 0L
    private var selectedPackage: String? = null
    private val samples = ArrayDeque<JSONObject>()
    private val capturedActive = mutableSetOf<String>()

    /** Explicit development-only import, once per active notification/process. */
    @Synchronized fun activeForCapture(selector: String): CapturedNotification? {
        val service = listener.get() ?: return null
        if (selector in capturedActive) return null
        val sbn = service.activeNotifications.orEmpty().firstOrNull {
            it.packageName in FinancialSourceRegistry.verifiedPackages && "${it.packageName}:${it.postTime}" == selector
        } ?: return null
        val extras = sbn.notification.extras
        capturedActive.add(selector)
        return CapturedNotification(sbn.packageName,
            extras.getCharSequence(Notification.EXTRA_TITLE)?.toString(),
            (extras.getCharSequence(Notification.EXTRA_BIG_TEXT) ?: extras.getCharSequence(Notification.EXTRA_TEXT))?.toString(),
            sbn.postTime, sbn.key)
    }

    @Synchronized fun connected(service: NotificationListenerService) { listener = WeakReference(service) }
    @Synchronized fun disconnected() { listener.clear(); stop() }

    /** Main-thread, explicit audit only. Raw objects are ephemeral and never buffered. */
    @Synchronized fun activeYapeForAudit(): List<CapturedNotification>? {
        val service = listener.get() ?: return null
        return service.activeNotifications.orEmpty().filter { it.packageName == FinancialSourceRegistry.YAPE_PACKAGE }.map { sbn ->
            val extras = sbn.notification.extras
            CapturedNotification(sbn.packageName,
                extras.getCharSequence(Notification.EXTRA_TITLE)?.toString(),
                (extras.getCharSequence(Notification.EXTRA_BIG_TEXT) ?: extras.getCharSequence(Notification.EXTRA_TEXT))?.toString(),
                sbn.postTime, sbn.key)
        }
    }

    @Synchronized fun arm(packageName: String): String {
        require(packageName in FinancialSourceRegistry.verifiedPackages)
        samples.clear()
        selectedPackage = packageName
        expiresAt = SystemClock.elapsedRealtime() + 10 * 60_000L
        return if (listener.get() == null) "LISTENER_DISCONNECTED" else "ARMED_10_MINUTES"
    }

    @Synchronized fun stop() {
        selectedPackage = null
        expiresAt = 0
        samples.clear()
    }

    @Synchronized fun posted(notification: CapturedNotification) {
        if (SystemClock.elapsedRealtime() >= expiresAt) { stop(); return }
        if (notification.packageName != selectedPackage) return
        if (samples.size >= 10) samples.removeFirst()
        samples.addLast(sanitize(notification, "onNotificationPosted"))
    }

    @Synchronized fun take(): JSONObject {
        if (SystemClock.elapsedRealtime() >= expiresAt) stop()
        val result = JSONObject().put("samples", JSONArray(samples.toList()))
            .put("armed", selectedPackage != null).put("listenerConnected", listener.get() != null)
        samples.clear()
        return result
    }

    /** Called on the main thread, only after the system connected this listener. */
    @Synchronized fun snapshot(): JSONObject {
        val service = listener.get() ?: return JSONObject().put("status", "LISTENER_DISCONNECTED")
        val samples = JSONArray()
        for (sbn in service.activeNotifications.orEmpty()) {
            if (sbn.packageName !in FinancialSourceRegistry.verifiedPackages) continue
            val extras = sbn.notification.extras
            val captured = CapturedNotification(
                sbn.packageName,
                extras.getCharSequence(Notification.EXTRA_TITLE)?.toString(),
                (extras.getCharSequence(Notification.EXTRA_BIG_TEXT)
                    ?: extras.getCharSequence(Notification.EXTRA_TEXT))?.toString(),
                sbn.postTime,
                "diagnostic-only",
            )
            samples.put(sanitize(captured, "getActiveNotifications"))
            if (samples.length() == 10) break
        }
        return JSONObject().put("status", "CONNECTED").put("samples", samples)
    }

    private fun sanitize(captured: CapturedNotification, origin: String) = JSONObject()
        .put("packageName", captured.packageName)
        .put("title", DiagnosticRedactor.redact(captured.title) ?: JSONObject.NULL)
        .put("text", DiagnosticRedactor.redact(captured.text) ?: JSONObject.NULL)
        .put("postTime", captured.postTime)
        .put("observedVia", origin)
        .put("ioCardSuffixShape", ioCardSuffixShape(captured) ?: JSONObject.NULL)
        .put("walletCard", walletCard(captured)?.name ?: JSONObject.NULL)
        .put("redaction", "discovery_allowlist_v1; amounts replaced; private words and numbers removed")

    /** Discover only character classes, never the card identifier itself. */
    private fun ioCardSuffixShape(captured: CapturedNotification): String? {
        if (captured.packageName != FinancialSourceRegistry.IO_PACKAGE) return null
        val text = captured.text ?: return null
        if (!text.startsWith("Realizaste una compra con tu Tarjeta iO ")) return null
        val suffix = text.removePrefix("Realizaste una compra con tu Tarjeta iO ").substringBefore(" por S/", "")
        if (suffix.length !in 1..32) return null
        return suffix.map { when {
            it.isDigit() -> '1'
            it.isLetter() -> 'x'
            it.isWhitespace() -> ' '
            else -> it
        } }.joinToString("")
    }

    private fun walletCard(captured: CapturedNotification): WalletCard? {
        if (captured.packageName != FinancialSourceRegistry.GOOGLE_WALLET_PACKAGE) return null
        val alias = captured.text?.substringAfter(" with ", "")?.takeIf { it.isNotBlank() } ?: return null
        val context = listener.get() ?: return null
        return WalletCardRegistry(context).resolve(alias)
    }
}
