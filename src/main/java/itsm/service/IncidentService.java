package itsm.service;

import java.time.LocalDateTime;
import java.util.ArrayList;
import java.util.Collection;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

import itsm.model.Incident;
import itsm.model.Technician;
import itsm.strategy.TechnicianAssignmentStrategy;

public class IncidentService {
    private final Map<String, Incident> incidents;
    private final PriorityCalculator priorityCalculator;

    public IncidentService() {
        incidents = new LinkedHashMap<>();
        priorityCalculator = new PriorityCalculator();
    }

    public Incident createIncident(Incident incident) {
        if (incident == null) {
            throw new IllegalArgumentException("Incident cannot be null.");
        }
        if (incidents.containsKey(incident.getIncidentId())) {
            throw new IllegalArgumentException("An incident with this ID already exists.");
        }

        incident.setPriority(priorityCalculator.calculatePriority(
                incident.getImpact(),
                incident.getUrgency(),
                incident.getBusinessCriticality()
        ));
        incident.setStatus(Incident.Status.CLASSIFIED);
        incidents.put(incident.getIncidentId(), incident);
        return incident;
    }

    public Incident getIncident(String incidentId) {
        Incident incident = incidents.get(incidentId);
        if (incident == null) {
            throw new IllegalArgumentException("Incident not found: " + incidentId);
        }
        return incident;
    }

    public List<Incident> getAllIncidents() {
        return new ArrayList<>(incidents.values());
    }

    public List<Incident> getIncidentsReportedBy(String employeeId) {
        List<Incident> result = new ArrayList<>();
        for (Incident incident : incidents.values()) {
            if (incident.getEmployeeId().equals(employeeId)) {
                result.add(incident);
            }
        }
        return result;
    }

    public List<Incident> getIncidentsAssignedTo(String technicianId) {
        List<Incident> result = new ArrayList<>();
        for (Incident incident : incidents.values()) {
            if (technicianId.equals(incident.getTechnicianId())) {
                result.add(incident);
            }
        }
        return result;
    }

    public Incident assignIncident(String incidentId,
                                   Collection<Technician> technicians,
                                   TechnicianAssignmentStrategy strategy) {
        Incident incident = getIncident(incidentId);
        if (strategy == null) {
            throw new IllegalArgumentException("Assignment strategy is required.");
        }
        if (incident.getStatus() != Incident.Status.CLASSIFIED
                && incident.getStatus() != Incident.Status.ESCALATED) {
            throw new IllegalStateException("Only classified or escalated incidents can be assigned.");
        }
        if (incident.getTechnicianId() != null) {
            throw new IllegalStateException("Incident already has an assigned technician.");
        }

        Technician technician = strategy.assign(incident, technicians);
        incident.setTechnicianId(technician.getUserId());
        technician.increaseWorkload();
        incident.setStatus(Incident.Status.ASSIGNED);
        return incident;
    }

    public void acknowledgeIncident(String incidentId, String technicianId) {
        Incident incident = getIncident(incidentId);
        requireAssignedTechnician(incident, technicianId);
        requireStatus(incident, Incident.Status.ASSIGNED);
        incident.setStatus(Incident.Status.ACKNOWLEDGED);
        incident.setAcknowledgedAt(LocalDateTime.now());
    }

    public void startInvestigation(String incidentId, String technicianId) {
        Incident incident = getIncident(incidentId);
        requireAssignedTechnician(incident, technicianId);
        if (incident.getStatus() != Incident.Status.ACKNOWLEDGED) {
            throw new IllegalStateException("Incident must be acknowledged before investigation.");
        }
        incident.setStatus(Incident.Status.IN_PROGRESS);
    }

    public void requestEmployeeInformation(String incidentId, String technicianId) {
        Incident incident = getIncident(incidentId);
        requireAssignedTechnician(incident, technicianId);
        requireStatus(incident, Incident.Status.IN_PROGRESS);
        incident.setStatus(Incident.Status.WAITING_FOR_EMPLOYEE);
    }

    public void resumeInvestigation(String incidentId, String technicianId) {
        Incident incident = getIncident(incidentId);
        requireAssignedTechnician(incident, technicianId);
        requireStatus(incident, Incident.Status.WAITING_FOR_EMPLOYEE);
        incident.setStatus(Incident.Status.IN_PROGRESS);
    }

    public void resolveIncident(String incidentId, String technicianId, String resolutionNotes) {
        Incident incident = getIncident(incidentId);
        requireAssignedTechnician(incident, technicianId);
        requireStatus(incident, Incident.Status.IN_PROGRESS);
        if (resolutionNotes == null || resolutionNotes.trim().isEmpty()) {
            throw new IllegalArgumentException("Resolution notes are required.");
        }
        incident.setResolutionNotes(resolutionNotes);
        incident.setResolvedAt(LocalDateTime.now());
        incident.setStatus(Incident.Status.RESOLVED);
    }

    public void verifyIncident(String incidentId, String employeeId) {
        Incident incident = getIncident(incidentId);
        if (!incident.getEmployeeId().equals(employeeId)) {
            throw new IllegalArgumentException("Only the reporting employee can verify this incident.");
        }
        requireStatus(incident, Incident.Status.RESOLVED);
        incident.setStatus(Incident.Status.VERIFIED);
    }

    public void closeIncident(String incidentId, String employeeId) {
        Incident incident = getIncident(incidentId);
        if (!incident.getEmployeeId().equals(employeeId)) {
            throw new IllegalArgumentException("Only the reporting employee can close this incident.");
        }
        requireStatus(incident, Incident.Status.VERIFIED);
        incident.setStatus(Incident.Status.CLOSED);
        incident.setClosedAt(LocalDateTime.now());
    }

    public void escalateIncident(String incidentId) {
        Incident incident = getIncident(incidentId);
        if (incident.getStatus() == Incident.Status.CLOSED
                || incident.getStatus() == Incident.Status.VERIFIED
                || incident.getStatus() == Incident.Status.RESOLVED) {
            throw new IllegalStateException("A completed incident cannot be escalated.");
        }
        incident.setStatus(Incident.Status.ESCALATED);
    }

    private void requireAssignedTechnician(Incident incident, String technicianId) {
        if (incident.getTechnicianId() == null
                || !incident.getTechnicianId().equals(technicianId)) {
            throw new IllegalArgumentException("This incident is not assigned to this technician.");
        }
    }

    private void requireStatus(Incident incident, Incident.Status expected) {
        if (incident.getStatus() != expected) {
            throw new IllegalStateException(
                    "Invalid operation. Current status is " + incident.getStatus()
                            + "; expected " + expected + "."
            );
        }
    }
}
