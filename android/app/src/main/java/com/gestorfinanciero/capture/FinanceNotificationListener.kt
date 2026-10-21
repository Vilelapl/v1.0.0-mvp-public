package com.gestorfinanciero.capture

import android.app.Notification
import android.service.notification.NotificationListenerService
import android.service.notification.StatusBarNotification
import android.util.Log
import com.gestorfinanciero.FinanceApplication
import kotlinx.coroutines.CoroutineExceptionHandler
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.launch

class FinanceNotificationListener : NotificationListenerService() {
    private val serviceScope = CoroutineScope(
        SupervisorJob() + Dispatchers.IO + CoroutineExceptionHandler { _, _ ->
            // Do not include exception messages/stack traces: a parser or SQLite
            // exception could contain notification text or financial parameters.
            Log.e("FinanceCapture", "LOCAL_CAPTURE_FAILED")
        },
    )

    override fun onListenerConnected() {
        super.onListenerConnected()
        NotificationDiagnostics.connected(this)
    }

    override fun onListenerDisconnected() {
        NotificationDiagnostics.disconnected()
        super.onListenerDisconnected()
    }

    override fun onNotificationPosted(sbn: StatusBarNotification?) {
        if (sbn == null) return
        val app = application as FinanceApplication
        if (app.sources.sourceFor(sbn.packageName) == null) return
        val extras = sbn.notification.extras
        val captured = CapturedNotification(
            packageName = sbn.packageName,
            title = extras.getCharSequence(Notification.EXTRA_TITLE)?.toString(),
            text = (extras.getCharSequence(Notification.EXTRA_BIG_TEXT)
                ?: extras.getCharSequence(Notification.EXTRA_TEXT))?.toString(),
            postTime = sbn.postTime,
            notificationKey = sbn.key,
        )
        NotificationDiagnostics.posted(captured)
        // No retained Android notification object, network, polling or main-thread DB work.
        serviceScope.launch { app.captureProcessor.capture(captured) }
    }

    override fun onDestroy() {
        NotificationDiagnostics.disconnected()
        serviceScope.cancel()
        super.onDestroy()
    }
}
