import Foundation
import SwiftUI

private struct CheckoutJournal: Codable {
    let base: String
    let pending: CreateOrder?
    let currentId: String?
}

@MainActor
final class PosModel: ObservableObject {
    @Published var server = "http://localhost:8080"
    @Published var username = ""
    @Published var password = ""
    @Published private(set) var displayName = ""
    private var token = ""
    @Published private(set) var connected = false
    @Published private(set) var busy = false
    @Published private(set) var error: String?
    @Published private(set) var menu: [MenuItem] = []
    @Published private(set) var cart: [String: Int] = [:]
    @Published private(set) var order: Order?
    @Published private(set) var pending: CreateOrder?
    @Published private(set) var report: SalesReport?
    private var base: String { server.trimmingCharacters(in: CharacterSet(charactersIn: "/ ")) }
    private var api: PosAPI { PosAPI(base: base, token: token) }
    var locked: Bool { busy || order != nil || pending != nil }
    var subtotal: Int64 { menu.reduce(0) { $0 + $1.pricePaise * Int64(cart[$1.id, default: 0]) } }
    private var journalURL: URL {
        FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
            .appendingPathComponent("Counterline/checkout.json")
    }
    private func save(_ journal: CheckoutJournal) throws {
        try FileManager.default.createDirectory(at: journalURL.deletingLastPathComponent(), withIntermediateDirectories: true)
        try JSONEncoder().encode(journal).write(to: journalURL, options: .atomic)
    }
    private func load() throws -> CheckoutJournal? {
        guard FileManager.default.fileExists(atPath: journalURL.path) else { return nil }
        return try JSONDecoder().decode(CheckoutJournal.self, from: Data(contentsOf: journalURL))
    }
    private func clearJournal() throws {
        if FileManager.default.fileExists(atPath: journalURL.path) { try FileManager.default.removeItem(at: journalURL) }
    }
    func connect() { run {
        let journal = try self.load()
        guard journal == nil || journal?.base == self.base else {
            throw RequestFailure(status: 0, message: "Restore the original server URL to recover this bill.")
        }
        let session: StaffSession = try await PosAPI(base: self.base, token: "").post("/auth/login", body: LoginRequest(username: self.username, password: self.password))
        self.token = session.accessToken; self.password = ""
        guard session.permissions.contains("ORDERS_WRITE") else {
            defer { self.token = "" }
            let _: StatusResponse = try await self.api.post("/auth/logout", body: [String: String]())
            throw RequestFailure(status: 403, message: "This role cannot use the native counter. Use its authorized web workspace.")
        }
        self.displayName = session.staff.displayName
        let fresh: [MenuItem] = try await self.api.get("/menu")
        // Retain unavailable cart rows so the user can explicitly remove them.
        self.menu = fresh + self.menu.filter { previous in
            self.cart[previous.id] != nil && !fresh.contains(where: { $0.id == previous.id })
        }.map { MenuItem(id: $0.id, name: $0.name, category: $0.category, pricePaise: $0.pricePaise, available: false) }
        if let saved = journal?.pending {
            self.pending = saved
            try await self.create(saved)
        } else if let id = journal?.currentId { self.order = try await self.api.get("/orders/\(id)") }
        self.connected = true
        self.report = try await self.api.get("/reports/today")
    } }
    func change(_ id: String, by delta: Int) {
        guard !locked, delta <= 0 || menu.first(where: { $0.id == id })?.available == true else { return }
        let count = min(99, max(0, cart[id, default: 0] + delta))
        if count == 0 { cart.removeValue(forKey: id) } else { cart[id] = count }
    }
    func checkout() { run {
        let request = self.pending ?? CreateOrder(id: UUID().uuidString.lowercased(),
            lines: self.cart.map { CartLine(itemId: $0.key, quantity: $0.value) }, orderType: "TAKEAWAY")
        guard !request.lines.isEmpty else { return }
        // Retain the ID before sending. This is online retry recovery, not offline checkout.
        try self.save(CheckoutJournal(base: self.base, pending: request, currentId: nil))
        self.pending = request
        try await self.create(request)
    } }
    private func create(_ request: CreateOrder) async throws {
        let result: Order
        do { result = try await api.post("/orders", body: request) }
        catch let failure as RequestFailure {
            if failure.status == 400 { try clearJournal(); pending = nil }
            throw failure
        }
        try save(CheckoutJournal(base: base, pending: nil, currentId: result.bill.id))
        pending = nil; order = result
    }
    func pay() { run {
        guard let current = self.order else { return }
        self.order = try await self.api.post("/orders/\(current.bill.id)/cash-payment", body: CashPayment(receivedPaise: current.bill.totalPaise))
        self.report = try await self.api.get("/reports/today")
    } }
    func newSale() { run {
        guard self.order?.status == "PAID" else { return }
        try self.clearJournal()
        self.order = nil; self.cart = [:]
    } }
    func signOut() { run {
        defer { self.token = ""; self.password = ""; self.connected = false; self.report = nil; self.order = nil; self.cart = [:]; self.menu = [] }
        let _: StatusResponse = try await self.api.post("/auth/logout", body: [String: String]())
    } }
    private func run(_ action: @escaping @MainActor () async throws -> Void) {
        guard !busy else { return }
        busy = true; error = nil
        Task {
            defer { self.busy = false }
            do { try await action() }
            catch is CancellationError { }
            catch let failure as RequestFailure {
                if failure.status == 401 { self.token = ""; self.connected = false }
                self.error = failure.localizedDescription
            }
            catch { self.error = error.localizedDescription }
        }
    }
}
