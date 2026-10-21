package com.gestorfinanciero.data.remote

import com.google.gson.GsonBuilder
import com.gestorfinanciero.auth.DeviceCredential
import java.util.concurrent.TimeUnit
import okhttp3.OkHttpClient
import okhttp3.HttpUrl.Companion.toHttpUrl
import retrofit2.Retrofit
import retrofit2.converter.gson.GsonConverterFactory

class FinanceApiFactory(private val callTimeoutMillis: Long = 20_000) {
    private val transport = OkHttpClient.Builder()
        .connectTimeout(10, TimeUnit.SECONDS).readTimeout(15, TimeUnit.SECONDS)
        .writeTimeout(15, TimeUnit.SECONDS).callTimeout(callTimeoutMillis, TimeUnit.MILLISECONDS)
        .retryOnConnectionFailure(false).followRedirects(false).followSslRedirects(false).build()

    fun create(baseUrl: String, credential: DeviceCredential? = null): FinanceApi {
        require(credential == null || credential.baseUrl == baseUrl)
        val syncUrl = baseUrl.toHttpUrl().resolve("api/v1/device/transactions/sync")
        val client = transport.newBuilder()
            .addInterceptor { chain ->
                val original = chain.request()
                val request = original.newBuilder().removeHeader("Authorization")
                if (credential != null && original.method == "POST" && original.url == syncUrl) {
                    request.header("Authorization", "Bearer ${credential.token}")
                }
                chain.proceed(request.build())
            }.build()
        // No HTTP logging interceptor, cache, cookies, URLs carrying credentials,
        // authenticator, automatic redirect, or hidden transport retries.
        return Retrofit.Builder().baseUrl(baseUrl).client(client)
            .addConverterFactory(GsonConverterFactory.create(GsonBuilder().serializeNulls().create()))
            .build().create(FinanceApi::class.java)
    }
}
