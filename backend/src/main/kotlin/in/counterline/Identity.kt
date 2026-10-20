package `in`.counterline

import kotlinx.serialization.Serializable
import java.security.MessageDigest
import java.security.SecureRandom
import java.sql.Connection
import java.sql.ResultSet
import java.sql.SQLException
import java.time.Instant
import java.time.temporal.ChronoUnit
import java.util.Base64
import java.util.UUID
import javax.crypto.SecretKeyFactory
import javax.crypto.spec.PBEKeySpec
import javax.sql.DataSource

enum class Permission { MENU_READ, MENU_MANAGE, ORDERS_READ, ORDERS_WRITE, CASH_RECORD, KITCHEN_READ, KITCHEN_WRITE, REPORTS_READ, STAFF_MANAGE, TABLES_MANAGE, STOCK_READ, STOCK_MANAGE, PAYABLES_READ, PAYABLES_MANAGE }
@Serializable enum class StaffRole {
    OWNER, MANAGER, CASHIER, KITCHEN;
    fun permissions(): Set<Permission> = when (this) {
        OWNER -> Permission.entries.toSet()
        MANAGER -> setOf(Permission.MENU_READ, Permission.MENU_MANAGE, Permission.ORDERS_READ, Permission.ORDERS_WRITE, Permission.CASH_RECORD, Permission.KITCHEN_READ, Permission.KITCHEN_WRITE, Permission.REPORTS_READ, Permission.TABLES_MANAGE, Permission.STOCK_READ, Permission.STOCK_MANAGE, Permission.PAYABLES_READ, Permission.PAYABLES_MANAGE)
        CASHIER -> setOf(Permission.MENU_READ, Permission.ORDERS_READ, Permission.ORDERS_WRITE, Permission.CASH_RECORD, Permission.KITCHEN_READ, Permission.REPORTS_READ)
        KITCHEN -> setOf(Permission.KITCHEN_READ, Permission.KITCHEN_WRITE)
    }
}
@Serializable data class StaffMember(val id: String, val username: String, val displayName: String, val role: StaffRole, val active: Boolean, val version: Long) {
    val permissions: List<String> get() = role.permissions().map { it.name }
}
@Serializable data class LoginRequest(val username: String, val password: String)
@Serializable data class SessionResponse(val accessToken: String, val expiresAt: String, val staff: StaffMember, val permissions: List<String>)
@Serializable data class StaffCreate(val id: String, val username: String, val displayName: String, val role: StaffRole, val password: String)
@Serializable data class StaffChange(val displayName: String, val role: StaffRole, val active: Boolean, val expectedVersion: Long)
@Serializable data class PasswordChange(val currentPassword: String, val newPassword: String)
@Serializable data class PasswordReset(val newPassword: String, val expectedVersion: Long)
data class StaffPrincipal(val staff: StaffMember, val tokenHash: ByteArray) {
    fun require(permission: Permission) {
        if (permission !in staff.role.permissions()) throw Problem(403, "forbidden", "Your staff role does not allow this action.")
    }
}

/** Individual identity, persisted opaque sessions, immediate revocation and owner administration. */
class Identity(private val source: DataSource) {
    private val random = SecureRandom()
    private val passwordWorkers = java.util.concurrent.Semaphore(4)
    private val dummyHash = hashPassword("dummy-not-a-real-account-password")
    private val usernames = Regex("[a-z][a-z0-9._-]{2,31}")

    fun bootstrap(username: String?, password: String?) = databaseTransaction(source) { connection ->
        adminLock(connection)
        val count = connection.createStatement().use { it.executeQuery("SELECT COUNT(*) FROM staff").use { rows -> rows.next(); rows.getLong(1) } }
        if (count == 0L) {
            val login = username?.trim()?.lowercase() ?: error("Set OWNER_USERNAME for initial owner setup.")
            checkInput(usernames.matches(login), "Owner username must be 3–32 lowercase login characters, starting with a letter.")
            require(password != "replace-with-a-unique-random-password-at-least-12-characters") { "Replace the OWNER_PASSWORD example placeholder before initial setup." }
            validatePassword(password ?: error("Set OWNER_PASSWORD for initial owner setup."))
            val id = UUID.randomUUID()
            connection.prepareStatement("INSERT INTO staff(id, username, display_name, role, password_hash) VALUES (?, ?, 'Owner', 'OWNER', ?)").use {
                it.setObject(1, id); it.setString(2, login); it.setString(3, hashPassword(password!!)); it.executeUpdate()
            }
            audit(connection, id.toString(), "OWNER_BOOTSTRAPPED", id.toString())
        } else {
            val owners = connection.createStatement().use { it.executeQuery("SELECT COUNT(*) FROM staff WHERE active AND role = 'OWNER'").use { rows -> rows.next(); rows.getLong(1) } }
            check(owners > 0) { "No active owner exists; restore the database rather than silently resetting credentials." }
        }
    }

