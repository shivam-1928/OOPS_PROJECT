package itsm.model;

import java.util.HashSet;
import java.util.Set;

public class Technician extends User {
    private final Set<String> skills;
    private int activeIncidentCount;
    private boolean available;

    public Technician(String userId, String name, String username,
                      String password, String email, Set<String> skills) {
        super(userId, name, username, password, email);
        this.skills = new HashSet<>();
        if (skills != null) {
            for (String skill : skills) {
                if (skill != null && !skill.trim().isEmpty()) {
                    this.skills.add(skill.trim().toUpperCase());
                }
            }
        }
        this.activeIncidentCount = 0;
        this.available = true;
    }

    public Set<String> getSkills() {
        return new HashSet<>(skills);
    }

    public boolean hasSkill(String category) {
        return category != null && skills.contains(category.trim().toUpperCase());
    }

    public void addSkill(String skill) {
        if (skill == null || skill.trim().isEmpty()) {
            throw new IllegalArgumentException("Skill cannot be empty.");
        }
        skills.add(skill.trim().toUpperCase());
    }

    public int getActiveIncidentCount() {
        return activeIncidentCount;
    }

    public void increaseWorkload() {
        activeIncidentCount++;
    }

    public void decreaseWorkload() {
        if (activeIncidentCount > 0) {
            activeIncidentCount--;
        }
    }

    public boolean isAvailable() {
        return available && isActive();
    }
    public boolean isMarkedAvailable() { return available; }

    public void setAvailable(boolean available) {
        this.available = available;
    }

    @Override
    public String getRole() {
        return "TECHNICIAN";
    }
}
