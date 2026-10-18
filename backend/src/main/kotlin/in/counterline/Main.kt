package `in`.counterline

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

private val principalKey = AttributeKey<StaffPrincipal>("staffPrincipal")
private val tenantKey = AttributeKey<TenantRuntime>("tenantRuntime")
@Serializable private data class Profile(val staff: StaffMember, val permissions: List<String>)

fun main() {
    val json = Json { encodeDefaults = true; ignoreUnknownKeys = false }
    val environment = AppEnvironment.from(System.getenv("APP_ENV"))
    val tenants = TenantRegistry.load(json, environment)
    try {
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
            val staffAuthentication = createRouteScopedPlugin("TenantStaffAuthentication") {
                onCall { call ->
                    call.response.headers.append("Cache-Control", "no-store")
                    val tenant = tenants.resolve(call.parameters["tenant"])
                    call.attributes.put(tenantKey, tenant)
                    if (call.request.path() != "/t/${tenant.slug}/api/auth/login" || call.request.httpMethod != HttpMethod.Post) {
                        val principal = withContext(Dispatchers.IO) { tenant.identity.authenticate(call.request.headers["Authorization"]) }
                        call.attributes.put(principalKey, principal)
                    }
                }
            }
            routing {
                get("/health") { call.respond(mapOf("status" to "ok", "mode" to "online-preview", "environment" to environment.label)) }
                get("/ready") {
                    call.response.headers.append("Cache-Control", "no-store")
                    val ready = withContext(Dispatchers.IO) { tenants.ready() }
                    call.respond(if (ready) HttpStatusCode.OK else HttpStatusCode.ServiceUnavailable,
                        mapOf("status" to if (ready) "ready" else "database_unavailable"))
                }
                // No unscoped /api compatibility route: tenant selection is mandatory.
                route("/t/{tenant}/api") {
                    install(staffAuthentication)
                    post("/auth/login") {
                        val input = call.receive<LoginRequest>()
                        call.respond(withContext(Dispatchers.IO) { call.tenant().identity.login(input, call.request.local.remoteHost) })
                    }
                    get("/auth/me") { val staff = call.principal().staff; call.respond(Profile(staff, staff.permissions)) }
                    post("/auth/logout") {
                        withContext(Dispatchers.IO) { call.tenant().identity.logout(call.principal()) }
                        call.respond(mapOf("status" to "signed_out"))
                    }
                    post("/auth/password") {
                        val input = call.receive<PasswordChange>()
                        withContext(Dispatchers.IO) { call.tenant().identity.changePassword(call.principal(), input) }
                        call.respond(mapOf("status" to "password_changed_sign_in_again"))
                    }
                    get("/admin/staff") { call.respond(withContext(Dispatchers.IO) { call.tenant().identity.list(call.principal()) }) }
                    post("/admin/staff") {
                        call.require(Permission.STAFF_MANAGE); val input = call.receive<StaffCreate>()
                        call.respond(withContext(Dispatchers.IO) { call.tenant().identity.create(call.principal(), input) })
                    }
                    post("/admin/staff/{id}") {
                        call.require(Permission.STAFF_MANAGE); val input = call.receive<StaffChange>()
                        call.respond(withContext(Dispatchers.IO) { call.tenant().identity.change(call.principal(), call.parameters["id"]!!, input) })
                    }
                    post("/admin/staff/{id}/password") {
                        call.require(Permission.STAFF_MANAGE); val input = call.receive<PasswordReset>()
                        withContext(Dispatchers.IO) { call.tenant().identity.resetPassword(call.principal(), call.parameters["id"]!!, input) }
                        call.respond(mapOf("status" to "password_reset_sessions_revoked"))
                    }
                    get("/menu") {
                        call.require(Permission.MENU_READ)
                        call.respond(withContext(Dispatchers.IO) { call.tenant().checkout.menu() })
                    }
                    get("/admin/menu") {
                        call.require(Permission.MENU_MANAGE)
                        call.respond(withContext(Dispatchers.IO) { call.tenant().catalog.all() })
                    }
                    post("/admin/menu") {
                        call.require(Permission.MENU_MANAGE); val input = call.receive<MenuCreate>()
                        call.respond(withContext(Dispatchers.IO) { call.tenant().catalog.create(input, call.principal().staff.id) })
                    }
                    post("/admin/menu/{id}") {
                        call.require(Permission.MENU_MANAGE); val input = call.receive<MenuChange>()
                        call.respond(withContext(Dispatchers.IO) { call.tenant().catalog.change(call.parameters["id"]!!, input, call.principal().staff.id) })
                    }
                    get("/inventory") {
                        call.require(Permission.STOCK_READ)
                        call.respond(withContext(Dispatchers.IO) { call.tenant().inventory.summary() })
                    }
                    post("/inventory/ingredients") {
                        call.require(Permission.STOCK_MANAGE); val input = call.receive<IngredientCreate>()
                        call.respond(withContext(Dispatchers.IO) { call.tenant().inventory.create(input, call.principal().staff.id) })
                    }
                    post("/inventory/ingredients/{id}") {
                        call.require(Permission.STOCK_MANAGE); val input = call.receive<IngredientChange>()
                        call.respond(withContext(Dispatchers.IO) { call.tenant().inventory.change(call.parameters["id"]!!, input, call.principal().staff.id) })
                    }
                    post("/inventory/ingredients/{id}/movements") {
                        call.require(Permission.STOCK_MANAGE); val input = call.receive<StockMove>()
                        call.respond(withContext(Dispatchers.IO) { call.tenant().inventory.move(call.parameters["id"]!!, input, call.principal().staff.id) })
                    }
                    get("/inventory/movements") {
                        call.require(Permission.STOCK_READ)
                        val id = call.request.queryParameters["ingredientId"] ?: throw Problem(400, "invalid_query", "Choose an ingredient.")
                        val before = call.queryLong("before"); val limit = call.queryLimit(50)
                        call.respond(withContext(Dispatchers.IO) { call.tenant().inventory.movements(id, before, limit) })
                    }
                    post("/inventory/counts") {
                        call.require(Permission.STOCK_MANAGE); val input = call.receive<StockCountInput>()
                        call.respond(withContext(Dispatchers.IO) { call.tenant().stockCounts.record(input, call.principal().staff.id) })
                    }
                    get("/inventory/counts") {
                        call.require(Permission.STOCK_READ)
                        val before = call.queryLong("before"); val limit = call.queryLimit(25)
                        call.respond(withContext(Dispatchers.IO) { call.tenant().stockCounts.list(before, limit) })
                    }
                    get("/inventory/counts/{id}") {
                        call.require(Permission.STOCK_READ)
                        call.respond(withContext(Dispatchers.IO) { call.tenant().stockCounts.get(call.parameters["id"]!!) })
                    }
                    get("/inventory/recipes") {
                        call.require(Permission.STOCK_READ)
                        val item = call.request.queryParameters["itemId"] ?: throw Problem(400, "invalid_query", "Choose a recipe dish.")
                        val kind = try { RecipeKind.valueOf(call.request.queryParameters["kind"] ?: "BASE") } catch (_: IllegalArgumentException) { throw Problem(400, "invalid_query", "Invalid recipe kind.") }
                        val target = RecipeTarget(item, kind, call.request.queryParameters["choiceId"])
                        val version = call.queryLong("version")
                        call.respond(withContext(Dispatchers.IO) { call.tenant().inventory.recipe(target, version) })
                    }
                    post("/inventory/recipes") {
                        call.require(Permission.STOCK_MANAGE); val input = call.receive<RecipeWrite>()
                        call.respond(withContext(Dispatchers.IO) { call.tenant().inventory.saveRecipe(input, call.principal().staff.id) })
                    }
                    post("/orders/stock-preview") {
                        call.require(Permission.ORDERS_WRITE); val input = call.receive<StockPreview>()
                        call.respond(withContext(Dispatchers.IO) { call.tenant().inventory.preview(input) })
                    }
                    get("/tables") {
                        call.require(Permission.ORDERS_READ)
                        call.respond(withContext(Dispatchers.IO) { call.tenant().frontDesk.tables() })
                    }
                    post("/admin/tables") {
                        call.require(Permission.TABLES_MANAGE); val input = call.receive<TableCreate>()
                        call.respond(withContext(Dispatchers.IO) { call.tenant().frontDesk.createTable(input, call.principal().staff.id) })
                    }
                    post("/admin/tables/{id}") {
                        call.require(Permission.TABLES_MANAGE); val input = call.receive<TableChange>()
                        call.respond(withContext(Dispatchers.IO) { call.tenant().frontDesk.changeTable(call.parameters["id"]!!, input, call.principal().staff.id) })
                    }
                    post("/checks") {
                        call.require(Permission.ORDERS_WRITE); val input = call.receive<OpenCheck>()
                        call.respond(withContext(Dispatchers.IO) { call.tenant().frontDesk.open(input, call.principal().staff.id) })
                    }
                    get("/checks/{id}") {
                        call.require(Permission.ORDERS_READ)
                        call.respond(withContext(Dispatchers.IO) { call.tenant().frontDesk.get(call.parameters["id"]!!) })
                    }
                    post("/checks/{id}/batches") {
                        call.require(Permission.ORDERS_WRITE); val input = call.receive<SubmitBatch>()
                        call.respond(withContext(Dispatchers.IO) { call.tenant().frontDesk.submit(call.parameters["id"]!!, input, call.principal().staff.id) })
                    }
                    post("/checks/{id}/transfer") {
                        call.require(Permission.ORDERS_WRITE); val input = call.receive<CheckTransfer>()
                        call.respond(withContext(Dispatchers.IO) { call.tenant().frontDesk.transfer(call.parameters["id"]!!, input, call.principal().staff.id) })
                    }
                    post("/checks/{id}/cash-payments") {
                        call.require(Permission.CASH_RECORD); val input = call.receive<CheckCash>()
                        call.respond(withContext(Dispatchers.IO) { call.tenant().frontDesk.pay(call.parameters["id"]!!, input, call.principal().staff.id) })
                    }
                    post("/checks/{id}/close-empty") {
                        call.require(Permission.ORDERS_WRITE); val input = call.receive<CloseEmptyCheck>()
                        call.respond(withContext(Dispatchers.IO) { call.tenant().frontDesk.closeEmpty(call.parameters["id"]!!, input, call.principal().staff.id) })
                    }
                    get("/orders") {
                        call.require(Permission.ORDERS_READ)
                        val status = call.request.queryParameters["status"] ?: "ALL"
                        val before = call.queryLong("before"); val limit = call.queryLimit(25)
                        call.respond(withContext(Dispatchers.IO) { call.tenant().checkout.orders(status, before, limit) })
                    }
                    get("/kitchen") {
                        call.require(Permission.KITCHEN_READ)
                        val after = call.queryLong("after"); val limit = call.queryLimit(50)
                        val page = withContext(Dispatchers.IO) { call.tenant().checkout.kitchen(after, limit) }
                        call.respond(KitchenPage(page.orders.map { it.forKitchen() }, page.nextCursor))
                    }
                    post("/orders/{id}/kitchen") {
                        call.require(Permission.KITCHEN_WRITE); val input = call.receive<KitchenChange>()
                        val order = withContext(Dispatchers.IO) { call.tenant().checkout.advanceKitchen(call.parameters["id"]!!, input, call.principal().staff.id) }
                        call.respond(order.forKitchen())
                    }
                    post("/orders") {
                        call.require(Permission.ORDERS_WRITE); val input = call.receive<CreateOrder>()
                        call.respond(withContext(Dispatchers.IO) { call.tenant().checkout.create(input, call.principal().staff.id) })
                    }
                    get("/orders/{id}") {
                        call.require(Permission.ORDERS_READ)
                        call.respond(withContext(Dispatchers.IO) { call.tenant().checkout.order(call.parameters["id"]!!) })
                    }
                    post("/orders/{id}/cash-payment") {
                        call.require(Permission.CASH_RECORD); val input = call.receive<CashPayment>()
                        call.respond(withContext(Dispatchers.IO) { call.tenant().checkout.payCash(call.parameters["id"]!!, input, call.principal().staff.id) })
                    }
                    get("/reports/today") {
                        call.require(Permission.REPORTS_READ)
                        call.respond(withContext(Dispatchers.IO) { call.tenant().checkout.today() })
                    }
                }
            }
        }.start(wait = true)
    } finally { tenants.close() }
}
private fun ApplicationCall.tenant(): TenantRuntime = attributes[tenantKey]
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
