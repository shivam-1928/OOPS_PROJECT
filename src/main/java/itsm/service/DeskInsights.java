package itsm.service;

import itsm.model.Incident;
import itsm.model.Technician;
import java.time.LocalDateTime;
import java.util.*;

public final class DeskInsights {
    private DeskInsights() {}

    public record Recommendation(Technician technician, String reason) {}
    public record Spike(Incident anchor, List<Incident> recent, double baseline) {}

    public static Optional<Recommendation> recommend(Incident.Category category,
            Collection<Technician> technicians, Collection<Incident> incidents) {
        Map<String, Integer> loads = new HashMap<>();
        for (Incident i : incidents) {
            if (i.getTechnicianId() != null && !Set.of(Incident.Status.RESOLVED,
                    Incident.Status.VERIFIED, Incident.Status.CLOSED).contains(i.getStatus()))
                loads.merge(i.getTechnicianId(), 1, Integer::sum);
        }
        return technicians.stream().filter(Technician::isAvailable)
            .min(Comparator.comparing((Technician t) -> !t.hasSkill(category.name()))
                .thenComparingInt(t -> loads.getOrDefault(t.getUserId(), 0))
                .thenComparing(Technician::getUserId))
            .map(t -> {
                int count = loads.getOrDefault(t.getUserId(), 0);
                String reason = t.hasSkill(category.name())
                    ? "Matches " + category + " and has the fewest unresolved tickets among available specialists"
                    : "No available " + category + " specialist. This technician has the fewest unresolved tickets among available technicians";
                return new Recommendation(t, reason + " (" + count + ").");
            });
    }

    public static List<Spike> spikes(Collection<Incident> incidents, LocalDateTime now) {
        Map<Incident.Category, List<Incident>> groups = new EnumMap<>(Incident.Category.class);
        for (Incident i : incidents)
            if (!i.getCreatedAt().isAfter(now))
                groups.computeIfAbsent(i.getCategory(), key -> new ArrayList<>()).add(i);
        List<Spike> alerts = new ArrayList<>();
        LocalDateTime start = now.minusMinutes(30);
        for (List<Incident> group : groups.values()) {
            group.sort(Comparator.comparing(Incident::getCreatedAt).thenComparing(Incident::getIncidentId));
            List<Incident> recent = group.stream().filter(i -> i.getCreatedAt().isAfter(start)).toList();
            if (recent.size() < 5) continue;
            int history = 0;
            for (int day = 1; day <= 7; day++) {
                LocalDateTime end = now.minusDays(day);
                LocalDateTime begin = end.minusMinutes(30);
                history += (int) group.stream().map(Incident::getCreatedAt)
                    .filter(time -> time.isAfter(begin) && !time.isAfter(end)).count();
            }
            double baseline = history / 7.0;
            if (recent.size() < 3 * baseline) continue;
            // A quiet half-hour separates episodes and gives each alert a stable anchor.
            int first = group.size() - recent.size();
            while (first > 0 && group.get(first - 1).getCreatedAt().plusMinutes(30)
                    .isAfter(group.get(first).getCreatedAt())) first--;
            alerts.add(new Spike(group.get(first), recent, baseline));
        }
        return alerts;
    }
}
