import org.jetbrains.kotlin.gradle.dsl.JvmTarget

plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
    id("com.google.devtools.ksp")
    id("androidx.room")
}

android {
    namespace = "com.gestorfinanciero"
    compileSdk = 36

    defaultConfig {
        applicationId = "com.gestorfinanciero"
        minSdk = 26
        targetSdk = 36
        versionCode = 1
        versionName = "0.1.0"
        testInstrumentationRunner = "androidx.test.runner.AndroidJUnitRunner"
        manifestPlaceholders["allowCleartextTraffic"] = "false"
    }

    buildFeatures { buildConfig = true }
    buildTypes.getByName("debug").manifestPlaceholders["allowCleartextTraffic"] = "true"

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
    testOptions {
        unitTests.isIncludeAndroidResources = true
    }

    // Temporary, opt-in fixture capture. These components do not exist in normal
    // debug or release APKs, and do not change the production parser registry.
    val captureDiagnostics = providers.gradleProperty("captureDiagnostics").orNull == "true"
    sourceSets.getByName("debug").apply {
        java.srcDir(if (captureDiagnostics) "src/diagnostic/java" else "src/noDiagnostic/java")
        if (captureDiagnostics) manifest.srcFile("src/diagnostic/AndroidManifest.xml")
    }
    sourceSets.getByName("release").java.srcDir("src/noDiagnostic/java")
    if (captureDiagnostics) sourceSets.getByName("testDebug").java.srcDir("src/testDiagnostic/java")
}

kotlin {
    compilerOptions.jvmTarget.set(JvmTarget.JVM_17)
}

room {
    schemaDirectory("$projectDir/schemas")
}

dependencies {
    implementation("androidx.core:core-ktx:1.17.0")
    implementation("androidx.room:room-runtime:2.8.4")
    ksp("androidx.room:room-compiler:2.8.4")
    implementation("org.jetbrains.kotlinx:kotlinx-coroutines-android:1.10.2")
    implementation("androidx.work:work-runtime-ktx:2.11.2")
    implementation("com.squareup.retrofit2:retrofit:3.0.0")
    implementation("com.squareup.retrofit2:converter-gson:3.0.0")
    implementation("com.squareup.okhttp3:okhttp:4.12.0")

    testImplementation("junit:junit:4.13.2")
    testImplementation("androidx.test:core:1.7.0")
    testImplementation("androidx.room:room-testing:2.8.4")
    testImplementation("org.robolectric:robolectric:4.16.1")
    testImplementation("org.jetbrains.kotlinx:kotlinx-coroutines-test:1.10.2")
    testImplementation("androidx.work:work-testing:2.11.2")
    testImplementation("com.squareup.okhttp3:mockwebserver:4.12.0")

    androidTestImplementation("androidx.test:runner:1.7.0")
    androidTestImplementation("androidx.test.ext:junit:1.3.0")
}
