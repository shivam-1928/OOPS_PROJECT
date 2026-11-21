package itsm.service;

import java.util.ArrayList;
import java.util.List;

import itsm.model.AuditLog;

public class AuditService {
    private final List<AuditLog> logs;

    public AuditService() {
        logs = new ArrayList<>();
    }

    public void record(String userId, String action, String incidentId,
                       String previousState, String newState, String description) {
        logs.add(new AuditLog(userId, action, incidentId,
                previousState, newState, description));
    }

    public List<AuditLog> getAllLogs() {
        return new ArrayList<>(logs);
    }
    public void restoreLog(AuditLog log) { logs.add(java.util.Objects.requireNonNull(log)); }

    public List<AuditLog> getLogsForIncident(String incidentId) {
        List<AuditLog> result = new ArrayList<>();
        for (AuditLog log : logs) {
            if (incidentId != null && incidentId.equals(log.getIncidentId())) {
                result.add(log);
            }
        }
        return result;
    }

    public List<AuditLog> getLogsForUser(String userId) {
        List<AuditLog> result = new ArrayList<>();
        for (AuditLog log : logs) {
            if (userId != null && userId.equals(log.getUserId())) {
                result.add(log);
            }
        }
        return result;
    }
}
