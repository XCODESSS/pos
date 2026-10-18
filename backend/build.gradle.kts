plugins {
    kotlin("jvm") version "2.1.21"
    kotlin("plugin.serialization") version "2.1.21"
    application
}

repositories { mavenCentral() }
kotlin { jvmToolchain(21) }
application { mainClass.set("in.counterline.MainKt") }

val ktorVersion = "3.2.3"
dependencies {
    implementation("io.ktor:ktor-server-netty:$ktorVersion")
    implementation("io.ktor:ktor-server-content-negotiation:$ktorVersion")
    implementation("io.ktor:ktor-serialization-kotlinx-json:$ktorVersion")
    implementation("io.ktor:ktor-server-status-pages:$ktorVersion")
    implementation("io.ktor:ktor-server-body-limit:$ktorVersion")
    implementation("org.jetbrains.kotlinx:kotlinx-serialization-json:1.8.1")
    implementation("com.zaxxer:HikariCP:6.3.0")
    implementation("org.postgresql:postgresql:42.7.7")
    implementation("org.flywaydb:flyway-core:11.10.0")
    implementation("org.flywaydb:flyway-database-postgresql:11.10.0")
    runtimeOnly("ch.qos.logback:logback-classic:1.5.18")
}
