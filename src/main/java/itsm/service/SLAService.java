package itsm.service;

import java.time.Duration;
import java.time.LocalDateTime;
import java.util.HashMap;
import java.util.Map;

import itsm.model.Incident;

public class SLAService {
    private static class SLADetails {
        private final LocalDateTime responseDeadline;
        private final LocalDateTime resolutionDeadline;

        private SLADetails(LocalDateTime responseDeadline,
                           LocalDateTime resolutionDeadline) {
            this.responseDeadline = responseDeadline;
            this.resolutionDeadline = resolutionDeadline;
        }
    }

    private final Map<String, SLADetails> slaRecords;

    public SLAService() {
        slaRecords = new HashMap<>();
    }

    public void startTracking(Incident incident) {
        if (incident == null || incident.getPriority() == null) {
            throw new IllegalArgumentException("A classified incident is required.");
        }

        int responseMinutes;
        int resolutionMinutes;

        switch (incident.getPriority()) {
            case P1:
                responseMinutes = 5;
                resolutionMinutes = 30;
                break;
            case P2:
                responseMinutes = 15;
                resolutionMinutes = 120;
                break;
            case P3:
                responseMinutes = 60;
                resolutionMinutes = 480;
                break;
            case P4:
                responseMinutes = 240;
                resolutionMinutes = 1440;
                break;
            default:
                throw new IllegalStateException("Unknown incident priority.");
        }

        LocalDateTime start = incident.getCreatedAt();
        slaRecords.put(incident.getIncidentId(),
                new SLADetails(start.plusMinutes(responseMinutes),
                        start.plusMinutes(resolutionMinutes)));
    }

    public LocalDateTime getResponseDeadline(String incidentId) {
        return getDetails(incidentId).responseDeadline;
    }

    public LocalDateTime getResolutionDeadline(String incidentId) {
        return getDetails(incidentId).resolutionDeadline;
    }

    public boolean isResponseBreached(Incident incident) {
        return incident.getAcknowledgedAt() == null
                && LocalDateTime.now().isAfter(getResponseDeadline(incident.getIncidentId()));
    }

    public boolean isResolutionBreached(Incident incident) {
        boolean unfinished = incident.getStatus() != Incident.Status.RESOLVED
                && incident.getStatus() != Incident.Status.VERIFIED
                && incident.getStatus() != Incident.Status.CLOSED;
        return unfinished
                && LocalDateTime.now().isAfter(getResolutionDeadline(incident.getIncidentId()));
    }

    public boolean isAtRisk(Incident incident) {
        if (incident.getStatus() == Incident.Status.CLOSED
                || incident.getStatus() == Incident.Status.VERIFIED
                || incident.getStatus() == Incident.Status.RESOLVED) {
            return false;
        }

        SLADetails details = getDetails(incident.getIncidentId());
        LocalDateTime now = LocalDateTime.now();

        if (incident.getAcknowledgedAt() == null
                && !now.isAfter(details.responseDeadline)) {
            long total = Duration.between(incident.getCreatedAt(),
                    details.responseDeadline).toMinutes();
            long remaining = Duration.between(now, details.responseDeadline).toMinutes();
            if (total > 0 && remaining <= Math.max(1, total / 5)) {
                return true;
            }
        }

        if (!now.isAfter(details.resolutionDeadline)) {
            long total = Duration.between(incident.getCreatedAt(),
                    details.resolutionDeadline).toMinutes();
            long remaining = Duration.between(now, details.resolutionDeadline).toMinutes();
            return total > 0 && remaining <= Math.max(1, total / 5);
        }

        return false;
    }

    public String getSLAStatus(Incident incident) {
        if (isResponseBreached(incident)) {
            return "RESPONSE SLA BREACHED";
        }
        if (isResolutionBreached(incident)) {
            return "RESOLUTION SLA BREACHED";
        }
        if (isAtRisk(incident)) {
            return "AT RISK";
        }
        return "WITHIN SLA";
    }

    private SLADetails getDetails(String incidentId) {
        SLADetails details = slaRecords.get(incidentId);
        if (details == null) {
            throw new IllegalArgumentException("SLA tracking has not started for incident " + incidentId);
        }
        return details;
    }
}
