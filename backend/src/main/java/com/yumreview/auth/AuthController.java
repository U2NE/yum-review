package com.yumreview.auth;

import jakarta.servlet.http.HttpServletRequest;
import jakarta.validation.Valid;
import org.springframework.http.HttpStatus;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.security.web.csrf.CsrfToken;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api/auth")
public class AuthController {
    private final AuthService authService;

    public AuthController(AuthService authService) {
        this.authService = authService;
    }

    @GetMapping("/csrf")
    public AuthDtos.CsrfResponse csrf(HttpServletRequest request) {
        CsrfToken token = (CsrfToken) request.getAttribute(CsrfToken.class.getName());
        // getToken() materializes the deferred session token. Spring's XOR
        // request handler accepts this exposed token in the named header.
        return new AuthDtos.CsrfResponse(token.getHeaderName(), token.getToken());
    }

    @PostMapping("/signup")
    @ResponseStatus(HttpStatus.CREATED)
    public AuthDtos.CurrentUser signup(@Valid @RequestBody AuthDtos.SignupRequest request) {
        return authService.signup(request);
    }

    @GetMapping("/me")
    public AuthDtos.CurrentUser me(@AuthenticationPrincipal AppUser user) {
        return authService.currentUser(user);
    }

    @PutMapping("/password")
    public AuthDtos.PasswordChanged changePassword(@AuthenticationPrincipal AppUser user,
                                                    @Valid @RequestBody AuthDtos.PasswordChangeRequest request) {
        return authService.changePassword(user, request);
    }
}
