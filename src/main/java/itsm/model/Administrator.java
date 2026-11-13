package itsm.model;

public class Administrator extends User {
    public Administrator(String userId, String name, String username,
                         String password, String email) {
        super(userId, name, username, password, email);
    }

    @Override
    public String getRole() {
        return "ADMINISTRATOR";
    }
}
