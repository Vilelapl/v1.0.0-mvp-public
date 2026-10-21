package com.gestorfinanciero

import android.content.ComponentName
import android.content.Context
import android.content.pm.PackageManager
import android.provider.Settings
import android.widget.Button
import android.widget.LinearLayout
import android.widget.ScrollView
import androidx.test.core.app.ApplicationProvider
import com.gestorfinanciero.capture.FinanceNotificationListener
import com.gestorfinanciero.ui.MainActivity
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.Robolectric
import org.robolectric.RobolectricTestRunner
import org.robolectric.Shadows.shadowOf
import org.robolectric.annotation.Config

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [35])
class AndroidComponentsTest {
    @Test fun `manifest protects listener binding and includes necessary network access`() {
        val context = ApplicationProvider.getApplicationContext<Context>()
        val service = context.packageManager.getServiceInfo(
            ComponentName(context, FinanceNotificationListener::class.java), 0,
        )
        assertEquals("android.permission.BIND_NOTIFICATION_LISTENER_SERVICE", service.permission)
        assertFalse(service.exported)
        val info = context.packageManager.getPackageInfo(context.packageName, PackageManager.GET_PERMISSIONS)
        assertTrue(info.requestedPermissions.orEmpty().contains("android.permission.INTERNET"))
        assertFalse(info.requestedPermissions.orEmpty().contains("android.permission.POST_NOTIFICATIONS"))
    }

    @Test fun `minimal activity opens the official manual notification settings`() {
        val controller = Robolectric.buildActivity(MainActivity::class.java).setup()
        try {
            val activity = controller.get()
            val scroll = activity.findViewById<android.view.ViewGroup>(android.R.id.content).getChildAt(0) as ScrollView
            val root = scroll.getChildAt(0) as LinearLayout
            val button = (0 until root.childCount).map { root.getChildAt(it) }.filterIsInstance<Button>()
                .single { it.text == activity.getString(R.string.open_notification_settings) }
            button.performClick()
            assertEquals(Settings.ACTION_NOTIFICATION_LISTENER_SETTINGS, shadowOf(activity).nextStartedActivity.action)
        } finally { controller.pause().stop().destroy() }
    }
}
