import Foundation

struct MenuItem: Decodable, Identifiable {
    let id: String
    let name: String
    let category: String
    let pricePaise: Int64
    let available: Bool
}
struct LoginRequest: Encodable { let username: String; let password: String }
struct StaffProfile: Decodable { let displayName: String; let username: String; let role: String }
struct StaffSession: Decodable { let accessToken: String; let staff: StaffProfile; let permissions: [String] }
struct StatusResponse: Decodable { let status: String }
struct CartLine: Codable { let itemId: String; let quantity: Int }
struct CreateOrder: Codable {
    let id: String
    let lines: [CartLine]
    let orderType: String
}
struct BillLine: Decodable, Identifiable {
    let itemId: String
    let name: String
    let quantity: Int
    let subtotalPaise: Int64
    var id: String { itemId }
}
struct Bill: Decodable {
    let id: String
    let billNumber: String
    let lines: [BillLine]
    let subtotalPaise: Int64
    let cgstPaise: Int64
    let sgstPaise: Int64
    let totalPaise: Int64
}
struct StockWarning: Decodable, Identifiable {
    let ingredientId: String; let name: String; let unit: String
    let requiredMilli: Int64; let availableMilli: Int64; let shortageMilli: Int64
    var id: String { ingredientId }
}
struct RecipeGap: Decodable { let label: String }
struct StockSnapshot: Decodable { let warnings: [StockWarning]; let missingRecipes: [RecipeGap] }
struct Order: Decodable { let bill: Bill; let status: String; let inventory: StockSnapshot? }
struct CashPayment: Codable { let receivedPaise: Int64; let cashShiftId: String }
struct ActiveCashShift: Decodable { let id: String }
struct CashActive: Decodable { let shift: ActiveCashShift? }
struct SalesReport: Decodable { let date: String; let paidOrders: Int; let totalPaise: Int64 }
struct APIErrorBody: Decodable { let message: String }
struct RequestFailure: LocalizedError {
    let status: Int
    let message: String
    var errorDescription: String? { message }
}

struct PosAPI {
    let base: String
    let token: String
    func get<T: Decodable>(_ path: String) async throws -> T {
        try await send(path, body: nil)
    }
    func post<T: Decodable, Body: Encodable>(_ path: String, body: Body) async throws -> T {
        try await send(path, body: JSONEncoder().encode(body))
    }
    private func send<T: Decodable>(_ path: String, body: Data?) async throws -> T {
        guard let root = URL(string: base), let scheme = root.scheme,
              ["http", "https"].contains(scheme), root.host != nil,
              root.user == nil, root.password == nil, root.query == nil, root.fragment == nil,
              let url = URL(string: base + "/api" + path) else {
            throw RequestFailure(status: 0, message: "Enter a valid HTTP(S) backend URL without credentials or query parameters.")
        }
        #if !DEBUG
        guard scheme == "https" else {
            throw RequestFailure(status: 0, message: "Release builds require an HTTPS backend.")
        }
        #endif
        var request = URLRequest(url: url, timeoutInterval: 15)
        if !token.isEmpty { request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization") }
        if let body {
            request.httpMethod = "POST"
            request.setValue("application/json", forHTTPHeaderField: "Content-Type")
            request.httpBody = body
        }
        let (data, response) = try await URLSession.shared.data(for: request)
        guard let response = response as? HTTPURLResponse else { throw URLError(.badServerResponse) }
        guard (200..<300).contains(response.statusCode) else {
            let detail = try? JSONDecoder().decode(APIErrorBody.self, from: data)
            throw RequestFailure(status: response.statusCode, message: detail?.message ?? "Server request failed.")
        }
        return try JSONDecoder().decode(T.self, from: data)
    }
}

func stockQuantity(_ milli: Int64, _ unit: String) -> String {
    let amount = NSDecimalNumber(decimal: Decimal(milli) / 1000).stringValue
    return "\(amount) \(unit.lowercased())"
}

func money(_ paise: Int64) -> String {
    let formatter = NumberFormatter()
    formatter.numberStyle = .currency
    formatter.locale = Locale(identifier: "en_IN")
    formatter.currencyCode = "INR"
    return formatter.string(from: NSDecimalNumber(decimal: Decimal(paise) / 100)) ?? "INR —"
}
