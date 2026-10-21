package com.gestorfinanciero.capture

import android.service.notification.NotificationListenerService

/** Normal debug/release builds have no diagnostic provider or capture buffer. */
@Suppress("UNUSED_PARAMETER")
object NotificationDiagnostics {
    fun connected(listener: NotificationListenerService) = Unit
    fun disconnected() = Unit
    fun posted(notification: CapturedNotification) = Unit
}
