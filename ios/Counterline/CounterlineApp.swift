import SwiftUI

@main
struct CounterlineApp: App {
    var body: some Scene { WindowGroup { CounterView() } }
}

struct CounterView: View {
    @StateObject private var model = PosModel()
    var body: some View {
        NavigationStack {
            VStack(alignment: .leading, spacing: 16) {
                Text("Online staff POS · Demo kitchen").font(.caption).foregroundStyle(.secondary)
                if let error = model.error { Text(error).foregroundStyle(.red).font(.callout).accessibilityAddTraits(.updatesFrequently) }
                if model.busy { ProgressView().frame(maxWidth: .infinity) }
                if !model.connected {
                    TextField("Backend URL", text: $model.server).textInputAutocapitalization(.never).autocorrectionDisabled().keyboardType(.URL)
                    TextField("Username", text: $model.username).textInputAutocapitalization(.never).autocorrectionDisabled().textContentType(.username)
                    SecureField("Password", text: $model.password).textContentType(.password).textInputAutocapitalization(.never).autocorrectionDisabled()
                    Button("Sign in", action: model.connect).buttonStyle(.borderedProminent).disabled(model.busy || model.username.isEmpty || model.password.isEmpty)
                    Text("Simulator: localhost reaches your Mac. Session credentials stay in memory.").font(.caption).foregroundStyle(.secondary)
                    Spacer()
                } else {
                    HStack {
                        Text(model.displayName).font(.caption)
                        Spacer()
                        Button("Sign out", action: model.signOut).disabled(model.busy || (!model.cart.isEmpty && model.order == nil && model.pending == nil))
                    }
                    if let report = model.report {
                        Text("\(report.date) · \(report.paidOrders) paid bills · \(money(report.totalPaise))").font(.caption)
                    }
                    if let order = model.order {
                        Text(order.bill.billNumber).font(.title2.bold())
                        Text("Takeaway · \(order.status)").font(.subheadline)
                        List {
                            if let stock = order.inventory {
                                if !stock.warnings.isEmpty || !stock.missingRecipes.isEmpty {
                                    Text("Stock at submission · warnings do not block ordering").foregroundStyle(.orange)
                                }
                                ForEach(stock.warnings) { warning in
                                    Text("\(warning.name): needs \(stockQuantity(warning.requiredMilli, warning.unit)), available \(stockQuantity(warning.availableMilli, warning.unit)), shortage \(stockQuantity(warning.shortageMilli, warning.unit)).").font(.caption)
                                }
                                if !stock.missingRecipes.isEmpty {
                                    Text("Recipe coverage missing: " + stock.missingRecipes.map { $0.label }.joined(separator: "; ")).font(.caption)
                                }
                            }
                            ForEach(order.bill.lines) { line in
                                HStack {
                                    VStack(alignment: .leading) { Text(line.name); Text("Quantity: \(line.quantity)").font(.caption).foregroundStyle(.secondary) }
                                    Spacer(); Text(money(line.subtotalPaise))
                                }
                            }
                        }.listStyle(.plain)
                        LabeledContent("Subtotal", value: money(order.bill.subtotalPaise))
                        LabeledContent("CGST", value: money(order.bill.cgstPaise))
                        LabeledContent("SGST", value: money(order.bill.sgstPaise))
                        LabeledContent("Total", value: money(order.bill.totalPaise)).font(.title3.bold())
                        if order.status == "PAID" {
                            Button("Cash recorded · Next sale", action: model.newSale).buttonStyle(.borderedProminent).disabled(model.busy)
                        } else {
                            Button("Confirm exact cash received", action: model.pay).buttonStyle(.borderedProminent).disabled(model.busy)
                        }
                        Text("Order ID: \(order.bill.id)").font(.caption2).textSelection(.enabled)
                    } else {
                        Text("Takeaway menu").font(.title2.bold())
                        List(model.menu) { item in
                            HStack {
                                VStack(alignment: .leading) { Text(item.name); Text("\(item.category) · \(money(item.pricePaise))\(item.available ? "" : " · Unavailable")").font(.caption).foregroundStyle(.secondary) }
                                Spacer()
                                Button { model.change(item.id, by: -1) } label: { Image(systemName: "minus.circle") }
                                    .accessibilityLabel("Remove one \(item.name)").disabled(model.locked || model.cart[item.id, default: 0] == 0)
                                Text("\(model.cart[item.id, default: 0])").monospacedDigit()
                                Button { model.change(item.id, by: 1) } label: { Image(systemName: "plus.circle.fill") }
                                    .accessibilityLabel("Add one \(item.name)").disabled(model.locked || !item.available || model.cart[item.id, default: 0] >= 99)
                            }.buttonStyle(.borderless)
                        }.listStyle(.plain)
                        Text("Subtotal before tax: \(money(model.subtotal))").font(.headline)
                        if model.pending != nil { Text("Checkout ID retained. Retry the same bill to avoid duplicates.").font(.caption) }
                        Button(model.pending == nil ? "Create bill" : "Retry same bill", action: model.checkout)
                            .buttonStyle(.borderedProminent).disabled(model.busy || (model.cart.isEmpty && model.pending == nil))
                    }
                }
                Text("DEMO ONLY · Not a GST tax invoice\nOffline mode is not implemented.").font(.caption2).foregroundStyle(.secondary)
            }
            .padding().navigationTitle("Counterline").tint(Color(red: 0.15, green: 0.31, blue: 0.25))
        }
    }
}
