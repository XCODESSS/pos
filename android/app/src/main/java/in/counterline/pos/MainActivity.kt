package `in`.counterline.pos

import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import androidx.lifecycle.viewmodel.compose.viewModel

class MainActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContent {
            MaterialTheme(colorScheme = lightColorScheme(primary = Color(0xFF254F3F), background = Color(0xFFF5F6F1))) {
                Surface(Modifier.fillMaxSize()) { Counter(viewModel()) }
            }
        }
    }
}

@Composable
private fun Counter(model: PosViewModel) {
    Column(Modifier.fillMaxSize().safeDrawingPadding().padding(20.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
        Text("Counterline", style = MaterialTheme.typography.headlineMedium)
        Text("Online staff POS · Demo kitchen", style = MaterialTheme.typography.labelMedium)
        model.error?.let { Text(it, color = MaterialTheme.colorScheme.error) }
        if (model.busy) LinearProgressIndicator(Modifier.fillMaxWidth())
        if (!model.connected) {
            OutlinedTextField(model.base, { model.base = it }, label = { Text("Server URL") }, keyboardOptions = KeyboardOptions(autoCorrectEnabled = false, keyboardType = KeyboardType.Uri), enabled = !model.busy, singleLine = true, modifier = Modifier.fillMaxWidth())
            OutlinedTextField(model.username, { model.username = it }, label = { Text("Username") }, keyboardOptions = KeyboardOptions(autoCorrectEnabled = false, keyboardType = KeyboardType.Ascii), enabled = !model.busy, singleLine = true, modifier = Modifier.fillMaxWidth())
            OutlinedTextField(model.password, { model.password = it }, label = { Text("Password") }, visualTransformation = PasswordVisualTransformation(), keyboardOptions = KeyboardOptions(autoCorrectEnabled = false, keyboardType = KeyboardType.Password), enabled = !model.busy, singleLine = true, modifier = Modifier.fillMaxWidth())
            Button(onClick = { model.connect() }, enabled = !model.busy && model.username.isNotBlank() && model.password.isNotEmpty()) { Text("Sign in") }
            Text("Android emulator: 10.0.2.2 reaches your computer. Session credentials stay in memory.")
        } else {
            Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
                Text(model.displayName)
                TextButton(onClick = { model.signOut() }, enabled = !model.busy && (model.cart.isEmpty() || model.order != null || model.pending != null)) { Text("Sign out") }
            }
            model.report?.let { Text("${it.date} · ${it.paidOrders} paid bills · ${money(it.totalPaise)}", style = MaterialTheme.typography.labelLarge) }
            val order = model.order
            if (order != null) {
                Text(order.bill.billNumber, style = MaterialTheme.typography.titleLarge)
                Text("Takeaway · ${order.status}")
                LazyColumn(Modifier.weight(1f)) {
                    items(order.bill.lines, key = { it.itemId }) { line ->
                        ListItem(headlineContent = { Text(line.name) }, supportingContent = { Text("Quantity: ${line.quantity}") }, trailingContent = { Text(money(line.subtotalPaise)) })
                    }
                }
                Text("Subtotal: ${money(order.bill.subtotalPaise)}")
                Text("CGST: ${money(order.bill.cgstPaise)} · SGST: ${money(order.bill.sgstPaise)}")
                Text("Total: ${money(order.bill.totalPaise)}", style = MaterialTheme.typography.titleLarge)
                if (order.status == "PAID") Button(onClick = { model.newSale() }, enabled = !model.busy, modifier = Modifier.fillMaxWidth()) { Text("Cash recorded · Next sale") }
                else Button(onClick = { model.pay() }, enabled = !model.busy, modifier = Modifier.fillMaxWidth()) { Text("Confirm exact cash received") }
                Text("Order ID: ${order.bill.id}", style = MaterialTheme.typography.labelSmall)
            } else {
                Text("Takeaway menu", style = MaterialTheme.typography.titleLarge)
                LazyColumn(Modifier.weight(1f)) {
                    items(model.menu, key = { it.id }) { item ->
                        ListItem(headlineContent = { Text(item.name) }, supportingContent = { Text("${item.category} · ${money(item.pricePaise)}${if (!item.available) " · Unavailable" else ""}") }, trailingContent = {
                            Row {
                                TextButton(onClick = { model.change(item.id, -1) }, enabled = !model.locked && (model.cart[item.id] ?: 0) > 0) { Text("−") }
                                Text("${model.cart[item.id] ?: 0}", Modifier.padding(top = 15.dp))
                                TextButton(onClick = { model.change(item.id, 1) }, enabled = !model.locked && item.available && (model.cart[item.id] ?: 0) < 99) { Text("+") }
                            }
                        })
                    }
                }
                Text("Subtotal before tax: ${money(model.subtotal)}")
                if (model.pending != null) Text("Checkout ID retained. Retry the same bill to avoid duplicates.")
                Button(onClick = { model.checkout() }, enabled = !model.busy && (model.cart.isNotEmpty() || model.pending != null), modifier = Modifier.fillMaxWidth()) { Text(if (model.pending != null) "Retry same bill" else "Create bill") }
            }
        }
        Text("DEMO ONLY · Not a GST tax invoice · Offline mode not implemented", style = MaterialTheme.typography.labelSmall)
    }
}
