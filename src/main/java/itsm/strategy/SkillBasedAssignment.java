package itsm.strategy;

import java.util.Collection;
import itsm.model.Incident;
import itsm.model.Technician;

public class SkillBasedAssignment implements TechnicianAssignmentStrategy {
    @Override
    public Technician assign(Incident incident, Collection<Technician> technicians) {
        if (incident == null || technicians == null) {
            throw new IllegalArgumentException("Incident and technician list are required.");
        }

        for (Technician technician : technicians) {
            if (technician != null && technician.isAvailable()
                    && technician.hasSkill(incident.getCategory().name())) {
                return technician;
            }
        }

        throw new IllegalStateException("No available technician has the required skill.");
    }

    @Override
    public String getStrategyName() {
        return "Skill-based assignment";
    }
}
