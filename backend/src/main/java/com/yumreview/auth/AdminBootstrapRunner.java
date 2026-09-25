package com.yumreview.auth;

import org.springframework.boot.ApplicationArguments;
import org.springframework.boot.ApplicationRunner;
import org.springframework.core.env.Environment;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.stereotype.Component;
import org.springframework.transaction.annotation.Transactional;

import java.nio.charset.StandardCharsets;
import java.util.Locale;
import java.util.regex.Pattern;

@Component
public class AdminBootstrapRunner implements ApplicationRunner {
    private static final Pattern EMAIL = Pattern.compile("^[^\\s@]+@[^\\s@]+\\.[^\\s@]+$");
    private final AppUserRepository users;
    private final PasswordEncoder passwordEncoder;
    private final Environment environment;

    public AdminBootstrapRunner(AppUserRepository users, PasswordEncoder passwordEncoder, Environment environment) {
        this.users = users;
        this.passwordEncoder = passwordEncoder;
        this.environment = environment;
    }

    @Override
    @Transactional
    public void run(ApplicationArguments args) {
        if (users.countBySystemRole("SERVER_ADMIN") > 0) return;

        String email = environment.getProperty("BOOTSTRAP_SERVER_ADMIN_EMAIL");
        String password = environment.getProperty("BOOTSTRAP_SERVER_ADMIN_PASSWORD");
        if (email == null || email.isBlank() || password == null || password.isBlank()) {
            throw new IllegalStateException("No server administrator exists. Set BOOTSTRAP_SERVER_ADMIN_EMAIL and BOOTSTRAP_SERVER_ADMIN_PASSWORD to create the initial administrator.");
        }
        email = email.trim();
        String normalized = email.toLowerCase(Locale.ROOT);
        if (email.length() > 320 || !EMAIL.matcher(email).matches()) {
            throw new IllegalStateException("BOOTSTRAP_SERVER_ADMIN_EMAIL must be a valid email address of at most 320 characters.");
        }
        if (password.length() < 12 || password.getBytes(StandardCharsets.UTF_8).length > 72) {
            throw new IllegalStateException("BOOTSTRAP_SERVER_ADMIN_PASSWORD must be at least 12 characters and no more than 72 UTF-8 bytes.");
        }
        if (users.existsByEmailNormalized(normalized)) {
            throw new IllegalStateException("The bootstrap administrator email is already registered as a non-administrator; no account was changed.");
        }
        users.saveAndFlush(AppUser.serverAdmin(email, normalized, passwordEncoder.encode(password)));
    }
}
