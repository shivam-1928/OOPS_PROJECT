package itsm.service;

import itsm.model.Incident;

public class PriorityCalculator {
    public int calculateScore(int impact, int urgency, int businessCriticality) {
        validateScore(impact);
        validateScore(urgency);
        validateScore(businessCriticality);
        return impact * urgency * businessCriticality;
    }

    public Incident.Priority calculatePriority(int impact, int urgency,
                                               int businessCriticality) {
        int score = calculateScore(impact, urgency, businessCriticality);

        // Initial score bands; these can be adjusted during system configuration.
        if (score >= 75) {
            return Incident.Priority.P1;
        } else if (score >= 40) {
            return Incident.Priority.P2;
        } else if (score >= 15) {
            return Incident.Priority.P3;
        }
        return Incident.Priority.P4;
    }

    private void validateScore(int score) {
        if (score < 1 || score > 5) {
            throw new IllegalArgumentException("Each priority factor must be from 1 to 5.");
        }
    }
}
