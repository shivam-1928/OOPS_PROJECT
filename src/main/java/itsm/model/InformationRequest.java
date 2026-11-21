package itsm.model;

import java.time.LocalDateTime;
import java.util.ArrayList;
import java.util.List;

/** One technician question and the employee's replies, retained across investigation cycles. */
public final class InformationRequest {
    public record Reply(String employeeId, String text, LocalDateTime timestamp) { }
    private final String technicianId;
    private final String question;
    private final LocalDateTime askedAt;
    private final List<Reply> replies = new ArrayList<>();

    public InformationRequest(String technicianId, String question) {
        this(technicianId, question, LocalDateTime.now());
    }
    public InformationRequest(String technicianId, String question, LocalDateTime askedAt) {
        if (technicianId == null || technicianId.isBlank()) throw new IllegalArgumentException("Technician is required.");
        if (question == null || question.isBlank()) throw new IllegalArgumentException("A question is required.");
        if (question.trim().length() > 2000) throw new IllegalArgumentException("Question must be 2000 characters or fewer.");
        this.technicianId = technicianId;
        this.question = question.trim();
        this.askedAt = java.util.Objects.requireNonNull(askedAt);
    }
    public String getTechnicianId() { return technicianId; }
    public String getQuestion() { return question; }
    public LocalDateTime getAskedAt() { return askedAt; }
    public List<Reply> getReplies() { return List.copyOf(replies); }
    public void addReply(String employeeId, String text) {
        addReply(employeeId, text, LocalDateTime.now());
    }
    public void addReply(String employeeId, String text, LocalDateTime timestamp) {
        if (employeeId == null || employeeId.isBlank() || text == null || text.isBlank()) throw new IllegalArgumentException("Employee and reply are required.");
        replies.add(new Reply(employeeId, text.trim(), java.util.Objects.requireNonNull(timestamp)));
    }
}
