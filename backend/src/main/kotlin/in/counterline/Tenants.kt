package `in`.counterline

import com.zaxxer.hikari.HikariConfig
import com.zaxxer.hikari.HikariDataSource
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.Json
import org.flywaydb.core.Flyway
import java.util.UUID

/** Operator-owned allowlist. Never deserialize tenant configuration from HTTP. */
@Serializable
class TenantConfig(
    val id: String, val slug: String, val jdbcUrl: String, val username: String, val password: String,
    val ownerUsername: String? = null, val ownerPassword: String? = null,
)
class TenantRuntime(val id: String, val slug: String, val source: HikariDataSource, json: Json) {
    val inventory = Inventory(source, json)
    val checkout = Checkout(source, json)
    val identity = Identity(source)
    val catalog = Catalog(source, json)
    val frontDesk = FrontDesk(source, json, checkout)
}

/** Each runtime owns its pool/modules. Path selection never changes an existing runtime's database. */
class TenantRegistry private constructor(private val entries: Map<String, TenantRuntime>) : AutoCloseable {
    fun resolve(slug: String?): TenantRuntime = entries[slug]
        ?: throw Problem(404, "tenant_not_found", "Business workspace not found.")
    fun ready(): Boolean = entries.values.all {
        try { it.source.connection.use { connection -> connection.isValid(2) } } catch (_: java.sql.SQLException) { false }
    }
    override fun close() { entries.values.forEach { it.source.close() } }

    companion object {
        fun load(json: Json, environment: AppEnvironment): TenantRegistry {
            val configured = System.getenv("TENANTS_JSON")
            val configs = if (configured != null) {
                try { json.decodeFromString<List<TenantConfig>>(configured) }
                catch (_: Exception) { error("Invalid TENANTS_JSON; check the operator configuration without logging its secret values.") }
            } else {
                require(environment == AppEnvironment.DEVELOPMENT) { "Set an explicit TENANTS_JSON registry outside development." }
                listOf(TenantConfig(
                System.getenv("TENANT_ID") ?: "11111111-1111-4111-8111-111111111111",
                System.getenv("TENANT_SLUG") ?: "demo",
                System.getenv("JDBC_URL") ?: "jdbc:postgresql://127.0.0.1:54329/counterline",
                System.getenv("DB_USER") ?: "counterline", requireNotNull(System.getenv("DB_PASSWORD")) { "Set DB_PASSWORD or TENANTS_JSON." },
                System.getenv("OWNER_USERNAME"), System.getenv("OWNER_PASSWORD"),
            ))
            }
            require(configs.size in 1..32) { "Configure between 1 and 32 tenant databases per application instance." }
            require(configs.map { it.id }.distinct().size == configs.size && configs.map { it.slug }.distinct().size == configs.size) { "Tenant identities and slugs must be unique." }
            require(configs.map { it.jdbcUrl }.distinct().size == configs.size) { "Tenants must not share a database URL." }
            require(configs.map { it.username }.distinct().size == configs.size) { "Configure a distinct database role for each tenant." }
            configs.forEach {
                val canonical = try { UUID.fromString(it.id).toString() } catch (_: IllegalArgumentException) { null }
                require(canonical == it.id && Regex("[a-z][a-z0-9-]{2,62}").matches(it.slug)) { "Use canonical tenant UUIDs and 3–63 character lowercase business slugs." }
                require(it.jdbcUrl.startsWith("jdbc:postgresql://") && !Regex("[?&](user|password)=", RegexOption.IGNORE_CASE).containsMatchIn(it.jdbcUrl)) { "Use a PostgreSQL URL without embedded credential parameters." }
                require(it.username.isNotBlank() && it.password.isNotEmpty()) { "Each tenant needs explicit database credentials." }
            }
            val opened = linkedMapOf<String, TenantRuntime>()
            try {
                configs.forEach { config ->
                    val source = HikariDataSource(HikariConfig().apply {
                        jdbcUrl = config.jdbcUrl; username = config.username; password = config.password
                        poolName = "tenant-${config.slug}"
                        maximumPoolSize = 3; connectionTimeout = 5_000; validationTimeout = 2_000
                        addDataSourceProperty("connectTimeout", 3); addDataSourceProperty("socketTimeout", 10)
                    })
                    try {
                        if (environment != AppEnvironment.DEVELOPMENT) {
                            source.connection.use { connection -> connection.createStatement().use { statement ->
                                statement.executeQuery("SELECT rolsuper OR rolcreatedb OR rolcreaterole OR rolbypassrls FROM pg_roles WHERE rolname=current_user").use { rows ->
                                    check(rows.next() && !rows.getBoolean(1)) { "Non-development tenants require distinct nonprivileged database roles." }
                                }
                            } }
                        }
                        Flyway.configure().dataSource(source).load().migrate()
                        prepareEnvironment(source, environment, config.id)
                        val runtime = TenantRuntime(config.id, config.slug, source, json)
                        runtime.identity.bootstrap(config.ownerUsername, config.ownerPassword)
                        opened[config.slug] = runtime
                    } catch (failure: Throwable) { source.close(); throw failure }
                }
                return TenantRegistry(opened)
            } catch (failure: Throwable) { opened.values.forEach { it.source.close() }; throw failure }
        }
    }
}
