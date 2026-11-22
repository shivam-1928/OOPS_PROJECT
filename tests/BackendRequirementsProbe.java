import itsm.model.Incident;
import itsm.model.Technician;
import itsm.service.*;
import itsm.strategy.SkillBasedAssignment;
import java.lang.reflect.Field;
import java.time.LocalDateTime;
import java.util.List;
import java.util.Set;

/** Reproduces requirements gaps without modifying production classes or server data. */
public class BackendRequirementsProbe {
    private static Incident overdue(String id) throws Exception {
        Incident incident = new Incident(id, "E001", "Requirements probe", "Isolated probe record", Incident.Category.NETWORK, 5, 5, 5);
        Field created = Incident.class.getDeclaredField("createdAt");
        created.setAccessible(true); created.set(incident, LocalDateTime.now().minusMinutes(6));
        return incident;
    }
    public static void main(String[] args) throws Exception {
        IncidentService incidents = new IncidentService(); SLAService sla = new SLAService();
        Technician technician = new Technician("T001", "Probe technician", "probe", "test-only", "probe@itsm.local", Set.of("NETWORK"));
        Incident escalated = overdue("PROBE_ESCALATED");
        incidents.createIncident(escalated); sla.startTracking(escalated);
        incidents.assignIncident(escalated.getIncidentId(), List.of(technician), new SkillBasedAssignment());
        new IntelligentIncidentService(incidents, sla).escalateSlaBreaches();
        boolean acknowledgeBlocked = false, assignmentBlocked = false;
        try { incidents.acknowledgeIncident(escalated.getIncidentId(), technician.getUserId()); } catch (IllegalStateException error) { acknowledgeBlocked = true; }
        try { incidents.assignIncident(escalated.getIncidentId(), List.of(technician), new SkillBasedAssignment()); } catch (IllegalStateException error) { assignmentBlocked = true; }
        if (escalated.getStatus() == Incident.Status.ESCALATED && acknowledgeBlocked && assignmentBlocked)
            System.out.println("POLICY: An assigned, escalated incident cannot be acknowledged or automatically assigned again. Administrators can now use manual reassignment to a different available technician.");
        Incident late = overdue("PROBE_LATE_RESPONSE");
        incidents.createIncident(late); sla.startTracking(late);
        incidents.assignIncident(late.getIncidentId(), List.of(technician), new SkillBasedAssignment());
        boolean breachedBefore = sla.isResponseBreached(late);
        incidents.acknowledgeIncident(late.getIncidentId(), technician.getUserId());
        if (breachedBefore && sla.getSLAStatus(late).equals("WITHIN SLA"))
            System.out.println("GAP: A late acknowledgement clears the current response-breach status; historical SLA compliance is not retained by SLAService.");
        System.out.println("These are observed backend limitations, not passed feature assertions.");
    }
}
