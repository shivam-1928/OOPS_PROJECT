package itsm.web;

import com.sun.net.httpserver.HttpExchange;
import com.sun.net.httpserver.HttpServer;
import itsm.model.*;
import itsm.service.*;
import itsm.strategy.*;
import itsm.storage.DatabaseStore;
import java.io.IOException;
import java.net.*;
import java.nio.charset.StandardCharsets;
import java.nio.file.*;
import java.time.*;
import java.util.*;
import java.util.concurrent.Executors;

/** Loopback web adapter for the existing course-project services. */
public final class WebServer {
    private IncidentService incidents = new IncidentService();
    private SLAService sla = new SLAService();
    private AuditService audit = new AuditService();
    private NotificationService notifications = new NotificationService();
    private IntelligentIncidentService intelligence = new IntelligentIncidentService(incidents, sla);
    private final ReportService reports = new ReportService();
    private final Map<String, User> users = new LinkedHashMap<>();
    private final Map<String, Session> sessions = new HashMap<>();
    private final Path frontend;
    private DatabaseStore storage;
    private boolean writeCommitted;
    private record Session(User user, Instant expires) {}
    private static final class HttpError extends RuntimeException {
        final int status;
        HttpError(int status, String message) { super(message); this.status = status; }
    }

    public WebServer(Path frontend) throws IOException {
        this.frontend = frontend.toRealPath();
        users.put("admin", new Administrator("A001", "System Admin", "admin", "admin123", "admin@iitsm.local"));
        users.put("employee", new Employee("E001", "Demo Employee", "employee", "emp123", "employee@iitsm.local", "General"));
        users.put("tech1", new Technician("T001", "Network Technician", "tech1", "tech123", "tech1@iitsm.local", Set.of("NETWORK", "EMAIL")));
        users.put("tech2", new Technician("T002", "Hardware Technician", "tech2", "tech123", "tech2@iitsm.local", Set.of("HARDWARE", "SOFTWARE", "ACCESS")));
    }

    public static void main(String[] args) throws IOException {
        int port = args.length > 0 ? Integer.parseInt(args[0]) : 8080;
        WebServer app = new WebServer(Path.of("frontend"));
        Path database = null; String python = System.getenv().getOrDefault("ITSM_PYTHON", "python");
        for (int n = 1; n < args.length; n++) {
            if (args[n].equals("--database") && n + 1 < args.length) database = Path.of(args[++n]);
            else if (args[n].equals("--python") && n + 1 < args.length) python = args[++n];
            else throw new IllegalArgumentException("Unknown server argument: " + args[n]);
        }
        if (database != null) {
            app.storage = new DatabaseStore(database, python);
            List<String> saved = app.storage.load();
            if (saved.stream().anyMatch(line -> line.startsWith("accounts\t"))) app.restore(saved);
            else app.storage.save(app.snapshot());
        }
        HttpServer server = HttpServer.create(new InetSocketAddress("127.0.0.1", port), 0);
        server.createContext("/", app::handle);
        server.setExecutor(Executors.newFixedThreadPool(4));
        server.start();
        System.out.println("I-ITSM: http://127.0.0.1:" + server.getAddress().getPort());
        System.out.println("Accounts: admin/admin123, employee/emp123, tech1/tech123, tech2/tech123");
        System.out.println(app.storage == null ? "In-memory test mode. Data resets when this server stops." : "Persistent SQLite storage: " + app.storage.path());
    }

    private List<String> snapshot() { return DatabaseStore.snapshot(users, incidents, sla, audit, notifications); }
    private void restore(List<String> rows) {
        DatabaseStore.State saved = DatabaseStore.restore(rows);
        users.clear(); users.putAll(saved.users()); incidents = saved.incidents(); sla = saved.sla(); audit = saved.audit(); notifications = saved.notifications();
        intelligence = new IntelligentIncidentService(incidents, sla);
        sessions.replaceAll((key, session) -> new Session(users.values().stream().filter(user -> user.getUserId().equals(session.user.getUserId())).findFirst().orElse(session.user), session.expires));
        sessions.values().removeIf(session -> !session.user.isActive() || !users.containsValue(session.user));
    }
    private boolean changesRecords(HttpExchange x) {
        String path = x.getRequestURI().getPath();
        return x.getRequestMethod().equals("POST") && !Set.of("/api/session", "/api/logout", "/api/priority").contains(path);
    }

