package itsm.service;

import java.util.ArrayList;
import java.util.HashSet;
import java.util.List;
import java.util.Set;

import itsm.model.Incident;

public class IntelligentIncidentService {
    private final IncidentService incidentService;
    private final SLAService slaService;

    public IntelligentIncidentService(IncidentService incidentService,
                                      SLAService slaService) {
        if (incidentService == null || slaService == null) {
            throw new IllegalArgumentException("Incident and SLA services are required.");
        }
        this.incidentService = incidentService;
        this.slaService = slaService;
    }

    public List<Incident> findPossibleDuplicates(Incident target) {
        if (target == null) {
            throw new IllegalArgumentException("Incident cannot be null.");
        }

        List<Incident> matches = new ArrayList<>();
        for (Incident other : incidentService.getAllIncidents()) {
            if (!other.getIncidentId().equals(target.getIncidentId())
                    && other.getCategory() == target.getCategory()
                    && similarity(target.getTitle() + " " + target.getDescription(),
                                  other.getTitle() + " " + other.getDescription()) >= 0.5) {
                matches.add(other);
            }
        }
        return matches;
    }

    public List<Incident> findPossibleDuplicates(String incidentId) {
        return findPossibleDuplicates(incidentService.getIncident(incidentId));
    }

    public List<Incident> escalateSlaBreaches() {
        List<Incident> escalated = new ArrayList<>();

        for (Incident incident : incidentService.getAllIncidents()) {
            if (incident.getStatus() == Incident.Status.CLOSED
                    || incident.getStatus() == Incident.Status.VERIFIED
                    || incident.getStatus() == Incident.Status.RESOLVED
                    || incident.getStatus() == Incident.Status.ESCALATED) {
                continue;
            }

            if (slaService.isResponseBreached(incident)
                    || slaService.isResolutionBreached(incident)) {
                incidentService.escalateIncident(incident.getIncidentId());
                escalated.add(incident);
            }
        }

        return escalated;
    }

    private double similarity(String first, String second) {
        Set<String> firstWords = words(first);
        Set<String> secondWords = words(second);

        if (firstWords.isEmpty() || secondWords.isEmpty()) {
            return 0.0;
        }

        Set<String> intersection = new HashSet<>(firstWords);
        intersection.retainAll(secondWords);

        Set<String> union = new HashSet<>(firstWords);
        union.addAll(secondWords);

        return (double) intersection.size() / union.size();
    }

    private Set<String> words(String text) {
        Set<String> result = new HashSet<>();
        if (text == null) {
            return result;
        }

        String[] parts = text.toLowerCase().split("[^a-z0-9]+");
        for (String part : parts) {
            if (part.length() > 2) {
                result.add(part);
            }
        }
        return result;
    }
}