    fun login(input: LoginRequest, sourceAddress: String): SessionResponse {
        val username = input.username.trim().lowercase()
        permitLogin(username.take(128), sourceAddress)
        val validInput = usernames.matches(username) && input.password.length in 12..128
        val account = source.connection.use { connection ->
            connection.prepareStatement("SELECT * FROM staff WHERE username = ?").use {
                it.setString(1, username.take(128)); it.executeQuery().use { rows -> if (rows.next()) member(rows) to rows.getString("password_hash") else null }
            }
        }
        val supplied = if (validInput) input.password else "invalid-input-not-a-password"
        val matches = verifyPassword(supplied, account?.second ?: dummyHash)
        if (!validInput || account == null || !account.first.active || !matches)
            throw Problem(401, "invalid_credentials", "Invalid username or password.")
        val token = Base64.getUrlEncoder().withoutPadding().encodeToString(ByteArray(32).also(random::nextBytes))
        val expires = Instant.now().plus(8, ChronoUnit.HOURS).truncatedTo(ChronoUnit.MILLIS)
        return databaseTransaction(source) { connection ->
            // Password/disable changes racing a slow password hash cannot issue a new session.
            val current = connection.prepareStatement("SELECT * FROM staff WHERE id = ? FOR UPDATE").use {
                it.setObject(1, UUID.fromString(account.first.id)); it.executeQuery().use { rows ->
                    if (!rows.next() || !rows.getBoolean("active") || rows.getString("password_hash") != account.second)
                        throw Problem(401, "invalid_credentials", "Invalid username or password.")
                    member(rows)
                }
            }
            connection.prepareStatement("DELETE FROM staff_sessions WHERE expires_at <= CURRENT_TIMESTAMP").use { it.executeUpdate() }
            connection.prepareStatement("INSERT INTO staff_sessions(token_hash, staff_id, expires_at) VALUES (?, ?, ?)").use {
                it.setBytes(1, digest(token)); it.setObject(2, UUID.fromString(current.id)); it.setObject(3, expires.atOffset(java.time.ZoneOffset.UTC)); it.executeUpdate()
            }
            audit(connection, current.id, "SIGNED_IN", current.id)
            SessionResponse(token, expires.toString(), current, current.permissions)
        }
    }

    fun authenticate(header: String?): StaffPrincipal {
        val token = header?.takeIf { it.startsWith("Bearer ", ignoreCase = true) }?.substring(7)
        if (token == null || !Regex("[A-Za-z0-9_-]{43}").matches(token)) unauthorized()
        val hash = digest(token)
        return source.connection.use { connection ->
            connection.prepareStatement("""
                SELECT s.* FROM staff s JOIN staff_sessions t ON t.staff_id = s.id
                WHERE t.token_hash = ? AND t.expires_at > CURRENT_TIMESTAMP AND s.active
            """.trimIndent()).use {
                it.setBytes(1, hash)
                it.executeQuery().use { rows -> if (rows.next()) StaffPrincipal(member(rows), hash) else unauthorized() }
            }
        }
    }

    fun logout(principal: StaffPrincipal) = databaseTransaction(source) { connection ->
        connection.prepareStatement("DELETE FROM staff_sessions WHERE token_hash = ?").use { it.setBytes(1, principal.tokenHash); it.executeUpdate() }
        audit(connection, principal.staff.id, "SIGNED_OUT", principal.staff.id)
    }

    fun list(principal: StaffPrincipal): List<StaffMember> {
        principal.require(Permission.STAFF_MANAGE)
        return source.connection.use { connection -> connection.createStatement().use {
            it.executeQuery("SELECT * FROM staff ORDER BY username").use { rows -> buildList { while (rows.next()) add(member(rows)) } }
        } }
    }

