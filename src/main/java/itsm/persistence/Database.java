package itsm.persistence;

import itsm.model.User;
import itsm.service.*;
import itsm.storage.DatabaseStore;
import java.io.IOException;
import java.io.UncheckedIOException;
import java.nio.file.Path;
import java.util.Map;

/** Compatibility entry point for older console callers; uses the current storage format. */
@Deprecated
public final class Database {
    private final Map<String, User> users;
    private final IncidentService incidents;
    private final SLAService sla;
    private final AuditService audit;
    private final NotificationService notifications;
    private DatabaseStore store;
    private boolean loaded;

    public Database(Map<String, User> users, IncidentService incidents, SLAService sla,
                    AuditService audit, NotificationService notifications) {
        this.users = users;
        this.incidents = incidents;
        this.sla = sla;
        this.audit = audit;
        this.notifications = notifications;
    }

    private DatabaseStore store() {
        if (store == null) {
            try {
                store = new DatabaseStore(Path.of(System.getProperty("itsm.db", "itsm.sqlite")),
                        System.getProperty("itsm.python", System.getenv().getOrDefault("ITSM_PYTHON", "python")));
            } catch (IOException error) { throw new UncheckedIOException(error); }
        }
        return store;
    }

    public void load() {
        if (loaded || !incidents.getAllIncidents().isEmpty() || !audit.getAllLogs().isEmpty()
                || !notifications.getAllInAppNotifications().isEmpty()) {
            throw new IllegalStateException("Load the database once, before creating records.");
        }
        DatabaseStore.State saved = DatabaseStore.restore(store().load());
        // Leave caller-supplied demo users intact when initializing an empty database.
        if (!saved.users().isEmpty()) { users.clear(); users.putAll(saved.users()); }
        for (var incident : saved.incidents().getAllIncidents()) {
            incidents.restoreIncident(incident);
            sla.restoreTracking(incident.getIncidentId(), saved.sla().getResponseDeadline(incident.getIncidentId()),
                    saved.sla().getResolutionDeadline(incident.getIncidentId()));
        }
        saved.audit().getAllLogs().forEach(audit::restoreLog);
        saved.notifications().getAllInAppNotifications().forEach(notifications::restoreNotification);
        loaded = true;
    }

    public void save() {
        if (!loaded) throw new IllegalStateException("Load the database before saving records.");
        store().save(DatabaseStore.snapshot(users, incidents, sla, audit, notifications));
    }
}
