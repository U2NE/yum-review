package com.yumreview.auth;

import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.http.HttpStatus;
import org.springframework.security.core.userdetails.UserDetails;
import org.springframework.security.core.userdetails.UserDetailsService;
import org.springframework.security.core.userdetails.UsernameNotFoundException;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.server.ResponseStatusException;

import java.util.Locale;

@Service
public class AuthService implements UserDetailsService {
    private final AppUserRepository users;
    private final PasswordEncoder passwordEncoder;

    public AuthService(AppUserRepository users, PasswordEncoder passwordEncoder) {
        this.users = users;
        this.passwordEncoder = passwordEncoder;
    }

    @Transactional
    public AuthDtos.CurrentUser signup(AuthDtos.SignupRequest request) {
        String email = request.email().trim();
        String normalized = normalize(email);
        if (users.existsByEmailNormalized(normalized)) {
            throw duplicateEmail();
        }

        try {
            AppUser user = users.saveAndFlush(new AppUser(email, normalized, passwordEncoder.encode(request.password())));
            return AuthDtos.CurrentUser.from(user);
        } catch (DataIntegrityViolationException exception) {
            // The database unique constraint also handles concurrent signups.
            if (isDuplicateEmailViolation(exception)) throw duplicateEmail();
            throw new ResponseStatusException(HttpStatus.INTERNAL_SERVER_ERROR, "계정을 만들지 못했습니다.");
        }
    }

    @Override
    @Transactional(readOnly = true)
    public UserDetails loadUserByUsername(String email) throws UsernameNotFoundException {
        return users.findByEmailNormalized(normalize(email))
                .orElseThrow(() -> new UsernameNotFoundException("Invalid credentials"));
    }

    private static String normalize(String email) {
        return email.trim().toLowerCase(Locale.ROOT);
    }

    private static ResponseStatusException duplicateEmail() {
        return new ResponseStatusException(HttpStatus.CONFLICT, "이미 가입된 이메일입니다.");
    }

    private static boolean isDuplicateEmailViolation(Throwable error) {
        for (Throwable cause = error; cause != null; cause = cause.getCause()) {
            if (cause instanceof org.hibernate.exception.ConstraintViolationException violation
                    && "uq_app_user_email_normalized".equals(violation.getConstraintName())) {
                return true;
            }
        }
        return false;
    }
}