    private void handle(HttpExchange exchange) throws IOException {
        try {
            exchange.getResponseHeaders().set("X-Content-Type-Options", "nosniff");
            exchange.getResponseHeaders().set("Referrer-Policy", "same-origin");
            String host = exchange.getRequestHeaders().getFirst("Host");
            String authority = "127.0.0.1:" + exchange.getLocalAddress().getPort();
            if (!authority.equals(host) && !("localhost:" + exchange.getLocalAddress().getPort()).equals(host))
                throw new HttpError(403, "Unrecognized host.");
            if (exchange.getRequestURI().getPath().startsWith("/api/")) {
                exchange.getResponseHeaders().set("Cache-Control", "no-store");
                if (!exchange.getRequestMethod().equals("GET")) {
                    String origin = exchange.getRequestHeaders().getFirst("Origin");
                    if (origin != null && !origin.equals("http://" + host)) throw new HttpError(403, "Cross-origin requests are not allowed.");
                }
                synchronized (this) {
                    List<String> before = storage != null && changesRecords(exchange) ? snapshot() : null;
                    Map<String, Session> previousSessions = before == null ? null : new HashMap<>(sessions);
                    writeCommitted = false;
                    try { api(exchange); }
                    catch (RuntimeException | IOException error) {
                        if (before != null && !writeCommitted) {
                            if (error instanceof DatabaseStore.Conflict) { restore(storage.load()); sessions.clear(); }
                            else { sessions.clear(); sessions.putAll(previousSessions); restore(before); }
                        }
                        throw error;
                    }
                }
            } else serve(exchange);
        } catch (DatabaseStore.Conflict error) {
            json(exchange, 409, Map.of("error", error.getMessage()));
        } catch (DatabaseStore.Failure error) {
            json(exchange, 503, Map.of("error", error.getMessage()));
        } catch (HttpError error) {
            json(exchange, error.status, Map.of("error", error.getMessage()));
        } catch (IllegalArgumentException error) {
            json(exchange, 400, Map.of("error", Objects.toString(error.getMessage(), "Invalid request.")));
        } catch (IllegalStateException error) {
            json(exchange, 409, Map.of("error", error.getMessage()));
        } catch (Exception error) {
            error.printStackTrace();
            json(exchange, 500, Map.of("error", "The server could not complete this request. Please retry."));
        } finally { exchange.close(); }
    }