    fun create(principal: StaffPrincipal, request: StaffCreate): StaffMember {
        principal.require(Permission.STAFF_MANAGE)
        val id = parseId(request.id)
        val username = request.username.trim().lowercase()
        val name = validateName(request.displayName)
        checkInput(usernames.matches(username), "Username must be 3–32 login characters, starting with a letter.")
        validatePassword(request.password)
        val encoded = hashPassword(request.password)
        try { return databaseTransaction(source) { connection ->
            requireOwner(connection, principal)
            find(connection, id)?.let { existing ->
                val samePassword = connection.prepareStatement("SELECT password_hash FROM staff WHERE id = ?").use {
                    it.setObject(1, id); it.executeQuery().use { rows -> rows.next(); verifyPassword(request.password, rows.getString(1)) }
                }
                if (existing.username != username || existing.displayName != name || existing.role != request.role || !samePassword)
                    throw Problem(409, "staff_conflict", "This staff ID already belongs to a different account or has since changed.")
                return@databaseTransaction existing
            }
            val count = connection.createStatement().use { it.executeQuery("SELECT COUNT(*) FROM staff").use { rows -> rows.next(); rows.getInt(1) } }
            checkInput(count < 100, "This development outlet supports at most 100 staff accounts.")
            connection.prepareStatement("INSERT INTO staff(id, username, display_name, role, password_hash) VALUES (?, ?, ?, ?, ?)").use {
                it.setObject(1, id); it.setString(2, username); it.setString(3, name); it.setString(4, request.role.name); it.setString(5, encoded); it.executeUpdate()
            }
            audit(connection, principal.staff.id, "STAFF_CREATED", id.toString())
            find(connection, id)!!
        } } catch (failure: SQLException) {
            if (failure.sqlState == "23505") throw Problem(409, "username_taken", "This username is already in use.")
            throw failure
        }
    }

    fun change(principal: StaffPrincipal, id: String, request: StaffChange): StaffMember = databaseTransaction(source) { connection ->
        requireOwner(connection, principal)
        val uuid = parseId(id)
        val old = find(connection, uuid) ?: throw Problem(404, "staff_not_found", "Staff account not found.")
        val name = validateName(request.displayName)
        checkInput(request.expectedVersion in 0 until Long.MAX_VALUE, "Invalid account version.")
        if (old.id == principal.staff.id && (request.role != StaffRole.OWNER || !request.active))
            throw Problem(409, "owner_self_change", "You cannot disable or demote your own owner account.")
        if (old.version == request.expectedVersion + 1 && old.displayName == name && old.role == request.role && old.active == request.active)
            return@databaseTransaction old
        if (old.version != request.expectedVersion) throw Problem(409, "stale_staff", "Account changed elsewhere. Refresh before editing.")
        connection.prepareStatement("UPDATE staff SET display_name = ?, role = ?, active = ?, version = version + 1 WHERE id = ?").use {
            it.setString(1, name); it.setString(2, request.role.name); it.setBoolean(3, request.active); it.setObject(4, uuid); it.executeUpdate()
        }
        revoke(connection, uuid)
        audit(connection, principal.staff.id, "STAFF_UPDATED", id)
        find(connection, uuid)!!
    }

    fun changePassword(principal: StaffPrincipal, input: PasswordChange) = databaseTransaction(source) { connection ->
        validatePassword(input.newPassword)
        checkInput(input.currentPassword.length <= 128, "Current password is invalid.")
        val id = UUID.fromString(principal.staff.id)
        val oldHash = connection.prepareStatement("SELECT password_hash FROM staff WHERE id = ? AND active FOR UPDATE").use {
            it.setObject(1, id); it.executeQuery().use { rows -> if (rows.next()) rows.getString(1) else unauthorized() }
        }
        if (!verifyPassword(input.currentPassword, oldHash)) throw Problem(400, "wrong_password", "Current password is incorrect.")
        setPassword(connection, id, input.newPassword)
        audit(connection, principal.staff.id, "PASSWORD_CHANGED", id.toString())
    }

    fun resetPassword(principal: StaffPrincipal, id: String, input: PasswordReset) = databaseTransaction(source) { connection ->
        requireOwner(connection, principal)
        val uuid = parseId(id)
        if (uuid == UUID.fromString(principal.staff.id)) throw Problem(400, "use_password_change", "Use your own password-change screen for your account.")
        val current = find(connection, uuid, lock = true) ?: throw Problem(404, "staff_not_found", "Staff account not found.")
        validatePassword(input.newPassword)
        checkInput(input.expectedVersion in 0 until Long.MAX_VALUE, "Invalid account version.")
        if (current.version == input.expectedVersion + 1) {
            val matches = connection.prepareStatement("SELECT password_hash FROM staff WHERE id = ?").use {
                it.setObject(1, uuid); it.executeQuery().use { rows -> rows.next(); verifyPassword(input.newPassword, rows.getString(1)) }
            }
            if (matches) return@databaseTransaction
        }
        if (current.version != input.expectedVersion) throw Problem(409, "stale_staff", "Account changed elsewhere. Refresh before resetting its password.")
        setPassword(connection, uuid, input.newPassword)
        audit(connection, principal.staff.id, "PASSWORD_RESET", id)
    }

