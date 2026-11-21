package itsm.storage;

import itsm.model.*;
import itsm.service.*;
import java.nio.charset.StandardCharsets;
import java.nio.file.*;
import java.time.LocalDateTime;
import java.util.*;
import java.util.concurrent.*;

/** Uses the supplied Python/SQLite adapter; Java domain services remain authoritative. */
public final class DatabaseStore {
    public record State(Map<String, User> users, IncidentService incidents, SLAService sla, AuditService audit, NotificationService notifications) { }
    public static final class Conflict extends RuntimeException { public Conflict() { super("Storage changed in another process. Sign in again to reload the latest records."); } }
    public static final class Failure extends RuntimeException { public Failure() { super("Storage is unavailable. The change was not saved. Please retry after storage is available."); } }
    private final Path path;
    private final String python;
    private long revision;
    public DatabaseStore(Path path, String python) throws java.io.IOException {
        this.path = path.toAbsolutePath().normalize(); this.python = python;
        Files.createDirectories(this.path.getParent());
    }
    public Path path() { return path; }
    public List<String> load() {
        String[] lines = run("load", "").split("\\R");
        revision = Long.parseLong(lines[0]);
        return Arrays.asList(lines).subList(1, lines.length);
    }
    public void save(List<String> snapshot) {
        run("save", revision + "\n" + String.join("\n", snapshot) + "\n"); revision++;
    }
    private String run(String action, String input) {
        Process process = null;
        try {
            process = new ProcessBuilder(python, "database/store.py", action, path.toString()).redirectErrorStream(true).start();
            Process child = process;
            CompletableFuture<byte[]> output = CompletableFuture.supplyAsync(() -> {
                try { return child.getInputStream().readAllBytes(); } catch (java.io.IOException error) { throw new CompletionException(error); }
            });
            try (var writer = process.getOutputStream()) { writer.write(input.getBytes(StandardCharsets.UTF_8)); }
            if (!process.waitFor(20, TimeUnit.SECONDS)) { process.destroyForcibly(); throw new Failure(); }
            String result = new String(output.get(3, TimeUnit.SECONDS), StandardCharsets.UTF_8);
            if (process.exitValue() != 0) {
                if (result.contains("STORAGE_CONFLICT:")) throw new Conflict();
                throw new Failure();
            }
            return result;
        } catch (Conflict | Failure error) { throw error; }
        catch (Exception error) { if (process != null) process.destroyForcibly(); throw new Failure(); }
    }
    private static String field(Object value) { return value == null ? "-" : Base64.getEncoder().encodeToString(value.toString().getBytes(StandardCharsets.UTF_8)); }
    private static String row(String table, Object... values) { return table + "\t" + String.join("\t", Arrays.stream(values).map(DatabaseStore::field).toList()); }
    private static LocalDateTime time(String value) { return value == null ? null : LocalDateTime.parse(value); }
    public static List<String> snapshot(Map<String, User> users, IncidentService incidents, SLAService sla, AuditService audit, NotificationService notifications) {
        List<String> rows = new ArrayList<>();
        for (User user : users.values()) rows.add(row("accounts", user.getUserId(), user.getName(), user.getUsername(), user.getPasswordHash(), user.getEmail(), user.getRole(), user instanceof Employee e ? e.getDepartment() : null, user.isActive() ? 1 : 0, user instanceof Technician t ? (t.isMarkedAvailable() ? 1 : 0) : null));
        for (User user : users.values()) if (user instanceof Technician t) for (String skill : new TreeSet<>(t.getSkills())) rows.add(row("skills", t.getUserId(), skill));
        for (Incident i : incidents.getAllIncidents()) rows.add(row("incidents", i.getIncidentId(), i.getEmployeeId(), i.getTitle(), i.getDescription(), i.getCategory(), i.getImpact(), i.getUrgency(), i.getBusinessCriticality(), i.getPriority(), i.getStatus(), i.getTechnicianId(), i.getCreatedAt(), i.getAcknowledgedAt(), i.getResolvedAt(), i.getClosedAt(), i.getResolutionNotes(), sla.getResponseDeadline(i.getIncidentId()), sla.getResolutionDeadline(i.getIncidentId())));
        for (AuditLog log : audit.getAllLogs()) rows.add(row("audit", log.getTimestamp(), log.getUserId(), log.getAction(), log.getIncidentId(), log.getPreviousState(), log.getNewState(), log.getDescription()));
        for (String message : notifications.getAllInAppNotifications()) {
            int start = message.indexOf(" | To: ") + 7, end = message.indexOf(" | ", start);
            if (start < 7 || end < start) throw new IllegalStateException("Invalid stored notification.");
            rows.add(row("notifications", message.substring(start, end), message));
        }
        for (Incident i : incidents.getAllIncidents()) {
            int requestNumber = 0;
            for (InformationRequest request : i.getInformationRequests()) {
                rows.add(row("information_requests", i.getIncidentId(), ++requestNumber, request.getTechnicianId(), request.getQuestion(), request.getAskedAt()));
            }
        }
        for (Incident i : incidents.getAllIncidents()) {
            int requestNumber = 0;
            for (InformationRequest request : i.getInformationRequests()) {
                requestNumber++; int replyNumber = 0;
                for (InformationRequest.Reply reply : request.getReplies()) rows.add(row("information_replies", i.getIncidentId(), requestNumber, ++replyNumber, reply.employeeId(), reply.text(), reply.timestamp()));
            }
        }
        return rows;
    }
    public static State restore(List<String> rows) {
        Map<String, User> users = new LinkedHashMap<>(), ids = new HashMap<>();
        IncidentService incidents = new IncidentService(); SLAService sla = new SLAService(); AuditService audit = new AuditService(); NotificationService notifications = new NotificationService();
        Map<String, InformationRequest> requests = new HashMap<>();
        for (String line : rows) {
            if (line.isEmpty()) continue;
            String[] columns = line.split("\t", -1), v = new String[columns.length - 1];
            for (int n = 1; n < columns.length; n++) v[n - 1] = columns[n].equals("-") ? null : new String(Base64.getDecoder().decode(columns[n]), StandardCharsets.UTF_8);
            switch (columns[0]) {
                case "accounts" -> {
                    User user = switch (v[5]) {
                        case "EMPLOYEE" -> new Employee(v[0], v[1], v[2], "restore-only", v[4], v[6]);
                        case "TECHNICIAN" -> new Technician(v[0], v[1], v[2], "restore-only", v[4], Set.of());
                        case "ADMINISTRATOR" -> new Administrator(v[0], v[1], v[2], "restore-only", v[4]);
                        default -> throw new IllegalArgumentException("Invalid stored role.");
                    };
                    user.restorePasswordHash(v[3]); user.setActive(v[7].equals("1"));
                    if (user instanceof Technician t) t.setAvailable("1".equals(v[8]));
                    users.put(user.getUsername(), user); ids.put(user.getUserId(), user);
                }
                case "skills" -> ((Technician) ids.get(v[0])).addSkill(v[1]);
                case "incidents" -> {
                    Incident i = new Incident(v[0], v[1], v[2], v[3], Incident.Category.valueOf(v[4]), Integer.parseInt(v[5]), Integer.parseInt(v[6]), Integer.parseInt(v[7]), time(v[11]));
                    i.setPriority(Incident.Priority.valueOf(v[8])); i.setStatus(Incident.Status.valueOf(v[9])); i.setTechnicianId(v[10]); i.setAcknowledgedAt(time(v[12])); i.setResolvedAt(time(v[13])); i.setClosedAt(time(v[14])); i.setResolutionNotes(v[15]);
                    incidents.restoreIncident(i); sla.restoreTracking(v[0], time(v[16]), time(v[17]));
                    if (v[10] != null && i.getStatus() != Incident.Status.CLOSED) ((Technician) ids.get(v[10])).increaseWorkload();
                }
                case "audit" -> audit.restoreLog(new AuditLog(v[1], v[2], v[3], v[4], v[5], v[6], time(v[0])));
                case "notifications" -> notifications.restoreNotification(v[1]);
                case "information_requests" -> {
                    InformationRequest request = new InformationRequest(v[2], v[3], time(v[4]));
                    incidents.getIncident(v[0]).addInformationRequest(request); requests.put(v[0] + ":" + v[1], request);
                }
                case "information_replies" -> requests.get(v[0] + ":" + v[1]).addReply(v[3], v[4], time(v[5]));
                default -> throw new IllegalArgumentException("Unknown stored table.");
            }
        }
        return new State(users, incidents, sla, audit, notifications);
    }
}