    private void api(HttpExchange x) throws IOException {
        String path = x.getRequestURI().getPath();
        String method = x.getRequestMethod();
        if (path.equals("/api/greeting") && method.equals("GET")) {
            json(x, 200, Map.of("message", new GreetingService().greeting(), "timeZone", "Asia/Kolkata")); return;
        }
        if (path.equals("/api/capabilities") && method.equals("GET")) { json(x, 200, Map.of("registration", storage != null)); return; }
        if (path.equals("/api/register") && method.equals("POST")) {
            if (storage == null) throw new HttpError(503, "Registration is unavailable on this server. Open the database-connected app.");
            Map<String, String> f = form(x);
            String name = bounded(f, "name", 120), username = bounded(f, "username", 40), email = bounded(f, "email", 200), department = bounded(f, "department", 100);
            if (!username.matches("[A-Za-z0-9._-]{3,40}")) throw new IllegalArgumentException("Username must contain 3–40 letters, numbers, dots, underscores or hyphens.");
            if (!email.matches("[^\\s@]+@[^\\s@]+\\.[^\\s@]+")) throw new IllegalArgumentException("Enter a valid email address.");
            String password = f.getOrDefault("password", "");
            if (password.isBlank() || password.length() < 8 || password.length() > 128) throw new IllegalArgumentException("Password must contain 8–128 characters.");
            if (users.values().stream().anyMatch(user -> user.getUsername().equalsIgnoreCase(username))) throw new HttpError(409, "That username is already in use.");
            String id = nextId("E", users.values().stream().map(User::getUserId).toList(), 3);
            Employee employee = new Employee(id, name, username, password, email, department); users.put(username, employee);
            json(x, 201, Map.of("userId", id, "registered", true)); return;
        }
        if (path.equals("/api/session") && method.equals("POST")) {
            Map<String, String> form = form(x);
            User user = users.get(form.get("username"));
            if (user == null || !user.isActive() || !user.checkPassword(form.get("password")))
                throw new HttpError(401, "Invalid username or password.");
            sessions.values().removeIf(session -> session.expires.isBefore(Instant.now()));
            String token = UUID.randomUUID().toString();
            sessions.put(token, new Session(user, Instant.now().plusSeconds(8 * 3600)));
            x.getResponseHeaders().add("Set-Cookie", cookieName(x) + "=" + token + "; Path=/api; HttpOnly; SameSite=Strict; Max-Age=28800");
            json(x, 200, profileData(user)); return;
        }
        User actor = currentUser(x);
        if (path.equals("/api/session") && method.equals("GET")) { json(x, 200, profileData(actor)); return; }
        if (path.equals("/api/logout") && method.equals("POST")) {
            sessions.remove(token(x));
            x.getResponseHeaders().add("Set-Cookie", cookieName(x) + "=; Path=/api; HttpOnly; SameSite=Strict; Max-Age=0");
            json(x, 200, Map.of("ok", true)); return;
        }
        if (path.equals("/api/profile") && method.equals("POST")) {
            Map<String, String> f = form(x);
            String name = bounded(f, "name", 120), username = bounded(f, "username", 40), email = bounded(f, "email", 200);
            if (!username.matches("[A-Za-z0-9._-]{3,40}")) throw new IllegalArgumentException("Username must contain 3–40 letters, numbers, dots, underscores or hyphens.");
            if (!email.matches("[^\\s@]+@[^\\s@]+\\.[^\\s@]+")) throw new IllegalArgumentException("Enter a valid email address.");
            if (users.values().stream().anyMatch(u -> u != actor && u.getUsername().equalsIgnoreCase(username))) throw new HttpError(409, "That username is already in use.");
            String department = actor instanceof Employee ? bounded(f, "department", 100) : null;
            String phone = f.getOrDefault("phone", actor.getPhone()), picture = f.getOrDefault("profilePicture", actor.getProfilePicture());

            // Validate optional profile fields before changing the signed-in account.

            User validation = new Administrator("validation", "validation", "validation", "validation", "validation@example.com");

            validation.setPhone(phone); validation.setProfilePicture(picture);

            // Validate the complete update before changing any fields or the username lookup.
            Map<String, User> renamed = new LinkedHashMap<>();
            users.forEach((key, user) -> renamed.put(user == actor ? username : key, user));
            actor.setName(name); actor.setUsername(username); actor.setEmail(email); actor.setPhone(phone); actor.setProfilePicture(picture);

            if (actor instanceof Employee e) e.setDepartment(department);
            users.clear(); users.putAll(renamed);
            json(x, 200, profileData(actor)); return;
        }
        if (path.equals("/api/profile/password") && method.equals("POST")) {
            Map<String, String> f = form(x);
            String current = f.getOrDefault("currentPassword", ""), next = f.getOrDefault("newPassword", "");
            if (next.length() < 8 || next.length() > 128 || next.isBlank()) throw new IllegalArgumentException("New password must contain 8–128 characters.");
            if (current.equals(next)) throw new IllegalArgumentException("Choose a different new password.");
            actor.changePassword(current, next);
            String keep = token(x);
            sessions.entrySet().removeIf(entry -> entry.getValue().user == actor && !entry.getKey().equals(keep));
            json(x, 200, Map.of("ok", true)); return;
        }
        if (path.equals("/api/users") && method.equals("GET")) {
            require(actor instanceof Administrator, "Only administrators can view the user directory.");
            json(x, 200, Map.of("users", users.values().stream().map(u -> directoryData(u, actor)).toList())); return;
        }
        String[] userPath = path.split("/");
        if (userPath.length == 5 && userPath[2].equals("users") && userPath[4].equals("active") && method.equals("POST")) {
            require(actor instanceof Administrator, "Only administrators can change account status.");
            User target = users.values().stream().filter(u -> u.getUserId().equals(userPath[3])).findFirst().orElseThrow(() -> new HttpError(404, "User not found."));
            String value = required(form(x), "active");
            if (!Set.of("true", "false").contains(value)) throw new IllegalArgumentException("Active must be true or false.");
            if (value.equals("false")) {
                String reason = deactivationReason(target, actor);
                if (!reason.isEmpty()) throw new HttpError(409, reason);
            }
            target.setActive(Boolean.parseBoolean(value));
            if (!target.isActive()) sessions.values().removeIf(session -> session.user == target);
            json(x, 200, directoryData(target, actor)); return;
        }
        if (path.equals("/api/technicians") && method.equals("GET")) {
            json(x, 200, Map.of("technicians", technicians().stream().map(t -> technicianData(t, actor)).toList(),
                    "canManage", actor instanceof Administrator, "categories", Arrays.asList(Incident.Category.values())));
            return;
        }
        String[] technicianPath = path.split("/");
        if (technicianPath.length >= 4 && technicianPath[2].equals("technicians")) {
            Technician technician = technicians().stream().filter(t -> t.getUserId().equals(technicianPath[3])).findFirst()
                    .orElseThrow(() -> new HttpError(404, "Technician not found."));
            if (technicianPath.length == 4 && method.equals("GET")) {
                json(x, 200, technicianDetail(technician, actor)); return;
            }
            if (technicianPath.length == 5 && method.equals("POST")) {
                require(actor instanceof Administrator, "Only administrators can manage technicians.");
                Map<String, String> f = form(x);
                switch (technicianPath[4]) {
                    case "availability" -> {
                        String available = required(f, "available");
                        if (!Set.of("true", "false").contains(available)) throw new IllegalArgumentException("Availability must be true or false.");
                        require(technician.isActive(), "An inactive technician cannot be made available here.");
                        technician.setAvailable(Boolean.parseBoolean(available));
                    }
                    case "skills" -> technician.addSkill(required(f, "skill"));
                    default -> throw new HttpError(404, "Technician action not found.");
                }
                json(x, 200, technicianDetail(technician, actor)); return;
            }
        }
        if (path.equals("/api/outages/confirm") && method.equals("POST")) {
            require(actor instanceof Administrator, "Only administrators can confirm outages.");
            String id = required(form(x), "anchor");
            var spike = DeskInsights.spikes(incidents.getAllIncidents(), LocalDateTime.now()).stream()
                    .filter(a -> a.anchor().getIncidentId().equals(id)).findFirst()
                    .orElseThrow(() -> new IllegalStateException("Alert has expired. Refresh Overview."));
            if (!outageConfirmed(id)) {
                String status = spike.anchor().getStatus().name();
                audit.record(actor.getUserId(), "CONFIRM_OUTAGE", id, status, status,
                        "Confirmed shared outage for " + spike.anchor().getCategory() + ".");
            }
            json(x, 200, Map.of("confirmed", true)); return;
        }
        if (path.equals("/api/incidents") && method.equals("GET")) {
            Map<String, String> filters = decode(x.getRequestURI().getRawQuery());
            List<Incident> visible = visible(actor);
            // ReportService's technician filter dereferences null for unassigned incidents.
            // Remove those before delegating, without changing the original service.
            if (!filters.getOrDefault("technicianId", "").isBlank()) visible.removeIf(i -> i.getTechnicianId() == null);
            visible = reports.searchIncidents(visible, filters.get("category"), filters.get("priority"), filters.get("status"), filters.get("employeeId"), filters.get("technicianId"));
            List<Object> rows = new ArrayList<>();
            visible.forEach(i -> rows.add(incidentData(i, actor)));
            List<Object> people = new ArrayList<>();
            if (actor instanceof Administrator) users.values().forEach(u -> people.add(userData(u)));
            else {
                people.add(userData(actor));
                for (Technician t : technicians()) if (!t.getUserId().equals(actor.getUserId())) people.add(userData(t));
            }
            json(x, 200, Map.of("outages", actor instanceof Administrator ? outageAlerts() : List.of(), "incidents", rows, "users", people, "notifications", notifications.getNotificationsFor(actor.getUserId()),
                    "categories", Arrays.asList(Incident.Category.values()), "statuses", Arrays.asList(Incident.Status.values()), "storage", storage == null ? "MEMORY" : "SQLITE")); return;
        }
        if (path.equals("/api/priority") && method.equals("POST")) {
            Map<String, String> f = form(x);
            var priority = new PriorityCalculator().calculatePriority(score(f, "impact"), score(f, "urgency"), score(f, "businessCriticality"));
            json(x, 200, Map.of("priority", priority)); return;
        }
        if (path.equals("/api/incidents") && method.equals("POST")) {
            require(actor instanceof Employee, "Only employees can report incidents.");
            Map<String, String> f = form(x);
            String id = nextId("INC", incidents.getAllIncidents().stream().map(Incident::getIncidentId).toList(), 4);
            Incident i = new Incident(id, actor.getUserId(), required(f, "title"), required(f, "description"),
                    Incident.Category.valueOf(required(f, "category")), score(f, "impact"), score(f, "urgency"), score(f, "businessCriticality"));
            incidents.createIncident(i); sla.startTracking(i);
            audit.record(actor.getUserId(), "CREATE_INCIDENT", id, "NONE", i.getStatus().name(), "Incident reported.");
            notifications.sendInAppNotification(actor.getUserId(), "Incident " + id + " has been created with priority " + i.getPriority() + ".");
            json(x, 201, detail(i, actor)); return;
        }
        if (path.equals("/api/escalate") && method.equals("POST")) {
            require(actor instanceof Administrator, "Only administrators can run SLA escalation.");
            Map<String, String> old = new HashMap<>();
            incidents.getAllIncidents().forEach(i -> old.put(i.getIncidentId(), i.getStatus().name()));
            List<Incident> changed = intelligence.escalateSlaBreaches();
            for (Incident i : changed) {
                audit.record(actor.getUserId(), "AUTO_ESCALATE", i.getIncidentId(), old.get(i.getIncidentId()), i.getStatus().name(), "Escalated due to SLA breach.");
                notifications.sendInAppNotification(i.getEmployeeId(), "Incident " + i.getIncidentId() + " has been escalated.");
            }
            json(x, 200, Map.of("count", changed.size())); return;
        }
        String[] parts = path.split("/");
        if (parts.length >= 4 && parts[2].equals("incidents")) {
            Incident i = find(parts[3]);
            require(canView(i, actor), "You do not have access to this incident.");
            if (parts.length == 4 && method.equals("GET")) { json(x, 200, detail(i, actor)); return; }
            if (parts.length == 5 && method.equals("POST")) {
                String action = parts[4];
                require(actions(i, actor).contains(action), "This action is not available for your role and the current incident status. Refresh the incident.");
                Map<String, String> f = form(x);
                String old = i.getStatus().name();
                String notes = "Incident updated.";
                switch (action) {
                    case "assign" -> {
                        String strategy = required(f, "strategy");
                        TechnicianAssignmentStrategy choice;
                        if ("RECOMMENDED".equals(strategy)) {
                            var pick = DeskInsights.recommend(i.getCategory(), technicians(), incidents.getAllIncidents())
                                    .orElseThrow(() -> new IllegalStateException("No technicians available."));
                            if (!pick.technician().getUserId().equals(required(f, "recommendedId")))
                                throw new IllegalStateException("The recommendation changed. Refresh this ticket.");
                            // Use the ordinary assignment workflow with the verified candidate.
                            choice = new LoadBasedAssignment();
                            incidents.assignIncident(i.getIncidentId(), List.of(pick.technician()), choice);
                            notes = "Assigned by recommendation. " + pick.reason();
                        } else {
                            choice = switch (strategy) {
                                case "SKILL" -> new SkillBasedAssignment();
                                case "LOAD" -> new LoadBasedAssignment();
                                default -> throw new IllegalArgumentException("Unknown assignment strategy.");
                            };
                            incidents.assignIncident(i.getIncidentId(), technicians(), choice);
                            notes = "Assigned using " + choice.getStrategyName();
                        }
                        notifications.sendInAppNotification(i.getTechnicianId(), "Incident " + i.getIncidentId() + " has been assigned to you.");
                    }
                    case "reassign" -> {

                        String previousId = i.getTechnicianId();

                        String nextId = required(f, "technicianId");

                        incidents.reassignIncident(i.getIncidentId(), required(f, "expectedTechnicianId"),

                                Incident.Status.valueOf(required(f, "expectedStatus")), nextId, technicians());

                        Technician next = technicians().stream().filter(t -> t.getUserId().equals(nextId)).findFirst().orElseThrow();

                        notes = "Manually reassigned from " + previousId + " to " + nextId + " (" + next.getUsername() + "). Original SLA deadlines and earlier work retained; new technician must acknowledge.";

                        notifications.sendInAppNotification(previousId, "Incident " + i.getIncidentId() + " has been reassigned from you to " + nextId + " (" + next.getUsername() + ").");

                        notifications.sendInAppNotification(nextId, "Incident " + i.getIncidentId() + " has been reassigned to you by administrator " + actor.getUserId() + ". Please acknowledge it.");

                        notifications.sendInAppNotification(i.getEmployeeId(), "Incident " + i.getIncidentId() + " is now assigned to " + next.getName() + " · " + nextId + " (" + next.getUsername() + ").");

                    }

                    case "acknowledge" -> incidents.acknowledgeIncident(i.getIncidentId(), actor.getUserId());
                    case "start" -> incidents.startInvestigation(i.getIncidentId(), actor.getUserId());
                    case "request-information" -> {
                        String question = required(f, "question");
                        incidents.requestEmployeeInformation(i.getIncidentId(), actor.getUserId(), question);
                        notes = "Technician question: " + question;
                        notifications.sendInAppNotification(i.getEmployeeId(), "Incident " + i.getIncidentId() + " needs your information. Question: " + question);
                    }
                    case "resume" -> incidents.resumeInvestigation(i.getIncidentId(), actor.getUserId());
                    case "resolve" -> {
                        notes = required(f, "notes");
                        incidents.resolveIncident(i.getIncidentId(), actor.getUserId(), notes);
                        notifications.sendConsoleNotification(i.getEmployeeId(), "Incident " + i.getIncidentId() + " has been resolved. Please log in to verify it.");
                    }
                    case "verify" -> incidents.verifyIncident(i.getIncidentId(), actor.getUserId());
                    case "close" -> {
                        incidents.closeIncident(i.getIncidentId(), actor.getUserId());
                        technicians().stream().filter(t -> t.getUserId().equals(i.getTechnicianId())).forEach(Technician::decreaseWorkload);
                    }
                    case "add-information" -> {
                        notes = required(f, "notes");
                        incidents.addEmployeeInformation(i.getIncidentId(), actor.getUserId(), notes);
                        if (i.getStatus() == Incident.Status.WAITING_FOR_EMPLOYEE && i.getTechnicianId() != null) {
                            notifications.sendInAppNotification(i.getTechnicianId(), "Employee replied to incident " + i.getIncidentId() + ": " + notes);
                        }
                    }
                    default -> throw new HttpError(404, "Unknown action.");
                }
                audit.record(actor.getUserId(), action.toUpperCase(Locale.ROOT).replace('-', '_'), i.getIncidentId(), old, i.getStatus().name(), notes);
                if (actor instanceof Technician && !action.equals("request-information")) notifications.sendInAppNotification(i.getEmployeeId(), "Incident " + i.getIncidentId() + " status is now " + i.getStatus() + ".");
                json(x, 200, detail(i, actor)); return;
            }
        }
        throw new HttpError(404, "API route not found.");
    }

