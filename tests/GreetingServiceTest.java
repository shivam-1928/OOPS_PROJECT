import itsm.service.GreetingService;
import java.time.*;

public class GreetingServiceTest {
    public static void main(String[] args) {
        String[] times = { "00:00", "04:59", "05:00", "11:59", "12:00", "16:59", "17:00", "23:59" };
        String[] expected = { "Good evening", "Good evening", "Good morning", "Good morning", "Good afternoon", "Good afternoon", "Good evening", "Good evening" };
        ZoneId zone = ZoneId.of("Asia/Kolkata");
        for (int i = 0; i < times.length; i++) {
            Instant instant = LocalDateTime.parse("2026-11-22T" + times[i]).atZone(zone).toInstant();
            String actual = new GreetingService(Clock.fixed(instant, zone)).greeting();
            if (!expected[i].equals(actual)) throw new AssertionError(times[i] + ": " + actual);
        }
        System.out.println("PASS: 8 greeting time-boundary assertions.");
    }
}
