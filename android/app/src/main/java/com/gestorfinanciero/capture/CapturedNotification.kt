package com.gestorfinanciero.capture

/** Ephemeral input only. Never stored in Room or written to logs. */
data class CapturedNotification(
    val packageName: String,
    val title: String?,
    val text: String?,
    val postTime: Long,
    val notificationKey: String?,
)
