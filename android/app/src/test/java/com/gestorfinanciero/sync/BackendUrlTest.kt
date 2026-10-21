package com.gestorfinanciero.sync

import com.gestorfinanciero.data.remote.BackendUrl
import org.junit.Assert.*
import org.junit.Test

class BackendUrlTest {
    @Test fun `production requires HTTPS and rejects embedded secrets or non-root URLs`() {
        assertEquals("https://example.test/", BackendUrl.normalize("https://example.test", false))
        for (url in listOf("http://127.0.0.1:3000", "https://user:password@example.test/", "https://example.test/?token=x", "https://example.test/#x", "https://example.test/api/v1/")) {
            assertNull(BackendUrl.normalize(url, false))
        }
    }
    @Test fun `development HTTP is limited to explicit private or loopback addresses`() {
        for (url in listOf("http://127.0.0.1:3000", "http://192.168.1.5:3000", "http://10.0.2.2:3000", "http://172.16.1.2")) {
            assertNotNull(BackendUrl.normalize(url, true))
        }
        for (url in listOf("http://example.test", "http://8.8.8.8", "http://172.32.0.1")) assertNull(BackendUrl.normalize(url, true))
    }
}
