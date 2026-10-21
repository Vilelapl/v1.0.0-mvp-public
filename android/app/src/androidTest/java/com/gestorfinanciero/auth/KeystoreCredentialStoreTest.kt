package com.gestorfinanciero.auth

import android.content.Context
import android.content.ContextWrapper
import android.content.SharedPreferences
import androidx.test.core.app.ApplicationProvider
import androidx.test.ext.junit.runners.AndroidJUnit4
import java.io.File
import java.security.KeyStore
import java.util.UUID
import org.junit.After
import org.junit.Assert.*
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith

/** Real Keystore tests use isolated files/preferences/alias, never the paired token. */
@RunWith(AndroidJUnit4::class)
class KeystoreCredentialStoreTest {
    private val alias = "gestor-financiero.test." + UUID.randomUUID()
    private lateinit var isolated: Context
    private lateinit var directory: File

    @Before fun setup() {
        val context = ApplicationProvider.getApplicationContext<Context>()
        directory = File(context.cacheDir, alias).apply { check(mkdirs()) }
        isolated = object : ContextWrapper(context) {
            override fun getNoBackupFilesDir(): File = directory
            override fun getSharedPreferences(name: String, mode: Int): SharedPreferences = super.getSharedPreferences(alias, mode)
        }
    }

    @After fun cleanup() {
        directory.listFiles().orEmpty().forEach { it.delete() }
        directory.delete()
        isolated.getSharedPreferences(alias, Context.MODE_PRIVATE).edit().clear().commit()
        KeyStore.getInstance("AndroidKeyStore").apply { load(null); deleteEntry(alias) }
    }

    @Test fun credentialIsEncryptedSurvivesReopenAndInvalidatesWithoutPlaintextPreferences() {
        val credential = DeviceCredential("https://example.test/", UUID.randomUUID().toString(), "t".repeat(43))
        val store = KeystoreCredentialStore(isolated, alias)
        store.save(credential)
        val ciphertext = File(directory, "device-credential.aesgcm").readBytes()
        assertFalse(ciphertext.toString(Charsets.UTF_8).contains(credential.token))
        assertFalse(isolated.getSharedPreferences(alias, Context.MODE_PRIVATE).all.toString().contains(credential.token))
        val reopened = KeystoreCredentialStore(isolated, alias)
        val restored = requireNotNull(reopened.current())
        assertEquals(credential.token, restored.token)
        assertEquals(credential.deviceId, restored.deviceId)
        assertEquals(PairingState.PAIRED, reopened.state())
        assertTrue(reopened.invalidateIfCurrent(restored))
        assertNull(reopened.current())
        assertEquals(PairingState.REPAIR_REQUIRED, KeystoreCredentialStore(isolated, alias).state())
    }

    @Test fun oldCredentialCannotInvalidateNewPairingAndTamperedCiphertextRequiresPairing() {
        val old = DeviceCredential("https://example.test/", UUID.randomUUID().toString(), "a".repeat(43))
        val fresh = DeviceCredential("https://example.test/", UUID.randomUUID().toString(), "b".repeat(43))
        val store = KeystoreCredentialStore(isolated, alias)
        store.save(old)
        store.save(fresh)
        assertFalse(store.invalidateIfCurrent(old))
        assertSame(fresh, store.current())
        val file = File(directory, "device-credential.aesgcm")
        val bytes = file.readBytes()
        bytes[bytes.lastIndex] = (bytes.last().toInt() xor 1).toByte()
        file.writeBytes(bytes)
        val reopened = KeystoreCredentialStore(isolated, alias)
        assertNull(reopened.current())
        assertEquals(PairingState.REPAIR_REQUIRED, reopened.state())
    }
}
