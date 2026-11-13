package itsm.strategy;

import java.util.Collection;
import itsm.model.Incident;
import itsm.model.Technician;

public interface TechnicianAssignmentStrategy {
    Technician assign(Incident incident, Collection<Technician> technicians);

    String getStrategyName();
}
