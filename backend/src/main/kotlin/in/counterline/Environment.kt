package `in`.counterline

import java.util.UUID
import javax.sql.DataSource

enum class AppEnvironment(val label: String) {
    DEVELOPMENT("development"), VERIFICATION("verification"), STAGING("staging");
    companion object {
        fun from(value: String?): AppEnvironment = entries.find { it.label == (value ?: "development") }
            ?: error("APP_ENV must be development, verification or staging. Production release gates are not yet satisfied.")
    }
}

/** Refuse database aliasing and mixed demo/business data before accepting HTTP traffic. */
fun prepareEnvironment(source: DataSource, environment: AppEnvironment, tenantId: String) = databaseTransaction(source) { connection ->
    connection.prepareStatement("SELECT pg_advisory_xact_lock(27418, 5)").use { it.execute() }
    val tenant = UUID.fromString(tenantId)
    val existing = connection.createStatement().use { statement ->
        statement.executeQuery("SELECT name,tenant_id FROM environment_identity WHERE singleton").use { rows ->
            if (rows.next()) rows.getString(1) to rows.getObject(2) else null
        }
    }
    if (existing != null) {
        check(existing.first == environment.label && existing.second == tenant) { "Database tenant/environment identity mismatch. Select the correct database; never relabel existing business data." }
        return@databaseTransaction
    }
    if (environment != AppEnvironment.DEVELOPMENT) {
        val populated = connection.createStatement().use { statement ->
            statement.executeQuery("""
                SELECT EXISTS(SELECT 1 FROM staff) OR EXISTS(SELECT 1 FROM orders)
                    OR EXISTS(SELECT 1 FROM audit_events) OR EXISTS(SELECT 1 FROM dining_tables)
                    OR EXISTS(SELECT 1 FROM running_checks)
            """.trimIndent()).use { rows -> rows.next(); rows.getBoolean(1) }
        }
        check(!populated) { "Non-development databases must start empty or already have the matching environment identity. Do not promote prototype data." }
        // V1 is already applied in existing installations and must not be rewritten.
        // Remove its exact, untouched fixture rows only on a fresh non-development database.
        connection.createStatement().use { statement -> statement.executeUpdate("""
            DELETE FROM menu_items WHERE create_fingerprint IS NULL AND version=0
                AND variants='[]'::jsonb AND addons='[]'::jsonb AND available
                AND cgst_bps=250 AND sgst_bps=250
                AND (id,name,category,price_paise,vegetarian) IN (VALUES
                    ('masala-dosa','Masala dosa','South Indian',14000,TRUE),
                    ('idli','Idli sambar','South Indian',8000,TRUE),
                    ('paneer-tikka','Paneer tikka','Starters',24000,TRUE),
                    ('dal-tadka','Dal tadka','Mains',18000,TRUE),
                    ('veg-biryani','Vegetable biryani','Mains',22000,TRUE),
                    ('chicken-biryani','Chicken biryani','Mains',28000,FALSE),
                    ('butter-naan','Butter naan','Breads',4500,TRUE),
                    ('filter-coffee','Filter coffee','Beverages',6000,TRUE)
                )
        """.trimIndent()) }
        val remaining = connection.createStatement().use { it.executeQuery("SELECT COUNT(*) FROM menu_items").use { rows -> rows.next(); rows.getInt(1) } }
        check(remaining == 0) { "Unexpected catalog data on an unbound non-development database. Provision a clean database." }
    }
    connection.prepareStatement("INSERT INTO environment_identity(singleton,name,tenant_id) VALUES(TRUE,?,?)").use {
        it.setString(1, environment.label); it.setObject(2, tenant); it.executeUpdate()
    }
}
