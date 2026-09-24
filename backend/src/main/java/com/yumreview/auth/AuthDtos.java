package com.yumreview.auth;

import jakarta.validation.constraints.Email;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.AssertTrue;
import jakarta.validation.constraints.Size;

import java.nio.charset.StandardCharsets;

public final class AuthDtos {
    private AuthDtos() {
    }

    public record SignupRequest(
            @NotBlank @Email @Size(max = 320) String email,
            @NotBlank @Size(min = 8, max = 72) String password
    ) {
        @AssertTrue(message = "비밀번호는 UTF-8 기준 72바이트 이하여야 합니다.")
        public boolean isPasswordWithinBcryptLimit() {
            return password == null || password.getBytes(StandardCharsets.UTF_8).length <= 72;
        }
    }

    public record CurrentUser(Long id, String email) {
        public static CurrentUser from(AppUser user) {
            return new CurrentUser(user.getId(), user.getEmail());
        }
    }

    public record CsrfResponse(String headerName, String token) {
    }
}
