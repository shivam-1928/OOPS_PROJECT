package itsm.model;

public class Employee extends User {
    private String department;

    public Employee(String userId, String name, String username,
                    String password, String email, String department) {
        super(userId, name, username, password, email);
        this.department = department;
    }

    public String getDepartment() {
        return department;
    }

    public void setDepartment(String department) {
        this.department = department;
    }

    @Override
    public String getRole() {
        return "EMPLOYEE";
    }
}
