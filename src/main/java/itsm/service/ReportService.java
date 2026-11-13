package itsm.service;

import java.util.ArrayList;
import java.util.List;
import java.util.Map;

import itsm.model.Incident;
import itsm.model.Technician;

public class ReportService {
    public void printIncidentSummary(List<Incident> incidents) {
        int open = 0, resolved = 0, closed = 0;
        int p1 = 0, p2 = 0, p3 = 0, p4 = 0;

        for (Incident incident : incidents) {
            if (incident.getStatus() == Incident.Status.CLOSED) {
                closed++;
            } else if (incident.getStatus() == Incident.Status.RESOLVED
                    || incident.getStatus() == Incident.Status.VERIFIED) {
                resolved++;
            } else {
                open++;
            }

            if (incident.getPriority() != null) {
                switch (incident.getPriority()) {
                    case P1: p1++; break;
                    case P2: p2++; break;
                    case P3: p3++; break;
                    case P4: p4++; break;
                    default: break;
                }
            }
        }

        System.out.println("\n===== INCIDENT SUMMARY =====");
        System.out.println("Total incidents : " + incidents.size());
        System.out.println("Open            : " + open);
        System.out.println("Resolved        : " + resolved);
        System.out.println("Closed          : " + closed);
        System.out.println("P1: " + p1 + " | P2: " + p2
                + " | P3: " + p3 + " | P4: " + p4);
    }

    public void printTechnicianWorkload(List<Technician> technicians) {
        System.out.println("\n===== TECHNICIAN WORKLOAD =====");
        if (technicians.isEmpty()) {
            System.out.println("No technicians registered.");
            return;
        }
        for (Technician technician : technicians) {
            System.out.println(technician.getName() + " (" + technician.getUserId()
                    + ") - Active incidents: " + technician.getActiveIncidentCount()
                    + " - Available: " + technician.isAvailable());
        }
    }

    public List<Incident> searchIncidents(List<Incident> incidents,
            String category, String priority, String status,
            String employeeId, String technicianId) {
        List<Incident> result = new ArrayList<>();

        for (Incident incident : incidents) {
            boolean matches = matches(category, incident.getCategory().name())
                    && matches(priority, incident.getPriority() == null
                            ? "" : incident.getPriority().name())
                    && matches(status, incident.getStatus().name())
                    && matches(employeeId, incident.getEmployeeId())
                    && matches(technicianId, incident.getTechnicianId());

            if (matches) {
                result.add(incident);
            }
        }
        return result;
    }

    private boolean matches(String filter, String value) {
        return filter == null || filter.trim().isEmpty()
                || value.equalsIgnoreCase(filter.trim());
    }
}
