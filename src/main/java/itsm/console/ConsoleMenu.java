package itsm.console;

import java.util.ArrayList;
import java.util.Arrays;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Scanner;
import java.util.Set;
import java.util.HashSet;

import itsm.model.Administrator;
import itsm.model.Employee;
import itsm.model.Incident;
import itsm.model.Technician;
import itsm.model.User;
import itsm.service.AuditService;
import itsm.service.IncidentService;
import itsm.service.IntelligentIncidentService;
import itsm.service.NotificationService;
import itsm.service.ReportService;
import itsm.service.SLAService;
import itsm.strategy.LoadBasedAssignment;
import itsm.strategy.SkillBasedAssignment;
import itsm.strategy.TechnicianAssignmentStrategy;

public class ConsoleMenu {
    private final Scanner scanner;
    private final Map<String, User> users;
    private final IncidentService incidentService;
    private final SLAService slaService;
    private final AuditService auditService;
    private final NotificationService notificationService;
    private final IntelligentIncidentService intelligentService;
    private final ReportService reportService;

    private final itsm.persistence.Database database;

    public ConsoleMenu() {
        scanner = new Scanner(System.in);
        users = new LinkedHashMap<>();
        incidentService = new IncidentService();
        slaService = new SLAService();
        auditService = new AuditService();
        notificationService = new NotificationService();
        intelligentService = new IntelligentIncidentService(incidentService, slaService);
        reportService = new ReportService();
        database = new itsm.persistence.Database(users, incidentService, slaService, auditService, notificationService);
        database.load();
        if (users.isEmpty()) {
            addDemoUsers();
            database.save();
        }
    }

    private void addDemoUsers() {
        users.put("admin", new Administrator("A001", "System Admin",
                "admin", "admin123", "admin@iitsm.local"));
        users.put("employee", new Employee("E001", "Demo Employee",
                "employee", "emp123", "employee@iitsm.local", "General"));
        users.put("tech1", new Technician("T001", "Network Technician",
                "tech1", "tech123", "tech1@iitsm.local",
                new HashSet<>(Arrays.asList("NETWORK", "EMAIL"))));
        users.put("tech2", new Technician("T002", "Hardware Technician",
                "tech2", "tech123", "tech2@iitsm.local",
                new HashSet<>(Arrays.asList("HARDWARE", "SOFTWARE", "ACCESS"))));
    }

    public void start() {
        System.out.println("======================================");
        System.out.println("       I-ITSM SERVICE MANAGEMENT");
        System.out.println("======================================");
        System.out.println("Demo accounts: admin/admin123, employee/emp123,");
        System.out.println("               tech1/tech123, tech2/tech123");

        boolean running = true;
        while (running) {
            System.out.println("\n1. Login\n2. Register employee\n0. Exit");
            int choice = readInt("Choose: ");
            switch (choice) {
                case 1:
                    login();
                    break;
                case 2:
                    registerEmployee();
                    break;
                case 0:
                    running = false;
                    break;
                default:
                    System.out.println("Invalid choice.");
            }
        }
        System.out.println("Thank you for using I-ITSM.");
    }

    private void login() {
        String username = readText("Username: ");
        String password = readText("Password: ");
        User user = users.get(username);

        if (user == null || !user.isActive() || !user.checkPassword(password)) {
            System.out.println("Invalid login details.");
            return;
        }

        if (user instanceof Employee) {
            employeeMenu((Employee) user);
        } else if (user instanceof Technician) {
            technicianMenu((Technician) user);
        } else if (user instanceof Administrator) {
            administratorMenu((Administrator) user);
        }
    }

    private void registerEmployee() {
        String name = readText("Name: ");
        String username = readText("Choose username: ");
        if (users.containsKey(username)) {
            System.out.println("That username is already in use.");
            return;
        }
        String password = readText("Password: ");
        String email = readText("Email: ");
        String department = readText("Department: ");
        String id = "E" + String.format("%03d", users.size() + 1);
        Employee employee = new Employee(id, name, username, password, email, department);
        users.put(username, employee);
        database.save();
        System.out.println("Employee registered. Your user ID is " + id);
    }

