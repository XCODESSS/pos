package `in`.counterline.pos

import io.ktor.client.HttpClient
import io.ktor.client.call.body
import io.ktor.client.engine.okhttp.OkHttp
import io.ktor.client.plugins.HttpTimeout
import io.ktor.client.plugins.contentnegotiation.ContentNegotiation
import io.ktor.client.request.*
import io.ktor.http.*
import io.ktor.serialization.kotlinx.json.json
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.Json
import java.text.NumberFormat
import java.util.Locale

@Serializable data class MenuItem(val id: String, val name: String, val category: String, val pricePaise: Long, val available: Boolean = true)
@Serializable data class LoginRequest(val username: String, val password: String)
@Serializable data class StaffProfile(val displayName: String, val username: String, val role: String)
@Serializable data class StaffSession(val accessToken: String, val staff: StaffProfile, val permissions: List<String>)
@Serializable class EmptyRequest
@Serializable data class StatusResponse(val status: String)
@Serializable data class CartLine(val itemId: String, val quantity: Int)
@Serializable data class CreateOrder(val id: String, val lines: List<CartLine>, val orderType: String = "TAKEAWAY")
@Serializable data class BillLine(val itemId: String, val name: String, val quantity: Int, val subtotalPaise: Long)
@Serializable data class Bill(
    val id: String, val billNumber: String, val lines: List<BillLine>,
    val subtotalPaise: Long, val cgstPaise: Long, val sgstPaise: Long, val totalPaise: Long,
)
@Serializable data class Order(val bill: Bill, val status: String)
@Serializable data class CashPayment(val receivedPaise: Long)
@Serializable data class SalesReport(val date: String, val paidOrders: Long, val totalPaise: Long)
@Serializable data class ApiError(val message: String)
class RequestFailed(val status: Int, message: String) : Exception(message)

class PosApi {
    val json = Json { ignoreUnknownKeys = true; encodeDefaults = true }
    private val client = HttpClient(OkHttp) {
        install(ContentNegotiation) { json(json) }
        install(HttpTimeout) { requestTimeoutMillis = 15_000; connectTimeoutMillis = 10_000 }
    }
    suspend inline fun <reified T> get(base: String, token: String, path: String): T =
        response(base, token, path).body()
    suspend inline fun <reified T> post(base: String, token: String, path: String, body: Any): T =
        response(base, token, path, body).body()

    suspend fun response(base: String, token: String, path: String, body: Any? = null): io.ktor.client.statement.HttpResponse {
        require(base.startsWith("http://") || base.startsWith("https://")) { "Use an HTTP(S) server URL." }
        val response = client.request("${base.trimEnd('/')}/api$path") {
            if (token.isNotBlank()) bearerAuth(token)
            if (body != null) {
                method = HttpMethod.Post
                contentType(ContentType.Application.Json)
                when (body) {
                    is CreateOrder -> setBody(body)
                    is CashPayment -> setBody(body)
                    is LoginRequest -> setBody(body)
                    is EmptyRequest -> setBody(body)
                    else -> error("Unsupported request")
                }
            }
        }
        if (!response.status.isSuccess()) {
            val message = try { response.body<ApiError>().message }
            catch (cancelled: kotlinx.coroutines.CancellationException) { throw cancelled }
            catch (_: Exception) { "Server request failed." }
            throw RequestFailed(response.status.value, message)
        }
        return response
    }
    fun close() = client.close()
}
fun money(paise: Long): String = NumberFormat.getCurrencyInstance(Locale.forLanguageTag("en-IN"))
    .format(java.math.BigDecimal.valueOf(paise, 2))
