package com.gestorfinanciero.ui

import android.app.Activity
import android.content.ActivityNotFoundException
import android.content.Intent
import android.os.Bundle
import android.provider.Settings
import android.text.InputType
import android.view.View
import android.view.WindowManager
import android.view.inputmethod.EditorInfo
import android.widget.Button
import android.widget.EditText
import android.widget.LinearLayout
import android.widget.ScrollView
import android.widget.TextView
import android.widget.Toast
import androidx.core.app.NotificationManagerCompat
import androidx.core.view.ViewCompat
import androidx.core.view.WindowInsetsCompat
import com.gestorfinanciero.FinanceApplication
import com.gestorfinanciero.R
import com.gestorfinanciero.auth.PairingResult
import com.gestorfinanciero.auth.PairingState
import com.gestorfinanciero.data.local.SyncStatus
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

class MainActivity : Activity() {
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Main.immediate)
    private var queueJob: Job? = null
    private val app get() = application as FinanceApplication
    private lateinit var accessStatus: TextView
    private lateinit var pairingStatus: TextView
    private lateinit var queueStatus: TextView
    private lateinit var resultStatus: TextView
    private lateinit var server: EditText
    private lateinit var deviceName: EditText
    private lateinit var code: EditText
    private lateinit var pairButton: Button

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        window.addFlags(WindowManager.LayoutParams.FLAG_SECURE)
        val padding = (24 * resources.displayMetrics.density).toInt()
        val content = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(padding, padding, padding, padding)
        }
        fun label(text: String) = TextView(this).also { it.text = text; content.addView(it) }
        fun input(labelText: String, hintText: String): EditText {
            label(labelText)
            return EditText(this).also {
                it.hint = hintText
                it.isSingleLine = true
                it.isSaveEnabled = false
                it.importantForAutofill = View.IMPORTANT_FOR_AUTOFILL_NO_EXCLUDE_DESCENDANTS
                it.imeOptions = EditorInfo.IME_FLAG_NO_PERSONALIZED_LEARNING
                content.addView(it)
            }
        }
        label(getString(R.string.app_name)).textSize = 26f
        label(getString(R.string.capture_explanation))
        label(getString(R.string.capture_pending))
        accessStatus = label("")
        content.addView(Button(this).apply {
            setText(R.string.open_notification_settings)
            setOnClickListener {
                try { startActivity(Intent(Settings.ACTION_NOTIFICATION_LISTENER_SETTINGS)) }
                catch (_: ActivityNotFoundException) { Toast.makeText(context, R.string.settings_unavailable, Toast.LENGTH_LONG).show() }
            }
        })
        pairingStatus = label("Consultando emparejamiento…")
        server = input("URL del servidor", "https://…/").apply {
            id = R.id.server_url
            inputType = InputType.TYPE_CLASS_TEXT or InputType.TYPE_TEXT_VARIATION_URI
        }
        deviceName = input("Nombre del dispositivo", "Mi teléfono").apply { id = R.id.device_name }
        code = input("Código de emparejamiento", "XXXXX-XXXXX").apply {
            id = R.id.pairing_code
            inputType = InputType.TYPE_CLASS_TEXT or InputType.TYPE_TEXT_FLAG_CAP_CHARACTERS or InputType.TYPE_TEXT_FLAG_NO_SUGGESTIONS
        }
        pairButton = Button(this).apply {
            id = R.id.pair_device
            text = "Emparejar / reemparejar"
            setOnClickListener { pair() }
        }
        content.addView(pairButton)
        resultStatus = label("")
        queueStatus = label("")
        content.addView(Button(this).apply {
            text = "Sincronizar pendientes"
            setOnClickListener {
                scope.launch {
                    try {
                        withContext(Dispatchers.IO) { app.requestPendingSync(manualRetry = true) }
                        resultStatus.text = "Las capturas pendientes se enviarán con conexión y respetando los reintentos."
                    } catch (error: CancellationException) { throw error }
                    catch (_: Exception) { resultStatus.text = "No se pudo solicitar el envío. Las capturas siguen guardadas." }
                }
            }
        })
        val scroll = ScrollView(this).apply { addView(content) }
        ViewCompat.setOnApplyWindowInsetsListener(content) { view, insets ->
            val bars = insets.getInsets(WindowInsetsCompat.Type.systemBars())
            view.setPadding(padding + bars.left, padding + bars.top, padding + bars.right, padding + bars.bottom)
            insets
        }
        setContentView(scroll)
    }

    private fun pair() {
        val url = server.text.toString()
        val name = deviceName.text.toString()
        val pairingCode = code.text.toString()
        code.text.clear()
        pairButton.isEnabled = false
        resultStatus.text = "Emparejando…"
        scope.launch {
            try {
                resultStatus.text = when (app.pairing.pair(url, pairingCode, name)) {
                    PairingResult.PAIRED -> "Dispositivo emparejado. Las capturas pendientes pueden continuar."
                    PairingResult.INVALID_INPUT -> "Revisa la URL raíz del servidor, el código y un nombre de 1 a 100 caracteres."
                    PairingResult.INVALID_CODE -> "El código no es válido o ya expiró. Genera uno nuevo."
                    PairingResult.RATE_LIMITED -> "Demasiados intentos. Espera unos minutos antes de volver a intentarlo."
                    PairingResult.SERVER_UNAVAILABLE -> "No se pudo conectar con el servidor. Revisa la conexión y la URL."
                    PairingResult.INVALID_RESPONSE -> "El servidor devolvió una respuesta de emparejamiento inesperada."
                    PairingResult.SECURE_STORAGE_UNAVAILABLE -> "No se pudo guardar la credencial de forma segura. Necesitarás un código nuevo."
                }
                refreshPairing()
            } catch (error: CancellationException) { throw error }
            finally { pairButton.isEnabled = true }
        }
    }

    override fun onStart() {
        super.onStart()
        queueJob = scope.launch {
            app.database.pendingTransactions().observeStatusCounts().collect { counts ->
                val totals = counts.associate { it.syncStatus to it.count }
                queueStatus.text = "Pendientes: " + (totals[SyncStatus.PENDING] ?: 0) + " · Enviando: " + (totals[SyncStatus.SYNCING] ?: 0) +
                    "\nReintento: " + (totals[SyncStatus.RETRY] ?: 0) + " · Sincronizadas: " + (totals[SyncStatus.SYNCED] ?: 0) + " · Revisión: " + (totals[SyncStatus.FAILED] ?: 0)
                refreshPairing()
            }
        }
    }

    override fun onResume() {
        super.onResume()
        val enabled = packageName in NotificationManagerCompat.getEnabledListenerPackages(this)
        accessStatus.setText(if (enabled) R.string.notification_access_enabled else R.string.notification_access_disabled)
        scope.launch { refreshPairing() }
    }

    private suspend fun refreshPairing() {
        val (state, lastUrl) = withContext(Dispatchers.IO) { app.credentials.state() to app.credentials.lastBaseUrl() }
        pairingStatus.text = when (state) {
            PairingState.PAIRED -> "Dispositivo emparejado"
            PairingState.UNPAIRED -> "Emparejamiento pendiente"
            PairingState.REPAIR_REQUIRED -> "Debes emparejar de nuevo. Tus capturas se conservan."
        }
        if (server.text.isBlank()) server.setText(lastUrl)
    }

    override fun onStop() { queueJob?.cancel(); queueJob = null; super.onStop() }
    override fun onDestroy() { scope.cancel(); super.onDestroy() }
}
