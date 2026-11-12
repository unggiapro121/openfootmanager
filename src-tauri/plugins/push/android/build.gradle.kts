// The Android half of the push plugin (phase 5 M3c2). Firebase Messaging is the only push channel
// Android has without Google Play's own service bound to an app (m3-tech-spec §5.3).
plugins {
    id("com.android.library")
    id("org.jetbrains.kotlin.android")
}

android {
    namespace = "app.ofm.push"
    compileSdk = 36

    defaultConfig {
        minSdk = 26
        // Shipped to the app: R8 must keep what Tauri reaches by reflection (B4).
        consumerProguardFiles("consumer-rules.pro")
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_1_8
        targetCompatibility = JavaVersion.VERSION_1_8
    }
    kotlinOptions {
        jvmTarget = "1.8"
    }
}

dependencies {
    implementation("androidx.core:core-ktx:1.9.0")
    implementation("com.google.firebase:firebase-messaging:23.4.1")
    implementation(project(":tauri-android"))
}