    private List<String> actions(Incident i, User actor) {
        List<String> result = new ArrayList<>();
        if (actor instanceof Administrator && i.getTechnicianId() != null && Set.of(Incident.Status.ASSIGNED,

                Incident.Status.ACKNOWLEDGED, Incident.Status.IN_PROGRESS, Incident.Status.WAITING_FOR_EMPLOYEE, Incident.Status.ESCALATED).contains(i.getStatus())) result.add("reassign");

        if (actor instanceof Administrator && i.getTechnicianId() == null && Set.of(Incident.Status.CLASSIFIED, Incident.Status.ESCALATED).contains(i.getStatus())) result.add("assign");
        if (actor instanceof Employee && i.getEmployeeId().equals(actor.getUserId())) {
            result.add("add-information");
            if (i.getStatus() == Incident.Status.RESOLVED) result.add("verify");
            if (i.getStatus() == Incident.Status.VERIFIED) result.add("close");
        }
        if (actor instanceof Technician && actor.getUserId().equals(i.getTechnicianId())) {
            switch (i.getStatus()) {
                case ASSIGNED -> result.add("acknowledge");
                case ACKNOWLEDGED -> result.add("start");
                case IN_PROGRESS -> { result.add("request-information"); result.add("resolve"); }
                case WAITING_FOR_EMPLOYEE -> result.add("resume");
                default -> { }
            }
        }
        return result;
    }

