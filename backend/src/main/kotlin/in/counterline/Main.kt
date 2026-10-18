package `in`.counterline

import com.zaxxer.hikari.HikariConfig
import com.zaxxer.hikari.HikariDataSource
import io.ktor.http.HttpMethod
import io.ktor.http.HttpStatusCode
import io.ktor.server.application.*
import io.ktor.server.engine.embeddedServer
import io.ktor.server.netty.Netty
import io.ktor.server.plugins.BadRequestException
import io.ktor.server.plugins.PayloadTooLargeException
import io.ktor.server.plugins.bodylimit.RequestBodyLimit
import io.ktor.server.plugins.contentnegotiation.ContentNegotiation
import io.ktor.server.plugins.statuspages.StatusPages
import io.ktor.server.request.httpMethod
import io.ktor.server.request.path
import io.ktor.server.request.receive
import io.ktor.server.response.respond
import io.ktor.server.routing.*
import io.ktor.serialization.kotlinx.json.json
import io.ktor.util.AttributeKey
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.Json
import org.flywaydb.core.Flyway

private val principalKey = AttributeKey<StaffPrincipal>("staffPrincipal")
@Serializable private data class Profile(val staff: StaffMember, val permissions: List<String>)

fun main() {
    val dataSource = HikariDataSource(HikariConfig().apply {
        jdbcUrl = System.getenv("JDBC_URL") ?: "jdbc:postgresql://127.0.0.1:54329/counterline"
        username = System.getenv("DB_USER") ?: "counterline"
        password = requireNotNull(System.getenv("DB_PASSWORD")) { "Set DB_PASSWORD." }
        maximumPoolSize = 5
        connectionTimeout = 5_000
        validationTimeout = 2_000
        addDataSourceProperty("connectTimeout", 3)
        addDataSourceProperty("socketTimeout", 10)
    })
    try {
        Flyway.configure().dataSource(dataSource).load().migrate()
        val json = Json { encodeDefaults = true; ignoreUnknownKeys = false }
        val checkout = Checkout(dataSource, json)
        val identity = Identity(dataSource)
        identity.bootstrap(System.getenv("OWNER_USERNAME"), System.getenv("OWNER_PASSWORD"))
        val catalog = Catalog(dataSource, json)
        val frontDesk = FrontDesk(dataSource, json, checkout)
        embeddedServer(Netty, host = System.getenv("HOST") ?: "127.0.0.1", port = System.getenv("PORT")?.toInt() ?: 8080) {
            install(RequestBodyLimit) { bodyLimit { 64 * 1024L } }
            install(ContentNegotiation) { json(json) }
            install(StatusPages) {
                exception<Problem> { call, cause -> call.respond(HttpStatusCode.fromValue(cause.status), ErrorBody(cause.code, cause.message)) }
                exception<PayloadTooLargeException> { call, _ -> call.respond(HttpStatusCode.PayloadTooLarge, ErrorBody("body_too_large", "Request body exceeds 64 KiB.")) }
                exception<BadRequestException> { call, _ -> call.respond(HttpStatusCode.BadRequest, ErrorBody("invalid_request", "Malformed request body.")) }
                exception<Throwable> { call, cause ->
                    if (cause is kotlinx.coroutines.CancellationException) throw cause
                    call.application.log.error("Request failed", cause)
                    call.respond(HttpStatusCode.InternalServerError, ErrorBody("internal_error", "Request could not be completed."))
                }
            }
            val staffAuthentication = createRouteScopedPlugin("StaffAuthentication") {
                onCall { call ->
                    call.response.headers.append("Cache-Control", "no-store")
                    if (call.request.path() != "/api/auth/login" || call.request.httpMethod != HttpMethod.Post) {
                        val principal = withContext(Dispatchers.IO) { identity.authenticate(call.request.headers["Authorization"]) }
                        call.attributes.put(principalKey, principal)
                    }
                }
            }
            routing {
                get("/health") { call.respond(mapOf("status" to "ok", "mode" to "demo-online")) }
                get("/ready") {
                    call.response.headers.append("Cache-Control", "no-store")
                    val ready = withContext(Dispatchers.IO) {
                        try { dataSource.connection.use { it.isValid(2) } } catch (_: java.sql.SQLException) { false }
                    }
                    call.respond(if (ready) HttpStatusCode.OK else HttpStatusCode.ServiceUnavailable,
                        mapOf("status" to if (ready) "ready" else "database_unavailable"))
                }
                route("/api") {
                    install(staffAuthentication)
                    post("/auth/login") {
                        val input = call.receive<LoginRequest>()
                        call.respond(withContext(Dispatchers.IO) { identity.login(input, call.request.local.remoteHost) })
                    }
                    get("/auth/me") {
                        val staff = call.principal().staff
                        call.respond(Profile(staff, staff.permissions))
                    }
                    post("/auth/logout") {
                        withContext(Dispatchers.IO) { identity.logout(call.principal()) }
                        call.respond(mapOf("status" to "signed_out"))
                    }
                    post("/auth/password") {
                        val input = call.receive<PasswordChange>()
                        withContext(Dispatchers.IO) { identity.changePassword(call.principal(), input) }
                        call.respond(mapOf("status" to "password_changed_sign_in_again"))
                    }
                    get("/admin/staff") { call.respond(withContext(Dispatchers.IO) { identity.list(call.principal()) }) }
                    post("/admin/staff") {
                        call.require(Permission.STAFF_MANAGE)
                        val input = call.receive<StaffCreate>()
                        call.respond(withContext(Dispatchers.IO) { identity.create(call.principal(), input) })
                    }
                    post("/admin/staff/{id}") {
                        call.require(Permission.STAFF_MANAGE)
                        val input = call.receive<StaffChange>()
                        call.respond(withContext(Dispatchers.IO) { identity.change(call.principal(), call.parameters["id"]!!, input) })
                    }
                    post("/admin/staff/{id}/password") {
                        call.require(Permission.STAFF_MANAGE)
                        val input = call.receive<PasswordReset>()
                        withContext(Dispatchers.IO) { identity.resetPassword(call.principal(), call.parameters["id"]!!, input) }
                        call.respond(mapOf("status" to "password_reset_sessions_revoked"))
                    }
                    get("/menu") {
                        call.require(Permission.MENU_READ)
                        call.respond(withContext(Dispatchers.IO) { checkout.menu() })
                    }
                    get("/admin/menu") {
                        call.require(Permission.MENU_MANAGE)
                        call.respond(withContext(Dispatchers.IO) { catalog.all() })
                    }
                    post("/admin/menu") {
                        call.require(Permission.MENU_MANAGE)
                        val input = call.receive<MenuCreate>()
                        call.respond(withContext(Dispatchers.IO) { catalog.create(input, call.principal().staff.id) })
                    }
                    post("/admin/menu/{id}") {
                        call.require(Permission.MENU_MANAGE)
                        val input = call.receive<MenuChange>()
                        call.respond(withContext(Dispatchers.IO) { catalog.change(call.parameters["id"]!!, input, call.principal().staff.id) })
                    }
                    get("/tables") {
                        call.require(Permission.ORDERS_READ)
                        call.respond(withContext(Dispatchers.IO) { frontDesk.tables() })
                    }
                    post("/admin/tables") {
                        call.require(Permission.TABLES_MANAGE)
                        val input = call.receive<TableCreate>()
                        call.respond(withContext(Dispatchers.IO) { frontDesk.createTable(input, call.principal().staff.id) })
                    }
                    post("/admin/tables/{id}") {
                        call.require(Permission.TABLES_MANAGE)
                        val input = call.receive<TableChange>()
                        call.respond(withContext(Dispatchers.IO) { frontDesk.changeTable(call.parameters["id"]!!, input, call.principal().staff.id) })
                    }
                    post("/checks") {
                        call.require(Permission.ORDERS_WRITE)
                        val input = call.receive<OpenCheck>()
                        call.respond(withContext(Dispatchers.IO) { frontDesk.open(input, call.principal().staff.id) })
                    }
                    get("/checks/{id}") {
                        call.require(Permission.ORDERS_READ)
                        call.respond(withContext(Dispatchers.IO) { frontDesk.get(call.parameters["id"]!!) })
                    }
                    post("/checks/{id}/batches") {
                        call.require(Permission.ORDERS_WRITE)
                        val input = call.receive<SubmitBatch>()
                        call.respond(withContext(Dispatchers.IO) { frontDesk.submit(call.parameters["id"]!!, input, call.principal().staff.id) })
                    }
                    post("/checks/{id}/transfer") {
                        call.require(Permission.ORDERS_WRITE)
                        val input = call.receive<CheckTransfer>()
                        call.respond(withContext(Dispatchers.IO) { frontDesk.transfer(call.parameters["id"]!!, input, call.principal().staff.id) })
                    }
                    post("/checks/{id}/cash-payments") {
                        call.require(Permission.CASH_RECORD)
                        val input = call.receive<CheckCash>()
                        call.respond(withContext(Dispatchers.IO) { frontDesk.pay(call.parameters["id"]!!, input, call.principal().staff.id) })
                    }
                    post("/checks/{id}/close-empty") {
                        call.require(Permission.ORDERS_WRITE)
                        val input = call.receive<CloseEmptyCheck>()
                        call.respond(withContext(Dispatchers.IO) { frontDesk.closeEmpty(call.parameters["id"]!!, input, call.principal().staff.id) })
                    }
                    get("/orders") {
                        call.require(Permission.ORDERS_READ)
                        val status = call.request.queryParameters["status"] ?: "ALL"
                        val before = call.queryLong("before"); val limit = call.queryLimit(25)
                        call.respond(withContext(Dispatchers.IO) { checkout.orders(status, before, limit) })
                    }
                    get("/kitchen") {
                        call.require(Permission.KITCHEN_READ)
                        val after = call.queryLong("after"); val limit = call.queryLimit(50)
                        val page = withContext(Dispatchers.IO) { checkout.kitchen(after, limit) }
                        call.respond(KitchenPage(page.orders.map { it.forKitchen() }, page.nextCursor))
                    }
                    post("/orders/{id}/kitchen") {
                        call.require(Permission.KITCHEN_WRITE)
                        val change = call.receive<KitchenChange>()
                        val order = withContext(Dispatchers.IO) { checkout.advanceKitchen(call.parameters["id"]!!, change, call.principal().staff.id) }
                        call.respond(order.forKitchen())
                    }
                    post("/orders") {
                        call.require(Permission.ORDERS_WRITE)
                        val request = call.receive<CreateOrder>()
                        call.respond(withContext(Dispatchers.IO) { checkout.create(request, call.principal().staff.id) })
                    }
                    get("/orders/{id}") {
                        call.require(Permission.ORDERS_READ)
                        call.respond(withContext(Dispatchers.IO) { checkout.order(call.parameters["id"]!!) })
                    }
                    post("/orders/{id}/cash-payment") {
                        call.require(Permission.CASH_RECORD)
                        val payment = call.receive<CashPayment>()
                        call.respond(withContext(Dispatchers.IO) { checkout.payCash(call.parameters["id"]!!, payment, call.principal().staff.id) })
                    }
                    get("/reports/today") {
                        call.require(Permission.REPORTS_READ)
                        call.respond(withContext(Dispatchers.IO) { checkout.today() })
                    }
                }
            }
        }.start(wait = true)
    } finally { dataSource.close() }
}
private fun ApplicationCall.principal(): StaffPrincipal = attributes[principalKey]
private fun ApplicationCall.require(permission: Permission) = principal().require(permission)
private fun ApplicationCall.queryLong(name: String): Long? {
    val values = request.queryParameters.getAll(name) ?: return null
    if (values.size != 1) throw Problem(400, "invalid_query", "$name must occur once.")
    return values.single().toLongOrNull()?.takeIf { it > 0 } ?: throw Problem(400, "invalid_query", "$name must be a positive integer.")
}
private fun ApplicationCall.queryLimit(default: Int): Int {
    val value = queryLong("limit") ?: return default
    if (value > 100) throw Problem(400, "invalid_query", "Page limit must be between 1 and 100.")
    return value.toInt()
}