    private void employeeMenu(Employee employee) {
        boolean active = true;
        while (active) {
            System.out.println("\n===== EMPLOYEE MENU =====");
            System.out.println("1. Report incident");
            System.out.println("2. View my incidents");
            System.out.println("3. Add information to incident");
            System.out.println("4. View notifications");
            System.out.println("5. Verify resolved incident");
            System.out.println("6. Close verified incident");
            System.out.println("0. Logout");
            int choice = readInt("Choose: ");

            try {
                switch (choice) {
                    case 1: createIncident(employee); break;
                    case 2: showIncidents(incidentService.getIncidentsReportedBy(employee.getUserId())); break;
                    case 3: addInformation(employee); break;
                    case 4: showNotifications(employee.getUserId()); break;
                    case 5: verifyIncident(employee); break;
                    case 6: closeIncident(employee); break;
                    case 0: active = false; break;
                    default: System.out.println("Invalid choice.");
                }
            } catch (RuntimeException ex) {
                if (ex instanceof java.io.UncheckedIOException) throw ex;
                System.out.println("Operation failed: " + ex.getMessage());
            }
        }
    }

    private void createIncident(Employee employee) {
        String id = "INC" + String.format("%04d", incidentService.getAllIncidents().size() + 1);
        String title = readText("Title: ");
        String description = readText("Description: ");
        Incident.Category category = chooseCategory();
        int impact = readRange("Impact (1-5): ", 1, 5);
        int urgency = readRange("Urgency (1-5): ", 1, 5);
        int criticality = readRange("Business criticality (1-5): ", 1, 5);

        Incident incident = new Incident(id, employee.getUserId(), title,
                description, category, impact, urgency, criticality);
        incidentService.createIncident(incident);
        slaService.startTracking(incident);
        auditService.record(employee.getUserId(), "CREATE_INCIDENT", id,
                "NONE", incident.getStatus().name(), "Incident reported.");
        notificationService.sendInAppNotification(employee.getUserId(),
                "Incident " + id + " has been created with priority " + incident.getPriority() + ".");
        database.save();
        System.out.println("Incident created. ID: " + id
                + " | Priority: " + incident.getPriority());
        List<Incident> duplicates = intelligentService.findPossibleDuplicates(incident);
        if (!duplicates.isEmpty()) {
            System.out.println("Warning: " + duplicates.size()
                    + " possible duplicate incident(s) found.");
        }
    }

    private void addInformation(Employee employee) {
        String id = readText("Incident ID: ");
        Incident incident = incidentService.getIncident(id);
        if (!incident.getEmployeeId().equals(employee.getUserId())) {
            throw new IllegalArgumentException("You can only update your own incidents.");
        }
        String extra = readText("Additional information: ");
        incident.setDescription(incident.getDescription() + "\nAdditional information: " + extra);
        auditService.record(employee.getUserId(), "ADD_INFORMATION", id,
                incident.getStatus().name(), incident.getStatus().name(), extra);
        database.save();
        System.out.println("Information added.");
    }

    private void verifyIncident(Employee employee) {
        String id = readText("Incident ID: ");
        Incident incident = incidentService.getIncident(id);
        Incident.Status old = incident.getStatus();
        incidentService.verifyIncident(id, employee.getUserId());
        auditService.record(employee.getUserId(), "VERIFY_INCIDENT", id,
                old.name(), incident.getStatus().name(), "Employee verified resolution.");
        database.save();
        System.out.println("Incident verified.");
    }

    private void closeIncident(Employee employee) {
        String id = readText("Incident ID: ");
        Incident incident = incidentService.getIncident(id);
        Incident.Status old = incident.getStatus();
        incidentService.closeIncident(id, employee.getUserId());
        reduceTechnicianWorkload(incident);
        auditService.record(employee.getUserId(), "CLOSE_INCIDENT", id,
                old.name(), incident.getStatus().name(), "Incident closed.");
        database.save();
        System.out.println("Incident closed.");
    }

    private void technicianMenu(Technician technician) {
        boolean active = true;
        while (active) {
            System.out.println("\n===== TECHNICIAN MENU =====");
            System.out.println("1. View assigned incidents");
            System.out.println("2. Acknowledge incident");
            System.out.println("3. Start investigation");
            System.out.println("4. Request employee information");
            System.out.println("5. Resume investigation");
            System.out.println("6. Resolve incident");
            System.out.println("7. View notifications");
            System.out.println("0. Logout");
            int choice = readInt("Choose: ");

            try {
                switch (choice) {
                    case 1: showIncidents(incidentService.getIncidentsAssignedTo(technician.getUserId())); break;
                    case 2: technicianAction(technician, "ACKNOWLEDGE"); break;
                    case 3: technicianAction(technician, "START"); break;
                    case 4: technicianAction(technician, "REQUEST"); break;
                    case 5: technicianAction(technician, "RESUME"); break;
                    case 6: resolveIncident(technician); break;
                    case 7: showNotifications(technician.getUserId()); break;
                    case 0: active = false; break;
                    default: System.out.println("Invalid choice.");
                }
            } catch (RuntimeException ex) {
                if (ex instanceof java.io.UncheckedIOException) throw ex;
                System.out.println("Operation failed: " + ex.getMessage());
            }
        }
    }

