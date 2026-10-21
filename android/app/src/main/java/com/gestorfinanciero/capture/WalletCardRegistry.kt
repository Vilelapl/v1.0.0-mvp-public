package com.gestorfinanciero.capture

import android.content.Context
import java.security.MessageDigest

enum class WalletCard(val account: String) {
    IO_CREDIT("IO crédito"), BCP_DEBIT("BCP débito")
}

/** Explicit owner configuration. Neither card aliases nor card numbers are stored. */
class WalletCardRegistry(context: Context) {
    private val preferences = context.getSharedPreferences("wallet-card-mapping", Context.MODE_PRIVATE)

    fun resolve(alias: String): WalletCard? = preferences.getString(fingerprint(alias), null)
        ?.let { stored -> WalletCard.entries.firstOrNull { it.name == stored } }

    fun configure(fingerprint: String, card: WalletCard) {
        require(Regex("[0-9a-f]{64}").matches(fingerprint))
        check(preferences.edit().putString(fingerprint, card.name).commit())
    }

    companion object {
        // A hash here is an exact-match key, not encryption or a credential.
        // Case and whitespace remain significant: no inferred account aliases.
        fun fingerprint(alias: String): String = MessageDigest.getInstance("SHA-256")
            .digest(alias.toByteArray(Charsets.UTF_8)).joinToString("") { "%02x".format(it) }
    }
}
