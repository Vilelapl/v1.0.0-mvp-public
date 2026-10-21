package com.gestorfinanciero.auth

/** Deliberately not a data class: toString must never include a token. */
class DeviceCredential(val baseUrl: String, val deviceId: String, internal val token: String) {
    override fun toString() = "DeviceCredential([REDACTED])"
}

enum class PairingState { UNPAIRED, PAIRED, REPAIR_REQUIRED }

interface CredentialStore {
    fun current(): DeviceCredential?
    fun save(credential: DeviceCredential)
    fun invalidateIfCurrent(credential: DeviceCredential): Boolean
    fun state(): PairingState
    fun lastBaseUrl(): String
}
