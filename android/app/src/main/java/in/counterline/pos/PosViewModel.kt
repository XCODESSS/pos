package `in`.counterline.pos

import android.app.Application
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.viewModelScope
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import kotlinx.serialization.encodeToString
import java.util.UUID

class PosViewModel(application: Application) : AndroidViewModel(application) {
    private val api = PosApi()
    private val preferences = application.getSharedPreferences("checkout", 0)
    var base by mutableStateOf("http://10.0.2.2:8080")
    var username by mutableStateOf("")
    var password by mutableStateOf("")
    private var token = ""
    var displayName by mutableStateOf(""); private set
    var connected by mutableStateOf(false); private set
    var busy by mutableStateOf(false); private set
    var error by mutableStateOf<String?>(null); private set
    var menu by mutableStateOf(emptyList<MenuItem>()); private set
    var cart by mutableStateOf(emptyMap<String, Int>()); private set
    var order by mutableStateOf<Order?>(null); private set
    var report by mutableStateOf<SalesReport?>(null); private set
    var pending by mutableStateOf<CreateOrder?>(null); private set
    val locked get() = busy || order != null || pending != null
    val subtotal get() = menu.sumOf { it.pricePaise * (cart[it.id] ?: 0) }

    fun connect() = perform {
        // Never send a retained checkout to a different backend by accident.
        val savedBase = preferences.getString("base", null)
        require(savedBase == null || savedBase == base.trimEnd('/')) { "Restore the original server URL to recover this bill." }
        val session = api.post<StaffSession>(base, "", "/auth/login", LoginRequest(username, password))
        token = session.accessToken; password = ""
        if ("ORDERS_WRITE" !in session.permissions) {
            try { api.post<StatusResponse>(base, token, "/auth/logout", EmptyRequest()) } finally { token = "" }
            throw IllegalStateException("This role cannot use the native counter. Use its authorized web workspace.")
        }
        displayName = session.staff.displayName
        val fresh = api.get<List<MenuItem>>(base, token, "/menu")
        menu = fresh + menu.filter { cart.containsKey(it.id) && fresh.none { item -> item.id == it.id } }.map { it.copy(available = false) }
        val saved = preferences.getString("pending", null)
        val current = preferences.getString("current", null)
        if (saved != null) {
            pending = api.json.decodeFromString<CreateOrder>(saved)
            create(pending!!)
        } else if (current != null) order = api.get(base, token, "/orders/$current")
        connected = true
        report = api.get(base, token, "/reports/today")
    }
    fun change(id: String, delta: Int) {
        if (locked || (delta > 0 && menu.find { it.id == id }?.available == false)) return
        val next = ((cart[id] ?: 0) + delta).coerceIn(0, 99)
        cart = if (next == 0) cart - id else cart + (id to next)
    }
    fun checkout() = perform {
        val request = pending ?: CreateOrder(UUID.randomUUID().toString(), cart.map { CartLine(it.key, it.value) })
        require(request.lines.isNotEmpty()) { "Add a menu item first." }
        withContext(Dispatchers.IO) {
            check(preferences.edit().putString("pending", api.json.encodeToString(request))
                .putString("base", base.trimEnd('/')).commit()) { "Could not retain checkout ID. No order submitted." }
        }
        pending = request
        create(request)
    }
    private suspend fun create(request: CreateOrder) {
        val result = try { api.post<Order>(base, token, "/orders", request) }
        catch (failure: RequestFailed) {
            if (failure.status == 400) {
                withContext(Dispatchers.IO) { check(preferences.edit().remove("pending").remove("base").commit()) }
                pending = null
            }
            throw failure
        }
        withContext(Dispatchers.IO) {
            check(preferences.edit().putString("current", result.bill.id).remove("pending").commit())
        }
        pending = null; order = result
    }
    fun pay() = perform {
        val current = requireNotNull(order)
        order = api.post(base, token, "/orders/${current.bill.id}/cash-payment", CashPayment(current.bill.totalPaise))
        report = api.get(base, token, "/reports/today")
    }
    fun newSale() = perform {
        require(order?.status == "PAID") { "Settle this bill first." }
        withContext(Dispatchers.IO) { check(preferences.edit().clear().commit()) }
        order = null; cart = emptyMap()
    }
    fun signOut() = perform {
        try { api.post<StatusResponse>(base, token, "/auth/logout", EmptyRequest()) }
        finally { token = ""; password = ""; connected = false; report = null; order = null; cart = emptyMap(); menu = emptyList() }
    }
    private fun perform(action: suspend () -> Unit) {
        if (busy) return
        busy = true; error = null
        viewModelScope.launch {
            try { action() }
            catch (failure: CancellationException) { throw failure }
            catch (failure: RequestFailed) {
                if (failure.status == 401) { token = ""; connected = false }
                error = failure.message
            }
            catch (failure: Exception) { error = failure.message ?: "Connection failed. Retry the same bill." }
            finally { busy = false }
        }
    }
    override fun onCleared() { api.close() }
}