    private Map<String, Object> incidentData(Incident i, User actor) {
        Map<String, Object> data = new LinkedHashMap<>();
        data.put("incidentId", i.getIncidentId()); data.put("employeeId", i.getEmployeeId());
        data.put("title", i.getTitle()); data.put("description", i.getDescription()); data.put("category", i.getCategory());
        data.put("impact", i.getImpact()); data.put("urgency", i.getUrgency()); data.put("businessCriticality", i.getBusinessCriticality());
        data.put("priority", i.getPriority()); data.put("status", i.getStatus()); data.put("technicianId", i.getTechnicianId());
        data.put("createdAt", i.getCreatedAt()); data.put("acknowledgedAt", i.getAcknowledgedAt());
        data.put("resolvedAt", i.getResolvedAt()); data.put("closedAt", i.getClosedAt()); data.put("resolutionNotes", i.getResolutionNotes());
        data.put("responseDeadline", sla.getResponseDeadline(i.getIncidentId())); data.put("resolutionDeadline", sla.getResolutionDeadline(i.getIncidentId()));
        data.put("slaStatus", sla.getSLAStatus(i)); data.put("actions", actions(i, actor));
        return data;
    }

    private boolean outageConfirmed(String id) {
        return audit.getLogsForIncident(id).stream().anyMatch(log -> "CONFIRM_OUTAGE".equals(log.getAction()));
    }

