package itsm.model;

import java.time.LocalDateTime;

public class AuditLog {
    private final LocalDateTime timestamp;
    private final String userId;
    private final String action;
    private final String incidentId;
    private final String previousState;
    private final String newState;
    private final String description;

    public AuditLog(String userId, String action, String incidentId,
                    String previousState, String newState, String description) {
        this(LocalDateTime.now(), userId, action, incidentId, previousState, newState, description);
    }

    public AuditLog(LocalDateTime timestamp, String userId, String action, String incidentId,
                    String previousState, String newState, String description) {
        this.timestamp = timestamp;
        this.userId = userId;
        this.action = action;
        this.incidentId = incidentId;
        this.previousState = previousState;
        this.newState = newState;
        this.description = description;
    }

    public LocalDateTime getTimestamp() {
        return timestamp;
    }

    public String getUserId() {
        return userId;
    }

    public String getAction() {
        return action;
    }

    public String getIncidentId() {
        return incidentId;
    }

    public String getPreviousState() {
        return previousState;
    }

    public String getNewState() {
        return newState;
    }

    public String getDescription() {
        return description;
    }

    @Override
    public String toString() {
        return timestamp + " | User: " + userId
                + " | Action: " + action
                + " | Incident: " + incidentId
                + " | State: " + previousState + " -> " + newState
                + " | " + description;
    }
}
