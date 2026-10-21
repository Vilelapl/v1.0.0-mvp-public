package com.gestorfinanciero.sync

import com.gestorfinanciero.auth.CredentialStore
import com.gestorfinanciero.auth.DeviceCredential
import com.gestorfinanciero.auth.PairingState

/** Fake credentials used only in HTTP/Room tests, never financial parser evidence. */
class TestCredentialStore(private var credential: DeviceCredential?) : CredentialStore {
    private var repair = false
    private var url = credential?.baseUrl.orEmpty()
    @Synchronized override fun current() = credential
    @Synchronized override fun save(credential: DeviceCredential) { this.credential = credential; url = credential.baseUrl; repair = false }
    @Synchronized override fun invalidateIfCurrent(credential: DeviceCredential): Boolean {
        if (this.credential !== credential) return false
        this.credential = null
        repair = true
        return true
    }
    @Synchronized override fun state() = when { credential != null -> PairingState.PAIRED; repair -> PairingState.REPAIR_REQUIRED; else -> PairingState.UNPAIRED }
    override fun lastBaseUrl() = url
}
