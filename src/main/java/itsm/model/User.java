package itsm.model;

public abstract class User {
    private final String userId;
    private String name;
    private String username;
    private String password;
    private String email;
    private boolean active;

    public User(String userId, String name, String username,
                String password, String email) {
        if (isBlank(userId) || isBlank(name) || isBlank(username)
                || isBlank(password) || isBlank(email)) {
            throw new IllegalArgumentException("User details cannot be empty.");
        }

        this.userId = userId;
        this.name = name;
        this.username = username;
        this.password = PasswordHash.encode(password);
        this.email = email;
        this.active = true;
    }

    public String getUserId() {
        return userId;
    }

    public String getName() {
        return name;
    }

    public void setName(String name) {
        if (isBlank(name)) {
            throw new IllegalArgumentException("Name cannot be empty.");
        }
        this.name = name;
    }

    public String getUsername() {
        return username;
    }

    public void setUsername(String username) {
        if (isBlank(username)) {
            throw new IllegalArgumentException("Username cannot be empty.");
        }
        this.username = username;
    }

    public boolean checkPassword(String password) {
        return PasswordHash.matches(password, this.password);
    }

    public void changePassword(String oldPassword, String newPassword) {
        if (!checkPassword(oldPassword)) {
            throw new IllegalArgumentException("Incorrect current password.");
        }
        if (isBlank(newPassword)) {
            throw new IllegalArgumentException("New password cannot be empty.");
        }
        this.password = PasswordHash.encode(newPassword);
    }

    /** Persistence only; never include this value in API responses or logs. */
    public String getPasswordHash() { return password; }
    public void restorePasswordHash(String encoded) {
        if (!PasswordHash.valid(encoded)) throw new IllegalArgumentException("Unsupported stored password format.");
        password = encoded;
    }

    public String getEmail() {
        return email;
    }

    public void setEmail(String email) {
        if (isBlank(email)) {
            throw new IllegalArgumentException("Email cannot be empty.");
        }
        this.email = email;
    }

    public boolean isActive() {
        return active;
    }

    public void setActive(boolean active) {
        this.active = active;
    }

    public abstract String getRole();

    protected static boolean isBlank(String value) {
        return value == null || value.trim().isEmpty();
    }
}
