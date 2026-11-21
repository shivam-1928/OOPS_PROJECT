import itsm.model.Incident;
import itsm.service.*;
import java.time.LocalDateTime;
import java.lang.reflect.Field;

/** Clock boundary checks without sleeping or changing production services. */
public class ServiceContractTest {
    private static int checks;
    private static void check(boolean condition, String message) {
        if (!condition) throw new AssertionError(message);
        checks++;
    }
    private static Incident aged(String id, int minutes) throws Exception {
        Incident i = new Incident(id, "E001", "Network unavailable", "Office network unavailable", Incident.Category.NETWORK, 5, 5, 5);
        Field created = Incident.class.getDeclaredField("createdAt");
        created.setAccessible(true); created.set(i, LocalDateTime.now().minusMinutes(minutes));
        return i;
    }
    public static void main(String[] args) throws Exception {
        IncidentService incidents = new IncidentService(); SLAService sla = new SLAService();
        IntelligentIncidentService intelligence = new IntelligentIncidentService(incidents, sla);
        Incident risk = aged("RISK", 4); incidents.createIncident(risk); sla.startTracking(risk);
        check(sla.isAtRisk(risk), "Warn near response deadline");
        check(sla.getSLAStatus(risk).equals("AT RISK"), "Risk status");
        Incident breach = aged("BREACH", 6); incidents.createIncident(breach); sla.startTracking(breach);
        check(sla.isResponseBreached(breach), "Detect response breach");
        check(sla.getSLAStatus(breach).equals("RESPONSE SLA BREACHED"), "Response precedence");
        check(intelligence.escalateSlaBreaches().size() == 1, "Escalate breached only");
        check(breach.getStatus() == Incident.Status.ESCALATED, "Escalation transition");
        check(intelligence.escalateSlaBreaches().isEmpty(), "Do not escalate same incident twice");
        Incident resolution = aged("RESOLUTION", 31); incidents.createIncident(resolution); sla.startTracking(resolution);
        resolution.setAcknowledgedAt(resolution.getCreatedAt().plusMinutes(1));
        check(sla.isResolutionBreached(resolution), "Detect resolution breach");
        check(sla.getSLAStatus(resolution).equals("RESOLUTION SLA BREACHED"), "Resolution status");
        resolution.setStatus(Incident.Status.RESOLVED);
        check(!sla.isResolutionBreached(resolution) && !sla.isAtRisk(resolution), "Stop resolution clock when resolved");
        check(intelligence.escalateSlaBreaches().isEmpty(), "Skip completed incident");
        check(intelligence.findPossibleDuplicates(risk).size() == 2, "Duplicate suggestions include same-category completed incidents");
        int[][] targets = {{5, 5, 5, 5, 30}, {4, 4, 3, 15, 120}, {3, 3, 3, 60, 480}, {1, 1, 1, 240, 1440}};
        for (int index = 0; index < targets.length; index++) {
            int[] target = targets[index];
            IncidentService targetIncidents = new IncidentService(); SLAService targetSla = new SLAService();
            Incident incident = new Incident("TARGET" + index, "E001", "Target verification", "SLA target verification", Incident.Category.OTHER, target[0], target[1], target[2]);
            targetIncidents.createIncident(incident); targetSla.startTracking(incident);
            check(targetSla.getResponseDeadline(incident.getIncidentId()).equals(incident.getCreatedAt().plusMinutes(target[3])), "P" + (index + 1) + " response target");
            check(targetSla.getResolutionDeadline(incident.getIncidentId()).equals(incident.getCreatedAt().plusMinutes(target[4])), "P" + (index + 1) + " resolution target");
        }
        System.out.println("PASS: " + checks + " SLA and intelligence boundary assertions.");
    }
}
