package itsm.service;

import java.time.LocalDateTime;
import java.util.ArrayList;
import java.util.List;

public class NotificationService {
    private final List<String> inAppNotifications;

    public NotificationService() {
        inAppNotifications = new ArrayList<>();
    }

    public void sendConsoleNotification(String recipient, String message) {
        validate(recipient, message);
        System.out.println("\n[CONSOLE NOTIFICATION] To: " + recipient);
        System.out.println(message);
    }

    public void sendInAppNotification(String recipient, String message) {
        validate(recipient, message);
        String notification = LocalDateTime.now()
                + " | To: " + recipient + " | " + message;
        inAppNotifications.add(notification);
    }

    public List<String> getNotificationsFor(String recipient) {
        List<String> result = new ArrayList<>();
        String prefix = " | To: " + recipient + " | ";
        for (String notification : inAppNotifications) {
            if (notification.contains(prefix)) {
                result.add(notification);
            }
        }
        return result;
    }

    public List<String> getAllInAppNotifications() {
        return new ArrayList<>(inAppNotifications);
    }
    public void restoreNotification(String message) { inAppNotifications.add(java.util.Objects.requireNonNull(message)); }

    private void validate(String recipient, String message) {
        if (recipient == null || recipient.trim().isEmpty()
                || message == null || message.trim().isEmpty()) {
            throw new IllegalArgumentException("Recipient and message are required.");
        }
    }
}
