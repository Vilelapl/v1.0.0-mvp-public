package com.gestorfinanciero.auth

import android.content.Context
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import android.util.AtomicFile
import java.io.File
import java.security.KeyStore
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec
import org.json.JSONObject

/** Called on IO threads. Only ciphertext is written; the AES key stays in Keystore. */
class KeystoreCredentialStore(context: Context, private val keyAlias: String = "gestor-financiero.device.v1") : CredentialStore {
    private val file = AtomicFile(File(context.noBackupFilesDir, "device-credential.aesgcm"))
    private val preferences = context.getSharedPreferences("device-connection", Context.MODE_PRIVATE)
    private var loaded = false
    private var cached: DeviceCredential? = null

    @Synchronized override fun current(): DeviceCredential? {
        if (loaded) return cached
        loaded = true
        if (!file.baseFile.exists()) return null
        try {
            val encrypted = file.readFully()
            require(encrypted.size in 29..8_192 && encrypted[0] == 1.toByte())
            val cipher = Cipher.getInstance("AES/GCM/NoPadding")
            cipher.init(Cipher.DECRYPT_MODE, key(create = false), GCMParameterSpec(128, encrypted.copyOfRange(1, 13)))
            cipher.updateAAD(AAD)
            val plaintext = cipher.doFinal(encrypted.copyOfRange(13, encrypted.size))
            try {
                val json = JSONObject(plaintext.toString(Charsets.UTF_8))
                cached = DeviceCredential(json.getString("baseUrl"), json.getString("deviceId"), json.getString("token"))
            } finally { plaintext.fill(0) }
        } catch (_: Exception) {
            // Lost/invalid key, restored file or tampered ciphertext: request a new
            // credential without logging the exception or touching the Room queue.
            file.delete()
            preferences.edit().putBoolean("repairRequired", true).commit()
        }
        return cached
    }

    @Synchronized override fun save(credential: DeviceCredential) {
        val plaintext = JSONObject().put("baseUrl", credential.baseUrl)
            .put("deviceId", credential.deviceId).put("token", credential.token)
            .toString().toByteArray(Charsets.UTF_8)
        val encrypted = try {
            val cipher = Cipher.getInstance("AES/GCM/NoPadding")
            cipher.init(Cipher.ENCRYPT_MODE, key(create = true))
            cipher.updateAAD(AAD)
            byteArrayOf(1) + cipher.iv + cipher.doFinal(plaintext)
        } finally { plaintext.fill(0) }
        val stream = file.startWrite()
        try { stream.write(encrypted); file.finishWrite(stream) }
        catch (error: Exception) { file.failWrite(stream); throw error }
        cached = credential
        loaded = true
        check(preferences.edit().putString("baseUrl", credential.baseUrl)
            .putBoolean("repairRequired", false).commit())
    }

    @Synchronized override fun invalidateIfCurrent(credential: DeviceCredential): Boolean {
        // A late 401 from an old worker must not delete a freshly paired token.
        val active = current() ?: return false
        if (active.baseUrl != credential.baseUrl || active.deviceId != credential.deviceId || active.token != credential.token) return false
        file.delete()
        cached = null
        check(preferences.edit().putBoolean("repairRequired", true).commit())
        return true
    }

    @Synchronized override fun state(): PairingState = when {
        current() != null -> PairingState.PAIRED
        preferences.getBoolean("repairRequired", false) -> PairingState.REPAIR_REQUIRED
        else -> PairingState.UNPAIRED
    }

    override fun lastBaseUrl(): String = preferences.getString("baseUrl", "").orEmpty()

    private fun key(create: Boolean): SecretKey {
        val store = KeyStore.getInstance("AndroidKeyStore").apply { load(null) }
        (store.getKey(keyAlias, null) as? SecretKey)?.let { return it }
        check(create) { "DEVICE_KEY_UNAVAILABLE" }
        return KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore").apply {
            init(KeyGenParameterSpec.Builder(keyAlias, KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT)
                .setKeySize(256).setBlockModes(KeyProperties.BLOCK_MODE_GCM)
                .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
                .setRandomizedEncryptionRequired(true).build())
        }.generateKey()
    }

    private companion object {
        val AAD = "gestor-financiero/device-credential/v1".toByteArray(Charsets.UTF_8)
    }
}
