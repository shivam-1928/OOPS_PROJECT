package itsm.model;

public abstract class User {
    private final String userId;
    private String name;
    private String username;
    private String password;
    private String email;
    private boolean active;
    private boolean approvalPending;

    private String phone = "";

    private String profilePicture = "";



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
        return active && !approvalPending;
    }

    public boolean isApprovalPending() { return approvalPending; }
    public void setApprovalPending(boolean pending) { approvalPending = pending; }

    public void setActive(boolean active) {
        this.active = active;
    }

    public String getPhone() { return phone; }
    public void setPhone(String phone) { validatePhone(phone); this.phone = phone.trim(); }
    public static void validatePhone(String phone) {
        if (phone == null || phone.length() > 30 || !phone.matches("[0-9+(). -]*") || (!phone.isBlank() && phone.replaceAll("[^0-9]", "").length() < 7))
            throw new IllegalArgumentException("Enter a valid phone number with at least 7 digits, or leave it blank.");
    }
    public String getProfilePicture() { return profilePicture; }
    public void setProfilePicture(String picture) { validateProfilePicture(picture); this.profilePicture = picture; }
    public static void validateProfilePicture(String picture) {
        if (picture == null || picture.length() > 24000) throw new IllegalArgumentException("Profile picture is too large.");
        if (!picture.isEmpty()) {
            if (!picture.startsWith("data:image/jpeg;base64,")) throw new IllegalArgumentException("Use a JPEG profile picture.");
            try {
                byte[] bytes = java.util.Base64.getDecoder().decode(picture.substring(23));
                if (bytes.length < 3 || (bytes[0] & 255) != 255 || (bytes[1] & 255) != 216 || (bytes[2] & 255) != 255) throw new IllegalArgumentException("Invalid JPEG.");
                try (var stream = javax.imageio.ImageIO.createImageInputStream(new java.io.ByteArrayInputStream(bytes))) {
                    var readers = javax.imageio.ImageIO.getImageReaders(stream);
                    if (!readers.hasNext()) throw new IllegalArgumentException("Invalid JPEG.");
                    var reader = readers.next();
                    try {
                        reader.setInput(stream);
                        if (reader.getWidth(0) > 256 || reader.getHeight(0) > 256) throw new IllegalArgumentException("Use a profile picture up to 256 pixels square.");
                        reader.read(0);
                    } finally { reader.dispose(); }
                }
            } catch (java.io.IOException | IllegalArgumentException error) { throw new IllegalArgumentException("Invalid profile picture."); }
        }
    }
    public abstract String getRole();

    protected static boolean isBlank(String value) {
        return value == null || value.trim().isEmpty();
    }
}
