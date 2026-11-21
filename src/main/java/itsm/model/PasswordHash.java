package itsm.model;

import java.security.MessageDigest;
import java.security.SecureRandom;
import java.util.Base64;
import javax.crypto.SecretKeyFactory;
import javax.crypto.spec.PBEKeySpec;

/** PBKDF2 encoding compatible with the supplied database's salt:hash records. */
final class PasswordHash {
    private static final int ITERATIONS = 210000;
    static String encode(String password) {
        byte[] salt = new byte[16]; new SecureRandom().nextBytes(salt);
        return "pbkdf2-sha256$" + ITERATIONS + "$" + Base64.getEncoder().encodeToString(salt) + "$" + Base64.getEncoder().encodeToString(derive(password, salt, ITERATIONS));
    }
    static boolean valid(String encoded) {
        try {
            String[] parts = encoded.startsWith("pbkdf2-sha256$") ? encoded.split("\\$") : encoded.split(":");
            if (parts.length != 2 && parts.length != 4) return false;
            int count = parts.length == 4 ? Integer.parseInt(parts[1]) : ITERATIONS;
            return count >= 10000 && count <= 2000000 && Base64.getDecoder().decode(parts[parts.length - 2]).length == 16 && Base64.getDecoder().decode(parts[parts.length - 1]).length == 32;
        } catch (RuntimeException error) { return false; }
    }
    static boolean matches(String password, String encoded) {
        if (password == null || !valid(encoded)) return false;
        String[] parts = encoded.startsWith("pbkdf2-sha256$") ? encoded.split("\\$") : encoded.split(":");
        int count = parts.length == 4 ? Integer.parseInt(parts[1]) : ITERATIONS;
        byte[] salt = Base64.getDecoder().decode(parts[parts.length - 2]), expected = Base64.getDecoder().decode(parts[parts.length - 1]);
        return MessageDigest.isEqual(expected, derive(password, salt, count));
    }
    private static byte[] derive(String password, byte[] salt, int count) {
        PBEKeySpec spec = new PBEKeySpec(password.toCharArray(), salt, count, 256);
        try { return SecretKeyFactory.getInstance("PBKDF2WithHmacSHA256").generateSecret(spec).getEncoded(); }
        catch (Exception error) { throw new IllegalStateException("Password hashing is unavailable.", error); }
        finally { spec.clearPassword(); }
    }
}
