package itsm.persistence;

import itsm.model.*;
import itsm.service.*;
import java.io.*;
import java.nio.charset.StandardCharsets;
import java.time.LocalDateTime;
import java.util.*;

public final class Database {
    private final Map<String, User> users;
    private final IncidentService incidents;
    private final SLAService sla;
    private final AuditService audit;
    private final NotificationService notifications;
    private int version;

    public Database(Map<String, User> users, IncidentService incidents, SLAService sla,
                    AuditService audit, NotificationService notifications) {
        this.users = users;
        this.incidents = incidents;
        this.sla = sla;
        this.audit = audit;
        this.notifications = notifications;
    }

    private Process start(String action) throws IOException {
        return new ProcessBuilder(System.getProperty("itsm.python", "python"),
                "database/store.py", action, System.getProperty("itsm.db", "itsm.sqlite"))
                .redirectError(ProcessBuilder.Redirect.INHERIT).start();
    }

    private void check(Process process) throws IOException {
        try {
            if (process.waitFor() != 0) throw new IOException("Database operation failed. Restart the console.");
        } catch (InterruptedException ex) {
            Thread.currentThread().interrupt();
            throw new IOException(ex);
        }
    }

    public void load() {
        try {
            Process process = start("load");
            try (BufferedReader input = process.inputReader(StandardCharsets.UTF_8)) {
                String header = input.readLine();
                if (header == null) throw new IOException("Cannot load database. Check Python and the project directory.");
                version = Integer.parseInt(header);
                Map<String, User> byId = new HashMap<>();
                String line;
                while ((line = input.readLine()) != null) {
                    String[] f = line.split("\\t", -1);
                    for (int n = 1; n < f.length; n++) {
                        f[n] = f[n].equals("-") ? null :
                            new String(Base64.getDecoder().decode(f[n]), StandardCharsets.UTF_8);
                    }
                    switch (f[0]) {
                        case "accounts":
                            User user;
                            if ("EMPLOYEE".equals(f[6])) user = new Employee(f[1],f[2],f[3],"restore",f[5],f[7]);
                            else if ("TECHNICIAN".equals(f[6])) {
                                Technician tech = new Technician(f[1],f[2],f[3],"restore",f[5],null);
                                tech.setAvailable("1".equals(f[9]));
                                user = tech;
                            } else user = new Administrator(f[1],f[2],f[3],"restore",f[5]);
                            user.restorePasswordHash(f[4]);
                            user.setActive("1".equals(f[8]));
                            users.put(user.getUsername(),user);
                            byId.put(user.getUserId(),user);
                            break;
                        case "skills": ((Technician)byId.get(f[1])).addSkill(f[2]); break;
                        case "incidents":
                            Incident i = new Incident(f[1],f[2],f[3],f[4],Incident.Category.valueOf(f[5]),
                                    Integer.parseInt(f[6]),Integer.parseInt(f[7]),Integer.parseInt(f[8]));
                            i.setPriority(Incident.Priority.valueOf(f[9]));
                            i.setStatus(Incident.Status.valueOf(f[10]));
                            i.setTechnicianId(f[11]);
                            i.restoreCreatedAt(time(f[12]));
                            i.setAcknowledgedAt(time(f[13]));
                            i.setResolvedAt(time(f[14]));
                            i.setClosedAt(time(f[15]));
                            i.setResolutionNotes(f[16]);
                            incidents.restore(i);
                            sla.restore(f[1],time(f[17]),time(f[18]));
                            if (f[11] != null && i.getStatus() != Incident.Status.CLOSED)
                                ((Technician)byId.get(f[11])).increaseWorkload();
                            break;
                        case "audit": audit.restore(new AuditLog(time(f[1]),f[2],f[3],f[4],f[5],f[6],f[7])); break;
                        case "notifications": notifications.restore(f[2]); break;
                        default: throw new IOException("Unknown database record");
                    }
                }
            }
            check(process);
        } catch (IOException ex) { throw new UncheckedIOException(ex); }
    }

    private static LocalDateTime time(String value) {
        return value == null ? null : LocalDateTime.parse(value);
    }

    private static void row(Writer out, String table, Object... values) throws IOException {
        out.write(table);
        for (Object value : values) {
            out.write('\t');
            out.write(value == null ? "-" : Base64.getEncoder().encodeToString(
                    value.toString().getBytes(StandardCharsets.UTF_8)));
        }
        out.write('\n');
    }

    public void save() {
        try {
            Process process = start("save");
            try (Writer out = process.outputWriter(StandardCharsets.UTF_8)) {
                out.write(version + "\n");
                for (User u : users.values()) {
                    Technician t = u instanceof Technician ? (Technician)u : null;
                    row(out,"accounts",u.getUserId(),u.getName(),u.getUsername(),u.getPasswordHash(),
                            u.getEmail(),u.getRole(),u instanceof Employee ? ((Employee)u).getDepartment() : null,
                            u.isActive() ? 1 : 0,t == null ? null : (t.isAvailable() ? 1 : 0));
                    if (t != null)
                        for (String skill : t.getSkills()) row(out,"skills",t.getUserId(),skill);
                }
                for (Incident i : incidents.getAllIncidents()) {
                    String id = i.getIncidentId();
                    row(out,"incidents",id,i.getEmployeeId(),i.getTitle(),i.getDescription(),i.getCategory(),
                            i.getImpact(),i.getUrgency(),i.getBusinessCriticality(),i.getPriority(),i.getStatus(),
                            i.getTechnicianId(),i.getCreatedAt(),i.getAcknowledgedAt(),i.getResolvedAt(),
                            i.getClosedAt(),i.getResolutionNotes(),sla.getResponseDeadline(id),sla.getResolutionDeadline(id));
                }
                for (AuditLog log : audit.getAllLogs())
                    row(out,"audit",log.getTimestamp(),log.getUserId(),log.getAction(),log.getIncidentId(),
                            log.getPreviousState(),log.getNewState(),log.getDescription());
                for (String message : notifications.getAllInAppNotifications()) {
                    String recipient = message.split(" \\| ",3)[1].substring("To: ".length());
                    row(out,"notifications",recipient,message);
                }
            }
            check(process);
            version++;
        } catch (IOException ex) { throw new UncheckedIOException(ex); }
    }
}
