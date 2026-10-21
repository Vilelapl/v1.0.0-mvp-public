package com.gestorfinanciero.data.remote

import okhttp3.HttpUrl.Companion.toHttpUrlOrNull

object BackendUrl {
    fun normalize(input: String, allowDevelopmentHttp: Boolean): String? {
        val url = input.trim().toHttpUrlOrNull() ?: return null
        if (url.username.isNotEmpty() || url.password.isNotEmpty() || url.query != null || url.fragment != null || url.encodedPath != "/") return null
        if (!url.isHttps && !(allowDevelopmentHttp && privateIpv4(url.host))) return null
        return url.toString()
    }

    private fun privateIpv4(host: String): Boolean {
        val parts = host.split('.').map { it.toIntOrNull() ?: return false }
        if (parts.size != 4 || parts.any { it !in 0..255 }) return false
        return parts[0] == 10 || parts[0] == 127 ||
            (parts[0] == 192 && parts[1] == 168) || (parts[0] == 172 && parts[1] in 16..31)
    }
}