    private void technicianAction(Technician technician, String action) {
        String id = readText("Incident ID: ");
        Incident incident = incidentService.getIncident(id);
        Incident.Status old = incident.getStatus();

        if ("ACKNOWLEDGE".equals(action)) {
            incidentService.acknowledgeIncident(id, technician.getUserId());
        } else if ("START".equals(action)) {
            incidentService.startInvestigation(id, technician.getUserId());
        } else if ("REQUEST".equals(action)) {
            incidentService.requestEmployeeInformation(id, technician.getUserId());
        } else {
            incidentService.resumeInvestigation(id, technician.getUserId());
        }

        auditService.record(technician.getUserId(), action, id,
                old.name(), incident.getStatus().name(), "Technician updated incident.");
        notificationService.sendInAppNotification(incident.getEmployeeId(),
                "Incident " + id + " status is now " + incident.getStatus() + ".");
        database.save();
        System.out.println("Incident status updated to " + incident.getStatus());
    }

    private void resolveIncident(Technician technician) {
        String id = readText("Incident ID: ");
        String notes = readText("Resolution notes: ");
        Incident incident = incidentService.getIncident(id);
        Incident.Status old = incident.getStatus();
        incidentService.resolveIncident(id, technician.getUserId(), notes);
        auditService.record(technician.getUserId(), "RESOLVE_INCIDENT", id,
                old.name(), incident.getStatus().name(), notes);
        notificationService.sendConsoleNotification(incident.getEmployeeId(),
                "Incident " + id + " has been resolved. Please log in to verify it.");
        notificationService.sendInAppNotification(incident.getEmployeeId(),
                "Incident " + id + " has been resolved.");
        database.save();
        System.out.println("Incident resolved.");
    }

    private void administratorMenu(Administrator administrator) {
        boolean active = true;
        while (active) {
            System.out.println("\n===== ADMINISTRATOR MENU =====");
            System.out.println("1. View all incidents");
            System.out.println("2. Assign incident");
            System.out.println("3. Incident summary report");
            System.out.println("4. Technician workload report");
            System.out.println("5. Search incidents");
            System.out.println("6. View audit logs");
            System.out.println("7. Check SLA status");
            System.out.println("8. Run automatic SLA escalation");
            System.out.println("9. View registered users");
            System.out.println("0. Logout");
            int choice = readInt("Choose: ");

            try {
                switch (choice) {
                    case 1: showIncidents(incidentService.getAllIncidents()); break;
                    case 2: assignIncident(administrator); break;
                    case 3: reportService.printIncidentSummary(incidentService.getAllIncidents()); break;
                    case 4: reportService.printTechnicianWorkload(getTechnicians()); break;
                    case 5: searchIncidents(); break;
                    case 6: showAuditLogs(); break;
                    case 7: checkSla(); break;
                    case 8: runEscalation(administrator); break;
                    case 9: showUsers(); break;
                    case 0: active = false; break;
                    default: System.out.println("Invalid choice.");
                }
            } catch (RuntimeException ex) {
                if (ex instanceof java.io.UncheckedIOException) throw ex;
                System.out.println("Operation failed: " + ex.getMessage());
            }
        }
    }

    private void assignIncident(Administrator administrator) {
        String id = readText("Incident ID: ");
        System.out.println("1. Skill-based\n2. Load-based");
        int choice = readRange("Strategy: ", 1, 2);
        TechnicianAssignmentStrategy strategy = choice == 1
                ? new SkillBasedAssignment() : new LoadBasedAssignment();
        Incident incident = incidentService.getIncident(id);
        String previousStatus = incident.getStatus().name();
        Incident assigned = incidentService.assignIncident(id, getTechnicians(), strategy);
        auditService.record(administrator.getUserId(), "ASSIGN_INCIDENT", id,
                previousStatus, assigned.getStatus().name(),
                "Assigned using " + strategy.getStrategyName());
        notificationService.sendInAppNotification(assigned.getTechnicianId(),
                "Incident " + id + " has been assigned to you.");
        database.save();
        System.out.println("Assigned to technician ID: " + assigned.getTechnicianId());
    }