    private Map<String, String> recommendation(Incident i) {
        return DeskInsights.recommend(i.getCategory(), technicians(), incidents.getAllIncidents())
                .map(r -> Map.of("id", r.technician().getUserId(), "name", r.technician().getName(), "reason", r.reason()))
                .orElse(Map.of());
    }

    private List<Object> outageAlerts() {
        List<Object> result = new ArrayList<>();
        for (var spike : DeskInsights.spikes(incidents.getAllIncidents(), LocalDateTime.now())) {
            var anchor = spike.anchor();
            result.add(Map.of("anchor", anchor.getIncidentId(), "category", anchor.getCategory(),
                    "confirmed", outageConfirmed(anchor.getIncidentId()), "baseline", spike.baseline(),
                    "tickets", spike.recent().stream().map(Incident::getIncidentId).toList(),
                    "recommendation", recommendation(anchor)));
        }
        return result;
    }

    private Map<String, Object> detail(Incident i, User actor) {
        Map<String, Object> data = incidentData(i, actor);
        List<Object> logs = new ArrayList<>();
        for (AuditLog log : audit.getLogsForIncident(i.getIncidentId())) {
            Map<String, Object> item = new LinkedHashMap<>();
            item.put("timestamp", log.getTimestamp()); item.put("userId", log.getUserId()); item.put("action", log.getAction());
            item.put("previousState", log.getPreviousState()); item.put("newState", log.getNewState()); item.put("description", log.getDescription());
            logs.add(item);
        }
        data.put("history", logs);
        if (actions(i, actor).contains("assign")) data.put("recommendation", recommendation(i));
        List<Object> requests = new ArrayList<>();
        for (InformationRequest request : i.getInformationRequests()) {
            List<Object> replies = new ArrayList<>();
            for (InformationRequest.Reply reply : request.getReplies()) {
                replies.add(Map.of("employeeId", reply.employeeId(), "text", reply.text(), "timestamp", reply.timestamp()));
            }
            requests.add(Map.of("technicianId", request.getTechnicianId(), "question", request.getQuestion(), "askedAt", request.getAskedAt(), "replies", replies));
        }
        data.put("informationRequests", requests);
        data.put("duplicates", intelligence.findPossibleDuplicates(i).stream().filter(other -> canView(other, actor)).map(other -> Map.of("incidentId", other.getIncidentId(), "title", other.getTitle())).toList());
        return data;
    }

