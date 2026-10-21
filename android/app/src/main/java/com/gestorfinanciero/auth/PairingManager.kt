package com.gestorfinanciero.auth

import com.gestorfinanciero.data.remote.BackendUrl
import com.gestorfinanciero.data.remote.FinanceApiFactory
import com.gestorfinanciero.data.remote.PairRequest
import java.io.IOException
import java.util.UUID
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext

enum class PairingResult { PAIRED, INVALID_INPUT, INVALID_CODE, RATE_LIMITED, SERVER_UNAVAILABLE, INVALID_RESPONSE, SECURE_STORAGE_UNAVAILABLE }

class PairingManager(
    private val credentials: CredentialStore,
    private val apiFactory: FinanceApiFactory,
    private val allowDevelopmentHttp: Boolean,
    private val onPaired: suspend () -> Unit,
) {
    suspend fun pair(urlInput: String, codeInput: String, nameInput: String): PairingResult = withContext(Dispatchers.IO) {
        val url = BackendUrl.normalize(urlInput, allowDevelopmentHttp) ?: return@withContext PairingResult.INVALID_INPUT
        val code = codeInput.trim().uppercase(java.util.Locale.ROOT).replace("-", "")
        val name = nameInput.trim()
        if (!Regex("[A-HJ-NP-Z2-9]{10}").matches(code) || name.length !in 1..100) return@withContext PairingResult.INVALID_INPUT
        val response = try { apiFactory.create(url).pair(PairRequest(code, name)) }
        catch (error: CancellationException) { throw error }
        catch (_: IOException) { return@withContext PairingResult.SERVER_UNAVAILABLE }
        catch (_: Exception) { return@withContext PairingResult.INVALID_RESPONSE }
        if (response.code() != 201) {
            response.errorBody()?.close()
            return@withContext when (response.code()) {
                400 -> PairingResult.INVALID_CODE
                429 -> PairingResult.RATE_LIMITED
                else -> PairingResult.SERVER_UNAVAILABLE
            }
        }
        val data = response.body()?.data
        val token = data?.deviceToken
        val deviceId = data?.deviceId
        if (token == null || !Regex("[A-Za-z0-9_-]{43}").matches(token) || !isCanonicalUuid(deviceId)) return@withContext PairingResult.INVALID_RESPONSE
        try { credentials.save(DeviceCredential(url, requireNotNull(deviceId), token)) }
        catch (_: Exception) { return@withContext PairingResult.SECURE_STORAGE_UNAVAILABLE }
        // Pairing remains successful even if scheduling cannot finish now. Room
        // retains the backlog and the next application start requests work again.
        try { onPaired() } catch (error: CancellationException) { throw error } catch (_: Exception) { /* no sensitive logs */ }
        PairingResult.PAIRED
    }
}

fun isCanonicalUuid(value: String?): Boolean = try {
    value != null && UUID.fromString(value).toString() == value
} catch (_: IllegalArgumentException) { false }