    private fun setPassword(connection: Connection, id: UUID, password: String) {
        connection.prepareStatement("UPDATE staff SET password_hash = ?, version = version + 1 WHERE id = ?").use {
            it.setString(1, hashPassword(password)); it.setObject(2, id); it.executeUpdate()
        }
        revoke(connection, id)
    }
    private fun revoke(connection: Connection, id: UUID) {
        connection.prepareStatement("DELETE FROM staff_sessions WHERE staff_id = ?").use { it.setObject(1, id); it.executeUpdate() }
    }
    private fun requireOwner(connection: Connection, principal: StaffPrincipal) {
        principal.require(Permission.STAFF_MANAGE); adminLock(connection)
        val current = find(connection, UUID.fromString(principal.staff.id))
        if (current?.active != true || current.role != StaffRole.OWNER) unauthorized()
    }
    private fun adminLock(connection: Connection) { connection.createStatement().use { it.execute("SELECT pg_advisory_xact_lock(420271)") } }
    private fun find(connection: Connection, id: UUID, lock: Boolean = false): StaffMember? = connection.prepareStatement("SELECT * FROM staff WHERE id = ?${if (lock) " FOR UPDATE" else ""}").use {
        it.setObject(1, id); it.executeQuery().use { rows -> if (rows.next()) member(rows) else null }
    }
    private fun member(rows: ResultSet) = StaffMember(rows.getObject("id").toString(), rows.getString("username"), rows.getString("display_name"), StaffRole.valueOf(rows.getString("role")), rows.getBoolean("active"), rows.getLong("version"))
    private fun permitLogin(username: String, address: String) = source.connection.use { connection ->
        connection.prepareStatement("DELETE FROM login_buckets WHERE window_started < CURRENT_TIMESTAMP - INTERVAL '24 hours'").use { it.executeUpdate() }
        for ((key, maximum) in listOf("source:$address" to 200, "user:$username" to 30)) {
            val count = connection.prepareStatement("""
                INSERT INTO login_buckets(key, window_started, attempts) VALUES (?, CURRENT_TIMESTAMP, 1)
                ON CONFLICT(key) DO UPDATE SET
                  attempts = CASE WHEN login_buckets.window_started <= CURRENT_TIMESTAMP - INTERVAL '15 minutes' THEN 1 ELSE LEAST(login_buckets.attempts + 1, 10000) END,
                  window_started = CASE WHEN login_buckets.window_started <= CURRENT_TIMESTAMP - INTERVAL '15 minutes' THEN CURRENT_TIMESTAMP ELSE login_buckets.window_started END
                RETURNING attempts
            """.trimIndent()).use {
                it.setString(1, Base64.getEncoder().encodeToString(digest(key)))
                it.executeQuery().use { rows -> rows.next(); rows.getInt(1) }
            }
            if (count > maximum) throw Problem(429, "login_rate_limited", "Too many sign-in attempts. Try again after the 15-minute window.")
        }
    }
    private fun validateName(name: String): String = name.trim().also { checkInput(it.length in 1..80 && it.none(Char::isISOControl), "Display name must contain 1–80 printable characters.") }
    private fun validatePassword(password: String) { checkInput(password.length in 12..128 && password.isNotBlank(), "Password must contain 12–128 characters.") }
    private fun parseId(id: String): UUID = try { UUID.fromString(id).also { checkInput(it.toString() == id.lowercase(), "Use a canonical UUID.") } } catch (_: IllegalArgumentException) { throw Problem(400, "invalid_id", "Invalid staff UUID.") }
    private fun unauthorized(): Nothing = throw Problem(401, "unauthorized", "Sign in with an active staff account.")
    private fun digest(value: String): ByteArray = MessageDigest.getInstance("SHA-256").digest(value.toByteArray(Charsets.UTF_8))
    private fun hashPassword(password: String): String {
        val salt = ByteArray(16).also(random::nextBytes)
        val hash = derive(password, salt)
        return "pbkdf2-sha256:600000:${Base64.getEncoder().encodeToString(salt)}:${Base64.getEncoder().encodeToString(hash)}"
    }
    private fun verifyPassword(password: String, encoded: String): Boolean {
        val parts = encoded.split(':')
        check(parts.size == 4 && parts[0] == "pbkdf2-sha256" && parts[1] == "600000") { "Unsupported password encoding" }
        return MessageDigest.isEqual(derive(password, Base64.getDecoder().decode(parts[2])), Base64.getDecoder().decode(parts[3]))
    }
    private fun derive(password: String, salt: ByteArray): ByteArray {
        if (!passwordWorkers.tryAcquire()) throw Problem(429, "authentication_busy", "Authentication is temporarily busy. Try again shortly.")
        val spec = PBEKeySpec(password.toCharArray(), salt, 600000, 256)
        return try { SecretKeyFactory.getInstance("PBKDF2WithHmacSHA256").generateSecret(spec).encoded }
        finally { spec.clearPassword(); passwordWorkers.release() }
    }
}
