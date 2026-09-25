package com.yumreview.auth;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.GeneratedValue;
import jakarta.persistence.GenerationType;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import org.springframework.security.core.GrantedAuthority;
import org.springframework.security.core.userdetails.UserDetails;

import java.util.Collection;
import java.util.List;
import java.util.Locale;

@Entity
@Table(name = "app_user")
public class AppUser implements UserDetails {
    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @Column(nullable = false, length = 320)
    private String email;

    @Column(name = "email_normalized", nullable = false, length = 320, unique = true)
    private String emailNormalized;

    @Column(name = "password_hash", nullable = false, length = 255)
    private String passwordHash;

    @Column(name = "system_role", nullable = false, length = 24)
    private String systemRole = "MEMBER";

    @Column(name = "must_change_password", nullable = false)
    private boolean mustChangePassword;

    protected AppUser() {
    }

    AppUser(String email, String emailNormalized, String passwordHash) {
        this.email = email;
        this.emailNormalized = emailNormalized;
        this.passwordHash = passwordHash;
    }

    static AppUser serverAdmin(String email, String emailNormalized, String passwordHash) {
        AppUser user = new AppUser(email, emailNormalized, passwordHash);
        user.systemRole = "SERVER_ADMIN";
        user.mustChangePassword = true;
        return user;
    }

    public Long getId() {
        return id;
    }

    public String getEmail() {
        return email;
    }

    public String getSystemRole() { return systemRole; }

    public boolean isServerAdmin() { return "SERVER_ADMIN".equals(systemRole); }

    public boolean isMustChangePassword() { return mustChangePassword; }

    public void changePassword(String encodedPassword) {
        this.passwordHash = encodedPassword;
        this.mustChangePassword = false;
    }

    @Override
    public String getUsername() {
        return emailNormalized;
    }

    @Override
    public String getPassword() {
        return passwordHash;
    }

    @Override
    public Collection<? extends GrantedAuthority> getAuthorities() {
        return List.of((GrantedAuthority) () -> "ROLE_" + systemRole.toUpperCase(Locale.ROOT));
    }
}
