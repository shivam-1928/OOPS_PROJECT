package itsm.service;

import java.time.Clock;
import java.time.LocalTime;
import java.time.ZoneId;
import java.util.Objects;

/** The service desk uses India time consistently across browser and server hosts. */
public final class GreetingService {
    private final Clock clock;

    public GreetingService() { this(Clock.system(ZoneId.of("Asia/Kolkata"))); }
    public GreetingService(Clock clock) { this.clock = Objects.requireNonNull(clock); }

    public String greeting() {
        int hour = LocalTime.now(clock).getHour();
        if (hour >= 5 && hour < 12) return "Good morning";
        if (hour >= 12 && hour < 17) return "Good afternoon";
        return "Good evening";
    }
}
