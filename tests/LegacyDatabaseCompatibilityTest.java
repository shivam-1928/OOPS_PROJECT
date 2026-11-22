import itsm.model.*;
import itsm.service.*;
import itsm.strategy.SkillBasedAssignment;
import itsm.persistence.Database;
import itsm.storage.DatabaseStore;
import java.nio.file.*;
import java.util.*;

/** Confirms the older entry point uses the current schema without losing newer exchanges. */
@SuppressWarnings("deprecation")
public class LegacyDatabaseCompatibilityTest {
    private static int checks;
    private static void check(boolean condition) {
        if (!condition) throw new AssertionError("Compatibility check " + (checks + 1));
        checks++;
    }
    public static void main(String[] args) throws Exception {
        Path directory = Files.createTempDirectory("itsm-compatibility-");
        Path file = directory.resolve("test.sqlite");
        try {
            Files.copy(Path.of("database/sample.sqlite"), file);
            System.setProperty("itsm.db", file.toString());
            Map<String, User> users = new LinkedHashMap<>();
            IncidentService incidents = new IncidentService(); SLAService sla = new SLAService();
            AuditService audit = new AuditService(); NotificationService notices = new NotificationService();
            Database database = new Database(users, incidents, sla, audit, notices);
            database.load();
            check(users.get("admin").checkPassword("admin123"));
            check(incidents.getAllIncidents().isEmpty());
            check(audit.getAllLogs().isEmpty());
            Incident added = new Incident("INC0002", "E001", "Compatibility test", "Disposable test", Incident.Category.NETWORK, 3, 3, 3);
            incidents.createIncident(added); sla.startTracking(added);
            incidents.assignIncident("INC0002", users.values().stream().filter(u -> u instanceof Technician).map(u -> (Technician)u).toList(), new SkillBasedAssignment());
            incidents.acknowledgeIncident("INC0002", added.getTechnicianId());
            incidents.startInvestigation("INC0002", added.getTechnicianId());
            incidents.requestEmployeeInformation("INC0002", added.getTechnicianId(), "Which device is affected?");
            incidents.addEmployeeInformation("INC0002", "E001", "My laptop.");
            database.save();
            List<String> expected = DatabaseStore.snapshot(users, incidents, sla, audit, notices);
            Map<String, User> restoredUsers = new LinkedHashMap<>();
            IncidentService restoredIncidents = new IncidentService(); SLAService restoredSla = new SLAService();
            AuditService restoredAudit = new AuditService(); NotificationService restoredNotices = new NotificationService();
            Database restored = new Database(restoredUsers, restoredIncidents, restoredSla, restoredAudit, restoredNotices);
            restored.load();
            check(expected.equals(DatabaseStore.snapshot(restoredUsers, restoredIncidents, restoredSla, restoredAudit, restoredNotices)));
            check(restoredIncidents.getIncident("INC0002").getInformationRequests().get(0).getReplies().get(0).text().equals("My laptop."));
            restored.save();
            try { restored.load(); throw new AssertionError("Repeated load should be rejected"); }
            catch (IllegalStateException expectedError) { checks++; }
            System.out.println("PASS: " + checks + " legacy storage compatibility assertions.");
        } finally {
            Files.deleteIfExists(file);
            Files.deleteIfExists(directory);
        }
    }
}
