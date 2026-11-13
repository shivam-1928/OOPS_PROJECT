package itsm.strategy;

import java.util.Collection;
import itsm.model.Incident;
import itsm.model.Technician;

public class LoadBasedAssignment implements TechnicianAssignmentStrategy {
    @Override
    public Technician assign(Incident incident, Collection<Technician> technicians) {
        if (incident == null || technicians == null) {
            throw new IllegalArgumentException("Incident and technician list are required.");
        }

        Technician selected = null;

        for (Technician technician : technicians) {
            if (technician != null && technician.isAvailable()) {
                if (selected == null
                        || technician.getActiveIncidentCount() < selected.getActiveIncidentCount()) {
                    selected = technician;
                }
            }
        }

        if (selected == null) {
            throw new IllegalStateException("No available technicians.");
        }

        return selected;
    }

    @Override
    public String getStrategyName() {
        return "Load-based assignment";
    }
}