    private Map<String, Object> userData(User user) {
        Map<String, Object> data = new LinkedHashMap<>();
        data.put("userId", user.getUserId()); data.put("name", user.getName()); data.put("role", user.getRole());
        if (user instanceof Technician t) { data.put("username", t.getUsername()); data.put("skills", t.getSkills()); data.put("available", t.isAvailable()); data.put("activeIncidentCount", t.getActiveIncidentCount()); }

        return data;
    }
    private Map<String, Object> profileData(User user) {
        Map<String, Object> data = userData(user);
        data.put("username", user.getUsername()); data.put("email", user.getEmail()); data.put("active", user.isActive());
        data.put("phone", user.getPhone()); data.put("profilePicture", user.getProfilePicture());

        if (user instanceof Employee employee) data.put("department", employee.getDepartment());
        return data;
    }
    private String deactivationReason(User target, User actor) {
        if (target == actor) return "You cannot deactivate your own administrator account.";
        if (target instanceof Technician t && t.getActiveIncidentCount() > 0) return "Close this technician's existing assignments before deactivating the account.";
        if (target instanceof Employee && incidents.getIncidentsReportedBy(target.getUserId()).stream().anyMatch(i -> i.getStatus() != Incident.Status.CLOSED)) return "Close this employee's outstanding tickets before deactivating the account.";
        return "";
    }
    private Map<String, Object> directoryData(User user, User actor) {
        Map<String, Object> data = profileData(user);
        data.put("deactivationReason", deactivationReason(user, actor));
        return data;
    }
    private Map<String, Object> technicianData(Technician technician, User actor) {
        Map<String, Object> data = userData(technician);
        data.remove("username"); // Assignment identity comes from incident metadata; keep the general directory unchanged.

        data.put("email", technician.getEmail());
        data.put("active", technician.isActive());
        data.put("canManage", actor instanceof Administrator);
        return data;
    }
    private Map<String, Object> technicianDetail(Technician technician, User actor) {
        Map<String, Object> data = technicianData(technician, actor);
        data.put("incidents", incidents.getIncidentsAssignedTo(technician.getUserId()).stream()
                .filter(i -> canView(i, actor)).map(i -> incidentData(i, actor)).toList());
        data.put("allAssignmentsVisible", actor instanceof Administrator || actor.getUserId().equals(technician.getUserId()));
        return data;
    }
    private List<Technician> technicians() { return users.values().stream().filter(u -> u instanceof Technician).map(u -> (Technician) u).toList(); }
    private List<Incident> visible(User u) { return new ArrayList<>(incidents.getAllIncidents().stream().filter(i -> canView(i, u)).toList()); }
    private boolean canView(Incident i, User u) { return u instanceof Administrator || u instanceof Employee && u.getUserId().equals(i.getEmployeeId()) || u instanceof Technician && u.getUserId().equals(i.getTechnicianId()); }
    private Incident find(String id) {
        try { return incidents.getIncident(id); } catch (IllegalArgumentException e) { throw new HttpError(404, e.getMessage()); }
    }
    private String token(HttpExchange x) {
        String cookies = x.getRequestHeaders().getFirst("Cookie");
        String prefix = cookieName(x) + "=";
        if (cookies != null) for (String cookie : cookies.split(";")) if (cookie.trim().startsWith(prefix)) return cookie.trim().substring(prefix.length());
        return "";
    }
    private static String cookieName(HttpExchange x) { return "itsm_session_" + x.getLocalAddress().getPort(); }
    private User currentUser(HttpExchange x) {
        Session session = sessions.get(token(x));
        if (session == null || session.expires.isBefore(Instant.now()) || !session.user.isActive()) throw new HttpError(401, "Please sign in to continue.");
        return session.user;
    }
    private static void require(boolean condition, String message) { if (!condition) throw new HttpError(403, message); }
    private static String required(Map<String, String> f, String key) {
        String value = f.getOrDefault(key, "").trim();
        if (value.isEmpty()) throw new IllegalArgumentException(key + " is required.");
        return value;
    }
    private static String bounded(Map<String, String> f, String key, int maximum) {
        String value = required(f, key);
        if (value.length() > maximum) throw new IllegalArgumentException(key + " must be " + maximum + " characters or fewer.");
        return value;
    }
    private static String nextId(String prefix, List<String> ids, int width) {
        int next = ids.stream().filter(id -> id.matches(prefix + "\\d+")).mapToInt(id -> Integer.parseInt(id.substring(prefix.length()))).max().orElse(0) + 1;
        return prefix + String.format("%0" + width + "d", next);
    }
    private static int score(Map<String, String> f, String key) {
        try { int value = Integer.parseInt(required(f, key)); if (value < 1 || value > 5) throw new NumberFormatException(); return value; }
        catch (NumberFormatException e) { throw new IllegalArgumentException(key + " must be a whole number from 1 to 5."); }
    }
    private static Map<String, String> form(HttpExchange x) throws IOException {
        if (!Objects.toString(x.getRequestHeaders().getFirst("Content-Type"), "").startsWith("application/x-www-form-urlencoded")) throw new HttpError(415, "Expected a URL-encoded form.");
        byte[] bytes = x.getRequestBody().readNBytes(65537);
        if (bytes.length > 65536) throw new HttpError(413, "Request is too large.");
        return decode(new String(bytes, StandardCharsets.UTF_8));
    }
    private static Map<String, String> decode(String body) {
        Map<String, String> result = new HashMap<>();
        if (body == null || body.isEmpty()) return result;
        for (String pair : body.split("&")) {
            String[] parts = pair.split("=", 2);
            String key = URLDecoder.decode(parts[0], StandardCharsets.UTF_8);
            if (result.putIfAbsent(key, parts.length == 2 ? URLDecoder.decode(parts[1], StandardCharsets.UTF_8) : "") != null) throw new IllegalArgumentException("Duplicate form field.");
        }
        return result;
    }
    private void json(HttpExchange x, int status, Object body) throws IOException {
        byte[] bytes = Json.encode(body).getBytes(StandardCharsets.UTF_8);
        if (storage != null && status >= 200 && status < 300 && changesRecords(x)) { storage.save(snapshot()); writeCommitted = true; }
        x.getResponseHeaders().set("Content-Type", "application/json; charset=utf-8");
        x.sendResponseHeaders(status, bytes.length); x.getResponseBody().write(bytes);
    }
    private void serve(HttpExchange x) throws IOException {
        if (!x.getRequestMethod().equals("GET")) throw new HttpError(405, "Method not allowed.");
        String request = x.getRequestURI().getPath();
        Path file = frontend.resolve(request.equals("/") ? "index.html" : request.substring(1)).normalize();
        if (!file.startsWith(frontend) || !Files.isRegularFile(file) || !file.toRealPath().startsWith(frontend)) throw new HttpError(404, "File not found.");
        String name = file.getFileName().toString();
        String type = name.endsWith(".html") ? "text/html; charset=utf-8" : name.endsWith(".css") ? "text/css; charset=utf-8" : name.endsWith(".js") ? "text/javascript; charset=utf-8" : name.endsWith(".png") ? "image/png" : (name.endsWith(".jpg") || name.endsWith(".jpeg")) ? "image/jpeg" : name.endsWith(".pdf") ? "application/pdf" : "text/plain; charset=utf-8";
        byte[] bytes = Files.readAllBytes(file);
        x.getResponseHeaders().set("Content-Type", type); x.getResponseHeaders().set("Cache-Control", "no-cache");
        x.sendResponseHeaders(200, bytes.length); x.getResponseBody().write(bytes);
    }
}