    private void searchIncidents() {
        System.out.println("Leave a filter blank to ignore it.");
        String category = readText("Category (NETWORK/HARDWARE/SOFTWARE/EMAIL/ACCESS/OTHER): ");
        String priority = readText("Priority (P1/P2/P3/P4): ");
        String status = readText("Status: ");
        String employeeId = readText("Employee ID: ");
        String technicianId = readText("Technician ID: ");
        List<Incident> results = reportService.searchIncidents(
                incidentService.getAllIncidents(), category, priority, status,
                employeeId, technicianId);
        showIncidents(results);
    }

    private void showAuditLogs() {
        if (auditService.getAllLogs().isEmpty()) {
            System.out.println("No audit records.");
            return;
        }
        for (Object log : auditService.getAllLogs()) {
            System.out.println(log);
        }
    }

    private void checkSla() {
        String id = readText("Incident ID: ");
        Incident incident = incidentService.getIncident(id);
        System.out.println("Response deadline: " + slaService.getResponseDeadline(id));
        System.out.println("Resolution deadline: " + slaService.getResolutionDeadline(id));
        System.out.println("SLA status: " + slaService.getSLAStatus(incident));
    }

    private void runEscalation(Administrator administrator) {
        List<Incident> escalated = intelligentService.escalateSlaBreaches();
        for (Incident incident : escalated) {
            auditService.record(administrator.getUserId(), "AUTO_ESCALATE",
                    incident.getIncidentId(), "OPEN", incident.getStatus().name(),
                    "Escalated due to SLA breach.");
            notificationService.sendInAppNotification(incident.getEmployeeId(),
                    "Incident " + incident.getIncidentId() + " has been escalated.");
        }
        database.save();
        System.out.println("Escalated incidents: " + escalated.size());
    }

    private void showUsers() {
        for (User user : users.values()) {
            System.out.println(user.getUserId() + " | " + user.getName()
                    + " | " + user.getUsername() + " | " + user.getRole()
                    + " | Active: " + user.isActive());
        }
    }

    private void showNotifications(String userId) {
        List<String> notifications = notificationService.getNotificationsFor(userId);
        if (notifications.isEmpty()) {
            System.out.println("No notifications.");
        } else {
            for (String notification : notifications) {
                System.out.println(notification);
            }
        }
    }

    private void showIncidents(List<Incident> incidents) {
        if (incidents.isEmpty()) {
            System.out.println("No incidents found.");
            return;
        }
        for (Incident incident : incidents) {
            System.out.println("\n" + incident.getIncidentId() + " | "
                    + incident.getTitle() + " | " + incident.getCategory()
                    + " | " + incident.getPriority() + " | " + incident.getStatus());
            System.out.println("Employee: " + incident.getEmployeeId()
                    + " | Technician: " + incident.getTechnicianId());
            System.out.println("Created: " + incident.getCreatedAt());
            if (incident.getResolutionNotes() != null) {
                System.out.println("Resolution: " + incident.getResolutionNotes());
            }
        }
    }

    private Incident.Category chooseCategory() {
        Incident.Category[] categories = Incident.Category.values();
        for (int i = 0; i < categories.length; i++) {
            System.out.println((i + 1) + ". " + categories[i]);
        }
        return categories[readRange("Category: ", 1, categories.length) - 1];
    }

    private List<Technician> getTechnicians() {
        List<Technician> result = new ArrayList<>();
        for (User user : users.values()) {
            if (user instanceof Technician) {
                result.add((Technician) user);
            }
        }
        return result;
    }

    private void reduceTechnicianWorkload(Incident incident) {
        if (incident.getTechnicianId() == null) {
            return;
        }
        for (Technician technician : getTechnicians()) {
            if (technician.getUserId().equals(incident.getTechnicianId())) {
                technician.decreaseWorkload();
                return;
            }
        }
    }

    private String readText(String prompt) {
        System.out.print(prompt);
        return scanner.nextLine().trim();
    }

    private int readInt(String prompt) {
        while (true) {
            try {
                return Integer.parseInt(readText(prompt));
            } catch (NumberFormatException ex) {
                System.out.println("Please enter a whole number.");
            }
        }
    }

    private int readRange(String prompt, int min, int max) {
        while (true) {
            int value = readInt(prompt);
            if (value >= min && value <= max) {
                return value;
            }
            System.out.println("Enter a value from " + min + " to " + max + ".");
        }
    }
}
