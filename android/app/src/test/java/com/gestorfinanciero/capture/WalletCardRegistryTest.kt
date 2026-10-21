package com.gestorfinanciero.capture

import android.content.Context
import androidx.test.core.app.ApplicationProvider
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [35])
class WalletCardRegistryTest {
    @Test fun `owner mapping survives reopening without storing alias and requires exact match`() {
        val context = ApplicationProvider.getApplicationContext<Context>()
        val alias = "ANON_CARD_CREDIT"
        val registry = WalletCardRegistry(context)
        registry.configure(WalletCardRegistry.fingerprint(alias), WalletCard.IO_CREDIT)
        val reopened = WalletCardRegistry(context)
        assertEquals(WalletCard.IO_CREDIT, reopened.resolve(alias))
        assertNull(reopened.resolve("$alias "))
        assertNull(reopened.resolve(alias.lowercase()))
        assertNull(reopened.resolve("OTHER_CARD_CREDIT"))
        assertFalse(context.getSharedPreferences("wallet-card-mapping", Context.MODE_PRIVATE).all.toString().contains(alias))
    }
}
