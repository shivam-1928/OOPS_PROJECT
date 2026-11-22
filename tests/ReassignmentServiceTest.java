import itsm.model.*;
import itsm.service.*;
import itsm.strategy.SkillBasedAssignment;
import java.util.*;

public class ReassignmentServiceTest {
    private static int checks;
    private static void check(boolean condition) { if (!condition) throw new AssertionError("Check " + (checks + 1)); checks++; }
    private static void rejected(Runnable operation) {
        try { operation.run(); throw new AssertionError("Expected rejection"); }
        catch (IllegalArgumentException | IllegalStateException expected) { checks++; }
    }
    public static void main(String[] args) {
        IncidentService service = new IncidentService(); SLAService sla = new SLAService();
        Technician first = new Technician("T001", "First", "first", "test-password", "first@local.test", Set.of("NETWORK"));
        Technician second = new Technician("T002", "Second", "second", "test-password", "second@local.test", Set.of("HARDWARE"));
        List<Technician> technicians = List.of(first, second);
        Incident incident = new Incident("INC1", "E001", "Reassignment", "Test", Incident.Category.NETWORK, 3, 3, 3);
        service.createIncident(incident); sla.startTracking(incident);
        rejected(() -> service.reassignIncident("INC1", "T001", Incident.Status.CLASSIFIED, "T002", technicians));
        service.assignIncident("INC1", technicians, new SkillBasedAssignment());
        rejected(() -> service.reassignIncident("INC1", "T001", Incident.Status.ASSIGNED, "T001", technicians));
        rejected(() -> service.reassignIncident("INC1", "T001", Incident.Status.ASSIGNED, "UNKNOWN", technicians));
        second.setAvailable(false);
        rejected(() -> service.reassignIncident("INC1", "T001", Incident.Status.ASSIGNED, "T002", technicians));
        second.setAvailable(true); second.setActive(false);
        rejected(() -> service.reassignIncident("INC1", "T001", Incident.Status.ASSIGNED, "T002", technicians));
        second.setActive(true);
        service.acknowledgeIncident("INC1", "T001"); service.startInvestigation("INC1", "T001");
        service.requestEmployeeInformation("INC1", "T001", "Which device?"); service.addEmployeeInformation("INC1", "E001", "Laptop.");
        var acknowledged = incident.getAcknowledgedAt(); var deadline = sla.getResolutionDeadline("INC1");
        rejected(() -> service.reassignIncident("INC1", "T001", Incident.Status.IN_PROGRESS, "T002", technicians));
        check(incident.getTechnicianId().equals("T001") && first.getActiveIncidentCount() == 1 && second.getActiveIncidentCount() == 0);
        service.reassignIncident("INC1", "T001", Incident.Status.WAITING_FOR_EMPLOYEE, "T002", technicians);
        check(incident.getStatus() == Incident.Status.ASSIGNED && incident.getTechnicianId().equals("T002"));
        check(first.getActiveIncidentCount() == 0 && second.getActiveIncidentCount() == 1);
        check(incident.getInformationRequests().get(0).getReplies().get(0).text().equals("Laptop."));
        check(sla.getResolutionDeadline("INC1").equals(deadline) && incident.getAcknowledgedAt().equals(acknowledged));
        rejected(() -> service.acknowledgeIncident("INC1", "T001"));
        service.acknowledgeIncident("INC1", "T002");
        check(incident.getAcknowledgedAt().equals(acknowledged));
        service.startInvestigation("INC1", "T002"); service.escalateIncident("INC1");
        service.reassignIncident("INC1", "T002", Incident.Status.ESCALATED, "T001", technicians);
        check(incident.getStatus() == Incident.Status.ASSIGNED);
        service.acknowledgeIncident("INC1", "T001"); service.startInvestigation("INC1", "T001");
        service.resolveIncident("INC1", "T001", "Fixed.");
        rejected(() -> service.reassignIncident("INC1", "T001", Incident.Status.RESOLVED, "T002", technicians));
        service.verifyIncident("INC1", "E001");
        rejected(() -> service.reassignIncident("INC1", "T001", Incident.Status.VERIFIED, "T002", technicians));
        service.closeIncident("INC1", "E001");
        rejected(() -> service.reassignIncident("INC1", "T001", Incident.Status.CLOSED, "T002", technicians));
        System.out.println("PASS: " + checks + " reassignment lifecycle and workload assertions.");
    }
}
