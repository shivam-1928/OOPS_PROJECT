package itsm.model;

import java.time.LocalDateTime;

public class Incident {
    public enum Category {
        NETWORK, HARDWARE, SOFTWARE, EMAIL, ACCESS, OTHER
    }

    public enum Priority {
        P1, P2, P3, P4
    }

    public enum Status {
        NEW,
        CLASSIFIED,
        ASSIGNED,
        ACKNOWLEDGED,
        IN_PROGRESS,
        WAITING_FOR_EMPLOYEE,
        RESOLVED,
        VERIFIED,
        CLOSED,
        ESCALATED
    }

    private final String incidentId;
    private final String employeeId;
    private String title;
    private String description;
    private Category category;
    private int impact;
    private int urgency;
    private int businessCriticality;
    private Priority priority;
    private Status status;
    private String technicianId;
    private final LocalDateTime createdAt;
    private LocalDateTime acknowledgedAt;
    private LocalDateTime resolvedAt;
    private LocalDateTime closedAt;
    private String resolutionNotes;

    public Incident(String incidentId, String employeeId, String title,
                    String description, Category category, int impact,
                    int urgency, int businessCriticality) {
        if (isBlank(incidentId) || isBlank(employeeId)
                || isBlank(title) || isBlank(description)) {
            throw new IllegalArgumentException("Incident details cannot be empty.");
        }

        validateScore(impact);
        validateScore(urgency);
        validateScore(businessCriticality);

        this.incidentId = incidentId;
        this.employeeId = employeeId;
        this.title = title;
        this.description = description;
        this.category = category == null ? Category.OTHER : category;
        this.impact = impact;
        this.urgency = urgency;
        this.businessCriticality = businessCriticality;
        this.status = Status.NEW;
        this.createdAt = LocalDateTime.now();
    }

    private void validateScore(int score) {
        if (score < 1 || score > 5) {
            throw new IllegalArgumentException("Impact, urgency and business criticality must be from 1 to 5.");
        }
    }

    private boolean isBlank(String value) {
        return value == null || value.trim().isEmpty();
    }

    public String getIncidentId() {
        return incidentId;
    }

    public String getEmployeeId() {
        return employeeId;
    }

    public String getTitle() {
        return title;
    }

    public void setTitle(String title) {
        if (isBlank(title)) {
            throw new IllegalArgumentException("Title cannot be empty.");
        }
        this.title = title;
    }

    public String getDescription() {
        return description;
    }

    public void setDescription(String description) {
        if (isBlank(description)) {
            throw new IllegalArgumentException("Description cannot be empty.");
        }
        this.description = description;
    }

    public Category getCategory() {
        return category;
    }

    public void setCategory(Category category) {
        if (category == null) {
            throw new IllegalArgumentException("Category cannot be null.");
        }
        this.category = category;
    }

    public int getImpact() {
        return impact;
    }

    public int getUrgency() {
        return urgency;
    }

    public int getBusinessCriticality() {
        return businessCriticality;
    }

    public void setPriority(Priority priority) {
        if (priority == null) {
            throw new IllegalArgumentException("Priority cannot be null.");
        }
        this.priority = priority;
    }

    public Priority getPriority() {
        return priority;
    }

    public Status getStatus() {
        return status;
    }

    public void setStatus(Status status) {
        if (status == null) {
            throw new IllegalArgumentException("Status cannot be null.");
        }
        this.status = status;
    }

    public String getTechnicianId() {
        return technicianId;
    }

    public void setTechnicianId(String technicianId) {
        this.technicianId = technicianId;
    }

    public LocalDateTime getCreatedAt() {
        return createdAt;
    }

    public LocalDateTime getAcknowledgedAt() {
        return acknowledgedAt;
    }

    public void setAcknowledgedAt(LocalDateTime acknowledgedAt) {
        this.acknowledgedAt = acknowledgedAt;
    }

    public LocalDateTime getResolvedAt() {
        return resolvedAt;
    }

    public void setResolvedAt(LocalDateTime resolvedAt) {
        this.resolvedAt = resolvedAt;
    }

    public LocalDateTime getClosedAt() {
        return closedAt;
    }

    public void setClosedAt(LocalDateTime closedAt) {
        this.closedAt = closedAt;
    }

    public String getResolutionNotes() {
        return resolutionNotes;
    }

    public void setResolutionNotes(String resolutionNotes) {
        this.resolutionNotes = resolutionNotes;
    }
}
