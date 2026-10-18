package `in`.counterline

import java.net.HttpURLConnection
import java.net.URI
import kotlin.system.exitProcess

/** Container readiness probe; no credentials or additional runtime binaries required. */
object HealthCheck {
    @JvmStatic
    fun main(args: Array<String>) {
        val port = System.getenv("PORT")?.toIntOrNull() ?: 8080
        val connection = URI("http://127.0.0.1:$port/ready").toURL().openConnection() as HttpURLConnection
        connection.connectTimeout = 2_000
        connection.readTimeout = 4_000
        val healthy = try { connection.responseCode == 200 } catch (_: java.io.IOException) { false }
        finally { connection.disconnect() }
        exitProcess(if (healthy) 0 else 1)
    }
}
