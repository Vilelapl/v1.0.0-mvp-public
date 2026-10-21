package com.gestorfinanciero.capture

import com.gestorfinanciero.domain.NotificationSource

class FinancialSourceRegistry(packages: Map<String, NotificationSource>) {
    private val packages = packages.toMap()

    init {
        require(packages.keys.all { it.isNotBlank() && it == it.trim() })
    }

    fun sourceFor(packageName: String): NotificationSource? = packages[packageName]

    companion object {
        // Supported package identifiers. Parser registration remains separate
        // and is checked with redacted, synthetic-time fixtures.
        const val IO_PACKAGE = "pe.io"
        const val YAPE_PACKAGE = "com.bcp.innovacxion.yapeapp"
        const val GOOGLE_WALLET_PACKAGE = "com.google.android.apps.walletnfcrel"
        val verifiedPackages: Map<String, NotificationSource> = mapOf(
            IO_PACKAGE to NotificationSource.IO,
            YAPE_PACKAGE to NotificationSource.YAPE,
            GOOGLE_WALLET_PACKAGE to NotificationSource.GOOGLE_WALLET,
        )

        fun production() = FinancialSourceRegistry(verifiedPackages)
    }
}
